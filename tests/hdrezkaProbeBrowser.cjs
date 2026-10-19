const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchExtensionContext, extensionIdFromKey } = require('./helpers/extensionContext.cjs');
const { startFixtureServer } = require('./helpers/fixtureServer.cjs');
const root = path.resolve(__dirname, '..');
const liveHar = process.env.HDREZKA_PROBE_HAR;
const pilotRoot = process.env.HDREZKA_PROBE_DIST === '1' ? path.join(root, 'dist') : root;
const base = 'https://weyland.stream.voidboost.one/fixture/session/';
const artifactDir = path.join(root, 'artifacts/hdrezka-probe');

// The live run uses an empty profile and a minimal extension containing the
// real pilot/player files and the manifest's exact CDN permissions. It never
// loads Firebase, the app service worker, user credentials or browser cookies.
async function liveContext() {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mle-hdrezka-'));
    const extension = path.join(temporary, 'extension');
    const manifest = JSON.parse(fs.readFileSync(path.join(pilotRoot, 'manifest.json'), 'utf8'));
    fs.mkdirSync(extension);
    for (const relative of ['src/pages/hdrezka-probe', 'src/shared/styles', 'src/shared/services/ThemeService.js', 'src/shared/components/NumberStepper.js',
        'src/shared/lib/hls.min.js', ...['UrlPolicy', 'HlsPolicyLoader', 'HlsPlaybackFactory', 'HdrezkaProbeSources']
            .map(name => `src/shared/services/player/${name}.js`)]) {
        const destination = path.join(extension, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.cpSync(path.join(pilotRoot, relative), destination, { recursive: true });
    }
    fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({
        manifest_version: 3, name: 'HDRezka playback probe', version: manifest.version, key: manifest.key,
        host_permissions: manifest.host_permissions.filter(host => host.includes('.stream.voidboost.one/')),
        content_security_policy: manifest.content_security_policy
    }));
    let context;
    try {
        context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
            channel: 'chromium', headless: true,
            args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
        });
    } catch (error) { fs.rmSync(temporary, { recursive: true, force: true }); throw error; }
    return { context, extensionId: extensionIdFromKey(manifest.key), close: async () => {
        try { await context.close(); } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    } };
}

async function main() {
    let fixture;
    let harness;
    try {
        if (liveHar) harness = await liveContext();
        else {
            fixture = await startFixtureServer({ port: 0 });
            harness = await launchExtensionContext({ fixtureOrigin: fixture.origin });
        }
        const page = await harness.context.newPage();
        page.setDefaultTimeout(15000);
        let hits = 0;
        let failureMode = null;
        const statuses = new Map();
        page.on('response', response => {
            const address = new URL(response.url());
            if (address.hostname.endsWith('.stream.voidboost.one')) {
                const key = `${address.hostname} ${response.status()}`;
                statuses.set(key, (statuses.get(key) || 0) + 1);
            }
        });
        if (!liveHar) await page.route('https://*.stream.voidboost.one/**', async route => {
            hits += 1;
            const url = new URL(route.request().url());
            if (failureMode === 'expired') return route.fulfill({ status: 403 });
            if (failureMode === 'redirect') return route.fulfill({ status: 302, headers: { location: 'https://offline-probe.invalid/blocked' } });
            const file = url.pathname.endsWith('.m3u8') ? 'index.m3u8' : path.basename(url.pathname);
            const fullPath = path.join(__dirname, 'fixtures/hls-vp9', file);
            assert.ok(fs.existsSync(fullPath), 'only known fixture resources may be loaded');
            return route.fulfill({ status: 200, contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4', body: fs.readFileSync(fullPath) });
        });
        await page.goto(`chrome-extension://${harness.extensionId}/src/pages/hdrezka-probe/hdrezka-probe.html`);
        const importHar = async () => {
            const input = liveHar || { name: 'fixture.har', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ log: { entries: [
                { request: { method: 'GET', url: `${base}index.m3u8` }, response: { status: 200 } }
            ] } })) };
            await page.locator('#harFile').setInputFiles(input);
            await page.waitForFunction(() => !document.getElementById('playButton').disabled);
        };
        await importHar();
        assert.equal(hits, 0, 'import must not trigger any media request');
        const count = await page.locator('#streamSelect option').count();
        assert.ok(count > 0);
        await page.locator('#playButton').click();
        await page.waitForFunction(() => {
            const video = document.querySelector('video');
            return video && video.currentTime > 0.2 && video.videoWidth > 0;
        }, null, { timeout: liveHar ? 45000 : 15000 });
        const initial = await page.locator('video').evaluate(video => ({ width: video.videoWidth, height: video.videoHeight,
            duration: video.duration, time: video.currentTime, decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames }));
        const target = liveHar ? 120 : 3;
        await page.locator('video').evaluate((video, time) => { video.currentTime = time; }, target);
        await page.waitForFunction(time => {
            const video = document.querySelector('video');
            return video && !video.seeking && video.currentTime > time + 0.2 && video.readyState >= 2;
        }, target, { timeout: liveHar ? 30000 : 15000 });
        fs.mkdirSync(artifactDir, { recursive: true });
        for (const theme of ['dark', 'light']) {
            await page.evaluate(value => ThemeService.applyTheme(value, { persist: false, syncChromeStorage: false }), theme);
            await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
            await page.setViewportSize({ width: 1120, height: 1050 });
            await page.screenshot({ path: path.join(artifactDir, `${liveHar ? 'live' : 'fixture'}-${theme}.png`), fullPage: true });
            await page.setViewportSize({ width: 390, height: 844 });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
            await page.screenshot({ path: path.join(artifactDir, `${liveHar ? 'live' : 'fixture'}-${theme}-narrow.png`), fullPage: true });
        }
        await page.locator('#stopButton').click();
        assert.equal(await page.locator('video').count(), 0, 'stop disposes the player');
        if (!liveHar) {
            for (const mode of ['expired', 'redirect']) {
                failureMode = mode;
                await page.locator('#playButton').click();
                await page.waitForFunction(() => /отклонил|отклонён/.test(document.getElementById('probeStatus').textContent));
                await page.locator('#stopButton').click();
            }
            await page.locator('#harFile').setInputFiles({ name: 'invalid.har', mimeType: 'application/json', buffer: Buffer.from('{') });
            await page.waitForFunction(() => document.getElementById('probeStatus').textContent.startsWith('Не удалось прочитать'));
            assert.equal(await page.locator('#playButton').isEnabled(), false);
            await importHar();
        }
        await page.locator('#clearButton').click();
        assert.equal(await page.locator('#playButton').isEnabled(), false);
        assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('voidboost.one'))), false, 'signed URLs must not be persisted');
        const result = { mode: liveHar ? 'live-empty-profile' : 'offline-fixture', build: pilotRoot === root ? 'source' : 'dist', sources: count, initial, seekSeconds: target,
            requests: Object.fromEntries(statuses), themes: ['dark', 'light'], widths: [1120, 390], stopAndClear: true };
        fs.writeFileSync(path.join(artifactDir, `${liveHar ? 'live' : 'fixture'}-result.json`), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
    } finally { await harness?.close(); await fixture?.close(); }
}
main().catch(error => {
    console.error(`HDRezka probe failed: ${error.name}: ${error.message.replace(/https?:\/\/[^\s]+/g, '[redacted-url]')}`);
    process.exitCode = 1;
});
