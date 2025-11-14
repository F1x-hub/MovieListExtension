/**
 * RatingService - Service for managing movie ratings and comments
 * Handles user ratings, average calculations, and rating feeds
 */
class RatingService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.collection = 'ratings';
    }

    /**
     * Add or update a user's rating for a movie
     * @param {string} userId - User ID
     * @param {string} userName - User display name
     * @param {string} userPhoto - User photo URL
     * @param {number} movieId - Kinopoisk movie ID
     * @param {number} rating - Rating (1-10)
     * @param {string} comment - Optional comment (max 500 chars)
     * @param {Object} movieData - Movie data to cache (optional)
     * @returns {Promise<Object>} - Created/updated rating
     */
    async addOrUpdateRating(userId, userName, userPhoto, movieId, rating, comment = '', movieData = null) {
        try {
            // Validate rating
            if (rating < 1 || rating > 10 || !Number.isInteger(rating)) {
                throw new Error('Rating must be an integer between 1 and 10');
            }

            // Validate comment length
            if (comment && comment.length > 500) {
                throw new Error('Comment must be 500 characters or less');
            }

            // Check if rating already exists
            const existingRating = await this.getRating(userId, movieId);
            
            const ratingData = {
                userId,
                userName,
                userPhoto,
                movieId,
                rating,
                comment: comment.trim(),
                createdAt: existingRating ? existingRating.createdAt : firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            // Set isFavorite and favoritedAt fields for new ratings
            if (!existingRating) {
                ratingData.isFavorite = false;
                ratingData.favoritedAt = null;
            } else {
                // Preserve existing favorite status if updating
                if (existingRating.isFavorite !== undefined) {
                    ratingData.isFavorite = existingRating.isFavorite;
                }
                if (existingRating.favoritedAt !== undefined) {
                    ratingData.favoritedAt = existingRating.favoritedAt;
                }
            }

            let result;
            if (existingRating) {
                // Update existing rating
                const ratingRef = this.db.collection(this.collection).doc(existingRating.id);
                await ratingRef.update(ratingData);
                result = { id: existingRating.id, ...ratingData };
            } else {
                // Create new rating
                const docRef = await this.db.collection(this.collection).add(ratingData);
                result = { id: docRef.id, ...ratingData };
                
                // Cache movie if it's the first rating and we have movie data
                if (movieData) {
                    try {
                        const movieCacheService = window.firebaseManager?.getMovieCacheService();
                        if (movieCacheService) {
                            await movieCacheService.cacheRatedMovie(movieData);
                            console.log('Movie cached after first rating:', movieData.name);
                        }
                    } catch (cacheError) {
                        console.warn('Failed to cache movie after rating:', cacheError.message);
                        // Don't fail the rating if caching fails
                    }
                }
            }

            // Invalidate ratings cache when a new rating is added/updated
            try {
                const ratingsCacheService = window.firebaseManager?.getRatingsCacheService();
                if (ratingsCacheService) {
                    await ratingsCacheService.clearCache();
                    console.log('Ratings cache cleared after rating update');
                }
            } catch (cacheError) {
                console.warn('Failed to clear ratings cache after rating update:', cacheError.message);
                // Don't fail the rating if cache clearing fails
            }

            // Remove from watchlist if movie was in watchlist
            try {
                const watchlistService = window.firebaseManager?.getWatchlistService();
                if (watchlistService) {
                    const isInWatchlist = await watchlistService.isInWatchlist(userId, movieId);
                    if (isInWatchlist) {
                        await watchlistService.removeFromWatchlist(userId, movieId);
                        console.log('Movie removed from watchlist after rating');
                    }
                }
            } catch (watchlistError) {
                console.warn('Failed to remove from watchlist after rating:', watchlistError.message);
                // Don't fail the rating if watchlist removal fails
            }

            return result;
        } catch (error) {
            console.error('Error adding/updating rating:', error);
            throw new Error(`Failed to save rating: ${error.message}`);
        }
    }

    /**
     * Get user's rating for a specific movie
     * @param {string} userId - User ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<Object|null>} - User's rating or null
     */
    async getRating(userId, movieId) {
        try {
            const query = this.db.collection(this.collection)
                .where('userId', '==', userId)
                .where('movieId', '==', movieId)
                .limit(1);

            const results = await query.get();
            
            if (results.empty) {
                return null;
            }

            const doc = results.docs[0];
            return { id: doc.id, ...doc.data() };
        } catch (error) {
            console.error('Error getting user rating:', error);
            return null;
        }
    }

    /**
     * Get average rating for a movie
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<Object>} - Average rating and count
     */
    async getMovieAverageRating(movieId) {
        try {
            const query = this.db.collection(this.collection)
                .where('movieId', '==', movieId);

            const results = await query.get();
            
            if (results.empty) {
                return { average: 0, count: 0 };
            }

            let totalRating = 0;
            let count = 0;

            results.forEach(doc => {
                const data = doc.data();
                totalRating += data.rating;
                count++;
            });

            const average = count > 0 ? Math.round((totalRating / count) * 10) / 10 : 0;

            return { average, count };
        } catch (error) {
            console.error('Error getting movie average rating:', error);
            return { average: 0, count: 0 };
        }
    }

    /**
     * Get average ratings for multiple movies in batch (optimized)
     * @param {Array<number>} movieIds - Array of Kinopoisk movie IDs
     * @returns {Promise<Object>} - Map of movieId to {average, count}
     */
    async getBatchMovieAverageRatings(movieIds) {
        try {
            // Check cache first
            const cacheKey = `averageRatings_${movieIds.sort().join('_')}`;
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
            
            // Load all ratings for these movies in one query
            const query = this.db.collection(this.collection)
                .where('movieId', 'in', movieIds);

            const results = await query.get();
            
            // Group ratings by movieId and calculate averages
            const movieRatings = {};
            
            results.forEach(doc => {
                const data = doc.data();
                const movieId = data.movieId;
                
                if (!movieRatings[movieId]) {
                    movieRatings[movieId] = { ratings: [], count: 0 };
                }
                
                movieRatings[movieId].ratings.push(data.rating);
                movieRatings[movieId].count++;
            });
            
            // Calculate averages
            const averages = {};
            for (const movieId of movieIds) {
                if (movieRatings[movieId]) {
                    const ratings = movieRatings[movieId].ratings;
                    const total = ratings.reduce((sum, rating) => sum + rating, 0);
                    const average = Math.round((total / ratings.length) * 10) / 10;
                    averages[movieId] = { average, count: ratings.length };
                } else {
                    averages[movieId] = { average: 0, count: 0 };
                }
            }
            
            // Cache results for this session
            sessionStorage.setItem(cacheKey, JSON.stringify(averages));
            
            return averages;
            
        } catch (error) {
            console.error('Error batch loading average ratings:', error);
            
            // Fallback: return empty averages
            const averages = {};
            for (const movieId of movieIds) {
                averages[movieId] = { average: 0, count: 0 };
            }
            return averages;
        }
    }

    /**
     * Get all ratings chronologically (for feed)
     * @param {number} limit - Maximum number of ratings to return
     * @param {string} lastDocId - Last document ID for pagination
     * @returns {Promise<Object>} - Ratings and pagination info
     */
    async getAllRatings(limit = 50, lastDocId = null) {
        try {
            let query = this.db.collection(this.collection)
                .orderBy('createdAt', 'desc')
                .limit(limit);

            if (lastDocId) {
                const lastDoc = await this.db.collection(this.collection).doc(lastDocId).get();
                if (lastDoc.exists) {
                    query = query.startAfter(lastDoc);
                }
            }

            const results = await query.get();
            const ratings = [];

            results.forEach(doc => {
                ratings.push({ id: doc.id, ...doc.data() });
            });

            return {
                ratings,
                hasMore: results.size === limit,
                lastDocId: results.docs.length > 0 ? results.docs[results.docs.length - 1].id : null
            };
        } catch (error) {
            console.error('Error getting all ratings:', error);
            return { ratings: [], hasMore: false, lastDocId: null };
        }
    }

    /**
     * Get user's ratings by movie IDs
     * @param {string} userId - User ID
     * @param {Array<number>} movieIds - Array of movie IDs
     * @returns {Promise<Array>} - User's ratings for specified movies
     */
    async getUserRatingsByMovieIds(userId, movieIds) {
        try {
            if (!userId || !movieIds || movieIds.length === 0) {
                return [];
            }

            const ratings = [];
            
            for (const movieId of movieIds) {
                const rating = await this.getRating(userId, movieId);
                if (rating) {
                    ratings.push(rating);
                }
            }

            return ratings;
        } catch (error) {
            console.error('Error getting user ratings by movie IDs:', error);
            return [];
        }
    }

    /**
     * Get user's ratings
     * @param {string} userId - User ID
     * @param {number} limit - Maximum number of ratings
     * @returns {Promise<Array>} - User's ratings
     */
    async getUserRatings(userId, limit = 50) {
        try {
            // Check session cache first
            const cacheKey = `userRatings_${userId}_${limit}`;
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
            
            // Temporary fix: remove orderBy to avoid index requirement
            const query = this.db.collection(this.collection)
                .where('userId', '==', userId)
                .limit(limit);

            const results = await query.get();
            const ratings = [];

            results.forEach(doc => {
                ratings.push({ id: doc.id, ...doc.data() });
            });

            // Sort in memory by createdAt desc
            ratings.sort((a, b) => {
                const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt) || new Date(0);
                const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt) || new Date(0);
                return dateB - dateA;
            });
            
            // Cache for this session
            sessionStorage.setItem(cacheKey, JSON.stringify(ratings));

            return ratings;
        } catch (error) {
            console.error('Error getting user ratings:', error);
            return [];
        }
    }

    /**
     * Delete a rating
     * @param {string} userId - User ID
     * @param {string} ratingId - Rating document ID
     * @returns {Promise<boolean>} - Success status
     */
    async deleteRating(userId, ratingId) {
        try {
            const ratingRef = this.db.collection(this.collection).doc(ratingId);
            const ratingDoc = await ratingRef.get();

            if (!ratingDoc.exists) {
                throw new Error('Rating not found');
            }

            if (ratingDoc.data().userId !== userId) {
                throw new Error('Unauthorized to delete this rating');
            }

            await ratingRef.delete();
            return true;
        } catch (error) {
            console.error('Error deleting rating:', error);
            throw new Error(`Failed to delete rating: ${error.message}`);
        }
    }

    /**
     * Get ratings for a specific movie
     * @param {number} movieId - Kinopoisk movie ID
     * @param {number} limit - Maximum number of ratings
     * @returns {Promise<Array>} - Movie ratings
     */
    async getMovieRatings(movieId, limit = 20) {
        try {
            const query = this.db.collection(this.collection)
                .where('movieId', '==', movieId);

            const results = await query.get();
            const ratings = [];

            results.forEach(doc => {
                ratings.push({ id: doc.id, ...doc.data() });
            });

            // Sort by createdAt descending in memory (to avoid index requirement)
            ratings.sort((a, b) => {
                const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt) || new Date(0);
                const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt) || new Date(0);
                return dateB - dateA;
            });

            // Apply limit after sorting
            return ratings.slice(0, limit);
        } catch (error) {
            console.error('Error getting movie ratings:', error);
            return [];
        }
    }

    /**
     * Get rating statistics for a user
     * @param {string} userId - User ID
     * @returns {Promise<Object>} - User rating statistics
     */
    async getUserRatingStats(userId) {
        try {
            const query = this.db.collection(this.collection)
                .where('userId', '==', userId);

            const results = await query.get();
            
            let totalRatings = 0;
            let averageRating = 0;
            let ratingDistribution = {};

            results.forEach(doc => {
                const data = doc.data();
                totalRatings++;
                averageRating += data.rating;
                
                const rating = data.rating;
                ratingDistribution[rating] = (ratingDistribution[rating] || 0) + 1;
            });

            averageRating = totalRatings > 0 ? Math.round((averageRating / totalRatings) * 10) / 10 : 0;

            return {
                totalRatings,
                averageRating,
                ratingDistribution
            };
        } catch (error) {
            console.error('Error getting user rating stats:', error);
            return {
                totalRatings: 0,
                averageRating: 0,
                ratingDistribution: {}
            };
        }
    }

    /**
     * Get all unique movie IDs that have ratings
     * @returns {Promise<Array<number>>} - Array of movie IDs with ratings
     */
    async getRatedMovieIds() {
        try {
            const snapshot = await this.db.collection(this.collection).get();
            const movieIds = new Set();
            
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.movieId) {
                    movieIds.add(data.movieId);
                }
            });
            
            return Array.from(movieIds);
        } catch (error) {
            console.error('Error getting rated movie IDs:', error);
            return [];
        }
    }

    /**
     * Update user profile data in all their ratings
     * @param {string} userId - User ID
     * @param {string} userName - New user display name
     * @param {string} userPhoto - New user photo URL
     * @returns {Promise<number>} - Number of ratings updated
     */
    async updateUserProfileInRatings(userId, userName, userPhoto) {
        try {
            const query = this.db.collection(this.collection)
                .where('userId', '==', userId);

            const results = await query.get();
            
            if (results.empty) {
                return 0;
            }

            const batch = this.db.batch();
            let updateCount = 0;

            results.forEach(doc => {
                const updateData = {
                    userName: userName,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                
                if (userPhoto) {
                    updateData.userPhoto = userPhoto;
                }
                
                batch.update(doc.ref, updateData);
                updateCount++;
            });

            await batch.commit();

            // Clear ratings cache after update
            try {
                const ratingsCacheService = window.firebaseManager?.getRatingsCacheService();
                if (ratingsCacheService) {
                    await ratingsCacheService.clearCache();
                }
            } catch (cacheError) {
                console.warn('Failed to clear ratings cache after profile update:', cacheError.message);
            }

            return updateCount;
        } catch (error) {
            console.error('Error updating user profile in ratings:', error);
            throw new Error(`Failed to update user profile in ratings: ${error.message}`);
        }
    }

    /**
     * Listen to real-time rating updates
     * @param {Function} callback - Callback function for updates
     * @returns {Function} - Unsubscribe function
     */
    listenToRatings(callback) {
        const unsubscribe = this.db.collection(this.collection)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .onSnapshot((snapshot) => {
                const ratings = [];
                snapshot.forEach(doc => {
                    ratings.push({ id: doc.id, ...doc.data() });
                });
                callback(ratings);
            });

        return unsubscribe;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RatingService;
} else {
    window.RatingService = RatingService;
}
