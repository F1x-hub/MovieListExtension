const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerMediaControls.js'), 'utf8'), context);
const { Timeline } = context.PlayerMediaControls;

const media = (ranges, duration = 600) => ({
    duration,
    buffered: {
        length: ranges.length,
        start: index => ranges[index][0],
        end: index => ranges[index][1]
    }
});

test('a jump inside a loaded range counts as buffered', () => {
    const video = media([[0, 120]]);
    assert.equal(Timeline.isBuffered(video, 10), true);
    assert.equal(Timeline.isBuffered(video, 119), true);
});

test('a jump past the loaded range, or into its last half second, needs loading', () => {
    const video = media([[0, 120]]);
    assert.equal(Timeline.isBuffered(video, 125), false);
    assert.equal(Timeline.isBuffered(video, 119.8), false);
});

test('a fragment starting a moment after the target still counts', () => {
    assert.equal(Timeline.isBuffered(media([[30.1, 90]]), 30), true);
    assert.equal(Timeline.isBuffered(media([[31, 90]]), 30), false);
});

test('a gap between ranges is not buffered; the range after it is', () => {
    const video = media([[0, 60], [200, 260]]);
    assert.equal(Timeline.isBuffered(video, 100), false);
    assert.equal(Timeline.isBuffered(video, 210), true);
});

test('the very end of the film counts when it is loaded', () => {
    assert.equal(Timeline.isBuffered(media([[500, 600]], 600), 599.9), true);
});

test('missing data or time is never buffered', () => {
    assert.equal(Timeline.isBuffered(null, 10), false);
    assert.equal(Timeline.isBuffered(media([]), 10), false);
    assert.equal(Timeline.isBuffered(media([[0, 120]]), Number.NaN), false);
});
