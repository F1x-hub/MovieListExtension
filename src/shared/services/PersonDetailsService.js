/**
 * PersonDetailsService - Provider-specific Person Details Data Pipeline.
 * 
 * Responsibilities:
 * - Pure personKey parsing (tmdb:{id} / kp:{id})
 * - In-flight Promise deduplication
 * - 7-day bounded local storage caching with 100-entry LRU index
 * - Provider requests (TMDB /person/{id} single roundtrip, KP /v1.4/person/{id})
 * - Canonical PersonDetailsDTO normalization
 * - Filmography normalization, category mapping, and deduplication
 * - Bounded (max 40) TMDB filmography -> Kinopoisk media ID batch mapping with strict queue isolation (skipQueue: true)
 * - Deterministic Known-For ranking (max 10, verified KP IDs only)
 * - Adult and explicit content filtering
 * - Graceful degradation on mapping failure
 */
class PersonDetailsService {
    /**
     * @param {Object} [dependencies={}]
     */
    constructor(dependencies = {}) {
        this.tmdbService = dependencies.tmdbService || (typeof TMDBService !== 'undefined' ? new TMDBService() : null);
        this.kinopoiskService = dependencies.kinopoiskService || (typeof KinopoiskService !== 'undefined' ? new KinopoiskService() : null);
        this.idMappingService = dependencies.idMappingService || (typeof IdMappingService !== 'undefined' ? new IdMappingService(this.kinopoiskService) : null);
        this.kinopoiskPersonHtmlService = Object.prototype.hasOwnProperty.call(dependencies, 'kinopoiskPersonHtmlService')
            ? dependencies.kinopoiskPersonHtmlService
            : (typeof KinopoiskPersonHtmlService !== 'undefined'
                ? new KinopoiskPersonHtmlService({ kinopoiskService: this.kinopoiskService })
                : null);

        // v2 changes the DTO meaning: artwork and renderability are independent from KP mapping.
        // Keep the v1 namespace untouched so stale DTOs cannot suppress newly available artwork.
        this.CACHE_PREFIX = 'person_details_v2_';
        this.INDEX_KEY = 'person_details_v2_index';
        this.CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
        this.MAX_CACHED_PERSONS = 100;
        this.MAX_MAPPING_CANDIDATES = 40;
        this.MAX_KNOWN_FOR = 10;
        this.MAX_ALIASES = 8;
        this.MAX_FACTS = 20;

        // In-flight Promise deduplication: Map<personKey, Promise<PersonDetailsDTO>>
        this.inFlightRequests = new Map();

        // Memory cache fallback for test/non-extension environments
        this._memoryCache = new Map();
    }

    /**
     * Pure parser and validator for person keys.
     * Accepted format: 'tmdb:{positive_integer}' or 'kp:{positive_integer}'
     * @param {string} personKey
     * @returns {{ personKey: string, provider: 'TMDB'|'KP', providerId: number }}
     * @throws {Error} If key is invalid
     */
    static parsePersonKey(personKey) {
        if (typeof personKey !== 'string') {
            const err = new Error(`Invalid person key: expected string, got ${typeof personKey}`);
            err.code = 'INVALID_PERSON_KEY';
            throw err;
        }

        const trimmed = personKey.trim();
        const parts = trimmed.split(':');

        if (parts.length !== 2) {
            const err = new Error(`Invalid person key format: "${personKey}". Expected "provider:id"`);
            err.code = 'INVALID_PERSON_KEY';
            throw err;
        }

        const providerRaw = parts[0].toLowerCase();
        let provider;
        if (providerRaw === 'tmdb') {
            provider = 'TMDB';
        } else if (providerRaw === 'kp') {
            provider = 'KP';
        } else {
            const err = new Error(`Unsupported person provider: "${parts[0]}". Must be "tmdb" or "kp"`);
            err.code = 'INVALID_PERSON_KEY';
            throw err;
        }

        const idStr = parts[1];
        if (!/^\d+$/.test(idStr)) {
            const err = new Error(`Invalid person ID: "${idStr}". Must be a positive integer`);
            err.code = 'INVALID_PERSON_KEY';
            throw err;
        }

        const providerId = Number(idStr);
        if (!Number.isSafeInteger(providerId) || providerId <= 0) {
            const err = new Error(`Invalid person ID: "${idStr}". Must be > 0`);
            err.code = 'INVALID_PERSON_KEY';
            throw err;
        }

        const canonicalKey = `${provider.toLowerCase()}:${providerId}`;

        return {
            personKey: canonicalKey,
            provider,
            providerId
        };
    }

    /**
     * Resolve the HTML service after deferred page scripts have finished loading.
     * @returns {Object|null}
     * @private
     */
    _ensureKinopoiskPersonHtmlService() {
        if (this.kinopoiskPersonHtmlService) return this.kinopoiskPersonHtmlService;

        const HtmlService = globalThis.KinopoiskPersonHtmlService
            || (typeof KinopoiskPersonHtmlService !== 'undefined' ? KinopoiskPersonHtmlService : null);
        if (typeof HtmlService !== 'function') return null;

        this.kinopoiskPersonHtmlService = new HtmlService({
            kinopoiskService: this.kinopoiskService
        });
        return this.kinopoiskPersonHtmlService;
    }

