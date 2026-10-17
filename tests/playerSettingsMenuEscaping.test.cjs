const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../content-scripts/player-cleaner.js'), 'utf8');
const dom = new JSDOM('<div id="videoContainer"><video src="https://fixture.test/movie.mp4"></video></div>', {
    url: 'https://fixture.test/', runScripts: 'outside-only', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole()
});
try {
    const { window } = dom;
    window.chrome = { runtime: { id: 'test', getURL: () => 'data:text/javascript,' } };
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.HTMLMediaElement.prototype.play = () => Promise.resolve();
    window.HTMLMediaElement.prototype.pause = () => {};
    window.HTMLMediaElement.prototype.load = () => {};
    const payload = '<img src=x onerror="window.__pwn=1"> & "English"';
    const video = window.document.querySelector('video');
    video._movieExtensionHls = {
        levels: [], audioTracks: [], subtitleTracks: [{ name: payload }],
        subtitleTrack: 0, subtitleDisplay: true, currentLevel: -1, autoLevelEnabled: true
    };
    window.eval(fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerSettingsMenu.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerMediaControls.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerGhostPreview.js'), 'utf8'));
    window.eval(source);
    window.MovieExtension_PlayerCleaner._test.replacePlayerForTest();
    const menu = window.document.querySelector('.player-settings-menu');
    assert.ok(menu, 'mount the real cleaner settings menu');
    assert.equal(menu.querySelectorAll('img').length, 0, 'provider subtitle names must never become HTML');
    const subtitleItem = [...menu.querySelectorAll('.player-settings-menu__item')]
        .find(item => item.querySelector('.player-settings-menu__label').textContent === 'Субтитры');
    assert.equal(subtitleItem.querySelector('.player-settings-menu__value').textContent, payload);
    assert.equal(window.__pwn, undefined);
    assert.equal(subtitleItem.querySelectorAll('svg.player-settings-menu__chevron').length, 1);
    assert.doesNotMatch(source, /header\.innerHTML\s*=[^;]*\$\{title\}/,
        'submenu title must not interpolate into HTML');
    window.MovieExtension_PlayerCleaner._test.teardownActiveWrapper();
    console.log('Player settings escaping: real cleaner DOM preserves hostile labels as text and keeps constant icons.');
} finally { dom.window.close(); }
