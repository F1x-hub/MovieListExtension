const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const context = vm.createContext({
    window: { location: { search: '?movieId=101' } },
    document: { addEventListener() {} },
    console: quiet, URLSearchParams, setTimeout, clearTimeout, Set, Map,
    chrome: { storage: { local: { get: async () => ({}) } } },
    localStorage: { getItem: () => null }
});
vm.runInContext(fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8')
    .replace(/^import .*;\r?$/gm, ''), context);
vm.runInContext(fs.readFileSync('src/shared/errors/ErrorPresentation.js', 'utf8'), context);
const prototype = context.window.MovieDetailsManager.prototype;
const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
};
function manager() {
    return Object.assign(Object.create(prototype), {
        elements: { movieDetailsContainer: { innerHTML: 'cached card' } },
        page: { showLoader() {}, hideLoader() {}, showError() {} },
        authDecision: 'unresolved',
        displayMovieDetails: async function(movie) { this.selectedMovie = movie; },
        beginPageGeneration: () => ({}), isPageContextCurrent: () => true,
        logFranchiseDebug() {}, loadAwardsInBackground() {}, loadFramesInBackground() {},
        preloadSources() {}, startPostRenderEnrichment() {}, initPlayerRegistry() {},
        preloadAllPlayers() {}, setProtectedControlsEnabled() {}, loadPersonalState() {}
    });
}
function firebase(services = {}) {
    context.firebaseManager = {
        isAuthReady: true, isAuthenticated: () => true,
        waitForAuthReady: async () => ({ uid: 'u' }), getCurrentUser: () => ({ uid: 'u' }),
        ...services
    };
    context.window.firebaseManager = context.firebaseManager;
}

