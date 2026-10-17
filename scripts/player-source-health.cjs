const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_FIXTURE = path.join(ROOT, 'tests/fixtures/provider-health/kodik.json');

function classify({ fixture = false, resolved = false, manifestVerified = false, transportFailed = false } = {}) {
    if (resolved && manifestVerified && !transportFailed) return 'available';
    return fixture && !transportFailed ? 'parse_regression' : 'network_or_access_unconfirmed';
}

function productionResolver(fetch) {
    const context = vm.createContext({ URL, URLSearchParams, Buffer, atob, module: { exports: {} }, fetch });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/shared/services/player/UrlPolicy.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/shared/services/parsers/KodikStreamResolver.js'), 'utf8'), context);
    return { resolver: new context.module.exports.KodikStreamResolver({ fetch }), policy: context.UrlPolicy };
}

async function runFixture(fixture, { timeoutMs = 2000 } = {}) {
    // Only the exact in-memory route map is reachable. No network fallback exists.
    const routes = fixture?.routes;
    let transportFailed = false;
    let timer;
    const fetch = async (url, options = {}) => {
        const route = routes && Object.hasOwn(routes, url) ? routes[url] : null;
        if (!route || route.networkError) { transportFailed = true; throw new Error('fixture_transport'); }
        if (route.method && route.method !== (options.method || 'GET')) throw new Error('fixture_contract');
        const status = route.status || 200;
        if (status >= 400) transportFailed = true;
        const asset = ['index.m3u8', 'init.mp4', 'index0.m4s', 'index1.m4s', 'index2.m4s'].includes(route.asset)
            ? fs.readFileSync(path.join(ROOT, 'tests/fixtures/hls-vp9', route.asset)) : null;
        return { ok: status >= 200 && status < 300, status,
            text: async () => asset ? asset.toString('utf8') : typeof route.body === 'string' ? route.body : JSON.stringify(route.body),
            bytes: async () => asset || Buffer.from(typeof route.body === 'string' ? route.body : ''),
            json: async () => typeof route.body === 'object' ? route.body : JSON.parse(route.body) };
    };
    let resolved = false;
    let manifestVerified = false;
    try {
        await Promise.race([
            (async () => {
                const { resolver, policy } = productionResolver(fetch);
                const streams = await resolver.resolve(fixture?.embedUrl);
                resolved = streams.length > 0;
                if (!resolved) return;
                const response = await fetch(streams[0].url);
                const manifest = await response.text();
                // Scope is resolver + playlist/container structure, not decoding/TTFF.
                const lines = manifest.trim().split(/\r?\n/).map(line => line.trim());
                const mediaUris = lines.filter(line => line && !line.startsWith('#'));
                manifestVerified = response.ok && lines[0] === '#EXTM3U'
                    && lines.some(line => /^#EXTINF:\d/.test(line))
                    && lines.includes('#EXT-X-ENDLIST') && mediaUris.length > 0;
                if (!manifestVerified) return;
                const init = lines.find(line => line.startsWith('#EXT-X-MAP:'))?.match(/URI="([^"]+)"/)?.[1];
                if (!init) { manifestVerified = false; return; }
                const resources = [{ uri: init, kind: 'init' }, ...mediaUris.map(uri => ({ uri, kind: 'fragment' }))];
                for (const { uri, kind } of resources) {
                    const url = new URL(uri, streams[0].url).href;
                    if (!policy.check(url, { kind, profile: 'remote' }).ok) { manifestVerified = false; return; }
                    const mediaResponse = await fetch(url);
                    const bytes = await mediaResponse.bytes();
                    const signature = bytes.toString('latin1');
                    if (!mediaResponse.ok || !(kind === 'init' ? signature.includes('ftyp') && signature.includes('moov')
                        : signature.includes('moof') && signature.includes('mdat'))) { manifestVerified = false; return; }
                }
            })(),
            new Promise((_, reject) => { timer = setTimeout(() => { transportFailed = true; reject(new Error('timeout')); }, Math.max(1, Math.min(10000, timeoutMs))); })
        ]);
    } catch { /* Only fixed classifications are exported, never original errors. */ }
    finally { clearTimeout(timer); }
    return {
        providerId: 'kodik', referenceId: 'fixture-kodik-1', mode: 'offline',
        scope: 'resolver-playlist-media-containers',
        status: classify({ fixture: true, resolved, manifestVerified, transportFailed })
    };
}

async function main(args = process.argv.slice(2)) {
    if (args.includes('--live')) {
        // No live reference corpus, scheduler, or external writes are configured.
        return { mode: 'live-disabled', monitoringEnabled: false, results: [] };
    }
    const fixture = JSON.parse(fs.readFileSync(DEFAULT_FIXTURE, 'utf8'));
    // Serial execution is deliberately the default low-concurrency policy.
    return { mode: 'offline', monitoringEnabled: false, results: [await runFixture(fixture)] };
}

if (require.main === module) main().then(report => {
    console.log(JSON.stringify(report, null, 2));
    if (report.results.some(row => row.status === 'parse_regression')) process.exitCode = 1;
}).catch(() => { console.error('player_source_health_failed'); process.exitCode = 1; });

module.exports = { classify, runFixture, main, productionResolver };
