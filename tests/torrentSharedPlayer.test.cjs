const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<div id="videoContainer" class="video-container"></div>' }));
        await page.goto('http://localhost:9876');
        await page.evaluate(() => {
            window.chrome = { runtime: { getURL: () => 'data:text/javascript,', id: 'test' } };
        });
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../content-scripts/player-cleaner.js'), 'utf8') });
        await page.evaluate(() => {
            const video = document.createElement('video');
            video.className = 'player-surface__media';
            video.dataset.playerProvider = 'torrent';
            video.controls = true;
            window.testVideo = video;
            document.getElementById('videoContainer').appendChild(video);
        });
        assert.equal(await page.locator('.native-player-wrapper').count(), 0);
        await page.evaluate(() => {
            testVideo._movieExtensionHls = {
                url: 'http://localhost/current/master.m3u8',
                audioTracks: [{ name: 'Русский' }, { name: 'English' }], audioTrack: 0,
                subtitleTracks: [{ name: 'Русские' }], subtitleTrack: -1, subtitleDisplay: false,
                levels: []
            };
            testVideo.dispatchEvent(new Event('extension-player-source-ready', { bubbles: true }));
            window.MovieExtension_PlayerCleaner._test.replacePlayerForTest();
            testVideo.src = 'data:video/mp4;base64,AAAA';
            testVideo.dispatchEvent(new Event('extension-player-source-ready', { bubbles: true }));
        });
        await page.locator('.native-player-wrapper').waitFor({ state: 'attached' });
        assert.equal(await page.locator('.native-player-wrapper').count(), 1);
        assert.equal(await page.evaluate(() => testVideo.controls), false);
        assert.equal(await page.evaluate(() => testVideo.autoplay), false);
        await page.getByTitle('Настройки', { exact: true }).click();
        await page.getByRole('menuitem', { name: /Озвучка/ }).click();
        await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
        assert.equal(await page.evaluate(() => testVideo._movieExtensionHls.audioTrack), 1);
        await page.locator('.player-settings-menu__back').click();
        await page.getByRole('menuitem', { name: /Субтитры/ }).click();
        await page.getByRole('menuitemradio', { name: 'Русские', exact: true }).click();
        assert.equal(await page.evaluate(() => testVideo._movieExtensionHls.subtitleTrack), 0);
        await page.getByRole('menuitemradio', { name: 'Откл', exact: true }).click();
        assert.equal(await page.evaluate(() => testVideo._movieExtensionHls.subtitleDisplay), false);
        assert.equal(await page.evaluate(() => _iframeGhostPlayer._getCurrentUrl()), 'http://localhost/current/master.m3u8');
        const result = await page.evaluate(() => {
            const ghost = _iframeGhostPlayer;
            Object.defineProperty(ghost._ghostVideo, 'readyState', { value: 1 });
            Object.defineProperty(ghost._ghostVideo, 'currentTime', { value: 0, writable: true });
            ghost._targetTime = 20;
            ghost._applyTarget();
            const previewTime = ghost._ghostVideo.currentTime;
            const mainTime = testVideo.currentTime;
            testVideo.dispatchEvent(new Event('extension-player-source-ready', { bubbles: true }));
            const wrappers = document.querySelectorAll('.native-player-wrapper').length;
            ghost.destroy();
            return { previewTime, mainTime, wrappers, previews: document.querySelectorAll('.ghost-tooltip').length };
        });
        assert.deepEqual(result, { previewTime: 20, mainTime: 0, wrappers: 1, previews: 0 });
        console.log('PASS: delayed source mounts one shared player; HLS track selection; isolated preview and cleanup');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
