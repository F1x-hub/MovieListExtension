/**
 * Asks the chess bot for a move. The search runs in ChessBotWorker.js; a newer
 * request or `cancel()` terminates the worker, so a thought about a position
 * that is gone never lands. Without workers (tests, a blocked worker) the bot
 * runs on the page, which pauses it for the length of one search.
 */

const WORKER_URL = new URL('./ChessBotWorker.js', import.meta.url);

export class ChessBotCancelled extends Error {
    constructor() {
        super('The bot request was cancelled');
        this.name = 'ChessBotCancelled';
        this.code = 'CANCELLED';
    }
}

export class ChessBotClient {
    constructor({ WorkerImpl = globalThis.Worker, workerUrl = WORKER_URL } = {}) {
        this.WorkerImpl = typeof WorkerImpl === 'function' ? WorkerImpl : null;
        this.workerUrl = workerUrl;
        this.worker = null;
        this.pending = null;
        this.nextId = 1;
    }

    /**
     * @param {{ moves: string[], level?: number, hint?: boolean }} request
     * @returns {Promise<{ uci: string, san: string, score: number, depth: number }|null>}
     */
    request({ moves, level = 3, hint = false }) {
        this.cancel();
        const id = this.nextId++;
        const message = { id, moves: [...moves], level, hint };
        return new Promise((resolve, reject) => {
            this.pending = { id, message, resolve, reject };
            const worker = this.ensureWorker();
            if (worker) worker.postMessage(message);
            else this.runOnPage(message);
        });
    }

    /** Fallback: think on the page after this frame. */
    runOnPage(message) {
        setTimeout(async () => {
            if (this.pending?.id !== message.id) return;
            try {
                if (!globalThis.ChessBot) await import('./ChessBot.js');
                const result = globalThis.ChessBot.chooseMove({ moves: message.moves, level: message.level, hint: message.hint });
                this.settle(message.id, { ok: true, result });
            } catch (error) {
                this.settle(message.id, { ok: false, error: String(error?.message || error) });
            }
        }, 0);
    }

    ensureWorker() {
        if (this.worker || !this.WorkerImpl) return this.worker;
        try {
            const worker = new this.WorkerImpl(this.workerUrl);
            worker.addEventListener('message', event => this.settle(event.data?.id, event.data || {}));
            worker.addEventListener('error', event => {
                console.warn('[ChessBot] worker failed, thinking on the page', event?.message || event);
                event?.preventDefault?.();
                worker.terminate();
                if (this.worker === worker) this.worker = null;
                this.WorkerImpl = null;
                // The request in flight is answered on the page instead.
                if (this.pending) this.runOnPage(this.pending.message);
            });
            this.worker = worker;
        } catch (error) {
            console.warn('[ChessBot] workers unavailable, thinking on the page', error);
            this.worker = null;
            this.WorkerImpl = null;
        }
        return this.worker;
    }

    settle(id, answer) {
        const pending = this.pending;
        if (!pending || pending.id !== id) return;
        this.pending = null;
        if (answer.ok) pending.resolve(answer.result || null);
        else pending.reject(new Error(answer.error || 'The bot could not move'));
    }

    /** Drops the request in flight; its promise rejects with ChessBotCancelled. */
    cancel() {
        const pending = this.pending;
        this.pending = null;
        if (pending) {
            // A worker deep in a search cannot be interrupted; start a fresh one next time.
            this.worker?.terminate();
            this.worker = null;
            pending.reject(new ChessBotCancelled());
        }
    }

    dispose() {
        this.cancel();
        this.worker?.terminate();
        this.worker = null;
    }
}
