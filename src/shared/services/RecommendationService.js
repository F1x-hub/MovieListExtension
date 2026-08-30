/**
 * RecommendationService - Orchestrates Discovery & Recommendations for MovieDetails
 * 
 * Pipeline:
 *  1. In-flight Promise deduplication per `${mediaType}:${tmdbId}`.
 *  2. Multi-tier Local Cache (`movie_recommendations_v1_{tmdbId}_{mediaType}`) with bounded LRU eviction (max 100).
 *  3. Kinopoisk `/like/` browser parser as the quota-free primary source.
 *  4. TMDB `/recommendations` primary query (fallback when the parser is unavailable).
 *  5. Strict semantic, adult, and self-identity filtering.
 *  6. Batch KP ID mapping via IdMappingService with explicit admin queue bypass (`skipQueue: true`).
 *  7. Kinopoisk identity verification (`kinopoiskId > 0`).
 *  8. On-demand TMDB `/similar` deficit fallback ONLY when valid primary recommendations < 6.
 *  9. Output bounded, normalized RecommendationDTO array (target 10 items).
 * 
 * INVARIANTS:
 *  - Parser-first path uses one browser-context HTML request and zero KP API calls.
 *  - ZERO N+1 KP details/movie lookups (cards render from parsed metadata + KP ID).
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
        this.kinopoiskService = options.kinopoiskService || null;

        this.CACHE_PREFIX = 'movie_recommendations_v1_';
        this.INDEX_KEY = 'movie_recommendations_index_v1';
        // Bump when the cached DTO contract changes. Version 2 invalidates
        // previously cached low-resolution Kinopoisk poster URLs immediately.
        this.CACHE_SCHEMA_VERSION = 2;
        this.MAX_CACHED_ENTRIES = 100;
        this.DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days for catalog
        this.FRESH_TTL_MS = 3 * 24 * 60 * 60 * 1000;    // 3 days for fresh/current-year titles
        this.TARGET_COUNT = 10;
        this.FALLBACK_DEFICIT_THRESHOLD = 6;

        // In-flight deduplication map: `${mediaType}:${tmdbId}` -> Promise
        this.inFlightRequests = new Map();
        this.traceSequence = 0;

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
            if (entry.schemaVersion !== this.CACHE_SCHEMA_VERSION || entry.tmdbId !== numTmdbId) return null;
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
            schemaVersion: this.CACHE_SCHEMA_VERSION,
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
        const parserTimeoutMs = Math.max(1000, Number(options.parserTimeoutMs) || 3500);
        const mappingCandidateLimit = Math.max(targetCount, minThreshold);
        const mappingFallbackLimit = Math.max(0, Math.min(4, minThreshold));
        const traceId = `rec-${sourceTmdbId}-${Date.now().toString(36)}-${++this.traceSequence}`;
        const traceStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        const traceNow = () => typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        const trace = (stage, details = {}) => {
            console.info('[RecommendationTrace]', {
                traceId,
                movieId: sourceTmdbId,
                stage,
                elapsedMs: Math.max(0, Math.round(traceNow() - traceStartedAt)),
                ...details
            });
        };

        trace('start', {
            mediaType: normMediaType,
            targetCount,
            minThreshold,
            mappingCandidateLimit,
            mappingFallbackLimit
        });

        // 1. Check local cache if not forcing refresh
        if (!forceRefresh) {
            const cached = await this.getCachedRecommendations(sourceTmdbId, normMediaType);
            if (cached && Array.isArray(cached) && cached.length > 0) {
                trace('cache:hit', { resultCount: Math.min(cached.length, targetCount) });
                return cached.slice(0, targetCount);
            }
            trace('cache:miss');
        }

        // 2. In-flight Promise deduplication per `${mediaType}:${tmdbId}`
        const dedupKey = `${normMediaType}:${sourceTmdbId}`;
        if (this.inFlightRequests.has(dedupKey)) {
            trace('in-flight:reuse');
            return this.inFlightRequests.get(dedupKey);
        }

        const pipelinePromise = (async () => {
            try {
                const tmdb = this.tmdbService || (typeof TMDBService !== 'undefined' ? new TMDBService() : null);
                const idMapper = this.idMappingService || (typeof IdMappingService !== 'undefined' ? new IdMappingService() : null);

                const seenTmdbIds = new Set([sourceTmdbId]);
                const seenKpIds = new Set();
                if (sourceKpId) seenKpIds.add(sourceKpId);

                // --- STAGE 0: Quota-free Kinopoisk /like/ Parser ---
                const kinopoisk = this.kinopoiskService
                    || (typeof firebaseManager !== 'undefined' && firebaseManager?.getKinopoiskService?.())
                    || (typeof window !== 'undefined' && window.firebaseManager?.getKinopoiskService?.())
                    || null;
                if (kinopoisk && sourceKpId && typeof kinopoisk.scrapeSimilarMoviesOffscreen === 'function') {
                    trace('parser:request:start', {
                        kinopoiskId: sourceKpId,
                        source: 'kinopoisk-like'
                    });
                    const parsed = await kinopoisk.scrapeSimilarMoviesOffscreen(sourceKpId, {
                        mediaType: normMediaType,
                        timeoutMs: parserTimeoutMs,
                        queueDeadlineMs: parserTimeoutMs,
                        requestKey: `recommendations:${normMediaType}:${sourceKpId}`,
                        traceId,
                        signal
                    });
                    const parsedCandidates = Array.isArray(parsed)
                        ? parsed
                            .filter(candidate => candidate && Number(candidate.kinopoiskId) > 0)
                            .filter(candidate => Number(candidate.kinopoiskId) !== Number(sourceKpId))
                            .filter(candidate => !this.isExplicitContent(candidate))
                            .filter(candidate => {
                                const candidateMediaType = candidate.mediaType === 'tv' || candidate.type === 'series'
                                    ? 'tv'
                                    : 'movie';
                                if (sourceSection === 'film' || (sourceSection === 'unknown' && normMediaType === 'movie')) {
                                    return candidateMediaType === 'movie';
                                }
                                if (sourceSection === 'series' || (sourceSection === 'unknown' && normMediaType === 'tv')) {
                                    return candidateMediaType === 'tv';
                                }
                                return this.isCompatibleWithSource({ ...candidate, mediaType: candidateMediaType }, sourceSection);
                            })
                            .filter((candidate, index, list) => list.findIndex(item => Number(item.kinopoiskId) === Number(candidate.kinopoiskId)) === index)
                        : [];
                    trace('parser:request:end', {
                        rawItemCount: Array.isArray(parsed) ? parsed.length : 0,
                        compatibleCount: parsedCandidates.length
                    });

                    const parserMinimum = Math.min(targetCount, 4);
                    if (parsedCandidates.length >= parserMinimum) {
                        const parserResults = parsedCandidates
                            .slice(0, targetCount)
                            .map((candidate, index) => this._createParsedRecommendationDTO(candidate, index));
                        await this.setCachedRecommendations(sourceTmdbId, normMediaType, parserResults, isFreshTitle);
                        trace('parser:complete', {
                            resultCount: parserResults.length,
                            apiQuotaRequests: 0
                        });
                        return parserResults;
                    }

                    trace('parser:insufficient', {
                        parserMinimum,
                        compatibleCount: parsedCandidates.length,
                        fallback: 'tmdb'
                    });
                }

                if (!tmdb || !idMapper) {
                    console.warn('[RecommendationService] Required services (TMDB/IdMapping) unavailable after parser attempt.');
                    trace('unavailable');
                    return [];
                }

                // --- STAGE 1: Primary Recommendations Query ---
                trace('primary:request:start');
                const rawRecommendations = await tmdb.getRecommendations(sourceTmdbId, normMediaType, { language, signal });
                trace('primary:request:end', { candidateCount: rawRecommendations.length });
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
                const primaryMappingCandidates = primaryFiltered.slice(0, mappingCandidateLimit);
                trace('primary:mapping:start', { candidateCount: primaryMappingCandidates.length });
                const primaryMapping = await idMapper.resolveBatch(primaryMappingCandidates, {
                    skipQueue: true,
                    context: 'recommendations',
                    signal,
                    fastPath: true,
                    maxFallbackCandidates: mappingFallbackLimit
                });
                trace('primary:mapping:end', {
                    resolvedCount: [...primaryMapping.values()].filter(item => item?.status === 'resolved').length,
                    resultCount: primaryMapping.size
                });

                const validPrimary = [];
                for (const item of primaryMappingCandidates) {
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
                    trace('similar:request:start', { primaryResultCount: finalResults.length });
                    const rawSimilar = await tmdb.getSimilar(sourceTmdbId, normMediaType, { language, signal });
                    trace('similar:request:end', { candidateCount: rawSimilar.length });
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
                        const similarMappingCandidates = similarFiltered.slice(0, mappingCandidateLimit);
                        trace('similar:mapping:start', { candidateCount: similarMappingCandidates.length });
                        const similarMapping = await idMapper.resolveBatch(similarMappingCandidates, {
                            skipQueue: true,
                            context: 'recommendations',
                            signal,
                            fastPath: true,
                            maxFallbackCandidates: mappingFallbackLimit
                        });
                        trace('similar:mapping:end', {
                            resolvedCount: [...similarMapping.values()].filter(item => item?.status === 'resolved').length,
                            resultCount: similarMapping.size
                        });

                        const validSimilar = [];
                        for (const item of similarMappingCandidates) {
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

                trace('complete', { resultCount: bounded.length });
                return bounded;
            } catch (error) {
                trace('error', {
                    errorName: error?.name || 'Error',
                    errorMessage: error?.message || String(error)
                });
                throw error;
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

    /**
     * Convert a Kinopoisk /like/ parser item into the card DTO without forcing
     * a TMDB or Kinopoisk API lookup for every recommendation.
     * @param {Object} candidate
     * @param {number} sourcePosition
     * @returns {Object}
     * @private
     */
    _createParsedRecommendationDTO(candidate, sourcePosition) {
        const kpId = Number(candidate.kinopoiskId);
        const mediaType = candidate.mediaType === 'tv' || candidate.type === 'series' ? 'tv' : 'movie';
        const genres = Array.isArray(candidate.genres) ? candidate.genres.filter(Boolean) : [];

        return {
            tmdbId: null,
            kinopoiskId: kpId,
            name: candidate.name || '',
            alternativeName: candidate.alternativeName || candidate.originalTitle || '',
            year: Number(candidate.year) || null,
            posterUrl: candidate.posterUrl || '',
            backdropUrl: '',
            ratingTmdb: 0,
            ratingKp: Number(candidate.kpRating) || 0,
            kpRating: Number(candidate.kpRating) || 0,
            imdbRating: Number(candidate.imdbRating) || 0,
            kpVotes: Number(candidate.kpVotes) || 0,
            imdbVotes: Number(candidate.imdbVotes) || 0,
            voteCount: Number(candidate.kpVotes) || 0,
            genreIds: [],
            genres,
            mediaType,
            sourcePosition: Number.isInteger(candidate.sourcePosition) ? candidate.sourcePosition : sourcePosition,
            recommendationSource: 'KINOPOISK_LIKE_PARSER'
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
