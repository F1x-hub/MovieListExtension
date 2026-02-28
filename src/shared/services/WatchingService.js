/**
 * WatchingService - Service for managing user's "currently watching" list
 * Handles adding, removing, and retrieving movies that the user is currently watching
 */
class WatchingService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.collection = 'watching';
    }

    /**
     * Add a movie to user's watching list
     * @param {string} userId - User ID
     * @param {Object} movieData - Movie data
     * @returns {Promise<Object>} - Created watching entry with movedFrom indicator
     */
    async addToWatching(userId, movieData) {
        try {
            if (!userId) {
                throw new Error('User ID is required');
            }

            if (!movieData || !movieData.movieId) {
                throw new Error('Movie data with movieId is required');
            }

            const docId = `${userId}_${movieData.movieId}`;
            
            // Check if movie is in watchlist and remove it
            let movedFrom = null;
            const watchlistDocId = `${userId}_${movieData.movieId}`;
            const watchlistRef = this.db.collection('watchlist').doc(watchlistDocId);
            
            try {
                const watchlistDoc = await watchlistRef.get();
                if (watchlistDoc.exists) {
                    await watchlistRef.delete();
                    movedFrom = 'watchlist';
                    console.log(`Moved movie ${movieData.movieId} from watchlist to watching for user ${userId}`);
                }
            } catch (checkError) {
                console.warn('Error checking watchlist:', checkError);
                // Continue with adding to watching even if check fails
            }
            
            // Add to watching
            const watchingRef = this.db.collection(this.collection).doc(docId);

            const watchingData = {
                userId,
                movieId: movieData.movieId,
                movieTitle: movieData.movieTitle || movieData.name || '',
                movieTitleRu: movieData.movieTitleRu || '',
                posterPath: movieData.posterPath || movieData.posterUrl || '',
                releaseYear: movieData.releaseYear || movieData.year || null,
                genres: movieData.genres || [],
                description: movieData.description || '',
                kpRating: movieData.kpRating || 0,
                imdbRating: movieData.imdbRating || 0,
                avgRating: movieData.avgRating || 0,
                notes: movieData.notes || '',
                addedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            await watchingRef.set(watchingData);

            return { id: docId, movedFrom, ...watchingData };
        } catch (error) {
            console.error('Error adding to watching:', error);
            throw new Error(`Failed to add to watching: ${error.message}`);
        }
    }

    /**
     * Remove a movie from user's watching list
     * @param {string} userId - User ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<boolean>} - Success status
     */
    async removeFromWatching(userId, movieId) {
        try {
            if (!userId) {
                throw new Error('User ID is required');
            }

            if (!movieId) {
                throw new Error('Movie ID is required');
            }

            const docId = `${userId}_${movieId}`;
            const watchingRef = this.db.collection(this.collection).doc(docId);
            
            const doc = await watchingRef.get();
            if (!doc.exists) {
                return false; // Already not in list
            }

            await watchingRef.delete();
            return true;
        } catch (error) {
            console.error('Error removing from watching:', error);
            throw new Error(`Failed to remove from watching: ${error.message}`);
        }
    }

    /**
     * Get user's watching list with sorting
     * @param {string} userId - User ID
     * @param {string} sortBy - Field to sort by
     * @param {string} order - Sort order: 'asc' or 'desc'
     * @returns {Promise<Array>} - Array of watching entries
     */
    async getWatching(userId, sortBy = 'addedAt', order = 'desc') {
        try {
            if (!userId) {
                return [];
            }

            let query = this.db.collection(this.collection)
                .where('userId', '==', userId);

            // Apply sorting if supported by index or valid field
            if (['addedAt', 'movieTitle', 'releaseYear', 'avgRating'].includes(sortBy)) {
                try {
                    query = query.orderBy(sortBy, order);
                } catch (e) {
                    // If index is missing, fallback to default order or memory sort
                    console.warn(`Index missing for sort ${sortBy}, falling back to memory sort`);
                }
            } else {
                query = query.orderBy('addedAt', 'desc');
            }

            const snapshot = await query.get();
            const watchingList = [];

            snapshot.forEach(doc => {
                watchingList.push({ id: doc.id, ...doc.data() });
            });

            // Memory sort fallback if needed (e.g. for fields without composite indexes)
            // or if the initial query failed to sort properly due to index issues caught above
            // simple check if we trust the database sort or not. For now, assume DB sort works if no error.
            
            return watchingList;
        } catch (error) {
            console.error('Error getting watching list:', error);
            // Fallback: simplified query without sort
            try {
                const query = this.db.collection(this.collection).where('userId', '==', userId);
                const snapshot = await query.get();
                const list = [];
                snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
                // minimal memory sort
                return list.sort((a, b) => {
                     const dateA = a.addedAt?.toDate?.() || new Date(0);
                     const dateB = b.addedAt?.toDate?.() || new Date(0);
                     return dateB - dateA;
                });
            } catch (fallbackError) {
                return [];
            }
        }
    }

    /**
     * Check if a movie is in user's watching list
     * @param {string} userId - User ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<boolean>} - True if movie is in watching list
     */
    async isWatching(userId, movieId) {
        try {
            if (!userId || !movieId) {
                return false;
            }

            const docId = `${userId}_${movieId}`;
            const watchingRef = this.db.collection(this.collection).doc(docId);
            const snapshot = await watchingRef.get();
            
            return snapshot.exists;
        } catch (error) {
            console.error('Error checking watching status:', error);
            return false;
        }
    }

    /**
     * Get count of movies in user's watching list
     * @param {string} userId - User ID
     * @returns {Promise<number>} - Count of movies
     */
    async getWatchingCount(userId) {
        try {
            if (!userId) {
                return 0;
            }

            const query = this.db.collection(this.collection)
                .where('userId', '==', userId);
            
            const snapshot = await query.get();
            return snapshot.size;
        } catch (error) {
            console.error('Error getting watching count:', error);
            return 0;
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WatchingService;
}
if (typeof window !== 'undefined') {
    window.WatchingService = WatchingService;
}
