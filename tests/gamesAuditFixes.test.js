import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body><button id="launcher">Игры</button></body></html>');
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.chrome = {
    runtime: { getURL: path => path },
    storage: { local: { get: async () => ({}), set: async () => {} } }
};

// jsdom has no canvas backend or layout: a no-op 2D context and non-empty client
// rects for rendered elements are enough to exercise game logic and focus order.
const contextStub = () => new Proxy({}, {
    get: (target, property) => (property in target ? target[property] : () => {}),
    set: (target, property, value) => { target[property] = value; return true; }
});
window.HTMLCanvasElement.prototype.getContext = contextStub;
window.HTMLElement.prototype.getClientRects = function getClientRects() {
    return this.style?.display === 'none' ? [] : [{ width: 1, height: 1 }];
};

const { TetrisGame, SnakeGame, Game2048, GamesModal } = await import('../src/shared/components/GamesModal.js');

const silentAudio = new Proxy({}, { get: () => () => {} });
const makeCallbacks = () => ({
    stats: [],
    pauses: [],
    gameOvers: 0,
    onStatsUpdate(stats) { this.stats.push(stats); },
    onPauseToggle(isPaused) { this.pauses.push(isPaused); },
    onGameOver() { this.gameOvers += 1; }
});
const canvas = () => window.document.createElement('canvas');

// --- Tetris: 7-bag randomizer -------------------------------------------------
{
    const tetris = new TetrisGame(canvas(), canvas(), makeCallbacks(), silentAudio);
    tetris.bag = [];
    const draws = Array.from({ length: 14 }, () => tetris.drawFromBag());
    const keys = Object.keys(TetrisGame.SHAPES).sort();
    assert.deepEqual(draws.slice(0, 7).sort(), keys, 'the first bag must contain every tetromino once');
    assert.deepEqual(draws.slice(7).sort(), keys, 'the second bag must contain every tetromino once');
}

// --- Tetris: lock delay -------------------------------------------------------
{
    const tetris = new TetrisGame(canvas(), canvas(), makeCallbacks(), silentAudio);
    tetris.currentPiece = { shape: [[1, 1], [1, 1]], color: '#fff' };
    tetris.pieceX = 4;
    tetris.pieceY = TetrisGame.ROWS - 2;
    tetris.lockStartedAt = null;
    assert.equal(tetris.isGrounded(), true);

    tetris.tick(1000);
    assert.equal(tetris.lockStartedAt, 1000, 'touching the ground starts the lock delay');
    tetris.tick(1000 + TetrisGame.LOCK_DELAY_MS - 1);
    assert.equal(tetris.grid[TetrisGame.ROWS - 1][4], 0, 'the piece must not lock before the delay expires');

    tetris.moveLeft();
    assert.notEqual(tetris.lockStartedAt, 1000, 'a successful move on the ground restarts the lock delay');
    assert.equal(tetris.lockResets, 1);

    tetris.lockStartedAt = 2000;
    tetris.tick(2000 + TetrisGame.LOCK_DELAY_MS);
    assert.equal(tetris.grid[TetrisGame.ROWS - 1][3], '#fff', 'the piece locks once the delay expires');

    tetris.lockStartedAt = 5;
    tetris.lockResets = TetrisGame.MAX_LOCK_RESETS;
    tetris.resetLockDelay();
    assert.equal(tetris.lockStartedAt, 5, 'lock-delay resets are capped');
}

// --- Pause never replaces the game-over screen --------------------------------
{
    const callbacks = makeCallbacks();
    const tetris = new TetrisGame(canvas(), canvas(), callbacks, silentAudio);
    tetris.isGameOver = true;
    tetris.togglePause();
    assert.equal(tetris.isPaused, false);
    assert.deepEqual(callbacks.pauses, [], 'Tetris must ignore P after game over');

    const snakeCallbacks = makeCallbacks();
    const snake = new SnakeGame(canvas(), canvas(), snakeCallbacks, silentAudio);
    snake.isGameOver = true;
    snake.togglePause();
    assert.deepEqual(snakeCallbacks.pauses, [], 'Snake must ignore P after game over');

    const boardCallbacks = makeCallbacks();
    const board = new Game2048(canvas(), boardCallbacks, silentAudio);
    board.isGameOver = true;
    board.togglePause();
    assert.deepEqual(boardCallbacks.pauses, [], '2048 must ignore P after game over');
}

