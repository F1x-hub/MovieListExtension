/**
 * Resolves a Home TMDB-only card to a Kinopoisk ID only when the user opens it.
 * This service never calls the Kinopoisk API.
 */
class HomeMovieNavigationService {
    constructor({ kinopoiskService = null, htmlSearchService = null } = {}) {
        this.kinopoiskService = kinopoiskService;
        this.htmlSearchService = htmlSearchService || (
            typeof KinopoiskPersonHtmlService !== 'undefined'
                ? new KinopoiskPersonHtmlService({ kinopoiskService })
                : null
        );
        // v5 contains only mappings checked against real KP title, year, and type.
        this.cacheKey = 'home_kp_html_mapping_v5';
        this.resolvedCacheTtlMs = 30 * 24 * 60 * 60 * 1000;
        // Negative mappings are provisional because KP HTML can temporarily
        // return an SSO shell or an incompletely hydrated search page.
        this.negativeRetryMs = 15 * 60 * 1000;
        this.inFlight = new Map();
        this.cacheWritePromise = Promise.resolve();
    }

    /**
     * [KPCardTrace] diagnostics run per card and per search, so they are
     * opt-in: localStorage 'movielist:debug-ratings' = '1'. Errors always log.
     * @param {string} event
     * @param {Object} [details]
     */
    _kpTrace(event, details = {}) {
        if (event.includes('error')) {
            console.warn('[KPCardTrace]', event, details);
            return;
        }
        let enabled;
        try {
            enabled = globalThis.localStorage?.getItem('movielist:debug-ratings') === '1';
        } catch {
            enabled = false;
        }
        if (enabled) console.info('[KPCardTrace]', event, details);
    }

