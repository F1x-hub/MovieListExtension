/**
 * Client for networked Battleship between extension users.
 *
 * Reads and live subscriptions go straight to Firestore (`battleshipGames`,
 * its owner-only `fleets`, the player's own `battleshipPlayers` document and the
 * `battleshipLobby/open` list). Every change is a POST to the server-owned
 * `battleship` Cloud Function, which resolves shots and keeps fleets hidden.
 * Its answers carry the server clock, so idle timers follow server time and not
 * a skewed local clock.
 */

import { normalizeGameCode, profileDisplayName, searchApprovedPlayers } from './OnlinePlayers.js';

// Shared with chess; re-exported for the Battleship page and its tests.
export { normalizeGameCode, profileDisplayName };

export const BATTLESHIP_FUNCTION_URL = 'https://us-central1-movielistdb-13208.cloudfunctions.net/battleship';
export const BATTLESHIP_PAGE_PATH = 'src/pages/battleship/battleship.html';
export const BATTLESHIP_CHANNEL = 'movielist-battleship';
export const TURN_IDLE_MS = 5 * 60 * 1000;
export const PLACING_IDLE_MS = 5 * 60 * 1000;
export const TOUCH_INTERVAL_MS = 2 * 60 * 1000;
export const CODE_LENGTH = 6;
// A clock sample older than this is replaced even by a slower round trip.
const CLOCK_SAMPLE_TTL_MS = 60 * 1000;

export class BattleshipError extends Error {
    constructor(message, { code = 'UNKNOWN', status = 0, details = null, cause = null } = {}) {
        super(message);
        this.name = 'BattleshipError';
        this.code = code;
        this.status = status;
        this.details = details;
        if (cause) this.cause = cause;
    }
}

export function battleshipPageUrl(gameId = null) {
    const query = gameId ? `?game=${encodeURIComponent(gameId)}` : '';
    const runtime = globalThis.chrome?.runtime;
    if (runtime?.getURL) return runtime.getURL(`${BATTLESHIP_PAGE_PATH}${query}`);
    return `../battleship/battleship.html${query}`;
}

export class BattleshipService {
    /**
     * @param {Object} [options]
     * @param {Object} [options.firebaseManager]
     * @param {Function} [options.fetchImpl]
     * @param {string} [options.url]
     * @param {Function} [options.now]
     */
    constructor({
        firebaseManager = globalThis.firebaseManager,
        fetchImpl = (...args) => globalThis.fetch(...args),
        url = BATTLESHIP_FUNCTION_URL,
        now = () => Date.now()
    } = {}) {
        this.firebaseManager = firebaseManager;
        this.fetchImpl = fetchImpl;
        this.url = url;
        this.now = now;
        this.clockOffsetMs = 0;
        this.clockSample = null;
    }

    get db() {
        return this.firebaseManager?.db || null;
    }

    /**
     * The signed-in Firebase user. The manager can briefly hold the chrome.storage
     * copy of a session, which has no ID token, so the Auth instance comes first.
     */
    currentUser() {
        return this.firebaseManager?.auth?.currentUser || this.firebaseManager?.getCurrentUser?.() || null;
    }

    /** Server time, estimated from the latest answers of the function. */
    serverNow() {
        return this.now() + this.clockOffsetMs;
    }

    noteServerTime(serverTimeMs, sentAt, receivedAt) {
        if (!Number.isFinite(serverTimeMs) || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt)) return;
        const roundTrip = Math.max(0, receivedAt - sentAt);
        const sample = { offset: serverTimeMs - (sentAt + receivedAt) / 2, roundTrip, at: receivedAt };
        const previous = this.clockSample;
        // The fastest recent round trip gives the closest estimate.
        if (!previous || roundTrip <= previous.roundTrip || receivedAt - previous.at > CLOCK_SAMPLE_TTL_MS) {
            this.clockSample = sample;
            this.clockOffsetMs = sample.offset;
        }
    }

    async call(action, payload = {}) {
        const user = this.currentUser();
        if (!user || typeof user.getIdToken !== 'function') {
            throw new BattleshipError('Sign in to play', { code: 'AUTH_REQUIRED', status: 401 });
        }
        const token = await user.getIdToken();
        const sentAt = this.now();
        let response;
        try {
            response = await this.fetchImpl(this.url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, action })
            });
        } catch (error) {
            throw new BattleshipError('No connection to the game server', { code: 'NETWORK', cause: error });
        }
        const receivedAt = this.now();
        const result = await response.json().catch(() => null);
        if (Number.isFinite(result?.serverTimeMs)) this.noteServerTime(result.serverTimeMs, sentAt, receivedAt);
        if (!response.ok || !result?.ok) {
            const code = result?.code || (response.status === 401 ? 'AUTH_REQUIRED' : response.status >= 500 ? 'INTERNAL' : 'UNKNOWN');
            throw new BattleshipError(result?.error || `Battleship request failed (${response.status})`, {
                code,
                status: response.status,
                details: result?.details || null
            });
        }
        return result;
    }

    ping() {
        return this.call('ping');
    }

    create({ visibility = 'private', invitedUid = null } = {}) {
        return this.call('create', { visibility, ...(invitedUid ? { invitedUid } : {}) });
    }

    join(gameId) {
        return this.call('join', { gameId });
    }

    decline(gameId) {
        return this.call('decline', { gameId });
    }

    cancel(gameId) {
        return this.call('cancel', { gameId });
    }

    touch(gameId) {
        return this.call('touch', { gameId });
    }

    place(gameId, ships) {
        return this.call('place', {
            gameId,
            ships: ships.map(({ x, y, length, vertical }) => ({ x, y, length, vertical: Boolean(vertical) }))
        });
    }

    fire(gameId, index, expectedMove) {
        return this.call('fire', { gameId, index, expectedMove });
    }

    resign(gameId) {
        return this.call('resign', { gameId });
    }

    claim(gameId) {
        return this.call('claim', { gameId });
    }

    rematch(gameId) {
        return this.call('rematch', { gameId });
    }

    _subscribe(ref, onData, onError) {
        return ref.onSnapshot(
            snapshot => onData(snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null),
            error => onError?.(error)
        );
    }

    _requireDb() {
        if (!this.db) throw new BattleshipError('Firebase is not ready', { code: 'NOT_READY' });
        return this.db;
    }

    subscribeGame(gameId, onData, onError) {
        return this._subscribe(this._requireDb().collection('battleshipGames').doc(gameId), onData, onError);
    }

    subscribeFleet(gameId, uid, onData, onError) {
        const ref = this._requireDb().collection('battleshipGames').doc(gameId).collection('fleets').doc(uid);
        return this._subscribe(ref, onData, onError);
    }

    subscribePlayer(uid, onData, onError) {
        return this._subscribe(this._requireDb().collection('battleshipPlayers').doc(uid), onData, onError);
    }

    subscribeLobby(onData, onError) {
        return this._subscribe(this._requireDb().collection('battleshipLobby').doc('open'), onData, onError);
    }

    /** Approved players whose name or @username starts with the text. */
    async searchPlayers(text) {
        if (String(text ?? '').trim().replace(/^@/, '').length < 2) return [];
        return searchApprovedPlayers(this._requireDb(), text, { selfUid: this.currentUser()?.uid || null });
    }
}
