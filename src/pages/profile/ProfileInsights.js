/**
 * Profile insights: pure calculations behind the profile statistics, taste
 * match, received reactions, marathon history and pinned favorites. Inputs are
 * plain objects (rating documents, shared movie documents, reaction summaries,
 * marathon items) so every function can be tested without Firestore.
 */

export const PINNED_LIMIT = 5;
export const LIKED_RATING = 8;
export const MIN_MATCH_COMMON = 3;
const SERIES_TYPES = new Set(['tv-series', 'mini-series', 'animated-series', 'tv']);

/** Rounded 1-10 score, or null for legacy/invalid values. */
export function scoreOf(rating) {
    const value = Number(rating?.rating);
    if (!Number.isFinite(value) || value <= 0) return null;
    const rounded = Math.round(value);
    return rounded >= 1 && rounded <= 10 ? rounded : null;
}

/** Milliseconds from a Firestore Timestamp, {seconds}, Date, number or string. */
export function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (typeof value === 'object' && Number.isFinite(value.seconds)) return value.seconds * 1000;
    if (value instanceof Date) return value.getTime();
    const parsed = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function movieFor(movies, movieId) {
    if (!movies || movieId == null) return null;
    return movies[movieId] || movies[String(movieId)] || movies[Number(movieId)] || null;
}

function isSeries(movie) {
    return Boolean(movie?.isSeries || SERIES_TYPES.has(movie?.type));
}

/**
 * Minutes of rated films (series are left out: a rating says nothing about how
 * many episodes were watched).
 * @returns {{minutes: number, films: number, unknown: number, series: number}}
 */
export function computeWatchTime(ratings = [], movies = {}) {
    let minutes = 0;
    let films = 0;
    let unknown = 0;
    let series = 0;
    for (const rating of ratings) {
        const movie = movieFor(movies, rating.movieId);
        if (isSeries(movie)) { series++; continue; }
        const length = Number(movie?.movieLength || movie?.duration || 0);
        if (Number.isFinite(length) && length > 0 && length < 1000) {
            minutes += length;
            films++;
        } else {
            unknown++;
        }
    }
    return { minutes, films, unknown, series };
}

/**
 * Ratings per calendar month for the last `months` months, oldest first.
 * @returns {Array<{year: number, month: number, count: number}>}
 */
export function computeMonthlyActivity(ratings = [], now = Date.now(), months = 12) {
    const end = new Date(now);
    const buckets = [];
    for (let offset = months - 1; offset >= 0; offset--) {
        const date = new Date(end.getFullYear(), end.getMonth() - offset, 1);
        buckets.push({ year: date.getFullYear(), month: date.getMonth(), count: 0 });
    }
    const index = new Map(buckets.map((bucket, position) => [`${bucket.year}-${bucket.month}`, position]));
    for (const rating of ratings) {
        const time = toMillis(rating.createdAt);
        if (!time) continue;
        const date = new Date(time);
        const position = index.get(`${date.getFullYear()}-${date.getMonth()}`);
        if (position !== undefined) buckets[position].count++;
    }
    return buckets;
}

/**
 * Rated titles per release decade, oldest decade first.
 * @returns {Array<{decade: number, count: number}>}
 */
