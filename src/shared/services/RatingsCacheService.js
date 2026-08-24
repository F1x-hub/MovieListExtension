/**
 * RatingsCacheService - Service for caching recent ratings data
 * Optimizes popup loading by caching ratings in chrome.storage.local
 */
class RatingsCacheService {
    constructor(firebaseManager) {
        this.firebaseManager = firebaseManager;
        this.CACHE_KEY = 'recent_ratings_cache';
        this.CACHE_TIMESTAMP_KEY = 'recent_ratings_timestamp';
        this.CACHE_HASH_KEY = 'recent_ratings_hash';
        this.AVERAGE_RATINGS_CACHE_KEY = 'average_ratings_cache';
        this.AVERAGE_RATINGS_TIMESTAMP_KEY = 'average_ratings_timestamp';
        this.CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        this.MAX_CACHED_RATINGS = 50;
        this.consecutiveCriticalErrors = 0;
        this.MAX_CONSECUTIVE_CRITICAL_ERRORS = 3;
    }

    getCacheKey(userId = null) {
        return userId ? `${this.CACHE_KEY}_${userId}` : this.CACHE_KEY;
    }

    getCacheTimestampKey(userId = null) {
        return userId ? `${this.CACHE_TIMESTAMP_KEY}_${userId}` : this.CACHE_TIMESTAMP_KEY;
    }

    getCacheHashKey(userId = null) {
        return userId ? `${this.CACHE_HASH_KEY}_${userId}` : this.CACHE_HASH_KEY;
    }

    /**
     * Get cached ratings or fetch from server if cache is invalid
     * @param {number} limit - Maximum number of ratings to return
     * @param {string|null} userId - Optional user ID
     * @returns {Promise<Array>} - Array of ratings with movie data
     */
    async getCachedRatings(limit = 50, userId = null) {
        try {
            // First try to get cached data
            const cachedData = await this.getCacheData(userId);
            
            if (cachedData && this.isCacheValid(cachedData.timestamp)) {
                console.log('Using cached ratings data');
                return cachedData.ratings.slice(0, limit);
            }

            // Cache is invalid or doesn't exist, fetch from server
            console.log('Cache invalid or missing, fetching from server');
            return await this.fetchAndCacheRatings(limit, null, userId);
        } catch (error) {
            console.error('Error getting cached ratings:', error);
            // Fallback to server fetch
            return await this.fetchAndCacheRatings(limit, null, userId);
        }
    }