    /**
     * Primary entrypoint: retrieve normalized PersonDetailsDTO by personKey.
     * @param {string} personKey - e.g. 'tmdb:2710' or 'kp:27977'
     * @param {Object} [options={}] - { forceRefresh, signal, knownKpPersonId, knownTmdbPersonId }
     * @returns {Promise<Object>} Canonical PersonDetailsDTO
     */
    async getPersonDetails(personKey, options = {}) {
        const parsed = PersonDetailsService.parsePersonKey(personKey);
        const normalizedKey = parsed.personKey;

        // In-flight Promise deduplication
        if (this.inFlightRequests.has(normalizedKey)) {
            return this.inFlightRequests.get(normalizedKey);
        }

        const fetchPromise = (async () => {
            try {
                // Check cache if not forcing refresh
                if (!options.forceRefresh) {
                    const cached = await this._readCache(normalizedKey);
                    if (cached) {
                        const htmlService = parsed.provider === 'KP'
                            ? this._ensureKinopoiskPersonHtmlService()
                            : null;
                        if (htmlService && typeof htmlService.getMoviePostersByIds === 'function') {
                            // `knownFor` is serialized as a separate array, so its items no
                            // longer share object references with `filmography` after a cache
                            // round-trip. Enrich both collections in the same lookup pass.
                            const posterCount = await this._applyKinopoiskHtmlPosters(
                                cached.filmography,
                                options,
                                htmlService,
                                cached.knownFor
                            );
                            console.info('[PersonDetails] Kinopoisk HTML posters', {
                                source: 'cached',
                                itemCount: Object.values(cached.filmography || {}).flat().length,
                                posterCount
                            });
                            if (posterCount > 0 && !options.signal?.aborted) {
                                await this._writeCache(normalizedKey, cached);
                            }
                        } else if (parsed.provider === 'KP') {
                            console.warn('[PersonDetails] Kinopoisk HTML poster service unavailable', {
                                source: 'cached',
                                serviceType: typeof htmlService
                            });
                        }
                        return cached;
                    }
                }

                // Execute provider-specific fetch and normalization
                const dto = await this._fetchAndNormalize(parsed, options);

                // Write to cache (only if not aborted)
                if (!options.signal?.aborted) {
                    await this._writeCache(normalizedKey, dto);
                }

                return dto;
            } finally {
                this.inFlightRequests.delete(normalizedKey);
            }
        })();

        this.inFlightRequests.set(normalizedKey, fetchPromise);
        return fetchPromise;
    }

    /**
     * Internal fetch and normalization router based on parsed person key provider.
     * @param {{ personKey: string, provider: 'TMDB'|'KP', providerId: number }} parsed
     * @param {Object} options
     * @returns {Promise<Object>}
     * @private
     */
    async _fetchAndNormalize(parsed, options) {
        if (parsed.provider === 'TMDB') {
            return this._fetchAndNormalizeTmdb(parsed, options);
        } else if (parsed.provider === 'KP') {
            return this._fetchAndNormalizeKp(parsed, options);
        }
        const err = new Error(`Unknown provider: ${parsed.provider}`);
        err.code = 'INVALID_PERSON_KEY';
        throw err;
    }

