const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/shared/services/TMDBService.js'), 'utf8');
const context = vm.createContext({ console, setTimeout, clearTimeout, URL, Map });
vm.runInContext(source + '\nglobalThis.TestTMDB = TMDBService;', context);
const service = Object.create(context.TestTMDB.prototype);
service.defaultLanguage = 'ru-RU';
service.inFlightSeasonRequests = new Map();
service.getCachedSeason = async () => null;
service.setCachedSeason = async () => {};
service.buildImageUrl = value => value ? `https://image.test${value}` : null;
(async () => {
  const cases = [
    { overview: '', name: 'Настоящее название', episodeOverview: 'Описание' },
    { overview: 'Сезон на русском', name: 'Настоящее название', episodeOverview: '' },
    ...['Эпизод 5', 'Серия 5', 'Episode 5'].map(name => ({ overview: 'Сезон на русском', name, episodeOverview: 'Описание' }))
  ];
  for (const fixture of cases) {
    const calls = [];
    service._fetchSeasonDetails = async (id, season, language) => {
      calls.push(language);
      return language === 'en-US'
        ? { overview: 'English season', episodes: [{ episode_number: 5, name: 'English title', overview: 'English episode' }] }
        : { overview: fixture.overview, episodes: [{ episode_number: 5, name: fixture.name, overview: fixture.episodeOverview }] };
    };
    const data = await service.getSeasonDetails(1, 1, { forceRefresh: true });
    assert.deepEqual(calls, ['ru-RU', 'en-US']);
    assert.equal(data.overview, fixture.overview || 'English season');
    assert.equal(data.episodes[0].overview, fixture.episodeOverview || 'English episode');
    assert.equal(data.episodes[0].name, /^(Эпизод|Серия|Episode)/.test(fixture.name) ? 'English title' : fixture.name);
  }
  let count = 0;
  service._fetchSeasonDetails = async () => { count++; return { overview: 'Есть', episodes: [{ episode_number: 1, name: 'Название', overview: 'Есть' }] }; };
  await service.getSeasonDetails(1, 1, { forceRefresh: true });
  assert.equal(count, 1, 'complete Russian data avoids fallback requests');
  const cache = {};
  context.chrome = { storage: { local: {
    async get(key) { return { [key]: cache[key] }; }, async set(values) { Object.assign(cache, values); }, async remove() {}
  } } };
  delete service.getCachedSeason;
  delete service.setCachedSeason;
  service.maxCachedSeasons = 50;
  service.seasonCacheIndexKey = 'index';
  const key = service.getSeasonCacheKey(1, 1);
  cache[key] = { schemaVersion: 1, fetchedAt: Date.now(), data: { episodes: [] } };
  assert.equal(await service.getCachedSeason(1, 1), null, 'legacy season cache is invalidated');
  await service.setCachedSeason(1, 1, { episodes: [] });
  assert.equal(cache[key].schemaVersion, 2);
  assert(await service.getCachedSeason(1, 1));
  console.log('TMDB episode fallback and cache-version tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