    /**
     * Get cached ratings with smart refresh logic
     * @param {number} limit - Maximum number of ratings to return
     * @param {string} lastDocId - Last document ID for pagination (if null, fetches first page)
     * @param {string|null} userId - Optional user ID
     * @returns {Promise<{ratings: Array, isFromCache: boolean, lastDocId: string, hasMore: boolean}>}
     */
    async getCachedRatingsWithBackgroundRefresh(limit = 50, lastDocId = null, userId = null) {
        const startTime = performance.now();
        try {
            console.log('⏱️ [RatingsCacheService] Starting getCachedRatingsWithBackgroundRefresh');
            
            const cacheReadStart = performance.now();
            
            // Only use cache for the first page (no lastDocId)
            if (!lastDocId) {
                const cachedData = await this.getCacheData(userId);
                const cacheReadTime = Math.round(performance.now() - cacheReadStart);
                console.log(`⏱️ [RatingsCacheService] Cache read: ${cacheReadTime}ms`);
                
                if (cachedData && cachedData.ratings.length > 0) {
                    // Check if cache is still valid
                    if (this.isCacheValid(cachedData.timestamp)) {
                        // Return valid cached data immediately
                        const sliceStart = performance.now();
                        const ratings = cachedData.ratings.slice(0, limit);
                        const sliceTime = Math.round(performance.now() - sliceStart);
                        console.log(`⏱️ [RatingsCacheService] Slice ratings: ${sliceTime}ms`);
                        console.log(`✅ [RatingsCacheService] Found ${ratings.length} valid cached ratings (total time: ${Math.round(performance.now() - startTime)}ms)`);
                        
                        // Start background refresh (non-blocking) for first page
                        this.refreshCacheInBackground(limit, userId).catch(error => {
                            console.error('❌ [RatingsCacheService] Error refreshing cache in background:', error);
                        });
                        
                        // Calculate pagination info from cached data
                        const lastItem = ratings.length > 0 ? ratings[ratings.length - 1] : null;
                        
                        return { 
                            ratings, 
                            isFromCache: true,
                            // If we have cached data, we assume there might be more if we hit the limit
                            hasMore: ratings.length === limit, 
                            lastDocId: lastItem ? lastItem.id : null
                        };
                    } else {
                        console.log('⏱️ [RatingsCacheService] Cache expired, fetching fresh data');
                        // Cache expired, fetch fresh data instead of showing stale data
                        const result = await this.fetchAndCacheRatings(limit, null, userId);
                        console.log(`⏱️ [RatingsCacheService] Fresh data fetched (total time: ${Math.round(performance.now() - startTime)}ms)`);
                        return { ...result, isFromCache: false };
                    }
                }
            } else {
                console.log('⏱️ [RatingsCacheService] Pagination request (lastDocId present), bypassing cache');
            }

            console.log('⏱️ [RatingsCacheService] No cache available or pagination request, fetching from server');
            // No cache available, fetch from server
            const result = await this.fetchAndCacheRatings(limit, lastDocId, userId);
            console.log(`⏱️ [RatingsCacheService] Server data fetched (total time: ${Math.round(performance.now() - startTime)}ms)`);
            return { ...result, isFromCache: false };
        } catch (error) {
            console.error('❌ [RatingsCacheService] Error getting cached ratings with background refresh:', error);
            console.log('⏱️ [RatingsCacheService] Falling back to server fetch');
            const result = await this.fetchAndCacheRatings(limit, lastDocId, userId);
            console.log(`⏱️ [RatingsCacheService] Fallback fetch completed (total time: ${Math.round(performance.now() - startTime)}ms)`);
            return { ...result, isFromCache: false };
        }
    }

    /**
     * Refresh cache in background without blocking UI
     * @param {number} limit - Maximum number of ratings to fetch
     * @param {string|null} userId - Optional user ID
     */
    async refreshCacheInBackground(limit = 50, userId = null) {
        const startTime = performance.now();
        try {
            console.log('🔄 [RatingsCacheService] Starting background cache refresh');
            const result = await this.fetchAndCacheRatings(limit, null, userId);
            const totalTime = Math.round(performance.now() - startTime);
            console.log(`✅ [RatingsCacheService] Background cache refresh completed in ${totalTime}ms`);
            return result.ratings;
        } catch (error) {
            const totalTime = Math.round(performance.now() - startTime);
            console.error(`❌ [RatingsCacheService] Error refreshing cache in background (${totalTime}ms):`, error);
            // Don't throw - this is background operation, errors shouldn't affect UI
        }
    }

