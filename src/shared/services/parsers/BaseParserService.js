/**
 * BaseParserService - Abstract base class for all video source parsers.
 * All parsers MUST extend this class and implement search() and getVideoSources().
 * 
 * @abstract
 */
class BaseParserService {
    /**
     * @param {Object} config
     * @param {string} config.id - Unique parser identifier (e.g. 'exfs', 'seasonvar')
     * @param {string} config.name - Human-readable name (e.g. 'Ex-FS', 'Seasonvar')
     * @param {string} config.baseUrl - Base URL of the source website
     * @param {number} [config.cacheTTL=3600000] - Cache TTL in ms (default: 1 hour)
     * @param {number} [config.requestTimeoutMs=8000] - Per-request network deadline in ms
     */
    constructor({ id, name, baseUrl, cacheTTL = 3600000, requestTimeoutMs = 8000 }) {
        if (new.target === BaseParserService) {
            throw new TypeError('BaseParserService is abstract and cannot be instantiated directly');
        }
        if (!id || !name) {
            throw new Error('Parser must have id and name');
        }

        /** @type {string} */
        this.id = id;
        /** @type {string} */
        this.name = name;
        /** @type {string} */
        this.baseUrl = baseUrl;
        /** @type {number} */
        this.cacheTTL = cacheTTL;
        /** @type {number} */
        this.requestTimeoutMs = requestTimeoutMs;
        /** @private @type {Map<string, {data: any, timestamp: number}>} */
        this._searchCache = new Map();
        /** @private @type {Map<string, Promise<any>>} */
        this._searchInFlight = new Map();
        /** @private @type {Map<string, {data: Array<VideoSource>, timestamp: number}>} */
        this._sourceCache = new Map();
        /** @private @type {Map<string, Promise<Array<VideoSource>>>} */
        this._sourceInFlight = new Map();
        /** @private @type {number} */
        this._cacheGeneration = 0;
    }

    // ─── Abstract Methods (MUST be implemented) ───────────────────────

    /**
     * Search for a movie/series by title and year.
     * @param {string} title - Movie or series title
     * @param {string|number|null} year - Release year
     * @returns {Promise<SearchResult|null>} Found result or null
     * @abstract
     */
    async search(title, year) {
        throw new Error(`${this.constructor.name}.search() is not implemented`);
    }

    /**
     * Get video sources/players from a search result.
     * @param {SearchResult} searchResult - Result from search()
     * @returns {Promise<Array<VideoSource>>} List of video sources
     * @abstract
     */
    async getVideoSources(searchResult) {
        throw new Error(`${this.constructor.name}.getVideoSources() is not implemented`);
    }

    // ─── Optional Methods (CAN be overridden) ─────────────────────────

