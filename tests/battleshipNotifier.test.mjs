import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
globalThis.window = dom.window;
const { document } = dom.window;

const { BattleshipNotifier, NOTIFIED_STORAGE_KEY, battleshipEvents, pruneNotified } = await import('../src/shared/components/BattleshipNotifier.js');

const NOW = 1_000_000;
const player = {
    invites: {
        INVITE: { fromName: 'Алиса', fromPhoto: 'https://example.test/a.png', createdAtMs: NOW - 10, expiresAtMs: NOW + 60_000 },
        REMTCH: { fromName: 'Борис', rematch: true, createdAtMs: NOW - 20, expiresAtMs: NOW + 60_000 },
        EXPIRD: { fromName: 'Старый', createdAtMs: NOW - 99_999, expiresAtMs: NOW - 1 }
    },
    games: {
        JOINED: { role: 'host', status: 'placing', opponentName: 'Вера', updatedAtMs: NOW - 5 },
        MYTURN: { role: 'guest', status: 'playing', turnUid: 'me', opponentName: 'Глеб', updatedAtMs: NOW - 3 },
        OPENED: { role: 'host', status: 'playing', turnUid: 'me', opponentName: 'Дина', updatedAtMs: NOW - 2 },
        THEIRS: { role: 'host', status: 'playing', turnUid: 'other', opponentName: 'Ева', updatedAtMs: NOW - 1 },
        WAITNG: { role: 'host', status: 'waiting', updatedAtMs: NOW - 1 }
    }
};

const events = battleshipEvents(player, 'me', NOW);
assert.deepEqual(events.map(event => event.key).sort(), [
    'invite:INVITE', 'invite:REMTCH', 'joined:JOINED', `turn:MYTURN:${NOW - 3}`, `turn:OPENED:${NOW - 2}`
].sort(), 'expired challenges, the opponent\'s turn and waiting games are not news');
assert.equal(events.find(event => event.gameId === 'REMTCH').kind, 'rematch');
assert.deepEqual(battleshipEvents(null, 'me', NOW), []);
assert.deepEqual(Object.keys(pruneNotified({ old: NOW - 4 * 24 * 3600 * 1000, fresh: NOW - 10 }, NOW)), ['fresh']);

// --- The notifier on a page ------------------------------------------------------------
let snapshotListener = null;
const db = {
    collection(name) {
        assert.equal(name, 'battleshipPlayers');
        return {
            doc(uid) {
                assert.equal(uid, 'me');
                return {
                    onSnapshot(next) {
                        snapshotListener = next;
                        return () => { snapshotListener = null; };
                    }
                };
            }
        };
    }
};
const stored = {};
const storage = {
    get: async key => stored[key] ?? null,
    set: async (key, value) => { stored[key] = JSON.parse(JSON.stringify(value)); }
};
// A Battleship page somewhere shows the game OPENED.
const channelFactory = () => {
    const listeners = new Set();
    return {
        addEventListener: (type, listener) => listeners.add(listener),
        removeEventListener: (type, listener) => listeners.delete(listener),
        postMessage(message) {
            if (message.type === 'ping') {
                setTimeout(() => listeners.forEach(listener => listener({ data: { type: 'pong', id: message.id, gameId: 'OPENED' } })), 5);
            }
        },
        close() {}
    };
};
let visibility = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

const notifier = new BattleshipNotifier({
    db,
    uid: 'me',
    document,
    storage,
    now: () => NOW,
    pageUrl: gameId => `chrome-extension://test/src/pages/battleship/battleship.html?game=${gameId}`,
    channelFactory
});
notifier.start();
assert.ok(snapshotListener, 'the notifier listens to the player document');

const snapshot = data => ({ exists: Boolean(data), data: () => data });
snapshotListener(snapshot(player));
await notifier.flushing;
let notices = [...document.querySelectorAll('.battleship-notice')];
assert.equal(notices.length, 3, 'at most three notices at a time');
const keys = notices.map(notice => notice.dataset.key);
assert.deepEqual(keys.sort(), ['invite:INVITE', 'invite:REMTCH', 'joined:JOINED'], 'challenges come first, then a joined game');
assert.equal(stored[NOTIFIED_STORAGE_KEY][`turn:MYTURN:${NOW - 3}`], undefined, 'what did not fit is not marked as seen');
const invite = notices.find(notice => notice.dataset.key === 'invite:INVITE');
assert.equal(invite.getAttribute('role'), 'alert');
assert.match(invite.textContent, /Алиса/);
assert.equal(invite.querySelector('a').getAttribute('href'), 'chrome-extension://test/src/pages/battleship/battleship.html?game=INVITE');
assert.equal(invite.querySelector('img').getAttribute('src'), 'https://example.test/a.png');
assert.ok(stored[NOTIFIED_STORAGE_KEY]['invite:INVITE'], 'shown news is remembered');
assert.ok(stored[NOTIFIED_STORAGE_KEY][`turn:OPENED:${NOW - 2}`], 'silenced news is remembered too');

invite.querySelector('.battleship-notice__close').click();
assert.equal(document.querySelectorAll('.battleship-notice').length, 2, 'a notice closes on «Later»');

// The same document again shows only what did not fit before.
document.getElementById('battleshipNotices').remove();
snapshotListener(snapshot(player));
await notifier.flushing;
assert.deepEqual([...document.querySelectorAll('.battleship-notice')].map(notice => notice.dataset.key), [`turn:MYTURN:${NOW - 3}`]);
document.getElementById('battleshipNotices').remove();
snapshotListener(snapshot(player));
await notifier.flushing;
assert.equal(document.querySelectorAll('.battleship-notice').length, 0, 'then nothing is repeated');

// A hidden tab waits until it is visible.
visibility = 'hidden';
const next = JSON.parse(JSON.stringify(player));
next.games.MYTURN.updatedAtMs = NOW;
snapshotListener(snapshot(next));
await notifier.flushing;
assert.equal(document.querySelectorAll('.battleship-notice').length, 0, 'nothing is shown in a hidden tab');
visibility = 'visible';
document.dispatchEvent(new dom.window.Event('visibilitychange'));
await notifier.flushing;
notices = [...document.querySelectorAll('.battleship-notice')];
assert.deepEqual(notices.map(notice => notice.dataset.key), [`turn:MYTURN:${NOW}`]);
assert.match(notices[0].textContent, /Глеб/);

notifier.stop();
assert.equal(snapshotListener, null, 'stop() ends the listener');
assert.equal(document.getElementById('battleshipNotices'), null);

console.log('✅ Battleship notifier tests passed');
process.exit(0);