    /**
     * Fetch ratings from server and cache them
     * @param {number} limit - Maximum number of ratings to fetch
     * @param {string|DocumentSnapshot} lastCursor - Last document ID (string) or snapshot for pagination
     * @param {string|null} userId - Optional user ID to filter
     * @returns {Promise<{ratings: Array, lastDocId: string, lastDoc: DocumentSnapshot, hasMore: boolean, criticalError?: boolean}>}
     */
    async fetchAndCacheRatings(limit = 50, lastCursor = null, userId = null) {
        const startTime = performance.now();
        try {
            // 🔍 Diagnostic: log exactly what cursor type was received
            console.log('🔮 [RatingsCacheService] fetchAndCacheRatings called:', {
                limit,
                cursorType: lastCursor === null ? 'null' : typeof lastCursor,
                cursorIsSnapshot: lastCursor !== null && typeof lastCursor === 'object',
                cursorId: lastCursor?.id ?? lastCursor, // log .id if snapshot, raw string otherwise
                cursorClass: lastCursor?.constructor?.name ?? 'N/A',
                userId: userId || 'all'
            });
            
            const fetchStart = performance.now();
            const ratingService = this.firebaseManager.getRatingService();
            const result = await ratingService.getAllRatings(limit, lastCursor, userId);
            const ratings = result.ratings;
            const fetchTime = Math.round(performance.now() - fetchStart);
            console.log(`⏱️ [RatingsCacheService] getAllRatings from Firebase: ${fetchTime}ms (${ratings.length} ratings)`);

            // 🔍 Diagnostic: log the returned cursor
            console.log('📦 [RatingsCacheService] getAllRatings returned cursor:', {
                lastDocId: result.lastDocId,
                lastDocType: result.lastDoc ? typeof result.lastDoc : 'null',
                lastDocClass: result.lastDoc?.constructor?.name ?? 'null',
                hasMore: result.hasMore
            });

            // Enrich ratings with movie data
            const enrichStart = performance.now();
            const enrichResult = await this.enrichRatingsWithMovieData(ratings);
            const enrichTime = Math.round(performance.now() - enrichStart);
            console.log(`⏱️ [RatingsCacheService] enrichRatingsWithMovieData: ${enrichTime}ms`);

            // Cache the enriched ratings ONLY if it's the first page (no cursor)
            if (!lastCursor) {
                const cacheStart = performance.now();
                await this.cacheRatings(ratings, userId);
                const cacheTime = Math.round(performance.now() - cacheStart);
                console.log(`⏱️ [RatingsCacheService] cacheRatings: ${cacheTime}ms`);
            } else {
                console.log(`⏱️ [RatingsCacheService] Pagination request, skipping cache write`);
            }

            const totalTime = Math.round(performance.now() - startTime);
            console.log(`✅ [RatingsCacheService] fetchAndCacheRatings completed in ${totalTime}ms`);
            
            return {
                ratings,
                lastDocId: result.lastDocId,
                lastDoc: result.lastDoc, // Propagate the snapshot for better pagination performance
                hasMore: enrichResult?.criticalError ? false : result.hasMore,
                criticalError: enrichResult?.criticalError || false
            };
        } catch (error) {
            const totalTime = Math.round(performance.now() - startTime);
            console.error(`❌ [RatingsCacheService] Error fetching and caching ratings (${totalTime}ms):`, error);
            throw error;
        }
    }

