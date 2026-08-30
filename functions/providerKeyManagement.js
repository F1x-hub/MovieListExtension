const crypto = require("crypto");
const {
  createCredentialFingerprint,
  createOpaqueKeyId,
  maskCredential,
  normalizeCredential,
} = require("./providerKeyVault");
const { getProviderAdapter } = require("./providerQuotaAdapters");

const KEY_COLLECTION = "systemApiKeys";
const AUDIT_COLLECTION = "systemApiKeyAuditLogs";
const SUPPORTED_PROVIDERS = new Set(["kinopoisk", "tmdb"]);
const ALLOWED_STATUS = new Set(["active", "disabled", "invalid", "quota_exhausted"]);

function createManagementError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function validateText(value, name, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw createManagementError("INVALID_INPUT", `${name} is invalid`);
  }
  return normalized;
}

function validateProvider(provider) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw createManagementError("PROVIDER_UNSUPPORTED", "Provider is not enabled");
  }
  return provider;
}

function createSafeKeyDto(id, data = {}) {
  return {
    id,
    provider: data.provider || null,
    label: data.label || "",
    purpose: data.purpose || "",
    status: data.status || "disabled",
    fingerprint: data.fingerprint || null,
    maskedValue: data.maskedValue || null,
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt || null,
    createdBy: data.createdBy || null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || data.updatedAt || null,
    lastCheckedAt: data.lastCheckedAt?.toDate?.()?.toISOString?.() || data.lastCheckedAt || null,
    lastSuccessAt: data.lastSuccessAt?.toDate?.()?.toISOString?.() || data.lastSuccessAt || null,
    lastFailureAt: data.lastFailureAt?.toDate?.()?.toISOString?.() || data.lastFailureAt || null,
    lastErrorCode: data.lastErrorCode || null,
    quota: data.quota || null,
  };
}

function toSafeError(error) {
  if (error?.statusCode === 401) {
    return createManagementError("AUTH_REQUIRED", "Authentication is required", 401);
  }
  if (error?.statusCode === 403) {
    return createManagementError("ADMIN_REQUIRED", "Admin access is required", 403);
  }
  if (error?.statusCode && error?.code) return error;
  const safeCodes = new Set([
    "DUPLICATE_KEY",
    "INVALID_CREDENTIAL",
    "INVALID_INPUT",
    "INVALID_KEY_ID",
    "INVALID_PROVIDER",
    "INVALID_STATUS",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_UNSUPPORTED",
    "SECRET_REVOKE_FAILED",
  ]);
  if (safeCodes.has(error?.code)) {
    return createManagementError(
      error.code,
      error.code === "INVALID_CREDENTIAL" ? "Provider rejected this credential" :
        error.code === "PROVIDER_UNAVAILABLE" ? "Provider is temporarily unavailable" :
          error.code === "PROVIDER_UNSUPPORTED" ? "Provider is not enabled" :
            error.message || "Provider key operation failed",
      error.code === "DUPLICATE_KEY" ? 409 : error.code === "SECRET_REVOKE_FAILED" ? 500 : 400
    );
  }
  return createManagementError("PROVIDER_KEY_OPERATION_FAILED", "Provider key operation failed", 500);
}

