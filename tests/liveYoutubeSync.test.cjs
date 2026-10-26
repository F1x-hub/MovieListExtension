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
const standbyCode = read('src/pages/live/LiveStandby.js');
const programmeCode = read('src/pages/live/LiveProgramme.js');
const embedHtml = read('public/player/embed.html');

const WRAPPER_ORIGIN = 'https://movielistdb-13208.web.app';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function createChannelBus(initialChannel, initialSchedule = {}) {
    let currentDoc = structuredClone(initialChannel);
    let scheduleDocs = structuredClone(initialSchedule);
    const channelSubs = new Set();
    const scheduleSubs = new Set();
    const scheduleErrors = new Set();
    const writes = [];
    let writeGate = null;

    function notify() {
        const snap = { exists: Boolean(currentDoc), data: () => structuredClone(currentDoc) };
        for (const cb of [...channelSubs]) cb(snap);
    }
    const scheduleSnapshot = () => ({ docs: Object.entries(scheduleDocs).map(([id, data]) => ({ id, data: () => structuredClone(data) })) });

    return {
        writes,
        getDoc: () => structuredClone(currentDoc),
        getScheduled: id => structuredClone(scheduleDocs[id]),
        failSchedule() { for (const callback of scheduleErrors) callback(new Error('fixture: schedule offline')); },
        setServerSchedule(next) {
            scheduleDocs = structuredClone(next);
            for (const callback of [...scheduleSubs]) callback(scheduleSnapshot());
        },
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
                id: 'cinemaChannel',
                get: async () => ({ id: 'cinemaChannel', exists: Boolean(currentDoc), data: () => structuredClone(currentDoc) }),
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
                },
                async update(patch) {
                    writes.push({ uid, patch: structuredClone(patch) });
                    if (writeGate) await writeGate;
                    for (const [key, value] of Object.entries(patch)) {
                        if (key.includes('.')) {
                            const [parent, field] = key.split('.');
                            currentDoc[parent] = { ...currentDoc[parent], [field]: structuredClone(value) };
                        } else currentDoc[key] = structuredClone(value);
                    }
                    notify();
                }
            };
            const scheduleCollection = {
                onSnapshot(onNext, onError) {
                    scheduleSubs.add(onNext);
                    if (onError) scheduleErrors.add(onError);
                    queueMicrotask(() => onNext(scheduleSnapshot()));
                    return () => { scheduleSubs.delete(onNext); scheduleErrors.delete(onError); };
                },
                doc(id) {
                    return {
                        id,
                        get: async () => ({ id, exists: Boolean(scheduleDocs[id]), data: () => structuredClone(scheduleDocs[id]) }),
                        async update(patch) {
                            writes.push({ uid, docPath: `cinemaSchedule/${id}`, patch: structuredClone(patch) });
                            if (writeGate) await writeGate;
                            assert.ok(scheduleDocs[id], 'cannot recreate a deleted schedule entry');
                            for (const [key, value] of Object.entries(patch)) {
                                if (key.includes('.')) {
                                    const [parent, field] = key.split('.');
                                    scheduleDocs[id][parent] = { ...scheduleDocs[id][parent], [field]: structuredClone(value) };
                                } else scheduleDocs[id][key] = structuredClone(value);
                            }
                            for (const callback of [...scheduleSubs]) callback(scheduleSnapshot());
                        }
                    };
                }
            };
            return {
                getCurrentUser: () => (uid ? { uid } : null),
                waitForAuthReady: async () => (uid ? { uid } : null),
                db: {
                    async runTransaction(callback) {
                        const pending = [];
                        const result = await callback({
                            get: ref => ref.get(),
                            update: (ref, patch) => pending.push(() => ref.update(patch))
                        });
                        for (const write of pending) await write();
                        return result;
                    },
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

async function mountLiveClient(bus, { uid = null, isAdmin = false, cachedAdmin = false, clock = null } = {}) {
    const dom = new JSDOM(`<!doctype html><html lang="ru"><body>${mainMarkup}</body></html>`, {
        url: 'https://extension.local/src/pages/live/live.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    const clockTicks = new Map();
    if (clock) {
        window.Date.now = () => clock.now;
        const originalInterval = window.setInterval.bind(window);
        const originalClearInterval = window.clearInterval.bind(window);
        let nextId = -1;
        window.setInterval = (callback, delay, ...args) => {
            if (delay !== 1000) return originalInterval(callback, delay, ...args);
            const id = nextId--; clockTicks.set(id, callback); return id;
        };
        window.clearInterval = id => { if (!clockTicks.delete(id)) originalClearInterval(id); };
    }
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
    window.eval(standbyCode);
    window.eval(programmeCode);
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
        tick(at) {
            assert.ok(clock, 'deterministic tick requires a controlled clock');
            clock.now = at;
            for (const callback of [...clockTicks.values()]) callback();
        },
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

test('episode broadcasts launch the scheduled selection for guests and replace the player only when that selection changes', async () => {
    const clock = { now: new Date(2026, 9, 26, 19, 12).getTime() };
    const episode = { mode: 'movie', title: 'Вечерний сериал', startedAt: new Date(clock.now - 30_000),
        movie: { kinopoiskId: 301, durationSec: 2700, mediaType: 'tv-series', seasonNumber: 0, episodeNumber: 2,
            episodeTitle: 'Спецвыпуск & финал', tmdbId: 123 } };
    const bus = createChannelBus(episode);
    const guest = await mountLiveClient(bus, { clock });
    try {
        const frame = guest.frame();
        const params = new URL(frame.src).searchParams;
        assert.equal(params.get('movieId'), '301');
        assert.equal(params.get('mediaType'), 'tv-series');
        assert.equal(params.get('seasonNumber'), '0');
        assert.equal(params.get('episodeNumber'), '2');
        assert.equal(params.get('episodeTitle'), 'Спецвыпуск & финал');
        assert.equal(params.get('tmdbId'), '123');
        bus.setServerChannel({ ...episode, movie: { ...episode.movie, pausedAtSec: 60 } });
        assert.equal(guest.frame(), frame, 'pause changes the shared clock in place');
        bus.setServerChannel({ ...episode, movie: { ...episode.movie, episodeNumber: 3 } });
        assert.notEqual(guest.frame(), frame, 'same series with another episode must remount');
        assert.equal(new URL(guest.frame().src).searchParams.get('episodeNumber'), '3');
        assert.equal(bus.writes.length, 0, 'guest launch reads public state without writes');
    } finally { guest.close(); }
});

test('broadcast heading links to the current YouTube video, preserves movie links and clears inactive links', async () => {
    const clock = { now: new Date(2026, 9, 25, 19, 12).getTime() };
    const youtube = { ...YT, title: '<img src=x onerror=alert(1)>', startedAt: new Date(clock.now - 30_000),
        youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 300 } };
    const bus = createChannelBus(youtube);
    const viewer = await mountLiveClient(bus, { clock });
    try {
        const title = viewer.window.document.getElementById('liveTitle');
        let link = title.querySelector('a');
        assert.equal(link.href, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        assert.equal(link.target, '_blank');
        assert.equal(link.rel, 'noopener noreferrer');
        assert.equal(link.title, 'live_page.open_youtube');
        assert.equal(link.textContent, youtube.title);
        assert.equal(link.querySelector('img'), null);
        bus.setServerChannel({ ...youtube, youtube: { videoId: 'aqz-KE-bpKQ', live: true, durationSec: 0 } });
        assert.equal(title.querySelector('a').href, 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
        bus.setServerChannel({ mode: 'movie', title: 'Movie', startedAt: new Date(clock.now - 30_000),
            movie: { kinopoiskId: 301, durationSec: 600 } });
        link = title.querySelector('a');
        assert.equal(new URL(link.href).pathname, '/src/pages/movie-details/movie-details.html');
        assert.equal(new URL(link.href).searchParams.get('movieId'), '301');
        assert.equal(link.target, '');
        assert.equal(link.title, 'live_page.open_movie');
        bus.setServerChannel({ mode: 'off', startedAt: new Date(clock.now) });
        assert.equal(title.querySelector('a'), null);
        bus.setServerChannel({ ...youtube, startedAt: new Date(clock.now + 30_000) });
        assert.equal(title.querySelector('a'), null, 'future videos have no active heading link');
        assert.equal(bus.writes.length, 0);
    } finally { viewer.close(); }
});

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

for (const mode of ['movie', 'youtube']) for (const scheduled of [false, true]) for (const paused of [false, true]) {
    test(`${mode} ${scheduled ? 'scheduled' : 'manual'} ${paused ? 'paused' : 'playing'}: new viewers and admins join without restarting existing clients`, async () => {
        const clock = { now: FIXED_NOW };
        const media = mode === 'movie' ? { kinopoiskId: 301, durationSec: 900, pausedAtSec: paused ? 40 : null }
            : { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 900, pausedAtSec: paused ? 40 : null };
        const doc = { mode, title: 'Already on air', startedAt: new Date(clock.now - 300_000), endsAt: new Date(clock.now + 600_000), [mode]: media };
        const bus = createChannelBus(scheduled ? manualOff() : doc, scheduled ? { current: doc } : {});
        const host = await mountLiveClient(bus, { clock, uid: 'admin-1', isAdmin: true });
        try {
            host.emitFrame({ type: 'BROADCAST_READY' });
            const frame = host.frame(), originalState = stateMessages(host).at(-1);
            const originalDoc = scheduled ? bus.getScheduled('current') : bus.getDoc();
            for (const joiner of [{ uid: null }, { uid: 'viewer-1' }, { uid: 'admin-2', isAdmin: true }]) {
                const client = await mountLiveClient(bus, { clock, ...joiner });
                try {
                    client.emitFrame({ type: 'BROADCAST_READY' });
                    client.emitFrame({ type: 'BROADCAST_PLAYING' });
                    const state = stateMessages(client).at(-1);
                    assert.equal(state.startMs, originalState.startMs);
                    assert.equal(state.pausedAtSec, paused ? 40 : null);
                    assert.equal(state.admin, joiner.isAdmin === true);
                    if (mode === 'youtube') assert.equal(new URL(client.frame().src).searchParams.get('start'), String(paused ? 40 : 300));
                    if (!joiner.isAdmin) {
                        client.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'resume', atSec: 0 });
                        client.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'seek', atSec: 0 });
                    }
                    assert.equal(host.frame(), frame);
                    assert.equal(stateMessages(host).at(-1).startMs, originalState.startMs);
                    assert.equal(bus.writes.length, 0);
                } finally { client.close(); }
            }
            assert.deepEqual(scheduled ? bus.getScheduled('current') : bus.getDoc(), originalDoc);
            assert.equal(host.frame(), frame, 'other clients leaving cannot restart the host either');
            assert.equal(bus.writes.length, 0);
        } finally { host.close(); }
    });
}

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

for (const mode of ['movie', 'youtube']) test(`${mode}: rapid pause/seek and resume/seek retain the requested playback phase for viewers`, async () => {
    const media = mode === 'movie' ? { kinopoiskId: 301, durationSec: 300, pausedAtSec: null }
        : { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 300, pausedAtSec: null };
    const bus = createChannelBus({ mode, startedAt: new Date(Date.now() - 100_000), [mode]: media });
    const admin = await mountLiveClient(bus, { uid: 'admin-1', isAdmin: true });
    const viewer = await mountLiveClient(bus, { uid: 'viewer-1', isAdmin: false });
    try {
        viewer.emitFrame({ type: 'BROADCAST_READY' });
        admin.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'pause', atSec: 100 });
        admin.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'seek', atSec: 40 });
        await wait(450);
        assert.equal(bus.getDoc()[mode].pausedAtSec, 40);
        assert.equal(stateMessages(viewer).at(-1).pausedAtSec, 40);
        assert.equal(bus.writes.length, 2, 'phase is published immediately; scrub position follows');
        admin.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'resume', atSec: 40 });
        admin.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'seek', atSec: 80 });
        await wait(450);
        assert.equal(bus.getDoc()[mode].pausedAtSec, null);
        assert.equal(stateMessages(viewer).at(-1).pausedAtSec, null);
        assert.ok(Math.abs((Date.now() - bus.getDoc().startedAt.getTime()) / 1000 - 80) < 2);
        assert.equal(bus.writes.length, 4);
        assert.ok(bus.writes.every(write => write.uid === 'admin-1'));
    } finally { admin.close(); viewer.close(); }
});

