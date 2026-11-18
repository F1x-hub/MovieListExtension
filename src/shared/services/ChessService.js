import { normalizeGameCode, searchApprovedPlayers } from './OnlinePlayers.js';

/**
 * Client for networked chess between extension users.
 *
 * Reads and live subscriptions go straight to Firestore (`chessGames`, the
 * player's own `chessPlayers` document and `chessLobby/open`). Every change is a
 * POST to the server-owned `chess` Cloud Function, which replays and checks each
 * move. Its answers carry the server clock; `serverNow()` turns that into the
 * time the game clocks run on.
 */

export const CHESS_FUNCTION_URL = 'https://us-central1-movielistdb-13208.cloudfunctions.net/chess';
export const CHESS_PAGE_PATH = 'src/pages/chess/chess.html';
export const CHESS_CHANNEL = 'movielist-chess';
export const TOUCH_INTERVAL_MS = 2 * 60 * 1000;
export const FIRST_MOVE_MS = 60 * 1000;
export const DAILY_MOVE_MS = 24 * 60 * 60 * 1000;
export const TIME_CONTROLS = Object.freeze({
    '3+2': Object.freeze({ initialMs: 3 * 60 * 1000, incrementMs: 2000 }),
    '5+3': Object.freeze({ initialMs: 5 * 60 * 1000, incrementMs: 3000 }),
    '10+5': Object.freeze({ initialMs: 10 * 60 * 1000, incrementMs: 5000 }),
    '15+10': Object.freeze({ initialMs: 15 * 60 * 1000, incrementMs: 10000 }),
    none: null
});
// A clock sample older than this is replaced even by a slower round trip.
const CLOCK_SAMPLE_TTL_MS = 60 * 1000;

export { normalizeGameCode };

export class ChessError extends Error {
    constructor(message, { code = 'UNKNOWN', status = 0, details = null, cause = null } = {}) {
        super(message);
        this.name = 'ChessError';
        this.code = code;
        this.status = status;
        this.details = details;
        if (cause) this.cause = cause;
    }
}

export function chessPageUrl(query = '') {
    const runtime = globalThis.chrome?.runtime;
    if (runtime?.getURL) return runtime.getURL(`${CHESS_PAGE_PATH}${query}`);
    return `../chess/chess.html${query}`;
}

/** The colour (`white` / `black`) a uid plays in a game document, or null. */
export function colorOf(game, uid) {
    if (!game || !uid) return null;
    if (game.whiteUid === uid) return 'white';
    if (game.blackUid === uid) return 'black';
    return null;
}

/**
 * Time left on each clock at `now` (server time), or null for a game without
 * clocks. Clocks run only once both sides have moved, like on the server.
 */
export function clockState(game, now) {
    const control = TIME_CONTROLS[game?.timeControl];
    if (!control || !game?.clock) return null;
    const turnColor = colorOf(game, game.turnUid);
    const running = game.status === 'playing' && Number(game.moveCount) >= 2 ? turnColor : null;
    const left = color => {
        const stored = Number(game.clock[`${color}Ms`]) || 0;
        return running === color ? stored - (now - Number(game.clock.turnStartedAtMs)) : stored;
    };
    return { white: left('white'), black: left('black'), running };
}

/** When the side to move runs out of its allowance (server time). */
export function turnDeadline(game) {
    const start = Number(game?.clock?.turnStartedAtMs) || Number(game?.startedAtMs) || 0;
    const control = TIME_CONTROLS[game?.timeControl];
    if (Number(game?.moveCount) < 2) return start + (control ? FIRST_MOVE_MS : DAILY_MOVE_MS);
    if (!control) return start + DAILY_MOVE_MS;
    const color = colorOf(game, game.turnUid);
    return start + Math.max(0, Number(game.clock?.[`${color}Ms`]) || 0);
}

export class ChessService {
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
        url = CHESS_FUNCTION_URL,
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

    /** The signed-in Firebase user; the Auth instance comes before the chrome.storage copy. */
    currentUser() {
        return this.firebaseManager?.auth?.currentUser || this.firebaseManager?.getCurrentUser?.() || null;
    }

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
            throw new ChessError('Sign in to play', { code: 'AUTH_REQUIRED', status: 401 });
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
            throw new ChessError('No connection to the game server', { code: 'NETWORK', cause: error });
        }
        const receivedAt = this.now();
        const result = await response.json().catch(() => null);
        if (Number.isFinite(result?.serverTimeMs)) this.noteServerTime(result.serverTimeMs, sentAt, receivedAt);
        if (!response.ok || !result?.ok) {
            const code = result?.code || (response.status === 401 ? 'AUTH_REQUIRED' : response.status >= 500 ? 'INTERNAL' : 'UNKNOWN');
            throw new ChessError(result?.error || `Chess request failed (${response.status})`, {
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

    create({ visibility = 'private', invitedUid = null, timeControl = '10+5', color = 'random' } = {}) {
        return this.call('create', { visibility, timeControl, color, ...(invitedUid ? { invitedUid } : {}) });
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

    move(gameId, uci, expectedMoveCount) {
        return this.call('move', { gameId, uci, expectedMoveCount });
    }

    resign(gameId) {
        return this.call('resign', { gameId });
    }

    abort(gameId) {
        return this.call('abort', { gameId });
    }

    offerDraw(gameId) {
        return this.call('offerDraw', { gameId });
    }

    answerDraw(gameId, accept) {
        return this.call('answerDraw', { gameId, accept: Boolean(accept) });
    }

    timeout(gameId) {
        return this.call('timeout', { gameId });
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
        if (!this.db) throw new ChessError('Firebase is not ready', { code: 'NOT_READY' });
        return this.db;
    }

    subscribeGame(gameId, onData, onError) {
        return this._subscribe(this._requireDb().collection('chessGames').doc(gameId), onData, onError);
    }

    subscribePlayer(uid, onData, onError) {
        return this._subscribe(this._requireDb().collection('chessPlayers').doc(uid), onData, onError);
    }

    subscribeLobby(onData, onError) {
        return this._subscribe(this._requireDb().collection('chessLobby').doc('open'), onData, onError);
    }

    searchPlayers(text) {
        if (String(text ?? '').trim().replace(/^@/, '').length < 2) return Promise.resolve([]);
        return searchApprovedPlayers(this._requireDb(), text, { selfUid: this.currentUser()?.uid || null });
    }
}
