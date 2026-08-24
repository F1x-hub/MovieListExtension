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
game.start();
game.container.querySelector('[data-move="R"]').click();
assert.equal(game.moves, 1);
const frontFace = game.container.querySelector('[data-face="F"]');
frontFace.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
assert.equal(game.selectedFace, 'F');
assert.equal(game.selectedAxis, 'horizontal');
assert.equal(game.container.querySelectorAll('[data-face-move="F"]').length, 2);
assert.equal(game.container.querySelectorAll('[data-arrow="left"], [data-arrow="right"]').length, 2);
game.container.querySelector('[data-axis="vertical"]').click();
assert.equal(game.selectedAxis, 'vertical');
assert.equal(game.container.querySelectorAll('[data-face-move="F"]').length, 2);
assert.equal(game.container.querySelectorAll('[data-arrow="up"], [data-arrow="down"]').length, 2);
game.container.querySelector('[data-face-move="F"][data-arrow="down"]').click();
assert.equal(game.moves, 2, 'A face arrow should make a cube move');
assert.equal(game.selectedFace, 'F', 'The moved face should stay selected');
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

console.log('✅ Rubik cube state tests passed!');
