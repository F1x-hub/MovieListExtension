// Behaviour of the Rated page additions: the "My rating" filter (including its
// effect on the first-screen cache and full-list loading) and URL-mirrored filters.
import assert from 'node:assert/strict';

const domListeners = {};
const makeElement = () => ({
    value: '', innerHTML: '', textContent: '', style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, appendChild(child) { return child; },
    addEventListener() {}, dispatchEvent() {}, querySelector: () => null, querySelectorAll: () => []
});
globalThis.window = globalThis;
globalThis.document = {
    addEventListener: (type, callback) => { domListeners[type] = callback; },
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => makeElement(), createDocumentFragment: () => makeElement()
};
const storage = new Map();
globalThis.localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value))
};
globalThis.chrome = { storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } }, runtime: { getURL: p => p } };
globalThis.Utils = { createPageStateManager: () => ({ showLoader() {}, showContent() {}, showError() {} }) };
globalThis.firebaseManager = { getCurrentUser: () => null };

let currentUrl = 'https://ext.test/src/pages/ratings/ratings.html?collection=abc';
const historyWrites = [];
Object.defineProperty(globalThis, 'location', {
    configurable: true,
    get: () => ({ href: currentUrl, search: new URL(currentUrl).search })
});
globalThis.history = {
    state: null,
    replaceState(state, title, url) { historyWrites.push(String(url)); currentUrl = String(url); }
};

process.on('unhandledRejection', () => {}); // init() runs against the stub DOM; ignore it
await import('../src/pages/ratings/ratings.js');
domListeners.DOMContentLoaded();
const RatingsPageManager = window.ratingsPage.constructor;

const defaults = () => ({ search: '', genre: '', year: '', avgRatingFrom: 1.0, avgRatingTo: 10.0, user: '', myRating: '', sort: 'date-desc' });
function createPage(overrides = {}) {
    const page = Object.create(RatingsPageManager.prototype);
    page.filters = { ...defaults(), ...overrides };
    page.elements = { sortFilter: { options: [{ value: 'date-desc' }, { value: 'rating-desc' }, { value: 'title-asc' }] } };
    page.dropdowns = {};
    page.movies = [];
    return page;
}
const film = (id, myRating) => ({ movieId: id, myRating, movie: { name: `Film ${id}` }, averageRating: 7 });

// Range parsing accepts only the offered shapes.
{
    const page = createPage();
    assert.deepEqual(page.parseMyRatingRange('9-10'), { from: 9, to: 10 });
    assert.deepEqual(page.parseMyRatingRange('none'), { none: true });
    assert.equal(page.parseMyRatingRange(''), null);
    assert.equal(page.parseMyRatingRange('<script>'), null);
}

// The filter keeps the matching own scores; "none" keeps films without my score.
{
    const page = createPage();
    page.movies = [film(1, 10), film(2, 7), film(3, 0), film(4, 9)];
    page.sortMovies = () => {};
    page.renderMovies = () => {};
    page.updateResultsInfo = () => {};
    page.renderActiveTags = () => {};
    page.filters.myRating = '9-10';
    page.applyFilters();
    assert.deepEqual(page.filteredMovies.map(movie => movie.movieId), [1, 4]);
    page.filters.myRating = 'none';
    page.applyFilters();
    assert.deepEqual(page.filteredMovies.map(movie => movie.movieId), [3]);
}

// An active "My rating" filter is a client filter: the filtered list must never be
// saved as the default first screen, and every page is loaded before filtering.
{
    const page = createPage({ myRating: '7-8' });
    assert.equal(page.hasClientFilters(), true);
    assert.equal(page.needsFullList(), true);
    let cached = false;
    page.isDefaultNewestView = () => true;
    page.saveRatingsToCache = () => { cached = true; };
    page.filteredMovies = [film(2, 7)];
    page.saveDefaultFirstPageToCache();
    assert.equal(cached, false, 'A filtered list must not replace the default first-screen cache');
    page.filters.myRating = '';
    assert.equal(page.hasClientFilters(), false);
    assert.equal(page.needsFullList(), false, 'Default date sort without the filter keeps pagination');
}

// Filters are mirrored into the address; defaults are omitted, other params kept.
{
    const page = createPage({ genre: 'драма', myRating: '9-10', sort: 'rating-desc', avgRatingFrom: 7, avgRatingTo: 10 });
    page.syncFiltersToUrl();
    const url = new URL(currentUrl);
    assert.equal(url.searchParams.get('collection'), 'abc', 'Unrelated parameters stay in place');
    assert.equal(url.searchParams.get('genre'), 'драма');
    assert.equal(url.searchParams.get('my'), '9-10');
    assert.equal(url.searchParams.get('sort'), 'rating-desc');
    assert.equal(url.searchParams.get('avg'), '7.0-10.0');
    assert.equal(url.searchParams.has('q'), false);
    const writes = historyWrites.length;
    page.syncFiltersToUrl();
    assert.equal(historyWrites.length, writes, 'An unchanged address is not rewritten');

    Object.assign(page.filters, defaults());
    page.syncFiltersToUrl();
    assert.equal(new URL(currentUrl).search, '?collection=abc');
}

// Address filters override saved ones; an unknown sort or malformed range is ignored.
{
    storage.set('ratingsPageFilters', JSON.stringify({ genre: 'комедия', year: '1999', sort: 'title-asc' }));
    currentUrl = 'https://ext.test/ratings.html?genre=%D0%B4%D1%80%D0%B0%D0%BC%D0%B0&my=1-4&sort=evil&avg=x-y';
    const page = createPage();
    page.restoreFilterUI = () => {};
    page.loadFiltersFromStorage();
    assert.equal(page.filters.genre, 'драма');
    assert.equal(page.filters.year, '1999', 'Saved filters absent from the address survive');
    assert.equal(page.filters.myRating, '1-4');
    assert.equal(page.filters.sort, 'title-asc', 'An unknown sort from the address falls back to the saved one');
    assert.equal(page.filters.avgRatingFrom, 1.0);

    currentUrl = 'https://ext.test/ratings.html?avg=6.5-9';
    const ranged = createPage();
    ranged.restoreFilterUI = () => {};
    storage.delete('ratingsPageFilters');
    ranged.loadFiltersFromStorage();
    assert.equal(ranged.filters.avgRatingFrom, 6.5);
    assert.equal(ranged.filters.avgRatingTo, 9);
}

console.log('Ratings my-rating filter and URL filters passed.');
