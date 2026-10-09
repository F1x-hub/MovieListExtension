const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const firestoreSource = fs.readFileSync(path.join(__dirname, '../src/shared/firestore.js'), 'utf8');

async function verifySignOutCleanup(keyApi) {
    const store = {
        profile_cache: { displayName: 'Legacy' },
        profile_cache_index: { indexed: 1 },
        profile_cache_indexed: { displayName: 'Indexed' },
        profile_cache_orphan: { displayName: 'Orphan' },
        user_profile_current: { email: 'private@example.test', isAdmin: true },
        user_profile_previous: { approvalStatus: 'approved' },
        language: 'ru',
        theme: 'dark',
        watchlist: ['keep'],
        recent_ratings_cache: ['keep']
    };
    let wholeStorageReads = 0;
    let signedOut = false;
    const storage = {
        async get(keys) {
            if (keys === null) {
                wholeStorageReads++;
                return { ...store };
            }
            return Object.fromEntries(keys.filter(key => Object.hasOwn(store, key)).map(key => [key, store[key]]));
        },
        async set(values) { Object.assign(store, values); },
        async remove(keys) { keys.forEach(key => { delete store[key]; }); }
    };
    if (keyApi === 'available') storage.getKeys = async () => Object.keys(store);
    if (keyApi === 'rejected') storage.getKeys = async () => { throw new Error('getKeys is unavailable in this browser'); };
    const context = vm.createContext({
        window: { firebaseManager: {} },
        chrome: { storage: { local: storage } },
        console: { warn() {}, error() {}, log() {} },
        setTimeout() {},
        clearTimeout() {}
    });
    vm.runInContext(`${firestoreSource}\nglobalThis.FirebaseManagerForTest = FirebaseManager;`, context);
    const manager = Object.create(context.FirebaseManagerForTest.prototype);
    manager.auth = { signOut: async () => { signedOut = true; } };
    await manager.signOut();

    assert.equal(signedOut, true, 'tests the production sign-out path');
    assert.deepEqual(Object.keys(store).filter(key => key.startsWith('profile_cache') || key.startsWith('user_profile_')), [], 'all profile namespaces and orphaned entries are removed');
    assert.equal(store.language, 'ru');
    assert.equal(store.theme, 'dark');
    assert.deepEqual(store.watchlist, ['keep']);
    assert.deepEqual(store.recent_ratings_cache, ['keep']);
    assert.equal(wholeStorageReads, keyApi === 'available' ? 0 : 1, 'uses the all-key fallback only when needed');
}

(async () => {
    await verifySignOutCleanup('available');
    await verifySignOutCleanup('missing');
    await verifySignOutCleanup('rejected');
    console.log('Popup profile-cache sign-out cleanup passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
