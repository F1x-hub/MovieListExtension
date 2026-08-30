import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('🧪 Running player source contract tests...');

const baseParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/BaseParserService.js', import.meta.url),
    'utf8'
);
const parserContext = vm.createContext({ console, window: {} });
vm.runInContext(baseParserSource, parserContext);
const BaseParserService = parserContext.window.BaseParserService;
assert.doesNotMatch(baseParserSource, /mountHlsQualitySelector/,
    'the base parser must not create a duplicate HLS quality control');
assert.match(baseParserSource, /video\._movieExtensionHls = hls/,
    'the base parser exposes its HLS instance to the existing native player menu');
const playerCleanerSource = fs.readFileSync(
    new URL('../content-scripts/player-cleaner.js', import.meta.url),
    'utf8'
);
assert.match(playerCleanerSource, /getNativeHlsQualityOptions/,
    'the existing player settings menu exposes native HLS quality choices');
assert.match(playerCleanerSource, /RUTUBE_QUALITY_LADDER/,
    'Rutube HLS levels use the player-facing quality naming ladder');
assert.match(playerCleanerSource, /hls\.currentLevel = -1/,
    'the Automatic choice restores hls.js adaptive bitrate selection');
assert.match(playerCleanerSource, /typeof opt\.action === 'function'/,
    'native HLS quality entries execute their own action instead of requiring a provider DOM node');
const exFsParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/ExFsParser.js', import.meta.url),
    'utf8'
);
vm.runInContext(exFsParserSource, parserContext);
const ExFsParser = parserContext.window.ExFsParser;

class IframeParser extends BaseParserService {
    constructor() {
        super({ id: 'iframe-parser', name: 'Iframe Parser', baseUrl: 'https://example.test' });
    }
}

class VideoParser extends IframeParser {
    getPlayerType() {
        return 'video';
    }
}

class CachedParser extends IframeParser {
    constructor() {
        super();
        this.searchCalls = 0;
        this.sourceCalls = 0;
    }

    async search() {
        this.searchCalls += 1;
        return { url: 'https://example.test/movie', parserId: this.id };
    }

    async getVideoSources() {
        this.sourceCalls += 1;
        return [{ name: 'Embed', url: 'https://embed.test/movie', type: 'iframe' }];
    }
}

const cachedParser = new CachedParser();
const concurrentSearches = await Promise.all(
    Array.from({ length: 5 }, () => cachedParser.cachedSearch('Movie', 2020))
);
assert.strictEqual(cachedParser.searchCalls, 1, 'concurrent cachedSearch misses must share one request');

await Promise.all(
    concurrentSearches.map(result => cachedParser.cachedVideoSources(result))
);
assert.strictEqual(cachedParser.sourceCalls, 1, 'concurrent source extraction must share one request');

await cachedParser.cachedVideoSources(concurrentSearches[0], { forceRefresh: true });
assert.strictEqual(
    cachedParser.sourceCalls,
    2,
    'forced source refresh must bypass a stale cached embed token'
);

const iframeContainer = { children: [], innerHTML: '', tagName: 'DIV', className: '' };
const mixedSources = [
    { name: 'Direct', url: 'https://cdn.test/movie.mp4', type: 'video' },
    { name: 'Embed', url: 'https://embed.test/movie', type: 'iframe' }
];
new IframeParser().renderPlayer(iframeContainer, mixedSources);
assert.match(iframeContainer.innerHTML, /^<iframe/);
assert.match(iframeContainer.innerHTML, /https:\/\/embed\.test\/movie/);
assert.doesNotMatch(iframeContainer.innerHTML, /movie\.mp4/);

const videoContainer = { children: [], innerHTML: '', tagName: 'DIV', className: '' };
new VideoParser().renderPlayer(videoContainer, mixedSources);
assert.match(videoContainer.innerHTML, /^<video/);
assert.match(videoContainer.innerHTML, /movie\.mp4/);
assert.doesNotMatch(videoContainer.innerHTML, /embed\.test/);
assert.strictEqual(new ExFsParser().getPlayerType(), 'video');

const reversedMixedContainer = { children: [], innerHTML: '', tagName: 'DIV', className: '' };
new VideoParser().renderPlayer(reversedMixedContainer, [...mixedSources].reverse());
assert.match(
    reversedMixedContainer.innerHTML,
    /^<video/,
    'preferred direct-video must win even when an iframe appears first in the source array'
);
assert.match(reversedMixedContainer.innerHTML, /movie\.mp4/);

const iframeOnlyFallbackContainer = { children: [], innerHTML: '', tagName: 'DIV', className: '' };
const iframeOnlySource = [
    { name: 'Ex-FS iframe', url: 'https://exfs.test/iframe-only', type: 'iframe' }
];
const iframeOnlyRendered = new VideoParser().renderPlayer(iframeOnlyFallbackContainer, iframeOnlySource);
assert.strictEqual(
    iframeOnlyRendered,
    true,
    'a parser that prefers video must still render its only valid iframe source'
);
assert.match(iframeOnlyFallbackContainer.innerHTML, /^<iframe/);
assert.match(iframeOnlyFallbackContainer.innerHTML, /https:\/\/exfs\.test\/iframe-only/);
assert.doesNotMatch(iframeOnlyFallbackContainer.innerHTML, /video-placeholder/);

