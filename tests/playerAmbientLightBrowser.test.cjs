// Ambient light behind the film page's player (src/pages/movie-details/PlayerAmbientLight.js)
// in real Chromium: a video on the page, a provider frame on another origin running the real
// player-cleaner (its pixels, its menu, its lease), a frame whose picture cannot be read,
// forged messages and a hidden dialog. Tab capture needs Chrome's extension APIs and is not
// exercised here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

async function makeVideo(page, colour) {
    const bytes = await page.evaluate(async colour => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext('2d');
        const stream = canvas.captureStream(20);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        const chunks = [];
        recorder.ondataavailable = event => chunks.push(event.data);
        const stopped = new Promise(resolve => { recorder.onstop = resolve; });
        recorder.start();
        const start = performance.now();
        await new Promise(resolve => {
            const draw = () => {
                context.fillStyle = colour;
                context.fillRect(0, 0, 320, 180);
                if (performance.now() - start < 1200) requestAnimationFrame(draw);
                else resolve();
            };
            draw();
        });
        recorder.stop();
        await stopped;
        stream.getTracks().forEach(track => track.stop());
        return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    }, colour);
    return Buffer.from(bytes);
}

function serve(routes) {
    const server = http.createServer((request, response) => {
        const route = routes[request.url.split('?')[0]];
        if (!route) {
            response.writeHead(404);
            response.end();
            return;
        }
        const [type, body] = route();
        if (Buffer.isBuffer(body)) {
            const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/);
            const start = range ? Number(range[1]) : 0;
            const end = range?.[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
            response.writeHead(range ? 206 : 200, {
                'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
                ...(range ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {})
            });
            response.end(body.subarray(start, end + 1));
        } else {
            response.writeHead(200, { 'Content-Type': type });
            response.end(body);
        }
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const servers = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const green = await makeVideo(page, '#20c040');
        const red = await makeVideo(page, '#e02020');

        const hostHtml = `<!doctype html><html><head><link rel="stylesheet" href="/player.css"></head>
            <body class="dark-theme" style="margin:0;background:#09090b">
            <div id="videoPlayerModal" class="modal-overlay" style="display:flex;position:fixed;inset:0;align-items:center;justify-content:center;background:rgba(9,9,11,.65)">
              <div class="player-workspace"><div class="modal video-modal" style="width:640px;padding:16px">
                <div class="player-stage" id="playerStage"><div class="video-container" id="videoContainer"></div></div>
              </div></div>
            </div><script src="/PlayerAmbientLight.js"></script></body></html>`;
        const host = await serve({
            '/': () => ['text/html', hostHtml],
            '/player.css': () => ['text/css', read('src/shared/styles/player.css')],
            '/PlayerAmbientLight.js': () => ['text/javascript', read('src/pages/movie-details/PlayerAmbientLight.js')],
            '/green.webm': () => ['video/webm', green],
            '/red.webm': () => ['video/webm', red]
        });
        servers.push(host);
        const hostOrigin = `http://127.0.0.1:${host.address().port}`;
        // The frame plays either its own file (readable) or the host's (another origin, no CORS).
        const frameHtml = src => `<!doctype html><html><head></head><body style="margin:0;background:#000">
            <div id="player" class="player_1JR"><div class="video_9Xh">
              <video id="movie" src="${src}" muted autoplay loop playsinline style="width:100%;height:100%"></video>
            </div></div>
            <script src="/PlayerSettingsMenu.js"></script><script src="/PlayerMediaControls.js"></script>
            <script src="/PlayerGhostPreview.js"></script><script src="/player-cleaner.js"></script></body></html>`;
        const frames = await serve({
            '/readable.html': () => ['text/html', frameHtml('/red.webm')],
            '/protected.html': () => ['text/html', frameHtml(`${hostOrigin}/red.webm`)],
            '/red.webm': () => ['video/webm', red],
            '/PlayerSettingsMenu.js': () => ['text/javascript', read('src/shared/services/player/PlayerSettingsMenu.js')],
            '/PlayerMediaControls.js': () => ['text/javascript', read('src/shared/services/player/PlayerMediaControls.js')],
            '/PlayerGhostPreview.js': () => ['text/javascript', read('src/shared/services/player/PlayerGhostPreview.js')],
            '/player-cleaner.js': () => ['text/javascript', read('content-scripts/player-cleaner.js')]
        });
        servers.push(frames);
        const frameOrigin = `http://127.0.0.1:${frames.address().port}`;

        await page.goto(hostOrigin);
        await page.evaluate(() => {
            window.light = new window.PlayerAmbientLight({
                modal: document.getElementById('videoPlayerModal'),
                stage: document.getElementById('playerStage'),
                container: document.getElementById('videoContainer')
            });
            window.frameMessages = 0;
            addEventListener('message', event => { if (event.data?.type === 'PLAYER_AMBIENT_FRAME') window.frameMessages += 1; });
        });
        // Mean colour of the light, readable because the test's pictures are same-origin or sent as pixels.
        const lightColour = () => page.evaluate(() => {
            const { data } = window.light.context.getImageData(0, 0, 48, 27);
            const sum = [0, 0, 0];
            for (let i = 0; i < data.length; i += 4) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; }
            return { lit: window.light.canvas.classList.contains('is-lit'), mode: window.light.mode, status: window.light.status,
                rgb: sum.map(value => Math.round(value / (data.length / 4))) };
        });
        const waitForLight = async (test, label) => {
            const deadline = Date.now() + 10000;
            let last;
            while (Date.now() < deadline) {
                last = await lightColour();
                if (test(last)) return last;
                await page.waitForTimeout(150);
            }
            assert.fail(`${label}: ${JSON.stringify(last)}`);
        };

        // 1. A video on the page lights the scrim in its own colour, behind the dialog.
        await page.evaluate(() => {
            document.getElementById('videoContainer').innerHTML = '<video src="/green.webm" muted autoplay loop playsinline style="width:100%;height:100%"></video>';
        });
        await waitForLight(state => state.lit && state.mode === 'page' && state.rgb[1] > 100 && state.rgb[1] > state.rgb[0] * 2, 'page video');
        const geometry = await page.evaluate(() => {
            const stage = document.getElementById('playerStage').getBoundingClientRect();
            const light = window.light.canvas.getBoundingClientRect();
            const centre = document.elementFromPoint(stage.left + stage.width / 2, stage.top + stage.height / 2);
            return { wider: light.width > stage.width && light.height > stage.height,
                centred: Math.abs((light.left + light.width / 2) - (stage.left + stage.width / 2)) < 2,
                behind: centre !== window.light.canvas, opacity: getComputedStyle(window.light.canvas).opacity,
                filter: getComputedStyle(window.light.canvas).filter };
        });
        assert.deepEqual([geometry.wider, geometry.centred, geometry.behind], [true, true, true], JSON.stringify(geometry));
        assert.match(geometry.filter, /blur/);

        // 2. A readable provider frame: the real cleaner sends pixels, and the light starts over
        //    from darkness instead of mixing the previous film's colour in.
        await page.evaluate(src => {
            window.resets = 0;
            const reset = window.light.reset.bind(window.light);
            window.light.reset = () => { window.resets += 1; reset(); };
            document.getElementById('videoContainer').innerHTML = `<iframe src="${src}" style="width:100%;height:100%;border:0"></iframe>`;
        }, `${frameOrigin}/readable.html`);
        const fromFrame = await waitForLight(state => state.lit && state.mode === 'frame' && state.rgb[0] > 100 && state.rgb[0] > state.rgb[1] * 2, 'readable frame');
        assert.ok(fromFrame.rgb[1] < 60, `no green left from the page video: ${JSON.stringify(fromFrame)}`);
        assert.ok(await page.evaluate(() => window.resets) >= 1, 'a new source starts from darkness');

        // 3. The frame's menu sends PLAYER_AMBIENT_SET with the request it was given. The menu
        //    itself mounts only under a chrome-extension:// ancestor; step 6 drives it on the page.
        const frameWindow = page.frames().find(item => item.url().startsWith(frameOrigin));
        await frameWindow.evaluate(() => {
            addEventListener('message', event => { if (event.data?.type === 'PLAYER_AMBIENT_START') window.ambientAsk = event.data; });
        });
        await frameWindow.waitForFunction(() => window.ambientAsk?.status === 'on', null, { timeout: 5000 });
        const setFromFrame = enabled => frameWindow.evaluate(enabled => {
            parent.postMessage({ type: 'PLAYER_AMBIENT_SET', requestId: window.ambientAsk.requestId, enabled }, '*');
        }, enabled);
        await setFromFrame(false);
        await waitForLight(state => !state.lit && state.status === 'off', 'off from the frame');
        await frameWindow.waitForFunction(() => window.ambientAsk.status === 'off' && window.ambientAsk.sampling === false, null, { timeout: 3000 });
        const quiet = await page.evaluate(() => { window.frameMessages = 0; return new Promise(resolve => setTimeout(() => resolve(window.frameMessages), 1500)); });
        assert.equal(quiet, 0, 'the frame stops sampling while the light is off');
        await frameWindow.evaluate(() => {
            parent.postMessage({ type: 'PLAYER_AMBIENT_SET', requestId: window.ambientAsk.requestId + 1, enabled: true }, '*');
        });
        await page.waitForTimeout(600);
        assert.equal((await lightColour()).status, 'off', 'a message with another request is ignored');
        await setFromFrame(true);
        await waitForLight(state => state.lit && state.status === 'on' && state.rgb[0] > 100, 'on again from the frame');

        // 4. A hidden dialog stops the frame's sampling.
        await page.evaluate(() => { document.getElementById('videoPlayerModal').style.display = 'none'; });
        await page.waitForTimeout(2500);
        const hidden = await page.evaluate(() => { window.frameMessages = 0; return new Promise(resolve => setTimeout(() => resolve(window.frameMessages), 1500)); });
        assert.equal(hidden, 0, 'no pixels are sent for a hidden dialog');
        await page.evaluate(() => { document.getElementById('videoPlayerModal').style.display = 'flex'; });

        // 5. A frame whose picture is from another site: no pixels, and with no capture
        //    available the light stays out. A forged frame message from the page is ignored.
        await page.evaluate(src => {
            document.getElementById('videoContainer').innerHTML = `<iframe src="${src}" style="width:100%;height:100%;border:0"></iframe>`;
        }, `${frameOrigin}/protected.html`);
        await page.waitForTimeout(3000);
        const unreadable = await lightColour();
        assert.deepEqual([unreadable.lit, unreadable.mode], [false, 'none'], JSON.stringify(unreadable));
        await page.evaluate(() => {
            const pixels = new Uint8ClampedArray(48 * 27 * 4).fill(255);
            window.postMessage({ type: 'PLAYER_AMBIENT_FRAME', requestId: window.light.frame.requestId, width: 48, height: 27, pixels }, '*');
        });
        await page.waitForTimeout(600);
        assert.equal((await lightColour()).lit, false, 'pixels from anything but the frame are ignored');

        // 6. The page's own player menu, as on the extension page: the unmodified cleaner reads
        //    the light's state and turns it off and on.
        await page.evaluate(() => {
            window.chrome = { runtime: { id: 'test', getURL: () => 'data:text/javascript,' } };
            window.movieAmbientLight = window.light;
            document.getElementById('videoContainer').innerHTML = '<video id="pageMovie" src="/green.webm" muted autoplay loop playsinline style="width:100%;height:100%"></video>';
        });
        await waitForLight(state => state.lit && state.mode === 'page', 'page video again');
        for (const file of ['src/shared/services/player/PlayerSettingsMenu.js', 'src/shared/services/player/PlayerMediaControls.js', 'src/shared/services/player/PlayerGhostPreview.js']) {
            await page.addScriptTag({ content: read(file) });
        }
        await page.addScriptTag({ content: `(function(window) { ${read('content-scripts/player-cleaner.js')}\n})(new Proxy(window, {
            get(target, key) {
                if (key === 'location') return { protocol: 'chrome-extension:', origin: 'chrome-extension://test',
                    href: 'chrome-extension://test/src/pages/movie-details/movie-details.html', pathname: '/src/pages/movie-details/movie-details.html',
                    search: '', ancestorOrigins: [] };
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        }));` });
        const gear = page.locator('#videoContainer .player-settings-button');
        await gear.waitFor({ state: 'attached', timeout: 10000 });
        const openAmbient = async () => {
            await page.locator('#videoContainer').hover();
            await gear.click();
            const item = page.locator('#videoContainer .player-settings-menu__item', { hasText: 'Подсветка' });
            const value = await item.locator('.player-settings-menu__value').textContent();
            await item.click();
            return value;
        };
        assert.equal(await openAmbient(), 'Вкл');
        await page.locator('#videoContainer .player-settings-menu__option', { hasText: 'Откл' }).click();
        await waitForLight(state => !state.lit && state.status === 'off', 'off from the page menu');
        await page.keyboard.press('Escape');
        assert.equal(await openAmbient(), 'Откл');
        await page.locator('#videoContainer .player-settings-menu__option', { hasText: 'Вкл' }).click();
        await waitForLight(state => state.lit && state.status === 'on', 'on from the page menu');

        // 7. Nothing is left behind on destroy.
        await page.evaluate(() => window.light.destroy());
        assert.equal(await page.locator('.player-ambient').count(), 0);

        assert.deepEqual(errors, []);
        console.log('playerAmbientLightBrowser: page video, readable and protected frames, menu, hidden dialog, forged message: ok');
    } finally {
        await browser.close();
        for (const server of servers) server.close();
    }
})().catch(error => { console.error(error); process.exit(1); });
