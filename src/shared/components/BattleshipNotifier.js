import { t, escapeHtml } from '../games/gamesI18n.js';

/**
 * Battleship news on every extension page except the game's own: a challenge,
 * an opponent who joined your game, your turn in a game nobody has open.
 *
 * Firestore cost: one listener on the player's own `battleshipPlayers/{uid}`
 * document, started by Navigation only when mini-games are switched on. What
 * was already shown is kept in chrome.storage.local, so another page or a reload
 * does not repeat it, and a hidden tab waits until it is visible. A Battleship
 * page answers a BroadcastChannel ping with the game it shows, which silences
 * turn news for that game.
 */

export const NOTIFIED_STORAGE_KEY = 'battleshipNotifiedV1';
const COLLECTION = 'battleshipPlayers';
const CHANNEL = 'movielist-battleship';
const PAGE_PATH = 'src/pages/battleship/battleship.html';
const ROOT_ID = 'battleshipNotices';
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_KEYS = 80;
const MAX_VISIBLE = 3;
const PING_WAIT_MS = 200;
const INVITE_VISIBLE_MS = 2 * 60 * 1000;
const NEWS_VISIBLE_MS = 20 * 1000;
const KIND_PRIORITY = { invite: 0, rematch: 0, joined: 1, turn: 2 };

const tb = (key, params) => t(`battleship.${key}`, params);

/**
 * Everything in a player document worth telling about, newest first. Keys are
 * stable per event, so a seen event is never shown again.
 * @param {Object|null} player - battleshipPlayers/{uid} data
 * @param {string} uid
 * @param {number} now - server-independent local time; only expiry uses it
 * @returns {Array<{key: string, kind: string, gameId: string, name: string, photo: string|null, at: number}>}
 */
export function battleshipEvents(player, uid, now) {
    if (!player || !uid) return [];
    const events = [];
    for (const [gameId, invite] of Object.entries(player.invites || {})) {
        if (!invite || Number(invite.expiresAtMs) <= now) continue;
        events.push({
            key: `invite:${gameId}`,
            kind: invite.rematch ? 'rematch' : 'invite',
            gameId,
            name: invite.fromName || tb('game.opponent'),
            photo: invite.fromPhoto || null,
            at: Number(invite.createdAtMs) || 0
        });
    }
    for (const [gameId, summary] of Object.entries(player.games || {})) {
        if (!summary) continue;
        const name = summary.opponentName || tb('game.opponent');
        if (summary.role === 'host' && summary.status === 'placing') {
            events.push({ key: `joined:${gameId}`, kind: 'joined', gameId, name, photo: summary.opponentPhoto || null, at: Number(summary.updatedAtMs) || 0 });
        }
        if (summary.status === 'playing' && summary.turnUid === uid) {
            events.push({
                key: `turn:${gameId}:${Number(summary.updatedAtMs) || 0}`,
                kind: 'turn',
                gameId,
                name,
                photo: summary.opponentPhoto || null,
                at: Number(summary.updatedAtMs) || 0
            });
        }
    }
    return events.sort((a, b) => b.at - a.at);
}

/** Drops entries older than KEEP_MS and keeps the newest MAX_KEYS. */
export function pruneNotified(seen, now) {
    return Object.fromEntries(Object.entries(seen || {})
        .filter(([, at]) => Number(at) > now - KEEP_MS)
        .sort(([, a], [, b]) => Number(b) - Number(a))
        .slice(0, MAX_KEYS));
}

function defaultStorage() {
    const local = globalThis.chrome?.storage?.local;
    if (!local?.get) return null;
    return {
        get: async key => (await local.get([key]))?.[key] ?? null,
        set: async (key, value) => local.set({ [key]: value })
    };
}

function defaultPageUrl(gameId) {
    const path = `${PAGE_PATH}?game=${encodeURIComponent(gameId)}`;
    return globalThis.chrome?.runtime?.getURL ? globalThis.chrome.runtime.getURL(path) : `/${path}`;
}

export class BattleshipNotifier {
    constructor({
        db,
        uid,
        document: doc = globalThis.document,
        storage = defaultStorage(),
        now = () => Date.now(),
        pageUrl = defaultPageUrl,
        channelFactory = name => (typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null)
    }) {
        this.db = db;
        this.uid = uid;
        this.document = doc;
        this.storage = storage;
        this.now = now;
        this.pageUrl = pageUrl;
        this.channelFactory = channelFactory;
        this.player = null;
        this.unsubscribe = null;
        this.flushing = null;
        this.timers = new Set();
        this.handleVisibility = () => {
            if (this.document.visibilityState === 'visible') this.flush();
        };
    }

    start() {
        if (this.unsubscribe || !this.db || !this.uid) return;
        this.unsubscribe = this.db.collection(COLLECTION).doc(this.uid).onSnapshot(snapshot => {
            this.player = snapshot.exists ? snapshot.data() : null;
            this.flush();
        }, error => {
            console.warn('[BattleshipNotifier] player document unavailable:', error?.message || error);
        });
        this.document.addEventListener('visibilitychange', this.handleVisibility);
    }

