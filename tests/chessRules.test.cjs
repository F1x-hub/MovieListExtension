const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Rules = require('../src/shared/games/chess/ChessRules.js');

// The Cloud Function ships a byte-for-byte copy.
assert.equal(
    fs.readFileSync(path.join(__dirname, '../functions/chessRules.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../src/shared/games/chess/ChessRules.js'), 'utf8'),
    'functions/chessRules.js must stay identical to src/shared/games/chess/ChessRules.js'
);

// --- Move generation: perft against the published reference counts -------------------
const PERFT = [
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
    ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
    ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]]
];
for (const [fen, counts] of PERFT) {
    const position = new Rules.Position(fen);
    counts.forEach((expected, index) => {
        assert.equal(Rules.perft(position, index + 1), expected, `perft ${index + 1} of ${fen}`);
    });
    assert.equal(position.fen().split(' ').slice(0, 4).join(' '), fen.split(' ').slice(0, 4).join(' '), 'make/unmake restores the position');
}

// --- FEN ---------------------------------------------------------------------------------------
assert.equal(new Rules.Position().fen(), Rules.START_FEN);
assert.equal(Rules.isValidFen('8/8/8/8/8/8/8/8 w - - 0 1'), false, 'kings are required');
assert.equal(Rules.isValidFen('4k3/8/8/8/8/8/8/4K2P w - - 0 1'), false, 'no pawn on the back rank');
assert.equal(Rules.isValidFen('4k3/8/8/8/8/8/8/R3K3 b - - 0 1'), true);
assert.equal(Rules.isValidFen('4k2R/8/8/8/8/8/8/4K3 w - - 0 1'), false, 'the side not to move cannot be in check');
// Castling rights without the king or rook on its square are dropped.
assert.equal(new Rules.Position('4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1').fen(), '4k3/8/8/8/8/8/8/4K3 w - - 0 1');

// --- SAN, UCI and the friendly layer ---------------------------------------------------------
{
    const game = new Rules.ChessGame();
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']) {
        assert.ok(game.move(san), `${san} is legal`);
    }
    assert.equal(game.history()[8].san, 'O-O');
    assert.equal(game.history()[8].castle, 'k');
    assert.equal(game.history()[8].rookFrom, 'h1');
    assert.equal(game.history()[8].rookTo, 'f1');
    assert.equal(game.get('g1').type, 'k');
    assert.equal(game.move('e1g1'), null, 'no castling twice');
    assert.equal(game.undo().san, 'O-O');
    assert.equal(game.get('e1').type, 'k', 'undo puts the king back');
    assert.ok(game.move('0-0'), 'castling with zeros is understood');
}
{
    // Disambiguation by file, by rank and by both.
    const game = Rules.ChessGame.fromMoves([], '1k6/8/8/8/8/8/4K3/R6R w - - 0 1');
    assert.equal(game.move('a1d1').san, 'Rad1');
    const ranks = Rules.ChessGame.fromMoves([], '1k6/R7/8/8/8/8/8/R3K3 w - - 0 1');
    assert.equal(ranks.move('a1a4').san, 'R1a4');
    const both = Rules.ChessGame.fromMoves([], '1k6/8/8/8/4Q2Q/8/8/K6Q w - - 0 1');
    assert.equal(both.move('h4e1').san, 'Qh4e1');
}
{
    // En passant, recorded only when a capture is possible.
    const game = new Rules.ChessGame();
    game.move('e4');
    assert.equal(game.fen().split(' ')[3], '-', 'no black pawn can take: no en passant square');
    for (const san of ['a6', 'e5', 'd5']) game.move(san);
    assert.equal(game.fen().split(' ')[3], 'd6');
    const capture = game.move('exd6');
    assert.equal(capture.enPassant, true);
    assert.equal(capture.captureSquare, 'd5');
    assert.equal(game.get('d5'), null);
    assert.equal(game.capturedPieces().w.join(''), 'p');
}
{
    // Promotion: UCI letter, object form and SAN with "=".
    const game = Rules.ChessGame.fromMoves([], '7k/P7/8/8/8/8/8/K7 w - - 0 1');
    assert.equal(game.moves({ square: 'a7' }).length, 4);
    const queen = game.move({ from: 'a7', to: 'a8', promotion: 'q' });
    assert.equal(queen.san, 'a8=Q+');
    assert.equal(game.get('a8').type, 'q');
    game.undo();
    assert.equal(game.move('a8=N').san, 'a8=N');
    game.undo();
    assert.equal(game.move('a7a8r').promotion, 'r');
}
{
    // Check and mate symbols, and status.
    const fool = Rules.ChessGame.fromMoves(['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    assert.equal(fool.lastMove().san, 'Qh4#');
    assert.equal(fool.lastMove().mate, true);
    assert.deepEqual(
        { over: fool.status().over, result: fool.status().result, reason: fool.status().reason },
        { over: true, result: '0-1', reason: 'checkmate' }
    );
    assert.equal(fool.moves().length, 0);
    const stalemate = Rules.ChessGame.fromMoves([], '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    assert.equal(stalemate.status().reason, 'stalemate');
    assert.equal(stalemate.status().result, '1/2-1/2');
    assert.equal(Rules.ChessGame.fromMoves([], '7k/8/8/8/8/8/8/K5B1 w - - 0 1').status().reason, 'insufficient');
    assert.equal(Rules.ChessGame.fromMoves([], '5b1k/8/8/8/8/8/8/K5B1 w - - 0 1').status().reason, 'insufficient', 'same-shade bishops');
    assert.equal(Rules.ChessGame.fromMoves([], '6bk/8/8/8/8/8/8/K5B1 w - - 0 1').status().over, false, 'opposite-shade bishops can still mate');
    assert.equal(Rules.ChessGame.fromMoves([], '7k/8/8/8/8/8/8/K5NN w - - 0 1').status().over, false, 'two knights are not a dead position');
    assert.equal(Rules.ChessGame.fromMoves([], '7k/8/8/8/8/8/8/K5R1 w - - 100 80').status().reason, 'fifty-move');
    const repeat = new Rules.ChessGame();
    ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1'].forEach(san => repeat.move(san));
    assert.equal(repeat.status().over, false, 'twice is not yet a draw');
    repeat.move('Ng8');
    assert.equal(repeat.status().reason, 'threefold');
}
{
    // Illegal input and moves out of turn are refused.
    const game = new Rules.ChessGame();
    assert.equal(game.move('e5'), null);
    assert.equal(game.move('e2e5'), null);
    assert.equal(game.move('nonsense'), null);
    assert.throws(() => Rules.ChessGame.fromMoves(['e2e4', 'e2e4']), error => error.code === 'ILLEGAL_MOVE');
    // Pinned pieces cannot move.
    const pinned = Rules.ChessGame.fromMoves([], '4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1');
    assert.equal(pinned.moves({ square: 'e2' }).length, 0);
    // Castling through check is illegal.
    const through = Rules.ChessGame.fromMoves([], '4k3/8/8/8/8/8/5r2/4K2R w K - 0 1');
    assert.equal(through.moves({ square: 'e1' }).some(move => move.castle), false);
}

console.log('✅ Chess rules tests passed!');
