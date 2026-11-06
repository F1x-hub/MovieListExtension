const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<div id="sources"></div>', { runScripts: 'outside-only' });
const w = dom.window;
for (const file of ['src/shared/services/player/WatchSourcePolicy.js', 'src/pages/movie-details/WatchEntryPage.js']) {
    w.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
}
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
let prefs = null;
let saves = 0;
w.chrome = { storage: { local: {
    get: async () => ({ watchPrefs_42: prefs && { innerId: prefs } }),
    set: async () => { saves++; }
} } };

function manager() {
    const values = ['parser:exfs', 'parser:animego', 'parser:rutube', 'vidsrc:tt42', 'https://example.test/embed', 'mediaplayer:torrent'];
    const container = w.document.createElement('div');
    for (const value of values) {
        const button = w.document.createElement('button');
        button.className = 'source-btn'; button.dataset.value = value; container.append(button);
    }
    const instance = Object.assign({
        proPlayerEnabled: true, selectedMovie: { kinopoiskId: 42, type: 'anime' },
        sourceSwitchRequestId: 1, activeSourceValue: null, elements: { sourceButtonsContainer: container },
        getLastSource: async () => null, isTorrentMovie: () => false, postToPlayerFrame: () => true,
        isSourceSwitchRequestCurrent(id) { return id === this.sourceSwitchRequestId; },
        changes: [],
        async changeVideoSource(value) {
            this.changes.push(value);
            this.activeSourceValue = value;
            this.sourceSwitchRequestId++;
            this.watchSourceRun.requestId = this.sourceSwitchRequestId;
            this.watchSourceRun.attempted.add(value);
            return true;
        }
    }, w.MovieDetailsWatchEntryMethods);
    return instance;
}
function start(instance, manual = false) {
    instance.activeSourceValue = 'parser:exfs';
    instance.watchSourceRun = w.WatchSourcePolicy.createRun(42, manual);
}

