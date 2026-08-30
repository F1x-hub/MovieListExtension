const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createMigrationReport,
  parseArgs,
} = require("../scripts/migrate-kinopoisk-secret");

const report = createMigrationReport("secret-one\nsecret-two\nsecret-one");
assert.equal(report.inputCount, 3);
assert.equal(report.uniqueCount, 2);
assert.equal(report.duplicateCount, 1);
assert.equal(report.fingerprints.length, 2);
assert.ok(!JSON.stringify(report).includes("secret-one"));
assert.ok(!JSON.stringify(report).includes("secret-two"));
assert.deepEqual(parseArgs(["--apply", "--project=test-project"]), {
  apply: true,
  projectId: "test-project",
});

const rules = fs.readFileSync(path.join(__dirname, "..", "rules", "firestore.rules"), "utf8");
assert.match(rules, /match \/systemApiKeys\/{keyId}/);
assert.match(rules, /match \/systemApiKeyAuditLogs\/{eventId}/);
assert.match(rules, /allow create, update, delete: if false;/);

console.log("migrateKinopoiskSecret.test.cjs: all tests passed");
