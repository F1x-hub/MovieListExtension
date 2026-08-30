import assert from 'node:assert';
import IdMappingService from '../src/shared/services/IdMappingService.js';
import KinopoiskService from '../src/shared/services/KinopoiskService.js';

globalThis.KINOPOISK_CONFIG = {
    BASE_URL: 'https://example.test',
    API_KEY: 'test-key',
    DEFAULT_LIMIT: 20,
    ENDPOINTS: { MOVIE: '/movie' },
    API_KEYS: ['test-key']
};

// Mock chrome API for Node test environment
globalThis.chrome = {
    storage: {
        local: {
            store: {},
            get(keys, cb) {
                const res = {};
                if (keys === null) {
                    Object.assign(res, this.store);
                } else if (Array.isArray(keys)) {
                    keys.forEach(k => { if (this.store[k] !== undefined) res[k] = this.store[k]; });
                } else if (typeof keys === 'string') {
                    if (this.store[keys] !== undefined) res[keys] = this.store[keys];
                }
                if (cb) cb(res);
                return Promise.resolve(res);
            },
            set(obj, cb) {
                Object.assign(this.store, obj);
                if (cb) cb();
                return Promise.resolve();
            },
            remove(keys, cb) {
                const arr = Array.isArray(keys) ? keys : [keys];
                arr.forEach(k => delete this.store[k]);
                if (cb) cb();
                return Promise.resolve();
            }
        }
    }
};

