/**
 * KinogoParser - Parser with dynamic multi-mirror pool and auto-failover.
 * Searches across active KinoGo mirrors and extracts iframe embed players.
 * 
 * @extends BaseParserService
 */
class KinogoParser extends BaseParserService {
    static DEFAULT_MIRRORS = [
        'https://kinogo.la',
        'https://kinogo.film',
        'https://kinogo.is',
        'https://kinogo.gg',
        'https://kinogo.my'
    ];

    static STORAGE_KEY = 'kinogo_active_mirror';

    constructor(options = {}) {
        super({
            id: 'kinogo',
            name: 'KinoGo',
            baseUrl: options.baseUrl || KinogoParser.DEFAULT_MIRRORS[0],
            cacheTTL: options.cacheTTL || (15 * 60 * 1000), // 15 minutes aligned with token lifespan
            requestTimeoutMs: options.requestTimeoutMs || 7000
        });

        /**
         * Delay before the next mirror is started while earlier mirrors are
         * still pending. A failed mirror starts the next one immediately.
         * @type {number}
         */
        this.mirrorHedgeDelayMs = options.mirrorHedgeDelayMs ?? 1500;

        /** @type {Array<string>} */
        this.mirrors = Array.isArray(options.mirrors) && options.mirrors.length > 0
            ? options.mirrors
            : [...KinogoParser.DEFAULT_MIRRORS];

        /** @type {string} */
        /**
         * Grace period for a weak (non-exact) match: other mirrors still
         * running may return a confident match within it.
         * @type {number}
         */
        this.mirrorFallbackGraceMs = options.mirrorFallbackGraceMs ?? 2500;

        this._activeMirror = this.baseUrl;
        /** @private @type {Promise<void>} Resolves once the saved mirror is read. */
        this._activeMirrorReady = this._loadActiveMirrorFromStorage();
    }

    /**
     * Read saved active mirror from chrome.storage if available.
     * @private
     */
    _loadActiveMirrorFromStorage() {
        if (typeof chrome === 'undefined' || !chrome?.storage?.local?.get) return Promise.resolve();
        return new Promise(resolve => {
            try {
                chrome.storage.local.get([KinogoParser.STORAGE_KEY], (res) => {
                    const saved = res?.[KinogoParser.STORAGE_KEY];
                    // A mirror chosen during this session wins over the stored one.
                    if (typeof saved === 'string' && saved.startsWith('http') && !this._mirrorChosenThisSession) {
                        this._activeMirror = saved;
                        this.baseUrl = saved;
                    }
                    resolve();
                });
            } catch {
                // Ignore storage read failures in isolated contexts
                resolve();
            }
        });
    }

