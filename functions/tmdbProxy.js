function setTmdbCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || origin.startsWith("chrome-extension://") || origin.startsWith("http://localhost")) {
    if (origin) res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    return true;
  }
  return false;
}

function sendUpstreamResponse(res, upstream, body) {
  res.status(upstream.status);
  res.set("Content-Type", upstream.headers.get("content-type") || "application/json");
  res.send(body);
}

function createTmdbProxyHandler({
  keyPool,
  getLegacySecretValue = () => "",
  fetchImpl = (...args) => fetch(...args),
  logger = console,
} = {}) {
  if (!keyPool || typeof keyPool.getActiveKeys !== "function" || typeof keyPool.reportOutcome !== "function") {
    throw new Error("A TMDB provider key pool is required");
  }

  return async (req, res) => {
    if (!setTmdbCors(req, res)) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ error: "Only GET requests are supported" });
      return;
    }

    const rawTarget = typeof req.query.url === "string" ? req.query.url : "";
    if (!rawTarget || rawTarget.length > 4096) {
      res.status(400).json({ error: "A valid TMDB target URL is required" });
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(rawTarget);
    } catch {
      res.status(400).json({ error: "TMDB target URL is invalid" });
      return;
    }
    if (targetUrl.origin !== "https://api.themoviedb.org" || !targetUrl.pathname.startsWith("/3/")) {
      res.status(400).json({ error: "TMDB target URL is not allowed" });
      return;
    }

    const state = await keyPool.getActiveKeys();
    const configuredKeys = Array.isArray(state?.keys) ? state.keys : [];
    const legacyToken = state?.registeredCount === 0 ? String(getLegacySecretValue() || "").trim() : "";
    const candidates = configuredKeys.length
      ? configuredKeys
      : legacyToken ? [{ keyId: null, value: legacyToken, legacy: true }] : [];

    if (!candidates.length) {
      res.status(503).json({ error: "TMDB proxy is not configured" });
      return;
    }

    if (candidates[0]?.legacy) {
      logger.warn?.("[tmdbProxy] Using legacy TMDB_API_TOKEN migration bridge");
    }

    let lastRejected = null;
    for (const key of candidates) {
      try {
        const upstream = await fetchImpl(targetUrl, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${key.value}`,
          },
        });
        const body = await upstream.text();
        if ([401, 403, 429].includes(upstream.status) && !key.legacy) {
          keyPool.reportOutcome({ keyId: key.keyId, outcome: "rejected" });
          lastRejected = { upstream, body };
          continue;
        }
        if (!key.legacy) keyPool.reportOutcome({ keyId: key.keyId, outcome: "success" });
        sendUpstreamResponse(res, upstream, body);
        return;
      } catch (error) {
        logger.error?.("[tmdbProxy] Upstream request failed", { code: error?.code || null });
        res.status(502).json({ error: "TMDB upstream request failed" });
        return;
      }
    }

    if (lastRejected) {
      sendUpstreamResponse(res, lastRejected.upstream, lastRejected.body);
      return;
    }
    res.status(503).json({ error: "TMDB proxy is not configured" });
  };
}

module.exports = {
  createTmdbProxyHandler,
  setTmdbCors,
};
