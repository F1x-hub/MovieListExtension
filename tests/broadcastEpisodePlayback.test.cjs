const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');
const { AutoNextCoordinator } = require('../src/shared/services/player/AutoNextCoordinator');
const { SeasonvarAdapter } = require('../src/shared/services/player/adapters/SeasonvarAdapter');
const { VidSrcAdapter } = require('../src/shared/services/player/adapters/VidSrcAdapter');
const { BasePlaybackAdapter } = require('../src/shared/services/player/adapters/BasePlaybackAdapter');

const read = file => fs.readFileSync(file, 'utf8');
const episode = { kinopoiskId: 101, mediaType: 'tv-series', seasonNumber: 2,
    episodeNumber: 6, title: 'Fixture', initialTimestamp: 0, source: 'BROADCAST' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const silentConsole = { log() {}, info() {}, warn() {}, error() {} };

function managerHarness(extra = {}) {
    const listeners = {};
    const window = { location: { search: '?movieId=101&embedded=true&broadcastStart=1000&mediaType=tv-series&seasonNumber=0&episodeNumber=2', origin: 'chrome-extension://test' },
        addEventListener(type, fn) { listeners[type] = fn; } };
    const firebaseManager = { isAuthReady: true, waitForAuthReady: async () => {}, isAuthenticated: () => true, getCurrentUser: () => ({ uid: 'fixture' }) };
    window.firebaseManager = firebaseManager;
    const context = vm.createContext({ window, document: { addEventListener() {} },
        URLSearchParams, setTimeout, clearTimeout, console: silentConsole, firebaseManager,
        chrome: { storage: { local: { get: async () => ({}) } } }, ...extra });
    vm.runInContext(read('src/pages/movie-details/movie-details.js').replace(/^import .*;\r?$/gm, ''), context);
    const manager = Object.create(window.MovieDetailsManager.prototype);
    return { manager, listeners, context, window };
}

test('broadcast URL installs S0E2 before cache, preload and autoplay; personal resume is ignored', async () => {
    const { manager, window } = managerHarness({ setTimeout: callback => { callback(); } });
    window.location.search += '&autoplay=true';
    let personalReads = 0;
    const controller = new PlaybackController();
    const seen = [];
    const inspect = phase => { const selection = controller.getSelection(); assert.equal(selection.seasonNumber, 0); assert.equal(selection.episodeNumber, 2); assert.equal(selection.initialTimestamp, 0); seen.push(phase); };
    Object.assign(manager, { playbackController: controller, progressService: { getProgress: async () => { personalReads++; return { season: '9 сезон', episode: '9 серия', timestamp: 800 }; } },
        elements: {}, isEmbedded: true, startBroadcastLock() { this.broadcastLock = {}; }, setProtectedControlsEnabled() {},
        loadSpeculativeCachedMovie: async () => { inspect('cache'); return null; },
        loadMovieById: async () => { manager.selectedMovie = { kinopoiskId: 101, nameRu: 'Сериал', isSeries: true }; manager.hydrateBroadcastSelection(manager.selectedMovie); },
        initPlayerRegistry: () => inspect('registry'), preloadAllPlayers: () => inspect('preload'), probeSourceAvailability: () => {}, handleWatchClick: () => inspect('autoplay') });
    await manager.initializeUI();
    assert.deepEqual(seen, ['cache', 'registry', 'preload', 'autoplay']);
    assert.equal(await manager.progressService.getProgress(101), null);
    assert.equal(personalReads, 0);
    assert.equal(controller.getSelection().title, 'Сериал');
});

test('invalid broadcast episode refuses to launch; ordinary routes keep personal selection policy', () => {
    const { manager } = managerHarness();
    manager.playbackController = new PlaybackController();
    for (const query of ['mediaType=tv-series&seasonNumber=-1&episodeNumber=1', 'mediaType=tv-series&seasonNumber=0', 'mediaType=tv-series&seasonNumber=&episodeNumber=1', 'mediaType=tv-series&seasonNumber=1&episodeNumber=0']) {
        assert.equal(manager.configureBroadcastEpisode(new URLSearchParams(query), 101), false);
    }
    assert.equal(manager.configureBroadcastEpisode(new URLSearchParams(), 101), true);
    assert.equal(manager.playbackController.broadcastSelection, undefined);
});

test('controller rejects host/provider/autonext episode changes, including missing S0 identity', () => {
    const controller = new PlaybackController();
    controller.setBroadcastSelection({ ...episode, seasonNumber: 0 });
    for (const patch of [{ episodeNumber: 7 }, { seasonNumber: 1 }, { seasonNumber: null }]) {
        assert.throws(() => controller.updateSelection(patch), { code: 'BROADCAST_SELECTION_LOCKED' });
    }
    controller.handleProgressUpdate({ movieId: 101, seasonNumber: 1, episodeNumber: 9, timestamp: 800, origin: 'USER_PROVIDER_SELECTION' });
    assert.equal(controller.getSelection().seasonNumber, 0);
    assert.equal(controller.getSelection().episodeNumber, 6);
    controller.clearSelection();
    assert.equal(controller.getSelection().episodeNumber, 6);
    const autoNext = new AutoNextCoordinator({ playbackController: controller, resolveNextEpisode: () => { throw new Error('must not resolve next'); } });
    assert.equal(autoNext.handlePlaybackEnded({ movie: {}, selection: episode, runtime: {} }), false);
    autoNext.state.active = true;
    autoNext.playNow();
    assert.equal(autoNext.getState().active, false);
});

test('provider capabilities allow direct and native confirmation; S0 is preserved or refused safely', async () => {
    const controller = new PlaybackController();
    controller.setBroadcastSelection(episode);
    const native = { id: 'native', canHandle: () => true, getSelectionMode: () => 'NATIVE_BRIDGE' };
    assert.equal(controller.canPlayBroadcastProvider(native), true);
    assert.equal(controller.canPlayBroadcastProvider({ canHandle: () => true, getSelectionMode: () => 'OPAQUE' }), false);
    controller.broadcastSelection = null;
    controller.setBroadcastSelection({ ...episode, seasonNumber: 0 });
    assert.equal(controller.canPlayBroadcastProvider(new SeasonvarAdapter()), false);
    assert.equal(controller.canPlayBroadcastProvider(native), false);
    const vidsrc = new VidSrcAdapter();
    controller.updateSelection({ imdbId: 'tt1234567' });
    assert.equal(controller.canPlayBroadcastProvider(vidsrc), true);
    assert.match(vidsrc.buildUrl(controller.getSelection()), /season=0&episode=6/);
    controller.registerAdapter(new SeasonvarAdapter());
    await assert.rejects(controller.switchProvider('seasonvar'), { code: 'BROADCAST_EPISODE_UNAVAILABLE' });
});

test('MovieDetails blocks episode navigation and fails closed on provider-origin mismatch', async () => {
    const { manager, listeners } = managerHarness();
    const controller = new PlaybackController();
    controller.setBroadcastSelection(episode);
    let unmounts = 0;
    const states = [];
    Object.assign(manager, { broadcastLock: {}, broadcastEpisode: episode, playbackController: controller,
        isTrustedPlayerMessage: () => true, unmountActivePlayer: () => { unmounts++; }, setPlayerSourceState: state => states.push(state) });
    manager.setupPlayerMessageListener();
    assert.equal(await manager.playSelection({ ...episode, episodeNumber: 7 }), false);
    assert.equal(await manager.handlePlayerNavigate('next'), false);
    manager.broadcastNativeSelectionReady = false;
    await listeners.message({ data: { type: 'EPISODE_CHANGED', seasonNumber: 1, episodeNumber: 1, origin: 'USER_PROVIDER_SELECTION' } });
    await listeners.message({ data: { type: 'UPDATE_WATCHING_PROGRESS', seasonNumber: 1, episodeNumber: 1, timestamp: 120 } });
    assert.equal(unmounts, 0, 'initial provider defaults must remain locked while exact selection is being confirmed');
    manager.broadcastNativeSelectionReady = true;
    await listeners.message({ data: { type: 'EPISODE_CHANGED', seasonNumber: 2, episodeNumber: 7, origin: 'USER_PROVIDER_SELECTION' } });
    await listeners.message({ data: { type: 'UPDATE_WATCHING_PROGRESS', seasonNumber: 2, episodeNumber: 8, origin: 'USER_PROVIDER_SELECTION' } });
    assert.equal(unmounts, 2);
    assert.deepEqual(states, ['unavailable', 'unavailable']);
    assert.equal(controller.getSelection().episodeNumber, 6);
});

test('every source entry rejects opaque broadcast playback before provider/network work', async () => {
    const { manager } = managerHarness();
    const controller = new PlaybackController();
    controller.setBroadcastSelection(episode);
    controller.registerAdapter({ id: 'opaque', canHandle: () => true, getSelectionMode: () => 'OPAQUE' });
    Object.assign(manager, { broadcastEpisode: episode, playbackController: controller, setPlayerSourceState() {} });
    assert.equal(await manager.changeVideoSource('parser:opaque'), false);
    assert.equal(await manager.changeVideoSource('https://media.fixture/unknown.mp4'), false);
    assert.equal(await manager.loadParserSource('opaque'), false);
    assert.equal(await manager.mountPlayer('opaque'), false);
    assert.equal(manager.loadVidSrcSource('tt1234567'), false);
    manager.selectedMovie = { type: 'movie' };
    assert.match(manager.buildVidSrcUrl('tt1234567'), /\/tv\?.*season=2&episode=6/);
});

test('native broadcast waits for exact confirmation and closes on refusal or bridge exception', async () => {
    for (const response of [true, false, 'DISPATCHED', new Error('bridge failed')]) {
        const { manager } = managerHarness();
        const gate = deferred();
        const iframe = {};
        const adapter = { getSelectionMode: () => 'NATIVE_BRIDGE', applySelection: async () => { const result = await gate.promise; if (result instanceof Error) throw result; return result; } };
        let unmounts = 0;
        Object.assign(manager, { broadcastEpisode: episode, activePlayerId: 'native', sourceSwitchRequestId: 1,
            elements: { videoContainer: { querySelector: () => iframe } }, broadcastLock: { forward() {} },
            playbackController: { getAdapter: () => adapter, getSelection: () => episode },
            unmountActivePlayer: () => { unmounts++; }, setPlayerSourceState() {} });
        const pending = manager.confirmBroadcastNativeSelection();
        assert.equal(manager.broadcastNativeSelectionReady, false);
        gate.resolve(response);
        assert.equal(await pending, response === true);
        assert.equal(manager.broadcastNativeSelectionReady, response === true);
        assert.equal(unmounts, response === true ? 0 : 1);
    }
});

test('stale native confirmation cannot release a replacement source', async () => {
    const { manager } = managerHarness();
    const gate = deferred();
    let iframe = {};
    const adapter = { getSelectionMode: () => 'NATIVE_BRIDGE', applySelection: () => gate.promise };
    Object.assign(manager, { broadcastEpisode: episode, activePlayerId: 'native', sourceSwitchRequestId: 1,
        elements: { videoContainer: { querySelector: () => iframe } }, broadcastLock: { forward() {} },
        playbackController: { getAdapter: () => adapter, getSelection: () => episode },
        unmountActivePlayer: () => { throw new Error('must not unmount replacement'); } });
    const pending = manager.confirmBroadcastNativeSelection();
    iframe = {}; manager.sourceSwitchRequestId = 2;
    gate.resolve(true);
    assert.equal(await pending, false);
    assert.equal(manager.broadcastNativeSelectionReady, false);
});

test('a confirmation outlived by a reload of the same frame confirms the new document instead of holding the clock', async () => {
    const { manager } = managerHarness();
    const iframe = {};
    let applications = 0;
    const adapter = { getSelectionMode: () => 'NATIVE_BRIDGE', applySelection: async () => {
        applications++;
        if (applications === 1) manager.broadcastFrameLoads.set(iframe, 1);
        return true;
    } };
    Object.assign(manager, { broadcastEpisode: episode, activePlayerId: 'native', sourceSwitchRequestId: 1,
        broadcastFrameLoads: new Map([[iframe, 0]]),
        elements: { videoContainer: { querySelector: () => iframe } }, broadcastLock: { forward() {} },
        playbackController: { getAdapter: () => adapter, getSelection: () => episode },
        unmountActivePlayer: () => { throw new Error('must not unmount'); } });
    assert.equal(await manager.confirmBroadcastNativeSelection(), true);
    assert.equal(applications, 2);
    assert.equal(manager.broadcastNativeSelectionReady, true);
});

test('successful native confirmation is reused only for the same frame, request and episode', async () => {
    const { manager } = managerHarness();
    let iframe = {};
    let selection = { ...episode };
    let applications = 0;
    const adapter = { getSelectionMode: () => 'NATIVE_BRIDGE', applySelection: async () => { applications++; return true; } };
    Object.assign(manager, { broadcastEpisode: episode, activePlayerId: 'native', sourceSwitchRequestId: 1,
        elements: { videoContainer: { querySelector: () => iframe } }, broadcastLock: { forward() {} },
        playbackController: { getAdapter: () => adapter, getSelection: () => selection } });
    assert.equal(await manager.confirmBroadcastNativeSelection(), true);
    assert.equal(await manager.confirmBroadcastNativeSelection(), true);
    assert.equal(applications, 1);
    manager.sourceSwitchRequestId++;
    await manager.confirmBroadcastNativeSelection();
    assert.equal(applications, 2);
    iframe = {};
    await manager.confirmBroadcastNativeSelection();
    assert.equal(applications, 3);
    selection = { ...episode, episodeNumber: 7 };
    await manager.confirmBroadcastNativeSelection();
    assert.equal(applications, 4);
    manager.broadcastFrameLoads = new WeakMap([[iframe, 1]]);
    await manager.confirmBroadcastNativeSelection();
    assert.equal(applications, 5, 'same-element iframe navigation requires a fresh confirmation');
});

test('direct controller native mounts report ready only after a strict successful acknowledgement', async () => {
    for (const response of [true, false, 'DISPATCHED']) {
        const states = [];
        let unmounts = 0;
        const controller = new PlaybackController({ container: { querySelector: () => null, querySelectorAll: () => [] }, onStateChange: state => states.push(state) });
        controller.setBroadcastSelection(episode);
        controller.registerAdapter({ id: 'fixture', label: 'Fixture', canHandle: () => true,
            getSelectionMode: () => 'NATIVE_BRIDGE', unmount: () => { unmounts++; },
            mount: async (_container, _selection, context) => { context.onReady(); assert.ok(!states.includes('ready')); return {}; },
            applySelection: async () => response });
        const mount = controller.switchProvider('fixture');
        if (response === true) { await mount; assert.ok(states.includes('ready')); }
        else { await assert.rejects(mount, { code: 'BROADCAST_EPISODE_UNAVAILABLE' }); assert.ok(!states.includes('ready')); assert.ok(unmounts > 0); }
    }
});

test('native bridge accepts trusted APPLIED only, never DISPATCHED or another episode', async () => {
    const dom = new JSDOM('<iframe src="https://provider.fixture/player"></iframe>', { url: 'https://host.fixture/' });
    const oldWindow = global.window;
    global.window = dom.window;
    try {
        const frame = dom.window.document.querySelector('iframe');
        const adapter = new BasePlaybackAdapter('fixture', 'Fixture');
        adapter.getSelectionMode = () => 'NATIVE_BRIDGE';
        adapter.activeContainer = dom.window.document.body;
        let request;
        frame.contentWindow.postMessage = data => { request = data; };
        for (const status of ['DISPATCHED', 'APPLIED']) {
            const pending = adapter.applySelection(episode, { timeoutMs: 100 });
            const response = { type: 'PLAYBACK_SELECTION_RESULT', requestId: request.requestId, providerId: 'fixture', seasonNumber: 2, episodeNumber: 6, status };
            dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { ...response, episodeNumber: 7 }, source: frame.contentWindow, origin: 'https://provider.fixture' }));
            dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: response, source: frame.contentWindow, origin: 'https://provider.fixture' }));
            assert.equal(await pending, status === 'APPLIED');
        }
    } finally { global.window = oldWindow; dom.window.close(); }
});

