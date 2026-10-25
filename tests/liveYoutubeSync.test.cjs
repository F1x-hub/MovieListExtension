const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const liveHtml = read('src/pages/live/live.html');
const mainMarkup = liveHtml.match(/<main class="live-root">[\s\S]*?<\/main>/)[0];
const utilsCode = read('src/shared/utils/Utils.js');
const playerConfigCode = read('src/shared/config/player.config.js');
const cinemaChannelCode = read('src/shared/services/CinemaChannelService.js');
const livePageCode = read('src/pages/live/live.js');
const embedHtml = read('public/player/embed.html');

const WRAPPER_ORIGIN = 'https://movielistdb-13208.web.app';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function createChannelBus(initialChannel) {
    let currentDoc = structuredClone(initialChannel);
    const channelSubs = new Set();
    const writes = [];
    let writeGate = null;

    function notify() {
        const snap = { exists: Boolean(currentDoc), data: () => structuredClone(currentDoc) };
        for (const cb of [...channelSubs]) cb(snap);
    }

    return {
        writes,
        getDoc: () => structuredClone(currentDoc),
        holdNextWrite() {
            let release;
            const gate = new Promise(resolve => { release = resolve; });
            writeGate = gate;
            return () => {
                writeGate = null;
                release();
            };
        },
        setServerChannel(nextDoc) {
            currentDoc = structuredClone(nextDoc);
            notify();
        },
        makeManager({ uid = null, isAdmin = false } = {}) {
            const channelRef = {
                onSnapshot(onNext) {
                    channelSubs.add(onNext);
                    queueMicrotask(() => onNext({ exists: Boolean(currentDoc), data: () => structuredClone(currentDoc) }));
                    return () => channelSubs.delete(onNext);
                },
                async set(patch) {
                    writes.push({ uid, patch: structuredClone(patch) });
                    if (writeGate) await writeGate;
                    const merged = { ...currentDoc, ...patch };
                    if (patch.startedAt instanceof Date) {
                        merged.startedAt = new Date(patch.startedAt.getTime());
                    }
                    if (patch.youtube) {
                        merged.youtube = { ...(currentDoc?.youtube || {}), ...patch.youtube };
                    }
                    currentDoc = merged;
                    notify();
                }
            };
            const scheduleCollection = {
                onSnapshot(onNext) {
                    queueMicrotask(() => onNext({ docs: [] }));
                    return () => {};
                },
                doc: () => channelRef
            };
            return {
                getCurrentUser: () => (uid ? { uid } : null),
                waitForAuthReady: async () => (uid ? { uid } : null),
                db: {
                    collection(name) {
                        if (name === 'settings') {
                            return { doc: () => channelRef };
                        }
                        if (name === 'cinemaSchedule') {
                            return scheduleCollection;
                        }
                        if (name === 'users') {
                            return {
                                doc: () => ({
                                    get: async () => ({ exists: Boolean(uid), data: () => ({ isAdmin }) })
                                })
                            };
                        }
                        throw new Error(`Unexpected collection: ${name}`);
                    }
                }
            };
        }
    };
}

