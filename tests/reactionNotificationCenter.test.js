import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
    CHECK_INTERVAL_MS,
    getUnreadReactions,
    toMillis,
    ReactionNotificationCenter
} from '../src/shared/components/ReactionNotifications.js';

console.log('🧪 Running reaction notification center tests...');

const timestamp = ms => ({ toMillis: () => ms });

function createDb(data) {
    const stats = { reads: 0, updates: [] };
    return {
        stats,
        collection: name => ({
            doc: id => ({
                async get() {
                    stats.reads += 1;
                    return { exists: Boolean(data), data: () => data };
                },
                async update(patch) {
                    stats.updates.push({ name, id, patch });
                }
            })
        })
    };
}

function createStorage() {
    const values = new Map();
    return {
        values,
        get: async key => values.get(key) ?? null,
        set: async (key, value) => { values.set(key, JSON.parse(JSON.stringify(value))); },
        remove: async key => { values.delete(key); }
    };
}

const inbox = {
    reactionsReadAt: timestamp(1000),
    reactions: [
        {
            key: 'r1_a', movieId: '662551', movieName: 'Хелтер-скелтер',
            reactorName: '<img src=x onerror=alert(1)>', reactorPhoto: 'javascript:alert(1)',
            reactions: [{ id: 'laugh', emoji: '😂', label: 'Funny' }], createdAt: timestamp(3000)
        },
        { key: 'r2_b', movieId: '1', movieName: 'Old', reactions: [], createdAt: timestamp(500) },
        { key: 'r3_c', movieId: '2', movieName: 'Newer', reactions: [], createdAt: { seconds: 4, nanoseconds: 0 } },
        { key: 'r4_d', movieId: '3', reactions: [], createdAt: timestamp(2000) },
        { key: 'r5_e', movieId: '4', reactions: [], createdAt: timestamp(2500) }
    ]
};

(async () => {
    assert.equal(toMillis({ seconds: 2, nanoseconds: 500000000 }), 2500);
    assert.equal(toMillis(null), 0);

    const unread = getUnreadReactions(inbox);
    assert.deepEqual(unread.map(item => item.key), ['r3_c', 'r1_a', 'r5_e', 'r4_d'],
        'only entries newer than the read stamp, newest first');
    assert.equal(unread.find(item => item.key === 'r1_a').reactorPhoto, null, 'non-https photos are dropped');
    assert.deepEqual(getUnreadReactions(null), []);

    const dom = new JSDOM('<!doctype html><body></body>');
    const document = dom.window.document;
    const storage = createStorage();
    const db = createDb(inbox);
    let now = 100000;
    const navigated = [];
    const options = {
        db,
        storage,
        document,
        now: () => now,
        serverTimestamp: () => 'SERVER_TIME',
        movieUrl: id => `movie:${id}`,
        navigate: url => navigated.push(url)
    };

    const center = new ReactionNotificationCenter(options);
    const shown = await center.checkOnOpen('owner');
    assert.equal(shown.length, 4);
    assert.equal(db.stats.reads, 1, 'one document read on open');
    const card = document.getElementById('reactionInbox');
    assert(card, 'the card is rendered');
    assert.equal(card.querySelectorAll('.reaction-inbox__item').length, 3, 'at most three entries are listed');
    assert.equal(card.querySelector('.reaction-inbox__more').textContent, 'Ещё 1');
    assert.equal(card.querySelectorAll('img[src="x"]').length, 0, 'provider text is never parsed as HTML');
    assert.match(card.textContent, /Хелтер-скелтер/);

    // The same page does not check twice.
    assert.equal((await center.checkOnOpen('owner')).length, 0);
    assert.equal(db.stats.reads, 1);

    // Another page within the interval reuses the shared result: no read.
    document.getElementById('reactionInbox').remove();
    const secondPage = new ReactionNotificationCenter(options);
    now += CHECK_INTERVAL_MS - 1;
    assert.equal((await secondPage.checkOnOpen('owner')).length, 4);
    assert.equal(db.stats.reads, 1, 'pages opened within the interval reuse the cached inbox');

    // Opening an entry marks the inbox read with one write and navigates.
    document.querySelector('.reaction-inbox__item').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(db.stats.updates, [{
        name: 'userNotifications', id: 'owner', patch: { reactionsReadAt: 'SERVER_TIME' }
    }]);
    assert.deepEqual(navigated, ['movie:2']);
    assert.equal(document.getElementById('reactionInbox'), null, 'the card closes');

    const thirdPage = new ReactionNotificationCenter(options);
    assert.equal((await thirdPage.checkOnOpen('owner')).length, 0, 'read entries are not shown again');
    assert.equal(db.stats.reads, 1);

    // After the interval the inbox is read again (one read).
    now += CHECK_INTERVAL_MS + 1;
    const later = new ReactionNotificationCenter({ ...options, db: createDb({ reactions: [] }) });
    assert.equal((await later.checkOnOpen('owner')).length, 0);
    assert.equal(later.db.stats.reads, 1);
    assert.equal(document.getElementById('reactionInbox'), null, 'nothing is rendered without unread entries');

    // A failed read shows nothing and does not throw.
    const failing = new ReactionNotificationCenter({
        ...options,
        storage: createStorage(),
        db: { collection: () => ({ doc: () => ({ get: async () => { throw new Error('offline'); } }) }) }
    });
    const originalWarn = console.warn;
    console.warn = () => {};
    assert.deepEqual(await failing.checkOnOpen('owner'), []);
    console.warn = originalWarn;

    console.log('✅ Reaction notification center tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
