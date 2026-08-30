import assert from 'node:assert';
import TMDBService from '../src/shared/services/TMDBService.js';
import IdMappingService from '../src/shared/services/IdMappingService.js';
import RecommendationService from '../src/shared/services/RecommendationService.js';
import MediaClassifier from '../src/shared/utils/MediaClassifier.js';

// Setup global environment for tests
globalThis.MediaClassifier = MediaClassifier;

globalThis.TMDB_CONFIG = {
    BASE_URL: 'https://api.themoviedb.org/3',
    DEFAULT_LANGUAGE: 'ru-RU',
    API_KEYS: ['test_token_1'],
    API_KEY: 'test_token_1',
    MAX_REQUESTS_PER_SECOND: 35,
    rotateKey: () => {}
};

// Mock Chrome Storage
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
    console.log('🧪 Running Recommendation Pipeline & Queue Isolation Tests (Phase 1I-A)...');

    // Reset storage
    globalThis.chrome.storage.local.store = {};

    // ----------------------------------------------------
    // TEST 1: TMDBService Endpoint Construction & Normalization
    // ----------------------------------------------------
    console.log('\n--- 1. Testing TMDBService Recommendation & Similar Endpoints ---');
    const tmdb = new TMDBService();
    const interceptedUrls = [];

    tmdb._fetchWithRotation = async (url) => {
        interceptedUrls.push(url);
        if (url.includes('/movie/19995/recommendations')) {
            return {
                ok: true,
                json: async () => ({
                    page: 1,
                    results: [
                        {
                            id: 76600,
                            title: 'Аватар: Путь воды',
                            original_title: 'Avatar: The Way of Water',
                            release_date: '2022-12-14',
                            poster_path: '/avatar2.jpg',
                            backdrop_path: '/avatar2_back.jpg',
                            vote_average: 7.6,
                            vote_count: 11000,
                            genre_ids: [878, 12, 28],
                            adult: false,
                            original_language: 'en'
                        }
                    ]
                })
            };
        }
        if (url.includes('/tv/94997/recommendations')) {
            return {
                ok: true,
                json: async () => ({
                    page: 1,
                    results: [
                        {
                            id: 1399,
                            name: 'Игра престолов',
                            original_name: 'Game of Thrones',
                            first_air_date: '2011-04-17',
                            poster_path: '/got.jpg',
                            backdrop_path: '/got_back.jpg',
                            vote_average: 8.4,
                            vote_count: 23000,
                            genre_ids: [10765, 18, 10759],
                            adult: false,
                            original_language: 'en'
                        }
                    ]
                })
            };
        }
        if (url.includes('/movie/19995/similar')) {
            return {
                ok: true,
                json: async () => ({
                    page: 1,
                    results: [
                        {
                            id: 862,
                            title: 'История игрушек',
                            original_title: 'Toy Story',
                            release_date: '1995-10-30',
                            poster_path: '/toystory.jpg',
                            vote_average: 8.0,
                            vote_count: 17000,
                            genre_ids: [16, 12, 35],
                            adult: false,
                            original_language: 'en'
                        }
                    ]
                })
            };
        }
        if (url.includes('/tv/94997/similar')) {
            return {
                ok: true,
                json: async () => ({
                    page: 1,
                    results: [
                        {
                            id: 71912,
                            name: 'Ведьмак',
                            original_name: 'The Witcher',
                            first_air_date: '2019-12-20',
                            poster_path: '/witcher.jpg',
                            vote_average: 8.0,
                            vote_count: 5500,
                            genre_ids: [10765, 18],
                            adult: false,
                            original_language: 'en'
                        }
                    ]
                })
            };
        }
        return { ok: false, status: 404 };
    };

    const movieRecs = await tmdb.getRecommendations(19995, 'movie');
    assert.strictEqual(movieRecs.length, 1);
    assert.strictEqual(movieRecs[0].tmdbId, 76600);
    assert.strictEqual(movieRecs[0].name, 'Аватар: Путь воды');
    assert.strictEqual(movieRecs[0].mediaType, 'movie');
    assert(interceptedUrls.some(u => u.includes('/movie/19995/recommendations?language=ru-RU&page=1')));

    const tvRecs = await tmdb.getRecommendations(94997, 'tv');
    assert.strictEqual(tvRecs.length, 1);
    assert.strictEqual(tvRecs[0].tmdbId, 1399);
    assert.strictEqual(tvRecs[0].name, 'Игра престолов');
    assert.strictEqual(tvRecs[0].mediaType, 'tv');
    assert(interceptedUrls.some(u => u.includes('/tv/94997/recommendations?language=ru-RU&page=1')));

    const movieSimilar = await tmdb.getSimilar(19995, 'movie');
    assert.strictEqual(movieSimilar.length, 1);
    assert.strictEqual(movieSimilar[0].tmdbId, 862);

    const tvSimilar = await tmdb.getSimilar(94997, 'tv');
    assert.strictEqual(tvSimilar.length, 1);
    assert.strictEqual(tvSimilar[0].tmdbId, 71912);
    console.log('  ✅ TMDBService recommendation & similar endpoints passed');

    // ----------------------------------------------------
    // TEST 2: IdMappingService Queue Isolation & Regression Safety
    // ----------------------------------------------------
    console.log('\n--- 2. Testing IdMappingService Queue Isolation ---');
    const idMapper = new IdMappingService();

    // Mock KP service that returns empty results (all items unmapped)
    const emptyMockKp = {
        baseUrl: 'https://api.poiskkino.dev',
        _fetchWithRotation: async () => ({
            ok: true,
            json: async () => ({ docs: [], total: 0, pages: 1 })
        })
    };

    // Case A: Recommendation call with skipQueue: true -> 0 queue additions
    globalThis.chrome.storage.local.store = {};
    const unmappedCandidates = [
        { tmdbId: 101, mediaType: 'movie', tmdbRank: 1, title: 'Rec 1' },
        { tmdbId: 102, mediaType: 'movie', tmdbRank: 2, title: 'Rec 2' },
        { tmdbId: 103, mediaType: 'movie', tmdbRank: 3, title: 'Rec 3' }
    ];

    const batchRes = await idMapper.resolveBatch(unmappedCandidates, {
        skipQueue: true,
        kinopoiskService: emptyMockKp
    });

    assert.strictEqual(batchRes.size, 3);
    const queueAfterRec = await idMapper.getUnmappedQueue();
    assert.strictEqual(queueAfterRec.length, 0, 'Recommendation misses must NOT enter unmapped queue when skipQueue is true');
    console.log('  ✅ Queue bypass verified: 0 items enqueued with skipQueue: true');

    // Case B: Default call without skipQueue (Home discovery style) -> enqueues normally
    const homeCandidates = [
        { tmdbId: 201, mediaType: 'movie', tmdbRank: 1, title: 'Home 1' }
    ];

    const homeBatchRes = await idMapper.resolveBatch(homeCandidates, {
        kinopoiskService: emptyMockKp
    });

    assert.strictEqual(homeBatchRes.size, 1);
    const queueAfterHome = await idMapper.getUnmappedQueue();
    assert.strictEqual(queueAfterHome.length, 1, 'Default resolveBatch must still enqueue unmapped candidates for Home');
    assert.strictEqual(queueAfterHome[0].tmdbId, 201);
    assert.strictEqual(queueAfterHome[0].priority, 'CRITICAL', 'Rank 1 Home item must still receive CRITICAL priority');
    console.log('  ✅ Backward compatibility verified: default resolveBatch still enqueues with correct priority');

    // Case C: Recommendation fast path bounds expensive metadata fallbacks
    let fastMetadataCalls = 0;
    let activeFastMetadataCalls = 0;
    let maxActiveFastMetadataCalls = 0;
    const fastPathMockKp = {
        baseUrl: 'https://api.poiskkino.dev',
        _fetchWithRotation: async () => ({
            ok: true,
            json: async () => ({ docs: [], total: 0, pages: 1 })
        }),
        searchMovies: async () => {
            fastMetadataCalls++;
            activeFastMetadataCalls++;
            maxActiveFastMetadataCalls = Math.max(maxActiveFastMetadataCalls, activeFastMetadataCalls);
            await new Promise(resolve => setTimeout(resolve, 10));
            activeFastMetadataCalls--;
            return { docs: [] };
        }
    };
    await idMapper.resolveBatch(
        Array.from({ length: 8 }, (_, index) => ({
            tmdbId: 301 + index,
            mediaType: 'movie',
            year: 2000,
            title: `Fast ${index}`
        })),
        {
            skipQueue: true,
            context: 'recommendations',
            fastPath: true,
            maxFallbackCandidates: 2,
            kinopoiskService: fastPathMockKp
        }
    );
    assert.strictEqual(fastMetadataCalls, 2, 'Recommendation fast path must bound metadata fallback work');
    assert.strictEqual(maxActiveFastMetadataCalls, 2, 'Recommendation metadata fallbacks must run concurrently within the budget');
    console.log('  ✅ Recommendation fast path bounded expensive mapping fallbacks');

    // ----------------------------------------------------
    // TEST 3: Primary Source & Deficit Fallback Logic
    // ----------------------------------------------------
    console.log('\n--- 3. Testing RecommendationService Primary vs Deficit Fallback ---');
    globalThis.chrome.storage.local.store = {};

    let similarCallCount = 0;
    let recCallCount = 0;

    const mockTmdbForPipeline = {
        getRecommendations: async (tmdbId, mediaType) => {
            recCallCount++;
            // Generate 8 recommendations
            const items = [];
            for (let i = 1; i <= 8; i++) {
                items.push({
                    tmdbId: 1000 + i,
                    id: 1000 + i,
                    name: `Rec Movie ${i}`,
                    title: `Rec Movie ${i}`,
                    mediaType: 'movie',
                    year: 2020 + (i % 3),
                    posterUrl: `/poster${i}.jpg`,
                    ratingTmdb: 7.5,
                    voteCount: 500,
                    genreIds: [28, 12],
                    adult: false
                });
            }
            return items;
        },
        getSimilar: async (tmdbId, mediaType) => {
            similarCallCount++;
            return [
                {
                    tmdbId: 2001,
                    id: 2001,
                    name: 'Similar Movie 1',
                    title: 'Similar Movie 1',
                    mediaType: 'movie',
                    year: 2019,
                    posterUrl: '/similar1.jpg',
                    ratingTmdb: 7.0,
                    voteCount: 300,
                    genreIds: [28],
                    adult: false
                }
            ];
        }
    };

    // Mock ID Mapper: Mappings for Rec 1..8
    const mockIdMapper = {
        buildKey: (type, id) => `${type}:${id}`,
        resolveBatch: async (items, options = {}) => {
            const map = new Map();
            for (const it of items) {
                map.set(`${it.mediaType}:${it.tmdbId}`, {
                    tmdbId: it.tmdbId,
                    mediaType: it.mediaType,
                    kinopoiskId: it.tmdbId + 50000, // Valid KP ID
                    status: 'resolved'
                });
            }
            return map;
        }
    };

    const recService = new RecommendationService({
        tmdbService: mockTmdbForPipeline,
        idMappingService: mockIdMapper
    });

    // Test 3A: 8 valid recommendations >= 6 threshold -> getSimilar must NOT be called
    similarCallCount = 0;
    recCallCount = 0;
    const resA = await recService.getRecommendationsForMovie({ tmdbId: 999, kinopoiskId: 888, mediaType: 'movie' });
    assert.strictEqual(resA.length, 8);
    assert.strictEqual(recCallCount, 1);
    assert.strictEqual(similarCallCount, 0, 'Similar must NOT be called when primary recommendations >= 6');
    assert.strictEqual(resA[0].recommendationSource, 'TMDB_RECOMMENDATIONS');
    console.log('  ✅ Primary recommendations sufficient (8 >= 6) -> 0 Similar calls verified');

    // Test 3B: Deficit: only 3 valid primary recommendations -> getSimilar MUST be called
    const mockTmdbDeficit = {
        getRecommendations: async () => [
            { tmdbId: 101, id: 101, name: 'Rec 1', mediaType: 'movie', adult: false, genreIds: [28] },
            { tmdbId: 102, id: 102, name: 'Rec 2', mediaType: 'movie', adult: false, genreIds: [28] },
            { tmdbId: 103, id: 103, name: 'Rec 3', mediaType: 'movie', adult: false, genreIds: [28] }
        ],
        getSimilar: async () => {
            similarCallCount++;
            return [
                { tmdbId: 201, id: 201, name: 'Sim 1', mediaType: 'movie', adult: false, genreIds: [28] },
                { tmdbId: 202, id: 202, name: 'Sim 2', mediaType: 'movie', adult: false, genreIds: [28] },
                { tmdbId: 203, id: 203, name: 'Sim 3', mediaType: 'movie', adult: false, genreIds: [28] }
            ];
        }
    };

    const recServiceDeficit = new RecommendationService({
        tmdbService: mockTmdbDeficit,
        idMappingService: mockIdMapper
    });

    similarCallCount = 0;
    const resB = await recServiceDeficit.getRecommendationsForMovie(
        { tmdbId: 999, kinopoiskId: 888, mediaType: 'movie' },
        { forceRefresh: true }
    );
    assert.strictEqual(resB.length, 6);
    assert.strictEqual(similarCallCount, 1, 'Similar MUST be called when primary < 6');
    assert.strictEqual(resB[0].recommendationSource, 'TMDB_RECOMMENDATIONS');
    assert.strictEqual(resB[2].recommendationSource, 'TMDB_RECOMMENDATIONS');
    assert.strictEqual(resB[3].recommendationSource, 'TMDB_SIMILAR');
    assert.strictEqual(resB[5].recommendationSource, 'TMDB_SIMILAR');
    console.log('  ✅ Deficit fallback verified: 3 primary + 3 similar appended');

    // Test 3C: Kinopoisk parser-first path avoids TMDB and KP API mapping calls
    let parserCallCount = 0;
    let parserRequestOptions = null;
    let parserFallbackTmdbCalls = 0;
    const parserOnlyService = new RecommendationService({
        kinopoiskService: {
            scrapeSimilarMoviesOffscreen: async (_kinopoiskId, options) => {
                parserCallCount++;
                parserRequestOptions = options;
                return Array.from({ length: 6 }, (_, index) => ({
                    kinopoiskId: 7001 + index,
                    mediaType: 'movie',
                    type: 'film',
                    name: `Parsed Movie ${index + 1}`,
                    year: 2018 + index,
                    posterUrl: `https://images.example/${index + 1}.jpg`,
                    kpRating: 7.1 + index / 10,
                    sourcePosition: index
                }));
            }
        },
        tmdbService: {
            getRecommendations: async () => {
                parserFallbackTmdbCalls++;
                return [];
            },
            getSimilar: async () => {
                parserFallbackTmdbCalls++;
                return [];
            }
        },
        idMappingService: mockIdMapper
    });

    const parserResults = await parserOnlyService.getRecommendationsForMovie(
        { tmdbId: 690593, kinopoiskId: 258687, mediaType: 'movie', year: 2012 },
        { forceRefresh: true }
    );
    assert.strictEqual(parserCallCount, 1);
    assert.strictEqual(parserRequestOptions.timeoutMs, 3500, 'Cold recommendation parser must use the bounded UI deadline');
    assert.strictEqual(parserRequestOptions.queueDeadlineMs, 3500, 'Queue time must consume the same recommendation deadline');
    assert.strictEqual(parserFallbackTmdbCalls, 0, 'Successful parser must bypass TMDB recommendations');
    assert.strictEqual(parserResults.length, 6);
    assert.deepStrictEqual(parserResults.map(item => item.kinopoiskId), [7001, 7002, 7003, 7004, 7005, 7006]);
    assert.strictEqual(parserResults[0].recommendationSource, 'KINOPOISK_LIKE_PARSER');
    assert.strictEqual(parserResults[0].tmdbId, null);
    assert.strictEqual(parserResults[0].kpRating, 7.1);
    console.log('  ✅ Kinopoisk /like/ parser-first path bypasses TMDB and preserves source order');

    // ----------------------------------------------------
    // TEST 4: Self-Exclusion & Deduplication
    // ----------------------------------------------------
    console.log('\n--- 4. Testing Self-Exclusion & Deduplication ---');
    const mockTmdbDuplicates = {
        getRecommendations: async () => [
            { tmdbId: 999, id: 999, name: 'Self Movie (TMDB match)', mediaType: 'movie', adult: false, genreIds: [28] },
            { tmdbId: 301, id: 301, name: 'Movie 1', mediaType: 'movie', adult: false, genreIds: [28] },
            { tmdbId: 301, id: 301, name: 'Movie 1 Duplicate', mediaType: 'movie', adult: false, genreIds: [28] },
            { tmdbId: 302, id: 302, name: 'Movie 2', mediaType: 'movie', adult: false, genreIds: [28] },
            { tmdbId: 303, id: 303, name: 'Movie 3 (resolves to source KP)', mediaType: 'movie', adult: false, genreIds: [28] },
            { tmdbId: 304, id: 304, name: 'Movie 4 (resolves to KP 99999)', mediaType: 'movie', adult: false, genreIds: [28] },
            { tmdbId: 305, id: 305, name: 'Movie 5 (also resolves to KP 99999)', mediaType: 'movie', adult: false, genreIds: [28] }
        ],
        getSimilar: async () => []
    };

    const mockIdMapperDedup = {
        buildKey: (type, id) => `${type}:${id}`,
        resolveBatch: async (items) => {
            const map = new Map();
            map.set('movie:301', { tmdbId: 301, mediaType: 'movie', kinopoiskId: 4001, status: 'resolved' });
            map.set('movie:302', { tmdbId: 302, mediaType: 'movie', kinopoiskId: 4002, status: 'resolved' });
            map.set('movie:303', { tmdbId: 303, mediaType: 'movie', kinopoiskId: 888, status: 'resolved' }); // Source KP ID
            map.set('movie:304', { tmdbId: 304, mediaType: 'movie', kinopoiskId: 99999, status: 'resolved' });
            map.set('movie:305', { tmdbId: 305, mediaType: 'movie', kinopoiskId: 99999, status: 'resolved' }); // Duplicate KP ID
            return map;
        }
    };

    const recServiceDedup = new RecommendationService({
        tmdbService: mockTmdbDuplicates,
        idMappingService: mockIdMapperDedup
    });

    const resDedup = await recServiceDedup.getRecommendationsForMovie(
        { tmdbId: 999, kinopoiskId: 888, mediaType: 'movie' },
        { forceRefresh: true }
    );

    // Should only keep movie:301 (KP 4001), movie:302 (KP 4002), movie:304 (KP 99999)
    assert.strictEqual(resDedup.length, 3);
    assert(!resDedup.some(r => r.tmdbId === 999), 'Source TMDB ID must be excluded');
    assert(!resDedup.some(r => r.kinopoiskId === 888), 'Source KP ID must be excluded');
    assert.strictEqual(resDedup.filter(r => r.tmdbId === 301).length, 1, 'Duplicate TMDB ID must be deduplicated');
    assert.strictEqual(resDedup.filter(r => r.kinopoiskId === 99999).length, 1, 'Duplicate KP ID must be deduplicated');
    console.log('  ✅ Self-exclusion and TMDB/KP deduplication verified');

    // ----------------------------------------------------
    // TEST 5: Semantic & Adult Safety
    // ----------------------------------------------------
    console.log('\n--- 5. Testing Semantic & Adult Safety ---');
    const mockTmdbSafety = {
        getRecommendations: async () => [
            { tmdbId: 401, name: 'Normal Cartoon', genreIds: [16, 12], originalLanguage: 'en', adult: false },
            { tmdbId: 402, name: 'Japanese Anime', genreIds: [16], originalLanguage: 'ja', adult: false },
            { tmdbId: 403, name: 'Adult Film', genreIds: [18], adult: true },
            { tmdbId: 404, name: 'Hentai Anime', genreIds: [16, 198385], originalLanguage: 'ja', adult: false }
        ],
        getSimilar: async () => []
    };

    const mockIdMapperSafety = {
        buildKey: (type, id) => `${type}:${id}`,
        resolveBatch: async (items) => {
            const map = new Map();
            items.forEach(it => map.set(`${it.mediaType}:${it.tmdbId}`, {
                tmdbId: it.tmdbId,
                mediaType: it.mediaType,
                kinopoiskId: it.tmdbId + 10000,
                status: 'resolved'
            }));
            return map;
        }
    };

    const recServiceSafety = new RecommendationService({
        tmdbService: mockTmdbSafety,
        idMappingService: mockIdMapperSafety
    });

    // Test Cartoon source -> rejects Japanese Anime (402), Adult (403), Hentai (404)
    const cartoonSource = { tmdbId: 900, kinopoiskId: 800, genreIds: [16], originalLanguage: 'en', type: 'cartoon' };
    const cartoonRes = await recServiceSafety.getRecommendationsForMovie(cartoonSource, { forceRefresh: true });
    assert.strictEqual(cartoonRes.length, 1);
    assert.strictEqual(cartoonRes[0].tmdbId, 401, 'Cartoon source must only retain Western cartoon and reject Anime/Adult');

    // Test Anime source -> allows Japanese Anime (402), rejects Adult (403), Hentai (404)
    const animeSource = { tmdbId: 901, kinopoiskId: 801, genreIds: [16], originalLanguage: 'ja', type: 'anime' };
    const animeRes = await recServiceSafety.getRecommendationsForMovie(animeSource, { forceRefresh: true });
    assert.strictEqual(animeRes.length, 1);
    assert.strictEqual(animeRes[0].tmdbId, 402, 'Anime source must retain Japanese Anime and reject Adult/Hentai');
    console.log('  ✅ Semantic isolation (cartoon vs anime) and adult/erotica rejection verified');

    // ----------------------------------------------------
    // TEST 6: In-Flight Deduplication
    // ----------------------------------------------------
    console.log('\n--- 6. Testing In-Flight Promise Deduplication ---');
    let callCounter = 0;
    const slowTmdb = {
        getRecommendations: async () => {
            callCounter++;
            await new Promise(res => setTimeout(res, 50));
            return [
                { tmdbId: 501, name: 'Movie A', mediaType: 'movie', adult: false, genreIds: [28] }
            ];
        },
        getSimilar: async () => []
    };

    const recServiceInFlight = new RecommendationService({
        tmdbService: slowTmdb,
        idMappingService: mockIdMapperSafety
    });

    // Execute two concurrent calls for same movie
    const [call1, call2] = await Promise.all([
        recServiceInFlight.getRecommendationsForMovie({ tmdbId: 777, mediaType: 'movie' }, { forceRefresh: true }),
        recServiceInFlight.getRecommendationsForMovie({ tmdbId: 777, mediaType: 'movie' }, { forceRefresh: true })
    ]);

    assert.strictEqual(call1.length, 1);
    assert.strictEqual(call2.length, 1);
    assert.strictEqual(callCounter, 1, 'Concurrent calls for same TMDB ID must share single execution');
    assert.strictEqual(recServiceInFlight.inFlightRequests.size, 0, 'In-flight map must be clean after resolution');
    console.log('  ✅ In-flight Promise deduplication verified');

    // ----------------------------------------------------
    // TEST 7: Local Storage Cache & LRU Bounds
    // ----------------------------------------------------
    console.log('\n--- 7. Testing Local Cache & Bounded LRU ---');
    globalThis.chrome.storage.local.store = {};

    let cacheProviderCalls = 0;
    const cacheTmdb = {
        getRecommendations: async (id) => {
            cacheProviderCalls++;
            return [
                { tmdbId: id + 10, name: `Cached Rec ${id}`, mediaType: 'movie', adult: false, genreIds: [28] }
            ];
        },
        getSimilar: async () => []
    };

    const recServiceCache = new RecommendationService({
        tmdbService: cacheTmdb,
        idMappingService: mockIdMapperSafety
    });

    // A stale schema must be ignored so old low-resolution recommendation DTOs
    // cannot survive after a poster contract change.
    const staleCacheKey = recServiceCache.getCacheKey(601, 'movie');
    globalThis.chrome.storage.local.store[staleCacheKey] = {
        schemaVersion: 1,
        tmdbId: 601,
        mediaType: 'movie',
        cachedAt: Date.now(),
        isFresh: false,
        items: [{ tmdbId: 610, posterUrl: 'https://st.kp.yandex.net/images/sm_film/610.jpg' }]
    };

    // Cold call
    const coldRes = await recServiceCache.getRecommendationsForMovie({ tmdbId: 601, mediaType: 'movie' });
    assert.strictEqual(coldRes.length, 1);
    assert.strictEqual(cacheProviderCalls, 1);
    assert.strictEqual(
        globalThis.chrome.storage.local.store[staleCacheKey].schemaVersion,
        recServiceCache.CACHE_SCHEMA_VERSION,
        'Stale recommendation cache schema must be replaced'
    );

    // Warm call (should read from cache)
    const warmRes = await recServiceCache.getRecommendationsForMovie({ tmdbId: 601, mediaType: 'movie' });
    assert.strictEqual(warmRes.length, 1);
    assert.strictEqual(cacheProviderCalls, 1, 'Warm call must hit cache with 0 TMDB provider calls');

    // Verify bounded LRU index: insert 105 entries -> max 100 kept
    for (let i = 1; i <= 105; i++) {
        await recServiceCache.setCachedRecommendations(i, 'movie', [{ tmdbId: i + 100, name: `Item ${i}` }]);
    }

    const indexRes = await chrome.storage.local.get(['movie_recommendations_index_v1']);
    const index = indexRes['movie_recommendations_index_v1'];
    assert.strictEqual(index.length, 100, 'LRU index must cap at max 100 entries');
    const evictedKey = recServiceCache.getCacheKey(1, 'movie');
    const evictedRes = await chrome.storage.local.get([evictedKey]);
    assert.strictEqual(evictedRes[evictedKey], undefined, 'Oldest entry (1) should be evicted from storage');
    console.log('  ✅ Local storage caching and bounded LRU eviction (max 100) verified');

    console.log('\n🎉 ALL Phase 1I-A Tests Passed Successfully!');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
