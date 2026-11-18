const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const movieDetailsPath = path.join(__dirname, '../src/pages/movie-details/movie-details.js');
const source = fs.readFileSync(movieDetailsPath, 'utf8');

function loadMovieDetailsManager({ elements = {}, globals = {}, quiet = false } = {}) {
    const listeners = new Map();
    const pagePosts = [];
    const window = {
        location: {
            href: 'chrome-extension://test-id/src/pages/movie-details/movie-details.html',
            origin: 'chrome-extension://test-id'
        },
        addEventListener(type, listener) {
            listeners.set(type, listener);
        },
        postMessage(message, targetOrigin) {
            pagePosts.push({ message, targetOrigin });
        }
    };
    const document = {
        addEventListener() {},
        getElementById(id) {
            return elements[id] || null;
        }
    };
    const silent = { ...console, info() {}, log() {}, warn() {} };
    const context = {
        window,
        document,
        console: quiet ? silent : console,
        URL,
        Map,
        Set,
        Date,
        Promise,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        AbortSignal,
        ...globals
    };
    context.globalThis = context;

    const executableSource = source.replace(/^import .*;\r?\n/gm, '');
    vm.createContext(context);
    new vm.Script(executableSource, { filename: movieDetailsPath }).runInContext(context);

    return {
        MovieDetailsManager: window.MovieDetailsManager,
        getMessageListener: () => listeners.get('message'),
        pagePosts,
        window
    };
}

/** A stand-in element with what updatePlayerNavigationControls touches. */
function fakeElement() {
    const attributes = {};
    return {
        style: {}, disabled: false, title: '', attributes,
        setAttribute(name, value) { attributes[name] = String(value); },
        classList: { add() {}, remove() {} }
    };
}

function createBridgeHarness() {
    const { MovieDetailsManager, getMessageListener, window } = loadMovieDetailsManager();
    const activeFrameWindow = {};
    const iframe = {
        contentWindow: activeFrameWindow,
        src: 'chrome-extension://test-id/content-scripts/player-cleaner.html',
        dataset: { playerRequestId: '7' }
    };
    const manager = Object.create(MovieDetailsManager.prototype);
    const calls = [];

    manager.elements = {
        videoContainer: {
            querySelector(selector) {
                return selector.startsWith('iframe') ? iframe : null;
            }
        }
    };
    manager.sourceSwitchRequestId = 7;
    manager.messageListenerSetup = false;
    manager.playerEpisodeNavigationPending = false;
    manager.updatePlayerNavigationControls = () => {};
    manager.handlePlayerNavigate = async direction => {
        calls.push(direction);
        return true;
    };
    manager.setupPlayerMessageListener();

    return {
        activeFrameWindow,
        calls,
        iframe,
        listener: getMessageListener(),
        manager,
        origin: window.location.origin
    };
}

function playerNavigateEvent(direction, source, origin) {
    return {
        data: {
            type: 'PLAYER_EPISODE_NAVIGATE',
            direction
        },
        source,
        origin
    };
}

