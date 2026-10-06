// Behavioural tests for ratings page state handling: rater profile loading around
// auth restore, card signatures, saved filter restore, and filter reset.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- Minimal browser stubs (enough to import ratings.js and reach its class) ---
const domListeners = {};
const makeElement = () => ({
    value: '',
    innerHTML: '',
    textContent: '',
    style: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(name, value) { this[`attr:${name}`] = String(value); },
    getAttribute(name) { return this[`attr:${name}`] ?? null; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    dispatchEvent() {},
    querySelector: () => null,
    querySelectorAll: () => []
});
globalThis.window = globalThis;
globalThis.document = {
    addEventListener: (type, callback) => { domListeners[type] = callback; },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    createDocumentFragment: () => makeElement()
};
const storage = new Map();
globalThis.localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value))
};
globalThis.chrome = { storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } }, runtime: { getURL: p => p } };
globalThis.Utils = {
    normalizeRatingComment: value => (typeof value === 'string' ? value.trim() : ''),
    getDisplayName: profile => profile?.displayName || 'Unknown User',
    createPageStateManager: () => ({ showLoader() {}, showContent() {}, showError() {} }),
    bindMovieCardNavigation() {},
    bindSpoilerReveal() {}
};

let signedIn = false;
const profileDocs = { alice: { id: 'alice', displayName: 'Alice', photoURL: 'a.png' } };
globalThis.firebaseManager = {
    getCurrentUser: () => (signedIn ? { uid: 'alice' } : null),
    getUserService: () => ({
        // Mirrors UserService.getUserProfilesByIds: errors (signed out) resolve to []
        getUserProfilesByIds: async ids => (signedIn ? ids.map(id => profileDocs[id]).filter(Boolean) : [])
    })
};

process.on('unhandledRejection', () => {}); // init() runs against the stub DOM; ignore it
await import('../src/pages/ratings/ratings.js');
domListeners.DOMContentLoaded();
const RatingsPageManager = window.ratingsPage.constructor;

function createPage() {
    const page = Object.create(RatingsPageManager.prototype);
    page.userProfilesMap = new Map();
    page.fetchedProfileIds = new Set();
    page.availableCollections = [];
    page.movies = [];
    page.filters = { search: '', genre: '', year: '', avgRatingFrom: 1.0, avgRatingTo: 10.0, user: '', sort: 'date-desc' };
    page.elements = {};
    page.dropdowns = {};
    return page;
}

// 1. Profiles requested before auth is restored are retried, then shown.
{
    signedIn = false;
    const page = createPage();
    const card = { userId: 'alice', userName: 'Alice', userPhoto: 'a.png', movieId: 1, allRaters: [{ userId: 'alice' }] };
    page.movies = [card];

    await page.loadUserProfiles(page.movies);
    assert.equal(page.fetchedProfileIds.has('alice'), false, 'A failed (signed-out) lookup must not mark the profile as loaded');
    assert.equal(page.isUserInfoLoading(card), true, 'Card keeps its loading state while the profile is unknown');
    const loadingSignature = page.buildRenderSignature(card);

    signedIn = true;
    let repaints = 0;
    page.applyFilters = () => { repaints++; };
    await page.refreshMissingProfiles();
    assert.equal(page.userProfilesMap.get('alice')?.displayName, 'Alice', 'Missing profile is fetched once signed in');
    assert.equal(page.isUserInfoLoading(card), false);
    assert.equal(repaints, 1, 'Cards are repainted after missing profiles arrive');

    // Same name and photo as the fallback: the signature must still change, or the
    // diffing renderer would keep the skeleton markup.
    assert.notEqual(page.buildRenderSignature(card), loadingSignature, 'Signature reflects the loading state');

    repaints = 0;
    await page.refreshMissingProfiles();
    assert.equal(repaints, 0, 'Nothing to refresh means no repaint');
}

// 2. A signed-in lookup is conclusive: a user without a profile document is not a skeleton forever.
{
    signedIn = true;
    const page = createPage();
    const card = { userId: 'ghost', userName: 'Ghost', movieId: 2 };
    await page.loadUserProfiles([card]);
    assert.equal(page.fetchedProfileIds.has('ghost'), true);
    assert.equal(page.isUserInfoLoading(card), false, 'Profile-less user renders the fallback name, not a skeleton');
}