test('a queued action is discarded when another show replaces its player before the debounce fires', async () => {
    const bus = createChannelBus({ mode: 'movie', startedAt: new Date(Date.now() - 100_000), movie: { kinopoiskId: 301, durationSec: 300 } });
    const admin = await mountLiveClient(bus, { uid: 'admin-1', isAdmin: true });
    try {
        admin.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'seek', atSec: 40 });
        bus.setServerChannel({ mode: 'movie', startedAt: new Date(), movie: { kinopoiskId: 302, durationSec: 600 } });
        await wait(450);
        assert.equal(bus.writes.length, 0);
        assert.equal(bus.getDoc().movie.kinopoiskId, 302);
    } finally { admin.close(); }
});

test('a newer server resume releases the optimistic pause even when its intermediate acknowledgement was skipped', async () => {
    const bus = createChannelBus({ mode: 'movie', startedAt: new Date(Date.now() - 100_000), movie: { kinopoiskId: 301, durationSec: 300, pausedAtSec: null } });
    const makeManager = bus.makeManager;
    bus.makeManager = options => {
        const manager = makeManager(options);
        const collection = manager.db.collection.bind(manager.db);
        manager.db.collection = name => {
            const result = collection(name);
            if (name !== 'settings') return result;
            const doc = result.doc.bind(result);
            result.doc = id => {
                const ref = doc(id), subscribe = ref.onSnapshot;
                ref.onSnapshot = callback => subscribe(snapshot => {
                    if (snapshot.data()?.movie?.pausedAtSec !== 100) callback(snapshot);
                });
                return ref;
            };
            return result;
        };
        return manager;
    };
    const admin = await mountLiveClient(bus, { uid: 'admin-1', isAdmin: true });
    try {
        admin.emitFrame({ type: 'BROADCAST_READY' });
        admin.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'pause', atSec: 100 });
        await wait(30);
        assert.equal(bus.getDoc().movie.pausedAtSec, 100);
        const doc = bus.getDoc();
        bus.setServerChannel({ ...doc, updatedAt: new Date(Date.now() + 1000), movie: { ...doc.movie, pausedAtSec: null } });
        assert.equal(stateMessages(admin).at(-1).pausedAtSec, null);
        assert.equal(admin.window.document.getElementById('liveBadge').classList.contains('is-paused'), false);
    } finally { admin.close(); }
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
        const lengthWrites = bus.writes.filter(w => w.patch['youtube.durationSec']);
        assert.equal(lengthWrites.length, 1, 'stored once');
        assert.equal(lengthWrites[0].patch['youtube.durationSec'], 121);
        assert.equal(bus.getDoc().youtube.videoId, 'dQw4w9WgXcQ');

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