    /**
     * Fetch from TMDB and normalize into canonical PersonDetailsDTO.
     * @param {{ personKey: string, provider: 'TMDB', providerId: number }} parsed
     * @param {Object} options
     * @returns {Promise<Object>}
     * @private
     */
    async _fetchAndNormalizeTmdb(parsed, options) {
        if (!this.tmdbService) {
            const err = new Error('TMDBService is not configured');
            err.code = 'PROVIDER_ERROR';
            throw err;
        }

        let raw;
        try {
            globalThis.quotaTracker?.track('PersonDetailsService.tmdbFetch', 'network');
            raw = await this.tmdbService.getPersonDetails(parsed.providerId, {
                language: 'ru-RU',
                signal: options.signal
            });
        } catch (fetchErr) {
            if (fetchErr.status === 404) {
                const err = new Error(`Person not found on TMDB: ${parsed.providerId}`);
                err.code = 'PERSON_NOT_FOUND';
                err.status = 404;
                throw err;
            }
            const err = new Error(`TMDB person request failed: ${fetchErr.message}`);
            err.code = 'PROVIDER_ERROR';
            err.status = fetchErr.status || 500;
            throw err;
        }

        if (!raw || typeof raw !== 'object') {
            const err = new Error(`Empty TMDB person response for ID ${parsed.providerId}`);
            err.code = 'PERSON_NOT_FOUND';
            throw err;
        }

        // 1. Identity & Names
        const name = (raw.name || '').trim();
        const originalName = (raw.original_name || raw.name || '').trim() || null;

        const aliases = Array.isArray(raw.also_known_as)
            ? raw.also_known_as
                .map(a => (typeof a === 'string' ? a.trim() : ''))
                .filter(a => a.length > 0 && a !== name && a !== originalName)
                .filter((val, idx, self) => self.indexOf(val) === idx)
                .slice(0, this.MAX_ALIASES)
            : [];

        const photoUrl = raw.profile_path
            ? `https://image.tmdb.org/t/p/h632${raw.profile_path}`
            : null;

        const biography = raw.biography && typeof raw.biography === 'string' && raw.biography.trim().length > 0
            ? raw.biography.trim()
            : null;

        const birthday = raw.birthday && typeof raw.birthday === 'string' && raw.birthday.trim().length > 0
            ? raw.birthday.trim()
            : null;

        const deathday = raw.deathday && typeof raw.deathday === 'string' && raw.deathday.trim().length > 0
            ? raw.deathday.trim()
            : null;

        const birthplace = raw.place_of_birth && typeof raw.place_of_birth === 'string' && raw.place_of_birth.trim().length > 0
            ? raw.place_of_birth.trim()
            : null;

        const knownForDepartment = raw.known_for_department ? String(raw.known_for_department).trim() : null;
        const popularity = typeof raw.popularity === 'number' ? Number(raw.popularity.toFixed(3)) : null;
        const imdbPersonId = raw.external_ids?.imdb_id && typeof raw.external_ids.imdb_id === 'string'
            ? raw.external_ids.imdb_id.trim()
            : null;

        // 2. Filmography Normalization
        const rawCast = Array.isArray(raw.combined_credits?.cast) ? raw.combined_credits.cast : [];
        const rawCrew = Array.isArray(raw.combined_credits?.crew) ? raw.combined_credits.crew : [];

        const filmography = {
            acting: [],
            directing: [],
            writing: [],
            production: [],
            music: [],
            other: []
        };

        // Normalize Cast
        const seenActing = new Set();
        for (const item of rawCast) {
            if (!item || !item.id || item.adult) continue;
            const mediaType = item.media_type === 'tv' ? 'tv' : 'movie';
            const mediaKey = `${mediaType}:${item.id}`;
            if (seenActing.has(mediaKey)) continue;
            seenActing.add(mediaKey);

            filmography.acting.push(this._createFilmographyItem(item, mediaType, 'acting', item.character || 'Actor', 'Acting'));
        }

        // Normalize Crew
        const seenCrewByCategory = {
            directing: new Set(),
            writing: new Set(),
            production: new Set(),
            music: new Set(),
            other: new Set()
        };

        for (const item of rawCrew) {
            if (!item || !item.id || item.adult) continue;
            const mediaType = item.media_type === 'tv' ? 'tv' : 'movie';
            const mediaKey = `${mediaType}:${item.id}`;
            const category = this._mapCrewCategory(item.department, item.job);

            if (seenCrewByCategory[category].has(mediaKey)) continue;
            seenCrewByCategory[category].add(mediaKey);

            filmography[category].push(this._createFilmographyItem(item, mediaType, category, null, item.job || item.department));
        }

        // 3. Collect Unique Media Items across all categories for Bounded Batch Mapping
        const allItemsMap = new Map();
        for (const category of Object.keys(filmography)) {
            for (const item of filmography[category]) {
                const key = `${item.providerMediaType}:${item.tmdbId}`;
                if (!allItemsMap.has(key)) {
                    item.allCategories = new Set([category]);
                    allItemsMap.set(key, item);
                } else {
                    const existing = allItemsMap.get(key);
                    if (existing.allCategories) {
                        existing.allCategories.add(category);
                    } else {
                        existing.allCategories = new Set([existing.category, category]);
                    }
                    if ((item.voteCount || 0) > (existing.voteCount || 0)) {
                        existing.voteCount = item.voteCount;
                    }
                    if ((item.rating || 0) > (existing.rating || 0)) {
                        existing.rating = item.rating;
                    }
                }
            }
        }
        const uniqueMediaList = Array.from(allItemsMap.values());

        // Deterministically rank all unique media candidates to select Top 40 for initial mapping
        uniqueMediaList.sort((a, b) => this._calculateMediaMappingScore(b) - this._calculateMediaMappingScore(a));
        const mappingCandidates = uniqueMediaList.slice(0, this.MAX_MAPPING_CANDIDATES);

        let mappedCount = 0;
        let unmappedCount = 0;

        // 4. Resolve native Kinopoisk IDs from the person HTML first. This avoids
        // one API matching attempt per film when the SSR payload is available.
        let htmlMappingUsed = false;
        const htmlService = this._ensureKinopoiskPersonHtmlService();
        if (htmlService) {
            try {
                const htmlPerson = await htmlService.getPersonFilmography(
                    [raw.name, raw.original_name],
                    { signal: options.signal }
                );
                if (htmlPerson?.items?.length > 0) {
                    const matchedCount = this._applyKinopoiskHtmlMapping(filmography, htmlPerson.items);
                    htmlMappingUsed = true;
                    console.info(`[PersonDetails] Kinopoisk HTML mapping: ${matchedCount} matches from ${htmlPerson.items.length} records`);

                    if (typeof htmlService.findMovieByTitle === 'function') {
                        const titleFallbackCount = await this._applyKinopoiskHtmlTitleMapping(mappingCandidates);
                        console.info(`[PersonDetails] Kinopoisk HTML title fallback: ${titleFallbackCount} additional matches from ${mappingCandidates.length} candidates`);
                    }
                }
            } catch (htmlMappingErr) {
                console.warn(`PersonDetailsService: HTML mapping degraded gracefully for ${parsed.personKey}:`, htmlMappingErr.message);
            }
        }

        // 5. Existing API mapping fallback with Queue Isolation
        if (!htmlMappingUsed && this.idMappingService && mappingCandidates.length > 0) {
            const batchInputs = mappingCandidates.map(c => ({
                id: c.tmdbId,
                tmdbId: c.tmdbId,
                mediaType: c.providerMediaType,
                title: c.name || c.originalName || '',
                originalTitle: c.originalName || c.name || '',
                releaseDate: c.releaseDate,
                year: c.year,
                voteAverage: c.rating,
                voteCount: c.voteCount,
                posterPath: c.posterUrl ? c.posterUrl.replace('https://image.tmdb.org/t/p/w342', '') : null
            }));

            try {
                const mappingMap = await this.idMappingService.resolveBatch(batchInputs, {
                    skipQueue: true,
                    context: 'person-filmography'
                });

                // Apply mapped KP IDs back to all categories in filmography and uniqueMediaList
                for (const category of Object.keys(filmography)) {
                    for (const item of filmography[category]) {
                        const key = (this.idMappingService && typeof this.idMappingService.buildKey === 'function')
                            ? this.idMappingService.buildKey(item.providerMediaType || 'movie', item.tmdbId)
                            : `${item.providerMediaType || 'movie'}:${item.tmdbId}`;
                        const resolved = mappingMap.get(key) || mappingMap.get(item.tmdbId) || mappingMap.get(String(item.tmdbId)) || mappingMap.get(Number(item.tmdbId));
                        if (resolved && resolved.kinopoiskId && Number(resolved.kinopoiskId) > 0) {
                            item.kinopoiskId = Number(resolved.kinopoiskId);
                        }
                        item.hasNavigationTarget = this._hasNavigationTarget(item);
                    }
                }
                for (const item of uniqueMediaList) {
                    const key = (this.idMappingService && typeof this.idMappingService.buildKey === 'function')
                        ? this.idMappingService.buildKey(item.providerMediaType || 'movie', item.tmdbId)
                        : `${item.providerMediaType || 'movie'}:${item.tmdbId}`;
                    const resolved = mappingMap.get(key) || mappingMap.get(item.tmdbId) || mappingMap.get(String(item.tmdbId)) || mappingMap.get(Number(item.tmdbId));
                    if (resolved && resolved.kinopoiskId && Number(resolved.kinopoiskId) > 0) {
                        item.kinopoiskId = Number(resolved.kinopoiskId);
                    }
                    item.hasNavigationTarget = this._hasNavigationTarget(item);
                }
            } catch (mappingErr) {
                // Graceful degradation: media mapping failure does not break core person details
                console.warn(`PersonDetailsService: Batch mapping degraded gracefully for ${parsed.personKey}:`, mappingErr.message);
            }
        }

        // Count mapped and unmapped across unique items
        for (const item of uniqueMediaList) {
            if (item.kinopoiskId && item.kinopoiskId > 0) mappedCount++;
            else unmappedCount++;
        }

        // 6. Select Known-For (Top 10 items with verified Kinopoisk IDs)
        const verifiedCandidates = uniqueMediaList.filter(item => this._isRenderableItem(item) && !item.adult);
        verifiedCandidates.sort((a, b) => this._calculateKnownForScore(b, knownForDepartment) - this._calculateKnownForScore(a, knownForDepartment));
        const knownFor = verifiedCandidates.slice(0, this.MAX_KNOWN_FOR);

        // Derive professions list
        const professions = this._deriveProfessions(filmography, knownForDepartment);

        // Identity verification status
        const isContextVerified = Boolean(
            options.knownKpPersonId &&
            Number(options.knownTmdbPersonId) === parsed.providerId
        );

        return {
            identity: {
                personKey: parsed.personKey,
                provider: 'TMDB',
                providerId: parsed.providerId,
                tmdbPersonId: parsed.providerId,
                kpPersonId: isContextVerified ? Number(options.knownKpPersonId) : null,
                imdbPersonId,
                verificationStatus: isContextVerified ? 'CONTEXT_VERIFIED' : 'PROVIDER_VERIFIED'
            },
            name,
            originalName,
            aliases,
            photoUrl,
            biography,
            facts: [],
            birthday,
            deathday,
            birthplace,
            professions,
            knownForDepartment,
            popularity,
            knownFor,
            filmography,
            _meta: {
                source: 'TMDB',
                fetchedAt: Date.now(),
                mappedCount,
                unmappedCount
            }
        };
    }

