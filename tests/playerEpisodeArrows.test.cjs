const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const cleaner = read('content-scripts/player-cleaner.js');

/**
 * The player as it runs in the extension page (Seasonvar, AnimeGo, HDRezka, Rutube):
 * the host page is the same window, so host messages arrive with the page as source.
 */
function boot(t, { beforeBuild } = {}) {
    const dom = new JSDOM('<div id="videoContainer" class="video-container"><video src="https://fixture.test/movie.mp4"></video></div>', {
        url: 'chrome-extension://fixture/src/pages/movie-details/movie-details.html',
        runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
    });
    const w = dom.window;
    // jsdom treats chrome-extension: as an opaque origin, where Storage throws.
    const storage = new Map();
    Object.defineProperty(w, 'localStorage', { value: {
        getItem: key => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key)
    } });
    w.chrome = { runtime: { id: 'fixture', getURL: () => 'data:text/javascript,' } };
    w.ResizeObserver = class { observe() {} disconnect() {} };
    w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    w.HTMLMediaElement.prototype.pause = () => {};
    w.HTMLMediaElement.prototype.load = () => {};
    w.PlayerLocale = { init: async () => true, t: (key, params, fallback) => fallback, localize() {}, subscribe: () => () => {} };
    for (const name of ['PlayerSettingsMenu', 'PlayerMediaControls', 'PlayerGhostPreview']) {
        w.eval(read(`src/shared/services/player/${name}.js`));
    }
    w.eval(cleaner);
    const posted = [];
    w.postMessage = data => posted.push(data);
    const fromHost = data => w.dispatchEvent(new w.MessageEvent('message', { data, source: w, origin: w.location.origin }));
    beforeBuild?.({ w, fromHost });
    const api = w.MovieExtension_PlayerCleaner._test;
    api.replacePlayerForTest();
    t.after(() => { api.teardownActiveWrapper(); w.close(); });
    const arrow = action => w.document.querySelector(`[data-player-episode-action="${action}"]`);
    return { w, api, posted, fromHost, prev: arrow('previous'), next: arrow('next') };
}

test('a film shows no episode arrows, and the player asks the host for its word', t => {
    const h = boot(t);
    assert.ok(h.prev && h.next, 'the arrows are provisioned for a late canonical message');
    // The dock's stylesheet sets `display: grid !important` on every control, so only an
    // inline !important value hides an arrow.
    for (const arrow of [h.prev, h.next]) {
        assert.equal(arrow.style.display, 'none', 'the bar styling must not force the arrows visible');
        assert.equal(arrow.style.getPropertyPriority('display'), 'important');
    }
    assert.ok(h.posted.some(message => message.type === 'PLAYER_EPISODE_NAVIGATION_REQUEST'));
});

test('the host state shows the arrows, disables «back» on the first episode and routes clicks to the host', t => {
    const h = boot(t);
    h.fromHost({ type: 'PLAYER_EPISODE_NAVIGATION_STATE', enabled: true, hasPrevious: false, hasNext: true });
    assert.deepEqual({ ...h.api.getHostEpisodeNavigation() }, { enabled: true, hasPrevious: false, hasNext: true });
    assert.equal(h.prev.style.display, '', 'shown: the dock\'s own display applies again');
    assert.equal(h.next.style.display, '');
    assert.equal(h.prev.disabled, true, 'there is nothing before the first episode');
    assert.equal(h.next.disabled, false);
    h.next.click();
    assert.deepEqual(h.posted.filter(message => message.type === 'PLAYER_EPISODE_NAVIGATE').map(message => ({ ...message })),
        [{ type: 'PLAYER_EPISODE_NAVIGATE', direction: 'next' }]);

    h.fromHost({ type: 'PLAYER_EPISODE_NAVIGATION_STATE', enabled: false });
    for (const arrow of [h.prev, h.next]) {
        assert.equal(arrow.style.display, 'none', 'a source the host cannot move between episodes hides them (Rutube)');
        assert.equal(arrow.style.getPropertyPriority('display'), 'important');
    }
});

