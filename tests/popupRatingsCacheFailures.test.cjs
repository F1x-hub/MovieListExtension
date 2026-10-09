const assert = require('node:assert/strict');
const RatingService = require('../src/shared/services/RatingService.js');
const RatingsCacheService = require('../src/shared/services/RatingsCacheService.js');

const previousChrome = global.chrome;
const originalConsole = global.console;
const quietConsole = { ...originalConsole, log() {}, warn() {}, error() {}, group() {}, groupEnd() {} };
const makeError = () => Object.assign(new Error('Firestore is unavailable'), { code: 'unavailable' });
const rating = (id, movieId = 1) => ({ id, movieId, userId: 'viewer', userName: 'Viewer', rating: 8, comment: '', movie: { kinopoiskId: movieId, name: `Movie ${movieId}` } });

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function fixture({ cached = null, cacheAge = 0, userId = null, rows = [], failure = null, gate = null } = {}) {
    const state = { rows, failure, gate, readCount: 0, queryCalls: [], removals: [] };
    const store = {};
    const writes = [];
    const query = {
        where(...args) { state.queryCalls.push(['where', ...args]); return this; },
        orderBy(...args) { state.queryCalls.push(['orderBy', ...args]); return this; },
        limit(value) { state.queryCalls.push(['limit', value]); return this; },
        startAfter(value) { state.queryCalls.push(['startAfter', value]); return this; },
        doc(id) { return { get: async () => ({ id, exists: true, get() {}, data: () => ({ id }) }) }; },
        async get() {
            state.readCount++;
            const response = state.responses?.shift() || state;
            const rows = response.rows;
            if (response.gate) await response.gate.promise;
            if (response.failure) throw response.failure;
            const docs = rows.map(row => ({ id: row.id, get() {}, data: () => ({ ...row }) }));
            return { docs, size: docs.length, forEach: callback => docs.forEach(callback) };
        }
    };
    const storage = {
        async get(keys) {
            if (keys === null) return structuredClone(store);
            const result = structuredClone(Object.fromEntries(keys.filter(key => Object.hasOwn(store, key)).map(key => [key, store[key]])));
            if (state.cacheReadGate) {
                const gate = state.cacheReadGate;
                state.cacheReadGate = null;
                gate.started.resolve();
                await gate.promise;
            }
            return result;
        },
        async set(data) {
            const snapshot = structuredClone(data);
            writes.push(snapshot);
            const gate = state.writeGates?.shift();
            if (gate) {
                gate.started.resolve();
                await gate.promise;
            }
            Object.assign(store, snapshot);
        },
        async remove(keys) {
            state.removals.push([...keys]);
            if (state.removeGate) {
                state.removeGate.started.resolve();
                await state.removeGate.promise;
            }
            keys.forEach(key => { delete store[key]; });
        }
    };
    global.chrome = { storage: { local: storage } };
    const service = new RatingService({ db: { collection: () => query } });
    const cache = new RatingsCacheService({
        getRatingService: () => service,
        getCurrentUser: () => null,
        getUserService: () => ({ getUserProfilesByIds: async () => [] }),
        getMovieCacheService: () => ({
            getBatchCachedMovies: async movieIds => {
                const gate = state.metadataGates?.get(String(movieIds[0]));
                if (gate) {
                    gate.started.resolve();
                    await gate.promise;
                }
                return Object.fromEntries(movieIds.map(id => [id, { kinopoiskId: Number(id), name: `Movie ${id}` }]));
            }
        }),
        getKinopoiskService: () => ({ getMovieById: async () => { throw new Error('Fixture metadata is already cached'); } })
    });
    if (cached !== null) {
        store[cache.getCacheKey(userId)] = structuredClone(cached);
        store[cache.getCacheTimestampKey(userId)] = Date.now() - cacheAge;
        store[cache.getCacheHashKey(userId)] = cache.generateRatingsHash(cached);
        store[cache.CACHE_VERSION_KEY] = cache.CACHE_SCHEMA_VERSION;
    }
    return { service, cache, state, store, writes };
}

