/**
 * Downloads page: library rules, the navigation entry that exists only once
 * MediaPlayer is connected, and the Movie Details route that plays one saved copy.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const Model = require('../src/pages/downloads/DownloadsLibraryModel.js');
const Navigation = require('../src/shared/components/Navigation.js');

const GB = 1024 ** 3;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const record = (overrides) => ({
    id: uuid(overrides.n),
    mediaType: 'movie',
    tmdbId: 100 + overrides.n,
    title: `Фильм ${overrides.n}`,
    provider: 'Rutracker',
    quality: '1080p',
    status: 'complete',
    progress: 1,
    totalBytes: 2 * GB,
    downloadedBytes: 0,
    downloadSpeedBytesPerSecond: 0,
    seasonNumber: null,
    episodeNumber: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides
});

// ---------- Model ----------

const downloads = [
    record({ n: 1, title: 'Дюна: Часть вторая', status: 'downloading', progress: 0.5, totalBytes: 24 * GB, downloadedBytes: 12 * GB, downloadSpeedBytesPerSecond: 10_000_000, createdAt: '2026-11-08T08:00:00.000Z', updatedAt: '2026-11-08T08:00:00.000Z' }),
    record({ n: 2, title: 'Оппенгеймер', status: 'paused', progress: 41, totalBytes: 10 * GB }),
    record({ n: 3, title: 'Ёлки', status: 'error', progress: 0.1, totalBytes: 4 * GB }),
    record({ n: 4, title: 'Интерстеллар', status: 'complete', totalBytes: 14 * GB, createdAt: '2026-10-01T10:00:00.000Z' }),
    record({ n: 5, title: 'Во все тяжкие', mediaType: 'tv', tmdbId: 1396, seasonNumber: 1, episodeNumber: 2, status: 'complete' }),
    record({ n: 6, title: 'Во все тяжкие', mediaType: 'tv', tmdbId: 1396, seasonNumber: 1, episodeNumber: 1, status: 'downloading', progress: 0.25, downloadSpeedBytesPerSecond: 5_000_000 }),
    record({ n: 7, title: 'Planet.Earth.III.1080p', tmdbId: null, status: 'complete', totalBytes: 3 * GB }),
    { id: '', title: 'broken' },
    null
];

const items = Model.groupDownloads(downloads);
assert.equal(items.length, 6, 'one card per film record, one per series, invalid records dropped');
const series = items.find(item => item.kind === 'series');
assert.equal(series.key, 'tv:1396');
assert.deepEqual(series.records.map(Model.episodeCode), ['S01E01', 'S01E02'], 'episodes are ordered');
const unlinked = items.find(item => !item.linked);
assert.equal(unlinked.tmdbId, null);
assert.equal(unlinked.kind, 'movie');

assert.equal(Model.percent({ progress: 0.5 }), 50, 'a fraction is a share of one');
assert.equal(Model.percent({ progress: 41 }), 41, 'older services report percent');
assert.equal(Model.percent({ status: 'complete', progress: 0 }), 100);
assert.equal(Model.downloadedBytes({ status: 'complete', totalBytes: 5 }), 5);
assert.equal(Model.downloadedBytes({ status: 'paused', progress: 0.5, totalBytes: 10 }), 5, 'derived from progress without a byte count');
assert.equal(Model.downloadedBytes({ status: 'downloading', downloadedBytes: 99, totalBytes: 10 }), 10, 'never more than the file');

assert.deepEqual(Model.filterCounts(items), { all: 6, active: 2, ready: 3, paused: 1, error: 1 },
    'a series counts once per filter that one of its episodes matches');

const activeEntries = Model.visibleEntries(items, { filter: 'active' });
assert.deepEqual(activeEntries.map(entry => entry.item.key).sort(), [`movie:${uuid(1)}`, 'tv:1396'].sort());
assert.deepEqual(activeEntries.find(entry => entry.item.key === 'tv:1396').records.map(r => r.id), [uuid(6)],
    'a filtered series shows only its matching episodes');

const byActivity = Model.visibleEntries(items, { sort: 'activity' }).map(entry => entry.item.title);
assert.equal(byActivity[0], 'Дюна: Часть вторая', 'active downloads come first, newest first');
assert.ok(byActivity.indexOf('Ёлки') < byActivity.indexOf('Оппенгеймер'), 'errors before paused');
assert.ok(byActivity.indexOf('Оппенгеймер') < byActivity.indexOf('Интерстеллар'), 'paused before finished');
assert.equal(Model.visibleEntries(items, { sort: 'size' })[0].item.title, 'Дюна: Часть вторая');
assert.equal(Model.visibleEntries(items, { sort: 'title' })[0].item.title, 'Во все тяжкие');

assert.deepEqual(Model.visibleEntries(items, { query: 'елки' }).map(entry => entry.item.title), ['Ёлки'], 'ё and е match');
assert.deepEqual(Model.visibleEntries(items, { query: 'planet earth' }).map(entry => entry.item.title), ['Planet.Earth.III.1080p'],
    'dots in release names match spaces');
assert.deepEqual(
    Model.visibleEntries(items, { query: 'breaking', titleOf: item => (item.tmdbId === 1396 ? ['Во все тяжкие', 'Breaking Bad'] : []) })
        .map(entry => entry.item.key),
    ['tv:1396'],
    'the original title from TMDB is searchable'
);

const summary = Model.summarize(items);
assert.equal(summary.cards, 6);
assert.equal(summary.activeCount, 2);
assert.equal(summary.downloadSpeed, 15_000_000);
assert.ok(summary.onDiskBytes > 12 * GB + 14 * GB, 'finished files count in full, unfinished by what is on disk');

const allEntries = Model.visibleEntries(items, {});
const pruned = Model.pruneSelection(new Set([uuid(1), uuid(2), 'gone']), Model.visibleEntries(items, { filter: 'active' }));
assert.deepEqual([...pruned], [uuid(1)], 'selection keeps only what is still shown');
const selection = Model.selectionSummary(new Set([uuid(1), uuid(2), uuid(3), uuid(4)]), allEntries);
assert.equal(selection.count, 4);
assert.deepEqual(selection.pausable.map(r => r.id), [uuid(1)]);
assert.deepEqual(selection.resumable.map(r => r.id).sort(), [uuid(2), uuid(3)].sort());
assert.equal(Model.selectionState(series.records, new Set()), 'none');
assert.equal(Model.selectionState(series.records, new Set([uuid(5)])), 'some');
assert.equal(Model.selectionState(series.records, new Set([uuid(5), uuid(6)])), 'all');

assert.equal(Model.canPlay({ status: 'complete' }), true);
assert.equal(Model.canPlay({ status: 'starting' }), true);
assert.equal(Model.canPlay({ status: 'paused' }), false, 'as in the film panel: paused copies resume first');
assert.equal(Model.canResume({ status: 'error' }), true);

// ---------- Navigation entry ----------

const ready = { enabled: true, status: 'ready', installPath: 'D:\\MediaPlayer Suite' };
assert.equal(Navigation.isMediaPlayerSetUp(true, ready), true);
assert.equal(Navigation.isMediaPlayerSetUp(false, ready), false, 'MediaPlayer turned off in Settings: no entry');
assert.equal(Navigation.isMediaPlayerSetUp(undefined, undefined), false, 'never connected: no entry');
assert.equal(Navigation.isMediaPlayerSetUp(true, { enabled: true, status: 'path_required' }), false, 'setup not finished');
assert.equal(Navigation.isMediaPlayerSetUp(true, { enabled: true, status: 'verifying', installPath: 'D:\\x' }), false);
assert.equal(Navigation.isMediaPlayerSetUp(true, { ...ready, status: 'error', errorCode: 'connection_failed' }), true,
    'connected, but the service does not answer now: the page says so');
assert.equal(Navigation.isMediaPlayerSetUp(true, { ...ready, status: 'error', errorCode: 'setup_verification_failed' }), false,
    'an installation that never passed verification has no entry');

const navigationSource = fs.readFileSync(path.join(root, 'src/shared/components/Navigation.js'), 'utf8');
assert.match(navigationSource, /id="navDownloadsBtn"[^>]*style="display: \$\{this\.showDownloads \? 'inline-flex' : 'none'\};"/,
    'the entry renders hidden unless MediaPlayer is set up, so nothing appears and disappears');
assert.match(navigationSource, /case 'downloads':\s*return chrome\.runtime\.getURL\('src\/pages\/downloads\/downloads\.html'\)/);

const pageHtml = fs.readFileSync(path.join(root, 'src/pages/downloads/downloads.html'), 'utf8');
const scripts = [...pageHtml.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]);
for (const script of ['../../shared/services/MediaPlayerService.js', '../../shared/services/TMDBService.js',
    '../../shared/components/ConfirmDialog.js', '../../shared/components/Navigation.js', 'DownloadsLibraryModel.js', 'downloads.js']) {
    assert.ok(scripts.includes(script), `downloads.html loads ${script}`);
}
assert.ok(scripts.indexOf('DownloadsLibraryModel.js') < scripts.indexOf('downloads.js'), 'the model loads before the page');
for (const script of scripts) {
    assert.ok(fs.existsSync(path.resolve(root, 'src/pages/downloads', script)), `${script} exists`);
}

// ---------- Movie Details route ----------

const movieDetailsSource = fs.readFileSync(path.join(root, 'src/pages/movie-details/movie-details.js'), 'utf8');
const torrentPanelSource = fs.readFileSync(path.join(root, 'src/pages/movie-details/TorrentSourcePanel.js'), 'utf8');
const replaced = [];
const location = { href: 'chrome-extension://id/src/pages/movie-details/movie-details.html' };
const context = vm.createContext({
    console,
    document: { addEventListener() {} },
    window: { location, history: { state: null, replaceState: (_state, _title, url) => { replaced.push(url); location.href = url; } } },
    URL,
    URLSearchParams,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    AbortController
});
vm.runInContext(`${torrentPanelSource}\n${movieDetailsSource.replace(/^import .*?;\r?\n/gm, '')}\nthis.__MovieDetailsManager = MovieDetailsManager;`,
    context, { filename: 'movie-details.js' });
const Manager = context.__MovieDetailsManager;

(async () => {
    const id = uuid(42);
    location.href = `chrome-extension://id/src/pages/movie-details/movie-details.html?movieId=1&torrentDownload=${id}&torrentSeason=2&torrentEpisode=5`;
    const parser = Object.create(Manager.prototype);
    const route = parser.takeTorrentDownloadRoute(new URL(location.href).searchParams);
    assert.deepEqual({ ...route }, { downloadId: id, seasonNumber: 2, episodeNumber: 5 });
    assert.equal(new URL(location.href).searchParams.has('torrentDownload'), false, 'the request leaves the address');
    assert.equal(new URL(location.href).searchParams.get('movieId'), '1', 'the rest of the address stays');
    assert.equal(parser.takeTorrentDownloadRoute(new URLSearchParams('torrentDownload=../../x')), null, 'only a download ID is accepted');
    const embedded = Object.create(Manager.prototype);
    embedded.isEmbedded = true;
    assert.equal(embedded.takeTorrentDownloadRoute(new URLSearchParams(`torrentDownload=${id}`)), null, 'never inside an embedded player');

    const requests = Object.create(Manager.prototype);
    const loaded = { kinopoiskId: 47814, name: 'Весна, лето, осень, зима... и снова весна' };
    requests.torrentRequestId = 3;
    requests.selectedMovie = loaded;
    assert.equal(requests.isTorrentRequestCurrent(3, loaded), true);
    requests.selectedMovie = { ...loaded, providerRatings: { imdb: 8 } };
    assert.equal(requests.isTorrentRequestCurrent(3, loaded), true,
        'an enriched copy of the same film keeps the request: the panel must not stop on «Проверяем…»');
    requests.selectedMovie = { kinopoiskId: 301, name: 'Матрица' };
    assert.equal(requests.isTorrentRequestCurrent(3, loaded), false, 'another film makes it stale');
    requests.selectedMovie = loaded;
    assert.equal(requests.isTorrentRequestCurrent(2, loaded), false, 'a newer request makes it stale');

    function pickerHarness({ downloadsList, series = false, selection = null }) {
        const manager = Object.create(Manager.prototype);
        const calls = { play: [], search: 0, tab: [], status: [] };
        manager.selectedMovie = { kinopoiskId: 7, tmdbId: 1396, name: 'Во все тяжкие', type: series ? 'tv-series' : 'movie' };
        manager.elements = { torrentSourcePanel: { hidden: true } };
        manager.mediaPlayerService = { getCapabilities: async () => ({ torrents: { movies: { status: 'ready' }, television: { status: 'ready', supported: true } } }) };
        manager.playbackController = { getSelection: () => selection };
        manager.isTorrentMovie = () => !series;
        manager.isTorrentAvailable = () => true;
        manager.refreshMediaPlayerReadiness = async () => true;
        manager.isTorrentSearchReusable = () => false;
        manager.isTorrentRequestCurrent = () => true;
        manager.clearTorrentFileSelection = () => {};
        manager.focusTorrentRegion = () => {};
        manager.updateActiveSourceButton = () => {};
        manager.stopTorrentDownloadMonitoring = () => {};
        manager.startTorrentDownloadMonitoring = () => {};
        manager.syncTorrentPanelChrome = () => {};
        manager.ensureTorrentActiveContextFromDownloads = () => {};
        manager.getTorrentActiveDownload = () => null;
        manager.renderTorrentPlaybackStatus = () => {};
        manager.cancelActiveTorrentSearch = () => {};
        manager.setTorrentSourceStatus = (message, state) => calls.status.push([message, state]);
        manager.setTorrentPanelTab = (tab) => calls.tab.push(tab);
        manager.refreshTorrentDownloads = async () => { manager.torrentDownloads = downloadsList; return true; };
        manager.playSavedTorrent = async (downloadId) => { calls.play.push(downloadId); return true; };
        manager.searchTorrentSources = async () => { calls.search += 1; return true; };
        return { manager, calls };
    }

    const film = { id, mediaType: 'movie', tmdbId: 1396, status: 'complete' };
    let harness = pickerHarness({ downloadsList: [film] });
    assert.equal(await harness.manager.openTorrentPicker({ playDownloadId: id }), true);
    assert.deepEqual(harness.calls.play, [id], 'the routed copy plays');
    assert.equal(harness.calls.search, 0, 'no release search for a routed copy');
    assert.equal(harness.calls.tab.at(-1), 'downloads', 'the panel ends on the saved copies tab');

    harness = pickerHarness({ downloadsList: [{ ...film, tmdbId: 9 }] });
    await harness.manager.openTorrentPicker({ playDownloadId: id });
    assert.deepEqual(harness.calls.play, [], 'a copy of another film never plays');
    assert.equal(harness.calls.search, 1, 'the panel falls back to its usual search');
    assert.ok(harness.calls.status.some(([message, state]) => state === 'error' && /не найдена/.test(message)),
        'and says the copy was not found');

    harness = pickerHarness({ downloadsList: [film] });
    await harness.manager.openTorrentPicker();
    assert.deepEqual(harness.calls.play, [], 'opening the panel by hand never auto-plays');
    assert.equal(harness.calls.search, 1);

    const episode = { id, mediaType: 'tv', tmdbId: 1396, status: 'complete', seasonNumber: 2, episodeNumber: 5 };
    harness = pickerHarness({ downloadsList: [episode], series: true, selection: { seasonNumber: 2, episodeNumber: 5 } });
    let selected = null;
    harness.manager.playbackController.setContainer = () => {};
    harness.manager.playbackController.setSelection = (value) => { selected = value; };
    harness.manager.showVideoModal = () => {};
    harness.manager.populateSourceSelector = () => {};
    harness.manager.elements.videoContainer = {};
    harness.manager.elements.videoPlayerModal = {};
    let pickerArgs = null;
    const originalPicker = harness.manager.openTorrentPicker;
    harness.manager.openTorrentPicker = async (args) => { pickerArgs = args; return originalPicker.call(harness.manager, args); };
    await harness.manager.openTorrentDownloadRoute({ downloadId: id, seasonNumber: 2, episodeNumber: 5 });
    assert.equal(selected.seasonNumber, 2, 'a series selects the copy\'s episode first');
    assert.equal(selected.episodeNumber, 5);
    assert.deepEqual({ ...pickerArgs }, { playDownloadId: id });
    assert.deepEqual(harness.calls.play, [id]);

    harness = pickerHarness({ downloadsList: [episode], series: true });
    harness.manager.playbackController.setContainer = () => {};
    harness.manager.playbackController.setSelection = () => {};
    harness.manager.showVideoModal = () => {};
    harness.manager.populateSourceSelector = () => {};
    harness.manager.openTorrentPicker = async (args) => { pickerArgs = args; return true; };
    await harness.manager.openTorrentDownloadRoute({ downloadId: id });
    assert.deepEqual({ ...pickerArgs }, { playDownloadId: null }, 'an episode-less series copy only opens the panel');

    console.log('downloadsLibrary tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
