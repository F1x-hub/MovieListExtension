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
        emitWrapper(event, payload = {}) {
            const frame = window.document.querySelector('.live-frame');
            assert.ok(frame, 'expected mounted .live-frame');
            const msg = new window.MessageEvent('message', {
                origin: WRAPPER_ORIGIN,
                source: frame.contentWindow,
                data: {
                    source: 'STARTTAB_PLAYER_WRAPPER',
                    event,
                    videoId: 'dQw4w9WgXcQ',
                    payload
                }
            });
            window.dispatchEvent(msg);
        },
        close() {
            window.dispatchEvent(new window.Event('pagehide'));
            dom.window.close();
        }
    };
}

test('YouTube broadcast syncs admin pause, PAUSED->BUFFERING->PLAYING resume, seeks, and passive second admin tab', async () => {
    const startMs = Date.now() - 30_000;
    const bus = createChannelBus({
        mode: 'youtube',
        title: 'Вечерний клип',
        startedAt: new Date(startMs),
        youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 0, pausedAtSec: null }
    });

    const admin1 = await mountLiveClient(bus, { uid: 'admin-1', isAdmin: true, cachedAdmin: true });
    const admin2 = await mountLiveClient(bus, { uid: 'admin-2', isAdmin: true, cachedAdmin: true });
    const viewer = await mountLiveClient(bus, { uid: 'viewer-1', isAdmin: false, cachedAdmin: false });

    try {
        assert.match(admin1.frame().src, /controls=1/);
        assert.match(viewer.frame().src, /controls=0/);
        assert.equal(viewer.frame().classList.contains('is-locked'), false, 'unlocked before playbackConfirmed');

        // Bring all three players into normal playing state around t=30s.
        for (const client of [admin1, admin2, viewer]) {
            client.emitWrapper('READY', { duration: 300 });
            client.emitWrapper('STATE_CHANGE', { state: 'PLAYING', currentTime: 30, duration: 300 });
            client.emitWrapper('TIME_UPDATE', { state: 'PLAYING', currentTime: 30.2, duration: 300 });
            client.clearCommands();
        }
        assert.equal(viewer.frame().classList.contains('is-locked'), true, 'viewer frame locks once playing');
        assert.equal(admin1.frame().classList.contains('is-locked'), false, 'admin frame stays interactive');

        // 1. Admin 1 pauses at 42s -> Firestore updates -> viewer and passive admin2 both pause and align.
        admin1.emitWrapper('STATE_CHANGE', { state: 'PAUSED', currentTime: 42 });
        await wait(420);

        assert.equal(bus.getDoc().youtube.pausedAtSec, 42);
        assert.equal(viewer.commands.some(c => c.message.action === 'PAUSE'), true, 'viewer received PAUSE');
        assert.equal(admin2.commands.some(c => c.message.action === 'PAUSE'), true, 'passive admin2 received PAUSE');
        assert.equal(admin1.commands.some(c => c.message.action === 'PAUSE'), false, 'originating admin1 is not echoed');

        // Simulate YT.Player firing STATE_CHANGE: PAUSED with pre-align time (30.5s) on viewer & admin2.
        const writesBeforeEcho = bus.writes.length;
        viewer.clearCommands();
        admin2.clearCommands();
        viewer.emitWrapper('STATE_CHANGE', { state: 'PAUSED', currentTime: 30.5 });
        admin2.emitWrapper('STATE_CHANGE', { state: 'PAUSED', currentTime: 30.5 });
        await wait(420);

        assert.equal(bus.writes.length, writesBeforeEcho, 'passive admin2 must not echo a Firestore write');
        assert.deepEqual(viewer.commands.map(c => c.message), [{ action: 'SEEK', payload: { seconds: 42 } }]);
        assert.deepEqual(admin2.commands.map(c => c.message), [{ action: 'SEEK', payload: { seconds: 42 } }]);

        // Verify viewer does NOT loop SEEK while staying paused on subsequent clock ticks.
        viewer.clearCommands();
        admin2.clearCommands();
        await wait(1150);
        assert.deepEqual(viewer.commands, [], 'paused viewer must not spam SEEK once aligned');

        // 2. Admin 1 scrubs to 95s while paused and clicks Play -> real YT emits BUFFERING(95) -> PLAYING(95).
        admin1.emitWrapper('STATE_CHANGE', { state: 'BUFFERING', currentTime: 95 });
        admin1.emitWrapper('STATE_CHANGE', { state: 'PLAYING', currentTime: 95.1 });
        await wait(420);

        assert.equal(bus.getDoc().youtube.pausedAtSec, null, 'broadcast resumed');
        const viewerActions = viewer.commands.map(c => c.message.action);
        assert.deepEqual(viewerActions, ['SEEK', 'PLAY'], 'paused viewer seeks to new spot AND plays in one pass');
        assert.ok(Math.abs(viewer.commands[0].message.payload.seconds - 95) <= 2);

        const admin2Actions = admin2.commands.map(c => c.message.action);
        assert.deepEqual(admin2Actions, ['SEEK', 'PLAY'], 'passive admin2 also seeks and resumes');

        viewer.emitWrapper('STATE_CHANGE', { state: 'PLAYING', currentTime: 95.2 });
        admin2.emitWrapper('STATE_CHANGE', { state: 'PLAYING', currentTime: 95.2 });
        viewer.clearCommands();
        admin2.clearCommands();

        // 3. Admin 1 clicks progress bar while playing (BUFFERING -> PLAYING at 160s).
        admin1.emitWrapper('STATE_CHANGE', { state: 'BUFFERING', currentTime: 160 });
        admin1.emitWrapper('STATE_CHANGE', { state: 'PLAYING', currentTime: 160.1 });
        await wait(420);

        assert.equal(viewer.commands.some(c => c.message.action === 'SEEK' && Math.abs(c.message.payload.seconds - 160) <= 2), true);
        assert.equal(admin2.commands.some(c => c.message.action === 'SEEK' && Math.abs(c.message.payload.seconds - 160) <= 2), true);
        viewer.emitWrapper('TIME_UPDATE', { state: 'PLAYING', currentTime: 160.2, duration: 300 });
        viewer.clearCommands();

        // 4. Admin 1 drags progress bar (YouTube briefly emits PAUSED -> BUFFERING -> PLAYING within <350ms).
        admin1.emitWrapper('STATE_CHANGE', { state: 'PAUSED', currentTime: 160.5 });
        await wait(80);
        admin1.emitWrapper('STATE_CHANGE', { state: 'BUFFERING', currentTime: 220 });
        admin1.emitWrapper('STATE_CHANGE', { state: 'PLAYING', currentTime: 220.2 });
        await wait(450);

        assert.equal(bus.getDoc().youtube.pausedAtSec, null, 'coalesced drag stays live');
        assert.equal(viewer.commands.some(c => c.message.action === 'SEEK' && Math.abs(c.message.payload.seconds - 220) <= 2), true);
    } finally {
        admin1.close();
        admin2.close();
        viewer.close();
    }
});