// 3/4. Saved filters restore the average rating slider (clamped and ordered).
{
    const page = createPage();
    page.elements = { avgRatingFrom: makeElement(), avgRatingTo: makeElement() };
    page.filters.avgRatingFrom = 8;
    page.filters.avgRatingTo = 3.5;
    page.restoreFilterUI();
    assert.equal(page.filters.avgRatingFrom, 3.5);
    assert.equal(page.filters.avgRatingTo, 8);
    assert.equal(page.elements.avgRatingFrom.value, 3.5, 'Slider shows the saved lower bound');
    assert.equal(page.elements.avgRatingTo.value, 8, 'Slider shows the saved upper bound');

    page.filters.avgRatingFrom = 'bad';
    page.filters.avgRatingTo = 42;
    page.restoreFilterUI();
    assert.equal(page.filters.avgRatingFrom, 1);
    assert.equal(page.filters.avgRatingTo, 10);
}

// 5. Rebuilt genre/year lists keep the active selection visible, even before its films load.
{
    const page = createPage();
    const restored = [];
    page.updateDropdownValue = (id, value) => restored.push([id, value]);
    page.elements = { genreFilter: makeElement(), yearFilter: makeElement() };
    page.filters.genre = 'драма';
    page.filters.year = '1981';
    page.movies = [{ movie: { year: 2012, genres: ['ужасы'] } }];

    page.populateGenreFilter();
    page.populateYearFilter();
    assert.deepEqual(restored, [['genreFilter', 'драма'], ['yearFilter', '1981']]);
    assert.ok(page.elements.yearFilter.children.some(option => option.value === '1981'), 'Active year stays selectable');
    assert.ok(page.elements.genreFilter.children.some(option => option.value === 'драма'), 'Active genre stays selectable');
}

// 6. "Сбросить" also resets the sort dropdown label and persists the defaults.
{
    const page = createPage();
    const updated = [];
    let reloadContext = null;
    page.updateDropdownValue = (id, value) => updated.push([id, value]);
    page.loadMovies = context => { reloadContext = context; };
    page.filters.sort = 'title-asc';
    page.clearFilters();
    assert.ok(updated.some(([id, value]) => id === 'sortFilter' && value === 'date-desc'), 'Sort label returns to the default');
    assert.equal(JSON.parse(localStorage.getItem('ratingsPageFilters')).sort, 'date-desc');
    assert.equal(reloadContext, 'filterChange');
}

// 7. While the average-rating range filter is active the client sorts like the server.
{
    const page = createPage();
    page.filters.sort = 'title-asc';
    assert.deepEqual(page.getServerSortParams(), { sortBy: 'date', sortDir: 'desc', clientOnly: true });

    page.filters.avgRatingFrom = 6;
    assert.equal(page.getEffectiveSortKey(), 'avg-rating-desc', 'Range filter fixes the sort to average rating');
    assert.deepEqual(page.getServerSortParams(), { sortBy: 'avg', sortDir: 'desc', clientOnly: false },
        'No "load every page" client sort while the server orders by avgRating');
    assert.equal(page.filters.sort, 'title-asc', "The user's own sort choice is kept for later");

    const movies = [
        { movieId: 1000, averageRating: 7, movie: { name: 'A' } },
        { movieId: 999, averageRating: 7, movie: { name: 'B' } },
        { movieId: 5, averageRating: 9, movie: { name: 'C' } }
    ];
    page.sortMovies(movies);
    // avgRating desc, then documentId desc as strings: '999' > '1000'
    assert.deepEqual(movies.map(m => m.movieId), [5, 999, 1000], 'Order matches orderBy(avgRating desc, documentId desc)');

    page.filters.avgRatingFrom = 1;
    assert.equal(page.getEffectiveSortKey(), 'title-asc', 'Clearing the filter restores the chosen sort');
}

