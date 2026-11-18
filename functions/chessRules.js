/**
 * Chess rules shared by the chess page, its bot and the `chess` Cloud Function.
 *
 * functions/chessRules.js is a byte-for-byte copy (a functions deploy cannot
 * reach src/); tests/chessRules.test.cjs fails when the two differ. Pure data in,
 * pure data out: no DOM, Firestore, clock or randomness of its own.
 *
 * Two layers:
 *  - `Position`: a fast 0x88 board with integer moves, make/unmake and an
 *    incremental Zobrist key. The bot searches on it directly.
 *  - `ChessGame`: the friendly wrapper the page and the server use. Squares are
 *    names ('e4'), moves are objects with UCI and SAN, and `status()` reports
 *    checkmate, stalemate and the automatic draws (threefold repetition, the
 *    fifty-move rule, insufficient material).
 *
 * The en passant square is recorded only when an enemy pawn stands next to the
 * pawn that moved two squares, so FEN and repetition keys agree on what is
 * really the same position.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module && module.exports) {
        module.exports = api;
    } else {
        root.ChessRules = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const WHITE = 0;
    const BLACK = 8;
    const PAWN = 1;
    const KNIGHT = 2;
    const BISHOP = 3;
    const ROOK = 4;
    const QUEEN = 5;
    const KING = 6;

    const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const TYPE_CHARS = ' pnbrqk';
    const SAN_LETTERS = ' PNBRQK';

    const CASTLE_WK = 1;
    const CASTLE_WQ = 2;
    const CASTLE_BK = 4;
    const CASTLE_BQ = 8;

    const KNIGHT_OFFSETS = [31, 33, 14, 18, -31, -33, -14, -18];
    const KING_OFFSETS = [1, 15, 16, 17, -1, -15, -16, -17];
    const BISHOP_OFFSETS = [15, 17, -15, -17];
    const ROOK_OFFSETS = [1, 16, -1, -16];

    // A move is one integer: from (7 bits), to (7 bits), promotion type (3 bits), flags.
    const FLAG_CAPTURE = 1 << 17;
    const FLAG_DOUBLE = 1 << 18;
    const FLAG_EN_PASSANT = 1 << 19;
    const FLAG_CASTLE = 1 << 20;

    const MAX_MOVES = 256;

    function encodeMove(from, to, promotion, flags) {
        return from | (to << 7) | (promotion << 14) | flags;
    }
    function moveFrom(move) { return move & 127; }
    function moveTo(move) { return (move >> 7) & 127; }
    function movePromotion(move) { return (move >> 14) & 7; }

    function squareName(square) {
        return 'abcdefgh'[square & 7] + ((square >> 4) + 1);
    }
    function parseSquare(name) {
        if (typeof name !== 'string' || name.length !== 2) return -1;
        const file = name.charCodeAt(0) - 97;
        const rank = name.charCodeAt(1) - 49;
        if (file < 0 || file > 7 || rank < 0 || rank > 7) return -1;
        return rank * 16 + file;
    }
    /** Light or dark square, for bishops of the same colour. */
    function squareShade(square) {
        return ((square & 7) + (square >> 4)) & 1;
    }

    // Castling rights a move keeps when it starts or ends on a square.
    const CASTLE_KEEP = new Uint8Array(128).fill(15);
    CASTLE_KEEP[4] = 15 & ~(CASTLE_WK | CASTLE_WQ);
    CASTLE_KEEP[0] = 15 & ~CASTLE_WQ;
    CASTLE_KEEP[7] = 15 & ~CASTLE_WK;
    CASTLE_KEEP[116] = 15 & ~(CASTLE_BK | CASTLE_BQ);
    CASTLE_KEEP[112] = 15 & ~CASTLE_BQ;
    CASTLE_KEEP[119] = 15 & ~CASTLE_BK;

    // Deterministic Zobrist keys (two 32-bit halves), the same on every machine.
    let zobristSeed = 0x2545f491;
    function nextRandom() {
        zobristSeed ^= zobristSeed << 13;
        zobristSeed ^= zobristSeed >>> 17;
        zobristSeed ^= zobristSeed << 5;
        return zobristSeed | 0;
    }
    function randomTable(size) {
        const table = new Int32Array(size);
        for (let i = 0; i < size; i++) table[i] = nextRandom();
        return table;
    }
    const Z_PIECE_LO = randomTable(16 * 128);
    const Z_PIECE_HI = randomTable(16 * 128);
    const Z_CASTLE_LO = randomTable(16);
    const Z_CASTLE_HI = randomTable(16);
    const Z_EP_LO = randomTable(8);
    const Z_EP_HI = randomTable(8);
    const Z_SIDE_LO = nextRandom();
    const Z_SIDE_HI = nextRandom();

    class Position {
        constructor(fen = START_FEN) {
            this.board = new Int8Array(128);
            this.kings = new Int32Array(2);
            this.capacity = 0;
            this.grow(512);
            this.load(fen);
        }

        grow(size) {
            const copy = (Type, old) => {
                const next = new Type(size);
                if (old) next.set(old.subarray(0, Math.min(old.length, size)));
                return next;
            };
            this.stackMove = copy(Int32Array, this.stackMove);
            this.stackCaptured = copy(Int8Array, this.stackCaptured);
            this.stackCastling = copy(Int8Array, this.stackCastling);
            this.stackEp = copy(Int16Array, this.stackEp);
            this.stackHalfmove = copy(Int16Array, this.stackHalfmove);
            this.stackHashLo = copy(Int32Array, this.stackHashLo);
            this.stackHashHi = copy(Int32Array, this.stackHashHi);
            this.keyLo = copy(Int32Array, this.keyLo);
            this.keyHi = copy(Int32Array, this.keyHi);
            this.capacity = size;
        }

        /** Loads a FEN; throws `INVALID_FEN` for anything that is not a legal position. */
        load(fen) {
            const parsed = parseFen(fen);
            this.board.fill(0);
            parsed.pieces.forEach(({ square, piece }) => { this.board[square] = piece; });
            this.turn = parsed.turn;
            this.castling = parsed.castling;
            this.ep = -1;
            this.halfmove = parsed.halfmove;
            this.fullmove = parsed.fullmove;
            this.ply = 0;
            for (let square = 0; square < 128; square++) {
                if (square & 0x88) { square += 7; continue; }
                const piece = this.board[square];
                if ((piece & 7) === KING) this.kings[piece >> 3] = square;
            }
            // Keep the en passant square only when a capture there is possible.
            if (parsed.ep >= 0) {
                const pawnSquare = parsed.turn === WHITE ? parsed.ep - 16 : parsed.ep + 16;
                if (this.board[pawnSquare] === ((parsed.turn ^ BLACK) | PAWN) && !this.board[parsed.ep]
                    && this.hasAdjacentPawn(pawnSquare, parsed.turn)) {
                    this.ep = parsed.ep;
                }
            }
            this.computeHash();
            this.keyLo[0] = this.hashLo;
            this.keyHi[0] = this.hashHi;
        }

        computeHash() {
            let lo = 0;
            let hi = 0;
            for (let square = 0; square < 128; square++) {
                if (square & 0x88) { square += 7; continue; }
                const piece = this.board[square];
                if (piece) {
                    lo ^= Z_PIECE_LO[piece * 128 + square];
                    hi ^= Z_PIECE_HI[piece * 128 + square];
                }
            }
            lo ^= Z_CASTLE_LO[this.castling];
            hi ^= Z_CASTLE_HI[this.castling];
            if (this.ep >= 0) {
                lo ^= Z_EP_LO[this.ep & 7];
                hi ^= Z_EP_HI[this.ep & 7];
            }
            if (this.turn === BLACK) {
                lo ^= Z_SIDE_LO;
                hi ^= Z_SIDE_HI;
            }
            this.hashLo = lo;
            this.hashHi = hi;
        }

        /** True when a pawn of `color` stands right beside `square`. */
        hasAdjacentPawn(square, color) {
            const pawn = color | PAWN;
            const left = square - 1;
            const right = square + 1;
            return (!(left & 0x88) && this.board[left] === pawn) || (!(right & 0x88) && this.board[right] === pawn);
        }

        fen() {
            const rows = [];
            for (let rank = 7; rank >= 0; rank--) {
                let row = '';
                let empty = 0;
                for (let file = 0; file < 8; file++) {
                    const piece = this.board[rank * 16 + file];
                    if (!piece) { empty++; continue; }
                    if (empty) { row += empty; empty = 0; }
                    const char = TYPE_CHARS[piece & 7];
                    row += piece & BLACK ? char : char.toUpperCase();
                }
                if (empty) row += empty;
                rows.push(row);
            }
            let castling = '';
            if (this.castling & CASTLE_WK) castling += 'K';
            if (this.castling & CASTLE_WQ) castling += 'Q';
            if (this.castling & CASTLE_BK) castling += 'k';
            if (this.castling & CASTLE_BQ) castling += 'q';
            return [
                rows.join('/'),
                this.turn === WHITE ? 'w' : 'b',
                castling || '-',
                this.ep >= 0 ? squareName(this.ep) : '-',
                this.halfmove,
                this.fullmove
            ].join(' ');
        }

        /** Is `square` attacked by any piece of `by`? */
        attacked(square, by) {
            const board = this.board;
            let from;
            if (by === WHITE) {
                from = square - 15;
                if (!(from & 0x88) && board[from] === (WHITE | PAWN)) return true;
                from = square - 17;
                if (!(from & 0x88) && board[from] === (WHITE | PAWN)) return true;
            } else {
                from = square + 15;
                if (!(from & 0x88) && board[from] === (BLACK | PAWN)) return true;
                from = square + 17;
                if (!(from & 0x88) && board[from] === (BLACK | PAWN)) return true;
            }
            const knight = by | KNIGHT;
            const king = by | KING;
            for (let i = 0; i < 8; i++) {
                from = square + KNIGHT_OFFSETS[i];
                if (!(from & 0x88) && board[from] === knight) return true;
                from = square + KING_OFFSETS[i];
                if (!(from & 0x88) && board[from] === king) return true;
            }
            const bishop = by | BISHOP;
            const rook = by | ROOK;
            const queen = by | QUEEN;
            for (let i = 0; i < 4; i++) {
                let step = BISHOP_OFFSETS[i];
                from = square + step;
                while (!(from & 0x88)) {
                    const piece = board[from];
                    if (piece) {
                        if (piece === bishop || piece === queen) return true;
                        break;
                    }
                    from += step;
                }
                step = ROOK_OFFSETS[i];
                from = square + step;
                while (!(from & 0x88)) {
                    const piece = board[from];
                    if (piece) {
                        if (piece === rook || piece === queen) return true;
                        break;
                    }
                    from += step;
                }
            }
            return false;
        }

        inCheck() {
            return this.attacked(this.kings[this.turn >> 3], this.turn ^ BLACK);
        }

        /**
         * Writes pseudo-legal moves into `out` from `start` and returns the new
         * count. `capturesOnly` keeps captures and promotions (for quiescence).
         */
        generate(out, start = 0, capturesOnly = false) {
            const board = this.board;
            const us = this.turn;
            const them = us ^ BLACK;
            let count = start;
            for (let from = 0; from < 128; from++) {
                if (from & 0x88) { from += 7; continue; }
                const piece = board[from];
                if (!piece || (piece & BLACK) !== us) continue;
                const type = piece & 7;
                if (type === PAWN) {
                    const forward = us === WHITE ? 16 : -16;
                    const rank = from >> 4;
                    const promotes = rank === (us === WHITE ? 6 : 1);
                    const one = from + forward;
                    if (!board[one]) {
                        if (promotes) {
                            count = addPromotions(out, count, from, one, 0);
                        } else if (!capturesOnly) {
                            out[count++] = encodeMove(from, one, 0, 0);
                            if (rank === (us === WHITE ? 1 : 6) && !board[one + forward]) {
                                out[count++] = encodeMove(from, one + forward, 0, FLAG_DOUBLE);
                            }
                        }
                    }
                    for (let side = -1; side <= 1; side += 2) {
                        const to = one + side;
                        if (to & 0x88) continue;
                        const target = board[to];
                        if (target && (target & BLACK) === them) {
                            if (promotes) count = addPromotions(out, count, from, to, FLAG_CAPTURE);
                            else out[count++] = encodeMove(from, to, 0, FLAG_CAPTURE);
                        } else if (to === this.ep) {
                            out[count++] = encodeMove(from, to, 0, FLAG_CAPTURE | FLAG_EN_PASSANT);
                        }
                    }
                } else if (type === KNIGHT || type === KING) {
                    const offsets = type === KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS;
                    for (let i = 0; i < 8; i++) {
                        const to = from + offsets[i];
                        if (to & 0x88) continue;
                        const target = board[to];
                        if (!target) {
                            if (!capturesOnly) out[count++] = encodeMove(from, to, 0, 0);
                        } else if ((target & BLACK) === them) {
                            out[count++] = encodeMove(from, to, 0, FLAG_CAPTURE);
                        }
                    }
                    if (type === KING && !capturesOnly) count = this.generateCastles(out, count, from);
                } else {
                    const offsets = type === BISHOP ? BISHOP_OFFSETS : type === ROOK ? ROOK_OFFSETS : KING_OFFSETS;
                    for (let i = 0; i < offsets.length; i++) {
                        const step = offsets[i];
                        let to = from + step;
                        while (!(to & 0x88)) {
                            const target = board[to];
                            if (!target) {
                                if (!capturesOnly) out[count++] = encodeMove(from, to, 0, 0);
                            } else {
                                if ((target & BLACK) === them) out[count++] = encodeMove(from, to, 0, FLAG_CAPTURE);
                                break;
                            }
                            to += step;
                        }
                    }
                }
            }
            return count;
        }

        generateCastles(out, count, from) {
            const board = this.board;
            const us = this.turn;
            const them = us ^ BLACK;
            const base = us === WHITE ? 0 : 112;
            if (from !== base + 4) return count;
            const rook = us | ROOK;
            const kingSide = us === WHITE ? CASTLE_WK : CASTLE_BK;
            const queenSide = us === WHITE ? CASTLE_WQ : CASTLE_BQ;
            if ((this.castling & kingSide) && !board[base + 5] && !board[base + 6] && board[base + 7] === rook
                && !this.attacked(base + 4, them) && !this.attacked(base + 5, them) && !this.attacked(base + 6, them)) {
                out[count++] = encodeMove(from, base + 6, 0, FLAG_CASTLE);
            }
            if ((this.castling & queenSide) && !board[base + 3] && !board[base + 2] && !board[base + 1] && board[base] === rook
                && !this.attacked(base + 4, them) && !this.attacked(base + 3, them) && !this.attacked(base + 2, them)) {
                out[count++] = encodeMove(from, base + 2, 0, FLAG_CASTLE);
            }
            return count;
        }

        make(move) {
            const ply = this.ply;
            if (ply + 2 >= this.capacity) this.grow(this.capacity * 2);
            const board = this.board;
            const from = move & 127;
            const to = (move >> 7) & 127;
            const promotion = (move >> 14) & 7;
            const piece = board[from];
            const us = this.turn;
            const them = us ^ BLACK;
            let lo = this.hashLo;
            let hi = this.hashHi;

            this.stackMove[ply] = move;
            this.stackCastling[ply] = this.castling;
            this.stackEp[ply] = this.ep;
            this.stackHalfmove[ply] = this.halfmove;
            this.stackHashLo[ply] = lo;
            this.stackHashHi[ply] = hi;

            if (this.ep >= 0) {
                lo ^= Z_EP_LO[this.ep & 7];
                hi ^= Z_EP_HI[this.ep & 7];
            }
            let captured = 0;
            if (move & FLAG_EN_PASSANT) {
                const victim = us === WHITE ? to - 16 : to + 16;
                captured = board[victim];
                board[victim] = 0;
                lo ^= Z_PIECE_LO[captured * 128 + victim];
                hi ^= Z_PIECE_HI[captured * 128 + victim];
            } else if (board[to]) {
                captured = board[to];
                lo ^= Z_PIECE_LO[captured * 128 + to];
                hi ^= Z_PIECE_HI[captured * 128 + to];
            }
            this.stackCaptured[ply] = captured;

            const placed = promotion ? (us | promotion) : piece;
            board[from] = 0;
            board[to] = placed;
            lo ^= Z_PIECE_LO[piece * 128 + from] ^ Z_PIECE_LO[placed * 128 + to];
            hi ^= Z_PIECE_HI[piece * 128 + from] ^ Z_PIECE_HI[placed * 128 + to];

            if ((piece & 7) === KING) {
                this.kings[us >> 3] = to;
                if (move & FLAG_CASTLE) {
                    const rookFrom = to > from ? from + 3 : from - 4;
                    const rookTo = to > from ? from + 1 : from - 1;
                    const rook = board[rookFrom];
                    board[rookFrom] = 0;
                    board[rookTo] = rook;
                    lo ^= Z_PIECE_LO[rook * 128 + rookFrom] ^ Z_PIECE_LO[rook * 128 + rookTo];
                    hi ^= Z_PIECE_HI[rook * 128 + rookFrom] ^ Z_PIECE_HI[rook * 128 + rookTo];
                }
            }

            const castling = this.castling & CASTLE_KEEP[from] & CASTLE_KEEP[to];
            if (castling !== this.castling) {
                lo ^= Z_CASTLE_LO[this.castling] ^ Z_CASTLE_LO[castling];
                hi ^= Z_CASTLE_HI[this.castling] ^ Z_CASTLE_HI[castling];
                this.castling = castling;
            }

            this.ep = -1;
            if ((move & FLAG_DOUBLE) && this.hasAdjacentPawn(to, them)) {
                this.ep = (from + to) >> 1;
                lo ^= Z_EP_LO[this.ep & 7];
                hi ^= Z_EP_HI[this.ep & 7];
            }

            this.halfmove = (piece & 7) === PAWN || captured ? 0 : this.halfmove + 1;
            if (us === BLACK) this.fullmove++;
            this.turn = them;
            lo ^= Z_SIDE_LO;
            hi ^= Z_SIDE_HI;
            this.hashLo = lo;
            this.hashHi = hi;
            this.ply = ply + 1;
            this.keyLo[this.ply] = lo;
            this.keyHi[this.ply] = hi;
        }

        unmake() {
            const ply = --this.ply;
            const move = this.stackMove[ply];
            const board = this.board;
            const us = this.turn ^ BLACK;
            this.turn = us;
            this.castling = this.stackCastling[ply];
            this.ep = this.stackEp[ply];
            this.halfmove = this.stackHalfmove[ply];
            this.hashLo = this.stackHashLo[ply];
            this.hashHi = this.stackHashHi[ply];
            if (move === 0) return; // null move
            if (us === BLACK) this.fullmove--;
            const from = move & 127;
            const to = (move >> 7) & 127;
            const promotion = (move >> 14) & 7;
            const piece = promotion ? (us | PAWN) : board[to];
            board[from] = piece;
            board[to] = 0;
            const captured = this.stackCaptured[ply];
            if (move & FLAG_EN_PASSANT) {
                board[us === WHITE ? to - 16 : to + 16] = captured;
            } else if (captured) {
                board[to] = captured;
            }
            if ((piece & 7) === KING) {
                this.kings[us >> 3] = from;
                if (move & FLAG_CASTLE) {
                    const rookFrom = to > from ? from + 3 : from - 4;
                    const rookTo = to > from ? from + 1 : from - 1;
                    board[rookFrom] = board[rookTo];
                    board[rookTo] = 0;
                }
            }
        }

        /** Passes the turn without moving (the search's null-move pruning). */
        makeNull() {
            const ply = this.ply;
            if (ply + 2 >= this.capacity) this.grow(this.capacity * 2);
            this.stackMove[ply] = 0;
            this.stackCastling[ply] = this.castling;
            this.stackEp[ply] = this.ep;
            this.stackHalfmove[ply] = this.halfmove;
            this.stackHashLo[ply] = this.hashLo;
            this.stackHashHi[ply] = this.hashHi;
            if (this.ep >= 0) {
                this.hashLo ^= Z_EP_LO[this.ep & 7];
                this.hashHi ^= Z_EP_HI[this.ep & 7];
                this.ep = -1;
            }
            this.halfmove++;
            this.turn ^= BLACK;
            this.hashLo ^= Z_SIDE_LO;
            this.hashHi ^= Z_SIDE_HI;
            this.ply = ply + 1;
            this.keyLo[this.ply] = this.hashLo;
            this.keyHi[this.ply] = this.hashHi;
        }

        /** Does the side that just moved have its king safe? */
        lastMoveWasLegal() {
            return !this.attacked(this.kings[(this.turn ^ BLACK) >> 3], this.turn);
        }

        legalMoves() {
            const buffer = new Int32Array(MAX_MOVES);
            const count = this.generate(buffer, 0, false);
            const legal = [];
            for (let i = 0; i < count; i++) {
                this.make(buffer[i]);
                if (this.lastMoveWasLegal()) legal.push(buffer[i]);
                this.unmake();
            }
            return legal;
        }

        hasLegalMove() {
            const buffer = new Int32Array(MAX_MOVES);
            const count = this.generate(buffer, 0, false);
            for (let i = 0; i < count; i++) {
                this.make(buffer[i]);
                const legal = this.lastMoveWasLegal();
                this.unmake();
                if (legal) return true;
            }
            return false;
        }

        /** How many times the current position has occurred, this time included. */
        repetitions() {
            const lo = this.keyLo[this.ply];
            const hi = this.keyHi[this.ply];
            const stop = Math.max(0, this.ply - this.halfmove);
            let count = 1;
            for (let i = this.ply - 2; i >= stop; i -= 2) {
                if (this.keyLo[i] === lo && this.keyHi[i] === hi) count++;
            }
            return count;
        }

        /** Neither side can ever mate: K v K, K+minor v K, or only same-shade bishops. */
        insufficientMaterial() {
            let knights = 0;
            const bishops = [0, 0];
            for (let square = 0; square < 128; square++) {
                if (square & 0x88) { square += 7; continue; }
                const type = this.board[square] & 7;
                if (type === PAWN || type === ROOK || type === QUEEN) return false;
                if (type === KNIGHT) knights++;
                else if (type === BISHOP) bishops[squareShade(square)]++;
            }
            const minors = knights + bishops[0] + bishops[1];
            if (minors <= 1) return true;
            return knights === 0 && (bishops[0] === 0 || bishops[1] === 0);
        }

        pieceAt(square) {
            return this.board[square];
        }
    }

    function addPromotions(out, count, from, to, flags) {
        out[count++] = encodeMove(from, to, QUEEN, flags);
        out[count++] = encodeMove(from, to, ROOK, flags);
        out[count++] = encodeMove(from, to, BISHOP, flags);
        out[count++] = encodeMove(from, to, KNIGHT, flags);
        return count;
    }

    function invalidFen(reason) {
        const error = new Error(`INVALID_FEN: ${reason}`);
        error.code = 'INVALID_FEN';
        return error;
    }

    function parseFen(fen) {
        if (typeof fen !== 'string') throw invalidFen('not a string');
        const fields = fen.trim().split(/\s+/);
        if (fields.length < 4 || fields.length > 6) throw invalidFen('field count');
        const rows = fields[0].split('/');
        if (rows.length !== 8) throw invalidFen('rank count');
        const pieces = [];
        const kings = [0, 0];
        rows.forEach((row, index) => {
            const rank = 7 - index;
            let file = 0;
            for (const char of row) {
                if (char >= '1' && char <= '8') {
                    file += Number(char);
                    continue;
                }
                const type = TYPE_CHARS.indexOf(char.toLowerCase());
                if (type <= 0 || file > 7) throw invalidFen(`bad square "${char}"`);
                const color = char === char.toLowerCase() ? BLACK : WHITE;
                if (type === PAWN && (rank === 0 || rank === 7)) throw invalidFen('pawn on the back rank');
                if (type === KING) kings[color >> 3]++;
                pieces.push({ square: rank * 16 + file, piece: color | type });
                file++;
            }
            if (file !== 8) throw invalidFen('rank length');
        });
        if (kings[0] !== 1 || kings[1] !== 1) throw invalidFen('king count');
        if (fields[1] !== 'w' && fields[1] !== 'b') throw invalidFen('side to move');
        const turn = fields[1] === 'w' ? WHITE : BLACK;
        let castling = 0;
        if (fields[2] !== '-') {
            if (!/^[KQkq]{1,4}$/.test(fields[2])) throw invalidFen('castling');
            if (fields[2].includes('K')) castling |= CASTLE_WK;
            if (fields[2].includes('Q')) castling |= CASTLE_WQ;
            if (fields[2].includes('k')) castling |= CASTLE_BK;
            if (fields[2].includes('q')) castling |= CASTLE_BQ;
        }
        // Drop rights whose king or rook is not on its original square.
        const at = square => pieces.find(entry => entry.square === square)?.piece || 0;
        if (at(4) !== (WHITE | KING)) castling &= ~(CASTLE_WK | CASTLE_WQ);
        if (at(7) !== (WHITE | ROOK)) castling &= ~CASTLE_WK;
        if (at(0) !== (WHITE | ROOK)) castling &= ~CASTLE_WQ;
        if (at(116) !== (BLACK | KING)) castling &= ~(CASTLE_BK | CASTLE_BQ);
        if (at(119) !== (BLACK | ROOK)) castling &= ~CASTLE_BK;
        if (at(112) !== (BLACK | ROOK)) castling &= ~CASTLE_BQ;
        let ep = -1;
        if (fields[3] !== '-') {
            ep = parseSquare(fields[3]);
            if (ep < 0 || (ep >> 4) !== (turn === WHITE ? 5 : 2)) throw invalidFen('en passant square');
        }
        const halfmove = fields[4] === undefined ? 0 : Number(fields[4]);
        const fullmove = fields[5] === undefined ? 1 : Number(fields[5]);
        if (!Number.isInteger(halfmove) || halfmove < 0 || halfmove > 9999) throw invalidFen('halfmove clock');
        if (!Number.isInteger(fullmove) || fullmove < 1 || fullmove > 9999) throw invalidFen('move number');
        // The side that just moved must not have left its king in check.
        const probe = Object.create(Position.prototype);
        probe.board = new Int8Array(128);
        pieces.forEach(({ square, piece }) => { probe.board[square] = piece; });
        const waitingKing = pieces.find(entry => entry.piece === ((turn ^ BLACK) | KING)).square;
        if (probe.attacked(waitingKing, turn)) throw invalidFen('the side not to move is in check');
        return { pieces, turn, castling, ep, halfmove, fullmove };
    }

    function isValidFen(fen) {
        try {
            parseFen(fen);
            return true;
        } catch {
            return false;
        }
    }

    // --- Friendly layer -------------------------------------------------------------------

    const COLOR_NAMES = { [WHITE]: 'w', [BLACK]: 'b' };

    /** Standard Algebraic Notation of a legal `move` in `position`. */
    function sanOf(position, move, legal = position.legalMoves()) {
        const from = moveFrom(move);
        const to = moveTo(move);
        const piece = position.board[from];
        const type = piece & 7;
        let san;
        if (move & FLAG_CASTLE) {
            san = to > from ? 'O-O' : 'O-O-O';
        } else if (type === PAWN) {
            san = move & FLAG_CAPTURE ? `${'abcdefgh'[from & 7]}x${squareName(to)}` : squareName(to);
            const promotion = movePromotion(move);
            if (promotion) san += `=${SAN_LETTERS[promotion]}`;
        } else {
            let sameFile = false;
            let sameRank = false;
            let ambiguous = false;
            legal.forEach(other => {
                if (other === move || moveTo(other) !== to) return;
                const otherFrom = moveFrom(other);
                if (otherFrom === from || position.board[otherFrom] !== piece) return;
                ambiguous = true;
                if ((otherFrom & 7) === (from & 7)) sameFile = true;
                if ((otherFrom >> 4) === (from >> 4)) sameRank = true;
            });
            let disambiguation = '';
            if (ambiguous) {
                if (!sameFile) disambiguation = 'abcdefgh'[from & 7];
                else if (!sameRank) disambiguation = String((from >> 4) + 1);
                else disambiguation = squareName(from);
            }
            san = SAN_LETTERS[type] + disambiguation + (move & FLAG_CAPTURE ? 'x' : '') + squareName(to);
        }
        position.make(move);
        if (position.inCheck()) san += position.hasLegalMove() ? '+' : '#';
        position.unmake();
        return san;
    }

    function uciOf(move) {
        const promotion = movePromotion(move);
        return squareName(moveFrom(move)) + squareName(moveTo(move)) + (promotion ? TYPE_CHARS[promotion] : '');
    }

    /** Plain-data description of a move, before it is made. */
    function describeMove(position, move) {
        const from = moveFrom(move);
        const to = moveTo(move);
        const piece = position.board[from];
        const promotion = movePromotion(move);
        const enPassant = Boolean(move & FLAG_EN_PASSANT);
        const captureSquare = enPassant ? (position.turn === WHITE ? to - 16 : to + 16) : to;
        const captured = move & FLAG_CAPTURE ? position.board[captureSquare] : 0;
        let castle = null;
        let rookFrom = null;
        let rookTo = null;
        if (move & FLAG_CASTLE) {
            castle = to > from ? 'k' : 'q';
            rookFrom = squareName(to > from ? from + 3 : from - 4);
            rookTo = squareName(to > from ? from + 1 : from - 1);
        }
        return {
            from: squareName(from),
            to: squareName(to),
            uci: uciOf(move),
            color: COLOR_NAMES[piece & BLACK],
            piece: TYPE_CHARS[piece & 7],
            captured: captured ? TYPE_CHARS[captured & 7] : null,
            captureSquare: captured ? squareName(captureSquare) : null,
            promotion: promotion ? TYPE_CHARS[promotion] : null,
            enPassant,
            castle,
            rookFrom,
            rookTo,
            code: move
        };
    }

    const STRIP_SAN = /[+#!?]+$/;

    function normalizeSan(text) {
        return String(text).trim().replace(STRIP_SAN, '').replace(/0/g, 'O').replace(/=?([QRBN])$/i, (_, letter) => `=${letter.toUpperCase()}`);
    }

    class ChessGame {
        constructor(startFen = START_FEN) {
            this.startFen = startFen;
            this.position = new Position(startFen);
            this.played = [];
        }

        /** Replays UCI moves; throws `ILLEGAL_MOVE` at the first one that is not legal. */
        static fromMoves(moves = [], startFen = START_FEN) {
            const game = new ChessGame(startFen);
            moves.forEach((input, index) => {
                if (!game.move(input)) {
                    const error = new Error(`ILLEGAL_MOVE at ${index}: ${input}`);
                    error.code = 'ILLEGAL_MOVE';
                    throw error;
                }
            });
            return game;
        }

        fen() {
            return this.position.fen();
        }

        turn() {
            return COLOR_NAMES[this.position.turn];
        }

        moveNumber() {
            return this.position.fullmove;
        }

        inCheck() {
            return this.position.inCheck();
        }

        /** Every piece as { square, type, color }. */
        pieces() {
            const list = [];
            const board = this.position.board;
            for (let square = 0; square < 128; square++) {
                if (square & 0x88) { square += 7; continue; }
                const piece = board[square];
                if (piece) list.push({ square: squareName(square), type: TYPE_CHARS[piece & 7], color: COLOR_NAMES[piece & BLACK] });
            }
            return list;
        }

        get(square) {
            const index = parseSquare(square);
            if (index < 0) return null;
            const piece = this.position.board[index];
            return piece ? { type: TYPE_CHARS[piece & 7], color: COLOR_NAMES[piece & BLACK] } : null;
        }

        /** Square name of the king of `color` ('w' or 'b'). */
        kingSquare(color) {
            return squareName(this.position.kings[color === 'b' ? 1 : 0]);
        }

        /** Legal moves (optionally only from one square), without SAN. */
        moves({ square = null } = {}) {
            const from = square === null ? -1 : parseSquare(square);
            return this.position.legalMoves()
                .filter(move => from < 0 || moveFrom(move) === from)
                .map(move => describeMove(this.position, move));
        }

        /** Finds the legal move meant by UCI, SAN or { from, to, promotion }. */
        findMove(input) {
            const legal = this.position.legalMoves();
            if (input && typeof input === 'object') {
                const from = parseSquare(input.from);
                const to = parseSquare(input.to);
                const promotion = input.promotion ? TYPE_CHARS.indexOf(String(input.promotion).toLowerCase()) : 0;
                return legal.find(move => moveFrom(move) === from && moveTo(move) === to && movePromotion(move) === promotion) ?? null;
            }
            const text = String(input || '').trim();
            const uci = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(text);
            if (uci) {
                return this.findMove({ from: uci[1].toLowerCase(), to: uci[2].toLowerCase(), promotion: uci[3] || null });
            }
            const wanted = normalizeSan(text);
            return legal.find(move => normalizeSan(sanOf(this.position, move, legal)) === wanted) ?? null;
        }

        /** Makes a move; returns its description with SAN, or null when it is illegal. */
        move(input) {
            const move = this.findMove(input);
            if (move === null) return null;
            const legal = this.position.legalMoves();
            const entry = describeMove(this.position, move);
            entry.san = sanOf(this.position, move, legal);
            entry.fenBefore = this.position.fen();
            this.position.make(move);
            entry.check = this.position.inCheck();
            entry.mate = entry.check && !this.position.hasLegalMove();
            entry.fen = this.position.fen();
            this.played.push(entry);
            return { ...entry };
        }

        undo() {
            if (!this.played.length) return null;
            this.position.unmake();
            return { ...this.played.pop() };
        }

        history() {
            return this.played.map(entry => ({ ...entry }));
        }

        uciMoves() {
            return this.played.map(entry => entry.uci);
        }

        lastMove() {
            const last = this.played[this.played.length - 1];
            return last ? { ...last } : null;
        }

        /**
         * { over, result: '1-0' | '0-1' | '1/2-1/2' | null, reason, winner, check }.
         * Reasons: checkmate, stalemate, insufficient, fifty-move, threefold.
         */
        status() {
            const position = this.position;
            const check = position.inCheck();
            const turn = COLOR_NAMES[position.turn];
            if (!position.hasLegalMove()) {
                if (check) {
                    const winner = turn === 'w' ? 'b' : 'w';
                    return { over: true, result: winner === 'w' ? '1-0' : '0-1', reason: 'checkmate', winner, check, turn };
                }
                return { over: true, result: '1/2-1/2', reason: 'stalemate', winner: null, check, turn };
            }
            if (position.insufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient', winner: null, check, turn };
            if (position.halfmove >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty-move', winner: null, check, turn };
            if (position.repetitions() >= 3) return { over: true, result: '1/2-1/2', reason: 'threefold', winner: null, check, turn };
            return { over: false, result: null, reason: null, winner: null, check, turn };
        }

        /** Material each side has taken, as piece letters, for the captured-pieces trays. */
        capturedPieces() {
            const taken = { w: [], b: [] };
            this.played.forEach(entry => {
                if (entry.captured) taken[entry.color].push(entry.captured);
            });
            return taken;
        }
    }

    /** Counts leaf nodes to `depth` (the standard move-generator check). */
    function perft(position, depth) {
        if (depth === 0) return 1;
        const buffer = new Int32Array(MAX_MOVES);
        const count = position.generate(buffer, 0, false);
        let nodes = 0;
        for (let i = 0; i < count; i++) {
            position.make(buffer[i]);
            if (position.lastMoveWasLegal()) nodes += depth === 1 ? 1 : perft(position, depth - 1);
            position.unmake();
        }
        return nodes;
    }

    return Object.freeze({
        START_FEN,
        WHITE,
        BLACK,
        PAWN,
        KNIGHT,
        BISHOP,
        ROOK,
        QUEEN,
        KING,
        FLAG_CAPTURE,
        FLAG_DOUBLE,
        FLAG_EN_PASSANT,
        FLAG_CASTLE,
        MAX_MOVES,
        Position,
        ChessGame,
        encodeMove,
        moveFrom,
        moveTo,
        movePromotion,
        squareName,
        parseSquare,
        squareShade,
        isValidFen,
        sanOf,
        uciOf,
        describeMove,
        perft
    });
}));