test('paused scrub TIME_UPDATE syncs viewers in place, and late viewers joining paused channel do not auto-start', async () => {
    const bus = createChannelBus({
        mode: 'youtube',
        title: 'Пауза',
        startedAt: new Date(Date.now() - 100_000),
        youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 300, pausedAtSec: 50 }
    });

    const admin = await mountLiveClient(bus, { uid: 'admin-1', isAdmin: true, cachedAdmin: true });
    const lateViewer = await mountLiveClient(bus, { uid: 'viewer-late', isAdmin: false, cachedAdmin: false });

    try {
        assert.match(admin.frame().src, /autoplay=0/);
        assert.match(lateViewer.frame().src, /autoplay=0/);
        assert.match(lateViewer.frame().src, /t=50/);

        // Late viewer wrapper loads CUED with currentTime=0 (standard YouTube pre-play state).
        lateViewer.emitWrapper('READY', { duration: 300 });
        lateViewer.emitWrapper('STATE_CHANGE', { state: 'CUED', currentTime: 0, duration: 300 });
        await wait(1100);
        assert.deepEqual(lateViewer.commands, [], 'CUED viewer on paused broadcast must not call SEEK (which starts playback in YT)');

        // Active viewer already in PAUSED state at 50s:
        lateViewer.emitWrapper('STATE_CHANGE', { state: 'PAUSED', currentTime: 50, duration: 300 });
        lateViewer.clearCommands();

        // Admin scrubs while paused from 50s to 135s -> wrapper emits TIME_UPDATE with state='PAUSED'.
        admin.emitWrapper('READY', { duration: 300 });
        admin.emitWrapper('TIME_UPDATE', { state: 'PAUSED', currentTime: 135, duration: 300 });
        await wait(420);

        assert.equal(bus.getDoc().youtube.pausedAtSec, 135);
        assert.deepEqual(lateViewer.commands.map(c => c.message), [{ action: 'SEEK', payload: { seconds: 135 } }]);
    } finally {
        admin.close();
        lateViewer.close();
    }
});

