const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function fixture(page, className) {
    const dom = new JSDOM(read(`src/pages/${page}/${page}.html`), {
        url: `https://extension.test/src/pages/${page}/${page}.html`, runScripts: 'outside-only', pretendToBeVisual: true
    });
    const window = dom.window;
    window.eval(read('src/shared/i18n/locales.js').replace('export const locales', 'const locales') + '\nwindow.testLocales = locales;');
    window.eval(read('src/shared/i18n/I18n.js').replace(/^import .*;\r?\n/gm, '').replace('export const i18n', 'const i18n').replace('export { I18n };', '').replace('this.locales = locales;', 'this.locales = window.testLocales;'));
    window.i18n.currentLocale = 'ru';
    window.i18n.translatePage();
    for (const file of ['src/shared/config/discoveryFilters.js', 'src/shared/components/FilterControls.js', 'src/shared/components/SortControl.js']) window.eval(read(file));
    const listener = window.document.addEventListener;
    window.document.addEventListener = function (type, callback, options) {
        if (type !== 'DOMContentLoaded') listener.call(this, type, callback, options);
    };
    window.eval(read(`src/pages/${page}/${page}.js`).replace(/^import .*;\r?\n/gm, '') + `\nwindow.TestManager = ${className};`);
    window.document.addEventListener = listener;
    return { dom, window, document: window.document, manager: Object.create(window.TestManager.prototype), element: id => window.document.getElementById(id) };
}

function event(h, input, type, value) {
    if (value !== undefined) input.value = String(value);
    input.dispatchEvent(new h.window.Event(type, { bubbles: true }));
}

function checkRandom() {
    const h = fixture('random', 'RandomManager');
    try {
        const { manager, element, window } = h;
        manager.elements = {};
        for (const [key, id] of Object.entries({ typeTags: 'typeTags', genreTags: 'genreTags', countryTags: 'countryTags', resetBtn: 'resetFiltersBtn', rollDiceBtn: 'rollDiceBtn', configHeader: 'configHeader', configBody: 'configBody', toggleConfigBtn: 'toggleConfigBtn', tryAgainBtn: 'tryAgainBtn' })) manager.elements[key] = element(id);
        manager.setupPoolListeners = () => {};
        manager._cancelMovieRequest = () => {};
        manager.showState = () => {};
        manager.populateFilterData();
        manager.renderTags();
        manager.setupSliders();
        manager.setupEventListeners();
        const save = manager.savePreferences.bind(manager);
        let saves = 0;
        manager.savePreferences = () => { saves++; save(); };
        const movie = element('typeTags').querySelector('[data-value="movie"]');
        movie.click();
        assert.equal(movie.dataset.state, 'include', 'One click cycles exactly once');
        assert.equal(saves, 1, 'Delegated persistence does not cycle or save twice');
        movie.click();
        assert.equal(movie.dataset.state, 'exclude');
        assert.equal(saves, 2);
        assert.deepEqual(Array.from(manager.getFilters().excludeTypes), ['movie']);
        const genre = element('genreTags').querySelector('[data-value="комедия"]');
        genre.click();
        assert.ok(manager.getFilters().genres.includes('комедия'));
        event(h, element('yearFrom'), 'input', 2001);
        assert.equal(saves, 3, 'Range input does not persist');
        event(h, element('yearFrom'), 'change');
        assert.equal(saves, 4, 'Range commit persists once');
        event(h, element('yearFrom'), 'change');
        assert.equal(saves, 4, 'Unchanged range commit is silent');
        const saved = JSON.parse(window.localStorage.getItem('random_filter_preferences'));
        assert.equal(saved.year.from, '2001');
        assert.deepEqual(saved.excludeTypes, ['movie']);
        assert.deepEqual(saved.genres, ['комедия']);
        event(h, element('ratingFrom'), 'input', 10);
        assert.equal(Number(element('ratingTo').value) - Number(element('ratingFrom').value), 0.5, 'Random rating gap remains .5');
        assert.equal(element('votesMaxDisplay').textContent, '2.0M', 'Vote formatting is retained');
        const filters = manager.getFilters();
        window.i18n.currentLocale = 'en';
        window.i18n.translatePage();
        manager.populateFilterData();
        manager.renderTags();
        manager._restoreTagFilters(filters);
        manager.setupSliders();
        assert.equal(element('typeTags').querySelector('[data-value="movie"]').dataset.state, 'exclude');
        assert.equal(element('genreTags').querySelector('[data-value="комедия"]').querySelector('.tag-text').textContent, window.i18n.get('random.genres.comedy'));
        assert.equal(h.document.querySelectorAll('.filter-range__fields').length, 3, 'Locale refresh replaces numeric editors without duplication');
        assert.equal(saves, 4, 'Locale refresh never saves or requests data');
        manager.loadPreferences();
        assert.equal(element('yearFrom').value, '2001');
        assert.equal(element('typeTags').querySelector('[data-value="movie"]').dataset.state, 'exclude');
        manager.resetFilters();
        assert.equal(saves, 5, 'Reset saves exactly once');
        assert.equal(element('yearFrom').value, '1990');
        assert.equal(element('ratingFrom').value, '7');
        assert.equal(element('votesFrom').value, '10000');
        assert.equal(element('typeTags').querySelector('[data-value="movie"]').dataset.state, 'neutral');
        manager.rangeControls.forEach(control => control.destroy());
        assert.equal(h.document.querySelectorAll('.filter-range__fields').length, 0, 'Destroy removes range editor surfaces');
    } finally { h.dom.window.close(); }
}