(async () => {
    // A Firestore read that never settles must not be reached by speculative loading.
    global.KINOPOISK_CONFIG = { CACHE_DURATION: 1000 };
    const MovieCacheService = require('../src/shared/services/MovieCacheService.js');
    let databaseReads = 0;
    const cache = new MovieCacheService({ db: { collection() { databaseReads++; throw Error('network'); } } });
    cache.getLocalCachedMovies = async () => ({ 101: { kinopoiskId: 101, _cacheExpired: true } });
    firebase({ getMovieCacheService: () => cache });
    const a = manager();
    const cached = await a.loadSpeculativeCachedMovie(101);
    assert.equal(cached.kinopoiskId, 101);
    assert.equal(databaseReads, 0);

    // A richer expired cache remains a fallback rather than restarting the loader.
    context.localStorage.getItem = () => JSON.stringify({ kinopoiskId: 101, lastUpdated: '2020-01-01' });
    firebase({ getMovieCacheService: () => ({
        getCachedMovie: async () => ({ kinopoiskId: 101, lastUpdated: '2021-01-01', _cacheExpired: true })
    }) });
    const b = manager();
    let load;
    b.loadMovieById = async (id, loading, skip, options) => { load = { loading, skip, options }; };
    await b.initializeUI();
    assert.equal(load.loading, false);
    assert.equal(load.skip, true);
    assert.equal(load.options.prefetchedCachedMovie._cacheExpired, true);

    // Missing local metadata still permits an authenticated Firestore cache lookup.
    context.localStorage.getItem = () => null;
    firebase({ getMovieCacheService: () => ({ getCachedMovie: async () => null }) });
    const cold = manager();
    cold.loadMovieById = async (id, loading, skip, options) => { load = { loading, skip, options }; };
    await cold.initializeUI();
    assert.equal(load.options.prefetchedCacheResolved, false);

    let legacyCalls = 0;
    firebase({
        getMediaAggregatorService: () => ({ getMovieDetails: async () => { throw Error('provider failed'); } }),
        getKinopoiskService: () => ({ getMovieById: async () => { legacyCalls++; } }),
        getMovieCacheService: () => ({ getCachedMovie: async () => null })
    });
    const c = manager();
    let error;
    c.page.showError = value => { error = value; };
    await c.loadMovieById(101);
    assert.equal(legacyCalls, 0);
    assert.equal(error.message, 'provider failed');
    error = null;
    c.selectedMovie = { kinopoiskId: 101, name: 'cached' };
    await c.loadMovieById(101, false, true, { prefetchedCachedMovie: c.selectedMovie });
    assert.equal(error, null);
    assert.equal(c.selectedMovie.name, 'cached');

    // Delayed auth proceeds exactly once, while unresolved auth is not a guest decision.
    const auth = deferred();
    let authTimeout;
    firebase({ isAuthReady: false, isAuthenticated: () => false,
        waitForAuthReady: timeout => { authTimeout = timeout; return auth.promise; } });
    const d = manager();
    d.loadSpeculativeCachedMovie = async () => null;
    let loads = 0;
    d.loadMovieById = async () => { loads++; };
    const startup = d.initializeUI();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(loads, 0);
    assert.equal(authTimeout, 15000);
    context.firebaseManager.isAuthReady = true;
    context.firebaseManager.isAuthenticated = () => true;
    auth.resolve({ uid: 'u' });
    await startup;
    assert.equal(loads, 1);
    firebase({ isAuthReady: false, isAuthenticated: () => false });
    const e = manager();
    e.loadSpeculativeCachedMovie = async () => null;
    await assert.rejects(e.initializeUI(), value => value.retryable === true
        && context.ErrorPresentation.getPresentation(value).primary === 'retry');
    assert.equal(e.authDecision, 'unresolved');
    firebase({ isAuthReady: true, isAuthenticated: () => false });
    const guest = manager();
    guest.page.showError = value => { error = value; };
    await guest.initializeUI();
    assert.equal(guest.authDecision, 'guest');
    assert.equal(error.code, 'AUTH_REQUIRED');

    // Deadline settlement leaves late work unable to restart the page path.
    const late = deferred();
    await assert.rejects(manager().withMovieLoadDeadline(late.promise, 5), value => value.retryable === true
        && context.ErrorPresentation.getPresentation(value).primary === 'retry');
    late.resolve({ kinopoiskId: 101 });

    let baseCallback;
    const delayedAggregation = deferred();
    firebase({
        getMediaAggregatorService: () => ({ getMovieDetails: (id, options) => {
            baseCallback = options.onBaseMovie;
            return delayedAggregation.promise;
        } }),
        getKinopoiskService: () => ({}), getMovieCacheService: () => ({})
    });
    const expiredLoad = manager();
    expiredLoad.withMovieLoadDeadline = work => prototype.withMovieLoadDeadline.call(expiredLoad, work, 5);
    let lateRenders = 0;
    expiredLoad.displayMovieDetails = async () => { lateRenders++; };
    await expiredLoad.loadMovieById(101);
    baseCallback({ kinopoiskId: 101 });
    delayedAggregation.resolve({ kinopoiskId: 101 });
    assert.equal(lateRenders, 0, 'late base metadata must not replace the timeout screen');

    // Rendering must not wait for Firestore persistence of an otherwise complete DTO.
    const Aggregator = require('../src/shared/services/MediaAggregatorService.js');
    const persistence = deferred();
    const aggregator = new Aggregator({
        kinopoiskService: { getMovieById: async () => ({ kinopoiskId: 101, name: 'Film',
            year: 2020, description: 'Description', posterUrl: 'https://example.org/poster.jpg',
            genres: [{ name: 'Drama' }] }) },
        movieCacheService: { cacheMovie: () => persistence.promise }
    });
    const movie = await aggregator.getMovieDetails(101, { prefetchedCacheResolved: true });
    assert.equal(movie.kinopoiskId, 101);
    persistence.resolve();

    const mapping = deferred();
    const progressive = new Aggregator({
        kinopoiskService: { getMovieById: async () => ({ kinopoiskId: 101, name: 'Film',
            year: 2020, description: 'Description', posterUrl: 'https://example.org/poster.jpg' }) },
        idMappingService: { resolveTmdbIdByKinopoiskId: () => mapping.promise }
    });
    let baseFilm;
    let settled = false;
    const enrichment = progressive.getMovieDetails(101, { onBaseMovie: value => { baseFilm = value; } })
        .then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(baseFilm.kinopoiskId, 101);
    assert.equal(settled, false, 'usable KP metadata must render before optional mapping settles');
    mapping.resolve(null);
    await enrichment;

    // A bookmark lookup for one movie cannot save the newly selected movie under the old ID.
    for (const method of ['handleWatchingToggle', 'handleWatchedToggle', 'handleWatchlistToggle']) {
        for (const changedContext of ['movie', 'user']) {
            const bookmark = deferred();
            const writes = [];
            firebase({ getFavoriteService: () => ({
                getBookmark: () => bookmark.promise,
                addToFavorites: (...args) => writes.push(args),
                removeFromFavorites: (...args) => writes.push(args)
            }) });
            const details = manager();
            details.currentUser = { uid: 'user-a' };
            details.selectedMovie = { kinopoiskId: 101, name: 'Old film' };
            const request = details[method](101, {});
            if (changedContext === 'movie') details.selectedMovie = { kinopoiskId: 202, name: 'New film' };
            else details.currentUser = { uid: 'user-b' };
            bookmark.resolve(null);
            await request;
            assert.equal(writes.length, 0, `${method} must abort after the selected ${changedContext} changes`);
        }
    }

    console.log('Movie Details loading reliability tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
