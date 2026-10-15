const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
    constructor() {
        this.listeners = {};
        this.attributes = {};
        this.dataset = {};
        this.style = {};
        this.value = '';
        this.children = [];
        const classes = new Set();
        this.classList = {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            contains: name => classes.has(name),
            toggle(name) { if (classes.has(name)) { classes.delete(name); return false; } classes.add(name); return true; }
        };
    }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    emit(type, options = {}) {
        for (const handler of this.listeners[type] || []) handler({ target: this, button: 0, preventDefault() {}, stopPropagation() {}, ...options });
    }
    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes[name]; }
    contains(target) { return target === this; }
    focus() { this.focused = true; }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    querySelector(selector) {
        if (selector.includes('data-i18n')) return this.label;
        return this.children.find(child => selector.includes(child.getAttribute('data-filter-id')));
    }
    querySelectorAll() { return this.children; }
    set innerHTML(value) { this.children = []; this.html = value; }
}

const elements = {};
const document = new Element();
document.getElementById = id => elements[id] || null;
document.querySelectorAll = () => [];
const savedFilters = JSON.stringify({ yearFrom: '1995', yearTo: '2010', genres: [{ id: 'genre-drama', state: 'exclude' }], countries: [{ id: 'country-us', state: 'include' }] });
const context = vm.createContext({
    console, URLSearchParams, Date,
    document,
    window: { addEventListener() {}, location: { pathname: '/src/pages/search/search.html', search: '', replace(url) { this.redirect = url; } } },
    chrome: { runtime: { getURL: value => value } },
    firebaseManager: { waitForAuthReady: async () => {}, isAuthenticated: () => true, getCurrentUser: () => ({ uid: 'test' }) },
    localStorage: { getItem: () => savedFilters },
    i18n: { get: key => ({ 'search.filters_btn': 'Фильтры', 'random.genres.drama': 'Драма', 'random.countries.us': 'США' })[key] || key, locales: { ru: { random: { genres: { drama: 'Драма' }, countries: { us: 'США' } } } } },
    Utils: { showToast() {} }
});
context.DiscoveryFilters = { getOptions: () => ({
    genres: [{ labelKey: 'random.genres.drama', value: 'Драма', label: 'Драма' }],
    countries: [{ labelKey: 'random.countries.us', value: 'США', label: 'США' }]
}) };
context.FilterChoice = {
    setState(item, state) { item.setAttribute('data-filter-state', state); },
    enhanceGroup() {},
    enhanceSummary() {}
};
context.RangeControl = { enhance: () => ({ syncFromNative() {} }) };
context.window.firebaseManager = context.firebaseManager;
const searchSource = fs.readFileSync('src/pages/search/search.js', 'utf8');
vm.runInContext(searchSource.replace(/^import .*;\r?\n/gm, '') + '\nthis.SearchManager = SearchManager;', context);
vm.runInContext(fs.readFileSync('src/shared/components/Navigation.js', 'utf8') + '\nthis.Navigation = Navigation;', context);

async function checkRoutes() {
    for (const route of ['?q=Alien', '?query=Alien', '', '?movieId=42&autoplay=true', '?type=series', '?sourceUrl=https%3A%2F%2Fexample.test']) {
        context.window.location.search = route;
        context.window.location.redirect = null;
        const manager = Object.create(context.SearchManager.prototype);
        manager.elements = { searchInput: new Element(), yearFromFilter: new Element(), yearToFilter: new Element(), genreCheckboxes: new Element(), countryCheckboxes: new Element() };
        manager.searchGeneration = 0;
        manager.showInitialLoading = () => {};
        manager.hideInitialLoading = () => {};
        manager.createCheckboxItem = (id, value) => {
            const item = new Element();
            item.setAttribute('data-filter-id', id);
            item.setAttribute('data-filter-value', value);
            return item;
        };
        let searched = false;
        manager.searchMovies = async () => {
            searched = true;
            assert.equal(manager.elements.searchInput.value, 'Alien');
            assert.equal(manager.elements.yearFromFilter.value, '1995');
            assert.equal(manager.elements.yearToFilter.value, '2010');
            assert.equal(manager.elements.genreCheckboxes.children[0].getAttribute('data-filter-state'), 'exclude');
            assert.equal(manager.elements.countryCheckboxes.children[0].getAttribute('data-filter-state'), 'include');
        };
        let sourceLoaded = false;
        manager.loadMovieFromSource = async url => { assert.equal(url, 'https://example.test'); sourceLoaded = true; return true; };
        await manager.initializeUI();
        assert.equal(searched, route.startsWith('?q'));
        assert.equal(sourceLoaded, route.startsWith('?sourceUrl'));
        if (!route) assert.equal(manager.elements.yearToFilter.value, '2010');
        if (route.startsWith('?movieId')) assert.equal(context.window.location.redirect, 'src/pages/movie-details/movie-details.html?movieId=42&autoplay=true');
        if (route.startsWith('?type')) assert.equal(context.window.location.redirect, 'src/pages/catalog/catalog.html?category=films');
        if (route.startsWith('?movieId') || route.startsWith('?type') || sourceLoaded) assert.equal(manager.elements.genreCheckboxes.children.length, 0);
    }
}

