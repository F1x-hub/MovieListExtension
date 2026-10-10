const assert = require('node:assert/strict');
const { buildSeriesEpisodeStats, rebuildSeriesEpisodeStats } = require('../seriesEpisodeAggregation');
const documents = [
  { movieId: 12, episodes: { '1:1': { r: 8 }, '0:1': { r: 4 } } },
  { movieId: 12, episodes: { '1:1': { r: 9 }, '1:2': { r: 7 } } },
  { movieId: 12, episodes: { bad: { r: 9 }, '1:3': { r: '8' }, '1:4': { r: 11 }, '1:5': { r: 2.5 }, '1234:1': { r: 2 }, '1:6': null } },
  { movieId: 13, episodes: { '1:1': { r: 1 } } }
];
assert.deepEqual(buildSeriesEpisodeStats(documents, 12), {
  movieId: 12, ratedEpisodes: 3,
  episodes: { '1:1': { sum: 17, count: 2, avg: 8.5 }, '0:1': { sum: 4, count: 1, avg: 4 }, '1:2': { sum: 7, count: 1, avg: 7 } }
});
assert.equal(buildSeriesEpisodeStats([], 12), null);
assert.equal(buildSeriesEpisodeStats(documents, -1), null);
assert.equal(buildSeriesEpisodeStats([documents[2]], 12), null);
(async () => {
  const actions = [];
  const db = {
    collection(name) { return {
      doc(id) { return { name, id }; },
      where(field, operator, value) { assert.equal(field, 'movieId'); assert.equal(operator, '=='); assert.equal(value, 12); return { query: true }; }
    }; },
    async runTransaction(callback) { return callback({
      async get(ref) { actions.push(['get', ref.query ? 'query' : 'projection']); return { docs: documents.map(data => ({ data: () => data })) }; },
      set(ref, data) { actions.push(['set', data]); },
      delete() { actions.push(['delete']); }
    }); }
  };
  await rebuildSeriesEpisodeStats(db, 12, () => 'timestamp');
  assert.deepEqual(actions.slice(0, 2), [['get', 'projection'], ['get', 'query']]);
  assert.equal(actions[2][1].episodes['1:1'].avg, 8.5);
  assert.equal(actions[2][1].updatedAt, 'timestamp');
  documents.length = 0;
  actions.length = 0;
  await rebuildSeriesEpisodeStats(db, 12, () => 'timestamp');
  assert.deepEqual(actions.at(-1), ['delete'], 'last vote deletion removes public stats');
  console.log('Series episode aggregation tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
