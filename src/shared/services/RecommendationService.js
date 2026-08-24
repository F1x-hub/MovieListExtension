/**
 * RecommendationService - Orchestrates Discovery & Recommendations for MovieDetails
 * 
 * Pipeline:
 *  1. In-flight Promise deduplication per `${mediaType}:${tmdbId}`.
 *  2. Multi-tier Local Cache (`movie_recommendations_v1_{tmdbId}_{mediaType}`) with bounded LRU eviction (max 100).
 *  3. TMDB `/recommendations` primary query (page 1).
 *  4. Strict semantic, adult, and self-identity filtering.
 *  5. Batch KP ID mapping via IdMappingService with explicit admin queue bypass (`skipQueue: true`).
 *  6. Kinopoisk identity verification (`kinopoiskId > 0`).
 *  7. On-demand TMDB `/similar` deficit fallback ONLY when valid primary recommendations < 6.
 *  8. Output bounded, normalized RecommendationDTO array (target 10 items).
 * 
 * INVARIANTS:
 *  - ZERO scraper usage (SimilarMoviesParsingService is never called).
 *  - ZERO N+1 KP details/movie lookups (cards render from TMDB metadata + verified KP ID).
 *  - ZERO recommendation misses added to Home manual mapping queue (`skipQueue: true`).
 *  - ZERO fake or unmapped Kinopoisk IDs.
 */

class RecommendationService {
    /**
     * @param {Object} [options]
     * @param {Object} [options.tmdbService]
     * @param {Object} [options.idMappingService]
     */
    constructor(options = {}) {
        this.tmdbService = options.tmdbService || (typeof TMDBService !== 'undefined' ? new TMDBService() : null);
        this.idMappingService = options.idMappingService || (typeof IdMappingService !== 'undefined' ? new IdMappingService() : null);

        this.CACHE_PREFIX = 'movie_recommendations_v1_';
        this.INDEX_KEY = 'movie_recommendations_index_v1';
        this.MAX_CACHED_ENTRIES = 100;
        this.DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days for catalog
        this.FRESH_TTL_MS = 3 * 24 * 60 * 60 * 1000;    // 3 days for fresh/current-year titles
        this.TARGET_COUNT = 10;
        this.FALLBACK_DEFICIT_THRESHOLD = 6;

        // In-flight deduplication map: `${mediaType}:${tmdbId}` -> Promise
        this.inFlightRequests = new Map();

        // In-memory fallback if chrome.storage is unavailable (e.g. Node tests)
        this._memoryCache = new Map();
        this._memoryIndex = [];

        // Explicit exclusions: adult flag + hentai(198385), erotic(256466), softcore(155477), pornography(445), erotica(325693)
        this.EXPLICIT_KEYWORDS = new Set([198385, 256466, 155477, 445, 325693]);
        // Production companies for AnimeFesta short-form erotica: Suiseisha(149421), studio HōKIBOSHI(125825), Rabbit Gate(152965), WWWave(238639)
        this.EXPLICIT_COMPANIES = new Set([149421, 125825, 152965, 238639]);
    }

    /**
     * Build canonical storage key for recommendation cache.
     * @param {number|string} tmdbId
     * @param {'movie'|'tv'} mediaType
     * @returns {string}
     */
    getCacheKey(tmdbId, mediaType) {
        const normType = (mediaType === 'tv' || mediaType === 'tv-series' || mediaType === 'series') ? 'tv' : 'movie';
        return `${this.CACHE_PREFIX}${Number(tmdbId)}_${normType}`;
    }

