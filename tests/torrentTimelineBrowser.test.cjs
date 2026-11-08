// A torrent being prepared shows the whole film on the player's track: what can be
// watched, what is on disk, and a blocked cursor over what is not prepared yet.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.fulfill({ contentType: 'text/html',
            body: '<body class="dark-theme"><div id="videoContainer" class="video-container" style="position:relative;width:1000px;height:560px"></div></body>' }));
        await page.goto('http://localhost:9876');
        await page.evaluate(() => { window.chrome = { runtime: { getURL: () => 'data:text/javascript,', id: 'test' } }; });
        for (const file of ['src/shared/services/player/PlayerSettingsMenu.js', 'src/shared/services/player/PlayerMediaControls.js',
            'src/shared/services/player/PlayerGhostPreview.js', 'content-scripts/player-cleaner.js']) {
            await page.addScriptTag({ content: read(file) });
        }
        await page.evaluate(() => {
            const video = document.createElement('video');
            video.className = 'player-surface__media';
            video.dataset.playerProvider = 'torrent';
            video.dataset.progressOwner = 'canonical';
            // The converted HLS covers 10 minutes of a one-hour film; 40% of the file is on disk.
            let duration = 600;
            let time = 0;
            Object.defineProperty(video, 'duration', { get: () => duration });
            Object.defineProperty(video, 'currentTime', { get: () => time, set: value => { time = value; } });
            Object.defineProperty(video, 'readyState', { get: () => 4 });
            video._movieExtensionHls = { url: 'http://localhost/session/master.m3u8', audioTracks: [], subtitleTracks: [], levels: [] };
            window.setNativeDuration = value => { duration = value; };
            window.testVideo = video;
            document.getElementById('videoContainer').appendChild(video);
            video.src = 'data:video/mp4;base64,AAAA';
            // The fixture page is not chrome-extension://, so mount through the test entry.
            window.MovieExtension_PlayerCleaner._test.replacePlayerForTest();
        });
        await page.locator('.native-player-wrapper').waitFor({ state: 'attached' });
        const setTimeline = timeline => page.evaluate(value => {
            testVideo._mediaTimeline = value;
            testVideo.dispatchEvent(new Event('extension-timeline-change'));
        }, timeline);
        await setTimeline({ totalSeconds: 3600, downloadedFraction: .4, complete: false });

        const track = page.locator('.player-progress-track');
        assert.match(await page.locator('.player-timecode').textContent(), /\/ 1:00:00$/, 'the whole film is shown from the start');
        assert.equal(await track.evaluate(node => node.classList.contains('player-progress-track--partial')), true);
        // Watchable, on disk but being prepared, and still missing: three parts that never overlap.
        const layers = await page.evaluate(() => Object.fromEntries(['ready', 'downloaded', 'missing'].map(name => {
            const style = document.querySelector(`.player-progress-${name}`).style;
            return [name, [Number.parseFloat(style.left || '0').toFixed(2), Number.parseFloat(style.width).toFixed(2)]];
        })));
        assert.deepEqual(layers, { ready: ['0.00', '16.67'], downloaded: ['16.67', '23.33'], missing: ['40.00', '60.00'] });

        // The track's content box sits inside 10px transparent hit borders.
        const box = await track.boundingBox();
        const at = ratio => ({ x: box.x + box.width * ratio, y: box.y + box.height / 2 });
        const hover = async ratio => {
            const point = at(ratio);
            await page.mouse.move(point.x, point.y);
            await page.waitForTimeout(40);
            return page.evaluate(() => ({
                cursor: getComputedStyle(document.querySelector('.player-progress-track')).cursor,
                status: document.querySelector('.ghost-status-label').hidden ? '' : document.querySelector('.ghost-status-label').textContent,
                frameHidden: getComputedStyle(document.querySelector('.ghost-video')).display === 'none'
            }));
        };
        assert.deepEqual(await hover(.8), { cursor: 'not-allowed', status: 'Ещё не скачано', frameHidden: true });
        assert.deepEqual(await hover(.3), { cursor: 'not-allowed', status: 'Скачано, готовим к просмотру', frameHidden: true });
        assert.deepEqual(await hover(.1), { cursor: 'pointer', status: '', frameHidden: false });

        await page.mouse.click(at(.8).x, at(.8).y);
        assert.equal(await page.evaluate(() => testVideo.currentTime), 0, 'a part not prepared yet cannot be chosen');
        await page.mouse.click(at(.1).x, at(.1).y);
        assert.ok(Math.abs(await page.evaluate(() => testVideo.currentTime) - 360) < 5, 'an available moment is chosen on the whole film');

        await track.focus();
        await page.keyboard.press('End');
        assert.equal(await page.evaluate(() => testVideo.currentTime), 600, 'End stops where the film can play');
        assert.equal(await track.getAttribute('aria-valuemax'), '3600');

        // Once the conversion is complete the element's own duration is the film again.
        await page.evaluate(() => setNativeDuration(3601));
        await setTimeline({ totalSeconds: 3600, downloadedFraction: 1, complete: true });
        assert.equal(await track.evaluate(node => node.classList.contains('player-progress-track--partial')), false);
        assert.equal(await page.locator('.player-progress-ready').count(), 0);
        assert.match(await page.locator('.player-timecode').textContent(), /\/ 1:00:01$/);
        assert.deepEqual(errors, []);
        console.log('PASS: torrent timeline spans the whole film, shows ready and downloaded parts and blocks what is not prepared');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
