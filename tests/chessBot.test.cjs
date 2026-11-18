const assert = require('node:assert/strict');
const Rules = require('../src/shared/games/chess/ChessRules.js');
const Bot = require('../src/shared/games/chess/ChessBot.js');

// A seeded random source keeps the noisy levels reproducible.
function seeded(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

assert.deepEqual(Object.keys(Bot.LEVELS), ['1', '2', '3', '4', '5', '6']);
for (let level = 2; level <= 6; level++) {
    assert.ok(Bot.LEVELS[level].timeMs >= Bot.LEVELS[level - 1].timeMs || level === 4, `level ${level} thinks at least as long`);
}

// Every book line replays legally from the start.
Bot.BOOK_LINES.forEach(line => {
    assert.doesNotThrow(() => Rules.ChessGame.fromMoves(line.split(' ')), line);
});
assert.ok(Bot.openingBook().get(Rules.START_FEN.split(' ').slice(0, 4).join(' ')).length >= 4, 'the book has several first moves');

// Mate in one is never missed, not even by the weakest level.
const MATE_IN_ONE = [
    ['6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'd1d8'],
    ['r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'h5f7'],
    ['rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', null]
];
for (let level = 1; level <= 6; level++) {
    const [fen, best] = MATE_IN_ONE[level % 2];
    const answer = Bot.chooseMove({ fen, level, random: seeded(level), timeMs: 400 });
    assert.equal(answer.uci, best, `level ${level} mates in one`);
}
assert.equal(Bot.chooseMove({ fen: MATE_IN_ONE[2][0], level: 4 }), null, 'no move in a finished game');

// A free queen is taken from level 3 up.
for (const level of [3, 4, 5, 6]) {
    const answer = Bot.chooseMove({ fen: 'rnb1kbnr/pppp1ppp/8/4p3/3qP3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 0 4', level, random: seeded(7), timeMs: 300 });
    assert.equal(answer.uci, 'f3d4', `level ${level} takes the queen`);
}

// The deep search finds a forced mate in two.
{
    const answer = Bot.chooseMove({ fen: '2r3k1/p4p2/3Rp2p/1p2P1pK/8/1P4P1/P3Q2P/1q6 b - - 0 1', level: 6, timeMs: 1500 });
    assert.ok(answer.score > Bot.MATE - 600, 'a mate score is reported');
    const game = Rules.ChessGame.fromMoves([], '2r3k1/p4p2/3Rp2p/1p2P1pK/8/1P4P1/P3Q2P/1q6 b - - 0 1');
    assert.ok(game.move(answer.uci).check, 'the mating attack starts with a check');
}

// Hints search for the side to move, with the hint settings.
{
    const hint = Bot.chooseMove({ moves: ['e2e4', 'e7e5', 'g1f3'], hint: true, random: seeded(3) });
    assert.ok(new Rules.ChessGame().constructor.fromMoves(['e2e4', 'e7e5', 'g1f3']).findMove(hint.uci) !== null);
}

// The time budget holds, with room for the search to stop.
{
    const started = Date.now();
    Bot.chooseMove({ fen: 'r2q1rk1/pp2bppp/2n1bn2/3p4/3P4/2NBBN2/PP3PPP/R2Q1RK1 w - - 0 11', level: 6, timeMs: 500 });
    assert.ok(Date.now() - started < 1500, 'a 500 ms budget ends in well under 1.5 s');
}

// Short games between levels: every move legal, and the stronger side scores.
function playGame(white, black, seed) {
    const random = seeded(seed);
    const game = new Rules.ChessGame();
    for (let ply = 0; ply < 160 && !game.status().over; ply++) {
        const level = game.turn() === 'w' ? white : black;
        const answer = Bot.chooseMove({ moves: game.uciMoves(), level, random, timeMs: 60 });
        assert.ok(game.move(answer.uci), `level ${level} played a legal move (${answer.uci})`);
    }
    return game.status();
}
let strongPoints = 0;
for (let round = 0; round < 4; round++) {
    const strongWhite = round % 2 === 0;
    const status = playGame(strongWhite ? 5 : 1, strongWhite ? 1 : 5, 100 + round);
    if (status.result === '1/2-1/2' || !status.over) strongPoints += 0.5;
    else if ((status.result === '1-0') === strongWhite) strongPoints += 1;
}
assert.ok(strongPoints >= 3, `level 5 beats level 1 (${strongPoints} of 4)`);

console.log('✅ Chess bot tests passed!');
