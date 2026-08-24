import { WordGuessGame } from '../games/WordGuessGame.js';
import { RubiksCubeGame } from '../games/RubiksCubeGame.js';

/**
 * GamesModal Component
 * Interactive Mini-Games Launcher featuring Tetris, Snake, 2048 & Rubik's Cube
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

class AudioFx {
    constructor() {
        this.ctx = null;
        this.muted = false;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get('gamesMuted', (data) => {
                this.muted = data.gamesMuted ?? false;
            });
        }
    }

    init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.ctx = new AudioContext();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    setMuted(muted) {
        this.muted = muted;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ gamesMuted: muted });
        }
    }

    playTone(freq, duration, type = 'sine', gainVal = 0.05) {
        if (this.muted || !this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch {
            // Fallback
        }
    }

    move() { this.playTone(220, 0.04, 'square', 0.02); }
    rotate() { this.playTone(440, 0.06, 'triangle', 0.04); }
    drop() { this.playTone(160, 0.08, 'sine', 0.06); }
    eat() {
        this.playTone(600, 0.08, 'triangle', 0.06);
        setTimeout(() => this.playTone(880, 0.1, 'sine', 0.06), 60);
    }
    clear() {
        if (this.muted || !this.ctx) return;
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
            setTimeout(() => this.playTone(freq, 0.09, 'triangle', 0.06), idx * 60);
        });
    }
    gameOver() {
        if (this.muted || !this.ctx) return;
        [350, 300, 250, 200, 150].forEach((freq, idx) => {
            setTimeout(() => this.playTone(freq, 0.12, 'sawtooth', 0.05), idx * 80);
        });
    }
}

class TetrisGame {
    static COLS = 10;
    static ROWS = 20;
    static BLOCK_SIZE = 24;

    static SHAPES = {
        I: { matrix: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], color: '#06b6d4' },
        J: { matrix: [[1,0,0],[1,1,1],[0,0,0]], color: '#3b82f6' },
        L: { matrix: [[0,0,1],[1,1,1],[0,0,0]], color: '#f97316' },
        O: { matrix: [[1,1],[1,1]], color: '#eab308' },
        S: { matrix: [[0,1,1],[1,1,0],[0,0,0]], color: '#22c55e' },
        T: { matrix: [[0,1,0],[1,1,1],[0,0,0]], color: '#a855f7' },
        Z: { matrix: [[1,1,0],[0,1,1],[0,0,0]], color: '#ef4444' }
    };

    constructor(canvas, nextCanvas, callbacks, audio) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nextCanvas = nextCanvas;
        this.nextCtx = nextCanvas.getContext('2d');
        this.callbacks = callbacks;
        this.audio = audio;

        this.grid = Array(TetrisGame.ROWS).fill(null).map(() => Array(TetrisGame.COLS).fill(0));
        this.score = 0;
        this.lines = 0;
        this.level = 1;
        this.highScore = 0;

        this.currentPiece = null;
        this.nextPiece = null;
        this.pieceX = 0;
        this.pieceY = 0;

        this.isGameOver = false;
        this.isPaused = false;
        this.animFrameId = null;
        this.lastDropTime = 0;

        this.loadHighScore();
        this.spawnNextPiece();
        this.spawnPiece();
    }

    async loadHighScore() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                const res = await chrome.storage.local.get('tetrisHighScore');
                this.highScore = res.tetrisHighScore || 0;
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

    spawnNextPiece() {
        const keys = Object.keys(TetrisGame.SHAPES);
        const randKey = keys[Math.floor(Math.random() * keys.length)];
        const shape = TetrisGame.SHAPES[randKey];
        this.nextPiece = {
            shape: shape.matrix.map(row => [...row]),
            color: shape.color
        };
        this.drawNextPiece();
    }

    spawnPiece() {
        this.currentPiece = this.nextPiece;
        this.spawnNextPiece();

        this.pieceX = Math.floor((TetrisGame.COLS - this.currentPiece.shape[0].length) / 2);
        this.pieceY = 0;

        if (this.checkCollision(this.currentPiece.shape, this.pieceX, this.pieceY)) {
            this.isGameOver = true;
            this.audio.gameOver();
            this.saveHighScore();
            this.callbacks.onGameOver(this.score);
        }
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

    rotateMatrix(matrix) {
        const N = matrix.length;
        const result = Array(N).fill(null).map(() => Array(N).fill(0));
        for (let r = 0; r < N; r++) {
            for (let c = 0; c < N; c++) {
                result[c][N - 1 - r] = matrix[r][c];
            }
        }
        return result;
    }

    rotate() {
        if (this.isPaused || this.isGameOver) return;
        const rotated = this.rotateMatrix(this.currentPiece.shape);
        let kickX = 0;
        if (this.checkCollision(rotated, this.pieceX, this.pieceY)) {
            if (!this.checkCollision(rotated, this.pieceX - 1, this.pieceY)) kickX = -1;
            else if (!this.checkCollision(rotated, this.pieceX + 1, this.pieceY)) kickX = 1;
            else if (!this.checkCollision(rotated, this.pieceX - 2, this.pieceY)) kickX = -2;
            else if (!this.checkCollision(rotated, this.pieceX + 2, this.pieceY)) kickX = 2;
            else return;
        }

        this.currentPiece.shape = rotated;
        this.pieceX += kickX;
        this.audio.rotate();
        this.render();
    }

    moveLeft() {
        if (this.isPaused || this.isGameOver) return;
        if (!this.checkCollision(this.currentPiece.shape, this.pieceX - 1, this.pieceY)) {
            this.pieceX--;
            this.audio.move();
            this.render();
        }
    }

    moveRight() {
        if (this.isPaused || this.isGameOver) return;
        if (!this.checkCollision(this.currentPiece.shape, this.pieceX + 1, this.pieceY)) {
            this.pieceX++;
            this.audio.move();
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
            if (!this.isPaused && !this.isGameOver) {
                if (timestamp - this.lastDropTime > this.getDropInterval()) {
                    this.softDrop();
                    this.lastDropTime = timestamp;
                }
            }
            this.animFrameId = requestAnimationFrame(loop);
        };
        this.animFrameId = requestAnimationFrame(loop);
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        this.callbacks.onPauseToggle(this.isPaused);
        this.render();
    }

    stop() {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    drawNextPiece() {
        if (!this.nextCtx) return;
        this.nextCtx.clearRect(0, 0, this.nextCanvas.width, this.nextCanvas.height);
        
        const matrix = this.nextPiece.shape;
        const cellSize = 16;
        const offsetX = (this.nextCanvas.width - matrix[0].length * cellSize) / 2;
        const offsetY = (this.nextCanvas.height - matrix.length * cellSize) / 2;

        for (let r = 0; r < matrix.length; r++) {
            for (let c = 0; c < matrix[r].length; c++) {
                if (matrix[r][c]) {
                    this.nextCtx.fillStyle = this.nextPiece.color;
                    this.nextCtx.fillRect(offsetX + c * cellSize, offsetY + r * cellSize, cellSize - 1, cellSize - 1);
                }
            }
        }
    }

    render() {
        const bs = TetrisGame.BLOCK_SIZE;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

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

        // Draw placed grid blocks
        for (let r = 0; r < TetrisGame.ROWS; r++) {
            for (let c = 0; c < TetrisGame.COLS; c++) {
                if (this.grid[r][c]) {
                    this.drawBlock(this.ctx, c * bs, r * bs, bs, this.grid[r][c]);
                }
            }
        }

        // Draw active piece & ghost
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
                        const px = (this.pieceX + c) * bs;
                        const py = (this.pieceY + r) * bs;
                        this.drawBlock(this.ctx, px, py, bs, this.currentPiece.color);
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

class Game2048 {
    static SIZE = 4;
    static COLORS = {
        0: '#1c202b', 2: '#3b4252', 4: '#475569', 8: '#8b5cf6', 16: '#7c3aed',
        32: '#db2777', 64: '#e11d48', 128: '#f59e0b', 256: '#f97316', 512: '#22c55e',
        1024: '#06b6d4', 2048: '#eab308'
    };

    constructor(canvas, callbacks, audio) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.callbacks = callbacks;
        this.audio = audio;
        this.grid = Array.from({ length: Game2048.SIZE }, () => Array(Game2048.SIZE).fill(0));
        this.score = 0;
        this.highScore = 0;
        this.isGameOver = false;
        this.isPaused = false;
        this.animation = null;
        this.animationFrame = null;
        this.loadHighScore();
        this.addTile();
        this.addTile();
    }

    async loadHighScore() {
        try {
            const res = await chrome.storage.local.get('game2048HighScore');
            this.highScore = res.game2048HighScore || 0;
            this.callbacks.onStatsUpdate({ highScore: this.highScore });
        } catch { /* Local score is optional. */ }
    }

    addTile() {
        const empty = [];
        this.grid.forEach((row, y) => row.forEach((value, x) => {
            if (!value) empty.push({ x, y });
        }));
        if (!empty.length) return false;
        const { x, y } = empty[Math.floor(Math.random() * empty.length)];
        this.grid[y][x] = Math.random() < 0.9 ? 2 : 4;
        return true;
    }

    move(dx, dy) {
        if (this.isPaused || this.isGameOver || this.animation) return;
        let moved = false;
        let gained = 0;
        const merged = new Set();
        const previousGrid = this.grid.map(row => [...row]);
        const movingTiles = [];
        const range = [0, 1, 2, 3];
        if (dx > 0) range.reverse();
        const rows = dy > 0 ? [...range].reverse() : [...range];

        rows.forEach(y => range.forEach(x => {
            const value = this.grid[y][x];
            if (!value) return;
            let nextX = x;
            let nextY = y;
            while (nextX + dx >= 0 && nextX + dx < Game2048.SIZE && nextY + dy >= 0 && nextY + dy < Game2048.SIZE && !this.grid[nextY + dy][nextX + dx]) {
                nextX += dx;
                nextY += dy;
            }
            const mergeX = nextX + dx;
            const mergeY = nextY + dy;
            const mergeKey = `${mergeX}:${mergeY}`;
            if (mergeX >= 0 && mergeX < Game2048.SIZE && mergeY >= 0 && mergeY < Game2048.SIZE && this.grid[mergeY][mergeX] === value && !merged.has(mergeKey)) {
                this.grid[y][x] = 0;
                this.grid[mergeY][mergeX] *= 2;
                gained += this.grid[mergeY][mergeX];
                merged.add(mergeKey);
                movingTiles.push({ value, fromX: x, fromY: y, toX: mergeX, toY: mergeY });
                moved = true;
            } else if (nextX !== x || nextY !== y) {
                this.grid[y][x] = 0;
                this.grid[nextY][nextX] = value;
                movingTiles.push({ value, fromX: x, fromY: y, toX: nextX, toY: nextY });
                moved = true;
            }
        }));

        if (!moved) return;
        this.score += gained;
        this.highScore = Math.max(this.highScore, this.score);
        chrome.storage.local.set({ game2048HighScore: this.highScore });
        this.audio.move();
        this.callbacks.onStatsUpdate({ score: this.score, highScore: this.highScore, level: this.getMaxTile(), lines: 0 });
        this.startMoveAnimation(previousGrid, movingTiles);
    }

    getMaxTile() { return Math.max(...this.grid.flat()); }

    hasMoves() {
        return this.grid.some((row, y) => row.some((value, x) => !value || (x < 3 && value === row[x + 1]) || (y < 3 && value === this.grid[y + 1][x])));
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        this.callbacks.onPauseToggle(this.isPaused);
    }

    startMoveAnimation(previousGrid, tiles) {
        const baseGrid = previousGrid.map(row => [...row]);
        tiles.forEach(({ fromX, fromY }) => { baseGrid[fromY][fromX] = 0; });
        this.animation = { baseGrid, tiles, progress: 0 };
        const startTime = performance.now();
        const duration = 110;
        const animate = (now) => {
            const elapsed = Math.min(1, (now - startTime) / duration);
            this.animation.progress = 1 - (1 - elapsed) ** 3;
            this.render();
            if (elapsed < 1) {
                this.animationFrame = requestAnimationFrame(animate);
                return;
            }
            this.animation = null;
            this.animationFrame = null;
            this.addTile();
            this.isGameOver = !this.hasMoves();
            this.callbacks.onStatsUpdate({ score: this.score, highScore: this.highScore, level: this.getMaxTile() });
            this.render();
            if (this.isGameOver) this.callbacks.onGameOver(this.score);
        };
        this.animationFrame = requestAnimationFrame(animate);
    }

    start() {
        this.callbacks.onStatsUpdate({
            score: this.score,
            highScore: this.highScore,
            level: this.getMaxTile()
        });
        this.render();
    }
    stop() {
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
        this.animation = null;
    }

    render() {
        const cell = this.canvas.width / Game2048.SIZE;
        const gap = 6;
        this.ctx.fillStyle = '#090b10';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        const board = this.animation?.baseGrid || this.grid;
        board.forEach((row, y) => row.forEach((value, x) => this.drawTile(x, y, value, cell, gap)));
        this.animation?.tiles.forEach(tile => {
            const progress = this.animation.progress;
            this.drawTile(
                tile.fromX + (tile.toX - tile.fromX) * progress,
                tile.fromY + (tile.toY - tile.fromY) * progress,
                tile.value,
                cell,
                gap
            );
        });
    }

    drawTile(x, y, value, cell, gap) {
        const px = x * cell + gap;
        const py = y * cell + gap;
        const size = cell - gap * 2;
        this.ctx.fillStyle = Game2048.COLORS[value] || '#facc15';
        this.ctx.beginPath();
        this.ctx.roundRect(px, py, size, size, 9);
        this.ctx.fill();
        if (!value) return;
        this.ctx.fillStyle = value <= 4 ? '#e5e7eb' : '#fff';
        this.ctx.font = `700 ${value >= 1024 ? 23 : 31}px Outfit, sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(value, px + size / 2, py + size / 2 + 1);
    }
}

export class MovieQuizGame {
    static ROUNDS = 5;
    static MIN_KP_VOTES = 50000;
    static CANDIDATE_TARGET = 10;
    static SEARCH_RESULT_LIMIT = 12;
    static MAX_SEARCH_QUERIES = 8;
    static FRAME_CONCURRENCY = 3;
    static ANSWER_FEEDBACK_MS = 1200;
    static IMAGE_TIMEOUT_MS = 6000;
    static SEARCH_QUERIES = [
        'Интерстеллар', 'Матрица', 'Гарри Поттер', 'Мстители', 'Начало', 'Джокер',
        'Темный рыцарь', 'Властелин колец', 'Зеленая миля', 'Форрест Гамп',
        'Бойцовский клуб', 'Побег из Шоушенка', 'Гладиатор', 'Титаник',
        'Шерлок Холмс', 'Один дома', 'Назад в будущее', 'Пираты Карибского моря'
    ];

    /**
     * Curated fallback bank categorized by genre/theme to ensure
     * highly believable, contextually relevant options without API dependency.
     */
    static CURATED_FALLBACK_POOL = [
        // Superhero / Sci-Fi / Action
        { kinopoiskId: 'fb_1', name: 'Железный человек', genres: ['фантастика', 'боевик'], franchise: 'железный человек' },
        { kinopoiskId: 'fb_2', name: 'Стражи Галактики', genres: ['фантастика', 'приключения'], franchise: 'стражи галактики' },
        { kinopoiskId: 'fb_3', name: 'Человек-паук', genres: ['фантастика', 'боевик'], franchise: 'человек-паук' },
        { kinopoiskId: 'fb_4', name: 'Бэтмен: Начало', genres: ['боевик', 'фантастика'], franchise: 'бэтмен' },
        { kinopoiskId: 'fb_5', name: 'Бегущий по лезвию 2049', genres: ['фантастика', 'триллер'], franchise: 'бегущий по лезвию' },
        { kinopoiskId: 'fb_6', name: 'Терминатор 2: Судный день', genres: ['фантастика', 'боевик'], franchise: 'терминатор' },
        { kinopoiskId: 'fb_7', name: 'Аватар', genres: ['фантастика', 'приключения'], franchise: 'аватар' },
        { kinopoiskId: 'fb_8', name: 'Дюна', genres: ['фантастика', 'приключения'], franchise: 'дюна' },
        { kinopoiskId: 'fb_9', name: 'Пятый элемент', genres: ['фантастика', 'боевик'], franchise: 'пятый элемент' },
        { kinopoiskId: 'fb_10', name: 'Люди Икс', genres: ['фантастика', 'боевик'], franchise: 'люди икс' },
        // Fantasy / Adventure
        { kinopoiskId: 'fb_11', name: 'Хоббит: Нежданное путешествие', genres: ['фэнтези', 'приключения'], franchise: 'хоббит' },
        { kinopoiskId: 'fb_12', name: 'Хроники Нарнии: Лев, колдунья и волшебный шкаф', genres: ['фэнтези', 'приключения'], franchise: 'хроники нарнии' },
        { kinopoiskId: 'fb_13', name: 'Звёздные войны: Эпизод 4 — Новая надежда', genres: ['фантастика', 'приключения'], franchise: 'звездные войны' },
        { kinopoiskId: 'fb_14', name: 'Индиана Джонс: В поисках утраченного ковчега', genres: ['приключения', 'боевик'], franchise: 'индиана джонс' },
        { kinopoiskId: 'fb_15', name: 'Парк Юрского периода', genres: ['приключения', 'фантастика'], franchise: 'парк юрского периода' },
        { kinopoiskId: 'fb_16', name: 'Мумия', genres: ['фэнтези', 'приключения'], franchise: 'мумия' },
        // Thriller / Crime / Mystery
        { kinopoiskId: 'fb_17', name: 'Криминальное чтиво', genres: ['криминал', 'триллер'], franchise: 'криминальное чтиво' },
        { kinopoiskId: 'fb_18', name: 'Семь', genres: ['триллер', 'детектив'], franchise: 'семь' },
        { kinopoiskId: 'fb_19', name: 'Остров проклятых', genres: ['триллер', 'детектив'], franchise: 'остров проклятых' },
        { kinopoiskId: 'fb_20', name: 'Престиж', genres: ['триллер', 'фантастика'], franchise: 'престиж' },
        { kinopoiskId: 'fb_21', name: 'Молчание ягнят', genres: ['триллер', 'детектив'], franchise: 'молчание ягнят' },
        { kinopoiskId: 'fb_22', name: 'Отступники', genres: ['триллер', 'криминал'], franchise: 'отступники' },
        { kinopoiskId: 'fb_23', name: 'Леон', genres: ['боевик', 'криминал'], franchise: 'леон' },
        { kinopoiskId: 'fb_24', name: 'Достать ножи', genres: ['детектив', 'комедия'], franchise: 'достать ножи' },
        // Drama / Classic
        { kinopoiskId: 'fb_25', name: '1+1', genres: ['драма', 'комедия'], franchise: '1+1' },
        { kinopoiskId: 'fb_26', name: 'Крестный отец', genres: ['драма', 'криминал'], franchise: 'крестный отец' },
        { kinopoiskId: 'fb_27', name: 'Шоу Трумана', genres: ['драма', 'комедия'], franchise: 'шоу трумана' },
        { kinopoiskId: 'fb_28', name: 'Игры разума', genres: ['драма', 'биография'], franchise: 'игры разума' },
        { kinopoiskId: 'fb_29', name: 'Список Шиндлера', genres: ['драма', 'история'], franchise: 'список шиндлера' },
        { kinopoiskId: 'fb_30', name: 'Запах женщины', genres: ['драма'], franchise: 'запах женщины' },
        // Comedy / Family
        { kinopoiskId: 'fb_31', name: 'День сурка', genres: ['комедия', 'фэнтези'], franchise: 'день сурка' },
        { kinopoiskId: 'fb_32', name: 'Маска', genres: ['комедия', 'фэнтези'], franchise: 'маска' },
        { kinopoiskId: 'fb_33', name: 'Брюс Всемогущий', genres: ['комедия', 'фэнтези'], franchise: 'брюс всемогущий' },
        { kinopoiskId: 'fb_34', name: 'Трасса 60', genres: ['комедия', 'фантастика'], franchise: 'трасса 60' }
    ];

    constructor(callbacks, audio) {
        this.callbacks = callbacks;
        this.audio = audio;
        this.panel = document.getElementById('movieQuiz');
        this.movies = [];
        this.round = 0;
        this.score = 0;
        this.highScore = 0;
        this.isAnswered = false;
        this.distractorMovies = [];
        this.allCandidates = [];
        this.shownOptionIds = new Set();
        this.shownOptionNames = new Set();
        this.shownFranchises = new Set();
        this.sessionId = 0;
        this.abortController = null;
        this.transitionTimer = null;
        this.stopped = true;
    }

    async loadHighScore() {
        try {
            const { movieQuizHighScore = 0 } = await chrome.storage.local.get('movieQuizHighScore');
            this.highScore = movieQuizHighScore;
        } catch { /* Scores are optional. */ }
    }

    async start() {
        const sessionId = this.beginSession();
        console.log(`[MovieQuiz] 🎮 Инициализация сессии квиза #${sessionId}`);
        this.renderLoading();
        await this.loadHighScore();
        if (!this.isCurrentSession(sessionId)) return;
        this.callbacks.onStatsUpdate({ score: 0, highScore: this.highScore, level: 1, lines: MovieQuizGame.ROUNDS });
        try {
            const service = await this.createKinopoiskService();
            if (!service?.isConfigured?.()) throw new Error('Сервис Кинопоиска не настроен');
            console.log('[MovieQuiz] 🔍 Поиск фильмов-кандидатов в Кинопоиске...');
            const candidates = await this.loadQuizMovies(service, this.abortController.signal, sessionId);
            console.log(`[MovieQuiz] 📥 Найдено кандидатов из API: ${candidates.length}`);
            console.log('[MovieQuiz] 🖼️ Проверка и прикрепление кадров...');
            const moviesWithFrames = await this.attachQuizFrames(service, candidates, this.abortController.signal, sessionId);
            if (!this.isCurrentSession(sessionId)) return;
            console.log(`[MovieQuiz] ✅ Отобрано фильмов с подтверждёнными кадрами: ${moviesWithFrames.length}`);
            
            // Ensure each of the 5 question movies belongs to a distinct franchise
            const questionFranchises = new Set();
            const selectedQuestions = [];
            for (const movie of this.shuffle(moviesWithFrames)) {
                const fKey = MovieQuizGame.getFranchiseKey(movie.name);
                if (!questionFranchises.has(fKey)) {
                    questionFranchises.add(fKey);
                    selectedQuestions.push(movie);
                    if (selectedQuestions.length >= MovieQuizGame.ROUNDS) break;
                }
            }
            for (const movie of this.shuffle(moviesWithFrames)) {
                if (selectedQuestions.length >= MovieQuizGame.ROUNDS) break;
                if (!selectedQuestions.some(m => String(m.kinopoiskId) === String(movie.kinopoiskId))) {
                    selectedQuestions.push(movie);
                }
            }
            this.movies = selectedQuestions;
            if (this.movies.length < MovieQuizGame.ROUNDS) throw new Error('Не удалось подобрать пять фильмов с кадрами');
            this.allCandidates = this.dedupeMovies(candidates);
            const questionIds = new Set(this.movies.map(movie => String(movie.kinopoiskId)));
            this.distractorMovies = this.allCandidates
                .filter(movie => !questionIds.has(String(movie.kinopoiskId)));
            await this.saveRecentMovieIds();
            if (!this.isCurrentSession(sessionId)) return;
            console.log('[MovieQuiz] 🎯 Сформирован пул из 5 вопросов на игру:', this.movies.map((m, i) => `${i + 1}. "${m.name}"`).join(' | '));
            this.showRound();
        } catch (error) {
            if (this.isCurrentSession(sessionId) && !MovieQuizGame.isAbortError(error)) {
                console.error('[MovieQuiz] ❌ Ошибка при запуске квиза:', error);
                this.renderError(this.getUserFacingError(error));
            }
        }
    }

    beginSession() {
        this.abortController?.abort();
        if (this.transitionTimer) window.clearTimeout(this.transitionTimer);
        this.transitionTimer = null;
        this.abortController = new AbortController();
        this.stopped = false;
        this.shownOptionIds = new Set();
        this.shownOptionNames = new Set();
        this.shownFranchises = new Set();
        this.sessionId += 1;
        return this.sessionId;
    }

    isCurrentSession(sessionId) {
        return !this.stopped && sessionId === this.sessionId && !this.abortController?.signal.aborted;
    }

    static isAbortError(error) {
        return error?.name === 'AbortError' || (error?.cause && MovieQuizGame.isAbortError(error.cause));
    }

    static isLimitError(error) {
        const normalized = window.errorNormalizer?.normalize?.(error, {
            operation: 'movie-quiz-load',
            category: 'provider'
        });
        return normalized?.code === 'KINOPOISK_DAILY_LIMIT' ||
            /DAILY_LIMIT_REACHED|HTTP error! status: (402|403|429)/i.test(String(error?.message));
    }

    async createKinopoiskService() {
        if (!window.KinopoiskService) {
            await MovieQuizGame.loadScript('src/shared/config/kinopoisk.config.js', 'KINOPOISK_CONFIG');
            await MovieQuizGame.loadScript('src/shared/services/KinopoiskService.js', 'KinopoiskService');
        }
        return new window.KinopoiskService();
    }

    async loadQuizMovies(service, signal, sessionId) {
        const movies = [];
        const fallbackMovies = [];
        const usedIds = new Set();
        const usedNames = new Set();
        let lastError = null;
        const recentIds = await this.getRecentMovieIds();
        const queries = this.shuffle([...MovieQuizGame.SEARCH_QUERIES]).slice(0, MovieQuizGame.MAX_SEARCH_QUERIES);
        console.log('[MovieQuiz] 🔎 Поисковые запросы для подбора пула:', queries);
        for (const query of queries) {
            if (!this.isCurrentSession(sessionId) || movies.length >= MovieQuizGame.CANDIDATE_TARGET) break;
            try {
                const { docs = [] } = await service.searchMovies(query, 1, MovieQuizGame.SEARCH_RESULT_LIMIT, {
                    candidateLimit: MovieQuizGame.SEARCH_RESULT_LIMIT,
                    signal,
                    throwOnLimit: true
                });
                const eligible = docs.filter(candidate => {
                    const votes = Number(candidate?.votes?.kp) || 0;
                    return candidate?.kinopoiskId && candidate.name
                        && votes > MovieQuizGame.MIN_KP_VOTES
                        && !usedIds.has(String(candidate.kinopoiskId));
                });
                eligible.forEach(movie => {
                    const id = String(movie.kinopoiskId);
                    if (!fallbackMovies.some(candidate => String(candidate.kinopoiskId) === id)) fallbackMovies.push(movie);
                });
                let addedForQuery = 0;
                for (const movie of eligible) {
                    if (movies.length >= MovieQuizGame.CANDIDATE_TARGET) break;
                    const id = String(movie.kinopoiskId);
                    const name = this.normalizeTitle(movie.name);
                    if (!recentIds.has(id) && !usedIds.has(id) && !usedNames.has(name)) {
                        usedIds.add(id);
                        usedNames.add(name);
                        movies.push(movie);
                        addedForQuery += 1;
                        if (addedForQuery >= 2) break;
                    }
                }
            } catch (error) {
                if (MovieQuizGame.isAbortError(error)) throw error;
                if (MovieQuizGame.isLimitError(error)) throw error;
                lastError = error;
                // Continue with the remaining titles when one search request fails.
            }
        }

        // Recent history should improve variety, never make the game unavailable.
        for (const movie of fallbackMovies) {
            if (movies.length >= MovieQuizGame.CANDIDATE_TARGET) break;
            const id = String(movie.kinopoiskId);
            const name = this.normalizeTitle(movie.name);
            if (!usedIds.has(id) && !usedNames.has(name)) {
                usedIds.add(id);
                usedNames.add(name);
                movies.push(movie);
            }
        }
        if (movies.length < MovieQuizGame.ROUNDS && lastError) throw lastError;
        return movies;
    }

    async getRecentMovieIds() {
        try {
            const { movieQuizRecentIds = [] } = await chrome.storage.local.get('movieQuizRecentIds');
            return new Set(movieQuizRecentIds.map(String));
        } catch {
            return new Set();
        }
    }

    async saveRecentMovieIds() {
        try {
            const { movieQuizRecentIds = [] } = await chrome.storage.local.get('movieQuizRecentIds');
            const nextIds = [...this.movies.map(movie => String(movie.kinopoiskId)), ...movieQuizRecentIds];
            await chrome.storage.local.set({ movieQuizRecentIds: [...new Set(nextIds)].slice(0, 30) });
        } catch { /* Recent-question history is a progressive enhancement. */ }
    }

    shuffle(items) {
        return [...items].sort(() => Math.random() - 0.5);
    }

    async attachQuizFrames(service, movies, signal, sessionId) {
        const moviesWithFrames = [];
        const queue = [...movies];
        const worker = async () => {
            while (queue.length && moviesWithFrames.length < MovieQuizGame.ROUNDS && this.isCurrentSession(sessionId)) {
                const movie = queue.shift();
                try {
                    const frames = await service.getMovieImages(movie.kinopoiskId, { signal, throwOnLimit: true });
                    const urls = this.shuffle(frames
                        .map(frame => frame?.url || frame?.previewUrl || frame?.originalUrl || '')
                        .filter(url => /^https?:\/\//i.test(url)));
                    const quizImageUrl = await this.findLoadableImage(urls.slice(0, 3), signal);
                    if (quizImageUrl && this.isCurrentSession(sessionId)) {
                        moviesWithFrames.push({ ...movie, quizImageUrl });
                    }
                } catch (error) {
                    if (MovieQuizGame.isAbortError(error)) throw error;
                    if (MovieQuizGame.isLimitError(error)) throw error;
                    // A movie without an available frame is skipped to keep the quiz fair.
                }
            }
        };
        const workers = Array.from(
            { length: Math.min(MovieQuizGame.FRAME_CONCURRENCY, queue.length) },
            () => worker()
        );
        await Promise.all(workers);
        return moviesWithFrames;
    }

    async findLoadableImage(urls, signal) {
        for (const url of urls) {
            if (await MovieQuizGame.canLoadImage(url, signal)) return url;
        }
        return '';
    }

    static canLoadImage(url, signal) {
        if (typeof Image === 'undefined') return Promise.resolve(true);
        return new Promise((resolve, reject) => {
            const image = new Image();
            let settled = false;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeoutId);
                signal?.removeEventListener('abort', onAbort);
                image.onload = null;
                image.onerror = null;
                resolve(result);
            };
            const onAbort = () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeoutId);
                image.src = '';
                reject(new DOMException('Quiz image loading aborted', 'AbortError'));
            };
            const timeoutId = window.setTimeout(() => finish(false), MovieQuizGame.IMAGE_TIMEOUT_MS);
            image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
            image.onerror = () => finish(false);
            image.referrerPolicy = 'no-referrer';
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) onAbort();
            else image.src = url;
        });
    }

    static loadScript(path, globalName) {
        if (window[globalName]) return Promise.resolve();
        const existing = document.querySelector(`script[data-quiz-script="${path}"]`);
        if (existing) {
            if (existing.dataset.quizLoaded === 'true') {
                return Promise.reject(new Error(`Не удалось инициализировать ${globalName}`));
            }
            return new Promise((resolve, reject) => {
                existing.addEventListener('load', () => window[globalName] ? resolve() : reject(new Error(`Не удалось инициализировать ${globalName}`)), { once: true });
                existing.addEventListener('error', () => reject(new Error(`Не удалось загрузить ${path}`)), { once: true });
            });
        }
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL(path);
            script.dataset.quizScript = path;
            script.onload = () => {
                script.dataset.quizLoaded = 'true';
                window[globalName] ? resolve() : reject(new Error(`Не удалось инициализировать ${globalName}`));
            };
            script.onerror = () => reject(new Error(`Не удалось загрузить ${path}`));
            document.head.appendChild(script);
        });
    }

    /**
     * Extracts a normalized franchise root to avoid showing multiple installments
     * of the same franchise (e.g. "Матрица" and "Матрица: Воскрешение") in one question.
     */
    static getFranchiseKey(title) {
        if (!title) return '';
        let normalized = String(title).trim().toLowerCase().replace(/ё/g, 'е');
        normalized = normalized.split(/[:—–]| - |\s+\d+$|\s+(?:часть|фильм|сезон|эпизод)\s*\d*/i)[0].trim();
        normalized = normalized.replace(/^(гарри поттер|властелин колец|пираты карибского моря|звездные войны|индиана джонс|хроники нарнии|голодные игры|бегущий в лабиринте|трансформеры|люди икс|сумерки|человек-паук|темный рыцарь|мстители|матрица|хоббит|терминатор|парк юрского периода|бэтмен|шерлок холмс|джокер|один дома|назад в будущее)(?:\s.*|$)/i, '$1');
        normalized = normalized.replace(/\s+(?:[ivx]+|\d+)$/i, '').trim();
        return normalized;
    }

    getOptions(correct) {
        const correctId = String(correct.kinopoiskId);
        const correctName = this.normalizeTitle(correct.name);
        const correctFranchise = MovieQuizGame.getFranchiseKey(correct.name);

        const usedIds = new Set([correctId]);
        const usedNames = new Set([correctName]);
        const usedFranchisesInQuestion = new Set([correctFranchise]);
        const distractors = [];

        // Helper to extract genres as an array of lowercase strings
        const extractGenres = movie => {
            if (Array.isArray(movie?.genres)) {
                return movie.genres.map(g => (typeof g === 'object' ? g.name : g)).filter(Boolean).map(g => String(g).toLowerCase());
            }
            return [];
        };

        const targetGenres = new Set(extractGenres(correct));

        const tryAddCandidate = (candidate, allowCrossRoundReuse = false) => {
            if (distractors.length >= 3 || !candidate) return;
            const id = String(candidate.kinopoiskId || '');
            const normalizedName = this.normalizeTitle(candidate.name);
            const franchise = MovieQuizGame.getFranchiseKey(candidate.name);

            if (!id || !normalizedName || usedIds.has(id) || usedNames.has(normalizedName)) return;
            if (usedFranchisesInQuestion.has(franchise)) return;

            // Across the 5 rounds, avoid repeating options that were already shown in earlier rounds
            if (!allowCrossRoundReuse) {
                if (this.shownOptionIds.has(id) || this.shownOptionNames.has(normalizedName)) return;
                if (this.shownFranchises.has(franchise)) return;
            }

            usedIds.add(id);
            usedNames.add(normalizedName);
            usedFranchisesInQuestion.add(franchise);
            distractors.push(candidate);
        };

        // Combine all loaded candidates (distractorMovies + other movies in session)
        const sessionCandidates = [
            ...(this.distractorMovies || []),
            ...(this.movies || []).filter(m => String(m.kinopoiskId) !== correctId),
            ...(this.allCandidates || []).filter(m => String(m.kinopoiskId) !== correctId)
        ];

        // 1. Prioritize genre-matching candidates from loaded session pool
        if (targetGenres.size > 0) {
            const genreMatching = sessionCandidates.filter(m => {
                const genres = extractGenres(m);
                return genres.some(g => targetGenres.has(g));
            });
            this.shuffle(genreMatching).forEach(m => tryAddCandidate(m, false));
        }

        // 2. Any other loaded candidates from session pool (unshown this session)
        this.shuffle(sessionCandidates).forEach(m => tryAddCandidate(m, false));

        // 3. Fallback to curated iconic pool matching genre (unshown this session)
        if (distractors.length < 3) {
            const curatedMatching = MovieQuizGame.CURATED_FALLBACK_POOL.filter(m => {
                return m.genres.some(g => targetGenres.has(g));
            });
            this.shuffle(curatedMatching).forEach(m => tryAddCandidate(m, false));
        }

        // 4. Any curated fallback item (unshown this session)
        if (distractors.length < 3) {
            this.shuffle(MovieQuizGame.CURATED_FALLBACK_POOL).forEach(m => tryAddCandidate(m, false));
        }

        // 5. If still needed, relax session-level reuse (while strictly preserving in-question uniqueness)
        if (distractors.length < 3) {
            this.shuffle(sessionCandidates).forEach(m => tryAddCandidate(m, true));
        }
        if (distractors.length < 3) {
            this.shuffle(MovieQuizGame.CURATED_FALLBACK_POOL).forEach(m => tryAddCandidate(m, true));
        }

        // Register options into session-level tracking so they won't repeat in subsequent rounds
        this.shownOptionIds.add(correctId);
        this.shownOptionNames.add(correctName);
        this.shownFranchises.add(correctFranchise);
        distractors.forEach(d => {
            this.shownOptionIds.add(String(d.kinopoiskId));
            this.shownOptionNames.add(this.normalizeTitle(d.name));
            this.shownFranchises.add(MovieQuizGame.getFranchiseKey(d.name));
        });

        return this.shuffle([correct, ...distractors]);
    }

    normalizeTitle(title) {
        return String(title || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ');
    }

    dedupeMovies(movies) {
        const usedIds = new Set();
        const usedNames = new Set();
        return movies.filter(movie => {
            const id = String(movie?.kinopoiskId || '');
            const name = this.normalizeTitle(movie?.name);
            if (!id || !name || usedIds.has(id) || usedNames.has(name)) return false;
            usedIds.add(id);
            usedNames.add(name);
            return true;
        });
    }

    showRound() {
        const movie = this.movies[this.round % this.movies.length];
        const options = this.getOptions(movie);
        if (options.length !== 4) {
            console.error('[MovieQuiz] ❌ Не удалось сгенерировать 4 уникальных варианта ответа:', options);
            this.renderError('Не удалось подобрать четыре уникальных варианта ответа');
            return;
        }

        console.log(`[MovieQuiz] ▶️ Раунд ${this.round + 1}/${MovieQuizGame.ROUNDS}: Загадан фильм "${movie.name}" (ID: ${movie.kinopoiskId}, Франшиза: "${MovieQuizGame.getFranchiseKey(movie.name)}")`);
        console.log(`[MovieQuiz] 📋 Варианты ответа:`, options.map((opt, idx) => `[${idx + 1}] ${opt.name}`).join(' | '));

        this.isAnswered = false;
        this.panel.replaceChildren();
        const progress = document.createElement('div');
        progress.className = 'quiz-progress';
        progress.textContent = `Вопрос ${this.round + 1} из ${MovieQuizGame.ROUNDS}`;
        const image = document.createElement('img');
        image.className = 'quiz-poster quiz-frame';
        image.src = movie.quizImageUrl;
        image.alt = 'Кадр из фильма. Угадайте название.';
        image.referrerPolicy = 'no-referrer';
        image.onerror = () => {
            console.warn(`[MovieQuiz] ⚠️ Ошибка загрузки кадра по URL: ${movie.quizImageUrl}`);
            image.style.display = 'none';
        };
        const prompt = document.createElement('p');
        prompt.className = 'quiz-prompt';
        prompt.textContent = 'Угадайте фильм по кадру';
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'quiz-options';
        options.forEach((option, index) => {
            const button = document.createElement('button');
            button.className = 'quiz-option';
            button.type = 'button';
            button.dataset.id = String(option.kinopoiskId);
            const number = document.createElement('span');
            number.textContent = String(index + 1);
            button.append(number, document.createTextNode(option.name));
            button.addEventListener('click', () => this.answer(button, movie));
            optionsContainer.appendChild(button);
        });
        this.panel.append(progress, image, prompt, optionsContainer);
        this.callbacks.onStatsUpdate({ score: this.score, highScore: this.highScore, level: this.round + 1, lines: MovieQuizGame.ROUNDS });
        optionsContainer.querySelector('.quiz-option')?.focus({ preventScroll: true });
    }

    answer(button, correctMovie) {
        if (this.isAnswered) return;
        this.isAnswered = true;
        const isCorrect = String(button.dataset.id) === String(correctMovie.kinopoiskId);
        const selectedTitle = button.textContent.replace(/^\d+/, '').trim();
        console.log(`[MovieQuiz] 👤 Ответ игрока: "${selectedTitle}" -> ${isCorrect ? '✅ ВЕРНО (+100 очков)' : `❌ НЕВЕРНО (Правильный ответ: "${correctMovie.name}")`}. Текущий счет: ${this.score + (isCorrect ? 100 : 0)}`);

        this.panel.querySelectorAll('.quiz-option').forEach(option => {
            option.disabled = true;
            if (String(option.dataset.id) === String(correctMovie.kinopoiskId)) option.classList.add('correct');
        });
        if (isCorrect) {
            this.score += 100;
            button.classList.add('correct');
            this.audio.clear();
        } else {
            button.classList.add('incorrect');
            this.audio.gameOver();
        }
        const feedback = document.createElement('p');
        feedback.className = `quiz-feedback ${isCorrect ? 'is-correct' : 'is-incorrect'}`;
        feedback.textContent = isCorrect ? 'Верно!' : `Правильный ответ: ${correctMovie.name}`;
        this.panel.appendChild(feedback);
        this.highScore = Math.max(this.highScore, this.score);
        chrome.storage.local.set({ movieQuizHighScore: this.highScore });
        this.callbacks.onStatsUpdate({ score: this.score, highScore: this.highScore, level: this.round + 1, lines: MovieQuizGame.ROUNDS });
        const sessionId = this.sessionId;
        this.transitionTimer = window.setTimeout(() => {
            if (!this.isCurrentSession(sessionId)) return;
            this.round += 1;
            if (this.round < MovieQuizGame.ROUNDS) this.showRound();
            else this.showResult();
        }, MovieQuizGame.ANSWER_FEEDBACK_MS);
    }

    showResult() {
        console.log(`[MovieQuiz] 🏆 Сессия завершена! Итоговый счёт: ${this.score}/${MovieQuizGame.ROUNDS * 100}, Рекорд: ${this.highScore}`);
        const result = document.createElement('div');
        result.className = 'quiz-result';
        const label = document.createElement('span');
        label.textContent = 'РАУНД ЗАВЕРШЁН';
        const score = document.createElement('strong');
        score.textContent = String(this.score);
        const summary = document.createElement('p');
        summary.textContent = `Верных ответов: ${this.score / 100} из ${MovieQuizGame.ROUNDS}`;
        const restart = document.createElement('button');
        restart.className = 'game-btn-primary quiz-restart';
        restart.type = 'button';
        restart.textContent = 'Сыграть ещё';
        restart.addEventListener('click', () => this.restart());
        result.append(label, score, summary, restart);
        this.panel.replaceChildren(result);
        restart.focus({ preventScroll: true });
    }

    renderLoading() {
        const status = document.createElement('div');
        status.className = 'quiz-status';
        status.textContent = 'Подбираем фильмы и проверяем кадры…';
        this.panel.replaceChildren(status);
    }

    renderError(message) {
        console.error(`[MovieQuiz] ⚠️ Ошибка игры: ${message}`);
        const status = document.createElement('div');
        status.className = 'quiz-status quiz-error';
        const title = document.createElement('strong');
        title.textContent = 'Квиз пока недоступен';
        const details = document.createElement('span');
        details.textContent = message;
        const restart = document.createElement('button');
        restart.className = 'game-btn-primary quiz-restart';
        restart.type = 'button';
        restart.textContent = 'Попробовать снова';
        restart.addEventListener('click', () => this.restart());
        status.append(title, details, restart);
        this.panel.replaceChildren(status);
        restart.focus({ preventScroll: true });
    }

    getUserFacingError(error) {
        const presentation = window.ErrorPresentation?.getPresentation?.(error, {
            context: { operation: 'movie-quiz-load', category: 'provider' }
        });
        if (presentation?.message) return presentation.message;
        const message = String(error?.message || '');
        if (/DAILY_LIMIT_REACHED|429|суточн|limit/i.test(message)) return 'Лимит Кинопоиск API исчерпан. Попробуйте позже.';
        if (/network|failed to fetch|сеть/i.test(message)) return 'Нет соединения с Кинопоиск API. Проверьте интернет и попробуйте снова.';
        return message || 'Не удалось загрузить вопросы';
    }

    restart() {
        this.round = 0;
        this.score = 0;
        this.movies = [];
        this.distractorMovies = [];
        this.allCandidates = [];
        this.shownOptionIds.clear();
        this.shownOptionNames.clear();
        this.shownFranchises.clear();
        this.start();
    }

    render() { /* Quiz owns its HTML panel instead of the shared canvas. */ }
    togglePause() { /* Quiz waits for the next answer. */ }
    stop() {
        this.stopped = true;
        this.sessionId += 1;
        this.abortController?.abort();
        this.abortController = null;
        if (this.transitionTimer) window.clearTimeout(this.transitionTimer);
        this.transitionTimer = null;
        this.shownOptionIds?.clear();
        this.shownOptionNames?.clear();
        this.shownFranchises?.clear();
        if (this.panel) this.panel.replaceChildren();
    }
}

