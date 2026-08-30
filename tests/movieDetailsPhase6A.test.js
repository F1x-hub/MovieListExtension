const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8')
    .replace(/^import .*;\r?$/gm, '');

const documentStub = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} })
};

const windowStub = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { search: '' }
};

const context = vm.createContext({
    window: windowStub,
    document: documentStub,
    console,
    URLSearchParams,
    Promise,
    Set,
    Map,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Date,
    Math,
    parseInt,
    parseFloat,
    setTimeout,
    clearTimeout
});
vm.runInContext(source, context);

const MovieDetailsManager = context.window.MovieDetailsManager;
const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
};

function managerFor(movieId) {
    const manager = Object.create(MovieDetailsManager.prototype);
    manager.pageGeneration = 0;
    manager.activePageContext = null;
    manager.selectedMovie = { kinopoiskId: movieId, name: `Movie ${movieId}` };
    manager.beginPageGeneration(movieId);
    return manager;
}

(async () => {
    console.log('🧪 Running MovieDetails Phase 6A lifecycle tests...');

    {
        const manager = managerFor(101);
        const a = manager.capturePageContext();
        manager.beginPageGeneration(202);
        manager.selectedMovie = { kinopoiskId: 202 };
        assert.strictEqual(manager.isPageContextCurrent(a), false, 'new movie must invalidate Movie A context');
        const sameMovie = manager.capturePageContext();
        manager.beginPageGeneration(202);
        assert.strictEqual(manager.isPageContextCurrent(sameMovie), true, 'same-movie rerender must preserve generation');
        manager.invalidatePageGeneration();
        assert.strictEqual(manager.isPageContextCurrent(sameMovie), false, 'unload invalidation must reject late writes');
        console.log('  ✅ page generation lifecycle and unload invalidation');
    }

    {
        const manager = managerFor(101);
        const pending = deferred();
        let renders = 0;
        manager.trailerService = { getTrailer: () => pending.promise };
        manager.renderTrailerBlock = () => { renders += 1; };
        const task = manager.loadTrailerFallback(101, false, manager.capturePageContext());
        manager.beginPageGeneration(202);
        manager.selectedMovie = { kinopoiskId: 202 };
        pending.resolve({ key: 'old-trailer' });
        await task;
        assert.strictEqual(renders, 0, 'stale trailer fallback must not render into Movie B');
        console.log('  ✅ stale trailer fallback is discarded');
    }

    {
        const manager = managerFor(101);
        const pending = deferred();
        let updates = 0;
        manager.updateAwardsUI = () => { updates += 1; };
        context.AwardsParsingService = class { getAwards() { return pending.promise; } };
        const movie = { kinopoiskId: 101 };
        const task = manager.loadAwardsInBackground(101, movie, manager.capturePageContext(movie));
        manager.beginPageGeneration(202);
        manager.selectedMovie = { kinopoiskId: 202 };
        pending.resolve([{ name: 'Old award' }]);
        await task;
        assert.strictEqual(updates, 0, 'stale awards result must not mutate Movie B DOM');
        console.log('  ✅ stale awards enrichment is discarded');
    }

    {
        const manager = managerFor(101);
        const pending = deferred();
        let renders = 0;
        manager.seasonsService = { getSeasons: () => pending.promise };
        manager.renderSeasonsTab = () => { renders += 1; return ''; };
        manager.progressService = null;
        manager.episodeHistoryService = null;
        const task = manager.loadSeasonsFallback(101, manager.capturePageContext());
        manager.beginPageGeneration(202);
        manager.selectedMovie = { kinopoiskId: 202 };
        pending.resolve([{ number: 1, episodeCount: 8 }]);
        await task;
        assert.strictEqual(renders, 0, 'stale seasons fallback must not render into Movie B');
        console.log('  ✅ stale seasons fallback is discarded');
    }

    {
        const manager = managerFor(101);
        const loading = { style: { display: 'flex' } };
        const content = { innerHTML: '', querySelector: () => ({ id: 'ratings-list' }) };
        const section = {
            dataset: { movieId: '101' },
            querySelector: (selector) => selector === '.user-ratings-loading' ? loading : content
        };
        documentStub.getElementById = (id) => id === 'userRatingsSection' ? section : null;
        manager._userProfileCache = new Map();
        manager.commentReactionSummaries = new Map();
        manager.commentUserReactions = new Map();
        manager.createUserRatingsSection = (ratings) => `<div>${ratings[0].comment}</div>`;
        manager.setupUsernameClickListeners = () => {};
        manager.latestRatingsSnapshotMovieId = '101';
        manager.latestRatingsSnapshotUser = { uid: 'user-1' };
        manager.latestRatingsSnapshot = [{ id: 'rating-1', comment: 'Visible after rerender' }];

        assert.strictEqual(manager.rehydrateRatingsForCurrentRender(101), true);
        assert.strictEqual(content.innerHTML, '<div>Visible after rerender</div>');
        assert.strictEqual(loading.style.display, 'none');
        console.log('  ✅ same-movie DOM replacement rehydrates the active ratings section');
    }

    assert(source.includes('recommendationsState = { movieId: null, status: \'idle\', data: null }'), 'recommendation state must distinguish request/data state');
    assert(source.includes('franchiseState = { movieId: null, status: \'idle\', data: null }'), 'franchise state must distinguish request/data state');
    assert(!source.includes('if (this.recommendationsLoadedForMovieId === movieId) return;'), 'old recommendation loaded marker must not block rerender');
    assert(!source.includes('if (this.franchiseLoadedForMovieId === movieId) return;'), 'old franchise loaded marker must not block rerender');
    console.log('  ✅ same-movie related sections reuse ready data instead of hanging skeletons');

    assert(source.includes("rootMargin: '0px 96px'"), 'deferred recommendation posters must preload only one narrow card-width ahead');
    assert(!source.includes("rootMargin: '0px 320px'"), 'deferred recommendation posters must not activate the whole short carousel on first paint');
    console.log('  ✅ deferred recommendation posters stay outside the initial decode burst');

    const progressHandlerStart = source.indexOf("event.data.type === 'UPDATE_WATCHING_PROGRESS'");
    const progressHandlerEnd = source.indexOf("event.data.type === 'EPISODE_CHANGED'", progressHandlerStart);
    const progressHandler = source.slice(progressHandlerStart, progressHandlerEnd);
    assert(progressHandler.includes('this.playbackController.handleProgressUpdate'), 'controller must receive progress updates');
    assert(!progressHandler.includes('this.progressService.saveProgress'), 'MovieDetails must not duplicate controller persistence');
    console.log('  ✅ one progress event has one persistence owner: PlaybackController');

    console.log('🎉 MovieDetails Phase 6A lifecycle tests passed!');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
