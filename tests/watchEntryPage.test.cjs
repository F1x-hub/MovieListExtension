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
        getLastSource: async () => null, isTorrentMovie: () => false,
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
    assert.equal(await m.resolveWatchSource(), 'vidsrc:tt42', 'last source wins over anime default');
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
