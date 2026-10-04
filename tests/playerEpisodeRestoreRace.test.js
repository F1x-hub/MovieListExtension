const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');

const movieDetailsPath = path.join(__dirname, '../src/pages/movie-details/movie-details.js');
const searchPath = path.join(__dirname, '../src/pages/search/search.js');

function loadManager(sourcePath, globalName) {
    const listeners = new Map();
    const window = {
        location: {
            href: 'chrome-extension://test-id/src/pages/test.html',
            origin: 'chrome-extension://test-id'
        },
        addEventListener(type, listener) {
            listeners.set(type, listener);
        }
    };
    const document = {
        addEventListener() {},
        getElementById() {
            return null;
        }
    };
    const context = {
        window,
        document,
        console,
        URL,
        Map,
        Set,
        Date,
        Promise,
        JSON,
        Math,
        Number,
        parseInt,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval
    };
    context.globalThis = context;

    const source = fs.readFileSync(sourcePath, 'utf8').replace(/^import .*;\r?\n/gm, '');
    vm.createContext(context);
    new vm.Script(source, { filename: sourcePath }).runInContext(context);

    return {
        Manager: window[globalName],
        getMessageListener: () => listeners.get('message'),
        window
    };
}

function createIframe(requestId = '7') {
    return {
        contentWindow: {},
        src: 'chrome-extension://test-id/content-scripts/player-cleaner.html',
        dataset: {
            playerSourceActive: 'true',
            playerRequestId: requestId
        }
    };
}

