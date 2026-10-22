import assert from 'node:assert/strict';
import {
    computeDecades,
    computeFavoritePeople,
    computeMonthlyActivity,
    computeTasteMatch,
    computeWatchTime,
    normalizePinned,
    reactableRatingIds,
    summarizeMarathon,
    summarizeReactions,
    swapPinned,
    togglePinned
} from '../src/pages/profile/ProfileInsights.js';

const movies = {
    1: { year: 1999, movieLength: 136, persons: [
        { id: 10, name: 'Киану Ривз', enProfession: 'actor' },
        { id: 20, name: 'Лана Вачовски', enProfession: 'director' }
    ] },
    2: { year: 2003, movieLength: 138, persons: [
        { id: 10, name: 'Киану Ривз', enProfession: 'actor' },
        { id: 20, name: 'Лана Вачовски', enProfession: 'director' }
    ] },
    3: { year: 2008, type: 'tv-series', isSeries: true },
    4: { year: 2005 }
};

// Watch time: films only, unknown durations and series reported separately.
assert.deepEqual(
    computeWatchTime([{ movieId: 1 }, { movieId: '2' }, { movieId: 3 }, { movieId: 4 }], movies),
    { minutes: 274, films: 2, unknown: 1, series: 1 }
);

// Decades counted per title, oldest first.
assert.deepEqual(
    computeDecades([{ movieId: 1 }, { movieId: 2 }, { movieId: 3 }, { movieId: 4 }, { movieId: 99 }], movies),
    [{ decade: 1990, count: 1 }, { decade: 2000, count: 3 }]
);

// Monthly activity: last 12 months, oldest first, only ratings inside the window.
const now = new Date(2026, 9, 21).getTime();
const activity = computeMonthlyActivity([
    { createdAt: { seconds: new Date(2026, 9, 2).getTime() / 1000 } },
    { createdAt: new Date(2026, 9, 15) },
    { createdAt: new Date(2025, 10, 1).toISOString() },
    { createdAt: new Date(2024, 0, 1) }
], now);
assert.equal(activity.length, 12);
assert.deepEqual(activity[11], { year: 2026, month: 9, count: 2 });
assert.deepEqual(activity[0], { year: 2025, month: 10, count: 1 });
assert.equal(activity.reduce((sum, bucket) => sum + bucket.count, 0), 3);

// Favorite people: only from titles rated 8+, at least two films.
const people = computeFavoritePeople([
    { movieId: 1, rating: 9 },
    { movieId: 2, rating: '8' },
    { movieId: 4, rating: 10 }
], movies);
assert.deepEqual(people.actors.map(person => [person.name, person.count]), [['Киану Ривз', 2]]);
assert.deepEqual(people.directors.map(person => person.id), [20]);
assert.equal(people.basis, 2);
assert.equal(computeFavoritePeople([{ movieId: 1, rating: 9 }, { movieId: 2, rating: 7 }], movies).actors.length, 0);

// Taste match: identical scores give 100, opposite ends give 0, too few common titles give null.
assert.equal(computeTasteMatch(
    [{ movieId: 1, rating: 9 }, { movieId: 2, rating: 8 }, { movieId: 3, rating: 7 }],
    [{ movieId: '1', rating: 9 }, { movieId: '2', rating: 8 }, { movieId: '3', rating: 7 }]
).score, 100);
assert.equal(computeTasteMatch(
    [{ movieId: 1, rating: 1 }, { movieId: 2, rating: 1 }, { movieId: 3, rating: 1 }],
    [{ movieId: 1, rating: 10 }, { movieId: 2, rating: 10 }, { movieId: 3, rating: 10 }]
).score, 0);
const partial = computeTasteMatch([{ movieId: 1, rating: 9 }], [{ movieId: 1, rating: 9 }, { movieId: 5, rating: 4 }]);
assert.equal(partial.score, null);
assert.equal(partial.common, 1);
const match = computeTasteMatch(
    [{ movieId: 1, rating: 10 }, { movieId: 2, rating: 9 }, { movieId: 3, rating: 2 }, { movieId: 4, rating: 8 }],
    [{ movieId: 1, rating: 9 }, { movieId: 2, rating: 8 }, { movieId: 3, rating: 9 }, { movieId: 4, rating: 3 }]
);
assert.deepEqual(match.bothLiked.map(pair => pair.movieId), ['1', '2']);
assert.deepEqual(match.disagreements.map(pair => pair.movieId), ['3', '4']);
assert.equal(match.common, 4);

// Reactions belong to reviews: ratings without text are not queried.
assert.deepEqual(reactableRatingIds([
    { id: 'a', comment: 'Отлично' },
    { id: 'b', comment: '   ' },
    { id: 'c', review: 'Длинная рецензия' },
    { id: 'd' }
]), ['a', 'c']);
const reactions = summarizeReactions([
    { id: 'a', movieId: 1, total: 3, counts: { like: 2, fire: 1 } },
    { id: 'c', movieId: 2, total: 5, counts: { like: 4, love: 1 } },
    { id: 'e', total: 0, counts: {} }
]);
assert.equal(reactions.total, 8);
assert.equal(reactions.reviews, 2);
assert.deepEqual(reactions.byType[0], { type: 'like', count: 6 });
assert.deepEqual(reactions.top.map(item => item.ratingId), ['c', 'a']);

// Marathon: removed items are ignored; watched ones listed newest first.
const marathon = summarizeMarathon([
    { roundId: 1, kpId: 1, title: 'A', state: 'watched', resolvedAt: { seconds: 100 } },
    { roundId: 2, kpId: 2, title: 'B', state: 'watched', resolvedAt: { seconds: 200 } },
    { roundId: 2, kpId: 3, title: 'C', state: 'queued' },
    { roundId: 3, kpId: 4, title: 'D', state: 'removed' },
    { roundId: 3, kpId: 5, title: 'E', state: 'selected' }
]);
assert.equal(marathon.added, 4);
assert.equal(marathon.rounds, 3);
assert.equal(marathon.selected, 3);
assert.deepEqual(marathon.watched.map(item => item.title), ['B', 'A']);

// Pinned favorites: unique numeric ids, at most five, toggling and a full list.
assert.deepEqual(normalizePinned([{ movieId: 1, title: 'A' }, { movieId: '1' }, { movieId: 'x' }, null]).map(item => item.movieId), ['1']);
let pinned = [];
for (let id = 1; id <= 5; id++) pinned = togglePinned(pinned, { movieId: id, title: String(id) });
assert.equal(pinned.length, 5);
assert.equal(togglePinned(pinned, { movieId: 6 }), null);
assert.deepEqual(togglePinned(pinned, { movieId: '3' }).map(item => item.movieId), ['1', '2', '4', '5']);
assert.equal(normalizePinned(Array.from({ length: 8 }, (_, index) => ({ movieId: index + 1 }))).length, 5);

// Reordering swaps two places and ignores invalid positions.
assert.deepEqual(swapPinned(pinned, 0, 1).map(item => item.movieId), ['2', '1', '3', '4', '5']);
assert.deepEqual(swapPinned(pinned, 4, 0).map(item => item.movieId), ['5', '2', '3', '4', '1']);
assert.deepEqual(swapPinned(pinned, 1, 9).map(item => item.movieId), ['1', '2', '3', '4', '5']);
assert.deepEqual(swapPinned(pinned, 2, 2).map(item => item.movieId), ['1', '2', '3', '4', '5']);

console.log('Profile insights tests passed');
