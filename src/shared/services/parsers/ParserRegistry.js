/**
 * ParserRegistry - Centralized registry for video source parsers.
 * Manages parser registration, lookup, and coordinated search across all parsers.
 */
class ParserRegistry {
    /**
     * @param {string[]} [priorityOrder] - Ordered list of parser IDs for display priority
     */
    constructor(priorityOrder = []) {
        /** @private @type {Map<string, BaseParserService>} */
        this.parsers = new Map();
        /** @private @type {string[]} */
        this.priorityOrder = priorityOrder;
    }

    /**
     * Register a parser instance.
     * Validates that the parser extends BaseParserService and has required fields.
     * @param {BaseParserService} parser
     * @throws {TypeError} If parser doesn't extend BaseParserService
     * @throws {Error} If parser lacks id or name
     */
    register(parser) {
        if (!(parser instanceof BaseParserService)) {
            throw new TypeError('Parser must extend BaseParserService');
        }
        if (!parser.id || !parser.name) {
            throw new Error('Parser must have id and name');
        }
        if (this.parsers.has(parser.id)) {
            console.warn(`[ParserRegistry] Parser "${parser.id}" already registered, overwriting`);
        }
        this.parsers.set(parser.id, parser);

        // Auto-add to priority order if not already present
        if (!this.priorityOrder.includes(parser.id)) {
            this.priorityOrder.push(parser.id);
        }
    }

    /**
     * Get a parser by its ID.
     * @param {string} id
     * @returns {BaseParserService|undefined}
     */
    get(id) {
        return this.parsers.get(id);
    }

    /**
     * Get all registered parsers, ordered by priority.
     * @returns {BaseParserService[]}
     */
    getAll() {
        return this.priorityOrder
            .map(id => this.parsers.get(id))
            .filter(Boolean);
    }

    /**
     * Get all registered parser IDs.
     * @returns {string[]}
     */
    getIds() {
        return this.priorityOrder.filter(id => this.parsers.has(id));
    }

    /**
     * Search across all registered parsers in parallel.
     * Uses Promise.allSettled for resilience — one parser's failure won't break others.
     * Results include parserId for traceability.
     * 
     * @param {string} title - Movie/series title
     * @param {string|number|null} year - Release year
     * @param {Object} [options] - Provider-specific search options. `onResult`
     * and `onSettled` are optional non-blocking parser lifecycle callbacks.
     * @returns {Promise<SearchResult[]>} Successful results from all parsers
     */
    async searchAll(title, year, options = {}) {
        const parsers = this.getAll();
        const { onResult, onSettled, ...parserOptions } = options || {};
        
        const results = await Promise.allSettled(
            parsers.map(async (parser) => {
                let result = null;
                try {
                    result = await parser.cachedSearch(title, year, parserOptions);
                    if (result) {
                        // Ensure parserId is set
                        result.parserId = parser.id;
                        if (typeof onResult === 'function') {
                            try {
                                // Do not await this callback: source extraction can
                                // begin while slower parser searches are pending.
                                onResult(result, parser);
                            } catch (error) {
                                console.warn('[ParserRegistry] onResult callback failed:', error);
                            }
                        }
                    }
                    return result;
                } finally {
                    if (typeof onSettled === 'function') {
                        try {
                            onSettled(result, parser);
                        } catch (error) {
                            console.warn('[ParserRegistry] onSettled callback failed:', error);
                        }
                    }
                }
            })
        );

        return results
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value);
    }

    /**
     * Get the number of registered parsers.
     * @returns {number}
     */
    get size() {
        return this.parsers.size;
    }
}

// Export
if (typeof window !== 'undefined') {
    window.ParserRegistry = ParserRegistry;
}
