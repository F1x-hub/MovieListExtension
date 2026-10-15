// E1 acceptance ("Смотреть" alias), plan v5 §3.4 checks (1)-(10) + popover a11y.
// vm + jsdom on the real movie-details.html / movie-details.js / WatchRoomPanel.js.
// Run: REPO=<tree> node e1WatchAliasAcceptance.test.mjs   (expects node_modules/jsdom)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const REPO = process.env.REPO || '/tmp/claude-0/review-B5/wt';
const require = createRequire(path.join(REPO, 'package.json'));
const { JSDOM } = require('jsdom');
const read = p => fs.readFileSync(path.join(REPO, p), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 5));

const results = [];
const check = async (name, fn) => {
    try { await fn(); results.push(['PASS', name]); }
    catch (e) { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 200)]); }
};

const SRC = read('src/pages/movie-details/movie-details.js').replace(/^import .*;\r?$/gm, '')
    // The page bootstrap constructs the full manager (ParserRegistry etc.); not under test.
    .replace(/document\.addEventListener\(\s*['"]DOMContentLoaded['"]/g, '((..._skip) => {})("DOMContentLoaded"');

function boot({ flag = true, movie, lastSource = null, mediaPlayerReady = false, watchPrefs = null, playerRegistry = {} } = {}) {
    const html = read('src/pages/movie-details/movie-details.html').replace(/<script[\s\S]*?<\/script>/g, '');
    const dom = new JSDOM(html, { // jsdom gives chrome-extension: an opaque origin (no localStorage) -> use an http origin.
        url: 'https://dgdejomdgiabgcfijcdhjefijdfiemhd.extension.test/movie-details.html', pretendToBeVisual: true });
    const store = {};
    if (lastSource) store[`lastSource_${movie.kinopoiskId}`] = { sourceKey: lastSource };
    if (watchPrefs) store[`watchPrefs_${movie.kinopoiskId}`] = watchPrefs;
    const w = dom.window;
    w.chrome = { storage: { local: {
        get: async keys => Object.fromEntries([].concat(keys).filter(k => k in store).map(k => [k, store[k]])),
        set: async obj => Object.assign(store, obj)
    } }, runtime: {} };
    w.console = { ...console, log() {}, info() {}, warn() {}, error() {} };
    if (flag) w.localStorage.setItem('unifiedWatchEntry', '1');
    const ctx = vm.createContext(w);
    vm.runInContext(SRC, ctx);
    vm.runInContext(read('src/pages/movie-details/TorrentSourcePanel.js'), ctx);
    vm.runInContext(read('src/pages/movie-details/WatchRoomPanel.js'), ctx);
    const M = ctx.window.MovieDetailsManager;
    try { ctx.window.installMovieDetailsWatchRoomPanel(M); } catch { /* already installed */ }
    const m = Object.create(M.prototype);
    const mk = (id, name, type, anime = false) => ({ id, name, getPlayerType: () => type,
        supportsType: () => true, supportsSourceType: () => true,
        ...(anime ? { supportsMedia: (mv) => mv?.type === 'anime' || mv?.type === 'anime-film' } : {}) });
    const parsers = [mk('kinogo', 'KinoGo', 'iframe'), mk('exfs', 'Ex-FS', 'video'), mk('seasonvar', 'Seasonvar', 'custom'),
        mk('rutube', 'Rutube', 'video'), mk('animego', 'AnimeGo', 'video', true)];
    m.parserRegistry = { getAll: () => parsers, get: id => parsers.find(p => p.id === id), getIds: () => parsers.map(p => p.id) };
    const doc = w.document;
    m.elements = { sourceButtonsContainer: doc.getElementById('sourceButtonsContainer'),
        videoContainer: doc.getElementById('videoContainer'), videoPlayerModal: doc.getElementById('videoPlayerModal') || doc.body };
    m.selectedMovie = movie;
    m.currentSources = [{ parserId: 'kinogo', url: 'https://kinogo.test/e', type: 'iframe', name: 'KinoGo' }];
    m.unavailableProviderIds = new Set();
    m.mediaPlayerReady = mediaPlayerReady;
    m.playerRegistry = playerRegistry;
    m.sourceSwitchRequestId = 0;
    m.calls = [];
    m.states = [];
    Object.assign(m, {
        playbackController: null, progressService: null, watchRoomController: null,
        updatePlayerHeaderTitle() {}, showVideoModal() {}, setupPlayerMessageListener() {},
        setPlayerSourceState(state, opts) { m.states.push([state, opts]); },
        togglePlayPause() {}, getPlayerModal: () => ({ isMinimized: () => false }), setWatchRoomStatus() {},
        openTorrentPicker: async () => { m.calls.push('torrent-picker'); return true; },
        changeVideoSource: async (v, opts = {}) => { m.calls.push(v); m.opts = opts; m.updateActiveSourceButton(v); return true; }
    });
    m.bindSourceSelectorEvents();
    return { m, doc, store, w };
}

const film = { kinopoiskId: 1, type: 'movie', name: 'Film', externalId: { imdb: 'tt1' } };
const anime = { kinopoiskId: 2, type: 'anime', name: 'Anime', externalId: { imdb: 'tt2' }, isSeries: true };
const alias = doc => doc.querySelector('[data-watch-entry="watch"]')?.dataset.aliasValue;

await check('(1) header: «Смотреть» always, «Торрент» only film+mediaPlayerReady, rest inside #sourcePopover', async () => {
    for (const [movie, ready, torrentVisible] of [[film, true, true], [film, false, false], [anime, true, false]]) {
        const { m, doc } = boot({ movie, mediaPlayerReady: ready });
        m.populateSourceSelector();
        assert.ok(doc.querySelector('#watchEntryBtn[data-watch-entry="watch"]'), 'no #watchEntryBtn');
        assert.ok(!doc.querySelector('#watchEntryBtn').classList.contains('source-btn'));
        const inner = doc.getElementById('sourceButtonsContainer');
        assert.equal(inner.parentElement.id, 'sourcePopover', 'container must be inside #sourcePopover');
        assert.equal(doc.querySelectorAll('#sourceButtonsContainer').length, 1);
        assert.ok(doc.getElementById('sourcePopover').hidden, 'popover hidden by default');
        assert.equal(!doc.getElementById('torrentEntryBtn').hidden, torrentVisible, `torrent visibility ${movie.type}/${ready}`);
        assert.equal(doc.querySelector('#sourceButtonsContainer [data-value="mediaplayer:torrent"]'), null, 'torrent left the rail');
        assert.ok(!doc.getElementById('watchEntryBtn').contains(inner));
    }
});
await check('(2) no lastSource/watchPrefs: same auto-choice as with the flag off', async () => {
    for (const movie of [film, anime]) {
        const on = boot({ movie }); await on.m.handleWatchClick();
        const off = boot({ movie, flag: false }); await off.m.handleWatchClick();
        assert.equal(on.m.calls.at(-1), off.m.calls.at(-1), `${movie.type}: ${on.m.calls.at(-1)} vs ${off.m.calls.at(-1)}`);
        assert.equal(alias(on.doc), on.m.calls.at(-1));
    }
});
await check('(3) lastSource parser:seasonvar -> data-alias-value="parser:seasonvar"', async () => {
    const { m, doc } = boot({ movie: anime, lastSource: 'parser:seasonvar' });
    await m.handleWatchClick();
    assert.equal(m.calls.at(-1), 'parser:seasonvar');
    assert.equal(alias(doc), 'parser:seasonvar');
});
await check('(4) room hint rutube finds the inner button (and only one)', async () => {
    const { m, doc, store } = boot({ movie: film });
    m.populateSourceSelector();
    assert.equal(doc.querySelectorAll('[data-value="parser:rutube"]').length, 1);
    const ok = await m.changeWatchRoomProvider('rutube', { videoId: 'abcdefgh12' });
    assert.equal(ok, true); assert.equal(m.calls.at(-1), 'parser:rutube');
    assert.equal(m.opts.fromWatchRoom, true);
    assert.equal(alias(doc), 'parser:rutube');
    assert.equal(store.watchPrefs_1, undefined, 'room hint must not write watchPrefs');
});
await check('(5) bindProviderVideoTracking(animego) attaches canonical video', async () => {
    const { m, doc } = boot({ movie: anime });
    m.populateSourceSelector();
    const v = doc.createElement('video'); v.setAttribute('data-progress-owner', 'canonical');
    m.elements.videoContainer.appendChild(v);
    let attached = null;
    m.playbackController = { attachExternalVideo: (el) => { attached = el; return true; }, detachExternalVideo() {},
        getAdapter: () => ({ supportsInPlaceSelection: () => true, getProgressConfidence: () => 'RELIABLE' }), getSelection: () => null };
    assert.equal(m.bindProviderVideoTracking('animego'), true); assert.equal(attached, v);
});
await check('(6) alias on vidsrc:/URL value; every data-value unique in document', async () => {
    const { m, doc } = boot({ movie: film, mediaPlayerReady: true });
    m.currentSources.push({ parserId: 'other', url: 'https://cdn.test/a.m3u8', type: 'video', name: 'X' });
    m.populateSourceSelector();
    for (const v of ['vidsrc:tt1', ...[...doc.querySelectorAll('#sourceButtonsContainer .source-btn')].map(b => b.dataset.value)]) {
        m.updateActiveSourceButton(v);
        assert.equal(alias(doc), v, 'alias for ' + v);
        assert.equal(doc.querySelectorAll(`[data-value="${v}"]`).length, 1, 'dup ' + v);
    }
    assert.equal(doc.querySelectorAll('[data-value="mediaplayer:torrent"]').length, 1);
    m.updateActiveSourceButton('mediaplayer:torrent');
    assert.ok(doc.getElementById('torrentEntryBtn').classList.contains('active'));
    doc.getElementById('watchEntryBtn').click(); await tick();
    assert.equal(m.calls.at(-1), alias(doc), 'click on alias -> changeVideoSource(alias)');
});
await check('(7) manual pick writes watchPrefs (userInitiated) and beats lastSource', async () => {
    const a = boot({ movie: anime, lastSource: 'parser:kinogo' });
    a.m.populateSourceSelector();
    a.doc.querySelector('#sourceButtonsContainer [data-value="parser:seasonvar"]').click();
    await tick();
    assert.equal(a.store.watchPrefs_2?.innerId, 'seasonvar', 'watchPrefs not written');
    assert.equal(a.m.opts.userInitiated, true);
    const b = boot({ movie: anime, lastSource: 'parser:kinogo', watchPrefs: { innerId: 'seasonvar', value: 'parser:seasonvar' } });
    await b.m.handleWatchClick();
    assert.equal(b.m.calls.at(-1), 'parser:seasonvar', 'watchPrefs must beat lastSource');
});
await check('(8) preloaded initializedCustomParser does not override watchPrefs (and still wins without it)', async () => {
    const reg = () => ({ animego: { movieId: '2', initialized: true } });
    const a = boot({ movie: anime, watchPrefs: { innerId: 'seasonvar' }, playerRegistry: reg() });
    await a.m.handleWatchClick();
    assert.deepEqual(a.m.calls, ['parser:seasonvar']);
    const b = boot({ movie: anime, playerRegistry: reg() });
    await b.m.handleWatchClick();
    assert.equal(b.m.calls[0], 'parser:animego', 'legacy preload path broken');
    const c = boot({ movie: anime, watchPrefs: { innerId: 'animego' }, playerRegistry: reg() });
    await c.m.handleWatchClick();
    assert.equal(c.m.calls[0], 'parser:animego');
});
await check('(9) auto-fallback: on in auto mode, off in room / after manual pick', async () => {
    const a = boot({ movie: film });
    await a.m.handleWatchClick();
    assert.equal(a.m.calls.at(-1), 'parser:kinogo');
    assert.equal(a.m.handleWatchSourceFailure('parser:kinogo', { state: 'error', reason: 't' }), true);
    assert.equal(a.m.handleWatchSourceFailure('parser:kinogo', { state: 'error', reason: 'dup' }), false, 'duplicate report');
    await tick();
    assert.equal(a.m.calls.at(-1), 'parser:exfs');
    a.m.handleWatchSourceFailure('parser:exfs', { state: 'unavailable' }); await tick();
    assert.equal(a.m.calls.at(-1), 'parser:seasonvar');
    assert.ok(a.m.watchFallbackRun.fallbackReason.startsWith('parser:exfs:unavailable'));

    const r = boot({ movie: film });
    await r.m.handleWatchClick();
    r.m.watchRoomController = { room: { id: 'x' } };
    assert.equal(r.m.handleWatchSourceFailure('parser:kinogo', { state: 'error' }), false);
    await tick(); assert.equal(r.m.calls.length, 1);
    const r2 = boot({ movie: film });
    await r2.m.handleWatchClick();
    await r2.m.changeWatchRoomProvider('rutube', { videoId: 'abcdefgh12' });
    r2.m.changeVideoSource = async (v, o = {}) => { r2.m.lastSourceSwitchOrigin = o.fromWatchRoom ? 'room' : 'auto'; r2.m.calls.push(v); r2.m.updateActiveSourceButton(v); return true; };
    await r2.m.changeWatchRoomProvider('rutube', { videoId: 'abcdefgh12' });
    assert.equal(r2.m.handleWatchSourceFailure('parser:rutube', { state: 'error' }), false, 'fromWatchRoom');

    const u = boot({ movie: film });
    await u.m.handleWatchClick();
    u.doc.querySelector('#sourceButtonsContainer [data-value="parser:exfs"]').click(); await tick();
    assert.equal(u.m.handleWatchSourceFailure('parser:exfs', { state: 'error', stateOptions: { message: 'x' } }), false);
    await tick(); assert.equal(u.m.calls.at(-1), 'parser:exfs');
    assert.equal(typeof u.m.states.at(-1)?.[1]?.onTryOther, 'function', 'must offer «Попробовать другой источник»');
    assert.equal(u.m.watchFallbackRun.fallbackReason, 'blocked:manual');
    // all three failure paths are wired
    const body = read('src/pages/movie-details/movie-details.js');
    assert.ok((body.match(/handleWatchSourceFailure\(/g) || []).length >= 5, 'failure paths not wired');
});
await check('(10) flag off -> legacy rail unchanged', async () => {
    const { m, doc } = boot({ movie: film, flag: false, mediaPlayerReady: true });
    m.populateSourceSelector();
    assert.equal(doc.querySelector('[data-watch-entry], #sourcePopover'), null);
    const vals = [...doc.querySelectorAll('#sourceButtonsContainer .source-btn')].map(b => b.dataset.value);
    assert.deepEqual(vals, ['parser:kinogo', 'parser:exfs', 'parser:seasonvar', 'parser:rutube', 'mediaplayer:torrent', 'vidsrc:tt1']);
    assert.equal(doc.getElementById('sourceButtonsContainer').parentElement.className, 'source-toolbar');
});
await check('(a11y) popover: toggle/aria-expanded, arrows, Esc + focus return, focus kept across rebuild, aria-busy', async () => {
    const { m, doc, w } = boot({ movie: film });
    m.populateSourceSelector();
    const toggle = doc.getElementById('sourcePopoverToggle');
    const pop = doc.getElementById('sourcePopover');
    toggle.click();
    assert.equal(pop.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(doc.activeElement?.dataset.value, 'parser:kinogo');
    pop.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(doc.activeElement?.dataset.value, 'parser:exfs');
    m.populateSourceSelector(); // innerHTML = '' rebuild
    assert.equal(doc.activeElement?.dataset.value, 'parser:exfs', 'focus lost after rebuild');
    pop.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(pop.hidden, true); assert.equal(doc.activeElement, toggle);
    toggle.click(); doc.body.click();
    assert.equal(pop.hidden, true, 'outside click closes');
    m.setWatchEntrySearching(true);
    assert.equal(doc.getElementById('watchEntryBtn').getAttribute('aria-busy'), 'true');
    assert.match(doc.getElementById('watchEntryBtn').textContent, /Поиск источников/);
    m.setWatchEntrySearching(false);
    assert.equal(doc.getElementById('watchEntryBtn').getAttribute('aria-busy'), 'false');
});

for (const r of results) console.log(r.join(' | '));
process.exitCode = results.some(r => r[0] === 'FAIL') ? 1 : 0;
