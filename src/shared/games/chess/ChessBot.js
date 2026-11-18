/**
 * The chess bot: an alpha-beta engine on ChessRules.Position with six levels.
 *
 * Search: iterative deepening, principal variation search, a transposition
 * table, null-move pruning, late-move reductions, check extensions, killer and
 * history move ordering and a capture-only quiescence search. Evaluation:
 * material and piece-square tables tapered between middlegame and endgame,
 * bishop pair, pawn structure (passed, doubled, isolated), rooks on open files,
 * the king's pawn shield and a mop-up term that drives a lone king to the edge.
 *
 * Levels 1–3 score every root move exactly and choose with noise, so they make
 * human-sized mistakes; levels 4–6 search deeper for longer and play their best
 * move. Levels 3+ start from a small opening book for variety.
 *
 * Runs in ChessBotWorker.js; the same file loads in Node for tests. Pure: the
 * clock and the random source are passed in.
 */
(function (root, factory) {
    const rules = root.ChessRules || (typeof require === 'function' ? require('./ChessRules.js') : null);
    const api = factory(rules);
    if (typeof module === 'object' && module && module.exports) {
        module.exports = api;
    } else {
        root.ChessBot = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Rules) {
    'use strict';

    const { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK, FLAG_CAPTURE, FLAG_EN_PASSANT } = Rules;

    const INF = 1000000;
    const MATE = 30000;
    const MATE_BOUND = MATE - 512;
    const MAX_PLY = 96;
    const TT_BITS = 19;
    const TT_SIZE = 1 << TT_BITS;
    const TT_MASK = TT_SIZE - 1;
    const TT_EXACT = 1;
    const TT_LOWER = 2;
    const TT_UPPER = 3;

    /**
     * depth: deepest iteration; timeMs: thinking budget; noise: random spread
     * added to root scores (centipawns); blunder: chance of a looser pick;
     * exactRoot: score every root move with a full window (weak levels only).
     */
    const LEVELS = Object.freeze({
        1: Object.freeze({ depth: 1, timeMs: 250, noise: 220, blunder: 0.3, exactRoot: true, book: false, quiescence: false }),
        2: Object.freeze({ depth: 2, timeMs: 400, noise: 110, blunder: 0.12, exactRoot: true, book: false, quiescence: true }),
        3: Object.freeze({ depth: 3, timeMs: 700, noise: 45, blunder: 0.04, exactRoot: true, book: true, quiescence: true }),
        4: Object.freeze({ depth: 5, timeMs: 900, noise: 0, blunder: 0, exactRoot: false, book: true, quiescence: true }),
        5: Object.freeze({ depth: 8, timeMs: 1600, noise: 0, blunder: 0, exactRoot: false, book: true, quiescence: true }),
        6: Object.freeze({ depth: 64, timeMs: 3000, noise: 0, blunder: 0, exactRoot: false, book: true, quiescence: true })
    });
    const HINT_SETTINGS = Object.freeze({ depth: 64, timeMs: 1200, noise: 0, blunder: 0, exactRoot: false, book: true, quiescence: true });

    const VALUE_MG = [0, 100, 320, 330, 500, 900, 0];
    const VALUE_EG = [0, 120, 300, 320, 530, 950, 0];
    const PHASE_INC = [0, 0, 1, 1, 2, 4, 0];
    const ORDER_VALUE = [0, 100, 320, 330, 500, 900, 2000];

    // Piece-square tables, rank 8 first, from White's side (mirrored for Black).
    const PST_MG = [
        null,
        [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
            0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
        [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
            -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
        [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
            -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
        [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
            -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
        [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
            0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
        [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
            -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20]
    ];
    // Endgame: pawns are worth more the further they run, rooks care less about
    // the seventh rank and the king walks to the centre; minors and the queen
    // keep their middlegame tables.
    const PST_EG = [
        null,
        [0, 0, 0, 0, 0, 0, 0, 0, 80, 80, 80, 80, 80, 80, 80, 80, 50, 50, 50, 50, 50, 50, 50, 50, 30, 30, 30, 30, 30, 30, 30, 30,
            15, 15, 15, 15, 15, 15, 15, 15, 5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        PST_MG[KNIGHT],
        PST_MG[BISHOP],
        [0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        PST_MG[QUEEN],
        [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
            -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50]
    ];

    const PASSED_BONUS = [0, 10, 15, 25, 45, 75, 120, 0];

    // Openings for variety: every line is replayed once into position → moves.
    const BOOK_LINES = [
        'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7',
        'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d4 e5d4',
        'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5 c2c3 d7d6',
        'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6 d4c6 b7c6',
        'e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4 d2d4 d6d5',
        'e2e4 e7e5 b1c3 g8f6 g1f3 b8c6 f1b5 f8b4',
        'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6',
        'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5',
        'e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 b8c6 b1c3 d8c7',
        'e2e4 c7c5 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 d2d3 d7d6',
        'e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8e7 e4e5 f6d7',
        'e2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3 d8b6',
        'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6',
        'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c8f5',
        'e2e4 g7g6 d2d4 f8g7 b1c3 d7d6 g1f3 g8f6 f1e2 e8g8',
        'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8',
        'd2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5',
        'd2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5',
        'd2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8 f1d3 d7d5',
        'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8',
        'd2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3 c8b7 f1g2 f8e7',
        'd2d4 d7d5 g1f3 g8f6 c1f4 e7e6 e2e3 c7c5 c2c3 b8c6',
        'd2d4 f7f5 g2g3 g8f6 f1g2 e7e6 g1f3 f8e7 e1g1 e8g8',
        'c2c4 e7e5 b1c3 g8f6 g1f3 b8c6 g2g3 d7d5 c4d5 f6d5',
        'c2c4 g8f6 b1c3 e7e6 e2e4 d7d5 e4e5 d5d4',
        'c2c4 c7c5 g1f3 b8c6 b1c3 g7g6 g2g3 f8g7 f1g2 g8f6',
        'g1f3 d7d5 g2g3 g8f6 f1g2 e7e6 e1g1 f8e7 d2d3 e8g8',
        'g1f3 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 d2d4 e8g8'
    ];

    function bookKey(fen) {
        return fen.split(' ').slice(0, 4).join(' ');
    }

    let bookCache = null;
    function openingBook() {
        if (bookCache) return bookCache;
        bookCache = new Map();
        BOOK_LINES.forEach(line => {
            const game = new Rules.ChessGame();
            for (const uci of line.split(' ')) {
                const key = bookKey(game.fen());
                const move = game.move(uci);
                if (!move) break;
                const list = bookCache.get(key) || [];
                list.push(move.uci);
                bookCache.set(key, list);
            }
        });
        return bookCache;
    }

    // Shared scratch for the evaluation (never re-entered: the search is single-threaded).
    const pawnFiles = [new Int8Array(8), new Int8Array(8)];
    const pawnMinRank = [new Int8Array(8), new Int8Array(8)];
    const pawnMaxRank = [new Int8Array(8), new Int8Array(8)];
    const pawnSquares = new Int32Array(16);
    const rookSquares = new Int32Array(20);

    function centerDistance(square) {
        const file = square & 7;
        const rank = square >> 4;
        return Math.max(3 - file, file - 4) + Math.max(3 - rank, rank - 4);
    }

    function kingDistance(a, b) {
        return Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 4) - (b >> 4)));
    }

    /** Static evaluation in centipawns from the side to move's point of view. */
    function evaluate(position) {
        const board = position.board;
        let mgWhite = 0;
        let mgBlack = 0;
        let egWhite = 0;
        let egBlack = 0;
        let phase = 0;
        const bishops = [0, 0];
        const nonPawn = [0, 0];
        let pawnCount = 0;
        let rookCount = 0;
        for (let side = 0; side < 2; side++) {
            pawnFiles[side].fill(0);
            pawnMinRank[side].fill(8);
            pawnMaxRank[side].fill(-1);
        }
        for (let square = 0; square < 128; square++) {
            if (square & 0x88) { square += 7; continue; }
            const piece = board[square];
            if (!piece) continue;
            const type = piece & 7;
            const side = piece >> 3;
            const file = square & 7;
            const rank = square >> 4;
            const index = side === 0 ? (7 - rank) * 8 + file : rank * 8 + file;
            const mg = VALUE_MG[type] + PST_MG[type][index];
            const eg = VALUE_EG[type] + PST_EG[type][index];
            if (side === 0) { mgWhite += mg; egWhite += eg; } else { mgBlack += mg; egBlack += eg; }
            phase += PHASE_INC[type];
            if (type === PAWN) {
                pawnFiles[side][file]++;
                if (rank < pawnMinRank[side][file]) pawnMinRank[side][file] = rank;
                if (rank > pawnMaxRank[side][file]) pawnMaxRank[side][file] = rank;
                if (pawnCount < 16) pawnSquares[pawnCount++] = square;
            } else if (type !== KING) {
                nonPawn[side] += VALUE_MG[type];
                if (type === BISHOP) bishops[side]++;
                else if (type === ROOK && rookCount < 20) rookSquares[rookCount++] = square;
            }
        }

        // Pawn structure.
        let pawnScoreMgW = 0;
        let pawnScoreEgW = 0;
        for (let i = 0; i < pawnCount; i++) {
            const square = pawnSquares[i];
            const side = board[square] >> 3;
            const file = square & 7;
            const rank = square >> 4;
            const sign = side === 0 ? 1 : -1;
            const enemy = side ^ 1;
            const own = pawnFiles[side];
            const isolated = (file === 0 || own[file - 1] === 0) && (file === 7 || own[file + 1] === 0);
            if (isolated) { pawnScoreMgW -= 10 * sign; pawnScoreEgW -= 14 * sign; }
            let passed = true;
            for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1) && passed; f++) {
                if (pawnFiles[enemy][f] === 0) continue;
                if (side === 0 ? pawnMaxRank[1][f] > rank : pawnMinRank[0][f] < rank) passed = false;
            }
            if (passed) {
                const advance = side === 0 ? rank : 7 - rank;
                pawnScoreMgW += (PASSED_BONUS[advance] >> 1) * sign;
                pawnScoreEgW += PASSED_BONUS[advance] * sign;
            }
        }
        for (let file = 0; file < 8; file++) {
            if (pawnFiles[0][file] > 1) { pawnScoreMgW -= 12 * (pawnFiles[0][file] - 1); pawnScoreEgW -= 18 * (pawnFiles[0][file] - 1); }
            if (pawnFiles[1][file] > 1) { pawnScoreMgW += 12 * (pawnFiles[1][file] - 1); pawnScoreEgW += 18 * (pawnFiles[1][file] - 1); }
        }

        // Rooks on open and half-open files.
        let rookScore = 0;
        for (let i = 0; i < rookCount; i++) {
            const square = rookSquares[i];
            const side = board[square] >> 3;
            const file = square & 7;
            const sign = side === 0 ? 1 : -1;
            if (pawnFiles[side][file] === 0) rookScore += (pawnFiles[side ^ 1][file] === 0 ? 20 : 10) * sign;
        }

        // The king's pawn shield, a middlegame concern only.
        let shield = 0;
        for (let side = 0; side < 2; side++) {
            const king = position.kings[side];
            const kingRank = king >> 4;
            const home = side === 0 ? kingRank <= 1 : kingRank >= 6;
            if (!home) continue;
            const forward = side === 0 ? 16 : -16;
            const pawn = (side << 3) | PAWN;
            let cover = 0;
            for (let df = -1; df <= 1; df++) {
                const base = king + df;
                if (base & 0x88) continue;
                const one = base + forward;
                const two = one + forward;
                if (!(one & 0x88) && board[one] === pawn) cover += 12;
                else if (!(two & 0x88) && board[two] === pawn) cover += 6;
            }
            shield += side === 0 ? cover : -cover;
        }

        let mg = mgWhite - mgBlack + pawnScoreMgW + rookScore + shield;
        let eg = egWhite - egBlack + pawnScoreEgW + rookScore;
        if (bishops[0] >= 2) { mg += 30; eg += 45; }
        if (bishops[1] >= 2) { mg -= 30; eg -= 45; }
        const weight = Math.min(phase, 24);
        let score = Math.round((mg * weight + eg * (24 - weight)) / 24);

        // Mop-up: with a lone enemy king, herd it to the edge with our king.
        const whitePawns = pawnFiles[0].reduce((sum, count) => sum + count, 0);
        const blackPawns = pawnFiles[1].reduce((sum, count) => sum + count, 0);
        if (nonPawn[1] === 0 && blackPawns === 0 && nonPawn[0] >= 500) {
            score += 10 * centerDistance(position.kings[1]) + 4 * (14 - kingDistance(position.kings[0], position.kings[1]));
        } else if (nonPawn[0] === 0 && whitePawns === 0 && nonPawn[1] >= 500) {
            score -= 10 * centerDistance(position.kings[0]) + 4 * (14 - kingDistance(position.kings[0], position.kings[1]));
        }
        // Without pawns, a minor piece more is not a win: scale such scores down.
        if (score > 0 && whitePawns === 0 && nonPawn[0] - nonPawn[1] < 400) score >>= 3;
        else if (score < 0 && blackPawns === 0 && nonPawn[1] - nonPawn[0] < 400) score = -((-score) >> 3);

        return (position.turn === WHITE ? score : -score) + 10;
    }

    function hasPieces(position, color) {
        const board = position.board;
        for (let square = 0; square < 128; square++) {
            if (square & 0x88) { square += 7; continue; }
            const piece = board[square];
            if (piece && (piece & BLACK) === color) {
                const type = piece & 7;
                if (type !== PAWN && type !== KING) return true;
            }
        }
        return false;
    }

    class Searcher {
        constructor(now, random) {
            this.now = now;
            this.random = random;
            this.ttLo = new Int32Array(TT_SIZE);
            this.ttHi = new Int32Array(TT_SIZE);
            this.ttMove = new Int32Array(TT_SIZE);
            this.ttScore = new Int32Array(TT_SIZE);
            this.ttDepth = new Int8Array(TT_SIZE);
            this.ttFlag = new Int8Array(TT_SIZE);
            this.moves = Array.from({ length: MAX_PLY + 1 }, () => new Int32Array(Rules.MAX_MOVES));
            this.scores = Array.from({ length: MAX_PLY + 1 }, () => new Int32Array(Rules.MAX_MOVES));
            this.killers = new Int32Array((MAX_PLY + 1) * 2);
            this.history = new Int32Array(16 * 128);
        }

        reset(position, settings, deadline) {
            this.position = position;
            this.settings = settings;
            this.deadline = deadline;
            this.stopped = false;
            this.nodes = 0;
            this.killers.fill(0);
            for (let i = 0; i < this.history.length; i++) this.history[i] >>= 2;
        }

        checkTime() {
            if (this.now() >= this.deadline) this.stopped = true;
        }

        storeTt(depth, score, flag, move, ply) {
            const position = this.position;
            const index = position.hashLo & TT_MASK;
            // Keep the deeper entry of the same position; otherwise replace.
            if (this.ttHi[index] === position.hashHi && this.ttLo[index] === position.hashLo && this.ttDepth[index] > depth && flag !== TT_EXACT) return;
            let stored = score;
            if (score > MATE_BOUND) stored = score + ply;
            else if (score < -MATE_BOUND) stored = score - ply;
            this.ttLo[index] = position.hashLo;
            this.ttHi[index] = position.hashHi;
            this.ttMove[index] = move;
            this.ttScore[index] = stored;
            this.ttDepth[index] = Math.max(-1, Math.min(127, depth));
            this.ttFlag[index] = flag;
        }

        scoreMoves(moves, scores, count, ply, ttMove) {
            const board = this.position.board;
            const killerA = this.killers[ply * 2];
            const killerB = this.killers[ply * 2 + 1];
            for (let i = 0; i < count; i++) {
                const move = moves[i];
                if (move === ttMove) {
                    scores[i] = 10000000;
                    continue;
                }
                const from = move & 127;
                const to = (move >> 7) & 127;
                const promotion = (move >> 14) & 7;
                if (move & FLAG_CAPTURE) {
                    const victim = move & FLAG_EN_PASSANT ? PAWN : board[to] & 7;
                    scores[i] = 1000000 + ORDER_VALUE[victim] * 16 - ORDER_VALUE[board[from] & 7] / 100 + promotion * 1000;
                } else if (promotion) {
                    scores[i] = 900000 + promotion * 1000;
                } else if (move === killerA) {
                    scores[i] = 800000;
                } else if (move === killerB) {
                    scores[i] = 700000;
                } else {
                    scores[i] = this.history[(board[from] << 7) | to];
                }
            }
        }

        static pick(moves, scores, count, start) {
            let best = start;
            for (let i = start + 1; i < count; i++) if (scores[i] > scores[best]) best = i;
            if (best !== start) {
                const move = moves[start];
                moves[start] = moves[best];
                moves[best] = move;
                const score = scores[start];
                scores[start] = scores[best];
                scores[best] = score;
            }
        }

        quiesce(alpha, beta, ply) {
            if ((++this.nodes & 1023) === 0) this.checkTime();
            if (this.stopped) return 0;
            const position = this.position;
            const stand = evaluate(position);
            if (!this.settings.quiescence || ply >= MAX_PLY - 1) return stand;
            if (stand >= beta) return stand;
            if (stand > alpha) alpha = stand;
            const moves = this.moves[ply];
            const scores = this.scores[ply];
            const count = position.generate(moves, 0, true);
            this.scoreMoves(moves, scores, count, ply, 0);
            const board = position.board;
            for (let i = 0; i < count; i++) {
                Searcher.pick(moves, scores, count, i);
                const move = moves[i];
                const promotion = (move >> 14) & 7;
                if (!promotion && (move & FLAG_CAPTURE)) {
                    const victim = move & FLAG_EN_PASSANT ? PAWN : board[(move >> 7) & 127] & 7;
                    // Delta pruning: even winning this piece cannot lift alpha.
                    if (stand + VALUE_EG[victim] + 200 < alpha) continue;
                }
                position.make(move);
                if (!position.lastMoveWasLegal()) {
                    position.unmake();
                    continue;
                }
                const score = -this.quiesce(-beta, -alpha, ply + 1);
                position.unmake();
                if (this.stopped) return 0;
                if (score >= beta) return score;
                if (score > alpha) alpha = score;
            }
            return alpha;
        }

        negamax(depth, alpha, beta, ply, allowNull) {
            if ((++this.nodes & 1023) === 0) this.checkTime();
            if (this.stopped) return 0;
            const position = this.position;
            if (position.halfmove >= 100 || position.repetitions() >= 2) return 0;
            // Mate-distance pruning: a mate found nearer the root cannot be beaten.
            alpha = Math.max(alpha, -MATE + ply);
            beta = Math.min(beta, MATE - ply - 1);
            if (alpha >= beta) return alpha;
            const inCheck = position.inCheck();
            if (inCheck) depth++;
            if (depth <= 0) return this.quiesce(alpha, beta, ply);
            if (ply >= MAX_PLY - 1) return evaluate(position);

            const index = position.hashLo & TT_MASK;
            let ttMove = 0;
            if (this.ttHi[index] === position.hashHi && this.ttLo[index] === position.hashLo) {
                ttMove = this.ttMove[index];
                if (this.ttDepth[index] >= depth) {
                    let score = this.ttScore[index];
                    if (score > MATE_BOUND) score -= ply;
                    else if (score < -MATE_BOUND) score += ply;
                    const flag = this.ttFlag[index];
                    if (flag === TT_EXACT || (flag === TT_LOWER && score >= beta) || (flag === TT_UPPER && score <= alpha)) return score;
                }
            }

            if (allowNull && !inCheck && depth >= 3 && beta < MATE_BOUND && hasPieces(position, position.turn) && evaluate(position) >= beta) {
                const reduction = depth > 6 ? 3 : 2;
                position.makeNull();
                const score = -this.negamax(depth - 1 - reduction, -beta, -beta + 1, ply + 1, false);
                position.unmake();
                if (this.stopped) return 0;
                if (score >= beta) return score >= MATE_BOUND ? beta : score;
            }

            const moves = this.moves[ply];
            const scores = this.scores[ply];
            const count = position.generate(moves, 0, false);
            this.scoreMoves(moves, scores, count, ply, ttMove);
            const board = position.board;
            const startAlpha = alpha;
            let best = -INF;
            let bestMove = 0;
            let legal = 0;
            for (let i = 0; i < count; i++) {
                Searcher.pick(moves, scores, count, i);
                const move = moves[i];
                const quiet = !(move & FLAG_CAPTURE) && !((move >> 14) & 7);
                const mover = board[move & 127];
                position.make(move);
                if (!position.lastMoveWasLegal()) {
                    position.unmake();
                    continue;
                }
                legal++;
                let score;
                if (legal === 1) {
                    score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
                } else {
                    let reduction = 0;
                    if (depth >= 3 && legal > 3 && quiet && !inCheck && !position.inCheck()) reduction = legal > 9 ? 2 : 1;
                    score = -this.negamax(depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true);
                    if (!this.stopped && score > alpha && (reduction > 0 || score < beta)) {
                        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
                    }
                }
                position.unmake();
                if (this.stopped) return 0;
                if (score > best) {
                    best = score;
                    bestMove = move;
                }
                if (score > alpha) alpha = score;
                if (alpha >= beta) {
                    if (quiet) {
                        if (this.killers[ply * 2] !== move) {
                            this.killers[ply * 2 + 1] = this.killers[ply * 2];
                            this.killers[ply * 2] = move;
                        }
                        const slot = (mover << 7) | ((move >> 7) & 127);
                        this.history[slot] = Math.min(600000, this.history[slot] + depth * depth);
                    }
                    break;
                }
            }
            if (legal === 0) return inCheck ? -MATE + ply : 0;
            this.storeTt(depth, best, best <= startAlpha ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT, bestMove, ply);
            return best;
        }

        /** One iteration over the root moves; `exact` scores each one with a full window. */
        searchRoot(rootMoves, depth, exact) {
            const position = this.position;
            let alpha = -INF;
            const results = [];
            for (let i = 0; i < rootMoves.length; i++) {
                const move = rootMoves[i];
                position.make(move);
                let score;
                if (exact || i === 0) {
                    score = -this.negamax(depth - 1, -INF, exact ? INF : -alpha, 1, true);
                } else {
                    score = -this.negamax(depth - 1, -alpha - 1, -alpha, 1, true);
                    if (!this.stopped && score > alpha) score = -this.negamax(depth - 1, -INF, -alpha, 1, true);
                }
                position.unmake();
                if (this.stopped) return null;
                results.push({ move, score });
                if (score > alpha) alpha = score;
            }
            return results;
        }

        think(position, settings, deadline) {
            this.reset(position, settings, deadline);
            const rootMoves = position.legalMoves();
            if (!rootMoves.length) return null;
            if (rootMoves.length === 1) return { move: rootMoves[0], score: 0, depth: 0, nodes: 0, scored: [{ move: rootMoves[0], score: 0 }] };
            let completed = null;
            const started = this.now();
            for (let depth = 1; depth <= settings.depth; depth++) {
                const results = this.searchRoot(rootMoves, depth, settings.exactRoot);
                if (!results) break;
                results.sort((a, b) => b.score - a.score);
                completed = { depth, scored: results };
                // The next iteration searches the best moves first.
                rootMoves.sort((a, b) => results.findIndex(r => r.move === a) - results.findIndex(r => r.move === b));
                if (Math.abs(results[0].score) >= MATE_BOUND) break;
                if (this.now() - started > (deadline - started) * 0.5) break;
            }
            if (!completed) {
                completed = { depth: 0, scored: rootMoves.map(move => ({ move, score: 0 })) };
            }
            return {
                move: completed.scored[0].move,
                score: completed.scored[0].score,
                depth: completed.depth,
                nodes: this.nodes,
                scored: completed.scored
            };
        }
    }

    /** Picks a root move the way a weaker player would: noisy scores, sometimes a loose choice. */
    function humanChoice(scored, settings, random) {
        if (!settings.noise && !settings.blunder) return scored[0].move;
        const best = scored[0].score;
        // Never throw away a forced mate the bot sees, and never walk into one.
        if (best >= MATE_BOUND) return scored[0].move;
        const playable = scored.filter(entry => entry.score > -MATE_BOUND || entry === scored[0]);
        if (settings.blunder && random() < settings.blunder) {
            const loose = playable.filter(entry => entry.score >= best - 350);
            return loose[Math.floor(random() * loose.length)].move;
        }
        let choice = playable[0];
        let top = -INF;
        playable.forEach(entry => {
            // A triangular spread: most picks stay near the best move.
            const noise = (random() + random() - 1) * settings.noise;
            if (entry.score + noise > top) {
                top = entry.score + noise;
                choice = entry;
            }
        });
        return choice.move;
    }

    function bookMove(game, random) {
        const candidates = openingBook().get(bookKey(game.fen()));
        if (!candidates?.length) return null;
        const uci = candidates[Math.floor(random() * candidates.length)];
        return game.findMove(uci) ? uci : null;
    }

    let sharedSearcher = null;

    /**
     * Chooses a move.
     * @param {{ moves?: string[], fen?: string, level?: number, hint?: boolean,
     *   now?: () => number, random?: () => number, timeMs?: number }} request
     * @returns {{ uci: string, san: string, score: number, depth: number, nodes: number, book: boolean } | null}
     */
    function chooseMove({ moves = [], fen = Rules.START_FEN, level = 3, hint = false, now = () => Date.now(), random = Math.random, timeMs = null } = {}) {
        const game = Rules.ChessGame.fromMoves(moves, fen);
        if (game.status().over) return null;
        const settings = hint ? HINT_SETTINGS : (LEVELS[level] || LEVELS[3]);
        if (settings.book && fen === Rules.START_FEN) {
            const uci = bookMove(game, random);
            if (uci) {
                const move = game.move(uci);
                return { uci, san: move.san, score: 0, depth: 0, nodes: 0, book: true };
            }
        }
        sharedSearcher = sharedSearcher || new Searcher(now, random);
        sharedSearcher.now = now;
        sharedSearcher.random = random;
        const budget = Number.isFinite(timeMs) ? timeMs : settings.timeMs;
        const result = sharedSearcher.think(game.position, settings, now() + budget);
        if (!result) return null;
        const chosen = hint ? result.move : humanChoice(result.scored, settings, random);
        const san = Rules.sanOf(game.position, chosen);
        return {
            uci: Rules.uciOf(chosen),
            san,
            score: result.scored.find(entry => entry.move === chosen)?.score ?? result.score,
            depth: result.depth,
            nodes: result.nodes,
            book: false
        };
    }

    return Object.freeze({ LEVELS, HINT_SETTINGS, MATE, evaluate, chooseMove, openingBook, BOOK_LINES, Searcher });
}));
