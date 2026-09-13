/**
 * Shared local storage owner for the Random page movie pool.
 *
 * The pool is intentionally device-local: it contains only the compact movie
 * metadata needed by the Random page and never depends on authentication.
 */
class RandomPoolService {
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

    static async savePool(pool) {
        const normalizedPool = this.normalizePool(pool);
        await chrome.storage.local.set({ [this.storageKey]: normalizedPool });
        return normalizedPool;
    }

    static async addMovie(movie) {
        const entry = this.createEntry(movie);
        if (!entry) {
            throw new Error('Random pool requires a valid Kinopoisk movie ID');
        }

        const pool = await this.getPool();
        const existing = pool.find(item => this.getMovieId(item) === entry.kpId);
        if (existing) {
            return { added: false, movie: existing, pool };
        }

        pool.push(entry);
        return {
            added: true,
            movie: entry,
            pool: await this.savePool(pool)
        };
    }
}

if (typeof globalThis !== 'undefined') {
    globalThis.RandomPoolService = RandomPoolService;
}
