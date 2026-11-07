const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const context = vm.createContext({
    window: { location: { search: '?movieId=101' } },
    document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
    console: quiet, URLSearchParams, setTimeout, clearTimeout, Set, Map,
    chrome: { storage: { local: { get: async () => ({}) } } },
    localStorage: { getItem: () => null }
});
context.i18n = { get: key => key };
context.isSeriesMedia = media => media?.type === 'TV_SERIES';
context.RatingConfig = { normalizeComment: value => String(value || '').trim() };
context.Utils = {
    normalizeRatingComment: value => String(value || '').trim(),
    normalizeRatingReview: value => String(value || '').trim(),
    showToast() {}
};
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
    cache.getLocalCachedMovies = async () => ({ 101: { kinopoiskId: 101, name: 'Film', _cacheExpired: true } });
    firebase({ getMovieCacheService: () => cache });
    const a = manager();
    const cached = await a.loadSpeculativeCachedMovie(101);
    assert.equal(cached.kinopoiskId, 101);
    assert.equal(databaseReads, 0);

    // RatingsRefreshService keeps ratings under the same key: a record with no title is no film.
    const stored = {};
    global.chrome = { storage: { local: {
        get: async key => (stored[key] ? { [key]: stored[key] } : {}),
        set: async values => { Object.assign(stored, values); }
    } } };
    const ratingsOnly = { kinopoiskId: 101, kpRating: 7.5, votes: { kp: 900 }, lastRatingsParsedAt: '2026-11-01T00:00:00.000Z' };
    const storedCache = new MovieCacheService({ db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) } });
    stored.local_movie_cache_101 = ratingsOnly;
    assert.equal(await storedCache.getCachedMovie(101, { localOnly: true }), null);
    assert.equal(await storedCache.getCachedMovie(101), null);
    const others = await storedCache.getLocalCachedMovies([101]);
    assert.equal(others[101].kpRating, 7.5, 'Bookmark cards still read their ratings from such a record');
    firebase({ getMovieCacheService: () => storedCache });
    const noFilm = manager();
    let paints = 0;
    noFilm.displayMovieDetails = async () => { paints++; };
    assert.equal(await noFilm.loadSpeculativeCachedMovie(101), null);
    assert.equal(paints, 0, 'A ratings-only record never paints as an unknown film');
    context.localStorage.getItem = () => JSON.stringify({ kinopoiskId: 101, votes: { kp: 1 } });
    assert.equal(await manager().loadSpeculativeCachedMovie(101), null, 'Neither does a title-less legacy record');
    context.localStorage.getItem = () => null;

    // A local rewrite keeps what the ratings refresh parsed, so it does not parse again.
    await storedCache.cacheMovie({ kinopoiskId: 101, name: 'Film', kpRating: 0, imdbRating: 8.1, votes: { kp: 0, tmdb: 5 } }, false, { localOnly: true });
    const rewritten = stored.local_movie_cache_101;
    assert.equal(rewritten.name, 'Film');
    assert.equal(rewritten.lastRatingsParsedAt, ratingsOnly.lastRatingsParsedAt);
    assert.equal(rewritten.kpRating, 7.5);
    assert.equal(rewritten.imdbRating, 8.1, 'A rating the film already has is not replaced');
    assert.deepEqual({ ...rewritten.votes }, { kp: 900, tmdb: 5 });
    assert.equal((await storedCache.getCachedMovie(101, { localOnly: true })).name, 'Film');
    delete global.chrome;

    // A card clicked before it knows its ID opens the ordinary route when this browser has the mapping.
    const canonical = [];
    Object.assign(context.window, {
        history: { replaceState: (state, title, url) => { canonical.push(url); context.window.location.search = url.slice(url.indexOf('?')); } }
    });
    context.chrome.runtime = { getURL: path => `chrome-extension://test/${path}` };
    const homeSearch = '?resolveTmdbId=7&source=home-tmdb-only&title=Film&originalTitle=Original&year=2020&mediaType=movie';
    const homeRouteLoad = async (search, knownId) => {
        context.window.location.search = search;
        const asked = [];
        context.HomeMovieNavigationService = class {
            async findKnownMapping(item) { asked.push(item); return knownId; }
            async resolve() { return { kinopoiskId: 303 }; }
        };
        firebase({
            getMovieCacheService: () => ({ getCachedMovie: async () => ({ kinopoiskId: 202, name: 'Film' }) }),
            getKinopoiskService: () => ({})
        });
        const page = manager();
        const events = [];
        page.showHomeResolutionState = () => events.push('searching');
        page.probeSourceAvailability = async () => {};
        page.loadMovieById = async (id, loading, skip, options) => { events.push({ id, loading, skip, options }); };
        await page.initializeUI();
        return { events, asked };
    };
    const known = await homeRouteLoad(homeSearch, 202);
    assert.equal(known.events.includes('searching'), false, 'No search screen for a film this browser knows');
    assert.equal(known.events[0].id, '202');
    assert.equal(known.events[0].skip, true, 'The film paints from the cache and refreshes behind it');
    assert.equal(known.asked[0].tmdbId, 7);
    const canonicalParams = new URLSearchParams(canonical.at(-1).split('?')[1]);
    assert.equal(canonicalParams.get('movieId'), '202');
    assert.equal(canonicalParams.get('tmdbId'), '7');
    assert.equal(canonicalParams.get('source'), 'home-tmdb-only');
    assert.equal(canonicalParams.has('resolveTmdbId'), false);

    const unknown = await homeRouteLoad(homeSearch, null);
    assert.equal(unknown.events[0], 'searching', 'An unknown film still searches first');
    assert.equal(unknown.events[1].id, 303);

    const retried = await homeRouteLoad(`${homeSearch}&retry=1`, 202);
    assert.equal(retried.asked.length, 0, 'A retry goes back to the search');
    assert.equal(retried.events[0], 'searching');

    // A finished search that found no card is an answer, not a failure: a retry
    // would only repeat it, so the page says so and offers the way back. A search
    // that did not finish keeps its retry.
    {
        const resolveRoute = async answer => {
            context.window.location.search = homeSearch;
            const asked = [];
            context.HomeMovieNavigationService = class {
                async findKnownMapping() { return null; }
                async resolve(item, options) { asked.push(options); return typeof answer === 'function' ? answer() : answer; }
            };
            firebase({ getMovieCacheService: () => ({ getCachedMovie: async () => null }), getKinopoiskService: () => ({}) });
            const page = manager();
            let shown = null;
            const loads = [];
            page.page.showError = error => { shown = error; };
            page.showHomeResolutionState = () => {};
            page.loadMovieById = async id => { loads.push(id); };
            page.withMovieLoadDeadline = work => prototype.withMovieLoadDeadline.call(page, work, 5);
            await page.initializeUI();
            return { shown, asked, loads };
        };
        // The film page always passes both actions; the dialog shows those the error allows.
        const actionOf = error => context.ErrorPresentation.getPresentation(error, { onBack() {}, onRetry() {} }).primary;

        const missing = await resolveRoute(null);
        assert.equal(missing.asked[0].reportFailure, true, 'The route asks to hear about a search that did not finish');
        assert.equal(missing.loads.length, 0);
        assert.equal(missing.shown?.code, 'KINOPOISK_NOT_FOUND', 'A film Kinopoisk does not have is named as such');
        assert.equal(missing.shown.retryable, false);
        assert.equal(actionOf(missing.shown), 'back', 'It offers the way back instead of a retry');
        assert.equal(context.ErrorPresentation.getPresentation(missing.shown).primary, 'close', 'Never a retry, even without a way back');

        const failed = await resolveRoute({ failed: true, reason: 'BACKGROUND_TIMEOUT' });
        assert.equal(failed.loads.length, 0);
        assert.equal(failed.shown?.code, 'KINOPOISK_UNAVAILABLE', 'A search that did not finish is not "not found"');
        assert.equal(actionOf(failed.shown), 'retry', 'It can be retried');
        assert.match(String(failed.shown.message), /BACKGROUND_TIMEOUT/, 'Its reason stays in the technical details');

        const slow = await resolveRoute(() => new Promise(() => {}));
        assert.equal(actionOf(slow.shown), 'retry', 'So can a search that ran out of time');

        // The words the dialog shows, in both languages.
        const catalog = {};
        vm.runInNewContext(fs.readFileSync('src/shared/i18n/locales.js', 'utf8')
            .replace('export const locales', 'globalThis.locales'), catalog);
        const realI18n = context.i18n;
        try {
            for (const [locale, title, back] of [
                ['ru', 'Этого фильма нет в Kinopoisk', 'Вернуться назад'],
                ['en', "This movie isn't on Kinopoisk", 'Go back']
            ]) {
                context.i18n = {
                    currentLocale: locale,
                    get: key => key.split('.').reduce((node, part) => node?.[part], catalog.locales[locale]) ?? key
                };
                const shown = context.ErrorPresentation.getPresentation(missing.shown, { onBack() {}, onRetry() {} });
                assert.equal(shown.title, title, `${locale}: the title says the film is not on Kinopoisk`);
                assert.equal(shown.primaryLabel, back, `${locale}: the action goes back`);
                assert.equal(shown.message, catalog.locales[locale].errors.kinopoisk.not_found.message);
            }
        } finally {
            context.i18n = realI18n;
        }

        // A retry replaces the failed attempt, so Back leaves for the page the card was on.
        const replaced = [];
        context.window.location.search = homeSearch;
        context.window.location.replace = url => replaced.push(url);
        manager().handleLoadRetry();
        delete context.window.location.replace;
        assert.equal(replaced.length, 1, 'A retry does not add a page to go back through');
        const retryParams = new URLSearchParams(replaced[0].slice(replaced[0].indexOf('?')));
        assert.equal(retryParams.get('resolveTmdbId'), '7');
        assert.match(retryParams.get('retry') || '', /^\d+$/);
    }

    context.window.location.search = '?movieId=101';
    delete context.HomeMovieNavigationService;

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

    // A denied private episode-state read must not block the ordinary title rating flow.
    const permissionDenied = Object.assign(new Error('Missing or insufficient permissions.'), {
        code: 'permission-denied'
    });
    const legacyRating = { id: 'user-a_101', rating: 5, comment: 'old comment' };
    let addOrUpdateCalls = 0;
    let ratingReadCalls = 0;
    let personalRatingPatchCalls = 0;
    firebase({
        getUserService: () => ({ getUserProfile: async () => ({ displayName: 'User' }) }),
        getRatingService: () => ({
            getRating: async () => { ratingReadCalls++; return legacyRating; },
            addOrUpdateRating: async () => { addOrUpdateCalls++; }
        }),
        getSeriesEpisodeRatingService: () => ({ getEpisodeRatings: async () => { throw permissionDenied; } }),
        getFavoriteService: () => ({ getBookmark: async () => null })
    });
    const deniedDetails = manager();
    deniedDetails.loadPersonalState = prototype.loadPersonalState;
    deniedDetails.currentUser = { uid: 'user-a' };
    deniedDetails.selectedMovie = { kinopoiskId: 101, tmdbId: 202, type: 'TV_SERIES', name: 'Series' };
    deniedDetails.capturePageContext = () => ({ movieId: '101' });
    deniedDetails.isPageContextCurrent = () => true;
    deniedDetails.patchAdminControl = () => {};
    deniedDetails.patchCollectionsMenu = () => {};
    deniedDetails.patchBookmarkState = () => {};
    deniedDetails.patchPersonalRating = rating => {
        personalRatingPatchCalls++;
        deniedDetails.currentPersonalRating = rating;
        deniedDetails.currentRating = Number(rating?.rating) || 0;
    };
    deniedDetails.updateSeriesEpisodeRatingUI = () => {};
    await deniedDetails.loadPersonalState(101);
    assert.equal(ratingReadCalls, 1);
    assert.equal(personalRatingPatchCalls, 1);
    assert.equal(deniedDetails.currentPersonalRating, legacyRating,
        'the title rating is patched even when the private episode read is denied');
    assert.equal(deniedDetails.hasEpisodeRatingsPermissionDenied(), true);
    const unavailableControl = deniedDetails.renderEpisodeRatingControl({ seasonNumber: 1, episodeNumber: 1 });
    assert.match(unavailableControl, /series_episode_rules_error/);
    assert.doesNotMatch(unavailableControl, /role="radio"/,
        'unavailable episode stars are replaced by a message while the independent title rating remains usable');

    deniedDetails.elements = {
        ratingComment: { value: 'updated comment' },
        ratingReview: { value: '' }
    };
    deniedDetails.currentRating = 7;
    deniedDetails.originalRating = 5;
    deniedDetails.currentRatingId = legacyRating.id;
    deniedDetails.originalRatingComment = 'old comment';
    deniedDetails.originalRatingReview = '';
    deniedDetails.closeRatingModal = () => {};
    deniedDetails.loadPersonalState = async () => {};
    await deniedDetails.saveRating();
    assert.equal(addOrUpdateCalls, 1, 'an ordinary title score remains saveable after the denied episode read');

    // A press opens the rating dialog before its read answers, with the choice locked until it does.
    {
        const element = () => ({
            style: {}, dataset: {}, attributes: {}, value: '', textContent: '', innerHTML: '', inert: false,
            classList: { toggle() {}, add() {}, remove() {} },
            setAttribute(name, value) { this.attributes[name] = value; },
            removeAttribute(name) { delete this.attributes[name]; },
            appendChild() {}, querySelectorAll: () => [], focus() {}
        });
        Object.assign(context, { isSpidermanMovie: () => false, isStarWarsMovie: () => false, getRatingIconMarkup: () => '' });
        Object.assign(context.document, { createElement: element, activeElement: null });
        const body = element();
        const dialog = { ...element(), style: { display: 'none' }, querySelector: selector => (selector === '.rating-modal-body' ? body : null) };
        const elements = { ratingModal: dialog };
        for (const name of ['ratingMoviePoster', 'ratingMovieTitle', 'ratingMovieMeta', 'ratingStars', 'ratingComment', 'charCount',
            'ratingReview', 'reviewCharCount', 'reviewContainer', 'writeReviewBtn', 'saveRatingBtn', 'cancelRatingBtn', 'ratingModalClose', 'ratingStatus']) {
            elements[name] = element();
        }
        let writes = 0;
        let read = deferred();
        firebase({
            getRatingService: () => ({ getRating: () => read.promise, addOrUpdateRating: async () => { writes++; } }),
            getUserService: () => ({ getUserProfile: async () => ({ displayName: 'User' }) })
        });
        const details = manager();
        details.elements = elements;
        details.updateSeriesEpisodeRatingUI = () => {};
        details.currentPersonalRating = { id: 'known', rating: 7, comment: 'Known comment' };
        const movie = { kinopoiskId: 101, name: 'Film', year: 2020, genres: [] };

        const opening = details.showRatingModal(movie);
        assert.equal(dialog.style.display, 'flex', 'the dialog shows before the read answers');
        assert.equal(details.currentRating, 7, 'with the rating the page already knows');
        assert.equal(elements.ratingComment.value, 'Known comment');
        assert.equal(body.inert, true, 'nothing can be chosen from unconfirmed data');
        assert.equal(elements.saveRatingBtn.attributes['aria-disabled'], 'true');
        await details.saveRating();
        assert.equal(writes, 0, 'nothing can be saved from unconfirmed data');

        read.resolve(null);
        await opening;
        assert.equal(body.inert, false);
        assert.equal(elements.saveRatingBtn.attributes['aria-disabled'], undefined);
        assert.equal(details.currentRating, 7, 'a failed read, reported as null, keeps the known rating');
        assert.equal(elements.ratingComment.value, 'Known comment');

        details.currentRating = 9;
        details.patchPersonalRating({ rating: 4 }, {});
        assert.equal(details.currentRating, 9, 'a late personal-state read cannot replace the choice on screen');
        assert.equal(details.currentPersonalRating.rating, 4);
        details.closeRatingModal();
        details.patchPersonalRating({ rating: 4 }, {});
        assert.equal(details.currentRating, 4, 'with the dialog closed it applies as before');

        read = deferred();
        details.currentPersonalRating = null;
        const closedOpening = details.showRatingModal(movie);
        details.closeRatingModal();
        assert.equal(body.inert, false, 'closing releases the lock');
        read.resolve({ id: 'late', rating: 3, comment: 'Late reply' });
        await closedOpening;
        assert.equal(dialog.style.display, 'none', 'a late reply does not reopen a closed dialog');
        assert.equal(elements.ratingComment.value, '', 'and does not fill it');
        assert.equal(details.currentPersonalRating, null);

        read = deferred();
        const stale = read;
        const firstOpening = details.showRatingModal(movie);
        read = deferred();
        const secondOpening = details.showRatingModal(movie);
        stale.resolve({ id: 'stale', rating: 2, comment: 'Stale reply' });
        await firstOpening;
        assert.equal(body.inert, true, 'a stale reply cannot unlock the newer opening');
        read.resolve({ id: 'fresh', rating: 6, comment: 'Fresh reply' });
        await secondOpening;
        assert.equal(body.inert, false);
        assert.equal(details.currentRating, 6);
        assert.equal(elements.ratingComment.value, 'Fresh reply');
        details.closeRatingModal();
    }

    // A running write locks the rating dialog: one press means one write, and
    // the dialog cannot be dismissed or edited until the write settles.
    {
        const saveButton = {
            disabled: false, focused: 0, attributes: {}, classes: new Set(),
            classList: { toggle: (name, on) => saveButton.classes[on ? 'add' : 'delete'](name) },
            setAttribute(name, value) { this.attributes[name] = value; },
            removeAttribute(name) { delete this.attributes[name]; },
            focus() { this.focused++; }
        };
        const body = { inert: false };
        const toasts = [];
        const realToast = context.Utils.showToast;
        context.Utils.showToast = (message, type) => toasts.push({ message, type });
        let writes = 0;
        let settle;
        firebase({
            getUserService: () => ({ getUserProfile: async () => ({ displayName: 'User' }) }),
            getRatingService: () => ({
                addOrUpdateRating: () => {
                    writes++;
                    return new Promise((resolve, reject) => { settle = { resolve, reject }; });
                }
            })
        });
        const details = manager();
        details.elements = {
            ratingComment: { value: '' }, ratingReview: { value: '' },
            saveRatingBtn: saveButton, cancelRatingBtn: { disabled: false }, ratingModalClose: { disabled: false },
            ratingModal: { style: { display: 'flex' }, querySelector: selector => (selector === '.rating-modal-body' ? body : null) }
        };
        details.selectedMovie = { kinopoiskId: 101 };
        details.currentRating = 8;
        details.originalRating = 0;
        details.originalRatingComment = '';
        details.originalRatingReview = '';
        const flush = () => new Promise(resolve => setImmediate(resolve));

        const failing = details.saveRating();
        const repeated = details.saveRating();
        await repeated;
        await flush();
        assert.equal(writes, 1, 'a second press while saving does not write again');
        assert.equal(saveButton.disabled, true);
        assert.equal(saveButton.classes.has('btn--pending'), true);
        assert.equal(saveButton.attributes['aria-busy'], 'true');
        assert.equal(details.elements.cancelRatingBtn.disabled, true);
        assert.equal(details.elements.ratingModalClose.disabled, true);
        assert.equal(body.inert, true, 'the choice cannot change during the write');
        details.closeRatingModal();
        assert.equal(details.elements.ratingModal.style.display, 'flex', 'a running write cannot be dismissed');

        settle.reject(new Error('Failed to save rating: offline'));
        await failing;
        assert.deepEqual(toasts, [{ message: 'ratings.toast.rating_save_error', type: 'error' }],
            'a failure is announced even with the review section collapsed, without technical text');
        assert.equal(saveButton.disabled, false);
        assert.equal(saveButton.classes.has('btn--pending'), false);
        assert.equal(saveButton.focused, 1, 'focus returns to the control that can retry');
        assert.equal(details.elements.cancelRatingBtn.disabled, false);
        assert.equal(body.inert, false);
        assert.equal(details.currentRating, 8, 'a failure keeps the chosen rating');
        assert.equal(details.elements.ratingModal.style.display, 'flex');

        toasts.length = 0;
        let refreshes = 0;
        details.loadPersonalState = async () => { refreshes++; throw new Error('refresh failed'); };
        const succeeding = details.saveRating();
        await flush();
        settle.resolve();
        await succeeding;
        assert.equal(writes, 2);
        assert.equal(details.isSavingRating, false);
        assert.equal(details.elements.ratingModal.style.display, 'none', 'a finished write closes the dialog');
        assert.equal(refreshes, 1);
        assert.deepEqual(toasts.map(toast => toast.type), ['success'],
            'a failed refresh after a stored write is not reported as a failed save');
        context.Utils.showToast = realToast;
    }

    // A partial first paint (cold start) is rerendered when the complete movie
    // fills its gaps, so backdrop, seasons and provider ratings do not need a reload.
    const gaps = context.window.MovieDetailsManager.fillsRenderGaps;
    const base = { kinopoiskId: 1, type: 'movie', rating: {} };
    assert.equal(gaps(base, { ...base, backdropUrl: 'https://image.test/b.jpg' }), true, 'backdrop appears');
    assert.equal(gaps(base, { ...base, type: 'tv-series' }), true, 'series type appears');
    assert.equal(gaps(base, { ...base, seasonsInfo: [{ number: 1 }] }), true, 'seasons appear');
    assert.equal(gaps(base, { ...base, rating: { kp: 8.1 } }), true, 'Kinopoisk rating appears');
    assert.equal(gaps(base, { ...base, imdbRating: 7.4 }), true, 'IMDb rating appears');
    const full = { kinopoiskId: 1, type: 'tv-series', backdropUrl: 'https://image.test/b.jpg', seasons: [{}], rating: { kp: 8, imdb: 7 } };
    assert.equal(gaps(full, { ...full }), false, 'a complete render is not repeated');
    assert.equal(gaps(null, full), false);

    // Same-movie enrichment starts seasons the partial pass skipped, once.
    const missed = Object.create(prototype);
    let seasonCalls = 0;
    let ratingCalls = 0;
    missed.renderEnrichmentSnapshot = { movieId: '7', providerRatingsSettled: true };
    missed.getRenderEnrichmentSnapshot = () => missed.renderEnrichmentSnapshot;
    missed.isPageContextCurrent = () => true;
    missed.resolveAndRenderSeasons = () => { seasonCalls++; };
    missed.loadProviderRatingsInBackground = () => { ratingCalls++; };
    missed.startMissedEnrichments({ kinopoiskId: 7, type: 'tv-series' }, {});
    missed.startMissedEnrichments({ kinopoiskId: 7, type: 'tv-series' }, {});
    assert.equal(seasonCalls, 1, 'seasons load once when the series type arrives late');
    assert.equal(ratingCalls, 1, 'a settled-empty ratings refresh is retried once with the complete movie');

    // Vote counts: a rating without any vote source triggers the delayed retry.
    const missingVotes = context.window.MovieDetailsManager.missingProviderVotes;
    assert.equal(missingVotes({ kpRating: 8.1, kpVotes: 0 }, {}, {}), true, 'KP rating without votes');
    assert.equal(missingVotes(null, { imdb: 7.2 }, {}), true, 'failed scrape leaves IMDb votes missing');
    assert.equal(missingVotes({ kpRating: 8.1, kpVotes: 1200, imdbRating: 7.9, imdbVotes: 900 }, {}, {}), false);
    assert.equal(missingVotes(null, { kp: 8.1 }, { kp: 1200 }), false, 'cached votes are enough');
    assert.equal(missingVotes(null, {}, {}), false, 'no rating, nothing to show');

    console.log('Movie Details loading reliability tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
