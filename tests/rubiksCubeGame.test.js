import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
    RubiksCubeGame,
    RubiksCubeState,
    averageOf,
    formatRubiksTime
} from '../src/shared/games/RubiksCubeGame.js';
import {
    generateScramble,
    invertMove,
    moveFromLayerTurn,
    parseMove,
    tokenizeAlgorithm
} from '../src/shared/games/RubiksCubeModel.js';

const faces = cube => ['U', 'R', 'F', 'D', 'L', 'B'].map(face => cube.getFace(face).flat().join()).join('|');

// --- Model ---------------------------------------------------------------------
const solved = new RubiksCubeState();
assert.equal(solved.isSolved(), true, 'A fresh cube must be solved');
assert.equal(formatRubiksTime(0), '0:00');
assert.equal(formatRubiksTime(75.9), '1:15');
assert.equal(formatRubiksTime(75.9, { precise: true }), '1:15.90');
assert.equal(averageOf([10, 11, 12, 13], 5), null, 'Ao5 needs five solves');
assert.equal(averageOf([20, 10, 11, 12, 1], 5), 11, 'Ao5 drops the best and the worst');

for (const token of ['U', 'R', 'F', 'D', 'L', 'B', 'M', 'E', 'S', 'r', 'u', 'f', 'Rw']) {
    const cube = new RubiksCubeState();
    cube.applyMove(token);
    assert.equal(cube.isSolved(), false, `${token} must change the cube`);
    cube.applyMove(invertMove(token));
    assert.equal(cube.isSolved(), true, `${token} followed by its inverse must solve the cube`);
    const four = new RubiksCubeState();
    for (let i = 0; i < 4; i++) four.applyMove(token);
    assert.equal(four.isSolved(), true, `${token} four times is the identity`);
}

for (const token of ['x', 'y', 'z', "x'", 'y2']) {
    const cube = new RubiksCubeState();
    cube.applyMove(token);
    assert.equal(cube.isSolved(), true, `rotation ${token} keeps a solved cube solved`);
    assert.notEqual(faces(cube), faces(new RubiksCubeState()), `rotation ${token} reorients the cube`);
}

// Known identities tie slices and wide moves to the outer faces.
const identity = (a, b, message) => {
    const left = new RubiksCubeState();
    left.applyAlgorithm(a);
    const right = new RubiksCubeState();
    right.applyAlgorithm(b);
    assert.equal(faces(left), faces(right), message);
};
identity('r', "R M'", 'r = R M\'');
identity('x', "R M' L'", 'x = R M\' L\'');
identity('y', "U E' D'", 'y = U E\' D\'');
identity('z', "F S B'", 'z = F S B\'');
identity('Rw', 'r', 'Rw is r');

// The sexy move has order 6.
const sexy = new RubiksCubeState();
for (let i = 0; i < 6; i++) sexy.applyAlgorithm("R U R' U'");
assert.equal(sexy.isSolved(), true, "(R U R' U') x6 returns to solved");

// The R face turn moves F's right column to U (clockwise seen from R).
const rTurn = new RubiksCubeState();
rTurn.applyMove('R');
assert.deepEqual(rTurn.getFace('U').map(row => row[2]), ['green', 'green', 'green']);

assert.equal(parseMove('R2').quarterTurns, 2);
assert.equal(parseMove("F'").direction, 1);
assert.equal(parseMove("R2'").quarterTurns, 2);
assert.equal(parseMove('Q'), null);
assert.equal(parseMove('Mw'), null, 'slices have no wide form');
assert.deepEqual(tokenizeAlgorithm("(R U R' U') M2 x r"), ['R', 'U', "R'", "U'", 'M2', 'x', 'Rw']);
assert.deepEqual(tokenizeAlgorithm("RUR'"), ['R', 'U', "R'"]);
assert.equal(tokenizeAlgorithm('R Q'), null);

