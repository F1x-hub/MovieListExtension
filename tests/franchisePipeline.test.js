/**
 * franchisePipeline.test.js
 * Comprehensive unit and integration tests for Franchise / Collection pipeline:
 *  - TMDBService.getCollection & normalizeCollectionData
 *  - FranchiseService caching, LRU, in-flight dedup, and batch mapping
 *  - MovieDetails Franchise UI placeholder, lazy rendering, and card safety
 */

import assert from 'assert';
import fs from 'fs';
import vm from 'vm';
import { JSDOM } from 'jsdom';
import TMDBService from '../src/shared/services/TMDBService.js';
import FranchiseService from '../src/shared/services/FranchiseService.js';
import IdMappingService from '../src/shared/services/IdMappingService.js';

console.log('🧪 Starting Franchise & Collection Pipeline Test Suite...\n');

// Mock TMDB_CONFIG for testing
globalThis.TMDB_CONFIG = {
    BASE_URL: 'https://api.themoviedb.org/3',
    DEFAULT_LANGUAGE: 'ru-RU',
    API_KEYS: ['mock_key_1', 'mock_key_2'],
    API_KEY: 'mock_key_1',
    rotateKey: () => {}
};

// =========================================================================
// 1. TMDBService.normalizeCollectionData Tests
// =========================================================================
console.log('--- 1. Testing TMDBService.normalizeCollectionData ---');

const tmdb = new TMDBService();

const rawTmdbCollection = {
    id: 10194,
    name: 'История игрушек (Коллекция)',
    overview: 'Знаменитая анимационная франшиза студии Pixar.',
    poster_path: '/toy_collection_poster.jpg',
    backdrop_path: '/toy_collection_backdrop.jpg',
    parts: [
        {
            id: 863,
            title: 'История игрушек 2',
            original_title: 'Toy Story 2',
            release_date: '1999-10-30',
            poster_path: '/ts2.jpg',
            backdrop_path: '/ts2_bg.jpg',
            vote_average: 7.6,
            vote_count: 13000,
            adult: false
        },
        {
            id: 10193,
            title: 'История игрушек 3',
            original_title: 'Toy Story 3',
            release_date: '2010-06-16',
            poster_path: '/ts3.jpg',
            backdrop_path: '/ts3_bg.jpg',
            vote_average: 7.8,
            vote_count: 14000,
            adult: false
        },
        {
            id: 862,
            title: 'История игрушек',
            original_title: 'Toy Story',
            release_date: '1995-10-30',
            poster_path: '/ts1.jpg',
            backdrop_path: '/ts1_bg.jpg',
            vote_average: 8.0,
            vote_count: 17000,
            adult: false
        },
        {
            id: 301528,
            title: 'История игрушек 4',
            original_title: 'Toy Story 4',
            release_date: '2019-06-19',
            poster_path: '/ts4.jpg',
            backdrop_path: '/ts4_bg.jpg',
            vote_average: 7.5,
            vote_count: 9000,
            adult: false
        },
        {
            id: 1084244,
            title: 'История игрушек 5',
            original_title: 'Toy Story 5',
            release_date: '2026-06-17',
            poster_path: '/ts5.jpg',
            backdrop_path: '/ts5_bg.jpg',
            vote_average: 0.0,
            vote_count: 0,
            adult: false
        },
        {
            id: 999999,
            title: 'Adult Parody',
            release_date: '2005-01-01',
            adult: true
        },
        {
            id: null,
            title: 'Malformed null ID'
        },
        {
            id: 888888,
            title: '', // Missing title
            release_date: '2020-01-01'
        },
        {
            id: 777777,
            title: 'История игрушек: Без даты',
            release_date: null
        }
    ]
};

const normalized = tmdb.normalizeCollectionData(rawTmdbCollection);

assert(normalized, 'Normalized collection must exist');
assert.strictEqual(normalized.id, 10194, 'Collection ID preserved');
assert.strictEqual(normalized.name, 'История игрушек (Коллекция)', 'Collection name preserved');
assert(normalized.posterUrl.includes('w500/toy_collection_poster.jpg'), 'Poster URL built correctly');
assert(normalized.backdropUrl.includes('w1280/toy_collection_backdrop.jpg'), 'Backdrop URL built correctly');

// Check filtering: adult, null id, empty title must be filtered out
assert.strictEqual(normalized.parts.length, 6, 'Filtered out adult, invalid ID, and empty title');

// Check chronological release order (1995 -> 1999 -> 2010 -> 2019 -> 2026 -> undated at end)
assert.strictEqual(normalized.parts[0].tmdbId, 862, 'First part must be Toy Story (1995)');
assert.strictEqual(normalized.parts[0].year, 1995, 'Toy Story year is 1995');
assert.strictEqual(normalized.parts[1].tmdbId, 863, 'Second part must be Toy Story 2 (1999)');
assert.strictEqual(normalized.parts[2].tmdbId, 10193, 'Third part must be Toy Story 3 (2010)');
assert.strictEqual(normalized.parts[3].tmdbId, 301528, 'Fourth part must be Toy Story 4 (2019)');
assert.strictEqual(normalized.parts[4].tmdbId, 1084244, 'Fifth part must be Toy Story 5 (2026)');
assert.strictEqual(normalized.parts[5].tmdbId, 777777, 'Undated part placed at the end');

console.log('  ✅ 1.1 TMDB collection normalization, filtering, and chronological sorting verified');

// =========================================================================
// 2. FranchiseService.cleanCollectionName Tests
// =========================================================================
console.log('\n--- 2. Testing FranchiseService.cleanCollectionName ---');

assert.strictEqual(FranchiseService.cleanCollectionName('История игрушек (Коллекция)'), 'История игрушек');
assert.strictEqual(FranchiseService.cleanCollectionName('Гарри Поттер (коллекция)'), 'Гарри Поттер');
assert.strictEqual(FranchiseService.cleanCollectionName('Властелин колец [Коллекция]'), 'Властелин колец');
assert.strictEqual(FranchiseService.cleanCollectionName('The Dark Knight Trilogy (Collection)'), 'The Dark Knight Trilogy');
assert.strictEqual(FranchiseService.cleanCollectionName('Avatar Collection'), 'Avatar');
assert.strictEqual(FranchiseService.cleanCollectionName('Интерстеллар'), 'Интерстеллар');
assert.strictEqual(FranchiseService.cleanCollectionName(''), '');

