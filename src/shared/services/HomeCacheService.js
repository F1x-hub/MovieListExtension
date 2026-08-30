/**
 * HomeCacheService - Manages discovery showcase data caching for home.html
 * Implements TMDB candidate discovery with strict semantic classification and
 * Stale-While-Revalidate caching in chrome.storage.local. Kinopoisk identity
 * resolution is deliberately deferred until a Home card is opened.
 * 
 * INVARIANT: Every card entering the cache/DOM MUST have a valid TMDB identity.
 * A Kinopoisk ID is optional until the user opens the card.
 * 
 * SEMANTIC CONTRACT:
 *  - featured: Mixed trending showcase (up to 10)
 *  - films:    Live-action movies (media_type = movie AND !animation)
 *  - series:   Live-action TV series (media_type = tv AND !animation)
 *  - cartoons: Non-Japanese animation (isAnimation AND !isAnime) [movies & TV]
 *  - anime:    Japanese animation (isAnimation AND isAnime) [movies & TV]
 */

const _ClassifierModule = (typeof require !== 'undefined')
    ? (() => { try { return require('../utils/MediaClassifier.js'); } catch { return null; } })()
    : (typeof window !== 'undefined' ? window.MediaClassifier : (typeof globalThis !== 'undefined' ? globalThis.MediaClassifier : null));

const SECTION_TARGETS = Object.freeze({
    featured: 10,
    films: 12,
    series: 12,
    cartoons: 12,
    anime: 12,
    shows: 12 // backward-compatibility alias for anime
});

class HomeCacheService {
    static SECTION_TARGETS = SECTION_TARGETS;

    /**
     * @param {Object} [firebaseManager] - Instance of FirebaseManager
     * @param {Object} [idMappingService] - Instance of IdMappingService
     * @param {Object} [tmdbService] - Instance of TMDBService
     */
    constructor(firebaseManager = null, idMappingService = null, tmdbService = null) {
        this.firebaseManager = firebaseManager;
        this.idMappingService = idMappingService || (firebaseManager?.getIdMappingService?.()) || (typeof IdMappingService !== 'undefined' ? new IdMappingService() : null);
        this.tmdbService = tmdbService || (firebaseManager?.getTMDBService?.()) || (typeof TMDBService !== 'undefined' ? new TMDBService() : null);
        
        this.CACHE_KEY = 'home_discovery_cache_v10';
        // v12 preserves English/original titles needed by IMDb HTML search.
        this.TMDB_ONLY_CACHE_KEY = 'home_discovery_cache_v12';
        this.CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours Content Cache TTL
        this.isRefreshing = false;
    }

    /**
     * Helper to classify media items using centralized MediaClassifier.
     * @param {Object} item
     * @returns {'film'|'series'|'cartoon'|'anime'|'unknown'}
     */
    classifyMedia(item) {
        const classifier = _ClassifierModule || (typeof window !== 'undefined' ? window.MediaClassifier : (typeof globalThis !== 'undefined' ? globalThis.MediaClassifier : null));
        if (classifier && typeof classifier.classifyHomeMedia === 'function') {
            return classifier.classifyHomeMedia(item);
        }
        return 'unknown';
    }

    /**
     * Unified Category Gate Helper.
     * Checks whether a candidate strictly belongs to the requested section.
     * @param {Object} item
     * @param {'films'|'series'|'cartoons'|'anime'|'featured'} section
     * @returns {boolean}
     */
    isCandidateForSection(item, section) {
        if (!item) return false;
        const classifier = _ClassifierModule || (typeof window !== 'undefined' ? window.MediaClassifier : (typeof globalThis !== 'undefined' ? globalThis.MediaClassifier : null));
        if (classifier && typeof classifier.isCandidateForSection === 'function') {
            return classifier.isCandidateForSection(item, section);
        }

        const cat = this.classifyMedia(item);
        if (section === 'featured') return true;
        if (section === 'films') return cat === 'film';
        if (section === 'series') return cat === 'series';
        if (section === 'cartoons') return cat === 'cartoon';
        if (section === 'anime') return cat === 'anime';
        return false;
    }

    /**
     * Determine if a discovery payload is usable and healthy enough to be cached.
     * Prevents locking the UI into an empty or severely corrupted state for 4 hours.
     * @param {Object} payload
     * @returns {boolean}
     */
    _isUsableDiscoveryPayload(payload) {
        if (!payload || typeof payload !== 'object') return false;

        const featured = Array.isArray(payload.featured) ? payload.featured : [];
        const films = Array.isArray(payload.films) ? payload.films : [];
        const series = Array.isArray(payload.series) ? payload.series : [];
        const cartoons = Array.isArray(payload.cartoons) ? payload.cartoons : [];
        const anime = Array.isArray(payload.anime) ? payload.anime : (Array.isArray(payload.shows) ? payload.shows : []);

        const sections = [featured, films, series, cartoons, anime];
        const totalCards = sections.reduce((sum, sec) => sum + sec.length, 0);

        // Section counts: at least 3 cards to be considered populated
        const populatedSections = sections.filter(sec => sec.length >= 3).length;

        // Requirement: At least 15 total cards AND at least 3 well-populated sections
        return totalCards >= 15 && populatedSections >= 3;
    }

