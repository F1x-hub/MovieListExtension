const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../content-scripts/provider-buffer-keeper.js'), 'utf8');

const ranges = list => ({ length: list.length, start: index => list[index][0], end: index => list[index][1] });

/** A provider frame with one film element and one source buffer. */
function frame({ embedded = true, ancestors = ['chrome-extension://abcdefghijklmnopabcdefghijklmnop'], href = 'https://api.corevia.ws/embed/kp/1', buffered = [[100, 400]], duration = 7200 } = {}) {
    const calls = [];
    const state = { now: 10000, updating: false, quota: false };
    class HTMLMediaElement {}
    class SourceBuffer {
        get updating() { return state.updating; }
        get buffered() { return ranges(buffered); }
        remove(start, end) { calls.push([start, end]); }
        appendBuffer() { if (state.quota) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); }
    }
    const media = Object.assign(new HTMLMediaElement(), { currentSrc: 'blob:https://api.corevia.ws/1', src: '', currentTime: 350, duration });
    const listeners = {};
    const window = {
        SourceBuffer,
        HTMLMediaElement,
        location: { href, ancestorOrigins: ancestors },
        performance: { now: () => state.now },
        document: {
            referrer: '',
            addEventListener: (type, handler) => { listeners[type] = handler; },
            querySelectorAll: () => [media]
        },
        URL
    };
    window.window = window;
    window.self = window;
    window.top = embedded ? {} : window;
    vm.runInContext(source, vm.createContext(window));
    const buffer = new SourceBuffer();
    return { calls, state, media, buffer, kept: SourceBuffer.prototype.remove.movieExtensionBufferKeeper === true, seek: () => listeners.seeking({ target: media }) };
}

/** A range that holds no data, so removing it changes nothing. */
const isSpare = ([start, end], buffered) => end - start <= 0.01 && buffered.every(([from, to]) => end <= from || start >= to);

test('only frames the extension embeds are touched', () => {
    assert.equal(frame().kept, true);
    assert.equal(frame({ embedded: false }).kept, false, 'a top-level page');
    assert.equal(frame({ ancestors: ['https://kinogo.la'] }).kept, false, 'an ordinary website embed');
    assert.equal(frame({ ancestors: [], href: 'https://api.corevia.ws/embed/kp/1?santabarbaranoads=1' }).kept, true, 'the flag stands in for hidden ancestors');
});

test('five minutes behind the playing moment stay', () => {
    const near = frame();
    near.buffer.remove(0, 340);
    assert.deepEqual(near.calls, [[0, 50]], 'only what is further than 300 s behind goes');

    const early = frame({ buffered: [[100, 400]] });
    early.media.currentTime = 200;
    early.buffer.remove(100, 190);
    assert.equal(early.calls.length, 1);
    assert.ok(isSpare(early.calls[0], [[100, 400]]), 'nothing within five minutes is removed, the browser still runs a removal');
});

test('what is loaded ahead stays after a seek, and goes otherwise', () => {
    const jumped = frame();
    jumped.seek();
    jumped.state.now += 400;
    jumped.buffer.remove(370, 400);
    assert.ok(isSpare(jumped.calls[0], [[100, 400]]), 'a trim right after a seek');

    const later = frame();
    later.seek();
    later.state.now += 5000;
    later.buffer.remove(370, 400);
    assert.deepEqual(later.calls, [[370, 400]], 'a later removal ahead is the player changing quality');
});

test('a flush across the playing moment passes', () => {
    const flushed = frame();
    flushed.seek();
    flushed.buffer.remove(0, Infinity);
    assert.deepEqual(flushed.calls, [[0, Infinity]]);
});

test('after the browser runs out of room the player removes what it wants', () => {
    const full = frame();
    full.state.quota = true;
    assert.throws(() => full.buffer.appendBuffer(new Uint8Array(1)), { name: 'QuotaExceededError' });
    full.buffer.remove(0, 340);
    assert.deepEqual(full.calls, [[0, 340]]);
    full.state.now += 31000;
    full.buffer.remove(0, 340);
    assert.deepEqual(full.calls[1], [0, 50], 'the pause ends');
});

test('a fully loaded film has no spare moment, so the removal passes', () => {
    const whole = frame({ buffered: [[0, 7200]], duration: 7200 });
    whole.media.currentTime = 100;
    whole.buffer.remove(0, 90);
    assert.deepEqual(whole.calls, [[0, 90]]);
});

test('a busy buffer is left to raise its own error', () => {
    const busy = frame();
    busy.state.updating = true;
    busy.buffer.remove(0, 340);
    assert.deepEqual(busy.calls, [[0, 340]]);
});