    /**
     * Render a player for this parser's sources.
     * Default implementation prefers getPlayerType(), then falls back to any valid source type.
     * Override for custom player UIs (e.g. Seasonvar's episode selector).
     * 
     * @param {HTMLElement} container - DOM container element
     * @param {Array<VideoSource>} sources - Video sources
     * @param {Object} [options] - Additional options
     * @returns {boolean} Whether a compatible source was rendered
     */
    renderPlayer(container, sources, options = {}) {
        if (!sources || sources.length === 0) {
            container.innerHTML = '<div class="video-placeholder"><span>Источники не найдены</span></div>';
            return false;
        }

        const preferredPlayerType = this.getPlayerType();
        const compatibleSources = sources.filter(candidate => this.supportsSourceType(candidate));
        const source = compatibleSources.find(candidate =>
            this.getSourcePlayerType(candidate) === preferredPlayerType
        ) || compatibleSources[0];
        if (!source) {
            console.warn(`[BaseParserService] ${this.id} has no supported iframe/video sources`);
            container.innerHTML = '<div class="video-placeholder"><span>Совместимые источники не найдены</span></div>';
            return false;
        }

        const playerType = this.getSourcePlayerType(source);

        if (container._hlsInstance) {
            try { container._hlsInstance.destroy?.(); } catch { /* ignore */ }
            container._hlsInstance = null;
        }

        if (playerType === 'video') {
            const isHls = source.type === 'hls' || source.url?.includes('.m3u8');
            const mediaSrc = toPlayerMediaSrcAttribute(source.url);
            if (!mediaSrc) {
                console.warn(`[${this.name}] Rejected media URL with an unsupported scheme`);
                container.innerHTML = '<div class="video-placeholder"><span>Источник вернул некорректный адрес видео</span></div>';
                return false;
            }
            if (isHls) {
                container.innerHTML = `<video class="player-surface__media" controls playsinline></video>`;
            } else {
                container.innerHTML = `<video class="player-surface__media" controls playsinline src="${mediaSrc}"><source src="${mediaSrc}" type="video/mp4"></video>`;
            }
            const video = container.querySelector?.('video');

            if (isHls && video && typeof window !== 'undefined') {
                const mountHls = () => {
                    const factory = window.HlsPlaybackFactory;
                    const hls = factory
                        ? factory.create(video, source.url, {
                            isCurrent: () => !options.isRequestCurrent || options.isRequestCurrent(),
                            onFatal: ({ reason }) => this._handleStreamFailure({
                                container, video, failedSource: source, sources, options, reason
                            })
                        })
                        : this._createUnmanagedHls(video, source.url);
                    if (hls) {
                        container._hlsInstance = hls;
                        // The shared native-player menu owns all visible controls.
                        // Keep the HLS instance on its media element so that menu can
                        // expose its quality choices without creating a second control.
                        video._movieExtensionHls = hls;
                        video.dataset.playerProvider = this.id;
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = source.url;
                    }
                };

                if (typeof Hls !== 'undefined') {
                    mountHls();
                } else if (window.LazyLoader) {
                    window.LazyLoader.loadScript('../../shared/lib/hls.min.js').then(mountHls).catch(err => {
                        console.warn('[BaseParserService] Failed to load HLS library:', err);
                        if (video.canPlayType('application/vnd.apple.mpegurl')) {
                            video.src = source.url;
                        }
                    });
                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = source.url;
                }
            }
        } else {
            const iframeSourceUrl = toPlayerFrameSrcAttribute(withVenomAdFreeParam(source.url, this.baseUrl));
            if (!iframeSourceUrl) {
                console.warn(`[${this.name}] Rejected player URL with an unsupported scheme`);
                container.innerHTML = '<div class="video-placeholder"><span>Источник вернул некорректный адрес плеера</span></div>';
                return false;
            }
            const iframeReferrerPolicy = isVenomProviderUrl(source.url)
                ? ' referrerpolicy="no-referrer"'
                : '';
            container.innerHTML = `<iframe class="player-surface__media" src="${iframeSourceUrl}"${iframeReferrerPolicy} allowfullscreen allow="autoplay; fullscreen" title="${escapePlayerAttribute(this.name)} player"></iframe>`;
        }

        const lifecycle = typeof window !== 'undefined' ? window.PlayerSourceLifecycle : null;
        const playerElement = container.querySelector?.(playerType === 'video' ? 'video' : 'iframe');
        if (playerElement) {
            playerElement.dataset.playerSourceActive = 'true';
            if (options.requestId !== null && options.requestId !== undefined) {
                playerElement.dataset.playerRequestId = String(options.requestId);
            }
        }
        if (lifecycle && playerElement && options.lifecycle !== false) {
            container._playerSourceWatcher?.cancel?.();
            // A runtime fallback renders off-DOM and is then swapped in; its
            // overlay belongs to the element's real host.
            const lifecycleHost = options.lifecycleHost || container;
            const onState = (state, detail) => {
                if (options.isRequestCurrent && !options.isRequestCurrent()) return;
                lifecycle.setState(lifecycleHost, state, {
                    message: options.lifecycleMessage,
                    onRetry: options.onRetry || (() => this.renderPlayer(container, sources, options)),
                    onResearch: options.onResearch
                });
                options.onLifecycleState?.(state, { ...detail, source, parserId: this.id });
            };
            const watch = playerType === 'video' ? lifecycle.watchVideo : lifecycle.watchIframe;
            container._playerSourceWatcher = watch(playerElement, {
                timeoutMs: options.timeoutMs,
                isRequestCurrent: options.isRequestCurrent,
                onState
            });
        }

        return true;
    }

