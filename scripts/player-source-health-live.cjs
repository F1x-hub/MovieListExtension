const fs = require('node:fs');
const { productionResolver } = require('./player-source-health.cjs');

// This separate entry point never runs from the fixture suite or workflow.
async function probe(reference, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
    const report = { providerId: 'kodik', referenceId: 'invalid', mode: 'live',
        scope: 'resolver-playlist-media-containers', status: 'network_or_access_unconfirmed' };
    if (!reference || !/^[a-z0-9_-]{1,48}$/.test(reference.id || '')) return report;
    report.referenceId = reference.id;
    let embed;
    try {
        embed = new URL(reference.embedUrl);
        if (embed.protocol !== 'https:' || embed.hostname !== 'kodikplayer.com'
            || embed.port || embed.username || embed.password || embed.hash) return report;
    } catch { return report; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(15000, timeoutMs)));
    let requests = 0, total = 0;
    const request = async (value, options = {}) => {
        const url = new URL(value);
        const resolverRequest = url.origin === embed.origin && (url.href === embed.href || url.pathname === '/ftor');
        const cdnRequest = (url.hostname === 'solodcdn.com' || url.hostname.endsWith('.solodcdn.com'))
            && policy.check(url.href, { kind: 'fragment', profile: 'remote' }).ok;
        if ((!resolverRequest && !cdnRequest) || url.protocol !== 'https:' || url.username || url.password
            || url.port || ++requests > 12 || controller.signal.aborted) throw Error('probe_denied');
        const response = await fetchImpl(url.href, { ...options, credentials: 'omit', referrerPolicy: 'no-referrer',
            redirect: 'manual', signal: controller.signal });
        if (!response.ok || response.redirected || (response.url && response.url !== url.href)) {
            await response.body?.cancel(); throw Error('probe_unavailable');
        }
        if (Number(response.headers?.get('content-length')) > 2 * 1024 * 1024) {
            await response.body?.cancel(); throw Error('probe_size');
        }
        const reader = response.body?.getReader();
        if (!reader) throw Error('probe_body');
        const chunks = []; let size = 0;
        try {
            while (true) {
                const { done, value: chunk } = await reader.read();
                if (done) break;
                size += chunk.byteLength; total += chunk.byteLength;
                if (size > 2 * 1024 * 1024 || total > 8 * 1024 * 1024 || controller.signal.aborted) throw Error('probe_size');
                chunks.push(Buffer.from(chunk));
            }
        } finally { await reader.cancel().catch(() => {}); }
        const bytes = Buffer.concat(chunks);
        return { ok: true, status: response.status, bytes: async () => bytes,
            text: async () => bytes.toString('utf8'), json: async () => JSON.parse(bytes.toString('utf8')) };
    };
    const { resolver, policy } = productionResolver(request);
    try {
        const sources = await resolver.resolve(embed.href);
        if (!sources.length || !policy.check(sources[0].url, { kind: 'manifest', profile: 'remote' }).ok) return report;
        const manifest = await (await request(sources[0].url)).text();
        const lines = manifest.trim().split(/\r?\n/).map(line => line.trim());
        const init = lines.find(line => line.startsWith('#EXT-X-MAP:'))?.match(/URI="([^"]+)"/)?.[1];
        const segment = lines.find(line => line && !line.startsWith('#'));
        // A master playlist or unsupported container is unknown, not parse regression.
        if (lines[0] !== '#EXTM3U' || !lines.some(line => /^#EXTINF:\d/.test(line)) || !init || !segment) return report;
        for (const [uri, signatures] of [[init, ['ftyp', 'moov']], [segment, ['moof', 'mdat']]]) {
            const bytes = await (await request(new URL(uri, sources[0].url).href)).bytes();
            if (!signatures.every(signature => bytes.includes(Buffer.from(signature)))) return report;
        }
        report.status = 'available';
    } catch { /* No exception, response, URL, title or signature is exported. */ }
    finally { clearTimeout(timer); controller.abort(); }
    return report;
}

async function main(args = process.argv.slice(2), options) {
    const index = args.indexOf('--references');
    if (!args.includes('--live') || index < 0 || !args[index + 1]) {
        return { mode: 'live-disabled', monitoringEnabled: false, results: [] };
    }
    const rows = JSON.parse(fs.readFileSync(args[index + 1], 'utf8'));
    if (!Array.isArray(rows) || rows.length > 10) throw Error('invalid_references');
    const results = [];
    for (const row of rows) results.push(await probe(row, options));
    return { mode: 'live', monitoringEnabled: false, results };
}
if (require.main === module) main().then(value => console.log(JSON.stringify(value, null, 2)))
    .catch(() => { console.error('player_live_health_failed'); process.exitCode = 1; });
module.exports = { probe, main };
