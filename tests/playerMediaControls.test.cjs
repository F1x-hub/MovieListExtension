const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const context = { setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../src/shared/services/player/PlayerMediaControls.js'), 'utf8'), context);
const { PlayerVolumeController, PlaybackRate, SubtitleAppearance, Timeline } = context.PlayerMediaControls;
test('media stays controllable with blocked storage; replacement and disposal respect ownership', () => {
    let video = { volume: .4, muted: false };
    const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
    const control = new PlayerVolumeController({ getVideo: () => video, storage: blocked });
    control.restore(); assert.equal(video.volume, .4);
    control.set(.7); assert.equal(video.volume, .7);
    control.toggle(); assert.equal(video.muted, true);
    control.toggle(); assert.equal(video.volume, .7);
    const old = video; video = { volume: 1, muted: false };
    control.set(.2); assert.equal(video.volume, .2); assert.equal(old.volume, .7);
    control.destroy(); control.set(.8); assert.equal(video.volume, .2); assert.equal(control.timer, null);
    assert.equal(PlaybackRate.set(video, Infinity), false); assert.equal(PlaybackRate.set(video, 10), false);
    assert.equal(PlaybackRate.set(video, 1.5), true); assert.equal(video.playbackRate, 1.5);
});
test('subtitle appearance rejects style injection and preserves bounded versioned values', () => {
    const normalized = SubtitleAppearance.normalize({ color: '#fff;url(SECRET)', fontSizePercent: 500, offsetPercent: -10, backgroundOpacity: 9, textShadow: 'url(SECRET)', position: 'fixed' });
    assert.equal(normalized.color, '#ffffff'); assert.equal(normalized.fontSizePercent, 200);
    assert.equal(normalized.offsetPercent, 2); assert.equal(normalized.backgroundOpacity, .9);
    assert.equal(normalized.textShadow, 'strong'); assert.equal(normalized.position, 'bottom');
    assert.equal(SubtitleAppearance.normalize({ color: '#AaBbCc' }).color, '#aabbcc');
});
test('timeline handles collapsed geometry and keeps hour formatting and clamped seeking ratios', () => {
    assert.equal(Timeline.ratio(50, { left: 0, width: 0 }), null);
    assert.equal(Timeline.ratio(Infinity, { left: 0, width: 100 }), null);
    assert.equal(Timeline.ratio(-20, { left: 0, width: 100 }), 0);
    assert.equal(Timeline.ratio(150, { left: 0, width: 100 }), 1);
    assert.equal(Timeline.ratio(60, { left: 10, width: 100 }), .5);
    assert.equal(Timeline.formatTime(3661), '1:01:01'); assert.equal(Timeline.formatTime(61), '1:01');
    assert.equal(Timeline.formatTime(NaN), '0:00');
});
