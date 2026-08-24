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
     */
    constructor({ id, name, baseUrl, cacheTTL = 3600000 }) {
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
            if (isHls) {
                container.innerHTML = `<video class="player-surface__media" controls playsinline></video>`;
            } else {
                container.innerHTML = `<video class="player-surface__media" controls playsinline src="${source.url}"><source src="${source.url}" type="video/mp4"></video>`;
            }
            const video = container.querySelector?.('video');

            if (isHls && video && typeof window !== 'undefined') {
                const mountHls = () => {
                    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                        const hls = new Hls({
                            enableWorker: true
                        });
                        hls.loadSource(source.url);
                        hls.attachMedia(video);
                        container._hlsInstance = hls;
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
            container.innerHTML = `<iframe class="player-surface__media" src="${source.url}" allowfullscreen allow="autoplay; fullscreen" title="${this.name} player"></iframe>`;
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
            const onState = (state, detail) => {
                if (options.isRequestCurrent && !options.isRequestCurrent()) return;
                lifecycle.setState(container, state, {
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
                if (cacheGeneration === this._cacheGeneration) {
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
