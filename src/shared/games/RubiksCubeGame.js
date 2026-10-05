import { escapeHtml, plural, t } from './gamesI18n.js';

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
const DIFFICULTY_STORAGE_KEY = 'rubiksCubeDifficulty';
const TURN_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)';

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

function stickerPosition(face, row, col) {
    const definition = FACE_DEFINITIONS[face];
    return add(definition.normal, add(scale(definition.right, col - 1), scale(definition.down, row - 1)));
}

export function invertRubiksMove(move) {
    const parsed = RubiksCubeState.parseMove(move);
    if (!parsed) return null;
    if (parsed.quarterTurns === 2) return `${parsed.face}2`;
    return parsed.direction === 1 ? parsed.face : `${parsed.face}'`;
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
                    this.stickers.push({
                        face,
                        color: definition.color,
                        normal: [...definition.normal],
                        position: stickerPosition(face, row, col)
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
    // Scramble length per difficulty; "hard" keeps the classic 20-move scramble.
    static DIFFICULTIES = Object.freeze({ easy: 4, medium: 10, hard: 20 });
    static DEFAULT_DIFFICULTY = 'easy';

    constructor({ container, callbacks, audio, random = Math.random, difficulty = null }) {
        this.container = container;
        this.callbacks = callbacks;
        this.audio = audio;
        this.random = random;
        this.state = new RubiksCubeState();
        this.difficulty = RubiksCubeGame.DIFFICULTIES[difficulty] ? difficulty : RubiksCubeGame.DEFAULT_DIFFICULTY;
        this.difficultyFixed = Boolean(RubiksCubeGame.DIFFICULTIES[difficulty]);
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
        this.isAnimating = false;
        this.animationTimer = null;
        this.animationElement = null;
        this.stickerAnimations = [];
        this.history = [];
        this.drawerOpen = false;

        this.scrambleCube();
        this.render();
        this.loadPreferences();
    }

    get bestTimeKey() {
        return this.difficulty === 'hard' ? STORAGE_KEY : `${STORAGE_KEY}:${this.difficulty}`;
    }

    async loadPreferences() {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        try {
            if (!this.difficultyFixed) {
                const stored = (await chrome.storage.local.get(DIFFICULTY_STORAGE_KEY))?.[DIFFICULTY_STORAGE_KEY];
                // Only adopt the saved difficulty before the player has touched the cube.
                if (RubiksCubeGame.DIFFICULTIES[stored] && stored !== this.difficulty && !this.history.length) {
                    this.difficulty = stored;
                    this.newScramble();
                }
            }
            await this.loadBestTime();
        } catch {
            // The game remains fully playable when storage is unavailable.
        }
    }

    async loadBestTime() {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        try {
            const key = this.bestTimeKey;
            const result = await chrome.storage.local.get(key);
            this.bestTime = Number.isFinite(result?.[key]) ? result[key] : null;
            this.emitStats();
        } catch {
            // The game remains fully playable when storage is unavailable.
        }
    }

    saveBestTime() {
        if (typeof chrome === 'undefined' || !chrome.storage?.local || this.bestTime === null) return;
        chrome.storage.local.set({ [this.bestTimeKey]: this.bestTime });
    }

    setDifficulty(difficulty) {
        if (!RubiksCubeGame.DIFFICULTIES[difficulty] || difficulty === this.difficulty) return;
        this.difficulty = difficulty;
        this.bestTime = null;
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            try {
                chrome.storage.local.set({ [DIFFICULTY_STORAGE_KEY]: difficulty });
            } catch { /* Preference is optional. */ }
        }
        this.newScramble();
        this.loadBestTime();
    }

    scrambleCube() {
        this.scramble = [];
        const length = RubiksCubeGame.DIFFICULTIES[this.difficulty] || RubiksCubeGame.SCRAMBLE_LENGTH;
        let previousFace = '';
        while (this.scramble.length < length) {
            const face = MOVE_FACES[Math.floor(this.random() * MOVE_FACES.length)];
            if (face === previousFace) continue;
            const suffix = this.random() < 0.16 ? '2' : this.random() < 0.5 ? "'" : '';
            const move = `${face}${suffix}`;
            this.state.applyMove(move);
            this.scramble.push(move);
            previousFace = face;
        }
        // A short scramble can cancel itself out; a solved start is never offered.
        if (this.state.isSolved()) this.scrambleCube();
    }

    /** The timer waits for the first move, so studying the scramble is free. */
    start() {
        this.stopTimer();
        this.startedAt = null;
        this.emitStats();
    }

    startTimer() {
        if (this.timerId !== null || this.finished) return;
        this.startedAt = Date.now();
        this.timerId = setInterval(() => {
            if (this.finished) return;
            this.elapsed = (Date.now() - this.startedAt) / 1000;
            this.emitStats();
        }, 250);
    }

    stop() {
        this.stopTimer();
        this.cancelAnimation();
    }

    stopTimer() {
        if (this.timerId !== null) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
    }

    cancelAnimation() {
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
        this.stickerAnimations.forEach(animation => animation.cancel?.());
        this.stickerAnimations = [];
        this.isAnimating = false;
    }

    /** Returns the cube to the current scramble and restarts the attempt. */
    resetToScramble() {
        this.cancelAnimation();
        this.state.reset();
        this.scramble.forEach(move => this.state.applyMove(move));
        this.restartAttempt();
    }

    /** Generates a fresh scramble and restarts the attempt. */
    newScramble() {
        this.cancelAnimation();
        this.state.reset();
        this.scrambleCube();
        this.restartAttempt();
    }

    restartAttempt() {
        this.moves = 0;
        this.elapsed = 0;
        this.history = [];
        this.finished = false;
        this.callbacks.onRestart?.();
        this.render();
        this.start();
    }

    undo() {
        if (this.finished || this.isAnimating || !this.history.length) return;
        const inverse = invertRubiksMove(this.history[this.history.length - 1]);
        if (inverse) this.turn(inverse, { undo: true });
    }

    /** Sticker elements on the four side faces that travel with a face turn. */
    getAdjacentStickers(face) {
        const axis = FACE_DEFINITIONS[face].normal;
        const elements = [];
        FACE_ORDER.forEach(otherFace => {
            if (otherFace === face) return;
            const definition = FACE_DEFINITIONS[otherFace];
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 3; col++) {
                    if (dot(stickerPosition(otherFace, row, col), axis) !== 1) continue;
                    const element = this.container?.querySelector(
                        `[data-face="${otherFace}"] [data-row="${row}"][data-col="${col}"]`
                    );
                    if (element) elements.push({ element, definition });
                }
            }
        });
        return elements;
    }

    /**
     * Rotates the edge stickers of the neighbouring faces around the cube centre so
     * the whole layer visibly turns, not only the face itself.
     */
    animateAdjacentStickers(face, angle, duration) {
        const axis = FACE_DEFINITIONS[face].normal;
        this.getAdjacentStickers(face).forEach(({ element, definition }) => {
            if (typeof element.animate !== 'function') return;
            const faceElement = element.parentElement;
            const half = (faceElement?.offsetWidth || 0) / 2;
            const originX = half - (faceElement?.clientLeft || 0) - element.offsetLeft;
            const originY = half - (faceElement?.clientTop || 0) - element.offsetTop;
            const localAxis = [dot(axis, definition.right), dot(axis, definition.down), dot(axis, definition.normal)];
            element.style.transformOrigin = `${originX}px ${originY}px ${-half}px`;
            this.stickerAnimations.push(element.animate([
                { transform: `rotate3d(${localAxis.join(', ')}, 0deg)` },
                { transform: `rotate3d(${localAxis.join(', ')}, ${angle}deg)` }
            ], { duration, easing: TURN_EASING, fill: 'forwards' }));
        });
    }

    turn(move, { undo = false } = {}) {
        if (this.finished || this.isAnimating) return;
        const parsedMove = RubiksCubeState.parseMove(move);
        if (!parsedMove) return;

        const faceElement = this.container?.querySelector(`[data-face="${parsedMove.face}"]`);
        if (typeof faceElement?.animate !== 'function') {
            this.commitTurn(move, { undo });
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
            this.stickerAnimations = [];
            this.commitTurn(move, { undo });
        };

        faceElement.addEventListener('animationend', finishAnimation, { once: true });
        faceElement.classList.add(animationClass);
        // The model's direction -1 (clockwise from outside) is a positive CSS angle.
        this.animateAdjacentStickers(parsedMove.face, -parsedMove.direction * 90 * parsedMove.quarterTurns, duration);
        this.animationTimer = globalThis.setTimeout(finishAnimation, duration + 80);
    }

    commitTurn(move, { undo = false } = {}) {
        if (!this.state.applyMove(move)) return;
        if (undo) {
            this.history.pop();
            this.moves = Math.max(0, this.moves - 1);
        } else {
            this.history.push(move);
            this.moves += 1;
            this.startTimer();
        }
        this.audio?.rotate?.();
        this.isAnimating = false;

        if (this.state.isSolved()) {
            this.finished = true;
            this.elapsed = this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
            this.stop();
            if (this.bestTime === null || this.elapsed < this.bestTime) {
                this.bestTime = this.elapsed;
                this.saveBestTime();
            }
            this.render();
            this.audio?.clear?.();
            this.emitStats();
            this.callbacks.onSolved?.({ moves: this.moves, time: this.elapsed, bestTime: this.bestTime });
            return;
        }
        this.render();
        this.emitStats();
    }

    render() {
        if (!this.container) return;
        const focusSelector = this.getFocusedControlSelector();
        const faces = ['F', 'B', 'R', 'L', 'U', 'D'];
        const scrambleLength = this.scramble.length;
        const difficultyButtons = Object.keys(RubiksCubeGame.DIFFICULTIES).map(level => `
            <button type="button" class="rubiks-difficulty-btn ${this.difficulty === level ? 'is-active' : ''}" data-difficulty="${level}" aria-pressed="${this.difficulty === level}">${escapeHtml(t(`rubiks.difficulty_${level}`))}</button>
        `).join('');
        this.container.innerHTML = `
            <div class="rubiks-game-header">
                <div>
                    <span class="rubiks-game-kicker">${escapeHtml(t('rubiks.kicker', { count: scrambleLength, moves: plural(scrambleLength, 'rubiks.move_forms') }))}</span>
                    <h3>${escapeHtml(t('rubiks.title'))}</h3>
                </div>
                <span class="rubiks-scramble" title="${escapeHtml(t('rubiks.scramble_title'))}">${this.scramble.join(' ')}</span>
            </div>
            <div class="rubiks-toolbar">
                <div class="rubiks-difficulty" role="group" aria-label="${escapeHtml(t('rubiks.difficulty_label'))}">${difficultyButtons}</div>
                <div class="rubiks-actions" role="group" aria-label="${escapeHtml(t('rubiks.actions_label'))}">
                    <button type="button" class="rubiks-action-btn" data-rubiks-action="undo" ${this.history.length && !this.finished ? '' : 'disabled'} title="${escapeHtml(t('rubiks.undo_title'))}">${escapeHtml(t('rubiks.undo'))}</button>
                    <button type="button" class="rubiks-action-btn" data-rubiks-action="reset" ${this.history.length || this.finished ? '' : 'disabled'}>${escapeHtml(t('rubiks.reset'))}</button>
                    <button type="button" class="rubiks-action-btn" data-rubiks-action="scramble">${escapeHtml(t('rubiks.scramble'))}</button>
                </div>
            </div>
            <div class="rubiks-game-main">
                <div class="rubiks-3d-viewport" data-rubiks-viewport tabindex="0" aria-label="${escapeHtml(t('rubiks.viewport_label'))}">
                    <div class="rubiks-3d-cube" data-rubiks-cube style="transform: rotateX(${this.rotation.x}deg) rotateY(${this.rotation.y}deg)">
                    ${faces.map(face => `
                        <div class="rubiks-3d-face rubiks-3d-face--${face} ${this.selectedFace === face ? 'is-selected' : ''}" data-face="${face}" role="grid" aria-label="${escapeHtml(t('rubiks.face_label', { face }))}">
                            ${this.state.getFace(face).flat().map((color, index) => `
                                <span class="rubiks-sticker rubiks-sticker--${color}" data-row="${Math.floor(index / 3)}" data-col="${index % 3}" role="gridcell" aria-label="${escapeHtml(t(`rubiks.colors.${color}`))}"></span>
                            `).join('')}
                        </div>
                    `).join('')}
                    </div>
                    ${this.selectedFace ? `
                        <div class="rubiks-face-control-overlay" data-face-control>
                            <span class="rubiks-face-label">${escapeHtml(t('rubiks.face_label', { face: this.selectedFace }))}</span>
                            <div class="rubiks-face-arrows" aria-label="${escapeHtml(t('rubiks.face_controls', { face: this.selectedFace }))}">
                                <button type="button" class="rubiks-face-arrow rubiks-face-arrow--left" data-face-control data-face-move="${this.selectedFace}" data-arrow="ccw" aria-label="${escapeHtml(t('rubiks.turn_ccw', { face: this.selectedFace }))}" title="${escapeHtml(t('rubiks.turn_ccw', { face: this.selectedFace }))}">↺</button>
                                <button type="button" class="rubiks-face-arrow rubiks-face-arrow--right" data-face-control data-face-move="${this.selectedFace}" data-arrow="cw" aria-label="${escapeHtml(t('rubiks.turn_cw', { face: this.selectedFace }))}" title="${escapeHtml(t('rubiks.turn_cw', { face: this.selectedFace }))}">↻</button>
                            </div>
                        </div>
                    ` : ''}
                    <span class="rubiks-drag-hint"><span aria-hidden="true">↗</span> ${escapeHtml(t('rubiks.drag_hint'))}</span>
                </div>
                <details class="rubiks-controls-drawer" ${this.drawerOpen ? 'open' : ''}>
                    <summary><span>${escapeHtml(t('rubiks.moves_drawer'))}</span><span aria-hidden="true">⌄</span></summary>
                    <div class="rubiks-control-panel">
                        <div class="rubiks-controls" aria-label="${escapeHtml(t('rubiks.moves_label'))}">
                            ${MOVE_FACES.map(face => `
                                <div class="rubiks-move-group">
                                    <span>${face}</span>
                                    <button type="button" data-move="${face}" aria-label="${escapeHtml(t('rubiks.move_cw', { face }))}">${face}</button>
                                    <button type="button" data-move="${face}'" aria-label="${escapeHtml(t('rubiks.move_ccw', { face }))}">${face}'</button>
                                    <button type="button" data-move="${face}2" aria-label="${escapeHtml(t('rubiks.move_double', { face }))}">${face}2</button>
                                </div>
                            `).join('')}
                        </div>
                        <p class="rubiks-hint">${t('rubiks.keys_hint')}</p>
                    </div>
                </details>
            </div>
        `;

        this.container.querySelectorAll('[data-move]').forEach(button => {
            button.addEventListener('click', () => this.turn(button.dataset.move));
        });
        this.container.querySelector('.rubiks-controls-drawer')?.addEventListener('toggle', (event) => {
            this.drawerOpen = event.currentTarget.open;
        });
        this.container.querySelectorAll('[data-rubiks-action]').forEach(button => {
            button.addEventListener('click', () => {
                const action = button.dataset.rubiksAction;
                if (action === 'undo') this.undo();
                else if (action === 'reset') this.resetToScramble();
                else if (action === 'scramble') this.newScramble();
            });
        });
        this.container.querySelectorAll('[data-difficulty]').forEach(button => {
            button.addEventListener('click', () => this.setDifficulty(button.dataset.difficulty));
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
                this.selectedFace = face;
                this.turn(button.dataset.arrow === 'ccw' ? `${face}'` : face);
            });
        });
        this.bindDragControls();
        this.restoreFocus(focusSelector);
    }

    /**
     * Full re-renders replace every control, so the focused control is remembered
     * by its data attributes and focused again once the new markup is in place.
     */
    getFocusedControlSelector() {
        const active = this.container.ownerDocument?.activeElement;
        if (!active || !this.container.contains(active)) return null;
        if (active.matches('summary')) return '.rubiks-controls-drawer summary';
        if (active.hasAttribute('data-rubiks-viewport')) return '[data-rubiks-viewport]';
        const parts = ['data-move', 'data-rubiks-action', 'data-difficulty', 'data-face-move', 'data-arrow']
            .filter(name => active.hasAttribute(name))
            .map(name => `[${name}="${active.getAttribute(name)}"]`);
        return parts.length ? parts.join('') : null;
    }

    restoreFocus(selector) {
        if (!selector) return;
        const target = this.container.querySelector(selector);
        if (target && !target.disabled) {
            target.focus({ preventScroll: true });
            return;
        }
        // A control that became disabled (undo without history) hands focus to the cube.
        this.container.querySelector('[data-rubiks-viewport]')?.focus({ preventScroll: true });
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
