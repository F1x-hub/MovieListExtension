import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audioCode = fs.readFileSync(path.join(root, 'src/pages/random/RandomWheelAudio.js'), 'utf8');
const pageCode = fs.readFileSync(path.join(root, 'src/pages/random/random.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function audioHarness({ fetchAudio = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }), supported = true, volume = 1 } = {}) {
    let now = 0;
    const sources = [];
    const requests = [];
    const gains = [];
    let resumes = 0;
    class Context {
        get currentTime() { return now / 1000; }
        resume() { resumes++; return Promise.resolve(); }
        decodeAudioData() { return Promise.resolve({ duration: 70 }); }
        createGain() {
            const gain = {
                gain: {
                    value: 1, events: [],
                    setTargetAtTime(value) { this.value = value; },
                    cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); },
                    setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); },
                    linearRampToValueAtTime(value, time) { this.events.push({ type: 'ramp', value, time }); },
                    valueAtTime(time) {
                        let value = this.value;
                        let previousTime = 0;
                        for (const event of this.events) {
                            if (time < event.time) {
                                return event.type === 'ramp'
                                    ? value + (event.value - value) * (time - previousTime) / (event.time - previousTime)
                                    : value;
                            }
                            value = event.value;
                            previousTime = event.time;
                        }
                        return value;
                    }
                },
                connect(target) { this.target = target; },
                disconnect() { this.disconnected = true; }
            };
            gains.push(gain);
            return gain;
        }
        createBufferSource() {
            const source = {
                stops: [], started: false, disconnected: false,
                connect(target) { this.target = target; },
                disconnect() { this.disconnected = true; },
                start() { this.started = true; },
                stop(time = null) { this.stops.push(time); }
            };
            sources.push(source);
            return source;
        }
    }
    const context = {
        AudioContext: supported ? Context : undefined,
        performance: { now: () => now },
        fetch: url => { requests.push(url); return fetchAudio(url); },
        chrome: { runtime: { getURL: p => `chrome-extension://test/${p}` } }
    };
    runInNewContext(`${audioCode.replace('export class', 'class')}\nglobalThis.RandomWheelAudio = RandomWheelAudio;`, context);
    return { audio: new context.RandomWheelAudio(volume), sources, requests, gains, setNow: n => { now = n; }, get resumes() { return resumes; } };
}

// The master volume controls both tracks independently of their playback envelopes.
{
    const h = audioHarness({ volume: 0 });
    h.audio.startSpin(6000);
    await flush();
    assert.equal(h.gains[0].gain.value, 0);
    assert.equal(h.sources[0].target.target, h.gains[0]);
    h.audio.setVolume(0.35);
    assert.equal(h.gains[0].gain.value, 0.35);
    assert.equal(h.sources.length, 1, 'Changing volume must not restart the track');
    h.audio.finish();
    await flush();
    assert.equal(h.sources[1].target.target, h.gains[0]);
    h.audio.setVolume(0);
    assert.equal(h.gains[0].gain.value, 0, 'Mute must apply to the result cue too');
    h.audio.setVolume(2);
    assert.equal(h.audio.volume, 1);
    h.audio.setVolume(NaN);
    assert.equal(h.audio.volume, 1);
    h.audio.stop();
}

// Fade smoothly to silence at the deadline, without changing the user's volume or the cue.
{
    const h = audioHarness();
    h.audio.startSpin(6000);
    await flush();
    const spinEnvelope = h.sources[0].target;
    assert.equal(spinEnvelope.gain.valueAtTime(4.8), 1, 'Keep full music until the final 1.2 seconds');
    assert.ok(Math.abs(spinEnvelope.gain.valueAtTime(5.4) - 0.5) < 1e-9);
    h.setNow(5400);
    h.audio.setVolume(0.35);
    assert.ok(Math.abs(spinEnvelope.gain.valueAtTime(5.4) - 0.5) < 1e-9, 'Changing volume must preserve the fade');
    assert.equal(spinEnvelope.gain.valueAtTime(6), 0, 'Audio-clock automation must reach silence without frames');
    assert.equal(h.sources[0].stops[0], 6);
    h.setNow(6000);
    h.audio.finish();
    await flush();
    const winnerEnvelope = h.sources[1].target;
    assert.equal(spinEnvelope.disconnected, true);
    assert.equal(winnerEnvelope.gain.valueAtTime(6), 1, 'The winner cue must not inherit the faded spin level');
    assert.equal(winnerEnvelope.target.gain.value, 0.35, 'The winner cue must retain the chosen volume');
    h.sources[0].onended();
    assert.equal(h.audio.envelope, winnerEnvelope, 'A late ended event must not clear the current cue');
    h.audio.stop();
    assert.equal(winnerEnvelope.disconnected, true);
}