test('broadcast bridge resends until the loading frame answers and shares one request between callers', async () => {
    const dom = new JSDOM('<iframe src="https://provider.fixture/player"></iframe>', { url: 'https://host.fixture/' });
    const oldWindow = global.window;
    global.window = dom.window;
    try {
        const frame = dom.window.document.querySelector('iframe');
        const adapter = new BasePlaybackAdapter('fixture', 'Fixture');
        adapter.getSelectionMode = () => 'NATIVE_BRIDGE';
        adapter.activeContainer = dom.window.document.body;
        const requests = [];
        frame.contentWindow.postMessage = data => { requests.push(data); };
        const reply = (request, status) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
            data: { type: 'PLAYBACK_SELECTION_RESULT', requestId: request.requestId, providerId: 'fixture', seasonNumber: 2, episodeNumber: 6, status },
            source: frame.contentWindow, origin: 'https://provider.fixture' }));
        const options = { waitForBridge: true, timeoutMs: 2000, resendMs: 20 };
        const first = adapter.applySelection(episode, options);
        const second = adapter.applySelection(episode, options);
        await new Promise(done => setTimeout(done, 70));
        assert.ok(requests.length >= 2, 'a request lost before the frame listened is sent again');
        reply(requests.at(-1), 'UNAVAILABLE');
        await new Promise(done => setTimeout(done, 40));
        const latest = requests.at(-1);
        reply(latest, 'PENDING');
        const sentAfterPending = requests.length;
        await new Promise(done => setTimeout(done, 60));
        assert.equal(requests.length, sentAfterPending, 'no resend while the frame is applying');
        reply(latest, 'APPLIED');
        assert.equal(await first, true);
        assert.equal(await second, true, 'a second caller joins the same request');
        assert.equal(await adapter.applySelection(episode, { waitForBridge: true, timeoutMs: 60, resendMs: 20 }), false);
    } finally { global.window = oldWindow; dom.window.close(); }
});