    /**
     * Enrich ratings with movie data (same logic as PopupManager)
     * @param {Array} ratings - Array of ratings to enrich
     */
    async enrichRatingsWithMovieData(ratings) {
        const startTime = performance.now();
        const movieCacheService = this.firebaseManager.getMovieCacheService();
        const kinopoiskService = this.firebaseManager.getKinopoiskService();
        const movieIds = [...new Set(ratings.map(r => r.movieId))];
        let hasCriticalQuotaOr403 = false;
        
        try {
            const movieCacheStart = performance.now();
            // Use getBatchCachedMovies for better performance (uses documentId query)
            const cachedMoviesObj = await movieCacheService.getBatchCachedMovies(movieIds);
            // Convert object to array format for compatibility
            const cachedMovies = Object.values(cachedMoviesObj);
            const movieMap = new Map(cachedMovies.map(m => [m.kinopoiskId, m]));
            const movieCacheTime = Math.round(performance.now() - movieCacheStart);
            console.log(`⏱️ [RatingsCacheService] getBatchCachedMovies: ${movieCacheTime}ms (${cachedMovies.length}/${movieIds.length} cached)`);
            
            const missingMovieIds = movieIds.filter(id => !movieMap.has(id));
            
            if (missingMovieIds.length > 0) {
                console.log(`⏱️ [RatingsCacheService] Fetching ${missingMovieIds.length} movies from Kinopoisk API in parallel...`);
                const kinopoiskStart = performance.now();
                
                // Fetch missing movies in parallel for better performance
                const moviePromises = missingMovieIds.map(async (movieId, index) => {
                    const movieFetchStart = performance.now();
                    try {
                        const movieData = await kinopoiskService.getMovieById(movieId);
                        const movieFetchTime = Math.round(performance.now() - movieFetchStart);
                        if (movieData) {
                            movieMap.set(movieData.kinopoiskId, movieData);
                            try {
                                await movieCacheService.cacheRatedMovie(movieData);
                            } catch (cacheErr) {
                                console.error(`❌ [RatingsCacheService] Failed to cache movie ${movieId}:`, cacheErr);
                                const isQuota = cacheErr.message?.includes('quota') || cacheErr.message?.includes('Resource::kQuotaBytes') || cacheErr.name === 'QuotaExceededError';
                                if (isQuota) {
                                    hasCriticalQuotaOr403 = true;
                                }
                            }
                            console.log(`⏱️ [RatingsCacheService] Movie ${index+1}/${missingMovieIds.length}: ${movieData.name} (${movieFetchTime}ms)`);
                        }
                    } catch (error) {
                        const movieFetchTime = Math.round(performance.now() - movieFetchStart);
                        console.error(`❌ [RatingsCacheService] Failed to fetch movie ${movieId} (${movieFetchTime}ms):`, error);
                        const is403 = error.message?.includes('403') || error.message?.includes('Forbidden');
                        const isQuota = error.message?.includes('quota') || error.message?.includes('Resource::kQuotaBytes');
                        if (is403 || isQuota) {
                            hasCriticalQuotaOr403 = true;
                        }
                    }
                });
                
                await Promise.all(moviePromises);
                
                const kinopoiskTime = Math.round(performance.now() - kinopoiskStart);
                console.log(`⏱️ [RatingsCacheService] Kinopoisk API parallel fetch: ${kinopoiskTime}ms (${missingMovieIds.length} movies)`);
            }
            
            // Enrich with user profile data
            const userDataStart = performance.now();
            await this.enrichRatingsWithUserData(ratings);
            const userDataTime = Math.round(performance.now() - userDataStart);
            console.log(`⏱️ [RatingsCacheService] enrichRatingsWithUserData: ${userDataTime}ms`);
            
            const mapStart = performance.now();
            ratings.forEach(rating => {
                rating.movie = movieMap.get(rating.movieId);
            });
            const mapTime = Math.round(performance.now() - mapStart);
            console.log(`⏱️ [RatingsCacheService] Map movies to ratings: ${mapTime}ms`);
            
            if (hasCriticalQuotaOr403) {
                this.consecutiveCriticalErrors++;
                console.warn(`⚠️ [RatingsCacheService] Critical API/Storage error encountered (consecutive: ${this.consecutiveCriticalErrors}/${this.MAX_CONSECUTIVE_CRITICAL_ERRORS})`);
            } else {
                this.consecutiveCriticalErrors = 0;
            }

            const criticalErrorTripped = this.consecutiveCriticalErrors >= this.MAX_CONSECUTIVE_CRITICAL_ERRORS;
            if (criticalErrorTripped) {
                console.error(`🚨 [RatingsCacheService] CRITICAL CIRCUIT BREAKER TRIPPED: ${this.consecutiveCriticalErrors} consecutive quota/403 errors. Halting further pagination to protect storage and API quotas.`);
            }

            const totalTime = Math.round(performance.now() - startTime);
            console.log(`✅ [RatingsCacheService] enrichRatingsWithMovieData completed in ${totalTime}ms`);
            return { criticalError: criticalErrorTripped };
        } catch (error) {
            const totalTime = Math.round(performance.now() - startTime);
            console.error(`❌ [RatingsCacheService] Error enriching ratings with movie data (${totalTime}ms):`, error);
            return { criticalError: false };
        }
    }

