const assert = require("node:assert/strict");
const { createProviderKeyPool } = require("../functions/providerKeyPool");

class FakeDb {
  constructor(docs) {
    this.docs = docs;
    this.reads = 0;
  }

  collection(name) {
    assert.equal(name, "systemApiKeys");
    return {
      get: async () => {
        this.reads += 1;
        return {
          docs: this.docs.map((data, index) => ({ id: data.keyId || `doc-${index}`, data: () => data })),
        };
      },
    };
  }
}

async function run() {
  let now = 1_000;
  const db = new FakeDb([
    { keyId: "key-b", provider: "kinopoisk", status: "active", secretVersionName: "version-b" },
    { keyId: "key-a", provider: "kinopoisk", status: "active", secretVersionName: "version-a" },
    { keyId: "key-disabled", provider: "kinopoisk", status: "disabled", secretVersionName: "version-disabled" },
    { keyId: "tmdb-key", provider: "tmdb", status: "active", secretVersionName: "version-tmdb" },
  ]);
  const accesses = [];
  const vault = {
    async accessCredential({ versionName }) {
      accesses.push(versionName);
      return `value-${versionName}`;
    },
  };
  const pool = createProviderKeyPool({
    db,
    vault,
    now: () => now,
    cacheTtlMs: 5_000,
    unavailableTtlMs: 30_000,
  });

  const [first, second] = await Promise.all([pool.getActiveKeys(), pool.getActiveKeys()]);
  assert.deepEqual(first.keys.map((entry) => entry.keyId), ["key-a", "key-b"]);
  assert.deepEqual(second.keys.map((entry) => entry.keyId), ["key-a", "key-b"]);
  assert.equal(first.configuredCount, 2);
  assert.equal(first.registeredCount, 3, "Pool tracks disabled registrations so legacy fallback cannot bypass them");
  assert.equal(db.reads, 1, "Concurrent cache misses must share one Firestore read");
  assert.deepEqual(accesses.sort(), ["version-a", "version-b"]);

  pool.reportOutcome({ keyId: "key-a", outcome: "success" });
  let state = await pool.getActiveKeys();
  assert.deepEqual(state.keys.map((entry) => entry.keyId), ["key-b", "key-a"]);

  pool.reportOutcome({ keyId: "key-b", outcome: "rejected" });
  state = await pool.getActiveKeys();
  assert.deepEqual(state.keys.map((entry) => entry.keyId), ["key-a"]);
  assert.deepEqual(pool.getState().unavailableKeyIds, ["key-b"]);

  now = 31_001;
  state = await pool.getActiveKeys();
  assert.deepEqual(state.keys.map((entry) => entry.keyId), ["key-b", "key-a"]);

  now = 40_000;
  db.docs.push({ keyId: "key-c", provider: "kinopoisk", status: "active", secretVersionName: "version-c" });
  pool.invalidate();
  state = await pool.getActiveKeys();
  assert.deepEqual(state.keys.map((entry) => entry.keyId), ["key-b", "key-c", "key-a"]);
  assert.equal(db.reads, 3, "Invalidate must force one bounded registry refresh");
  assert.ok(!JSON.stringify(state).includes("secretVersionName"), "Runtime DTO must not expose registry field names");

  const tmdbPool = createProviderKeyPool({ db, vault, provider: "tmdb", now: () => now });
  const tmdbState = await tmdbPool.getActiveKeys();
  assert.deepEqual(tmdbState.keys.map((entry) => entry.keyId), ["tmdb-key"]);
  assert.equal(tmdbState.registeredCount, 1);

  console.log("providerKeyPool.test.cjs: all tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