test('Seasonvar broadcast refuses missing season/episode and never substitutes an index or personal resume', async () => {
    const dom = new JSDOM('<div id="videoContainer"></div>', { url: 'https://host.fixture/', runScripts: 'outside-only' });
    const context = dom.getInternalVMContext();
    context.console = silentConsole;
    vm.runInContext(read('src/shared/services/parsers/BaseParserService.js'), context);
    vm.runInContext(read('src/shared/services/parsers/SeasonvarParser.js'), context);
    const parser = new dom.window.SeasonvarParser();
    parser._attachListeners = () => {};
    parser._updateVideoSubtitles = () => {};
    parser._postPlaybackState = () => {};
    parser.handleProgressRestoration = () => { throw new Error('personal resume must not run'); };
    const sources = [{ name: '1 серия', url: 'https://media.fixture/1.mp4' }, { name: '3 серия', url: 'https://media.fixture/3.mp4' }];
    const container = dom.window.document.getElementById('videoContainer');
    const options = { broadcastSelection: true, movieId: 101, season: 2, episode: 2,
        seasons: [{ season_number: 2, url: 'https://provider.fixture/s2' }], currentSourcesUrl: 'https://provider.fixture/s2', translations: [{}] };
    try {
        assert.equal(await parser.renderPlayer(container, sources, { ...options, season: 0 }), false);
        assert.equal(await parser.renderPlayer(container, sources, options), false);
        assert.equal(await parser.renderPlayer(container, sources, { ...options, resolvedEpisodeUrl: sources[1].url }), false);
        assert.equal(await parser.renderPlayer(container, sources, { ...options, episode: 3 }), true);
        assert.equal(container.querySelector('source').getAttribute('src'), sources[1].url);
    } finally { dom.window.close(); }
});