const FIXED_NOW = Math.floor(Date.now() / 1000) * 1000;
const scheduleDoc = (mode, start, end, extra = {}) => ({
    mode, title: mode === 'movie' ? 'Фильм в программе' : 'YouTube в программе',
    startedAt: new Date(start), endsAt: new Date(end),
    movie: mode === 'movie' ? { kinopoiskId: 301, durationSec: 1800, posterUrl: '', pausedAtSec: null } : null,
    youtube: mode === 'youtube' ? { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 1800, pausedAtSec: null } : null,
    ...extra
});
const manualOff = () => ({ mode: 'off', startedAt: new Date(FIXED_NOW - 7200_000) });

test('scheduled anchor moves playback in place while startedAt stays fixed, and a pause holds the slot past its end', async () => {
    const clock = { now: FIXED_NOW };
    const slot = scheduleDoc('movie', FIXED_NOW - 600_000, FIXED_NOW + 600_000, { playbackStartedAt: new Date(FIXED_NOW - 120_000) });
    const bus = createChannelBus(manualOff(), { current: slot });
    const viewer = await mountLiveClient(bus, { clock });
    try {
        const frame = viewer.frame();
        assert.ok(frame);
        assert.equal(new URL(frame.src).searchParams.get('broadcastStart'), String(FIXED_NOW - 120_000));
        viewer.emitFrame({ type: 'BROADCAST_READY' });
        assert.equal(stateMessages(viewer).at(-1).startMs, FIXED_NOW - 120_000);
        const moved = { ...slot, playbackStartedAt: new Date(FIXED_NOW - 40_000) };
        bus.setServerSchedule({ current: moved });
        assert.equal(viewer.frame(), frame, 'anchor changes never remount a playing source');
        assert.equal(stateMessages(viewer).at(-1).startMs, FIXED_NOW - 40_000);
        bus.setServerSchedule({ current: { ...moved, movie: { ...slot.movie, pausedAtSec: 40 } } });
        assert.equal(stateMessages(viewer).at(-1).pausedAtSec, 40);
        viewer.tick(FIXED_NOW + 600_000);
        assert.equal(viewer.frame(), frame, 'a paused source outlives the fixed end; resume extends the slot');
        assert.equal(viewer.window.document.getElementById('liveEmpty').hidden, true);
        assert.equal(bus.getScheduled('current').startedAt.getTime(), slot.startedAt.getTime());
        assert.equal(bus.writes.length, 0);
    } finally { viewer.close(); }
});