    /**
     * Wait briefly for the saved mirror so the first search of a page starts
     * on the last working mirror instead of the default one.
     * @private
     */
    async _waitForActiveMirror(timeoutMs = 300) {
        if (!this._activeMirrorReady) return;
        if (typeof setTimeout !== 'function') {
            await this._activeMirrorReady;
            return;
        }
        let timer = null;
        await Promise.race([
            this._activeMirrorReady,
            new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })
        ]);
        if (timer !== null) clearTimeout(timer);
    }

    /**
     * Persist active mirror to chrome.storage.
     * @param {string} mirror
     * @private
     */
    _saveActiveMirror(mirror) {
        this._mirrorChosenThisSession = true;
        this._activeMirror = mirror;
        this.baseUrl = mirror;
        if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
            try {
                chrome.storage.local.set({ [KinogoParser.STORAGE_KEY]: mirror });
            } catch {
                // Ignore storage write failures
            }
        }
    }

    /**
     * Get a prioritized mirror list. KinoGo's current series pages on kinogo.my
     * expose the native season/episode picker; keep every other mirror as fallback.
     * @param {Object} [options]
     * @param {string|null} [options.mediaType]
     * @returns {Array<string>}
     */
    getMirrors({ mediaType = null } = {}) {
        const active = this._activeMirror || this.baseUrl;
        const normalizedActive = String(active || '').replace(/\/+$/, '');
        const normalizedMirrors = this.mirrors
            .map(mirror => String(mirror || '').replace(/\/+$/, ''))
            .filter(Boolean);
        const preferred = this.isSeriesMediaType(mediaType)
            ? normalizedMirrors.filter(mirror => mirror === 'https://kinogo.my')
            : [];
        const ordered = [
            ...preferred,
            normalizedActive,
            ...normalizedMirrors
        ];
        return [...new Set(ordered)].filter(Boolean);
    }

    _logSearchTrace(message, details = {}) {
        if (!BaseParserService.isDebugEnabled()) return;
        let serialized;
        try {
            serialized = ` ${JSON.stringify(details)}`;
        } catch {
            this.debugLog(`[KinogoSearchTrace] ${message} [details-unserializable]`, details);
            return;
        }
        this.debugLog(`[KinogoSearchTrace] ${message}${serialized}`, details);
    }

    getSearchResultCompatibilityReason(result, movieType) {
        if (!result) return 'empty-result';
        if (!movieType) return 'media-type-filter-not-requested';

        const normalizedMovieType = String(movieType).toLowerCase().replace(/_/g, '-');
        const isSeries = ['tv-series', 'mini-series', 'animated-series', 'tv', 'series', 'tv-show']
            .includes(normalizedMovieType);
        const url = String(result.url || '').toLowerCase();
        const resultType = String(result.type || '').toLowerCase();
        const urlLooksLikeSeries = /\/serial(?:s)?\//.test(url) || /series|season|serial/.test(url);

        if (isSeries) {
            if (resultType === 'series') return 'accepted-result-type-series';
            if (urlLooksLikeSeries) return 'accepted-series-url';
            return `rejected-non-series-result: type=${resultType || 'unknown'}`;
        }

        if (resultType === 'series' || urlLooksLikeSeries) {
            return `rejected-series-result: type=${resultType || 'unknown'}`;
        }
        return 'accepted-film-result';
    }

    isSearchResultCompatible(result, movieType) {
        const reason = this.getSearchResultCompatibilityReason(result, movieType);
        return !reason || !reason.startsWith('rejected-');
    }

    _traceSearchCandidate(stage, candidate, targetTitle, movieType) {
        const titleMatches = this.isTitleMatch(candidate.title, targetTitle, {
            allowSeriesSuffix: this.isSeriesMediaType(movieType)
        });
        const compatibilityReason = this.getSearchResultCompatibilityReason(candidate, movieType);
        this._logSearchTrace(`candidate ${stage}`, {
            title: candidate.title,
            url: candidate.url,
            year: candidate.year || null,
            detectedType: candidate.type || 'unknown',
            requestedTitle: targetTitle,
            requestedMediaType: movieType || null,
            titleMatches,
            compatible: !compatibilityReason || !compatibilityReason.startsWith('rejected-'),
            compatibilityReason
        });
        return titleMatches && (!compatibilityReason || !compatibilityReason.startsWith('rejected-'));
    }

    inferSearchResultType(url, text = '') {
        const lowerUrl = String(url || '').toLowerCase();
        const lowerText = String(text || '').toLowerCase();
        return lowerText.includes('сериал')
            || lowerText.includes('сезон')
            || lowerText.includes('мультсериал')
            || lowerText.includes('дорама')
            || /series|season|serial|serialy/.test(lowerUrl)
            ? 'series'
            : 'film';
    }

    isSeriesMediaType(movieType) {
        const normalizedMovieType = String(movieType || '').toLowerCase().replace(/_/g, '-');
        return ['tv-series', 'mini-series', 'animated-series', 'tv', 'series', 'tv-show']
            .includes(normalizedMovieType);
    }

    /**
     * A search result that no other mirror can improve on: the exact title
     * (season suffix allowed for series), a year within one of the target
     * when both are known, and the requested season when one is requested.
     * @param {SearchResult|null} candidate
     * @param {string} targetTitle
     * @param {string|null} targetYear
     * @param {{mediaType?: string|null, seasonNumber?: number|null}} [options]
     * @returns {boolean}
     */
    isConfidentSearchMatch(candidate, targetTitle, targetYear, { mediaType = null, seasonNumber = null } = {}) {
        if (!candidate?.title) return false;
        const isSeries = this.isSeriesMediaType(mediaType);
        let found = BaseParserService.normalizeTitle(candidate.title);
        if (isSeries) {
            found = found.replace(
                /\s+(?:(?:\d+|i|ii|iii|iv|v|vi|vii|viii|ix|x)\s+)?(?:сезон(?:а|ов)?|season|series)(?:\s.*)?$/i,
                ''
            ).trim();
        }
        if (found !== BaseParserService.normalizeTitle(targetTitle)) return false;

        const year = Number.parseInt(targetYear, 10);
        const candidateYear = Number.parseInt(candidate.year, 10);
        if (Number.isFinite(year)) {
            if (!Number.isFinite(candidateYear) || Math.abs(candidateYear - year) > 1) return false;
        }
        if (isSeries && seasonNumber != null) {
            return this.extractSearchSeasonNumber(candidate) === seasonNumber;
        }
        return true;
    }

    /**
     * A release year from free card text only when exactly one distinct year
     * appears; counters, prices or "updated" dates make the text ambiguous.
     * @param {string} text
     * @returns {string|null}
     */
    extractUnambiguousYear(text) {
        const years = new Set(String(text || '').match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g) || []);
        return years.size === 1 ? [...years][0] : null;
    }

    extractSearchSeasonNumber(candidate) {
        const haystack = `${candidate?.title || ''} ${candidate?.url || ''}`;
        const match = haystack.match(/(?:^|[^0-9])([0-9]{1,2})[\s_-]*(?:сезон|season|sezon)(?:[^0-9]|$)/i)
            || haystack.match(/(?:сезон|season|sezon)[\s_-]*([0-9]{1,2})(?:[^0-9]|$)/i);
        return match ? Number(match[1]) : null;
    }

    // ─── BaseParserService Contract ───────────────────────────────────

    /**
     * Search for a movie by title and year across the mirror pool.
     * @param {string} title - Movie title (Russian preferred)
     * @param {string|number|null} year - Movie year
     * @returns {Promise<SearchResult|null>}
     */
    async search(title, year, options = {}) {
        await this._waitForActiveMirror();
        const targetYear = year && Number(year) >= 1900 && Number(year) <= 2100
            ? String(year)
            : null;
        const mediaType = options?.mediaType || null;
        const seasonNumber = Number.isInteger(Number(options?.seasonNumber))
            && Number(options.seasonNumber) > 0
            ? Number(options.seasonNumber)
            : null;
        this._logSearchTrace('search input normalized', {
            title,
            rawYear: year ?? null,
            targetYear,
            mediaType,
            seasonNumber,
            activeMirror: this._activeMirror || this.baseUrl,
            mirrors: this.getMirrors({ mediaType })
        });
        this.debugLog(`[DEBUG KinogoParser] search() called. title: "${title}", year: ${targetYear}, mediaType: ${mediaType || 'unknown'}`);
        const mirrors = this.getMirrors({ mediaType });

        const { value: result, mirror: matchedMirror, lastError } = await this._raceMirrors(mirrors, async (mirror, signal) => {
            try {
                this.debugLog(`[DEBUG KinogoParser] Trying mirror: ${mirror}`);
                const mirrorResult = await this._searchMirror(mirror, title, targetYear, mediaType, seasonNumber, signal);
                if (!mirrorResult) {
                    this._logSearchTrace('mirror returned no compatible result', { mirror, title, mediaType });
                }
                return mirrorResult;
            } catch (error) {
                this._logSearchTrace('mirror search error', { mirror, message: error.message });
                console.warn(`[KinogoParser] Mirror ${mirror} search failed:`, error.message);
                throw error;
            }
        }, {
            // Mirrors list different catalogs. Only a confident match ends the
            // race at once; a weak one waits for the other mirrors (bounded by
            // mirrorFallbackGraceMs) and the highest-priority mirror's weak
            // match is used, so the result no longer depends on response order.
            isDecisive: candidate => this.isConfidentSearchMatch(candidate, title, targetYear, {
                mediaType,
                seasonNumber
            }),
            fallbackGraceMs: this.mirrorFallbackGraceMs
        });

        if (result) {
            this._saveActiveMirror(matchedMirror);
            result.parserId = this.id;
            result.source = this.id;
            this._logSearchTrace('final result selected', {
                mirror: matchedMirror,
                title: result.title,
                url: result.url,
                year: result.year || null,
                detectedType: result.type || 'unknown',
                requestedMediaType: mediaType || null,
                compatible: this.isSearchResultCompatible(result, mediaType)
            });
            this.debugLog(`[DEBUG KinogoParser] Match found on ${matchedMirror}:`, result.url, result.year);
            return result;
        }

        if (lastError && mirrors.length === 1) {
            throw lastError;
        }

        this._logSearchTrace('search exhausted without result', { title, targetYear, mediaType, mirrors });
        this.debugLog(`[DEBUG KinogoParser] No matches found across all mirrors for "${title}"`);
        return null;
    }

    /**
     * Search a single mirror using hybrid GET + DLE POST strategies.
     * @param {string} mirror - Mirror base URL
     * @param {string} title - Movie title
     * @param {string|null} targetYear - Movie year
     * @returns {Promise<SearchResult|null>}
     * @private
     */
    async _searchMirror(mirror, title, targetYear, mediaType = null, seasonNumber = null, signal = undefined) {
        this._logSearchTrace('mirror search started', { mirror, title, targetYear, mediaType, seasonNumber });
        // Strategy 1: GET /search/{query}
        try {
            const getUrl = `${mirror}/search/${encodeURIComponent(title)}`;
            const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
            const request = () => this.fetchWithTimeout(getUrl, {
                signal,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            const response = perf ? await perf.trackRequest('KINOGO_SEARCH', { purpose: 'search-get', url: getUrl }, request) : await request();

            this._logSearchTrace('GET search response', { mirror, url: getUrl, status: response.status, ok: response.ok });
            if (response.ok) {
                const html = await response.text();
                this._logSearchTrace('GET search HTML received', { mirror, url: getUrl, htmlLength: html.length });
                const result = this.parseSearchResults(html, title, targetYear, mirror, mediaType, { seasonNumber });
                this._logSearchTrace('GET search parsed', {
                    mirror,
                    result: result ? { title: result.title, url: result.url, type: result.type, year: result.year } : null
                });
                if (result) return result;
            }
        } catch (error) {
            this._logSearchTrace('GET search failed, falling back to POST', { mirror, message: error.message });
            // Ignore and fallback to POST
        }

        // Strategy 2: DLE POST /index.php?do=search
        if (signal?.aborted) return null;
        try {
            const postUrl = `${mirror}/index.php?do=search`;
            const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
            const formData = new URLSearchParams();
            formData.append('do', 'search');
            formData.append('subaction', 'search');
            formData.append('search_start', '0');
            formData.append('full_search', '0');
            formData.append('result_from', '1');
            formData.append('story', title);

            const request = () => this.fetchWithTimeout(postUrl, {
                signal,
                method: 'POST',
                body: formData,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            const postRes = perf ? await perf.trackRequest('KINOGO_SEARCH', { purpose: 'search-post', url: postUrl }, request) : await request();

            this._logSearchTrace('POST search response', { mirror, url: postUrl, status: postRes.status, ok: postRes.ok });
            if (postRes.ok) {
                const postHtml = await postRes.text();
                this._logSearchTrace('POST search HTML received', { mirror, url: postUrl, htmlLength: postHtml.length });
                const result = this.parseSearchResults(postHtml, title, targetYear, mirror, mediaType, { seasonNumber });
                this._logSearchTrace('POST search parsed', {
                    mirror,
                    result: result ? { title: result.title, url: result.url, type: result.type, year: result.year } : null
                });
                if (result) return result;
            }
        } catch (error) {
            this._logSearchTrace('POST search failed', { mirror, message: error.message });
            // Strategy failed on this mirror
        }

        this._logSearchTrace('mirror search finished without result', { mirror, title, mediaType });
        return null;
    }

    /**
     * Get video sources from a search result with multi-mirror failover.
     * @param {SearchResult|string} searchResult - Result from search()
     * @returns {Promise<Array<VideoSource>>}
     */
    async getVideoSources(searchResult) {
        const rawUrl = typeof searchResult === 'string' ? searchResult : searchResult?.url;
        this.debugLog(`[DEBUG KinogoParser] getVideoSources() called. url:`, rawUrl?.substring(0, 80));
        if (!rawUrl) return [];
        await this._waitForActiveMirror();

        let pathname = rawUrl;
        let initialMirror = this._activeMirror || this.baseUrl;
        if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
            const originMatch = rawUrl.match(/^(https?:\/\/[^/]+)/i);
            if (originMatch) {
                if (!this._activeMirror) {
                    initialMirror = originMatch[1];
                }
                pathname = rawUrl.substring(originMatch[1].length);
            }
        }

        const allMirrors = this.getMirrors();
        const mirrors = [
            initialMirror,
            ...allMirrors.filter(m => m.replace(/\/+$/, '') !== initialMirror.replace(/\/+$/, ''))
        ];

        const { value: sources, lastError } = await this._raceMirrors(mirrors, async (mirror, signal) => {
            const candidateUrl = this._buildAbsoluteUrl(pathname, mirror);
            try {
                this.debugLog(`[DEBUG KinogoParser] Trying mirror for getVideoSources: ${candidateUrl}`);
                const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
                const request = () => this.fetchWithTimeout(candidateUrl, {
                    signal,
                    cache: 'no-store',
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                });
                const response = perf ? await perf.trackRequest('KINOGO_SOURCE', { purpose: 'getVideoSources', url: candidateUrl }, request) : await request();

                if (!response.ok) {
                    console.warn(`[KinogoParser] Mirror ${mirror} page fetch failed: ${response.status}`);
                    return null;
                }
                const html = await response.text();
                const mirrorSources = this.extractKinogoDirectSources(html, candidateUrl);
                if (!mirrorSources || mirrorSources.length === 0) return null;
                if (mirror !== this._activeMirror) {
                    this._saveActiveMirror(mirror);
                }
                this._logSearchTrace('source extraction result', {
                    pageUrl: candidateUrl,
                    mirror,
                    sourceCount: mirrorSources.length,
                    sources: mirrorSources.map(source => ({
                        type: source.type || 'iframe',
                        host: (() => {
                            try { return new URL(source.url).host; } catch { return null; }
                        })(),
                        url: source.url
                    }))
                });
                this.debugLog(`[DEBUG KinogoParser] getVideoSources result: ${mirrorSources.length} sources found on ${mirror}`);
                return mirrorSources;
            } catch (error) {
                console.warn(`[KinogoParser] Mirror ${mirror} page fetch error:`, error.message);
                throw error;
            }
        });

        if (sources) return sources;
        if (lastError) {
            console.error(`[${this.name}] getVideoSources error across all mirrors:`, lastError);
        }
        return [];
    }

    /**
     * Run one task per mirror in priority order with hedging: the next mirror
     * starts when the previous one fails or returns nothing, or after
     * `mirrorHedgeDelayMs` while it is still pending. The first non-empty value
     * accepted by `isDecisive` (any non-empty value without it) wins and aborts
     * the remaining requests. A non-decisive value is kept as a fallback; the
     * race then ends after `fallbackGraceMs` or when every mirror has answered,
     * returning the fallback of the highest-priority mirror. Without timers
     * (headless tests) this degrades to the strict sequential order.
     * @param {Array<string>} mirrors
     * @param {(mirror: string, signal: AbortSignal|undefined) => Promise<any>} task
     * @param {{isDecisive?: (value: any) => boolean, fallbackGraceMs?: number}} [options]
     * @returns {Promise<{value: any, mirror: string|null, lastError: Error|null}>}
     * @private
     */
    _raceMirrors(mirrors, task, { isDecisive = null, fallbackGraceMs = 0 } = {}) {
        const canHedge = typeof setTimeout === 'function' && this.mirrorHedgeDelayMs > 0;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

        return new Promise(resolve => {
            let nextIndex = 0;
            let pending = 0;
            let settled = false;
            let lastError = null;
            let hedgeTimer = null;
            let graceTimer = null;
            /** @type {{value: any, mirror: string, index: number}|null} */
            let fallback = null;

            const clearHedge = () => {
                if (hedgeTimer !== null) clearTimeout(hedgeTimer);
                hedgeTimer = null;
            };
            const finish = (value, mirror) => {
                if (settled) return;
                settled = true;
                clearHedge();
                if (graceTimer !== null) clearTimeout(graceTimer);
                graceTimer = null;
                controller?.abort(new Error('KinoGo mirror race already decided'));
                resolve({ value, mirror, lastError });
            };
            const finishWithFallback = () => finish(fallback?.value ?? null, fallback?.mirror ?? null);
            const launchNext = () => {
                if (settled) return;
                clearHedge();
                if (nextIndex >= mirrors.length) {
                    if (pending === 0) finishWithFallback();
                    return;
                }
                const index = nextIndex++;
                const mirror = mirrors[index];
                pending += 1;
                Promise.resolve()
                    .then(() => task(mirror, controller?.signal))
                    .then(value => {
                        pending -= 1;
                        const hasValue = value && (!Array.isArray(value) || value.length > 0);
                        if (hasValue && (typeof isDecisive !== 'function' || isDecisive(value))) {
                            finish(value, mirror);
                            return;
                        }
                        if (hasValue && (!fallback || index < fallback.index)) {
                            fallback = { value, mirror, index };
                            if (graceTimer === null && typeof setTimeout === 'function' && fallbackGraceMs > 0) {
                                graceTimer = setTimeout(finishWithFallback, fallbackGraceMs);
                            }
                        }
                        launchNext();
                    }, error => {
                        pending -= 1;
                        lastError = error;
                        launchNext();
                    });
                if (canHedge && nextIndex < mirrors.length) {
                    hedgeTimer = setTimeout(launchNext, this.mirrorHedgeDelayMs);
                }
            };

            launchNext();
        });
    }

    // ─── Internal Parsing Methods ─────────────────────────────────────

    /**
     * Parse search results HTML to find the best matching movie.
     * Supports both DOM card containers and raw link fallbacks.
     *
     * @param {string} html - HTML string
     * @param {string} targetTitle - Target title
     * @param {string|null} targetYear - Target year
     * @param {string} [mirror] - Mirror base URL
     * @returns {SearchResult|null}
     */
    parseSearchResults(html, targetTitle, targetYear, mirror = this.baseUrl, movieType = null, options = {}) {
        if (!html) return null;
        const matches = [];
        const requestedSeasonNumber = this.isSeriesMediaType(movieType)
            && Number.isInteger(Number(options?.seasonNumber))
            && Number(options.seasonNumber) > 0
            ? Number(options.seasonNumber)
            : null;
        let parserPath = 'none';
        this._logSearchTrace('parse started', {
            mirror,
            htmlLength: html.length,
            targetTitle,
            targetYear: targetYear || null,
            requestedMediaType: movieType || null,
            requestedSeasonNumber,
            domParserAvailable: typeof DOMParser !== 'undefined'
        });

        // 1. Browser DOMParser path if available
        if (typeof DOMParser !== 'undefined') {
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const cards = doc.querySelectorAll('.shortstory, .shortstory-title, .zagolovki, article, div[class*="shortstory"], div[class*="story"], .custom-poster, .kino-item');
                parserPath = cards && cards.length > 0 ? 'dom-cards' : 'dom-links';
                this._logSearchTrace('DOM search structure detected', { mirror, cards: cards?.length || 0 });

                if (cards && cards.length > 0) {
                    for (const card of cards) {
                        const titleLink = card.querySelector('.shortstory__title a, .shortstory-title a, .zagolovki a, h2 a, h3 a, .title a, a[href*=".html"]');
                        if (!titleLink) continue;

                        let titleText = titleLink.textContent.trim();
                        let url = titleLink.getAttribute('href') || '';
                        if (!url || url.startsWith('javascript:') || url.startsWith('#')) continue;
                        url = this._buildAbsoluteUrl(url, mirror);

                        // Extract year from title if in brackets: "Название (2024)"
                        let titleYear = null;
                        const titleYearMatch = titleText.match(/\((\d{4})\)/);
                        if (titleYearMatch) {
                            titleYear = titleYearMatch[1];
                            titleText = titleText.replace(/\(\d{4}\)/, '').trim();
                        }

                        if (!this.isTitleMatch(titleText, targetTitle, {
                            allowSeriesSuffix: this.isSeriesMediaType(movieType)
                        })) continue;

                        const cardHtml = card.innerHTML || '';
                        let foundYear = titleYear;
                        if (!foundYear) {
                            const yearLabelMatch = cardHtml.match(/Год\s*(?:выпуска)?\s*:?\s*(?:<[^>]+>)*\s*(\d{4})/i);
                            if (yearLabelMatch) {
                                foundYear = yearLabelMatch[1];
                            } else {
                                foundYear = this.extractUnambiguousYear(card.textContent || '');
                            }
                        }

                        const type = this.inferSearchResultType(url, card.textContent || '');

                        const candidate = {
                            title: titleText,
                            url: url,
                            year: foundYear,
                            type: type,
                            parserId: this.id,
                            source: this.id
                        };
                        if (this._traceSearchCandidate('dom-card', candidate, targetTitle, movieType)) {
                            matches.push(candidate);
                        }
                    }
                }

                // 2. Link list fallback (e.g. on compact DLE search pages)
                if (matches.length === 0) {
                    const links = doc.querySelectorAll('a[href*=".html"]');
                    for (const link of links) {
                        const href = link.getAttribute('href') || '';
                        if (!href || href.includes('rules.html') || href.includes('copyright.html') || href.includes('contacts.html') || href.includes('help.html')) continue;

                        let rawText = link.textContent.trim();
                        if (!rawText || rawText.length < 2) continue;

                        let year = null;
                        const ym = rawText.match(/\((\d{4})\)/);
                        if (ym) {
                            year = ym[1];
                            rawText = rawText.replace(/\(\d{4}\)/, '').trim();
                        }

                        if (this.isTitleMatch(rawText, targetTitle, {
                            allowSeriesSuffix: this.isSeriesMediaType(movieType)
                        })) {
                            const candidate = {
                                title: rawText,
                                url: this._buildAbsoluteUrl(href, mirror),
                                year: year,
                                type: this.inferSearchResultType(href, rawText),
                                parserId: this.id,
                                source: this.id
                            };
                            if (this._traceSearchCandidate('dom-link', candidate, targetTitle, movieType)) {
                                matches.push(candidate);
                            }
                        }
                    }
                }
            } catch (err) {
                parserPath = 'regex-fallback-after-dom-error';
                console.warn('[KinogoParser] DOM parsing failed, falling back to regex:', err);
            }
        }

        // 3. Pure Regex Fallback (works in headless / mock environments)
        if (matches.length === 0) {
            parserPath = parserPath === 'none' ? 'regex' : `${parserPath}+regex`;
            // First try matching full card blocks (e.g. <div class="shortstory">...</div>)
            const cardBlockRegex = /<div[^>]+class="[^"]*(?:shortstory|zagolovki|kino)[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*(?:shortstory|zagolovki|kino)[^"]*"|$)/gi;
            const cardBlocks = [...html.matchAll(cardBlockRegex)].map(m => m[0]);

            if (cardBlocks.length > 0) {
                for (const block of cardBlocks) {
                    const linkMatch = block.match(/<a[^>]+href="([^"]*?(?:film|movie|\d+-[^"]+)\.html)"[^>]*>([\s\S]*?)<\/a>/i);
                    if (!linkMatch) continue;

                    const href = linkMatch[1];
                    let rawText = linkMatch[2].replace(/<[^>]+>/g, '').trim();
                    if (!rawText || href.includes('copyright') || href.includes('contacts')) continue;

                    let year;
                    const ym = rawText.match(/\((\d{4})\)/);
                    if (ym) {
                        year = ym[1];
                        rawText = rawText.replace(/\(\d{4}\)/, '').trim();
                    } else {
                        const yearMatch = block.match(/Год\s*(?:выпуска)?\s*:?\s*(?:<[^>]+>)*\s*(\d{4})/i);
                        year = yearMatch
                            ? yearMatch[1]
                            : this.extractUnambiguousYear(block.replace(/<[^>]+>/g, ' '));
                    }

                    if (this.isTitleMatch(rawText, targetTitle, {
                        allowSeriesSuffix: this.isSeriesMediaType(movieType)
                    })) {
                        const candidate = {
                            title: rawText,
                            url: this._buildAbsoluteUrl(href, mirror),
                            year: year,
                            type: this.inferSearchResultType(href, block),
                            parserId: this.id,
                            source: this.id
                        };
                        if (this._traceSearchCandidate('regex-card', candidate, targetTitle, movieType)) {
                            matches.push(candidate);
                        }
                    }
                }
            }

            // If still no matches, fallback to scanning plain <a> links
            if (matches.length === 0) {
                const linkRegex = /<a[^>]+href="([^"]*?(?:film|movie|\d+-[^"]+)\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
                let m;
                while ((m = linkRegex.exec(html)) !== null) {
                    const href = m[1];
                    let rawText = m[2].replace(/<[^>]+>/g, '').trim();
                    if (!rawText || href.includes('copyright') || href.includes('contacts')) continue;

                    let year = null;
                    const ym = rawText.match(/\((\d{4})\)/);
                    if (ym) {
                        year = ym[1];
                        rawText = rawText.replace(/\(\d{4}\)/, '').trim();
                    }

                    if (this.isTitleMatch(rawText, targetTitle, {
                        allowSeriesSuffix: this.isSeriesMediaType(movieType)
                    })) {
                        const candidate = {
                            title: rawText,
                            url: this._buildAbsoluteUrl(href, mirror),
                            year: year,
                            type: this.inferSearchResultType(href, rawText),
                            parserId: this.id,
                            source: this.id
                        };
                        if (this._traceSearchCandidate('regex-link', candidate, targetTitle, movieType)) {
                            matches.push(candidate);
                        }
                    }
                }
            }
        }

        if (matches.length > 0) {
            this._logSearchTrace('eligible matches before ranking', {
                mirror,
                parserPath,
                count: matches.length,
                matches: matches.map(match => ({
                    title: match.title,
                    url: match.url,
                    year: match.year || null,
                    detectedType: match.type || 'unknown'
                }))
            });
            const best = this.rankTitleMatches(matches, targetTitle, targetYear, candidate => {
                if (requestedSeasonNumber == null) return 0;
                const candidateSeason = this.extractSearchSeasonNumber(candidate);
                if (candidateSeason === requestedSeasonNumber) return 1000;
                return candidateSeason != null ? -100 : 0;
            });
            const ranked = [best, ...matches.filter(match => match !== best)];
            this._logSearchTrace('ranking result', {
                mirror,
                parserPath,
                requestedMediaType: movieType || null,
                requestedSeasonNumber,
                ranked: ranked.map((match, index) => ({
                    rank: index + 1,
                    title: match.title,
                    url: match.url,
                    year: match.year || null,
                    detectedType: match.type || 'unknown',
                    detectedSeasonNumber: this.extractSearchSeasonNumber(match)
                })),
                selected: {
                    title: best.title,
                    url: best.url,
                    type: best.type,
                    year: best.year || null,
                    detectedSeasonNumber: this.extractSearchSeasonNumber(best)
                }
            });
            if (BaseParserService.hasYearDivergence(best, targetYear)) {
                const diff = Math.abs(parseInt(best.year, 10) - parseInt(targetYear, 10));
                const exactTitle = BaseParserService.compactTitle(best.title)
                    === BaseParserService.compactTitle(targetTitle);
                const bestMatchesRequestedSeason = requestedSeasonNumber != null
                    && this.extractSearchSeasonNumber(best) === requestedSeasonNumber;
                if (!exactTitle && !bestMatchesRequestedSeason) {
                    this.debugLog(`[DEBUG KinogoParser] Rejecting match "${best.title}" (${best.year}) for "${targetTitle}" (${targetYear}) due to year divergence (${diff} yrs)`);
                    return null;
                }
            }

            return best;
        }

        this._logSearchTrace('parse finished without eligible matches', {
            mirror,
            parserPath,
            targetTitle,
            requestedMediaType: movieType || null,
            requestedSeasonNumber
        });
        return null;
    }

    // ─── Direct Source Extraction ────────────────────────────────────

    /**
     * Extract embed player sources from KinoGo movie page HTML.
     * Supports Ortified, Nextembed, Cinemar, Lumex, Stravers, Namy, Variyt and generic iframes.
     * 
     * @param {string} html - Page HTML
     * @param {string} [pageUrl] - Current page URL
     * @returns {Array<VideoSource>}
     */
    extractKinogoDirectSources(html, pageUrl = '') {
        if (!html) return [];
        const foundUrls = [];
        const embedPattern = /(?:https?:)?\/\/[^\s"'<>]+\/(?:embed|player|video|serial|film)\/[^\s"'<>]+/i;

        // 1. DOM scanning if DOMParser is available
        if (typeof DOMParser !== 'undefined') {
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                // Scan all elements with data-* attributes
                const allElements = doc.querySelectorAll('*');
                for (const el of allElements) {
                    for (const attr of el.attributes) {
                        if (attr.name.startsWith('data-') && attr.value) {
                            const val = attr.value.trim();
                            if (embedPattern.test(val)) {
                                const match = val.match(embedPattern);
                                if (match) foundUrls.push(this._normalizeUrl(match[0]));
                            }
                        }
                    }
                }

                // Scan iframe elements
                const iframes = doc.querySelectorAll('iframe[src]');
                for (const iframe of iframes) {
                    const src = iframe.getAttribute('src');
                    if (src && (embedPattern.test(src) || src.includes('.ws/') || src.includes('.cc/') || src.includes('.live/'))) {
                        foundUrls.push(this._normalizeUrl(src));
                    }
                }
            } catch (err) {
                console.warn('[KinogoParser] DOM embed extraction failed:', err);
            }
        }

        // 2. Script & HTML regex scanning
        const scriptPatterns = [
            /(?:https?:)?\/\/(?:api\.)?(?:ortified|variyt|namy|nextembed)\.ws\/embed\/(?:movie|serial)\/\d+/gi,
            /https?:\/\/cinemar\.cc\/embed\/\d+\/[^\s"'<>]+/gi,
            /https?:\/\/[a-zA-Z0-9_-]+\.stravers\.live\/\?token_movie=[^\s"'<>]+/gi,
            /https?:\/\/[a-zA-Z0-9_-]+\.allarknow\.online\/\?token_movie=[^\s"'<>]+/gi,
            /https?:\/\/[a-zA-Z0-9._-]+\.lumex\.cloud\/[^\s"'<>]+/gi,
            /<iframe[^>]+src="([^">]+)"/gi
        ];

        for (const pattern of scriptPatterns) {
            const matches = [...html.matchAll(pattern)].map(m => this._normalizeUrl(m[1] || m[0]));
            for (const u of matches) {
                if (embedPattern.test(u) || u.includes('.ws/') || u.includes('.cc/') || u.includes('.live/')) {
                    foundUrls.push(u);
                }
            }
        }

        // Filter and score candidate embeds
        const validUrls = [...new Set(foundUrls)]
            .filter(u => {
                if (!u || u.length < 5) return false;
                // Exclude analytics/trackers/ads
                if (u.includes('yadro.ru') || u.includes('counter') || u.includes('googletagmanager')) return false;
                // Exclude standalone trailer links if not fallback
                if (u.includes('youtube.com/embed') || u.includes('/trailer/')) return false;
                return true;
            })
            .sort((a, b) => this._scoreEmbedUrl(b) - this._scoreEmbedUrl(a));

        // A page with only a YouTube trailer has no playable film. Report no
        // sources so discovery moves on to other providers instead of
        // presenting the trailer as "KinoGo".
        return validUrls.map(url => ({
            name: 'KinoGo',
            url: url,
            type: 'iframe'
        }));
    }

    /**
     * Score embed URLs by balancer reliability.
     * @param {string} url
     * @returns {number}
     * @private
     */
    _scoreEmbedUrl(url) {
        if (!url) return -1000;
        // Known reliable working balancers
        if (url.includes('ortified.ws')) return 100;
        if (url.includes('nextembed.ws')) return 95;
        if (url.includes('variyt.ws')) return 95;
        if (url.includes('namy.ws')) return 90;
        if (url.includes('lumex.cloud')) return 85;
        if (url.includes('videocdn') || url.includes('kodik') || url.includes('alloha')) return 80;
        // Tokenized / signed fallback domains (lower priority than primary balancers, but valid as fallback)
        if (url.includes('cinemar.cc')) return 30;
        if (url.includes('stravers.live') || url.includes('allarknow.online')) return 30;
        if (url.includes('youtube.com')) return 10;
        return 50;
    }

    /**
     * Backward-compatible single source extractor.
     * @param {string} html
     * @returns {VideoSource|null}
     */
    extractKinogoDirectSource(html) {
        const sources = this.extractKinogoDirectSources(html);
        return sources.length > 0 ? sources[0] : null;
    }

    // ─── Helpers ──────────────────────────────────────────────────────

    /**
     * Build absolute URL from relative path and mirror base.
     * @param {string} url
     * @param {string} baseUrl
     * @returns {string}
     * @private
     */
    _buildAbsoluteUrl(url, baseUrl) {
        if (!url) return url;
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        const cleanBase = baseUrl.replace(/\/+$/, '');
        const cleanPath = url.startsWith('/') ? url : '/' + url;
        return cleanBase + cleanPath;
    }

    /**
     * Normalize a URL: protocol relative to https, HTML entities unescaped.
     * @param {string} url
     * @returns {string}
     * @private
     */
    _normalizeUrl(url) {
        if (!url) return url;
        let u = url.trim();
        if (u.startsWith('//')) u = 'https:' + u;
        u = u.replace(/&amp;/g, '&').replace(/&#58;/g, ':');
        return u;
    }
}

// Export — backward compatible
if (typeof window !== 'undefined') {
    window.KinogoParser = KinogoParser;
}
