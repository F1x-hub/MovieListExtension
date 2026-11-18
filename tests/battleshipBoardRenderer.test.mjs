import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Rules = require('../src/shared/games/battleship/BattleshipRules.js');
const { JSDOM, VirtualConsole } = require('jsdom');
const {
    BattleshipBoardRenderer,
    cellAtWorld,
    cellCenter,
    shipFromCells,
    shipKey,
    shipPose,
    waveHeight,
    waveSlope
} = await import('../src/shared/games/battleship/BattleshipBoardRenderer.js');
const { SHIP_DECK, SHIP_LENGTH, SHIP_PARTS, createShipModels, mergeGeometries } = await import('../src/shared/games/battleship/BattleshipShipModels.js');
const { BoxGeometry } = await import('../libs/three.games.min.js');

// --- Board space ------------------------------------------------------------------
for (let index = 0; index < Rules.CELL_COUNT; index += 1) {
    const { x, z } = cellCenter(index);
    assert.equal(cellAtWorld(x, z), index, `cell ${index} maps back to itself`);
    assert.equal(cellAtWorld(x + 0.49, z - 0.49), index, 'a point inside the cell picks it');
}
assert.deepEqual(cellCenter(0), { x: -4.5, z: -4.5 }, 'A1 is at the far left corner');
assert.deepEqual(cellCenter(99), { x: 4.5, z: 4.5 }, 'K10 is at the near right corner');
assert.equal(cellAtWorld(-5.01, 0), null, 'left of the board is no cell');
assert.equal(cellAtWorld(0, 5.01), null, 'below the board is no cell');
assert.equal(cellAtWorld(Number.NaN, 0), null);

// --- Ships --------------------------------------------------------------------------
let seed = 5;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let round = 0; round < 20; round += 1) {
    for (const ship of Rules.randomFleet(random)) {
        const cells = Rules.shipCells(ship);
        assert.deepEqual(shipFromCells(cells), Rules.normalizeShip(ship), 'a preview turns back into its ship');
        assert.deepEqual(shipFromCells([...cells].reverse()), Rules.normalizeShip(ship), 'cell order does not matter');
        const pose = shipPose(ship);
        const centres = cells.map(index => cellCenter(index));
        const mean = axis => centres.reduce((sum, centre) => sum + centre[axis], 0) / centres.length;
        assert.ok(Math.abs(pose.x - mean('x')) < 1e-9 && Math.abs(pose.z - mean('z')) < 1e-9, 'a ship stands over the middle of its cells');
        assert.equal(pose.rotationY, ship.vertical ? Math.PI / 2 : 0);
        // The model's bow (+x) turned by rotationY points where `bow` says.
        assert.ok(Math.abs(Math.cos(pose.rotationY) - pose.bow.x) < 1e-9 && Math.abs(-Math.sin(pose.rotationY) - pose.bow.z) < 1e-9);
    }
}
assert.equal(shipFromCells([]), null);
assert.equal(shipKey({ x: 2, y: 3, length: 3, vertical: true }), '2,3,3,v');

// --- Swell ------------------------------------------------------------------------
// The ships ride waveHeight and the water shades with waveSlope: they must agree.
const step = 1e-5;
for (const [x, z, t] of [[0, 0, 0], [-3.2, 4.1, 1.7], [4.4, -2.5, 12.3], [1.1, 1.9, 100.5]]) {
    const slope = waveSlope(x, z, t);
    const dx = (waveHeight(x + step, z, t) - waveHeight(x - step, z, t)) / (2 * step);
    const dz = (waveHeight(x, z + step, t) - waveHeight(x, z - step, t)) / (2 * step);
    assert.ok(Math.abs(slope.x - dx) < 1e-6, `d/dx at ${x},${z},${t}`);
    assert.ok(Math.abs(slope.z - dz) < 1e-6, `d/dz at ${x},${z},${t}`);
    assert.ok(Math.abs(waveHeight(x, z, t)) <= 1.27 + 1e-9, 'the swell stays within its amplitude');
}

