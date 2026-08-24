import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('🧪 Running player switch transaction tests...');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const movieDetailsSource = fs
    .readFileSync(new URL('../src/pages/movie-details/movie-details.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '');

const movieDetailsContext = vm.createContext({
    console,
    document: { addEventListener() {} },
    window: {},
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout
});

vm.runInContext(movieDetailsSource, movieDetailsContext);
const MovieDetailsManager = movieDetailsContext.window.MovieDetailsManager;
const manager = Object.create(MovieDetailsManager.prototype);
const renderedSources = [];

manager.selectedMovie = { kinopoiskId: 101 };
manager.sourceSwitchRequestId = 0;
manager.currentVideoUrl = null;
manager.isPlaying = false;
manager.activePlayerId = null;
manager.playerRegistry = {};
manager.elements = {
    videoContainer: {
        innerHTML: '',
        querySelector: () => null,
        querySelectorAll: () => []
    }
};
manager.updateActiveSourceButton = () => true;
manager.unmountActivePlayer = () => {};
manager.renderDefaultPlayer = url => renderedSources.push(url);
manager.saveLastSource = async (_movieId, url) => {
    const latency = { first: 40, second: 30, third: 20, fourth: 10, fifth: 1 }[url];
    await delay(latency);
};

const sourceRequests = ['first', 'second', 'third', 'fourth', 'fifth']
    .map(url => manager.changeVideoSource(url));
const sourceResults = await Promise.all(sourceRequests);

assert.deepStrictEqual(renderedSources, ['fifth'], 'only the last selected source may render');
assert.deepStrictEqual(sourceResults, [false, false, false, false, true]);
assert.strictEqual(manager.currentVideoUrl, 'fifth');

const mountedParserMarkup = '<iframe src="https://api.variyt.ws/embed/kp/487409"></iframe>';
manager.currentVideoUrl = '';
manager.isPlaying = false;
manager.elements.videoContainer.innerHTML = mountedParserMarkup;

assert.strictEqual(
    manager.togglePlayPause('parser:exfs'),
    false,
    'a parser-managed player must not be re-rendered by the legacy play/pause path'
);
assert.strictEqual(
    manager.elements.videoContainer.innerHTML,
    mountedParserMarkup,
    'the mounted Ex-FS iframe must remain intact after parser source activation'
);
assert.strictEqual(manager.isPlaying, false, 'skipping parser re-render must not corrupt legacy play state');

assert.strictEqual(
    manager.togglePlayPause(),
    false,
    'an empty direct URL must not create a relative iframe back to movie-details.html'
);
assert.ok(
    !manager.elements.videoContainer.innerHTML.includes('?autoplay=1'),
    'empty playback state must never mount movie-details.html?autoplay=1 inside the player'
);

manager.currentVideoUrl = 'https://embed.test/movie';
assert.notStrictEqual(
    manager.togglePlayPause(manager.currentVideoUrl),
    false,
    'a valid direct iframe source must retain the legacy playback path'
);
assert.strictEqual(manager.isPlaying, true, 'a valid direct source must enter the playing state');
assert.ok(
    manager.elements.videoContainer.innerHTML.includes('https://embed.test/movie?autoplay=1'),
    'a valid direct iframe source must still receive the autoplay parameter'
);

class BaseParserService {
    constructor(options) {
        Object.assign(this, options);
    }
}

const seasonvarSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/SeasonvarParser.js', import.meta.url),
    'utf8'
);
const seasonvarContext = vm.createContext({
    BaseParserService,
    chrome: {
        storage: {
            local: {
                get(_keys, callback) {
                    setTimeout(() => callback({
                        watching_progress_101: {
                            episode: 'Episode 2',
                            timestamp: 120
                        }
                    }), 20);
                }
            }
        }
    },
    console,
    document: { querySelectorAll: () => [], dispatchEvent() {} },
    CustomEvent: class CustomEvent {},
    window: {},
    setTimeout,
    clearTimeout
});

vm.runInContext(seasonvarSource, seasonvarContext);
const SeasonvarParser = seasonvarContext.window.SeasonvarParser;
const parser = new SeasonvarParser();
const appliedSelections = [];

const completeSelection = async (value, latency) => {
    const requestId = parser.beginSelectionRequest();
    await delay(latency);
    if (parser.isSelectionRequestCurrent(requestId)) {
        appliedSelections.push(value);
    }
};

await Promise.all([
    completeSelection('season-1', 40),
    completeSelection('season-2', 30),
    completeSelection('translation-1', 20),
    completeSelection('translation-2', 10),
    completeSelection('translation-3', 1)
]);

assert.deepStrictEqual(
    appliedSelections,
    ['translation-3'],
    'only the latest Seasonvar selection may commit its async response'
);

const video = {
    src: 'episode-1.mp4',
    currentTime: 0,
    pause() {},
    removeAttribute() {},
    load() {},
    addEventListener() {}
};
const progressRequestId = parser.beginSelectionRequest();
const staleProgress = parser.handleProgressRestoration(
    video,
    101,
    [
        { name: 'Episode 1', url: 'episode-1.mp4' },
        { name: 'Episode 2', url: 'episode-2.mp4' }
    ],
    null,
    { selectionRequestId: progressRequestId }
);

parser.beginSelectionRequest();
await staleProgress;
assert.strictEqual(video.src, 'episode-1.mp4', 'stale progress restoration must not replace a newer selection');
assert.strictEqual(video.currentTime, 0, 'stale progress restoration must not seek a newer selection');

console.log('✅ Player switch transaction tests passed!');
