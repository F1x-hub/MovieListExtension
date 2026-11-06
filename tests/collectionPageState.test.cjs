/**
 * Collection runs its real load and sign-out paths here; only Firebase is
 * replaced. Tests that stubbed applyFilters could not see these paths crash.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const USER = { uid: 'user-1' };
const MANAGERS = {
    collection: 'CollectionPageManager',
    ratings: 'RatingsPageManager',
    bookmarks: 'BookmarksPageManager'
};

function loadManagerClass(window, page) {
    // The test decides when a manager starts.
    const addListener = window.document.addEventListener;
    window.document.addEventListener = function (type, listener, options) {
        if (type !== 'DOMContentLoaded') addListener.call(this, type, listener, options);
    };
    try {
        window.eval(`${read(`src/pages/${page}/${page}.js`).replace(/^import .*;\r?\n/gm, '')}\nwindow.TestManager = ${MANAGERS[page]};`);
    } finally {
        window.document.addEventListener = addListener;
    }
    return window.TestManager;
}

function openCollection() {
    // Exceptions thrown inside event listeners land here instead of being lost.
    const pageErrors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => {
        if (!/^Not implemented/.test(error.message)) pageErrors.push(error.detail || error);
    });
    const dom = new JSDOM(read('src/pages/collection/collection.html'), {
        url: 'https://extension.test/src/pages/collection/collection.html?id=list-1',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        virtualConsole
    });
    const { window } = dom;
    window.chrome = {
        runtime: { getURL: file => file },
        storage: { local: { get: (_keys, done) => done({}) }, onChanged: { addListener() {} } }
    };
    window.eval(read('src/shared/components/SortControl.js'));
    window.firebaseManager = {
        init: async () => {},
        waitForAuthReady: async () => {},
        getCurrentUser: () => USER
    };
    window.CollectionService = class {
        async getCollection() { return { name: 'List', icon: 'L', movieIds: [] }; }
    };
    const Manager = loadManagerClass(window, 'collection');
    return { window, document: window.document, manager: new Manager(), pageErrors };
}

async function settle(window) {
    for (let turn = 0; turn < 25; turn++) await new Promise(resolve => window.setTimeout(resolve, 0));
}

function checkEveryCalledMethodExists() {
    for (const page of Object.keys(MANAGERS)) {
        const dom = new JSDOM('<!doctype html>', { url: 'https://extension.test/', runScripts: 'outside-only' });
        try {
            const source = read(`src/pages/${page}/${page}.js`);
            const { prototype } = loadManagerClass(dom.window, page);
            const called = new Set([...source.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\(/g)].map(match => match[1]));
            const missing = [...called].filter(name => typeof prototype[name] !== 'function'
                && !new RegExp(`\\bthis\\.${name.replace(/\$/g, '\\$')}\\s*=`).test(source));
            assert.deepEqual(missing, [], `${page} calls methods its manager does not have`);
        } finally { dom.window.close(); }
    }
}

async function checkSignOut() {
    const { window, document, pageErrors } = openCollection();
    const element = id => document.getElementById(id);
    const isShown = id => element(id).style.display !== 'none';
    try {
        await settle(window);
        assert.equal(isShown('emptyState'), true, 'An empty collection says so');
        assert.equal(isShown('errorState'), false, 'An empty collection is not an error');

        window.dispatchEvent(new window.CustomEvent('authStateChanged', { detail: { user: null } }));
        await settle(window);

        assert.equal(isShown('errorState'), true, 'Signing out asks to sign in');
        assert.equal(element('errorMessage').textContent, 'Для просмотра коллекции необходимо войти в аккаунт.');
        assert.equal(isShown('emptyState'), false, 'The message replaces the empty state');
        assert.equal(isShown('moviesGrid'), false);
        assert.match(element('resultsCount').textContent, /\b0\b/, 'The old count is cleared');
        assert.deepEqual(pageErrors, [], 'No uncaught exceptions in event listeners');
    } finally {
        window.close();
    }
}

(async () => {
    checkEveryCalledMethodExists();
    await checkSignOut();
    console.log('Collection page state passed: sign-out shows only the sign-in message, and Collection, Ratings and Bookmarks call no missing methods (JSDOM fixtures).');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
