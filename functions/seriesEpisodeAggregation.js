function buildSeriesEpisodeStats(documents, movieId) {
  if (!Number.isInteger(movieId) || movieId <= 0) return null;
  const episodes = {};
  for (const data of documents) {
    if (data?.movieId !== movieId || !data.episodes || typeof data.episodes !== "object") continue;
    for (const [key, entry] of Object.entries(data.episodes)) {
      if (!/^[0-9]{1,3}:[0-9]{1,5}$/.test(key)
        || !Number.isInteger(entry?.r) || entry.r < 1 || entry.r > 10) continue;
      const value = episodes[key] ||= { sum: 0, count: 0, avg: 0 };
      value.sum += entry.r;
      value.count += 1;
    }
  }
  for (const value of Object.values(episodes)) value.avg = Math.round(value.sum / value.count * 10) / 10;
  const ratedEpisodes = Object.keys(episodes).length;
  return ratedEpisodes ? { movieId, episodes, ratedEpisodes } : null;
}

async function rebuildSeriesEpisodeStats(db, movieId, updatedAt) {
  if (!Number.isInteger(movieId) || movieId <= 0) return;
  const ref = db.collection("seriesEpisodeStats").doc(String(movieId));
  // Serializing through the projection prevents an older trigger from writing
  // a stale result after a newer event. Read the projection before the query.
  await db.runTransaction(async transaction => {
    await transaction.get(ref);
    const snapshot = await transaction.get(db.collection("seriesEpisodeRatings").where("movieId", "==", movieId));
    const stats = buildSeriesEpisodeStats(snapshot.docs.map(doc => doc.data()), movieId);
    if (stats) transaction.set(ref, { ...stats, updatedAt: updatedAt() });
    else transaction.delete(ref);
  });
}

module.exports = { buildSeriesEpisodeStats, rebuildSeriesEpisodeStats };