    /**
     * hls.js without shared recovery, used only when HlsPlaybackFactory is not
     * loaded on the page.
     * @private
     */
    _createUnmanagedHls(video, url) {
        if (typeof Hls === 'undefined' || !Hls.isSupported()) return null;
        const hls = new Hls({ enableWorker: true });
        hls.loadSource(url);
        hls.attachMedia(video);
        return hls;
    }

    /**
     * A stream failed after HlsPlaybackFactory exhausted its recovery (expired
     * signed manifest, repeated network or decode failures). Swap the player in
     * place for the next compatible source of this parser (for example the
     * Rutube embed after its direct HLS), or show the source error state.
     * @returns {boolean} true when a fallback source was mounted
     * @private
     */
    _handleStreamFailure({ container, video, failedSource, sources, options = {}, reason }) {
        if (options.isRequestCurrent && !options.isRequestCurrent()) return false;
        if (!video || video._movieExtensionStreamFailed) return false;
        video._movieExtensionStreamFailed = true;

        const hls = video._movieExtensionHls;
        try { hls?.destroy?.(); } catch { /* ignore */ }
        video._movieExtensionHls = null;
        if (container?._hlsInstance === hls) container._hlsInstance = null;

        // The shared cleaner may have wrapped this same element in its UI.
        const mountRoot = video.closest?.('.native-player-wrapper') || video;
        const host = mountRoot.parentElement || container;
        const failedSourceUrls = [...(options.failedSourceUrls || []), failedSource?.url].filter(Boolean);
        const remaining = (sources || []).filter(candidate =>
            candidate
            && candidate !== failedSource
            && !failedSourceUrls.includes(candidate.url)
            && this.supportsSourceType(candidate)
        );

        console.warn(`[${this.name}] Stream failed (${reason}); ${remaining.length ? 'switching to the next source' : 'no fallback source'}`);

        const doc = typeof document !== 'undefined' ? document : null;
        if (remaining.length > 0 && doc && mountRoot.parentElement) {
            const staging = doc.createElement('div');
            const fallbackOptions = { ...options, failedSourceUrls, lifecycleHost: host };
            const rendered = this.renderPlayer(staging, remaining, fallbackOptions);
            const replacement = staging.firstElementChild;
            if (rendered && replacement) {
                container?._playerSourceWatcher?.cancel?.();
                mountRoot.replaceWith(replacement);
                if (container) {
                    container._hlsInstance = staging._hlsInstance || null;
                    container._playerSourceWatcher = staging._playerSourceWatcher || null;
                }
                options.onSourceFallback?.({ from: failedSource, reason, parserId: this.id });
                return true;
            }
        }

        const lifecycle = typeof window !== 'undefined' ? window.PlayerSourceLifecycle : null;
        lifecycle?.setState(host, 'error', {
            message: 'Поток недоступен: ссылка устарела или сервер не отвечает.',
            onRetry: options.onRetry || (() => this.renderPlayer(container, sources, options)),
            onResearch: options.onResearch
        });
        return false;
    }

    /**
     * Check whether a VideoSource can be mounted by the base renderer.
     * Compatibility belongs to the individual source; getPlayerType() is only a preference.
     * @param {VideoSource} source
     * @returns {boolean}
     */
    supportsSourceType(source) {
        return this.getSourcePlayerType(source) !== null;
    }

