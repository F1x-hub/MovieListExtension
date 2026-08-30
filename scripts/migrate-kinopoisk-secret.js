const path = require("path");
const { createRequire } = require("module");
const functionsRequire = createRequire(path.join(__dirname, "..", "functions", "package.json"));
const { initializeApp } = functionsRequire("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore");
const {
  createCredentialFingerprint,
  createOpaqueKeyId,
  createProviderKeyVault,
  maskCredential,
} = require("../functions/providerKeyVault");

const KEY_COLLECTION = "systemApiKeys";

function parseArgs(argv = []) {
  return {
    apply: argv.includes("--apply"),
    projectId: argv
      .find((argument) => argument.startsWith("--project="))
      ?.slice("--project=".length) || null,
  };
}

function parseRawKinopoiskKeys(rawValue) {
  if (Array.isArray(rawValue)) return rawValue.map((value) => String(value || "").trim()).filter(Boolean);

  const raw = String(rawValue || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((value) => String(value || "").trim()).filter(Boolean);
    }
  } catch {
    // Allow newline/comma separated values for operator-provided migration input.
  }
  return raw.split(/[\r\n,]+/).map((value) => value.trim()).filter(Boolean);
}

function createMigrationReport(rawValue) {
  const normalizedKeys = parseRawKinopoiskKeys(rawValue);
  const fingerprints = normalizedKeys.map((value) => createCredentialFingerprint(value));
  const uniqueFingerprints = [...new Set(fingerprints)];
  return {
    provider: "kinopoisk",
    inputCount: fingerprints.length,
    uniqueCount: uniqueFingerprints.length,
    duplicateCount: fingerprints.length - uniqueFingerprints.length,
    fingerprints: uniqueFingerprints,
  };
}

async function migrateKinopoiskSecret({ rawValue, db, vault, now = () => new Date() }) {
  const normalizedKeys = parseRawKinopoiskKeys(rawValue);
  const seenFingerprints = new Set();
  const imported = [];
  let skippedExistingCount = 0;

  for (const value of normalizedKeys) {
    const fingerprint = createCredentialFingerprint(value);
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);

    const existing = await db.collection(KEY_COLLECTION)
      .where('fingerprint', '==', fingerprint)
      .limit(1)
      .get();
    if (!existing.empty) {
      skippedExistingCount += 1;
      continue;
    }

    const keyId = createOpaqueKeyId();
    const secretReference = await vault.createCredential({
      provider: "kinopoisk",
      keyId,
      value,
    });
    try {
      await db.collection(KEY_COLLECTION).doc(keyId).set({
        keyId,
        provider: "kinopoisk",
        label: `Imported Kinopoisk key ${imported.length + 1}`,
        purpose: "Migrated from KINOPOISK_API_KEYS",
        fingerprint,
        maskedValue: maskCredential(value),
        status: "active",
        secretName: secretReference.secretName,
        secretVersionName: secretReference.versionName,
        source: "aggregate-secret-migration",
        createdAt: now(),
        updatedAt: now(),
      });
    } catch (error) {
      try {
        await vault.destroyVersion(secretReference.versionName);
        await vault.deleteSecret(secretReference.secretName);
      } catch {
        // Preserve the metadata write failure; orphan cleanup is operator-visible.
      }
      throw error;
    }

    imported.push({
      keyId,
      fingerprint,
      maskedValue: maskCredential(value),
    });
  }

  return {
    provider: "kinopoisk",
    importedCount: imported.length,
    skippedExistingCount,
    imported,
  };
}

async function run(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const rawValue = env.KINOPOISK_API_KEYS || "";
  if (!rawValue.trim()) throw new Error("KINOPOISK_API_KEYS is not configured");

  const report = createMigrationReport(rawValue);
  if (!options.apply) {
    console.log(JSON.stringify({ mode: "dry-run", ...report }, null, 2));
    return report;
  }

  const projectId = options.projectId || env.GCLOUD_PROJECT || env.GCP_PROJECT || env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error("--project or a Google Cloud project environment variable is required");

  initializeApp({ projectId });
  const db = getFirestore();
  const vault = createProviderKeyVault({ projectId });
  const result = await migrateKinopoiskSecret({ rawValue, projectId, db, vault });
  console.log(JSON.stringify({ mode: "apply", ...result }, null, 2));
  return result;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error?.message || "Kinopoisk secret migration failed");
    process.exitCode = 1;
  });
}

module.exports = {
  KEY_COLLECTION,
  createMigrationReport,
  migrateKinopoiskSecret,
  parseArgs,
  parseRawKinopoiskKeys,
  run,
};
