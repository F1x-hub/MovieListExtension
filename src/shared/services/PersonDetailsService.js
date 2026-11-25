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
 * - Kinopoisk films' posters, years, types and votes in one batch request (250 films)
 * - Bounded (max 40) TMDB filmography -> Kinopoisk media ID batch mapping with strict queue isolation (skipQueue: true)
 * - Deterministic Known-For ranking (max 10, any valid provider identity)
 * - Adult and explicit content filtering
 * - Graceful degradation on mapping failure
 */
class PersonDetailsService {
    static CATEGORIES = ['acting', 'directing', 'writing', 'production', 'music', 'self', 'other'];

    // A credit in which the person plays themselves: «Self», «Himself - Host»,
    // «Играет самого себя». Talk shows, ceremonies and documentaries.
    static SELF_ROLE = /^\s*(?:self|him\s*self|her\s*self|them\s*sel(?:f|ves))\b|^\s*(?:играет\s+)?(?:сам(?:ого|у|а)?|самих)\s+себя/i;

    // TMDB genres of documentaries, news, reality and talk shows: a credit there
    // without a character is the person appearing as themselves.
    static SELF_GENRE_IDS = new Set([99, 10763, 10764, 10767]);

    // Kinopoisk's person API lists films without poster, year, type and votes; one batch
    // request gives them for 250. A cached Kinopoisk DTO without this marker
    // (`_meta.filmDetailsVersion`) gets them once when it is next read.
    static FILM_DETAILS_VERSION = 1;
    static FILM_BATCH_SIZE = 250;

