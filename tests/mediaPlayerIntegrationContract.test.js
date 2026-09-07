import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const manifest = JSON.parse(read('manifest.json'));
const html = read('src/pages/movie-details/movie-details.html');
const movieDetails = read('src/pages/movie-details/movie-details.js');
const serviceSource = read('src/shared/services/MediaPlayerService.js');

assert.equal(
    manifest.host_permissions.includes('http://127.0.0.1:3000/*'),
    true,
    'MovieList must be allowed to call the local MediaPlayer API'
);
assert.match(html, /shared\/services\/MediaPlayerService\.js/);
assert.match(html, /id="torrentSourcePanel"/);
assert.match(html, /id="torrentSourceList"/);
assert.match(html, /id="torrentSourceControls"/);
assert.match(html, /data-quality-filter="4k"/);
assert.match(html, /id="torrentSourceSort"/);
assert.match(html, /id="torrentDownloadLibrary"/);
assert.match(html, /id="torrentDownloadList"/);
const torrentDom = new JSDOM(html);
const torrentPanel = torrentDom.window.document.querySelector('#torrentSourcePanel');
const playbackStatus = torrentDom.window.document.querySelector('#torrentPlaybackStatus');
assert.equal(torrentDom.window.document.querySelectorAll('#torrentPlaybackStatus').length, 1);
assert.equal(playbackStatus?.parentElement, torrentPanel, 'Playback status must live inside the Torrent workspace');
assert.ok(torrentPanel?.querySelector('#torrentSourceDisclosure'), 'Results must use the workspace disclosure');
assert.ok(torrentPanel?.querySelector('#torrentSourceShowMoreBtn'), 'Results must support incremental reveal');
assert.doesNotMatch(html, /<\/section>\s*<div class="torrent-playback-status"/);
assert.match(movieDetails, /mediaplayer:torrent/);
assert.match(movieDetails, /openTorrentPicker/);
assert.match(movieDetails, /revokeTorrentPlaybackSession/);
assert.match(movieDetails, /listDownloads/);
assert.match(movieDetails, /getTorrentQualityRank/);
assert.match(movieDetails, /getVisibleTorrentSources/);
assert.match(movieDetails, /torrentSort = 'recommended'/);
assert.match(serviceSource, /getServiceHealth\(\)/);
assert.match(serviceSource, /markServiceUnavailable/);
assert.match(serviceSource, /isRequestAbortedError/);
assert.match(serviceSource, /request_aborted/);
assert.match(serviceSource, /signal/);
assert.match(movieDetails, /torrentServiceHealth/);
assert.match(movieDetails, /данные устарели/);
assert.match(movieDetails, /typeof isSeriesMedia === 'function'\) return !isSeriesMedia\(movie\)/);
assert.match(movieDetails, /movie\.seasons\) && movie\.seasons\.length > 0/);
assert.match(movieDetails, /movie\.seasonsInfo\) && movie\.seasonsInfo\.length > 0/);
assert.match(serviceSource, /com\.movielist\.mediaplayer/);
assert.match(serviceSource, /\/api\/catalog\/movie\//);
assert.match(serviceSource, /\/api\/playback\/sessions/);
assert.match(serviceSource, /async listDownloads\(options = \{\}\)/);
assert.match(serviceSource, /async playDownload\(downloadId\)/);
assert.match(serviceSource, /async pauseDownload\(downloadId\)/);
assert.match(serviceSource, /async resumeDownload\(downloadId\)/);
assert.match(serviceSource, /async deleteDownload\(downloadId\)/);
assert.doesNotMatch(serviceSource, /locator\s*:/, 'The extension client must not construct torrent locators');
const settingsHtml = read('src/pages/settings/settings.html');
const settingsCss = read('src/pages/settings/settings.css');
assert.match(settingsHtml, /shared\/services\/MediaPlayerService\.js/);
assert.match(settingsHtml, /id="torrentRetentionDays"/);
assert.match(settingsHtml, /data-target="mediaplayer"/);
assert.match(settingsHtml, /id="mediaPlayerEnabledToggle"/);
assert.match(settingsHtml, /id="mediaPlayerInstallPath"/);
assert.match(settingsHtml, /id="mediaPlayerVerifyBtn"/);
assert.match(settingsHtml, /id="mediaPlayerSetupChecks"/);
assert.match(
    settingsCss,
    /\.mediaplayer-setup-panel\[hidden\]\s*\{[\s\S]*?display:\s*none\s*!important;/,
    'The MediaPlayer setup panel must stay hidden while the integration is disabled'
);
assert.match(serviceSource, /selectInstallFolder/);
assert.match(serviceSource, /verifyInstallation/);
assert.match(serviceSource, /unknown_action:/);
assert.match(movieDetails, /this\.mediaPlayerReady && this\.isTorrentMovie\(\)/);
assert.match(serviceSource, /async getSettings\(\)/);
assert.match(serviceSource, /async updateSettings\(\{ torrentRetentionDays \}/);
assert.match(movieDetails, /pauseSavedTorrent/);
assert.match(movieDetails, /resumeSavedTorrent/);
assert.match(movieDetails, /dataset\.downloadAction = isActiveDownload \? 'pause' : 'resume'/);
assert.match(movieDetails, /Hls\.Events\.ERROR/);
assert.match(movieDetails, /startLoad\(-1\)/);
assert.match(movieDetails, /до полной загрузки/);
const mountStart = movieDetails.indexOf('async mountTorrentPlaybackSession');
const mountEnd = movieDetails.indexOf('\n    ensureTorrentPlaybackStatusMarkup', mountStart);
assert.doesNotMatch(movieDetails.slice(mountStart, mountEnd), /closeTorrentPicker\(\)/);
assert.match(movieDetails, /getTorrentWorkspaceState/);
assert.match(movieDetails, /torrentHasPlaybackSnapshot/);
assert.match(movieDetails, /torrentVisibleSourceLimit = 10/);

const requests = [];
const stored = {};
const fakeWindow = {
    MediaSource: {
        isTypeSupported: (codec) => codec.includes('av01')
            || codec.includes('avc1')
            || codec.includes('vp09')
    },
    fetch: async (url, options = {}) => {
        requests.push({ url: String(url), options });
        if (String(url).includes('/api/capabilities')) {
            return { ok: true, status: 200, json: async () => ({ torrents: { movies: { status: 'ready', supported: true } } }) };
        }
        if (String(url).endsWith('/api/settings') && options.method === 'PATCH') {
            return {
                ok: true,
                status: 200,
                json: async () => ({ torrentRetentionDays: 14, options: [0, 1, 3, 7, 14, 30] })
            };
        }
        if (String(url).endsWith('/api/settings')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ torrentRetentionDays: 7, options: [0, 1, 3, 7, 14, 30] })
            };
        }
        if (String(url).includes('/api/catalog/movie/')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ sources: [{ sourceId: 'c56a4180-65aa-42ec-a945-5fd21dec0538', title: 'Example', seeders: 4 }] })
            };
        }
        if (String(url).includes('/api/playback/sessions/') && options.method === 'DELETE') {
            return { ok: true, status: 204, json: async () => null };
        }
        if (String(url).includes('/api/playback/sessions/') && String(url).includes('/progress')) {
            return { ok: true, status: 200, json: async () => ({ progress: { state: 'downloading', progress: 0.4 } }) };
        }
        if (String(url).endsWith('/api/playback/sessions')) {
            return {
                ok: true,
                status: 201,
                json: async () => ({
                    sessionId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
                    downloadId: 'd56a4180-65aa-42ec-a945-5fd21dec0538',
                    streamUrl: '/api/playback/sessions/c56a4180-65aa-42ec-a945-5fd21dec0538/stream?token=abc',
                    hlsUrl: '/api/playback/sessions/c56a4180-65aa-42ec-a945-5fd21dec0538/master.m3u8?token=abc',
                    progressUrl: '/api/playback/sessions/c56a4180-65aa-42ec-a945-5fd21dec0538/progress?token=abc',
                    preferHls: false
                })
            };
        }
        throw new Error(`Unexpected request: ${url}`);
    },
    chrome: null,
    localStorage: {
        getItem: (key) => stored[key] || null,
        setItem: (key, value) => { stored[key] = value; },
        removeItem: (key) => { delete stored[key]; }
    }
};