    /**
     * Fetch from Kinopoisk and normalize into canonical PersonDetailsDTO.
     * @param {{ personKey: string, provider: 'KP', providerId: number }} parsed
     * @param {Object} options
     * @returns {Promise<Object>}
     * @private
     */
    async _fetchAndNormalizeKp(parsed, options) {
        if (!this.kinopoiskService) {
            const err = new Error('KinopoiskService is not configured');
            err.code = 'PROVIDER_ERROR';
            throw err;
        }

        let raw;
        try {
            raw = await this.kinopoiskService.getPersonDetails(parsed.providerId, {
                signal: options.signal
            });
        } catch (fetchErr) {
            if (fetchErr.status === 404) {
                const err = new Error(`Person not found on Kinopoisk: ${parsed.providerId}`);
                err.code = 'PERSON_NOT_FOUND';
                err.status = 404;
                throw err;
            }
            const err = new Error(`Kinopoisk person request failed: ${fetchErr.message}`);
            err.code = 'PROVIDER_ERROR';
            err.status = fetchErr.status || 500;
            throw err;
        }

        if (!raw || typeof raw !== 'object') {
            const err = new Error(`Empty Kinopoisk person response for ID ${parsed.providerId}`);
            err.code = 'PERSON_NOT_FOUND';
            throw err;
        }

        // 1. Identity & Names
        const name = (raw.name || raw.enName || '').trim();
        const originalName = (raw.enName || '').trim() || null;

        const photoUrl = raw.photo && typeof raw.photo === 'string' && raw.photo.trim().length > 0
            ? raw.photo.trim()
            : null;

        // Facts normalization (HTML stripped, trimmed, bounded)
        const facts = Array.isArray(raw.facts)
            ? raw.facts
                .map(f => (typeof f === 'object' && f?.value ? String(f.value) : String(f)))
                .map(f => this._stripHtml(f).trim())
                .filter(f => f.length > 0)
                .filter((val, idx, self) => self.indexOf(val) === idx)
                .slice(0, this.MAX_FACTS)
            : [];

        const birthday = raw.birthday && typeof raw.birthday === 'string'
            ? raw.birthday.slice(0, 10)
            : null;

        const deathday = raw.death && typeof raw.death === 'string'
            ? raw.death.slice(0, 10)
            : null;

        let birthplace = null;
        if (Array.isArray(raw.birthPlace) && raw.birthPlace.length > 0) {
            birthplace = raw.birthPlace.map(b => (b?.value ? String(b.value).trim() : '')).filter(Boolean).join(', ');
        } else if (typeof raw.birthPlace === 'string' && raw.birthPlace.trim().length > 0) {
            birthplace = raw.birthPlace.trim();
        }

        const professions = Array.isArray(raw.profession)
            ? raw.profession
                .map(p => (typeof p === 'object' && p?.value ? String(p.value).trim() : String(p).trim()))
                .filter(Boolean)
                .filter((val, idx, self) => self.indexOf(val) === idx)
            : [];

        // 2. Filmography Normalization (Native KP IDs — 0 mapping requests needed!)
        const rawMovies = Array.isArray(raw.movies) ? raw.movies : [];

        const filmography = {
            acting: [],
            directing: [],
            writing: [],
            production: [],
            music: [],
            other: []
        };

        const seenKpByCategory = {
            acting: new Set(),
            directing: new Set(),
            writing: new Set(),
            production: new Set(),
            music: new Set(),
            other: new Set()
        };

        for (const item of rawMovies) {
            if (!item || !item.id) continue;
            const kpId = Number(item.id);
            if (!kpId || kpId <= 0) continue;

            const category = this._mapKpProfessionToCategory(item.enProfession || item.profession);
            if (seenKpByCategory[category].has(kpId)) continue;
            seenKpByCategory[category].add(kpId);

            const year = typeof item.year === 'number' ? item.year : null;
            const rating = typeof item.rating === 'number' && item.rating > 0 ? Number(item.rating.toFixed(1)) : null;

            filmography[category].push({
                providerMediaId: kpId,
                providerMediaType: 'movie',
                kinopoiskId: kpId,
                tmdbId: null,
                name: (item.name || item.alternativeName || '').trim(),
                originalName: (item.alternativeName || '').trim() || null,
                character: (item.description || '').trim() || null,
                job: item.enProfession || item.profession || null,
                department: category,
                year,
                releaseDate: year ? `${year}-01-01` : null,
                posterUrl: this._extractKpPosterUrl(item),
                posterSource: this._extractKpPosterUrl(item) ? 'kp' : null,
                hasArtwork: Boolean(this._extractKpPosterUrl(item)),
                hasNavigationTarget: true,
                rating,
                voteCount: null,
                adult: false,
                category
            });
        }

        // Resolve every native KP ID through its individual public movie page.
        // The person API can expose a non-poster promo image, so its artwork
        // must not suppress the authoritative movie-page lookup.
        const htmlService = this._ensureKinopoiskPersonHtmlService();
        if (htmlService && typeof htmlService.getMoviePostersByIds === 'function') {
            try {
                const posterCount = await this._applyKinopoiskHtmlPosters(filmography, options, htmlService);
                console.info('[PersonDetails] Kinopoisk HTML posters', {
                    source: 'fresh',
                    itemCount: Object.values(filmography).flat().length,
                    posterCount
                });
            } catch (posterError) {
                console.warn(`PersonDetailsService: HTML poster enrichment degraded gracefully for ${parsed.personKey}:`, posterError.message);
            }
        } else {
            console.warn('[PersonDetails] Kinopoisk HTML poster service unavailable', {
                source: 'fresh',
                serviceType: typeof htmlService
            });
        }

        // Collect all unique KP items for Known For
        const allKpItemsMap = new Map();
        for (const cat of Object.keys(filmography)) {
            for (const item of filmography[cat]) {
                if (!allKpItemsMap.has(item.kinopoiskId)) {
                    allKpItemsMap.set(item.kinopoiskId, item);
                }
            }
        }
        const uniqueKpItems = Array.from(allKpItemsMap.values());

        // Sort for Known For
        uniqueKpItems.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        const knownFor = uniqueKpItems.slice(0, this.MAX_KNOWN_FOR);

        // Identity verification status
        const isContextVerified = Boolean(
            options.knownTmdbPersonId &&
            Number(options.knownKpPersonId) === parsed.providerId
        );

        return {
            identity: {
                personKey: parsed.personKey,
                provider: 'KP',
                providerId: parsed.providerId,
                tmdbPersonId: isContextVerified ? Number(options.knownTmdbPersonId) : null,
                kpPersonId: parsed.providerId,
                imdbPersonId: null,
                verificationStatus: isContextVerified ? 'CONTEXT_VERIFIED' : 'PROVIDER_VERIFIED'
            },
            name,
            originalName,
            aliases: [],
            photoUrl,
            biography: null, // KP does not provide narrative biography
            facts,
            birthday,
            deathday,
            birthplace,
            professions,
            knownForDepartment: null,
            popularity: null,
            knownFor,
            filmography,
            _meta: {
                source: 'KP',
                fetchedAt: Date.now(),
                mappedCount: uniqueKpItems.length,
                unmappedCount: 0
            }
        };
    }

