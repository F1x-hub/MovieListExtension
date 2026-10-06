/**
 * Regression coverage for the third Home page audit. Unlike the earlier Home
 * tests, discovery here runs through the real MediaClassifier, so section
 * classification mistakes cannot hide behind a stubbed gate.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

function createStorage(initial = {}) {
    const store = { ...initial };
    return {
        store,
        get(keys, callback) {
            const result = {};
            for (const key of Array.isArray(keys) ? keys : [keys]) {
                if (store[key] !== undefined) result[key] = store[key];
            }
            callback?.(result);
            return Promise.resolve(result);
        },
        set(values, callback) {
            Object.assign(store, values);
            callback?.();
            return Promise.resolve();
        },
        remove(keys, callback) {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
            callback?.();
            return Promise.resolve();
        }
    };
}

function loadClassicScript(relativePath, className, sandbox) {
    const context = vm.createContext(sandbox);
    vm.runInContext(`${read(relativePath)}\n;globalThis.__exported = ${className};`, context);
    return context.__exported;
}

// TMDB-shaped normalized items (as TMDBService.normalizeTmdbItem returns).
const tmdbItem = (id, overrides = {}) => ({
    tmdbId: id,
    name: `Title ${id}`,
    alternativeName: `Original ${id}`,
    posterUrl: `https://image.tmdb.org/t/p/w342/${id}.jpg`,
    year: 2026,
    releaseDate: '2026-01-01',
    voteCount: 500,
    genreIds: [18],
    originalLanguage: 'en',
    originCountry: ['US'],
    mediaType: 'movie',
    type: 'movie',
    ...overrides
});

async function run() {
    global.chrome = { storage: { local: createStorage() } };
    const MediaClassifier = require('../src/shared/utils/MediaClassifier.js');
    global.MediaClassifier = MediaClassifier;
    const HomeCacheService = require('../src/shared/services/HomeCacheService.js');

    const languagesSeen = [];
    const trendingTv = [
        tmdbItem(1, { name: 'East of Eden', mediaType: 'tv', type: 'tv-series', genreIds: [18] }),
        tmdbItem(2, { name: 'South Park', mediaType: 'tv', type: 'tv-series', genreIds: [35, 16] }),
        tmdbItem(3, { name: 'One Piece', mediaType: 'tv', type: 'tv-series', genreIds: [16, 10759], originalLanguage: 'ja', originCountry: ['JP'] }),
        ...Array.from({ length: 14 }, (_, index) => tmdbItem(100 + index, { mediaType: 'tv', type: 'tv-series' }))
    ];
    const fakeTmdb = {
        defaultLanguage: 'ru-RU',
        isConfigured: () => true,
        getTrendingMovies(window, page) {
            if (page === 1) languagesSeen.push(this.defaultLanguage);
            return Promise.resolve(page === 1 ? Array.from({ length: 10 }, (_, index) => tmdbItem(200 + index)) : []);
        },
        getNowPlayingMovies: async page => page === 1 ? Array.from({ length: 12 }, (_, index) => tmdbItem(300 + index)) : [],
        getTrendingTvShows: async page => page === 1 ? trendingTv : [],
        getFreshAnimation: async page => page === 1
            ? Array.from({ length: 12 }, (_, index) => tmdbItem(400 + index, { genreIds: [16], type: 'cartoon' }))
            : [],
        getFreshAnime: async page => page === 1
            ? Array.from({ length: 12 }, (_, index) => tmdbItem(500 + index, { genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'], mediaType: 'tv', type: 'anime' }))
            : [],
        getFreshMovies: async () => [],
        getAiringAnime: async () => [
            tmdbItem(600, { name: 'Airing sequel', genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'], mediaType: 'tv', type: 'anime', voteCount: 900, airingStatus: 'airing', seasonNumber: 3 }),
            tmdbItem(601, { name: 'New this season', genreIds: [16], originalLanguage: 'ja', originCountry: ['JP'], mediaType: 'tv', type: 'anime', voteCount: 4, airingStatus: 'new' })
        ]
    };

    const home = new HomeCacheService(null, {}, fakeTmdb);
    const ru = await home.getDiscoveryData(null, { tmdbOnly: true, locale: 'ru' });
    const animeIds = ru.data.anime.map(card => card.tmdbId);
    assert.ok(!animeIds.includes(1), 'live-action trending series never enter Anime');
    assert.ok(!animeIds.includes(2), 'Western animated series never enter Anime');
    assert.deepEqual(animeIds.slice(0, 2), [600, 601], 'anime coming out now leads the section');
    assert.ok(!animeIds.includes(3), 'trending long-runners are not taken from trending TV');
    assert.equal(ru.data.anime[0].seasonNumber, 3);
    assert.equal(ru.data.anime[1].airingStatus, 'new', 'new series bypass the 30-vote floor');
    assert.ok(ru.data.anime.every(card => card.type === 'anime'));
    assert.ok(ru.data.series.some(card => card.tmdbId === 1), 'live-action trending series stay in Series');
    assert.ok(!ru.data.series.some(card => card.tmdbId === 2 || card.tmdbId === 3), 'animated series stay out of Series');
    assert.ok(ru.data.cartoons.every(card => card.type === 'cartoon'));
    assert.ok(chrome.storage.local.store.home_discovery_cache_v14, 'Russian keeps the base cache key');
    assert.deepEqual(languagesSeen, ['ru-RU']);

    // English interface requests English TMDB titles into its own cache and
    // leaves the shared TMDB client untouched.
    await home.getDiscoveryData(null, { tmdbOnly: true, locale: 'en' });
    assert.deepEqual(languagesSeen, ['ru-RU', 'en-US']);
    assert.equal(fakeTmdb.defaultLanguage, 'ru-RU');
    assert.ok(chrome.storage.local.store['home_discovery_cache_v14_en-US']);

    // Community picks are cached for every user of the browser.
    let poolReads = 0;
    const sandbox = {
        console,
        chrome: { storage: { local: createStorage() } },
        window: {},
        JSON
    };
    sandbox.window = sandbox;
    const HomeDataController = loadClassicScript('src/pages/home/HomeDataController.js', 'HomeDataController', sandbox);
    const controller = new HomeDataController({
        getMovieCacheService: () => ({
            getMoviesByAvgRating: async () => { poolReads++; return { movies: [{ id: 'a', avgRating: 9, ratingsCount: 30, lastRatingUpdatedAt: { seconds: 1, nanoseconds: 0 } }] }; },
            getMostRatedMovies: async () => { poolReads++; return [{ id: 'b', avgRating: 8, ratingsCount: 90 }]; }
        }),
        getHomeCacheService: () => ({}),
        getKinopoiskService: () => ({})
    });
    const first = await controller.getCommunityTop();
    const second = await controller.getCommunityTop();
    assert.equal(poolReads, 2, 'both pools are read once, then served from cache');
    assert.deepEqual(Array.from(first, movie => movie.id), ['a', 'b']);
    assert.deepEqual(Array.from(second, movie => movie.id), ['a', 'b']);
    sandbox.chrome.storage.local.store.home_community_top_v1.timestamp = 0;
    await controller.getCommunityTop();
    assert.equal(poolReads, 4, 'expired community cache is refreshed');

    // MovieCard: English mode never shows CJK original titles.
    const movieCard = read('src/shared/components/MovieCard.js');
    assert.match(movieCard, /const englishTitle = isEnglish && !movie\.isTmdbOnly/);
    assert.match(movieCard, /\\u3040-\\u30ff\\u3400-\\u9fff\\uac00-\\ud7af/);

    // Slider undoes the native scroll that follows focus.
    const FeaturedSliderController = loadClassicScript('src/pages/home/FeaturedSliderController.js', 'FeaturedSliderController', { console, window: {} });
    const listeners = {};
    const section = { scrollLeft: 0, addEventListener: (type, handler) => { listeners[type] = handler; }, removeEventListener() {} };
    const sliderElement = { parentElement: section, addEventListener() {}, removeEventListener() {} };
    const slider = new FeaturedSliderController({ sliderElement });
    slider.bindDragEvents();
    section.scrollLeft = 1523;
    listeners.scroll();
    assert.equal(section.scrollLeft, 0, 'native section scroll is reset');

    // Report widget is a slim handle; Home no longer adds an empty band.
    const widgetCss = read('src/shared/styles/report-widget.css');
    assert.match(widgetCss, /\.report-widget-btn \{[^}]*width: 24px;/);
    assert.match(widgetCss, /\.report-widget-btn:focus-visible \{[^}]*width: 40px;/);
    assert.match(read('src/pages/home/home.css'), /margin: 18px auto 40px;/);
    assert.match(read('src/pages/home/home.js'), /this\.loadDiscovery\(\);\s*const user = this\.dataController\.getCurrentUser\(\);/);

    console.log('Home page audit round 3 tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
