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

export const BATTLESHIP_FUNCTION_URL = 'https://us-central1-movielistdb-13208.cloudfunctions.net/battleship';
export const BATTLESHIP_PAGE_PATH = 'src/pages/battleship/battleship.html';
export const BATTLESHIP_CHANNEL = 'movielist-battleship';
export const TURN_IDLE_MS = 5 * 60 * 1000;
export const PLACING_IDLE_MS = 5 * 60 * 1000;
export const TOUCH_INTERVAL_MS = 2 * 60 * 1000;
export const CODE_LENGTH = 6;
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const SEARCH_LIMIT = 8;
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

/** A typed game code ("k7q-2mx", "K7Q 2MX", a pasted link) as the canonical code, or null. */
export function normalizeGameCode(value) {
    const text = String(value ?? '').trim();
    const fromLink = /[?&]game=([A-Za-z0-9]{6})\b/.exec(text)?.[1];
    const code = (fromLink || text).replace(/[\s-]+/g, '').toUpperCase();
    return CODE_PATTERN.test(code) ? code : null;
}

export function battleshipPageUrl(gameId = null) {
    const query = gameId ? `?game=${encodeURIComponent(gameId)}` : '';
    const runtime = globalThis.chrome?.runtime;
    if (runtime?.getURL) return runtime.getURL(`${BATTLESHIP_PAGE_PATH}${query}`);
    return `../battleship/battleship.html${query}`;
}

/** The name a profile shows, following the owner's display preference. */
export function profileDisplayName(profile) {
    if (!profile) return '';
    if (profile.displayNameFormat === 'username' && profile.username) return String(profile.username);
    const fullName = [profile.firstName, profile.lastName].map(part => String(part || '').trim()).filter(Boolean).join(' ');
    return fullName || String(profile.displayName || profile.username || '').trim();
}

function safeHttpsUrl(value) {
    const text = String(value ?? '').trim();
    if (!text || text.length > 2048) return null;
    try {
        return new URL(text).protocol === 'https:' ? text : null;
    } catch {
        return null;
    }
}

function capitalize(text) {
    return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
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

    /**
     * Approved players whose username, first name or display name starts with
     * the text. Three small prefix queries; Firestore matching is case-sensitive,
     * so names are tried capitalized and usernames lowercased.
     */
    async searchPlayers(text) {
        const query = String(text ?? '').trim().replace(/^@/, '');
        if (query.length < 2) return [];
        const db = this._requireDb();
        const users = db.collection('users');
        const prefix = (field, value) => users.where(field, '>=', value).where(field, '<=', `${value}\uf8ff`).limit(SEARCH_LIMIT).get();
        const lower = query.toLocaleLowerCase();
        const capital = capitalize(query);
        const answers = await Promise.allSettled([
            prefix('usernameLower', lower),
            prefix('firstName', capital),
            prefix('displayName', capital)
        ]);
        if (answers.every(answer => answer.status === 'rejected')) throw answers[0].reason;
        const selfUid = this.currentUser()?.uid || null;
        const players = new Map();
        for (const answer of answers) {
            if (answer.status !== 'fulfilled') continue;
            for (const doc of answer.value.docs) {
                const profile = doc.data() || {};
                if (doc.id === selfUid || players.has(doc.id)) continue;
                if (profile.approvalStatus && profile.approvalStatus !== 'approved') continue;
                const name = profileDisplayName(profile);
                if (!name) continue;
                players.set(doc.id, {
                    uid: doc.id,
                    name,
                    username: profile.username ? String(profile.username) : null,
                    photo: safeHttpsUrl(profile.photoURL)
                });
            }
        }
        return [...players.values()].slice(0, SEARCH_LIMIT);
    }
}