function checkSearchControls() {
    const manager = Object.create(context.SearchManager.prototype);
    manager.elements = {};
    for (const name of ['toggleFiltersBtn', 'clearFiltersBtn', 'applyFiltersBtn', 'clearHistoryBtn']) manager.elements[name] = new Element();
    manager.elements.filters = new Element();
    manager.elements.resultsGrid = new Element();
    manager.elements.filters.style.display = 'none';
    const toggle = manager.elements.toggleFiltersBtn;
    const icon = new Element();
    toggle.label = new Element();
    toggle.children = [icon, toggle.label];
    let reset = 0; let apply = 0; let history = 0;
    manager.clearFilters = () => reset++;
    manager.applyFilters = () => apply++;
    manager.clearSearchHistory = () => history++;
    manager.setupIntersectionObserver = () => {};
    manager.setupEventListeners();
    for (const detail of [1, 0]) {
        toggle.emit('click', { detail });
        assert.equal(toggle.getAttribute('aria-expanded'), String(detail === 1));
        assert.equal(toggle.getAttribute('aria-controls'), 'filters');
        assert.equal(toggle.label.textContent, 'Фильтры');
        assert.equal(toggle.children[0], icon);
        manager.elements.clearFiltersBtn.emit('click', { detail });
        manager.elements.applyFiltersBtn.emit('click', { detail });
        manager.elements.clearHistoryBtn.emit('click', { detail });
    }
    assert.equal(reset, 2); assert.equal(apply, 2); assert.equal(history, 2);
    for (const name of ['toggleFiltersBtn', 'clearFiltersBtn', 'applyFiltersBtn', 'clearHistoryBtn']) assert.equal(manager.elements[name].listeners.mousedown, undefined);
}

function checkNavigationControls() {
    for (const id of ['navMobileToggle', 'navMenu', 'navUserTrigger', 'navUserDropdown', 'navSearchToggle', 'navSearchInputWrapper', 'navSearchInput', 'navBookmarksBtn']) elements[id] = new Element();
    const nav = Object.create(context.Navigation.prototype);
    nav.setupRadioPlayer = () => {};
    nav.navigateToSearchWithQuery = value => { nav.query = value; };
    nav.setupEventListeners();
    for (const detail of [1, 0]) {
        elements.navMobileToggle.emit('click', { detail });
        assert.equal(elements.navMobileToggle.getAttribute('aria-expanded'), 'true');
        document.emit('keydown', { key: 'Escape' });
        assert.equal(elements.navMobileToggle.getAttribute('aria-expanded'), 'false');
        assert.equal(elements.navMobileToggle.focused, true);
        elements.navUserTrigger.emit('click', { detail });
        assert.equal(elements.navUserTrigger.getAttribute('aria-expanded'), 'true');
        assert.equal(elements.navUserDropdown.inert, false);
        document.emit('keydown', { key: 'Escape' });
        assert.equal(elements.navUserTrigger.getAttribute('aria-expanded'), 'false');
        assert.equal(elements.navUserDropdown.inert, true);
        elements.navSearchToggle.emit('click', { detail });
        assert.equal(elements.navSearchToggle.getAttribute('aria-expanded'), 'true');
        assert.equal(elements.navSearchInput.focused, true);
        document.emit('keydown', { key: 'Escape' });
        assert.equal(elements.navSearchToggle.getAttribute('aria-expanded'), 'false');
    }
    elements.navSearchToggle.emit('click');
    elements.navSearchInput.value = 'Alien';
    elements.navSearchInput.emit('keydown', { key: 'Enter' });
    assert.equal(nav.query, 'Alien');
    assert.equal(elements.navSearchToggle.getAttribute('aria-expanded'), 'false');
    for (const id of ['navMobileToggle', 'navUserTrigger', 'navSearchToggle']) assert.equal(elements[id].listeners.mousedown, undefined);
}

(async () => {
    await checkRoutes();
    checkSearchControls();
    checkNavigationControls();
    const html = fs.readFileSync('src/pages/search/search.html', 'utf8');
    for (const id of ['toggleFiltersBtn', 'searchBtn']) assert.doesNotMatch(html.match(new RegExp(`<button[^>]+id="${id}"[^>]*>`))[0], /data-i18n=/);
    assert.match(html, /id="clearHistoryBtn"[^>]*data-i18n="\[title\]search.clear_history"/);
    console.log('Search route/filter state and Search/Navigation click disclosure regressions passed (VM fixtures).');
})().catch(error => { console.error(error); process.exitCode = 1; });
