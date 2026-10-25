const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '../src/shared/services/player/YouTubeMediaElement.js'), 'utf8');
const ORIGIN = 'https://movielistdb-13208.web.app';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function setup(options = {}) {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    const { window } = dom;
    // jsdom's addTextTrack is a no-op: a minimal list with the same surface.
    {
        Object.defineProperty(window.HTMLMediaElement.prototype, 'textTracks', {
            configurable: true,
            get() {
                if (!this._tracks) this._tracks = Object.assign(new window.EventTarget(), { list: [] });
                const tracks = this._tracks;
                return new Proxy(tracks, {
                    get: (target, key) => {
                        if (key === 'length') return target.list.length;
                        if (key === Symbol.iterator) return () => target.list[Symbol.iterator]();
                        if (/^\d+$/.test(String(key))) return target.list[key];
                        const value = Reflect.get(target, key, target);
                        return typeof value === 'function' ? value.bind(target) : value;
                    }
                });
            }
        });
        window.HTMLMediaElement.prototype.addTextTrack = function (kind, label, language) {
            const track = { kind, label, language, mode: 'hidden' };
            this.textTracks.list.push(track);
            return track;
        };
    }
    window.eval(code);
    const sent = [];
    const frameWindow = { postMessage: (message, origin) => sent.push({ ...message, origin }) };
    const frame = { contentWindow: frameWindow };
    const infos = [];
    const errors = [];
    const media = window.YouTubeMediaElement.create({
        frame, origin: ORIGIN, videoId: 'dQw4w9WgXcQ', document: window.document,
        onInfo: info => infos.push(info), onError: info => errors.push(info), ...options
    });
    const events = [];
    ['play', 'playing', 'pause', 'waiting', 'seeking', 'seeked', 'durationchange', 'volumechange', 'ratechange', 'ended', 'loadedmetadata', 'canplay']
        .forEach(type => media.video.addEventListener(type, () => events.push(type)));
    const emit = (event, payload = {}) => media.handleMessage({
        origin: ORIGIN, source: frameWindow, data: { source: 'STARTTAB_PLAYER_WRAPPER', event, payload }
    });
    return { window, media, video: media.video, sent, events, infos, errors, emit, close: () => { media.destroy(); window.close(); } };
}

test('the stand-in is a real <video> the movie player can adopt', () => {
    const t = setup({ startSec: 42 });
    try {
        assert.equal(t.video.tagName, 'VIDEO');
        assert.match(t.video.src, /^blob:/, 'passes the movie player\'s media-source check');
        assert.equal(t.video.readyState, 0);
        assert.equal(t.video.currentTime, 42, 'starts at the cue point');
        assert.equal(t.video.paused, true);
        assert.ok(Number.isNaN(t.video.duration));
    } finally { t.close(); }
});

test('commands wait for READY, then sound and playback map to the IFrame API', () => {
    const t = setup();
    try {
        t.video.volume = 0.3;
        t.video.muted = true;
        assert.equal(t.sent.length, 0, 'nothing reaches a player that does not exist yet');
        assert.deepEqual(t.events, ['volumechange', 'volumechange']);

        t.emit('READY', { duration: 300 });
        assert.equal(t.video.readyState, 4);
        assert.equal(t.video.duration, 300);
        assert.deepEqual(t.sent.map(m => [m.action, m.payload?.volume]), [['SET_VOLUME', 30], ['MUTE', undefined]]);
        assert.ok(t.sent.every(m => m.origin === ORIGIN));
        assert.ok(t.events.includes('loadedmetadata') && t.events.includes('canplay'));
        assert.deepEqual({ ...t.infos.at(-1) }, { duration: 300, isLive: false });

        t.sent.length = 0;
        t.video.playbackRate = 1.5;
        t.video.muted = false;
        assert.deepEqual(t.sent.map(m => m.action), ['SET_RATE', 'UNMUTE']);
        assert.throws(() => { t.video.volume = 2; }, error => error.name === 'RangeError');
    } finally { t.close(); }
});

test('play, pause and seek fire media events like a <video>, driven by YouTube telemetry', async () => {
    const t = setup();
    try {
        t.emit('READY', { duration: 300 });
        t.events.length = 0;
        t.sent.length = 0;

        const played = t.video.play();
        assert.equal(t.video.paused, false);
        assert.deepEqual(t.sent.map(m => m.action), ['PLAY']);
        t.emit('STATE_CHANGE', { state: 'PLAYING', currentTime: 10, duration: 300 });
        await played;
        assert.deepEqual(t.events, ['play', 'playing']);

        t.events.length = 0;
        t.video.currentTime = 120;
        assert.deepEqual(t.events, ['seeking']);
        assert.equal(t.sent.at(-1).action, 'SEEK');
        assert.equal(t.sent.at(-1).payload.seconds, 120);
        t.emit('TIME_UPDATE', { currentTime: 120.2, duration: 300, state: 'PLAYING' });
        assert.deepEqual(t.events, ['seeking', 'seeked']);

        t.events.length = 0;
        t.video.pause();
        assert.deepEqual(t.events, ['pause']);
        assert.equal(t.sent.at(-1).action, 'PAUSE');
        t.emit('STATE_CHANGE', { state: 'PAUSED', currentTime: 121, duration: 300 });
        assert.deepEqual(t.events, ['pause'], 'the confirmation is not a second pause');
        assert.equal(Math.round(t.video.currentTime), 121);

        t.events.length = 0;
        t.emit('STATE_CHANGE', { state: 'BUFFERING', currentTime: 121 });
        assert.deepEqual(t.events, [], 'a paused element does not wait for data');

        t.emit('STATE_CHANGE', { state: 'PLAYING', currentTime: 121 });
        t.emit('STATE_CHANGE', { state: 'ENDED', currentTime: 300 });
        assert.deepEqual(t.events.slice(-2), ['pause', 'ended']);
        assert.equal(t.video.ended, true);
        assert.equal(t.video.currentTime, 300);
    } finally { t.close(); }
});

