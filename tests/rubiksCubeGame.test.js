import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
    RubiksCubeGame,
    RubiksCubeState,
    formatRubiksTime
} from '../src/shared/games/RubiksCubeGame.js';

const inverse = move => move.endsWith('2') ? move : move.endsWith("'") ? move[0] : `${move[0]}'`;

const solved = new RubiksCubeState();
assert.equal(solved.isSolved(), true, 'A fresh cube must be solved');
assert.equal(formatRubiksTime(0), '0:00');
assert.equal(formatRubiksTime(75.9), '1:15');

for (const face of ['U', 'R', 'F', 'D', 'L', 'B']) {
    const cube = new RubiksCubeState();
    cube.applyMove(face);
    assert.equal(cube.isSolved(), false, `${face} must change the cube`);
    cube.applyMove(`${face}'`);
    assert.equal(cube.isSolved(), true, `${face} followed by its inverse must solve the cube`);
}

for (const face of ['U', 'R', 'F', 'D', 'L', 'B']) {
    const cube = new RubiksCubeState();
    cube.applyMove(`${face}2`);
    cube.applyMove(`${face}2`);
    assert.equal(cube.isSolved(), true, `${face}2 twice must solve the cube`);
}

const sequence = ['R', 'U', "F'", 'L2', 'D', "B'"];
const cube = new RubiksCubeState();
sequence.forEach(move => cube.applyMove(move));
assert.equal(cube.isSolved(), false, 'A mixed sequence must scramble the cube');
sequence.slice().reverse().map(inverse).forEach(move => cube.applyMove(move));
assert.equal(cube.isSolved(), true, 'A sequence followed by its inverse must solve the cube');

assert.equal(RubiksCubeState.parseMove('R2').quarterTurns, 2);
assert.equal(RubiksCubeState.parseMove("F'").direction, 1);
assert.equal(RubiksCubeState.parseMove('X'), null);

const dom = new JSDOM('<div id="rubiks"></div>');
let randomCalls = 0;
const game = new RubiksCubeGame({
    container: dom.window.document.getElementById('rubiks'),
    callbacks: { onStatsUpdate: () => {} },
    audio: { rotate: () => {} },
    random: () => {
        const call = randomCalls++;
        return call % 3 === 0 ? ((call / 3) % 2 === 0 ? 0 : 0.25) : 0.9;
    }
});
assert.equal(game.container.querySelectorAll('.rubiks-3d-face').length, 6);
assert.equal(game.container.querySelector('[data-rubiks-viewport]').getAttribute('tabindex'), '0');
assert.equal(game.container.querySelectorAll('[data-move]').length, 18);
assert.equal(game.difficulty, RubiksCubeGame.DEFAULT_DIFFICULTY, 'new players start on the default difficulty');
assert.equal(game.scramble.length, RubiksCubeGame.DIFFICULTIES[game.difficulty]);
assert.equal(game.container.querySelector('[aria-label="красный"], [aria-label="зелёный"], [aria-label="белый"]') !== null, true,
    'sticker labels use localized colour names');
game.start();
assert.equal(game.timerId, null, 'the timer waits for the first move');
game.container.querySelector('[data-move="R"]').click();
assert.equal(game.moves, 1);
assert.notEqual(game.timerId, null, 'the first move starts the timer');
const frontFace = game.container.querySelector('[data-face="F"]');
frontFace.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(game.selectedFace, 'F');
assert.equal(game.container.querySelectorAll('[data-face-move="F"]').length, 2);
assert.equal(game.container.querySelectorAll('[data-arrow="ccw"], [data-arrow="cw"]').length, 2,
    'a selected face offers counter-clockwise and clockwise turns');
assert.equal(game.container.querySelector('[data-axis]'), null, 'the no-op axis switch is gone');
const beforeCcw = game.state.getFace('U').flat().join();
game.container.querySelector('[data-face-move="F"][data-arrow="ccw"]').click();
assert.equal(game.moves, 2, 'A face arrow should make a cube move');
assert.deepEqual(game.history.slice(-1), ["F'"], 'the counter-clockwise arrow makes the inverse turn');
assert.notEqual(game.state.getFace('U').flat().join(), beforeCcw);
game.container.querySelector('[data-face-move="F"][data-arrow="cw"]').click();
assert.deepEqual(game.history.slice(-1), ['F'], 'the clockwise arrow makes the plain turn');
assert.equal(game.selectedFace, 'F', 'The moved face should stay selected');
assert.equal(game.getAdjacentStickers('U').length, 12, 'a face turn carries 12 side stickers');
game.history = ['R'];
game.moves = 1;
let viewport = game.container.querySelector('[data-rubiks-viewport]');
const rightFace = game.container.querySelector('[data-face="R"]');
const facePointerDown = new dom.window.Event('pointerdown', { bubbles: true });
Object.assign(facePointerDown, { pointerId: 8, clientX: 120, clientY: 120 });
rightFace.dispatchEvent(facePointerDown);
const facePointerUp = new dom.window.Event('pointerup', { bubbles: true });
Object.assign(facePointerUp, { pointerId: 8 });
viewport.dispatchEvent(facePointerUp);
assert.equal(game.selectedFace, 'R', 'A short press on a face should select it');
assert.equal(game.container.querySelectorAll('[data-face-move="R"]').length, 2);
viewport = game.container.querySelector('[data-rubiks-viewport]');
const pointerDown = new dom.window.Event('pointerdown', { bubbles: true });
Object.assign(pointerDown, { pointerId: 7, clientX: 100, clientY: 100 });
viewport.dispatchEvent(pointerDown);
const pointerMove = new dom.window.Event('pointermove', { bubbles: true });
Object.assign(pointerMove, { pointerId: 7, clientX: 140, clientY: 80 });
viewport.dispatchEvent(pointerMove);
assert.equal(game.rotation.y, -12, 'Dragging should rotate the cube horizontally');
assert.equal(game.rotation.x, -15, 'Dragging should rotate the cube vertically');
const pointerUp = new dom.window.Event('pointerup', { bubbles: true });
Object.assign(pointerUp, { pointerId: 7 });
viewport.dispatchEvent(pointerUp);
game.stop();

