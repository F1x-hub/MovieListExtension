function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
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

module.exports = { selectUniqueMovieRatings };
