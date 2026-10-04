const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const bridge = fs.readFileSync(path.join(__dirname, '../content-scripts/provider-preview-bridge.js'), 'utf8');
const guard = fs.readFileSync(path.join(__dirname, '../content-scripts/provider-ad-guard.js'), 'utf8');
function provider(host, embedded = true) {
    const dom = new JSDOM('<body><div id="provider"><video></video></div></body>', {
        url: `https://${host}/embed/movie`, runScripts: 'outside-only'
    });
    const { window } = dom;
    dom.reconfigure({ windowTop: {} });
    Object.defineProperty(window.location, 'ancestorOrigins', {
        value: embedded ? ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] : ['https://ordinary.example']
    });
    window.eval(bridge);
    return dom;
}
for (const host of ['api.namy.ws', 'api.variyt.ws', 'api.nextembed.ws', 'api.lumex.cloud', 'rutube.ru', 'vidsrc-embed.ru']) {
    const dom = provider(host);
    const { window } = dom;
    window.eval(`
        Hls = class {
            loadSource(url) { this.url = url; return 'loaded'; }
            attachMedia(video) { this.media = video; return 'attached'; }
            destroy() { this.destroyed = true; }
        };
        var hls = new Hls();
        var video = document.querySelector('video');
        video.src = 'blob:https://${host}/first';
        hls.loadSource('/signed/playlist?token=fixture');
        hls.attachMedia(video);
    `);
    assert.equal(window.video.dataset.playerPreviewUrl, `https://${host}/signed/playlist?token=fixture`);
    assert.equal(window.video.dataset.playerPreviewType, 'hls', 'extensionless manifest must retain its type');
    window.video.dispatchEvent(new window.Event('loadstart'));
    assert.equal(window.video.dataset.playerPreviewUrl, undefined, 'invalidate on media replacement');
    window.video.dispatchEvent(new window.Event('loadedmetadata'));
    assert.equal(window.video.dataset.playerPreviewMedia, window.video.src);
    window.hls.loadSource('https://media.example/episode2.m3u8');
    assert.equal(window.video.dataset.playerPreviewUrl, 'https://media.example/episode2.m3u8');
    window.hls.destroy();
    assert.equal(window.video.dataset.playerPreviewUrl, undefined);
    assert.ok(window.hls.destroyed, 'preserve the original lifecycle');
    dom.window.close();
}

const dom = provider('api.nextembed.ws');
const { window } = dom;
window.eval(guard);
window.eval(`
    var video = document.querySelector('video');
    video.src = 'blob:https://api.nextembed.ws/first';
    var options = {
        container: document.getElementById('provider'),
        source: { hls: 'wrong-movie.m3u8' },
        playlist: { current: {season: 2, episode: '1'}, seasons: [{season: 2, episodes: [
            {episode: '1', source: {dash: 'first.mpd', hls: '/first.m3u8'}},
            {episode: '2', source: {file: {720: '/second-hd.mp4', 360: '/second.mp4'}}},
            {episode: '3', source: {dash: '/opaque.mpd'}}
        ]}] }
    };
    var player = { listeners: {}, on(event, callback) { this.listeners[event] = callback; } };
    VenomPlayer = Object.freeze({make(opts) { window.received = opts; return player; }});
    var result = VenomPlayer.make(options);
`);
assert.equal(window.result, window.player);
assert.equal(window.received.source, window.options.source, 'do not change provider source/format policy');
assert.equal(window.video.dataset.playerPreviewUrl, 'https://api.nextembed.ws/first.m3u8');
window.player.listeners.playlistItem({season: 2, episode: '2'});
assert.equal(window.video.dataset.playerPreviewUrl, undefined, 'discard the previous episode immediately');
window.video.src = 'blob:https://api.nextembed.ws/second';
window.video.dispatchEvent(new window.Event('loadedmetadata'));
assert.equal(window.video.dataset.playerPreviewUrl, 'https://api.nextembed.ws/second.mp4');
assert.equal(window.video.dataset.playerPreviewType, 'video');
let providerRenewed = 0;
window.player.onRenew = () => { providerRenewed++; };
const renewed = { listeners: {}, on(event, callback) { this.listeners[event] = callback; } };
window.player.onRenew(renewed);
assert.equal(providerRenewed, 1);
renewed.listeners.playlistItem({season: 2, episode: '3'});
window.video.dispatchEvent(new window.Event('loadedmetadata'));
assert.equal(window.video.dataset.playerPreviewUrl, undefined, 'DASH-only must not show another episode');
dom.window.close();

const ordinary = provider('vidsrc-embed.ru', false);
assert.equal(ordinary.window.MovieExtensionPreviewBridge, undefined, 'leave ordinary website embeds alone');
ordinary.window.close();

const manifest = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../manifest.json')));
for (const pattern of ['*://*.namy.ws/*', '*://*.nextembed.ws/*', 'https://rutube.ru/play/embed/*', 'https://vidsrc-embed.ru/*']) {
    assert.ok(manifest.content_scripts.some(script => script.matches.includes(pattern)
        && script.world === 'MAIN' && script.run_at === 'document_start'
        && script.js.includes('content-scripts/provider-preview-bridge.js')));
    assert.ok(manifest.content_scripts.some(script => script.matches.includes(pattern)
        && script.js.includes('content-scripts/player-cleaner.js')));
}
console.log('PASS: provider HLS source ownership, extensionless manifests, episode/renewal isolation, factory preservation and manifest coverage');
