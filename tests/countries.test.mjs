// Countries of films (src/shared/data/countries.js), the profile's count per country, the films
// behind one country, the generated world map, and the Traveller achievement's count.
import assert from 'node:assert/strict';
import { countryCode, countryKey, countryName, filmCountries, isHistoricalCountry } from '../src/shared/data/countries.js';
import { computeCountries, selectFilms } from '../src/pages/profile/ProfileInsights.js';
import { WORLD_MAP } from '../src/shared/data/worldMap.js';
import { computeMetrics } from '../src/shared/achievements/AchievementEngine.js';

// One country however Kinopoisk or TMDB spells it.
for (const [name, code] of [
    ['США', 'US'], ['United States of America', 'US'], ['Великобритания', 'GB'], ['United Kingdom', 'GB'],
    ['Германия', 'DE'], ['Германия (ФРГ)', 'DE'], ['Корея Южная', 'KR'], ['South Korea', 'KR'], ['Канада', 'CA'],
    ['Canada', 'CA'], ['ОАЭ', 'AE'], ['Гонконг', 'HK'], ['Чехия', 'CZ'], ['Czech Republic', 'CZ'], ['Грузия', 'GE'],
    ['Россия', 'RU'], ['Russia', 'RU'], ['Белоруссия', 'BY'], ['ЮАР', 'ZA'], ['Turkey', 'TR'], ['Турция', 'TR'],
    ['Trinidad and Tobago', 'TT'], ['Косово', 'XK'], ['  сша  ', 'US'], ['Ирландия', 'IE']
]) assert.equal(countryCode(name), code, name);
// «Германия» must never become the retired DD (East Germany) the browser also calls «Германия».
assert.equal(countryCode('Германия'), 'DE');
for (const name of ['СССР', 'Югославия', 'Чехословакия', 'Германия (ГДР)', 'Soviet Union']) {
    assert.equal(countryCode(name), null, name);
    assert.equal(isHistoricalCountry(name), true, name);
}
assert.equal(countryCode('Атлантида'), null);
assert.equal(countryKey('United States of America'), countryKey('США'));
assert.equal(countryKey('СССР'), 'name:ссср');
assert.equal(countryKey('Атлантида'), 'name:атлантида');
assert.equal(countryKey(''), null);
assert.deepEqual(filmCountries({ countries: [{ name: 'США' }, 'Канада', '', null] }), ['США', 'Канада']);
assert.equal(countryName('US', 'ru'), 'США');
assert.equal(countryName('US', 'en'), 'USA');
assert.equal(countryName('GE', 'ru'), 'Грузия');
assert.equal(countryName('JP', 'en'), 'Japan');

// Counting: every scored rating, a film once per country, series included, other spellings merged.
const movies = {
    1: { year: 2010, countries: [{ name: 'США' }, { name: 'Великобритания' }] },
    2: { year: 2012, countries: ['United States of America'] },
    3: { year: 1980, isSeries: true, countries: ['СССР'] },
    4: { year: 2001, countries: ['Япония', 'Japan'] },
    5: { year: 2005, countries: [] }
};
const ratings = [
    { movieId: '1', rating: 8, createdAt: 3 },
    { movieId: '2', rating: 6, createdAt: 2 },
    { movieId: 3, rating: 10, createdAt: 1 },
    { movieId: '4', rating: 9 },
    { movieId: '5', rating: 7 },
    { movieId: '1', rating: 0 }
];
const { countries, elsewhere } = computeCountries(ratings, movies);
assert.deepEqual(countries, [
    { code: 'US', count: 2, average: 7 },
    { code: 'GB', count: 1, average: 8 },
    { code: 'JP', count: 1, average: 9 }
]);
assert.deepEqual(elsewhere, [{ name: 'СССР', count: 1 }]);
assert.deepEqual(computeCountries([], {}), { countries: [], elsewhere: [] });

// The films behind a country are the ones it counts.
const usa = selectFilms(ratings, movies, { country: 'US' });
assert.deepEqual(usa.map(film => film.movieId).sort(), ['1', '2']);
assert.equal(selectFilms(ratings, movies, { country: 'JP' }).length, 1, 'Япония and Japan on one film count once');
assert.equal(selectFilms(ratings, movies, { country: 'FR' }).length, 0);
// The genre and decade selections are unchanged.
assert.equal(selectFilms(ratings, movies, { decade: 2010 }).length, 3);

// The generated map: one shape per code, every path drawable, small countries inside the frame.
assert.equal(WORLD_MAP.viewBox, '0 0 960 480');
const codes = WORLD_MAP.countries.map(country => country.code).filter(Boolean);
assert.equal(new Set(codes).size, codes.length, 'one shape per country');
assert.ok(codes.length >= 170, `shapes with a code: ${codes.length}`);
assert.ok(WORLD_MAP.countries.every(country => /^M[\d.,\-LZM ]+/.test(country.d)), 'every shape is a path');
for (const code of ['US', 'RU', 'GE', 'JP', 'FR', 'DE', 'GB', 'XK', 'TT']) assert.ok(codes.includes(code), code);
for (const code of ['HK', 'MT', 'SG', 'MC']) {
    const point = WORLD_MAP.small[code];
    assert.ok(point && point[0] > 0 && point[0] < 960 && point[1] > 0 && point[1] < 480, code);
    assert.ok(!codes.includes(code), `${code} is a point, not a shape`);
}

// Traveller: one country however it is spelled; a historical one still counts as itself.
const metrics = computeMetrics({ ratings, movies, now: Date.UTC(2026, 10, 27) });
assert.equal(metrics.countries, 4, 'US, GB, JP and the USSR');

console.log('countries: names, counts, films per country, world map and Traveller count passed');
