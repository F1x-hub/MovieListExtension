const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    let server;
    try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        // Generate a small, real video locally; no provider or network dependency.
        const bytes = await page.evaluate(async () => {
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
                    context.fillStyle = performance.now() - start < 700 ? '#b03030' : '#3050b0';
                    context.fillRect(0, 0, 320, 180);
                    if (performance.now() - start < 1500) requestAnimationFrame(draw);
                    else resolve();
                };
                draw();
            });
            recorder.stop();
            await stopped;
            stream.getTracks().forEach(track => track.stop());
            return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
        });
        const media = Buffer.from(bytes);
        server = http.createServer((request, response) => {
            if (request.url.split('?')[0] === '/movie.webm') {
                const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/);
                const start = range ? Number(range[1]) : 0;
                const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
                response.writeHead(range ? 206 : 200, {
                    'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes',
                    'Content-Length': end - start + 1,
                    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {})
                });
                response.end(media.subarray(start, end + 1));
            } else {
                response.writeHead(200, { 'Content-Type': 'text/html' });
                response.end('<html><head></head><body><div id="player" class="player_1JR">'
                    + '<div class="video_9Xh"><video id="movie" src="/movie.webm" preload="auto"></video></div>'
                    + '</div></body></html>');
            }
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        await page.goto(origin);
        await page.evaluate(() => {
            window.chrome = { runtime: { id: 'test', getURL: () => 'data:text/javascript,' } };
            const movie = document.getElementById('movie');
            // MediaRecorder WebM lacks a duration header. Use its known fixture
            // duration and simulate the primary HLS owner's narrow MSE range.
            Object.defineProperty(movie, 'duration', { value: 1.5 });
            Object.defineProperty(movie, 'seekable', {
                value: { length: 1, start: () => 0, end: () => 0.1 }
            });
        });
        const cleaner = fs.readFileSync(path.join(__dirname, '../content-scripts/player-cleaner.js'), 'utf8');
        // Only the embedding boundary is simulated; DOM, decoding, events,
        // bootstrap order, and the unmodified cleaner execute in real Chromium.
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerSettingsMenu.js'), 'utf8') });
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerMediaControls.js'), 'utf8') });
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerGhostPreview.js'), 'utf8') });
        await page.addScriptTag({ content: `(function(window) { ${cleaner}\n})(new Proxy(window, {
            get(target, key) {
                if (key === 'location') return {
                    protocol: 'https:', origin: 'https://api.nextembed.ws',
                    href: 'https://api.nextembed.ws/embed/movie/31631', pathname: '/embed/movie/31631',
                    ancestorOrigins: ['chrome-extension://test']
                };
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        }));` });
        await page.locator('.native-player-wrapper .player-progress-track').waitFor();
        assert.deepEqual(errors, [], 'a sourced video at document_end must mount without the GhostPlayer TDZ error');
        assert.equal(await page.locator('.native-player-wrapper').count(), 1);
        assert.equal(await page.locator('.ghost-tooltip').count(), 1);
        assert.equal(await page.locator('.native-player-wrapper').evaluate(element =>
            getComputedStyle(element).zIndex), '2147483647',
        'exercise the provider iframe wrapper at maximum z-index, not only the host-page player');
        await page.locator('#movie').evaluate(video => { video.pause(); video.currentTime = 0; });
        await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../src/shared/styles/player.css'), 'utf8') });

        for (const [mode, theme, width] of ['provider', 'native'].flatMap(mode =>
            [['dark', 1100], ['light', 1100], ['dark', 420], ['light', 420]].map(([theme, width]) => [mode, theme, width]))) {
            await page.setViewportSize({ width, height: 720 });
            await page.evaluate(({ mode, theme }) => {
                document.body.className = `${theme}-theme`;
                document.body.style.background = theme === 'dark' ? '#141414' : '#fafafa';
                const wrapper = document.querySelector('.native-player-wrapper');
                wrapper.style.height = '560px';
                if (mode === 'native' && !wrapper.closest('.video-container')) {
                    const host = document.createElement('div');
                    host.className = 'video-container';
                    host.style.cssText = 'position:relative;width:100%;height:560px';
                    wrapper.before(host);
                    host.appendChild(wrapper);
                    wrapper.style.position = 'relative';
                    wrapper.style.zIndex = '1';
                    document.getElementById('movie').dataset.playerProvider = 'rutube';
                }
            }, { mode, theme });
            const track = await page.locator('.player-progress-track').boundingBox();
            const before = await page.locator('#movie').evaluate(video => video.currentTime);
            await page.mouse.move(track.x + track.width * 0.75, track.y + track.height / 2);
            // The point's own frame: decoded for the pointer, or prepared beforehand.
            await page.waitForFunction(() => {
                const ghost = window._iframeGhostPlayer;
                return ghost._frameImage.style.visibility === 'visible'
                    || ghost._ghostVideo.readyState >= 2 && ghost._ghostVideo.style.visibility === 'visible';
            }, null, { timeout: 10000 });
            const state = await page.evaluate(() => {
                const ghost = window._iframeGhostPlayer;
                const decoded = ghost._ghostVideo.style.visibility === 'visible';
                const box = ghost._tooltip.getBoundingClientRect();
                const frame = (decoded ? ghost._ghostVideo : ghost._frameImage).getBoundingClientRect();
                const label = ghost._timeLabel.getBoundingClientRect();
                return {
                    time: decoded ? ghost._ghostVideo.currentTime : ghost._frames.timeOf(ghost._hoverCell),
                    mainTime: document.getElementById('movie').currentTime,
                    label: ghost._timeLabel.textContent,
                    insideViewport: box.left >= 0 && box.right <= innerWidth && box.top >= 0,
                    frameWidth: frame.width,
                    frameHeight: frame.height,
                    labelBelowFrame: label.top >= frame.bottom,
                    paintedAboveVideo: (() => {
                        // The tooltip is normally pointer-transparent. Temporarily
                        // enable hit-testing to verify its actual painted layer.
                        ghost._tooltip.style.pointerEvents = 'auto';
                        const label = ghost._timeLabel.getBoundingClientRect();
                        const hit = document.elementFromPoint(label.left + label.width / 2, label.top + label.height / 2);
                        ghost._tooltip.style.pointerEvents = '';
                        return ghost._tooltip.contains(hit);
                    })()
                };
            });
            assert.ok(Math.abs(state.time - 1.125) < 0.1, 'decode the requested frame outside the primary MSE range');
            assert.equal(state.mainTime, before, 'hovering must never seek the primary video');
            assert.equal(state.label, '00:01');
            assert.equal(state.frameWidth, 200, `${mode} ${theme} preview must retain its frame width`);
            assert.equal(state.frameHeight, 112, `${mode} ${theme} preview must retain its frame height`);
            assert.ok(state.labelBelowFrame, `${mode} timestamp must not be covered by the frame`);
            assert.ok(state.insideViewport, `${theme} ${width}px preview must fit the viewport`);
            assert.ok(state.paintedAboveVideo, `${theme} ${width}px frame and timestamp must paint above the player`);
            if (process.env.PLAYER_PREVIEW_ARTIFACT_DIR) {
                fs.mkdirSync(process.env.PLAYER_PREVIEW_ARTIFACT_DIR, { recursive: true });
                await page.screenshot({ path: path.join(process.env.PLAYER_PREVIEW_ARTIFACT_DIR, `${mode}-${theme}-${width}.png`) });
            }
            await page.mouse.move(0, 0);
            await page.waitForFunction(() => !document.querySelector('.ghost-tooltip--visible'));
        }

        // Frames are prepared in the background, one for each point the pointer can reach
        // in fullscreen. A prepared point shows its own frame at once; any other point shows
        // only the time until its own frame is decoded, never another moment's frame.
        const frameColour = () => page.evaluate(() => {
            const image = window._iframeGhostPlayer._frameImage;
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const [r, , b] = context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
            return r > b ? 'red' : 'blue';
        });
        const shown = () => page.evaluate(() => {
            const ghost = window._iframeGhostPlayer;
            const image = ghost._frameImage.getBoundingClientRect();
            const video = ghost._ghostVideo.getBoundingClientRect();
            return {
                image: ghost._frameImage.style.visibility,
                video: ghost._ghostVideo.style.visibility,
                samePlace: ['left', 'top', 'width', 'height'].every(side => Math.abs(image[side] - video[side]) < 0.5)
            };
        });
        {
            await page.waitForFunction(() => {
                const frames = window._iframeGhostPlayer._frames;
                return frames && frames.size === frames.cells;
            }, null, { timeout: 15000 });
            const grid = await page.evaluate(() => {
                const ghost = window._iframeGhostPlayer;
                const track = document.querySelector('.player-progress-track').getBoundingClientRect();
                const player = document.querySelector('.native-player-wrapper').getBoundingClientRect();
                return {
                    cells: ghost._frames.cells,
                    film: ghost._cellCount(7472),
                    fullscreenTrack: Math.round(Math.max(track.width, screen.width - (player.width - track.width)))
                };
            });
            assert.equal(grid.cells, 2, 'a 1.5 s clip needs no more than one frame a second');
            assert.equal(grid.film, grid.fullscreenTrack, 'a film gets one frame per point of the fullscreen track');

            const track = await page.locator('.player-progress-track').boundingBox();
            const at = ratio => [track.x + track.width * ratio, track.y + track.height / 2];
            await page.mouse.move(...at(0.25));
            assert.deepEqual(await shown(), { image: 'visible', video: 'hidden', samePlace: true },
                'a prepared point shows its frame at once, in the frame\'s place');
            assert.equal(await frameColour(), 'red');
            await page.mouse.move(...at(0.75));
            assert.equal((await shown()).image, 'visible');
            assert.equal(await frameColour(), 'blue', 'each point shows its own moment');
            if (process.env.PLAYER_PREVIEW_ARTIFACT_DIR) {
                await page.screenshot({ path: path.join(process.env.PLAYER_PREVIEW_ARTIFACT_DIR, 'prepared.png') });
            }
            await page.mouse.move(0, 0);
            await page.waitForFunction(() => !document.querySelector('.ghost-tooltip--visible'));

            // Without prepared frames a point shows only its time until its own frame is decoded.
            await page.evaluate(() => {
                const ghost = window._iframeGhostPlayer;
                ghost._isFilmSteady = () => false;
                ghost._frames.destroy();
                ghost._frames = null;
            });
            await page.mouse.move(...at(0.25));
            assert.deepEqual(await shown(), { image: 'hidden', video: 'hidden', samePlace: true },
                'an unprepared point never borrows another moment\'s frame');
            await page.waitForFunction(() => {
                const ghost = window._iframeGhostPlayer;
                return ghost._ghostVideo.style.visibility === 'visible' && Math.abs(ghost._ghostVideo.currentTime - 0.375) < 0.1;
            }, null, { timeout: 10000 });
            await page.waitForFunction(() => window._iframeGhostPlayer._frames.get(0) !== null);
            await page.mouse.move(...at(0.75));
            assert.deepEqual(await shown(), { image: 'hidden', video: 'hidden', samePlace: true });
            await page.mouse.move(...at(0.25));
            assert.equal((await shown()).image, 'visible', 'a point decoded once comes back at once');
            assert.equal(await frameColour(), 'red');
            await page.mouse.move(0, 0);
            await page.waitForFunction(() => !document.querySelector('.ghost-tooltip--visible'));
        }

        const sourceContract = await page.evaluate(() => {
            const resolve = MovieExtension_PlayerCleaner._test.getPreviewMediaUrl;
            const movie = document.getElementById('movie');
            const blobVideo = { currentSrc: 'blob:https://api.nextembed.ws/opaque' };
            const emptyDoc = { querySelector: () => null };
            const providerDoc = {
                querySelector: () => ({}),
                querySelectorAll: () => [{ textContent: 'makePlayer({ source: { dash: "movie.mpd", hls: "https://media.example/current.m3u8" } });' }]
            };
            return {
                direct: resolve(movie),
                opaque: resolve(blobVideo, emptyDoc),
                provider: resolve(blobVideo, providerDoc),
                bridged: resolve({ currentSrc: blobVideo.currentSrc, dataset: {
                    playerPreviewUrl: 'https://media.example/active/playlist?token=fixture',
                    playerPreviewMedia: blobVideo.currentSrc
                } }, emptyDoc),
                stale: resolve({ currentSrc: 'blob:https://api.nextembed.ws/new', dataset: {
                    playerPreviewUrl: 'https://media.example/previous.m3u8',
                    playerPreviewMedia: blobVideo.currentSrc
                } }, emptyDoc),
                primary: resolve({ _movieExtensionHls: { url: 'https://media.example/active.m3u8' } }, providerDoc)
            };
        });
        assert.equal(sourceContract.direct, `${origin}/movie.webm`);
        assert.equal(sourceContract.opaque, null, 'an MSE blob must never be reused as preview media');
        assert.equal(sourceContract.provider, 'https://media.example/current.m3u8');
        assert.equal(sourceContract.bridged, 'https://media.example/active/playlist?token=fixture');
        assert.equal(sourceContract.stale, null, 'source metadata must belong to the current media element/source');
        assert.equal(sourceContract.primary, 'https://media.example/active.m3u8');

        // Exercise the provider-to-preview DOM contract with a real decoder,
        // including source changes on the same primary video (MSE ownership).
        for (const provider of ['kinogo', 'exfs', 'rutube', 'torrent', 'vidsrc']) {
            await page.evaluate(({ provider, origin }) => {
                const movie = document.getElementById('movie');
                Object.defineProperty(movie, 'currentSrc', {
                    configurable: true, value: `blob:https://provider.example/${provider}`
                });
                movie.dataset.playerProvider = provider;
                movie.dataset.playerPreviewMedia = movie.currentSrc;
                movie.dataset.playerPreviewUrl = `${origin}/movie.webm?provider=${provider}`;
                movie.dataset.playerPreviewType = 'video';
            }, { provider, origin });
            const track = await page.locator('.player-progress-track').boundingBox();
            await page.mouse.move(track.x + track.width * 0.75, track.y + track.height / 2);
            await page.waitForFunction(provider => {
                const ghost = window._iframeGhostPlayer;
                return ghost._lastUrl?.endsWith(`provider=${provider}`)
                    && ghost._ghostVideo.readyState >= 2 && ghost._ghostVideo.style.visibility === 'visible';
            }, provider);
            assert.equal(await page.locator('#movie').evaluate(video => video.currentTime), 0);
            await page.mouse.move(0, 0);
        }
        await page.locator('#movie').evaluate(video => {
            delete video.currentSrc;
            delete video.dataset.playerPreviewUrl;
            delete video.dataset.playerPreviewMedia;
            delete video.dataset.playerPreviewType;
        });

        const hlsContract = await page.evaluate(() => {
            const ghost = window._iframeGhostPlayer;
            class FakeHls {
                static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed' };
                static isSupported() { return true; }
                constructor(config) {
                    this.config = config;
                    this.levels = [{ bitrate: 1000 }, { bitrate: 100 }];
                    this.listeners = {};
                    this.starts = [];
                }
                on(event, callback) { this.listeners[event] = callback; }
                loadSource(url) { this.url = url; }
                attachMedia() {}
                startLoad(time) { this.starts.push(time); }
                stopLoad() {}
                destroy() { this.destroyed = true; }
            }
            ghost._Hls = FakeHls;
            ghost._getCurrentUrl = () => 'https://media.example/playlist?session=fixture';
            ghost._getCurrentType = () => 'hls';
            ghost._getCurrentHls = () => ({ config: { xhrSetup: 'auth-loader-fixture' } });
            ghost._seekGhost(1);
            const hls = ghost._ghostHls;
            const beforeManifest = hls.starts.length;
            hls.listeners.manifestParsed();
            const starts = [...hls.starts];
            const level = hls.loadLevel;
            const loader = hls.config.xhrSetup;
            ghost._handleLeave();
            hls.listeners.manifestParsed();
            const afterLeave = [...hls.starts];
            const buffer = [hls.config.maxBufferLength, hls.config.maxMaxBufferLength];

            // A lighter stream offered for previews brings its own transport; when it
            // fails, the preview goes back to the stream being watched.
            const light = { url: 'https://media.example/light.m3u8', config: { xhrSetup: 'light-loader-fixture' } };
            ghost._getPreviewSource = () => light;
            ghost._seekGhost(1);
            const lightHls = ghost._ghostHls;
            const lighter = { url: lightHls.url, loader: lightHls.config.xhrSetup, replaced: hls.destroyed === true };
            lightHls.listeners.error('error', { fatal: true });
            ghost._seekGhost(1);
            const fallback = { url: ghost._ghostHls.url, loader: ghost._ghostHls.config.xhrSetup, lightDestroyed: lightHls.destroyed === true };

            const mainTime = document.getElementById('movie').currentTime;
            const last = ghost._ghostHls;
            ghost.destroy();
            return { beforeManifest, starts, level, loader, afterLeave, buffer, lighter, fallback, mainTime, destroyed: last.destroyed, previews: document.querySelectorAll('.ghost-tooltip').length };
        });
        assert.deepEqual(hlsContract, {
            beforeManifest: 0, starts: [1], level: 1, loader: 'auth-loader-fixture', afterLeave: [1],
            buffer: [2, 4],
            lighter: { url: 'https://media.example/light.m3u8', loader: 'light-loader-fixture', replaced: true },
            fallback: { url: 'https://media.example/playlist?session=fixture', loader: 'auth-loader-fixture', lightDestroyed: true },
            mainTime: 0, destroyed: true, previews: 0
        });
        assert.deepEqual(errors, []);
        console.log('PASS: immediate provider mount; real decoded hover frames; frames prepared in the background per fullscreen track point and shown at once; no borrowed frames; primary playback isolation; dark/light and narrow preview geometry; HLS manifest timing, one-piece buffer, lighter preview stream with fallback, and cleanup');
    } finally {
        await browser.close();
        if (server) await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
