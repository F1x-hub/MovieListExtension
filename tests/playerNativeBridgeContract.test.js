const assert = require('node:assert/strict');
const { BasePlaybackAdapter } = require('../src/shared/services/player/adapters/BasePlaybackAdapter');

class NativeBridgeAdapter extends BasePlaybackAdapter {
    constructor() {
        super('native-test', 'Native test');
        this.activeContainer = null;
    }

    getSelectionMode() {
        return 'NATIVE_BRIDGE';
    }

    canHandle(selection) {
        return Boolean(selection?.seasonNumber && selection?.episodeNumber);
    }
}

const listeners = new Set();
const frameWindow = {};
const postedMessages = [];
global.window = {
    location: { href: 'chrome-extension://test-id/player.html' },
    addEventListener(type, listener) {
        if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type, listener) {
        if (type === 'message') listeners.delete(listener);
    }
};

const iframe = {
    src: 'https://provider.test/embed/series',
    contentWindow: {
        postMessage(payload, targetOrigin) {
            postedMessages.push({ payload, targetOrigin });
        }
    },
    getAttribute(name) {
        return name === 'src' ? this.src : null;
    }
};
const container = {
    querySelector(selector) {
        return selector.includes('iframe') ? iframe : null;
    },
    querySelectorAll() {
        return [iframe];
    }
};

function emit(data, source = iframe.contentWindow, origin = 'https://provider.test') {
    for (const listener of [...listeners]) {
        listener({ data, source, origin });
    }
}

async function run() {
    const adapter = new NativeBridgeAdapter();
    adapter.activeContainer = container;

    const validPromise = adapter.applySelection({ seasonNumber: 2, episodeNumber: 4 }, { timeoutMs: 40 });
    assert.equal(postedMessages.at(-1).targetOrigin, 'https://provider.test');
    emit({
        type: 'PLAYBACK_SELECTION_RESULT',
        requestId: postedMessages.at(-1).payload.requestId,
        providerId: 'native-test',
        status: 'APPLIED',
        seasonNumber: 2,
        episodeNumber: 4
    });
    assert.equal(await validPromise, true, 'matching APPLIED response must resolve true');

    const dispatchedPromise = adapter.applySelection({ seasonNumber: 2, episodeNumber: 5 }, { timeoutMs: 20 });
    const dispatchedRequestId = postedMessages.at(-1).payload.requestId;
    emit({
        type: 'PLAYBACK_SELECTION_RESULT',
        requestId: dispatchedRequestId,
        providerId: 'native-test',
        status: 'DISPATCHED',
        seasonNumber: 2,
        episodeNumber: 5
    });
    assert.equal(await dispatchedPromise, false, 'DISPATCHED must not be treated as applied');

    const guardedPromise = adapter.applySelection({ seasonNumber: 3, episodeNumber: 1 }, { timeoutMs: 40 });
    const guardedRequestId = postedMessages.at(-1).payload.requestId;
    emit({
        type: 'PLAYBACK_SELECTION_RESULT',
        requestId: guardedRequestId,
        providerId: 'native-test',
        status: 'APPLIED',
        seasonNumber: 3,
        episodeNumber: 1
    }, frameWindow, 'https://provider.test');
    assert.equal(await guardedPromise, false, 'foreign frame responses must be ignored');

    const stalePromise = adapter.applySelection({ seasonNumber: 4, episodeNumber: 1 }, { timeoutMs: 40 });
    const staleRequestId = postedMessages.at(-1).payload.requestId;
    const currentPromise = adapter.applySelection({ seasonNumber: 4, episodeNumber: 2 }, { timeoutMs: 80 });
    const currentRequestId = postedMessages.at(-1).payload.requestId;
    emit({
        type: 'PLAYBACK_SELECTION_RESULT',
        requestId: staleRequestId,
        providerId: 'native-test',
        status: 'APPLIED',
        seasonNumber: 4,
        episodeNumber: 1
    });
    assert.equal(await stalePromise, false, 'a stale overlapping request must not apply');
    emit({
        type: 'PLAYBACK_SELECTION_RESULT',
        requestId: currentRequestId,
        providerId: 'native-test',
        status: 'APPLIED',
        seasonNumber: 4,
        episodeNumber: 2
    });
    assert.equal(await currentPromise, true, 'the latest overlapping request may apply');

    console.log('✅ player native bridge contract tests passed');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