    /**
     * Resolve the DOM player type for one source.
     * Legacy sources without a type are treated as iframe sources.
     * @param {VideoSource} source
     * @returns {'iframe'|'video'|null}
     */
    getSourcePlayerType(source) {
        const sourceType = source?.type || 'iframe';
        if (sourceType === 'iframe') return 'iframe';
        if (sourceType === 'video' || sourceType === 'hls') return 'video';
        return null;
    }

    /**
     * Return the player type this parser uses.
     * @returns {'iframe'|'video'|'custom'} Player type
     */
    getPlayerType() {
        return 'iframe';
    }

    /**
     * Return the list of supported movie types for this parser.
     * Return null to indicate all types are supported.
     * @returns {Array<string>|null} Supported types (e.g. ['tv-series', 'cartoon', 'anime']) or null for all
     */
    getSupportedTypes() {
        return null;
    }

    /**
     * Check if this parser supports the given movie type.
     * @param {string} movieType - The movie type to check
     * @returns {boolean}
     */
    supportsType(movieType) {
        const supported = this.getSupportedTypes();
        if (!supported) return true; // null = all types supported
        return supported.includes(movieType);
    }

    isSearchResultCompatible(_result, _movieType) {
        return true;
    }

    // ─── Diagnostics ──────────────────────────────────────────────────

