const KINOPOISK_TOKEN_URL = "https://api.poiskkino.dev/v1.5/token";
const TMDB_AUTHENTICATION_URL = "https://api.themoviedb.org/3/authentication";

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function getQuotaStatus(percent) {
  if (percent === null) return "unavailable";
  if (percent >= 90) return "critical";
  if (percent >= 70) return "warning";
  return "normal";
}

function normalizeKinopoiskQuota(payload, measuredAt = new Date()) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const limit = numberOrNull(data?.requestsLimit);
  const used = numberOrNull(data?.requestsUsed);
  const remaining = numberOrNull(data?.requestsRemaining);
  const effectiveRemaining = remaining !== null
    ? remaining
    : limit !== null && used !== null ? Math.max(0, limit - used) : null;
  const percent = limit !== null && effectiveRemaining !== null
    ? Math.round(((limit - effectiveRemaining) / limit) * 1000) / 10
    : null;

  return {
    mode: limit !== null || effectiveRemaining !== null ? "provider_exact" : "unavailable",
    unit: limit !== null ? "requests" : null,
    used,
    limit,
    remaining: effectiveRemaining,
    status: getQuotaStatus(percent),
    measuredAt: measuredAt.toISOString(),
    stale: false,
  };
}

function createProviderError(code, message = "Provider credential check failed") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createKinopoiskAdapter({ fetchImpl = (...args) => fetch(...args) } = {}) {
  return {
    async test({ secret }) {
      const response = await fetchImpl(KINOPOISK_TOKEN_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-API-KEY": secret,
        },
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        throw createProviderError(
          response.status === 401 || response.status === 403 ? "INVALID_CREDENTIAL" : "PROVIDER_UNAVAILABLE"
        );
      }
      return {
        ok: true,
        quota: normalizeKinopoiskQuota(payload),
      };
    },

    async quota({ secret }) {
      return (await this.test({ secret })).quota;
    },
  };
}

function createTmdbQuota(measuredAt = new Date()) {
  return {
    mode: "unavailable",
    unit: "requests_per_second",
    used: null,
    limit: null,
    remaining: null,
    status: "unavailable",
    measuredAt: measuredAt.toISOString(),
    stale: false,
  };
}

function createTmdbAdapter({ fetchImpl = (...args) => fetch(...args) } = {}) {
  return {
    async test({ secret }) {
      const response = await fetchImpl(TMDB_AUTHENTICATION_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${secret}`,
        },
      });
      if (!response.ok) {
        throw createProviderError(
          response.status === 401 || response.status === 403 ? "INVALID_CREDENTIAL" : "PROVIDER_UNAVAILABLE"
        );
      }
      return {
        ok: true,
        quota: createTmdbQuota(),
      };
    },

    async quota({ secret }) {
      return (await this.test({ secret })).quota;
    },
  };
}

function getProviderAdapter(provider, options = {}) {
  if (provider === "kinopoisk") return createKinopoiskAdapter(options);
  if (provider === "tmdb") return createTmdbAdapter(options);
  return {
    async test() {
      throw createProviderError("PROVIDER_UNSUPPORTED", "Provider is not enabled");
    },
    async quota() {
      return {
        mode: "unavailable",
        unit: null,
        used: null,
        limit: null,
        remaining: null,
        status: "unavailable",
        measuredAt: new Date().toISOString(),
        stale: true,
      };
    },
  };
}

module.exports = {
  KINOPOISK_TOKEN_URL,
  TMDB_AUTHENTICATION_URL,
  createKinopoiskAdapter,
  createTmdbAdapter,
  createTmdbQuota,
  getProviderAdapter,
  normalizeKinopoiskQuota,
};
