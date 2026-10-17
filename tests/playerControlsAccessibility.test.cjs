const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../content-scripts/player-cleaner.js'), 'utf8');
function harness() {
    const dom = new JSDOM('<div id="root"><video></video><div id="slider"></div><input><div contenteditable="true"><span id="edit"></span></div><div class="player-settings-menu"><button>A</button><button>B</button></div></div>', { url: 'https://fixture.test/', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
    const { window } = dom;
    window.chrome = { runtime: { id: 'test', getURL: () => 'data:text/javascript,' } };
    window.ResizeObserver = class { observe() {} disconnect() {} };
    const actions = {};
    Object.defineProperty(window.navigator, 'mediaSession', { value: { setActionHandler: (name, handler) => { actions[name] = handler; } } });
    window.MediaMetadata = class { constructor(value) { Object.assign(this, value); } };
    window.eval(fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerMediaControls.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerGhostPreview.js'), 'utf8'));
    window.eval(source);
    const hooks = window.MovieExtension_PlayerCleaner._test;
    const scope = hooks.createListenerScope();
    const video = window.document.querySelector('video');
    Object.defineProperty(video, 'duration', { value: 120 }); video.currentTime = 40;
    let plays = 0;
    video.play = () => { plays++; return Promise.resolve(); }; video.pause = () => {};
    hooks.bindPlayerAccessibility({ container: window.document.getElementById('root'), getVideo: () => video, scope, slider: window.document.getElementById('slider') });
    const key = (value, target = window.document.body) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
    return { dom, window, video, scope, key, actions, plays: () => plays };
}
test('one shortcut authority uses exact deltas and respects editable/menu focus', () => {
    const h = harness();
    h.key('ArrowRight'); assert.equal(h.video.currentTime, 45);
    h.key('j'); assert.equal(h.video.currentTime, 35);
    for (const selector of ['input', '#edit', '.player-settings-menu button']) h.key('l', h.window.document.querySelector(selector));
    assert.equal(h.video.currentTime, 35);
    h.key('k'); assert.equal(h.plays(), 1);
    h.key('m'); assert.equal(h.video.muted, true);
    h.key('>'); assert.equal(h.video.playbackRate, 1.25);
    h.scope.dispose(); h.key('l'); assert.equal(h.video.currentTime, 35);
    h.dom.window.close();
});
test('slider supports keyboard bounds and ARIA time text; menu uses arrows', () => {
    const h = harness(); const slider = h.window.document.getElementById('slider');
    assert.equal(slider.getAttribute('role'), 'slider');
    h.key('End', slider); assert.equal(h.video.currentTime, 120);
    h.key('PageDown', slider); assert.equal(h.video.currentTime, 60);
    assert.equal(slider.getAttribute('aria-valuetext'), '1:00 / 2:00');
    h.key('Home', slider); assert.equal(h.video.currentTime, 0);
    const buttons = h.window.document.querySelectorAll('.player-settings-menu button');
    buttons[0].focus(); h.key('ArrowDown', buttons[0]); assert.equal(h.window.document.activeElement, buttons[1]);
    h.scope.dispose(); h.dom.window.close();
});
test('Media Session addresses primary video and tears down owned handlers', () => {
    const h = harness();
    h.actions.play(); assert.equal(h.plays(), 1);
    h.actions.seekto({ seekTime: 999 }); assert.equal(h.video.currentTime, 120);
    assert.equal(h.window.navigator.mediaSession.metadata.title, 'MovieList');
    h.scope.dispose();
    for (const handler of Object.values(h.actions)) assert.equal(handler, null);
    h.dom.window.close();
});
