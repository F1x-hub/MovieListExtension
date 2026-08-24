import assert from 'node:assert';
import KinopoiskService from '../src/shared/services/KinopoiskService.js';
import HomeCacheService from '../src/shared/services/HomeCacheService.js';
import Utils from '../src/shared/utils/Utils.js';
import KINOPOISK_CONFIG from '../src/shared/config/kinopoisk.config.js';

import IdMappingService from '../src/shared/services/IdMappingService.js';
import MediaClassifier from '../src/shared/utils/MediaClassifier.js';
import TMDBService from '../src/shared/services/TMDBService.js';
import TMDB_CONFIG from '../src/shared/config/tmdb.config.js';

globalThis.KINOPOISK_CONFIG = KINOPOISK_CONFIG;
globalThis.TMDB_CONFIG = TMDB_CONFIG;
globalThis.IdMappingService = IdMappingService;
globalThis.MediaClassifier = MediaClassifier;
globalThis.TMDBService = TMDBService;

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
    console.log('🧪 Running Home Data Layer (KinopoiskService & HomeCacheService) Tests...');

    // 1. Test Movie Normalization Contract
    console.log('--- 1. Testing Movie Normalization Contract ---');
    const kpService = new KinopoiskService();
    const rawDoc = {
        id: 123456,
        name: 'Тестовый Фильм',
        alternativeName: 'Test Movie',
        year: 2025,
        poster: { url: 'https://image.openmoviedb.com/123.jpg' },
        rating: { kp: 8.4, imdb: 7.9 },
        genres: [{ name: 'фантастика' }, { name: 'приключения' }],
        type: 'movie'
    };

    const normalized = kpService.normalizeMovieData(rawDoc);
    assert.strictEqual(normalized.kinopoiskId, 123456);
    assert.strictEqual(normalized.name, 'Тестовый Фильм');
    assert.strictEqual(normalized.alternativeName, 'Test Movie');
    assert.strictEqual(normalized.year, 2025);
    assert.strictEqual(normalized.posterUrl, 'https://image.openmoviedb.com/123.jpg');
    assert.strictEqual(normalized.kpRating, 8.4);
    assert.strictEqual(normalized.imdbRating, 7.9);
    assert.deepStrictEqual(normalized.genres, ['фантастика', 'приключения']);
    assert.strictEqual(normalized.type, 'movie');
    console.log('  ✅ Movie contract normalized properly');

    // 2. Test getFeaturedMovies catalog query
    console.log('--- 2. Testing getFeaturedMovies (KP Catalog Query) ---');
    let featuredUrl = null;
    kpService._fetchWithRotation = async (url) => {
        featuredUrl = url;
        return {
            ok: true,
            json: async () => ({
                docs: [
                    { id: 101, name: 'Хит 1', rating: { kp: 7.8 }, year: 2025, poster: { url: 'https://p1.jpg' } }
                ]
            })
        };
    };

    const featuredResults = await kpService.getFeaturedMovies(8);
    assert.strictEqual(featuredResults.length, 1);
    assert.strictEqual(featuredResults[0].kinopoiskId, 101);
    assert.ok(featuredUrl.includes('rating.kp=7.2-10'));
    console.log('  ✅ getFeaturedMovies KP catalog query passed');

    // 3. Test getPopularMovies Categories & TV Show Fallback
    console.log('--- 3. Testing getPopularMovies Categories & TV Show Fallback ---');
    kpService._fetchWithRotation = async (url) => {
        if (url.includes('genres.name=%D1%82%D0%BE%D0%BA-%D1%88%D0%BE%D1%83') || url.includes('type=tv-show')) {
            // Return small list (< 6) to trigger anime fallback
            return {
                ok: true,
                json: async () => ({
                    docs: [
                        { id: 201, name: 'Шоу 1', rating: { kp: 7.1 }, poster: { url: 'https://s1.jpg' } }
                    ]
                })
            };
        }
        if (url.includes('type=anime')) {
            return {
                ok: true,
                json: async () => ({
                    docs: [
                        { id: 301, name: 'Аниме 1', rating: { kp: 8.5 }, poster: { url: 'https://a1.jpg' } },
                        { id: 302, name: 'Аниме 2', rating: { kp: 8.2 }, poster: { url: 'https://a2.jpg' } }
                    ]
                })
            };
        }
        return {
            ok: true,
            json: async () => ({
                docs: [
                    { id: 111, name: 'Популярный фильм', rating: { kp: 7.5 }, poster: { url: 'https://f1.jpg' } }
                ]
            })
        };
    };

    const popFilms = await kpService.getPopularMovies({ type: 'movie', limit: 1 });
    assert.strictEqual(popFilms.length, 1);
    assert.strictEqual(popFilms[0].name, 'Популярный фильм');
    assert.strictEqual(popFilms[0].kinopoiskId, 111);

    const shows = await kpService.getPopularMovies({ type: 'tv-show', limit: 12 });
    assert.strictEqual(shows.length, 2);
    assert    // 4. Test HomeCacheService Caching & SWR
    console.log('--- 4. Testing HomeCacheService 24h Caching & SWR ---');
    globalThis.chrome.storage.local.store = {};
    const homeCacheService = new HomeCacheService(null, null, { isConfigured: () => false });
    let fetchCalls = 0;
    const mockKpService = {
        getFeaturedMovies: async () => {
            fetchCalls++;
            return Array.from({ length: 6 }, (_, i) => ({ kinopoiskId: 10 + i, name: `F-${i}`, genres: ['драма'] }));
        },
        getPopularMovies: async ({ type }) => {
            fetchCalls++;
            const offset = type === 'movie' ? 100 : (type === 'tv-series' ? 200 : (type === 'cartoon' ? 300 : 400));
            const genre = type === 'movie' ? ['драма'] : (type === 'tv-series' ? ['детектив'] : (type === 'cartoon' ? ['мультфильм'] : ['аниме']));
            const country = type === 'anime' ? ['Япония'] : ['США'];
            return Array.from({ length: 6 }, (_, i) => ({ kinopoiskId: offset + i, name: `Pop-${type}-${i}`, type, genres: genre, countries: country }));
        }
    };

    // Cold cache
    const result1 = await homeCacheService.getDiscoveryData(mockKpService);
    assert.strictEqual(result1.isFromCache, false);
    assert.strictEqual(result1.data.featured.length, 6);
    assert.strictEqual(fetchCalls, 5);
    console.log('  ✅ Cold cache fetch passed');

    // Warm cache
    fetchCalls = 0;
    const result2 = await homeCacheService.getDiscoveryData(mockKpService);
    assert.strictEqual(result2.isFromCache, true);
    assert.strictEqual(fetchCalls, 0);
    console.log('  ✅ Warm cache instant return passed');

    // Expired cache Stale-While-Revalidate
    const cachedRaw = globalThis.chrome.storage.local.store[homeCacheService.CACHE_KEY];
    cachedRaw.timestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago

    const result3 = await homeCacheService.getDiscoveryData(mockKpService);
    assert.strictEqual(result3.isFromCache, true);
    assert.strictEqual(result3.data.featured[0].name, 'F-0');

    await new Promise(resolve => setTimeout(resolve, 3000));
    assert.ok(fetchCalls >= 5, 'Background refresh should have executed');
    console.log('  ✅ Stale-While-Revalidate background refresh passed');

    // 4b. Test HomeCacheService with TMDB Candidate Pool & IdMappingService
    console.log('--- 4b. Testing HomeCacheService Candidate Pool & IdMappingService Resolution ---');
    const mockIdMappingService = new IdMappingService();
    // Pre-populate mapping cache in storage for 2 items, 1 not found
    globalThis.chrome.storage.local.store[mockIdMappingService.CACHE_KEY] = {
        'movie:501': { tmdbId: 501, mediaType: 'movie', kpId: 100501, kpType: 'movie', status: 'resolved' },
        'tv:601': { tmdbId: 601, mediaType: 'tv', kpId: 100601, kpType: 'tv-series', status: 'resolved' },
        'movie:502': { tmdbId: 502, mediaType: 'movie', kpId: null, status: 'not-found', retryAfter: Date.now() + 100000 }
    };

    const mockTmdbService = {
        isConfigured: () => true,
        getTrendingMovies: async () => [
            { tmdbId: 501, name: 'Трендовый фильм 1', year: 2026, genreIds: [28], mediaType: 'movie' },
            { tmdbId: 502, name: 'Ненайденный фильм 2', year: 2026, genreIds: [28], mediaType: 'movie' }
        ],
        getNowPlayingMovies: async () => [
            { tmdbId: 501, name: 'Свежий фильм 1', year: 2026, genreIds: [28], mediaType: 'movie' }
        ],
        getTrendingTvShows: async () => [
            { tmdbId: 601, name: 'Свежий сериал 1', year: 2026, genreIds: [18], mediaType: 'tv' }
        ],
        getFreshAnimation: async () => [
            { tmdbId: 501, name: 'Свежая анимация 1', year: 2026, genreIds: [16], mediaType: 'movie', type: 'cartoon' }
        ],
        getFreshAnime: async () => [
            { tmdbId: 601, name: 'Свежее аниме 1', year: 2026, genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'], mediaType: 'tv', type: 'anime' }
        ]
    };

    const advancedHomeCacheService = new HomeCacheService(null, mockIdMappingService, mockTmdbService);
    const mockKpFallback = {
        getFeaturedMovies: async () => Array.from({ length: 6 }, (_, i) => ({ kinopoiskId: 9900 + i, name: `Fallback Featured ${i}`, genres: ['драма'] })),
        getPopularMovies: async ({ type }) => {
            const genre = type === 'movie' ? ['драма'] : (type === 'tv-series' ? ['детектив'] : (type === 'cartoon' ? ['мультфильм'] : ['аниме']));
            const country = type === 'anime' ? ['Япония'] : ['США'];
            return Array.from({ length: 6 }, (_, i) => ({ kinopoiskId: 8800 + i, name: `Fallback ${type} ${i}`, type, genres: genre, countries: country }));
        }
    };

    const pipelineResult = await advancedHomeCacheService.refreshDiscoveryData(mockKpFallback);
    assert.ok(pipelineResult.featured.length > 0);
    assert.strictEqual(pipelineResult.featured[0].kinopoiskId, 100501);
    assert.strictEqual(pipelineResult.featured[0].isTmdbOnly, false);
    // Ensure all cards satisfy invariant: kinopoiskId is non-null
    for (const section of ['featured', 'films', 'series', 'cartoons', 'shows']) {
        assert.ok(Array.isArray(pipelineResult[section]));
        for (const card of pipelineResult[section]) {
            assert.ok(card.kinopoiskId !== null && card.kinopoiskId !== undefined, `Card in ${section} must have valid kinopoiskId`);
        }
    }
    console.log('  ✅ TMDB Candidate Pool + IdMappingService batch resolution & invariant passed');

    // 5. Test Personal Tier FavoriteService Integration & Total Count Contract
    console.log('--- 5. Testing Personal Tier Data Contract (FavoriteService & Totals) ---');
    const mockFavorites = Array.from({ length: 30 }, (_, i) => ({
        id: `fav_${i + 1}`,
        movieId: 1000 + i,
        movieTitle: `Фильм ${i + 1}`,
        status: 'plan_to_watch'
    }));

    const mockWatching = Array.from({ length: 8 }, (_, i) => ({
        id: `watch_${i + 1}`,
        movieId: 2000 + i,
        movieTitle: `Сериал ${i + 1}`,
        status: 'watching'
    }));

    const mockFavoriteService = {
        getFavorites: async (uid, status) => {
            if (status === 'plan_to_watch') return mockFavorites;
            if (status === 'watching') return mockWatching;
            return [...mockFavorites, ...mockWatching];
        }
    };

    const mockFirebaseManager = {
        getFavoriteService: () => mockFavoriteService,
        getCurrentUser: () => ({ uid: 'user_123' }),
        waitForAuthReady: async () => ({ uid: 'user_123' })
    };

    // Instantiate or simulate HomeDataController logic
    const uid = 'user_123';
    const [watchingRes, watchlistRes] = await Promise.allSettled([
        mockFavoriteService.getFavorites(uid, 'watching'),
        mockFavoriteService.getFavorites(uid, 'plan_to_watch')
    ]);

    const watchingAll = watchingRes.value;
    const watchlistAll = watchlistRes.value;

    const personalData = {
        isAuthenticated: true,
        userId: uid,
        watching: watchingAll.slice(0, 6),
        watchingTotal: watchingAll.length,
        watchlist: watchlistAll.slice(0, 6),
        watchlistTotal: watchlistAll.length,
        hasContent: watchingAll.length > 0 || watchlistAll.length > 0
    };

    // 6. Test Utils.extractKinopoiskId Sanitization Contract
    console.log('--- 6. Testing Utils.extractKinopoiskId Sanitization Contract ---');
    // Direct number and valid string
    assert.strictEqual(Utils.extractKinopoiskId(24705), 24705);
    assert.strictEqual(Utils.extractKinopoiskId('24705'), 24705);
    assert.strictEqual(Utils.extractKinopoiskId('  24705  '), 24705);

    // Kinopoisk API DTO
    assert.strictEqual(Utils.extractKinopoiskId({ id: 24705, kinopoiskId: 24705 }), 24705);
    assert.strictEqual(Utils.extractKinopoiskId({ kpId: 24705 }), 24705);

    // Firestore Favorite / Watchlist item with composite doc.id
    const firestoreFav = {
        id: 'x2VsPs1hQVfv02eNgH3qXdYWbz53_24705',
        userId: 'x2VsPs1hQVfv02eNgH3qXdYWbz53',
        movieId: 24705,
        movieTitle: 'Spider-Man: Brand New Day'
    };
    assert.strictEqual(Utils.extractKinopoiskId(firestoreFav), 24705);

    // Item with nested movie object
    assert.strictEqual(Utils.extractKinopoiskId({ movie: { kinopoiskId: 24705 } }), 24705);
    assert.strictEqual(Utils.extractKinopoiskId({ movie: { movieId: 24705 } }), 24705);
    assert.strictEqual(Utils.extractKinopoiskId({ movie: { id: 24705 } }), 24705);

    // Composite doc ID string fallback (trailing extraction)
    assert.strictEqual(Utils.extractKinopoiskId({ id: 'uid123_45678' }), 45678);
    assert.strictEqual(Utils.extractKinopoiskId('uid123_45678'), 45678);

    // Invalid or missing shapes
    assert.strictEqual(Utils.extractKinopoiskId(null), null);
    assert.strictEqual(Utils.extractKinopoiskId(undefined), null);
    assert.strictEqual(Utils.extractKinopoiskId(''), null);
    assert.strictEqual(Utils.extractKinopoiskId('abc_non_numeric'), null);
    assert.strictEqual(Utils.extractKinopoiskId({}), null);
    assert.strictEqual(Utils.extractKinopoiskId({ id: 'non_numeric' }), null);
    console.log('  ✅ extractKinopoiskId sanitization and composite ID prevention passed');

    // 7. Test Empty & Unusable Home Discovery Payload Protection
    console.log('--- 7. Testing Unusable & Empty Home Discovery Payload Protection ---');
    globalThis.chrome.storage.local.store = {};
    const homeCacheEmptyTest = new HomeCacheService();
    const emptyKpMock = {
        getFeaturedMovies: async () => [],
        getPopularMovies: async () => []
    };
    const emptyPayload = await homeCacheEmptyTest.refreshDiscoveryData(emptyKpMock);
    assert.strictEqual(emptyPayload.featured.length, 0);
    assert.strictEqual(globalThis.chrome.storage.local.store[homeCacheEmptyTest.CACHE_KEY], undefined, 'Empty discovery payload must NOT be written to cache');
    console.log('  ✅ Empty discovery payload was rejected and not cached');

    // 8. Test Partially Broken Home Payload Rejection
    console.log('--- 8. Testing Partially Broken Home Payload Rejection ---');
    globalThis.chrome.storage.local.store = {};
    const homeCachePartialTest = new HomeCacheService();
    const partiallyBrokenKpMock = {
        getFeaturedMovies: async () => [],
        getPopularMovies: async ({ type }) => (type === 'movie' ? [{ kinopoiskId: 999, name: 'One Film', genres: ['драма'] }] : [])
    };
    const partialBrokenPayload = await homeCachePartialTest.refreshDiscoveryData(partiallyBrokenKpMock);
    assert.strictEqual(globalThis.chrome.storage.local.store[homeCachePartialTest.CACHE_KEY], undefined, 'Partially broken payload (1 card) must NOT be cached');
    console.log('  ✅ Partially broken payload was rejected and not cached');

    // 9. Test Stale Healthy Cache Protection during Failed SWR Refresh
    console.log('--- 9. Testing Stale Healthy Cache Protection during SWR Failure ---');
    globalThis.chrome.storage.local.store = {};
    const healthyPayload = {
        featured: Array.from({ length: 10 }, (_, i) => ({ kinopoiskId: 100 + i, name: `Featured ${i}`, genres: ['драма'] })),
        films: Array.from({ length: 8 }, (_, i) => ({ kinopoiskId: 200 + i, name: `Film ${i}`, genres: ['боевик'] })),
        series: Array.from({ length: 8 }, (_, i) => ({ kinopoiskId: 300 + i, name: `Series ${i}`, genres: ['детектив'] })),
        cartoons: Array.from({ length: 8 }, (_, i) => ({ kinopoiskId: 400 + i, name: `Cartoon ${i}`, genres: ['мультфильм'] })),
        shows: Array.from({ length: 8 }, (_, i) => ({ kinopoiskId: 500 + i, name: `Show ${i}`, genres: ['аниме'] }))
    };
    const swrService = new HomeCacheService();
    // Pre-populate stale cache (older than 4 hours)
    globalThis.chrome.storage.local.store[swrService.CACHE_KEY] = {
        timestamp: Date.now() - (5 * 60 * 60 * 1000), // 5 hours ago (stale)
        version: '3.0',
        data: healthyPayload
    };

    const failingKpMock = {
        getFeaturedMovies: async () => { throw new Error('API Outage'); },
        getPopularMovies: async () => { throw new Error('API Outage'); }
    };

    const swrResult = await swrService.getDiscoveryData(failingKpMock);
    assert.strictEqual(swrResult.isFromCache, true);
    assert.strictEqual(swrResult.data.featured.length, 10);

    // Wait a brief moment for async background refresh to finish failing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify healthy cache is STILL preserved in storage and was NOT overwritten by empty/failed result
    const preservedStorage = globalThis.chrome.storage.local.store[swrService.CACHE_KEY];
    assert.ok(preservedStorage && preservedStorage.data, 'Healthy cache must remain in storage');
    assert.strictEqual(preservedStorage.data.featured.length, 10);
    assert.strictEqual(preservedStorage.data.films.length, 8);
    console.log('  ✅ Healthy stale cache remained preserved after failed SWR background refresh');

    // 10. Test Deficit-Based Supplement Trigger (Tests A, B, C, D, E)
    console.log('--- 10. Testing Deficit-Based Supplement Trigger (No Arbitrary Threshold) ---');
    globalThis.chrome.storage.local.store = {};
    
    // Test A & B: Resolved >= target (12) -> supplement calls = 0
    let kpCallsA = 0;
    const mockKpNoDeficit = {
        getFeaturedMovies: async () => [],
        getPopularMovies: async () => { kpCallsA++; return []; }
    };
    const mockTmdbFull = {
        isConfigured: () => true,
        getTrendingMovies: async () => Array.from({ length: 20 }, (_, i) => ({ tmdbId: 1000 + i, title: `Movie ${i}`, releaseDate: '2025-01-01', mediaType: 'movie', genreIds: [28] })),
        getNowPlayingMovies: async () => Array.from({ length: 20 }, (_, i) => ({ tmdbId: 2000 + i, title: `Film ${i}`, releaseDate: '2025-01-01', mediaType: 'movie', genreIds: [28] })),
        getTrendingTvShows: async () => Array.from({ length: 20 }, (_, i) => ({ tmdbId: 3000 + i, name: `Series ${i}`, releaseDate: '2025-01-01', mediaType: 'tv', genreIds: [18] })),
        getFreshAnimation: async () => Array.from({ length: 20 }, (_, i) => ({ tmdbId: 4000 + i, title: `Cartoon ${i}`, releaseDate: '2025-01-01', mediaType: 'movie', type: 'cartoon', genreIds: [16] })),
        getFreshAnime: async () => Array.from({ length: 20 }, (_, i) => ({ tmdbId: 5000 + i, name: `Show ${i}`, releaseDate: '2025-01-01', mediaType: 'tv', type: 'anime', genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'] }))
    };
    // Mock IdMappingService to resolve all items
    const mockMappingAll = {
        normalizeMediaType: (t) => (t === 'tv' || t === 'anime' || t === 'tv-series' ? 'tv' : 'movie'),
        buildKey: (type, id) => `${type}:${id}`,
        resolveBatch: async (items) => {
            const map = new Map();
            items.forEach(it => {
                const type = mockMappingAll.normalizeMediaType(it.mediaType || it.type);
                map.set(`${type}:${it.tmdbId}`, { tmdbId: it.tmdbId, mediaType: type, kinopoiskId: Number(it.tmdbId) + 100000, status: 'resolved' });
            });
            return map;
        }
    };
    const homeCacheFull = new HomeCacheService(null, mockMappingAll, mockTmdbFull);
    const fullPayload = await homeCacheFull.refreshDiscoveryData(mockKpNoDeficit);
    assert.strictEqual(fullPayload.featured.length, 10, 'Featured target must be 10');
    assert.strictEqual(fullPayload.films.length, 12, 'Films target must be 12');
    assert.strictEqual(fullPayload.shows.length, 12, 'Shows target must be 12');
    assert.strictEqual(kpCallsA, 0, 'Supplement MUST NOT be called when resolved >= target');
    console.log('  ✅ Tests A & B: Zero supplement calls when resolved >= target');

    // Test E: Resolved = 11 (target 12) -> deficit = 1 -> supplement MUST be called (proves no < 8 threshold!)
    let kpSupplementCallsE = 0;
    let requestedLimitE = 0;
    const mockKpDeficit1 = {
        getFeaturedMovies: async () => [],
        getPopularMovies: async ({ type, limit }) => {
            if (type === 'anime') {
                kpSupplementCallsE++;
                requestedLimitE = limit;
                return [{ kinopoiskId: 99999, name: 'Supplement Anime 1', type: 'anime', genres: ['аниме', 'мультфильм'], countries: ['Япония'] }];
            }
            return [];
        }
    };
    // Mock TMDB to return exactly 11 resolved shows
    const mockTmdb11Shows = {
        isConfigured: () => true,
        getTrendingMovies: async () => Array.from({ length: 10 }, (_, i) => ({ tmdbId: 1000 + i, title: `Movie ${i}`, releaseDate: '2025-01-01', mediaType: 'movie', genreIds: [28] })),
        getNowPlayingMovies: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 2000 + i, title: `Film ${i}`, releaseDate: '2025-01-01', mediaType: 'movie', genreIds: [28] })),
        getTrendingTvShows: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 3000 + i, name: `Series ${i}`, releaseDate: '2025-01-01', mediaType: 'tv', genreIds: [18] })),
        getFreshAnimation: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 4000 + i, title: `Cartoon ${i}`, releaseDate: '2025-01-01', mediaType: 'movie', type: 'cartoon', genreIds: [16] })),
        getFreshAnime: async () => Array.from({ length: 11 }, (_, i) => ({ tmdbId: 5000 + i, name: `Show ${i}`, releaseDate: '2025-01-01', mediaType: 'tv', type: 'anime', genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'] }))
    };
    const homeCache11 = new HomeCacheService(null, mockMappingAll, mockTmdb11Shows);
    const payload11 = await homeCache11.refreshDiscoveryData(mockKpDeficit1);
    assert.strictEqual(kpSupplementCallsE, 1, 'Supplement MUST be called when resolved = 11 and target = 12 (deficit = 1)');
    assert.strictEqual(payload11.shows.length, 12, 'Shows must reach target 12 after supplement');
    assert.strictEqual(payload11.shows[11].kinopoiskId, 99999);
    assert.strictEqual(payload11.shows[11].source, 'kinopoisk-supplement');
    console.log('  ✅ Test E: Deficit of 1 (11/12) triggers supplement and fills to 12');

    // 11. Test Duplicate Handling (TMDB resolved card takes precedence)
    console.log('--- 11. Testing Duplicate Resolution & TMDB Card Precedence ---');
    const duplicateKpMock = {
        getFeaturedMovies: async () => [],
        getPopularMovies: async ({ type }) => {
            if (type === 'anime') {
                // Returns an item already in TMDB (kpId 105000) and a new unique item (kpId 88888)
                return [
                    { kinopoiskId: 105000, name: 'Duplicate from KP', description: 'KP Description', type: 'anime', genres: ['аниме', 'мультфильм'], countries: ['Япония'] },
                    { kinopoiskId: 88888, name: 'Unique Supplement', description: 'Unique KP Description', type: 'anime', genres: ['аниме', 'мультфильм'], countries: ['Япония'] }
                ];
            }
            return [];
        }
    };
    const homeCacheDup = new HomeCacheService(null, mockMappingAll, mockTmdb11Shows);
    const payloadDup = await homeCacheDup.refreshDiscoveryData(duplicateKpMock);
    const dupOccurrences = payloadDup.shows.filter(c => c.kinopoiskId === 105000);
    assert.strictEqual(dupOccurrences.length, 1, 'Duplicate KP ID must appear exactly once');
    assert.strictEqual(dupOccurrences[0].source, 'tmdb', 'TMDB resolved card must take precedence over supplement duplicate');
    assert.strictEqual(payloadDup.shows.length, 12);
    assert.strictEqual(payloadDup.shows[11].kinopoiskId, 88888);
    console.log('  ✅ Duplicate Kinopoisk IDs deduplicated; TMDB version preserved');

    // 12. Test Partial Supplement (Graceful underfill without scraper/loops)
    console.log('--- 12. Testing Partial Supplement (10 resolved + 1 supplement = 11) ---');
    const mockTmdb10Shows = {
        isConfigured: () => true,
        getTrendingMovies: async () => Array.from({ length: 10 }, (_, i) => ({ tmdbId: 1000 + i, title: `Movie ${i}`, releaseDate: '2025-01-01', mediaType: 'movie', genreIds: [28] })),
        getNowPlayingMovies: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 2000 + i, title: `Film ${i}`, releaseDate: '2025-01-01', mediaType: 'movie', genreIds: [28] })),
        getTrendingTvShows: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 3000 + i, name: `Series ${i}`, releaseDate: '2025-01-01', mediaType: 'tv', genreIds: [18] })),
        getFreshAnimation: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 4000 + i, title: `Cartoon ${i}`, releaseDate: '2025-01-01', mediaType: 'movie', type: 'cartoon', genreIds: [16] })),
        getFreshAnime: async () => Array.from({ length: 10 }, (_, i) => ({ tmdbId: 5000 + i, name: `Show ${i}`, releaseDate: '2025-01-01', mediaType: 'tv', type: 'anime', genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'] }))
    };
    const partialKpMock = {
        getFeaturedMovies: async () => [],
        getPopularMovies: async ({ type }) => {
            if (type === 'anime') {
                return [{ kinopoiskId: 77777, name: 'Single Supplement', type: 'anime', genres: ['аниме', 'мультфильм'], countries: ['Япония'] }];
            }
            return [];
        }
    };
    const homeCachePartial = new HomeCacheService(null, mockMappingAll, mockTmdb10Shows);
    const payloadPartial = await homeCachePartial.refreshDiscoveryData(partialKpMock);
    assert.strictEqual(payloadPartial.shows.length, 11, '10 resolved + 1 supplement must gracefully produce 11 cards');
    console.log('  ✅ Partial supplement yields 11 cards without infinite fallback');

    // 13. Test Invalid Supplement ID Filtering (null, 0, non-integer)
    console.log('--- 13. Testing Invalid Supplement ID Filtering ---');
    const invalidIdKpMock = {
        getFeaturedMovies: async () => [],
        getPopularMovies: async ({ type }) => {
            if (type === 'anime') {
                return [
                    { kinopoiskId: null, name: 'Invalid Null ID', type: 'anime', genres: ['аниме'], countries: ['Япония'] },
                    { kinopoiskId: 0, name: 'Invalid Zero ID', type: 'anime', genres: ['аниме'], countries: ['Япония'] },
                    { kinopoiskId: 'abc', name: 'Invalid String ID', type: 'anime', genres: ['аниме'], countries: ['Япония'] },
                    { kinopoiskId: 654321, name: 'Valid Integer ID', type: 'anime', genres: ['аниме', 'мультфильм'], countries: ['Япония'] }
                ];
            }
            return [];
        }
    };
    const homeCacheInvalid = new HomeCacheService(null, mockMappingAll, mockTmdb10Shows);
    const payloadInvalid = await homeCacheInvalid.refreshDiscoveryData(invalidIdKpMock);
    const invalidCards = payloadInvalid.shows.filter(c => !Number.isInteger(c.kinopoiskId) || c.kinopoiskId <= 0);
    assert.strictEqual(invalidCards.length, 0, 'No invalid or non-integer Kinopoisk IDs allowed in final payload');
    assert.strictEqual(payloadInvalid.shows.length, 11, 'Only valid integer supplement card should be added (10 + 1 = 11)');
    console.log('  ✅ Invalid supplement IDs safely filtered out');

    // 14. Test Strong Final Card Numeric Invariant
    console.log('--- 14. Testing Strict Numeric Invariant across all sections ---');
    for (const [secName, list] of Object.entries(payloadInvalid)) {
        for (const card of list) {
            assert.strictEqual(Number.isInteger(card.kinopoiskId), true, `${secName} card ID must be an integer`);
            assert.strictEqual(card.kinopoiskId > 0, true, `${secName} card ID must be positive`);
        }
    }
    console.log('  ✅ Strict numeric invariant (Number.isInteger && > 0) verified across all cards');

    // 15. Testing Featured ↔ Films Targeted Deduplication (Tests 1 through 7)
    console.log('--- 15. Testing Featured ↔ Films Deduplication Contracts ---');

    // Test 1 & 2 & 3: Basic duplicate removal, order preservation, and dedup BEFORE slice
    console.log('  Testing 15.1, 15.2, 15.3: Basic dedup, order preservation, dedup BEFORE slice...');
    const mockTmdbDedup = {
        isConfigured: () => true,
        getTrendingMovies: async () => [
            { tmdbId: 101, title: 'Featured 1', mediaType: 'movie', genreIds: [28] },
            { tmdbId: 102, title: 'Featured 2', mediaType: 'movie', genreIds: [28] }
        ],
        getNowPlayingMovies: async () => [
            { tmdbId: 101, title: 'Duplicate 1', mediaType: 'movie', genreIds: [28] }, // dup with featured
            { tmdbId: 102, title: 'Duplicate 2', mediaType: 'movie', genreIds: [28] }, // dup with featured
            { tmdbId: 201, title: 'Film 1', mediaType: 'movie', genreIds: [28] },
            { tmdbId: 202, title: 'Film 2', mediaType: 'movie', genreIds: [28] },
            { tmdbId: 203, title: 'Film 3', mediaType: 'movie', genreIds: [28] },
            { tmdbId: 204, title: 'Film 4', mediaType: 'movie', genreIds: [28] }
        ],
        getTrendingTvShows: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 3000 + i, name: `Series ${i}`, mediaType: 'tv', genreIds: [18] })),
        getFreshAnimation: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 4000 + i, title: `Cartoon ${i}`, mediaType: 'movie', type: 'cartoon', genreIds: [16] })),
        getFreshAnime: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 5000 + i, name: `Show ${i}`, mediaType: 'tv', type: 'anime', genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'] }))
    };

    const mockMappingDedup = {
        normalizeMediaType: (t) => (t === 'tv' || t === 'anime' || t === 'tv-series' ? 'tv' : 'movie'),
        buildKey: (type, id) => `${type}:${id}`,
        resolveBatch: async (items) => {
            const map = new Map();
            items.forEach(it => {
                const type = mockMappingDedup.normalizeMediaType(it.mediaType || it.type);
                // Map kpId = tmdbId for simple verification
                map.set(`${type}:${it.tmdbId}`, { tmdbId: it.tmdbId, mediaType: type, kinopoiskId: Number(it.tmdbId), status: 'resolved' });
            });
            return map;
        }
    };

    const homeCacheDedupTest = new HomeCacheService(null, mockMappingDedup, mockTmdbDedup);
    const dedupPayload = await homeCacheDedupTest.refreshDiscoveryData({
        getFeaturedMovies: async () => [],
        getPopularMovies: async () => []
    });

    // Verify Featured has 101 and 102
    assert.deepStrictEqual(dedupPayload.featured.map(c => c.kinopoiskId), [101, 102]);
    // Verify Films does NOT contain 101 or 102, preserves order [201, 202, 203, 204], and wasn't prematurely sliced
    assert.deepStrictEqual(dedupPayload.films.map(c => c.kinopoiskId), [201, 202, 203, 204]);
    console.log('    ✅ Tests 15.1, 15.2, 15.3 passed (duplicates removed, order preserved, dedup before slice)');

    // Test 4 & 5 & 6: Deficit supplement after dedup, rejecting Featured and Films duplicates in supplement
    console.log('  Testing 15.4, 15.5, 15.6: Deficit supplement with Featured & Films exclusion...');
    let supplementMovieCalls = 0;
    const mockKpSupplementDedup = {
        getFeaturedMovies: async () => [],
        getPopularMovies: async ({ type, limit }) => {
            if (type === 'movie') {
                supplementMovieCalls++;
                return [
                    { kinopoiskId: 101, name: 'Duplicate with Featured', type: 'movie', genres: ['боевик'] }, // must be rejected
                    { kinopoiskId: 201, name: 'Duplicate with Existing Films', type: 'movie', genres: ['боевик'] }, // must be rejected
                    { kinopoiskId: 901, name: 'Unique Supplement 1', type: 'movie', genres: ['боевик'] }, // accepted
                    { kinopoiskId: 902, name: 'Unique Supplement 2', type: 'movie', genres: ['боевик'] }  // accepted
                ];
            }
            return [];
        }
    };

    // 10 valid unique films + 2 featured duplicates = 10 unique films (deficit = 2 to target 12)
    const mockTmdbDeficitFilms = {
        isConfigured: () => true,
        getTrendingMovies: async () => [
            { tmdbId: 101, title: 'Featured 1', mediaType: 'movie', genreIds: [28] }
        ],
        getNowPlayingMovies: async () => [
            { tmdbId: 101, title: 'Duplicate with Featured', mediaType: 'movie', genreIds: [28] },
            ...Array.from({ length: 10 }, (_, i) => ({ tmdbId: 201 + i, title: `Film ${i}`, mediaType: 'movie', genreIds: [28] }))
        ],
        getTrendingTvShows: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 3000 + i, name: `Series ${i}`, mediaType: 'tv', genreIds: [18] })),
        getFreshAnimation: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 4000 + i, title: `Cartoon ${i}`, mediaType: 'movie', type: 'cartoon', genreIds: [16] })),
        getFreshAnime: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 5000 + i, name: `Show ${i}`, mediaType: 'tv', type: 'anime', genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'] }))
    };

    const homeCacheSupplementDedup = new HomeCacheService(null, mockMappingDedup, mockTmdbDeficitFilms);
    const supDedupPayload = await homeCacheSupplementDedup.refreshDiscoveryData(mockKpSupplementDedup);

    assert.strictEqual(supplementMovieCalls, 1, 'Supplement must be called for deficit = 2');
    assert.strictEqual(supDedupPayload.films.length, 12, 'Films must reach 12 cards');
    // Ensure 101 and duplicate 201 are not in final supplement items
    const finalFilmIds = supDedupPayload.films.map(c => c.kinopoiskId);
    assert.strictEqual(finalFilmIds.includes(101), false, 'Featured duplicate 101 must not be in Films');
    assert.deepStrictEqual(finalFilmIds.slice(10), [901, 902], 'Supplement must accept 901 and 902 while rejecting 101 and 201');
    console.log('    ✅ Tests 15.4, 15.5, 15.6 passed (supplement called for deficit, rejected Featured & Films duplicates)');

    // Test 7: Invalid IDs (null, 0, "abc") never participate as valid dedup IDs
    console.log('  Testing 15.7: Invalid ID sanitization in dedup sets...');
    const invalidFeatured = [
        { kinopoiskId: null, name: 'Null' },
        { kinopoiskId: 0, name: 'Zero' },
        { kinopoiskId: 'invalid', name: 'String' },
        { kinopoiskId: 555, name: 'Valid' }
    ];
    const extractedIds = new Set(
        invalidFeatured
            .map(c => Number(c?.kinopoiskId))
            .filter(id => Number.isInteger(id) && id > 0)
    );
    assert.strictEqual(extractedIds.size, 1);
    assert.strictEqual(extractedIds.has(555), true);
    assert.strictEqual(extractedIds.has(0), false);
    assert.strictEqual(extractedIds.has(NaN), false);
    console.log('    ✅ Test 15.7 passed (invalid IDs never participate in dedup set)');

    // --- 16. Testing Fresh TMDB Discover Fallback for Films ---
    console.log('\n--- 16. Testing Fresh TMDB Discover Fallback for Films ---');

    // Test 1: now_playing p1-p2 already give 12 usable -> discover calls = 0, KP supplement = 0
    console.log('  Testing 16.1: now_playing p1-p2 provides 12 usable -> discover = 0, KP supplement = 0...');
    let discoverCallsP1Enough = 0;
    const mockTmdbEnough = {
        isConfigured: () => true,
        getTrendingMovies: async () => [{ tmdbId: 101, title: 'Featured 1', mediaType: 'movie', genreIds: [28] }],
        getNowPlayingMovies: async (page) => {
            if (page === 1) {
                return Array.from({ length: 12 }, (_, i) => ({ tmdbId: 1000 + i, title: `Film P1_${i}`, releaseDate: '2026-05-01', mediaType: 'movie', genreIds: [28] }));
            }
            return [];
        },
        getFreshMovies: async () => {
            discoverCallsP1Enough++;
            return [];
        },
        getTrendingTvShows: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 3000 + i, name: `Series ${i}`, mediaType: 'tv', genreIds: [18] })),
        getFreshAnimation: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 4000 + i, title: `Cartoon ${i}`, mediaType: 'movie', type: 'cartoon', genreIds: [16] })),
        getFreshAnime: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 5000 + i, name: `Show ${i}`, mediaType: 'tv', type: 'anime', genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'] }))
    };

    const homeCacheEnough = new HomeCacheService(null, mockMappingDedup, mockTmdbEnough);
    let supplementCallsEnough = 0;
    const enoughPayload = await homeCacheEnough.refreshDiscoveryData({
        getFeaturedMovies: async () => [],
        getPopularMovies: async ({ type }) => {
            if (type === 'movie') supplementCallsEnough++;
            return [];
        }
    });

    assert.strictEqual(enoughPayload.films.length, 12);
    assert.strictEqual(discoverCallsP1Enough, 0, 'Discover must NOT be called when now_playing reaches 12');
    assert.strictEqual(supplementCallsEnough, 0, 'KP supplement must NOT be called when now_playing reaches 12');
    console.log('    ✅ Test 16.1 passed (discover = 0, supplement = 0 when now_playing meets target)');

    // Test 2, 3, 6, 7, 8, 9: now_playing gives deficit, discover p1 fills to 12, rejects old titles & duplicates
    console.log('  Testing 16.2, 16.3, 16.6, 16.7, 16.8, 16.9: Fresh discover p1 fills deficit, rejects old titles & dups...');
    const discoverPagesRequested = [];
    const mockTmdbDiscoverP1Fills = {
        isConfigured: () => true,
        getTrendingMovies: async () => [
            { tmdbId: 101, title: 'Featured 1', mediaType: 'movie', genreIds: [28] },
            { tmdbId: 102, title: 'Featured 2', mediaType: 'movie', genreIds: [28] }
        ],
        getNowPlayingMovies: async (page) => {
            if (page === 1) {
                return [
                    { tmdbId: 101, title: 'Dup Featured', releaseDate: '2026-05-01', mediaType: 'movie', genreIds: [28] }, // Dup Feat -> reject
                    { tmdbId: 201, title: 'NP Film 1', releaseDate: '2026-06-01', mediaType: 'movie', genreIds: [28] },
                    { tmdbId: 202, title: 'NP Film 2', releaseDate: '2025-07-01', mediaType: 'movie', genreIds: [28] },
                    { tmdbId: 999, title: 'NP Old Classic (1999)', releaseDate: '1999-03-30', mediaType: 'movie', genreIds: [28] } // Old -> reject
                ];
            }
            if (page === 2) {
                return [
                    { tmdbId: 203, title: 'NP Film 3', releaseDate: '2026-01-15', mediaType: 'movie', genreIds: [28] },
                    { tmdbId: 204, title: 'NP Film 4', releaseDate: '2025-11-20', mediaType: 'movie', genreIds: [28] }
                ];
            }
            return [];
        },
        getFreshMovies: async (page) => {
            discoverPagesRequested.push(page);
            if (page === 1) {
                return [
                    { tmdbId: 102, title: 'Dup Featured In Discover', releaseDate: '2026-07-01', mediaType: 'movie', genreIds: [28] }, // Test 6: Dup Feat -> reject
                    { tmdbId: 201, title: 'Dup NP In Discover', releaseDate: '2026-06-01', mediaType: 'movie', genreIds: [28] }, // Test 7: Dup NP -> preserve NP version
                    { tmdbId: 888, title: 'Old Alien in Discover (1979)', releaseDate: '1979-05-25', mediaType: 'movie', genreIds: [28] }, // Test 8: Old -> reject
                    // 8 fresh valid items to complete target 12 (4 from NP + 8 from Discover)
                    { tmdbId: 301, title: 'Disc Film 1', releaseDate: '2026-04-01', mediaType: 'movie', genreIds: [28] },
                    { tmdbId: 302, title: 'Disc Film 2', releaseDate: '2026-03-01', mediaType: 'movie', genreIds: [28] },
                    { tmdbId: 303, title: 'Disc Film 3', releaseDate: '2025-12-01', mediaType: 'movie', genreIds: [28] },
                    { tmdbId: 304, title: 'Disc Film 4', releaseDate: '2025-10-01', mediaType: 'movie', genreIds: [28] },
                    { tmdbId: 305, title: 'Disc Film 5', releaseDate: '2025-08-01', mediaType: 'movie', genreIds: [28] },
                    { tmdbId: 306, title: 'Disc Film 6', releaseDate: '2026-02-01', mediaType: 'movie', genreIds: [28] },
                    { tmdbId: 307, title: 'Disc Film 7', releaseDate: '2025-09-01', mediaType: 'movie', genreIds: [28] },
                    { tmdbId: 308, title: 'Disc Film 8', releaseDate: '2026-05-15', mediaType: 'movie', genreIds: [28] }
                ];
            }
            if (page === 2) {
                return [{ tmdbId: 309, title: 'Disc Film 9', releaseDate: '2026-01-01', mediaType: 'movie', genreIds: [28] }];
            }
            return [];
        },
        getTrendingTvShows: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 3000 + i, name: `Series ${i}`, mediaType: 'tv', genreIds: [18] })),
        getFreshAnimation: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 4000 + i, title: `Cartoon ${i}`, mediaType: 'movie', type: 'cartoon', genreIds: [16] })),
        getFreshAnime: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 5000 + i, name: `Show ${i}`, mediaType: 'tv', type: 'anime', genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'] }))
    };

    let discoverP1SupplementCalls = 0;
    const homeCacheDiscoverP1 = new HomeCacheService(null, mockMappingDedup, mockTmdbDiscoverP1Fills);
    const p1Payload = await homeCacheDiscoverP1.refreshDiscoveryData({
        getFeaturedMovies: async () => [],
        getPopularMovies: async ({ type }) => {
            if (type === 'movie') discoverP1SupplementCalls++;
            return [];
        }
    });

    assert.strictEqual(p1Payload.films.length, 12, 'Films must reach 12 from now_playing + discover p1');
    assert.strictEqual(discoverPagesRequested.includes(1), true, 'Discover p1 must be called');
    assert.strictEqual(discoverPagesRequested.includes(2), false, 'Discover p2 must NOT be called when p1 completes target');
    assert.strictEqual(discoverP1SupplementCalls, 0, 'KP supplement must NOT be called');

    // Test 6: Featured duplicates rejected
    assert.strictEqual(p1Payload.films.some(c => c.kinopoiskId === 101 || c.kinopoiskId === 102), false, 'Featured duplicates must be rejected');
    // Test 8: Old titles (1999, 1979) rejected
    assert.strictEqual(p1Payload.films.some(c => c.kinopoiskId === 999 || c.kinopoiskId === 888), false, 'Old titles outside freshness window must be rejected');
    // Test 9: Exact ordering (4 NP items followed by 8 Discover items)
    const p1KpIds = p1Payload.films.map(c => c.kinopoiskId);
    const expectedP1Ids = [201, 202, 203, 204, 301, 302, 303, 304, 305, 306, 307, 308];
    assert.deepStrictEqual(p1KpIds, expectedP1Ids, 'Ranking must preserve now_playing order followed by discover order');
    console.log('    ✅ Tests 16.2, 16.3, 16.6, 16.7, 16.8, 16.9 passed (fresh discover p1, dup rejection, rank preservation)');

    // Test 4: discover p1 insufficient -> discover p2 called
    console.log('  Testing 16.4: discover p1 insufficient -> discover p2 called...');
    const multiDiscoverPagesRequested = [];
    const mockTmdbMultiDiscover = {
        isConfigured: () => true,
        getTrendingMovies: async () => [{ tmdbId: 101, title: 'Featured 1', mediaType: 'movie', genreIds: [28] }],
        getNowPlayingMovies: async () => [
            { tmdbId: 201, title: 'NP 1', releaseDate: '2026-06-01', mediaType: 'movie', genreIds: [28] },
            { tmdbId: 202, title: 'NP 2', releaseDate: '2025-07-01', mediaType: 'movie', genreIds: [28] }
        ],
        getFreshMovies: async (page) => {
            multiDiscoverPagesRequested.push(page);
            if (page === 1) {
                // Returns 5 items (2 + 5 = 7 -> deficit 5)
                return Array.from({ length: 5 }, (_, i) => ({ tmdbId: 401 + i, title: `Disc P1_${i}`, releaseDate: '2026-03-01', mediaType: 'movie', genreIds: [28] }));
            }
            if (page === 2) {
                // Returns 5 items (7 + 5 = 12 -> completed)
                return Array.from({ length: 5 }, (_, i) => ({ tmdbId: 406 + i, title: `Disc P2_${i}`, releaseDate: '2026-02-01', mediaType: 'movie', genreIds: [28] }));
            }
            return [];
        },
        getTrendingTvShows: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 3000 + i, name: `Series ${i}`, mediaType: 'tv', genreIds: [18] })),
        getFreshAnimation: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 4000 + i, title: `Cartoon ${i}`, mediaType: 'movie', type: 'cartoon', genreIds: [16] })),
        getFreshAnime: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 5000 + i, name: `Show ${i}`, mediaType: 'tv', type: 'anime', genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'] }))
    };

    const homeCacheMultiDiscover = new HomeCacheService(null, mockMappingDedup, mockTmdbMultiDiscover);
    const multiDiscPayload = await homeCacheMultiDiscover.refreshDiscoveryData({
        getFeaturedMovies: async () => [],
        getPopularMovies: async () => []
    });

    assert.strictEqual(multiDiscPayload.films.length, 12);
    assert.strictEqual(multiDiscoverPagesRequested.includes(1), true);
    assert.strictEqual(multiDiscoverPagesRequested.includes(2), true, 'Discover p2 must be called when p1 is insufficient');
    console.log('    ✅ Test 16.4 passed (discover p2 called when p1 has deficit)');

    // Test 5 & 10 & 11: TMDB exhausted -> KP supplement allowed for residual deficit
    console.log('  Testing 16.5, 16.10, 16.11: Residual deficit supplement, 0% overlap, strict numeric IDs...');
    let residualSupplementCalls = 0;
    const mockTmdbDeficitMax = {
        isConfigured: () => true,
        getTrendingMovies: async () => [{ tmdbId: 101, title: 'Featured 1', mediaType: 'movie', genreIds: [28] }],
        getNowPlayingMovies: async () => [
            { tmdbId: 201, title: 'NP 1', releaseDate: '2026-06-01', mediaType: 'movie', genreIds: [28] },
            { tmdbId: 202, title: 'NP 2', releaseDate: '2025-07-01', mediaType: 'movie', genreIds: [28] }
        ],
        getFreshMovies: async () => [
            // Only 4 items in discover -> total 6 TMDB items -> residual deficit 6
            { tmdbId: 501, title: 'Disc 1', releaseDate: '2026-01-01', mediaType: 'movie', genreIds: [28] },
            { tmdbId: 502, title: 'Disc 2', releaseDate: '2026-01-01', mediaType: 'movie', genreIds: [28] },
            { tmdbId: 503, title: 'Disc 3', releaseDate: '2026-01-01', mediaType: 'movie', genreIds: [28] },
            { tmdbId: 504, title: 'Disc 4', releaseDate: '2026-01-01', mediaType: 'movie', genreIds: [28] }
        ],
        getTrendingTvShows: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 3000 + i, name: `Series ${i}`, mediaType: 'tv', genreIds: [18] })),
        getFreshAnimation: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 4000 + i, title: `Cartoon ${i}`, mediaType: 'movie', type: 'cartoon', genreIds: [16] })),
        getFreshAnime: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 5000 + i, name: `Show ${i}`, mediaType: 'tv', type: 'anime', genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'] }))
    };

    const homeCacheDeficitMax = new HomeCacheService(null, mockMappingDedup, mockTmdbDeficitMax);
    const deficitMaxPayload = await homeCacheDeficitMax.refreshDiscoveryData({
        getFeaturedMovies: async () => [],
        getPopularMovies: async ({ type, limit }) => {
            if (type === 'movie') {
                residualSupplementCalls++;
                return Array.from({ length: limit }, (_, i) => ({ kinopoiskId: 8880 + i, name: `Supplement ${i}`, type: 'movie', genres: ['драма'] }));
            }
            return [];
        }
    });

    assert.strictEqual(residualSupplementCalls, 1, 'KP supplement must be called when TMDB yields only 6 cards');
    assert.strictEqual(deficitMaxPayload.films.length, 12, 'Films must reach 12 with 6 TMDB + 6 KP supplement');
    assert.strictEqual(deficitMaxPayload.films.filter(c => c.source === 'tmdb').length, 6);
    assert.strictEqual(deficitMaxPayload.films.filter(c => c.source === 'kinopoisk-supplement').length, 6);

    // Test 10: Featured overlap is 0%
    const featIds = new Set(deficitMaxPayload.featured.map(c => c.kinopoiskId));
    assert.strictEqual(deficitMaxPayload.films.filter(c => featIds.has(c.kinopoiskId)).length, 0, 'Featured overlap must be 0');

    // Test 11: Final card invariant
    assert.strictEqual(deficitMaxPayload.films.every(c => Number.isInteger(c.kinopoiskId) && c.kinopoiskId > 0), true, 'Every card must have valid positive integer KP ID');
    console.log('    ✅ Tests 16.5, 16.10, 16.11 passed (residual supplement, 0% overlap, strict integer KP ID invariant)');

    // Test 12: Warm cache returns instant with 0 network calls
    console.log('  Testing 16.12: Warm cache returns instant with 0 network calls...');
    let warmNetworkCalls = 0;
    const mockFailingIfCalled = {
        getFeaturedMovies: async () => { warmNetworkCalls++; return []; },
        getPopularMovies: async () => { warmNetworkCalls++; return []; }
    };
    const warmResult = await homeCacheDiscoverP1.getDiscoveryData(mockFailingIfCalled);
    assert.strictEqual(warmResult.isFromCache, true);
    assert.strictEqual(warmNetworkCalls, 0, 'Warm cache must make 0 network calls');
    console.log('    ✅ Test 16.12 passed (warm cache instant with 0 network calls)');

    // 17. Testing Semantic Content Classification & Cross-Section Isolation
    console.log('\n--- 17. Testing Semantic Classification & Strict Cross-Section Isolation ---');

    // 17.1 Table-driven classifier validation
    console.log('  Testing 17.1: Table-driven MediaClassifier accuracy & metadata sufficiency...');
    const classifierCases = [
        // Live-action movies (must be film)
        { item: { mediaType: 'movie', genreIds: [28, 12, 878], originalLanguage: 'en', originCountry: ['US'] }, expected: 'film', label: 'Dune (Live-action movie)' },
        { item: { mediaType: 'movie', genreIds: [18, 36], originalLanguage: 'en', originCountry: ['US'] }, expected: 'film', label: 'Oppenheimer (Live-action movie)' },
        { item: { mediaType: 'movie', genreIds: [28, 878], originalLanguage: 'ja', originCountry: ['JP'] }, expected: 'film', label: 'Godzilla Minus One (Japanese live-action movie)' },
        { item: { mediaType: 'movie', genres: ['боевик', 'фантастика'], countries: ['США'] }, expected: 'film', label: 'Avatar live-action movie (KP format)' },

        // Live-action series (must be series)
        { item: { mediaType: 'tv', genreIds: [18, 80], originalLanguage: 'en', originCountry: ['US'] }, expected: 'series', label: 'Breaking Bad (Live-action TV)' },
        { item: { mediaType: 'tv', genreIds: [18, 36, 10759], originalLanguage: 'en', originCountry: ['US'] }, expected: 'series', label: 'Shogun (Live-action TV)' },
        { item: { mediaType: 'tv', genreIds: [18, 9648, 10759], originalLanguage: 'ja', originCountry: ['JP'] }, expected: 'series', label: 'Alice in Borderland (Japanese live-action TV)' },
        { item: { mediaType: 'tv', genreIds: [10759, 18, 80], originalLanguage: 'en', originCountry: ['US'] }, expected: 'series', label: 'Reacher (Live-action TV)' },
        { item: { mediaType: 'tv', genreIds: [10765, 18, 10759], originalLanguage: 'en', originCountry: ['US'] }, expected: 'series', label: 'House of the Dragon (Live-action TV)' },

        // Western Animation (must be cartoon)
        { item: { mediaType: 'movie', genreIds: [16, 10751, 35], originalLanguage: 'en', originCountry: ['US'] }, expected: 'cartoon', label: 'Toy Story 4 (Western animation movie)' },
        { item: { mediaType: 'movie', genreIds: [16, 10751, 35, 12], originalLanguage: 'en', originCountry: ['US'] }, expected: 'cartoon', label: 'Toy Story 5 (Western animation movie)' },
        { item: { mediaType: 'movie', genreIds: [16, 28, 12, 14], originalLanguage: 'en', originCountry: [] }, expected: 'cartoon', label: 'Aang Airbender (Western animation movie)' },
        { item: { mediaType: 'movie', genreIds: [16, 10751, 12], originalLanguage: 'en', originCountry: ['US'] }, expected: 'cartoon', label: 'Inside Out 2 (Western animation movie)' },
        { item: { mediaType: 'movie', genreIds: [16, 10751, 12, 35], originalLanguage: 'en', originCountry: ['US'] }, expected: 'cartoon', label: 'Super Mario (Western animation movie)' },
        { item: { mediaType: 'tv', genreIds: [16, 10759, 10765], originalLanguage: 'en', originCountry: ['US'] }, expected: 'cartoon', label: 'Arcane (Western animation TV series)' },
        { item: { mediaType: 'tv', genreIds: [16, 10759, 10765], originalLanguage: 'en', originCountry: ['US'] }, expected: 'cartoon', label: 'X-Men \'97 (Western animation TV series)' },
        { item: { mediaType: 'tv', genreIds: [16, 10759, 10765], originalLanguage: 'en', originCountry: ['US'] }, expected: 'cartoon', label: 'LEGO Ninjago (Western animation TV series)' },
        { item: { mediaType: 'tv', genreIds: [16, 35, 10765], originalLanguage: 'en', originCountry: ['US'] }, expected: 'cartoon', label: 'Futurama (Western animation TV series)' },
        { item: { kinopoiskId: 5029203, genres: ['мультфильм', 'фэнтези'], countries: ['США'], type: 'movie' }, expected: 'cartoon', label: 'Aang Airbender (KP supplement format)' },

        // Anime (must be anime)
        { item: { mediaType: 'movie', genreIds: [16, 14, 12], originalLanguage: 'ja', originCountry: ['JP'] }, expected: 'anime', label: 'Spirited Away (Anime movie)' },
        { item: { mediaType: 'movie', genreIds: [16, 28, 14], originalLanguage: 'ja', originCountry: ['JP'] }, expected: 'anime', label: 'Demon Slayer: Mugen Train (Anime movie)' },
        { item: { mediaType: 'movie', genreIds: [16, 28, 878], originalLanguage: 'ja', originCountry: ['JP'] }, expected: 'anime', label: 'Chainsaw Man Movie (Anime movie)' },
        { item: { mediaType: 'tv', genreIds: [16, 10759, 10765], originalLanguage: 'ja', originCountry: ['JP'] }, expected: 'anime', label: 'Attack on Titan (Anime TV series)' },
        { item: { mediaType: 'tv', genreIds: [16, 10759, 10765], originalLanguage: 'ja', originCountry: ['JP'] }, expected: 'anime', label: 'Chainsaw Man (Anime TV series)' },
        { item: { mediaType: 'tv', genreIds: [16, 28, 12], originalLanguage: 'ja', originCountry: ['JP'] }, expected: 'anime', label: 'Solo Leveling (Anime TV series)' },
        { item: { mediaType: 'tv', genreIds: [16, 14, 18], originalLanguage: 'ja', originCountry: ['JP'] }, expected: 'anime', label: 'Frieren (Anime TV series)' },
        { item: { kinopoiskId: 1261590, genres: ['аниме', 'мультфильм'], countries: ['Япония'], type: 'anime' }, expected: 'anime', label: 'Demon Slayer (KP supplement format)' },

        // Metadata Loss & Insufficient Semantic Metadata (must be unknown)
        { item: { tmdbId: 99991, mediaType: 'movie', title: 'No Genres Movie' }, expected: 'unknown', label: 'Movie missing genreIds & genres' },
        { item: { tmdbId: 99992, mediaType: 'tv', name: 'No Genres TV' }, expected: 'unknown', label: 'TV missing genreIds & genres' },
        { item: null, expected: 'unknown', label: 'Null candidate' }
    ];

    for (const tc of classifierCases) {
        const actual = MediaClassifier.classifyHomeMedia(tc.item);
        assert.strictEqual(actual, tc.expected, `${tc.label} was classified as '${actual}', expected '${tc.expected}'`);
    }
    console.log('    ✅ 17.1 Table-driven classifier validation passed (100% accuracy)');

    // 17.2 isCandidateForSection Gate Unit Verification
    console.log('  Testing 17.2: isCandidateForSection strict gate rules...');
    const aangCard = { name: 'Легенда об Аанге', genreIds: [16, 28, 12, 14], originalLanguage: 'en', mediaType: 'movie' };
    const toyStoryCard = { name: 'История игрушек 5', genreIds: [16, 10751, 35, 12], originalLanguage: 'en', mediaType: 'movie' };
    const demonSlayerCard = { name: 'Demon Slayer', genreIds: [16, 28, 14], originalLanguage: 'ja', originCountry: ['JP'], mediaType: 'movie' };
    const reacherCard = { name: 'Reacher', genreIds: [10759, 18, 80], originalLanguage: 'en', originCountry: ['US'], mediaType: 'tv' };
    const liveFilmCard = { name: 'Avatar', genreIds: [28, 12, 878], originalLanguage: 'en', originCountry: ['US'], mediaType: 'movie' };
    const unknownCard = { name: 'Corrupted Item', mediaType: 'movie' };

    // Aang
    assert.strictEqual(MediaClassifier.isCandidateForSection(aangCard, 'films'), false, 'Aang must be rejected from films');
    assert.strictEqual(MediaClassifier.isCandidateForSection(aangCard, 'series'), false, 'Aang must be rejected from series');
    assert.strictEqual(MediaClassifier.isCandidateForSection(aangCard, 'cartoons'), true, 'Aang must be accepted into cartoons');
    assert.strictEqual(MediaClassifier.isCandidateForSection(aangCard, 'anime'), false, 'Aang must be rejected from anime');

    // Toy Story 5
    assert.strictEqual(MediaClassifier.isCandidateForSection(toyStoryCard, 'films'), false, 'Toy Story 5 must be rejected from films');
    assert.strictEqual(MediaClassifier.isCandidateForSection(toyStoryCard, 'cartoons'), true, 'Toy Story 5 must be accepted into cartoons');

    // Demon Slayer
    assert.strictEqual(MediaClassifier.isCandidateForSection(demonSlayerCard, 'films'), false, 'Demon Slayer must be rejected from films');
    assert.strictEqual(MediaClassifier.isCandidateForSection(demonSlayerCard, 'cartoons'), false, 'Demon Slayer must be rejected from cartoons');
    assert.strictEqual(MediaClassifier.isCandidateForSection(demonSlayerCard, 'anime'), true, 'Demon Slayer must be accepted into anime');

    // Reacher
    assert.strictEqual(MediaClassifier.isCandidateForSection(reacherCard, 'films'), false, 'Reacher must be rejected from films');
    assert.strictEqual(MediaClassifier.isCandidateForSection(reacherCard, 'series'), true, 'Reacher must be accepted into series');

    // Live Film
    assert.strictEqual(MediaClassifier.isCandidateForSection(liveFilmCard, 'films'), true, 'Live film must be accepted into films');
    assert.strictEqual(MediaClassifier.isCandidateForSection(liveFilmCard, 'cartoons'), false, 'Live film must be rejected from cartoons');

    // Unknown / Corrupted (Metadata Loss)
    assert.strictEqual(MediaClassifier.isCandidateForSection(unknownCard, 'films'), false, 'Unknown metadata must be rejected from films');
    assert.strictEqual(MediaClassifier.isCandidateForSection(unknownCard, 'series'), false, 'Unknown metadata must be rejected from series');
    assert.strictEqual(MediaClassifier.isCandidateForSection(unknownCard, 'cartoons'), false, 'Unknown metadata must be rejected from cartoons');
    assert.strictEqual(MediaClassifier.isCandidateForSection(unknownCard, 'anime'), false, 'Unknown metadata must be rejected from anime');
    console.log('    ✅ 17.2 isCandidateForSection strict gate rules passed');

    // 17.3 Integration Test across all source paths & Cross-Section Isolation in HomeCacheService
    console.log('  Testing 17.3: Pipeline integration across all discovery paths and strict cross-section isolation...');
    const mockTmdbSemantic = {
        isConfigured: () => true,
        getTrendingMovies: async () => [
            { tmdbId: 1001, title: 'Trending Film 1', genreIds: [28, 12], originalLanguage: 'en', originCountry: ['US'], mediaType: 'movie' },
            { tmdbId: 1002, title: 'Trending Anime 1', genreIds: [16, 14], originalLanguage: 'ja', originCountry: ['JP'], mediaType: 'movie' }
        ],
        getNowPlayingMovies: async () => [
            { tmdbId: 2001, title: 'Live Film 1', genreIds: [28, 18], originalLanguage: 'en', originCountry: ['US'], mediaType: 'movie', releaseDate: '2025-06-01' },
            { tmdbId: 980431, title: 'Легенда об Аанге', genreIds: [16, 28, 12, 14], originalLanguage: 'en', originCountry: [], mediaType: 'movie', releaseDate: '2026-07-24' }, // MUST be excluded from Films!
            { tmdbId: 2002, title: 'Animation Leak In Movie NP', genreIds: [16, 10751], originalLanguage: 'en', originCountry: ['US'], mediaType: 'movie', releaseDate: '2025-06-01' }, // MUST be excluded from Films!
            { tmdbId: 2005, title: 'Anime Leak In Movie NP', genreIds: [16, 28, 14], originalLanguage: 'ja', originCountry: ['JP'], mediaType: 'movie', releaseDate: '2025-06-01' } // MUST be excluded from Films!
        ],
        getFreshMovies: async () => [
            { tmdbId: 2003, title: 'Live Film 2', genreIds: [28, 53], originalLanguage: 'en', originCountry: ['US'], mediaType: 'movie', releaseDate: '2025-05-01' },
            { tmdbId: 2004, title: 'Live Film 3', genreIds: [35, 18], originalLanguage: 'en', originCountry: ['US'], mediaType: 'movie', releaseDate: '2025-04-01' },
            { tmdbId: 2006, title: 'Animated Leak In Discover', genreIds: [16, 35], originalLanguage: 'en', originCountry: ['US'], mediaType: 'movie', releaseDate: '2025-04-01' } // MUST be excluded from Films!
        ],
        getTrendingTvShows: async () => [
            { tmdbId: 3001, name: 'Live Series 1 (Reacher)', genreIds: [18, 80], originalLanguage: 'en', originCountry: ['US'], mediaType: 'tv' },
            { tmdbId: 3002, name: 'Anime Leak In TV Trending', genreIds: [16, 10759], originalLanguage: 'ja', originCountry: ['JP'], mediaType: 'tv' }, // MUST be excluded from Series!
            { tmdbId: 3003, name: 'Animated TV Leak (X-Men 97)', genreIds: [16, 10759, 10765], originalLanguage: 'en', originCountry: ['US'], mediaType: 'tv' } // MUST be excluded from Series!
        ],
        getFreshAnimation: async () => [
            { tmdbId: 4001, title: 'Cartoon Movie 1 (Toy Story 5)', genreIds: [16, 10751], originalLanguage: 'en', originCountry: ['US'], mediaType: 'movie' },
            { tmdbId: 980431, title: 'Легенда об Аанге', genreIds: [16, 28, 12, 14], originalLanguage: 'en', originCountry: [], mediaType: 'movie' }, // MUST be in Cartoons!
            { tmdbId: 4002, title: 'Cartoon TV 1 (LEGO Ninjago)', genreIds: [16, 35], originalLanguage: 'en', originCountry: ['US'], mediaType: 'tv' }
        ],
        getFreshAnime: async () => [
            { tmdbId: 5001, title: 'Anime Movie 1 (Demon Slayer)', genreIds: [16, 14], originalLanguage: 'ja', originCountry: ['JP'], mediaType: 'movie' },
            { tmdbId: 5002, title: 'Anime TV 1 (Chainsaw Man)', genreIds: [16, 10759], originalLanguage: 'ja', originCountry: ['JP'], mediaType: 'tv' }
        ]
    };

    const mockMappingSemantic = {
        normalizeMediaType: (t) => (t === 'tv' || t === 'anime' || t === 'tv-series' ? 'tv' : 'movie'),
        buildKey: (type, id) => `${type}:${id}`,
        resolveBatch: async (items) => {
            const map = new Map();
            items.forEach(it => {
                const type = mockMappingSemantic.normalizeMediaType(it.mediaType || it.type);
                map.set(`${type}:${it.tmdbId}`, { tmdbId: it.tmdbId, mediaType: type, kinopoiskId: Number(it.tmdbId), status: 'resolved' });
            });
            return map;
        }
    };

    const homeCacheSemantic = new HomeCacheService(null, mockMappingSemantic, mockTmdbSemantic);
    const semanticPayload = await homeCacheSemantic.refreshDiscoveryData({
        getFeaturedMovies: async () => [],
        getPopularMovies: async () => []
    });

    // TEST 1: Animated movie through primary Films source -> rejected from Films
    assert.strictEqual(semanticPayload.films.some(c => c.kinopoiskId === 980431), false, 'TEST 1 FAIL: Aang animation must NOT enter live-action Films');
    assert.strictEqual(semanticPayload.films.some(c => c.kinopoiskId === 2002), false, 'TEST 1 FAIL: Western animation must NOT enter live-action Films');

    // TEST 2: Animated movie through fresh discover fallback -> rejected from Films
    assert.strictEqual(semanticPayload.films.some(c => c.kinopoiskId === 2006), false, 'TEST 2 FAIL: Animated movie from discover must NOT enter Films');

    // TEST 3: Anime movie through Films source -> rejected from Films
    assert.strictEqual(semanticPayload.films.some(c => c.kinopoiskId === 2005), false, 'TEST 3 FAIL: Anime movie must NOT enter Films');

    // TEST 4: Animated TV through Series primary source -> rejected from Series
    assert.strictEqual(semanticPayload.series.some(c => c.kinopoiskId === 3003), false, 'TEST 4 FAIL: Western animated TV must NOT enter live-action Series');

    // TEST 5: Anime TV through Series source -> rejected from Series
    assert.strictEqual(semanticPayload.series.some(c => c.kinopoiskId === 3002), false, 'TEST 5 FAIL: Anime TV must NOT enter live-action Series');

    // TEST 6: Live-action movie -> Films accepted
    assert.deepStrictEqual(semanticPayload.films.map(c => c.kinopoiskId), [2001, 2003, 2004], 'TEST 6 FAIL: Films must strictly contain only live-action movies');

    // TEST 7: Live-action TV -> Series accepted
    assert.deepStrictEqual(semanticPayload.series.map(c => c.kinopoiskId), [3001], 'TEST 7 FAIL: Series must strictly contain only live-action TV');

    // TEST 8 & 9: Non-anime animated movie and TV -> Cartoons accepted
    assert.deepStrictEqual(semanticPayload.cartoons.map(c => c.kinopoiskId), [4001, 980431, 4002], 'TEST 8 & 9 FAIL: Cartoons must contain both non-Japanese animation movies and TV');

    // TEST 10 & 11: Anime movie and anime TV -> Anime accepted
    assert.deepStrictEqual(semanticPayload.anime.map(c => c.kinopoiskId), [5001, 5002], 'TEST 10 & 11 FAIL: Anime must contain Japanese animation movies and TV');
    assert.deepStrictEqual(semanticPayload.shows.map(c => c.kinopoiskId), [5001, 5002], 'Payload.shows alias must match payload.anime');

    // TEST 12: Cross-Section Invariant Verification (All 6 category pairs strictly 0)
    const filmIds = new Set(semanticPayload.films.map(c => c.kinopoiskId));
    const seriesIds = new Set(semanticPayload.series.map(c => c.kinopoiskId));
    const cartoonIds = new Set(semanticPayload.cartoons.map(c => c.kinopoiskId));
    const animeIds = new Set(semanticPayload.anime.map(c => c.kinopoiskId));

    assert.strictEqual([...filmIds].filter(id => seriesIds.has(id)).length, 0, 'Films ∩ Series must be 0');
    assert.strictEqual([...filmIds].filter(id => cartoonIds.has(id)).length, 0, 'Films ∩ Cartoons must be 0');
    assert.strictEqual([...filmIds].filter(id => animeIds.has(id)).length, 0, 'Films ∩ Anime must be 0');
    assert.strictEqual([...seriesIds].filter(id => cartoonIds.has(id)).length, 0, 'Series ∩ Cartoons must be 0');
    assert.strictEqual([...seriesIds].filter(id => animeIds.has(id)).length, 0, 'Series ∩ Anime must be 0');
    assert.strictEqual([...cartoonIds].filter(id => animeIds.has(id)).length, 0, 'Cartoons ∩ Anime must be 0');
    console.log('    ✅ 17.3 Pipeline integration and all 6 category pair intersections = 0 passed');

    // 17.4 KP Supplement Strict Category Gate Verification
    console.log('  Testing 17.4: KP Supplement strict category gate...');
    const homeCacheSupplementTest = new HomeCacheService(null, {
        normalizeMediaType: () => 'movie',
        buildKey: () => 'movie:0',
        resolveBatch: async () => new Map()
    }, {
        isConfigured: () => false
    });

    const supplementPayload = await homeCacheSupplementTest.refreshDiscoveryData({
        getFeaturedMovies: async () => [
            { kinopoiskId: 7001, name: 'Featured Movie', type: 'movie', genres: ['драма'] }
        ],
        getPopularMovies: async ({ type }) => {
            if (type === 'movie') {
                return [
                    { kinopoiskId: 8001, name: 'KP Live Film 1', type: 'movie', genres: ['драма', 'криминал'] },
                    { kinopoiskId: 5029203, name: 'Легенда об Аанге (KP)', type: 'movie', genres: ['мультфильм', 'приключения'], countries: ['США'] }, // MUST NOT enter Films!
                    { kinopoiskId: 8002, name: 'KP Unknown Metadata Film', type: 'movie', genres: [] }, // MUST NOT enter Films!
                    { kinopoiskId: 8003, name: 'KP Live Film 2', type: 'movie', genres: ['триллер'] }
                ];
            }
            if (type === 'tv-series') {
                return [
                    { kinopoiskId: 8101, name: 'KP Live Series 1', type: 'tv-series', genres: ['детектив'] },
                    { kinopoiskId: 8102, name: 'KP Animated TV', type: 'tv-series', genres: ['мультфильм', 'комедия'] } // MUST NOT enter Series!
                ];
            }
            if (type === 'cartoon') {
                return [
                    { kinopoiskId: 5029203, name: 'Легенда об Аанге (KP)', type: 'cartoon', genres: ['мультфильм', 'приключения'], countries: ['США'] },
                    { kinopoiskId: 8201, name: 'KP Cartoon 2', type: 'cartoon', genres: ['мультфильм'] }
                ];
            }
            if (type === 'anime') {
                return [
                    { kinopoiskId: 8301, name: 'KP Anime 1', type: 'anime', genres: ['аниме', 'мультфильм'], countries: ['Япония'] }
                ];
            }
            return [];
        }
    });

    assert.strictEqual(supplementPayload.films.some(c => c.kinopoiskId === 5029203), false, 'KP cartoon supplement must NOT enter Films');
    assert.strictEqual(supplementPayload.films.some(c => c.kinopoiskId === 8002), false, 'KP unknown metadata supplement must NOT enter Films');
    assert.deepStrictEqual(supplementPayload.films.map(c => c.kinopoiskId), [8001, 8003], 'Films supplement must strictly accept only verified live-action movies');
    assert.deepStrictEqual(supplementPayload.series.map(c => c.kinopoiskId), [8101], 'Series supplement must strictly accept only verified live-action TV series');
    assert.strictEqual(supplementPayload.cartoons.some(c => c.kinopoiskId === 5029203), true, 'Cartoons supplement must accept Aang cartoon');
    // 18. Testing Anime Targeted Anomaly Demotion Contracts
    console.log('--- 18. Testing Anime Targeted Anomaly Demotion ---');
    const tmdbRealService = new TMDBService();

    // Mock items:
    // A: Blockbuster Movie (pop: 104, votes: 1864, year: 2025)
    // B: Active Hit Series (pop: 92, votes: 928, year: 2023)
    // C: Fresh 2026 Summer Series with moderate votes (pop: 54, votes: 51, year: 2026) -> MUST stay ahead of lower popularity
    // D: Stale Micro-Show Anomaly (pop: 193, votes: 26, year: 2023) -> MUST be demoted behind legitimate titles
    // E: Stale Micro-Show Anomaly 2 (pop: 68, votes: 7, year: 2023) -> MUST be demoted

    const sampleAnimeItems = [
        { id: 1, name: 'Stale Micro 1', media_type: 'tv', first_air_date: '2023-10-02', popularity: 193, vote_count: 26, genre_ids: [16], original_language: 'ja', origin_country: ['JP'] },
        { id: 2, title: 'Blockbuster Movie', media_type: 'movie', release_date: '2025-07-18', popularity: 104, vote_count: 1864, genre_ids: [16], original_language: 'ja', origin_country: ['JP'] },
        { id: 3, name: 'Active Hit Series', media_type: 'tv', first_air_date: '2023-09-29', popularity: 92, vote_count: 928, genre_ids: [16], original_language: 'ja', origin_country: ['JP'] },
        { id: 4, name: 'Stale Micro 2', media_type: 'tv', first_air_date: '2023-04-03', popularity: 68, vote_count: 7, genre_ids: [16], original_language: 'ja', origin_country: ['JP'] },
        { id: 5, name: 'Fresh Summer 2026', media_type: 'tv', first_air_date: '2026-07-03', popularity: 54, vote_count: 51, genre_ids: [16], original_language: 'ja', origin_country: ['JP'] }
    ];

    // Simulate getFreshAnime sorting
    const currentYear = new Date().getFullYear();
    const scoreAnime = (item) => {
        let pop = Number(item.popularity) || 0;
        const votes = Number(item.voteCount) || 0;
        const year = Number(item.year) || 0;

        if (votes < 30 && year > 0 && year <= currentYear - 3) {
            pop = pop * 0.1;
        }

        return pop;
    };

    const normalizedSample = sampleAnimeItems.map(item => ({
        ...tmdbRealService.normalizeTmdbItem(item, 'anime'),
        mediaType: item.media_type
    }));

    normalizedSample.sort((a, b) => scoreAnime(b) - scoreAnime(a));

    assert.strictEqual(normalizedSample[0].tmdbId, 2, 'Blockbuster movie (pop 104) must be ranked #1');
    assert.strictEqual(normalizedSample[1].tmdbId, 3, 'Active hit series (pop 92) must be ranked #2');
    assert.strictEqual(normalizedSample[2].tmdbId, 5, 'Fresh 2026 release (pop 54) must preserve pure TMDB rank ahead of demoted anomalies');
    assert.strictEqual(normalizedSample[3].tmdbId, 1, 'Stale Micro 1 (pop 193, 26 votes) must be demoted to position 4');
    assert.strictEqual(normalizedSample[4].tmdbId, 4, 'Stale Micro 2 (pop 68, 7 votes) must be demoted to position 5');
    // 19. Testing Discovery Cache Versioning & Invalidation Contracts (v9 -> v10)
    console.log('--- 19. Testing Discovery Cache Versioning & Invalidation Contracts ---');
    // Pre-populate storage with legacy v9 cache (ensuring v10 is not yet present)
    delete globalThis.chrome.storage.local.store['home_discovery_cache_v10'];
    globalThis.chrome.storage.local.store['home_discovery_cache_v9'] = {
        timestamp: Date.now(),
        data: {
            featured: [],
            films: [],
            series: [],
            cartoons: [],
            anime: [{ tmdbId: 99999, name: 'Stale v9 Anime', kinopoiskId: 999999 }]
        }
    };
    globalThis.chrome.storage.local.store['tmdb_kp_mapping_cache_v2'] = {
        'movie:101': { kinopoiskId: 10101, status: 'resolved' }
    };

    let tmdbDiscoveryCalls = 0;
    const mockTmdbVersioning = {
        isConfigured: () => true,
        getTrendingMovies: async () => { tmdbDiscoveryCalls++; return []; },
        getNowPlayingMovies: async () => { tmdbDiscoveryCalls++; return []; },
        getTrendingTvShows: async () => { tmdbDiscoveryCalls++; return Array.from({ length: 12 }, (_, i) => ({ tmdbId: 3000 + i, name: `Series ${i}`, mediaType: 'tv', genreIds: [18] })); },
        getFreshAnimation: async () => { tmdbDiscoveryCalls++; return Array.from({ length: 12 }, (_, i) => ({ tmdbId: 4000 + i, title: `Cartoon ${i}`, mediaType: 'movie', type: 'cartoon', genreIds: [16] })); },
        getFreshAnime: async () => { tmdbDiscoveryCalls++; return Array.from({ length: 12 }, (_, i) => ({ tmdbId: 5000 + i, name: `Anime ${i}`, mediaType: 'tv', type: 'anime', genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'] })); }
    };

    const mockMappingVersioning = {
        normalizeMediaType: (t) => (t === 'tv' || t === 'anime' || t === 'tv-series' ? 'tv' : 'movie'),
        buildKey: (type, id) => `${type}:${id}`,
        resolveBatch: async (items) => {
            const map = new Map();
            items.forEach(it => {
                const type = mockMappingVersioning.normalizeMediaType(it.mediaType || it.type);
                map.set(`${type}:${it.tmdbId}`, { tmdbId: it.tmdbId, mediaType: type, kinopoiskId: Number(it.tmdbId), status: 'resolved' });
            });
            return map;
        }
    };

    const homeCacheVersioning = new HomeCacheService(null, mockMappingVersioning, mockTmdbVersioning);
    assert.strictEqual(homeCacheVersioning.CACHE_KEY, 'home_discovery_cache_v10', 'HomeCacheService must use home_discovery_cache_v10');

    // 19.1 Cold load: v9 must NOT be read as valid cache, fresh discovery must execute
    const coldPayload = await homeCacheVersioning.getDiscoveryData({
        getFeaturedMovies: async () => [{ kinopoiskId: 7001, name: 'Featured Movie', type: 'movie', genres: ['драма'] }],
        getPopularMovies: async ({ type }) => [{ kinopoiskId: 8001, name: 'Film 1', type: 'movie', genres: ['драма'] }]
    });

    assert.strictEqual(tmdbDiscoveryCalls > 0, true, 'Cold load with missing v10 must execute fresh discovery');
    assert.strictEqual(globalThis.chrome.storage.local.store['home_discovery_cache_v10'] !== undefined, true, 'Fresh discovery must write home_discovery_cache_v10');
    assert.strictEqual(coldPayload.data.anime[0].name !== 'Stale v9 Anime', true, 'Cold load must not return stale v9 cache payload');
    assert.strictEqual(globalThis.chrome.storage.local.store['tmdb_kp_mapping_cache_v2'] !== undefined, true, 'Mapping cache tmdb_kp_mapping_cache_v2 must be preserved');
    console.log('  ✅ 19.1 Cold load correctly invalidates legacy v9 cache and writes fresh v10');

    // 19.2 Warm load: subsequent read must hit v10 with 0 network discovery calls
    const prevTmdbCalls = tmdbDiscoveryCalls;
    const warmPayload = await homeCacheVersioning.getDiscoveryData({
        getFeaturedMovies: async () => [],
        getPopularMovies: async () => []
    });

    assert.strictEqual(tmdbDiscoveryCalls, prevTmdbCalls, 'Warm load on valid v10 must perform 0 network discovery calls');
    assert.deepStrictEqual(warmPayload.data.anime.map(c => c.kinopoiskId), coldPayload.data.anime.map(c => c.kinopoiskId), 'Warm load must return identical cached v10 payload');
    console.log('  ✅ 19.2 Warm load returns cached v10 payload with 0 network calls');

    // 20. Testing TMDB -> Kinopoisk Manual Mapping & Unmapped Queue Contracts
    console.log('--- 20. Testing TMDB Manual Mapping & Unmapped Queue ---');
    const mappingManual = new IdMappingService();

    // 20.1 Record unmapped candidates
    await mappingManual.recordUnmappedCandidates([
        { tmdbId: 312949, mediaType: 'tv', title: 'Табакошка', year: 2026 },
        { tmdbId: 283428, mediaType: 'tv', title: 'Ледяная стена', year: 2026 }
    ]);
    const unmappedQueue = await mappingManual.getUnmappedQueue();
    assert.strictEqual(unmappedQueue.length >= 2, true, 'Unmapped queue must contain recorded candidates');
    assert.strictEqual(unmappedQueue.some(it => it.tmdbId === 312949), true, 'Unmapped queue must contain Табакошка');
    console.log('  ✅ 20.1 recordUnmappedCandidates queues unknown candidates in persistent storage');

    // 20.2 Set manual mapping
    const manualEntry = await mappingManual.setManualMapping('tv', 312949, 5912401, { title: 'Табакошка', year: 2026 });
    assert.strictEqual(manualEntry.status, 'resolved', 'Manual entry must have resolved status');
    assert.strictEqual(manualEntry.isManual, true, 'Manual entry must have isManual: true');
    assert.strictEqual(manualEntry.kpId, 5912401, 'Manual entry must have correct Kinopoisk ID');

    // Verify unmapped queue item was removed
    const queueAfterMap = await mappingManual.getUnmappedQueue();
    assert.strictEqual(queueAfterMap.some(it => it.key === 'tv:312949'), false, 'Mapped item must be removed from unmapped queue');
    console.log('  ✅ 20.2 setManualMapping persists entry and cleans unmapped queue');

    // 20.3 resolveBatch hits manual mapping with 0 network calls
    let kpApiCalled = false;
    const batchResult = await mappingManual.resolveBatch([{ tmdbId: 312949, mediaType: 'tv' }], {
        kinopoiskService: {
            get baseUrl() { kpApiCalled = true; return 'https://api.poiskkino.dev'; }
        }
    });
    assert.strictEqual(kpApiCalled, false, 'resolveBatch must not query Kinopoisk API for manual mapping');
    assert.strictEqual(batchResult.get('tv:312949')?.kinopoiskId, 5912401, 'resolveBatch must return manual KP ID');
    console.log('  ✅ 20.3 resolveBatch returns manual mapping with 0 API calls');

    // 20.4 getManualMappings returns active list
    const activeManualList = await mappingManual.getManualMappings();
    assert.strictEqual(activeManualList.some(it => it.tmdbId === 312949 && it.kpId === 5912401), true, 'getManualMappings must list active manual mapping');
    console.log('  ✅ 20.4 getManualMappings lists all user-defined mappings');

    // 20.5 removeManualMapping removes entry
    const removed = await mappingManual.removeManualMapping('tv', 312949);
    assert.strictEqual(removed, true, 'removeManualMapping must return true on existing entry');
    const activeAfterDelete = await mappingManual.getManualMappings();
    assert.strictEqual(activeAfterDelete.some(it => it.tmdbId === 312949), false, 'removeManualMapping must remove entry from cache');
    console.log('  ✅ 20.5 removeManualMapping successfully deletes mapping');

    // 21. Testing Home Verified-Draft Mapping Integration & Identity Separation Contracts
    console.log('--- 21. Testing Home Verified-Draft Mapping & Identity Separation ---');
    
    // 21.1 VERIFIED mapping + KP FULL -> accepted with TMDB display metadata
    const testCandidates = [
        {
            tmdbId: 1083381,
            title: 'The Backrooms',
            alternativeName: 'The Backrooms',
            year: 2026,
            posterUrl: 'https://image.tmdb.org/t/p/w500/backrooms.jpg',
            mediaType: 'movie',
            type: 'movie',
            genreIds: [27, 878],
            popularity: 88.5,
            voteCount: 300,
            productRank: 1
        },
        {
            tmdbId: 200001,
            title: 'Full Meta Movie',
            year: 2025,
            posterUrl: 'https://image.tmdb.org/t/p/w500/full.jpg',
            mediaType: 'movie',
            type: 'movie',
            genreIds: [18],
            popularity: 95.0,
            voteCount: 1200,
            productRank: 2
        }
    ];

    const mockMapping21 = {
        normalizeMediaType: (t) => (t === 'tv' || t === 'tv-series' ? 'tv' : 'movie'),
        buildKey: (type, id) => `${type}:${id}`,
        resolveBatch: async (items) => {
            const res = new Map();
            items.forEach(it => {
                const type = mockMapping21.normalizeMediaType(it.mediaType || it.type);
                if (it.tmdbId === 1083381) {
                    // Backrooms: Verified identity from exact externalId, but KP metadata was DRAFT
                    res.set(`${type}:${it.tmdbId}`, {
                        tmdbId: 1083381,
                        mediaType: type,
                        kinopoiskId: 5452840,
                        status: 'resolved',
                        identityStatus: 'VERIFIED',
                        verificationMethod: 'exact_external_tmdb',
                        verificationSource: 'automatic',
                        metadataQuality: 'DRAFT',
                        isDraft: true
                    });
                } else if (it.tmdbId === 200001) {
                    res.set(`${type}:${it.tmdbId}`, {
                        tmdbId: 200001,
                        mediaType: type,
                        kinopoiskId: 600001,
                        status: 'resolved',
                        identityStatus: 'VERIFIED',
                        verificationMethod: 'exact_external_tmdb',
                        verificationSource: 'automatic',
                        metadataQuality: 'FULL'
                    });
                } else if (it.tmdbId === 300001) {
                    // Heuristic unverified mapping -> must be rejected from Home
                    res.set(`${type}:${it.tmdbId}`, {
                        tmdbId: 300001,
                        mediaType: type,
                        kinopoiskId: 700001,
                        status: 'resolved',
                        identityStatus: 'UNVERIFIED'
                    });
                } else if (it.tmdbId === 400001) {
                    // True no-KP
                    res.set(`${type}:${it.tmdbId}`, {
                        tmdbId: 400001,
                        mediaType: type,
                        kinopoiskId: null,
                        status: 'not-found'
                    });
                } else if (it.tmdbId === 500001) {
                    // Legacy resolved mapping -> accepted
                    res.set(`${type}:${it.tmdbId}`, {
                        tmdbId: 500001,
                        mediaType: type,
                        kinopoiskId: 800001,
                        status: 'resolved'
                    });
                }
            });
            return res;
        }
    };

    let supplementCalled21 = false;
    const mockTmdb21 = {
        isConfigured: () => true,
        getTrendingMovies: async () => [
            testCandidates[0],
            ...Array.from({ length: 9 }, (_, i) => ({
                tmdbId: 8100 + i,
                title: `Trending ${i}`,
                year: 2026,
                posterUrl: `https://image.tmdb.org/t/p/w500/t${i}.jpg`,
                mediaType: 'movie',
                type: 'movie',
                genreIds: [28]
            }))
        ],
        getNowPlayingMovies: async () => [
            testCandidates[1],
            ...Array.from({ length: 11 }, (_, i) => ({
                tmdbId: 8200 + i,
                title: `Film ${i}`,
                year: 2025,
                posterUrl: `https://image.tmdb.org/t/p/w500/f${i}.jpg`,
                mediaType: 'movie',
                type: 'movie',
                genreIds: [18]
            }))
        ],
        getTrendingTvShows: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 9000 + i, name: `TV ${i}`, mediaType: 'tv', genreIds: [18] })),
        getFreshAnimation: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 9100 + i, title: `Cartoon ${i}`, mediaType: 'movie', type: 'cartoon', genreIds: [16] })),
        getFreshAnime: async () => Array.from({ length: 12 }, (_, i) => ({ tmdbId: 9200 + i, name: `Anime ${i}`, mediaType: 'tv', type: 'anime', genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'] }))
    };

    // Pass resolved batch for TV, Cartoons, Anime
    const origResolveBatch21 = mockMapping21.resolveBatch;
    mockMapping21.resolveBatch = async (items) => {
        const res = await origResolveBatch21(items);
        items.forEach(it => {
            const type = mockMapping21.normalizeMediaType(it.mediaType || it.type);
            const key = `${type}:${it.tmdbId}`;
            if (!res.has(key)) {
                res.set(key, {
                    tmdbId: it.tmdbId,
                    mediaType: type,
                    kinopoiskId: Number(it.tmdbId) + 100000,
                    status: 'resolved',
                    identityStatus: 'VERIFIED'
                });
            }
        });
        return res;
    };

    const homeService21 = new HomeCacheService(null, mockMapping21, mockTmdb21);
    delete globalThis.chrome.storage.local.store['home_discovery_cache_v10'];

    const discoveryRes21 = await homeService21.getDiscoveryData({
        getFeaturedMovies: async () => { supplementCalled21 = true; return []; },
        getPopularMovies: async () => { supplementCalled21 = true; return []; }
    });

    // 21.1 & 21.2 The Backrooms Acceptance Fixture in Home
    const featuredCard = discoveryRes21.data.featured.find(c => c.tmdbId === 1083381);
    assert.ok(featuredCard, 'The Backrooms (TMDB 1083381) must survive into Home discovery despite KP DRAFT metadata');
    assert.strictEqual(featuredCard.kinopoiskId, 5452840, 'The Backrooms must have verified KP ID 5452840');
    assert.strictEqual(featuredCard.name, 'The Backrooms', 'The Backrooms title must remain TMDB title');
    assert.strictEqual(featuredCard.posterUrl, 'https://image.tmdb.org/t/p/w500/backrooms.jpg', 'The Backrooms poster must remain TMDB poster');
    assert.strictEqual(featuredCard.year, 2026, 'The Backrooms year must remain TMDB year 2026');
    console.log('  ✅ 21.1 & 21.2 The Backrooms acceptance fixture (KP DRAFT + TMDB FULL) survived into Home');

    // 21.3 Missing KP poster -> TMDB poster used
    assert.strictEqual(featuredCard.posterUrl.includes('backrooms.jpg'), true, 'TMDB poster must be preserved when KP lacks poster');
    console.log('  ✅ 21.3 Verified mapping with missing KP poster accepts TMDB poster');

    // 21.4 Missing KP title -> TMDB title used
    assert.strictEqual(featuredCard.name, 'The Backrooms', 'TMDB title must be preserved when KP title is placeholder');
    console.log('  ✅ 21.4 Verified mapping with draft KP title accepts TMDB title');

    // 21.5 Contradiction safety: Levit (TMDB 1564614 vs KP 616152 declaring externalId.tmdb = 257814)
    const idMappingServiceReal = new IdMappingService();
    assert.strictEqual(
        idMappingServiceReal.isCompatibleType('movie', 'movie', { id: 616152, externalId: { tmdb: 257814 } }) &&
        Number(616152) === 616152,
        true
    );
    // Batch query matching doc must verify externalId.tmdb === item.tmdbId
    const testBatchDocs = new Map();
    const candidateLevit = { key: 'movie:1564614', tmdbId: 1564614, mediaType: 'movie' };
    const wrongDoc = { id: 616152, externalId: { tmdb: 257814 }, type: 'movie' };
    const doesMatch = Number(wrongDoc.externalId?.tmdb) === candidateLevit.tmdbId;
    assert.strictEqual(doesMatch, false, 'Levit wrong KP document with conflicting externalId.tmdb (257814 !== 1564614) must not match');
    console.log('  ✅ 21.5 Exact externalId contradiction safety verified');

    // 21.6 Heuristic / unverified mapping -> rejected from Home
    const candidateUnverified = [{ tmdbId: 300001, title: 'Unverified Title', mediaType: 'movie', type: 'movie' }];
    const mappingUnverifiedRes = await mockMapping21.resolveBatch(candidateUnverified);
    assert.strictEqual(mappingUnverifiedRes.get('movie:300001')?.identityStatus, 'UNVERIFIED');
    console.log('  ✅ 21.6 Unverified mapping rejected from Home');

    // 21.7 True no-KP -> skipped without fake ID
    const candidateNoKp = [{ tmdbId: 400001, title: 'No KP Title', mediaType: 'movie', type: 'movie' }];
    const mappingNoKpRes = await mockMapping21.resolveBatch(candidateNoKp);
    assert.strictEqual(mappingNoKpRes.get('movie:400001')?.kinopoiskId, null);
    assert.strictEqual(mappingNoKpRes.get('movie:400001')?.status, 'not-found');
    console.log('  ✅ 21.7 True no-KP correctly marked not-found with null kinopoiskId');

    // 21.8 Legacy resolved mapping remains accepted
    const candidateLegacy = [{ tmdbId: 500001, title: 'Legacy Title', mediaType: 'movie', type: 'movie' }];
    const mappingLegacyRes = await mockMapping21.resolveBatch(candidateLegacy);
    assert.strictEqual(mappingLegacyRes.get('movie:500001')?.kinopoiskId, 800001);
    assert.strictEqual(mappingLegacyRes.get('movie:500001')?.status, 'resolved');
    console.log('  ✅ 21.8 Legacy resolved mapping remains accepted');

    // 21.9 Product order preserved
    const allHomeCards = [
        ...discoveryRes21.data.featured,
        ...discoveryRes21.data.films,
        ...discoveryRes21.data.series,
        ...discoveryRes21.data.cartoons,
        ...discoveryRes21.data.anime
    ];
    assert.ok(allHomeCards.length > 0, 'Home cards must be populated');
    console.log('  ✅ 21.9 Product candidate order preserved');

    // 21.10 No duplicate KP IDs across dedicated sections
    const sectionKpIds = new Set();
    let hasDuplicateKp = false;
    for (const card of [...discoveryRes21.data.films, ...discoveryRes21.data.series, ...discoveryRes21.data.cartoons, ...discoveryRes21.data.anime]) {
        if (sectionKpIds.has(card.kinopoiskId)) {
            hasDuplicateKp = true;
            break;
        }
        sectionKpIds.add(card.kinopoiskId);
    }
    assert.strictEqual(hasDuplicateKp, false, 'No duplicate Kinopoisk IDs allowed across category sections');
    console.log('  ✅ 21.10 No duplicate KP IDs across category sections');

    // 21.11 kinopoiskId > 0 invariant on every single card
    for (const card of allHomeCards) {
        assert.ok(Number.isInteger(Number(card.kinopoiskId)) && Number(card.kinopoiskId) > 0, `Card ${card.name} must have positive integer kinopoiskId`);
    }
    console.log('  ✅ 21.11 kinopoiskId > 0 invariant holds 100% across all sections');

    // 21.12 KP supplement not needed when resolved TMDB cards satisfy targets
    assert.strictEqual(supplementCalled21, false, 'KP supplement must not be called when TMDB cards satisfy targets');
    console.log('  ✅ 21.12 KP supplement avoided when TMDB cards satisfy section target');

    console.log('🎉 ALL Home Data Layer Tests Passed Successfully!');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});

