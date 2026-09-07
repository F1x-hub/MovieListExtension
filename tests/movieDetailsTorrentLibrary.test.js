import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/pages/movie-details/movie-details.js'), 'utf8');
assert.match(source, /ensureTorrentPlaybackStatusMarkup/);
assert.match(source, /data-status-available/);
assert.match(source, /Доступно для просмотра/);
assert.match(source, /durationchange/);
assert.match(source, /AbortController/);
assert.match(source, /torrentDownloadAbortController/);
assert.match(source, /torrentProgressAbortController/);
const html = fs.readFileSync(path.join(root, 'src/pages/movie-details/movie-details.html'), 'utf8');
const htmlDom = new JSDOM(html);
const panel = htmlDom.window.document.querySelector('#torrentSourcePanel');
const playbackStatus = htmlDom.window.document.querySelector('#torrentPlaybackStatus');
assert.equal(htmlDom.window.document.querySelectorAll('#torrentPlaybackStatus').length, 1);
assert.equal(playbackStatus?.parentElement, panel);
assert.equal(panel?.querySelectorAll('.torrent-playback-status').length, 1);
assert.ok(panel?.querySelector('#torrentSourceDisclosure'));
const executableSource = `${source
    .replace(/^import .*?;\r?\n/gm, '')}
this.__MovieDetailsManager = MovieDetailsManager;`;
const context = vm.createContext({
    console,
    document: { addEventListener() {} },
    window: {},
    URLSearchParams,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    AbortController
});
vm.runInContext(executableSource, context, { filename: 'movie-details.js' });

const manager = Object.create(context.__MovieDetailsManager.prototype);
const restoredTorrent = Object.create(context.__MovieDetailsManager.prototype);
let torrentPickerOpened = 0;
restoredTorrent.mediaPlayerReady = true;
restoredTorrent.openTorrentPicker = async () => { torrentPickerOpened += 1; return true; };
restoredTorrent.renderDefaultPlayer = () => { throw new Error('Torrent marker must never mount an iframe'); };
assert.equal(await restoredTorrent.changeVideoSource('mediaplayer:torrent'), true);
assert.equal(torrentPickerOpened, 1, 'restoring the torrent provider opens its workspace');
assert.equal(await restoredTorrent.togglePlayPause('mediaplayer:torrent'), true);
assert.equal(torrentPickerOpened, 2, 'the play action routes the torrent marker without an iframe');
let pausedTorrentVideo = false;
restoredTorrent.torrentPlaybackSession = { sessionId: 'active' };
restoredTorrent.elements = { videoContainer: { querySelector: () => ({ paused: false, pause() { pausedTorrentVideo = true; } }) } };
assert.equal(restoredTorrent.togglePlayPause('http://127.0.0.1:3000/session'), true);
assert.equal(pausedTorrentVideo, true, 'pausing preserves the mounted torrent video');

const blockedTorrent = Object.create(context.__MovieDetailsManager.prototype);
blockedTorrent.mediaPlayerReady = false;
let blockedPickerOpened = false;
blockedTorrent.openTorrentPicker = async () => { blockedPickerOpened = true; return true; };
assert.equal(
    await blockedTorrent.changeVideoSource('mediaplayer:torrent'),
    false,
    'torrent source cannot open before MediaPlayer readiness'
);
assert.equal(blockedPickerOpened, false);
manager.torrentQualityFilter = 'all';
manager.torrentSort = 'recommended';
manager.torrentVisibleSourceLimit = 10;

const sources = [
    { sourceId: 'low', title: 'Example 720p', quality: '720p', seeders: 100, sizeBytes: 1_000 },
    { sourceId: 'ultra', title: 'Example 2160p', quality: '4K', seeders: 5, sizeBytes: 8_000 },
    { sourceId: 'full', title: 'Example 1080p', quality: '1080p', seeders: 20, sizeBytes: 3_000 },
    { sourceId: 'high', title: 'Example 1440p', quality: '2K', seeders: 20, sizeBytes: 5_000 }
];

assert.equal(manager.getTorrentQualityRank(sources[1]), 4);
assert.equal(manager.getTorrentQualityRank(sources[3]), 3);
assert.equal(manager.getTorrentQualityRank(sources[2]), 2);
assert.equal(manager.getTorrentQualityBucket(sources[0]), '720p');
assert.equal(manager.formatTorrentPlaybackDuration(26), '00:26');
assert.equal(manager.formatTorrentPlaybackDuration(7200), '2:00:00');
assert.deepEqual(
    manager.getVisibleTorrentSources(sources).map(source => source.sourceId),
    ['low', 'high', 'full', 'ultra'],
    'recommended order prioritizes seeders, then quality, then size'
);

