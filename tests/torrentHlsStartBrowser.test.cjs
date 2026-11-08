/**
 * A torrent that is still downloading is a growing EVENT playlist without
 * #EXT-X-ENDLIST, which hls.js treats as live: by default it starts at the
 * live edge, i.e. where MediaPlayer has prepared the film up to, not at the
 * start. The torrent player asks for the start explicitly (`startPosition: 0`)
 * and a network retry before the first frame keeps that start.
 *
 * Real hls.js in Chromium against a loopback server; the synthetic VP9
 * segments of tests/fixtures/hls-vp9 are repeated with discontinuities to make
 * a 30-second film.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const media = path.join(__dirname, 'fixtures/hls-vp9');
const SEGMENTS = ['index0.m4s', 'index1.m4s', 'index2.m4s'];
const REPEATS = 5;

function eventPlaylist() {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:2', '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:EVENT', '#EXT-X-MAP:URI="init.mp4"'];
    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
        if (repeat) lines.push('#EXT-X-DISCONTINUITY', '#EXT-X-MAP:URI="init.mp4"');
        SEGMENTS.forEach(name => lines.push('#EXTINF:2.000000,', `${name}?r=${repeat}`));
    }
    // No #EXT-X-ENDLIST: MediaPlayer is still preparing the rest of the film.
    return `${lines.join('\n')}\n`;
}

(async () => {
    const state = { failFirstSegment: false, failed: 0 };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://fixture');
        if (url.pathname === '/page.html') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<!doctype html><meta charset="utf-8"><body></body>');
            return;
        }
        if (url.pathname === '/api/playback/sessions/s1/index.m3u8') {
            res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
            res.end(eventPlaylist());
            return;
        }
        const name = path.basename(url.pathname);
        if (url.pathname.startsWith('/api/playback/sessions/s1/') && (name === 'init.mp4' || SEGMENTS.includes(name))) {
            if (state.failFirstSegment && name !== 'init.mp4' && state.failed === 0) {
                // MediaPlayer answers 5xx while a piece is not converted yet.
                state.failed += 1;
                res.writeHead(503);
                res.end();
                return;
            }
            const body = fs.readFileSync(path.join(media, name));
            res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': body.length });
            res.end(body);
            return;
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const manifest = `${origin}/api/playback/sessions/s1/index.m3u8`;
    const browser = await chromium.launch();

    async function startAt(config, { failFirstSegment = false } = {}) {
        state.failFirstSegment = failFirstSegment;
        state.failed = 0;
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${origin}/page.html`);
        for (const file of ['src/shared/lib/hls.min.js', ...['UrlPolicy', 'HlsPolicyLoader', 'HlsPlaybackFactory']
            .map(name => `src/shared/services/player/${name}.js`)]) {
            await page.addScriptTag({ path: path.join(root, file) });
        }
        await page.evaluate(({ origin: localOrigin, url, config: extra }) => {
            window.UrlPolicy = UrlPolicy.create({ localOrigin }); // Test-owned origin.
            const video = document.createElement('video');
            video.muted = true;
            document.body.appendChild(video);
            window.probe = { video, retries: 0, live: null };
            window.probe.hls = HlsPlaybackFactory.create(video, url, {
                policy: 'persistent', networkProfile: 'local', localManifestUrl: url, attachFirst: true,
                rememberBandwidth: false, retryBaseDelayMs: 50,
                config: { enableWorker: false, ...(extra || {}) },
                beforeLoad: hls => hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => { window.probe.live = data.details.live; }),
                onRetryScheduled: () => { window.probe.retries += 1; }
            });
        }, { origin, url: manifest, config });
        await page.waitForFunction(() => probe.video.readyState >= 2 && probe.video.buffered.length > 0, null, { timeout: 20000 });
        const result = await page.evaluate(() => ({
            currentTime: probe.video.currentTime,
            duration: probe.video.duration,
            live: probe.live,
            retries: probe.retries
        }));
        await page.close();
        assert.deepEqual(errors, []);
        return result;
    }

    try {
        const fallback = await startAt(null);
        assert.equal(fallback.live, true, 'hls.js treats the growing EVENT playlist as live');
        assert.ok(fallback.currentTime >= 18, `without a start position hls.js starts near the live edge (${fallback.currentTime.toFixed(1)} s)`);

        const fromStart = await startAt({ startPosition: 0 });
        assert.ok(fromStart.currentTime < 2, `startPosition 0 starts the film at its beginning (${fromStart.currentTime.toFixed(1)} s)`);

        const afterRetry = await startAt({ startPosition: 0 }, { failFirstSegment: true });
        assert.ok(afterRetry.retries >= 1, 'the first segment answered 503 and was retried');
        assert.ok(afterRetry.currentTime < 2, `a retry before the first frame keeps the start (${afterRetry.currentTime.toFixed(1)} s)`);

        const playerSource = fs.readFileSync(path.join(root, 'src/pages/movie-details/movie-details.js'), 'utf8');
        assert.match(playerSource, /config:\s*isTorrentStream\s*\?\s*\{\s*startPosition:\s*0\s*\}/,
            'the torrent player asks hls.js to start at the beginning');

        console.log(`torrentHlsStart tests passed (live edge ${fallback.currentTime.toFixed(1)} s, start ${fromStart.currentTime.toFixed(1)} s, after retry ${afterRetry.currentTime.toFixed(1)} s)`);
    } finally {
        await browser.close();
        server.close();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
