const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const movieDetailsSource = fs.readFileSync(
    path.join(__dirname, '../src/pages/movie-details/movie-details.js'),
    'utf8'
);
const methodStart = movieDetailsSource.indexOf('    startProgressiveSourceDiscovery(movie) {');
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
    console.log('✅ progressive watch path tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