async function mountLiveClient(bus, { uid = null, isAdmin = false, cachedAdmin = false } = {}) {
    const dom = new JSDOM(`<!doctype html><html lang="ru"><body>${mainMarkup}</body></html>`, {
        url: 'https://extension.local/src/pages/live/live.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    const storage = { cached_is_admin: cachedAdmin };
    window.chrome = {
        storage: {
            local: {
                get: async key => (typeof key === 'string' ? { [key]: storage[key] } : { ...storage }),
                set: async obj => { Object.assign(storage, obj); }
            }
        }
    };
    window.firebase = {
        firestore: {
            FieldValue: { serverTimestamp: () => new Date() }
        }
    };
    window.Navigation = function Navigation() {
        this.updateActivePage = () => {};
    };
    window.i18n = {
        currentLocale: 'ru',
        init: async () => {},
        translatePage: () => {},
        onLocaleChange: () => {},
        get: key => key
    };

    window.eval(utilsCode);
    window.eval(playerConfigCode);
    window.eval(cinemaChannelCode);
    // Avoid network clock sync during unit tests.
    window.CinemaChannel.syncClock = async () => 0;
    window.firebaseManager = bus.makeManager({ uid, isAdmin });

    const commands = [];
    const origCreateElement = window.document.createElement.bind(window.document);
    window.document.createElement = function patchedCreateElement(tagName, options) {
        const el = origCreateElement(tagName, options);
        if (String(tagName).toLowerCase() === 'iframe') {
            const fakeWindow = {
                postMessage(message, targetOrigin) {
                    commands.push({ message: structuredClone(message), targetOrigin, at: Date.now() });
                }
            };
            Object.defineProperty(el, 'contentWindow', {
                configurable: true,
                get: () => fakeWindow
            });
        }
        return el;
    };

    window.eval(
        livePageCode.replace(
            "import('../../shared/i18n/I18n.js')",
            'Promise.resolve({ i18n: window.i18n })'
        )
    );
    await wait(30);

    return {
        dom,
        window,
        storage,
        commands,
        frame: () => window.document.querySelector('.live-frame'),
        clearCommands() { commands.length = 0; },
        /** A message from the embedded player page (same extension origin). */
        emitFrame(data) {
            const frame = window.document.querySelector('.live-frame');
            assert.ok(frame, 'expected mounted .live-frame');
            window.dispatchEvent(new window.MessageEvent('message', {
                origin: window.location.origin,
                source: frame.contentWindow,
                data
            }));
        },
        close() {
            window.dispatchEvent(new window.Event('pagehide'));
            dom.window.close();
        }
    };
}

const YT = { mode: 'youtube', title: 'Эфир YouTube' };
const stateMessages = client => client.commands.map(c => c.message).filter(m => m.type === 'BROADCAST_STATE');

test('YouTube on air mounts the movie-player page and hands it the broadcast clock like a movie', async () => {
    const bus = createChannelBus({
        ...YT,
        startedAt: new Date(Date.now() - 30_000),
        youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 300, pausedAtSec: null }
    });
    const admin = await mountLiveClient(bus, { uid: 'admin-1', isAdmin: true, cachedAdmin: true });
    const viewer = await mountLiveClient(bus, { uid: 'viewer-1', isAdmin: false });
    try {
        assert.match(viewer.frame().src, /youtube-player\.html\?v=dQw4w9WgXcQ&start=(29|30|31)&live=0$/);
        assert.equal(viewer.window.document.getElementById('liveControls').hidden, true, 'no page overlay: the movie player draws the controls');

        viewer.emitFrame({ type: 'BROADCAST_READY' });
        admin.emitFrame({ type: 'BROADCAST_READY' });
        const viewerState = stateMessages(viewer).at(-1);
        assert.equal(viewerState.admin, false);
        assert.equal(viewerState.pausedAtSec, null);
        assert.ok(Math.abs(Date.now() - viewerState.startMs - 30_000) < 1500);
        assert.equal(stateMessages(admin).at(-1).admin, true);

        viewer.clearCommands();
        bus.setServerChannel({ ...bus.getDoc(), youtube: { ...bus.getDoc().youtube, pausedAtSec: 50 } });
        await wait(30);
        assert.equal(stateMessages(viewer).at(-1).pausedAtSec, 50, 'an admin pause reaches the viewer\'s player');
        assert.equal(viewer.frame().src.includes('youtube-player.html'), true, 'the player is moved in place, not remounted');
    } finally {
        admin.close();
        viewer.close();
    }
});

test('admin pause/seek/resume reported by the player become the shared timeline; viewers cannot write', async () => {
    const bus = createChannelBus({
        ...YT,
        startedAt: new Date(Date.now() - 40_000),
        youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 300, pausedAtSec: null }
    });
    const admin = await mountLiveClient(bus, { uid: 'admin-1', isAdmin: true, cachedAdmin: true });
    const viewer = await mountLiveClient(bus, { uid: 'viewer-1', isAdmin: false });
    try {
        viewer.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'pause', atSec: 41 });
        await wait(450);
        assert.equal(bus.writes.length, 0, 'a viewer\'s player never moves the channel');

        admin.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'pause', atSec: 44 });
        await wait(450);
        assert.equal(bus.getDoc().youtube.pausedAtSec, 44);

        admin.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'seek', atSec: 120 });
        await wait(450);
        assert.equal(bus.getDoc().youtube.pausedAtSec, 120, 'a paused seek keeps the pause');

        admin.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'resume', atSec: 120 });
        await wait(450);
        const doc = bus.getDoc();
        assert.equal(doc.youtube.pausedAtSec, null);
        assert.ok(Math.abs((Date.now() - doc.startedAt.getTime()) / 1000 - 120) < 2, 'resumed from 120 s');
        assert.equal(doc.youtube.videoId, 'dQw4w9WgXcQ');
    } finally {
        admin.close();
        viewer.close();
    }
});

