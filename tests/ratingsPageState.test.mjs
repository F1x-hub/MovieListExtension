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
    createElement: () => makeElement()
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

console.log('Ratings page state tests passed');
process.exit(0);
