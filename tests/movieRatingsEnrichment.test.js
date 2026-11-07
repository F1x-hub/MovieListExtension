const assert = require('node:assert/strict');
const MovieRatingsEnrichmentService = require('../src/shared/services/MovieRatingsEnrichmentService.js');

function createCard(tmdbId) {
    const overlay = { innerHTML: '', dataset: {} };
    return {
        dataset: {
            tmdbId: String(tmdbId),
            movieTitle: `Movie ${tmdbId}`,
            movieYear: '2026',
            mediaType: 'movie'
        },
        overlay,
        querySelector(selector) {
            return selector === '.mc-badges-overlay' ? overlay : null;
        }
    };
}

const storage = {
    values: {},
    get(keys, callback) {
        callback({ movie_card_ratings_v4: this.values.movie_card_ratings_v4 });
    },
    set(values, callback) {
        Object.assign(this.values, values);
        callback?.();
    }
};

const batchCalls = [];
let navigationCalls = 0;
let apiBatchCalls = 0;
let imdbBatchCalls = 0;
global.MovieCard = {
    updateCompactRatings(card, ratings) {
        card.appliedRatings = ratings;
    }
};

async function flushAndWaitForProviders(service) {
    await service.flushPendingCards();
    await service.lastBackgroundEnrichment;
}

