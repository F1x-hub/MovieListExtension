const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { pageStyles } = require('./motionP0BrowserSmoke.cjs');
async function main() {
    const browser = await chromium.launch({ headless: true });
    fs.mkdirSync('artifacts/franchise-recovery', { recursive: true });
    try {
        for (const theme of ['dark-theme', 'light-theme']) for (const width of [1280, 375]) for (const reducedMotion of ['no-preference', 'reduce']) {
            const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion });
            await page.setContent(`<html class="${theme}"><style>${pageStyles('src/pages/movie-details/movie-details.html')}</style><body class="${theme}"><main class="movie-details-page-container"><h1>Человек-паук (2002)</h1><div class="movie-detail-description"><p>Описание фильма</p><div id="userRatingsSection">Отзывы</div></div></main></body></html>`);
            await page.addScriptTag({ content: fs.readFileSync('src/shared/i18n/locales.js', 'utf8').replace('export const locales', 'window.fixtureLocales') });
            await page.addScriptTag({ content: fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8').replace(/^import .*;\r?$/gm, '') });
            await page.evaluate(async () => {
                window.i18n = { currentLocale: 'ru', get: key => key.split('.').reduce((value, part) => value?.[part], fixtureLocales.ru) || key };
                const poster = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="140" height="210"><rect width="140" height="210" fill="#555"/></svg>');
                const parts = [
                    { tmdbId: 557, kinopoiskId: 838, title: 'Человек-паук', releaseDate: '2002-05-01', posterUrl: poster },
                    { tmdbId: 558, kinopoiskId: 2898, title: 'Человек-паук 2', releaseDate: '2004-06-30', posterUrl: poster },
                    { tmdbId: 559, kinopoiskId: 82441, title: 'Человек-паук 3', releaseDate: '2007-05-01', posterUrl: poster }
                ];
                window.owner = Object.create(MovieDetailsManager.prototype);
                owner.selectedMovie = { kinopoiskId: 838, tmdbId: 557, name: 'Человек-паук', type: 'movie', collection: null };
                owner.pageGeneration = 1;
                owner.activePageContext = { generation: 1, kinopoiskId: '838' };
                const fresh = { ...owner.selectedMovie, collection: { tmdbId: 556, name: 'Человек-паук [Сэм Рэйми]' }, awards: [1], frames: [1] };
                window.failCollection = false;
                window.firebaseManager = {
                    getMediaAggregatorService: () => ({ getMovieDetails: async () => fresh }),
                    getKinopoiskService: () => ({}), getMovieCacheService: () => ({}),
                    getFranchiseService: () => ({ getFranchise: async () => { if (failCollection) throw Error('offline'); return { parts }; } })
                };
                window.fullRenders = 0;
                owner.displayMovieDetails = async () => { fullRenders++; };
                owner.preloadSources = () => {};
                owner.startPostRenderEnrichment = movie => owner.observeOrLoadFranchise(movie);
                owner.page = { hideLoader() {}, showError(error) { throw error; } };
                await owner.loadMovieById(838, false, true);
            });
            await page.waitForFunction(() => document.querySelectorAll('.franchise-card').length === 3);
            assert.equal(await page.evaluate(() => fullRenders), 0, 'late collection does not rerender the page');
            assert.equal(await page.locator('.franchise-card--current').getAttribute('aria-current'), 'true');
            assert.equal(await page.locator('a.franchise-card').first().getAttribute('href'), 'movie-details.html?movieId=2898');
            if (reducedMotion === 'no-preference') await page.screenshot({ path: `artifacts/franchise-recovery/${theme}-${width}.png` });
            await page.evaluate(async () => {
                failCollection = true;
                owner.franchiseState = null;
                await owner.loadFranchiseAsync(owner.selectedMovie);
                document.addEventListener('click', event => {
                    if (event.target.closest('[data-action="retry-franchise"]')) void owner.loadFranchiseAsync(owner.selectedMovie);
                });
            });
            const retry = page.locator('[data-action="retry-franchise"]');
            assert(await retry.isVisible());
            await retry.focus();
            await page.evaluate(() => { owner.franchiseState.retryAfter = 0; failCollection = false; });
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => document.querySelectorAll('.franchise-card').length === 3);
            assert.equal(await page.locator('[data-action="retry-franchise"]').count(), 0);
            await page.close();
        }
        console.log('Franchise Chromium: 8 theme/viewport/motion cases, late metadata and keyboard retry passed');
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