// --- Modal: focus trap and close confirmation ---------------------------------
{
    const modal = new GamesModal();
    modal.open();
    const doc = window.document;
    const pressKey = (key, init = {}) => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...init }));

    const menuFocusable = modal.getFocusableElements();
    assert.ok(menuFocusable.some(element => element.classList.contains('game-menu-card')),
        'menu cards are focusable while the menu is shown');
    assert.ok(!menuFocusable.some(element => element.id === 'gamesBackBtn'),
        'controls of the hidden play view are skipped');

    modal.switchGame('word-guess');
    const playFocusable = modal.getFocusableElements();
    assert.ok(!playFocusable.some(element => element.classList.contains('game-menu-card')),
        'hidden menu cards must not trap Tab focus');

    // Tab must always move focus forward instead of sticking on a hidden element.
    doc.getElementById('gamesCloseBtn').focus();
    pressKey('Tab');
    assert.notEqual(doc.activeElement?.id, 'gamesCloseBtn', 'Tab must leave the close button');

    modal.switchGame('tetris');
    assert.equal(modal.hasUnsavedProgress(), false, 'a fresh round has nothing to lose');
    pressKey('Escape');
    assert.equal(modal.overlay.classList.contains('active'), false, 'Escape closes a round without progress');

    modal.open();
    modal.switchGame('tetris');
    modal.game.score = 120;
    pressKey('Escape');
    assert.equal(modal.overlay.classList.contains('active'), true, 'Escape must not discard a running round');
    assert.equal(modal.isCloseConfirmOpen(), true, 'a confirmation is shown instead');
    assert.equal(modal.game.isPaused, true, 'the round is paused while the confirmation is open');
    assert.equal(doc.activeElement?.id, 'gamesCloseCancelBtn', 'focus starts on the safe choice');
    assert.ok(modal.getFocusableElements().every(element => element.closest('#gamesCloseConfirm')),
        'Tab stays inside the confirmation');

    pressKey('Escape');
    assert.equal(modal.isCloseConfirmOpen(), false, 'Escape cancels the confirmation');
    assert.equal(modal.game.isPaused, false, 'cancel resumes the paused round');

    modal.overlay.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    assert.equal(modal.isCloseConfirmOpen(), true, 'a backdrop click asks before closing as well');
    doc.getElementById('gamesCloseConfirmBtn').click();
    assert.equal(modal.overlay.classList.contains('active'), false, 'confirming closes the modal');
    assert.equal(modal.isCloseConfirmOpen(), false);
    assert.equal(modal.game, null, 'closing stops the game');
}

