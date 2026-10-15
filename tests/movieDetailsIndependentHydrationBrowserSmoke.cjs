const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { pageStyles } = require('./motionP0BrowserSmoke.cjs');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const read = file => fs.readFileSync(file, 'utf8');
    fs.mkdirSync('artifacts/details-hydration', { recursive: true });
    try {
        for (const theme of ['dark-theme', 'light-theme']) {
            for (const width of [1280, 375]) {
                const page = await browser.newPage({ viewport: { width, height: 900 } });
                const pageErrors = [];
                page.on('pageerror', error => pageErrors.push(error.message));
                page.on('console', msg => { if (msg.type() === 'warning') console.error(msg.text()); });
                await page.setContent(`<html class="${theme}"><head><style>${pageStyles('src/pages/movie-details/movie-details.html')}</style></head><body class="${theme}"><main class="movie-details-page-container"><div id="details"></div></main></body></html>`);
                await page.addScriptTag({ content: read('src/shared/i18n/locales.js').replace('export const locales', 'window.fixtureLocales') });
                await page.addScriptTag({ content: read('src/shared/utils/Utils.js') });
                await page.addScriptTag({ content: read('src/pages/movie-details/MetaRenderer.js') });
                await page.addScriptTag({ content: read('src/pages/movie-details/movie-details.js').replace(/^import .*;\r?$/gm, '') });
                await page.evaluate(() => {
                    window.i18n = { currentLocale: 'ru', get: key => key.split('.').reduce((v, k) => v?.[k], fixtureLocales.ru) || key };
                    window.isSeriesMedia = () => false;
                    window.KinopoiskService = class {
                        formatGenres() { return 'Драма'; }
                        formatCountries() { return ''; }
                        formatPersonNames() { return ''; }
                        formatCurrency() { return ''; }
                        formatDate() { return ''; }
                    };
                    const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
                    window.reads = Object.fromEntries(['optional', 'profile', 'collections', 'rating', 'bookmark'].map(k => [k, deferred()]));
                    window.readCounts = { rating: 0 };
                    window.chrome = { storage: { local: { set: async () => {} } } };
                    window.CollectionService = class { getCollections() { return reads.collections.promise; } };
                    window.firebaseManager = {
                        getUserService: () => ({ getUserProfile: () => reads.profile.promise }),
                        getRatingService: () => ({ getRating: () => { readCounts.rating++; return reads.rating.promise; } }),
                        getFavoriteService: () => ({ getBookmark: () => reads.bookmark.promise }),
                        getKinopoiskService: () => ({}), getMovieCacheService: () => ({}),
                        getMediaAggregatorService: () => ({ getMovieDetails: (id, options) => {
                            options.onBaseMovie({ kinopoiskId: 101, name: 'Тестовый фильм', year: 2020, description: 'Описание фильма', type: 'movie' });
                            return reads.optional.promise;
                        } })
                    };
                    window.owner = Object.assign(Object.create(MovieDetailsManager.prototype), {
                        currentUser: { uid: 'user-a' }, authVerified: true, selectedMovie: null,
                        availableCollections: [], elements: { movieDetailsContainer: document.getElementById('details') },
                        activePageContext: { generation: 1, kinopoiskId: '101' }, pageGeneration: 1,
                        beginPageGeneration() { return this.capturePageContext(); },
                        page: { showLoader() {}, hideLoader() {}, showContent() {}, showError(e) { throw e; } },
                        updateDocumentMetadata() {}, initPlayerRegistry() {}, refreshMediaPlayerReadiness: async () => {},
                        populateSourceSelector() {}, disconnectActorsGridObserver() {}, bindMovieFrameInteractions() {},
                        setupActorsGridVisibility() {}, setProtectedControlsEnabled() {}, syncRandomPoolAction() {},
                        startPostRenderEnrichment() {}, loadAwardsInBackground() {}, loadFramesInBackground() {},
                        preloadSources() {}, logFranchiseDebug() {}, patchFranchiseSection() {}, patchRelatedRelations() {},
                        updateSeriesEpisodeRatingUI() {}, renderCollectionsMenu: () => '',
                        renderActorsTab: () => '', renderAwardsTab: () => '', renderSequelsAndPrequels: () => '',
                        renderSimilarMovies: () => '', createMovieFramesSection: () => ''
                    });
                    window.clicks = 0;
                    document.addEventListener('click', e => { if (e.target.closest('.rate-movie-btn')) clicks++; });
                    window.finished = false;
                    window.loading = owner.loadMovieById(101).then(() => { finished = true; });
                });
                const button = page.locator('.rate-movie-btn');
                await button.focus();
                await page.evaluate(() => { window.beforePatch = document.activeElement; reads.rating.resolve({ rating: 8 }); reads.bookmark.resolve(null); });
                await page.waitForFunction(() => document.querySelector('.rate-movie-btn')?.dataset.userRating === '8');
                assert.equal(await page.evaluate(() => finished), false, 'useful personal control is ready before optional metadata');
                assert.equal(await page.evaluate(() => beforePatch === document.activeElement), true, 'independent patch preserves focus and button');
                await page.keyboard.press('Enter');
                assert.equal(await page.evaluate(() => clicks), 1);
                await page.evaluate(() => reads.optional.resolve({ kinopoiskId: 101, tmdbId: 202, name: 'Тестовый фильм', year: 2020, description: 'Описание фильма', type: 'movie' }));
                await page.waitForFunction(() => finished);
                assert.equal(await button.getAttribute('data-user-rating'), '8', 'enriched full render keeps the personal rating');
                assert.equal(await page.evaluate(() => document.activeElement.classList.contains('rate-movie-btn')), true, 'same-movie full render restores primary control focus');
                await page.keyboard.press('Enter');
                assert.equal(await page.evaluate(() => clicks), 2);
                assert.equal(await page.evaluate(() => readCounts.rating), 1, 'full render does not refetch personal state');
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow');
                await page.screenshot({ path: `artifacts/details-hydration/${theme}-${width}.png`, fullPage: true, animations: 'disabled' });
                await page.evaluate(() => { reads.profile.resolve(null); reads.collections.resolve([]); });
                assert.deepEqual(pageErrors, [], 'browser fixture must not raise unhandled page errors');
                await page.close();
            }
        }
        console.log('Movie Details Chromium hydration: dark/light × 1280/375, early readiness, focus/click and final rerender passed');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
