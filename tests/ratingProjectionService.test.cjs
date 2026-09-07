const assert = require('node:assert/strict');
const {
  buildMovieRatingProjection,
  isMovieRatingProjectionHealthy,
} = require('../functions/ratingAggregation');

const projection = buildMovieRatingProjection([
  {
    id: 'legacy-user-a',
    data: {
      userId: 'user-a',
      movieId: '18808',
      rating: 2,
      createdAt: '2026-08-30T19:37:28.804Z',
      updatedAt: '2026-08-30T19:37:28.804Z',
    },
  },
  {
    id: 'user-a_18808',
    data: {
      userId: 'user-a',
      movieId: 18808,
      rating: 4,
      createdAt: '2026-08-30T19:38:43.653Z',
      updatedAt: '2026-08-30T19:38:43.653Z',
    },
  },
  {
    id: 'user-b_18808',
    data: {
      userId: 'user-b',
      movieId: 18808,
      rating: 8,
      createdAt: '2026-08-31T17:05:46.933Z',
      updatedAt: '2026-08-31T17:05:46.933Z',
    },
  },
], 18808);

assert.deepEqual(projection, {
  kinopoiskId: 18808,
  ratingsCount: 2,
  ratingsSum: 12,
  avgRating: 6,
  hasCommunityRating: true,
  hasRatings: true,
  lastRatingUpdatedAt: '2026-08-31T17:05:46.933Z',
});
assert.equal(isMovieRatingProjectionHealthy(projection), true);
assert.equal(isMovieRatingProjectionHealthy({ ...projection, lastRatingUpdatedAt: null }), false);
assert.equal(buildMovieRatingProjection([], 0), null);

console.log('Rating projection calculation tests passed');
