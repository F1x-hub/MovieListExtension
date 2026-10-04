const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const factorySource = fs.readFileSync(
    path.join(__dirname, '../src/shared/services/player/HlsPlaybackFactory.js'),
    'utf8'
);

const storage = new Map();
const localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
};
const context = vm.createContext({ console, setTimeout, clearTimeout, CustomEvent, EventTarget, localStorage });
vm.runInContext(factorySource, context);
const factory = context.HlsPlaybackFactory;
assert.ok(factory, 'HlsPlaybackFactory must be exported');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class FakeHls {
    static Events = { ERROR: 'hlsError', DESTROYING: 'hlsDestroying', MANIFEST_PARSED: 'hlsManifestParsed', FRAG_LOADED: 'hlsFragLoaded' };
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError', OTHER_ERROR: 'otherError' };
    static isSupported() { return true; }
    constructor(config) {
        this.config = config;
        this.listeners = new Map();
        this.calls = [];
        FakeHls.last = this;
    }
    on(event, handler) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event).push(handler);
    }
    emit(event, data) {
        (this.listeners.get(event) || []).forEach(handler => handler(event, data));
    }
    loadSource(url) { this.calls.push(['loadSource', url]); }
    attachMedia() { this.calls.push(['attachMedia']); }
    startLoad(position) { this.calls.push(['startLoad', position]); }
    stopLoad() { this.calls.push(['stopLoad']); }
    recoverMediaError() { this.calls.push(['recoverMediaError']); }
    swapAudioCodec() { this.calls.push(['swapAudioCodec']); }
    destroy() { this.emit(FakeHls.Events.DESTROYING); this.calls.push(['destroy']); }
    count(name) { return this.calls.filter(call => call[0] === name).length; }
}

const networkError = (details, fatal = true, code = 0) => ({
    type: FakeHls.ErrorTypes.NETWORK_ERROR,
    details,
    fatal,
    response: code ? { code } : undefined
});
const mediaError = () => ({ type: FakeHls.ErrorTypes.MEDIA_ERROR, details: 'bufferStalledError', fatal: true });

function setup(options = {}) {
    const video = new EventTarget();
    const events = [];
    video.addEventListener(factory.HLS_FATAL_EVENT, event => events.push(['fatal', event.detail]));
    video.addEventListener(factory.HLS_RETRY_EVENT, event => events.push(['retry', event.detail]));
    const fatals = [];
    const retries = [];
    const hls = factory.create(video, 'https://cdn.test/master.m3u8', {
        Hls: FakeHls,
        retryBaseDelayMs: 2,
        onFatal: info => { fatals.push(info.reason); return options.handled === true; },
        onRetryScheduled: info => retries.push(info.delaySeconds),
        ...options
    });
    return { video, hls, events, fatals, retries };
}