// --- Models -------------------------------------------------------------------------
const models = createShipModels();
for (const length of [1, 2, 3, 4]) {
    const model = models[length];
    for (const part of SHIP_PARTS) {
        const geometry = model[part];
        const count = geometry.attributes.position.count;
        assert.ok(count > 0, `${length}: ${part} has vertices`);
        assert.equal(geometry.attributes.normal.count, count, `${length}: ${part} normals`);
        assert.equal(geometry.attributes.uv.count, count, `${length}: ${part} uvs`);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        assert.ok(box.min.x >= -length / 2 && box.max.x <= length / 2, `${length}: ${part} stays inside its ${length} cells`);
        assert.ok(box.min.z >= -0.32 && box.max.z <= 0.32, `${length}: ${part} stays inside the cell's width`);
    }
    const hull = model.hull.boundingBox;
    assert.ok(hull.min.y < 0 && hull.max.y > 0, `${length}: the hull crosses the waterline`);
    assert.ok(Math.abs(hull.max.y - SHIP_DECK[length]) < 1e-6, `${length}: the deck is on top of the hull`);
    // The bevel reaches a little past the sharp bow.
    assert.ok(Math.abs(hull.max.x - hull.min.x - SHIP_LENGTH[length]) < 0.01, `${length}: the hull has its length`);
    assert.ok(model.structure.boundingBox.min.y >= SHIP_DECK[length] - 0.02, `${length}: the superstructure stands on the deck`);
}
const merged = mergeGeometries([new BoxGeometry(1, 1, 1), new BoxGeometry(2, 1, 1)]);
assert.equal(merged.attributes.position.count, 72, 'two boxes become 72 corners');
assert.equal(merged.index, null);

// --- Without WebGL ----------------------------------------------------------------
assert.equal(BattleshipBoardRenderer.isSupported(), false, 'Node has no WebGL');

// A browser without WebGL gets the inner grid as a flat board with the same interface.
// jsdom has no canvas; its "not implemented" notes and three.js's context error are expected.
const dom = new JSDOM('<!doctype html><div id="host"></div>', { pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Element: dom.window.Element });
const host = dom.window.document.getElementById('host');
const activated = [];
const { warn, error } = console;
console.warn = () => {};
console.error = () => {};
let board;
try {
    board = new BattleshipBoardRenderer(host, {
        rules: Rules,
        columns: Rules.columnLabels('ru'),
        side: 'enemy',
        label: 'Флот соперника',
        describeCell: (index, info) => `${Rules.cellName(index, 'ru')}: ${info.mark}`,
        onActivate: index => activated.push(index)
    });
} finally {
    console.warn = warn;
    console.error = error;
}
const container = host.querySelector('.bs-board3d');
assert.ok(board.flat, 'the board falls back to flat without WebGL');
assert.ok(container.classList.contains('is-flat'));
assert.equal(host.querySelector('canvas'), null, 'no canvas is left behind');
assert.equal(host.querySelectorAll('.bs-cell').length, 100, 'the grid is there');
const marks = Rules.emptyMarks().split('');
marks[0] = 'o';
marks[1] = 'x';
board.update({ marks: marks.join(''), ships: [], interactive: true, canTarget: index => marks[index] === '.', revealed: true });
assert.equal(host.querySelector('.bs-cell[data-index="0"]').dataset.mark, 'miss');
assert.equal(host.querySelector('.bs-cell[data-index="1"]').dataset.mark, 'hit');
assert.ok(board.grid.classList.contains('is-revealed'), 'the revealed state reaches the grid');
host.querySelector('.bs-cell[data-index="5"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.deepEqual(activated, [5], 'the flat board still takes clicks');
board.setActiveIndex(7);
assert.equal(board.activeIndex, 7);
assert.equal(host.querySelector('.bs-cell[data-index="7"]').tabIndex, 0, 'the roving tab stop follows');
board.destroy();
assert.equal(host.children.length, 0, 'destroy empties the host');

console.log('✅ Battleship 3D board tests passed');
