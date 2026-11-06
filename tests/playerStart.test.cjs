/**
 * «Смотреть» has to end in a playing film: it must not hang on «Поиск источников…», wait for
 * sources that cannot change the choice, need a second press, or open an episode at another
 * episode's position. All of these were seen in a real browser on 2026-11-06.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const silent = { log() {}, info() {}, warn() {}, error() {} };

function watchPage() {
    const dom = new JSDOM('<div id="sources"></div>', { runScripts: 'outside-only' });
    const w = dom.window;
    for (const file of ['src/shared/services/player/WatchSourcePolicy.js', 'src/pages/movie-details/WatchEntryPage.js']) w.eval(read(file));
    w.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
    const container = w.document.getElementById('sources');
    const show = values => {
        container.replaceChildren(...values.map(value => {
            const button = w.document.createElement('button');
            button.className = 'source-btn';
            button.dataset.value = value;
            return button;
        }));
    };
    const parsers = ['kinogo', 'exfs', 'seasonvar', 'rutube'];
    const page = Object.assign({
        proPlayerEnabled: true, selectedMovie: { kinopoiskId: 42, type: 'film' }, sourceSwitchRequestId: 1, activeSourceValue: null,
        elements: { sourceButtonsContainer: container }, sourceAvailability: new Map(),
        getLastSource: async () => null, isTorrentMovie: () => true,
        getParserSelectorIds: () => new Set(parsers)
    }, w.MovieDetailsWatchEntryMethods);
    let finish;
    page.probeSourceAvailability = () => (page.probe ||= new Promise(resolve => { finish = () => { page.sourceProbeDone = true; resolve(); }; }));
    const report = (id, found) => {
        page.sourceAvailability.set(id, found ? 'found' : 'missing');
        show([...parsers.filter(item => page.sourceAvailability.get(item) === 'found').map(item => `parser:${item}`), 'vidsrc:tt42']);
    };
    show(['vidsrc:tt42']);
    return { dom, w, page, report, finish: () => finish?.() };
}

test('«Смотреть» starts as soon as no source still being checked could outrank the best one', async t => {
    const { dom, page, report } = watchPage();
    t.after(() => dom.window.close());
    page.probeSourceAvailability();
    const choice = page.resolveWatchSource();
    let settled = null;
    void choice.then(value => { settled = value; });
    report('exfs', true);
    await sleep(300);
    assert.equal(settled, null, 'KinoGo ranks above Ex-FS and has not answered');
    report('kinogo', true);
    assert.equal(await choice, 'parser:kinogo', 'seasonvar and rutube are still being checked and cannot change this');
});

test('a source that has answered lets the choice go on, whether or not it has the film', async t => {
    const { dom, page, report } = watchPage();
    t.after(() => dom.window.close());
    page.probeSourceAvailability();
    const choice = page.resolveWatchSource();
    report('kinogo', false);
    report('exfs', true);
    assert.equal(await choice, 'parser:exfs');
});

test('Rutube ranks after the rest for a film, and a remembered source needs no wait at all', async t => {
    const { dom, page, report } = watchPage();
    t.after(() => dom.window.close());
    page.probeSourceAvailability();
    report('rutube', true);
    page.getLastSource = async () => 'parser:rutube';
    assert.equal(await page.resolveWatchSource(), 'parser:rutube');
});

test('with nothing confirmed yet VidSrc does not take the start: the viewer waits for the verdict', async t => {
    const { dom, page, report, finish } = watchPage();
    t.after(() => dom.window.close());
    page.probeSourceAvailability();
    const choice = page.resolveWatchSource();
    let settled = null;
    void choice.then(value => { settled = value; });
    await sleep(300);
    assert.equal(settled, null);
    report('kinogo', false);
    report('exfs', false);
    report('seasonvar', false);
    report('rutube', false);
    finish();
    assert.equal(await choice, 'vidsrc:tt42', 'the last resort, once every checked source has said no');
});

test('a slow check holds «Смотреть» back for a limited time only', async t => {
    const { dom, w, page, report } = watchPage();
    t.after(() => dom.window.close());
    page.probeSourceAvailability();
    const realNow = w.Date.now.bind(w.Date);
    let skew = 0;
    w.Date.now = () => realNow() + skew;
    const choice = page.resolveWatchSource();
    report('exfs', true);
    await sleep(200);
    skew = 11000;
    assert.equal(await choice, 'parser:exfs', 'KinoGo has not answered, and the viewer has waited long enough');
});

test('a source switched meanwhile cancels the choice', async t => {
    const { dom, page, finish } = watchPage();
    t.after(() => dom.window.close());
    page.probeSourceAvailability();
    const choice = page.resolveWatchSource();
    await sleep(50);
    page.sourceSwitchRequestId += 1;
    finish();
    assert.equal(await choice, null);
});

test('no source at all ends in a message with a retry, not in an endless spinner', async t => {
    const { dom, page, finish, report } = watchPage();
    t.after(() => dom.window.close());
    page.getWatchInnerValues = () => [];
    const states = [];
    page.setPlayerSourceState = (state, options) => states.push({ state, options });
    page.handleWatchClick = () => 'retried';
    page.probeSourceAvailability();
    report('kinogo', false);
    finish();
    assert.equal(await page.resolveWatchSource(), null);
    page.showNoWatchSource();
    assert.equal(states[0].state, 'unavailable');
    assert.match(states[0].options.message, /нет ни в одном источнике/);
    assert.equal(states[0].options.onRetry(), 'retried');
});

test('VidSrc is the last source in every ranking', () => {
    const { dom, w } = watchPage();
    const rank = w.WatchSourcePolicy.rank;
    const values = ['vidsrc:tt1', 'parser:rutube', 'parser:kinogo', 'parser:animego'];
    assert.equal([...rank(values, { film: true })].at(-1), 'vidsrc:tt1');
    assert.equal([...rank(values, { anime: true })].at(-1), 'vidsrc:tt1');
    assert.equal([...rank(values, { health: { vidsrc: 1, kinogo: 0 } })].at(-1), 'vidsrc:tt1', 'a good score does not change it');
    dom.window.close();
});

test('a provider frame is told to play once per source request, outside rooms and broadcasts', t => {
    const { dom, page } = watchPage();
    t.after(() => dom.window.close());
    const sent = [];
    const frame = {};
    page.postToPlayerFrame = (iframe, message) => { sent.push([iframe, message.type]); return true; };
    page.startReadyPlayerFrame(frame);
    page.startReadyPlayerFrame(frame);
    assert.deepEqual(sent, [[frame, 'PLAYER_START']], 'a player rebuilt later must not undo a pause');
    page.sourceSwitchRequestId += 1;
    page.startReadyPlayerFrame(frame);
    assert.equal(sent.length, 2, 'another source is another start');
    page.startPlayerFrame(frame);
    assert.equal(sent.length, 3, 'an episode opened in the same frame starts too');
    for (const guard of [{ broadcastLock: {} }, { broadcastEpisode: {} }, { watchRoomController: { room: {} } }]) {
        Object.assign(page, guard);
        page.startPlayerFrame(frame);
        assert.equal(sent.length, 3, Object.keys(guard)[0]);
        for (const key of Object.keys(guard)) delete page[key];
    }
    page.elements.videoContainer = { querySelector: () => null };
    page.startPlayerFrame();
    assert.equal(sent.length, 3, 'nothing mounted, nothing to start');
});

function cleanerFrame() {
    const dom = new JSDOM('<video></video>', { url: 'chrome-extension://fixture/player', runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;
    Object.defineProperty(win, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} } });
    win.console = silent;
    win.PlayerLocale = { init: async () => true, t: () => '' };
    for (const name of ['PlayerSettingsMenu', 'PlayerMediaControls', 'PlayerGhostPreview']) win.eval(read(`src/shared/services/player/${name}.js`));
    win.eval(read('content-scripts/player-cleaner.js'));
    const video = win.document.querySelector('video');
    const state = { paused: true, readyState: 0, calls: 0, onPlay: null };
    Object.defineProperties(video, { paused: { get: () => state.paused }, readyState: { get: () => state.readyState } });
    video.play = () => {
        state.calls += 1;
        return state.onPlay ? state.onPlay() : Promise.resolve();
    };
    const send = data => win.dispatchEvent(new win.MessageEvent('message', { data, source: win, origin: win.location.origin }));
    return { dom, win, state, send };
}

test('the frame keeps asking until the video runs: a source being swapped cancels a play() in flight', async t => {
    const { dom, state, send } = cleanerFrame();
    t.after(() => dom.window.close());
    state.onPlay = async () => {
        if (state.calls === 2) { state.paused = false; state.readyState = 4; }
    };
    send({ type: 'PLAYER_START' });
    assert.equal(state.calls, 1, 'at once');
    await sleep(1500);
    assert.equal(state.calls, 2, 'once more, and no further after it runs');
});

test('a refused start leaves the play button: it does not keep trying', async t => {
    const { dom, win, state, send } = cleanerFrame();
    t.after(() => dom.window.close());
    state.onPlay = () => Promise.reject(new win.DOMException('blocked', 'NotAllowedError'));
    send({ type: 'PLAYER_START' });
    await sleep(800);
    assert.equal(state.calls, 1);
});

test('the viewer touching the player ends the start: a pause is theirs', async t => {
    const { dom, win, state, send } = cleanerFrame();
    t.after(() => dom.window.close());
    send({ type: 'PLAYER_START' });
    win.document.body.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await sleep(800);
    assert.equal(state.calls, 1);
});

test('a video already playing is left alone, and a message from elsewhere is ignored', async t => {
    const { dom, win, state, send } = cleanerFrame();
    t.after(() => dom.window.close());
    state.paused = false;
    state.readyState = 4;
    send({ type: 'PLAYER_START' });
    await sleep(50);
    assert.equal(state.calls, 0);
    state.paused = true;
    win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'PLAYER_START' }, source: null, origin: 'https://evil.example' }));
    await sleep(50);
    assert.equal(state.calls, 0);
});

test('the last source\'s request guard does not refuse the next source\'s video', async t => {
    const { dom, win } = cleanerFrame();
    t.after(() => dom.window.close());
    const cleaner = win.MovieExtension_PlayerCleaner;
    win.document.querySelector('video').setAttribute('src', 'https://media.test/episode.mp4');
    cleaner.setRequestGuard(() => false);
    cleaner.init();
    assert.equal(win.document.querySelector('.native-player-wrapper'), null, 'a stale request adopts nothing');
    cleaner.init();
    assert.ok(win.document.querySelector('.native-player-wrapper'), 'the next source gets the player, not the browser\'s own controls');
    cleaner._test.teardownActiveWrapper();
});

test('a position read while preloading belongs to that episode, not the next one', async () => {
    const window = { location: { search: '?movieId=404900', origin: 'chrome-extension://test' }, addEventListener() {} };
    const context = vm.createContext({ window, document: { addEventListener() {} }, URLSearchParams, setTimeout, clearTimeout, console: silent,
        firebaseManager: { isAuthReady: true, waitForAuthReady: async () => {} }, chrome: { storage: { local: { get: async () => ({}) } } } });
    vm.runInContext(read('src/pages/movie-details/movie-details.js').replace(/^import .*;\r?$/gm, ''), context);
    const manager = Object.create(window.MovieDetailsManager.prototype);
    const rendered = [];
    let selection = null;
    const entry = { movieId: '404900', initialized: true, dataOnly: true, sources: [{ url: 'https://media.test/2.mp4' }], sourcesSeasonNumber: 1,
        renderOptions: { resolvedTimestamp: 60, resolvedSeasonNumber: 1, resolvedEpisodeNumber: 2 }, container: {} };
    Object.assign(manager, {
        playerRegistry: { seasonvar: entry }, selectedMovie: { kinopoiskId: 404900 },
        parserRegistry: { get: () => ({ renderPlayer: async (_container, _sources, options) => { rendered.push(options.resolvedTimestamp); return true; }, getPlayerType: () => 'custom' }) },
        playbackController: { getSelection: () => selection, getAdapter: () => null },
        elements: { videoContainer: { querySelector: () => null } },
        unmountActivePlayer() {}, populateSourceSelector() {}, orderParserSourcesForNativeBridge: (_id, sources) => sources,
        getPlayerSurface: () => ({ clear() {} }), createSourceLifecycleOptions: () => ({}), isSourceSwitchRequestCurrent: () => true
    });
    selection = { seasonNumber: 1, episodeNumber: 3, initialTimestamp: 0 };
    await manager.mountPlayer('seasonvar', '404900');
    assert.equal(rendered.at(-1), 0, 'the next episode opens at its start');
    selection = { seasonNumber: 1, episodeNumber: 2, initialTimestamp: 0 };
    await manager.mountPlayer('seasonvar', '404900');
    assert.equal(rendered.at(-1), 60, 'the resumed episode keeps its position');
    selection = { seasonNumber: 1, episodeNumber: 3, initialTimestamp: 90 };
    await manager.mountPlayer('seasonvar', '404900');
    assert.equal(rendered.at(-1), 90, 'a position asked for by the selection wins');
});

for (const [kind, tag, watcher] of [['local video', 'video', 'watchVideo'], ['provider frame', 'iframe', 'watchIframe']]) {
    test(`a ${kind} does not time out while its page is hidden, and does once it can be seen`, async () => {
        const dom = new JSDOM(`<${tag}></${tag}>`, { runScripts: 'outside-only' });
        const w = dom.window;
        w.eval(read('src/shared/services/PlayerSourceLifecycle.js'));
        let hidden = true;
        Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => hidden });
        const states = [];
        const watch = w.PlayerSourceLifecycle[watcher](w.document.querySelector(tag), {
            timeoutMs: 20, onState: state => states.push(state)
        });
        await sleep(90);
        assert.deepEqual(states, ['loading'], 'Chrome loads no media for a hidden page, so this says nothing about the source');
        hidden = false;
        await sleep(60);
        assert.deepEqual(states, ['loading', 'unavailable'], 'a visible page still gives up on a source that never starts');
        watch.cancel();
        dom.window.close();
    });
}
