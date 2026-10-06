/**
 * HomeDataController - Data Aggregation Layer for Home Page
 * Handles all service requests, API fetching, and data preparation without any DOM manipulation.
 */

const HOME_PERSONAL_PREVIEW_LIMIT = 6;
const HOME_COMMUNITY_TOP_LIMIT = 4;
// Candidate pool for the weighted community ranking; a plain avgRating sort
// lets a single 10/10 vote outrank widely rated films.
const HOME_COMMUNITY_POOL_SIZE = 24;
const HOME_COMMUNITY_PRIOR_VOTES = 5;
// Fixed prior mean: the candidate pools are biased towards high averages, so
// their own mean would let single-vote films keep winning.
const HOME_COMMUNITY_PRIOR_MEAN = 7;
const HOME_FAVORITES_REUSE_MS = 30 * 1000;
const HOME_RATING_STATS_TTL_MS = 5 * 60 * 1000;
const HOME_RATING_STATS_CACHE_PREFIX = 'home_rating_stats_v1_';
const HOME_PROGRESS_STORAGE_PREFIX = 'watching_progress_';
// Community picks are the same for every user; reading both candidate pools
// (~49 documents) on every visit cost ten times the original 5 reads.
const HOME_COMMUNITY_CACHE_KEY = 'home_community_top_v1';
const HOME_COMMUNITY_TTL_MS = 30 * 60 * 1000;

function homeTimestampMs(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
}

class HomeDataController {
    /**
     * @param {Object} [firebaseManager] - Instance of FirebaseManager
     */
    constructor(firebaseManager = window.firebaseManager) {
        this.firebaseManager = firebaseManager;
        this.servicesOwner = undefined;
        this.favoriteListsRequest = null;
        this.initServices();
    }

    /**
     * Initialize service references once per Firebase manager. Recreating
     * services on every fetch dropped their in-flight deduplication state.
     */
    initServices() {
        const fm = this.firebaseManager || window.firebaseManager;
        if (this.servicesOwner === (fm || null)) return;
        this.servicesOwner = fm || null;

        this.kinopoiskService = fm?.getKinopoiskService?.() || (typeof KinopoiskService !== 'undefined' ? new KinopoiskService() : null);
        this.tmdbService = typeof TMDBService !== 'undefined' ? new TMDBService() : null;
        this.homeCacheService = fm?.getHomeCacheService?.() || (typeof HomeCacheService !== 'undefined' ? new HomeCacheService(fm) : null);
        this.homeMovieNavigationService = this.homeMovieNavigationService
            || (typeof HomeMovieNavigationService !== 'undefined'
                ? new HomeMovieNavigationService({ kinopoiskService: this.kinopoiskService })
                : null);
        this.favoriteService = fm?.getFavoriteService?.() || (typeof FavoriteService !== 'undefined' && fm ? new FavoriteService(fm) : null);
        this.movieCacheService = fm?.getMovieCacheService?.() || (typeof MovieCacheService !== 'undefined' && fm ? new MovieCacheService(fm) : null);
        this.profileService = (typeof ProfileService !== 'undefined' && fm) ? new ProfileService(fm) : null;
    }

    /**
     * Check if user is currently authenticated
     * @returns {Object|null}
     */
    getCurrentUser() {
        const fm = this.firebaseManager || window.firebaseManager;
        return fm?.getCurrentUser?.() || fm?.user || fm?.auth?.currentUser || null;
    }

    /**
     * Ensure Firebase Auth session is ready before proceeding
     * @param {number} [timeoutMs=1000]
     * @returns {Promise<Object|null>}
     */
    async ensureAuthReady(timeoutMs = 1000) {
        const fm = this.firebaseManager || window.firebaseManager;
        if (fm?.waitForAuthReady) {
            return await fm.waitForAuthReady(timeoutMs);
        }
        return this.getCurrentUser();
    }

