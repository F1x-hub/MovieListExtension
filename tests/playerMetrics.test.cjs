const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerMetrics.js'), 'utf8');
function harness(seed = {}) {
    let saved = seed;
    let clock = 100;
    let date = 100 * 86400000;
    const scope = { performance: { now: () => clock }, Date: { now: () => date }, chrome: { storage: { local: {
        get: async () => { await Promise.resolve(); return structuredClone(saved); },
        set: async data => { await Promise.resolve(); saved = structuredClone(data); }
    } } } };
    vm.runInNewContext(source, scope);
    return { scope, metrics: scope.PlayerMetrics, stored: () => saved, time: value => { clock = value; }, date: value => { date = value * 86400000; } };
}
test('serial records and reset preserve invocation order', async () => {
    const { metrics } = harness();
    await Promise.all(Array.from({ length: 12 }, () => metrics.record('resolveOk', { providerId: 'animego' })));
    assert.equal((await metrics.report()).counters[0].count, 12);
    const before = metrics.record('fallback');
    const reset = metrics.reset();
    const after = metrics.record('resolveFail');
    await Promise.all([before, reset, after]);
    const result = await metrics.report();
    assert.equal(result.counters.length, 1);
    assert.equal(result.counters[0].type, 'resolveFail');
});

test('shared origin lock preserves counters and reset ordering across page contexts', async () => {
    let saved = {};
    let lockTail = Promise.resolve();
    const order = [];
    const locks = { request(name, task) {
        assert.equal(name, 'movieExtension.playerMetricsV1');
        const next = lockTail.then(task, task);
        lockTail = next.catch(() => {});
        return next;
    } };
    const storage = {
        get: async () => { const snapshot = structuredClone(saved); await new Promise(resolve => setTimeout(resolve, 1)); return snapshot; },
        set: async value => { await new Promise(resolve => setTimeout(resolve, 1)); saved = structuredClone(value); }
    };
    function page() {
        const scope = { navigator: { locks }, Date: { now: () => 100 * 86400000 }, chrome: { storage: { local: storage } } };
        vm.runInNewContext(source, scope);
        return scope.PlayerMetrics;
    }
    const first = page();
    const second = page();
    await Promise.all([first.record('resolveOk', { providerId: 'animego' }), second.record('resolveOk', { providerId: 'animego' })]);
    assert.equal((await first.report()).counters[0].count, 2, 'separate page queues cannot lose a concurrent update');
    const before = first.record('fallback').then(() => order.push('before'));
    await Promise.resolve();
    const reset = second.reset().then(() => order.push('reset'));
    await Promise.resolve();
    const after = first.record('resolveFail').then(() => order.push('after'));
    await Promise.all([before, reset, after]);
    assert.deepEqual(order, ['before', 'reset', 'after']);
    const report = await second.report();
    assert.equal(report.counters.length, 1);
    assert.equal(report.counters[0].type, 'resolveFail');
});
test('closed schema strips attacker text, old days, oversized counts, getters and identifiers', async () => {
    const key = 'movieExtension.playerMetricsV1';
    const h = harness({ [key]: { days: { 92: { 'animego:resolveOk:unknown': 2 }, 100: { 'animego:resolveOk:unknown': Infinity, 'https://private/token:resolveOk:unknown': 1 } }, title: 'private' } });
    await h.metrics.record('fallback', { providerId: 'https://private/uid', reason: 'signed-url-token', title: 'private', selection: { uid: 'private' } });
    await h.metrics.record('resolveFail', { get providerId() { throw Error('secret'); } });
    assert.equal(await h.metrics.record('https://private/token'), false);
    const text = JSON.stringify(await h.metrics.report());
    assert.ok(!text.includes('private'));
    assert.ok(!JSON.stringify(h.stored()).includes('private'));
    assert.ok(text.includes('unknown'));
    h.date(108);
    assert.equal((await h.metrics.report()).counters.length, 0);
});
test('timings aggregate exact, approximate and unknown separately and clamp values', async () => {
    const { metrics } = harness();
    await metrics.record('ttff', { providerId: 'parser:animego', durationMs: 100 });
    await metrics.record('ttff', { providerId: 'animego', durationMs: 200 });
    await metrics.record('ttff', { durationMs: 1e20, approximate: true });
    await metrics.record('ttff', {});
    const result = await metrics.report();
    assert.equal(result.ttff.find(value => value.quality === 'exact').meanMs, 150);
    assert.equal(result.ttff.find(value => value.quality === 'approximate').maxMs, 300000);
    assert.equal(result.ttff.find(value => value.quality === 'unknown').meanMs, null);
});
test('frame callback is exact, fallback approximate, disposer and stale sessions prevent recording', async () => {
    const h = harness();
    let frame;
    let cancelled;
    const video = { requestVideoFrameCallback: fn => { frame = fn; return 7; }, cancelVideoFrameCallback: id => { cancelled = id; } };
    h.metrics.attach(video, { providerId: 'animego', startAt: 50 });
    h.time(150); frame(); frame();
    assert.equal((await h.metrics.report()).ttff[0].meanMs, 100);
    assert.equal(cancelled, 7);
    const dispose = h.metrics.attach(video, { isCurrent: () => false });
    frame(); dispose();
    let loaded;
    const fallback = { addEventListener: (_, fn) => { loaded = fn; }, removeEventListener() {} };
    h.metrics.attach(fallback, { startAt: 100 }); loaded();
    const result = await h.metrics.report();
    assert.equal(result.ttff.reduce((sum, entry) => sum + entry.count, 0), 2);
    assert.equal(result.ttff.find(value => value.quality === 'approximate').meanMs, 50);
    h.metrics.attach(null);
    assert.equal((await h.metrics.report()).ttff.find(value => value.quality === 'unknown').meanMs, null);
});

