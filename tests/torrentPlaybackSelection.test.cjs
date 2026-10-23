const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MovieDetailsTorrentPanelMethods: Panel } = require('../src/pages/movie-details/TorrentSourcePanel.js');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');
const { TorrentAdapter } = require('../src/shared/services/player/adapters/TorrentAdapter');

function fixture(files) {
    const manager = Object.create(Panel.prototype);
    const calls = [];
    Object.assign(manager, {
        selectedMovie: { id: 1 }, torrentSources: [{ sourceId: 'source', title: 'Series' }],
        elements: {}, torrentRequestId: 1, torrentDownloads: [],
        getTorrentPlaybackIdentity: () => ({ mediaType: 'tv', tmdbId: 2, seasonNumber: 1, episodeNumber: 2 }),
        getTorrentMovieKey: () => 'tv:2', isTorrentRequestCurrent: () => true,
        setTorrentActiveContext: () => {}, cancelActiveTorrentSearch: () => {},
        setTorrentSourceStatus: message => calls.push(['status', message]),
        showTorrentFileSelection: (_source, values) => calls.push(['files', values]),
        mountTorrentPlaybackSession: async session => { calls.push(['mount', session]); return true; },
        formatTorrentError: error => error.message,
        mediaPlayerService: {
            capabilities: { playback: { fileSelection: true } },
            preparePlayback: async () => ({ files }),
            createPlaybackSession: async body => { calls.push(['create', body]); return { sessionId: 'session' }; },
            revokePlaybackSession: async () => calls.push(['revoke'])
        }
    });
    return { manager, calls };
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function mediaVideo(events, name, paused = false) {
    const video = { currentTime: 180, duration: 1800, readyState: 3, paused,
        volume: 0.6, muted: false, playbackRate: 1.25,
        buffered: { length: 1, end: () => 1800 }, seekable: { length: 1, end: () => 1800 },
        querySelector: () => null,
        pause() { this.paused = true; events.push(`${name}:pause`); },
        async play() { this.paused = false; events.push(`${name}:play`); },
        removeAttribute(attribute) { events.push(`${name}:remove:${attribute}`); },
        load() { events.push(`${name}:load`); }
    };
    video._movieExtensionHls = { media: video, destroy: () => events.push(`${name}:destroy`) };
    return video;
}

function audioSwitchFixture(paused = false) {
    const manager = Object.create(Panel.prototype);
    const events = [];
    const pending = [];
    const video = mediaVideo(events, 'old', paused);
    Object.assign(manager, {
        selectedMovie: { id: 1 }, torrentDownloads: [{ id: 'saved' }], elements: {},
        torrentRequestId: 1, torrentPlaybackGeneration: 0, torrentProgressMonitorToken: 0,
        torrentPlaybackSession: { sessionId: 'old', downloadId: 'saved' }, torrentPlaybackVideo: video,
        currentHls: video._movieExtensionHls,
        torrentTracksSnapshot: { audio: [{ streamIndex: 1 }, { streamIndex: 2 }, { streamIndex: 3 }], selectedAudioStreamIndex: 1 },
        getMatchingTorrentDownloads() { return this.torrentDownloads; }, getTorrentMovieKey: () => '1',
        isTorrentRequestCurrent: () => true, isTorrentMovie: () => true,
        setTorrentActiveContext() {}, setTorrentSourceStatus() {}, renderTorrentPlaybackStatus() {},
        beginSourceSwitchRequest() {}, unmountActivePlayer() {}, resetHlsRecoveryState() {}, focusTorrentRegion() {},
        refreshTorrentDownloads: async () => [], startTorrentProgressMonitoring() {},
        formatTorrentError: error => error.message,
        async renderCustomPlayer() {
            this.torrentPlaybackVideo = mediaVideo(events, 'new', true);
            this.currentHls = this.torrentPlaybackVideo._movieExtensionHls;
            this.latestTorrentPlaybackProgress = { playback: { isComplete: true } };
            this.waitForTorrentPlaybackStart(this.torrentPlaybackVideo, () => true);
        },
        mediaPlayerService: {
            playDownload(_id, options) {
                const request = deferred();
                pending.push({ ...request, options });
                return request.promise;
            },
            async revokePlaybackSession(id) { events.push(`revoke:${id}`); },
            async warmPlaybackSession() {
                assert.equal(video.paused, paused, 'Warming must preserve the old video playback state');
                assert.equal(events.includes('old:destroy'), false);
            },
            getPlaybackProgress: async () => ({ playback: { isReady: true, isComplete: true } })
        }
    });
    return { manager, events, pending, video };
}

(async () => {
    const files = [
        { fileId: 'first', name: 'S01E01.mkv', seasonNumber: 1, episodeNumber: 1 },
        { fileId: 'second', name: 'S01E02.mkv', seasonNumber: 1, episodeNumber: 2 }
    ];
    const exact = fixture(files);
    assert.equal(await exact.manager.startTorrentPlayback('source'), true);
    assert.equal(exact.calls.find(call => call[0] === 'create')[1].fileId, 'second');
    const ambiguous = fixture([...files, { ...files[1], fileId: 'other' }]);
    assert.equal(await ambiguous.manager.startTorrentPlayback('source'), false);
    assert.equal(ambiguous.calls.some(call => call[0] === 'create'), false);
    const unknown = fixture([{ fileId: 'unknown', name: 'episode.mkv', seasonNumber: null, episodeNumber: null }]);
    assert.equal(await unknown.manager.startTorrentPlayback('source'), false);
    assert.equal(unknown.calls.some(call => call[0] === 'mount'), false);
    const stale = fixture(files);
    stale.manager.mediaPlayerService.preparePlayback = async () => {
        stale.manager.torrentPlaybackGeneration += 1;
        return { files };
    };
    assert.equal(await stale.manager.startTorrentPlayback('source'), false);
    assert.equal(stale.calls.some(call => call[0] === 'create'), false);

    const staleSaved = fixture(files);
    staleSaved.manager.torrentDownloads = [{ id: 'saved' }];
    staleSaved.manager.getMatchingTorrentDownloads = () => staleSaved.manager.torrentDownloads;
    staleSaved.manager.mediaPlayerService.playDownload = async () => {
        staleSaved.manager.torrentPlaybackGeneration += 1;
        throw new Error('obsolete request');
    };
    assert.equal(await staleSaved.manager.playSavedTorrent('saved'), false);
    assert.equal(staleSaved.calls.some(call => call[0] === 'status'), false, 'stale saved playback failure cannot overwrite current UI');

    const replacement = fixture(files);
    replacement.manager.torrentPlaybackGeneration = 1;
    replacement.manager.torrentPlaybackResume = { currentTime: 3600, paused: true };
    const order = [];
    replacement.manager.mediaPlayerService.warmPlaybackSession = async () => order.push('warm');
    replacement.manager.mediaPlayerService.getPlaybackProgress = async () => {
        assert.deepEqual(order, ['warm']);
        return { playback: { isReady: true, availableDurationSeconds: 3605 } };
    };
    assert.equal(await replacement.manager.waitForTorrentReplacement({ sessionId: 'new' }, 1, {}, 1), true);
    assert.equal(replacement.calls.some(call => call[0] === 'revoke'), false);

    const audio = fixture(files);
    audio.manager.torrentPlaybackSession = { downloadId: 'saved' };
    audio.manager.torrentTracksSnapshot = { audio: [{ streamIndex: 2 }], selectedAudioStreamIndex: 1 };
    audio.manager.torrentPlaybackVideo = { currentTime: 3600, paused: true, volume: 0.5, playbackRate: 1,
        querySelector: () => null, pause() {} };
    audio.manager.latestTorrentPlaybackProgress = { state: 'complete' };
    audio.manager.playSavedTorrent = async (_id, options) => { audio.options = options; return true; };
    assert.equal(await audio.manager.changeTorrentAudioTrack(2), true);
    assert.equal(audio.options.resume.currentTime, 3600);
    assert.equal(audio.options.resume.paused, true);
    let resumed = false;
    audio.manager.torrentPlaybackVideo.paused = false;
    audio.manager.torrentPlaybackVideo.play = async () => { resumed = true; };
    audio.manager.playSavedTorrent = async () => false;
    assert.equal(await audio.manager.changeTorrentAudioTrack(2), false);
    assert.equal(resumed, false, 'A rejected replacement must not issue a stale play command');
    assert.equal(audio.manager.torrentPlaybackVideo.paused, false, 'The previous active audio keeps playing');

    for (const paused of [false, true]) {
        for (const staleFailure of [false, true]) {
            const overlap = audioSwitchFixture(paused);
            const first = overlap.manager.changeTorrentAudioTrack(2);
            const latest = overlap.manager.changeTorrentAudioTrack(3);
            assert.equal(overlap.pending[0].options.resume, overlap.pending[1].options.resume,
                'Overlapping choices share the original playback intent');
            assert.equal(overlap.pending[1].options.resume.paused, paused);
            assert.equal(overlap.events.includes('old:pause'), false, 'Preparation must not pause the old session');
            if (staleFailure) overlap.pending[0].reject(new Error('obsolete request'));
            else overlap.pending[0].resolve({ sessionId: 'obsolete', downloadId: 'saved' });
            assert.equal(await first, false);
            assert.equal(overlap.events.includes('old:play'), false, 'A stale completion must not resume the old video');
            assert.ok(overlap.manager.torrentAudioSwitch, 'The latest switch retains its intent');
            overlap.video.currentTime = 205;
            overlap.pending[1].resolve({ sessionId: 'latest', downloadId: 'saved', preferHls: true, hlsUrl: 'latest.m3u8' });
            assert.equal(await latest, true);
            assert.equal(overlap.manager.torrentPlaybackVideo.currentTime, 205, 'Swap uses the position reached while warming');
            assert.equal(overlap.manager.torrentPlaybackVideo.paused, paused);
            assert.equal(overlap.manager.torrentPlaybackVideo.volume, 0.6);
            assert.equal(overlap.manager.torrentPlaybackVideo.playbackRate, 1.25);
            assert.equal(overlap.events.filter(event => event === 'old:destroy').length, 1);
            assert.equal(overlap.events.filter(event => event === 'revoke:old').length, 1);
            assert.equal(overlap.manager.torrentAudioSwitch, null);
        }
        const failure = audioSwitchFixture(paused);
        const failedSwitch = failure.manager.changeTorrentAudioTrack(2);
        failure.pending[0].reject(new Error('latest request failed'));
        assert.equal(await failedSwitch, false);
        assert.equal(failure.video.paused, paused);
        assert.equal(failure.events.some(event => /old:(?:pause|play|destroy|load)/.test(event)), false,
            'A failed latest replacement leaves the old session untouched');
    }

    for (const initiallyPaused of [false, true]) {
        const liveIntent = audioSwitchFixture(initiallyPaused);
        const progress = deferred();
        const warming = deferred();
        liveIntent.manager.mediaPlayerService.getPlaybackProgress = () => {
            warming.resolve();
            return progress.promise;
        };
        const changed = liveIntent.manager.changeTorrentAudioTrack(2);
        liveIntent.pending[0].resolve({ sessionId: 'live-intent', downloadId: 'saved' });
        await warming.promise;
        liveIntent.video.currentTime = 248;
        liveIntent.video.volume = 0.3;
        liveIntent.video.muted = true;
        liveIntent.video.playbackRate = 1.5;
        if (initiallyPaused) await liveIntent.video.play();
        else liveIntent.video.pause();
        progress.resolve({ playback: { isReady: true, isComplete: true } });
        assert.equal(await changed, true);
        const replacementVideo = liveIntent.manager.torrentPlaybackVideo;
        assert.equal(replacementVideo.currentTime, 248, 'A user seek during preparation belongs to the replacement');
        assert.equal(replacementVideo.paused, !initiallyPaused, 'The latest explicit user pause/play takes precedence');
        assert.equal(replacementVideo.volume, 0.3);
        assert.equal(replacementVideo.muted, true);
        assert.equal(replacementVideo.playbackRate, 1.5);
    }

    const lateProgress = audioSwitchFixture();
    const obsoleteProgress = deferred();
    const obsoleteWarming = deferred();
    let progressRequests = 0;
    lateProgress.manager.mediaPlayerService.getPlaybackProgress = () => {
        if (++progressRequests === 1) {
            obsoleteWarming.resolve();
            return obsoleteProgress.promise;
        }
        return Promise.resolve({ playback: { isReady: true, isComplete: true } });
    };
    const obsoleteSwitch = lateProgress.manager.changeTorrentAudioTrack(2);
    lateProgress.pending[0].resolve({ sessionId: 'late-obsolete', downloadId: 'saved' });
    await obsoleteWarming.promise;
    const currentSwitch = lateProgress.manager.changeTorrentAudioTrack(3);
    lateProgress.pending[1].resolve({ sessionId: 'current', downloadId: 'saved' });
    assert.equal(await currentSwitch, true);
    const currentVideo = lateProgress.manager.torrentPlaybackVideo;
    const currentHls = lateProgress.manager.currentHls;
    obsoleteProgress.resolve({ playback: { isReady: true, isComplete: true } });
    assert.equal(await obsoleteSwitch, false, 'Stale progress cannot commit an obsolete audio choice');
    assert.equal(lateProgress.manager.torrentPlaybackVideo, currentVideo);
    assert.equal(lateProgress.manager.currentHls, currentHls);
    assert.equal(lateProgress.manager.torrentPlaybackSession.sessionId, 'current');
    assert.equal(lateProgress.events.includes('new:destroy'), false, 'A stale response cannot dispose the replacement');
    assert.equal(lateProgress.events.filter(event => event === 'old:destroy').length, 1);
    assert.ok(lateProgress.events.includes('revoke:late-obsolete'));

    const failedPreparation = audioSwitchFixture();
    failedPreparation.manager.mediaPlayerService.getPlaybackProgress = async () => ({ playback: { state: 'failed' } });
    const failedPreparedSwitch = failedPreparation.manager.changeTorrentAudioTrack(2);
    failedPreparation.pending[0].resolve({ sessionId: 'failed-preparation', downloadId: 'saved' });
    assert.equal(await failedPreparedSwitch, false);
    assert.equal(failedPreparation.manager.torrentPlaybackVideo, failedPreparation.video);
    assert.equal(failedPreparation.manager.torrentPlaybackSession.sessionId, 'old');
    assert.equal(failedPreparation.events.some(event => /old:(?:pause|play|destroy|load)/.test(event)), false,
        'A terminal preparation failure leaves the old video playing');
    assert.ok(failedPreparation.events.includes('revoke:failed-preparation'));
    assert.equal(failedPreparation.manager.torrentPlaybackResume, null);

    for (const newerHlsOwner of [false, true]) {
        const revoked = audioSwitchFixture();
        const oldHls = revoked.video._movieExtensionHls;
        const unrelatedHls = { destroy: () => revoked.events.push('unrelated:destroy') };
        if (newerHlsOwner) revoked.manager.currentHls = unrelatedHls;
        revoked.manager.playbackController = {
            externalVideoElement: revoked.video,
            flushProgress: () => revoked.events.push('flush'),
            detachExternalVideo: () => revoked.events.push('detach')
        };
        const obsoleteRequest = revoked.manager.changeTorrentAudioTrack(2);
        await revoked.manager.revokeTorrentPlaybackSession();
        assert.equal(revoked.video.paused, true);
        assert.equal(revoked.manager.torrentPlaybackVideo, null);
        assert.equal(revoked.manager.torrentPlaybackSession, null);
        assert.equal(revoked.manager.currentHls, newerHlsOwner ? unrelatedHls : null);
        assert.equal(revoked.events.filter(event => event === 'old:destroy').length, 1);
        assert.ok(revoked.events.includes('old:remove:src') && revoked.events.includes('old:load'));
        assert.equal(revoked.events.includes('unrelated:destroy'), false);
        assert.notEqual(revoked.video._movieExtensionHls, oldHls);
        revoked.pending[0].resolve({ sessionId: 'revoked-replacement', downloadId: 'saved' });
        assert.equal(await obsoleteRequest, false, 'Full revocation invalidates pending audio sessions');
        assert.equal(revoked.events.includes('old:play'), false);
        assert.ok(revoked.events.includes('revoke:revoked-replacement'));
        await revoked.manager.revokeTorrentPlaybackSession();
        assert.equal(revoked.events.filter(event => event === 'old:destroy').length, 1, 'Repeated revocation is harmless');
    }

    const movieDetailsSource = fs.readFileSync(path.join(__dirname, '../src/pages/movie-details/movie-details.js'), 'utf8');
    const movieContext = vm.createContext({ console, window: {}, document: { addEventListener() {} } });
    vm.runInContext(`${movieDetailsSource.replace(/^import .*?;\r?\n/gm, '')}\nthis.Manager = MovieDetailsManager;`, movieContext);
    const changeVideoSource = movieContext.Manager.prototype.changeVideoSource;
    const sourceSwitch = audioSwitchFixture();
    Object.assign(sourceSwitch.manager, {
        sourceSwitchRequestId: 0, closeEpisodePicker() {},
        beginSourceSwitchRequest() { return ++this.sourceSwitchRequestId; },
        isSourceSwitchRequestCurrent(id) { return id === this.sourceSwitchRequestId; },
        updateActiveSourceButton() {}, updateSourceGuidance() {}, updatePlayerHeaderTitle() {}, updatePlayerNavigationControls() {},
        saveLastSource: async () => {}, renderDefaultPlayer: url => sourceSwitch.events.push(`render:${url}`)
    });
    const oldRevoke = deferred();
    sourceSwitch.manager.mediaPlayerService.revokePlaybackSession = id => {
        sourceSwitch.events.push(`revoke:${id}`);
        return oldRevoke.promise;
    };
    const staleSource = changeVideoSource.call(sourceSwitch.manager, 'first.mp4');
    assert.equal(sourceSwitch.video.paused, true, 'Leaving torrents stops the old video before waiting for the server');
    assert.equal(await changeVideoSource.call(sourceSwitch.manager, 'latest.mp4'), true);
    oldRevoke.resolve();
    assert.equal(await staleSource, false, 'A delayed revoke cannot supersede the latest source request');
    assert.equal(sourceSwitch.events.includes('render:first.mp4'), false);
    assert.equal(sourceSwitch.events.filter(event => event === 'old:destroy').length, 1);
    assert.equal(sourceSwitch.events.filter(event => event === 'revoke:old').length, 1);
    sourceSwitch.manager.mediaPlayerReady = true;
    sourceSwitch.manager.openTorrentPicker = async () => true;
    assert.equal(await changeVideoSource.call(sourceSwitch.manager, 'mediaplayer:torrent'), true,
        'Reopening the current torrent workspace does not revoke playback');

    const saved = [];
    const controller = new PlaybackController({ progressService: { saveProgress: async (_id, value) => saved.push(value) } });
    const adapter = new TorrentAdapter();
    controller.registerAdapter(adapter);
    controller.setSelection({ kinopoiskId: 1, title: 'Series', mediaType: 'tv', seasonNumber: 1, episodeNumber: 2,
        providerId: 'mediaplayer:torrent' });
    const native = new EventTarget();
    Object.assign(native, { currentTime: 29, duration: 30, paused: false,
        _torrentPlaybackSnapshot: { totalDurationSeconds: 1800, isComplete: false } });
    assert.equal(controller.attachExternalVideo(native, { providerId: adapter.id }), true);
    native.dispatchEvent(new Event('timeupdate'));
    assert.equal(controller.getRuntimeState().duration, 1800, 'Growing HLS duration is not the episode duration');
    assert.equal(controller.hasCompletedCurrentSession, false);
    native.dispatchEvent(new Event('ended'));
    assert.equal(controller.getRuntimeState().isEnded, false, 'An unfinished HLS stream cannot complete an episode');
    await controller.flushProgress({ force: true });
    assert.equal(saved.at(-1).episode, '2 серия');
    assert.equal(saved.at(-1).timestamp, 29);
    controller.detachExternalVideo();
    console.log('PASS torrent selection, owned media revocation, stale source switches and overlapping audio preparation');
})().catch(error => { console.error(error); process.exitCode = 1; });
