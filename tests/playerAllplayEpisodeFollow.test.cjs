const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const cleaner = read('content-scripts/player-cleaner.js');

/**
 * An Allplay player (the balancers behind KinoGo): its season and episode exist only
 * in its data-select menus, and the host owns the episode in canonical picker mode.
 * The page is an extension page here so that host messages come from the same window.
 */
function boot(t, { episode = 6, videoClass = '' } = {}) {
    const items = [5, 6, 7, 8].map(number => `<div class="select__drop-item${number === episode ? ' active' : ''}">Серия ${number}</div>`).join('');
    const dom = new JSDOM(`<div data-select="seasonType1"><div class="select__drop-item active">Сезон 1</div></div>
        <div data-select="episodeType1">${items}</div>
        <button class="allplay__controls__item allplay__control" type="button">play</button>
        <div id="videoContainer" class="video-container"><video class="${videoClass}" src="https://fixture.test/episode.mp4"></video></div>`, {
        url: 'chrome-extension://fixture/src/pages/movie-details/movie-details.html',
        runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
    });
    const w = dom.window;
    const storage = new Map();
    Object.defineProperty(w, 'localStorage', { value: {
        getItem: key => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key)
    } });
    w.chrome = { runtime: { id: 'fixture', getURL: () => 'data:text/javascript,' } };
    w.ResizeObserver = class { observe() {} disconnect() {} };
    const nativePlays = [];
    w.HTMLMediaElement.prototype.play = function () { nativePlays.push(this); return Promise.resolve(); };
    w.HTMLMediaElement.prototype.pause = () => {};
    w.HTMLMediaElement.prototype.load = () => {};
    w.PlayerLocale = { init: async () => true, t: (key, params, fallback) => fallback, localize() {}, subscribe: () => () => {} };
    for (const name of ['PlayerSettingsMenu', 'PlayerMediaControls', 'PlayerGhostPreview']) {
        w.eval(read(`src/shared/services/player/${name}.js`));
    }
    const video = w.document.querySelector('video');
    const media = { readyState: 0, duration: NaN, currentTime: 0, paused: true };
    for (const key of Object.keys(media)) {
        Object.defineProperty(video, key, { configurable: true, get: () => media[key], set: value => { media[key] = value; } });
    }
    w.eval(cleaner);
    const posted = [];
    w.postMessage = data => posted.push(data);
    const fromHost = data => w.dispatchEvent(new w.MessageEvent('message', { data, source: w, origin: w.location.origin }));
    const api = w.MovieExtension_PlayerCleaner._test;
    api.replacePlayerForTest();
    t.after(() => { api.teardownActiveWrapper(); w.close(); });

    const showInMenu = number => w.document.querySelectorAll('[data-select="episodeType1"] .select__drop-item')
        .forEach(item => item.classList.toggle('active', item.textContent === `Серия ${number}`));
    // The provider loads an episode into the element: its metadata arrives.
    const load = ({ duration = 2600 } = {}) => {
        Object.assign(media, { readyState: 1, duration, currentTime: 0 });
        video.dispatchEvent(new w.Event('loadedmetadata'));
    };
    const playAt = seconds => {
        media.currentTime = seconds;
        video.dispatchEvent(new w.Event('timeupdate'));
    };
    const hostOwnsEpisode = episodeNumber => fromHost({
        type: 'SET_CANONICAL_PICKER_MODE', enabled: true, providerId: 'kinogo', seasonNumber: 1, episodeNumber, selectionVersion: 3
    });
    const episodeChanges = () => posted.filter(message => message.type === 'EPISODE_CHANGED').map(message => ({ ...message }));
    return { w, video, media, posted, nativePlays, fromHost, showInMenu, load, playAt, hostOwnsEpisode, episodeChanges };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('after another episode is chosen, the start request starts the new Allplay element, not the old one', async t => {
    const h = boot(t, { episode: 6, videoClass: 'allplay__video' });
    let controlPresses = 0;
    h.w.document.querySelector('.allplay__control').addEventListener('click', () => { controlPresses++; });
    h.hostOwnsEpisode(6);
    Object.assign(h.media, { readyState: 4, duration: 2600, currentTime: 900, paused: false });
    h.video.dispatchEvent(new h.w.Event('loadedmetadata'));
    // The episode click: Allplay marks episode 7 and pauses the element it is leaving.
    h.showInMenu(7);
    h.media.paused = true;
    h.video.dispatchEvent(new h.w.Event('pause'));
    h.fromHost({ type: 'PLAYER_START' });
    assert.equal(h.nativePlays.includes(h.video), false, 'playing it again resumed episode 6 and counted as a start');
    assert.equal(controlPresses, 0);

    // Allplay's element for episode 7 waits for its own play control.
    const next = h.w.document.createElement('video');
    next.className = 'allplay__video';
    next.setAttribute('src', 'blob:https://kinogomy.fixture/next');
    Object.defineProperty(next, 'paused', { get: () => true });
    h.w.document.body.appendChild(next);
    await sleep(700);
    assert.equal(controlPresses > 0, true, 'the new episode is started from the provider\'s own control');
    assert.equal(h.nativePlays.includes(h.video), false);
});