function createProviderKeyManagementService({
  db,
  vault,
  adapters = {},
  now = () => new Date(),
  randomUUID = crypto.randomUUID,
}) {
  if (!db || typeof db.collection !== "function") throw new Error("Firestore client is not configured");
  if (!vault) throw new Error("Provider key vault is not configured");

  const getAdapter = (provider) => adapters[provider] || getProviderAdapter(provider);
  const getDoc = (keyId) => db.collection(KEY_COLLECTION).doc(keyId);

  async function audit({ actorUid, keyId, provider, action, result, errorCode = null }) {
    const eventId = randomUUID();
    await db.collection(AUDIT_COLLECTION).doc(eventId).set({
      actorUid: actorUid || null,
      keyId,
      provider,
      action,
      result,
      errorCode,
      createdAt: now(),
    });
  }

  async function getKey(keyId) {
    if (typeof keyId !== "string" || !keyId) throw createManagementError("INVALID_KEY_ID", "Key ID is invalid");
    const snapshot = await getDoc(keyId).get();
    if (!snapshot.exists) throw createManagementError("KEY_NOT_FOUND", "Provider key was not found", 404);
    return { ref: getDoc(keyId), snapshot, data: snapshot.data() || {} };
  }

  async function listProviderKeys() {
    const snapshot = await db.collection(KEY_COLLECTION).get();
    return snapshot.docs
      .map((doc) => createSafeKeyDto(doc.id, doc.data()))
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  }

  async function addProviderKey({ provider, label, purpose, secret, actorUid }) {
    const normalizedProvider = validateProvider(provider);
    const normalizedLabel = validateText(label, "Label", 80);
    const normalizedPurpose = validateText(purpose, "Purpose", 160);
    const normalizedSecret = normalizeCredential(secret);
    const fingerprint = createCredentialFingerprint(normalizedSecret);
    const duplicateSnapshot = await db.collection(KEY_COLLECTION)
      .where("fingerprint", "==", fingerprint)
      .limit(1)
      .get();
    if (!duplicateSnapshot.empty) throw createManagementError("DUPLICATE_KEY", "This provider key is already registered", 409);

    const keyId = createOpaqueKeyId(randomUUID);
    const adapter = getAdapter(normalizedProvider);
    let probe;
    try {
      probe = await adapter.test({ secret: normalizedSecret });
    } catch (error) {
      await audit({ actorUid, keyId, provider: normalizedProvider, action: "add", result: "rejected", errorCode: error?.code || "PROVIDER_KEY_OPERATION_FAILED" });
      throw toSafeError(error);
    }

    let vaultResult = null;
    try {
      vaultResult = await vault.createCredential({ provider: normalizedProvider, keyId, value: normalizedSecret });
      const timestamp = now();
      const data = {
        provider: normalizedProvider,
        label: normalizedLabel,
        purpose: normalizedPurpose,
        status: "active",
        fingerprint,
        maskedValue: maskCredential(normalizedSecret),
        secretName: vaultResult.secretName,
        secretVersionName: vaultResult.versionName,
        createdAt: timestamp,
        createdBy: actorUid || null,
        updatedAt: timestamp,
        lastCheckedAt: timestamp,
        lastSuccessAt: timestamp,
        lastFailureAt: null,
        lastErrorCode: null,
        quota: probe?.quota || null,
      };
      await getDoc(keyId).set(data);
      await audit({ actorUid, keyId, provider: normalizedProvider, action: "add", result: "success" });
      return createSafeKeyDto(keyId, data);
    } catch (error) {
      if (vaultResult?.versionName) {
        try { await vault.destroyVersion(vaultResult.versionName); } catch { /* operator cleanup remains visible */ }
      }
      if (vaultResult?.secretName) {
        try { await vault.deleteSecret(vaultResult.secretName); } catch { /* operator cleanup remains visible */ }
      }
      await audit({ actorUid, keyId, provider: normalizedProvider, action: "add", result: "failed", errorCode: "PROVIDER_KEY_OPERATION_FAILED" });
      throw toSafeError(error);
    }
  }

  async function testProviderKey({ keyId, actorUid, auditAction = "test" }) {
    const key = await getKey(keyId);
    const adapter = getAdapter(key.data.provider);
    const timestamp = now();
    try {
      const secret = await vault.accessCredential({ versionName: key.data.secretVersionName });
      const result = await adapter.test({ secret });
      await key.ref.update({
        status: "active",
        lastCheckedAt: timestamp,
        lastSuccessAt: timestamp,
        lastFailureAt: null,
        lastErrorCode: null,
        quota: result?.quota || null,
        updatedAt: timestamp,
      });
      await audit({ actorUid, keyId, provider: key.data.provider, action: auditAction, result: "success" });
      return createSafeKeyDto(keyId, { ...key.data, status: "active", lastCheckedAt: timestamp, lastSuccessAt: timestamp, lastFailureAt: null, lastErrorCode: null, quota: result?.quota || null, updatedAt: timestamp });
    } catch (error) {
      const errorCode = error?.code || "PROVIDER_KEY_OPERATION_FAILED";
      console.error(
        `[providerKeyManagement] Test failed: keyId=${keyId} ` +
        `code=${error?.code || "none"} message=${error?.message || "unknown error"}`
      );
      await key.ref.update({ status: errorCode === "INVALID_CREDENTIAL" ? "invalid" : "disabled", lastCheckedAt: timestamp, lastFailureAt: timestamp, lastErrorCode: errorCode, updatedAt: timestamp });
      await audit({ actorUid, keyId, provider: key.data.provider, action: auditAction, result: "failed", errorCode });
      throw toSafeError(error);
    }
  }

  async function setProviderKeyStatus({ keyId, status, actorUid }) {
    if (!ALLOWED_STATUS.has(status) || !["active", "disabled"].includes(status)) {
      throw createManagementError("INVALID_STATUS", "Provider key status is invalid");
    }
    const key = await getKey(keyId);
    const timestamp = now();
    if (status === "active") {
      await testProviderKey({ keyId, actorUid, auditAction: "enable" });
      return getKey(keyId).then(({ data }) => createSafeKeyDto(keyId, data));
    }
    await key.ref.update({ status, updatedAt: timestamp });
    await audit({ actorUid, keyId, provider: key.data.provider, action: "disable", result: "success" });
    return createSafeKeyDto(keyId, { ...key.data, status, updatedAt: timestamp });
  }

  async function revokeProviderKey({ keyId, actorUid }) {
    const key = await getKey(keyId);
    const timestamp = now();
    await key.ref.update({ status: "disabled", updatedAt: timestamp, revokedAt: timestamp, revokedBy: actorUid || null });
    try {
      await vault.disableVersion(key.data.secretVersionName);
      await vault.destroyVersion(key.data.secretVersionName);
      await audit({ actorUid, keyId, provider: key.data.provider, action: "revoke", result: "success" });
      return createSafeKeyDto(keyId, { ...key.data, status: "disabled", updatedAt: timestamp, revokedAt: timestamp, revokedBy: actorUid || null });
    } catch (error) {
      await audit({ actorUid, keyId, provider: key.data.provider, action: "revoke", result: "failed", errorCode: "SECRET_REVOKE_FAILED" });
      throw createManagementError("SECRET_REVOKE_FAILED", "Provider key was disabled but could not be fully revoked", 500);
    }
  }

  async function getProviderKeyQuota({ keyId, actorUid }) {
    const key = await getKey(keyId);
    try {
      const secret = await vault.accessCredential({ versionName: key.data.secretVersionName });
      const quota = await getAdapter(key.data.provider).quota({ secret });
      const timestamp = now();
      await key.ref.update({ quota, lastCheckedAt: timestamp, updatedAt: timestamp });
      await audit({ actorUid, keyId, provider: key.data.provider, action: "quota", result: "success" });
      return quota;
    } catch (error) {
      console.error(
        `[providerKeyManagement] Quota failed: keyId=${keyId} ` +
        `code=${error?.code || "none"} message=${error?.message || "unknown error"}`
      );
      await audit({ actorUid, keyId, provider: key.data.provider, action: "quota", result: "failed", errorCode: error?.code || "PROVIDER_KEY_OPERATION_FAILED" });
      throw toSafeError(error);
    }
  }

  return {
    addProviderKey,
    getProviderKeyQuota,
    listProviderKeys,
    revokeProviderKey,
    setProviderKeyStatus,
    testProviderKey,
  };
}

