const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../content-scripts/player-cleaner.js'), 'utf8');
const VOLUME_KEY = 'movieExtension_videoVolume';
function boot(t, saved) {
    const dom = new JSDOM('<div id="videoContainer"><video src="https://fixture.test/movie.mp4"></video></div>', {
        url: 'https://fixture.test/', runScripts: 'outside-only', pretendToBeVisual: true,
        virtualConsole: new VirtualConsole()
    });
    const w = dom.window;
    w.chrome = { runtime: { id: 'test', getURL: () => 'data:text/javascript,' } };
    w.ResizeObserver = class { observe() {} disconnect() {} };
    w.HTMLMediaElement.prototype.play = () => Promise.resolve();
    w.HTMLMediaElement.prototype.pause = () => {};
    w.HTMLMediaElement.prototype.load = () => {};
    if (saved !== undefined) w.localStorage.setItem(VOLUME_KEY, saved);
    w.eval(fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerSettingsMenu.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerMediaControls.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerGhostPreview.js'), 'utf8'));
    w.eval(source);
    const api = w.MovieExtension_PlayerCleaner._test;
    api.replacePlayerForTest();
    t.after(() => { api.teardownActiveWrapper(); w.close(); });
    const video = w.document.querySelector('video');
    const volume = w.document.querySelector('.player-volume-control');
    const track = volume.querySelector('.player-volume-track');
    track.getBoundingClientRect = () => ({ top: 20, bottom: 100, height: 80, left: 0, right: 4, width: 4 });
    const mouse = (target, event, y) => target.dispatchEvent(new w.MouseEvent(event, { bubbles: true, clientY: y }));
    return { w, api, video, volume, track, mouse, fill: track.firstElementChild };
}

test('saved volume, mute/unmute and clamped pointer range use actual player controls', t => {
    const h = boot(t, '0.35');
    assert.equal(h.video.volume, .35); assert.equal(h.video.muted, false);
    assert.equal(h.fill.style.height, '35%');
    const button = h.volume.querySelector('button');
    button.click();
    assert.equal(h.video.volume, 0); assert.equal(h.video.muted, true);
    assert.equal(h.w.localStorage.getItem(VOLUME_KEY), '0');
    assert.equal(h.fill.style.height, '0%');
    button.click();
    assert.equal(h.video.volume, .35); assert.equal(h.video.muted, false);
    assert.equal(h.w.localStorage.getItem(VOLUME_KEY), '0.35');
    h.mouse(h.track, 'mousedown', 60);
    assert.equal(h.video.volume, .5); assert.equal(h.fill.style.height, '50%');
    h.mouse(h.w.document, 'mousemove', -30);
    assert.equal(h.video.volume, 1); assert.equal(h.video.muted, false);
    h.mouse(h.w.document, 'mousemove', 180);
    assert.equal(h.video.volume, 0); assert.equal(h.video.muted, true);
    h.mouse(h.w.document, 'mouseup', 180);
    h.mouse(h.w.document, 'mousemove', 20);
    assert.equal(h.video.volume, 0, 'mouseup ends volume dragging');
    assert.equal(h.w.localStorage.getItem(VOLUME_KEY), '0');
});

test('saved zero starts muted; malformed/out-of-range saved values retain the media default', t => {
    for (const saved of ['0', 'not-a-number', '-0.5', '1.5']) {
        const h = boot(t, saved);
        assert.equal(h.video.volume, saved === '0' ? 0 : 1, saved);
        assert.equal(h.video.muted, saved === '0', saved);
    }
});

test('speed menu invokes actual playbackRate handlers and updates selected state', t => {
    const h = boot(t);
    const speedItem = [...h.w.document.querySelectorAll('.player-settings-menu__item')]
        .find(item => item.querySelector('.player-settings-menu__label')?.textContent === 'Скорость');
    assert.ok(speedItem); speedItem.click();
    const options = () => [...h.w.document.querySelectorAll('.player-settings-menu__option')];
    assert.deepEqual(options().map(option => option.querySelector('.player-settings-menu__option-label').textContent),
        ['0.5x', '0.75x', '1x', '1.25x', '1.5x', '2x']);
    options().find(option => option.textContent.trim() === '1.5x').click();
    assert.equal(h.video.playbackRate, 1.5);
    assert.equal(options().find(option => option.getAttribute('aria-checked') === 'true').textContent.trim(), '1.5x');
    options().find(option => option.textContent.trim() === '0.5x').click();
    assert.equal(h.video.playbackRate, .5);
    assert.equal(h.w.localStorage.getItem(VOLUME_KEY), null, 'speed selection does not change the volume preference');
});

test('wrapper teardown removes document drag handlers; rebuilt controls restore persisted volume', t => {
    const h = boot(t, '.4');
    h.mouse(h.track, 'mousedown', 40);
    assert.equal(h.video.volume, .75);
    h.api.teardownActiveWrapper();
    h.mouse(h.w.document, 'mousemove', 100);
    assert.equal(h.video.volume, .75, 'disposed wrapper no longer responds to document dragging');
    const fresh = boot(t, h.w.localStorage.getItem(VOLUME_KEY));
    assert.equal(fresh.video.volume, .75);
    fresh.mouse(fresh.track, 'mousedown', 80);
    assert.equal(fresh.video.volume, .25, 'new wrapper has a functioning single drag path');
    assert.equal(h.video.volume, .75, 'new wrapper actions leave the disposed video untouched');
});

test('existing wrapper rebind preserves rate and volume on a replacement episode video', t => {
    const h = boot(t, '.4');
    const speedItem = [...h.w.document.querySelectorAll('.player-settings-menu__item')]
        .find(item => item.querySelector('.player-settings-menu__label')?.textContent === 'Скорость');
    speedItem.click();
    [...h.w.document.querySelectorAll('.player-settings-menu__option')]
        .find(option => option.textContent.trim() === '1.5x').click();
    const replacement = h.w.document.createElement('video');
    replacement.src = 'https://fixture.test/episode-two.mp4';
    h.w.document.getElementById('videoContainer').append(replacement);
    h.api.replacePlayerForTest();
    assert.equal(h.w.document.querySelectorAll('.native-player-wrapper').length, 1);
    assert.ok(replacement.closest('.native-player-wrapper'));
    assert.equal(replacement.playbackRate, 1.5);
    assert.equal(replacement.volume, .4);
    assert.equal(h.video.isConnected, false);
    h.mouse(h.track, 'mousedown', 80);
    assert.equal(replacement.volume, .25, 'existing controls target the replacement media');
    assert.equal(h.video.volume, .4, 'detached media does not receive new control changes');
});