export function computeDecades(ratings = [], movies = {}) {
    const counts = new Map();
    for (const rating of ratings) {
        const year = Number(movieFor(movies, rating.movieId)?.year);
        if (!Number.isInteger(year) || year < 1880 || year > 2100) continue;
        const decade = Math.floor(year / 10) * 10;
        counts.set(decade, (counts.get(decade) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([decade, count]) => ({ decade, count }))
        .sort((a, b) => a.decade - b.decade);
}

/**
 * Actors and directors that recur among highly rated titles. Only top-billed
 * actors count so crowds of extras do not dominate.
 * @returns {{actors: Array, directors: Array, basis: number}}
 */
export function computeFavoritePeople(ratings = [], movies = {}, { minRating = LIKED_RATING, actorsPerMovie = 10, minCount = 2, limit = 6 } = {}) {
    const actors = new Map();
    const directors = new Map();
    let basis = 0;
    const add = (map, person, movieId) => {
        const id = Number(person?.id);
        const name = String(person?.name || person?.enName || '').trim();
        if (!Number.isInteger(id) || id <= 0 || !name) return;
        const entry = map.get(id) || { id, name, photo: person.photo || '', count: 0, movieIds: new Set() };
        if (entry.movieIds.has(movieId)) return;
        entry.movieIds.add(movieId);
        entry.count++;
        map.set(id, entry);
    };
    for (const rating of ratings) {
        if ((scoreOf(rating) || 0) < minRating) continue;
        const movie = movieFor(movies, rating.movieId);
        const persons = Array.isArray(movie?.persons) ? movie.persons : [];
        if (!persons.length) continue;
        basis++;
        const movieId = String(rating.movieId);
        persons.filter(person => String(person?.enProfession || '').toLowerCase() === 'actor')
            .slice(0, actorsPerMovie)
            .forEach(person => add(actors, person, movieId));
        persons.filter(person => String(person?.enProfession || '').toLowerCase() === 'director')
            .forEach(person => add(directors, person, movieId));
    }
    const top = map => [...map.values()]
        .filter(entry => entry.count >= minCount)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, limit)
        .map(({ movieIds, ...entry }) => entry);
    return { actors: top(actors), directors: top(directors).slice(0, 3), basis };
}

/**
 * Agreement between two users over movies both rated.
 * score: 100 = identical scores, 0 = opposite ends of the scale.
 * @returns {{score: number|null, common: number, bothLiked: Array, disagreements: Array}}
 */
export function computeTasteMatch(ownRatings = [], otherRatings = [], { minCommon = MIN_MATCH_COMMON } = {}) {
    const own = new Map();
    for (const rating of ownRatings) {
        const score = scoreOf(rating);
        if (score && rating.movieId != null && !own.has(String(rating.movieId))) own.set(String(rating.movieId), score);
    }
    const pairs = [];
    const seen = new Set();
    for (const rating of otherRatings) {
        const movieId = String(rating.movieId ?? '');
        const theirs = scoreOf(rating);
        if (!movieId || !theirs || seen.has(movieId) || !own.has(movieId)) continue;
        seen.add(movieId);
        pairs.push({ movieId, mine: own.get(movieId), theirs });
    }
    const similarity = pairs.reduce((sum, pair) => sum + (1 - Math.abs(pair.mine - pair.theirs) / 9), 0);
    const score = pairs.length >= minCommon ? Math.round((similarity / pairs.length) * 100) : null;
    const bothLiked = pairs
        .filter(pair => pair.mine >= LIKED_RATING && pair.theirs >= LIKED_RATING)
        .sort((a, b) => (b.mine + b.theirs) - (a.mine + a.theirs))
        .slice(0, 6);
    const disagreements = pairs
        .filter(pair => Math.abs(pair.mine - pair.theirs) >= 3)
        .sort((a, b) => Math.abs(b.mine - b.theirs) - Math.abs(a.mine - a.theirs))
        .slice(0, 5);
    return { score, common: pairs.length, bothLiked, disagreements };
}

/** Rating documents that can carry reactions: reactions belong to a written review. */
export function reactableRatingIds(ratings = []) {
    return ratings
        .filter(rating => rating?.id && [rating.comment, rating.review].some(text => typeof text === 'string' && text.trim()))
        .map(rating => String(rating.id));
}

/**
 * Totals from commentReactionSummaries documents ({ratingId, movieId, counts, total}).
 * @returns {{total: number, reviews: number, byType: Array, top: Array}}
 */
export function summarizeReactions(summaries = []) {
    const byType = new Map();
    let total = 0;
    const withTotals = [];
    for (const summary of summaries) {
        const summaryTotal = Number(summary?.total) || 0;
        if (summaryTotal <= 0) continue;
        total += summaryTotal;
        withTotals.push({ ratingId: String(summary.ratingId || summary.id || ''), movieId: summary.movieId != null ? String(summary.movieId) : null, total: summaryTotal });
        Object.entries(summary.counts || {}).forEach(([type, count]) => {
            const value = Number(count) || 0;
            if (value > 0) byType.set(type, (byType.get(type) || 0) + value);
        });
    }
    return {
        total,
        reviews: withTotals.length,
        byType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
        top: withTotals.sort((a, b) => b.total - a.total).slice(0, 3)
    };
}

/**
 * A user's random-marathon participation from the items they added.
 * @returns {{added: number, rounds: number, selected: number, watched: Array}}
 */
export function summarizeMarathon(items = []) {
    const active = items.filter(item => item && item.state !== 'removed');
    const rounds = new Set(active.map(item => Number(item.roundId)).filter(Number.isInteger));
    const watched = active
        .filter(item => item.state === 'watched')
        .sort((a, b) => toMillis(b.resolvedAt || b.selectedAt || b.addedAt) - toMillis(a.resolvedAt || a.selectedAt || a.addedAt));
    return {
        added: active.length,
        rounds: rounds.size,
        selected: active.filter(item => ['selected', 'watched'].includes(item.state)).length,
        watched: watched.slice(0, 6).map(item => ({
            movieId: item.kpId != null ? String(item.kpId) : null,
            title: String(item.title || ''),
            posterUrl: String(item.poster || ''),
            year: item.year || null,
            roundId: Number(item.roundId) || null
        }))
    };
}

/** Pinned favorites as stored on the profile: at most PINNED_LIMIT unique entries. */
export function normalizePinned(list) {
    const seen = new Set();
    const result = [];
    for (const entry of Array.isArray(list) ? list : []) {
        const movieId = String(entry?.movieId ?? '').trim();
        if (!/^\d+$/.test(movieId) || seen.has(movieId)) continue;
        seen.add(movieId);
        result.push({
            movieId,
            title: String(entry.title || '').slice(0, 200),
            posterUrl: String(entry.posterUrl || '').slice(0, 500),
            year: Number.isInteger(Number(entry.year)) && Number(entry.year) > 0 ? Number(entry.year) : null
        });
        if (result.length >= PINNED_LIMIT) break;
    }
    return result;
}

/** Swaps two pinned places; out-of-range or equal positions return the list unchanged. */
export function swapPinned(list, from, to) {
    const current = normalizePinned(list);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to
        || from < 0 || to < 0 || from >= current.length || to >= current.length) return current;
    [current[from], current[to]] = [current[to], current[from]];
    return current;
}

/** Pins or unpins one movie; a full list refuses new pins (returns null). */
export function togglePinned(list, movie) {
    const current = normalizePinned(list);
    const movieId = String(movie?.movieId ?? '');
    if (current.some(entry => entry.movieId === movieId)) {
        return current.filter(entry => entry.movieId !== movieId);
    }
    if (current.length >= PINNED_LIMIT) return null;
    return normalizePinned([...current, movie]);
}
