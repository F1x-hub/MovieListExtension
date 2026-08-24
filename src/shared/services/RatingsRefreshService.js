/**
 * RatingsRefreshService refreshes public Kinopoisk and IMDb ratings at most once a week.
 */
class RatingsRefreshService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.collection = 'movies';
        this.refreshIntervalMs = 7 * 24 * 60 * 60 * 1000;
        this.lockLifetimeMs = 60 * 1000;
    }

    getLocalCacheKey(kinopoiskId) {
        return `local_movie_cache_${kinopoiskId}`;
    }

    getCardRatingsCacheKey() {
        return 'movie_card_ratings_v4';
    }

    async getLocalMovie(kinopoiskId) {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return {};
        const key = this.getLocalCacheKey(kinopoiskId);
        const stored = await chrome.storage.local.get(key);
        return stored[key] || {};
    }

    async saveLocalMovie(kinopoiskId, movie) {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        await chrome.storage.local.set({ [this.getLocalCacheKey(kinopoiskId)]: movie });
    }

    async getFreshCardRatingRecord(kinopoiskId) {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;

        const key = this.getCardRatingsCacheKey();
        const stored = await chrome.storage.local.get(key);
        const record = stored?.[key]?.[`kp:${kinopoiskId}`];
        if (!record || Number(record.expiresAt) <= Date.now()) return null;

        return record;
    }

    mergeRatingSources(result, sharedRecord) {
        if (!sharedRecord) return result;

        const merged = {
            ...(result || {}),
            votes: { ...(result?.votes || {}) }
        };
        const providers = [
            ['kpRating', 'kp'],
            ['imdbRating', 'imdb']
        ];

        providers.forEach(([ratingField, voteField]) => {
            if (Number(merged[ratingField]) <= 0 && Number(sharedRecord[ratingField]) > 0) {
                merged[ratingField] = Number(sharedRecord[ratingField]);
            }
            const currentVotes = Number(merged.votes[voteField]);
            if ((!Number.isFinite(currentVotes) || currentVotes <= 0)
                && Number(sharedRecord.votes?.[voteField]) > 0) {
                merged.votes[voteField] = Number(sharedRecord.votes[voteField]);
            }
        });

        return merged;
    }

    /**
     * Read and refresh ratings from the storage source selected by community rating state.
     */
    async checkAndRefreshRatings(kinopoiskId, imdbId, onRefreshStart, baseRatings = null) {
        if (!kinopoiskId) {
            throw new Error('Kinopoisk ID is required to refresh ratings');
        }

        const sharedCardRecord = await this.getFreshCardRatingRecord(kinopoiskId);
        const cachedBase = this.mergeRatingSources({
            kpRating: Number(baseRatings?.kpRating) || 0,
            imdbRating: Number(baseRatings?.imdbRating) || 0,
            votes: { ...(baseRatings?.votes || {}) }
        }, sharedCardRecord);

        if (sharedCardRecord
            && Number(cachedBase.kpRating) > 0
            && Number(cachedBase.imdbRating) > 0) {
            const cacheComplete = Number(cachedBase.votes?.kp) > 0
                && Number(cachedBase.votes?.imdb) > 0;
            console.info('[RatingsRefresh] Returning provider cache without refresh', {
                kinopoiskId,
                kpRating: Number(cachedBase.kpRating),
                imdbRating: Number(cachedBase.imdbRating),
                kpVotes: Number(cachedBase.votes?.kp) || 0,
                imdbVotes: Number(cachedBase.votes?.imdb) || 0,
                cacheComplete,
                cacheHit: true
            });
            return {
                ...cachedBase,
                refreshed: false,
                cacheComplete,
                cacheHit: true
            };
        }

        const movieRef = this.db.collection(this.collection).doc(kinopoiskId.toString());
        const movieSnapshot = await movieRef.get();
        const isCommunityRated = movieSnapshot.exists && movieSnapshot.data().hasCommunityRating === true;

        if (sharedCardRecord) {
            console.info('[RatingsRefresh] Using fresh Home/Catalog provider cache', {
                kinopoiskId,
                kpRating: Number(sharedCardRecord.kpRating) || 0,
                imdbRating: Number(sharedCardRecord.imdbRating) || 0
            });
        }

        const result = isCommunityRated
            ? this.refreshFirestoreRatings(movieRef, kinopoiskId, imdbId, onRefreshStart, sharedCardRecord)
            : this.refreshLocalRatings(kinopoiskId, imdbId, onRefreshStart, sharedCardRecord);

        return this.mergeRatingSources(await result, sharedCardRecord);
    }

    async persistCardRatingPatch(kinopoiskId, ratings) {
        if (typeof chrome === 'undefined' || !chrome.storage?.local || !kinopoiskId) return;

        const key = this.getCardRatingsCacheKey();
        const stored = await chrome.storage.local.get(key);
        const cache = stored?.[key] || {};
        const recordKey = `kp:${kinopoiskId}`;
        const current = cache[recordKey];
        if (!current) return;

        const nextVotes = { ...(current.votes || {}) };
        if (Number(ratings?.votes?.kp) > 0) nextVotes.kp = Number(ratings.votes.kp);
        if (Number(ratings?.votes?.imdb) > 0) nextVotes.imdb = Number(ratings.votes.imdb);
        const now = Date.now();
        await chrome.storage.local.set({
            [key]: {
                ...cache,
                [recordKey]: {
                    ...current,
                    kpRating: Number(ratings?.kpRating) > 0 ? Number(ratings.kpRating) : current.kpRating,
                    imdbRating: Number(ratings?.imdbRating) > 0 ? Number(ratings.imdbRating) : current.imdbRating,
                    votes: nextVotes,
                    updatedAt: now,
                    expiresAt: Math.max(Number(current.expiresAt) || 0, now + 7 * 24 * 60 * 60 * 1000)
                }
            }
        });
    }

    async refreshFirestoreRatings(movieRef, kinopoiskId, imdbId, onRefreshStart, sharedCardRecord = null) {
        const now = Date.now();
        let currentMovie = {};
        let claimedRefreshLock = false;

        await this.db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(movieRef);
            currentMovie = snapshot.exists ? snapshot.data() : {};
            if (this.isFresh(currentMovie.lastRatingsParsedAt, now)) return;

            const parsingStartedAt = this.getTimestampMillis(currentMovie.ratingsParsingStartedAt);
            const hasActiveLock = currentMovie.ratingsParsingInProgress === true &&
                parsingStartedAt && now - parsingStartedAt < this.lockLifetimeMs;
            if (hasActiveLock) return;

            transaction.set(movieRef, {
                ratingsParsingInProgress: true,
                ratingsParsingStartedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            claimedRefreshLock = true;
        });

        if (!claimedRefreshLock) return this.toRatingsResult(currentMovie, false);

        try {
            const updates = await this.parseRatings(kinopoiskId, imdbId, onRefreshStart, false, sharedCardRecord);
            await movieRef.set({ ...updates, ratingsParsingInProgress: false }, { merge: true });
            const updatedSnapshot = await movieRef.get();
            return this.toRatingsResult(updatedSnapshot.data() || currentMovie, updates.lastRatingsParsedAt !== undefined);
        } catch (error) {
            console.error('[RatingsRefresh] Unexpected refresh error:', error);
            await movieRef.set({ ratingsParsingInProgress: false }, { merge: true });
            return this.toRatingsResult(currentMovie, false);
        }
    }

    async refreshLocalRatings(kinopoiskId, imdbId, onRefreshStart, sharedCardRecord = null) {
        const currentMovie = await this.getLocalMovie(kinopoiskId);
        if (this.isFresh(currentMovie.lastRatingsParsedAt, Date.now())) {
            return this.toRatingsResult(currentMovie, false);
        }

        try {
            const updates = await this.parseRatings(kinopoiskId, imdbId, onRefreshStart, true, sharedCardRecord);
            const updatedMovie = {
                ...currentMovie,
                ...updates,
                votes: { ...(currentMovie.votes || {}), ...(updates.votes || {}) },
                kinopoiskId: Number(kinopoiskId)
            };
            await this.saveLocalMovie(kinopoiskId, updatedMovie);
            return this.toRatingsResult(updatedMovie, updates.lastRatingsParsedAt !== undefined);
        } catch (error) {
            console.error('[RatingsRefresh] Unexpected local refresh error:', error);
            return this.toRatingsResult(currentMovie, false);
        }
    }

    async parseRatings(kinopoiskId, imdbId, onRefreshStart, useLocalTimestamp = false, sharedCardRecord = null) {
        const hasSharedKpRating = Number(sharedCardRecord?.kpRating) > 0;
        const hasSharedImdbRating = Number(sharedCardRecord?.imdbRating) > 0;

        const kinopoiskParser = new KinopoiskRatingParsingService();
        const imdbParser = new ImdbParsingService();
        const ratingRequests = [];
        if (!hasSharedKpRating) {
            ratingRequests.push({
                provider: 'kp',
                promise: kinopoiskParser.getKinopoiskRating(kinopoiskId)
            });
        }
        if (imdbId && !hasSharedImdbRating) {
            ratingRequests.push({
                provider: 'imdb',
                promise: imdbParser.getImdbRating(imdbId)
            });
        }
        if (ratingRequests.length === 0) return {};
        if (typeof onRefreshStart === 'function') onRefreshStart();
        const settledResults = await Promise.allSettled(ratingRequests.map(request => request.promise));
        const resultsByProvider = new Map(
            settledResults.map((result, index) => [ratingRequests[index].provider, result])
        );
        const kinopoiskResult = resultsByProvider.get('kp');
        const imdbResult = resultsByProvider.get('imdb');

        const updates = {};
        let hasValidResult = false;
        if (!hasSharedKpRating && kinopoiskResult.status === 'fulfilled' && this.isValidRatingResult(kinopoiskResult.value)) {
            updates.kpRating = kinopoiskResult.value.rating;
            updates.votes = { kp: kinopoiskResult.value.votes };
            hasValidResult = true;
        } else if (!hasSharedKpRating && kinopoiskResult.status === 'rejected') {
            console.warn('[RatingsRefresh] Kinopoisk refresh failed:', kinopoiskResult.reason);
        }

        if (!hasSharedImdbRating && imdbResult?.status === 'fulfilled' && this.isValidRatingResult(imdbResult.value)) {
            updates.imdbRating = imdbResult.value.rating;
            updates.votes = { ...(updates.votes || {}), imdb: imdbResult.value.votes };
            hasValidResult = true;
        } else if (!hasSharedImdbRating && imdbResult?.status === 'rejected') {
            console.warn('[RatingsRefresh] IMDb refresh failed:', imdbResult.reason);
        }

        if (hasValidResult) {
            updates.lastRatingsParsedAt = useLocalTimestamp
                ? new Date().toISOString()
                : firebase.firestore.FieldValue.serverTimestamp();
        }
        return updates;
    }

    isFresh(timestamp, now) {
        const lastParsedAt = this.getTimestampMillis(timestamp);
        return lastParsedAt && now - lastParsedAt < this.refreshIntervalMs;
    }

    getTimestampMillis(value) {
        if (!value) return 0;
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (typeof value.toDate === 'function') return value.toDate().getTime();
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
    }

    isValidRatingResult(result) {
        return Boolean(result) && typeof result.rating === 'number' && Number.isFinite(result.rating) &&
            result.rating >= 0 && result.rating <= 10 && Number.isInteger(result.votes) && result.votes > 0;
    }

    toRatingsResult(movie, refreshed) {
        return {
            kpRating: movie.kpRating || 0,
            imdbRating: movie.imdbRating || 0,
            votes: movie.votes || {},
            refreshed
        };
    }
}

if (typeof window !== 'undefined') {
    window.RatingsRefreshService = RatingsRefreshService;
}