    /**
     * Normalize a discovery payload into the shape the renderer expects.
     * @param {Object} data
     * @returns {Object}
     */
    normalizeDiscovery(data = {}) {
        const animeList = Array.isArray(data.anime) ? data.anime : (Array.isArray(data.shows) ? data.shows : []);
        return {
            featured: Array.isArray(data.featured) ? data.featured : [],
            films: Array.isArray(data.films) ? data.films : [],
            series: Array.isArray(data.series) ? data.series : [],
            cartoons: Array.isArray(data.cartoons) ? data.cartoons : [],
            anime: animeList,
            shows: animeList
        };
    }

    /**
     * Fetch discovery showcase data (Featured, Films, Series, Cartoons, Shows)
     * @returns {Promise<Object>} Normalized sections, plus `refreshPromise`
     *   resolving to fresh normalized sections when cached data was stale.
     */
    async fetchDiscoveryShowcase() {
        this.initServices();

        if (!this.homeCacheService) {
            throw new Error('Required discovery service (HomeCacheService) is not available');
        }

        const result = await this.homeCacheService.getDiscoveryData(null, {
            tmdbOnly: true,
            // Titles come from TMDB in the interface language.
            locale: (typeof window !== 'undefined' && window.i18n?.currentLocale) || 'ru'
        });

        return {
            ...this.normalizeDiscovery(result?.data || {}),
            isStale: !!result?.isStale,
            refreshPromise: result?.refreshPromise
                ? result.refreshPromise.then(fresh => this.normalizeDiscovery(fresh || {}))
                : null
        };
    }

    async resolveHomeMovie(item) {
        this.initServices();
        return this.homeMovieNavigationService?.resolve(item) || null;
    }

    resolveUid(userParam) {
        if (typeof userParam === 'string') return userParam;
        if (userParam && userParam.uid) return userParam.uid;
        if (userParam === null || userParam === undefined) return this.getCurrentUser()?.uid || null;
        return null;
    }

    /**
     * Load the user's watching and watchlist bookmarks once and share them
     * between the personal tier and dashboard counters.
     * @param {string} uid
     * @returns {Promise<{watching: Array, watchlist: Array}>}
     */
    getFavoriteLists(uid) {
        const cached = this.favoriteListsRequest;
        if (cached && cached.uid === uid && Date.now() - cached.createdAt < HOME_FAVORITES_REUSE_MS) {
            return cached.promise;
        }

        const read = status => (this.favoriteService
            ? this.favoriteService.getFavorites(uid, status, 'createdAt', 'desc', { throwOnError: true })
            : Promise.resolve([]));

        const promise = (async () => {
            const [watchingRes, watchlistRes] = await Promise.allSettled([read('watching'), read('plan_to_watch')]);
            const lists = {
                watching: (watchingRes.status === 'fulfilled' && Array.isArray(watchingRes.value)) ? watchingRes.value : [],
                watchlist: (watchlistRes.status === 'fulfilled' && Array.isArray(watchlistRes.value)) ? watchlistRes.value : [],
                watchingFailed: watchingRes.status === 'rejected',
                watchlistFailed: watchlistRes.status === 'rejected'
            };
            // Failed reads must not be reused: the next render retries them.
            if ((lists.watchingFailed || lists.watchlistFailed) && this.favoriteListsRequest?.promise === promise) {
                this.favoriteListsRequest = null;
            }
            return lists;
        })();

        this.favoriteListsRequest = { uid, createdAt: Date.now(), promise };
        return promise;
    }

    /**
     * Read local playback progress for the given bookmarks in one storage call.
     * @param {Array<Object>} items
     * @returns {Promise<Object>} Map of movieId -> progress record
     */
    async getWatchingProgress(items = []) {
        const ids = items
            .map(item => item?.movieId || item?.kinopoiskId)
            .filter(id => id !== null && id !== undefined && id !== '')
            .map(String);
        if (ids.length === 0) return {};
        try {
            const keys = ids.map(id => `${HOME_PROGRESS_STORAGE_PREFIX}${id}`);
            const stored = await chrome.storage.local.get(keys);
            const progress = {};
            ids.forEach(id => {
                const record = stored?.[`${HOME_PROGRESS_STORAGE_PREFIX}${id}`];
                if (record && typeof record === 'object') progress[id] = record;
            });
            return progress;
        } catch {
            return {};
        }
    }

