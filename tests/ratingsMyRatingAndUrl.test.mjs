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

// Every score has a word on the scale, and the slider announces it.
{
    const { i18n } = await import('../src/shared/i18n/I18n.js');
    i18n.currentLocale = 'ru';
    const page = createPage();
    assert.equal(page.getRatingWord(10), 'Шедевр');
    assert.equal(page.getRatingWord('3'), 'Плохо');
    assert.equal(page.getRatingWord(0), '');
    assert.equal(page.getRatingWord(11), '');
    const words = new Set(Array.from({ length: 10 }, (_, index) => page.getRatingWord(index + 1)));
    assert.equal(words.size, 10, 'Each of the ten scores has its own word');
    const attributes = {};
    page.elements = { ratingWord: { textContent: '' }, ratingSlider: { setAttribute: (name, value) => { attributes[name] = value; } } };
    page.updateRatingWord(8);
    assert.equal(page.elements.ratingWord.textContent, 'Очень хорошо');
    assert.equal(attributes['aria-valuetext'], '8 — Очень хорошо');
    i18n.currentLocale = 'en';
    assert.equal(page.getRatingWord(10), 'Masterpiece');
}

// Stats cover only my own scores among the films shown.
{
    const page = createPage();
    const stats = page.getMyRatingStats([film(1, 10), film(2, 8), film(3, 0), film(4, 8)]);
    assert.equal(stats.count, 3);
    assert.equal(stats.average.toFixed(2), '8.67');
    assert.deepEqual(stats.distribution, [0, 0, 0, 0, 0, 0, 0, 2, 0, 1]);
    assert.deepEqual(page.getMyRatingStats([film(5, 0)]), { count: 0, average: 0, distribution: Array(10).fill(0) });
}

// The view switch toggles the list class and pressed state.
{
    const page = createPage();
    const classes = new Set();
    page.elements = { moviesGrid: { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } } };
    const buttons = ['grid', 'list'].map(view => ({ dataset: { view }, attrs: {}, setAttribute(name, value) { this.attrs[name] = value; } }));
    const previousQuery = document.querySelectorAll;
    document.querySelectorAll = selector => (selector === '.results-view-btn' ? buttons : []);
    page.applyViewMode('list');
    assert.equal(page.viewMode, 'list');
    assert.equal(classes.has('movies-grid--list'), true);
    assert.deepEqual(buttons.map(button => button.attrs['aria-pressed']), ['false', 'true']);
    page.applyViewMode('anything');
    assert.equal(page.viewMode, 'grid', 'Unknown values fall back to the grid');
    assert.equal(classes.has('movies-grid--list'), false);
    document.querySelectorAll = previousQuery;
}

// Series link to Movie Details for episode scores; the title dialog itself never
// touches episode ratings (see ratingsPageContract.test.js).
{
    const page = createPage();
    const link = { hidden: true, href: '', removeAttribute(name) { if (name === 'href') this.href = ''; } };
    page.elements = { episodeRatingLink: link };
    page.updateEpisodeRatingLink({ movieId: 77, movie: { type: 'tv-series' } });
    assert.equal(link.hidden, false);
    assert.equal(link.href, 'src/pages/movie-details/movie-details.html?movieId=77');
    page.updateEpisodeRatingLink({ movieId: 78, movie: { type: 'movie' } });
    assert.equal(link.hidden, true, 'Films get no episode link');
    assert.equal(link.href, '');
}

console.log('Ratings my-rating filter, URL filters, scale words, stats, view switch and episode link passed.');
