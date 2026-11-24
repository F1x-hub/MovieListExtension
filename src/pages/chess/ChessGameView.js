import { t, escapeHtml } from '../../shared/games/gamesI18n.js';
import { pieceGlyph } from '../../shared/games/chess/ChessIcons.js';

/**
 * The chess game screen shared by the bot and the online modes: the board (3D,
 * or flat without WebGL), the player cards with captured pieces and clocks, the
 * status line, the move list with review of earlier positions, the promotion
 * choice and the result card. A mode subclass supplies the rules of play:
 * whose move it is, what a move does, the actions and the texts.
 */

export const tc = (key, params) => t(`chess.${key}`, params);

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_ORDER = { q: 0, r: 1, b: 2, n: 3, p: 4 };
const LOW_TIME_MS = 20 * 1000;

export const ICONS = {
    flip: '<svg data-icon="REFRESH" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9A7 7 0 0 1 15.6 5.6L17 7M17 3V7H13M17 11A7 7 0 0 1 4.4 14.4L3 13M3 17V13H7"/></svg>',
    top: '<svg data-icon="BOARD" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3H15A2 2 0 0 1 17 5V15A2 2 0 0 1 15 17H5A2 2 0 0 1 3 15V5A2 2 0 0 1 5 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 3H15A2 2 0 0 1 17 5V10H10ZM3 10H10V17H5A2 2 0 0 1 3 15Z"/></svg>',
    zoomIn: '<svg data-icon="ZOOM_IN" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3A6 6 0 1 0 9 15A6 6 0 1 0 9 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M13.6 13.6L17.6 17.6"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 6.8V11.2M6.8 9H11.2"/></svg>',
    zoomOut: '<svg data-icon="ZOOM_OUT" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3A6 6 0 1 0 9 15A6 6 0 1 0 9 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M13.6 13.6L17.6 17.6"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6.8 9H11.2"/></svg>',
    reset: '<svg data-icon="RESET" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.2 11.6A7 7 0 1 0 5 5.1L3 7M3 3V7H7"/></svg>',
    robot: '<svg data-icon="ROBOT" aria-hidden="true" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 7H14A3 3 0 0 1 17 10V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V10A3 3 0 0 1 6 7Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 7V4"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 1.2A1.6 1.6 0 1 0 10 4.4A1.6 1.6 0 1 0 10 1.2ZM7.2 9.9A1.3 1.3 0 1 0 7.2 12.5A1.3 1.3 0 1 0 7.2 9.9ZM12.8 9.9A1.3 1.3 0 1 0 12.8 12.5A1.3 1.3 0 1 0 12.8 9.9Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M8.4 14.2H11.6"/></svg>',
    clock: '<svg data-icon="CLOCK" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 3A7 7 0 1 0 10 17A7 7 0 1 0 10 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6V10L12.6 12"/></svg>',
    dots: '<svg data-icon="MORE" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M4 8.4A1.6 1.6 0 1 0 4 11.6A1.6 1.6 0 1 0 4 8.4ZM10 8.4A1.6 1.6 0 1 0 10 11.6A1.6 1.6 0 1 0 10 8.4ZM16 8.4A1.6 1.6 0 1 0 16 11.6A1.6 1.6 0 1 0 16 8.4Z"/></svg>',
    warning: '<svg data-icon="WARNING" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 3.2L17.4 16H2.6Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 3.2L17.4 16H2.6ZM10 7H10A1 1 0 0 1 11 8V10.6A1 1 0 0 1 10 11.6H10A1 1 0 0 1 9 10.6V8A1 1 0 0 1 10 7ZM10 12.45A1.15 1.15 0 1 0 10 14.75A1.15 1.15 0 1 0 10 12.45Z"/></svg>',
    flag: '<svg data-icon="FLAG" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3V17"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 2H15.2A.8 .8 0 0 1 15.9 3.3L13.8 6.6L15.9 9.9A.8 .8 0 0 1 15.2 11.2H5Z"/></svg>',
    trophy: '<svg data-icon="TROPHY" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14V8A4 4 0 0 1 6 8Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 3L10 12C12.21 12 14 10.21 14 8L14 3L10 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 5H2.6V5.6A3.6 3.6 0 0 0 6.2 9.2M14 5H17.4V5.6A3.6 3.6 0 0 1 13.8 9.2M10 12V16M6 17H14"/></svg>',
    eye: '<svg data-icon="EYE" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2 10C3.8 6.6 6.6 5 10 5C13.4 5 16.2 6.6 18 10C16.2 13.4 13.4 15 10 15C6.6 15 3.8 13.4 2 10Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 7.5A2.5 2.5 0 1 0 10 12.5A2.5 2.5 0 1 0 10 7.5Z"/></svg>',
    close: '<svg data-icon="CLOSE" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5L15 15M15 5L5 15"/></svg>',
    back: '<svg data-icon="CHEVRON_LEFT" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12.5 5L7.5 10L12.5 15"/></svg>'
};

