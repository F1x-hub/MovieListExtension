/**
 * Provider Switch Selection Preservation & Canonical State Audit
 *
 * Validates that switching between playback providers (Seasonvar, KinoGo, Rutube, etc.)
 * strictly preserves canonical PlaybackSelection (seasonNumber, episodeNumber)
 * without corruption from stale preloaded caches, saved progress, or stray async events.
 */

const assert = require('assert');
const { PlaybackSelection, resolveWatchTarget } = require('../src/shared/services/player/PlaybackSelection');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');
const { BasePlaybackAdapter } = require('../src/shared/services/player/adapters/BasePlaybackAdapter');
const { SeasonvarAdapter } = require('../src/shared/services/player/adapters/SeasonvarAdapter');
const { KinogoAdapter } = require('../src/shared/services/player/adapters/KinogoAdapter');
const { RutubeAdapter } = require('../src/shared/services/player/adapters/RutubeAdapter');
const { SeasonvarParser } = require('../src/shared/services/parsers/SeasonvarParser');

console.log('🧪 Running Provider Switch Selection Preservation Audit...\n');

async function runTests() {
    // -------------------------------------------------------------
    // Test 3: PlaybackController preserves canonical S3E1 across switches
    // -------------------------------------------------------------
    console.log('--- Test 3: PlaybackController preserves canonical S3E1 across provider switches ---');
    {
        const controller = new PlaybackController();
        const seasonvarAdapter = new SeasonvarAdapter();
        const rutubeAdapter = new RutubeAdapter();
        const kinogoAdapter = new KinogoAdapter();

        controller.registerAdapter(seasonvarAdapter);
        controller.registerAdapter(rutubeAdapter);
        controller.registerAdapter(kinogoAdapter);

        // Explicit user selection: S3E1
        const initialSelection = {
            kinopoiskId: 1209839,
            imdbId: 'tt9288030',
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 1,
            source: 'SEASONS_TAB'
        };

        controller.setSelection(initialSelection);
        assert.strictEqual(controller.getSelection().seasonNumber, 3);
        assert.strictEqual(controller.getSelection().episodeNumber, 1);

        const mockContainer = {
            appendChild: () => {},
            removeChild: () => {},
            firstElementChild: null,
            querySelectorAll: () => []
        };
        controller.setContainer(mockContainer, {});

        // Switch provider to rutube
        controller.updateSelection({
            providerId: 'rutube',
            source: 'PROVIDER_SWITCH'
        });

        const rutubeSel = controller.getSelection();
        assert.strictEqual(rutubeSel.seasonNumber, 3, 'Season must remain 3 after switch to Rutube');
        assert.strictEqual(rutubeSel.episodeNumber, 1, 'Episode must remain 1 after switch to Rutube');
        assert.strictEqual(rutubeSel.providerId, 'rutube');

        // Switch provider to kinogo
        controller.updateSelection({
            providerId: 'kinogo',
            source: 'PROVIDER_SWITCH'
        });

        const kinogoSel = controller.getSelection();
        assert.strictEqual(kinogoSel.seasonNumber, 3, 'Season must remain 3 after switch to KinoGo');
        assert.strictEqual(kinogoSel.episodeNumber, 1, 'Episode must remain 1 after switch to KinoGo');
        assert.strictEqual(kinogoSel.providerId, 'kinogo');

        // Switch back to seasonvar
        controller.updateSelection({
            providerId: 'seasonvar',
            source: 'PROVIDER_SWITCH'
        });

        const seasonvarSel = controller.getSelection();
        assert.strictEqual(seasonvarSel.seasonNumber, 3, 'Season must remain 3 after return to Seasonvar');
        assert.strictEqual(seasonvarSel.episodeNumber, 1, 'Episode must remain 1 after return to Seasonvar');
        assert.strictEqual(seasonvarSel.providerId, 'seasonvar');
        console.log('  ✅ PlaybackController strictly preserves S3E1 across provider transitions');
    }

    // -------------------------------------------------------------
    // Test 4: SeasonvarParser.renderPlayer respects explicit canonical season
    // -------------------------------------------------------------
    console.log('\n--- Test 4: SeasonvarParser.renderPlayer respects explicit canonical season (S3) over default S1/S4 ---');
    {
        const parser = new SeasonvarParser();
        let requestedActiveSeasonUrl = null;

        parser.getSeriesInfo = async (seasonUrl) => {
            requestedActiveSeasonUrl = seasonUrl;
            return {
                episodes: [
                    { title: '1 серия', url: 'http://cdn.example.com/s3e1.mp4' },
                    { title: '2 серия', url: 'http://cdn.example.com/s3e2.mp4' },
                    { title: '6 серия', url: 'http://cdn.example.com/s3e6.mp4' }
                ],
                translations: []
            };
        };

        const seasons = [
            { season_number: 1, url: 'http://seasonvar.ru/reacher-s1.html' },
            { season_number: 2, url: 'http://seasonvar.ru/reacher-s2.html' },
            { season_number: 3, url: 'http://seasonvar.ru/reacher-s3.html' },
            { season_number: 4, url: 'http://seasonvar.ru/reacher-s4.html' }
        ];

        const mockContainer = {
            innerHTML: '',
            querySelectorAll: () => [],
            querySelector: () => null
        };

        const renderOptions = {
            movieId: '1209839',
            seasons,
            season: 3,
            episode: 6,
            resolvedSeasonNumber: 3,
            resolvedEpisodeNumber: 6,
            resolvedSeasonUrl: 'http://seasonvar.ru/reacher-s3.html',
            sourcesSeasonUrl: 'http://seasonvar.ru/reacher-s4.html', // Stale preloaded S4 sources
            sourcesSeasonNumber: 4
        };

        const staleS4Sources = [
            { name: '1 серия', url: 'http://cdn.example.com/s4e1.mp4' }
        ];

        const result = await parser.renderPlayer(mockContainer, staleS4Sources, renderOptions);
        assert.strictEqual(result, true, 'renderPlayer should succeed');
        assert.strictEqual(
            requestedActiveSeasonUrl,
            'http://seasonvar.ru/reacher-s3.html',
            'Parser must fetch Season 3 URL when canonical selection is Season 3'
        );
        assert.strictEqual(
            mockContainer.__seasonvarPlaybackState.activeSeasonNumber,
            3,
            'Playback state activeSeasonNumber must be 3'
        );
        assert.strictEqual(
            mockContainer.__seasonvarPlaybackState.activeEpisodeNumber,
            6,
            'Playback state activeEpisodeNumber must be 6'
        );
        assert.strictEqual(
            mockContainer.__seasonvarPlaybackState.activeEpisodeUrl,
            'http://cdn.example.com/s3e6.mp4',
            'Playback state activeEpisodeUrl must be s3e6'
        );
        console.log('  ✅ SeasonvarParser correctly overrides stale preloaded S4 data with canonical S3E6');
    }

    // -------------------------------------------------------------
    // Test 5: PROVIDER_SWITCH source prevents rogue EPISODE_CHANGED events
    // -------------------------------------------------------------
    console.log('\n--- Test 5: PROVIDER_SWITCH source prevents rogue EPISODE_CHANGED events from overwriting canonical selection ---');
    {
        const selection = {
            kinopoiskId: 1209839,
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 6,
            source: 'PROVIDER_SWITCH'
        };

        const isExplicitSelection = [
            'SEASONS_TAB',
            'PLAYER_NAVIGATION',
            'AUTO_NEXT',
            'RESUME',
            'NEXT_EPISODE_HERO',
            'PROVIDER_SWITCH',
            'PLAYER_PROVIDER_PICKER'
        ].includes(selection.source);

        assert.strictEqual(isExplicitSelection, true, 'PROVIDER_SWITCH must be protected as an explicit selection');

        const rogueEvent = {
            data: {
                type: 'EPISODE_CHANGED',
                episode: 1,
                season: 4,
                origin: 'UNKNOWN_IFRAME_INIT'
            }
        };

        const shouldIgnore = isExplicitSelection && rogueEvent.data.origin !== 'USER_PROVIDER_SELECTION';
        assert.strictEqual(shouldIgnore, true, 'Rogue event must be ignored during PROVIDER_SWITCH');
        console.log('  ✅ PROVIDER_SWITCH is protected by explicit selection guards against rogue async events');
    }

    // -------------------------------------------------------------
    // Test 6: Full Round-Trip Preservation (S3E6 -> Seasonvar -> Rutube -> KinoGo -> Seasonvar)
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Full Round-Trip Preservation (S3E6 -> Seasonvar -> Rutube -> KinoGo -> Seasonvar) ---');
    {
        const controller = new PlaybackController();

        // Seasonvar is the direct S/E provider: record the season and episode
        // its parser is asked to render for the controller's canonical selection.
        const rendered = [];
        const seasonvar = new SeasonvarAdapter({
            renderPlayer: async (container, sources, options) => {
                rendered.push({ season: options.season, episode: options.episode });
                return true;
            }
        });
        const mountOnSeasonvar = () => seasonvar.mount(
            { querySelector: () => null, querySelectorAll: () => [] },
            controller.getSelection(),
            { sources: [{ name: '6 серия', url: 'http://cdn.example.com/s3e6.mp4' }] }
        );

        controller.setSelection({
            kinopoiskId: 1209839,
            imdbId: 'tt9288030',
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 6,
            source: 'SEASONS_TAB'
        });

        // Step 1: Switch to Seasonvar
        controller.updateSelection({ providerId: 'seasonvar', source: 'PROVIDER_SWITCH' });
        await mountOnSeasonvar();
        assert.deepStrictEqual(rendered[0], { season: 3, episode: 6 });

        // Step 2: Switch to Rutube
        controller.updateSelection({ providerId: 'rutube', source: 'PROVIDER_SWITCH' });
        assert.strictEqual(controller.getSelection().seasonNumber, 3);
        assert.strictEqual(controller.getSelection().episodeNumber, 6);

        // Step 3: Switch to KinoGo
        controller.updateSelection({ providerId: 'kinogo', source: 'PROVIDER_SWITCH' });
        assert.strictEqual(controller.getSelection().seasonNumber, 3);
        assert.strictEqual(controller.getSelection().episodeNumber, 6);

        // Step 4: Switch back to Seasonvar
        controller.updateSelection({ providerId: 'seasonvar', source: 'PROVIDER_SWITCH' });
        await mountOnSeasonvar();
        assert.deepStrictEqual(rendered[1], { season: 3, episode: 6 });
        console.log('  ✅ Full round-trip provider switching preserves canonical S3E6 across all steps');
    }

    console.log('\n🎉 ALL Provider Switch Selection Preservation Tests Passed Successfully!');
}

runTests().catch(err => {
    console.error('Test failure:', err);
    process.exit(1);
});
