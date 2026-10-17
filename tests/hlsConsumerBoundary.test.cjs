const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function method(window, file, start, end, name) {
    const source = read(file);
    const from = source.indexOf(start);
    assert.ok(from >= 0);
    const to = source.indexOf(end, from + start.length);
    assert.ok(to > from);
    return window.eval(`({${source.slice(from, to)}}).${name}`);
}

(async () => {
    const dom = new JSDOM('<div id="host"></div>', { runScripts: 'outside-only', url: 'https://extension.test/' });
    const w = dom.window;
    try {
        w.eval(read('src/shared/services/parsers/BaseParserService.js'));
        w.eval(read('src/shared/services/parsers/AnimeGoParser.js'));
        const Parser = w.eval('(class extends BaseParserService { constructor() { super({id:"test",name:"test",baseUrl:"https://example.com"}); } getPlayerType() { return "video"; } })');
        const parser = new Parser();
        const host = w.document.getElementById('host');
        const sources = [{ type: 'hls', url: 'https://cloud.solodcdn.com/a.m3u8' }, { type: 'iframe', url: 'https://example.com/embed' }];
        w.Hls = { isSupported: () => false };
        parser.renderPlayer(host, sources);
        assert.equal(host.querySelector('video'), null, 'unsupported controlled HLS selects iframe, even if native HLS exists');
        assert.equal(host.querySelector('iframe').src, sources[1].url);

        let resolveLibrary;
        let creates = 0;
        delete w.Hls;
        w.LazyLoader = { loadScript: () => new Promise(resolve => { resolveLibrary = resolve; }) };
        parser.renderPlayer(host, sources);
        parser.renderPlayer(host, [{ type: 'video', url: 'https://example.com/current.mp4' }]);
        w.HlsPlaybackFactory = { create() { creates++; } };
        resolveLibrary();
        await Promise.resolve();
        assert.equal(creates, 0, 'a superseded lazy mount cannot start HLS');
        assert.equal(host.querySelector('video').src, 'https://example.com/current.mp4', 'MP4 stays available');

        w.Hls = {};
        w.HlsPlaybackFactory = {
            create(video, url, options) {
                const instance = { destroy() {} };
                options.beforeLoad(instance);
                options.onFatal({ reason: 'policy' });
                return instance;
            }
        };
        parser.renderPlayer(host, sources);
        assert.equal(host.querySelector('video'), null);
        assert.equal(host._hlsInstance, null, 'synchronous policy failure must not overwrite fallback ownership');

        host.innerHTML = '<video></video>';
        const anime = new w.AnimeGoParser();
        const state = { stream: sources[0], options: {}, mountSources: sources, mountOptions: { __animegoResolvedSources: true } };
        host.__animegoNativeState = state;
        delete w.HlsPlaybackFactory;
        assert.equal(anime.swapNativeStream(host, state), false);
        assert.equal(host.querySelector('video'), null, 'unsupported AnimeGo HLS falls back');

        // A newer swap owns metadata restoration even on the same video/state.
        host.innerHTML = '<video></video>';
        const swapVideo = host.querySelector('video');
        let swapPlayCalls = 0;
        swapVideo.play = () => { swapPlayCalls++; return Promise.resolve(); };
        host.__animegoNativeState = state;
        w.HlsPlaybackFactory = {
            create(video, url, options) {
                const instance = { destroy() {} };
                options.beforeLoad(instance);
                return instance;
            }
        };
        assert.equal(anime.swapNativeStream(host, state, { startAt: 10, play: true }), true);
        const staleRestore = swapVideo._animegoRestoreMetadata;
        state.stream = { ...sources[0], url: 'https://cloud.solodcdn.com/b.m3u8' };
        assert.equal(anime.swapNativeStream(host, state, { startAt: 20, play: false }), true);
        const currentRestore = swapVideo._animegoRestoreMetadata;
        assert.notEqual(currentRestore, staleRestore);
        staleRestore();
        assert.equal(swapVideo._animegoRestoreMetadata, currentRestore, 'stale invocation cannot clear current restore');
        swapVideo.dispatchEvent(new w.Event('loadedmetadata'));
        assert.equal(swapVideo.currentTime, 20, 'latest stream owns resume position');
        assert.equal(swapPlayCalls, 0, 'superseded play:true cannot resume latest play:false stream');
        assert.equal(swapVideo._animegoRestoreMetadata, null, 'invoked restore releases its video reference');
        swapVideo.currentTime = 25;
        swapVideo.dispatchEvent(new w.Event('loadedmetadata'));
        assert.equal(swapVideo.currentTime, 25, 'metadata restoration runs once');

        const render = method(w, 'src/pages/movie-details/movie-details.js', '    async renderCustomPlayer(', '    setupCustomControls(', 'renderCustomPlayer');
        const torrent = { sessionId: 'owned', preferHls: true, hlsUrl: sources[0].url };
        let pending;
        w.LazyLoader = { loadScript: () => new Promise(resolve => { pending = resolve; }) };
        w.HlsPlaybackFactory = { create() { creates++; return null; } };
        const movie = {
            torrentPlaybackSession: torrent, currentVideoUrl: sources[0].url,
            getPlayerSurface: () => ({ mountElement: element => host.replaceChildren(element) }),
            attachTorrentPlaybackVideo() {}, renderTorrentPlaybackStatus() {},
        };
        const rendering = render.call(movie, sources[0].url, true);
        movie.torrentPlaybackSession = {};
        pending();
        await rendering;
        assert.equal(creates, 0, 'a replaced torrent session cannot select a local profile after await');
        assert.equal(host.querySelector('video').hasAttribute('src'), false);
        const profiles = [];
        movie.torrentPlaybackSession = torrent;
        w.HlsPlaybackFactory.create = (video, url, options) => {
            profiles.push(options.networkProfile);
            assert.equal(options.localManifestUrl, options.networkProfile === 'local' ? url : undefined);
            return null;
        };
        let validRendering = render.call(movie, sources[0].url, true);
        pending();
        await validRendering;
        movie.torrentPlaybackSession = { sessionId: 'unrelated', preferHls: true, hlsUrl: 'http://127.0.0.1:3000/session/other/index.m3u8' };
        validRendering = render.call(movie, sources[0].url, true);
        pending();
        await validRendering;
        assert.deepEqual(profiles, ['local', 'remote'], 'only the captured unchanged torrent session selects local');
        assert.equal(host.querySelector('video').hasAttribute('src'), false, 'unsupported HLS never sets a native src');
        for (const invalidate of [
            () => { movie.sourceSwitchRequestId++; },
            () => { movie.torrentRequestId++; },
            () => { movie.torrentPlaybackSession.sessionId = 'changed'; },
            () => { movie.torrentPlaybackSession.hlsUrl = 'http://127.0.0.1:3000/changed.m3u8'; },
        ]) {
            movie.sourceSwitchRequestId = 1;
            movie.torrentRequestId = 1;
            movie.torrentPlaybackSession = { ...torrent };
            const staleRender = render.call(movie, sources[0].url, true);
            invalidate();
            pending();
            await staleRender;
        }
        assert.equal(profiles.length, 2, 'request or in-place session changes invalidate delayed mounts');

        const toggle = method(w, 'src/pages/search/search.js', '    async togglePlayPause(', '    async handleWatchingToggle(', 'togglePlayPause');
        const search = { isPlaying: false, currentVideoUrl: sources[0].url, elements: { videoContainer: host }, invalidatePlayerRestore() {} };
        const switching = toggle.call(search);
        assert.equal(host.querySelector('video').hasAttribute('src'), false);
        assert.equal(host.querySelector('source'), null, 'HLS markup cannot initiate native networking before the library loads');
        pending();
        await switching;
        assert.equal(host.querySelector('video'), null, 'unavailable factory shows the existing error state');
        assert.match(host.textContent, /unavailable/);
        search.isPlaying = false;
        search.currentVideoUrl = 'https://example.com/direct.mp4';
        await toggle.call(search);
        assert.equal(host.querySelector('video').src, search.currentVideoUrl);

        const initGhost = method(w, 'src/shared/services/player/PlayerGhostPreview.js', '    _initSource(url) {', '    // ─── UI', '_initSource');
        const protectedConfig = { loader: class { static movieExtensionPolicyLoader = true; } };
        const ghostVideo = w.document.createElement('video');
        let loads = 0;
        ghostVideo.load = () => { loads++; };
        ghostVideo.canPlayType = () => 'maybe';
        const ghost = { _ghostVideo: ghostVideo, _Hls: { isSupported: () => false }, _getCurrentType: () => 'hls', _getCurrentHls: () => ({ config: protectedConfig }) };
        initGhost.call(ghost, sources[0].url);
        assert.equal(ghostVideo.hasAttribute('src'), false, 'protected previews never fall back to native HLS');
        assert.equal(loads, 0);
        ghost._getCurrentHls = () => null;
        initGhost.call(ghost, sources[0].url);
        assert.equal(ghostVideo.src, sources[0].url, 'provider-owned native HLS keeps its existing limited behavior');
        dom.reconfigure({ url: 'chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd/src/pages/movie-details/movie-details.html' });
        initGhost.call(ghost, sources[0].url);
        assert.equal(ghostVideo.hasAttribute('src'), false, 'missing active policy cannot open native HLS on an extension page');
        ghost._Hls = class { static isSupported() { return true; } constructor() { throw new Error('unmanaged extension preview'); } };
        initGhost.call(ghost, sources[0].url);
        ghost._getCurrentHls = () => ({ config: protectedConfig });
        let destroyed = 0;
        let error;
        class FakeHls {
            static Events = { ERROR: 'error', MANIFEST_PARSED: 'parsed' };
            static isSupported() { return true; }
            constructor(config) { assert.equal(config.loader, protectedConfig.loader); }
            on(event, callback) { if (event === 'error') error = callback; }
            loadSource() { error('error', { fatal: false, response: { text: 'POLICY_VIOLATION' } }); }
            attachMedia() { throw new Error('destroyed preview must not attach'); }
            destroy() { destroyed++; }
        }
        ghost._Hls = FakeHls;
        initGhost.call(ghost, sources[0].url);
        error('error', { fatal: false, response: { text: 'POLICY_VIOLATION' } });
        assert.equal(destroyed, 1, 'nonfatal policy violations destroy preview exactly once');
        assert.equal(ghost._ghostHls, null);
        console.log('HLS consumer boundary tests passed');
    } finally { w.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
