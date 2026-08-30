const assert = require('node:assert/strict');
const RatingService = require('../src/shared/services/RatingService');
const service = new RatingService({ db: null });

const ratings = service.getCurrentRatings([
  { id: 'legacy-a', userId: 'user-a', movieId: 9, rating: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'legacy-b', userId: 'user-a', movieId: 9, rating: 10, updatedAt: '2026-02-01T00:00:00.000Z' },
  { id: 'user-a_9', userId: 'user-a', movieId: 9, rating: 7, updatedAt: '2026-01-15T00:00:00.000Z' },
  { id: 'user-b_9', userId: 'user-b', movieId: 9, rating: 4, updatedAt: '2026-02-01T00:00:00.000Z' }
]);

assert.equal(ratings.length, 2);
assert.equal(ratings.find((rating) => rating.userId === 'user-a').rating, 7);
assert.equal(ratings.find((rating) => rating.userId === 'user-b').rating, 4);

console.log('Rating service deduplication passed');