console.log('  ✅ 2.1 FranchiseService cleanCollectionName removes collection suffixes cleanly');

// =========================================================================
// 3. FranchiseService Caching, Dedup, and Batch Mapping Tests
// =========================================================================
console.log('\n--- 3. Testing FranchiseService Caching, Dedup, and Batch Mapping ---');

let tmdbCalls = 0;
const mockTmdb = {
    async getCollection(id) {
        tmdbCalls++;
        return {
            id,
            name: 'Трилогия «Тёмный рыцарь» (Коллекция)',
            posterUrl: 'https://image.tmdb.org/t/p/w500/batman_col.jpg',
            backdropUrl: 'https://image.tmdb.org/t/p/w1280/batman_bg.jpg',
            parts: [
                { tmdbId: 272, title: 'Бэтмен: Начало', year: 2005, releaseDate: '2005-06-10', kinopoiskId: null },
                { tmdbId: 155, title: 'Тёмный рыцарь', year: 2008, releaseDate: '2008-07-16', kinopoiskId: null },
                { tmdbId: 49026, title: 'Тёмный рыцарь: Возрождение легенды', year: 2012, releaseDate: '2012-07-16', kinopoiskId: null }
            ]
        };
    }
};

let mappingCalls = 0;
const mockIdMapper = {
    buildKey(mediaType, id) {
        return `${mediaType || 'movie'}:${id}`;
    },
    async resolveBatch(candidates, options) {
        mappingCalls++;
        assert.strictEqual(options.skipQueue, true, 'Must skip unmapped queue');
        assert.strictEqual(options.context, 'franchise', 'Context must be franchise');
        const map = new Map();
        map.set('movie:272', { tmdbId: 272, kinopoiskId: 47237 });
        map.set('movie:155', { tmdbId: 155, kinopoiskId: 111543 });
        map.set('movie:49026', { tmdbId: 49026, kinopoiskId: 4374 });
        return map;
    }
};

const service = new FranchiseService({
    tmdbService: mockTmdb,
    idMappingService: mockIdMapper
});

// Test 3.1: Cold load with batch mapping
const result1 = await service.getFranchise(263);
assert(result1, 'Result must exist');
assert.strictEqual(tmdbCalls, 1, '1 TMDB call on cold load');
assert.strictEqual(mappingCalls, 1, '1 Batch mapping call on cold load');
assert.strictEqual(result1.parts[0].kinopoiskId, 47237, 'Batman Begins mapped to KP 47237');
assert.strictEqual(result1.parts[1].kinopoiskId, 111543, 'Dark Knight mapped to KP 111543');
assert.strictEqual(result1.parts[2].kinopoiskId, 4374, 'Dark Knight Rises mapped to KP 4374');

// Test 3.2: Warm load from cache (0 TMDB calls, 0 Mapping calls)
const result2 = await service.getFranchise(263);
assert.strictEqual(tmdbCalls, 1, '0 additional TMDB calls on warm cache');
assert.strictEqual(mappingCalls, 1, '0 additional mapping calls on warm cache');
assert.strictEqual(result2.parts[0].kinopoiskId, 47237, 'Warm result preserves mapped KP IDs');

// Test 3.3: In-flight deduplication (concurrent calls share 1 Promise)
const concurrentPromises = [
    service.getFranchise(555, { forceRefresh: true }),
    service.getFranchise(555, { forceRefresh: true }),
    service.getFranchise(555, { forceRefresh: true })
];
const concurrentResults = await Promise.all(concurrentPromises);
assert.strictEqual(concurrentResults[0].id, 555, 'Concurrent call resolved');
assert.strictEqual(concurrentResults[1].id, 555, 'Concurrent call resolved');
assert.strictEqual(concurrentResults[2].id, 555, 'Concurrent call resolved');
assert.strictEqual(tmdbCalls, 2, 'Concurrent requests shared exactly 1 new network call');

console.log('  ✅ 3.1 FranchiseService cold/warm cache, in-flight dedup, and batch mapping verified');

// =========================================================================
// 4. FranchiseService LRU Eviction Tests
// =========================================================================
console.log('\n--- 4. Testing FranchiseService LRU Eviction (Max 100) ---');

const lruService = new FranchiseService({
    tmdbService: mockTmdb,
    idMappingService: null
});
lruService.MAX_CACHED_ENTRIES = 5; // Set small limit for testing

for (let i = 1; i <= 8; i++) {
    await lruService.setCachedFranchise(i, {
        id: i,
        name: `Collection ${i}`,
        parts: [{ tmdbId: i * 10, title: `Part ${i}` }]
    });
}

assert.strictEqual(lruService._memoryIndex.length, 5, 'Index must be bounded to max 5');
assert.strictEqual(lruService._memoryCache.size, 5, 'Cache store must be bounded to max 5');
assert.strictEqual(await lruService.getCachedFranchise(1), null, 'Oldest item #1 must be evicted');
assert.strictEqual(await lruService.getCachedFranchise(2), null, 'Oldest item #2 must be evicted');
assert.strictEqual(await lruService.getCachedFranchise(3), null, 'Oldest item #3 must be evicted');
assert((await lruService.getCachedFranchise(8)) !== null, 'Newest item #8 must exist');

console.log('  ✅ 4.1 FranchiseService bounded LRU eviction working properly');

// =========================================================================
// 5. MovieDetails Franchise UI Placeholder & Rendering Tests
// =========================================================================
console.log('\n--- 5. Testing MovieDetails Franchise UI Placeholder & Rendering ---');

// Mock MovieDetailsManager methods for UI unit tests
const mockManager = {
    cleanFranchiseName(rawName) {
        return FranchiseService.cleanCollectionName(rawName);
    },
    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },
    renderFranchiseSkeletons(count = 4) {
        let html = '';
        for (let i = 0; i < count; i++) {
            html += `<div class="franchise-skeleton-card" aria-hidden="true"></div>`;
        }
        return html;
    },
    renderFranchiseSectionPlaceholder(movie) {
        if (!movie?.collection || !movie.collection.tmdbId) return '';
        const collection = movie.collection;
        const rawName = typeof collection.name === 'string' ? collection.name.trim() : '';
        if (!rawName) return '';

        const cleanTitle = this.cleanFranchiseName(rawName) || rawName;

        return `
            <div class="movie-franchise-section" id="movieFranchiseSection" data-collection-id="${collection.tmdbId}">
                <div class="movie-franchise-header">
                    <div class="movie-franchise-title-group">
                        <span class="movie-franchise-label">Франшиза</span>
                        <h3 class="movie-franchise-title">${this.escapeHtml(cleanTitle)}</h3>
                    </div>
                    <div class="movie-franchise-nav" id="movieFranchiseNav" style="display: none;">
                        <button type="button" class="movie-carousel-btn movie-carousel-btn--prev" data-action="scroll-franchise-prev" aria-label="Предыдущие"></button>
                        <button type="button" class="movie-carousel-btn movie-carousel-btn--next" data-action="scroll-franchise-next" aria-label="Следующие"></button>
                    </div>
                </div>
                <div class="movie-franchise-carousel" id="movieFranchiseCarousel" tabindex="0" role="region" aria-label="Франшиза ${this.escapeHtml(cleanTitle)}">
                    ${this.renderFranchiseSkeletons(4)}
                </div>
            </div>
        `;
    }
};

