/**
 * Loads provider ratings for visible movie cards without blocking the first
 * Home/catalog render. KP identity and provider ratings are resolved through
 * bounded HTML search flows, never through a per-card provider API batch.
 */
class MovieRatingsEnrichmentService {
    // Bumped when "no IMDb rating" records written earlier can no longer be trusted.
    static IMDB_CHECK_VERSION = 2;

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
        // A title without an IMDb rating stays without one for a while; the
        // previous once-per-page-session retry re-scraped such cards on every
        // visit and still showed "IMDb —".
        this.imdbRetryMs = 12 * 60 * 60 * 1000;
        // A failed (not "not found") Kinopoisk search is retried soon.
        this.searchFailureRetryMs = 2 * 60 * 1000;
        this.maxCacheEntries = 1000;
        this.maxCardsPerFlush = options.maxCardsPerFlush || 6;
        // Cached ratings paint together with the card, so this delay only spaces
        // out network work while a list scrolls past.
        this.batchDelayMs = options.batchDelayMs ?? 120;
        this.enableDetailFallback = options.enableDetailFallback === true;
        // Rows about to scroll into view are read ahead and arrive with their ratings.
        this.rootMargin = options.rootMargin || '300px 0px';
        this.pendingCards = new Set();
        this.flushTimer = null;
        this.observer = null;
        this.cachePromise = null;
        this.cacheSnapshot = null;
        this.cacheWriteTimer = null;
        this.identityInFlight = new Map();
        this.graphqlInFlight = new Map();
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

    /**
     * Forget cards removed by a re-render so tracked sets do not keep
     * detached DOM nodes alive.
     */
    releaseDetachedCards() {
        for (const card of this.trackedCards) {
            if (card?.isConnected !== false) continue;
            this.observer?.unobserve?.(card);
            this.pendingCards.delete(card);
            this.trackedCards.delete(card);
        }
    }

