/**
 * Regression coverage for the fifth Home page audit: capped TMDB proxy
 * concurrency, daily airing-anime details cache, Series page 3 up front,
 * Kinopoisk search failures kept apart from "not found", no TMDB lookups
 * while the IMDb proxy is down, and opt-in diagnostic logs.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

function createStorage(initial = {}) {
    const store = { ...initial };
    return {
        store,
        get(keys, callback) {
            const result = {};
            for (const key of Array.isArray(keys) ? keys : [keys]) {
                if (store[key] !== undefined) result[key] = store[key];
            }
            callback?.(result);
            return Promise.resolve(result);
        },
        set(values, callback) {
            Object.assign(store, values);
            callback?.();
            return Promise.resolve();
        },
        remove(keys, callback) {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
            callback?.();
            return Promise.resolve();
        }
    };
}

async function run() {
    global.chrome = { storage: { local: createStorage() } };
    const TMDBService = require('../src/shared/services/TMDBService.js');

    // --- Proxy concurrency cap ---------------------------------------------
    let active = 0;
    let peak = 0;
    global.fetch = async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 15));
        active -= 1;
        return { ok: true, status: 200, json: async () => ({ results: [] }) };
    };
    const proxied = new TMDBService();
    await Promise.all(Array.from({ length: 20 }, (_, index) => proxied._fetchViaProxy(`https://api.themoviedb.org/3/movie/${index}`)));
    assert.equal(peak, 6, 'at most 6 proxy requests run at once');

    // --- Airing details cache ----------------------------------------------
    const dayMs = 24 * 60 * 60 * 1000;
    const isoDate = offset => new Date(Date.now() + offset * dayMs).toISOString().split('T')[0];
    const detailsRequests = [];
    const airing = new TMDBService();
    airing._fetchWithRotation = async url => {
        const parsed = new URL(url);
        const json = body => ({ ok: true, json: async () => body });
        if (parsed.pathname.endsWith('/discover/tv')) {
            const page = parsed.searchParams.get('page');
            if (parsed.searchParams.has('air_date.gte') && page === '1') {
                return json({ results: [{ id: 77, name: 'Sequel', poster_path: '/p.jpg', first_air_date: isoDate(-900), vote_count: 300, popularity: 80, genre_ids: [16], original_language: 'ja' }] });
            }
            return json({ results: [] });
        }
        detailsRequests.push(parsed.pathname + '?' + parsed.searchParams.get('language'));
        return json({ seasons: [{ season_number: 3, air_date: isoDate(-30), episode_count: 12 }] });
    };
    const first = await airing.getAiringAnime();
    assert.equal(first[0].seasonNumber, 3);
    airing.defaultLanguage = 'en-US';
    const second = await airing.getAiringAnime();
    assert.equal(second[0].seasonNumber, 3);
    assert.equal(detailsRequests.length, 1, 'season details are cached across refreshes and languages');
    chrome.storage.local.store.tmdb_airing_details_v1['77'].fetchedAt = Date.now() - dayMs - 1;
    await airing.getAiringAnime();
    assert.equal(detailsRequests.length, 2, 'details older than a day are refetched');

    // --- Series page 3 requested up front -----------------------------------
    global.MediaClassifier = require('../src/shared/utils/MediaClassifier.js');
    const HomeCacheService = require('../src/shared/services/HomeCacheService.js');
    const tvPages = [];
    const order = [];
    const item = (id, overrides = {}) => ({
        tmdbId: id, name: `Title ${id}`, posterUrl: `https://image.tmdb.org/t/p/w342/${id}.jpg`,
        year: 2026, releaseDate: '2026-01-01', voteCount: 500, genreIds: [18], originalLanguage: 'en',
        mediaType: 'movie', type: 'movie', ...overrides
    });
    const range = (start, count, overrides) => Array.from({ length: count }, (_, index) => item(start + index, overrides));
    const fakeTmdb = {
        defaultLanguage: 'ru-RU',
        isConfigured: () => true,
        getTrendingMovies: async (window, page) => (page === 1 ? range(100, 10) : []),
        getNowPlayingMovies: async page => (page === 1 ? range(200, 12) : []),
        getTrendingTvShows: async page => {
            tvPages.push(page);
            order.push(`tv${page}`);
            return page <= 3 ? range(300 + page * 10, 4, { mediaType: 'tv', type: 'tv-series' }) : [];
        },
        getFreshAnimation: async page => (page === 1 ? range(400, 12, { genreIds: [16], type: 'cartoon' }) : []),
        getFreshAnime: async page => (page === 1 ? range(500, 12, { genreIds: [16], originalLanguage: 'ja', mediaType: 'tv', type: 'anime' }) : []),
        getFreshMovies: async () => [],
        getAiringAnime: async () => { order.push('airing'); return []; }
    };
    const home = new HomeCacheService(null, {}, fakeTmdb);
    const payload = await home.refreshTmdbOnlyDiscoveryData({ language: 'ru-RU' });
    assert.ok(order.indexOf('tv3') < order.indexOf('airing'), 'page 3 is part of the first parallel batch');
    assert.equal(payload.series.length, 12);
    assert.deepEqual(tvPages.slice(0, 3), [1, 2, 3]);

    // Per-language refresh locks: English does not wait behind Russian.
    let releaseRussian;
    const blocking = new HomeCacheService(null, {}, {
        ...fakeTmdb,
        getTrendingMovies(window, page) {
            if (this.defaultLanguage === 'ru-RU' && page === 1) {
                return new Promise(resolve => { releaseRussian = () => resolve(range(100, 10)); });
            }
            return Promise.resolve(page === 1 ? range(100, 10) : []);
        }
    });
    const russianPending = blocking.refreshTmdbOnlyDiscoveryData({ language: 'ru-RU' });
    const englishDone = await Promise.race([
        blocking.refreshTmdbOnlyDiscoveryData({ language: 'en-US' }).then(() => 'english-finished'),
        new Promise(resolve => setTimeout(() => resolve('english-blocked'), 500))
    ]);
    assert.equal(englishDone, 'english-finished');
    releaseRussian();
    await russianPending;

    // --- Kinopoisk search failure vs. not found -----------------------------
    const KinopoiskPersonHtmlService = require('../src/shared/services/KinopoiskPersonHtmlService.js');
    const kp = new KinopoiskPersonHtmlService({
        kinopoiskService: {
            scrapeSearchResultsOffscreen: async () => ({ items: null, failureReason: 'BACKGROUND_TIMEOUT' })
        }
    });
    assert.equal(await kp.findMovieByTitle(['Фильм'], 2026, { mediaType: 'movie' }), null, 'legacy callers still get null');
    assert.deepEqual(
        await kp.findMovieByTitle(['Фильм'], 2026, { mediaType: 'movie', reportFailure: true }),
        { failed: true, reason: 'BACKGROUND_TIMEOUT' },
        'failures are not cached for the session'
    );

    const HomeMovieNavigationService = require('../src/pages/home/HomeMovieNavigationService.js');
    const navigation = new HomeMovieNavigationService({
        htmlSearchService: { findMovieByTitle: async () => ({ failed: true, reason: 'BACKGROUND_TIMEOUT' }) }
    });
    assert.equal(await navigation.resolve({ tmdbId: 9, name: 'X', year: 2026, mediaType: 'movie' }), null, 'a click gets null, not a failure object');
    const mapping = chrome.storage.local.store.home_kp_html_mapping_v4 || {};
    assert.equal(mapping['movie:9'], undefined, 'no negative mapping after a failed search');
    assert.deepEqual(
        await navigation.resolve({ tmdbId: 9, name: 'X', year: 2026, mediaType: 'movie' }, { reportFailure: true }),
        { failed: true, reason: 'BACKGROUND_TIMEOUT' }
    );

    const MovieRatingsEnrichmentService = require('../src/shared/services/MovieRatingsEnrichmentService.js');
    const enricher = new MovieRatingsEnrichmentService({ trace: false, storage: createStorage() });
    const failedRecord = enricher.createRecord({}, { status: 'not-found', retryAfterMs: enricher.searchFailureRetryMs });
    assert.ok(failedRecord.retryAfter - Date.now() <= 2 * 60 * 1000 + 50, 'failed searches retry within ~2 minutes');
    const notFoundRecord = enricher.createRecord({}, { status: 'not-found' });
    assert.ok(notFoundRecord.retryAfter - Date.now() > 14 * 60 * 1000, 'real "not found" keeps the 15-minute retry');

    // --- No TMDB external_ids while the IMDb proxy is down -------------------
    let externalIdsCalls = 0;
    const downEnricher = new MovieRatingsEnrichmentService({
        trace: false,
        storage: createStorage(),
        tmdbService: { getExternalIds: async () => { externalIdsCalls += 1; return {}; } },
        imdbParser: { isRatingsProxyAvailable: () => false, getImdbRatingsBatch: async () => { throw new Error('must not run'); } }
    });
    await downEnricher.prefetchImdbRatings([{ item: { tmdbId: 5, mediaType: 'movie' }, card: { dataset: {} }, imdbRating: 0 }]);
    assert.equal(externalIdsCalls, 0);

    // --- Opt-in diagnostics ---------------------------------------------------
    const QuotaTrackerService = require('../src/shared/services/QuotaTrackerService.js');
    const groups = [];
    const originalGroup = console.group;
    console.group = (...args) => groups.push(args);
    try {
        const tracker = new (QuotaTrackerService.QuotaTrackerService || QuotaTrackerService.constructor)();
        tracker.logSummary('Home page load');
        assert.equal(groups.length, 0, 'quota table is off by default');
    } finally {
        console.group = originalGroup;
    }
    const background = read('src/background/background.js');
    assert.ok(!background.includes("console.info('[KinopoiskOffscreenTrace]'"));
    assert.match(background, /movielistDebugTraces/);
    const scraper = read('content-scripts/kinopoisk-search-scraper.js');
    assert.ok(!scraper.includes("console.info('[KPScraperTrace]"));
    assert.ok(scraper.includes('[KPScraperTrace] dom-items-detected'));
    assert.ok(!read('src/offscreen/offscreen.js').includes("console.info('[KinopoiskOffscreenTrace]'"));
    assert.match(read('src/shared/services/KinopoiskService.js'), /if \(isKinopoiskSearchTraceEnabled\(\)\) console\.info\('\[KinopoiskSearchTrace\]'/);

    delete global.fetch;
    console.log('Home page audit round 5 tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
