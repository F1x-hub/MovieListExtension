const assert = require("assert");
const {
  createCredentialFingerprint,
  createProviderKeyVault,
  maskCredential,
} = require("../functions/providerKeyVault");
const {
  createKinopoiskAdapter,
  createTmdbAdapter,
  normalizeKinopoiskQuota,
} = require("../functions/providerQuotaAdapters");
const {
  createProviderKeyManagementService,
  createSafeKeyDto,
} = require("../functions/providerKeyManagement");

class FakeDocRef {
  constructor(collection, id) {
    this.collection = collection;
    this.id = id;
  }

  async get() {
    const data = this.collection.docs.get(this.id);
    return {
      exists: Boolean(data),
      data: () => data,
      id: this.id,
    };
  }

  async set(data) {
    this.collection.docs.set(this.id, { ...data });
  }

  async update(data) {
    const current = this.collection.docs.get(this.id);
    if (!current) throw new Error("Document does not exist");
    this.collection.docs.set(this.id, { ...current, ...data });
  }
}

class FakeQuery {
  constructor(collection, field, value) {
    this.collection = collection;
    this.field = field;
    this.value = value;
    this.max = null;
  }

  limit(max) {
    this.max = max;
    return this;
  }

  async get() {
    const docs = Array.from(this.collection.docs.entries())
      .filter(([, data]) => data[this.field] === this.value)
      .slice(0, this.max || Number.MAX_SAFE_INTEGER)
      .map(([id, data]) => ({ id, data: () => data }));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class FakeCollection {
  constructor() {
    this.docs = new Map();
  }

  doc(id) {
    return new FakeDocRef(this, id);
  }

  where(field, operator, value) {
    assert.strictEqual(operator, "==");
    return new FakeQuery(this, field, value);
  }

  async get() {
    const docs = Array.from(this.docs.entries()).map(([id, data]) => ({ id, data: () => data }));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class FakeDb {
  constructor() {
    this.collections = new Map();
  }

  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection());
    return this.collections.get(name);
  }
}

function createVaultFixture() {
  const values = new Map();
  const calls = [];
  const vault = {
    async createCredential({ provider, keyId, value }) {
      const secretName = `projects/test/secrets/provider-key-${provider}-${keyId}`;
      const versionName = `${secretName}/versions/1`;
      values.set(versionName, value);
      calls.push(["create", provider, keyId]);
      return { secretName, versionName };
    },
    async accessCredential({ versionName }) {
      calls.push(["access", versionName]);
      return values.get(versionName);
    },
    async disableVersion(versionName) {
      calls.push(["disable", versionName]);
    },
    async destroyVersion(versionName) {
      calls.push(["destroy", versionName]);
      values.delete(versionName);
    },
    async deleteSecret(secretName) {
      calls.push(["delete", secretName]);
    },
  };
  return { vault, values, calls };
}

function createServiceFixture() {
  const db = new FakeDb();
  const vaultFixture = createVaultFixture();
  const fixedNow = new Date("2026-08-26T10:00:00.000Z");
  const adapter = {
    async test({ secret }) {
      assert.strictEqual(secret, "kp-secret-value");
      return {
        ok: true,
        quota: {
          mode: "provider_exact",
          unit: "requests",
          used: 100,
          limit: 1000,
          remaining: 900,
          status: "normal",
          measuredAt: fixedNow.toISOString(),
          stale: false,
        },
      };
    },
    async quota() {
      return { mode: "provider_exact", unit: "requests", used: 100, limit: 1000, remaining: 900, status: "normal", measuredAt: fixedNow.toISOString(), stale: false };
    },
  };
  const service = createProviderKeyManagementService({
    db,
    vault: vaultFixture.vault,
    adapters: { kinopoisk: adapter, tmdb: adapter },
    now: () => fixedNow,
    randomUUID: () => "abcdef0123456789abcdef0123456789",
  });
  return { db, service, vaultFixture, fixedNow };
}

assert.strictEqual(maskCredential("  secret-value  "), "••••alue", "Mask must keep only the final characters");
assert.match(createCredentialFingerprint("secret-value"), /^sha256:[a-f0-9]{16}$/);

(async () => {
  {
    const calls = [];
    const client = {
      async createSecret(request) {
        calls.push(["create", request]);
        return [{ name: "projects/test/secrets/provider-key-kinopoisk-abcdef0123456789" }];
      },
      async addSecretVersion(request) {
        calls.push(["add", request]);
        return [{ name: `${request.parent}/versions/1` }];
      },
      async accessSecretVersion() {
        return [{ payload: { data: Buffer.from("vault-value") } }];
      },
    };
    const vault = createProviderKeyVault({ client, projectId: "test" });
    const result = await vault.createCredential({ provider: "kinopoisk", keyId: "abcdef0123456789", value: "vault-value" });
    assert.ok(result.secretName);
    assert.ok(result.versionName);
    assert.ok(!JSON.stringify(result).includes("vault-value"), "Vault result must not contain the raw secret");
    assert.strictEqual(await vault.accessCredential({ versionName: result.versionName }), "vault-value");
    assert.strictEqual(calls[1][1].payload.data.toString("utf8"), "vault-value");
  }

  const fixture = createServiceFixture();
  const added = await fixture.service.addProviderKey({
    provider: "kinopoisk",
    label: "Основной Kinopoisk",
    purpose: "Поиск фильмов",
    secret: "kp-secret-value",
    actorUid: "admin-1",
  });
  assert.strictEqual(added.provider, "kinopoisk");
  assert.strictEqual(added.status, "active");
  assert.strictEqual(added.purpose, "Поиск фильмов");
  assert.strictEqual(added.maskedValue, "••••alue");
  assert.ok(!JSON.stringify(added).includes("kp-secret-value"), "Safe DTO must not expose the raw secret");

  const addedTmdb = await fixture.service.addProviderKey({
    provider: "tmdb",
    label: "TMDB metadata",
    purpose: "Карточки фильмов",
    secret: "kp-secret-value",
    actorUid: "admin-1",
  }).catch((error) => error);
  assert.strictEqual(addedTmdb.code, "DUPLICATE_KEY", "Fingerprints stay global across providers");

  const listed = await fixture.service.listProviderKeys();
  assert.strictEqual(listed.length, 1);
  assert.strictEqual(listed[0].maskedValue, "••••alue");
  assert.strictEqual(listed[0].purpose, "Поиск фильмов");

  await assert.rejects(
    () => fixture.service.addProviderKey({ provider: "kinopoisk", label: "Duplicate", purpose: "Duplicate", secret: "kp-secret-value", actorUid: "admin-1" }),
    (error) => error.code === "DUPLICATE_KEY" && error.statusCode === 409
  );

  const disabled = await fixture.service.setProviderKeyStatus({ keyId: added.id, status: "disabled", actorUid: "admin-1" });
  assert.strictEqual(disabled.status, "disabled");

  const enabled = await fixture.service.setProviderKeyStatus({ keyId: added.id, status: "active", actorUid: "admin-1" });
  assert.strictEqual(enabled.status, "active");

  const quota = await fixture.service.getProviderKeyQuota({ keyId: added.id, actorUid: "admin-1" });
  assert.strictEqual(quota.remaining, 900);

  const revoked = await fixture.service.revokeProviderKey({ keyId: added.id, actorUid: "admin-1" });
  assert.strictEqual(revoked.status, "disabled");
  assert.ok(fixture.vaultFixture.calls.some(([action]) => action === "destroy"));

  const dto = createSafeKeyDto("key-1", { secret: "should-not-appear", label: "Safe" });
  assert.ok(!JSON.stringify(dto).includes("should-not-appear"));

  const exactQuota = normalizeKinopoiskQuota({ requestsLimit: 1000, requestsUsed: 250, requestsRemaining: 750 }, fixture.fixedNow);
  assert.deepStrictEqual(exactQuota, {
    mode: "provider_exact",
    unit: "requests",
    used: 250,
    limit: 1000,
    remaining: 750,
    status: "normal",
    measuredAt: fixture.fixedNow.toISOString(),
    stale: false,
  });

  const unknownQuota = normalizeKinopoiskQuota({ token: "opaque" }, fixture.fixedNow);
  assert.strictEqual(unknownQuota.mode, "unavailable");
  assert.strictEqual(unknownQuota.remaining, null);

  const retiredQuotaShape = normalizeKinopoiskQuota({ dailyQuota: 10, dailyQuotaRemaining: 8 }, fixture.fixedNow);
  assert.strictEqual(retiredQuotaShape.mode, "unavailable");

  let receivedSecret = null;
  const adapter = createKinopoiskAdapter({
    fetchImpl: async (url, options) => {
      assert.strictEqual(url, "https://api.poiskkino.dev/v1.5/token");
      receivedSecret = options.headers["X-API-KEY"];
      return { ok: true, status: 200, async json() { return { requestsLimit: 10, requestsUsed: 2, requestsRemaining: 8 }; } };
    },
  });
  const probe = await adapter.test({ secret: "server-only-secret" });
  assert.strictEqual(probe.ok, true);
  assert.strictEqual(probe.quota.remaining, 8);
  assert.strictEqual(probe.quota.used, 2);
  assert.strictEqual(receivedSecret, "server-only-secret");

  let tmdbAuthorization = null;
  const tmdbAdapter = createTmdbAdapter({
    fetchImpl: async (url, options) => {
      assert.strictEqual(url, "https://api.themoviedb.org/3/authentication");
      tmdbAuthorization = options.headers.Authorization;
      return { ok: true, status: 200 };
    },
  });
  const tmdbProbe = await tmdbAdapter.test({ secret: "tmdb-server-token" });
  assert.strictEqual(tmdbAuthorization, "Bearer tmdb-server-token");
  assert.deepStrictEqual(tmdbProbe.quota, {
    mode: "unavailable",
    unit: "requests_per_second",
    used: null,
    limit: null,
    remaining: null,
    status: "unavailable",
    measuredAt: tmdbProbe.quota.measuredAt,
    stale: false,
  });
  await assert.rejects(
    () => createTmdbAdapter({ fetchImpl: async () => ({ ok: false, status: 401 }) }).test({ secret: "invalid-token" }),
    (error) => error.code === "INVALID_CREDENTIAL"
  );

  console.log("providerKeyManagement.test.cjs: all tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