    observe(container) {
        if (!container || typeof container.querySelectorAll !== 'function') return;
        this.releaseDetachedCards();
        const found = Array.from(container.querySelectorAll('.movie-card-component, .featured-card'))
            .filter(card => card.dataset.ratingsState !== 'ready');
        // What the cache knows goes on the card before the browser paints it.
        this.paintCachedCards(found);
        const cards = found.filter(card => card.dataset.ratingsState !== 'ready');
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

    /**
     * Applies cached ratings without waiting for a card to scroll into view, so a rendered
     * or re-rendered list shows what is known at once. A record that is only partly usable
     * still paints what it has; the card then goes through the network pass as usual.
     * @param {HTMLElement[]} cards
     */
    paintCachedCards(cards) {
        if (!this.cacheSnapshot) {
            void this.readCache().then(() => {
                if (this.cacheSnapshot) this.paintCachedCards(cards);
            }).catch(() => {});
            return;
        }
        cards.forEach(card => this.paintCachedCard(card, this.cacheSnapshot));
    }

    paintCachedCard(card, cache) {
        const state = card.dataset.ratingsState || '';
        if (!['', 'empty', 'queued'].includes(state)) return;
        const item = this.itemFromCard(card);
        const key = this.cacheKeyFor(item);
        const stored = cache[key];
        if (!stored || !this.isCacheIdentityCompatible(stored, item)) return;
        const cached = this.mergeKinopoiskRecord(stored, cache);
        card.dataset.ratingsEnrichmentKey = key;
        if (this.isFullyUsableCache(cached)) {
            this.applyRatings(card, this.preserveKnownRatings(cached, item));
            if (card.dataset.ratingsState === 'ready') this.pendingCards.delete(card);
            return;
        }
        if (!this.hasAvailableProvider(cached)) return;
        this.applyRatings(card, {
            ...cached,
            status: 'partial',
            kpState: this.knownRating(cached.kpRating) > 0 ? 'available' : 'pending',
            imdbState: this.knownRating(cached.imdbRating) > 0 ? 'available' : 'pending'
        }, { partial: true });
        card.dataset.ratingsState = state;
    }

    enqueueCards(cards) {
        const pendingBefore = this.pendingCards.size;
        let added = 0;
        cards.filter(Boolean).forEach(card => {
            if (['ready', 'loading', 'partial'].includes(card.dataset.ratingsState)) return;
            this.cancelledCardKeys.delete(this.cacheKeyFor(this.itemFromCard(card)));
            if (card.dataset.ratingsEnrichmentKey) this.cancelledCardKeys.delete(card.dataset.ratingsEnrichmentKey);
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
        let repairedCache = false;
        const invalidatedCacheKeys = [];

        for (const card of cards) {
            if (flushGeneration !== this.lifecycleGeneration) return;
            const item = this.itemFromCard(card);
            const key = this.cacheKeyFor(item);
            if (this.cancelledCardKeys.has(key)) continue;
            let cached = cache[key];
            if (cached && !this.isCacheIdentityCompatible(cached, item)) {
                this.trace('cache:identity-mismatch', {
                    ...this.cardTraceData(card),
                    key,
                    cachedKpId: Number(cached.kpId) || null,
                    canonicalKpId: Number(item.kinopoiskId) || null
                });
                delete cache[key];
                invalidatedCacheKeys.push(key);
                cached = null;
            }
            card.dataset.ratingsEnrichmentKey = key;
            const merged = this.mergeKinopoiskRecord(cached, cache);
            if (merged !== cached) {
                cache[key] = merged;
                cached = merged;
                repairedCache = true;
            }
            if (this.isFullyUsableCache(cached)) {
                cacheHits += 1;
                const record = this.preserveKnownRatings(cached, item);
                if (record.kpRating !== cached.kpRating || record.imdbRating !== cached.imdbRating || record.imdbId !== cached.imdbId) {
                    cache[key] = record;
                    repairedCache = true;
                }
                this.applyRatings(card, record);
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
                    kpRating: this.knownRating(cached.kpRating) || this.knownRating(item.kpRating),
                    imdbRating: this.knownRating(cached.imdbRating) || this.knownRating(item.imdbRating),
                    kpVotes: Number(cached.votes?.kp) || 0,
                    imdbVotes: Number(cached.votes?.imdb) || 0,
                    imdbId: this.normalizeImdbId(cached.imdbId) || item.imdbId,
                    kpState: cached.kpState,
                    imdbState: cached.imdbState,
                    identityVerified: cached.identityVerified === true,
                    // An expired record is a starting point, not an answer: it is read again.
                    needsRefresh: !(Number(cached.expiresAt) > Date.now())
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
            if (repairedCache || invalidatedCacheKeys.length > 0) {
                await this.writeCache(this.boundCache(cache), invalidatedCacheKeys);
            }
            this.trace('flush:complete', {
                durationMs: Date.now() - startedAt,
                cacheOnly: true,
                pendingRemaining: this.pendingCards.size
            });
            this.schedulePendingFlush();
            return;
        }

        // A title whose identity is known paints and loads now: a slow search for the
        // card next to it holds nothing back.
        const known = candidates.filter(candidate => Number(candidate.kpId) > 0);
        const unknown = candidates.filter(candidate => !(Number(candidate.kpId) > 0));
        await Promise.all([
            this.startCandidates(known, cache, invalidatedCacheKeys),
            ...unknown.map(async candidate => this.startCandidates([await this.resolveIdentityDedup(candidate)], cache))
        ]);

        this.trace('flush:complete', {
            durationMs: Date.now() - startedAt,
            processed: cards.length,
            cacheHits,
            partialCacheHits,
            networkCandidates: candidates.length,
            pendingRemaining: this.pendingCards.size
        });
        this.schedulePendingFlush();
    }

    /**
     * Shows and stores what is known about these cards, then starts loading what is not.
     * @param {Array<Object>} candidates
     * @param {Object} cache
     * @param {string[]} [removeKeys]
     */
    async startCandidates(candidates, cache, removeKeys = []) {
        const withIdentity = [];
        for (const candidate of candidates) {
            if (Number(candidate.kpId) > 0) {
                this.seedFromKinopoiskRecord(candidate, cache);
                const record = this.createProgressRecord(candidate);
                this.rememberRecord(cache, candidate, record);
                this.paintCandidate(candidate, record, { partial: this.hasPendingProvider(candidate) });
                withIdentity.push(candidate);
            } else {
                this.settleMissingIdentity(candidate, cache);
            }
        }
        if (candidates.length > 0 || removeKeys.length > 0) {
            await this.writeCache(this.boundCache(cache), removeKeys);
        }
        const enrichable = withIdentity.filter(candidate => this.isCardCurrent(candidate)
            && (candidate.needsRefresh === true || this.hasPendingProvider(candidate)));
        if (enrichable.length > 0) this.trackBackgroundWork(this.enrichProvidersInBackground(enrichable));
    }

    /** The kp:<id> record is the one Movie Details and Ratings also update, so it is the freshest. */
    seedFromKinopoiskRecord(candidate, cache) {
        const record = cache?.[`kp:${candidate.kpId}`];
        if (!record || !(Number(record.expiresAt) > Date.now())) return;
        candidate.kpRating = this.knownRating(record.kpRating) || this.knownRating(candidate.kpRating);
        candidate.imdbRating = this.knownRating(record.imdbRating) || this.knownRating(candidate.imdbRating);
        candidate.kpVotes = Number(record.votes?.kp) || Number(candidate.kpVotes) || 0;
        candidate.imdbVotes = Number(record.votes?.imdb) || Number(candidate.imdbVotes) || 0;
        candidate.imdbId = this.normalizeImdbId(candidate.imdbId) || this.normalizeImdbId(record.imdbId);
        // Each provider's answer lasts its own time: Kinopoisk having no rating yet (read
        // again after 15 minutes) does not mean IMDb, checked for 12 hours, is asked again.
        const now = Date.now();
        if (Number(record.kpRetryAfter) > now) candidate.kpChecked = true;
        if (record.imdbState === 'unavailable'
            && Number(record.imdbCheckVersion) >= MovieRatingsEnrichmentService.IMDB_CHECK_VERSION
            && Number(record.imdbRetryAfter) > now) {
            candidate.imdbChecked = true;
            candidate.imdbRetryAfter = Number(record.imdbRetryAfter);
        }
    }

    settleMissingIdentity(candidate, cache) {
        if (candidate.generation !== this.lifecycleGeneration) return;
        // A cancelled search says nothing about the title. A card still on screen
        // (its twin elsewhere on the page was the one cancelled) simply asks again.
        if (candidate.searchFailed && candidate.searchReason === 'REQUEST_CANCELLED') {
            candidate.card.dataset.ratingsState = '';
            if (!this.cancelledCardKeys.has(candidate.key)) this.enqueueCards([candidate.card]);
            return;
        }
        const record = this.createRecord(candidate, {
            status: 'not-found',
            ...(candidate.searchFailed ? { retryAfterMs: this.searchFailureRetryMs } : {})
        });
        cache[candidate.key] = record;
        this.paintCandidate(candidate, record);
        if (this.knownRating(record.imdbRating) <= 0 && candidate.item?.isTmdbOnly) {
            this.trackBackgroundWork(this.readImdbWithoutIdentity(candidate, cache));
        }
    }

    /**
     * Kinopoisk not knowing a title says nothing about IMDb: TMDB has its exact IMDb ID.
     * The record stays negative, so Kinopoisk is still asked again after the usual wait.
     */
    async readImdbWithoutIdentity(candidate, cache) {
        candidate.imdbId = this.normalizeImdbId(candidate.imdbId) || this.normalizeImdbId(candidate.item?.imdbId);
        await this.prefetchImdbRatings([candidate]);
        if (this.knownRating(candidate.imdbRating) <= 0 || !this.isCardCurrent(candidate)) return;
        const record = this.createRecord(candidate, {
            status: 'not-found',
            imdbRating: candidate.imdbRating,
            imdbId: candidate.imdbId,
            votes: { imdb: candidate.imdbVotes },
            imdbAnswered: true,
            ...(candidate.searchFailed ? { retryAfterMs: this.searchFailureRetryMs } : {})
        });
        (this.cacheSnapshot || cache)[candidate.key] = record;
        this.paintCandidate(candidate, record);
        await this.flushCacheWrite();
    }

    /** A record of what is known so far; a provider nobody has answered for stays pending. */
    createProgressRecord(candidate) {
        const kpRating = this.knownRating(candidate.kpRating);
        const imdbRating = this.knownRating(candidate.imdbRating);
        const pending = this.hasPendingProvider(candidate);
        return this.createRecord(candidate, {
            status: pending ? 'partial' : (kpRating > 0 || imdbRating > 0 ? 'resolved' : 'no-ratings'),
            kpId: candidate.kpId,
            kpRating,
            imdbRating,
            imdbId: candidate.imdbId,
            kpState: kpRating > 0 ? 'available' : (candidate.kpChecked === true ? 'unavailable' : 'pending'),
            imdbState: imdbRating > 0 ? 'available' : (candidate.imdbChecked === true ? 'unavailable' : 'pending'),
            imdbAnswered: candidate.imdbChecked === true,
            imdbRetryAfter: candidate.imdbRetryAfter
        });
    }

    rememberRecord(cache, candidate, record) {
        cache[candidate.key] = record;
        cache[`kp:${candidate.kpId}`] = record;
    }

    /** @returns {boolean} true when the card took the record */
    paintCandidate(candidate, record, options = {}) {
        if (!this.isCardCurrent(candidate)) return false;
        const painted = this.applyRatings(candidate.card, record, options);
        // A card that left the screen is picked up again when it returns.
        if (!painted || (this.cancelledCardKeys.has(candidate.key) && candidate.card.dataset.ratingsState !== 'ready')) {
            candidate.card.dataset.ratingsState = '';
        }
        return painted;
    }

    trackBackgroundWork(work) {
        const tracked = work.catch(error => {
            this.trace('stageB:error', { message: error?.message || 'ENRICHMENT_BACKGROUND_FAILED' });
        });
        this.lastBackgroundEnrichment = Promise.allSettled([this.lastBackgroundEnrichment, tracked]);
    }

    /**
     * Each card takes its answer as soon as it has one, cheapest source first: Kinopoisk's
     * GraphQL (one quick request per title), then one IMDb request for what Kinopoisk does
     * not know, and the hidden Kinopoisk page only for what is still missing. Every answer is
     * kept, whether or not its card is still on screen.
     * @param {Array<Object>} candidates
     */
    async enrichProvidersInBackground(candidates) {
        const startedAt = Date.now();
        let updatedCards = 0;
        const finish = async candidate => {
            candidate.finished = true;
            let record;
            try {
                ({ record } = await this.buildRatingRecordDedup(candidate));
            } catch (error) {
                record = this.createRecord(candidate, {
                    status: this.hasAvailableProvider(candidate) ? 'partial' : 'no-ratings',
                    kpId: candidate.kpId,
                    kpRating: candidate.kpRating,
                    imdbRating: candidate.imdbRating,
                    imdbId: candidate.imdbId,
                    kpState: Number(candidate.kpRating) > 0 ? 'available' : 'unavailable',
                    imdbState: Number(candidate.imdbRating) > 0 ? 'available' : 'unavailable',
                    imdbAnswered: false,
                    error: error?.message || 'ENRICHMENT_FAILED'
                });
            }
            if (await this.saveResult(candidate, record)) updatedCards += 1;
        };

        await Promise.all(candidates.map(async candidate => {
            await this.readGraphqlRatings(candidate);
            if (!candidate.graphqlChecked) return;
            if (this.hasPendingProvider(candidate)) await this.saveProgress(candidate);
            else await finish(candidate);
        }));

        const waiting = candidates.filter(candidate => !candidate.finished);
        if (waiting.some(candidate => this.hasPendingProvider(candidate))) {
            try {
                await this.prefetchImdbRatings(waiting);
            } catch (error) {
                this.trace('imdb:batch-error', { message: error?.message || String(error) });
            }
        }
        await Promise.all(waiting.map(finish));
        await this.flushCacheWrite();

        this.trace('stageB:complete', {
            durationMs: Date.now() - startedAt,
            processed: candidates.length,
            updatedCards
        });
    }

    /** Kinopoisk's own answer: both ratings with vote counts for most titles. */
    async readGraphqlRatings(candidate) {
        const service = this.kinopoiskService;
        if (!this.enableDetailFallback || typeof service?.movieRatingsViaGraphql !== 'function') return;
        let ratings = null;
        try {
            ratings = await this.withInFlight(this.graphqlInFlight, `graphql:${candidate.kpId}`,
                () => service.movieRatingsViaGraphql(candidate.kpId));
        } catch (error) {
            this.trace('graphql:error', { kpId: candidate.kpId, message: error?.message || String(error) });
        }
        candidate.graphqlChecked = true;
        candidate.graphqlRatings = ratings || null;
        if (!ratings) return;
        // A fresh answer replaces what the cache remembered.
        candidate.kpRating = this.knownRating(ratings.kpRating) || this.knownRating(candidate.kpRating);
        candidate.kpVotes = Number(ratings.kpVotes) || Number(candidate.kpVotes) || 0;
        candidate.kpChecked = true;
        if (ratings.imdbAnswered) {
            candidate.imdbRating = this.knownRating(ratings.imdbRating) || this.knownRating(candidate.imdbRating);
            candidate.imdbVotes = Number(ratings.imdbVotes) || Number(candidate.imdbVotes) || 0;
            candidate.imdbChecked = true;
        }
    }

    async saveProgress(candidate) {
        const cache = await this.readCache();
        const record = this.createProgressRecord(candidate);
        this.rememberRecord(cache, candidate, record);
        this.paintCandidate(candidate, record, { partial: true });
        this.scheduleCacheWrite();
    }

    /** @returns {Promise<boolean>} true when the card took the record */
    async saveResult(candidate, record) {
        // A card that left the screen gave up its hidden page: IMDb is unknown there, not absent.
        const interrupted = this.cancelledCardKeys.has(candidate.key)
            && this.knownRating(record.imdbRating) <= 0
            && record.imdbCheckVersion === undefined;
        const final = interrupted ? { ...record, status: 'partial', imdbState: 'pending' } : record;
        const cache = await this.readCache();
        this.rememberRecord(cache, candidate, final);
        const painted = this.paintCandidate(candidate, final, interrupted ? { partial: true } : {});
        this.scheduleCacheWrite();
        return painted;
    }

    scheduleCacheWrite() {
        if (this.cacheWriteTimer) return;
        this.cacheWriteTimer = setTimeout(() => { void this.flushCacheWrite(); }, 250);
    }

    flushCacheWrite() {
        if (this.cacheWriteTimer) clearTimeout(this.cacheWriteTimer);
        this.cacheWriteTimer = null;
        return this.writeCache(this.boundCache(this.cacheSnapshot || {}));
    }

    /**
     * Fill IMDb ratings for many cards with one proxied GraphQL request.
     * IMDb IDs come from the card, the KP search result, or TMDB external IDs.
     * Candidates are updated in place; `imdbChecked` marks titles IMDb
     * answered for, so a title without an IMDb rating does not trigger a
     * hidden Kinopoisk page load just to look for one.
     * @param {Array<Object>} candidates
     */
    async prefetchImdbRatings(candidates = []) {
        if (!this.imdbParser?.getImdbRatingsBatch) return;
        // While the proxy is down (or not deployed) TMDB external_ids lookups
        // would be wasted; the KP movie page supplies IMDb instead.
        if (this.imdbParser.isRatingsProxyAvailable && !this.imdbParser.isRatingsProxyAvailable()) return;
        const missing = candidates.filter(candidate => !(Number(candidate.imdbRating) > 0) && candidate.imdbChecked !== true);
        if (missing.length === 0) return;

        await Promise.all(missing.map(async candidate => {
            if (this.normalizeImdbId(candidate.imdbId)) return;
            const tmdbId = Number(candidate.item?.tmdbId || candidate.card?.dataset?.tmdbId) || null;
            if (!tmdbId || typeof this.tmdbService?.getExternalIds !== 'function') return;
            try {
                const external = await this.tmdbService.getExternalIds(
                    tmdbId,
                    this.isTvMediaType(candidate.item?.mediaType || candidate.card?.dataset?.mediaType) ? 'tv' : 'movie'
                );
                candidate.imdbId = this.normalizeImdbId(external?.imdb_id) || candidate.imdbId || null;
            } catch (error) {
                this.trace('imdb:external-ids-error', { tmdbId, message: error?.message || String(error) });
            }
        }));

        const ids = missing.map(candidate => this.normalizeImdbId(candidate.imdbId)).filter(Boolean);
        if (ids.length === 0) return;
        const startedAt = Date.now();
        const ratings = await this.imdbParser.getImdbRatingsBatch(ids);
        this.trace('imdb:batch', {
            durationMs: Date.now() - startedAt,
            requested: ids.length,
            answered: ratings ? ratings.size : null
        });
        if (!ratings) return;
        missing.forEach(candidate => {
            const id = this.normalizeImdbId(candidate.imdbId);
            const value = id ? ratings.get(id) : null;
            if (!value) return;
            candidate.imdbChecked = true;
            if (value.rating > 0) {
                candidate.imdbRating = value.rating;
                candidate.imdbVotes = value.votes || candidate.imdbVotes || 0;
            }
        });
    }

    isTvMediaType(value) {
        return ['tv', 'tv-series', 'series', 'mini-series', 'tv-show', 'animated-series'].includes(String(value || '').toLowerCase());
    }

    async resolveIdentityDedup(candidate) {
        const item = candidate.item || {};
        const title = this.normalizeIdentityTitle(item.name || item.title || item.alternativeName || item.originalTitle);
        const year = Number(item.year) || 0;
        const mediaType = item.mediaType || item.type || 'movie';
        // Two films can share a name and a year; the original name keeps them apart.
        const original = this.normalizeIdentityTitle(item.originalTitle || item.alternativeName);
        const key = `identity:${title}|${original}|${year}|${mediaType}`;
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
        // Cards of one title share the requests, but each gets a record with its own identity:
        // a record built for another card would not pass this card's identity check.
        const ratings = await this.withInFlight(this.ratingsInFlight, key, () => this.fetchProviderRatings(candidate));
        return {
            candidate,
            record: this.createRecord(candidate, {
                status: ratings.kpRating > 0 || ratings.imdbRating > 0 ? 'resolved' : 'no-ratings',
                kpId: candidate.kpId,
                kpRating: ratings.kpRating,
                imdbRating: ratings.imdbRating,
                imdbId: ratings.imdbId,
                votes: { kp: ratings.kpVotes, imdb: ratings.imdbVotes },
                imdbAnswered: ratings.imdbAnswered || candidate.imdbChecked === true,
                imdbRetryAfter: candidate.imdbRetryAfter
            })
        };
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

    // Vote counts are not required: compact cards do not display them, and
    // waiting for them forced an extra hidden Kinopoisk page per card.
    hasPendingProvider(candidate) {
        const kpRating = Number(candidate?.kpRating) || 0;
        const imdbRating = Number(candidate?.imdbRating) || 0;
        return (kpRating <= 0 && candidate?.kpChecked !== true)
            || (imdbRating <= 0 && candidate?.imdbChecked !== true);
    }

    hasAvailableProvider(candidate) {
        return Number(candidate?.kpRating) > 0 || Number(candidate?.imdbRating) > 0;
    }

    /** The card still shows this title and the page is still alive. */
    isCardCurrent(candidate) {
        const key = candidate?.card?.dataset?.ratingsEnrichmentKey;
        return candidate?.generation === this.lifecycleGeneration
            && (!key || key === candidate.key);
    }

    /**
     * A card that left the screen stops waiting for a hidden page, which the visible cards
     * need more. Answers already on their way are still kept. A card that never started
     * has nothing to cancel, which is every card off screen when a list first renders.
     */
    cancelCard(card, { notify = true } = {}) {
        if (!card) return;
        this.pendingCards.delete(card);
        if (!['queued', 'loading', 'partial'].includes(card.dataset.ratingsState)) return;
        const item = this.itemFromCard(card);
        // Work already started goes by the key it started under, whatever the card has learned since.
        const key = card.dataset.ratingsEnrichmentKey || this.cacheKeyFor(item);
        const requestKey = this.requestKeyForCard(item, card);
        this.cancelledCardKeys.add(key);
        card.dataset.ratingsState = '';
        if (notify && requestKey && globalThis.chrome?.runtime?.sendMessage) {
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

    /** The page is going away: its queued hidden pages must not hold the slots for the next one. */
    cancelSession() {
        if (!globalThis.chrome?.runtime?.sendMessage) return;
        try {
            const response = globalThis.chrome.runtime.sendMessage({
                type: 'KINOPOISK_OFFSCREEN_CANCEL_SESSION',
                sessionId: this.enrichmentSessionId
            });
            response?.catch?.(() => {});
        } catch {
            // The page is closing; a frame left running ends at its own timeout.
        }
    }

    dispose() {
        this.cancelSession();
        for (const card of this.trackedCards) this.cancelCard(card, { notify: false });
        this.trackedCards.clear();
        this.lifecycleGeneration += 1;
        this.observer?.disconnect?.();
        this.observer = null;
        this.pendingCards.clear();
        this.identityInFlight.clear();
        this.graphqlInFlight.clear();
        this.ratingsInFlight.clear();
        if (this.flushTimer) clearTimeout(this.flushTimer);
        this.flushTimer = null;
        if (this.cacheWriteTimer) void this.flushCacheWrite();
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
                identityVerified: true,
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
                sessionId: this.enrichmentSessionId,
                reportFailure: true
            });
            if (result?.failed) {
                this.trace('identity:search-failed', { ...this.cardTraceData(candidate.card), reason: result.reason });
                return { ...candidate, kpId: 0, searchFailed: true, searchReason: result.reason };
            }
            const resultOriginalTitle = String(result?.originalTitle || result?.originalName || '').trim();
            const identityVerified = !candidate.item.isTmdbOnly
                || (result?.verified === true && this.isTmdbIdentityCompatible(result, candidate.item));
            if (resultOriginalTitle && candidate.card?.dataset) {
                if (identityVerified) {
                    candidate.card.dataset.movieOriginalTitle = candidate.card.dataset.movieOriginalTitle || resultOriginalTitle;
                    candidate.card.dataset.movieEnglishTitle = candidate.card.dataset.movieEnglishTitle || resultOriginalTitle;
                }
            }
            const resolved = {
                ...candidate,
                identityVerified,
                item: {
                    ...candidate.item,
                    alternativeName: candidate.item.alternativeName || resultOriginalTitle,
                    englishTitle: candidate.item.englishTitle || resultOriginalTitle
                },
                kpId: identityVerified ? Number(result?.kinopoiskId || result?.movieId) || 0 : 0,
                kpRating: (identityVerified ? this.knownRating(result?.kpRating) : 0)
                    || this.knownRating(candidate.item.kpRating),
                imdbRating: (identityVerified ? this.knownRating(result?.imdbRating) : 0)
                    || this.knownRating(candidate.item.imdbRating),
                imdbId: (identityVerified ? this.normalizeImdbId(result?.imdbId) : null) || candidate.item.imdbId,
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

    /**
     * The sources that can answer for this title after GraphQL and the IMDb batch.
     * @returns {Promise<{kpRating:number,imdbRating:number,imdbId:string|null,kpVotes:number,imdbVotes:number,imdbAnswered:boolean}>}
     */
    async fetchProviderRatings(candidate) {
        const startedAt = Date.now();
        let kpRating = Number(candidate.kpRating) || 0;
        let imdbRating = Number(candidate.imdbRating) || 0;
        let imdbId = this.normalizeImdbId(candidate.imdbId);
        let kpVotes = Number(candidate.kpVotes) || 0;
        let imdbVotes = Number(candidate.imdbVotes) || 0;
        let kpMoviePageAttempted = false;
        const imdbChecked = candidate.imdbChecked === true;
        const kpChecked = candidate.kpChecked === true;
        // A card that left the screen does not spend a hidden page; it asks again on return.
        const offScreen = this.cancelledCardKeys.has(candidate.key);
        // True once IMDb data was actually read (batch answer or a parsed
        // Kinopoisk page). A failed scrape must not cache "no IMDb" for 12 hours.
        let imdbAnswered = imdbChecked;
        this.trace('ratings:start', {
            ...this.cardTraceData(candidate.card),
            kpId: candidate.kpId,
            kpRating,
            imdbRating,
            imdbId,
            detailFallbackEnabled: this.enableDetailFallback
        });

        // Prefer the already-working hidden Kinopoisk browser context. The
        // movie page displays both KP and IMDb ratings, while IMDb's own
        // hidden iframe search is commonly blocked with HTTP 202/challenge.
        if (this.enableDetailFallback
            && !offScreen
            && candidate.kpId
            && this.kinopoiskService?.scrapeMoviePageRatingsOffscreen
            && this.hasPendingProvider({ kpRating, imdbRating, imdbChecked, kpChecked })) {
            kpMoviePageAttempted = true;
            try {
                const parsed = await this.kinopoiskService.scrapeMoviePageRatingsOffscreen(candidate.kpId, {
                    mediaType: candidate.item?.mediaType || candidate.item?.type || null,
                    requestKey: `kp-detail:${candidate.kpId}:${candidate.item?.mediaType || candidate.item?.type || 'movie'}`,
                    priority: this.requestPriority(candidate.card, 'visible-ratings'),
                    sessionId: this.enrichmentSessionId,
                    // GraphQL was asked a moment ago; the page need not repeat it.
                    ...(candidate.graphqlChecked ? { graphqlRatings: candidate.graphqlRatings } : {})
                });
                if (parsed && parsed.imdbAnswered !== false) imdbAnswered = true;
                kpRating = this.knownRating(parsed?.kpRating) || kpRating;
                imdbRating = this.knownRating(parsed?.imdbRating) || imdbRating;
                imdbId = imdbId || this.normalizeImdbId(parsed?.imdbId);
                kpVotes = Number(parsed?.kpVotes || parsed?.votes?.kp) || kpVotes;
                imdbVotes = Number(parsed?.imdbVotes || parsed?.votes?.imdb) || imdbVotes;
                this.trace('ratings:kp-page-result', {
                    ...this.cardTraceData(candidate.card),
                    kpId: candidate.kpId,
                    kpRating,
                    imdbRating,
                    imdbId,
                    source: parsed?.source || 'kinopoisk-page'
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
        if (this.enableDetailFallback && !kpMoviePageAttempted && !offScreen && !kpChecked
            && kpRating <= 0 && this.ratingParser?.getKinopoiskRating) {
            try {
                const parsed = await this.ratingParser.getKinopoiskRating(candidate.kpId);
                kpRating = kpRating > 0 ? kpRating : Number(parsed?.rating) || 0;
                kpVotes = kpVotes > 0 ? kpVotes : Number(parsed?.votes) || 0;
                imdbId = imdbId || this.normalizeImdbId(parsed?.imdbId);
            } catch (error) {
                console.warn('[MovieRatings] KP HTML rating fallback failed:', error.message);
            }
        }

        // IMDb is read in batches by prefetchImdbRatings(); direct IMDb page
        // and suggestion fetches are blocked for extension pages (HTTP 202
        // challenge, no CORS) and are no longer attempted per card.

        this.trace('ratings:complete', {
            durationMs: Date.now() - startedAt,
            ...this.cardTraceData(candidate.card),
            kpId: candidate.kpId,
            kpRating,
            imdbRating,
            imdbId
        });
        return { kpRating, imdbRating, imdbId, kpVotes, imdbVotes, imdbAnswered };
    }

    /**
     * Cards opened from TMDB-only feeds are cached under a tmdb: key, while Movie
     * Details stores what it found on the Kinopoisk page under kp:<id>. Without
     * this merge the card kept an old "no IMDb rating" result for up to 12 hours
     * although the details page already showed the rating.
     * @returns {Object} the same record when nothing new is known
     */
    mergeKinopoiskRecord(record, cache) {
        const kpId = Number(record?.kpId) || 0;
        const kpRecord = kpId > 0 ? cache?.[`kp:${kpId}`] : null;
        if (!record || !kpRecord || kpRecord === record) return record;
        // Both describe one title: the newer record's values win, the other fills its gaps.
        const kpIsNewer = Number(kpRecord.updatedAt) > Number(record.updatedAt);
        const [first, second] = kpIsNewer ? [kpRecord, record] : [record, kpRecord];
        const kpRating = this.knownRating(first.kpRating) || this.knownRating(second.kpRating);
        const imdbRating = this.knownRating(first.imdbRating) || this.knownRating(second.imdbRating);
        const votes = {
            kp: Number(first.votes?.kp) || Number(second.votes?.kp) || 0,
            imdb: Number(first.votes?.imdb) || Number(second.votes?.imdb) || 0
        };
        const imdbId = this.normalizeImdbId(first.imdbId) || this.normalizeImdbId(second.imdbId);
        if (kpIsNewer) {
            return this.preserveKnownRatings({
                ...kpRecord,
                tmdbId: record.tmdbId,
                name: record.name,
                year: record.year,
                mediaType: record.mediaType,
                identityVerified: record.identityVerified,
                kpRating,
                imdbRating,
                votes,
                imdbId
            });
        }
        const unchanged = kpRating === this.knownRating(record.kpRating)
            && imdbRating === this.knownRating(record.imdbRating)
            && votes.kp === (Number(record.votes?.kp) || 0)
            && votes.imdb === (Number(record.votes?.imdb) || 0)
            && imdbId === this.normalizeImdbId(record.imdbId);
        if (unchanged) return record;
        return this.preserveKnownRatings({ ...record, votes, imdbId }, { kpRating, imdbRating });
    }

    knownRating(value) {
        const rating = Number(value);
        return Number.isFinite(rating) && rating > 0 ? rating : 0;
    }

    preserveKnownRatings(record, known = {}) {
        const kpRating = this.knownRating(record.kpRating) || this.knownRating(known.kpRating);
        const imdbRating = this.knownRating(record.imdbRating) || this.knownRating(known.imdbRating);
        return {
            ...record,
            kpRating,
            imdbRating,
            imdbId: this.normalizeImdbId(record.imdbId) || this.normalizeImdbId(known.imdbId),
            ...(kpRating > 0 ? { kpState: 'available' } : {}),
            ...(imdbRating > 0 ? { imdbState: 'available' } : {}),
            ...(record.status === 'no-ratings' && (kpRating > 0 || imdbRating > 0) ? { status: 'resolved' } : {}),
            ...(record.status === 'partial' && kpRating > 0 && imdbRating > 0 ? { status: 'resolved' } : {})
        };
    }

    createRecord(candidate, values = {}) {
        values = this.preserveKnownRatings(values, this.preserveKnownRatings(candidate, candidate.item));
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
            tmdbId: Number(candidate.item?.tmdbId) || null,
            name: String(candidate.item?.name || candidate.item?.title || '').trim(),
            year: Number(candidate.item?.year) || null,
            mediaType: candidate.item?.mediaType || candidate.item?.type || null,
            identityVerified: candidate.identityVerified === true || Number(candidate.item?.kinopoiskId) > 0,
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
            ...(isNegative ? { retryAfter: now + (Number(values.retryAfterMs) || this.negativeRetryMs) } : {}),
            ...(kpId > 0 && kpRating <= 0 ? { kpRetryAfter: now + this.providerRetryMs } : {}),
            ...(imdbRating <= 0 && values.imdbAnswered !== false ? { imdbCheckVersion: MovieRatingsEnrichmentService.IMDB_CHECK_VERSION } : {}),
            ...(imdbRating <= 0 ? {
                // An answer read from an earlier record keeps its own expiry.
                imdbRetryAfter: Number(values.imdbRetryAfter) || now + (values.imdbAnswered === false ? this.providerRetryMs : this.imdbRetryMs),
                imdbAttemptSessionId: this.enrichmentSessionId
            } : {})
        };
    }

    applyRatings(card, record, options = {}) {
        const item = this.itemFromCard(card);
        if (!this.isCacheIdentityCompatible(record, item)) {
            this.trace('card:identity-mismatch', {
                ...this.cardTraceData(card),
                cachedKpId: Number(record?.kpId) || null,
                canonicalKpId: Number(item.kinopoiskId) || null
            });
            return false;
        }
        record = this.preserveKnownRatings(record, this.itemFromCard(card));
        if (record.kpRating > 0) card.dataset.kpRating = String(record.kpRating);
        if (record.imdbRating > 0) card.dataset.imdbRating = String(record.imdbRating);
        if (record.imdbId) card.dataset.imdbId = record.imdbId;
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
        return true;
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
        const label = (key, fallback) => {
            const fullKey = `home.${key}`;
            const value = globalThis.i18n?.get?.(fullKey);
            return value && value !== fullKey ? value : fallback;
        };
        if (kpPending && kpRating <= 0) {
            badges.push(`<span class="featured-rating-badge featured-rating-badge--loading" aria-label="${label('rating_kp_loading', 'Загрузка рейтинга КП')}"><span>КП</span><i aria-hidden="true"></i></span>`);
        }
        if (kpRating > 0) {
            badges.push(`<span class="featured-rating-badge featured-rating-badge--kp" title="${label('rating_kp', 'Оценка Кинопоиска')}">КП ${kpRating.toFixed(1)}</span>`);
        } else if (isSettled) {
            badges.push(`<span class="featured-rating-badge featured-rating-badge--unavailable" title="${label('rating_kp_unavailable', 'Оценка Кинопоиска недоступна')}">КП —</span>`);
        }
        if (imdbPending && imdbRating <= 0) {
            badges.push(`<span class="featured-rating-badge featured-rating-badge--loading" aria-label="${label('rating_imdb_loading', 'Загрузка рейтинга IMDb')}"><span>IMDb</span><i aria-hidden="true"></i></span>`);
        }
        if (imdbRating > 0) {
            badges.push(`<span class="featured-rating-badge featured-rating-badge--imdb" title="${label('rating_imdb', 'Оценка IMDb')}">IMDb ${imdbRating.toFixed(1)}</span>`);
        } else if (isSettled) {
            badges.push(`<span class="featured-rating-badge featured-rating-badge--unavailable" title="${label('rating_imdb_unavailable', 'Оценка IMDb недоступна')}">IMDb —</span>`);
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
            searchTitle: card.dataset.movieSearchTitle || '',
            year: Number(card.dataset.movieYear) || null,
            kpRating: this.knownRating(card.dataset.kpRating),
            imdbRating: this.knownRating(card.dataset.imdbRating),
            imdbId: this.normalizeImdbId(card.dataset.imdbId),
            isTmdbOnly,
            mediaType: card.dataset.mediaType || 'movie',
            type: card.dataset.mediaType || 'movie'
        };
    }

    cacheKeyFor(item) {
        const kpId = Number(item.kinopoiskId);
        if (Number.isSafeInteger(kpId) && kpId > 0) return `kp:${kpId}`;
        const tmdbId = Number(item.tmdbId);
        if (tmdbId > 0) return `tmdb:${this.isTvMediaType(item.mediaType || item.type) ? 'tv' : 'movie'}:${tmdbId}`;
        return `unknown:${item.name || 'card'}`;
    }

    isCacheIdentityCompatible(record, item) {
        if (!record || !item) return false;
        const canonicalKinopoiskId = Number(item.kinopoiskId) || 0;
        const recordKinopoiskId = Number(record.kpId) || 0;
        if (canonicalKinopoiskId > 0) {
            return recordKinopoiskId <= 0 || recordKinopoiskId === canonicalKinopoiskId;
        }
        if (item.isTmdbOnly === true) {
            return this.isTmdbIdentityCompatible(record, item)
                && (recordKinopoiskId <= 0 || record.identityVerified === true);
        }
        return true;
    }

    isTmdbIdentityCompatible(candidate, item) {
        const tmdbId = Number(item?.tmdbId) || 0;
        if (tmdbId <= 0 || Number(candidate?.tmdbId) !== tmdbId) return false;
        const expectedYear = Number(item?.year) || 0;
        const candidateYear = Number(candidate?.year) || 0;
        if (expectedYear <= 0 || candidateYear <= 0 || Math.abs(expectedYear - candidateYear) > 1) return false;
        if (this.isTvMediaType(item?.mediaType || item?.type)
            !== this.isTvMediaType(candidate?.mediaType || candidate?.type)) return false;
        const expectedTitles = [item?.name, item?.alternativeName, item?.englishTitle, item?.searchTitle]
            .map(title => this.normalizeIdentityTitle(title)).filter(Boolean);
        const candidateTitles = [candidate?.name, candidate?.title, candidate?.originalTitle, candidate?.originalName]
            .map(title => this.normalizeIdentityTitle(title)).filter(Boolean);
        return expectedTitles.length > 0 && expectedTitles.some(title => candidateTitles.includes(title));
    }

    isUsableCache(record) {
        if (!record || Number(record.expiresAt) <= Date.now()) return false;
        if (this.isNegativeRecord(record)) {
            // Negative records have one shared retry gate. Legacy entries
            // without it are intentionally treated as stale below.
            return Number(record.retryAfter) > Date.now();
        }
        if (this.isProviderRetryExpired(record, 'kpRating', 'kpRetryAfter', Number(record.kpId) > 0)) return false;
        if (Number(record.imdbRating) <= 0 && !(Number(record.imdbRetryAfter) > Date.now())) {
            return false;
        }
        return true;
    }

    isFullyUsableCache(record) {
        if (!record || Number(record.expiresAt) <= Date.now()) return false;
        if (this.isNegativeRecord(record)) return this.isUsableCache(record);
        if (this.isProviderRetryExpired(record, 'kpRating', 'kpRetryAfter', Number(record.kpId) > 0)) return false;
        if (Number(record.imdbRating) <= 0) {
            // A settled "no IMDb rating" result is reused until its retry time
            // instead of only within the current page session.
            // Records from before imdbCheckVersion 2 may hold a failed scrape as
            // "no IMDb rating"; they are checked once more (now via GraphQL).
            return record.imdbState === 'unavailable'
                && Number(record.imdbRetryAfter) > Date.now()
                && Number(record.imdbCheckVersion) >= MovieRatingsEnrichmentService.IMDB_CHECK_VERSION;
        }
        return true;
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
        this.cachePromise = (this.storage?.get
            ? new Promise(resolve => this.storage.get([this.cacheKey], result => resolve(result?.[this.cacheKey] || {})))
            : Promise.resolve({})
        ).then(cache => {
            this.cacheSnapshot = cache;
            return cache;
        });
        return this.cachePromise;
    }

    withCacheWriteLock(callback) {
        const locks = globalThis.navigator?.locks;
        return locks?.request
            ? locks.request(`movie-ratings-cache:${this.cacheKey}`, callback)
            : callback();
    }

    async writeCache(cache, removeKeys = []) {
        if (!this.storage?.set) return;
        const write = () => this.withCacheWriteLock(async () => {
            const latest = this.storage.get
                ? await new Promise(resolve => this.storage.get([this.cacheKey], result => resolve(result?.[this.cacheKey] || {})))
                : {};
            const merged = { ...latest };
            removeKeys.forEach(key => delete merged[key]);
            Object.entries(cache).forEach(([key, value]) => {
                const oldValue = merged[key];
                if (!oldValue || Number(value?.updatedAt) >= Number(oldValue?.updatedAt)) {
                    merged[key] = value;
                }
            });
            const bounded = this.boundCache(merged);
            await new Promise(resolve => this.storage.set({ [this.cacheKey]: bounded }, resolve));
            this.cachePromise = Promise.resolve(bounded);
            this.cacheSnapshot = bounded;
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
