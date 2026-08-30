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
let imdbPageCalls = 0;
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
        async getImdbRating(imdbId) {
            imdbPageCalls += 1;
            assert.equal(imdbId, 'tt1234567');
            return { imdbId: 'tt1234567', rating: 8.1, votes: 1000 };
        }
    },
    kinopoiskService: {
        async getMoviesByIdsBatch(items) {
            apiBatchCalls += 1;
            throw new Error(`API batch must not be called for card ratings: ${items.length}`);
        }
    }
});

const firstCard = createCard(42);
service.pendingCards.add(firstCard);
await flushAndWaitForProviders(service);

assert.equal(navigationCalls, 1);
assert.equal(imdbPageCalls, 1);
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
}), false);
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

console.log('✅ Movie ratings enrichment uses KP data and the legacy IMDb title-page path');
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
        getImdbRating: async () => new Promise(resolve => { releaseImdb = resolve; })
    }
});
const delayedCard = createCard(9001);
delayedStageService.pendingCards.add(delayedCard);
await delayedStageService.flushPendingCards();
assert.equal(delayedCard.appliedRatings.kpRating, 7.9);
assert.equal(delayedCard.appliedRatings.imdbRating, 0);
assert.equal(delayedCard.dataset.ratingsState, 'partial');
assert.equal(delayedCard.appliedRatings.imdbState, 'pending');
releaseImdb({ rating: 8.4, imdbId: 'tt9001001' });
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

// Test: English title search fallback when Kinopoisk has 0 ratings and no imdbId
let imdbTitleSearchCalls = 0;
const titleSearchService = new MovieRatingsEnrichmentService({
    storage: {
        get(keys, callback) { callback({ movie_card_ratings_v4: {} }); },
        set(values, callback) { callback?.(); }
    },
    enableDetailFallback: true,
    navigationService: {
        async resolve() {
            return {
                kinopoiskId: 6548088,
                kpRating: 0,
                imdbRating: 0,
                imdbId: null,
                originalTitle: 'The Dog Stars'
            };
        }
    },
    kinopoiskService: {
        async scrapeMoviePageRatingsOffscreen() {
            return { kpRating: 0, imdbRating: 0, imdbId: null };
        }
    },
    imdbParser: {
        async getImdbRatingByTitle(title, year) {
            imdbTitleSearchCalls += 1;
            assert.equal(title, 'The Dog Stars');
            assert.equal(year, 2026);
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
assert.equal(imdbTitleSearchCalls, 1);
assert.equal(dogStarsCard.appliedRatings.imdbRating, 6.5);
assert.equal(dogStarsCard.appliedRatings.imdbId, 'tt21285562');
assert.equal(dogStarsCard.appliedRatings.votes.imdb, 2000);
console.log('✅ Direct English title search fallback successfully resolves missing IMDb ratings');

// Test: TMDB external_ids fallback when card has tmdbId and KP has 0 ratings and no imdbId
let tmdbExternalIdsCalls = 0;
let directImdbIdCalls = 0;
const tmdbExtService = new MovieRatingsEnrichmentService({
    storage: {
        get(keys, callback) { callback({ movie_card_ratings_v4: {} }); },
        set(values, callback) { callback?.(); }
    },
    enableDetailFallback: true,
    tmdbService: {
        async getExternalIds(tmdbId) {
            tmdbExternalIdsCalls += 1;
            assert.equal(tmdbId, 1384216);
            return { id: 1384216, imdb_id: 'tt21285562' };
        }
    },
    navigationService: {
        async resolve() {
            return {
                kinopoiskId: 6548088,
                kpRating: 0,
                imdbRating: 0,
                imdbId: null
            };
        }
    },
    kinopoiskService: {
        async scrapeMoviePageRatingsOffscreen() {
            return { kpRating: 0, imdbRating: 0, imdbId: null };
        }
    },
    imdbParser: {
        async getImdbRating(imdbId) {
            directImdbIdCalls += 1;
            assert.equal(imdbId, 'tt21285562');
            return { rating: 6.5, votes: 2000, imdbId: 'tt21285562' };
        }
    }
});
const tmdbExtCard = createCard(1384216);
tmdbExtCard.dataset.movieTitle = 'Собачьи звёзды';
tmdbExtCard.dataset.movieYear = '2026';
tmdbExtService.pendingCards.add(tmdbExtCard);
await flushAndWaitForProviders(tmdbExtService);
assert.equal(tmdbExternalIdsCalls, 1);
assert.equal(directImdbIdCalls, 1);
assert.equal(tmdbExtCard.appliedRatings.imdbRating, 6.5);
assert.equal(tmdbExtCard.appliedRatings.imdbId, 'tt21285562');
console.log('✅ TMDB external_ids resolution fallback successfully resolves missing IMDb ratings');

}

run().catch(error => {
    console.error('❌ Movie ratings enrichment test failed:', error);
    process.exitCode = 1;
});
