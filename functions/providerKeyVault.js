const crypto = require("crypto");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

const MAX_SECRET_LENGTH = 4096;
const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const KEY_ID_PATTERN = /^[a-f0-9-]{16,80}$/;

function getFirebaseConfigProjectId() {
  const rawConfig = process.env.FIREBASE_CONFIG;
  if (!rawConfig || !rawConfig.trim().startsWith("{")) return null;
  try {
    const parsedConfig = JSON.parse(rawConfig);
    return typeof parsedConfig.projectId === "string" && parsedConfig.projectId.trim()
      ? parsedConfig.projectId.trim()
      : null;
  } catch {
    return null;
  }
}

function getProjectId(explicitProjectId = null) {
  return explicitProjectId || getFirebaseConfigProjectId() || process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || null;
}

function normalizeCredential(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > MAX_SECRET_LENGTH) {
    const error = new Error("Credential value is invalid");
    error.code = "INVALID_CREDENTIAL";
    throw error;
  }
  return normalized;
}

function assertProvider(provider) {
  if (typeof provider !== "string" || !PROVIDER_PATTERN.test(provider)) {
    const error = new Error("Provider is invalid");
    error.code = "INVALID_PROVIDER";
    throw error;
  }
}

function assertKeyId(keyId) {
  if (typeof keyId !== "string" || !KEY_ID_PATTERN.test(keyId)) {
    const error = new Error("Key ID is invalid");
    error.code = "INVALID_KEY_ID";
    throw error;
  }
}

function createCredentialFingerprint(value) {
  return `sha256:${crypto.createHash("sha256").update(normalizeCredential(value)).digest("hex").slice(0, 16)}`;
}

function maskCredential(value) {
  const normalized = normalizeCredential(value);
  return `••••${normalized.slice(-4)}`;
}

function assertSecretVersionReference(versionName, projectName) {
  const parts = String(versionName || '').split('/');
  const referenceProject = parts[1] || '';
  if (parts.length !== 6 || parts[0] !== 'projects' ||
      (referenceProject !== projectName && !/^\d+$/.test(referenceProject)) ||
      parts[2] !== 'secrets' || !parts[3].startsWith('provider-key-') ||
      parts[4] !== 'versions' || !/^\d+$/.test(parts[5])) {
    throw new Error(`Secret version reference is invalid (expected project ${projectName || 'unknown'}, actual project ${parts[1] || 'unknown'})`);
  }
}

function normalizeSecretVersionReference(versionName, projectName) {
  assertSecretVersionReference(versionName, projectName);
  const parts = String(versionName).split('/');
  return `projects/${projectName}/secrets/${parts[3]}/versions/${parts[5]}`;
}

function createOpaqueKeyId(randomUUID = crypto.randomUUID) {
  const id = String(randomUUID()).toLowerCase().replace(/[^a-f0-9-]/g, "");
  if (!KEY_ID_PATTERN.test(id)) {
    throw new Error("Generated key ID is invalid");
  }
  return id;
}

function createProviderKeyVault({ client = new SecretManagerServiceClient(), projectId = getProjectId() } = {}) {
  if (!projectId) throw new Error("Google Cloud project ID is not configured");
  if (!client || typeof client.createSecret !== "function" ||
      typeof client.addSecretVersion !== "function") {
    throw new Error("Secret Manager client is not configured");
  }

  const projectName = `projects/${projectId}`;
  const secretName = (provider, keyId) => {
    assertProvider(provider);
    assertKeyId(keyId);
    return `${projectName}/secrets/provider-key-${provider}-${keyId}`;
  };

  return {
    async createCredential({ provider, keyId, value }) {
      const normalized = normalizeCredential(value);
      const name = secretName(provider, keyId);
      const secretId = name.slice(`${projectName}/secrets/`.length);
      const [secret] = await client.createSecret({
        parent: projectName,
        secretId,
        secret: { replication: { automatic: {} } },
      });
      try {
        const [version] = await client.addSecretVersion({
          parent: secret.name || name,
          payload: { data: Buffer.from(normalized, "utf8") },
        });
        const versionParts = String(version?.name || "").split("/");
        if (!/^\d+$/.test(versionParts[5])) throw new Error("Secret version response is invalid");
        return {
          secretName: name,
          versionName: `${name}/versions/${versionParts[5]}`,
        };
      } catch (error) {
        if (typeof client.deleteSecret === "function") {
          try {
            await client.deleteSecret({ name: secret.name || name });
          } catch {
            // Keep the original failure; the orphaned empty secret is operator-visible.
          }
        }
        throw error;
      }
    },

    async accessCredential({ versionName }) {
      const canonicalVersionName = normalizeSecretVersionReference(versionName, projectId);
      const [version] = await client.accessSecretVersion({ name: canonicalVersionName });
      const data = version?.payload?.data;
      if (data === undefined || data === null) throw new Error("Secret value is empty");
      return Buffer.isBuffer(data) ? data.toString("utf8") : Buffer.from(data).toString("utf8");
    },

    async disableVersion(versionName) {
      const canonicalVersionName = normalizeSecretVersionReference(versionName, projectId);
      return client.disableSecretVersion({ name: canonicalVersionName });
    },

    async destroyVersion(versionName) {
      const canonicalVersionName = normalizeSecretVersionReference(versionName, projectId);
      return client.destroySecretVersion({ name: canonicalVersionName });
    },

    async deleteSecret(secretNameValue) {
      const parts = String(secretNameValue || "").split("/");
      const referenceProject = parts[1] || "";
      if (parts.length !== 4 || parts[0] !== "projects" ||
          (referenceProject !== projectId && !/^\d+$/.test(referenceProject)) ||
          parts[2] !== "secrets" || !parts[3].startsWith("provider-key-")) {
        throw new Error("Secret reference is invalid");
      }
      if (typeof client.deleteSecret !== "function") return null;
      return client.deleteSecret({ name: `${projectName}/secrets/${parts[3]}` });
    },
  };
}

module.exports = {
  MAX_SECRET_LENGTH,
  assertKeyId,
  assertProvider,
  createCredentialFingerprint,
  createOpaqueKeyId,
  createProviderKeyVault,
  getFirebaseConfigProjectId,
  getProjectId,
  maskCredential,
  normalizeSecretVersionReference,
  normalizeCredential,
  assertSecretVersionReference,
};
