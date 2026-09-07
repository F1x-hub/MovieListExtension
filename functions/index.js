const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret, defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getDatabaseWithUrl } = require("firebase-admin/database");
const { createKinopoiskProxyHandler } = require("./kinopoiskProxy");
const { getFirestoreUsage } = require("./firestoreUsage");
const { createAdminAuthVerifier, setAdminCors } = require("./adminAuth");
const { createProviderKeyVault } = require("./providerKeyVault");
const { createProviderKeyPool } = require("./providerKeyPool");
const { createTmdbProxyHandler } = require("./tmdbProxy");
const {
  createProviderKeyManagementHandler,
  createProviderKeyManagementService,
} = require("./providerKeyManagement");
const { createWatchRoomService } = require("./watchRoomService");
const { createWatchRoomsStagingHandler } = require("./watchRoomsStaging");
const { createExpiredWatchRoomCleanup } = require("./watchRoomCleanup");
const {
  buildMovieRatingProjection,
  isAggregateRelevantRatingChange,
} = require("./ratingAggregation");
const { scanRatingProjectionIntegrity } = require("./ratingIntegrityService");

const app = initializeApp();
const db = getFirestore(app);
const TMDB_API_TOKEN = defineSecret("TMDB_API_TOKEN");
const KINOPOISK_API_KEYS = defineSecret("KINOPOISK_API_KEYS");
const WATCH_ROOM_STAGING_DATABASE_URL = defineString("WATCH_ROOM_STAGING_DATABASE_URL");
const RATING_INTEGRITY_AUTO_REPAIR = defineString("RATING_INTEGRITY_AUTO_REPAIR", {
  default: "false",
});
const verifyAdminRequest = createAdminAuthVerifier({ auth: getAuth(), db });
let providerKeyManagementHandler = null;
const providerKeyPools = new Map();
const DEFAULT_COMMENT_REACTION_TYPES = [
  "like",
  "love",
  "laugh",
  "wow",
  "sad",
  "fire",
  "clap",
  "rocket",
  "party",
  "thinking",
  "eyes",
  "hundred",
];

async function getActiveCommentReactionTypes() {
  try {
    const snapshot = await db.collection("settings").doc("commentReactions").get();
    const configuredTypes = snapshot.exists ? snapshot.data()?.reactionTypes : null;
    if (Array.isArray(configuredTypes) && configuredTypes.length > 0) {
      const types = [...new Set(configuredTypes
        .map((type) => String(type ?? "").trim().toLowerCase())
        .filter((type) => /^[a-z0-9](?:[a-z0-9_-]{0,47})$/.test(type))
      )].slice(0, 24);
      if (types.length > 0) return types;
    }
  } catch (error) {
    console.warn("[CommentReactions] Failed to load shared config; using defaults:", error.message);
  }
  return DEFAULT_COMMENT_REACTION_TYPES;
}

function getProviderKeyPool(provider = "kinopoisk") {
  if (!providerKeyPools.has(provider)) {
    providerKeyPools.set(provider, createProviderKeyPool({
      db,
      vault: createProviderKeyVault(),
      provider,
    }));
  }
  return providerKeyPools.get(provider);
}

function getWatchRoomStagingDatabase() {
  const url = WATCH_ROOM_STAGING_DATABASE_URL.value();
  if (!/^https:\/\/[a-z0-9-]+\.firebaseio\.com$/i.test(url || "")) {
    throw new Error("Watch-room staging database URL is invalid");
  }
  return getDatabaseWithUrl(url, app);
}

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
    keyPool: {
      getActiveKeys: () => getProviderKeyPool("kinopoisk").getActiveKeys(),
      reportOutcome: (outcome) => getProviderKeyPool("kinopoisk").reportOutcome(outcome),
    },
  })
);

/**
 * Read Firestore free-tier usage through Cloud Monitoring for the admin panel.
 * Usage data is intentionally not persisted in Firestore. The admin check still
 * performs one normal user-document read per request.
 */
exports.firestoreUsage = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (req, res) => {
    if (!setAdminCors(req, res)) {
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

    try {
      await verifyAdminRequest(req);
      const usage = await getFirestoreUsage();
      res.set("Cache-Control", "no-store");
      res.status(200).json(usage);
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      if (statusCode >= 500) {
        console.error("[firestoreUsage] Failed to read usage:", error);
      }
      res.status(statusCode).json({
        error: statusCode === 500 ? "Firestore usage is temporarily unavailable" : error.message,
      });
    }
  }
);

function getProviderKeyManagementHandler() {
  if (!providerKeyManagementHandler) {
    const service = createProviderKeyManagementService({
      db,
      vault: createProviderKeyVault(),
    });
    providerKeyManagementHandler = createProviderKeyManagementHandler({
      service,
      verifyAdminRequest,
      setCors: setAdminCors,
    });
  }
  return providerKeyManagementHandler;
}

