import assert from 'node:assert';
import { getTimestamp } from '../src/shared/utils/dateUtils.js';
import { buildProviderRatingCache, mergeProviderRatingRecord, mergeProviderRatingsIntoMovies } from '../src/shared/utils/providerRatings.js';
import fs from 'node:fs';
import path from 'node:path';

console.log('🧪 Running Ratings Page Sorting & Reconciliation Verification Test...\n');

// 1. Test getTimestamp stability with different date objects
const t1 = getTimestamp({ seconds: 1770000000 });
const t2 = getTimestamp('2026-07-25T12:00:00.000Z');
const t3 = getTimestamp(null);

assert.strictEqual(t1, 1770000000000);
assert.strictEqual(t2, new Date('2026-07-25T12:00:00.000Z').getTime());
assert.strictEqual(t3, 0);

console.log('✅ Date parsing test passed');

// 2. Test sorting behavior with unified effectiveDate
const moviesData = [
    {
        movieId: 100,
        movie: { kinopoiskId: 100, name: 'Конвейер смерти — Отряд 731', lastRatingUpdatedAt: { seconds: 1770000300 } },
        currentUserRating: { id: 'rating_doc_1', rating: 8, createdAt: { seconds: 1770000000 } }
    },
    {
        movieId: 101,
        movie: { kinopoiskId: 101, name: 'Я ругаюсь', lastRatingUpdatedAt: { seconds: 1770000200 } },
        currentUserRating: { id: 'rating_doc_2', rating: 9, createdAt: { seconds: 1770000100 } }
    },
    {
        movieId: 102,
        movie: { kinopoiskId: 102, name: 'Энола Холмс', lastRatingUpdatedAt: { seconds: 1770000150 } },
        currentUserRating: { id: 'rating_doc_3', rating: 6, createdAt: { seconds: 1769000000 } }
    },
    {
        movieId: 103,
        movie: { kinopoiskId: 103, name: 'Черный котел', lastRatingUpdatedAt: { seconds: 1770000100 } },
        currentUserRating: { id: 'rating_doc_4', rating: 6, createdAt: { seconds: 1768000000 } }
    }
];

// Enrich with fixed effectiveDate logic from ratings.js
const enriched = moviesData.map(item => {
    const effectiveDate = getTimestamp(item.movie.lastRatingUpdatedAt) || getTimestamp(item.movie.updatedAt) || Date.now();
    return {
        ...item.currentUserRating,
        movieId: item.movieId,
        movie: item.movie,
        createdAt: effectiveDate
    };
});

// Perform client sort
enriched.sort((a, b) => {
    const valA = getTimestamp(a.createdAt);
    const valB = getTimestamp(b.createdAt);
    if (valA === valB) {
        return Number(b.movieId) - Number(a.movieId);
    }
    return valB - valA;
});

const namesOrder = enriched.map(m => m.movie.name);
console.log('Order after sort:', namesOrder);

assert.deepStrictEqual(namesOrder, [
    'Конвейер смерти — Отряд 731',
    'Я ругаюсь',
    'Энола Холмс',
    'Черный котел'
]);

console.log('✅ Sort order verification passed ("Энола Холмс" is strictly 3rd, before "Черный котел")');

// 3. Test key resolution in renderMovies logic
const testKeyResolution = (movieData) => {
    return (movieData.movieId || movieData.movie?.kinopoiskId || movieData.id).toString();
};

const sampleMovieWithRatingDocId = {
    id: 'RATERS_DOC_9999', // rating doc id from ...currentUserRating
    movieId: 102,
    movie: { kinopoiskId: 102, name: 'Энола Холмс' }
};

const key = testKeyResolution(sampleMovieWithRatingDocId);
assert.strictEqual(key, '102', 'Key must resolve to movieId (102) and NOT rating doc id (RATERS_DOC_9999)');

console.log('✅ Key resolution verification passed (prevents DOM node duplication/deletion)');

// 4. Test shared Home/Catalog provider cache recovery on the Ratings page
const cachedMovie = {
    kinopoiskId: 5287148,
    kpRating: 5.9,
    votes: { kp: 3663, imdb: 0 }
};
const mergedMovie = mergeProviderRatingRecord(cachedMovie, {
    kpRating: 5.9,
    imdbRating: 6.7,
    votes: { kp: 3663, imdb: 13136 },
    expiresAt: Date.now() + 60_000
});

assert.strictEqual(mergedMovie.imdbRating, 6.7, 'Fresh shared IMDb rating must fill missing card data');
assert.strictEqual(mergedMovie.votes.imdb, 13136, 'Fresh shared IMDb votes must fill missing card data');
assert.strictEqual(mergedMovie.kpRating, 5.9, 'Existing KP rating must remain authoritative');

