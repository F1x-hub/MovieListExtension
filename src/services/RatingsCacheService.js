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
        this.CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        this.MAX_CACHED_RATINGS = 50;
    }

    /**
     * Get cached ratings or fetch from server if cache is invalid
     * @param {number} limit - Maximum number of ratings to return
     * @returns {Promise<Array>} - Array of ratings with movie data
     */
    async getCachedRatings(limit = 50) {
        try {
            // First try to get cached data
            const cachedData = await this.getCacheData();
            
            if (cachedData && this.isCacheValid(cachedData.timestamp)) {
                console.log('Using cached ratings data');
                return cachedData.ratings.slice(0, limit);
            }

            // Cache is invalid or doesn't exist, fetch from server
            console.log('Cache invalid or missing, fetching from server');
            return await this.fetchAndCacheRatings(limit);
        } catch (error) {
            console.error('Error getting cached ratings:', error);
            // Fallback to server fetch
            return await this.fetchAndCacheRatings(limit);
        }
    }

    /**
     * Get cached ratings with smart refresh logic
     * @param {number} limit - Maximum number of ratings to return
     * @returns {Promise<{ratings: Array, isFromCache: boolean}>}
     */
    async getCachedRatingsWithBackgroundRefresh(limit = 50) {
        try {
            console.log('RatingsCacheService: Getting cached ratings with background refresh');
            const cachedData = await this.getCacheData();
            
            if (cachedData && cachedData.ratings.length > 0) {
                // Check if cache is still valid
                if (this.isCacheValid(cachedData.timestamp)) {
                    // Return valid cached data immediately
                    const ratings = cachedData.ratings.slice(0, limit);
                    console.log(`RatingsCacheService: Found ${ratings.length} valid cached ratings`);
                    return { ratings, isFromCache: true };
                } else {
                    console.log('RatingsCacheService: Cache expired, fetching fresh data');
                    // Cache expired, fetch fresh data instead of showing stale data
                    const ratings = await this.fetchAndCacheRatings(limit);
                    return { ratings, isFromCache: false };
                }
            }

            console.log('RatingsCacheService: No cache available, fetching from server');
            // No cache available, fetch from server
            const ratings = await this.fetchAndCacheRatings(limit);
            return { ratings, isFromCache: false };
        } catch (error) {
            console.error('Error getting cached ratings with background refresh:', error);
            console.log('RatingsCacheService: Falling back to server fetch');
            const ratings = await this.fetchAndCacheRatings(limit);
            return { ratings, isFromCache: false };
        }
    }

    /**
     * Fetch ratings from server and cache them
     * @param {number} limit - Maximum number of ratings to fetch
     * @returns {Promise<Array>} - Array of ratings with movie data
     */
    async fetchAndCacheRatings(limit = 50) {
        try {
            const ratingService = this.firebaseManager.getRatingService();
            const result = await ratingService.getAllRatings(limit);
            const ratings = result.ratings;

            // Enrich ratings with movie data
            await this.enrichRatingsWithMovieData(ratings);

            // Cache the enriched ratings
            await this.cacheRatings(ratings);

            return ratings;
        } catch (error) {
            console.error('Error fetching and caching ratings:', error);
            throw error;
        }
    }

    /**
     * Enrich ratings with movie data (same logic as PopupManager)
     * @param {Array} ratings - Array of ratings to enrich
     */
    async enrichRatingsWithMovieData(ratings) {
        const movieCacheService = this.firebaseManager.getMovieCacheService();
        const kinopoiskService = this.firebaseManager.getKinopoiskService();
        const movieIds = [...new Set(ratings.map(r => r.movieId))];
        
        try {
            const cachedMovies = await movieCacheService.getCachedMoviesByIds(movieIds);
            const movieMap = new Map(cachedMovies.map(m => [m.kinopoiskId, m]));
            
            const missingMovieIds = movieIds.filter(id => !movieMap.has(id));
            
            if (missingMovieIds.length > 0) {
                console.log(`Fetching ${missingMovieIds.length} movies from Kinopoisk API...`);
                
                for (const movieId of missingMovieIds) {
                    try {
                        const movieData = await kinopoiskService.getMovieById(movieId);
                        if (movieData) {
                            movieMap.set(movieData.kinopoiskId, movieData);
                            await movieCacheService.cacheRatedMovie(movieData);
                            console.log(`Cached movie: ${movieData.name}`);
                        }
                    } catch (error) {
                        console.error(`Failed to fetch movie ${movieId}:`, error);
                    }
                }
            }
            
            ratings.forEach(rating => {
                rating.movie = movieMap.get(rating.movieId);
            });
        } catch (error) {
            console.error('Error enriching ratings with movie data:', error);
        }
    }

    /**
     * Cache ratings data in chrome.storage.local
     * @param {Array} ratings - Ratings to cache
     */
    async cacheRatings(ratings) {
        try {
            // Check if chrome.storage is available
            if (!chrome || !chrome.storage || !chrome.storage.local) {
                console.error('RatingsCacheService: chrome.storage.local is not available for caching');
                return;
            }

            const timestamp = Date.now();
            const hash = this.generateRatingsHash(ratings);
            
            const cacheData = {
                [this.CACHE_KEY]: ratings.slice(0, this.MAX_CACHED_RATINGS),
                [this.CACHE_TIMESTAMP_KEY]: timestamp,
                [this.CACHE_HASH_KEY]: hash
            };

            await chrome.storage.local.set(cacheData);
            console.log(`RatingsCacheService: Cached ${ratings.length} ratings at ${new Date(timestamp).toISOString()}`);
        } catch (error) {
            console.error('Error caching ratings:', error);
        }
    }

    /**
     * Get cached data from chrome.storage.local
     * @returns {Promise<Object|null>} - Cached data or null
     */
    async getCacheData() {
        try {
            // Check if chrome.storage is available
            if (!chrome || !chrome.storage || !chrome.storage.local) {
                console.error('RatingsCacheService: chrome.storage.local is not available');
                return null;
            }

            const result = await chrome.storage.local.get([
                this.CACHE_KEY,
                this.CACHE_TIMESTAMP_KEY,
                this.CACHE_HASH_KEY
            ]);

            if (!result[this.CACHE_KEY] || !result[this.CACHE_TIMESTAMP_KEY]) {
                console.log('RatingsCacheService: No cached data found');
                return null;
            }

            console.log(`RatingsCacheService: Found cached data with ${result[this.CACHE_KEY].length} ratings`);
            return {
                ratings: result[this.CACHE_KEY],
                timestamp: result[this.CACHE_TIMESTAMP_KEY],
                hash: result[this.CACHE_HASH_KEY]
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
     * @returns {Promise<boolean>} - True if there are new ratings
     */
    async hasNewRatings() {
        try {
            const cachedData = await this.getCacheData();
            if (!cachedData || !cachedData.hash) return true;

            // Fetch latest ratings to compare
            const ratingService = this.firebaseManager.getRatingService();
            const result = await ratingService.getAllRatings(10); // Just check first 10
            const newHash = this.generateRatingsHash(result.ratings);

            return newHash !== cachedData.hash;
        } catch (error) {
            console.error('Error checking for new ratings:', error);
            return true; // Assume there are new ratings on error
        }
    }

    /**
     * Clear all cached ratings data
     */
    async clearCache() {
        try {
            await chrome.storage.local.remove([
                this.CACHE_KEY,
                this.CACHE_TIMESTAMP_KEY,
                this.CACHE_HASH_KEY
            ]);
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
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RatingsCacheService;
} else {
    window.RatingsCacheService = RatingsCacheService;
}
