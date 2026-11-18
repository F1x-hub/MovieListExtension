import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('🧪 Running player lifecycle tests...');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const lifecycleSource = fs.readFileSync(
    new URL('../src/shared/services/PlayerSourceLifecycle.js', import.meta.url),
    'utf8'
);
const lifecycleWindow = {};
const lifecycleContext = vm.createContext({
    console,
    window: lifecycleWindow,
    setTimeout,
    clearTimeout
});
vm.runInContext(lifecycleSource, lifecycleContext);
const lifecycle = lifecycleWindow.PlayerSourceLifecycle;

const bootstrapLoader = {
    removed: false,
    remove() {
        this.removed = true;
    }
};
const lifecycleMessage = {};
const lifecycleActions = { appendChild() {} };
let lifecycleOverlay = null;
const lifecycleDocument = {
    getElementById: () => ({}),
    createElement() {
        return {
            className: '',
            setAttribute() {},
            set innerHTML(value) {
                this.markup = value;
            },
            querySelector(selector) {
                if (selector === '.player-source-lifecycle__message') return lifecycleMessage;
                if (selector === '.player-source-lifecycle__actions') return lifecycleActions;
                return null;
            }
        };
    }
};
const lifecycleContainer = {
    ownerDocument: lifecycleDocument,
    dataset: {},
    classList: { add() {} },
    querySelector(selector) {
        if (selector === '[data-player-bootstrap-loader]') {
            return bootstrapLoader.removed ? null : bootstrapLoader;
        }
        if (selector === '.player-source-lifecycle') return lifecycleOverlay;
        return null;
    },
    appendChild(element) {
        lifecycleOverlay = element;
    }
};

const loadingOverlay = lifecycle.setState(lifecycleContainer, 'loading', {
    message: 'Загрузка Ex-FS…'
});
assert.strictEqual(bootstrapLoader.removed, true, 'lifecycle must replace the bootstrap loader');
assert.strictEqual(loadingOverlay, lifecycleOverlay, 'only the lifecycle loading overlay should remain');
assert.strictEqual(lifecycleMessage.textContent, 'Загрузка Ex-FS…');

function createEventTarget(properties = {}) {
    const listeners = new Map();
    return {
        ...properties,
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) {
            listeners.get(type)?.delete(listener);
        },
        dispatch(type) {
            listeners.get(type)?.forEach(listener => listener({ type, target: this }));
        }
    };
}

const iframeStates = [];
const iframe = createEventTarget();
lifecycle.watchIframe(iframe, {
    timeoutMs: 15,
    onState: (state, detail) => iframeStates.push({ state, reason: detail.reason })
});
await delay(30);
assert.deepStrictEqual(Array.from(iframeStates, item => item.state), ['loading', 'unavailable']);
assert.strictEqual(iframeStates[1].reason, 'timeout');
// A slow frame that loads after its timeout is ready after all.
iframe.dispatch('load');
assert.deepStrictEqual(Array.from(iframeStates, item => [item.state, item.reason]).slice(2), [['ready', 'late-load']],
    'a frame that loads after the timeout takes back «unavailable»');
iframe.dispatch('load');
assert.strictEqual(iframeStates.length, 3, 'a late frame reports ready once');

// A slow video stream: «unavailable» at the timeout, ready when its first data comes.
// (HDRezka under load: without this the overlay stayed over a playing video and the
// grace fallback switched to another source 12 s later.)
const lateVideoStates = [];
const lateVideo = createEventTarget({ readyState: 0, error: null, ownerDocument: { hidden: false } });
lifecycle.watchVideo(lateVideo, {
    timeoutMs: 15,
    onState: (state, detail) => lateVideoStates.push([state, detail.reason])
});
await delay(30);
assert.deepStrictEqual(lateVideoStates, [['loading', 'start'], ['unavailable', 'timeout']]);
lateVideo.dispatch('loadeddata');
lateVideo.dispatch('canplay');
assert.deepStrictEqual(lateVideoStates.slice(2), [['ready', 'late-ready']], 'late first data makes the source ready, once');

const failedLateStates = [];
const failedLate = createEventTarget({ readyState: 0, error: null, ownerDocument: { hidden: false } });
lifecycle.watchVideo(failedLate, { timeoutMs: 15, onState: (state, detail) => failedLateStates.push([state, detail.reason]) });
await delay(30);
failedLate.dispatch('error');
failedLate.dispatch('canplay');
assert.deepStrictEqual(failedLateStates, [['loading', 'start'], ['unavailable', 'timeout']], 'a failure after the timeout ends the watch without a new state');

const cancelledLateStates = [];
const cancelledLate = createEventTarget({ readyState: 0, error: null, ownerDocument: { hidden: false } });
const cancelledWatcher = lifecycle.watchVideo(cancelledLate, { timeoutMs: 15, onState: (state, detail) => cancelledLateStates.push([state, detail.reason]) });
await delay(30);
cancelledWatcher.cancel();
cancelledLate.dispatch('canplay');
assert.strictEqual(cancelledLateStates.length, 2, 'a cancelled watch stops listening for a late start');