// Short spins retain a full-volume first half; decoding inside the fade starts quietly.
{
    const h = audioHarness();
    h.audio.startSpin(2000);
    h.setNow(1650);
    await flush();
    const envelope = h.sources[0].target.gain;
    assert.ok(Math.abs(envelope.valueAtTime(1.65) - 0.35) < 1e-9);
    assert.equal(envelope.valueAtTime(2), 0);
    assert.equal(h.sources[0].stops[0], 2, 'Late decoding must preserve the fade deadline');
    h.audio.stop();

    const short = audioHarness();
    short.audio.startSpin(2000);
    await flush();
    assert.equal(short.sources[0].target.gain.valueAtTime(1), 1);
    assert.equal(short.sources[0].target.gain.valueAtTime(1.5), 0.5);
    short.audio.stop();
}

// The audio deadline includes loading time and uses the audio clock, not a timer or RAF.
{
    const h = audioHarness();
    h.audio.startSpin(2000);
    assert.equal(h.resumes, 1, 'Audio unlock must start synchronously in the click');
    h.setNow(250);
    await flush();
    assert.equal(h.sources[0].loop, true);
    assert.equal(h.sources[0].stops[0], 2, 'Decoding must not extend a short spin');
    h.audio.finish();
    await flush();
    assert.equal(h.sources[0].stops.at(-1), null);
    assert.equal(h.sources[0].disconnected, true);
    assert.equal(h.sources[1].loop, false, 'The result cue must play only once');
    assert.match(h.requests[1], /random-wheel-winner\.mp3$/);
    h.audio.startSpin(1800000);
    await flush();
    assert.equal(h.sources[1].disconnected, true, 'Reroll must stop an unfinished result cue');
    assert.equal(h.sources[2].loop, true);
    assert.equal(h.sources[2].stops[0], 1800.25, 'Long spins repeat until the configured deadline');
    assert.equal(h.requests.length, 2, 'Decoded tracks must be reused');
    h.audio.stop();
    assert.equal(h.sources[2].disconnected, true);
}

// Marathon pending animation unlocks audio before the server await; confirmation keeps it playing.
{
    const h = audioHarness();
    h.audio.startSpin();
    await flush();
    assert.equal(h.sources[0].target.gain.valueAtTime(100), 1, 'Pending marathon music must not fade early');
    h.setNow(4000);
    h.audio.startSpin(6000);
    await flush();
    assert.equal(h.sources.length, 1, 'Server confirmation must not restart the music');
    assert.equal(h.sources[0].stops[0], 10);
    assert.ok(Math.abs(h.sources[0].target.gain.valueAtTime(9.4) - 0.5) < 1e-9);
    assert.equal(h.sources[0].target.gain.valueAtTime(10), 0);
    h.audio.stop();
}

// Closing/cancelling and expired deadlines prevent delayed decoding from starting music.
for (const action of ['stop', 'expire', 'finish']) {
    const pendingFetches = [];
    const h = audioHarness({ fetchAudio: () => new Promise(resolve => { pendingFetches.push(resolve); }) });
    h.audio.startSpin(2000);
    if (action === 'stop') h.audio.stop();
    if (action === 'expire') h.setNow(2001);
    if (action === 'finish') { h.audio.finish(); h.audio.stop(); }
    for (const resolveFetch of pendingFetches) {
        resolveFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
    }
    await flush();
    assert.equal(h.sources.length, 0, `${action} must invalidate late audio`);
}

