import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('🧪 Running movie player registry state tests...');

const source = fs
    .readFileSync(new URL('../src/pages/movie-details/movie-details.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '');

const createdContainers = [];
class BaseParserService {
    renderPlayer() {}
}

const documentStub = {
    body: {
        appendChild(element) {
            element.parentNode = this;
            createdContainers.push(element);
        }
    },
    createElement() {
        return {
            id: '',
            style: {},
            parentNode: null,
            removed: false,
            querySelector: () => null,
            querySelectorAll: () => [],
            remove() {
                this.removed = true;
                this.parentNode = null;
            }
        };
    },
    addEventListener() {}
};

const context = vm.createContext({
    BaseParserService,
    console,
    document: documentStub,
    performance,
    window: {},
    URLSearchParams,
    setTimeout,
    clearTimeout
});

vm.runInContext(source, context);
const MovieDetailsManager = context.window.MovieDetailsManager;
const manager = Object.create(MovieDetailsManager.prototype);

manager.playerRegistry = {};
manager.activePlayerId = null;
manager.unavailableProviderIds = new Set();
manager.parserRegistry = {
    getAll: () => [
        { id: 'iframe-parser' },
        { id: 'custom-parser' }
    ]
};
manager.unmountActivePlayer = () => {};

manager.initPlayerRegistry(101);
assert.deepStrictEqual(
    Object.keys(manager.playerRegistry),
    ['iframe-parser', 'custom-parser'],
    'all parser entries should be initialized'
);
assert.ok(
    Object.values(manager.playerRegistry).every(entry => entry.movieId === '101'),
    'registry entries should normalize and retain their movieId owner'
);

manager.playerRegistry['custom-parser'].initialized = true;
let mounted = null;
manager.mountPlayer = (parserId, movieId) => {
    mounted = { parserId, movieId };
    return true;
};

assert.strictEqual(await manager.reuseCachedPlayer('101'), true, 'owned player should be reusable');
assert.deepStrictEqual(mounted, { parserId: 'custom-parser', movieId: '101' });
assert.strictEqual(await manager.reuseCachedPlayer('202'), false, 'player from another movie must not be reused');

const oldContainers = Object.values(manager.playerRegistry).map(entry => entry.container);
manager.initPlayerRegistry('202');
assert.ok(oldContainers.every(container => container.removed), 'old movie containers should be disposed');
assert.ok(
    Object.values(manager.playerRegistry).every(entry => entry.movieId === '202' && !entry.initialized),
    'new movie should receive fresh, uninitialized entries'
);
assert.strictEqual('playerCache' in manager, false, 'legacy playerCache state should not exist');

let hiddenDefaultSearches = 0;
const defaultParser = {
    id: 'iframe-parser',
    supportsType: () => true,
    getPlayerType: () => 'iframe',
    renderPlayer: BaseParserService.prototype.renderPlayer,
    cachedSearch: async () => {
        hiddenDefaultSearches += 1;
        return null;
    }
};
manager.selectedMovie = { kinopoiskId: 202, name: 'Movie', type: 'movie' };
manager.parserRegistry = {
    getAll: () => [defaultParser]
};
await manager.preloadAllPlayers('202');
assert.strictEqual(
    hiddenDefaultSearches,
    0,
    'default iframe/video parsers must not create duplicate hidden network players'
);

let parserSearches = 0;
let sourceFetches = 0;
let renderedSources = null;
BaseParserService.prototype.renderPlayer = (_container, sources) => {
    renderedSources = sources;
    return true;
};
const exfsParser = {
    id: 'exfs',
    name: 'Ex-FS',
    getPlayerType: () => 'video',
    getSourcePlayerType: source => source.type || 'iframe',
    renderPlayer: BaseParserService.prototype.renderPlayer,
    cachedSearch: async () => {
        parserSearches += 1;
        return { url: 'https://ex-fs.test/movie' };
    },
    getVideoSources: async () => {
        sourceFetches += 1;
        return [];
    },
    cachedVideoSources: async () => {
        sourceFetches += 1;
        return [{
            name: 'Ex-FS refreshed',
            parserId: 'exfs',
            type: 'iframe',
            url: 'https://api.variyt.ws/embed/kp/487409?refresh=1'
        }];
    }
};

manager.selectedMovie = { kinopoiskId: 202, name: 'Movie', type: 'movie' };
manager.currentSources = [{
    name: 'Ex-FS',
    parserId: 'exfs',
    type: 'iframe',
    url: 'https://api.variyt.ws/embed/kp/487409'
}];
manager.currentEpisodes = [];
manager.playerRegistry.exfs = {
    movieId: '202',
    container: documentStub.createElement(),
    initialized: false
};
manager.parserRegistry = {
    get: id => id === 'exfs' ? exfsParser : null,
    getIds: () => ['exfs']
};
manager.elements = {
    videoContainer: {
        innerHTML: '',
        querySelector: () => null
    }
};
manager.setPlayerSourceState = () => {};
manager.createSourceLifecycleOptions = () => ({});

assert.strictEqual(await manager.loadParserSource('exfs'), true);
assert.strictEqual(parserSearches, 0, 'discovered Ex-FS sources must bypass a repeated search');
assert.strictEqual(sourceFetches, 0, 'discovered Ex-FS sources must bypass a repeated movie-page fetch');
assert.strictEqual(renderedSources[0].url, 'https://api.variyt.ws/embed/kp/487409');

assert.strictEqual(await manager.loadParserSource('exfs', null, { forceRefresh: true }), true);
assert.strictEqual(parserSearches, 1, 'forced re-search must bypass the discovered source list');
assert.strictEqual(sourceFetches, 1, 'forced re-search must fetch a fresh parser source');
assert.match(renderedSources[0].url, /refresh=1/);

console.log('✅ Movie player registry state tests passed!');