    /**
     * Enrich ratings with current user profile data
     * @param {Array} ratings - Array of ratings to enrich
     */
    async enrichRatingsWithUserData(ratings) {
        const startTime = performance.now();
        try {
            const userIdsStart = performance.now();
            const userIds = [...new Set(ratings.map(r => r.userId))];
            const userIdsTime = Math.round(performance.now() - userIdsStart);
            console.log(`⏱️ [RatingsCacheService] Extract unique userIds: ${userIdsTime}ms (${userIds.length} users)`);
            
            const userService = this.firebaseManager.getUserService();
            const currentUser = this.firebaseManager.getCurrentUser();
            
            // Get profiles for all users in batch
            const profilesStart = performance.now();
            const userProfiles = await userService.getUserProfilesByIds(userIds);
            const userProfileMap = new Map(userProfiles.map(u => [u.userId || u.id, u]));
            const profilesTime = Math.round(performance.now() - profilesStart);
            console.log(`⏱️ [RatingsCacheService] getUserProfilesByIds: ${profilesTime}ms (${userProfiles.length} profiles)`);
            
            // Also check current user from auth
            if (currentUser) {
                const currentUserStart = performance.now();
                const currentUserProfile = await userService.getUserProfile(currentUser.uid);
                if (currentUserProfile) {
                    userProfileMap.set(currentUser.uid, currentUserProfile);
                } else if (currentUser.photoURL || currentUser.displayName) {
                    // Fallback to auth data if profile doesn't exist
                    userProfileMap.set(currentUser.uid, {
                        userId: currentUser.uid,
                        photoURL: currentUser.photoURL,
                        displayName: currentUser.displayName
                    });
                }
                const currentUserTime = Math.round(performance.now() - currentUserStart);
                console.log(`⏱️ [RatingsCacheService] Get current user profile: ${currentUserTime}ms`);
            }
            
            // Update ratings with current user data
            const updateStart = performance.now();
            ratings.forEach(rating => {
                const userProfile = userProfileMap.get(rating.userId);
                if (userProfile) {
                    // Update userPhoto if profile has a newer one
                    if (userProfile.photoURL && (!rating.userPhoto || rating.userPhoto !== userProfile.photoURL)) {
                        rating.userPhoto = userProfile.photoURL;
                    }
                    // Update userName if profile has a newer one
                    let bestName = userProfile.displayName;
                    if (typeof Utils !== 'undefined' && Utils.getDisplayName) {
                        bestName = Utils.getDisplayName(userProfile, null);
                    } else if (typeof window !== 'undefined' && window.Utils && window.Utils.getDisplayName) {
                        bestName = window.Utils.getDisplayName(userProfile, null);
                    }
                    
                    if (bestName && (!rating.userName || rating.userName !== bestName)) {
                        rating.userName = bestName;
                    }
                }
            });
            const updateTime = Math.round(performance.now() - updateStart);
            console.log(`⏱️ [RatingsCacheService] Update ratings with user data: ${updateTime}ms`);
            
            const totalTime = Math.round(performance.now() - startTime);
            console.log(`✅ [RatingsCacheService] enrichRatingsWithUserData completed in ${totalTime}ms`);
        } catch (error) {
            const totalTime = Math.round(performance.now() - startTime);
            console.error(`❌ [RatingsCacheService] Error enriching ratings with user data (${totalTime}ms):`, error);
        }
    }

    /**
     * Cache ratings data in chrome.storage.local
     * @param {Array} ratings - Ratings to cache
     * @param {string|null} userId - Optional user ID
     */
    async cacheRatings(ratings, userId = null) {
        try {
            // Check if chrome.storage is available
            if (!chrome || !chrome.storage || !chrome.storage.local) {
                console.error('RatingsCacheService: chrome.storage.local is not available for caching');
                return;
            }

            const timestamp = Date.now();
            const hash = this.generateRatingsHash(ratings);
            const cacheKey = this.getCacheKey(userId);
            const timestampKey = this.getCacheTimestampKey(userId);
            const hashKey = this.getCacheHashKey(userId);
            
            const cacheData = {
                [cacheKey]: ratings.slice(0, this.MAX_CACHED_RATINGS),
                [timestampKey]: timestamp,
                [hashKey]: hash
            };

            await chrome.storage.local.set(cacheData);
            console.log(`RatingsCacheService: Cached ${ratings.length} ratings for user ${userId || 'all'} at ${new Date(timestamp).toISOString()}`);
        } catch (error) {
            console.error('Error caching ratings:', error);
        }
    }