// --- Word Guess renderer: hint and two-step give up --------------------------
{
    const { WordGuessRenderer } = await import('../src/shared/games/WordGuessRenderer.js');
    const calls = { hint: 0, giveUp: 0 };
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const renderer = new WordGuessRenderer({
        container,
        controller: {
            submit: () => ({ kind: 'attempt' }),
            hint: () => { calls.hint += 1; },
            giveUp: () => { calls.giveUp += 1; }
        }
    });
    const state = {
        status: 'ready', puzzleId: 'p', attempts: 1, bestRank: 40, isWon: false, isRevealed: false,
        hintsUsed: 1, answer: null, feedback: { kind: 'hint', word: 'море', rank: 40 },
        history: [{ word: 'море', rank: 40, attempt: 1, hint: true }]
    };
    renderer.render(state);
    assert.match(container.querySelector('[data-role="feedback"]').textContent, /Подсказка: «море»/);
    assert.ok(container.querySelector('.word-guess-history-item.is-hint'), 'hint entries are marked in the history');

    container.querySelector('[data-role="hint"]').click();
    assert.equal(calls.hint, 1);
    const giveUp = container.querySelector('[data-role="give-up"]');
    giveUp.click();
    assert.equal(calls.giveUp, 0, 'the first click only arms the give-up button');
    assert.ok(giveUp.classList.contains('is-armed'));
    giveUp.click();
    assert.equal(calls.giveUp, 1, 'the second click gives up');

    renderer.render({ ...state, status: 'revealed', isRevealed: true, answer: 'океан', feedback: { kind: 'revealed', answer: 'океан' } });
    assert.equal(container.querySelector('[data-role="revealed"]').hidden, false);
    assert.equal(container.querySelector('[data-role="revealed-answer"]').textContent, 'океан');
    assert.equal(container.querySelector('[data-role="actions"]').hidden, true, 'actions hide after giving up');
    assert.equal(container.querySelector('[data-role="form"]').hidden, true);
    renderer.destroy();
}

// --- Tetris: SRS rotation, counter-clockwise turns and hold -----------------
{
    const tetris = new TetrisGame(canvas(), canvas(), makeCallbacks(), silentAudio, canvas());
    tetris.currentPiece = TetrisGame.createPiece('T');
    tetris.pieceX = 4;
    tetris.pieceY = 5;
    tetris.rotate(1);
    assert.equal(tetris.currentPiece.rotation, 1, 'clockwise rotation advances the SRS state');
    tetris.rotate(-1);
    tetris.rotate(-1);
    assert.equal(tetris.currentPiece.rotation, 3, 'counter-clockwise rotation wraps to state 3');

    // A vertical I piece hugging the right wall needs an SRS kick to turn horizontal.
    const wall = new TetrisGame(canvas(), canvas(), makeCallbacks(), silentAudio);
    wall.currentPiece = TetrisGame.createPiece('I');
    wall.pieceX = 3;
    wall.pieceY = 5;
    wall.rotate(1);
    wall.pieceX = TetrisGame.COLS - 3;
    assert.equal(wall.checkCollision(wall.rotateMatrix(wall.currentPiece.shape, 1), wall.pieceX, wall.pieceY), true,
        'the unkicked rotation would leave the board');
    wall.rotate(1);
    assert.equal(wall.currentPiece.rotation, 2, 'the I piece rotates off the wall with an SRS kick');
    assert.equal(wall.checkCollision(wall.currentPiece.shape, wall.pieceX, wall.pieceY), false);

    const holder = new TetrisGame(canvas(), canvas(), makeCallbacks(), silentAudio, canvas());
    const firstType = holder.currentPiece.type;
    holder.hold();
    assert.equal(holder.holdType, firstType, 'hold stores the falling piece');
    const secondType = holder.currentPiece.type;
    holder.hold();
    assert.equal(holder.currentPiece.type, secondType, 'hold works once per piece');
    holder.hardDrop();
    holder.hold();
    assert.equal(holder.currentPiece.type, firstType, 'the next piece can swap the held one back');
}

// --- Snake: turn queue and full-board victory ---------------------------------
{
    const callbacks = makeCallbacks();
    let finalState = null;
    callbacks.onGameOver = (score, state) => { finalState = state; };
    const snake = new SnakeGame(canvas(), canvas(), callbacks, silentAudio);
    snake.setDirection(0, -1);
    snake.setDirection(-1, 0);
    assert.equal(snake.turnQueue.length, 2, 'two quick turns are queued instead of dropped');
    snake.setDirection(1, 0);
    assert.equal(snake.turnQueue.length, 2, 'a reversal of the last queued turn is ignored');
    snake.food = { x: 0, y: 0, isGold: false };
    snake.step();
    snake.step();
    assert.deepEqual(snake.dir, { x: -1, y: 0 }, 'queued turns apply one per step');

    snake.snake = [];
    for (let y = 0; y < SnakeGame.GRID_SIZE; y++) {
        for (let x = 0; x < SnakeGame.GRID_SIZE; x++) snake.snake.push({ x, y });
    }
    assert.equal(snake.spawnFood(), false, 'a full board has no free cell instead of looping forever');
    snake.isGameOver = false;
    snake.handleGameOver({ won: true });
    assert.equal(snake.isWon, true);
    assert.deepEqual(finalState, { won: true }, 'the modal is told the round was won');
}

