const assert = require('node:assert/strict');
const { selectUniqueMovieRatings } = require('../functions/ratingAggregation');

const ratings = selectUniqueMovieRatings([
  { id: 'legacy-a', data: { userId: 'user-a', movieId: 7, rating: 2, updatedAt: '2026-01-01T00:00:00.000Z' } },
  { id: 'legacy-b', data: { userId: 'user-a', movieId: 7, rating: 9, updatedAt: '2026-02-01T00:00:00.000Z' } },
  { id: 'user-a_7', data: { userId: 'user-a', movieId: 7, rating: 6, updatedAt: '2026-01-15T00:00:00.000Z' } },
  { id: 'legacy-c', data: { userId: 'user-b', movieId: 7, rating: 8, updatedAt: '2026-03-01T00:00:00.000Z' } }
], 7);

assert.equal(ratings.length, 2);
assert.equal(ratings.find(({ data }) => data.userId === 'user-a').data.rating, 6);
assert.equal(ratings.find(({ data }) => data.userId === 'user-b').data.rating, 8);

console.log('Rating aggregation deduplication passed');