// Test 5.1: Movie without collection produces 0 DOM
const movieNoCol = { kinopoiskId: 100, collection: null };
assert.strictEqual(mockManager.renderFranchiseSectionPlaceholder(movieNoCol), '', 'Standalone movie renders 0 franchise DOM');

// Test 5.2: Movie with collection renders placeholder with clean title and skeletons
const movieWithCol = {
    kinopoiskId: 101,
    collection: {
        tmdbId: 10194,
        name: 'История игрушек (Коллекция)'
    }
};
const placeholderHtml = mockManager.renderFranchiseSectionPlaceholder(movieWithCol);
assert(placeholderHtml.includes('id="movieFranchiseSection"'), 'Placeholder has #movieFranchiseSection');
assert(placeholderHtml.includes('movie-franchise-label">Франшиза</span>'), 'Placeholder has coherent header label without badge styling');
assert(placeholderHtml.includes('История игрушек</h3>'), 'Placeholder cleans "(Коллекция)" suffix');
assert(placeholderHtml.includes('franchise-skeleton-card'), 'Placeholder includes skeleton shimmer cards');
assert(!placeholderHtml.includes('movie-collection-banner'), 'Old static banner class is NOT present');
assert(!placeholderHtml.includes('movie-franchise-badge'), 'Pill/badge styling class is completely removed');

console.log('  ✅ 5.1 Franchise placeholder correctly cleans title, renders unified header row, and removes old static banner');

// =========================================================================
// 6. Visual Design Tokens Audit
// =========================================================================
console.log('\n--- 6. Testing Visual Design Tokens Audit ---');

const cssContent = fs.readFileSync('src/pages/movie-details/movie-details.css', 'utf8');

// Extract .movie-franchise-section portion
const startIndex = cssContent.indexOf('Franchise / Collection Section');
const endIndex = cssContent.indexOf('/* Videos / Trailers Section');
assert(startIndex !== -1, 'Must find Franchise section in CSS');
assert(endIndex !== -1, 'Must find Videos section in CSS');
const franchiseCss = cssContent.substring(startIndex, endIndex);

assert(!franchiseCss.includes('rgba(99, 102, 241'), 'Zero purple rgba(99, 102, 241) in franchise styles');
assert(!franchiseCss.includes('#6366f1'), 'Zero purple #6366f1 in franchise styles');
assert(!franchiseCss.includes('#a5b4fc'), 'Zero purple #a5b4fc in franchise styles');
assert(franchiseCss.includes('.movie-franchise-label'), 'Uses .movie-franchise-label');
assert(franchiseCss.includes('.franchise-card--current'), 'Preserves .franchise-card--current');
assert(franchiseCss.includes('.franchise-card-badge--current'), 'Preserves .franchise-card-badge--current');

console.log('  ✅ 6.1 Verified zero purple/indigo accents in franchise CSS and complete Obsidian-Zinc integration');

// =========================================================================
// 7. Franchise Navigation + Related Content Deduplication
// =========================================================================
console.log('\n--- 7. Testing Franchise Navigation + Related Content Deduplication ---');

const movieDetailsSource = fs
    .readFileSync('src/pages/movie-details/movie-details.js', 'utf8')
    .replace(/^import .*;\r?$/gm, '');

function createMovieDetailsHarness({ selectedMovie, franchiseParts, relations = [], deferredFranchise = null }) {
    const dom = new JSDOM(`<!doctype html><body>
        <div class="movie-franchise-section" id="movieFranchiseSection">
            <div class="movie-franchise-title-group"></div>
            <div id="movieFranchiseNav" style="display:none"></div>
            <div id="movieFranchiseCarousel"><div class="franchise-skeleton-card"></div></div>
        </div>
        <div id="relationsMount"></div>
    </body>`);
    const document = dom.window.document;
    document.addEventListener = () => {};
    const windowStub = { document, firebaseManager: null };
    const context = vm.createContext({
        window: windowStub,
        document,
        FranchiseService,
        i18n: {
            currentLocale: 'ru',
            get(key) {
                if (key === 'movie_details.sequels') return 'Сиквелы и приквелы';
                if (key === 'movie_card.unknown_movie') return 'Неизвестный фильм';
                return key;
            }
        },
        console,
        Date,
        Number,
        String,
        Boolean,
        Array,
        Object,
        Map,
        Set,
        Math,
        setTimeout,
        clearTimeout,
        URLSearchParams
    });
    vm.runInContext(movieDetailsSource, context);

    const manager = Object.create(context.window.MovieDetailsManager.prototype);
    manager.selectedMovie = selectedMovie;
    manager.franchiseLoadedForMovieId = null;
    manager.franchiseService = {
        getFranchise: deferredFranchise
            ? () => deferredFranchise.promise
            : async () => ({ id: 1, name: 'Fixture', parts: franchiseParts })
    };
    manager.escapeHtml = value => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const relationsMount = document.getElementById('relationsMount');
    relationsMount.innerHTML = manager.renderSequelsAndPrequels(relations, selectedMovie);
    return { manager, document, dom };
}

const currentMovie = {
    kinopoiskId: 5494049,
    tmdbId: 969681,
    name: 'Человек-паук: Новый день',
    collection: { tmdbId: 1, name: 'Spider-Man Collection' }
};