test('blocked autoplay rejects play() so the broadcast lock can retry muted', async () => {
    const t = setup();
    try {
        t.emit('READY', { duration: 300 });
        const started = Date.now();
        await assert.rejects(t.video.play(), error => error.name === 'NotAllowedError');
        assert.ok(Date.now() - started >= 2000);
        assert.equal(t.video.paused, true);
    } finally { t.close(); }
});

test('a cued video does not report 0 as its position; streams are infinite and never a length', () => {
    const t = setup({ startSec: 50 });
    try {
        t.emit('READY', { duration: 300 });
        t.emit('STATE_CHANGE', { state: 'CUED', currentTime: 0, duration: 300 });
        assert.equal(t.video.currentTime, 50);
    } finally { t.close(); }

    const stream = setup();
    try {
        stream.emit('READY', { duration: 75_037_431, isLive: false });
        assert.equal(stream.video.duration, Infinity);
        assert.deepEqual({ ...stream.infos.at(-1) }, { duration: 0, isLive: true });
    } finally { stream.close(); }

    const flagged = setup({ live: true });
    try {
        assert.equal(flagged.video.duration, Infinity);
    } finally { flagged.close(); }
});

test('only the own wrapper frame is listened to, and errors are reported', () => {
    const t = setup();
    try {
        assert.equal(t.media.handleMessage({ origin: 'https://evil.test', source: null, data: { source: 'STARTTAB_PLAYER_WRAPPER', event: 'READY', payload: {} } }), false);
        assert.equal(t.video.readyState, 0);
        t.emit('ERROR', { errorCode: 150, message: 'blocked' });
        assert.deepEqual(t.errors.map(error => ({ ...error })), [{ errorCode: 150, message: 'blocked' }]);
    } finally { t.close(); }
});

test('volume and mute stay inside one element: two viewers do not share them', () => {
    const first = setup();
    const second = setup();
    try {
        first.emit('READY', { duration: 300 });
        second.emit('READY', { duration: 300 });
        second.sent.length = 0;
        first.video.volume = 0.2;
        first.video.muted = true;
        assert.equal(second.video.volume, 1);
        assert.equal(second.video.muted, false);
        assert.deepEqual(second.sent, []);
    } finally { first.close(); second.close(); }
});

test('timeupdate keeps ticking between YouTube reports while playing', async () => {
    const t = setup();
    try {
        let ticks = 0;
        t.video.addEventListener('timeupdate', () => { ticks += 1; });
        t.emit('READY', { duration: 300 });
        t.emit('STATE_CHANGE', { state: 'PLAYING', currentTime: 5 });
        ticks = 0;
        await wait(600);
        assert.ok(ticks >= 2, `expected local ticks, got ${ticks}`);
        assert.ok(t.video.currentTime > 5.3, 'position advances between reports');
    } finally { t.close(); }
});

test('YouTube caption tracks become TextTracks; choosing one in the player turns it on in YouTube', () => {
    const t = setup();
    try {
        t.emit('READY', { duration: 300 });
        let refreshed = 0;
        t.video.addEventListener('extension-player-tracks-ready', () => { refreshed += 1; });
        t.sent.length = 0;
        t.emit('CAPTIONS', { tracks: [{ languageCode: 'en', displayName: 'English' }, { languageCode: 'ru', displayName: 'Русский' }], active: null });
        const tracks = [...t.video.textTracks];
        assert.deepEqual(tracks.map(track => `${track.language}:${track.label}:${track.mode}`), ['en:English:disabled', 'ru:Русский:disabled']);
        assert.equal(refreshed, 1, 'the settings menu is told to re-render');
        assert.equal(t.sent.at(-1).action, 'SET_CAPTIONS');
        assert.equal(t.sent.at(-1).payload.languageCode, null);

        tracks[1].mode = 'showing';
        t.video.textTracks.dispatchEvent(new t.window.Event('change'));
        assert.equal(t.sent.at(-1).payload.languageCode, 'ru');
        tracks[1].mode = 'disabled';
        t.video.textTracks.dispatchEvent(new t.window.Event('change'));
        assert.equal(t.sent.at(-1).payload.languageCode, null);

        t.emit('CAPTIONS', { tracks: [{ languageCode: 'en', displayName: 'English' }], active: null });
        assert.equal(t.video.textTracks.length, 2, 'a repeated list does not duplicate tracks');
    } finally { t.close(); }
});