test('viewer blocked unmuted autoplay falls back to MUTE + SEEK + PLAY and clears notice on unmute', async () => {
    const bus = createChannelBus({
        mode: 'youtube',
        title: 'Автоплей тест',
        startedAt: new Date(Date.now() - 60_000),
        youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 300, pausedAtSec: null }
    });

    const viewer = await mountLiveClient(bus, { uid: 'viewer-1', isAdmin: false });
    try {
        // Wrapper loads at t=60, but Chrome blocks unmuted autoplay so player stays UNSTARTED.
        viewer.emitWrapper('READY', { duration: 300 });
        viewer.emitWrapper('STATE_CHANGE', { state: 'UNSTARTED', currentTime: 0, duration: 300 });
        viewer.clearCommands();

        // Wait past the 1800ms blocked-autoplay threshold + 1s clock tick.
        await wait(2950);

        const actions = viewer.commands.map(c => c.message.action);
        assert.equal(actions.includes('MUTE'), true, 'viewer muted to unblock autoplay');
        assert.equal(actions.includes('SEEK'), true, 'viewer seeked to current broadcast offset');
        assert.equal(actions.includes('PLAY'), true, 'viewer commanded to play after muting');

        const notice = viewer.window.document.getElementById('liveNotice');
        const muteBtn = viewer.window.document.getElementById('liveMuteBtn');
        assert.equal(notice.hidden, false, 'muted autoplay notice is shown');
        assert.equal(muteBtn.classList.contains('is-muted'), true);

        viewer.clearCommands();
        muteBtn.click();
        assert.deepEqual(viewer.commands.map(c => c.message), [{ action: 'UNMUTE', payload: undefined }]);
        assert.equal(notice.hidden, true, 'notice hides once viewer unmutes');
    } finally {
        viewer.close();
    }
});

test('in-flight Firestore write (adminBusy) preserves follow-up resume instead of dropping it', async () => {
    const bus = createChannelBus({
        mode: 'youtube',
        title: 'Гонка записи',
        startedAt: new Date(Date.now() - 40_000),
        youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 300, pausedAtSec: null }
    });

    const admin = await mountLiveClient(bus, { uid: 'admin-1', isAdmin: true, cachedAdmin: true });
    try {
        admin.emitWrapper('READY', { duration: 300 });
        admin.emitWrapper('STATE_CHANGE', { state: 'PLAYING', currentTime: 40, duration: 300 });

        const releaseWrite = bus.holdNextWrite();
        admin.emitWrapper('STATE_CHANGE', { state: 'PAUSED', currentTime: 44 });
        await wait(400); // flushAdminAction is now awaiting the held pause write (adminBusy === true)
        assert.equal(bus.writes.length, 1);

        // While the pause write is still in flight, admin clicks Play to resume!
        admin.emitWrapper('STATE_CHANGE', { state: 'BUFFERING', currentTime: 44 });
        admin.emitWrapper('STATE_CHANGE', { state: 'PLAYING', currentTime: 44.1 });
        await wait(400); // timer fires while adminBusy === true -> must NOT drop pendingAdminAction!

        releaseWrite();
        await wait(150);

        assert.equal(bus.writes.length, 2, 'follow-up resume flushed after in-flight pause finished');
        assert.equal(bus.getDoc().youtube.pausedAtSec, null, 'final channel state is resumed');
    } finally {
        admin.close();
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
