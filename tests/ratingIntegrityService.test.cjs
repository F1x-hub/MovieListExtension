const assert = require('node:assert/strict');
const {
  findProjectionViolations,
  groupRatingEntries,
  projectionDiff,
  scanRatingProjectionIntegrity,
} = require('../functions/ratingIntegrityService');

const entries = [
  {
    id: 'user-a_18808',
    data: {
      userId: 'user-a',
      movieId: '18808',
      rating: 2,
      updatedAt: '2026-08-30T19:38:43.653Z',
    },
  },
  {
    id: 'user-b_18808',
    data: {
      userId: 'user-b',
      movieId: 18808,
      rating: 8,
      updatedAt: '2026-08-31T17:05:46.933Z',
    },
  },
];

assert.equal(groupRatingEntries(entries).get('18808').length, 2);

const expected = {
  kinopoiskId: 18808,
  ratingsCount: 2,
  ratingsSum: 10,
  avgRating: 5,
  hasCommunityRating: true,
  hasRatings: true,
  lastRatingUpdatedAt: '2026-08-31T17:05:46.933Z',
};

assert.deepEqual(projectionDiff(expected, expected), []);
assert.deepEqual(
  findProjectionViolations({
    ratingEntries: entries,
    movieDocuments: [{ id: '18808', data: { name: 'Обнаженная' } }],
  }).map((violation) => violation.movieId),
  ['18808']
);

const healthyMovie = {
  id: '18808',
  data: { ...expected, name: 'Обнаженная' },
};
assert.deepEqual(
  findProjectionViolations({ ratingEntries: entries, movieDocuments: [healthyMovie] }),
  []
);

async function verifyRepairBatching() {
  const largeEntries = Array.from({ length: 451 }, (_, index) => ({
    id: `user-${index}_${index + 1}`,
    data: { userId: `user-${index}`, movieId: index + 1, rating: 7 },
  }));
  const committedBatchSizes = [];
  const fakeDb = {
    collection(name) {
      if (name === 'ratings') {
        return {
          get: async () => ({
            docs: largeEntries.map((entry) => ({
              id: entry.id,
              data: () => entry.data,
            })),
          }),
        };
      }
      return {
        doc: (id) => ({ id }),
      };
    },
    getAll: async (...refs) => refs.map((ref) => ({
      id: ref.id,
      exists: true,
      data: () => ({ name: `Movie ${ref.id}` }),
    })),
    batch: () => {
      const writes = [];
      return {
        set: (ref, data, options) => writes.push({ ref, data, options }),
        commit: async () => committedBatchSizes.push(writes.length),
      };
    },
  };
  const largeRepair = await scanRatingProjectionIntegrity({ db: fakeDb, apply: true });
  assert.equal(largeRepair.repairedCount, 451);
  assert.deepEqual(committedBatchSizes, [450, 1]);
}

verifyRepairBatching()
  .then(() => console.log('Rating integrity scan tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