export function initialOf(name) {
    return String(name || '?').trim().charAt(0).toLocaleUpperCase() || '?';
}

export function avatarHtml(name, photo) {
    const safe = typeof photo === 'string' && /^https:\/\//i.test(photo) ? photo : null;
    return safe
        ? `<span class="chess-avatar"><img src="${escapeHtml(safe)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`
        : `<span class="chess-avatar" aria-hidden="true">${escapeHtml(initialOf(name))}</span>`;
}

/** 9:58, 1:02:00, or 0:09.4 under twenty seconds. */
export function formatClock(ms) {
    const value = Math.max(0, Number(ms) || 0);
    if (value < LOW_TIME_MS) {
        const tenths = Math.floor(value / 100);
        return `0:${String(Math.floor(tenths / 10)).padStart(2, '0')}.${tenths % 10}`;
    }
    const total = Math.ceil(value / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

const otherColor = color => (color === 'w' ? 'b' : 'w');

/** Replaces an element's markup only when it changed (remembered per element). */
function setHtml(element, html) {
    if (element.chessRenderedHtml === html) return;
    element.innerHTML = html;
    element.chessRenderedHtml = html;
}

export class ChessGameView {
    /**
     * @param {{ root: HTMLElement, rules?: Object, sounds: Object, prefs: Object,
     *   onPrefs?: Function, onNavigate: Function, onToast: Function, onAttention?: Function }} options
     */
    constructor(options) {
        this.options = options;
        this.root = options.root;
        this.rules = options.rules || globalThis.ChessRules;
        this.sounds = options.sounds;
        this.prefs = options.prefs || {};
        this.game = new this.rules.ChessGame();
        this.orientation = 'w';
        this.board = null;
        this.reviewPly = null;
        this.resultDismissed = false;
        this.promotion = null;
        this.disposed = false;
        this.busy = new Set();
        this.elements = {};
        this.handleDocumentKey = event => this.onDocumentKey(event);
    }

    // --- Mode hooks (overridden) -------------------------------------------------------------

    /** The user's colour ('w' / 'b'), or null for someone only watching. */
    get playerColor() { return 'w'; }
    canUserMove() { return false; }
    async submitMove() {}
    /** @returns {{ name: string, meta: string, avatar: string, clockMs?: number|null, clockRunning?: boolean }} */
    playerInfo(color) { return { name: color, meta: '', avatar: avatarHtml(color) }; }
    statusInfo() { return { tone: 'turn', text: '', icon: ICONS.clock }; }
    actions() { return []; }
    resultInfo() { return null; }
    stageCard() { return null; }
    handleAction() {}
    hasClocks() { return false; }
    subtitle() { return ''; }

    // --- Lifecycle ---------------------------------------------------------------------------------

    start() {
        this.renderShell();
        this.mountBoard();
        document.addEventListener('keydown', this.handleDocumentKey);
    }

    destroy() {
        this.disposed = true;
        document.removeEventListener('keydown', this.handleDocumentKey);
        if (this.handleClick) this.root.removeEventListener('click', this.handleClick);
        this.promotion?.resolve(null);
        this.promotion = null;
        this.board?.dispose();
        this.board = null;
        this.root.innerHTML = '';
    }

    renderShell() {
        const tool = (id, icon, label, pressed = null) => `<button class="chess-tool" type="button" data-tool="${id}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"${pressed === null ? '' : ` aria-pressed="${pressed}"`}>${icon}</button>`;
        this.root.innerHTML = `
            <div class="chess-game-top">
                <button class="chess-back" type="button" data-action="lobby">${ICONS.back}<span>${escapeHtml(tc('game.back'))}</span></button>
            </div>
            <div class="chess-game">
                <div class="chess-stage" id="chessStage">
                    <div class="chess-board-host" id="chessBoardHost">
                        <div class="chess-fallback" id="chessBoardLoading"><div class="app-loader app-loader--section" role="status"><div class="app-loader__indicator" aria-hidden="true"></div><span class="app-loader__label">${escapeHtml(tc('game.board_loading'))}</span></div></div>
                    </div>
                    <div class="chess-toolbar" role="toolbar" aria-label="${escapeHtml(tc('game.toolbar'))}" id="chessToolbar">
                        ${tool('flip', ICONS.flip, tc('game.flip'))}
                        ${tool('top', ICONS.top, tc('game.top_view'), this.prefs.view === 'top')}
                        <span class="chess-tool-sep" aria-hidden="true"></span>
                        ${tool('zoom-out', ICONS.zoomOut, tc('game.zoom_out'))}
                        ${tool('zoom-in', ICONS.zoomIn, tc('game.zoom_in'))}
                        ${tool('reset', ICONS.reset, tc('game.reset_view'))}
                    </div>
                    <p class="chess-stage__hint" id="chessStageHint">${escapeHtml(tc('game.stage_hint'))}</p>
                    <div class="chess-stage-card" id="chessStageCard" hidden></div>
                    <div class="chess-promotion" id="chessPromotion" role="dialog" aria-modal="false" aria-labelledby="chessPromotionTitle" hidden></div>
                    <div class="chess-result" id="chessResult" role="dialog" aria-modal="false" aria-labelledby="chessResultTitle" hidden></div>
                </div>
                <aside class="chess-side" aria-label="${escapeHtml(tc('game.side_label'))}">
                    <div class="chess-player chess-player--top" id="chessPlayerTop"></div>
                    <div class="chess-status" id="chessStatus" role="status" aria-live="polite"></div>
                    <div class="chess-moves-panel">
                        <div class="chess-moves-panel__head"><span>${escapeHtml(tc('game.moves'))}</span><span id="chessMoveCount"></span></div>
                        <ol class="chess-moves" id="chessMoves" tabindex="0" aria-label="${escapeHtml(tc('game.moves'))}"></ol>
                    </div>
                    <div class="chess-player chess-player--bottom" id="chessPlayerBottom"></div>
                    <div class="chess-actions" id="chessActions"></div>
                </aside>
            </div>
            <p class="sr-only" id="chessAnnounce" aria-live="assertive"></p>`;
        const byId = id => this.root.querySelector(`#${id}`);
        this.elements = {
            stage: byId('chessStage'),
            host: byId('chessBoardHost'),
            toolbar: byId('chessToolbar'),
            hint: byId('chessStageHint'),
            stageCard: byId('chessStageCard'),
            promotion: byId('chessPromotion'),
            result: byId('chessResult'),
            top: byId('chessPlayerTop'),
            bottom: byId('chessPlayerBottom'),
            status: byId('chessStatus'),
            moves: byId('chessMoves'),
            moveCount: byId('chessMoveCount'),
            actions: byId('chessActions'),
            announce: byId('chessAnnounce')
        };
        this.handleClick = event => this.onClick(event);
        this.root.addEventListener('click', this.handleClick);
        this.elements.moves.addEventListener('keydown', event => this.onMovesKey(event));
    }

    async mountBoard() {
        const options = {
            orientation: this.orientation,
            label: tc('game.board_label'),
            interactive: () => this.canUserMove() && this.reviewPly === null && !this.promotion,
            selectable: square => this.game.get(square)?.color === this.playerColor,
            legalTargets: square => this.game.moves({ square }).map(move => ({ to: move.to, capture: Boolean(move.captured) })),
            onMove: move => this.handleUserMove(move),
            onCursor: square => this.announceSquare(square),
            onReady: () => this.root.querySelector('#chessBoardLoading')?.remove(),
            pieceName: piece => tc('announce.piece_of', { piece: tc(`pieces.${piece.type}`), side: tc(`colors_of.${piece.color}`) }),
            squareLabel: square => square
        };
        let board = null;
        try {
            const { ChessBoardRenderer } = await import('../../shared/games/chess/ChessBoardRenderer.js');
            if (this.disposed) return;
            if (ChessBoardRenderer.isSupported(document)) board = new ChessBoardRenderer(this.elements.host, options);
        } catch (error) {
            console.warn('[Chess] 3D board unavailable, using the flat board:', error);
            board = null;
        }
        if (this.disposed) {
            board?.dispose();
            return;
        }
        if (!board) {
            const { ChessFlatBoard } = await import('../../shared/games/chess/ChessFlatBoard.js');
            if (this.disposed) return;
            board = new ChessFlatBoard(this.elements.host, options);
            this.elements.stage.classList.add('is-flat');
            this.elements.toolbar.hidden = true;
            this.elements.hint.hidden = true;
            this.root.querySelector('#chessBoardLoading')?.remove();
        }
        this.board = board;
        if (this.prefs.view === 'top') board.setView({ orientation: this.orientation, mode: 'top', animate: false });
        this.syncBoard();
        this.refresh();
    }

    // --- Position --------------------------------------------------------------------------------

    /** The game to show: the live one, or a copy at the reviewed move. */
    shownGame() {
        if (this.reviewPly === null) return this.game;
        return this.rules.ChessGame.fromMoves(this.game.uciMoves().slice(0, this.reviewPly));
    }

    syncBoard() {
        if (!this.board) return;
        const game = this.shownGame();
        const last = game.lastMove();
        const status = game.status();
        this.board.setPosition(game.pieces(), {
            lastMove: last ? { from: last.from, to: last.to } : null,
            check: status.check ? game.kingSquare(game.turn()) : null,
            captured: game.capturedPieces()
        });
    }

    setOrientation(color, animate = true) {
        if (color !== 'w' && color !== 'b') return;
        const changed = this.orientation !== color;
        this.orientation = color;
        this.board?.setView({ orientation: color, animate });
        if (changed) this.refresh();
    }

    /** Shows a move made by either side, with its sound and announcement. */
    async showMove(move) {
        if (!move || this.disposed) return;
        this.board?.setHint?.(null);
        if (this.board && this.reviewPly === null) await this.board.animateMove(move);
        if (this.disposed) return;
        this.sounds?.forMove(move);
        this.announce(this.describeMove(move));
        this.syncBoard();
        this.refresh();
    }

    async handleUserMove({ from, to }) {
        if (!this.canUserMove() || this.reviewPly !== null) return;
        const candidates = this.game.moves({ square: from }).filter(move => move.to === to);
        if (!candidates.length) {
            this.syncBoard();
            return;
        }
        let promotion = null;
        if (candidates.some(move => move.promotion)) {
            promotion = await this.askPromotion();
            if (!promotion || this.disposed) {
                this.syncBoard();
                return;
            }
        }
        await this.submitMove({ from, to, promotion });
    }

    askPromotion() {
        const color = this.playerColor;
        const box = this.elements.promotion;
        box.innerHTML = `
            <h3 id="chessPromotionTitle">${escapeHtml(tc('game.promotion_title'))}</h3>
            <div class="chess-promotion__pieces">
                ${['q', 'r', 'b', 'n'].map(type => `<button class="chess-promotion__piece" type="button" data-promote="${type}">${pieceGlyph(type, color)}<span>${escapeHtml(tc(`pieces.${type}`))}</span></button>`).join('')}
            </div>
            <button class="btn btn-ghost btn-sm chess-promotion__cancel" type="button" data-promote="">${escapeHtml(tc('game.promotion_cancel'))}</button>`;
        box.hidden = false;
        box.querySelector('[data-promote="q"]')?.focus();
        return new Promise(resolve => {
            this.promotion = {
                resolve: type => {
                    box.hidden = true;
                    box.innerHTML = '';
                    this.promotion = null;
                    resolve(type);
                    this.board?.canvas?.focus?.({ preventScroll: true });
                }
            };
        });
    }

    // --- Events ------------------------------------------------------------------------------------

    onClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const promote = target.closest('[data-promote]');
        if (promote && this.promotion) {
            this.promotion.resolve(promote.dataset.promote || null);
            return;
        }
        const tool = target.closest('[data-tool]');
        if (tool) {
            this.useTool(tool.dataset.tool, tool);
            return;
        }
        const ply = target.closest('[data-ply]');
        if (ply) {
            this.review(Number(ply.dataset.ply));
            return;
        }
        const action = target.closest('[data-action]');
        if (action && !action.disabled) {
            if (action.dataset.action === 'live') {
                this.review(null);
                return;
            }
            if (action.dataset.action === 'show-result') {
                this.resultDismissed = false;
                this.refresh();
                return;
            }
            if (action.dataset.action === 'hide-result') {
                this.resultDismissed = true;
                this.refresh();
                return;
            }
            this.handleAction(action.dataset.action, action);
        }
    }

    useTool(name, button) {
        if (!this.board) return;
        if (name === 'flip') this.setOrientation(otherColor(this.orientation));
        else if (name === 'top') {
            const top = this.board.viewMode !== 'top';
            this.board.setView({ mode: top ? 'top' : '3d' });
            button.setAttribute('aria-pressed', String(top));
            this.options.onPrefs?.({ view: top ? 'top' : '3d' });
        } else if (name === 'zoom-in') this.board.zoomBy(0.9);
        else if (name === 'zoom-out') this.board.zoomBy(1.1);
        else if (name === 'reset') {
            this.setOrientation(this.playerColor || 'w');
            this.board.setView({ orientation: this.orientation, mode: '3d' });
            this.elements.toolbar.querySelector('[data-tool="top"]')?.setAttribute('aria-pressed', 'false');
            this.options.onPrefs?.({ view: '3d' });
        }
    }

    /** Arrow keys step through the moves while the list has focus. */
    onMovesKey(event) {
        const total = this.game.history().length;
        const current = this.reviewPly ?? total;
        let next = null;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, current - 1);
        else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(total, current + 1);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = total;
        if (next === null) return;
        event.preventDefault();
        this.review(next >= total ? null : next);
    }

    onDocumentKey(event) {
        if (event.key === 'Escape' && this.promotion) {
            event.preventDefault();
            this.promotion.resolve(null);
        }
    }

    review(ply) {
        const total = this.game.history().length;
        this.reviewPly = ply === null || ply >= total ? null : Math.max(0, ply);
        this.board?.clearSelection?.();
        this.syncBoard();
        this.refresh();
    }

    // --- Rendering ------------------------------------------------------------------------------------

    refresh() {
        if (this.disposed || !this.elements.status) return;
        this.options.onSubtitle?.(this.subtitle());
        this.renderPlayers();
        this.renderStatus();
        this.renderMoves();
        this.renderActions();
        this.renderStageCard();
        this.renderResult();
    }

    playerCardHtml(color) {
        const info = this.playerInfo(color);
        const taken = this.game.capturedPieces();
        const score = side => taken[side].reduce((sum, type) => sum + VALUES[type], 0);
        const lead = score(color) - score(otherColor(color));
        const captured = taken[color].slice().sort((a, b) => PIECE_ORDER[a] - PIECE_ORDER[b])
            .map(type => pieceGlyph(type, otherColor(color))).join('');
        const clock = this.hasClocks() && info.clockMs !== null && info.clockMs !== undefined
            ? `<span class="chess-clock ${info.clockRunning ? 'is-running' : ''} ${info.clockMs < LOW_TIME_MS ? 'is-low' : ''}" role="timer" aria-label="${escapeHtml(tc('game.clock_label', { time: formatClock(info.clockMs) }))}"><span class="chess-clock__icon">${ICONS.warning}</span>${escapeHtml(formatClock(info.clockMs))}</span>`
            : '';
        return `
            ${info.avatar}
            <span class="chess-player__copy">
                <span class="chess-player__name">${pieceGlyph('k', color)}<span>${escapeHtml(info.name)}</span></span>
                <span class="chess-player__meta">${escapeHtml(info.meta || '')}</span>
                <span class="chess-captured" aria-label="${escapeHtml(tc('game.captured_label'))}">${captured}${lead > 0 ? `<span class="chess-captured__score">+${lead}</span>` : ''}</span>
            </span>
            ${clock}`;
    }

    renderPlayers() {
        const bottomColor = this.orientation;
        const topColor = otherColor(bottomColor);
        const turn = this.game.status().over ? null : this.game.turn();
        // The clocks redraw these several times a second: touch the DOM only on a change.
        setHtml(this.elements.top, this.playerCardHtml(topColor));
        setHtml(this.elements.bottom, this.playerCardHtml(bottomColor));
        this.elements.top.classList.toggle('is-turn', turn === topColor);
        this.elements.bottom.classList.toggle('is-turn', turn === bottomColor);
    }

    renderStatus() {
        let info = this.statusInfo();
        if (this.reviewPly !== null) {
            info = {
                tone: 'review',
                icon: ICONS.eye,
                text: this.reviewPly === 0 ? tc('game.reviewing_start') : tc('game.reviewing', { move: Math.ceil(this.reviewPly / 2) })
            };
        }
        const box = this.elements.status;
        box.dataset.tone = info.tone || 'turn';
        // Unchanged markup is left alone, so a button in it keeps the press it is getting.
        setHtml(box, `<span class="chess-status__icon" aria-hidden="true">${info.icon || ''}</span><span class="chess-status__text">${escapeHtml(info.text || '')}</span>${this.reviewPly !== null
            ? `<button class="btn btn-secondary btn-sm chess-status__action" type="button" data-action="live">${escapeHtml(tc('game.back_to_live'))}</button>`
            : (info.actionHtml || '')}`);
    }

    renderMoves() {
        const history = this.game.history();
        const current = this.reviewPly ?? history.length;
        this.elements.moveCount.textContent = history.length ? String(Math.ceil(history.length / 2)) : '';
        if (!history.length) {
            this.elements.moves.innerHTML = `<li class="chess-moves__empty">${escapeHtml(tc('game.no_moves'))}</li>`;
            return;
        }
        let html = '';
        // A game from a position with Black to move would start with "1. …".
        for (let index = 0; index < history.length; index += 2) {
            const cell = ply => {
                const entry = history[ply - 1];
                if (!entry) return '<span></span>';
                const piece = entry.piece !== 'p' && !entry.castle ? pieceGlyph(entry.piece, entry.color) : '';
                const text = this.displaySan(entry.san);
                return `<button class="chess-move ${ply === current ? 'is-current' : ''}" type="button" data-ply="${ply}" aria-label="${escapeHtml(this.describeMove(entry))}"${ply === current ? ' aria-current="step"' : ''}>${piece}<span>${escapeHtml(text)}</span></button>`;
            };
            html += `<li><span class="chess-moves__number">${index / 2 + 1}.</span>${cell(index + 1)}${cell(index + 2)}</li>`;
        }
        const list = this.elements.moves;
        const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 24;
        list.innerHTML = html;
        if (this.reviewPly === null && atEnd) list.scrollTop = list.scrollHeight;
        else list.querySelector('.is-current')?.scrollIntoView?.({ block: 'nearest' });
    }

    /** SAN without the piece letter (the glyph shows the piece) and castling with zeros in Russian. */
    displaySan(san) {
        const text = san.replace(/^[KQRBN]/, '');
        return tc('notation.castle_zero') === 'yes' ? text.replace(/O-O-O/, '0-0-0').replace(/O-O/, '0-0') : text;
    }

    /** SAN with the piece letters of the interface language (Кр Ф Л С К in Russian), for plain text. */
    textSan(san) {
        const letters = tc('notation.letters').split(',');
        const index = 'KQRBN'.indexOf(san[0]);
        const lettered = index >= 0 && letters[index] ? letters[index] + san.slice(1) : san;
        return tc('notation.castle_zero') === 'yes' ? lettered.replace(/O-O-O/, '0-0-0').replace(/O-O/, '0-0') : lettered;
    }

    renderActions() {
        const actions = this.actions();
        this.elements.actions.innerHTML = actions.map(action => {
            const pending = action.pending || this.busy.has(action.action);
            return `<button class="btn btn-${action.kind || 'secondary'} ${pending ? 'btn--pending' : ''}" type="button" data-action="${escapeHtml(action.action)}" ${action.disabled || pending ? 'disabled' : ''} ${pending ? 'aria-busy="true"' : ''}${action.title ? ` title="${escapeHtml(action.title)}"` : ''}>${escapeHtml(action.label)}</button>`;
        }).join('');
        this.elements.actions.classList.toggle('is-single', actions.length === 1);
    }

    renderStageCard() {
        const html = this.stageCard();
        const card = this.elements.stageCard;
        if (!html) {
            card.hidden = true;
            setHtml(card, '');
            return;
        }
        setHtml(card, html);
        card.hidden = false;
    }

    renderResult() {
        const info = this.resultInfo();
        const box = this.elements.result;
        if (!info || this.resultDismissed || this.reviewPly !== null) {
            box.hidden = true;
            return;
        }
        const html = `
            <button class="chess-result__close" type="button" data-action="hide-result" aria-label="${escapeHtml(tc('game.result_hide'))}" title="${escapeHtml(tc('game.result_hide'))}">${ICONS.close}</button>
            <span class="chess-result__icon" aria-hidden="true">${info.icon || ICONS.trophy}</span>
            <h3 id="chessResultTitle">${escapeHtml(info.title)}</h3>
            <p>${escapeHtml(info.text || '')}</p>
            ${info.extra || ''}
            <div class="chess-result__actions">${(info.actions || []).map(action => {
                const pending = this.busy.has(action.action);
                return `<button class="btn btn-${action.kind || 'secondary'} ${pending ? 'btn--pending' : ''}" type="button" data-action="${escapeHtml(action.action)}" ${action.disabled || pending ? 'disabled' : ''}>${escapeHtml(action.label)}</button>`;
            }).join('')}</div>`;
        setHtml(box, html);
        box.hidden = false;
    }

    // --- Texts --------------------------------------------------------------------------------------

    describeMove(move) {
        const side = tc(`colors.${move.color}`);
        let text;
        if (move.castle) {
            text = tc(move.castle === 'k' ? 'announce.castle_short' : 'announce.castle_long');
        } else {
            text = tc(move.captured ? 'announce.capture' : 'announce.move', {
                piece: tc(`pieces.${move.piece}`),
                from: move.from,
                to: move.to,
                captured: move.captured ? tc(`pieces_accusative.${move.captured}`) : ''
            });
            if (move.promotion) text += `, ${tc('announce.promotion', { piece: tc(`pieces_accusative.${move.promotion}`) })}`;
        }
        if (move.mate) text += `, ${tc('announce.mate')}`;
        else if (move.check) text += `, ${tc('announce.check')}`;
        return `${side}: ${text}`;
    }

    announceSquare(square) {
        const piece = this.shownGame().get(square);
        const content = piece
            ? tc('announce.piece_of', { piece: tc(`pieces.${piece.type}`), side: tc(`colors_of.${piece.color}`) })
            : tc('announce.empty');
        this.announce(`${square}, ${content}`);
    }

    announce(text) {
        if (!this.elements.announce) return;
        this.elements.announce.textContent = '';
        // A fresh node change makes screen readers repeat an identical message.
        requestAnimationFrame(() => {
            if (this.elements.announce) this.elements.announce.textContent = text;
        });
    }

    /** Text for a finished game from the user's side ('w', 'b' or null when watching). */
    resultTexts(status, viewer) {
        const reason = status.reason;
        if (status.result === '1/2-1/2') {
            return { tone: 'draw', title: tc('result.draw'), text: tc(`reasons.${reason}`) };
        }
        const winner = status.result === '1-0' ? 'w' : 'b';
        const title = viewer ? tc(winner === viewer ? 'result.win' : 'result.loss') : tc(`result.winner_${winner}`);
        return { tone: viewer ? (winner === viewer ? 'win' : 'loss') : 'over', title, text: tc(`reasons.${reason}`) };
    }

    async runBusy(name, task) {
        if (this.busy.has(name)) return null;
        this.busy.add(name);
        this.refresh();
        try {
            return await task();
        } finally {
            this.busy.delete(name);
            if (!this.disposed) this.refresh();
        }
    }

    async confirm(kind) {
        const dialog = globalThis.ConfirmDialog;
        if (!dialog?.confirm) return true;
        return dialog.confirm({
            title: tc(`confirm.${kind}_title`),
            message: tc(`confirm.${kind}_text`),
            confirmLabel: tc(`confirm.${kind}`),
            cancelLabel: tc('confirm.keep_playing'),
            danger: true
        });
    }
}
