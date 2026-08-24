/**
 * KinopoiskPersonHtmlService - reads person filmography from Kinopoisk HTML.
 *
 * Kinopoisk currently embeds the page data in
 * window.Ya.__ssr_initial_data.apolloState. Reading that state gives us native
 * Kinopoisk film IDs without issuing one API matching request per film.
 */
class KinopoiskPersonHtmlService {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || 'https://www.kinopoisk.ru';
        this.fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
        this.kinopoiskService = options.kinopoiskService || null;
        this.movieSearchCache = new Map();
        this.movieSearchInFlight = new Map();
        this.movieSearchBlocked = false;
        this.moviePosterCache = new Map();
        this.moviePosterInFlight = new Map();
        // v3 invalidates previous promo/og:image results after switching to
        // exact `img.film-poster` extraction for every native movie ID.
        this.MOVIE_POSTER_CACHE_PREFIX = 'kp_movie_poster_html_v3_';
        this.MOVIE_POSTER_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
    }

    async getPersonFilmography(names, options = {}) {
        const candidateNames = Array.isArray(names)
            ? names.filter(name => typeof name === 'string' && name.trim())
            : [names].filter(name => typeof name === 'string' && name.trim());

        if (candidateNames.length === 0) return null;

        try {
            const searchHtml = await this._fetchHtml(
                `${this.baseUrl}/new-search/?text=${encodeURIComponent(candidateNames[0].trim())}`,
                'KinopoiskPersonHtmlService.search'
            );
            const personId = this.parsePersonSearchHtml(searchHtml, candidateNames);
            if (!personId) {
                console.warn('[KinopoiskPersonHtmlService] No person identity found in search response', {
                    length: searchHtml.length,
                    hasSsrState: searchHtml.includes('window.Ya.__ssr_initial_data'),
                    hasNameRoute: /\/name\/\d+\//i.test(searchHtml)
                });
                return null;
            }

            return await this.getPersonFilmographyById(personId, options);
        } catch (error) {
            console.warn('[KinopoiskPersonHtmlService] HTML person lookup failed:', error.message);
            return null;
        }
    }

    async getPersonFilmographyById(personId, options = {}) {
        const numericId = Number(personId);
        if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

        try {
            const html = await this._fetchHtml(
                `${this.baseUrl}/name/${numericId}/`,
                'KinopoiskPersonHtmlService.personPage',
                options
            );
            return this.parsePersonPageHtml(html, numericId);
        } catch (error) {
            console.warn('[KinopoiskPersonHtmlService] HTML person page failed:', error.message);
            return null;
        }
    }

    /**
     * Read a movie poster from the public Kinopoisk movie page without using
     * the Kinopoisk API. Results are cached by native movie ID for 30 days.
     * @param {number|string} kinopoiskId
     * @param {Object} [options]
     * @returns {Promise<string|null>}
     */
    async getMoviePosterById(kinopoiskId, options = {}) {
        const numericId = Number(kinopoiskId);
        if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

        if (this.moviePosterCache.has(numericId)) {
            return this.moviePosterCache.get(numericId);
        }
        if (this.moviePosterInFlight.has(numericId)) {
            return this.moviePosterInFlight.get(numericId);
        }

        const request = (async () => {
            const cached = await this._readMoviePosterCache(numericId);
            if (cached.hit) {
                this.moviePosterCache.set(numericId, cached.posterUrl);
                return cached.posterUrl;
            }

            try {
                const html = await this._fetchHtml(
                    `${this.baseUrl}/film/${numericId}/`,
                    'KinopoiskPersonHtmlService.moviePosterPage',
                    options
                );
                const posterUrl = this.parseMoviePosterHtml(html, numericId);
                this.moviePosterCache.set(numericId, posterUrl);
                await this._writeMoviePosterCache(numericId, posterUrl);
                return posterUrl;
            } catch (error) {
                console.warn('[KinopoiskPersonHtmlService] Movie poster page failed:', {
                    kinopoiskId: numericId,
                    message: error.message
                });
                return null;
            }
        })().finally(() => this.moviePosterInFlight.delete(numericId));

        this.moviePosterInFlight.set(numericId, request);
        return request;
    }

    /**
     * Resolve multiple native Kinopoisk movie posters with bounded concurrency.
     * @param {Array<number|string>} kinopoiskIds
     * @param {Object} [options]
     * @returns {Promise<Map<number, string|null>>}
     */
    async getMoviePostersByIds(kinopoiskIds, options = {}) {
        const ids = [...new Set((Array.isArray(kinopoiskIds) ? kinopoiskIds : [])
            .map(value => Number(value))
            .filter(value => Number.isSafeInteger(value) && value > 0))];
        const result = new Map();
        if (ids.length === 0) return result;

        let nextIndex = 0;
        const workerCount = Math.min(2, ids.length);
        const worker = async () => {
            while (nextIndex < ids.length) {
                const id = ids[nextIndex++];
                result.set(id, await this.getMoviePosterById(id, options));
            }
        };

        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return result;
    }

    /**
     * Find a movie ID through Kinopoisk's HTML search page.
     * This is a bounded HTML fallback for credits absent from the person's
     * initial SSR slice; it never calls the Kinopoisk API.
     * @param {string|string[]} titles
     * @param {number|string|null} year
     * @param {Object} [options] - Optional diagnostics sourceName
     * @returns {Promise<{kinopoiskId:number,name:string,year:number|null}|null>}
     */
    async findMovieByTitle(titles, year = null, options = {}) {
        const firstTitle = (Array.isArray(titles) ? titles : [titles])
            .find(title => typeof title === 'string' && title.trim());
        if (!firstTitle) return this._findMovieByTitle(titles, year, options);
        // Scheduler requests need one background consumer per card. The
        // background queue owns physical deduplication and cancellation
        // accounting, so do not collapse these callers in this service map.
        if (options.requestKey) return this._findMovieByTitle(titles, year, options);
        const inFlightKey = `${this._normalizeMovieTitle(firstTitle)}|${Number(year) || ''}|${options.mediaType || ''}|${options.allowYearTolerance ? 'tolerant' : 'strict'}|${Number(options.maxYearDelta) || ''}|${options.requireRating ? 'rating' : 'identity'}`;
        if (this.movieSearchInFlight.has(inFlightKey)) {
            console.info('[KPCardTrace] search:in-flight-hit', { inFlightKey });
            return this.movieSearchInFlight.get(inFlightKey);
        }
        const promise = this._findMovieByTitle(titles, year, options)
            .finally(() => this.movieSearchInFlight.delete(inFlightKey));
        this.movieSearchInFlight.set(inFlightKey, promise);
        return promise;
    }

    async _findMovieByTitle(titles, year = null, options = {}) {
        const startedAt = Date.now();
        const candidateTitles = (Array.isArray(titles) ? titles : [titles])
            .filter(title => typeof title === 'string' && title.trim())
            .map(title => title.trim())
            .filter((title, index, values) => values.indexOf(title) === index);
        if (candidateTitles.length === 0) return null;
        if (this.movieSearchBlocked) return null;

        const sourceName = options.sourceName || 'KinopoiskPersonHtmlService.movieSearch';

        const searchTitle = candidateTitles[0];
        const cacheKey = `${this._normalizeMovieTitle(searchTitle)}|${Number(year) || ''}|${options.mediaType || ''}|${options.allowYearTolerance ? 'tolerant' : 'strict'}|${Number(options.maxYearDelta) || ''}|${options.requireRating ? 'rating' : 'identity'}`;
        console.info('[KPCardTrace] search:start', {
            searchTitle,
            candidateTitles,
            year: Number(year) || null,
            cacheKey
        });
        if (this.movieSearchCache.has(cacheKey)) {
            const cached = this.movieSearchCache.get(cacheKey);
            console.info('[KPCardTrace] search:cache-hit', {
                durationMs: Date.now() - startedAt,
                searchTitle,
                result: cached
            });
            return cached;
        }
        let offscreenFailureReason = null;

        // Prefer the existing browser-context scraper. A plain extension fetch
        // can receive an SSO shell even when the same search works in Chrome.
        if (typeof this.kinopoiskService?.scrapeSearchResultsOffscreen === 'function') {
            try {
                console.info('[KPCardTrace] search:offscreen-request', {
                    searchTitle,
                    timeoutMs: 8000
                });
                globalThis.quotaTracker?.track(sourceName, 'network');
                const scrapeResponse = await this.kinopoiskService.scrapeSearchResultsOffscreen(searchTitle, {
                    limit: 10,
                    timeoutMs: 8000,
                    requireRating: options.requireRating === true,
                    mediaType: options.mediaType || null,
                    requestKey: options.requestKey
                        || `kp-search:${this._normalizeMovieTitle(searchTitle)}|${Number(year) || ''}|${options.requireRating ? 'rating' : 'identity'}`,
                    priority: options.priority || 'visible-identity',
                    sessionId: options.sessionId || null,
                    returnDiagnostics: true
                });
                const results = Array.isArray(scrapeResponse)
                    ? scrapeResponse
                    : scrapeResponse?.items;
                const failureReason = Array.isArray(scrapeResponse)
                    ? null
                    : scrapeResponse?.failureReason || null;
                const firstMovie = this._selectMovieSearchResult(results, candidateTitles, year, options);
                if (!firstMovie && results !== null) {
                    console.warn('[KinopoiskPersonHtmlService] No verified movie match in browser results:', {
                        titles: candidateTitles,
                        requestedYear: Number(year) || null,
                        allowYearTolerance: options.allowYearTolerance === true,
                        candidates: Array.isArray(results) ? results.slice(0, 10).map(movie => ({
                            id: Number(movie?.id) || null,
                            type: movie?.type || null,
                            title: movie?.title || null,
                            originalTitle: movie?.originalTitle || null,
                            year: Number(movie?.year) || null
                        })) : []
                    });
                }
                const result = firstMovie
                    ? {
                        kinopoiskId: Number(firstMovie.id),
                        name: firstMovie.title || firstMovie.originalTitle || searchTitle,
                        ...(firstMovie.originalTitle ? { originalTitle: firstMovie.originalTitle } : {}),
                        year: Number(firstMovie.year) || Number(year) || null,
                        ...(Number(firstMovie.kpRating) > 0 ? { kpRating: Number(firstMovie.kpRating) } : {}),
                        ...(Number(firstMovie.kpVotes) > 0 ? { kpVotes: Number(firstMovie.kpVotes) } : {}),
                        ...(Number(firstMovie.imdbRating) > 0 ? { imdbRating: Number(firstMovie.imdbRating) } : {}),
                        ...(firstMovie.imdbId ? { imdbId: firstMovie.imdbId } : {})
                    }
                    : null;
                console.info('[KPCardTrace] search:offscreen-result', {
                    durationMs: Date.now() - startedAt,
                    searchTitle,
                    resultCount: Array.isArray(results) ? results.length : null,
                    ratingCount: Array.isArray(results)
                        ? results.filter(item => Number(item?.kpRating) > 0).length
                        : 0,
                    result
                });
                const ratingFound = Number(result?.kpRating) > 0;
                this.movieSearchCache.set(cacheKey, result);
                if (result && (!options.requireRating || ratingFound)) return result;
                if (result && options.requireRating) {
                    console.info('[KPCardTrace] search:offscreen-without-rating', {
                        durationMs: Date.now() - startedAt,
                        searchTitle,
                        kinopoiskId: result.kinopoiskId
                    });
                }
                if (results !== null && !(result && options.requireRating && !ratingFound)) return null;
                if (failureReason && !this.isHtmlFallbackAllowed(failureReason)) {
                    console.info('[KPCardTrace] search:html-fallback-skipped', {
                        durationMs: Date.now() - startedAt,
                        searchTitle,
                        failureReason
                    });
                    this.movieSearchCache.set(cacheKey, null);
                    return null;
                }
            } catch (error) {
                offscreenFailureReason = error?.reason || 'OFFSCREEN_MESSAGE_FAILED';
                console.info('[KPCardTrace] search:offscreen-error', {
                    durationMs: Date.now() - startedAt,
                    searchTitle,
                    message: error.message
                });
                console.warn('[KinopoiskPersonHtmlService] Browser-context movie search failed:', error.message);
            }
        }

        if (offscreenFailureReason && !this.isHtmlFallbackAllowed(offscreenFailureReason)) {
            console.info('[KPCardTrace] search:html-fallback-skipped', {
                durationMs: Date.now() - startedAt,
                searchTitle,
                failureReason: offscreenFailureReason
            });
            this.movieSearchCache.set(cacheKey, null);
            return null;
        }

        try {
            console.info('[KPCardTrace] search:html-request', { searchTitle });
            const html = await this._fetchHtml(
                `${this.baseUrl}/new-search/?text=${encodeURIComponent(searchTitle)}`,
                sourceName
            );
            const responseDiagnostics = {
                title: searchTitle,
                length: html.length,
                hasFilmRoute: html.includes('/film/'),
                hasSsrState: html.includes('window.Ya.__ssr_initial_data'),
                hasSsoGate: html.includes('sso.kinopoisk.ru')
            };
            console.log('[KinopoiskPersonHtmlService] Movie search response', responseDiagnostics);
            if (responseDiagnostics.hasSsoGate && !responseDiagnostics.hasFilmRoute) {
                this.movieSearchBlocked = true;
                console.warn('[KinopoiskPersonHtmlService] Movie search blocked by Kinopoisk SSO gate');
                this.movieSearchCache.set(cacheKey, null);
                return null;
            }
            const result = this.parseMovieSearchHtml(html, candidateTitles, year, options);
            console.info('[KPCardTrace] search:html-result', {
                durationMs: Date.now() - startedAt,
                searchTitle,
                htmlLength: html.length,
                result
            });
            this.movieSearchCache.set(cacheKey, result);
            return result;
        } catch (error) {
            console.info('[KPCardTrace] search:html-error', {
                durationMs: Date.now() - startedAt,
                searchTitle,
                message: error.message
            });
            console.warn('[KinopoiskPersonHtmlService] HTML movie search failed:', {
                title: searchTitle,
                message: error.message
            });
            this.movieSearchCache.set(cacheKey, null);
            return null;
        }
    }

    isHtmlFallbackAllowed(failureReason) {
        return [
            'SCRAPE_BLOCKED_EVEN_WITH_SESSION',
            'OFFSCREEN_INIT_FAILED',
            'OFFSCREEN_UNAVAILABLE'
        ].includes(String(failureReason || ''));
    }

    async _fetchHtml(url, sourceName, options = {}) {
        if (typeof this.fetchImpl !== 'function') {
            throw new Error('fetch is not available');
        }

        globalThis.quotaTracker?.track(sourceName, 'network');
        const requestOptions = {
            credentials: 'include',
            headers: { Accept: 'text/html,application/xhtml+xml' }
        };
        if (options.signal) requestOptions.signal = options.signal;
        const response = await this.fetchImpl(url, requestOptions);

        if (!response.ok) {
            const error = new Error(`Kinopoisk HTML request failed: HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }

        return response.text();
    }

    /**
     * Parse a public Kinopoisk movie page for its poster URL.
     * The dedicated `img.film-poster` is authoritative; Apollo state is only
     * a fallback when the image tag is absent.
     * @param {string} html
     * @param {number|string|null} kinopoiskId
     * @returns {string|null}
     */
    parseMoviePosterHtml(html, kinopoiskId = null) {
        if (typeof html !== 'string' || html.length === 0) return null;

        // The movie page exposes the actual vertical poster as a dedicated
        // `img.film-poster`. It must win over social metadata: `og:image` can
        // point to a trailer thumbnail or a Kinopoisk/Yandex promo graphic.
        const imageTags = html.match(/<img\b[^>]*>/gi) || [];
        for (const tag of imageTags) {
            const className = this._readHtmlAttribute(tag, 'class');
            if (!/\bfilm-poster\b/i.test(className)) continue;

            const posterUrl = this._normalizeArtworkUrl(
                this._readHtmlAttribute(tag, 'src')
                || this._readHtmlAttribute(tag, 'data-src')
                || this._readHtmlAttribute(tag, 'data-original')
            );
            if (posterUrl) return posterUrl;
        }

        const state = this._extractSsrState(html);
        const numericId = Number(kinopoiskId);
        const apolloState = state?.apolloState || {};
        const movieKeys = Number.isSafeInteger(numericId) && numericId > 0
            ? [`Film:${numericId}`, `TvSeries:${numericId}`]
            : Object.keys(apolloState).filter(key => /^(Film|TvSeries):\d+$/.test(key));

        for (const key of movieKeys) {
            const movie = apolloState[key];
            const posterUrl = this._readPosterUrl(movie?.gallery?.posters?.vertical)
                || this._readPosterUrl(movie?.poster)
                || this._readPosterUrl(movie?.cover);
            if (posterUrl) return posterUrl;
        }

        return null;
    }

    _readHtmlAttribute(tag, attributeName) {
        const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
        return match ? (match[1] || match[2] || match[3] || '').trim() : '';
    }

    _normalizeArtworkUrl(value) {
        if (typeof value !== 'string' || value.trim().length === 0) return null;
        const decoded = value.trim()
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#x2F;/gi, '/');
        const normalized = decoded.startsWith('//') ? `https:${decoded}` : decoded;
        try {
            const url = new URL(normalized);
            return url.protocol === 'http:' || url.protocol === 'https:' ? normalized : null;
        } catch {
            return null;
        }
    }

    async _readMoviePosterCache(kinopoiskId) {
        const storageKey = `${this.MOVIE_POSTER_CACHE_PREFIX}${kinopoiskId}`;
        if (typeof chrome === 'undefined' || !chrome.storage?.local) {
            return { hit: false, posterUrl: null };
        }

        try {
            const result = await chrome.storage.local.get(storageKey);
            const entry = result[storageKey];
            if (!entry || typeof entry !== 'object' || typeof entry.timestamp !== 'number') {
                return { hit: false, posterUrl: null };
            }
            if (Date.now() - entry.timestamp > this.MOVIE_POSTER_CACHE_TTL) {
                await chrome.storage.local.remove(storageKey);
                return { hit: false, posterUrl: null };
            }
            return {
                hit: true,
                posterUrl: this._normalizeArtworkUrl(entry.posterUrl)
            };
        } catch (error) {
            console.warn('[KinopoiskPersonHtmlService] Movie poster cache read failed:', error.message);
            return { hit: false, posterUrl: null };
        }
    }

    async _writeMoviePosterCache(kinopoiskId, posterUrl) {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        const storageKey = `${this.MOVIE_POSTER_CACHE_PREFIX}${kinopoiskId}`;
        try {
            await chrome.storage.local.set({
                [storageKey]: {
                    posterUrl: posterUrl || null,
                    timestamp: Date.now()
                }
            });
        } catch (error) {
            console.warn('[KinopoiskPersonHtmlService] Movie poster cache write failed:', error.message);
        }
    }

    parsePersonSearchHtml(html, candidateNames = []) {
        if (typeof html !== 'string' || html.length === 0) return null;

        const normalizedHtml = html.replace(/\\\//g, '/');
        const wanted = candidateNames
            .map(name => this._normalizeText(name))
            .filter(Boolean);
        const people = [];
        const linkPattern = /href=["'](?:https?:\/\/[^"']+)?\/name\/(\d+)\/?(?:["'#?])/gi;
        let match;

        while ((match = linkPattern.exec(normalizedHtml))) {
            const linkStart = normalizedHtml.lastIndexOf('<a', match.index);
            const linkEnd = normalizedHtml.indexOf('</a>', match.index);
            const person = {
                id: Number(match[1]),
                name: this._normalizeText(linkStart >= 0 && linkEnd > match.index
                    ? this._stripHtml(normalizedHtml.slice(linkStart, linkEnd))
                    : '')
            };
            if (person.id > 0 && !people.some(item => item.id === person.id)) {
                people.push(person);
            }
        }

        // Some search responses expose the route only inside serialized SSR
        // state and do not render an anchor in the response body.
        if (people.length === 0) {
            const looseRoutePattern = /(?:https?:\/\/[^\s"']+)?\/name\/(\d+)\/(?![a-z])/gi;
            while ((match = looseRoutePattern.exec(normalizedHtml))) {
                const id = Number(match[1]);
                if (id > 0 && !people.some(item => item.id === id)) {
                    people.push({ id, name: '' });
                }
            }
        }

        if (people.length === 0) {
            const state = this._extractSsrState(normalizedHtml);
            const apolloState = state?.apolloState || {};
            for (const [key, person] of Object.entries(apolloState)) {
                if (!key.startsWith('Person:') || !person || typeof person !== 'object') continue;
                const id = Number(person.id || key.slice('Person:'.length));
                if (!Number.isSafeInteger(id) || id <= 0) continue;
                people.push({
                    id,
                    name: this._normalizeText(`${person.name || ''} ${person.originalName || ''}`)
                });
            }
        }

        const exact = people.find(person => wanted.some(name => person.name === name));
        const contained = people.find(person => wanted
            .slice()
            .sort((left, right) => right.length - left.length)
            .some(name => person.name.includes(name)));
        return (exact || contained || people[0])?.id || null;
    }

    /**
     * Parse movie links from a Kinopoisk new-search HTML response.
     * @param {string} html
     * @param {string[]} candidateTitles
     * @param {number|string|null} year
     * @param {Object} [options]
     * @returns {{kinopoiskId:number,name:string,year:number|null}|null}
     */
    parseMovieSearchHtml(html, candidateTitles = [], year = null, options = {}) {
        if (typeof html !== 'string' || html.length === 0) return null;

        const normalizedHtml = html.replace(/\\\//g, '/');
        const wanted = candidateTitles
            .map(title => this._normalizeMovieTitle(title))
            .filter(Boolean);
        if (wanted.length === 0) return null;

        const candidates = [];
        const linkPattern = /href=["'](?:https?:\/\/(?:www\.)?kinopoisk\.ru)?\/(?:film|series)\/(\d+)(?:\/[^"']*)?["']/gi;
        let match;

        while ((match = linkPattern.exec(normalizedHtml))) {
            const linkStart = normalizedHtml.lastIndexOf('<a', match.index);
            const linkEnd = normalizedHtml.indexOf('</a>', match.index);
            const anchorHtml = linkStart >= 0 && linkEnd > match.index
                ? normalizedHtml.slice(linkStart, linkEnd)
                : '';
            const anchorText = this._normalizeMovieTitle(this._stripHtml(anchorHtml));
            const contextStart = Math.max(0, linkStart >= 0 ? linkStart : match.index - 300);
            const contextEnd = Math.min(normalizedHtml.length, (linkEnd >= 0 ? linkEnd : match.index) + 300);
            const context = normalizedHtml.slice(contextStart, contextEnd);
            const itemMarker = 'data-test-id="movie-list-item"';
            const itemMarkerIndex = normalizedHtml.lastIndexOf(itemMarker, match.index);
            const itemStart = itemMarkerIndex >= 0
                ? normalizedHtml.lastIndexOf('<div', itemMarkerIndex)
                : -1;
            const nextItemMarker = normalizedHtml.indexOf(itemMarker, match.index + 1);
            const itemHtml = itemStart >= 0
                ? normalizedHtml.slice(itemStart, nextItemMarker >= 0 ? nextItemMarker : normalizedHtml.length)
                : context;
            const years = [...itemHtml.matchAll(/\b((?:18|19|20)\d{2})\b/g)].map(item => Number(item[1]));
            const candidateYear = years.find(value => value === Number(year)) || years[0] || null;

            let titleScore = 0;
            for (const wantedTitle of wanted) {
                if (!anchorText) continue;
                if (anchorText === wantedTitle) titleScore = Math.max(titleScore, 100);
                else if (anchorText.includes(wantedTitle) || wantedTitle.includes(anchorText)) {
                    titleScore = Math.max(titleScore, 60);
                }
            }
            if (titleScore === 0) continue;

            let yearScore = 0;
            if (Number(year) && candidateYear) {
                if (candidateYear === Number(year)) {
                    yearScore = 25;
                } else if (options.allowYearTolerance === true
                    && Math.abs(candidateYear - Number(year)) <= (Number(options.maxYearDelta) || 1)) {
                    yearScore = 10;
                } else {
                    continue;
                }
            }
            candidates.push({
                kinopoiskId: Number(match[1]),
                name: this._stripHtml(anchorHtml).replace(/\s+/g, ' ').trim(),
                originalTitle: this._extractSecondaryMovieTitle(anchorHtml)
                    || this._extractSecondaryMovieTitle(itemHtml),
                year: candidateYear,
                score: titleScore + yearScore,
                ...this._extractMovieSearchRatingMetadata(itemHtml)
            });
        }

        candidates.sort((left, right) => right.score - left.score);
        const best = candidates[0];
        if (!best || best.kinopoiskId <= 0) return null;

        return {
            kinopoiskId: best.kinopoiskId,
            name: best.name,
            ...(best.originalTitle ? { originalTitle: best.originalTitle } : {}),
            ...(best.year ? { year: best.year } : {}),
            ...(Number(best.kpRating) > 0 ? { kpRating: best.kpRating } : {}),
            ...(Number(best.kpVotes) > 0 ? { kpVotes: best.kpVotes } : {}),
            ...(Number(best.imdbRating) > 0 ? { imdbRating: best.imdbRating } : {}),
            ...(best.imdbId ? { imdbId: best.imdbId } : {})
        };
    }

    _extractMovieSearchRatingMetadata(html) {
        const text = this._stripHtml(html);
        const ratingMatch = text.match(/Рейтинг\s+Кинопоиска\s*([0-9]+(?:[.,][0-9]+)?)/i)
            || String(html || '').match(/class=["'][^"']*kinopoiskValue(?:Positive|Neutral|Negative)[^"']*["'][^>]*>\s*([0-9]+(?:[.,][0-9]+)?)/i);
        const votesMatch = String(html || '').match(/class=["'][^"']*kinopoiskCount[^"']*["'][^>]*>\s*([\d\s\u00A0]+)/i)
            || text.match(/([\d\s\u00A0]+)\s*оцен/i);
        const kpRating = ratingMatch ? Number.parseFloat(ratingMatch[1].replace(',', '.')) : 0;
        const kpVotes = votesMatch ? Number.parseInt(votesMatch[1].replace(/\D/g, ''), 10) : 0;

        return {
            ...(Number.isFinite(kpRating) && kpRating > 0 ? { kpRating } : {}),
            ...(Number.isInteger(kpVotes) && kpVotes > 0 ? { kpVotes } : {})
        };
    }

    _extractSecondaryMovieTitle(html) {
        if (!html) return '';

        // Kinopoisk renders the English/original movie title in a span whose
        // generated class contains `secondaryTitle__`. Keep this selector
        // narrower than `secondaryTitle` so we do not capture the surrounding
        // `secondaryTitleSlot` container.
        const match = String(html).match(
            /<[^>]*class=["'][^"']*secondaryTitle__[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
        );
        return match
            ? this._stripHtml(match[1]).replace(/\s+/g, ' ').trim()
            : '';
    }

    _selectMovieSearchResult(results, candidateTitles, year, options = {}) {
        const movies = Array.isArray(results)
            ? results.filter(item => Number(item?.id) > 0 && (item.type === 'film' || item.type === 'series'))
            : [];
        if (movies.length === 0) return null;

        const wanted = candidateTitles.map(title => this._normalizeMovieTitle(title)).filter(Boolean);
        const targetYear = Number(year) || null;
        const allowYearTolerance = options.allowYearTolerance === true;
        const maxYearDelta = Number(options.maxYearDelta) || 1;
        const scored = movies.map((movie, index) => {
            const movieTitles = [movie.title, movie.originalTitle]
                .map(title => this._normalizeMovieTitle(title))
                .filter(Boolean);
            let titleScore = movieTitles.length === 0 ? 0 : -100;
            for (const movieTitle of movieTitles) {
                for (const wantedTitle of wanted) {
                    if (movieTitle === wantedTitle) titleScore = Math.max(titleScore, 100);
                    else if (movieTitle.includes(wantedTitle) || wantedTitle.includes(movieTitle)) {
                        titleScore = Math.max(titleScore, 50);
                    }
                }
            }

            const movieYear = Number(movie.year) || null;
            const isExactTitle = movieTitles.some(movieTitle => wanted.includes(movieTitle));
            let yearScore = 0;
            let rejected = false;
            if (targetYear && movieYear) {
                if (movieYear === targetYear) {
                    yearScore = 80;
                } else if (allowYearTolerance && isExactTitle
                    && Math.abs(movieYear - targetYear) <= maxYearDelta) {
                    // TMDB and Kinopoisk can differ by one year for unreleased,
                    // festival, or region-specific release dates. Only allow
                    // this for an exact title match and keep exact years ahead.
                    yearScore = 60 - Math.abs(movieYear - targetYear) * 20;
                } else {
                    rejected = true;
                }
            }

            return { movie, score: titleScore + yearScore, index, rejected };
        });

        const eligible = scored.filter(candidate => !candidate.rejected);
        eligible.sort((left, right) => right.score - left.score || left.index - right.index);
        const best = eligible[0];
        if (!best) return null;

        // If the scraper supplied metadata, reject a clear title/year mismatch.
        const hasMetadata = Boolean(best.movie.title || best.movie.originalTitle || best.movie.year);
        if (hasMetadata && best.score < 0) return null;
        return best.movie;
    }

    parsePersonPageHtml(html, personId = null) {
        if (typeof html !== 'string' || html.length === 0) return null;

        const state = this._extractSsrState(html);
        if (!state || !state.apolloState) return null;

        const apolloState = state.apolloState;
        const numericId = Number(personId);
        const personKey = Number.isSafeInteger(numericId) && numericId > 0
            ? `Person:${numericId}`
            : Object.keys(apolloState).find(key => key.startsWith('Person:'));
        const person = personKey ? apolloState[personKey] : null;
        if (!person) return null;

        const items = this._extractFilmographyItems(person, apolloState);
        if (items.length === 0) return null;

        return {
            personId: Number(person.id) || numericId || null,
            name: person.name || null,
            originalName: person.originalName || null,
            posterUrl: this._readPosterUrl(person.poster),
            birthday: person.dateOfBirth?.date || null,
            birthplace: person.birthPlace || null,
            professions: this._extractProfessions(person),
            items
        };
    }

    _extractFilmographyItems(person, apolloState) {
        const relationEntries = Object.entries(person)
            .filter(([key, value]) => key.startsWith('filmographyRelations:') && Array.isArray(value?.items));
        const items = [];
        const seen = new Set();

        for (const [, relation] of relationEntries) {
            for (const relationItem of relation.items) {
                const movieRef = relationItem?.movie?.__ref;
                const movie = movieRef ? apolloState[movieRef] : null;
                const movieId = Number(movie?.id);
                if (!movie || !Number.isSafeInteger(movieId) || movieId <= 0 || seen.has(movieId)) continue;

                const participations = Object.entries(relationItem)
                    .filter(([key, value]) => key.startsWith('participations') && Array.isArray(value?.items))
                    .flatMap(([, value]) => value.items);
                const roles = participations
                    .map(participation => ({
                        slug: participation?.role?.slug || null,
                        title: participation?.role?.title?.russian || null,
                        character: participation?.name || null,
                        notice: participation?.notice || null
                    }))
                    .filter(role => role.slug || role.title || role.character);
                const primaryRole = roles[0] || {};
                const year = this._readMovieYear(movie);

                seen.add(movieId);
                items.push({
                    providerMediaId: movieId,
                    providerMediaType: movie.__typename === 'TvSeries' ? 'tv' : 'movie',
                    kinopoiskId: movieId,
                    name: movie.title?.russian || movie.title?.original || '',
                    originalName: movie.title?.original || null,
                    year,
                    releaseDate: year ? `${year}-01-01` : null,
                    posterUrl: this._readPosterUrl(movie.gallery?.posters?.vertical),
                    posterSource: this._readPosterUrl(movie.gallery?.posters?.vertical) ? 'kp' : null,
                    rating: movie.rating?.kinopoisk?.value || null,
                    role: primaryRole.character,
                    job: primaryRole.title,
                    roleSlug: primaryRole.slug,
                    category: this._mapRoleToCategory(primaryRole.slug, primaryRole.title),
                    roles
                });
            }
        }

        return items;
    }

    _extractProfessions(person) {
        const relation = person['roles({"isCareer":true})'];
        return Array.isArray(relation?.items)
            ? relation.items.map(item => item?.role?.title?.russian).filter(Boolean)
            : [];
    }

    _readMovieYear(movie) {
        const year = movie.productionYear || movie.releaseYears?.[0]?.start || movie.releaseYears?.start;
        return Number.isInteger(Number(year)) ? Number(year) : null;
    }

    _readPosterUrl(poster) {
        const url = typeof poster === 'string'
            ? poster
            : poster?.avatarsUrl || poster?.fallbackUrl || poster?.url || poster?.previewUrl || null;
        return this._normalizeArtworkUrl(url);
    }

    _mapRoleToCategory(slug, title) {
        const normalized = `${slug || ''} ${title || ''}`.toUpperCase();
        if (normalized.includes('ACTOR') || normalized.includes('АКТЕР')) return 'acting';
        if (normalized.includes('DIRECTOR') || normalized.includes('РЕЖИССЕР')) return 'directing';
        if (normalized.includes('WRITER') || normalized.includes('СЦЕНАРИСТ')) return 'writing';
        if (normalized.includes('PRODUCER') || normalized.includes('ПРОДЮСЕР')) return 'production';
        if (normalized.includes('COMPOSER') || normalized.includes('КОМПОЗИТОР')) return 'music';
        return 'other';
    }

    _extractSsrState(html) {
        const marker = 'window.Ya.__ssr_initial_data = ';
        const markerIndex = html.indexOf(marker);
        if (markerIndex < 0) return null;

        const jsonStart = html.indexOf('{', markerIndex + marker.length);
        if (jsonStart < 0) return null;

        const jsonText = this._extractBalancedJson(html, jsonStart);
        if (!jsonText) return null;

        try {
            return JSON.parse(jsonText);
        } catch (error) {
            console.warn('[KinopoiskPersonHtmlService] SSR state JSON parse failed:', error.message);
            return null;
        }
    }

    _extractBalancedJson(text, startIndex) {
        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let index = startIndex; index < text.length; index++) {
            const char = text[index];

            if (inString) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') inString = false;
                continue;
            }

            if (char === '"') {
                inString = true;
            } else if (char === '{') {
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0) return text.slice(startIndex, index + 1);
            }
        }

        return null;
    }

    _normalizeText(value) {
        return String(value || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/\s+/g, ' ')
            .trim()
            .toLocaleLowerCase('ru-RU');
    }

    _normalizeMovieTitle(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('ru-RU')
            .replace(/ё/g, 'е')
            .replace(/[^\p{L}\p{N}]+/gu, '');
    }

    _stripHtml(value) {
        return String(value || '').replace(/<[^>]*>/g, ' ');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = KinopoiskPersonHtmlService;
}
if (typeof window !== 'undefined') {
    window.KinopoiskPersonHtmlService = KinopoiskPersonHtmlService;
}
