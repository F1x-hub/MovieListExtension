/**
 * IMDb ratings for extension clients.
 *
 * IMDb title pages answer extension fetches with an HTTP 202 bot challenge,
 * and the suggestion API sends no CORS headers, so the client cannot read
 * IMDb ratings directly. This function asks IMDb's public GraphQL endpoint for
 * up to IMDB_MAX_IDS titles in one request. The query is fixed: clients only
 * pass validated title IDs, never GraphQL text.
 */
const IMDB_GRAPHQL_URL = "https://api.graphql.imdb.com/";
const IMDB_MAX_IDS = 50;
const IMDB_ID_PATTERN = /^tt\d{7,10}$/;
const IMDB_CACHE_SECONDS = 6 * 60 * 60;
const IMDB_CLIENT_NAME = "imdb-web-next-localized";

function setImdbCors(req, res) {
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

/**
 * @param {string} raw - Comma-separated IMDb title IDs
 * @returns {string[]|null} Unique valid IDs, or null when any ID is invalid
 */
function parseImdbIds(raw) {
  const ids = String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (ids.length === 0 || ids.length > IMDB_MAX_IDS) return null;
  if (!ids.every((id) => IMDB_ID_PATTERN.test(id))) return null;
  return [...new Set(ids)];
}

function buildRatingsQuery(ids) {
  // IDs are validated against IMDB_ID_PATTERN before they reach the query.
  return `query { titles(ids: ${JSON.stringify(ids)}) { id ratingsSummary { aggregateRating voteCount } } }`;
}

function createImdbRatingsHandler({
  fetchImpl = (...args) => fetch(...args),
  logger = console,
} = {}) {
  return async (req, res) => {
    if (!setImdbCors(req, res)) {
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

    const ids = parseImdbIds(req.query.ids);
    if (!ids) {
      res.status(400).json({ error: `1-${IMDB_MAX_IDS} comma-separated IMDb title IDs are required` });
      return;
    }

    try {
      const upstream = await fetchImpl(IMDB_GRAPHQL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          // The endpoint rejects requests without a client name (HTTP 403).
          "x-imdb-client-name": IMDB_CLIENT_NAME,
        },
        body: JSON.stringify({ query: buildRatingsQuery(ids) }),
      });
      if (!upstream.ok) {
        logger.warn?.("[imdbRatings] Upstream rejected the request", { status: upstream.status });
        res.status(502).json({ error: "IMDb upstream request failed" });
        return;
      }
      const payload = await upstream.json();
      const titles = Array.isArray(payload?.data?.titles) ? payload.data.titles : [];
      const ratings = {};
      for (const title of titles) {
        if (!title?.id || !IMDB_ID_PATTERN.test(title.id)) continue;
        const rating = Number(title.ratingsSummary?.aggregateRating) || 0;
        const votes = Number(title.ratingsSummary?.voteCount) || 0;
        ratings[title.id] = rating > 0 && rating <= 10 ? { rating, votes } : { rating: 0, votes: 0 };
      }
      res.set("Cache-Control", `public, max-age=${IMDB_CACHE_SECONDS}`);
      res.status(200).json({ ratings });
    } catch (error) {
      logger.error?.("[imdbRatings] Upstream request failed", { code: error?.code || null });
      res.status(502).json({ error: "IMDb upstream request failed" });
    }
  };
}

module.exports = {
  createImdbRatingsHandler,
  parseImdbIds,
  IMDB_MAX_IDS,
};