(async () => {
    const m = manager();
    prefs = 'parser:rutube'; m.getLastSource = async () => 'vidsrc:tt42';
    m.activeSourceValue = 'https://example.test/embed';
    m.watchRoomController = { room: {}, activeProviderHint: 'animego' };
    assert.equal(await m.resolveWatchSource(), 'parser:animego', 'room wins over explicit selection');
    m.watchRoomController = null;
    assert.equal(await m.resolveWatchSource(), 'https://example.test/embed', 'explicit URL wins over stored choices');
    m.activeSourceValue = null;
    assert.equal(await m.resolveWatchSource(), 'parser:rutube', 'preference wins over last source');
    prefs = null;
    assert.equal(await m.resolveWatchSource(), 'parser:animego', 'VidSrc as the last source may only be where a failed run ended');
    m.getLastSource = async () => 'parser:exfs';
    assert.equal(await m.resolveWatchSource(), 'parser:exfs', 'last source wins over anime default');
    m.getLastSource = async () => null;
    assert.equal(await m.resolveWatchSource(), 'parser:animego');
    m.selectedMovie.type = 'film';
    assert.equal(await m.resolveWatchSource(), 'parser:exfs', 'ordinary default preserves existing button order');
    const wait = deferred(); m.getLastSource = () => wait.promise;
    const stale = m.resolveWatchSource(); m.sourceSwitchRequestId++; wait.resolve('parser:rutube');
    assert.equal(await stale, null, 'source switch invalidates pending storage resolution');
    const movieWait = deferred(); m.getLastSource = () => movieWait.promise;
    const oldMovie = m.resolveWatchSource(); m.selectedMovie = { kinopoiskId: 43 }; movieWait.resolve(null);
    assert.equal(await oldMovie, null, 'movie change invalidates pending storage resolution');

    for (const guard of ['manual', 'room', 'timeout', 'stale']) {
        const item = manager(); start(item, guard === 'manual');
        if (guard === 'room') item.watchRoomController = { room: {} };
        assert.equal(await item.handleWatchSourceFailure('parser:exfs', guard === 'stale' ? 0 : 1, guard === 'timeout' ? 'timeout' : 'error'), false);
        assert.equal(item.changes.length, 0, `${guard} prevents automatic fallback`);
    }
    const duplicate = manager(); start(duplicate);
    const gate = deferred(); const change = duplicate.changeVideoSource;
    duplicate.changeVideoSource = async function(value) { await gate.promise; return change.call(this, value); };
    const first = duplicate.handleWatchSourceFailure('parser:exfs', 1);
    assert.equal(await duplicate.handleWatchSourceFailure('parser:exfs', 1), false);
    gate.resolve(); assert.equal(await first, true);
    assert.deepEqual(duplicate.changes, ['parser:animego'], 'duplicate runtime failure makes one switch');
    assert.equal(await duplicate.handleWatchSourceFailure('parser:exfs', 1), false);

    const exhausted = manager(); start(exhausted);
    const mount = exhausted.changeVideoSource;
    exhausted.changeVideoSource = async function(value) { await mount.call(this, value); return false; };
    assert.equal(await exhausted.handleWatchSourceFailure('parser:exfs', 1), false);
    assert.equal(exhausted.changes.length, 4, 'each remaining non-torrent candidate attempted once');
    assert.equal(new Set(exhausted.changes).size, 4);
    assert.equal(exhausted.watchSourceRun.switching, false);

    const superseded = manager(); start(superseded);
    const pending = deferred();
    superseded.changeVideoSource = async function(value) { this.changes.push(value); await pending.promise; return false; };
    const automatic = superseded.handleWatchSourceFailure('parser:exfs', 1);
    superseded.watchSourceRun = w.WatchSourcePolicy.createRun(42, true);
    superseded.sourceSwitchRequestId++;
    pending.resolve(); assert.equal(await automatic, false);
    assert.equal(superseded.changes.length, 1, 'manual run replacement stops further automatic attempts');

    const alternative = manager(); start(alternative, true);
    alternative.tryOtherWatchSource();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(alternative.watchSourceRun.manual, false, 'explicit try-other starts a fresh automatic run');
    assert.deepEqual(alternative.changes, ['parser:animego']);

    for (const confidence of ['RELIABLE', 'ESTIMATED']) {
        const resume = manager(); start(resume);
        const selection = { kinopoiskId: 42, seasonNumber: 2, episodeNumber: 3, initialTimestamp: 12 };
        const updates = [];
        resume.playbackController = {
            getSelection: () => selection,
            getRuntimeState: () => ({ progressConfidence: confidence, currentTime: 83, mediaIdentity: { ...selection } }),
            updateSelection: update => { updates.push(update); Object.assign(selection, update); }
        };
        await resume.handleWatchSourceFailure('parser:exfs', 1);
        assert.equal(updates.length, confidence === 'RELIABLE' ? 1 : 0);
        assert.equal(selection.initialTimestamp, confidence === 'RELIABLE' ? 83 : 12);
        assert.equal(selection.seasonNumber, 2); assert.equal(selection.episodeNumber, 3);
    }
    assert.equal(saves, 0, 'resolver and automatic fallback do not write watch preferences');

    const wrongEpisode = manager(); start(wrongEpisode);
    let wrongUpdates = 0;
    wrongEpisode.playbackController = {
        getSelection: () => ({ kinopoiskId: 42, seasonNumber: 2, episodeNumber: 3 }),
        getRuntimeState: () => ({ progressConfidence: 'RELIABLE', currentTime: 83,
            mediaIdentity: { kinopoiskId: 42, seasonNumber: 2, episodeNumber: 4 } }),
        updateSelection: () => { wrongUpdates++; }
    };
    await wrongEpisode.handleWatchSourceFailure('parser:exfs', 1);
    assert.equal(wrongUpdates, 0, 'reliable progress from another episode must not be copied');

    let callbacks;
    w.WatchEntryController = class {
        constructor(options) { callbacks = options; }
        sync() {}
    };
    const alias = manager(); let activations = 0;
    alias.handleWatchClick = async () => { activations++; };
    alias.syncWatchEntry();
    await callbacks.onWatch('vidsrc:tt42');
    assert.equal(alias.activeSourceValue, 'vidsrc:tt42');
    assert.equal(activations, 1, 'alias uses the canonical watch activation path');
    assert.equal(alias.changes.length, 0, 'alias cannot bypass source resolution by directly mounting');
    await callbacks.onWatch('https://obsolete.test/embed');
    assert.equal(alias.activeSourceValue, 'vidsrc:tt42', 'obsolete alias cannot replace the explicit source');
    assert.equal(saves, 0, 'alias activation does not write preferences');

    const activation = deferred(); let calls = 0;
    // A title-only provider opens on its own first episode: it has to be told.
    const episodeSync = ({ seasonNumber = 1, episodeNumber = 2, source = 'PLAYER_NAVIGATION', mode = 'NATIVE_BRIDGE', applyResult = true, bridgeSupportsFrame } = {}) => {
        const container = w.document.createElement('div');
        const frame = w.document.createElement('iframe');
        frame.src = 'https://balancer.test/embed/1';
        container.append(frame);
        w.document.body.append(container);
        const selection = { kinopoiskId: 42, seasonNumber, episodeNumber, source };
        const applies = [];
        const adapter = {
            getSelectionMode: () => mode,
            async applySelection(requested, options) { applies.push({ requested, options }); return typeof applyResult === 'function' ? applyResult() : applyResult; }
        };
        if (bridgeSupportsFrame !== undefined) adapter.supportsNativeBridgeSource = () => bridgeSupportsFrame;
        const states = [];
        const started = [];
        let unmounted = 0;
        const instance = Object.assign({
            elements: { videoContainer: container }, sourceSwitchRequestId: 7, selectedMovie: { kinopoiskId: 42 },
            playbackController: { getSelection: () => selection, getAdapter: id => (id === 'exfs' ? adapter : null) },
            isSourceSwitchRequestCurrent(id) { return id === this.sourceSwitchRequestId; },
            postToPlayerFrame(target, message) { started.push([target, message.type]); return true; },
            unmountActivePlayer() { unmounted++; },
            setPlayerSourceState(state, options) { states.push({ state, ...options }); }
        }, w.MovieDetailsWatchEntryMethods);
        return { instance, applies, states, started, adapter, frame, container, selection, unmounted: () => unmounted };
    };
    const sync = fixture => fixture.instance.syncNativeProviderEpisode('exfs', 7, '42');

    {
        const later = episodeSync();
        assert.equal(await sync(later), true, 'a later episode is sent to the provider frame');
        assert.deepEqual(later.started, [[later.frame, 'PLAYER_START']], 'and started: moving it there leaves its video idle');
        assert.equal(later.applies.length, 1);
        assert.equal(later.applies[0].requested, later.selection);
        assert.equal(later.applies[0].options.waitForBridge, true, 'the frame is still loading, so the bridge has to wait for it');
        assert.equal(later.adapter.activeContainer, later.container);
        assert.deepEqual(later.states, []);
    }
    for (const source of ['HERO_WATCH', 'PROVIDER_SWITCH']) {
        const first = episodeSync({ episodeNumber: 1, source });
        assert.equal(await sync(first), false);
        assert.equal(first.applies.length, 0, `${source} on S1E1 is where the frame opens anyway; pressing it would restart the stream`);
    }
    const backToFirst = episodeSync({ episodeNumber: 1, source: 'PLAYER_NAVIGATION' });
    await sync(backToFirst);
    assert.equal(backToFirst.applies.length, 1, 'a viewer who asked for S1E1 is taken there');
    const resume = episodeSync({ seasonNumber: 3, episodeNumber: 5, source: 'HERO_WATCH' });
    await sync(resume);
    assert.equal(resume.applies.length, 1, '«Смотреть» resuming a later episode needs it too');
    const direct = episodeSync({ mode: 'DIRECT' });
    assert.equal(await sync(direct), false);
    assert.equal(direct.applies.length, 0, 'a provider addressed directly already got the episode');
    const inRoom = episodeSync();
    inRoom.instance.watchRoomController = { room: {} };
    await sync(inRoom);
    assert.equal(inRoom.applies.length, 0, 'a watch room keeps its own selection flow');
    const broadcast = episodeSync();
    broadcast.instance.broadcastEpisode = { seasonNumber: 1, episodeNumber: 2 };
    await sync(broadcast);
    assert.equal(broadcast.applies.length, 0, 'a broadcast confirms its own episode');

    {
        const pending = deferred();
        const moving = episodeSync({ applyResult: () => pending.promise });
        const running = sync(moving);
        const { instance } = moving;
        assert.equal(instance.isStaleNativeProviderReport(1, 1), true, 'while moving to S1E2, the frame reporting S1E1 says nothing about the viewer');
        assert.equal(instance.isStaleNativeProviderReport(1, 2), false, 'the requested episode is not stale');
        instance.sourceSwitchRequestId = 8;
        assert.equal(instance.isStaleNativeProviderReport(1, 1), false, 'a later source switch owns its own reports');
        instance.sourceSwitchRequestId = 7;
        pending.resolve(true);
        await running;
        assert.equal(instance.isStaleNativeProviderReport(1, 1), false, 'once confirmed, the provider is free to report again');
    }
    {
        const refused = episodeSync({ applyResult: false });
        assert.equal(await sync(refused), false);
        assert.equal(refused.unmounted(), 1, 'another episode must not keep playing under this one\'s name');
        assert.equal(refused.states[0].state, 'unavailable');
        assert.match(refused.states[0].message, /не смог открыть эту серию/);
    }
    {
        const noBridge = episodeSync({ bridgeSupportsFrame: false });
        assert.equal(await sync(noBridge), false);
        assert.equal(noBridge.applies.length, 0, 'a balancer without episode selectors is not asked');
        assert.equal(noBridge.states[0].state, 'unavailable', 'and the viewer is told at once');
    }
    {
        const moved = deferred();
        const stale = episodeSync({ applyResult: () => moved.promise });
        const running = sync(stale);
        stale.instance.sourceSwitchRequestId = 8;
        moved.resolve(false);
        await running;
        assert.deepEqual(stale.states, [], 'a failure of an abandoned attempt changes nothing');
        assert.equal(stale.unmounted(), 0);
    }
    {
        const failedAnyway = deferred();
        const dead = episodeSync({ applyResult: () => failedAnyway.promise });
        const running = sync(dead);
        dead.container.dataset.sourceState = 'unavailable';
        failedAnyway.resolve(false);
        await running;
        assert.deepEqual(dead.states, [], 'a source that already said it cannot play keeps its own message');
    }
    {
        const another = deferred();
        const moved = episodeSync({ applyResult: () => another.promise });
        const running = sync(moved);
        moved.selection.episodeNumber = 3;
        another.resolve(false);
        await running;
        assert.deepEqual(moved.states, [], 'neither does a failure for an episode the viewer has left');
    }

    class Manager {
        constructor() { this.proPlayerEnabled = true; this.elements = {}; }
        async handleWatchClick() { calls++; await activation.promise; return true; }
    }
    w.installMovieDetailsWatchEntry(Manager);
    const installed = new Manager();
    const active = installed.handleWatchClick();
    assert.equal(await installed.handleWatchClick(), false, 'installed orchestration deduplicates activation');
    activation.resolve(); assert.equal(await active, true);
    assert.equal(calls, 1); assert.equal(installed.watchActivationPending, false);
    console.log('Watch entry page: priority, stale reads, fallback guards/deduplication/exhaustion, manual races, reliable resume and activation deduplication passed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => w.close());