test('cleaner holds native playback pending confirmation and retains seek/resume/EOF for admin and viewers', () => {
    const dom = new JSDOM('<video></video><button data-player-episode-action="next">Next</button>', { url: 'chrome-extension://fixture/player', runScripts: 'outside-only' });
    const win = dom.window;
    const storage = new Map();
    Object.defineProperty(win, 'localStorage', { value: {
        getItem: key => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key)
    } });
    const video = win.document.querySelector('video');
    let paused = false;
    let time = 5;
    Object.defineProperties(video, { paused: { get: () => paused }, duration: { get: () => 300 }, currentTime: { get: () => time, set: value => { time = value; } } });
    video.pause = () => { paused = true; };
    video.play = () => { paused = false; return Promise.resolve(); };
    win.console = silentConsole;
    win.PlayerLocale = { init: async () => true, t: () => '' };
    try {
        for (const name of ['PlayerSettingsMenu', 'PlayerMediaControls', 'PlayerGhostPreview']) {
            win.eval(read(`src/shared/services/player/${name}.js`));
        }
        win.eval(read('content-scripts/player-cleaner.js'));
        const reports = [];
        win.postMessage = data => reports.push(data);
        const send = data => win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'BROADCAST_STATE', startMs: win.Date.now() - 100000, selection: episode, ...data }, source: win, origin: win.location.origin }));
        send({ admin: true, selectionReady: false });
        assert.equal(paused, true);
        video.dispatchEvent(new win.Event('ended'));
        assert.ok(!reports.some(report => report.type === 'BROADCAST_ENDED'));
        video.play(); video.dispatchEvent(new win.Event('play'));
        assert.equal(paused, true, 'admin cannot release an unconfirmed episode');
        let navigated = false;
        const next = win.document.querySelector('button');
        next.addEventListener('click', () => { navigated = true; }); next.click();
        assert.equal(navigated, false);
        send({ admin: true, selectionReady: true, pausedAtSec: 42 });
        assert.equal(time, 42);
        assert.equal(paused, true);
        video.dispatchEvent(new win.Event('seeked'));
        const later = win.Date.now() + 2000;
        win.Date.now = () => later;
        time = 84; video.dispatchEvent(new win.Event('seeked'));
        assert.ok(reports.some(report => report.type === 'BROADCAST_ADMIN_ACTION' && report.action === 'seek' && report.atSec === 84));
        send({ admin: false, selectionReady: true });
        assert.ok(time >= 99 && time <= 101);
        assert.equal(paused, false);
        video.dispatchEvent(new win.Event('ended'));
        assert.ok(reports.some(report => report.type === 'BROADCAST_ENDED'));
        assert.equal(win.localStorage.getItem('movieExtension_autoplay_next'), null);
    } finally { dom.window.close(); }
});

