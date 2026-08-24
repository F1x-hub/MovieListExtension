const FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
const MOVE_FACES = ['U', 'R', 'F', 'D', 'L', 'B'];

const FACE_DEFINITIONS = Object.freeze({
    U: { normal: [0, 1, 0], right: [1, 0, 0], down: [0, 0, 1], color: 'white' },
    R: { normal: [1, 0, 0], right: [0, 0, -1], down: [0, -1, 0], color: 'red' },
    F: { normal: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0], color: 'green' },
    D: { normal: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1], color: 'yellow' },
    L: { normal: [-1, 0, 0], right: [0, 0, 1], down: [0, -1, 0], color: 'orange' },
    B: { normal: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0], color: 'blue' }
});

const STORAGE_KEY = 'rubiksCubeBestTime';

function add(a, b) {
    return a.map((value, index) => value + b[index]);
}

function scale(vector, amount) {
    return vector.map(value => value * amount);
}

function dot(a, b) {
    return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

function rotateVector(vector, axis, direction) {
    const perpendicular = cross(axis, vector);
    return vector.map((value, index) => Math.round(
        axis[index] * dot(axis, vector) + direction * perpendicular[index]
    ));
}

function sameVector(a, b) {
    return a.every((value, index) => value === b[index]);
}

export function formatRubiksTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export class RubiksCubeState {
    constructor() {
        this.reset();
    }

    reset() {
        this.stickers = [];
        FACE_ORDER.forEach(face => {
            const definition = FACE_DEFINITIONS[face];
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 3; col++) {
                    const position = add(
                        definition.normal,
                        add(scale(definition.right, col - 1), scale(definition.down, row - 1))
                    );
                    this.stickers.push({
                        face,
                        color: definition.color,
                        normal: [...definition.normal],
                        position
                    });
                }
            }
        });
        return this;
    }

    applyMove(move) {
        const parsed = RubiksCubeState.parseMove(move);
        if (!parsed) return false;

        for (let turn = 0; turn < parsed.quarterTurns; turn++) {
            const axis = FACE_DEFINITIONS[parsed.face].normal;
            this.stickers.forEach(sticker => {
                if (dot(sticker.position, axis) !== 1) return;
                sticker.position = rotateVector(sticker.position, axis, parsed.direction);
                sticker.normal = rotateVector(sticker.normal, axis, parsed.direction);
            });
        }
        return true;
    }

    getFace(face) {
        const definition = FACE_DEFINITIONS[face];
        if (!definition) return [];

        return Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, col) => {
            const sticker = this.stickers.find(candidate =>
                sameVector(candidate.normal, definition.normal)
                && dot(candidate.position, definition.right) === col - 1
                && dot(candidate.position, definition.down) === row - 1
            );
            return sticker?.color || 'unknown';
        }));
    }

    isSolved() {
        return FACE_ORDER.every(face => this.getFace(face).flat().every(color => (
            color === FACE_DEFINITIONS[face].color
        )));
    }

    static parseMove(move) {
        const match = String(move || '').trim().toUpperCase().match(/^([URFDLB])([2']?)$/);
        if (!match) return null;
        return {
            face: match[1],
            quarterTurns: match[2] === '2' ? 2 : 1,
            direction: match[2] === "'" ? 1 : -1
        };
    }
}

export class RubiksCubeGame {
    static SCRAMBLE_LENGTH = 20;

    constructor({ container, callbacks, audio, random = Math.random }) {
        this.container = container;
        this.callbacks = callbacks;
        this.audio = audio;
        this.random = random;
        this.state = new RubiksCubeState();
        this.moves = 0;
        this.elapsed = 0;
        this.bestTime = null;
        this.timerId = null;
        this.startedAt = null;
        this.finished = false;
        this.scramble = [];
        this.rotation = { x: -24, y: -34 };
        this.dragState = null;
        this.selectedFace = null;
        this.selectedAxis = 'horizontal';
        this.isAnimating = false;
        this.animationTimer = null;
        this.animationElement = null;

        this.scrambleCube();
        this.render();
        this.loadBestTime();
    }

    async loadBestTime() {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        try {
            const result = await chrome.storage.local.get(STORAGE_KEY);
            this.bestTime = Number.isFinite(result[STORAGE_KEY]) ? result[STORAGE_KEY] : null;
            this.emitStats();
        } catch {
            // The game remains fully playable when storage is unavailable.
        }
    }

    saveBestTime() {
        if (typeof chrome === 'undefined' || !chrome.storage?.local || this.bestTime === null) return;
        chrome.storage.local.set({ [STORAGE_KEY]: this.bestTime });
    }

    scrambleCube() {
        let previousFace = '';
        while (this.scramble.length < RubiksCubeGame.SCRAMBLE_LENGTH) {
            const face = MOVE_FACES[Math.floor(this.random() * MOVE_FACES.length)];
            if (face === previousFace) continue;
            const suffix = this.random() < 0.16 ? '2' : this.random() < 0.5 ? "'" : '';
            const move = `${face}${suffix}`;
            this.state.applyMove(move);
            this.scramble.push(move);
            previousFace = face;
        }
    }

    start() {
        this.startedAt = Date.now();
        this.timerId = setInterval(() => {
            if (this.finished) return;
            this.elapsed = (Date.now() - this.startedAt) / 1000;
            this.emitStats();
        }, 250);
        this.emitStats();
    }

    stop() {
        if (this.timerId !== null) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        if (this.animationTimer !== null) {
            globalThis.clearTimeout(this.animationTimer);
            this.animationTimer = null;
        }
        this.animationElement?.classList.remove(
            'is-turning-forward',
            'is-turning-reverse',
            'is-turning-forward-double',
            'is-turning-reverse-double'
        );
        this.animationElement = null;
        this.isAnimating = false;
    }

    turn(move) {
        if (this.finished || this.isAnimating) return;
        const parsedMove = RubiksCubeState.parseMove(move);
        if (!parsedMove) return;

        const faceElement = this.container?.querySelector(`[data-face="${parsedMove.face}"]`);
        if (typeof faceElement?.animate !== 'function') {
            this.commitTurn(move);
            return;
        }

        this.isAnimating = true;
        this.animationElement = faceElement;
        const direction = parsedMove.direction === 1 ? 'reverse' : 'forward';
        const suffix = parsedMove.quarterTurns === 2 ? '-double' : '';
        const animationClass = `is-turning-${direction}${suffix}`;
        const prefersReducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const duration = prefersReducedMotion ? 1 : parsedMove.quarterTurns === 2 ? 320 : 260;
        let completed = false;
        const finishAnimation = () => {
            if (completed) return;
            completed = true;
            if (this.animationTimer !== null) {
                globalThis.clearTimeout(this.animationTimer);
                this.animationTimer = null;
            }
            faceElement.classList.remove(animationClass);
            this.animationElement = null;
            this.commitTurn(move);
        };

        faceElement.addEventListener('animationend', finishAnimation, { once: true });
        faceElement.classList.add(animationClass);
        this.animationTimer = globalThis.setTimeout(finishAnimation, duration + 80);
    }

    commitTurn(move) {
        if (!this.state.applyMove(move)) return;
        this.moves += 1;
        this.audio?.rotate?.();
        this.isAnimating = false;
        this.render();
        this.emitStats();

        if (this.state.isSolved()) {
            this.finished = true;
            this.stop();
            this.elapsed = (Date.now() - this.startedAt) / 1000;
            if (this.bestTime === null || this.elapsed < this.bestTime) {
                this.bestTime = this.elapsed;
                this.saveBestTime();
            }
            this.audio?.clear?.();
            this.emitStats();
            this.callbacks.onSolved?.({ moves: this.moves, time: this.elapsed, bestTime: this.bestTime });
        }
    }

    render() {
        if (!this.container) return;
        const faces = ['F', 'B', 'R', 'L', 'U', 'D'];
        this.container.innerHTML = `
            <div class="rubiks-game-header">
                <div>
                    <span class="rubiks-game-kicker">20 ходов на старт</span>
                    <h3>Соберите кубик</h3>
                </div>
                <span class="rubiks-scramble" title="Последняя последовательность перемешивания">${this.scramble.join(' ')}</span>
            </div>
            <div class="rubiks-game-main">
                <div class="rubiks-3d-viewport" data-rubiks-viewport tabindex="0" aria-label="Кубик Рубика. Кликните по грани для стрелок или зажмите и потяните для обзора">
                    <div class="rubiks-3d-cube" data-rubiks-cube style="transform: rotateX(${this.rotation.x}deg) rotateY(${this.rotation.y}deg)">
                    ${faces.map(face => `
                        <div class="rubiks-3d-face rubiks-3d-face--${face} ${this.selectedFace === face ? 'is-selected' : ''}" data-face="${face}" role="grid" aria-label="Грань ${face}">
                            ${this.state.getFace(face).flat().map(color => `
                                <span class="rubiks-sticker rubiks-sticker--${color}" role="gridcell" aria-label="${color}"></span>
                            `).join('')}
                        </div>
                    `).join('')}
                    </div>
                    ${this.selectedFace ? `
                        <div class="rubiks-face-control-overlay" data-face-control>
                            <div class="rubiks-axis-switch" role="group" aria-label="Ось поворота грани ${this.selectedFace}">
                                <span class="rubiks-axis-label">Грань ${this.selectedFace} · ось</span>
                                <button type="button" class="rubiks-axis-button ${this.selectedAxis === 'horizontal' ? 'is-active' : ''}" data-face-control data-axis="horizontal" aria-pressed="${this.selectedAxis === 'horizontal'}" aria-label="Горизонтальная ось">↔</button>
                                <button type="button" class="rubiks-axis-button ${this.selectedAxis === 'vertical' ? 'is-active' : ''}" data-face-control data-axis="vertical" aria-pressed="${this.selectedAxis === 'vertical'}" aria-label="Вертикальная ось">↕</button>
                            </div>
                            <div class="rubiks-face-arrows" aria-label="Управление гранью ${this.selectedFace}">
                                ${this.selectedAxis === 'horizontal' ? `
                                    <button type="button" class="rubiks-face-arrow rubiks-face-arrow--left" data-face-control data-face-move="${this.selectedFace}" data-arrow="left" aria-label="Повернуть грань ${this.selectedFace} влево">←</button>
                                    <button type="button" class="rubiks-face-arrow rubiks-face-arrow--right" data-face-control data-face-move="${this.selectedFace}" data-arrow="right" aria-label="Повернуть грань ${this.selectedFace} вправо">→</button>
                                ` : `
                                    <button type="button" class="rubiks-face-arrow rubiks-face-arrow--up" data-face-control data-face-move="${this.selectedFace}" data-arrow="up" aria-label="Повернуть грань ${this.selectedFace} вверх">↑</button>
                                    <button type="button" class="rubiks-face-arrow rubiks-face-arrow--down" data-face-control data-face-move="${this.selectedFace}" data-arrow="down" aria-label="Повернуть грань ${this.selectedFace} вниз">↓</button>
                                `}
                            </div>
                        </div>
                    ` : ''}
                    <span class="rubiks-drag-hint"><span aria-hidden="true">↗</span> Клик → грань и ось · Зажмите — обзор</span>
                </div>
                <details class="rubiks-controls-drawer">
                    <summary><span>Управление ходами</span><span aria-hidden="true">⌄</span></summary>
                    <div class="rubiks-control-panel">
                        <div class="rubiks-controls" aria-label="Ходы кубика">
                            ${MOVE_FACES.map(face => `
                                <div class="rubiks-move-group">
                                    <span>${face}</span>
                                    <button type="button" data-move="${face}" aria-label="Поворот ${face}">${face}</button>
                                    <button type="button" data-move="${face}'" aria-label="Обратный поворот ${face}">${face}'</button>
                                    <button type="button" data-move="${face}2" aria-label="Двойной поворот ${face}">${face}2</button>
                                </div>
                            `).join('')}
                        </div>
                        <p class="rubiks-hint">Клавиши: <kbd>U R F D L B</kbd><br><kbd>Shift</kbd> — обратно</p>
                    </div>
                </details>
            </div>
        `;

        this.container.querySelectorAll('[data-move]').forEach(button => {
            button.addEventListener('click', () => this.turn(button.dataset.move));
        });
        this.container.querySelectorAll('[data-axis]').forEach(button => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this.selectedAxis = button.dataset.axis;
                this.render();
            });
        });
        this.container.querySelectorAll('[data-face]').forEach(faceElement => {
            faceElement.addEventListener('click', (event) => {
                if (event.target.closest?.('[data-face-control]')) return;
                this.selectedFace = faceElement.dataset.face;
                this.render();
            });
        });
        this.container.querySelectorAll('[data-face-move]').forEach(button => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const face = button.dataset.faceMove;
                const arrow = button.dataset.arrow;
                const move = arrow === 'left' || arrow === 'up' ? `${face}'` : face;
                this.selectedFace = face;
                this.turn(move);
            });
        });
        this.bindDragControls();
    }

    bindDragControls() {
        const viewport = this.container?.querySelector('[data-rubiks-viewport]');
        if (!viewport) return;

        viewport.addEventListener('pointerdown', (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            if (event.target.closest?.('[data-face-control]')) return;
            this.dragState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                rotationX: this.rotation.x,
                rotationY: this.rotation.y,
                face: event.target.closest?.('[data-face]')?.dataset.face || null,
                moved: false
            };
            viewport.setPointerCapture?.(event.pointerId);
            viewport.classList.add('is-dragging');
        });

        viewport.addEventListener('pointermove', (event) => {
            if (!this.dragState || event.pointerId !== this.dragState.pointerId) return;
            this.rotation.y = this.dragState.rotationY + (event.clientX - this.dragState.startX) * 0.55;
            this.rotation.x = Math.max(-70, Math.min(70,
                this.dragState.rotationX - (event.clientY - this.dragState.startY) * 0.45
            ));
            if (Math.abs(event.clientX - this.dragState.startX) > 6 || Math.abs(event.clientY - this.dragState.startY) > 6) {
                this.dragState.moved = true;
            }
            const cube = viewport.querySelector('[data-rubiks-cube]');
            if (cube) cube.style.transform = `rotateX(${this.rotation.x}deg) rotateY(${this.rotation.y}deg)`;
        });

        const stopDrag = (event) => {
            if (!this.dragState || event.pointerId !== this.dragState.pointerId) return;
            const { face, moved } = this.dragState;
            viewport.releasePointerCapture?.(event.pointerId);
            viewport.classList.remove('is-dragging');
            this.dragState = null;
            if (!moved && face) {
                this.selectedFace = face;
                this.render();
            }
        };

        viewport.addEventListener('pointerup', stopDrag);
        viewport.addEventListener('pointercancel', stopDrag);
    }

    emitStats() {
        this.callbacks.onStatsUpdate?.({
            score: this.moves,
            highScore: this.bestTime === null ? '—' : formatRubiksTime(this.bestTime),
            time: formatRubiksTime(this.elapsed)
        });
    }
}

export { FACE_DEFINITIONS, STORAGE_KEY as RUBIKS_CUBE_BEST_TIME_KEY };
