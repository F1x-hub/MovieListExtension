/**
 * Regression coverage for the Home page audit: card-sized posters, quality
 * gates, cache migration, shared Firestore reads, community ranking,
 * renderer escaping/lazy loading, and keyboard-reachable slider pages.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

function createStorage() {
    const store = {};
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
    // TMDB list items use card-sized posters instead of ~1 MB originals.
    const TMDBService = require('../src/shared/services/TMDBService.js');
    const tmdb = new TMDBService();
    const normalized = tmdb.normalizeTmdbItem({ id: 1, title: 'A', poster_path: '/p.jpg', backdrop_path: '/b.jpg', release_date: '2026-01-01' });
    assert.equal(normalized.posterUrl, 'https://image.tmdb.org/t/p/w342/p.jpg');
    assert.equal(normalized.backdrop, 'https://image.tmdb.org/t/p/w780/b.jpg');

    // Animation and anime discovery queries never return unaired titles.
    const tmdbSource = read('src/shared/services/TMDBService.js');
    const animeSource = tmdbSource.slice(tmdbSource.indexOf('async getFreshAnime('), tmdbSource.indexOf('async getFreshAnime(') + 2500);
    assert.match(animeSource, /'primary_release_date\.lte': todayStr/);
    assert.match(animeSource, /'first_air_date\.lte': todayStr/);
    const animationSource = tmdbSource.slice(tmdbSource.indexOf('async getFreshAnimation('), tmdbSource.indexOf('async getFreshMovies('));
    assert.match(animationSource, /'first_air_date\.lte': todayStr/);

    global.chrome = { storage: { local: createStorage() } };
    const HomeCacheService = require('../src/shared/services/HomeCacheService.js');

    const makeItem = (id, overrides = {}) => ({
        tmdbId: id,
        name: `Title ${id}`,
        alternativeName: `Original ${id}`,
        year: 2026,
        releaseDate: '2026-01-01',
        voteCount: 500,
        posterUrl: `https://image.tmdb.org/t/p/w342/${id}.jpg`,
        section: 'films',
        ...overrides
    });
    const sectionItems = (start, section, count = 12) => Array.from({ length: count }, (_, index) => makeItem(start + index, { section }));
    let trendingTvPages = [];
    const fakeTmdb = {
        isConfigured: () => true,
        getTrendingMovies: async (window, page) => page === 1 ? sectionItems(100, 'featured') : [],
        getNowPlayingMovies: async page => page === 1 ? [
            makeItem(200, { voteCount: 20 }),
            makeItem(201, { name: '仙逆剧场版', alternativeName: '仙逆剧场版' }),
            makeItem(202, { posterUrl: '' }),
            ...sectionItems(210, 'films')
        ] : [],
        getTrendingTvShows: async page => {
            trendingTvPages.push(page);
            if (page === 1) return [...sectionItems(300, 'series', 5), makeItem(390, { section: 'series', voteCount: 3 })];
            if (page <= 2) return [];
            return sectionItems(300 + page * 20, 'series', 10);
        },
        getFreshAnimation: async page => page === 1 ? sectionItems(400, 'cartoons') : [],
        getFreshAnime: async page => page === 1 ? sectionItems(500, 'anime') : [],
        getFreshMovies: async () => []
    };

    // Legacy v12 cache is served immediately with resized posters while the
    // current quality-gated payload refreshes, then the legacy key is removed.
    chrome.storage.local.store.home_discovery_cache_v12 = {
        timestamp: Date.now(),
        data: {
            featured: sectionItems(900, 'featured', 5).map(item => ({ ...item, posterUrl: `https://image.tmdb.org/t/p/original/${item.tmdbId}.jpg` })),
            films: sectionItems(920, 'films', 5),
            series: sectionItems(940, 'series', 5),
            cartoons: [],
            anime: []
        }
    };
    const home = new HomeCacheService(null, {}, fakeTmdb);
    home.isCandidateForSection = (item, section) => section === 'featured' || item.section === section;
    const legacy = await home.getDiscoveryData(null, { tmdbOnly: true });
    assert.equal(legacy.isStale, true);
    assert.ok(legacy.refreshPromise, 'stale results expose the background refresh');
    assert.ok(legacy.data.featured.every(card => card.posterUrl.includes('/t/p/w342/')));

    const fresh = await legacy.refreshPromise;
    assert.equal(chrome.storage.local.store.home_discovery_cache_v12, undefined, 'legacy cache is removed');
    assert.ok(chrome.storage.local.store.home_discovery_cache_v14);

    const filmIds = fresh.films.map(card => card.tmdbId);
    assert.ok(!filmIds.includes(200), 'low-vote films are rejected');
    assert.ok(!filmIds.includes(201), 'unreadable CJK titles are rejected');
    assert.ok(!filmIds.includes(202), 'poster-less titles are rejected');
    assert.equal(fresh.films.length, 12);
    assert.ok(!fresh.series.some(card => card.tmdbId === 390), 'low-vote series are rejected');
    assert.equal(fresh.series.length, 12, 'series backfill from later trending pages up to the target');
    assert.deepEqual(trendingTvPages.filter(page => page > 2), [3]);
    assert.ok(fresh.films.every(card => !('backdrop' in card) && !('description' in card)), 'cache omits unused fields');

    // HomeDataController shares one bookmarks read between both tiers,
    // caches rating statistics, and ranks community picks by votes.
    const calls = { favorites: [], counts: 0, ratingStats: 0, community: null };
    const fm = {
        getFavoriteService: () => ({
            getFavorites: async (uid, status) => {
                calls.favorites.push(status);
                return Array.from({ length: status === 'watching' ? 8 : 3 }, (_, index) => ({ id: `${status}-${index}` }));
            },
            getFavoritesCount: async () => { calls.counts++; return 0; }
        }),
        getMovieCacheService: () => ({
            getMoviesByAvgRating: async options => {
                calls.community = options;
                return {
                    movies: [
                        { id: 'single', avgRating: 10, ratingsCount: 1 },
                        { id: 'popular', avgRating: 9, ratingsCount: 40 },
                        { id: 'good', avgRating: 8.5, ratingsCount: 20 },
                        { id: 'mid', avgRating: 7, ratingsCount: 15 },
                        { id: 'low', avgRating: 5, ratingsCount: 30 }
                    ]
                };
            }
        }),
        getHomeCacheService: () => ({}),
        getKinopoiskService: () => ({})
    };
    const controllerSandbox = {
        console,
        chrome: { storage: { local: createStorage() } },
        window: {},
        ProfileService: class {
            async getRatingsStatistics() {
                calls.ratingStats++;
                return { totalRatings: 12, averageRating: 7.25 };
            }
        }
    };
    controllerSandbox.window = controllerSandbox;
    const HomeDataController = loadClassicScript('src/pages/home/HomeDataController.js', 'HomeDataController', controllerSandbox);
    const controller = new HomeDataController(fm);
    const [personal, dashboard] = await Promise.all([
        controller.fetchPersonalData('user-1'),
        controller.fetchDashboardData('user-1')
    ]);
    assert.deepEqual([...calls.favorites].sort(), ['plan_to_watch', 'watching'], 'each bookmark list is read once');
    assert.equal(calls.counts, 0, 'dashboard counts come from the shared lists');
    assert.equal(personal.watching.length, 6);
    assert.equal(personal.watchingTotal, 8);
    assert.equal(dashboard.stats.watchingCount, 8);
    assert.equal(dashboard.stats.watchlistCount, 3);
    assert.equal(dashboard.stats.totalRatings, 12);
    assert.equal(calls.community.limit, 24);
    assert.deepEqual(Array.from(dashboard.communityTop, movie => movie.id), ['popular', 'good', 'single', 'mid']);

    await controller.fetchDashboardData('user-1');
    assert.equal(calls.ratingStats, 1, 'rating statistics are cached between loads');
    const servicesBefore = controller.homeMovieNavigationService;
    controller.initServices();
    assert.equal(controller.homeMovieNavigationService, servicesBefore, 'services are not recreated per call');

    // Renderer escapes provider data, lazy-loads posters, and uses w500 heroes.
    let lastCardOptions = null;
    const rendererSandbox = {
        console,
        window: {},
        chrome: { runtime: { getURL: value => `chrome-extension://id/${value}` } },
        MovieCard: { create: (data, options) => { lastCardOptions = options; return {}; } }
    };
    rendererSandbox.window = rendererSandbox;
    const HomeRenderer = loadClassicScript('src/pages/home/HomeRenderer.js', 'HomeRenderer', rendererSandbox);
    const renderer = new HomeRenderer();
    const slide = renderer.renderFeaturedSlide({
        tmdbId: 7,
        name: '<b>x</b>',
        year: '2026"><img>',
        mediaType: 'movie" onclick="x',
        posterUrl: 'https://image.tmdb.org/t/p/w342/a.jpg"x'
    }, 6, 10);
    assert.ok(!slide.includes('<b>x</b>'));
    assert.ok(!slide.includes('2026"><img>'));
    assert.ok(!slide.includes('movie" onclick'));
    assert.ok(slide.includes('/t/p/w500/a.jpg&quot;x'));
    assert.match(slide, /loading="lazy"/);
    assert.match(renderer.renderFeaturedSlide({ tmdbId: 8, name: 'n' }, 0, 10), /fetchpriority="high"/);
    renderer.createMovieCard({ name: 'n' });
    assert.equal(lastCardOptions.lazyPoster, true, 'grid posters load lazily');
    assert.equal(renderer.escapeHtml(0), '0', 'zero statistics stay visible');

    // Slider pages are buttons and focus follows the end-aligned last page.
    const sliderSource = read('src/pages/home/FeaturedSliderController.js');
    assert.match(sliderSource, /document\.createElement\('button'\)/);
    assert.match(sliderSource, /addEventListener\('focusin', this\.onFocusIn\)/);
    const FeaturedSliderController = loadClassicScript('src/pages/home/FeaturedSliderController.js', 'FeaturedSliderController', { console, window: {} });
    const slider = new FeaturedSliderController({});
    slider.items = new Array(10).fill({});
    slider.itemsPerPage = 4;
    slider.totalPages = 3;
    assert.equal(slider.getPageForIndex(0), 0);
    assert.equal(slider.getPageForIndex(4), 1);
    assert.equal(slider.getPageForIndex(6), 2);
    assert.equal(slider.getPageForIndex(9), 2);

    // Static page: connection hints target hosts Home uses; text is localized.
    const html = read('src/pages/home/home.html');
    assert.ok(!html.includes('firebaseio.com'));
    assert.ok(!html.includes('avatars.mds.yandex.net'));
    assert.ok(html.includes('cloudfunctions.net'));
    assert.ok(html.includes('data-i18n="home.sections.films"'));
    const css = read('src/pages/home/home.css');
    assert.match(css, /prefers-reduced-motion: reduce/);

    console.log('Home page audit fix tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
