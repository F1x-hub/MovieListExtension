import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Rules = require('../src/shared/games/chess/ChessRules.js');
globalThis.ChessRules = Rules;

const { ChessLocalStore, DEFAULT_PREFS } = await import('../src/shared/games/chess/ChessLocalStore.js');
const { chessEvents } = await import('../src/shared/components/ChessNotifier.js');
const { clockState, turnDeadline, colorOf, FIRST_MOVE_MS, DAILY_MOVE_MS } = await import('../src/shared/services/ChessService.js');
const { formatClock } = await import('../src/pages/chess/ChessGameView.js').catch(() => ({ formatClock: null }));
const { locales } = await import('../src/shared/i18n/locales.js');

// --- Local store -------------------------------------------------------------------------
function memory(initial = {}) {
    const data = { ...initial };
    return {
        data,
        get: async key => (key in data ? JSON.parse(JSON.stringify(data[key])) : null),
        set: async (key, value) => { data[key] = JSON.parse(JSON.stringify(value)); },
        remove: async key => { delete data[key]; }
    };
}
{
    const storage = memory({ chessPrefsV1: { level: 9, botSide: 'b', timeControl: '7+0', onlineSide: 'white', view: 'top' } });
    const store = new ChessLocalStore({ storage, rules: Rules });
    const prefs = await store.loadPrefs();
    assert.deepEqual(prefs, { ...DEFAULT_PREFS, botSide: 'b', onlineSide: 'white', view: 'top' }, 'unknown values fall back to the defaults');

    assert.equal(await store.loadBotGame(), null);
    await store.saveBotGame({ level: 4, playerColor: 'b', moves: ['e2e4', 'c7c5'], hints: 1, undos: 0, startedAt: 5 });
    const saved = await store.loadBotGame();
    assert.equal(saved.level, 4);
    assert.deepEqual(saved.moves, ['e2e4', 'c7c5']);
    storage.data.chessBotGameV1.moves = ['e2e4', 'e2e4'];
    assert.equal(await store.loadBotGame(), null, 'a saved game that does not replay is ignored');
    storage.data.chessBotGameV1.moves = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
    assert.equal(await store.loadBotGame(), null, 'a finished game is not offered for continuing');
    await store.clearBotGame();
    assert.equal(storage.data.chessBotGameV1, undefined);

    await store.recordResult(3, 'win');
    await store.recordResult(3, 'draw');
    const stats = await store.recordResult(3, 'loss');
    assert.deepEqual(stats[3], { wins: 1, draws: 1, losses: 1 });
    assert.deepEqual(stats[1], { wins: 0, draws: 0, losses: 0 });
}

// --- Notifier events ----------------------------------------------------------------------
{
    const NOW = 1_000_000;
    const events = chessEvents({
        invites: {
            CHALNG: { fromName: 'Алиса', createdAtMs: NOW - 10, expiresAtMs: NOW + 1000 },
            REMTCH: { fromName: 'Борис', rematch: true, createdAtMs: NOW - 20, expiresAtMs: NOW + 1000 },
            OLDONE: { fromName: 'Старый', createdAtMs: NOW - 9999, expiresAtMs: NOW - 1 }
        },
        games: {
            JOINED: { role: 'host', status: 'playing', moveCount: 0, turnUid: 'other', opponentName: 'Вера', updatedAtMs: NOW - 5 },
            MYMOVE: { role: 'guest', status: 'playing', moveCount: 3, turnUid: 'me', opponentName: 'Глеб', updatedAtMs: NOW - 4 },
            THEIRS: { role: 'host', status: 'playing', moveCount: 4, turnUid: 'other', opponentName: 'Дина', updatedAtMs: NOW - 3 },
            OFFERS: { role: 'host', status: 'playing', moveCount: 6, turnUid: 'me', drawOfferBy: 'other', opponentName: 'Ева', updatedAtMs: NOW - 2 },
            WAITNG: { role: 'host', status: 'waiting', updatedAtMs: NOW - 1 }
        }
    }, 'me', NOW);
    assert.deepEqual(events.map(event => event.key).sort(), [
        `draw:OFFERS:${NOW - 2}`, 'invite:CHALNG', 'invite:REMTCH', 'joined:JOINED', `turn:MYMOVE:${NOW - 4}`
    ].sort());
    assert.equal(events.find(event => event.gameId === 'REMTCH').kind, 'rematch');
    assert.equal(events.find(event => event.gameId === 'OFFERS').kind, 'draw', 'a draw offer outranks the plain turn notice');
    assert.deepEqual(chessEvents(null, 'me', NOW), []);
}