    /**
     * Enrich KP filmography items by exact native ID using public movie-page HTML.
     * @param {Object<string, Array<Object>>} filmography
     * @param {Object} options
     * @returns {Promise<number>}
     * @private
     */
    async _applyKinopoiskHtmlPosters(filmography, options = {}, htmlService = null, additionalItems = []) {
        if (!filmography || typeof filmography !== 'object') return 0;
        const posterService = htmlService || this._ensureKinopoiskPersonHtmlService();
        if (!posterService || typeof posterService.getMoviePostersByIds !== 'function') return 0;
        const items = [
            ...Object.values(filmography).flat(),
            ...(Array.isArray(additionalItems) ? additionalItems : [])
        ];
        const ids = [...new Set(items
            .map(item => Number(item.kinopoiskId))
            .filter(id => Number.isSafeInteger(id) && id > 0))];
        if (ids.length === 0) return 0;

        const posterMap = await posterService.getMoviePostersByIds(ids, {
            signal: options.signal
        });
        let enrichedCount = 0;
        const enrichedIds = new Set();

        for (const item of items) {
            const id = Number(item.kinopoiskId);
            const posterUrl = posterMap instanceof Map ? posterMap.get(id) : posterMap?.[id];
            if (!this._isValidArtworkUrl(posterUrl)) continue;

            item.posterUrl = posterUrl;
            item.posterSource = 'kp-html';
            item.hasArtwork = true;
            if (!enrichedIds.has(id)) {
                enrichedIds.add(id);
                enrichedCount++;
            }
        }

        return enrichedCount;
    }

