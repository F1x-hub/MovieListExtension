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
        // Bump when the matching policy changes so stale negative results do
        // not suppress a newly eligible HTML mapping for 24 hours.
        // v4 also stores the KP secondary/original title needed for IMDb HTML
        // search after a card is resolved from a KP-only identity.
        this.cacheKey = 'home_kp_html_mapping_v4';
        // Negative mappings are provisional because KP HTML can temporarily
        // return an SSO shell or an incompletely hydrated search page.
        this.negativeRetryMs = 15 * 60 * 1000;
        this.inFlight = new Map();
        this.cacheWritePromise = Promise.resolve();
    }

    async resolve(item = {}, options = {}) {
        console.info('[KPCardTrace] resolve:start', {
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
        if (this.inFlight.has(key)) {
            console.info('[KPCardTrace] resolve:in-flight-hit', { key });
            return this.inFlight.get(key);
        }

        const promise = this._resolveUnmapped(item, key, mediaType, tmdbId, options)
            .finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, promise);
        return promise;
    }

    async _resolveUnmapped(item, key, mediaType, tmdbId, options = {}) {
        const cache = await this._readCache();
        const cached = cache[key];
        if (cached?.status === 'resolved' && Number(cached.kpId) > 0
            && (options.requireRating !== true || Number(cached.kpRating) > 0)) {
            console.info('[KPCardTrace] resolve:cache-hit', {
                key,
                kpId: cached.kpId,
                kpRating: cached.kpRating || 0,
                imdbRating: cached.imdbRating || 0,
                imdbId: cached.imdbId || null
            });
            return {
                kinopoiskId: Number(cached.kpId),
                kpRating: Number(cached.kpRating) || 0,
                kpVotes: Number(cached.kpVotes) || 0,
                imdbRating: Number(cached.imdbRating) || 0,
                imdbId: cached.imdbId || null,
                originalTitle: cached.originalTitle || null,
                source: 'html-cache'
            };
        }
        if (cached?.status === 'not-found'
            && Number(cached.expiresAt) > Date.now()
            && Number(cached.retryAfter) > Date.now()
            && options.forceRetry !== true) {
            console.info('[KPCardTrace] resolve:negative-cache-hit', {
                key,
                retryAfter: cached.retryAfter
            });
            return null;
        }

        const titles = [item.name || item.title, item.alternativeName || item.originalName || item.original_title]
            .filter(value => typeof value === 'string' && value.trim())
            .map(value => value.trim())
            .filter((value, index, values) => values.indexOf(value) === index);
        const year = Number(item.year || String(item.releaseDate || item.release_date || '').slice(0, 4)) || null;

        if (!this.htmlSearchService || titles.length === 0) {
            await this._writeNegative(cache, key);
            return null;
        }

        const result = await this.htmlSearchService.findMovieByTitle(titles, year, {
            sourceName: 'HomeMovieNavigationService.htmlSearch',
            allowYearTolerance: true,
            maxYearDelta: 1,
            mediaType,
            requestKey: options.requestKey || null,
            priority: options.priority || 'visible-identity',
            sessionId: options.sessionId || null,
            // Identity and rating are separate contracts. A search card can
            // expose a valid KP ID before its numeric rating is rendered.
            requireRating: false
        });
        console.info('[KPCardTrace] resolve:html-result', {
            key,
            titles,
            year,
            kpId: result?.kinopoiskId || 0,
            kpRating: result?.kpRating || 0,
            imdbRating: result?.imdbRating || 0,
            imdbId: result?.imdbId || null
        });
        if (!result?.kinopoiskId) {
            console.warn('[HomeMovieNavigation] No Kinopoisk HTML mapping found:', {
                tmdbId,
                mediaType,
                titles,
                year
            });
            await this._writeNegative(cache, key);
            return null;
        }

        cache[key] = {
            status: 'resolved',
            kpId: Number(result.kinopoiskId),
            tmdbId,
            mediaType,
            title: titles[0],
            year,
            source: 'kinopoisk-html',
            verified: true,
            kpRating: Number(result.kpRating) || 0,
            kpVotes: Number(result.kpVotes) || 0,
            imdbRating: Number(result.imdbRating) || 0,
            imdbId: result.imdbId || null,
            originalTitle: result.originalTitle || result.originalName || null,
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
            kpRating: Number(result.kpRating) || 0,
            kpVotes: Number(result.kpVotes) || 0,
            imdbRating: Number(result.imdbRating) || 0,
            imdbId: result.imdbId || null,
            originalTitle: result.originalTitle || result.originalName || null,
            source: 'kinopoisk-html'
        };
    }

    async _resolveDirectHtmlRatings(item, directId, options = {}) {
        const titles = [item.name || item.title, item.alternativeName || item.originalName || item.original_title]
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
                requestKey: options.requestKey || null,
                requireRating: true
            });
            const resultId = Number(result?.kinopoiskId) || 0;
            if (resultId !== directId) {
                console.info('[KPCardTrace] resolve:direct-rating-mismatch', {
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
            console.info('[KPCardTrace] resolve:direct-rating-result', {
                directId,
                title: titles[0],
                year,
                ...ratings
            });
            return ratings;
        } catch (error) {
            console.info('[KPCardTrace] resolve:direct-rating-error', {
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
