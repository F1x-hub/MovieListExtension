const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { launchExtensionContext } = require('./helpers/extensionContext.cjs');
const { startFixtureServer } = require('./helpers/fixtureServer.cjs');

// Browser-model experiment, not a production UrlPolicy implementation.
async function main() {
    const sink = await startFixtureServer({ port: 0 });
    const source = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.url === '/redirect') {
            res.writeHead(302, { Location: `${sink.origin}/health` }); res.end();
        } else if (req.url === '/frame-probe') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<script>fetch('${sink.origin}/health').then(r=>r.json()).then(()=>parent.postMessage({type:'fixture-frame',ok:true},'*')).catch(()=>parent.postMessage({type:'fixture-frame',ok:false},'*'));</script>`);
        } else if (req.url === '/remote.m3u8') {
            const manifest = fs.readFileSync(path.join(__dirname, 'fixtures/hls-vp9/index.m3u8'), 'utf8')
                .replace('URI="init.mp4"', `URI="${sink.origin}/hls/init.mp4"`)
                .replace(/index\d\.m4s/g, file => `${sink.origin}/hls/${file}`);
            res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); res.end(manifest);
        } else { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('source-positive-control'); }
    });
    let harness;
    try {
        await new Promise((resolve, reject) => { source.once('error', reject); source.listen(0, '127.0.0.1', resolve); });
        const origin = `http://127.0.0.1:${source.address().port}`;
        harness = await launchExtensionContext({ fixtureOrigin: origin, additionalFixtureOrigins: [sink.origin] });
        const page = await harness.context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`chrome-extension://${harness.extensionId}/tests/fixtures/player-menu.html`);
        const tabId = await page.evaluate(async () => (await chrome.tabs.getCurrent()).id);
        const ids = [890001, 890002];
        const condition = {
            initiatorDomains: [harness.extensionId], resourceTypes: ['xmlhttprequest', 'media', 'other'],
            regexFilter: `^http://127\\.0\\.0\\.1:${new URL(sink.origin).port}/`
        };
        const rules = (allow, scoped = false) => [{ id: ids[0], priority: 1000, action: { type: 'block' }, condition },
            ...(allow ? [{ id: ids[1], priority: 1001, action: { type: 'allow' },
                condition: { ...condition, ...(scoped ? { tabIds: [tabId] } : {}) } }] : [])];
        const setRules = addRules => harness.worker.evaluate(({ ids, addRules }) =>
            chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids, addRules }), { ids, addRules });
        const probe = redirect => page.evaluate(async ({ url, redirect }) => {
            try { const response = await fetch(`${url}/redirect`, { redirect, signal: AbortSignal.timeout(5000) });
                return { ok: response.ok, finalIsSink: response.url.endsWith('/health') }; }
            catch { return { ok: false }; }
        }, { url: origin, redirect });
        assert.equal(await page.evaluate(async url => (await fetch(url)).text(), origin), 'source-positive-control');
        await setRules(rules(false));
        let before = sink.hits('/health');
        assert.equal((await probe('follow')).ok, false);
        assert.equal(sink.hits('/health'), before, 'block-only control: sink receives no redirected request');
        const frameProbe = sandbox => page.evaluate(({ url, sandbox }) => new Promise((resolve, reject) => {
            const frame = document.createElement('iframe');
            const timer = setTimeout(() => { cleanup(); reject(new Error('Controlled frame probe timed out')); }, 5000);
            const listener = event => {
                if (event.source !== frame.contentWindow || event.data?.type !== 'fixture-frame') return;
                const result = { ok: event.data.ok, origin: event.origin };
                cleanup(); resolve(result);
            };
            const cleanup = () => { clearTimeout(timer); removeEventListener('message', listener); frame.remove(); };
            addEventListener('message', listener);
            frame.setAttribute('sandbox', sandbox);
            frame.src = `${url}/frame-probe`;
            document.body.appendChild(frame);
        }), { url: origin, sandbox });
        before = sink.hits('/health');
        const providerFrame = await frameProbe('allow-scripts allow-same-origin allow-forms allow-presentation');
        assert.equal(providerFrame.ok, true, 'provider initiator is outside extension-only rule even while block-only is active');
        assert.equal(providerFrame.origin, origin, 'allow-same-origin preserves the bridge origin');
        assert.ok(sink.hits('/health') > before);
        const opaqueFrame = await frameProbe('allow-scripts');
        assert.equal(opaqueFrame.origin, 'null', 'without allow-same-origin the message origin is opaque');
        await setRules(rules(true));
        before = sink.hits('/health');
        assert.equal((await probe('follow')).ok, true);
        assert.ok(sink.hits('/health') > before, 'global allow permits source redirect to local sink');
        before = sink.hits('/health');
        assert.equal((await probe('error')).ok, false);
        assert.equal(sink.hits('/health'), before, 'redirect:error rejects before contacting sink');
        await setRules(rules(true, true));
        before = sink.hits('/health');
        assert.equal((await probe('follow')).ok, true);
        assert.ok(sink.hits('/health') > before, 'same-tab allow does not isolate remote from local loading');

        await page.addScriptTag({ url: `chrome-extension://${harness.extensionId}/src/shared/lib/hls.min.js` });
        const beforeKey = sink.hits('/hls/init.mp4');
        await page.evaluate(url => {
            const video = document.querySelector('video');
            video.muted = true;
            // Deliberately uncontrolled baseline: production factory now has a policy loader.
            window.probeHls = new Hls({ enableWorker: false });
            window.probeHls.loadSource(`${url}/remote.m3u8`);
            window.probeHls.attachMedia(video);
            video.play().catch(() => {});
        }, origin);
        await page.waitForFunction(() => document.querySelector('video').currentTime > 0.5);
        assert.ok(sink.hits('/hls/init.mp4') > beforeKey, 'HLS child resources can cross into a broadly allowed local sink');
        const nativeHls = await page.evaluate(() => {
            window.probeHls.destroy();
            return document.createElement('video').canPlayType('application/vnd.apple.mpegurl');
        });
        await setRules([]);
        assert.equal(harness.externalResponses(), 0);
        console.log(JSON.stringify({
            controls: 'local source and sink; synthetic media only; real backend untouched',
            blockOnlyStopsRedirect: true, globalAllowPermitsRedirect: true,
            sameTabAllowPermitsRedirect: true, fetchRedirectErrorStopsContact: true,
            hlsChildReachesAllowedSink: true, nativeHlsCapability: nativeHls || 'unsupported',
            providerInitiatorOutsideExtRule: true, sandboxMessageOriginPreserved: true, opaqueMessageOrigin: 'null',
            limits: 'No production UrlPolicy; no public-DNS/TLS/provider/MP4/track/session-race claim'
        }, null, 2));
    } finally {
        try { await harness?.close(); }
        finally {
            source.closeAllConnections();
            await Promise.all([new Promise(resolve => source.close(resolve)), sink.close()]);
        }
    }
}
main().catch(error => { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; });