function primaryVideo(overrides = {}) {
    const events = new Map();
    let callback;
    return {
        tagName: 'VIDEO', dataset: {}, ownerDocument: { location: { protocol: 'chrome-extension:' } },
        readyState: 2, paused: false, seeking: false, ended: false,
        addEventListener(type, listener) {
            if (!events.has(type)) events.set(type, new Set());
            events.get(type).add(listener);
        },
        removeEventListener(type, listener) { events.get(type)?.delete(listener); },
        dispatch(type) { for (const listener of [...events.get(type) || []]) listener(); },
        requestVideoFrameCallback(listener) { callback = listener; return 1; },
        cancelVideoFrameCallback() { callback = null; },
        frame() { const listener = callback; callback = null; listener?.(); },
        listenerCount: () => [...events.values()].reduce((total, set) => total + set.size, 0),
        hasFrame: () => callback !== null,
        ...overrides
    };
}

test('primary waiting measures only post-frame playback; duplicate waiting and canplay do not double count', async () => {
    const h = harness(); const video = primaryVideo();
    const dispose = h.metrics.attach(video, { providerId: 'animego' });
    video.dispatch('waiting'); // Initial load, no frame or playing event.
    h.time(500); video.frame();
    video.dispatch('waiting'); // First frame alone is not ongoing playback.
    h.time(1000); video.dispatch('playing');
    h.time(1500); video.dispatch('waiting');
    h.time(1800); video.dispatch('waiting');
    h.time(2100); video.dispatch('canplay'); video.dispatch('playing'); video.dispatch('canplay');
    h.time(2500); video.dispatch('waiting');
    h.time(2800); video.dispatch('playing');
    const report = await h.metrics.report();
    assert.equal(report.qoe[0].sessions, 1);
    assert.equal(report.qoe[0].stallCount, 2);
    assert.equal(report.qoe[0].rebufferMsTotal, 900);
    assert.equal(report.qoe[0].rebufferMsMax, 600);
    assert.ok(video.listenerCount() > 0, 'QoE outlives the one-shot TTFF callback');
    dispose(); assert.equal(video.listenerCount(), 0);
});

test('pause, seeking, sufficient buffer and ad phases never contribute stalls', async () => {
    const h = harness(); const video = primaryVideo(); let ad = false;
    const dispose = h.metrics.attach(video, { isAdPlaying: () => ad });
    ad = true; video.frame(); video.dispatch('playing'); video.dispatch('waiting');
    assert.equal((await h.metrics.report()).qoe.length, 0, 'ad frame is not a measured content session');
    ad = false; video.frame(); video.dispatch('playing');
    for (const field of ['paused', 'seeking']) {
        video[field] = true; video.dispatch('waiting'); video[field] = false;
        video.dispatch('playing');
    }
    video.readyState = 3; video.dispatch('waiting'); video.dispatch('canplay');
    video.readyState = 2;
    for (const event of ['pause', 'seeking', 'adstart']) {
        video.dispatch('playing'); video.dispatch('waiting');
        h.time(1000); video.dispatch(event); h.time(2000); video.dispatch('canplay');
    }
    ad = true; video.dispatch('playing'); video.dispatch('waiting');
    ad = false; video.dispatch('canplay');
    const qoe = (await h.metrics.report()).qoe[0];
    assert.equal(qoe.sessions, 1); assert.equal(qoe.stallCount, 0); assert.equal(qoe.rebufferMsTotal, 0);
    dispose(); assert.equal(video.listenerCount(), 0); assert.equal(video.hasFrame(), false);
});