    async resolve(item = {}, options = {}) {
        this._kpTrace('resolve:start', {
            tmdbId: item.tmdbId || item.id || null,
            title: item.name || item.title || null,
            year: item.year || item.releaseDate || item.release_date || null,
            mediaType: item.mediaType || item.type || null
        });
        const directId = Number(item.kinopoiskId || item.movieId);
        if (Number.isSafeInteger(directId) && directId > 0) {
            const directResult = {
                kinopoiskId: directId,
                originalTitle: item.englishTitle
                    || item.alternativeName
                    || item.originalTitle
                    || item.originalName
                    || item.original_title
                    || null,
                kpRating: Number(item.kpRating) || 0,
                kpVotes: Number(item.kpVotes) || 0,
                imdbRating: Number(item.imdbRating) || 0,
                imdbId: item.imdbId || null,
                source: 'card'
            };

            if (options.lookupRatings === true
                && (directResult.kpRating <= 0 || directResult.imdbRating <= 0)) {
                const htmlRatings = await this._resolveDirectHtmlRatings(item, directId, options);
                return { ...directResult, ...htmlRatings, source: 'card+html' };
            }

            return directResult;
        }

        const tmdbId = Number(item.tmdbId || item.id);
        const mediaType = this._normalizeMediaType(item.mediaType || item.type);
        if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return null;

        const key = `${mediaType}:${tmdbId}`;
        // The shared lookup always reports failures; each caller then sees
        // { failed } only if it asked for it (a click expects a KP ID or null).
        const forCaller = result => (result?.failed && !options.reportFailure ? null : result);
        if (this.inFlight.has(key)) {
            this._kpTrace('resolve:in-flight-hit', { key });
            return forCaller(await this.inFlight.get(key));
        }

        const promise = this._resolveUnmapped(item, key, mediaType, tmdbId, { ...options, reportFailure: true })
            .finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, promise);
        return forCaller(await promise);
    }

    async _resolveUnmapped(item, key, mediaType, tmdbId, options = {}) {
        const cache = await this._readCache();
        const cached = cache[key];
        const titles = this._requestedTitles(item);
        const year = this._requestedYear(item);
        const cacheAge = Date.now() - Number(cached?.updatedAt);
        if (options.forceRetry !== true
            && cached?.status === 'resolved' && cached.verified === true && Number(cached.kpId) > 0
            && cacheAge >= 0 && cacheAge < this.resolvedCacheTtlMs
            && this._isVerifiedIdentity(cached, titles, year, mediaType)
            && (options.requireRating !== true || Number(cached.kpRating) > 0)) {
            this._kpTrace('resolve:cache-hit', {
                key,
                kpId: cached.kpId,
                kpRating: cached.kpRating || 0,
                imdbRating: cached.imdbRating || 0,
                imdbId: cached.imdbId || null
            });
            return {
                kinopoiskId: Number(cached.kpId),
                tmdbId: Number(cached.tmdbId),
                kpRating: Number(cached.kpRating) || 0,
                kpVotes: Number(cached.kpVotes) || 0,
                imdbRating: Number(cached.imdbRating) || 0,
                imdbId: cached.imdbId || null,
                originalTitle: cached.originalTitle || null,
                name: cached.title,
                year: Number(cached.year),
                mediaType: cached.resolvedMediaType,
                verified: true,
                source: 'html-cache'
            };
        }
        if (cached?.status === 'not-found'
            && Number(cached.expiresAt) > Date.now()
            && Number(cached.retryAfter) > Date.now()
            && options.forceRetry !== true) {
            this._kpTrace('resolve:negative-cache-hit', {
                key,
                retryAfter: cached.retryAfter
            });
            return null;
        }

        if (!this.htmlSearchService || titles.length === 0) {
            await this._writeNegative(cache, key);
            return null;
        }

        const result = await this.htmlSearchService.findMovieByTitle(titles, year, {
            sourceName: 'HomeMovieNavigationService.htmlSearch',
            allowYearTolerance: true,
            maxYearDelta: 1,
            mediaType,
            requireVerifiedIdentity: true,
            requestKey: options.requestKey || null,
            priority: options.priority || 'visible-identity',
            sessionId: options.sessionId || null,
            // Identity and rating are separate contracts. A search card can
            // expose a valid KP ID before its numeric rating is rendered.
            requireRating: false,
            reportFailure: true
        });
        if (result?.failed) {
            // The search did not run to completion: no negative mapping, so
            // the next attempt is not blocked for the negative-retry window.
            console.warn('[HomeMovieNavigation] Kinopoisk search failed:', { tmdbId, mediaType, reason: result.reason });
            return options.reportFailure ? { failed: true, reason: result.reason } : null;
        }
        this._kpTrace('resolve:html-result', {
            key,
            titles,
            year,
            kpId: result?.kinopoiskId || 0,
            kpRating: result?.kpRating || 0,
            imdbRating: result?.imdbRating || 0,
            imdbId: result?.imdbId || null
        });
        if (!Number.isSafeInteger(Number(result?.kinopoiskId)) || Number(result.kinopoiskId) <= 0
            || !this._isVerifiedIdentity(result, titles, year, mediaType)) {
            console.warn('[HomeMovieNavigation] No Kinopoisk HTML mapping found:', {
                tmdbId,
                mediaType,
                titles,
                year,
                candidateId: Number(result?.kinopoiskId) || null,
                candidateTitle: result?.name || result?.title || null,
                candidateYear: Number(result?.year) || null,
                candidateMediaType: result?.mediaType || result?.type || null
            });
            await this._writeNegative(cache, key);
            return null;
        }

        cache[key] = {
            status: 'resolved',
            kpId: Number(result.kinopoiskId),
            tmdbId,
            mediaType,
            title: String(result.name || result.title || '').trim(),
            originalTitle: String(result.originalTitle || result.originalName || '').trim() || null,
            year: Number(result.year),
            resolvedMediaType: this._normalizeMediaType(result.mediaType || result.type),
            source: 'kinopoisk-html',
            verified: true,
            kpRating: Number(result.kpRating) || 0,
            kpVotes: Number(result.kpVotes) || 0,
            imdbRating: Number(result.imdbRating) || 0,
            imdbId: result.imdbId || null,
            updatedAt: Date.now()
        };
        await this._writeCache(cache);
        console.log('[HomeMovieNavigation] HTML mapping resolved:', {
            tmdbId,
            mediaType,
            title: titles[0],
            year,
            kinopoiskId: Number(result.kinopoiskId)
        });
        return {
            kinopoiskId: Number(result.kinopoiskId),
            tmdbId,
            name: result.name || result.title,
            originalTitle: result.originalTitle || result.originalName || null,
            year: Number(result.year),
            mediaType: this._normalizeMediaType(result.mediaType || result.type),
            verified: true,
            kpRating: Number(result.kpRating) || 0,
            kpVotes: Number(result.kpVotes) || 0,
            imdbRating: Number(result.imdbRating) || 0,
            imdbId: result.imdbId || null,
            source: 'kinopoisk-html'
        };
    }

    _requestedTitles(item) {
        return [item.searchTitle, item.name || item.title, item.alternativeName || item.originalName || item.original_title]
            .filter(value => typeof value === 'string' && value.trim())
            .map(value => value.trim())
            .filter((value, index, values) => values.indexOf(value) === index);
    }

    _requestedYear(item) {
        return Number(item.year || String(item.releaseDate || item.release_date || '').slice(0, 4)) || null;
    }

    _normalizeIdentityTitle(value) {
        return String(value || '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    _isVerifiedIdentity(candidate, requestedTitles, requestedYear, requestedMediaType) {
        const expectedTitles = requestedTitles.map(title => this._normalizeIdentityTitle(title)).filter(Boolean);
        const candidateTitles = [candidate?.name, candidate?.title, candidate?.originalTitle, candidate?.originalName]
            .map(title => this._normalizeIdentityTitle(title)).filter(Boolean);
        const candidateYear = Number(candidate?.year);
        const candidateMediaType = this._normalizeMediaType(
            candidate?.resolvedMediaType || candidate?.mediaType || candidate?.type
        );
        return expectedTitles.length > 0
            && expectedTitles.some(title => candidateTitles.includes(title))
            && Number.isSafeInteger(Number(requestedYear)) && Number(requestedYear) > 0
            && Number.isSafeInteger(candidateYear) && candidateYear > 0
            && Math.abs(candidateYear - Number(requestedYear)) <= 1
            && candidateMediaType === requestedMediaType;
    }

    async _resolveDirectHtmlRatings(item, directId, options = {}) {
        const titles = [item.searchTitle, item.name || item.title, item.alternativeName || item.originalName || item.original_title]
            .filter(value => typeof value === 'string' && value.trim())
            .map(value => value.trim())
            .filter((value, index, values) => values.indexOf(value) === index);
        const year = Number(item.year || String(item.releaseDate || item.release_date || '').slice(0, 4)) || null;

        if (!this.htmlSearchService?.findMovieByTitle || titles.length === 0) {
            return {};
        }

        try {
            const result = await this.htmlSearchService.findMovieByTitle(titles, year, {
                sourceName: options.sourceName || 'HomeMovieNavigationService.directHtmlRatings',
                allowYearTolerance: true,
                maxYearDelta: 1,
                mediaType: this._normalizeMediaType(item.mediaType || item.type),
                requireVerifiedIdentity: true,
                requestKey: options.requestKey || null,
                requireRating: true
            });
            const resultId = Number(result?.kinopoiskId) || 0;
            if (resultId !== directId || !this._isVerifiedIdentity(
                result,
                titles,
                year,
                this._normalizeMediaType(item.mediaType || item.type)
            )) {
                this._kpTrace('resolve:direct-rating-mismatch', {
                    directId,
                    resultId,
                    title: titles[0],
                    year
                });
                return {};
            }

            const ratings = {
                kpRating: Number(result?.kpRating) || 0,
                kpVotes: Number(result?.kpVotes) || 0,
                imdbRating: Number(result?.imdbRating) || 0,
                imdbId: result?.imdbId || null,
                originalTitle: result?.originalTitle || result?.originalName || null
            };
            this._kpTrace('resolve:direct-rating-result', {
                directId,
                title: titles[0],
                year,
                ...ratings
            });
            return ratings;
        } catch (error) {
            this._kpTrace('resolve:direct-rating-error', {
                directId,
                title: titles[0],
                message: error.message
            });
            return {};
        }
    }

    async _writeNegative(cache, key) {
        cache[key] = {
            status: 'not-found',
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            retryAfter: Date.now() + this.negativeRetryMs,
            updatedAt: Date.now()
        };
        await this._writeCache(cache);
    }

    _normalizeMediaType(type) {
        const value = String(type || '').toLowerCase();
        return ['tv', 'tv-series', 'series', 'anime', 'cartoon'].includes(value) ? 'tv' : 'movie';
    }

    async _readCache() {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return {};
        return new Promise(resolve => {
            chrome.storage.local.get([this.cacheKey], result => resolve(result?.[this.cacheKey] || {}));
        });
    }

    withCacheWriteLock(callback) {
        const locks = globalThis.navigator?.locks;
        return locks?.request
            ? locks.request(`home-kp-mapping-cache:${this.cacheKey}`, callback)
            : callback();
    }

    async _writeCache(cache) {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        const write = () => this.withCacheWriteLock(async () => {
            const latest = await this._readCache();
            const merged = { ...latest };
            Object.entries(cache).forEach(([key, value]) => {
                const previous = merged[key];
                if (!previous || Number(value?.updatedAt) >= Number(previous?.updatedAt)) {
                    merged[key] = value;
                }
            });
            await new Promise(resolve => {
                chrome.storage.local.set({ [this.cacheKey]: merged }, resolve);
            });
        });
        this.cacheWritePromise = this.cacheWritePromise.then(write, write);
        return this.cacheWritePromise;
    }
}

if (typeof window !== 'undefined') window.HomeMovieNavigationService = HomeMovieNavigationService;
if (typeof globalThis !== 'undefined') globalThis.HomeMovieNavigationService = HomeMovieNavigationService;
if (typeof module !== 'undefined' && module.exports) module.exports = HomeMovieNavigationService;
