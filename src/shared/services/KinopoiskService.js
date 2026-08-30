/**
 * KinopoiskService - Service for interacting with Kinopoisk API
 * Handles movie search and detailed movie information retrieval
 */
class QuotaExhaustedError extends Error {
    constructor(message = 'Kinopoisk daily quota exhausted') {
        super(message);
        this.name = 'QuotaExhaustedError';
        this.code = 'DAILY_LIMIT_REACHED';
    }
}

class KinopoiskNetworkError extends Error {
    constructor(message, cause = null) {
        super(message || 'Kinopoisk network request failed');
        this.name = 'KinopoiskNetworkError';
        this.code = 'KINOPOISK_NETWORK';
        this.cause = cause;
    }
}

class KinopoiskAuthError extends Error {
    constructor(status = 401) {
        super(`Kinopoisk API authentication failed (${status})`);
        this.name = 'KinopoiskAuthError';
        this.code = 'KINOPOISK_AUTH';
        this.status = status;
    }
}

class KinopoiskAccessError extends Error {
    constructor(status, message = `Kinopoisk API access denied (${status})`) {
        super(message);
        this.name = 'KinopoiskAccessError';
        this.code = 'KINOPOISK_ACCESS_DENIED';
        this.status = status;
    }
}

class KinopoiskRateLimitError extends Error {
    constructor(retryAfterMs = null) {
        super('Kinopoisk API rate limit reached');
        this.name = 'KinopoiskRateLimitError';
        this.code = 'KINOPOISK_RATE_LIMITED';
        this.status = 429;
        this.retryAfterMs = Number.isFinite(retryAfterMs) ? retryAfterMs : null;
    }
}

class KinopoiskServerError extends Error {
    constructor(status = 500) {
        super(`Kinopoisk API server error (${status})`);
        this.name = 'KinopoiskServerError';
        this.code = 'KINOPOISK_SERVER';
        this.status = status;
    }
}

function isQuotaExhaustedError(error) {
    return error instanceof QuotaExhaustedError || error?.name === 'QuotaExhaustedError';
}

function kinopoiskTraceNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function createKinopoiskSearchTrace(traceId, query, startedAtOverride = null) {
    const startedAt = Number.isFinite(startedAtOverride)
        ? startedAtOverride
        : kinopoiskTraceNow();
    return {
        traceId: traceId || `kp-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        query,
        startedAt,
        mark(stage, details = {}) {
            const elapsedMs = Math.round((kinopoiskTraceNow() - startedAt) * 10) / 10;
            console.info('[KinopoiskSearchTrace]', {
                traceId: this.traceId,
                query: this.query,
                stage,
                elapsedMs,
                ...details
            });
            return elapsedMs;
        }
    };
}

function stageDurationMs(startedAt) {
    return Math.round((kinopoiskTraceNow() - startedAt) * 10) / 10;
}

async function responseIndicatesDailyLimit(response) {
    if (!response || ![402, 403, 503].includes(Number(response.status))) return false;

    try {
        const body = typeof response.clone === 'function'
            ? await response.clone().json()
            : typeof response.json === 'function'
                ? await response.json()
                : null;
        const text = JSON.stringify(body || '').toLowerCase();
        return /daily[_ -]?limit|daily[_ -]?quota|quota[_ -]?exhausted|kp_quota_exhausted|суточн|лимит/.test(text);
    } catch {
        return false;
    }
}

const DEFAULT_KINOPOISK_PROXY_URL = 'https://us-central1-movielistdb-13208.cloudfunctions.net/kinopoiskProxy';

async function getKinopoiskIdToken() {
    if (typeof firebase !== 'undefined' && typeof firebase.auth === 'function') {
        try {
            const currentUser = firebase.auth().currentUser;
            if (currentUser?.getIdToken) {
                return await currentUser.getIdToken();
            }
        } catch (error) {
            console.warn('KinopoiskService: Firebase token lookup failed:', error?.message || error);
        }
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const response = await chrome.runtime.sendMessage({ type: 'GET_ID_TOKEN' });
        if (response?.success && response.token) return response.token;
    }

    throw new KinopoiskAuthError(401);
}

function getKinopoiskProxyErrorCode(response) {
    if (!response || typeof response.clone !== 'function') return Promise.resolve('');

    return response.clone().json()
        .then(body => body?.error?.code || body?.code || '')
        .catch(() => '');
}

class KinopoiskService {
    constructor(tmdbService = null) {
        this.baseUrl = KINOPOISK_CONFIG.BASE_URL;
        this.apiKey = KINOPOISK_CONFIG.API_KEY;
        this.defaultLimit = KINOPOISK_CONFIG.DEFAULT_LIMIT;
        this.tmdbService = tmdbService || (typeof TMDBService !== 'undefined' ? new TMDBService() : null);
        this.tmdbFallbackQueueService = typeof TmdbFallbackQueueService !== 'undefined'
            ? new TmdbFallbackQueueService() : null;
    }

    /**
     * Internal fetch method that routes Kinopoisk API traffic through Firebase.
     * @param {string} url - Kinopoisk API URL
     * @param {Object} options - Fetch options
     * @returns {Promise<Response>} - Proxy response
     */
    async _fetchWithRotation(url, options = {}) {
        const quotaState = typeof globalThis !== 'undefined' ? globalThis.kinopoiskQuota : null;
        if (typeof quotaState?.isQuotaExhausted === 'function' && await quotaState.isQuotaExhausted()) {
            globalThis.quotaTracker?.track('KinopoiskService.fetchWithRotation', 'skipped');
            console.warn('[KinopoiskQuota] Request skipped by local circuit breaker',
                typeof quotaState.getQuotaStatus === 'function' ? quotaState.getQuotaStatus() : undefined);
            throw new QuotaExhaustedError();
        }

        let targetUrl;
        try {
            targetUrl = new URL(url);
            const apiOrigin = new URL(this.baseUrl).origin;
            if (targetUrl.origin !== apiOrigin || !targetUrl.pathname.startsWith('/v1.4/')) {
                throw new Error('Kinopoisk proxy rejected an invalid target URL');
            }
        } catch (error) {
            throw new KinopoiskNetworkError(error.message, error);
        }

        const proxyUrl = new URL(KINOPOISK_CONFIG.PROXY_URL || DEFAULT_KINOPOISK_PROXY_URL);
        proxyUrl.searchParams.set('path', `${targetUrl.pathname}${targetUrl.search}`);

        let response;
        try {
            const token = await getKinopoiskIdToken();
            globalThis.quotaTracker?.track('KinopoiskService.fetchWithRotation', 'network');
            response = await fetch(proxyUrl.toString(), {
                ...options,
                headers: {
                    'Accept': 'application/json',
                    ...options.headers,
                    'Authorization': `Bearer ${token}`
                }
            });
        } catch (netErr) {
            if (netErr?.name === 'AbortError') throw netErr;
            throw netErr instanceof KinopoiskAuthError
                ? netErr
                : new KinopoiskNetworkError(netErr.message, netErr);
        }

        const proxyErrorCode = await getKinopoiskProxyErrorCode(response);
        if (response.status === 401 || proxyErrorCode === 'AUTH_REQUIRED') {
            throw new KinopoiskAuthError(response.status || 401);
        }

        if (response.status === 503 && (proxyErrorCode === 'KP_QUOTA_EXHAUSTED' || await responseIndicatesDailyLimit(response))) {
            if (typeof quotaState?.markQuotaExhausted === 'function') {
                await quotaState.markQuotaExhausted();
            }
            throw new QuotaExhaustedError();
        }

        if (response.status === 429) {
            const retryAfter = Number.parseInt(response.headers?.get?.('Retry-After'), 10);
            const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : null;
            throw new KinopoiskRateLimitError(delay);
        }

        if (response.status >= 500) {
            throw new KinopoiskServerError(response.status);
        }

        return response;
    }

    /**
    /**
     * Parse raw HTML from kinopoisk.ru search result page.
     * Extracts ordered (type, id) list without using DOM/DOMParser (service worker safe).
     * @param {string} html - Raw HTML
     * @param {number} limit - Maximum number of items (default: 30)
     * @returns {{ success: boolean, reason?: string, items: Array<{ type: string, id: number }> }}
     */
    parseSearchResultsHtml(html, limit = 30) {
        if (!html || typeof html !== 'string') {
            return { success: false, reason: 'EMPTY_HTML', items: [] };
        }

        // Detect Captcha / SmartCaptcha / SSO challenge / Anti-bot pages
        const isChallenge = /sso\.(?:kinopoisk|passport\.yandex)\.ru|showcaptcha|smartcaptcha|captcha-wrapper/i.test(html) ||
                            (/<script[^>]*>[\s\S]*?it\.host[\s\S]*?_emitProbe/i.test(html));
        if (isChallenge) {
            return { success: false, reason: 'CAPTCHA_OR_SSO_CHALLENGE', items: [] };
        }

        // a. Restrict parsing scope to sections with data-testid="search-top-result" and data-testid="search-films"
        // Excludes data-testid="search-persons" and data-testid="search-movie-lists"
        const sectionRegex = /<section\b[^>]*data-test(?:-)?id=["'](?:search-top-result|search-films)["'][^>]*>([\s\S]*?)<\/section>/gi;
        let sectionMatch;
        let combinedSectionsHtml = '';
        let sectionCount = 0;

        while ((sectionMatch = sectionRegex.exec(html)) !== null) {
            combinedSectionsHtml += sectionMatch[1] + '\n';
            sectionCount++;
        }

        // If no matching sections were found
        if (sectionCount === 0) {
            // If the document is large (> 1000 characters), this indicates unexpected layout or soft blocking
            if (html.length > 1000) {
                return { success: false, reason: 'LAYOUT_CHANGED_OR_UNEXPECTED_HTML', items: [] };
            }
            return { success: true, items: [] };
        }

        // b & c. Inside the allowed sections, match data-test-id="next-link" anchors with /(film|series)/(ID)/
        // Handle both attribute orders (data-test-id before href and href before data-test-id)
        const anchorRegex = /<a\b(?=[^>]*\bdata-test(?:-)?id=["']next-link["'])[^>]*\bhref=["']?\/(film|series)\/(\d+)\/["']?[^>]*>/gi;
        const items = [];
        const seenKeys = new Set();
        let aMatch;

        while ((aMatch = anchorRegex.exec(combinedSectionsHtml)) !== null) {
            const type = aMatch[1].toLowerCase(); // 'film' or 'series'
            const id = parseInt(aMatch[2], 10);
            if (!id || isNaN(id)) continue;

            const dedupeKey = `${id}`;
            if (!seenKeys.has(dedupeKey)) {
                seenKeys.add(dedupeKey);
                const linkStart = combinedSectionsHtml.lastIndexOf('<a', aMatch.index);
                const linkEnd = combinedSectionsHtml.indexOf('</a>', aMatch.index);
                const anchorHtml = linkStart >= 0 && linkEnd > aMatch.index
                    ? combinedSectionsHtml.slice(linkStart, linkEnd)
                    : '';
                const metadata = this._extractSearchResultMetadata(anchorHtml);
                const itemMarker = 'data-test-id="movie-list-item"';
                const itemMarkerIndex = combinedSectionsHtml.lastIndexOf(itemMarker, aMatch.index);
                const itemStart = itemMarkerIndex >= 0
                    ? combinedSectionsHtml.lastIndexOf('<div', itemMarkerIndex)
                    : -1;
                const nextItemMarker = combinedSectionsHtml.indexOf(itemMarker, aMatch.index + 1);
                const itemHtml = itemStart >= 0
                    ? combinedSectionsHtml.slice(itemStart, nextItemMarker >= 0 ? nextItemMarker : combinedSectionsHtml.length)
                    : combinedSectionsHtml.slice(Math.max(0, aMatch.index - 500), aMatch.index + 5000);
                const ratingMetadata = this._extractSearchResultRatingMetadata(itemHtml);
                items.push({ type, id, ...metadata, ...ratingMetadata });
                if (items.length >= limit) {
                    break;
                }
            }
        }

        return { success: true, items };
    }

    _extractSearchResultMetadata(anchorHtml) {
        if (!anchorHtml) return {};

        const titleMatch = anchorHtml.match(/<[^>]*class=["'][^"']*mainTitle[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
        const originalMatch = anchorHtml.match(/<[^>]*class=["'][^"']*secondaryTitle[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
        const text = this._stripSearchHtml(anchorHtml);
        const yearMatch = text.match(/\b((?:18|19|20)\d{2})\b/);
        const title = titleMatch ? this._stripSearchHtml(titleMatch[1]) : '';
        const originalTitle = originalMatch ? this._stripSearchHtml(originalMatch[1]) : '';

        if (!title && !originalTitle) return {};

        return {
            ...(title ? { title } : {}),
            ...(originalTitle ? { originalTitle } : {}),
            ...(yearMatch ? { year: Number(yearMatch[1]) } : {})
        };
    }

    _extractSearchResultRatingMetadata(itemHtml) {
        if (!itemHtml) return {};

        const text = this._stripSearchHtml(itemHtml);
        const ratingMatch = text.match(/Рейтинг\s+Кинопоиска\s*([0-9]+(?:[.,][0-9]+)?)/i)
            || itemHtml.match(/class=["'][^"']*kinopoiskValue(?:Positive|Neutral|Negative)[^"']*["'][^>]*>\s*([0-9]+(?:[.,][0-9]+)?)/i);
        const votesMatch = itemHtml.match(/class=["'][^"']*kinopoiskCount[^"']*["'][^>]*>\s*([\d\s\u00A0]+)/i)
            || text.match(/([\d\s\u00A0]+)\s*оцен/i);
        const kpRating = ratingMatch ? Number.parseFloat(ratingMatch[1].replace(',', '.')) : 0;
        const kpVotes = votesMatch ? Number.parseInt(votesMatch[1].replace(/\D/g, ''), 10) : 0;

        return {
            ...(Number.isFinite(kpRating) && kpRating > 0 ? { kpRating } : {}),
            ...(Number.isInteger(kpVotes) && kpVotes > 0 ? { kpVotes } : {})
        };
    }

    _stripSearchHtml(value) {
        return String(value || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Scrape search results from kinopoisk.ru using real browser context (offscreen document + iframe + content script)
     * @param {string} query - Raw search query
     * @param {Object} options - { limit, timeoutMs, signal }
     * @returns {Promise<Array<{ type: string, id: number }>|null>}
     */
    async scrapeSearchResultsOffscreen(query, options = {}) {
        const cleanQuery = this.normalizeQuery(query);
        if (!cleanQuery) return [];

        if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
            // Not running in Chrome extension context (e.g. unit tests or node)
            return null;
        }

        const trace = createKinopoiskSearchTrace(
            options.traceId,
            cleanQuery,
            options.traceStartedAt
        );
        const stageStartedAt = kinopoiskTraceNow();

        try {
            console.log(`KinopoiskService: Requesting offscreen browser scraping for "${cleanQuery}"`);
            const timeoutMs = options.timeoutMs || 8000;
            trace.mark('offscreen:start', {
                timeoutMs,
                requireRating: options.requireRating === true,
                requestKey: options.requestKey || null
            });

            const response = await chrome.runtime.sendMessage({
                type: 'KINOPOISK_OFFSCREEN_SCRAPE',
                query: cleanQuery,
                timeoutMs,
                requireRating: options.requireRating === true,
                requestKey: options.requestKey || null,
                traceId: options.traceId || null,
                priority: options.priority || 'visible-identity',
                sessionId: options.sessionId || null
            });
            trace.mark('offscreen:response', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                success: response?.success === true,
                reason: response?.reason || null,
                itemCount: Array.isArray(response?.items) ? response.items.length : 0,
                providerRequestId: response?.metrics?.requestId || null
            });
            if (response?.metrics) {
                console.info('[KinopoiskRatingsMetrics] search', response.metrics);
            }

            if (response && response.success && Array.isArray(response.items) && response.items.length > 0) {
                const ratingCount = response.items.filter(item => Number(item?.kpRating) > 0).length;
                console.log(`KinopoiskService: Offscreen scraper succeeded with ${response.items.length} items`, {
                    requireRating: options.requireRating === true,
                    ratingCount
                });
                const items = response.items.slice(0, options.limit || 30);
                trace.mark('offscreen:success', {
                    stageDurationMs: stageDurationMs(stageStartedAt),
                    itemCount: items.length,
                    ratingCount
                });
                return options.returnDiagnostics === true
                    ? { items, failureReason: null, metrics: response.metrics || null }
                    : items;
            }

            if (response?.reason === 'SCRAPE_BLOCKED_EVEN_WITH_SESSION') {
                console.warn('[Scraper Diagnostic] SCRAPE_BLOCKED_EVEN_WITH_SESSION: Anti-bot / SSO challenge detected despite browser context');
            } else if (response?.reason) {
                console.warn(`[Scraper Diagnostic] Offscreen scraper failed with reason: ${response.reason}`);
            }

            trace.mark('offscreen:failed', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                reason: response?.reason || 'OFFSCREEN_UNKNOWN_FAILURE'
            });

            return options.returnDiagnostics === true
                ? {
                    items: response?.success ? [] : null,
                    failureReason: response?.reason || 'OFFSCREEN_UNKNOWN_FAILURE',
                    metrics: response?.metrics || null
                }
                : null;
        } catch (error) {
            console.warn('KinopoiskService: Offscreen scrape communication error:', error);
            trace.mark('offscreen:error', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                errorName: error?.name || 'Error',
                errorMessage: error?.message || String(error)
            });
            if (options.returnDiagnostics === true) {
                return { items: null, failureReason: 'OFFSCREEN_MESSAGE_FAILED', error: error.message };
            }
            return null;
        }
    }

    /**
     * Read KP and IMDb ratings from a Kinopoisk movie page in the existing
     * hidden browser-context scraper. This avoids IMDb's service-worker 202
     * challenge and does not open a visible tab.
     * @param {number|string} kinopoiskId
     * @param {Object} options - { timeoutMs }
     * @returns {Promise<{kpRating:number, imdbRating:number, imdbId:string|null}|null>}
     */
    async scrapeMoviePageRatingsOffscreen(kinopoiskId, options = {}) {
        const numericId = Number(kinopoiskId);
        if (!Number.isInteger(numericId) || numericId <= 0) return null;

        if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
            return null;
        }

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'KINOPOISK_MOVIE_RATINGS_OFFSCREEN',
                kinopoiskId: numericId,
                mediaType: options.mediaType || null,
                timeoutMs: options.timeoutMs || 8000,
                requestKey: options.requestKey || `kp-detail:${numericId}:${options.mediaType || 'movie'}`,
                priority: options.priority || 'visible-ratings',
                sessionId: options.sessionId || null
            });
            if (response?.metrics) {
                console.info('[KinopoiskRatingsMetrics] movie-page', response.metrics);
            }

            if (response?.success && response.ratings) {
                console.info('[KinopoiskRatingsTrace] movie-page-result', {
                    kinopoiskId: numericId,
                    ratings: response.ratings
                });
                return options.returnDiagnostics === true
                    ? { ratings: response.ratings, failureReason: null, metrics: response.metrics || null }
                    : response.ratings;
            }

            console.info('[KinopoiskRatingsTrace] movie-page-empty', {
                kinopoiskId: numericId,
                reason: response?.reason || 'NO_RATINGS'
            });
            return options.returnDiagnostics === true
                ? { ratings: null, failureReason: response?.reason || 'OFFSCREEN_UNKNOWN_FAILURE', metrics: response?.metrics || null }
                : null;
        } catch (error) {
            console.warn('[KinopoiskRatingsTrace] movie-page-error', {
                kinopoiskId: numericId,
                message: error.message
            });
            if (options.returnDiagnostics === true) {
                return { ratings: null, failureReason: 'OFFSCREEN_MESSAGE_FAILED', error: error.message };
            }
            return null;
        }
    }

    /**
     * Scrape search results from kinopoisk.ru/new-search/
     * @param {string} query - Raw search query
     * @param {Object} options - { limit, timeoutMs, signal }
     * @returns {Promise<Array<{ type: string, id: number }>|null>} - List of (type, id) or null on failure
     */
    async scrapeSearchResults(query, options = {}) {
        const cleanQuery = this.normalizeQuery(query);
        if (!cleanQuery) return [];

        const timeoutMs = options.timeoutMs || 4500;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        if (options.signal) {
            options.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }

        const trace = createKinopoiskSearchTrace(options.traceId, cleanQuery, options.traceStartedAt);
        const stageStartedAt = kinopoiskTraceNow();

        try {
            const scrapeUrl = `https://www.kinopoisk.ru/new-search/?text=${encodeURIComponent(cleanQuery)}`;
            console.log(`KinopoiskService: Scraping search results from ${scrapeUrl}`);
            trace.mark('fetch-scraper:start', { timeoutMs, scrapeUrl });

            const response = await fetch(scrapeUrl, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
                }
            });
            trace.mark('fetch-scraper:response', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                status: response.status,
                ok: response.ok
            });

            if (!response.ok) {
                console.warn(`KinopoiskService: Scraper failed with HTTP status ${response.status} ${response.statusText}`);
                trace.mark('fetch-scraper:failed', {
                    stageDurationMs: stageDurationMs(stageStartedAt),
                    reason: `HTTP_${response.status}`
                });
                return null;
            }

            const html = await response.text();
            trace.mark('fetch-scraper:body-read', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                htmlBytes: html.length
            });
            const parseResult = this.parseSearchResultsHtml(html, options.limit || 30);
            trace.mark('fetch-scraper:parsed', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                success: parseResult.success === true,
                reason: parseResult.reason || null,
                itemCount: parseResult.items?.length || 0
            });

            if (!parseResult.success) {
                console.warn(`KinopoiskService: Scraper parse failed (reason: ${parseResult.reason})`);
                return null;
            }

            console.log(`KinopoiskService: Successfully scraped ${parseResult.items.length} items from Kinopoisk`);
            trace.mark('fetch-scraper:success', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                itemCount: parseResult.items.length
            });
            return parseResult.items;
        } catch (error) {
            console.warn(`KinopoiskService: Scraper error (${error.name || 'Error'}: ${error.message})`);
            trace.mark('fetch-scraper:error', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                errorName: error?.name || 'Error',
                errorMessage: error?.message || String(error)
            });
            return null;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Build renderable search candidates from the parser output without waiting
     * for the slower API entity-resolution request.
     * @param {Array<{ type: string, id: number, title?: string, originalTitle?: string, year?: number, kpRating?: number, kpVotes?: number }>} items
     * @returns {Array<Object>}
     */
    createScrapedSearchCandidates(items = []) {
        return items
            .map(item => {
                const id = Number(item?.id);
                if (!Number.isInteger(id) || id <= 0) return null;

                const isSeries = item.type === 'series';
                const name = item.title || item.originalTitle || `Кино #${id}`;
                return {
                    kinopoiskId: id,
                    name,
                    alternativeName: item.originalTitle || '',
                    posterUrl: '',
                    year: Number(item.year) || 0,
                    kpRating: Number(item.kpRating) || 0,
                    imdbRating: 0,
                    kpVotes: Number(item.kpVotes) || 0,
                    description: '',
                    genres: [],
                    countries: [],
                    duration: 0,
                    isSeries,
                    type: isSeries ? 'tv-series' : 'movie',
                    searchCandidate: true,
                    searchEntityResolutionPending: true
                };
            })
            .filter(Boolean);
    }

    /**
     * Batch fetch movies by Kinopoisk IDs from the API, preserving the input IDs order.
     * @param {Array<{ type: string, id: number }>} items - Array of { type, id }
     * @param {Object} options - Options { signal }
     * @returns {Promise<Array<Object>>} - Array of normalized movie objects
     */
    async getMoviesByIdsBatch(items, options = {}) {
        if (!items || items.length === 0) return [];

        const ids = items.map(item => item.id).filter(Boolean);
        if (ids.length === 0) return [];

        const trace = createKinopoiskSearchTrace(options.traceId, 'batch-by-ids', options.traceStartedAt);
        const stageStartedAt = kinopoiskTraceNow();
        trace.mark('batch-by-ids:start', { requestedIdCount: ids.length });

        try {
            const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.MOVIE}`;
            const params = new URLSearchParams({
                limit: Math.min(ids.length, 100).toString(),
                page: '1'
            });
            ids.forEach(id => params.append('id', id.toString()));

            const response = await this._fetchWithRotation(`${url}?${params}`, {
                method: 'GET',
                signal: options.signal
            });
            trace.mark('batch-by-ids:response', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                status: response.status,
                ok: response.ok
            });

            if (!response.ok) {
                console.warn(`KinopoiskService: Batch fetch by IDs failed with status ${response.status}`);
                trace.mark('batch-by-ids:failed', {
                    stageDurationMs: stageDurationMs(stageStartedAt),
                    reason: `HTTP_${response.status}`
                });
                return [];
            }

            const data = await response.json();
            const docs = data.docs || [];
            trace.mark('batch-by-ids:body-read', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                apiDocCount: docs.length
            });
            const movieMap = new Map();

            for (const doc of docs) {
                const normalized = this.normalizeMovieData(doc);
                if (normalized && normalized.kinopoiskId) {
                    movieMap.set(Number(normalized.kinopoiskId), normalized);
                }
            }

            // Reconstruct array strictly following scraped items order
            const orderedMovies = [];
            for (const item of items) {
                const movie = movieMap.get(Number(item.id));
                if (movie) {
                    if (item.type === 'series') {
                        movie.isSeries = true;
                    }
                    orderedMovies.push(movie);
                }
            }

            trace.mark('batch-by-ids:success', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                apiDocCount: docs.length,
                orderedMovieCount: orderedMovies.length,
                missingMovieCount: Math.max(0, ids.length - orderedMovies.length)
            });
            return orderedMovies;
        } catch (error) {
            console.error('KinopoiskService: Error in getMoviesByIdsBatch:', error);
            trace.mark('batch-by-ids:error', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                errorName: error?.name || 'Error',
                errorMessage: error?.message || String(error)
            });
            return [];
        }
    }

    /**
     * Parse Kinopoisk's full recommendations page (/like/) in browser context.
     * This is deliberately separate from the API search path: one HTML page
     * contains ordered cards and does not consume Kinopoisk API quota.
     * @param {number|string} kinopoiskId - Source Kinopoisk ID
     * @param {Object} options - { mediaType, timeoutMs, signal, traceId, requestKey }
     * @returns {Promise<Array<Object>|null>}
     */
    async scrapeSimilarMoviesOffscreen(kinopoiskId, options = {}) {
        const numericId = Number(kinopoiskId);
        if (!Number.isInteger(numericId) || numericId <= 0) return [];

        if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
            return null;
        }

        const trace = createKinopoiskSearchTrace(
            options.traceId,
            `similar:${numericId}`,
            options.traceStartedAt
        );
        const stageStartedAt = kinopoiskTraceNow();
        const timeoutMs = options.timeoutMs || 8000;
        const queueDeadlineMs = Number(options.queueDeadlineMs) || timeoutMs;

        trace.mark('similar:offscreen:start', {
            kinopoiskId: numericId,
            mediaType: options.mediaType || null,
            timeoutMs,
            queueDeadlineMs,
            requestKey: options.requestKey || null
        });

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'KINOPOISK_SIMILAR_OFFSCREEN',
                kinopoiskId: numericId,
                mediaType: options.mediaType || null,
                timeoutMs,
                queueDeadlineMs,
                requestKey: options.requestKey || null,
                traceId: options.traceId || null,
                priority: options.priority || 'below-viewport',
                sessionId: options.sessionId || null
            });

            const items = Array.isArray(response?.items) ? response.items : [];
            trace.mark('similar:offscreen:response', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                success: response?.success === true,
                reason: response?.reason || null,
                itemCount: items.length,
                providerRequestId: response?.metrics?.requestId || null,
                scraperDiagnostics: response?.diagnostics || null
            });
            if (response?.metrics) {
                console.info('[KinopoiskSimilarMetrics] scrape', response.metrics);
            }

            if (response?.success === true) {
                console.log(`KinopoiskService: Similar page scraper succeeded with ${items.length} items`, {
                    kinopoiskId: numericId,
                    mediaType: options.mediaType || null,
                    apiQuotaRequests: 0
                });
                return items;
            }

            console.warn('[Scraper Diagnostic] Similar page scrape failed', {
                kinopoiskId: numericId,
                reason: response?.reason || 'OFFSCREEN_UNKNOWN_FAILURE'
            });
            return null;
        } catch (error) {
            trace.mark('similar:offscreen:error', {
                stageDurationMs: stageDurationMs(stageStartedAt),
                errorName: error?.name || 'Error',
                errorMessage: error?.message || String(error)
            });
            console.warn('KinopoiskService: Similar page scraper request failed:', error);
            return null;
        }
    }

    /**
     * Search for movies by query
     * @param {string} query - Search query
     * @param {number} page - Page number (default: 1)
     * @param {number} limit - Results per page (default: 20)
     * @param {Object} filters - Optional filters object {yearFrom, yearTo, genresInclude, genresExclude, countriesInclude, countriesExclude}
     * @returns {Promise<Object>} - Search results
     */
    async searchMovies(query, page = 1, limit = this.defaultLimit, filters = null) {
        // Clean and normalize the query
        const cleanQuery = this.normalizeQuery(query);
        const trace = createKinopoiskSearchTrace(
            filters?.searchTraceId,
            cleanQuery,
            filters?.searchTraceStartedAt
        );
        const searchStartedAt = trace.startedAt;
        const finishSearchTrace = (outcome, details = {}) => trace.mark('search:complete', {
            outcome,
            totalMs: stageDurationMs(searchStartedAt),
            ...details
        });
        console.log(`KinopoiskService: Searching for "${query}" (normalized: "${cleanQuery}")`);

        // Attempt 3-Tier Hybrid Search on page 1 when no metadata filters are set
        const isDefaultSearch = page === 1 && (!filters || (!filters.yearFrom && (!filters.genresInclude || filters.genresInclude.length === 0) && (!filters.countriesInclude || filters.countriesInclude.length === 0)));
        trace.mark('search:start', {
            page,
            limit,
            isDefaultSearch,
            skipScraper: filters?.skipScraper === true,
            skipOffscreen: filters?.skipOffscreen === true,
            skipFetchScraper: filters?.skipFetchScraper === true
        });

        if (isDefaultSearch && !filters?.skipScraper) {
            let scrapedItems = null;
            let scrapeSource = 'kinopoisk-offscreen-scrape';

            // Tier 1: Real Browser Context Scraping (Offscreen Document + iframe + Content Script)
            if (!filters?.skipOffscreen) {
                const stageStartedAt = kinopoiskTraceNow();
                trace.mark('tier-1-offscreen:start');
                try {
                    scrapedItems = await this.scrapeSearchResultsOffscreen(query, {
                        limit: Math.max(limit, 30),
                        signal: filters?.signal,
                        traceId: trace.traceId,
                        traceStartedAt: trace.startedAt
                    });
                    trace.mark('tier-1-offscreen:end', {
                        stageDurationMs: stageDurationMs(stageStartedAt),
                        itemCount: Array.isArray(scrapedItems) ? scrapedItems.length : 0,
                        success: Array.isArray(scrapedItems) && scrapedItems.length > 0
                    });
                } catch (offscreenErr) {
                    trace.mark('tier-1-offscreen:error', {
                        stageDurationMs: stageDurationMs(stageStartedAt),
                        errorName: offscreenErr?.name || 'Error',
                        errorMessage: offscreenErr?.message || String(offscreenErr)
                    });
                    console.warn('KinopoiskService: Tier 1 offscreen scraper failed:', offscreenErr);
                }
            }

            // Tier 2: DOM-independent Regex Fetch Scraping (reserve fallback)
            if (!scrapedItems || scrapedItems.length === 0) {
                if (!filters?.skipFetchScraper) {
                    const stageStartedAt = kinopoiskTraceNow();
                    trace.mark('tier-2-fetch-scraper:start');
                    try {
                        scrapedItems = await this.scrapeSearchResults(query, {
                            limit: Math.max(limit, 30),
                            signal: filters?.signal,
                            traceId: trace.traceId,
                            traceStartedAt: trace.startedAt
                        });
                        trace.mark('tier-2-fetch-scraper:end', {
                            stageDurationMs: stageDurationMs(stageStartedAt),
                            itemCount: Array.isArray(scrapedItems) ? scrapedItems.length : 0,
                            success: Array.isArray(scrapedItems) && scrapedItems.length > 0
                        });
                        if (scrapedItems && scrapedItems.length > 0) {
                            scrapeSource = 'kinopoisk-scrape';
                        }
                    } catch (fetchScraperErr) {
                        trace.mark('tier-2-fetch-scraper:error', {
                            stageDurationMs: stageDurationMs(stageStartedAt),
                            errorName: fetchScraperErr?.name || 'Error',
                            errorMessage: fetchScraperErr?.message || String(fetchScraperErr)
                        });
                        console.warn('KinopoiskService: Tier 2 regex fetch scraper failed:', fetchScraperErr);
                    }
                }
            }

            // If scraping produced candidates, resolve full entities in exact order.
            if (scrapedItems && scrapedItems.length > 0) {
                const stageStartedAt = kinopoiskTraceNow();
                trace.mark('batch-entity-resolution:start', {
                    scrapedItemCount: scrapedItems.length,
                    scrapeSource
                });
                const batchPromise = this.getMoviesByIdsBatch(scrapedItems, {
                    signal: filters?.signal,
                    traceId: trace.traceId,
                    traceStartedAt: trace.startedAt
                });
                const tracedBatchPromise = batchPromise.then(candidateMovies => {
                    trace.mark('batch-entity-resolution:end', {
                        stageDurationMs: stageDurationMs(stageStartedAt),
                        candidateMovieCount: candidateMovies?.length || 0
                    });
                    return candidateMovies || [];
                }).catch(batchErr => {
                    trace.mark('batch-entity-resolution:error', {
                        stageDurationMs: stageDurationMs(stageStartedAt),
                        errorName: batchErr?.name || 'Error',
                        errorMessage: batchErr?.message || String(batchErr)
                    });
                    console.warn('KinopoiskService: Batch entity resolution failed:', batchErr);
                    return [];
                });

                if (filters?.deferEntityResolution === true) {
                    const scrapedCandidates = this.createScrapedSearchCandidates(scrapedItems);
                    trace.mark('search:complete', {
                        outcome: 'scrape-fast-path',
                        totalMs: stageDurationMs(searchStartedAt),
                        scrapeSource,
                        scrapedItemCount: scrapedCandidates.length,
                        entityResolution: 'deferred'
                    });
                    return {
                        docs: scrapedCandidates,
                        total: scrapedCandidates.length,
                        totalScraped: scrapedCandidates.length,
                        page: 1,
                        limit,
                        pages: Math.ceil(scrapedCandidates.length / limit) || 1,
                        searchSource: scrapeSource,
                        entityResolutionDeferred: true,
                        entityResolutionPromise: tracedBatchPromise
                    };
                }

                try {
                    const candidateMovies = await tracedBatchPromise;
                    if (candidateMovies.length > 0) {
                        console.log(`KinopoiskService: Hybrid search succeeded with ${candidateMovies.length} movies via ${scrapeSource}`);
                        finishSearchTrace('hybrid-success', {
                            scrapeSource,
                            candidateMovieCount: candidateMovies.length
                        });
                        return {
                            docs: candidateMovies,
                            total: candidateMovies.length,
                            totalScraped: candidateMovies.length,
                            page: 1,
                            limit,
                            pages: Math.ceil(candidateMovies.length / limit) || 1,
                            searchSource: scrapeSource
                        };
                    }
                } catch (batchErr) {
                    trace.mark('batch-entity-resolution:error', {
                        stageDurationMs: stageDurationMs(stageStartedAt),
                        errorName: batchErr?.name || 'Error',
                        errorMessage: batchErr?.message || String(batchErr)
                    });
                    console.warn('KinopoiskService: Batch entity resolution failed:', batchErr);
                }
            }
        }

        // Tier 3: Baseline API Search fallback (/v1.4/movie/search)
        const apiStageStartedAt = kinopoiskTraceNow();
        trace.mark('tier-3-api:start', { page, limit });
        try {
            const searchEndpointUrl = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.SEARCH}`;

            const candidateLimit = filters?.candidateLimit
                ? Math.max(limit, Number(filters.candidateLimit) || limit)
                : limit;

            const searchParams = new URLSearchParams({
                query: cleanQuery,
                page: page.toString(),
                limit: candidateLimit.toString()
            });

            if (filters && filters.yearFrom) {
                const yearRange = `${filters.yearFrom}-${filters.yearTo || new Date().getFullYear()}`;
                searchParams.append('year', yearRange);
            }

            const fullUrl = `${searchEndpointUrl}?${searchParams}`;
            console.log(`KinopoiskService: Request URL (API search fallback): ${fullUrl}`);

            const response = await this._fetchWithRotation(fullUrl, {
                method: 'GET',
                signal: filters?.signal
            });
            trace.mark('tier-3-api:response', {
                stageDurationMs: stageDurationMs(apiStageStartedAt),
                status: response.status,
                ok: response.ok
            });

            if (!response.ok) {
                if (response.status === 403 || response.status === 402) {
                    const errorData = await response.json();
                    if (errorData.message && errorData.message.includes('суточный лимит')) {
                        if (typeof Utils !== 'undefined' && Utils.showToast) {
                            Utils.showToast('Вы израсходовали ваш суточный лимит запросов. Обновите тариф или попробуйте завтра.', 'error', 5000);
                        }
                        throw new Error('DAILY_LIMIT_REACHED');
                    }
                }
                if (response.status === 500 && this.hasCyrillic(query)) {
                    const alternativeStartedAt = kinopoiskTraceNow();
                    const altResult = await this.searchMoviesAlternative(query, page, limit);
                    trace.mark('tier-3-api:alternative-complete', {
                        stageDurationMs: stageDurationMs(alternativeStartedAt),
                        docCount: altResult?.docs?.length || 0
                    });
                    finishSearchTrace('api-alternative-success', {
                        docCount: altResult?.docs?.length || 0
                    });
                    return {
                        ...altResult,
                        searchSource: 'api-fallback'
                    };
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            trace.mark('tier-3-api:body-read', {
                stageDurationMs: stageDurationMs(apiStageStartedAt),
                apiDocCount: data?.docs?.length || 0
            });
            const normalized = this.normalizeSearchResults(data, query);
            trace.mark('tier-3-api:normalized', {
                stageDurationMs: stageDurationMs(apiStageStartedAt),
                docCount: normalized?.docs?.length || 0
            });
            finishSearchTrace('api-success', {
                docCount: normalized?.docs?.length || 0
            });
            return {
                ...normalized,
                searchSource: 'api-fallback'
            };
        } catch (error) {
            console.error('Error searching movies:', error);
            trace.mark('tier-3-api:error', {
                stageDurationMs: stageDurationMs(apiStageStartedAt),
                errorName: error?.name || 'Error',
                errorMessage: error?.message || String(error)
            });
            if (isQuotaExhaustedError(error) || error.message === 'DAILY_LIMIT_REACHED') {
                finishSearchTrace('quota-fallback', { docCount: 0 });
                if (filters?.throwOnLimit) throw error;
                return { docs: [], total: 0, page: 1, limit: limit, pages: 0, searchSource: 'api-fallback' };
            }
            finishSearchTrace(error?.name === 'AbortError' ? 'aborted' : 'failed');
            throw new Error(`Failed to search movies: ${error.message}`, { cause: error });
        }
    }

    /**
     * Get movies by filters (e.g. for similar movies fallback)
     * @param {Object} filters - Search filters
     * @param {number} page - Page number
     * @param {number} limit - Results limit
     * @returns {Promise<Object>} - Search results
     */
    async getMoviesByFilters(filters = {}, page = 1, limit = 10) {
        try {
            const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.MOVIE}`;
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString(),
                'votes.kp': '1000-10000000', // Ensure popular movies
                'poster.url': '!null', // Ensure poster exists
                'name': '!null' // Ensure title exists
            });

            if (filters.genres) {
                if (Array.isArray(filters.genres)) {
                    filters.genres.forEach(g => params.append('genres.name', g));
                } else {
                    params.append('genres.name', filters.genres);
                }
            }

            if (filters.year) {
                params.append('year', filters.year);
            }
            
            if (filters.excludeId) {
                // Not all endpoints support id exclusion, but we can filter client-side too
                // params.append('id', `!${filters.excludeId}`); 
            }

            // Exclude cartoons if original movie is not a cartoon
            if (filters.excludeGenres && Array.isArray(filters.excludeGenres)) {
                 filters.excludeGenres.forEach(g => params.append('genres.name', `!${g}`));
            }

            const fullUrl = `${url}?${params}`;
            console.log(`KinopoiskService: Filter Request URL: ${fullUrl}`);

            const response = await this._fetchWithRotation(fullUrl, {
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return {
                docs: data.docs ? data.docs.map(movie => this.normalizeMovieData(movie)) : [],
                total: data.total || 0,
                page: data.page || page,
                pages: data.pages || 0
            };
        } catch (error) {
            console.error('Error getting movies by filters:', error);
            return { docs: [] };
        }
    }

    /**
     * Helper to resolve a list of TMDB candidate items to Kinopoisk normalized movie objects.
     * Matches by name/altName and release year, and attaches TMDB posters/ratings if missing on KP.
     * @param {Array<Object>} tmdbItems - Array of TMDB items
     * @param {number} limit - Target number of resolved items
     * @param {AbortSignal} [signal=null] - Optional abort signal
     * @returns {Promise<Array<Object>>} - Array of normalized movie objects with kinopoiskId
     */
    /**
    /**
     * Get featured movies for discovery hero carousel directly from Kinopoisk catalog.
     * @param {number} limit - Maximum number of movies (default: 10)
     * @param {Object} options - Optional parameters { signal, yearRange }
     * @returns {Promise<Array<Object>>} - Array of normalized movie objects with kinopoiskId
     */
    async getFeaturedMovies(limit = 10, options = {}) {
        try {
            const currentYear = new Date().getFullYear();
            const yearRange = options.yearRange || `${currentYear - 2}-${currentYear}`;
            const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.MOVIE}`;

            const params = new URLSearchParams({
                page: '1',
                limit: Math.max(limit + 5, 10).toString(),
                'rating.kp': '7.2-10',
                'votes.kp': '20000-10000000',
                'poster.url': '!null',
                'name': '!null',
                'year': yearRange,
                'sortField': 'votes.kp',
                'sortType': '-1'
            });

            const fullUrl = `${url}?${params}`;
            console.log(`KinopoiskService: Featured discovery URL: ${fullUrl}`);

            const response = await this._fetchWithRotation(fullUrl, { method: 'GET', signal: options.signal });

            if (response.ok) {
                const data = await response.json();
                const docs = Array.isArray(data.docs) ? data.docs : [];
                return docs
                    .map(doc => this.normalizeMovieData(doc))
                    .filter(item => item && item.kinopoiskId)
                    .slice(0, limit);
            }
            return [];
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            console.error('KinopoiskService: Error getting featured movies:', error);
            return [];
        }
    }

    /**
     * Get popular movies by category / type with high ratings directly from Kinopoisk catalog.
     * Handles type: 'movie' | 'tv-series' | 'cartoon' | 'anime' | 'tv-show'.
     * @param {Object} params - { type, limit, page, genres, yearRange, allTime, signal }
     * @returns {Promise<Array<Object>>} - Array of normalized movie objects
     */
    async getPopularMovies({ type = 'movie', limit = 12, page = 1, genres = null, yearRange = null, allTime = false, signal = null } = {}) {
        try {
            // Specialized handling for tv-show with anime fallback
            if (type === 'tv-show') {
                return await this._getPopularTvShowsWithFallback({ limit, page, yearRange, allTime, signal });
            }

            const currentYear = new Date().getFullYear();
            const effectiveYear = allTime ? null : (yearRange || `${currentYear - 2}-${currentYear}`);

            const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.MOVIE}`;
            const params = new URLSearchParams({
                page: page.toString(),
                limit: Math.max(limit + 4, 10).toString(),
                'votes.kp': '1000-10000000',
                'rating.kp': '6.8-10',
                'poster.url': '!null',
                'name': '!null',
                'sortField': 'votes.kp',
                'sortType': '-1'
            });

            if (effectiveYear) params.append('year', effectiveYear);
            if (type) params.append('type', type);
            if (genres) {
                if (Array.isArray(genres)) genres.forEach(g => params.append('genres.name', g));
                else params.append('genres.name', genres);
            }

            const fullUrl = `${url}?${params}`;
            console.log(`KinopoiskService: Popular movies (${type}) URL: ${fullUrl}`);

            const response = await this._fetchWithRotation(fullUrl, { method: 'GET', signal });

            if (response.ok) {
                const data = await response.json();
                const docs = Array.isArray(data.docs) ? data.docs : [];
                return docs
                    .map(doc => this.normalizeMovieData(doc))
                    .filter(item => item && item.kinopoiskId)
                    .slice(0, limit);
            }

            return [];
        } catch (error) {
            console.error(`KinopoiskService: Error getting popular movies for ${type}:`, error);
            return [];
        }
    }

    /**
     * Helper for TV shows with combined filters and anime fallback if < 6 items.
     * @param {Object} params - { limit, page, yearRange, allTime, signal }
     * @returns {Promise<Array<Object>>}
     */
    async _getPopularTvShowsWithFallback({ limit = 12, page = 1, yearRange = null, allTime = false, signal = null } = {}) {
        const currentYear = new Date().getFullYear();
        const effectiveYear = allTime ? null : (yearRange || `${currentYear - 2}-${currentYear}`);

        try {
            const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.MOVIE}`;
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString(),
                'votes.kp': '300-10000000',
                'poster.url': '!null',
                'name': '!null',
                'sortField': 'votes.kp',
                'sortType': '-1'
            });

            if (effectiveYear) {
                params.append('year', effectiveYear);
            }

            // Combined types
            params.append('type', 'tv-series');
            params.append('type', 'tv-show');

            // Show-related genres
            const showGenres = ['ток-шоу', 'реалити-шоу', 'игра', 'документальный'];
            showGenres.forEach(g => params.append('genres.name', g));

            const fullUrl = `${url}?${params}`;
            console.log(`KinopoiskService: TV shows request URL: ${fullUrl}`);

            const response = await this._fetchWithRotation(fullUrl, { method: 'GET', signal });
            if (response.ok) {
                const data = await response.json();
                const items = data.docs ? data.docs.map(movie => this.normalizeMovieData(movie)) : [];
                if (items.length >= 6) {
                    return items;
                }
                console.warn(`KinopoiskService: TV shows yielded only ${items.length} items (< 6), falling back to Anime`);
            }
        } catch (showError) {
            console.warn('KinopoiskService: Error fetching TV shows, falling back to Anime:', showError);
        }

        // Tier 1 anime fallback: Try TMDB fresh anime
        if (!allTime && this.tmdbService && typeof this.tmdbService.isConfigured === 'function' && this.tmdbService.isConfigured()) {
            try {
                const tmdbAnime = await this.tmdbService.getFreshAnime(page, signal);
                if (Array.isArray(tmdbAnime) && tmdbAnime.length > 0) {
                    const resolvedAnime = await this._resolveTmdbList(tmdbAnime, limit, signal);
                    if (resolvedAnime.length >= 4) {
                        return resolvedAnime;
                    }
                }
            } catch (tmdbAnimeErr) {
                console.warn('KinopoiskService: TMDB anime fallback failed:', tmdbAnimeErr.message);
            }
        }

        // Tier 2 anime fallback: Top anime from Kinopoisk
        try {
            const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.MOVIE}`;
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString(),
                'type': 'anime',
                'rating.kp': '7.2-10',
                'votes.kp': '500-10000000',
                'poster.url': '!null',
                'name': '!null',
                'sortField': 'votes.kp',
                'sortType': '-1'
            });

            if (effectiveYear) {
                params.append('year', effectiveYear);
            }

            const fullUrl = `${url}?${params}`;
            console.log(`KinopoiskService: Anime fallback request URL: ${fullUrl}`);

            const response = await this._fetchWithRotation(fullUrl, { method: 'GET', signal });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const data = await response.json();
            return data.docs ? data.docs.map(movie => this.normalizeMovieData(movie)) : [];
        } catch (animeError) {
            console.error('KinopoiskService: Error fetching anime fallback:', animeError);
            return [];
        }
    }

    /**
     * Get detailed movie information by ID
     * @param {number} movieId - Kinopoisk movie ID
     * @param {Object} fallbackContext - Existing cache and optional reliable title/year context
     * @returns {Promise<Object>} - Movie details
     */
    async getMovieById(movieId, fallbackContext = {}) {
        try {
            const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.MOVIE}/${movieId}`;
            
            const response = await this._fetchWithRotation(url, {
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('Full movie API response:', data); // Debug log
            
            let movieData = this.normalizeMovieData(data);
            console.log('[DIAG] Freshly normalized KP data (pre-check):', JSON.stringify({
                descriptionRaw: movieData?.description,
                descriptionLength: movieData?.description?.length,
                genresLength: movieData?.genres?.length,
                personsLength: movieData?.persons?.length,
                hasDetailedInfo: Utils.hasDetailedMovieInfo(movieData)
            }, null, 2));

            if (!Utils.hasDetailedMovieInfo(movieData)) {
                // Prefer any cached KP object as the stable merge base. It can
                // contain KP-specific metadata omitted by the current response.
                const mergeBase = fallbackContext.cachedMovie || movieData;
                movieData = await this.enrichIncompleteMovieWithTmdb(mergeBase);
            }

            return movieData;
        } catch (error) {
            console.error('Error getting movie details:', error);
            const tmdbFallback = await this.getTmdbFallbackAfterKinopoiskFailure(movieId, fallbackContext);
            if (tmdbFallback) return tmdbFallback;
            throw new Error(`Failed to get movie details: ${error.message}`, { cause: error });
        }
    }

    /**
     * Enrich an incomplete Kinopoisk response only when it already carries a
     * reliable IMDb ID. TMDB failures never discard the Kinopoisk response.
     * @param {Object} kpMovie - Normalized Kinopoisk movie
     * @returns {Promise<Object>}
     */
    async enrichIncompleteMovieWithTmdb(kpMovie) {
        const imdbId = await this.getReliableImdbId(kpMovie);
        const configured = this.tmdbService?.isConfigured();
        console.log('[DIAG] enrichIncompleteMovieWithTmdb entry:', JSON.stringify({
            called: true,
            imdbId: imdbId || null,
            externalIdRaw: kpMovie?.externalId,
            tmdbConfigured: configured
        }, null, 2));
        if (!imdbId || !configured) {
            if (!imdbId) await this.tmdbFallbackQueueService?.reportMissingImdb(kpMovie);
            console.warn('[DIAG] enrichIncompleteMovieWithTmdb: early return', {
                reason: !imdbId ? 'no imdbId' : 'tmdb not configured'
            });
            return kpMovie;
        }

        try {
            console.info('[TMDB fallback] merge-with-cache: incomplete Kinopoisk metadata; using findByImdbId.', {
                kinopoiskId: kpMovie.kinopoiskId,
                imdbId
            });
            const tmdbData = await this.tmdbService.findByImdbId(imdbId);
            if (!tmdbData) {
                console.info('[TMDB fallback] merge-with-cache: findByImdbId returned no movie.', { imdbId });
                return kpMovie;
            }

            const mergedMovie = TMDBService.mergeWithTmdbData(kpMovie, tmdbData);
            console.info('[TMDB fallback] merge-with-cache: Kinopoisk movie merged with TMDB fields.', {
                kinopoiskId: kpMovie.kinopoiskId,
                fields: mergedMovie.additionalDataFields || []
            });
            return mergedMovie;
        } catch (tmdbError) {
            console.warn('[TMDB fallback] merge-with-cache: could not enrich incomplete Kinopoisk metadata:', tmdbError);
            return kpMovie;
        }
    }

    async getReliableImdbId(movie) {
        const kpImdbId = movie?.externalId?.imdb?.trim();
        if (typeof TmdbFallbackQueueService !== 'undefined' &&
            TmdbFallbackQueueService.isValidImdbId(kpImdbId)) return kpImdbId;
        return this.tmdbFallbackQueueService?.getManualImdbId(movie?.kinopoiskId) || null;
    }

    /**
     * Recover from a complete Kinopoisk failure without replacing the KP ID.
     * A cached KP object always remains the merge base; title search is reserved
     * solely for a genuinely cold cache with explicit title/year context.
     * @param {number} movieId - Kinopoisk movie ID
     * @param {Object} fallbackContext - { cachedMovie, title, year }
     * @returns {Promise<Object|null>}
     */
    async getTmdbFallbackAfterKinopoiskFailure(movieId, fallbackContext = {}) {
        if (!this.tmdbService?.isConfigured()) return null;

        const cachedMovie = fallbackContext.cachedMovie;
        try {
            const imdbId = await this.getReliableImdbId(cachedMovie);
            if (cachedMovie && imdbId) {
                console.info('[TMDB fallback] merge-with-cache: Kinopoisk failed; enriching cached KP movie via findByImdbId.', {
                    kinopoiskId: movieId,
                    imdbId
                });
                const tmdbData = await this.tmdbService.findByImdbId(imdbId);
                if (!tmdbData) {
                    console.info('[TMDB fallback] merge-with-cache: findByImdbId returned no movie.', { imdbId });
                    return cachedMovie;
                }

                const mergedMovie = TMDBService.mergeWithTmdbData(cachedMovie, tmdbData);
                console.info('[TMDB fallback] merge-with-cache: cached KP movie merged with TMDB fields.', {
                    kinopoiskId: movieId,
                    fields: mergedMovie.additionalDataFields || []
                });
                return mergedMovie;
            }

            if (cachedMovie) {
                await this.tmdbFallbackQueueService?.reportMissingImdb(cachedMovie);
                console.warn('[TMDB fallback] merge-with-cache: cached KP movie has no reliable IMDb ID; TMDB skipped.', {
                    kinopoiskId: movieId
                });
                return cachedMovie;
            }

            const title = fallbackContext.title?.trim();
            const year = fallbackContext.year;
            if (title && year) {
                // This is the sole permitted title-search path: a cold cache and a
                // complete Kinopoisk failure leave no reliable IMDb ID to use.
                console.info('[TMDB fallback] cold-search-only: cold cache and Kinopoisk failure; using searchByTitleYear.', {
                    kinopoiskId: movieId,
                    title,
                    year
                });
                const tmdbData = await this.tmdbService.searchByTitleYear(title, year);
                return tmdbData ? this.createTmdbOnlyMovie(movieId, tmdbData) : null;
            }

            console.warn('[TMDB fallback] cold-search-only: no title/year context; title search skipped.', {
                kinopoiskId: movieId
            });
            return null;
        } catch (tmdbError) {
            console.warn('[TMDB fallback] TMDB recovery failed:', tmdbError);
            return null;
        }
    }

    createTmdbOnlyMovie(movieId, tmdbData, imdbId = '') {
        return Object.assign({}, tmdbData, {
            kinopoiskId: Number(movieId) || movieId,
            externalId: Object.assign({}, tmdbData.externalId, imdbId ? { imdb: imdbId } : {}),
            additionalDataSource: 'tmdb'
        });
    }

    /**
     * Get movie images/frames by ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<Array>} - Movie images
     */
    async getMovieImages(movieId, options = {}) {
        try {
            // Try the images endpoint if it exists
            const url = `${this.baseUrl}/image?movieId=${movieId}&type=still`;
            
            const response = await this._fetchWithRotation(url, {
                method: 'GET',
                signal: options.signal
            });

            if (!response.ok) {
                if (options.throwOnLimit && [402, 403, 429].includes(response.status)) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                // Images are not critical, just return empty array on failure
                console.warn(`Failed to get images: ${response.status}`);
                return [];
            }

            const data = await response.json();
            return data.items || data.docs || [];
        } catch (error) {
            if (error?.name === 'AbortError' || error?.cause?.name === 'AbortError') throw error;
            if (options.throwOnLimit && (
                String(error?.code || '').startsWith('KINOPOISK_') ||
                /HTTP error! status: (402|403|429)/i.test(String(error?.message))
            )) throw error;
            console.error('Error getting movie images:', error);
            return [];
        }
    }

    /**
     * Get movie awards by ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<Array>} - Movie awards
     */
    async getMovieAwards(movieId) {
        try {
            // Correct endpoint for kinopoisk.dev is /movie/awards?movieId={id}
            const url = `${this.baseUrl}/movie/awards?movieId=${movieId}&limit=250`;
            console.log('Fetching awards from:', url);

            const response = await this._fetchWithRotation(url, {
                method: 'GET'
            });

            if (!response.ok) {
                console.warn(`Failed to get awards: ${response.status}`);
                return [];
            }

            const data = await response.json();
            return data.items || data.docs || [];
        } catch (error) {
            console.error('Error getting movie awards:', error);
            return [];
        }
    }



    /**
     * Normalize search results to consistent format
     * @param {Object} data - Raw API response
     * @param {string} query - Original search query
     * @returns {Object} - Normalized search results
     */
    normalizeSearchResults(data, query = '') {
        let movies = data.docs ? data.docs.map(movie => this.normalizeMovieData(movie)) : [];
        
        // Sort by relevance: exact name match first, then by popularity
        if (query) {
            movies = this.sortMoviesByRelevance(movies, query);
        }
        
        return {
            docs: movies,
            total: data.total || 0,
            page: data.page || 1,
            limit: data.limit || this.defaultLimit,
            pages: data.pages || 1
        };
    }

    /**
     * Sort movies by relevance: exact name match first, then by popularity
     * @param {Array} movies - Array of movies
     * @param {string} query - Search query
     * @returns {Array} - Sorted movies
     */
    sortMoviesByRelevance(movies, query) {
        const queryLower = query.toLowerCase().trim().replace(/ё/g, 'е');

        // Stem the query if the Snowball stemmer is available (handles Russian inflection)
        const stemmer = (typeof RussianStemmer !== 'undefined') ? RussianStemmer : null;
        const queryStem = stemmer ? stemmer.stemPhrase(queryLower) : queryLower;

        // Score a single movie against the query combining text relevance and popularity (vote count)
        const score = (movie) => {
            const name = (movie.name || '').toLowerCase().replace(/ё/g, 'е');
            const altName = (movie.alternativeName || '').toLowerCase();

            // Calculate vote count from kp or imdb
            const kpVotes = typeof movie.votes === 'object' ? (movie.votes?.kp || 0) : (movie.votes || 0);
            const imdbVotes = typeof movie.votes === 'object' ? (movie.votes?.imdb || 0) : 0;
            const maxVotes = Math.max(Number(kpVotes) || 0, Number(imdbVotes) || 0);

            // Popularity bonus on a logarithmic scale (e.g. 900,000 votes adds ~89 pts; 1,000 votes adds ~45 pts)
            const popularityBonus = maxVotes > 0 ? Math.log10(maxVotes + 1) * 15 : 0;

            let textScore = 0;

            // Tier 1: exact match on primary or alternative name
            if (name === queryLower || altName === queryLower) {
                textScore = 100;
            }
            // Tier 2: primary or alternative name starts with query followed by subtitle delimiter (:, -, space)
            // e.g. query "мстители" -> "Мстители: Война бесконечности", "Мстители: Финал"
            else if (new RegExp(`^${queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s:\\-–—]`).test(name) ||
                     new RegExp(`^${queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s:\\-–—]`).test(altName)) {
                textScore = 95;
            }
            // Tier 3: primary name starts with query
            else if (name.startsWith(queryLower)) {
                textScore = 85;
            }
            // Tier 4: alternative name starts with query
            else if (altName.startsWith(queryLower)) {
                textScore = 75;
            }
            // Tier 5: primary or alternative name contains query as a whole word
            else {
                const safeQuery = queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const wordBoundary = new RegExp(`(^|\\s)${safeQuery}(\\s|$)`);
                if (wordBoundary.test(name)) textScore = 65;
                else if (wordBoundary.test(altName)) textScore = 55;
                else if (name.includes(queryLower)) textScore = 40;
                else if (altName.includes(queryLower)) textScore = 30;
            }

            // Stemmer fallback scoring if no text match yet
            if (textScore === 0 && stemmer && queryStem && queryStem !== queryLower) {
                const nameStem = stemmer.stemPhrase(name);
                const altNameStem = stemmer.stemPhrase(altName);
                const safeStem = queryStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                if (nameStem === queryStem) textScore = 90;
                else {
                    const stemWordRe = new RegExp(`(^| )${safeStem}( |$)`);
                    if (stemWordRe.test(nameStem)) textScore = 35;
                    else if (nameStem.includes(queryStem)) textScore = 20;
                    else if (altNameStem === queryStem) textScore = 80;
                    else if (stemWordRe.test(altNameStem)) textScore = 30;
                    else if (altNameStem.includes(queryStem)) textScore = 15;
                }
            }

            // Title matches (textScore > 0) get textScore + full popularityBonus (range 50..180).
            // Non-title matches (textScore === 0) get only 5% of popularityBonus (range 0..4.5),
            // guaranteeing that EVERY title match ranks ahead of any non-title match!
            if (textScore === 0) {
                return popularityBonus * 0.05;
            }

            return textScore + popularityBonus;
        };

        return movies.sort((a, b) => score(b) - score(a));
    }

    /**
     * Normalize movie data to consistent format
     * @param {Object} movie - Raw movie data from API
     * @returns {Object} - Normalized movie data
     */
    normalizeMovieData(movie) {
        // Process poster URL to ensure it's valid
        let posterUrl = movie.poster?.url || movie.posterUrl || '';
        if (posterUrl && !posterUrl.startsWith('http')) {
            posterUrl = '';
        }
        
        return {
            kinopoiskId: movie.id || movie.kinopoiskId,
            name: movie.name || movie.title || 'Unknown Title',
            alternativeName: movie.alternativeName || movie.alternativeTitle || '',
            posterUrl: posterUrl,
            year: movie.year || 0,
            kpRating: movie.rating?.kp || movie.kpRating || 0,
            imdbRating: movie.rating?.imdb || movie.imdbRating || 0,
            description: movie.description || movie.shortDescription || '',
            slogan: movie.slogan || '',
            genres: movie.genres?.map(g => g.name) || movie.genre || [],
            countries: movie.countries?.map(c => c.name) || movie.country || [],
            duration: movie.movieLength || movie.duration || 0,
            isSeries: movie.isSeries === true,
            seriesLength: movie.seriesLength || 0,
            ageRating: movie.ageRating || 0,
            ratingMpaa: movie.ratingMpaa || '',
            type: movie.type || 'movie',
            // Additional rich provider metadata (Phase 1B)
            shortDescription: movie.shortDescription || '',
            backdropUrl: movie.backdrop?.url || movie.backdropUrl || '',
            logoUrl: movie.logo?.url || movie.logoUrl || (typeof movie.logo === 'string' ? movie.logo : ''),
            rating: {
                kp: movie.rating?.kp || movie.kpRating || 0,
                imdb: movie.rating?.imdb || movie.imdbRating || 0,
                tmdb: movie.rating?.tmdb || 0,
                filmCritics: movie.rating?.filmCritics || movie.ratingFilmCritics || null,
                russianFilmCritics: movie.rating?.russianFilmCritics || movie.ratingRussianFilmCritics || null,
                await: movie.rating?.await || null
            },
            votes: {
                kp: movie.votes?.kp || 0,
                imdb: movie.votes?.imdb || 0,
                tmdb: movie.votes?.tmdb || 0,
                filmCritics: movie.votes?.filmCritics || movie.votesFilmCritics || null,
                russianFilmCritics: movie.votes?.russianFilmCritics || movie.votesRussianFilmCritics || null,
                await: movie.votes?.await || null
            },
            facts: Array.isArray(movie.facts)
                ? movie.facts.filter(f => (typeof f === 'string' ? f.trim().length > 0 : (f && f.value && String(f.value).trim().length > 0)))
                : [],
            watchability: movie.watchability?.items || (Array.isArray(movie.watchability) ? movie.watchability : []),
            
            // Crew and cast (persons)
            persons: movie.persons || [],
            
            // Box office and budget
            budget: movie.budget || null,
            fees: {
                world: movie.fees?.world || null,
                usa: movie.fees?.usa || null,
                russia: movie.fees?.russia || null
            },
            
            // Audience stats
            audience: movie.audience || [],
            
            // Premieres
            premiere: {
                world: movie.premiere?.world || null,
                russia: movie.premiere?.russia || null,
                digital: movie.premiere?.digital || null
            },
            
            // Release information
            distributors: movie.distributors || null,
            
            // Sequels and Prequels
            sequelsAndPrequels: movie.sequelsAndPrequels || [],
            
            // Similar Movies
            similarMovies: movie.similarMovies || [],
            
            // Additional fields for caching
            lastUpdated: new Date().toISOString(),
            
            // IDs
            externalId: movie.externalId || {},
            
            // Serialize seasons info if available
            seasonsInfo: movie.seasonsInfo || []
        };
    }
    
    /**
     * Get persons by profession from movie data
     * @param {Array} persons - Array of person objects from movie
     * @param {string} profession - Profession to filter by (e.g., 'DIRECTOR', 'ACTOR', 'WRITER')
     * @param {number} limit - Max number of persons to return
     * @returns {Array} - Filtered persons
     */
    getPersonsByProfession(persons, profession, limit = null) {
        if (!persons || !Array.isArray(persons)) return [];
        
        const targetProf = profession.toString().toLowerCase();
        
        const filtered = persons.filter(person => {
            const enProf = person.enProfession ? person.enProfession.toString().toLowerCase() : '';
            // If checking localized profession, strict match might be needed, but usually we search by EN key
            // The search.js passes 'DIRECTOR' etc.
            return enProf === targetProf;
        });
        
        return limit ? filtered.slice(0, limit) : filtered;
    }
    
    /**
     * Format persons list as comma-separated names
     * @param {Array} persons - Array of person objects
     * @returns {string} - Formatted names
     */
    formatPersonNames(persons) {
        if (!persons || persons.length === 0) return '';
        
        return persons
            .map(person => person.name || person.enName || 'Unknown')
            .filter(name => name !== 'Unknown')
            .join(', ');
    }
    
    /**
     * Format currency value with proper separators
     * @param {Object|number} value - Budget/fees object or number
     * @returns {string} - Formatted currency string
     */
    formatCurrency(value) {
        if (!value) return '';
        
        const amount = typeof value === 'object' ? value.value : value;
        const currency = typeof value === 'object' ? value.currency : 'USD';
        
        if (!amount) return '';
        
        // Format with spaces as thousand separators
        const formatted = amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        
        // Add currency symbol
        const symbols = {
            'USD': '$',
            'RUB': '₽',
            'EUR': '€'
        };
        
        const symbol = symbols[currency] || currency;
        
        return `${symbol}${formatted}`;
    }
    
    /**
     * Format date to readable format
     * @param {string} dateStr - ISO date string
     * @returns {string} - Formatted date
     */
    formatDate(dateStr) {
        if (!dateStr) return '';
        
        try {
            const date = new Date(dateStr);
            const day = date.getDate();
            const months = [
                'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
            ];
            const month = months[date.getMonth()];
            const year = date.getFullYear();
            
            return `${day} ${month} ${year}`;
        } catch {
            return dateStr;
        }
    }

    /**
     * Check if the authenticated API proxy is configured.
     * @returns {boolean} - True when a proxy endpoint is available
     */
    isConfigured() {
        return Boolean(KINOPOISK_CONFIG.PROXY_URL || DEFAULT_KINOPOISK_PROXY_URL);
    }

    /**
     * Get API usage statistics (if available)
     * @returns {Object} - API usage info
     */
    getApiInfo() {
        return {
            baseUrl: this.baseUrl,
            configured: this.isConfigured(),
            endpoints: KINOPOISK_CONFIG.ENDPOINTS
        };
    }

    /**
     * Normalize search query for better API compatibility
     * @param {string} query - Original query
     * @returns {string} - Normalized query
     */
    normalizeQuery(query) {
        if (!query) return '';
        
        // Trim whitespace
        let normalized = query.trim();
        
        // Replace multiple spaces with single space
        normalized = normalized.replace(/\s+/g, ' ');
        
        // For Cyrillic queries, try some common normalizations
        if (this.hasCyrillic(normalized)) {
            // Convert to lowercase for consistency
            normalized = normalized.toLowerCase();
            
            // Only replace ё→е (safe). Do NOT replace й→и — that breaks words
            // like 'Бойцовский' → 'Боицовскии' which destroys search accuracy.
            normalized = normalized.replace(/ё/g, 'е');
        }
        
        return normalized;
    }

    /**
     * Check if string contains Cyrillic characters
     * @param {string} str - String to check
     * @returns {boolean} - True if contains Cyrillic
     */
    hasCyrillic(str) {
        return /[а-яё]/i.test(str);
    }

    /**
     * Alternative search method for problematic queries
     * @param {string} query - Original query
     * @param {number} page - Page number
     * @param {number} limit - Results limit
     * @returns {Promise<Object>} - Search results
     */
    async searchMoviesAlternative(query, page = 1, limit = this.defaultLimit) {
        const alternatives = [
            // Try without sortField and sortType
            {
                query: this.normalizeQuery(query),
                page: page.toString(),
                limit: limit.toString()
            },
            // Try with different sort parameters
            {
                query: this.normalizeQuery(query),
                page: page.toString(),
                limit: limit.toString(),
                sortField: 'year',
                sortType: '-1'
            }
        ];

        // Add Cyrillic-specific alternatives
        if (this.hasCyrillic(query)) {
            const cyrillicAlternatives = this.getCyrillicAlternatives(query);
            cyrillicAlternatives.forEach(altQuery => {
                alternatives.push({
                    query: altQuery,
                    page: page.toString(),
                    limit: limit.toString()
                });
            });
        }

        for (let i = 0; i < alternatives.length; i++) {
            try {
                console.log(`KinopoiskService: Trying alternative ${i + 1}:`, alternatives[i]);
                
                // Add delay between requests to avoid throttling
                if (i > 0) {
                    console.log(`KinopoiskService: Waiting 1 second to avoid throttling...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
                const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.SEARCH}`;
                const params = new URLSearchParams(alternatives[i]);
                
                const response = await this._fetchWithRotation(`${url}?${params}`, {
                    method: 'GET'
                });

                if (response.ok) {
                    const data = await response.json();
                    console.log(`KinopoiskService: Alternative ${i + 1} succeeded`);
                    return this.normalizeSearchResults(data, query);
                }
                
                console.log(`KinopoiskService: Alternative ${i + 1} failed with status:`, response.status);
                
                // If we get 429 (Too Many Requests), wait longer
                if (response.status === 429) {
                    console.log('KinopoiskService: Rate limited, waiting 3 seconds...');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
                
            } catch (error) {
                console.log(`KinopoiskService: Alternative ${i + 1} error:`, error.message);
                
                // If throttled, wait before next attempt
                if (error.message.includes('throttled') || error.message.includes('Failed to fetch')) {
                    console.log('KinopoiskService: Request throttled, waiting 2 seconds...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        // If all alternatives fail, return empty results
        console.log('KinopoiskService: All alternatives failed, returning empty results');
        return {
            docs: [],
            total: 0,
            limit: limit,
            page: page,
            pages: 0
        };
    }

    /**
     * Simple transliteration for Cyrillic to Latin
     * @param {string} str - Cyrillic string
     * @returns {string} - Transliterated string
     */
    transliterate(str) {
        const translitMap = {
            'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
            'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
            'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
            'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
            'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
            ' ': ' '
        };

        return str.toLowerCase().split('').map(char => 
            translitMap[char] || char
        ).join('');
    }

    /**
     * Get alternative search queries for Cyrillic text
     * @param {string} query - Original Cyrillic query
     * @returns {Array<string>} - Array of alternative queries
     */
    getCyrillicAlternatives(query) {
        const alternatives = [];
        const lowerQuery = query.toLowerCase().trim();

        // Common movie title translations
        const movieTranslations = {
            'человек паук': ['spider man', 'spiderman'],
            'железный человек': ['iron man'],
            'темный рыцарь': ['dark knight'],
            'матрица': ['matrix'],
            'терминатор': ['terminator'],
            'бэтмен': ['batman'],
            'супермен': ['superman'],
            'мстители': ['avengers'],
            'звездные войны': ['star wars'],
            'звёздные войны': ['star wars'],
            'властелин колец': ['lord of the rings'],
            'гарри поттер': ['harry potter'],
            'джеймс бонд': ['james bond'],
            'форсаж': ['fast and furious', 'fast furious'],
            'пираты карибского моря': ['pirates of the caribbean'],
            'трансформеры': ['transformers'],
            'люди икс': ['x-men', 'xmen'],
            'фантастические твари': ['fantastic beasts'],
            'миссия невыполнима': ['mission impossible'],
            'крепкий орешек': ['die hard'],
            'назад в будущее': ['back to the future'],
            'индиана джонс': ['indiana jones'],
            'джуманджи': ['jumanji'],
            'кинг конг': ['king kong'],
            'годзилла': ['godzilla']
        };

        // Check for direct translations
        if (movieTranslations[lowerQuery]) {
            alternatives.push(...movieTranslations[lowerQuery]);
        }

        // Try transliteration
        const transliterated = this.transliterate(query);
        if (transliterated !== query) {
            alternatives.push(transliterated);
        }

        // Try partial matches for compound queries
        const words = lowerQuery.split(' ');
        if (words.length > 1) {
            for (const word of words) {
                if (movieTranslations[word]) {
                    // Try combining translated word with transliterated others
                    const translatedWords = words.map(w => 
                        movieTranslations[w] ? movieTranslations[w][0] : this.transliterate(w)
                    );
                    alternatives.push(translatedWords.join(' '));
                }
            }
        }

        // Remove duplicates and return
        return [...new Set(alternatives)];
    }
    /**
     * Get a random movie based on filters
     * @param {Object} filters - Filters: { countries, genres, yearFrom, yearTo, ratingFrom, ratingTo }
     * @returns {Promise<Object>} - Random movie data
     */
    async getRandomMovie(filters = {}) {
        try {
            console.log('KinopoiskService: Getting random movie with filters:', filters);
            
            const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.RANDOM}`;
            const params = new URLSearchParams();

            // API v1.4 random endpoint parameters
            // Standard filters
            if (filters.yearFrom || filters.yearTo) {
                const start = filters.yearFrom || 1900;
                const end = filters.yearTo || new Date().getFullYear();
                params.append('year', `${start}-${end}`);
            }

            if (filters.ratingFrom || filters.ratingTo) {
                const start = filters.ratingFrom || 1;
                const end = filters.ratingTo || 10;
                params.append('rating.kp', `${start}-${end}`);
            }

            if (filters.votesFrom || filters.votesTo) {
                const start = filters.votesFrom || 0;
                const end = filters.votesTo || 10000000;
                params.append('votes.kp', `${start}-${end}`);
            }

            // Handle multiple values for countries and genres
            // include: ['USA', 'France'] -> countries.name=USA&countries.name=France
            // exclude: ['Horror'] -> genres.name=!Horror (if supported) or handled client side
            // Note: The official docs saying "list of strings". We'll try appending multiple times.
            
            if (filters.countries && filters.countries.length > 0) {
                filters.countries.forEach(country => {
                    params.append('countries.name', country);
                });
            }

            if (filters.genres && filters.genres.length > 0) {
                filters.genres.forEach(genre => {
                    params.append('genres.name', genre);
                });
            }

            // Exclude filters - API v1.4 often supports !value
            // We'll try passing negated values
            if (filters.excludeCountries && filters.excludeCountries.length > 0) {
                filters.excludeCountries.forEach(country => {
                    params.append('countries.name', `!${country}`);
                });
            }

            if (filters.excludeGenres && filters.excludeGenres.length > 0) {
                filters.excludeGenres.forEach(genre => {
                    params.append('genres.name', `!${genre}`);
                });
            }

            if (filters.types && filters.types.length > 0) {
                filters.types.forEach(type => {
                    params.append('type', type);
                });
            }

            if (filters.excludeTypes && filters.excludeTypes.length > 0) {
                filters.excludeTypes.forEach(type => {
                    params.append('type', `!${type}`);
                });
            }

            // Ensure we get non-null name and poster
            params.append('notNullFields', 'name');
            params.append('notNullFields', 'poster.url');

            const fullUrl = `${url}?${params}`;
            console.log(`KinopoiskService: Random Request URL: ${fullUrl}`);

            const response = await this._fetchWithRotation(fullUrl, {
                method: 'GET'
            });

            if (!response.ok) {
                if (response.status === 403 || response.status === 402) {
                     throw new Error('DAILY_LIMIT_REACHED');
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            // Random endpoint returns a single object, not docs array
            // But sometimes it might return docs if used differently. 
            // In v1.4/movie/random it returns a single movie object.
            
            console.log('KinopoiskService: Random movie response:', data);
            
            if (!data || (!data.id && !data.kinopoiskId)) {
                return null;
            }

            return this.normalizeMovieData(data);

        } catch (error) {
            console.error('Error getting random movie:', error);
             if (error.message === 'DAILY_LIMIT_REACHED') {
                 if (typeof Utils !== 'undefined' && Utils.showToast) {
                    Utils.showToast('Вы израсходовали ваш суточный лимит запросов.', 'error');
                }
            }
            throw error;
        }
    }

    /**
     * Get person details from Kinopoisk API (/v1.4/person/{id}).
     * @param {number|string} personId - Kinopoisk person ID
     * @param {Object} [options={}] - Options { signal }
     * @returns {Promise<Object>} Raw Kinopoisk person response
     */
    async getPersonDetails(personId, options = {}) {
        const numId = Number(personId);
        if (!numId || isNaN(numId) || numId <= 0) {
            throw new Error(`Invalid Kinopoisk person ID: ${personId}`);
        }

        const signal = options.signal || null;
        const url = `${this.baseUrl}/person/${encodeURIComponent(numId)}`;

        const response = await this._fetchWithRotation(url, { method: 'GET', signal });

        if (!response.ok) {
            const err = new Error(`Kinopoisk person request failed: HTTP ${response.status}`);
            err.status = response.status;
            throw err;
        }

        return await response.json();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KinopoiskService;
    module.exports.QuotaExhaustedError = QuotaExhaustedError;
    module.exports.KinopoiskNetworkError = KinopoiskNetworkError;
    module.exports.KinopoiskAuthError = KinopoiskAuthError;
    module.exports.KinopoiskAccessError = KinopoiskAccessError;
    module.exports.KinopoiskRateLimitError = KinopoiskRateLimitError;
    module.exports.KinopoiskServerError = KinopoiskServerError;
}
if (typeof window !== 'undefined') {
    window.KinopoiskService = KinopoiskService;
}
if (typeof globalThis !== 'undefined') {
    globalThis.QuotaExhaustedError = QuotaExhaustedError;
    globalThis.isQuotaExhaustedError = isQuotaExhaustedError;
    globalThis.KinopoiskNetworkError = KinopoiskNetworkError;
    globalThis.KinopoiskAuthError = KinopoiskAuthError;
    globalThis.KinopoiskAccessError = KinopoiskAccessError;
    globalThis.KinopoiskRateLimitError = KinopoiskRateLimitError;
    globalThis.KinopoiskServerError = KinopoiskServerError;
}
