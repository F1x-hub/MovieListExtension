/**
 * Battleship rules shared by the extension page and the `battleship` Cloud Function.
 *
 * functions/battleshipRules.js is a byte-for-byte copy (a functions deploy cannot
 * reach src/); tests/battleshipRules.test.cjs fails when the two differ. Pure data
 * in, pure data out: no DOM, Firestore, clock or randomness of its own.
 *
 * Board: 10×10 cells, index = y * 10 + x; x is the column (0 = А / A), y the row
 * (0 = row 1). A ship is { x, y, length, vertical } anchored at its top-left cell.
 * Classic Russian fleet: one 4-deck, two 3-deck, three 2-deck and four 1-deck
 * ships, which may not touch each other, not even at a corner.
 *
 * Marks: a 100-character string with what a board's opponent knows about it:
 *   .  not shot yet
 *   o  shot, missed
 *   x  shot, hit a ship that is still afloat
 *   #  hit, the ship is sunk
 *   *  never shot, but known to be empty (next to a hit or a sunk ship)
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module && module.exports) {
        module.exports = api;
    } else {
        root.BattleshipRules = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const SIZE = 10;
    const CELL_COUNT = SIZE * SIZE;
    const FLEET = Object.freeze([4, 3, 3, 2, 2, 2, 1, 1, 1, 1]);
    const MAX_SHIP_LENGTH = 4;
    const FLEET_CELL_COUNT = FLEET.reduce((sum, length) => sum + length, 0);
    const MARK = Object.freeze({ UNKNOWN: '.', MISS: 'o', HIT: 'x', SUNK: '#', CLEAR: '*' });
    const MARKS_PATTERN = /^[.ox#*]{100}$/;
    const COLUMN_LABELS = Object.freeze({
        ru: Object.freeze(['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К']),
        en: Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'])
    });

    function rulesError(code, message) {
        const error = new Error(message || code);
        error.code = code;
        return error;
    }

    function isIndex(value) {
        return Number.isInteger(value) && value >= 0 && value < CELL_COUNT;
    }

    function inBounds(x, y) {
        return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < SIZE && y < SIZE;
    }

    function toIndex(x, y) {
        return y * SIZE + x;
    }

    function toPoint(index) {
        return { x: index % SIZE, y: Math.floor(index / SIZE) };
    }

    /** The cells a ship covers, as a box: x0..x1 and y0..y1 inclusive. */
    function shipBox(ship) {
        return {
            x0: ship.x,
            y0: ship.y,
            x1: ship.x + (ship.vertical ? 0 : ship.length - 1),
            y1: ship.y + (ship.vertical ? ship.length - 1 : 0)
        };
    }

    function shipFits(ship) {
        const box = shipBox(ship);
        return inBounds(box.x0, box.y0) && inBounds(box.x1, box.y1);
    }

    /**
     * A ship in canonical form, or null when the value is not a ship that fits the
     * board. A one-deck ship is never vertical, so equal ships compare equal.
     */
    function normalizeShip(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const { x, y, length } = raw;
        if (raw.vertical !== undefined && typeof raw.vertical !== 'boolean') return null;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(length)) return null;
        if (length < 1 || length > MAX_SHIP_LENGTH) return null;
        const ship = { x, y, length, vertical: length > 1 && raw.vertical === true };
        return shipFits(ship) ? ship : null;
    }

    function shipCells(ship) {
        const cells = [];
        for (let step = 0; step < ship.length; step += 1) {
            cells.push(toIndex(ship.x + (ship.vertical ? 0 : step), ship.y + (ship.vertical ? step : 0)));
        }
        return cells;
    }

    function neighbors(index, { diagonalOnly = false } = {}) {
        const { x, y } = toPoint(index);
        const result = [];
        for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
                if (dx === 0 && dy === 0) continue;
                if (diagonalOnly && (dx === 0 || dy === 0)) continue;
                if (inBounds(x + dx, y + dy)) result.push(toIndex(x + dx, y + dy));
            }
        }
        return result;
    }

    /** Cells around a ship that belong to no ship, because ships never touch. */
    function shipHalo(ship) {
        const own = new Set(shipCells(ship));
        const halo = new Set();
        for (const cell of own) {
            for (const next of neighbors(cell)) {
                if (!own.has(next)) halo.add(next);
            }
        }
        return [...halo].sort((a, b) => a - b);
    }

    /** True when two ships overlap or touch, a corner included. */
    function shipsConflict(a, b) {
        const p = shipBox(a);
        const q = shipBox(b);
        return p.x0 - 1 <= q.x1 && q.x0 <= p.x1 + 1 && p.y0 - 1 <= q.y1 && q.y0 <= p.y1 + 1;
    }

    /**
     * Whether a ship can join the others. `skipIndex` leaves one of them out, for a
     * ship being moved. Empty slots (null) in the list are ignored.
     */
    function canPlace(ships, candidate, skipIndex = -1) {
        const ship = normalizeShip(candidate);
        if (!ship) return false;
        return (Array.isArray(ships) ? ships : []).every((other, index) => (
            index === skipIndex || !other || !shipsConflict(ship, other)
        ));
    }

    function compareShips(a, b) {
        return (b.length - a.length) || (a.y - b.y) || (a.x - b.x) || (Number(a.vertical) - Number(b.vertical));
    }

    /**
     * Checks a complete fleet. Returns { ok: true, ships } with ships in canonical
     * form and order, or { ok: false, code } naming the first broken rule.
     */
    function validateFleet(rawShips) {
        if (!Array.isArray(rawShips) || rawShips.length !== FLEET.length) {
            return { ok: false, code: 'FLEET_SIZE' };
        }
        const ships = [];
        for (const raw of rawShips) {
            const ship = normalizeShip(raw);
            if (!ship) return { ok: false, code: 'SHIP_INVALID' };
            ships.push(ship);
        }
        const lengths = ships.map(ship => ship.length).sort((a, b) => b - a);
        if (lengths.join(',') !== FLEET.join(',')) return { ok: false, code: 'FLEET_COMPOSITION' };
        for (let first = 0; first < ships.length; first += 1) {
            for (let second = first + 1; second < ships.length; second += 1) {
                if (shipsConflict(ships[first], ships[second])) return { ok: false, code: 'SHIPS_TOUCH' };
            }
        }
        return { ok: true, ships: ships.sort(compareShips) };
    }

    /**
     * A random valid fleet. Each ship is drawn uniformly from the positions still
     * free, largest first; a dead end (very rare) starts the fleet again.
     * @param {() => number} random - values in [0, 1)
     */
    function randomFleet(random = Math.random) {
        for (let attempt = 0; attempt < 200; attempt += 1) {
            const ships = [];
            let stuck = false;
            for (const length of FLEET) {
                const options = [];
                for (const vertical of length > 1 ? [false, true] : [false]) {
                    for (let y = 0; y < SIZE; y += 1) {
                        for (let x = 0; x < SIZE; x += 1) {
                            const ship = { x, y, length, vertical };
                            if (shipFits(ship) && ships.every(other => !shipsConflict(ship, other))) options.push(ship);
                        }
                    }
                }
                if (!options.length) {
                    stuck = true;
                    break;
                }
                const pick = Math.floor(Number(random()) * options.length);
                ships.push(options[Math.min(options.length - 1, Math.max(0, pick || 0))]);
            }
            if (!stuck) return ships.sort(compareShips);
        }
        throw rulesError('FLEET_UNPLACEABLE', 'Could not place the fleet');
    }

    function emptyMarks() {
        return MARK.UNKNOWN.repeat(CELL_COUNT);
    }

    function isValidMarks(marks) {
        return typeof marks === 'string' && MARKS_PATTERN.test(marks);
    }

    function isShootable(marks, index) {
        return isValidMarks(marks) && isIndex(index) && marks[index] === MARK.UNKNOWN;
    }

    /**
     * Resolves one shot at a validated fleet.
     * A hit also clears its diagonal neighbours (ships are straight and never
     * touch); a sinking clears the whole outline of the ship.
     * @returns {{ result: 'miss'|'hit'|'sunk', marks: string, ship: Object|null, allSunk: boolean }}
     */
    function resolveShot(ships, marks, index) {
        if (!isValidMarks(marks)) throw rulesError('BAD_MARKS', 'The board marks are invalid');
        if (!isIndex(index)) throw rulesError('BAD_CELL', 'The cell is outside the board');
        if (marks[index] !== MARK.UNKNOWN) throw rulesError('CELL_TAKEN', 'The cell was already shot');
        const cells = marks.split('');
        const target = (Array.isArray(ships) ? ships : []).find(ship => shipCells(ship).includes(index));
        if (!target) {
            cells[index] = MARK.MISS;
            return { result: 'miss', marks: cells.join(''), ship: null, allSunk: false };
        }
        cells[index] = MARK.HIT;
        for (const next of neighbors(index, { diagonalOnly: true })) {
            if (cells[next] === MARK.UNKNOWN) cells[next] = MARK.CLEAR;
        }
        const own = shipCells(target);
        if (!own.every(cell => cells[cell] === MARK.HIT || cells[cell] === MARK.SUNK)) {
            return { result: 'hit', marks: cells.join(''), ship: null, allSunk: false };
        }
        for (const cell of own) cells[cell] = MARK.SUNK;
        for (const cell of shipHalo(target)) {
            if (cells[cell] === MARK.UNKNOWN) cells[cell] = MARK.CLEAR;
        }
        const allSunk = ships.every(ship => shipCells(ship).every(cell => cells[cell] === MARK.SUNK));
        return { result: 'sunk', marks: cells.join(''), ship: { ...target }, allSunk };
    }

    /** Ship lengths still afloat, largest first, given the ships already sunk. */
    function remainingFleet(sunkShips) {
        const left = [...FLEET];
        for (const ship of Array.isArray(sunkShips) ? sunkShips : []) {
            const position = left.indexOf(Number(ship?.length));
            if (position !== -1) left.splice(position, 1);
        }
        return left;
    }

    function countMarks(marks, mark) {
        if (typeof marks !== 'string') return 0;
        let count = 0;
        for (const value of marks) if (value === mark) count += 1;
        return count;
    }

    function columnLabels(locale) {
        return COLUMN_LABELS[locale] || COLUMN_LABELS.en;
    }

    /** "Д5" in Russian, "E5" in English. */
    function cellName(index, locale) {
        if (!isIndex(index)) return '';
        const { x, y } = toPoint(index);
        return `${columnLabels(locale)[x]}${y + 1}`;
    }

    return Object.freeze({
        SIZE,
        CELL_COUNT,
        FLEET,
        FLEET_CELL_COUNT,
        MAX_SHIP_LENGTH,
        MARK,
        isIndex,
        inBounds,
        toIndex,
        toPoint,
        shipBox,
        shipFits,
        normalizeShip,
        shipCells,
        neighbors,
        shipHalo,
        shipsConflict,
        canPlace,
        compareShips,
        validateFleet,
        randomFleet,
        emptyMarks,
        isValidMarks,
        isShootable,
        resolveShot,
        remainingFleet,
        countMarks,
        columnLabels,
        cellName
    });
}));
