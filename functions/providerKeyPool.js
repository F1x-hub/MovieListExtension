const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_UNAVAILABLE_TTL_MS = 30_000;
const PROVIDER_KEY_COLLECTION = "systemApiKeys";

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && Number.isFinite(value.seconds)) return value.seconds * 1000;
  return Date.now();
}

function normalizeRegistryEntry(doc) {
  const data = typeof doc.data === "function" ? doc.data() : doc;
  const keyId = String(data?.keyId || doc.id || "").trim();
  const versionName = String(data?.secretVersionName || data?.versionName || "").trim();
  if (!keyId || !versionName) return null;

  return {
    keyId,
    provider: String(data?.provider || "").trim(),
    status: String(data?.status || "").trim(),
    versionName,
  };
}

function createProviderKeyPool({
  db,
  vault,
  provider = "kinopoisk",
  now = () => Date.now(),
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  unavailableTtlMs = DEFAULT_UNAVAILABLE_TTL_MS,
  logger = console,
} = {}) {
  if (!db || typeof db.collection !== "function") {
    throw new Error("A Firestore database is required");
  }
  if (!vault || typeof vault.accessCredential !== "function") {
    throw new Error("A provider key vault is required");
  }

  let cache = null;
  let cacheExpiresAt = 0;
  let loadPromise = null;
  const unavailableUntil = new Map();
  const lastUsedAt = new Map();
  let selectionSequence = 0;

  async function loadEntries() {
    const snapshot = await db.collection(PROVIDER_KEY_COLLECTION).get();
    const providerEntries = (snapshot.docs || [])
      .map(normalizeRegistryEntry)
      .filter((entry) => entry && entry.provider === provider);
    const registryEntries = providerEntries.filter((entry) => entry.status === "active");

    const entries = [];
    await Promise.all(registryEntries.map(async (entry) => {
      try {
        const value = await vault.accessCredential({ versionName: entry.versionName });
        if (typeof value !== "string" || !value.trim()) return;
        entries.push({
          keyId: entry.keyId,
          provider: entry.provider,
          value,
          versionName: entry.versionName,
        });
      } catch (error) {
        logger.warn?.(
          `[providerKeyPool] Credential access failed: keyId=${entry.keyId} ` +
          `code=${error?.code || "none"} message=${error?.message || "unknown error"}`
        );
      }
    }));

    entries.sort((left, right) => left.keyId.localeCompare(right.keyId));
    return {
      entries,
      configuredCount: registryEntries.length,
      registeredCount: providerEntries.length,
      loadedAt: toMillis(now()),
    };
  }

  async function getCache() {
    const currentTime = toMillis(now());
    if (cache && currentTime < cacheExpiresAt) return cache;
    if (!loadPromise) {
      loadPromise = loadEntries()
        .then((nextCache) => {
          cache = nextCache;
          cacheExpiresAt = toMillis(now()) + cacheTtlMs;
          return cache;
        })
        .finally(() => {
          loadPromise = null;
        });
    }
    return loadPromise;
  }

  function sortByUse(left, right) {
    const leftUsed = lastUsedAt.get(left.keyId) || 0;
    const rightUsed = lastUsedAt.get(right.keyId) || 0;
    if (leftUsed !== rightUsed) return leftUsed - rightUsed;
    return left.keyId.localeCompare(right.keyId);
  }

  async function getActiveKeys() {
    const state = await getCache();
    const currentTime = toMillis(now());
    const keys = state.entries
      .filter((entry) => (unavailableUntil.get(entry.keyId) || 0) <= currentTime)
      .sort(sortByUse)
      .map((entry) => ({
        keyId: entry.keyId,
        provider: entry.provider,
        value: entry.value,
      }));
    return {
      keys,
      configuredCount: state.configuredCount,
      registeredCount: state.registeredCount,
    };
  }

  function reportOutcome({ keyId, outcome }) {
    if (!keyId) return;
    if (outcome === "rejected") {
      unavailableUntil.set(keyId, toMillis(now()) + unavailableTtlMs);
      return;
    }
    if (outcome === "success") {
      unavailableUntil.delete(keyId);
      selectionSequence += 1;
      lastUsedAt.set(keyId, toMillis(now()) + selectionSequence);
    }
  }

  function invalidate() {
    cache = null;
    cacheExpiresAt = 0;
  }

  function getState() {
    return {
      cached: Boolean(cache),
      cacheExpiresAt,
      unavailableKeyIds: [...unavailableUntil.keys()],
    };
  }

  return {
    getActiveKeys,
    reportOutcome,
    invalidate,
    getState,
  };
}

module.exports = {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_UNAVAILABLE_TTL_MS,
  PROVIDER_KEY_COLLECTION,
  createProviderKeyPool,
  normalizeRegistryEntry,
};