    // Facts whose HTML entities are decoded (`_meta.factsVersion`); a cached person
    // without the marker has them decoded once when it is next read.
    static FACTS_VERSION = 1;
    static HTML_ENTITIES = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', laquo: '«', raquo: '»',
        ldquo: '“', rdquo: '”', bdquo: '„', lsquo: '‘', rsquo: '’', ndash: '–', mdash: '—', hellip: '…',
        middot: '·', bull: '•', deg: '°', copy: '©', reg: '®', trade: '™', shy: ''
    };

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

        // v3 adds characters, jobs and episode counts per title, the «self» category and
        // the type and year of Kinopoisk films; a v2 DTO lacks them, so it is not read.
        this.CACHE_PREFIX = 'person_details_v3_';
        this.INDEX_KEY = 'person_details_v3_index';
        this.LEGACY_INDEX_KEYS = ['person_details_v2_index'];
        this.CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
        this.MAX_CACHED_PERSONS = 100;
        this.MAX_MAPPING_CANDIDATES = 40;
        this.MAX_KNOWN_FOR = 10;
        this.MAX_ALIASES = 8;
        this.MAX_FACTS = 20;
        // The batch arrives in about a second, so the page waits for it and renders once;
        // a slower answer goes into the rendered page.
        this.FILM_BATCH_WAIT_MS = 2500;
        // Batches still running after the wait: DTO -> { ids, promise }.
        this.pendingFilmBatches = new WeakMap();
        // The copy an enrichment works on: DTO -> copy.
        this.enrichmentCopies = new WeakMap();
        this.roleBatches = new Map();

        // In-flight Promise deduplication: Map<personKey, Promise<PersonDetailsDTO>>
        this.inFlightRequests = new Map();
        this.inFlightSignals = new Map();

        // Memory cache fallback for test/non-extension environments
        this._memoryCache = new Map();
    }

    /**
     * The Kinopoisk ID of the person a name search found, when it is the TMDB person:
     * both birthdays are known and the same day. A shared name alone decides nothing.
     * @param {Object} dto - TMDB PersonDetailsDTO
     * @param {Object|null} htmlPerson - KinopoiskPersonHtmlService.parsePersonPageHtml result
     * @returns {number|null}
     */
    static matchKinopoiskPerson(dto, htmlPerson) {
        const id = Number(htmlPerson?.personId);
        if (!Number.isSafeInteger(id) || id <= 0) return null;
        const day = value => (String(value || '').match(/^\d{4}-\d{2}-\d{2}/) || [])[0] || null;
        const tmdbBirthday = day(dto?.birthday);
        return tmdbBirthday && tmdbBirthday === day(htmlPerson.birthday) ? id : null;
    }

    /**
     * Names to find a TMDB person on Kinopoisk by, the search text first. Kinopoisk
     * shows a Russian person under the Russian name, which TMDB's Latin spelling
     * («Konstantin Khabensky») does not match, so a Cyrillic alias leads when TMDB
     * has one; the others still match the result.
     * @param {Object} dto - TMDB PersonDetailsDTO
     * @returns {string[]}
     */
    static kinopoiskSearchNames(dto) {
        const names = [...new Set([dto?.name, dto?.originalName, ...(Array.isArray(dto?.aliases) ? dto.aliases : [])]
            .map(name => String(name || '').trim())
            .filter(Boolean))];
        const cyrillic = names.find(name => /[а-яё]/i.test(name));
        return cyrillic ? [cyrillic, ...names.filter(name => name !== cyrillic)] : names;
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
        if (this.inFlightRequests.has(normalizedKey) && !this.inFlightSignals.get(normalizedKey)?.aborted) {
            return this.inFlightRequests.get(normalizedKey);
        }

        const fetchPromise = (async () => {
            try {
                // Check cache if not forcing refresh
                if (!options.forceRefresh) {
                    const cached = await this._readCache(normalizedKey);
                    if (cached) {
                        cached.identity.personKey = normalizedKey;
                        cached._meta ||= {};
                        const factsDecoded = this._decodeCachedFacts(cached);
                        if ((await this._ensureFilmDetails(cached, options) || factsDecoded) && !options.signal?.aborted) {
                            await this._writeCache(normalizedKey, cached);
                        }
                        return cached;
                    }
                }

                // Execute provider-specific fetch and normalization
                const dto = await this._fetchAndNormalize(parsed, options);

                dto._meta.enrichment = { version: 1, status: 'pending' };
                await this._ensureFilmDetails(dto, options);

                // Write to cache (only if not aborted)
                if (!options.signal?.aborted) {
                    await this._writeCache(normalizedKey, dto);
                }

                return dto;
            } finally {
                if (this.inFlightRequests.get(normalizedKey) === fetchPromise) {
                    this.inFlightRequests.delete(normalizedKey);
                    this.inFlightSignals.delete(normalizedKey);
                }
            }
        })();

        this.inFlightRequests.set(normalizedKey, fetchPromise);
        this.inFlightSignals.set(normalizedKey, options.signal);
        return fetchPromise;
    }

    /**
     * Background enrichment; the base DTO is already usable and cached as pending.
     * Only a completed current-version enrichment can suppress later network work.
     */
    async enrichPersonDetails(dto, options = {}) {
        const pendingFilms = this.pendingFilmBatches.get(dto) || null;
        if (!pendingFilms && dto._meta?.enrichment?.version === 1 && dto._meta.enrichment.status === 'complete') return dto;
        const controller = new AbortController();
        const abort = () => controller.abort(options.signal?.reason);
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => controller.abort(new DOMException('Person enrichment deadline', 'TimeoutError')), options.timeoutMs ?? 10000);
        const signal = controller.signal;
        // Mutate a working copy so late provider completion cannot touch the visible DTO.
        const work = JSON.parse(JSON.stringify(dto));
        work._meta ||= {};
        this.enrichmentCopies.set(dto, work);
        const publish = () => {
            if (signal.aborted) return;
            dto.filmography = work.filmography;
            dto.knownFor = work.knownFor;
            dto._meta = work._meta;
            options.onUpdate?.(dto);
        };
        let rejectAbort;
        const cancelled = new Promise((_, reject) => {
            rejectAbort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
            if (signal.aborted) rejectAbort();
            else signal.addEventListener('abort', rejectAbort, { once: true });
        });
        try {
            await Promise.race([
                this._enrichPerson(work, { signal, onUpdate: publish, pendingFilms }),
                cancelled
            ]);
            if (signal.aborted) throw signal.reason;
            work._meta.enrichment = { version: 1, status: 'complete' };
            publish();
        } catch (error) {
            controller.abort(error);
            dto._meta.enrichment = { version: 1, status: 'partial' };
            console.warn('[PersonDetails] Background enrichment incomplete:', error?.message || error);
        } finally {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
            signal.removeEventListener('abort', rejectAbort);
            this.enrichmentCopies.delete(dto);
            this.pendingFilmBatches.delete(dto);
        }
        if (!options.signal?.aborted) await this._writeCache(dto.identity.personKey, dto);
        return dto;
    }

    async _enrichPerson(dto, options) {
        if (options.signal.aborted) throw options.signal.reason;
        const filmography = dto.filmography || {};
        if (dto.identity.provider === 'KP') {
            if (options.pendingFilms) {
                try {
                    this._applyFilmDetails(dto, options.pendingFilms.ids, await options.pendingFilms.promise);
                    options.onUpdate?.();
                } catch (error) {
                    console.warn('[PersonDetails] Kinopoisk film batch failed:', error?.message || error);
                }
            }
            const batched = this._hasFilmDetails(dto);
            const htmlService = this._ensureKinopoiskPersonHtmlService();
            if (!batched && !htmlService?.getMoviePostersByIds) throw new Error('Kinopoisk HTML poster service unavailable');
            // The person's own Kinopoisk page has the characters of its first 50 films
            // (one request), and their posters, years and types when the batch failed.
            if (typeof htmlService?.getPersonFilmographyById === 'function') {
                const page = await htmlService.getPersonFilmographyById(dto.identity.kpPersonId || dto.identity.providerId, { signal: options.signal });
                if (options.signal.aborted) throw options.signal.reason;
                const details = new Map((page?.items || [])
                    .map(item => [Number(item.kinopoiskId), {
                        year: item.year,
                        mediaType: item.providerMediaType,
                        posterUrl: item.posterUrl,
                        character: PersonDetailsService.kinopoiskCharacters(item)
                    }]));
                if (this._applyKinopoiskFilmDetails([...Object.values(filmography).flat(), ...(dto.knownFor || [])], details)) {
                    options.onUpdate?.();
                }
            }
            // Without the batch (quota, network), film pages give posters one by one.
            if (!batched) await this._applyKinopoiskHtmlPosters(filmography, options, htmlService, dto.knownFor);
            return;
        }

        const mediaKey = item => `${item.providerMediaType || 'movie'}:${item.tmdbId}`;
        const unique = new Map();
        for (const item of Object.values(filmography).flat()) {
            if (!unique.has(mediaKey(item))) unique.set(mediaKey(item), item);
        }
        const uniqueMediaList = [...unique.values()];
        uniqueMediaList.sort((a, b) => this._calculateMediaMappingScore(b) - this._calculateMediaMappingScore(a));
        const mappingCandidates = uniqueMediaList.slice(0, this.MAX_MAPPING_CANDIDATES);
        if (!mappingCandidates.length) return;
        const publish = () => {
            if (options.signal.aborted) return;
            // Category entries and cached Known-For entries have independent references.
            for (const item of [...Object.values(filmography).flat(), ...(dto.knownFor || [])]) {
                const mapped = unique.get(mediaKey(item));
                if (mapped?.kinopoiskId) item.kinopoiskId = mapped.kinopoiskId;
                if (mapped?.characterLocal && mapped.category === item.category) item.characterLocal = mapped.characterLocal;
                item.hasNavigationTarget = this._hasNavigationTarget(item);
            }
            dto._meta.mappedCount = uniqueMediaList.filter(item => this._hasNavigationTarget(item)).length;
            dto._meta.unmappedCount = uniqueMediaList.length - dto._meta.mappedCount;
            options.onUpdate?.();
        };

        // Preserve existing matching rules and queue isolation; all discovery is background work.
        const htmlService = this._ensureKinopoiskPersonHtmlService();
        const htmlPerson = htmlService?.getPersonFilmography
            ? await htmlService.getPersonFilmography(PersonDetailsService.kinopoiskSearchNames(dto), { signal: options.signal })
            : null;
        if (options.signal.aborted) throw options.signal.reason;
        // The Kinopoisk person found by name is the same person only when the birthdays
        // agree; the page reads that person's awards with this ID.
        const kpPersonId = PersonDetailsService.matchKinopoiskPerson(dto, htmlPerson);
        if (kpPersonId) dto._meta.kpPersonMatch = { id: kpPersonId, verifiedBy: 'birthday' };
        if (htmlPerson?.items?.length > 0) {
            // A namesake's film can share a title with this person's film: without a
            // verified person a title must also agree on the year.
            this._applyKinopoiskHtmlMapping(filmography, htmlPerson.items, { allowYearless: Boolean(kpPersonId) });
            publish();
            await this._applyKinopoiskHtmlTitleMapping(mappingCandidates, { ...options, onUpdate: publish });
            publish();
            return;
        }
        if (!this.idMappingService) throw new Error('Person filmography mapping service unavailable');
        const batchInputs = mappingCandidates.map(item => ({
            id: item.tmdbId,
            tmdbId: item.tmdbId,
            mediaType: item.providerMediaType,
            title: item.name || item.originalName || '',
            originalTitle: item.originalName || item.name || '',
            releaseDate: item.releaseDate,
            year: item.year,
            voteAverage: item.rating,
            voteCount: item.voteCount,
            posterPath: item.posterUrl ? item.posterUrl.replace('https://image.tmdb.org/t/p/w342', '') : null
        }));
        const mappingMap = await this.idMappingService.resolveBatch(batchInputs, {
            skipQueue: true,
            context: 'person-filmography',
            signal: options.signal
        });
        if (options.signal.aborted) throw options.signal.reason;
        for (const item of uniqueMediaList) {
            const key = this.idMappingService.buildKey?.(item.providerMediaType || 'movie', item.tmdbId) || mediaKey(item);
            const resolved = mappingMap.get(key) || mappingMap.get(item.tmdbId)
                || mappingMap.get(String(item.tmdbId)) || mappingMap.get(Number(item.tmdbId));
            if (resolved?.kinopoiskId && Number(resolved.kinopoiskId) > 0) {
                item.kinopoiskId = Number(resolved.kinopoiskId);
            }
        }
        publish();
        if ([...mappingMap.values()].some(item => item?.status === 'unresolved')) {
            throw new Error('Person filmography mapping temporarily unavailable');
        }
    }

    _hasFilmDetails(dto) {
        return Number(dto?._meta?.filmDetailsVersion || 0) >= PersonDetailsService.FILM_DETAILS_VERSION;
    }

    /**
     * Kinopoisk films of a person whose details were not read yet, the most significant
     * first: roles and film work before appearances as themselves, then by rating.
     * @param {Object} dto
     * @param {string[]} [categories]
     * @returns {number[]}
     * @private
     */
    _filmIdsWithoutDetails(dto, categories = ['acting', 'directing', 'writing', 'production', 'music', 'other', 'self']) {
        const items = categories.flatMap(category => (dto?.filmography?.[category] || [])
            .map(item => ({ item, late: category === 'self' })));
        items.sort((a, b) => a.late - b.late || (Number(b.item.rating) || 0) - (Number(a.item.rating) || 0));
        return [...new Set(items.filter(({ item }) => !item.detailsChecked)
            .map(({ item }) => Number(item.kinopoiskId))
            .filter(id => Number.isSafeInteger(id) && id > 0))];
    }

    /**
     * Gives a Kinopoisk person's films their posters, years, types and votes with one
     * API request. An answer later than the wait is left to the enrichment.
     * @param {Object} dto
     * @param {Object} options - { signal }
     * @returns {Promise<boolean>} Whether the DTO changed
     * @private
     */
    async _ensureFilmDetails(dto, options = {}) {
        if (dto?.identity?.provider !== 'KP' || this._hasFilmDetails(dto)) return false;
        this._dropSharedPlaceholders(dto);
        if (typeof this.kinopoiskService?.getFilmCardsByIds !== 'function' || options.signal?.aborted) return false;
        const ids = this._filmIdsWithoutDetails(dto).slice(0, PersonDetailsService.FILM_BATCH_SIZE);
        if (ids.length === 0) return false;

        const promise = this._requestFilmCards(ids, options.signal);
        let timer;
        const wait = new Promise(resolve => { timer = setTimeout(() => resolve(null), this.FILM_BATCH_WAIT_MS); });
        try {
            const films = await Promise.race([promise, wait]);
            if (!films) {
                promise.catch(() => {});
                this.pendingFilmBatches.set(dto, { ids, promise });
                return false;
            }
            this._applyFilmDetails(dto, ids, films);
            return true;
        } catch (error) {
            console.warn('[PersonDetails] Kinopoisk film batch failed:', error?.message || error);
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    async _requestFilmCards(ids, signal) {
        const films = await this.kinopoiskService.getFilmCardsByIds(ids, { signal });
        if (!Array.isArray(films) || films.length === 0) throw new Error('Kinopoisk returned no film cards');
        return films;
    }

    /**
     * Reads the films of a role that the first batch left out (a person with more than
     * 250 titles); asked for when the user opens that role.
     * @param {Object} dto
     * @param {string} category
     * @param {Object} [options] - { signal }
     * @returns {Promise<boolean>} Whether the DTO changed
     */
    async loadRoleFilmDetails(dto, category, options = {}) {
        if (dto?.identity?.provider !== 'KP' || !this._hasFilmDetails(dto)) return false;
        if (typeof this.kinopoiskService?.getFilmCardsByIds !== 'function') return false;
        const ids = this._filmIdsWithoutDetails(dto, [category]).slice(0, PersonDetailsService.FILM_BATCH_SIZE);
        if (ids.length === 0) return false;
        const key = `${dto.identity.personKey}|${category}`;
        if (this.roleBatches.has(key)) return this.roleBatches.get(key);

        const request = (async () => {
            try {
                const films = await this._requestFilmCards(ids, options.signal);
                if (options.signal?.aborted) return false;
                this._applyFilmDetails(dto, ids, films);
                // A running enrichment replaces the DTO's films with its own copy.
                const copy = this.enrichmentCopies.get(dto);
                if (copy) this._applyFilmDetails(copy, ids, films);
                await this._writeCache(dto.identity.personKey, dto);
                return true;
            } catch (error) {
                console.warn('[PersonDetails] Kinopoisk film batch failed:', error?.message || error);
                return false;
            } finally {
                this.roleBatches.delete(key);
            }
        })();
        this.roleBatches.set(key, request);
        return request;
    }

    /**
     * @param {Object} dto
     * @param {number[]} ids - The films asked for
     * @param {Array<Object>} films - KinopoiskService.getFilmCardsByIds result
     * @private
     */
    _applyFilmDetails(dto, ids, films) {
        const byId = new Map(films.map(film => [Number(film.kinopoiskId), film]));
        const asked = new Set(ids);
        for (const item of [...Object.values(dto.filmography || {}).flat(), ...(dto.knownFor || [])]) {
            const id = Number(item?.kinopoiskId);
            if (!asked.has(id)) continue;
            item.detailsChecked = true;
            const film = byId.get(id);
            if (!film) continue;
            // The API has the poster of every film that has one: a picture read from the
            // film page before is the site's «no poster» one when the API has none.
            if (film.posterUrl || item.posterSource === 'kp-html') {
                item.posterUrl = film.posterUrl || null;
                item.posterSource = film.posterUrl ? 'kp' : null;
                item.hasArtwork = Boolean(film.posterUrl);
            }
            if (film.year) {
                item.year = film.year;
                item.releaseDate = `${film.year}-01-01`;
            }
            if (film.mediaType) item.providerMediaType = film.mediaType;
            if (film.ratingKp) item.rating = Number(film.ratingKp.toFixed(1));
            if (film.votesKp) item.voteCount = film.votesKp;
        }
        dto.knownFor = this._selectKpKnownFor(dto.filmography || {});
        dto._meta ||= {};
        dto._meta.filmDetailsVersion = PersonDetailsService.FILM_DETAILS_VERSION;
    }

    /**
     * The titles a Kinopoisk person is known for: by votes, rating and role like TMDB's,
     * or by rating alone while the votes are unknown.
     * @private
     */
    _selectKpKnownFor(filmography) {
        const films = new Map();
        for (const category of PersonDetailsService.CATEGORIES) {
            for (const item of filmography[category] || []) {
                const film = films.get(item.kinopoiskId) || { item, categories: new Set() };
                film.categories.add(category);
                films.set(item.kinopoiskId, film);
            }
        }
        const list = [...films.values()];
        const hasVotes = list.some(({ item }) => Number(item.voteCount) > 0);
        const score = film => (hasVotes ? this._calculateKnownForScore({ ...film.item, allCategories: film.categories }) : 0);
        return list
            .map(film => ({ item: film.item, score: score(film) }))
            .sort((a, b) => b.score - a.score || (Number(b.item.rating) || 0) - (Number(a.item.rating) || 0))
            .slice(0, this.MAX_KNOWN_FOR)
            .map(film => film.item);
    }

    /**
     * Kinopoisk's film pages show one shared «no poster» picture; an older DTO kept it
     * as a poster. A page picture of three or more films is that placeholder.
     * @private
     */
    _dropSharedPlaceholders(dto) {
        const items = [...Object.values(dto.filmography || {}).flat(), ...(dto.knownFor || [])]
            .filter(item => item?.posterSource === 'kp-html' && item.posterUrl);
        const films = new Map();
        for (const item of items) {
            const ids = films.get(item.posterUrl) || new Set();
            ids.add(Number(item.kinopoiskId));
            films.set(item.posterUrl, ids);
        }
        for (const item of items) {
            if (films.get(item.posterUrl).size < 3) continue;
            item.posterUrl = null;
            item.posterSource = null;
            item.hasArtwork = false;
        }
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

        const filmography = PersonDetailsService.emptyFilmography();

        // Normalize Cast. TMDB gives one credit per character, so a title is listed once
        // with every character the person played in it and the most episodes of a series.
        const castByTitle = new Map();
        const personNames = [name, originalName, ...aliases];
        for (const item of rawCast) {
            if (!item || !item.id || item.adult) continue;
            const mediaType = item.media_type === 'tv' ? 'tv' : 'movie';
            const mediaKey = `${mediaType}:${item.id}`;
            const group = castByTitle.get(mediaKey) || { item, mediaType, roles: [], episodeCount: 0 };
            group.roles.push({ character: String(item.character || '').trim(), self: this._isSelfCredit(item, personNames) });
            group.episodeCount = Math.max(group.episodeCount, Number(item.episode_count) || 0);
            castByTitle.set(mediaKey, group);
        }
        for (const group of castByTitle.values()) {
            // Playing themselves in every credit of a title puts it under «self».
            const roles = group.roles.filter(role => !role.self);
            const category = roles.length > 0 ? 'acting' : 'self';
            // Their own name as the character says nothing the tab does not.
            const characters = [...new Set((roles.length > 0 ? roles : group.roles).map(role => role.character)
                .filter(character => character && !(category === 'self' && this._isOwnName(character, personNames))))];
            const entry = this._createFilmographyItem(group.item, group.mediaType, category, characters.join(' / ') || null, category === 'self' ? 'Self' : 'Acting');
            entry.episodeCount = group.episodeCount > 0 ? group.episodeCount : null;
            filmography[category].push(entry);
        }

        // Normalize Crew: one entry per title and category with all its jobs.
        const crewByTitle = new Map();
        for (const item of rawCrew) {
            if (!item || !item.id || item.adult) continue;
            const mediaType = item.media_type === 'tv' ? 'tv' : 'movie';
            const category = this._mapCrewCategory(item.department, item.job);
            const groupKey = `${category}|${mediaType}:${item.id}`;
            const group = crewByTitle.get(groupKey) || { item, mediaType, category, jobs: [], episodeCount: 0 };
            const job = String(item.job || item.department || '').trim();
            if (job && !group.jobs.includes(job)) group.jobs.push(job);
            group.episodeCount = Math.max(group.episodeCount, Number(item.episode_count) || 0);
            crewByTitle.set(groupKey, group);
        }
        for (const group of crewByTitle.values()) {
            const entry = this._createFilmographyItem(group.item, group.mediaType, group.category, null, group.jobs[0] || null);
            entry.jobs = group.jobs;
            entry.episodeCount = group.episodeCount > 0 ? group.episodeCount : null;
            filmography[group.category].push(entry);
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

        let mappedCount = 0;
        let unmappedCount = 0;

        // Count mapped and unmapped across unique items
        for (const item of uniqueMediaList) {
            if (item.kinopoiskId && item.kinopoiskId > 0) mappedCount++;
            else unmappedCount++;
        }

        // Select Known-For independently of background Kinopoisk mapping.
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

        const filmography = PersonDetailsService.emptyFilmography();
        const byCategory = Object.fromEntries(PersonDetailsService.CATEGORIES.map(category => [category, new Map()]));

        for (const item of rawMovies) {
            if (!item || !item.id) continue;
            const kpId = Number(item.id);
            if (!kpId || kpId <= 0) continue;

            let description = String(item.description || '').trim();
            let category = this._mapKpProfessionToCategory(item.enProfession || item.profession);
            if (category === 'acting' && this._isSelfRole(description, [name, originalName])) category = 'self';
            const profession = item.enProfession || item.profession || null;
            const isRole = category === 'acting' || category === 'self';
            if (/^хроника$/i.test(description)) description = '(archive footage)';
            else if (category === 'self' && this._isOwnName(description, [name, originalName])) description = '';
            else if (category === 'acting' && String(profession).toUpperCase() === 'UNCREDITED' && description) description += ' (uncredited)';

            // A second credit for the same film adds its character or job.
            const existing = byCategory[category].get(kpId);
            if (existing) {
                if (description && isRole && !String(existing.character || '').split(' / ').includes(description)) {
                    existing.character = existing.character ? `${existing.character} / ${description}` : description;
                } else if (description && !isRole && !existing.jobs.includes(description)) {
                    existing.jobs.push(description);
                }
                continue;
            }

            const year = typeof item.year === 'number' ? item.year : null;
            const rating = typeof item.rating === 'number' && item.rating > 0 ? Number(item.rating.toFixed(1)) : null;
            const entry = {
                providerMediaId: kpId,
                providerMediaType: 'movie',
                kinopoiskId: kpId,
                tmdbId: null,
                name: (item.name || item.alternativeName || '').trim(),
                originalName: (item.alternativeName || '').trim() || null,
                character: isRole ? (description || null) : null,
                job: profession,
                // A crew credit's description is its precise job («исполнительный продюсер»).
                jobs: !isRole && description ? [description] : (profession ? [profession] : []),
                department: category,
                year,
                releaseDate: year ? `${year}-01-01` : null,
                posterUrl: this._extractKpPosterUrl(item),
                posterSource: this._extractKpPosterUrl(item) ? 'kp' : null,
                hasArtwork: Boolean(this._extractKpPosterUrl(item)),
                hasNavigationTarget: true,
                rating,
                voteCount: null,
                popularity: null,
                episodeCount: null,
                adult: false,
                category
            };
            byCategory[category].set(kpId, entry);
            filmography[category].push(entry);
        }

        const knownFor = this._selectKpKnownFor(filmography);
        const filmCount = new Set(Object.values(filmography).flat().map(item => item.kinopoiskId)).size;

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
                factsVersion: PersonDetailsService.FACTS_VERSION,
                mappedCount: filmCount,
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
        // Without votes the page opens on each role's best rated titles (four rows of up
        // to seven), so their posters are read first.
        const bestFirst = list => [...list].sort((a, b) => (Number(b?.rating) || 0) - (Number(a?.rating) || 0)
            || (Number(b?.year) || 0) - (Number(a?.year) || 0));
        const items = [
            ...(Array.isArray(additionalItems) ? additionalItems : []),
            ...Object.values(filmography).flatMap(list => bestFirst(list).slice(0, 28)),
            ...Object.values(filmography).flat()
        ];
        const ids = [...new Set(items.filter(item => !['kp-html', 'kp-page'].includes(item.posterSource))
            .map(item => Number(item.kinopoiskId))
            .filter(id => Number.isSafeInteger(id) && id > 0))];
        if (ids.length === 0) return 0;
        let enrichedCount = 0;
        const enrichedIds = new Set();
        // A film page gives the film's year and type along with its poster.
        const apply = (id, posterUrl, details = null) => {
            if (options.signal?.aborted) return;
            let changed = details ? this._applyKinopoiskFilmDetails(items, new Map([[Number(id), details]])) : false;
            if (!enrichedIds.has(id) && this._isValidArtworkUrl(posterUrl)) {
                for (const item of items) {
                    if (Number(item.kinopoiskId) !== Number(id)) continue;
                    item.posterUrl = posterUrl;
                    item.posterSource = 'kp-html';
                    item.hasArtwork = true;
                }
                enrichedIds.add(id);
                enrichedCount++;
                changed = true;
            }
            if (changed) options.onUpdate?.();
        };
        const posterMap = await posterService.getMoviePostersByIds(ids, {
            signal: options.signal,
            onPoster: apply,
            reportFailure: true,
            withDetails: true
        });
        for (const id of ids) apply(id, posterMap instanceof Map ? posterMap.get(id) : posterMap?.[id]);

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
        const normalizedJob = job ? String(job).trim() : null;

        return {
            providerMediaId: item.id,
            providerMediaType: mediaType,
            kinopoiskId: null, // Populated after batch mapping
            tmdbId: item.id,
            name,
            originalName,
            character: character ? String(character).trim() : null,
            job: normalizedJob,
            jobs: normalizedJob ? [normalizedJob] : [],
            department: item.department || null,
            year,
            releaseDate: releaseDate || null,
            posterUrl,
            posterSource: posterUrl ? 'tmdb' : null,
            hasArtwork: Boolean(posterUrl),
            hasNavigationTarget: false,
            rating,
            voteCount,
            popularity: typeof item.popularity === 'number' ? Number(item.popularity.toFixed(2)) : null,
            episodeCount: null,
            adult: Boolean(item.adult),
            category
        };
    }

    /**
     * The characters a Kinopoisk person page names for one film, joined.
     * @param {Object} kpItem - KinopoiskPersonHtmlService filmography item
     * @returns {string}
     */
    static kinopoiskCharacters(kpItem) {
        const roles = Array.isArray(kpItem?.roles) && kpItem.roles.length > 0 ? kpItem.roles.map(role => role?.character) : [kpItem?.role];
        return [...new Set(roles.map(name => String(name || '').trim()).filter(Boolean))].join(' / ');
    }

    /**
     * Keeps Kinopoisk's character name beside the provider's when Kinopoisk writes it
     * in Cyrillic, so a Russian interface can show it instead of a transliteration.
     * Kinopoisk keeps a foreign character in its original spelling, as TMDB does.
     * @param {Object} item
     * @param {string} characters
     * @returns {boolean} Whether the item changed
     * @private
     */
    _applyLocalCharacter(item, characters) {
        if (!item || !['acting', 'self'].includes(item.category)) return false;
        const value = String(characters || '').trim();
        if (!value || !/[а-яё]/i.test(value) || value === item.character || value === item.characterLocal) return false;
        item.characterLocal = value;
        return true;
    }

    /**
     * The categories of a filmography, empty.
     * @returns {Object<string, Array>}
     */
    static emptyFilmography() {
        return Object.fromEntries(PersonDetailsService.CATEGORIES.map(category => [category, []]));
    }

    /**
     * A TMDB cast credit in which the person plays themselves.
     * @private
     */
    _isSelfCredit(item, personNames = []) {
        const character = String(item?.character || '').trim();
        if (character) return this._isSelfRole(character, personNames);
        const genres = Array.isArray(item?.genre_ids) ? item.genre_ids : [];
        return genres.some(id => PersonDetailsService.SELF_GENRE_IDS.has(Number(id)));
    }

    /**
     * A part that is the person themselves: «Self», «играет самого себя», archive
     * footage («хроника»), or the person's own name as the character.
     * @param {string} text
     * @param {string[]} [personNames]
     * @returns {boolean}
     * @private
     */
    _isSelfRole(text, personNames = []) {
        const value = String(text || '').trim();
        if (!value) return false;
        if (PersonDetailsService.SELF_ROLE.test(value) || /^(?:хроника|\(?archive footage\)?)$/i.test(value)) return true;
        return this._isOwnName(value, personNames);
    }

    _isOwnName(value, personNames = []) {
        const normalized = this._normalizeTitle(value);
        return Boolean(normalized) && personNames.some(name => name && this._normalizeTitle(name) === normalized);
    }

    /**
     * Year, type and poster of Kinopoisk films that the API leaves out, from the person's
     * Kinopoisk page or a film page. Values already known are kept.
     * @param {Array<Object>} items
     * @param {Map<number, {year: number|null, mediaType: string|null}>} details
     * @returns {boolean} Whether any item changed
     * @private
     */
    _applyKinopoiskFilmDetails(items, details) {
        if (!(details instanceof Map) || details.size === 0) return false;
        let changed = false;
        for (const item of items) {
            const detail = details.get(Number(item?.kinopoiskId));
            if (!detail) continue;
            if (detail.character && this._applyLocalCharacter(item, detail.character)) changed = true;
            if (!item.posterUrl && this._isValidArtworkUrl(detail.posterUrl)) {
                item.posterUrl = detail.posterUrl;
                item.posterSource = 'kp-page';
                item.hasArtwork = true;
                changed = true;
            }
            const year = Number(detail.year);
            if (!item.year && Number.isInteger(year) && year > 1850 && year < 2200) {
                item.year = year;
                item.releaseDate = item.releaseDate || `${year}-01-01`;
                changed = true;
            }
            if (detail.mediaType === 'tv' && item.providerMediaType !== 'tv') {
                item.providerMediaType = 'tv';
                changed = true;
            }
        }
        return changed;
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
        // Kinopoisk's «cameo» is its «Играет самого себя»: talk shows, ceremonies,
        // documentaries. «uncredited» is a role without a screen credit.
        if (['CAMEO', 'HIMSELF', 'HERSELF', 'ИГРАЕТ САМОГО СЕБЯ', 'ИГРАЕТ САМУ СЕБЯ'].includes(prof)) return 'self';
        if (prof === 'ACTOR' || prof === 'АКТЕР' || prof === 'АКТРИСА' || prof === 'UNCREDITED') return 'acting';
        if (prof === 'DIRECTOR' || prof === 'РЕЖИССЕР') return 'directing';
        if (prof === 'WRITER' || prof === 'СЦЕНАРИСТ') return 'writing';
        if (prof === 'PRODUCER' || prof === 'ПРОДЮСЕР') return 'production';
        if (prof === 'COMPOSER' || prof === 'КОМПОЗИТОР') return 'music';
        return 'other';
    }

    /**
     * Merge native Kinopoisk IDs from the person HTML payload into TMDB credits.
     * Matching is local and bounded by title plus a one-year release tolerance, and a
     * film never matches a series.
     * @param {Object} filmography
     * @param {Array<Object>} kpItems
     * @param {Object} [options]
     * @param {boolean} [options.allowYearless=true] - Match a title alone when a year is
     *   missing; only safe when the Kinopoisk person is verified as this person
     * @returns {number} Number of TMDB items enriched with a KP ID
     * @private
     */
    _applyKinopoiskHtmlMapping(filmography, kpItems, { allowYearless = true } = {}) {
        const byTitleAndYear = new Map();
        const byTitle = new Map();
        const byId = new Map(kpItems.map(kpItem => [Number(kpItem.kinopoiskId), kpItem]));
        const typeOf = item => (item?.providerMediaType === 'tv' ? 'tv' : 'movie');

        for (const kpItem of kpItems) {
            const titles = [kpItem.name, kpItem.originalName]
                .map(title => this._normalizeTitle(title))
                .filter(Boolean);
            if (titles.length === 0) continue;

            for (const title of titles) {
                byTitle.set(`${typeOf(kpItem)}|${title}`, kpItem);
                if (kpItem.year) {
                    byTitleAndYear.set(`${typeOf(kpItem)}|${title}|${kpItem.year}`, kpItem);
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
                const type = typeOf(tmdbItem);
                // A credit mapped before is matched by its Kinopoisk ID.
                let match = byId.get(Number(tmdbItem.kinopoiskId)) || null;

                for (const title of match ? [] : titles) {
                    const year = Number(tmdbItem.year);
                    if (year) {
                        match = byTitleAndYear.get(`${type}|${title}|${year}`)
                            || byTitleAndYear.get(`${type}|${title}|${year - 1}`)
                            || byTitleAndYear.get(`${type}|${title}|${year + 1}`);
                    }
                    // A title alone decides only when one side has no year: two dated
                    // films of the same name years apart are different films.
                    const candidate = !match && allowYearless ? byTitle.get(`${type}|${title}`) : null;
                    if (candidate && (!year || !candidate.year)) match = candidate;
                    if (match) break;
                }

                if (!match?.kinopoiskId) {
                    tmdbItem.hasNavigationTarget = this._hasNavigationTarget(tmdbItem);
                    continue;
                }

                tmdbItem.kinopoiskId = Number(match.kinopoiskId);
                tmdbItem.hasNavigationTarget = this._hasNavigationTarget(tmdbItem);
                this._applyLocalCharacter(tmdbItem, PersonDetailsService.kinopoiskCharacters(match));
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
    async _applyKinopoiskHtmlTitleMapping(candidates, options = {}) {
        const htmlService = this._ensureKinopoiskPersonHtmlService();
        if (!htmlService || typeof htmlService.findMovieByTitle !== 'function') return 0;
        const unresolved = candidates.filter(item => !this._hasNavigationTarget(item));
        if (unresolved.length === 0) return 0;

        let nextIndex = 0;
        let matchedCount = 0;
        const worker = async () => {
            while (nextIndex < unresolved.length && !options.signal?.aborted) {
                const item = unresolved[nextIndex++];
                const requestKey = `person-filmography:${Date.now()}:${item.providerMediaType}:${item.tmdbId}`;
                const cancel = () => {
                    try {
                        globalThis.chrome?.runtime?.sendMessage?.({
                            type: 'KINOPOISK_OFFSCREEN_CANCEL', requestKey
                        })?.catch?.(() => {});
                    } catch { /* Best-effort; signal guards also discard late results. */ }
                };
                options.signal?.addEventListener('abort', cancel, { once: true });
                let match;
                try {
                    match = await htmlService.findMovieByTitle(
                        [item.name, item.originalName],
                        item.year,
                        { ...options, requestKey, mediaType: item.providerMediaType, reportFailure: true }
                    );
                } finally {
                    options.signal?.removeEventListener('abort', cancel);
                }
                if (options.signal?.aborted) throw options.signal.reason;
                if (match?.failed) throw new Error('Kinopoisk title lookup unavailable');
                if (!match?.kinopoiskId) continue;

                item.kinopoiskId = Number(match.kinopoiskId);
                item.hasNavigationTarget = this._hasNavigationTarget(item);
                matchedCount++;
                options.onUpdate?.();
                console.log('[PersonDetails] Kinopoisk HTML title match', {
                    title: item.name || item.originalName || null,
                    year: item.year || null,
                    kinopoiskId: item.kinopoiskId
                });
            }
        };

        const workerCount = Math.min(2, unresolved.length);
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

        // A talk show or ceremony the person only appeared in is not what they are
        // known for, however many votes it has.
        if (categories.size === 1 && categories.has('self')) return 0.25 * (Math.log10((item.voteCount || 0) + 1) * (item.rating || 5.0));

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
            else if (dept === 'acting' && (filmography.acting.length > 0 || filmography.self?.length > 0)) result.push('Актёр');
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
     * Plain text of an HTML fragment, without DOM dependencies: tags first, then each
     * entity once, so an escaped tag stays text. The page escapes it when it shows it.
     * @private
     */
    _stripHtml(text) {
        if (!text || typeof text !== 'string') return '';
        return this._decodeHtmlEntities(text.replace(/<[^>]*>/g, ''));
    }

    _decodeHtmlEntities(text) {
        return String(text || '').replace(/&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z]+));/gi, (match, decimal, hex, name) => {
            if (name) return PersonDetailsService.HTML_ENTITIES[name.toLowerCase()] ?? match;
            const code = decimal ? Number(decimal) : parseInt(hex, 16);
            if (code < 32) return ' ';
            // Browsers read 128–159 as windows-1252 («&#151;» is a dash), and so does Kinopoisk.
            if (code >= 128 && code <= 159) return new TextDecoder('windows-1252').decode(new Uint8Array([code]));
            return code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? match : String.fromCodePoint(code);
        });
    }

    /**
     * @param {Object} dto - A cached person
     * @returns {boolean} Whether it has to be written again
     * @private
     */
    _decodeCachedFacts(dto) {
        if (Number(dto._meta.factsVersion || 0) >= PersonDetailsService.FACTS_VERSION || !Array.isArray(dto.facts)) return false;
        dto._meta.factsVersion = PersonDetailsService.FACTS_VERSION;
        if (!dto.facts.some(fact => String(fact).includes('&'))) return false;
        dto.facts = dto.facts.map(fact => this._decodeHtmlEntities(fact));
        return true;
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
                await this._dropLegacyCache();
            } else {
                this._memoryCache.set(storageKey, entry);
            }
        } catch (err) {
            console.warn(`PersonDetailsService: cache write failed for ${personKey}:`, err.message);
        }
    }

    /**
     * Remove the persons an older cache namespace kept: nothing reads them again,
     * and without this they would stay in storage for good. Runs once per page.
     * @returns {Promise<void>}
     * @private
     */
    async _dropLegacyCache() {
        if (this._legacyCacheDropped) return;
        this._legacyCacheDropped = true;
        try {
            const indexes = await chrome.storage.local.get(this.LEGACY_INDEX_KEYS);
            const keys = this.LEGACY_INDEX_KEYS.flatMap(indexKey => (Array.isArray(indexes?.[indexKey]) ? indexes[indexKey] : []));
            if (keys.length > 0 || this.LEGACY_INDEX_KEYS.some(indexKey => indexes?.[indexKey] !== undefined)) {
                await chrome.storage.local.remove([...keys, ...this.LEGACY_INDEX_KEYS]);
            }
        } catch (err) {
            console.warn('PersonDetailsService: legacy cache cleanup failed:', err.message);
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
