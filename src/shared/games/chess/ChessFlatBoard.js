import { pieceGlyph } from './ChessIcons.js';

/**
 * Flat chess board for browsers without WebGL. It has the 3D renderer's
 * interface (setPosition, animateMove, setHint, setView, clearSelection,
 * dispose) and the same callbacks, so the game view does not care which one it
 * drives. Each square is a button: click a piece, then a square, or use the
 * arrow keys and Enter on the focused board.
 */

const FILES = 'abcdefgh';
const escapeAttribute = text => String(text).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

function shade(square) {
    return (square.charCodeAt(0) - 97 + Number(square[1]) - 1) % 2 === 0 ? 'dark' : 'light';
}

export class ChessFlatBoard {
    constructor(host, options = {}) {
        this.host = host;
        this.doc = host.ownerDocument || globalThis.document;
        this.options = options;
        this.orientation = options.orientation === 'b' ? 'b' : 'w';
        this.interactive = options.interactive || (() => true);
        this.selectable = options.selectable || (() => false);
        this.legalTargets = options.legalTargets || (() => []);
        this.onMove = options.onMove || (() => {});
        this.onSelect = options.onSelect || (() => {});
        this.onCursor = options.onCursor || (() => {});
        this.pieceName = options.pieceName || (piece => `${piece.color}${piece.type}`);
        this.squareLabel = options.squareLabel || (square => square);
        this.pieces = new Map();
        this.selected = null;
        this.targets = [];
        this.lastMove = null;
        this.checkSquare = null;
        this.hint = null;
        this.viewMode = '2d';
        this.grid = this.doc.createElement('div');
        this.grid.className = 'chess-flat';
        this.grid.setAttribute('role', 'grid');
        if (options.label) this.grid.setAttribute('aria-label', options.label);
        this.grid.addEventListener('click', event => {
            const button = event.target.closest('[data-square]');
            if (button) this.activateSquare(button.dataset.square);
        });
        this.grid.addEventListener('keydown', event => this.onKeyDown(event));
        host.appendChild(this.grid);
        this.canvas = this.grid;
        this.render();
    }

    squaresInOrder() {
        const ranks = this.orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
        const files = this.orientation === 'w' ? FILES.split('') : FILES.split('').reverse();
        return ranks.flatMap(rank => files.map(file => `${file}${rank}`));
    }

    render() {
        const focused = this.doc.activeElement?.dataset?.square || null;
        const targets = new Map(this.targets.map(target => [target.to, target]));
        this.grid.innerHTML = this.squaresInOrder().map((square, index) => {
            const piece = this.pieces.get(square);
            const target = targets.get(square);
            const classes = [
                'chess-flat__square',
                `is-${shade(square)}`,
                square === this.selected ? 'is-selected' : '',
                this.lastMove && (square === this.lastMove.from || square === this.lastMove.to) ? 'is-last' : '',
                square === this.checkSquare ? 'is-check' : '',
                target ? (piece || target.capture ? 'is-capture' : 'is-target') : '',
                this.hint && (square === this.hint.from || square === this.hint.to) ? 'is-hint' : ''
            ].filter(Boolean).join(' ');
            const label = [this.squareLabel(square), piece ? this.pieceName(piece) : ''].filter(Boolean).join(', ');
            const fileLabel = index >= 56 ? `<span class="chess-flat__file" aria-hidden="true">${square[0]}</span>` : '';
            const rankLabel = index % 8 === 0 ? `<span class="chess-flat__rank" aria-hidden="true">${square[1]}</span>` : '';
            return `<button class="${classes}" type="button" data-square="${square}" aria-label="${escapeAttribute(label)}" tabindex="${square === (focused || this.selected || (this.orientation === 'w' ? 'e2' : 'e7')) ? 0 : -1}">${rankLabel}${fileLabel}${piece ? pieceGlyph(piece.type, piece.color) : ''}</button>`;
        }).join('');
        if (focused) this.grid.querySelector(`[data-square="${focused}"]`)?.focus();
    }

    setPosition(pieces, { lastMove = null, check = null } = {}) {
        this.pieces = new Map(pieces.map(piece => [piece.square, piece]));
        this.lastMove = lastMove;
        this.checkSquare = check;
        if (this.selected && !this.pieces.has(this.selected)) {
            this.selected = null;
            this.targets = [];
        }
        this.render();
    }

    animateMove() {
        this.selected = null;
        this.targets = [];
        return Promise.resolve();
    }

    setHint(move) {
        this.hint = move ? { from: move.from, to: move.to } : null;
        this.render();
    }

    setView({ orientation = this.orientation } = {}) {
        this.orientation = orientation;
        this.render();
    }

    zoomBy() {}

    /** Client coordinates of a square's centre (for tests). */
    screenPoint(square) {
        const rect = this.grid.querySelector(`[data-square="${square}"]`)?.getBoundingClientRect();
        return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    }

    resize() {}

    isAnimating() {
        return false;
    }

    select(square) {
        this.selected = square;
        this.targets = square ? this.legalTargets(square) : [];
        this.render();
        this.onSelect(square);
    }

    clearSelection() {
        if (!this.selected) return;
        this.selected = null;
        this.targets = [];
        this.render();
        this.onSelect(null);
    }

    activateSquare(square) {
        const act = this.interactive();
        if (act && this.selected && this.targets.some(target => target.to === square)) {
            this.onMove({ from: this.selected, to: square });
        } else if (act && this.selectable(square)) {
            if (this.selected === square) this.clearSelection();
            else this.select(square);
        } else {
            this.clearSelection();
        }
    }

    onKeyDown(event) {
        const square = event.target?.dataset?.square;
        if (!square) return;
        const steps = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
        if (steps[event.code]) {
            event.preventDefault();
            const flip = this.orientation === 'b' ? -1 : 1;
            const file = Math.max(0, Math.min(7, square.charCodeAt(0) - 97 + steps[event.code][0] * flip));
            const rank = Math.max(1, Math.min(8, Number(square[1]) + steps[event.code][1] * flip));
            const next = `${FILES[file]}${rank}`;
            this.grid.querySelectorAll('[data-square]').forEach(button => { button.tabIndex = button.dataset.square === next ? 0 : -1; });
            this.grid.querySelector(`[data-square="${next}"]`)?.focus();
            this.onCursor(next);
        } else if (event.code === 'Escape' && this.selected) {
            event.preventDefault();
            this.clearSelection();
        }
    }

    dispose() {
        this.grid.remove();
    }
}
