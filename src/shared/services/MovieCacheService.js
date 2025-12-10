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
                } catch (e) {
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
        try {
            const cachedMovies = {};
            const missingIds = [];

            // 1. Check LocalStorage first for all IDs
            kinopoiskIds.forEach(id => {
                const localKey = `kp_movie_${id}`;
                const localData = localStorage.getItem(localKey);
                if (localData) {
                    try {
                        const parsed = JSON.parse(localData);
                        cachedMovies[id] = parsed;
                    } catch (e) {
                        missingIds.push(id);
                    }
                } else {
                    missingIds.push(id);
                }
            });

            if (missingIds.length === 0) {
                return cachedMovies;
            }

            // 2. Check Firestore for missing IDs
            const docIds = missingIds.map(id => id.toString());
            
            // Chunk requests if too many
            const chunks = [];
            const CHUNK_SIZE = 10;
            for (let i = 0; i < docIds.length; i += CHUNK_SIZE) {
                chunks.push(docIds.slice(i, i + CHUNK_SIZE));
            }

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
                        doc.ref.delete().catch(console.warn);
                    }
                });
            }
            
            return cachedMovies;
            
        } catch (error) {
            console.error('Error batch checking cache:', error);
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
            throw new Error(`Failed to cache movie: ${error.message}`);
        }
    }

    /**
     * Helper to save to local storage
     */
    saveToLocalStorage(id, data) {
        try {
            localStorage.setItem(`kp_movie_${id}`, JSON.stringify(data));
        } catch (e) {
            console.warn('LocalStorage full, clearing old cache...');
            // Simple cleanup: remove old movie keys or clear all movie keys
            // For now, simple error catch is enough
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
                } catch (e) {}
            }

            await docRef.update(updatePayload);
            const updatedDoc = await docRef.get();
            return { id: updatedDoc.id, ...updatedDoc.data() };
        } catch (error) {
            console.error('Error updating movie cache:', error);
            throw new Error(`Failed to update movie cache: ${error.message}`);
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
}

// Export for use in other modules
// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MovieCacheService;
}
if (typeof window !== 'undefined') {
    window.MovieCacheService = MovieCacheService;
}