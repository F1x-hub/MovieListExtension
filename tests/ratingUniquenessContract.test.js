import assert from 'node:assert';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const ratingService = read('../src/shared/services/RatingService.js');
const background = read('../src/background/background.js');
const rules = read('../rules/firestore.rules');

assert.match(ratingService, /getRatingDocumentId\(userId, movieId\)/);
assert.match(ratingService, /return `\$\{normalizedUserId\}_\$\{normalizedMovieId\}`;/);
assert.match(ratingService, /doc\(existingRating\?\.id \|\| canonicalRatingId\)/);
assert.match(ratingService, /const canonicalSnapshot = await this\.db\.collection\(this\.collection\)\.doc\(canonicalRatingId\)\.get\(\);/);

// Ratings are written only through RatingService: the service worker has no write path.
assert.doesNotMatch(background, /documents\/ratings/);
assert.doesNotMatch(background, /ADD_RATING/);

assert.match(rules, /function isValidRatingData\(data\)/);
assert.match(rules, /function hasCanonicalRatingId\(ratingId, data\)/);
assert.match(rules, /request\.resource\.data\.userId == request\.auth\.uid/);
assert.match(rules, /hasCanonicalRatingId\(ratingId, request\.resource\.data\)/);
assert.match(rules, /User ratings subcollection \(Legacy\)[\s\S]{0,160}allow write: if false;/);
assert.match(rules, /Movie ratings subcollection \(Legacy\)[\s\S]{0,160}allow write: if false;/);

console.log('Rating uniqueness contract passed');