    /**
     * Create single standardized FilmographyItemDTO from raw TMDB credit.
     * @private
     */
    _createFilmographyItem(item, mediaType, category, character = null, job = null) {
        const releaseDate = item.release_date || item.first_air_date || null;
        let year = null;
        if (releaseDate && typeof releaseDate === 'string' && releaseDate.length >= 4) {
            const parsedYear = parseInt(releaseDate.slice(0, 4), 10);
            if (!isNaN(parsedYear)) year = parsedYear;
        }

        const name = (item.title || item.name || '').trim();
        const originalName = (item.original_title || item.original_name || '').trim() || null;
        const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null;
        const rating = typeof item.vote_average === 'number' ? Number(item.vote_average.toFixed(1)) : null;
        const voteCount = typeof item.vote_count === 'number' ? item.vote_count : 0;

        return {
            providerMediaId: item.id,
            providerMediaType: mediaType,
            kinopoiskId: null, // Populated after batch mapping
            tmdbId: item.id,
            name,
            originalName,
            character: character ? String(character).trim() : null,
            job: job ? String(job).trim() : null,
            department: item.department || null,
            year,
            releaseDate,
            posterUrl,
            posterSource: posterUrl ? 'tmdb' : null,
            hasArtwork: Boolean(posterUrl),
            hasNavigationTarget: false,
            rating,
            voteCount,
            adult: Boolean(item.adult),
            category
        };
    }

    /**
     * Map TMDB crew department/job to canonical category.
     * @private
     */
    _mapCrewCategory(department, job) {
        const dept = (department || '').toLowerCase();
        const j = (job || '').toLowerCase();

        if (dept === 'directing' || j.includes('director')) return 'directing';
        if (dept === 'writing' || j.includes('writer') || j.includes('screenplay') || j.includes('story')) return 'writing';
        if (dept === 'production' || j.includes('producer')) return 'production';
        if (dept === 'sound' || j.includes('music') || j.includes('composer')) return 'music';
        return 'other';
    }

    /**
     * Accept only provider-supplied absolute HTTP(S) artwork URLs.
     * @private
     */
    _isValidArtworkUrl(value) {
        if (typeof value !== 'string' || value.trim().length === 0) return false;
        try {
            const url = new URL(value.trim());
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
            return false;
        }
    }

    /**
     * KP person movie records currently do not expose artwork, but preserve it if
     * the provider adds one of its documented/observed shapes later.
     * @private
     */
    _extractKpPosterUrl(item) {
        const candidates = [
            item?.poster,
            item?.posterUrl,
            item?.poster?.url,
            item?.poster?.previewUrl,
            item?.cover,
            item?.cover?.url,
            item?.logo,
            item?.logo?.url,
            item?.image,
            item?.image?.url
        ];

        for (const candidate of candidates) {
            const url = typeof candidate === 'string' ? candidate : candidate?.url || candidate?.previewUrl;
            if (this._isValidArtworkUrl(url)) return url.trim();
        }
        return null;
    }

    _hasNavigationTarget(item) {
        return Number(item?.kinopoiskId) > 0;
    }

    _isRenderableItem(item) {
        const hasTitle = Boolean(String(item?.name || item?.originalName || '').trim());
        const hasProviderIdentity = Number(item?.tmdbId) > 0 || Number(item?.providerMediaId) > 0 || this._hasNavigationTarget(item);
        return hasTitle && hasProviderIdentity;
    }

