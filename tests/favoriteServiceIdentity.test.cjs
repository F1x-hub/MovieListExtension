const assert = require('node:assert/strict');
const FavoriteService = require('../src/shared/services/FavoriteService.js');

async function run() {
    const writes = [];
    const collectionReads = [];
    const warnings = [];
    const previousWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    global.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } };
    global.chrome = { storage: { local: { async remove() {}, async set() {} } } };
    const db = {
        collection(name) {
            collectionReads.push(name);
            return { doc(id) {
                return {
                    async get() { return { exists: false }; },
                    async set(data, options) { writes.push({ name, id, data, options }); }
                };
            } };
        }
    };
    const service = new FavoriteService({ db });

    await assert.rejects(
        service.addToFavorites('user-a', { movieId: 178720, kinopoiskId: 39231, name: 'Warehouse 13' }, 'plan_to_watch'),
        /conflicts with Kinopoisk ID/
    );
    assert.equal(collectionReads.length, 0, 'Conflicting identities are rejected before Firestore access');
    assert.equal(writes.length, 0);
    assert.equal(warnings.length, 1, 'Conflicting identities are logged');

    await service.addToFavorites('user-a', { movieId: 178720, kinopoiskId: 178720, name: 'Firefly' }, 'plan_to_watch');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].id, 'user-a_178720');
    assert.equal(writes[0].data.movieId, 178720);
    assert.equal(writes[0].data.status, 'plan_to_watch');
    console.warn = previousWarn;
    console.log('FavoriteService rejects inconsistent movieId and kinopoiskId before writing');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