const movieDetailsSource = fs
    .readFileSync(new URL('../src/pages/movie-details/movie-details.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '');
const movieDetailsContext = vm.createContext({
    console,
    document: { addEventListener() {} },
    window: {},
    URLSearchParams,
    setTimeout,
    clearTimeout
});
vm.runInContext(movieDetailsSource, movieDetailsContext);
const MovieDetailsManager = movieDetailsContext.window.MovieDetailsManager;
const manager = Object.create(MovieDetailsManager.prototype);

const parsers = new Map([
    ['first', {
        id: 'first',
        name: 'First',
        getPlayerType: () => 'iframe',
        supportsType: () => true,
        supportsSourceType: source => source.type === 'iframe'
    }],
    ['second', {
        id: 'second',
        name: 'Second',
        getPlayerType: () => 'iframe',
        supportsType: () => true,
        supportsSourceType: source => source.type === 'iframe'
    }],
    ['exfs', {
        id: 'exfs',
        name: 'Ex-FS',
        getPlayerType: () => 'video',
        supportsType: () => true,
        supportsSourceType: source => source.type === 'video'
    }]
]);
manager.parserRegistry = {
    getIds: () => ['first', 'exfs', 'second'],
    get: id => parsers.get(id),
    getAll: () => Array.from(parsers.values())
};

const normalized = manager.normalizeVideoSources([
    { parserId: 'second', name: 'Second source', url: 'https://second.test/embed', type: 'iframe' },
    { parserId: 'exfs', name: 'Ex-FS', url: 'https://exfs.test/movie.mp4', type: 'video' },
    { parserId: 'exfs', name: 'Ex-FS', url: 'https://exfs.test/embed', type: 'iframe' },
    { parserId: 'first', name: 'Primary', url: 'https://shared.test/embed', type: 'iframe' },
    { parserId: 'second', name: 'Duplicate', url: 'https://shared.test/embed', type: 'iframe' }
]);

assert.deepStrictEqual(
    Array.from(normalized, source => source.parserId),
    ['first', 'exfs', 'second'],
    'sources must follow ParserRegistry priority regardless of completion order'
);
assert.deepStrictEqual(
    Array.from(normalized, source => source.url),
    ['https://shared.test/embed', 'https://exfs.test/movie.mp4', 'https://second.test/embed'],
    'duplicate URLs and parser-incompatible source types must be removed'
);
const reorderedInput = manager.normalizeVideoSources([
    { parserId: 'first', name: 'Primary', url: 'https://shared.test/embed', type: 'iframe' },
    { parserId: 'second', name: 'Duplicate', url: 'https://shared.test/embed', type: 'iframe' },
    { parserId: 'second', name: 'Second source', url: 'https://second.test/embed', type: 'iframe' },
    { parserId: 'exfs', name: 'Ex-FS', url: 'https://exfs.test/movie.mp4', type: 'video' }
]);
assert.deepStrictEqual(
    Array.from(reorderedInput, source => source.url),
    Array.from(normalized, source => source.url),
    'the same source set must keep the same order when parser completion order changes'
);
assert.deepStrictEqual(Array.from(manager.normalizeVideoSources(null)), []);
assert.strictEqual(manager.formatSourceLabel(normalized[1], 1), 'Ex-FS');
assert.strictEqual(
    manager.formatSourceLabel({ parserId: 'second', name: 'Mirror' }, 0),
    'Second: Mirror'
);

const parserSelectorIds = manager.getParserSelectorIds('movie');
assert.deepStrictEqual(
    Array.from(parserSelectorIds),
    ['first', 'second', 'exfs'],
    'all registered parsers supporting the movie type must have canonical parser selectors'
);
assert.strictEqual(
    manager.shouldDisplaySourceButton(
        { parserId: 'exfs', url: 'https://exfs.test/movie.mp4', type: 'video' },
        parserSelectorIds
    ),
    false,
    'discovered Ex-FS URLs must not add a duplicate button when parser:exfs selector exists'
);
assert.strictEqual(
    manager.shouldDisplaySourceButton(
        { parserId: 'first', url: 'https://first.test/embed', type: 'iframe' },
        parserSelectorIds
    ),
    false,
    'discovered First parser URLs must not add a duplicate button when parser:first selector exists'
);
assert.strictEqual(
    manager.shouldDisplaySourceButton(
        { parserId: 'custom-unregistered', url: 'https://other.test/embed', type: 'iframe' },
        parserSelectorIds
    ),
    true,
    'sources without a registered canonical parser selector must remain visible'
);

console.log('✅ Player source contract tests passed!');
