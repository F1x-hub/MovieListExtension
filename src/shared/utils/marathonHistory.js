/**
 * Past rounds of the shared movie marathon, counted from the round items and the ratings.
 *
 * Items of every round stay in randomMarathons/current/items, so nothing else has to be
 * stored. An item marked «watched» says only that the company finished the film; that a
 * person watched it is known from their own rating given while the film was on.
 * Pure functions, except loadMarathonItems.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** A film is often rated a few days after the evening it was watched. */
export const RATING_WINDOW_MS = 7 * DAY_MS;
/** One score is an opinion, not the company's. */
const MIN_RATINGS_FOR_BEST = 2;

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value === 'object' && Number.isFinite(value.seconds)) return value.seconds * 1000;
    if (value instanceof Date) return value.getTime();
    const parsed = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function scoreOf(rating) {
    const value = Math.round(Number(rating?.rating));
    return value >= 1 && value <= 10 ? value : null;
}

const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const kept = items => (Array.isArray(items) ? items : []).filter(item => item && item.state !== 'removed' && Number.isInteger(Number(item.roundId)));
const isWatched = item => item.state === 'watched';

/** Ratings by Kinopoisk ID. Legacy documents may hold the ID as a string. */
function groupByMovie(ratings) {
    const groups = new Map();
    for (const rating of Array.isArray(ratings) ? ratings : []) {
        const movieId = Number(rating?.movieId);
        if (!Number.isInteger(movieId) || scoreOf(rating) === null) continue;
        if (!groups.has(movieId)) groups.set(movieId, []);
        groups.get(movieId).push(rating);
    }
    return groups;
}

/** The rating was given from the moment the wheel picked the film to a week after it was watched. */
export function ratedWhileOn(item, rating) {
    const given = toMillis(rating?.createdAt);
    const from = toMillis(item?.selectedAt);
    const to = toMillis(item?.resolvedAt);
    return Boolean(isWatched(item) && given && from && to && given >= from && given <= to + RATING_WINDOW_MS);
}

/** People who brought films, per round. */
function bringersByRound(items) {
    const rounds = new Map();
    for (const item of items) {
        const id = Number(item.roundId);
        if (!rounds.has(id)) rounds.set(id, new Set());
        if (item.addedBy) rounds.get(id).add(item.addedBy);
    }
    return rounds;
}

/**
 * One watched film with the scores of its company. A rating also stores a name, the one
 * its author had then, often the account's real one; names come only from profiles.
 */
