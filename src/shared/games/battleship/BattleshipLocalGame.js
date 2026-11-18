import { BOT_LEVELS, DEFAULT_BOT_LEVEL, chooseShot, normalizeBotLevel } from './BattleshipBot.js';

/**
 * A Battleship game against the computer, run in the page. It answers the calls
 * BattleshipGameView makes on BattleshipService (subscribeGame, subscribeFleet,
 * place, fire, resign, rematch, serverNow) with game documents of the same
 * shape, so the game screen plays it like an online game. The computer places
 * its fleet at random, shoots after a short pause and keeps shooting while it
 * hits. Every change is saved, so a reload resumes the game; finished games add
 * to a record per level.
 *
 * Nothing here reaches the network: the computer's fleet stays in the page and
 * in `chrome.storage.local` (`battleshipBotV1`).
 */

export const BOT_UID = 'bot';
export const PLAYER_UID = 'you';
export const BOT_STORAGE_KEY = 'battleshipBotV1';
const STORE_VERSION = 1;

/** chrome.storage.local, or memory where the extension API is missing. */
export function extensionStorage() {
    const area = globalThis.chrome?.storage?.local;
    const memory = new Map();
    return {
        async get(key) {
            if (!area?.get) return memory.get(key) ?? null;
            const stored = await area.get(key);
            return stored?.[key] ?? null;
        },
        async set(key, value) {
            if (!area?.set) {
                memory.set(key, value);
                return;
            }
            await area.set({ [key]: value });
        }
    };
}

function localError(code, message) {
    const error = new Error(message);
    error.code = code;
    error.name = 'BattleshipError';
    return error;
}

function emptyStats() {
    return Object.fromEntries(BOT_LEVELS.map(level => [level, { wins: 0, losses: 0 }]));
}

