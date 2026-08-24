/**
 * FranchiseService - Orchestrates Franchise & Collection Data for MovieDetails
 * 
 * Architecture:
 *  1. In-flight Promise deduplication per `collectionId`.
 *  2. Multi-tier Local Cache (`tmdb_collection_cache_v1_{collectionId}`) with bounded LRU eviction (max 100) and 14-day TTL.
 *  3. TMDB `/collection/{id}` primary query with Bearer rotation and Russian localization.
 *  4. Strict filtering (adult === false, valid tmdbId, non-empty title) and chronological sort (releaseDate ASC).
 *  5. Batch KP ID mapping via IdMappingService with admin queue bypass (`skipQueue: true, context: 'franchise'`).
 *  6. Output bounded, normalized FranchiseDTO with parts ready for navigation.
 * 
 * INVARIANTS:
 *  - ZERO unnecessary initial requests (lazy-loaded on viewport intersection).
 *  - ZERO unmapped franchise items added to Home manual mapping queue (`skipQueue: true`).
 *  - ZERO fake or guessed Kinopoisk IDs.
 */

class FranchiseService {
    static normalizePositiveId(value) {
        const numericId = Number(value);
        return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
    }

    /**
     * Extract provider-scoped identities without guessing from titles.
     * Generic `id` is accepted only for Kinopoisk-native relation payloads.
     */
    static getStableIdentity(item, { allowGenericKinopoiskId = false } = {}) {
        if (!item || typeof item !== 'object') {
            return { kinopoiskId: null, tmdbId: null };
        }

        const kinopoiskCandidates = [item.kinopoiskId, item.filmId, item.movieId];
        if (allowGenericKinopoiskId) kinopoiskCandidates.push(item.id);

        const kinopoiskId = kinopoiskCandidates
            .map(value => FranchiseService.normalizePositiveId(value))
            .find(Boolean) || null;
        const tmdbId = FranchiseService.normalizePositiveId(
            item.tmdbId ?? item.externalId?.tmdb ?? item.externalIds?.tmdb
        );

        return { kinopoiskId, tmdbId };
    }

    static haveSameStableIdentity(left, right, leftOptions = {}, rightOptions = {}) {
        const leftIdentity = FranchiseService.getStableIdentity(left, leftOptions);
        const rightIdentity = FranchiseService.getStableIdentity(right, rightOptions);

        if (leftIdentity.kinopoiskId && rightIdentity.kinopoiskId) {
            return leftIdentity.kinopoiskId === rightIdentity.kinopoiskId;
        }
        if (leftIdentity.tmdbId && rightIdentity.tmdbId) {
            return leftIdentity.tmdbId === rightIdentity.tmdbId;
        }
        return false;
    }

    static deduplicateByStableIdentity(items, options = {}) {
        if (!Array.isArray(items)) return [];

        const accepted = [];
        return items.filter(item => {
            const identity = FranchiseService.getStableIdentity(item, options);
            // Identity-less items are not title-deduplicated by design.
            if (!identity.kinopoiskId && !identity.tmdbId) return true;
            if (accepted.some(existing => FranchiseService.haveSameStableIdentity(existing, item, options, options))) {
                return false;
            }
            accepted.push(item);
            return true;
        });
    }

    /**
     * @param {Object} [options]
     * @param {Object} [options.tmdbService]
     * @param {Object} [options.idMappingService]
     */
    constructor(options = {}) {
        this.tmdbService = options.tmdbService || (typeof TMDBService !== 'undefined' ? new TMDBService() : null);
        this.idMappingService = options.idMappingService || (typeof IdMappingService !== 'undefined' ? new IdMappingService() : null);
        this.kinopoiskService = options.kinopoiskService || (typeof KinopoiskService !== 'undefined' ? new KinopoiskService() : null);

        this.CACHE_PREFIX = 'tmdb_collection_cache_v2_';
        this.INDEX_KEY = 'tmdb_collection_cache_index_v2';
        this.MAX_CACHED_ENTRIES = 100;
        this.DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

        // In-flight deduplication map: collectionId -> Promise
        this.inFlightRequests = new Map();

        // In-memory fallback if chrome.storage is unavailable (e.g. Node tests)
        this._memoryCache = new Map();
        this._memoryIndex = [];
    }

    /**
     * Clean franchise/collection title by stripping redundant suffixes like "(Коллекция)" for display.
     * Does not mutate original DTO name.
     * @param {string} rawName
     * @returns {string}
     */
    static cleanCollectionName(rawName) {
        if (!rawName || typeof rawName !== 'string') return '';
        return rawName
            .replace(/\s*[([]?(?:Коллекция|коллекция|КОЛЛЕКЦИЯ|Collection|collection|COLLECTION)[)\]]?\s*$/i, '')
            .trim();
    }

    /**
     * Instance wrapper for cleanCollectionName.
     * @param {string} rawName
     * @returns {string}
     */
    cleanCollectionName(rawName) {
        return FranchiseService.cleanCollectionName(rawName);
    }

