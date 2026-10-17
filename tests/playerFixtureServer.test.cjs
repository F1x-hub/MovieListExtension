const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startFixtureServer } = require('./helpers/fixtureServer.cjs');
const { extensionIdFromKey, proxyBypassForFixture } = require('./helpers/extensionContext.cjs');

async function main() {
    const root = path.resolve(__dirname, '..');
    const fixtureDir = path.join(__dirname, 'fixtures/hls-vp9');
    for (const line of fs.readFileSync(path.join(fixtureDir, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/)) {
        const [hash, size, filename] = line.split(/\s+/);
        const bytes = fs.readFileSync(path.join(fixtureDir, filename));
        assert.equal(bytes.length, Number(size), `fixture size: ${filename}`);
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), hash, `fixture hash: ${filename}`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    assert.equal(extensionIdFromKey(manifest.key), 'dgdejomdgiabgcfijcdhjefijdfiemhd');
    assert.equal(proxyBypassForFixture('http://127.0.0.1:54321'), '<-loopback>;127.0.0.1:54321',
        'remove implicit loopback/link-local bypass and allow only the exact fixture port');
    for (const value of ['http://localhost:3000', 'http://169.254.1.1:3000',
        'http://[fe80::1]:3000', 'http://127.0.0.1:3000/private', 'http://user@127.0.0.1:3000']) {
        assert.throws(() => proxyBypassForFixture(value), /explicit HTTP loopback port/);
    }
    const server = await startFixtureServer({ port: 0 });
    try {
        const health = await fetch(`${server.origin}/health`);
        assert.equal(health.headers.get('access-control-allow-origin'), '*');
        assert.deepEqual(await health.json(), { ok: true });
        const body = fs.readFileSync(path.join(__dirname, 'fixtures/hls-vp9/init.mp4'));
        const partial = await fetch(`${server.origin}/hls/init.mp4`, { headers: { Range: 'bytes=8-15' } });
        assert.equal(partial.status, 206);
        assert.equal(partial.headers.get('content-range'), `bytes 8-15/${body.length}`);
        assert.deepEqual(Buffer.from(await partial.arrayBuffer()), body.subarray(8, 16));
        const head = await fetch(`${server.origin}/hls/init.mp4`, { method: 'HEAD' });
        assert.equal(head.headers.get('content-length'), String(body.length));
        assert.equal((await head.arrayBuffer()).byteLength, 0);
        assert.equal((await fetch(`${server.origin}/hls/init.mp4`, { headers: { Range: 'bytes=999999-' } })).status, 416);
        assert.equal((await fetch(`${server.origin}/hls/%2e%2e/package.json`)).status, 404);
        assert.equal((await fetch(`${server.origin}/health`, { method: 'POST' })).status, 405);
        assert.equal(server.hits('/health'), 2);
        await assert.rejects(startFixtureServer({ port: Number(new URL(server.origin).port) }), /occupied/);
        assert.equal((await fetch(`${server.origin}/health`)).status, 200, 'port collision must preserve its existing owner');
    } finally { await server.close(); }
    await assert.rejects(fetch(`${server.origin}/health`, { signal: AbortSignal.timeout(1000) }));
    console.log('Player fixture server: key-derived ID, loopback, range/HEAD, traversal/method rejection, port ownership and cleanup passed.');
}

main().catch(error => { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; });