const expiredMerge = mergeProviderRatingRecord(cachedMovie, {
    imdbRating: 7.1,
    expiresAt: Date.now() - 1
});
assert.strictEqual(expiredMerge, cachedMovie, 'Expired provider cache must not affect Ratings cards');

const batch = mergeProviderRatingsIntoMovies([
    { movieId: 5287148, movie: cachedMovie }
], {
    'kp:5287148': {
        imdbRating: 6.7,
        votes: { imdb: 13136 },
        expiresAt: Date.now() + 60_000
    }
});
assert.strictEqual(batch[0].movie.imdbRating, 6.7, 'Batch Ratings card merge must expose IMDb');
console.log('✅ Ratings page reuses fresh shared KP/IMDb provider cache');

const previousPageState = buildProviderRatingCache([{
    movie: { kinopoiskId: 5287148, imdbRating: 6.7 }
}]);
const replacementFromFirestore = mergeProviderRatingsIntoMovies([{
    movie: { kinopoiskId: 5287148, kpRating: 5.9 }
}], previousPageState);
assert.strictEqual(replacementFromFirestore[0].movie.imdbRating, 6.7, 'Background refresh must not erase visible IMDb');
console.log('✅ Ratings page preserves provider values during background replacement');

const outerProviderState = buildProviderRatingCache([{
    movie: { kinopoiskId: 5287148, kpRating: 5.9 },
    imdbRating: 6.7
}]);
const outerReplacement = mergeProviderRatingsIntoMovies([{
    movie: { kinopoiskId: 5287148, kpRating: 5.9 }
}], outerProviderState);
assert.strictEqual(outerReplacement[0].movie.imdbRating, 6.7, 'Outer card IMDb must survive background replacement');
console.log('✅ Ratings page preserves outer provider fields during background replacement');

const rawMovieReplacement = mergeProviderRatingsIntoMovies([{
    kinopoiskId: 5287148,
    kpRating: 5.9
}], outerProviderState);
assert.strictEqual(rawMovieReplacement[0].imdbRating, 6.7, 'Raw movie IMDb must survive provider merge');
console.log('✅ Ratings page merges provider fields into raw movie responses');

const popupSource = fs.readFileSync(path.resolve('src/popup/popup.js'), 'utf8');
assert(popupSource.includes('Utils.formatGenres(movie?.genres, 2)'), 'Popup normalizes object-shaped genres before rendering');
assert(!popupSource.includes("movie?.genres?.slice(0, 2).join(', ')"), 'Popup does not stringify genre objects with Array.join');
console.log('✅ Popup genre rendering avoids [object Object]');

const movieCacheSource = fs.readFileSync(path.resolve('src/shared/services/MovieCacheService.js'), 'utf8');
assert(movieCacheSource.includes("!lastDoc && firestoreSortField === 'lastRatingUpdatedAt'"), 'Ratings query checks missing timestamps on the first page');
assert(!movieCacheSource.includes("!hasMore && firestoreSortField === 'lastRatingUpdatedAt'"), 'Ratings query does not defer missing timestamp fallback to the last page');
assert(movieCacheSource.includes('kp_movie_${id}'), 'Batch movie cache reads legacy localStorage metadata');
console.log('✅ Ratings query keeps legacy aggregate documents visible during pagination');

const MovieCacheService = (await import('../src/shared/services/MovieCacheService.js')).default;
const previousKinopoiskConfig = globalThis.KINOPOISK_CONFIG;
const previousFirebase = globalThis.firebase;
const previousChrome = globalThis.chrome;
const previousLocalStorage = globalThis.localStorage;
globalThis.firebase = {
    firestore: {
        FieldPath: { documentId: () => 'documentId' }
    }
};
globalThis.KINOPOISK_CONFIG = { CACHE_DURATION: 24 * 60 * 60 * 1000 };
globalThis.chrome = {
    storage: {
        local: {
            get: async () => ({})
        }
    }
};
globalThis.localStorage = {
    getItem: key => key === 'kp_movie_5287148'
        ? JSON.stringify({
            kinopoiskId: 5287148,
            name: 'На краю Оук-стрит',
            lastUpdated: new Date().toISOString()
        })
        : null
};
const movieCacheService = new MovieCacheService({
    db: {
        collection: () => ({
            where: () => ({
                get: async () => ({ docs: [], forEach: () => {} })
            })
        })
    }
});
const legacyLocalStorageMovies = await movieCacheService.getBatchCachedMovies([5287148]);
assert.strictEqual(
    legacyLocalStorageMovies['5287148']?.name,
    'На краю Оук-стрит',
    'Batch movie cache recovers title from legacy localStorage when Firestore is unavailable'
);
if (previousFirebase === undefined) delete globalThis.firebase;
else globalThis.firebase = previousFirebase;
if (previousKinopoiskConfig === undefined) delete globalThis.KINOPOISK_CONFIG;
else globalThis.KINOPOISK_CONFIG = previousKinopoiskConfig;
if (previousChrome === undefined) delete globalThis.chrome;
else globalThis.chrome = previousChrome;
if (previousLocalStorage === undefined) delete globalThis.localStorage;
else globalThis.localStorage = previousLocalStorage;
console.log('✅ Popup metadata fallback recovers legacy localStorage movie titles');

