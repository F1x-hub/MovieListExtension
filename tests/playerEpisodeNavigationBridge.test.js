const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const movieDetailsPath = path.join(__dirname, '../src/pages/movie-details/movie-details.js');
const source = fs.readFileSync(movieDetailsPath, 'utf8');

function loadMovieDetailsManager() {
    const listeners = new Map();
    const window = {
        location: {
            href: 'chrome-extension://test-id/src/pages/movie-details/movie-details.html',
            origin: 'chrome-extension://test-id'
        },
        addEventListener(type, listener) {
            listeners.set(type, listener);
        }
    };
    const document = {
        addEventListener() {},
        getElementById() {
            return null;
        }
    };
    const context = {
        window,
        document,
        console,
        URL,
        Map,
        Set,
        Date,
        Promise,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval
    };
    context.globalThis = context;

    const executableSource = source.replace(/^import .*;\r?\n/gm, '');
    vm.createContext(context);
    new vm.Script(executableSource, { filename: movieDetailsPath }).runInContext(context);

    return {
        MovieDetailsManager: window.MovieDetailsManager,
        getMessageListener: () => listeners.get('message'),
        window
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

    console.log('✅ playerEpisodeNavigationBridge tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
