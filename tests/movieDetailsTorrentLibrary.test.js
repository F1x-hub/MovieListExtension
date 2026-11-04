import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const movieDetailsSource = fs.readFileSync(path.join(root, 'src/pages/movie-details/movie-details.js'), 'utf8');
// Torrent workspace methods are installed onto MovieDetailsManager from TorrentSourcePanel.js.
const torrentPanelSource = fs.readFileSync(path.join(root, 'src/pages/movie-details/TorrentSourcePanel.js'), 'utf8');
const source = `${movieDetailsSource}\n${torrentPanelSource}`;
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
assert.ok(panel?.querySelector('#torrentSourcesPane'));
const executableSource = `${torrentPanelSource}
${movieDetailsSource
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
manager.torrentLanguageFilter = 'all';
manager.torrentSort = 'recommended';

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
    ['ultra', 'high', 'full', 'low'],
    'recommended order prioritizes release quality before swarm size'
);

// Without the service's details the panel reads the release name by the same rules.
for (const [title, bucket] of [
    ['Inception [2010, UHD BDRip 1080p, HDR10]', '1080p'],
    ['Inception [2010, UHD BDRemux 2160p, HDR10]', '4k'],
    ['Dune 4K (Denis Villeneuve) [2021]', '4k'],
    ['Фильм (2010) WEB-DL 4К', '4k'],
    ['Фильм (2010) BDRip 1080р', '1080p'],
    ['Film 2020 2K WEB-DL', '2k'],
    ['Film 2024 1440p WEB-DL', '2k'],
    ['Film 2024 1080i HDTV', '1080p'],
    ['Film.2024.2160p.WEB-DL.HEVC', '4k'],
    ['Kari-gurashi no Arietti [2010, MV] BDRip 1040p rus', '1080p'],
    ['Film 2024 BDRip 1920x800', '1080p'],
    ['Avatar [2009, FullHD 1080p, 720p]', '1080p'],
    ['Kari-gurashi no Arietti [2010, MV] BDRip 400p rus', 'sd'],
    ['Spirited Away [2001, DVDRip]', 'sd'],
    ['Karigurashi no Arrietty 2010 DUB HDRip - RUSSIAN', 'sd'],
    ['Karigurashi no Arrietty [2010, BDRip]', 'sd'],
    ['Karigurashi no Arrietty [2010, Blu-ray]', 'unknown'],
    ['1917 (2019)', 'unknown']
]) {
    assert.equal(manager.getTorrentQualityBucket({ title }), bucket, title);
}
assert.equal(
    manager.getTorrentQualityBucket({ title: 'Example without a size', quality: '1080p' }),
    '1080p',
    'the short quality still answers when the name states nothing'
);
assert.equal(
    manager.getTorrentQualityBucket({ title: 'Inception [2010, UHD BDRip 1080p]', quality: '4K 2160p' }),
    '1080p',
    'a stale short quality from an older service does not override the release name'
);
assert.equal(manager.getTorrentQualityDetails({ title: 'Film [2010, BDRemux 1080p]' }).source, 'remux');

const qualitySources = [
    {
        sourceId: 'web-dl',
        title: 'Obsession.2026.1080p.AMZN.WEB-DL.DDP5.1.H264.MP4-BTM',
        quality: '1080p',
        seeders: 200,
        sizeBytes: 5_000
    },
    {
        sourceId: 'telesync',
        title: 'Obsession.2026.1080p.TELESYNC.x264-UNiON',
        quality: '1080p',
        seeders: 20_000,
        sizeBytes: 5_500
    },
    {
        sourceId: 'english',
        title: 'Obsession (2026) [1080p AMZN WEB-DL H264 ENG MULTISUB] BTM',
        quality: '1080p',
        seeders: 100,
        sizeBytes: 5_100
    }
];
assert.deepEqual(
    manager.getVisibleTorrentSources(qualitySources).map(source => source.sourceId),
    ['english', 'web-dl', 'telesync'],
    'recommended order demotes telesync below clean web releases'
);
assert.equal(manager.getTorrentSourceLanguageLabel(qualitySources[2]), 'EN');
manager.torrentLanguageFilter = 'en';
assert.deepEqual(
    manager.getVisibleTorrentSources(qualitySources).map(source => source.sourceId),
    ['english'],
    'language filter keeps English audio releases'
);
manager.torrentLanguageFilter = 'all';

const russianRelease = {
    sourceId: 'russian-release',
    title: 'Obsession [2025, WEB-DL 720p] Dub (HDRezka Studio) + MVO (HDRezka Studio) + Original Eng + Sub Rus, Eng',
    quality: '720p',
    seeders: 100,
    sizeBytes: 5_000
};
assert.equal(manager.getTorrentSourceLanguageLabel(russianRelease), 'RU + EN');
manager.torrentLanguageFilter = 'ru';
assert.deepEqual(
    manager.getVisibleTorrentSources([russianRelease]).map(source => source.sourceId),
    ['russian-release'],
    'Russian audio markers and the original English track are recognized together'
);
manager.torrentLanguageFilter = 'all';

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
        <button id="torrentTabSources" data-torrent-tab="sources"><span data-torrent-tab-count></span></button>
        <button id="torrentTabDownloads" data-torrent-tab="downloads"><span data-torrent-tab-count></span></button>
        <div id="torrentSourcesPane">
            <div id="torrentSourceControls" hidden>
                <button data-quality-filter="all"></button>
                <button data-quality-filter="4k"></button>
                <button data-quality-filter="1080p"></button>
            </div>
            <select id="torrentSourceLanguageFilter"><option value="all">Все языки</option></select>
            <div id="torrentSourceList" role="list"></div>
            <div id="torrentSourceSkeleton" hidden></div>
        </div>
    </section>
`);
context.document = renderDom.window.document;
manager.elements = {
    torrentSourcePanel: renderDom.window.document.querySelector('#torrentSourcePanel'),
    torrentSourcesPane: renderDom.window.document.querySelector('#torrentSourcesPane'),
    torrentSourceSkeleton: renderDom.window.document.querySelector('#torrentSourceSkeleton'),
    torrentTabSources: renderDom.window.document.querySelector('#torrentTabSources'),
    torrentTabDownloads: renderDom.window.document.querySelector('#torrentTabDownloads'),
    torrentSourceList: renderDom.window.document.querySelector('#torrentSourceList'),
    torrentSourceControls: renderDom.window.document.querySelector('#torrentSourceControls'),
    torrentSourceLanguageFilter: renderDom.window.document.querySelector('#torrentSourceLanguageFilter'),
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
assert.equal(
    manager.elements.torrentSourceList.querySelectorAll('.torrent-source-card__select').length,
    21,
    'the panel list shows every distinct release instead of paging'
);
assert.equal(manager.elements.torrentTabSources.querySelector('[data-torrent-tab-count]').textContent, '21');
assert.equal(manager.elements.torrentSourceControls.querySelector('[data-quality-filter="4k"]').hidden, true, 'a quality nothing was found in is not offered');
assert.equal(manager.elements.torrentSourceControls.querySelector('[data-quality-filter="1080p"]').hidden, false);

const headlineCard = manager.elements.torrentSourceList.querySelector('.torrent-source-card__select');
assert.match(headlineCard.querySelector('.torrent-source-card__head').textContent, /^1080p/, 'quality leads the row');
assert.match(headlineCard.querySelector('.torrent-source-card__meta').textContent, /test/, 'size and tracker stay on the row');
assert.equal(headlineCard.querySelector('.torrent-source-card__seeds').textContent, '10');
assert.equal(headlineCard.title, headlineCard.querySelector('.torrent-source-card__title').textContent, 'the full release name stays reachable');
assert.equal(headlineCard.querySelector('.torrent-source-card__badge')?.textContent, 'Рекомендуем');
assert.deepEqual(
    { ...manager.getTorrentSourceHeadline({ qualityDetails: { score: 1, resolution: 2160, label: '2160p · BDRip · HEVC' } }) },
    { lead: '4K', detail: 'BDRip · HEVC' }
);
assert.deepEqual(
    { ...manager.getTorrentSourceHeadline({ qualityDetails: { score: 1, label: 'HDRip' } }) },
    { lead: 'HDRip', detail: '' },
    'a release without a resolution leads with what is known'
);

const thinSwarm = [{ sourceId: 'thin', title: 'Thin 1080p', quality: '1080p', provider: 'test', seeders: 2, sizeBytes: 1_000 }];
manager.torrentSources = thinSwarm;
manager.renderTorrentSources(thinSwarm);
assert.equal(
    manager.elements.torrentSourceList.querySelector('.torrent-source-card__badge'),
    null,
    'a release almost nobody seeds is not advertised as the best choice'
);
assert.ok(manager.elements.torrentSourceList.querySelector('.torrent-source-card__seeds.is-low'));
manager.torrentSources = Array.from({ length: 21 }, (_, index) => ({
    sourceId: `source-${index}`,
    title: `Example ${index}`,
    quality: '1080p',
    provider: 'test',
    seeders: 10,
    sizeBytes: 1_000
}));

manager.setTorrentSourceControlsVisible(true);
manager.torrentQualityFilter = '4k';
manager.renderTorrentSources(manager.torrentSources);
assert.equal(manager.elements.torrentSourceControls.hidden, false);
assert.equal(manager.elements.torrentSourceControls.querySelector('[data-quality-filter="4k"]').hidden, false, 'the active filter stays reachable');
assert.equal(manager.elements.torrentSourceList.querySelectorAll('.torrent-source-card__select').length, 0);
assert.match(
    manager.elements.torrentSourceList.querySelector('.torrent-source-empty').textContent,
    /выбранным фильтрам/i,
    'empty filters keep the picker available and explain how to recover'
);
assert.ok(manager.elements.torrentSourceList.querySelector('[data-torrent-reset-filters]'));
manager.torrentQualityFilter = 'all';

manager.torrentSources = [];
manager.torrentSearchState = { status: 'running', found: 0 };
manager.renderTorrentSources([]);
assert.match(
    manager.elements.torrentSourceStatus.textContent,
    /Ищем раздачи/i,
    'an empty intermediate batch must not be reported as a completed empty search'
);
assert.equal(manager.elements.torrentSourceSkeleton.hidden, false, 'an empty running search shows placeholders');
assert.equal(manager.elements.torrentSourcePanel.dataset.searching, 'true');
assert.equal(manager.elements.torrentSourceControls.hidden, true);

manager.torrentSearchState = { status: 'completed', found: 0 };
manager.renderTorrentSources([]);
assert.ok(manager.elements.torrentSourceList.querySelector('[data-torrent-retry]'), 'an empty search offers another attempt');
assert.equal(manager.elements.torrentSourceSkeleton.hidden, true);

manager.setTorrentPanelTab('downloads');
assert.equal(manager.elements.torrentDownloadLibrary.hidden, false);
assert.equal(manager.elements.torrentSourcesPane.hidden, true);
assert.equal(manager.elements.torrentTabDownloads.getAttribute('aria-selected'), 'true');
assert.equal(manager.elements.torrentTabSources.tabIndex, -1);
manager.setTorrentPanelTab('sources');

// Toggling the panel keeps a fresh search, but never one the service has expired.
manager.torrentSources = [{ sourceId: 'kept', title: 'Kept', quality: '1080p', seeders: 3, sizeBytes: 1_000 }];
manager.torrentSearchState = { status: 'completed', found: 1 };
manager.torrentSearchKey = manager.getTorrentSearchKey(manager.selectedMovie);
manager.torrentSearchFinishedAt = Date.now();
assert.equal(manager.isTorrentSearchReusable(manager.selectedMovie), true);
manager.torrentSearchFinishedAt = Date.now() - 11 * 60 * 1000;
assert.equal(manager.isTorrentSearchReusable(manager.selectedMovie), false);
manager.torrentSearchFinishedAt = Date.now();
manager.torrentSearchKey = 'another-episode';
assert.equal(manager.isTorrentSearchReusable(manager.selectedMovie), false);
manager.torrentSearchKey = null;
manager.torrentSources = [];
manager.torrentSearchState = { status: 'running', found: 0 };

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
cancellationManager.startTorrentDownloadMonitoring(monitoredMovie, 1);
await flushMonitor();
assert.equal(monitorRequestStarted, true);
cancellationManager.stopTorrentDownloadMonitoring();
await flushMonitor();
assert.equal(monitorRequestAborted, true);

// The torrent button toggles the panel; reopening keeps a fresh search instead of repeating it.
{
    const toggleDom = new JSDOM(`<section id="torrentSourcePanel" hidden tabindex="-1">
        <div id="torrentSourceStatus"></div>
        <button id="torrentSourceSearchBtn" hidden></button>
        <div id="torrentSourceList"></div>
        <div id="torrentSourceControls" hidden></div>
    </section><button id="torrentEntryBtn"></button><div id="videoContainer" tabindex="-1"></div>`);
    const doc = toggleDom.window.document;
    const previousDocument = context.document;
    context.document = doc;
    const toggleManager = Object.create(context.__MovieDetailsManager.prototype);
    let searches = 0;
    const movie = { tmdbId: 7, name: 'Toggle', year: 2010 };
    toggleManager.selectedMovie = movie;
    toggleManager.torrentRequestId = 0;
    toggleManager.torrentDownloadMonitorToken = 0;
    toggleManager.torrentDownloadRequestToken = 0;
    toggleManager.torrentSources = [];
    toggleManager.torrentDownloads = [];
    toggleManager.elements = {
        torrentSourcePanel: doc.querySelector('#torrentSourcePanel'),
        torrentSourceStatus: doc.querySelector('#torrentSourceStatus'),
        torrentSourceSearchBtn: doc.querySelector('#torrentSourceSearchBtn'),
        torrentSourceList: doc.querySelector('#torrentSourceList'),
        torrentSourceControls: doc.querySelector('#torrentSourceControls'),
        videoContainer: doc.querySelector('#videoContainer')
    };
    toggleManager.refreshMediaPlayerReadiness = async () => true;
    toggleManager.isTorrentAvailable = () => true;
    toggleManager.isTorrentMovie = () => true;
    toggleManager.getMediaPlayerTmdbId = () => 7;
    toggleManager.updateActiveSourceButton = () => {};
    toggleManager.mediaPlayerService = {
        getCapabilities: async () => ({ torrents: { movies: { supported: true, status: 'ready' } } }),
        listDownloads: async () => [],
        cancelMovieSourceSearch: async () => true,
        searchMovieSourcesIncrementally: async () => {
            searches += 1;
            return { sources: [{ sourceId: 'kept', title: 'Kept 1080p', quality: '1080p', provider: 'test', seeders: 9, sizeBytes: 1_000 }] };
        }
    };
    await toggleManager.toggleTorrentPanel();
    assert.equal(toggleManager.elements.torrentSourcePanel.hidden, false);
    assert.equal(searches, 1);
    assert.equal(doc.querySelector('#torrentEntryBtn').getAttribute('aria-expanded'), 'true');
    assert.equal(doc.querySelector('#torrentEntryBtn').getAttribute('data-torrent-count'), '1');
    await toggleManager.toggleTorrentPanel();
    assert.equal(toggleManager.elements.torrentSourcePanel.hidden, true, 'a second press closes the panel');
    assert.equal(doc.querySelector('#torrentEntryBtn').getAttribute('aria-expanded'), 'false');
    assert.equal(doc.activeElement?.id, 'torrentEntryBtn', 'closing returns focus to the button that opens it');
    await toggleManager.toggleTorrentPanel();
    assert.equal(toggleManager.elements.torrentSourcePanel.hidden, false);
    assert.equal(searches, 1, 'reopening keeps the finished search');
    assert.equal(toggleManager.elements.torrentSourceList.querySelectorAll('.torrent-source-card__select').length, 1);
    toggleManager.stopTorrentDownloadMonitoring();
    toggleManager.torrentSearchFinishedAt = Date.now() - 11 * 60 * 1000;
    toggleManager.closeTorrentPicker();
    await toggleManager.toggleTorrentPanel();
    assert.equal(searches, 2, 'an expired search runs again');
    toggleManager.stopTorrentDownloadMonitoring();
    context.document = previousDocument;
}

const emptyResultStatus = async searchState => {
    const statusManager = Object.create(context.__MovieDetailsManager.prototype);
    const statuses = [];
    statusManager.mediaPlayerService = { listDownloads: async () => [] };
    statusManager.selectedMovie = monitoredMovie;
    statusManager.torrentRequestId = 1;
    statusManager.torrentSources = [];
    statusManager.torrentSearchJobId = null;
    statusManager.torrentSearchState = searchState;
    statusManager.isTorrentRequestCurrent = () => true;
    statusManager.getMatchingTorrentDownloads = () => [];
    statusManager.resolveTorrentActiveDownload = () => {};
    statusManager.renderTorrentDownloads = () => {};
    statusManager.setTorrentSourceStatus = text => statuses.push(text);
    statusManager.torrentDownloads = [];
    await statusManager.refreshTorrentDownloads(monitoredMovie, 1);
    return statuses;
};
assert.deepEqual(
    Array.from(await emptyResultStatus({ status: 'completed', found: 0 })),
    ['Для этого фильма раздачи не найдены.'],
    'a download poll must not hide that the search found nothing'
);
assert.deepEqual(
    Array.from(await emptyResultStatus({ status: 'error', found: 0 })),
    [],
    'a download poll must not replace a search error'
);
assert.deepEqual(
    Array.from(await emptyResultStatus({ status: 'running', found: 0 })),
    [],
    'a download poll must not replace the running search status'
);
assert.deepEqual(
    Array.from(await emptyResultStatus({ status: 'idle', found: 0 })),
    [],
    'before any search the downloads tab count speaks for itself'
);

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
