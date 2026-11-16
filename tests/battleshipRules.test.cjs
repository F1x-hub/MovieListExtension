const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_COPY = path.join(ROOT, 'src/shared/games/battleship/BattleshipRules.js');
const SERVER_COPY = path.join(ROOT, 'functions/battleshipRules.js');

// The Cloud Function cannot import from src/, so it ships its own copy of the rules.
assert.equal(fs.readFileSync(SERVER_COPY, 'utf8'), fs.readFileSync(CLIENT_COPY, 'utf8'),
    'functions/battleshipRules.js must be an exact copy of src/shared/games/battleship/BattleshipRules.js');

const Rules = require(CLIENT_COPY);

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

// A fixed fleet used across the shot tests (top-left anchors):
//  4-deck A1–D1, 3-deck A3–A5 (vertical), 3-deck F3–H3, 2-deck J1–J2 (vertical),
//  2-deck C7–D7, 2-deck J5–J6, 1-deck F1, 1-deck F6, 1-deck A10, 1-deck J10.
const FLEET = [
    { x: 0, y: 0, length: 4, vertical: false },
    { x: 0, y: 2, length: 3, vertical: true },
    { x: 5, y: 2, length: 3, vertical: false },
    { x: 9, y: 0, length: 2, vertical: true },
    { x: 2, y: 6, length: 2, vertical: false },
    { x: 9, y: 4, length: 2, vertical: true },
    { x: 5, y: 0, length: 1 },
    { x: 5, y: 5, length: 1 },
    { x: 0, y: 9, length: 1 },
    { x: 9, y: 9, length: 1 }
];

// --- Geometry -------------------------------------------------------------
assert.equal(Rules.SIZE, 10);
assert.equal(Rules.CELL_COUNT, 100);
assert.deepEqual([...Rules.FLEET], [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]);
assert.equal(Rules.FLEET_CELL_COUNT, 20);
assert.equal(Rules.toIndex(3, 4), 43);
assert.deepEqual(Rules.toPoint(43), { x: 3, y: 4 });
assert.deepEqual(Rules.shipCells({ x: 2, y: 3, length: 3, vertical: true }), [32, 42, 52]);
assert.deepEqual(Rules.shipCells({ x: 2, y: 3, length: 3, vertical: false }), [32, 33, 34]);
assert.deepEqual(Rules.neighbors(0).sort((a, b) => a - b), [1, 10, 11]);
assert.deepEqual(Rules.neighbors(11, { diagonalOnly: true }).sort((a, b) => a - b), [0, 2, 20, 22]);
assert.deepEqual(Rules.shipHalo({ x: 0, y: 0, length: 2, vertical: false }), [2, 10, 11, 12]);

assert.deepEqual(Rules.normalizeShip({ x: 4, y: 4, length: 1, vertical: true }), { x: 4, y: 4, length: 1, vertical: false },
    'a one-deck ship has a single canonical form');
assert.equal(Rules.normalizeShip({ x: 7, y: 0, length: 4, vertical: false }), null, 'a ship may not leave the board');
assert.equal(Rules.normalizeShip({ x: 0, y: 7, length: 4, vertical: true }), null);
assert.equal(Rules.normalizeShip({ x: 0, y: 0, length: 5 }), null, 'no ship is longer than four decks');
assert.equal(Rules.normalizeShip({ x: 0.5, y: 0, length: 1 }), null);
assert.equal(Rules.normalizeShip({ x: '1', y: 0, length: 1 }), null);
assert.equal(Rules.normalizeShip({ x: 1, y: 0, length: 2, vertical: 'yes' }), null);
assert.equal(Rules.normalizeShip(null), null);

assert.equal(Rules.shipsConflict({ x: 0, y: 0, length: 2 }, { x: 3, y: 0, length: 1 }), false);
assert.equal(Rules.shipsConflict({ x: 0, y: 0, length: 2 }, { x: 2, y: 0, length: 1 }), true, 'side contact is a conflict');
assert.equal(Rules.shipsConflict({ x: 0, y: 0, length: 2 }, { x: 2, y: 1, length: 1 }), true, 'corner contact is a conflict');
assert.equal(Rules.shipsConflict({ x: 0, y: 0, length: 2 }, { x: 2, y: 2, length: 1 }), false);
assert.equal(Rules.canPlace(FLEET, { x: 3, y: 4, length: 1 }), true, 'D5 keeps a cell away from every ship');
assert.equal(Rules.canPlace(FLEET, { x: 4, y: 4, length: 1 }), false, 'E5 touches the one-deck at F6 by a corner');
assert.equal(Rules.canPlace(FLEET, { x: 5, y: 5, length: 1 }, 7), true, 'a ship being moved does not block itself');
assert.equal(Rules.canPlace([], { x: 8, y: 0, length: 4 }), false, 'a ship that leaves the board is never placeable');