function getRequestBody(req) {
  if (req?.body && typeof req.body === "object") return req.body;
  if (typeof req?.body === "string" && req.body.trim()) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function createProviderKeyManagementHandler({ service, verifyAdminRequest, setCors }) {
  if (!service || typeof verifyAdminRequest !== "function" || typeof setCors !== "function") {
    throw new Error("Provider key management dependencies are not configured");
  }
  return async (req, res) => {
    if (!setCors(req, res)) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (!["GET", "POST"].includes(req.method)) {
      res.status(405).json({ error: "Only GET and POST requests are supported" });
      return;
    }

    try {
      const decodedToken = await verifyAdminRequest(req);
      const body = getRequestBody(req);
      const action = String(req.query?.action || body.action || (req.method === "GET" ? "list" : "")).trim();
      const actorUid = decodedToken.uid;
      let result;
      if (action === "list") result = await service.listProviderKeys();
      else if (action === "add") result = await service.addProviderKey({ ...body, actorUid });
      else if (action === "test") result = await service.testProviderKey({ keyId: body.keyId || req.query?.keyId, actorUid });
      else if (action === "enable") result = await service.setProviderKeyStatus({ keyId: body.keyId || req.query?.keyId, status: "active", actorUid });
      else if (action === "disable") result = await service.setProviderKeyStatus({ keyId: body.keyId || req.query?.keyId, status: "disabled", actorUid });
      else if (action === "revoke") result = await service.revokeProviderKey({ keyId: body.keyId || req.query?.keyId, actorUid });
      else if (action === "quota") result = await service.getProviderKeyQuota({ keyId: body.keyId || req.query?.keyId, actorUid });
      else throw createManagementError("INVALID_ACTION", "Provider key action is invalid");
      const safeResult = action === "list"
        ? result.map((item) => createSafeKeyDto(item.id, item))
        : action === "quota"
          ? result
          : createSafeKeyDto(result.id, result);
      res.set("Cache-Control", "no-store");
      res.status(200).json({ data: safeResult });
    } catch (error) {
      const safeError = toSafeError(error);
      const statusCode = Number.isInteger(safeError.statusCode) ? safeError.statusCode : 500;
      if (statusCode >= 500) {
        console.error("[providerKeyManagement] Operation failed:", {
          code: safeError.code,
          statusCode,
          causeCode: error?.code || null,
          causeMessage: error?.message || "unknown error",
        });
      }
      res.status(statusCode).json({ error: { code: safeError.code || "PROVIDER_KEY_OPERATION_FAILED", message: safeError.message } });
    }
  };
}

module.exports = {
  AUDIT_COLLECTION,
  KEY_COLLECTION,
  SUPPORTED_PROVIDERS,
  createProviderKeyManagementHandler,
  createProviderKeyManagementService,
  createSafeKeyDto,
};
