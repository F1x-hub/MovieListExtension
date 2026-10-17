const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { launchExtensionContext } = require('./helpers/extensionContext.cjs');
const { startFixtureServer } = require('./helpers/fixtureServer.cjs');

async function main() {
    const sink = await startFixtureServer({ port: 0 });
    const mediaDir = path.join(__dirname, 'fixtures/hls-vp9');
    const assets = new Map(fs.readdirSync(mediaDir).filter(name => /\.(m3u8|mp4|m4s)$/.test(name))
        .map(name => [`/hls/${name}`, fs.readFileSync(path.join(mediaDir, name))]));
    const hits = new Map();
    const source = http.createServer((req, res) => {
        hits.set(req.url, (hits.get(req.url) || 0) + 1);
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.url === '/hls/redirect.m3u8') {
            res.writeHead(302, { Location: `${sink.origin}/health` }); res.end(); return;
        }
        if (['/hls/child.m3u8', '/hls/key.m3u8', '/hls/scope.m3u8'].includes(req.url)) {
            let playlist = assets.get('/hls/index.m3u8').toString();
            if (req.url === '/hls/scope.m3u8') playlist = playlist.replace('URI="init.mp4"', 'URI="/outside/init.mp4"');
            else if (req.url === '/hls/child.m3u8') playlist = playlist.replace('URI="init.mp4"', `URI="${sink.origin}/hls/init.mp4"`)
                .replace(/index\d\.m4s/g, name => `${sink.origin}/hls/${name}`);
            else playlist = playlist.replace('#EXT-X-MAP:', `#EXT-X-KEY:METHOD=AES-128,URI="${sink.origin}/health",IV=0x00000000000000000000000000000001\n#EXT-X-MAP:`)
                .replace('URI="init.mp4"', 'URI="/hls/init.mp4"').replace(/index\d\.m4s/g, name => `/hls/${name}`);
            res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); res.end(playlist); return;
        }
        const asset = assets.get(req.url);
        if (!asset) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': req.url.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
            'Content-Length': asset.length }); res.end(asset);
    });
    let harness;
    try {
        await new Promise((resolve, reject) => { source.once('error', reject); source.listen(0, '127.0.0.1', resolve); });
        const origin = `http://127.0.0.1:${source.address().port}`;
        harness = await launchExtensionContext({ fixtureOrigin: origin, additionalFixtureOrigins: [sink.origin] });
        const page = await harness.context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`chrome-extension://${harness.extensionId}/tests/fixtures/player-menu.html`);
        for (const file of ['src/shared/lib/hls.min.js', ...['UrlPolicy', 'HlsPolicyLoader', 'HlsPlaybackFactory']
            .map(name => `src/shared/services/player/${name}.js`)]) {
            await page.addScriptTag({ url: `chrome-extension://${harness.extensionId}/${file}` });
        }
        // Both servers are reachable through this harness. Zero sink hits below must
        // therefore come from production loader policy, not its offline proxy.
        assert.equal(await page.evaluate(async url => (await fetch(`${url}/health`)).status, sink.origin), 200);
        await page.evaluate(url => {
            window.UrlPolicy = UrlPolicy.create({ localOrigin: url }); // Test-owned origin, never production config.
            window.probes = {};
            window.startProbe = (name, target, networkProfile = 'local') => {
                const video = document.createElement('video'); video.muted = true;
                document.body.appendChild(video);
                const state = window.probes[name] = { fatal: [], retries: 0, destroyed: 0, frames: 0 };
                const frame = () => { state.frames++; video.requestVideoFrameCallback(frame); };
                video.requestVideoFrameCallback(frame);
                state.video = video;
                state.hls = HlsPlaybackFactory.create(video, target, {
                    networkProfile, policy: 'persistent', rememberBandwidth: false, config: { enableWorker: false },
                    localManifestUrl: target,
                    beforeLoad: hls => hls.on(Hls.Events.DESTROYING, () => state.destroyed++),
                    onFatal: ({ reason }) => { state.fatal.push(reason); return true; },
                    onRetryScheduled: () => state.retries++
                });
                video.play().catch(() => {});
            };
            startProbe('positive', `${url}/hls/index.m3u8`);
        }, origin);
        await page.waitForFunction(() => probes.positive.video.currentTime > 0.5 && probes.positive.frames >= 2);
        const sinkBefore = sink.hits('/health');
        const sinkInitBefore = sink.hits('/hls/init.mp4');
        const initialBefore = hits.get('/hls/index.m3u8') || 0;
        await page.evaluate(url => {
            startProbe('remotePrivate', `${url}/hls/index.m3u8`, 'remote');
            startProbe('redirect', `${url}/hls/redirect.m3u8`);
            startProbe('child', `${url}/hls/child.m3u8`);
            startProbe('key', `${url}/hls/key.m3u8`);
            startProbe('scope', `${url}/hls/scope.m3u8`);
        }, origin);
        await page.waitForFunction(() => ['remotePrivate', 'redirect', 'child', 'key', 'scope'].every(name => probes[name].fatal.length === 1));
        // Observe beyond the first factory retry window; persistent policy must
        // never reschedule a policy violation, even when hls.js labels it nonfatal.
        await page.waitForTimeout(1200);
        const result = await page.evaluate(() => Object.fromEntries(Object.entries(probes).map(([name, state]) =>
            [name, { fatal: state.fatal, retries: state.retries, destroyed: state.destroyed, frames: state.frames }])));
        for (const name of ['remotePrivate', 'redirect', 'child', 'key', 'scope']) {
            assert.deepEqual(result[name].fatal, ['policy'], name);
            assert.equal(result[name].retries, 0, name);
            assert.equal(result[name].destroyed, 1, name);
        }
        assert.equal(hits.get('/hls/index.m3u8'), initialBefore, 'remote initial private URL never contacted');
        assert.equal(sink.hits('/health'), sinkBefore, 'redirect/key target never contacted');
        assert.equal(sink.hits('/hls/init.mp4'), sinkInitBefore, 'cross-origin child init never contacted');
        assert.equal(hits.get('/outside/init.mp4') || 0, 0, 'same-origin resources outside session directory never contacted');
        for (const file of ['redirect', 'child', 'key', 'scope']) assert.equal(hits.get(`/hls/${file}.m3u8`), 1,
            'each allowed initial manifest must actually reach the server');
        assert.equal(result.positive.fatal.length, 0, 'legitimate parallel local session remains active');
        assert.ok(result.positive.frames > 2);
        assert.equal(harness.externalResponses(), 0);
        await page.evaluate(() => Object.values(probes).forEach(state => { state.hls?.destroy(); state.video.remove(); }));
        console.log('Controlled HLS Chromium: local frames, simultaneous remote denial, redirect/child/key zero hits, one destroy/fatal and no retry passed.');
    } finally {
        try { await harness?.close(); }
        finally { source.closeAllConnections(); await Promise.all([new Promise(resolve => source.close(resolve)), sink.close()]); }
    }
}
main().catch(error => { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; });
