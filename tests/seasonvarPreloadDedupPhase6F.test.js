import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

console.log('🧪 Running Seasonvar Phase 6F Preload Deduplication Tests...\n');

const baseParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/BaseParserService.js', import.meta.url),
    'utf8'
);
const seasonvarParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/SeasonvarParser.js', import.meta.url),
    'utf8'
);
const dom = new JSDOM('<!doctype html><html><body></body></html>');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const pageHtml = `
    <script>pl[1] = "/playlist/root";</script>
    <ul class="pgs-trans"><li data-translate="1" class="act">Main</li></ul>
    <ul class="tabs-result"><li><h2><a href="/show/root">1 season <span>(2 seri)</span></a></h2></li></ul>
`;
const encodedVideoUrl = Buffer.from('https://video.example/episode-1.m3u8').toString('base64');
const requests = [];

const parserContext = vm.createContext({
    console,
    URL,
    setTimeout,
    clearTimeout,
    DOMParser: dom.window.DOMParser,
    atob: encoded => Buffer.from(encoded, 'base64').toString('binary'),
    window: { PlayerSourceLifecycle: { setState: () => {} } },
    chrome: { storage: { local: { get: (_keys, callback) => callback({}) } } },
    fetch: async url => {
        requests.push(url);
        await delay(20);
        if (url === 'http://seasonvar.ru/show/root') {
            return { ok: true, text: async () => pageHtml };
        }
        if (url === 'http://seasonvar.ru/playlist/root') {
            return {
                ok: true,
                json: async () => [{ title: '1 серия', file: encodedVideoUrl }]
            };
        }
        throw new Error(`Unexpected URL: ${url}`);
    }
});

vm.runInContext(baseParserSource, parserContext);
vm.runInContext(seasonvarParserSource, parserContext);
const SeasonvarParser = parserContext.window.SeasonvarParser;
assert(SeasonvarParser, 'SeasonvarParser must be available on window');

const parser = new SeasonvarParser();
const rootUrl = 'http://seasonvar.ru/show/root';

// The public preload entry points overlap. They must share the same page and playlist work.
const [sources, info, seasons] = await Promise.all([
    parser.getVideoSources(rootUrl),
    parser.getSeriesInfo(rootUrl, 'parallelInfo'),
    parser.getSeasons(rootUrl, 'parallelSeasons')
]);
assert.equal(sources.length, 1, 'getVideoSources must retain its public source shape');
assert.equal(info.episodes.length, 1, 'getSeriesInfo must retain episode data');
assert.equal(seasons[0].episodes_count, 2, 'getSeasons must retain parsed season metadata');
assert.equal(
    requests.filter(url => url === rootUrl).length,
    1,
    'parallel public calls must make exactly one physical series-page request'
);
assert.equal(
    requests.filter(url => url === 'http://seasonvar.ru/playlist/root').length,
    1,
    'parallel public calls must make exactly one physical playlist request'
);

await Promise.all([
    parser.getVideoSources(rootUrl),
    parser.getSeriesInfo(rootUrl),
    parser.getSeasons(rootUrl)
]);
assert.equal(requests.length, 2, 'a warmed page must not re-fetch page or playlist data');

// Concurrent first access must deduplicate, and a failed request must not poison the in-flight map.
let retryAttempts = 0;
parserContext.fetch = async url => {
    if (url !== 'http://seasonvar.ru/show/retry') throw new Error(`Unexpected URL: ${url}`);
    retryAttempts += 1;
    await delay(10);
    if (retryAttempts === 1) throw new Error('temporary provider failure');
    return { ok: true, text: async () => '<html></html>' };
};
await assert.rejects(
    Promise.all([
        parser.getSeasonvarPage('http://seasonvar.ru/show/retry'),
        parser.getSeasonvarPage('http://seasonvar.ru/show/retry')
    ]),
    /temporary provider failure/
);
assert.equal(retryAttempts, 1, 'a failing shared request must still deduplicate while pending');
await parser.getSeasonvarPage('http://seasonvar.ru/show/retry');
assert.equal(retryAttempts, 2, 'a failed request must be retryable after its in-flight entry clears');

// Parsed-page discovery data is bounded rather than retained for the lifetime of the tab.
parser.maxDiscoveryCacheEntries = 2;
parserContext.fetch = async url => ({ ok: true, text: async () => `<html data-url="${url}"></html>` });
await parser.getSeasonvarPage('http://seasonvar.ru/show/bounded-a');
await parser.getSeasonvarPage('http://seasonvar.ru/show/bounded-b');
await parser.getSeasonvarPage('http://seasonvar.ru/show/bounded-c');
assert.equal(parser.pageCache.size, 2, 'parsed-page cache must enforce its maximum entry count');

// Base cachedSearch remains the canonical shared search path used by both preload stages.
let searchCalls = 0;
parser.search = async () => {
    searchCalls += 1;
    await delay(10);
    return { url: rootUrl, title: 'Root' };
};
await Promise.all([
    parser.cachedSearch('Root', 2026),
    parser.cachedSearch('Root', 2026)
]);
await parser.cachedSearch('Root', 2026);
assert.equal(searchCalls, 1, 'canonical cachedSearch must deduplicate concurrent and warm searches');

console.log('✅ Seasonvar Phase 6F preload deduplication tests passed');
