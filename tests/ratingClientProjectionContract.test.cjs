const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('src/shared/services/RatingService.js', 'utf8');
const addStart = source.indexOf('async addOrUpdateRating');
const addEnd = source.indexOf('async updateRatingText', addStart);
const addMethod = source.slice(addStart, addEnd);
const deleteStart = source.indexOf('async deleteRating');
const deleteEnd = source.indexOf('async recalculateUserTopGenres', deleteStart);
const deleteMethod = source.slice(deleteStart, deleteEnd);

assert.doesNotMatch(addMethod, /transaction\.(set|update)\(movieRef/);
assert.doesNotMatch(addMethod, /lastRatingUpdatedAt/);
assert.doesNotMatch(deleteMethod, /transaction\.update\(movieRef/);
assert.match(addMethod, /transaction\.set\(ratingRef/);
assert.match(deleteMethod, /transaction\.delete\(ratingRef/);

console.log('Rating client projection ownership tests passed');