// --- 2048: win, continue, readable tiles, record writes -----------------------
{
    const writes = [];
    const previousSet = globalThis.chrome.storage.local.set;
    globalThis.chrome.storage.local.set = async (value) => { writes.push(value); };
    const callbacks = makeCallbacks();
    let wins = 0;
    callbacks.onWin = () => { wins += 1; };
    const board = new Game2048(canvas(), callbacks, silentAudio);
    await Promise.resolve();
    board.grid = [[1024, 1024, 0, 0], [2, 4, 8, 16], [0, 0, 0, 0], [0, 0, 0, 0]];
    board.score = 0;
    board.savedHighScore = 5000;
    board.move(-1, 0);
    assert.equal(writes.length, 0, 'the record is not written when the score does not beat it');
    board.animation = null;
    board.finishMove();
    assert.equal(wins, 1, 'reaching 2048 announces a win');
    assert.equal(board.awaitingContinue, true);
    const before = JSON.stringify(board.grid);
    board.move(1, 0);
    assert.equal(JSON.stringify(board.grid), before, 'moves wait for the continue choice');
    board.continueAfterWin();
    assert.equal(board.awaitingContinue, false);
    board.grid[3][3] = 4096;
    board.finishMove();
    assert.equal(wins, 1, 'the win is announced only once');

    board.savedHighScore = 0;
    board.score = 10;
    board.saveHighScore();
    assert.equal(writes.length, 1, 'an improved record is written once');

    for (const value of [2, 128, 2048, 16384, 131072]) {
        const size = Game2048.getTileFontSize(value, 64);
        assert.ok(size * 0.62 * String(value).length <= 64, `${value} fits inside its tile`);
    }
    globalThis.chrome.storage.local.set = previousSet;
}

// --- HiDPI canvases, unbiased shuffle and localized strings --------------------
{
    const { setupHiDpiCanvas, getCanvasViewSize, shuffled, t } = await import('../src/shared/games/gamesI18n.js');
    window.devicePixelRatio = 2;
    const sharp = canvas();
    setupHiDpiCanvas(sharp, 240, 480);
    assert.equal(sharp.width, 480, 'the backing store follows devicePixelRatio');
    assert.deepEqual(getCanvasViewSize(sharp), { width: 240, height: 480 }, 'games draw in CSS pixels');
    window.devicePixelRatio = 1;

    const items = [1, 2, 3, 4, 5];
    assert.deepEqual(shuffled(items).sort(), items, 'shuffling keeps every item');

    window.i18n = { currentLocale: 'en' };
    assert.equal(t('modal.back'), 'All games', 'game strings follow the interface language');
    assert.equal(t('overlay.final_score', { score: 7 }), 'Final score: 7');
    delete window.i18n;
    assert.equal(t('modal.back'), 'Все игры', 'Russian is the fallback without i18n');
}

