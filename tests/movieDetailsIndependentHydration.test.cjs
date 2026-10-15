const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const baseline = process.argv.includes('--baseline');

const context = vm.createContext({
    window: { location: { search: '?movieId=101' } }, document: { addEventListener() {} },
    URLSearchParams, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    isSeriesMedia: () => true,
    chrome: { storage: { local: { set: () => new Promise(() => {}) } } }
});
vm.runInContext((baseline ? require('node:child_process').execFileSync('git', ['show', 'HEAD:src/pages/movie-details/movie-details.js'], { encoding: 'utf8' })
    : fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8'))
    .replace(/^import .*;\r?$/gm, ''), context);
const prototype = context.window.MovieDetailsManager.prototype;
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
    const reads = Object.fromEntries(['profile', 'collections', 'rating', 'bookmark', 'episodes']
        .map(key => [key, deferred()]));
    context.firebaseManager = {
        getUserService: () => ({ getUserProfile: () => reads.profile.promise }),
        getRatingService: () => ({ getRating: () => reads.rating.promise }),
        getFavoriteService: () => ({ getBookmark: () => reads.bookmark.promise }),
        getSeriesEpisodeRatingService: () => ({ getEpisodeRatings: () => reads.episodes.promise })
    };
    context.CollectionService = class { getCollections() { return reads.collections.promise; } };
    const patches = [];
    const manager = Object.assign(Object.create(prototype), {
        authVerified: true, currentUser: { uid: 'user-a' }, selectedMovie: { kinopoiskId: 101 },
        capturePageContext: () => ({ kinopoiskId: '101' }),
        isPageContextCurrent: ctx => ctx.kinopoiskId === String(manager.selectedMovie.kinopoiskId),
        patchAdminControl: value => patches.push(['profile', value]),
        patchCollectionsMenu: () => patches.push(['collections']),
        patchPersonalRating: value => patches.push(['rating', value]),
        patchBookmarkState: value => patches.push(['bookmark', value]),
        patchSeriesEpisodeRatings: value => patches.push(['episodes', value]),
        updateSeriesEpisodeRatingUI: () => patches.push(['episode-error'])
    });
    return { manager, reads, patches };
}