test('in-flight Firestore write (adminBusy) preserves follow-up resume instead of dropping it', async () => {
    const bus = createChannelBus({
        ...YT,
        startedAt: new Date(Date.now() - 40_000),
        youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 300, pausedAtSec: null }
    });
    const admin = await mountLiveClient(bus, { uid: 'admin-1', isAdmin: true, cachedAdmin: true });
    try {
        const releaseWrite = bus.holdNextWrite();
        admin.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'pause', atSec: 44 });
        await wait(400); // flushAdminAction awaits the held pause write (adminBusy === true)
        assert.equal(bus.writes.length, 1);

        admin.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'resume', atSec: 44 });
        await wait(400); // the timer fires while adminBusy === true and must not drop the resume

        releaseWrite();
        await wait(150);
        assert.equal(bus.writes.length, 2, 'follow-up resume flushed after in-flight pause finished');
        assert.equal(bus.getDoc().youtube.pausedAtSec, null, 'final channel state is resumed');
    } finally {
        admin.close();
    }
});

test('YouTube video without a stored length ends by itself: admin stores the player length, viewers switch to «ended»', async () => {
    const bus = createChannelBus({
        ...YT,
        startedAt: new Date(Date.now() - 150_000),
        youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 0, pausedAtSec: null }
    });
    const admin = await mountLiveClient(bus, { uid: 'admin-1', isAdmin: true, cachedAdmin: true });
    const viewer = await mountLiveClient(bus, { uid: 'viewer-1', isAdmin: false });
    try {
        await wait(30);
        admin.emitFrame({ type: 'BROADCAST_MEDIA_INFO', isLive: false, durationSec: 120.4 });
        await wait(30);
        const lengthWrites = bus.writes.filter(w => w.patch.youtube?.durationSec);
        assert.equal(lengthWrites.length, 1, 'stored once');
        assert.equal(lengthWrites[0].patch.youtube.durationSec, 121);
        assert.equal(lengthWrites[0].patch.youtube.videoId, 'dQw4w9WgXcQ');

        await wait(1100);
        assert.equal(viewer.window.document.getElementById('liveEmpty').hidden, false, 'viewer sees the ended screen');
        assert.equal(viewer.window.document.getElementById('liveEmptyTitle').textContent, 'live_page.ended_title');
    } finally {
        admin.close();
        viewer.close();
    }
});

test('ENDED from the player ends a length-less video locally; live streams never end on their own', async () => {
    const bus = createChannelBus({
        ...YT,
        startedAt: new Date(Date.now() - 95_000),
        youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 0, pausedAtSec: null }
    });
    const viewer = await mountLiveClient(bus, { uid: 'viewer-1', isAdmin: false });
    try {
        viewer.emitFrame({ type: 'BROADCAST_ENDED', atSec: 90 });
        await wait(30);
        assert.equal(viewer.window.document.getElementById('liveEmpty').hidden, false, 'ended screen after the video ended');
        await wait(1100);
        assert.equal(viewer.window.document.getElementById('liveEmpty').hidden, false, 'clock tick does not remount the video');
        assert.equal(bus.writes.length, 0, 'viewers never write');
    } finally {
        viewer.close();
    }

    const streamBus = createChannelBus({
        ...YT,
        startedAt: new Date(Date.now() - 600_000),
        youtube: { videoId: 'dQw4w9WgXcQ', live: true, durationSec: 0, pausedAtSec: null }
    });
    const host = await mountLiveClient(streamBus, { uid: 'admin-1', isAdmin: true, cachedAdmin: true });
    const watcher = await mountLiveClient(streamBus, { uid: 'viewer-2', isAdmin: false });
    try {
        assert.match(watcher.frame().src, /live=1$/);
        host.emitFrame({ type: 'BROADCAST_MEDIA_INFO', isLive: true, durationSec: 0 });
        host.emitFrame({ type: 'BROADCAST_MEDIA_INFO', isLive: false, durationSec: 75_037_431 });
        host.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'pause', atSec: 600 });
        await wait(1100);
        assert.equal(streamBus.writes.length, 0, 'no length and no pause are stored for a live stream');
        assert.equal(watcher.window.document.getElementById('liveStage').hidden, false, 'stream keeps playing');
    } finally {
        host.close();
        watcher.close();
    }
});

