/**
 * Loads provider ratings for visible movie cards without blocking the first
 * Home/catalog render. KP identity and provider ratings are resolved through
 * bounded HTML search flows, never through a per-card provider API batch.
 */
class MovieRatingsEnrichmentService {
    constructor(options = {}) {
        this.kinopoiskService = options.kinopoiskService || null;
        this.navigationService = options.navigationService || null;
        this.storage = options.storage || (typeof chrome !== 'undefined' ? chrome.storage?.local : null);
        this.ratingParser = options.ratingParser || (
            typeof KinopoiskRatingParsingService !== 'undefined'
                ? new KinopoiskRatingParsingService()
                : null
        );
        this.imdbParser = options.imdbParser || (
            typeof ImdbParsingService !== 'undefined' ? new ImdbParsingService() : null
        );
        this.tmdbService = options.tmdbService || (
            typeof TMDBService !== 'undefined' ? new TMDBService() : null
        );

        // v2 invalidates old empty-rating records created before direct-ID
        // Kinopoisk HTML rating lookup and the explicit unavailable state.
        // v3 invalidates empty records created before the offscreen KP scraper
        // started waiting for hydrated search-card ratings.
        // v4 invalidates records produced while IMDb search was blocked, so
        // the hidden Kinopoisk movie-page source gets one fresh opportunity.
        this.cacheKey = 'movie_card_ratings_v4';
        this.cacheTtlMs = 7 * 24 * 60 * 60 * 1000;
        this.negativeTtlMs = 6 * 60 * 60 * 1000;
        // A negative result is provisional: a KP HTML search can be blocked,
        // return an SSR shell, or hydrate a card after the first snapshot.
        // Retry it periodically instead of treating it as a permanent answer.
        this.negativeRetryMs = 15 * 60 * 1000;
        this.providerRetryMs = 15 * 60 * 1000;
        this.maxCacheEntries = 400;
        this.maxCardsPerFlush = options.maxCardsPerFlush || 6;
        this.batchDelayMs = options.batchDelayMs ?? 350;
        this.enableDetailFallback = options.enableDetailFallback === true;
        this.rootMargin = options.rootMargin || '40px 0px';
        this.pendingCards = new Set();
        this.flushTimer = null;
        this.observer = null;
        this.cachePromise = null;
        this.identityInFlight = new Map();
        this.ratingsInFlight = new Map();
        this.lifecycleGeneration = 0;
        this.cancelledCardKeys = new Set();
        this.trackedCards = new Set();
        this.cacheWritePromise = Promise.resolve();
        this.lastBackgroundEnrichment = Promise.resolve();
        // A missing IMDb rating is retryable on the next page session. This
        // prevents a transient IMDb 202/empty response from suppressing all
        // future attempts while still preventing duplicate requests during
        // the current page lifetime.
        this.enrichmentSessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.traceEnabled = options.trace !== false;
        this.trace('constructed', {
            maxCardsPerFlush: this.maxCardsPerFlush,
            rootMargin: this.rootMargin,
            detailFallbackEnabled: this.enableDetailFallback
        });
    }

    trace(event, details = {}) {
        if (!this.traceEnabled) return;
        console.info('[MovieRatingsTrace]', event, details);
    }

    cardTraceData(card) {
        return {
            tmdbId: card?.dataset?.tmdbId || null,
            movieId: card?.dataset?.movieId || null,
            title: card?.dataset?.movieTitle || null,
            state: card?.dataset?.ratingsState || null
        };
    }

    isCardInViewport(card) {
        if (!card?.getBoundingClientRect || typeof window === 'undefined') return true;
        const rect = card.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
        return rect.bottom >= 0 && rect.top <= viewportHeight;
    }

    requestPriority(card, visiblePriority) {
        return this.isCardInViewport(card) ? visiblePriority : 'below-viewport';
    }

    observe(container) {
        if (!container || typeof container.querySelectorAll !== 'function') return;
        const cards = Array.from(container.querySelectorAll('.movie-card-component, .featured-card'))
            .filter(card => card.dataset.ratingsState !== 'ready');
        this.trace('observe', {
            container: container.id || container.className || container.tagName || 'unknown',
            cardCount: cards.length,
            states: cards.reduce((result, card) => {
                const state = card.dataset.ratingsState || 'empty';
                result[state] = (result[state] || 0) + 1;
                return result;
            }, {})
        });
        if (cards.length === 0) return;
        cards.forEach(card => this.trackedCards.add(card));

        if (typeof IntersectionObserver === 'undefined') {
            setTimeout(() => this.enqueueCards(cards.slice(0, 6)), 0);
            return;
        }

        if (!this.observer) {
            this.observer = new IntersectionObserver(entries => {
                const intersecting = entries.filter(entry => entry.isIntersecting);
                entries.filter(entry => !entry.isIntersecting).forEach(entry => this.cancelCard(entry.target));
                this.trace('intersection', {
                    observedEntries: entries.length,
                    intersecting: intersecting.length,
                    pendingBefore: this.pendingCards.size,
                    cards: intersecting.slice(0, 20).map(entry => this.cardTraceData(entry.target))
                });
                intersecting.forEach(entry => {
                    this.enqueueCards([entry.target]);
                });
            }, { rootMargin: this.rootMargin });
        }

        cards.forEach(card => this.observer.observe(card));
    }

