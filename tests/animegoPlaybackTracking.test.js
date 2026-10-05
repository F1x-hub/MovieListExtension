const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');
const { AnimeGoAdapter } = require('../src/shared/services/player/adapters/AnimeGoAdapter');

console.log('🧪 Running AnimeGo playback tracking tests...');

// A <video> stand-in: real events, writable media state.
function createVideo() {
    const video = new EventTarget();
    Object.assign(video, { currentTime: 0, duration: 0, paused: true, ended: false });
    video.fire = (type, patch = {}) => {
        Object.assign(video, patch);
        video.dispatchEvent(new Event(type));
    };
    return video;
}

(async () => {
    // 1. AnimeGo reports reliable progress, so the host may track and auto-advance.
    const adapter = new AnimeGoAdapter();
    assert.equal(adapter.supportsProgressTracking(), true);
    assert.equal(adapter.supportsEnded(), true);
    assert.equal(adapter.supportsTimestampResume(), true);
    assert.equal(adapter.getProgressConfidence(), 'RELIABLE');
    assert.equal(adapter.supportsAutoNext(), true, 'direct episodes + ended + reliable progress enable auto-next');

    // 2. attachExternalVideo: progress, resume, completion and ended for a parser-mounted video.
    const saved = [];
    const completed = [];
    const progressService = { saveProgress: async (movieId, payload) => { saved.push({ movieId, ...payload }); } };
    const episodeHistoryService = {
        markCompleted: async (movieId, season, episode, options) => { completed.push({ movieId, season, episode, source: options.source }); }
    };
    const controller = new PlaybackController({ progressService, episodeHistoryService });
    controller.setSelection({
        kinopoiskId: 501,
        mediaType: 'tv-series',
        seasonNumber: 2,
        episodeNumber: 3,
        initialTimestamp: 300,
        providerId: 'animego',
        title: 'Solo Leveling'
    });
    controller.setActiveProvider('animego');
    const ended = [];
    controller.subscribeEnded(event => ended.push(event));

    const video = createVideo();
    const tokenBefore = controller.mountRequestId;
    assert.equal(controller.attachExternalVideo(video, { providerId: 'animego' }), true);
    assert.equal(controller.mountRequestId, tokenBefore + 1, 'a new tracking generation');
    assert.equal(controller.getRuntimeState().progressConfidence, 'RELIABLE');

    video.fire('loadedmetadata', { duration: 1400 });
    assert.equal(video.currentTime, 300, '"Continue watching" resumes the saved position');

    video.fire('timeupdate', { currentTime: 420, paused: false });
    video.fire('pause', { paused: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    const pausedWrite = saved.at(-1);
    assert.equal(pausedWrite.movieId, 501);
    assert.equal(pausedWrite.season, '2 сезон');
    assert.equal(pausedWrite.episode, '3 серия');
    assert.equal(pausedWrite.timestamp, 420);
    assert.equal(pausedWrite.providerId, 'animego');

    video.fire('ended', { currentTime: 1400, ended: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(saved.at(-1).completed, true);
    assert.deepEqual(completed, [{ movieId: 501, season: 2, episode: 3, source: 'AUTO_RELIABLE' }],
        'the episode is marked watched automatically');
    assert.equal(ended.length, 1, 'auto-next is offered');
    assert.equal(ended[0].selection.episodeNumber, 3);

    // 3. After an in-place switch the host re-attaches: events carry the new episode.
    controller.setSelection({ ...controller.getSelection(), episodeNumber: 4, initialTimestamp: 0 });
    assert.equal(controller.attachExternalVideo(video, { providerId: 'animego' }), true);
    video.fire('timeupdate', { currentTime: 60, paused: false, ended: false });
    video.fire('pause', { paused: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(saved.at(-1).episode, '4 серия');
    video.fire('ended', { currentTime: 1400, ended: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(completed.at(-1).episode, 4, 'completion is edge-triggered per attached episode');

    // 4. Detaching (source switch, iframe fallback) stops all reports.
    const writes = saved.length;
    controller.detachExternalVideo();
    video.fire('timeupdate', { currentTime: 90, paused: false, ended: false });
    video.fire('pause', { paused: true });
    video.fire('ended', { ended: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(saved.length, writes);
    assert.equal(ended.length, 2);

    // 5. Nothing to attach without a registered provider, video or selection.
    assert.equal(controller.attachExternalVideo(null, { providerId: 'animego' }), false);
    assert.equal(controller.attachExternalVideo(createVideo(), { providerId: 'missing' }), false);

    // 6. Host wiring and player ownership of the position.
    const movieDetails = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');
    assert.match(movieDetails, /this\.refreshProviderDubSelector\?\.\(null\);\s*this\.playbackController\?\.detachExternalVideo\?\.\(\);/,
        'a source switch stops tracking the previous video');
    assert.match(movieDetails, /this\.bindProviderVideoTracking\?\.\(sourceChanged \? parserId : null\);/,
        'a mounted parser source is tracked');
    assert.match(movieDetails, /if \(nativeSelectionApplied\) this\.bindProviderVideoTracking\?\.\(activeProvider\);/,
        'an in-place episode switch re-attaches tracking');
    assert.match(movieDetails, /adapter\?\.supportsInPlaceSelection\?\.\(\) === true\s*&& adapter\.getProgressConfidence\?\.\(\) === 'RELIABLE'/);
    const parser = fs.readFileSync('src/shared/services/parsers/AnimeGoParser.js', 'utf8');
    assert.match(parser, /video\.dataset\.progressOwner = 'canonical';/,
        'the player does not restore its own local position on top of ProgressService');

    console.log('✅ AnimeGo playback tracking tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
