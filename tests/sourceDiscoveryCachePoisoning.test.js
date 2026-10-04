import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

console.log('🧪 Running source discovery cache-poisoning tests...');

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>');

const pageHtml = `
    <script>pl[1] = "/playlist/root";</script>
    <ul class="pgs-trans"><li data-translate="1" class="act">Main</li></ul>
    <ul class="tabs-result"><li><h2><a href="/show/root">1 season <span>(1 seri)</span></a></h2></li></ul>
`;
const encodedVideoUrl = Buffer.from('https://video.example/episode-1.mp4').toString('base64');

let playlistFails = true;
let seasonPageFails = true;
const requests = [];
const context = vm.createContext({
    console: { ...console, log() {}, warn() {}, error() {} },
    URL,
    setTimeout,
    clearTimeout,
    DOMParser: dom.window.DOMParser,
    atob: encoded => Buffer.from(encoded, 'base64').toString('binary'),
    window: {},
    chrome: { storage: { local: { get: (_keys, callback) => callback({}) } } },
    fetch: async url => {
        requests.push(url);
        if (url === 'http://seasonvar.ru/show/root') {
            return { ok: true, text: async () => pageHtml };
        }
        if (url === 'http://seasonvar.ru/show/seasons') {
            if (seasonPageFails) return { ok: false, status: 503 };
            return { ok: true, text: async () => pageHtml };
        }
        if (url === 'http://seasonvar.ru/playlist/root') {
            // A transient provider failure while loading the playlist JSON.
            if (playlistFails) return { ok: false, status: 502 };
            return { ok: true, json: async () => [{ title: '1 серия', file: encodedVideoUrl }] };
        }
        throw new Error(`Unexpected URL: ${url}`);
    }
});
vm.runInContext(read('../src/shared/services/parsers/BaseParserService.js'), context);
vm.runInContext(read('../src/shared/services/parsers/SeasonvarParser.js'), context);
const parser = new context.window.SeasonvarParser();

(async () => {
    // 1. A failed playlist must not be served from cache for the whole TTL.
    const degraded = await parser.getSeriesInfo('http://seasonvar.ru/show/root');
    assert.equal(degraded.episodes.length, 0, 'the transient failure is still reported to the caller');

    playlistFails = false;
    const recovered = await parser.getSeriesInfo('http://seasonvar.ru/show/root');
    assert.equal(recovered.episodes.length, 1, 'the next request must retry and recover the playlist');
    assert.equal(requests.filter(url => url.endsWith('/playlist/root')).length, 2);

    // 2. A good result is cached as before.
    await parser.getSeriesInfo('http://seasonvar.ru/show/root');
    assert.equal(requests.filter(url => url.endsWith('/playlist/root')).length, 2,
        'a non-empty playlist must still be served from cache');

    // 3. A failed seasons page must not cache an empty season list.
    const noSeasons = await parser.getSeasons('http://seasonvar.ru/show/seasons');
    assert.equal(noSeasons.length, 0);
    seasonPageFails = false;
    const seasons = await parser.getSeasons('http://seasonvar.ru/show/seasons');
    assert.equal(seasons.length, 1, 'seasons must be re-discovered after a transient failure');

    // 4. The Watch path mounts immediately: no HEAD preflight before a cached embed.
    const movieDetails = read('../src/pages/movie-details/movie-details.js');
    assert.doesNotMatch(movieDetails, /validateSourceUrl/, 'the HEAD preflight must stay removed');
    assert.doesNotMatch(movieDetails, /method:\s*'HEAD'/);

    console.log('✅ source discovery cache-poisoning tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
