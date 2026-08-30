const DEFAULT_TMDB_PROXY_URL = 'https://us-central1-movielistdb-13208.cloudfunctions.net/tmdbProxy';
const DEFAULT_TMDB_CONFIG = {
    BASE_URL: 'https://api.themoviedb.org/3',
    API_KEYS: [],
    API_KEY: '',
    MAX_REQUESTS_PER_SECOND: 35,
    DEFAULT_LANGUAGE: 'ru-RU',
    rotateKey() {}
};
const tmdbConfig = (typeof globalThis !== 'undefined' && globalThis.TMDB_CONFIG)
    ? globalThis.TMDB_CONFIG
    : DEFAULT_TMDB_CONFIG;

/**
 * TMDBService - Retrieves supplementary movie metadata from TMDB.
 * TMDB IDs are never used as the application's primary movie identifier.
 */
class TMDBService {
    constructor() {
        this.baseUrl = tmdbConfig.BASE_URL;
        this.defaultLanguage = tmdbConfig.DEFAULT_LANGUAGE || 'ru-RU';
        this.maxRequestsPerSecond = tmdbConfig.MAX_REQUESTS_PER_SECOND || 35;
        this.requestTimestamps = [];
        this.inFlightSeasonRequests = new Map();
        this.seasonCachePrefix = 'tmdb_season_cache_v1_';
        this.seasonCacheIndexKey = 'tmdb_season_cache_index_v1';
        this.maxCachedSeasons = 50;
        this.logoSelectionVersion = 3;
        this.catalogProviderPageCache = new Map();
        this.catalogProviderPageInFlight = new Map();
    }

    hasDirectCredentials() {
        return Array.isArray(tmdbConfig.API_KEYS) && tmdbConfig.API_KEYS.length > 0 &&
            Boolean(tmdbConfig.API_KEY);
    }

    hasProxyAccess() {
        return Boolean(tmdbConfig.TMDB_PROXY_URL || DEFAULT_TMDB_PROXY_URL);
    }

    isConfigured() {
        return this.hasDirectCredentials() || this.hasProxyAccess();
    }

