import { getCanvasViewSize } from './gamesI18n.js';

// SRS wall-kick offsets (x right, y up as in the guideline); keyed "from>to".
const JLSTZ_KICKS = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
};

const I_KICKS = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
};

export class TetrisGame {
    static COLS = 10;
    static ROWS = 20;
    static BLOCK_SIZE = 24;
    // A grounded piece can still slide or rotate for this long before it locks.
    static LOCK_DELAY_MS = 500;
    // Moves that restart the lock delay are capped so a piece cannot stall forever.
    static MAX_LOCK_RESETS = 15;

    static SHAPES = {
        I: { matrix: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], color: '#06b6d4' },
        J: { matrix: [[1, 0, 0], [1, 1, 1], [0, 0, 0]], color: '#3b82f6' },
        L: { matrix: [[0, 0, 1], [1, 1, 1], [0, 0, 0]], color: '#f97316' },
        O: { matrix: [[1, 1], [1, 1]], color: '#eab308' },
        S: { matrix: [[0, 1, 1], [1, 1, 0], [0, 0, 0]], color: '#22c55e' },
        T: { matrix: [[0, 1, 0], [1, 1, 1], [0, 0, 0]], color: '#a855f7' },
        Z: { matrix: [[1, 1, 0], [0, 1, 1], [0, 0, 0]], color: '#ef4444' }
    };

    constructor(canvas, nextCanvas, callbacks, audio, holdCanvas = null) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nextCanvas = nextCanvas;
        this.nextCtx = nextCanvas?.getContext('2d') || null;
        this.holdCanvas = holdCanvas;
        this.holdCtx = holdCanvas?.getContext('2d') || null;
        this.callbacks = callbacks;
        this.audio = audio;

        this.grid = Array(TetrisGame.ROWS).fill(null).map(() => Array(TetrisGame.COLS).fill(0));
        this.score = 0;
        this.lines = 0;
        this.level = 1;
        this.highScore = 0;

        this.currentPiece = null;
        this.nextPiece = null;
        this.holdType = null;
        this.holdUsed = false;
        this.pieceX = 0;
        this.pieceY = 0;

        this.isGameOver = false;
        this.isPaused = false;
        this.animFrameId = null;
        this.lastDropTime = 0;
        this.bag = [];
        this.lockStartedAt = null;
        this.lockResets = 0;

        this.loadHighScore();
        this.spawnNextPiece();
        this.spawnPiece();
        this.drawHoldPiece();
    }

    async loadHighScore() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                const res = await chrome.storage.local.get('tetrisHighScore');
                this.highScore = res?.tetrisHighScore || 0;
                this.callbacks.onStatsUpdate({ highScore: this.highScore });
            } catch { /* default */ }
        }
    }

    saveHighScore() {
        if (this.score > this.highScore) {
            this.highScore = this.score;
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ tetrisHighScore: this.highScore });
            }
        }
    }

    static createPiece(type) {
        const shape = TetrisGame.SHAPES[type];
        return { type, shape: shape.matrix.map(row => [...row]), color: shape.color, rotation: 0 };
    }

    /** 7-bag randomizer: every tetromino appears once per seven pieces. */
    drawFromBag() {
        if (!this.bag.length) {
            const keys = Object.keys(TetrisGame.SHAPES);
            for (let i = keys.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [keys[i], keys[j]] = [keys[j], keys[i]];
            }
            this.bag = keys;
        }
        return this.bag.pop();
    }

    spawnNextPiece() {
        this.nextPiece = TetrisGame.createPiece(this.drawFromBag());
        this.drawPreview(this.nextCtx, this.nextCanvas, this.nextPiece);
    }

    spawnPiece(piece = null) {
        if (piece) {
            this.currentPiece = piece;
        } else {
            this.currentPiece = this.nextPiece;
            this.spawnNextPiece();
            this.holdUsed = false;
        }

        this.pieceX = Math.floor((TetrisGame.COLS - this.currentPiece.shape[0].length) / 2);
        this.pieceY = 0;
        this.lockStartedAt = null;
        this.lockResets = 0;

        if (this.checkCollision(this.currentPiece.shape, this.pieceX, this.pieceY)) {
            this.isGameOver = true;
            this.audio.gameOver();
            this.saveHighScore();
            this.callbacks.onGameOver(this.score);
        }
    }

    /** Swaps the falling piece with the held one (once per piece). */
    hold() {
        if (this.isPaused || this.isGameOver || this.holdUsed) return;
        const currentType = this.currentPiece.type;
        if (this.holdType) {
            const held = TetrisGame.createPiece(this.holdType);
            this.holdType = currentType;
            this.spawnPiece(held);
        } else {
            this.holdType = currentType;
            this.spawnPiece();
        }
        this.holdUsed = true;
        this.audio.rotate();
        this.drawHoldPiece();
        this.render();
    }

    checkCollision(matrix, offsetX, offsetY) {
        for (let r = 0; r < matrix.length; r++) {
            for (let c = 0; c < matrix[r].length; c++) {
                if (matrix[r][c]) {
                    const newX = offsetX + c;
                    const newY = offsetY + r;

                    if (newX < 0 || newX >= TetrisGame.COLS || newY >= TetrisGame.ROWS) {
                        return true;
                    }
                    if (newY >= 0 && this.grid[newY][newX]) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    rotateMatrix(matrix, direction = 1) {
        const N = matrix.length;
        const result = Array(N).fill(null).map(() => Array(N).fill(0));
        for (let r = 0; r < N; r++) {
            for (let c = 0; c < N; c++) {
                if (direction > 0) result[c][N - 1 - r] = matrix[r][c];
                else result[N - 1 - c][r] = matrix[r][c];
            }
        }
        return result;
    }

    /** SRS rotation: clockwise for direction 1, counter-clockwise for -1. */
    rotate(direction = 1) {
        if (this.isPaused || this.isGameOver) return;
        const piece = this.currentPiece;
        if (piece.type === 'O') return;
        const from = piece.rotation;
        const to = (from + direction + 4) % 4;
        const rotated = this.rotateMatrix(piece.shape, direction);
        const kicks = (piece.type === 'I' ? I_KICKS : JLSTZ_KICKS)[`${from}>${to}`];
        for (const [kickX, kickY] of kicks) {
            // Guideline kicks use y up; the board grows downwards.
            const x = this.pieceX + kickX;
            const y = this.pieceY - kickY;
            if (!this.checkCollision(rotated, x, y)) {
                piece.shape = rotated;
                piece.rotation = to;
                this.pieceX = x;
                this.pieceY = y;
                this.audio.rotate();
                this.resetLockDelay();
                this.render();
                return;
            }
        }
    }

    isGrounded() {
        return this.checkCollision(this.currentPiece.shape, this.pieceX, this.pieceY + 1);
    }

    /** A successful move or rotation on the ground restarts the lock delay (capped). */
    resetLockDelay() {
        if (this.lockStartedAt === null || this.lockResets >= TetrisGame.MAX_LOCK_RESETS) return;
        this.lockStartedAt = performance.now();
        this.lockResets += 1;
    }

    /** One frame of gravity and lock-delay bookkeeping. */
    tick(timestamp) {
        if (this.isGrounded()) {
            if (this.lockStartedAt === null) {
                this.lockStartedAt = timestamp;
            } else if (timestamp - this.lockStartedAt >= TetrisGame.LOCK_DELAY_MS) {
                this.lockPiece();
                this.lastDropTime = timestamp;
            }
            return;
        }
        this.lockStartedAt = null;
        if (timestamp - this.lastDropTime > this.getDropInterval()) {
            this.pieceY++;
            this.lastDropTime = timestamp;
            this.render();
        }
    }

    moveLeft() {
        this.shift(-1);
    }

    moveRight() {
        this.shift(1);
    }

    shift(dx) {
        if (this.isPaused || this.isGameOver) return;
        if (!this.checkCollision(this.currentPiece.shape, this.pieceX + dx, this.pieceY)) {
            this.pieceX += dx;
            this.audio.move();
            this.resetLockDelay();
            this.render();
        }
    }

    softDrop() {
        if (this.isPaused || this.isGameOver) return;
        if (!this.checkCollision(this.currentPiece.shape, this.pieceX, this.pieceY + 1)) {
            this.pieceY++;
            this.score += 1;
            this.callbacks.onStatsUpdate({ score: this.score });
            this.render();
        } else {
            this.lockPiece();
        }
    }

    hardDrop() {
        if (this.isPaused || this.isGameOver) return;
        let dropBonus = 0;
        while (!this.checkCollision(this.currentPiece.shape, this.pieceX, this.pieceY + 1)) {
            this.pieceY++;
            dropBonus += 2;
        }
        this.score += dropBonus;
        this.audio.drop();
        this.callbacks.onStatsUpdate({ score: this.score });
        this.lockPiece();
    }

    lockPiece() {
        const matrix = this.currentPiece.shape;
        for (let r = 0; r < matrix.length; r++) {
            for (let c = 0; c < matrix[r].length; c++) {
                if (matrix[r][c]) {
                    const gridY = this.pieceY + r;
                    const gridX = this.pieceX + c;
                    if (gridY >= 0 && gridY < TetrisGame.ROWS) {
                        this.grid[gridY][gridX] = this.currentPiece.color;
                    }
                }
            }
        }

        this.clearLines();
        this.spawnPiece();
        this.render();
    }

    clearLines() {
        let cleared = 0;
        for (let r = TetrisGame.ROWS - 1; r >= 0; r--) {
            if (this.grid[r].every(cell => cell !== 0)) {
                this.grid.splice(r, 1);
                this.grid.unshift(Array(TetrisGame.COLS).fill(0));
                cleared++;
                r++;
            }
        }

        if (cleared > 0) {
            const linePoints = [0, 100, 300, 500, 800];
            this.score += (linePoints[cleared] || 1000) * this.level;
            this.lines += cleared;
            this.level = Math.floor(this.lines / 10) + 1;
            this.saveHighScore();
            this.audio.clear();
            this.callbacks.onStatsUpdate({
                score: this.score,
                lines: this.lines,
                level: this.level,
                highScore: this.highScore
            });
        }
    }

    getDropInterval() {
        return Math.max(100, 800 - (this.level - 1) * 70);
    }

    getGhostY() {
        let ghostY = this.pieceY;
        while (!this.checkCollision(this.currentPiece.shape, this.pieceX, ghostY + 1)) {
            ghostY++;
        }
        return ghostY;
    }

    start() {
        this.isPaused = false;
        this.isGameOver = false;
        this.lastDropTime = performance.now();
        const loop = (timestamp) => {
            if (!this.isPaused && !this.isGameOver) this.tick(timestamp);
            this.animFrameId = requestAnimationFrame(loop);
        };
        this.animFrameId = requestAnimationFrame(loop);
    }

    togglePause() {
        if (this.isGameOver) return;
        this.isPaused = !this.isPaused;
        if (!this.isPaused) {
            // Time spent paused must not count towards gravity or the lock delay.
            const now = performance.now();
            this.lastDropTime = now;
            if (this.lockStartedAt !== null) this.lockStartedAt = now;
        }
        this.callbacks.onPauseToggle(this.isPaused);
        this.render();
    }

    stop() {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    drawHoldPiece() {
        this.drawPreview(this.holdCtx, this.holdCanvas, this.holdType ? TetrisGame.createPiece(this.holdType) : null, this.holdUsed);
    }

    drawPreview(ctx, canvas, piece, dimmed = false) {
        if (!ctx || !canvas) return;
        const { width, height } = getCanvasViewSize(canvas);
        ctx.clearRect(0, 0, width, height);
        if (!piece) return;

        const matrix = piece.shape;
        const cellSize = 16;
        const offsetX = (width - matrix[0].length * cellSize) / 2;
        const offsetY = (height - matrix.length * cellSize) / 2;
        ctx.globalAlpha = dimmed ? 0.4 : 1;
        for (let r = 0; r < matrix.length; r++) {
            for (let c = 0; c < matrix[r].length; c++) {
                if (matrix[r][c]) {
                    ctx.fillStyle = piece.color;
                    ctx.fillRect(offsetX + c * cellSize, offsetY + r * cellSize, cellSize - 1, cellSize - 1);
                }
            }
        }
        ctx.globalAlpha = 1;
    }

    render() {
        const bs = TetrisGame.BLOCK_SIZE;
        const { width, height } = getCanvasViewSize(this.canvas);
        this.ctx.clearRect(0, 0, width, height);

        // Grid background lines
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        this.ctx.lineWidth = 1;
        for (let r = 0; r <= TetrisGame.ROWS; r++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, r * bs);
            this.ctx.lineTo(TetrisGame.COLS * bs, r * bs);
            this.ctx.stroke();
        }
        for (let c = 0; c <= TetrisGame.COLS; c++) {
            this.ctx.beginPath();
            this.ctx.moveTo(c * bs, 0);
            this.ctx.lineTo(c * bs, TetrisGame.ROWS * bs);
            this.ctx.stroke();
        }

        for (let r = 0; r < TetrisGame.ROWS; r++) {
            for (let c = 0; c < TetrisGame.COLS; c++) {
                if (this.grid[r][c]) {
                    this.drawBlock(this.ctx, c * bs, r * bs, bs, this.grid[r][c]);
                }
            }
        }

        if (this.currentPiece && !this.isGameOver) {
            const ghostY = this.getGhostY();
            const matrix = this.currentPiece.shape;
            for (let r = 0; r < matrix.length; r++) {
                for (let c = 0; c < matrix[r].length; c++) {
                    if (matrix[r][c]) {
                        const gx = (this.pieceX + c) * bs;
                        const gy = (ghostY + r) * bs;
                        this.ctx.strokeStyle = this.currentPiece.color;
                        this.ctx.lineWidth = 1.5;
                        this.ctx.globalAlpha = 0.3;
                        this.ctx.strokeRect(gx + 1, gy + 1, bs - 2, bs - 2);
                        this.ctx.globalAlpha = 1.0;
                    }
                }
            }

            for (let r = 0; r < matrix.length; r++) {
                for (let c = 0; c < matrix[r].length; c++) {
                    if (matrix[r][c]) {
                        this.drawBlock(this.ctx, (this.pieceX + c) * bs, (this.pieceY + r) * bs, bs, this.currentPiece.color);
                    }
                }
            }
        }
    }

    drawBlock(ctx, x, y, size, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(x + 2, y + 2, size - 4, 3);
    }
}
