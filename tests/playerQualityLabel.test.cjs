const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.route('**/*', route => route.fulfill({
            contentType: 'text/html',
            body: '<div id="videoContainer" class="video-container"></div>'
        }));
        await page.goto('http://localhost:9876');
        await page.evaluate(() => {
            window.chrome = { runtime: { getURL: () => 'data:text/javascript,', id: 'test' } };
        });
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../content-scripts/player-cleaner.js'), 'utf8') });
        await page.evaluate(() => {
            const video = document.createElement('video');
            video.className = 'player-surface__media';
            window.testVideo = video;
            document.getElementById('videoContainer').appendChild(video);
            video._movieExtensionHls = {
                url: 'http://localhost/stream/master.m3u8',
                levels: [{ height: 1080, bitrate: 6e6 }, { height: 720, bitrate: 3e6 }, { height: 480, bitrate: 1e6 }],
                autoLevelEnabled: true,
                currentLevel: 1,
                audioTracks: [],
                subtitleTracks: []
            };
            video.src = 'data:video/mp4;base64,AAAA';
            window.MovieExtension_PlayerCleaner._test.replacePlayerForTest();
        });
        await page.locator('.native-player-wrapper').waitFor({ state: 'attached' });

        await page.getByTitle('Настройки', { exact: true }).click();
        const qualityItem = page.getByRole('menuitem', { name: /Качество/ });
        assert.match(await qualityItem.innerText(), /Авто · 720p/,
            'the settings entry must name the rendition auto mode is playing');
        await qualityItem.click();
        const options = await page.getByRole('menuitemradio').allInnerTexts();
        assert.ok(options.some(text => /Авто · 720p/.test(text)), `auto entry must show the playing height (${options})`);
        assert.ok(options.some(text => /1080p/.test(text)) && options.some(text => /480p/.test(text)));

        // Before the first fragment there is no playing level: keep the plain label.
        await page.evaluate(() => { testVideo._movieExtensionHls.currentLevel = -1; });
        await page.locator('.player-settings-menu__back').click();
        assert.match(await page.getByRole('menuitem', { name: /Качество/ }).innerText(), /Автоматически/);

        console.log('✅ player quality label tests passed');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
