const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { pageStyles } = require('./motionP0BrowserSmoke.cjs');
async function main() {
    const browser = await chromium.launch({ headless: true });
    fs.mkdirSync('artifacts/movie-relations', { recursive: true });
    try {
        for (const theme of ['dark-theme', 'light-theme']) for (const width of [1280, 375]) {
            const page = await browser.newPage({ viewport: { width, height: 700 } });
            await page.setContent(`<html class="${theme}"><style>${pageStyles('src/pages/movie-details/movie-details.html')}</style><body class="${theme}"><main class="movie-details-page-container"><h1>Аватар: Легенда об Аанге</h1><div class="movie-detail-description"><p>Описание сериала</p><div id="userRatingsSection">Отзывы</div></div></main></body></html>`);
            await page.addScriptTag({ content: fs.readFileSync('src/shared/i18n/locales.js', 'utf8').replace('export const locales', 'window.fixtureLocales') });
            await page.addScriptTag({ content: fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8').replace(/^import .*;\r?$/gm, '') });
            await page.evaluate(() => {
                window.i18n = { currentLocale: 'ru', get: key => key.split('.').reduce((value, part) => value?.[part], fixtureLocales.ru) || key };
                const owner = Object.create(MovieDetailsManager.prototype);
                const poster = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="#555"/></svg>');
                const movie = { kinopoiskId: 401152, isSeries: true, sequelsAndPrequels: [
                    { id: 565035, name: 'Легенда о Корре', year: 2012, poster: { url: poster } },
                    { id: 7267380, name: 'Аватар: Семь убежищ', year: 2026, poster: { url: poster } }
                ] };
                owner.selectedMovie = movie;
                owner.patchRelatedRelations(movie);
                owner.patchRelatedRelations(movie);
            });
            assert.equal(await page.locator('.sequels-section').count(), 1);
            assert.equal(await page.locator('.sequel-card').count(), 2);
            assert.equal(await page.locator('.sequel-card').first().getAttribute('href'), 'movie-details.html?movieId=565035');
            await page.locator('.sequel-card').first().focus();
            assert.equal(await page.evaluate(() => document.activeElement.tagName), 'A');
            await page.screenshot({ path: `artifacts/movie-relations/${theme}-${width}.png` });
            await page.close();
        }
        console.log('KP relations Chromium: dark/light, desktop/narrow and late rendering passed');
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
