import { escapeHtml, plural, t } from './gamesI18n.js';
import {
    CUBE_SIZES,
    FACE_DEFINITIONS,
    OUTER_FACES,
    ROTATION_MOVES,
    RubiksCubeState,
    SCRAMBLE_LENGTHS,
    SLICE_MOVES,
    generateScramble,
    invertMove,
    parseMove,
    tokenizeAlgorithm
} from './RubiksCubeModel.js';

const STORAGE_KEY = 'rubiksCubeBestTime';
const SIZE_STORAGE_KEY = 'rubiksCubeSize';
const HISTORY_STORAGE_KEY = 'rubiksCubeSolves';
const HISTORY_LIMIT = 50;
// Net layout of the flat fallback view: [face, column, row] on a 4×3 grid of faces.
const NET_LAYOUT = [['U', 2, 1], ['L', 1, 2], ['F', 2, 2], ['R', 3, 2], ['B', 4, 2], ['D', 2, 3]];

export function invertRubiksMove(move, size = 3) {
    return invertMove(move, size);
}

/** "1:15" while running; with `precise`, hundredths are added ("1:15.90"). */
export function formatRubiksTime(totalSeconds, { precise = false } = {}) {
    const value = Math.max(0, Number(totalSeconds) || 0);
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    const base = `${minutes}:${String(seconds).padStart(2, '0')}`;
    if (!precise) return base;
    return `${base}.${String(Math.floor((value * 100) % 100)).padStart(2, '0')}`;
}

/** Average of N in the WCA style: drop the best and worst, mean the rest. */
export function averageOf(times, count) {
    if (times.length < count) return null;
    const recent = times.slice(-count).sort((a, b) => a - b);
    const kept = recent.slice(1, -1);
    return kept.reduce((sum, value) => sum + value, 0) / kept.length;
}

export { RubiksCubeState };

export class RubiksCubeGame {
    static SIZES = CUBE_SIZES;
    static DEFAULT_SIZE = 3;

    /**
     * @param {object} options
     * @param {number} [options.size] - cube size; without it the player picks one first
     * @param {boolean} [options.webgl] - false forces the flat net view (tests)
     */
    constructor({ container, callbacks, audio, random = Math.random, size = null, webgl = true }) {
        this.container = container;
        this.callbacks = callbacks || {};
        this.audio = audio;
        this.random = random;
        const fixedSize = CUBE_SIZES.includes(size);
        this.size = fixedSize ? size : RubiksCubeGame.DEFAULT_SIZE;
        // Before the first attempt the player chooses how big the cube is.
        this.choosingSize = !fixedSize;
        this.state = new RubiksCubeState(this.size);
        this.moves = 0;
        this.elapsed = 0;
        this.bestTime = null;
        this.solves = [];
        this.timerId = null;
        this.startedAt = null;
        this.finished = false;
        this.stopped = false;
        this.scramble = [];
        this.history = [];
        this.queue = [];
        this.isAnimating = false;
        this.drawerOpen = false;
        this.view = null;
        this.viewToken = 0;
        this.webgl = webgl;

        if (!this.choosingSize) this.scrambleCube();
        this.buildLayout();
        this.render();
        this.mountView();
        this.loadPreferences();
    }

    get bestTimeKey() {
        // The 3×3 keeps the record key it has always used.
        return this.size === 3 ? STORAGE_KEY : `${STORAGE_KEY}:${this.size}x${this.size}`;
    }

    get historyKey() {
        return `${HISTORY_STORAGE_KEY}:${this.size}x${this.size}`;
    }

    // --- Storage -------------------------------------------------------------

    async loadPreferences() {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        try {
            const stored = Number((await chrome.storage.local.get(SIZE_STORAGE_KEY))?.[SIZE_STORAGE_KEY]);
            // The last size played is preselected in the picker.
            if (this.choosingSize && CUBE_SIZES.includes(stored) && stored !== this.size) {
                this.size = stored;
                this.state = new RubiksCubeState(stored);
                this.buildMoveControls();
                this.remountView();
                this.render();
            }
            await this.loadRecords();
        } catch {
            // The game remains fully playable when storage is unavailable.
        }
    }

