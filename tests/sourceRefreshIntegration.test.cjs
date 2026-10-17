const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { SourceRefreshCoordinator } = require('../src/shared/services/player/SourceRefreshCoordinator.js');
const root = path.join(__dirname, '..');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const until = async predicate => {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert.fail('owned refresh did not start');
};
function harness(t, { gate, storageGate } = {}) {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const w = dom.window;
    w.SourceRefreshCoordinator = SourceRefreshCoordinator;
    w.eval(fs.readFileSync(path.join(root, 'src/pages/movie-details/WatchEntryPage.js'), 'utf8'));
    const selection = { kinopoiskId: 42, seasonNumber: 1, episodeNumber: 2, initialTimestamp: 10 };
    const runtime = { progressConfidence: 'RELIABLE', currentTime: 83, mediaIdentity: { ...selection } };
    const writes = [];
    const manager = Object.assign({
        sourceSwitchRequestId: 1, sourceRefreshGeneration: 7, selectedMovie: { kinopoiskId: 42 }, refreshes: 0,
        playbackController: {
            getSelection: () => selection, getRuntimeState: () => runtime,
            updateSelection: value => { writes.push(value); Object.assign(selection, value); }
        },
        sourceRefreshCoordinator: new SourceRefreshCoordinator({ storage: storageGate ? {
            get: async () => { await storageGate.promise; return {}; }, set: async () => {}
        } : null }),
        isSourceSwitchRequestCurrent(id, movieId) {
            return id === this.sourceSwitchRequestId && String(movieId) === String(this.selectedMovie.kinopoiskId);
        },
        async forceResearchSources(url, parserId) {
            assert.equal(url, 'parser:animego'); assert.equal(parserId, 'animego');
            this.refreshes++;
            // The real forceResearchSources synchronously begins a new physical request,
            // then asynchronously loads/mounts the replacement under the same logical attempt.
            this.sourceSwitchRequestId++;
            if (gate) await gate.promise;
            return true;
        }
    }, w.MovieDetailsWatchEntryMethods);
    const expire = (extra = {}) => manager.refreshExpiredWatchSource({
        parserId: 'animego', movieId: 42, requestId: manager.sourceSwitchRequestId,
        status: 403, resource: 'manifest', ...extra
    });
    return { w, manager, selection, runtime, writes, expire };
}

test('fresh physical mount shares one refresh budget and repeated 403 enters identity cooldown', async t => {
    const h = harness(t);
    assert.equal(await h.expire(), true, 'owned request replacement is not an external stale switch');
    assert.equal(h.manager.sourceSwitchRequestId, 2);
    assert.equal(await h.expire({ resource: 'key' }), false);
    assert.equal(h.manager.refreshes, 1, 'replacement factory must not start another refresh chain');
    h.manager.sourceRefreshGeneration++;
    h.manager.sourceSwitchRequestId++;
    assert.equal(await h.expire(), false, 'new automatic generation does not bypass media cooldown');
    h.manager.manualRefreshRequestId = h.manager.sourceSwitchRequestId;
    assert.equal(await h.expire(), true, 'explicit retry bypasses cooldown for one bounded refresh');
    assert.equal(await h.expire(), false);
    assert.equal(h.manager.refreshes, 2);
    h.selection.episodeNumber++;
    h.manager.sourceRefreshGeneration++;
    h.manager.sourceSwitchRequestId++;
    assert.equal(await h.expire(), true, 'another canonical episode has an independent budget');
});

test('concurrent expiration callbacks make one owned refresh and replacement failure cannot loop', async t => {
    const gate = deferred();
    const h = harness(t, { gate });
    const first = h.expire();
    const duplicate = h.expire({ resource: 'fragment' });
    await until(() => h.manager.refreshes === 1);
    assert.equal(await h.expire({ resource: 'key' }), false, 'new mount uses the existing logical budget');
    gate.resolve();
    assert.equal(await first, true);
    assert.equal(await duplicate, false, 'old physical callback becomes stale when owned mount takes over');
    assert.equal(h.manager.refreshes, 1);
});

test('episode/manual/movie/room changes before refresh work suppress the stale mount', async t => {
    for (const change of ['episode', 'manual', 'movie', 'room']) {
        const storageGate = deferred();
        const h = harness(t, { storageGate });
        const pending = h.expire();
        if (change === 'episode') h.selection.episodeNumber++;
        if (change === 'manual') { h.manager.sourceRefreshGeneration++; h.manager.sourceSwitchRequestId++; }
        if (change === 'movie') h.manager.selectedMovie.kinopoiskId = 43;
        if (change === 'room') h.manager.watchRoomController = { room: {} };
        storageGate.resolve();
        assert.equal(await pending, false, change);
        assert.equal(h.manager.refreshes, 0, `${change} must prevent refresh from starting`);
    }
});