test('the time report names the episode loaded, not the one the menu already moved to', t => {
    const h = boot(t, { episode: 6 });
    h.hostOwnsEpisode(6);
    h.load();
    // Allplay marks the next episode while the old one still plays.
    h.showInMenu(7);
    h.playAt(2590);
    const report = h.posted.find(message => message.type === 'UPDATE_WATCHING_PROGRESS');
    assert.ok(report, 'a time report is sent');
    assert.equal(report.timestamp, 2590);
    assert.equal(report.season, 'Сезон 1');
    assert.equal(report.episode, 'Серия 6',
        'the host would otherwise save episode 6\'s time as episode 7\'s position');
});

test('the provider\'s own next episode is reported, so the host header and progress follow it', t => {
    const h = boot(t, { episode: 6 });
    h.hostOwnsEpisode(6);
    h.load();
    assert.deepEqual(h.episodeChanges(), [], 'the host\'s own episode is not a change');

    h.showInMenu(7);
    h.load();
    assert.deepEqual(h.episodeChanges().map(({ seasonNumber, episodeNumber, origin, providerState, providerId }) =>
        ({ seasonNumber, episodeNumber, origin, providerState, providerId })),
    [{ seasonNumber: 1, episodeNumber: 7, origin: 'USER_PROVIDER_SELECTION', providerState: 'NATIVE_DOM', providerId: 'kinogo' }]);

    // The host follows and repeats its episode; the next move is reported again.
    h.hostOwnsEpisode(7);
    h.load();
    h.showInMenu(8);
    h.load();
    assert.deepEqual(h.episodeChanges().map(message => message.episodeNumber), [7, 8]);
});

test('a frame still opening on its own remembered episode does not move the host', t => {
    const h = boot(t, { episode: 8 });
    h.hostOwnsEpisode(6);
    h.load();
    assert.deepEqual(h.episodeChanges(), [],
        'the host is about to move this frame to its episode; reporting episode 8 would undo that');
});

test('no report while the host\'s own episode request is still being applied', t => {
    const h = boot(t, { episode: 6 });
    h.hostOwnsEpisode(6);
    h.load();
    // The host asks for episode 7; the provider has not confirmed it yet.
    h.w.dispatchEvent(new h.w.MessageEvent('message', {
        data: { type: 'APPLY_PLAYBACK_SELECTION', requestId: 'r1', providerId: 'kinogo', seasonNumber: 1, episodeNumber: 7 },
        source: h.w, origin: h.w.location.origin
    }));
    h.showInMenu(8);
    h.load();
    assert.deepEqual(h.episodeChanges(), [], 'the host\'s new episode is not confirmed yet');
    // Still applying: the provider reaches episode 7, then loads another one on the way.
    h.showInMenu(7);
    h.load();
    h.showInMenu(8);
    h.load();
    assert.deepEqual(h.episodeChanges(), [], 'a load in the middle of the host\'s request is not the provider\'s own move');
});

test('a source swapped in without a pause event does not leave «pause» on the buttons', t => {
    const h = boot(t, { episode: 6 });
    const primary = h.w.document.querySelector('.player-control-button--primary');
    h.media.paused = false;
    h.video.dispatchEvent(new h.w.Event('play'));
    assert.equal(primary.dataset.icon, 'pause');
    // A new src runs the media load algorithm: paused becomes true without a pause event.
    h.media.paused = true;
    h.video.dispatchEvent(new h.w.Event('emptied'));
    assert.equal(primary.dataset.icon, 'play');
});

test('the provider\'s next episode, already playing when swapped in, shows «pause»', t => {
    const h = boot(t, { episode: 6 });
    const primary = h.w.document.querySelector('.player-control-button--primary');
    h.media.paused = true;
    h.video.dispatchEvent(new h.w.Event('pause'));
    assert.equal(primary.dataset.icon, 'play', 'the episode has ended');
    // The swap adopts the provider's new element, which started by itself: no play event follows.
    const next = h.w.document.createElement('video');
    Object.defineProperty(next, 'paused', { get: () => false });
    h.video.replaceWith(next);
    h.w.MovieExtension_PlayerCleaner._test.setPermanentVideo(next);
    h.w._movieExtension_setupListeners(next);
    assert.equal(primary.dataset.icon, 'pause');
});

test('a disabled control in the dock looks disabled despite the dock\'s !important colours', () => {
    const rule = cleaner.match(/\.player-control-dock \.player-control-button:disabled,[\s\S]*?\{([\s\S]*?)\}/);
    assert.ok(rule, 'the dock styles a disabled control');
    assert.match(rule[1], /border-style: dashed !important/);
    assert.match(rule[1], /cursor: not-allowed !important/);
    assert.match(rule[1], /background: transparent !important/, 'no hover highlight on a disabled arrow');
    assert.ok(cleaner.indexOf('.player-control-button:disabled,') > cleaner.indexOf('.player-control-dock .player-control-button:hover {'),
        'it follows the hover rule, which is also !important');
});
