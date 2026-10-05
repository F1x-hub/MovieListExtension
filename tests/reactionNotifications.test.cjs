const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {
    MAX_INBOX_ITEMS,
    getAddedReactionTypes,
    describeReactions,
    buildInboxItems,
    createReactionNotifier,
} = require('../functions/reactionNotifications.js');

function createFakeDb(seed = {}) {
    const docs = new Map(Object.entries(seed));
    const stats = { reads: 0, writes: 0, transactions: 0 };
    const ref = (collection, id) => {
        const key = `${collection}/${id}`;
        return {
            key,
            async get() {
                stats.reads += 1;
                const data = docs.get(key);
                return { exists: data !== undefined, data: () => data };
            },
        };
    };
    return {
        docs,
        stats,
        collection: name => ({ doc: id => ref(name, id) }),
        async runTransaction(callback) {
            stats.transactions += 1;
            return callback({
                get: docRef => docRef.get(),
                set: (docRef, data, options) => {
                    stats.writes += 1;
                    const previous = options?.merge ? docs.get(docRef.key) || {} : {};
                    docs.set(docRef.key, { ...previous, ...data });
                },
            });
        },
    };
}

(async () => {
    // Added types only; removals and unchanged selections do not notify.
    assert.deepEqual(getAddedReactionTypes(null, { types: ['like'] }), ['like']);
    assert.deepEqual(getAddedReactionTypes({ types: ['like'] }, { types: ['like', 'fire'] }), ['fire']);
    assert.deepEqual(getAddedReactionTypes({ types: ['like', 'fire'] }, { types: ['like'] }), []);
    assert.deepEqual(getAddedReactionTypes({ types: ['like'] }, null), []);
    assert.deepEqual(getAddedReactionTypes(null, { type: 'Wow' }), ['wow'], 'legacy scalar type is supported');

    const described = describeReactions(['laugh', 'custom_x'], [
        { id: 'laugh', emoji: '😂', label: 'Funny', renderType: 'unicode' },
        { id: 'custom_x', emoji: ':x:', label: 'X', renderType: 'image', imageUrl: 'https://firebasestorage.googleapis.com/x.png' },
    ]);
    assert.deepEqual(described, [
        { id: 'laugh', emoji: '😂', imageUrl: null, label: 'Funny' },
        { id: 'custom_x', emoji: ':x:', imageUrl: 'https://firebasestorage.googleapis.com/x.png', label: 'X' },
    ]);

    // The inbox is capped and the same reactor/rating pair is replaced.
    let items = [];
    for (let index = 0; index < MAX_INBOX_ITEMS + 5; index += 1) {
        items = buildInboxItems(items, { key: `r${index}_u` });
    }
    assert.equal(items.length, MAX_INBOX_ITEMS);
    assert.equal(items[0].key, `r${MAX_INBOX_ITEMS + 4}_u`);
    items = buildInboxItems(items, { key: 'r10_u', updated: true });
    assert.equal(items.filter(item => item.key === 'r10_u').length, 1);
    assert.equal(items[0].updated, true);

    // End-to-end notifier against a fake Firestore.
    const db = createFakeDb({
        'users/reactor': { displayName: 'Maksim Dragon', photoURL: 'https://example.com/a.png' },
        'movies/662551': { name: 'Хелтер-скелтер', posterUrl: 'https://example.com/p.jpg' },
    });
    const notify = createReactionNotifier({ db, now: () => new Date('2026-10-05T10:00:00Z') });
    const rating = { userId: 'owner', movieId: 662551 };

    assert.equal(await notify({
        ratingId: 'rating1', rating, dataBefore: null,
        dataAfter: { userId: 'owner', types: ['like'] },
    }), false, 'reacting to your own rating does not notify');
    assert.equal(await notify({
        ratingId: 'rating1', rating, dataBefore: { userId: 'reactor', types: ['like', 'fire'] },
        dataAfter: { userId: 'reactor', types: ['like'] },
    }), false, 'removing a reaction does not notify');
    assert.equal(db.stats.reads, 0, 'skipped events cost no reads');

    assert.equal(await notify({
        ratingId: 'rating1', rating, dataBefore: null,
        dataAfter: { userId: 'reactor', types: ['laugh'] },
        reactionDefinitions: [{ id: 'laugh', emoji: '😂', label: 'Funny' }],
    }), true);
    const inbox = db.docs.get('userNotifications/owner');
    assert.equal(inbox.reactions.length, 1);
    assert.deepEqual({ ...inbox.reactions[0], createdAt: undefined }, {
        key: 'rating1_reactor',
        ratingId: 'rating1',
        movieId: '662551',
        movieName: 'Хелтер-скелтер',
        posterUrl: 'https://example.com/p.jpg',
        reactorId: 'reactor',
        reactorName: 'Maksim Dragon',
        reactorPhoto: 'https://example.com/a.png',
        reactions: [{ id: 'laugh', emoji: '😂', imageUrl: null, label: 'Funny' }],
        createdAt: undefined,
    });
    assert.equal(db.stats.writes, 1, 'one write per notified reaction');
    assert.equal(db.stats.reads, 3, 'reactor profile, movie and inbox reads only');

    // A second reaction from the same person replaces the entry.
    await notify({
        ratingId: 'rating1', rating, dataBefore: { userId: 'reactor', types: ['laugh'] },
        dataAfter: { userId: 'reactor', types: ['laugh', 'fire'] },
    });
    const updated = db.docs.get('userNotifications/owner');
    assert.equal(updated.reactions.length, 1);
    assert.deepEqual(updated.reactions[0].reactions.map(reaction => reaction.id), ['laugh', 'fire']);

    // Trigger wiring and the owner-only rules.
    const indexSource = fs.readFileSync(path.join(__dirname, '../functions/index.js'), 'utf8');
    assert.match(indexSource, /createReactionNotifier\(\{ db \}\)/);
    assert.match(indexSource, /await notifyReactionOwner\(\{/);
    assert.match(indexSource, /Owner notification failed/, 'a notification failure must not fail the summary');

    const rules = fs.readFileSync(path.join(__dirname, '../rules/firestore.rules'), 'utf8');
    const block = rules.match(/match \/userNotifications\/\{userId\} \{([\s\S]*?)\n    \}/);
    assert(block, 'userNotifications rules exist');
    assert.match(block[1], /allow get: if isOwner\(userId\);/);
    assert.match(block[1], /allow list: if false;/);
    assert.match(block[1], /hasOnly\(\['reactionsReadAt'\]\)/);
    assert.match(block[1], /reactionsReadAt == request\.time/);
    assert.match(block[1], /allow create, delete: if false;/);

    console.log('Reaction notification server tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
