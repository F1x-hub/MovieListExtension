/**
 * Runs the real cleaner in a real provider frame: a notice that the provider does not
 * serve the viewer's region is reported, and PLAYER_PLAYBACK_STARTED is sent only when
 * the film itself advances, never for a short advert, and afresh after PLAYER_START.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
// The same files, in the same order, as the manifest injects them into provider frames.
const injected = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).content_scripts
    .find(entry => entry.js.includes('content-scripts/player-cleaner.js')).js
    .map(file => fs.readFileSync(path.join(root, file), 'utf8'));

async function openFrame(browser, body) {
    const page = await browser.newPage();
    await page.route('http://host.test/**', route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><body><iframe id="frame" src="http://provider.test/embed/1"></iframe></body>'
    }));
    await page.route('http://provider.test/**', route => route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8"><title></title></head><body>${body}</body></html>`
    }));
    await page.goto('http://host.test/');
    await page.evaluate(() => {
        globalThis.reports = [];
        addEventListener('message', event => {
            if (/^PLAYER_(SOURCE_STATE|PLAYBACK_STARTED)$/.test(event.data?.type)) globalThis.reports.push(event.data);
        });
    });
    const frame = await (await page.$('#frame')).contentFrame();
    await frame.evaluate(() => { globalThis.chrome = { runtime: { getURL: () => 'data:text/javascript,' } }; });
    for (const content of injected) await frame.addScriptTag({ content });
    return { page, frame, reports: () => page.evaluate(() => globalThis.reports) };
}

// A stand-in video: the test sets what the media would report and fires timeupdate.
const fakeVideo = (frame, { duration }) => frame.evaluate(length => {
    const video = document.createElement('video');
    document.body.append(video);
    const state = { time: 0 };
    Object.defineProperty(video, 'duration', { get: () => length });
    Object.defineProperty(video, 'paused', { get: () => false });
    Object.defineProperty(video, 'currentTime', { get: () => state.time, set: value => { state.time = value; } });
    globalThis.tick = seconds => { state.time += seconds; video.dispatchEvent(new Event('timeupdate')); };
}, duration);

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const blocked = await openFrame(browser, '<div class="notice">Видео недоступно в вашем регионе</div>');
        await blocked.page.waitForTimeout(2200);
        const blockedReports = (await blocked.reports()).filter(report => report.reason === 'region-blocked');
        assert.equal(blockedReports.length, 1, 'a region notice is reported once');
        assert.equal(blockedReports[0].state, 'unavailable');
        await blocked.page.close();

        const english = await openFrame(browser, '<p>This video is not available in your country.</p>');
        await english.page.waitForTimeout(2200);
        assert.equal((await english.reports()).filter(report => report.reason === 'region-blocked').length, 1, 'English notice');
        await english.page.close();

        const working = await openFrame(browser, '<div id="player">Сезон 1 · Серия 2 · Озвучка</div>');
        await fakeVideo(working.frame, { duration: 2700 });
        await working.frame.evaluate(() => { tick(0.25); tick(0.5); });
        assert.equal((await working.reports()).filter(report => report.type === 'PLAYER_PLAYBACK_STARTED').length, 0,
            'not before the film has advanced a second');
        await working.frame.evaluate(() => { tick(0.5); tick(0.5); tick(1); });
        await working.page.waitForTimeout(100);
        assert.equal((await working.reports()).filter(report => report.type === 'PLAYER_PLAYBACK_STARTED').length, 1, 'reported once');
        await working.page.evaluate(() => document.getElementById('frame').contentWindow.postMessage({ type: 'PLAYER_START' }, '*'));
        await working.page.waitForTimeout(100);
        await working.frame.evaluate(() => { tick(0.5); tick(1); tick(1); });
        await working.page.waitForTimeout(100);
        assert.equal((await working.reports()).filter(report => report.type === 'PLAYER_PLAYBACK_STARTED').length, 2,
            'a new start is confirmed afresh');
        await working.page.waitForTimeout(1500);
        assert.equal((await working.reports()).filter(report => report.reason === 'region-blocked').length, 0, 'an ordinary player is left alone');
        await working.page.close();

        const advert = await openFrame(browser, '<div id="player"></div>');
        await fakeVideo(advert.frame, { duration: 20 });
        await advert.frame.evaluate(() => { for (let index = 0; index < 10; index++) tick(1); });
        await advert.page.waitForTimeout(100);
        assert.equal((await advert.reports()).filter(report => report.type === 'PLAYER_PLAYBACK_STARTED').length, 0,
            'a short advert is not the film');
        await advert.page.close();

        console.log('Player cleaner playback start: region notices are reported, and only the film advancing confirms a start.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
