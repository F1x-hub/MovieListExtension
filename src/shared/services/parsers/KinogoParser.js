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
            cacheTTL: options.cacheTTL || (15 * 60 * 1000) // 15 minutes aligned with token lifespan
        });

        /** @type {Array<string>} */
        this.mirrors = Array.isArray(options.mirrors) && options.mirrors.length > 0
            ? options.mirrors
            : [...KinogoParser.DEFAULT_MIRRORS];

        /** @type {string} */
        this._activeMirror = this.baseUrl;
        this._loadActiveMirrorFromStorage();
    }

    /**
     * Read saved active mirror from chrome.storage if available.
     * @private
     */
    _loadActiveMirrorFromStorage() {
        if (typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
            try {
                chrome.storage.local.get([KinogoParser.STORAGE_KEY], (res) => {
                    if (res && res[KinogoParser.STORAGE_KEY]) {
                        const saved = res[KinogoParser.STORAGE_KEY];
                        if (typeof saved === 'string' && saved.startsWith('http')) {
                            this._activeMirror = saved;
                            this.baseUrl = saved;
                        }
                    }
                });
            } catch {
                // Ignore storage read failures in isolated contexts
            }
        }
    }

    /**
     * Persist active mirror to chrome.storage.
     * @param {string} mirror
     * @private
     */
    _saveActiveMirror(mirror) {
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
        let serialized;
        try {
            serialized = ` ${JSON.stringify(details)}`;
        } catch {
            console.log(`[KinogoSearchTrace] ${message} [details-unserializable]`, details);
            return;
        }
        console.log(`[KinogoSearchTrace] ${message}${serialized}`, details);
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
        console.log(`[DEBUG KinogoParser] search() called. title: "${title}", year: ${targetYear}, mediaType: ${mediaType || 'unknown'}`);
        const mirrors = this.getMirrors({ mediaType });
        let lastError = null;

        for (const mirror of mirrors) {
            try {
                console.log(`[DEBUG KinogoParser] Trying mirror: ${mirror}`);
                const result = await this._searchMirror(mirror, title, targetYear, mediaType, seasonNumber);
                if (result) {
                    this._saveActiveMirror(mirror);
                    result.parserId = this.id;
                    result.source = this.id;
                    this._logSearchTrace('final result selected', {
                        mirror,
                        title: result.title,
                        url: result.url,
                        year: result.year || null,
                        detectedType: result.type || 'unknown',
                        requestedMediaType: mediaType || null,
                        compatible: this.isSearchResultCompatible(result, mediaType)
                    });
                    console.log(`[DEBUG KinogoParser] Match found on ${mirror}:`, result.url, result.year);
                    return result;
                }
                this._logSearchTrace('mirror returned no compatible result', { mirror, title, mediaType });
            } catch (error) {
                lastError = error;
                this._logSearchTrace('mirror search error', { mirror, message: error.message });
                console.warn(`[KinogoParser] Mirror ${mirror} search failed:`, error.message);
            }
        }

        if (lastError && mirrors.length === 1) {
            throw lastError;
        }

        this._logSearchTrace('search exhausted without result', { title, targetYear, mediaType, mirrors });
        console.log(`[DEBUG KinogoParser] No matches found across all mirrors for "${title}"`);
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
    async _searchMirror(mirror, title, targetYear, mediaType = null, seasonNumber = null) {
        this._logSearchTrace('mirror search started', { mirror, title, targetYear, mediaType, seasonNumber });
        // Strategy 1: GET /search/{query}
        try {
            const getUrl = `${mirror}/search/${encodeURIComponent(title)}`;
            const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
            const request = () => fetch(getUrl, {
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

            const request = () => fetch(postUrl, {
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
        console.log(`[DEBUG KinogoParser] getVideoSources() called. url:`, rawUrl?.substring(0, 80));
        if (!rawUrl) return [];

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

        let lastError = null;

        for (const mirror of mirrors) {
            const candidateUrl = this._buildAbsoluteUrl(pathname, mirror);
            try {
                console.log(`[DEBUG KinogoParser] Trying mirror for getVideoSources: ${candidateUrl}`);
                const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
                const request = () => fetch(candidateUrl, {
                    cache: 'no-store',
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                });
                const response = perf ? await perf.trackRequest('KINOGO_SOURCE', { purpose: 'getVideoSources', url: candidateUrl }, request) : await request();

                if (response.ok) {
                    const html = await response.text();
                    const sources = this.extractKinogoDirectSources(html, candidateUrl);
                    if (sources && sources.length > 0) {
                        if (mirror !== this._activeMirror) {
                            this._saveActiveMirror(mirror);
                        }
                        this._logSearchTrace('source extraction result', {
                            pageUrl: candidateUrl,
                            mirror,
                            sourceCount: sources.length,
                            sources: sources.map(source => ({
                                type: source.type || 'iframe',
                                host: (() => {
                                    try { return new URL(source.url).host; } catch { return null; }
                                })(),
                                url: source.url
                            }))
                        });
                        console.log(`[DEBUG KinogoParser] getVideoSources result: ${sources.length} sources found on ${mirror}`);
                        return sources;
                    }
                } else {
                    console.warn(`[KinogoParser] Mirror ${mirror} page fetch failed: ${response.status}`);
                }
            } catch (error) {
                lastError = error;
                console.warn(`[KinogoParser] Mirror ${mirror} page fetch error:`, error.message);
            }
        }

        if (lastError) {
            console.error(`[${this.name}] getVideoSources error across all mirrors:`, lastError);
        }
        return [];
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
                                const cardText = card.textContent || '';
                                const yearMatch = cardText.match(/\b(19|20)\d{2}\b/);
                                foundYear = yearMatch ? yearMatch[0] : null;
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

                    let year = null;
                    const ym = rawText.match(/\((\d{4})\)/);
                    if (ym) {
                        year = ym[1];
                        rawText = rawText.replace(/\(\d{4}\)/, '').trim();
                    } else {
                        const yearMatch = block.match(/Год\s*(?:выпуска)?\s*:?\s*(?:<[^>]+>)*\s*(\d{4})/i)
                            || block.match(/\b(?:19|20)\d{2}\b/);
                        if (yearMatch) year = yearMatch[1] || yearMatch[0];
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
            matches.sort((a, b) => {
                let scoreA = 0;
                let scoreB = 0;

                if (targetYear) {
                    const ty = parseInt(targetYear, 10);
                    if (a.year) {
                        const ya = parseInt(a.year, 10);
                        if (ya === ty) scoreA += 100;
                        else if (Math.abs(ya - ty) <= 1) scoreA += 50;
                        else scoreA -= Math.min(100, Math.abs(ya - ty) * 10);
                    }
                    if (b.year) {
                        const yb = parseInt(b.year, 10);
                        if (yb === ty) scoreB += 100;
                        else if (Math.abs(yb - ty) <= 1) scoreB += 50;
                        else scoreB -= Math.min(100, Math.abs(yb - ty) * 10);
                    }
                }

                if (requestedSeasonNumber != null) {
                    const seasonA = this.extractSearchSeasonNumber(a);
                    const seasonB = this.extractSearchSeasonNumber(b);
                    if (seasonA === requestedSeasonNumber) scoreA += 1000;
                    else if (seasonA != null) scoreA -= 100;
                    if (seasonB === requestedSeasonNumber) scoreB += 1000;
                    else if (seasonB != null) scoreB -= 100;
                }

                const normTarget = targetTitle.toLowerCase().replace(/[^a-zа-я0-9]/g, '');
                const normA = (a.title || '').toLowerCase().replace(/[^a-zа-я0-9]/g, '');
                const normB = (b.title || '').toLowerCase().replace(/[^a-zа-я0-9]/g, '');

                if (normA === normTarget) scoreA += 50;
                if (normB === normTarget) scoreB += 50;

                return scoreB - scoreA;
            });

            const best = matches[0];
            this._logSearchTrace('ranking result', {
                mirror,
                parserPath,
                requestedMediaType: movieType || null,
                requestedSeasonNumber,
                ranked: matches.map((match, index) => ({
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
            if (targetYear && best.year) {
                const diff = Math.abs(parseInt(best.year, 10) - parseInt(targetYear, 10));
                const normTarget = targetTitle.toLowerCase().replace(/[^a-zа-я0-9]/g, '');
                const normBest = (best.title || '').toLowerCase().replace(/[^a-zа-я0-9]/g, '');
                const bestMatchesRequestedSeason = requestedSeasonNumber != null
                    && this.extractSearchSeasonNumber(best) === requestedSeasonNumber;
                if (diff > 2 && normTarget !== normBest && !bestMatchesRequestedSeason) {
                    console.log(`[DEBUG KinogoParser] Rejecting match "${best.title}" (${best.year}) for "${targetTitle}" (${targetYear}) due to year divergence (${diff} yrs)`);
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

    /**
     * Normalized title comparison (ignores punctuation, case, ё->е).
     * Strictly verifies sequel and part numbers to prevent matching Part 1 when searching Part 2.
     * @param {string} foundTitle
     * @param {string} targetTitle
     * @returns {boolean}
     */
    isTitleMatch(foundTitle, targetTitle, options = {}) {
        if (!foundTitle || !targetTitle) return false;
        const normalize = str => str.toLowerCase()
            .replace(/[ё]/g, 'е')
            .replace(/[^a-zа-я0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        let cleanFound = normalize(foundTitle);
        const cleanTarget = normalize(targetTitle);
        if (!cleanFound || !cleanTarget) return false;
        if (cleanFound === cleanTarget) return true;

        // KinoGo often puts the season in the result title, while the app searches
        // by the canonical series title (for example, "Джек Ричер 4 сезон").
        // Strip only an explicit season/series suffix and only for a series query;
        // standalone film parts such as "Джон Уик 2" remain strict matches.
        if (options.allowSeriesSuffix) {
            cleanFound = cleanFound.replace(
                /\s+(?:(?:\d+|i|ii|iii|iv|v|vi|vii|viii|ix|x)\s+)?(?:сезон(?:а|ов)?|season|series)(?:\s.*)?$/i,
                ''
            ).trim();
            if (cleanFound === cleanTarget) return true;
        }

        const extractNumbers = str => {
            const matches = str.match(/\b(?:\d+|i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/gi) || [];
            return matches.map(m => {
                const romanMap = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
                const lower = m.toLowerCase();
                return romanMap[lower] || lower;
            });
        };

        const targetNumbers = extractNumbers(cleanTarget);
        const foundNumbers = extractNumbers(cleanFound);

        if (targetNumbers.length > 0) {
            for (const num of targetNumbers) {
                if (!foundNumbers.includes(num)) {
                    return false;
                }
            }
        } else if (foundNumbers.length > 0) {
            const nonOneNumbers = foundNumbers.filter(n => n !== '1' && n !== '01');
            if (nonOneNumbers.length > 0) {
                return false;
            }
        }

        const targetWords = cleanTarget.split(' ').filter(w => w.length > 1);
        const foundWords = cleanFound.split(' ').filter(w => w.length > 1);
        if (targetWords.length === 0) return false;

        const targetInFound = targetWords.every(w => cleanFound.includes(w));
        const foundInTarget = foundWords.length >= 2 && foundWords.every(w => cleanTarget.includes(w));
        return targetInFound || foundInTarget;
    }

    // ─── Direct Source Extraction ────────────────────────────────────

    /**
     * Extract embed player sources from KinoGo movie page HTML.
     * Supports Ortified, Cinemar, Lumex, Stravers, Namy, Variyt and generic iframes.
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
            /(?:https?:)?\/\/(?:api\.)?(?:ortified|variyt|namy)\.ws\/embed\/(?:movie|serial)\/\d+/gi,
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

        // Fallback to youtube trailer only if no real player was found
        if (validUrls.length === 0) {
            const trailerMatch = html.match(/https?:\/\/www\.youtube\.com\/embed\/[a-zA-Z0-9_-]+/i);
            if (trailerMatch) {
                validUrls.push(trailerMatch[0]);
            }
        }

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