// Drag-to-turn maps a physical layer rotation back to notation. Layers use the
// model's doubled coordinates (a 3×3 runs -2, 0, 2).
assert.equal(moveFromLayerTurn([1, 0, 0], 2, -1), 'R');
assert.equal(moveFromLayerTurn([1, 0, 0], 2, 1), "R'");
assert.equal(moveFromLayerTurn([1, 0, 0], -2, 1), 'L', 'L turns opposite to R about +x');
assert.equal(moveFromLayerTurn([-1, 0, 0], 2, -1), 'L', 'a negative axis is read from the other side');
assert.equal(moveFromLayerTurn([1, 0, 0], 0, 1), 'M');
assert.equal(moveFromLayerTurn([0, 1, 0], 0, 2), 'E2');
assert.equal(moveFromLayerTurn([0, 0, 1], 0, -1), 'S');
assert.equal(moveFromLayerTurn([0, 0, 1], 2, 4), null, 'a full turn is no move');
assert.equal(moveFromLayerTurn([1, 0, 0], 1, -1, 4), '2R', 'inner layers of big cubes use SiGN numbers');
assert.equal(moveFromLayerTurn([0, 1, 0], -1, 1, 4), '2D', 'a +90° turn about +y is a plain D-side turn');

// Every cube size: each layer drag round-trips through notation, and a scramble
// followed by its inverse is solved again.
let seed = 7;
const seeded = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const size of [2, 3, 4, 5, 6, 7]) {
    const coordinates = Array.from({ length: size }, (_, index) => 2 * index - (size - 1));
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        for (const layer of coordinates) {
            for (const turns of [-1, 1, 2]) {
                const move = moveFromLayerTurn(axis, layer, turns, size);
                assert.ok(parseMove(move, size), `${move} parses on ${size}×${size}`);
                const viaMove = new RubiksCubeState(size);
                viaMove.applyMove(move);
                const direct = new RubiksCubeState(size);
                direct.applyMove({ axis, layers: [layer], quarterTurns: ((turns % 4) + 4) % 4, direction: 1 });
                assert.equal(faces(viaMove), faces(direct), `${move} matches the dragged layer on ${size}×${size}`);
            }
        }
    }
    const scramble = generateScramble(size, undefined, seeded);
    const cube = new RubiksCubeState(size);
    scramble.forEach(move => assert.ok(cube.applyMove(move), `${move} is valid on ${size}×${size}`));
    assert.equal(cube.isSolved(), false, `${size}×${size} scramble mixes the cube`);
    scramble.slice().reverse().forEach(move => cube.applyMove(invertMove(move, size)));
    assert.equal(cube.isSolved(), true, `${size}×${size} inverse scramble solves it`);
    assert.equal(cube.getFace('F').length, size);
}
assert.equal(generateScramble(2, undefined, seeded).length, 11, 'a 2×2 gets an 11-move scramble');
assert.equal(generateScramble(4, undefined, seeded).some(move => move.includes('w')), true, 'big cubes get wide turns');
assert.equal(parseMove('M', 4), null, 'even cubes have no middle slice');
assert.equal(parseMove('Rw', 2), null, 'a 2×2 has no wide turns');
assert.equal(parseMove('3Rw', 6).layers.length, 3);
assert.equal(parseMove('2R', 3).layers[0], 0, '2R on a 3×3 is the middle layer');
// On a 4×4, Rw equals R plus the inner 2R.
const wide = new RubiksCubeState(4);
wide.applyMove('Rw');
const split = new RubiksCubeState(4);
split.applyAlgorithm('R 2R');
assert.equal(faces(wide), faces(split), 'Rw = R 2R on a 4×4');

// Scrambles never repeat a face and never put three moves on one axis.
const faceOf = move => move.match(/[URFDLB]/)[0];
const axisOf = move => ({ U: 1, D: 1, R: 0, L: 0, F: 2, B: 2 })[faceOf(move)];
for (let run = 0; run < 200; run++) {
    const scramble = generateScramble(run % 2 ? 3 : 5, 20, seeded);
    assert.equal(scramble.length, 20);
    scramble.forEach((move, i) => {
        if (i > 0) assert.notEqual(faceOf(move), faceOf(scramble[i - 1]), `no repeated face in ${scramble.join(' ')}`);
        if (i > 1) {
            assert.equal(axisOf(move) === axisOf(scramble[i - 1]) && axisOf(move) === axisOf(scramble[i - 2]),
                false, `no three moves on one axis in ${scramble.join(' ')}`);
        }
    });
}

