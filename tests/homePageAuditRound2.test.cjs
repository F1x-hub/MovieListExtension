/**
 * Regression coverage for the second Home page audit: TMDB timeouts,
 * bookmark read failures, Continue watching order/progress, community pools,
 * poster sizes, TMDB id namespaces, trending anime, browser-locale default,
 * modifier clicks, single tab stop per card, and detached-card cleanup.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

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

async function run() {
    // TMDB requests time out and still honour the caller's abort signal.
    const TMDBService = require('../src/shared/services/TMDBService.js');
    const tmdb = new TMDBService();
    tmdb.requestTimeoutMs = 20;
    const timed = tmdb._withRequestTimeout({});
    assert.equal(timed.signal.aborted, false);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(timed.signal.aborted, true, 'stalled TMDB requests are aborted');
    tmdb.requestTimeoutMs = 10000;
    const external = new AbortController();
    const linked = tmdb._withRequestTimeout({ signal: external.signal });
    external.abort();
    assert.equal(linked.signal.aborted, true, 'caller aborts propagate');

    // Movie and TV ids are separate namespaces; trending TV no longer feeds
    // Anime (it surfaced year-round long-runners such as One Piece).
    global.chrome = { storage: { local: createStorage() } };
    const HomeCacheService = require('../src/shared/services/HomeCacheService.js');
    const item = (id, section, overrides = {}) => ({
        tmdbId: id,
        name: `Title ${section} ${id}`,
        year: 2026,
        releaseDate: '2026-01-01',
        voteCount: 500,
        posterUrl: `https://image.tmdb.org/t/p/w342/${section}${id}.jpg`,
        section,
        ...overrides
    });
    const range = (start, section, count, overrides) => Array.from({ length: count }, (_, index) => item(start + index, section, overrides));
    const fakeTmdb = {
        isConfigured: () => true,
        getTrendingMovies: async (window, page) => page === 1 ? range(100, 'featured', 10, { mediaType: 'movie' }) : [],
        getNowPlayingMovies: async page => page === 1 ? range(200, 'films', 12, { mediaType: 'movie' }) : [],
        getTrendingTvShows: async page => page === 1
            ? [item(9001, 'anime', { name: 'One Piece', mediaType: 'tv', year: 1999 }), ...range(200, 'series', 12, { mediaType: 'tv' })]
            : [],
        getFreshAnimation: async page => page === 1 ? range(400, 'cartoons', 12, { mediaType: 'movie' }) : [],
        getFreshAnime: async page => page === 1 ? range(500, 'anime', 12, { mediaType: 'tv' }) : [],
        getFreshMovies: async () => []
    };
    const home = new HomeCacheService(null, {}, fakeTmdb);
    home.isCandidateForSection = (candidate, section) => section === 'featured' || candidate.section === section;
    const discovery = await home.refreshTmdbOnlyDiscoveryData();
    assert.equal(discovery.series.length, 12, 'TV ids equal to film ids are not treated as duplicates');
    assert.ok(discovery.series.some(card => card.tmdbId === 200));
    assert.ok(discovery.films.some(card => card.tmdbId === 200));
    assert.ok(!discovery.anime.some(card => card.tmdbId === 9001), 'trending TV does not feed Anime');

    // Bookmark read failures surface as errors and are not cached.
    let favoriteReads = 0;
    let failReads = true;
    const progressStore = createStorage({
        watching_progress_2: { season: 2, episode: 5, updatedAt: Date.now() }
    });
    const fm = {
        getFavoriteService: () => ({
            getFavorites: async (uid, status, sortBy, order, options) => {
                favoriteReads++;
                assert.equal(options?.throwOnError, true, 'Home asks for read errors');
                if (failReads) throw new Error('offline');
                if (status === 'watching') {
                    return [
                        { movieId: 1, type: 'movie', createdAt: 3000 },
                        { movieId: 2, type: 'tv-series', createdAt: 1000 },
                        { movieId: 3, type: 'movie', createdAt: 2000 }
                    ];
                }
                return [];
            }
        }),
        getMovieCacheService: () => ({
            getMoviesByAvgRating: async () => ({ movies: [{ id: 'single', avgRating: 10, ratingsCount: 1 }] }),
            getMostRatedMovies: async () => [{ id: 'crowd', avgRating: 9.1, ratingsCount: 80 }]
        }),
        getHomeCacheService: () => ({}),
        getKinopoiskService: () => ({})
    };
    const sandbox = {
        console,
        chrome: { storage: { local: progressStore } },
        window: {},
        ProfileService: class {
            async getRatingsStatistics() { return { totalRatings: 1, averageRating: 8 }; }
        }
    };
    sandbox.window = sandbox;
    const HomeDataController = loadClassicScript('src/pages/home/HomeDataController.js', 'HomeDataController', sandbox);
    const controller = new HomeDataController(fm);

    const failed = await controller.fetchPersonalData('user-1');
    assert.equal(failed.loadFailed, true, 'offline is not shown as "no bookmarks"');
    const failedDashboard = await controller.fetchDashboardData('user-1');
    assert.equal(failedDashboard.stats.watchingCount, '—');
    const readsAfterFailure = favoriteReads;

    failReads = false;
    const personal = await controller.fetchPersonalData('user-1');
    assert.ok(favoriteReads > readsAfterFailure, 'failed reads are retried, not reused');
    assert.equal(personal.loadFailed, undefined);
    assert.deepEqual(Array.from(personal.watching, entry => entry.movieId), [2, 1, 3], 'latest playback first');
    assert.equal(personal.watching[0].watchProgress.episode, 5);

    const dashboard = await controller.fetchDashboardData('user-1');
    assert.equal(dashboard.communityTop[0].id, 'crowd', 'most-rated pool reaches Community picks');

    // Renderer: stored posters shrink; progress labels format by type.
    const rendererSandbox = {
        console,
        window: {},
        chrome: { runtime: { getURL: value => value } },
        MovieCard: { create: () => ({}) }
    };
    rendererSandbox.window = rendererSandbox;
    const HomeRenderer = loadClassicScript('src/pages/home/HomeRenderer.js', 'HomeRenderer', rendererSandbox);
    const renderer = new HomeRenderer();
    assert.equal(
        renderer.getCardPosterUrl('https://avatars.mds.yandex.net/get-kinopoisk-image/1629390/abc/orig'),
        'https://avatars.mds.yandex.net/get-kinopoisk-image/1629390/abc/300x450'
    );
    assert.equal(
        renderer.getCardPosterUrl('https://image.tmdb.org/t/p/original/x.jpg'),
        'https://image.tmdb.org/t/p/w342/x.jpg'
    );
    assert.equal(renderer.getCardPosterUrl('https://example.test/p.jpg'), 'https://example.test/p.jpg');
    assert.equal(renderer.formatWatchProgress({ season: 2, episode: 5 }, 'tv-series'), '2 сезон, 5 серия');
    assert.equal(renderer.formatWatchProgress({ timestamp: 3725 }, 'movie'), 'Остановились на 1:02:05');
    assert.equal(renderer.formatWatchProgress({ timestamp: 0 }, 'movie'), '');

    // Locale defaults to the browser language when nothing is saved.
    global.chrome = {
        storage: { sync: { get: async () => ({}) } },
        i18n: { getUILanguage: () => 'ru-RU' }
    };
    const { I18n } = await import(pathToFileURL(path.join(rootDir, 'src/shared/i18n/I18n.js')).href);
    const ruI18n = new I18n();
    await ruI18n.init();
    assert.equal(ruI18n.currentLocale, 'ru');
    global.chrome.i18n.getUILanguage = () => 'de-DE';
    const deI18n = new I18n();
    await deI18n.init();
    assert.equal(deI18n.currentLocale, 'en');
    global.chrome.storage.sync.get = async () => ({ language: 'en' });
    global.chrome.i18n.getUILanguage = () => 'ru';
    const savedI18n = new I18n();
    await savedI18n.init();
    assert.equal(savedI18n.currentLocale, 'en', 'a saved choice wins');

    // Detached cards are released from the ratings observer.
    const MovieRatingsEnrichmentService = require('../src/shared/services/MovieRatingsEnrichmentService.js');
    const enricher = new MovieRatingsEnrichmentService({ trace: false });
    const unobserved = [];
    enricher.observer = { unobserve: card => unobserved.push(card) };
    const detached = { isConnected: false };
    const attached = { isConnected: true };
    enricher.trackedCards.add(detached);
    enricher.trackedCards.add(attached);
    enricher.pendingCards.add(detached);
    enricher.releaseDetachedCards();
    assert.equal(enricher.trackedCards.has(detached), false);
    assert.equal(enricher.pendingCards.has(detached), false);
    assert.equal(enricher.trackedCards.has(attached), true);
    assert.deepEqual(unobserved, [detached]);

    // Source contracts for DOM-bound behaviour.
    const utils = read('src/shared/utils/Utils.js');
    assert.match(utils, /if \(e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey\) \{\s*_openInNewTab\(info\);/);
    const movieCard = read('src/shared/components/MovieCard.js');
    assert.match(movieCard, /class="mc-poster-container \$\{isLoading \? 'mc-skeleton' : ''\}" tabindex="-1"/);
    assert.ok(!movieCard.includes('aria-label="Рейтинги"'));
    const homeJs = read('src/pages/home/home.js');
    assert.match(homeJs, /if \(generation !== this\.personalGeneration\) return;/);
    assert.match(homeJs, /if \(generation !== this\.dashboardGeneration\) return;/);
    assert.match(homeJs, /renderPersonalSkeleton\(this\.personalTierSection\)/);
    assert.match(homeJs, /trace: HomePage\.isRatingsTraceEnabled\(\)/);
    const ratingService = read('src/shared/services/RatingService.js');
    assert.match(ratingService, /home_rating_stats_v1_\$\{userId\}/);
    const cardCss = read('src/shared/styles/movie-card.css');
    const searchPoster = cardCss.slice(cardCss.indexOf('.mc-variant-search .mc-poster-container {'));
    assert.ok(!searchPoster.slice(0, 400).includes('#121214'), 'poster placeholder follows the theme');

    console.log('Home page audit round 2 tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