function broadcastJoinHarness(admin) {
    const dom = new JSDOM('<video></video>', { url: 'chrome-extension://fixture/player', runScripts: 'outside-only' });
    const win = dom.window, video = win.document.querySelector('video');
    const state = { clock: Date.now(), time: 0, duration: NaN, paused: true, seeking: false, target: null };
    Object.defineProperty(win, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} } });
    win.console = silentConsole;
    win.PlayerLocale = { init: async () => true, t: () => '' };
    win.Date.now = () => state.clock;
    Object.defineProperties(video, {
        duration: { get: () => state.duration }, paused: { get: () => state.paused },
        readyState: { get: () => Number.isFinite(state.duration) ? 3 : 0 }, seeking: { get: () => state.seeking },
        currentTime: { get: () => state.time, set: value => {
            if (state.rejectSeek) throw new Error('fixture: media is not seekable yet');
            state.target = value; state.seeking = true;
        } }
    });
    video.play = () => { state.paused = false; video.dispatchEvent(new win.Event('play')); return Promise.resolve(); };
    video.pause = () => { state.paused = true; video.dispatchEvent(new win.Event('pause')); };
    for (const name of ['PlayerSettingsMenu', 'PlayerMediaControls', 'PlayerGhostPreview']) win.eval(read(`src/shared/services/player/${name}.js`));
    win.eval(read('content-scripts/player-cleaner.js'));
    const reports = [];
    win.postMessage = data => reports.push(data);
    win.dispatchEvent(new win.MessageEvent('message', { source: win, origin: win.location.origin,
        data: { type: 'BROADCAST_STATE', startMs: state.clock - 300_000, pausedAtSec: null, admin } }));
    return { dom, win, video, state, reports,
        actions: () => reports.filter(report => report.type === 'BROADCAST_ADMIN_ACTION'),
        finishSeek() {
            state.time = state.target; state.seeking = false;
            video.dispatchEvent(new win.Event('seeked'));
            if (!state.paused) video.dispatchEvent(new win.Event('playing'));
        }
    };
}