for (const mode of ['movie', 'youtube']) test(`${mode}: viewers keep a paused screening past the next start and see the postponed programme without writes`, async () => {
    const clock = { now: FIXED_NOW };
    const current = scheduleDoc(mode, FIXED_NOW - 60_000, FIXED_NOW + 600_000);
    const next = scheduleDoc('movie', FIXED_NOW + 600_000, FIXED_NOW + 1200_000,
        { title: 'Next show', movie: { kinopoiskId: 302, durationSec: 600, posterUrl: '' } });
    const paused = { ...current, [mode]: { ...current[mode], pausedAtSec: 60 } };
    const bus = createChannelBus(manualOff(), { current: paused, next });
    const viewer = await mountLiveClient(bus, { clock });
    try {
        const frame = viewer.frame();
        viewer.emitFrame({ type: 'BROADCAST_READY' });
        viewer.tick(FIXED_NOW + 1800_000);
        assert.equal(viewer.frame(), frame);
        assert.equal(stateMessages(viewer).at(-1).pausedAtSec, 60);
        assert.equal(viewer.window.document.getElementById('liveProgrammeName').textContent, 'Next show');
        assert.equal(viewer.window.document.querySelector('.live-programme__show.is-next h3').textContent, 'Next show');
        assert.equal(bus.writes.length, 0);
        const resumed = { ...current, playbackStartedAt: new Date(clock.now - 60_000), endsAt: new Date(clock.now + 600_000) };
        const shifted = { ...next, startedAt: resumed.endsAt, endsAt: new Date(clock.now + 1200_000), playbackStartedAt: resumed.endsAt };
        bus.setServerSchedule({ current: resumed, next: shifted });
        assert.equal(viewer.frame(), frame, 'resume updates the existing player');
        viewer.tick(resumed.endsAt.getTime() - 1);
        assert.equal(viewer.frame(), frame);
        viewer.tick(resumed.endsAt.getTime());
        assert.notEqual(viewer.frame(), frame);
        assert.equal(new URL(viewer.frame().src).searchParams.get('movieId'), '302');
        assert.equal(bus.writes.length, 0);
    } finally { viewer.close(); }
});

