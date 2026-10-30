const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const UPSTREAM_TIMEOUT_MS = 8000;
const EXPIRY_MARGIN_MS = 60 * 1000;

function isAllowedOrigin(origin) {
  return !origin || origin.startsWith("chrome-extension://") ||
    origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1");
}

function setSpotifyCors(req, res) {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) return false;

  if (origin) res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return true;
}

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

function getBearerToken(req) {
  const header = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : null;
}

/**
 * Hands signed-in extension users a short-lived Spotify client-credentials token
 * (public catalogue search only). The client secret stays in Secret Manager and
 * never ships in the extension bundle.
 */
function createSpotifyTokenHandler({
  getCredentials,
  verifyIdToken,
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  logger = console,
} = {}) {
  if (typeof getCredentials !== "function" || typeof verifyIdToken !== "function") {
    throw new Error("Spotify credentials and an ID token verifier are required");
  }

  let cached = null;

  return async (req, res) => {
    if (!setSpotifyCors(req, res)) {
      sendError(res, 403, "ORIGIN_NOT_ALLOWED", "Origin is not allowed");
      return;
    }
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      sendError(res, 405, "METHOD_NOT_ALLOWED", "Only GET requests are supported");
      return;
    }

    const idToken = getBearerToken(req);
    if (!idToken) {
      sendError(res, 401, "AUTH_REQUIRED", "A Firebase ID token is required");
      return;
    }
    try {
      await verifyIdToken(idToken);
    } catch {
      sendError(res, 401, "AUTH_REQUIRED", "Firebase authentication failed");
      return;
    }

    res.set("Cache-Control", "no-store");

    if (cached && now() < cached.expiresAtMs - EXPIRY_MARGIN_MS) {
      res.status(200).json({ token: cached.token, expiresInSec: Math.floor((cached.expiresAtMs - now()) / 1000) });
      return;
    }

    let credentials;
    try {
      credentials = (await getCredentials()) || {};
    } catch (error) {
      logger.error?.("[spotifyToken] Credentials unavailable", { code: error?.code || error?.name || null });
      sendError(res, 503, "NOT_CONFIGURED", "Spotify is not configured");
      return;
    }
    const { clientId, clientSecret } = credentials;
    if (!clientId || !clientSecret) {
      sendError(res, 503, "NOT_CONFIGURED", "Spotify is not configured");
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const upstream = await fetchImpl(SPOTIFY_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: "grant_type=client_credentials",
        signal: controller.signal,
      });
      const data = await upstream.json().catch(() => null);
      if (!upstream.ok || typeof data?.access_token !== "string") {
        logger.error?.("[spotifyToken] Spotify rejected the token request", { status: upstream.status });
        sendError(res, 502, "UPSTREAM_FAILED", "Spotify token request failed");
        return;
      }
      const expiresInSec = Number.isFinite(data.expires_in) ? data.expires_in : 3600;
      cached = { token: data.access_token, expiresAtMs: now() + expiresInSec * 1000 };
      res.status(200).json({ token: cached.token, expiresInSec });
    } catch (error) {
      logger.error?.("[spotifyToken] Upstream request failed", { code: error?.code || error?.name || null });
      sendError(res, 502, "UPSTREAM_FAILED", "Spotify token request failed");
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

module.exports = { createSpotifyTokenHandler, setSpotifyCors };