class SnakeGame {
    static GRID_SIZE = 20; // 20x20 cells
    static CELL_SIZE = 12; // 240x240 view in top half of canvas

    constructor(canvas, nextCanvas, callbacks, audio) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nextCanvas = nextCanvas;
        this.nextCtx = nextCanvas.getContext('2d');
        this.callbacks = callbacks;
        this.audio = audio;

        this.snake = [];
        this.dir = { x: 1, y: 0 };
        this.nextDir = { x: 1, y: 0 };
        this.food = { x: 0, y: 0, isGold: false };

        this.score = 0;
        this.applesEaten = 0;
        this.highScore = 0;

        this.isGameOver = false;
        this.isPaused = false;
        this.animFrameId = null;
        this.lastStepTime = 0;
        this.boostMultiplier = 1;

        this.loadHighScore();
        this.resetState();
    }

    async loadHighScore() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                const res = await chrome.storage.local.get('snakeHighScore');
                this.highScore = res.snakeHighScore || 0;
                this.callbacks.onStatsUpdate({ highScore: this.highScore });
            } catch { /* default */ }
        }
    }

    saveHighScore() {
        if (this.score > this.highScore) {
            this.highScore = this.score;
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ snakeHighScore: this.highScore });
            }
        }
    }

    resetState() {
        this.snake = [
            { x: 10, y: 10 },
            { x: 9, y: 10 },
            { x: 8, y: 10 }
        ];
        this.dir = { x: 1, y: 0 };
        this.nextDir = { x: 1, y: 0 };
        this.score = 0;
        this.applesEaten = 0;
        this.spawnFood();
        this.drawPreviewApple();
    }

    spawnFood() {
        let valid = false;
        while (!valid) {
            const rx = Math.floor(Math.random() * SnakeGame.GRID_SIZE);
            const ry = Math.floor(Math.random() * SnakeGame.GRID_SIZE);
            if (!this.snake.some(segment => segment.x === rx && segment.y === ry)) {
                this.food = {
                    x: rx,
                    y: ry,
                    isGold: (this.applesEaten > 0 && this.applesEaten % 5 === 0)
                };
                valid = true;
            }
        }
    }

    drawPreviewApple() {
        if (!this.nextCtx) return;
        this.nextCtx.clearRect(0, 0, this.nextCanvas.width, this.nextCanvas.height);
        
        // Draw centered apple icon
        const cx = this.nextCanvas.width / 2;
        const cy = this.nextCanvas.height / 2;
        this.nextCtx.fillStyle = this.food.isGold ? '#eab308' : '#ef4444';
        this.nextCtx.beginPath();
        this.nextCtx.arc(cx, cy, 14, 0, Math.PI * 2);
        this.nextCtx.fill();

        // Stem
        this.nextCtx.strokeStyle = '#15803d';
        this.nextCtx.lineWidth = 2;
        this.nextCtx.beginPath();
        this.nextCtx.moveTo(cx, cy - 14);
        this.nextCtx.quadraticCurveTo(cx + 4, cy - 20, cx + 8, cy - 18);
        this.nextCtx.stroke();
    }

    setDirection(dx, dy) {
        // Prevent 180-degree instant reversal
        if (dx === -this.dir.x && dy === -this.dir.y) return;
        this.nextDir = { x: dx, y: dy };
    }

    setBoost(isBoosting) {
        this.boostMultiplier = isBoosting ? 2.5 : 1;
    }

    step() {
        if (this.isPaused || this.isGameOver) return;
        this.dir = { ...this.nextDir };

        const head = {
            x: this.snake[0].x + this.dir.x,
            y: this.snake[0].y + this.dir.y
        };

        // Wall collision check
        if (head.x < 0 || head.x >= SnakeGame.GRID_SIZE || head.y < 0 || head.y >= SnakeGame.GRID_SIZE) {
            this.handleGameOver();
            return;
        }

        // Self collision check
        if (this.snake.some(seg => seg.x === head.x && seg.y === head.y)) {
            this.handleGameOver();
            return;
        }

        this.snake.unshift(head);

        // Food collision check
        if (head.x === this.food.x && head.y === this.food.y) {
            this.applesEaten++;
            const points = this.food.isGold ? 50 : 15;
            this.score += points;
            this.audio.eat();
            this.saveHighScore();

            this.callbacks.onStatsUpdate({
                score: this.score,
                lines: this.applesEaten, // using lines slot for apples count
                level: Math.floor(this.applesEaten / 5) + 1,
                highScore: this.highScore
            });

            this.spawnFood();
            this.drawPreviewApple();
        } else {
            this.snake.pop();
        }

        this.render();
    }

    handleGameOver() {
        this.isGameOver = true;
        this.audio.gameOver();
        this.saveHighScore();
        this.callbacks.onGameOver(this.score);
    }

    getStepInterval() {
        const baseSpeed = Math.max(60, 160 - Math.floor(this.applesEaten / 4) * 10);
        return baseSpeed / this.boostMultiplier;
    }

    start() {
        this.isPaused = false;
        this.isGameOver = false;
        this.lastStepTime = performance.now();
        const loop = (timestamp) => {
            if (!this.isPaused && !this.isGameOver) {
                if (timestamp - this.lastStepTime > this.getStepInterval()) {
                    this.step();
                    this.lastStepTime = timestamp;
                }
            }
            this.animFrameId = requestAnimationFrame(loop);
        };
        this.animFrameId = requestAnimationFrame(loop);
        this.render();
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        this.callbacks.onPauseToggle(this.isPaused);
        this.render();
    }

    stop() {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    render() {
        const cs = SnakeGame.CELL_SIZE;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const gridOffsetY = (this.canvas.height - (SnakeGame.GRID_SIZE * cs)) / 2; // Center 240x240 grid on 240x480 canvas

        // Background boundary fill
        this.ctx.fillStyle = '#05070a';
        this.ctx.fillRect(0, gridOffsetY, SnakeGame.GRID_SIZE * cs, SnakeGame.GRID_SIZE * cs);

        // Grid lines
        this.ctx.strokeStyle = 'rgba(34, 197, 94, 0.08)';
        this.ctx.lineWidth = 1;
        for (let i = 0; i <= SnakeGame.GRID_SIZE; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, gridOffsetY + i * cs);
            this.ctx.lineTo(SnakeGame.GRID_SIZE * cs, gridOffsetY + i * cs);
            this.ctx.stroke();

            this.ctx.beginPath();
            this.ctx.moveTo(i * cs, gridOffsetY);
            this.ctx.lineTo(i * cs, gridOffsetY + SnakeGame.GRID_SIZE * cs);
            this.ctx.stroke();
        }

        // Draw Food
        const fx = this.food.x * cs;
        const fy = gridOffsetY + this.food.y * cs;
        this.ctx.fillStyle = this.food.isGold ? '#eab308' : '#ef4444';
        this.ctx.beginPath();
        this.ctx.arc(fx + cs / 2, fy + cs / 2, cs / 2 - 1, 0, Math.PI * 2);
        this.ctx.fill();

        // Draw Snake Body & Head
        this.snake.forEach((seg, idx) => {
            const sx = seg.x * cs;
            const sy = gridOffsetY + seg.y * cs;
            if (idx === 0) {
                // Head
                this.ctx.fillStyle = '#4ade80';
                this.ctx.fillRect(sx + 1, sy + 1, cs - 2, cs - 2);
                // Eyes
                this.ctx.fillStyle = '#090b10';
                this.ctx.fillRect(sx + 3, sy + 3, 2, 2);
                this.ctx.fillRect(sx + cs - 5, sy + 3, 2, 2);
            } else {
                // Body
                this.ctx.fillStyle = idx % 2 === 0 ? '#22c55e' : '#16a34a';
                this.ctx.fillRect(sx + 1, sy + 1, cs - 2, cs - 2);
            }
        });
    }
}

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
        this.previouslyFocused = null;
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

        const modalHTML = `
            <div class="games-modal-overlay" id="gamesModalOverlay" role="presentation">
                <section class="games-modal-container" role="dialog" aria-modal="true" aria-labelledby="gamesModalTitle" tabindex="-1">
                    <div class="games-modal-header">
                        <div class="games-heading"><span class="games-eyebrow">МИНИ-ИГРЫ</span><h2 id="gamesModalTitle">Перерыв на один раунд</h2></div>
                        <div class="games-tab-bar" role="tablist" aria-label="Выбор игры">
                            <button class="game-tab-btn active" id="tabTetris" data-game="tetris" role="tab" aria-selected="true">
                                ${SVG_ICONS.TETRIS}
                                <span>Тетрис</span>
                            </button>
                            <button class="game-tab-btn" id="tabSnake" data-game="snake" role="tab" aria-selected="false">
                                ${SVG_ICONS.SNAKE}
                                <span>Змейка</span>
                            </button>
                            <button class="game-tab-btn game-2048-tab" id="tab2048" data-game="2048" role="tab" aria-selected="false">
                                ${SVG_ICONS.GAME_2048}
                                <span>2048</span>
                            </button>
                            <button class="game-tab-btn" id="tabQuiz" data-game="quiz" role="tab" aria-selected="false">
                                ${SVG_ICONS.QUIZ}
                                <span>Квиз</span>
                            </button>
                            <button class="game-tab-btn" id="tabWordGuess" data-game="word-guess" role="tab" aria-selected="false">
                                ${SVG_ICONS.WORD_GUESS}
                                <span>Слово</span>
                            </button>
                            <button class="game-tab-btn" id="tabRubiks" data-game="rubiks" role="tab" aria-selected="false">
                                ${SVG_ICONS.RUBIKS}
                                <span>Кубик</span>
                            </button>
                        </div>
                        <div class="games-modal-controls">
                            <button class="games-icon-btn" id="gamesMuteBtn" type="button" aria-label="Включить или выключить звук" title="Включить/Выключить звук">
                                ${SVG_ICONS.VOLUME_HIGH}
                            </button>
                            <button class="games-icon-btn games-close-btn" id="gamesCloseBtn" type="button" aria-label="Закрыть игры" title="Закрыть окно">
                                ${SVG_ICONS.CLOSE}
                            </button>
                        </div>
                    </div>
                    <div class="games-menu" id="gamesMenu" role="menu" aria-label="Мини-игры">
                        <div class="games-menu-copy">
                            <span class="games-menu-eyebrow">ВЫБЕРИТЕ РЕЖИМ</span>
                            <h3>Во что сыграем?</h3>
                            <p>Выберите игру, чтобы начать раунд.</p>
                        </div>
                        <div class="games-menu-grid">
                            <button class="game-menu-card game-menu-card--tetris" type="button" role="menuitem" data-game="tetris">
                                <span class="game-menu-icon">${SVG_ICONS.TETRIS}</span>
                                <span class="game-menu-card-copy"><strong>Тетрис</strong><small>Собирайте линии</small></span>
                                <span class="game-menu-arrow" aria-hidden="true">→</span>
                            </button>
                            <button class="game-menu-card game-menu-card--snake" type="button" role="menuitem" data-game="snake">
                                <span class="game-menu-icon">${SVG_ICONS.SNAKE}</span>
                                <span class="game-menu-card-copy"><strong>Змейка</strong><small>Собирайте яблоки</small></span>
                                <span class="game-menu-arrow" aria-hidden="true">→</span>
                            </button>
                            <button class="game-menu-card game-menu-card--2048" type="button" role="menuitem" data-game="2048">
                                <span class="game-menu-icon">${SVG_ICONS.GAME_2048}</span>
                                <span class="game-menu-card-copy"><strong>2048</strong><small>Объединяйте плитки</small></span>
                                <span class="game-menu-arrow" aria-hidden="true">→</span>
                            </button>
                            <button class="game-menu-card game-menu-card--quiz" type="button" role="menuitem" data-game="quiz">
                                <span class="game-menu-icon">${SVG_ICONS.QUIZ}</span>
                                <span class="game-menu-card-copy"><strong>Квиз</strong><small>Угадайте фильм</small></span>
                                <span class="game-menu-arrow" aria-hidden="true">→</span>
                            </button>
                            <button class="game-menu-card game-menu-card--word-guess" type="button" role="menuitem" data-game="word-guess">
                                <span class="game-menu-icon">${SVG_ICONS.WORD_GUESS}</span>
                                <span class="game-menu-card-copy"><strong>Слово</strong><small>Найдите ранг 1</small></span>
                                <span class="game-menu-arrow" aria-hidden="true">→</span>
                            </button>
                            <button class="game-menu-card game-menu-card--rubiks" type="button" role="menuitem" data-game="rubiks">
                                <span class="game-menu-icon">${SVG_ICONS.RUBIKS}</span>
                                <span class="game-menu-card-copy"><strong>Кубик Рубика</strong><small>Соберите за меньше ходов</small></span>
                                <span class="game-menu-arrow" aria-hidden="true">→</span>
                            </button>
                        </div>
                    </div>
                    <div class="games-play-view" id="gamesPlayView" hidden>
                        <button class="games-back-btn" id="gamesBackBtn" type="button">← Все игры</button>
                        <div class="games-modal-body">
                            <div class="movie-quiz" id="movieQuiz" aria-live="polite"></div>
                            <div class="word-guess-game" id="wordGuessGame" aria-live="polite"></div>
                            <!-- Canvas Viewport -->
                            <div class="game-canvas-wrapper" id="gameCanvasWrapper">
                                <canvas id="gameCanvas" width="240" height="480"></canvas>
                                <div class="rubiks-cube-game" id="rubiksCubeGame" aria-live="polite"></div>
                                <div class="game-overlay" id="gameOverlay" style="display: none;">
                                    <h3 class="game-overlay-title" id="gameOverlayTitle">GAME OVER</h3>
                                    <p class="game-overlay-score" id="gameOverlayScore">Score: 0</p>
                                    <button class="game-btn-primary" id="gameRestartBtn" type="button">Играть снова</button>
                                </div>
                            </div>

                            <!-- Sidebar Info -->
                            <div class="game-sidebar">
                                <div class="game-card" id="gamePreviewCard">
                                    <span class="game-card-label" id="gameNextLabel">Следующая фигура</span>
                                    <div class="game-next-wrapper">
                                        <canvas id="gameNextCanvas" width="80" height="80"></canvas>
                                    </div>
                                </div>
                                <div class="game-card">
                                    <span class="game-card-label" id="gameScoreLabel">Счет</span>
                                    <span class="game-card-value" id="gameScoreVal">0</span>
                                </div>
                                <div class="game-card">
                                    <span class="game-card-label">Рекорд</span>
                                    <span class="game-card-value" id="gameHighScoreVal">0</span>
                                </div>
                                <div class="game-card">
                                    <span class="game-card-label" id="gameSubStatLabel">Уровень / Линии</span>
                                    <span class="game-card-value" id="gameSubStatVal">1 / 0</span>
                                </div>
                                <div class="game-controls-guide" id="gameControlsGuide">
                                    <!-- Guide injected dynamically per active game -->
                                </div>
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
        const closeBtn = document.getElementById('gamesCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        const muteBtn = document.getElementById('gamesMuteBtn');
        if (muteBtn) {
            muteBtn.addEventListener('click', () => {
                this.audio.setMuted(!this.audio.muted);
                muteBtn.innerHTML = this.audio.muted ? SVG_ICONS.VOLUME_MUTE : SVG_ICONS.VOLUME_HIGH;
            });
        }

        const restartBtn = document.getElementById('gameRestartBtn');
        if (restartBtn) {
            restartBtn.addEventListener('click', () => this.startNewGame());
        }

        document.querySelectorAll('.game-menu-card').forEach(card => {
            card.addEventListener('click', () => this.switchGame(card.dataset.game));
        });

        const backBtn = document.getElementById('gamesBackBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.showGameMenu());
        }

        // Tab switches
        const tabTetris = document.getElementById('tabTetris');
        const tabSnake = document.getElementById('tabSnake');
        const tab2048 = document.getElementById('tab2048');
        const tabQuiz = document.getElementById('tabQuiz');
        const tabWordGuess = document.getElementById('tabWordGuess');
        const tabRubiks = document.getElementById('tabRubiks');

        if (tabTetris && tabSnake && tab2048 && tabQuiz && tabWordGuess && tabRubiks) {
            [tabTetris, tabSnake, tab2048, tabQuiz, tabWordGuess, tabRubiks].forEach(tab => {
                tab.addEventListener('click', () => this.switchGame(tab.dataset.game));
            });
        }

        this.overlay.addEventListener('mousedown', (e) => {
            if (e.target === this.overlay) {
                this.close();
            }
        });
    }

    switchGame(gameType) {
        if (!['tetris', 'snake', '2048', 'quiz', 'word-guess', 'rubiks'].includes(gameType)) return;
        if (this.activeGame === gameType && this.game) return;
        this.activeGame = gameType;

        const tabTetris = document.getElementById('tabTetris');
        const tabSnake = document.getElementById('tabSnake');
        const tab2048 = document.getElementById('tab2048');
        const tabQuiz = document.getElementById('tabQuiz');
        const tabWordGuess = document.getElementById('tabWordGuess');
        const tabRubiks = document.getElementById('tabRubiks');
        const wrapper = document.getElementById('gameCanvasWrapper');
        const container = document.querySelector('.games-modal-container');
        const restartBtn = document.getElementById('gameRestartBtn');
        const canvas = document.getElementById('gameCanvas');
        const menu = document.getElementById('gamesMenu');
        const playView = document.getElementById('gamesPlayView');

        if (menu) menu.hidden = true;
        if (playView) playView.hidden = false;
        document.querySelector('.games-modal-container')?.classList.remove('menu-mode');

        [tabTetris, tabSnake, tab2048, tabQuiz, tabWordGuess, tabRubiks].forEach(tab => {
            const isActive = tab?.dataset.game === gameType;
            tab?.classList.toggle('active', isActive);
            tab?.setAttribute('aria-selected', String(isActive));
        });
        if (wrapper) wrapper.className = `game-canvas-wrapper ${this.getGameModeClass(gameType)}`;
        if (container) {
            container.classList.toggle('square-game', gameType === 'snake' || gameType === '2048');
            container.classList.toggle('quiz-game', gameType === 'quiz');
            container.classList.toggle('word-guess-game-mode', gameType === 'word-guess');
            container.classList.toggle('rubiks-game-mode', gameType === 'rubiks');
        }
        if (restartBtn) restartBtn.className = `game-btn-primary ${gameType === 'snake' ? 'snake-btn' : gameType === '2048' ? 'game-2048-btn' : ''}`;
        if (canvas) {
            canvas.width = 240;
            canvas.height = gameType === 'tetris' ? 480 : 240;
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
        const tabs = document.querySelectorAll('.game-tab-btn');

        if (menu) menu.hidden = false;
        if (playView) playView.hidden = true;
        container?.classList.add('menu-mode');
        container?.classList.remove('square-game', 'quiz-game', 'word-guess-game-mode', 'rubiks-game-mode');
        tabs.forEach(tab => {
            tab.classList.remove('active');
            tab.setAttribute('aria-selected', 'false');
        });
    }

    updateSidebarLabels() {
        const nextLabel = document.getElementById('gameNextLabel');
        const scoreLabel = document.getElementById('gameScoreLabel');
        const subStatLabel = document.getElementById('gameSubStatLabel');
        const guideContainer = document.getElementById('gameControlsGuide');

        const previewCard = document.getElementById('gamePreviewCard');
        if (this.activeGame === 'word-guess') {
            if (scoreLabel) scoreLabel.textContent = 'Попытки';
            previewCard?.classList.add('is-hidden');
            if (nextLabel) nextLabel.textContent = 'Слово дня';
            if (subStatLabel) subStatLabel.textContent = 'Лучший ранг';
            if (guideContainer) {
                guideContainer.innerHTML = `
                    <div class="game-control-row"><span>Ввод</span> <span class="game-key">Слово + Enter</span></div>
                    <div class="game-control-row"><span>Цель</span> <span class="game-key">Ранг 1</span></div>
                `;
            }
        } else if (this.activeGame === 'tetris') {
            if (scoreLabel) scoreLabel.textContent = 'Счет';
            previewCard?.classList.remove('is-hidden');
            if (nextLabel) nextLabel.textContent = 'Следующая фигура';
            if (subStatLabel) subStatLabel.textContent = 'Уровень / Линии';
            if (guideContainer) {
                guideContainer.innerHTML = `
                    <div class="game-control-row"><span>Движение</span> <span class="game-key">← →</span></div>
                    <div class="game-control-row"><span>Поворот</span> <span class="game-key">↑</span></div>
                    <div class="game-control-row"><span>Ускорить</span> <span class="game-key">↓</span></div>
                    <div class="game-control-row"><span>Сбросить</span> <span class="game-key">Space</span></div>
                    <div class="game-control-row"><span>Пауза</span> <span class="game-key">P</span></div>
                `;
            }
        } else if (this.activeGame === 'snake') {
            if (scoreLabel) scoreLabel.textContent = 'Счет';
            previewCard?.classList.add('is-hidden');
            if (nextLabel) nextLabel.textContent = 'Яблоко';
            if (subStatLabel) subStatLabel.textContent = 'Уровень / Яблоки';
            if (guideContainer) {
                guideContainer.innerHTML = `
                    <div class="game-control-row"><span>Движение</span> <span class="game-key">WASD / Стрелки</span></div>
                    <div class="game-control-row"><span>Ускорение</span> <span class="game-key">Удерживать Space</span></div>
                    <div class="game-control-row"><span>Пауза</span> <span class="game-key">P</span></div>
                `;
            }
        } else if (this.activeGame === 'rubiks') {
            if (scoreLabel) scoreLabel.textContent = 'Ходы';
            previewCard?.classList.add('is-hidden');
            if (nextLabel) nextLabel.textContent = 'Перемешивание';
            if (subStatLabel) subStatLabel.textContent = 'Время';
            if (guideContainer) {
                guideContainer.innerHTML = `
                    <div class="game-control-row"><span>Обзор</span> <span class="game-key">Зажать + тянуть</span></div>
                    <div class="game-control-row"><span>Ось</span> <span class="game-key">↔ или ↕</span></div>
                    <div class="game-control-row"><span>Ход</span> <span class="game-key">Стрелка</span></div>
                `;
            }
        } else {
            if (scoreLabel) scoreLabel.textContent = 'Счет';
            previewCard?.classList.add('is-hidden');
            if (subStatLabel) subStatLabel.textContent = this.activeGame === 'quiz' ? 'Раунд' : 'Лучшая плитка';
            if (guideContainer) {
                guideContainer.innerHTML = this.activeGame === 'quiz' ? `
                    <div class="game-control-row"><span>Выберите ответ</span> <span class="game-key">1–4</span></div>
                    <div class="game-control-row"><span>Серия</span> <span class="game-key">5 вопросов</span></div>
                ` : `
                    <div class="game-control-row"><span>Движение</span> <span class="game-key">WASD / Стрелки</span></div>
                    <div class="game-control-row"><span>Пауза</span> <span class="game-key">P</span></div>
                `;
            }
        }
    }

    getGameModeClass(gameType = this.activeGame) {
        return gameType === '2048' ? 'game-2048-mode' : `${gameType}-mode`;
    }

    handleKeyDown(e) {
        if (!this.overlay || !this.overlay.classList.contains('active')) return;
        if (e.key === 'Tab') {
            const focusable = [...this.overlay.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
            const currentIndex = focusable.indexOf(document.activeElement);
            const nextIndex = e.shiftKey
                ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
                : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
            e.preventDefault();
            focusable[nextIndex]?.focus();
            return;
        }
        if (e.key === 'Escape') {
            this.close();
            return;
        }
        if (!this.game) return;

        if (this.activeGame === 'word-guess') {
            if (e.key === 'Escape') this.close();
            return;
        }

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'p', 'P', 'KeyP', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.key) || e.code === 'Space') {
            e.preventDefault();
        }

        if (this.activeGame === 'tetris') {
            switch (e.key) {
                case 'ArrowLeft': case 'a': case 'A': this.game.moveLeft(); break;
                case 'ArrowRight': case 'd': case 'D': this.game.moveRight(); break;
                case 'ArrowUp': case 'w': case 'W': this.game.rotate(); break;
                case 'ArrowDown': case 's': case 'S': this.game.softDrop(); break;
                case ' ': this.game.hardDrop(); break;
                case 'p': case 'P': this.game.togglePause(); break;
                case 'Escape': this.close(); break;
            }
        } else if (this.activeGame === 'snake') {
            switch (e.key) {
                case 'ArrowUp': case 'w': case 'W': this.game.setDirection(0, -1); break;
                case 'ArrowDown': case 's': case 'S': this.game.setDirection(0, 1); break;
                case 'ArrowLeft': case 'a': case 'A': this.game.setDirection(-1, 0); break;
                case 'ArrowRight': case 'd': case 'D': this.game.setDirection(1, 0); break;
                case ' ': this.game.setBoost(true); break;
                case 'p': case 'P': this.game.togglePause(); break;
                case 'Escape': this.close(); break;
            }
        } else if (this.activeGame === '2048') {
            switch (e.key) {
                case 'ArrowUp': case 'w': case 'W': this.game.move(0, -1); break;
                case 'ArrowDown': case 's': case 'S': this.game.move(0, 1); break;
                case 'ArrowLeft': case 'a': case 'A': this.game.move(-1, 0); break;
                case 'ArrowRight': case 'd': case 'D': this.game.move(1, 0); break;
                case 'p': case 'P': this.game.togglePause(); break;
                case 'Escape': this.close(); break;
            }
        } else if (this.activeGame === 'rubiks') {
            const moveMatch = e.key.toUpperCase().match(/^[URFDLB]$/);
            if (moveMatch) {
                const suffix = e.shiftKey ? "'" : e.key === '2' ? '2' : '';
                this.game.turn(`${moveMatch[0]}${suffix}`);
            } else if (e.key === '2') {
                // A double turn is handled by the next face key through the button UI.
                return;
            }
        } else if (this.activeGame === 'quiz') {
            const numMatch = e.key.match(/^[1-4]$/) || (e.code && e.code.match(/^Numpad([1-4])$/));
            if (numMatch) {
                const digit = numMatch[1] || numMatch[0];
                document.querySelector(`#movieQuiz .quiz-option:nth-child(${digit})`)?.click();
            }
        }
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

        this.showGameMenu();
        document.querySelector('.games-modal-container')?.focus();
    }

    startNewGame() {
        if (!this.activeGame) return;
        const overlay = document.getElementById('gameOverlay');
        if (overlay) overlay.style.display = 'none';

        if (this.game) {
            this.game.stop();
        }

        const canvas = document.getElementById('gameCanvas');
        const nextCanvas = document.getElementById('gameNextCanvas');
        const wrapper = document.getElementById('gameCanvasWrapper');

        if (canvas) {
            canvas.width = 240;
            canvas.height = this.activeGame === 'tetris' ? 480 : 240;
        }
        if (wrapper) {
            wrapper.className = `game-canvas-wrapper ${this.getGameModeClass()}`;
        }

        const scoreEl = document.getElementById('gameScoreVal');
        const highScoreEl = document.getElementById('gameHighScoreVal');
        const subStatEl = document.getElementById('gameSubStatVal');

        const callbacks = {
            onStatsUpdate: (stats) => {
                if (stats.score !== undefined && scoreEl) scoreEl.textContent = stats.score;
                if (stats.highScore !== undefined && highScoreEl) {
                    highScoreEl.textContent = this.activeGame === 'word-guess' && !stats.highScore
                        ? '—'
                        : stats.highScore;
                }
                if (subStatEl) {
                    subStatEl.textContent = this.activeGame === 'word-guess'
                        ? (stats.highScore ? String(stats.highScore) : '—')
                        : this.activeGame === '2048'
                        ? String(stats.level || 0)
                        : this.activeGame === 'rubiks'
                        ? (stats.time || '0:00')
                        : `${stats.level || 1} / ${stats.lines || 0}`;
                }
            },
            onGameOver: (finalScore) => {
                const ov = document.getElementById('gameOverlay');
                const title = document.getElementById('gameOverlayTitle');
                const scoreMsg = document.getElementById('gameOverlayScore');
                if (ov && title && scoreMsg) {
                    title.textContent = 'GAME OVER';
                    title.className = 'game-overlay-title';
                    scoreMsg.textContent = `Итоговый счет: ${finalScore}`;
                    ov.style.display = 'flex';
                }
            },
            onPauseToggle: (isPaused) => {
                const ov = document.getElementById('gameOverlay');
                const title = document.getElementById('gameOverlayTitle');
                const scoreMsg = document.getElementById('gameOverlayScore');
                if (ov && title && scoreMsg) {
                    if (isPaused) {
                        title.textContent = 'ПАУЗА';
                        title.className = 'game-overlay-title pause-title';
                        scoreMsg.textContent = 'Нажмите P для продолжения';
                        ov.style.display = 'flex';
                    } else {
                        ov.style.display = 'none';
                    }
                }
            },
            onSolved: ({ moves, time }) => {
                const ov = document.getElementById('gameOverlay');
                const title = document.getElementById('gameOverlayTitle');
                const scoreMsg = document.getElementById('gameOverlayScore');
                if (ov && title && scoreMsg) {
                    title.textContent = 'КУБИК СОБРАН';
                    title.className = 'game-overlay-title rubiks-solved-title';
                    scoreMsg.textContent = `${moves} ходов · ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
                    ov.style.display = 'flex';
                }
            }
        };

        if (this.activeGame === 'tetris') {
            this.game = new TetrisGame(canvas, nextCanvas, callbacks, this.audio);
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
        if (this.overlay) {
            this.overlay.classList.remove('active');
        }
        document.removeEventListener('keydown', this.keyHandler);
        document.removeEventListener('keyup', this.keyUpHandler);
        if (this.game) {
            this.game.stop();
            this.game = null;
        }
        this.activeGame = null;
        this.previouslyFocused?.focus?.();
    }
}