exports.providerKeysAdmin = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (req, res) => getProviderKeyManagementHandler()(req, res)
);

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
  createTmdbProxyHandler({
    getLegacySecretValue: () => TMDB_API_TOKEN.value(),
    keyPool: {
      getActiveKeys: () => getProviderKeyPool("tmdb").getActiveKeys(),
      reportOutcome: (outcome) => getProviderKeyPool("tmdb").reportOutcome(outcome),
    },
  })
);

/**
 * Temporary private staging proof surface. It uses the separately provisioned staging
 * RTDB instance. It stores no playback URLs or credentials.
 */
exports.watchRoomsStaging = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  createWatchRoomsStagingHandler({
    service: createWatchRoomService({ db, collectionPrefix: "watchRoomsStaging", emitAclOutbox: false }),
    verifyIdToken: (idToken) => getAuth(app).verifyIdToken(idToken),
    getRealtimeDatabase: getWatchRoomStagingDatabase,
  })
);

exports.cleanupExpiredWatchRoomsStaging = onSchedule(
  {
    schedule: "15 4 * * *",
    timeZone: "Asia/Tbilisi",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 120,
    maxInstances: 1,
    retryCount: 1,
    maxRetrySeconds: 300,
  },
  async () => createExpiredWatchRoomCleanup({
    db,
    getRealtimeDatabase: getWatchRoomStagingDatabase,
  }).run()
);

/**
 * Trigger on Firestore ratings document create, update, or delete (v2).
 * Automatically aggregates ratingsCount, ratingsSum, and avgRating for the movie.
 */
exports.aggregateMovieRatings = onDocumentWritten("ratings/{ratingId}", async (event) => {
  const dataAfter = event.data?.after?.exists ? event.data.after.data() : null;
  const dataBefore = event.data?.before?.exists ? event.data.before.data() : null;

  if (!isAggregateRelevantRatingChange(dataBefore, dataAfter)) {
    console.log(`[Cloud Function v2] Ignored text-only rating update ${event.params?.ratingId || "unknown"}`);
    return null;
  }

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

  const projection = buildMovieRatingProjection(
    ratingsSnapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
      updateTime: doc.updateTime,
      createTime: doc.createTime,
    })),
    numMovieId
  );

  const movieRef = db.collection("movies").doc(movieId.toString());
  if (!projection) return null;

  // Aggregates are derived state. Keep the movie document so metadata remains
  // available for repair and make the zero-rating state explicit instead of
  // deleting the projection from an eventually ordered trigger.
  await movieRef.set(projection, { merge: true });

  console.log(`[Cloud Function v2] Aggregated movie ${movieId}: count=${projection.ratingsCount}, sum=${projection.ratingsSum}, avg=${projection.avgRating}`);
  return null;
});

/**
 * Rebuild the derived reaction summary for one comment.
 * Reaction documents never touch /ratings, so this trigger cannot invoke the
 * movie rating aggregate function above.
 */