(async () => {
    assert.match(
        source,
        /action === 'player-prev-episode'\) \{\s+void this\.requestPlayerEpisodeNavigation\('previous'\);/,
        'Host previous control must use the shared navigation gate'
    );
    assert.match(
        source,
        /action === 'player-next-episode'\) \{\s+void this\.requestPlayerEpisodeNavigation\('next'\);/,
        'Host next control must use the shared navigation gate'
    );

    {
        const { activeFrameWindow, calls, listener, origin } = createBridgeHarness();
        assert.strictEqual(typeof listener, 'function', 'MovieDetails must register the player message listener');

        await listener(playerNavigateEvent('previous', activeFrameWindow, origin));
        await listener(playerNavigateEvent('next', activeFrameWindow, origin));

        assert.deepStrictEqual(
            calls,
            ['previous', 'next'],
            'Trusted active-frame messages must route both directions exactly once'
        );
    }

    {
        const { activeFrameWindow, calls, iframe, listener, origin } = createBridgeHarness();
        await listener(playerNavigateEvent('sideways', activeFrameWindow, origin));
        await listener(playerNavigateEvent('next', {}, origin));

        iframe.dataset.playerRequestId = '8';
        await listener(playerNavigateEvent('previous', activeFrameWindow, origin));

        assert.deepStrictEqual(
            calls,
            [],
            'Invalid directions, foreign sources, and stale frames must be ignored'
        );
    }

    {
        const { activeFrameWindow, calls, listener, manager, origin } = createBridgeHarness();
        let releaseNavigation;
        manager.handlePlayerNavigate = direction => new Promise(resolve => {
            calls.push(direction);
            releaseNavigation = resolve;
        });

        const firstRequest = listener(playerNavigateEvent('next', activeFrameWindow, origin));
        await Promise.resolve();
        const duplicateRequest = listener(playerNavigateEvent('next', activeFrameWindow, origin));
        await Promise.resolve();

        assert.deepStrictEqual(calls, ['next'], 'A second click while navigation is pending must be ignored');

        releaseNavigation(true);
        await Promise.all([firstRequest, duplicateRequest]);
        assert.strictEqual(manager.playerEpisodeNavigationPending, false, 'Navigation gate must reopen after completion');
    }

    // The player's own arrows get the header arrows' state.
    {
        const { MovieDetailsManager, pagePosts } = loadMovieDetailsManager({ quiet: true });
        const manager = Object.create(MovieDetailsManager.prototype);
        const frames = [{ id: 'a' }, { id: 'b' }];
        const framePosts = [];
        manager.elements = { videoContainer: { querySelectorAll: selector => (selector === 'iframe' ? frames : []) } };
        manager.postToPlayerFrame = (frame, message) => { framePosts.push([frame.id, { ...message }]); return true; };
        manager.publishPlayerEpisodeNavigation({ enabled: true, hasPrevious: false, hasNext: true });
        const expected = { type: 'PLAYER_EPISODE_NAVIGATION_STATE', enabled: true, hasPrevious: false, hasNext: true };
        assert.deepStrictEqual(framePosts, [['a', expected], ['b', expected]], 'every provider frame gets the state');
        assert.deepStrictEqual(pagePosts.map(post => [{ ...post.message }, post.targetOrigin]), [[expected, 'chrome-extension://test-id']],
            'and so does the page itself, where parser videos play');
        manager.publishPlayerEpisodeNavigation({ enabled: true, hasPrevious: false, hasNext: true });
        assert.strictEqual(framePosts.length, 2, 'an unchanged state is not resent');
        manager.publishPlayerEpisodeNavigation(undefined, { force: true });
        assert.strictEqual(framePosts.length, 4, 'a request resends the last state');
        manager.publishPlayerEpisodeNavigation({ enabled: false, hasPrevious: true, hasNext: true });
        assert.deepStrictEqual(framePosts.at(-1)[1], { type: 'PLAYER_EPISODE_NAVIGATION_STATE', enabled: false, hasPrevious: false, hasNext: false },
            'disabled navigation carries no usable arrow');
    }

    {
        const harness = createBridgeHarness();
        const posts = [];
        harness.manager.postToPlayerFrame = (frame, message) => { posts.push({ ...message }); return true; };
        harness.manager.elements.videoContainer.querySelectorAll = () => [harness.iframe];
        let recomputed = 0;
        harness.manager.updatePlayerNavigationControls = () => { recomputed++; };
        const ask = source => harness.listener({ data: { type: 'PLAYER_EPISODE_NAVIGATION_REQUEST' }, source, origin: harness.origin });
        await ask(harness.activeFrameWindow);
        assert.strictEqual(recomputed, 1, 'without a state yet the host works it out');
        harness.manager.publishPlayerEpisodeNavigation({ enabled: true, hasPrevious: true, hasNext: false });
        posts.length = 0;
        await ask(harness.activeFrameWindow);
        assert.deepStrictEqual(posts, [{ type: 'PLAYER_EPISODE_NAVIGATION_STATE', enabled: true, hasPrevious: true, hasNext: false }],
            'a frame that loads after the last change gets the current state');
        assert.strictEqual(recomputed, 2,
            'and the canonical picker mode again: it is sent for 3 s only, and a slow source mounts later');
        await ask({});
        assert.strictEqual(posts.length, 1, 'only the active frame may ask');
        assert.strictEqual(recomputed, 2);
    }

    {
        const ids = ['playerNavControls', 'playerPrevEpisodeBtn', 'playerNextEpisodeBtn', 'playerEpisodesListBtn'];
        const elements = Object.fromEntries(ids.map(id => [id, fakeElement()]));
        const { MovieDetailsManager } = loadMovieDetailsManager({ elements, quiet: true });
        const manager = Object.create(MovieDetailsManager.prototype);
        const published = [];
        manager.publishPlayerEpisodeNavigation = state => published.push({ ...state });
        manager.elements = { videoContainer: { querySelector: () => null, querySelectorAll: () => [] } };
        const adapter = { id: 'seasonvar', supportsPrevNext: () => true, supportsEpisodePicker: () => true, canHandle: () => true, getSelectionMode: () => 'DIRECT' };
        let selection = null;
        manager.playbackController = { getSelection: () => selection, getActiveProvider: () => 'seasonvar', getAdapter: () => adapter };
        manager.resolveAdjacentEpisode = (movie, current, direction) => (direction === 'next' ? { seasonNumber: 1, episodeNumber: 2 } : null);
        manager.isEpisodePlayableByDate = () => true;

        manager.selectedMovie = { kinopoiskId: 1, type: 'movie' };
        manager.updatePlayerNavigationControls();
        assert.deepStrictEqual(published.at(-1), { enabled: false }, 'a film has no episode arrows');

        manager.selectedMovie = { kinopoiskId: 2, isSeries: true };
        selection = { seasonNumber: 1, episodeNumber: 1 };
        manager.updatePlayerNavigationControls();
        assert.deepStrictEqual(published.at(-1), { enabled: true, hasPrevious: false, hasNext: true },
            'on S1E1 the player\'s «back» is disabled like the header one');
        assert.strictEqual(elements.playerPrevEpisodeBtn.disabled, true);

        manager.broadcastLock = {};
        manager.updatePlayerNavigationControls();
        assert.deepStrictEqual(published.at(-1), { enabled: false }, 'a broadcast owns the episode');
    }

    // A frame whose site cannot be reached is not called ready.
    {
        const lifecycleStates = [];
        const outcomes = [];
        const makeManager = fetchImpl => {
            const { MovieDetailsManager, window } = loadMovieDetailsManager({ quiet: true, globals: { fetch: fetchImpl } });
            window.PlayerSourceLifecycle = { setState: (container, state, options) => lifecycleStates.push({ state, message: options.message }) };
            const manager = Object.create(MovieDetailsManager.prototype);
            const frame = { dataset: { playerRequestId: '5' } };
            manager.elements = { videoContainer: { querySelector: selector => (selector.startsWith('iframe') ? frame : null) } };
            return { manager, frame };
        };
        const options = { requestId: 5, isRequestCurrent: () => true, onLifecycleState: (state, detail) => outcomes.push([state, detail.reason]) };
        const url = 'https://vidsrc-embed.ru/embed/movie?imdb=tt0816692&autoplay=1';

        let requested = null;
        const blocked = makeManager(async (target, init) => {
            requested = { target, mode: init.mode, credentials: init.credentials };
            throw new TypeError('Failed to fetch');
        });
        assert.strictEqual(await blocked.manager.verifyFrameSiteReachable(url, options), false);
        assert.deepStrictEqual(requested, { target: 'https://vidsrc-embed.ru/', mode: 'no-cors', credentials: 'omit' });
        assert.deepStrictEqual(outcomes, [['unavailable', 'provider-unreachable']], 'the player moves on as from any unavailable source');
        assert.match(lifecycleStates.at(-1).message, /не открывается/);

        const slow = makeManager(async () => { throw new DOMException('timed out', 'TimeoutError'); });
        assert.strictEqual(await slow.manager.verifyFrameSiteReachable(url, options), true, 'a slow site is left to its frame');
        const fine = makeManager(async () => ({ type: 'opaque' }));
        assert.strictEqual(await fine.manager.verifyFrameSiteReachable(url, options), true);
        const stale = makeManager(async () => { throw new TypeError('Failed to fetch'); });
        assert.strictEqual(await stale.manager.verifyFrameSiteReachable(url, { ...options, isRequestCurrent: () => false }), true,
            'an abandoned source changes nothing');
        const replaced = makeManager(async () => { throw new TypeError('Failed to fetch'); });
        replaced.frame.dataset.playerRequestId = '6';
        assert.strictEqual(await replaced.manager.verifyFrameSiteReachable(url, options), true, 'nor does a frame of a newer request');
        assert.strictEqual(outcomes.length, 1);
    }

    // A title-only source is not told to pick an episode it has no list for.
    {
        const guidance = { style: {}, text: '', querySelector: () => null };
        Object.defineProperty(guidance, 'textContent', { get() { return this.text; }, set(value) { this.text = value; } });
        const { MovieDetailsManager } = loadMovieDetailsManager({ elements: { playerSourceGuidance: guidance }, quiet: true });
        const manager = Object.create(MovieDetailsManager.prototype);
        const adapters = {
            rutube: { label: 'Rutube', supportsProviderInternalSelection: () => true, supportsEpisodePicker: () => false, getSelectionMode: () => 'OPAQUE' },
            listed: { label: 'Listed', supportsProviderInternalSelection: () => true, supportsEpisodePicker: () => true, getSelectionMode: () => 'OPAQUE' }
        };
        manager.playbackController = { getSelection: () => ({ seasonNumber: 1, episodeNumber: 2 }), getActiveProvider: () => 'rutube', getAdapter: id => adapters[id] };
        manager.updateSourceGuidance('parser:rutube');
        assert.strictEqual(guidance.style.display, 'flex');
        assert.strictEqual(guidance.text, 'Rutube ищет видео по названию и не выбирает серию: это может быть не S1E2.');
        manager.updateSourceGuidance('parser:listed');
        assert.strictEqual(guidance.text, 'Выберите S1E2 в плеере источника', 'a provider with its own list can be steered by hand');
    }

    console.log('✅ playerEpisodeNavigationBridge tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
