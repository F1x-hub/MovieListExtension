/**
 * A custom collection opens inside Bookmarks: the old collection page only sends
 * its links there, and deleting a collection asks through the shared ConfirmDialog.
 * Ratings and Bookmarks are also checked for calls to methods they do not have.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const MANAGERS = {
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

function redirectFor(search) {
    const replaced = [];
    const window = { location: { search, replace: url => replaced.push(url) } };
    vm.runInNewContext(read('src/pages/collection/collection.js'), { window, URLSearchParams });
    return replaced;
}

function checkOldCollectionLinks() {
    assert.deepEqual(redirectFor('?id=list-1'), ['../bookmarks/bookmarks.html?filter=collection:list-1']);
    assert.deepEqual(redirectFor('?id=a%20b%26c'), ['../bookmarks/bookmarks.html?filter=collection:a%20b%26c'],
        'The id is passed on encoded');
    assert.deepEqual(redirectFor(''), ['../bookmarks/bookmarks.html'], 'Without an id the link opens Bookmarks');

    const html = read('src/pages/collection/collection.html');
    assert.doesNotMatch(html, /deleteCollectionModal|class="modal/, 'The old page has no dialog of its own');
    assert.match(html, /<script src="collection\.js"><\/script>/);
}

function checkDeleteAsksThroughConfirmDialog() {
    const source = read('src/pages/bookmarks/bookmarks.js');
    const remove = source.match(/\n {4}async deleteActiveCollection\(\) \{[\s\S]*?\n {4}\}/);
    assert.ok(remove, 'Bookmarks deletes the open collection');
    assert.match(remove[0], /await ConfirmDialog\.confirm\(\{[\s\S]*danger: true/);
    assert.ok(remove[0].indexOf('ConfirmDialog.confirm') < remove[0].indexOf('deleteCollection('),
        'The collection is deleted only after the confirmation');
    assert.match(read('src/pages/bookmarks/bookmarks.html'), /shared\/components\/ConfirmDialog\.js/);
}

checkEveryCalledMethodExists();
checkOldCollectionLinks();
checkDeleteAsksThroughConfirmDialog();
console.log('Collection page state passed: old collection links open the collection in Bookmarks, deleting asks through ConfirmDialog, and Ratings and Bookmarks call no missing methods.');