// --- Clocks on the server's time ----------------------------------------------------------
{
    const game = {
        status: 'playing', timeControl: '5+3', whiteUid: 'w', blackUid: 'b', turnUid: 'b', moveCount: 5,
        clock: { whiteMs: 200000, blackMs: 150000, turnStartedAtMs: 10000 }
    };
    assert.equal(colorOf(game, 'w'), 'white');
    assert.deepEqual(clockState(game, 13000), { white: 200000, black: 147000, running: 'black' });
    assert.equal(turnDeadline(game), 160000);
    assert.equal(clockState({ ...game, moveCount: 1 }, 13000).running, null, 'clocks wait for both first moves');
    assert.equal(turnDeadline({ ...game, moveCount: 1 }), 10000 + FIRST_MOVE_MS);
    assert.equal(clockState({ ...game, timeControl: 'none' }, 13000), null);
    assert.equal(turnDeadline({ ...game, timeControl: 'none' }), 10000 + DAILY_MOVE_MS);
}
if (formatClock) {
    assert.equal(formatClock(600000), '10:00');
    assert.equal(formatClock(61000), '1:01');
    assert.equal(formatClock(9400), '0:09.4');
    assert.equal(formatClock(-5), '0:00.0');
    assert.equal(formatClock(3725000), '1:02:05');
}

// --- Every chess string the code asks for exists in both locales -----------------------------
{
    const sources = [
        'src/pages/chess/chess.js',
        'src/pages/chess/ChessGameView.js',
        'src/pages/chess/ChessBotView.js',
        'src/pages/chess/ChessOnlineView.js',
        'src/shared/components/ChessNotifier.js'
    ].map(file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
    const lookup = (locale, key) => key.split('.').reduce((value, part) => value?.[part], locales[locale].games.chess);
    const literal = [...sources.matchAll(/tc\(\s*'([a-z_]+(?:\.[A-Za-z0-9_+-]+)+)'/g)].map(match => match[1]);
    const ternaries = [...sources.matchAll(/tc\(\s*[^)'`]*\?\s*'([a-z_.]+)'\s*:\s*'([a-z_.]+)'/g)].flatMap(match => [match[1], match[2]]);
    const families = {
        'levels.N.name': [1, 2, 3, 4, 5, 6].map(level => `levels.${level}.name`),
        'levels.N.text': [1, 2, 3, 4, 5, 6].map(level => `levels.${level}.text`),
        pieces: ['k', 'q', 'r', 'b', 'n', 'p'].flatMap(type => [`pieces.${type}`, `pieces_accusative.${type}`]),
        colors: ['w', 'b'].flatMap(color => [`colors.${color}`, `colors_of.${color}`, `lobby.as_${color}`, `result.winner_${color}`]),
        reasons: ['checkmate', 'stalemate', 'insufficient', 'fifty-move', 'threefold', 'resigned', 'timeout', 'timeout_draw', 'agreement', 'abandoned']
            .flatMap(reason => [`reasons.${reason}`, `reasons_short.${reason}`]),
        controls: ['3+2', '5+3', '10+5', '15+10', 'none'].map(id => `controls.kind.${id}`),
        sides: ['white', 'black', 'random'].flatMap(side => [`lobby.side_${side}`, `online.host_color.${side}`, `online.your_color.${side}`]),
        results: ['win', 'loss', 'draw'].map(result => `lobby.result_${result}`),
        cancelled: ['cancelled', 'declined', 'expired', 'aborted', 'left'].map(reason => `online.cancelled.${reason}`),
        confirm: ['resign', 'restart', 'cancel'].flatMap(kind => [`confirm.${kind}`, `confirm.${kind}_title`, `confirm.${kind}_text`]),
        notify: ['title', 'invite', 'rematch', 'joined', 'your_turn', 'draw', 'open', 'later'].map(key => `notify.${key}`),
        result: ['win', 'loss', 'draw'].map(key => `result.${key}`)
    };
    const serverCodes = [...readFileSync(new URL('../functions/chess.js', import.meta.url), 'utf8').matchAll(/chessError\("([A-Z_]+)"/g)].map(match => `errors.${match[1]}`);
    const keys = new Set([...literal, ...ternaries, ...Object.values(families).flat(), ...serverCodes]);
    for (const locale of ['ru', 'en']) {
        const missing = [...keys].filter(key => typeof lookup(locale, key) !== 'string');
        assert.deepEqual(missing, [], `${locale} has every chess string`);
        assert.equal(typeof locales[locale].games.menu.chess.title, 'string');
    }
    assert.ok(keys.size > 150, `the scan found the strings (${keys.size})`);
}

// --- Wiring --------------------------------------------------------------------------------
{
    const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(read('src/shared/components/GamesModal.js'), /game-menu-card--chess[^>]*src\/pages\/chess\/chess\.html/s);
    const navigation = read('src/shared/components/Navigation.js');
    assert.match(navigation, /import\('\.\/ChessNotifier\.js'\)/, 'the notifier import stays literal for the page bundler');
    assert.match(navigation, /pagePath: '\/src\/pages\/chess\/'/);
    const html = read('src/pages/chess/chess.html');
    assert.match(html, /games\/chess\/ChessRules\.js/);
    assert.match(html, /chess\.js" type="module"/);
    assert.match(read('rules/firestore.rules'), /match \/chessGames\/\{gameId\}[\s\S]*allow list, create, update, delete: if false;/);
    assert.match(read('functions/index.js'), /exports\.chess = onRequest/);
}

console.log('✅ Chess client tests passed!');
