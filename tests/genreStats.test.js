import assert from 'node:assert';
import { calculateTopGenres } from '../src/shared/utils/genreStats.js';
import Utils from '../src/shared/utils/Utils.js';

console.log('🧪 Running Top Genres Calculation Test...');

// Test 1: Empty genres
const emptyResult = calculateTopGenres([]);
assert.deepStrictEqual(emptyResult, [], 'Empty input should return empty array');

// Test 2: Frequency ranking and capitalization
const input = ['драма', 'комедия', 'Драма', 'Боевик', 'комедия', 'драма', 'фантастика'];
const top3 = calculateTopGenres(input, 3);
assert.deepStrictEqual(top3, ['Драма', 'Комедия', 'Боевик'], 'Should sort by frequency descending');

// Test 3: Alphabetical tie-breaking when frequency is equal
const tieInput = ['ужасы', 'комедия', 'боевик'];
const tieResult = calculateTopGenres(tieInput, 3);
assert.deepStrictEqual(tieResult, ['Боевик', 'Комедия', 'Ужасы'], 'Should tie-break by Russian alphabetical order');

// Test 4: Less than 3 genres
const shortInput = ['драма'];
const shortResult = calculateTopGenres(shortInput, 3);
assert.deepStrictEqual(shortResult, ['Драма'], 'Should return available count when less than limit');

// Test 5: Mixed string and object genres ({name: '...'}, {genre: '...'})
const objectInput = [{ name: 'драма' }, { genre: 'комедия' }, 'драма', { name: 'Боевик' }];
const objectResult = calculateTopGenres(objectInput, 3);
assert.deepStrictEqual(objectResult, ['Драма', 'Боевик', 'Комедия'], 'Should handle object genres properly');

// Test 6: Utils.extractGenreName, normalizeGenres, and formatGenres
assert.strictEqual(Utils.extractGenreName(' драма '), 'драма');
assert.strictEqual(Utils.extractGenreName({ name: ' комедия ' }), 'комедия');
assert.strictEqual(Utils.extractGenreName({ genre: ' боевик ' }), 'боевик');
assert.strictEqual(Utils.extractGenreName(null), '');

assert.deepStrictEqual(
    Utils.normalizeGenres([' драма ', { name: 'комедия' }, { genre: 'боевик' }, null]),
    ['драма', 'комедия', 'боевик']
);
assert.strictEqual(
    Utils.formatGenres([' драма ', { name: 'комедия' }, { genre: 'боевик' }], 2),
    'драма, комедия'
);

// Test 7: Utils.extractCountryName, normalizeCountries, and formatCountries
assert.strictEqual(Utils.extractCountryName(' США '), 'США');
assert.strictEqual(Utils.extractCountryName({ name: ' Россия ' }), 'Россия');
assert.strictEqual(Utils.extractCountryName({ country: ' Великобритания ' }), 'Великобритания');
assert.deepStrictEqual(
    Utils.normalizeCountries([' США ', { name: 'Россия' }, { country: 'Великобритания' }]),
    ['США', 'Россия', 'Великобритания']
);
assert.strictEqual(
    Utils.formatCountries([' США ', { country: 'Великобритания' }], 1),
    'США'
);

console.log('✅ All top genres calculation and Utils genre/country tests passed successfully!');

