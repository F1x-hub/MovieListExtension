/**
 * One 10×10 Battleship board in the DOM: an ARIA grid with column letters, row
 * numbers and a roving tab stop, so arrows move between cells and Enter or Space
 * acts on one. The board draws what it is given (marks, ships, a placement
 * preview, the last shot) and reports pointer and keyboard intent; game logic
 * stays with its owner.
 */

const MARK_STATES = { '.': 'unknown', o: 'miss', x: 'hit', '#': 'sunk', '*': 'clear' };

function shipSegments(rules, ships) {
    const segments = new Map();
    for (const ship of ships || []) {
        if (!ship) continue;
        const cells = rules.shipCells(ship);
        cells.forEach((cell, position) => {
            let part = 'single';
            if (cells.length > 1) part = position === 0 ? 'start' : position === cells.length - 1 ? 'end' : 'middle';
            segments.set(cell, { part, axis: ship.vertical ? 'v' : 'h' });
        });
    }
    return segments;
}

export class BattleshipBoard {
    /**
     * @param {HTMLElement} root - an empty container that the board fills
     * @param {Object} options
     * @param {Object} options.rules - BattleshipRules
     * @param {string[]} options.columns - ten column letters
     * @param {string} options.label - accessible name of the grid
     * @param {(index: number, info: Object) => string} options.describeCell - accessible cell text
     * @param {(index: number, event: Event) => void} [options.onActivate]
     * @param {(index: number|null) => void} [options.onHover]
     * @param {(index: number, event: PointerEvent) => void} [options.onCellPointerDown]
     * @param {(index: number, event: Event) => void} [options.onContextMenu]
     * @param {(event: KeyboardEvent, index: number) => boolean} [options.onKey] - true when handled
     */
    constructor(root, options) {
        this.root = root;
        this.options = options;
        this.rules = options.rules;
        this.cells = [];
        this.activeIndex = 0;
        this.interactive = false;
        this.previous = new Map();
        this.listeners = [];
        this.build();
    }

    build() {
        const doc = this.root.ownerDocument;
        const grid = doc.createElement('div');
        grid.className = 'bs-board';
        grid.setAttribute('role', 'grid');
        grid.setAttribute('aria-label', this.options.label);
        grid.setAttribute('aria-rowcount', '11');
        grid.setAttribute('aria-colcount', '11');

        const head = doc.createElement('div');
        head.className = 'bs-board__row bs-board__row--head';
        head.setAttribute('role', 'row');
        head.setAttribute('aria-rowindex', '1');
        const corner = doc.createElement('span');
        corner.className = 'bs-board__corner';
        corner.setAttribute('role', 'columnheader');
        corner.setAttribute('aria-colindex', '1');
        head.append(corner);
        this.options.columns.forEach((letter, column) => {
            const label = doc.createElement('span');
            label.className = 'bs-board__label';
            label.setAttribute('role', 'columnheader');
            label.setAttribute('aria-colindex', String(column + 2));
            label.textContent = letter;
            head.append(label);
        });
        grid.append(head);

        for (let y = 0; y < this.rules.SIZE; y += 1) {
            const row = doc.createElement('div');
            row.className = 'bs-board__row';
            row.setAttribute('role', 'row');
            row.setAttribute('aria-rowindex', String(y + 2));
            const number = doc.createElement('span');
            number.className = 'bs-board__label bs-board__label--row';
            number.setAttribute('role', 'rowheader');
            number.setAttribute('aria-colindex', '1');
            number.textContent = String(y + 1);
            row.append(number);
            for (let x = 0; x < this.rules.SIZE; x += 1) {
                const index = this.rules.toIndex(x, y);
                const cell = doc.createElement('div');
                cell.className = 'bs-cell';
                cell.setAttribute('role', 'gridcell');
                cell.setAttribute('aria-colindex', String(x + 2));
                cell.dataset.index = String(index);
                cell.dataset.mark = 'unknown';
                cell.tabIndex = index === 0 ? 0 : -1;
                row.append(cell);
                this.cells.push(cell);
            }
            grid.append(row);
        }

        this.root.replaceChildren(grid);
        this.grid = grid;

        const on = (target, type, handler, options) => {
            target.addEventListener(type, handler, options);
            this.listeners.push(() => target.removeEventListener(type, handler, options));
        };
        const cellIndex = event => {
            const cell = event.target instanceof Element ? event.target.closest('.bs-cell') : null;
            return cell && grid.contains(cell) ? Number(cell.dataset.index) : null;
        };
        on(grid, 'click', event => {
            const index = cellIndex(event);
            if (index === null || !this.interactive) return;
            this.setActiveIndex(index);
            this.options.onActivate?.(index, event);
        });
        on(grid, 'pointerover', event => {
            const index = cellIndex(event);
            if (index !== null) this.options.onHover?.(index);
        });
        on(grid, 'pointerleave', () => this.options.onHover?.(null));
        on(grid, 'pointerdown', event => {
            const index = cellIndex(event);
            if (index !== null && this.interactive) this.options.onCellPointerDown?.(index, event);
        });
        on(grid, 'contextmenu', event => {
            const index = cellIndex(event);
            if (index === null || !this.options.onContextMenu || !this.interactive) return;
            event.preventDefault();
            this.options.onContextMenu(index, event);
        });
        on(grid, 'focusin', event => {
            const index = cellIndex(event);
            if (index === null) return;
            this.setActiveIndex(index);
            if (this.interactive) this.options.onHover?.(index);
        });
        on(grid, 'keydown', event => this.handleKey(event, cellIndex(event)));
    }