fakeWindow.chrome = {
    runtime: {
        lastError: null,
        sendNativeMessage: (_host, message, callback) => {
            if (message.action === 'select_install_folder') {
                callback({ installPath: 'C:\\Apps\\MediaPlayer' });
                return;
            }
            if (message.action === 'verify_installation') {
                callback({
                    status: 'ready',
                    version: '2.4.0',
                    checks: [{ id: 'binary', label: 'MediaPlayer', status: 'pass' }]
                });
                return;
            }
            callback({ accessToken: 'device-token-for-test' });
        }
    },
    storage: {
        local: {
            get: (key, callback) => callback({ [key]: stored[key] }),
            set: (values, callback) => { Object.assign(stored, values); callback(); },
            remove: (key, callback) => { delete stored[key]; callback(); }
        }
    }
};

const context = vm.createContext({
    window: fakeWindow,
    globalThis: fakeWindow,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    console
});
vm.runInContext(serviceSource, context, { filename: 'MediaPlayerService.js' });

const service = new fakeWindow.MediaPlayerService({ timeoutMs: 1000 });
assert.equal(fakeWindow.MediaPlayerService.SETUP_STORAGE_KEY, 'mediaplayer_setup_v1');
const selectedInstallFolder = await service.selectInstallFolder();
assert.equal(selectedInstallFolder.installPath, 'C:\\Apps\\MediaPlayer');
const verifiedSetup = await service.verifyInstallation(selectedInstallFolder.installPath);
assert.equal(verifiedSetup.status, 'ready');
assert.equal(verifiedSetup.version, '2.4.0');
assert.equal(stored.mediaplayer_setup_v1.status, 'ready');
const capabilities = await service.getCapabilities();
assert.equal(capabilities.torrents.movies.status, 'ready');
assert.equal(service.getServiceHealth().status, 'healthy');

