/**
 * MovieCacheService - Service for caching movie data in Firestore
 * Reduces API calls by storing movie information locally
 */
const MOVIE_METADATA_FIELDS = [
    'name',
    'alternativeName',
    'enName',
    'englishTitle',
    'year',
    'releaseDate',
    'posterUrl',
    'posterPreviewUrl',
    'backdropUrl',
    'backdrop',
    'description',
    'shortDescription',
    'slogan',
    'genres',
    'countries',
    'duration',
    'movieLength',
    'type',
    'mediaType',
    'isSeries'
];

function hasUsableMovieMetadata(field, value) {
    if (value === undefined || value === null) return false;

    if (Array.isArray(value)) {
        return value.length > 0;
    }

    if (typeof value === 'string') {
        const normalized = value.trim();
        if (!normalized || ['loading...', 'unknown movie', 'unknown title'].includes(normalized.toLowerCase())) {
            return false;
        }
        if (field === 'description' || field === 'shortDescription') {
            return normalized.length >= 20;
        }
        if (field.endsWith('Url') || field === 'backdrop') {
            return /^https?:\/\//i.test(normalized);
        }
        return true;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0;
    }

    if (typeof value === 'object') {
        return Object.keys(value).length > 0;
    }

    return true;
}

class MovieCacheService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.collection = 'movies';
        this.localMovieCachePrefix = 'local_movie_cache_';
    }

    /**
     * Merge movie metadata without allowing empty or placeholder fields from a
     * newer partial response to erase a complete cached value.
     *
     * `primary` remains authoritative when its field is usable. `fallback` is
     * used only to heal missing or clearly incomplete metadata fields.
     */
    static mergeMovieMetadata(primary = {}, fallback = {}) {
        const preferred = primary && typeof primary === 'object' ? primary : {};
        const backup = fallback && typeof fallback === 'object' ? fallback : {};
        const merged = { ...preferred };

        MOVIE_METADATA_FIELDS.forEach(field => {
            if (!hasUsableMovieMetadata(field, preferred[field]) && hasUsableMovieMetadata(field, backup[field])) {
                merged[field] = backup[field];
            }
        });

        return merged;
    }

    mergeMovieMetadata(primary = {}, fallback = {}) {
        return MovieCacheService.mergeMovieMetadata(primary, fallback);
    }

    /**
     * Return only metadata fields suitable for a movie-document update.
     * Aggregate rating fields must remain owned by the rating transaction and
     * Cloud Function.
     */
    getMovieMetadataPatch(primary = {}, fallback = {}) {
        const merged = this.mergeMovieMetadata(primary, fallback);
        return MOVIE_METADATA_FIELDS.reduce((patch, field) => {
            if (Object.prototype.hasOwnProperty.call(merged, field) && merged[field] !== undefined) {
                patch[field] = merged[field];
            }
            return patch;
        }, {});
    }

    getLocalMovieCacheKey(kinopoiskId) {
        return `${this.localMovieCachePrefix}${kinopoiskId}`;
    }

    async getLocalMovieCache(kinopoiskId) {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
        const key = this.getLocalMovieCacheKey(kinopoiskId);
        const stored = await chrome.storage.local.get(key);
        return stored[key] || null;
    }

    async setLocalMovieCache(kinopoiskId, data) {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        try {
            const key = this.getLocalMovieCacheKey(kinopoiskId);
            await chrome.storage.local.set({ [key]: { ...data, id: String(kinopoiskId) } });
        } catch (error) {
            console.warn(`[MovieCacheService] Failed to set local storage cache for ${kinopoiskId}:`, error);
        }
    }

    async removeLocalMovieCache(kinopoiskId) {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        await chrome.storage.local.remove(this.getLocalMovieCacheKey(kinopoiskId));
    }

    isMetadataCacheValid(movie) {
        const lastUpdated = new Date(movie?.lastUpdated || 0).getTime();
        return Number.isFinite(lastUpdated) && Date.now() - lastUpdated < KINOPOISK_CONFIG.CACHE_DURATION;
    }

    /**
     * Get cached movie by Kinopoisk ID
     * @param {number} kinopoiskId - Kinopoisk movie ID
     * @returns {Promise<Object|null>} - Cached movie data or null
     */
    async getCachedMovie(kinopoiskId) {
        try {
            const docRef = this.db.collection(this.collection).doc(kinopoiskId.toString());
            const doc = await docRef.get();
            if (doc.exists && doc.data().hasCommunityRating === true) {
                const data = doc.data();
                if (this.isMetadataCacheValid(data)) {
                    const movieData = { id: doc.id, ...data };
                    this.saveToLocalStorage(kinopoiskId, movieData);
                    return movieData;
                }
                return { id: doc.id, ...data, _cacheExpired: true };
            }

            const localMovie = await this.getLocalMovieCache(kinopoiskId);
            return localMovie && this.isMetadataCacheValid(localMovie)
                ? localMovie
                : (localMovie ? { ...localMovie, _cacheExpired: true } : null);
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
            const docIds = uniqueIds.map(id => id.toString());
            
            // Chunk requests if too many
            const chunks = [];
            const CHUNK_SIZE = 10;
            for (let i = 0; i < docIds.length; i += CHUNK_SIZE) {
                chunks.push(docIds.slice(i, i + CHUNK_SIZE));
            }

            console.log(`[MovieCache] Checking ${uniqueIds.length} movies in Firestore in ${chunks.length} chunks...`);

            for (const chunk of chunks) {
                const query = this.db.collection(this.collection)
                    .where(firebase.firestore.FieldPath.documentId(), 'in', chunk);
                
                const querySnapshot = await query.get();
                
                querySnapshot.forEach(doc => {
                    const kinopoiskId = parseInt(doc.id);
                    const data = doc.data();
                    
                    if (data.hasCommunityRating === true && this.isMetadataCacheValid(data)) {
                        const movieData = { id: doc.id, ...data };
                        cachedMovies[kinopoiskId] = movieData;
                        this.saveToLocalStorage(kinopoiskId, movieData);
                    } else if (data.hasCommunityRating === true) {
                        cachedMovies[kinopoiskId] = { id: doc.id, ...data, _cacheExpired: true };
                    }
                });
            }

            const localKeys = uniqueIds
                .filter(id => !cachedMovies[id])
                .map(id => this.getLocalMovieCacheKey(id));
            if (localKeys.length > 0 && typeof chrome !== 'undefined' && chrome.storage?.local) {
                const localMovies = await chrome.storage.local.get(localKeys);
                uniqueIds.forEach(id => {
                    if (cachedMovies[id]) return;
                    const localMovie = localMovies[this.getLocalMovieCacheKey(id)];
                    if (localMovie) {
                        cachedMovies[id] = this.isMetadataCacheValid(localMovie)
                            ? localMovie
                            : { ...localMovie, _cacheExpired: true };
                    }
                });
            }

            // Preserve compatibility with the older localStorage cache used by
            // rated movie metadata. This is especially important when the
            // Kinopoisk API is temporarily unavailable: the popup can still
            // render a real title and poster instead of "Unknown Movie".
            if (typeof localStorage !== 'undefined') {
                uniqueIds.forEach(id => {
                    if (cachedMovies[id]) return;

                    try {
                        const rawMovie = localStorage.getItem(`kp_movie_${id}`);
                        if (!rawMovie) return;

                        const localMovie = JSON.parse(rawMovie);
                        if (!localMovie || typeof localMovie !== 'object') return;

                        const normalizedMovie = {
                            ...localMovie,
                            kinopoiskId: localMovie.kinopoiskId || Number(id),
                            id: localMovie.id || id
                        };
                        cachedMovies[id] = this.isMetadataCacheValid(normalizedMovie)
                            ? normalizedMovie
                            : { ...normalizedMovie, _cacheExpired: true };
                    } catch (error) {
                        console.warn(`[MovieCacheService] Failed to read legacy localStorage cache for ${id}:`, error);
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
            if (!movieData || !movieData.kinopoiskId) return null;
            
            const movieId = movieData.kinopoiskId.toString();
            
            const cacheData = {
                ...movieData,
                lastUpdated: new Date().toISOString(),
                cachedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            // CRITICAL: API metadata caching must NEVER overwrite ratings parsed from public KP/IMDb pages
            // nor community rating aggregates managed by the Cloud Function / RatingService.
            delete cacheData.kpRating;
            delete cacheData.imdbRating;
            if (cacheData.votes) {
                const { kp, imdb, ...nonRatingVotes } = cacheData.votes;
                if (Object.keys(nonRatingVotes).length > 0) {
                    cacheData.votes = nonRatingVotes;
                } else {
                    delete cacheData.votes;
                }
            }

            // Strip all protected community aggregate fields from the metadata object
            // to ensure set(cacheData, { merge: true }) can NEVER overwrite or clear aggregates.
            delete cacheData.hasRatings;
            delete cacheData.hasCommunityRating;
            delete cacheData.ratingsCount;
            delete cacheData.ratingsSum;
            delete cacheData.avgRating;
            delete cacheData.lastRatingUpdatedAt;

            const movieRef = this.db.collection(this.collection).doc(movieId);
            const existingMovie = await movieRef.get();
            const existingMovieData = existingMovie.exists ? existingMovie.data() : {};
            const safeCacheData = this.mergeMovieMetadata(cacheData, existingMovieData);
            const isCommunityRated = existingMovie.exists && existingMovie.data().hasCommunityRating === true;

            if (isCommunityRated) {
                // Merge pure metadata into existing Firestore document without touching aggregate fields
                await movieRef.set(safeCacheData, { merge: true });
                this.saveToLocalStorage(movieId, {
                    id: movieId,
                    ...this.mergeMovieMetadata(movieData, existingMovieData),
                    lastUpdated: cacheData.lastUpdated
                });
            } else {
                // Keep purely unrated movies in local cache to avoid polluting Firestore
                await this.setLocalMovieCache(movieId, { ...movieData, lastUpdated: cacheData.lastUpdated });
            }

            return { id: movieId, ...safeCacheData };
        } catch (error) {
            console.warn('[MovieCacheService] Warning while caching movie:', error);
            return { id: movieData.kinopoiskId || movieData.id, ...movieData };
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

            // Strip protected aggregate fields from metadata payload
            delete updatePayload.hasRatings;
            delete updatePayload.hasCommunityRating;
            delete updatePayload.ratingsCount;
            delete updatePayload.ratingsSum;
            delete updatePayload.avgRating;
            delete updatePayload.lastRatingUpdatedAt;

            const movieDoc = await docRef.get();
            const existingMovieData = movieDoc.exists ? movieDoc.data() : {};
            const safeUpdatePayload = this.mergeMovieMetadata(updatePayload, existingMovieData);
            if (movieDoc.exists && movieDoc.data().hasCommunityRating === true) {
                await docRef.set(safeUpdatePayload, { merge: true });
                const updatedDoc = await docRef.get();
                return { id: updatedDoc.id, ...updatedDoc.data() };
            }

            const localMovie = await this.getLocalMovieCache(movieId);
            const updatedLocalMovie = this.mergeMovieMetadata(
                { ...(localMovie || {}), ...updateData, kinopoiskId: Number(kinopoiskId), lastUpdated: updatePayload.lastUpdated },
                localMovie || {}
            );
            await this.setLocalMovieCache(movieId, updatedLocalMovie);
            return { id: movieId, ...updatedLocalMovie };
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
            const movieMap = await this.getBatchCachedMovies(kinopoiskIds);
            return Object.values(movieMap);
        } catch (error) {
            console.error('Error getting cached movies by IDs:', error);
            return [];
        }
    }

    /**
     * Get rated movies filtered by avgRating from movies collection (server-side pagination)
     * @param {Object} options - { minAvgRating, maxAvgRating, sortBy, sortDir, limit, lastDoc }
     * @returns {Promise<Object>} - { movies, hasMore, lastDoc }
     *
     * NOTE: orderBy(documentId()) is used as a tie-breaker for stable pagination.
     * documentId() always exists on every document — it is safe and will NOT filter out any docs.
     * The real cause of disappearing movies was documents missing `lastRatingUpdatedAt`,
     * which is now guaranteed by the `aggregateMovieRatings` Cloud Function trigger.
     */
    async getMoviesByAvgRating({ minAvgRating = 1.0, maxAvgRating = 10.0, sortBy = 'lastRatingUpdatedAt', sortDir = 'desc', limit = 6, lastDoc = null } = {}) {
        try {
            const isFilterActive = minAvgRating > 1.0 || maxAvgRating < 10.0;

            let query = this.db.collection(this.collection)
                .where('hasCommunityRating', '==', true);

            let unorderedQuery = this.db.collection(this.collection)
                .where('hasCommunityRating', '==', true);

            const firestoreSortField = sortBy === 'date' ? 'lastRatingUpdatedAt' : (sortBy === 'rating' ? 'avgRating' : (sortBy === 'title' ? 'name' : sortBy));

            if (isFilterActive) {
                query = query
                    .where('avgRating', '>=', minAvgRating)
                    .where('avgRating', '<=', maxAvgRating)
                    .orderBy('avgRating', 'desc');
                unorderedQuery = unorderedQuery
                    .where('avgRating', '>=', minAvgRating)
                    .where('avgRating', '<=', maxAvgRating);
            } else {
                if (firestoreSortField) {
                    query = query.orderBy(firestoreSortField, sortDir);
                }
            }

            // Tie-breaker for stable pagination when multiple docs share the same sort value.
            // documentId() always exists — safe to use as secondary orderBy.
            query = query.orderBy(firebase.firestore.FieldPath.documentId(), sortDir);

            // Fetch one extra document to reliably detect if there are more pages.
            query = query.limit(limit + 1);

            if (lastDoc) {
                query = query.startAfter(lastDoc);
            }

            const snapshot = await query.get();
            const allDocs = snapshot.docs;

            const hasMore = allDocs.length > limit;
            const pageDocs = hasMore ? allDocs.slice(0, limit) : allDocs;
            let movies = pageDocs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Firestore excludes documents that do not have an orderBy field. Check
            // for those legacy aggregates on the first page as well; waiting until
            // the final page made them disappear whenever healthy documents filled
            // the first page. All missing-field documents are merged once, while the
            // normal ordered query keeps ownership of subsequent-page pagination.
            if (!lastDoc && firestoreSortField === 'lastRatingUpdatedAt') {
                const unorderedSnapshot = await unorderedQuery.get();
                const missingSortFieldDocs = unorderedSnapshot.docs.filter(doc => {
                    const value = doc.data().lastRatingUpdatedAt;
                    return value === undefined || value === null;
                });

                if (missingSortFieldDocs.length > 0) {
                    console.error('[MovieCache] Ratings query excluded rated movies without lastRatingUpdatedAt', {
                        missingCount: missingSortFieldDocs.length,
                        movieIds: missingSortFieldDocs.map(doc => doc.id)
                    });

                    const fallbackMovies = missingSortFieldDocs.map(doc => ({ id: doc.id, ...doc.data() }));
                    const getFallbackTimestamp = movie => {
                        const value = movie.updatedAt || movie.lastUpdated || 0;
                        if (typeof value?.toMillis === 'function') return value.toMillis();
                        if (typeof value?.toDate === 'function') return value.toDate().getTime();
                        if (typeof value?.seconds === 'number') return value.seconds * 1000;
                        const parsed = new Date(value).getTime();
                        return Number.isNaN(parsed) ? 0 : parsed;
                    };

                    movies = [...movies, ...fallbackMovies].sort((a, b) => {
                        const aTimestamp = getFallbackTimestamp(a);
                        const bTimestamp = getFallbackTimestamp(b);
                        return sortDir === 'asc' ? aTimestamp - bTimestamp : bTimestamp - aTimestamp;
                    });
                }
            }

            const nextLastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;

            console.log(`[MovieCache] getMoviesByAvgRating: returned ${movies.length} movies, hasMore=${hasMore}`);

            return {
                movies,
                hasMore,
                lastDoc: nextLastDoc
            };
        } catch (error) {
            console.error('Error querying movies by avgRating:', error);
            throw error;
        }
    }

    /**
     * Remove expired cache entries
     * @returns {Promise<number>} - Number of removed entries
     *
     * ⚠️ CRITICAL: Never delete documents with hasCommunityRating: true.
     * Those documents contain avgRating, ratingsCount, lastRatingUpdatedAt which
     * are queried by the ratings page. Deleting them causes movies to disappear.
     */
    async cleanupExpiredCache() {
        try {
            const maxAge = KINOPOISK_CONFIG.CACHE_DURATION;
            const cutoffTime = new Date(Date.now() - maxAge).toISOString();
            
            const query = this.db.collection(this.collection)
                .where('lastUpdated', '<', cutoffTime)
                .limit(100); // Process in batches
            
            const results = await query.get();
            let count = 0;
            let skippedRated = 0;
            
            results.forEach(doc => {
                const data = doc.data();
                // NEVER delete documents with community ratings — they are the
                // source of truth for the ratings page query.
                if (data.hasCommunityRating) {
                    skippedRated++;
                    return;
                }
                console.warn(`[MovieCache] Found unrated Firestore cache document ${doc.id}; cleanup is handled by cleanupUnratedMovies Cloud Function`);
                count++;
            });
            
            if (skippedRated > 0) {
                console.log(`[MovieCache] cleanupExpiredCache: skipped ${skippedRated} rated movies, found ${count} expired unrated entries`);
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
        console.warn('[MovieCache] cleanupUnratedMovies is disabled on the client; use cleanupUnratedMovies Cloud Function instead');
        return 0;
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
                const data = doc.data();
                if (data.hasCommunityRating) {
                    // Don't delete the entire document — only clear KP metadata fields
                    // while preserving rating aggregate fields
                    console.log(`Clearing KP metadata cache for movie ${movieId} (preserving rating data)`);
                    // We keep: hasCommunityRating, lastRatingUpdatedAt, ratingsCount, avgRating, ratingsSum, hasRatings
                    // We clear: lastUpdated (to force re-fetch of KP metadata on next access)
                    await docRef.set({ lastUpdated: null }, { merge: true });
                }
            }
            
            // Remove from localStorage
            const localKey = `kp_movie_${movieId}`;
            if (localStorage.getItem(localKey)) {
                localStorage.removeItem(localKey);
                console.log(`Cleared localStorage cache for movie ${movieId}`);
            }
            await this.removeLocalMovieCache(movieId);
            
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
