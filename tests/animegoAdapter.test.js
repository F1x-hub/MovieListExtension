const assert = require('node:assert/strict');
const fs = require('node:fs');
const { AnimeGoAdapter } = require('../src/shared/services/player/adapters/AnimeGoAdapter');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');

console.log('🧪 Running AnimeGoAdapter tests...');

(async () => {
    // 1. Capabilities: exact episodes, host picker and prev/next.
    const adapter = new AnimeGoAdapter();
    assert.equal(adapter.id, 'animego');
    assert.equal(adapter.getSelectionMode(), 'DIRECT');
    assert.equal(adapter.supportsDirectSeasonEpisode(), true);
    assert.equal(adapter.supportsEpisodePicker(), true);
    assert.equal(adapter.supportsPrevNext(), true);
    assert.equal(adapter.supportsInPlaceSelection(), true);
    assert.equal(adapter.supportsAutoNext(), true, 'the native player reports reliable progress and ended');
    const seriesSelection = { kinopoiskId: 1, mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 3 };
    assert.equal(adapter.canHandle(seriesSelection), true);
    assert.equal(adapter.canHandle({ kinopoiskId: 1, mediaType: 'movie' }), true);
    assert.equal(adapter.canApplySelection(seriesSelection), true);

    // 2. The controller registers it, so MovieDetails enables the episode controls.
    const controller = new PlaybackController({});
    const registered = controller.getAdapter('animego');
    assert.ok(registered instanceof AnimeGoAdapter);
    const capabilities = controller.getProviderCapabilities('animego');
    assert.equal(capabilities.selectionMode, 'DIRECT');
    assert.equal(capabilities.supportsDirectSeasonEpisode, true);

    // 3. applySelection delegates the in-place swap to the parser.
    const calls = [];
    const container = { querySelector: () => null, innerHTML: 'x' };
    const parser = {
        applyEpisodeSelection: async (target, selection) => {
            calls.push({ target, selection });
            return selection.episodeNumber !== 99;
        }
    };
    const bound = new AnimeGoAdapter(parser);
    assert.equal(await bound.applySelection(seriesSelection), false, 'no mounted container yet');
    bound.activeContainer = container;
    assert.equal(await bound.applySelection(seriesSelection), true);
    assert.equal(calls[0].target, container);
    assert.equal(calls[0].selection.episodeNumber, 3);
    assert.equal(await bound.applySelection({ ...seriesSelection, episodeNumber: 99 }), false);
    assert.equal(await bound.applySelection({ ...seriesSelection, episodeNumber: null }), false);
    const throwing = new AnimeGoAdapter({ applyEpisodeSelection: async () => { throw new Error('boom'); } });
    throwing.activeContainer = container;
    assert.equal(await throwing.applySelection(seriesSelection), false, 'failures fall back to a remount');

    // Through the controller an applied swap reports APPLIED.
    controller.registerAdapter(bound);
    controller.setActiveProvider('animego');
    const result = await controller.applySelection(seriesSelection);
    assert.equal(result.status, 'APPLIED');

    // 4. mount(): search, discover and render through the parser.
    const rendered = [];
    const mountParser = {
        cachedSearch: async (title, year, options) => ({ url: 'https://animego.me/anime/x-1', title, year, options }),
        cachedVideoSources: async () => [{ type: 'animego-episode', episodeNumber: 1 }],
        renderPlayer: async (target, sources, options) => {
            rendered.push({ sources, options });
            return true;
        }
    };
    const mounting = new AnimeGoAdapter(mountParser);
    const mountContainer = { querySelector: selector => (selector === 'video' ? { tagName: 'VIDEO' } : null), innerHTML: '' };
    const mounted = await mounting.mount(mountContainer, { ...seriesSelection, title: 'Магическая битва', year: 2020 });
    assert.equal(mounted.type, 'video');
    assert.equal(rendered[0].options.episode, 3);
    await assert.rejects(new AnimeGoAdapter({ cachedSearch: async () => null }).mount(mountContainer, { title: 'x' }),
        error => error.code === 'PROVIDER_LOAD_FAILED');

    // 5. Host and player wiring.
    const html = fs.readFileSync('src/pages/movie-details/movie-details.html', 'utf8');
    assert.ok(html.indexOf('adapters/AnimeGoAdapter.js') > html.indexOf('adapters/BasePlaybackAdapter.js')
        && html.indexOf('adapters/AnimeGoAdapter.js') < html.indexOf('player/PlaybackController.js'),
    'the adapter loads before the controller registers default adapters');

    const movieDetails = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');
    assert.match(movieDetails, /else if \(adapter\?\.supportsInPlaceSelection\?\.\(\) === true[\s\S]{0,700}nativeSelectionApplied = applyResult\.status === 'APPLIED';/,
        'a manually mounted AnimeGo player applies episode changes in place before remounting');

    const cleaner = fs.readFileSync('content-scripts/player-cleaner.js', 'utf8');
    assert.match(cleaner, /permanentVideo\?\.dataset\?\.canonicalEpisodeNav === 'true'\s*&& isExtensionPageContext\(\)/);
    assert.equal((cleaner.match(/if \(usesHostEpisodeNavigation\(\)\) \{\s*postToHost\(\{\s*type: 'PLAYER_EPISODE_NAVIGATE'/g) || []).length, 2,
        'both player arrows ask the host to navigate');
    assert.match(cleaner, /if \(canonicalPickerRequested \|\| isHostEpisodeNavigation\(\)\) \{\s*prevEpisodeBtn\.style\.display = 'flex';/);

    console.log('✅ AnimeGoAdapter tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