    /**
     * "Continue watching" is ordered by the latest playback, then by the
     * latest bookmark change, instead of by when the title was bookmarked.
     * @param {Array<Object>} items
     * @param {Object} progress
     * @returns {Array<Object>}
     */
    sortByRecentActivity(items, progress) {
        const activity = item => {
            const id = String(item?.movieId || item?.kinopoiskId || '');
            return Math.max(
                homeTimestampMs(progress[id]?.updatedAt),
                homeTimestampMs(item?.updatedAt),
                homeTimestampMs(item?.createdAt)
            );
        };
        return [...items].sort((a, b) => activity(b) - activity(a));
    }

    /**
     * Fetch personal tier data (Watching and Watchlist/Plan to watch)
     * @param {string|Object} [userParam] - User ID string or User object
     * @returns {Promise<Object>}
     */
    async fetchPersonalData(userParam = null) {
        this.initServices();
        const uid = this.resolveUid(userParam);

        if (!uid) {
            return {
                isAuthenticated: false,
                watching: [],
                watchingTotal: 0,
                watchlist: [],
                watchlistTotal: 0
            };
        }

        const lists = await this.getFavoriteLists(uid);
        if (lists.watchingFailed && lists.watchlistFailed) {
            return {
                isAuthenticated: true,
                userId: uid,
                loadFailed: true,
                watching: [],
                watchingTotal: 0,
                watchlist: [],
                watchlistTotal: 0,
                hasContent: false
            };
        }

        const progress = await this.getWatchingProgress(lists.watching);
        const watching = this.sortByRecentActivity(lists.watching, progress)
            .slice(0, HOME_PERSONAL_PREVIEW_LIMIT)
            .map(item => {
                const record = progress[String(item?.movieId || item?.kinopoiskId || '')];
                return record ? { ...item, watchProgress: record } : item;
            });
        const watchingAll = lists.watching;
        const watchlistAll = lists.watchlist;
        const watchlist = watchlistAll.slice(0, HOME_PERSONAL_PREVIEW_LIMIT);

        return {
            isAuthenticated: true,
            userId: uid,
            watching,
            watchingTotal: watchingAll.length,
            watchlist,
            watchlistTotal: watchlistAll.length,
            hasContent: watching.length > 0 || watchlist.length > 0,
            partialFailure: lists.watchingFailed || lists.watchlistFailed
        };
    }

    async readStorage(key) {
        try {
            const result = await chrome.storage.local.get([key]);
            return result?.[key] || null;
        } catch {
            return null;
        }
    }

    async writeStorage(key, value) {
        try {
            await chrome.storage.local.set({ [key]: value });
        } catch {
            // Statistics cache is an optimization only.
        }
    }

    /**
     * Rating statistics read every rating document of the user, so Home keeps
     * a short-lived local copy instead of repeating that scan on every visit.
     * @param {string} uid
     * @returns {Promise<{totalRatings: number, averageRating: number}|null>}
     */
    async getRatingStatistics(uid) {
        const cacheKey = `${HOME_RATING_STATS_CACHE_PREFIX}${uid}`;
        const cached = await this.readStorage(cacheKey);
        if (cached && Date.now() - Number(cached.timestamp || 0) < HOME_RATING_STATS_TTL_MS) {
            return cached.stats;
        }

        if (!this.profileService?.getRatingsStatistics) return cached?.stats || null;
        const stats = await this.profileService.getRatingsStatistics(uid);
        const compact = {
            totalRatings: Number(stats?.totalRatings) || 0,
            averageRating: Number(stats?.averageRating) || 0
        };
        await this.writeStorage(cacheKey, { timestamp: Date.now(), stats: compact });
        return compact;
    }

