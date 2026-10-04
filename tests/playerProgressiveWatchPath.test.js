const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const movieDetailsSource = fs.readFileSync(
    path.join(__dirname, '../src/pages/movie-details/movie-details.js'),
    'utf8'
);
const methodStart = movieDetailsSource.indexOf('    startProgressiveSourceDiscovery(movie, ');
assert.notEqual(methodStart, -1, 'progressive discovery method must exist');
const methodEnd = movieDetailsSource.indexOf('\n    saveSourcesToCache(', methodStart);
assert.notEqual(methodEnd, -1, 'progressive discovery method boundary must remain stable');
const methodSource = movieDetailsSource.slice(methodStart, methodEnd).trim();
const context = {};
vm.createContext(context);
new vm.Script(`class MovieDetailsManager { ${methodSource} }\nthis.startProgressiveSourceDiscovery = MovieDetailsManager.prototype.startProgressiveSourceDiscovery;`)
    .runInContext(context);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    const parsers = [
        {
            id: 'empty-priority',
            name: 'Empty priority',
            searchDelay: 15,
            result: null,
            getPlayerType: () => 'iframe',
            supportsType: () => true,
            cachedVideoSources: async () => []
        },
        {
            id: 'ready-provider',
            name: 'Ready provider',
            searchDelay: 2,
            result: { url: 'https://provider.test/ready' },
            getPlayerType: () => 'iframe',
            supportsType: () => true,
            cachedVideoSources: async () => [{
                parserId: 'ready-provider',
                url: 'https://cdn.test/ready.m3u8',
                quality: '1080p'
            }]
        },
        {
            id: 'slow-provider',
            name: 'Slow provider',
            searchDelay: 80,
            result: { url: 'https://provider.test/slow' },
            getPlayerType: () => 'iframe',
            supportsType: () => true,
            cachedVideoSources: async () => [{
                parserId: 'slow-provider',
                url: 'https://cdn.test/slow.m3u8',
                quality: '720p'
            }]
        }
    ];
    const parserById = new Map(parsers.map(parser => [parser.id, parser]));
    const saved = [];
    let selectorRefreshes = 0;
    const manager = Object.create({
        startProgressiveSourceDiscovery: context.startProgressiveSourceDiscovery
    });
    manager.parserRegistry = {
        getAll: () => parsers,
        async searchAll(_title, _year, options) {
            const successful = [];
            await Promise.all(parsers.map(async (parser) => {
                await delay(parser.searchDelay);
                const result = parser.result ? { ...parser.result, parserId: parser.id } : null;
                if (result) {
                    successful.push(result);
                    options.onResult(result, parser);
                }
                options.onSettled(result, parser);
            }));
            return successful;
        }
    };
    manager.normalizeVideoSources = (sources) => [...sources].sort((a, b) => (
        a.parserId.localeCompare(b.parserId)
    ));
    manager.saveSourcesToCache = (_movieId, sources) => saved.push(sources);
    manager.populateSourceSelector = () => { selectorRefreshes += 1; };
    manager.selectedMovie = { kinopoiskId: 'movie-1' };

    const startedAt = Date.now();
    const discovery = manager.startProgressiveSourceDiscovery({
        name: 'Series',
        year: 2024,
        type: 'tv-series',
        kinopoiskId: 'movie-1'
    });
    const firstSources = await discovery.firstSources;
    const firstElapsed = Date.now() - startedAt;

    assert.deepEqual(firstSources.map(source => source.parserId), ['ready-provider'],
        'first source must come from the first usable provider by registry priority');
    assert.ok(firstElapsed >= 10 && firstElapsed < 70,
        `first usable source should wait for the empty higher-priority provider, not the slow tail (elapsed ${firstElapsed}ms)`);

    const finalSources = await discovery.finalize;
    assert.deepEqual(finalSources.map(source => source.parserId), [
        'empty-priority',
        'ready-provider',
        'slow-provider'
    ].filter(id => parserById.get(id)?.result));
    assert.equal(saved.length, 1, 'final source set must be persisted once');
    assert.equal(selectorRefreshes, 1, 'finalization must refresh the selector once');

    // A hanging higher-priority provider (e.g. an unresponsive mirror) must
    // not hold the watch path past the priority deadline.
    const timedContext = { setTimeout, clearTimeout };
    vm.createContext(timedContext);
    new vm.Script(`class MovieDetailsManager { ${methodSource} }\nthis.startProgressiveSourceDiscovery = MovieDetailsManager.prototype.startProgressiveSourceDiscovery;`)
        .runInContext(timedContext);
    const hangingParsers = [
        { id: 'hanging-priority', searchDelay: 400, result: { url: 'https://provider.test/hang' } },
        { id: 'fast-fallback', searchDelay: 5, result: { url: 'https://provider.test/fast' } }
    ].map(parser => ({
        ...parser,
        name: parser.id,
        getPlayerType: () => 'iframe',
        supportsType: () => true,
        cachedVideoSources: async () => [{ parserId: parser.id, url: `https://cdn.test/${parser.id}.m3u8` }]
    }));
    const deadlineManager = Object.create({
        startProgressiveSourceDiscovery: timedContext.startProgressiveSourceDiscovery
    });
    deadlineManager.parserRegistry = {
        getAll: () => hangingParsers,
        async searchAll(_title, _year, options) {
            await Promise.all(hangingParsers.map(async (parser) => {
                await delay(parser.searchDelay);
                const result = { ...parser.result, parserId: parser.id };
                options.onResult(result, parser);
                options.onSettled(result, parser);
            }));
        }
    };
    deadlineManager.normalizeVideoSources = (sources) => [...sources];
    deadlineManager.saveSourcesToCache = () => {};
    deadlineManager.populateSourceSelector = () => {};
    deadlineManager.selectedMovie = { kinopoiskId: 'movie-2' };

    const deadlineStartedAt = Date.now();
    const deadlineDiscovery = deadlineManager.startProgressiveSourceDiscovery(
        { name: 'Film', year: 2024, type: 'film', kinopoiskId: 'movie-2' },
        { priorityDeadlineMs: 40 }
    );
    const deadlineSources = await deadlineDiscovery.firstSources;
    const deadlineElapsed = Date.now() - deadlineStartedAt;
    assert.deepEqual(deadlineSources.map(source => source.parserId), ['fast-fallback'],
        'after the priority deadline the ready lower-priority provider must be released');
    assert.ok(deadlineElapsed >= 35 && deadlineElapsed < 300,
        `release must happen at the deadline, not after the hanging provider (elapsed ${deadlineElapsed}ms)`);
    await deadlineDiscovery.finalize;

    console.log('✅ progressive watch path tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
