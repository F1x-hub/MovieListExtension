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
        // userId -> { promise, timestamp }: one read of the user's ratings serves the
        // statistics and every "recent ratings" page instead of a full read each.
        this.userRatingsCache = new Map();
    }

    static RATINGS_SNAPSHOT_TTL_MS = 60 * 1000;
    static MOVIE_FETCH_CONCURRENCY = 3;

    /**
     * All rating documents of a user as plain objects, read at most once per TTL.
     * Concurrent callers share the in-flight read; a failed read is not cached.
     * @param {string} userId
     * @returns {Promise<Array<Object>>}
     */
    loadUserRatings(userId) {
        const cached = this.userRatingsCache.get(userId);
        if (cached && Date.now() - cached.timestamp < ProfileService.RATINGS_SNAPSHOT_TTL_MS) {
            return cached.promise;
        }

        const promise = this.db.collection('ratings')
            .where('userId', '==', userId)
            .get()
            .then(snapshot => {
                const ratings = [];
                snapshot.forEach(doc => ratings.push({ id: doc.id, ...doc.data() }));
                return ratings;
            });
        const entry = { promise, timestamp: Date.now() };
        this.userRatingsCache.set(userId, entry);
        promise.catch(() => {
            if (this.userRatingsCache.get(userId) === entry) this.userRatingsCache.delete(userId);
        });
        return promise;
    }

    /** Drops the shared ratings read, e.g. before an explicit profile reload. */
    invalidateUserRatings(userId) {
        if (userId) this.userRatingsCache.delete(userId);
        else this.userRatingsCache.clear();
    }

    /**
     * The user's ratings newest first, one per movie (the latest), memoized per read.
     * @param {string} userId
     * @returns {Promise<Array<Object>>}
     */
    async getSortedUniqueRatings(userId) {
        const ratings = await this.loadUserRatings(userId);
        const entry = this.userRatingsCache.get(userId);
        if (entry && entry.sortedSource === ratings) return entry.sorted;

        const toTime = value => value?.toDate ? value.toDate().getTime() : (value?.seconds || 0) * 1000;
        const sorted = ratings.slice().sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
        const seenMovieIds = new Set();
        const unique = [];
        for (const rating of sorted) {
            if (rating.movieId) {
                const key = String(rating.movieId);
                if (seenMovieIds.has(key)) continue;
                seenMovieIds.add(key);
            }
            unique.push(rating);
        }
        if (entry) {
            entry.sortedSource = ratings;
            entry.sorted = unique;
        }
        return unique;
    }

    static toRatingMovie(movieId, movieData) {
        if (!movieData) {
            // An empty name lets the page show its localized "unknown title" text.
            return { id: movieId, name: '', alternativeName: '', posterUrl: '', year: null, genres: [] };
        }
        return {
            id: movieData.id || movieData.kinopoiskId || movieId,
            name: movieData.name || movieData.movieTitle || '',
            alternativeName: movieData.alternativeName || movieData.movieTitleRu || '',
            posterUrl: movieData.posterUrl || movieData.posterPath || '',
            year: movieData.year || movieData.releaseYear || null,
            genres: movieData.genres || []
        };
    }

    /**
     * Get recent ratings with full movie data
     * @param {string} userId - User ID
     * @param {number} limit - Maximum number of ratings to return
     * @param {number} offset - Number of (deduplicated) ratings to skip
     * @param {{throwOnError?: boolean}} [options] - throwOnError rethrows read failures
     *   instead of returning an empty list that looks like "no ratings"
     * @returns {Promise<Array>} - Array of rating objects with movie data
     */
    async getRecentRatings(userId, limit = 10, offset = 0, { throwOnError = false } = {}) {
        try {
            if (!userId) {
                throw new Error('User ID is required');
            }

            const uniqueRatings = await this.getSortedUniqueRatings(userId);
            // Copies: the shared snapshot must not collect `movie` fields.
            const pagedRatings = uniqueRatings.slice(offset, offset + limit).map(rating => ({ ...rating }));
            if (pagedRatings.length === 0) {
                return [];
            }

            const movieIds = [...new Set(pagedRatings.map(r => r.movieId).filter(Boolean))];
            const cachedMovies = movieIds.length > 0
                ? await this.movieCacheService.getBatchCachedMovies(movieIds)
                : {};

            // Movies missing from the shared and local caches: a rating document may
            // carry its own title/poster; only the rest go to the Kinopoisk API, a few
            // at a time instead of one after another.
            const missingIds = movieIds.filter(movieId => {
                if (cachedMovies[movieId]) return false;
                const rating = pagedRatings.find(r => r.movieId === movieId);
                return !rating?.movieTitle;
            });
            const fetchedMovies = await this.fetchMissingMovies(missingIds);

            for (const ratingData of pagedRatings) {
                if (!ratingData.movieId) continue;
                const movieData = cachedMovies[ratingData.movieId]
                    || fetchedMovies.get(ratingData.movieId)
                    || (ratingData.movieTitle
                        ? { name: ratingData.movieTitle, posterPath: ratingData.posterPath || '' }
                        : null);
                ratingData.movie = ProfileService.toRatingMovie(ratingData.movieId, movieData);
            }

            return pagedRatings;
        } catch (error) {
            console.error('Error getting recent ratings:', error);
            if (throwOnError) throw error;
            return [];
        }
    }

    /**
     * Loads movies absent from every cache through the Kinopoisk API with bounded
     * concurrency. Failures leave the movie out (the card shows a placeholder).
     * @param {Array<number|string>} movieIds
     * @returns {Promise<Map>} movieId -> movie data
     */
    async fetchMissingMovies(movieIds) {
        const result = new Map();
        if (!movieIds.length) return result;
        const kinopoiskService = this.firebaseManager.getKinopoiskService?.();
        if (!kinopoiskService?.getMovieById) return result;

        const queue = movieIds.slice();
        const worker = async () => {
            while (queue.length > 0) {
                const movieId = queue.shift();
                try {
                    const movieData = await kinopoiskService.getMovieById(movieId);
                    if (!movieData) continue;
                    result.set(movieId, movieData);
                    await this.movieCacheService.cacheMovie(movieData, true);
                } catch (error) {
                    console.warn(`Could not fetch movie ${movieId} from API:`, error);
                }
            }
        };
        const workers = Math.min(ProfileService.MOVIE_FETCH_CONCURRENCY, queue.length);
        await Promise.all(Array.from({ length: workers }, worker));
        return result;
    }

    /**
     * Get user statistics
     * @param {string} userId - User ID
     * @param {{throwOnError?: boolean}} [options] - throwOnError rethrows read failures
     *   instead of returning zero counters
     * @returns {Promise<Object>} - Statistics object
     */
    async getUserStatistics(userId, { throwOnError = false } = {}) {
        try {
            if (!userId) {
                throw new Error('User ID is required');
            }

            // Get ratings stats and counts from FavoriteService (watching and plan_to_watch)
            const [ratingsStats, watchingCount, watchlistCount] = await Promise.all([
                this.getRatingsStatistics(userId, { throwOnError }),
                this.favoriteService ? this.favoriteService.getFavoritesCount(userId, 'watching', { throwOnError }) : 0,
                this.favoriteService ? this.favoriteService.getFavoritesCount(userId, 'plan_to_watch', { throwOnError }) : 0
            ]);

            return {
                totalRatings: ratingsStats.totalRatings,
                averageRating: ratingsStats.averageRating,
                ratingDistribution: ratingsStats.ratingDistribution,
                // We map 'watching' count to 'favoritesCount' because the frontend expects this property name
                // The label in the UI will be updated to "Watching" via locales
                favoritesCount: watchingCount, 
                watchlistCount: watchlistCount
            };
        } catch (error) {
            console.error('Error getting user statistics:', error);
            if (throwOnError) throw error;
            return {
                totalRatings: 0,
                averageRating: 0,
                ratingDistribution: [],
                favoritesCount: 0,
                watchlistCount: 0
            };
        }
    }

    /**
     * Get ratings statistics
     * @param {string} userId - User ID
     * @param {{throwOnError?: boolean}} [options]
     * @returns {Promise<Object>} - Ratings statistics
     */
    async getRatingsStatistics(userId, { throwOnError = false } = {}) {
        try {
            const ratings = await this.loadUserRatings(userId);

            let totalRatings = 0;
            let sumRatings = 0;
            const ratingDistribution = Array.from({ length: 10 }, (_, index) => ({
                rating: index + 1,
                count: 0
            }));

            ratings.forEach(data => {
                // Legacy documents may store the score as a string; adding it
                // unconverted concatenated the sum.
                const ratingValue = Number(data.rating);
                if (Number.isFinite(ratingValue) && ratingValue > 0) {
                    totalRatings++;
                    sumRatings += ratingValue;
                    const normalizedRating = Math.round(ratingValue);
                    if (normalizedRating >= 1 && normalizedRating <= 10) {
                        ratingDistribution[normalizedRating - 1].count++;
                    }
                }
            });

            const averageRating = totalRatings > 0 
                ? Math.round((sumRatings / totalRatings) * 10) / 10 
                : 0;

            return {
                totalRatings,
                averageRating,
                ratingDistribution
            };
        } catch (error) {
            console.error('Error getting ratings statistics:', error);
            if (throwOnError) throw error;
            return {
                totalRatings: 0,
                averageRating: 0,
                ratingDistribution: []
            };
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
        const locale = typeof i18n !== 'undefined' && i18n.currentLocale === 'ru' ? 'ru-RU' : 'en-US';
        const isRussian = locale === 'ru-RU';
        const diffInMs = now - dateObj;
        const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

        if (diffInDays === 0) {
            return isRussian ? 'Сегодня' : 'Today';
        } else if (diffInDays === 1) {
            return isRussian ? 'Вчера' : 'Yesterday';
        } else if (diffInDays < 7) {
            return isRussian ? `${diffInDays} дн. назад` : `${diffInDays} days ago`;
        } else if (diffInDays < 30) {
            const weeks = Math.floor(diffInDays / 7);
            return isRussian ? `${weeks} нед. назад` : `${weeks} week${weeks > 1 ? 's' : ''} ago`;
        } else {
            return dateObj.toLocaleDateString(locale, {
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

        const locale = typeof i18n !== 'undefined' && i18n.currentLocale === 'ru' ? 'ru-RU' : 'en-US';
        return dateObj.toLocaleDateString(locale, {
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
