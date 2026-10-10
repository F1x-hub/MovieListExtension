/**
 * Private per-user episode ratings and the user's derived series rating.
 * Movie-level ratings remain the single public vote used by existing readers.
 */
class SeriesEpisodeRatingService {
    constructor(firebaseManager) {
        this.firebaseManager = firebaseManager;
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

    static calculateTotals(episodes) {
        const entries = Object.values(episodes && typeof episodes === 'object' ? episodes : {});
        const validRatings = entries.map(entry => Number(entry?.r))
            .filter(value => Number.isInteger(value) && value >= 1 && value <= 10);
        return {
            ratingSum: validRatings.reduce((sum, value) => sum + value, 0),
            ratedCount: validRatings.length
        };
    }

    static calculateAggregate(ratingSum, ratedCount) {
        const sum = Number(ratingSum);
        const count = Number(ratedCount);
        if (!Number.isInteger(sum) || !Number.isInteger(count) || count < 1 || sum < count || sum > count * 10) {
            return null;
        }
        const avg10 = Math.round((sum * 10) / count);
        return {
            avg10,
            episodeAverage: avg10 / 10,
            rating: Math.round(avg10 / 10)
        };
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

    _deleteField() {
        const fieldValue = globalThis.firebase?.firestore?.FieldValue;
        return typeof fieldValue?.delete === 'function' ? fieldValue.delete() : null;
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
        const totals = SeriesEpisodeRatingService.calculateTotals(episodes);
        const rawBackup = source.manualBackup;
        const manualBackup = Number.isInteger(Number(rawBackup?.rating))
            && Number(rawBackup.rating) >= 1 && Number(rawBackup.rating) <= 10
            ? {
                rating: Number(rawBackup.rating),
                ...(rawBackup.ratedAt ? { ratedAt: rawBackup.ratedAt } : {})
            }
            : null;
        return {
            exists,
            userId: String(source.userId || userId),
            movieId: Number(source.movieId || movieId),
            tmdbId: Number.isInteger(Number(source.tmdbId)) && Number(source.tmdbId) > 0
                ? Number(source.tmdbId)
                : null,
            episodes,
            ratingSum: totals.ratingSum,
            ratedCount: totals.ratedCount,
            mode: source.mode === 'episodes' ? 'episodes' : 'manual',
            manualBackup,
            lastKey: typeof source.lastKey === 'string' ? source.lastKey : '',
            updatedAt: source.updatedAt || null
        };
    }

    _copyState(state) {
        return {
            ...state,
            episodes: Object.fromEntries(Object.entries(state?.episodes || {}).map(([key, value]) => [key, { ...value }])),
            manualBackup: state?.manualBackup ? { ...state.manualBackup } : null
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
        const context = await this._resolveOperationContext(input);
        const { userId, movieId, ratingRef, episodeRef } = context;
        const episodeKey = SeriesEpisodeRatingService.getEpisodeKey(input.seasonNumber, input.episodeNumber);
        let result;

        await this.db.runTransaction(async transaction => {
            const [episodeSnapshot, ratingSnapshot] = await Promise.all([
                transaction.get(episodeRef),
                transaction.get(ratingRef)
            ]);
            const ratingData = ratingSnapshot.exists ? ratingSnapshot.data() : null;
            const current = this._normalizeState(
                episodeSnapshot.exists ? episodeSnapshot.data() : null,
                episodeSnapshot.exists,
                userId,
                movieId
            );
            const previousEpisode = current.episodes[episodeKey] || null;
            if (requestedRating === null && !previousEpisode) {
                result = { changed: false, state: current, rating: ratingData ? { id: ratingRef.id, ...ratingData } : null };
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
            const totals = SeriesEpisodeRatingService.calculateTotals(episodes);
            const firstEpisodeRating = current.ratedCount === 0 && requestedRating !== null;
            let manualBackup = current.manualBackup;
            let mode = current.mode;

            if (firstEpisodeRating) {
                mode = 'episodes';
                if (!manualBackup && ratingData && ratingData.ratingSource !== 'episodes'
                    && Number.isInteger(Number(ratingData.rating))
                    && Number(ratingData.rating) >= 1 && Number(ratingData.rating) <= 10) {
                    manualBackup = {
                        rating: Number(ratingData.rating),
                        ...(ratingData.updatedAt ? { ratedAt: ratingData.updatedAt } : {})
                    };
                }
            }

            const nextState = this._normalizeState({
                userId,
                movieId,
                tmdbId: input.tmdbId,
                episodes,
                ratingSum: totals.ratingSum,
                ratedCount: totals.ratedCount,
                mode,
                manualBackup,
                lastKey: episodeKey,
                updatedAt: this._serverTimestamp()
            }, totals.ratedCount > 0, userId, movieId);

            const now = this._serverTimestamp();
            let nextRating = ratingData ? { id: ratingRef.id, ...ratingData } : null;
            let ratingChanged = false;
            let ratingDeleted = false;
            let createdRating = false;
            let commentFallback = false;

            if (mode === 'episodes' && totals.ratedCount > 0) {
                const aggregate = SeriesEpisodeRatingService.calculateAggregate(totals.ratingSum, totals.ratedCount);
                const ratingFields = {
                    rating: aggregate.rating,
                    ratingSource: 'episodes',
                    episodeAverage: aggregate.episodeAverage,
                    episodesRatedCount: totals.ratedCount,
                    updatedAt: now
                };
                if (ratingSnapshot.exists) {
                    transaction.update(ratingRef, ratingFields);
                    nextRating = { ...ratingData, ...ratingFields, id: ratingRef.id };
                } else {
                    const newRating = {
                        userId,
                        userName: String(input.userName || ''),
                        userPhoto: String(input.userPhoto || ''),
                        movieId,
                        rating: aggregate.rating,
                        comment: '',
                        createdAt: now,
                        updatedAt: now,
                        isFavorite: false,
                        favoritedAt: null,
                        ratingSource: 'episodes',
                        episodeAverage: aggregate.episodeAverage,
                        episodesRatedCount: totals.ratedCount
                    };
                    transaction.set(ratingRef, newRating);
                    nextRating = { ...newRating, id: ratingRef.id };
                    createdRating = true;
                }
                ratingChanged = true;
            } else if (mode === 'episodes' && totals.ratedCount === 0) {
                if (manualBackup) {
                    const restoreFields = {
                        rating: manualBackup.rating,
                        ratingSource: 'manual',
                        episodeAverage: this._deleteField(),
                        episodesRatedCount: this._deleteField(),
                        updatedAt: now
                    };
                    let restored;
                    if (ratingSnapshot.exists) {
                        transaction.update(ratingRef, restoreFields);
                        restored = { ...ratingData, ...restoreFields, id: ratingRef.id };
                    } else {
                        restored = {
                            userId,
                            userName: String(input.userName || ''),
                            userPhoto: String(input.userPhoto || ''),
                            movieId,
                            rating: manualBackup.rating,
                            comment: '',
                            createdAt: now,
                            updatedAt: now,
                            isFavorite: false,
                            favoritedAt: null,
                            ratingSource: 'manual',
                            id: ratingRef.id
                        };
                        const restoredDocument = { ...restored };
                        delete restoredDocument.id;
                        transaction.set(ratingRef, restoredDocument);
                        createdRating = true;
                    }
                    delete restored.episodeAverage;
                    delete restored.episodesRatedCount;
                    nextRating = restored;
                    ratingChanged = true;
                } else if (ratingSnapshot.exists && (String(ratingData.comment || '').trim() || String(ratingData.review || '').trim())) {
                    const fallbackRating = Number.isInteger(Number(ratingData.rating))
                        ? Number(ratingData.rating)
                        : 0;
                    const fallbackFields = {
                        rating: fallbackRating,
                        ratingSource: 'manual',
                        episodeAverage: this._deleteField(),
                        episodesRatedCount: this._deleteField(),
                        updatedAt: now
                    };
                    transaction.update(ratingRef, fallbackFields);
                    const preserved = { ...ratingData, ...fallbackFields, id: ratingRef.id };
                    delete preserved.episodeAverage;
                    delete preserved.episodesRatedCount;
                    nextRating = preserved;
                    ratingChanged = true;
                    commentFallback = true;
                } else if (ratingSnapshot.exists) {
                    transaction.delete(ratingRef);
                    nextRating = null;
                    ratingDeleted = true;
                    ratingChanged = true;
                }
            }

            if (totals.ratedCount > 0) {
                const episodeDocument = {
                    userId,
                    movieId,
                    tmdbId: nextState.tmdbId,
                    episodes,
                    ratingSum: totals.ratingSum,
                    ratedCount: totals.ratedCount,
                    mode,
                    manualBackup,
                    lastKey: episodeKey,
                    updatedAt: now
                };
                transaction.set(episodeRef, episodeDocument);
            } else {
                transaction.delete(episodeRef);
            }

            const finalState = totals.ratedCount > 0 ? { ...nextState, updatedAt: now } : {
                ...nextState,
                exists: false,
                episodes: {},
                ratingSum: 0,
                ratedCount: 0,
                mode: 'manual',
                manualBackup: null,
                lastKey: ''
            };
            result = {
                changed: true,
                state: finalState,
                rating: nextRating,
                ratingChanged,
                ratingDeleted,
                createdRating,
                commentFallback
            };
        });

        return this._finalizeChange(context, result, 'episode rating');
    }

    async saveManualRating(input = {}) {
        const rating = Number(input.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
            throw new Error('Series rating must be an integer from 1 to 10');
        }
        return this._enqueueSeries(input.userId, input.movieId, () => this._saveManualRating(input, rating));
    }

    async _saveManualRating(input, rating) {
        const context = await this._resolveOperationContext(input);
        const { userId, movieId, ratingService, ratingRef, episodeRef } = context;
        const hasReview = Object.prototype.hasOwnProperty.call(input, 'review');
        const comment = ratingService.normalizeCommentForWrite(input.comment);
        const review = hasReview ? ratingService.normalizeReviewForWrite(input.review) : null;
        let result;

        await this.db.runTransaction(async transaction => {
            const [episodeSnapshot, ratingSnapshot] = await Promise.all([
                transaction.get(episodeRef),
                transaction.get(ratingRef)
            ]);
            const current = this._normalizeState(
                episodeSnapshot.exists ? episodeSnapshot.data() : null,
                episodeSnapshot.exists,
                userId,
                movieId
            );
            if (!episodeSnapshot.exists || current.ratedCount === 0) {
                throw new Error('Episode ratings are not available for this series');
            }
            const ratingData = ratingSnapshot.exists ? ratingSnapshot.data() : null;
            const now = this._serverTimestamp();
            const ratingFields = {
                rating,
                ratingSource: 'manual',
                episodeAverage: this._deleteField(),
                episodesRatedCount: this._deleteField(),
                updatedAt: now
            };
            if (input.updateText === true) {
                ratingFields.comment = comment;
                if (hasReview) ratingFields.review = review;
            }
            let nextRating;
            if (ratingSnapshot.exists) {
                transaction.update(ratingRef, ratingFields);
                nextRating = { ...ratingData, ...ratingFields, id: ratingRef.id };
                delete nextRating.episodeAverage;
                delete nextRating.episodesRatedCount;
            } else {
                const newRating = {
                    userId,
                    userName: String(input.userName || ''),
                    userPhoto: String(input.userPhoto || ''),
                    movieId,
                    rating,
                    comment: input.updateText === true ? comment : '',
                    createdAt: now,
                    updatedAt: now,
                    isFavorite: false,
                    favoritedAt: null,
                    ratingSource: 'manual'
                };
                if (input.updateText === true && hasReview) newRating.review = review;
                transaction.set(ratingRef, newRating);
                nextRating = { ...newRating, id: ratingRef.id };
            }
            const nextState = {
                ...current,
                mode: 'manual',
                manualBackup: {
                    rating,
                    ratedAt: this._timestampNow()
                },
                updatedAt: now
            };
            transaction.update(episodeRef, {
                mode: 'manual',
                manualBackup: nextState.manualBackup,
                updatedAt: now
            });
            result = {
                changed: true,
                state: this._copyState(nextState),
                rating: nextRating,
                ratingChanged: true,
                ratingDeleted: false,
                createdRating: !ratingSnapshot.exists
            };
        });

        return this._finalizeChange(context, result, 'manual series rating');
    }

    async restoreEpisodeAggregate(input = {}) {
        return this._enqueueSeries(input.userId, input.movieId, () => this._restoreEpisodeAggregate(input));
    }

    async _restoreEpisodeAggregate(input) {
        const context = await this._resolveOperationContext(input);
        const { userId, movieId, ratingRef, episodeRef } = context;
        let result;

        await this.db.runTransaction(async transaction => {
            const [episodeSnapshot, ratingSnapshot] = await Promise.all([
                transaction.get(episodeRef),
                transaction.get(ratingRef)
            ]);
            const current = this._normalizeState(
                episodeSnapshot.exists ? episodeSnapshot.data() : null,
                episodeSnapshot.exists,
                userId,
                movieId
            );
            if (!episodeSnapshot.exists || current.ratedCount === 0) {
                throw new Error('There are no episode ratings to aggregate');
            }
            const ratingData = ratingSnapshot.exists ? ratingSnapshot.data() : null;
            const aggregate = SeriesEpisodeRatingService.calculateAggregate(current.ratingSum, current.ratedCount);
            const now = this._serverTimestamp();
            const ratingFields = {
                rating: aggregate.rating,
                ratingSource: 'episodes',
                episodeAverage: aggregate.episodeAverage,
                episodesRatedCount: current.ratedCount,
                updatedAt: now
            };
            let nextRating;
            if (ratingSnapshot.exists) {
                transaction.update(ratingRef, ratingFields);
                nextRating = { ...ratingData, ...ratingFields, id: ratingRef.id };
            } else {
                const newRating = {
                    userId,
                    userName: String(input.userName || ''),
                    userPhoto: String(input.userPhoto || ''),
                    movieId,
                    rating: aggregate.rating,
                    comment: '',
                    createdAt: now,
                    updatedAt: now,
                    isFavorite: false,
                    favoritedAt: null,
                    ...ratingFields
                };
                transaction.set(ratingRef, newRating);
                nextRating = { ...newRating, id: ratingRef.id };
            }
            const nextState = { ...current, mode: 'episodes', updatedAt: now };
            transaction.update(episodeRef, { mode: 'episodes', updatedAt: now });
            result = {
                changed: true,
                state: this._copyState(nextState),
                rating: nextRating,
                ratingChanged: true,
                ratingDeleted: false,
                createdRating: !ratingSnapshot.exists
            };
        });

        return this._finalizeChange(context, result, 'restoring episode aggregate');
    }

    async deleteSeriesRating(input = {}) {
        return this._enqueueSeries(input.userId, input.movieId, () => this._deleteSeriesRating(input));
    }

    async _deleteSeriesRating(input) {
        const context = await this._resolveOperationContext(input, { resolveMovieData: false });
        const { userId, movieId, ratingRef, episodeRef } = context;
        let result;

        await this.db.runTransaction(async transaction => {
            const [episodeSnapshot, ratingSnapshot] = await Promise.all([
                transaction.get(episodeRef),
                transaction.get(ratingRef)
            ]);
            const state = this._normalizeState(
                episodeSnapshot.exists ? episodeSnapshot.data() : null,
                episodeSnapshot.exists,
                userId,
                movieId
            );
            if (episodeSnapshot.exists) transaction.delete(episodeRef);
            if (ratingSnapshot.exists) transaction.delete(ratingRef);
            result = {
                changed: episodeSnapshot.exists || ratingSnapshot.exists,
                state: this._normalizeState(null, false, userId, movieId),
                rating: null,
                deletedEpisodes: state.ratedCount,
                ratingChanged: ratingSnapshot.exists,
                ratingDeleted: ratingSnapshot.exists,
                createdRating: false
            };
        });

        return this._finalizeChange(context, result, 'deleting series rating', {
            invalidate: result.ratingChanged
        });
    }

    async _resolveOperationContext(input, options = {}) {
        const userId = String(input.userId || '');
        const movieId = Number(input.movieId);
        const seriesDocumentId = this.getSeriesDocumentId(userId, movieId);
        const ratingService = this.firebaseManager.getRatingService();
        const existingRating = await ratingService.getRating(userId, movieId);
        const canonicalRatingId = ratingService.getRatingDocumentId(userId, movieId);
        const ratingRef = this.db.collection('ratings').doc(existingRating?.id || canonicalRatingId);
        const episodeRef = this.db.collection(this.collection).doc(seriesDocumentId);
        const resolvedMovieData = options.resolveMovieData === false
            ? null
            : await ratingService.resolveMovieDataForRating(movieId, input.movieData);
        return {
            userId,
            movieId,
            seriesDocumentId,
            ratingService,
            ratingRef,
            episodeRef,
            resolvedMovieData
        };
    }

    async _finalizeChange(context, result, operation, options = {}) {
        if (!result?.changed) return result;
        this.clearEpisodeRatingsCache(context.userId, context.movieId);
        this.stateCache.set(context.seriesDocumentId, this._copyState(result.state));
        if (result.createdRating && context.resolvedMovieData) {
            try {
                const movieCacheService = this.firebaseManager.getMovieCacheService?.();
                if (movieCacheService) await movieCacheService.cacheMovie(context.resolvedMovieData, true);
            } catch (error) {
                console.warn(`Failed to cache movie after ${operation}:`, error?.message || error);
            }
        }
        if (options.invalidate !== false) {
            await this._invalidateAfterChange(context.ratingService, context.userId, context.movieId);
        }
        return result;
    }

    async _invalidateAfterChange(ratingService, userId, movieId) {
        try {
            const ratingsCacheService = this.firebaseManager.getRatingsCacheService?.();
            if (ratingsCacheService) await ratingsCacheService.clearCache();
        } catch (error) {
            console.warn('Failed to clear ratings cache after series rating update:', error?.message || error);
        }
        try {
            await ratingService.invalidateAverageRatingsCache(movieId);
        } catch (error) {
            console.warn('Failed to clear average ratings cache after series rating update:', error?.message || error);
        }
        try {
            await ratingService.invalidateRatingsCache(userId);
        } catch (error) {
            console.warn('Failed to clear personal ratings cache after series rating update:', error?.message || error);
        }
        Promise.resolve(ratingService.recalculateUserTopGenres(userId)).catch(error => {
            console.warn('Failed to recalculate top genres after series rating update:', error?.message || error);
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SeriesEpisodeRatingService;
}
if (typeof window !== 'undefined') {
    window.SeriesEpisodeRatingService = SeriesEpisodeRatingService;
}
