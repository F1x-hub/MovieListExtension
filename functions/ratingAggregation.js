function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function isAggregateRelevantRatingChange(before, after) {
  if (!before || !after) return true;

  return Number(before.rating) !== Number(after.rating)
    || String(before.movieId ?? '') !== String(after.movieId ?? '')
    || String(before.userId ?? '') !== String(after.userId ?? '');
}

function selectUniqueMovieRatings(entries, movieId) {
  const normalizedMovieId = Number(movieId);
  const selectedByUser = new Map();

  for (const entry of entries) {
    const data = entry?.data || {};
    const rating = Number(data.rating);
    if (!Number.isFinite(rating) || Number(data.movieId) !== normalizedMovieId) continue;

    const documentId = String(entry.id || '');
    const userId = typeof data.userId === 'string' ? data.userId.trim() : '';
    // Preserve malformed historical rows independently rather than merging
    // them with a legitimate user record.
    const key = userId ? `user:${userId}` : `legacy:${documentId}`;
    const candidate = {
      ...entry,
      isCanonical: Boolean(userId && documentId === `${userId}_${normalizedMovieId}`),
      updatedAtMillis: timestampToMillis(data.updatedAt || data.createdAt || entry.updateTime || entry.createTime)
    };
    const current = selectedByUser.get(key);

    if (!current
      || (candidate.isCanonical && !current.isCanonical)
      || (candidate.isCanonical === current.isCanonical
        && (candidate.updatedAtMillis > current.updatedAtMillis
          || (candidate.updatedAtMillis === current.updatedAtMillis
            && documentId > String(current.id || ''))))) {
      selectedByUser.set(key, candidate);
    }
  }

  return [...selectedByUser.values()];
}

function buildMovieRatingProjection(entries, movieId) {
  const normalizedMovieId = Number(movieId);
  if (!Number.isInteger(normalizedMovieId) || normalizedMovieId <= 0) {
    return null;
  }

  const selectedRatings = selectUniqueMovieRatings(entries, normalizedMovieId);
  const ratingsSum = selectedRatings.reduce((sum, entry) => sum + Number(entry.data.rating), 0);
  const ratingsCount = selectedRatings.length;
  const latestRating = selectedRatings.reduce((latest, entry) => {
    const timestamp = entry.data.updatedAt
      || entry.data.createdAt
      || entry.updateTime
      || entry.createTime
      || null;
    if (!timestamp) return latest;
    if (!latest) return { timestamp, millis: timestampToMillis(timestamp) };

    const millis = timestampToMillis(timestamp);
    return millis > latest.millis
      || (millis === latest.millis && String(entry.id || '') > String(latest.id || ''))
      ? { timestamp, millis, id: entry.id }
      : latest;
  }, null);

  return {
    kinopoiskId: normalizedMovieId,
    ratingsCount,
    ratingsSum,
    avgRating: ratingsCount > 0 ? Math.round((ratingsSum / ratingsCount) * 10) / 10 : 0,
    hasCommunityRating: ratingsCount > 0,
    hasRatings: ratingsCount > 0,
    lastRatingUpdatedAt: latestRating?.timestamp || null,
  };
}

function isMovieRatingProjectionHealthy(movieData) {
  if (!movieData || movieData.hasCommunityRating !== true || movieData.hasRatings !== true) {
    return false;
  }

  const ratingsCount = Number(movieData.ratingsCount);
  const ratingsSum = Number(movieData.ratingsSum);
  const avgRating = Number(movieData.avgRating);
  return Number.isInteger(ratingsCount)
    && ratingsCount > 0
    && Number.isFinite(ratingsSum)
    && Number.isFinite(avgRating)
    && movieData.lastRatingUpdatedAt != null;
}

module.exports = {
  buildMovieRatingProjection,
  isAggregateRelevantRatingChange,
  isMovieRatingProjectionHealthy,
  selectUniqueMovieRatings,
};
