export function mergeProviderRatingRecord(movie, record, now = Date.now()) {
    const expiresAt = Number(record?.expiresAt);
    if (!movie || !record || !Number.isFinite(expiresAt) || expiresAt <= now) return movie;

    const nextMovie = { ...movie };
    const nextVotes = { ...(movie.votes || {}) };
    let changed = false;

    for (const provider of ['kp', 'imdb']) {
        const ratingField = `${provider}Rating`;
        const cachedRating = Number(record[ratingField]) || 0;
        const currentRating = Number(movie[ratingField] ?? movie.rating?.[provider]) || 0;
        if (currentRating <= 0 && cachedRating > 0) {
            nextMovie[ratingField] = cachedRating;
            changed = true;
        }

        const cachedVotes = Number(record.votes?.[provider]) || 0;
        const currentVotes = Number(movie.votes?.[provider]) || 0;
        if (currentVotes <= 0 && cachedVotes > 0) {
            nextVotes[provider] = cachedVotes;
            changed = true;
        }
    }

    if (!changed) return movie;
    nextMovie.votes = nextVotes;
    return nextMovie;
}

export function buildProviderRatingCache(items) {
    const cache = {};

    for (const item of Array.isArray(items) ? items : []) {
        const movie = item?.movie || item;
        const movieId = movie?.kinopoiskId || item?.movieId || item?.id;
        if (!movieId) continue;

        const kpRating = Number(
            movie.kpRating ?? movie.rating?.kp ?? item?.kpRating ?? item?.rating?.kp
        ) || 0;
        const imdbRating = Number(
            movie.imdbRating ?? movie.rating?.imdb ?? item?.imdbRating ?? item?.rating?.imdb
        ) || 0;
        const votes = {
            kp: Number(movie.votes?.kp ?? item?.votes?.kp ?? item?.kpVotes) || 0,
            imdb: Number(movie.votes?.imdb ?? item?.votes?.imdb ?? item?.imdbVotes) || 0
        };
        if (kpRating <= 0 && imdbRating <= 0 && votes.kp <= 0 && votes.imdb <= 0) continue;

        cache[`kp:${movieId}`] = {
            kpRating,
            imdbRating,
            votes,
            expiresAt: Number.MAX_SAFE_INTEGER
        };
    }

    return cache;
}

export function mergeProviderRatingsIntoMovies(items, cache, now = Date.now()) {
    if (!Array.isArray(items) || !cache || typeof cache !== 'object') return items;

    return items.map(item => {
        const isWrappedItem = Boolean(item?.movie && typeof item.movie === 'object');
        const movie = isWrappedItem ? item.movie : item;
        const movieId = movie?.kinopoiskId || item?.movieId || item?.id;
        const record = movieId ? cache[`kp:${movieId}`] : null;
        const mergedMovie = mergeProviderRatingRecord(movie, record, now);
        if (mergedMovie === movie) return item;
        return isWrappedItem ? { ...item, movie: mergedMovie } : mergedMovie;
    });
}
