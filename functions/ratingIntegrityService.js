const {
  buildMovieRatingProjection,
  isMovieRatingProjectionHealthy,
} = require("./ratingAggregation");

const REPAIR_BATCH_LIMIT = 450;

function normalizeMovieId(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? String(numericValue)
    : null;
}

function groupRatingEntries(ratingEntries) {
  const groups = new Map();
  for (const entry of ratingEntries || []) {
    const data = entry?.data || {};
    const movieId = normalizeMovieId(data.movieId);
    if (!movieId) continue;
    if (!groups.has(movieId)) groups.set(movieId, []);
    groups.get(movieId).push(entry);
  }
  return groups;
}

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function projectionDiff(expected, current) {
  const fields = [
    "kinopoiskId",
    "ratingsCount",
    "ratingsSum",
    "avgRating",
    "hasCommunityRating",
    "hasRatings",
  ];
  const differences = fields.filter((field) => Number(expected[field]) !== Number(current?.[field])
    && expected[field] !== current?.[field]);

  if (timestampToMillis(expected.lastRatingUpdatedAt)
      !== timestampToMillis(current?.lastRatingUpdatedAt)) {
    differences.push("lastRatingUpdatedAt");
  }
  return differences;
}

function findProjectionViolations({ ratingEntries = [], movieDocuments = [] } = {}) {
  const ratingGroups = groupRatingEntries(ratingEntries);
  const moviesById = new Map(
    (movieDocuments || []).map((movie) => [normalizeMovieId(movie?.id), movie?.data || {}])
  );
  const violations = [];

  for (const [movieId, entries] of ratingGroups) {
    const expected = buildMovieRatingProjection(entries, Number(movieId));
    const current = moviesById.get(movieId);
    const differences = current ? projectionDiff(expected, current) : ["missingDocument"];
    if (!current || !isMovieRatingProjectionHealthy(current) || differences.length > 0) {
      violations.push({
        movieId,
        expected,
        current: current || null,
        differences,
      });
    }
  }

  return violations;
}

async function scanRatingProjectionIntegrity({ db, apply = false, movieIds = null } = {}) {
  if (!db || typeof db.collection !== "function") {
    throw new Error("Firestore admin client is required");
  }

  const ratingsSnapshot = await db.collection("ratings").get();
  const ratingEntries = ratingsSnapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data(),
    updateTime: doc.updateTime,
    createTime: doc.createTime,
  }));
  const ratingGroups = groupRatingEntries(ratingEntries);
  const selectedIds = movieIds ? new Set(movieIds.map(normalizeMovieId).filter(Boolean)) : null;
  const ids = [...ratingGroups.keys()].filter((id) => !selectedIds || selectedIds.has(id));
  const selectedEntries = selectedIds
    ? ratingEntries.filter((entry) => selectedIds.has(normalizeMovieId(entry?.data?.movieId)))
    : ratingEntries;
  const refs = ids.map((id) => db.collection("movies").doc(id));
  const movieSnapshots = refs.length > 0 ? await db.getAll(...refs) : [];
  const movieDocuments = movieSnapshots.map((snapshot) => ({
    id: snapshot.id,
    data: snapshot.exists ? snapshot.data() : null,
  }));
  const violations = findProjectionViolations({ ratingEntries: selectedEntries, movieDocuments });

  let repairedCount = 0;
  if (apply && violations.length > 0) {
    for (let offset = 0; offset < violations.length; offset += REPAIR_BATCH_LIMIT) {
      const batch = db.batch();
      violations.slice(offset, offset + REPAIR_BATCH_LIMIT).forEach(({ movieId, expected }) => {
        batch.set(db.collection("movies").doc(movieId), expected, { merge: true });
      });
      await batch.commit();
      repairedCount += Math.min(REPAIR_BATCH_LIMIT, violations.length - offset);
    }
  }

  return {
    scannedRatings: ratingEntries.length,
    scannedMovieIds: ids.length,
    violationCount: violations.length,
    repairedCount,
    violations,
  };
}

module.exports = {
  findProjectionViolations,
  groupRatingEntries,
  normalizeMovieId,
  projectionDiff,
  scanRatingProjectionIntegrity,
};