test('a pause immediately before the next scheduled start keeps the admin player while its write is delayed', async () => {
    const clock = { now: FIXED_NOW };
    const current = scheduleDoc('movie', FIXED_NOW - 299_900, FIXED_NOW + 100,
        { movie: { kinopoiskId: 301, durationSec: 300, pausedAtSec: null } });
    const next = scheduleDoc('movie', FIXED_NOW + 100, FIXED_NOW + 600_100,
        { movie: { kinopoiskId: 302, durationSec: 600 } });
    // Preserve sub-second precision across the Node/jsdom Date realms.
    for (const item of [current, next]) {
        item.startedAt = item.startedAt.toISOString();
        item.endsAt = item.endsAt.toISOString();
    }
    const bus = createChannelBus(manualOff(), { current, next });
    const admin = await mountLiveClient(bus, { clock, uid: 'admin-1', isAdmin: true });
    try {
        const frame = admin.frame();
        assert.equal(new URL(frame.src).searchParams.get('movieId'), '301');
        const release = bus.holdNextWrite();
        admin.emitFrame({ type: 'BROADCAST_ADMIN_ACTION', action: 'pause', atSec: 294 });
        await wait(10);
        admin.tick(FIXED_NOW + 101);
        assert.equal(admin.frame(), frame, 'an in-flight pause must hold the original player at the boundary');
        assert.equal(bus.getScheduled('current').movie.pausedAtSec, null, 'the server has not acknowledged yet');
        release();
        await wait(30);
        assert.equal(bus.getScheduled('current').movie.pausedAtSec, 294);
        assert.equal(admin.frame(), frame);
        assert.equal(bus.writes.length, 1);
    } finally { admin.close(); }
});