const unavailableService = new fakeWindow.MediaPlayerService({
    fetchImpl: async () => {
        throw new Error('connect refused');
    },
    chromeApi: fakeWindow.chrome
});
await assert.rejects(
    unavailableService.getCapabilities(),
    (error) => error?.code === 'connection_failed'
);
assert.equal(unavailableService.getServiceHealth().status, 'unavailable');
assert.equal(unavailableService.isServiceUnavailableError(new Error('not a MediaPlayer error')), false);

let abortSignal = null;
const abortedRequestService = new fakeWindow.MediaPlayerService({
    fetchImpl: async (_url, options = {}) => {
        abortSignal = options.signal;
        if (options.signal?.aborted) {
            const error = new Error('aborted');
            error.name = 'AbortError';
            throw error;
        }
        await new Promise((resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            }, { once: true });
        });
        return { ok: true, status: 200, json: async () => ({ downloads: [] }) };
    },
    chromeApi: fakeWindow.chrome
});
const callerAbortController = new AbortController();
const pendingAbortedRequest = abortedRequestService.listDownloads({ signal: callerAbortController.signal });
callerAbortController.abort();
await assert.rejects(
    pendingAbortedRequest,
    (error) => error?.code === 'request_aborted'
);
assert.equal(abortSignal?.aborted, true);
assert.equal(abortedRequestService.getServiceHealth().status, 'unknown');

const delayedFolderService = new fakeWindow.MediaPlayerService({
    nativeMessageTimeoutMs: 20,
    chromeApi: {
        runtime: {
            lastError: null,
            sendNativeMessage: (_host, message, callback) => {
                if (message.action === 'select_install_folder') {
                    setTimeout(() => callback({ installPath: 'C:\\Apps\\MediaPlayer' }), 35);
                }
            }
        }
    }
});
const delayedFolder = await delayedFolderService.selectInstallFolder();
assert.equal(delayedFolder.installPath, 'C:\\Apps\\MediaPlayer');

const sources = await service.searchMovieSources({ tmdbId: 522941, title: 'Example', year: 2024 });
assert.equal(sources.length, 1);
const sourceRequest = requests.find(request => String(request.url).includes('/api/catalog/movie/522941/sources?'));
assert.match(sourceRequest.options.headers.Authorization, /^Bearer device-token/);
assert.equal(sourceRequest.url, 'http://127.0.0.1:3000/api/catalog/movie/522941/sources?title=Example&year=2024');