// --- Game (flat view, no WebGL) ------------------------------------------------
const dom = new JSDOM('<div id="rubiks"></div>');
globalThis.document = dom.window.document;
const game = new RubiksCubeGame({
    container: dom.window.document.getElementById('rubiks'),
    callbacks: { onStatsUpdate: () => {} },
    audio: { rotate: () => {} },
    random: seeded,
    size: 3,
    webgl: false
});
const query = selector => game.container.querySelector(selector);
assert.equal(game.container.querySelectorAll('.rubiks-net-face').length, 6, 'the flat net shows six faces');
assert.equal(game.container.querySelectorAll('.rubiks-sticker').length, 54);
assert.equal(query('[data-rubiks-viewport]').getAttribute('tabindex'), '0');
assert.equal(game.container.querySelectorAll('[data-move]').length, 36, 'faces, slices and rotations each get three buttons');
assert.equal(game.choosingSize, false, 'a size given up front skips the picker');
assert.equal(query('[data-rubiks-picker]').hidden, true);
assert.equal(game.scramble.length, 20, 'the 3×3 keeps the classic 20-move scramble');
assert.ok(query('[aria-label="красный"], [aria-label="зелёный"], [aria-label="белый"]'), 'sticker labels use localized colour names');
game.start();
assert.equal(game.timerId, null, 'the timer waits for the first move');
query('[data-move="x"]').click();
assert.equal(game.moves, 0, 'cube rotations are free');
assert.equal(game.timerId, null, 'a cube rotation does not start the timer');
query('[data-move="R"]').click();
assert.equal(game.moves, 1);
assert.notEqual(game.timerId, null, 'the first real move starts the timer');
const viewportBefore = query('[data-rubiks-viewport]');
query('[data-move="M2"]').click();
assert.equal(query('[data-rubiks-viewport]'), viewportBefore, 'moves never rebuild the viewport');
assert.deepEqual(game.history, ['x', 'R', 'M2']);
game.stop();

// Undo, reset, re-scramble, algorithms and solving.
const actionDom = new JSDOM('<div id="rubiks"></div>');
globalThis.document = actionDom.window.document;
let solvedPayload = null;
const actionGame = new RubiksCubeGame({
    container: actionDom.window.document.getElementById('rubiks'),
    callbacks: { onStatsUpdate: () => {}, onSolved: payload => { solvedPayload = payload; } },
    audio: { rotate: () => {} },
    webgl: false
});
// Without a size the game opens on the picker and ignores moves until one is chosen.
assert.equal(actionGame.choosingSize, true);
assert.equal(actionGame.container.querySelector('[data-rubiks-picker]').hidden, false);
assert.equal(actionGame.container.querySelectorAll('[data-size]').length, 6, 'sizes 2×2 to 7×7 are offered');
actionGame.turn('R');
assert.deepEqual(actionGame.history, [], 'no moves before a size is chosen');
actionGame.container.querySelector('[data-size="2"]').click();
assert.equal(actionGame.size, 2);
assert.equal(actionGame.choosingSize, false);
assert.equal(actionGame.container.querySelector('[data-rubiks-picker]').hidden, true);
assert.equal(actionGame.container.querySelectorAll('.rubiks-sticker').length, 24, 'a 2×2 net has 24 stickers');
assert.equal(actionGame.scramble.length, 11);
assert.equal(actionGame.container.querySelector('[data-move="M"]'), null, 'a 2×2 has no slice buttons');
assert.equal(actionGame.bestTimeKey, 'rubiksCubeBestTime:2x2', 'each size keeps its own record');
actionGame.container.querySelector('[data-rubiks-action="size"]').click();
assert.equal(actionGame.choosingSize, true, 'the size button reopens the picker');
actionGame.container.querySelector('[data-size="3"]').click();
assert.equal(actionGame.bestTimeKey, 'rubiksCubeBestTime', 'the 3×3 keeps the original best-time key');
actionGame.start();
const initialState = faces(actionGame.state);
const undoButton = () => actionGame.container.querySelector('[data-rubiks-action="undo"]');
assert.equal(undoButton().disabled, true, 'undo starts disabled');
actionGame.container.querySelector('[data-move="R"]').click();
actionGame.container.querySelector('[data-move="U\'"]').click();
assert.deepEqual(actionGame.history, ['R', "U'"]);
undoButton().click();
assert.equal(actionGame.moves, 1);
actionGame.undo();
assert.equal(faces(actionGame.state), initialState, 'undoing every move returns to the scramble');
assert.equal(undoButton().disabled, true);

