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
 * Ratings per day for a year calendar: `weeks` columns (Monday first), the last
 * one holding today. Days after today are null. Each day keeps its ratings, so
 * the page can list them without another read.
 * @returns {{weeks: Array<Array<{date: Date, count: number, ratings: Array}|null>>, max: number, total: number, activeDays: number, bestStreak: number}}
 */
export function computeDailyActivity(ratings = [], now = Date.now(), weeks = 53) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const weekday = (today.getDay() + 6) % 7;
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weekday - (weeks - 1) * 7);
    const byDay = new Map();
    for (const rating of ratings) {
        const time = toMillis(rating.createdAt);
        if (!time) continue;
        const date = new Date(time);
        const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(rating);
    }
    let max = 0;
    let total = 0;
    let activeDays = 0;
    let streak = 0;
    let bestStreak = 0;
    const columns = [];
    for (let week = 0; week < weeks; week++) {
        const days = [];
        for (let day = 0; day < 7; day++) {
            const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day);
            if (date > today) { days.push(null); continue; }
            const dayRatings = byDay.get(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`) || [];
            const count = dayRatings.length;
            max = Math.max(max, count);
            total += count;
            activeDays += count ? 1 : 0;
            streak = count ? streak + 1 : 0;
            bestStreak = Math.max(bestStreak, streak);
            days.push({ date, count, ratings: dayRatings });
        }
        columns.push(days);
    }
    return { weeks: columns, max, total, activeDays, bestStreak };
}

/**
 * Calendar shade for a day: fixed steps (0, 1, 2, 3-4, 5+), so one record day
 * does not fade every other day.
 */
export function activityLevel(count) {
    if (!(count > 0)) return 0;
    if (count >= 5) return 4;
    return count >= 3 ? 3 : count;
}

/**
 * Genres of rated titles with the average score given, most rated first.
 * @returns {Array<{name: string, count: number, average: number}>}
 */
export function computeGenres(ratings = [], movies = {}, { limit = 6 } = {}) {
    const genres = new Map();
    for (const rating of ratings) {
        const score = scoreOf(rating);
        const list = movieFor(movies, rating.movieId)?.genres;
        if (!score || !Array.isArray(list)) continue;
        const names = new Map();
        for (const genre of list) {
            const name = String(typeof genre === 'object' ? genre?.name || genre?.genre || '' : genre ?? '').trim();
            if (name) names.set(name.toLowerCase(), name);
        }
        for (const [key, name] of names) {
            const entry = genres.get(key) || { name, count: 0, sum: 0 };
            entry.count++;
            entry.sum += score;
            genres.set(key, entry);
        }
    }
    return [...genres.values()]
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, limit)
        .map(({ name, count, sum }) => ({ name, count, average: Math.round((sum / count) * 10) / 10 }));
}

/** Decades from the first to the last one, the empty ones between them included. */
export function fillDecades(decades = []) {
    if (!decades.length) return [];
    const counts = new Map(decades.map(item => [item.decade, item.count]));
    const result = [];
    for (let decade = Math.min(...counts.keys()); decade <= Math.max(...counts.keys()); decade += 10) {
        result.push({ decade, count: counts.get(decade) || 0 });
    }
    return result;
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
 * actors count so crowds of extras do not dominate. Each person carries the
 * titles behind the number (`liked`, best score first) and the lower-rated ones
 * (`other`), as `{movieId, score}`.
 * @returns {{actors: Array, directors: Array, basis: number}}
 */
export function computeFavoritePeople(ratings = [], movies = {}, { minRating = LIKED_RATING, actorsPerMovie = 10, minCount = 2, limit = 6 } = {}) {
    const actors = new Map();
    const directors = new Map();
    let basis = 0;
    const add = (map, person, film) => {
        const id = Number(person?.id);
        const name = String(person?.name || person?.enName || '').trim();
        if (!Number.isInteger(id) || id <= 0 || !name) return;
        const entry = map.get(id) || { id, name, photo: '', films: new Map() };
        entry.photo ||= person.photo || '';
        if (!entry.films.has(film.movieId)) entry.films.set(film.movieId, film);
        map.set(id, entry);
    };
    for (const rating of ratings) {
        const score = scoreOf(rating);
        if (!score) continue;
        const movie = movieFor(movies, rating.movieId);
        const persons = Array.isArray(movie?.persons) ? movie.persons : [];
        if (!persons.length) continue;
        if (score >= minRating) basis++;
        const film = { movieId: String(rating.movieId), score };
        persons.filter(person => String(person?.enProfession || '').toLowerCase() === 'actor')
            .slice(0, actorsPerMovie)
            .forEach(person => add(actors, person, film));
        persons.filter(person => String(person?.enProfession || '').toLowerCase() === 'director')
            .forEach(person => add(directors, person, film));
    }
    const top = map => [...map.values()]
        .map(({ films, ...entry }) => {
            const sorted = [...films.values()].sort((a, b) => b.score - a.score);
            const liked = sorted.filter(film => film.score >= minRating);
            return { ...entry, count: liked.length, liked, other: sorted.filter(film => film.score < minRating) };
        })
        .filter(entry => entry.count >= minCount)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, limit);
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