    stop() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.document.removeEventListener('visibilitychange', this.handleVisibility);
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        this.document.getElementById(ROOT_ID)?.remove();
    }

    flush() {
        // One pass at a time: a second snapshot waits for the first to finish.
        this.flushing = (this.flushing || Promise.resolve()).then(() => this.flushNow()).catch(error => {
            console.warn('[BattleshipNotifier] could not show news:', error?.message || error);
        });
        return this.flushing;
    }

    async flushNow() {
        if (!this.unsubscribe || this.document.visibilityState !== 'visible') return;
        const now = this.now();
        const events = battleshipEvents(this.player, this.uid, now);
        if (!events.length) return;
        const seen = pruneNotified(await this.readSeen(), now);
        const fresh = events.filter(event => !seen[event.key]);
        if (!fresh.length) return;
        const needsPresence = fresh.some(event => event.kind === 'turn' || event.kind === 'joined');
        const openGames = needsPresence ? await this.openGames() : new Set();
        const visible = [];
        const silenced = [];
        for (const event of fresh) {
            const challenge = event.kind === 'invite' || event.kind === 'rematch';
            (challenge || !openGames.has(event.gameId) ? visible : silenced).push(event);
        }
        // Challenges first; what does not fit now stays unseen for the next pass.
        visible.sort((a, b) => (KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]) || (b.at - a.at));
        const shown = visible.slice(0, MAX_VISIBLE);
        for (const event of [...shown, ...silenced]) seen[event.key] = now;
        await this.writeSeen(pruneNotified(seen, now));
        if (!this.unsubscribe) return;
        [...shown].reverse().forEach(event => this.show(event));
    }

    /** Game codes shown by open Battleship pages, collected for a moment. */
    async openGames() {
        const channel = this.channelFactory(CHANNEL);
        if (!channel) return new Set();
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const games = new Set();
        const listener = event => {
            if (event.data?.type === 'pong' && event.data.id === id && event.data.gameId) games.add(event.data.gameId);
        };
        channel.addEventListener('message', listener);
        channel.postMessage({ type: 'ping', id });
        await new Promise(resolve => setTimeout(resolve, PING_WAIT_MS));
        channel.removeEventListener('message', listener);
        channel.close();
        return games;
    }

    async readSeen() {
        try {
            return (await this.storage?.get(NOTIFIED_STORAGE_KEY)) || {};
        } catch {
            return {};
        }
    }

    async writeSeen(seen) {
        try {
            await this.storage?.set(NOTIFIED_STORAGE_KEY, seen);
        } catch {
            // Without storage a reload may show the same news once more.
        }
    }

    root() {
        let root = this.document.getElementById(ROOT_ID);
        if (!root) {
            root = this.document.createElement('section');
            root.id = ROOT_ID;
            root.className = 'battleship-notices';
            root.setAttribute('aria-label', tb('notify.title'));
            this.document.body.append(root);
        }
        return root;
    }

    text(event) {
        return tb(`notify.${event.kind === 'turn' ? 'your_turn' : event.kind}`, { name: event.name });
    }

    show(event) {
        const doc = this.document;
        const root = this.root();
        [...root.children].find(child => child.dataset.key === event.key)?.remove();
        const notice = doc.createElement('div');
        notice.className = 'battleship-notice';
        notice.dataset.key = event.key;
        notice.dataset.kind = event.kind;
        notice.setAttribute('role', event.kind === 'invite' || event.kind === 'rematch' ? 'alert' : 'status');
        const photo = typeof event.photo === 'string' && /^https:\/\//i.test(event.photo) ? event.photo : null;
        const initial = String(event.name || '?').trim().charAt(0).toLocaleUpperCase() || '?';
        notice.innerHTML = `
            <span class="battleship-notice__avatar" aria-hidden="true">${photo
                ? `<img src="${escapeHtml(photo)}" alt="" referrerpolicy="no-referrer">`
                : escapeHtml(initial)}</span>
            <span class="battleship-notice__copy">
                <strong>${escapeHtml(tb('notify.title'))}</strong>
                <span>${escapeHtml(this.text(event))}</span>
            </span>
            <span class="battleship-notice__actions">
                <a class="battleship-notice__open" href="${escapeHtml(this.pageUrl(event.gameId))}">${escapeHtml(tb('notify.open'))}</a>
                <button class="battleship-notice__close" type="button" aria-label="${escapeHtml(tb('notify.later'))}" title="${escapeHtml(tb('notify.later'))}">×</button>
            </span>`;
        const dismiss = () => notice.remove();
        notice.querySelector('.battleship-notice__close').addEventListener('click', dismiss);
        root.append(notice);
        while (root.children.length > MAX_VISIBLE) root.firstElementChild.remove();
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            dismiss();
        }, event.kind === 'invite' || event.kind === 'rematch' ? INVITE_VISIBLE_MS : NEWS_VISIBLE_MS);
        this.timers.add(timer);
    }
}