// 8. Toasts and menu labels come from the locale files.
{
    const { locales } = await import('../src/shared/i18n/locales.js');
    const enKeys = Object.keys(locales.en.ratings.toast).sort();
    assert.deepEqual(Object.keys(locales.ru.ratings.toast).sort(), enKeys, 'ru/en toast keys match');
    assert.ok(locales.ru.ratings.sort.locked_by_avg_filter && locales.en.ratings.sort.locked_by_avg_filter);

    const page = createPage();
    assert.equal(page.t('favorite_added'), locales.en.ratings.toast.favorite_added);

    const active = fs.readFileSync(path.join(projectRoot, 'src/pages/ratings/ratings.js'), 'utf8');
    for (const key of enKeys) {
        assert.match(active, new RegExp(`this\\.t\\('${key}'\\)`), `toast key ${key} is used`);
    }
    assert.doesNotMatch(active, /Utils\.showToast\('[^']*'/, 'No hard-coded toast text in active handlers');
    assert.doesNotMatch(active, /\balert\(/, 'Rating errors use toasts, not alert()');
    assert.doesNotMatch(active, /(?:in)?active: '(?:Remove from|Add to) /, 'Menu labels are not hard-coded English');
}

// Dead code stays removed and remaining page texts are localized.
{
    const { locales } = await import('../src/shared/i18n/locales.js');
    const source = fs.readFileSync(path.join(projectRoot, 'src/pages/ratings/ratings.js'), 'utf8');
    const html = fs.readFileSync(path.join(projectRoot, 'src/pages/ratings/ratings.html'), 'utf8');

    for (const dead of ['enrichRatingsWithMovieData', 'toggleWatchlist(', 'showMovieDetails', 'closeModal(',
        'allRawRatings', 'currentMode', 'CACHE_LIFETIME', 'console.trace', 'some_suspicious_id', 'this.debug']) {
        assert.ok(!source.includes(dead), `Dead code stays removed: ${dead}`);
    }

    // Every ratings.* key the page and its HTML use exists in both locales
    const lookup = (locale, key) => key.split('.').reduce((node, part) => node?.[part], locales[locale].ratings);
    const usedKeys = new Set([
        ...[...source.matchAll(/this\.text\('([\w.]+)'/g)].map(m => m[1]),
        ...[...html.matchAll(/data-i18n="(?:\[[\w-]+\])?ratings\.([\w.]+)"/g)].map(m => m[1])
    ]);
    assert.ok(usedKeys.size > 20, 'Page texts go through the locale files');
    for (const key of usedKeys) {
        for (const locale of ['en', 'ru']) {
            assert.equal(typeof lookup(locale, key), 'string', `${locale}.ratings.${key} exists`);
        }
    }

    // No hard-coded UI sentences left in the page script
    for (const pattern of [/'Please sign in/, /Edit Rating:/, /'No comment'/, /`Search: /, /`Showing /, /'Все оценки'/,
        /`Firebase setup failed/, /'Loading timed out/, /'Unknown User'/]) {
        assert.doesNotMatch(source, pattern, `Hard-coded text removed: ${pattern}`);
    }

    // Placeholders are filled in
    const page = createPage();
    assert.equal(page.text('results.count', { count: 3, total: 8 }), 'Showing 3 of 8 movies');
    assert.equal(page.text('active_filters.rating', { from: '5.0', to: '9.0' }), 'Rating: 5.0 – 9.0');
}

// --- New ratings arriving while the page is open ---

// L1. A rating write keeps the Ratings page cache (only the popup cache is dropped).
{
    const removed = [];
    const previousChrome = globalThis.chrome;
    globalThis.chrome = { ...previousChrome, storage: { ...previousChrome.storage, local: {
        get: async () => { throw new Error('must not read all of chrome.storage.local'); },
        remove: async keys => { removed.push(keys); }
    } } };
    const { default: RatingService } = await import('../src/shared/services/RatingService.js');
    await new RatingService({ db: null }).invalidateRatingsCache('alice');
    assert.deepEqual(removed, ['recent_ratings_cache', 'home_rating_stats_v1_alice'], 'ratings_cache_{uid} survives a rating write; Home statistics are refreshed');
    globalThis.chrome = previousChrome;
}

function createLivePage() {
    const page = createPage();
    page.BATCH_SIZE = 8;
    page.currentRequestId = 1;
    page.pendingLiveMovies = new Map();
    page.recentLocalEdits = new Map();
    page.liveSeenTimestamps = null;
    page.liveBaselineMinTs = 0;
    page.elements = { livePill: makeElement(), livePillText: makeElement() };
    page.elements.livePill.hidden = true;
    return page;
}
const doc = (id, seconds, extra = {}) => ({ id: String(id), kinopoiskId: id, lastRatingUpdatedAt: { seconds }, ...extra });

// L2. Listener: baseline ignored, fresh ratings queued, slide-ins and own edits skipped.
{
    const page = createLivePage();
    let processed = 0;
    page.processPendingLiveMovies = () => { processed++; };

    page.handleLiveSnapshot([doc(1, 300), doc(2, 200), doc(3, 100)]);
    assert.equal(page.pendingLiveMovies.size, 0, 'The first snapshot is the state already on screen');

    page.recentLocalEdits.set('5', Date.now());
    page.handleLiveSnapshot([doc(4, 400), doc(5, 390), doc(1, 300), doc(2, 200), doc(6, 50)]);
    assert.deepEqual([...page.pendingLiveMovies.keys()], ['4'], 'Only the genuinely new rating is queued');
    assert.equal(processed, 1);

    page.handleLiveSnapshot([doc(4, 400), doc(1, 300)]);
    assert.equal(processed, 1, 'An unchanged snapshot queues nothing');
    page.handleLiveSnapshot([doc(2, 500), doc(4, 400)]);
    assert.ok(page.pendingLiveMovies.has('2'), 'A re-rated loaded film is queued again');
}

// L3. Insert directly at the top of the default list, otherwise show the pill.
{
    const page = createLivePage();
    let applied = 0;
    page.applyPendingLiveMovies = () => { applied++; };
    page.pendingLiveMovies.set('7', doc(7, 700));

    globalThis.scrollY = 0;
    document.hidden = false;
    page.processPendingLiveMovies();
    assert.equal(applied, 1, 'At the top of "newest first" the film is inserted directly');

    globalThis.scrollY = 900;
    page.processPendingLiveMovies();
    assert.equal(applied, 1, 'Scrolled down: no grid shift');
    assert.equal(page.elements.livePill.hidden, false, 'The pill appears instead');
    assert.equal(page.elements.livePillText.textContent, 'New ratings: 1 · Show');

    globalThis.scrollY = 0;
    page.filters.sort = 'title-asc';
    page.processPendingLiveMovies();
    assert.equal(applied, 1, 'Other sorts never reorder on their own');
    page.filters.sort = 'date-desc';

    document.hidden = true;
    page.processPendingLiveMovies();
    assert.equal(applied, 1, 'A hidden tab waits for the user to come back');
    document.hidden = false;
}

// L4. Applying live films merges them by ID, marks them, and keeps the cache current.
{
    const page = createLivePage();
    page.movies = [{ movieId: 1, movie: { kinopoiskId: 1, name: 'Old' } }];
    page.pendingLiveMovies.set('1', doc(1, 900));
    page.pendingLiveMovies.set('9', doc(9, 950));
    page.liveSeenTimestamps = new Map();
    const marked = [];
    let saved = null;
    globalThis.firebaseManager.getMovieCacheService = () => ({ mergeMovieMetadata: (primary, fallback) => ({ ...fallback, ...primary }) });
    globalThis.firebaseManager.getRatingService = () => ({});
    page.enrichMoviePage = async movies => movies.map(m => ({
        movieId: Number(m.kinopoiskId), movie: { ...m, name: `Film ${m.kinopoiskId}` }, allRaters: []
    }));
    page.extractAndPopulateUsers = () => {};
    page.populateYearFilter = () => {};
    page.populateGenreFilter = () => {};
    page.applyFilters = () => { page.filteredMovies = [...page.movies]; };
    page.saveRatingsToCache = items => { saved = items; };
    page.highlightMovies = keys => marked.push(...keys);
    page.hydrateMissingMetadata = () => {}; // covered separately below

    await page.applyPendingLiveMovies();
    assert.deepEqual(page.movies.map(m => m.movieId).sort(), [1, 9], 'Existing film replaced, new film added once');
    assert.equal(page.movies.find(m => m.movieId === 1).movie.name, 'Film 1');
    assert.deepEqual(marked.sort(), ['1', '9'], 'Both films get the "new" mark');
    assert.ok(saved, 'Default first screen cache is refreshed');
    assert.equal(page.pendingLiveMovies.size, 0);
    assert.equal(page.elements.livePill.hidden, true);

    // A server page that returns a live-inserted film again does not duplicate it
    page.mergeMoviesById([{ movieId: 9, movie: { kinopoiskId: 9 } }]);
    assert.equal(page.movies.filter(m => m.movieId === 9).length, 1);
}

// L5. Returning to the page re-reads the first page and queues only real changes.
{
    const page = createLivePage();
    page.movies = [
        { movieId: 1, ratingsCount: 2, movie: { kinopoiskId: 1, lastRatingUpdatedAt: { seconds: 100 } } },
        { movieId: 2, ratingsCount: 1, movie: { kinopoiskId: 2, lastRatingUpdatedAt: { seconds: 100 } } },
        { movieId: 3, ratingsCount: 1, movie: { kinopoiskId: 3, lastRatingUpdatedAt: { seconds: 100 } } }
    ];
    page.recentLocalEdits.set('3', Date.now());
    page.processPendingLiveMovies = () => {};
    globalThis.firebaseManager.getMovieCacheService = () => ({
        getMoviesByAvgRating: async () => ({ movies: [
            doc(8, 400, { ratingsCount: 1 }), // new film
            doc(1, 100, { ratingsCount: 2 }), // unchanged
            doc(2, 300, { ratingsCount: 2 }), // re-rated by someone
            doc(3, 350, { ratingsCount: 1 }) // the user's own edit from this page
        ] })
    });
    await page.revalidateFirstPage();
    assert.deepEqual([...page.pendingLiveMovies.keys()].sort(), ['2', '8']);
}

// L6. A comment-only edit keeps the card's position; a new score moves it.
{
    const makeSavePage = () => {
        const page = createLivePage();
        page.currentUser = { uid: 'alice' };
        const createdAt = new Date('2026-01-01T00:00:00Z');
        page.movies = [{
            movieId: 5, rating: 7, myRating: 7, myComment: 'ok', createdAt,
            allRaters: [{ userId: 'alice', rating: 7, comment: 'ok' }],
            movie: { kinopoiskId: 5, name: 'Film', lastRatingUpdatedAt: createdAt }
        }];
        page.selectedMovie = page.movies[0].movie;
        page.elements = { ...page.elements, ratingSlider: { value: '7' }, ratingComment: { value: 'better words' }, ratingModal: { style: {} } };
        page.applyFilters = () => {};
        return { page, createdAt };
    };
    globalThis.Utils.showToast = () => {};
    globalThis.firebaseManager.getRatingService = () => ({ addOrUpdateRating: async () => ({ id: 'alice_5' }) });
    globalThis.firebaseManager.getUserService = () => ({ getUserProfile: async () => ({ displayName: 'Alice' }) });

    const commentOnly = makeSavePage();
    await commentOnly.page.saveRating();
    const item = commentOnly.page.movies[0];
    assert.equal(item.myComment, 'better words');
    assert.equal(item.createdAt, commentOnly.createdAt, 'Comment-only edit keeps the sort date');
    assert.equal(item.movie.lastRatingUpdatedAt, commentOnly.createdAt);
    assert.equal(commentOnly.page.recentLocalEdits.has('5'), false, 'The server will not report a comment-only edit');

    const newScore = makeSavePage();
    newScore.page.elements.ratingSlider.value = '9';
    await newScore.page.saveRating();
    assert.notEqual(newScore.page.movies[0].createdAt, newScore.createdAt, 'A new score moves the card to the top');
    assert.equal(newScore.page.recentLocalEdits.has('5'), true, 'Its listener echo will not be marked as new');
}

// --- Films whose movie document has no title/poster ---

// M1. A first rating stores the film metadata in Firestore even before the
// aggregate trigger has marked the document as community-rated.
{
    const { default: MovieCacheService } = await import('../src/shared/services/MovieCacheService.js');
    const writes = [];
    const localWrites = [];
    const fakeDb = {
        collection: () => ({
            doc: id => ({
                get: async () => ({ exists: false, data: () => ({}) }),
                set: async (data, options) => writes.push({ id, data, options })
            })
        })
    };
    globalThis.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS' } } };
    const service = new MovieCacheService({ db: fakeDb });
    service.setLocalMovieCache = async (id, data) => localWrites.push({ id, data });
    service.saveToLocalStorage = () => {};

    await service.cacheMovie({ kinopoiskId: 77, name: 'Вавилон', posterUrl: 'p.jpg', avgRating: 9 }, true);
    assert.equal(writes.length, 1, 'isRated writes to Firestore before hasCommunityRating exists');
    assert.equal(writes[0].id, '77');
    assert.equal(writes[0].data.name, 'Вавилон');
    assert.equal('avgRating' in writes[0].data, false, 'Aggregate fields are never written by the client');
    assert.deepEqual(writes[0].options, { merge: true });

    await service.cacheMovie({ kinopoiskId: 78, name: 'Unrated', posterUrl: 'p.jpg' });
    assert.equal(writes.length, 1, 'Unrated films still stay out of Firestore');
    assert.equal(localWrites[0].id, '78');
    globalThis.MovieCacheService = MovieCacheService;
}

// M2. The ratings page fills such cards from local caches, then the Kinopoisk API,
// stores the metadata (isRated), and tries each film only once.
{
    const page = createLivePage();
    page.movies = [
        { movieId: 1, movie: { kinopoiskId: 1, avgRating: 6, ratingsCount: 1 } },
        { movieId: 2, movie: { kinopoiskId: 2, avgRating: 5, ratingsCount: 1 } },
        { movieId: 3, movie: { kinopoiskId: 3, name: 'Complete', posterUrl: 'c.jpg' } }
    ];
    const stored = [];
    const apiCalls = [];
    let repaints = 0;
    globalThis.firebaseManager.getMovieCacheService = () => ({
        // The Firestore documents are the incomplete ones: only local caches are read
        getBatchCachedMovies: async () => {
            throw new Error('Hydration must not re-read the incomplete Firestore documents');
        },
        getLocalCachedMovies: async ids => {
            assert.deepEqual(ids, ['1', '2'], 'Only incomplete films are looked up');
            return { 1: { kinopoiskId: 1, name: 'Local film', posterUrl: 'l.jpg' } };
        },
        cacheMovie: async (movie, isRated) => { stored.push({ id: movie.kinopoiskId, name: movie.name, isRated }); }
    });
    globalThis.firebaseManager.getKinopoiskService = () => ({
        getMovieById: async id => { apiCalls.push(id); return { kinopoiskId: id, name: 'API film', posterUrl: 'a.jpg', genres: ['драма'] }; }
    });
    page.populateYearFilter = () => {};
    page.populateGenreFilter = () => {};
    page.applyFilters = () => { repaints++; page.filteredMovies = [...page.movies]; };
    page.saveRatingsToCache = () => {};

    await page.hydrateMissingMetadata();
    assert.deepEqual(apiCalls, [2], 'The API is used only for films missing from local caches');
    assert.equal(page.movies[0].movie.name, 'Local film');
    assert.equal(page.movies[1].movie.name, 'API film');
    assert.equal(page.movies[1].movie.avgRating, 5, 'Aggregates on the card are kept');
    assert.deepEqual(stored.sort((a, b) => a.id - b.id), [
        { id: 1, name: 'Local film', isRated: true },
        { id: 2, name: 'API film', isRated: true }
    ], 'Both films are repaired in Firestore');
    assert.equal(repaints, 1, 'Cards are repainted once');

    page.movies[1].movie.name = '';
    await page.hydrateMissingMetadata();
    assert.deepEqual(apiCalls, [2], 'A film is tried at most once per page session');

    const source = fs.readFileSync(path.join(projectRoot, 'src/pages/ratings/ratings.js'), 'utf8');
    assert.match(source, /card\.classList\.contains\('mc-is-loading'\) && !newCardHTML\.classList\.contains\('mc-is-loading'\)[\s\S]{0,400}card\.replaceWith\(newCardHTML\)/,
        'A placeholder card is replaced as a whole once metadata arrives');
    for (const call of ['this.hydrateMissingMetadata(enrichedMovies)', 'this.hydrateMissingMetadata(enrichedBatch)', 'this.hydrateMissingMetadata(enriched)']) {
        assert.ok(source.includes(call), `Hydration runs after: ${call}`);
    }
}

// 3. Init restores saved filters before the cached render, which persists filters.
{
    const source = fs.readFileSync(path.join(projectRoot, 'src/pages/ratings/ratings.js'), 'utf8');
    const initBody = source.slice(source.indexOf('async init() {'), source.indexOf('initializeElements() {'));
    assert.ok(
        initBody.indexOf('this.loadFiltersFromStorage()') < initBody.indexOf('await this.loadCachedRatings()'),
        'Saved filters load before the cached render'
    );
    assert.ok(
        initBody.indexOf('this.initializeCustomDropdowns()') < initBody.indexOf('this.loadFiltersFromStorage()'),
        'Dropdowns exist before saved filters update their labels'
    );
}

// H1. A double click on "Save" writes once; a failed write restores only that card.
{
    const page = createPage();
    page.currentUser = { uid: 'alice' };
    page.recentLocalEdits = new Map();
    page.renderedMoviesState = new Map();
    page.userProfilesMap.set('alice', { id: 'alice', displayName: 'Alice', photoURL: 'a.png' });
    page.elements = {
        ratingSlider: { value: '9' },
        ratingComment: { value: 'Great' },
        ratingModal: makeElement(),
        saveRatingBtn: makeElement()
    };
    page.t = key => key;
    page.applyFilters = () => {};
    globalThis.Utils.showToast = () => {};
    const original = { movieId: 1, movie: { kinopoiskId: 1, name: 'A' }, rating: 5, myRating: 5, allRaters: [{ userId: 'alice', rating: 5 }] };
    page.movies = [original, { movieId: 2, movie: { kinopoiskId: 2, name: 'B' } }];

    let writes = 0;
    let rejectWrite;
    globalThis.firebaseManager.getRatingService = () => ({
        addOrUpdateRating: () => {
            writes++;
            return new Promise((resolve, reject) => { rejectWrite = reject; });
        }
    });
    let profileReads = 0;
    globalThis.firebaseManager.getUserService = () => ({ getUserProfile: async () => { profileReads++; return null; } });

    page.selectedMovie = original.movie;
    const firstSave = page.saveRating();
    const secondSave = page.saveRating();
    await Promise.all([firstSave, secondSave]);
    assert.equal(writes, 1, 'A repeated click while saving does not write twice');
    assert.equal(profileReads, 0, 'The already loaded profile is reused instead of re-read on every save');
    assert.equal(page.movies[0].myRating, 9, 'The card updates optimistically');

    // A page arriving while the write is in flight must survive the rollback
    page.movies.push({ movieId: 3, movie: { kinopoiskId: 3, name: 'C' } });
    rejectWrite(new Error('offline'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(page.movies.map(item => item.movieId), [1, 2, 3], 'Other cards and later pages are kept');
    assert.equal(page.movies[0].myRating, 5, 'The failed card returns to its previous rating');
    assert.equal(page.movies[0].allRaters[0].rating, 5);
    assert.equal(page.isSavingRating, false);
}

// H2. Client-only sorts read large pages and render the full list once.
{
    const page = createPage();
    page.currentRequestId = 1;
    page.CLIENT_SORT_BATCH_SIZE = 40;
    page.filters.sort = 'title-asc';
    page.hasMore = true;
    page.lastMovieDoc = null;
    page.elements = {};
    const calls = [];
    let renders = 0;
    page.loadNextBatch = async options => {
        calls.push(options);
        page.lastMovieDoc = { page: calls.length };
        page.hasMore = calls.length < 3;
    };
    page.refreshFilterOptionsAndRender = () => { renders++; };
    await page.loadAllForClientSort();
    assert.equal(calls.length, 3);
    assert.ok(calls.every(options => options.limit === 40 && options.render === false), 'Bulk pages skip per-page renders');
    assert.equal(renders, 1, 'The complete list renders once');
    assert.equal(page.bulkLoading, false);
}

// H3. Filter option lists are rebuilt only when their values change.
{
    const page = createPage();
    const list = makeElement();
    page.dropdowns = { yearFilter: { list, hiddenSelect: makeElement(), trigger: makeElement(), optionsKey: null } };
    const select = makeElement();
    const items = [{ value: '2001', label: '2001' }];
    assert.equal(page.setDropdownOptions('yearFilter', select, 'All', items), true);
    assert.equal(page.setDropdownOptions('yearFilter', select, 'All', items), false, 'Unchanged options are not rebuilt');
    assert.equal(page.setDropdownOptions('yearFilter', select, 'All', [...items, { value: '1999', label: '1999' }]), true);
}

console.log('Ratings page state tests passed');
process.exit(0);
