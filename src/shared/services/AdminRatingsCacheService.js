/**
 * AdminRatingsCacheService - Cache service for admin panel data
 * Caches movies and ratings in localStorage with background sync
 */
class AdminRatingsCacheService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.firebaseManager = firebaseManager;
        
        // Cache keys
        this.MOVIES_CACHE_KEY = 'admin_movies_cache';
        this.RATINGS_CACHE_KEY = 'admin_ratings_cache';
        this.USERS_CACHE_KEY = 'admin_users_cache';
        this.CACHE_TIMESTAMP_KEY = 'admin_cache_timestamp';
        this.USERS_CACHE_TIMESTAMP_KEY = 'admin_users_cache_timestamp';
        
        // Configuration
        this.CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
        this.BATCH_SIZE = 20;
        
        // State
        this.isOnline = navigator.onLine;
        this.backgroundSyncInProgress = false;
        
        // Listen for online/offline events
        window.addEventListener('online', () => {
            this.isOnline = true;
            console.log('[AdminCacheService] Back online');
        });
        window.addEventListener('offline', () => {
            this.isOnline = false;
            console.log('[AdminCacheService] Gone offline');
        });
    }

    /**
     * Check if cache is still valid
     * @returns {boolean}
     */
    isCacheValid() {
        try {
            const timestamp = localStorage.getItem(this.CACHE_TIMESTAMP_KEY);
            if (!timestamp) return false;
            
            const age = Date.now() - parseInt(timestamp, 10);
            return age < this.CACHE_TTL;
        } catch (e) {
            return false;
        }
    }

    /**
     * Check if users cache is still valid
     * @returns {boolean}
     */
    isUsersCacheValid() {
        try {
            const timestamp = localStorage.getItem(this.USERS_CACHE_TIMESTAMP_KEY);
            if (!timestamp) return false;
            
            const age = Date.now() - parseInt(timestamp, 10);
            return age < this.CACHE_TTL;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get cache age in minutes
     * @returns {number}
     */
    getCacheAgeMinutes() {
        try {
            const timestamp = localStorage.getItem(this.CACHE_TIMESTAMP_KEY);
            if (!timestamp) return Infinity;
            
            return Math.round((Date.now() - parseInt(timestamp, 10)) / 1000 / 60);
        } catch (e) {
            return Infinity;
        }
    }

    /**
     * Get cached movies
     * @returns {Array|null}
     */
    getCachedMovies() {
        try {
            const cached = localStorage.getItem(this.MOVIES_CACHE_KEY);
            if (!cached) return null;
            return JSON.parse(cached);
        } catch (e) {
            console.error('[AdminCacheService] Error reading movies cache:', e);
            return null;
        }
    }

    /**
     * Get cached ratings
     * @returns {Array|null}
     */
    getCachedRatings() {
        try {
            const cached = localStorage.getItem(this.RATINGS_CACHE_KEY);
            if (!cached) return null;
            return JSON.parse(cached);
        } catch (e) {
            console.error('[AdminCacheService] Error reading ratings cache:', e);
            return null;
        }
    }

    /**
     * Get cached users
     * @returns {Array|null}
     */
    getCachedUsers() {
        try {
            const cached = localStorage.getItem(this.USERS_CACHE_KEY);
            if (!cached) return null;
            return JSON.parse(cached);
        } catch (e) {
            console.error('[AdminCacheService] Error reading users cache:', e);
            return null;
        }
    }

    /**
     * Save movies to cache
     * @param {Array} movies
     */
    saveMoviesToCache(movies) {
        try {
            localStorage.setItem(this.MOVIES_CACHE_KEY, JSON.stringify(movies));
            localStorage.setItem(this.CACHE_TIMESTAMP_KEY, Date.now().toString());
            console.log(`[AdminCacheService] Saved ${movies.length} movies to cache`);
        } catch (e) {
            console.error('[AdminCacheService] Error saving movies to cache:', e);
            // Try to clear old cache if localStorage is full
            this.clearCache();
        }
    }

    /**
     * Save ratings to cache
     * @param {Array} ratings
     */
    saveRatingsToCache(ratings) {
        try {
            localStorage.setItem(this.RATINGS_CACHE_KEY, JSON.stringify(ratings));
            localStorage.setItem(this.CACHE_TIMESTAMP_KEY, Date.now().toString());
            console.log(`[AdminCacheService] Saved ${ratings.length} ratings to cache`);
        } catch (e) {
            console.error('[AdminCacheService] Error saving ratings to cache:', e);
        }
    }

    /**
     * Save users to cache
     * @param {Array} users
     */
    saveUsersToCache(users) {
        try {
            localStorage.setItem(this.USERS_CACHE_KEY, JSON.stringify(users));
            localStorage.setItem(this.USERS_CACHE_TIMESTAMP_KEY, Date.now().toString());
            console.log(`[AdminCacheService] Saved ${users.length} users to cache`);
        } catch (e) {
            console.error('[AdminCacheService] Error saving users to cache:', e);
            this.clearCache();
        }
    }

    /**
     * Invalidate users cache
     */
    invalidateUsersCache() {
        try {
            localStorage.removeItem(this.USERS_CACHE_KEY);
            localStorage.removeItem(this.USERS_CACHE_TIMESTAMP_KEY);
            console.log('[AdminCacheService] Users cache invalidated');
        } catch (e) {
            console.error('[AdminCacheService] Error invalidating users cache:', e);
        }
    }

    /**
     * Clear all cache
     */
    clearCache() {
        try {
            localStorage.removeItem(this.MOVIES_CACHE_KEY);
            localStorage.removeItem(this.RATINGS_CACHE_KEY);
            localStorage.removeItem(this.USERS_CACHE_KEY);
            localStorage.removeItem(this.CACHE_TIMESTAMP_KEY);
            localStorage.removeItem(this.USERS_CACHE_TIMESTAMP_KEY);
            console.log('[AdminCacheService] Cache cleared');
        } catch (e) {
            console.error('[AdminCacheService] Error clearing cache:', e);
        }
    }

    /**
     * Fetch movies page from Firestore
     * @param {Object} lastVisibleDoc - Last visible document from previous page
     * @param {number} pageSize - Number of items to fetch
     * @returns {Promise<{movies: Array, lastDoc: Object, hasMore: boolean}>}
     */
    async fetchMoviesPage(lastVisibleDoc = null, pageSize = 20) {
        try {
            console.log('[AdminCacheService] Fetching movies page from Firestore');
            
            let query = this.db.collection('movies')
                .orderBy('lastUpdated', 'desc')
                .limit(pageSize);

            if (lastVisibleDoc) {
                query = query.startAfter(lastVisibleDoc);
            }

            const snapshot = await query.get();
            const movies = [];
            
            snapshot.forEach(doc => {
                movies.push({
                    id: doc.id,
                    kinopoiskId: parseInt(doc.id, 10),
                    ...doc.data()
                });
            });

            const lastDoc = snapshot.docs[snapshot.docs.length - 1];
            const hasMore = snapshot.size === pageSize;

            console.log(`[AdminCacheService] Fetched ${movies.length} movies`);

            return { 
                movies, 
                lastDoc,
                hasMore
            };
        } catch (error) {
            console.error('[AdminCacheService] Error fetching movies page:', error);
            throw error;
        }
    }

    /**
     * Fetch all movies from Firestore (legacy, for cache refresh)
     * @param {Function} onBatchLoaded - Callback for progressive loading
     * @returns {Promise<{movies: Array, total: number}>}
     */
    async fetchAllMovies(onBatchLoaded = null) {
        try {
            const movies = [];
            let lastDoc = null;
            let hasMore = true;
            let batchNumber = 0;

            console.log('[AdminCacheService] Starting to fetch all movies from Firestore');

            while (hasMore) {
                let query = this.db.collection('movies')
                    .orderBy('lastUpdated', 'desc')
                    .limit(this.BATCH_SIZE);

                if (lastDoc) {
                    query = query.startAfter(lastDoc);
                }

                const snapshot = await query.get();
                
                if (snapshot.empty) {
                    hasMore = false;
                    break;
                }

                const batchMovies = [];
                snapshot.forEach(doc => {
                    batchMovies.push({
                        id: doc.id,
                        kinopoiskId: parseInt(doc.id, 10),
                        ...doc.data()
                    });
                });

                movies.push(...batchMovies);
                lastDoc = snapshot.docs[snapshot.docs.length - 1];
                batchNumber++;

                console.log(`[AdminCacheService] Loaded batch ${batchNumber}: ${batchMovies.length} movies (total: ${movies.length})`);

                if (onBatchLoaded) {
                    onBatchLoaded(batchMovies, movies.length);
                }

                if (snapshot.size < this.BATCH_SIZE) {
                    hasMore = false;
                }
            }

            return { movies, total: movies.length };
        } catch (error) {
            console.error('[AdminCacheService] Error fetching movies:', error);
            throw error;
        }
    }

    /**
     * Fetch all ratings from Firestore
     * @returns {Promise<Array>}
     */
    async fetchAllRatings() {
        try {
            const ratings = [];
            const snapshot = await this.db.collection('ratings')
                .orderBy('createdAt', 'desc')
                .limit(500)
                .get();

            snapshot.forEach(doc => {
                ratings.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            console.log(`[AdminCacheService] Fetched ${ratings.length} ratings from Firestore`);
            return ratings;
        } catch (error) {
            console.error('[AdminCacheService] Error fetching ratings:', error);
            throw error;
        }
    }

    /**
     * Fetch user data for ratings
     * @param {Array} ratings
     * @returns {Promise<Map>}
     */
    async fetchUsersForRatings(ratings) {
        const userIds = [...new Set(ratings.map(r => r.userId))];
        const userMap = new Map();

        // Batch fetch users
        const batchSize = 10;
        for (let i = 0; i < userIds.length; i += batchSize) {
            const batch = userIds.slice(i, i + batchSize);
            
            try {
                const promises = batch.map(userId => 
                    this.db.collection('users').doc(userId).get()
                );
                const docs = await Promise.all(promises);
                
                docs.forEach(doc => {
                    if (doc.exists) {
                        userMap.set(doc.id, { id: doc.id, ...doc.data() });
                    }
                });
            } catch (e) {
                console.warn('[AdminCacheService] Error fetching user batch:', e);
            }
        }

        return userMap;
    }

    /**
     * Get data with cache-first strategy
     * @param {Object} options
     * @param {Function} options.onBatchLoaded - Progress callback for movies
     * @param {Function} options.onCacheUsed - Called when using cached data
     * @param {Function} options.onBackgroundSyncStart - Called when background sync starts
     * @param {Function} options.onBackgroundSyncComplete - Called when background sync completes
     * @returns {Promise<{movies: Array, ratings: Array, ratingsMap: Map, usersMap: Map, isFromCache: boolean}>}
     */
    async getData({
        onBatchLoaded = null,
        onCacheUsed = null,
        onBackgroundSyncStart = null,
        onBackgroundSyncComplete = null
    } = {}) {
        const cachedMovies = this.getCachedMovies();
        const cachedRatings = this.getCachedRatings();
        const cacheValid = this.isCacheValid();

        // If cache is valid, return cached data and optionally sync in background
        if (cacheValid && cachedMovies && cachedRatings) {
            console.log('[AdminCacheService] Using valid cache');
            
            if (onCacheUsed) {
                onCacheUsed(this.getCacheAgeMinutes());
            }

            // Build ratings and users map from cached data
            const ratingsMap = this.buildRatingsMap(cachedRatings);
            const usersMap = await this.fetchUsersForRatings(cachedRatings);

            return {
                movies: cachedMovies,
                ratings: cachedRatings,
                ratingsMap,
                usersMap,
                isFromCache: true
            };
        }

        // If cache expired but exists, return cached immediately and sync in background
        if (cachedMovies && cachedRatings && !cacheValid) {
            console.log('[AdminCacheService] Cache expired, using stale data with background refresh');
            
            if (onCacheUsed) {
                onCacheUsed(this.getCacheAgeMinutes());
            }

            const ratingsMap = this.buildRatingsMap(cachedRatings);
            const usersMap = await this.fetchUsersForRatings(cachedRatings);

            // Start background sync
            this.backgroundSync({
                onBackgroundSyncStart,
                onBackgroundSyncComplete,
                onBatchLoaded
            });

            return {
                movies: cachedMovies,
                ratings: cachedRatings,
                ratingsMap,
                usersMap,
                isFromCache: true
            };
        }

        // No cache, fetch fresh data
        console.log('[AdminCacheService] No cache, fetching from Firestore');
        return await this.forceRefresh({ onBatchLoaded });
    }

    /**
     * Force refresh data from Firestore
     * @param {Object} options
     * @returns {Promise<{movies: Array, ratings: Array, ratingsMap: Map, usersMap: Map, isFromCache: boolean}>}
     */
    async forceRefresh({ onBatchLoaded = null } = {}) {
        if (!this.isOnline) {
            throw new Error('Cannot refresh: device is offline');
        }

        try {
            // Fetch movies with progress
            const { movies } = await this.fetchAllMovies(onBatchLoaded);
            
            // Fetch ratings
            const ratings = await this.fetchAllRatings();
            
            // Fetch users for ratings
            const usersMap = await this.fetchUsersForRatings(ratings);
            
            // Enrich ratings with user data for caching
            const enrichedRatings = ratings.map(r => ({
                ...r,
                user: usersMap.get(r.userId) || null
            }));

            // Save to cache
            this.saveMoviesToCache(movies);
            this.saveRatingsToCache(enrichedRatings);

            // Build ratings map
            const ratingsMap = this.buildRatingsMap(enrichedRatings);

            return {
                movies,
                ratings: enrichedRatings,
                ratingsMap,
                usersMap,
                isFromCache: false
            };
        } catch (error) {
            console.error('[AdminCacheService] Error during force refresh:', error);
            throw error;
        }
    }

    /**
     * Background sync without blocking UI
     * @param {Object} options
     */
    async backgroundSync({
        onBackgroundSyncStart = null,
        onBackgroundSyncComplete = null,
        onBatchLoaded = null
    } = {}) {
        if (this.backgroundSyncInProgress) {
            console.log('[AdminCacheService] Background sync already in progress');
            return;
        }

        if (!this.isOnline) {
            console.log('[AdminCacheService] Skipping background sync: offline');
            return;
        }

        this.backgroundSyncInProgress = true;
        
        if (onBackgroundSyncStart) {
            onBackgroundSyncStart();
        }

        try {
            const result = await this.forceRefresh({ onBatchLoaded: null });
            
            if (onBackgroundSyncComplete) {
                onBackgroundSyncComplete(result);
            }
        } catch (error) {
            console.error('[AdminCacheService] Background sync failed:', error);
        } finally {
            this.backgroundSyncInProgress = false;
        }
    }

    /**
     * Build ratings map by movieId
     * @param {Array} ratings
     * @returns {Map<number, Array>}
     */
    buildRatingsMap(ratings) {
        const map = new Map();
        ratings.forEach(rating => {
            const movieId = rating.movieId;
            if (!map.has(movieId)) {
                map.set(movieId, []);
            }
            map.get(movieId).push(rating);
        });
        return map;
    }

    /**
     * Update cache after delete operation
     * @param {Array<number>} deletedMovieIds
     */
    removeMoviesFromCache(deletedMovieIds) {
        try {
            const movies = this.getCachedMovies();
            const ratings = this.getCachedRatings();
            
            if (movies) {
                const updatedMovies = movies.filter(m => !deletedMovieIds.includes(m.kinopoiskId));
                this.saveMoviesToCache(updatedMovies);
            }
            
            if (ratings) {
                const updatedRatings = ratings.filter(r => !deletedMovieIds.includes(r.movieId));
                this.saveRatingsToCache(updatedRatings);
            }
        } catch (e) {
            console.error('[AdminCacheService] Error updating cache after delete:', e);
        }
    }

    /**
     * Update a single movie in cache
     * @param {Object} movie
     */
    updateMovieInCache(movie) {
        try {
            const movies = this.getCachedMovies();
            if (!movies) return;
            
            const index = movies.findIndex(m => m.kinopoiskId === movie.kinopoiskId);
            if (index !== -1) {
                movies[index] = { ...movies[index], ...movie };
            } else {
                movies.unshift(movie);
            }
            
            this.saveMoviesToCache(movies);
        } catch (e) {
            console.error('[AdminCacheService] Error updating movie in cache:', e);
        }
    }

    /**
     * Check if operations can be performed (online check)
     * @returns {{canWrite: boolean, reason: string}}
     */
    checkWriteAccess() {
        if (!this.isOnline) {
            return {
                canWrite: false,
                reason: 'Устройство офлайн. Операции записи недоступны.'
            };
        }
        return { canWrite: true, reason: '' };
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdminRatingsCacheService;
}
if (typeof window !== 'undefined') {
    window.AdminRatingsCacheService = AdminRatingsCacheService;
}