test('Ghost, provider-owned video and iframes never attach QoE or TTFF listeners', async () => {
    const h = harness();
    for (const video of [primaryVideo({ dataset: { ghost: 'true' } }), primaryVideo({ tagName: 'IFRAME' }),
        primaryVideo({ ownerDocument: { location: { protocol: 'https:' } } })]) {
        h.metrics.attach(video)();
        assert.equal(video.listenerCount(), 0);
    }
    const report = await h.metrics.report();
    assert.equal(report.qoe.length, 0); assert.equal(report.ttff.length, 0);
});

test('source replacement, destroy, ended and stale ownership discard open stalls and release listeners', async () => {
    const h = harness(); const video = primaryVideo(); let current = true;
    const dispose = h.metrics.attach(video, { providerId: 'torrent', isCurrent: () => current });
    video.frame(); video.dispatch('playing'); video.dispatch('waiting');
    h.time(1000); video.dispatch('emptied'); video.dispatch('loadstart');
    video.dispatch('waiting'); h.time(1200); video.frame(); video.dispatch('playing');
    assert.equal((await h.metrics.report()).qoe[0].sessions, 2);
    video.dispatch('waiting'); h.time(1400); dispose(); dispose(); video.dispatch('playing');
    assert.equal(video.listenerCount(), 0); assert.equal(video.hasFrame(), false);
    assert.equal((await h.metrics.report()).qoe[0].stallCount, 0);
    for (const event of ['ended', 'error', 'playing']) {
        const next = primaryVideo(); h.metrics.attach(next, { isCurrent: () => current });
        next.frame(); next.dispatch('playing'); next.dispatch('waiting');
        if (event === 'playing') current = false;
        next.dispatch(event);
        assert.equal(next.listenerCount(), 0, `${event} teardown releases all listeners`);
        assert.equal(next.hasFrame(), false);
    }
    assert.ok((await h.metrics.report()).qoe.every(row => row.stallCount === 0));
});

test('TTFF histogram yields bucket upper-bound p50/p95, excludes unknown and preserves legacy data', async () => {
    const key = 'movieExtension.playerMetricsV1';
    const h = harness({ [key]: { schema: 1, days: { 100: { 'animego:ttff:exact': { count: 2, totalMs: 300, maxMs: 200 } } } } });
    const old = await h.metrics.report();
    assert.equal(old.ttff[0].meanMs, 150); assert.equal(old.ttff[0].p50Ms, null);
    assert.equal(old.ttff[0].measuredCount, 0); assert.equal(old.qoe.length, 0);
    for (let i = 0; i < 20; i++) await h.metrics.record('ttff', { providerId: 'animego', durationMs: i === 19 ? 9000 : 800 });
    await h.metrics.record('ttff', { providerId: 'animego' });
    await h.metrics.record('ttff', { providerId: 'animego', durationMs: 7000, approximate: true });
    const report = await h.metrics.report();
    const exact = report.ttff.find(row => row.quality === 'exact');
    assert.equal(exact.count, 22); assert.equal(exact.measuredCount, 20);
    assert.equal(exact.p50Ms, 1000); assert.equal(exact.p95Ms, 1000);
    assert.equal(report.ttff.find(row => row.quality === 'approximate').p95Ms, 8000);
    assert.equal(report.ttff.find(row => row.quality === 'unknown').p50Ms, null);
    h.date(101); await h.metrics.record('ttff', { providerId: 'animego', durationMs: 25000 });
    assert.equal((await h.metrics.report()).ttff.find(row => row.quality === 'exact').p95Ms, 15000, 'histogram merges across retained days');
});