const staleLateStates = [];
let staleCurrent = true;
const staleLate = createEventTarget({ readyState: 0, error: null, ownerDocument: { hidden: false } });
lifecycle.watchVideo(staleLate, { timeoutMs: 15, isRequestCurrent: () => staleCurrent, onState: (state, detail) => staleLateStates.push([state, detail.reason]) });
await delay(30);
staleCurrent = false;
staleLate.dispatch('canplay');
assert.strictEqual(staleLateStates.length, 2, 'a late start of a request the page moved past is not reported');

const cleanerSource = ['PlayerSettingsMenu', 'PlayerMediaControls', 'PlayerGhostPreview'].map(name => fs.readFileSync(new URL('../src/shared/services/player/' + name + '.js', import.meta.url), 'utf8')).join(String.fromCharCode(10)) + String.fromCharCode(10) + fs.readFileSync(
    new URL('../content-scripts/player-cleaner.js', import.meta.url),
    'utf8'
);
const windowListeners = new Map();
const cleanerWindow = {
    PlayerSourceLifecycle: lifecycle,
    location: { href: 'chrome-extension://test/player', protocol: 'chrome-extension:' },
    addEventListener(type, listener) {
        windowListeners.set(type, listener);
    },
    postMessage() {}
};
cleanerWindow.self = cleanerWindow;
cleanerWindow.top = cleanerWindow;
cleanerWindow.parent = cleanerWindow;
const documentStub = {
    readyState: 'loading',
    body: null,
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement() {
        return { style: {}, remove() {} };
    },
    querySelector: () => null,
    addEventListener() {}
};
class MutationObserverStub {
    observe() {}
    disconnect() {}
}
const cleanerContext = vm.createContext({
    chrome: { runtime: { getURL: value => value } },
    console,
    document: documentStub,
    localStorage: { getItem: () => null, setItem() {} },
    MutationObserver: MutationObserverStub,
    window: cleanerWindow,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise
});
vm.runInContext(cleanerSource, cleanerContext);
const { tryPlayWithLimit } = cleanerWindow.MovieExtension_PlayerCleaner._test;

const video = createEventTarget({
    readyState: 0,
    error: null,
    playAttempts: 0,
    play() {
        this.playAttempts += 1;
        return Promise.resolve();
    }
});
const videoStates = [];
const playback = tryPlayWithLimit(video, {
    maxAttempts: 20,
    intervalMs: 5,
    onState: state => videoStates.push(state)
});
setTimeout(() => {
    video.error = { code: 4 };
    video.dispatch('error');
}, 2);
const errorResult = await playback.promise;
const attemptsAtError = errorResult.attempts;
await delay(20);

assert.strictEqual(errorResult.state, 'error');
assert.strictEqual(errorResult.reason, 'media-error');
assert.strictEqual(errorResult.attempts, attemptsAtError, 'video.error must stop further retries');
assert.deepStrictEqual(Array.from(videoStates), ['loading', 'error']);
assert.strictEqual(video.playAttempts, 0);

const neverReadyVideo = createEventTarget({ readyState: 0, error: null, play: () => Promise.resolve() });
const boundedResult = await tryPlayWithLimit(neverReadyVideo, {
    maxAttempts: 3,
    intervalMs: 1
}).promise;
assert.strictEqual(boundedResult.state, 'unavailable');
assert.strictEqual(boundedResult.attempts, 3, 'retry loop must stop at the configured limit');

let requestIsCurrent = true;
const staleVideo = createEventTarget({ readyState: 0, error: null, play: () => Promise.resolve() });
const stalePlayback = tryPlayWithLimit(staleVideo, {
    maxAttempts: 20,
    intervalMs: 5,
    isRequestCurrent: () => requestIsCurrent
});
requestIsCurrent = false;
const staleResult = await stalePlayback.promise;
assert.strictEqual(staleResult.state, 'cancelled', 'Phase 2 request invalidation must cancel retries');

const eventReadyVideo = createEventTarget({
    readyState: 0, error: null, playAttempts: 0,
    play() { this.playAttempts += 1; return Promise.resolve(); }
});
const eventReadyPlayback = tryPlayWithLimit(eventReadyVideo, { intervalMs: 10000 });
eventReadyVideo.readyState = 2;
eventReadyVideo.dispatch('loadeddata');
assert.strictEqual(eventReadyVideo.playAttempts, 1,
    'loadeddata must start playback immediately without waiting for the poll or readyState 3');
assert.strictEqual((await eventReadyPlayback.promise).state, 'ready');
eventReadyVideo.dispatch('canplay');
assert.strictEqual(eventReadyVideo.playAttempts, 1, 'readiness listeners must be removed after completion');

let readyRequestCurrent = true;
const staleEventVideo = createEventTarget({
    readyState: 0, error: null, playAttempts: 0,
    play() { this.playAttempts += 1; return Promise.resolve(); }
});
const staleEventPlayback = tryPlayWithLimit(staleEventVideo, {
    intervalMs: 10000, isRequestCurrent: () => readyRequestCurrent
});
readyRequestCurrent = false;
staleEventVideo.readyState = 3;
staleEventVideo.dispatch('canplay');
assert.strictEqual((await staleEventPlayback.promise).state, 'cancelled');
assert.strictEqual(staleEventVideo.playAttempts, 0, 'a ready event from a replaced source cannot start playback');

console.log('✅ Player lifecycle tests passed!');
