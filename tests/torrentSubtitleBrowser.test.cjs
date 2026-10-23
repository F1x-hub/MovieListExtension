const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionContext } = require('./helpers/extensionContext.cjs');

const sessionId = '00000000-0000-4000-8000-000000000001';
const token = 'subtitle-fixture-token-at-least-thirty-two-characters';
const vtt = 'WEBVTT\n\n00:00.000 --> 00:05.000\nFixture subtitle\n';

(async () => {
    const requests = [];
    const sockets = new Set();
    const server = http.createServer((request, response) => {
        // This random fixture port is outside production's fixed :3000 host grant.
        response.setHeader('Access-Control-Allow-Origin', '*');
        requests.push(request.url.split('?')[0]);
        if (request.url === '/fixture.mp4') {
            response.writeHead(200, { 'Content-Type': 'video/mp4' });
            response.end(fs.readFileSync(path.join(__dirname, 'fixtures/torrent-subtitle/tiny-h264-aac.mp4')));
            return;
        }
        const index = /\/(\d+)\.vtt/.exec(request.url)?.[1];
        if (index === '2') {
            response.writeHead(302, { Location: '/redirect-target' });
            response.end();
        } else if (index === '3') {
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.end('<html>Not subtitles</html>');
        } else if (index === '4') {
            response.writeHead(200, { 'Content-Type': 'text/vtt', 'Content-Length': 4 * 1024 * 1024 + 1 });
            response.end(vtt);
        } else if (index === '5') {
            response.writeHead(200, { 'Content-Type': 'text/vtt' });
            response.write('WEBVTT\n'); // An unfinished body must be aborted on detach.
            response.on('close', () => response.destroy());
        } else if (index === '7') {
            response.writeHead(200, { 'Content-Type': 'text/vtt', 'Transfer-Encoding': 'chunked' });
            response.end(Buffer.alloc(4 * 1024 * 1024 + 1, 65));
        } else {
            response.writeHead(200, { 'Content-Type': 'text/vtt' });
            response.end(index === '6' ? 'Invalid VTT' : vtt);
        }
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let harness;
    try {
        const root = path.resolve(__dirname, '..');
        harness = await launchExtensionContext({ extensionPath: root, fixtureOrigin: origin });
        const page = await harness.context.newPage();
        await page.goto(`chrome-extension://${harness.extensionId}/src/popup/popup.html`);
        for (const script of ['src/shared/services/MediaPlayerService.js', 'src/pages/movie-details/TorrentSourcePanel.js']) {
            await page.addScriptTag({ url: `chrome-extension://${harness.extensionId}/${script}` });
        }
        await page.evaluate(async ({ origin, sessionId, token }) => {
            document.body.replaceChildren();
            const panel = window.panel = new MovieDetailsTorrentPanelMethods();
            panel.mediaPlayerService = new MediaPlayerService({ baseUrl: origin });
            const fetch = panel.mediaPlayerService.fetchImpl;
            panel.mediaPlayerService.fetchImpl = async (...args) => {
                const response = await fetch(...args);
                if (args[0].includes('/subtitles/5.vtt')) panel.unfinishedBodyStarted = true;
                return response;
            };
            panel.torrentPlaybackSession = { sessionId, hlsUrl: `${origin}/api/playback/sessions/${sessionId}/master.m3u8?token=${token}` };
            panel.statusErrors = [];
            panel.setTorrentSourceStatus = message => panel.statusErrors.push(message);
            panel.subtitleFor = (streamIndex, url) => ({ streamIndex, supported: true, language: streamIndex === 8 ? 'fr' : 'en',
                url: url || `${origin}/api/playback/sessions/${sessionId}/subtitles/${streamIndex}.vtt?token=${token}` });
            panel.createVideo = () => {
                document.querySelectorAll('video').forEach(video => video.remove());
                const video = document.createElement('video');
                video.src = `${origin}/fixture.mp4`;
                document.body.append(video);
                panel.torrentPlaybackVideo = video;
                return video;
            };
            panel.createVideo();
            await new Promise(resolve => panel.torrentPlaybackVideo.addEventListener('loadedmetadata', resolve, { once: true }));
            panel.torrentSubtitlePreference = '1';
            panel.torrentTracksSnapshot = { audio: [], subtitles: [panel.subtitleFor(1), panel.subtitleFor(8)] };
            panel.applyTorrentTrackSnapshot();
        }, { origin, sessionId, token });
        await page.waitForFunction(() => {
            const track = panel.torrentPlaybackVideo.querySelector('track');
            return track?.readyState === 2 && track.track.cues?.length === 1;
        }, null, { timeout: 5000 }).catch(async error => {
            console.error(await page.evaluate(() => ({ errors: panel.statusErrors, video: panel.torrentPlaybackVideo.outerHTML })));
            throw error;
        });
        const oldBlob = await page.evaluate(() => {
            const track = panel.torrentPlaybackVideo.querySelector('track');
            return { url: track.src, mode: track.track.mode, cue: track.track.cues[0].text };
        });
        assert.ok(oldBlob.url.startsWith(`blob:chrome-extension://${harness.extensionId}/`));
        assert.equal(oldBlob.mode, 'showing');
        assert.equal(oldBlob.cue, 'Fixture subtitle');
        assert.equal(requests.some(url => url.includes('/subtitles/8.vtt')), false, 'disabled languages are not fetched');
        await page.evaluate(() => {
            const tracks = panel.torrentPlaybackVideo.querySelectorAll('track');
            tracks[0].track.mode = 'disabled';
            tracks[1].track.mode = 'showing';
        });
        await page.waitForFunction(() => panel.torrentPlaybackVideo.querySelectorAll('track')[1].track.cues?.length === 1);
        await page.evaluate(() => {
            const tracks = panel.torrentPlaybackVideo.querySelectorAll('track');
            tracks[1].track.mode = 'disabled';
            tracks[0].track.mode = 'showing';
        });

        // The production audio action captures the subtitle index before replacing its video.
        assert.equal(await page.evaluate(async () => {
            panel.torrentPlaybackSession.downloadId = 'saved';
            panel.torrentTracksSnapshot.audio = [{ streamIndex: 7 }, { streamIndex: 8 }];
            panel.torrentTracksSnapshot.selectedAudioStreamIndex = 7;
            panel.playSavedTorrent = async () => {
                panel.detachTorrentPlaybackVideo();
                panel.createVideo();
                await new Promise(resolve => panel.torrentPlaybackVideo.addEventListener('loadedmetadata', resolve, { once: true }));
                panel.applyTorrentTrackSnapshot();
                return true;
            };
            return panel.changeTorrentAudioTrack(8);
        }), true);
        await page.waitForFunction(() => panel.torrentPlaybackVideo.querySelector('track')?.track.cues?.length === 1);
        assert.equal(await page.evaluate(() => panel.torrentPlaybackVideo.querySelector('track').track.mode), 'showing');
        assert.equal(await page.evaluate(async url => {
            try { await fetch(url); return false; } catch { return true; }
        }, oldBlob.url), true, 'detached video Blob must be revoked');

        for (const index of [2, 3, 4, 6, 7]) {
            const before = await page.evaluate(() => panel.statusErrors.length);
            await page.evaluate(index => {
                panel.torrentSubtitlePreference = String(index);
                panel.torrentTracksSnapshot.subtitles = [panel.subtitleFor(index)];
                panel.applyTorrentTrackSnapshot();
            }, index);
            await page.waitForFunction(before => panel.statusErrors.length > before, before);
            assert.equal(await page.locator('track').count(), 0, 'rejected subtitle must not enter the menu');
        }
        assert.equal(requests.includes('/redirect-target'), false, 'capability fetch cannot follow redirects');
        const beforeForged = requests.length;
        await page.evaluate(() => {
            panel.torrentSubtitlePreference = '1';
            panel.torrentTracksSnapshot.subtitles = [panel.subtitleFor(1,
                panel.subtitleFor(1).url.replace('/subtitles/1.vtt', '/subtitles/99.vtt'))];
            panel.applyTorrentTrackSnapshot();
        });
        await page.waitForFunction(() => panel.torrentPlaybackVideo.querySelectorAll('track').length === 0);
        assert.equal(requests.length, beforeForged, 'wrong session-track path is rejected before network');

        const beforeTimeout = await page.evaluate(() => panel.statusErrors.length);
        await page.evaluate(() => {
            panel.torrentSubtitlePreference = '5';
            panel.torrentTracksSnapshot.subtitles = [panel.subtitleFor(5)];
            const originalTimeout = window.setTimeout;
            window.setTimeout = (callback, delay, ...args) => {
                if (delay === 35_000) panel.fireSubtitleDeadline = callback;
                return originalTimeout.call(window, callback, delay, ...args);
            };
            panel.applyTorrentTrackSnapshot();
            window.setTimeout = originalTimeout;
        });
        await page.waitForFunction(() => panel.unfinishedBodyStarted === true);
        await page.evaluate(() => panel.fireSubtitleDeadline());
        await page.waitForFunction(before => panel.statusErrors.length > before, beforeTimeout);
        assert.equal(await page.locator('track').count(), 0, 'deadline aborts a pending body after headers');
        await page.evaluate(() => {
            panel.unfinishedBodyStarted = false;
            panel.applyTorrentTrackSnapshot();
        });
        await page.waitForFunction(() => panel.unfinishedBodyStarted === true);
        const beforeDetach = await page.evaluate(() => panel.statusErrors.length);
        const stale = await page.evaluate(() => {
            const video = panel.torrentPlaybackVideo;
            panel.detachTorrentPlaybackVideo();
            panel.torrentPlaybackSession = null;
            return { blobs: panel.torrentSubtitleBlobUrls.size, controller: panel.torrentSubtitleAbortController,
                src: video.querySelector('track').getAttribute('src') };
        });
        assert.deepEqual(stale, { blobs: 0, controller: null, src: null });
        assert.equal(await page.evaluate(() => panel.statusErrors.length), beforeDetach, 'stale aborted body cannot change status');
        assert.equal(harness.externalResponses(), 0);
        console.log('PASS torrent subtitles in real extension Chromium: Blob cues, audio restore, revoked URLs, bounded/invalid responses, redirects and detach');
    } finally {
        await harness?.close();
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
