/**
 * Achievement progress: pure functions from plain data (rating documents,
 * shared movie documents, reaction summaries, marathon items, list counts) to
 * the value of every metric and the reached tier of every achievement.
 * Persistence and Firestore reads live elsewhere, so this file is testable.
 */
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, RANK_SHARES, pointsFor } from './AchievementCatalog.js';

const SERIES_TYPES = new Set(['tv-series', 'mini-series', 'animated-series', 'tv']);
const DAY_MS = 24 * 60 * 60 * 1000;

export function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (typeof value === 'object' && Number.isFinite(value.seconds)) return value.seconds * 1000;
    if (value instanceof Date) return value.getTime();
    const parsed = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function scoreOf(rating) {
    const value = Number(rating?.rating);
    if (!Number.isFinite(value) || value <= 0) return null;
    const rounded = Math.round(value);
    return rounded >= 1 && rounded <= 10 ? rounded : null;
}

const names = list => (Array.isArray(list) ? list : [])
    .map(item => String(item?.name ?? item ?? '').trim().toLowerCase())
    .filter(Boolean);

function movieFor(movies, movieId) {
    if (!movies || movieId == null) return null;
    return movies[movieId] || movies[String(movieId)] || movies[Number(movieId)] || null;
}

/** Longest run of consecutive calendar days (local time) with a rating. */
export function longestStreak(timestamps) {
    const days = [...new Set(timestamps.filter(Boolean).map(time => {
        const date = new Date(time);
        return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
    }))].sort((a, b) => a - b);
    let best = 0;
    let run = 0;
    for (let index = 0; index < days.length; index++) {
        run = index > 0 && days[index] - days[index - 1] === 1 ? run + 1 : 1;
        best = Math.max(best, run);
    }
    return best;
}

function isHalloweenSeason(time) {
    const date = new Date(time);
    const month = date.getMonth();
    const day = date.getDate();
    return (month === 9 && day >= 17) || (month === 10 && day <= 7);
}

/**
 * Every metric the catalog counts.
 * @param {Object} data - { ratings, movies, reactionSummaries, reactionsGiven, marathonItems,
 *   watchlistCount, watchingCount, collections, pinned, createdAt, now }
 */
export function computeMetrics(data = {}) {
    const ratings = Array.isArray(data.ratings) ? data.ratings : [];
    const movies = data.movies || {};
    const now = Number(data.now) || Date.now();
    const countries = new Set();
    const genres = new Set();
    const decades = new Set();
    const actors = new Set();
    const directors = new Set();
    const scores = new Set();
    const metrics = {
        ratings: 0, series: 0, tens: 0, lows: 0, classics: 0, anime: 0, cartoons: 0,
        reviews: 0, longReviews: 0, nightRatings: 0, halloweenHorror: 0, hours: 0
    };
    let minutes = 0;
    const times = [];

    for (const rating of ratings) {
        const score = scoreOf(rating);
        if (!score) continue;
        metrics.ratings++;
        scores.add(score);
        if (score === 10) metrics.tens++;
        if (score <= 3) metrics.lows++;
        const time = toMillis(rating.createdAt);
        if (time) {
            times.push(time);
            const hour = new Date(time).getHours();
            if (hour >= 2 && hour < 5) metrics.nightRatings++;
        }
        const text = [rating.comment, rating.review].find(value => typeof value === 'string' && value.trim());
        if (text) {
            metrics.reviews++;
            if (Array.from(text.trim()).length >= 1000) metrics.longReviews++;
        }

        const movie = movieFor(movies, rating.movieId);
        if (!movie) continue;
        const movieGenres = names(movie.genres);
        movieGenres.forEach(genre => genres.add(genre));
        names(movie.countries).forEach(country => countries.add(country));
        const isSeries = Boolean(movie.isSeries || SERIES_TYPES.has(movie.type));
        if (isSeries) metrics.series++;
        if (movieGenres.includes('аниме') || movie.type === 'anime') metrics.anime++;
        if (movieGenres.includes('мультфильм') || movie.type === 'cartoon' || movie.type === 'animated-series') metrics.cartoons++;
        if (time && isHalloweenSeason(time) && movieGenres.includes('ужасы')) metrics.halloweenHorror++;
        const year = Number(movie.year);
        if (Number.isInteger(year) && year >= 1880 && year <= 2100) {
            decades.add(Math.floor(year / 10));
            if (year < 1970) metrics.classics++;
        }
        const length = Number(movie.movieLength || movie.duration || 0);
        if (!isSeries && length > 0 && length < 1000) minutes += length;
        const persons = Array.isArray(movie.persons) ? movie.persons : [];
        persons.forEach(person => {
            const id = Number(person?.id);
            if (!Number.isInteger(id) || id <= 0) return;
            const profession = String(person?.enProfession || '').toLowerCase();
            if (profession === 'actor') actors.add(id);
            if (profession === 'director' && score >= 8) directors.add(id);
        });
    }

    const summaries = Array.isArray(data.reactionSummaries) ? data.reactionSummaries : [];
    const marathonItems = (Array.isArray(data.marathonItems) ? data.marathonItems : []).filter(item => item && item.state !== 'removed');
    const collections = Array.isArray(data.collections) ? data.collections : [];
    const createdAt = toMillis(data.createdAt);

    return {
        ...metrics,
        hours: Math.floor(minutes / 60),
        streak: longestStreak(times),
        countries: countries.size,
        genres: genres.size,
        decades: decades.size,
        actors: actors.size,
        directors: directors.size,
        distinctScores: scores.size,
        reactionsReceived: summaries.reduce((sum, summary) => sum + (Number(summary?.total) || 0), 0),
        reactionsGiven: Number(data.reactionsGiven) || 0,
        marathonRounds: new Set(marathonItems.map(item => Number(item.roundId)).filter(Number.isInteger)).size,
        marathonWatched: marathonItems.filter(item => item.state === 'watched').length,
        watchlist: Number(data.watchlistCount) || 0,
        watching: Number(data.watchingCount) || 0,
        collections: collections.length,
        collectionItems: collections.reduce((sum, collection) => sum + (Array.isArray(collection?.movieIds) ? collection.movieIds.length : 0), 0),
        pinned: Array.isArray(data.pinned) ? data.pinned.length : 0,
        accountDays: createdAt ? Math.max(0, Math.floor((now - createdAt) / DAY_MS)) : 0
    };
}