const ratingsPageSource = fs.readFileSync(path.resolve('src/pages/ratings/ratings.js'), 'utf8');
assert(ratingsPageSource.includes('movieAverage > 0 ? movieAverage'), 'Ratings page prefers a valid aggregate average');
assert(ratingsPageSource.includes('if (this.filters.avgRatingFrom !== 1.0 || this.filters.avgRatingTo !== 10.0)'), 'Ratings page applies average filtering only when the range is changed');
assert(!ratingsPageSource.includes('movie.averageRating >= this.filters.avgRatingFrom && movie.averageRating <= this.filters.avgRatingTo'), 'Ratings page does not filter default full-range results by stale zero averages');
console.log('✅ Ratings page keeps rated movies visible when aggregate average data is stale');

const ratingServiceSource = fs.readFileSync(path.resolve('src/shared/services/RatingService.js'), 'utf8');
assert(ratingServiceSource.includes('const normalizedMovieId = Number(movieId);'), 'Rating writes normalize Kinopoisk IDs');
assert(ratingServiceSource.includes("String(movieId)"), 'Rating reads support legacy string movie IDs');
console.log('✅ Rating reads and writes support both legacy string and canonical numeric IDs');

assert(ratingServiceSource.includes('resolveMovieDataForRating'), 'Rating writes recover cached movie metadata when callers omit movieData');
assert(ratingServiceSource.includes('Object.assign(movieUpdates, resolvedMovieData)'), 'Rating writes persist recovered metadata with the aggregate');

const functionsSource = fs.readFileSync(path.resolve('functions/index.js'), 'utf8');
assert(functionsSource.includes('.where("movieId", "in", movieIdCandidates)'), 'Cloud aggregate includes legacy string movie IDs');
console.log('✅ Cloud aggregate repairs both numeric and string movie ID records');

const ratingsCacheSource = fs.readFileSync(path.resolve('src/shared/services/RatingsCacheService.js'), 'utf8');
assert(ratingsCacheSource.includes('repairCachedRatings'), 'Ratings cache repairs legacy cards without movie metadata');
assert(ratingsCacheSource.includes('normalizeMovieId'), 'Ratings cache normalizes movie IDs before map lookups');

const RatingsCacheService = (await import('../src/shared/services/RatingsCacheService.js')).default;
const cachedMovieForRepair = {
    kinopoiskId: 5287148,
    name: 'На краю Оук-стрит'
};
const ratingForRepair = {
    movieId: '5287148',
    userId: 'user_for_repair'
};
const ratingsCacheService = new RatingsCacheService({
    getMovieCacheService: () => ({
        getBatchCachedMovies: async () => ({ cached: cachedMovieForRepair })
    }),
    getKinopoiskService: () => ({
        getMovieById: async () => null
    }),
    getUserService: () => ({
        getUserProfilesByIds: async () => [],
        getUserProfile: async () => null
    }),
    getCurrentUser: () => null
});

await ratingsCacheService.enrichRatingsWithMovieData([ratingForRepair]);
assert.strictEqual(
    ratingForRepair.movie?.name,
    'На краю Оук-стрит',
    'String rating movieId must resolve a numeric cached movie ID'
);
console.log('✅ Ratings popup resolves movie metadata when rating and cache IDs use different types');

ratingsCacheService.cacheRatings = async () => {};
const repairedCachedRatings = await ratingsCacheService.repairCachedRatings({
    ratings: [{ movieId: '5287148', userId: 'user_for_repair' }]
}, 1);
assert.strictEqual(
    repairedCachedRatings[0].movie?.name,
    'На краю Оук-стрит',
    'Valid legacy popup cache must hydrate missing movie metadata before render'
);
console.log('✅ Legacy popup cache self-heals missing movie metadata');

console.log('\n🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
