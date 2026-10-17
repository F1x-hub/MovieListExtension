const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/background/background.js', 'utf8');
const listeners = [];
const loads = [];
let cleanupCount = 0;
const activeLoads = new Map(); // slot -> LOAD_SEARCH_FRAME message

const chrome = {
    runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener(listener) { listeners.push(listener); } },
        sendMessage(message) {
            if (message.target === 'offscreen-scraper' && message.type === 'LOAD_SEARCH_FRAME') {
                activeLoads.set(message.slot, message);
                loads.push(message);
                return Promise.resolve({ success: true });
            }
            if (message.target === 'offscreen-scraper' && message.type === 'CLEANUP_SEARCH_FRAME') {
                activeLoads.delete(message.slot);
                cleanupCount += 1;
                return Promise.resolve({ success: true });
            }
            return Promise.resolve({});
        },
        getURL: value => value,
        async getContexts() { return []; },
        getManifest() { return {}; },
        lastError: null
    },
    alarms: {
        create() {},
        onAlarm: { addListener() {} }
    },
    storage: {
        onChanged: { addListener() {} },
        local: { get(keys, callback) { callback({}); }, set(values, callback) { callback?.(); } }
    },
    offscreen: {
        async hasDocument() { return true; },
        async createDocument() {},
        async closeDocument() {}
    },
    tabs: {
        onRemoved: { addListener() {} },
        onUpdated: { addListener() {} }
    },
    notifications: { onButtonClicked: { addListener() {} } },
    downloads: { download() {} },
    action: { setPopup() {} },
    sidePanel: { setPanelBehavior() {} }
};

const context = {
    chrome,
    importScripts() {},
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Promise,
    URL,
    encodeURIComponent,
    decodeURIComponent,
    self: {}
};
vm.runInNewContext(source, context, { filename: 'background.js' });
assert.ok(listeners.length >= 1, 'background listener should be registered');
const onMessage = listeners[0];

function request(message) {
    return new Promise(resolve => {
        onMessage(message, {}, resolve);
    });
}

function finishLoad(pattern, items = [{ id: 1, type: 'film' }]) {
    const load = [...activeLoads.values()].find(item => pattern.test(item.searchUrl));
    assert.ok(load, `a frame should be loading ${pattern}`);
    onMessage({
        target: 'kinopoisk-search-coordinator',
        type: 'SCRAPE_RESULT_SUCCESS',
        requestId: load.requestId,
        items
    }, {}, () => {});
}

async function tick(ms = 25) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

const search = (query, priority, extra = {}) => request({
    type: 'KINOPOISK_OFFSCREEN_SCRAPE', query, requestKey: `search:${query}`, priority, ...extra
});

async function run() {
    // Two frame slots load in parallel.
    const first = search('first', 'below-viewport');
    const second = search('second', 'below-viewport');
    await tick();
    assert.equal(loads.length, 2, 'both frame slots start at once');
    assert.deepEqual([...activeLoads.keys()].sort(), [0, 1]);

    // With both slots busy, the freed slot takes visible work before background work.
    const low = search('low', 'below-viewport');
    const visible = search('visible', 'visible-identity');
    const duplicate = search('visible', 'visible-identity');
    finishLoad(/first/);
    assert.equal((await first).success, true);
    await tick(80);
    assert.match(loads[2].searchUrl, /visible/);

    finishLoad(/visible/, [{ id: 2, type: 'film' }]);
    const [visibleResult, duplicateResult] = await Promise.all([visible, duplicate]);
    assert.equal(visibleResult.success, true);
    assert.deepEqual(duplicateResult.items, visibleResult.items);
    assert.equal(visibleResult.metrics.inFlightHit, true);
    assert.ok(visibleResult.metrics.queueWaitMs >= 0);
    assert.ok(visibleResult.metrics.serviceMs >= 0);
    await tick(80);
    assert.equal(cleanupCount, 2);
    // A result is routed to its own frame's request, not to whichever started last.
    assert.match(activeLoads.get(1)?.searchUrl || activeLoads.get(0)?.searchUrl, /second|low/);

    finishLoad(/second/);
    await second;
    await tick(80);
    finishLoad(/low/);
    await low;
    await tick(80);
    assert.equal(activeLoads.size, 0);

    // Queued work can be cancelled before it loads.
    const busyA = search('busy-a', 'visible-identity');
    const busyB = search('busy-b', 'visible-identity');
    await tick();
    const cancelled = search('cancelled', 'retry');
    const cancelResponse = await request({ type: 'KINOPOISK_OFFSCREEN_CANCEL', requestKey: 'search:cancelled' });
    assert.equal(cancelResponse.success, true);
    const cancelledResult = await cancelled;
    assert.equal(cancelledResult.reason, 'REQUEST_CANCELLED');
    assert.equal(loads.some(load => /cancelled/.test(load.searchUrl)), false);

    // Queued work past its deadline expires without loading.
    const expiredSimilar = request({
        type: 'KINOPOISK_SIMILAR_OFFSCREEN',
        kinopoiskId: 42,
        mediaType: 'movie',
        timeoutMs: 1000,
        queueDeadlineMs: 30,
        requestKey: 'recommendations:movie:42',
        priority: 'below-viewport'
    });
    const expiredResult = await expiredSimilar;
    assert.equal(expiredResult.reason, 'QUEUE_DEADLINE_EXCEEDED');
    assert.equal(expiredResult.metrics.timeoutReason, 'QUEUE_DEADLINE_EXCEEDED');
    assert.equal(loads.some(load => /\/42\/like\//.test(load.searchUrl)), false);

    finishLoad(/busy-a/);
    finishLoad(/busy-b/);
    await Promise.all([busyA, busyB]);

    console.log('✅ Offscreen ratings scheduler runs two frame slots, prioritizes, deduplicates, cancels, and expires queued work');
}

run().catch(error => {
    console.error('❌ Offscreen ratings scheduler test failed:', error);
    process.exitCode = 1;
});
