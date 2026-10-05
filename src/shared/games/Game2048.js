import { getCanvasViewSize } from './gamesI18n.js';

export class Game2048 {
    static SIZE = 4;
    static WIN_TILE = 2048;
    static COLORS = {
        0: '#1c202b', 2: '#3b4252', 4: '#475569', 8: '#8b5cf6', 16: '#7c3aed',
        32: '#db2777', 64: '#e11d48', 128: '#f59e0b', 256: '#f97316', 512: '#22c55e',
        1024: '#06b6d4', 2048: '#eab308'
    };

    /** Font size that keeps any tile value inside its tile. */
    static getTileFontSize(value, tileSize) {
        const digits = String(value).length;
        const ratio = digits <= 2 ? 0.5 : digits === 3 ? 0.42 : digits === 4 ? 0.34 : 0.27;
        return Math.round(tileSize * ratio);
    }

    constructor(canvas, callbacks, audio) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.callbacks = callbacks;
        this.audio = audio;
        this.grid = Array.from({ length: Game2048.SIZE }, () => Array(Game2048.SIZE).fill(0));
        this.score = 0;
        this.highScore = 0;
        this.savedHighScore = 0;
        this.isGameOver = false;
        this.isPaused = false;
        this.hasWon = false;
        this.awaitingContinue = false;
        this.animation = null;
        this.animationFrame = null;
        this.loadHighScore();
        this.addTile();
        this.addTile();
    }

    async loadHighScore() {
        try {
            const res = await chrome.storage.local.get('game2048HighScore');
            this.savedHighScore = res?.game2048HighScore || 0;
            this.highScore = Math.max(this.highScore, this.savedHighScore);
            this.callbacks.onStatsUpdate({ highScore: this.highScore });
        } catch { /* Local score is optional. */ }
    }

    /** Persists the record only when it improves, not on every move. */
    saveHighScore() {
        if (this.score <= this.savedHighScore) return;
        this.savedHighScore = this.score;
        try {
            chrome.storage.local.set({ game2048HighScore: this.score });
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
        if (this.isPaused || this.isGameOver || this.awaitingContinue || this.animation) return;
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
        this.saveHighScore();
        this.audio.move();
        this.callbacks.onStatsUpdate({ score: this.score, highScore: this.highScore, level: this.getMaxTile(), lines: 0 });
        this.startMoveAnimation(previousGrid, movingTiles);
    }

    getMaxTile() { return Math.max(...this.grid.flat()); }

    hasMoves() {
        return this.grid.some((row, y) => row.some((value, x) => !value || (x < 3 && value === row[x + 1]) || (y < 3 && value === this.grid[y + 1][x])));
    }

    togglePause() {
        if (this.isGameOver || this.awaitingContinue) return;
        this.isPaused = !this.isPaused;
        this.callbacks.onPauseToggle(this.isPaused);
    }

    /** Resumes play after the 2048 tile; later tiles keep the score growing. */
    continueAfterWin() {
        this.awaitingContinue = false;
    }

    finishMove() {
        this.addTile();
        this.isGameOver = !this.hasMoves();
        this.callbacks.onStatsUpdate({ score: this.score, highScore: this.highScore, level: this.getMaxTile() });
        this.render();
        if (!this.hasWon && this.getMaxTile() >= Game2048.WIN_TILE) {
            this.hasWon = true;
            if (!this.isGameOver) {
                this.awaitingContinue = true;
                this.audio.clear();
                this.callbacks.onWin?.(this.score);
                return;
            }
        }
        if (this.isGameOver) this.callbacks.onGameOver(this.score);
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
            this.finishMove();
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
        const { width, height } = getCanvasViewSize(this.canvas);
        const cell = width / Game2048.SIZE;
        const gap = Math.round(cell / 13);
        this.ctx.fillStyle = '#090b10';
        this.ctx.fillRect(0, 0, width, height);
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
        if (typeof this.ctx.roundRect === 'function') this.ctx.roundRect(px, py, size, size, Math.round(size / 6));
        else this.ctx.rect(px, py, size, size);
        this.ctx.fill();
        if (!value) return;
        this.ctx.fillStyle = value <= 4 ? '#e5e7eb' : value > 2048 ? '#111827' : '#fff';
        this.ctx.font = `700 ${Game2048.getTileFontSize(value, size)}px Outfit, sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(value, px + size / 2, py + size / 2 + 1);
    }
}
