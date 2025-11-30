/**
 * FavoriteService - Service for managing user favorites (favorite movies from rated collection)
 * Handles adding, removing, and retrieving favorite movies from user's ratings
 */
class FavoriteService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.collection = 'ratings';
        this.favoritesLimit = 50;
    }

    /**
     * Toggle favorite status for a rating
     * @param {string} ratingId - Rating document ID
     * @param {boolean} currentStatus - Current favorite status
     * @returns {Promise<boolean>} - New favorite status
     */
    async toggleFavorite(ratingId, currentStatus) {
        try {
            if (!ratingId) {
                throw new Error('Rating ID is required');
            }

            const ratingRef = this.db.collection(this.collection).doc(ratingId);
            
            if (currentStatus) {
                await ratingRef.update({
                    isFavorite: false,
                    favoritedAt: null
                });
                return false;
            } else {
                await ratingRef.update({
                    isFavorite: true,
                    favoritedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                return true;
            }
        } catch (error) {
            console.error('Error toggling favorite:', error);
            throw new Error(`Failed to toggle favorite: ${error.message}`);
        }
    }

    /**
     * Add a rating to favorites
     * @param {string} ratingId - Rating document ID
     * @returns {Promise<boolean>} - Success status
     */
    async addToFavorites(ratingId) {
        try {
            if (!ratingId) {
                throw new Error('Rating ID is required');
            }

            const ratingRef = this.db.collection(this.collection).doc(ratingId);
            await ratingRef.update({
                isFavorite: true,
                favoritedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return true;
        } catch (error) {
            console.error('Error adding to favorites:', error);
            throw new Error(`Failed to add to favorites: ${error.message}`);
        }
    }

    /**
     * Remove a rating from favorites
     * @param {string} ratingId - Rating document ID
     * @returns {Promise<boolean>} - Success status
     */
    async removeFromFavorites(ratingId) {
        try {
            if (!ratingId) {
                throw new Error('Rating ID is required');
            }

            const ratingRef = this.db.collection(this.collection).doc(ratingId);
            await ratingRef.update({
                isFavorite: false,
                favoritedAt: null
            });
            return true;
        } catch (error) {
            console.error('Error removing from favorites:', error);
            throw new Error(`Failed to remove from favorites: ${error.message}`);
        }
    }

    /**
     * Get user's favorites with sorting
     * @param {string} userId - User ID
     * @param {string} sortBy - Field to sort by: 'favoritedAt', 'rating', 'movieTitle', 'releaseYear', 'watchedDate'
     * @param {string} order - Sort order: 'asc' or 'desc'
     * @returns {Promise<Array>} - Array of favorite ratings
     */
    async getFavorites(userId, sortBy = 'favoritedAt', order = 'desc') {
        try {
            if (!userId) {
                return [];
            }

            let query = this.db.collection(this.collection)
                .where('userId', '==', userId)
                .where('isFavorite', '==', true);

            try {
                if (sortBy === 'favoritedAt') {
                    query = query.orderBy('favoritedAt', order);
                } else if (sortBy === 'rating') {
                    query = query.orderBy('rating', order);
                } else if (sortBy === 'watchedDate') {
                    query = query.orderBy('createdAt', order);
                } else if (sortBy === 'movieTitle' || sortBy === 'releaseYear') {
                    // These fields are not in ratings collection, will sort in memory
                    // Just get all favorites without orderBy
                } else {
                    query = query.orderBy('favoritedAt', 'desc');
                }

                const snapshot = await query.get();
                const favorites = [];

                snapshot.forEach(doc => {
                    favorites.push({ id: doc.id, ...doc.data() });
                });

                return favorites;
            } catch (indexError) {
                if (indexError.code === 'failed-precondition') {
                    const snapshot = await this.db.collection(this.collection)
                        .where('userId', '==', userId)
                        .where('isFavorite', '==', true)
                        .get();
                    
                    const favorites = [];
                    snapshot.forEach(doc => {
                        favorites.push({ id: doc.id, ...doc.data() });
                    });

                    favorites.sort((a, b) => {
                        if (sortBy === 'favoritedAt') {
                            const dateA = a.favoritedAt?.toDate?.() || new Date(a.favoritedAt) || new Date(0);
                            const dateB = b.favoritedAt?.toDate?.() || new Date(b.favoritedAt) || new Date(0);
                            return order === 'desc' ? dateB - dateA : dateA - dateB;
                        } else if (sortBy === 'rating') {
                            const ratingA = a.rating || 0;
                            const ratingB = b.rating || 0;
                            return order === 'desc' ? ratingB - ratingA : ratingA - ratingB;
                        } else if (sortBy === 'watchedDate') {
                            const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt) || new Date(0);
                            const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt) || new Date(0);
                            return order === 'desc' ? dateB - dateA : dateA - dateB;
                        }
                        return 0;
                    });

                    return favorites;
                }
                throw indexError;
            }
        } catch (error) {
            console.error('Error getting favorites:', error);
            return [];
        }
    }

    /**
     * Get count of favorites for a user
     * @param {string} userId - User ID
     * @returns {Promise<number>} - Count of favorites
     */
    async getFavoritesCount(userId) {
        try {
            if (!userId) {
                return 0;
            }

            const query = this.db.collection(this.collection)
                .where('userId', '==', userId)
                .where('isFavorite', '==', true);
            
            const snapshot = await query.get();
            return snapshot.size;
        } catch (error) {
            console.error('Error getting favorites count:', error);
            return 0;
        }
    }

    /**
     * Check if favorites limit is reached
     * @param {string} userId - User ID
     * @param {number} limit - Maximum number of favorites (default: 50)
     * @returns {Promise<boolean>} - True if limit is reached
     */
    async isFavoritesLimitReached(userId, limit = null) {
        try {
            if (!userId) {
                return false;
            }

            const maxLimit = limit || this.favoritesLimit;
            const count = await this.getFavoritesCount(userId);
            return count >= maxLimit;
        } catch (error) {
            console.error('Error checking favorites limit:', error);
            return false;
        }
    }

    /**
     * Check if a rating is favorite
     * @param {Object} ratingData - Rating data object
     * @returns {boolean} - True if rating is favorite
     */
    isFavorite(ratingData) {
        return ratingData?.isFavorite === true;
    }

    /**
     * Get favorite status for a rating by ID
     * @param {string} ratingId - Rating document ID
     * @returns {Promise<boolean>} - True if rating is favorite
     */
    async isFavoriteById(ratingId) {
        try {
            if (!ratingId) {
                return false;
            }

            const ratingRef = this.db.collection(this.collection).doc(ratingId);
            const snapshot = await ratingRef.get();
            
            if (!snapshot.exists) {
                return false;
            }

            const data = snapshot.data();
            return data.isFavorite === true;
        } catch (error) {
            console.error('Error checking favorite status:', error);
            return false;
        }
    }

    /**
     * Search favorites by movie title
     * @param {string} userId - User ID
     * @param {string} searchTerm - Search term
     * @returns {Promise<Array>} - Filtered favorites
     */
    async searchFavorites(userId, searchTerm) {
        try {
            if (!userId) {
                return [];
            }

            const favorites = await this.getFavorites(userId, 'favoritedAt', 'desc');
            const lowerSearchTerm = searchTerm.toLowerCase().trim();

            if (!lowerSearchTerm) {
                return favorites;
            }

            return favorites.filter(item => {
                const title = (item.movieTitle || item.movie?.name || '').toLowerCase();
                return title.includes(lowerSearchTerm);
            });
        } catch (error) {
            console.error('Error searching favorites:', error);
            return [];
        }
    }

    /**
     * Get favorite rating by movieId for a user
     * @param {string} userId - User ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<Object|null>} - Favorite rating or null
     */
    async getFavoriteByMovieId(userId, movieId) {
        try {
            if (!userId || !movieId) {
                return null;
            }

            const query = this.db.collection(this.collection)
                .where('userId', '==', userId)
                .where('movieId', '==', movieId)
                .where('isFavorite', '==', true)
                .limit(1);

            const snapshot = await query.get();
            
            if (snapshot.empty) {
                return null;
            }

            const doc = snapshot.docs[0];
            return { id: doc.id, ...doc.data() };
        } catch (error) {
            console.error('Error getting favorite by movie ID:', error);
            return null;
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FavoriteService;
}
if (typeof window !== 'undefined') {
    window.FavoriteService = FavoriteService;
}

