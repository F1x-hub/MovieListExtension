/**
 * Regression coverage for the fourth Home page audit: language race guard,
 * Russian search titles for Kinopoisk lookups from English cards, heading
 * structure, report-widget target size, legacy cache cleanup, and opt-in
 * [KPCardTrace] logging.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

const tmdbItem = (id, language, overrides = {}) => ({
    tmdbId: id,
    name: language === 'ru-RU' ? `Фильм ${id}` : `Movie ${id}`,
    alternativeName: `Original ${id}`,
    posterUrl: `https://image.tmdb.org/t/p/w342/${id}.jpg`,
    year: 2026,
    releaseDate: '2026-01-01',
    voteCount: 500,
    genreIds: [18],
    originalLanguage: 'en',
    mediaType: 'movie',
    type: 'movie',
    ...overrides
});

async function run() {
    global.chrome = { storage: { local: createStorage({
        home_discovery_cache_v12: { timestamp: 0, data: {} },
        'home_discovery_cache_v13_en-US': { timestamp: 0, data: {} }
    }) } };
    global.MediaClassifier = require('../src/shared/utils/MediaClassifier.js');
    const HomeCacheService = require('../src/shared/services/HomeCacheService.js');

    const range = (start, language, count, overrides) => Array.from({ length: count }, (_, index) => tmdbItem(start + index, language, overrides));
    const trendingLanguages = [];
    const fakeTmdb = {
        defaultLanguage: 'ru-RU',
        isConfigured: () => true,
        getTrendingMovies(window, page) {
            if (page === 1) trendingLanguages.push(this.defaultLanguage);
            return Promise.resolve(page === 1 ? range(100, this.defaultLanguage, 10) : []);
        },
        getNowPlayingMovies(page) { return Promise.resolve(page === 1 ? range(200, this.defaultLanguage, 12) : []); },
        getTrendingTvShows(page) { return Promise.resolve(page === 1 ? range(300, this.defaultLanguage, 12, { mediaType: 'tv', type: 'tv-series' }) : []); },
        getFreshAnimation(page) { return Promise.resolve(page === 1 ? range(400, this.defaultLanguage, 12, { genreIds: [16], type: 'cartoon' }) : []); },
        getFreshAnime(page) {
            return Promise.resolve(page === 1
                ? range(500, this.defaultLanguage, 12, { genreIds: [16], originalLanguage: 'ja', mediaType: 'tv', type: 'anime' })
                : []);
        },
        getFreshMovies: async () => []
    };

    // An English cold start does not wait for Russian data: it is fetched in
    // the background afterwards and its titles are added to the English cache
    // as search titles for the next visit. Any successful refresh retires
    // the legacy caches.
    const home = new HomeCacheService(null, {}, fakeTmdb);
    const english = await home.getDiscoveryData(null, { tmdbOnly: true, locale: 'en' });
    assert.equal(trendingLanguages[0], 'en-US', 'English data is requested first');
    assert.equal(english.data.films[0].name, 'Movie 200');
    assert.equal(english.data.films[0].searchTitle, undefined, 'no Russian cache yet: the page does not wait for one');
    await home.tmdbOnlyRefreshPromises.get('ru-RU');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(trendingLanguages, ['en-US', 'ru-RU'], 'Russian titles are fetched in the background');
    const patchedEnglish = chrome.storage.local.store['home_discovery_cache_v14_en-US'].data;
    assert.equal(patchedEnglish.films[0].searchTitle, 'Фильм 200', 'English cache gains Russian search titles');
    assert.ok(patchedEnglish.series.every(card => /^Фильм /.test(card.searchTitle)), 'TV cards match by tv: namespace');

    // With a Russian cache present, a fresh English payload has them at once.
    const english2 = await home.refreshTmdbOnlyDiscoveryData({ language: 'en-US' });
    assert.equal(english2.films[0].searchTitle, 'Фильм 200');
    assert.equal(trendingLanguages.filter(language => language === 'ru-RU').length, 1, 'no extra Russian fetch');
    assert.equal(chrome.storage.local.store.home_discovery_cache_v12, undefined, 'legacy cache removed after any refresh');
    assert.equal(chrome.storage.local.store['home_discovery_cache_v13_en-US'], undefined);
    const russianCache = chrome.storage.local.store.home_discovery_cache_v14;
    assert.ok(russianCache.data.films.every(card => card.searchTitle === undefined), 'Russian payload needs no search title');

    // Kinopoisk HTML search tries the Russian title first.
    const HomeMovieNavigationService = require('../src/pages/home/HomeMovieNavigationService.js');
    let searchedTitles = null;
    const navigation = new HomeMovieNavigationService({
        htmlSearchService: {
            findMovieByTitle: async titles => { searchedTitles = titles; return { kinopoiskId: 77 }; }
        }
    });
    await navigation.resolve({ tmdbId: 200, name: 'Movie 200', alternativeName: 'Original 200', searchTitle: 'Фильм 200', year: 2026, mediaType: 'movie' });
    assert.deepEqual(searchedTitles, ['Фильм 200', 'Movie 200', 'Original 200']);

    // The search title travels through cards, clicks, enrichment and the
    // resolution route.
    assert.match(read('src/shared/components/MovieCard.js'), /card\.dataset\.movieSearchTitle = movie\.searchTitle/);
    assert.match(read('src/pages/home/HomeRenderer.js'), /data-movie-search-title=/);
    const utils = read('src/shared/utils/Utils.js');
    assert.match(utils, /getAttribute\('data-movie-search-title'\)/);
    assert.match(utils, /searchTitle: String\(info\.searchTitle\)/);
    assert.match(read('src/shared/services/MovieRatingsEnrichmentService.js'), /searchTitle: card\.dataset\.movieSearchTitle/);
    assert.match(read('src/pages/movie-details/movie-details.js'), /const searchTitle = urlParams\.get\('searchTitle'\)/);

    // Only the latest discovery request renders (language switches).
    const homeJs = read('src/pages/home/home.js');
    assert.match(homeJs, /const generation = \+\+this\.discoveryGeneration;/);
    assert.match(homeJs, /if \(generation !== this\.discoveryGeneration\) return;\s*this\.renderDiscovery\(discovery\);/);
    assert.match(homeJs, /\.then\(fresh => \{\s*if \(generation !== this\.discoveryGeneration\) return;/);

    // Heading structure: one h1, no h3 before the first h2.
    const html = read('src/pages/home/home.html');
    assert.match(html, /<h1 class="home-visually-hidden" data-i18n="home\.page_heading">/);
    const renderer = read('src/pages/home/HomeRenderer.js');
    assert.match(renderer, /<p class="featured-title">/);
    assert.ok(!/<h3/.test(renderer), 'Home renderer emits no h3 headings');

    // Report widget meets the 24px minimum target size.
    assert.match(read('src/shared/styles/report-widget.css'), /\.report-widget-btn \{[^}]*width: 24px;/);

    // [KPCardTrace] is opt-in; errors still log.
    const infoCalls = [];
    const warnCalls = [];
    const originalInfo = console.info;
    const originalWarn = console.warn;
    console.info = (...args) => infoCalls.push(args);
    console.warn = (...args) => warnCalls.push(args);
    try {
        navigation._kpTrace('resolve:start', {});
        navigation._kpTrace('resolve:direct-rating-error', {});
        assert.equal(infoCalls.length, 0);
        assert.equal(warnCalls.length, 1);
        global.localStorage = { getItem: key => (key === 'movielist:debug-ratings' ? '1' : null) };
        navigation._kpTrace('resolve:start', {});
        assert.equal(infoCalls.length, 1);
    } finally {
        console.info = originalInfo;
        console.warn = originalWarn;
        delete global.localStorage;
    }
    for (const file of ['src/shared/services/KinopoiskPersonHtmlService.js', 'src/pages/home/HomeMovieNavigationService.js']) {
        const direct = read(file).split("console.info('[KPCardTrace]").length - 1;
        assert.equal(direct, 1, `${file} logs [KPCardTrace] only through _kpTrace`);
    }

    console.log('Home page audit round 4 tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