// --- Fleet validation --------------------------------------------------------
const valid = Rules.validateFleet(FLEET);
assert.equal(valid.ok, true, JSON.stringify(valid));
assert.equal(valid.ships.length, 10);
assert.deepEqual(valid.ships.map(ship => ship.length), [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]);
assert.equal(Rules.validateFleet(FLEET.slice(0, 9)).code, 'FLEET_SIZE');
assert.equal(Rules.validateFleet('ships').code, 'FLEET_SIZE');
assert.equal(Rules.validateFleet([...FLEET.slice(0, 9), { x: 9, y: 9, length: 2 }]).code, 'SHIP_INVALID');
assert.equal(Rules.validateFleet([...FLEET.slice(0, 9), { x: 7, y: 9, length: 2 }]).code, 'FLEET_COMPOSITION');
assert.equal(Rules.validateFleet([...FLEET.slice(0, 9), { x: 1, y: 9, length: 1 }]).code, 'SHIPS_TOUCH');
assert.equal(Rules.validateFleet([...FLEET.slice(0, 9), { x: 7, y: 9, length: 1 }]).ok, true, 'the last one-deck may move to H10');
assert.equal(Rules.validateFleet([...FLEET.slice(0, 9), { x: 0, y: 9, length: 1 }]).code, 'SHIPS_TOUCH', 'two ships in one cell overlap');

// --- Random fleets are always legal ----------------------------------------------
for (let seed = 1; seed <= 400; seed += 1) {
    const ships = Rules.randomFleet(seededRandom(seed));
    const check = Rules.validateFleet(ships);
    assert.equal(check.ok, true, `seed ${seed}: ${check.code}`);
}
assert.equal(Rules.validateFleet(Rules.randomFleet(() => 0.999999)).ok, true, 'the top of the random range stays on the board');
assert.equal(Rules.validateFleet(Rules.randomFleet(() => 0)).ok, true);
assert.notDeepEqual(Rules.randomFleet(seededRandom(7)), Rules.randomFleet(seededRandom(8)), 'different seeds give different fleets');

// --- Shots -------------------------------------------------------------------
const ships = valid.ships;
let marks = Rules.emptyMarks();
assert.equal(marks.length, 100);
assert.equal(Rules.isValidMarks(marks), true);
assert.equal(Rules.isValidMarks('.'.repeat(99)), false);
assert.equal(Rules.isValidMarks(`${'.'.repeat(99)}z`), false);

let shot = Rules.resolveShot(ships, marks, Rules.toIndex(4, 4));
assert.equal(shot.result, 'miss');
assert.equal(shot.marks[44], 'o');
assert.equal(shot.allSunk, false);
marks = shot.marks;
assert.throws(() => Rules.resolveShot(ships, marks, 44), error => error.code === 'CELL_TAKEN');
assert.throws(() => Rules.resolveShot(ships, marks, 100), error => error.code === 'BAD_CELL');
assert.throws(() => Rules.resolveShot(ships, 'bad', 1), error => error.code === 'BAD_MARKS');

// Hit the 4-deck at B1: diagonals of the hit become known-empty.
shot = Rules.resolveShot(ships, marks, Rules.toIndex(1, 0));
assert.equal(shot.result, 'hit');
assert.equal(shot.ship, null);
assert.equal(shot.marks[1], 'x');
assert.equal(shot.marks[10], '*');
assert.equal(shot.marks[12], '*');
assert.equal(shot.marks[0], '.', 'a hit does not reveal the cells along the ship');
marks = shot.marks;
assert.equal(Rules.isShootable(marks, 10), false, 'known-empty cells are not targets');
for (const x of [0, 2]) {
    shot = Rules.resolveShot(ships, marks, Rules.toIndex(x, 0));
    assert.equal(shot.result, 'hit');
    marks = shot.marks;
}
shot = Rules.resolveShot(ships, marks, Rules.toIndex(3, 0));
assert.equal(shot.result, 'sunk');
assert.deepEqual(shot.ship, { x: 0, y: 0, length: 4, vertical: false });
assert.equal(shot.marks.slice(0, 4), '####');
assert.equal(shot.marks[4], '*', 'the outline of a sunk ship is known-empty');
assert.equal(shot.marks[14], '*');
assert.equal(shot.allSunk, false);
marks = shot.marks;

// Sink everything else: the last shot reports allSunk.
const remainingCells = ships.slice(1).flatMap(ship => Rules.shipCells(ship));
remainingCells.forEach((cell, position) => {
    shot = Rules.resolveShot(ships, marks, cell);
    marks = shot.marks;
    assert.equal(shot.allSunk, position === remainingCells.length - 1);
});
assert.equal(Rules.countMarks(marks, '#'), 20);
assert.equal(Rules.countMarks(marks, 'x'), 0);

// --- Helpers -----------------------------------------------------------------
assert.deepEqual(Rules.remainingFleet([{ length: 4 }, { length: 1 }]), [3, 3, 2, 2, 2, 1, 1, 1]);
assert.deepEqual(Rules.remainingFleet(null), [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]);
assert.equal(Rules.cellName(Rules.toIndex(4, 4), 'ru'), 'Д5');
assert.equal(Rules.cellName(Rules.toIndex(9, 9), 'ru'), 'К10', 'Russian columns skip Й');
assert.equal(Rules.cellName(Rules.toIndex(9, 9), 'en'), 'J10');
assert.equal(Rules.cellName(Rules.toIndex(0, 0), 'de'), 'A1', 'other locales use Latin columns');
assert.equal(Rules.cellName(-1, 'ru'), '');

console.log('✅ Battleship rules tests passed');
