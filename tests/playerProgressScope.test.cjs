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
        const openAt = async (url) => {
            await page.goto(url);
            await page.evaluate(() => {
                window.chrome = { runtime: { getURL: () => 'data:text/javascript,', id: 'test' } };
            });
            await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerSettingsMenu.js'), 'utf8') });
            await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerMediaControls.js'), 'utf8') });
            await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerGhostPreview.js'), 'utf8') });
            await page.addScriptTag({ content: cleanerSource });
        };
        await openAt('http://localhost:9876/src/pages/movie-details/movie-details.html');
        await page.evaluate(() => localStorage.clear());

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

        // 7. Allplay frames all sit at "/": the title in token_movie keeps their positions apart.
        await openAt('http://localhost:9876/?token_movie=aaa&token=site');
        await page.evaluate(() => localStorage.clear());
        await mountVideo(page, { scope: null, currentTime: 400 });
        await page.evaluate(() => testVideo.dispatchEvent(new Event('pause')));
        keys = await progressKeys(page);
        assert.equal(keys.length, 1, 'pausing in an Allplay frame must save one position');
        assert.match(keys[0], /aaa/, `the key must carry token_movie (${keys[0]})`);

        await openAt('http://localhost:9876/?token_movie=bbb&token=site');
        await mountVideo(page, { scope: null, currentTime: 0 });
        await page.evaluate(() => testVideo.dispatchEvent(new Event('loadedmetadata')));
        assert.equal(await page.evaluate(() => testVideo.currentTime), 0,
            'another title in the same frame host must not be seeked to the first one\'s position');

        await openAt('http://localhost:9876/?token_movie=aaa&token=site');
        await mountVideo(page, { scope: null, currentTime: 0 });
        await page.evaluate(() => testVideo.dispatchEvent(new Event('loadedmetadata')));
        assert.equal(await page.evaluate(() => testVideo.currentTime), 390, 'the same title resumes in its frame');

        // 8. A bare "/" names no title, so nothing is saved there.
        await openAt('http://localhost:9876/');
        await page.evaluate(() => localStorage.clear());
        await mountVideo(page, { scope: null, currentTime: 300 });
        await page.evaluate(() => testVideo.dispatchEvent(new Event('pause')));
        assert.deepEqual(await progressKeys(page), [], 'a frame at "/" without a token has no safe key');

        // 9. Allplay episodes keep their own positions, and the moment between the menu
        //    moving and the old episode going away still saves under the old episode.
        await openAt('http://localhost:9876/?token_movie=ccc&token=site');
        await page.evaluate(() => {
            const menu = document.createElement('div');
            menu.innerHTML = `
                <div data-select="seasonType1"><div class="select__drop-item active" data-id="1">Сезон 1</div></div>
                <div data-select="episodeType1">
                    <div class="select__drop-item active" data-id="1">Серия 1</div>
                    <div class="select__drop-item" data-id="2">Серия 2</div>
                </div>`;
            document.body.appendChild(menu);
            window.markEpisode = (number) => document.querySelectorAll('[data-select="episodeType1"] .select__drop-item')
                .forEach(item => item.classList.toggle('active', item.dataset.id === String(number)));
        });
        await mountVideo(page, { scope: null, currentTime: 0 });
        await page.evaluate(() => {
            testVideo.dispatchEvent(new Event('loadedmetadata'));
            testVideo.currentTime = 500;
            markEpisode(2);
            testVideo.dispatchEvent(new Event('pause'));
        });
        keys = await progressKeys(page);
        assert.equal(keys.length, 1, 'a save while the menu moves must not create the next episode\'s position');
        assert.match(keys[0], /1$/u, `the save belongs to episode 1 (${keys[0]})`);

        await page.evaluate(() => {
            testVideo.currentTime = 0;
            testVideo.dispatchEvent(new Event('loadedmetadata'));
        });
        assert.equal(await page.evaluate(() => testVideo.currentTime), 0, 'the next episode opens at its start');

        await page.evaluate(() => {
            testVideo.currentTime = 600;
            testVideo.dispatchEvent(new Event('pause'));
            markEpisode(1);
            testVideo.currentTime = 0;
            testVideo.dispatchEvent(new Event('loadedmetadata'));
        });
        assert.equal(await page.evaluate(() => testVideo.currentTime), 490, 'episode 1 resumes at its own position');
        assert.equal((await progressKeys(page)).length, 2, 'each episode has its own position');

        // 10. Allplay's next episode arrives as a new video element: the position follows it.
        await page.evaluate(() => {
            localStorage.clear();
            markEpisode(1);
            testVideo.currentTime = 700;
            testVideo.dispatchEvent(new Event('loadedmetadata'));
            testVideo.currentTime = 700;
            testVideo.dispatchEvent(new Event('pause'));
            markEpisode(2);
            const next = document.createElement('video');
            let time = 0;
            Object.defineProperty(next, 'duration', { configurable: true, get: () => 1000 });
            Object.defineProperty(next, 'readyState', { configurable: true, get: () => 0 });
            Object.defineProperty(next, 'currentTime', { configurable: true, get: () => time, set: value => { time = value; } });
            next.src = 'data:video/mp4;base64,AAAA';
            window.staleVideo = testVideo;
            window.testVideo = next;
            document.body.appendChild(next);
            window.MovieExtension_PlayerCleaner._test.replacePlayerForTest();
        });
        assert.equal(await page.evaluate(() => document.contains(testVideo) && Boolean(testVideo.closest('.native-player-wrapper'))), true,
            'the new element replaces the old one in the player');
        await page.evaluate(() => testVideo.dispatchEvent(new Event('loadedmetadata')));
        assert.equal(await page.evaluate(() => testVideo.currentTime), 0, 'the new element opens the next episode at its start');
        await page.evaluate(() => {
            testVideo.currentTime = 800;
            testVideo.dispatchEvent(new Event('pause'));
        });
        const positions = await page.evaluate(() => Object.keys(localStorage)
            .filter(key => key.startsWith('movieExtension_progress_'))
            .map(key => [key.slice(-1), localStorage.getItem(key)]));
        assert.deepEqual(Object.fromEntries(positions), { 1: '700', 2: '800' }, 'each element saves under its own episode');

        console.log('✅ player progress scope tests passed');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
