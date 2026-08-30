const assert = require('assert');
const { BasePlaybackAdapter } = require('../src/shared/services/player/adapters/BasePlaybackAdapter');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');

class FakeVideo {
    constructor() {
        this.currentTime = 0;
        this.duration = 600;
        this.paused = true;
        this.ended = false;
        this.listeners = new Map();
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    emit(type) {
        for (const listener of this.listeners.get(type) || []) listener();
    }
}

class VerifiedOnlyInPrototypeAdapter extends BasePlaybackAdapter {
    constructor() {
        super('native-proof', 'Native proof');
    }

    getRoomSyncCapabilities() {
        return {
            observeTime: true,
            play: true,
            pause: true,
            seek: true,
            duration: true,
            lockGuestTimeline: true
        };
    }
}

const unverifiedAdapter = new BasePlaybackAdapter('unverified', 'Unverified');
assert.deepStrictEqual(unverifiedAdapter.getRoomSyncCapabilities(), {
    observeTime: false,
    play: false,
    pause: false,
    seek: false,
    duration: false,
    lockGuestTimeline: false
});

const controller = new PlaybackController();
const adapter = new VerifiedOnlyInPrototypeAdapter();
controller.registerAdapter(adapter);
controller.setActiveProvider('native-proof');
controller.setSelection({ kinopoiskId: 42, mediaType: 'movie' });
controller.mountRequestId = 1;

const video = new FakeVideo();
controller._attachNativeVideoListeners(video, 1, controller.getSelection(), adapter);

video.emit('loadedmetadata');
assert.strictEqual(controller.getRuntimeState().duration, 600);

video.paused = false;
video.emit('play');
assert.strictEqual(controller.getRuntimeState().isPlaying, true);

video.currentTime = 120;
video.emit('timeupdate');
assert.strictEqual(controller.getRuntimeState().currentTime, 120);

video.emit('seeking');
assert.strictEqual(controller.isSeeking, true);
video.currentTime = 360;
video.emit('seeked');
assert.strictEqual(controller.isSeeking, false);
assert.strictEqual(controller.getRuntimeState().currentTime, 360);

video.paused = true;
video.emit('pause');
assert.strictEqual(controller.getRuntimeState().isPaused, true);

assert.deepStrictEqual(controller.getProviderCapabilities('native-proof').roomSync, {
    observeTime: true,
    play: true,
    pause: true,
    seek: true,
    duration: true,
    lockGuestTimeline: true
});
assert.deepStrictEqual(controller.getProviderCapabilities('rutube').roomSync, {
    observeTime: false,
    play: false,
    pause: false,
    seek: false,
    duration: false,
    lockGuestTimeline: false
});

console.log('roomSyncCapabilityPrototype.test.js: native telemetry capability boundary passed');
