const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { pageStyles } = require('./motionP0BrowserSmoke.cjs');
const { createHarness } = require('./movieDetailsHeroContinue.test.cjs');

async function main() {
    const browser = await chromium.launch({ headless: true });
    const css = pageStyles('src/pages/movie-details/movie-details.html');
    const read = file => fs.readFileSync(file, 'utf8');
    fs.mkdirSync('artifacts/hero-continue', { recursive: true });
    try {
        for (const theme of ['dark-theme', 'light-theme']) {
            for (const width of [1280, 375]) {
                for (const reducedMotion of ['no-preference', 'reduce']) {
                    const page = await browser.newPage({ viewport: { width, height: 600 }, reducedMotion });
                    const fixture = createHarness(width === 375 ? 'ru' : 'en').manager;
                    fixture.selectedMovie.nextEpisode.name = 'Безликие';
                    fixture.selectedMovie.seasons[0].episodes[0].name = '1 серия — длинное название эпизода';
                    await page.setContent(`<html class="${theme}"><head><style>${css}</style></head><body class="${theme}"><main class="movie-details-page-container"><div class="movie-detail-info-container"><h1>Название сериала</h1>${fixture.renderHeroNextEpisode(fixture.selectedMovie)}<p class="movie-detail-short-description">Описание сериала</p></div></main></body></html>`);
                    await page.addScriptTag({ content: read('src/shared/i18n/locales.js').replace('export const locales', 'window.fixtureLocales') });
                    await page.addScriptTag({ content: read('src/pages/movie-details/movie-details.js').replace(/^import .*;\r?$/gm, '') });
                    await page.evaluate(({ movie, progress, language }) => {
                        window.i18n = { get(key, values = {}) {
                            let value = key.split('.').reduce((value, part) => value[part], fixtureLocales[language]);
                            for (const [key, replacement] of Object.entries(values)) value = value.replaceAll(`{${key}}`, replacement);
                            return value;
                        } };
                        window.owner = Object.create(MovieDetailsManager.prototype);
                        owner.selectedMovie = movie;
                        owner.currentProgressRecord = progress;
                        owner.currentWatchTarget = { reason: 'RESUME_IN_PROGRESS' };
                        window.selections = [];
                        owner.playSelection = selection => selections.push(selection);
                        document.addEventListener('click', event => {
                            if (event.target.closest('[data-action="continue-watch-progress"]')) owner.handleContinueWatching();
                        });
                    }, { movie: fixture.selectedMovie, progress: fixture.currentProgressRecord, language: width === 375 ? 'ru' : 'en' });
                    const button = page.locator('.hero-continue-button');
                    await button.focus();
                    await page.keyboard.press('Enter');
                    await page.keyboard.press('Space');
                    assert.equal(await page.evaluate(() => selections.length), 2);
                    assert.equal(await page.evaluate(() => selections[0].episodeNumber), 1);
                    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid');
                    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal clipping');
                    const rect = await button.boundingBox();
                    assert(rect.width > 100 && rect.x + rect.width <= width, 'whole continuation row fits');
                    if (reducedMotion === 'reduce') assert.equal(await button.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
                    await page.evaluate(() => {
                        const button = document.activeElement;
                        owner.currentProgressRecord.timestamp = 80;
                        owner.patchHeroEpisodeCard();
                        if (button !== document.activeElement || button.dataset.timestamp !== '80') throw new Error('refresh replaced focused button');
                    });
                    if (reducedMotion === 'no-preference') await page.screenshot({ path: `artifacts/hero-continue/${theme}-${width}.png` });
                    await page.evaluate(() => { delete owner.selectedMovie.nextEpisode; owner.patchHeroEpisodeCard(); });
                    assert.equal(await page.locator('.hero-next-episode-header').count(), 0);
                    assert.equal(await page.locator('.hero-continue-button').count(), 1);
                    await page.close();
                }
            }
        }
        console.log('Hero continuation Chromium: 8 theme/viewport/motion combinations, keyboard and progress/focus passed');
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