    enqueueCards(cards) {
        const pendingBefore = this.pendingCards.size;
        let added = 0;
        cards.filter(Boolean).forEach(card => {
            if (['ready', 'loading', 'partial'].includes(card.dataset.ratingsState)) return;
            this.cancelledCardKeys.delete(this.cacheKeyFor(this.itemFromCard(card)));
            this.trackedCards.add(card);
            card.dataset.ratingsState = 'queued';
            this.pendingCards.add(card);
            added += 1;
        });
        this.trace('enqueue', {
            requested: cards.length,
            added,
            pendingBefore,
            pendingAfter: this.pendingCards.size
        });
        this.schedulePendingFlush();
    }

    schedulePendingFlush(delay = this.batchDelayMs) {
        if (this.pendingCards.size === 0 || this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flushPendingCards()
                .catch(error => {
                    console.warn('[MovieRatings] Visible card enrichment failed:', error.message);
                })
                .finally(() => this.schedulePendingFlush());
        }, delay);
    }

    async flushPendingCards() {
        const startedAt = Date.now();
        const flushGeneration = this.lifecycleGeneration;
        const pendingBefore = this.pendingCards.size;
        const cards = Array.from(this.pendingCards).slice(0, this.maxCardsPerFlush);
        cards.forEach(card => this.pendingCards.delete(card));
        if (cards.length === 0) return;

        this.trace('flush:start', {
            batchSize: cards.length,
            pendingBefore,
            pendingAfterDequeue: this.pendingCards.size,
            cards: cards.map(card => this.cardTraceData(card))
        });

        const cache = await this.readCache();
        if (flushGeneration !== this.lifecycleGeneration) return;
        const candidates = [];
        let cacheHits = 0;
        let partialCacheHits = 0;

        for (const card of cards) {
            if (flushGeneration !== this.lifecycleGeneration) return;
            const item = this.itemFromCard(card);
            const key = this.cacheKeyFor(item);
            if (this.cancelledCardKeys.has(key)) continue;
            const cached = cache[key];
            card.dataset.ratingsEnrichmentKey = key;
            if (this.isFullyUsableCache(cached)) {
                cacheHits += 1;
                this.applyRatings(card, cached);
                continue;
            }
            if (cached && this.isNegativeRecord(cached)) {
                this.trace('cache:negative-stale', {
                    ...this.cardTraceData(card),
                    key,
                    status: cached.status,
                    kpId: Number(cached.kpId) || 0,
                    retryAfter: Number(cached.retryAfter) || null
                });
            } else if (cached) {
                this.trace('cache:provider-stale', {
                    ...this.cardTraceData(card),
                    key,
                    kpRating: Number(cached.kpRating) || 0,
                    imdbRating: Number(cached.imdbRating) || 0,
                    kpRetryAfter: Number(cached.kpRetryAfter) || null,
                    imdbRetryAfter: Number(cached.imdbRetryAfter) || null
                });
            }
            card.dataset.ratingsState = 'loading';
            const cachedIdentity = cached && Number(cached.kpId) > 0
                ? {
                    kpId: Number(cached.kpId),
                    kpRating: Number(cached.kpRating) || 0,
                    imdbRating: Number(cached.imdbRating) || 0,
                    kpVotes: Number(cached.votes?.kp) || 0,
                    imdbVotes: Number(cached.votes?.imdb) || 0,
                    imdbId: this.normalizeImdbId(cached.imdbId),
                    kpState: cached.kpState,
                    imdbState: cached.imdbState
                }
                : {};
            if (cachedIdentity.kpId) partialCacheHits += 1;
            candidates.push({ card, item, key, generation: flushGeneration, ...cachedIdentity });
        }

        this.trace('flush:cache-scan', {
            batchSize: cards.length,
            cacheHits,
            partialCacheHits,
            networkCandidates: candidates.length
        });

        if (candidates.length === 0) {
            this.trace('flush:complete', {
                durationMs: Date.now() - startedAt,
                cacheOnly: true,
                pendingRemaining: this.pendingCards.size
            });
            this.schedulePendingFlush();
            return;
        }

        const unresolved = candidates.filter(candidate => !(Number(candidate.kpId) > 0));
        const resolvedUnresolved = await Promise.all(
            unresolved.map(candidate => this.resolveIdentityDedup(candidate))
        );
        const resolvedByCard = new Map(
            resolvedUnresolved.map(candidate => [candidate.card, candidate])
        );
        const resolved = candidates.map(candidate => resolvedByCard.get(candidate.card) || candidate);
        const withIdentity = resolved.filter(candidate => candidate.kpId > 0);
        const missingIdentity = resolved.filter(candidate => candidate.kpId <= 0);
        this.trace('identity:complete', {
            durationMs: Date.now() - startedAt,
            requested: candidates.length,
            resolved: withIdentity.length,
            missing: missingIdentity.length,
            cards: resolved.map(candidate => ({
                ...this.cardTraceData(candidate.card),
                kpId: candidate.kpId,
                kpRating: candidate.kpRating,
                imdbRating: candidate.imdbRating,
                imdbId: candidate.imdbId
            }))
        });

        for (const candidate of missingIdentity) {
            if (!this.isCurrentCandidate(candidate)) continue;
            const record = this.createRecord(candidate, { status: 'not-found' });
            cache[candidate.key] = record;
            if (this.isCurrentCandidate(candidate)) this.applyRatings(candidate.card, record);
        }

        // Stage A: persist and render identity plus any KP rating exposed by
        // the search result. IMDb stays pending and cannot delay this paint.
        withIdentity.map(candidate => {
            const record = this.createRecord(candidate, {
                status: this.hasPendingProvider(candidate) ? 'partial' : 'resolved',
                kpId: candidate.kpId,
                kpRating: candidate.kpRating,
                imdbRating: candidate.imdbRating,
                imdbId: candidate.imdbId,
                kpState: Number(candidate.kpRating) > 0 ? 'available' : 'pending',
                imdbState: Number(candidate.imdbRating) > 0 ? 'available' : 'pending'
            });
            if (!this.isCurrentCandidate(candidate)) return { candidate, record };
            cache[candidate.key] = record;
            cache[`kp:${candidate.kpId}`] = record;
            if (this.isCurrentCandidate(candidate)) {
                this.applyRatings(candidate.card, record, { partial: this.hasPendingProvider(candidate) });
            }
            return { candidate, record };
        });
        await this.writeCache(this.boundCache(cache));

        const enrichable = withIdentity.filter(candidate => this.isCurrentCandidate(candidate)).filter(candidate => (
            this.hasPendingProvider(candidate)
        ));
        if (enrichable.length > 0) {
            this.lastBackgroundEnrichment = this.enrichProvidersInBackground(enrichable);
            this.lastBackgroundEnrichment.catch(error => {
                this.trace('stageB:error', {
                    message: error?.message || 'ENRICHMENT_BACKGROUND_FAILED',
                    candidateCount: enrichable.length
                });
            });
        } else {
            this.lastBackgroundEnrichment = Promise.resolve();
        }

        this.trace('flush:complete', {
            durationMs: Date.now() - startedAt,
            processed: cards.length,
            cacheHits,
            partialCacheHits,
            networkCandidates: candidates.length,
            backgroundProviderCount: enrichable.length,
            pendingRemaining: this.pendingCards.size
        });
        this.schedulePendingFlush();
    }

    async enrichProvidersInBackground(candidates) {
        const startedAt = Date.now();
        const records = await Promise.all(candidates.map(async candidate => {
            try {
                return await this.buildRatingRecordDedup(candidate);
            } catch (error) {
                return {
                    candidate,
                    record: this.createRecord(candidate, {
                        status: this.hasAvailableProvider(candidate) ? 'partial' : 'no-ratings',
                        kpId: candidate.kpId,
                        kpRating: candidate.kpRating,
                        imdbRating: candidate.imdbRating,
                        imdbId: candidate.imdbId,
                        kpState: Number(candidate.kpRating) > 0 ? 'available' : 'unavailable',
                        imdbState: Number(candidate.imdbRating) > 0 ? 'available' : 'unavailable',
                        error: error?.message || 'ENRICHMENT_FAILED'
                    })
                };
            }
        }));
        const cache = await this.readCache();
        records.forEach(({ candidate, record }) => {
            if (!this.isCurrentCandidate(candidate)) return;
            cache[candidate.key] = record;
            cache[`kp:${candidate.kpId}`] = record;
            this.applyRatings(candidate.card, record);
        });
        await this.writeCache(this.boundCache(cache));
        this.trace('stageB:complete', {
            durationMs: Date.now() - startedAt,
            processed: records.length,
            updatedCards: records.filter(({ candidate }) => this.isCurrentCandidate(candidate)).length
        });
    }

    async resolveIdentityDedup(candidate) {
        const item = candidate.item || {};
        const title = this.normalizeIdentityTitle(item.name || item.title || item.alternativeName || item.originalTitle);
        const year = Number(item.year) || 0;
        const mediaType = item.mediaType || item.type || 'movie';
        const key = `identity:${title}|${year}|${mediaType}`;
        const shared = await this.withInFlight(this.identityInFlight, key, () => this.resolveIdentity(candidate));
        return {
            ...shared,
            card: candidate.card,
            key: candidate.key,
            item: candidate.item,
            generation: candidate.generation
        };
    }

    async buildRatingRecordDedup(candidate) {
        const mediaType = candidate.item?.mediaType || candidate.item?.type || 'movie';
        const key = `ratings:kp:${candidate.kpId}:${mediaType}`;
        const shared = await this.withInFlight(this.ratingsInFlight, key, () => this.buildRatingRecord(candidate));
        return { candidate, record: shared.record };
    }

    async withInFlight(map, key, worker) {
        if (map.has(key)) {
            this.trace('dedup:in-flight-hit', { key });
            return map.get(key);
        }
        const promise = Promise.resolve()
            .then(worker)
            .finally(() => map.delete(key));
        map.set(key, promise);
        return promise;
    }

    normalizeIdentityTitle(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    hasPendingProvider(candidate) {
        const kpRating = Number(candidate?.kpRating) || 0;
        const imdbRating = Number(candidate?.imdbRating) || 0;
        const kpVotes = Number(candidate?.kpVotes) || 0;
        const imdbVotes = Number(candidate?.imdbVotes) || 0;
        return kpRating <= 0
            || imdbRating <= 0
            || (kpRating > 0 && kpVotes <= 0)
            || (imdbRating > 0 && imdbVotes <= 0);
    }

    hasAvailableProvider(candidate) {
        return Number(candidate?.kpRating) > 0 || Number(candidate?.imdbRating) > 0;
    }

    isCurrentCandidate(candidate) {
        const key = candidate?.card?.dataset?.ratingsEnrichmentKey;
        return candidate?.generation === this.lifecycleGeneration
            && !this.cancelledCardKeys.has(candidate?.key)
            && (!key || key === candidate.key);
    }

    cancelCard(card) {
        if (!card) return;
        const item = this.itemFromCard(card);
        const key = this.cacheKeyFor(item);
        const requestKey = this.requestKeyForCard(item, card);
        this.cancelledCardKeys.add(key);
        this.pendingCards.delete(card);
        if (['queued', 'loading', 'partial'].includes(card.dataset.ratingsState)) {
            card.dataset.ratingsState = '';
        }
        if (requestKey && globalThis.chrome?.runtime?.sendMessage) {
            try {
                const response = globalThis.chrome.runtime.sendMessage({
                    type: 'KINOPOISK_OFFSCREEN_CANCEL',
                    requestKey
                });
                response?.catch?.(() => {});
            } catch {
                // Cancellation is best-effort; the generation/key guard still
                // prevents a late result from mutating an invisible card.
            }
        }
        this.trace('card:cancelled', { ...this.cardTraceData(card), key, requestKey });
    }

    identityRequestKey(item = {}) {
        const title = this.normalizeIdentityTitle(
            item.name || item.title || item.alternativeName || item.originalTitle
        );
        const year = Number(item.year) || 0;
        return `kp-search:${title}|${year || ''}|identity`;
    }

    requestKeyForCard(item = {}, card = null) {
        const kpId = Number(item.kinopoiskId || card?.dataset?.movieId);
        const mediaType = item.mediaType || item.type || card?.dataset?.mediaType || 'movie';
        if (Number.isSafeInteger(kpId) && kpId > 0) {
            return `kp-detail:${kpId}:${mediaType}`;
        }
        if (item.name || item.title || item.alternativeName || item.originalTitle) {
            return this.identityRequestKey(item);
        }
        return null;
    }

    dispose() {
        for (const card of this.trackedCards) this.cancelCard(card);
        this.trackedCards.clear();
        this.lifecycleGeneration += 1;
        this.observer?.disconnect?.();
        this.observer = null;
        this.pendingCards.clear();
        this.identityInFlight.clear();
        this.ratingsInFlight.clear();
        if (this.flushTimer) clearTimeout(this.flushTimer);
        this.flushTimer = null;
    }

    async resolveIdentity(candidate) {
        const startedAt = Date.now();
        this.trace('identity:start', {
            ...this.cardTraceData(candidate.card),
            source: 'direct-id-or-html-search'
        });
        const directId = Number(candidate.item.kinopoiskId || candidate.item.movieId);
        if (Number.isSafeInteger(directId) && directId > 0) {
            const resolved = {
                ...candidate,
                kpId: directId,
                kpRating: Number(candidate.item.kpRating) || 0,
                imdbRating: Number(candidate.item.imdbRating) || 0,
                imdbId: this.normalizeImdbId(candidate.item.imdbId),
                kpVotes: Number(candidate.item.kpVotes || candidate.item.votes?.kp) || 0,
                imdbVotes: Number(candidate.item.imdbVotes || candidate.item.votes?.imdb) || 0
            };
            this.trace('identity:direct', {
                durationMs: Date.now() - startedAt,
                ...this.cardTraceData(candidate.card),
                kpId: resolved.kpId,
                kpRating: resolved.kpRating,
                imdbRating: resolved.imdbRating,
                imdbId: resolved.imdbId
            });
            return resolved;
        }

        if (!this.navigationService?.resolve) {
            this.trace('identity:missing-owner', {
                durationMs: Date.now() - startedAt,
                ...this.cardTraceData(candidate.card)
            });
            return { ...candidate, kpId: 0 };
        }

        try {
            const result = await this.navigationService.resolve(candidate.item, {
                sourceName: 'MovieRatingsEnrichmentService.htmlSearch',
                lookupRatings: true,
                requestKey: this.identityRequestKey(candidate.item),
                priority: this.requestPriority(candidate.card, 'visible-identity'),
                sessionId: this.enrichmentSessionId
            });
            const resultOriginalTitle = String(result?.originalTitle || result?.originalName || '').trim();
            if (resultOriginalTitle && candidate.card?.dataset) {
                candidate.card.dataset.movieOriginalTitle = candidate.card.dataset.movieOriginalTitle || resultOriginalTitle;
                candidate.card.dataset.movieEnglishTitle = candidate.card.dataset.movieEnglishTitle || resultOriginalTitle;
            }
            const resolved = {
                ...candidate,
                item: {
                    ...candidate.item,
                    alternativeName: candidate.item.alternativeName || resultOriginalTitle,
                    englishTitle: candidate.item.englishTitle || resultOriginalTitle
                },
                kpId: Number(result?.kinopoiskId || result?.movieId) || 0,
                kpRating: Number(result?.kpRating) || 0,
                imdbRating: Number(result?.imdbRating) || 0,
                imdbId: this.normalizeImdbId(result?.imdbId),
                kpVotes: Number(result?.kpVotes || result?.votes?.kp) || 0,
                imdbVotes: Number(result?.imdbVotes || result?.votes?.imdb) || 0
            };
            this.trace('identity:result', {
                durationMs: Date.now() - startedAt,
                ...this.cardTraceData(candidate.card),
                kpId: resolved.kpId,
                kpRating: resolved.kpRating,
                imdbRating: resolved.imdbRating,
                imdbId: resolved.imdbId,
                originalTitle: resolved.item.englishTitle || resolved.item.alternativeName || null
            });
            return resolved;
        } catch (error) {
            this.trace('identity:error', {
                durationMs: Date.now() - startedAt,
                ...this.cardTraceData(candidate.card),
                message: error.message
            });
            console.warn('[MovieRatings] KP identity lookup failed:', error.message);
            return { ...candidate, kpId: 0 };
        }
    }

    async buildRatingRecord(candidate) {
        const startedAt = Date.now();
        let kpRating = Number(candidate.kpRating) || 0;
        let imdbRating = Number(candidate.imdbRating) || 0;
        let imdbId = this.normalizeImdbId(candidate.imdbId);
        let kpVotes = Number(candidate.kpVotes) || 0;
        let imdbVotes = Number(candidate.imdbVotes) || 0;
        let kpMoviePageAttempted = false;
        this.trace('ratings:start', {
            ...this.cardTraceData(candidate.card),
            kpId: candidate.kpId,
            kpRating,
            imdbRating,
            imdbId,
            imdbPageFallbackAvailable: Boolean(this.imdbParser?.getImdbRating),
            detailFallbackEnabled: this.enableDetailFallback
        });

        // Prefer the already-working hidden Kinopoisk browser context. The
        // movie page displays both KP and IMDb ratings, while IMDb's own
        // hidden iframe search is commonly blocked with HTTP 202/challenge.
        if (this.enableDetailFallback
            && candidate.kpId
            && this.kinopoiskService?.scrapeMoviePageRatingsOffscreen
            && this.hasPendingProvider({
                kpRating,
                imdbRating,
                kpVotes,
                imdbVotes
            })) {
            kpMoviePageAttempted = true;
            try {
                const parsed = await this.kinopoiskService.scrapeMoviePageRatingsOffscreen(candidate.kpId, {
                    mediaType: candidate.item?.mediaType || candidate.item?.type || null,
                    requestKey: `kp-detail:${candidate.kpId}:${candidate.item?.mediaType || candidate.item?.type || 'movie'}`,
                    priority: this.requestPriority(candidate.card, 'visible-ratings'),
                    sessionId: this.enrichmentSessionId
                });
                kpRating = kpRating > 0 ? kpRating : Number(parsed?.kpRating) || 0;
                imdbRating = imdbRating > 0 ? imdbRating : Number(parsed?.imdbRating) || 0;
                imdbId = imdbId || this.normalizeImdbId(parsed?.imdbId);
                kpVotes = kpVotes > 0 ? kpVotes : Number(parsed?.kpVotes || parsed?.votes?.kp) || 0;
                imdbVotes = imdbVotes > 0 ? imdbVotes : Number(parsed?.imdbVotes || parsed?.votes?.imdb) || 0;
                this.trace('ratings:kp-page-result', {
                    ...this.cardTraceData(candidate.card),
                    kpId: candidate.kpId,
                    kpRating,
                    imdbRating,
                    imdbId,
                    source: 'kinopoisk-page'
                });
            } catch (error) {
                this.trace('ratings:kp-page-error', {
                    ...this.cardTraceData(candidate.card),
                    kpId: candidate.kpId,
                    message: error.message
                });
            }
        }

        // Search HTML is the primary KP rating source. Parse the movie page
        // only when the search result did not expose the KP rating.
        if (this.enableDetailFallback && !kpMoviePageAttempted
            && (kpRating <= 0 || kpVotes <= 0) && this.ratingParser?.getKinopoiskRating) {
            try {
                const parsed = await this.ratingParser.getKinopoiskRating(candidate.kpId);
                kpRating = kpRating > 0 ? kpRating : Number(parsed?.rating) || 0;
                kpVotes = kpVotes > 0 ? kpVotes : Number(parsed?.votes) || 0;
                imdbId = imdbId || this.normalizeImdbId(parsed?.imdbId);
            } catch (error) {
                console.warn('[MovieRatings] KP HTML rating fallback failed:', error.message);
            }
        }

        // Direct IMDb rating fallback: only when IMDb rating is missing (<= 0)
        if (this.enableDetailFallback
            && imdbRating <= 0
            && this.imdbParser) {
            try {
                let parsed = null;
                const tmdbId = Number(candidate.item?.tmdbId || candidate.card?.dataset?.tmdbId) || null;

                // 1. If imdbId is not known, try to resolve it from TMDB external_ids
                if (!imdbId && tmdbId && this.tmdbService && typeof this.tmdbService.getExternalIds === 'function') {
                    try {
                        const ext = await this.tmdbService.getExternalIds(
                            tmdbId,
                            candidate.item?.mediaType || candidate.card?.dataset?.mediaType || 'movie'
                        );
                        if (ext?.imdb_id) {
                            imdbId = this.normalizeImdbId(ext.imdb_id);
                        }
                    } catch (e) {
                        console.warn('[MovieRatings] TMDB external_ids fallback failed:', e?.message || e);
                    }
                }

                // 2. Fetch rating by imdbId if available
                if (imdbId && typeof this.imdbParser.getImdbRating === 'function') {
                    parsed = await this.imdbParser.getImdbRating(imdbId);
                }
                // 3. Otherwise, search IMDb by title & year (preferring Latin/English title)
                else if (typeof this.imdbParser.getImdbRatingByTitle === 'function') {
                    const candidateTitles = [
                        candidate.item?.englishTitle,
                        candidate.item?.alternativeName,
                        candidate.item?.originalTitle,
                        candidate.item?.original_title,
                        candidate.item?.originalName,
                        candidate.card?.dataset?.movieEnglishTitle,
                        candidate.card?.dataset?.movieOriginalTitle,
                        candidate.item?.name,
                        candidate.item?.title,
                        candidate.card?.dataset?.movieTitle
                    ].map(t => String(t || '').trim()).filter(Boolean);

                    const latinTitle = candidateTitles.find(t => /[a-zA-Z]/.test(t));
                    const searchTitle = latinTitle || candidateTitles[0] || '';
                    const year = Number(candidate.item?.year || candidate.card?.dataset?.movieYear || String(candidate.item?.releaseDate || candidate.item?.release_date || '').slice(0, 4)) || null;
                    if (searchTitle) {
                        parsed = await this.imdbParser.getImdbRatingByTitle(searchTitle, year);
                    }
                }

                if (parsed) {
                    imdbRating = imdbRating > 0 ? imdbRating : Number(parsed?.rating) || 0;
                    imdbVotes = imdbVotes > 0 ? imdbVotes : Number(parsed?.votes) || 0;
                    imdbId = imdbId || this.normalizeImdbId(parsed?.imdbId);
                }
            } catch (error) {
                console.warn('[MovieRatings] IMDb rating fallback failed:', error.message);
            }
        }

        const result = {
            candidate,
            record: this.createRecord(candidate, {
                status: kpRating > 0 || imdbRating > 0 ? 'resolved' : 'no-ratings',
                kpId: candidate.kpId,
                kpRating,
                imdbRating,
                imdbId,
                votes: { kp: kpVotes, imdb: imdbVotes }
            })
        };
        this.trace('ratings:complete', {
            durationMs: Date.now() - startedAt,
            ...this.cardTraceData(candidate.card),
            kpId: candidate.kpId,
            kpRating,
            imdbRating,
            imdbId,
            status: result.record.status
        });
        return result;
    }

    createRecord(candidate, values = {}) {
        const hasRating = Number(values.kpRating) > 0 || Number(values.imdbRating) > 0;
        const status = values.status || (hasRating ? 'resolved' : 'no-ratings');
        const isNegative = status === 'not-found' || status === 'no-ratings';
        const now = Date.now();
        const kpId = Number(values.kpId || candidate.kpId) || 0;
        const kpRating = Number(values.kpRating) || 0;
        const imdbRating = Number(values.imdbRating) || 0;
        return {
            status,
            kpId,
            kpRating,
            imdbRating,
            votes: {
                kp: Number(values.votes?.kp || candidate.kpVotes) || 0,
                imdb: Number(values.votes?.imdb || candidate.imdbVotes) || 0
            },
            imdbId: values.imdbId || null,
            kpState: values.kpState || (kpRating > 0 ? 'available' : 'unavailable'),
            imdbState: values.imdbState || (imdbRating > 0 ? 'available' : 'unavailable'),
            updatedAt: now,
            expiresAt: now + (
                isNegative
                    ? this.negativeTtlMs
                    : this.cacheTtlMs
            ),
            ...(isNegative ? { retryAfter: now + this.negativeRetryMs } : {}),
            ...(kpId > 0 && kpRating <= 0 ? { kpRetryAfter: now + this.providerRetryMs } : {}),
            ...(imdbRating <= 0 ? {
                imdbRetryAfter: now + this.providerRetryMs,
                imdbAttemptSessionId: this.enrichmentSessionId
            } : {})
        };
    }

    applyRatings(card, record, options = {}) {
        if (record.kpId > 0) card.dataset.movieId = String(record.kpId);
        if (card.classList?.contains('featured-card')) {
            this.updateFeaturedRatings(card, record);
        } else if (typeof MovieCard !== 'undefined' && MovieCard.updateCompactRatings) {
            MovieCard.updateCompactRatings(card, record);
        }
        card.dataset.ratingsState = options.partial || record.status === 'partial' ? 'partial' : 'ready';
        card.dataset.ratingsStatus = record.status;
        if (card.dataset.ratingsState === 'ready') {
            this.observer?.unobserve?.(card);
            this.trackedCards.delete(card);
        }
        this.trace('card:updated', {
            ...this.cardTraceData(card),
            kpRating: record.kpRating,
            imdbRating: record.imdbRating,
            kpState: record.kpState,
            imdbState: record.imdbState,
            status: record.status
        });
    }

    updateFeaturedRatings(card, record) {
        const overlay = card?.querySelector?.('.featured-badge-overlay');
        if (!overlay) return false;

        const badges = [];
        const kpRating = Number(record?.kpRating) || 0;
        const imdbRating = Number(record?.imdbRating) || 0;
        const kpPending = record?.kpState === 'pending'
            || (record?.status === 'partial' && kpRating <= 0);
        const imdbPending = record?.imdbState === 'pending'
            || (record?.status === 'partial' && imdbRating <= 0);
        const isSettled = record?.status !== 'loading' && !kpPending && !imdbPending;
        if (kpPending && kpRating <= 0) {
            badges.push('<span class="featured-rating-badge featured-rating-badge--loading" title="Loading Kinopoisk rating"><span>KP</span><i aria-hidden="true"></i></span>');
        }
        if (kpRating > 0) {
            badges.push(`<span class="featured-rating-badge featured-rating-badge--kp" title="Оценка Кинопоиска">КП ${kpRating.toFixed(1)}</span>`);
        } else if (isSettled) {
            badges.push('<span class="featured-rating-badge featured-rating-badge--unavailable" title="Оценка Кинопоиска недоступна">КП —</span>');
        }
        if (imdbPending && imdbRating <= 0) {
            badges.push('<span class="featured-rating-badge featured-rating-badge--loading" title="Loading IMDb rating"><span>IMDb</span><i aria-hidden="true"></i></span>');
        }
        if (imdbRating > 0) {
            badges.push(`<span class="featured-rating-badge featured-rating-badge--imdb" title="Оценка IMDb">IMDb ${imdbRating.toFixed(1)}</span>`);
        } else if (isSettled) {
            badges.push('<span class="featured-rating-badge featured-rating-badge--unavailable" title="Оценка IMDb недоступна">IMDb —</span>');
        }
        overlay.innerHTML = badges.join('');
        return true;
    }

    itemFromCard(card) {
        const isTmdbOnly = card.dataset.isTmdbOnly === 'true';
        return {
            tmdbId: Number(card.dataset.tmdbId) || null,
            kinopoiskId: isTmdbOnly ? null : (Number(card.dataset.movieId) || null),
            name: card.dataset.movieTitle || '',
            alternativeName: card.dataset.movieOriginalTitle || '',
            englishTitle: card.dataset.movieEnglishTitle || card.dataset.movieOriginalTitle || '',
            year: Number(card.dataset.movieYear) || null,
            mediaType: card.dataset.mediaType || 'movie',
            type: card.dataset.mediaType || 'movie'
        };
    }

    cacheKeyFor(item) {
        const kpId = Number(item.kinopoiskId);
        if (Number.isSafeInteger(kpId) && kpId > 0) return `kp:${kpId}`;
        const tmdbId = Number(item.tmdbId);
        return tmdbId > 0 ? `tmdb:${tmdbId}` : `unknown:${item.name || 'card'}`;
    }

    isUsableCache(record) {
        if (!record || Number(record.expiresAt) <= Date.now()) return false;
        if (this.isNegativeRecord(record)) {
            // Negative records have one shared retry gate. Legacy entries
            // without it are intentionally treated as stale below.
            return Number(record.retryAfter) > Date.now();
        }
        if (this.isProviderRetryExpired(record, 'kpRating', 'kpRetryAfter', Number(record.kpId) > 0)) return false;
        if (Number(record.imdbRating) <= 0 && record.imdbAttemptSessionId !== this.enrichmentSessionId) {
            return false;
        }
        return true;
    }

    isFullyUsableCache(record) {
        if (!record || Number(record.expiresAt) <= Date.now()) return false;
        if (this.isNegativeRecord(record)) return this.isUsableCache(record);
        if (this.isProviderRetryExpired(record, 'kpRating', 'kpRetryAfter', Number(record.kpId) > 0)) return false;
        if (Number(record.imdbRating) <= 0) {
            return record.imdbState === 'unavailable'
                && record.imdbAttemptSessionId === this.enrichmentSessionId
                && Number(record.imdbRetryAfter) > Date.now();
        }
        if (this.hasMissingVotes(record)) return false;
        return true;
    }

    hasMissingVotes(record) {
        const kpRating = Number(record?.kpRating) || 0;
        const imdbRating = Number(record?.imdbRating) || 0;
        const kpVotes = Number(record?.votes?.kp) || 0;
        const imdbVotes = Number(record?.votes?.imdb) || 0;
        return (kpRating > 0 && kpVotes <= 0) || (imdbRating > 0 && imdbVotes <= 0);
    }

    isProviderRetryExpired(record, ratingField, retryField, shouldRetry) {
        if (!shouldRetry || Number(record?.[ratingField]) > 0) return false;

        // Legacy records without provider-specific retry timestamps are stale
        // when one provider never produced a rating.
        const retryAfter = Number(record?.[retryField]);
        return !Number.isFinite(retryAfter) || retryAfter <= Date.now();
    }

    isNegativeRecord(record) {
        return record?.status === 'not-found' || record?.status === 'no-ratings';
    }

    normalizeImdbId(value) {
        const id = String(value || '').trim();
        return /^tt\d{7,10}$/i.test(id) ? id : null;
    }

    async readCache() {
        if (this.cachePromise) return this.cachePromise;
        this.cachePromise = this.storage?.get
            ? new Promise(resolve => this.storage.get([this.cacheKey], result => resolve(result?.[this.cacheKey] || {})))
            : Promise.resolve({});
        return this.cachePromise;
    }

    withCacheWriteLock(callback) {
        const locks = globalThis.navigator?.locks;
        return locks?.request
            ? locks.request(`movie-ratings-cache:${this.cacheKey}`, callback)
            : callback();
    }

    async writeCache(cache) {
        if (!this.storage?.set) return;
        const write = () => this.withCacheWriteLock(async () => {
            const latest = this.storage.get
                ? await new Promise(resolve => this.storage.get([this.cacheKey], result => resolve(result?.[this.cacheKey] || {})))
                : {};
            const merged = { ...latest };
            Object.entries(cache).forEach(([key, value]) => {
                const oldValue = merged[key];
                if (!oldValue || Number(value?.updatedAt) >= Number(oldValue?.updatedAt)) {
                    merged[key] = value;
                }
            });
            const bounded = this.boundCache(merged);
            await new Promise(resolve => this.storage.set({ [this.cacheKey]: bounded }, resolve));
            this.cachePromise = Promise.resolve(bounded);
        });
        this.cacheWritePromise = this.cacheWritePromise.then(write, write);
        return this.cacheWritePromise;
    }

    boundCache(cache) {
        const entries = Object.entries(cache)
            .sort(([, left], [, right]) => Number(right?.updatedAt) - Number(left?.updatedAt));
        return Object.fromEntries(entries.slice(0, this.maxCacheEntries));
    }
}

if (typeof window !== 'undefined') window.MovieRatingsEnrichmentService = MovieRatingsEnrichmentService;
if (typeof globalThis !== 'undefined') globalThis.MovieRatingsEnrichmentService = MovieRatingsEnrichmentService;
if (typeof module !== 'undefined' && module.exports) module.exports = MovieRatingsEnrichmentService;
