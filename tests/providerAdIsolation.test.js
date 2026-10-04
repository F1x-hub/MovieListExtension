import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const guardPath = new URL('../content-scripts/provider-ad-guard.js', import.meta.url);
const guard = fs.existsSync(guardPath) ? fs.readFileSync(guardPath, 'utf8') : '';

function createProvider(ancestors, href = 'https://api.variyt.ws/embed/kp/472329', referrer = '') {
    const context = vm.createContext({
        location: { href, ancestorOrigins: ancestors },
        document: { referrer },
        URL,
        history: {
            replaceState(_state, _title, nextUrl) {
                context.location.href = nextUrl;
            }
        },
        console
    });
    vm.runInContext('window = this; self = {}; top = {};', context);
    vm.runInContext(guard, context);
    // The live Ex-FS and KinoGo Venom pages assign this global before make(opts).
    vm.runInContext(`
        var adsConfig = { pre: { urls: ['https://ads.example/pre'] }, middle: { offset: 429 } };
        var source = { hls: 'https://media.example/movie.m3u8', audio: { names: ['Original'] } };
        var opts = { source, ads: adsConfig, sections: [], time: 811 };
    `, context);
    return context;
}

const embedded = createProvider(['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
assert.equal(new URL(embedded.location.href).searchParams.get('santabarbaranoads'), '1',
    'embedded provider must receive player-venom no-ad mode before initialization');
assert.equal(embedded.opts.ads, null, 'embedded provider must not pass its ad config to the player');
assert.equal(embedded.opts.time, 811, 'do not rewrite the content timeline');
assert.equal(embedded.opts.source, embedded.source, 'preserve source and audio selection identity');
const ordinaryProvider = createProvider(['https://ex-fs.net']);
assert.equal(ordinaryProvider.location.href, 'https://api.variyt.ws/embed/kp/472329',
    'leave ordinary provider website embeds alone');
assert.ok(ordinaryProvider.adsConfig.pre, 'ordinary website embeds must retain their ad config');
assert.equal(createProvider([]).location.href, 'https://api.variyt.ws/embed/kp/472329',
    'leave standalone provider tabs alone');
assert.equal(createProvider(['chrome-extension://invalid.example']).location.href,
    'https://api.variyt.ws/embed/kp/472329',
    'require an extension origin rather than a matching prefix');
assert.equal(new URL(createProvider([
    'https://api.variyt.ws', 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
]).location.href).searchParams.get('santabarbaranoads'), '1',
    'support nested provider frames');
const queryOnly = createProvider([], 'https://api.variyt.ws/embed/kp/472329?santabarbaranoads=1');
assert.equal(queryOnly.adsConfig, null,
    'the explicit no-ad flag must activate the guard when referrer data is hidden');
vm.runInContext(`
    var originalLibrary = Object.freeze({ make(options) { return options; }, version: 'fixture' });
    VenomPlayer = originalLibrary;
    function makePlayer(options) { return VenomPlayer.make(options); }
    var guardedPlayerOptions = makePlayer({ ads: { pre: { urls: ['https://ads.example/pre'] } } });
`, queryOnly);
assert.equal(queryOnly.guardedPlayerOptions.ads, null,
    'the actual factory must receive a null ad config even through a page function declaration');
vm.runInContext(`
    var dashOnly = { dash: 'movie.mpd', audio: { names: ['Original'] } };
    var both = { ...dashOnly, dasha: 'av1.mpd', hls: 'movie.m3u8', cc: [{ name: 'English' }] };
    var options = { source: both, time: 810, playlist: { current: { season: 6, episode: '23' },
        seasons: [{ season: 6, episodes: [{ ...both, episode: '23' }, { source: both, episode: '24' }, dashOnly] }] } };
    var prepared = VenomPlayer.make(options);
`, queryOnly);
assert.equal(queryOnly.prepared.source.hls, 'movie.m3u8');
assert.equal(queryOnly.prepared.source.dash, 'movie.mpd');
assert.equal(queryOnly.prepared.source.dasha, 'av1.mpd');
assert.equal(queryOnly.prepared.source, queryOnly.both, 'preserve the provider format policy');
assert.equal(queryOnly.both.dash, 'movie.mpd', 'do not mutate provider source data');
assert.equal(queryOnly.prepared.source.audio, queryOnly.both.audio);
assert.equal(queryOnly.prepared.source.cc, queryOnly.both.cc);
assert.equal(queryOnly.prepared.time, 810, 'ad isolation must not skip content');
assert.equal(queryOnly.prepared.playlist.current, queryOnly.options.playlist.current);
const episodes = queryOnly.prepared.playlist.seasons[0].episodes;
assert.equal(episodes[0].dash, 'movie.mpd', 'preserve next episode sources');
assert.equal(episodes[1].source, queryOnly.both, 'preserve nested episode sources');
assert.equal(episodes[2], queryOnly.dashOnly, 'preserve DASH when no HLS alternative exists');
assert.equal(queryOnly.VenomPlayer.version, 'fixture', 'preserve other library exports');
vm.runInContext('VenomPlayer = originalLibrary; var renewed = VenomPlayer.make(options);', queryOnly);
assert.equal(queryOnly.renewed.ads, null, 'library reassignment must retain ad isolation');
vm.runInContext('VenomPlayer = { make(options) { return options; } }; var untouched = VenomPlayer.make({source:{dash:"x",hls:"y"},ads:{pre:true}});', ordinaryProvider);
assert.equal(ordinaryProvider.untouched.source.dash, 'x');
assert.equal(ordinaryProvider.untouched.ads.pre, true);
assert.equal(new URL(createProvider([], 'https://api.variyt.ws/embed/kp/472329',
    'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/pages/movie-details.html'
).location.href).searchParams.get('santabarbaranoads'), '1',
    'support extension referrers when ancestorOrigins is unavailable');

const cleaner = fs.readFileSync(new URL('../content-scripts/player-cleaner.js', import.meta.url), 'utf8');
const dom = new JSDOM('<body></body>', { url: 'https://api.variyt.ws/embed/kp/1134493' });
const { window } = dom;
Object.defineProperty(window.document, 'readyState', { value: 'loading' });
Object.defineProperty(window.location, 'ancestorOrigins', {
    value: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']
});
let onMutation;
vm.runInContext(cleaner, vm.createContext({
    window, document: window.document, console,
    chrome: { runtime: { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', getURL: value => value } },
    localStorage: window.localStorage,
    MutationObserver: class {
        constructor(callback) { onMutation = callback; }
        observe() {} disconnect() {}
    },
    setTimeout: () => 1, clearTimeout, setInterval: () => 1, clearInterval
}));
const { findContentVideo } = window.MovieExtension_PlayerCleaner._test;
assert.equal(typeof findContentVideo, 'function');
window.document.body.innerHTML = `
    <div id="player"><div class="player_1JR">
        <div class="panel_6i_ impression_yXv"><video id="ad" src="https://ads.example/ad.mp4"></video></div>
        <div class="video_9Xh"><video id="movie" src="blob:https://api.variyt.ws/movie"></video></div>
    </div></div>`;
assert.equal(findContentVideo().id, 'movie', 'ad appearing first must not become the movie');
window.document.getElementById('movie').remove();
assert.equal(findContentVideo(), null, 'wait for the content video instead of adopting an ad');
window.document.body.innerHTML = `
    <video class="ghost-video" src="https://media.example/preview.mp4"></video>
    <video data-ghost="true" src="https://media.example/preview2.mp4"></video>
    <video id="native" src="https://media.example/movie.mp4"></video>`;
assert.equal(findContentVideo().id, 'native', 'native non-Venom sources remain supported');
window.document.body.innerHTML = '<div class="native-player-wrapper"><video id="current"></video></div>';
assert.equal(findContentVideo(), null, 'do not re-adopt the current wrapper video');

window.document.body.innerHTML = `
    <div id="player"><div class="player_1JR"><div class="video_9Xh"></div>
        <div class="panel_6i_ impression_yXv"></div></div></div>
    <div class="native-player-wrapper"><video id="current" src="blob:https://api.variyt.ws/current"></video></div>`;
const current = window.document.getElementById('current');
current.pause = () => {};
current.load = () => {};
current.volume = 0.4;
const controls = window.MovieExtension_PlayerCleaner._test;
controls.setPermanentVideo(current);
controls.observePlayerContainer();
const adPanel = window.document.querySelector('.panel_6i_');
const advert = window.document.createElement('video');
advert.src = 'https://ads.example/advert.mp4';
adPanel.append(advert);
onMutation([{ type: 'childList', target: adPanel, addedNodes: [advert] }]);
assert.equal(window.document.querySelector('.native-player-wrapper video'), current,
    'observer must preserve the playing movie when a video ad appears');
assert.equal(current.getAttribute('src'), 'blob:https://api.variyt.ws/current');

const next = window.document.createElement('video');
const mediaOwner = {};
next._movieExtensionHls = mediaOwner;
next.src = 'https://media.example/next.mp4';
const content = window.document.querySelector('.video_9Xh');
content.append(next);
onMutation([{ type: 'childList', target: content, addedNodes: [next] }]);
assert.equal(window.document.querySelector('.native-player-wrapper video'), next,
    'a real source change must adopt the original video, including blob-to-MP4 changes');
assert.equal(next._movieExtensionHls, mediaOwner, 'keep media ownership on the original element');
assert.equal(next.volume, 0.4, 'preserve local playback preferences on adoption');
assert.equal(current.isConnected, false);

// Delayed src assignment must use the same adoption path rather than URL copying.
next.pause = () => {};
next.load = () => {};
const delayed = window.document.createElement('video');
content.append(delayed);
onMutation([{ type: 'childList', target: content, addedNodes: [delayed] }]);
assert.equal(window.document.querySelector('.native-player-wrapper video'), next);
delayed.src = 'blob:https://api.variyt.ws/next';
onMutation([{ type: 'attributes', target: delayed, attributeName: 'src' }]);
assert.equal(window.document.querySelector('.native-player-wrapper video'), delayed);
dom.window.close();

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const entry = manifest.content_scripts.find(item => item.js.includes('content-scripts/provider-ad-guard.js'));
assert.equal(entry?.world, 'MAIN', 'isolated-world globals cannot disable provider ads');
assert.equal(entry?.run_at, 'document_start', 'disable ads before the provider initializes');
assert.equal(entry?.all_frames, true);
for (const host of [
    'variyt.ws',
    'nextembed.ws',
    'ortified.ws',
    'namy.ws',
    'lumex.cloud',
    'cinemar.cc',
    'stravers.live',
    'allarknow.online'
]) {
    assert.ok(entry.matches.includes(`*://*.${host}/*`), `cover ${host}`);
    const cleanerEntry = manifest.content_scripts.find(item => item.js.includes('content-scripts/player-cleaner.js'));
    assert.ok(cleanerEntry.matches.includes(`*://*.${host}/*`), `mount custom controls on ${host}`);
}
console.log('Provider advertising and content-video isolation checks passed.');