(async () => {
    if (!baseline) {
    const f = fixture();
    const loading = f.manager.loadPersonalState(101);
    f.reads.rating.resolve({ rating: 8 });
    f.reads.bookmark.resolve({ status: 'watching' });
    await flush();
    assert.deepEqual(f.patches.map(p => p[0]), ['rating', 'bookmark'],
        'ready rating/bookmark must render while unrelated collections and episodes remain pending');
    f.reads.profile.resolve({ isAdmin: true });
    await flush();
    assert.equal(f.patches.at(-1)[0], 'profile', 'admin cache persistence must not block its UI patch');
    f.reads.collections.resolve([]);
    f.reads.episodes.reject(Object.assign(Error('denied'), { code: 'permission-denied' }));
    await loading;
    assert(f.patches.some(p => p[0] === 'episode-error'));

    for (const change of ['movie', 'user', 'newer-read']) {
        const stale = fixture();
        const request = stale.manager.loadPersonalState(101);
        if (change === 'movie') stale.manager.selectedMovie = { kinopoiskId: 202 };
        if (change === 'user') stale.manager.currentUser = { uid: 'user-b' };
        let newer;
        if (change === 'newer-read') newer = stale.manager.loadPersonalState(101);
        stale.reads.rating.resolve({ rating: 5 });
        await flush();
        assert.equal(stale.patches.length, change === 'newer-read' ? 1 : 0,
            `${change}: stale personal reads must not patch the page`);
        for (const key of ['profile', 'collections', 'bookmark', 'episodes']) stale.reads[key].resolve(null);
        await request;
        if (newer) await newer;
    }
    }
    // Cold metadata becomes usable while optional identity/TMDB enrichment is
    // still pending. Its final full render restores personal state without reads.
    const early = fixture();
    early.manager.selectedMovie = null;
    const optional = deferred();
    let base, reads = 0, finished = false;
    const originalRatingRead = context.firebaseManager.getRatingService;
    context.firebaseManager.getRatingService = () => ({ getRating: () => {
        reads++;
        return originalRatingRead().getRating();
    } });
    Object.assign(context.firebaseManager, {
        getMediaAggregatorService: () => ({ getMovieDetails: (id, options) => {
            base = options.onBaseMovie;
            return optional.promise;
        } }),
        getKinopoiskService: () => ({}), getMovieCacheService: () => ({})
    });
    Object.assign(early.manager, {
        beginPageGeneration: () => ({ kinopoiskId: '101' }),
        isPageContextCurrent: ctx => ctx.kinopoiskId === '101',
        page: { showLoader() {}, hideLoader() {}, showError(error) { throw error; } },
        elements: { movieDetailsContainer: { innerHTML: '' } },
        displayMovieDetails: async function(movie) {
            this.selectedMovie = movie;
            early.patches.length = 0;
            this.rehydratePersonalState?.();
        },
        logFranchiseDebug() {}, loadAwardsInBackground() {}, loadFramesInBackground() {},
        preloadSources() {}, startPostRenderEnrichment() {},
        patchFranchiseSection() {}, patchRelatedRelations() {}
    });
    const load = early.manager.loadMovieById(101).then(() => { finished = true; });
    base({ kinopoiskId: 101 });
    await flush();
    early.reads.rating.resolve({ rating: 8 });
    early.reads.bookmark.resolve({ status: 'watchlist' });
    await flush();
    assert.equal(finished, false);
    assert.equal(reads, baseline ? 0 : 1);
    assert.deepEqual(early.patches.map(p => p[0]), baseline ? [] : ['rating', 'bookmark']);
    optional.resolve({ kinopoiskId: 101, tmdbId: 202, logoUrl: 'logo.jpg' });
    await load;
    await flush();
    if (baseline) {
        assert.equal(reads, 1, 'baseline starts personal requests only after optional metadata settles');
        assert.deepEqual(early.patches, [], 'baseline still withholds ready controls behind other personal requests');
        console.log('HEAD baseline: 0 personal reads and 0 ready controls before optional metadata; ready controls remain blocked by unrelated personal reads afterward');
        for (const key of ['profile', 'collections', 'episodes']) early.reads[key].resolve(null);
        return;
    }
    assert.deepEqual(early.patches.map(p => p[0]), ['rating', 'bookmark'],
        'final metadata rerender restores ready personal controls');
    assert.equal(reads, 1, 'optional metadata completion must not repeat personal reads');
    early.manager.currentUser = { uid: 'user-b' };
    early.patches.length = 0;
    early.manager.rehydratePersonalState();
    assert.equal(early.patches.length, 0, 'previous user snapshot is never restored');
    early.manager.currentUser = { uid: 'user-a' };
    early.manager.authVerified = false;
    early.manager.rehydratePersonalState();
    assert.equal(early.patches.length, 0, 'unverified auth cannot restore personal state');
    early.manager.selectedMovie = null;
    const preAuthOptional = deferred();
    context.firebaseManager.getMediaAggregatorService = () => ({ getMovieDetails: (id, options) => {
        options.onBaseMovie({ kinopoiskId: 101 });
        return preAuthOptional.promise;
    } });
    const preAuthLoad = early.manager.loadMovieById(101);
    await flush();
    assert.equal(reads, 1, 'base metadata must not start personal requests before verified auth');
    preAuthOptional.resolve({ kinopoiskId: 101 });
    await preAuthLoad;
    assert.equal(reads, 1, 'completed aggregation must not start personal reads before verified auth');
    for (const key of ['profile', 'collections', 'episodes']) early.reads[key].resolve(null);
    console.log('Independent Movie Details hydration: ready controls, slow storage, denial and stale reads passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
