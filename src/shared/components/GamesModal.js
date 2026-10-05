import { WordGuessGame } from '../games/WordGuessGame.js';
import { RubiksCubeGame } from '../games/RubiksCubeGame.js';
import { AudioFx } from '../games/AudioFx.js';
import { TetrisGame } from '../games/TetrisGame.js';
import { SnakeGame } from '../games/SnakeGame.js';
import { Game2048 } from '../games/Game2048.js';
import { MovieQuizGame } from '../games/MovieQuizGame.js';
import { escapeHtml, plural, setupHiDpiCanvas, t } from '../games/gamesI18n.js';

// Re-exported so existing callers and tests keep importing games from here.
export { TetrisGame, SnakeGame, Game2048, MovieQuizGame, AudioFx };

/**
 * GamesModal Component
 * Mini-games launcher: owns the menu, tabs, shared stats sidebar, overlays, keyboard,
 * pointer gestures and lifecycle. Each game keeps its state and rendering in
 * src/shared/games/.
 */

const SVG_ICONS = {
    TETRIS: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="10" y2="12"></line><line x1="8" y1="10" x2="8" y2="14"></line><line x1="15" y1="13" x2="15.01" y2="13"></line><line x1="18" y1="11" x2="18.01" y2="11"></line><rect x="2" y="6" width="20" height="12" rx="6"></rect></svg>`,
    SNAKE: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H9a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3h8"></path><circle cx="18" cy="8" r="1.2" fill="currentColor"></circle></svg>`,
    GAME_2048: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>`,
    QUIZ: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.1 9a3 3 0 1 1 5.8 1c-.8 1.3-2.4 1.7-2.9 3"></path><path d="M12 17h.01"></path><circle cx="12" cy="12" r="9"></circle></svg>`,
    WORD_GUESS: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M7 9h.01M11 9h.01M15 9h.01M7 13h.01M11 13h.01M15 13h.01"></path><path d="M7 17h10"></path></svg>`,
    RUBIKS: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"></path><path d="M12 12 4 7.5M12 12l8-4.5M12 12v9"></path></svg>`,
    VOLUME_HIGH: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`,
    VOLUME_MUTE: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,
    CLOSE: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
};

const GAMES = [
    { id: 'tetris', icon: SVG_ICONS.TETRIS, tabId: 'tabTetris' },
    { id: 'snake', icon: SVG_ICONS.SNAKE, tabId: 'tabSnake' },
    { id: '2048', icon: SVG_ICONS.GAME_2048, tabId: 'tab2048' },
    { id: 'quiz', icon: SVG_ICONS.QUIZ, tabId: 'tabQuiz' },
    { id: 'word-guess', icon: SVG_ICONS.WORD_GUESS, tabId: 'tabWordGuess' },
    { id: 'rubiks', icon: SVG_ICONS.RUBIKS, tabId: 'tabRubiks' }
];
const GAME_IDS = GAMES.map(game => game.id);
// Canvas games: sizes are logical CSS pixels; the backing store follows devicePixelRatio.
const CANVAS_SIZES = { tetris: [240, 480], snake: [320, 320], '2048': [320, 320] };
const PREVIEW_SIZE = 80;
const SWIPE_THRESHOLD_PX = 24;
const DOUBLE_TURN_PREFIX_MS = 1500;

const gameKey = id => (id === '2048' ? 'game_2048' : id.replace('-', '_'));

export class GamesModal {
    static instance = null;

    static getInstance() {
        if (!GamesModal.instance) {
            GamesModal.instance = new GamesModal();
        }
        return GamesModal.instance;
    }

    constructor() {
        this.overlay = null;
        this.activeGame = null; // 'tetris' | 'snake' | '2048' | 'quiz' | 'word-guess' | 'rubiks'
        this.game = null;
        this.audio = new AudioFx();
        this.keyHandler = this.handleKeyDown.bind(this);
        this.keyUpHandler = this.handleKeyUp.bind(this);
        this.blurHandler = () => this.pauseIfRunning();
        this.visibilityHandler = () => {
            if (document.visibilityState === 'hidden') this.pauseIfRunning();
        };
        this.previouslyFocused = null;
        this.pausedForConfirm = false;
        this.focusBeforeConfirm = null;
        this.swipe = null;
        this.doubleTurnPendingAt = 0;
    }

    ensureStylesLoaded() {
        if (!document.getElementById('gamesModalStyles')) {
            const link = document.createElement('link');
            link.id = 'gamesModalStyles';
            link.rel = 'stylesheet';
            link.href = chrome.runtime.getURL('src/shared/styles/GamesModal.css');
            document.head.appendChild(link);
        }
    }

    createDOM() {
        this.ensureStylesLoaded();
        if (document.getElementById('gamesModalOverlay')) {
            this.overlay = document.getElementById('gamesModalOverlay');
            return;
        }

        const tabs = GAMES.map((game, index) => `
                            <button class="game-tab-btn ${game.id === '2048' ? 'game-2048-tab' : ''}" id="${game.tabId}" data-game="${game.id}" role="tab" aria-selected="${index === 0}">
                                ${game.icon}
                                <span>${escapeHtml(t(`menu.${gameKey(game.id)}.tab`))}</span>
                            </button>`).join('');
        const cards = GAMES.map(game => `
                            <button class="game-menu-card game-menu-card--${game.id}" type="button" role="menuitem" data-game="${game.id}">
                                <span class="game-menu-icon">${game.icon}</span>
                                <span class="game-menu-card-copy"><strong>${escapeHtml(t(`menu.${gameKey(game.id)}.title`))}</strong><small>${escapeHtml(t(`menu.${gameKey(game.id)}.subtitle`))}</small></span>
                                <span class="game-menu-arrow" aria-hidden="true">→</span>
                            </button>`).join('');

        const modalHTML = `
            <div class="games-modal-overlay" id="gamesModalOverlay" role="presentation">
                <section class="games-modal-container" role="dialog" aria-modal="true" aria-labelledby="gamesModalTitle" tabindex="-1">
                    <div class="games-modal-header">
                        <div class="games-heading"><span class="games-eyebrow">${escapeHtml(t('modal.eyebrow'))}</span><h2 id="gamesModalTitle">${escapeHtml(t('modal.title'))}</h2></div>
                        <div class="games-tab-bar" role="tablist" aria-label="${escapeHtml(t('modal.tabs_label'))}">${tabs}
                        </div>
                        <div class="games-modal-controls">
                            <button class="games-icon-btn" id="gamesMuteBtn" type="button" aria-label="${escapeHtml(t('modal.mute'))}" title="${escapeHtml(t('modal.mute'))}">
                                ${SVG_ICONS.VOLUME_HIGH}
                            </button>
                            <button class="games-icon-btn games-close-btn" id="gamesCloseBtn" type="button" aria-label="${escapeHtml(t('modal.close'))}" title="${escapeHtml(t('modal.close'))}">
                                ${SVG_ICONS.CLOSE}
                            </button>
                        </div>
                    </div>
                    <div class="games-menu" id="gamesMenu" role="menu" aria-label="${escapeHtml(t('modal.menu_label'))}">
                        <div class="games-menu-copy">
                            <span class="games-menu-eyebrow">${escapeHtml(t('modal.menu_eyebrow'))}</span>
                            <h3>${escapeHtml(t('modal.menu_title'))}</h3>
                            <p>${escapeHtml(t('modal.menu_text'))}</p>
                        </div>
                        <div class="games-menu-grid">${cards}
                        </div>
                    </div>
                    <div class="games-play-view" id="gamesPlayView" hidden>
                        <button class="games-back-btn" id="gamesBackBtn" type="button">← ${escapeHtml(t('modal.back'))}</button>
                        <div class="games-modal-body">
                            <div class="movie-quiz" id="movieQuiz" aria-live="polite"></div>
                            <div class="word-guess-game" id="wordGuessGame" aria-live="polite"></div>
                            <div class="game-canvas-wrapper" id="gameCanvasWrapper">
                                <canvas id="gameCanvas" width="240" height="480"></canvas>
                                <div class="rubiks-cube-game" id="rubiksCubeGame" aria-live="polite"></div>
                                <div class="game-overlay" id="gameOverlay" style="display: none;">
                                    <h3 class="game-overlay-title" id="gameOverlayTitle"></h3>
                                    <p class="game-overlay-score" id="gameOverlayScore"></p>
                                    <div class="game-overlay-actions">
                                        <button class="game-btn-primary" id="gameContinueBtn" type="button" hidden>${escapeHtml(t('modal.continue'))}</button>
                                        <button class="game-btn-primary" id="gameRestartBtn" type="button">${escapeHtml(t('modal.play_again'))}</button>
                                    </div>
                                </div>
                            </div>

                            <div class="game-sidebar">
                                <div class="game-card" id="gamePreviewCard">
                                    <span class="game-card-label" id="gameNextLabel">${escapeHtml(t('sidebar.next_piece'))}</span>
                                    <div class="game-next-wrapper">
                                        <canvas id="gameNextCanvas" width="80" height="80"></canvas>
                                    </div>
                                </div>
                                <div class="game-card" id="gameHoldCard">
                                    <span class="game-card-label">${escapeHtml(t('sidebar.hold'))}</span>
                                    <div class="game-next-wrapper">
                                        <canvas id="gameHoldCanvas" width="80" height="80"></canvas>
                                    </div>
                                </div>
                                <div class="game-card" id="gameScoreCard">
                                    <span class="game-card-label" id="gameScoreLabel">${escapeHtml(t('sidebar.score'))}</span>
                                    <span class="game-card-value" id="gameScoreVal">0</span>
                                </div>
                                <div class="game-card" id="gameHighScoreCard">
                                    <span class="game-card-label" id="gameHighScoreLabel">${escapeHtml(t('sidebar.record'))}</span>
                                    <span class="game-card-value" id="gameHighScoreVal">0</span>
                                </div>
                                <div class="game-card" id="gameSubStatCard">
                                    <span class="game-card-label" id="gameSubStatLabel">${escapeHtml(t('sidebar.level_lines'))}</span>
                                    <span class="game-card-value" id="gameSubStatVal">1 / 0</span>
                                </div>
                                <div class="game-controls-guide" id="gameControlsGuide"></div>
                            </div>
                        </div>
                    </div>
                    <div class="games-close-confirm" id="gamesCloseConfirm" role="alertdialog" aria-modal="true" aria-labelledby="gamesCloseConfirmTitle" aria-describedby="gamesCloseConfirmText" hidden>
                        <div class="games-close-confirm-card">
                            <h3 id="gamesCloseConfirmTitle">${escapeHtml(t('confirm.title'))}</h3>
                            <p id="gamesCloseConfirmText">${escapeHtml(t('confirm.text'))}</p>
                            <div class="games-close-confirm-actions">
                                <button class="games-confirm-btn" id="gamesCloseCancelBtn" type="button">${escapeHtml(t('confirm.cancel'))}</button>
                                <button class="games-confirm-btn games-confirm-btn--danger" id="gamesCloseConfirmBtn" type="button">${escapeHtml(t('confirm.confirm'))}</button>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.overlay = document.getElementById('gamesModalOverlay');
        this.attachEvents();
    }

    attachEvents() {
        document.getElementById('gamesCloseBtn')?.addEventListener('click', () => this.close());

        const muteBtn = document.getElementById('gamesMuteBtn');
        muteBtn?.addEventListener('click', () => {
            this.audio.setMuted(!this.audio.muted);
            muteBtn.innerHTML = this.audio.muted ? SVG_ICONS.VOLUME_MUTE : SVG_ICONS.VOLUME_HIGH;
        });

        document.getElementById('gameRestartBtn')?.addEventListener('click', () => this.startNewGame());
        document.getElementById('gameContinueBtn')?.addEventListener('click', () => this.continueAfterWin());
        document.getElementById('gamesCloseCancelBtn')?.addEventListener('click', () => this.hideCloseConfirm());
        document.getElementById('gamesCloseConfirmBtn')?.addEventListener('click', () => this.close());

        this.overlay.querySelectorAll('.game-menu-card, .game-tab-btn').forEach(button => {
            button.addEventListener('click', () => this.switchGame(button.dataset.game));
        });

        document.getElementById('gamesBackBtn')?.addEventListener('click', () => this.showGameMenu());

        this.overlay.addEventListener('mousedown', (e) => {
            if (e.target === this.overlay) {
                this.requestClose();
            }
        });

        this.bindSwipeControls(document.getElementById('gameCanvasWrapper'));
    }

    /** Swipes (touch or mouse drag) control the canvas games; a tap rotates in Tetris. */
    bindSwipeControls(wrapper) {
        if (!wrapper) return;
        wrapper.addEventListener('pointerdown', (event) => {
            if (!CANVAS_SIZES[this.activeGame] || !this.game) return;
            if (event.target.closest?.('#gameOverlay')) return;
            if (event.button !== undefined && event.button !== 0) return;
            this.swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
            wrapper.setPointerCapture?.(event.pointerId);
        });
        const finish = (event) => {
            const swipe = this.swipe;
            if (!swipe || swipe.id !== event.pointerId) return;
            this.swipe = null;
            wrapper.releasePointerCapture?.(event.pointerId);
            if (event.type === 'pointercancel') return;
            this.handleSwipe(event.clientX - swipe.x, event.clientY - swipe.y);
        };
        wrapper.addEventListener('pointerup', finish);
        wrapper.addEventListener('pointercancel', finish);
    }

    handleSwipe(dx, dy) {
        const game = this.game;
        if (!game || game.isPaused || game.isGameOver || game.awaitingContinue) return;
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (distance < SWIPE_THRESHOLD_PX) {
            if (this.activeGame === 'tetris') game.rotate(1);
            return;
        }
        const stepX = Math.sign(dx);
        const stepY = Math.sign(dy);
        if (this.activeGame === 'tetris') {
            if (horizontal) {
                const steps = Math.max(1, Math.round(Math.abs(dx) / SWIPE_THRESHOLD_PX));
                for (let i = 0; i < steps; i += 1) game.shift(stepX);
            } else if (stepY > 0) {
                game.hardDrop();
            } else {
                game.hold();
            }
        } else if (this.activeGame === 'snake') {
            if (horizontal) game.setDirection(stepX, 0);
            else game.setDirection(0, stepY);
        } else if (this.activeGame === '2048') {
            if (horizontal) game.move(stepX, 0);
            else game.move(0, stepY);
        }
    }

    /** Auto-pause for real-time games when the window loses focus or the tab hides. */
    pauseIfRunning() {
        const game = this.game;
        if (!game || !['tetris', 'snake'].includes(this.activeGame)) return;
        if (game.isPaused || game.isGameOver) return;
        game.setBoost?.(false);
        game.togglePause();
    }

    /**
     * True when closing would discard a running round. Word Guess persists its
     * daily progress, so it never needs a confirmation.
     */
    hasUnsavedProgress() {
        const game = this.game;
        if (!game) return false;
        switch (this.activeGame) {
            case 'tetris':
            case 'snake':
            case '2048':
                return !game.isGameOver && game.score > 0;
            case 'rubiks':
                return !game.finished && game.moves > 0;
            case 'quiz':
                return !game.stopped && game.round > 0 && game.round < MovieQuizGame.ROUNDS;
            default:
                return false;
        }
    }

    isCloseConfirmOpen() {
        const confirm = document.getElementById('gamesCloseConfirm');
        return Boolean(confirm && !confirm.hidden);
    }

    /** Accidental exits (Escape, backdrop click) ask before discarding a round. */
    requestClose() {
        if (this.isCloseConfirmOpen()) return;
        if (!this.hasUnsavedProgress()) {
            this.close();
            return;
        }
        this.showCloseConfirm();
    }

    showCloseConfirm() {
        const confirm = document.getElementById('gamesCloseConfirm');
        if (!confirm) {
            this.close();
            return;
        }
        this.game?.setBoost?.(false);
        this.pausedForConfirm = false;
        if (CANVAS_SIZES[this.activeGame] && this.game && !this.game.isPaused) {
            this.game.togglePause();
            this.pausedForConfirm = Boolean(this.game.isPaused);
        }
        this.focusBeforeConfirm = document.activeElement;
        confirm.hidden = false;
        document.getElementById('gamesCloseCancelBtn')?.focus({ preventScroll: true });
    }

    hideCloseConfirm({ resume = true } = {}) {
        const confirm = document.getElementById('gamesCloseConfirm');
        if (!confirm || confirm.hidden) return;
        confirm.hidden = true;
        if (resume && this.pausedForConfirm && this.game?.isPaused) {
            this.game.togglePause();
        }
        this.pausedForConfirm = false;
        if (resume) {
            const target = this.focusBeforeConfirm?.isConnected
                ? this.focusBeforeConfirm
                : document.querySelector('.games-modal-container');
            target?.focus?.({ preventScroll: true });
        }
        this.focusBeforeConfirm = null;
    }

    /** Visible, enabled controls inside the modal (or inside the open confirmation). */
    getFocusableElements() {
        const scope = this.isCloseConfirmOpen()
            ? document.getElementById('gamesCloseConfirm')
            : this.overlay;
        const selector = [
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            'a[href]',
            'summary',
            '[tabindex]:not([tabindex="-1"])'
        ].join(', ');
        return [...scope.querySelectorAll(selector)].filter(element => (
            !element.closest('[hidden]') && element.getClientRects().length > 0
        ));
    }

    switchGame(gameType) {
        if (!GAME_IDS.includes(gameType)) return;
        if (this.activeGame === gameType && this.game) return;
        this.activeGame = gameType;

        const wrapper = document.getElementById('gameCanvasWrapper');
        const container = document.querySelector('.games-modal-container');
        const menu = document.getElementById('gamesMenu');
        const playView = document.getElementById('gamesPlayView');

        if (menu) menu.hidden = true;
        if (playView) playView.hidden = false;
        container?.classList.remove('menu-mode');

        this.overlay.querySelectorAll('.game-tab-btn').forEach(tab => {
            const isActive = tab.dataset.game === gameType;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
        });
        if (wrapper) wrapper.className = `game-canvas-wrapper ${this.getGameModeClass(gameType)}`;
        if (container) {
            container.classList.toggle('tetris-game', gameType === 'tetris');
            container.classList.toggle('square-game', gameType === 'snake' || gameType === '2048');
            container.classList.toggle('quiz-game', gameType === 'quiz');
            container.classList.toggle('word-guess-game-mode', gameType === 'word-guess');
            container.classList.toggle('rubiks-game-mode', gameType === 'rubiks');
        }

        this.updateSidebarLabels();
        this.startNewGame();
    }

    showGameMenu() {
        if (this.game) {
            this.game.stop();
            this.game = null;
        }
        this.activeGame = null;

        const menu = document.getElementById('gamesMenu');
        const playView = document.getElementById('gamesPlayView');
        const container = document.querySelector('.games-modal-container');

        if (menu) menu.hidden = false;
        if (playView) playView.hidden = true;
        container?.classList.add('menu-mode');
        container?.classList.remove('tetris-game', 'square-game', 'quiz-game', 'word-guess-game-mode', 'rubiks-game-mode');
        this.overlay.querySelectorAll('.game-tab-btn').forEach(tab => {
            tab.classList.remove('active');
            tab.setAttribute('aria-selected', 'false');
        });
    }

    controlRows(rows) {
        return rows.map(([label, key]) => `<div class="game-control-row"><span>${escapeHtml(t(label))}</span> <span class="game-key">${escapeHtml(t(key))}</span></div>`).join('');
    }

    updateSidebarLabels() {
        const setText = (id, key) => {
            const element = document.getElementById(id);
            if (element) element.textContent = t(key);
        };
        const toggleCard = (id, visible) => document.getElementById(id)?.classList.toggle('is-hidden', !visible);
        const guide = document.getElementById('gameControlsGuide');
        const game = this.activeGame;

        toggleCard('gamePreviewCard', game === 'tetris');
        toggleCard('gameHoldCard', game === 'tetris');
        // Word Guess shows attempts and best rank in its own panel; the sidebar adds hints only.
        toggleCard('gameScoreCard', game !== 'word-guess');
        toggleCard('gameSubStatCard', game !== 'word-guess');
        setText('gameScoreLabel', game === 'rubiks' ? 'sidebar.moves' : 'sidebar.score');
        setText('gameHighScoreLabel', game === 'word-guess' ? 'sidebar.hints' : 'sidebar.record');
        setText('gameSubStatLabel', {
            tetris: 'sidebar.level_lines',
            snake: 'sidebar.level_apples',
            '2048': 'sidebar.best_tile',
            quiz: 'sidebar.round',
            rubiks: 'sidebar.time'
        }[game] || 'sidebar.level_lines');

        if (!guide) return;
        const rows = {
            tetris: [
                ['controls.move', 'controls.keys_left_right'],
                ['controls.rotate', 'controls.keys_rotate'],
                ['controls.soft_drop', 'controls.keys_down'],
                ['controls.hard_drop', 'controls.keys_space'],
                ['controls.hold', 'controls.keys_hold'],
                ['controls.pause', 'controls.keys_pause'],
                ['controls.touch', 'controls.touch_tetris']
            ],
            snake: [
                ['controls.move', 'controls.keys_wasd'],
                ['controls.boost', 'controls.keys_hold_space'],
                ['controls.pause', 'controls.keys_pause'],
                ['controls.touch', 'controls.touch_swipe']
            ],
            '2048': [
                ['controls.move', 'controls.keys_wasd'],
                ['controls.pause', 'controls.keys_pause'],
                ['controls.touch', 'controls.touch_swipe']
            ],
            quiz: [
                ['controls.answer', 'controls.keys_1_4'],
                ['controls.series', 'controls.five_questions']
            ],
            'word-guess': [
                ['controls.input', 'controls.keys_word_enter'],
                ['controls.goal', 'controls.rank_one']
            ],
            rubiks: [
                ['controls.view', 'controls.keys_drag'],
                ['controls.turn', 'controls.keys_turn_buttons'],
                ['controls.double', 'controls.keys_double'],
                ['controls.undo', 'controls.keys_undo']
            ]
        }[game] || [];
        guide.innerHTML = this.controlRows(rows);
    }

    getGameModeClass(gameType = this.activeGame) {
        return gameType === '2048' ? 'game-2048-mode' : `${gameType}-mode`;
    }

    isGameRunning() {
        const game = this.game;
        return Boolean(game && !game.isPaused && !game.isGameOver && !game.awaitingContinue);
    }

    handleKeyDown(e) {
        if (!this.overlay || !this.overlay.classList.contains('active')) return;
        if (e.key === 'Tab') {
            const focusable = this.getFocusableElements();
            if (!focusable.length) {
                e.preventDefault();
                return;
            }
            const currentIndex = focusable.indexOf(document.activeElement);
            const nextIndex = e.shiftKey
                ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
                : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
            e.preventDefault();
            focusable[nextIndex]?.focus();
            return;
        }
        if (this.isCloseConfirmOpen()) {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.hideCloseConfirm();
            }
            return;
        }
        if (e.key === 'Escape') {
            this.requestClose();
            return;
        }
        if (!this.game || e.altKey || e.metaKey) return;
        if (this.activeGame === 'word-guess') return;

        if (this.activeGame === 'quiz') {
            const digit = e.key.match(/^[1-4]$/)?.[0] || e.code?.match(/^Numpad([1-4])$/)?.[1];
            if (digit) document.querySelector(`#movieQuiz .quiz-option:nth-child(${digit})`)?.click();
            return;
        }

        if (this.activeGame === 'rubiks') {
            this.handleRubiksKey(e);
            return;
        }

        const action = this.getCanvasAction(e);
        if (!action) return;
        // Pause works on a paused game; every other key only acts while the round runs,
        // so Space or Enter still reach the overlay buttons after game over.
        if (action === 'pause') {
            e.preventDefault();
            this.game.togglePause();
            return;
        }
        if (!this.isGameRunning()) return;
        e.preventDefault();
        this.runCanvasAction(action);
    }

    /** Maps a key to a game action using physical key codes so any layout works. */
    getCanvasAction(e) {
        const code = e.code || '';
        const key = e.key;
        if (code === 'KeyP') return 'pause';
        if (key === 'ArrowLeft' || code === 'KeyA') return 'left';
        if (key === 'ArrowRight' || code === 'KeyD') return 'right';
        if (key === 'ArrowDown' || code === 'KeyS') return 'down';
        if (key === 'ArrowUp' || code === 'KeyW') return 'up';
        if (key === ' ' || code === 'Space') return 'space';
        if (this.activeGame === 'tetris') {
            if (code === 'KeyX') return 'up';
            if (code === 'KeyZ' || key === 'Control') return 'rotate-ccw';
            if (code === 'KeyC' || key === 'Shift') return 'hold';
        }
        return null;
    }

    runCanvasAction(action) {
        const game = this.game;
        if (this.activeGame === 'tetris') {
            if (action === 'left') game.moveLeft();
            else if (action === 'right') game.moveRight();
            else if (action === 'up') game.rotate(1);
            else if (action === 'rotate-ccw') game.rotate(-1);
            else if (action === 'down') game.softDrop();
            else if (action === 'space') game.hardDrop();
            else if (action === 'hold') game.hold();
        } else if (this.activeGame === 'snake') {
            const directions = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
            if (directions[action]) game.setDirection(...directions[action]);
            else if (action === 'space') game.setBoost(true);
        } else if (this.activeGame === '2048') {
            const directions = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
            if (directions[action]) game.move(...directions[action]);
        }
    }

    handleRubiksKey(e) {
        if (e.ctrlKey && e.code !== 'KeyZ') return;
        if (e.code === 'KeyZ') {
            e.preventDefault();
            this.game.undo();
            return;
        }
        if (e.key === '2' || e.code === 'Digit2' || e.code === 'Numpad2') {
            // "2" followed by a face letter makes a double turn.
            this.doubleTurnPendingAt = Date.now();
            return;
        }
        const face = e.code?.match(/^Key([URFDLB])$/)?.[1];
        if (!face) return;
        e.preventDefault();
        const isDouble = Date.now() - this.doubleTurnPendingAt < DOUBLE_TURN_PREFIX_MS;
        this.doubleTurnPendingAt = 0;
        const suffix = isDouble ? '2' : e.shiftKey ? "'" : '';
        this.game.turn(`${face}${suffix}`);
    }

    handleKeyUp(e) {
        if (this.activeGame === 'snake' && this.game && (e.key === ' ' || e.code === 'Space')) {
            this.game.setBoost(false);
        }
    }

    open() {
        this.createDOM();
        this.audio.init();

        const muteBtn = document.getElementById('gamesMuteBtn');
        if (muteBtn) {
            muteBtn.innerHTML = this.audio.muted ? SVG_ICONS.VOLUME_MUTE : SVG_ICONS.VOLUME_HIGH;
        }

        this.previouslyFocused = document.activeElement;
        this.overlay.classList.add('active');
        document.addEventListener('keydown', this.keyHandler);
        document.addEventListener('keyup', this.keyUpHandler);
        window.addEventListener('blur', this.blurHandler);
        document.addEventListener('visibilitychange', this.visibilityHandler);

        this.showGameMenu();
        document.querySelector('.games-modal-container')?.focus();
    }

    setupCanvases() {
        const size = CANVAS_SIZES[this.activeGame];
        if (!size) return;
        setupHiDpiCanvas(document.getElementById('gameCanvas'), size[0], size[1]);
        setupHiDpiCanvas(document.getElementById('gameNextCanvas'), PREVIEW_SIZE, PREVIEW_SIZE);
        setupHiDpiCanvas(document.getElementById('gameHoldCanvas'), PREVIEW_SIZE, PREVIEW_SIZE);
    }

    showOverlay({ title, titleClass = '', message, showContinue = false, showRestart = true }) {
        const overlay = document.getElementById('gameOverlay');
        const titleElement = document.getElementById('gameOverlayTitle');
        const messageElement = document.getElementById('gameOverlayScore');
        const continueButton = document.getElementById('gameContinueBtn');
        const restartButton = document.getElementById('gameRestartBtn');
        if (!overlay || !titleElement || !messageElement) return;
        titleElement.textContent = title;
        titleElement.className = `game-overlay-title ${titleClass}`.trim();
        messageElement.textContent = message;
        if (continueButton) continueButton.hidden = !showContinue;
        if (restartButton) restartButton.hidden = !showRestart;
        overlay.style.display = 'flex';
        (showContinue ? continueButton : showRestart ? restartButton : null)?.focus({ preventScroll: true });
    }

    hideOverlay() {
        const overlay = document.getElementById('gameOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    continueAfterWin() {
        this.game?.continueAfterWin?.();
        this.hideOverlay();
        document.querySelector('.games-modal-container')?.focus({ preventScroll: true });
    }

    startNewGame() {
        if (!this.activeGame) return;
        this.hideOverlay();

        if (this.game) {
            this.game.stop();
        }

        const canvas = document.getElementById('gameCanvas');
        const nextCanvas = document.getElementById('gameNextCanvas');
        const holdCanvas = document.getElementById('gameHoldCanvas');
        const wrapper = document.getElementById('gameCanvasWrapper');
        this.setupCanvases();
        if (wrapper) {
            wrapper.className = `game-canvas-wrapper ${this.getGameModeClass()}`;
        }

        const scoreEl = document.getElementById('gameScoreVal');
        const highScoreEl = document.getElementById('gameHighScoreVal');
        const subStatEl = document.getElementById('gameSubStatVal');

        const callbacks = {
            onStatsUpdate: (stats) => {
                if (stats.score !== undefined && scoreEl) scoreEl.textContent = stats.score;
                if (stats.highScore !== undefined && highScoreEl) highScoreEl.textContent = stats.highScore;
                if (!subStatEl) return;
                if (this.activeGame === '2048') subStatEl.textContent = String(stats.level || 0);
                else if (this.activeGame === 'rubiks') subStatEl.textContent = stats.time || '0:00';
                else if (this.activeGame !== 'word-guess') subStatEl.textContent = `${stats.level || 1} / ${stats.lines || 0}`;
            },
            onGameOver: (finalScore, { won = false } = {}) => {
                this.showOverlay({
                    title: won ? t('overlay.victory') : t('overlay.game_over'),
                    titleClass: won ? 'is-victory' : '',
                    message: t('overlay.final_score', { score: finalScore })
                });
            },
            onWin: (score) => {
                this.showOverlay({
                    title: t('overlay.win_2048'),
                    titleClass: 'is-victory',
                    message: t('overlay.win_2048_text', { score }),
                    showContinue: true
                });
            },
            onPauseToggle: (isPaused) => {
                if (isPaused) {
                    this.showOverlay({
                        title: t('overlay.paused'),
                        titleClass: 'pause-title',
                        message: t('overlay.paused_text'),
                        showRestart: false
                    });
                } else {
                    this.hideOverlay();
                }
            },
            onRestart: () => this.hideOverlay(),
            onSolved: ({ moves, time }) => {
                this.showOverlay({
                    title: t('overlay.cube_solved'),
                    titleClass: 'is-victory',
                    message: t('overlay.cube_solved_text', {
                        moves,
                        moves_word: plural(moves, 'rubiks.move_forms'),
                        time: `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`
                    })
                });
            }
        };

        if (this.activeGame === 'tetris') {
            this.game = new TetrisGame(canvas, nextCanvas, callbacks, this.audio, holdCanvas);
        } else if (this.activeGame === 'snake') {
            this.game = new SnakeGame(canvas, nextCanvas, callbacks, this.audio);
        } else if (this.activeGame === 'quiz') {
            this.game = new MovieQuizGame(callbacks, this.audio);
        } else if (this.activeGame === 'word-guess') {
            this.game = new WordGuessGame(callbacks, {
                container: document.getElementById('wordGuessGame')
            });
        } else if (this.activeGame === 'rubiks') {
            this.game = new RubiksCubeGame({
                container: document.getElementById('rubiksCubeGame'),
                callbacks,
                audio: this.audio
            });
        } else {
            this.game = new Game2048(canvas, callbacks, this.audio);
        }

        this.game.start();
        this.game.render();
    }

    close() {
        this.hideCloseConfirm({ resume: false });
        if (this.overlay) {
            this.overlay.classList.remove('active');
        }
        document.removeEventListener('keydown', this.keyHandler);
        document.removeEventListener('keyup', this.keyUpHandler);
        window.removeEventListener('blur', this.blurHandler);
        document.removeEventListener('visibilitychange', this.visibilityHandler);
        if (this.game) {
            this.game.stop();
            this.game = null;
        }
        this.activeGame = null;
        this.previouslyFocused?.focus?.();
    }
}