    /**
     * Map KP profession string to canonical category.
     * @private
     */
    _mapKpProfessionToCategory(profession) {
        const prof = (profession || '').toUpperCase();
        if (prof === 'ACTOR' || prof === 'АКТЕР' || prof === 'АКТРИСА') return 'acting';
        if (prof === 'DIRECTOR' || prof === 'РЕЖИССЕР') return 'directing';
        if (prof === 'WRITER' || prof === 'СЦЕНАРИСТ') return 'writing';
        if (prof === 'PRODUCER' || prof === 'ПРОДЮСЕР') return 'production';
        if (prof === 'COMPOSER' || prof === 'КОМПОЗИТОР') return 'music';
        return 'other';
    }

    /**
     * Merge native Kinopoisk IDs from the person HTML payload into TMDB credits.
     * Matching is local and bounded by title plus a one-year release tolerance.
     * @param {Object} filmography
     * @param {Array<Object>} kpItems
     * @returns {number} Number of TMDB items enriched with a KP ID
     * @private
     */
    _applyKinopoiskHtmlMapping(filmography, kpItems) {
        const byTitleAndYear = new Map();
        const byTitle = new Map();

        for (const kpItem of kpItems) {
            const titles = [kpItem.name, kpItem.originalName]
                .map(title => this._normalizeTitle(title))
                .filter(Boolean);
            if (titles.length === 0) continue;

            for (const title of titles) {
                byTitle.set(title, kpItem);
                if (kpItem.year) {
                    byTitleAndYear.set(`${title}|${kpItem.year}`, kpItem);
                }
            }
        }

        let matchedCount = 0;
        const matchedTmdbIds = new Set();

        for (const categoryItems of Object.values(filmography)) {
            for (const tmdbItem of categoryItems) {
                const titles = [tmdbItem.name, tmdbItem.originalName]
                    .map(title => this._normalizeTitle(title))
                    .filter(Boolean);
                let match = null;

                for (const title of titles) {
                    const year = Number(tmdbItem.year);
                    if (year) {
                        match = byTitleAndYear.get(`${title}|${year}`)
                            || byTitleAndYear.get(`${title}|${year - 1}`)
                            || byTitleAndYear.get(`${title}|${year + 1}`);
                    }
                    if (!match) match = byTitle.get(title);
                    if (match) break;
                }

                if (!match?.kinopoiskId) {
                    tmdbItem.hasNavigationTarget = this._hasNavigationTarget(tmdbItem);
                    continue;
                }

                tmdbItem.kinopoiskId = Number(match.kinopoiskId);
                tmdbItem.hasNavigationTarget = this._hasNavigationTarget(tmdbItem);
                if (!matchedTmdbIds.has(tmdbItem.tmdbId)) {
                    matchedTmdbIds.add(tmdbItem.tmdbId);
                    matchedCount++;
                }
            }
        }

        return matchedCount;
    }

