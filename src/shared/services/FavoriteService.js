/**
 * FavoriteService - Service for managing unified user bookmarks (Favorites, Watching, Plan to Watch)
 * Handles adding, removing, and retrieving movies with status
 */
class FavoriteService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.collection = 'favorites';
        this.favoritesLimit = 200; // Increased limit for combined collection
        this.validStatuses = ['watching', 'plan_to_watch', 'favorite'];
    }

    /**
     * Invalidate the bookmarks cache - call this after any mutation
     * This will trigger a re-fetch on the bookmarks page
     */
    async invalidateBookmarksCache(userId) {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                const cacheKey = `bookmarks_cache_${userId}`;
                await chrome.storage.local.remove([cacheKey]);
                console.log('FavoriteService: Bookmarks cache invalidated for', userId);
            }
        } catch (error) {
            console.warn('FavoriteService: Failed to invalidate cache', error);
        }
    }

    /**
     * Add or update a movie in bookmarks with specific status
     * @param {string} userId - User ID
     * @param {Object} movieData - Movie data
     * @param {string} status - Status ('watching', 'plan_to_watch', 'favorite')
     * @returns {Promise<Object>} - Created/Updated entry
     */
    async addToFavorites(userId, movieData, status = 'favorite') {
        try {
            if (!userId) {
                throw new Error('User ID is required');
            }

            if (!movieData || (!movieData.movieId && !movieData.id)) {
                throw new Error('Movie data with movieId is required');
            }

            if (!this.validStatuses.includes(status)) {
                throw new Error(`Invalid status. Must be one of: ${this.validStatuses.join(', ')}`);
            }

            const movieId = movieData.movieId || movieData.id;
            const docId = `${userId}_${movieId}`;
            const favoriteRef = this.db.collection(this.collection).doc(docId);

            // Check limit only if creating new document (simplified check)
            // Ideally we check count of THAT status, but for now global limit might be safer?
            // Let's rely on standard limit or skip for now since it's a migration.
            
            const favoriteData = {
                userId,
                movieId: movieId,
                movieTitle: movieData.movieTitle || movieData.name || '',
                movieTitleRu: movieData.movieTitleRu || '',
                posterPath: movieData.posterPath || movieData.posterUrl || '',
                releaseYear: movieData.releaseYear || movieData.year || null,
                genres: movieData.genres || [],
                description: movieData.description || '',
                kpRating: movieData.kpRating || 0,
                imdbRating: movieData.imdbRating || 0,
                avgRating: movieData.avgRating || 0,
                userRating: movieData.userRating || 0,
                notes: movieData.notes || '',
                type: movieData.type || null,
                status: status,
                seasonsInfo: movieData.seasonsInfo || [],
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            // Use set with merge to preserve fields like createdAt if it exists
            // But we want to ensure critical fields are updated
            const doc = await favoriteRef.get();
            if (!doc.exists) {
                favoriteData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                favoriteData.favoritedAt = firebase.firestore.FieldValue.serverTimestamp(); // Legacy support
            }

            await favoriteRef.set(favoriteData, { merge: true });

            // Invalidate cache so bookmarks page will fetch fresh data
            await this.invalidateBookmarksCache(userId);

            return { id: docId, ...favoriteData };
        } catch (error) {
            console.error('Error adding to bookmarks:', error);
            throw new Error(`Failed to add to bookmarks: ${error.message}`);
        }
    }

    /**
     * Update status of an existing bookmark
     * @param {string} userId 
     * @param {number|string} movieId 
     * @param {string} newStatus 
     */
    async updateStatus(userId, movieId, newStatus) {
        try {
            if (!this.validStatuses.includes(newStatus)) {
                throw new Error(`Invalid status: ${newStatus}`);
            }

            const docId = `${userId}_${movieId}`;
            const ref = this.db.collection(this.collection).doc(docId);
            
            await ref.update({
                status: newStatus,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Invalidate cache so bookmarks page will fetch fresh data
            await this.invalidateBookmarksCache(userId);

            return true;
        } catch (error) {
            console.error('Error updating status:', error);
            throw new Error(`Failed to update status: ${error.message}`);
        }
    }

    /**
     * Remove a movie from bookmarks completely
     * @param {string} userId - User ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<boolean>} - Success status
     */
    async removeFromFavorites(userId, movieId) {
        try {
            if (!userId || !movieId) {
                return false;
            }

            const docId = `${userId}_${movieId}`;
            const favoriteRef = this.db.collection(this.collection).doc(docId);
            
            const doc = await favoriteRef.get();
            if (!doc.exists) {
                return false;
            }

            await favoriteRef.delete();

            // Invalidate cache so bookmarks page will fetch fresh data
            await this.invalidateBookmarksCache(userId);

            return true;
        } catch (error) {
            console.error('Error removing from bookmarks:', error);
            throw new Error(`Failed to remove from bookmarks: ${error.message}`);
        }
    }

    /**
     * Get user's bookmarks with sorting and filtering by status
     * @param {string} userId - User ID
     * @param {string} status - Filter by status ('all', 'watching', 'plan_to_watch', 'favorite')
     * @param {string} sortBy - Field to sort by
     * @param {string} order - Sort order: 'asc' or 'desc'
     * @returns {Promise<Array>} - Array of entries
     */
    async getFavorites(userId, status = 'all', sortBy = 'createdAt', order = 'desc') {
        try {
            if (!userId) {
                return [];
            }

            let query = this.db.collection(this.collection)
                .where('userId', '==', userId);

            if (status !== 'all' && this.validStatuses.includes(status)) {
                query = query.where('status', '==', status);
            }

            // Apply sorting if index exists. If not, we might need to sort in memory.
            // Using a simple try/catch for the query execution with sort.
            // Note: Compound queries with equality (status) and sort (range) require index.
            
            // To be safe against missing indexes, we fetch then sort in memory for now,
            // or try to use orderBy if we are confident. 
            // Given the refactor, let's fetch then sort to ensure reliability without manual index creation right away.
            // HOWEVER, if the list is huge, this is bad. But extension context limits are usually low (hundreds).

            const snapshot = await query.get();
            const favorites = [];

            snapshot.forEach(doc => {
                favorites.push({ id: doc.id, ...doc.data() });
            });

            // Memory sort
            favorites.sort((a, b) => {
                let valA = a[sortBy];
                let valB = b[sortBy];

                // Handle dates (Firestore Timestamp)
                if (valA && typeof valA.toDate === 'function') valA = valA.toDate();
                if (valB && typeof valB.toDate === 'function') valB = valB.toDate();
                
                // Fallback for missing values
                if (!valA) valA = 0;
                if (!valB) valB = 0;

                if (valA < valB) return order === 'asc' ? -1 : 1;
                if (valA > valB) return order === 'asc' ? 1 : -1;
                return 0;
            });

            return favorites;
        } catch (error) {
            console.error('Error getting bookmarks:', error);
            return [];
        }
    }

    /**
     * Get count of bookmarks for a user, optionally filtered by status
     * @param {string} userId - User ID
     * @param {string} status - Optional status filter
     * @returns {Promise<number>} - Count
     */
    async getFavoritesCount(userId, status = 'all') {
        try {
            if (!userId) {
                return 0;
            }

            let query = this.db.collection(this.collection)
                .where('userId', '==', userId);
            
            if (status !== 'all' && this.validStatuses.includes(status)) {
                query = query.where('status', '==', status);
            }
            
            const snapshot = await query.get();
            return snapshot.size;
        } catch (error) {
            console.error('Error getting bookmarks count:', error);
            return 0;
        }
    }

    /**
     * Check if a movie is in bookmarks (and optionally check specific status)
     * @param {string} userId - User ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<Object|null>} - Returns the document data if found, null otherwise
     */
    async getBookmark(userId, movieId) {
        try {
            if (!userId || !movieId) {
                return null;
            }

            const docId = `${userId}_${movieId}`;
            const doc = await this.db.collection(this.collection).doc(docId).get();
            
            if (doc.exists) {
                return { id: doc.id, ...doc.data() };
            }
            return null;
        } catch (error) {
            console.error('Error checking bookmark:', error);
            return null;
        }
    }

    /**
     * Search bookmarks
     */
    async searchFavorites(userId, searchTerm, status = 'all') {
        try {
            const allItems = await this.getFavorites(userId, status); // Reuse getFavorites which handles status filter
            const lowerSearchTerm = searchTerm.toLowerCase().trim();

            if (!lowerSearchTerm) {
                return allItems;
            }

            return allItems.filter(item => {
                const title = (item.movieTitle || item.name || '').toLowerCase();
                const titleRu = (item.movieTitleRu || '').toLowerCase();
                return title.includes(lowerSearchTerm) || titleRu.includes(lowerSearchTerm);
            });
        } catch (error) {
            console.error('Error searching bookmarks:', error);
            return [];
        }
    }

    async isFavoritesLimitReached(userId, limit = null) {
        try {
            const effectiveLimit = limit || this.favoritesLimit;
            // distinct count for 'favorite' status
            const count = await this.getFavoritesCount(userId, 'favorite');
            return count >= effectiveLimit;
        } catch (error) {
            console.error('Error checking favorites limit:', error);
            return false; // Fail safe, allow adding if check fails
        }
    }

    // Deprecated / Alias methods for backward compatibility during migration
    async isFavorite(userId, movieId) {
        const item = await this.getBookmark(userId, movieId);
        return item && item.status === 'favorite';
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FavoriteService;
}
if (typeof window !== 'undefined') {
    window.FavoriteService = FavoriteService;
}