for (const mode of ['movie', 'youtube']) test(`early ${mode} EOF reserves the slot on standby until the exact next scheduled start`, async () => {
    const clock = { now: FIXED_NOW };
    const current = scheduleDoc(mode, FIXED_NOW - 60_000, FIXED_NOW + 600_000);
    const next = scheduleDoc('movie', FIXED_NOW + 600_000, FIXED_NOW + 1200_000, { title: 'Следующий фильм', movie: { kinopoiskId: 302, durationSec: 600, posterUrl: '' } });
    const bus = createChannelBus(manualOff(), { current, next });
    const viewer = await mountLiveClient(bus, { clock });
    try {
        assert.ok(viewer.frame());
        viewer.emitFrame({ type: 'BROADCAST_ENDED', atSec: 45, startMs: FIXED_NOW - 60_000 });
        assert.equal(viewer.frame(), null, 'known source runtime must not suppress an actual EOF');
        assert.equal(viewer.window.document.getElementById('liveEmptyTitle').textContent, 'live_page.standby_ended_title');
        assert.equal(viewer.window.document.getElementById('liveStandbyNextName').textContent, next.title);
        assert.equal(viewer.window.document.getElementById('liveStandbyCountdown').textContent, '10:00');
        assert.equal(viewer.window.document.querySelector('.live-programme__show[aria-current]'), null, 'early EOF is not labelled on air in the programme');
        viewer.tick(FIXED_NOW + 599_999);
        assert.equal(viewer.frame(), null, 'no early next-program launch');
        assert.equal(viewer.window.document.getElementById('liveStandbyCountdown').textContent, '0:01');
        viewer.tick(FIXED_NOW + 600_000);
        assert.ok(viewer.frame());
        assert.equal(new URL(viewer.frame().src).searchParams.get('movieId'), '302');
        assert.equal(viewer.window.document.getElementById('liveEmpty').hidden, true);
        assert.equal(viewer.window.document.querySelector('.live-programme__show[aria-current] h3').textContent, next.title);
        assert.equal(bus.writes.length, 0, 'viewer EOF and clock ticks never write Firestore');
        assert.equal(bus.getScheduled('current').endsAt.getTime(), current.endsAt.getTime());
    } finally { viewer.close(); }
});

test('restarting the same manual video clears local EOF identity and remounts playback', async () => {
    const clock = { now: FIXED_NOW };
    const doc = { ...YT, startedAt: new Date(FIXED_NOW - 60_000), youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 300, pausedAtSec: null } };
    const bus = createChannelBus(doc);
    const viewer = await mountLiveClient(bus, { clock });
    try {
        viewer.emitFrame({ type: 'BROADCAST_ENDED', atSec: 45, startMs: FIXED_NOW - 60_000 });
        assert.equal(viewer.frame(), null);
        bus.setServerChannel({ ...doc, startedAt: new Date(FIXED_NOW) });
        assert.ok(viewer.frame(), 'same source restarted as a new playback must leave standby');
        assert.equal(viewer.window.document.getElementById('liveEmpty').hidden, true);
        assert.equal(bus.writes.length, 0);
    } finally { viewer.close(); }
});

for (const mode of ['movie', 'youtube']) test(`${mode}: delayed EOF after rewind or while paused cannot close the active timeline`, async () => {
    const clock = { now: FIXED_NOW };
    const media = mode === 'movie' ? { kinopoiskId: 301, durationSec: 300, pausedAtSec: null }
        : { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 300, pausedAtSec: null };
    const doc = { mode, startedAt: new Date(FIXED_NOW - 295_000), [mode]: media };
    const bus = createChannelBus(doc);
    const viewer = await mountLiveClient(bus, { clock });
    try {
        const frame = viewer.frame();
        bus.setServerChannel({ ...doc, startedAt: new Date(FIXED_NOW - 40_000) });
        viewer.emitFrame({ type: 'BROADCAST_ENDED', atSec: 300, startMs: FIXED_NOW - 295_000 });
        viewer.emitFrame({ type: 'BROADCAST_ENDED', atSec: 300 });
        assert.equal(viewer.frame(), frame, 'EOF without an anchor still cannot jump ahead of the rewound clock');
        bus.setServerChannel({ ...doc, startedAt: new Date(FIXED_NOW - 40_000), [mode]: { ...media, pausedAtSec: 40 } });
        viewer.emitFrame({ type: 'BROADCAST_ENDED', atSec: 40 });
        assert.equal(viewer.frame(), frame, 'a paused source cannot finish from an old EOF');
        assert.equal(bus.writes.length, 0);
    } finally { viewer.close(); }
});