    /**
     * Get cached data from chrome.storage.local
     * @param {string|null} userId - Optional user ID
     * @returns {Promise<Object|null>} - Cached data or null
     */
    async getCacheData(userId = null) {
        try {
            // Check if chrome.storage is available
            if (!chrome || !chrome.storage || !chrome.storage.local) {
                console.error('RatingsCacheService: chrome.storage.local is not available');
                return null;
            }

            const cacheKey = this.getCacheKey(userId);
            const timestampKey = this.getCacheTimestampKey(userId);
            const hashKey = this.getCacheHashKey(userId);

            const result = await chrome.storage.local.get([
                cacheKey,
                timestampKey,
                hashKey
            ]);

            if (!result[cacheKey] || !result[timestampKey]) {
                console.log(`RatingsCacheService: No cached data found for user ${userId || 'all'}`);
                return null;
            }

            console.log(`RatingsCacheService: Found cached data with ${result[cacheKey].length} ratings for user ${userId || 'all'}`);
            return {
                ratings: result[cacheKey],
                timestamp: result[timestampKey],
                hash: result[hashKey]
            };
        } catch (error) {
            console.error('Error getting cache data:', error);
            return null;
        }
    }

    /**
     * Check if cache is still valid (within 24 hours)
     * @param {number} timestamp - Cache timestamp
     * @returns {boolean} - True if cache is valid
     */
    isCacheValid(timestamp) {
        if (!timestamp) return false;
        const now = Date.now();
        const age = now - timestamp;
        return age < this.CACHE_DURATION;
    }

    /**
     * Generate a simple hash of ratings for change detection
     * @param {Array} ratings - Ratings array
     * @returns {string} - Hash string
     */
    generateRatingsHash(ratings) {
        if (!ratings || ratings.length === 0) return '';
        
        // Create hash based on first 10 rating IDs and timestamps
        const hashData = ratings.slice(0, 10).map(r => `${r.id}-${r.createdAt?.seconds || 0}`).join('|');
        
        // Simple hash function
        let hash = 0;
        for (let i = 0; i < hashData.length; i++) {
            const char = hashData.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
    }

    /**
     * Check if there are new ratings by comparing hashes
     * @param {string|null} userId - Optional user ID
     * @returns {Promise<boolean>} - True if there are new ratings
     */
    async hasNewRatings(userId = null) {
        try {
            const cachedData = await this.getCacheData(userId);
            if (!cachedData || !cachedData.hash) return true;

            // Fetch latest ratings to compare
            const ratingService = this.firebaseManager.getRatingService();
            const result = await ratingService.getAllRatings(10, null, userId); // Just check first 10
            const newHash = this.generateRatingsHash(result.ratings);

            return newHash !== cachedData.hash;
        } catch (error) {
            console.error('Error checking for new ratings:', error);
            return true; // Assume there are new ratings on error
        }
    }

    /**
     * Clear all cached ratings data
     * @param {string|null} userId - Optional user ID
     */
    async clearCache(userId = null) {
        try {
            const keysToRemove = [
                this.CACHE_KEY,
                this.CACHE_TIMESTAMP_KEY,
                this.CACHE_HASH_KEY,
                this.AVERAGE_RATINGS_CACHE_KEY,
                this.AVERAGE_RATINGS_TIMESTAMP_KEY
            ];

            if (userId) {
                keysToRemove.push(
                    this.getCacheKey(userId),
                    this.getCacheTimestampKey(userId),
                    this.getCacheHashKey(userId)
                );
            }

            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                const allStorage = await chrome.storage.local.get(null);
                Object.keys(allStorage).forEach(k => {
                    if (k.startsWith('recent_ratings_')) {
                        keysToRemove.push(k);
                    }
                });
            }

            await chrome.storage.local.remove([...new Set(keysToRemove)]);
            console.log('Ratings cache cleared');
        } catch (error) {
            console.error('Error clearing cache:', error);
        }
    }