    /**
     * Respect a rolling one-second request budget before issuing a TMDB request.
     * @returns {Promise<void>}
     */
    async _waitForRateLimit() {
        while (true) {
            const now = Date.now();
            this.requestTimestamps = this.requestTimestamps.filter(timestamp => now - timestamp < 1000);

            if (this.requestTimestamps.length < this.maxRequestsPerSecond) {
                this.requestTimestamps.push(now);
                return;
            }

            const oldestRequest = this.requestTimestamps[0];
            const delay = Math.max(1, 1000 - (now - oldestRequest));
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    /**
     * Fetch from TMDB with Bearer authentication, token rotation, retries, and 429 handling.
     * @param {string} url - Fully constructed TMDB API URL
     * @param {Object} options - Fetch options
     * @returns {Promise<Response>}
     */
    async _fetchViaProxy(url, options = {}) {
        const targetUrl = new URL(url);
        if (targetUrl.origin !== 'https://api.themoviedb.org' || !targetUrl.pathname.startsWith('/3/')) {
            throw new Error('TMDB proxy rejected an invalid target URL');
        }

        const proxyUrl = new URL(tmdbConfig.TMDB_PROXY_URL || DEFAULT_TMDB_PROXY_URL);
        proxyUrl.searchParams.set('url', targetUrl.toString());

        return fetch(proxyUrl.toString(), {
            ...options,
            headers: {
                Accept: 'application/json',
                ...options.headers
            }
        });
    }

    async _fetchWithRotation(url, options = {}) {
        if (!this.hasDirectCredentials()) {
            return this._fetchViaProxy(url, options);
        }

        const keyCount = tmdbConfig.API_KEYS.length;
        const maxAttempts = Math.max(keyCount, 2);
        let lastError = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await this._waitForRateLimit();

            const fetchOptions = {
                ...options,
                headers: {
                    Accept: 'application/json',
                    ...options.headers,
                    Authorization: `Bearer ${tmdbConfig.API_KEY}`
                }
            };

            let response;
            try {
                response = await fetch(url, fetchOptions);
            } catch (networkError) {
                lastError = networkError;
                console.warn(`TMDBService: network error on attempt ${attempt + 1}/${maxAttempts}:`, networkError.message);
                if (attempt < maxAttempts - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }
                break;
            }

            if (response.ok) return response;

            lastError = new Error(`TMDB HTTP error: ${response.status}`);

            if (response.status === 401 || response.status === 403) {
                console.warn(`TMDBService: authentication error ${response.status}; rotating token.`);
                tmdbConfig.rotateKey();
            } else if (response.status === 429) {
                const retryAfter = Number.parseInt(response.headers.get('Retry-After'), 10);
                const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000;
                console.warn(`TMDBService: rate limited; waiting ${delay}ms before retry.`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else if (response.status >= 500) {
                console.warn(`TMDBService: server error ${response.status}; retrying when possible.`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                return response;
            }
        }

        throw lastError || new Error('TMDB request failed');
    }

    /**
     * Find a movie or TV show through its reliable IMDb ID. This method never falls back to a title search.
     * @param {string} imdbId - IMDb title ID, e.g. tt0110912
     * @param {string|null} [mediaType=null] - Optional media type hint: 'tv' or 'movie'
     * @returns {Promise<Object|null>} TMDB data in the application's movie/series shape
     */
    async findByImdbId(imdbId, mediaType = null) {
        if (!this.isValidImdbId(imdbId)) {
            throw new Error('A valid IMDb ID is required for TMDB find-by-ID');
        }

        const params = new URLSearchParams({
            external_source: 'imdb_id',
            language: this.defaultLanguage
        });
        const response = await this._fetchWithRotation(
            `${this.baseUrl}/find/${encodeURIComponent(imdbId)}?${params}`,
            { method: 'GET' }
        );

        if (!response.ok) {
            throw new Error(`TMDB find-by-ID failed: HTTP ${response.status}`);
        }

        const result = await response.json();
        const movieResult = result.movie_results?.[0];
        const tvResult = result.tv_results?.[0];

        if (mediaType === 'tv' && tvResult?.id) {
            return this._getTvDetails(tvResult.id, imdbId);
        }
        if (mediaType === 'movie' && movieResult?.id) {
            return this._getMovieDetails(movieResult.id, imdbId);
        }
        if (tvResult?.id && !movieResult?.id) {
            return this._getTvDetails(tvResult.id, imdbId);
        }
        if (movieResult?.id) {
            return this._getMovieDetails(movieResult.id, imdbId);
        }
        if (tvResult?.id) {
            return this._getTvDetails(tvResult.id, imdbId);
        }

        return null;
    }

    /**
     * Return raw TMDB title-search candidates for verified cross-provider matching.
     * The caller must still validate title, year, and media type before persisting an
     * identity mapping; this method deliberately does not choose the first result.
     * @param {string} title - Title supplied by the caller
     * @param {number|string} year - Release year supplied by the caller
     * @param {'movie'|'tv'} [mediaType='movie'] - TMDB media namespace
     * @returns {Promise<Array<Object>>} Raw TMDB search candidates
     */
    async searchByTitleYearCandidates(title, year, mediaType = 'movie') {
        const normalizedTitle = title?.trim();
        if (!normalizedTitle) {
            throw new Error('A movie title is required for TMDB title search');
        }

        const normalizedMediaType = mediaType === 'tv' ? 'tv' : 'movie';
        const params = new URLSearchParams({
            query: normalizedTitle,
            language: this.defaultLanguage,
            include_adult: 'false'
        });
        if (year) {
            params.set(
                normalizedMediaType === 'tv' ? 'first_air_date_year' : 'primary_release_year',
                String(year)
            );
        }

        const response = await this._fetchWithRotation(
            `${this.baseUrl}/search/${normalizedMediaType}?${params}`,
            { method: 'GET' }
        );

        if (!response.ok) {
            throw new Error(`TMDB title search failed: HTTP ${response.status}`);
        }

        const result = await response.json();
        return Array.isArray(result.results) ? result.results.filter(item => item?.id) : [];
    }

    /**
     * Search TMDB by title and year and return the first result for legacy callers.
     * Verified identity recovery uses searchByTitleYearCandidates instead.
     * @param {string} title - Movie title supplied by the caller
     * @param {number|string} year - Release year supplied by the caller
     * @returns {Promise<Object|null>} TMDB data in the application's movie shape
     */
    async searchByTitleYear(title, year) {
        const candidates = await this.searchByTitleYearCandidates(title, year, 'movie');
        const tmdbMovie = candidates[0];
        if (!tmdbMovie?.id) return null;

        return this._getMovieDetails(tmdbMovie.id);
    }

    /**
     * Get trending movies from TMDB for discovery carousel.
     * Filters out unreleased future dates and low-vote titles.
     * @param {string} [timeWindow='week'] - Time window: 'day' or 'week'
     * @param {number} [page=1] - Page number
     * @param {AbortSignal} [signal=null] - Optional abort signal
     * @returns {Promise<Array<Object>>} - Array of normalized movie objects from TMDB
     */
    /**
     * Get trending movies from TMDB for discovery carousel.
     * Filters out unreleased future dates and low-vote titles.
     * @param {string} [timeWindow='week'] - Time window: 'day' or 'week'
     * @param {number} [page=1] - Page number
     * @param {AbortSignal} [signal=null] - Optional abort signal
     * @returns {Promise<Array<Object>>} - Array of normalized movie objects from TMDB
     */
    async getTrendingMovies(timeWindow = 'week', page = 1, signal = null) {
        const windowKey = timeWindow === 'day' ? 'day' : 'week';
        const params = new URLSearchParams({
            language: this.defaultLanguage,
            page: String(page),
            include_adult: 'false'
        });

        const response = await this._fetchWithRotation(
            `${this.baseUrl}/trending/movie/${windowKey}?${params}`,
            { method: 'GET', signal }
        );

        if (!response.ok) {
            throw new Error(`TMDB trending movies request failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        const results = Array.isArray(data.results) ? data.results : [];
        const todayStr = new Date().toISOString().split('T')[0];

        // Filter out future unreleased movies, adult titles, promo materials, and titles with no audience ratings
        const filtered = results.filter(item => {
            if (item.adult) return false;
            if (!item.release_date) return false;
            if (item.release_date > todayStr) return false;
            if ((Number(item.vote_count) || 0) < 5) return false;
            const classifier = (typeof MediaClassifier !== 'undefined')
                ? MediaClassifier
                : (typeof globalThis !== 'undefined' && globalThis.MediaClassifier ? globalThis.MediaClassifier : null);
            if (classifier && typeof classifier.isPromoContent === 'function' && classifier.isPromoContent(item)) {
                return false;
            }
            return true;
        });

        return filtered.map(item => ({
            ...this.normalizeTmdbItem(item, 'movie'),
            mediaType: 'movie'
        }));
    }

    /**
     * Get now playing / fresh digital movies from TMDB for discovery categories.
     * @param {number} [page=1]
     * @param {AbortSignal} [signal=null]
     * @returns {Promise<Array<Object>>}
     */
    async getNowPlayingMovies(page = 1, signal = null) {
        const params = new URLSearchParams({
            language: this.defaultLanguage,
            page: String(page),
            include_adult: 'false'
        });

        const response = await this._fetchWithRotation(
            `${this.baseUrl}/movie/now_playing?${params}`,
            { method: 'GET', signal }
        );

        if (!response.ok) {
            throw new Error(`TMDB now playing movies request failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        const results = Array.isArray(data.results) ? data.results : [];
        const todayStr = new Date().toISOString().split('T')[0];

        const filtered = results.filter(item => {
            if (item.adult) return false;
            if (!item.release_date) return false;
            if (item.release_date > todayStr) return false;
            if ((Number(item.vote_count) || 0) < 2) return false;
            const classifier = (typeof MediaClassifier !== 'undefined')
                ? MediaClassifier
                : (typeof globalThis !== 'undefined' && globalThis.MediaClassifier ? globalThis.MediaClassifier : null);
            if (classifier && typeof classifier.isPromoContent === 'function' && classifier.isPromoContent(item)) {
                return false;
            }
            return true;
        });

        return filtered.map(item => ({
            ...this.normalizeTmdbItem(item, 'movie'),
            mediaType: 'movie'
        }));
    }

    /**
     * Get trending TV series / ongoing shows from TMDB.
     * @param {number} [page=1]
     * @param {AbortSignal} [signal=null]
     * @returns {Promise<Array<Object>>}
     */
    async getTrendingTvShows(page = 1, signal = null) {
        const params = new URLSearchParams({
            language: this.defaultLanguage,
            page: String(page),
            include_adult: 'false'
        });

        const response = await this._fetchWithRotation(
            `${this.baseUrl}/trending/tv/week?${params}`,
            { method: 'GET', signal }
        );

        if (!response.ok) {
            throw new Error(`TMDB trending TV request failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        const results = Array.isArray(data.results) ? data.results : [];
        const todayStr = new Date().toISOString().split('T')[0];

        const filtered = results.filter(item => {
            if (item.adult) return false;
            if (!item.first_air_date) return false;
            if (item.first_air_date > todayStr) return false;
            if ((Number(item.vote_count) || 0) < 2) return false;
            const classifier = (typeof MediaClassifier !== 'undefined')
                ? MediaClassifier
                : (typeof globalThis !== 'undefined' && globalThis.MediaClassifier ? globalThis.MediaClassifier : null);
            if (classifier && typeof classifier.isPromoContent === 'function' && classifier.isPromoContent(item)) {
                return false;
            }
            return true;
        });

        return filtered.map(item => ({
            ...this.normalizeTmdbItem(item, 'tv-series'),
            mediaType: 'tv'
        }));
    }

    /**
     * Normalize any raw TMDB item into a common card-ready object.
     * kinopoiskId is intentionally null — filled lazily via _enrichWithKpIds.
     * Preserves genreIds, originalLanguage, originCountry for semantic classification.
     * @param {Object} item - Raw TMDB API result
     * @param {'movie'|'tv-series'|'cartoon'|'anime'} type
     * @returns {Object}
     */
    normalizeTmdbItem(item, type = 'movie') {
        const isTv = item.first_air_date !== undefined;
        const title = isTv ? (item.name || '') : (item.title || '');
        const originalTitle = isTv ? (item.original_name || '') : (item.original_title || '');
        const releaseDate = isTv ? (item.first_air_date || null) : (item.release_date || null);
        return {
            tmdbId: item.id || null,
            kinopoiskId: null,
            name: title,
            alternativeName: originalTitle,
            englishTitle: originalTitle,
            posterUrl: this.buildImageUrl(item.poster_path),
            backdrop: this.buildImageUrl(item.backdrop_path),
            year: this.getYear(releaseDate),
            releaseDate,
            description: item.overview || '',
            kpRating: null,
            ratingTmdb: Number(item.vote_average) || 0,
            imdbRating: null,
            voteCount: Number(item.vote_count) || 0,
            popularity: Number(item.popularity) || 0,
            genreIds: Array.isArray(item.genre_ids) ? item.genre_ids : (Array.isArray(item.genreIds) ? item.genreIds : []),
            originalLanguage: item.original_language || item.originalLanguage || '',
            originCountry: Array.isArray(item.origin_country) ? item.origin_country : (Array.isArray(item.originCountry) ? item.originCountry : []),
            mediaType: isTv ? 'tv' : 'movie',
            type,
            adult: Boolean(item.adult),
            isTmdbOnly: true // flag: KP ID not yet resolved
        };
    }

    /**
     * Get fresh Western / non-Japanese animation from TMDB (movies and TV series).
     * Excludes adult/erotic keywords and excludes Japanese animation via post-filter.
     * @param {number} [page=1]
     * @param {Object} [options={}]
     * @param {AbortSignal} [signal=null]
     * @returns {Promise<Array<Object>>}
     */
    async getFreshAnimation(page = 1, options = {}, signal = null) {
        const currentYear = new Date().getFullYear();
        const todayStr = new Date().toISOString().split('T')[0];
        const minDate = options.minReleaseDate || `${currentYear - 3}-01-01`;

        // Explicit exclusions: adult flag + hentai(198385), erotic(256466), softcore(155477), pornography(445), erotica(325693)
        const explicitKeywords = '198385,256466,155477,445,325693';

        const movieParams = new URLSearchParams({
            language: this.defaultLanguage,
            page: String(page),
            with_genres: '16',
            sort_by: 'popularity.desc',
            'primary_release_date.gte': minDate,
            'primary_release_date.lte': todayStr,
            'vote_count.gte': '5',
            include_adult: 'false',
            without_keywords: explicitKeywords
        });

        const tvParams = new URLSearchParams({
            language: this.defaultLanguage,
            page: String(page),
            with_genres: '16',
            sort_by: 'popularity.desc',
            'first_air_date.gte': minDate,
            'vote_count.gte': '5',
            include_adult: 'false',
            without_keywords: explicitKeywords
        });

        const [movieRes, tvRes] = await Promise.allSettled([
            this._fetchWithRotation(`${this.baseUrl}/discover/movie?${movieParams}`, { method: 'GET', signal }),
            this._fetchWithRotation(`${this.baseUrl}/discover/tv?${tvParams}`, { method: 'GET', signal })
        ]);

        const rawMovies = (movieRes.status === 'fulfilled' && movieRes.value.ok)
            ? (await movieRes.value.json()).results || []
            : [];
        const rawTvs = (tvRes.status === 'fulfilled' && tvRes.value.ok)
            ? (await tvRes.value.json()).results || []
            : [];

        // Exclude Japanese animation from Western/international cartoons pool (TMDB API does not support without_original_language)
        const movies = rawMovies.filter(m => m.original_language !== 'ja' && !m.adult);
        const tvs = rawTvs.filter(t => t.original_language !== 'ja' && !t.adult);

        const normalizedMovies = movies.map(item => ({ ...this.normalizeTmdbItem(item, 'cartoon'), mediaType: 'movie' }));
        const normalizedTv = tvs.map(item => ({ ...this.normalizeTmdbItem(item, 'cartoon'), mediaType: 'tv' }));

        // Merge and sort by TMDB popularity descending
        const merged = [...normalizedMovies, ...normalizedTv].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        return merged;
    }

    /**
     * Get fresh popular movies from TMDB using discover/movie with date, vote, and adult filters.
     * @param {number} [page=1]
     * @param {Object} [options={}]
     * @param {AbortSignal} [signal=null]
     * @returns {Promise<Array<Object>>}
     */
    async getFreshMovies(page = 1, options = {}, signal = null) {
        const currentYear = new Date().getFullYear();
        const todayStr = new Date().toISOString().split('T')[0];
        const minDate = options.minReleaseDate || `${currentYear - 2}-01-01`;
        const maxDate = options.maxReleaseDate || todayStr;
        const minVotes = options.minVotes !== undefined ? options.minVotes : 10;
        const explicitKeywords = '198385,256466,155477,445,325693';

        const params = new URLSearchParams({
            language: this.defaultLanguage,
            page: String(page),
            sort_by: 'popularity.desc',
            'primary_release_date.gte': minDate,
            'primary_release_date.lte': maxDate,
            'vote_count.gte': String(minVotes),
            include_adult: 'false',
            without_keywords: explicitKeywords
        });

        if (options.withoutGenres) {
            params.set('without_genres', String(options.withoutGenres));
        }

        const response = await this._fetchWithRotation(
            `${this.baseUrl}/discover/movie?${params}`,
            { method: 'GET', signal }
        );

        if (!response.ok) {
            throw new Error(`TMDB fresh movies discover request failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        const results = Array.isArray(data.results) ? data.results : [];
        const filtered = results.filter(item => !item.adult);

        return filtered.map(item => ({ ...this.normalizeTmdbItem(item, 'movie'), mediaType: 'movie' }));
    }

    /**
     * Get one paginated catalogue page with the same semantic categories used
     * by HomeCacheService. KP identity is intentionally left unresolved.
     * @param {Object} options
     * @param {'films'|'series'|'cartoons'|'anime'} options.category
     * @param {number} [options.page=1]
     * @param {number} [options.pageSize=24]
     * @param {string} [options.sort='popularity.desc']
     * @param {number|null} [options.yearFrom]
     * @param {number|null} [options.yearTo]
     * @param {number|null} [options.genre]
     * @param {string} [options.country]
     * @param {AbortSignal|null} [options.signal]
     * @returns {Promise<{items: Array<Object>, page: number, totalPages: number, totalResults: number}>}
     */
    async getCatalogPage(options = {}) {
        const category = ['films', 'series', 'cartoons', 'anime'].includes(options.category)
            ? options.category
            : 'films';
        const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
        const pageSize = Math.min(30, Math.max(12, Number.parseInt(options.pageSize, 10) || 24));
        const allowedSorts = new Set([
            'popularity.desc',
            'vote_average.desc',
            'primary_release_date.desc',
            'first_air_date.desc'
        ]);
        const requestedSort = allowedSorts.has(options.sort) ? options.sort : 'popularity.desc';
        const yearFrom = Number.parseInt(options.yearFrom, 10);
        const yearTo = Number.parseInt(options.yearTo, 10);
        const genre = Number.parseInt(options.genre, 10);
        const country = typeof options.country === 'string' && /^[A-Z]{2}$/i.test(options.country)
            ? options.country.toUpperCase()
            : '';
        const signal = options.signal || null;

        const buildParams = (kind, providerPage) => {
            const isTv = kind === 'tv';
            const sort = isTv && requestedSort === 'primary_release_date.desc'
                ? 'first_air_date.desc'
                : (!isTv && requestedSort === 'first_air_date.desc'
                    ? 'primary_release_date.desc'
                    : requestedSort);
            const params = new URLSearchParams({
                language: this.defaultLanguage,
                page: String(providerPage),
                sort_by: sort,
                include_adult: 'false',
                'vote_count.gte': '1000',
                without_keywords: '198385,256466,155477,445,325693,159551'
            });

            if (category === 'films' || category === 'series') {
                params.set('without_genres', '16');
            } else {
                params.set('with_genres', '16');
                if (category === 'anime') {
                    params.set('with_original_language', 'ja');
                } else {
                    params.set('without_original_language', 'ja');
                }
            }

            if (Number.isInteger(genre) && genre > 0) {
                if (category === 'films' || category === 'series') {
                    params.set('with_genres', String(genre));
                } else {
                    params.set('with_genres', `16,${genre}`);
                }
            }

            if (country) params.set('with_origin_country', country);
            if (Number.isInteger(yearFrom) && yearFrom >= 1870) {
                params.set(isTv ? 'first_air_date.gte' : 'primary_release_date.gte', `${yearFrom}-01-01`);
            }
            if (Number.isInteger(yearTo) && yearTo >= 1870) {
                params.set(isTv ? 'first_air_date.lte' : 'primary_release_date.lte', `${yearTo}-12-31`);
            }

            return params;
        };

        const kinds = category === 'films'
            ? ['movie']
            : (category === 'series' ? ['tv'] : ['movie', 'tv']);

        const isMixedCategory = kinds.length > 1;
        // TMDB returns at most 20 results per provider page. Fetch enough
        // provider pages for every catalogue page, not only mixed categories.
        const providerPageCount = Math.max(1, Math.ceil((page * pageSize) / 20));
        const filterKey = [category, requestedSort, yearFrom || '', yearTo || '', genre || '', country || ''].join('|');

        const getProviderPage = async (kind, providerPage) => {
            const cacheKey = `${filterKey}|${kind}|${providerPage}`;
            if (this.catalogProviderPageCache.has(cacheKey)) {
                return this.catalogProviderPageCache.get(cacheKey);
            }
            if (this.catalogProviderPageInFlight.has(cacheKey)) {
                return this.catalogProviderPageInFlight.get(cacheKey);
            }

            const request = (async () => {
                const response = await this._fetchWithRotation(
                    `${this.baseUrl}/discover/${kind}?${buildParams(kind, providerPage)}`,
                    { method: 'GET', signal }
                );
                if (!response.ok) {
                    throw new Error(`TMDB catalogue request failed: HTTP ${response.status}`);
                }
                const result = { kind, data: await response.json() };
                this.catalogProviderPageCache.set(cacheKey, result);
                while (this.catalogProviderPageCache.size > 120) {
                    this.catalogProviderPageCache.delete(this.catalogProviderPageCache.keys().next().value);
                }
                return result;
            })().finally(() => this.catalogProviderPageInFlight.delete(cacheKey));

            this.catalogProviderPageInFlight.set(cacheKey, request);
            return request;
        };

        const responses = await Promise.all(kinds.flatMap(kind => (
            Array.from({ length: providerPageCount }, (_, index) => getProviderPage(kind, index + 1))
        )));

        const normalized = [];
        for (const { kind, data } of responses) {
            const rawResults = Array.isArray(data?.results) ? data.results : [];
            for (const item of rawResults) {
                if (!item || item.adult === true || !item.id) continue;
                if (category === 'anime' && item.original_language !== 'ja') continue;
                if (category === 'cartoons' && item.original_language === 'ja') continue;

                const type = category === 'films'
                    ? 'movie'
                    : (category === 'series' ? 'tv-series' : category);
                normalized.push({
                    ...this.normalizeTmdbItem(item, type),
                    mediaType: kind,
                    type,
                    category,
                    isTmdbOnly: true,
                    source: 'catalog-tmdb'
                });
            }
        }

        const unique = [];
        const seen = new Set();
        const getSortValue = item => {
            if (requestedSort === 'vote_average.desc') {
                return Number(item.ratingTmdb) || 0;
            }
            if (requestedSort === 'primary_release_date.desc' || requestedSort === 'first_air_date.desc') {
                const timestamp = item.releaseDate ? Date.parse(item.releaseDate) : 0;
                return Number.isFinite(timestamp) ? timestamp : 0;
            }
            return Number(item.popularity) || 0;
        };
        normalized
            .sort((a, b) => getSortValue(b) - getSortValue(a))
            .forEach(item => {
                const id = Number(item.tmdbId);
                const identityKey = `${item.mediaType || 'movie'}:${id}`;
                if (!id || seen.has(identityKey)) return;
                seen.add(identityKey);
                unique.push(item);
            });

        const startIndex = (page - 1) * pageSize;
        const totalResults = kinds.reduce((sum, kind) => {
            const firstPage = responses.find(result => result.kind === kind);
            return sum + (Number(firstPage?.data?.total_results) || 0);
        }, 0);
        return {
            items: unique.slice(startIndex, startIndex + pageSize),
            page,
            totalPages: isMixedCategory
                ? Math.max(1, Math.ceil(totalResults / pageSize))
                : Math.max(...responses.map(result => Number(result.data?.total_pages) || 1)),
            totalResults
        };
    }

    /**
     * Get trending Anime series/movies from TMDB (both anime movies and anime TV).
     * Excludes explicit AnimeFesta/erotica studios and adult/hentai keywords.
     * @param {number} [page=1]
     * @param {Object} [options={}]
     * @param {AbortSignal} [signal=null]
     * @returns {Promise<Array<Object>>}
     */
    async getFreshAnime(page = 1, options = {}, signal = null) {
        const currentYear = new Date().getFullYear();
        const minDate = options.minReleaseDate || `${currentYear - 3}-01-01`;

        // Exclusions: hentai(198385), erotic(256466), softcore(155477), pornography(445), erotica(325693)
        const explicitKeywords = '198385,256466,155477,445,325693';
        // Production companies for AnimeFesta short-form erotica: Suiseisha(149421), studio HōKIBOSHI(125825), Rabbit Gate(152965), WWWave(238639)
        const explicitCompanies = '149421,125825,152965,238639';

        const movieParams = new URLSearchParams({
            language: this.defaultLanguage,
            page: String(page),
            with_genres: '16',
            with_original_language: 'ja',
            sort_by: 'popularity.desc',
            'primary_release_date.gte': minDate,
            'vote_count.gte': '5',
            include_adult: 'false',
            without_keywords: explicitKeywords,
            without_companies: explicitCompanies
        });

        const tvParams = new URLSearchParams({
            language: this.defaultLanguage,
            page: String(page),
            with_genres: '16',
            with_original_language: 'ja',
            sort_by: 'popularity.desc',
            'first_air_date.gte': minDate,
            'vote_count.gte': '5',
            include_adult: 'false',
            without_keywords: explicitKeywords,
            without_companies: explicitCompanies
        });

        const [movieRes, tvRes] = await Promise.allSettled([
            this._fetchWithRotation(`${this.baseUrl}/discover/movie?${movieParams}`, { method: 'GET', signal }),
            this._fetchWithRotation(`${this.baseUrl}/discover/tv?${tvParams}`, { method: 'GET', signal })
        ]);

        const rawMovies = (movieRes.status === 'fulfilled' && movieRes.value.ok)
            ? (await movieRes.value.json()).results || []
            : [];
        const rawTvs = (tvRes.status === 'fulfilled' && tvRes.value.ok)
            ? (await tvRes.value.json()).results || []
            : [];

        const movies = rawMovies.filter(m => !m.adult);
        const tvs = rawTvs.filter(t => !t.adult);

        const normalizedMovies = movies.map(item => ({ ...this.normalizeTmdbItem(item, 'anime'), mediaType: 'movie' }));
        const normalizedTv = tvs.map(item => ({ ...this.normalizeTmdbItem(item, 'anime'), mediaType: 'tv' }));

        // Targeted anomaly demotion: preserve TMDB popularity authority, only demote proven stale micro-shows (< 30 votes and debuted >= 3 years ago)
        const scoreAnime = (item) => {
            let pop = Number(item.popularity) || 0;
            const votes = Number(item.voteCount) || 0;
            const year = Number(item.year) || 0;

            if (votes < 30 && year > 0 && year <= currentYear - 3) {
                pop = pop * 0.1;
            }

            return pop;
        };

        const merged = [...normalizedMovies, ...normalizedTv].sort((a, b) => scoreAnime(b) - scoreAnime(a));
        return merged;
    }

    /**
     * Public helper to get a TMDB movie or TV show and its credits/release dates.
     * @param {number|string} tmdbId - TMDB entity ID
     * @param {string} [imdbId] - IMDb ID used for matching, when available
     * @param {string} [mediaType='movie'] - 'movie' or 'tv'
     * @returns {Promise<Object>}
     */
    async getMovieDetails(tmdbId, imdbId = '', mediaType = 'movie') {
        if (mediaType === 'tv') {
            return this._getTvDetails(tmdbId, imdbId);
        }
        return this._getMovieDetails(tmdbId, imdbId);
    }

    /**
     * Public helper to get a TMDB TV show details.
     * @param {number|string} tmdbId - TMDB TV ID
     * @param {string} [imdbId] - IMDb ID used for matching, when available
     * @returns {Promise<Object>}
     */
    async getTvDetails(tmdbId, imdbId = '') {
        return this._getTvDetails(tmdbId, imdbId);
    }

    /**
     * Get recommendations for a movie or TV show from TMDB.
     * @param {number|string} tmdbId - TMDB entity ID
     * @param {'movie'|'tv'} [mediaType='movie'] - 'movie' or 'tv'
     * @param {Object} [options={}] - Optional parameters: { page: 1, language, signal }
     * @returns {Promise<Array<Object>>} Normalized candidate items
     */
    async getRecommendations(tmdbId, mediaType = 'movie', options = {}) {
        const numId = Number(tmdbId);
        if (!numId || isNaN(numId) || numId <= 0) return [];

        const normType = (mediaType === 'tv' || mediaType === 'tv-series' || mediaType === 'series') ? 'tv' : 'movie';
        const page = options.page || 1;
        const language = options.language || this.defaultLanguage;
        const signal = options.signal || null;

        const params = new URLSearchParams({
            language,
            page: String(page)
        });

        try {
            const response = await this._fetchWithRotation(
                `${this.baseUrl}/${normType}/${encodeURIComponent(numId)}/recommendations?${params}`,
                { method: 'GET', signal }
            );

            if (!response.ok) {
                if (response.status === 404) return [];
                console.warn(`TMDBService: recommendations request failed for ${normType}/${numId}: HTTP ${response.status}`);
                return [];
            }

            const data = await response.json();
            const results = Array.isArray(data.results) ? data.results : [];
            const typeLabel = normType === 'tv' ? 'tv-series' : 'movie';

            return results.map(item => ({
                ...this.normalizeTmdbItem(item, typeLabel),
                mediaType: normType
            }));
        } catch (error) {
            console.warn(`TMDBService: getRecommendations failed for ${normType}/${numId}:`, error.message);
            return [];
        }
    }

    /**
     * Get external IDs (including imdb_id) for a movie or TV show from TMDB.
     * @param {number|string} tmdbId - TMDB entity ID
     * @param {'movie'|'tv'} [mediaType='movie'] - 'movie' or 'tv'
     * @param {Object} [options={}] - Options { signal }
     * @returns {Promise<{ imdb_id?: string|null, id?: number }|null>}
     */
    async getExternalIds(tmdbId, mediaType = 'movie', options = {}) {
        const numId = Number(tmdbId);
        if (!numId || isNaN(numId) || numId <= 0) return null;

        const normType = (mediaType === 'tv' || mediaType === 'tv-series' || mediaType === 'series') ? 'tv' : 'movie';
        const signal = options.signal || null;

        try {
            const response = await this._fetchWithRotation(
                `${this.baseUrl}/${normType}/${encodeURIComponent(numId)}/external_ids`,
                { method: 'GET', signal }
            );

            if (!response.ok) {
                return null;
            }

            return await response.json();
        } catch (error) {
            console.warn(`TMDBService: getExternalIds failed for ${normType}/${numId}:`, error.message);
            return null;
        }
    }

    /**
     * Get similar movies or TV shows from TMDB.
     * @param {number|string} tmdbId - TMDB entity ID
     * @param {'movie'|'tv'} [mediaType='movie'] - 'movie' or 'tv'
     * @param {Object} [options={}] - Optional parameters: { page: 1, language, signal }
     * @returns {Promise<Array<Object>>} Normalized candidate items
     */
    async getSimilar(tmdbId, mediaType = 'movie', options = {}) {
        const numId = Number(tmdbId);
        if (!numId || isNaN(numId) || numId <= 0) return [];

        const normType = (mediaType === 'tv' || mediaType === 'tv-series' || mediaType === 'series') ? 'tv' : 'movie';
        const page = options.page || 1;
        const language = options.language || this.defaultLanguage;
        const signal = options.signal || null;

        const params = new URLSearchParams({
            language,
            page: String(page)
        });

        try {
            const response = await this._fetchWithRotation(
                `${this.baseUrl}/${normType}/${encodeURIComponent(numId)}/similar?${params}`,
                { method: 'GET', signal }
            );

            if (!response.ok) {
                if (response.status === 404) return [];
                console.warn(`TMDBService: similar request failed for ${normType}/${numId}: HTTP ${response.status}`);
                return [];
            }

            const data = await response.json();
            const results = Array.isArray(data.results) ? data.results : [];
            const typeLabel = normType === 'tv' ? 'tv-series' : 'movie';

            return results.map(item => ({
                ...this.normalizeTmdbItem(item, typeLabel),
                mediaType: normType
            }));
        } catch (error) {
            console.warn(`TMDBService: getSimilar failed for ${normType}/${numId}:`, error.message);
            return [];
        }
    }

    /**
     * Get a movie collection / franchise from TMDB with localized Russian metadata and parts.
     * @param {number|string} collectionId - TMDB Collection ID
     * @param {Object} [options={}] - Options { language, signal }
     * @returns {Promise<Object|null>} Normalized CollectionDTO
     */
    async getCollection(collectionId, options = {}) {
        const numId = Number(collectionId);
        if (!numId || isNaN(numId) || numId <= 0) {
            throw new Error(`Invalid TMDB collection ID: ${collectionId}`);
        }

        const language = options.language || this.defaultLanguage;
        const signal = options.signal || null;

        const params = new URLSearchParams({
            language
        });

        try {
            const response = await this._fetchWithRotation(
                `${this.baseUrl}/collection/${encodeURIComponent(numId)}?${params}`,
                { method: 'GET', signal }
            );

            if (!response.ok) {
                if (response.status === 404) return null;
                console.warn(`TMDBService: collection request failed for ${numId}: HTTP ${response.status}`);
                return null;
            }

            const data = await response.json();
            return this.normalizeCollectionData(data);
        } catch (error) {
            console.warn(`TMDBService: getCollection failed for ${numId}:`, error.message);
            return null;
        }
    }

    /**
     * Normalize raw TMDB collection payload into canonical bounded CollectionDTO.
     * Filters adult/malformed entries and sorts parts chronologically by releaseDate ASC.
     * @param {Object} data - Raw TMDB collection object
     * @returns {Object|null} Normalized CollectionDTO
     */
    normalizeCollectionData(data) {
        if (!data || typeof data !== 'object') return null;

        const rawParts = Array.isArray(data.parts) ? data.parts : [];
        const parts = rawParts
            .filter(p => p && !p.adult && p.id && (p.title || p.name))
            .map(p => {
                const releaseDate = p.release_date || null;
                const year = releaseDate ? parseInt(releaseDate, 10) || null : null;
                return {
                    tmdbId: Number(p.id),
                    kinopoiskId: null,
                    title: String(p.title || p.name || '').trim(),
                    originalTitle: String(p.original_title || p.original_name || '').trim(),
                    mediaType: 'movie',
                    releaseDate,
                    year,
                    posterUrl: this.buildImageUrl(p.poster_path, 'w342') || this.buildImageUrl(p.poster_path, 'w500'),
                    backdropUrl: this.buildImageUrl(p.backdrop_path, 'w1280'),
                    voteAverage: typeof p.vote_average === 'number' ? Number(p.vote_average.toFixed(1)) : null,
                    voteCount: typeof p.vote_count === 'number' ? p.vote_count : 0,
                    adult: Boolean(p.adult)
                };
            })
            .sort((a, b) => {
                if (a.releaseDate && b.releaseDate) return a.releaseDate.localeCompare(b.releaseDate);
                if (a.releaseDate) return -1;
                if (b.releaseDate) return 1;
                return 0;
            });

        return {
            id: Number(data.id),
            name: String(data.name || '').trim(),
            overview: String(data.overview || '').trim(),
            posterUrl: this.buildImageUrl(data.poster_path, 'w500'),
            backdropUrl: this.buildImageUrl(data.backdrop_path, 'w1280'),
            parts
        };
    }

    /**
     * Get person details from TMDB with appended credits, external IDs, and images in a single roundtrip.
     * @param {number|string} personId - TMDB person ID
     * @param {Object} [options={}] - Options { language, signal }
     * @returns {Promise<Object>} Raw TMDB person response
     */
    async getPersonDetails(personId, options = {}) {
        const numId = Number(personId);
        if (!numId || isNaN(numId) || numId <= 0) {
            throw new Error(`Invalid TMDB person ID: ${personId}`);
        }

        const language = options.language || this.defaultLanguage;
        const signal = options.signal || null;
        const append = 'combined_credits,external_ids,images';

        const params = new URLSearchParams({
            language,
            append_to_response: append
        });

        const response = await this._fetchWithRotation(
            `${this.baseUrl}/person/${encodeURIComponent(numId)}?${params}`,
            { method: 'GET', signal }
        );

        if (!response.ok) {
            const err = new Error(`TMDB person request failed: HTTP ${response.status}`);
            err.status = response.status;
            throw err;
        }

        return await response.json();
    }

    /**
     * Get a TMDB movie and its credits and regional release dates.
     * @param {number|string} tmdbId - TMDB movie ID
     * @param {string} [imdbId] - IMDb ID used for matching, when available
     * @returns {Promise<Object>}
     */
    async _getMovieDetails(tmdbId, imdbId = '') {
        const movie = await this._fetchMovieDetails(tmdbId, this.defaultLanguage);

        // TMDB's language filter omits valid title logos that exist only in another
        // language (for example Spanish). Re-query images without that filter only
        // when the preferred-language response contains no usable logo.
        if (!Array.isArray(movie.images?.logos) || movie.images.logos.length === 0) {
            const allLanguageMovie = await this._fetchMovieDetails(
                tmdbId,
                this.defaultLanguage,
                { includeAllImageLanguages: true }
            );
            const fallbackLogos = Array.isArray(allLanguageMovie.images?.logos)
                ? allLanguageMovie.images.logos
                : [];
            if (fallbackLogos.length > 0) {
                movie.images = { ...(movie.images || {}), logos: fallbackLogos };
            }
        }

        // Some TMDB titles have no Russian overview. Keep all primary-language
        // metadata, but use English only for text that is otherwise unavailable.
        if (!movie.overview?.trim() && this.defaultLanguage !== 'en-US') {
            const englishMovie = await this._fetchMovieDetails(tmdbId, 'en-US');
            movie.overview = englishMovie.overview || movie.overview;
            movie.tagline = movie.tagline || englishMovie.tagline;
        }

        return this.normalizeMovieData(movie, imdbId);
    }

    /**
     * Get a TMDB TV series and its seasons, credits, and videos.
     * @param {number|string} tmdbId - TMDB TV show ID
     * @param {string} [imdbId] - IMDb ID used for matching, when available
     * @returns {Promise<Object>}
     */
    async _getTvDetails(tmdbId, imdbId = '') {
        const tv = await this._fetchTvDetails(tmdbId, this.defaultLanguage);

        if (!Array.isArray(tv.images?.logos) || tv.images.logos.length === 0) {
            const allLanguageTv = await this._fetchTvDetails(
                tmdbId,
                this.defaultLanguage,
                { includeAllImageLanguages: true }
            );
            const fallbackLogos = Array.isArray(allLanguageTv.images?.logos)
                ? allLanguageTv.images.logos
                : [];
            if (fallbackLogos.length > 0) {
                tv.images = { ...(tv.images || {}), logos: fallbackLogos };
            }
        }

        if (!tv.overview?.trim() && this.defaultLanguage !== 'en-US') {
            const englishTv = await this._fetchTvDetails(tmdbId, 'en-US');
            tv.overview = englishTv.overview || tv.overview;
            tv.tagline = englishTv.tagline || tv.tagline;
        }

        return this.normalizeTvData(tv, imdbId);
    }

    async _fetchTvDetails(tmdbId, language, options = {}) {
        const params = new URLSearchParams({
            language,
            append_to_response: 'credits,videos,content_ratings,images',
        });
        if (!options.includeAllImageLanguages) {
            params.set('include_image_language', 'ru,en,null');
        }
        const response = await this._fetchWithRotation(
            `${this.baseUrl}/tv/${encodeURIComponent(tmdbId)}?${params}`,
            { method: 'GET' }
        );

        if (!response.ok) {
            throw new Error(`TMDB TV details failed: HTTP ${response.status}`);
        }

        return response.json();
    }

    /**
     * Build standard storage key for cached season.
     * @param {number|string} tmdbId 
     * @param {number|string} seasonNumber 
     * @returns {string}
     */
    getSeasonCacheKey(tmdbId, seasonNumber) {
        return `${this.seasonCachePrefix}${tmdbId}_${seasonNumber}`;
    }

    /**
     * Retrieve cached season data from chrome.storage.local with TTL validation.
     * Ended seasons: 30 days. Ongoing/future seasons: 24 hours.
     * @param {number|string} tmdbId 
     * @param {number|string} seasonNumber 
     * @returns {Promise<Object|null>}
     */
    async getCachedSeason(tmdbId, seasonNumber) {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
        try {
            const key = this.getSeasonCacheKey(tmdbId, seasonNumber);
            const res = await chrome.storage.local.get(key);
            const entry = res[key];
            if (!entry || entry.schemaVersion !== 1 || !entry.data || !entry.fetchedAt) {
                return null;
            }

            const hasFutureEpisode = Array.isArray(entry.data.episodes) && entry.data.episodes.some(ep => {
                if (!ep.airDate) return true;
                const d = new Date(ep.airDate);
                return isNaN(d.getTime()) || d > new Date();
            });
            const ttlMs = hasFutureEpisode ? (24 * 60 * 60 * 1000) : (30 * 24 * 60 * 60 * 1000);
            const age = Date.now() - entry.fetchedAt;

            if (age < ttlMs) {
                return entry.data;
            }
            return null;
        } catch (e) {
            console.warn(`[TMDBService] Failed reading cached season ${tmdbId} S${seasonNumber}:`, e);
            return null;
        }
    }

    /**
     * Save normalized season details to chrome.storage.local with bounded LRU cleanup.
     * @param {number|string} tmdbId 
     * @param {number|string} seasonNumber 
     * @param {Object} data - Normalized season details DTO
     * @returns {Promise<void>}
     */
    async setCachedSeason(tmdbId, seasonNumber, data) {
        if (typeof chrome === 'undefined' || !chrome.storage?.local || !data) return;
        try {
            const key = this.getSeasonCacheKey(tmdbId, seasonNumber);
            const entry = {
                schemaVersion: 1,
                tmdbId: Number(tmdbId),
                seasonNumber: Number(seasonNumber),
                fetchedAt: Date.now(),
                data
            };
            await chrome.storage.local.set({ [key]: entry });

            // Maintain bounded LRU index
            const indexRes = await chrome.storage.local.get(this.seasonCacheIndexKey);
            let index = Array.isArray(indexRes[this.seasonCacheIndexKey]) ? indexRes[this.seasonCacheIndexKey] : [];
            
            index = index.filter(item => item && item.key !== key);
            index.push({ key, tmdbId: Number(tmdbId), seasonNumber: Number(seasonNumber), fetchedAt: entry.fetchedAt });

            if (index.length > this.maxCachedSeasons) {
                const toRemove = index.slice(0, index.length - this.maxCachedSeasons);
                index = index.slice(index.length - this.maxCachedSeasons);
                const keysToRemove = toRemove.map(item => item.key);
                await chrome.storage.local.remove(keysToRemove);
            }

            await chrome.storage.local.set({ [this.seasonCacheIndexKey]: index });
        } catch (e) {
            console.warn(`[TMDBService] Failed saving cached season ${tmdbId} S${seasonNumber}:`, e);
        }
    }

    /**
     * Fetch and normalize full episode details for a single season on demand.
     * Uses per-season cache and in-flight Promise deduplication.
     * @param {number|string} tmdbId 
     * @param {number|string} seasonNumber 
     * @param {Object} [options={}] 
     * @param {boolean} [options.forceRefresh=false]
     * @param {string} [options.language]
     * @returns {Promise<Object|null>} Normalized season details DTO
     */
    async getSeasonDetails(tmdbId, seasonNumber, options = {}) {
        const numTmdbId = Number(tmdbId);
        const numSeasonNumber = Number(seasonNumber);
        if (!numTmdbId || isNaN(numSeasonNumber)) {
            throw new Error(`Invalid arguments for getSeasonDetails: tmdbId=${tmdbId}, seasonNumber=${seasonNumber}`);
        }

        const forceRefresh = Boolean(options.forceRefresh);
        const language = options.language || this.defaultLanguage;

        // 1. Check cache if not forcing refresh
        if (!forceRefresh) {
            const cached = await this.getCachedSeason(numTmdbId, numSeasonNumber);
            if (cached) {
                return cached;
            }
        }

        // 2. Request deduplication via in-flight Promise map
        const dedupKey = `${numTmdbId}:${numSeasonNumber}:${language}`;
        if (this.inFlightSeasonRequests.has(dedupKey)) {
            return this.inFlightSeasonRequests.get(dedupKey);
        }

        const requestPromise = (async () => {
            try {
                const rawSeason = await this._fetchSeasonDetails(numTmdbId, numSeasonNumber, language);
                if (!rawSeason) return null;

                // If Russian overview or episode titles are missing, fetch English fallback
                if (!rawSeason.overview?.trim() && language !== 'en-US') {
                    try {
                        const englishSeason = await this._fetchSeasonDetails(numTmdbId, numSeasonNumber, 'en-US');
                        if (englishSeason) {
                            rawSeason.overview = englishSeason.overview || rawSeason.overview;
                            if (Array.isArray(rawSeason.episodes) && Array.isArray(englishSeason.episodes)) {
                                const enEpMap = new Map(englishSeason.episodes.map(e => [e.episode_number, e]));
                                for (const ep of rawSeason.episodes) {
                                    const enEp = enEpMap.get(ep.episode_number);
                                    if (enEp) {
                                        if (!ep.overview?.trim() && enEp.overview?.trim()) {
                                            ep.overview = enEp.overview;
                                        }
                                        if (!ep.name?.trim() && enEp.name?.trim()) {
                                            ep.name = enEp.name;
                                        }
                                    }
                                }
                            }
                        }
                    } catch {
                        // Safe fallback ignore
                    }
                }

                const normalized = this.normalizeSeasonDetails(rawSeason, numTmdbId, numSeasonNumber);
                await this.setCachedSeason(numTmdbId, numSeasonNumber, normalized);
                return normalized;
            } finally {
                this.inFlightSeasonRequests.delete(dedupKey);
            }
        })();

        this.inFlightSeasonRequests.set(dedupKey, requestPromise);
        return requestPromise;
    }

    async _fetchSeasonDetails(tmdbId, seasonNumber, language) {
        const params = new URLSearchParams({ language });
        const response = await this._fetchWithRotation(
            `${this.baseUrl}/tv/${encodeURIComponent(tmdbId)}/season/${encodeURIComponent(seasonNumber)}?${params}`,
            { method: 'GET' }
        );

        if (!response.ok) {
            if (response.status === 404) {
                return null;
            }
            throw new Error(`TMDB season details failed: HTTP ${response.status}`);
        }

        return response.json();
    }

    async _fetchMovieDetails(tmdbId, language, options = {}) {
        const params = new URLSearchParams({
            language,
            append_to_response: 'credits,release_dates,videos,images',
        });
        if (!options.includeAllImageLanguages) {
            params.set('include_image_language', 'ru,en,null');
        }
        const response = await this._fetchWithRotation(
            `${this.baseUrl}/movie/${encodeURIComponent(tmdbId)}?${params}`,
            { method: 'GET' }
        );

        if (!response.ok) {
            throw new Error(`TMDB movie details failed: HTTP ${response.status}`);
        }

        return response.json();
    }

    /**
     * Normalize TMDB movie details without inventing Kinopoisk-specific values.
     * @param {Object} movie - TMDB movie details response
     * @param {string} [imdbId] - Reliable IMDb ID, when used to locate the movie
     * @returns {Object}
     */
    normalizeMovieData(movie, imdbId = '') {
        const revenue = Number(movie.revenue) || 0;
        const budget = Number(movie.budget) || 0;
        const releaseDates = movie.release_dates?.results || [];
        const selectedLogo = this.selectBestLogo(movie.images?.logos);
        const voteAverage = (movie.vote_average !== undefined && movie.vote_average !== null && Number(movie.vote_average) > 0)
            ? Number(movie.vote_average)
            : 0;
        const voteCount = (movie.vote_count !== undefined && movie.vote_count !== null && Number(movie.vote_count) > 0)
            ? Number(movie.vote_count)
            : 0;

        return {
            kinopoiskId: null,
            tmdbId: movie.id || null,
            name: movie.title || '',
            alternativeName: movie.original_title || '',
            posterUrl: this.buildImageUrl(movie.poster_path),
            backdrop: this.buildImageUrl(movie.backdrop_path),
            logoUrl: selectedLogo?.url || null,
            logoSelectionVersion: this.logoSelectionVersion,
            year: this.getYear(movie.release_date),
            description: movie.overview || '',
            slogan: movie.tagline || '',
            genres: Array.isArray(movie.genres) ? movie.genres.map(genre => genre.name).filter(Boolean) : [],
            countries: Array.isArray(movie.production_countries)
                ? movie.production_countries.map(country => country.name).filter(Boolean)
                : [],
            duration: Number(movie.runtime) || 0,
            type: 'movie',
            persons: this.normalizePersons(movie.credits),
            budget: budget || null,
            fees: {
                world: revenue || null,
                usa: null,
                russia: null
            },
            premiere: {
                world: this.getEarliestReleaseDate(releaseDates, [1, 2, 3]) || movie.release_date || null,
                russia: this.getEarliestReleaseDate(releaseDates, [1, 2, 3], 'RU'),
                digital: this.getEarliestReleaseDate(releaseDates, [4])
            },
            ratingMpaa: this.getCertification(releaseDates, 'US'),
            externalId: {
                imdb: imdbId || movie.imdb_id || movie.external_ids?.imdb_id || '',
                tmdb: movie.id || null
            },
            additionalDataSource: 'tmdb',
            tmdbMetadataFields: this.getPopulatedMetadataFields(movie, releaseDates),

            // Additional rich provider metadata (Phase 1B)
            status: movie.status || null,
            ratingTmdb: voteAverage,
            voteCount: voteCount,
            vote_average: voteAverage,
            vote_count: voteCount,
            productionCompanies: (() => {
                if (!Array.isArray(movie.production_companies)) return [];
                const seen = new Set();
                return movie.production_companies.map(c => ({
                    tmdbId: c.id || null,
                    name: (c.name || '').trim(),
                    logoUrl: this.buildImageUrl(c.logo_path, 'w185'),
                    originCountry: c.origin_country || null
                })).filter(c => {
                    if (!c.name) return false;
                    const key = c.tmdbId ? `id:${c.tmdbId}` : `name:${c.name.toLowerCase()}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            })(),
            spokenLanguages: Array.isArray(movie.spoken_languages)
                ? movie.spoken_languages.map(l => ({
                    code: l.iso_639_1 || '',
                    englishName: l.english_name || null,
                    name: l.name || null
                })).filter(l => l.code.length > 0 || (l.name && l.name.length > 0))
                : [],
            collection: movie.belongs_to_collection ? {
                tmdbId: movie.belongs_to_collection.id || null,
                name: (movie.belongs_to_collection.name || '').trim(),
                posterUrl: this.buildImageUrl(movie.belongs_to_collection.poster_path, 'w500'),
                backdropUrl: this.buildImageUrl(movie.belongs_to_collection.backdrop_path, 'w1280')
            } : null,
            videos: this.normalizeVideos(movie.videos),
            credits: {
                cast: (Array.isArray(movie.credits?.cast) ? movie.credits.cast : []).slice(0, 30).map(p => ({
                    id: p.id,
                    name: p.name || '',
                    originalName: p.original_name || p.name || '',
                    character: p.character || '',
                    photoUrl: this.buildImageUrl(p.profile_path, 'w185'),
                    order: typeof p.order === 'number' ? p.order : null
                })),
                crew: (Array.isArray(movie.credits?.crew) ? movie.credits.crew : []).slice(0, 30).map(p => ({
                    id: p.id,
                    name: p.name || '',
                    job: p.job || '',
                    department: p.department || '',
                    photoUrl: this.buildImageUrl(p.profile_path, 'w185')
                }))
            },

            // TMDB has no direct equivalent for these Kinopoisk-specific fields.
            kpRating: 0,
            imdbRating: 0,
            votes: { kp: 0, imdb: 0, tmdb: voteCount },
            ageRating: 0,
            audience: [],
            distributors: null,
            sequelsAndPrequels: [],
            similarMovies: [],
            seasonsInfo: [],
            seasons: []
        };
    }

    /**
     * Normalize TMDB TV seasons summary.
     * @param {Array<Object>} rawSeasons - Raw TMDB seasons array
     * @returns {Array<Object>} - Bounded normalized season summaries
     */
    normalizeSeasons(rawSeasons = []) {
        if (!Array.isArray(rawSeasons)) return [];
        return rawSeasons
            .filter(s => s && typeof s === 'object' && s.season_number !== undefined && s.season_number !== null)
            .map(s => {
                const seasonNum = Number(s.season_number);
                const isSpecial = seasonNum === 0;
                return {
                    number: seasonNum,
                    name: (s.name || (isSpecial ? 'Спецматериалы' : `Сезон ${seasonNum}`)).trim(),
                    episodeCount: Number(s.episode_count) || 0,
                    airDate: s.air_date || null,
                    overview: s.overview ? s.overview.trim() : null,
                    posterUrl: this.buildImageUrl(s.poster_path, 'w500'),
                    isSpecial: isSpecial,
                    source: 'tmdb'
                };
            })
            .sort((a, b) => a.number - b.number);
    }

    /**
     * Normalize next/last episode details from TMDB TV response.
     * @param {Object|null} rawEp - Raw TMDB episode object
     * @returns {Object|null}
     */
    normalizeEpisode(rawEp) {
        if (!rawEp || typeof rawEp !== 'object') return null;
        return {
            id: rawEp.id || null,
            seasonNumber: Number(rawEp.season_number) || 0,
            episodeNumber: Number(rawEp.episode_number) || 0,
            name: (rawEp.name || '').trim(),
            overview: (rawEp.overview || '').trim(),
            airDate: rawEp.air_date || null,
            runtime: Number(rawEp.runtime) || null,
            stillUrl: this.buildImageUrl(rawEp.still_path, 'w500'),
            episodeType: rawEp.episode_type || 'standard'
        };
    }

    /**
     * Normalize full season details response into bounded Season Details DTO.
     * @param {Object} rawSeason - Raw TMDB season response
     * @param {number|string} tmdbId - TMDB TV ID
     * @param {number|string} seasonNumber - Season number
     * @returns {Object|null}
     */
    normalizeSeasonDetails(rawSeason, tmdbId, seasonNumber) {
        if (!rawSeason || typeof rawSeason !== 'object') return null;
        const numSeason = Number(seasonNumber);
        const isSpecial = numSeason === 0;
        const rawEpisodes = Array.isArray(rawSeason.episodes) ? rawSeason.episodes : [];
        
        // Upper safety bound: 500 episodes max per season
        const boundedRawEpisodes = rawEpisodes.slice(0, 500);

        const episodes = boundedRawEpisodes
            .filter(ep => ep && typeof ep === 'object')
            .map(ep => this.normalizeSeasonEpisode(ep, tmdbId, numSeason))
            .sort((a, b) => a.episodeNumber - b.episodeNumber);

        return {
            tmdbId: Number(tmdbId),
            seasonNumber: numSeason,
            name: (rawSeason.name || (isSpecial ? 'Спецматериалы' : `Сезон ${numSeason}`)).trim(),
            overview: rawSeason.overview && typeof rawSeason.overview === 'string' && rawSeason.overview.trim() ? rawSeason.overview.trim() : null,
            posterUrl: this.buildImageUrl(rawSeason.poster_path, 'w500'),
            airDate: rawSeason.air_date || null,
            episodes
        };
    }

    /**
     * Normalize single episode into bounded Episode DTO.
     * @param {Object} rawEp 
     * @param {number|string} tmdbId 
     * @param {number|string} seasonNumber 
     * @returns {Object}
     */
    normalizeSeasonEpisode(rawEp, tmdbId, seasonNumber) {
        const epNum = Number(rawEp.episode_number) || 0;
        const voteAvg = (rawEp.vote_average !== undefined && rawEp.vote_average !== null && Number(rawEp.vote_average) > 0)
            ? Number(Number(rawEp.vote_average).toFixed(1))
            : null;
        const voteCnt = (rawEp.vote_count !== undefined && rawEp.vote_count !== null && Number(rawEp.vote_count) > 0)
            ? Number(rawEp.vote_count)
            : null;

        return {
            tmdbId: Number(tmdbId),
            seasonNumber: Number(seasonNumber),
            episodeNumber: epNum,
            name: (rawEp.name || `Серия ${epNum}`).trim(),
            overview: rawEp.overview && typeof rawEp.overview === 'string' && rawEp.overview.trim() ? rawEp.overview.trim() : null,
            airDate: rawEp.air_date || null,
            runtime: Number(rawEp.runtime) > 0 ? Number(rawEp.runtime) : null,
            stillUrl: this.buildImageUrl(rawEp.still_path, 'w500'),
            voteAverage: voteAvg,
            voteCount: voteCnt,
            episodeType: rawEp.episode_type || null,
            productionCode: rawEp.production_code ? String(rawEp.production_code).trim() : null,
            source: 'tmdb'
        };
    }

    /**
     * Normalize TMDB TV show details into consistent application movie/series shape.
     * @param {Object} tv - TMDB TV details response
     * @param {string} [imdbId] - Reliable IMDb ID, when available
     * @returns {Object}
     */
    normalizeTvData(tv, imdbId = '') {
        const selectedLogo = this.selectBestLogo(tv.images?.logos);
        const voteAverage = (tv.vote_average !== undefined && tv.vote_average !== null && Number(tv.vote_average) > 0)
            ? Number(tv.vote_average)
            : 0;
        const voteCount = (tv.vote_count !== undefined && tv.vote_count !== null && Number(tv.vote_count) > 0)
            ? Number(tv.vote_count)
            : 0;
        const contentRatings = tv.content_ratings?.results || [];
        const usRating = contentRatings.find(r => r.iso_3166_1 === 'US')?.rating || '';
        const isMiniSeries = (tv.type || '').toLowerCase() === 'miniseries';
        const seasons = this.normalizeSeasons(tv.seasons);
        const seasonsInfo = seasons
            .filter(s => !s.isSpecial && s.number > 0)
            .map(s => ({ number: s.number, episodesCount: s.episodeCount }));

        return {
            kinopoiskId: null,
            tmdbId: tv.id || null,
            name: tv.name || '',
            alternativeName: tv.original_name || '',
            posterUrl: this.buildImageUrl(tv.poster_path),
            backdrop: this.buildImageUrl(tv.backdrop_path),
            logoUrl: selectedLogo?.url || null,
            logoSelectionVersion: this.logoSelectionVersion,
            year: this.getYear(tv.first_air_date),
            description: tv.overview || '',
            slogan: tv.tagline || '',
            genres: Array.isArray(tv.genres) ? tv.genres.map(genre => genre.name).filter(Boolean) : [],
            countries: Array.isArray(tv.production_countries)
                ? tv.production_countries.map(country => country.name).filter(Boolean)
                : (Array.isArray(tv.origin_country) ? tv.origin_country : []),
            duration: Array.isArray(tv.episode_run_time) && tv.episode_run_time.length > 0 ? Number(tv.episode_run_time[0]) : 0,
            type: isMiniSeries ? 'mini-series' : 'tv-series',
            isSeries: true,
            persons: this.normalizePersons(tv.credits),
            budget: null,
            fees: { world: null, usa: null, russia: null },
            premiere: {
                world: tv.first_air_date || null,
                russia: null,
                digital: null
            },
            ratingMpaa: usRating,
            externalId: {
                imdb: imdbId || tv.external_ids?.imdb_id || tv.imdb_id || '',
                tmdb: tv.id || null
            },
            additionalDataSource: 'tmdb',
            tmdbMetadataFields: this.getPopulatedMetadataFields(tv, []),

            // TV specific rich metadata
            status: tv.status || null,
            inProduction: Boolean(tv.in_production),
            totalSeasons: Number(tv.number_of_seasons) || seasons.filter(s => !s.isSpecial).length,
            totalEpisodes: Number(tv.number_of_episodes) || seasons.reduce((sum, s) => sum + s.episodeCount, 0),
            seasons: seasons,
            seasonsInfo: seasonsInfo,
            nextEpisode: this.normalizeEpisode(tv.next_episode_to_air),
            lastEpisode: this.normalizeEpisode(tv.last_episode_to_air),

            // Multi-Catalog Isolated Ratings
            ratingTmdb: voteAverage,
            voteCount: voteCount,
            vote_average: voteAverage,
            vote_count: voteCount,
            kpRating: 0,
            imdbRating: 0,
            votes: { kp: 0, imdb: 0, tmdb: voteCount },
            ageRating: 0,

            // Rich collections
            productionCompanies: (() => {
                if (!Array.isArray(tv.production_companies)) return [];
                const seen = new Set();
                return tv.production_companies.map(c => ({
                    tmdbId: c.id || null,
                    name: (c.name || '').trim(),
                    logoUrl: this.buildImageUrl(c.logo_path, 'w185'),
                    originCountry: c.origin_country || null
                })).filter(c => {
                    if (!c.name) return false;
                    const key = c.tmdbId ? `id:${c.tmdbId}` : `name:${c.name.toLowerCase()}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            })(),
            spokenLanguages: Array.isArray(tv.spoken_languages)
                ? tv.spoken_languages.map(l => ({
                    code: l.iso_639_1 || '',
                    englishName: l.english_name || null,
                    name: l.name || null
                })).filter(l => l.code.length > 0 || (l.name && l.name.length > 0))
                : [],
            collection: null,
            videos: this.normalizeVideos(tv.videos),
            credits: {
                cast: (Array.isArray(tv.credits?.cast) ? tv.credits.cast : []).slice(0, 30).map(p => ({
                    id: p.id,
                    name: p.name || '',
                    originalName: p.original_name || p.name || '',
                    character: p.character || '',
                    photoUrl: this.buildImageUrl(p.profile_path, 'w185'),
                    order: typeof p.order === 'number' ? p.order : null
                })),
                crew: (Array.isArray(tv.credits?.crew) ? tv.credits.crew : []).slice(0, 30).map(p => ({
                    id: p.id,
                    name: p.name || '',
                    job: p.job || '',
                    department: p.department || '',
                    photoUrl: this.buildImageUrl(p.profile_path, 'w185')
                }))
            },
            audience: [],
            distributors: null,
            sequelsAndPrequels: [],
            similarMovies: []
        };
    }

    /**
     * Normalize and rank TMDB video trailers/teasers.
     * @param {Object} videosObj - Raw TMDB videos response object
     * @returns {Array<Object>} - Bounded list of up to 20 normalized videos
     */
    normalizeVideos(videosObj = {}) {
        const results = Array.isArray(videosObj?.results) ? videosObj.results : [];
        if (results.length === 0) return [];

        const getScore = (v) => {
            const type = (v.type || '').toLowerCase();
            const isOfficial = Boolean(v.official);
            if (type === 'trailer') return isOfficial ? 100 : 80;
            if (type === 'teaser') return isOfficial ? 90 : 70;
            if (type === 'clip') return isOfficial ? 60 : 50;
            if (type === 'featurette') return 40;
            if (type === 'behind the scenes') return 30;
            return 20;
        };

        const sorted = [...results]
            .filter(v => v && v.key && (v.site || '').toLowerCase() === 'youtube')
            .sort((a, b) => {
                const scoreDiff = getScore(b) - getScore(a);
                if (scoreDiff !== 0) return scoreDiff;
                const dateA = a.published_at ? new Date(a.published_at).getTime() : 0;
                const dateB = b.published_at ? new Date(b.published_at).getTime() : 0;
                return dateB - dateA;
            })
            .slice(0, 20);

        return sorted.map(v => ({
            tmdbId: String(v.id || ''),
            provider: v.site || 'YouTube',
            key: String(v.key || ''),
            name: String(v.name || ''),
            type: String(v.type || 'Trailer'),
            official: Boolean(v.official),
            language: v.iso_639_1 || null,
            country: v.iso_3166_1 || null,
            publishedAt: v.published_at || null
        }));
    }

    normalizePersons(credits = {}) {
        const cast = Array.isArray(credits.cast) ? credits.cast : [];
        const crew = Array.isArray(credits.crew) ? credits.crew : [];

        return [
            ...cast.map(person => ({
                id: person.id,
                name: person.name || '',
                enName: person.original_name || person.name || '',
                photo: this.buildImageUrl(person.profile_path),
                profession: 'Актеры',
                enProfession: 'ACTOR',
                description: person.character || ''
            })),
            ...crew.map(person => ({
                id: person.id,
                name: person.name || '',
                enName: person.original_name || person.name || '',
                photo: this.buildImageUrl(person.profile_path),
                profession: person.job || person.department || '',
                enProfession: this.getCrewProfession(person),
                description: person.job || ''
            }))
        ];
    }

    /**
     * Select one deterministic, localized TMDB title logo without retaining the
     * unbounded images payload in the normalized DTO.
     * Priority: Russian -> English -> language-neutral -> other languages.
     * @param {Array<Object>} logos
     * @returns {{url:string,filePath:string,language:string|null,width:number,height:number,voteAverage:number,voteCount:number}|null}
     */
    selectBestLogo(logos = []) {
        if (!Array.isArray(logos) || logos.length === 0) return null;

        const languageRank = (language) => {
            if (language === 'ru') return 0;
            if (language === 'en') return 1;
            if (language === null) return 2;
            return 3;
        };

        const candidates = logos.map((logo) => {
            const filePath = typeof logo?.file_path === 'string' ? logo.file_path.trim() : '';
            if (!/^\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(filePath)) return null;

            const width = Math.max(0, Number(logo.width) || 0);
            const height = Math.max(0, Number(logo.height) || 0);
            if (!width || !height) return null;

            const rawLanguage = logo.iso_639_1;
            const language = rawLanguage === null || rawLanguage === undefined || rawLanguage === ''
                ? null
                : String(rawLanguage).toLowerCase();
            const voteAverage = Math.max(0, Number(logo.vote_average) || 0);
            const voteCount = Math.max(0, Number(logo.vote_count) || 0);

            return {
                url: this.buildImageUrl(filePath, 'w500'),
                filePath,
                language,
                width,
                height,
                voteAverage,
                voteCount,
                languageRank: languageRank(language),
                hasSufficientResolution: width >= 500 && height >= 100,
                pixelArea: width * height
            };
        }).filter(Boolean);

        candidates.sort((a, b) =>
            a.languageRank - b.languageRank ||
            Number(b.hasSufficientResolution) - Number(a.hasSufficientResolution) ||
            b.voteAverage - a.voteAverage ||
            b.voteCount - a.voteCount ||
            b.pixelArea - a.pixelArea ||
            a.filePath.localeCompare(b.filePath)
        );

        if (candidates.length === 0) return null;
        const selected = candidates[0];
        return {
            url: selected.url,
            filePath: selected.filePath,
            language: selected.language,
            width: selected.width,
            height: selected.height,
            voteAverage: selected.voteAverage,
            voteCount: selected.voteCount
        };
    }

    getCrewProfession(person) {
        const job = (person.job || '').toLowerCase();
        const department = (person.department || '').toLowerCase();

        if (job === 'director') return 'DIRECTOR';
        if (job.includes('writer') || job.includes('screenplay') || department === 'writing') return 'WRITER';
        if (job.includes('producer') || department === 'production') return 'PRODUCER';
        if (job.includes('composer') || department === 'sound') return 'COMPOSER';
        if (job.includes('editor') || department === 'editing') return 'EDITOR';
        if (job.includes('cinematograph') || department === 'camera') return 'OPERATOR';
        if (department === 'art') return 'DESIGNER';
        return (person.department || person.job || '').toUpperCase();
    }

    getEarliestReleaseDate(releaseDates, acceptedTypes, countryCode = '') {
        const dates = releaseDates.flatMap(country => {
            if (countryCode && country.iso_3166_1 !== countryCode) return [];
            return (country.release_dates || [])
                .filter(release => acceptedTypes.includes(release.type) && release.release_date)
                .map(release => release.release_date);
        });

        return dates.sort()[0] || null;
    }

    getCertification(releaseDates, countryCode) {
        const country = releaseDates.find(item => item.iso_3166_1 === countryCode);
        const certification = country?.release_dates?.find(release => release.certification)?.certification;
        return certification || '';
    }

    buildImageUrl(path, size = 'original') {
        return path ? `https://image.tmdb.org/t/p/${size}${path}` : '';
    }

    getYear(date) {
        const match = typeof date === 'string' ? date.match(/^\d{4}/) : null;
        return match ? Number(match[0]) : 0;
    }

    isValidImdbId(imdbId) {
        return typeof imdbId === 'string' && /^tt\d{7,10}$/i.test(imdbId.trim());
    }

    getPopulatedMetadataFields(movie, releaseDates) {
        const fields = [];
        if (movie.overview) fields.push('description');
        if (movie.genres?.length) fields.push('genres');
        if (movie.poster_path) fields.push('posterUrl');
        if (movie.credits?.cast?.length || movie.credits?.crew?.length) fields.push('persons');
        if (movie.runtime) fields.push('duration');
        if (movie.production_countries?.length) fields.push('countries');
        if (movie.tagline) fields.push('slogan');
        if (movie.budget) fields.push('budget');
        if (movie.revenue) fields.push('fees.world');
        if (releaseDates.length) fields.push('premiere', 'ratingMpaa');
        return fields;
    }

    /**
     * Fill only missing, TMDB-compatible fields. Kinopoisk-specific fields and
     * the Kinopoisk ID are intentionally never copied from TMDB.
     * @param {Object} kpMovie - Movie data normalized from Kinopoisk
     * @param {Object} tmdbData - Movie data normalized from TMDB
     * @returns {Object} Kinopoisk movie enriched with only missing TMDB fields
     */
    static mergeWithTmdbData(kpMovie, tmdbData) {
        const mergedMovie = Object.assign({}, kpMovie);
        const addedTmdbFields = [];

        const isMissingText = value => typeof value !== 'string' || !value.trim();
        const isMissingArray = value => !Array.isArray(value) || value.length === 0;
        const isMissingDate = value => value === null || value === undefined || value === '';
        const addField = (fieldName, shouldMerge, value, assign) => {
            if (!shouldMerge) return;
            assign(value);
            addedTmdbFields.push(fieldName);
        };

        addField('description', isMissingText(kpMovie.description) && !isMissingText(tmdbData.description), tmdbData.description, value => {
            mergedMovie.description = value;
        });
        addField('genres', isMissingArray(kpMovie.genres) && !isMissingArray(tmdbData.genres), tmdbData.genres, value => {
            mergedMovie.genres = [...value];
        });
        addField('persons', isMissingArray(kpMovie.persons) && !isMissingArray(tmdbData.persons), tmdbData.persons, value => {
            mergedMovie.persons = [...value];
        });
        addField('posterUrl', isMissingText(kpMovie.posterUrl) && !isMissingText(tmdbData.posterUrl), tmdbData.posterUrl, value => {
            mergedMovie.posterUrl = value;
        });
        addField('backdrop', isMissingText(kpMovie.backdrop) && !isMissingText(tmdbData.backdrop), tmdbData.backdrop, value => {
            mergedMovie.backdrop = value;
        });
        addField('slogan', isMissingText(kpMovie.slogan) && !isMissingText(tmdbData.slogan), tmdbData.slogan, value => {
            mergedMovie.slogan = value;
        });
        addField('countries', isMissingArray(kpMovie.countries) && !isMissingArray(tmdbData.countries), tmdbData.countries, value => {
            mergedMovie.countries = [...value];
        });
        addField('duration', !Number(kpMovie.duration) && Number(tmdbData.duration) > 0, tmdbData.duration, value => {
            mergedMovie.duration = value;
        });

        const kpPremiere = kpMovie.premiere || {};
        const tmdbPremiere = tmdbData.premiere || {};
        const mergedPremiere = Object.assign({}, kpPremiere);
        let hasPremiereUpdates = false;

        if (isMissingDate(kpPremiere.world) && !isMissingDate(tmdbPremiere.world)) {
            mergedPremiere.world = tmdbPremiere.world;
            addedTmdbFields.push('premiere.world');
            hasPremiereUpdates = true;
        }
        if (isMissingDate(kpPremiere.digital) && !isMissingDate(tmdbPremiere.digital)) {
            mergedPremiere.digital = tmdbPremiere.digital;
            addedTmdbFields.push('premiere.digital');
            hasPremiereUpdates = true;
        }
        if (hasPremiereUpdates) {
            mergedMovie.premiere = mergedPremiere;
        }

        addField('ratingMpaa', isMissingText(kpMovie.ratingMpaa) && !isMissingText(tmdbData.ratingMpaa), tmdbData.ratingMpaa, value => {
            mergedMovie.ratingMpaa = value;
        });

        if (addedTmdbFields.length > 0) {
            const previousTmdbFields = Array.isArray(kpMovie.additionalDataFields)
                ? kpMovie.additionalDataFields
                : [];
            mergedMovie.additionalDataSource = 'tmdb';
            mergedMovie.additionalDataFields = [...new Set([...previousTmdbFields, ...addedTmdbFields])];
        }

        return mergedMovie;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TMDBService;
}
if (typeof window !== 'undefined') {
    window.TMDBService = TMDBService;
}