test('QoE and histogram storage stays bounded, numeric and identifier-free with old or hostile data', async () => {
    const key = 'movieExtension.playerMetricsV1';
    const days = {};
    for (let d = 0; d <= 100; d++) days[d] = {
        'animego:qoe': { sessions: 1e30, stallCount: 1e30, rebufferMsTotal: 1e30, rebufferMsMax: 1e30, url: 'https://SECRET/title/42' },
        'animego:ttff:exact': { count: 1e30, totalMs: 1e30, maxMs: 1e30, histogram: Array(10000).fill(1e30) },
        'https://SECRET/movie/42:qoe': { sessions: 1 }, title: 'SECRET'
    };
    const h = harness({ [key]: { days } });
    await h.metrics.record('session', { providerId: 'animego', movieId: 42, url: 'https://SECRET' });
    await h.metrics.record('stall', { providerId: 'animego', durationMs: 1e30, error: 'SECRET' });
    assert.equal(await h.metrics.record('stall', { durationMs: NaN }), false);
    const report = await h.metrics.report();
    assert.equal(report.qoe[0].sessions, 7000000); assert.equal(report.qoe[0].stallCount, 7000000);
    assert.equal(report.qoe[0].rebufferMsTotal, 2100000000000); assert.equal(report.qoe[0].rebufferMsMax, 300000);
    assert.equal(report.ttff[0].histogram.length, 11); assert.equal(report.ttff[0].measuredCount, 7000000);
    const saved = h.stored()[key];
    assert.equal(Object.keys(saved.days).length, 7);
    assert.ok(JSON.stringify(saved).length < 10000);
    assert.ok(!JSON.stringify(saved).includes('SECRET')); assert.ok(!JSON.stringify(saved).includes('movieId'));
    for (const entries of Object.values(saved.days)) for (const value of Object.values(entries)) {
        for (const field of Object.values(value)) assert.ok(typeof field === 'number' || Array.isArray(field) && field.every(Number.isFinite));
    }
    h.date(108); assert.equal((await h.metrics.report()).qoe.length, 0);
});

test('late attachment observes already playing video and ready loadeddata fallback without replaying startup', async () => {
    const h = harness(); const video = primaryVideo({ readyState: 4 });
    const dispose = h.metrics.attach(video, { providerId: 'animego' });
    video.frame(); video.readyState = 2;
    h.time(300); video.dispatch('waiting'); h.time(800); video.dispatch('canplay');
    assert.equal((await h.metrics.report()).qoe[0].rebufferMsTotal, 500);
    dispose();
    const fallback = primaryVideo({ readyState: 4, requestVideoFrameCallback: undefined });
    const cleanup = h.metrics.attach(fallback, { providerId: 'torrent' });
    const report = await h.metrics.report();
    assert.equal(report.ttff.find(row => row.quality === 'approximate').count, 1);
    assert.equal(report.qoe.find(row => row.providerId === 'torrent').sessions, 1);
    cleanup(); assert.equal(fallback.listenerCount(), 0);
});

test('actual WatchEntryPage attachment continues after readiness and canonical selection invalidates the old observer', async () => {
    const h = harness(); const video = primaryVideo();
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/pages/movie-details/WatchEntryPage.js'), 'utf8'), h.scope);
    let selection = { kinopoiskId: 12345, seasonNumber: 1, episodeNumber: 2 };
    const manager = { ...h.scope.MovieDetailsWatchEntryMethods,
        playerMetricsAttempt: { requestId: 1, providerId: 'animego', startAt: 50, attached: false, complete: false },
        isSourceSwitchRequestCurrent: id => id === 1,
        playbackController: { getSelection: () => selection },
        elements: { videoContainer: { querySelector: () => video } } };
    manager.observePlayerMetrics('loading', { requestId: 1 });
    video.frame(); video.dispatch('playing');
    manager.observePlayerMetrics('ready', { requestId: 1 });
    h.time(200); video.dispatch('waiting'); h.time(600); video.dispatch('canplay');
    const report = await h.metrics.report();
    assert.equal(report.counters[0].type, 'resolveOk');
    assert.equal(report.qoe[0].rebufferMsTotal, 400);
    video.dispatch('waiting'); selection = { ...selection, episodeNumber: 3 };
    video.dispatch('playing');
    assert.equal(video.listenerCount(), 0); assert.equal(video.hasFrame(), false);
    manager.playerMetricsDispose();
    assert.equal((await h.metrics.report()).qoe[0].stallCount, 1);
    assert.ok(!JSON.stringify(h.stored()).includes('12345'));
});