exports.aggregateCommentReactions = onDocumentWritten("commentReactions/{reactionId}", async (event) => {
  const dataAfter = event.data?.after?.exists ? event.data.after.data() : null;
  const dataBefore = event.data?.before?.exists ? event.data.before.data() : null;
  const ratingId = dataAfter?.ratingId || dataBefore?.ratingId || event.params?.reactionId?.split("_")[0];
  if (!ratingId) return null;

  // The rating is the authoritative movie binding. This also prevents an
  // orphaned reaction document from creating a publicly readable summary.
  const ratingSnapshot = await db.collection("ratings").doc(ratingId).get();
  if (!ratingSnapshot.exists) {
    await db.collection("commentReactionSummaries").doc(ratingId).delete();
    return null;
  }
  const rating = ratingSnapshot.data() || {};

  const reactionsSnapshot = await db
    .collection("commentReactions")
    .where("ratingId", "==", ratingId)
    .get();

  const activeReactionTypes = await getActiveCommentReactionTypes();
  const counts = Object.fromEntries(activeReactionTypes.map((type) => [type, 0]));

  const movieId = rating.movieId ?? dataAfter?.movieId ?? dataBefore?.movieId ?? null;
  const orderSet = new Set();
  const sortedDocs = reactionsSnapshot.docs.slice().sort((a, b) => {
    const dataA = a.data() || {};
    const dataB = b.data() || {};
    const timeA = dataA.createdAt?.toMillis ? dataA.createdAt.toMillis() : (dataA.createdAt ? new Date(dataA.createdAt).getTime() : 0);
    const timeB = dataB.createdAt?.toMillis ? dataB.createdAt.toMillis() : (dataB.createdAt ? new Date(dataB.createdAt).getTime() : 0);
    return timeA - timeB;
  });

  sortedDocs.forEach((reactionDoc) => {
    const reaction = reactionDoc.data() || {};
    const rawTypes = Array.isArray(reaction.types) ? reaction.types : [reaction.type];
    const reactionTypes = [...new Set(rawTypes
      .map((reactionType) => String(reactionType ?? "").trim().toLowerCase())
      .filter((reactionType) => Object.prototype.hasOwnProperty.call(counts, reactionType))
    )].slice(0, 3);
    reactionTypes.forEach((reactionType) => {
      counts[reactionType] += 1;
      orderSet.add(reactionType);
    });
  });

  const order = Array.from(orderSet).filter((type) => counts[type] > 0);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  await db.collection("commentReactionSummaries").doc(ratingId).set({
    ratingId,
    movieId,
    counts,
    order,
    total,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(`[Cloud Function v2] Aggregated reactions for ${ratingId}: total=${total}`);
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
 * Call with an admin ID token after deploying. GET/POST is dry-run by default;
 * add ?apply=true only after inspecting the complete response.
 *
 * Safe to call multiple times — it's idempotent.
 */
exports.backfillMovieAggregates = onRequest(
  { region: "us-central1", timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    try {
      if (!setAdminCors(req, res)) {
        res.status(403).json({ success: false, error: "Origin is not allowed" });
        return;
      }
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }
      if (!["GET", "POST"].includes(req.method)) {
        res.status(405).json({ success: false, error: "Only GET or POST is supported" });
        return;
      }
      await verifyAdminRequest(req);

      const apply = String(req.query.apply || "").toLowerCase() === "true";
      const result = await scanRatingProjectionIntegrity({ db, apply });
      const response = { success: true, dryRun: !apply, ...result };
      console.log("[backfill]", response);
      res.status(200).json(response);
    } catch (error) {
      console.error("[backfill] Error:", error);
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      res.status(statusCode).json({ success: false, error: error.message });
    }
  }
);

/**
 * Bounded integrity check for the ratings -> movies projection.
 * Dry-run is the default; ?apply=true requires an admin token and repairs only
 * derived movie fields through the shared projection calculator.
 */
exports.auditRatingIntegrity = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (req, res) => {
    try {
      if (!setAdminCors(req, res)) {
        res.status(403).json({ success: false, error: "Origin is not allowed" });
        return;
      }
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }
      if (req.method !== "GET" && req.method !== "POST") {
        res.status(405).json({ success: false, error: "Only GET or POST is supported" });
        return;
      }
      await verifyAdminRequest(req);

      const apply = String(req.query.apply || "").toLowerCase() === "true";
      const rawMovieIds = String(req.query.movieIds || "").trim();
      const movieIds = rawMovieIds
        ? rawMovieIds.split(",").map((value) => value.trim()).filter(Boolean)
        : null;
      const result = await scanRatingProjectionIntegrity({ db, apply, movieIds });
      res.status(200).json({ success: true, dryRun: !apply, ...result });
    } catch (error) {
      console.error("[auditRatingIntegrity] Error:", error);
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      res.status(statusCode).json({
        success: false,
        error: statusCode === 500 ? "Rating integrity audit is temporarily unavailable" : error.message,
      });
    }
  }
);

exports.auditRatingIntegrityDaily = onSchedule(
  {
    schedule: "45 4 * * *",
    timeZone: "Asia/Tbilisi",
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "512MiB",
    maxInstances: 1,
    retryCount: 1,
    maxRetrySeconds: 300,
  },
  async () => {
    const apply = String(RATING_INTEGRITY_AUTO_REPAIR.value()).toLowerCase() === "true";
    const result = await scanRatingProjectionIntegrity({ db, apply });
    console.log("[auditRatingIntegrityDaily]", {
      ...result,
      dryRun: !apply,
    });
    if (result.violationCount > 0 && !apply) {
      console.warn("[auditRatingIntegrityDaily] Violations found while auto-repair is disabled");
    }
    return result;
  }
);

/**
 * One-time cleanup for legacy movie cache documents without a community rating.
 * Use ?dryRun=true to inspect candidates or ?confirm=true to delete them.
 */
exports.cleanupUnratedMovies = onRequest(
  { region: "us-central1", timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    try {
      if (!setAdminCors(req, res)) {
        res.status(403).json({ success: false, error: "Origin is not allowed" });
        return;
      }
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }
      if (req.method !== "GET" && req.method !== "POST") {
        res.status(405).json({ success: false, error: "Only GET or POST is supported" });
        return;
      }
      await verifyAdminRequest(req);

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
      const ratingsSnapshot = await db.collection("ratings").get();
      const ratedMovieIds = new Set(
        ratingsSnapshot.docs
          .map((doc) => String(doc.data()?.movieId ?? "").trim())
          .filter(Boolean)
      );

      while (true) {
        let query = db.collection("movies").orderBy("__name__").limit(500);
        if (lastDoc) query = query.startAfter(lastDoc);
        const snapshot = await query.get();
        if (snapshot.empty) break;

        const staleDocs = snapshot.docs.filter((doc) => {
          const data = doc.data();
          const movieId = String(data.kinopoiskId ?? doc.id).trim();
          return data.hasCommunityRating !== true && !ratedMovieIds.has(movieId);
        });
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