/** Reached tier, next threshold and progress of one achievement for a metric value. */
export function evaluate(def, value) {
    const tier = def.tiers.filter(threshold => value >= threshold).length;
    const next = def.tiers[tier] ?? null;
    const previous = tier > 0 ? def.tiers[tier - 1] : 0;
    const progress = next === null ? 1 : Math.max(0, Math.min(1, (value - previous) / (next - previous)));
    return { id: def.id, value, tier, total: def.tiers.length, next, progress };
}

export function evaluateAll(metrics) {
    return ACHIEVEMENTS.map(def => evaluate(def, Number(metrics[def.metric]) || 0));
}

/**
 * Merges freshly computed tiers into the stored record. Tiers never go down
 * (an earned tier stays earned after a rating is deleted) and each newly
 * reached tier gets an unlock date.
 * @returns {{ stored: Object, unlocked: Array<{id, tier}>, changed: boolean }}
 */
export function mergeUnlocks(stored = {}, results = [], nowIso = new Date().toISOString()) {
    const next = {};
    const unlocked = [];
    let changed = false;
    for (const def of ACHIEVEMENTS) {
        const previous = stored?.[def.id];
        const previousTier = Math.max(0, Math.min(def.tiers.length, Number(previous?.tier) || 0));
        const at = previous?.at && typeof previous.at === 'object' ? { ...previous.at } : {};
        const result = results.find(item => item.id === def.id);
        const reached = Math.max(previousTier, result?.tier || 0);
        for (let tier = previousTier + 1; tier <= reached; tier++) {
            at[tier] = nowIso;
            unlocked.push({ id: def.id, tier });
            changed = true;
        }
        if (reached > 0) next[def.id] = { tier: reached, at };
    }
    return { stored: next, unlocked, changed };
}

export function totalPoints(stored = {}) {
    return Object.entries(stored).reduce((sum, [id, entry]) => sum + pointsFor(ACHIEVEMENTS_BY_ID[id], Number(entry?.tier) || 0), 0);
}

export function maxPoints() {
    return ACHIEVEMENTS.reduce((sum, def) => sum + pointsFor(def, def.tiers.length), 0);
}

/**
 * Frame shown for a rank: the owner may pick any unlocked rank's frame; an
 * unset or out-of-range choice falls back to the current rank.
 */
export function frameLevel(rankLevel, chosen) {
    const rank = Math.max(0, Number(rankLevel) || 0);
    const pick = Math.floor(Number(chosen) || 0);
    return pick >= 1 && pick <= rank ? pick : rank;
}

/** Point thresholds of ranks I–VII. */
export function rankThresholds() {
    const max = maxPoints();
    return RANK_SHARES.map(share => Math.round(max * share));
}

/**
 * Profile rank for a point total.
 * @returns {{level: number, points: number, next: number|null, previous: number, progress: number}}
 *   level 0 means no rank yet; next is null at the top rank.
 */
export function rankFor(points) {
    const thresholds = rankThresholds();
    const value = Math.max(0, Number(points) || 0);
    const level = thresholds.filter(threshold => value >= threshold).length;
    const next = thresholds[level] ?? null;
    const previous = level > 0 ? thresholds[level - 1] : 0;
    const progress = next === null ? 1 : Math.max(0, Math.min(1, (value - previous) / (next - previous)));
    return { level, points: value, next, previous, progress };
}
