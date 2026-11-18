/**
 * Device-local chess state in chrome.storage.local: the unfinished game against
 * the bot (so it can be continued later), results per bot level and the
 * player's last choices. Online games live in Firestore instead.
 */

const KEYS = Object.freeze({ game: 'chessBotGameV1', stats: 'chessBotStatsV1', prefs: 'chessPrefsV1' });
const LEVELS = [1, 2, 3, 4, 5, 6];
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const MAX_MOVES = 1200;

export const DEFAULT_PREFS = Object.freeze({
    level: 3,
    botSide: 'w',
    timeControl: '10+5',
    onlineSide: 'random',
    view: '3d'
});

function memoryStorage() {
    const data = new Map();
    return {
        async get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
        async set(key, value) { data.set(key, structuredClone(value)); },
        async remove(key) { data.delete(key); }
    };
}

function chromeStorage() {
    const local = globalThis.chrome?.storage?.local;
    if (!local?.get) return null;
    return {
        get: async key => (await local.get([key]))?.[key] ?? null,
        set: async (key, value) => local.set({ [key]: value }),
        remove: async key => local.remove(key)
    };
}

export class ChessLocalStore {
    constructor({ storage = chromeStorage() || memoryStorage(), rules = globalThis.ChessRules } = {}) {
        this.storage = storage;
        this.rules = rules;
    }

    async read(key) {
        try {
            return await this.storage.get(key);
        } catch {
            return null;
        }
    }

    async write(key, value) {
        try {
            await this.storage.set(key, value);
        } catch (error) {
            console.warn('[Chess] could not save', key, error);
        }
    }

    async loadPrefs() {
        const stored = await this.read(KEYS.prefs) || {};
        const prefs = { ...DEFAULT_PREFS };
        if (LEVELS.includes(stored.level)) prefs.level = stored.level;
        if (['w', 'b', 'random'].includes(stored.botSide)) prefs.botSide = stored.botSide;
        if (['3+2', '5+3', '10+5', '15+10', 'none'].includes(stored.timeControl)) prefs.timeControl = stored.timeControl;
        if (['white', 'black', 'random'].includes(stored.onlineSide)) prefs.onlineSide = stored.onlineSide;
        if (['3d', 'top'].includes(stored.view)) prefs.view = stored.view;
        return prefs;
    }

    savePrefs(prefs) {
        return this.write(KEYS.prefs, { ...DEFAULT_PREFS, ...prefs });
    }

    /** The saved game against the bot, replayed to make sure it is still a legal game; or null. */
    async loadBotGame() {
        const game = await this.read(KEYS.game);
        if (!game || typeof game !== 'object') return null;
        if (!LEVELS.includes(game.level) || !['w', 'b'].includes(game.playerColor)) return null;
        if (!Array.isArray(game.moves) || game.moves.length > MAX_MOVES || !game.moves.every(move => UCI.test(move))) return null;
        try {
            const replay = this.rules.ChessGame.fromMoves(game.moves);
            if (replay.status().over) return null;
        } catch {
            return null;
        }
        return {
            level: game.level,
            playerColor: game.playerColor,
            moves: [...game.moves],
            hints: Number(game.hints) || 0,
            undos: Number(game.undos) || 0,
            startedAt: Number(game.startedAt) || Date.now(),
            updatedAt: Number(game.updatedAt) || Date.now()
        };
    }

    saveBotGame(game) {
        return this.write(KEYS.game, {
            level: game.level,
            playerColor: game.playerColor,
            moves: [...game.moves],
            hints: game.hints || 0,
            undos: game.undos || 0,
            startedAt: game.startedAt,
            updatedAt: Date.now()
        });
    }

    async clearBotGame() {
        try {
            await this.storage.remove(KEYS.game);
        } catch { /* Nothing to clear. */ }
    }

    async loadStats() {
        const stored = await this.read(KEYS.stats) || {};
        return Object.fromEntries(LEVELS.map(level => {
            const entry = stored[level] || {};
            return [level, {
                wins: Number(entry.wins) || 0,
                draws: Number(entry.draws) || 0,
                losses: Number(entry.losses) || 0
            }];
        }));
    }

    /** @param {'win'|'draw'|'loss'} outcome */
    async recordResult(level, outcome) {
        const stats = await this.loadStats();
        const entry = stats[level];
        if (!entry) return stats;
        if (outcome === 'win') entry.wins += 1;
        else if (outcome === 'loss') entry.losses += 1;
        else entry.draws += 1;
        await this.write(KEYS.stats, stats);
        return stats;
    }
}