const spiderManFranchise = [
    { tmdbId: 315635, kinopoiskId: 690593, title: 'Человек-паук: Возвращение домой', releaseDate: '2017-07-05' },
    { tmdbId: 429617, kinopoiskId: 1008445, title: 'Человек-паук: Вдали от дома', releaseDate: '2019-07-01' },
    { tmdbId: 634649, kinopoiskId: 1309570, title: 'Человек-паук: Нет пути домой', releaseDate: '2021-12-15' },
    { tmdbId: 969681, kinopoiskId: 5494049, title: 'Человек-паук: Новый день', releaseDate: '2026-07-29' }
];
const spiderManRelations = spiderManFranchise.slice(0, 3).map(part => ({
    id: part.kinopoiskId,
    tmdbId: part.tmdbId,
    name: part.title
}));

// 7.1-7.7: Real card routing contract, including future titles.
const navigationParts = [
    ...spiderManFranchise,
    { tmdbId: 900001, kinopoiskId: 900101, title: 'Future mapped', releaseDate: '2099-01-01' },
    { tmdbId: 900002, kinopoiskId: null, title: 'Future unmapped', releaseDate: '2099-02-01' }
];
const navigationHarness = createMovieDetailsHarness({
    selectedMovie: currentMovie,
    franchiseParts: navigationParts,
    relations: []
});
await navigationHarness.manager.loadFranchiseAsync(currentMovie);

const mappedCard = navigationHarness.document.querySelector('.franchise-card[data-kinopoisk-id="690593"]');
assert.strictEqual(mappedCard?.tagName, 'A', 'Mapped franchise card renders as <a>');
assert(mappedCard.getAttribute('href').endsWith('movie-details.html?movieId=690593'), 'Mapped card href uses verified KP ID');

const currentCard = navigationHarness.document.querySelector('.franchise-card[aria-current="true"]');
assert.strictEqual(currentCard?.tagName, 'DIV', 'Current movie is inert');
assert.strictEqual(currentCard?.hasAttribute('href'), false, 'Current movie has no href');

const futureMapped = navigationHarness.document.querySelector('.franchise-card[data-tmdb-id="900001"]');
assert.strictEqual(futureMapped?.tagName, 'A', 'Future mapped movie remains clickable');
assert(futureMapped.classList.contains('franchise-card--upcoming'), 'Future mapped movie keeps upcoming visual state');
assert.strictEqual(futureMapped.getAttribute('href'), 'movie-details.html?movieId=900101');

const futureUnmapped = navigationHarness.document.querySelector('.franchise-card[data-tmdb-id="900002"]');
assert.strictEqual(futureUnmapped?.tagName, 'DIV', 'Future unmapped movie is inert');
assert(futureUnmapped.classList.contains('franchise-card--inert'), 'Unmapped card uses semantic inert class');
assert.strictEqual(futureUnmapped?.hasAttribute('href'), false, 'Unmapped card has no fake route');

assert(franchiseCss.includes('.franchise-card[href]:hover'), 'Hover affordance targets clickable franchise links only');
assert(franchiseCss.includes('.franchise-card[href]:focus-visible'), 'Focus-visible affordance targets clickable franchise links only');
assert(cssContent.includes('.sequel-card[href]:hover'), 'Relation hover affordance targets clickable links only');
assert(cssContent.includes('.sequel-card[href]:focus-visible'), 'Relation focus affordance targets clickable links only');
assert(!franchiseCss.includes('.franchise-card--unreleased'), 'Upcoming is no longer conflated with unmapped/inert state');
console.log('  ✅ 7.1-7.7 Verified mapped/current/upcoming/unmapped routing and affordance rules');

// 7.8-7.10 + Spider-Man control: full overlap removes the relations section.
const spiderHarness = createMovieDetailsHarness({
    selectedMovie: currentMovie,
    franchiseParts: spiderManFranchise,
    relations: spiderManRelations
});
assert.strictEqual(spiderHarness.document.querySelectorAll('.sequel-card').length, 3, 'Spider-Man relations initially render three cards');
await spiderHarness.manager.loadFranchiseAsync(currentMovie);
assert.strictEqual(spiderHarness.document.querySelector('.sequels-section'), null, 'Fully overlapping Spider-Man relations section is removed');
console.log('  ✅ 7.8-7.10 Spider-Man full overlap is removed after lazy franchise resolution');

// 7.9 + 7.11: partial overlap keeps only unique D/E relations.
const partialMovie = { kinopoiskId: 100, tmdbId: 1000, collection: { tmdbId: 2, name: 'ABC' } };
const partialFranchise = [
    { kinopoiskId: 101, tmdbId: 1001, title: 'A' },
    { kinopoiskId: 102, tmdbId: 1002, title: 'B' },
    { kinopoiskId: 103, tmdbId: 1003, title: 'C' }
];
const partialRelations = [
    { id: 102, tmdbId: 1002, name: 'B' },
    { id: 103, tmdbId: 1003, name: 'C' },
    { id: 104, tmdbId: 1004, name: 'D' },
    { id: 105, tmdbId: 1005, name: 'E' }
];
const partialHarness = createMovieDetailsHarness({
    selectedMovie: partialMovie,
    franchiseParts: partialFranchise,
    relations: partialRelations
});
await partialHarness.manager.loadFranchiseAsync(partialMovie);
assert.deepStrictEqual(
    Array.from(partialHarness.document.querySelectorAll('.sequel-card')).map(card => Number(card.dataset.kinopoiskId)),
    [104, 105],
    'Partial overlap preserves unique D/E relations in source order'
);
console.log('  ✅ 7.9 & 7.11 Partial overlap preserves unique relations');

// 7.12-7.13 + internal source dedup: omit current, dedup stable IDs, never title-only dedup.
const identityHarness = createMovieDetailsHarness({
    selectedMovie: partialMovie,
    franchiseParts: partialFranchise,
    relations: [
        { id: 100, tmdbId: 1000, name: 'Current duplicate' },
        { id: 104, tmdbId: 1004, name: 'Same title' },
        { id: 104, tmdbId: 1004, name: 'Stable duplicate' },
        { id: 105, tmdbId: 1005, name: 'Same title' }
    ]
});
assert.deepStrictEqual(
    Array.from(identityHarness.document.querySelectorAll('.sequel-card')).map(card => Number(card.dataset.kinopoiskId)),
    [104, 105],
    'Current movie is omitted, stable duplicate removed, same-title different-ID item retained'
);
assert.strictEqual(
    FranchiseService.deduplicateByStableIdentity([...partialFranchise, partialFranchise[1]]).length,
    3,
    'Franchise source is internally deduplicated by stable identity'
);
console.log('  ✅ 7.12-7.13 Stable-ID-only dedup avoids title false positives');