function toFilm(item, ratings, bringers, names = new Map()) {
    const scores = ratings
        .filter(rating => bringers.has(rating.userId) || ratedWhileOn(item, rating))
        .map(rating => ({ userId: rating.userId, name: names.get(rating.userId) || '', score: scoreOf(rating) }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return {
        kpId: Number(item.kpId) || null,
        title: String(item.title || ''),
        poster: String(item.poster || ''),
        year: item.year || null,
        roundId: Number(item.roundId),
        addedBy: item.addedBy || '',
        addedByName: item.addedByName || '',
        watchedAt: toMillis(item.resolvedAt || item.selectedAt || item.addedAt),
        scores,
        average: scores.length ? average(scores.map(entry => entry.score)) : null,
        // The person who picked a film does not speak for the company alone.
        ratedByOthers: scores.some(entry => entry.userId !== item.addedBy)
    };
}

const byScore = (a, b) => (b.average ?? -1) - (a.average ?? -1) || b.scores.length - a.scores.length || a.watchedAt - b.watchedAt;

/** The best liked film: at least two scores when any film has them. */
export function bestFilm(films) {
    const scored = films.filter(film => film.average !== null);
    const shared = scored.filter(film => film.scores.length >= MIN_RATINGS_FOR_BEST);
    return [...(shared.length ? shared : scored)].sort(byScore)[0] || null;
}

/**
 * Finished rounds, newest first, with what is known without reading ratings.
 * @param {Array} items - items of every round
 * @param {Object|null} current - the current round document
 */
export function listRounds(items, current = null) {
    const currentId = Number(current?.roundId) || Infinity;
    const groups = new Map();
    for (const item of kept(items)) {
        const id = Number(item.roundId);
        if (id > currentId || (id === currentId && current.status !== 'completed')) continue;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(item);
    }
    return [...groups]
        .map(([roundId, list]) => {
            const watched = list.filter(isWatched);
            const starts = watched.map(item => toMillis(item.selectedAt || item.addedAt)).filter(Boolean);
            const ends = watched.map(item => toMillis(item.resolvedAt || item.selectedAt)).filter(Boolean);
            return {
                roundId,
                items: list,
                films: watched.length,
                bringers: new Set(list.map(item => item.addedBy).filter(Boolean)).size,
                from: starts.length ? Math.min(...starts) : 0,
                to: ends.length ? Math.max(...ends) : 0
            };
        })
        .filter(round => round.films > 0)
        .sort((a, b) => b.roundId - a.roundId);
}

/** Films of a running round that are already watched, with their scores, by Kinopoisk ID. */
export function scoreWatched(items, ratings) {
    const all = kept(items);
    const byMovie = groupByMovie(ratings);
    const bringers = bringersByRound(all);
    return new Map(all.filter(isWatched).map(item => {
        const film = toFilm(item, byMovie.get(Number(item.kpId)) || [], bringers.get(Number(item.roundId)));
        return [film.kpId, film];
    }));
}

/** Everyone whose score may count in a round: for reading their names. */
export function raterIds(ratings) {
    return [...new Set((Array.isArray(ratings) ? ratings : []).map(rating => rating?.userId).filter(Boolean))];
}

/**
 * Films best first, the winner, and everyone's films by their average.
 * @param {Map<string, string>} names - display names by user ID
 */
export function describeRound(round, ratings, names) {
    const byMovie = groupByMovie(ratings);
    const bringers = bringersByRound(round.items).get(round.roundId) || new Set();
    const films = round.items.filter(isWatched)
        .map(item => toFilm(item, byMovie.get(Number(item.kpId)) || [], bringers, names))
        .sort(byScore);
    const people = new Map();
    for (const film of films) {
        if (!film.addedBy) continue;
        const person = people.get(film.addedBy) || { userId: film.addedBy, name: film.addedByName, films: 0, averages: [] };
        person.films++;
        if (film.ratedByOthers) person.averages.push(film.average);
        people.set(film.addedBy, person);
    }
    return {
        films,
        best: bestFilm(films),
        people: [...people.values()]
            .map(({ averages, ...person }) => ({ ...person, average: averages.length ? average(averages) : null }))
            .sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || b.films - a.films)
    };
}

/**
 * Which rounds a person took part in: by bringing a film or by rating one while it was on.
 * @param {Array} ownRatings - the person's own ratings
 */
export function participation(items, uid, ownRatings) {
    const own = groupByMovie(ownRatings);
    const rounds = new Set();
    let brought = 0;
    let broughtWatched = 0;
    let watched = 0;
    for (const item of kept(items)) {
        const mine = Boolean(uid) && item.addedBy === uid;
        if (mine) {
            brought++;
            if (isWatched(item)) broughtWatched++;
        }
        const saw = (own.get(Number(item.kpId)) || []).some(rating => ratedWhileOn(item, rating));
        if (saw) watched++;
        if (mine || saw) rounds.add(Number(item.roundId));
    }
    return { rounds: rounds.size, brought, broughtWatched, watched };
}

/**
 * A person's marathon history for the profile.
 * @param {Array} ratings - everyone's ratings of the films this person brought
 */
export function summarizePerson(items, uid, ownRatings, ratings) {
    const all = kept(items);
    const byMovie = groupByMovie(ratings);
    const bringers = bringersByRound(all);
    const films = all.filter(item => item.addedBy === uid && isWatched(item))
        .map(item => toFilm(item, byMovie.get(Number(item.kpId)) || [], bringers.get(Number(item.roundId))))
        .sort((a, b) => b.watchedAt - a.watchedAt);
    const scored = films.filter(film => film.ratedByOthers);
    return {
        ...participation(all, uid, ownRatings),
        films,
        average: scored.length ? average(scored.map(film => film.average)) : null,
        best: bestFilm(scored)
    };
}

const CACHE_MS = 60 * 1000;
const cache = new WeakMap();

/** Items of every round; the profile's statistics and achievements share one read. */
export function loadMarathonItems(db) {
    const saved = cache.get(db);
    if (saved && saved.expiresAt > Date.now()) return saved.promise;
    const promise = db.collection('randomMarathons').doc('current').collection('items').get()
        .then(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    cache.set(db, { expiresAt: Date.now() + CACHE_MS, promise });
    promise.catch(() => cache.delete(db));
    return promise;
}