for (const admin of [false, true]) test(`late ${admin ? 'admin' : 'viewer'} autoplay with unknown metadata cannot publish a restart at zero`, async () => {
    const h = broadcastJoinHarness(admin);
    try {
        h.state.clock += 2500;
        h.video.play();
        assert.deepEqual(h.actions(), [], 'startup play at zero is local even after the suppression window');
        h.state.duration = 900;
        h.video.dispatchEvent(new h.win.Event('loadedmetadata'));
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.ok(h.state.target >= 302 && h.state.target <= 303);
        h.state.clock += 3000;
        h.finishSeek();
        assert.deepEqual(h.actions(), [], 'a slow programmatic seek is not a global rewind');
        assert.ok(h.state.time >= 300);
        h.state.clock += 2000;
        h.state.time = 120;
        h.video.dispatchEvent(new h.win.Event('seeked'));
        assert.equal(h.actions().length, admin ? 1 : 0);
        if (admin) assert.equal(h.actions()[0].atSec, 120, 'genuine admin controls still publish after alignment');
    } finally { h.dom.window.close(); }
});

test('an in-place source reload makes a previously aligned admin wait for the broadcast position again', async () => {
    const h = broadcastJoinHarness(true);
    try {
        h.state.duration = 900;
        h.video.dispatchEvent(new h.win.Event('loadedmetadata'));
        await new Promise(resolve => setTimeout(resolve, 150));
        h.finishSeek();
        h.state.time = 0; h.state.duration = NaN; h.state.paused = true;
        h.video.dispatchEvent(new h.win.Event('emptied'));
        h.video.dispatchEvent(new h.win.Event('loadstart'));
        h.state.clock += 3000;
        h.video.play();
        assert.deepEqual(h.actions(), []);
        h.state.duration = 900;
        h.video.dispatchEvent(new h.win.Event('loadedmetadata'));
        await new Promise(resolve => setTimeout(resolve, 150));
        h.state.clock += 3000;
        h.finishSeek();
        assert.deepEqual(h.actions(), []);
        assert.ok(h.state.time >= 300);
    } finally { h.dom.window.close(); }
});