    handleKey(event, index) {
        if (index === null) return;
        if (this.options.onKey?.(event, index)) {
            event.preventDefault();
            return;
        }
        const { x, y } = this.rules.toPoint(index);
        const last = this.rules.SIZE - 1;
        const moves = {
            ArrowLeft: [Math.max(0, x - 1), y],
            ArrowRight: [Math.min(last, x + 1), y],
            ArrowUp: [x, Math.max(0, y - 1)],
            ArrowDown: [x, Math.min(last, y + 1)],
            Home: [0, event.ctrlKey ? 0 : y],
            End: [last, event.ctrlKey ? last : y]
        };
        if (moves[event.key]) {
            event.preventDefault();
            this.focusCell(this.rules.toIndex(...moves[event.key]));
            return;
        }
        if ((event.key === 'Enter' || event.key === ' ') && this.interactive) {
            event.preventDefault();
            this.options.onActivate?.(index, event);
        }
    }

    setActiveIndex(index) {
        if (!this.rules.isIndex(index) || index === this.activeIndex) return;
        this.cells[this.activeIndex].tabIndex = -1;
        this.activeIndex = index;
        this.cells[index].tabIndex = 0;
    }

    focusCell(index) {
        if (!this.rules.isIndex(index)) return;
        this.setActiveIndex(index);
        this.cells[index].focus({ preventScroll: true });
    }

    /** The cell under a viewport point, for drags that start outside the board. */
    cellFromPoint(clientX, clientY) {
        const element = this.root.ownerDocument.elementFromPoint(clientX, clientY);
        const cell = element instanceof Element ? element.closest('.bs-cell') : null;
        return cell && this.grid.contains(cell) ? Number(cell.dataset.index) : null;
    }

    /**
     * @param {Object} state
     * @param {string|null} [state.marks] - what the opponent knows about this board
     * @param {Object[]} [state.ships] - ships to draw
     * @param {{cells: number[], valid: boolean}|null} [state.preview]
     * @param {number|null} [state.lastIndex] - the latest shot on this board
     * @param {number|null} [state.pendingIndex] - a shot waiting for the server
     * @param {boolean} [state.interactive]
     * @param {(index: number) => boolean} [state.canTarget] - a cell accepts a shot
     */
    update(state = {}) {
        const marks = typeof state.marks === 'string' ? state.marks : null;
        const segments = shipSegments(this.rules, state.ships);
        const previewCells = new Set(state.preview?.cells || []);
        const previewState = state.preview ? (state.preview.valid ? 'valid' : 'invalid') : null;
        this.interactive = Boolean(state.interactive);
        this.grid.classList.toggle('is-interactive', this.interactive);
        this.grid.setAttribute('aria-disabled', String(!this.interactive));

        this.cells.forEach((cell, index) => {
            const mark = MARK_STATES[marks?.[index] || '.'] || 'unknown';
            const segment = segments.get(index) || null;
            const info = {
                mark,
                ship: Boolean(segment),
                preview: previewCells.has(index) ? previewState : null,
                last: state.lastIndex === index,
                pending: state.pendingIndex === index,
                target: this.interactive && (state.canTarget ? state.canTarget(index) : true)
            };
            const key = `${mark}|${segment ? `${segment.axis}-${segment.part}` : ''}|${info.preview || ''}|${info.last ? 1 : 0}|${info.pending ? 1 : 0}|${info.target ? 1 : 0}`;
            const before = this.previous.get(index);
            if (before === key) return;
            const previousMark = before ? before.split('|')[0] : 'unknown';
            this.previous.set(index, key);

            cell.dataset.mark = mark;
            if (segment) {
                cell.dataset.ship = `${segment.axis}-${segment.part}`;
            } else {
                delete cell.dataset.ship;
            }
            cell.classList.toggle('is-intact', Boolean(segment) && mark !== 'hit' && mark !== 'sunk');
            if (info.preview) cell.dataset.preview = info.preview;
            else delete cell.dataset.preview;
            cell.classList.toggle('is-last', info.last);
            cell.classList.toggle('is-pending', info.pending);
            cell.classList.toggle('is-target', info.target);
            cell.setAttribute('aria-disabled', String(!info.target));
            cell.setAttribute('aria-label', this.options.describeCell(index, info));
            // A mark that just appeared plays its animation once.
            if (before && previousMark !== mark && (mark === 'miss' || mark === 'hit' || mark === 'sunk')) {
                cell.classList.remove('is-fresh');
                void cell.offsetWidth;
                cell.classList.add('is-fresh');
            }
        });
    }

    destroy() {
        this.listeners.forEach(remove => remove());
        this.listeners = [];
        this.root.replaceChildren();
    }
}