test('a YouTube video that cannot play shows the notice', async () => {
    const bus = createChannelBus({
        ...YT,
        startedAt: new Date(Date.now() - 10_000),
        youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 300, pausedAtSec: null }
    });
    const viewer = await mountLiveClient(bus, { uid: 'viewer-1', isAdmin: false });
    try {
        viewer.emitFrame({ type: 'BROADCAST_SOURCE_ERROR', errorCode: 150 });
        const notice = viewer.window.document.getElementById('liveNotice');
        assert.equal(notice.hidden, false);
        assert.equal(notice.textContent, 'live_page.youtube_blocked');
    } finally {
        viewer.close();
    }
});

test('public/player/embed.html emits paused TIME_UPDATE on scrub and suppresses echo on parent SEEK', async () => {
    const dom = new JSDOM(embedHtml, {
        url: `${WRAPPER_ORIGIN}/player/embed.html?v=dQw4w9WgXcQ&autoplay=0&t=20&controls=1`,
        runScripts: 'dangerously',
        pretendToBeVisual: true
    });
    const { window } = dom;
    const emitted = [];
    Object.defineProperty(window, 'parent', {
        configurable: true,
        value: {
            postMessage(data) {
                emitted.push(data);
            }
        }
    });

    let fakeTime = 20;
    let fakeState = 2; // PAUSED
    window.YT = {
        PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
        Player: function FakePlayer(_id, config) {
            const player = {
                getCurrentTime: () => fakeTime,
                getDuration: () => 240,
                getPlayerState: () => fakeState,
                playVideo: () => { fakeState = 1; },
                pauseVideo: () => { fakeState = 2; },
                seekTo: sec => { fakeTime = sec; },
                mute: () => {},
                unMute: () => {},
                destroy: () => {}
            };
            setTimeout(() => config.events.onReady({ target: player }), 0);
            return player;
        }
    };

    try {
        window.onYouTubeIframeAPIReady();
        await wait(50);
        assert.equal(emitted.some(e => e.event === 'READY'), true);
        emitted.length = 0;

        // Staying paused at 20s emits nothing.
        await wait(600);
        assert.equal(emitted.length, 0);

        // User scrubs progress bar to 88s while still PAUSED -> wrapper emits paused TIME_UPDATE.
        fakeTime = 88;
        await wait(600);
        assert.equal(emitted.length, 1);
        assert.equal(emitted[0].event, 'TIME_UPDATE');
        assert.equal(emitted[0].payload.currentTime, 88);
        assert.equal(emitted[0].payload.state, 'PAUSED');

        // Parent sends programmatic SEEK(140) -> wrapper updates lastReportedTime so no echo fires.
        emitted.length = 0;
        window.dispatchEvent(new window.MessageEvent('message', {
            data: { action: 'SEEK', payload: { seconds: 140 } }
        }));
        await wait(650);
        assert.equal(emitted.length, 0);
    } finally {
        window.dispatchEvent(new window.Event('beforeunload'));
        dom.window.close();
    }
});

function mountEmbed(query) {
    const dom = new JSDOM(embedHtml, {
        url: `${WRAPPER_ORIGIN}/player/embed.html?${query}`,
        runScripts: 'dangerously',
        pretendToBeVisual: true
    });
    const { window } = dom;
    const emitted = [];
    Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage: data => emitted.push(data) } });
    const calls = [];
    let config = null;
    window.YT = {
        PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
        Player: function FakePlayer(_id, playerConfig) {
            config = playerConfig;
            const player = {
                getCurrentTime: () => 0,
                getDuration: () => 240,
                getPlayerState: () => 5,
                getVideoData: () => ({ isLive: false }),
                getVideoLoadedFraction: () => 0.5,
                getOption: (module, name) => (name === 'tracklist' ? [{ languageCode: 'en', displayName: 'English' }] : {}),
                setOption: (module, name, value) => calls.push(`option:${name}:${value?.languageCode || ''}`),
                loadModule: name => calls.push(`load:${name}`),
                unloadModule: name => calls.push(`unload:${name}`),
                playVideo: () => calls.push('play'),
                pauseVideo: () => calls.push('pause'),
                seekTo: sec => calls.push(`seek:${sec}`),
                setVolume: value => calls.push(`volume:${value}`),
                setPlaybackRate: rate => calls.push(`rate:${rate}`),
                mute: () => calls.push('mute'),
                unMute: () => calls.push('unmute'),
                destroy: () => {}
            };
            setTimeout(() => playerConfig.events.onReady({ target: player }), 0);
            return player;
        }
    };
    window.onYouTubeIframeAPIReady();
    return { dom, window, emitted, calls, config: () => config };
}

