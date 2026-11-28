/**
 * A provider frame that loads is not yet a working source: only its film playing is.
 * The page waits for PLAYER_PLAYBACK_STARTED after PLAYER_START, gives the source up
 * when it never comes, and counts the start for the source's health only then.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../src/pages/movie-details/WatchEntryPage.js'), 'utf8');

function harness({ confidence = 'PARTIAL' } = {}) {
    let now = 0;
    let nextId = 1;
    const timers = new Map();
    const listeners = new Map();
    const records = [];
    const scope = {
        console: { ...console, warn() {} },
        Date: { now: () => now },
        setTimeout(callback, delay = 0) { const id = nextId++; timers.set(id, { at: now + delay, callback }); return id; },
        clearTimeout(id) { timers.delete(id); },
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type) { listeners.delete(type); },
        document: { hidden: false, activeElement: null },
        PlayerMetrics: { record: async (type, options) => { if (type.startsWith('resolve')) records.push({ type, ...options }); return true; }, attach: () => () => {} }
    };
    vm.runInNewContext(source, scope);
    const advance = ms => {
        const target = now + ms;
        for (;;) {
            const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) break;
            timers.delete(due[0]);
            now = due[1].at;
            due[1].callback();
        }
        now = target;
    };
    const iframe = { isConnected: true, dataset: { playerSourceActive: 'true' } };
    const container = { dataset: {}, querySelector: selector => (selector.includes('iframe') ? iframe : null) };
    const states = [];
    const manager = {
        ...scope.MovieDetailsWatchEntryMethods,
        proPlayerEnabled: true, sourceSwitchRequestId: 1, activePlayerId: 'kinogo',
        elements: { videoContainer: container },
        playbackController: { getActiveProvider: () => 'kinogo', getAdapter: () => ({ getProgressConfidence: () => confidence }) },
        isSourceSwitchRequestCurrent(id) { return id === this.sourceSwitchRequestId; },
        postToPlayerFrame() { return true; },
        setPlayerSourceState(state, options = {}) {
            states.push({ state, ...options });
            container.dataset.sourceState = state;
            this.observePlayerMetrics(state, { requestId: this.sourceSwitchRequestId, parserId: 'kinogo', reason: options.reason || state });
        }
    };
    manager.playerMetricsAttempt = { requestId: 1, providerId: 'kinogo', startAt: 0, complete: false, attached: false,
        awaitPlayback: manager.isPlaybackConfirmable('kinogo') };
    return { scope, manager, iframe, container, states, records, advance, listeners };
}

test('a frame that loads but never plays is given up and counted as a failed start', () => {
    const h = harness();
    h.manager.observePlayerMetrics('ready', { requestId: 1, parserId: 'kinogo', reason: 'load' });
    assert.equal(h.records.length, 0, 'the load event alone records nothing');
    h.manager.startPlayerFrame(h.iframe);
    h.advance(29000);
    assert.equal(h.states.length, 0, 'not before the limit');
    h.advance(1500);
    assert.equal(h.states.length, 1);
    assert.equal(h.states[0].state, 'unavailable');
    assert.equal(h.states[0].reason, 'no-playback');
    assert.deepEqual(h.records.map(record => [record.type, record.reason]), [['resolveFail', 'no-playback']]);
});

test('the film playing confirms the source and stops the check', () => {
    const h = harness();
    h.manager.startPlayerFrame(h.iframe);
    h.advance(6000);
    h.manager.confirmFramePlayback();
    h.advance(60000);
    assert.equal(h.states.length, 0);
    assert.deepEqual(h.records.map(record => record.type), ['resolveOk']);
});

test('a source given up too early that plays after all comes back', () => {
    const h = harness();
    h.manager.startPlayerFrame(h.iframe);
    h.advance(31000);
    h.manager.confirmFramePlayback();
    assert.deepEqual(h.states.map(state => state.state), ['unavailable', 'ready']);
});

test('frames without the extension scripts and stale requests are left alone', () => {
    const opaque = harness({ confidence: 'OPAQUE' });
    opaque.manager.startPlayerFrame(opaque.iframe);
    opaque.advance(60000);
    assert.equal(opaque.states.length, 0, 'an opaque frame cannot say when it plays');
    opaque.manager.observePlayerMetrics('ready', { requestId: 1, parserId: 'kinogo' });
    assert.deepEqual(opaque.records.map(record => record.type), ['resolveOk'], 'its load stays the success signal');

    const stale = harness();
    stale.manager.startPlayerFrame(stale.iframe);
    stale.manager.sourceSwitchRequestId = 2;
    stale.advance(60000);
    assert.equal(stale.states.length, 0, 'the viewer moved on');
});

test('a hidden page and a viewer busy in the frame get more time', () => {
    const hidden = harness();
    hidden.manager.startPlayerFrame(hidden.iframe);
    hidden.scope.document.hidden = true;
    hidden.advance(90000);
    assert.equal(hidden.states.length, 0, 'Chrome holds back a hidden page\'s media');
    hidden.scope.document.hidden = false;
    hidden.advance(6000);
    assert.equal(hidden.states.length, 1);

    const busy = harness();
    busy.manager.startPlayerFrame(busy.iframe);
    busy.advance(25000);
    busy.scope.document.activeElement = busy.iframe;
    busy.listeners.get('blur')();
    busy.advance(1);
    busy.advance(20000);
    assert.equal(busy.states.length, 0, 'a click in the frame near the limit extends it');
    busy.advance(6000);
    assert.equal(busy.states.length, 1);
});

test('a slow load is not counted as a failure while the frame may still play', () => {
    const h = harness();
    h.manager.observePlayerMetrics('unavailable', { requestId: 1, parserId: 'kinogo', reason: 'timeout' });
    assert.equal(h.records.length, 0);
    h.manager.confirmFramePlayback();
    assert.deepEqual(h.records.map(record => record.type), ['resolveOk']);
});

test('a frame that only shows a notice, with no video and so no PLAYER_READY, is given up from its load', () => {
    const h = harness();
    h.manager.observePlayerMetrics('ready', { requestId: 1, parserId: 'kinogo', reason: 'load' });
    h.manager.observePlayerMetrics('ready', { requestId: 1, parserId: 'kinogo', reason: 'late-load' });
    h.advance(29000);
    assert.equal(h.states.length, 0, 'a second load report does not restart the clock early');
    h.advance(1500);
    assert.deepEqual(h.states.map(state => state.reason), ['no-playback']);
});

test('PLAYER_START after the load restarts the clock', () => {
    const h = harness();
    h.manager.observePlayerMetrics('ready', { requestId: 1, parserId: 'kinogo', reason: 'load' });
    h.advance(10000);
    h.manager.startPlayerFrame(h.iframe);
    h.advance(25000);
    assert.equal(h.states.length, 0);
    h.advance(6000);
    assert.equal(h.states.length, 1);
});

test('the switch notice names the sources without their state', () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<div id="row"><button class="source-btn" data-value="parser:kinogo">KinoGo<span class="source-btn__state">, воспроизводится</span></button><button class="source-btn" data-value="parser:exfs">Ex-FS<span class="source-btn__state">, обнаружен — воспроизведение ещё не проверено</span></button></div>');
    const h = harness();
    h.manager.elements.sourceButtonsContainer = dom.window.document.getElementById('row');
    assert.equal(h.manager.sourceLabel('parser:kinogo'), 'KinoGo');
    assert.equal(h.manager.sourceLabel('parser:exfs'), 'Ex-FS');
    assert.equal(h.manager.sourceLabel('parser:none'), 'источник');
});
