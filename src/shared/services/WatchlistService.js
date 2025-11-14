/**
 * WatchlistService - Service for managing user watchlist (movies to watch)
 * Handles adding, removing, and retrieving movies from user's watchlist
 */
class WatchlistService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.collection = 'watchlist';
    }

    /**
     * Add a movie to user's watchlist
     * @param {string} userId - User ID
     * @param {Object} movieData - Movie data
     * @param {number} movieData.movieId - Kinopoisk movie ID
     * @param {string} movieData.movieTitle - Movie title
     * @param {string} movieData.movieTitleRu - Movie title in Russian (optional)
     * @param {string} movieData.posterPath - Poster path/URL
     * @param {number} movieData.releaseYear - Release year
     * @param {Array<string>} movieData.genres - Array of genres
     * @param {number} movieData.avgRating - Average rating from TMDb/Kinopoisk
     * @param {string} movieData.notes - Optional notes
     * @returns {Promise<Object>} - Created watchlist entry
     */
    async addToWatchlist(userId, movieData) {
        try {
            if (!userId) {
                throw new Error('User ID is required');
            }

            if (!movieData || !movieData.movieId) {
                throw new Error('Movie data with movieId is required');
            }

            const docId = `${userId}_${movieData.movieId}`;
            const watchlistRef = this.db.collection(this.collection).doc(docId);

            const watchlistData = {
                userId,
                movieId: movieData.movieId,
                movieTitle: movieData.movieTitle || '',
                movieTitleRu: movieData.movieTitleRu || '',
                posterPath: movieData.posterPath || '',
                releaseYear: movieData.releaseYear || null,
                genres: movieData.genres || [],
                avgRating: movieData.avgRating || 0,
                notes: movieData.notes || '',
                addedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            await watchlistRef.set(watchlistData);

            return { id: docId, ...watchlistData };
        } catch (error) {
            console.error('Error adding to watchlist:', error);
            throw new Error(`Failed to add to watchlist: ${error.message}`);
        }
    }

    /**
     * Remove a movie from user's watchlist
     * @param {string} userId - User ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<boolean>} - Success status
     */
    async removeFromWatchlist(userId, movieId) {
        try {
            if (!userId) {
                throw new Error('User ID is required');
            }

            if (!movieId) {
                throw new Error('Movie ID is required');
            }

            const docId = `${userId}_${movieId}`;
            const watchlistRef = this.db.collection(this.collection).doc(docId);
            
            const doc = await watchlistRef.get();
            if (!doc.exists) {
                return false; // Already not in watchlist
            }

            await watchlistRef.delete();
            return true;
        } catch (error) {
            console.error('Error removing from watchlist:', error);
            throw new Error(`Failed to remove from watchlist: ${error.message}`);
        }
    }

    /**
     * Get user's watchlist with sorting
     * @param {string} userId - User ID
     * @param {string} sortBy - Field to sort by: 'addedAt', 'movieTitle', 'releaseYear', 'avgRating'
     * @param {string} order - Sort order: 'asc' or 'desc'
     * @returns {Promise<Array>} - Array of watchlist entries
     */
    async getWatchlist(userId, sortBy = 'addedAt', order = 'desc') {
        try {
            if (!userId) {
                return [];
            }

            let query = this.db.collection(this.collection)
                .where('userId', '==', userId);

            // Apply sorting
            if (sortBy === 'addedAt' || sortBy === 'releaseYear' || sortBy === 'avgRating') {
                query = query.orderBy(sortBy, order);
            } else if (sortBy === 'movieTitle') {
                query = query.orderBy('movieTitle', order);
            } else {
                // Default: sort by addedAt desc
                query = query.orderBy('addedAt', 'desc');
            }

            const snapshot = await query.get();
            const watchlist = [];

            snapshot.forEach(doc => {
                watchlist.push({ id: doc.id, ...doc.data() });
            });

            // If sorting by title or other fields that might not have index, sort in memory
            if (sortBy === 'movieTitle' && watchlist.length > 0) {
                watchlist.sort((a, b) => {
                    const titleA = (a.movieTitle || '').toLowerCase();
                    const titleB = (b.movieTitle || '').toLowerCase();
                    return order === 'asc' 
                        ? titleA.localeCompare(titleB)
                        : titleB.localeCompare(titleA);
                });
            }

            return watchlist;
        } catch (error) {
            console.error('Error getting watchlist:', error);
            // If index error, try without orderBy and sort in memory
            if (error.code === 'failed-precondition') {
                try {
                    const query = this.db.collection(this.collection)
                        .where('userId', '==', userId);
                    const snapshot = await query.get();
                    const watchlist = [];
                    snapshot.forEach(doc => {
                        watchlist.push({ id: doc.id, ...doc.data() });
                    });
                    
                    // Sort in memory
                    watchlist.sort((a, b) => {
                        if (sortBy === 'addedAt') {
                            const dateA = a.addedAt?.toDate?.() || new Date(a.addedAt) || new Date(0);
                            const dateB = b.addedAt?.toDate?.() || new Date(b.addedAt) || new Date(0);
                            return order === 'desc' ? dateB - dateA : dateA - dateB;
                        } else if (sortBy === 'movieTitle') {
                            const titleA = (a.movieTitle || '').toLowerCase();
                            const titleB = (b.movieTitle || '').toLowerCase();
                            return order === 'asc' 
                                ? titleA.localeCompare(titleB)
                                : titleB.localeCompare(titleA);
                        } else if (sortBy === 'releaseYear') {
                            const yearA = a.releaseYear || 0;
                            const yearB = b.releaseYear || 0;
                            return order === 'desc' ? yearB - yearA : yearA - yearB;
                        } else if (sortBy === 'avgRating') {
                            const ratingA = a.avgRating || 0;
                            const ratingB = b.avgRating || 0;
                            return order === 'desc' ? ratingB - ratingA : ratingA - ratingB;
                        }
                        return 0;
                    });
                    
                    return watchlist;
                } catch (fallbackError) {
                    console.error('Error in fallback watchlist query:', fallbackError);
                    return [];
                }
            }
            return [];
        }
    }

    /**
     * Check if a movie is in user's watchlist
     * @param {string} userId - User ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<boolean>} - True if movie is in watchlist
     */
    async isInWatchlist(userId, movieId) {
        try {
            if (!userId || !movieId) {
                return false;
            }

            const docId = `${userId}_${movieId}`;
            const watchlistRef = this.db.collection(this.collection).doc(docId);
            const snapshot = await watchlistRef.get();
            
            return snapshot.exists;
        } catch (error) {
            console.error('Error checking watchlist status:', error);
            return false;
        }
    }

    /**
     * Get count of movies in user's watchlist
     * @param {string} userId - User ID
     * @returns {Promise<number>} - Count of movies in watchlist
     */
    async getWatchlistCount(userId) {
        try {
            if (!userId) {
                return 0;
            }

            const query = this.db.collection(this.collection)
                .where('userId', '==', userId);
            
            const snapshot = await query.get();
            return snapshot.size;
        } catch (error) {
            console.error('Error getting watchlist count:', error);
            return 0;
        }
    }

    /**
     * Search watchlist by movie title
     * @param {string} userId - User ID
     * @param {string} searchTerm - Search term
     * @returns {Promise<Array>} - Filtered watchlist entries
     */
    async searchWatchlist(userId, searchTerm) {
        try {
            if (!userId) {
                return [];
            }

            const watchlist = await this.getWatchlist(userId, 'addedAt', 'desc');
            const lowerSearchTerm = searchTerm.toLowerCase().trim();

            if (!lowerSearchTerm) {
                return watchlist;
            }

            return watchlist.filter(item => {
                const title = (item.movieTitle || '').toLowerCase();
                const titleRu = (item.movieTitleRu || '').toLowerCase();
                return title.includes(lowerSearchTerm) || titleRu.includes(lowerSearchTerm);
            });
        } catch (error) {
            console.error('Error searching watchlist:', error);
            return [];
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WatchlistService;
} else {
    window.WatchlistService = WatchlistService;
}

