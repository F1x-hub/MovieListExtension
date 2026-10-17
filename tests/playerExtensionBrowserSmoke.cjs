const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
assert.ok(fs.existsSync(path.join(__dirname, 'helpers/extensionContext.cjs')),
    'T0 requires a reusable extension context with local-only network controls');
assert.ok(fs.existsSync(path.join(__dirname, 'helpers/fixtureServer.cjs')),
    'T0 requires a loopback media fixture server');

const { launchExtensionContext } = require('./helpers/extensionContext.cjs');
const { startFixtureServer } = require('./helpers/fixtureServer.cjs');

async function main() {
    const server = await startFixtureServer({ port: Number(process.env.PLAYER_FIXTURE_PORT || 3000) });
    let harness;
    let deniedServer;
    try {
        deniedServer = await startFixtureServer({ port: 0 });
        assert.equal((await fetch(`${deniedServer.origin}/health`)).status, 200,
            'positive control: the other test-owned local endpoint is reachable from Node');
        const deniedHits = deniedServer.hits('/health');
        harness = await launchExtensionContext({ extensionPath: root, fixtureOrigin: server.origin });
        const page = await harness.context.newPage();
        await page.goto(`chrome-extension://${harness.extensionId}/src/popup/popup.html`);
        assert.equal(await page.evaluate(() => chrome.runtime.id), harness.extensionId);
        assert.equal(harness.extensionId, 'dgdejomdgiabgcfijcdhjefijdfiemhd');
        await page.addScriptTag({ url: `chrome-extension://${harness.extensionId}/src/shared/lib/hls.min.js` });
        for (const file of ['UrlPolicy', 'HlsPolicyLoader']) {
            await page.addScriptTag({ url: `chrome-extension://${harness.extensionId}/src/shared/services/player/${file}.js` });
        }
        await page.addScriptTag({ url: `chrome-extension://${harness.extensionId}/src/shared/services/player/HlsPlaybackFactory.js` });
        const health = await page.evaluate(async url => (await fetch(`${url}/health`)).json(), server.origin);
        assert.equal(health.ok, true, 'positive control: local fixture is reachable');
        await page.evaluate(url => {
            window.UrlPolicy = UrlPolicy.create({ localOrigin: url }); // Test-owned random port only.
            document.body.replaceChildren();
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.controls = true;
            document.body.append(video);
            window.smokeFrames = 0;
            const frame = () => { window.smokeFrames += 1; video.requestVideoFrameCallback(frame); };
            if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(frame);
            window.smokeHls = HlsPlaybackFactory.create(video, `${url}/hls/index.m3u8`, {
                policy: 'persistent', networkProfile: 'local', rememberBandwidth: false,
                localManifestUrl: `${url}/hls/index.m3u8`,
                config: { enableWorker: false },
                onFatal: () => { window.smokeFatal = true; }
            });
            if (!window.smokeHls) throw new Error('HLS/MSE unavailable in test Chromium');
            window.smokePlay = video.play().catch(() => { window.smokePlayRejected = true; });
        }, server.origin);
        await page.waitForFunction(() => {
            const video = document.querySelector('video');
            return video?.currentTime > 1 && video.readyState >= 2 && window.smokeFrames >= 2;
        }, null, { timeout: 20000 });
        assert.equal(await page.evaluate(() => Boolean(window.smokeFatal)), false);
        assert.ok(server.hits('/hls/index.m3u8') > 0);
        assert.ok(server.hits('/hls/init.mp4') > 0);
        for (const target of [page, harness.worker]) {
            for (const address of ['https://offline-probe.invalid/', 'http://192.0.2.1/', 'https://203.0.113.1/']) {
                const host = new URL(address).hostname;
                const before = harness.proxyHitsFor(host);
                const blocked = await target.evaluate(async url => {
                    try { await fetch(url, { signal: AbortSignal.timeout(5000) }); return false; }
                    catch { return true; }
                }, address);
                assert.equal(blocked, true, 'external probe must fail, including IP literals');
                assert.ok(harness.proxyHitsFor(host) > before, 'each page/SW probe must reach the deny proxy');
            }
        }
        assert.ok(harness.blockedProxyRequests() > 0, 'deny proxy must observe a blocked request');
        const beforeLocal = harness.proxyHitsFor('127.0.0.1');
        assert.equal(await page.evaluate(async url => {
            try { await fetch(url, { signal: AbortSignal.timeout(5000) }); return false; }
            catch { return true; }
        }, `${deniedServer.origin}/health`), true, 'other loopback ports must use the deny proxy');
        assert.ok(harness.proxyHitsFor('127.0.0.1') > beforeLocal);
        assert.equal(deniedServer.hits('/health'), deniedHits, 'browser must not reach the denied local endpoint');
        assert.equal(harness.externalResponses(), 0, 'no observed external page/SW response may succeed');
        await page.evaluate(() => { window.smokeHls.destroy(); document.querySelector('video').remove(); });
        console.log('Player extension Chromium: stable ID, live service worker, HLS frames, loopback and blocked external probes passed.');
        console.log('Scope: offline harness verified; provider playback and A5 product network policy are not tested.');
    } finally {
        try { await harness?.close(); }
        finally { await Promise.all([server.close(), deniedServer?.close()]); }
    }
    assert.equal(fs.existsSync(harness.userDataDir), false, 'temporary browser profile must be removed');
}

main().catch(error => {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
});
