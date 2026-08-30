const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'pages', 'search', 'search.js'),
    'utf8'
);

assert(source.includes('waitForFirebaseManager(timeoutMs = 3000)'),
    'Search initialization must bound Firebase manager readiness');
assert(source.includes("reject(new Error('Firebase Manager initialization timed out'))"),
    'A missing Firebase manager must fail visibly instead of leaving the loader pending');
assert(source.includes('async loadCollectionsWithTimeout(timeoutMs = 3000)'),
    'Collection loading must have its own bounded startup path');
assert(source.includes('Promise.race([collectionsPromise, timeoutPromise])'),
    'Offline collection reads must not block the search page indefinitely');
assert(source.includes('void this.loadCollectionsWithTimeout().catch((error) => {'),
    'Collection loading must run in the background, before URL search routing');
assert(source.includes('.then((lateCollections) => {'),
    'Late collection reads must still update the page');
assert(source.includes('this.refreshCollectionMenus();'),
    'Late collection reads must patch existing card collection menus');
assert(source.includes('if (!loaded) routeOwnsResults = false;'),
    'A failed source URL route must release the startup loader');
assert(source.includes('if (!routeOwnsResults && this.searchGeneration === 0)'),
    'Initial cleanup must not replace a route or user-initiated search result');
assert(source.includes('this.hideInitialLoading();'),
    'A failed startup must always restore an interactive search screen');

console.log('searchStartupRecovery.test.js: all tests passed');