const duplicateSources = [
    {
        sourceId: 'duplicate-first',
        provider: 'noname-club',
        title: 'Star Wars VI 2160p BluRay',
        quality: '4K 2160p',
        seeders: 13,
        sizeBytes: 11 * 1024 ** 3 + 100 * 1024 ** 2
    },
    {
        sourceId: 'duplicate-preferred',
        provider: 'torrentgalaxyclone',
        title: 'star wars vi 2160p bluray',
        quality: '4K 2160p',
        seeders: 20,
        sizeBytes: 11 * 1024 ** 3 + 300 * 1024 ** 2
    }
];
assert.deepEqual(
    manager.getVisibleTorrentSources(duplicateSources).map(source => source.sourceId),
    ['duplicate-preferred'],
    'visually identical releases collapse and keep the healthier swarm'
);

const renderDom = new JSDOM(`
    <section id="torrentSourcePanel">
        <div id="torrentSourceStatus"></div>
        <section id="torrentPlaybackStatus" hidden></section>
        <section id="torrentDownloadLibrary" hidden>
            <div id="torrentDownloadList" role="list"></div>
        </section>
        <details id="torrentSourceDisclosure" hidden>
            <span data-torrent-disclosure-count></span>
            <div id="torrentSourceControls" hidden>
                <button data-quality-filter="all"></button>
                <button data-quality-filter="4k"></button>
            </div>
            <div id="torrentSourceList" role="list"></div>
            <button id="torrentSourceShowMoreBtn" hidden></button>
        </details>
    </section>
`);
context.document = renderDom.window.document;
manager.elements = {
    torrentSourceList: renderDom.window.document.querySelector('#torrentSourceList'),
    torrentSourceDisclosure: renderDom.window.document.querySelector('#torrentSourceDisclosure'),
    torrentSourceControls: renderDom.window.document.querySelector('#torrentSourceControls'),
    torrentSourceShowMoreBtn: renderDom.window.document.querySelector('#torrentSourceShowMoreBtn'),
    torrentSourceStatus: renderDom.window.document.querySelector('#torrentSourceStatus'),
    torrentPlaybackStatus: renderDom.window.document.querySelector('#torrentPlaybackStatus'),
    torrentDownloadLibrary: renderDom.window.document.querySelector('#torrentDownloadLibrary'),
    torrentDownloadList: renderDom.window.document.querySelector('#torrentDownloadList')
};
manager.selectedMovie = { tmdbId: 522941, name: 'Example 4K' };
manager.torrentSources = Array.from({ length: 21 }, (_, index) => ({
    sourceId: `source-${index}`,
    title: `Example ${index}`,
    quality: '1080p',
    provider: 'test',
    seeders: 10,
    sizeBytes: 1_000
}));
manager.torrentSearchState = { status: 'completed', found: 21 };
manager.setTorrentSourceStatus = (message) => {
    manager.elements.torrentSourceStatus.textContent = message;
};
manager.renderTorrentSources(manager.torrentSources);
assert.equal(manager.elements.torrentSourceList.querySelectorAll('.torrent-source-card__select').length, 10);
assert.equal(manager.elements.torrentSourceList.querySelectorAll('[role="listitem"]').length, 10);
assert.equal(manager.elements.torrentSourceShowMoreBtn.hidden, false);
manager.torrentVisibleSourceLimit = 20;
manager.renderTorrentSources(manager.torrentSources);
assert.equal(manager.elements.torrentSourceList.querySelectorAll('.torrent-source-card__select').length, 20);

manager.setTorrentSourceControlsVisible(true);
manager.torrentQualityFilter = '4k';
manager.renderTorrentSources(manager.torrentSources);
assert.equal(manager.elements.torrentSourceDisclosure.hidden, false);
assert.equal(manager.elements.torrentSourceControls.hidden, false);
assert.equal(manager.elements.torrentSourceList.querySelectorAll('.torrent-source-card__select').length, 0);
assert.match(
    manager.elements.torrentSourceList.querySelector('.torrent-source-empty').textContent,
    /выбранного качества/i,
    'empty quality filters keep the picker available and explain how to recover'
);
manager.torrentQualityFilter = 'all';

