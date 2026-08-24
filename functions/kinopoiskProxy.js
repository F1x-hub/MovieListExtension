const KINOPOISK_ORIGIN = "https://api.poiskkino.dev";
const KINOPOISK_API_PREFIX = "/v1.4/";
const MAX_TARGET_LENGTH = 4096;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_RETRIES_PER_KEY = 1;
const MAX_RETRY_DELAY_MS = 2_000;

function parseKinopoiskApiKeys(rawValue) {
  if (Array.isArray(rawValue)) {
    return normalizeKeys(rawValue);
  }

  const raw = String(rawValue || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizeKeys(parsed);
  } catch {
    // Allow newline/comma separated values for local emulator setup.
  }

  return normalizeKeys(raw.split(/[\r\n,]+/));
}

function normalizeKeys(values) {
  return [...new Set(values
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function parseKinopoiskTarget(rawPath) {
  if (typeof rawPath !== "string" || !rawPath || rawPath.length > MAX_TARGET_LENGTH) {
    throw new Error("A valid Kinopoisk API path is required");
  }

  let target;
  try {
    target = new URL(rawPath, KINOPOISK_ORIGIN);
  } catch {
    throw new Error("Kinopoisk API path is invalid");
  }

  if (target.origin !== KINOPOISK_ORIGIN || !target.pathname.startsWith(KINOPOISK_API_PREFIX)) {
    throw new Error("Kinopoisk API path is not allowed");
  }

  target.hash = "";
  return target;
}

function isAllowedKinopoiskOrigin(origin) {
  return !origin || origin.startsWith("chrome-extension://") ||
    origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1");
}

function setKinopoiskCors(req, res) {
  const origin = req.headers.origin;
  if (!isAllowedKinopoiskOrigin(origin)) return false;

  if (origin) res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Expose-Headers", "Retry-After");
  return true;
}

function sendProxyError(res, status, code, message, retryable = false) {
  res.status(status).json({
    error: {
      code,
      message,
      retryable
    }
  });
}

function getBearerToken(req) {
  const header = typeof req.headers.authorization === "string"
    ? req.headers.authorization.trim()
    : "";
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : null;
}

function getRetryDelayMs(response) {
  const retryAfter = response?.headers?.get?.("Retry-After");
  const retryAfterSeconds = Number.parseInt(retryAfter, 10);
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) {
    return 250;
  }
  return Math.min(MAX_RETRY_DELAY_MS, retryAfterSeconds * 1000);
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

async function fetchKinopoiskUpstream(fetchImpl, targetUrl, apiKey) {
  const { controller, timeoutId } = createTimeoutSignal(UPSTREAM_TIMEOUT_MS);
  try {
    return await fetchImpl(targetUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sleep(delayMs) {
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function relayUpstreamResponse(upstream, res) {
  const contentLength = Number.parseInt(upstream.headers?.get?.("content-length"), 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    sendProxyError(res, 502, "KP_UPSTREAM_UNAVAILABLE", "Kinopoisk response is too large", true);
    return;
  }

  const body = await upstream.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    sendProxyError(res, 502, "KP_UPSTREAM_UNAVAILABLE", "Kinopoisk response is too large", true);
    return;
  }

  res.status(upstream.status);
  res.set("Content-Type", upstream.headers?.get?.("content-type") || "application/json");
  if (upstream.status === 429) {
    const retryAfter = upstream.headers?.get?.("Retry-After");
    if (retryAfter) res.set("Retry-After", retryAfter);
  }
  res.send(body);
}

function createKinopoiskProxyHandler({
  getSecretValue,
  verifyIdToken,
  fetchImpl = (...args) => fetch(...args),
  sleepImpl = sleep
}) {
  return async (req, res) => {
    if (!setKinopoiskCors(req, res)) {
      sendProxyError(res, 403, "ORIGIN_NOT_ALLOWED", "Origin is not allowed");
      return;
    }

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      sendProxyError(res, 405, "METHOD_NOT_ALLOWED", "Only GET requests are supported");
      return;
    }

    const idToken = getBearerToken(req);
    if (!idToken) {
      sendProxyError(res, 401, "AUTH_REQUIRED", "A Firebase ID token is required");
      return;
    }

    try {
      await verifyIdToken(idToken);
    } catch {
      sendProxyError(res, 401, "AUTH_REQUIRED", "Firebase authentication failed");
      return;
    }

    let targetUrl;
    try {
      targetUrl = parseKinopoiskTarget(req.query.path);
    } catch (error) {
      sendProxyError(res, 400, "INVALID_TARGET", error.message);
      return;
    }

    let apiKeys;
    try {
      apiKeys = parseKinopoiskApiKeys(await getSecretValue());
    } catch (error) {
      console.error("[kinopoiskProxy] Secret read failed:", error?.message || "unknown error");
      sendProxyError(res, 503, "KP_UPSTREAM_UNAVAILABLE", "Kinopoisk proxy is not configured", true);
      return;
    }

    if (apiKeys.length === 0) {
      console.error("[kinopoiskProxy] No API keys configured");
      sendProxyError(res, 503, "KP_UPSTREAM_UNAVAILABLE", "Kinopoisk proxy is not configured", true);
      return;
    }

    let rejectedKeyCount = 0;
    for (const apiKey of apiKeys) {
      for (let retry = 0; retry <= MAX_RETRIES_PER_KEY; retry++) {
        let upstream;
        try {
          upstream = await fetchKinopoiskUpstream(fetchImpl, targetUrl, apiKey);
        } catch (error) {
          if (retry < MAX_RETRIES_PER_KEY) {
            await sleepImpl(250);
            continue;
          }
          console.warn("[kinopoiskProxy] Upstream request failed:", error?.name || "network error");
          sendProxyError(res, 502, "KP_UPSTREAM_UNAVAILABLE", "Kinopoisk upstream is unavailable", true);
          return;
        }

        if ([401, 402, 403].includes(upstream.status)) {
          rejectedKeyCount += 1;
          break;
        }

        if (upstream.status === 429 || upstream.status >= 500) {
          if (retry < MAX_RETRIES_PER_KEY) {
            await sleepImpl(getRetryDelayMs(upstream));
            continue;
          }

          if (upstream.status === 429) {
            const retryAfter = upstream.headers?.get?.("Retry-After");
            if (retryAfter) res.set("Retry-After", retryAfter);
            sendProxyError(res, 429, "KP_UPSTREAM_UNAVAILABLE", "Kinopoisk rate limit reached", true);
            return;
          }

          sendProxyError(res, 502, "KP_UPSTREAM_UNAVAILABLE", "Kinopoisk upstream is unavailable", true);
          return;
        }

        await relayUpstreamResponse(upstream, res);
        return;
      }
    }

    if (rejectedKeyCount === apiKeys.length) {
      console.warn("[kinopoiskProxy] All configured API keys were rejected");
      sendProxyError(res, 503, "KP_QUOTA_EXHAUSTED", "Kinopoisk API credentials are unavailable", true);
      return;
    }

    sendProxyError(res, 502, "KP_UPSTREAM_UNAVAILABLE", "Kinopoisk upstream is unavailable", true);
  };
}

module.exports = {
  KINOPOISK_API_PREFIX,
  KINOPOISK_ORIGIN,
  createKinopoiskProxyHandler,
  isAllowedKinopoiskOrigin,
  parseKinopoiskApiKeys,
  parseKinopoiskTarget
};
