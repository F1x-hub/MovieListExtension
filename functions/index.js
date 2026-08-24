const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { createKinopoiskProxyHandler } = require("./kinopoiskProxy");

initializeApp();
const db = getFirestore();
const TMDB_API_TOKEN = defineSecret("TMDB_API_TOKEN");
const KINOPOISK_API_KEYS = defineSecret("KINOPOISK_API_KEYS");

exports.kinopoiskProxy = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
    secrets: [KINOPOISK_API_KEYS],
  },
  createKinopoiskProxyHandler({
    getSecretValue: () => KINOPOISK_API_KEYS.value(),
    verifyIdToken: (idToken) => getAuth().verifyIdToken(idToken),
  })
);

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

/**
 * Bounded TMDB proxy for extension clients without a local token.
 * The token is injected from Firebase Secret Manager and never reaches the client.
 */
exports.tmdbProxy = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
    secrets: [TMDB_API_TOKEN],
  },
  async (req, res) => {
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

    const token = TMDB_API_TOKEN.value();
    if (!token) {
      res.status(503).json({ error: "TMDB proxy is not configured" });
      return;
    }

    try {
      const upstream = await fetch(targetUrl, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const body = await upstream.text();
      res.status(upstream.status);
      res.set("Content-Type", upstream.headers.get("content-type") || "application/json");
      res.send(body);
    } catch (error) {
      console.error("[tmdbProxy] Upstream request failed:", error);
      res.status(502).json({ error: "TMDB upstream request failed" });
    }
  }
);

/**
 * Trigger on Firestore ratings document create, update, or delete (v2).
 * Automatically aggregates ratingsCount, ratingsSum, and avgRating for the movie.
 */
exports.aggregateMovieRatings = onDocumentWritten("ratings/{ratingId}", async (event) => {
  const dataAfter = event.data?.after?.exists ? event.data.after.data() : null;
  const dataBefore = event.data?.before?.exists ? event.data.before.data() : null;

  const movieId = (dataAfter && dataAfter.movieId) || (dataBefore && dataBefore.movieId);
  if (!movieId) return null;

  const numMovieId = Number(movieId);
  if (!Number.isInteger(numMovieId) || numMovieId <= 0) return null;
  const movieIdCandidates = [...new Set([numMovieId, movieId.toString()])];

  // Query all ratings for this movie
  const ratingsSnapshot = await db
    .collection("ratings")
    .where("movieId", "in", movieIdCandidates)
    .get();

  let ratingsCount = 0;
  let ratingsSum = 0;
  let latestTimestamp = null;

  ratingsSnapshot.forEach((doc) => {
    const ratingData = doc.data();
    const ratingVal = Number(ratingData.rating);
    if (!isNaN(ratingVal)) {
      ratingsSum += ratingVal;
      ratingsCount += 1;
    }

    const ratingTimestamp = ratingData.updatedAt || ratingData.createdAt || doc.updateTime || doc.createTime;
    if (ratingTimestamp) {
      const ratingMillis = ratingTimestamp.toMillis ? ratingTimestamp.toMillis() : new Date(ratingTimestamp).getTime();
      const latestMillis = latestTimestamp
        ? (latestTimestamp.toMillis ? latestTimestamp.toMillis() : new Date(latestTimestamp).getTime())
        : 0;
      if (Number.isFinite(ratingMillis) && ratingMillis > latestMillis) {
        latestTimestamp = ratingTimestamp;
      }
    }
  });

  const avgRating = ratingsCount > 0 ? Math.round((ratingsSum / ratingsCount) * 10) / 10 : 0;

  const movieRef = db.collection("movies").doc(movieId.toString());
  if (ratingsCount === 0) {
    await movieRef.delete();
    console.log(`[Cloud Function v2] Deleted unrated movie ${movieId}`);
    return null;
  }

  // Update the aggregated movie document.
  await movieRef.set(
    {
      kinopoiskId: numMovieId,
      ratingsCount,
      ratingsSum,
      avgRating,
      hasCommunityRating: ratingsCount > 0,
      hasRatings: ratingsCount > 0,
      lastRatingUpdatedAt: latestTimestamp,
    },
    { merge: true }
  );

  console.log(`[Cloud Function v2] Aggregated movie ${movieId}: count=${ratingsCount}, sum=${ratingsSum}, avg=${avgRating}`);
  return null;
});

/**
 * One-time backfill: finds ALL unique movieIds from the ratings collection
 * and re-aggregates them into the movies collection.
 *
 * This ensures every rated movie has:
 *   hasCommunityRating, hasRatings, ratingsCount, ratingsSum, avgRating, lastRatingUpdatedAt
 *
 * IMPORTANT: lastRatingUpdatedAt is set to the LATEST rating timestamp for each movie
 * (from updatedAt or createdAt on rating docs), NOT FieldValue.serverTimestamp().
 * Using serverTimestamp() would give all movies the same time, destroying sort order.
 *
 * Call via HTTP GET after deploying:
 *   curl https://<region>-<project>.cloudfunctions.net/backfillMovieAggregates
 *
 * Safe to call multiple times — it's idempotent.
 */