// 7.14: no useful franchise leaves relations unchanged.
const noFranchiseHarness = createMovieDetailsHarness({
    selectedMovie: partialMovie,
    franchiseParts: [partialFranchise[0]],
    relations: partialRelations
});
const noFranchiseResult = noFranchiseHarness.manager.patchSequelsAgainstFranchise([partialFranchise[0]], '100');
assert.strictEqual(noFranchiseResult.applied, false, 'Single-part/non-useful franchise does not patch relations');
assert.strictEqual(noFranchiseHarness.document.querySelectorAll('.sequel-card').length, 4, 'Relations remain unchanged without useful franchise');

// 7.15: stale async response must not render or patch the new movie.
let resolveDeferred;
const deferred = {
    promise: new Promise(resolve => { resolveDeferred = resolve; })
};
const staleHarness = createMovieDetailsHarness({
    selectedMovie: partialMovie,
    franchiseParts: partialFranchise,
    relations: partialRelations,
    deferredFranchise: deferred
});
const staleLoad = staleHarness.manager.loadFranchiseAsync(partialMovie);
staleHarness.manager.selectedMovie = { kinopoiskId: 999, tmdbId: 9999 };
resolveDeferred({ id: 2, name: 'ABC', parts: partialFranchise });
await staleLoad;
assert.strictEqual(staleHarness.document.querySelectorAll('.sequel-card').length, 4, 'Stale response does not patch relations for a new active movie');
assert(staleHarness.document.querySelector('.franchise-skeleton-card'), 'Stale response does not render old franchise cards');
console.log('  ✅ 7.14-7.15 No-franchise and stale-response safety verified');

// =========================================================================
// 8. Real End-to-End Spider-Man & Toy Story Navigation Contract Verification
// =========================================================================
console.log('\n--- 8. Testing End-to-End Spider-Man & Toy Story Navigation Contract ---');

// 8.1 Real IdMappingService + FranchiseService pipeline with canonical keys.
const toyStoryProviderFixture = {
    863: 405,
    10193: 258328,
    301528: 846824
};
const toyStoryMetadataFixture = {
    'История игрушек 2': { id: 405, name: 'История игрушек 2', alternativeName: 'Toy Story 2', year: 1999, type: 'movie' },
    'История игрушек: Большой побег': { id: 258328, name: 'История игрушек: Большой побег', alternativeName: 'Toy Story 3', year: 2010, type: 'movie' },
    'История игрушек 4': { id: 846824, name: 'История игрушек 4', alternativeName: 'Toy Story 4', year: 2019, type: 'movie' }
};
const e2eProviderService = {
    baseUrl: 'https://api.test',
    async _fetchWithRotation(url) {
        const ids = [...url.matchAll(/externalId\.tmdb=([^&]+)/g)].map(match => Number(match[1]));
        const docs = [];
        return { ok: true, status: 200, json: async () => ({ docs, total: docs.length, pages: 1 }) };
    },
    async searchMovies(query) {
        const doc = toyStoryMetadataFixture[query];
        return { docs: doc ? [doc] : [] };
    }
};
const realIdMapper = new IdMappingService(e2eProviderService);
await realIdMapper.saveMappingCache({
    'movie:315635': { tmdbId: 315635, kpId: 690593, status: 'resolved', identityStatus: 'VERIFIED' },
    'movie:429617': { tmdbId: 429617, kpId: 1008445, status: 'resolved', identityStatus: 'VERIFIED' },
    'movie:634649': { tmdbId: 634649, kpId: 1309570, status: 'resolved', identityStatus: 'VERIFIED' },
    'movie:969681': { tmdbId: 969681, kpId: 5494049, status: 'resolved', identityStatus: 'VERIFIED' },
    'movie:862': { tmdbId: 862, kpId: 482, status: 'resolved', identityStatus: 'VERIFIED' },
    'movie:1084244': { tmdbId: 1084244, kpId: 5424947, status: 'resolved', identityStatus: 'VERIFIED' }
});

const e2eTmdbService = {
    async getCollection(id) {
        if (id === 531241) {
            return {
                id: 531241,
                name: 'Человек-паук (Коллекция)',
                posterUrl: 'https://image.tmdb.org/t/p/w500/spiderman_col.jpg',
                backdropUrl: 'https://image.tmdb.org/t/p/w1280/spiderman_bg.jpg',
                parts: [
                    { tmdbId: 315635, title: 'Человек-паук: Возвращение домой', releaseDate: '2017-07-05', year: 2017 },
                    { tmdbId: 429617, title: 'Человек-паук: Вдали от дома', releaseDate: '2019-07-01', year: 2019 },
                    { tmdbId: 634649, title: 'Человек-паук: Нет пути домой', releaseDate: '2021-12-15', year: 2021 },
                    { tmdbId: 969681, title: 'Человек-паук: Новый день', releaseDate: '2026-07-29', year: 2026 }
                ]
            };
        }
        if (id === 10194) {
            return {
                id: 10194,
                name: 'История игрушек (Коллекция)',
                parts: [
                    { tmdbId: 862, title: 'История игрушек', releaseDate: '1995-10-30', year: 1995 },
                    { tmdbId: 863, title: 'История игрушек 2', releaseDate: '1999-10-30', year: 1999 },
                    { tmdbId: 10193, title: 'История игрушек: Большой побег', releaseDate: '2010-06-16', year: 2010 },
                    { tmdbId: 301528, title: 'История игрушек 4', releaseDate: '2019-06-19', year: 2019 },
                    { tmdbId: 1084244, title: 'История игрушек 5', releaseDate: '2026-06-17', year: 2026 }
                ]
            };
        }
        return null;
    }
};

const e2eFranchiseService = new FranchiseService({
    tmdbService: e2eTmdbService,
    idMappingService: realIdMapper
});

// Test 8.1: Fetch Spider-Man collection and verify parts mapped
const spidermanCollection = await e2eFranchiseService.getFranchise(531241);
assert(spidermanCollection, 'Spider-Man collection fetched');
assert.strictEqual(spidermanCollection.parts[0].kinopoiskId, 690593, 'Homecoming mapped to KP 690593');
assert.strictEqual(spidermanCollection.parts[1].kinopoiskId, 1008445, 'Far From Home mapped to KP 1008445');
assert.strictEqual(spidermanCollection.parts[2].kinopoiskId, 1309570, 'No Way Home mapped to KP 1309570');
assert.strictEqual(spidermanCollection.parts[3].kinopoiskId, 5494049, 'Brand New Day mapped to KP 5494049');