async function run() {
    global.console = quietConsole;
    try {
        const failure = makeError();
        {
            const { service } = fixture({ failure });
            assert.deepEqual(await service.getAllRatings(10), { ratings: [], hasMore: false, lastDocId: null, lastDoc: null }, 'legacy callers retain their existing fallback');
            assert.deepEqual(await service.getAllRatings(10, null, null, null), { ratings: [], hasMore: false, lastDocId: null, lastDoc: null }, 'null view options retain compatibility');
            await assert.rejects(service.getAllRatings(10, null, null, { throwOnError: true }), error => error === failure, 'strict callers receive the original error and code');
        }
        {
            const row = { ...rating('viewer_1'), review: 'Long review' };
            const { service, state } = fixture({ rows: [row] });
            const cursor = { id: 'cursor', get() {} };
            const result = await service.getAllRatings(1, cursor, 'viewer', { includeReview: true, throwOnError: true });
            assert.equal(result.ratings[0].review, 'Long review', 'throwOnError coexists with existing view-model options');
            assert.equal(result.lastDoc.id, row.id);
            assert.equal(result.lastDocId, row.id);
            assert.equal(result.hasMore, true);
            assert.deepEqual(state.queryCalls, [['where', 'userId', '==', 'viewer'], ['orderBy', 'createdAt', 'desc'], ['limit', 1], ['startAfter', cursor]]);
        }
        {
            const { cache, writes, store, state } = fixture({ failure });
            await assert.rejects(cache.getCachedRatingsWithBackgroundRefresh(10), error => error === failure);
            assert.equal(state.readCount, 1, 'cold failure does not issue a duplicate fallback request');
            assert.equal(writes.length, 0, 'failed reads cannot persist a false empty feed');
            assert.equal(Object.hasOwn(store, cache.CACHE_KEY), false);
        }
        {
            const cached = [rating('stale_1')];
            const { cache, writes, store, state } = fixture({ cached, cacheAge: 48 * 60 * 60 * 1000, failure, userId: 'viewer' });
            const originalTimestamp = store[cache.getCacheTimestampKey('viewer')];
            const result = await cache.getCachedRatingsWithBackgroundRefresh(1, null, 'viewer');
            assert.deepEqual(result.ratings, cached, 'expired data remains available on a failed refresh');
            assert.equal(result.isFromCache, true);
            assert.equal(result.isStale, true);
            assert.equal(result.refreshError, failure);
            assert.equal(result.refreshPromise, null);
            assert.equal(result.hasMore, true);
            assert.equal(result.lastDocId, 'stale_1');
            assert.equal(store[cache.getCacheTimestampKey('viewer')], originalTimestamp, 'offline fallback never renews stale cache age');
            assert.equal(writes.length, 0);
            assert.equal(state.readCount, 1);
        }
        {
            const gate = deferred();
            const cached = [rating('cached_1')];
            const { cache, writes, store } = fixture({ cached, failure, gate });
            const result = await cache.getCachedRatingsWithBackgroundRefresh(1);
            assert.deepEqual(result.ratings, cached, 'valid cache renders without waiting for the network');
            assert.equal(result.isStale, false);
            assert.equal(result.refreshError, null);
            assert.ok(result.refreshPromise instanceof Promise);
            const rejection = assert.rejects(result.refreshPromise, error => error === failure, 'background failure remains observable by the view');
            gate.resolve();
            await rejection;
            assert.deepEqual(store[cache.CACHE_KEY], cached);
            assert.equal(writes.length, 0);
        }
        {
            const gate = deferred();
            const { cache, store } = fixture({ cached: [rating('cached_1')], rows: [rating('fresh_2', 2)], gate });
            const page = await cache.getCachedRatingsWithBackgroundRefresh(1);
            gate.resolve();
            const fresh = await page.refreshPromise;
            assert.equal(page.ratings[0].id, 'cached_1');
            assert.equal(fresh.ratings[0].id, 'fresh_2');
            assert.equal(fresh.lastDocId, 'fresh_2');
            assert.equal(fresh.lastDoc.id, 'fresh_2', 'background result preserves the actual pagination snapshot');
            assert.equal(fresh.hasMore, true);
            assert.equal(store[cache.CACHE_KEY][0].id, 'fresh_2');
        }
        {
            const { cache, store } = fixture({ rows: [] });
            const result = await cache.getCachedRatingsWithBackgroundRefresh(10);
            assert.deepEqual(result.ratings, []);
            assert.equal(result.isFromCache, false);
            assert.equal(result.isStale, false);
            assert.equal(result.refreshError, null);
            assert.equal(result.refreshPromise, null);
            assert.equal(result.hasMore, false);
            assert.deepEqual(store[cache.CACHE_KEY], [], 'a genuinely successful empty response may be cached');
        }
        {
            const { cache, writes, store } = fixture({ cached: [rating('cached_1')], failure });
            await assert.rejects(cache.getCachedRatingsWithBackgroundRefresh(10, 'cursor'), error => error === failure, 'pagination must not fall back to the first cached page');
            assert.equal(writes.length, 0);
            assert.equal(store[cache.CACHE_KEY][0].id, 'cached_1');
        }
        {
            const { cache, store } = fixture({ cached: [rating('stale_1')], cacheAge: 48 * 60 * 60 * 1000, rows: [rating('fresh_2', 2)] });
            const result = await cache.getCachedRatingsWithBackgroundRefresh(10);
            assert.equal(result.ratings[0].id, 'fresh_2');
            assert.equal(result.isFromCache, false);
            assert.equal(result.isStale, false);
            assert.equal(result.refreshError, null);
            assert.equal(store[cache.CACHE_KEY][0].id, 'fresh_2');
        }
        {
            const { cache, store } = fixture();
            store[cache.CACHE_KEY] = { length: 3 };
            store[cache.CACHE_TIMESTAMP_KEY] = Date.now();
            store[cache.CACHE_VERSION_KEY] = cache.CACHE_SCHEMA_VERSION;
            const result = await cache.getCachedRatingsWithBackgroundRefresh(10);
            assert.equal(result.isFromCache, false, 'malformed cached data cannot become a stale page');
        }
        {
            const oldResponse = deferred();
            const { cache, state, store, writes } = fixture({ cached: [rating('seed')] });
            state.responses = [{ rows: [rating('old_background')], gate: oldResponse }, { rows: [rating('new_manual', 2)] }];
            const cachedPage = await cache.getCachedRatingsWithBackgroundRefresh(10);
            await cache.fetchAndCacheRatings(10);
            assert.equal(store[cache.CACHE_KEY][0].id, 'new_manual');
            oldResponse.resolve();
            const obsolete = await cachedPage.refreshPromise;
            assert.equal(obsolete.isSuperseded, true);
            assert.equal(store[cache.CACHE_KEY][0].id, 'new_manual', 'late background response cannot overwrite a newer manual fetch');
            assert.equal(writes.length, 1);
        }
        {
            const metadata = { ...deferred(), started: deferred() };
            const { cache, state, store, writes } = fixture();
            state.responses = [{ rows: [rating('old_enrichment')] }, { rows: [rating('new_manual', 2)] }];
            state.metadataGates = new Map([['1', metadata]]);
            const old = cache.fetchAndCacheRatings(10);
            await metadata.started.promise;
            await cache.fetchAndCacheRatings(10);
            metadata.resolve();
            assert.equal((await old).isSuperseded, true);
            assert.equal(store[cache.CACHE_KEY][0].id, 'new_manual', 'generation is checked after asynchronous enrichment');
            assert.equal(writes.length, 1);
        }
        {
            const storageWrite = { ...deferred(), started: deferred() };
            const { cache, state, store, writes } = fixture();
            state.responses = [{ rows: [rating('old_write')] }, { rows: [rating('new_write', 2)] }];
            state.writeGates = [storageWrite];
            const old = cache.fetchAndCacheRatings(10);
            await storageWrite.started.promise;
            const newer = cache.fetchAndCacheRatings(10);
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(state.readCount, 2);
            assert.equal(writes.length, 1, 'a new write waits for the active storage operation');
            storageWrite.resolve();
            await Promise.all([old, newer]);
            assert.equal(store[cache.CACHE_KEY][0].id, 'new_write', 'serialized storage writes settle with the newest successful fetch');
        }
        {
            const response = deferred();
            const { cache, state, store, writes } = fixture({ cached: [rating('seed')] });
            state.responses = [{ rows: [rating('after_logout')], gate: response }];
            const pending = cache.refreshCacheInBackground(10);
            await cache.clearCache();
            response.resolve();
            assert.equal((await pending).isSuperseded, true);
            assert.equal(Object.hasOwn(store, cache.CACHE_KEY), false, 'logout cannot be followed by a late pending network cache write');
            assert.equal(writes.length, 0);
        }
        {
            const storageWrite = { ...deferred(), started: deferred() };
            const { cache, state, store } = fixture();
            state.responses = [{ rows: [rating('pending_storage')] }];
            state.writeGates = [storageWrite];
            const pending = cache.fetchAndCacheRatings(10);
            await storageWrite.started.promise;
            const clearing = cache.clearCache();
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(state.removals.length, 0, 'clear waits for an already dispatched storage write');
            storageWrite.resolve();
            await Promise.all([pending, clearing]);
            assert.equal(Object.hasOwn(store, cache.CACHE_KEY), false, 'clear is the final storage operation for invalidated writes');
        }
        {
            const removal = { ...deferred(), started: deferred() };
            const { cache, state, store, writes } = fixture({ cached: [rating('seed')], rows: [rating('new_session', 2)] });
            state.removeGate = removal;
            const clearing = cache.clearCache();
            await removal.started.promise;
            const newSession = cache.fetchAndCacheRatings(10);
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(writes.length, 0, 'a new-session write waits for cache clearing');
            removal.resolve();
            await Promise.all([clearing, newSession]);
            assert.equal(store[cache.CACHE_KEY][0].id, 'new_session');
        }
        {
            const storageRead = { ...deferred(), started: deferred() };
            const { cache, state, store } = fixture({ cached: [rating('seed')], rows: [rating('new_manual', 2)] });
            state.cacheReadGate = storageRead;
            const oldCachedRead = cache.getCachedRatingsWithBackgroundRefresh(10);
            await storageRead.started.promise;
            await cache.fetchAndCacheRatings(10);
            storageRead.resolve();
            const obsolete = await oldCachedRead;
            assert.equal(obsolete.isSuperseded, true);
            assert.equal(obsolete.refreshPromise, null);
            assert.equal(state.readCount, 1, 'an obsolete cached read cannot launch a late background refresh');
            assert.equal(store[cache.CACHE_KEY][0].id, 'new_manual');
        }
        {
            const metadata = { ...deferred(), started: deferred() };
            const legacy = rating('legacy_without_movie');
            delete legacy.movie;
            const { cache, state, store, writes } = fixture({ cached: [legacy], rows: [rating('new_manual', 2)] });
            state.metadataGates = new Map([['1', metadata]]);
            const repair = cache.getCachedRatingsWithBackgroundRefresh(10);
            await metadata.started.promise;
            await cache.fetchAndCacheRatings(10);
            metadata.resolve();
            assert.equal((await repair).isSuperseded, true);
            assert.equal(store[cache.CACHE_KEY][0].id, 'new_manual', 'legacy metadata repair cannot overwrite a newer cache');
            assert.equal(writes.length, 1);
            assert.equal(state.readCount, 1);
        }
        {
            const globalResponse = deferred();
            const { cache, state, store } = fixture();
            state.responses = [{ rows: [rating('global')], gate: globalResponse }, { rows: [rating('personal', 2)] }];
            const globalFetch = cache.fetchAndCacheRatings(10);
            await cache.fetchAndCacheRatings(10, null, 'viewer');
            globalResponse.resolve();
            assert.equal((await globalFetch).isSuperseded, false, 'different cache keys do not invalidate each other');
            assert.equal(store[cache.CACHE_KEY][0].id, 'global');
            assert.equal(store[cache.getCacheKey('viewer')][0].id, 'personal');
        }
        {
            const oldResponse = deferred();
            const { cache, state, store, writes } = fixture({ cached: [rating('last_successful')] });
            state.responses = [{ rows: [rating('old_background')], gate: oldResponse }, { rows: [], failure }];
            const cachedPage = await cache.getCachedRatingsWithBackgroundRefresh(10);
            await assert.rejects(cache.fetchAndCacheRatings(10), error => error === failure);
            oldResponse.resolve();
            assert.equal((await cachedPage.refreshPromise).isSuperseded, true);
            assert.equal(store[cache.CACHE_KEY][0].id, 'last_successful', 'a failed newer request preserves the last successful cache');
            assert.equal(writes.length, 0);
        }
        {
            const response = deferred();
            const { cache, state, store } = fixture({ cached: [rating('seed')] });
            store[cache.AVERAGE_RATINGS_CACHE_KEY] = { 1: { average: 8, count: 1 } };
            state.responses = [{ rows: [rating('obsolete_text')], gate: response }];
            const pending = cache.fetchAndCacheRatings(10);
            await cache.clearRatingTextCache('viewer');
            response.resolve();
            assert.equal((await pending).isSuperseded, true);
            assert.equal(Object.hasOwn(store, cache.CACHE_KEY), false, 'text invalidation also cancels pending compact-feed writes');
            assert.ok(store[cache.AVERAGE_RATINGS_CACHE_KEY], 'text invalidation preserves independent average data');
        }
    } finally {
        global.console = originalConsole;
        if (previousChrome === undefined) delete global.chrome;
        else global.chrome = previousChrome;
    }
    console.log('Popup production rating/cache failure-path regressions passed');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
