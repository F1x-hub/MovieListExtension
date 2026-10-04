const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const cleanerSource = fs.readFileSync(path.join(__dirname, '../content-scripts/player-cleaner.js'), 'utf8');

// Mount one cleaner-wrapped video on a page that declares the MovieDetails
// progress scope, with a controllable timeline.
async function mountVideo(page, { scope, owner = null, currentTime = 0, duration = 1000 }) {
    await page.evaluate(({ scope, owner, currentTime, duration }) => {
        if (scope === null) delete document.documentElement.dataset.playerProgressScope;
        else document.documentElement.dataset.playerProgressScope = scope;
        const container = document.getElementById('videoContainer');
        container.innerHTML = '';
        const video = document.createElement('video');
        video.className = 'player-surface__media';
        if (owner) video.dataset.progressOwner = owner;
        let time = currentTime;
        Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
        Object.defineProperty(video, 'readyState', { configurable: true, get: () => 0 });
        Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time, set: value => { time = value; } });
        window.testVideo = video;
        container.appendChild(video);
        video.src = 'data:video/mp4;base64,AAAA';
        window.MovieExtension_PlayerCleaner._test.replacePlayerForTest();
    }, { scope, owner, currentTime, duration });
    await page.locator('.native-player-wrapper').waitFor({ state: 'attached' });
}

const progressKeys = (page) => page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('movieExtension_progress_')));

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.route('**/*', route => route.fulfill({
            contentType: 'text/html',
            body: '<div id="videoContainer" class="video-container"></div>'
        }));
        await page.goto('http://localhost:9876/src/pages/movie-details/movie-details.html');
        await page.evaluate(() => {
            window.chrome = { runtime: { getURL: () => 'data:text/javascript,', id: 'test' } };
            localStorage.clear();
        });
        await page.addScriptTag({ content: cleanerSource });

        // 1. Positions are saved per title, not per shared movie-details.html path.
        await mountVideo(page, { scope: 'movie-111', currentTime: 400 });
        await page.evaluate(() => testVideo.dispatchEvent(new Event('pause')));
        let keys = await progressKeys(page);
        assert.equal(keys.length, 1, 'pausing must save one position');
        assert.match(keys[0], /movie_111/, `the key must carry the title scope (${keys[0]})`);

        // 2. Another title does not inherit that position.
        await mountVideo(page, { scope: 'movie-222', currentTime: 0 });
        await page.evaluate(() => testVideo.dispatchEvent(new Event('loadedmetadata')));
        assert.equal(await page.evaluate(() => testVideo.currentTime), 0,
            'a different movie must not be seeked to the previous movie\'s position');

        // 3. The same title resumes (with the existing 10 s rewind).
        await mountVideo(page, { scope: 'movie-111', currentTime: 0 });
        await page.evaluate(() => testVideo.dispatchEvent(new Event('loadedmetadata')));
        assert.equal(await page.evaluate(() => testVideo.currentTime), 390);

        // 4. Canonically restored videos (Seasonvar) are left to ProgressService.
        await page.evaluate(() => localStorage.clear());
        await mountVideo(page, { scope: 'movie-333', owner: 'canonical', currentTime: 500 });
        await page.evaluate(() => {
            testVideo.dispatchEvent(new Event('pause'));
            testVideo.dispatchEvent(new Event('loadedmetadata'));
        });
        assert.deepEqual(await progressKeys(page), [], 'canonical videos must not get a second local position');
        assert.equal(await page.evaluate(() => testVideo.currentTime), 500, 'canonical videos must not be re-seeked');

        // 5. A declared but empty scope (no movie yet) disables local resume.
        await mountVideo(page, { scope: '', currentTime: 300 });
        await page.evaluate(() => testVideo.dispatchEvent(new Event('pause')));
        assert.deepEqual(await progressKeys(page), []);

        // 6. A late save after the page switched titles must not write under the new title.
        await mountVideo(page, { scope: 'movie-444', currentTime: 200 });
        await page.evaluate(() => {
            document.documentElement.dataset.playerProgressScope = 'movie-555';
            testVideo.dispatchEvent(new Event('pause'));
        });
        assert.deepEqual(await progressKeys(page), [], 'a stale player must not save after a title switch');

        console.log('✅ player progress scope tests passed');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
