/**
 * Shared local storage owner for the Random page movie pool.
 *
 * The pool is intentionally device-local: it contains only the compact movie
 * metadata needed by the Random page and never depends on authentication.
 */
class RandomPoolService {
    static _writeQueue = Promise.resolve();

    static get storageKey() {
        return 'randomPool';
    }

    static normalizeId(value) {
        const id = Number(value);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    static getMovieId(movieOrId) {
        if (movieOrId && typeof movieOrId === 'object') {
            return this.normalizeId(movieOrId.kinopoiskId ?? movieOrId.kpId ?? movieOrId.movieId ?? movieOrId.id);
        }
        return this.normalizeId(movieOrId);
    }

    static isInPool(pool, movieOrId) {
        const movieId = this.getMovieId(movieOrId);
        if (!movieId || !Array.isArray(pool)) return false;
        return pool.some(item => this.getMovieId(item) === movieId);
    }

    static normalizePool(pool) {
        if (!Array.isArray(pool)) return [];

        const normalized = [];
        const seenIds = new Set();
        for (const item of pool) {
            const movieId = this.getMovieId(item);
            if (!movieId || seenIds.has(movieId)) continue;

            seenIds.add(movieId);
            normalized.push({ ...item, kpId: movieId });
        }
        return normalized;
    }

    static createEntry(movie) {
        const movieId = this.getMovieId(movie);
        if (!movieId) return null;

        const rawRating = movie.kpRating ?? movie.rating;
        const numericRating = Number(rawRating);
        return {
            kpId: movieId,
            title: movie.name || movie.title || movie.alternativeName || '',
            year: movie.year ?? null,
            poster: movie.posterUrl || movie.poster || movie.posterPath || '',
            rating: Number.isFinite(numericRating) ? numericRating : null,
            addedAt: new Date().toISOString()
        };
    }

    static async getPool() {
        const data = await chrome.storage.local.get(this.storageKey);
        return this.normalizePool(data[this.storageKey]);
    }

    static async _writePool(pool) {
        const normalizedPool = this.normalizePool(pool);
        await chrome.storage.local.set({ [this.storageKey]: normalizedPool });
        return normalizedPool;
    }

    static async _withPoolLock(operation) {
        if (typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function') {
            return navigator.locks.request(this.storageKey, operation);
        }

        // Older runtimes retain page-local serialization; cross-page mutations
        // require the shared origin lock supplied by Web Locks.
        const pending = this._writeQueue.then(operation);
        this._writeQueue = pending.catch(() => {});
        return pending;
    }

    static async savePool(pool) {
        return this._withPoolLock(() => this._writePool(pool));
    }

    static async addMovie(movie) {
        const entry = this.createEntry(movie);
        if (!entry) {
            throw new Error('Random pool requires a valid Kinopoisk movie ID');
        }

        return this._withPoolLock(async () => {
            const pool = await this.getPool();
            const existing = pool.find(item => this.getMovieId(item) === entry.kpId);
            if (existing) {
                return { added: false, movie: existing, pool };
            }

            pool.push(entry);
            return {
                added: true,
                movie: entry,
                pool: await this._writePool(pool)
            };
        });
    }

    static async removeMovie(movieOrId) {
        const movieId = this.getMovieId(movieOrId);
        if (!movieId) {
            throw new Error('Random pool requires a valid Kinopoisk movie ID');
        }

        return this._withPoolLock(async () => {
            const pool = await this.getPool();
            const remaining = pool.filter(item => this.getMovieId(item) !== movieId);
            return remaining.length === pool.length ? pool : this._writePool(remaining);
        });
    }

    static async clear() {
        return this._withPoolLock(() => this._writePool([]));
    }
}

if (typeof globalThis !== 'undefined') {
    globalThis.RandomPoolService = RandomPoolService;
}