test('a seek slower than the admin drift tolerance catches up automatically before the first manual pause', async () => {
    const h = broadcastJoinHarness(true);
    try {
        h.state.duration = 900;
        h.video.dispatchEvent(new h.win.Event('loadedmetadata'));
        await new Promise(resolve => setTimeout(resolve, 150));
        const firstTarget = h.state.target;
        h.state.clock += 12000;
        h.finishSeek();
        assert.equal(h.state.target, firstTarget + 12, 'the late seek immediately requests the up-to-date broadcast position');
        assert.equal(h.state.seeking, true);
        h.finishSeek();
        assert.deepEqual(h.actions(), []);
        h.state.clock += 2000;
        h.video.pause();
        assert.equal(h.state.paused, true, 'the first real pause is not replaced by another startup play');
        assert.equal(h.actions().length, 1);
        assert.equal(h.actions()[0].action, 'pause');
        assert.equal(h.actions()[0].atSec, firstTarget + 12);
    } finally { h.dom.window.close(); }
});

test('a not-yet-seekable admin source retries alignment on canplay without publishing a restart', async () => {
    const h = broadcastJoinHarness(true);
    try {
        h.state.duration = 900; h.state.rejectSeek = true;
        h.video.dispatchEvent(new h.win.Event('loadedmetadata'));
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(h.state.target, null);
        h.state.rejectSeek = false; h.state.clock += 3000;
        h.video.dispatchEvent(new h.win.Event('canplay'));
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(h.state.target, 303);
        h.finishSeek();
        assert.deepEqual(h.actions(), []);
        h.state.clock += 2000;
        h.video.pause();
        assert.equal(h.actions()[0].action, 'pause');
        assert.equal(h.actions()[0].atSec, 303);
    } finally { h.dom.window.close(); }
});

