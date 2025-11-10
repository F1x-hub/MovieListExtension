/**
 * ProfileService - Service for profile-related operations
 * Handles recent ratings, statistics, and profile data formatting
 */
class ProfileService {
    constructor(firebaseManager) {
        this.firebaseManager = firebaseManager;
        this.db = firebaseManager.db;
        this.ratingService = firebaseManager.getRatingService();
        this.favoriteService = firebaseManager.getFavoriteService();
        this.watchlistService = firebaseManager.getWatchlistService();
        this.movieCacheService = firebaseManager.getMovieCacheService();
    }

    /**
     * Get recent ratings with full movie data
     * @param {string} userId - User ID
     * @param {number} limit - Maximum number of ratings to return
     * @returns {Promise<Array>} - Array of rating objects with movie data
     */
    async getRecentRatings(userId, limit = 10) {
        try {
            if (!userId) {
                throw new Error('User ID is required');
            }

            const ratingsQuery = this.db.collection('ratings')
                .where('userId', '==', userId)
                .limit(100);

            const snapshot = await ratingsQuery.get();
            const ratings = [];

            if (snapshot.empty) {
                return [];
            }

            const movieIds = [...new Set(snapshot.docs.map(doc => {
                const data = doc.data();
                return data.movieId;
            }).filter(Boolean))];

            const cachedMovies = await this.movieCacheService.getBatchCachedMovies(movieIds);
            const kinopoiskService = this.firebaseManager.getKinopoiskService();

            for (const doc of snapshot.docs) {
                const ratingData = { id: doc.id, ...doc.data() };
                
                if (ratingData.movieId) {
                    try {
                        let movieData = cachedMovies[ratingData.movieId];
                        
                        if (!movieData) {
                            try {
                                movieData = await kinopoiskService.getMovieById(ratingData.movieId);
                                if (movieData) {
                                    await this.movieCacheService.cacheMovie(movieData, true);
                                }
                            } catch (fetchError) {
                                console.warn(`Could not fetch movie ${ratingData.movieId} from API:`, fetchError);
                            }
                        }

                        if (movieData) {
                            ratingData.movie = {
                                id: movieData.id || movieData.kinopoiskId,
                                name: movieData.name || movieData.movieTitle || 'Unknown Movie',
                                alternativeName: movieData.alternativeName || movieData.movieTitleRu || '',
                                posterUrl: movieData.posterUrl || movieData.posterPath || '',
                                year: movieData.year || movieData.releaseYear || null,
                                genres: movieData.genres || []
                            };
                        } else {
                            ratingData.movie = {
                                id: ratingData.movieId,
                                name: 'Unknown Movie',
                                alternativeName: '',
                                posterUrl: '',
                                year: null,
                                genres: []
                            };
                        }
                    } catch (error) {
                        console.error(`Error fetching movie ${ratingData.movieId}:`, error);
                        ratingData.movie = {
                            id: ratingData.movieId,
                            name: 'Unknown Movie',
                            alternativeName: '',
                            posterUrl: '',
                            year: null,
                            genres: []
                        };
                    }
                }

                ratings.push(ratingData);
            }

            ratings.sort((a, b) => {
                const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt?.seconds || 0) * 1000;
                const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt?.seconds || 0) * 1000;
                return bTime - aTime;
            });

            return ratings.slice(0, limit);
        } catch (error) {
            console.error('Error getting recent ratings:', error);
            return [];
        }
    }

    /**
     * Get user statistics
     * @param {string} userId - User ID
     * @returns {Promise<Object>} - Statistics object
     */
    async getUserStatistics(userId) {
        try {
            if (!userId) {
                throw new Error('User ID is required');
            }

            const [ratingsStats, favoritesCount, watchlistCount] = await Promise.all([
                this.getRatingsStatistics(userId),
                this.getFavoritesCount(userId),
                this.getWatchlistCount(userId)
            ]);

            return {
                totalRatings: ratingsStats.totalRatings,
                averageRating: ratingsStats.averageRating,
                favoritesCount,
                watchlistCount
            };
        } catch (error) {
            console.error('Error getting user statistics:', error);
            return {
                totalRatings: 0,
                averageRating: 0,
                favoritesCount: 0,
                watchlistCount: 0
            };
        }
    }

    /**
     * Get ratings statistics
     * @param {string} userId - User ID
     * @returns {Promise<Object>} - Ratings statistics
     */
    async getRatingsStatistics(userId) {
        try {
            const ratingsQuery = this.db.collection('ratings')
                .where('userId', '==', userId);

            const snapshot = await ratingsQuery.get();
            
            let totalRatings = 0;
            let sumRatings = 0;

            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.rating) {
                    totalRatings++;
                    sumRatings += data.rating;
                }
            });

            const averageRating = totalRatings > 0 
                ? Math.round((sumRatings / totalRatings) * 10) / 10 
                : 0;

            return {
                totalRatings,
                averageRating
            };
        } catch (error) {
            console.error('Error getting ratings statistics:', error);
            return {
                totalRatings: 0,
                averageRating: 0
            };
        }
    }

    /**
     * Get favorites count
     * @param {string} userId - User ID
     * @returns {Promise<number>} - Number of favorites
     */
    async getFavoritesCount(userId) {
        try {
            const favoritesQuery = this.db.collection('ratings')
                .where('userId', '==', userId)
                .where('isFavorite', '==', true);

            const snapshot = await favoritesQuery.get();
            return snapshot.size;
        } catch (error) {
            console.error('Error getting favorites count:', error);
            return 0;
        }
    }

    /**
     * Get watchlist count
     * @param {string} userId - User ID
     * @returns {Promise<number>} - Number of watchlist items
     */
    async getWatchlistCount(userId) {
        try {
            const watchlistQuery = this.db.collection('watchlist')
                .where('userId', '==', userId);

            const snapshot = await watchlistQuery.get();
            return snapshot.size;
        } catch (error) {
            console.error('Error getting watchlist count:', error);
            return 0;
        }
    }

    /**
     * Format date for display
     * @param {Date|Timestamp|string} date - Date to format
     * @returns {string} - Formatted date string
     */
    formatDate(date) {
        if (!date) return 'Unknown';

        let dateObj;
        if (date.toDate) {
            dateObj = date.toDate();
        } else if (typeof date === 'string') {
            dateObj = new Date(date);
        } else {
            dateObj = date;
        }

        if (isNaN(dateObj.getTime())) {
            return 'Unknown';
        }

        const now = new Date();
        const diffInMs = now - dateObj;
        const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

        if (diffInDays === 0) {
            return 'Today';
        } else if (diffInDays === 1) {
            return 'Yesterday';
        } else if (diffInDays < 7) {
            return `${diffInDays} days ago`;
        } else if (diffInDays < 30) {
            const weeks = Math.floor(diffInDays / 7);
            return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
        } else {
            return dateObj.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }
    }

    /**
     * Format join date for display
     * @param {Date|Timestamp|string} date - Date to format
     * @returns {string} - Formatted date string
     */
    formatJoinDate(date) {
        if (!date) return 'Unknown';

        let dateObj;
        if (date.toDate) {
            dateObj = date.toDate();
        } else if (typeof date === 'string') {
            dateObj = new Date(date);
        } else {
            dateObj = date;
        }

        if (isNaN(dateObj.getTime())) {
            return 'Unknown';
        }

        return dateObj.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long'
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProfileService;
} else {
    window.ProfileService = ProfileService;
}

