import assert from 'node:assert/strict';
import HomeCacheService from '../src/shared/services/HomeCacheService.js';
import HomeMovieNavigationService from '../src/pages/home/HomeMovieNavigationService.js';
import MediaAggregatorService from '../src/shared/services/MediaAggregatorService.js';

globalThis.chrome = {
    storage: {
        local: {
            store: {},
            get(keys, callback) {
                const result = {};
                for (const key of Array.isArray(keys) ? keys : [keys]) {
                    if (this.store[key] !== undefined) result[key] = this.store[key];
                }
                callback?.(result);
                return Promise.resolve(result);
            },
            set(values, callback) {
                Object.assign(this.store, values);
                callback?.();
                return Promise.resolve();
            },
            remove(keys, callback) {
                for (const key of (Array.isArray(keys) ? keys : [keys])) delete this.store[key];
                callback?.();
                return Promise.resolve();
            }
        }
    }
};

const makeMovie = (id, section) => ({
    tmdbId: id,
    name: `${section} ${id}`,
    alternativeName: `${section} original ${id}`,
    year: 2026,
    releaseDate: '2026-01-01',
    mediaType: section === 'series' || section === 'anime' ? 'tv' : 'movie',
    type: section,
    section,
    posterUrl: `https://image.test/${id}.jpg`
});

const tmdb = {
    isConfigured: () => true,
    getTrendingMovies: async () => Array.from({ length: 12 }, (_, i) => makeMovie(100 + i, 'featured')),
    getNowPlayingMovies: async () => Array.from({ length: 12 }, (_, i) => makeMovie(200 + i, 'films')),
    getTrendingTvShows: async () => Array.from({ length: 12 }, (_, i) => makeMovie(300 + i, 'series')),
    getFreshAnimation: async () => Array.from({ length: 12 }, (_, i) => makeMovie(400 + i, 'cartoons')),
    getFreshAnime: async () => Array.from({ length: 12 }, (_, i) => makeMovie(500 + i, 'anime')),
    getFreshMovies: async () => []
};

const home = new HomeCacheService(null, null, tmdb);
home.isCandidateForSection = (item, section) => section === 'featured' || item.section === section;

const discovery = await home.getDiscoveryData(null, { tmdbOnly: true });
assert.equal(discovery.isFromCache, false);
assert.equal(globalThis.chrome.storage.local.store.home_discovery_cache_v10, undefined);
assert.ok(globalThis.chrome.storage.local.store.home_discovery_cache_v12);

for (const section of ['featured', 'films', 'series', 'cartoons', 'anime']) {
    assert.ok(discovery.data[section].length >= 3);
    for (const card of discovery.data[section]) {
        assert.equal(card.kinopoiskId, null);
        assert.equal(card.isTmdbOnly, true);
        assert.equal(card.source, 'tmdb-only');
        assert.ok(card.tmdbId > 0);
    }
}

let htmlLookups = 0;
let htmlLookupOptions = null;
const navigation = new HomeMovieNavigationService({
    htmlSearchService: {
        findMovieByTitle: async (titles, year, options) => {
            htmlLookups++;
            htmlLookupOptions = options;
            await new Promise(resolve => setTimeout(resolve, 5));
            return { kinopoiskId: 482, name: 'История игрушек', year: 1995 };
        }
    }
});

const item = { tmdbId: 999, name: 'История игрушек', alternativeName: 'Toy Story', year: 1995, mediaType: 'movie' };
const [first, second] = await Promise.all([navigation.resolve(item), navigation.resolve(item)]);
assert.equal(first.kinopoiskId, 482);
assert.equal(second.kinopoiskId, 482);
assert.equal(htmlLookups, 1);
assert.equal(htmlLookupOptions.allowYearTolerance, true);
assert.equal(htmlLookupOptions.maxYearDelta, 1);
assert.equal((await navigation.resolve(item)).source, 'html-cache');
assert.equal(htmlLookups, 1);

// Legacy negative mappings without retryAfter must be retried after the
// matching policy changes instead of remaining blocked for the old TTL.
globalThis.chrome.storage.local.store.home_kp_html_mapping_v3 = {
    'movie:1000': {
        status: 'not-found',
        expiresAt: Date.now() + 60_000
    }
};
let recoveredLookups = 0;
const recoveryNavigation = new HomeMovieNavigationService({
    htmlSearchService: {
        findMovieByTitle: async () => {
            recoveredLookups += 1;
            return { kinopoiskId: 1000, name: 'Recovered title', year: 2026 };
        }
    }
});
const recovered = await recoveryNavigation.resolve({
    tmdbId: 1000,
    name: 'Recovered title',
    year: 2026,
    mediaType: 'movie'
});
assert.equal(recovered.kinopoiskId, 1000);
assert.equal(recoveredLookups, 1);

let identityWithMissingRatingOptions = null;
const identityOnlyNavigation = new HomeMovieNavigationService({
    htmlSearchService: {
        findMovieByTitle: async (titles, year, options) => {
            identityWithMissingRatingOptions = options;
            return { kinopoiskId: 2000, name: 'Identity only', year };
        }
    }
});
const identityOnlyResult = await identityOnlyNavigation.resolve({
    tmdbId: 2000,
    name: 'Identity only',
    year: 2026,
    mediaType: 'movie'
}, { lookupRatings: true });
assert.equal(identityOnlyResult.kinopoiskId, 2000);
assert.equal(identityOnlyResult.kpRating, 0);
assert.equal(identityWithMissingRatingOptions.requireRating, false);

let forbiddenKpCalls = 0;
const aggregator = new MediaAggregatorService({
    kinopoiskService: {
        getMovieById: async () => {
            forbiddenKpCalls++;
            throw new Error('Kinopoisk API must not be called for Home route');
        }
    },
    tmdbService: {
        isConfigured: () => true,
        getMovieDetails: async () => ({
            tmdbId: 999,
            title: 'История игрушек',
            original_title: 'Toy Story',
            year: 1995,
            posterUrl: 'https://image.test/toy-story.jpg',
            overview: 'A story about toys with enough detail for rendering.',
            genres: [{ name: 'Animation' }]
        })
    },
    movieCacheService: null,
    idMappingService: null
});

const tmdbOnlyDetails = await aggregator.getMovieDetails(482, {
    title: item.name,
    year: item.year,
    candidateTmdbId: item.tmdbId,
    mediaType: 'movie',
    skipKinopoiskApi: true
});
assert.equal(forbiddenKpCalls, 0);
assert.equal(tmdbOnlyDetails.kinopoiskId, 482);
assert.equal(tmdbOnlyDetails.tmdbId, 999);
assert.equal(tmdbOnlyDetails.name, 'История игрушек');

console.log('Home TMDB-only discovery and click-time HTML navigation tests passed');