    /**
     * Build canonical storage key for collection cache.
     * @param {number|string} collectionId
     * @returns {string}
     */
    getCacheKey(collectionId) {
        return `${this.CACHE_PREFIX}${Number(collectionId)}`;
    }

    /**
     * Retrieve cached franchise data with TTL and schema validation.
     * @param {number|string} collectionId
     * @returns {Promise<Object|null>}
     */
    async getCachedFranchise(collectionId) {
        const numId = Number(collectionId);
        if (!numId || isNaN(numId) || numId <= 0) return null;

        const key = this.getCacheKey(numId);

        try {
            let entry = this._memoryCache.get(key) || null;
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                const res = await new Promise(resolve => chrome.storage.local.get([key], resolve));
                entry = (res && res[key]) || entry;
            }

            if (!entry || typeof entry !== 'object') return null;
            if (entry.schemaVersion !== 2 || entry.id !== numId) return null;
            if (!Array.isArray(entry.parts) || typeof entry.cachedAt !== 'number') return null;

            const now = Date.now();
            const age = now - entry.cachedAt;

            if (age < this.DEFAULT_TTL_MS) {
                const normalized = {
                    ...entry,
                    parts: FranchiseService.deduplicateByStableIdentity(entry.parts)
                };
                this._memoryCache.set(key, normalized);

                return normalized;
            }

            return null; // Expired
        } catch (err) {
            console.warn(`[FranchiseService] Cache read error for ${key}:`, err?.message);
            return null;
        }
    }

    /**
     * Save franchise payload to cache with bounded LRU maintenance.
     * @param {number|string} collectionId
     * @param {Object} data - Normalized FranchiseDTO
     * @returns {Promise<void>}
     */
    async setCachedFranchise(collectionId, data) {
        const numId = Number(collectionId);
        if (!numId || isNaN(numId) || !data || !Array.isArray(data.parts)) return;

        const key = this.getCacheKey(numId);
        const now = Date.now();

        const entry = {
            schemaVersion: 2,
            id: numId,
            name: data.name || '',
            overview: data.overview || '',
            posterUrl: data.posterUrl || null,
            backdropUrl: data.backdropUrl || null,
            cachedAt: now,
            parts: data.parts
        };

        try {
            // Always keep the process-local mirror synchronized. Chrome storage remains
            // authoritative on reads so another context cannot be masked by stale memory.
            this._memoryCache.set(key, entry);
            this._memoryIndex = this._memoryIndex.filter(it => it.key !== key);
            this._memoryIndex.push({ key, id: numId, cachedAt: now });

            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                await new Promise(resolve => chrome.storage.local.set({ [key]: entry }, resolve));

                // Maintain bounded LRU index
                const indexRes = await new Promise(resolve => chrome.storage.local.get([this.INDEX_KEY], resolve));
                let index = Array.isArray(indexRes?.[this.INDEX_KEY]) ? indexRes[this.INDEX_KEY] : [];

                index = index.filter(it => it && it.key !== key);
                index.push({ key, id: numId, cachedAt: now });

                if (index.length > this.MAX_CACHED_ENTRIES) {
                    const toRemove = index.slice(0, index.length - this.MAX_CACHED_ENTRIES);
                    index = index.slice(index.length - this.MAX_CACHED_ENTRIES);
                    const keysToRemove = toRemove.map(it => it.key);
                    await new Promise(resolve => chrome.storage.local.remove(keysToRemove, resolve));
                }

                await new Promise(resolve => chrome.storage.local.set({ [this.INDEX_KEY]: index }, resolve));
            }

            if (this._memoryIndex.length > this.MAX_CACHED_ENTRIES) {
                const toRemove = this._memoryIndex.slice(0, this._memoryIndex.length - this.MAX_CACHED_ENTRIES);
                this._memoryIndex = this._memoryIndex.slice(this._memoryIndex.length - this.MAX_CACHED_ENTRIES);
                toRemove.forEach(it => this._memoryCache.delete(it.key));
            }

        } catch (err) {
            console.warn(`[FranchiseService] Cache write error for ${key}:`, err?.message);
        }
    }

    /**
     * Primary entry point: Retrieve and normalize a franchise collection with batch mapped KP IDs.
     * @param {number|string} collectionId
     * @param {Object} [options={}]
     * @param {AbortSignal} [options.signal=null]
     * @param {boolean} [options.forceRefresh=false]
     * @returns {Promise<Object|null>} Normalized FranchiseDTO with parts
     */
    async getFranchise(collectionId, options = {}) {
        const numId = Number(collectionId);
        if (!numId || isNaN(numId) || numId <= 0) return null;

        // 1. Check Cache unless force refresh requested
        if (!options.forceRefresh) {
            const cached = await this.getCachedFranchise(numId);
            if (cached) {
                const unmappedParts = (cached.parts || []).filter(p => !p.kinopoiskId || Number(p.kinopoiskId) <= 0);
                if (unmappedParts.length === 0) {
                    return cached;
                }

                // Self-healing remapping: attempt to resolve only unmapped parts
                const idMapper = this.idMappingService || (typeof window !== 'undefined' && window.firebaseManager?.getIdMappingService?.()) || (typeof IdMappingService !== 'undefined' ? new IdMappingService() : null);
                if (idMapper) {
                    try {
                        const batchInputs = unmappedParts.map(p => ({
                            id: p.tmdbId,
                            tmdbId: p.tmdbId,
                            mediaType: 'movie',
                            title: p.title,
                            originalTitle: p.originalTitle,
                            releaseDate: p.releaseDate,
                            year: p.year
                        }));

                        const mappingMap = await idMapper.resolveBatch(batchInputs, {
                            skipQueue: true,
                            context: 'franchise-self-heal',
                            forceRefresh: true,
                            kinopoiskService: options.kinopoiskService || this.kinopoiskService,
                            signal: options.signal
                        });

                        let updated = false;
                        cached.parts.forEach(part => {
                            if (!part.kinopoiskId || Number(part.kinopoiskId) <= 0) {
                                const key = (typeof idMapper.buildKey === 'function')
                                    ? idMapper.buildKey('movie', part.tmdbId)
                                    : `movie:${part.tmdbId}`;
                                const resolved = mappingMap.get(key) || mappingMap.get(part.tmdbId) || mappingMap.get(String(part.tmdbId)) || mappingMap.get(Number(part.tmdbId));
                                const resolvedKpId = FranchiseService.normalizePositiveId(
                                    resolved?.kinopoiskId ?? resolved?.kpId
                                );
                                if (resolvedKpId) {
                                    part.kinopoiskId = resolvedKpId;
                                    updated = true;
                                }

                            }
                        });

                        if (updated) {
                            await this.setCachedFranchise(numId, cached);
                        }
                    } catch (remapErr) {
                        console.warn('[FranchiseService] Self-healing remap warning:', remapErr.message);
                    }
                }

                return cached;
            }
        }

        // 2. In-flight Promise deduplication
        if (this.inFlightRequests.has(numId)) {
            return this.inFlightRequests.get(numId);
        }

        const fetchPromise = (async () => {
            try {
                const tmdb = this.tmdbService || (typeof window !== 'undefined' && window.firebaseManager?.getTMDBService?.()) || (typeof TMDBService !== 'undefined' ? new TMDBService() : null);
                if (!tmdb) {
                    console.warn('[FranchiseService] TMDBService unavailable.');
                    return null;
                }

                // 3. Fetch from TMDB collection endpoint
                const rawCollection = await tmdb.getCollection(numId, { signal: options.signal });
                if (!rawCollection || !Array.isArray(rawCollection.parts)) {
                    return null;
                }

                rawCollection.parts = FranchiseService.deduplicateByStableIdentity(rawCollection.parts);

                // 4. Batch resolve KP IDs if parts exist and idMappingService available
                const idMapper = this.idMappingService || (typeof window !== 'undefined' && window.firebaseManager?.getIdMappingService?.()) || (typeof IdMappingService !== 'undefined' ? new IdMappingService() : null);
                if (idMapper && rawCollection.parts.length > 0) {
                    try {
                        const batchInputs = rawCollection.parts.map(p => ({
                            id: p.tmdbId,
                            tmdbId: p.tmdbId,
                            mediaType: 'movie',
                            title: p.title,
                            originalTitle: p.originalTitle,
                            releaseDate: p.releaseDate,
                            year: p.year
                        }));

                        const mappingMap = await idMapper.resolveBatch(batchInputs, {
                            skipQueue: true,
                            context: 'franchise',
                            forceRefresh: Boolean(options.forceRefresh),
                            kinopoiskService: options.kinopoiskService || this.kinopoiskService,
                            signal: options.signal
                        });

                        rawCollection.parts.forEach(part => {
                            const key = (typeof idMapper.buildKey === 'function')
                                ? idMapper.buildKey('movie', part.tmdbId)
                                : `movie:${part.tmdbId}`;
                            const resolved = mappingMap.get(key) || mappingMap.get(part.tmdbId) || mappingMap.get(String(part.tmdbId)) || mappingMap.get(Number(part.tmdbId));
                            const resolvedKpId = FranchiseService.normalizePositiveId(
                                resolved?.kinopoiskId ?? resolved?.kpId
                            );
                            if (resolvedKpId) {
                                part.kinopoiskId = resolvedKpId;
                            }
                        });
                    } catch (mapErr) {
                        console.warn('[FranchiseService] Batch ID mapping warning:', mapErr.message);
                    }
                }

                // 5. Cache result
                await this.setCachedFranchise(numId, rawCollection);
                return rawCollection;
            } finally {
                this.inFlightRequests.delete(numId);
            }
        })();

        this.inFlightRequests.set(numId, fetchPromise);
        return fetchPromise;
    }
}

// Module export handling
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FranchiseService;
}
if (typeof window !== 'undefined') {
    window.FranchiseService = FranchiseService;
}
if (typeof globalThis !== 'undefined') {
    globalThis.FranchiseService = FranchiseService;
}
