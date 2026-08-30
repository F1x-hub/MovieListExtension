/**
 * HomeDataController - Data Aggregation Layer for Home Page
 * Handles all service requests, API fetching, and data preparation without any DOM manipulation.
 */
class HomeDataController {
    /**
     * @param {Object} [firebaseManager] - Instance of FirebaseManager
     */
    constructor(firebaseManager = window.firebaseManager) {
        this.firebaseManager = firebaseManager;
        this.initServices();
    }

    /**
     * Initialize service references
     */
    initServices() {
        const fm = this.firebaseManager || window.firebaseManager;
        this.kinopoiskService = fm?.getKinopoiskService?.() || (typeof KinopoiskService !== 'undefined' ? new KinopoiskService() : null);
        this.tmdbService = typeof TMDBService !== 'undefined' ? new TMDBService() : null;
        this.homeCacheService = fm?.getHomeCacheService?.() || (typeof HomeCacheService !== 'undefined' ? new HomeCacheService(fm) : null);
        this.homeMovieNavigationService = typeof HomeMovieNavigationService !== 'undefined'
            ? new HomeMovieNavigationService({ kinopoiskService: this.kinopoiskService })
            : null;
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
     * Fetch discovery showcase data (Featured, Films, Series, Cartoons, Shows)
     * @returns {Promise<Object>}
     */
    async fetchDiscoveryShowcase() {
        this.initServices();

        if (!this.homeCacheService) {
            throw new Error('Required discovery service (HomeCacheService) is not available');
        }

        const result = await this.homeCacheService.getDiscoveryData(null, { tmdbOnly: true });
        const data = result?.data || {};

        const animeList = Array.isArray(data.anime) ? data.anime : (Array.isArray(data.shows) ? data.shows : []);

        return {
            featured: Array.isArray(data.featured) ? data.featured : [],
            films: Array.isArray(data.films) ? data.films : [],
            series: Array.isArray(data.series) ? data.series : [],
            cartoons: Array.isArray(data.cartoons) ? data.cartoons : [],
            anime: animeList,
            shows: animeList,
            isStale: !!result?.isStale
        };
    }

    async resolveHomeMovie(item) {
        this.initServices();
        return this.homeMovieNavigationService?.resolve(item) || null;
    }

    /**
     * Fetch personal tier data (Watching and Watchlist/Plan to watch)
     * @param {string|Object} [userParam] - User ID string or User object
     * @returns {Promise<Object>}
     */
    async fetchPersonalData(userParam = null) {
        this.initServices();
        let uid = null;
        if (typeof userParam === 'string') {
            uid = userParam;
        } else if (userParam && userParam.uid) {
            uid = userParam.uid;
        } else if (userParam === null || userParam === undefined) {
            const currentUser = this.getCurrentUser();
            uid = currentUser?.uid || null;
        }

        if (!uid) {
            return {
                isAuthenticated: false,
                watching: [],
                watchingTotal: 0,
                watchlist: [],
                watchlistTotal: 0
            };
        }

        if (!this.favoriteService) {
            this.initServices();
        }

        const [watchingRes, watchlistRes] = await Promise.allSettled([
            this.favoriteService ? this.favoriteService.getFavorites(uid, 'watching') : Promise.resolve([]),
            this.favoriteService ? this.favoriteService.getFavorites(uid, 'plan_to_watch') : Promise.resolve([])
        ]);

        const watchingAll = (watchingRes.status === 'fulfilled' && Array.isArray(watchingRes.value)) ? watchingRes.value : [];
        const watchlistAll = (watchlistRes.status === 'fulfilled' && Array.isArray(watchlistRes.value)) ? watchlistRes.value : [];

        const watching = watchingAll.slice(0, 6);
        const watchlist = watchlistAll.slice(0, 6);

        return {
            isAuthenticated: true,
            userId: uid,
            watching,
            watchingTotal: watchingAll.length,
            watchlist,
            watchlistTotal: watchlistAll.length,
            hasContent: watching.length > 0 || watchlist.length > 0
        };
    }

    /**
     * Fetch dashboard data (User Statistics and Community Top)
     * @param {string|Object|boolean} [userParam] - User ID string, User object, or false if logged out
     * @returns {Promise<Object>}
     */
    async fetchDashboardData(userParam = null) {
        this.initServices();
        let uid = null;
        if (typeof userParam === 'string') {
            uid = userParam;
        } else if (userParam && userParam.uid) {
            uid = userParam.uid;
        } else if (userParam === null || userParam === undefined) {
            const currentUser = this.getCurrentUser();
            uid = currentUser?.uid || null;
        }

        if (!uid) {
            return {
                isAuthenticated: false,
                stats: null,
                communityTop: []
            };
        }

        const [statsRes, communityRes] = await Promise.allSettled([
            this.profileService ? this.profileService.getUserStatistics(uid) : Promise.resolve(null),
            this.movieCacheService ? this.movieCacheService.getMoviesByAvgRating({ sortBy: 'avgRating', sortDir: 'desc', limit: 4 }) : Promise.resolve([])
        ]);

        const rawStats = (statsRes.status === 'fulfilled') ? statsRes.value : null;
        const rawCommunity = (communityRes.status === 'fulfilled') ? communityRes.value : [];
        const communityTop = Array.isArray(rawCommunity) ? rawCommunity : (rawCommunity?.movies || []);

        return {
            isAuthenticated: true,
            userId: uid,
            stats: rawStats ? {
                totalRatings: rawStats.totalRatings || 0,
                averageRating: rawStats.averageRating ? Number(rawStats.averageRating).toFixed(1) : '—',
                watchingCount: rawStats.favoritesCount || 0,
                watchlistCount: rawStats.watchlistCount || 0
            } : null,
            communityTop
        };
    }
}

if (typeof window !== 'undefined') {
    window.HomeDataController = HomeDataController;
}
