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
test('a torrent being prepared spans the whole film and blocks what it cannot play yet', () => {
    const plain = (span) => JSON.parse(JSON.stringify(span));
    // Any other video spans its own duration, all of it available.
    assert.deepEqual(plain(Timeline.describe({ duration: 300 })), { duration: 300, availableEnd: 300, downloadedEnd: 300, partial: false });
    assert.deepEqual(plain(Timeline.describe({ duration: NaN })), { duration: 0, availableEnd: 0, downloadedEnd: 0, partial: false });
    assert.equal(Timeline.describe(null).duration, 0);
    const preparing = { duration: 600, _mediaTimeline: { totalSeconds: 3600, downloadedFraction: .4, complete: false } };
    const span = Timeline.describe(preparing);
    assert.deepEqual(plain(span), { duration: 3600, availableEnd: 600, downloadedEnd: 1440, partial: true });
    assert.equal(Timeline.isAvailable(span, 600), true);
    assert.equal(Timeline.isAvailable(span, 601), false);
    assert.equal(Timeline.isAvailable(span, NaN), false);
    // Before the stream starts, the film's length is still known.
    assert.deepEqual(plain(Timeline.describe({ duration: NaN, _mediaTimeline: { totalSeconds: 3600, downloadedFraction: 2 } })),
        { duration: 3600, availableEnd: 0, downloadedEnd: 3600, partial: true });
    // The downloaded estimate never trails what already plays.
    assert.equal(Timeline.describe({ duration: 900, _mediaTimeline: { totalSeconds: 3600, downloadedFraction: .1 } }).downloadedEnd, 900);
    // A complete conversion, an unknown length or one the stream already reached hand back to the element.
    for (const plan of [{ totalSeconds: 3600, complete: true }, { totalSeconds: null }, { totalSeconds: 590 }]) {
        assert.equal(Timeline.describe({ duration: 600, _mediaTimeline: plan }).partial, false);
    }
    assert.equal(Timeline.isAvailable(Timeline.describe({ duration: 300 }), 299), true);
});
