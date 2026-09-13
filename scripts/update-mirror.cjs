const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const site = 'movielistdb-13208-updates';
const origin = `https://${site}.web.app/updates/latest/`;
const api = 'https://firebasehosting.googleapis.com/v1beta1/';

function compare(a, b) {
    if (![a, b].every(v => /^\d+(?:\.\d+){2,3}$/.test(v))) throw new Error('Invalid stable version');
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < 4; i++) {
        const left = x[i] || 0;
        const right = y[i] || 0;
        if (left !== right) return left > right ? 1 : -1;
    }
    return 0;
}

async function request(url, options = {}) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Mirror request failed: HTTP ${response.status}`);
    return response;
}

async function main(mode) {
    const metadata = JSON.parse(fs.readFileSync('update.json', 'utf8'));
    if (mode === 'prepare') {
        if (`v${metadata.version}` !== process.env.GITHUB_REF_NAME) throw new Error('Tag/version mismatch');
        const response = await fetch(origin + 'update.json', { signal: AbortSignal.timeout(30000), cache: 'no-store' });
        if (response.status !== 404) {
            if (!response.ok) throw new Error(`Cannot establish deployed version: ${response.status}`);
            const current = await response.json();
            if (compare(metadata.version, current.version) < 0) throw new Error('Refusing to replace a newer mirror');
            if (metadata.version === current.version && metadata.sha256 !== current.sha256) throw new Error('Same version has different content');
        }
        const bytes = fs.readFileSync(metadata.assetName);
        if (bytes.length !== metadata.size || crypto.createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) throw new Error('ZIP integrity mismatch');
        const output = path.resolve('.update-mirror/updates/latest');
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.resolve('.update-mirror/index.html'), '<!doctype html><meta charset="utf-8"><title>MovieList update mirror</title><h1>MovieList Extension update mirror</h1><p>Latest signed update files are available under <code>/updates/latest/</code>.</p>\n');
        for (const [source, target] of [[metadata.assetName, 'MovieList-extension-latest.zip'], ['update.json', 'update.json'], ['update.json.sig', 'update.json.sig']]) {
            fs.copyFileSync(source, path.join(output, target));
        }
    } else if (mode === 'verify-cleanup') {
        const deployed = await (await request(origin + 'update.json')).text();
        if (deployed !== fs.readFileSync('update.json', 'utf8')) throw new Error('Published metadata differs');
        const zip = Buffer.from(await (await request(origin + 'MovieList-extension-latest.zip')).arrayBuffer());
        if (crypto.createHash('sha256').update(zip).digest('hex') !== metadata.sha256) throw new Error('Published ZIP differs');
        for (const file of ['update.json.sig']) {
            const bytes = Buffer.from(await (await request(origin + file)).arrayBuffer());
            if (!bytes.equals(fs.readFileSync(file))) throw new Error(`Published ${file} differs`);
        }
        if (!process.env.GOOGLE_ACCESS_TOKEN) throw new Error('Missing Hosting access token');
        const headers = { Authorization: `Bearer ${process.env.GOOGLE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
        const channelUrl = api + `sites/${site}/channels/live`;
        const channel = await (await request(channelUrl, { headers })).json();
        const active = channel.release?.version?.name;
        if (!active) throw new Error('Cannot identify active Hosting version');
        await request(channelUrl + '?updateMask=retainedReleaseCount', { method: 'PATCH', headers, body: JSON.stringify({ retainedReleaseCount: 1 }) });
        const versions = [];
        let pageToken = '';
        do {
            const page = await (await request(api + `sites/${site}/versions?pageSize=100&pageToken=${encodeURIComponent(pageToken)}`, { headers })).json();
            versions.push(...(page.versions || []));
            pageToken = page.nextPageToken || '';
        } while (pageToken);
        for (const version of versions) {
            if (version.name === active || version.status !== 'FINALIZED') continue;
            if (!version.name.startsWith(`sites/${site}/versions/`)) throw new Error('Unexpected Hosting version scope');
            const fresh = await (await request(channelUrl, { headers })).json();
            if (fresh.release?.version?.name !== active) throw new Error('Hosting changed during cleanup');
            await request(api + version.name, { method: 'DELETE', headers });
        }
    } else throw new Error('Unknown mirror operation');
}
module.exports = { compare, main };
if (require.main === module) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
