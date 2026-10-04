import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

console.log('🧪 Running player minor audit fix tests...');

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://extension.test/movie-details.html' });

function createStorage() {
    const map = new Map();
    return {
        map,
        get length() { return map.size; },
        key: index => [...map.keys()][index] ?? null,
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: key => map.delete(key)
    };
}

const logs = [];
const storage = createStorage();
const posted = [];
const context = vm.createContext({
    console: { ...console, log: (...args) => logs.push(args), warn() {}, error() {}, info() {} },
    URL,
    URLSearchParams,
    DOMParser: dom.window.DOMParser,
    localStorage: storage,
    window: {
        location: { origin: 'chrome-extension://abc', href: 'chrome-extension://abc/movie-details.html' },
        postMessage: (data, targetOrigin) => posted.push({ data, targetOrigin })
    },
    chrome: undefined,
    fetch: async () => { throw new Error('offline'); }
});
for (const file of ['BaseParserService', 'KinogoParser', 'ExFsParser', 'SeasonvarParser']) {
    vm.runInContext(read(`../src/shared/services/parsers/${file}.js`), context);
}
const { KinogoParser, ExFsParser, SeasonvarParser, BaseParserService } = context.window;

// 1. KinoGo: a page that only has a YouTube trailer offers no film source.
{
    const parser = new KinogoParser();
    const trailerOnly = '<div class="fullstory"><iframe src="https://www.youtube.com/embed/abc123"></iframe></div>';
    assert.equal(parser.extractKinogoDirectSources(trailerOnly).length, 0,
        'a trailer must not be presented as the KinoGo player');
    const withPlayer = `${trailerOnly}<iframe data-src="https://api.ortified.ws/embed/movie/42"></iframe>`;
    assert.equal(parser.extractKinogoDirectSources(withPlayer)[0]?.url, 'https://api.ortified.ws/embed/movie/42');
}

// 2. Ex-FS: Full HD stays first; supported providers from other tabs become fallbacks.
{
    const parser = new ExFsParser();
    const html = `
        <ul class="nav-tabs">
            <li><a href="#t1">Трейлер</a></li>
            <li><a href="#t2">Плеер 2</a></li>
            <li><a href="#t3">Плеер Full HD</a></li>
            <li><a href="#t4">Плеер 4</a></li>
        </ul>
        <div class="tab-content">
            <div class="tab-pane" id="t1"><iframe src="https://api.ortified.ws/embed/trailer/1"></iframe></div>
            <div class="tab-pane" id="t2"><iframe src="https://api.namy.ws/embed/movie/7"></iframe></div>
            <div class="tab-pane" id="t3"><iframe src="https://api.variyt.ws/embed/movie/7"></iframe></div>
            <div class="tab-pane" id="t4"><iframe src="https://unknown-player.example/embed/7"></iframe></div>
        </div>`;
    const urls = parser.parseMoviePage(html).map(player => player.url);
    assert.deepEqual([...urls], [
        'https://api.variyt.ws/embed/movie/7',
        'https://api.namy.ws/embed/movie/7'
    ], 'Full HD first, then supported fallbacks; trailers and unknown players skipped');
}

// 3. Parser tracing is silent unless explicitly enabled.
{
    const parser = new KinogoParser();
    logs.length = 0;
    parser._logSearchTrace('candidate', { title: 'x' });
    parser.debugLog('[DEBUG] hidden');
    assert.equal(logs.length, 0, 'debug output must be opt-in');
    storage.setItem('movieExtension.debugParsers', '1');
    parser.debugLog('[DEBUG] shown');
    parser._logSearchTrace('candidate', { title: 'x' });
    assert.equal(logs.length, 2);
    storage.removeItem('movieExtension.debugParsers');
    assert.equal(BaseParserService.isDebugEnabled(), false);
}

// 4. Seasonvar playback state is posted to this page's origin only.
{
    const parser = new SeasonvarParser();
    parser._postPlaybackState({ type: 'SEASONVAR_PLAYBACK_STATE' });
    assert.equal(posted.at(-1).targetOrigin, 'chrome-extension://abc');
}

// 5. Source cache pruning drops expired/unreadable keys and caps live entries.
{
    const movieDetails = read('../src/pages/movie-details/movie-details.js');
    const start = movieDetails.indexOf('    pruneSourceCache(');
    const end = movieDetails.indexOf('\n    saveSourcesToCache(', start);
    assert.ok(start > 0 && end > start, 'pruneSourceCache must exist before saveSourcesToCache');
    const pruneStorage = createStorage();
    const pruneContext = vm.createContext({ localStorage: pruneStorage, JSON, Date, Number });
    new vm.Script(`class M { ${movieDetails.slice(start, end)} }\nthis.prune = M.prototype.pruneSourceCache;`)
        .runInContext(pruneContext);
    const now = 1_000_000_000;
    pruneStorage.setItem('movie_sources_expired', JSON.stringify({ timestamp: now - 20 * 60 * 1000, ttl: 15 * 60 * 1000 }));
    pruneStorage.setItem('movie_sources_broken', '{not json');
    pruneStorage.setItem('unrelated_key', 'keep');
    for (let index = 0; index < 5; index += 1) {
        pruneStorage.setItem(`movie_sources_live${index}`, JSON.stringify({ timestamp: now - index * 1000, ttl: 15 * 60 * 1000 }));
    }
    pruneContext.prune.call({}, { maxEntries: 3, now });
    assert.deepEqual([...pruneStorage.map.keys()].sort(), [
        'movie_sources_live0', 'movie_sources_live1', 'movie_sources_live2', 'unrelated_key'
    ]);
    assert.match(movieDetails, /this\.pruneSourceCache\(\);\s*localStorage\.setItem\(`movie_sources_\$\{movieId\}`/,
        'saving sources must prune old entries');
}

console.log('✅ player minor audit fix tests passed');