function checkSearch() {
    const h = fixture('search', 'SearchManager');
    try {
        const { manager, element, window } = h;
        manager.elements = { yearFromFilter: element('yearFromFilter'), yearToFilter: element('yearToFilter'), genreCheckboxes: element('genreCheckboxes'), countryCheckboxes: element('countryCheckboxes') };
        manager.initializeFilters();
        const comedy = element('genreCheckboxes').querySelector('[data-filter-id="genre-comedy"]');
        const drama = element('genreCheckboxes').querySelector('[data-filter-id="genre-drama"]');
        comedy.click(); drama.click(); drama.click();
        element('countryCheckboxes').querySelector('[data-filter-id="country-usa"]').click();
        assert.equal(element('genreFilterSection').open, false, 'Search groups start compact');
        assert.match(element('genreFilterSection').querySelector('summary').textContent, /✓ Комедии.*× Драмы/s, 'Closed groups expose include/exclude choices');
        assert.match(element('countryFilterSection').querySelector('summary').textContent, /✓ США/);
        event(h, element('yearFromFilter'), 'input', 1995);
        event(h, element('yearToFilter'), 'input', '');
        const filters = manager.getSelectedFilters();
        assert.deepEqual(Array.from(filters.genresInclude), ['комедия']);
        assert.deepEqual(Array.from(filters.genresExclude), ['драма']);
        assert.deepEqual(Array.from(filters.countriesInclude), ['США']);
        assert.equal(filters.yearFrom, 1995);
        assert.equal(filters.yearTo, null, 'Open-ended year is preserved');
        manager.saveFilterState();
        const stored = JSON.parse(window.localStorage.getItem('movieSearchFilters'));
        assert.equal(stored.yearTo, '');
        window.i18n.currentLocale = 'en';
        manager.initializeFilters();
        assert.equal(element('yearToFilter').value, '', 'Locale refresh does not recreate default bound');
        assert.deepEqual(Array.from(manager.getSelectedFilters().genresInclude), ['комедия'], 'Locale keeps provider values and state');
        assert.equal(element('genreCheckboxes').querySelector('[data-filter-id="genre-comedy"] .tag-text').textContent, window.i18n.get('random.genres.comedy'));
        manager.clearFilters();
        assert.match(element('genreFilterSection').querySelector('summary').textContent, /Any/, 'Reset refreshes the localized closed-group summary');
        assert.equal(element('yearFromFilter').value, '');
        const cleared = JSON.parse(window.localStorage.getItem('movieSearchFilters'));
        assert.equal(cleared.yearFrom, '', 'Reset persists the open lower year boundary');
        assert.equal(cleared.yearTo, '', 'Reset persists the open upper year boundary');
        window.localStorage.setItem('movieSearchFilters', JSON.stringify(stored));
        manager.loadFilterState();
        assert.equal(element('yearFromFilter').value, '1995');
        assert.equal(element('yearToFilter').value, '');
        assert.deepEqual(Array.from(manager.getSelectedFilters().genresExclude), ['драма']);
        const candidates = [{ year: 2000, genres: ['комедия'], countries: ['США'] }, { year: 2000, genres: ['комедия', 'драма'], countries: ['США'] }, { year: 1990, genres: ['комедия'], countries: ['США'] }];
        assert.equal(manager.applyClientSideFilters(candidates, manager.getSelectedFilters()).length, 1, 'Include OR and exclusion/year constraints remain intact');
    } finally { h.dom.window.close(); }
}

