/**
 * MovieCacheService - Service for caching movie data in Firestore
 * Reduces API calls by storing movie information locally
 */
class MovieCacheService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.collection = 'movies';
    }

    /**
     * Get cached movie by Kinopoisk ID
     * @param {number} kinopoiskId - Kinopoisk movie ID
     * @returns {Promise<Object|null>} - Cached movie data or null
     */
    async getCachedMovie(kinopoiskId) {
        try {
            // Check localStorage first (fastest)
            const localKey = `kp_movie_${kinopoiskId}`;
            const localData = localStorage.getItem(localKey);
            if (localData) {
                try {
                    const parsed = JSON.parse(localData);
                    // Check local cache expiry (7 days for local to be safe, or just utilize it)
                    // For now, let's treat local cache as valid if present to maximize speed
                    return parsed;
                } catch {
                    localStorage.removeItem(localKey);
                }
            }

            // Fallback to Firestore
            const docRef = this.db.collection(this.collection).doc(kinopoiskId.toString());
            const doc = await docRef.get();
            
            if (doc.exists) {
                const data = doc.data();
                // Check if cache is still valid (24 hours)
                const cacheAge = Date.now() - new Date(data.lastUpdated).getTime();
                const maxAge = KINOPOISK_CONFIG.CACHE_DURATION;
                
                if (cacheAge < maxAge) {
                    const movieData = { id: doc.id, ...data };
                    // Update local storage
                    this.saveToLocalStorage(kinopoiskId, movieData);
                    return movieData;
                } else {
                    // Cache expired, remove it
                    await docRef.delete();
                    return null;
                }
            }
            return null;
        } catch (error) {
            console.error('Error getting cached movie:', error);
            return null;
        }
    }

    /**
     * Get multiple cached movies by Kinopoisk IDs (batch operation)
     * @param {Array<number>} kinopoiskIds - Array of Kinopoisk movie IDs
     * @returns {Promise<Object>} - Map of movieId to cached movie data
     */
    async getBatchCachedMovies(kinopoiskIds) {
        const startTime = performance.now();
        console.group('[MovieCache] getBatchCachedMovies');
        const uniqueIds = Array.from(new Set(kinopoiskIds.map(id => id?.toString()).filter(Boolean)));
        console.log(`Checking cache for ${uniqueIds.length} movies...`);
        try {
            const cachedMovies = {};
            const missingFromLocal = [];

            // 1. Check LocalStorage first for all IDs
            uniqueIds.forEach(id => {
                const localKey = `kp_movie_${id}`;
                const localData = localStorage.getItem(localKey);
                if (localData) {
                    try {
                        const parsed = JSON.parse(localData);
                        const touched = { ...parsed, _lru: Date.now() };
                        cachedMovies[id] = touched;
                        try {
                            localStorage.setItem(localKey, JSON.stringify(touched));
                        } catch {
                            // Keep the cache hit even if touching LRU fails due to quota pressure.
                        }
                    } catch {
                        localStorage.removeItem(localKey);
                        missingFromLocal.push(id);
                    }
                } else {
                    missingFromLocal.push(id);
                }
            });

            console.log(`[MovieCache] LocalStorage hits: ${Object.keys(cachedMovies).length}, misses: ${missingFromLocal.length}`);

            if (missingFromLocal.length === 0) {
                console.log(`[MovieCache] All movies found in LocalStorage. Time: ${(performance.now() - startTime).toFixed(2)}ms`);
                console.groupEnd();
                return cachedMovies;
            }

            // 2. Check Firestore for missing IDs
            const docIds = missingFromLocal.map(id => id.toString());
            
            // Chunk requests if too many
            const chunks = [];
            const CHUNK_SIZE = 10;
            for (let i = 0; i < docIds.length; i += CHUNK_SIZE) {
                chunks.push(docIds.slice(i, i + CHUNK_SIZE));
            }

            console.log(`[MovieCache] Fetching ${missingFromLocal.length} movies from Firestore in ${chunks.length} chunks...`);

            for (const chunk of chunks) {
                const query = this.db.collection(this.collection)
                    .where(firebase.firestore.FieldPath.documentId(), 'in', chunk);
                
                const querySnapshot = await query.get();
                
                querySnapshot.forEach(doc => {
                    const kinopoiskId = parseInt(doc.id);
                    const data = doc.data();
                    
                    // Check if cache is still valid
                    const cacheAge = Date.now() - new Date(data.lastUpdated).getTime();
                    const maxAge = KINOPOISK_CONFIG.CACHE_DURATION;
                    
                    if (cacheAge < maxAge) {
                        const movieData = { id: doc.id, ...data };
                        cachedMovies[kinopoiskId] = movieData;
                        // Save to local storage for next time
                        this.saveToLocalStorage(kinopoiskId, movieData);
                    } else {
                        console.log(`[MovieCache] Cache expired for ${kinopoiskId} (${(cacheAge / 3600000).toFixed(1)}h old). Deleting...`);
                        doc.ref.delete().catch(console.warn);
                    }
                });
            }
            
            const totalFound = Object.keys(cachedMovies).length;
            console.log(`[MovieCache] Total found: ${totalFound}/${uniqueIds.length}. Time: ${(performance.now() - startTime).toFixed(2)}ms`);
            console.groupEnd();
            return cachedMovies;
            
        } catch (error) {
            console.error('[MovieCache] Error batch checking cache:', error);
            console.groupEnd();
            return {};
        }
    }

    /**
     * Cache movie data in Firestore and LocalStorage
     * @param {Object} movieData - Movie data to cache
     * @param {boolean} isRated - Whether this movie has ratings (required to cache)
     * @returns {Promise<Object>} - Cached movie data with ID
     */
    async cacheMovie(movieData, isRated = false) {
        try {
            // Remove the check that prevented caching unrated movies
            // We want to cache viewed movies to save API calls
            
            const movieId = movieData.kinopoiskId.toString();
            
            const cacheData = {
                ...movieData,
                lastUpdated: new Date().toISOString(),
                cachedAt: firebase.firestore.FieldValue.serverTimestamp(),
                hasRatings: isRated // Set correctly based on argument
            };

            // Save to LocalStorage immediately
            this.saveToLocalStorage(movieId, { id: movieId, ...movieData, lastUpdated: new Date().toISOString() });

            // Save to Firestore asynchronously (don't block UI)
            this.db.collection(this.collection).doc(movieId)
                .set(cacheData, { merge: true })
                .catch(err => console.error('Background Firestore cache update failed:', err));

            return { id: movieId, ...cacheData };
        } catch (error) {
            console.error('Error caching movie:', error);
            throw new Error(`Failed to cache movie: ${error.message}`, { cause: error });
        }
    }

    /**
     * Helper to save to local storage with simple eviction
     */
    saveToLocalStorage(id, data) {
        // Don't cache placeholder data
        if (data && (data.name === 'Loading...' || data.name === 'Unknown Movie')) {
            return;
        }

        const localKey = `kp_movie_${id}`;
        const payload = {
            ...data,
            _lru: Date.now()
        };

        try {
            localStorage.setItem(localKey, JSON.stringify(payload));
        } catch {
            console.warn('LocalStorage full, clearing old cache entries...');
            try {
                const entries = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key.startsWith('kp_movie_')) {
                        let lru = 0;
                        try {
                            const cached = JSON.parse(localStorage.getItem(key));
                            lru = cached?._lru || new Date(cached?.lastUpdated || 0).getTime() || 0;
                        } catch {
                            lru = 0;
                        }
                        entries.push({ key, lru });
                    }
                }

                entries.sort((a, b) => a.lru - b.lru);
                const removeCount = Math.max(1, Math.ceil(entries.length * 0.3));
                entries.slice(0, removeCount).forEach(({ key }) => localStorage.removeItem(key));

                // Try again
                localStorage.setItem(localKey, JSON.stringify(payload));
            } catch (retryError) {
                console.error('Failed to clear localStorage space:', retryError);
            }
        }
    }

    /**
     * Update cached movie data
     * @param {number} kinopoiskId - Kinopoisk movie ID
     * @param {Object} updateData - Data to update
     * @returns {Promise<Object>} - Updated movie data
     */
    async updateMovieCache(kinopoiskId, updateData) {
        try {
            const movieId = kinopoiskId.toString();
            const docRef = this.db.collection(this.collection).doc(movieId);
            
            const updatePayload = {
                ...updateData,
                lastUpdated: new Date().toISOString(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            // Update local storage
            const localKey = `kp_movie_${movieId}`;
            const existingLocal = localStorage.getItem(localKey);
            if (existingLocal) {
                try {
                    const parsed = JSON.parse(existingLocal);
                    const updatedLocal = { ...parsed, ...updateData, lastUpdated: new Date().toISOString() };
                    localStorage.setItem(localKey, JSON.stringify(updatedLocal));
                } catch {
                    // Ignore parsing errors for individual cached items
                }
            }

            await docRef.update(updatePayload);
            const updatedDoc = await docRef.get();
            return { id: updatedDoc.id, ...updatedDoc.data() };
        } catch (error) {
            console.error('Error updating movie cache:', error);
            throw new Error(`Failed to update movie cache: ${error.message}`, { cause: error });
        }
    }

    /**
     * Search cached movies by query
     * @param {string} query - Search query
     * @param {number} limit - Maximum results
     * @returns {Promise<Array>} - Array of cached movies
     */
    async searchCachedMovies(query, limit = 20) {
        try {
            const queryLower = query.toLowerCase().trim();
            
            // Get all movies and filter client-side for better relevance
            const allMoviesQuery = this.db.collection(this.collection)
                .limit(limit * 3); // Get more to filter

            const allResults = await allMoviesQuery.get();
            let movies = [];
            
            allResults.forEach(doc => {
                const data = doc.data();
                const name = data.name?.toLowerCase() || '';
                const altName = data.alternativeName?.toLowerCase() || '';
                
                // Check if movie matches query
                if (name.includes(queryLower) || altName.includes(queryLower)) {
                    movies.push({ id: doc.id, ...data });
                }
            });

            // Sort by relevance: exact match first, then by popularity
            movies = this.sortCachedMoviesByRelevance(movies, queryLower);
            
            // Return limited results
            return movies.slice(0, limit);
        } catch (error) {
            console.error('Error searching cached movies:', error);
            return [];
        }
    }

    /**
     * Sort cached movies by relevance
     * @param {Array} movies - Array of movies
     * @param {string} queryLower - Lowercase search query
     * @returns {Array} - Sorted movies
     */
    sortCachedMoviesByRelevance(movies, queryLower) {
        return movies.sort((a, b) => {
            const aName = a.name?.toLowerCase() || '';
            const bName = b.name?.toLowerCase() || '';
            
            // Exact match gets highest priority
            const aExactMatch = aName === queryLower;
            const bExactMatch = bName === queryLower;
            
            if (aExactMatch && !bExactMatch) return -1;
            if (!aExactMatch && bExactMatch) return 1;
            
            // Starts with query gets second priority
            const aStartsWith = aName.startsWith(queryLower);
            const bStartsWith = bName.startsWith(queryLower);
            
            if (aStartsWith && !bStartsWith) return -1;
            if (!aStartsWith && bStartsWith) return 1;
            
            // Contains query gets third priority
            const aContains = aName.includes(queryLower);
            const bContains = bName.includes(queryLower);
            
            if (aContains && !bContains) return -1;
            if (!aContains && bContains) return 1;
            
            // Finally sort by popularity (votes.kp) descending
            const aVotes = a.votes?.kp || 0;
            const bVotes = b.votes?.kp || 0;
            
            return bVotes - aVotes;
        });
    }

    /**
     * Get multiple cached movies by IDs
     * @param {Array<number>} kinopoiskIds - Array of Kinopoisk IDs
     * @returns {Promise<Array>} - Array of cached movies
     */
    async getCachedMoviesByIds(kinopoiskIds) {
        try {
            const movies = [];
            const batchSize = 10; // Firestore 'in' query limit
            
            for (let i = 0; i < kinopoiskIds.length; i += batchSize) {
                const batch = kinopoiskIds.slice(i, i + batchSize);
                const query = this.db.collection(this.collection)
                    .where('kinopoiskId', 'in', batch);
                
                const results = await query.get();
                results.forEach(doc => {
                    movies.push({ id: doc.id, ...doc.data() });
                });
            }
            
            return movies;
        } catch (error) {
            console.error('Error getting cached movies by IDs:', error);
            return [];
        }
    }

    /**
     * Remove expired cache entries
     * @returns {Promise<number>} - Number of removed entries
     */
    async cleanupExpiredCache() {
        try {
            const maxAge = KINOPOISK_CONFIG.CACHE_DURATION;
            const cutoffTime = new Date(Date.now() - maxAge).toISOString();
            
            const query = this.db.collection(this.collection)
                .where('lastUpdated', '<', cutoffTime)
                .limit(100); // Process in batches
            
            const results = await query.get();
            const batch = this.db.batch();
            let count = 0;
            
            results.forEach(doc => {
                batch.delete(doc.ref);
                count++;
            });
            
            if (count > 0) {
                await batch.commit();
            }
            
            return count;
        } catch (error) {
            console.error('Error cleaning up expired cache:', error);
            return 0;
        }
    }

    /**
     * Cache movie when it gets its first rating
     * @param {Object} movieData - Movie data to cache
     * @returns {Promise<Object>} - Cached movie data with ID
     */
    async cacheRatedMovie(movieData) {
        return this.cacheMovie(movieData, true);
    }

    /**
     * Remove movies from cache that no longer have ratings
     * @param {Array<number>} ratedMovieIds - Array of movie IDs that have ratings
     * @returns {Promise<number>} - Number of removed movies
     */
    async cleanupUnratedMovies(ratedMovieIds) {
        try {
            const snapshot = await this.db.collection(this.collection).get();
            const batch = this.db.batch();
            let count = 0;
            
            snapshot.forEach(doc => {
                const movieId = parseInt(doc.data().kinopoiskId);
                if (!ratedMovieIds.includes(movieId)) {
                    batch.delete(doc.ref);
                    count++;
                }
            });
            
            if (count > 0) {
                await batch.commit();
                console.log(`Removed ${count} unrated movies from cache`);
            }
            
            return count;
        } catch (error) {
            console.error('Error cleaning up unrated movies:', error);
            return 0;
        }
    }

    /**
     * Get cache statistics
     * @returns {Promise<Object>} - Cache statistics
     */
    async getCacheStats() {
        try {
            const snapshot = await this.db.collection(this.collection).get();
            const now = Date.now();
            const maxAge = KINOPOISK_CONFIG.CACHE_DURATION;
            
            let totalMovies = 0;
            let expiredMovies = 0;
            let validMovies = 0;
            let ratedMovies = 0;
            
            snapshot.forEach(doc => {
                totalMovies++;
                const data = doc.data();
                const cacheAge = now - new Date(data.lastUpdated).getTime();
                
                if (data.hasRatings) {
                    ratedMovies++;
                }
                
                if (cacheAge > maxAge) {
                    expiredMovies++;
                } else {
                    validMovies++;
                }
            });
            
            return {
                totalMovies,
                validMovies,
                expiredMovies,
                ratedMovies,
                cacheHitRate: totalMovies > 0 ? (validMovies / totalMovies) * 100 : 0
            };
        } catch (error) {
            console.error('Error getting cache stats:', error);
            return {
                totalMovies: 0,
                validMovies: 0,
                expiredMovies: 0,
                ratedMovies: 0,
                cacheHitRate: 0
            };
        }
    }

    /**
     * Clear cache for a specific movie
     * @param {number} kinopoiskId - Kinopoisk movie ID
     * @returns {Promise<boolean>} - True if cache was cleared successfully
     */
    async clearMovieCache(kinopoiskId) {
        try {
            const movieId = kinopoiskId.toString();
            
            // Remove from Firestore
            const docRef = this.db.collection(this.collection).doc(movieId);
            const doc = await docRef.get();
            
            if (doc.exists) {
                await docRef.delete();
                console.log(`Cleared Firestore cache for movie ${movieId}`);
            }
            
            // Remove from localStorage
            const localKey = `kp_movie_${movieId}`;
            if (localStorage.getItem(localKey)) {
                localStorage.removeItem(localKey);
                console.log(`Cleared localStorage cache for movie ${movieId}`);
            }
            
            return true;
        } catch (error) {
            console.error('Error clearing movie cache:', error);
            throw new Error(`Failed to clear cache for movie ${kinopoiskId}: ${error.message}`, { cause: error });
        }
    }
}

// Export for use in other modules
// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MovieCacheService;
}
if (typeof window !== 'undefined') {
    window.MovieCacheService = MovieCacheService;
}