// --- Quiz: Kinopoisk answers are cached between games -------------------------
{
    const { MovieQuizGame } = await import('../src/shared/games/MovieQuizGame.js');
    const store = {};
    const previousLocal = globalThis.chrome.storage.local;
    globalThis.chrome.storage.local = {
        get: async (key) => ({ [key]: store[key] }),
        set: async (value) => { Object.assign(store, value); }
    };
    let searches = 0;
    let frameRequests = 0;
    const service = {
        async searchMovies() {
            searches += 1;
            return { docs: [{ kinopoiskId: 1, name: 'Матрица', votes: { kp: 900000 }, genres: [{ name: 'фантастика' }] }] };
        },
        async getMovieImages() {
            frameRequests += 1;
            return [{ url: 'https://example.com/frame.jpg' }];
        }
    };
    const quiz = new MovieQuizGame({ onStatsUpdate() {} }, silentAudio);
    await quiz.loadApiCache();
    await quiz.searchWithCache(service, 'Матрица');
    await quiz.framesWithCache(service, 1);
    await quiz.saveApiCache();

    const replay = new MovieQuizGame({ onStatsUpdate() {} }, silentAudio);
    await replay.loadApiCache();
    const docs = await replay.searchWithCache(service, 'Матрица');
    const urls = await replay.framesWithCache(service, 1);
    assert.equal(searches, 1, 'a cached search does not spend API quota again');
    assert.equal(frameRequests, 1, 'cached frames do not spend API quota again');
    assert.equal(docs[0].name, 'Матрица');
    assert.deepEqual(urls, ['https://example.com/frame.jpg']);
    assert.ok(MovieQuizGame.SEARCH_QUERIES.length >= 60, 'the quiz draws from a broad title list');
    globalThis.chrome.storage.local = previousLocal;
}

// --- Modal keyboard: Space in the quiz, Rubik shortcuts, auto-pause -----------
{
    // The app uses one modal instance; drop the earlier instance's DOM and listeners.
    window.document.getElementById('gamesModalOverlay')?.remove();
    const modal = new GamesModal();
    modal.open();
    const doc = window.document;
    const keydown = (init) => {
        const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        doc.dispatchEvent(event);
        return event;
    };

    modal.switchGame('quiz');
    assert.equal(keydown({ key: ' ', code: 'Space' }).defaultPrevented, false,
        'Space still activates focused quiz buttons');

    modal.switchGame('rubiks');
    keydown({ key: '2', code: 'Digit2' });
    keydown({ key: 'u', code: 'KeyU' });
    assert.deepEqual(modal.game.history, ['U2'], '"2" then a face letter makes a double turn');
    keydown({ key: 'г', code: 'KeyU' });
    assert.deepEqual(modal.game.history, ['U2', 'U'], 'face keys work on any keyboard layout');
    keydown({ key: 'z', code: 'KeyZ' });
    assert.deepEqual(modal.game.history, ['U2'], 'Z undoes the last move');

    modal.switchGame('tetris');
    assert.equal(doc.getElementById('gameHoldCard').classList.contains('is-hidden'), false, 'Tetris shows the hold card');
    window.dispatchEvent(new window.Event('blur'));
    assert.equal(modal.game.isPaused, true, 'Tetris pauses when the window loses focus');
    assert.equal(keydown({ key: 'ArrowLeft', code: 'ArrowLeft' }).defaultPrevented, false,
        'game keys are ignored while paused');
    keydown({ key: 'p', code: 'KeyP' });
    assert.equal(modal.game.isPaused, false, 'P resumes');

    modal.switchGame('2048');
    modal.game.awaitingContinue = true;
    modal.game.callbacks.onWin(4096);
    assert.equal(doc.getElementById('gameContinueBtn').hidden, false, 'the 2048 win offers to continue');
    doc.getElementById('gameContinueBtn').click();
    assert.equal(modal.game.awaitingContinue, false);
    assert.equal(doc.getElementById('gameOverlay').style.display, 'none');

    modal.switchGame('word-guess');
    assert.equal(doc.getElementById('gameScoreCard').classList.contains('is-hidden'), true,
        'Word Guess does not duplicate attempts in the sidebar');
    assert.equal(doc.getElementById('gameHighScoreLabel').textContent, 'Подсказки');
    modal.close();
}

console.log('✅ Games audit fix regression tests passed!');
