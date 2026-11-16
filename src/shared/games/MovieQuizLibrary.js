/**
 * The player's own movies for the quiz: «Буду смотреть», favourites and rated
 * titles, read from Firestore without spending Kinopoisk API quota.
 *
 * List documents carry their own title, year, poster and description; rated
 * titles take theirs from the shared `movies` cache. The compact result is kept
 * in memory for a few minutes so «Play again» does not read Firestore again.
 */

export const LIBRARY_MIN_MOVIES = 5;
const LIBRARY_CACHE_TTL_MS = 10 * 60 * 1000;
// A large rating history is sampled: the quiz needs variety, not every title.
const MAX_RATING_DOCS = 400;
const MAX_RATED_LOOKUPS = 150;

const memoryCache = new Map();

export class QuizLibraryError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'QuizLibraryError';
        this.code = code;
    }
}

function toId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function toYear(value) {
    const year = Number(value);
    return Number.isInteger(year) && year > 1800 && year < 2200 ? year : null;
}

function toGenres(genres) {
    if (!Array.isArray(genres)) return [];
    return genres
        .map(genre => (typeof genre === 'object' ? genre?.name : genre))
        .filter(genre => typeof genre === 'string' && genre.trim())
        .map(genre => genre.trim().toLowerCase());
}

/** Accepts only https poster addresses; anything else is not shown. */
export function safePosterUrl(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 2048) return '';
    const input = value.trim();
    try {
        const url = new URL(input.startsWith('//') ? `https:${input}` : input);
        if (url.protocol === 'http:') url.protocol = 'https:';
        if (url.protocol !== 'https:' || url.username || url.password) return '';
        return url.href;
    } catch {
        return '';
    }
}

/** A watchlist or favourites document as a quiz movie. */
export function movieFromListDoc(doc) {
    const kinopoiskId = toId(doc?.movieId);
    const name = String(doc?.movieTitleRu || doc?.movieTitle || '').trim();
    if (!kinopoiskId || !name) return null;
    return {
        kinopoiskId,
        name,
        year: toYear(doc.releaseYear),
        posterUrl: safePosterUrl(doc.posterPath || doc.posterUrl),
        description: String(doc.description || '').trim(),
        genres: toGenres(doc.genres),
        // Favourites record the Kinopoisk type; the watchlist does not.
        ...(typeof doc.type === 'string' && doc.type ? { type: doc.type } : {})
    };
}

/** A `movies` cache entry (Kinopoisk shape) as a quiz movie. */
export function movieFromCachedMovie(movie, fallbackId) {
    const kinopoiskId = toId(movie?.kinopoiskId ?? fallbackId);
    const name = String(movie?.name || movie?.alternativeName || movie?.enName || '').trim();
    if (!kinopoiskId || !name) return null;
    return {
        kinopoiskId,
        name,
        year: toYear(movie.year),
        posterUrl: safePosterUrl(movie.posterUrl || movie.poster?.url),
        description: String(movie.description || movie.shortDescription || '').trim(),
        genres: toGenres(movie.genres),
        // Wrong answers keep to Soviet, Russian or foreign films like the right one.
        countries: toGenres(movie.countries),
        type: typeof movie.type === 'string' ? movie.type : '',
        isSeries: movie.isSeries === true
    };
}

/** A movie can carry a question when it has a poster or a description. */
export function isQuizUsable(movie) {
    return Boolean(movie && (movie.posterUrl || movie.description));
}

function mergeMovie(target, movie) {
    if (!movie) return;
    const existing = target.get(movie.kinopoiskId);
    if (!existing) {
        target.set(movie.kinopoiskId, movie);
        return;
    }
    // Fill gaps from another source without replacing what is already known.
    for (const key of ['year', 'posterUrl', 'description', 'type']) {
        if (!existing[key] && movie[key]) existing[key] = movie[key];
    }
    if (!existing.genres.length && movie.genres.length) existing.genres = movie.genres;
}

function sample(items, count, random = Math.random) {
    const pool = [...items];
    for (let index = pool.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [pool[index], pool[swap]] = [pool[swap], pool[index]];
    }
    return pool.slice(0, count);
}

async function readUserDocs(db, collection, uid, limit = 0) {
    let query = db.collection(collection).where('userId', '==', uid);
    if (limit) query = query.limit(limit);
    const snapshot = await query.get();
    const docs = [];
    snapshot.forEach(doc => docs.push(doc.data()));
    return docs;
}

/**
 * Loads the signed-in player's movies. Throws QuizLibraryError with code
 * `unavailable` (no Firebase on this page) or `signed-out`.
 */
export async function loadLibraryMovies({ firebaseManager, ensureMovieCacheService, signal, now = Date.now } = {}) {
    if (!firebaseManager?.db) throw new QuizLibraryError('unavailable');
    const user = (await firebaseManager.waitForAuthReady?.(1500)) || firebaseManager.getCurrentUser?.();
    if (signal?.aborted) throw new DOMException('Quiz library loading aborted', 'AbortError');
    const uid = user?.uid;
    if (!uid) throw new QuizLibraryError('signed-out');

    const cached = memoryCache.get(uid);
    if (cached && now() - cached.at < LIBRARY_CACHE_TTL_MS) return cached.movies.map(movie => ({ ...movie }));

    const db = firebaseManager.db;
    const [watchlist, favorites, ratings] = await Promise.all([
        readUserDocs(db, 'watchlist', uid).catch(() => []),
        readUserDocs(db, 'favorites', uid).catch(() => []),
        readUserDocs(db, 'ratings', uid, MAX_RATING_DOCS).catch(() => [])
    ]);
    if (signal?.aborted) throw new DOMException('Quiz library loading aborted', 'AbortError');

    const movies = new Map();
    [...watchlist, ...favorites].forEach(doc => mergeMovie(movies, movieFromListDoc(doc)));

    const ratedIds = [...new Set(ratings.map(doc => toId(doc.movieId)).filter(Boolean))]
        .filter(id => !movies.has(id));
    if (ratedIds.length) {
        try {
            const cacheService = await ensureMovieCacheService?.();
            const lookups = sample(ratedIds, MAX_RATED_LOOKUPS);
            const cachedMovies = cacheService ? await cacheService.getBatchCachedMovies(lookups) : {};
            Object.entries(cachedMovies || {}).forEach(([id, movie]) => mergeMovie(movies, movieFromCachedMovie(movie, id)));
        } catch {
            // Rated titles only widen the pool; the lists alone may be enough.
        }
    }
    if (signal?.aborted) throw new DOMException('Quiz library loading aborted', 'AbortError');

    const result = [...movies.values()].filter(isQuizUsable);
    memoryCache.set(uid, { at: now(), movies: result.map(movie => ({ ...movie })) });
    return result;
}

/** Test hook: forget cached libraries. */
export function clearLibraryCache() {
    memoryCache.clear();
}
