// ProfileService keeps a user's ratings in chrome.storage and asks Firestore only for changes.
const assert = require('node:assert/strict');

class Timestamp {
    constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
    static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
    toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
}
global.firebase = { firestore: { Timestamp } };

const store = {};
global.chrome = {
    storage: {
        local: {
            async get(keys) {
                if (keys === null) return { ...store };
                return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in store).map((k) => [k, store[k]]));
            },
            async set(values) { Object.assign(store, JSON.parse(JSON.stringify(values))); },
            async remove(keys) { for (const k of [].concat(keys)) delete store[k]; }
        }
    }
};

const ProfileService = require('../src/shared/services/ProfileService.js');

const ts = (ms) => Timestamp.fromMillis(ms);
let docs = [];
let reads = 0;
let countValue = () => docs.filter((d) => d.userId === 'u1').length;

function snapshotOf(list) {
    reads += list.length;
    return { forEach: (fn) => list.forEach((d) => fn({ id: d.id, data: () => ({ ...d }) })) };
}

function query(filters = []) {
    return {
        where(field, op, value) { return query([...filters, { field, op, value }]); },
        async get() {
            return snapshotOf(docs.filter((d) => filters.every(({ field, op, value }) => {
                if (op === '==') return d[field] === value;
                if (op === '>=') return d[field] && d[field].toMillis() >= value.toMillis();
                throw new Error('unexpected op ' + op);
            })));
        }
    };
}

function makeService() {
    const service = Object.create(ProfileService.prototype);
    service.db = { collection: () => query() };
    service.firebaseManager = { countDocuments: async () => countValue() };
    service.userRatingsCache = new Map();
    return service;
}

(async () => {
    docs = [
        { id: 'r1', userId: 'u1', rating: 7, createdAt: ts(1000), updatedAt: ts(1000) },
        { id: 'r2', userId: 'u1', rating: 9, createdAt: ts(2000), updatedAt: ts(2000) },
        { id: 'r3', userId: 'u1', rating: 5, createdAt: ts(3000) }, // legacy: no updatedAt
        { id: 'x1', userId: 'u2', rating: 4, createdAt: ts(500), updatedAt: ts(500) }
    ];

    // First visit: a full read, stored with the newest server time seen.
    reads = 0;
    let ratings = await makeService().readUserRatings('u1');
    assert.equal(ratings.length, 3);
    assert.equal(reads, 3);
    const key = 'profile_cache_ratings_u1';
    assert.ok(key.startsWith('profile_cache_'), 'sign-out clears profile_cache_* keys');
    assert.equal(store[key].syncedAt, 3000);

    // Nothing changed: only the newest document comes back, not all of them.
    reads = 0;
    ratings = await makeService().readUserRatings('u1');
    assert.equal(ratings.length, 3);
    assert.ok(reads < 3, `unchanged ratings are not read again (${reads} reads)`);
    assert.ok(ratings.find((r) => r.id === 'r1').createdAt instanceof Timestamp, 'timestamps come back as Timestamps');

    // A new rating and a changed score arrive as the delta.
    docs.push({ id: 'r4', userId: 'u1', rating: 8, createdAt: ts(5000), updatedAt: ts(5000) });
    docs.find((d) => d.id === 'r1').rating = 10;
    docs.find((d) => d.id === 'r1').updatedAt = ts(6000);
    ratings = await makeService().readUserRatings('u1');
    assert.equal(ratings.length, 4);
    assert.equal(ratings.find((r) => r.id === 'r1').rating, 10);
    assert.equal(store[key].syncedAt, 6000);

    // A review text edit sets only contentUpdatedAt; it is picked up too.
    docs.find((d) => d.id === 'r3').comment = 'new text';
    docs.find((d) => d.id === 'r3').contentUpdatedAt = ts(7000);
    ratings = await makeService().readUserRatings('u1');
    assert.equal(ratings.find((r) => r.id === 'r3').comment, 'new text');

    // A deletion: the count no longer matches, so everything is read again.
    docs = docs.filter((d) => d.id !== 'r2');
    reads = 0;
    ratings = await makeService().readUserRatings('u1');
    assert.deepEqual(ratings.map((r) => r.id).sort(), ['r1', 'r3', 'r4']);
    assert.equal(reads >= 3, true, 'a deletion falls back to the full read');

    // No count (offline function, missing token): the full read, never a guess.
    countValue = () => null;
    reads = 0;
    ratings = await makeService().readUserRatings('u1');
    assert.equal(ratings.length, 3);
    assert.ok(reads >= 3);

    console.log('profileRatingsStore.test.cjs: all tests passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