async function run() {
const service = new MovieRatingsEnrichmentService({
    storage,
    enableDetailFallback: true,
    navigationService: {
        async resolve(item) {
            navigationCalls += 1;
            return {
                kinopoiskId: Number(item.tmdbId) + 1000,
                kpRating: 7.4,
                imdbId: 'tt1234567',
            };
        }
    },
    imdbParser: {
        async getImdbRatingsBatch(imdbIds) {
            imdbBatchCalls += 1;
            assert.deepEqual(imdbIds, ['tt1234567']);
            return new Map([['tt1234567', { rating: 8.1, votes: 1000 }]]);
        }
    },
    kinopoiskService: {
        async getMoviesByIdsBatch(items) {
            apiBatchCalls += 1;
            throw new Error(`API batch must not be called for card ratings: ${items.length}`);
        },
        async scrapeMoviePageRatingsOffscreen() {
            throw new Error('The KP movie page must not load when the IMDb batch answered');
        }
    }
});

const firstCard = createCard(42);
service.pendingCards.add(firstCard);
await flushAndWaitForProviders(service);

assert.equal(navigationCalls, 1);
assert.equal(imdbBatchCalls, 1);
assert.deepEqual(batchCalls, []);
assert.equal(apiBatchCalls, 0);
assert.equal(firstCard.appliedRatings.kpRating, 7.4);
assert.equal(firstCard.appliedRatings.imdbRating, 8.1);
assert.equal(firstCard.appliedRatings.votes.imdb, 1000);
assert.equal(firstCard.dataset.ratingsState, 'ready');

const cachedService = new MovieRatingsEnrichmentService({
    storage,
    navigationService: { resolve: async () => { throw new Error('cache miss'); } },
    kinopoiskService: { getMoviesByIdsBatch: async () => { throw new Error('cache miss'); } }
});
const cachedCard = createCard(42);
cachedService.pendingCards.add(cachedCard);
await flushAndWaitForProviders(cachedService);
assert.equal(cachedCard.appliedRatings.kpRating, 7.4);
assert.equal(cachedCard.appliedRatings.imdbRating, 8.1);

let kpMoviePageCalls = 0;
let blockedImdbFallbackCalls = 0;
const hiddenKpPageService = new MovieRatingsEnrichmentService({
    storage: {
        get(keys, callback) { callback({ movie_card_ratings_v4: {} }); },
        set(values, callback) { callback?.(); }
    },
    enableDetailFallback: true,
    navigationService: {
        async resolve() {
            return { kinopoiskId: 5456450, kpRating: 7.5 };
        }
    },
    kinopoiskService: {
        async scrapeMoviePageRatingsOffscreen(id) {
            kpMoviePageCalls += 1;
            assert.equal(id, 5456450);
            return { kpRating: 7.5, imdbRating: 6.2, imdbId: 'tt1234567' };
        }
    },
    imdbParser: {
        async getImdbRating() {
            blockedImdbFallbackCalls += 1;
            throw new Error('IMDb title page must not run when KP already returned a rating');
        }
    }
});
const hiddenKpPageCard = createCard(5456450);
hiddenKpPageService.pendingCards.add(hiddenKpPageCard);
await flushAndWaitForProviders(hiddenKpPageService);
assert.equal(kpMoviePageCalls, 1);
assert.equal(blockedImdbFallbackCalls, 0);
assert.equal(hiddenKpPageCard.appliedRatings.kpRating, 7.5);
assert.equal(hiddenKpPageCard.appliedRatings.imdbRating, 6.2);

let emptyKpPageImdbCalls = 0;
const emptyKpPageService = new MovieRatingsEnrichmentService({
    storage: {
        get(keys, callback) { callback({ movie_card_ratings_v4: {} }); },
        set(values, callback) { callback?.(); }
    },
    enableDetailFallback: true,
    navigationService: {
        async resolve() {
            return { kinopoiskId: 5456451, kpRating: 6.8 };
        }
    },
    kinopoiskService: {
        async scrapeMoviePageRatingsOffscreen() {
            return {};
        }
    },
    imdbParser: {
        async getImdbRating() {
            emptyKpPageImdbCalls += 1;
            return { rating: 7.3 };
        }
    }
});
const emptyKpPageCard = createCard(5456451);
emptyKpPageService.pendingCards.add(emptyKpPageCard);
await flushAndWaitForProviders(emptyKpPageService);
assert.equal(emptyKpPageImdbCalls, 0);
assert.equal(emptyKpPageCard.appliedRatings.imdbRating, 0);

// Legacy negative records from before retryAfter was introduced must not
// suppress the recovery search forever.
assert.equal(cachedService.isUsableCache({
    status: 'not-found',
    expiresAt: Date.now() + 60_000
}), false);
assert.equal(cachedService.isUsableCache({
    status: 'no-ratings',
    expiresAt: Date.now() + 60_000,
    retryAfter: Date.now() + 60_000
}), true);
assert.equal(cachedService.isUsableCache({
    status: 'no-ratings',
    expiresAt: Date.now() + 60_000,
    retryAfter: Date.now() - 1
}), false);
assert.equal(cachedService.isUsableCache({
    status: 'resolved',
    kpId: 777,
    kpRating: 7.5,
    imdbRating: 0,
    expiresAt: Date.now() + 60_000
}), false);
assert.equal(cachedService.isUsableCache({
    status: 'resolved',
    kpId: 777,
    kpRating: 7.5,
    imdbRating: 0,
    imdbRetryAfter: Date.now() + 60_000,
    expiresAt: Date.now() + 60_000
}), true, 'a missing IMDb rating is reused until its retry time');
assert.equal(cachedService.isUsableCache({
    status: 'resolved',
    kpId: 777,
    kpRating: 7.5,
    imdbRating: 0,
    imdbRetryAfter: Date.now() + 60_000,
    imdbAttemptSessionId: cachedService.enrichmentSessionId,
    expiresAt: Date.now() + 60_000
}), true);
assert.equal(cachedService.isUsableCache({
    status: 'resolved',
    kpId: 777,
    kpRating: 7.5,
    imdbRating: 0,
    imdbRetryAfter: Date.now() + 60_000,
    imdbAttemptSessionId: 'previous-session',
    expiresAt: Date.now() + 60_000
}), true, 'the retry gate no longer resets on every page load');
assert.equal(cachedService.isUsableCache({
    status: 'resolved',
    kpId: 777,
    kpRating: 7.5,
    imdbRating: 0,
    imdbRetryAfter: Date.now() - 1,
    expiresAt: Date.now() + 60_000
}), false);

const staleNegativeStorage = {
    values: {
        movie_card_ratings_v4: {
            'tmdb:777': { status: 'not-found', expiresAt: Date.now() + 60_000 }
        }
    },
    get(keys, callback) {
        callback({ movie_card_ratings_v4: this.values.movie_card_ratings_v4 });
    },
    set(values, callback) {
        Object.assign(this.values, values);
        callback?.();
    }
};
let staleNegativeRetryCalls = 0;
const staleNegativeRetryService = new MovieRatingsEnrichmentService({
    storage: staleNegativeStorage,
    navigationService: {
        async resolve() {
            staleNegativeRetryCalls += 1;
            return { kinopoiskId: 1777, kpRating: 6.4, imdbRating: 6.8 };
        }
    },
    imdbParser: null
});
const staleNegativeCard = createCard(777);
staleNegativeRetryService.pendingCards.add(staleNegativeCard);
await flushAndWaitForProviders(staleNegativeRetryService);
assert.equal(staleNegativeRetryCalls, 1);
assert.equal(staleNegativeCard.appliedRatings.kpRating, 6.4);

let detailFallbackCalls = 0;
const detailFallbackService = new MovieRatingsEnrichmentService({
    storage: {
        get(keys, callback) { callback({ movie_card_ratings_v4: {} }); },
        set(values, callback) { callback?.(); }
    },
    enableDetailFallback: true,
    navigationService: {
        async resolve() {
            return { kinopoiskId: 2555, kpRating: 0 };
        }
    },
    ratingParser: {
        async getKinopoiskRating(id) {
            detailFallbackCalls += 1;
            assert.equal(id, 2555);
            return { rating: 6.6, votes: 1200 };
        }
    },
    imdbParser: null
});
const detailFallbackCard = createCard(1555);
detailFallbackService.pendingCards.add(detailFallbackCard);
await flushAndWaitForProviders(detailFallbackService);
assert.equal(detailFallbackCalls, 1);
assert.equal(detailFallbackCard.appliedRatings.kpRating, 6.6);

const boundedService = new MovieRatingsEnrichmentService({
    storage,
    maxCardsPerFlush: 2,
    batchDelayMs: 10000,
    navigationService: { resolve: async item => ({
        kinopoiskId: Number(item.tmdbId) + 2000,
        kpRating: 7.1,
        imdbRating: 8.2,
        imdbId: 'tt7654321'
    }) },
    imdbParser: null
});
const queuedCards = [createCard(51), createCard(52), createCard(53)];
queuedCards.forEach(card => boundedService.pendingCards.add(card));
await flushAndWaitForProviders(boundedService);
assert.equal(queuedCards.filter(card => card.dataset.ratingsState === 'ready').length, 2);
assert.equal(queuedCards.filter(card => card.dataset.ratingsState !== 'ready').length, 1);
clearTimeout(boundedService.flushTimer);

const featuredOverlay = { innerHTML: '' };
const featuredCard = {
    dataset: {},
    classList: { contains: className => className === 'featured-card' },
    querySelector(selector) {
        return selector === '.featured-badge-overlay' ? featuredOverlay : null;
    }
};
cachedService.applyRatings(featuredCard, { kpId: 1042, kpRating: 7.4, imdbRating: 8.1, status: 'resolved' });
assert.match(featuredOverlay.innerHTML, /КП 7\.4/);
assert.match(featuredOverlay.innerHTML, /IMDb 8\.1/);

cachedService.applyRatings(featuredCard, { kpId: 1042, kpRating: 0, imdbRating: 0, status: 'no-ratings' });
assert.match(featuredOverlay.innerHTML, /КП 7\.4/);
assert.match(featuredOverlay.innerHTML, /IMDb 8\.1/);
assert.doesNotMatch(featuredOverlay.innerHTML, /featured-rating-badge--unavailable/);
// A different card with no known providers still shows explicit unavailable/pending states.
featuredCard.dataset = {};
cachedService.applyRatings(featuredCard, { kpId: 1042, kpRating: 0, imdbRating: 0, status: 'no-ratings' });
assert.equal(featuredOverlay.innerHTML.includes('featured-rating-badge--unavailable'), true);
cachedService.applyRatings(featuredCard, {
    kpId: 1042,
    kpRating: 7.4,
    imdbRating: 0,
    kpState: 'available',
    imdbState: 'pending',
    status: 'partial'
});
assert.match(featuredOverlay.innerHTML, /featured-rating-badge--loading/);
assert.match(featuredOverlay.innerHTML, /IMDb/);
assert.doesNotMatch(featuredOverlay.innerHTML, /featured-rating-badge--unavailable/);

const tmdbOnlyCard = createCard(7001);
tmdbOnlyCard.dataset.isTmdbOnly = 'true';
tmdbOnlyCard.dataset.movieId = '7777';
assert.equal(cachedService.requestKeyForCard(cachedService.itemFromCard(tmdbOnlyCard), tmdbOnlyCard), 'kp-detail:7777:movie');
const previousChrome = global.chrome;
const cancellationMessages = [];
global.chrome = {
    runtime: {
        sendMessage(message) {
            cancellationMessages.push(message);
            return Promise.resolve({ success: true });
        }
    }
};
tmdbOnlyCard.dataset.ratingsState = 'partial';
cachedService.cancelCard(tmdbOnlyCard);
assert.equal(cancellationMessages[0].requestKey, 'kp-detail:7777:movie');
global.chrome = previousChrome;

console.log('✅ Movie ratings enrichment uses KP data and batched IMDb ratings');
let releaseImdb;
const delayedStageService = new MovieRatingsEnrichmentService({
    storage: {
        get(keys, callback) { callback({ movie_card_ratings_v4: {} }); },
        set(values, callback) { callback?.(); }
    },
    enableDetailFallback: true,
    navigationService: {
        async resolve() {
            return { kinopoiskId: 9001, kpRating: 7.9, imdbId: 'tt9001001' };
        }
    },
    imdbParser: {
        getImdbRatingsBatch: async () => new Promise(resolve => { releaseImdb = resolve; })
    }
});
const delayedCard = createCard(9001);
delayedStageService.pendingCards.add(delayedCard);
await delayedStageService.flushPendingCards();
assert.equal(delayedCard.appliedRatings.kpRating, 7.9);
assert.equal(delayedCard.appliedRatings.imdbRating, 0);
assert.equal(delayedCard.dataset.ratingsState, 'partial');
assert.equal(delayedCard.appliedRatings.imdbState, 'pending');
// The IMDb batch starts a few microtasks after Stage A has painted.
while (typeof releaseImdb !== 'function') await new Promise(resolve => setTimeout(resolve, 0));
releaseImdb(new Map([['tt9001001', { rating: 8.4, votes: 10 }]]));
await delayedStageService.lastBackgroundEnrichment;
assert.equal(delayedCard.appliedRatings.imdbRating, 8.4);
assert.equal(delayedCard.dataset.ratingsState, 'ready');

let duplicateIdentityCalls = 0;
const duplicateIdentityService = new MovieRatingsEnrichmentService({
    storage: {
        get(keys, callback) { callback({ movie_card_ratings_v4: {} }); },
        set(values, callback) { callback?.(); }
    },
    navigationService: {
        async resolve() {
            duplicateIdentityCalls += 1;
            await new Promise(resolve => setTimeout(resolve, 5));
            return { kinopoiskId: 9100, kpRating: 7.1, imdbRating: 8.0 };
        }
    },
    imdbParser: null
});
const duplicateCards = [createCard(9101), createCard(9102)];
duplicateCards.forEach(card => {
    card.dataset.movieTitle = 'Same Title';
    card.dataset.movieYear = '2020';
    duplicateIdentityService.pendingCards.add(card);
});
await flushAndWaitForProviders(duplicateIdentityService);
assert.equal(duplicateIdentityCalls, 1);
assert.equal(duplicateCards[0].appliedRatings.kpRating, 7.1);
assert.equal(duplicateCards[1].appliedRatings.kpRating, 7.1);

let raceStorageValue = {};
const raceStorage = {
    get(keys, callback) {
        setTimeout(() => callback({ movie_card_ratings_v4: raceStorageValue }), 1);
    },
    set(values, callback) {
        setTimeout(() => {
            raceStorageValue = values.movie_card_ratings_v4;
            callback?.();
        }, 1);
    }
};
const raceService = new MovieRatingsEnrichmentService({ storage: raceStorage });
await Promise.all([
    raceService.writeCache({ 'tmdb:1': { updatedAt: 1, status: 'resolved' } }),
    raceService.writeCache({ 'tmdb:2': { updatedAt: 2, status: 'resolved' } })
]);
assert.deepEqual(Object.keys(raceStorageValue).sort(), ['tmdb:1', 'tmdb:2']);

let releaseLifecycleCache;
let lifecycleNavigationCalls = 0;
const lifecycleService = new MovieRatingsEnrichmentService({
    storage: {
        get(keys, callback) { releaseLifecycleCache = callback; },
        set(values, callback) { callback?.(); }
    },
    navigationService: {
        async resolve() {
            lifecycleNavigationCalls += 1;
            return { kinopoiskId: 9999, kpRating: 7.0, imdbRating: 8.0 };
        }
    }
});
const lifecycleCard = createCard(9999);
lifecycleService.pendingCards.add(lifecycleCard);
const lifecycleFlush = lifecycleService.flushPendingCards();
lifecycleService.dispose();
releaseLifecycleCache({ movie_card_ratings_v4: {} });
await lifecycleFlush;
assert.equal(lifecycleNavigationCalls, 0);

// Test: the IMDb title-search fallback is not attempted. IMDb's suggestion
// API sends no CORS headers, so it cannot work from extension pages.
let imdbTitleSearchCalls = 0;
const titleSearchService = new MovieRatingsEnrichmentService({
    storage: {
        get(keys, callback) { callback({ movie_card_ratings_v4: {} }); },
        set(values, callback) { callback?.(); }
    },
    enableDetailFallback: true,
    navigationService: {
        async resolve() {
            return { kinopoiskId: 6548088, kpRating: 0, imdbRating: 0, imdbId: null, originalTitle: 'The Dog Stars' };
        }
    },
    kinopoiskService: {
        async scrapeMoviePageRatingsOffscreen() {
            return { kpRating: 0, imdbRating: 0, imdbId: null };
        }
    },
    imdbParser: {
        async getImdbRatingsBatch() { return new Map(); },
        async getImdbRatingByTitle() {
            imdbTitleSearchCalls += 1;
            return { rating: 6.5, votes: 2000, imdbId: 'tt21285562' };
        }
    }
});
const dogStarsCard = createCard(1384216);
dogStarsCard.dataset.movieTitle = 'Собачьи звёзды';
dogStarsCard.dataset.movieOriginalTitle = 'The Dog Stars';
dogStarsCard.dataset.movieYear = '2026';
titleSearchService.pendingCards.add(dogStarsCard);
await flushAndWaitForProviders(titleSearchService);
assert.equal(imdbTitleSearchCalls, 0);
assert.equal(dogStarsCard.appliedRatings.imdbRating, 0);
console.log('✅ The CORS-blocked IMDb title search is not attempted');

// Test: TMDB external_ids supply the IMDb ID for the batched IMDb request,
// and the KP movie page is skipped once both ratings are known.
let tmdbExternalIdsCalls = 0;
let imdbBatchIdsSeen = null;
let kpPageCallsWithBatch = 0;
const tmdbExtService = new MovieRatingsEnrichmentService({
    storage: {
        get(keys, callback) { callback({ movie_card_ratings_v4: {} }); },
        set(values, callback) { callback?.(); }
    },
    enableDetailFallback: true,
    tmdbService: {
        async getExternalIds(tmdbId, mediaType) {
            tmdbExternalIdsCalls += 1;
            assert.equal(tmdbId, 1384216);
            assert.equal(mediaType, 'movie');
            return { id: 1384216, imdb_id: 'tt21285562' };
        }
    },
    navigationService: {
        async resolve() {
            return { kinopoiskId: 6548088, kpRating: 7.2, imdbRating: 0, imdbId: null };
        }
    },
    kinopoiskService: {
        async scrapeMoviePageRatingsOffscreen() {
            kpPageCallsWithBatch += 1;
            return { kpRating: 7.2, imdbRating: 0, imdbId: null };
        }
    },
    imdbParser: {
        async getImdbRatingsBatch(ids) {
            imdbBatchIdsSeen = ids;
            return new Map([['tt21285562', { rating: 6.5, votes: 2000 }]]);
        }
    }
});
const tmdbExtCard = createCard(1384216);
tmdbExtCard.dataset.movieTitle = 'Собачьи звёзды';
tmdbExtCard.dataset.movieYear = '2026';
tmdbExtService.pendingCards.add(tmdbExtCard);
await flushAndWaitForProviders(tmdbExtService);
assert.equal(tmdbExternalIdsCalls, 1);
assert.deepEqual(imdbBatchIdsSeen, ['tt21285562']);
assert.equal(kpPageCallsWithBatch, 0, 'no hidden KP page when both ratings are known');
assert.equal(tmdbExtCard.appliedRatings.imdbRating, 6.5);
assert.equal(tmdbExtCard.appliedRatings.imdbId, 'tt21285562');
assert.equal(tmdbExtCard.dataset.ratingsState, 'ready');

// A title IMDb answered for without a rating is settled: no KP page either.
let kpPageCallsUnrated = 0;
const unratedService = new MovieRatingsEnrichmentService({
    storage: {
        get(keys, callback) { callback({ movie_card_ratings_v4: {} }); },
        set(values, callback) { callback?.(); }
    },
    enableDetailFallback: true,
    navigationService: { async resolve() { return { kinopoiskId: 6548090, kpRating: 6.9, imdbId: 'tt30000001' }; } },
    kinopoiskService: { async scrapeMoviePageRatingsOffscreen() { kpPageCallsUnrated += 1; return {}; } },
    imdbParser: { async getImdbRatingsBatch() { return new Map([['tt30000001', { rating: 0, votes: 0 }]]); } }
});
const unratedCard = createCard(6548090);
unratedService.pendingCards.add(unratedCard);
await flushAndWaitForProviders(unratedService);
assert.equal(kpPageCallsUnrated, 0);
assert.equal(unratedCard.appliedRatings.kpRating, 6.9);
assert.equal(unratedCard.appliedRatings.imdbState, 'unavailable');
assert.ok(unratedCard.appliedRatings.imdbRetryAfter - Date.now() > 11 * 60 * 60 * 1000, 'missing IMDb retried after ~12h');

const identityGuard = new MovieRatingsEnrichmentService({ storage });
const canonicalCard = createCard(178720);
canonicalCard.dataset.movieId = '178720';
assert.equal(identityGuard.applyRatings(canonicalCard, {
    kpId: 178721, kpRating: 8.7, imdbRating: 8.9, status: 'resolved'
}), false, 'A cached KP record cannot override a different canonical card ID');
assert.equal(canonicalCard.dataset.movieId, '178720');
assert.equal(canonicalCard.appliedRatings, undefined);

const tmdbIdentityGuardCard = createCard(3000);
Object.assign(tmdbIdentityGuardCard.dataset, {
    isTmdbOnly: 'true', movieTitle: 'Warehouse 13', movieYear: '2009', mediaType: 'tv'
});
assert.equal(identityGuard.applyRatings(tmdbIdentityGuardCard, {
    kpId: 178720, tmdbId: 3000, name: 'Firefly', year: 2002, mediaType: 'tv',
    identityVerified: true, kpRating: 8.7, imdbRating: 8.9, status: 'resolved'
}), false, 'A TMDB-only card rejects a KP record with incompatible title and year');
assert.equal(tmdbIdentityGuardCard.dataset.movieId, undefined);
assert.equal(tmdbIdentityGuardCard.appliedRatings, undefined);

assert.equal(identityGuard.applyRatings(tmdbIdentityGuardCard, {
    kpId: 3001, tmdbId: 3000, name: 'Warehouse 13', year: 2009, mediaType: 'tv',
    identityVerified: true, kpRating: 7.3, imdbRating: 7.8, status: 'resolved'
}), true, 'A verified record matching TMDB ID, title, year, and type can enrich the card');
assert.equal(tmdbIdentityGuardCard.dataset.movieId, '3001');

let rejectedTmdbCacheLookups = 0;
const wrongTmdbRecord = {
    status: 'resolved', kpId: 178720, tmdbId: 3000, name: 'Firefly', year: 2002, mediaType: 'tv',
    identityVerified: true, kpRating: 8.7, imdbRating: 8.9,
    kpState: 'available', imdbState: 'available', expiresAt: Date.now() + 60_000
};
const identityCacheStorage = {
    values: { movie_card_ratings_v4: { 'tmdb:tv:3000': wrongTmdbRecord } },
    get(keys, callback) { callback({ movie_card_ratings_v4: this.values.movie_card_ratings_v4 }); },
    set(values, callback) { Object.assign(this.values, values); callback?.(); }
};
const identityCacheService = new MovieRatingsEnrichmentService({
    storage: identityCacheStorage,
    navigationService: { async resolve() {
        rejectedTmdbCacheLookups += 1;
        return {
            verified: true, kinopoiskId: 3001, tmdbId: 3000, name: 'Warehouse 13',
            year: 2009, mediaType: 'tv', kpRating: 7.3, imdbRating: 7.8
        };
    } },
    imdbParser: null
});
const identityCacheCard = createCard(3000);
Object.assign(identityCacheCard.dataset, {
    isTmdbOnly: 'true', movieTitle: 'Warehouse 13', movieYear: '2009', mediaType: 'tv'
});
identityCacheService.pendingCards.add(identityCacheCard);
await flushAndWaitForProviders(identityCacheService);
assert.equal(rejectedTmdbCacheLookups, 1, 'An incompatible persistent TMDB rating record must be ignored');
assert.equal(identityCacheCard.dataset.movieId, '3001');
assert.equal(identityCacheCard.appliedRatings.kpRating, 7.3);

// Movie and TV cards with the same TMDB ID never share a cache record.
assert.equal(unratedService.cacheKeyFor({ tmdbId: 5, mediaType: 'movie' }), 'tmdb:movie:5');
assert.equal(unratedService.cacheKeyFor({ tmdbId: 5, mediaType: 'tv' }), 'tmdb:tv:5');
console.log('✅ TMDB external_ids feed the batched IMDb request without a KP page load');

// A TMDB-keyed card picks up the IMDb rating Movie Details stored under kp:<id>.
{
    const svc = new MovieRatingsEnrichmentService({ storage, trace: false });
    const stale = svc.createRecord({ item: { tmdbId: 1148365, name: 'Matchbox' }, kpId: 6601550 },
        { status: 'resolved', kpId: 6601550, kpRating: 5.9, imdbRating: 0, imdbState: 'unavailable', votes: { kp: 0, imdb: 0 } });
    const fromDetails = { kpId: 6601550, kpRating: 5.9, imdbRating: 5.7, imdbId: 'tt1234567', votes: { kp: 764, imdb: 8500 } };
    const merged = svc.mergeKinopoiskRecord(stale, { 'kp:6601550': fromDetails });
    assert.equal(merged.imdbRating, 5.7);
    assert.equal(merged.imdbState, 'available');
    assert.deepEqual(merged.votes, { kp: 764, imdb: 8500 });
    assert.equal(merged.imdbId, 'tt1234567');
    assert.equal(svc.mergeKinopoiskRecord(merged, { 'kp:6601550': fromDetails }), merged, 'nothing new keeps the record');

    // "No IMDb rating" lasts 12 hours only when IMDb data was actually read.
    const before = Date.now();
    const failed = svc.createRecord({ item: { tmdbId: 1 }, kpId: 1 }, { kpId: 1, kpRating: 7, imdbAnswered: false });
    const answered = svc.createRecord({ item: { tmdbId: 1 }, kpId: 1 }, { kpId: 1, kpRating: 7, imdbAnswered: true });
    assert.ok(failed.imdbRetryAfter - before <= svc.providerRetryMs + 1000, 'a failed scrape retries soon');
    assert.ok(answered.imdbRetryAfter - before >= svc.imdbRetryMs - 1000, 'a real "no IMDb" answer waits 12 hours');
    // Legacy "no IMDb" records (no imdbCheckVersion) are checked once more.
    const legacy = { ...answered };
    delete legacy.imdbCheckVersion;
    assert.equal(svc.isFullyUsableCache(answered), true, 'a versioned "no IMDb" answer is reused');
    assert.equal(svc.isFullyUsableCache(legacy), false, 'a pre-fix "no IMDb" record is re-checked');
    assert.equal(failed.imdbCheckVersion, undefined, 'a failed scrape is not marked as checked');
    console.log('✅ Card IMDb results merge kp:<id> data and failed scrapes retry soon');
}

const memoryStorage = records => ({
    values: { movie_card_ratings_v4: records },
    get(keys, callback) { callback({ movie_card_ratings_v4: this.values.movie_card_ratings_v4 }); },
    set(values, callback) { Object.assign(this.values, values); callback?.(); }
});
const nextTicks = async (count = 12) => { for (let index = 0; index < count; index += 1) await new Promise(resolve => setImmediate(resolve)); };

// One title that needs the slow hidden page holds nothing back for the others.
{
    let releasePage;
    const slowPage = new Promise(resolve => { releasePage = resolve; });
    const svc = new MovieRatingsEnrichmentService({
        storage: memoryStorage({}),
        trace: false,
        enableDetailFallback: true,
        navigationService: { async resolve(item) { return { kinopoiskId: Number(item.tmdbId) + 1000 }; } },
        imdbParser: null,
        kinopoiskService: {
            async movieRatingsViaGraphql(id) {
                return id === 1001
                    ? { kpRating: 8.2, kpVotes: 5, imdbRating: 8.1, imdbVotes: 6, imdbAnswered: true }
                    : { kpRating: 5.4, kpVotes: 7, imdbRating: 0, imdbVotes: 0, imdbAnswered: false };
            },
            async scrapeMoviePageRatingsOffscreen(id, options) {
                assert.equal(id, 1002, 'only the title GraphQL could not answer goes to the page');
                assert.equal(options.graphqlRatings.kpRating, 5.4, 'the page does not repeat GraphQL');
                return slowPage;
            }
        }
    });
    const fast = createCard(1);
    const slow = createCard(2);
    svc.pendingCards.add(fast);
    svc.pendingCards.add(slow);
    await svc.flushPendingCards();
    await nextTicks();
    assert.equal(fast.dataset.ratingsState, 'ready', 'the fast title is done while its neighbour waits');
    assert.equal(fast.appliedRatings.imdbRating, 8.1);
    assert.equal(slow.dataset.ratingsState, 'partial');
    assert.equal(slow.appliedRatings.kpRating, 5.4, 'the KP rating shows while IMDb is looked for');
    assert.equal(slow.appliedRatings.imdbState, 'pending');
    releasePage({ kpRating: 5.4, imdbRating: 0, imdbAnswered: true });
    await svc.lastBackgroundEnrichment;
    assert.equal(slow.dataset.ratingsState, 'ready');
    assert.equal(slow.appliedRatings.imdbState, 'unavailable');
}

// A slow search for one card does not delay a card whose identity is known.
{
    let releaseSearch;
    const svc = new MovieRatingsEnrichmentService({
        storage: memoryStorage({}),
        trace: false,
        imdbParser: null,
        navigationService: { resolve: () => new Promise(resolve => { releaseSearch = resolve; }) }
    });
    const known = createCard(11);
    known.dataset.movieId = '777';
    known.dataset.kpRating = '7.1';
    known.dataset.imdbRating = '7.2';
    const searching = createCard(12);
    svc.pendingCards.add(known);
    svc.pendingCards.add(searching);
    const flush = svc.flushPendingCards();
    await nextTicks();
    assert.equal(known.dataset.ratingsState, 'ready');
    assert.equal(searching.dataset.ratingsState, 'loading');
    releaseSearch({ kinopoiskId: 778, kpRating: 6.1, imdbRating: 6.2 });
    await flush;
    assert.equal(searching.dataset.ratingsState, 'ready');
}

// An answer that arrives after its card left the screen is kept, not thrown away.
{
    let releaseGraphql;
    const storage = memoryStorage({});
    const svc = new MovieRatingsEnrichmentService({
        storage,
        trace: false,
        enableDetailFallback: true,
        navigationService: { async resolve() { return { kinopoiskId: 10355286 }; } },
        imdbParser: null,
        kinopoiskService: {
            movieRatingsViaGraphql: () => new Promise(resolve => { releaseGraphql = resolve; }),
            async scrapeMoviePageRatingsOffscreen() { throw new Error('nothing is left for the page to do'); }
        }
    });
    const card = createCard(21);
    svc.pendingCards.add(card);
    await svc.flushPendingCards();
    await nextTicks();
    svc.cancelCard(card, { notify: false });
    assert.equal(card.dataset.ratingsState, '');
    releaseGraphql({ kpRating: 6.9, kpVotes: 1, imdbRating: 8.1, imdbVotes: 2, imdbAnswered: true });
    await svc.lastBackgroundEnrichment;
    const stored = storage.values.movie_card_ratings_v4;
    assert.equal(stored['kp:10355286'].imdbRating, 8.1, 'stored for the next visit');
    assert.equal(stored['tmdb:movie:21'].kpRating, 6.9);
    assert.equal(card.dataset.ratingsState, 'ready', 'and the card has it when the user comes back');
}

// A card off screen does not spend a hidden page; it asks again when it returns.
{
    let releaseGraphql;
    let pageLoads = 0;
    const storage = memoryStorage({});
    const svc = new MovieRatingsEnrichmentService({
        storage,
        trace: false,
        enableDetailFallback: true,
        navigationService: { async resolve() { return { kinopoiskId: 14861516 }; } },
        imdbParser: null,
        kinopoiskService: {
            movieRatingsViaGraphql: () => new Promise(resolve => { releaseGraphql = resolve; }),
            async scrapeMoviePageRatingsOffscreen() { pageLoads += 1; return { kpRating: 6.9, imdbRating: 0 }; }
        }
    });
    const card = createCard(31);
    svc.pendingCards.add(card);
    await svc.flushPendingCards();
    await nextTicks();
    svc.cancelCard(card, { notify: false });
    releaseGraphql({ kpRating: 6.955, kpVotes: 662, imdbRating: 0, imdbVotes: 0, imdbAnswered: false });
    await svc.lastBackgroundEnrichment;
    assert.equal(pageLoads, 0);
    assert.equal(card.appliedRatings.kpRating, 6.955, 'the Kinopoisk rating is kept');
    assert.equal(card.dataset.ratingsState, '', 'the card can be queued again');
    const record = storage.values.movie_card_ratings_v4['kp:14861516'];
    assert.equal(record.imdbState, 'pending', 'IMDb is unknown, not absent');
    assert.equal(record.imdbCheckVersion, undefined, 'and nobody recorded it as checked');
}

// A record found earlier keeps its verified identity, so a TMDB-only card accepts it.
{
    const verified = {
        status: 'partial', kpId: 11921460, tmdbId: 1422041, name: 'Чёрный шар', year: 2026, mediaType: 'movie',
        identityVerified: true, kpRating: 0, imdbRating: 0, kpState: 'pending', imdbState: 'pending',
        votes: {}, updatedAt: Date.now() - 1000, expiresAt: Date.now() + 60_000, kpRetryAfter: Date.now() - 1
    };
    const storage = memoryStorage({ 'tmdb:movie:1422041': verified, 'kp:11921460': verified });
    const svc = new MovieRatingsEnrichmentService({
        storage,
        trace: false,
        enableDetailFallback: true,
        navigationService: { async resolve() { throw new Error('a known identity needs no search'); } },
        imdbParser: null,
        kinopoiskService: {
            async movieRatingsViaGraphql() { return { kpRating: 8.2, kpVotes: 1, imdbRating: 8.1, imdbVotes: 1, imdbAnswered: true }; }
        }
    });
    const card = createCard(1422041);
    Object.assign(card.dataset, { isTmdbOnly: 'true', movieTitle: 'Чёрный шар', movieYear: '2026' });
    svc.pendingCards.add(card);
    await flushAndWaitForProviders(svc);
    assert.equal(card.appliedRatings.kpRating, 8.2);
    assert.equal(card.dataset.ratingsState, 'ready');
    assert.equal(storage.values.movie_card_ratings_v4['tmdb:movie:1422041'].identityVerified, true, 'the next visit can trust it too');
}

// A title in two sections: each card gets a record with its own identity.
{
    let pageLoads = 0;
    let releasePage;
    const svc = new MovieRatingsEnrichmentService({
        storage: memoryStorage({}),
        trace: false,
        enableDetailFallback: true,
        imdbParser: null,
        navigationService: { async resolve() { return { verified: true, kinopoiskId: 5158783, tmdbId: 213375, name: 'Квест Вижна', year: 2026, mediaType: 'movie' }; } },
        kinopoiskService: {
            async movieRatingsViaGraphql() { return { kpRating: 7.1, kpVotes: 3656, imdbRating: 0, imdbVotes: 0, imdbAnswered: false }; },
            scrapeMoviePageRatingsOffscreen() { pageLoads += 1; return new Promise(resolve => { releasePage = resolve; }); }
        }
    });
    const fromList = createCard(9);
    fromList.dataset.movieId = '5158783';
    fromList.dataset.movieTitle = 'Квест Вижна';
    const fromDiscovery = createCard(213375);
    Object.assign(fromDiscovery.dataset, { isTmdbOnly: 'true', movieTitle: 'Квест Вижна', movieYear: '2026' });
    svc.pendingCards.add(fromList);
    svc.pendingCards.add(fromDiscovery);
    await svc.flushPendingCards();
    while (typeof releasePage !== 'function') await nextTicks(2);
    releasePage({ kpRating: 7.1, imdbRating: 0, imdbAnswered: true });
    await svc.lastBackgroundEnrichment;
    assert.equal(pageLoads, 1, 'one hidden page for one title');
    assert.equal(fromList.dataset.ratingsState, 'ready');
    assert.equal(fromDiscovery.dataset.ratingsState, 'ready', 'the record built for this card passes its identity check');
}

// The record Movie Details updated is newer than the one a card list keeps for the same title.
{
    const svc = new MovieRatingsEnrichmentService({ storage: memoryStorage({}), trace: false });
    const old = {
        status: 'resolved', kpId: 5158783, tmdbId: 213375, name: 'Квест Вижна', year: 2026, mediaType: 'tv', identityVerified: true,
        kpRating: 7.9, imdbRating: 0, imdbState: 'unavailable', votes: { kp: 0 }, updatedAt: 1000, expiresAt: Date.now() + 1000
    };
    const fresh = {
        status: 'resolved', kpId: 5158783, kpRating: 7.158, imdbRating: 0, imdbState: 'unavailable', imdbCheckVersion: 2,
        imdbRetryAfter: Date.now() + 60_000, votes: { kp: 3452 }, updatedAt: 2000, expiresAt: Date.now() + 60_000
    };
    const merged = svc.mergeKinopoiskRecord(old, { 'kp:5158783': fresh });
    assert.equal(merged.kpRating, 7.158, 'the newer rating wins');
    assert.equal(merged.votes.kp, 3452);
    assert.equal(merged.tmdbId, 213375, 'the card keeps its identity');
    assert.equal(merged.imdbCheckVersion, 2, 'and learns that IMDb was already checked');
    assert.equal(svc.mergeKinopoiskRecord(merged, { 'kp:5158783': fresh }), merged, 'nothing new keeps the record');

    // And an older copy found on the way never overwrites it.
    const candidate = { kpId: 5158783, kpRating: 7.9 };
    svc.seedFromKinopoiskRecord(candidate, { 'kp:5158783': fresh });
    assert.equal(candidate.kpRating, 7.158);
}

// A pending record is not an answer: other pages must still look for IMDb.
{
    const svc = new MovieRatingsEnrichmentService({ storage: memoryStorage({}), trace: false });
    const record = svc.createProgressRecord({ item: { tmdbId: 1 }, kpId: 1, kpRating: 7 });
    assert.equal(record.imdbState, 'pending');
    assert.equal(record.imdbCheckVersion, undefined);
    assert.equal(svc.isFullyUsableCache(record), false);
}

// Each provider's answer lasts its own time: a title without a Kinopoisk rating is read
// again soon, but does not spend a hidden page on IMDb, already checked for 12 hours.
{
    let pageLoads = 0;
    const imdbRetryAfter = Date.now() + 5 * 60 * 60 * 1000;
    const storage = memoryStorage({
        'kp:13516697': {
            status: 'no-ratings', kpId: 13516697, kpRating: 0, imdbRating: 0, kpState: 'unavailable', imdbState: 'unavailable',
            imdbCheckVersion: 2, imdbRetryAfter, kpRetryAfter: Date.now() - 1, retryAfter: Date.now() - 1, votes: {},
            updatedAt: Date.now() - 1000, expiresAt: Date.now() + 60_000
        }
    });
    const svc = new MovieRatingsEnrichmentService({
        storage,
        trace: false,
        enableDetailFallback: true,
        imdbParser: null,
        kinopoiskService: {
            async movieRatingsViaGraphql() { return { kpRating: 6.1, kpVotes: 222, imdbRating: 0, imdbVotes: 0, imdbAnswered: false }; },
            async scrapeMoviePageRatingsOffscreen() { pageLoads += 1; return {}; }
        }
    });
    const card = createCard(70);
    card.dataset.movieId = '13516697';
    svc.pendingCards.add(card);
    await flushAndWaitForProviders(svc);
    assert.equal(pageLoads, 0, 'IMDb was answered recently');
    assert.equal(card.appliedRatings.kpRating, 6.1);
    assert.equal(card.dataset.ratingsState, 'ready');
    assert.equal(storage.values.movie_card_ratings_v4['kp:13516697'].imdbRetryAfter, imdbRetryAfter, 'and viewing the card does not postpone the next check');
}

// A title Kinopoisk cannot identify still gets its IMDb rating through TMDB's exact IMDb ID.
{
    const storage = memoryStorage({});
    const svc = new MovieRatingsEnrichmentService({
        storage,
        trace: false,
        navigationService: { async resolve() { return null; } },
        tmdbService: { async getExternalIds() { return { imdb_id: 'tt7654321' }; } },
        imdbParser: { async getImdbRatingsBatch(ids) { return new Map([[ids[0], { rating: 8.7, votes: 900 }]]); } }
    });
    const card = createCard(94954);
    Object.assign(card.dataset, { isTmdbOnly: 'true', movieTitle: 'Отель Хазбин', movieYear: '2024', mediaType: 'tv' });
    svc.pendingCards.add(card);
    await flushAndWaitForProviders(svc);
    assert.equal(card.appliedRatings.imdbRating, 8.7);
    assert.equal(card.dataset.ratingsState, 'ready');
    const record = storage.values.movie_card_ratings_v4['tmdb:tv:94954'];
    assert.equal(record.status, 'not-found', 'Kinopoisk is still asked again after the usual wait');
    assert.equal(record.imdbRating, 8.7);
    assert.equal(record.imdbId, 'tt7654321');
    assert.ok(record.retryAfter > Date.now());
}

// Kinopoisk saying it has no rating of its own is an answer too.
{
    const svc = new MovieRatingsEnrichmentService({ storage: memoryStorage({}), trace: false });
    assert.equal(svc.hasPendingProvider({ kpRating: 0, imdbRating: 8.1 }), true);
    assert.equal(svc.hasPendingProvider({ kpRating: 0, kpChecked: true, imdbRating: 8.1 }), false);
}

// An expired record is shown while it is read again, and not extended as it is.
{
    let graphqlCalls = 0;
    const storage = memoryStorage({
        'kp:555': {
            status: 'resolved', kpId: 555, kpRating: 7.0, imdbRating: 7.5, kpState: 'available', imdbState: 'available',
            votes: {}, updatedAt: 1, expiresAt: Date.now() - 1
        }
    });
    const svc = new MovieRatingsEnrichmentService({
        storage,
        trace: false,
        enableDetailFallback: true,
        imdbParser: null,
        kinopoiskService: {
            async movieRatingsViaGraphql() { graphqlCalls += 1; return { kpRating: 7.2, kpVotes: 9, imdbRating: 7.6, imdbVotes: 9, imdbAnswered: true }; }
        }
    });
    const card = createCard(50);
    card.dataset.movieId = '555';
    svc.pendingCards.add(card);
    await flushAndWaitForProviders(svc);
    assert.equal(graphqlCalls, 1);
    assert.equal(card.appliedRatings.kpRating, 7.2, 'the fresh value replaces the expired one');
    assert.equal(storage.values.movie_card_ratings_v4['kp:555'].imdbRating, 7.6);
}

// Cards that never started send nothing, and a closing page cancels its work in one message.
{
    const messages = [];
    const previous = global.chrome;
    global.chrome = { runtime: { sendMessage(message) { messages.push(message); return Promise.resolve({}); } } };
    const svc = new MovieRatingsEnrichmentService({ storage: memoryStorage({}), trace: false });
    const untouched = createCard(60);
    svc.cancelCard(untouched);
    assert.equal(messages.length, 0, 'an off-screen card that never started has nothing to cancel');
    assert.equal(svc.cancelledCardKeys.size, 0);
    const started = createCard(61);
    started.dataset.ratingsState = 'loading';
    svc.trackedCards.add(started);
    svc.dispose();
    assert.deepEqual(messages.map(message => message.type), ['KINOPOISK_OFFSCREEN_CANCEL_SESSION']);
    assert.equal(messages[0].sessionId, svc.enrichmentSessionId);
    global.chrome = previous;
}
console.log('✅ Each card takes its own answer, answers outlive scrolling, and identities and fresher records survive');

}

run().then(() => require('./homeSeededRatings.test.cjs').run()).catch(error => {
    console.error('❌ Movie ratings enrichment test failed:', error);
    process.exitCode = 1;
});
