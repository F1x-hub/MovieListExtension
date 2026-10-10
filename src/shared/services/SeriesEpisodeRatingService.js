/**
 * Private per-user episode scores, independent of public title ratings.
 */
class SeriesEpisodeRatingService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.collection = 'seriesEpisodeRatings';
        this.stateCache = new Map();
        this.stateLoads = new Map();
        this.stateVersions = new Map();
        this.seriesQueues = new Map();
    }

    getSeriesDocumentId(userId, movieId) {
        const uid = String(userId || '').trim();
        const kpId = Number(movieId);
        if (!uid || uid.includes('/') || !Number.isInteger(kpId) || kpId <= 0) {
            throw new Error('A user and positive Kinopoisk ID are required');
        }
        return uid + '_' + kpId;
    }

    static getEpisodeKey(seasonNumber, episodeNumber) {
        const season = Number(seasonNumber);
        const episode = Number(episodeNumber);
        if (!Number.isInteger(season) || season < 0 || season > 999
            || !Number.isInteger(episode) || episode < 1 || episode > 99999) {
            throw new Error('A valid season and episode number are required');
        }
        return season + ':' + episode;
    }

    _cacheKey(userId, movieId) {
        return this.getSeriesDocumentId(userId, movieId);
    }

    _timestampNow() {
        const timestamp = globalThis.firebase?.firestore?.Timestamp;
        return typeof timestamp?.now === 'function' ? timestamp.now() : new Date();
    }

    _serverTimestamp() {
        const fieldValue = globalThis.firebase?.firestore?.FieldValue;
        return typeof fieldValue?.serverTimestamp === 'function'
            ? fieldValue.serverTimestamp()
            : this._timestampNow();
    }

    _normalizeState(data = null, exists = false, userId = '', movieId = 0) {
        const source = data && typeof data === 'object' ? data : {};
        const episodes = {};
        Object.entries(source.episodes && typeof source.episodes === 'object' ? source.episodes : {}).forEach(([key, entry]) => {
            if (!/^[0-9]{1,3}:[0-9]{1,5}$/.test(key)) return;
            const rating = Number(entry?.r);
            if (!Number.isInteger(rating) || rating < 1 || rating > 10) return;
            episodes[key] = {
                r: rating,
                t: entry.t || null,
                ...(Number.isInteger(Number(entry.id)) && Number(entry.id) > 0 ? { id: Number(entry.id) } : {})
            };
        });
        return {
            exists,
            userId: String(source.userId || userId),
            movieId: Number(source.movieId || movieId),
            tmdbId: Number.isInteger(Number(source.tmdbId)) && Number(source.tmdbId) > 0
                ? Number(source.tmdbId)
                : null,
            episodes,
            lastKey: typeof source.lastKey === 'string' ? source.lastKey : '',
            updatedAt: source.updatedAt || null
        };
    }

    _copyState(state) {
        return {
            ...state,
            episodes: Object.fromEntries(Object.entries(state?.episodes || {}).map(([key, value]) => [key, { ...value }]))
        };
    }

    async getEpisodeRatings(userId, movieId, options = {}) {
        const key = this._cacheKey(userId, movieId);
        if (!options.forceRefresh && this.stateCache.has(key)) {
            return this._copyState(this.stateCache.get(key));
        }
        const existingLoad = this.stateLoads.get(key);
        if (!options.forceRefresh && existingLoad) return this._copyState(await existingLoad);
        const loadVersion = this.stateVersions.get(key) || 0;
        const load = (async () => {
            const snapshot = await this.db.collection(this.collection).doc(key).get();
            const state = this._normalizeState(
                snapshot.exists ? snapshot.data() : null,
                snapshot.exists,
                userId,
                movieId
            );
            if ((this.stateVersions.get(key) || 0) === loadVersion) this.stateCache.set(key, state);
            return state;
        })();
        this.stateLoads.set(key, load);
        try {
            return this._copyState(await load);
        } finally {
            if (this.stateLoads.get(key) === load) this.stateLoads.delete(key);
        }
    }

    refreshEpisodeRatings(userId, movieId) {
        return this.getEpisodeRatings(userId, movieId, { forceRefresh: true });
    }

    clearEpisodeRatingsCache(userId, movieId) {
        const key = this._cacheKey(userId, movieId);
        this.stateVersions.set(key, (this.stateVersions.get(key) || 0) + 1);
        this.stateCache.delete(key);
        this.stateLoads.delete(key);
    }

    _enqueueSeries(userId, movieId, task) {
        const key = this._cacheKey(userId, movieId);
        const previous = this.seriesQueues.get(key) || Promise.resolve();
        const operation = previous.catch(() => undefined).then(task);
        this.seriesQueues.set(key, operation);
        return operation.finally(() => {
            if (this.seriesQueues.get(key) === operation) this.seriesQueues.delete(key);
        });
    }

    async setEpisodeRating(input = {}) {
        const rating = Number(input.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
            throw new Error('Episode rating must be an integer from 1 to 10');
        }
        return this._enqueueSeries(input.userId, input.movieId, () => this._changeEpisodeRating(input, rating));
    }

    async removeEpisodeRating(input = {}) {
        return this._enqueueSeries(input.userId, input.movieId, () => this._changeEpisodeRating(input, null));
    }

    async _changeEpisodeRating(input, requestedRating) {
        const userId = String(input.userId || '').trim();
        const movieId = Number(input.movieId);
        const documentId = this.getSeriesDocumentId(userId, movieId);
        const episodeRef = this.db.collection(this.collection).doc(documentId);
        const episodeKey = SeriesEpisodeRatingService.getEpisodeKey(input.seasonNumber, input.episodeNumber);
        let result;

        await this.db.runTransaction(async transaction => {
            const snapshot = await transaction.get(episodeRef);
            const current = this._normalizeState(snapshot.exists ? snapshot.data() : null,
                snapshot.exists, userId, movieId);
            if (requestedRating === null && !current.episodes[episodeKey]) {
                result = { changed: false, state: current };
                return;
            }
            const episodes = { ...current.episodes };
            if (requestedRating === null) {
                delete episodes[episodeKey];
            } else {
                const tmdbEpisodeId = Number(input.tmdbEpisodeId);
                episodes[episodeKey] = {
                    r: requestedRating,
                    t: this._timestampNow(),
                    ...(Number.isInteger(tmdbEpisodeId) && tmdbEpisodeId > 0 ? { id: tmdbEpisodeId } : {})
                };
            }
            const count = Object.keys(episodes).length;
            if (count > 3000) throw new Error('A series can contain at most 3000 episode ratings');
            const tmdbId = Number(input.tmdbId);
            const document = {
                userId,
                movieId,
                tmdbId: Number.isInteger(tmdbId) && tmdbId > 0 ? tmdbId : current.tmdbId,
                episodes,
                lastKey: episodeKey,
                updatedAt: this._serverTimestamp()
            };
            // Full replacement removes obsolete fields from the former linked model.
            if (count > 0) transaction.set(episodeRef, document);
            else transaction.delete(episodeRef);
            result = {
                changed: true,
                state: count > 0 ? this._normalizeState(document, true, userId, movieId)
                    : this._normalizeState(null, false, userId, movieId)
            };
        });
        if (result.changed) {
            this.clearEpisodeRatingsCache(userId, movieId);
            this.stateCache.set(documentId, this._copyState(result.state));
        }
        return result;
    }

}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SeriesEpisodeRatingService;
}
if (typeof window !== 'undefined') {
    window.SeriesEpisodeRatingService = SeriesEpisodeRatingService;
}
