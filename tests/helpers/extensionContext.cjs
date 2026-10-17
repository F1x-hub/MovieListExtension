const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

function extensionIdFromKey(key) {
    return crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)
        .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + Number.parseInt(digit, 16)));
}

function proxyBypassForFixture(origin) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
        || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('Fixture origin must be an explicit HTTP loopback port with no path or credentials.');
    }
    return `<-loopback>;127.0.0.1:${url.port}`;
}

async function launchExtensionContext({ extensionPath = path.resolve(__dirname, '../..'), fixtureOrigin, additionalFixtureOrigins = [] } = {}) {
    const fixtures = [fixtureOrigin, ...additionalFixtureOrigins];
    const bypass = `<-loopback>;${[...new Set(fixtures.map(origin => proxyBypassForFixture(origin).split(';')[1]))].join(';')}`;
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
    const executablePath = process.env.PW_CHROMIUM_PATH || chromium.executablePath();
    if (!fs.existsSync(executablePath)) throw new Error('Bundled Chromium missing; provide PW_CHROMIUM_PATH or authorize browser installation.');
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mle-player-'));
    let blocked = 0;
    let external = 0;
    const probes = new Map(['offline-probe.invalid', '192.0.2.1', '203.0.113.1', '127.0.0.1'].map(host => [host, 0]));
    const block = (req, socket, connect = false) => {
        blocked += 1;
        try {
            const host = new URL(connect ? `https://${req.url}` : req.url).hostname;
            if (probes.has(host)) probes.set(host, probes.get(host) + 1);
        } catch { /* Retain no arbitrary request URLs. */ }
        socket.destroy();
    };
    let context;
    const sockets = new Set();
    const denyProxy = http.createServer(req => block(req, req.socket));
    denyProxy.on('connection', socket => {
        sockets.add(socket);
        socket.on('error', () => {});
        socket.once('close', () => sockets.delete(socket));
    });
    denyProxy.on('connect', (req, socket) => block(req, socket, true));
    let proxyListening = false;
    let closed = false;
    async function close() {
        if (closed) return;
        closed = true;
        try { await context?.close(); }
        finally {
            for (const socket of sockets) socket.destroy();
            if (proxyListening) await new Promise(resolve => denyProxy.close(resolve));
            fs.rmSync(userDataDir, { recursive: true, maxRetries: 3, retryDelay: 100 });
        }
    }
    try {
        await new Promise((resolve, reject) => {
            denyProxy.once('error', reject);
            denyProxy.listen(0, '127.0.0.1', () => { proxyListening = true; resolve(); });
        });
        const env = { ...process.env };
        for (const key of Object.keys(env)) if (/^(http_proxy|https_proxy|all_proxy|no_proxy)$/i.test(key)) delete env[key];
        context = await chromium.launchPersistentContext(userDataDir, {
            executablePath, channel: 'chromium', headless: true, env,
            args: [
                `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
                `--proxy-server=http://127.0.0.1:${denyProxy.address().port}`,
                `--proxy-bypass-list=${bypass}`,
                '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
                '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-quic'
            ]
        });
        context.on('response', response => {
            try {
                const url = new URL(response.url());
                if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') external += 1;
            } catch { /* Non-network URL. No response data is retained. */ }
        });
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
        const extensionId = new URL(worker.url()).host;
        if (extensionId !== extensionIdFromKey(manifest.key)) throw new Error('Loaded extension ID does not match manifest key.');
        return { context, extensionId, worker, userDataDir,
            blockedProxyRequests: () => blocked, proxyHitsFor: host => probes.get(host) || 0,
            externalResponses: () => external, close };
    } catch (error) {
        await close();
        throw error;
    }
}

module.exports = { extensionIdFromKey, proxyBypassForFixture, launchExtensionContext };
