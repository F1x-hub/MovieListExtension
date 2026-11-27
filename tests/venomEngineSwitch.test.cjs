/**
 * Venom plays DASH (1080p) while the viewer watches, HLS while they jump around (its DASH
 * engine throws loaded data away on every seek), and DASH again after calm watching or at
 * the viewer's pause. The switch is Venom's own `renew`; this checks when it is asked for.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const guard = fs.readFileSync(path.join(__dirname, '../content-scripts/provider-ad-guard.js'), 'utf8');

function harness({ source = { dash: 'a.mpd', dasha: 'a-av1.mpd', hls: 'a.m3u8' } } = {}) {
    let now = 0;
    let timers = [];
    let nextId = 1;
    const listeners = [];
    const videos = [];
    const documentElement = { dataset: {} };
    const document = {
        referrer: '',
        documentElement,
        addEventListener: (type, handler) => listeners.push([type, handler]),
        querySelectorAll: selector => (selector === 'video' ? videos.filter(video => video.isConnected) : [])
    };
    const makeVideo = () => {
        const video = {
            tagName: 'VIDEO', dataset: {}, isConnected: true, currentSrc: 'blob:x', src: 'blob:x',
            duration: 7200, currentTime: 100, paused: false, seeking: false, readyState: 4,
            plays: 0,
            play() { this.plays += 1; this.paused = false; return Promise.resolve(); },
            pause() { this.paused = true; emit('pause', this); },
            addEventListener(type, handler) { (this.handlers ||= []).push([type, handler]); }
        };
        videos.push(video);
        return video;
    };
    const emit = (type, target) => listeners.filter(item => item[0] === type).forEach(item => item[1]({ type, target }));
    const renews = [];
    const makeInternal = (config, video) => {
        const events = {};
        const internal = {
            config, video,
            on(type, handler) { (events[type] ||= []).push(handler); },
            once(type, handler) { (events[type] ||= []).push(handler); },
            fire(type) { (events[type] || []).splice(0).forEach(handler => handler.call(internal)); },
            renew(next) {
                renews.push(next);
                video.isConnected = false;
                const fresh = makeVideo();
                fresh.currentTime = next.time;
                const created = makeInternal(next, fresh);
                facade.current = created;
                return created;
            }
        };
        return internal;
    };
    const facade = {
        current: null,
        once(type, handler) { this.current.once(type, handler); return this; },
        on(type, handler) { this.current.on(type, handler); return this; }
    };
    const window = {
        location: Object.assign(new URL('https://api.corevia.ws/embed/kp/1?santabarbaranoads=1'), { ancestorOrigins: [] }),
        localStorage: { getItem: () => null, setItem() {} },
        document, history: { replaceState() {} }
    };
    const context = vm.createContext({
        window, document, URL, Date, Math, Number, Object, JSON, Array, Promise, self: {}, top: {},
        performance: { now: () => now },
        console: { info() {}, warn() {}, debug() {} },
        setTimeout: (handler, delay = 0) => { const id = nextId++; timers.push({ id, at: now + delay, handler }); return id; },
        clearTimeout: id => { timers = timers.filter(timer => timer.id !== id); }
    });
    vm.runInContext(guard, context);
    window.VenomPlayer = {
        make: options => {
            facade.current = makeInternal(options, makeVideo());
            return facade;
        }
    };
    window.VenomPlayer.make({ container: {}, source: { ...source } });
    const advance = ms => {
        const end = now + ms;
        for (;;) {
            timers.sort((a, b) => a.at - b.at);
            const due = timers[0];
            if (!due || due.at > end) break;
            timers.shift();
            now = due.at;
            due.handler();
        }
        now = end;
    };
    const film = () => videos.filter(video => video.isConnected).at(-1);
    // Venom reports time once it plays; the guard learns its internal player from that.
    const startPlaying = () => {
        facade.current.fire('timeupdate');
        emit('playing', film());
        advance(3500);
    };
    const seek = to => {
        const video = film();
        video.currentTime = to ?? video.currentTime + 10;
        emit('seeking', video);
    };
    return { advance, seek, startPlaying, renews, film, emit, engine: () => documentElement.dataset.movieExtensionEngine || 'dash', facade };
}

test('plain watching and an occasional jump stay on DASH', () => {
    const h = harness();
    h.startPlaying();
    h.seek(); h.advance(3000); h.seek(); h.advance(3000); h.seek(); h.advance(3000);
    assert.equal(h.renews.length, 0, 'jumps 3 s apart are not a burst');
    assert.equal(h.engine(), 'dash');
});

test('three jumps within 5 s switch to HLS at the moment the viewer settled on', () => {
    const h = harness();
    h.startPlaying();
    h.seek(110); h.advance(500); h.seek(120); h.advance(500); h.seek(130);
    assert.equal(h.renews.length, 0, 'the switch waits for the burst to settle');
    h.advance(800);
    assert.equal(h.renews.length, 1);
    const asked = h.renews[0];
    assert.equal(asked._fallFrom, 'dash');
    assert.equal(asked.time, 130);
    assert.equal(asked.ignoreUrlTime, true, 'a time in the frame address must not win');
    assert.equal(asked.source.hls, 'a.m3u8');
    assert.equal(h.engine(), 'hls');
});

test('the seeks of a starting film are not counted', () => {
    const h = harness();
    h.facade.current.fire('timeupdate');
    h.seek(10); h.seek(20); h.seek(30);
    h.advance(1000);
    assert.equal(h.renews.length, 0, 'before it plays, seeks are the resume, not the viewer');
    h.emit('playing', h.film());
    h.seek(40); h.seek(50); h.seek(60);
    h.advance(1000);
    assert.equal(h.renews.length, 0, 'nor within 3 s of the first play');
});

test('a source without HLS keeps DASH whatever the viewer does', () => {
    const h = harness({ source: { dash: 'a.mpd' } });
    h.startPlaying();
    for (let i = 0; i < 6; i++) { h.seek(); h.advance(300); }
    h.advance(1000);
    assert.equal(h.renews.length, 0);
});

test('two minutes of calm watching on HLS bring DASH back', () => {
    const h = harness();
    h.startPlaying();
    h.seek(); h.seek(); h.seek();
    h.advance(800);
    const hlsFilm = h.film();
    h.emit('playing', hlsFilm);
    h.advance(3500);
    h.seek(); h.advance(60000);
    assert.equal(h.renews.length, 1, 'a jump on HLS starts the calm period again');
    h.advance(61000);
    assert.equal(h.renews.length, 2);
    const back = h.renews[1];
    assert.equal(back.source.dash, 'a.mpd', 'DASH is back in the source');
    assert.equal(back._fallFrom, undefined);
    assert.equal(h.engine(), 'dash');
});

test("the viewer's pause brings DASH back without a visible stop", () => {
    const h = harness();
    h.startPlaying();
    h.seek(); h.seek(); h.seek();
    h.advance(800);
    h.emit('playing', h.film());
    h.advance(3500);
    h.advance(20000);
    h.film().pause();
    h.advance(400);
    assert.equal(h.renews.length, 2);
    assert.equal(h.renews[1].source.dash, 'a.mpd');
    assert.equal(h.film().plays, 0, 'a paused film stays paused');
});

test('a pause right after jumping around keeps HLS', () => {
    const h = harness();
    h.startPlaying();
    h.seek(); h.seek(); h.seek();
    h.advance(800);
    h.emit('playing', h.film());
    h.advance(3500);
    h.seek(); h.advance(2000);
    h.film().pause();
    h.advance(400);
    assert.equal(h.renews.length, 1, 'the viewer is still looking for a moment');
});

test('a new episode starts on DASH and counts afresh', () => {
    const h = harness();
    h.startPlaying();
    h.seek(); h.seek(); h.seek();
    h.advance(800);
    h.facade.current.fire('playlistItem');
    h.advance(130000);
    assert.equal(h.renews.length, 1, 'no switch back is asked for: the episode brings its own DASH source');
});
