/**
 * Paginated TMDB-backed catalogue data owner.
 *
 * The catalogue intentionally keeps Kinopoisk identity lazy. A card is
 * resolved to a KP ID only after the user opens it through the existing
 * HomeMovieNavigationService flow.
 */
class CatalogService {
    constructor({ tmdbService = null, storage = null } = {}) {
        this.tmdbService = tmdbService || (typeof TMDBService !== 'undefined' ? new TMDBService() : null);
        this.storage = storage || (typeof chrome !== 'undefined' ? chrome.storage?.local : null);
        this.cachePrefix = 'catalog_page_v4_';
        this.cacheIndexKey = 'catalog_page_index_v4';
        this.cacheTtlMs = 20 * 60 * 1000;
        this.maxCachedPages = 48;
        this.pageSize = 24;
        this.inFlight = new Map();
    }

    async getCategoryPage(category, query = {}, options = {}) {
        const normalizedCategory = this.normalizeCategory(category);
        const normalizedQuery = this.normalizeQuery(query);
        const pageKey = this.buildPageKey(normalizedCategory, normalizedQuery);
        const requestKey = `${pageKey}:${options.forceRefresh === true ? 'fresh' : 'normal'}`;

        if (this.inFlight.has(requestKey)) return this.inFlight.get(requestKey);

        const promise = this._getCategoryPage(
            normalizedCategory,
            normalizedQuery,
            pageKey,
            options
        ).finally(() => this.inFlight.delete(requestKey));

        this.inFlight.set(requestKey, promise);
        return promise;
    }

    async _getCategoryPage(category, query, pageKey, options) {
        const cached = options.forceRefresh === true ? null : await this.readCache(pageKey);
        if (cached && Date.now() - cached.savedAt < this.cacheTtlMs) {
            return {
                ...cached.payload,
                category,
                query,
                page: query.page,
                isFromCache: true,
                isStale: false
            };
        }

        try {
            if (!this.tmdbService || typeof this.tmdbService.getCatalogPage !== 'function') {
                throw new Error('TMDB catalogue provider is not available');
            }

            const providerResult = await this.tmdbService.getCatalogPage({
                category,
                page: query.page,
                pageSize: query.pageSize,
                sort: query.sort,
                yearFrom: query.yearFrom,
                yearTo: query.yearTo,
                genre: query.genre,
                country: query.country,
                signal: options.signal || null
            });

            const payload = this.normalizeProviderResult(providerResult, category, query);
            await this.writeCache(pageKey, payload);
            return { ...payload, isFromCache: false, isStale: false };
        } catch (error) {
            if (cached?.payload) {
                console.warn('[CatalogService] Provider failed; serving stale catalogue page:', error.message);
                return {
                    ...cached.payload,
                    category,
                    query,
                    page: query.page,
                    isFromCache: true,
                    isStale: true,
                    error: error.message
                };
            }
            throw error;
        }
    }

    normalizeProviderResult(result, category, query) {
        const rawItems = Array.isArray(result?.items)
            ? result.items
            : (Array.isArray(result?.results) ? result.results : []);
        const seen = new Set();
        const items = rawItems.map(item => {
            const tmdbId = Number(item?.tmdbId || item?.id);
            if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0 || seen.has(tmdbId)) return null;
            seen.add(tmdbId);
            return {
                ...item,
                tmdbId,
                kinopoiskId: Number(item.kinopoiskId) > 0 ? Number(item.kinopoiskId) : null,
                category,
                isTmdbOnly: !(Number(item.kinopoiskId) > 0),
                source: 'catalog-tmdb'
            };
        }).filter(Boolean);

