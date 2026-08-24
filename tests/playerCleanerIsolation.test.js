import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('🧪 Running player cleaner isolation tests...');

const cleanerSource = fs.readFileSync(
    new URL('../content-scripts/player-cleaner.js', import.meta.url),
    'utf8'
);
const cleanerWindow = {
    location: {
        href: 'chrome-extension://test/src/pages/movie-details/movie-details.html',
        protocol: 'chrome-extension:',
        origin: 'chrome-extension://test'
    },
    addEventListener() {},
    removeEventListener() {},
    postMessage() {}
};
cleanerWindow.self = cleanerWindow;
cleanerWindow.top = cleanerWindow;
cleanerWindow.parent = cleanerWindow;

const cleanerDocument = {
    readyState: 'loading',
    body: null,
    documentElement: {},
    addEventListener() {},
    querySelector: () => null,
    getElementById: () => null
};
class MutationObserverStub {
    observe() {}
    disconnect() {}
}

vm.runInContext(cleanerSource, vm.createContext({
    chrome: { runtime: { getURL: value => value } },
    console,
    document: cleanerDocument,
    localStorage: { getItem: () => null, setItem() {} },
    MutationObserver: MutationObserverStub,
    window: cleanerWindow,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise
}));

const {
    createListenerScope,
    activateWrapperListenerScope,
    teardownActiveWrapper,
    getPlayerObservationRoot,
    mutationsWithinRoot,
    cleanupCleanerOwnedIframes
} = cleanerWindow.MovieExtension_PlayerCleaner._test;

let addedListeners = 0;
let removedListeners = 0;
const listenerTarget = {
    addEventListener() { addedListeners += 1; },
    removeEventListener() { removedListeners += 1; }
};

for (let cycle = 0; cycle < 12; cycle += 1) {
    const scope = createListenerScope();
    scope.listen(listenerTarget, 'click', () => {});
    scope.listen(listenerTarget, 'keydown', () => {});
    scope.listen(listenerTarget, 'message', () => {});
    activateWrapperListenerScope(scope, { cycle });
    teardownActiveWrapper();
}
assert.strictEqual(addedListeners, removedListeners, 'wrapper teardown must balance every global listener');

const insideMutationTarget = {};
const outsideMutationTarget = {};
const observationRoot = {
    contains(target) { return target === insideMutationTarget; }
};
const unrelatedBody = {};
const selectedObservationRoot = getPlayerObservationRoot({
    body: unrelatedBody,
    documentElement: {},
    getElementById(id) { return id === 'videoContainer' ? observationRoot : null; },
    querySelector() { return null; }
});
assert.strictEqual(selectedObservationRoot, observationRoot, 'observer must select the concrete player container');
assert.notStrictEqual(selectedObservationRoot, unrelatedBody, 'observer must never fall back to document.body');

const delayedProviderPlayerRoot = { contains() { return true; } };
const delayedProviderRoot = getPlayerObservationRoot({
    body: unrelatedBody,
    documentElement: {},
    getElementById(id) { return id === 'player' ? delayedProviderPlayerRoot : null; },
    querySelector() { return null; }
});
assert.strictEqual(
    delayedProviderRoot,
    delayedProviderPlayerRoot,
    'cleaner must observe a stable provider #player before its video is mounted asynchronously'
);
assert.strictEqual(
    mutationsWithinRoot([{ target: outsideMutationTarget }], observationRoot),
    false,
    'mutations outside the player container must be ignored'
);
assert.strictEqual(
    mutationsWithinRoot([{ target: insideMutationTarget }], observationRoot),
    true,
    'mutations inside the player container must be observed'
);

let freshIframeRemoved = false;
let staleCleanerIframeRemoved = false;
let cleanupSelector = '';
const freshUiIframe = {
    dataset: { playerSourceActive: 'true' },
    remove() { freshIframeRemoved = true; }
};
const staleCleanerIframe = {
    dataset: {
        playerCleanerOwned: 'true',
        playerCleanerStale: 'true',
        playerSourceActive: 'false'
    },
    remove() { staleCleanerIframeRemoved = true; }
};
cleanupCleanerOwnedIframes({
    querySelectorAll(selector) {
        cleanupSelector = selector;
        return [freshUiIframe, staleCleanerIframe];
    }
});
assert.strictEqual(
    cleanupSelector,
    'iframe[data-player-cleaner-owned="true"][data-player-cleaner-stale="true"]',
    'cleaner cleanup must never select all UI iframes'
);
assert.strictEqual(freshIframeRemoved, false, 'fresh UI iframe must survive cleaner cleanup');
assert.strictEqual(staleCleanerIframeRemoved, true, 'explicitly stale cleaner-owned iframe may be removed');

const movieDetailsSource = fs
    .readFileSync(new URL('../src/pages/movie-details/movie-details.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '');
const detailsWindow = {
    location: {
        href: 'chrome-extension://test/src/pages/movie-details/movie-details.html',
        origin: 'chrome-extension://test'
    }
};
const detailsContext = vm.createContext({
    console,
    document: { addEventListener() {} },
    window: detailsWindow,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout
});
vm.runInContext(movieDetailsSource, detailsContext);

const MovieDetailsManager = detailsWindow.MovieDetailsManager;
const manager = Object.create(MovieDetailsManager.prototype);
const activePlayerWindow = {};
const activeIframe = {
    src: 'https://player.example/embed/42',
    contentWindow: activePlayerWindow,
    dataset: {
        playerSourceActive: 'true',
        playerRequestId: '7'
    }
};
manager.sourceSwitchRequestId = 7;
manager.elements = {
    videoContainer: {
        querySelector(selector) {
            return selector.startsWith('iframe') ? activeIframe : null;
        }
    }
};

let acceptedMessages = 0;
const applyPlayerMessage = event => {
    if (manager.isTrustedPlayerMessage(event)) acceptedMessages += 1;
};
applyPlayerMessage({
    data: { type: 'PLAYER_READY' },
    source: {},
    origin: 'https://player.example'
});
assert.strictEqual(acceptedMessages, 0, 'message from a foreign iframe must not affect player state');

applyPlayerMessage({
    data: { type: 'PLAYER_READY' },
    source: activePlayerWindow,
    origin: 'https://attacker.example'
});
assert.strictEqual(acceptedMessages, 0, 'message with a mismatched origin must not affect player state');

activeIframe.dataset.playerRequestId = '6';
applyPlayerMessage({
    data: { type: 'PLAYER_READY' },
    source: activePlayerWindow,
    origin: 'https://player.example'
});
assert.strictEqual(acceptedMessages, 0, 'message from a stale player request must be ignored');

activeIframe.dataset.playerRequestId = '7';
applyPlayerMessage({
    data: { type: 'PLAYER_READY' },
    source: activePlayerWindow,
    origin: 'https://player.example'
});
assert.strictEqual(acceptedMessages, 1, 'current iframe with matching origin and request token must be accepted');

console.log('✅ Player cleaner isolation tests passed!');
