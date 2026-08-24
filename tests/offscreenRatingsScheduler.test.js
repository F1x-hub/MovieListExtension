const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/background/background.js', 'utf8');
const listeners = [];
const loads = [];
let cleanupCount = 0;
let currentLoad = null;

const chrome = {
    runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener(listener) { listeners.push(listener); } },
        sendMessage(message) {
            if (message.target === 'offscreen-scraper' && message.type === 'LOAD_SEARCH_FRAME') {
                currentLoad = message;
                loads.push(message);
                return Promise.resolve({ success: true });
            }
            if (message.target === 'offscreen-scraper' && message.type === 'CLEANUP_SEARCH_FRAME') {
                currentLoad = null;
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

function finishCurrent(items = [{ id: 1, type: 'film' }]) {
    assert.ok(currentLoad, 'a physical iframe request should be active');
    onMessage({
        target: 'kinopoisk-search-coordinator',
        type: 'SCRAPE_RESULT_SUCCESS',
        requestId: currentLoad.requestId,
        items
    }, {}, () => {});
}

async function tick(ms = 25) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    const first = request({
        type: 'KINOPOISK_OFFSCREEN_SCRAPE',
        query: 'first',
        requestKey: 'search:first',
        priority: 'below-viewport'
    });
    await tick();
    assert.equal(loads.length, 1);

    const low = request({
        type: 'KINOPOISK_OFFSCREEN_SCRAPE',
        query: 'low',
        requestKey: 'search:low',
        priority: 'below-viewport'
    });
    const visible = request({
        type: 'KINOPOISK_OFFSCREEN_SCRAPE',
        query: 'visible',
        requestKey: 'search:visible',
        priority: 'visible-identity'
    });
    const duplicate = request({
        type: 'KINOPOISK_OFFSCREEN_SCRAPE',
        query: 'visible',
        requestKey: 'search:visible',
        priority: 'visible-identity'
    });

    finishCurrent();
    const firstResult = await first;
    assert.equal(firstResult.success, true);
    await tick(80);
    assert.match(loads[1].searchUrl, /visible/);

    finishCurrent([{ id: 2, type: 'film' }]);
    const [visibleResult, duplicateResult] = await Promise.all([visible, duplicate]);
    assert.equal(visibleResult.success, true);
    assert.deepEqual(duplicateResult.items, visibleResult.items);
    assert.equal(visibleResult.metrics.inFlightHit, true);
    assert.ok(visibleResult.metrics.queueWaitMs >= 0);
    assert.ok(visibleResult.metrics.serviceMs >= 0);
    await tick(80);
    assert.equal(cleanupCount, 2);

    const cancelled = request({
        type: 'KINOPOISK_OFFSCREEN_SCRAPE',
        query: 'cancelled',
        requestKey: 'search:cancelled',
        priority: 'retry'
    });
    const cancelResponse = await request({
        type: 'KINOPOISK_OFFSCREEN_CANCEL',
        requestKey: 'search:cancelled'
    });
    assert.equal(cancelResponse.success, true);
    finishCurrent([{ id: 3, type: 'film' }]);
    const cancelledResult = await cancelled;
    assert.equal(cancelledResult.reason, 'REQUEST_CANCELLED');
    assert.equal(loads.some(load => /cancelled/.test(load.searchUrl)), false);

    console.log('✅ Offscreen ratings scheduler prioritizes visible work, deduplicates, and cancels queued work');
}

run().catch(error => {
    console.error('❌ Offscreen ratings scheduler test failed:', error);
    process.exitCode = 1;
});
