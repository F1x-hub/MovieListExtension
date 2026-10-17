const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

async function startFixtureServer({ port = 3000, fixtureDir = path.resolve(__dirname, '../fixtures/hls-vp9') } = {}) {
    const files = new Map();
    for (const entry of fs.readdirSync(fixtureDir, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(m3u8|mp4|m4s)$/.test(entry.name)) continue;
        files.set(`/hls/${entry.name}`, fs.readFileSync(path.join(fixtureDir, entry.name)));
    }
    const requests = new Map();
    const server = http.createServer((req, res) => {
        const route = new URL(req.url, 'http://127.0.0.1').pathname;
        requests.set(route, (requests.get(route) || 0) + 1);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
        const body = route === '/health' ? Buffer.from('{"ok":true}') : files.get(route);
        if (!body) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', route === '/health' ? 'application/json'
            : route.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        let start = 0;
        let end = body.length - 1;
        let status = 200;
        if (req.headers.range) {
            const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
            start = match ? Number(match[1]) : NaN;
            end = match?.[2] ? Math.min(Number(match[2]), end) : end;
            if (!Number.isSafeInteger(start) || start > end || start >= body.length) {
                res.writeHead(416, { 'Content-Range': `bytes */${body.length}` }); res.end(); return;
            }
            status = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`);
        }
        res.setHeader('Content-Length', end - start + 1);
        res.writeHead(status);
        res.end(req.method === 'HEAD' ? undefined : body.subarray(start, end + 1));
    });
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
        });
    } catch (error) {
        if (error.code === 'EADDRINUSE') throw new Error(`Fixture port ${port} is occupied; stop without touching its owner.`);
        throw error;
    }
    return {
        origin: `http://127.0.0.1:${server.address().port}`,
        hits: route => requests.get(route) || 0,
        close: () => new Promise((resolve, reject) => {
            server.closeAllConnections();
            server.close(error => error ? reject(error) : resolve());
        })
    };
}

module.exports = { startFixtureServer };
