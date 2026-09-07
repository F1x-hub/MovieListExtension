const assert = require('node:assert/strict');
const fs = require('node:fs');

const rules = fs.readFileSync('rules/firestore.rules', 'utf8');
const moviesBlock = rules.slice(
  rules.indexOf('match /movies/{movieId}'),
  rules.indexOf('// Ratings collection (Top-level)')
);

assert.match(moviesBlock, /allow create: if isApprovedUser\(\) && !createsMovieWithServerFields\(\);/);
assert.match(moviesBlock, /allow update: if isApprovedUser\(\) && !changesMovieServerFields\(\);/);
assert.match(moviesBlock, /allow delete: if isAdmin\(\);/);
assert.doesNotMatch(moviesBlock, /allow write:/);
assert.match(rules, /function movieAggregateFields\(\)/);
for (const field of [
  'hasCommunityRating',
  'hasRatings',
  'ratingsCount',
  'ratingsSum',
  'avgRating',
  'lastRatingUpdatedAt'
]) {
  assert.match(rules, new RegExp(`'${field}'`));
}

console.log('Rating projection rules contract tests passed');
