import { getCanvasViewSize } from './gamesI18n.js';

export class SnakeGame {
    static GRID_SIZE = 20; // 20x20 cells
    // Direction changes typed faster than one step are queued, up to this many.
    static MAX_QUEUED_TURNS = 2;

    constructor(canvas, nextCanvas, callbacks, audio) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nextCanvas = nextCanvas;
        this.nextCtx = nextCanvas?.getContext('2d') || null;
        this.callbacks = callbacks;
        this.audio = audio;

        this.snake = [];
        this.dir = { x: 1, y: 0 };
        this.turnQueue = [];
        this.food = { x: 0, y: 0, isGold: false };

        this.score = 0;
        this.applesEaten = 0;
        this.highScore = 0;

        this.isGameOver = false;
        this.isWon = false;
        this.isPaused = false;
        this.animFrameId = null;
        this.lastStepTime = 0;
        this.boostMultiplier = 1;

        this.loadHighScore();
        this.resetState();
    }

    get cellSize() {
        return getCanvasViewSize(this.canvas).width / SnakeGame.GRID_SIZE;
    }

    async loadHighScore() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                const res = await chrome.storage.local.get('snakeHighScore');
                this.highScore = res?.snakeHighScore || 0;
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
        this.turnQueue = [];
        this.score = 0;
        this.applesEaten = 0;
        this.spawnFood();
    }

    /** Places food on a random free cell; returns false when the board is full. */
    spawnFood() {
        const free = [];
        for (let y = 0; y < SnakeGame.GRID_SIZE; y++) {
            for (let x = 0; x < SnakeGame.GRID_SIZE; x++) {
                if (!this.snake.some(segment => segment.x === x && segment.y === y)) free.push({ x, y });
            }
        }
        if (!free.length) return false;
        const cell = free[Math.floor(Math.random() * free.length)];
        this.food = { ...cell, isGold: this.applesEaten > 0 && this.applesEaten % 5 === 0 };
        return true;
    }

    setDirection(dx, dy) {
        // Validate against the last queued turn so quick two-key turns are kept.
        const last = this.turnQueue[this.turnQueue.length - 1] || this.dir;
        if ((dx === last.x && dy === last.y) || (dx === -last.x && dy === -last.y)) return;
        if (this.turnQueue.length >= SnakeGame.MAX_QUEUED_TURNS) return;
        this.turnQueue.push({ x: dx, y: dy });
    }

    setBoost(isBoosting) {
        this.boostMultiplier = isBoosting ? 2.5 : 1;
    }

    step() {
        if (this.isPaused || this.isGameOver) return;
        if (this.turnQueue.length) this.dir = this.turnQueue.shift();

        const head = {
            x: this.snake[0].x + this.dir.x,
            y: this.snake[0].y + this.dir.y
        };

        if (head.x < 0 || head.x >= SnakeGame.GRID_SIZE || head.y < 0 || head.y >= SnakeGame.GRID_SIZE) {
            this.handleGameOver();
            return;
        }

        // The tail moves away this step unless the head eats, so it is not an obstacle.
        const eats = head.x === this.food.x && head.y === this.food.y;
        const body = eats ? this.snake : this.snake.slice(0, -1);
        if (body.some(seg => seg.x === head.x && seg.y === head.y)) {
            this.handleGameOver();
            return;
        }

        this.snake.unshift(head);

        if (eats) {
            this.applesEaten++;
            this.score += this.food.isGold ? 50 : 15;
            this.audio.eat();
            this.saveHighScore();

            this.callbacks.onStatsUpdate({
                score: this.score,
                lines: this.applesEaten,
                level: Math.floor(this.applesEaten / 5) + 1,
                highScore: this.highScore
            });

            if (!this.spawnFood()) {
                this.handleGameOver({ won: true });
                return;
            }
        } else {
            this.snake.pop();
        }

        this.render();
    }

    handleGameOver({ won = false } = {}) {
        this.isGameOver = true;
        this.isWon = won;
        if (won) this.audio.clear();
        else this.audio.gameOver();
        this.saveHighScore();
        this.render();
        this.callbacks.onGameOver(this.score, { won });
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
        if (this.isGameOver) return;
        this.isPaused = !this.isPaused;
        if (!this.isPaused) this.lastStepTime = performance.now();
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
        const cs = this.cellSize;
        const { width, height } = getCanvasViewSize(this.canvas);
        const boardSize = SnakeGame.GRID_SIZE * cs;
        const gridOffsetY = (height - boardSize) / 2;
        this.ctx.clearRect(0, 0, width, height);

        this.ctx.fillStyle = '#05070a';
        this.ctx.fillRect(0, gridOffsetY, boardSize, boardSize);

        this.ctx.strokeStyle = 'rgba(34, 197, 94, 0.08)';
        this.ctx.lineWidth = 1;
        for (let i = 0; i <= SnakeGame.GRID_SIZE; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, gridOffsetY + i * cs);
            this.ctx.lineTo(boardSize, gridOffsetY + i * cs);
            this.ctx.stroke();

            this.ctx.beginPath();
            this.ctx.moveTo(i * cs, gridOffsetY);
            this.ctx.lineTo(i * cs, gridOffsetY + boardSize);
            this.ctx.stroke();
        }

        if (!this.isWon) {
            const fx = this.food.x * cs;
            const fy = gridOffsetY + this.food.y * cs;
            this.ctx.fillStyle = this.food.isGold ? '#eab308' : '#ef4444';
            this.ctx.beginPath();
            this.ctx.arc(fx + cs / 2, fy + cs / 2, cs / 2 - 1, 0, Math.PI * 2);
            this.ctx.fill();
        }

        const eye = Math.max(2, Math.round(cs / 6));
        this.snake.forEach((seg, idx) => {
            const sx = seg.x * cs;
            const sy = gridOffsetY + seg.y * cs;
            if (idx === 0) {
                this.ctx.fillStyle = '#4ade80';
                this.ctx.fillRect(sx + 1, sy + 1, cs - 2, cs - 2);
                this.ctx.fillStyle = '#090b10';
                this.ctx.fillRect(sx + eye + 1, sy + eye + 1, eye, eye);
                this.ctx.fillRect(sx + cs - eye * 2 - 1, sy + eye + 1, eye, eye);
            } else {
                this.ctx.fillStyle = idx % 2 === 0 ? '#22c55e' : '#16a34a';
                this.ctx.fillRect(sx + 1, sy + 1, cs - 2, cs - 2);
            }
        });
    }
}