// Test 8.2: Render Spider-Man cards in DOM when viewing Brand New Day (current)
const spidermanHarness = createMovieDetailsHarness({
    selectedMovie: { kinopoiskId: 5494049, tmdbId: 969681, name: 'Человек-паук: Новый день', collection: { tmdbId: 531241 } },
    franchiseParts: spidermanCollection.parts,
    relations: []
});
await spidermanHarness.manager.loadFranchiseAsync(spidermanHarness.manager.selectedMovie);

const cardHomecoming = spidermanHarness.document.querySelector('.franchise-card[data-tmdb-id="315635"]');
assert.strictEqual(cardHomecoming?.tagName, 'A', 'Homecoming must render as <a>');
assert.strictEqual(cardHomecoming.getAttribute('href'), 'movie-details.html?movieId=690593', 'Homecoming href points to KP 690593');
assert.strictEqual(cardHomecoming.classList.contains('franchise-card--inert'), false, 'Homecoming must NOT be inert');

const cardFarFromHome = spidermanHarness.document.querySelector('.franchise-card[data-tmdb-id="429617"]');
assert.strictEqual(cardFarFromHome?.tagName, 'A', 'Far From Home must render as <a>');
assert.strictEqual(cardFarFromHome.getAttribute('href'), 'movie-details.html?movieId=1008445', 'Far From Home href points to KP 1008445');
assert.strictEqual(cardFarFromHome.classList.contains('franchise-card--inert'), false, 'Far From Home must NOT be inert');

const cardNoWayHome = spidermanHarness.document.querySelector('.franchise-card[data-tmdb-id="634649"]');
assert.strictEqual(cardNoWayHome?.tagName, 'A', 'No Way Home must render as <a>');
assert.strictEqual(cardNoWayHome.getAttribute('href'), 'movie-details.html?movieId=1309570', 'No Way Home href points to KP 1309570');
assert.strictEqual(cardNoWayHome.classList.contains('franchise-card--inert'), false, 'No Way Home must NOT be inert');

const cardBrandNewDay = spidermanHarness.document.querySelector('.franchise-card[data-tmdb-id="969681"]');
assert.strictEqual(cardBrandNewDay?.tagName, 'DIV', 'Brand New Day (current movie) must render as <div>');
assert.strictEqual(cardBrandNewDay.hasAttribute('href'), false, 'Brand New Day must NOT have href');
assert.strictEqual(cardBrandNewDay.getAttribute('aria-current'), 'true', 'Brand New Day must have aria-current="true"');
assert(cardBrandNewDay.classList.contains('franchise-card--current'), 'Brand New Day has franchise-card--current class');

console.log('  ✅ 8.1-8.2 Spider-Man collection cards render as semantic clickable <a> links with valid KP routes');

// Test 8.3: Toy Story Collection with Toy Story 5 as the current movie
const toyStoryCollection = await e2eFranchiseService.getFranchise(10194);
assert(toyStoryCollection, 'Toy Story collection fetched');
assert.strictEqual(toyStoryCollection.parts[0].kinopoiskId, 482, 'Toy Story 1 mapped');
assert.strictEqual(toyStoryCollection.parts[1].kinopoiskId, toyStoryProviderFixture[863], 'Toy Story 2 mapped');
assert.strictEqual(toyStoryCollection.parts[2].kinopoiskId, toyStoryProviderFixture[10193], 'Toy Story 3 mapped');
assert.strictEqual(toyStoryCollection.parts[3].kinopoiskId, toyStoryProviderFixture[301528], 'Toy Story 4 mapped');
assert.strictEqual(toyStoryCollection.parts[4].kinopoiskId, 5424947, 'Toy Story 5 mapped');

const toyStoryHarness = createMovieDetailsHarness({
    selectedMovie: { kinopoiskId: 5424947, tmdbId: 1084244, name: 'История игрушек 5', collection: { tmdbId: 10194 } },
    franchiseParts: toyStoryCollection.parts,
    relations: []
});
await toyStoryHarness.manager.loadFranchiseAsync(toyStoryHarness.manager.selectedMovie);

const cardToyStory1 = toyStoryHarness.document.querySelector('.franchise-card[data-tmdb-id="862"]');
assert.strictEqual(cardToyStory1?.tagName, 'A', 'Toy Story 1 is clickable <a>');
assert.strictEqual(cardToyStory1.getAttribute('href'), 'movie-details.html?movieId=482');

const cardToyStory2 = toyStoryHarness.document.querySelector('.franchise-card[data-tmdb-id="863"]');
assert.strictEqual(cardToyStory2?.tagName, 'A', 'Toy Story 2 is clickable <a>');
assert.strictEqual(cardToyStory2.getAttribute('href'), `movie-details.html?movieId=${toyStoryProviderFixture[863]}`);

const cardToyStory3 = toyStoryHarness.document.querySelector('.franchise-card[data-tmdb-id="10193"]');
assert.strictEqual(cardToyStory3?.tagName, 'A', 'Toy Story 3 is clickable <a>');
assert.strictEqual(cardToyStory3.getAttribute('href'), `movie-details.html?movieId=${toyStoryProviderFixture[10193]}`);

const cardToyStory4 = toyStoryHarness.document.querySelector('.franchise-card[data-tmdb-id="301528"]');
assert.strictEqual(cardToyStory4?.tagName, 'A', 'Toy Story 4 is clickable <a>');
assert.strictEqual(cardToyStory4.getAttribute('href'), `movie-details.html?movieId=${toyStoryProviderFixture[301528]}`);

const currentToyStory5 = toyStoryHarness.document.querySelector('.franchise-card[data-tmdb-id="1084244"]');
assert.strictEqual(currentToyStory5?.tagName, 'DIV', 'Toy Story 5 current movie is non-clickable <div>');
assert.strictEqual(currentToyStory5.hasAttribute('href'), false, 'Toy Story 5 current movie has no href');
assert.strictEqual(currentToyStory5.getAttribute('aria-current'), 'true');
assert(currentToyStory5.classList.contains('franchise-card--current'), 'Toy Story 5 is current');

console.log('  ✅ 8.3 Toy Story collection navigation contract verified');

