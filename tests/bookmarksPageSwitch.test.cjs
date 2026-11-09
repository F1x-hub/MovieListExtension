/**
 * Bookmarks: switching lists and the collection «⋮» menu.
 *
 * A switch used to wait on Firestore for every shown film and on a read of all
 * of local storage (38 MB in the owner's profile) each time, about a second
 * per click. The collection menu was appended inside its own button with a
 * class the styles never open, so it never showed. These run the real page
 * script against the real page markup; only services are replaced.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const BOOKMARKS = [
    { movieId: 1, movieTitle: 'Дюна', status: 'watched', updatedAt: 3 },
    { movieId: 2, movieTitle: 'Дюна: Часть вторая', status: 'watching', updatedAt: 2 },
    { movieId: 3, movieTitle: 'Дюна: Часть третья', status: 'plan_to_watch', updatedAt: 1 }
];

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

async function settle(window) {
    for (let turn = 0; turn < 20; turn++) await new Promise(resolve => window.setTimeout(resolve, 0));
}

function openPage({ batch } = {}) {
    const dom = new JSDOM(read('src/pages/bookmarks/bookmarks.html'), {
        url: 'https://extension.test/src/pages/bookmarks/bookmarks.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    window.i18n = { get: key => key };
    window.Utils = {
        createPageStateManager: () => ({ showContent() {}, showLoader() {}, showError() {} }),
        cleanTitle: title => title,
        bindTabsAndMenus() {},
        showToast() {}
    };
    window.MovieCard = {
        create(data) {
            const card = window.document.createElement('div');
            card.className = 'test-card';
            card.dataset.movieId = String(data.movieId);
            return card;
        }
    };
    window.eval(`${read('src/shared/services/CollectionService.js')}\n;window.CollectionService = CollectionService;`);
    const addListener = window.document.addEventListener;
    window.document.addEventListener = function (type, listener, options) {
        if (type !== 'DOMContentLoaded') addListener.call(this, type, listener, options);
    };
    window.eval(`${read('src/pages/bookmarks/bookmarks.js').replace(/^import .*;\r?\n/gm, '')}\nwindow.TestManager = BookmarksPageManager;`);
    window.document.addEventListener = addListener;

    const calls = { batch: [], progress: 0, collectionReads: 0, edits: 0 };
    // The constructor starts Firebase and i18n; the test builds the same state by hand.
    const page = Object.create(window.TestManager.prototype);
    Object.assign(page, {
        statusFilter: 'all',
        currentSort: 'updatedAt-desc',
        searchTerm: '',
        allBookmarks: BOOKMARKS.map(item => ({ ...item })),
        activeCollectionId: null,
        availableCollections: [{ id: 'dune', name: 'Дюна', icon: '', movieIds: [1, '3'] }],
        cardMovieCache: new Map(),
        cardMoviePending: new Map(),
        progressSnapshot: null,
        renderToken: 0,
        movieCacheService: {
            getBatchCachedMovies(ids) {
                calls.batch.push([...ids]);
                const answer = Object.fromEntries(ids.map(id => [id, { id, kpRating: 7.5 }]));
                return batch ? batch(ids).then(() => answer) : Promise.resolve(answer);
            }
        },
        progressService: { getAllProgress: async () => { calls.progress++; return {}; } },
        collectionService: {
            getMoviesInCollection: async () => { calls.collectionReads++; return []; },
            getCollection: async () => { calls.collectionReads++; return null; }
        },
        editActiveCollection: () => { calls.edits++; }
    });
    page.initializeElements();
    page.setupEventListeners();
    const shown = () => [...window.document.querySelectorAll('#moviesGrid .test-card')].map(card => card.dataset.movieId);
    return { window, page, calls, shown };
}

async function checkSwitchesReuseData() {
    const { window, page, calls, shown } = openPage();
    try {
        page.setFilter('all');
        await settle(window);
        assert.deepEqual(shown(), ['1', '2', '3'], 'All bookmarks are drawn');
        assert.equal(calls.batch.length, 1, 'Card data is fetched once for the first list');
        assert.equal(calls.progress, 1, 'Progress is read once');

        for (const filter of ['watching', 'watched', 'plan_to_watch', 'all']) {
            page.setFilter(filter);
            await settle(window);
        }
        assert.deepEqual(shown(), ['1', '2', '3']);
        assert.equal(calls.batch.length, 1, 'Switching lists fetches no card data again');
        assert.equal(calls.progress, 1, 'Switching lists does not reread progress');

        page.progressSnapshot = null; // what a watching_progress_* change does
        page.setFilter('watching');
        await settle(window);
        assert.deepEqual(shown(), ['2']);
        assert.equal(calls.progress, 2, 'Changed progress is read again');
    } finally {
        window.close();
    }
}

async function checkFirstListWarmsTheRest() {
    const { window, page, calls, shown } = openPage();
    try {
        page.setFilter('watching');
        await settle(window);
        assert.deepEqual(shown(), ['2']);
        assert.deepEqual(calls.batch[0], ['2'], 'The shown list is fetched first');
        assert.deepEqual(calls.batch[1], ['1', '3'], 'The other bookmarks follow in the background');
        page.setFilter('all');
        await settle(window);
        assert.equal(calls.batch.length, 2, 'The next list needs no fetch');
    } finally {
        window.close();
    }
}

async function checkLateRenderDoesNotWin() {
    const gate = deferred();
    const { window, page, calls, shown } = openPage({ batch: () => gate.promise });
    try {
        page.setFilter('all');
        page.setFilter('watching');
        await settle(window);
        assert.equal(calls.batch.length, 1, 'A film already being fetched is not fetched twice');
        gate.resolve();
        await settle(window);
        assert.deepEqual(shown(), ['2'], 'The last chosen list stays on screen');
    } finally {
        window.close();
    }
}

async function checkCollectionFromLoadedList() {
    const { window, page, calls, shown } = openPage();
    try {
        page.setFilter('collection:dune');
        assert.equal(window.document.getElementById('pageTitle').textContent, 'Дюна', 'The title is known at once');
        await settle(window);
        assert.deepEqual(shown(), ['1', '3'], 'Number and string ids both match');
        assert.equal(calls.collectionReads, 0, 'The loaded collection list is used, not Firestore');
    } finally {
        window.close();
    }
}

async function checkCollectionMenu() {
    const { window, page, calls } = openPage();
    const { document } = window;
    const button = document.getElementById('collectionMenuBtn');
    const menu = () => document.querySelector('.collection-dropdown');
    try {
        page.setFilter('collection:dune');
        await settle(window);
        assert.notEqual(button.style.display, 'none', 'A collection shows its menu button');

        button.click();
        assert.ok(menu(), 'The menu opens');
        assert.ok(menu().classList.contains('open'), 'It carries the class the styles open');
        assert.equal(menu().parentElement, button.parentElement, 'It sits next to the button, not inside it');
        assert.equal(button.getAttribute('aria-expanded'), 'true');

        menu().querySelector('[data-action="edit-collection"]').click();
        assert.equal(calls.edits, 1, 'Edit Collection runs');
        assert.equal(menu(), null, 'Choosing an item closes the menu');
        assert.equal(button.getAttribute('aria-expanded'), 'false');

        button.click();
        document.body.click();
        assert.equal(menu(), null, 'A click elsewhere closes it');

        button.click();
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(menu(), null, 'Escape closes it');

        button.click();
        button.click();
        assert.equal(menu(), null, 'The button toggles it');

        button.click();
        page.setFilter('all');
        assert.equal(menu(), null, 'Leaving the collection closes it');
        assert.equal(button.style.display, 'none');
        await settle(window);
    } finally {
        window.close();
    }
}

(async () => {
    await checkSwitchesReuseData();
    await checkFirstListWarmsTheRest();
    await checkLateRenderDoesNotWin();
    await checkCollectionFromLoadedList();
    await checkCollectionMenu();
    console.log('Bookmarks switching passed: card data and progress load once per visit, a late render cannot replace the chosen list, collections use the loaded list, and the collection menu opens, runs its items and closes (JSDOM).');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