exports.backfillMovieAggregates = onRequest(
  { timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    try {
      console.log("[backfill] Starting full movie aggregation backfill...");

      // Step 1: Get ALL ratings
      const allRatingsSnapshot = await db.collection("ratings").get();
      console.log(`[backfill] Total rating documents: ${allRatingsSnapshot.size}`);

      // Step 2: Group by movieId — aggregate counts AND track latest timestamp
      const movieAggregates = new Map();

      allRatingsSnapshot.forEach((doc) => {
        const data = doc.data();
        const movieId = data.movieId;
        if (!movieId) return;

        const key = movieId.toString();
        if (!movieAggregates.has(key)) {
          movieAggregates.set(key, { count: 0, sum: 0, latestTimestamp: null });
        }

        const agg = movieAggregates.get(key);
        const ratingVal = Number(data.rating);
        if (!isNaN(ratingVal)) {
          agg.sum += ratingVal;
          agg.count += 1;
        }

        // Track the latest rating timestamp for this movie.
        // Prefer updatedAt (rating was edited), fall back to createdAt.
        const ratingTs = data.updatedAt || data.createdAt || doc.updateTime || doc.createTime;
        if (ratingTs) {
          // Convert to millis for comparison (Firestore Timestamps have .toMillis())
          const tsMillis = ratingTs.toMillis ? ratingTs.toMillis() : new Date(ratingTs).getTime();
          const currentLatest = agg.latestTimestamp
            ? (agg.latestTimestamp.toMillis ? agg.latestTimestamp.toMillis() : new Date(agg.latestTimestamp).getTime())
            : 0;
          if (tsMillis > currentLatest) {
            agg.latestTimestamp = ratingTs;
          }
        }
      });

      console.log(`[backfill] Unique movies with ratings: ${movieAggregates.size}`);

      // Step 3: Batch-update all movie documents
      const BATCH_SIZE = 500;
      const entries = Array.from(movieAggregates.entries());
      let updatedCount = 0;

      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = entries.slice(i, i + BATCH_SIZE);

        chunk.forEach(([movieIdStr, agg]) => {
          const movieRef = db.collection("movies").doc(movieIdStr);
          const avgRating = agg.count > 0
            ? Math.round((agg.sum / agg.count) * 10) / 10
            : 0;

          batch.set(
            movieRef,
            {
              kinopoiskId: Number(movieIdStr),
              ratingsCount: agg.count,
              ratingsSum: agg.sum,
              avgRating,
              hasCommunityRating: agg.count > 0,
              hasRatings: agg.count > 0,
              // Use the actual latest rating timestamp, not the backfill execution time.
              lastRatingUpdatedAt: agg.latestTimestamp,
            },
            { merge: true }
          );
        });

        await batch.commit();
        updatedCount += chunk.length;
        console.log(`[backfill] Updated batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} docs (total: ${updatedCount}/${entries.length})`);
      }

      const summary = `Backfill complete. Processed ${allRatingsSnapshot.size} ratings across ${movieAggregates.size} movies. Updated ${updatedCount} movie documents.`;
      console.log(`[backfill] ${summary}`);
      res.status(200).json({ success: true, message: summary });
    } catch (error) {
      console.error("[backfill] Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * One-time cleanup for legacy movie cache documents without a community rating.
 * Use ?dryRun=true to inspect candidates or ?confirm=true to delete them.
 */
exports.cleanupUnratedMovies = onRequest(
  { timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    try {
      const dryRun = String(req.query.dryRun || "").toLowerCase() === "true";
      const confirmed = String(req.query.confirm || "").toLowerCase() === "true";
      if (!dryRun && !confirmed) {
        res.status(400).json({
          success: false,
          error: "Use ?dryRun=true to inspect candidates or ?confirm=true to delete them."
        });
        return;
      }

      let lastDoc = null;
      let matchedCount = 0;
      let deletedCount = 0;

      while (true) {
        let query = db.collection("movies").orderBy("__name__").limit(500);
        if (lastDoc) query = query.startAfter(lastDoc);
        const snapshot = await query.get();
        if (snapshot.empty) break;

        const staleDocs = snapshot.docs.filter((doc) => doc.data().hasCommunityRating !== true);
        matchedCount += staleDocs.length;

        if (confirmed && staleDocs.length > 0) {
          const batch = db.batch();
          staleDocs.forEach((doc) => {
            const data = doc.data();
            console.log("[cleanupUnratedMovies] Deleting movie", {
              documentId: doc.id,
              kinopoiskId: data.kinopoiskId ?? doc.id,
              name: data.name ?? null,
            });
            batch.delete(doc.ref);
          });
          await batch.commit();
          deletedCount += staleDocs.length;
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.size < 500) break;
      }

      const response = { success: true, dryRun, matchedCount, deletedCount };
      console.log("[cleanupUnratedMovies]", response);
      res.status(200).json(response);
    } catch (error) {
      console.error("[cleanupUnratedMovies] Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);