actionGame.turn('F2');
actionGame.turn('L');
actionGame.container.querySelector('[data-rubiks-action="reset"]').click();
assert.equal(faces(actionGame.state), initialState, 'reset returns to the same scramble');
assert.equal(actionGame.moves, 0);

assert.equal(actionGame.playAlgorithm('R Q'), false, 'invalid algorithms are rejected');
// Undoing the scramble through the algorithm field solves the cube.
const solution = actionGame.scramble.slice().reverse().map(move => invertMove(move)).join(' ');
assert.equal(actionGame.playAlgorithm(solution), true);
assert.equal(actionGame.finished, true, 'playing the inverse scramble solves the cube');
assert.equal(solvedPayload.moves, actionGame.scramble.length);
assert.equal(actionGame.solves.length, 1, 'the solve is recorded in the session');
assert.match(actionGame.container.querySelector('[data-rubiks-session]').textContent, /1/);

const previousScramble = actionGame.scramble.join(' ');
actionGame.container.querySelector('[data-rubiks-action="scramble"]').click();
assert.notEqual(actionGame.scramble.join(' '), previousScramble);
assert.equal(actionGame.state.isSolved(), false);
assert.equal(actionGame.finished, false);

actionGame.container.querySelector('[data-rubiks-action="size"]').click();
actionGame.container.querySelector('[data-size="4"]').click();
assert.equal(actionGame.scramble.length, 40, 'a 4×4 gets a 40-move scramble');
assert.ok(actionGame.container.querySelector('[data-move="Rw"]'), 'big cubes offer wide-turn buttons');
assert.equal(actionGame.container.querySelector('[data-size="4"]').getAttribute('aria-pressed'), 'true');
assert.equal(actionGame.playAlgorithm('M'), false, 'slices are rejected on even cubes');
assert.equal(actionGame.playAlgorithm('2R'), true, 'inner layers can be played on a 4×4');

// The drawer and focus survive moves because the layout is updated in place.
const drawer = actionGame.container.querySelector('.rubiks-controls-drawer');
drawer.open = true;
drawer.dispatchEvent(new actionDom.window.Event('toggle'));
const moveButton = actionGame.container.querySelector('[data-move="D"]');
moveButton.focus();
moveButton.click();
assert.equal(actionGame.container.querySelector('.rubiks-controls-drawer').open, true);
assert.equal(actionDom.window.document.activeElement, moveButton);
actionGame.stop();

// The vendored three.js subset exports everything the renderer imports.
const rendererSource = readFileSync(new URL('../src/shared/games/RubiksCubeRenderer.js', import.meta.url), 'utf8');
const imported = rendererSource.match(/import \{([^}]+)\} from '[^']*three\.rubiks\.min\.js'/)[1]
    .split(',').map(name => name.trim()).filter(Boolean);
const three = await import('../libs/three.rubiks.min.js');
imported.forEach(name => assert.ok(three[name], `libs/three.rubiks.min.js exports ${name}`));

console.log('✅ Rubik cube state tests passed!');