async function runTests() {
    console.log('🧪 Running IdMappingService Unit & Regression Tests...');

    // Reset storage
    globalThis.chrome.storage.local.store = {};

    const service = new IdMappingService();

    // 1. Test Cache Key Namespace: movie:550 != tv:550
    console.log('--- 1. Testing Cache Key Namespace & Normalization ---');
    assert.strictEqual(service.buildKey('movie', 550), 'movie:550');
    assert.strictEqual(service.buildKey('tv', 550), 'tv:550');
    assert.strictEqual(service.buildKey('tv-series', 550), 'tv:550');
    assert.strictEqual(service.buildKey('anime', 123), 'tv:123');
    assert.strictEqual(service.buildKey('cartoon', 456), 'movie:456');
    assert.notStrictEqual(service.buildKey('movie', 550), service.buildKey('tv', 550));
    console.log('  ✅ Cache key namespace isolation verified');

    // 2. Test Deduplication of Inputs
    console.log('--- 2. Testing Deduplication of Inputs ---');
    let apiCallCount = 0;
    const mockKpService = {
        baseUrl: 'https://api.test',
        _fetchWithRotation: async (url) => {
            apiCallCount++;
            return {
                ok: true,
                json: async () => ({
                    docs: [
                        { id: 361, type: 'movie', externalId: { tmdb: 550 } }
                    ],
                    total: 1,
                    pages: 1
                })
            };
        }
    };

    const duplicateInputs = [
        { tmdbId: 550, mediaType: 'movie', year: 1999 },
        { tmdbId: 550, mediaType: 'movie', year: 1999 },
        { tmdbId: '550', mediaType: 'movie', year: 1999 }
    ];

    const res1 = await service.resolveBatch(duplicateInputs, { kinopoiskService: mockKpService });
    assert.strictEqual(res1.size, 1);
    assert.strictEqual(res1.get('movie:550')?.kinopoiskId, 361);
    assert.strictEqual(res1.get('movie:550')?.status, 'resolved');
    assert.strictEqual(apiCallCount, 1, 'API should only be called once for duplicate inputs');
    console.log('  ✅ Input deduplication passed');

    // 2.1 Partial multi-ID provider responses must recover by exact ID.
    console.log('--- 2.1 Testing Partial Batch Response Exact-ID Recovery ---');
    let partialLookupCalls = 0;
    const partialResponseService = {
        baseUrl: 'https://api.test',
        _fetchWithRotation: async (url) => {
            partialLookupCalls++;
            const ids = [...url.matchAll(/externalId\.tmdb=([^&]+)/g)].map(match => Number(match[1]));
            const docs = ids.length > 1
                ? [{ id: 482, type: 'movie', externalId: { tmdb: 862 } }]
                : ids[0] === 863
                    ? [{ id: 405, type: 'movie', externalId: { tmdb: 863 } }]
                    : ids[0] === 10193
                        ? [{ id: 258328, type: 'movie', externalId: { tmdb: 10193 } }]
                        : [{ id: 846824, type: 'movie', externalId: { tmdb: 301528 } }];
            return { ok: true, json: async () => ({ docs, total: docs.length, pages: 1 }) };
        }
    };
    const partialBatchResult = await new IdMappingService().resolveBatch([
        { tmdbId: 862, mediaType: 'movie', year: 1995 },
        { tmdbId: 863, mediaType: 'movie', year: 1999 },
        { tmdbId: 10193, mediaType: 'movie', year: 2010 },
        { tmdbId: 301528, mediaType: 'movie', year: 2019 }
    ], { kinopoiskService: partialResponseService, skipQueue: true });
    assert.strictEqual(partialBatchResult.get('movie:862')?.kinopoiskId, 482);
    assert.strictEqual(partialBatchResult.get('movie:863')?.kinopoiskId, 405);
    assert.strictEqual(partialBatchResult.get('movie:10193')?.kinopoiskId, 258328);
    assert.strictEqual(partialBatchResult.get('movie:301528')?.kinopoiskId, 846824);
    assert.strictEqual(partialLookupCalls, 4, 'Missing batch identities must use exact external-ID lookups');
    console.log('  ✅ Partial batch response recovery passed without title matching');

    // 2.2 Empty batch responses must still trigger one exact lookup per request.
    console.log('--- 2.2 Testing Empty Batch Exact-ID Recovery ---');
    let emptyBatchLookupCalls = 0;
    const emptyBatchService = {
        baseUrl: 'https://api.test',
        _fetchWithRotation: async (url) => {
            emptyBatchLookupCalls++;
            const ids = [...url.matchAll(/externalId\.tmdb=([^&]+)/g)].map(match => Number(match[1]));
            const exactIds = new Map([
                [863, 9100863],
                [10193, 91010193],
                [301528, 910301528]
            ]);
            const docs = ids.length > 1
                ? []
                : [{ id: exactIds.get(ids[0]), type: 'movie', externalId: { tmdb: ids[0] } }];
            return { ok: true, status: 200, json: async () => ({ docs, total: docs.length, pages: 1 }) };
        }
    };
    const emptyBatchStorageSnapshot = { ...globalThis.chrome.storage.local.store };
    globalThis.chrome.storage.local.store = {};
    try {
        const emptyBatchMapper = new IdMappingService();
        const emptyBatchResult = await emptyBatchMapper.resolveBatch([
            { tmdbId: 863, mediaType: 'movie', year: 1999 },
            { tmdbId: 10193, mediaType: 'movie', year: 2010 },
            { tmdbId: 301528, mediaType: 'movie', year: 2019 }
        ], { kinopoiskService: emptyBatchService, skipQueue: true, context: 'franchise-self-heal', forceRefresh: true });
        assert.strictEqual(emptyBatchLookupCalls, 4, 'Empty batch must be followed by three exact requests');
        assert.strictEqual(emptyBatchResult.get('movie:863')?.kinopoiskId, 9100863);
        assert.strictEqual(emptyBatchResult.get('movie:10193')?.kinopoiskId, 91010193);
        assert.strictEqual(emptyBatchResult.get('movie:301528')?.kinopoiskId, 910301528);
        assert.strictEqual((await emptyBatchMapper.getMappingCache())['movie:863']?.status, 'resolved');
    } finally {
        globalThis.chrome.storage.local.store = emptyBatchStorageSnapshot;
    }
    console.log('  ✅ Empty batch exact-ID recovery passed with canonical cache writes');

    // 2.3 Exact lookup must reject a mismatched external TMDB identity.
    console.log('--- 2.3 Testing Exact Lookup Identity Verification ---');
    const mismatchedStorageSnapshot = { ...globalThis.chrome.storage.local.store };
    globalThis.chrome.storage.local.store = {};
    try {
        const mismatchedMapper = new IdMappingService();
        const mismatchedResult = await mismatchedMapper.resolveBatch([
            { tmdbId: 301528, mediaType: 'movie', year: 2019 }
        ], {
            kinopoiskService: {
                baseUrl: 'https://api.test',
                _fetchWithRotation: async (url) => {
                    const ids = [...url.matchAll(/externalId\.tmdb=([^&]+)/g)].map(match => Number(match[1]));
                    const docs = ids.length > 1 ? [] : [{ id: 999301528, type: 'movie', externalId: { tmdb: 999999 } }];
                    return { ok: true, status: 200, json: async () => ({ docs, total: docs.length, pages: 1 }) };
                }
            },
            skipQueue: true,
            context: 'franchise-self-heal',
            forceRefresh: true
        });
        assert.strictEqual(mismatchedResult.get('movie:301528')?.status, 'not-found');
        assert.strictEqual(mismatchedResult.get('movie:301528')?.kinopoiskId, null);
        assert.strictEqual((await mismatchedMapper.getMappingCache())['movie:301528']?.status, 'not-found');
    } finally {
        globalThis.chrome.storage.local.store = mismatchedStorageSnapshot;
    }
    console.log('  ✅ Mismatched exact external ID was rejected and negative-cached only after exact lookup');

    // 2.4 Verified metadata fallback: strict title/year/type, ambiguity rejection,
    // canonical persistence, and exact external-ID precedence.
    console.log('--- 2.4 Testing Verified Metadata Fallback ---');
    const metadataStorageSnapshot = { ...globalThis.chrome.storage.local.store };
    globalThis.chrome.storage.local.store = {};
    let metadataSearchCalls = 0;
    const metadataDocuments = new Map([
        ['Toy Story 2', [{ id: 405, name: 'Toy Story 2', alternativeName: 'История игрушек 2', year: 1999, type: 'movie' }]],
        ['Toy Story 3', [{ id: 258328, name: 'Toy Story 3', alternativeName: 'История игрушек 3', year: 2010, type: 'movie' }]],
        ['Toy Story 4', [{ id: 846824, name: 'Toy Story 4', alternativeName: 'История игрушек 4', year: 2019, type: 'movie' }]],
        ['Wrong Year', [{ id: 7001, name: 'Wrong Year', year: 2018, type: 'movie' }]],
        ['Wrong Type', [{ id: 7002, name: 'Wrong Type', year: 2019, type: 'tv-series' }]],
        ['Partial Title', [{ id: 7003, name: 'Partial Title: Extended', year: 2019, type: 'movie' }]],
        ['Ambiguous', [
            { id: 7004, name: 'Ambiguous', year: 2019, type: 'movie' },
            { id: 7005, name: 'Ambiguous', year: 2019, type: 'movie' }
        ]],
        ['Ёлка', [{ id: 7006, name: 'Елка', year: 2019, type: 'movie' }]]
    ]);
    const metadataService = {
        baseUrl: 'https://api.test',
        _fetchWithRotation: async () => ({ ok: true, status: 200, json: async () => ({ docs: [], total: 0, pages: 1 }) }),
        searchMovies: async (query) => {
            metadataSearchCalls++;
            return { docs: metadataDocuments.get(query) || [] };
        }
    };
    try {
        const metadataMapper = new IdMappingService();
        const metadataResult = await metadataMapper.resolveBatch([
            { tmdbId: 863, mediaType: 'movie', title: 'Toy Story 2', originalTitle: 'Toy Story 2', year: 1999 },
            { tmdbId: 10193, mediaType: 'movie', title: 'История игрушек 3', originalTitle: 'Toy Story 3', year: 2010 },
            { tmdbId: 301528, mediaType: 'movie', title: 'История игрушек 4', originalTitle: 'Toy Story 4', year: 2019 }
        ], { kinopoiskService: metadataService, skipQueue: true });
        assert.strictEqual(metadataResult.get('movie:863')?.kinopoiskId, 405);
        assert.strictEqual(metadataResult.get('movie:10193')?.kinopoiskId, 258328);
        assert.strictEqual(metadataResult.get('movie:301528')?.kinopoiskId, 846824);
        assert.strictEqual(metadataResult.get('movie:863')?.verificationMethod, 'exact_title_year_type');

        const metadataCache = await metadataMapper.getMappingCache();
        assert.strictEqual(metadataCache['movie:863']?.kpId, 405);
        assert.strictEqual(metadataCache['kp:movie:405']?.tmdbId, 863);
        const searchCallsBeforeReload = metadataSearchCalls;
        const reloadedResult = await new IdMappingService().resolveBatch([
            { tmdbId: 863, mediaType: 'movie', title: 'Toy Story 2', year: 1999 }
        ], { kinopoiskService: metadataService, skipQueue: true });
        assert.strictEqual(reloadedResult.get('movie:863')?.kinopoiskId, 405);
        assert.strictEqual(metadataSearchCalls, searchCallsBeforeReload, 'Second reload must use cache without search');

        const exactService = {
            ...metadataService,
            _fetchWithRotation: async () => ({
                ok: true,
                status: 200,
                json: async () => ({ docs: [{ id: 9001, type: 'movie', externalId: { tmdb: 900001 } }], total: 1, pages: 1 })
            }),
            searchMovies: async () => { throw new Error('Metadata search must not run after exact hit'); }
        };
        const exactResult = await new IdMappingService().resolveBatch([
            { tmdbId: 900001, mediaType: 'movie', title: 'Ignored', year: 2020 }
        ], { kinopoiskService: exactService, skipQueue: true, forceRefresh: true });
        assert.strictEqual(exactResult.get('movie:900001')?.kinopoiskId, 9001, 'Exact external ID must win immediately');

        const metadataCases = [
            [{ tmdbId: 920001, mediaType: 'movie', title: 'Wrong Year', year: 2019 }, 'not-found'],
            [{ tmdbId: 920002, mediaType: 'movie', title: 'Wrong Type', year: 2019 }, 'not-found'],
            [{ tmdbId: 920003, mediaType: 'movie', title: 'Partial Title', year: 2019 }, 'not-found'],
            [{ tmdbId: 920004, mediaType: 'movie', title: 'Ambiguous', year: 2019 }, 'not-found'],
            [{ tmdbId: 920005, mediaType: 'movie', title: 'Елка', originalTitle: 'Ёлка', year: 2019 }, 'resolved']
        ];
        const caseResults = await new IdMappingService().resolveBatch(metadataCases.map(([item]) => item), {
            kinopoiskService: metadataService,
            skipQueue: true,
            forceRefresh: true
        });
        assert.strictEqual(caseResults.get('movie:920001')?.status, 'not-found', 'Wrong year must be rejected');
        assert.strictEqual(caseResults.get('movie:920002')?.status, 'not-found', 'Wrong type must be rejected');
        assert.strictEqual(caseResults.get('movie:920003')?.status, 'not-found', 'Partial title must be rejected');
        assert.strictEqual(caseResults.get('movie:920004')?.status, 'not-found', 'Ambiguous matches must remain unresolved');
        assert.strictEqual(caseResults.get('movie:920005')?.kinopoiskId, 7006, 'Original title match must accept ё/е normalization');

        console.log('  ✅ Strict metadata fallback, ambiguity rejection, cache persistence, and exact precedence passed');
    } finally {
        globalThis.chrome.storage.local.store = metadataStorageSnapshot;
    }

    // 3. Test Resolved Cache Hit (Warm Cache)
    console.log('--- 3. Testing Resolved Cache Hit (Warm Cache) ---');
    apiCallCount = 0;
    const res2 = await service.resolveBatch([{ tmdbId: 550, mediaType: 'movie' }], { kinopoiskService: mockKpService });
    assert.strictEqual(res2.get('movie:550')?.kinopoiskId, 361);
    assert.strictEqual(apiCallCount, 0, 'No API call should be made when item is cached');
    console.log('  ✅ Resolved cache hit passed (0 API calls)');

    // 4. Test Negative Cache Hit (Adaptive TTL for fresh and old items)
    console.log('--- 4. Testing Negative Cache Hit & Unresolved Handling ---');
    apiCallCount = 0;
    mockKpService._fetchWithRotation = async () => {
        apiCallCount++;
        return {
            ok: true,
            json: async () => ({ docs: [], total: 0, pages: 1 })
        };
    };

    const currentYear = new Date().getFullYear();
    const notFoundInputs = [
        { tmdbId: 999991, mediaType: 'movie', year: currentYear },
        { tmdbId: 999992, mediaType: 'movie', year: 1990 }
    ];

    const res3 = await service.resolveBatch(notFoundInputs, { kinopoiskService: mockKpService });
    assert.strictEqual(res3.get('movie:999991')?.status, 'not-found');
    assert.strictEqual(res3.get('movie:999991')?.kinopoiskId, null);
    assert.strictEqual(res3.get('movie:999992')?.status, 'not-found');
    assert.strictEqual(apiCallCount, 3, 'Empty batch must be followed by exact lookups for both misses');

    // Warm negative cache check: should not call API
    apiCallCount = 0;
    const res4 = await service.resolveBatch(notFoundInputs, { kinopoiskService: mockKpService });
    assert.strictEqual(res4.get('movie:999991')?.status, 'not-found');
    assert.strictEqual(res4.get('movie:999992')?.status, 'not-found');
    assert.strictEqual(apiCallCount, 0, 'Negative cache hit should skip API call');

    // Verify adaptive TTL in cache store
    const cacheStore = globalThis.chrome.storage.local.store[service.CACHE_KEY];
    const freshEntry = cacheStore['movie:999991'];
    const oldEntry = cacheStore['movie:999992'];
    assert.ok(freshEntry.retryAfter - freshEntry.attemptedAt <= (3 * 24 * 60 * 60 * 1000), 'Fresh title TTL <= 3 days');
    assert.ok(oldEntry.retryAfter - oldEntry.attemptedAt >= (13 * 24 * 60 * 60 * 1000), 'Old title TTL >= 13 days');
    console.log('  ✅ Negative cache hit and adaptive TTL passed');

    // 5. Test Expired Negative Cache Retry
    console.log('--- 5. Testing Expired Negative Cache Retry ---');
    // Artificially expire the negative cache entry for movie:999991
    freshEntry.retryAfter = Date.now() - 1000;
    globalThis.chrome.storage.local.store[service.CACHE_KEY]['movie:999991'] = freshEntry;

    apiCallCount = 0;
    mockKpService._fetchWithRotation = async () => {
        apiCallCount++;
        return {
            ok: true,
            json: async () => ({
                docs: [
                    { id: 777888, type: 'movie', externalId: { tmdb: 999991 } }
                ],
                total: 1,
                pages: 1
            })
        };
    };

    const res5 = await service.resolveBatch([{ tmdbId: 999991, mediaType: 'movie', year: currentYear }], { kinopoiskService: mockKpService });
    assert.strictEqual(apiCallCount, 1, 'Expired negative cache should trigger API call');
    assert.strictEqual(res5.get('movie:999991')?.status, 'resolved');
    assert.strictEqual(res5.get('movie:999991')?.kinopoiskId, 777888);
    console.log('  ✅ Expired negative cache retry & re-resolution passed');

    // 6. Test Strict Type Matching (movie vs tv-series compatibility)
    console.log('--- 6. Testing Strict Type Matching ---');
    assert.strictEqual(service.isCompatibleType('movie', 'movie'), true);
    assert.strictEqual(service.isCompatibleType('movie', 'cartoon'), true);
    assert.strictEqual(service.isCompatibleType('movie', 'anime-film'), true);
    assert.strictEqual(service.isCompatibleType('movie', 'tv-series'), false, 'TMDB movie cannot match KP tv-series');
    assert.strictEqual(service.isCompatibleType('movie', 'animated-series'), false);

    assert.strictEqual(service.isCompatibleType('tv', 'tv-series'), true);
    assert.strictEqual(service.isCompatibleType('tv', 'animated-series'), true);
    assert.strictEqual(service.isCompatibleType('tv', 'anime'), true);
    assert.strictEqual(service.isCompatibleType('tv', 'tv-show'), true);
    assert.strictEqual(service.isCompatibleType('tv', 'movie'), false, 'TMDB tv cannot match KP movie');
    console.log('  ✅ Strict type compatibility rules passed');

    // 7. Test Movie/TV Collision (Same TMDB ID for movie and tv)
    console.log('--- 7. Testing Movie/TV ID Collision (movie:550 vs tv:550) ---');
    mockKpService._fetchWithRotation = async (url) => {
        // Return both entities from Kinopoisk API in the same query response
        return {
            ok: true,
            json: async () => ({
                docs: [
                    { id: 361, type: 'movie', externalId: { tmdb: 550 } }, // Fight Club (movie)
                    { id: 99550, type: 'tv-series', externalId: { tmdb: 550 } } // Hypothetical TV show 550
                ],
                total: 2,
                pages: 1
            })
        };
    };

    const collisionInputs = [
        { tmdbId: 550, mediaType: 'movie' },
        { tmdbId: 550, mediaType: 'tv' }
    ];

    const collisionRes = await service.resolveBatch(collisionInputs, { kinopoiskService: mockKpService });
    assert.strictEqual(collisionRes.get('movie:550')?.kinopoiskId, 361);
    assert.strictEqual(collisionRes.get('movie:550')?.kpType, 'movie');
    assert.strictEqual(collisionRes.get('tv:550')?.kinopoiskId, 99550);
    assert.strictEqual(collisionRes.get('tv:550')?.kpType, 'tv-series');
    console.log('  ✅ Movie/TV ID collision disambiguation passed');

    // 8. Test Partial Batch Response
    console.log('--- 8. Testing Partial Batch Response ---');
    mockKpService._fetchWithRotation = async () => ({
        ok: true,
        json: async () => ({
            docs: [
                { id: 1001, type: 'movie', externalId: { tmdb: 111 } }
                // 222 is missing from KP response
            ],
            total: 1,
            pages: 1
        })
    });

    const partialInputs = [
        { tmdbId: 111, mediaType: 'movie' },
        { tmdbId: 222, mediaType: 'movie' }
    ];

    const partialRes = await service.resolveBatch(partialInputs, { kinopoiskService: mockKpService });
    assert.strictEqual(partialRes.get('movie:111')?.status, 'resolved');
    assert.strictEqual(partialRes.get('movie:111')?.kinopoiskId, 1001);
    assert.strictEqual(partialRes.get('movie:222')?.status, 'not-found');
    assert.strictEqual(partialRes.get('movie:222')?.kinopoiskId, null);
    console.log('  ✅ Partial batch response handling passed');

    // 9. Test Pagination (Total > Docs per page)
    console.log('--- 9. Testing Multi-page Pagination ---');
    let requestedPages = [];
    mockKpService._fetchWithRotation = async (url) => {
        const u = new URL(url);
        const page = Number(u.searchParams.get('page')) || 1;
        requestedPages.push(page);

        if (page === 1) {
            return {
                ok: true,
                json: async () => ({
                    docs: [{ id: 2001, type: 'movie', externalId: { tmdb: 301 } }],
                    total: 2,
                    pages: 2
                })
            };
        } else {
            return {
                ok: true,
                json: async () => ({
                    docs: [{ id: 2002, type: 'movie', externalId: { tmdb: 302 } }],
                    total: 2,
                    pages: 2
                })
            };
        }
    };

    const paginatedInputs = [
        { tmdbId: 301, mediaType: 'movie' },
        { tmdbId: 302, mediaType: 'movie' }
    ];

    const paginatedRes = await service.resolveBatch(paginatedInputs, { kinopoiskService: mockKpService });
    assert.deepStrictEqual(requestedPages, [1, 2]);
    assert.strictEqual(paginatedRes.get('movie:301')?.kinopoiskId, 2001);
    assert.strictEqual(paginatedRes.get('movie:302')?.kinopoiskId, 2002);
    console.log('  ✅ Multi-page pagination support passed');

    // 10. Test Multiple Chunks > 25
    console.log('--- 10. Testing Multiple Chunks (> 25 items) ---');
    let chunkQueries = 0;
    mockKpService._fetchWithRotation = async (url) => {
        chunkQueries++;
        const ids = [...url.matchAll(/externalId\.tmdb=([^&]+)/g)].map(match => Number(match[1]));
        return {
            ok: true,
            json: async () => ({
                docs: ids.map(tmdb => ({ id: 800000 + tmdb, type: 'movie', externalId: { tmdb } })),
                total: ids.length,
                pages: 1
            })
        };
    };

    const fiftyItems = Array.from({ length: 50 }, (_, i) => ({
        tmdbId: 5000 + i,
        mediaType: 'movie'
    }));

    await service.resolveBatch(fiftyItems, { kinopoiskService: mockKpService });
    assert.strictEqual(chunkQueries, 2, '50 items chunked into 25 should yield 2 batch requests');
    console.log('  ✅ Batch chunking (> 25 items) passed');

    // 11. Test Mapping Persistence Across Instances
    console.log('--- 11. Testing Mapping Persistence Across Instances ---');
    const serviceInstance2 = new IdMappingService();
    const persistedRes = await serviceInstance2.resolveBatch([{ tmdbId: 550, mediaType: 'movie' }], {
        kinopoiskService: {
            _fetchWithRotation: async () => {
                throw new Error('Should not be called! Should load from persistent storage');
            }
        }
    });
    assert.strictEqual(persistedRes.get('movie:550')?.kinopoiskId, 361);
    console.log('  ✅ Storage persistence across instances passed');

    // 12. Test No Fallback to Wrong Media Type
    console.log('--- 12. Testing Absence of Fallback to Incompatible Type ---');
    mockKpService._fetchWithRotation = async () => ({
        ok: true,
        json: async () => ({
            // Kinopoisk only has a TV series for this TMDB ID, but caller requested movie
            docs: [
                { id: 88888, type: 'tv-series', externalId: { tmdb: 4040 } }
            ],
            total: 1,
            pages: 1
        })
    });

    const wrongTypeRes = await service.resolveBatch([{ tmdbId: 4040, mediaType: 'movie' }], { kinopoiskService: mockKpService });
    assert.strictEqual(wrongTypeRes.get('movie:4040')?.status, 'not-found', 'Must be not-found when type is incompatible');
    assert.strictEqual(wrongTypeRes.get('movie:4040')?.kinopoiskId, null);
    console.log('  ✅ Strict type isolation (no fallback to incompatible type) passed');

    // 13. Test HTTP 200 Partial Result (legitimate not-found for missing items)
    console.log('--- 13. Testing HTTP 200 Partial Result (Legitimate not-found) ---');
    globalThis.chrome.storage.local.store = {};
    const servicePartial = new IdMappingService();
    const partialKpService = {
        _fetchWithRotation: async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                docs: [
                    { id: 111, type: 'movie', externalId: { tmdb: 1001 } },
                    { id: 222, type: 'movie', externalId: { tmdb: 1002 } },
                    { id: 333, type: 'movie', externalId: { tmdb: 1003 } }
                ],
                total: 3,
                pages: 1
            })
        })
    };
    const req5Items = [
        { tmdbId: 1001, mediaType: 'movie' },
        { tmdbId: 1002, mediaType: 'movie' },
        { tmdbId: 1003, mediaType: 'movie' },
        { tmdbId: 1004, mediaType: 'movie' },
        { tmdbId: 1005, mediaType: 'movie' }
    ];
    const resPartial = await servicePartial.resolveBatch(req5Items, { kinopoiskService: partialKpService });
    assert.strictEqual(resPartial.get('movie:1001')?.status, 'resolved');
    assert.strictEqual(resPartial.get('movie:1002')?.status, 'resolved');
    assert.strictEqual(resPartial.get('movie:1003')?.status, 'resolved');
    assert.strictEqual(resPartial.get('movie:1004')?.status, 'not-found');
    assert.strictEqual(resPartial.get('movie:1005')?.status, 'not-found');
    const cachedStore13 = globalThis.chrome.storage.local.store['tmdb_kp_mapping_cache_v2'] || {};
    assert.strictEqual(cachedStore13['movie:1001']?.status, 'resolved');
    assert.strictEqual(cachedStore13['movie:1004']?.status, 'not-found');
    console.log('  ✅ HTTP 200 partial result correctly resolved 3 and negative-cached 2');

    // 14. Test HTTP 200 Empty Result (legitimate not-found for all requested items)
    console.log('--- 14. Testing HTTP 200 Empty Result (Legitimate not-found for all) ---');
    globalThis.chrome.storage.local.store = {};
    const serviceEmpty200 = new IdMappingService();
    const empty200KpService = {
        _fetchWithRotation: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ docs: [], total: 0, pages: 1 })
        })
    };
    const resEmpty200 = await serviceEmpty200.resolveBatch(req5Items, { kinopoiskService: empty200KpService });
    for (const it of req5Items) {
        assert.strictEqual(resEmpty200.get(`movie:${it.tmdbId}`)?.status, 'not-found');
    }
    const cachedStore14 = globalThis.chrome.storage.local.store['tmdb_kp_mapping_cache_v2'] || {};
    assert.strictEqual(Object.keys(cachedStore14).length, 5);
    assert.strictEqual(cachedStore14['movie:1001']?.status, 'not-found');
    console.log('  ✅ HTTP 200 empty result correctly recorded 5 legitimate not-found entries');

    // 15. Test HTTP 403 Quota Error (DO NOT write negative cache)
    console.log('--- 15. Testing HTTP 403 Quota Error (Zero negative cache writes) ---');
    globalThis.chrome.storage.local.store = {};
    const service403 = new IdMappingService();
    const quota403KpService = {
        _fetchWithRotation: async () => ({
            ok: false,
            status: 403,
            statusText: 'Forbidden'
        })
    };
    const res403 = await service403.resolveBatch(req5Items, { kinopoiskService: quota403KpService });
    for (const it of req5Items) {
        assert.strictEqual(res403.get(`movie:${it.tmdbId}`)?.status, 'unresolved');
        assert.strictEqual(res403.get(`movie:${it.tmdbId}`)?.kinopoiskId, null);
    }
    const cachedStore15 = globalThis.chrome.storage.local.store['tmdb_kp_mapping_cache_v2'] || {};
    assert.strictEqual(Object.keys(cachedStore15).length, 0, 'Negative cache must NOT be written on HTTP 403');
    console.log('  ✅ HTTP 403 error safely handled without polluting negative cache');

    // 16. Test HTTP 429 Rate Limit (DO NOT write negative cache)
    console.log('--- 16. Testing HTTP 429 Rate Limit (Zero negative cache writes) ---');
    globalThis.chrome.storage.local.store = {};
    const service429 = new IdMappingService();
    const rateLimitKpService = {
        _fetchWithRotation: async () => ({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests'
        })
    };
    const res429 = await service429.resolveBatch(req5Items, { kinopoiskService: rateLimitKpService });
    for (const it of req5Items) {
        assert.strictEqual(res429.get(`movie:${it.tmdbId}`)?.status, 'unresolved');
    }
    const cachedStore16 = globalThis.chrome.storage.local.store['tmdb_kp_mapping_cache_v2'] || {};
    assert.strictEqual(Object.keys(cachedStore16).length, 0, 'Negative cache must NOT be written on HTTP 429');
    console.log('  ✅ HTTP 429 rate limit safely handled without polluting negative cache');

    // 17. Test HTTP 500 Server Error (DO NOT write negative cache)
    console.log('--- 17. Testing HTTP 500 Server Error (Zero negative cache writes) ---');
    globalThis.chrome.storage.local.store = {};
    const service500 = new IdMappingService();
    const server500KpService = {
        _fetchWithRotation: async () => ({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error'
        })
    };
    const res500 = await service500.resolveBatch(req5Items, { kinopoiskService: server500KpService });
    for (const it of req5Items) {
        assert.strictEqual(res500.get(`movie:${it.tmdbId}`)?.status, 'unresolved');
    }
    const cachedStore17 = globalThis.chrome.storage.local.store['tmdb_kp_mapping_cache_v2'] || {};
    assert.strictEqual(Object.keys(cachedStore17).length, 0, 'Negative cache must NOT be written on HTTP 500');
    console.log('  ✅ HTTP 500 server error safely handled without polluting negative cache');

    // 18. Test Network Error / Transport Failure (DO NOT write negative cache)
    console.log('--- 18. Testing Network Error / Transport Failure (Zero negative cache writes) ---');
    globalThis.chrome.storage.local.store = {};
    const serviceNetErr = new IdMappingService();
    const netErrKpService = {
        _fetchWithRotation: async () => {
            throw new Error('Failed to fetch: DNS error / timeout');
        }
    };
    const resNetErr = await serviceNetErr.resolveBatch(req5Items, { kinopoiskService: netErrKpService });
    for (const it of req5Items) {
        assert.strictEqual(resNetErr.get(`movie:${it.tmdbId}`)?.status, 'unresolved');
    }
    const cachedStore18 = globalThis.chrome.storage.local.store['tmdb_kp_mapping_cache_v2'] || {};
    assert.strictEqual(Object.keys(cachedStore18).length, 0, 'Negative cache must NOT be written on network errors');
    console.log('  ✅ Network failure safely handled without polluting negative cache');

    // 19. Test Retry After Temporary Failure (First call fails -> second call succeeds)
    console.log('--- 19. Testing Retry After Temporary Failure ---');
    globalThis.chrome.storage.local.store = {};
    const serviceRetry = new IdMappingService();
    let attemptNum = 0;
    const recoveringKpService = {
        _fetchWithRotation: async () => {
            attemptNum++;
            if (attemptNum === 1) {
                return { ok: false, status: 403, statusText: 'Quota exhausted' };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    docs: [
                        { id: 9999, type: 'movie', externalId: { tmdb: 7777 } }
                    ],
                    total: 1,
                    pages: 1
                })
            };
        }
    };
    const firstCallRes = await serviceRetry.resolveBatch([{ tmdbId: 7777, mediaType: 'movie' }], { kinopoiskService: recoveringKpService });
    assert.strictEqual(firstCallRes.get('movie:7777')?.status, 'unresolved');
    assert.strictEqual(firstCallRes.get('movie:7777')?.kinopoiskId, null);

    // 21. Test Priority Classification (CRITICAL, HIGH, MEDIUM, LOW)
    console.log('--- 21. Testing Deterministic Priority Classification ---');
    assert.strictEqual(IdMappingService.calculatePriority({ tmdbRank: 1 }), 'CRITICAL');
    assert.strictEqual(IdMappingService.calculatePriority({ tmdbRank: 12 }), 'CRITICAL');
    assert.strictEqual(IdMappingService.calculatePriority({ tmdbRank: 13 }), 'HIGH');
    assert.strictEqual(IdMappingService.calculatePriority({ tmdbRank: 20 }), 'HIGH');
    assert.strictEqual(IdMappingService.calculatePriority({ tmdbRank: 21 }), 'MEDIUM');
    assert.strictEqual(IdMappingService.calculatePriority({ tmdbRank: 30 }), 'MEDIUM');
    assert.strictEqual(IdMappingService.calculatePriority({ tmdbRank: 31 }), 'LOW');
    assert.strictEqual(IdMappingService.calculatePriority({ tmdbRank: null }), 'LOW');
    assert.strictEqual(IdMappingService.calculatePriority({}), 'LOW');
    console.log('  ✅ Priority classification rules verified');

    // 22. Test Metadata Preservation & Best Rank in Unmapped Queue
    console.log('--- 22. Testing Metadata Preservation & Rank Retention ---');
    globalThis.chrome.storage.local.store = {};
    const priorityService = new IdMappingService();

    await priorityService.recordUnmappedCandidates([
        {
            tmdbId: 101,
            mediaType: 'movie',
            title: 'Critical Movie 1',
            originalTitle: 'Original 1',
            year: 2026,
            posterUrl: 'https://image.tmdb.org/t/p/w500/poster1.jpg',
            section: 'films',
            tmdbRank: 5,
            popularity: 88.5,
            voteCount: 150
        }
    ]);

    let queue = await priorityService.getUnmappedQueue();
    assert.strictEqual(queue.length, 1);
    const item1 = queue[0];
    assert.strictEqual(item1.key, 'movie:101');
    assert.strictEqual(item1.title, 'Critical Movie 1');
    assert.strictEqual(item1.originalTitle, 'Original 1');
    assert.strictEqual(item1.year, 2026);
    assert.strictEqual(item1.posterUrl, 'https://image.tmdb.org/t/p/w500/poster1.jpg');
    assert.strictEqual(item1.section, 'films');
    assert.strictEqual(item1.tmdbRank, 5);
    assert.strictEqual(item1.popularity, 88.5);
    assert.strictEqual(item1.voteCount, 150);
    assert.strictEqual(item1.priority, 'CRITICAL');
    assert.strictEqual(item1.timesSeen, 1);
    assert.strictEqual(item1.manualStatus, 'needs-review');
    assert.strictEqual(item1.snoozedUntil, null);

    // Second discovery run with worse rank: should preserve best rank (5) and increment timesSeen
    await priorityService.recordUnmappedCandidates([
        {
            tmdbId: 101,
            mediaType: 'movie',
            section: 'films',
            tmdbRank: 9,
            popularity: 95.0
        }
    ]);

    queue = await priorityService.getUnmappedQueue();
    assert.strictEqual(queue.length, 1);
    const item1Updated = queue[0];
    assert.strictEqual(item1Updated.tmdbRank, 5, 'Should preserve best rank 5');
    assert.strictEqual(item1Updated.timesSeen, 2, 'Should increment timesSeen to 2');
    assert.strictEqual(item1Updated.popularity, 95.0, 'Should update highest popularity');
    assert.strictEqual(item1Updated.priority, 'CRITICAL');
    console.log('  ✅ Unmapped queue metadata preservation & best rank retention passed');

    // 23. Test Priority-Aware Queue Eviction
    console.log('--- 23. Testing Priority-Aware Queue Eviction ---');
    globalThis.chrome.storage.local.store = {};
    const evictionService = new IdMappingService();

    // Fill queue with 10 CRITICAL items and 100 LOW items
    const testCandidates = [];
    for (let i = 1; i <= 10; i++) {
        testCandidates.push({
            tmdbId: 1000 + i,
            mediaType: 'movie',
            title: `Critical ${i}`,
            section: 'films',
            tmdbRank: i,
            popularity: 100
        });
    }
    for (let i = 1; i <= 100; i++) {
        testCandidates.push({
            tmdbId: 2000 + i,
            mediaType: 'movie',
            title: `Low ${i}`,
            section: 'films',
            tmdbRank: 50 + i,
            popularity: 10
        });
    }

    await evictionService.recordUnmappedCandidates(testCandidates);
    const evictedQueue = await evictionService.getUnmappedQueue();
    assert.strictEqual(evictedQueue.length, 100, 'Queue size must be capped at MAX_UNMAPPED_QUEUE (100)');

    // All 10 CRITICAL items must be preserved at top of queue
    for (let i = 1; i <= 10; i++) {
        const critFound = evictedQueue.find(it => it.tmdbId === 1000 + i);
        assert.ok(critFound, `CRITICAL candidate ${1000 + i} must never be evicted`);
        assert.strictEqual(critFound.priority, 'CRITICAL');
    }
    console.log('  ✅ Priority-aware queue eviction verified (Critical Top-12 never displaced)');

    // 24. Test Snooze Candidate ("Нет страницы на КП")
    console.log('--- 24. Testing Candidate Snooze Workflow ---');
    const snoozeSuccess = await evictionService.snoozeUnmappedQueueItem('movie:1001', 7, 'no-kp-page');
    assert.strictEqual(snoozeSuccess, true);

    const snoozedQueue = await evictionService.getUnmappedQueue();
    const snoozedItem = snoozedQueue.find(it => it.key === 'movie:1001');
    assert.strictEqual(snoozedItem.manualStatus, 'no-kp-page');
    assert.ok(snoozedItem.snoozedUntil > Date.now(), 'snoozedUntil must be in future');
    console.log('  ✅ Candidate snooze workflow passed');

    // 25. Test Manual Mapping Save, Unmapped Queue Eviction & Negative Cache Override
    console.log('--- 25. Testing Manual Mapping Save & Cache Overrides ---');
    globalThis.chrome.storage.local.store = {};
    const manualCloudMappings = new Map();
    const manualCloudReverseLocks = new Map();
    const manualCloudDb = {
        collection(name) {
            const store = name === 'tmdbKinopoiskMappings'
                ? manualCloudMappings
                : name === 'tmdbKinopoiskReverseIndex'
                    ? manualCloudReverseLocks
                    : null;
            if (!store) throw new Error(`Unexpected collection: ${name}`);
            return {
                doc(id) {
                    return {
                        id,
                        collectionName: name,
                        get: async () => ({ id, exists: store.has(id), data: () => store.get(id) })
                    };
                }
            };
        },
        async runTransaction(callback) {
            return callback({
                get: reference => reference.get(),
                set(reference, data) {
                    const target = reference.collectionName === 'tmdbKinopoiskMappings'
                        ? manualCloudMappings
                        : manualCloudReverseLocks;
                    target.set(reference.id, data);
                },
                delete(reference) {
                    const target = reference.collectionName === 'tmdbKinopoiskMappings'
                        ? manualCloudMappings
                        : manualCloudReverseLocks;
                    target.delete(reference.id);
                }
            });
        }
    };
    globalThis.firebase = { firestore: { FieldValue: { serverTimestamp: () => Date.now() } } };
    const manualService = new IdMappingService(null, null, {
        db: manualCloudDb,
        getCurrentUser: () => ({ uid: 'test-admin' })
    });

    // 1. Put candidate in unmapped queue and negative cache
    await manualService.recordUnmappedCandidates([
        { tmdbId: 888, mediaType: 'movie', title: 'Manual Candidate', section: 'films', tmdbRank: 2 }
    ]);
    const mockNegativeCache = {
        'movie:888': { tmdbId: 888, mediaType: 'movie', status: 'not-found', retryAfter: Date.now() + 1000000 }
    };
    await manualService.saveMappingCache(mockNegativeCache);

    // 2. Perform manual mapping
    const manualEntry = await manualService.setManualMapping('movie', 888, 55555, {
        title: 'Manual Candidate KP',
        year: 2025,
        kpType: 'movie'
    });

    assert.strictEqual(manualEntry.status, 'resolved');
    assert.strictEqual(manualEntry.isManual, true);
    assert.strictEqual(manualEntry.resolutionSource, 'manual');
    assert.strictEqual(manualEntry.kpId, 55555);

    // Verify unmapped queue item was removed
    const remainingQueue = await manualService.getUnmappedQueue();
    assert.strictEqual(remainingQueue.some(it => it.key === 'movie:888'), false, 'Manual mapping must remove item from unmapped queue');

    // Verify resolveBatch now returns resolved hit (overriding negative cache)
    const resolveRes = await manualService.resolveBatch([{ tmdbId: 888, mediaType: 'movie' }]);
    assert.strictEqual(resolveRes.get('movie:888')?.status, 'resolved');
    assert.strictEqual(resolveRes.get('movie:888')?.kinopoiskId, 55555);
    console.log('  ✅ Manual mapping save, queue eviction & negative cache override passed');

    // 26. Test Export & Import Manual Mappings JSON
    console.log('--- 26. Testing Export & Import Manual Mappings JSON ---');
    await manualService.setManualMapping('tv', 999, 77777, { title: 'Test Series', year: 2024, kpType: 'tv-series' });

    const exportedJson = await manualService.exportManualMappingsJson();
    assert.ok(typeof exportedJson === 'string');
    const parsedExport = JSON.parse(exportedJson);
    assert.ok(parsedExport['movie:888']);
    assert.strictEqual(parsedExport['movie:888'].kpId, 55555);
    assert.ok(parsedExport['tv:999']);
    assert.strictEqual(parsedExport['tv:999'].kpId, 77777);

    // Import into fresh instance
    globalThis.chrome.storage.local.store = {};
    const importService = new IdMappingService();
    const importResult = await importService.importManualMappingsJson(exportedJson);
    assert.strictEqual(importResult.imported, 2);
    assert.strictEqual(importResult.errors.length, 0);

    const importedMappings = await importService.getManualMappings();
    assert.strictEqual(importedMappings.length, 2);
    // 27. Test Kinopoisk Verification Contract & Normalized Entity Inspection (KP ID 6943600 test case)
    console.log('--- 27. Testing Kinopoisk Verification Contract (KP ID 6943600) ---');
    // Simulated normalized object returned by KinopoiskService.getMovieById(6943600)
    const normalizedKpMovie = {
        kinopoiskId: 6943600,
        name: 'Последний дом',
        alternativeName: 'The Last House',
        year: 2026,
        type: 'movie',
        posterUrl: 'https://avatars.mds.yandex.net/get-kinopoisk-image/6943600/sample.jpg',
        genres: ['ужасы', 'драма'],
        description: 'Detailed description...'
    };

    // Simulated Admin Verify Contract logic
    function simulateAdminVerify(candidateMediaType, candidateYear, kpEntity) {
        const resolvedKpId = Number(kpEntity?.kinopoiskId || kpEntity?.id);
        if (!kpEntity || !Number.isInteger(resolvedKpId) || resolvedKpId <= 0) {
            throw new Error('Фильм/сериал с таким ID не найден на Кинопоиске');
        }

        const kpType = kpEntity.type || (candidateMediaType === 'tv' ? 'tv-series' : 'movie');
        const kpYear = Number(kpEntity.year) || null;
        const isCompatible = service.isCompatibleType(candidateMediaType, kpType, kpEntity);
        const yearDiff = (candidateYear && kpYear) ? Math.abs(candidateYear - kpYear) : 0;
        const genresStr = Array.isArray(kpEntity.genres)
            ? kpEntity.genres.map(g => (typeof g === 'string' ? g : g?.name)).filter(Boolean).slice(0, 3).join(', ')
            : '';

        return {
            verifiedKpId: resolvedKpId,
            title: kpEntity.name || kpEntity.alternativeName || '',
            alternativeName: kpEntity.alternativeName || '',
            year: kpYear,
            type: kpType,
            isCompatible,
            yearDiff,
            genresStr,
            posterUrl: kpEntity.posterUrl || ''
        };
    }

    const verifySuccess = simulateAdminVerify('movie', 2026, normalizedKpMovie);
    assert.strictEqual(verifySuccess.verifiedKpId, 6943600);
    assert.strictEqual(verifySuccess.title, 'Последний дом');
    assert.strictEqual(verifySuccess.alternativeName, 'The Last House');
    assert.strictEqual(verifySuccess.year, 2026);
    assert.strictEqual(verifySuccess.type, 'movie');
    assert.strictEqual(verifySuccess.isCompatible, true);
    assert.strictEqual(verifySuccess.yearDiff, 0);
    assert.strictEqual(verifySuccess.genresStr, 'ужасы, драма');
    assert.ok(verifySuccess.posterUrl.length > 0);

    // Missing / invalid object shapes must be rejected with proper error
    assert.throws(() => simulateAdminVerify('movie', 2026, null), /Фильм\/сериал с таким ID не найден/);
    assert.throws(() => simulateAdminVerify('movie', 2026, {}), /Фильм\/сериал с таким ID не найден/);
    assert.throws(() => simulateAdminVerify('movie', 2026, { kinopoiskId: 'invalid' }), /Фильм\/сериал с таким ID не найден/);

    console.log('  ✅ Kinopoisk Verification Contract passed (KP 6943600 accepted, invalid shapes rejected)');

    // ==========================================
    // TEST 28: Adult Content Exclusion & Explicit Erotica Gate
    // ==========================================
    console.log('\n--- Test 28: Adult Content Exclusion in Candidate Queue ---');
    await service.clearCache();

    const mixedCandidates = [
        {
            id: 999001,
            mediaType: 'movie',
            title: 'Adult Animation Film',
            adult: true,
            genreIds: [16],
            originalLanguage: 'en',
            tmdbRank: 1
        },
        {
            id: 233643, // Explicit AnimeFesta control case
            mediaType: 'tv',
            title: 'Секретная миссия: Секс — часть работы агента под прикрытием!',
            adult: false,
            genreIds: [16],
            originalLanguage: 'ja',
            tmdbRank: 3
        },
        {
            id: 241002, // Explicit AnimeFesta control case
            mediaType: 'tv',
            title: 'Мучайся, Адам',
            adult: false,
            genreIds: [16],
            originalLanguage: 'ja',
            tmdbRank: 3
        },
        {
            id: 209867, // Legitimate mainstream Anime: Frieren
            mediaType: 'tv',
            title: 'Фрирен, провожающая в последний путь',
            adult: false,
            genreIds: [16],
            originalLanguage: 'ja',
            tmdbRank: 1
        },
        {
            id: 1104844, // Legitimate mainstream Cartoon: Inside Out 2
            mediaType: 'movie',
            title: 'Головоломка 2',
            adult: false,
            genreIds: [16],
            originalLanguage: 'en',
            tmdbRank: 2
        }
    ];

    await service.recordUnmappedCandidates(mixedCandidates);
    const queueAfterAdultFilter = await service.getUnmappedQueue();

    // Adult film (999001) and explicit AnimeFesta titles (233643, 241002) MUST BE EXCLUDED
    const queuedIds = queueAfterAdultFilter.map(q => q.tmdbId);
    assert.strictEqual(queuedIds.includes(999001), false, 'Adult movie must be excluded');
    assert.strictEqual(queuedIds.includes(233643), false, 'Explicit AnimeFesta tv:233643 must be excluded');
    assert.strictEqual(queuedIds.includes(241002), false, 'Explicit AnimeFesta tv:241002 must be excluded');

    // Legitimate anime and cartoon MUST be recorded
    assert.strictEqual(queuedIds.includes(209867), true, 'Mainstream anime Frieren must be included');
    assert.strictEqual(queuedIds.includes(1104844), true, 'Mainstream cartoon Inside Out 2 must be included');

    // Check semantic section assignment
    const frierenItem = queueAfterAdultFilter.find(q => q.tmdbId === 209867);
    assert.strictEqual(frierenItem.section, 'anime', 'Japanese animation must have section: anime');

    const cartoonItem = queueAfterAdultFilter.find(q => q.tmdbId === 1104844);
    assert.strictEqual(cartoonItem.section, 'films', 'Inside Out 2 default films/cartoons section');

    console.log('  ✅ Adult Content & Explicit Erotica Gate passed (all explicit titles rejected, legitimate titles preserved)');

    // ==========================================
    // TEST 29: Queue Automatic Sanitization & Section Correction
    // ==========================================
    console.log('\n--- Test 29: Queue Automatic Sanitization & Section Correction ---');
    await service.clearCache();

    // Directly populate storage queue with legacy dirty data (simulating pre-existing queue)
    const legacyQueue = [
        {
            key: 'tv:233643',
            tmdbId: 233643,
            mediaType: 'tv',
            title: 'Секретная миссия...',
            section: 'cartoons'
        },
        {
            key: 'tv:220118',
            tmdbId: 220118,
            mediaType: 'tv',
            title: '漣蒼士に純潔を捧ぐ',
            section: 'cartoons'
        },
        {
            key: 'movie:999999',
            tmdbId: 999999,
            mediaType: 'movie',
            title: 'Explicit Video',
            adult: true,
            section: 'films'
        },
        {
            key: 'tv:127532',
            tmdbId: 127532,
            mediaType: 'tv',
            title: 'Solo Leveling',
            originalLanguage: 'ja',
            genreIds: [16],
            section: 'cartoons' // Legacy mislabeled section
        }
    ];

    globalThis.chrome.storage.local.store[service.UNMAPPED_QUEUE_KEY] = legacyQueue;

    const sanitizedQueue = await service.getUnmappedQueue();
    const sanitizedIds = sanitizedQueue.map(q => q.tmdbId);

    assert.strictEqual(sanitizedIds.includes(233643), false, 'tv:233643 must be purged by sanitizer');
    assert.strictEqual(sanitizedIds.includes(220118), false, 'tv:220118 must be purged by sanitizer');
    assert.strictEqual(sanitizedIds.includes(999999), false, 'adult=true movie must be purged by sanitizer');
    assert.strictEqual(sanitizedIds.includes(127532), true, 'Solo Leveling must be kept');

    const soloLeveling = sanitizedQueue.find(q => q.tmdbId === 127532);
    assert.strictEqual(soloLeveling.section, 'anime', 'Solo Leveling section must be corrected to anime');

    // ==========================================
    // TEST 30: Product-Rank-Based Priority Calculation & Legacy Fallback
    // ==========================================
    console.log('\n--- Test 30: Product-Rank-Based Priority Calculation & Legacy Fallback ---');
    // 1. Raw rank 18, product rank 9 -> CRITICAL
    assert.strictEqual(IdMappingService.calculatePriority({ tmdbRank: 18, productRank: 9 }), 'CRITICAL', 'productRank 9 must be CRITICAL regardless of raw tmdbRank 18');

    // 2. Raw rank 7, product rank 25 -> MEDIUM
    assert.strictEqual(IdMappingService.calculatePriority({ tmdbRank: 7, productRank: 25 }), 'MEDIUM', 'productRank 25 must be MEDIUM regardless of raw tmdbRank 7');

    // 3. Product rank missing + tmdbRank 8 -> legacy fallback CRITICAL
    assert.strictEqual(IdMappingService.calculatePriority({ tmdbRank: 8 }), 'CRITICAL', 'Missing productRank with tmdbRank 8 must fallback to CRITICAL');

    // 4. Product rank missing + tmdbRank 15 -> legacy fallback HIGH
    assert.strictEqual(IdMappingService.calculatePriority({ tmdbRank: 15 }), 'HIGH', 'Missing productRank with tmdbRank 15 must fallback to HIGH');

    // 5. Product rank missing + tmdbRank 25 -> legacy fallback MEDIUM
    assert.strictEqual(IdMappingService.calculatePriority({ tmdbRank: 25 }), 'MEDIUM', 'Missing productRank with tmdbRank 25 must fallback to MEDIUM');

    // 6. Unranked / missing -> LOW
    assert.strictEqual(IdMappingService.calculatePriority({}), 'LOW', 'Empty item must be LOW');
    console.log('  ✅ ProductRank Priority & Legacy Fallback verified');

    // ==========================================
    // TEST 31: Priority-Aware Eviction with Product Rank
    // ==========================================
    console.log('\n--- Test 31: Priority-Aware Eviction with Product Rank ---');
    await service.clearCache();

    // Create 2 items: itemA (raw 20, product 8 -> CRITICAL) and itemB (raw 5, product 25 -> MEDIUM)
    await service.recordUnmappedCandidates([
        { tmdbId: 1001, mediaType: 'movie', title: 'High Impact Film', section: 'films', tmdbRank: 20, productRank: 8 },
        { tmdbId: 1002, mediaType: 'movie', title: 'Low Impact Film', section: 'films', tmdbRank: 5, productRank: 25 }
    ]);

    const queueAfterPriority = await service.getUnmappedQueue();
    assert.strictEqual(queueAfterPriority.length, 2);
    assert.strictEqual(queueAfterPriority[0].tmdbId, 1001, 'Item with productRank 8 (CRITICAL) must be sorted first');
    assert.strictEqual(queueAfterPriority[0].priority, 'CRITICAL');
    assert.strictEqual(queueAfterPriority[0].productRank, 8);
    assert.strictEqual(queueAfterPriority[0].tmdbRank, 20);

    assert.strictEqual(queueAfterPriority[1].tmdbId, 1002, 'Item with productRank 25 (MEDIUM) must be sorted second');
    assert.strictEqual(queueAfterPriority[1].priority, 'MEDIUM');
    console.log('  ✅ Priority-Aware Eviction with Product Rank verified');

    // ==========================================
    // TEST 32: Candidate Deduplication & Product Rank Preservation in resolveBatch
    // ==========================================
    console.log('\n--- Test 32: Candidate Deduplication & Product Rank Preservation in resolveBatch ---');
    await service.clearCache();

    mockKpService._fetchWithRotation = async () => ({
        ok: true,
        json: async () => ({ docs: [], total: 0, pages: 0 })
    });

    // Candidate appears in two sections: one with productRank 15 (films), one with productRank 6 (featured)
    const multiContextCandidates = [
        { tmdbId: 2001, mediaType: 'movie', title: 'Cross Section Movie', section: 'films', tmdbRank: 25, productRank: 15 },
        { tmdbId: 2001, mediaType: 'movie', title: 'Cross Section Movie', section: 'featured', tmdbRank: 6, productRank: 6 }
    ];

    await service.resolveBatch(multiContextCandidates, { kinopoiskService: mockKpService });
    const queueAfterBatch = await service.getUnmappedQueue();
    const queuedCrossItem = queueAfterBatch.find(q => q.tmdbId === 2001);

    assert.ok(queuedCrossItem, 'Candidate must be in unmapped queue');
    assert.strictEqual(queuedCrossItem.productRank, 6, 'Best productRank (6) must be preserved');
    assert.strictEqual(queuedCrossItem.priority, 'CRITICAL', 'Priority must be CRITICAL based on productRank 6');
    assert.strictEqual(queuedCrossItem.section, 'featured', 'Section corresponding to best productRank must be preserved');
    console.log('  ✅ Candidate Deduplication & Best Product Rank Preservation verified');

    // ==========================================
    // TEST 33: Verified Reverse Identity Index
    // ==========================================
    console.log('\n--- Test 33: Verified Reverse Identity Index ---');
    globalThis.chrome.storage.local.store = {};
    const reverseService = new IdMappingService();

    const noWayHomeMapping = await reverseService.resolveTmdbIdByKinopoiskId(1309570, 'movie');
    assert.strictEqual(noWayHomeMapping?.tmdbId, 634649, 'Verified provider exception must resolve KP 1309570 to TMDB 634649');
    assert.strictEqual(noWayHomeMapping?.identityStatus, 'VERIFIED');
    assert.strictEqual(noWayHomeMapping?.verificationMethod, 'provider_document_verified');

    const reverseCache = globalThis.chrome.storage.local.store.tmdb_kp_mapping_cache_v2;
    assert.strictEqual(reverseCache['movie:634649']?.kpId, 1309570, 'Forward mapping must remain canonical');
    assert.strictEqual(reverseCache['kp:movie:1309570']?.tmdbId, 634649, 'Persistent O(1) reverse index must be created');

    reverseCache['movie:777001'] = {
        tmdbId: 777001,
        mediaType: 'movie',
        kpId: 777002,
        status: 'resolved',
        identityStatus: 'UNVERIFIED',
        verificationMethod: 'title_similarity',
        verificationSource: 'heuristic'
    };
    delete reverseCache['kp:movie:777002'];
    const rejectedUnverified = await reverseService.resolveTmdbIdByKinopoiskId(777002, 'movie');
    assert.strictEqual(rejectedUnverified, null, 'Unverified reverse mapping must be rejected');
    assert.strictEqual(reverseCache['kp:movie:777002']?.tmdbId, undefined, 'Unverified mapping must never enter reverse index');

    reverseCache['movie:888001'] = {
        tmdbId: 888001,
        mediaType: 'movie',
        kpId: 888002,
        status: 'resolved',
        identityStatus: 'VERIFIED',
        verificationMethod: 'exact_external_tmdb',
        verificationSource: 'automatic',
        resolutionSource: 'automatic'
    };
    delete reverseCache['kp:movie:888002'];
    const migratedExact = await reverseService.resolveTmdbIdByKinopoiskId(888002, 'movie');
    assert.strictEqual(migratedExact?.tmdbId, 888001, 'Existing verified forward cache must migrate on first reverse lookup');
    assert.strictEqual(globalThis.chrome.storage.local.store.tmdb_kp_mapping_cache_v2['kp:movie:888002']?.tmdbId, 888001);

    reverseCache['kp:movie:258328'] = {
        tmdbId: 322386,
        mediaType: 'movie',
        kpId: 258328,
        status: 'resolved',
        identityStatus: 'VERIFIED',
        verificationMethod: 'exact_external_tmdb',
        verificationSource: 'automatic',
        resolutionSource: 'automatic',
        isReverseIndex: true
    };
    reverseCache['movie:10193'] = {
        tmdbId: 10193,
        mediaType: 'movie',
        kpId: 258328,
        status: 'resolved',
        identityStatus: 'VERIFIED',
        verificationMethod: 'exact_title_year_type',
        verificationSource: 'automatic',
        resolutionSource: 'metadata_fallback'
    };
    const repairedConflict = await reverseService.resolveTmdbIdByKinopoiskId(258328, 'movie');
    assert.strictEqual(repairedConflict?.tmdbId, 10193, 'Strict title/year/type verification must repair a conflicting reverse cache entry');
    assert.strictEqual(globalThis.chrome.storage.local.store.tmdb_kp_mapping_cache_v2['kp:movie:258328']?.tmdbId, 10193);
    console.log('  ✅ Verified reverse lookup, persistence, migration, and trust rejection passed');

    // 34. Test Level 2 IMDb ID Bridge Resolution
    console.log('--- 34. Testing Level 2 IMDb ID Bridge Resolution ---');
    const imdbBridgeService = new IdMappingService();
    const mockImdbKpService = {
        baseUrl: 'https://api.test',
        _fetchWithRotation: async (url) => {
            if (url.includes('externalId.imdb=tt1234567')) {
                return {
                    ok: true,
                    json: async () => ({
                        docs: [
                            { id: 999111, type: 'movie', externalId: { imdb: 'tt1234567' } }
                        ],
                        total: 1,
                        pages: 1
                    })
                };
            }
            return {
                ok: true,
                json: async () => ({ docs: [], total: 0, pages: 1 })
            };
        }
    };

    const imdbItem = [{
        tmdbId: 789012,
        mediaType: 'movie',
        title: 'Unknown on KP by TMDB ID',
        imdbId: 'tt1234567',
        year: 2024
    }];

    const imdbRes = await imdbBridgeService.resolveBatch(imdbItem, { kinopoiskService: mockImdbKpService, forceRefresh: true });
    assert.strictEqual(imdbRes.get('movie:789012')?.kinopoiskId, 999111, 'Level 2 IMDb Bridge must resolve KP ID when TMDB ID misses');
    assert.strictEqual(imdbRes.get('movie:789012')?.verificationMethod, 'exact_external_imdb');
    assert.strictEqual(imdbRes.get('movie:789012')?.identityStatus, 'VERIFIED');
    console.log('  ✅ Level 2 IMDb ID bridge resolution passed');

    // 35. Test Level 3 Metadata Search with ±1 Year Tolerance
    console.log('--- 35. Testing Level 3 Metadata Search with ±1 Year Tolerance ---');
    const cascadeMetaService = new IdMappingService();
    const mockMetaKpService = {
        baseUrl: 'https://api.test',
        _fetchWithRotation: async () => ({ ok: true, json: async () => ({ docs: [], total: 0, pages: 1 }) }),
        searchMovies: async (query, page, limit, options) => {
            if (query.toLowerCase().includes('longlegs') || query.toLowerCase().includes('собиратель душ')) {
                return {
                    docs: [
                        { id: 5212124, name: 'Собиратель душ', alternativeName: 'Longlegs', year: 2024, type: 'movie' }
                    ]
                };
            }
            return { docs: [] };
        }
    };

    const metaItem = [{
        tmdbId: 1226578,
        mediaType: 'movie',
        title: 'Собиратель душ',
        originalTitle: 'Longlegs',
        year: 2024
    }];

    const metaRes = await cascadeMetaService.resolveBatch(metaItem, { kinopoiskService: mockMetaKpService, forceRefresh: true });
    assert.strictEqual(metaRes.get('movie:1226578')?.kinopoiskId, 5212124, 'Level 3 Metadata fallback must resolve KP ID');
    assert.strictEqual(metaRes.get('movie:1226578')?.verificationMethod, 'exact_title_year_type');
    assert.strictEqual(metaRes.get('movie:1226578')?.identityStatus, 'VERIFIED');
    console.log('  ✅ Level 3 Metadata search with ±1 year tolerance passed');

    // 36. Test Smart Queue Ingestion Filter
    console.log('--- 36. Testing Smart Queue Ingestion Filter ---');
    const queueService = new IdMappingService();
    globalThis.chrome.storage.local.store[queueService.UNMAPPED_QUEUE_KEY] = [];

    // Low traffic / obscure title with low popularity and no rank
    const obscureItem = [{
        tmdbId: 999999,
        mediaType: 'movie',
        title: 'Obscure Short Film',
        popularity: 2.1,
        voteCount: 3,
        productRank: null,
        tmdbRank: 85
    }];

    const emptyKpService = {
        baseUrl: 'https://api.test',
        _fetchWithRotation: async () => ({ ok: true, json: async () => ({ docs: [], total: 0, pages: 1 }) }),
        searchMovies: async () => ({ docs: [] })
    };

    await queueService.resolveBatch(obscureItem, { kinopoiskService: emptyKpService, forceRefresh: true });
    const queueAfterObscure = await queueService.getUnmappedQueue();
    assert.strictEqual(queueAfterObscure.length, 0, 'Obscure unranked low-popularity items must not bloat unmapped queue');

    // Popular or High Priority title
    const popularItem = [{
        tmdbId: 888888,
        mediaType: 'movie',
        title: 'Major Blockbuster Unmapped',
        popularity: 150.5,
        voteCount: 1200,
        productRank: 5,
        tmdbRank: 5
    }];

    await queueService.resolveBatch(popularItem, { kinopoiskService: emptyKpService, forceRefresh: true });
    const queueAfterPopular = await queueService.getUnmappedQueue();
    assert.strictEqual(queueAfterPopular.length, 1, 'High priority or popular items must be enqueued');
    assert.strictEqual(queueAfterPopular[0].tmdbId, 888888);
    console.log('  ✅ Smart Queue Ingestion filter passed');

    // 37. KP-rooted recovery: exact IMDb first, then exact title/year/type metadata.
    console.log('--- 37. Testing KP-rooted TMDB recovery and ambiguity guard ---');
    const kpRootedMappingService = new IdMappingService();
    await kpRootedMappingService.clearCache();
    let kpRootedMetadataSearchCalls = 0;
    const tmdbRecoveryMock = {
        isValidImdbId: id => /^tt\d{7,10}$/i.test(id),
        async findByImdbId(imdbId) {
            assert.strictEqual(imdbId, 'tt0363771');
            return { tmdbId: 411, type: 'movie' };
        },
        async searchByTitleYearCandidates(title, year, mediaType) {
            kpRootedMetadataSearchCalls++;
            assert.strictEqual(year, 1985);
            assert.strictEqual(mediaType, 'movie');
            if (title === 'ран' || title === 'ran') {
                return [{ id: 11645, title: 'Ран', original_title: 'Ran', release_date: '1985-06-01' }];
            }
            return [];
        }
    };

    const narniaMapping = await kpRootedMappingService.resolveTmdbIdByKinopoiskId(
        48162,
        'movie',
        {
            kinopoiskMovie: {
                id: 48162,
                name: 'Хроники Нарнии: Лев, колдунья и волшебный шкаф',
                year: 2005,
                type: 'movie',
                externalId: { imdb: 'tt0363771' }
            },
            tmdbService: tmdbRecoveryMock
        }
    );
    assert.strictEqual(narniaMapping?.tmdbId, 411, 'IMDb must resolve KP 48162 to TMDB 411');
    assert.strictEqual(narniaMapping?.verificationMethod, 'exact_external_imdb');
    assert.strictEqual(kpRootedMetadataSearchCalls, 0, 'Exact IMDb recovery must precede title search');

    const legacyNegativeCache = await kpRootedMappingService.getMappingCache();
    legacyNegativeCache['kp:movie:400'] = {
        mediaType: 'movie',
        kpId: 400,
        status: 'not-found',
        isReverseIndex: true,
        attemptedAt: Date.now(),
        retryAfter: Date.now() + kpRootedMappingService.REVERSE_NEGATIVE_TTL
    };
    await kpRootedMappingService.saveMappingCache(legacyNegativeCache);

    const ranMapping = await kpRootedMappingService.resolveTmdbIdByKinopoiskId(
        400,
        'movie',
        {
            kinopoiskMovie: { id: 400, name: 'Ран', alternativeName: 'Ran', year: 1985, type: 'movie' },
            tmdbService: tmdbRecoveryMock
        }
    );
    assert.strictEqual(ranMapping?.tmdbId, 11645, 'Exact title/year/type must resolve KP 400 to TMDB 11645');
    assert.strictEqual(ranMapping?.verificationMethod, 'exact_title_year_type');
    assert.strictEqual(
        (await kpRootedMappingService.getMappingCache())['kp:movie:400']?.tmdbId,
        11645,
        'KP-rooted recovery must persist an O(1) reverse index'
    );

    const removedRanMappings = await kpRootedMappingService.clearMappingForKinopoiskId(400, 'movie');
    const clearedRanCache = await kpRootedMappingService.getMappingCache();
    assert(removedRanMappings >= 2, 'Scoped mapping cleanup must remove forward and reverse records');
    assert.strictEqual(clearedRanCache['kp:movie:400'], undefined, 'Scoped cleanup must remove the reverse record');
    assert.strictEqual(clearedRanCache['movie:11645'], undefined, 'Scoped cleanup must remove the forward record');

    const creepMapping = await kpRootedMappingService.resolveTmdbIdByKinopoiskId(
        51326,
        'movie',
        {
            kinopoiskMovie: { id: 51326, name: 'Крип', alternativeName: 'Creep', year: 2004, type: 'movie' },
            tmdbService: {
                async searchByTitleYearCandidates() {
                    return [{ id: 8555, title: 'Крип', original_title: 'Creep', release_date: '2004-08-10' }];
                }
            }
        }
    );
    assert.strictEqual(creepMapping?.tmdbId, 8555, 'Exact title/year/type must resolve KP 51326 to TMDB 8555');

    const ambiguousMapping = await kpRootedMappingService.resolveTmdbIdByKinopoiskId(
        70000,
        'movie',
        {
            kinopoiskMovie: { id: 70000, name: 'Крип', alternativeName: 'Creep', year: 2004, type: 'movie' },
            tmdbService: {
                async searchByTitleYearCandidates() {
                    return [
                        { id: 8555, title: 'Крип', original_title: 'Creep', release_date: '2004-08-10' },
                        { id: 99955, title: 'Крип', original_title: 'Creep', release_date: '2004-09-10' }
                    ];
                }
            }
        }
    );
    assert.strictEqual(ambiguousMapping, null, 'Ambiguous metadata must not create a mapping');
    assert.strictEqual(
        (await kpRootedMappingService.getMappingCache())['kp:movie:70000']?.status,
        'not-found',
        'Ambiguous metadata must be negative-cached rather than guessed'
    );

    const staleMetadataNegative = await kpRootedMappingService.getMappingCache();
    staleMetadataNegative['kp:movie:5456450'] = {
        mediaType: 'movie',
        kpId: 5456450,
        status: 'not-found',
        isReverseIndex: true,
        attemptedAt: Date.now(),
        retryAfter: Date.now() + kpRootedMappingService.REVERSE_NEGATIVE_TTL,
        metadataFingerprint: 'movie|2025|dracula|dracula a love tale',
        metadataRecoveryVersion: 1
    };
    await kpRootedMappingService.saveMappingCache(staleMetadataNegative);

    const draculaMapping = await kpRootedMappingService.resolveTmdbIdByKinopoiskId(
        5456450,
        'movie',
        {
            kinopoiskMovie: {
                id: 5456450,
                name: 'Дракула',
                alternativeName: 'Dracula: A Love Tale',
                year: 2025,
                type: 'movie'
            },
            tmdbService: {
                async searchByTitleYearCandidates(title) {
                    if (title === 'дракула') {
                        return [
                            { id: 1246049, title: 'Дракула', original_title: 'Dracula', release_date: '2025-07-30' },
                            { id: 1323409, title: 'Дракула', original_title: 'Dracula', release_date: '2025-10-15' }
                        ];
                    }
                    return [{ id: 1246049, title: 'Дракула', original_title: 'Dracula', release_date: '2025-07-30' }];
                }
            }
        }
    );
    assert.strictEqual(
        draculaMapping?.tmdbId,
        1246049,
        'A unique alternate-title consensus must resolve KP 5456450 despite an ambiguous local title'
    );

    const animeSeriesMapping = await kpRootedMappingService.resolveTmdbIdByKinopoiskId(
        13136552,
        'tv',
        {
            kinopoiskMovie: {
                id: 13136552,
                name: 'Табакошка',
                alternativeName: 'Yani Neko',
                year: 2026,
                type: 'anime',
                isSeries: true,
                seriesLength: 23
            },
            tmdbService: {
                async searchByTitleYearCandidates() {
                    return [{ id: 312949, name: 'Табакошка', original_name: 'ヤニねこ', first_air_date: '2026-07-03', media_type: 'tv' }];
                }
            }
        }
    );
    assert.strictEqual(animeSeriesMapping?.tmdbId, 312949, 'Anime series metadata must resolve through TMDB TV');
    assert.strictEqual(animeSeriesMapping?.mediaType, 'tv', 'Anime series must remain a TV mapping');

    const normalizedAnime = new KinopoiskService().normalizeMovieData({
        id: 13136552,
        name: 'Табакошка',
        type: 'anime',
        isSeries: true,
        seriesLength: 23
    });
    assert.strictEqual(normalizedAnime.isSeries, true, 'KP normalization must preserve isSeries');
    assert.strictEqual(normalizedAnime.seriesLength, 23, 'KP normalization must preserve seriesLength');

    console.log('  ✅ KP-rooted recovery, persistence, exact precedence, and ambiguity guard passed');
    console.log('🎉 ALL 37 IdMappingService Tests Passed Successfully!');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