// Test 8.3b: Same-movie retained state must not preserve stale inert cards.
const staleToyStoryHarness = createMovieDetailsHarness({
    selectedMovie: { kinopoiskId: 5424947, tmdbId: 1084244, name: 'Toy Story 5', collection: { tmdbId: 10194 } },
    franchiseParts: toyStoryCollection.parts,
    relations: []
});
let staleStateServiceCalls = 0;
staleToyStoryHarness.manager.franchiseState = {
    movieId: '5424947',
    status: 'ready',
    data: toyStoryCollection.parts.map(part => ({ ...part, kinopoiskId: part.tmdbId === 862 ? 482 : null }))
};
staleToyStoryHarness.manager.franchiseService = {
    async getFranchise() {
        staleStateServiceCalls++;
        return toyStoryCollection;
    }
};
await staleToyStoryHarness.manager.loadFranchiseAsync(staleToyStoryHarness.manager.selectedMovie);
assert.strictEqual(staleStateServiceCalls, 1, 'Stale ready state must trigger a healing service read');
assert.strictEqual(staleToyStoryHarness.document.querySelector('.franchise-card[data-tmdb-id="863"]')?.tagName, 'A');
assert.strictEqual(staleToyStoryHarness.document.querySelector('.franchise-card[data-tmdb-id="863"]')?.getAttribute('href'), `movie-details.html?movieId=${toyStoryProviderFixture[863]}`);
assert.strictEqual(staleToyStoryHarness.document.querySelector('.franchise-card[data-tmdb-id="10193"]')?.tagName, 'A');
assert.strictEqual(staleToyStoryHarness.document.querySelector('.franchise-card[data-tmdb-id="301528"]')?.tagName, 'A');

// Same-movie rerender reuses only the now-complete retained state.
staleToyStoryHarness.document.getElementById('movieFranchiseCarousel').innerHTML = '';
await staleToyStoryHarness.manager.loadFranchiseAsync(staleToyStoryHarness.manager.selectedMovie);
assert.strictEqual(staleStateServiceCalls, 1, 'Complete same-movie state must reuse healed data');
assert.strictEqual(staleToyStoryHarness.document.querySelector('.franchise-card[data-tmdb-id="863"]')?.tagName, 'A');
assert.strictEqual(staleToyStoryHarness.document.querySelector('.franchise-card[data-tmdb-id="1084244"]')?.tagName, 'DIV');
console.log('  ✅ 8.3b Same-cycle stale state healing and same-movie rerender verified');

// Test 8.4: Direct Real ID Mapping for TMDB 634649 -> KP 1309570
const directIdMapper = new IdMappingService();
const mockKpServiceForNoWayHome = {
    async _fetchWithRotation() {
        return {
            ok: true,
            status: 200,
            json: async () => ({
                docs: [
                    {
                        id: 1309570,
                        type: 'movie',
                        externalId: { tmdb: 634649, imdb: 'tt10872600' }
                    }
                ],
                total: 1,
                pages: 1
            })
        };
    }
};

const directBatchMap = await directIdMapper.resolveBatch([
    {
        tmdbId: 634649,
        mediaType: 'movie',
        title: 'Человек-паук: Нет пути домой',
        originalTitle: 'Spider-Man: No Way Home',
        year: 2021
    }
], { kinopoiskService: mockKpServiceForNoWayHome });

assert.strictEqual(directBatchMap.has('movie:634649'), true, 'Batch map must have canonical key movie:634649');
const resolvedNoWayHome = directBatchMap.get('movie:634649');
assert.strictEqual(resolvedNoWayHome.status, 'resolved', 'No Way Home resolved status');
assert.strictEqual(resolvedNoWayHome.kinopoiskId, 1309570, 'No Way Home mapped directly to KP 1309570');
console.log('  ✅ 8.4 Direct TMDB 634649 -> KP 1309570 mapping verified');

// Test 8.5: Negative Cache Recovery on forceRefresh
await directIdMapper.saveMappingCache({
    'movie:634649': {
        tmdbId: 634649,
        mediaType: 'movie',
        kpId: null,
        status: 'not-found',
        retryAfter: Date.now() + 1000000
    }
});

// Without forceRefresh: hits negative cache
const staleNeg = await directIdMapper.resolveBatch([
    { tmdbId: 634649, mediaType: 'movie' }
], { kinopoiskService: mockKpServiceForNoWayHome });
assert.strictEqual(staleNeg.get('movie:634649')?.kinopoiskId, null, 'Negative cache hit without forceRefresh');

// With forceRefresh: bypasses negative cache and recovers KP ID
const recovered = await directIdMapper.resolveBatch([
    { tmdbId: 634649, mediaType: 'movie' }
], { kinopoiskService: mockKpServiceForNoWayHome, forceRefresh: true });
assert.strictEqual(recovered.get('movie:634649')?.kinopoiskId, 1309570, 'Force refresh recovers valid KP ID');
console.log('  ✅ 8.5 Negative cache recovery via forceRefresh verified');

// Test 8.6: Self-Healing Franchise Collection Cache on read (Bypassing Stale Negative IdMapping Cache)
const healingFranchiseService = new FranchiseService({
    tmdbService: null,
    idMappingService: directIdMapper
});

// Seed IdMappingService with active negative cache entry for No Way Home
await directIdMapper.saveMappingCache({
    'movie:634649': {
        tmdbId: 634649,
        mediaType: 'movie',
        kpId: null,
        status: 'not-found',
        retryAfter: Date.now() + 1000000
    }
});

// Pre-seed warm cache with No Way Home having kinopoiskId: null
await healingFranchiseService.setCachedFranchise(531241, {
    id: 531241,
    name: 'Человек-паук (Коллекция)',
    parts: [
        { tmdbId: 315635, kinopoiskId: 690593, title: 'Возвращение домой' },
        { tmdbId: 429617, kinopoiskId: 1008445, title: 'Вдали от дома' },
        { tmdbId: 634649, kinopoiskId: null, title: 'Нет пути домой' },
        { tmdbId: 969681, kinopoiskId: 5494049, title: 'Новый день' }
    ]
});

// Reading cached franchise must self-heal unmapped No Way Home part and bypass negative cache
const healedCollection = await healingFranchiseService.getFranchise(531241, { kinopoiskService: mockKpServiceForNoWayHome });
assert(healedCollection, 'Healed collection returned');
assert.strictEqual(healedCollection.parts[2].kinopoiskId, 1309570, 'No Way Home automatically self-healed to KP 1309570');