test('Seasonvar\'s arrows ask the host instead of its URL-only list, and report no progress for an episode not playing', t => {
    const h = boot(t, {
        beforeBuild: ({ fromHost }) => fromHost({
            type: 'SEASONVAR_PLAYBACK_STATE', activeSeasonNumber: 1, activeEpisodeNumber: 1,
            seasons: [{ seasonNumber: 1, name: '1 сезон', url: 'https://seasonvar.fixture/s1' }],
            episodes: [1, 2, 3].map(episodeNumber => ({ episodeNumber, name: `${episodeNumber} серия`, url: `https://seasonvar.fixture/e${episodeNumber}` }))
        })
    });
    h.fromHost({ type: 'PLAYER_EPISODE_NAVIGATION_STATE', enabled: true, hasPrevious: false, hasNext: true });
    h.next.click();
    assert.ok(h.posted.some(message => message.type === 'PLAYER_EPISODE_NAVIGATE' && message.direction === 'next'));
    assert.equal(h.posted.some(message => message.type === 'UPDATE_WATCHING_PROGRESS'), false,
        'the dead list path claimed episode 2 while episode 1 kept playing');
});

function pictureHarness(t) {
    // In the extension page the player modal is a [role="dialog"] above the video.
    const dom = new JSDOM('<div role="dialog"><div id="wrap"><video></video><div class="player-control-dock"><button id="dock">Pause</button></div><button class="player-center-action">Play</button></div></div>', {
        url: 'chrome-extension://fixture/player', runScripts: 'outside-only', virtualConsole: new VirtualConsole()
    });
    const w = dom.window;
    w.chrome = { runtime: { id: 'fixture', getURL: () => 'data:text/javascript,' } };
    for (const name of ['PlayerSettingsMenu', 'PlayerMediaControls', 'PlayerGhostPreview']) {
        w.eval(read(`src/shared/services/player/${name}.js`));
    }
    w.eval(cleaner);
    const api = w.MovieExtension_PlayerCleaner._test;
    const scope = api.createListenerScope();
    const video = w.document.querySelector('video');
    let paused = false;
    const calls = [];
    Object.defineProperty(video, 'paused', { get: () => paused });
    video.play = () => { calls.push('play'); paused = false; return Promise.resolve(); };
    video.pause = () => { calls.push('pause'); paused = true; };
    const wrap = w.document.getElementById('wrap');
    api.bindPictureToggle({ container: wrap, getVideo: () => video, scope });
    t.after(() => { scope.dispose(); w.close(); });
    const click = (target, { detail = 1 } = {}) => {
        target.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
        target.dispatchEvent(new w.MouseEvent('click', { bubbles: true, button: 0, detail }));
    };
    return { w, video, calls, click, isPaused: () => paused, wrap };
}

test('a click on the picture pauses and resumes, once per click', t => {
    const h = pictureHarness(t);
    h.click(h.video);
    assert.equal(h.isPaused(), true);
    h.click(h.video);
    assert.equal(h.isPaused(), false);
    h.click(h.wrap);
    assert.equal(h.isPaused(), true, 'the letterbox around the video is picture too');
    assert.deepEqual(h.calls, ['pause', 'play', 'pause']);
});

test('a provider that toggles on its own video click is not toggled back', t => {
    const h = pictureHarness(t);
    // Ex-FS: its player listens on the video and pauses synchronously.
    h.video.addEventListener('click', () => { if (h.isPaused()) h.video.play(); else h.video.pause(); });
    h.click(h.video);
    assert.equal(h.isPaused(), true);
    h.click(h.video);
    assert.equal(h.isPaused(), false);
    assert.deepEqual(h.calls, ['pause', 'play'], 'one click, one toggle');
});

test('controls, keyboard clicks and other buttons do not count as the picture', t => {
    const h = pictureHarness(t);
    h.click(h.w.document.getElementById('dock'));
    h.click(h.w.document.querySelector('.player-center-action'));
    h.click(h.video, { detail: 0 });
    h.video.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, button: 0, detail: 1 }));
    h.video.dispatchEvent(new h.w.MouseEvent('pointerdown', { bubbles: true, button: 2 }));
    h.video.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, button: 2, detail: 1 }));
    assert.deepEqual(h.calls, []);
});

test('a broadcast keeps play/pause to the channel', t => {
    const h = pictureHarness(t);
    h.w.dispatchEvent(new h.w.MessageEvent('message', {
        data: { type: 'BROADCAST_STATE', startMs: Date.now() - 1000, admin: false },
        source: h.w, origin: h.w.location.origin
    }));
    const before = h.calls.length;
    h.click(h.video);
    assert.equal(h.calls.length, before, 'a viewer\'s click on the picture changes nothing');
});