test('standby reacts to actual future/deleted schedule snapshots without a channel rewrite', async () => {
    const clock = { now: FIXED_NOW };
    const bus = createChannelBus(manualOff());
    const viewer = await mountLiveClient(bus, { clock });
    try {
        const byId = id => viewer.window.document.getElementById(id);
        assert.equal(byId('liveEmptyTitle').textContent, 'live_page.standby_empty_title');
        assert.equal(byId('liveStandbyCountdownWrap').hidden, true);
        const next = scheduleDoc('movie', FIXED_NOW + 30_000, FIXED_NOW + 600_000);
        bus.setServerSchedule({ next });
        assert.equal(byId('liveStandbyNextName').textContent, next.title);
        assert.equal(byId('liveStandbyCountdown').textContent, '0:30');
        assert.equal(byId('liveStandbyCountdownWrap').hidden, false);
        viewer.tick(FIXED_NOW + 10_000);
        assert.equal(byId('liveStandbyCountdown').textContent, '0:20');
        bus.setServerSchedule({});
        assert.equal(byId('liveStandbyCountdownWrap').hidden, true);
        assert.equal(byId('liveStandbyNext').hidden, true);
        assert.equal(byId('liveEmptyTitle').textContent, 'live_page.standby_empty_title');
        assert.equal(bus.writes.length, 0);
    } finally { viewer.close(); }
});

test('guest programme receives future edits while the playing channel signature stays unchanged', async () => {
    const clock = { now: FIXED_NOW };
    const current = scheduleDoc('movie', FIXED_NOW - 60_000, FIXED_NOW + 600_000);
    const next = scheduleDoc('movie', FIXED_NOW + 600_000, FIXED_NOW + 1200_000, { title: 'Next show' });
    const bus = createChannelBus(manualOff(), { current, next });
    const viewer = await mountLiveClient(bus, { clock });
    try {
        const byId = id => viewer.window.document.getElementById(id);
        const frame = viewer.frame();
        assert.equal(byId('liveProgramme').hidden, false);
        assert.equal(byId('liveProgrammeName').textContent, 'Next show');
        byId('liveProgrammeToggle').click();
        bus.setServerSchedule({ current, next: { ...next, title: 'Changed next show' } });
        assert.equal(byId('liveProgrammeName').textContent, 'Changed next show');
        assert.equal(byId('liveProgrammePanel').hidden, false, 'incoming snapshots preserve disclosure state');
        assert.equal(viewer.frame(), frame, 'programme edits never remount the running player');
        bus.failSchedule();
        assert.equal(byId('liveProgrammeNotice').hidden, false);
        assert.equal(byId('liveProgrammeName').textContent, 'Changed next show', 'last good snapshot is retained');
        assert.equal(viewer.frame(), frame, 'programme failure does not stop playback');
        bus.setServerSchedule({ current });
        assert.equal(byId('liveProgrammeNotice').hidden, true);
        assert.equal(byId('liveProgrammeName').textContent, 'live_page.programme_last');
        assert.equal(byId('liveProgrammePoster').hidden, true);
        viewer.tick(FIXED_NOW + 600_000);
        assert.equal(byId('liveProgramme').hidden, false, 'programme remains available after the player ends');
        assert.equal(bus.writes.length, 0);
    } finally { viewer.close(); }
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

test('PlayerConfig.buildYouTubePlayerUrl opens our player page standalone, with the wrapper as fallback', () => {
    const load = chrome => {
        const sandbox = { globalThis: null, window: undefined, module: { exports: {} }, chrome };
        sandbox.globalThis = sandbox;
        require('node:vm').runInNewContext(playerConfigCode, sandbox);
        return sandbox.module.exports;
    };
    const inExtension = load({ runtime: { getURL: path => `chrome-extension://abc/${path}` } });
    assert.equal(inExtension.buildYouTubePlayerUrl('dQw4w9WgXcQ', { start: 12 }),
        'chrome-extension://abc/src/pages/live/youtube-player.html?v=dQw4w9WgXcQ&start=12&live=0&standalone=1');
    const outside = load(undefined);
    assert.match(outside.buildYouTubePlayerUrl('dQw4w9WgXcQ'), /^https:\/\/movielistdb-13208\.web\.app\/player\/embed\.html\?v=dQw4w9WgXcQ&autoplay=1/);
    assert.match(inExtension.buildYouTubePlayerUrl('bad id'), /embed/, 'a malformed key never reaches our page');
});