const settings = await service.getSettings();
assert.equal(settings.torrentRetentionDays, 7);
const updatedSettings = await service.updateSettings({ torrentRetentionDays: 14 });
assert.equal(updatedSettings.torrentRetentionDays, 14);
const settingsPatch = requests.find(request => String(request.url).endsWith('/api/settings') && request.options.method === 'PATCH');
assert.equal(JSON.parse(settingsPatch.options.body).torrentRetentionDays, 14);

const incrementalRequests = [];
let incrementalPollCount = 0;
const incrementalFetch = async (url, options = {}) => {
    const request = { url: String(url), options };
    incrementalRequests.push(request);
    if (options.method === 'POST') {
        return {
            ok: true,
            status: 202,
            json: async () => ({
                jobId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
                status: 'running',
                total: 2
            })
        };
    }
    if (options.method === 'DELETE') {
        return { ok: true, status: 204, json: async () => null };
    }
    incrementalPollCount += 1;
    const firstBatch = incrementalPollCount === 1;
    const batch = firstBatch
        ? Array.from({ length: 10 }, (_, index) => ({ sourceId: `source-${index}`, title: `Example ${index}` }))
        : [{ sourceId: 'source-10', title: 'Example 10' }];
    return {
        ok: true,
        status: 200,
        json: async () => ({
            jobId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
            status: firstBatch ? 'running' : 'completed',
            sources: batch,
            nextCursor: firstBatch ? 10 : 11,
            hasMore: firstBatch,
            total: 2,
            completed: firstBatch ? 1 : 2,
            successful: firstBatch ? 1 : 2,
            failed: 0,
            found: firstBatch ? 10 : 11
        })
    };
};
const incrementalService = new fakeWindow.MediaPlayerService({
    fetchImpl: incrementalFetch,
    chromeApi: fakeWindow.chrome
});
const observedBatches = [];
const incrementalResult = await incrementalService.searchMovieSourcesIncrementally(
    { tmdbId: 522941, title: 'Example', year: 2024 },
    {
        pollIntervalMs: 0,
        onBatch: (batch, state) => observedBatches.push({ batch, found: state.found })
    }
);
assert.equal(incrementalResult.sources.length, 11);
assert.deepEqual(observedBatches.map(({ batch }) => batch.length), [10, 1]);
assert.deepEqual(observedBatches.map(({ found }) => found), [10, 11]);
assert.match(incrementalRequests[0].url, /\/api\/catalog\/movie\/522941\/sources\/search\?/);
assert.match(incrementalRequests[1].url, /\/api\/catalog\/movie\/522941\/sources\/search\/c56a4180-65aa-42ec-a945-5fd21dec0538\?cursor=0/);
await incrementalService.cancelMovieSourceSearch('c56a4180-65aa-42ec-a945-5fd21dec0538', 522941);
assert.equal(incrementalRequests.at(-1).options.method, 'DELETE');

const delayedFetch = (url, options = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({
        ok: true,
        status: 200,
        json: async () => ({ sources: [] })
    }), 30);
    options.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
    }, { once: true });
});
const sourceSearchTimeoutService = new fakeWindow.MediaPlayerService({
    timeoutMs: 10,
    sourceSearchTimeoutMs: 60,
    fetchImpl: delayedFetch,
    chromeApi: fakeWindow.chrome
});
await assert.doesNotReject(
    sourceSearchTimeoutService.searchMovieSources({ tmdbId: 522941, title: 'Slow source search', year: 2024 })
);

const session = await service.createPlaybackSession({
    sourceId: sources[0].sourceId,
    tmdbId: 522941,
    title: 'Example',
    year: 2024
});
const playbackSessionRequest = requests.find(request => String(request.url).endsWith('/api/playback/sessions'));
assert.equal(JSON.parse(playbackSessionRequest.options.body).clientCapabilities.hlsAv1, true);
assert.equal(session.streamUrl.startsWith('http://127.0.0.1:3000/'), true);
assert.equal(session.downloadId, 'd56a4180-65aa-42ec-a945-5fd21dec0538');
assert.equal((await service.getPlaybackProgress(session.progressUrl)).progress, 0.4);
await service.revokePlaybackSession(session.sessionId);

