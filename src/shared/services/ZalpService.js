/**
 * Client for networked Salvo (Залп). The `zalp` Cloud Function owns every change; the page reads
 * `zalpGames/{code}`, `zalpTurns/{code}-{n}` and `zalpLobby/open` through Firestore listeners.
 * Responses carry `serverTimeMs`, so turn deadlines are compared on the server's clock.
 */
export const ZALP_FUNCTION_URL = 'https://us-central1-movielistdb-13208.cloudfunctions.net/zalp';
export const ZALP_PAGE_PATH = 'src/pages/zalp/zalp.html';
export const ZALP_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const CLOCK_SAMPLE_TTL_MS = 5 * 60 * 1000;

export function normalizeZalpCode(value) {
    const code = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return ZALP_CODE_PATTERN.test(code) ? code : null;
}

export class ZalpError extends Error {
    constructor(message, { code = 'UNKNOWN', status = 0, details = null, cause = null } = {}) {
        super(message);
        this.name = 'ZalpError';
        this.code = code;
        this.status = status;
        this.details = details;
        if (cause) this.cause = cause;
    }
}

export class ZalpService {
    constructor({ firebaseManager = globalThis.firebaseManager, fetchImpl = (...args) => globalThis.fetch(...args), url = ZALP_FUNCTION_URL, now = () => Date.now() } = {}) {
        this.firebaseManager = firebaseManager;
        this.fetchImpl = fetchImpl;
        this.url = url;
        this.now = now;
        this.clockOffsetMs = 0;
        this.clockSample = null;
    }

    get db() { return this.firebaseManager?.db || null; }

    currentUser() {
        return this.firebaseManager?.auth?.currentUser || this.firebaseManager?.getCurrentUser?.() || null;
    }

    serverNow() { return this.now() + this.clockOffsetMs; }

    noteServerTime(serverTimeMs, sentAt, receivedAt) {
        if (!Number.isFinite(serverTimeMs) || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt)) return;
        const roundTrip = Math.max(0, receivedAt - sentAt);
        const sample = { offset: serverTimeMs - (sentAt + receivedAt) / 2, roundTrip, at: receivedAt };
        const previous = this.clockSample;
        if (!previous || roundTrip <= previous.roundTrip || receivedAt - previous.at > CLOCK_SAMPLE_TTL_MS) {
            this.clockSample = sample;
            this.clockOffsetMs = sample.offset;
        }
    }

    async call(action, payload = {}) {
        const user = this.currentUser();
        if (!user || typeof user.getIdToken !== 'function') throw new ZalpError('Sign in to play online', { code: 'AUTH_REQUIRED', status: 401 });
        const token = await user.getIdToken();
        const sentAt = this.now();
        let response;
        try {
            response = await this.fetchImpl(this.url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, action }),
            });
        } catch (error) {
            throw new ZalpError('No connection to the game server', { code: 'NETWORK', cause: error });
        }
        const receivedAt = this.now();
        const result = await response.json().catch(() => null);
        if (Number.isFinite(result?.serverTimeMs)) this.noteServerTime(result.serverTimeMs, sentAt, receivedAt);
        if (!response.ok || !result?.ok) {
            const code = result?.code || (response.status === 401 ? 'AUTH_REQUIRED' : response.status >= 500 ? 'INTERNAL' : 'UNKNOWN');
            throw new ZalpError(result?.error || `Salvo request failed (${response.status})`, { code, status: response.status, details: result?.details || null });
        }
        return result;
    }

    create({ visibility = 'private', theme = 'random' } = {}) { return this.call('create', { visibility, theme }); }
    join(gameId) { return this.call('join', { gameId }); }
    leave(gameId) { return this.call('leave', { gameId }); }
    touch(gameId) { return this.call('touch', { gameId }); }
    start(gameId, theme) { return this.call('start', { gameId, theme }); }
    stream(gameId, turn, from, data) { return this.call('stream', { gameId, turn, from, data }); }
    endTurn(gameId, turn, payload) { return this.call('endTurn', { gameId, turn, ...payload }); }
    timeout(gameId, turn) { return this.call('timeout', { gameId, turn }); }

    _requireDb() {
        if (!this.db) throw new ZalpError('Firebase is not ready', { code: 'NOT_READY' });
        return this.db;
    }

    _subscribe(ref, onData, onError) {
        return ref.onSnapshot(
            (snapshot) => onData(snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null),
            (error) => onError?.(error)
        );
    }

    subscribeGame(code, onData, onError) { return this._subscribe(this._requireDb().collection('zalpGames').doc(code), onData, onError); }
    subscribeTurn(code, n, onData, onError) { return this._subscribe(this._requireDb().collection('zalpTurns').doc(`${code}-${n}`), onData, onError); }
    subscribeLobby(onData, onError) { return this._subscribe(this._requireDb().collection('zalpLobby').doc('open'), onData, onError); }
}