// A failed asset request can recover on a later spin.
{
    let attempts = 0;
    const h = audioHarness({ fetchAudio: async url => ({
        ok: url.includes('winner') || ++attempts > 1,
        arrayBuffer: async () => new ArrayBuffer(1)
    }) });
    h.audio.startSpin(2000);
    await flush();
    h.audio.stop();
    h.audio.startSpin(2000);
    await flush();
    assert.equal(h.sources.length, 1);
    assert.equal(attempts, 2);
    h.audio.stop();
}

// Missing assets and unavailable Web Audio never reject the movie-selection flow.
for (const options of [{ supported: false }, { fetchAudio: async () => ({ ok: false }) }]) {
    const h = audioHarness(options);
    assert.doesNotThrow(() => h.audio.startSpin(2000));
    await flush();
    assert.equal(h.sources.length, 0);
    assert.doesNotThrow(() => h.audio.finish());
    await flush();
}

// Exercise the real page handlers and animation with controlled frames, without network or storage writes.
{
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://wheel.test/' });
    const pageErrors = [];
    dom.window.addEventListener('error', event => { pageErrors.push(event.error); });
    let now = 0;
    let reducedMotion = false;
    const frames = [];
    const calls = [];
    class Audio {
        constructor(volume) { this.volume = volume; }
        setVolume(volume) { this.volume = volume; }
        startSpin(duration = null) { calls.push(['spin', duration]); }
        finish() { calls.push(['winner']); }
        stop() { calls.push(['stop']); }
    }
    dom.window.matchMedia = () => ({ matches: reducedMotion });
    const context = {
        document: dom.window.document, window: dom.window, localStorage: dom.window.localStorage,
        URL, RandomWheelAudio: Audio, KinopoiskService: class {}, i18n: { get: key => key },
        setTimeout, clearTimeout, setInterval, clearInterval,
        performance: { now: () => now }, requestAnimationFrame: fn => frames.push(fn),
        getComputedStyle: () => ({ transform: 'none' }),
        chrome: { runtime: { getURL: p => `https://wheel.test/${p}` } }
    };
    runInNewContext(`${pageCode.replace(/^import .*;\r?\n/gm, '')}\nglobalThis.RandomManager = RandomManager;`, context);
    context.RandomManager.prototype.init = () => {};
    const manager = new context.RandomManager();
    assert.equal(manager.rollVolumePercent, 100, 'No saved setting must preserve full volume');
    manager._buildRollOverlay();
    const volumeInput = dom.window.document.getElementById('rollVolumeInput');
    const volumeButton = dom.window.document.getElementById('rollVolumeBtn');
    const volumePanel = dom.window.document.getElementById('rollVolumePanel');
    const settingsButton = dom.window.document.getElementById('rollSettingsBtn');
    const settingsPanel = dom.window.document.getElementById('rollSettingsPanel');
    assert.equal(volumePanel.hidden, true, 'The slider must stay collapsed until requested');
    assert.equal(volumeButton.getAttribute('aria-expanded'), 'false');
    volumeButton.click();
    assert.equal(volumePanel.hidden, false);
    assert.equal(volumeButton.getAttribute('aria-expanded'), 'true');
    assert.equal(dom.window.document.activeElement, volumeInput, 'Opening volume must focus the keyboard slider');
    volumeInput.click();
    assert.equal(volumePanel.hidden, false, 'Clicks inside the panel must not dismiss it');
    volumeInput.value = '35';
    volumeInput.dispatchEvent(new dom.window.Event('input'));
    assert.equal(manager._rollAudio.volume, 0.35);
    assert.equal(dom.window.localStorage.getItem('random_wheel_volume_percent'), '35');
    assert.equal(dom.window.document.getElementById('rollVolumeValue').textContent, '35%');
    assert.equal(volumeButton.getAttribute('aria-label'), 'Громкость: 35%');
    manager._setRollBusy(true);
    assert.equal(volumeInput.disabled, false, 'The slider must remain available during a spin');
    assert.equal(volumeButton.disabled, false, 'Volume must open during a spin');
    volumeInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(volumePanel.hidden, true, 'Escape must close volume even during a spin');
    assert.equal(manager.rollAnimRunning, true, 'Closing volume must not cancel the wheel');
    assert.equal(dom.window.document.activeElement, volumeButton, 'Escape must return focus to the volume button');
    manager._setRollBusy(false);
    volumeButton.click();
    settingsButton.click();
    assert.equal(volumePanel.hidden, true, 'The time and volume panels must not overlap');
    assert.equal(settingsPanel.hidden, false);
    volumeButton.click();
    assert.equal(settingsPanel.hidden, true);
    assert.equal(volumePanel.hidden, false);
    dom.window.document.getElementById('rollTitle').click();
    assert.equal(volumePanel.hidden, true, 'An outside click must dismiss volume');
    volumeButton.click();
    volumeButton.click();
    assert.equal(volumePanel.hidden, true, 'The speaker button must toggle its panel');
    volumeInput.value = '0';
    volumeInput.dispatchEvent(new dom.window.Event('input'));
    assert.equal(volumeInput.getAttribute('aria-valuetext'), 'Звук выключен');
    assert.equal(volumeButton.classList.contains('is-muted'), true);
    assert.match(volumeButton.getAttribute('aria-label'), /Звук выключен/);
    const restoredManager = new context.RandomManager();
    assert.equal(restoredManager.rollVolumePercent, 0, 'Saved mute must survive a new page instance');
    assert.equal(restoredManager._rollAudio.volume, 0);
    dom.window.localStorage.setItem('random_wheel_volume_percent', 'bad');
    assert.equal(new context.RandomManager().rollVolumePercent, 100, 'Invalid saved volume must use the default');
    manager.pool = [{ kpId: 1, title: 'One' }, { kpId: 2, title: 'Two' }];
    manager._showRollReady(manager.pool, () => manager._rollFromPool());
    calls.length = 0;
    dom.window.document.getElementById('rollCenterBtn').click();
    assert.deepEqual(calls, [['spin', 6000]]);
    now = 5999;
    frames.shift()(now);
    assert.equal(calls.length, 1, 'No result cue before the wheel stops');
    now = 6000;
    frames.shift()(now);
    assert.deepEqual(calls[1], ['winner']);
    assert.equal(dom.window.document.getElementById('rollTitle').textContent, 'Выпал фильм');
    volumeButton.click();
    dom.window.document.getElementById('rollCloseBtn').click();
    assert.deepEqual(calls.at(-1), ['stop']);
    assert.equal(volumePanel.hidden, true, 'Closing the wheel must collapse volume for the next opening');

    manager._showRollPendingAnimation(manager.pool);
    assert.deepEqual(calls.at(-1), ['spin', null]);
    volumeButton.click();
    manager._stopRollAnimation();
    assert.deepEqual(calls.at(-1), ['stop'], 'Failed marathon selections must stop audio');
    assert.equal(volumePanel.hidden, true, 'Cancellation must reset the collapsed volume state');
    assert.equal(volumeButton.getAttribute('aria-expanded'), 'false');

    manager._showRollAnimation(manager.pool, 0);
    manager._stopRollAnimation();
    const beforeStaleFrame = calls.length;
    frames.shift()(now + 6000);
    assert.equal(calls.length, beforeStaleFrame, 'Cancelled frames must not play the winner cue');

    reducedMotion = true;
    calls.length = 0;
    manager._showRollAnimation(manager.pool, 0);
    frames.shift()(now);
    assert.deepEqual(calls, [['stop'], ['winner']], 'Instant results skip spin music');
    manager._showRollAnimation(manager.pool, 0, { onWinner: () => {} });
    frames.shift()(now);
    dom.window.document.getElementById('rollGoBtn').click();
    assert.deepEqual(calls.at(-1), ['stop'], 'Opening the selected movie must stop the cue');
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    assert.deepEqual(calls.at(-1), ['stop']);
    assert.equal(manager._disposed, true, 'Pagehide must complete page cleanup');
    assert.deepEqual(pageErrors, [], 'Page event handlers must not fail silently in JSDOM');
    dom.window.close();
}

for (const name of ['spin', 'winner']) {
    assert.ok(fs.statSync(path.join(root, `src/shared/assets/audio/random-wheel-${name}.mp3`)).size > 1000);
}
console.log('Random wheel audio: timing, looping, smooth fades, live/saved volume, lifecycle, cancellation and failure checks passed.');