test('external changes during refresh invalidate completion while owned request alone remains valid', async t => {
    for (const change of ['episode', 'manual', 'room']) {
        const gate = deferred(); const h = harness(t, { gate });
        const pending = h.expire(); await until(() => h.manager.refreshes === 1);
        if (change === 'episode') h.selection.episodeNumber++;
        else if (change === 'manual') { h.manager.sourceRefreshGeneration++; h.manager.sourceSwitchRequestId++; }
        else h.manager.watchRoomController = { room: {} };
        gate.resolve(); assert.equal(await pending, false, change);
    }
});

test('only reliable runtime matching canonical movie and episode is restored', async t => {
    for (const mismatch of [null, 'movie', 'episode', 'confidence']) {
        const h = harness(t);
        if (mismatch === 'movie') h.runtime.mediaIdentity.kinopoiskId = 43;
        if (mismatch === 'episode') h.runtime.mediaIdentity.episodeNumber = 3;
        if (mismatch === 'confidence') h.runtime.progressConfidence = 'ESTIMATED';
        assert.equal(await h.expire(), true);
        assert.equal(h.writes.length, mismatch ? 0 : 1);
        assert.equal(h.selection.initialTimestamp, mismatch ? 10 : 83);
    }
});

test('actual factory intercepts nonfatal key/fragment expiration, coalesces errors and preserves local/policy rules', async t => {
    const h = harness(t);
    h.w.UrlPolicy = { check() {}, kindOf() {} };
    h.w.HlsPolicyLoader = { forProfile: () => class OwnedLoader {} };
    h.w.eval(fs.readFileSync(path.join(root, 'src/shared/services/player/HlsPlaybackFactory.js'), 'utf8'));
    class FakeHls {
        static isSupported() { return true; }
        static Events = { ERROR: 'error', DESTROYING: 'destroying' };
        constructor() { this.handlers = new Map(); this.stops = 0; this.destroyed = false; }
        on(event, callback) { this.handlers.set(event, callback); }
        emit(data) { this.handlers.get('error')?.('error', data); }
        loadSource() {} attachMedia() {}
        stopLoad() { this.stops++; }
        destroy() { this.destroyed = true; this.handlers.get('destroying')?.(); }
    }
    const gate = deferred(); let expired = 0; const fatal = [];
    const video = h.w.document.createElement('video');
    const instance = h.w.HlsPlaybackFactory.create(video, 'https://video.solodcdn.com/master.m3u8', {
        Hls: FakeHls, onSourceExpired: async ({ resource }) => {
            assert.equal(resource, 'key'); expired++; await gate.promise; return false;
        }, onFatal: info => { fatal.push(info.reason); return true; }
    });
    instance.emit({ fatal: false, type: 'networkError', details: 'keyLoadError', response: { code: 403 } });
    instance.emit({ fatal: true, type: 'networkError', details: 'fragLoadError', response: { code: 403 } });
    await until(() => expired === 1);
    assert.equal(fatal.length, 0, 'no fallback while refresh is pending');
    gate.resolve(); await until(() => fatal.length === 1);
    assert.deepEqual(fatal, ['source-rejected']);
    instance.destroy();
    let fragments = 0;
    const fragment = h.w.HlsPlaybackFactory.create(video, 'https://video.solodcdn.com/master.m3u8', {
        Hls: FakeHls, onSourceExpired: async ({ resource, status }) => {
            assert.equal(resource, 'fragment'); assert.equal(status, 410); fragments++; return true;
        }, onFatal: info => { fatal.push(info.reason); return true; }
    });
    fragment.emit({ fatal: false, type: 'networkError', details: 'fragLoadError', response: { code: 410 } });
    await until(() => fragments === 1);
    await Promise.resolve();
    assert.equal(fatal.length, 1, 'successful fragment refresh does not emit an extra fallback');
    fragment.destroy();
    let unexpected = 0;
    const policy = h.w.HlsPlaybackFactory.create(video, 'https://video.solodcdn.com/master.m3u8', {
        Hls: FakeHls, onSourceExpired: () => { unexpected++; }, onFatal: () => true
    });
    policy.emit({ fatal: false, details: 'keyLoadError', response: { code: 403, text: 'POLICY_VIOLATION' } });
    assert.equal(policy.destroyed, true); assert.equal(unexpected, 0);
    const local = h.w.HlsPlaybackFactory.create(video, 'http://127.0.0.1:3000/hls/master.m3u8', {
        Hls: FakeHls, networkProfile: 'local', policy: 'persistent', onSourceExpired: () => { unexpected++; }
    });
    local.emit({ fatal: false, type: 'networkError', details: 'fragLoadError', response: { code: 503 } });
    assert.equal(unexpected, 0); local.destroy();
});