    /**
     * Verbose parser tracing is opt-in so normal playback does not flood the
     * console (and serialize candidate lists) on every search. Enable with
     * `localStorage.setItem('movieExtension.debugParsers', '1')`.
     * @returns {boolean}
     */
    static isDebugEnabled() {
        try {
            return globalThis.localStorage?.getItem(PARSER_DEBUG_STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    }

    /**
     * console.log() only when parser debugging is enabled.
     * @param {...any} args
     */
    debugLog(...args) {
        if (BaseParserService.isDebugEnabled()) console.log(...args);
    }

    // ─── Network ──────────────────────────────────────────────────────

    /**
     * fetch() with a hard deadline that also covers reading the body.
     * A provider mirror that accepts the connection but never answers must not
     * hold source discovery until the browser's own network timeout. An
     * optional `options.signal` (for example a mirror race) aborts it as well.
     * @param {string} url
     * @param {RequestInit} [options]
     * @param {number} [timeoutMs]
     * @returns {Promise<Response>}
     */
    fetchWithTimeout(url, options = {}, timeoutMs = this.requestTimeoutMs) {
        if (typeof AbortController === 'undefined') return fetch(url, options);

        const controller = new AbortController();
        const externalSignal = options?.signal;
        if (externalSignal) {
            if (externalSignal.aborted) controller.abort(externalSignal.reason);
            else externalSignal.addEventListener?.('abort', () => controller.abort(externalSignal.reason), { once: true });
        }
        if (typeof setTimeout === 'function' && timeoutMs > 0) {
            // The timer intentionally outlives the response headers so a stalled
            // body is aborted too; aborting a consumed response is a no-op.
            const timer = setTimeout(() => {
                controller.abort(new Error(`${this.name} request timed out after ${timeoutMs} ms`));
            }, timeoutMs);
            timer?.unref?.();
        }
        return fetch(url, { ...options, signal: controller.signal });
    }

    // ─── Built-in Caching ─────────────────────────────────────────────

    /**
     * Cached wrapper around search(). Uses in-memory cache with configurable TTL.
     * @param {string} title
     * @param {string|number|null} year
     * @param {Object} [options] - Provider-specific search options
     * @returns {Promise<SearchResult|null>}
     */
    getPerfCategory(operation) {
        const provider = { kinogo: 'KINOGO', exfs: 'EXFS', seasonvar: 'SEASONVAR', rutube: 'RUTUBE' }[this.id];
        return provider ? `${provider}_${operation}` : 'OTHER';
    }

    async cachedSearch(title, year, options = {}) {
        const mediaType = options?.mediaType || null;
        const seasonNumber = options?.seasonNumber ?? '';
        const cacheKey = `${title}_${year || ''}_${mediaType || ''}_${seasonNumber}`;
        const cached = this._searchCache.get(cacheKey);
        const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;

        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            perf?.recordCall(this.getPerfCategory('SEARCH'), { cacheHit: true });
            return cached.data;
        }

        const inFlight = this._searchInFlight.get(cacheKey);
        if (inFlight) {
            perf?.recordCall(this.getPerfCategory('SEARCH'), { inFlightDedupHit: true });
            return inFlight;
        }
        perf?.recordCall(this.getPerfCategory('SEARCH'));
        const cacheGeneration = this._cacheGeneration;

        const request = (async () => {
            try {
                const result = await this.search(title, year, options);
                if (cacheGeneration === this._cacheGeneration) {
                    this._searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
                }
                return result;
            } catch (error) {
                console.error(`[${this.name}] Search error:`, error);
                return null;
            } finally {
                if (this._searchInFlight.get(cacheKey) === request) {
                    this._searchInFlight.delete(cacheKey);
                }
            }
        })();

        this._searchInFlight.set(cacheKey, request);
        return request;
    }

    /**
     * Cache and coalesce source extraction for one search result.
     * This prevents background discovery and an immediate user click from fetching
     * and parsing the same third-party movie page twice.
     * @param {SearchResult|string} searchResult
     * @returns {Promise<Array<VideoSource>>}
     */
    async cachedVideoSources(searchResult, options = {}) {
        const sourceKey = typeof searchResult === 'string' ? searchResult : searchResult?.url;
        if (!sourceKey) return [];

        const forceRefresh = options?.forceRefresh === true;

        const cached = this._sourceCache.get(sourceKey);
        const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
        if (!forceRefresh && cached && Date.now() - cached.timestamp < this.cacheTTL) {
            perf?.recordCall(this.getPerfCategory('SOURCE'), { cacheHit: true });
            return cached.data;
        }

        const inFlight = this._sourceInFlight.get(sourceKey);
        if (!forceRefresh && inFlight) {
            perf?.recordCall(this.getPerfCategory('SOURCE'), { inFlightDedupHit: true });
            return inFlight;
        }
        if (forceRefresh) {
            perf?.recordCall(this.getPerfCategory('SOURCE'), { cacheBypass: true });
        }
        perf?.recordCall(this.getPerfCategory('SOURCE'));
        const cacheGeneration = this._cacheGeneration;

        const request = (async () => {
            try {
                const sources = await this.getVideoSources(searchResult);
                const normalized = Array.isArray(sources) ? sources : [];
                // An empty source list is not a successful discovery result. Do
                // not poison the source cache after a transient provider page,
                // expired token, or incomplete iframe response.
                if (cacheGeneration === this._cacheGeneration && normalized.length > 0) {
                    this._sourceCache.set(sourceKey, { data: normalized, timestamp: Date.now() });
                }
                return normalized;
            } finally {
                if (this._sourceInFlight.get(sourceKey) === request) {
                    this._sourceInFlight.delete(sourceKey);
                }
            }
        })();

        this._sourceInFlight.set(sourceKey, request);
        return request;
    }

    /**
     * Clear the search cache.
     */
    clearCache() {
        this._cacheGeneration += 1;
        this._searchCache.clear();
        this._searchInFlight.clear();
        this._sourceCache.clear();
        this._sourceInFlight.clear();
    }

    // ─── Markup Helpers (for custom renderers) ────────────────────────

    /**
     * Escape provider text for HTML text or a quoted attribute.
     * @param {*} value
     * @returns {string}
     */
    static escapeAttribute(value) {
        return escapePlayerAttribute(value);
    }

    /**
     * Validate a direct media URL and escape it for a quoted src attribute.
     * @param {string} sourceUrl
     * @returns {string|null} Escaped URL, or null for unsupported schemes
     */
    static toMediaSrcAttribute(sourceUrl) {
        return toPlayerMediaSrcAttribute(sourceUrl);
    }

    /**
     * Whether a frame URL belongs to a provider the extension supports inside
     * the frame (player-cleaner ad isolation and the episode bridge).
     * @param {string} sourceUrl
     * @returns {boolean}
     */
    static isSupportedProviderFrameUrl(sourceUrl) {
        return isVenomProviderUrl(sourceUrl);
    }
}

const PARSER_DEBUG_STORAGE_KEY = 'movieExtension.debugParsers';

const VENOM_AD_FREE_HOSTS = new Set([
    'namy.ws',
    'variyt.ws',
    'nextembed.ws',
    'ortified.ws',
    'lumex.cloud',
    'cinemar.cc',
    'stravers.live',
    'allarknow.online'
]);

// Provider URLs come from scraped pages. Only web/extension schemes may become
// frame sources, and the serialized URL is escaped for a quoted attribute.
function toPlayerFrameSrcAttribute(sourceUrl) {
    try {
        const parsed = new URL(String(sourceUrl || ''), typeof window !== 'undefined' ? window.location?.href : undefined);
        if (!['https:', 'http:', 'chrome-extension:'].includes(parsed.protocol)) return null;
        return escapePlayerAttribute(parsed.href);
    } catch {
        return null;
    }
}

// Direct media URLs come from scraped pages or decoded provider playlists. Only
// network/blob schemes may become <video>/<source> sources, escaped for a quoted attribute.
function toPlayerMediaSrcAttribute(sourceUrl) {
    try {
        const parsed = new URL(String(sourceUrl || ''), typeof window !== 'undefined' ? window.location?.href : undefined);
        if (!['https:', 'http:', 'blob:'].includes(parsed.protocol)) return null;
        return escapePlayerAttribute(parsed.href);
    } catch {
        return null;
    }
}

function escapePlayerAttribute(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function withVenomAdFreeParam(sourceUrl, sourceSite) {
    if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) return sourceUrl;

    try {
        const parsed = new URL(sourceUrl, typeof window !== 'undefined' ? window.location?.href : undefined);
        if (!isVenomProviderUrl(parsed)) return sourceUrl;

        // player-venom supports this flag natively and checks it before any
        // pre-roll, mid-roll, post-roll, or non-linear ad is initialized.
        parsed.searchParams.set('santabarbaranoads', '1');
        // The embed API signs different media URLs without the source site's
        // HTTP Referer. Its `host` query alone does not preserve that context.
        // Narrow DNR rules restore the Referer for marked extension frames.
        if (sourceSite) {
            const site = new URL(sourceSite);
            if (site.protocol === 'https:') parsed.searchParams.set('movieExtensionSite', site.hostname);
        }
        return parsed.toString();
    } catch {
        return sourceUrl;
    }
}

function isVenomProviderUrl(sourceUrl) {
    try {
        const parsed = sourceUrl instanceof URL
            ? sourceUrl
            : new URL(sourceUrl, typeof window !== 'undefined' ? window.location?.href : undefined);
        const hostname = parsed.hostname.toLowerCase();
        return Array.from(VENOM_AD_FREE_HOSTS).some(host =>
            hostname === host || hostname.endsWith(`.${host}`)
        );
    } catch {
        return false;
    }
}

/**
 * @typedef {Object} SearchResult
 * @property {string} url - URL for getVideoSources
 * @property {string} title - Title of the found content
 * @property {string} parserId - ID of the parser that found this result
 * @property {string|null} [year] - Release year
 * @property {boolean} [isSeries] - Whether it's a series
 * @property {string} [source] - Source identifier
 */

/**
 * @typedef {Object} VideoSource
 * @property {string} name - Display name of the source/player
 * @property {string} url - URL to the video or player
 * @property {'iframe'|'video'|'hls'} type - Source type
 */

// Export
if (typeof window !== 'undefined') {
    window.BaseParserService = BaseParserService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BaseParserService };
}