test('cleaner pauses newly attached already-playing admin media while selection is pending', async () => {
    const dom = new JSDOM('<div class="native-player-wrapper"></div>', { url: 'chrome-extension://fixture/player', runScripts: 'outside-only' });
    const win = dom.window;
    Object.defineProperty(win, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} } });
    win.console = silentConsole;
    win.PlayerLocale = { init: async () => true, t: () => '' };
    try {
        for (const name of ['PlayerSettingsMenu', 'PlayerMediaControls', 'PlayerGhostPreview']) win.eval(read(`src/shared/services/player/${name}.js`));
        win.eval(read('content-scripts/player-cleaner.js'));
        win.postMessage = () => {};
        win.dispatchEvent(new win.MessageEvent('message', { source: win, origin: win.location.origin,
            data: { type: 'BROADCAST_STATE', startMs: Date.now() - 100000, admin: true, selection: episode, selectionReady: false } }));
        const video = win.document.createElement('video');
        let paused = false;
        Object.defineProperties(video, { paused: { get: () => paused }, duration: { get: () => 300 }, currentTime: { get: () => 5 } });
        video.pause = () => { paused = true; };
        win.document.querySelector('.native-player-wrapper').append(video);
        await new Promise(resolve => setTimeout(resolve, 1100));
        assert.equal(paused, true, 'pending applies even if play/metadata events happened before listeners were attached');
    } finally { dom.window.close(); }
});

test('allplay play() from our controls starts the provider control until the stream is attached', () => {
    const dom = new JSDOM('<div class="allplay"><button class="allplay__controls__item allplay__control">Play</button><video class="allplay__video"></video></div>',
        { url: 'chrome-extension://fixture/player', runScripts: 'outside-only' });
    const win = dom.window;
    Object.defineProperty(win, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} } });
    win.console = silentConsole;
    win.PlayerLocale = { init: async () => true, t: () => '' };
    const video = win.document.querySelector('video');
    let readyState = 0;
    let duration = 1;
    let directPlays = 0;
    let nativeClicks = 0;
    Object.defineProperties(video, { readyState: { get: () => readyState }, duration: { get: () => duration } });
    win.HTMLMediaElement.prototype.play = () => { directPlays++; return Promise.resolve(); };
    win.HTMLMediaElement.prototype.pause = () => {};
    win.document.querySelector('button').addEventListener('click', () => { nativeClicks++; });
    try {
        for (const name of ['PlayerSettingsMenu', 'PlayerMediaControls', 'PlayerGhostPreview']) {
            win.eval(read(`src/shared/services/player/${name}.js`));
        }
        win.eval(read('content-scripts/player-cleaner.js'));
        win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'BROADCAST_STATE', startMs: win.Date.now() - 1000, admin: true }, source: win, origin: win.location.origin }));
        video.play();
        assert.equal(nativeClicks, 1, 'the placeholder never loads the episode, so the provider control is used');
        assert.equal(directPlays, 0);
        readyState = 4; duration = 3000;
        video.play();
        assert.equal(directPlays, 1, 'an attached stream is played directly');
        assert.equal(nativeClicks, 1);
    } finally { dom.window.close(); }
});
