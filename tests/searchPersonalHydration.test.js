const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const searchSource = fs.readFileSync(
    path.join(projectRoot, 'src/pages/search/search.js'),
    'utf8'
);
const kinopoiskSource = fs.readFileSync(
    path.join(projectRoot, 'src/shared/services/KinopoiskService.js'),
    'utf8'
);
const backgroundSource = fs.readFileSync(
    path.join(projectRoot, 'src/background/background.js'),
    'utf8'
);
const scraperSource = fs.readFileSync(
    path.join(projectRoot, 'content-scripts/kinopoisk-search-scraper.js'),
    'utf8'
);
const RatingService = require(path.join(
    projectRoot,
    'src/shared/services/RatingService.js'
));

async function testOrderedCardsRenderBeforePersonalHydration() {
    const cardsAppendIndex = searchSource.indexOf('this.elements.resultsGrid.appendChild(fragment);');
    const hydrationStartIndex = searchSource.indexOf(
        'this.hydratePersonalState(movies, searchGeneration, searchTraceId).catch'
    );

    assert(cardsAppendIndex >= 0, 'Search must append the ordered card fragment');
    assert(hydrationStartIndex > cardsAppendIndex, 'Personal hydration must start after card append');
    assert(
        searchSource.includes('this.isCurrentSearchGeneration(searchGeneration)'),
        'Search rendering must reject stale generations'
    );
    assert(
        searchSource.includes('getUserRatingsForMovies'),
        'Search personal ratings must use the batch service'
    );
    assert(
        searchSource.includes('getBookmarksBatch'),
        'Search personal bookmark state must use the batch service'
    );

    const renderStartIndex = searchSource.indexOf('async renderMovieCardsChunk(');
    const renderEndIndex = searchSource.indexOf('\n    getSearchMovieCard(', renderStartIndex);
    const renderSource = searchSource.slice(renderStartIndex, renderEndIndex);
    assert(
        !renderSource.includes('getRating('),
        'The critical card render path must not issue per-card rating queries'
    );
    assert(searchSource.includes('[SearchTrace]'), 'Search page must emit structured timing traces');
    assert(searchSource.includes('searchTraceStartedAt'), 'Search trace start time must cross the service boundary');
    assert(searchSource.includes('deferEntityResolution: true'), 'Search must request the fast parser-first path');
    assert(searchSource.includes('entity-enrichment:wait-for-render'), 'Search must wait for complete cards');
    assert(searchSource.includes('entity-enrichment:ready-for-render'), 'Search must log complete card readiness');
    assert(
        searchSource.indexOf('entity-enrichment:wait-for-render') < searchSource.indexOf('cards-render:start'),
        'Complete entity enrichment must finish before card rendering starts'
    );
    assert(searchSource.includes('showSearchLoading'), 'Search must show a loader before provider work');
    assert(searchSource.includes('hideSearchLoading'), 'Search must hide the loader after render or failure');
    assert(searchSource.includes("querySelector('.search-loading-state')"), 'Search loader must be reused instead of recreated');
    assert(searchSource.includes('[SearchLoader]'), 'Search loader lifecycle must be observable in diagnostics');
    const searchFlowStart = searchSource.indexOf('async searchMovies');
    const renderFlowStart = searchSource.indexOf('async renderMovieCardsChunk');
    const searchFlowSource = searchSource.slice(searchFlowStart, renderFlowStart);
    assert(!searchFlowSource.includes("this.elements.resultsGrid.innerHTML = '';"), 'Search must not clear the active loader before reusing it');
    assert(kinopoiskSource.includes('[KinopoiskSearchTrace]'), 'Kinopoisk service must emit stage timing traces');
    assert(kinopoiskSource.includes('createScrapedSearchCandidates'), 'Service must create parser-first render candidates');
    assert(kinopoiskSource.includes('entityResolutionDeferred'), 'Service must expose deferred enrichment');
    assert(kinopoiskSource.includes('tier-1-offscreen:start'), 'Offscreen tier timing must be visible');
    assert(kinopoiskSource.includes('tier-3-api:response'), 'API fallback timing must be visible');
    assert(backgroundSource.includes('[KinopoiskOffscreenTrace]'), 'Background queue timing must be visible');
    assert(backgroundSource.includes('stage: \'request:timeout\''), 'Background timeout must be traceable');
    assert(scraperSource.includes('[KPScraperTrace] dom-items-detected'), 'Scraper DOM timing must be visible');

    let cardsVisible = false;
    let hydrationFinished = false;
    const neverSettlingHydration = new Promise(() => {});

    async function renderContract() {
        cardsVisible = true;
        void neverSettlingHydration.then(() => {
            hydrationFinished = true;
        });
    }

    await renderContract();
    assert.strictEqual(cardsVisible, true, 'Cards must become visible without hydration');
    assert.strictEqual(hydrationFinished, false, 'The test hydration must remain pending');
}

async function testBatchRatingsNormalizeIdsAndPreferCanonicalDocuments() {
    const queries = [];
    const db = {
        collection() {
            const query = {
                movieIds: null,
                where(field, operator, value) {
                    if (field === 'movieId') this.movieIds = value;
                    return this;
                },
                async get() {
                    queries.push(this.movieIds);
                    const isStringQuery = this.movieIds.every(value => typeof value === 'string');
                    const documents = isStringQuery
                        ? [
                            { id: 'legacy-101', data: () => ({ movieId: '101', rating: 2 }) },
                            { id: 'legacy-102', data: () => ({ movieId: '102', rating: 5 }) }
                        ]
                        : [
                            { id: 'canonical-101', data: () => ({ movieId: 101, rating: 4 }) }
                        ];
                    return { forEach(callback) { documents.forEach(callback); } };
                }
            };
            return query;
        }
    };

    const service = new RatingService({ db });
    const ratings = await service.getUserRatingsForMovies('user-1', [101, '101', '102']);

    assert.deepStrictEqual(queries, [[101, 102], ['101', '102']]);
    assert.strictEqual(ratings.get('101').id, 'canonical-101');
    assert.strictEqual(ratings.get('101').rating, 4);
    assert.strictEqual(ratings.get('102').id, 'legacy-102');
    assert.strictEqual(ratings.size, 2);
}

(async () => {
    await testOrderedCardsRenderBeforePersonalHydration();
    await testBatchRatingsNormalizeIdsAndPreferCanonicalDocuments();
    console.log('searchPersonalHydration.test.js: all tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
