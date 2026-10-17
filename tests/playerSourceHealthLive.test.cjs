const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./fixtures/provider-health/kodik.json');
const { probe, main } = require('../scripts/player-source-health-live.cjs');

(async () => {
    let requests = [];
    const transport = async (url, options) => {
        requests.push(url);
        assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit');
        const route = fixture.routes[url]; assert.ok(route, 'no network fallback');
        const body = route.asset ? fs.readFileSync(path.join(__dirname, 'fixtures/hls-vp9', route.asset))
            : typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
        return new Response(body, { status: 200 });
    };
    const ref = { id: 'reference-1', embedUrl: fixture.embedUrl };
    const report = await probe(ref, { fetchImpl: transport });
    assert.equal(report.status, 'available'); assert.equal(requests.length, 5);
    assert.ok(!JSON.stringify(report).includes('https:'));
    requests = [];
    for (const embedUrl of ['http://kodikplayer.com/video/1', 'https://seasonvar.ru/', 'https://127.0.0.1/', 'https://user@kodikplayer.com/']) {
        assert.equal((await probe({ ...ref, embedUrl }, { fetchImpl: transport })).status, 'network_or_access_unconfirmed');
    }
    assert.equal(requests.length, 0);
    assert.equal((await probe(ref, { fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://127.0.0.1/' } }) })).status, 'network_or_access_unconfirmed');
    assert.equal((await probe(ref, { fetchImpl: async () => { throw Error('secret signed-url'); } })).status, 'network_or_access_unconfirmed');
    assert.equal((await probe(ref, { fetchImpl: async () => new Response('too big', { headers: { 'content-length': '99999999' } }) })).status, 'network_or_access_unconfirmed');
    assert.deepEqual(await main([]), { mode: 'live-disabled', monitoringEnabled: false, results: [] });
    console.log('Live health runner fixture-only transport, bounds, redirects, host denial and redaction passed; no live requests performed');
})().catch(() => { console.error('live_health_test_failed'); process.exitCode = 1; });