function clone(value) {
    return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

export class BattleshipLocalGame {
    /**
     * @param {Object} options
     * @param {Object} options.rules - BattleshipRules
     * @param {{ get: (key: string) => Promise<any>, set: (key: string, value: any) => Promise<void> }} [options.storage]
     * @param {() => number} [options.random]
     * @param {() => number} [options.now]
     * @param {{ think: [number, number], reply: number }} [options.delays] - the computer's pause before a shot; the answer to ours
     * @param {(fn: Function, ms: number) => any} [options.setTimer]
     * @param {(id: any) => void} [options.clearTimer]
     */
    constructor({
        rules,
        storage = extensionStorage(),
        random = Math.random,
        now = () => Date.now(),
        delays = { think: [650, 1100], reply: 240 },
        setTimer = (fn, ms) => setTimeout(fn, ms),
        clearTimer = id => clearTimeout(id)
    }) {
        this.rules = rules;
        this.storage = storage;
        this.random = random;
        this.now = now;
        this.delays = delays;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.level = DEFAULT_BOT_LEVEL;
        this.stats = emptyStats();
        this.game = null;
        this.fleets = {};
        this.gameListeners = new Set();
        this.fleetListeners = new Set();
        this.botTimer = null;
        this.saving = Promise.resolve();
    }

    /** Reads the saved level, record and game. A broken save starts over. */
    async load() {
        let saved = null;
        try {
            saved = await this.storage.get(BOT_STORAGE_KEY);
        } catch (error) {
            console.warn('[Battleship] the saved game against the computer is unavailable', error);
        }
        if (!saved || saved.version !== STORE_VERSION) return this;
        this.level = normalizeBotLevel(saved.level);
        const stats = emptyStats();
        for (const level of BOT_LEVELS) {
            stats[level].wins = Math.max(0, Number(saved.stats?.[level]?.wins) || 0);
            stats[level].losses = Math.max(0, Number(saved.stats?.[level]?.losses) || 0);
        }
        this.stats = stats;
        const game = saved.game;
        const botFleet = this.rules.validateFleet(saved.fleets?.[BOT_UID]);
        const playerFleet = saved.fleets?.[PLAYER_UID] ? this.rules.validateFleet(saved.fleets[PLAYER_UID]) : null;
        const valid = game && typeof game.id === 'string' && botFleet.ok && (!playerFleet || playerFleet.ok)
            && [PLAYER_UID, BOT_UID].every(uid => this.rules.isValidMarks(game.boards?.[uid]));
        if (valid) {
            this.game = game;
            this.fleets = { [BOT_UID]: botFleet.ships, [PLAYER_UID]: playerFleet?.ships || null };
        }
        return this;
    }

    get gameId() {
        return this.game?.id || null;
    }

    /** The saved game, when it is still being placed or played. */
    get unfinished() {
        return this.game && (this.game.status === 'placing' || this.game.status === 'playing') ? this.game : null;
    }

    setLevel(level) {
        this.level = normalizeBotLevel(level);
        this.save();
    }

    serverNow() {
        return this.now();
    }

    /**
     * A new game against the computer; an unfinished one is dropped.
     * @param {Object} [options]
     * @param {string} [options.level]
     * @param {string} [options.playerName]
     * @param {string|null} [options.playerPhoto]
     * @param {string} [options.botName]
     */
    start({ level = this.level, playerName = '', playerPhoto = null, botName = '' } = {}) {
        this.stopBot();
        this.level = normalizeBotLevel(level);
        const time = this.now();
        const empty = this.rules.emptyMarks();
        this.fleets = { [BOT_UID]: this.rules.validateFleet(this.rules.randomFleet(this.random)).ships, [PLAYER_UID]: null };
        this.game = {
            // Unique per game, so a screen of the previous game never takes this one for its own.
            id: `bot-${time.toString(36)}-${Math.floor(this.random() * 36 ** 4).toString(36)}`,
            version: 1,
            local: true,
            level: this.level,
            status: 'placing',
            visibility: 'private',
            hostUid: PLAYER_UID,
            guestUid: BOT_UID,
            invitedUid: null,
            players: [PLAYER_UID, BOT_UID],
            names: { [PLAYER_UID]: playerName, [BOT_UID]: botName },
            photos: { [PLAYER_UID]: playerPhoto, [BOT_UID]: null },
            ready: { [PLAYER_UID]: false, [BOT_UID]: true },
            boards: { [PLAYER_UID]: empty, [BOT_UID]: empty },
            sunk: { [PLAYER_UID]: [], [BOT_UID]: [] },
            shots: { [PLAYER_UID]: 0, [BOT_UID]: 0 },
            hits: { [PLAYER_UID]: 0, [BOT_UID]: 0 },
            turnUid: null,
            turnStartedAtMs: null,
            moveCount: 0,
            lastShot: null,
            winnerUid: null,
            endReason: null,
            revealed: null,
            rematchOf: null,
            rematchGameId: null,
            rematchBy: null,
            createdAtMs: time,
            updatedAtMs: time,
            placingStartedAtMs: time,
            startedAtMs: null,
            finishedAtMs: null
        };
        this.changed();
        return { gameId: this.game.id, status: this.game.status };
    }

    // --- BattleshipService calls ------------------------------------------------------------

    subscribeGame(gameId, onData) {
        const listener = { gameId, onData };
        this.gameListeners.add(listener);
        queueMicrotask(() => {
            if (this.gameListeners.has(listener)) onData(this.snapshotFor(gameId));
        });
        this.wakeBot();
        return () => {
            this.gameListeners.delete(listener);
            if (!this.gameListeners.size) this.stopBot();
        };
    }

    subscribeFleet(gameId, uid, onData) {
        const listener = { gameId, uid, onData };
        this.fleetListeners.add(listener);
        queueMicrotask(() => {
            if (this.fleetListeners.has(listener)) onData(this.fleetFor(gameId, uid));
        });
        return () => this.fleetListeners.delete(listener);
    }

    async place(gameId, ships) {
        const game = this.requireGame(gameId);
        const check = this.rules.validateFleet(ships);
        if (!check.ok) throw localError('INVALID_FLEET', 'The fleet breaks the rules');
        if (game.status !== 'placing') {
            if (game.status === 'playing' && game.ready[PLAYER_UID]) return { gameId: game.id, status: game.status };
            throw localError('GAME_STARTED', 'Ships can no longer be placed');
        }
        const time = this.now();
        this.fleets[PLAYER_UID] = check.ships;
        game.ready[PLAYER_UID] = true;
        game.status = 'playing';
        game.turnUid = this.random() < 0.5 ? PLAYER_UID : BOT_UID;
        game.turnStartedAtMs = time;
        game.startedAtMs = time;
        game.updatedAtMs = time;
        this.changed();
        this.wakeBot();
        return { gameId: game.id, status: game.status, turnUid: game.turnUid };
    }

    async fire(gameId, index, expectedMove = null) {
        const game = this.requireGame(gameId);
        if (game.status !== 'playing') throw localError('GAME_NOT_ACTIVE', 'The game is not in progress');
        if (game.turnUid !== PLAYER_UID) throw localError('NOT_YOUR_TURN', 'It is not your turn');
        if (expectedMove !== null && expectedMove !== undefined && Number(expectedMove) !== game.moveCount) {
            throw localError('STALE_MOVE', 'The game has moved on');
        }
        if (!this.rules.isShootable(game.boards[BOT_UID], Number(index))) throw localError('CELL_TAKEN', 'This cell was already shot');
        // The answer takes a moment, so the sight over the cell is seen to fire.
        await new Promise(resolve => this.setTimer(resolve, this.delays.reply));
        if (this.game !== game || game.status !== 'playing' || game.turnUid !== PLAYER_UID) {
            throw localError('STALE_MOVE', 'The game has moved on');
        }
        const shot = this.shoot(PLAYER_UID, Number(index));
        this.wakeBot();
        return {
            gameId: game.id,
            index: Number(index),
            result: shot.result,
            ship: shot.ship,
            marks: game.boards[BOT_UID],
            moveCount: game.moveCount,
            turnUid: game.turnUid,
            status: game.status,
            winnerUid: game.winnerUid || null
        };
    }

    /** Resigning while placing just closes the game; during the battle it is a loss. */
    async resign(gameId) {
        const game = this.requireGame(gameId);
        this.stopBot();
        const time = this.now();
        if (game.status === 'placing') {
            game.status = 'cancelled';
            game.endReason = 'left';
            game.updatedAtMs = time;
            this.changed();
            return { gameId: game.id, status: game.status };
        }
        if (game.status !== 'playing') return { gameId: game.id, status: game.status };
        this.finish(BOT_UID, 'resigned', time);
        this.changed();
        return { gameId: game.id, status: game.status, winnerUid: BOT_UID };
    }

    /** Another game at the same level. */
    async rematch(gameId) {
        const game = this.requireGame(gameId);
        return this.start({ level: game.level, playerName: game.names?.[PLAYER_UID] || '', playerPhoto: game.photos?.[PLAYER_UID] || null, botName: game.names?.[BOT_UID] || '' });
    }

    async claim() {
        throw localError('NOT_ALLOWED', 'The computer never stalls');
    }

    async join(gameId) {
        return { gameId, status: this.game?.status || null };
    }

    async decline() {
        return null;
    }

    async cancel(gameId) {
        return this.resign(gameId);
    }

    // --- The game -----------------------------------------------------------------------

    requireGame(gameId) {
        if (!this.game || this.game.id !== gameId) throw localError('GAME_NOT_FOUND', 'The game does not exist');
        return this.game;
    }

    /** One shot by `uid` at the other side; the turn passes on a miss. */
    shoot(uid, index) {
        const game = this.game;
        const target = uid === PLAYER_UID ? BOT_UID : PLAYER_UID;
        const time = this.now();
        const shot = this.rules.resolveShot(this.fleets[target], game.boards[target], index);
        game.boards[target] = shot.marks;
        game.moveCount += 1;
        game.shots[uid] = (Number(game.shots[uid]) || 0) + 1;
        if (shot.result !== 'miss') game.hits[uid] = (Number(game.hits[uid]) || 0) + 1;
        if (shot.ship) game.sunk[target] = [...(game.sunk[target] || []), shot.ship];
        game.lastShot = { by: uid, index, result: shot.result, move: game.moveCount, atMs: time };
        game.turnStartedAtMs = time;
        game.updatedAtMs = time;
        if (shot.result === 'miss') game.turnUid = target;
        if (shot.allSunk) this.finish(uid, 'all_sunk', time);
        this.changed();
        return shot;
    }

    finish(winnerUid, reason, time) {
        const game = this.game;
        game.status = 'finished';
        game.winnerUid = winnerUid;
        game.endReason = reason;
        game.turnUid = null;
        game.finishedAtMs = time;
        game.updatedAtMs = time;
        game.revealed = { [PLAYER_UID]: this.fleets[PLAYER_UID], [BOT_UID]: this.fleets[BOT_UID] };
        const record = this.stats[normalizeBotLevel(game.level)];
        if (winnerUid === PLAYER_UID) record.wins += 1;
        else record.losses += 1;
    }

    /** Schedules the computer's shot when it is its turn and someone is watching. */
    wakeBot() {
        const game = this.game;
        if (this.botTimer !== null || !game || game.status !== 'playing' || game.turnUid !== BOT_UID || !this.gameListeners.size) return;
        const [low, high] = this.delays.think;
        this.botTimer = this.setTimer(() => {
            this.botTimer = null;
            this.botTurn();
        }, low + this.random() * Math.max(0, high - low));
    }

    stopBot() {
        if (this.botTimer === null) return;
        this.clearTimer(this.botTimer);
        this.botTimer = null;
    }

    botTurn() {
        const game = this.game;
        if (!game || game.status !== 'playing' || game.turnUid !== BOT_UID) return;
        const index = chooseShot({
            rules: this.rules,
            marks: game.boards[PLAYER_UID],
            sunk: game.sunk[PLAYER_UID],
            level: game.level,
            random: this.random
        });
        if (index === null) return;
        this.shoot(BOT_UID, index);
        this.wakeBot();
    }

    snapshotFor(gameId) {
        return this.game && this.game.id === gameId ? clone(this.game) : null;
    }

    fleetFor(gameId, uid) {
        if (!this.game || this.game.id !== gameId || uid !== PLAYER_UID || !this.fleets[PLAYER_UID]) return null;
        return { uid, gameId, ships: clone(this.fleets[PLAYER_UID]) };
    }

    /** Saves and tells the screens of this game; a screen of a replaced game hears nothing. */
    changed() {
        this.save();
        const gameId = this.gameId;
        this.gameListeners.forEach(listener => {
            if (listener.gameId === gameId) listener.onData(this.snapshotFor(gameId));
        });
        this.fleetListeners.forEach(listener => {
            if (listener.gameId === gameId) listener.onData(this.fleetFor(gameId, listener.uid));
        });
    }

    /** Saves in order; a failed save is reported and the game goes on. */
    save() {
        const value = {
            version: STORE_VERSION,
            level: this.level,
            stats: clone(this.stats),
            game: clone(this.game),
            fleets: clone(this.fleets)
        };
        this.saving = this.saving
            .then(() => this.storage.set(BOT_STORAGE_KEY, value))
            .catch(error => console.warn('[Battleship] could not save the game against the computer', error));
        return this.saving;
    }

    dispose() {
        this.stopBot();
        this.gameListeners.clear();
        this.fleetListeners.clear();
    }
}