(async () => {
    // Defaults and load order.
    {
        const { hls } = setup();
        assert.equal(hls.config.enableWorker, true, 'workers stay enabled by default');
        assert.deepEqual(hls.calls.map(call => call[0]), ['loadSource', 'attachMedia']);
        const attachFirst = setup({ attachFirst: true }).hls;
        assert.deepEqual(attachFirst.calls.map(call => call[0]), ['attachMedia', 'loadSource']);
        assert.equal(factory.create(new EventTarget(), 'x', { Hls: { isSupported: () => false } }), null,
            'unsupported hls.js must return null so callers can use native HLS');
    }

    // Expired / forbidden manifest fails immediately (no pointless retries).
    {
        const { hls, fatals, events, retries } = setup();
        hls.emit('hlsError', networkError('manifestLoadError', true, 403));
        assert.deepEqual(fatals, ['source-rejected']);
        assert.equal(retries.length, 0);
        assert.equal(events.filter(event => event[0] === 'fatal').length, 1, 'unhandled fatal must be dispatched on the video');
    }

    // A handled fatal (source fallback) must not be re-reported to outer watchers.
    {
        const { hls, fatals, events } = setup({ handled: true });
        hls.emit('hlsError', networkError('manifestLoadError', true, 404));
        assert.deepEqual(fatals, ['source-rejected']);
        assert.equal(events.filter(event => event[0] === 'fatal').length, 0);
    }

    // Bounded network recovery: backoff retries, then a single fatal.
    {
        const { hls, fatals, retries, events } = setup({ maxNetworkRetries: 2 });
        hls.emit('hlsError', networkError('fragLoadError'));
        assert.deepEqual(retries, [1]);
        assert.equal(events.filter(event => event[0] === 'retry').length, 1, 'retries extend lifecycle timeouts');
        await delay(10);
        assert.equal(hls.count('startLoad'), 1, 'fragment errors resume loading');
        assert.deepEqual(hls.calls.find(call => call[0] === 'startLoad'), ['startLoad', -1]);
        hls.emit('hlsError', networkError('fragLoadError'));
        assert.deepEqual(retries, [1, 2]);
        await delay(15);
        hls.emit('hlsError', networkError('fragLoadError'));
        assert.deepEqual(fatals, ['network-retries-exhausted']);
        hls.emit('hlsError', networkError('fragLoadError'));
        assert.equal(fatals.length, 1, 'a failed stream reports fatal once');
    }

    // Manifest timeouts reload the manifest (startLoad alone would not).
    {
        const { hls } = setup();
        hls.emit('hlsError', networkError('manifestLoadTimeOut'));
        await delay(10);
        assert.equal(hls.count('loadSource'), 2);
        assert.equal(hls.count('startLoad'), 0);
    }

    // Non-fatal errors are left to hls.js under the bounded policy.
    {
        const { hls, retries, fatals } = setup();
        hls.emit('hlsError', networkError('fragLoadError', false, 503));
        assert.equal(retries.length, 0);
        assert.equal(fatals.length, 0);
    }

    // Persistent (torrent) policy: never gives up on the network; 5xx retries even when non-fatal.
    {
        const { hls, fatals, retries } = setup({ policy: 'persistent', maxNetworkRetries: 1 });
        for (let attempt = 0; attempt < 5; attempt += 1) {
            hls.emit('hlsError', networkError('fragLoadError', attempt % 2 === 0, 503));
            await delay(20);
        }
        assert.equal(fatals.length, 0, 'torrent streams keep retrying while buffering');
        assert.equal(retries.length, 5);
        assert.deepEqual(retries.slice(0, 4), [1, 2, 4, 8], 'backoff is capped at 8 units');
    }

    // Media errors: recover twice, swap audio codec once, then fail.
    {
        const { hls, fatals } = setup();
        hls.emit('hlsError', mediaError());
        hls.emit('hlsError', mediaError());
        assert.equal(hls.count('recoverMediaError'), 2);
        hls.emit('hlsError', mediaError());
        assert.equal(hls.count('swapAudioCodec'), 1);
        assert.equal(hls.count('recoverMediaError'), 3);
        hls.emit('hlsError', mediaError());
        assert.deepEqual(fatals, ['media-recovery-exhausted']);
    }

    // Playback resets the budget and reports recovery.
    {
        let recovered = 0;
        const { hls, video, fatals } = setup({ maxNetworkRetries: 1, onRecovered: () => { recovered += 1; } });
        hls.emit('hlsError', networkError('fragLoadError'));
        await delay(10);
        video.dispatchEvent(new Event('playing'));
        assert.equal(recovered, 1);
        hls.emit('hlsError', networkError('fragLoadError'));
        assert.equal(fatals.length, 0, 'retry budget restarts after playback resumes');
    }

    // Destroy cancels a pending retry; stale players ignore errors.
    {
        const { hls } = setup();
        hls.emit('hlsError', networkError('fragLoadError'));
        hls.destroy();
        await delay(10);
        assert.equal(hls.count('startLoad'), 0, 'destroyed instance must not resume loading');

        let current = true;
        const stale = setup({ isCurrent: () => current });
        current = false;
        stale.hls.emit('hlsError', networkError('manifestLoadError', true, 403));
        assert.equal(stale.fatals.length, 0, 'a replaced player must not report errors');
    }

    // Quality/buffer defaults; caller config still wins.
    {
        storage.clear();
        const { hls } = setup();
        assert.equal(hls.config.capLevelToPlayerSize, true, 'renditions are capped to the player size');
        assert.equal(hls.config.backBufferLength, 90, 'played-back buffer is bounded');
        assert.equal(hls.config.maxMaxBufferLength, 120);
        assert.equal(hls.config.abrEwmaDefaultEstimate, undefined, 'no estimate without a measurement');
        const overridden = setup({ config: { capLevelToPlayerSize: false, backBufferLength: 10 } }).hls;
        assert.equal(overridden.config.capLevelToPlayerSize, false);
        assert.equal(overridden.config.backBufferLength, 10);
    }

    // Bandwidth memory: provider streams persist and reuse the measured estimate.
    {
        storage.clear();
        const first = setup().hls;
        first.bandwidthEstimate = 500_000;
        first.destroy();
        assert.equal(storage.size, 0, 'nothing is stored before a fragment was actually measured');

        const measured = setup().hls;
        measured.bandwidthEstimate = 12_000_000;
        measured.emit('hlsFragLoaded');
        measured.destroy();
        const saved = JSON.parse(storage.get(factory.BANDWIDTH_STORAGE_KEY));
        assert.equal(saved.bps, 12_000_000);

        const next = setup().hls;
        assert.equal(next.config.abrEwmaDefaultEstimate, 12_000_000, 'the next stream starts from the last estimate');

        storage.set(factory.BANDWIDTH_STORAGE_KEY, JSON.stringify({ bps: 12_000_000, measuredAt: Date.now() - 8 * 24 * 3600 * 1000 }));
        assert.equal(setup().hls.config.abrEwmaDefaultEstimate, undefined, 'stale estimates are ignored');

        storage.set(factory.BANDWIDTH_STORAGE_KEY, 'not-json');
        assert.equal(setup().hls.config.abrEwmaDefaultEstimate, undefined, 'corrupt storage is ignored');

        storage.clear();
        const absurd = setup().hls;
        absurd.bandwidthEstimate = 5e9;
        absurd.emit('hlsFragLoaded');
        absurd.destroy();
        assert.equal(storage.size, 0, 'implausible estimates are not stored');
    }

    // Local torrent throughput must not skew remote provider estimates.
    {
        storage.clear();
        const torrent = setup({ policy: 'persistent' }).hls;
        torrent.bandwidthEstimate = 150_000_000;
        torrent.emit('hlsFragLoaded');
        torrent.destroy();
        assert.equal(storage.size, 0, 'torrent sessions do not persist bandwidth');
        storage.set(factory.BANDWIDTH_STORAGE_KEY, JSON.stringify({ bps: 9_000_000, measuredAt: Date.now() }));
        assert.equal(setup({ policy: 'persistent' }).hls.config.abrEwmaDefaultEstimate, undefined,
            'torrent sessions do not consume the provider estimate');
        assert.equal(setup({ policy: 'persistent' }).hls.config.capLevelToPlayerSize, true);
    }

    console.log('✅ HlsPlaybackFactory recovery tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
