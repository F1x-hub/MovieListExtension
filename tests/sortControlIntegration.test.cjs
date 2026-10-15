const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pairs = fields => fields.flatMap(field => [`${field}-desc`, `${field}-asc`]);
const pages = [
    ['ratings', 'sortFilter', pairs(['date', 'rating', 'avg-rating', 'title', 'year'])],
    ['favorites', 'sortFilter', pairs(['favoritedAt', 'rating', 'watchedDate', 'movieTitle', 'releaseYear'])],
    ['watching', 'sortFilter', pairs(['addedAt', 'movieTitle', 'releaseYear', 'avgRating'])],
    ['watchlist', 'sortFilter', pairs(['addedAt', 'movieTitle', 'releaseYear', 'avgRating'])],
    ['collection', 'sortFilter', pairs(['date', 'title', 'rating', 'year'])],
    ['bookmarks', 'sortFilter', ['updatedAt-desc', 'createdAt-desc', 'movieTitle-asc', 'releaseYear-desc', 'avgRating-desc']],
    ['catalog', 'catalogSort', ['popularity.desc', 'vote_average.desc', 'primary_release_date.desc']],
    ['movie-details', 'torrentSourceSort', ['recommended', 'seeders', 'quality', 'size-asc', 'size-desc']]
];

function fixture(page) {
    const dom = new JSDOM(read(`src/pages/${page}/${page}.html`), {
        url: `https://extension.test/src/pages/${page}/${page}.html`,
        runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.eval(read('src/shared/components/SortControl.js'));
    return dom;
}

function loadManager(window, page, className) {
    // Controllers are exercised without auto-starting auth, provider or database work.
    const addListener = window.document.addEventListener;
    window.document.addEventListener = function (type, listener, options) {
        if (type !== 'DOMContentLoaded') addListener.call(this, type, listener, options);
    };
    try {
        window.eval(read(`src/pages/${page}/${page}.js`).replace(/^import .*;\r?\n/gm, '')
            + `\nwindow.TestManager = ${className};`);
    } finally {
        window.document.addEventListener = addListener;
    }
    return Object.create(window.TestManager.prototype);
}

function checkMarkupAndNativeContracts() {
    for (const [page, id, expected] of pages) {
        const dom = fixture(page);
        try {
            const { document, SortControl } = dom.window;
            const selects = document.querySelectorAll(`[data-sort-control]#${id}`);
            assert.equal(selects.length, 1, `${page} has one native sorting select`);
            const select = selects[0];
            assert.deepEqual(Array.from(select.options, option => option.value).sort(), [...expected].sort(), `${page} retains domain sort keys`);
            assert.ok(Array.from(select.options).every(option => option.textContent.trim()), `${page} retains visible option labels`);
            assert.equal(document.querySelector('[data-dropdown="sortFilter"]'), null, `${page} has no duplicate legacy sort shell`);
            const scripts = Array.from(document.scripts, script => script.getAttribute('src'));
            const controlIndex = scripts.indexOf('../../shared/components/SortControl.js');
            assert.ok(controlIndex >= 0 && controlIndex < scripts.indexOf(`${page}.js`), `${page} loads control before manager`);
            assert.equal(scripts.filter(src => src === '../../shared/components/SortControl.js').length, 1);
            const control = SortControl.enhance(select);
            assert.equal(control.valueLabel.textContent, select.selectedOptions[0].textContent);
            assert.equal(SortControl.enhance(select), control);
            let changes = 0;
            select.addEventListener('change', () => changes++);
            control.setValue(select.options[1].value, { emit: true });
            assert.equal(changes, 1, `${page} emits one native change`);
            control.syncFromNative();
            assert.equal(changes, 1, `${page} presentation sync is silent`);
        } finally { dom.window.close(); }
    }
}

function checkListManagers() {
    for (const page of ['favorites', 'watching', 'watchlist', 'collection']) {
        const dom = fixture(page);
        try {
            const className = `${page[0].toUpperCase()}${page.slice(1)}PageManager`;
            const manager = loadManager(dom.window, page, className);
            const select = dom.window.document.getElementById('sortFilter');
            manager.elements = { sortFilter: select, collectionSearchInput: dom.window.document.getElementById('collectionSearchInput') };
            manager.filters = { search: 'Alien', sort: select.value };
            let renders = 0;
            manager.applyFilters = () => renders++;
            manager.initializeSortControl();
            assert.equal(renders, 0, `${page} initialization does not reorder data`);
            manager.sortControl.setValue(select.options[1].value, { emit: true });
            assert.equal(manager.filters.sort, select.value);
            assert.equal(renders, 1, `${page} manager handles selection once`);
            manager.sortControl.setValue(select.value, { emit: true });
            assert.equal(renders, 1, `${page} reselecting does not rerender`);
            if (page === 'collection') {
                manager.clearFilters();
                assert.equal(manager.filters.sort, 'date-desc');
                assert.equal(select.value, 'date-desc');
                assert.equal(manager.filters.search, '');
                assert.equal(renders, 2, 'Collection reset silently syncs control and applies once');
            }
        } finally { dom.window.close(); }
    }
}

function checkRatingsLock() {
    const dom = fixture('ratings');
    try {
        dom.window.i18n = { get: () => 'Сортировка определяется фильтром рейтинга' };
        const manager = loadManager(dom.window, 'ratings', 'RatingsPageManager');
        const select = dom.window.document.getElementById('sortFilter');
        manager.elements = { sortFilter: select };
        manager.filters = { sort: 'title-asc', avgRatingFrom: 1, avgRatingTo: 10 };
        manager.sortControl = dom.window.SortControl.enhance(select);
        let changes = 0;
        select.addEventListener('change', () => changes++);
        manager.updateSortFilterUIState();
        assert.equal(select.value, 'title-asc');
        manager.sortControl.open();
        manager.filters.avgRatingFrom = 7;
        manager.updateSortFilterUIState();
        assert.equal(manager.filters.sort, 'title-asc', 'Range lock preserves user preference');
        assert.equal(select.value, 'avg-rating-desc', 'Control shows effective server order');
        assert.equal(manager.sortControl.trigger.disabled, true);
        assert.equal(manager.sortControl.isOpen, false, 'Lock closes an open popup');
        manager.sortControl.open();
        assert.equal(manager.sortControl.isOpen, false, 'Locked control cannot reopen');
        assert.equal(manager.sortControl.hint.hidden, false);
        manager.filters.avgRatingFrom = 1;
        manager.updateSortFilterUIState();
        assert.equal(select.value, 'title-asc', 'Unlock restores preserved preference');
        assert.equal(manager.sortControl.trigger.disabled, false);
        assert.equal(manager.sortControl.hint.hidden, true);
        assert.equal(changes, 0, 'Lock/unlock presentation never dispatches sorting');
    } finally { dom.window.close(); }
}

function checkCatalogAdapter() {
    const dom = fixture('catalog');
    try {
        dom.window.IntersectionObserver = class { observe() {} disconnect() {} };
        const manager = loadManager(dom.window, 'catalog', 'CatalogPage');
        const document = dom.window.document;
        manager.elements = {
            sort: document.getElementById('catalogSort'), genre: document.getElementById('catalogGenre'),
            yearFrom: document.getElementById('catalogYearFrom'), yearTo: document.getElementById('catalogYearTo'),
            country: document.getElementById('catalogCountry'), title: document.getElementById('catalogTitle'),
            description: document.getElementById('catalogDescription'), sentinel: document.getElementById('catalogSentinel')
        };
        const options = [{ value: 'popularity.desc', label: 'Popular' }, { value: 'first_air_date.desc', label: 'New series' }];
        manager.getCategoryConfig = () => ({ title: 'Series', description: 'TV', sortOptions: options });
        manager.state = { category: 'series', sort: 'popularity.desc', yearFrom: '', yearTo: '', genre: '', country: '' };
        manager.selectControls = { sort: dom.window.SortControl.enhance(manager.elements.sort) };
        let loads = 0;
        manager.loadFirstPage = () => loads++;
        manager.renderHeader();
        assert.deepEqual(Array.from(manager.elements.sort.options, option => option.value), options.map(option => option.value));
        manager.bindEvents();
        manager.selectControls.sort.setValue('first_air_date.desc', { emit: true });
        assert.equal(loads, 1, 'Catalog native change resets loading once');
        assert.equal(manager.state.sort, 'first_air_date.desc');
        assert.equal(new URL(dom.window.location.href).searchParams.get('sort'), 'first_air_date.desc');
        assert.equal(new URL(dom.window.location.href).searchParams.get('category'), 'series');
        manager.state.sort = 'popularity.desc';
        manager.syncControlsFromState();
        manager.writeStateToUrl();
        assert.equal(manager.elements.sort.value, 'popularity.desc');
        assert.equal(new URL(dom.window.location.href).searchParams.has('sort'), false, 'Default remains implicit in URL');
        assert.equal(loads, 1, 'Silent URL/state restoration does not reload');
    } finally { dom.window.close(); }
}

async function checkCatalogRequestSupersession() {
    for (const scenario of ['old-success', 'old-failure', 'pending-load-more']) {
        const dom = fixture('catalog');
        try {
            const manager = loadManager(dom.window, 'catalog', 'CatalogPage');
            const document = dom.window.document;
            manager.elements = {};
            for (const [key, id] of Object.entries({ grid: 'catalogGrid', empty: 'catalogEmpty', error: 'catalogError', errorMessage: 'catalogErrorMessage', loadMore: 'catalogLoadMore', count: 'catalogCount' })) {
                manager.elements[key] = document.getElementById(id);
            }
            manager.state = { category: 'films', sort: 'popularity.desc' };
            manager.getQuery = page => ({ page, sort: manager.state.sort });
            manager.seenCatalogKeys = new Set(['movie:10']);
            manager.requestGeneration = 0;
            manager.currentPage = 1;
            manager.totalPages = 3;
            manager.autoLoadCount = 0;
            manager.maxAutoLoads = 3;
            manager.setLoadingState = value => { manager.loadingIndicator = value; };
            manager.setStatus = value => { manager.status = value; };
            manager.formatCount = String;
            manager.appendItems = items => {
                items.forEach(item => {
                    const node = document.createElement('div');
                    node.dataset.tmdbId = item.tmdbId;
                    manager.elements.grid.appendChild(node);
                });
            };
            const pending = [];
            manager.catalogService = {
                getCategoryPage(category, query) {
                    return new Promise((resolve, reject) => pending.push({ category, query, resolve, reject }));
                }
            };
            const old = scenario === 'pending-load-more' ? manager.loadNextPage(false) : manager.loadFirstPage();
            manager.state.sort = 'vote_average.desc';
            const newest = manager.loadFirstPage();
            assert.equal(pending.length, 2, `${scenario}: newer sort immediately starts a request`);
            assert.equal(pending[1].query.sort, 'vote_average.desc');
            assert.equal(pending[1].query.page, 1);
            const latestResult = { items: [{ tmdbId: 99 }], page: 1, totalPages: 2, totalResults: 21 };
            if (scenario === 'pending-load-more') {
                assert.equal(pending[0].query.page, 2);
                pending[1].resolve(latestResult);
                await newest;
                pending[0].resolve({ items: [{ tmdbId: 10 }], page: 2, totalPages: 3, totalResults: 40 });
            } else {
                if (scenario === 'old-failure') pending[0].reject(new Error('stale network failure'));
                else pending[0].resolve({ items: [{ tmdbId: 10 }], page: 1, totalPages: 3, totalResults: 40 });
                await old;
                assert.equal(manager.isLoading, true, 'Stale finally cannot clear newer loading state');
                assert.equal(manager.loadingIndicator, true);
                assert.equal(manager.elements.error.hidden, true, 'Stale failure cannot display an error');
                pending[1].resolve(latestResult);
                await newest;
            }
            await old;
            assert.deepEqual(Array.from(manager.elements.grid.children, node => node.dataset.tmdbId), ['99'], `${scenario}: stale result cannot replace or append to current grid`);
            assert.deepEqual(Array.from(manager.seenCatalogKeys), ['movie:99']);
            assert.equal(manager.currentPage, 1);
            assert.equal(manager.totalResults, 21);
            assert.equal(manager.elements.count.textContent, '21');
            assert.equal(manager.status, '');
            assert.equal(manager.isLoading, false);
            assert.equal(manager.loadingIndicator, false);
        } finally { dom.window.close(); }
    }
}

async function checkListLocaleSynchronization() {
    for (const page of ['favorites', 'watching', 'watchlist', 'collection']) {
        const dom = fixture(page);
        try {
            const { window } = dom;
            window.eval(read('src/shared/i18n/locales.js').replace('export const locales', 'const locales') + '\nwindow.testLocales = locales;');
            window.eval(read('src/shared/i18n/I18n.js')
                .replace(/^import .*;\r?\n/gm, '')
                .replace('export const i18n', 'const i18n')
                .replace('export { I18n };', '')
                .replace('this.locales = locales;', 'this.locales = window.testLocales;'));
            const select = window.document.getElementById('sortFilter');
            const control = window.SortControl.enhance(select);
            let changes = 0;
            select.addEventListener('change', () => changes++);
            for (const locale of ['ru', 'en']) {
                window.i18n.currentLocale = locale;
                window.i18n.translatePage();
                await new Promise(resolve => window.setTimeout(resolve, 0));
                assert.equal(select.labels[0].textContent, window.i18n.get('ratings.filters.sort'));
                for (const option of select.options) {
                    const key = option.dataset.i18n;
                    assert.ok(key, `${page}: every option is translated`);
                    assert.notEqual(window.i18n.get(key), key, `${page}: ${key} exists in ${locale}`);
                    assert.equal(option.textContent, window.i18n.get(key));
                }
                assert.equal(control.valueLabel.textContent, select.selectedOptions[0].textContent, `${page}: locale observer syncs selected presentation`);
                if (locale === 'ru') {
                    control.setValue(page === 'favorites' ? 'watchedDate-asc' : select.options[3].value, { emit: true });
                    assert.equal(changes, 1);
                }
            }
            assert.equal(changes, 1, `${page}: locale changes never emit sorting changes`);
        } finally { dom.window.close(); }
    }
}

(async () => {
    checkMarkupAndNativeContracts();
    checkListManagers();
    checkRatingsLock();
    checkCatalogAdapter();
    await checkCatalogRequestSupersession();
    await checkListLocaleSynchronization();
    console.log('SortControl integrations passed: 8 native contracts, 4 manager callbacks/reset and RU/EN translation sync, Ratings range lock, Catalog options/URL and superseded request races (JSDOM fixtures).');
})().catch(error => { console.error(error); process.exitCode = 1; });