// Verify negative cache in IdMappingService was replaced with resolved entry
const updatedCache = await directIdMapper.getMappingCache();
assert.strictEqual(updatedCache['movie:634649']?.status, 'resolved', 'Negative cache replaced with resolved');
assert.strictEqual(updatedCache['movie:634649']?.kpId, 1309570, 'Resolved KP ID stored in IdMapping cache');

// Verify second load has 0 unmapped parts and makes 0 mapping calls
let secondLoadMappingCalls = 0;
const mockTrackingMapper = {
    buildKey(type, id) { return `${type}:${id}`; },
    async resolveBatch() {
        secondLoadMappingCalls++;
        return new Map();
    }
};
const warmFranchiseService = new FranchiseService({
    tmdbService: null,
    idMappingService: mockTrackingMapper
});
warmFranchiseService._memoryCache = healingFranchiseService._memoryCache;
const secondLoadResult = await warmFranchiseService.getFranchise(531241);
assert.strictEqual(secondLoadMappingCalls, 0, 'Second load makes 0 mapping calls because franchise cache is already healed');
assert.strictEqual(secondLoadResult.parts[2].kinopoiskId, 1309570, 'Second load preserves healed KP ID');

// Verify DOM rendering of healed No Way Home card
const healedHarness = createMovieDetailsHarness({
    selectedMovie: { kinopoiskId: 5494049, tmdbId: 969681, name: 'Человек-паук: Новый день', collection: { tmdbId: 531241 } },
    franchiseParts: healedCollection.parts,
    relations: []
});
await healedHarness.manager.loadFranchiseAsync(healedHarness.manager.selectedMovie);

const healedNoWayHomeCard = healedHarness.document.querySelector('.franchise-card[data-tmdb-id="634649"]');
assert.strictEqual(healedNoWayHomeCard?.tagName, 'A', 'Healed No Way Home card renders as <a>');
assert.strictEqual(healedNoWayHomeCard.getAttribute('href'), 'movie-details.html?movieId=1309570', 'Healed No Way Home routes to KP 1309570');
assert.strictEqual(healedNoWayHomeCard.classList.contains('franchise-card--inert'), false, 'Healed No Way Home is clickable and NOT inert');
console.log('  ✅ 8.6 Self-healing franchise cache on-read remapping verified');

// Test 8.7: Reproduce the real provider anomaly and browser memory/storage timing.
// The live KP document 1309570 has no externalId.tmdb, so the authoritative
// externalId.tmdb=634649 request completes successfully with an empty docs array.
const originalChrome = globalThis.chrome;
const browserStorage = {};
globalThis.chrome = {
    storage: {
        local: {
            get(keys, callback) {
                const requested = Array.isArray(keys) ? keys : [keys];
                const result = {};
                requested.forEach(key => {
                    if (Object.prototype.hasOwnProperty.call(browserStorage, key)) result[key] = browserStorage[key];
                });
                callback(result);
            },
            set(values, callback) {
                Object.assign(browserStorage, values);
                if (callback) callback();
            },
            remove(keys, callback) {
                (Array.isArray(keys) ? keys : [keys]).forEach(key => delete browserStorage[key]);
                if (callback) callback();
            }
        }
    }
};

try {
    let realShapeLookupCalls = 0;
    const emptyProviderResultService = {
        async _fetchWithRotation() {
            realShapeLookupCalls++;
            return {
                ok: true,
                status: 200,
                json: async () => ({ docs: [], total: 0, pages: 0 })
            };
        }
    };
    const browserMapper = new IdMappingService(emptyProviderResultService);
    await browserMapper.saveMappingCache({
        'movie:634649': {
            tmdbId: 634649,
            mediaType: 'movie',
            kpId: null,
            status: 'not-found',
            retryAfter: Date.now() + 1000000
        }
    });

    const browserFranchise = new FranchiseService({
        tmdbService: null,
        idMappingService: browserMapper,
        kinopoiskService: emptyProviderResultService
    });
    await browserFranchise.setCachedFranchise(531241, {
        id: 531241,
        name: 'Человек-паук (Коллекция)',
        parts: [
            { tmdbId: 315635, kinopoiskId: 690593, title: 'Возвращение домой' },
            { tmdbId: 429617, kinopoiskId: 1008445, title: 'Вдали от дома' },
            { tmdbId: 634649, kinopoiskId: null, title: 'Нет пути домой' },
            { tmdbId: 969681, kinopoiskId: 5494049, title: 'Новый день' }
        ]
    });

    const browserHealed = await browserFranchise.getFranchise(531241);
    assert.strictEqual(realShapeLookupCalls, 1, 'Real empty-provider request must actually execute once');
    assert.strictEqual(browserHealed.parts[2].kinopoiskId, 1309570, 'Provider exception heals before getFranchise returns');

    const productionShape = await browserMapper.resolveBatch([
        { tmdbId: 634649, mediaType: 'movie' }
    ]);
    assert.strictEqual(productionShape.get('movie:634649')?.kinopoiskId, 1309570, 'Production return shape exposes kinopoiskId');
    assert.strictEqual(browserMapper._memoryCache.get('movie:634649')?.kpId, 1309570, 'IdMapping memory cache replaces stale negative');
    assert.strictEqual(browserStorage.tmdb_kp_mapping_cache_v2['movie:634649']?.kpId, 1309570, 'IdMapping storage cache persists kpId');

    const franchiseKey = 'tmdb_collection_cache_v2_531241';
    assert.strictEqual(browserFranchise._memoryCache.get(franchiseKey)?.parts[2]?.kinopoiskId, 1309570, 'Franchise memory cache is healed');
    assert.strictEqual(browserStorage[franchiseKey]?.parts[2]?.kinopoiskId, 1309570, 'Franchise storage cache is healed');

    let reloadMappingCalls = 0;
    const reloadFranchise = new FranchiseService({
        tmdbService: null,
        idMappingService: {
            async resolveBatch() {
                reloadMappingCalls++;
                return new Map();
            }
        }
    });
    const secondReload = await reloadFranchise.getFranchise(531241);
    assert.strictEqual(reloadMappingCalls, 0, 'Second browser load reads healed storage before mapping');
    assert.strictEqual(secondReload.parts[2].kinopoiskId, 1309570, 'Second browser load preserves KP 1309570');
    console.log('  ✅ 8.7 Real empty-provider timing updates mapping/franchise memory and Chrome storage before render');
} finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
}

console.log('\n🎉 ALL 8 Franchise Pipeline, Navigation & Dedup Test Suites Passed Successfully!\n');