const downloadRequests = [];
const downloadFetch = async (url, options = {}) => {
    downloadRequests.push({ url: String(url), options });
    if (String(url).includes('/api/downloads/') && options.method === 'DELETE') {
        return { ok: true, status: 204, json: async () => null };
    }
    if (String(url).endsWith('/api/downloads')) {
        return {
            ok: true,
            status: 200,
            json: async () => ({ downloads: [{
                id: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
                mediaType: 'movie',
                tmdbId: 522941,
                title: 'Example',
                status: 'downloading',
                progress: 0.4,
                downloadedBytes: 40,
                totalBytes: 100,
                playable: false,
                locator: 'must-not-cross-client-boundary'
            }] })
        };
    }
    if (String(url).includes('/api/downloads/c56a4180-65aa-42ec-a945-5fd21dec0538/pause')) {
        return {
            ok: true,
            status: 200,
            json: async () => ({
                id: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
                mediaType: 'movie',
                tmdbId: 522941,
                title: 'Example',
                status: 'paused',
                progress: 0.4,
                downloadedBytes: 40,
                totalBytes: 100,
                playable: false
            })
        };
    }
    if (String(url).includes('/api/downloads/c56a4180-65aa-42ec-a945-5fd21dec0538/resume')) {
        return {
            ok: true,
            status: 200,
            json: async () => ({
                id: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
                mediaType: 'movie',
                tmdbId: 522941,
                title: 'Example',
                status: 'downloading',
                progress: 0.4,
                downloadedBytes: 40,
                totalBytes: 100,
                playable: false
            })
        };
    }
    if (String(url).includes('/api/downloads/c56a4180-65aa-42ec-a945-5fd21dec0538/play')) {
        return {
            ok: true,
            status: 201,
            json: async () => ({
                sessionId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
                downloadId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
                streamUrl: '/api/playback/sessions/c56a4180-65aa-42ec-a945-5fd21dec0538/stream?token=abc',
                hlsUrl: '/api/playback/sessions/c56a4180-65aa-42ec-a945-5fd21dec0538/master.m3u8?token=abc',
                progressUrl: '/api/playback/sessions/c56a4180-65aa-42ec-a945-5fd21dec0538/progress?token=abc',
                preferHls: false
            })
        };
    }
    throw new Error(`Unexpected download request: ${url}`);
};
const downloadService = new fakeWindow.MediaPlayerService({
    fetchImpl: downloadFetch,
    chromeApi: fakeWindow.chrome
});
const downloads = await downloadService.listDownloads();
assert.equal(downloads.length, 1);
assert.equal(downloads[0].status, 'downloading');
assert.equal(Object.prototype.hasOwnProperty.call(downloads[0], 'locator'), false);
const pausedDownload = await downloadService.pauseDownload(downloads[0].id);
assert.equal(pausedDownload.status, 'paused');
const resumedDownload = await downloadService.resumeDownload(downloads[0].id);
assert.equal(resumedDownload.status, 'downloading');
const savedSession = await downloadService.playDownload(downloads[0].id);
assert.equal(savedSession.sessionId, downloads[0].id);
assert.equal(JSON.parse(downloadRequests[3].options.body).clientCapabilities.hlsAv1, true);
await downloadService.deleteDownload(downloads[0].id);
assert.deepEqual(downloadRequests.map(request => request.options.method || 'GET'), ['GET', 'POST', 'POST', 'POST', 'DELETE']);
assert.match(downloadRequests[1].url, /\/api\/downloads\/c56a4180-65aa-42ec-a945-5fd21dec0538\/pause$/);
assert.match(downloadRequests[2].url, /\/api\/downloads\/c56a4180-65aa-42ec-a945-5fd21dec0538\/resume$/);
assert.match(downloadRequests[3].url, /\/api\/downloads\/c56a4180-65aa-42ec-a945-5fd21dec0538\/play$/);

const hangingNativeHostService = new fakeWindow.MediaPlayerService({
    nativeMessageTimeoutMs: 20,
    chromeApi: {
        runtime: {
            lastError: null,
            sendNativeMessage: () => {}
        }
    },
    fetchImpl: fakeWindow.fetch
});
await assert.rejects(
    hangingNativeHostService.sendNativeMessage({ action: 'pair' }),
    (error) => error?.code === 'native_host_timeout'
);

console.log('✅ MediaPlayer integration contract and client behavior passed');