    /**
     * Get discovery showcase data (Featured, Films, Series, Cartoons, Anime).
     * Returns cached data immediately if available.
     * Triggers non-blocking background refresh if cache is expired or missing.
     * @param {Object} kinopoiskService - Instance of KinopoiskService
     * @param {Object} options - { forceRefresh: boolean }
     * @returns {Promise<{ data: Object, isFromCache: boolean, isStale?: boolean }>}
     */
    async getDiscoveryData(kinopoiskService, options = {}) {
        if (options.tmdbOnly) {
            return this.getTmdbOnlyDiscoveryData(options);
        }

        const legacyCacheKey = 'home_discovery_cache_v10';

        if (!kinopoiskService) {
            throw new Error('KinopoiskService instance is required for HomeCacheService');
        }

        if (options.forceRefresh) {
            const freshData = await this.refreshDiscoveryData(kinopoiskService, { cacheKey: legacyCacheKey });
            return { data: freshData, isFromCache: false };
        }

        try {
            const cached = await this._getRawCache(legacyCacheKey);

            if (cached && cached.data && this._isUsableDiscoveryPayload(cached.data) && this._isCacheValid(cached.timestamp)) {
                for (const sectionName of ['featured', 'films', 'series', 'cartoons', 'anime']) {
                    const section = Array.isArray(cached.data[sectionName]) ? cached.data[sectionName] : [];
                    section.forEach(() => globalThis.quotaTracker?.track('HomeCacheService', 'cacheHit'));
                }
                console.log('[HomeCacheService] Returning valid cached discovery data');
                return { data: cached.data, isFromCache: true };
            }

            if (cached && cached.data && this._isUsableDiscoveryPayload(cached.data)) {
                for (const sectionName of ['featured', 'films', 'series', 'cartoons', 'anime']) {
                    const section = Array.isArray(cached.data[sectionName]) ? cached.data[sectionName] : [];
                    section.forEach(() => globalThis.quotaTracker?.track('HomeCacheService', 'cacheHit'));
                }
                console.log('[HomeCacheService] Cache stale; returning cached data and triggering background refresh');
                // Stale-While-Revalidate: Return immediately, refresh in background
                this.refreshDiscoveryData(kinopoiskService, { cacheKey: legacyCacheKey }).catch(err => {
                    console.warn('[HomeCacheService] Background refresh failed:', err);
                });
                return { data: cached.data, isFromCache: true, isStale: true };
            }

            // Cold cache or unusable cache: must await initial fetch
            console.log('[HomeCacheService] Cold or unusable cache; fetching fresh discovery data');
            const freshData = await this.refreshDiscoveryData(kinopoiskService, { cacheKey: legacyCacheKey });
            return { data: freshData, isFromCache: false };
        } catch (error) {
            console.error('[HomeCacheService] Error in getDiscoveryData:', error);
            // Attempt direct fetch on cache failure
            const directData = await this.refreshDiscoveryData(kinopoiskService, { cacheKey: legacyCacheKey });
            return { data: directData, isFromCache: false };
        }
    }

    async getTmdbOnlyDiscoveryData() {
        try {
            const cached = await this._getRawCache(this.TMDB_ONLY_CACHE_KEY);

            if (cached && cached.data && this._isUsableDiscoveryPayload(cached.data) && this._isCacheValid(cached.timestamp)) {
                this._trackCachedSections(cached.data);
                console.log('[HomeCacheService] Returning valid TMDB-only discovery data');
                return { data: cached.data, isFromCache: true };
            }

            if (cached && cached.data && this._isUsableDiscoveryPayload(cached.data)) {
                this._trackCachedSections(cached.data);
                console.log('[HomeCacheService] TMDB-only cache stale; refreshing in background');
                this.refreshTmdbOnlyDiscoveryData().catch(error => {
                    console.warn('[HomeCacheService] Background TMDB-only refresh failed:', error);
                });
                return { data: cached.data, isFromCache: true, isStale: true };
            }

            console.log('[HomeCacheService] Cold cache; fetching TMDB-only discovery data');
            return { data: await this.refreshTmdbOnlyDiscoveryData(), isFromCache: false };
        } catch (error) {
            console.error('[HomeCacheService] Error loading TMDB-only discovery data:', error);
            throw error;
        }
    }

    _trackCachedSections(data) {
        for (const sectionName of ['featured', 'films', 'series', 'cartoons', 'anime']) {
            const section = Array.isArray(data?.[sectionName]) ? data[sectionName] : [];
            section.forEach(() => globalThis.quotaTracker?.track('HomeCacheService', 'cacheHit'));
        }
    }

