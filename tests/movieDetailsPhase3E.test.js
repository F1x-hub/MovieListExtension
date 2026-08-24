/**
 * tests/movieDetailsPhase3E.test.js
 * Comprehensive automated test suite for MovieDetails Phase 3E:
 * PlaybackRuntimeState + Reliable Native Telemetry Foundation + Progress Throttling + Stale Event Protection
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { PlaybackSelection, normalizePlaybackSelection } = require('../src/shared/services/player/PlaybackSelection');
const { PlaybackRuntimeState, createDefaultPlaybackRuntimeState, isMediaIdentityMatching } = require('../src/shared/services/player/PlaybackRuntime');
const { BasePlaybackAdapter } = require('../src/shared/services/player/adapters/BasePlaybackAdapter');
const { SeasonvarAdapter } = require('../src/shared/services/player/adapters/SeasonvarAdapter');
const { VidSrcAdapter } = require('../src/shared/services/player/adapters/VidSrcAdapter');
const { KinogoAdapter } = require('../src/shared/services/player/adapters/KinogoAdapter');
const { ExFsAdapter } = require('../src/shared/services/player/adapters/ExFsAdapter');
const { RutubeAdapter } = require('../src/shared/services/player/adapters/RutubeAdapter');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');

// ─── DOM & Progress Service Test Harness ─────────────────────────────

class MockProgressService {
    constructor() {
        this.storage = {};
        this.writeCount = 0;
    }

    async saveProgress(movieId, data) {
        this.writeCount++;
        this.storage[movieId] = {
            ...data,
            updatedAt: Date.now()
        };
    }

    async getProgress(movieId) {
        return this.storage[movieId] || null;
    }
}

class MockVideoElement {
    constructor() {
        this.tagName = 'VIDEO';
        this.currentTime = 0;
        this.duration = 0;
        this.paused = true;
        this.listeners = {};
        this.src = '';
    }

    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(l => l !== fn);
    }

    dispatchEvent(event) {
        const fns = this.listeners[event] || [];
        fns.forEach(fn => fn());
    }

    play() {
        this.paused = false;
        this.dispatchEvent('play');
    }

    pause() {
        this.paused = true;
        this.dispatchEvent('pause');
    }

    load() {
        // no-op mock
    }

    remove() {
        // no-op mock
    }

    seek(time) {
        this.currentTime = time;
        this.dispatchEvent('seeking');
        this.dispatchEvent('seeked');
        this.dispatchEvent('timeupdate');
    }

    triggerTimeUpdate(time) {
        this.currentTime = time;
        this.dispatchEvent('timeupdate');
    }

    triggerLoadedMetadata(duration) {
        this.duration = duration;
        this.dispatchEvent('loadedmetadata');
    }

    triggerEnded() {
        this.currentTime = this.duration;
        this.paused = true;
        this.dispatchEvent('ended');
    }
}

if (typeof global.document === 'undefined') {
    global.document = {
        createElement: (tag) => {
            const el = {
                tagName: tag.toUpperCase(),
                src: '',
                className: '',
                attributes: {},
                dataset: {},
                style: {},
                setAttribute: (k, v) => { el.attributes[k] = v; },
                getAttribute: (k) => el.attributes[k] || null,
                remove: () => {},
                addEventListener: () => {},
                removeEventListener: () => {}
            };
            return el;
        },
        querySelectorAll: () => []
    };
}

class MockContainer {
    constructor() {
        this.children = [];
        this.innerHTML = '';
    }

    appendChild(child) {
        this.children.push(child);
    }

    querySelector(selector) {
        if (selector === 'video') {
            return this.children.find(c => c.tagName === 'VIDEO') || null;
        }
        if (selector === 'iframe') {
            return this.children.find(c => c.tagName === 'IFRAME') || null;
        }
        return null;
    }

    querySelectorAll(selector) {
        if (selector === 'video') {
            return this.children.filter(c => c.tagName === 'VIDEO');
        }
        if (selector === 'iframe') {
            return this.children.filter(c => c.tagName === 'IFRAME');
        }
        return [];
    }
}

function createHarness() {
    const container = new MockContainer();
    const progressService = new MockProgressService();
    const controller = new PlaybackController({
        container,
        progressService
    });

    return {
        container,
        progressService,
        controller
    };
}

let testCount = 0;
let passedCount = 0;

async function test(name, fn) {
    testCount++;
    try {
        await fn();
        passedCount++;
        console.log(`  ✅ ${name}`);
    } catch (err) {
        console.error(`  ❌ ${name}`);
        console.error(err);
        throw err;
    }
}

async function runAllTests() {
    console.log('--- Running Phase 3E PlaybackRuntimeState & Telemetry Test Suite ---\n');

    // =========================================================================
    // PART 52: RUNTIME CONTRACT & ADAPTER CAPABILITIES
    // =========================================================================
    console.log('--- Part 52: Runtime Contract & Provider Confidence ---');

    await test('52.1 Default runtime state contains correct telemetry fields', () => {
        const state = createDefaultPlaybackRuntimeState();
        assert.strictEqual(state.currentTime, 0);
        assert.strictEqual(state.duration, 0);
        assert.strictEqual(state.isPlaying, false);
        assert.strictEqual(state.isPaused, true);
        assert.strictEqual(state.isEnded, false);
        assert.strictEqual(state.progressConfidence, 'OPAQUE');
        assert.strictEqual(state.supportsTimestampResume, false);
        assert.strictEqual(state.supportsEnded, false);
        assert.strictEqual(state.mountToken, 0);
        assert.deepStrictEqual(state.mediaIdentity, { kinopoiskId: null, seasonNumber: null, episodeNumber: null });
    });

    await test('52.2 Seasonvar adapter declares RELIABLE progress confidence and capabilities', () => {
        const adapter = new SeasonvarAdapter();
        assert.strictEqual(adapter.supportsProgressTracking(), true);
        assert.strictEqual(adapter.supportsDuration(), true);
        assert.strictEqual(adapter.supportsEnded(), true);
        assert.strictEqual(adapter.supportsTimestampResume(), true);
        assert.strictEqual(adapter.getProgressConfidence(), 'RELIABLE');
    });

    await test('52.3 VidSrc adapter declares OPAQUE progress confidence and 0 telemetry', () => {
        const adapter = new VidSrcAdapter();
        assert.strictEqual(adapter.supportsProgressTracking(), false);
        assert.strictEqual(adapter.supportsDuration(), false);
        assert.strictEqual(adapter.supportsEnded(), false);
        assert.strictEqual(adapter.supportsTimestampResume(), false);
        assert.strictEqual(adapter.getProgressConfidence(), 'OPAQUE');
    });

    await test('52.4 KinoGo adapter declares PARTIAL progress confidence', () => {
        const adapter = new KinogoAdapter();
        assert.strictEqual(adapter.supportsProgressTracking(), true);
        assert.strictEqual(adapter.supportsDuration(), true);
        assert.strictEqual(adapter.supportsEnded(), true);
        assert.strictEqual(adapter.supportsTimestampResume(), false);
        assert.strictEqual(adapter.getProgressConfidence(), 'PARTIAL');
    });

    await test('52.5 Ex-FS adapter declares PARTIAL progress confidence', () => {
        const adapter = new ExFsAdapter();
        assert.strictEqual(adapter.supportsProgressTracking(), true);
        assert.strictEqual(adapter.supportsDuration(), true);
        assert.strictEqual(adapter.supportsEnded(), true);
        assert.strictEqual(adapter.supportsTimestampResume(), false);
        assert.strictEqual(adapter.getProgressConfidence(), 'PARTIAL');
    });

    await test('52.6 Rutube adapter declares OPAQUE progress confidence', () => {
        const adapter = new RutubeAdapter();
        assert.strictEqual(adapter.supportsProgressTracking(), false);
        assert.strictEqual(adapter.supportsDuration(), false);
        assert.strictEqual(adapter.supportsEnded(), false);
        assert.strictEqual(adapter.supportsTimestampResume(), false);
        assert.strictEqual(adapter.getProgressConfidence(), 'OPAQUE');
    });

    await test('52.7 Runtime state resets with correct metadata on provider mount', async () => {
        const { controller, container } = createHarness();
        const mockVideo = new MockVideoElement();

        // Register custom mock seasonvar adapter
        const mockSeasonvar = new SeasonvarAdapter({
            getVideoSources: async () => [{ url: 'test.mp4', name: '1 серия' }],
            renderPlayer: async (cont) => {
                cont.appendChild(mockVideo);
                return mockVideo;
            }
        });
        controller.registerAdapter(mockSeasonvar);

        await controller.play({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 2,
            episodeNumber: 5,
            providerId: 'seasonvar'
        });

        const runtime = controller.getRuntimeState();
        assert.strictEqual(runtime.providerId, 'seasonvar');
        assert.strictEqual(runtime.progressConfidence, 'RELIABLE');
        assert.strictEqual(runtime.supportsTimestampResume, true);
        assert.strictEqual(runtime.supportsEnded, true);
        assert.strictEqual(runtime.mediaIdentity.kinopoiskId, 404900);
        assert.strictEqual(runtime.mediaIdentity.seasonNumber, 2);
        assert.strictEqual(runtime.mediaIdentity.episodeNumber, 5);
    });

    await test('52.8 subscribeRuntime receives instant initial state and live updates', async () => {
        const { controller } = createHarness();
        let receivedState = null;

        const unsubscribe = controller.subscribeRuntime((state) => {
            receivedState = state;
        });

        assert.ok(receivedState, 'Listener must receive initial state immediately');
        assert.strictEqual(receivedState.currentTime, 0);

        controller.updateRuntimeState({ currentTime: 120 }, controller.mountRequestId, controller.runtimeState.mediaIdentity);
        assert.strictEqual(receivedState.currentTime, 120);

        unsubscribe();
        controller.updateRuntimeState({ currentTime: 180 }, controller.mountRequestId, controller.runtimeState.mediaIdentity);
        assert.strictEqual(receivedState.currentTime, 120, 'Unsubscribed listener must not receive further updates');
    });

    // =========================================================================
    // PART 53: SEASONVAR NATIVE VIDEO EVENTS
    // =========================================================================
    console.log('\n--- Part 53: Seasonvar Native Video Bridge ---');

    await test('53.1 loadedmetadata updates runtime duration and applies safe timestamp seek', async () => {
        const { controller, container } = createHarness();
        const mockVideo = new MockVideoElement();

        const mockSeasonvar = new SeasonvarAdapter({
            getVideoSources: async () => [{ url: 'test.mp4' }],
            renderPlayer: async (cont) => {
                cont.appendChild(mockVideo);
                return mockVideo;
            }
        });
        controller.registerAdapter(mockSeasonvar);

        await controller.play({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 1,
            initialTimestamp: 350,
            providerId: 'seasonvar'
        });

        mockVideo.triggerLoadedMetadata(2400);

        const runtime = controller.getRuntimeState();
        assert.strictEqual(runtime.duration, 2400);
        assert.strictEqual(mockVideo.currentTime, 350, 'Video must seek to initialTimestamp on loadedmetadata');
    });

    await test('53.2 play and pause update runtime flags and pause forces flush', async () => {
        const { controller, progressService } = createHarness();
        const mockVideo = new MockVideoElement();

        const mockSeasonvar = new SeasonvarAdapter({
            getVideoSources: async () => [{ url: 'test.mp4' }],
            renderPlayer: async (cont) => {
                cont.appendChild(mockVideo);
                return mockVideo;
            }
        });
        controller.registerAdapter(mockSeasonvar);

        await controller.play({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 2,
            providerId: 'seasonvar'
        });

        mockVideo.triggerLoadedMetadata(3000);
        mockVideo.play();

        let runtime = controller.getRuntimeState();
        assert.strictEqual(runtime.isPlaying, true);
        assert.strictEqual(runtime.isPaused, false);

        mockVideo.triggerTimeUpdate(450);
        mockVideo.pause();

        runtime = controller.getRuntimeState();
        assert.strictEqual(runtime.isPlaying, false);
        assert.strictEqual(runtime.isPaused, true);

        const saved = await progressService.getProgress(404900);
        assert.ok(saved, 'Pause must force immediate progress save');
        assert.strictEqual(saved.timestamp, 450);
    });

    await test('53.3 ended updates ended state and flushes progress without auto-navigating', async () => {
        const { controller, progressService } = createHarness();
        const mockVideo = new MockVideoElement();

        const mockSeasonvar = new SeasonvarAdapter({
            getVideoSources: async () => [{ url: 'test.mp4' }],
            renderPlayer: async (cont) => {
                cont.appendChild(mockVideo);
                return mockVideo;
            }
        });
        controller.registerAdapter(mockSeasonvar);

        await controller.play({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 7,
            providerId: 'seasonvar'
        });

        mockVideo.triggerLoadedMetadata(2800);
        mockVideo.triggerEnded();

        const runtime = controller.getRuntimeState();
        assert.strictEqual(runtime.isEnded, true);
        assert.strictEqual(runtime.isPaused, true);
        assert.strictEqual(runtime.currentTime, 2800);

        const saved = await progressService.getProgress(404900);
        assert.strictEqual(saved.timestamp, 2800);

        // Strict scope check: selection must remain on S3E7 (Phase 3E does not auto-advance)
        const selection = controller.getSelection();
        assert.strictEqual(selection.seasonNumber, 3);
        assert.strictEqual(selection.episodeNumber, 7);
    });

    // =========================================================================
    // PART 54: PROGRESS WRITE THROTTLING & FORCE FLUSH
    // =========================================================================
    console.log('\n--- Part 54: 15-Second Throttling & Lifecycle Flushes ---');

    await test('54.1 Frequent timeupdates (<15s) cause exactly 1 storage write', async () => {
        const { controller, progressService } = createHarness();
        const mockVideo = new MockVideoElement();

        const mockSeasonvar = new SeasonvarAdapter({
            getVideoSources: async () => [{ url: 'test.mp4' }],
            renderPlayer: async (cont) => {
                cont.appendChild(mockVideo);
                return mockVideo;
            }
        });
        controller.registerAdapter(mockSeasonvar);

        await controller.play({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 1,
            providerId: 'seasonvar'
        });

        mockVideo.triggerLoadedMetadata(3000);
        mockVideo.play();

        const initialWrites = progressService.writeCount;

        // Simulate 50 timeupdates within 5 seconds
        for (let t = 1; t <= 50; t++) {
            mockVideo.triggerTimeUpdate(t * 0.1);
        }

        // Writes should not spike
        assert.strictEqual(progressService.writeCount - initialWrites, 0, 'No continuous writes within 15s window');
    });

    await test('54.2 >=15s interval allows next throttled storage write', async () => {
        const { controller, progressService } = createHarness();
        const mockVideo = new MockVideoElement();

        const mockSeasonvar = new SeasonvarAdapter({
            getVideoSources: async () => [{ url: 'test.mp4' }],
            renderPlayer: async (cont) => {
                cont.appendChild(mockVideo);
                return mockVideo;
            }
        });
        controller.registerAdapter(mockSeasonvar);

        await controller.play({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 1,
            providerId: 'seasonvar'
        });

        mockVideo.triggerLoadedMetadata(3000);
        mockVideo.play();

        // First throttled write
        controller.lastProgressSaveTime = Date.now() - 16000;
        mockVideo.triggerTimeUpdate(16);

        assert.strictEqual(progressService.writeCount, 1);
        let saved = await progressService.getProgress(404900);
        assert.strictEqual(saved.timestamp, 16);

        // Next throttled write after 15s
        controller.lastProgressSaveTime = Date.now() - 16000;
        mockVideo.triggerTimeUpdate(32);

        assert.strictEqual(progressService.writeCount, 2);
        saved = await progressService.getProgress(404900);
        assert.strictEqual(saved.timestamp, 32);
    });

    await test('54.3 Provider switch flushes active provider progress before mounting new one', async () => {
        const { controller, progressService } = createHarness();
        const mockVideo = new MockVideoElement();

        const mockSeasonvar = new SeasonvarAdapter({
            getVideoSources: async () => [{ url: 'test.mp4' }],
            renderPlayer: async (cont) => {
                cont.appendChild(mockVideo);
                return mockVideo;
            }
        });
        controller.registerAdapter(mockSeasonvar);
        controller.registerAdapter(new VidSrcAdapter());

        await controller.play({
            kinopoiskId: 404900,
            imdbId: 'tt0903747',
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 4,
            episodeNumber: 1,
            providerId: 'seasonvar'
        });

        mockVideo.triggerLoadedMetadata(3000);
        mockVideo.triggerTimeUpdate(1250);

        // Switch to VidSrc
        await controller.switchProvider('vidsrc');

        const saved = await progressService.getProgress(404900);
        assert.ok(saved);
        assert.strictEqual(saved.timestamp, 1250, 'Seasonvar timestamp must be flushed before VidSrc mounts');
        assert.strictEqual(controller.getRuntimeState().progressConfidence, 'OPAQUE');
    });

    await test('54.4 Prev/Next navigation flushes old episode progress first', async () => {
        const { controller, progressService } = createHarness();
        const mockVideo = new MockVideoElement();

        const mockSeasonvar = new SeasonvarAdapter({
            getVideoSources: async () => [{ url: 'test.mp4' }],
            renderPlayer: async (cont) => {
                cont.appendChild(mockVideo);
                return mockVideo;
            }
        });
        controller.registerAdapter(mockSeasonvar);

        await controller.play({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 7,
            providerId: 'seasonvar'
        });

        mockVideo.triggerLoadedMetadata(3000);
        mockVideo.triggerTimeUpdate(2100);

        // Change selection to S3E8
        controller.setSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 8,
            initialTimestamp: 0
        });

        const saved = await progressService.getProgress(404900);
        assert.strictEqual(saved.season, '3 сезон');
        assert.strictEqual(saved.episode, '7 серия');
        assert.strictEqual(saved.timestamp, 2100);
    });

    // =========================================================================
    // PART 55: STALE EVENTS & GENERATION TOKEN PROTECTION
    // =========================================================================
    console.log('\n--- Part 55: Stale Event & Generation Token Protection ---');

    await test('55.1 Stale mount token events are ignored by updateRuntimeState', () => {
        const { controller } = createHarness();
        controller.mountRequestId = 5;

        const committed = controller.updateRuntimeState({ currentTime: 500 }, 4, controller.runtimeState.mediaIdentity);
        assert.strictEqual(committed, false, 'Event with stale token 4 must be rejected');
        assert.strictEqual(controller.getRuntimeState().currentTime, 0);
    });

    await test('55.2 Mismatched S/E media identity events are rejected', () => {
        const { controller } = createHarness();
        controller.runtimeState.mediaIdentity = { kinopoiskId: 404900, seasonNumber: 2, episodeNumber: 5 };

        const committed = controller.updateRuntimeState({ currentTime: 600 }, controller.mountRequestId, {
            kinopoiskId: 404900,
            seasonNumber: 1,
            episodeNumber: 3
        });

        assert.strictEqual(committed, false, 'Telemetry from mismatched S1E3 must be rejected');
    });

    await test('55.3 Delayed timeupdate from previous native video is ignored after switch', async () => {
        const { controller, progressService } = createHarness();
        const oldVideo = new MockVideoElement();
        const newVideo = new MockVideoElement();

        let mountCount = 0;
        const mockSeasonvar = new SeasonvarAdapter({
            getVideoSources: async () => [{ url: 'test.mp4' }],
            renderPlayer: async (cont) => {
                mountCount++;
                const vid = mountCount === 1 ? oldVideo : newVideo;
                cont.appendChild(vid);
                return vid;
            }
        });
        controller.registerAdapter(mockSeasonvar);

        // Mount S1E1
        await controller.play({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 1,
            providerId: 'seasonvar'
        });

        // Mount S1E2
        await controller.play({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 2,
            providerId: 'seasonvar'
        });

        // Old video fires delayed timeupdate from E1
        oldVideo.triggerTimeUpdate(999);

        assert.strictEqual(controller.getRuntimeState().currentTime, 0, 'Old video event must not update new runtime state');
        assert.strictEqual(controller.getRuntimeState().mediaIdentity.episodeNumber, 2);
    });

    // =========================================================================
    // PART 56: OPAQUE PROVIDERS (VIDSRC & RUTUBE)
    // =========================================================================
    console.log('\n--- Part 56: Opaque Provider Protection ---');

    await test('56.1 VidSrc mount does NOT overwrite stored timestamp with 0', async () => {
        const { controller, progressService } = createHarness();
        controller.registerAdapter(new VidSrcAdapter());

        // Prepopulate storage with existing Seasonvar progress (t=1800)
        await progressService.saveProgress(404900, {
            season: '2 сезон',
            episode: '4 серия',
            timestamp: 1800,
            movieId: 404900
        });

        await controller.play({
            kinopoiskId: 404900,
            imdbId: 'tt0903747',
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 2,
            episodeNumber: 4,
            providerId: 'vidsrc'
        });

        // Attempt flush
        await controller.flushProgress({ force: true });

        const saved = await progressService.getProgress(404900);
        assert.strictEqual(saved.timestamp, 1800, 'VidSrc must never overwrite stored timestamp with 0');
    });

    await test('56.2 Rutube mount starts as OPAQUE without false telemetry', async () => {
        const { controller } = createHarness();
        const mockRutube = new RutubeAdapter({
            getVideoSources: async () => [{ url: 'https://rutube.ru/play/embed/123' }],
            renderPlayer: async (cont) => {
                const iframe = { tagName: 'IFRAME', src: 'https://rutube.ru/play/embed/123' };
                cont.appendChild(iframe);
                return iframe;
            }
        });
        controller.registerAdapter(mockRutube);

        await controller.play({
            kinopoiskId: 301,
            title: 'Матрица',
            mediaType: 'movie',
            providerId: 'rutube'
        });

        const runtime = controller.getRuntimeState();
        assert.strictEqual(runtime.progressConfidence, 'OPAQUE');
        assert.strictEqual(runtime.supportsTimestampResume, false);
        assert.strictEqual(runtime.supportsEnded, false);
    });

    // =========================================================================
    // PART 57: PARTIAL PROVIDERS (KINOGO / EX-FS)
    // =========================================================================
    console.log('\n--- Part 57: Partial Provider Telemetry ---');

    await test('57.1 handleProgressUpdate marks telemetry as PARTIAL confidence', () => {
        const { controller } = createHarness();
        controller.runtimeState.mediaIdentity = { kinopoiskId: 404900, seasonNumber: 1, episodeNumber: 2 };

        controller.handleProgressUpdate({
            season: '1 сезон',
            episode: '2 серия',
            timestamp: 450,
            movieId: 404900
        });

        const runtime = controller.getRuntimeState();
        assert.strictEqual(runtime.progressConfidence, 'PARTIAL');
        assert.strictEqual(runtime.currentTime, 450);
    });

    await test('57.2 handleProgressUpdate normalizes string and numeric S/E', async () => {
        const { controller, progressService } = createHarness();
        controller.runtimeState.mediaIdentity = { kinopoiskId: 404900, seasonNumber: 3, episodeNumber: 5 };

        controller.handleProgressUpdate({
            season: '3 сезон',
            episode: '5 серия',
            timestamp: 820,
            movieId: 404900
        });

        const saved = await progressService.getProgress(404900);
        assert.strictEqual(saved.season, '3 сезон');
        assert.strictEqual(saved.episode, '5 серия');
        assert.strictEqual(saved.timestamp, 820);
    });

    // =========================================================================
    // PART 58: CLEANUP & LIFECYCLE
    // =========================================================================
    console.log('\n--- Part 58: Cleanup & Controller Destruction ---');

    await test('58.1 close() detaches video listeners and flushes progress', async () => {
        const { controller, progressService } = createHarness();
        const mockVideo = new MockVideoElement();

        const mockSeasonvar = new SeasonvarAdapter({
            getVideoSources: async () => [{ url: 'test.mp4' }],
            renderPlayer: async (cont) => {
                cont.appendChild(mockVideo);
                return mockVideo;
            }
        });
        controller.registerAdapter(mockSeasonvar);

        await controller.play({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 1,
            providerId: 'seasonvar'
        });

        mockVideo.triggerLoadedMetadata(3000);
        mockVideo.triggerTimeUpdate(750);

        controller.close();

        const saved = await progressService.getProgress(404900);
        assert.strictEqual(saved.timestamp, 750);
        assert.strictEqual(controller.activeVideoElement, null);
    });

    await test('58.2 destroy() clears subscribers and increments mount token', async () => {
        const { controller } = createHarness();
        let listenerCalls = 0;

        controller.subscribeRuntime(() => {
            listenerCalls++;
        });

        const initialToken = controller.mountRequestId;
        controller.destroy();

        assert.ok(controller.mountRequestId > initialToken, 'destroy must invalidate mount token');
        assert.strictEqual(controller.runtimeListeners.size, 0, 'destroy must clear all runtime subscribers');
    });

    // =========================================================================
    // PART 59: MOVIES & SPECIALS
    // =========================================================================
    console.log('\n--- Part 59: Movies & Specials Compatibility ---');

    await test('59.1 Movie runtime handles null season and episode cleanly', async () => {
        const { controller } = createHarness();
        const mockVideo = new MockVideoElement();

        class MockMovieAdapter extends BasePlaybackAdapter {
            constructor() {
                super('mock-movie', 'Mock Movie');
            }
            supportsMovies() { return true; }
            supportsSeries() { return false; }
            supportsProgressTracking() { return true; }
            supportsDuration() { return true; }
            supportsEnded() { return true; }
            supportsTimestampResume() { return true; }
            getProgressConfidence() { return 'RELIABLE'; }
            async mount(container) {
                container.appendChild(mockVideo);
                return { element: mockVideo };
            }
        }
        controller.registerAdapter(new MockMovieAdapter());

        await controller.play({
            kinopoiskId: 301,
            title: 'Матрица',
            mediaType: 'movie',
            providerId: 'mock-movie'
        });

        const runtime = controller.getRuntimeState();
        assert.strictEqual(runtime.mediaIdentity.seasonNumber, null);
        assert.strictEqual(runtime.mediaIdentity.episodeNumber, null);
    });

    await test('59.2 Specials (Season 0) preserves seasonNumber 0 in media identity', async () => {
        const { controller } = createHarness();
        const mockVideo = new MockVideoElement();

        const mockAdapter = new SeasonvarAdapter({
            getVideoSources: async () => [{ url: 'special.mp4' }],
            renderPlayer: async (cont) => {
                cont.appendChild(mockVideo);
                return mockVideo;
            }
        });
        controller.registerAdapter(mockAdapter);

        await controller.play({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 0,
            episodeNumber: 2,
            providerId: 'seasonvar'
        });

        const runtime = controller.getRuntimeState();
        assert.strictEqual(runtime.mediaIdentity.seasonNumber, 0);
        assert.strictEqual(runtime.mediaIdentity.episodeNumber, 2);
    });

    // =========================================================================
    // PART 60: SCOPE DISCIPLINE
    // =========================================================================
    console.log('\n--- Part 60: Scope Discipline Assertions ---');

    await test('60.1 Auto-next and completion detection remain deferred to Phase 3F/3G', () => {
        const controllerCode = fs.readFileSync('src/shared/services/player/PlaybackController.js', 'utf8');
        assert.ok(!controllerCode.includes('autoNextCountdown'), 'Auto-next countdown must not be present in Phase 3E');
        assert.ok(!controllerCode.includes('triggerAutoNext'), 'triggerAutoNext must not be present in Phase 3E');
    });

    console.log(`\n🎉 ALL ${passedCount} Phase 3E PlaybackRuntimeState & Telemetry Tests Passed Successfully!`);
}

runAllTests().catch((err) => {
    console.error('Test run failed:', err);
    process.exit(1);
});