    async loadRecords() {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        try {
            const keys = [this.bestTimeKey, this.historyKey];
            const result = await chrome.storage.local.get(keys);
            this.bestTime = Number.isFinite(result?.[keys[0]]) ? result[keys[0]] : null;
            this.solves = Array.isArray(result?.[keys[1]]) ? result[keys[1]].filter(Number.isFinite) : [];
            this.render();
            this.emitStats();
        } catch {
            // The game remains fully playable when storage is unavailable.
        }
    }

    saveRecords() {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        try {
            chrome.storage.local.set({
                ...(this.bestTime === null ? {} : { [this.bestTimeKey]: this.bestTime }),
                [this.historyKey]: this.solves.slice(-HISTORY_LIMIT)
            });
        } catch { /* Records are optional. */ }
    }

    // --- Cube size -----------------------------------------------------------

    /** Starts a scrambled attempt on a cube of `size` (2…7). */
    setSize(size) {
        if (!CUBE_SIZES.includes(size) || this.stopped) return;
        const changed = size !== this.size;
        this.size = size;
        this.choosingSize = false;
        this.queue = [];
        this.isAnimating = false;
        this.state = new RubiksCubeState(size);
        if (changed) {
            this.bestTime = null;
            this.solves = [];
            this.buildMoveControls();
            this.remountView();
        }
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            try {
                chrome.storage.local.set({ [SIZE_STORAGE_KEY]: size });
            } catch { /* Preference is optional. */ }
        }
        this.scrambleCube();
        this.restartAttempt();
        this.loadRecords();
        this.container?.querySelector('[data-rubiks-viewport]')?.focus({ preventScroll: true });
    }

    /** Shows the size picker again; the current attempt is abandoned. */
    chooseSize() {
        if (this.stopped || this.isAnimating) return;
        this.stopTimer();
        this.queue = [];
        this.choosingSize = true;
        this.render();
        this.container?.querySelector(`[data-size="${this.size}"]`)?.focus({ preventScroll: true });
    }

    // --- Attempt lifecycle ---------------------------------------------------

    scrambleCube() {
        do {
            this.state.reset();
            this.scramble = generateScramble(this.size, SCRAMBLE_LENGTHS[this.size], this.random);
            this.scramble.forEach(move => this.state.applyMove(move));
            // A short scramble can cancel itself out; a solved start is never offered.
        } while (this.state.isSolved());
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
        }, 100);
    }

    /** Ends the game for good: timers, animation loop and WebGL context. */
    stop() {
        this.stopped = true;
        this.stopTimer();
        this.queue = [];
        this.view?.dispose();
        this.view = null;
    }

    stopTimer() {
        if (this.timerId !== null) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
    }

    /** Returns the cube to the current scramble and restarts the attempt. */
    resetToScramble() {
        if (this.isAnimating || this.choosingSize) return;
        this.state.reset();
        this.scramble.forEach(move => this.state.applyMove(move));
        this.restartAttempt();
    }

    /** Generates a fresh scramble and restarts the attempt. */
    newScramble() {
        if (this.isAnimating || this.choosingSize) return;
        this.scrambleCube();
        this.restartAttempt();
    }

    restartAttempt() {
        this.stopTimer();
        this.queue = [];
        this.moves = 0;
        this.elapsed = 0;
        this.history = [];
        this.finished = false;
        this.callbacks.onRestart?.();
        this.view?.syncColors();
        this.render();
        this.start();
    }

    // --- Moves ---------------------------------------------------------------

    /** Queues a move; quick input is played back in order. */
    turn(move, { undo = false } = {}) {
        if (this.finished || this.stopped || this.choosingSize) return;
        if (!undo && !parseMove(move, this.size)) return;
        if (!this.view) {
            this.performNow(move, undo);
            return;
        }
        this.queue.push({ move, undo });
        this.pump();
    }

    undo() {
        this.turn(null, { undo: true });
    }

    performNow(move, undo) {
        if (undo) {
            const inverse = invertMove(this.history[this.history.length - 1], this.size);
            if (inverse) this.commitTurn(inverse, { undo: true });
            return;
        }
        this.commitTurn(move);
    }

    /** Plays an algorithm such as "R U R' U'" move by move; false if invalid. */
    playAlgorithm(algorithm) {
        if (this.choosingSize) return false;
        const moves = tokenizeAlgorithm(algorithm, this.size);
        if (!moves?.length) return false;
        moves.forEach(move => this.turn(move));
        return true;
    }

    async pump() {
        if (this.isAnimating || !this.queue.length || !this.view) return;
        const entry = this.queue.shift();
        const move = entry.undo ? invertMove(this.history[this.history.length - 1], this.size) : entry.move;
        const parsed = parseMove(move, this.size);
        if (!parsed || this.finished) {
            this.pump();
            return;
        }
        this.isAnimating = true;
        this.render();
        const view = this.view;
        const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        // A backlog of queued moves plays faster so the cube keeps up with fingers.
        const base = parsed.quarterTurns === 2 ? 300 : 210;
        const duration = reducedMotion ? 1 : base / Math.min(3, 1 + this.queue.length * 0.6);
        await view.animateMove(parsed, duration);
        if (this.stopped || view !== this.view) return;
        this.isAnimating = false;
        this.commitTurn(move, { undo: entry.undo });
        this.pump();
    }

    /** A layer the player dragged by hand has already landed on screen. */
    onLayerTurn(move) {
        if (this.finished || this.stopped || this.choosingSize) {
            this.view?.syncColors();
            return;
        }
        this.commitTurn(move);
    }

    commitTurn(move, { undo = false } = {}) {
        const parsed = parseMove(move, this.size);
        if (!parsed || !this.state.applyMove(parsed)) return;
        if (undo) {
            this.history.pop();
            if (!parsed.rotation) this.moves = Math.max(0, this.moves - 1);
        } else {
            this.history.push(parsed.notation);
            // Whole-cube rotations change the view, not the puzzle, so they are free.
            if (!parsed.rotation) {
                this.moves += 1;
                this.startTimer();
            }
        }
        this.view?.syncColors();
        this.audio?.rotate?.();

        if (this.startedAt && this.state.isSolved()) {
            this.finishSolve();
            return;
        }
        this.render();
        this.emitStats();
    }

    finishSolve() {
        this.finished = true;
        this.queue = [];
        this.elapsed = (Date.now() - this.startedAt) / 1000;
        this.stopTimer();
        if (this.bestTime === null || this.elapsed < this.bestTime) this.bestTime = this.elapsed;
        this.solves = [...this.solves, this.elapsed].slice(-HISTORY_LIMIT);
        this.saveRecords();
        this.render();
        this.audio?.clear?.();
        this.emitStats();
        this.callbacks.onSolved?.({ moves: this.moves, time: this.elapsed, bestTime: this.bestTime, size: this.size });
    }

    // --- View ----------------------------------------------------------------

    /** Loads the WebGL renderer lazily; without WebGL the flat net stays. */
    async mountView() {
        if (!this.webgl || !this.container) return;
        const token = ++this.viewToken;
        try {
            const { RubiksCubeRenderer } = await import('./RubiksCubeRenderer.js');
            // A newer mount (another size) or a closed game wins over this one.
            if (this.stopped || token !== this.viewToken
                || !RubiksCubeRenderer.isSupported(this.container.ownerDocument)) return;
            const host = this.container.querySelector('[data-rubiks-viewport]');
            this.view = new RubiksCubeRenderer(host, {
                size: this.size,
                getState: () => this.state,
                canInteract: () => !this.finished && !this.choosingSize && !this.isAnimating && !this.queue.length,
                onLayerTurn: move => this.onLayerTurn(move)
            });
            this.container.querySelector('.rubiks-game-main')?.classList.add('has-3d');
        } catch (error) {
            console.warn('[RubiksCube] 3D view unavailable, using the flat net:', error);
            this.view = null;
        }
    }

    /** A different cube size needs a freshly built 3D scene. */
    remountView() {
        if (!this.webgl) return;
        this.view?.dispose();
        this.view = null;
        this.container?.querySelector('.rubiks-game-main')?.classList.remove('has-3d');
        this.mountView();
    }

    resetView() {
        this.view?.resetView();
    }

    /** Arrow keys turn the view; they never count as moves. */
    nudgeView(dx, dy) {
        this.view?.nudgeView(dx, dy);
    }

    buildLayout() {
        if (!this.container) return;
        const sizeCards = CUBE_SIZES.map(size => `
            <button type="button" class="rubiks-size-card" data-size="${size}" aria-pressed="false">
                <span class="rubiks-size-preview" style="--rubiks-n:${size}" aria-hidden="true">${'<i></i>'.repeat(size * size)}</span>
                <b>${size}×${size}</b>
                <small>${escapeHtml(t(`rubiks.size_name_${size}`))}</small>
            </button>
        `).join('');
        this.container.innerHTML = `
            <div class="rubiks-game-header">
                <div>
                    <span class="rubiks-game-kicker" data-rubiks-kicker></span>
                    <h3>${escapeHtml(t('rubiks.title'))}</h3>
                </div>
                <span class="rubiks-scramble" title="${escapeHtml(t('rubiks.scramble_title'))}" data-rubiks-scramble></span>
            </div>
            <div class="rubiks-toolbar">
                <button type="button" class="rubiks-action-btn rubiks-size-btn" data-rubiks-action="size" aria-label="${escapeHtml(t('rubiks.size_change'))}"></button>
                <div class="rubiks-actions" role="group" aria-label="${escapeHtml(t('rubiks.actions_label'))}">
                    <button type="button" class="rubiks-action-btn" data-rubiks-action="undo" title="${escapeHtml(t('rubiks.undo_title'))}">${escapeHtml(t('rubiks.undo'))}</button>
                    <button type="button" class="rubiks-action-btn" data-rubiks-action="reset">${escapeHtml(t('rubiks.reset'))}</button>
                    <button type="button" class="rubiks-action-btn" data-rubiks-action="scramble">${escapeHtml(t('rubiks.scramble'))}</button>
                </div>
            </div>
            <div class="rubiks-game-main">
                <div class="rubiks-3d-viewport" data-rubiks-viewport tabindex="0" aria-label="${escapeHtml(t('rubiks.viewport_label'))}">
                    <div class="rubiks-net" data-rubiks-net role="img"></div>
                    <span class="rubiks-drag-hint">${escapeHtml(t('rubiks.drag_hint'))}</span>
                    <button type="button" class="rubiks-view-reset" data-rubiks-action="view" title="${escapeHtml(t('rubiks.view_reset'))}" aria-label="${escapeHtml(t('rubiks.view_reset'))}">⟲</button>
                    <div class="rubiks-size-picker" data-rubiks-picker role="dialog" aria-label="${escapeHtml(t('rubiks.pick_title'))}">
                        <h4>${escapeHtml(t('rubiks.pick_title'))}</h4>
                        <p>${escapeHtml(t('rubiks.pick_text'))}</p>
                        <div class="rubiks-size-grid" role="group" aria-label="${escapeHtml(t('rubiks.size_label'))}">${sizeCards}</div>
                    </div>
                </div>
                <div class="rubiks-session" data-rubiks-session aria-live="polite"></div>
                <details class="rubiks-controls-drawer">
                    <summary><span>${escapeHtml(t('rubiks.moves_drawer'))}</span><span aria-hidden="true">⌄</span></summary>
                    <div class="rubiks-control-panel">
                        <div data-rubiks-moves></div>
                        <form class="rubiks-algorithm" data-rubiks-algorithm>
                            <input type="text" name="algorithm" spellcheck="false" autocomplete="off" placeholder="R U R' U'" aria-label="${escapeHtml(t('rubiks.algorithm_label'))}">
                            <button type="submit" class="rubiks-action-btn">${escapeHtml(t('rubiks.algorithm_play'))}</button>
                        </form>
                        <p class="rubiks-hint">${t('rubiks.keys_hint')}</p>
                    </div>
                </details>
            </div>
        `;

        this.buildMoveControls();
        this.container.querySelector('.rubiks-controls-drawer')?.addEventListener('toggle', (event) => {
            this.drawerOpen = event.currentTarget.open;
        });
        this.container.querySelectorAll('[data-rubiks-action]').forEach(button => {
            button.addEventListener('click', () => {
                const action = button.dataset.rubiksAction;
                if (action === 'undo') this.undo();
                else if (action === 'reset') this.resetToScramble();
                else if (action === 'scramble') this.newScramble();
                else if (action === 'view') this.resetView();
                else if (action === 'size') this.chooseSize();
            });
        });
        this.container.querySelectorAll('[data-size]').forEach(button => {
            button.addEventListener('click', () => this.setSize(Number(button.dataset.size)));
        });
        const form = this.container.querySelector('[data-rubiks-algorithm]');
        form?.addEventListener('submit', (event) => {
            event.preventDefault();
            const input = form.elements.algorithm;
            const valid = this.playAlgorithm(input.value);
            input.setCustomValidity(valid ? '' : t('rubiks.algorithm_invalid'));
            input.reportValidity?.();
            if (valid) input.value = '';
        });
        form?.elements.algorithm.addEventListener('input', (event) => event.currentTarget.setCustomValidity(''));
    }

    /** Move buttons depend on the cube: slices exist on odd cubes, wide turns from 4×4. */
    buildMoveControls() {
        const host = this.container?.querySelector('[data-rubiks-moves]');
        if (!host) return;
        const button = (move, label) => `<button type="button" data-move="${move}" aria-label="${escapeHtml(label)}">${move}</button>`;
        const group = (token, labels) => `
            <div class="rubiks-move-group">
                ${button(token, t(labels[0], { face: token }))}
                ${button(`${token}'`, t(labels[1], { face: token }))}
                ${button(`${token}2`, t(labels[2], { face: token }))}
            </div>`;
        const faceLabels = ['rubiks.move_cw', 'rubiks.move_ccw', 'rubiks.move_double'];
        const extra = [
            ...(this.size % 2 === 1 ? SLICE_MOVES.map(token => group(token, faceLabels)) : []),
            ...(this.size >= 4 ? OUTER_FACES.map(face => group(`${face}w`, faceLabels)) : []),
            ...ROTATION_MOVES.map(token => group(token, ['rubiks.rotate_cw', 'rubiks.rotate_ccw', 'rubiks.rotate_double']))
        ];
        host.innerHTML = `
            <div class="rubiks-controls" aria-label="${escapeHtml(t('rubiks.moves_label'))}">
                ${OUTER_FACES.map(face => group(face, faceLabels)).join('')}
            </div>
            <div class="rubiks-controls rubiks-controls--extra" aria-label="${escapeHtml(t('rubiks.slices_label'))}">
                ${extra.join('')}
            </div>
        `;
        host.querySelectorAll('[data-move]').forEach(element => {
            element.addEventListener('click', () => this.turn(element.dataset.move));
        });
    }

    /** Updates the dynamic parts of the layout in place; the viewport is never rebuilt. */
    render() {
        if (!this.container) return;
        const query = selector => this.container.querySelector(selector);
        const scrambleLength = this.scramble.length;
        const kicker = query('[data-rubiks-kicker]');
        if (kicker) {
            kicker.textContent = this.choosingSize
                ? t('rubiks.pick_kicker')
                : t('rubiks.kicker', { size: `${this.size}×${this.size}`, count: scrambleLength, moves: plural(scrambleLength, 'rubiks.move_forms') });
        }
        const scramble = query('[data-rubiks-scramble]');
        if (scramble) scramble.textContent = this.choosingSize ? '' : this.scramble.join(' ');
        const picker = query('[data-rubiks-picker]');
        if (picker) picker.hidden = !this.choosingSize;
        this.container.querySelector('.rubiks-game-main')?.classList.toggle('is-choosing', this.choosingSize);
        this.container.querySelectorAll('[data-size]').forEach(element => {
            const active = Number(element.dataset.size) === this.size;
            element.classList.toggle('is-active', active);
            element.setAttribute('aria-pressed', String(active));
        });
        const sizeButton = query('[data-rubiks-action="size"]');
        if (sizeButton) {
            sizeButton.textContent = t('rubiks.size_button', { size: `${this.size}×${this.size}` });
            sizeButton.disabled = this.choosingSize;
        }
        const undo = query('[data-rubiks-action="undo"]');
        if (undo) undo.disabled = this.choosingSize || !this.history.length || this.finished;
        const reset = query('[data-rubiks-action="reset"]');
        if (reset) reset.disabled = this.choosingSize || !(this.history.length || this.finished);
        const scrambleButton = query('[data-rubiks-action="scramble"]');
        if (scrambleButton) scrambleButton.disabled = this.choosingSize;
        const drawer = query('.rubiks-controls-drawer');
        if (drawer && drawer.open !== this.drawerOpen) drawer.open = this.drawerOpen;
        this.renderSession();
        if (!this.view) this.renderNet();
        // A control that just became disabled must not swallow keyboard focus.
        const active = this.container.ownerDocument?.activeElement;
        if (active?.disabled && this.container.contains(active)) query('[data-rubiks-viewport]')?.focus({ preventScroll: true });
    }

    renderSession() {
        const session = this.container.querySelector('[data-rubiks-session]');
        if (!session) return;
        const format = value => (value === null ? '—' : formatRubiksTime(value, { precise: true }));
        const last = this.solves.length ? this.solves[this.solves.length - 1] : null;
        session.innerHTML = [
            [t('rubiks.session_last'), format(last)],
            [t('rubiks.session_ao5'), format(averageOf(this.solves, 5))],
            [t('rubiks.session_ao12'), format(averageOf(this.solves, 12))],
            [t('rubiks.session_count'), String(this.solves.length)]
        ].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`).join('');
    }

    /** Flat unfolded cube, shown until (or instead of) the WebGL view. */
    renderNet() {
        const net = this.container.querySelector('[data-rubiks-net]');
        if (!net) return;
        net.setAttribute('aria-label', t('rubiks.net_label'));
        net.style.setProperty('--rubiks-n', String(this.size));
        net.innerHTML = NET_LAYOUT.map(([face, column, row]) => `
            <div class="rubiks-net-face" data-face="${face}" style="grid-column:${column};grid-row:${row}" aria-label="${escapeHtml(t('rubiks.face_label', { face }))}">
                ${this.state.getFace(face).flat().map((color, index) => `
                    <span class="rubiks-sticker rubiks-sticker--${color}" data-row="${Math.floor(index / this.size)}" data-col="${index % this.size}" aria-label="${escapeHtml(t(`rubiks.colors.${color}`))}"></span>
                `).join('')}
            </div>
        `).join('');
    }

    emitStats() {
        this.callbacks.onStatsUpdate?.({
            score: this.moves,
            highScore: this.bestTime === null ? '—' : formatRubiksTime(this.bestTime, { precise: true }),
            time: formatRubiksTime(this.elapsed, { precise: this.finished })
        });
    }
}

export { FACE_DEFINITIONS, STORAGE_KEY as RUBIKS_CUBE_BEST_TIME_KEY };