    /**
     * Rank community films by a Bayesian average so a handful of votes
     * cannot outrank films rated by many users.
     * @param {Array<Object>} movies
     * @param {number} limit
     * @returns {Array<Object>}
     */
    rankCommunityTop(movies = [], limit = HOME_COMMUNITY_TOP_LIMIT) {
        const rated = movies.filter(movie => Number(movie?.avgRating) > 0);
        if (rated.length === 0) return [];

        const globalMean = HOME_COMMUNITY_PRIOR_MEAN;
        const prior = HOME_COMMUNITY_PRIOR_VOTES;
        const score = movie => {
            const votes = Math.max(1, Number(movie.ratingsCount) || 1);
            return (votes * Number(movie.avgRating) + prior * globalMean) / (votes + prior);
        };

        return rated
            .map(movie => ({ movie, score: score(movie) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(entry => entry.movie);
    }

    /**
     * Community picks from two candidate pools, the highest averages and the
     * most rated films (ranking only the top averages missed widely rated
     * films), cached locally for every user of this browser.
     * @returns {Promise<Array<Object>>}
     */
    async getCommunityTop() {
        const cached = await this.readStorage(HOME_COMMUNITY_CACHE_KEY);
        if (cached && Array.isArray(cached.movies) && Date.now() - Number(cached.timestamp || 0) < HOME_COMMUNITY_TTL_MS) {
            return cached.movies;
        }
        if (!this.movieCacheService) return cached?.movies || [];

        const [topAverageRes, mostRatedRes] = await Promise.allSettled([
            this.movieCacheService.getMoviesByAvgRating({ sortBy: 'avgRating', sortDir: 'desc', limit: HOME_COMMUNITY_POOL_SIZE }),
            this.movieCacheService.getMostRatedMovies
                ? this.movieCacheService.getMostRatedMovies(HOME_COMMUNITY_POOL_SIZE)
                : Promise.resolve([])
        ]);
        const toArray = result => {
            if (result.status !== 'fulfilled') return [];
            return Array.isArray(result.value) ? result.value : (result.value?.movies || []);
        };
        if (topAverageRes.status === 'rejected' && mostRatedRes.status === 'rejected') {
            return cached?.movies || [];
        }

        const communityById = new Map();
        [...toArray(topAverageRes), ...toArray(mostRatedRes)].forEach(movie => {
            if (movie?.id && !communityById.has(movie.id)) communityById.set(movie.id, movie);
        });
        const top = this.rankCommunityTop([...communityById.values()]);
        // Firestore Timestamps and other class instances become plain data.
        const storable = JSON.parse(JSON.stringify(top));
        await this.writeStorage(HOME_COMMUNITY_CACHE_KEY, { timestamp: Date.now(), movies: storable });
        return top;
    }

    /**
     * Fetch dashboard data (User Statistics and Community Top)
     * @param {string|Object|boolean} [userParam] - User ID string, User object, or false if logged out
     * @returns {Promise<Object>}
     */
    async fetchDashboardData(userParam = null) {
        this.initServices();
        const uid = this.resolveUid(userParam);

        if (!uid) {
            return {
                isAuthenticated: false,
                stats: null,
                communityTop: []
            };
        }

        const [ratingStatsRes, listsRes, communityRes] = await Promise.allSettled([
            this.getRatingStatistics(uid),
            this.getFavoriteLists(uid),
            this.getCommunityTop()
        ]);

        const ratingStats = ratingStatsRes.status === 'fulfilled' ? ratingStatsRes.value : null;
        const lists = listsRes.status === 'fulfilled' ? listsRes.value : null;
        const countOrDash = (failed, list) => (failed ? '—' : list.length);

        return {
            isAuthenticated: true,
            userId: uid,
            stats: (ratingStats || lists) ? {
                totalRatings: ratingStats ? ratingStats.totalRatings : '—',
                averageRating: ratingStats?.averageRating ? Number(ratingStats.averageRating).toFixed(1) : '—',
                watchingCount: lists ? countOrDash(lists.watchingFailed, lists.watching) : '—',
                watchlistCount: lists ? countOrDash(lists.watchlistFailed, lists.watchlist) : '—'
            } : null,
            communityTop: communityRes.status === 'fulfilled' ? communityRes.value : []
        };
    }
}

if (typeof window !== 'undefined') {
    window.HomeDataController = HomeDataController;
}
