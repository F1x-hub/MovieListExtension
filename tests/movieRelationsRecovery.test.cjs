const assert = require('node:assert/strict');
const KinopoiskService = require('../src/shared/services/KinopoiskService.js');
const MediaAggregatorService = require('../src/shared/services/MediaAggregatorService.js');
const MovieCacheService = require('../src/shared/services/MovieCacheService.js');
const { createHarness } = require('./movieDetailsHeroContinue.test.cjs');
async function main() {
    global.KINOPOISK_CONFIG = { CACHE_DURATION: 24 * 60 * 60 * 1000, ENDPOINTS: { MOVIE: '/movie' } };
    const kp = Object.create(KinopoiskService.prototype);
    const raw = { id: 401152, name: 'Аватар', type: 'animated-series', isSeries: true, externalId: { tmdb: 246 },
        sequelsAndPrequels: [{ id: 565035, name: 'Корра', relationType: 'SEQUEL' }, { id: 7267380, name: 'Семь убежищ', relationType: 'SEQUEL' }],
        similarMovies: [{ id: 999, name: 'Похожий сериал' }] };
    const normalized = kp.normalizeMovieData(raw);
    const unified = MediaAggregatorService.aggregate(normalized, { tmdbId: 246, isSeries: true, type: 'tv-series', collection: null });
    assert.deepEqual(unified.sequelsAndPrequels, raw.sequelsAndPrequels);
    assert.deepEqual(unified.similarMovies, raw.similarMovies);
    assert.equal(unified._meta.providers.kp.relationsChecked, true);
    assert.equal(unified.sequelsAndPrequels[0].relationType, 'SEQUEL');
    assert.notEqual(unified.sequelsAndPrequels[0], raw.sequelsAndPrequels[0]);
    for (const [fields, checked] of [[{}, false], [{ sequelsAndPrequels: [], similarMovies: [] }, true]]) {
        const result = MediaAggregatorService.aggregate(kp.normalizeMovieData({ id: 11, name: 'Title', ...fields }));
        assert.deepEqual(result.sequelsAndPrequels, []);
        assert.equal(result._meta.providers.kp.relationsChecked, checked);
    }
    const tmdbOnly = MediaAggregatorService.aggregate({ id: 11, name: 'Title', provenance: 'synthetic-tmdb-only' }, { id: 12, name: 'Title' });
    assert.deepEqual(tmdbOnly.sequelsAndPrequels, []);
    assert.equal(tmdbOnly._meta.providers.kp.relationsChecked, false);

    const old = structuredClone(unified);
    delete old.sequelsAndPrequels;
    delete old.similarMovies;
    delete old._meta.providers.kp.relationsSchemaVersion;
    old.hasCommunityRating = true;
    old.ratingsCount = 31;
    old.avgRating = 8;
    const storage = {};
    global.localStorage = { setItem() {}, getItem() { return null; } };
    global.chrome = { storage: { local: {
        async get(key) { return { [key]: structuredClone(storage[key]) }; },
        async set(values) { Object.assign(storage, structuredClone(values)); }
    } } };
    let firestoreWrites = 0;
    const cache = new MovieCacheService({ db: { collection: () => ({ doc: () => ({
        get: async () => ({ exists: true, id: '401152', data: () => old }),
        set: () => { firestoreWrites++; throw Error('forbidden'); }
    }) }) } });
    let requests = 0;
    const aggregator = new MediaAggregatorService({
        movieCacheService: cache,
        kinopoiskService: { getMovieById: async (_id, options) => { requests++; assert.equal(options.requireProviderResponse, true); return normalized; } },
        tmdbService: { isConfigured: () => false }, idMappingService: null
    });
    const healed = await aggregator.getMovieDetails(401152);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests, 1);
    assert.equal(healed.sequelsAndPrequels.length, 2);
    const warm = await cache.getCachedMovie(401152);
    assert.deepEqual(warm.sequelsAndPrequels, raw.sequelsAndPrequels);
    assert.equal(warm.ratingsCount, 31);
    assert.equal(warm.avgRating, 8);
    assert.equal(warm.hasCommunityRating, true);
    await aggregator.getMovieDetails(401152);
    assert.equal(requests, 1, 'local healed DTO must remain warm even when the rated Firestore document is old');
    assert.equal(firestoreWrites, 0);

    old.kpRating = 9;
    old.imdbRating = 8.8;
    old.votes = { kp: 1200, imdb: 2400 };
    old.rating = { kp: 9, imdb: 8.8 };
    global.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } };
    let metadataWrite;
    const ratedCache = new MovieCacheService({ db: { collection: () => ({ doc: () => ({
        get: async () => ({ exists: true, id: '401152', data: () => old }),
        set: async (payload, options) => { firestoreWrites++; metadataWrite = { payload, options }; }
    }) }) } });
    const ratedAggregator = new MediaAggregatorService({ movieCacheService: ratedCache,
        kinopoiskService: { getMovieById: async () => ({ ...normalized, rating: { kp: 5, imdb: 6 }, votes: { kp: 1, imdb: 2 } }) },
        tmdbService: { isConfigured: () => false } });
    await ratedAggregator.getMovieDetails(401152, { forceRefresh: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(firestoreWrites, 1, 'ordinary rated aggregation must still merge shared metadata');
    assert.deepEqual(metadataWrite.options, { merge: true });
    assert.equal(metadataWrite.payload.name, normalized.name);
    for (const field of ['hasCommunityRating', 'ratingsCount', 'avgRating', 'kpRating', 'imdbRating', 'sequelsAndPrequels', 'similarMovies']) {
        assert.equal(Object.hasOwn(metadataWrite.payload, field), false, `${field} must not be written by metadata persistence`);
    }
    assert.equal(metadataWrite.payload.votes?.kp, undefined);
    assert.equal(metadataWrite.payload.votes?.imdb, undefined);
    assert.equal(metadataWrite.payload.rating?.kp, undefined);
    assert.equal(metadataWrite.payload.rating?.imdb, undefined);
    assert.equal(metadataWrite.payload._meta.providers.kp.relationsSchemaVersion, undefined);
    const localRated = storage.local_movie_cache_401152;
    assert.deepEqual(localRated.sequelsAndPrequels, raw.sequelsAndPrequels);
    assert.deepEqual(localRated.similarMovies, raw.similarMovies);
    assert.equal(localRated._meta.providers.kp.relationsSchemaVersion, 1);
    const ratedWarm = await ratedCache.getCachedMovie(401152);
    assert.equal(ratedWarm.kpRating, 9);
    assert.equal(ratedWarm.imdbRating, 8.8);
    for (const field of ['votes', 'rating']) {
        for (const provider of ['kp', 'imdb']) assert.equal(ratedWarm[field][provider], old[field][provider]);
    }
    assert.equal(ratedWarm.ratingsCount, 31);
    assert.equal(ratedWarm.avgRating, 8);
    for (const timestamp of [undefined, 'invalid date', '2000-01-01T00:00:00.000Z']) {
        storage.local_movie_cache_401152 = { ...localRated, lastUpdated: timestamp };
        assert.equal((await ratedCache.getCachedMovie(401152)).sequelsAndPrequels, undefined, 'invalid/stale local timestamps must not supersede the document');
    }
    storage.local_movie_cache_401152 = localRated;
    const savedDocumentDate = old.lastUpdated;
    for (const timestamp of [undefined, 'invalid date']) {
        old.lastUpdated = timestamp;
        const expired = await ratedCache.getCachedMovie(401152);
        assert.equal(expired._cacheExpired, true);
        assert.equal(expired.kpRating, 9);
    }
    old.lastUpdated = savedDocumentDate;
    delete global.firebase;

    const { manager, dom } = createHarness();
    dom.window.document.body.innerHTML = '<div class="movie-detail-description"><div id="userRatingsSection">Reviews</div></div>';
    manager.selectedMovie = warm;
    manager.patchRelatedRelations(warm);
    assert.equal(dom.window.document.querySelectorAll('.sequel-card').length, 2);
    assert.equal(dom.window.document.querySelectorAll('[href*="movieId=999"]').length, 0, 'similar titles remain outside relations');
    assert(dom.window.document.querySelector('[href="movie-details.html?movieId=565035"]'));
    manager.patchRelatedRelations(warm);
    assert.equal(dom.window.document.querySelectorAll('.sequels-section').length, 1);
    delete global.chrome;
    delete global.localStorage;

    const failed = new MediaAggregatorService({ movieCacheService: { getCachedMovie: async () => old, cacheMovie: () => { throw Error('must not persist failure'); } },
        kinopoiskService: { getMovieById: async () => { throw Error('offline'); } }, tmdbService: { isConfigured: () => false } });
    assert.equal(await failed.getMovieDetails(401152), old);
    assert.equal(old._meta.providers.kp.relationsSchemaVersion, undefined, 'failed recovery stays retryable');
    const cachedRelations = { ...old, sequelsAndPrequels: raw.sequelsAndPrequels, similarMovies: raw.similarMovies };
    const incomplete = new MediaAggregatorService({ movieCacheService: { getCachedMovie: async () => cachedRelations, cacheMovie: async () => {} },
        kinopoiskService: { getMovieById: async () => kp.normalizeMovieData({ ...raw, sequelsAndPrequels: undefined }) },
        tmdbService: { isConfigured: () => false } });
    const preserved = await incomplete.getMovieDetails(401152);
    assert.deepEqual(preserved.sequelsAndPrequels, raw.sequelsAndPrequels, 'absent fields do not erase known relations');
    assert.equal(preserved._meta.providers.kp.relationsChecked, false);
    old._cacheExpired = true;
    assert.equal(await failed.getMovieDetails(401152), old, 'expired-cache recovery also preserves transport failures');

    kp._fetchWithRotation = async () => { throw Error('offline'); };
    kp.baseUrl = 'https://invalid.test';
    global.KINOPOISK_CONFIG = { ENDPOINTS: { MOVIE: '/movie' } };
    kp.getTmdbFallbackAfterKinopoiskFailure = () => { throw Error('fallback must not mark KP relations checked'); };
    await assert.rejects(kp.getMovieById(401152, { requireProviderResponse: true }), /offline/);
    delete global.KINOPOISK_CONFIG;
    console.log('Movie relations: raw KP -> normalization -> Unified -> local cache -> real renderer; schema recovery and failure safety passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
