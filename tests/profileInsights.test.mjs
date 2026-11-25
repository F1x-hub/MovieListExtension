import assert from 'node:assert/strict';
import {
    activityLevel,
    averageScore,
    compareScores,
    computeDecades,
    computeGenres,
    fillDecades,
    computeFavoritePeople,
    computeDailyActivity,
    computeTasteMatch,
    computeWatchTime,
    countFilms,
    normalizePinned,
    reactableRatingIds,
    searchRatings,
    selectFilms,
    sortFilms,
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

// Daily activity: 53 Monday-first weeks ending today, future days left empty.
const now = new Date(2026, 9, 21, 15).getTime(); // Wednesday
const daily = computeDailyActivity([
    { createdAt: { seconds: new Date(2026, 9, 21, 9).getTime() / 1000 } },
    { createdAt: new Date(2026, 9, 21, 20) },
    { createdAt: new Date(2026, 9, 19).toISOString() },
    { createdAt: new Date(2024, 0, 1) }
], now);
assert.equal(daily.weeks.length, 53);
const lastWeek = daily.weeks[52];
assert.equal(lastWeek[0].date.getDay(), 1);
assert.equal(lastWeek[0].count, 1);
assert.equal(lastWeek[2].count, 2);
assert.equal(lastWeek[3], null);
assert.equal(daily.max, 2);
assert.equal(daily.total, 3);
assert.equal(daily.activeDays, 2);
assert.equal(daily.bestStreak, 1, 'Monday and Wednesday are not consecutive');
assert.equal(lastWeek[2].ratings.length, 2, 'a day keeps its ratings for the list under the calendar');
assert.equal(computeDailyActivity([19, 20, 21].map(day => ({ createdAt: new Date(2026, 9, day) })), now).bestStreak, 3);
assert.deepEqual([0, 1, 2, 3, 4, 5, 40].map(activityLevel), [0, 1, 2, 3, 3, 4, 4], 'a record day does not fade the others');

// Genres: counted once per title, with the average score; titles without genres are skipped.
assert.deepEqual(computeGenres([
    { movieId: 1, rating: 10 }, { movieId: 2, rating: '7' }, { movieId: 3, rating: 4 }, { movieId: 4, rating: 9 }, { movieId: 5, rating: null }
], {
    1: { genres: [{ name: 'фантастика' }, 'боевик', 'Боевик'] },
    2: { genres: ['фантастика'] },
    3: { genres: ['драма'] },
    4: {},
    5: { genres: ['драма'] }
}, { limit: 2 }), [{ name: 'фантастика', count: 2, average: 8.5 }, { name: 'Боевик', count: 1, average: 10 }]);

// Empty decades between rated ones keep their place on the axis.
assert.deepEqual(fillDecades([{ decade: 1930, count: 1 }, { decade: 1950, count: 2 }]),
    [{ decade: 1930, count: 1 }, { decade: 1940, count: 0 }, { decade: 1950, count: 2 }]);
assert.deepEqual(fillDecades([]), []);

// The titles behind a bar are the ones the bar counts, whatever the case of the genre.
const shelf = {
    1: { year: 2003, genres: ['комедия', 'Комедия'], kpRating: 7.5, ratingsCount: 3, ratingsSum: 24 },
    2: { year: 2009, genres: [{ name: 'Комедия' }], rating: { kp: 6 }, ratingsCount: 1, ratingsSum: 9 },
    3: { year: 2003, genres: ['драма'] },
    4: { year: 1999, genres: ['комедия'] },
    5: { genres: ['комедия'] }
};
const shelfRatings = [
    { movieId: 1, rating: 8, createdAt: { seconds: 10 } },
    { movieId: '2', rating: 9, createdAt: { seconds: 20 } },
    { movieId: 3, rating: '5', createdAt: { seconds: 30 } },
    { movieId: 4, rating: 3, createdAt: { seconds: 40 } },
    { movieId: 5, rating: null }
];
const comedies = selectFilms(shelfRatings, shelf, { genre: 'комедия' });
assert.deepEqual(comedies.map(film => film.movieId), ['1', '2', '4']);
assert.equal(comedies.length, computeGenres(shelfRatings, shelf).find(genre => genre.name.toLowerCase() === 'комедия').count);
const noughties = selectFilms(shelfRatings, shelf, { decade: 2000 });
assert.deepEqual(noughties.map(film => film.movieId), ['1', '2', '3']);
assert.equal(noughties.length, computeDecades(shelfRatings, shelf).find(item => item.decade === 2000).count);
assert.deepEqual(countFilms(noughties, 'year', [2002, 2003, 2009]), [0, 2, 1]);
// Other people's average leaves the person's own score out; a title nobody else rated has none.
assert.deepEqual(noughties.map(film => film.others), [8, 0, 0]);
assert.equal('kinopoisk' in noughties[0], false, 'Only the users of the extension are compared');
// The average is over the titles both sides rated.
assert.deepEqual(compareScores(noughties, 'others'), { average: 8, difference: 0, films: 1 });
assert.equal(compareScores([noughties[2]], 'others'), null);
assert.equal(averageScore([]), null);
// A title without a valid score counts in its decade, as the bar does, and leaves the average alone.
assert.deepEqual(selectFilms([{ movieId: 1, rating: 'x' }], shelf, { decade: 2000 }).map(film => film.score), [null]);
assert.equal(averageScore([{ score: null }, { score: 4 }]), 4);
const orderOf = order => sortFilms(noughties, order).map(film => film.movieId);
assert.deepEqual(orderOf('best'), ['2', '1', '3']);
assert.deepEqual(orderOf('worst'), ['3', '1', '2']);
assert.deepEqual(orderOf('recent'), ['3', '2', '1']);
assert.deepEqual(orderOf('gap'), ['1', '3', '2'], 'titles nobody else rated come last, the newest of them first');

// Search: every word, in any known name, with «е» for «ё».
const named = {
    1: { name: 'Чёрный рыцарь', enName: 'The Dark Knight' },
    2: { name: 'Рыцарь дня', alternativeName: 'Knight & Day' },
    3: {}
};
const namedRatings = [{ movieId: 1 }, { movieId: 2 }, { movieId: 3, movieTitle: 'Черный лебедь' }];
const foundBy = query => searchRatings(namedRatings, named, query).map(rating => rating.movieId);
assert.deepEqual(foundBy('черный'), [1, 3]);
assert.deepEqual(foundBy(' РЫЦАРЬ  чёрный '), [1]);
assert.deepEqual(foundBy('knight'), [1, 2]);
assert.deepEqual(foundBy('нет такого'), []);
assert.deepEqual(foundBy('  '), [1, 2, 3]);

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

// The films behind the number: best score first, lower ones apart and not counted.
const cast = { persons: [{ id: 10, name: 'Киану Ривз', enProfession: 'actor', photo: 'p.jpg' }] };
const [keanu] = computeFavoritePeople([
    { movieId: 5, rating: 6 },
    { movieId: 1, rating: 8 },
    { movieId: 2, rating: 10 },
    { movieId: '2', rating: 9 },
    { movieId: 6, rating: 7 }
], { ...movies, 5: cast, 6: cast }).actors;
assert.equal(keanu.count, 2);
assert.equal(keanu.photo, 'p.jpg');
assert.deepEqual(keanu.liked, [{ movieId: '2', score: 10 }, { movieId: '1', score: 8 }]);
assert.deepEqual(keanu.other, [{ movieId: '6', score: 7 }, { movieId: '5', score: 6 }]);
assert.equal(computeFavoritePeople([{ movieId: 5, rating: 6 }], { 5: cast }).basis, 0);

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