// Undo, reset and re-scramble restore earlier cube states.
const actionDom = new JSDOM('<div id="rubiks"></div>');
globalThis.document = actionDom.window.document;
const actionGame = new RubiksCubeGame({
    container: actionDom.window.document.getElementById('rubiks'),
    callbacks: { onStatsUpdate: () => {} },
    audio: { rotate: () => {} }
});
actionGame.start();
const scrambledFaces = () => ['U', 'R', 'F', 'D', 'L', 'B'].map(face => actionGame.state.getFace(face).flat().join()).join('|');
const initialState = scrambledFaces();
const undoButton = () => actionGame.container.querySelector('[data-rubiks-action="undo"]');
assert.equal(undoButton().disabled, true, 'undo starts disabled');

actionGame.container.querySelector('[data-move="R"]').click();
actionGame.container.querySelector('[data-move="U\'"]').click();
assert.equal(actionGame.moves, 2);
assert.deepEqual(actionGame.history, ['R', "U'"]);
undoButton().click();
assert.equal(actionGame.moves, 1, 'undo removes the last move from the counter');
assert.deepEqual(actionGame.history, ['R']);
actionGame.undo();
assert.equal(scrambledFaces(), initialState, 'undoing every move returns to the scramble');
assert.equal(undoButton().disabled, true, 'undo is disabled once the history is empty');

actionGame.turn('F2');
actionGame.turn('L');
actionGame.container.querySelector('[data-rubiks-action="reset"]').click();
assert.equal(scrambledFaces(), initialState, 'reset returns to the same scramble');
assert.equal(actionGame.moves, 0);
assert.deepEqual(actionGame.history, []);

const previousScramble = actionGame.scramble.join(' ');
actionGame.container.querySelector('[data-rubiks-action="scramble"]').click();
assert.equal(actionGame.scramble.length, RubiksCubeGame.DIFFICULTIES[actionGame.difficulty]);
assert.notEqual(actionGame.scramble.join(' '), previousScramble, 'a new scramble is generated');
assert.equal(actionGame.state.isSolved(), false);
assert.equal(actionGame.moves, 0);

// Difficulty buttons change the scramble length and start a fresh attempt.
actionGame.container.querySelector('[data-difficulty="hard"]').click();
assert.equal(actionGame.difficulty, 'hard');
assert.equal(actionGame.scramble.length, RubiksCubeGame.SCRAMBLE_LENGTH, 'hard keeps the classic 20-move scramble');
assert.equal(actionGame.bestTimeKey, 'rubiksCubeBestTime', 'hard keeps the original best-time key');
actionGame.container.querySelector('[data-difficulty="medium"]').click();
assert.equal(actionGame.scramble.length, RubiksCubeGame.DIFFICULTIES.medium);
assert.equal(actionGame.bestTimeKey, 'rubiksCubeBestTime:medium', 'each difficulty keeps its own record');
assert.equal(actionGame.container.querySelector('[data-difficulty="medium"]').getAttribute('aria-pressed'), 'true');

// Re-rendering after a move keeps the controls drawer open and the focus in place.
const drawer = actionGame.container.querySelector('.rubiks-controls-drawer');
drawer.open = true;
drawer.dispatchEvent(new actionDom.window.Event('toggle'));
const moveButton = actionGame.container.querySelector('[data-move="D"]');
moveButton.focus();
moveButton.click();
assert.equal(actionGame.container.querySelector('.rubiks-controls-drawer').open, true,
    'the drawer must stay open after a move');
assert.equal(actionDom.window.document.activeElement?.dataset.move, 'D',
    'focus must return to the pressed move button');
actionGame.stop();

console.log('✅ Rubik cube state tests passed!');
