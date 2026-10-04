const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.route('**/*', route => route.fulfill({
            contentType: 'text/html',
            body: '<div id="surface"></div>'
        }));
        await page.goto('http://localhost:9876');

        // hls.js stand-in: every manifest is rejected as expired (HTTP 403).
        await page.evaluate(() => {
            class FakeHls {
                static Events = { ERROR: 'hlsError', DESTROYING: 'hlsDestroying' };
                static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
                static isSupported() { return true; }
                constructor() { this.listeners = {}; this.destroyed = false; window.hlsInstances.push(this); }
                on(event, handler) { (this.listeners[event] ||= []).push(handler); }
                emit(event, data) { (this.listeners[event] || []).forEach(handler => handler(event, data)); }
                loadSource(url) {
                    this.url = url;
                    setTimeout(() => this.emit('hlsError', {
                        type: 'networkError', details: 'manifestLoadError', fatal: true, response: { code: 403 }
                    }), 20);
                }
                attachMedia() {}
                stopLoad() {}
                startLoad() {}
                destroy() { this.destroyed = true; this.emit('hlsDestroying'); }
            }
            window.hlsInstances = [];
            window.Hls = FakeHls;
        });
        for (const file of [
            'src/shared/services/PlayerSourceLifecycle.js',
            'src/shared/services/player/HlsPlaybackFactory.js',
            'src/shared/services/parsers/BaseParserService.js'
        ]) {
            await page.addScriptTag({ content: read(file) });
        }
        await page.evaluate(() => {
            window.TestParser = class extends window.BaseParserService {
                constructor() { super({ id: 'rutube', name: 'Rutube', baseUrl: 'https://rutube.ru' }); }
                getPlayerType() { return 'video'; }
            };
        });

        // 1. Expired direct HLS falls back in place to the embed iframe.
        const fallback = await page.evaluate(async () => {
            const surface = document.getElementById('surface');
            surface.innerHTML = '';
            const host = document.createElement('div');
            host.id = 'host';
            surface.appendChild(host);
            const parser = new window.TestParser();
            const fallbacks = [];
            parser.renderPlayer(host, [
                { url: 'https://cdn.test/expired.m3u8', type: 'hls' },
                { url: 'https://rutube.ru/play/embed/abc', type: 'iframe' }
            ], { onSourceFallback: info => fallbacks.push(info.reason) });
            const firstVideo = host.querySelector('video');
            await new Promise(resolve => setTimeout(resolve, 150));
            return {
                hasVideo: Boolean(host.querySelector('video')),
                iframeSrc: host.querySelector('iframe')?.getAttribute('src') || null,
                videoConnected: firstVideo.isConnected,
                hlsDestroyed: window.hlsInstances[0].destroyed,
                hostState: host.dataset.sourceState || null,
                fallbacks
            };
        });
        assert.equal(fallback.hasVideo, false, 'the failed <video> must be removed');
        assert.equal(fallback.iframeSrc, 'https://rutube.ru/play/embed/abc', 'the embed source must be mounted in place');
        assert.equal(fallback.videoConnected, false);
        assert.equal(fallback.hlsDestroyed, true, 'the failed hls.js instance must be destroyed');
        assert.notEqual(fallback.hostState, 'error', 'a successful fallback must not show the error state');
        assert.deepEqual(fallback.fallbacks, ['source-rejected']);

        // 2. A cleaner-wrapped video is replaced as a whole wrapper.
        const wrapped = await page.evaluate(async () => {
            window.hlsInstances = [];
            const surface = document.getElementById('surface');
            surface.innerHTML = '';
            const container = document.createElement('div');
            const parser = new window.TestParser();
            parser.renderPlayer(container, [
                { url: 'https://cdn.test/expired.m3u8', type: 'hls' },
                { url: 'https://rutube.ru/play/embed/xyz', type: 'iframe' }
            ], {});
            // Simulate MovieDetails moving the element into the surface and the
            // shared cleaner wrapping that same element in its UI.
            const video = container.querySelector('video');
            const wrapper = document.createElement('div');
            wrapper.className = 'native-player-wrapper';
            surface.appendChild(wrapper);
            wrapper.appendChild(video);
            await new Promise(resolve => setTimeout(resolve, 150));
            return {
                wrappers: surface.querySelectorAll('.native-player-wrapper').length,
                iframe: surface.querySelector(':scope > iframe')?.getAttribute('src') || null,
                videos: surface.querySelectorAll('video').length
            };
        });
        assert.equal(wrapped.wrappers, 0, 'the cleaner wrapper of the failed stream must be removed');
        assert.equal(wrapped.iframe, 'https://rutube.ru/play/embed/xyz');
        assert.equal(wrapped.videos, 0);

        // 3. Without another source the host shows the error state with a retry.
        const failed = await page.evaluate(async () => {
            window.hlsInstances = [];
            const surface = document.getElementById('surface');
            surface.innerHTML = '';
            const host = document.createElement('div');
            surface.appendChild(host);
            const parser = new window.TestParser();
            parser.renderPlayer(host, [{ url: 'https://cdn.test/only.m3u8', type: 'hls' }], {});
            await new Promise(resolve => setTimeout(resolve, 150));
            return {
                state: host.dataset.sourceState || null,
                message: host.querySelector('.player-source-lifecycle__message')?.textContent || '',
                retry: Boolean(host.querySelector('[data-action="retry"]'))
            };
        });
        assert.equal(failed.state, 'error', 'an unrecoverable stream must end in the error state, not a timeout');
        assert.ok(failed.retry, 'the error state must offer a retry');

        // 4. Two failing HLS sources do not loop: each is tried once, then error.
        const chain = await page.evaluate(async () => {
            window.hlsInstances = [];
            const surface = document.getElementById('surface');
            surface.innerHTML = '';
            const host = document.createElement('div');
            surface.appendChild(host);
            const parser = new window.TestParser();
            parser.renderPlayer(host, [
                { url: 'https://cdn.test/a.m3u8', type: 'hls' },
                { url: 'https://cdn.test/b.m3u8', type: 'hls' }
            ], {});
            await new Promise(resolve => setTimeout(resolve, 300));
            return {
                attempted: window.hlsInstances.map(instance => instance.url),
                state: host.dataset.sourceState || null
            };
        });
        assert.deepEqual(chain.attempted, ['https://cdn.test/a.m3u8', 'https://cdn.test/b.m3u8']);
        assert.equal(chain.state, 'error');

        console.log('✅ parser stream fallback browser tests passed');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
