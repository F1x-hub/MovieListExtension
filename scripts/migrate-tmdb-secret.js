const path = require("path");
const { createRequire } = require("module");
const functionsRequire = createRequire(path.join(__dirname, "..", "functions", "package.json"));
const { initializeApp, getApps } = functionsRequire("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore");
const { SecretManagerServiceClient } = functionsRequire("@google-cloud/secret-manager");
const { createCredentialFingerprint, maskCredential, createProviderKeyVault } = require("../functions/providerKeyVault");
const { createProviderKeyManagementService } = require("../functions/providerKeyManagement");

const KEY_COLLECTION = "systemApiKeys";
const LEGACY_SECRET_ID = "TMDB_API_TOKEN";

function parseArgs(argv = []) {
  return {
    apply: argv.includes("--apply"),
    projectId: argv
      .find((argument) => argument.startsWith("--project="))
      ?.slice("--project=".length) || null,
  };
}

function createMigrationReport(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) throw new Error("TMDB_API_TOKEN is not configured");
  return {
    provider: "tmdb",
    legacySecret: LEGACY_SECRET_ID,
    fingerprint: createCredentialFingerprint(value),
    maskedValue: maskCredential(value),
  };
}

async function readLegacyTmdbToken({ projectId, secretManagerClient }) {
  const [version] = await secretManagerClient.accessSecretVersion({
    name: `projects/${projectId}/secrets/${LEGACY_SECRET_ID}/versions/latest`,
  });
  const value = version?.payload?.data?.toString("utf8") || "";
  if (!value.trim()) throw new Error("TMDB_API_TOKEN is not configured");
  return value.trim();
}

async function migrateTmdbSecret({ rawValue, db, vault, adapters = {}, actorUid = "migration:tmdb-legacy" }) {
  const report = createMigrationReport(rawValue);
  const existing = await db.collection(KEY_COLLECTION)
    .where("fingerprint", "==", report.fingerprint)
    .limit(1)
    .get();
  if (!existing.empty) {
    return { ...report, imported: false, skippedExisting: true };
  }

  const service = createProviderKeyManagementService({ db, vault, adapters });
  const imported = await service.addProviderKey({
    provider: "tmdb",
    label: "Legacy TMDB token",
    purpose: "Migrated from TMDB_API_TOKEN",
    secret: rawValue,
    actorUid,
  });
  await db.collection(KEY_COLLECTION).doc(imported.id).update({
    source: "legacy-secret-migration",
  });
  return { ...report, imported: true, skippedExisting: false, keyId: imported.id };
}

async function run(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  const options = parseArgs(argv);
  const projectId = options.projectId || env.GCLOUD_PROJECT || env.GCP_PROJECT || env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error("--project or a Google Cloud project environment variable is required");

  const secretManagerClient = dependencies.secretManagerClient || new SecretManagerServiceClient();
  const rawValue = await readLegacyTmdbToken({ projectId, secretManagerClient });
  const report = createMigrationReport(rawValue);
  if (!options.apply) {
    console.log(JSON.stringify({ mode: "dry-run", ...report }, null, 2));
    return report;
  }

  const app = getApps()[0] || initializeApp({ projectId });
  const db = dependencies.db || getFirestore(app);
  const vault = dependencies.vault || createProviderKeyVault({ projectId });
  const result = await migrateTmdbSecret({ rawValue, db, vault });
  console.log(JSON.stringify({ mode: "apply", ...result }, null, 2));
  return result;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`TMDB secret migration failed (${error?.code || "UNKNOWN"})`);
    process.exitCode = 1;
  });
}

module.exports = {
  KEY_COLLECTION,
  LEGACY_SECRET_ID,
  createMigrationReport,
  migrateTmdbSecret,
  parseArgs,
  readLegacyTmdbToken,
  run,
};