    /**
     * Get cache statistics
     * @returns {Promise<Object>} - Cache statistics
     */
    async getCacheStats() {
        try {
            const cachedData = await this.getCacheData();
            if (!cachedData) {
                return { exists: false, size: 0, age: 0, isValid: false };
            }

            const age = Date.now() - cachedData.timestamp;
            const isValid = this.isCacheValid(cachedData.timestamp);

            return {
                exists: true,
                size: cachedData.ratings.length,
                age: Math.round(age / 1000 / 60), // Age in minutes
                isValid,
                timestamp: new Date(cachedData.timestamp).toISOString()
            };
        } catch (error) {
            console.error('Error getting cache stats:', error);
            return { exists: false, size: 0, age: 0, isValid: false };
        }
    }

    /**
     * Cache average ratings for movies
     * @param {Map|Object} averageRatingsMap - Map or object with movieId as key and {average, count} as value
     */
    async cacheAverageRatings(averageRatingsMap) {
        try {
            if (!chrome || !chrome.storage || !chrome.storage.local) {
                console.error('RatingsCacheService: chrome.storage.local is not available for caching average ratings');
                return;
            }

            const timestamp = Date.now();
            const averageRatingsObj = averageRatingsMap instanceof Map 
                ? Object.fromEntries(averageRatingsMap)
                : averageRatingsMap;

            const cacheData = {
                [this.AVERAGE_RATINGS_CACHE_KEY]: averageRatingsObj,
                [this.AVERAGE_RATINGS_TIMESTAMP_KEY]: timestamp
            };

            await chrome.storage.local.set(cacheData);
            console.log(`RatingsCacheService: Cached average ratings for ${Object.keys(averageRatingsObj).length} movies`);
        } catch (error) {
            console.error('Error caching average ratings:', error);
        }
    }

    /**
     * Get cached average ratings
     * @returns {Promise<Map|null>} - Map of movieId to {average, count} or null
     */
    async getCachedAverageRatings() {
        try {
            if (!chrome || !chrome.storage || !chrome.storage.local) {
                console.error('RatingsCacheService: chrome.storage.local is not available');
                return null;
            }

            const result = await chrome.storage.local.get([
                this.AVERAGE_RATINGS_CACHE_KEY,
                this.AVERAGE_RATINGS_TIMESTAMP_KEY
            ]);

            if (!result[this.AVERAGE_RATINGS_CACHE_KEY] || !result[this.AVERAGE_RATINGS_TIMESTAMP_KEY]) {
                console.log('RatingsCacheService: No cached average ratings found');
                return null;
            }

            if (!this.isCacheValid(result[this.AVERAGE_RATINGS_TIMESTAMP_KEY])) {
                console.log('RatingsCacheService: Cached average ratings expired');
                return null;
            }

            const averageRatingsObj = result[this.AVERAGE_RATINGS_CACHE_KEY];
            const averageRatingsMap = new Map(Object.entries(averageRatingsObj));
            
            console.log(`RatingsCacheService: Found cached average ratings for ${averageRatingsMap.size} movies`);
            return averageRatingsMap;
        } catch (error) {
            console.error('Error getting cached average ratings:', error);
            return null;
        }
    }

    /**
     * Clear cached average ratings
     */
    async clearAverageRatingsCache() {
        try {
            await chrome.storage.local.remove([
                this.AVERAGE_RATINGS_CACHE_KEY,
                this.AVERAGE_RATINGS_TIMESTAMP_KEY
            ]);
            console.log('Average ratings cache cleared');
        } catch (error) {
            console.error('Error clearing average ratings cache:', error);
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RatingsCacheService;
}
if (typeof window !== 'undefined') {
    window.RatingsCacheService = RatingsCacheService;
}