manager.torrentActiveContext = {
    title: 'Example 4K',
    provider: 'test',
    quality: '4K',
    sizeBytes: 4_000,
    downloadId: 'download-1'
};
manager.torrentDownloads = [{
    id: 'download-1',
    mediaType: 'movie',
    tmdbId: 522941,
    title: 'Example 4K',
    provider: 'test',
    quality: '4K',
    sizeBytes: 4_000,
    status: 'complete',
    progress: 1,
    playable: false,
    peers: 0,
    downloadSpeedBytesPerSecond: 1_000
}];
manager.torrentServiceHealth = 'unavailable';
manager.renderTorrentDownloads();
const staleDownloadCard = manager.elements.torrentDownloadList.querySelector('.torrent-download-card');
assert.equal(staleDownloadCard?.dataset.serviceHealth, 'unavailable');
assert.match(staleDownloadCard?.querySelector('.torrent-download-card__meta')?.textContent || '', /данные устарели/i);
assert.doesNotMatch(staleDownloadCard?.querySelector('.torrent-download-card__meta')?.textContent || '', /\/s/);
manager.torrentServiceHealth = 'healthy';
manager.torrentPlaybackSession = { sessionId: 'session-1' };
manager.torrentHasPlaybackSnapshot = true;
manager.torrentPlaybackAvailableDurationSeconds = 999;
manager.renderTorrentPlaybackStatus({
    state: 'downloading',
    progress: 0.4,
    playable: false,
    downloadSpeedBytesPerSecond: 1_000,
    peers: 3,
    playback: { state: 'failed', message: 'Поток временно недоступен.' }
});
assert.equal(manager.getTorrentWorkspaceState(manager.latestTorrentPlaybackProgress), 'playback-error');
assert.equal(manager.elements.torrentPlaybackStatus.hidden, true);
assert.equal(manager.elements.torrentDownloadList.querySelectorAll('.torrent-download-card').length, 1);
const playbackSummary = manager.elements.torrentDownloadList.querySelector('.torrent-download-card__playback');
assert.match(playbackSummary.textContent, /просмотр/i);
assert.match(playbackSummary.textContent, /загрузка продолжается/i);

assert.equal(manager.getTorrentWorkspaceState({ state: 'error', playback: { state: 'complete' } }), 'error');
assert.equal(manager.getTorrentWorkspaceState({ state: 'downloading', playback: { state: 'failed' } }), 'playback-error');
assert.equal(manager.getTorrentWorkspaceState({ state: 'paused', playback: { state: 'transcoding' } }), 'paused');
assert.equal(manager.getTorrentWorkspaceState({ state: 'downloading', playback: { state: 'remuxing' } }), 'remuxing');
assert.equal(manager.getTorrentWorkspaceState({ state: 'complete', playable: true }), 'complete');

manager.torrentSort = 'quality';
assert.deepEqual(
    manager.getVisibleTorrentSources(sources).map(source => source.sourceId),
    ['ultra', 'high', 'full', 'low'],
    'quality order ranks 4K above 2K, 1080p, and 720p'
);

manager.torrentQualityFilter = '2k';
assert.deepEqual(
    manager.getVisibleTorrentSources(sources).map(source => source.sourceId),
    ['high'],
    'quality filter keeps only the selected bucket'
);

const scheduledTimers = [];
context.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false };
    scheduledTimers.push(timer);
    return timer;
};
context.clearTimeout = timer => {
    if (timer) timer.cleared = true;
};

const monitoredManager = Object.create(context.__MovieDetailsManager.prototype);
const monitoredMovie = { tmdbId: 522941, name: 'Example 4K' };
let monitorCalls = 0;
monitoredManager.mediaPlayerService = {
    listDownloads: async () => {
        monitorCalls += 1;
        if (monitorCalls <= 3) throw { code: 'connection_failed' };
        return [];
    },
    isServiceUnavailableError: error => error?.code === 'connection_failed'
};
monitoredManager.elements = { torrentSourcePanel: { hidden: false } };
monitoredManager.torrentRequestId = 1;
monitoredManager.torrentServiceHealth = 'unknown';
monitoredManager.torrentDownloads = [];
monitoredManager.torrentSources = [];
monitoredManager.torrentSearchJobId = null;
monitoredManager.torrentDownloadMonitorToken = 0;
monitoredManager.torrentDownloadTimer = null;
monitoredManager.torrentDownloadRequestActive = false;
monitoredManager.torrentDownloadRequestToken = 0;
monitoredManager.torrentDownloadPollDelayMs = 2500;
monitoredManager.selectedMovie = monitoredMovie;
monitoredManager.isTorrentRequestCurrent = () => true;
monitoredManager.getMatchingTorrentDownloads = () => [];
monitoredManager.resolveTorrentActiveDownload = () => {};
monitoredManager.renderTorrentDownloads = () => {};
monitoredManager.setTorrentSourceStatus = () => {};
monitoredManager.getTorrentDownloadSummary = () => '';