    /**
     * Resolve the remaining high-priority TMDB credits through Kinopoisk HTML
     * search. This is deliberately bounded to the same 40 candidates that the
     * old API mapper considered, and never invokes IdMappingService.
     * @param {Array<Object>} candidates
     * @returns {Promise<number>}
     * @private
     */
    async _applyKinopoiskHtmlTitleMapping(candidates) {
        const htmlService = this._ensureKinopoiskPersonHtmlService();
        if (!htmlService || typeof htmlService.findMovieByTitle !== 'function') return 0;
        const unresolved = candidates.filter(item => !this._hasNavigationTarget(item));
        if (unresolved.length === 0) return 0;

        let nextIndex = 0;
        let matchedCount = 0;
        const worker = async () => {
            while (nextIndex < unresolved.length) {
                const item = unresolved[nextIndex++];
                const match = await htmlService.findMovieByTitle(
                    [item.name, item.originalName],
                    item.year
                );
                if (!match?.kinopoiskId) continue;

                item.kinopoiskId = Number(match.kinopoiskId);
                item.hasNavigationTarget = this._hasNavigationTarget(item);
                matchedCount++;
                console.log('[PersonDetails] Kinopoisk HTML title match', {
                    title: item.name || item.originalName || null,
                    year: item.year || null,
                    kinopoiskId: item.kinopoiskId
                });
            }
        };

        const workerCount = Math.min(4, unresolved.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return matchedCount;
    }

    _normalizeTitle(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('ru-RU')
            .replace(/ё/g, 'е')
            .replace(/[^\p{L}\p{N}]+/gu, '');
    }

    /**
     * Calculate pure deterministic score for selecting Top 40 TMDB media items for batch mapping.
     * @private
     */
    _calculateMediaMappingScore(item) {
        if (item.adult) return -1000;
        let score = 0;
        const votes = item.voteCount || 0;
        if (votes > 0) {
            score += Math.log10(votes + 1) * 20;
        }
        score += (item.rating || 0) * 2;
        if (item.category === 'acting' || item.category === 'directing' || item.category === 'writing') {
            score += 10;
        }
        if (item.year && item.year > 0) {
            score += 5;
        }
        return score;
    }

    /**
     * Calculate pure deterministic score for selecting Top 10 Known-For items.
     * @private
     */
    _calculateKnownForScore(item, primaryDepartment = null) {
        let roleWeight = 1.0;
        const categories = item.allCategories || new Set([item.category]);

        if (primaryDepartment) {
            const dept = primaryDepartment.toLowerCase();
            if (dept === 'directing' && categories.has('directing')) roleWeight = 1.3;
            else if (dept === 'acting' && categories.has('acting')) roleWeight = 1.3;
            else if (dept === 'writing' && categories.has('writing')) roleWeight = 1.3;
            else if (dept === 'sound' && categories.has('music')) roleWeight = 1.3;
            else if (dept === 'production' && categories.has('production')) roleWeight = 1.2;
        } else {
            if (categories.has('directing') || categories.has('acting')) roleWeight = 1.2;
        }

        const votes = item.voteCount || 0;
        const voteScore = votes > 0 ? Math.log10(votes + 1) : 0;
        const ratingScore = item.rating || 5.0;

        return voteScore * ratingScore * roleWeight;
    }

    /**
     * Derive distinct localized Russian professions from filmography categories.
     * @private
     */
    _deriveProfessions(filmography, knownForDepartment) {
        const order = ['directing', 'acting', 'writing', 'production', 'music', 'other'];
        const labelMap = {
            directing: 'Режиссёр',
            acting: 'Актёр',
            writing: 'Сценарист',
            production: 'Продюсер',
            music: 'Композитор',
            other: 'Кинематографист'
        };

        const result = [];
        // Put knownForDepartment first if matched
        if (knownForDepartment) {
            const dept = knownForDepartment.toLowerCase();
            if (dept === 'directing' && filmography.directing.length > 0) result.push('Режиссёр');
            else if (dept === 'acting' && filmography.acting.length > 0) result.push('Актёр');
            else if (dept === 'writing' && filmography.writing.length > 0) result.push('Сценарист');
            else if (dept === 'production' && filmography.production.length > 0) result.push('Продюсер');
            else if (dept === 'sound' && filmography.music.length > 0) result.push('Композитор');
        }

        for (const cat of order) {
            if (filmography[cat].length > 0 && !result.includes(labelMap[cat])) {
                result.push(labelMap[cat]);
            }
        }

        return result.length > 0 ? result : ['Кинематографист'];
    }

    /**
     * Pure HTML tag stripper without DOM dependencies.
     * @private
     */
    _stripHtml(text) {
        if (!text || typeof text !== 'string') return '';
        return text
            .replace(/<[^>]*>/g, '')
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&laquo;/g, '«')
            .replace(/&raquo;/g, '»')
            .replace(/&#039;/g, "'");
    }

    // ==========================================
    // CACHE INFRASTRUCTURE (chrome.storage.local)
    // ==========================================

    /**
     * Read cached PersonDetailsDTO from chrome.storage.local.
     * @param {string} personKey - e.g. 'tmdb:2710'
     * @returns {Promise<Object|null>}
     * @private
     */
    async _readCache(personKey) {
        const storageKey = `${this.CACHE_PREFIX}${personKey.replace(':', '_')}`;
        try {
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                const result = await chrome.storage.local.get(storageKey);
                const entry = result[storageKey];
                if (!entry || typeof entry !== 'object') return null;

                if (Date.now() - entry.timestamp > this.CACHE_TTL) {
                    // Expired
                    await chrome.storage.local.remove(storageKey);
                    return null;
                }
                return entry.data || null;
            } else {
                // Memory fallback
                const entry = this._memoryCache.get(storageKey);
                if (!entry) return null;
                if (Date.now() - entry.timestamp > this.CACHE_TTL) {
                    this._memoryCache.delete(storageKey);
                    return null;
                }
                return entry.data || null;
            }
        } catch (err) {
            console.warn(`PersonDetailsService: cache read failed for ${personKey}:`, err.message);
            return null;
        }
    }

    /**
     * Write PersonDetailsDTO to chrome.storage.local with LRU management.
     * @param {string} personKey
     * @param {Object} data
     * @returns {Promise<void>}
     * @private
     */
    async _writeCache(personKey, data) {
        const storageKey = `${this.CACHE_PREFIX}${personKey.replace(':', '_')}`;
        const entry = {
            data,
            timestamp: Date.now()
        };

        try {
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                await chrome.storage.local.set({ [storageKey]: entry });
                await this._updateLruIndex(storageKey);
            } else {
                this._memoryCache.set(storageKey, entry);
            }
        } catch (err) {
            console.warn(`PersonDetailsService: cache write failed for ${personKey}:`, err.message);
        }
    }

    /**
     * Maintain LRU index and evict oldest entry if exceeding MAX_CACHED_PERSONS.
     * @param {string} newKey
     * @returns {Promise<void>}
     * @private
     */
    async _updateLruIndex(newKey) {
        try {
            const indexResult = await chrome.storage.local.get(this.INDEX_KEY);
            let index = Array.isArray(indexResult[this.INDEX_KEY]) ? indexResult[this.INDEX_KEY] : [];

            // Move newKey to end
            index = index.filter(k => k !== newKey);
            index.push(newKey);

            // Evict if exceeding limit
            if (index.length > this.MAX_CACHED_PERSONS) {
                const excess = index.length - this.MAX_CACHED_PERSONS;
                const keysToRemove = index.slice(0, excess);
                index = index.slice(excess);

                await chrome.storage.local.remove(keysToRemove);
            }

            await chrome.storage.local.set({ [this.INDEX_KEY]: index });
        } catch (err) {
            console.warn('PersonDetailsService: LRU index update failed:', err.message);
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PersonDetailsService;
}
if (typeof window !== 'undefined') {
    window.PersonDetailsService = PersonDetailsService;
}