test('embed.html with controls=0 hides YouTube chrome, covers its pause UI and takes per-viewer sound commands', async () => {
    const embed = mountEmbed('v=dQw4w9WgXcQ&autoplay=0&t=20&controls=0&volume=40');
    const { window } = embed;
    try {
        await wait(30);
        const vars = embed.config().playerVars;
        assert.equal(vars.controls, 0);
        assert.equal(vars.disablekb, 1);
        assert.equal(vars.iv_load_policy, 3);
        assert.equal(vars.fs, 0);
        assert.equal(window.document.body.classList.contains('chromeless'), true, 'player box cropped past YouTube bars');
        assert.equal(window.document.getElementById('player-shield').hidden, false);
        const cover = window.document.getElementById('pause-cover');
        assert.equal(cover.classList.contains('visible'), true, 'cover hides YouTube until playback');
        assert.ok(embed.calls.includes('volume:40'), 'initial volume applied');

        const send = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
        send({ action: 'SET_VOLUME', payload: { volume: 30 } });
        send({ action: 'SET_RATE', payload: { rate: 1.5 } });
        send({ action: 'MUTE' });
        assert.deepEqual(embed.calls.slice(-3), ['volume:30', 'rate:1.5', 'mute']);

        embed.config().events.onStateChange({ data: 1 });
        await wait(700);
        assert.equal(cover.classList.contains('visible'), false, 'picture shows while playing');
        embed.config().events.onStateChange({ data: 2 });
        assert.equal(cover.classList.contains('visible'), true, 'pause hides YouTube\'s pause UI');
    } finally {
        embed.dom.window.close();
    }
});

test('embed.html probe mode reports the length and errors', async () => {
    const probe = mountEmbed('v=dQw4w9WgXcQ&autoplay=0&mute=1&controls=0&probe=1');
    try {
        await wait(300);
        const reply = probe.emitted.find(e => e.event === 'PROBE');
        assert.equal(reply.payload.duration, 240);
        assert.equal(reply.payload.isLive, false);
        assert.equal(probe.config().playerVars.autoplay, 0);
        probe.config().events.onError({ data: 150 });
        assert.equal(probe.emitted.at(-1).event, 'ERROR');
        assert.equal(probe.emitted.at(-1).payload.errorCode, 150);
    } finally {
        probe.dom.window.close();
    }
});

test('embed.html offers YouTube captions and turns them on and off on request', async () => {
    const embed = mountEmbed('v=dQw4w9WgXcQ&autoplay=1&controls=0');
    const { window } = embed;
    try {
        await wait(30);
        embed.config().events.onStateChange({ data: 1 });
        assert.ok(embed.calls.includes('load:captions'), 'the track list is loaded once playback starts');
        await wait(1600);
        const offer = embed.emitted.find(e => e.event === 'CAPTIONS');
        assert.equal(offer.payload.tracks[0].languageCode, 'en');
        assert.equal(embed.calls.at(-1), 'unload:captions', 'offered, but off until chosen');

        embed.calls.length = 0;
        window.dispatchEvent(new window.MessageEvent('message', { data: { action: 'SET_CAPTIONS', payload: { languageCode: 'en' } } }));
        assert.deepEqual(embed.calls, ['load:captions', 'option:track:en']);
        assert.equal(window.document.body.classList.contains('chromeless'), true, 'box is resized only after the module is back');
        await wait(1600);
        assert.equal(window.document.body.classList.contains('chromeless'), false, 'captions sit in the bottom strip: no crop while on');

        window.dispatchEvent(new window.MessageEvent('message', { data: { action: 'SET_CAPTIONS', payload: { languageCode: null } } }));
        assert.equal(embed.calls.at(-1), 'unload:captions');
        assert.equal(window.document.body.classList.contains('chromeless'), true);
    } finally {
        embed.dom.window.close();
    }
});