const flushMonitor = () => new Promise(resolve => setImmediate(resolve));
const runNextMonitorTimer = async expectedDelay => {
    const timer = scheduledTimers.shift();
    assert.equal(timer?.delay, expectedDelay);
    await timer.callback();
    await flushMonitor();
};

monitoredManager.startTorrentDownloadMonitoring(monitoredMovie, 1);
await flushMonitor();
assert.equal(monitorCalls, 1);
assert.equal(scheduledTimers[0]?.delay, 5000);
await runNextMonitorTimer(5000);
assert.equal(monitorCalls, 2);
assert.equal(scheduledTimers[0]?.delay, 10000);
await runNextMonitorTimer(10000);
assert.equal(monitorCalls, 3);
assert.equal(scheduledTimers[0]?.delay, 20000);
await runNextMonitorTimer(20000);
assert.equal(monitorCalls, 4);
assert.equal(scheduledTimers[0]?.delay, 2500);
monitoredManager.stopTorrentDownloadMonitoring();

const cancellationManager = Object.create(context.__MovieDetailsManager.prototype);
let monitorRequestStarted = false;
let monitorRequestAborted = false;
cancellationManager.mediaPlayerService = {
    listDownloads: ({ signal } = {}) => new Promise((resolve, reject) => {
        monitorRequestStarted = true;
        signal?.addEventListener('abort', () => {
            monitorRequestAborted = true;
            reject({ code: 'request_aborted' });
        }, { once: true });
    }),
    isServiceUnavailableError: () => false,
    isRequestAbortedError: error => error?.code === 'request_aborted'
};
cancellationManager.elements = { torrentSourcePanel: { hidden: false } };
cancellationManager.torrentRequestId = 1;
cancellationManager.torrentServiceHealth = 'unknown';
cancellationManager.torrentDownloads = [];
cancellationManager.torrentSources = [];
cancellationManager.torrentSearchJobId = null;
cancellationManager.torrentDownloadMonitorToken = 0;
cancellationManager.torrentDownloadTimer = null;
cancellationManager.torrentDownloadRequestActive = false;
cancellationManager.torrentDownloadRequestToken = 0;
cancellationManager.torrentDownloadPollDelayMs = 2500;
cancellationManager.isTorrentRequestCurrent = () => true;
cancellationManager.getMatchingTorrentDownloads = () => [];
cancellationManager.resolveTorrentActiveDownload = () => {};
cancellationManager.renderTorrentDownloads = () => {};
cancellationManager.setTorrentSourceStatus = () => {};
cancellationManager.getTorrentDownloadSummary = () => '';
cancellationManager.startTorrentDownloadMonitoring(monitoredMovie, 1);
await flushMonitor();
assert.equal(monitorRequestStarted, true);
cancellationManager.stopTorrentDownloadMonitoring();
await flushMonitor();
assert.equal(monitorRequestAborted, true);

const progressCancellationManager = Object.create(context.__MovieDetailsManager.prototype);
let progressRequestStarted = false;
let progressRequestAborted = false;
progressCancellationManager.mediaPlayerService = {
    getPlaybackProgress: (_url, { signal } = {}) => new Promise((resolve, reject) => {
        progressRequestStarted = true;
        signal?.addEventListener('abort', () => {
            progressRequestAborted = true;
            reject({ code: 'request_aborted' });
        }, { once: true });
    }),
    isServiceUnavailableError: () => false,
    isRequestAbortedError: error => error?.code === 'request_aborted'
};
progressCancellationManager.torrentPlaybackSession = { sessionId: 'session-1' };
progressCancellationManager.torrentProgressMonitorToken = 0;
progressCancellationManager.torrentProgressTimer = null;
progressCancellationManager.torrentProgressRequestActive = false;
progressCancellationManager.torrentProgressPollDelayMs = 2500;
progressCancellationManager.startTorrentProgressMonitoring({
    sessionId: 'session-1',
    progressUrl: 'http://127.0.0.1:3000/progress'
});
await flushMonitor();
assert.equal(progressRequestStarted, true);
progressCancellationManager.stopTorrentProgressMonitoring();
await flushMonitor();
assert.equal(progressRequestAborted, true);
assert.equal(progressCancellationManager.torrentProgressRequestActive, false);

console.log('✅ Movie Details torrent quality and source sorting passed');