function createMovieDetailsHarness() {
    const { Manager, getMessageListener, window } = loadManager(movieDetailsPath, 'MovieDetailsManager');
    const iframe = createIframe();
    const sent = [];
    let activeIframe = iframe;
    let selection = null;
    let selectionVersion = 0;
    let releaseProgress;

    const manager = Object.create(Manager.prototype);
    manager.elements = {
        videoContainer: {
            querySelector(selector) {
                if (selector.includes('player-source-active')) return activeIframe;
                return activeIframe;
            }
        }
    };
    manager.selectedMovie = { kinopoiskId: 42 };
    manager.sourceSwitchRequestId = 7;
    manager.pageGeneration = 1;
    manager.currentSources = [];
    manager.currentVideoUrl = 'https://provider.example/embed/42';
    manager.currentEpisode = 7;
    manager.progressService = {
        getProgress() {
            return new Promise(resolve => {
                releaseProgress = resolve;
            });
        }
    };
    manager.playbackController = {
        getSelection() {
            return selection ? { ...selection } : null;
        },
        getSelectionContext() {
            return {
                selection: selection ? { ...selection } : null,
                selectionVersion
            };
        }
    };
    manager.setPlayerSourceState = () => {};
    manager.sendAnimeSkipTimes = () => {};
    manager.watchRoomController = null;
    manager.messageListenerSetup = false;

    manager.setupPlayerMessageListener();

    return {
        activeFrameWindow: iframe.contentWindow,
        get activeIframe() {
            return activeIframe;
        },
        get selection() {
            return selection;
        },
        set selection(value) {
            selection = value;
        },
        get selectionVersion() {
            return selectionVersion;
        },
        set selectionVersion(value) {
            selectionVersion = value;
        },
        iframe,
        listener: getMessageListener(),
        manager,
        releaseProgress,
        setReleaseProgress(resolve) {
            releaseProgress = resolve;
        },
        replaceIframe(nextIframe) {
            activeIframe = nextIframe;
        },
        sent,
        origin: window.location.origin
    };
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

async function testMovieDetailsLateRestoreIsDiscarded() {
    const harness = createMovieDetailsHarness();
    harness.iframe.contentWindow.postMessage = message => harness.sent.push(message);

    let release;
    harness.manager.progressService.getProgress = () => new Promise(resolve => {
        release = resolve;
    });

    const readyPromise = harness.listener({
        data: { type: 'PLAYER_READY' },
        source: harness.activeFrameWindow,
        origin: harness.origin
    });
    await readyPromise;

    harness.selection = {
        kinopoiskId: 42,
        mediaType: 'tv-series',
        seasonNumber: 1,
        episodeNumber: 8,
        source: 'PLAYER_PROVIDER_PICKER'
    };
    harness.selectionVersion = 1;
    release({ season: '1 сезон', episode: '4 серия' });
    await flushMicrotasks();

    assert.strictEqual(
        harness.sent.filter(message => message.type === 'RESTORE_PROGRESS').length,
        0,
        'a restore started before E8 must not post stored E4 after the selection changes'
    );
    assert.strictEqual(harness.manager.currentEpisode, 7, 'stale restore must not overwrite the episode mirror');
}

async function testMovieDetailsValidRestoreIsOneShot() {
    const harness = createMovieDetailsHarness();
    harness.iframe.contentWindow.postMessage = message => harness.sent.push(message);

    const restore = { season: '1 сезон', episode: '4 серия' };
    harness.manager.progressService.getProgress = () => Promise.resolve(restore);
    harness.manager.restoreProgressForReadyIframe(harness.iframe);
    harness.manager.restoreProgressForReadyIframe(harness.iframe);
    await flushMicrotasks();

    const restoreMessages = harness.sent.filter(message => message.type === 'RESTORE_PROGRESS');
    assert.strictEqual(restoreMessages.length, 1, 'the same ready context must restore progress only once');
    assert.strictEqual(harness.manager.currentEpisode, 4, 'valid resume must keep the numeric episode mirror');
}

async function testSearchLateRestoreIsDiscarded() {
    const { Manager } = loadManager(searchPath, 'SearchPageManager');
    const oldIframe = createIframe('');
    const sent = [];
    oldIframe.contentWindow.postMessage = message => sent.push(message);
    let activeIframe = oldIframe;
    let release;
    const manager = Object.create(Manager.prototype);
    manager.elements = {
        videoContainer: {
            querySelector: () => activeIframe
        }
    };
    manager.selectedMovie = { kinopoiskId: 42 };
    manager.currentVideoUrl = 'https://provider.example/embed/42';
    manager.playerRestoreGeneration = 0;
    manager.progressRestoreAttempt = null;
    manager.progressService = {
        getProgress: () => new Promise(resolve => {
            release = resolve;
        })
    };

    manager.restoreProgressForReadyIframe(oldIframe);
    manager.invalidatePlayerRestore();
    activeIframe = createIframe('');
    release({ season: '1 сезон', episode: '4 серия' });
    await flushMicrotasks();

    assert.strictEqual(sent.length, 0, 'Search must discard restore after source/iframe invalidation');
}

function testControllerSelectionVersionAndProgressGuard() {
    const saves = [];
    const controller = new PlaybackController({
        progressService: {
            saveProgress: async (...args) => saves.push(args)
        }
    });
    controller.setSelection({
        kinopoiskId: 42,
        title: 'Series',
        mediaType: 'tv-series',
        seasonNumber: 1,
        episodeNumber: 8,
        source: 'PLAYER_PROVIDER_PICKER'
    });
    const context = controller.getSelectionContext();

    assert.strictEqual(context.selectionVersion, 1);
    assert.strictEqual(context.selection.episodeNumber, 8);

    controller.handleProgressUpdate({
        seasonNumber: 1,
        episodeNumber: 4,
        timestamp: 12,
        movieId: 42,
        selectionVersion: context.selectionVersion
    });
    assert.strictEqual(controller.getSelection().episodeNumber, 8, 'stale telemetry must not regress explicit E8');

    controller.handleProgressUpdate({
        seasonNumber: 1,
        episodeNumber: 3,
        timestamp: 18,
        movieId: 42
    });
    assert.strictEqual(controller.getSelection().episodeNumber, 8, 'unversioned stale telemetry must not regress explicit E8');

    controller.handleProgressUpdate({
        seasonNumber: 1,
        episodeNumber: 4,
        timestamp: 12,
        movieId: 42,
        origin: 'USER_PROVIDER_SELECTION'
    });
    assert.strictEqual(controller.getSelection().episodeNumber, 4, 'genuine provider selection remains accepted');
    assert.ok(
        saves.some(([, payload]) => String(payload?.episode || '').includes('4')),
        'accepted provider selection must remain persisted'
    );
}

async function testNavigationDiscardedAfterSelectionChanges() {
    const { Manager } = loadManager(movieDetailsPath, 'MovieDetailsManager');
    const manager = Object.create(Manager.prototype);
    let currentSelection = {
        kinopoiskId: 42,
        mediaType: 'tv-series',
        seasonNumber: 1,
        episodeNumber: 3,
        providerId: 'exfs'
    };
    let selectionVersion = 1;
    let releaseFlush;
    let committed = false;
    const flushBarrier = new Promise(resolve => { releaseFlush = resolve; });

    manager.selectedMovie = {
        kinopoiskId: 42,
        nameRu: 'Series',
        type: 'tv-series',
        seasons: [{ season_number: 1, episode_count: 10 }]
    };
    manager.currentEpisodes = null;
    manager.selectedSeasonNumber = null;
    manager.isEpisodePlayableByDate = () => true;
    manager.resolveAdjacentEpisode = (_movie, selection) => ({
        seasonNumber: selection.seasonNumber,
        episodeNumber: selection.episodeNumber + 1
    });
    manager.playbackController = {
        getSelection: () => ({ ...currentSelection }),
        getSelectionContext: () => ({
            selection: { ...currentSelection },
            selectionVersion
        }),
        getActiveProvider: () => 'exfs',
        flushProgress: () => flushBarrier
    };
    manager.playSelection = async () => { committed = true; };

    const navigation = manager.handlePlayerNavigate('next');
    currentSelection = { ...currentSelection, episodeNumber: 9 };
    selectionVersion = 2;
    releaseFlush();

    assert.strictEqual(await navigation, false, 'stale navigation must be cancelled after a newer selection');
    assert.strictEqual(committed, false, 'stale navigation must not commit an older adjacent episode');
}

async function testLegacyNativeProgressCannotRegressCanonicalSelection() {
    const harness = createMovieDetailsHarness();
    let handledProgress = 0;
    harness.manager.updatePlayerHeaderTitle = () => {};
    harness.manager.playbackController.getActiveProvider = () => 'exfs';
    harness.manager.playbackController.getAdapter = () => ({
        getSelectionMode: () => 'NATIVE_BRIDGE',
        supportsEpisodePicker: () => true
    });
    harness.manager.playbackController.handleProgressUpdate = () => {
        handledProgress += 1;
    };
    harness.manager.playbackController.updateSelection = patch => {
        harness.selection = { ...harness.selection, ...patch };
        harness.selectionVersion += 1;
    };
    harness.selection = {
        kinopoiskId: 42,
        mediaType: 'tv-series',
        seasonNumber: 1,
        episodeNumber: 9,
        providerId: 'exfs',
        source: 'PLAYER_PROVIDER_PICKER'
    };
    harness.selectionVersion = 4;

    const eventBase = {
        source: harness.activeFrameWindow,
        origin: harness.origin
    };
    await harness.listener({
        ...eventBase,
        data: {
            type: 'UPDATE_WATCHING_PROGRESS',
            seasonNumber: 1,
            episodeNumber: 3,
            timestamp: 20,
            origin: 'USER_PROVIDER_SELECTION'
        }
    });
    await harness.listener({
        ...eventBase,
        data: {
            type: 'EPISODE_CHANGED',
            seasonNumber: 1,
            episode: 3,
            origin: 'USER_PROVIDER_SELECTION'
        }
    });

    assert.strictEqual(harness.selection.episodeNumber, 9, 'legacy provider events must not regress canonical E9');
    assert.strictEqual(handledProgress, 0, 'legacy progress must not reach PlaybackController in native bridge mode');

    await harness.listener({
        ...eventBase,
        data: {
            type: 'EPISODE_CHANGED',
            seasonNumber: 1,
            episode: 10,
            origin: 'USER_PROVIDER_SELECTION',
            providerId: 'exfs',
            providerState: 'NATIVE_DOM'
        }
    });
    assert.strictEqual(harness.selection.episodeNumber, 10, 'native DOM confirmation must update canonical selection');
}

(async () => {
    console.log('🧪 Running player episode restore race tests...');
    await testMovieDetailsLateRestoreIsDiscarded();
    console.log('  ✅ MovieDetails discards late stored E4 after explicit E8');
    await testMovieDetailsValidRestoreIsOneShot();
    console.log('  ✅ MovieDetails keeps valid resume one-shot');
    await testSearchLateRestoreIsDiscarded();
    console.log('  ✅ Search discards late restore after invalidation');
    testControllerSelectionVersionAndProgressGuard();
    console.log('  ✅ PlaybackController versions selection and rejects stale telemetry');
    await testNavigationDiscardedAfterSelectionChanges();
    console.log('  ✅ MovieDetails cancels navigation after a newer episode selection');
    await testLegacyNativeProgressCannotRegressCanonicalSelection();
    console.log('  ✅ Legacy native events cannot regress canonical Ex-FS selection');
    console.log('✅ Player episode restore race tests passed!');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