    async refreshTmdbOnlyDiscoveryData() {
        if (this.isRefreshing) {
            while (this.isRefreshing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            const currentCache = await this._getRawCache(this.TMDB_ONLY_CACHE_KEY);
            return currentCache?.data || { featured: [], films: [], series: [], cartoons: [], anime: [], shows: [] };
        }

        this.isRefreshing = true;
        try {
            const tmdb = this.tmdbService || (typeof TMDBService !== 'undefined' ? new TMDBService() : null);
            if (!tmdb || typeof tmdb.isConfigured !== 'function' || !tmdb.isConfigured()) {
                throw new Error('TMDB service is not configured for Home discovery');
            }

            const [feat1, feat2, film1, film2, ser1, ser2, cart1, cart2, ani1, ani2] = await Promise.allSettled([
                tmdb.getTrendingMovies?.('week', 1) || Promise.resolve([]),
                tmdb.getTrendingMovies?.('week', 2) || Promise.resolve([]),
                tmdb.getNowPlayingMovies?.(1) || Promise.resolve([]),
                tmdb.getNowPlayingMovies?.(2) || Promise.resolve([]),
                tmdb.getTrendingTvShows?.(1) || Promise.resolve([]),
                tmdb.getTrendingTvShows?.(2) || Promise.resolve([]),
                tmdb.getFreshAnimation?.(1) || Promise.resolve([]),
                tmdb.getFreshAnimation?.(2) || Promise.resolve([]),
                tmdb.getFreshAnime?.(1) || Promise.resolve([]),
                tmdb.getFreshAnime?.(2) || Promise.resolve([])
            ]);

            const mergeCandidates = (...results) => {
                const seen = new Set();
                const merged = [];
                for (const result of results) {
                    const items = result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : [];
                    for (const item of items) {
                        if (item?.adult === true) continue;
                        const tmdbId = Number(item?.tmdbId || item?.id);
                        if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0 || seen.has(tmdbId)) continue;
                        seen.add(tmdbId);
                        merged.push({ ...item, tmdbId });
                    }
                }
                return merged;
            };

            const featuredCandidates = mergeCandidates(feat1, feat2);
            const filmsCandidates = mergeCandidates(film1, film2).map(item => ({ ...item, mediaType: 'movie' }));
            const seriesCandidates = mergeCandidates(ser1, ser2).map(item => ({ ...item, mediaType: 'tv' }));
            const cartoonsCandidates = mergeCandidates(cart1, cart2).map(item => ({
                ...item,
                mediaType: item.mediaType || 'movie',
                type: 'cartoon'
            }));
            const animeCandidates = mergeCandidates(ani1, ani2).map(item => ({
                ...item,
                mediaType: item.mediaType || 'tv',
                type: 'anime'
            }));

            const currentYear = new Date().getFullYear();
            const minFilmsReleaseDate = `${currentYear - 2}-01-01`;
            const isFreshMovie = item => {
                if (item?.releaseDate) return item.releaseDate >= minFilmsReleaseDate;
                if (item?.release_date) return item.release_date >= minFilmsReleaseDate;
                if (item?.year) return Number(item.year) >= currentYear - 2;
                return true;
            };

            const toCard = (item, defaultType, section) => {
                const tmdbId = Number(item?.tmdbId || item?.id);
                if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return null;
                const mediaType = item.mediaType || (defaultType === 'movie' ? 'movie' : 'tv');
                return {
                    kinopoiskId: null,
                    tmdbId,
                    name: item.name || item.title || '',
                    alternativeName: item.alternativeName || item.originalTitle || item.original_title || item.original_name || '',
                    englishTitle: item.englishTitle || item.nameEn || item.englishName || item.originalTitle || item.original_title || item.original_name || item.alternativeName || '',
                    posterUrl: item.posterUrl || item.posterPath || item.poster || '',
                    backdrop: item.backdrop || item.backdropUrl || '',
                    year: item.year || (item.releaseDate || item.release_date || '').slice?.(0, 4) || null,
                    releaseDate: item.releaseDate || item.release_date || null,
                    description: item.description || item.overview || '',
                    kpRating: null,
                    ratingTmdb: item.ratingTmdb || item.vote_average || item.rating || null,
                    imdbRating: item.imdbRating || null,
                    voteCount: item.voteCount || item.vote_count || 0,
                    genreIds: item.genreIds || item.genre_ids || [],
                    originalLanguage: item.originalLanguage || item.original_language || '',
                    originCountry: item.originCountry || item.origin_country || [],
                    mediaType,
                    type: item.type || defaultType,
                    section,
                    isTmdbOnly: true,
                    source: 'tmdb-only'
                };
            };

            const usedTmdbIds = new Set();
            const takeSection = (candidates, section, defaultType, predicate = () => true) => {
                const result = [];
                for (const item of candidates) {
                    if (result.length >= SECTION_TARGETS[section]) break;
                    if (!predicate(item) || !this.isCandidateForSection(item, section)) continue;
                    if (usedTmdbIds.has(item.tmdbId)) continue;
                    const card = toCard(item, defaultType, section);
                    if (!card) continue;
                    usedTmdbIds.add(item.tmdbId);
                    result.push(card);
                }
                return result;
            };

            const featured = [];
            for (const item of featuredCandidates) {
                if (featured.length >= SECTION_TARGETS.featured) break;
                if (!this.isCandidateForSection(item, 'featured')) continue;
                const card = toCard(item, item.mediaType || 'movie', 'featured');
                if (!card || usedTmdbIds.has(card.tmdbId)) continue;
                usedTmdbIds.add(card.tmdbId);
                featured.push(card);
            }

            let films = takeSection(filmsCandidates, 'films', 'movie', isFreshMovie);
            if (films.length < SECTION_TARGETS.films && typeof tmdb.getFreshMovies === 'function') {
                for (let page = 1; page <= 3 && films.length < SECTION_TARGETS.films; page++) {
                    const extra = await tmdb.getFreshMovies(page, { withoutGenres: 16, minReleaseDate: minFilmsReleaseDate });
                    const extraCandidates = Array.isArray(extra) ? extra.map(item => ({ ...item, tmdbId: Number(item.tmdbId || item.id), mediaType: 'movie' })) : [];
                    films.push(...takeSection(extraCandidates, 'films', 'movie', isFreshMovie));
                }
            }

            const series = takeSection(seriesCandidates, 'series', 'tv-series');
            const cartoons = takeSection(cartoonsCandidates, 'cartoons', 'cartoon');
            const anime = takeSection(animeCandidates, 'anime', 'anime');
            const discoveryPayload = { featured, films, series, cartoons, anime, shows: anime };

            if (!this._isUsableDiscoveryPayload(discoveryPayload)) {
                throw new Error('TMDB-only discovery returned an unusable payload');
            }

            await this._saveRawCache(discoveryPayload, this.TMDB_ONLY_CACHE_KEY);
            console.log('[HomeCacheService] TMDB-only discovery refresh completed:', {
                featured: featured.length,
                films: films.length,
                series: series.length,
                cartoons: cartoons.length,
                anime: anime.length
            });
            return discoveryPayload;
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * Fetch fresh discovery data via TMDB Candidate Pool -> Semantic Classification -> Batch IdMapping -> Category-Aware KP Supplement.
     * @param {Object} kinopoiskService - KinopoiskService instance
     * @returns {Promise<Object>}
     */
    async refreshDiscoveryData(kinopoiskService, options = {}) {
        const cacheKey = options.cacheKey || 'home_discovery_cache_v10';
        if (this.isRefreshing) {
            console.log('[HomeCacheService] Refresh already in progress; waiting for existing operation');
            while (this.isRefreshing) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            const currentCache = await this._getRawCache(cacheKey);
            if (currentCache && currentCache.data) {
                return currentCache.data;
            }
        }

        this.isRefreshing = true;

        try {
            console.log('[HomeCacheService] Starting Semantic Home Discovery & batch mapping pipeline...');

            const tmdb = this.tmdbService || (typeof TMDBService !== 'undefined' ? new TMDBService() : null);
            const mappingService = this.idMappingService || (typeof IdMappingService !== 'undefined' ? new IdMappingService(kinopoiskService) : null);
            const isTmdbReady = tmdb && typeof tmdb.isConfigured === 'function' && tmdb.isConfigured();

            const currentYear = new Date().getFullYear();
            const minFilmsReleaseDate = `${currentYear - 2}-01-01`;

            let featuredCandidates = [];
            let filmsCandidates = [];
            let seriesCandidates = [];
            let cartoonsCandidates = [];
            let animeCandidates = [];

            // Step 1: Collect Category Candidate Pools from TMDB with semantic parameter filtering
            if (isTmdbReady) {
                console.log('[HomeCacheService] Fetching TMDB candidate pools for all discovery sections...');
                const [feat1, feat2, film1, film2, ser1, ser2, cart1, cart2, ani1, ani2] = await Promise.allSettled([
                    typeof tmdb.getTrendingMovies === 'function' ? tmdb.getTrendingMovies('week', 1) : Promise.resolve([]),
                    typeof tmdb.getTrendingMovies === 'function' ? tmdb.getTrendingMovies('week', 2) : Promise.resolve([]),
                    typeof tmdb.getNowPlayingMovies === 'function' ? tmdb.getNowPlayingMovies(1) : Promise.resolve([]),
                    typeof tmdb.getNowPlayingMovies === 'function' ? tmdb.getNowPlayingMovies(2) : Promise.resolve([]),
                    typeof tmdb.getTrendingTvShows === 'function' ? tmdb.getTrendingTvShows(1) : Promise.resolve([]),
                    typeof tmdb.getTrendingTvShows === 'function' ? tmdb.getTrendingTvShows(2) : Promise.resolve([]),
                    typeof tmdb.getFreshAnimation === 'function' ? tmdb.getFreshAnimation(1) : Promise.resolve([]),
                    typeof tmdb.getFreshAnimation === 'function' ? tmdb.getFreshAnimation(2) : Promise.resolve([]),
                    typeof tmdb.getFreshAnime === 'function' ? tmdb.getFreshAnime(1) : Promise.resolve([]),
                    typeof tmdb.getFreshAnime === 'function' ? tmdb.getFreshAnime(2) : Promise.resolve([])
                ]);

                const mergeCandidates = (...results) => {
                    const seen = new Set();
                    const result = [];
                    for (const res of results) {
                        const list = res.status === 'fulfilled' && Array.isArray(res.value) ? res.value : [];
                        for (const item of list) {
                            // Defensive Adult Exclusion Gate
                            if (item?.adult === true) continue;
                            const id = item?.tmdbId || item?.id;
                            if (id && !seen.has(id)) {
                                seen.add(id);
                                result.push(item);
                            }
                        }
                    }
                    return result;
                };

                featuredCandidates = mergeCandidates(feat1, feat2);
                filmsCandidates = mergeCandidates(film1, film2);
                seriesCandidates = mergeCandidates(ser1, ser2);
                cartoonsCandidates = mergeCandidates(cart1, cart2);
                animeCandidates = mergeCandidates(ani1, ani2);
            }

            // Freshness filter for Films (reusable across candidate ranking and resolution)
            const isFreshMovie = (card) => {
                if (card?.releaseDate) return card.releaseDate >= minFilmsReleaseDate;
                if (card?.release_date) return card.release_date >= minFilmsReleaseDate;
                if (card?.year) return card.year >= currentYear - 2;
                return true;
            };

            // Helper to get true semantic section for queue and Home candidates
            const getSemanticSection = (c, defaultSec) => {
                if (typeof MediaClassifier !== 'undefined') {
                    if (typeof MediaClassifier.classifyHomeMedia === 'function') {
                        const cat = MediaClassifier.classifyHomeMedia(c);
                        if (cat === 'anime') return 'anime';
                        if (cat === 'cartoon') return 'cartoons';
                        if (cat === 'series') return 'series';
                        if (cat === 'film') return 'films';
                    } else if (typeof MediaClassifier.isAnime === 'function' && MediaClassifier.isAnime(c)) {
                        return 'anime';
                    }
                }
                return defaultSec;
            };

            // Step 2: Compute pre-mapping Product Ranks for each section
            // 1) Featured Top 10 headliners (capture TMDB keys for Films exclusion)
            const featuredTmdbKeys = new Set(
                featuredCandidates.slice(0, 10).map(c => `movie:${Number(c.tmdbId || c.id)}`)
            );

            // 2) Films: Live-action movies, fresh (<= 2 years), excluding Featured
            let filmProdRank = 1;
            const filmsWithRanks = filmsCandidates.map((c, i) => {
                const tmdbId = Number(c.tmdbId || c.id);
                const tmdbKey = `movie:${tmdbId}`;
                const isFilm = this.isCandidateForSection(c, 'films');
                const fresh = isFreshMovie(c);
                const inFeatured = featuredTmdbKeys.has(tmdbKey);
                let productRank = null;
                if (isFilm && fresh && !inFeatured) {
                    productRank = filmProdRank++;
                }
                return {
                    ...c,
                    tmdbId,
                    mediaType: 'movie',
                    section: getSemanticSection(c, 'films'),
                    tmdbRank: i + 1,
                    productRank
                };
            });

            // 3) Series: Live-action series (non-animation)
            let seriesProdRank = 1;
            const seriesWithRanks = seriesCandidates.map((c, i) => {
                const tmdbId = Number(c.tmdbId || c.id);
                const isSeries = this.isCandidateForSection(c, 'series');
                let productRank = null;
                if (isSeries) {
                    productRank = seriesProdRank++;
                }
                return {
                    ...c,
                    tmdbId,
                    mediaType: 'tv',
                    section: getSemanticSection(c, 'series'),
                    tmdbRank: i + 1,
                    productRank
                };
            });

            // 4) Cartoons: Non-Japanese animations
            let cartoonProdRank = 1;
            const cartoonsWithRanks = cartoonsCandidates.map((c, i) => {
                const tmdbId = Number(c.tmdbId || c.id);
                const isCartoon = this.isCandidateForSection(c, 'cartoons');
                let productRank = null;
                if (isCartoon) {
                    productRank = cartoonProdRank++;
                }
                return {
                    ...c,
                    tmdbId,
                    mediaType: c.mediaType || 'movie',
                    type: 'cartoon',
                    section: getSemanticSection(c, 'cartoons'),
                    tmdbRank: i + 1,
                    productRank
                };
            });

            // 5) Anime: Japanese animations
            let animeProdRank = 1;
            const animeWithRanks = animeCandidates.map((c, i) => {
                const tmdbId = Number(c.tmdbId || c.id);
                const isAnime = this.isCandidateForSection(c, 'anime');
                let productRank = null;
                if (isAnime) {
                    productRank = animeProdRank++;
                }
                return {
                    ...c,
                    tmdbId,
                    mediaType: c.mediaType || 'tv',
                    type: 'anime',
                    section: getSemanticSection(c, 'anime'),
                    tmdbRank: i + 1,
                    productRank
                };
            });

            // Featured candidates with ranks
            const featuredWithRanks = featuredCandidates.map((c, i) => {
                const tmdbId = Number(c.tmdbId || c.id);
                return {
                    ...c,
                    tmdbId,
                    mediaType: c.mediaType || 'movie',
                    section: i < 10 ? 'featured' : getSemanticSection(c, 'films'),
                    tmdbRank: i + 1,
                    productRank: i < 10 ? i + 1 : null
                };
            });

            // Step 2.1: Assemble all unique TMDB candidates for unified batch resolution with section, tmdbRank & productRank metadata
            const allCandidates = [
                ...featuredWithRanks,
                ...filmsWithRanks,
                ...seriesWithRanks,
                ...cartoonsWithRanks,
                ...animeWithRanks
            ].filter(c => !c.adult);

            let mappingResults = new Map();
            if (allCandidates.length > 0 && mappingService) {
                console.log(`[HomeCacheService] Resolving ${allCandidates.length} TMDB candidates via IdMappingService...`);
                mappingResults = await mappingService.resolveBatch(allCandidates, { kinopoiskService });
            }

            // Identity metrics tracking for Home mapping observability
            const identityMetrics = {
                verifiedFull: 0,
                verifiedDraftRecovered: 0,
                unverifiedRejected: 0,
                trueNotFound: 0
            };

            // Helper to enrich candidates against mappingResults
            const buildResolvedSection = (candidates, defaultType = 'movie') => {
                const resolved = [];
                const seenKpIds = new Set();

                for (const item of candidates) {
                    const tmdbId = Number(item.tmdbId || item.id);
                    const mediaType = mappingService ? mappingService.normalizeMediaType(item.mediaType || item.type || defaultType) : (defaultType === 'movie' ? 'movie' : 'tv');
                    const key = mappingService ? mappingService.buildKey(mediaType, tmdbId) : `${mediaType}:${tmdbId}`;
                    const mapping = mappingResults.get(key);

                    if (mapping) {
                        if (mapping.status === 'not-found') {
                            identityMetrics.trueNotFound++;
                            continue;
                        }
                        if (mapping.status !== 'resolved' || !mapping.kinopoiskId) {
                            continue;
                        }

                        // Identity verification gate:
                        // Only VERIFIED or legacy resolved mappings are accepted on Home
                        if (mapping.identityStatus && mapping.identityStatus !== 'VERIFIED') {
                            identityMetrics.unverifiedRejected++;
                            continue;
                        }

                        const kpId = Number(mapping.kinopoiskId);
                        if (Number.isInteger(kpId) && kpId > 0 && !seenKpIds.has(kpId)) {
                            seenKpIds.add(kpId);

                            if (mapping.metadataQuality === 'DRAFT' || mapping.isDraft) {
                                identityMetrics.verifiedDraftRecovered++;
                            } else {
                                identityMetrics.verifiedFull++;
                            }

                            resolved.push({
                                kinopoiskId: kpId,
                                tmdbId: item.tmdbId || null,
                                name: item.name || item.title || '',
                                alternativeName: item.alternativeName || item.originalTitle || item.original_title || item.original_name || '',
                                englishTitle: item.englishTitle || item.nameEn || item.englishName || item.originalTitle || item.original_title || item.original_name || item.alternativeName || '',
                                posterUrl: item.posterUrl || '',
                                backdrop: item.backdrop || '',
                                year: item.year || null,
                                releaseDate: item.releaseDate || null,
                                description: item.description || '',
                                kpRating: item.kpRating || null,
                                ratingTmdb: item.ratingTmdb || null,
                                imdbRating: item.imdbRating || null,
                                voteCount: item.voteCount || 0,
                                genreIds: item.genreIds || item.genre_ids || [],
                                originalLanguage: item.originalLanguage || item.original_language || '',
                                originCountry: item.originCountry || item.origin_country || [],
                                mediaType: item.mediaType || mediaType,
                                type: item.type || defaultType,
                                isTmdbOnly: false,
                                source: 'tmdb'
                            });
                        }
                    }
                }
                return resolved;
            };

            // Semantic Gate tracking for diagnostic tracing
            const semanticGateTrace = {
                films: { accepted: 0, rejectedCartoon: 0, rejectedAnime: 0, rejectedUnknown: 0 },
                series: { accepted: 0, rejectedCartoon: 0, rejectedAnime: 0, rejectedUnknown: 0 },
                cartoons: { accepted: 0, rejectedNonAnim: 0, rejectedAnime: 0, rejectedUnknown: 0 },
                anime: { accepted: 0, rejectedNonAnime: 0, rejectedUnknown: 0 }
            };

            // Step 3: Category-Aware Kinopoisk direct discovery supplement ONLY for deficit
            const supplementSection = async (currentList, expectedCategory, targetCount, fetchFn, excludedKpIds = new Set()) => {
                const deficit = targetCount - currentList.length;
                if (deficit <= 0 || typeof fetchFn !== 'function') {
                    return currentList;
                }

                try {
                    const fetchLimit = Math.min(targetCount, deficit + 3);
                    const kpItems = await fetchFn(fetchLimit);

                    const seenKpIds = new Set([
                        ...currentList.map(c => Number(c?.kinopoiskId)).filter(id => Number.isInteger(id) && id > 0),
                        ...[...excludedKpIds].map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0)
                    ]);

                    const sectionKey = expectedCategory === 'film' ? 'films'
                        : (expectedCategory === 'series' ? 'series'
                        : (expectedCategory === 'cartoon' ? 'cartoons'
                        : (expectedCategory === 'anime' ? 'anime' : 'featured')));

                    for (const item of (kpItems || [])) {
                        const kpId = Number(item?.kinopoiskId);
                        if (Number.isInteger(kpId) && kpId > 0 && !seenKpIds.has(kpId)) {
                            // Ensure item has proper type fallback for category matching
                            const fallbackType = expectedCategory === 'film' ? 'movie' : (expectedCategory === 'series' ? 'tv-series' : (expectedCategory === 'cartoon' ? 'cartoon' : 'anime'));
                            const itemWithType = { ...item, type: item.type || fallbackType };

                            // Enforce strict category gate on supplement items (reject 'unknown' or mismatched categories)
                            if (expectedCategory && !this.isCandidateForSection(itemWithType, sectionKey)) {
                                continue;
                            }

                            seenKpIds.add(kpId);
                            globalThis.quotaTracker?.track('HomeCacheService', 'network');
                            currentList.push({
                                ...itemWithType,
                                kinopoiskId: kpId,
                                source: 'kinopoisk-supplement'
                            });
                            if (currentList.length >= targetCount) {
                                break;
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`[HomeCacheService] Supplement for ${expectedCategory} failed:`, e.message);
                }

                return currentList.slice(0, targetCount);
            };

            // Track used Kinopoisk IDs across dedicated sections to guarantee cross-section isolation
            const usedKpIds = new Set();

            // 1. Featured Section (Trending headliners - up to 10)
            const allResolvedFeatured = buildResolvedSection(featuredCandidates, 'movie');
            let featured = [];
            const featuredKpIds = new Set();
            for (const card of allResolvedFeatured) {
                if (!featuredKpIds.has(card.kinopoiskId)) {
                    featuredKpIds.add(card.kinopoiskId);
                    featured.push(card);
                    if (featured.length >= SECTION_TARGETS.featured) break;
                }
            }

            if (featured.length < SECTION_TARGETS.featured && typeof kinopoiskService.getFeaturedMovies === 'function') {
                featured = await supplementSection(
                    featured,
                    null, // Featured can be mixed
                    SECTION_TARGETS.featured,
                    (limit) => kinopoiskService.getFeaturedMovies(limit, { forceKpOnly: true })
                );
                featured.forEach(c => featuredKpIds.add(c.kinopoiskId));
            }

            // 2. Films Section: Strictly live-action movies, fresh, excluding Featured & usedKpIds
            const allResolvedFilms = buildResolvedSection(filmsCandidates, 'movie');
            let films = [];
            for (const card of allResolvedFilms) {
                const cat = this.classifyMedia(card);
                if (cat === 'cartoon') semanticGateTrace.films.rejectedCartoon++;
                else if (cat === 'anime') semanticGateTrace.films.rejectedAnime++;
                else if (cat === 'unknown') semanticGateTrace.films.rejectedUnknown++;

                if (this.isCandidateForSection(card, 'films') && isFreshMovie(card) && !featuredKpIds.has(card.kinopoiskId) && !usedKpIds.has(card.kinopoiskId)) {
                    usedKpIds.add(card.kinopoiskId);
                    films.push(card);
                    semanticGateTrace.films.accepted++;
                    if (films.length >= SECTION_TARGETS.films) break;
                }
            }

            // Fresh TMDB discover/movie fallback for Films deficit
            const MAX_TMDB_DISCOVER_PAGES = 3;
            let currentDiscoverPage = 1;
            while (films.length < SECTION_TARGETS.films && currentDiscoverPage <= MAX_TMDB_DISCOVER_PAGES && tmdb && typeof tmdb.getFreshMovies === 'function') {
                try {
                    const nextCandidates = await tmdb.getFreshMovies(currentDiscoverPage, {
                        withoutGenres: 16,
                        minReleaseDate: minFilmsReleaseDate
                    });
                    if (!Array.isArray(nextCandidates) || nextCandidates.length === 0) break;

                    const existingTmdbIds = new Set(films.map(f => f.tmdbId).filter(Boolean));
                    const unmapped = nextCandidates.filter(c => c.tmdbId && !existingTmdbIds.has(c.tmdbId));
                    if (unmapped.length === 0) {
                        currentDiscoverPage++;
                        continue;
                    }

                    const movieCandidates = unmapped.map(c => ({ ...c, mediaType: 'movie' }));
                    const nextMappingResults = mappingService ? await mappingService.resolveBatch(movieCandidates, { kinopoiskService }) : new Map();

                    for (const item of movieCandidates) {
                        if (!this.isCandidateForSection(item, 'films') || !isFreshMovie(item)) continue;

                        const mediaType = mappingService ? mappingService.normalizeMediaType(item.mediaType || 'movie') : 'movie';
                        const key = mappingService ? mappingService.buildKey(mediaType, item.tmdbId) : `${mediaType}:${item.tmdbId}`;
                        const mapping = nextMappingResults.get(key);

                        if (mapping && mapping.status === 'resolved' && mapping.kinopoiskId) {
                            const kpId = Number(mapping.kinopoiskId);
                            if (Number.isInteger(kpId) && kpId > 0 && !featuredKpIds.has(kpId) && !usedKpIds.has(kpId)) {
                                const cardObj = {
                                    kinopoiskId: kpId,
                                    tmdbId: item.tmdbId || null,
                                    name: item.name || item.title || '',
                                    alternativeName: item.alternativeName || item.originalTitle || item.original_title || item.original_name || '',
                                    englishTitle: item.englishTitle || item.nameEn || item.englishName || item.originalTitle || item.original_title || item.original_name || item.alternativeName || '',
                                    posterUrl: item.posterUrl || '',
                                    backdrop: item.backdrop || '',
                                    year: item.year || null,
                                    releaseDate: item.releaseDate || null,
                                    description: item.description || '',
                                    kpRating: item.kpRating || null,
                                    ratingTmdb: item.ratingTmdb || null,
                                    imdbRating: item.imdbRating || null,
                                    voteCount: item.voteCount || 0,
                                    genreIds: item.genreIds || item.genre_ids || [],
                                    originalLanguage: item.originalLanguage || item.original_language || '',
                                    originCountry: item.originCountry || item.origin_country || [],
                                    mediaType: 'movie',
                                    type: 'movie',
                                    isTmdbOnly: false,
                                    source: 'tmdb'
                                };

                                if (this.isCandidateForSection(cardObj, 'films')) {
                                    usedKpIds.add(kpId);
                                    films.push(cardObj);
                                    semanticGateTrace.films.accepted++;
                                    if (films.length >= SECTION_TARGETS.films) break;
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`[HomeCacheService] Fresh TMDB discover fallback (page ${currentDiscoverPage}) failed:`, e.message);
                    break;
                }
                currentDiscoverPage++;
            }

            // 3. Series Section: Strictly live-action TV series
            const allResolvedSeries = buildResolvedSection(seriesCandidates, 'tv-series');
            let series = [];
            for (const card of allResolvedSeries) {
                const cat = this.classifyMedia(card);
                if (cat === 'cartoon') semanticGateTrace.series.rejectedCartoon++;
                else if (cat === 'anime') semanticGateTrace.series.rejectedAnime++;
                else if (cat === 'unknown') semanticGateTrace.series.rejectedUnknown++;

                if (this.isCandidateForSection(card, 'series') && !usedKpIds.has(card.kinopoiskId)) {
                    usedKpIds.add(card.kinopoiskId);
                    series.push(card);
                    semanticGateTrace.series.accepted++;
                    if (series.length >= SECTION_TARGETS.series) break;
                }
            }

            // 4. Cartoons Section: Non-Japanese Animation (movies + TV)
            const allResolvedCartoons = buildResolvedSection(cartoonsCandidates, 'cartoon');
            let cartoons = [];
            for (const card of allResolvedCartoons) {
                const cat = this.classifyMedia(card);
                if (cat === 'anime') semanticGateTrace.cartoons.rejectedAnime++;
                else if (cat === 'film' || cat === 'series') semanticGateTrace.cartoons.rejectedNonAnim++;
                else if (cat === 'unknown') semanticGateTrace.cartoons.rejectedUnknown++;

                if (this.isCandidateForSection(card, 'cartoons') && !usedKpIds.has(card.kinopoiskId)) {
                    usedKpIds.add(card.kinopoiskId);
                    cartoons.push(card);
                    semanticGateTrace.cartoons.accepted++;
                    if (cartoons.length >= SECTION_TARGETS.cartoons) break;
                }
            }

            // 5. Anime Section: Japanese Animation (movies + TV)
            const allResolvedAnime = buildResolvedSection(animeCandidates, 'anime');
            let anime = [];
            for (const card of allResolvedAnime) {
                const cat = this.classifyMedia(card);
                if (cat !== 'anime' && cat !== 'unknown') semanticGateTrace.anime.rejectedNonAnime++;
                else if (cat === 'unknown') semanticGateTrace.anime.rejectedUnknown++;

                if (this.isCandidateForSection(card, 'anime') && !usedKpIds.has(card.kinopoiskId)) {
                    usedKpIds.add(card.kinopoiskId);
                    anime.push(card);
                    semanticGateTrace.anime.accepted++;
                    if (anime.length >= SECTION_TARGETS.anime) break;
                }
            }

            // Kinopoisk supplement for remaining deficits (with category validation)
            if (films.length < SECTION_TARGETS.films) {
                films = await supplementSection(
                    films,
                    'film',
                    SECTION_TARGETS.films,
                    (limit) => kinopoiskService.getPopularMovies({ type: 'movie', limit, allTime: false }),
                    new Set([...featuredKpIds, ...usedKpIds])
                );
                films.forEach(c => usedKpIds.add(c.kinopoiskId));
            }
            if (series.length < SECTION_TARGETS.series) {
                series = await supplementSection(
                    series,
                    'series',
                    SECTION_TARGETS.series,
                    (limit) => kinopoiskService.getPopularMovies({ type: 'tv-series', limit, allTime: false }),
                    usedKpIds
                );
                series.forEach(c => usedKpIds.add(c.kinopoiskId));
            }
            if (cartoons.length < SECTION_TARGETS.cartoons) {
                cartoons = await supplementSection(
                    cartoons,
                    'cartoon',
                    SECTION_TARGETS.cartoons,
                    (limit) => kinopoiskService.getPopularMovies({ type: 'cartoon', limit, allTime: false }),
                    usedKpIds
                );
                cartoons.forEach(c => usedKpIds.add(c.kinopoiskId));
            }
            if (anime.length < SECTION_TARGETS.anime) {
                anime = await supplementSection(
                    anime,
                    'anime',
                    SECTION_TARGETS.anime,
                    (limit) => kinopoiskService.getPopularMovies({ type: 'anime', limit, allTime: false }),
                    usedKpIds
                );
                anime.forEach(c => usedKpIds.add(c.kinopoiskId));
            }

            console.log('[HomeCacheService] Identity Mapping Summary:', identityMetrics);
            console.log('[SemanticGate] Gate Trace Summary:', semanticGateTrace);

            // Step 4: Strict Invariant Filter: Every clickable card MUST have a positive integer kinopoiskId
            const isValidCard = (c) => Boolean(c) && Number.isInteger(Number(c.kinopoiskId)) && Number(c.kinopoiskId) > 0;

            const discoveryPayload = {
                featured: featured.filter(isValidCard),
                films: films.filter(isValidCard),
                series: series.filter(isValidCard),
                cartoons: cartoons.filter(isValidCard),
                anime: anime.filter(isValidCard),
                shows: anime.filter(isValidCard) // Backward-compatibility alias
            };

            const isUsable = this._isUsableDiscoveryPayload(discoveryPayload);

            if (isUsable) {
                await this._saveRawCache(discoveryPayload, cacheKey);
                console.log('[HomeCacheService] Semantic discovery refresh completed successfully. Resolved counts:', {
                    featured: discoveryPayload.featured.length,
                    films: discoveryPayload.films.length,
                    series: discoveryPayload.series.length,
                    cartoons: discoveryPayload.cartoons.length,
                    anime: discoveryPayload.anime.length
                });
            } else {
                console.warn('[HomeCacheService] Discovery refresh yielded unusable/unhealthy payload. Existing cache preserved.');
            }

            return discoveryPayload;
        } catch (error) {
            console.error('[HomeCacheService] Error refreshing discovery data:', error);
            throw error;
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * Invalidate and remove home discovery cache
     */
    async clearCache() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return new Promise((resolve) => {
                chrome.storage.local.remove([this.CACHE_KEY, this.TMDB_ONLY_CACHE_KEY], () => {
                    console.log('[HomeCacheService] Discovery cache cleared');
                    resolve();
                });
            });
        }
    }

    _isCacheValid(timestamp) {
        if (!timestamp) return false;
        return (Date.now() - timestamp) < this.CACHE_DURATION;
    }

    async _getRawCache(cacheKey = this.CACHE_KEY) {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            return null;
        }

        return new Promise((resolve) => {
            chrome.storage.local.get([cacheKey], (result) => {
                resolve(result ? result[cacheKey] : null);
            });
        });
    }

    async _saveRawCache(data, cacheKey = this.CACHE_KEY) {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            return;
        }

        const cacheObject = {
            timestamp: Date.now(),
            version: '3.0',
            data: data
        };

        return new Promise((resolve) => {
                chrome.storage.local.set({ [cacheKey]: cacheObject }, () => {
                resolve();
            });
        });
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export for environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HomeCacheService;
}
if (typeof window !== 'undefined') {
    window.HomeCacheService = HomeCacheService;
}
if (typeof globalThis !== 'undefined') {
    globalThis.HomeCacheService = HomeCacheService;
}