        return {
            items,
            page: Number(result?.page || query.page),
            totalPages: Number(result?.totalPages || 1),
            totalResults: Number(result?.totalResults || items.length),
            category,
            query
        };
    }

    normalizeCategory(category) {
        if (typeof window !== 'undefined' && typeof window.normalizeCatalogCategory === 'function') {
            return window.normalizeCatalogCategory(category);
        }
        if (typeof normalizeCatalogCategory === 'function') {
            return normalizeCatalogCategory(category);
        }
        const value = String(category || '').toLowerCase();
        return ['films', 'series', 'cartoons', 'anime'].includes(value) ? value : 'films';
    }

    normalizeQuery(query = {}) {
        const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
        const pageSize = Math.min(30, Math.max(12, Number.parseInt(query.pageSize, 10) || this.pageSize));
        const allowedSorts = new Set(['popularity.desc', 'vote_average.desc', 'primary_release_date.desc', 'first_air_date.desc']);
        const sort = allowedSorts.has(query.sort) ? query.sort : 'popularity.desc';
        const yearFrom = this.normalizeYear(query.yearFrom);
        const yearTo = this.normalizeYear(query.yearTo);
        const genre = this.normalizePositiveInt(query.genre);
        const country = typeof query.country === 'string' && /^[A-Z]{2}$/i.test(query.country)
            ? query.country.toUpperCase()
            : '';

        return {
            page,
            pageSize,
            sort,
            yearFrom: yearFrom && yearFrom >= 1870 ? yearFrom : null,
            yearTo: yearTo && yearTo >= 1870 ? yearTo : null,
            genre,
            country
        };
    }

    normalizeYear(value) {
        const year = Number.parseInt(value, 10);
        return Number.isInteger(year) ? year : null;
    }

    normalizePositiveInt(value) {
        const number = Number.parseInt(value, 10);
        return Number.isSafeInteger(number) && number > 0 ? number : null;
    }

    buildPageKey(category, query) {
        const queryKey = [
            query.page,
            query.pageSize,
            query.sort,
            query.yearFrom || '',
            query.yearTo || '',
            query.genre || '',
            query.country || ''
        ].join('_');
        return `${this.cachePrefix}${category}_${queryKey}`;
    }

    readStorage(keys) {
        if (!this.storage?.get) return Promise.resolve({});
        return new Promise(resolve => this.storage.get(keys, result => resolve(result || {})));
    }

    writeStorage(data) {
        if (!this.storage?.set) return Promise.resolve();
        return new Promise(resolve => this.storage.set(data, resolve));
    }

    removeStorage(keys) {
        if (!this.storage?.remove) return Promise.resolve();
        return new Promise(resolve => this.storage.remove(keys, resolve));
    }

    async readCache(key) {
        const result = await this.readStorage([key]);
        const cached = result[key];
        if (!cached?.payload || !Array.isArray(cached.payload.items)) return null;
        return cached;
    }

    async writeCache(key, payload) {
        await this.writeStorage({
            [key]: {
                savedAt: Date.now(),
                payload
            }
        });

        const indexResult = await this.readStorage([this.cacheIndexKey]);
        const index = Array.isArray(indexResult[this.cacheIndexKey])
            ? indexResult[this.cacheIndexKey].filter(item => item?.key !== key)
            : [];
        index.push({ key, savedAt: Date.now() });

        const evicted = index.length > this.maxCachedPages
            ? index.splice(0, index.length - this.maxCachedPages)
            : [];
        await this.writeStorage({ [this.cacheIndexKey]: index });
        if (evicted.length > 0) {
            await this.removeStorage(evicted.map(item => item.key));
        }
    }

    async clearCache() {
        const result = await this.readStorage([this.cacheIndexKey]);
        const keys = Array.isArray(result[this.cacheIndexKey])
            ? result[this.cacheIndexKey].map(item => item.key).filter(Boolean)
            : [];
        await this.removeStorage([...keys, this.cacheIndexKey]);
        return keys.length;
    }
}

if (typeof window !== 'undefined') window.CatalogService = CatalogService;
if (typeof globalThis !== 'undefined') globalThis.CatalogService = CatalogService;
if (typeof module !== 'undefined' && module.exports) module.exports = CatalogService;
