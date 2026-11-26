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
    static RATINGS_STORE_PREFIX = 'profile_cache_ratings_';
    static RATINGS_STORE_LIMIT = 6;
    // Profile and Achievements show hundreds of rated films; their cards come from this
    // browser's copy for this long before Firestore is asked again.
    static MOVIE_LOCAL_MAX_AGE_MS = 12 * 60 * 60 * 1000;
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

        const promise = this.readUserRatings(userId);
        const entry = { promise, timestamp: Date.now() };
        this.userRatingsCache.set(userId, entry);
        promise.catch(() => {
            if (this.userRatingsCache.get(userId) === entry) this.userRatingsCache.delete(userId);
        });
        return promise;
    }

    /**
     * Reading every rating of a user on each Home, Profile and Achievements visit cost
     * hundreds of Firestore reads. A copy is kept in chrome.storage.local (prefix
     * `profile_cache_`, so sign-out removes it). A later visit asks only for ratings whose
     * `updatedAt` or `contentUpdatedAt` (a review text edit) is at or after the newest one
     * seen, plus one server-side count; a count that does not match the merged copy
     * (a deletion) means a full read, as before.
     */
    async readUserRatings(userId) {
        const stored = await this.readStoredRatings(userId);
        if (stored) {
            try {
                const synced = await this.syncStoredRatings(userId, stored);
                if (synced) return synced;
            } catch (error) {
                console.warn('[ProfileService] Rating sync failed; reading all ratings:', error?.code || error?.message || error);
            }
        }
        const snapshot = await this.db.collection('ratings').where('userId', '==', userId).get();
        const ratings = [];
        snapshot.forEach(doc => ratings.push({ id: doc.id, ...doc.data() }));
        await this.saveStoredRatings(userId, ratings);
        return ratings;
    }

    async syncStoredRatings(userId, stored) {
        if (typeof this.firebaseManager?.countDocuments !== 'function') return null;
        const since = firebase.firestore.Timestamp.fromMillis(stored.syncedAt);
        const base = this.db.collection('ratings').where('userId', '==', userId);
        const [changed, edited, total] = await Promise.all([
            base.where('updatedAt', '>=', since).get(),
            base.where('contentUpdatedAt', '>=', since).get(),
            this.firebaseManager.countDocuments('ratings', { field: 'userId', value: userId })
        ]);
        if (!Number.isFinite(total)) return null;

        const byId = new Map(stored.ratings.map(rating => [rating.id, rating]));
        let changes = 0;
        for (const snapshot of [changed, edited]) {
            snapshot.forEach(doc => {
                byId.set(doc.id, { id: doc.id, ...doc.data() });
                changes += 1;
            });
        }
        if (byId.size !== total) return null;
        const ratings = [...byId.values()];
        if (changes > 0) await this.saveStoredRatings(userId, ratings);
        return ratings;
    }

    static ratingsStoreKey(userId) {
        return `${ProfileService.RATINGS_STORE_PREFIX}${userId}`;
    }

    static timestampMillis(value) {
        if (!value) return 0;
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (Number.isFinite(value.seconds)) return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
        const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    // Firestore Timestamps survive chrome.storage as {__ts: [seconds, nanoseconds]}.
    static packRating(rating) {
        const packed = {};
        for (const [key, value] of Object.entries(rating)) {
            packed[key] = value && typeof value.toMillis === 'function' && Number.isFinite(value.seconds)
                ? { __ts: [value.seconds, value.nanoseconds || 0] }
                : value;
        }
        return packed;
    }

    static unpackRating(rating) {
        const unpacked = {};
        for (const [key, value] of Object.entries(rating)) {
            unpacked[key] = value && Array.isArray(value.__ts) && typeof firebase !== 'undefined'
                ? new firebase.firestore.Timestamp(value.__ts[0], value.__ts[1])
                : value;
        }
        return unpacked;
    }

    async readStoredRatings(userId) {
        const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : null;
        if (!storage || !userId) return null;
        try {
            const key = ProfileService.ratingsStoreKey(userId);
            const entry = (await storage.get([key]))[key];
            if (!entry || entry.v !== 1 || !Array.isArray(entry.ratings) || !Number.isFinite(entry.syncedAt) || entry.syncedAt <= 0) return null;
            return { syncedAt: entry.syncedAt, ratings: entry.ratings.map(ProfileService.unpackRating) };
        } catch (error) {
            console.warn('[ProfileService] Could not read stored ratings:', error);
            return null;
        }
    }

    async saveStoredRatings(userId, ratings) {
        const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : null;
        if (!storage || !userId) return;
        const syncedAt = ratings.reduce((latest, rating) => Math.max(
            latest,
            ProfileService.timestampMillis(rating.updatedAt),
            ProfileService.timestampMillis(rating.contentUpdatedAt),
            ProfileService.timestampMillis(rating.createdAt)
        ), 0);
        try {
            const key = ProfileService.ratingsStoreKey(userId);
            if (syncedAt <= 0) {
                await storage.remove(key);
                return;
            }
            await storage.set({ [key]: { v: 1, syncedAt, savedAt: Date.now(), ratings: ratings.map(ProfileService.packRating) } });
            // Keep the copies of a few profiles only.
            const all = await storage.get(null);
            const entries = Object.entries(all)
                .filter(([name]) => name.startsWith(ProfileService.RATINGS_STORE_PREFIX))
                .sort((left, right) => (right[1]?.savedAt || 0) - (left[1]?.savedAt || 0));
            const extra = entries.slice(ProfileService.RATINGS_STORE_LIMIT).map(([name]) => name);
            if (extra.length) await storage.remove(extra);
        } catch (error) {
            console.warn('[ProfileService] Could not store ratings:', error);
        }
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

    /** Rounded 1-10 score of a rating document, or null for legacy/invalid values. */
    static normalizeRatingValue(value) {
        // Legacy documents may store the score as a string.
        const ratingValue = Number(value);
        if (!Number.isFinite(ratingValue) || ratingValue <= 0) return null;
        const normalized = Math.round(ratingValue);
        return normalized >= 1 && normalized <= 10 ? normalized : null;
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
     * @param {{throwOnError?: boolean, rating?: number|null}} [options] - throwOnError rethrows read failures
     *   instead of returning an empty list that looks like "no ratings"; rating keeps only
     *   that (rounded) score, matching the profile rating distribution
     * @returns {Promise<Array>} - Array of rating objects with movie data
     */
    async getRecentRatings(userId, limit = 10, offset = 0, { throwOnError = false, rating = null, onlyMovieIds = null, knownMovies = null } = {}) {
        try {
            if (!userId) {
                throw new Error('User ID is required');
            }

            const sortedRatings = await this.getSortedUniqueRatings(userId);
            const uniqueRatings = sortedRatings.filter(item =>
                (rating == null || ProfileService.normalizeRatingValue(item.rating) === Number(rating))
                && (!onlyMovieIds || onlyMovieIds.has(String(item.movieId))));
            // Copies: the shared snapshot must not collect `movie` fields.
            const pagedRatings = uniqueRatings.slice(offset, offset + limit).map(rating => ({ ...rating }));
            if (pagedRatings.length === 0) {
                return [];
            }

            const movieIds = [...new Set(pagedRatings.map(r => r.movieId).filter(Boolean))];
            // Films the page has already read cost no second read.
            const unknownIds = movieIds.filter(movieId => !knownMovies?.[movieId]);
            const cachedMovies = unknownIds.length > 0
                ? await this.movieCacheService.getBatchCachedMovies(unknownIds, { localMaxAgeMs: ProfileService.MOVIE_LOCAL_MAX_AGE_MS })
                : {};
            movieIds.forEach(movieId => { if (knownMovies?.[movieId]) cachedMovies[movieId] = knownMovies[movieId]; });

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
                }
            });

            // The distribution counts one (latest) rating per movie, like the ratings
            // list, so a score's count equals the cards its filter shows.
            const uniqueRatings = await this.getSortedUniqueRatings(userId);
            uniqueRatings.forEach(data => {
                const normalizedRating = ProfileService.normalizeRatingValue(data.rating);
                if (normalizedRating) {
                    ratingDistribution[normalizedRating - 1].count++;
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
