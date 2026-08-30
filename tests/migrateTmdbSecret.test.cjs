const assert = require("node:assert/strict");
const {
  LEGACY_SECRET_ID,
  createMigrationReport,
  migrateTmdbSecret,
  parseArgs,
} = require("../scripts/migrate-tmdb-secret");

class FakeDoc {
  constructor(collection, id) {
    this.collection = collection;
    this.id = id;
  }
  async get() {
    const data = this.collection.docs.get(this.id);
    return { exists: Boolean(data), data: () => data };
  }
  async set(data) { this.collection.docs.set(this.id, { ...data }); }
  async update(data) {
    this.collection.docs.set(this.id, { ...this.collection.docs.get(this.id), ...data });
  }
}

class FakeCollection {
  constructor() { this.docs = new Map(); }
  doc(id) { return new FakeDoc(this, id); }
  where(field, operator, value) {
    assert.equal(operator, "==");
    return {
      limit: () => ({
        get: async () => {
          const docs = [...this.docs.entries()]
            .filter(([, data]) => data[field] === value)
            .map(([id, data]) => ({ id, data: () => data }));
          return { empty: docs.length === 0, docs };
        },
      }),
    };
  }
  async get() {
    const docs = [...this.docs.entries()].map(([id, data]) => ({ id, data: () => data }));
    return { empty: docs.length === 0, docs };
  }
}

class FakeDb {
  constructor() { this.collections = new Map(); }
  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection());
    return this.collections.get(name);
  }
}

const report = createMigrationReport("tmdb-legacy-token");
assert.equal(report.provider, "tmdb");
assert.equal(report.legacySecret, LEGACY_SECRET_ID);
assert.match(report.fingerprint, /^sha256:[a-f0-9]{16}$/);
assert.equal(report.maskedValue, "••••oken");
assert.ok(!JSON.stringify(report).includes("tmdb-legacy-token"));
assert.deepEqual(parseArgs(["--apply", "--project=test-project"]), {
  apply: true,
  projectId: "test-project",
});
assert.throws(() => createMigrationReport(""), /TMDB_API_TOKEN is not configured/);

(async () => {
  const db = new FakeDb();
  const values = new Map();
  const vault = {
    async createCredential({ provider, keyId, value }) {
      const secretName = `projects/test/secrets/${provider}-${keyId}`;
      const versionName = `${secretName}/versions/1`;
      values.set(versionName, value);
      return { secretName, versionName };
    },
    async accessCredential({ versionName }) { return values.get(versionName); },
    async disableVersion() {},
    async destroyVersion() {},
    async deleteSecret() {},
  };
  const adapters = {
    tmdb: {
      async test({ secret }) {
        assert.equal(secret, "tmdb-legacy-token");
        return { ok: true, quota: { mode: "unavailable", unit: "requests_per_second" } };
      },
    },
  };
  const imported = await migrateTmdbSecret({ rawValue: "tmdb-legacy-token", db, vault, adapters });
  assert.equal(imported.imported, true);
  assert.ok(!JSON.stringify(imported).includes("tmdb-legacy-token"));
  const duplicate = await migrateTmdbSecret({ rawValue: "tmdb-legacy-token", db, vault, adapters });
  assert.equal(duplicate.skippedExisting, true);
  assert.equal(db.collection("systemApiKeys").docs.size, 1);
})().then(() => {
  console.log("migrateTmdbSecret.test.cjs: all tests passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