    /**
     * Retrieve cached recommendations with TTL and schema validation.
     * @param {number|string} tmdbId
     * @param {'movie'|'tv'} mediaType
     * @returns {Promise<Array<Object>|null>}
     */
    async getCachedRecommendations(tmdbId, mediaType) {
        const numTmdbId = Number(tmdbId);
        if (!numTmdbId || isNaN(numTmdbId)) return null;

        const key = this.getCacheKey(numTmdbId, mediaType);

        try {
            let entry = null;
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                const res = await new Promise(resolve => chrome.storage.local.get([key], resolve));
                entry = res ? res[key] : null;
            } else {
                entry = this._memoryCache.get(key) || null;
            }

            if (!entry || typeof entry !== 'object') return null;
            if (entry.schemaVersion !== 1 || entry.tmdbId !== numTmdbId) return null;
            if (!Array.isArray(entry.items) || typeof entry.cachedAt !== 'number') return null;

            const now = Date.now();
            const ttlMs = entry.isFresh ? this.FRESH_TTL_MS : this.DEFAULT_TTL_MS;
            const age = now - entry.cachedAt;

            if (age < ttlMs) {
                return entry.items;
            }

            return null; // Expired
        } catch (err) {
            console.warn(`[RecommendationService] Cache read error for ${key}:`, err?.message);
            return null;
        }
    }

    /**
     * Save recommendation list to cache with bounded LRU maintenance.
     * @param {number|string} tmdbId
     * @param {'movie'|'tv'} mediaType
     * @param {Array<Object>} items
     * @param {boolean} [isFresh=false]
     * @returns {Promise<void>}
     */
    async setCachedRecommendations(tmdbId, mediaType, items, isFresh = false) {
        const numTmdbId = Number(tmdbId);
        if (!numTmdbId || isNaN(numTmdbId) || !Array.isArray(items)) return;

        const normType = (mediaType === 'tv' || mediaType === 'tv-series' || mediaType === 'series') ? 'tv' : 'movie';
        const key = this.getCacheKey(numTmdbId, normType);
        const now = Date.now();

        const entry = {
            schemaVersion: 1,
            tmdbId: numTmdbId,
            mediaType: normType,
            cachedAt: now,
            isFresh: Boolean(isFresh),
            items
        };

        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                await new Promise(resolve => chrome.storage.local.set({ [key]: entry }, resolve));

                // Maintain bounded LRU index
                const indexRes = await new Promise(resolve => chrome.storage.local.get([this.INDEX_KEY], resolve));
                let index = Array.isArray(indexRes?.[this.INDEX_KEY]) ? indexRes[this.INDEX_KEY] : [];

                index = index.filter(it => it && it.key !== key);
                index.push({ key, tmdbId: numTmdbId, mediaType: normType, cachedAt: now });

                if (index.length > this.MAX_CACHED_ENTRIES) {
                    const toRemove = index.slice(0, index.length - this.MAX_CACHED_ENTRIES);
                    index = index.slice(index.length - this.MAX_CACHED_ENTRIES);
                    const keysToRemove = toRemove.map(it => it.key);
                    await new Promise(resolve => chrome.storage.local.remove(keysToRemove, resolve));
                }

                await new Promise(resolve => chrome.storage.local.set({ [this.INDEX_KEY]: index }, resolve));
            } else {
                this._memoryCache.set(key, entry);
                this._memoryIndex = this._memoryIndex.filter(it => it.key !== key);
                this._memoryIndex.push({ key, tmdbId: numTmdbId, mediaType: normType, cachedAt: now });

                if (this._memoryIndex.length > this.MAX_CACHED_ENTRIES) {
                    const toRemove = this._memoryIndex.slice(0, this._memoryIndex.length - this.MAX_CACHED_ENTRIES);
                    this._memoryIndex = this._memoryIndex.slice(this._memoryIndex.length - this.MAX_CACHED_ENTRIES);
                    toRemove.forEach(it => this._memoryCache.delete(it.key));
                }
            }
        } catch (err) {
            console.warn(`[RecommendationService] Cache write error for ${key}:`, err?.message);
        }
    }

    /**
     * Check if a candidate item is semantically compatible with the source entity.
     * Reuses MediaClassifier as the single source of truth.
     * @param {Object} candidate - Normalized TMDB candidate
     * @param {string} sourceSection - 'film' | 'series' | 'cartoon' | 'anime' | 'unknown'
     * @returns {boolean}
     */
    isCompatibleWithSource(candidate, sourceSection) {
        if (!candidate || candidate.adult) return false;

        const classifier = (typeof MediaClassifier !== 'undefined')
            ? MediaClassifier
            : (typeof globalThis !== 'undefined' && globalThis.MediaClassifier ? globalThis.MediaClassifier : null);

        if (!classifier) return true; // Fallback permissive if classifier unbundled

        const candidateSection = classifier.classifyHomeMedia(candidate);

        // 1. Cartoon Source: Must strictly remain non-Japanese Western animation (NO anime leakage)
        if (sourceSection === 'cartoon') {
            return candidateSection === 'cartoon';
        }

        // 2. Anime Source: Japanese anime movies and anime TV series freely cross-recommend
        if (sourceSection === 'anime') {
            return candidateSection === 'anime';
        }

        // 3. Live-Action Film: Recommends films; reject unrequested anime/cartoons
        if (sourceSection === 'film') {
            if (candidateSection === 'anime' || candidateSection === 'cartoon') {
                return false;
            }
            return candidateSection === 'film';
        }

        // 4. Live-Action Series: Recommends series; reject unrequested anime/cartoons
        if (sourceSection === 'series') {
            if (candidateSection === 'anime' || candidateSection === 'cartoon') {
                return false;
            }
            return candidateSection === 'series';
        }

        // Unknown / unclassified source: reject explicit adult/erotica, allow standard
        return candidateSection !== 'unknown';
    }

    /**
     * Check if candidate contains explicit or adult metadata.
     * @param {Object} candidate
     * @returns {boolean}
     */
    isExplicitContent(candidate) {
        if (!candidate) return true;
        if (candidate.adult === true) return true;

        // Check genre IDs for erotica / hentai keywords if present
        const genreIds = Array.isArray(candidate.genreIds) ? candidate.genreIds : (Array.isArray(candidate.genre_ids) ? candidate.genre_ids : []);
        for (const gid of genreIds) {
            if (this.EXPLICIT_KEYWORDS.has(Number(gid))) return true;
        }

        return false;
    }

    /**
     * Get recommendations for a movie or TV series.
     * Orchestrates in-flight deduplication, cache, primary recommendations,
     * deficit fallback to similar, batch mapping with queue bypass, and DTO construction.
     * 
     * @param {Object} sourceMovie - UnifiedMovieDTO, KP movie, or metadata object
     * @param {Object} [options={}]
     * @param {boolean} [options.forceRefresh=false]
     * @param {number} [options.targetCount=10]
     * @param {number} [options.minFallbackThreshold=6]
     * @param {AbortSignal} [options.signal=null]
     * @param {string} [options.language='ru-RU']
     * @returns {Promise<Array<Object>>} Normalized RecommendationDTO array
     */
    async getRecommendationsForMovie(sourceMovie, options = {}) {
        if (!sourceMovie) return [];

        const sourceTmdbId = Number(sourceMovie.tmdbId || (sourceMovie.externalId?.tmdb) || (sourceMovie.id && !sourceMovie.kinopoiskId ? sourceMovie.id : null));
        if (!sourceTmdbId || isNaN(sourceTmdbId) || sourceTmdbId <= 0) {
            return [];
        }

        const sourceKpId = (typeof Utils !== 'undefined' && Utils.extractKinopoiskId)
            ? Utils.extractKinopoiskId(sourceMovie)
            : (Number(sourceMovie.kinopoiskId || sourceMovie.movieId || sourceMovie.id) || null);

        const isSeries = Boolean(
            sourceMovie.isSeries ||
            sourceMovie.mediaType === 'tv' ||
            ['tv-series', 'mini-series', 'animated-series', 'tv', 'tv-show'].includes(sourceMovie.type)
        );
        const normMediaType = isSeries ? 'tv' : 'movie';

        const classifier = (typeof MediaClassifier !== 'undefined')
            ? MediaClassifier
            : (typeof globalThis !== 'undefined' && globalThis.MediaClassifier ? globalThis.MediaClassifier : null);

        const sourceSection = classifier ? classifier.classifyHomeMedia(sourceMovie) : (isSeries ? 'series' : 'film');
        const currentYear = new Date().getFullYear();
        const releaseYear = Number(sourceMovie.year) || 0;
        const isFreshTitle = releaseYear >= (currentYear - 1);

        const forceRefresh = Boolean(options.forceRefresh);
        const targetCount = Number(options.targetCount) || this.TARGET_COUNT;
        const minThreshold = Number(options.minFallbackThreshold) || this.FALLBACK_DEFICIT_THRESHOLD;
        const signal = options.signal || null;
        const language = options.language || 'ru-RU';

        // 1. Check local cache if not forcing refresh
        if (!forceRefresh) {
            const cached = await this.getCachedRecommendations(sourceTmdbId, normMediaType);
            if (cached && Array.isArray(cached) && cached.length > 0) {
                return cached.slice(0, targetCount);
            }
        }

        // 2. In-flight Promise deduplication per `${mediaType}:${tmdbId}`
        const dedupKey = `${normMediaType}:${sourceTmdbId}`;
        if (this.inFlightRequests.has(dedupKey)) {
            return this.inFlightRequests.get(dedupKey);
        }

        const pipelinePromise = (async () => {
            try {
                const tmdb = this.tmdbService || (typeof TMDBService !== 'undefined' ? new TMDBService() : null);
                const idMapper = this.idMappingService || (typeof IdMappingService !== 'undefined' ? new IdMappingService() : null);

                if (!tmdb || !idMapper) {
                    console.warn('[RecommendationService] Required services (TMDBService/IdMappingService) unavailable.');
                    return [];
                }

                const seenTmdbIds = new Set([sourceTmdbId]);
                const seenKpIds = new Set();
                if (sourceKpId) seenKpIds.add(sourceKpId);

                // --- STAGE 1: Primary Recommendations Query ---
                const rawRecommendations = await tmdb.getRecommendations(sourceTmdbId, normMediaType, { language, signal });
                const primaryFiltered = [];

                for (const item of rawRecommendations) {
                    const cTmdbId = Number(item.tmdbId || item.id);
                    if (!cTmdbId || seenTmdbIds.has(cTmdbId)) continue;
                    if (this.isExplicitContent(item)) continue;
                    if (!this.isCompatibleWithSource(item, sourceSection)) continue;

                    seenTmdbIds.add(cTmdbId);
                    primaryFiltered.push({
                        ...item,
                        tmdbId: cTmdbId,
                        mediaType: item.mediaType || normMediaType
                    });
                }

                // Batch resolve primary candidates with strict queue isolation
                const primaryMapping = await idMapper.resolveBatch(primaryFiltered, {
                    skipQueue: true,
                    context: 'recommendations',
                    signal
                });

                const validPrimary = [];
                for (const item of primaryFiltered) {
                    const key = idMapper.buildKey(item.mediaType, item.tmdbId);
                    const mapping = primaryMapping.get(key);
                    const kpId = mapping?.kinopoiskId ? Number(mapping.kinopoiskId) : null;

                    if (kpId && kpId > 0 && !seenKpIds.has(kpId)) {
                        seenKpIds.add(kpId);
                        validPrimary.push(this._createRecommendationDTO(item, kpId, 'TMDB_RECOMMENDATIONS'));
                    }
                }

                let finalResults = [...validPrimary];

                // --- STAGE 2: Similar Deficit Fallback (ONLY if primary < minThreshold) ---
                if (finalResults.length < minThreshold) {
                    const rawSimilar = await tmdb.getSimilar(sourceTmdbId, normMediaType, { language, signal });
                    const similarFiltered = [];

                    for (const item of rawSimilar) {
                        const cTmdbId = Number(item.tmdbId || item.id);
                        if (!cTmdbId || seenTmdbIds.has(cTmdbId)) continue;
                        if (this.isExplicitContent(item)) continue;
                        if (!this.isCompatibleWithSource(item, sourceSection)) continue;

                        seenTmdbIds.add(cTmdbId);
                        similarFiltered.push({
                            ...item,
                            tmdbId: cTmdbId,
                            mediaType: item.mediaType || normMediaType
                        });
                    }

                    if (similarFiltered.length > 0) {
                        const similarMapping = await idMapper.resolveBatch(similarFiltered, {
                            skipQueue: true,
                            context: 'recommendations',
                            signal
                        });

                        const validSimilar = [];
                        for (const item of similarFiltered) {
                            const key = idMapper.buildKey(item.mediaType, item.tmdbId);
                            const mapping = similarMapping.get(key);
                            const kpId = mapping?.kinopoiskId ? Number(mapping.kinopoiskId) : null;

                            if (kpId && kpId > 0 && !seenKpIds.has(kpId)) {
                                seenKpIds.add(kpId);
                                validSimilar.push(this._createRecommendationDTO(item, kpId, 'TMDB_SIMILAR'));
                            }
                        }

                        // Append similar candidates after primary recommendations up to target bound
                        finalResults = [...finalResults, ...validSimilar];
                    }
                }

                // Bound to target count
                const bounded = finalResults.slice(0, targetCount);

                // Save to cache
                if (bounded.length > 0) {
                    await this.setCachedRecommendations(sourceTmdbId, normMediaType, bounded, isFreshTitle);
                }

                return bounded;
            } finally {
                this.inFlightRequests.delete(dedupKey);
            }
        })();

        this.inFlightRequests.set(dedupKey, pipelinePromise);
        return pipelinePromise;
    }

    /**
     * Create a lean, card-renderable Recommendation DTO.
     * @param {Object} candidate - Raw/normalized TMDB candidate
     * @param {number} kinopoiskId - Verified Kinopoisk ID
     * @param {'TMDB_RECOMMENDATIONS'|'TMDB_SIMILAR'} sourceTag
     * @returns {Object} RecommendationDTO
     * @private
     */
    _createRecommendationDTO(candidate, kinopoiskId, sourceTag) {
        const rating = Number(candidate.ratingTmdb) || Number(candidate.vote_average) || 0;
        const voteCount = Number(candidate.voteCount) || Number(candidate.vote_count) || 0;

        return {
            tmdbId: Number(candidate.tmdbId || candidate.id),
            kinopoiskId: Number(kinopoiskId),
            name: candidate.name || candidate.title || '',
            alternativeName: candidate.alternativeName || candidate.original_name || candidate.original_title || '',
            year: Number(candidate.year) || (candidate.releaseDate ? parseInt(candidate.releaseDate, 10) : null),
            posterUrl: candidate.posterUrl || '',
            backdropUrl: candidate.backdrop || candidate.backdropUrl || '',
            ratingTmdb: rating,
            voteCount,
            genreIds: Array.isArray(candidate.genreIds) ? candidate.genreIds : (Array.isArray(candidate.genre_ids) ? candidate.genre_ids : []),
            mediaType: candidate.mediaType || 'movie',
            recommendationSource: sourceTag
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RecommendationService;
}
if (typeof window !== 'undefined') {
    window.RecommendationService = RecommendationService;
}
if (typeof globalThis !== 'undefined') {
    globalThis.RecommendationService = RecommendationService;
}
