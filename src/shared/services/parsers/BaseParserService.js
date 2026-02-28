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
     * Default implementation creates an iframe player.
     * Override for custom player UIs (e.g. Seasonvar's episode selector).
     * 
     * @param {HTMLElement} container - DOM container element
     * @param {Array<VideoSource>} sources - Video sources
     * @param {Object} [options] - Additional options
     * @returns {void}
     */
    renderPlayer(container, sources, options = {}) {
        console.log(`[DEBUG BaseParserService] renderPlayer called for ${this.id}. sources: ${sources?.length}, container:`, container?.tagName, container?.className);
        console.log(`[DEBUG BaseParserService] Container children BEFORE render:`, Array.from(container.children).map(c => c.tagName + '.' + c.className?.substring(0,30)));
        if (!sources || sources.length === 0) {
            container.innerHTML = '<div class="video-placeholder"><span>Источники не найдены</span></div>';
            return;
        }
        const source = sources[0];
        console.log(`[DEBUG BaseParserService] Rendering IFRAME player. url: ${source.url?.substring(0,80)}`);
        container.innerHTML = `<iframe src="${source.url}" allowfullscreen allow="autoplay; fullscreen" style="width: 100%; height: 100%; border: none;"></iframe>`;
        console.log(`[DEBUG BaseParserService] Container children AFTER render:`, Array.from(container.children).map(c => c.tagName + '.' + c.className?.substring(0,30)));
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

    // ─── Built-in Caching ─────────────────────────────────────────────

    /**
     * Cached wrapper around search(). Uses in-memory cache with configurable TTL.
     * @param {string} title
     * @param {string|number|null} year
     * @returns {Promise<SearchResult|null>}
     */
    async cachedSearch(title, year) {
        const cacheKey = `${title}_${year || ''}`;
        const cached = this._searchCache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            console.log(`[DEBUG BaseParserService] cachedSearch HIT for ${this.id}. key: "${cacheKey}", age: ${Math.round((Date.now() - cached.timestamp)/1000)}s`);
            return cached.data;
        }

        try {
            console.log(`[DEBUG BaseParserService] cachedSearch MISS for ${this.id}. key: "${cacheKey}", calling search()...`);
            const result = await this.search(title, year);
            this._searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
            console.log(`[DEBUG BaseParserService] cachedSearch result for ${this.id}:`, result ? 'found' : 'null');
            return result;
        } catch (error) {
            console.error(`[${this.name}] Search error:`, error);
            return null;
        }
    }

    /**
     * Clear the search cache.
     */
    clearCache() {
        this._searchCache.clear();
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
