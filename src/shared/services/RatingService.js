/**
 * RatingService - Service for managing movie ratings and comments
 * Handles user ratings, average calculations, and rating feeds
 */
class RatingService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.collection = 'ratings';
    }

    async invalidateRatingsCache(userId = null) {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                const allStorage = await chrome.storage.local.get(null);
                const keysToRemove = Object.keys(allStorage).filter(k => k.startsWith('ratings_cache_') || k === 'recent_ratings_cache');
                if (keysToRemove.length > 0) {
                    await chrome.storage.local.remove(keysToRemove);
                    console.log('RatingService: Invalidated ratings caches:', keysToRemove);
                }
            }
        } catch (error) {
            console.warn('RatingService: Failed to invalidate cache', error);
        }
    }

    /**
     * Clear all cached average ratings from chrome.storage.local
     * These are stored under keys like 'averageRatings_...' by getBatchMovieAverageRatings
     */
    async invalidateAverageRatingsCache(movieId = null) {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                if (movieId) {
                    const result = await chrome.storage.local.get(['average_ratings_dict']);
                    const dict = result.average_ratings_dict || {};
                    if (dict[movieId]) {
                        delete dict[movieId];
                        await chrome.storage.local.set({ average_ratings_dict: dict });
                        console.log(`RatingService: Invalidated average rating cache for movie ${movieId}`);
                    }
                } else {
                    await chrome.storage.local.remove(['average_ratings_dict']);
                    console.log('RatingService: Invalidated entire average ratings cache');
                }
            }
        } catch (error) {
            console.warn('RatingService: Failed to invalidate average ratings cache', error);
        }
    }

    async migrateAverageRatingsCache() {
        try {
            if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return {};
            
            const allData = await chrome.storage.local.get(null);
            const newDict = {};
            const keysToRemove = [];

            Object.keys(allData).forEach(key => {
                if (key.startsWith('averageRatings_') && !key.endsWith('_timestamp')) {
                    const averages = allData[key];
                    const timestamp = allData[`${key}_timestamp`] || Date.now();
                    
                    if (averages && typeof averages === 'object') {
                        Object.keys(averages).forEach(movieId => {
                            const val = averages[movieId];
                            if (val && typeof val === 'object') {
                                newDict[movieId] = {
                                    average: val.average || 0,
                                    count: val.count || 0,
                                    updatedAt: timestamp
                                };
                            }
                        });
                    }
                    keysToRemove.push(key);
                    keysToRemove.push(`${key}_timestamp`);
                }
            });

            if (Object.keys(newDict).length > 0) {
                await chrome.storage.local.set({ average_ratings_dict: newDict });
                if (keysToRemove.length > 0) {
                    await chrome.storage.local.remove(keysToRemove);
                }
                console.log(`RatingService: Successfully migrated legacy average ratings cache into average_ratings_dict. Removed legacy keys: ${keysToRemove.length}`);
            }
            return newDict;
        } catch (error) {
            console.error('RatingService: Failed to migrate average ratings cache:', error);
            return {};
        }
    }

    /**
     * Add or update a user's rating for a movie
     * @param {string} userId - User ID
     * @param {string} userName - User display name
     * @param {string} userPhoto - User photo URL
     * @param {number} movieId - Kinopoisk movie ID
     * @param {number} rating - Rating (1-10)
     * @param {string} comment - Optional comment (max 500 chars)
     * @param {Object} movieData - Movie data to cache (optional)
     * @returns {Promise<Object>} - Created/updated rating
     */
    async addOrUpdateRating(userId, userName, userPhoto, movieId, rating, comment = '', movieData = null) {
        try {
            const normalizedMovieId = Number(movieId);
            if (!Number.isInteger(normalizedMovieId) || normalizedMovieId <= 0) {
                throw new Error('Movie ID must be a positive integer');
            }
            movieId = normalizedMovieId;

            // Validate rating
            if (rating < 1 || rating > 10 || !Number.isInteger(rating)) {
                throw new Error('Rating must be an integer between 1 and 10');
            }

            // Validate comment length
            if (comment && comment.length > 500) {
                throw new Error('Comment must be 500 characters or less');
            }

            // Find existing rating doc via query before transaction
            const existingRating = await this.getRating(userId, movieId);
            
            const ratingVal = Number(rating);
            const movieRef = this.db.collection('movies').doc(movieId.toString());
            const ratingRef = existingRating?.id 
                ? this.db.collection(this.collection).doc(existingRating.id)
                : this.db.collection(this.collection).doc();
            const resolvedMovieData = await this.resolveMovieDataForRating(movieId, movieData);
            const localMovieCache = resolvedMovieData || await this.getLocalMovieCacheForPromotion(movieId);

            let result;
            let promotedFromLocalCache = false;

            await this.db.runTransaction(async (transaction) => {
                // 1. READ DocumentReferences inside transaction
                const movieDoc = await transaction.get(movieRef);
                const ratingDoc = await transaction.get(ratingRef);

                const currentMovieData = movieDoc.exists ? movieDoc.data() : {};
                let ratingsSum = Number(currentMovieData.ratingsSum) || 0;
                let ratingsCount = Number(currentMovieData.ratingsCount) || 0;

                const ratingData = {
                    userId,
                    userName,
                    userPhoto,
                    movieId,
                    rating: ratingVal,
                    comment: comment.trim(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                const actualExistingData = ratingDoc.exists ? ratingDoc.data() : null;

                // 2. WRITE operations inside transaction
                if (actualExistingData) {
                    ratingData.createdAt = actualExistingData.createdAt || firebase.firestore.FieldValue.serverTimestamp();
                    if (actualExistingData.isFavorite !== undefined) ratingData.isFavorite = actualExistingData.isFavorite;
                    if (actualExistingData.favoritedAt !== undefined) ratingData.favoritedAt = actualExistingData.favoritedAt;

                    transaction.update(ratingRef, ratingData);
                    result = { id: ratingRef.id, ...ratingData };

                    const oldRating = Number(actualExistingData.rating) || 0;
                    ratingsSum += (ratingVal - oldRating);
                } else {
                    ratingData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                    ratingData.isFavorite = false;
                    ratingData.favoritedAt = null;

                    transaction.set(ratingRef, ratingData);
                    result = { id: ratingRef.id, ...ratingData };

                    ratingsSum += ratingVal;
                    ratingsCount += 1;
                }

                const avgRating = ratingsCount > 0 ? Math.round((ratingsSum / ratingsCount) * 10) / 10 : 0;

                const movieUpdates = {
                    ratingsSum,
                    ratingsCount,
                    avgRating,
                    hasCommunityRating: ratingsCount > 0,
                    hasRatings: ratingsCount > 0,
                    lastRatingUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
                };

                if (resolvedMovieData) {
                    Object.assign(movieUpdates, resolvedMovieData);
                }

                if (movieDoc.exists) {
                    transaction.update(movieRef, movieUpdates);
                } else {
                    promotedFromLocalCache = Boolean(localMovieCache);
                    transaction.set(movieRef, {
                        ...localMovieCache,
                        kinopoiskId: movieId,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        ...movieUpdates
                    });
                }
            });

            await this.verifyMovieRatingAggregate(movieRef, movieId);

            if (promotedFromLocalCache) {
                await this.removeLocalMovieCacheAfterPromotion(movieId);
            }

            // Always cache movie metadata when rating to ensure name, poster, and flags are set in Firestore
            if (resolvedMovieData) {
                try {
                    const movieCacheService = window.firebaseManager?.getMovieCacheService();
                    if (movieCacheService) {
                        await movieCacheService.cacheMovie(resolvedMovieData, true);
                        console.log('Movie cached after rating:', resolvedMovieData.name || resolvedMovieData.kinopoiskId);
                    }
                } catch (cacheError) {
                    console.warn('Failed to cache movie after rating:', cacheError.message);
                }
            }

            // Invalidate ratings cache when a new rating is added/updated
            try {
                const ratingsCacheService = window.firebaseManager?.getRatingsCacheService();
                if (ratingsCacheService) {
                    await ratingsCacheService.clearCache();
                    console.log('Ratings cache cleared after rating update');
                }
            } catch (cacheError) {
                console.warn('Failed to clear ratings cache after rating update:', cacheError.message);
            }

            // Invalidate average ratings cache (getBatchMovieAverageRatings uses its own cache)
            try {
                await this.invalidateAverageRatingsCache(movieId);
            } catch (cacheError) {
                console.warn('Failed to clear average ratings cache after rating update:', cacheError.message);
            }

            // Remove from watchlist if movie was in watchlist
            try {
                const watchlistService = window.firebaseManager?.getWatchlistService();
                if (watchlistService) {
                    const isInWatchlist = await watchlistService.isInWatchlist(userId, movieId);
                    if (isInWatchlist) {
                        await watchlistService.removeFromWatchlist(userId, movieId);
                        console.log('Movie removed from watchlist after rating');
                    }
                }
            } catch (watchlistError) {
                console.warn('Failed to remove from watchlist after rating:', watchlistError.message);
            }

            // Invalidate cache
            await this.invalidateRatingsCache(userId);

            // Recalculate top-3 genres for user asynchronously
            this.recalculateUserTopGenres(userId).catch(err => {
                console.warn('RatingService: Non-critical failure in topGenres recalculation:', err);
            });

            return result;
        } catch (error) {
            console.error('Error adding/updating rating:', error);
            throw new Error(`Failed to save rating: ${error.message}`, { cause: error });
        }
    }

    normalizeMovieDataForRating(movieId, movieData) {
        if (!movieData || typeof movieData !== 'object') return null;

        const normalized = { ...movieData };
        normalized.kinopoiskId = Number(normalized.kinopoiskId || normalized.id || movieId);
        if (!Number.isInteger(normalized.kinopoiskId) || normalized.kinopoiskId <= 0) return null;

        const hasMetadata = Boolean(
            normalized.name ||
            normalized.alternativeName ||
            normalized.posterUrl ||
            normalized.year ||
            normalized.description
        );
        if (!hasMetadata) return null;

        delete normalized.id;
        delete normalized._lru;
        delete normalized._cacheExpired;
        delete normalized.cachedAt;
        delete normalized.lastUpdated;
        delete normalized.hasRatings;
        delete normalized.hasCommunityRating;
        delete normalized.ratingsCount;
        delete normalized.ratingsSum;
        delete normalized.avgRating;
        delete normalized.lastRatingUpdatedAt;

        return normalized;
    }

    async resolveMovieDataForRating(movieId, movieData = null) {
        const directMovieData = this.normalizeMovieDataForRating(movieId, movieData);
        if (directMovieData) return directMovieData;

        const candidates = [];
        try {
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                const key = `local_movie_cache_${movieId}`;
                const stored = await chrome.storage.local.get(key);
                if (stored[key]) candidates.push(stored[key]);
            }
        } catch (error) {
            console.warn('RatingService: Failed to read Chrome movie cache', error);
        }

        try {
            if (typeof localStorage !== 'undefined') {
                const rawMovie = localStorage.getItem(`kp_movie_${movieId}`);
                if (rawMovie) candidates.push(JSON.parse(rawMovie));
            }
        } catch (error) {
            console.warn('RatingService: Failed to read legacy movie cache', error);
        }

        return candidates
            .map(candidate => this.normalizeMovieDataForRating(movieId, candidate))
            .find(Boolean) || null;
    }

    async getLocalMovieCacheForPromotion(movieId) {
        try {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
            const key = `local_movie_cache_${movieId}`;
            const stored = await chrome.storage.local.get(key);
            const cachedMovie = stored[key];
            if (!cachedMovie || typeof cachedMovie !== 'object') return null;

            return this.normalizeMovieDataForRating(movieId, cachedMovie);
        } catch (error) {
            console.warn('RatingService: Failed to read local movie cache for promotion', error);
            return null;
        }
    }

    async removeLocalMovieCacheAfterPromotion(movieId) {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                await chrome.storage.local.remove(`local_movie_cache_${movieId}`);
            }
        } catch (error) {
            console.warn('RatingService: Failed to remove promoted local movie cache', error);
        }
    }

    /**
     * Logs incomplete rating aggregates immediately after a rating write.
     * @param {firebase.firestore.DocumentReference} movieRef Movie document reference
     * @param {number} movieId Kinopoisk movie ID
     * @returns {Promise<void>}
     */
    async verifyMovieRatingAggregate(movieRef, movieId) {
        try {
            const movieSnapshot = await movieRef.get();
            const data = movieSnapshot.exists ? movieSnapshot.data() : null;
            const isComplete = Boolean(
                data &&
                data.hasCommunityRating === true &&
                data.hasRatings === true &&
                Number.isFinite(Number(data.ratingsCount)) &&
                Number(data.ratingsCount) > 0 &&
                Number.isFinite(Number(data.avgRating)) &&
                data.lastRatingUpdatedAt
            );

            if (!isComplete) {
                console.error('[RatingService] Incomplete movie rating aggregate after rating write', {
                    movieId,
                    exists: movieSnapshot.exists,
                    hasCommunityRating: data?.hasCommunityRating,
                    hasRatings: data?.hasRatings,
                    ratingsCount: data?.ratingsCount,
                    avgRating: data?.avgRating,
                    lastRatingUpdatedAt: data?.lastRatingUpdatedAt
                });
            }
        } catch (error) {
            console.error('[RatingService] Failed to verify movie rating aggregate after rating write', {
                movieId,
                error: error.message
            });
        }
    }

    /**
     * Get user's rating for a specific movie
     * @param {string} userId - User ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<Object|null>} - User's rating or null
     */
    async getRating(userId, movieId) {
        try {
            const normalizedMovieId = Number(movieId);
            const movieIdCandidates = [...new Set([
                normalizedMovieId,
                String(movieId)
            ])].filter(candidate => candidate !== 'NaN' && candidate !== undefined);

            for (const movieIdCandidate of movieIdCandidates) {
                const query = this.db.collection(this.collection)
                    .where('userId', '==', userId)
                    .where('movieId', '==', movieIdCandidate)
                    .limit(1);

                const results = await query.get();
                if (!results.empty) {
                    const doc = results.docs[0];
                    return { id: doc.id, ...doc.data() };
                }
            }

            return null;
        } catch (error) {
            console.error('Error getting user rating:', error);
            return null;
        }
    }

    /**
     * Get average rating for a movie
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<Object>} - Average rating and count
     */
    async getMovieAverageRating(movieId) {
        const startTime = performance.now();
        try {
            const queryStart = performance.now();
            const query = this.db.collection(this.collection)
                .where('movieId', '==', movieId);

            const results = await query.get();
            const queryTime = Math.round(performance.now() - queryStart);
            
            if (results.empty) {
                const totalTime = Math.round(performance.now() - startTime);
                if (totalTime > 50) {
                    console.log(`⏱️ [RatingService] getMovieAverageRating(${movieId}): ${totalTime}ms (empty)`);
                }
                return { average: 0, count: 0 };
            }

            const calcStart = performance.now();
            let totalRating = 0;
            let count = 0;

            results.forEach(doc => {
                const data = doc.data();
                totalRating += data.rating;
                count++;
            });

            const average = count > 0 ? Math.round((totalRating / count) * 10) / 10 : 0;
            const calcTime = Math.round(performance.now() - calcStart);
            
            const totalTime = Math.round(performance.now() - startTime);
            if (totalTime > 100) {
                console.log(`⏱️ [RatingService] getMovieAverageRating(${movieId}): ${totalTime}ms (query: ${queryTime}ms, calc: ${calcTime}ms, count: ${count})`);
            }

            return { average, count };
        } catch (error) {
            const totalTime = Math.round(performance.now() - startTime);
            console.error(`❌ [RatingService] Error getting movie average rating for ${movieId} (${totalTime}ms):`, error);
            return { average: 0, count: 0 };
        }
    }

    /**
     * Get average ratings for multiple movies in batch (optimized)
     * @param {Array<number>} movieIds - Array of Kinopoisk movie IDs
     * @returns {Promise<Object>} - Map of movieId to {average, count}
     */
    async getBatchMovieAverageRatings(movieIds) {
        const startTime = performance.now();
        console.group('[RatingService] getBatchMovieAverageRatings');
        try {
            if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
                return await this.fetchAverageRatingsFromFirestore(movieIds);
            }

            // Read the dict cache
            let result = await chrome.storage.local.get(['average_ratings_dict']);
            let dict = result.average_ratings_dict;

            // If empty, run migration
            if (!dict || Object.keys(dict).length === 0) {
                dict = await this.migrateAverageRatingsCache();
            }

            const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
            const now = Date.now();
            const averages = {};
            const cacheMissIds = [];

            movieIds.forEach(id => {
                const cached = dict[id];
                if (cached && (now - cached.updatedAt) < CACHE_DURATION) {
                    averages[id] = {
                        average: cached.average,
                        count: cached.count
                    };
                } else {
                    cacheMissIds.push(id);
                }
            });

            if (cacheMissIds.length > 0) {
                console.log(`[RatingService] Cache miss for ${cacheMissIds.length} of ${movieIds.length} movies. Fetching from Firestore...`);
                const freshAverages = await this.fetchAverageRatingsFromFirestore(cacheMissIds);
                
                // Merge fresh averages into dict
                Object.keys(freshAverages).forEach(id => {
                    dict[id] = {
                        average: freshAverages[id].average,
                        count: freshAverages[id].count,
                        updatedAt: now
                    };
                    averages[id] = freshAverages[id];
                });

                // Write dict back to storage
                await chrome.storage.local.set({ average_ratings_dict: dict });
            } else {
                console.log(`[RatingService] Using cached average ratings. Time: ${(performance.now() - startTime).toFixed(2)}ms`);
            }

            console.groupEnd();
            return averages;
        } catch (error) {
            console.error('[RatingService] Error batch loading average ratings:', error);
            console.groupEnd();
            
            // Fallback: return empty averages
            const averages = {};
            for (const movieId of movieIds) {
                averages[movieId] = { average: 0, count: 0 };
            }
            return averages;
        }
    }

    async fetchAverageRatingsFromFirestore(movieIds) {
        // Load all ratings for these movies in batch (Firestore 'in' limit is 30)
        const normalizedMovieIds = [...new Set(movieIds
            .map(movieId => Number(movieId))
            .filter(movieId => Number.isInteger(movieId) && movieId > 0))];
        const queryMovieIds = normalizedMovieIds.flatMap(movieId => [movieId, String(movieId)]);
        const CHUNK_SIZE = 30;
        const movieIdChunks = [];
        for (let i = 0; i < queryMovieIds.length; i += CHUNK_SIZE) {
            movieIdChunks.push(queryMovieIds.slice(i, i + CHUNK_SIZE));
        }

        const allResults = [];
        for (const chunk of movieIdChunks) {
            const query = this.db.collection(this.collection)
                .where('movieId', 'in', chunk);
            const snapshot = await query.get();
            snapshot.forEach(doc => allResults.push(doc.data()));
        }

        const movieRatings = {};
        allResults.forEach(data => {
            const movieId = Number(data.movieId);
            if (!Number.isInteger(movieId) || movieId <= 0) return;
            if (!movieRatings[movieId]) {
                movieRatings[movieId] = { ratings: [], count: 0 };
            }
            const ratingValue = Number(data.rating);
            if (!Number.isFinite(ratingValue)) return;
            movieRatings[movieId].ratings.push(ratingValue);
            movieRatings[movieId].count++;
        });

        const averages = {};
        for (const movieId of normalizedMovieIds) {
            if (movieRatings[movieId]) {
                const ratings = movieRatings[movieId].ratings;
                const total = ratings.reduce((sum, rating) => sum + rating, 0);
                const average = Math.round((total / ratings.length) * 10) / 10;
                averages[movieId] = { average, count: ratings.length };
            } else {
                averages[movieId] = { average: 0, count: 0 };
            }
        }

        // Keep the response compatible with callers that use string keys.
        movieIds.forEach(movieId => {
            const normalizedMovieId = Number(movieId);
            if (averages[normalizedMovieId]) averages[movieId] = averages[normalizedMovieId];
        });
        return averages;
    }

    /**
     * Get all ratings chronologically (for feed)
     * @param {number} limit - Maximum number of ratings to return
     * @param {string|DocumentSnapshot} lastDocInput - Last document ID or snapshot for pagination
     * @param {string|null} userId - Optional user ID to filter ratings
     * @returns {Promise<Object>} - Ratings and pagination info
     */
    async getAllRatings(limit = 50, lastDocInput = null, userId = null) {
        try {
            let query = this.db.collection(this.collection);

            if (userId) {
                query = query.where('userId', '==', userId);
            }

            query = query.orderBy('createdAt', 'desc').limit(limit);

            if (lastDocInput) {
                if (typeof lastDocInput === 'string') {
                    // It's a document ID string
                    const lastDoc = await this.db.collection(this.collection).doc(lastDocInput).get();
                    if (lastDoc.exists) {
                        query = query.startAfter(lastDoc);
                    }
                } else if (lastDocInput.id && typeof lastDocInput.get === 'function') {
                    // It's likely a DocumentSnapshot
                    query = query.startAfter(lastDocInput);
                }
            }

            const results = await query.get();
            const ratings = [];

            results.forEach(doc => {
                ratings.push({ id: doc.id, ...doc.data() });
            });

            const lastDoc = results.docs.length > 0 ? results.docs[results.docs.length - 1] : null;

            return {
                ratings,
                hasMore: results.size === limit,
                lastDocId: lastDoc ? lastDoc.id : null,
                lastDoc: lastDoc // Return the actual snapshot for better pagination performance
            };
        } catch (error) {
            console.error('Error getting all ratings:', error);
            return { ratings: [], hasMore: false, lastDocId: null, lastDoc: null };
        }
    }

    /**
     * Get user's ratings by movie IDs
     * @param {string} userId - User ID
     * @param {Array<number>} movieIds - Array of movie IDs
     * @returns {Promise<Array>} - User's ratings for specified movies
     */
    async getUserRatingsByMovieIds(userId, movieIds) {
        try {
            if (!userId || !movieIds || movieIds.length === 0) {
                return [];
            }

            const ratings = [];
            
            for (const movieId of movieIds) {
                const rating = await this.getRating(userId, movieId);
                if (rating) {
                    ratings.push(rating);
                }
            }

            return ratings;
        } catch (error) {
            console.error('Error getting user ratings by movie IDs:', error);
            return [];
        }
    }

    /**
     * Get user's ratings
     * @param {string} userId - User ID
     * @param {number} limit - Maximum number of ratings
     * @returns {Promise<Array>} - User's ratings
     */
    async getUserRatings(userId, limit = 50) {
        try {
            // Check session cache first
            const cacheKey = `userRatings_${userId}_${limit}`;
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
            
            // Temporary fix: remove orderBy to avoid index requirement
            const query = this.db.collection(this.collection)
                .where('userId', '==', userId)
                .limit(limit);

            const results = await query.get();
            const ratings = [];

            results.forEach(doc => {
                ratings.push({ id: doc.id, ...doc.data() });
            });

            // Sort in memory by createdAt desc
            ratings.sort((a, b) => {
                const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt) || new Date(0);
                const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt) || new Date(0);
                return dateB - dateA;
            });
            
            // Cache for this session
            sessionStorage.setItem(cacheKey, JSON.stringify(ratings));

            return ratings;
        } catch (error) {
            console.error('Error getting user ratings:', error);
            return [];
        }
    }

    /**
     * Delete a rating
     * @param {string} userId - User ID
     * @param {string} ratingId - Rating document ID
     * @returns {Promise<boolean>} - Success status
     */
    async deleteRating(userId, ratingId) {
        try {
            const ratingRef = this.db.collection(this.collection).doc(ratingId);
            const ratingDoc = await ratingRef.get();

            if (!ratingDoc.exists) {
                throw new Error('Rating not found');
            }

            if (ratingDoc.data().userId !== userId) {
                throw new Error('Unauthorized to delete this rating');
            }

            const ratingData = ratingDoc.data();
            const movieId = ratingData?.movieId;

            if (movieId) {
                const movieRef = this.db.collection('movies').doc(movieId.toString());
                await this.db.runTransaction(async (transaction) => {
                    // 1. All READ operations first
                    const freshRatingDoc = await transaction.get(ratingRef);
                    if (!freshRatingDoc.exists) {
                        return;
                    }
                    const movieDoc = await transaction.get(movieRef);

                    // 2. All WRITE operations second
                    const freshRatingData = freshRatingDoc.data();
                    transaction.delete(ratingRef);

                    if (movieDoc.exists) {
                        const currentMovieData = movieDoc.data();
                        let ratingsSum = Math.max(0, (currentMovieData.ratingsSum || 0) - (freshRatingData.rating || 0));
                        let ratingsCount = Math.max(0, (currentMovieData.ratingsCount || 0) - 1);
                        let avgRating = ratingsCount > 0 ? Math.round((ratingsSum / ratingsCount) * 10) / 10 : 0;

                        transaction.update(movieRef, {
                            ratingsSum,
                            ratingsCount,
                            avgRating,
                            hasCommunityRating: ratingsCount > 0,
                            hasRatings: ratingsCount > 0,
                            lastRatingUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    }
                });
            } else {
                await ratingRef.delete();
            }
            
            // Invalidate cache
            await this.invalidateRatingsCache(userId);
            await this.invalidateAverageRatingsCache(movieId);

            // Recalculate top-3 genres for user asynchronously
            this.recalculateUserTopGenres(userId).catch(err => {
                console.warn('RatingService: Non-critical failure in topGenres recalculation:', err);
            });

            return true;
        } catch (error) {
            console.error('Error deleting rating:', error);
            throw new Error(`Failed to delete rating: ${error.message}`, { cause: error });
        }
    }

    /**
     * Recalculate user's top-3 genres from all their ratings and update users/{userId}.topGenres
     * @param {string} userId - Firebase Auth user ID
     * @returns {Promise<Array<string>>} - Array of top 0-3 genre names
     */
    async recalculateUserTopGenres(userId) {
        try {
            if (!userId) return [];

            const ratingsQuery = this.db.collection('ratings')
                .where('userId', '==', userId);

            const snapshot = await ratingsQuery.get();
            const userRef = this.db.collection('users').doc(userId);

            if (snapshot.empty) {
                await userRef.update({
                    topGenres: [],
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                return [];
            }

            const movieIdsSet = new Set();
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.movieId) {
                    movieIdsSet.add(data.movieId.toString());
                }
            });

            const movieIds = Array.from(movieIdsSet);
            if (movieIds.length === 0) {
                await userRef.update({
                    topGenres: [],
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                return [];
            }

            const movieCacheService = window.firebaseManager?.getMovieCacheService();
            let cachedMovies = {};
            if (movieCacheService) {
                cachedMovies = await movieCacheService.getBatchCachedMovies(movieIds);
            }

            const allGenres = [];
            Object.values(cachedMovies).forEach(movie => {
                if (Array.isArray(movie?.genres)) {
                    allGenres.push(...movie.genres);
                }
            });

            const topGenres = typeof calculateTopGenres === 'function'
                ? calculateTopGenres(allGenres, 3)
                : [];

            await userRef.update({
                topGenres,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            return topGenres;
        } catch (error) {
            console.warn('RatingService: Failed to recalculate top genres:', error);
            return [];
        }
    }

    /**
     * Get ratings for a specific movie
     * @param {number} movieId - Kinopoisk movie ID
     * @param {number} limit - Maximum number of ratings
     * @returns {Promise<Array>} - Movie ratings
     */
    async getMovieRatings(movieId, limit = 20) {
        try {
            const ratings = [];
            const normalizedMovieId = Number(movieId);
            const movieIdCandidates = [...new Set([
                normalizedMovieId,
                String(movieId)
            ])].filter(candidate => candidate !== 'NaN' && candidate !== undefined);

            for (const movieIdCandidate of movieIdCandidates) {
                const query = this.db.collection(this.collection)
                    .where('movieId', '==', movieIdCandidate);
                const results = await query.get();

                results.forEach(doc => {
                    if (!ratings.some(rating => rating.id === doc.id)) {
                        ratings.push({ id: doc.id, ...doc.data() });
                    }
                });
            }

            // Sort by createdAt descending in memory (to avoid index requirement)
            ratings.sort((a, b) => {
                const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt) || new Date(0);
                const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt) || new Date(0);
                return dateB - dateA;
            });

            // Apply limit after sorting
            return ratings.slice(0, limit);
        } catch (error) {
            console.error('Error getting movie ratings:', error);
            return [];
        }
    }

    /**
     * Get rating statistics for a user
     * @param {string} userId - User ID
     * @returns {Promise<Object>} - User rating statistics
     */
    async getUserRatingStats(userId) {
        try {
            const query = this.db.collection(this.collection)
                .where('userId', '==', userId);

            const results = await query.get();
            
            let totalRatings = 0;
            let averageRating = 0;
            let ratingDistribution = {};

            results.forEach(doc => {
                const data = doc.data();
                totalRatings++;
                averageRating += data.rating;
                
                const rating = data.rating;
                ratingDistribution[rating] = (ratingDistribution[rating] || 0) + 1;
            });

            averageRating = totalRatings > 0 ? Math.round((averageRating / totalRatings) * 10) / 10 : 0;

            return {
                totalRatings,
                averageRating,
                ratingDistribution
            };
        } catch (error) {
            console.error('Error getting user rating stats:', error);
            return {
                totalRatings: 0,
                averageRating: 0,
                ratingDistribution: {}
            };
        }
    }

    /**
     * Get all unique movie IDs that have ratings
     * @returns {Promise<Array<number>>} - Array of movie IDs with ratings
     */
    async getRatedMovieIds() {
        try {
            const snapshot = await this.db.collection(this.collection).get();
            const movieIds = new Set();
            
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.movieId) {
                    movieIds.add(data.movieId);
                }
            });
            
            return Array.from(movieIds);
        } catch (error) {
            console.error('Error getting rated movie IDs:', error);
            return [];
        }
    }

    /**
     * Update user profile data in all their ratings
     * @param {string} userId - User ID
     * @param {string} userName - New user display name
     * @param {string} userPhoto - New user photo URL
     * @returns {Promise<number>} - Number of ratings updated
     */
    async updateUserProfileInRatings(userId, userName, userPhoto) {
        try {
            const query = this.db.collection(this.collection)
                .where('userId', '==', userId);

            const results = await query.get();
            
            if (results.empty) {
                return 0;
            }

            const batch = this.db.batch();
            let updateCount = 0;

            results.forEach(doc => {
                const updateData = {
                    userName: userName,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                
                if (userPhoto) {
                    updateData.userPhoto = userPhoto;
                }
                
                batch.update(doc.ref, updateData);
                updateCount++;
            });

            await batch.commit();

            // Clear ratings cache after update
            try {
                const ratingsCacheService = window.firebaseManager?.getRatingsCacheService();
                if (ratingsCacheService) {
                    await ratingsCacheService.clearCache();
                }
            } catch (cacheError) {
                console.warn('Failed to clear ratings cache after profile update:', cacheError.message);
            }

            return updateCount;
        } catch (error) {
            console.error('Error updating user profile in ratings:', error);
            throw new Error(`Failed to update user profile in ratings: ${error.message}`, { cause: error });
        }
    }

    /**
     * Listen to real-time rating updates
     * @param {Function} callback - Callback function for updates
     * @returns {Function} - Unsubscribe function
     */
    listenToRatings(callback) {
        const unsubscribe = this.db.collection(this.collection)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .onSnapshot((snapshot) => {
                const ratings = [];
                snapshot.forEach(doc => {
                    ratings.push({ id: doc.id, ...doc.data() });
                });
                callback(ratings);
            });

        return unsubscribe;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RatingService;
}
if (typeof window !== 'undefined') {
    window.RatingService = RatingService;
}
