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
    TETRIS: `<svg data-icon="BLOCKS" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M3.8 5H6.2A0.8 0.8 0 0 1 7 5.8V8.2A0.8 0.8 0 0 1 6.2 9H3.8A0.8 0.8 0 0 1 3 8.2V5.8A0.8 0.8 0 0 1 3.8 5ZM8.8 5H11.2A0.8 0.8 0 0 1 12 5.8V8.2A0.8 0.8 0 0 1 11.2 9H8.8A0.8 0.8 0 0 1 8 8.2V5.8A0.8 0.8 0 0 1 8.8 5ZM13.8 5H16.2A0.8 0.8 0 0 1 17 5.8V8.2A0.8 0.8 0 0 1 16.2 9H13.8A0.8 0.8 0 0 1 13 8.2V5.8A0.8 0.8 0 0 1 13.8 5ZM8.8 10H11.2A0.8 0.8 0 0 1 12 10.8V13.2A0.8 0.8 0 0 1 11.2 14H8.8A0.8 0.8 0 0 1 8 13.2V10.8A0.8 0.8 0 0 1 8.8 10Z"/></svg>`,
    SNAKE: `<svg data-icon="SNAKE" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 17H11.4A3.4 3.4 0 0 0 11.4 10.2H8A3.1 3.1 0 0 1 8 4H12"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M13 2H16A2 2 0 0 1 18 4V4A2 2 0 0 1 16 6H13A2 2 0 0 1 11 4V4A2 2 0 0 1 13 2ZM15.4 3.2A0.8 0.8 0 1 0 15.4 4.8A0.8 0.8 0 1 0 15.4 3.2Z"/></svg>`,
    GAME_2048: `<svg data-icon="GAME_2048" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7.6 8A2.4 2.4 0 1 1 11.8 9.6L7.6 13.4H12.6"/></svg>`,
    QUIZ: `<svg data-icon="QUESTION" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M7.8 7.9A2.2 2.2 0 1 1 10.9 9.9C10.3 10.2 10 10.5 10 11.2"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 12.6A1.2 1.2 0 1 0 10 15A1.2 1.2 0 1 0 10 12.6Z"/></svg>`,
    WORD_GUESS: `<svg data-icon="WORDS" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M6 2H14A4 4 0 0 1 18 6V14A4 4 0 0 1 14 18H6A4 4 0 0 1 2 14V6A4 4 0 0 1 6 2ZM10 4.8L14.6 15H12.3L11.4 12.9H8.6L7.7 15H5.4ZM9.4 11H10.6L10 9.5Z"/></svg>`,
    RUBIKS: `<svg data-icon="RUBIK" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 2.6L17 6.4V13.8L10 17.6L3 13.8V6.4ZM3 6.4L10 10.2L17 6.4M10 10.2V17.6"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 10.2L17 6.4V13.8L10 17.6Z"/></svg>`,
    BATTLESHIP: `<svg data-icon="SHIP" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2.6 12H17.4A.8 .8 0 0 1 18.1 13.1L16.4 16.4A3 3 0 0 1 13.8 18H6.2A3 3 0 0 1 3.6 16.4L1.9 13.1A.8 .8 0 0 1 2.6 12Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 11V9H14V11M9 9V3H13"/></svg>`,
    CHESS: `<svg data-icon="KNIGHT" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M6 15C6 12.4 7.4 11 8.8 9.8L6.6 10.8A1 1 0 0 1 5.6 10.7L4.2 9.7A1 1 0 0 1 3.9 8.4L6.2 4.6L7.8 4V2.4A.6 .6 0 0 1 8.7 1.9L10.8 3.4C14.2 4 16 7.4 15.6 11.4C15.5 12.8 15 14 14.4 15ZM8.6 5.7A0.9 0.9 0 1 0 8.6 7.5A0.9 0.9 0 1 0 8.6 5.7Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 16H15A1 1 0 0 1 16 17V17A1 1 0 0 1 15 18H5A1 1 0 0 1 4 17V17A1 1 0 0 1 5 16Z"/></svg>`,
    ZALP: `<svg data-icon="CANNON" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M6 8.2L12.6 2.7A1 1 0 0 1 14 2.9L16.7 6.1A1 1 0 0 1 16.5 7.5L11 12.1A5 5 0 0 0 6 8.2Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 11A3 3 0 1 0 6 17A3 3 0 1 0 6 11Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 17H17"/></svg>`,
    VOLUME_HIGH: `<svg data-icon="VOLUME_HIGH" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2 8A1 1 0 0 1 3 7H5.4L9.3 3.4A1 1 0 0 1 11 4.1V15.9A1 1 0 0 1 9.3 16.6L5.4 13H3A1 1 0 0 1 2 12Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.6 7.4A3.8 3.8 0 0 1 13.6 12.6M15.8 4.6A7.6 7.6 0 0 1 15.8 15.4"/></svg>`,
    VOLUME_MUTE: `<svg data-icon="VOLUME_MUTE" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2 8A1 1 0 0 1 3 7H5.4L9.3 3.4A1 1 0 0 1 11 4.1V15.9A1 1 0 0 1 9.3 16.6L5.4 13H3A1 1 0 0 1 2 12Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.6 7.8L18 12.2M18 7.8L13.6 12.2"/></svg>`,
    CLOSE: `<svg data-icon="CLOSE" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5L15 15M15 5L5 15"/></svg>`
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
                            <a class="game-menu-card game-menu-card--zalp" role="menuitem" href="${escapeHtml(chrome.runtime.getURL('src/pages/zalp/zalp.html'))}">
                                <span class="game-menu-icon">${SVG_ICONS.ZALP}</span>
                                <span class="game-menu-card-copy"><strong>${escapeHtml(t('menu.zalp.title'))}</strong><small>${escapeHtml(t('menu.zalp.subtitle'))}</small></span>
                                <span class="game-menu-arrow" aria-hidden="true">↗</span>
                            </a>
                        </div>
                        <div class="games-menu-online" role="group" aria-labelledby="gamesOnlineTitle">
                            <span class="games-menu-eyebrow" id="gamesOnlineTitle">${escapeHtml(t('modal.online_eyebrow'))}</span>
                            <div class="games-menu-grid">
                                <a class="game-menu-card game-menu-card--battleship" role="menuitem" href="${escapeHtml(chrome.runtime.getURL('src/pages/battleship/battleship.html'))}">
                                    <span class="game-menu-icon">${SVG_ICONS.BATTLESHIP}</span>
                                    <span class="game-menu-card-copy"><strong>${escapeHtml(t('menu.battleship.title'))}</strong><small>${escapeHtml(t('menu.battleship.subtitle'))}</small></span>
                                    <span class="game-menu-arrow" aria-hidden="true">↗</span>
                                </a>
                                <a class="game-menu-card game-menu-card--chess" role="menuitem" href="${escapeHtml(chrome.runtime.getURL('src/pages/chess/chess.html'))}">
                                    <span class="game-menu-icon">${SVG_ICONS.CHESS}</span>
                                    <span class="game-menu-card-copy"><strong>${escapeHtml(t('menu.chess.title'))}</strong><small>${escapeHtml(t('menu.chess.subtitle'))}</small></span>
                                    <span class="game-menu-arrow" aria-hidden="true">↗</span>
                                </a>
                            </div>
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
        // A snake still waiting for its first move has nothing running to pause.
        if (game.isPaused || game.isGameOver || game.isWaitingForStart) return;
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
            !element.closest('[hidden]') && !element.closest('[inert]') && element.getClientRects().length > 0
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
        this.revealView(playView);
    }

    revealView(view) {
        this.viewAnimation?.cancel();
        this.viewAnimation = null;
        if (!view || typeof view.animate !== 'function'
            || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const styles = getComputedStyle(view);
        this.viewAnimation = view.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: parseFloat(styles.getPropertyValue('--motion-duration-base')) || 180,
            easing: styles.getPropertyValue('--motion-ease-out').trim() || 'ease-out'
        });
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
        this.revealView(menu);
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
        // The algorithm field types notation; keys there must not turn the cube.
        if (e.target?.closest?.('input, textarea')) return;
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
        const views = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
        if (views[e.code]) {
            e.preventDefault();
            this.game.nudgeView?.(...views[e.code]);
            return;
        }
        // Face letters (plus M E S slices and X Y cube rotations; Z stays undo).
        const letter = e.code?.match(/^Key([URFDLBMESXY])$/)?.[1];
        if (!letter) return;
        const face = 'XY'.includes(letter) ? letter.toLowerCase() : letter;
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
        this.overlay.inert = false;
        this.overlay.setAttribute('aria-hidden', 'false');
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
        overlay.inert = false;
        overlay.setAttribute('aria-hidden', 'false');
        (showContinue ? continueButton : showRestart ? restartButton : null)?.focus({ preventScroll: true });
    }

    hideOverlay() {
        const overlay = document.getElementById('gameOverlay');
        if (overlay) {
            overlay.style.display = 'none';
            overlay.inert = true;
            overlay.setAttribute('aria-hidden', 'true');
        }
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
            this.overlay.inert = true;
            this.overlay.setAttribute('aria-hidden', 'true');
        }
        this.viewAnimation?.cancel();
        this.viewAnimation = null;
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