function checkRatingsRange() {
    const h = fixture('ratings', 'RatingsPageManager');
    try {
        let commits = 0; let result;
        h.manager.initDoubleSlider(h.element('avgRatingFrom'), h.element('avgRatingTo'), h.element('avgRatingMinDisplay'), h.element('avgRatingMaxDisplay'), h.element('avgRatingRange'), (from, to) => { commits++; result = [from, to]; });
        event(h, h.element('avgRatingFrom'), 'input', 7.4);
        assert.equal(commits, 0);
        assert.equal(h.element('avgRatingMinDisplay').textContent, '7.4');
        event(h, h.element('avgRatingFrom'), 'change');
        assert.equal(commits, 1);
        assert.deepEqual(result, [7.4, 10]);
        event(h, h.element('avgRatingTo'), 'input', 2);
        assert.equal(h.element('avgRatingTo').value, '7.4', 'Ratings equal bounds are allowed, unlike Random gap');
        event(h, h.element('avgRatingTo'), 'change');
        assert.equal(commits, 2);
        assert.deepEqual(result, [7.4, 7.4]);
    } finally { h.dom.window.close(); }
}

function checkCatalogRange() {
    const h = fixture('catalog', 'CatalogPage');
    try {
        h.window.IntersectionObserver = class { observe() {} };
        const { manager, element, window } = h;
        manager.elements = { sort: element('catalogSort'), genre: element('catalogGenre'), yearFrom: element('catalogYearFrom'), yearTo: element('catalogYearTo'), country: element('catalogCountry'), sentinel: element('catalogSentinel') };
        manager.state = { category: 'films', sort: 'popularity.desc', yearFrom: '', yearTo: '', genre: '', country: '' };
        manager.renderHeader = () => {};
        let loads = 0;
        manager.loadFirstPage = () => loads++;
        window.RangeControl.enhance(manager.elements.yearFrom, manager.elements.yearTo, { fromLabel: 'Год от', toLabel: 'Год до' });
        manager.bindEvents();
        event(h, manager.elements.yearFrom, 'input', 2001);
        assert.equal(loads, 0);
        event(h, manager.elements.yearFrom, 'change');
        assert.equal(loads, 1);
        assert.equal(manager.state.yearFrom, '2001');
        assert.equal(new URL(window.location.href).searchParams.get('yearFrom'), '2001');
        event(h, manager.elements.yearFrom, 'change', '');
        assert.equal(loads, 2);
        assert.equal(manager.state.yearFrom, '');
        assert.equal(new URL(window.location.href).searchParams.has('yearFrom'), false, 'Clearing year removes query constraint');
    } finally { h.dom.window.close(); }
}

checkRandom();
checkSearch();
checkRatingsRange();
checkCatalogRange();
console.log('Discovery filter integration passed: real shared choices/ranges with Random/Search payload, persistence, locale, reset and Ratings/Catalog commit contracts (JSDOM fixtures).');
