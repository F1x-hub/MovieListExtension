/**
 * Providers' own players start low: Venom takes its lowest quality until the viewer picks
 * one, Allplay saves 480p as if it had been picked, and Venom uploads the film to others.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const guard = fs.readFileSync(path.join(root, 'content-scripts/provider-ad-guard.js'), 'utf8');

function frame(url, { storage = {}, flag = true } = {}) {
    const saved = new Map(Object.entries(storage));
    const handlers = [];
    const timers = [];
    const document = {
        referrer: '',
        addEventListener: (type, handler) => handlers.push([type, handler]),
        body: null
    };
    const href = flag ? `${url}${url.includes('?') ? '&' : '?'}santabarbaranoads=1` : url;
    const location = Object.assign(new URL(href), { ancestorOrigins: [] });
    const localStorage = {
        getItem: key => saved.get(key) ?? null,
        setItem: (key, value) => saved.set(key, String(value))
    };
    for (const key of saved.keys()) Object.defineProperty(localStorage, key, { enumerable: true, configurable: true, value: saved.get(key) });
    const window = {
        location, localStorage, document, history: { replaceState() {} },
        RTCPeerConnection: class {}, webkitRTCPeerConnection: class {}
    };
    const context = vm.createContext({
        window, document, URL, Date, Math, Number, Object, JSON, Array, self: {}, top: {},
        console: { info() {}, warn() {}, debug() {} },
        setTimeout: (handler, delay) => { timers.push({ handler, delay }); return timers.length; },
        clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; }
    });
    vm.runInContext(guard, context);
    const emit = (type, target) => handlers.filter(item => item[0] === type).forEach(item => item[1]({ type, target }));
    return { window, saved, timers, emit, context };
}

const film = (extra = {}) => ({
    tagName: 'VIDEO', dataset: {}, seeking: false, paused: false, readyState: 2,
    classList: { contains: name => name === 'allplay__video' }, ...extra
});

function venom({ qualities = ['480', '720', '1080'], current = 1080, storage } = {}) {
    const env = frame('https://api.corevia.ws/embed/movie/1', { storage });
    const listeners = [];
    const container = { contains: () => true, querySelectorAll: () => [], addEventListener: (type, handler) => listeners.push([type, handler]) };
    let made = null;
    const changes = [];
    const settings = { qualities, currentQuality: current, changeQuality: value => changes.push(value) };
    env.window.VenomPlayer = { make: options => { made = options; return { cp: { settings }, updateQuality() {} }; } };
    env.window.VenomPlayer.make({ container, ads: { vast: 1 }, stats: ['wss://stats.example'], p2p: { packetSize: 1 } });
    const emit = (type, target) => listeners.filter(item => item[0] === type).forEach(item => item[1]({ type, target }));
    return { ...env, made, changes, settings, emit };
}

const stall = env => {
    const video = film();
    env.emit('waiting', video);
    const timer = env.timers.at(-1);
    if (!timer.cleared) timer.handler();
    env.emit('playing', video);
};

test('Venom starts at its best quality, without ads, upload or telemetry sockets', () => {
    const env = venom();
    assert.ok(env.made.quality > 4320, 'above every rung, which Venom reads as the highest one');
    assert.equal(env.made.ads, null);
    assert.equal(env.made.stats, null);
    assert.equal(env.window.RTCPeerConnection, undefined);
    assert.equal(env.window.webkitRTCPeerConnection, undefined);
});

test('Venom steps down once when the connection does not keep up, never from a quality the viewer chose', () => {
    const env = venom();
    env.emit('play', film());
    env.emit('playing', film());
    stall(env);
    assert.deepEqual(env.changes, [], 'one stall changes nothing');
    stall(env);
    assert.deepEqual(env.changes, [720]);
    assert.equal(env.settings.currentQuality, 720);

    const chosen = venom({ storage: { 'venom.quality': '1080' } });
    chosen.emit('playing', film());
    stall(chosen);
    stall(chosen);
    assert.deepEqual(chosen.changes, []);

    const lowest = venom({ current: 480 });
    lowest.emit('playing', film());
    stall(lowest);
    stall(lowest);
    assert.deepEqual(lowest.changes, [], 'nothing below the lowest');
});

test('a seek, a pause and the hover preview are not stalls; a start that hangs is', () => {
    const env = venom();
    const video = film();
    env.emit('play', video);
    const start = env.timers.at(-1);
    start.handler();
    assert.deepEqual(env.changes, [720], 'twelve seconds without a first frame');

    const calm = venom();
    calm.emit('playing', video);
    const before = calm.timers.length;
    calm.emit('waiting', film({ seeking: true }));
    calm.emit('waiting', film({ dataset: { ghost: 'true' } }));
    assert.equal(calm.timers.length, before);
    calm.emit('waiting', video);
    calm.emit('pause', video);
    assert.equal(calm.timers.at(-1).cleared, true);
});

test('Allplay starts at its best quality and keeps its other settings; a menu choice is kept', () => {
    const url = 'https://kinogomy.stravers.live/?token_movie=a';
    const fresh = frame(url, { storage: { allplay: JSON.stringify({ quality: 480, volume: 0.5 }) } });
    assert.deepEqual(JSON.parse(fresh.saved.get('allplay')), { quality: 2160, volume: 0.5 });
    fresh.emit('click', { closest: selector => (selector === '[data-allplay="quality"]' ? {} : null) });
    assert.equal(fresh.saved.get('movieExtension_qualityChosen'), '1');

    const chosen = frame(url, { storage: { allplay: JSON.stringify({ quality: 480 }), movieExtension_qualityChosen: '1' } });
    assert.equal(JSON.parse(chosen.saved.get('allplay')).quality, 480);

    const slow = frame(url);
    slow.window.player = { options: { quality: [1080, 720, 480] }, quality: 1080 };
    slow.emit('playing', film());
    stall(slow);
    stall(slow);
    assert.equal(slow.window.player.quality, 720);
});

test('nothing changes in the same player on an ordinary site', () => {
    const env = frame('https://api.corevia.ws/embed/movie/1', { flag: false });
    assert.equal(typeof env.window.RTCPeerConnection, 'function');
    const library = { make: options => options };
    env.window.VenomPlayer = library;
    assert.equal(env.window.VenomPlayer, library);
});
