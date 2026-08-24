const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const {
    normalizePlaybackSelection,
    resolveWatchTarget,
    resolveAdjacentEpisode,
    isSeriesMedia
} = require('../src/shared/services/player/PlaybackSelection');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');

const baseParserSource = fs.readFileSync(
    path.join(__dirname, '../src/shared/services/parsers/BaseParserService.js'),
    'utf8'
);
const seasonvarParserSource = fs.readFileSync(
    path.join(__dirname, '../src/shared/services/parsers/SeasonvarParser.js'),
    'utf8'
);

async function runTests() {
    console.log('🧪 Running Generic Watch Seasonvar Selection Gap Tests...\n');

    // ─── TEST GROUP 1: Series Detection & Taxonomy Normalization ───────────
    console.log('--- Test Group 1: Series Detection & Taxonomy Normalization ---');

    {
        // 1.1 Jack Reacher DTO forms
        assert.strictEqual(isSeriesMedia({ isSeries: true }), true, 'isSeries: true is recognized');
        assert.strictEqual(isSeriesMedia({ type: 'tv-series' }), true, 'type: tv-series is recognized');
        assert.strictEqual(isSeriesMedia({ type: 'TV_SERIES' }), true, 'type: TV_SERIES (uppercase) is recognized');
        assert.strictEqual(isSeriesMedia({ type: 'series' }), true, 'type: series is recognized');
        assert.strictEqual(isSeriesMedia({ type: 'MINI_SERIES' }), true, 'type: MINI_SERIES is recognized');
        assert.strictEqual(isSeriesMedia({ mediaType: 'tv' }), true, 'mediaType: tv is recognized');
        assert.strictEqual(isSeriesMedia({ seasons: [{ season_number: 1 }] }), true, 'seasons array is recognized');
        assert.strictEqual(isSeriesMedia({ seasonsInfo: [{ number: 1 }] }), true, 'seasonsInfo array is recognized');

        // 1.2 Movies stay strictly non-series
        assert.strictEqual(isSeriesMedia({ type: 'film', isSeries: false }), false, 'Film is not series');
        assert.strictEqual(isSeriesMedia({ type: 'movie', isSeries: false }), false, 'Movie is not series');
        assert.strictEqual(isSeriesMedia({ type: 'FILM' }), false, 'FILM is not series');
        assert.strictEqual(isSeriesMedia({ mediaType: 'movie' }), false, 'mediaType: movie is not series');

        console.log('✅ Group 1 Passed: Comprehensive series taxonomy normalization');
    }

    // ─── TEST GROUP 2: resolveWatchTarget Matrix ───────────────────────────
    console.log('\n--- Test Group 2: resolveWatchTarget Matrix ---');

    {
        const jackReacherMovie = {
            kinopoiskId: 1209839,
            nameRu: 'Джек Ричер',
            type: 'TV_SERIES',
            isSeries: true,
            seasons: [
                { season_number: 1, episode_count: 8 },
                { season_number: 2, episode_count: 8 },
                { season_number: 3, episode_count: 8 },
                { season_number: 4, episode_count: 8 }
            ]
        };

        // 2.1 Jack Reacher no progress -> S1E1
        const noProgTarget = resolveWatchTarget(jackReacherMovie, null);
        assert.deepStrictEqual(noProgTarget, {
            seasonNumber: 1,
            episodeNumber: 1,
            initialTimestamp: 0,
            reason: 'NEW_SERIES'
        }, 'Jack Reacher with no progress must resolve to S1E1');

        // 2.2 Jack Reacher with saved incomplete progress (S3E3 @ 600s) -> S3E3 @ 600
        const inProgTarget = resolveWatchTarget(jackReacherMovie, {
            season: 3,
            episode: 3,
            timestamp: 600,
            completed: false
        });
        assert.deepStrictEqual(inProgTarget, {
            seasonNumber: 3,
            episodeNumber: 3,
            initialTimestamp: 600,
            reason: 'RESUME_IN_PROGRESS'
        }, 'Saved incomplete progress must resume exact S3E3 @ 600s');

        // 2.3 Jack Reacher with completed S3E3 -> S3E4 @ 0
        const completedTarget = resolveWatchTarget(jackReacherMovie, {
            season: 3,
            episode: 3,
            timestamp: 2700,
            completed: true
        }, { resolveAdjacentEpisode });
        assert.deepStrictEqual(completedTarget, {
            seasonNumber: 3,
            episodeNumber: 4,
            initialTimestamp: 0,
            reason: 'NEXT_AFTER_COMPLETED'
        }, 'Completed S3E3 must advance to S3E4 @ 0s');

        // 2.4 Cross-season: completed final S3E8 -> S4E1
        const crossSeasonTarget = resolveWatchTarget(jackReacherMovie, {
            season: 3,
            episode: 8,
            timestamp: 2800,
            completed: true
        }, { resolveAdjacentEpisode });
        assert.deepStrictEqual(crossSeasonTarget, {
            seasonNumber: 4,
            episodeNumber: 1,
            initialTimestamp: 0,
            reason: 'NEXT_AFTER_COMPLETED'
        }, 'Completed S3E8 must advance cross-season to S4E1');

        // 2.5 Movie with no progress -> null/null
        const movieItem = { kinopoiskId: 301, nameRu: 'Матрица', type: 'film', isSeries: false };
        const movieTarget = resolveWatchTarget(movieItem, null);
        assert.deepStrictEqual(movieTarget, {
            seasonNumber: null,
            episodeNumber: null,
            initialTimestamp: 0,
            reason: 'NEW_SERIES'
        }, 'Movie must resolve seasonNumber: null, episodeNumber: null');

        // 2.6 Mini-series (Chernobyl) no progress -> S1E1
        const chernobyl = { kinopoiskId: 1227803, nameRu: 'Чернобыль', type: 'MINI_SERIES', isSeries: true };
        const chernobylTarget = resolveWatchTarget(chernobyl, null);
        assert.strictEqual(chernobylTarget.seasonNumber, 1);
        assert.strictEqual(chernobylTarget.episodeNumber, 1);

        // 2.7 Anime series (Frieren) no progress -> S1E1
        const frieren = { kinopoiskId: 5064506, nameRu: 'Фрирен', type: 'anime', isSeries: true };
        const frierenTarget = resolveWatchTarget(frieren, null);
        assert.strictEqual(frierenTarget.seasonNumber, 1);
        assert.strictEqual(frierenTarget.episodeNumber, 1);

        console.log('✅ Group 2 Passed: resolveWatchTarget handles new, in-progress, completed, cross-season, movie, mini-series, and anime');
    }

    // ─── TEST GROUP 3: PlaybackSelection Plumbing & Controller State ───────
    console.log('\n--- Test Group 3: PlaybackSelection Plumbing & Controller State ---');

    {
        const jackReacherMovie = {
            kinopoiskId: 1209839,
            nameRu: 'Джек Ричер',
            type: 'TV_SERIES',
            isSeries: true
        };

        const target = resolveWatchTarget(jackReacherMovie, null);

        const selectionPayload = {
            kinopoiskId: jackReacherMovie.kinopoiskId,
            title: jackReacherMovie.nameRu,
            mediaType: 'tv-series',
            seasonNumber: target.seasonNumber,
            episodeNumber: target.episodeNumber,
            source: 'HERO_WATCH',
            initialTimestamp: target.initialTimestamp
        };

        const normalized = normalizePlaybackSelection(selectionPayload);
        assert.strictEqual(normalized.seasonNumber, 1, 'Normalized selection has seasonNumber: 1');
        assert.strictEqual(normalized.episodeNumber, 1, 'Normalized selection has episodeNumber: 1');
        assert.strictEqual(normalized.mediaType, 'tv-series', 'Normalized selection has mediaType: tv-series');
        assert.strictEqual(normalized.source, 'HERO_WATCH', 'Normalized selection source is HERO_WATCH');

        const controller = new PlaybackController();
        controller.setSelection(selectionPayload);

        const activeSel = controller.getSelection();
        assert.strictEqual(activeSel.seasonNumber, 1, 'PlaybackController holds seasonNumber 1');
        assert.strictEqual(activeSel.episodeNumber, 1, 'PlaybackController holds episodeNumber 1');

        console.log('✅ Group 3 Passed: PlaybackSelection passes to PlaybackController with exact S1E1');
    }

    // ─── TEST GROUP 4: Seasonvar Mount With Generic Watch Selection ────────
    console.log('\n--- Test Group 4: Seasonvar Mount With Generic Watch Selection ---');

    {
        const dom = new JSDOM('<!DOCTYPE html><html><body><div id="playerContainer"></div></body></html>');
        let posted = [];
        dom.window.postMessage = (d) => posted.push(d);

        const pCtx = vm.createContext({
            console,
            window: dom.window,
            document: dom.window.document,
            fetch: null,
            chrome: { storage: { local: { get: (k, cb) => cb({}) } } },
            DOMParser: dom.window.DOMParser,
            MovieExtension_PlayerCleaner: { init: () => {} }
        });

        vm.runInContext(baseParserSource, pCtx);
        vm.runInContext(seasonvarParserSource, pCtx);

        const parser = new pCtx.window.SeasonvarParser();
        const container = dom.window.document.getElementById('playerContainer');

        const mockSeasons = [
            { season_number: '1', url: 'http://seasonvar.ru/reacher-1.html', name: '1 сезон' },
            { season_number: '2', url: 'http://seasonvar.ru/reacher-2.html', name: '2 сезон' },
            { season_number: '3', url: 'http://seasonvar.ru/reacher-3.html', name: '3 сезон' },
            { season_number: '4', url: 'http://seasonvar.ru/reacher-4.html', name: '4 сезон' }
        ];

        // Mock getSeriesInfo so when Season 1 is selected, it returns Season 1 episodes
        parser.getSeriesInfo = async (url) => {
            if (url === 'http://seasonvar.ru/reacher-1.html') {
                return {
                    episodes: [
                        { title: '1 серия', url: 'http://data.seasonvar.ru/s1e1.mp4' },
                        { title: '2 серия', url: 'http://data.seasonvar.ru/s1e2.mp4' }
                    ]
                };
            }
            return {
                episodes: [
                    { title: '1 серия', url: 'http://data.seasonvar.ru/s4e1.mp4' }
                ]
            };
        };

        // Generic Watch flow: options with S1E1 from resolveWatchTarget
        const rendered = await parser.renderPlayer(container, [
            { name: '1 серия (S4)', title: '1 серия (S4)', url: 'http://data.seasonvar.ru/s4e1.mp4' }
        ], {
            movieId: '1209839',
            season: 1,
            episode: 1,
            resolvedSeasonNumber: 1,
            resolvedEpisodeNumber: 1,
            resolvedSeasonUrl: 'http://seasonvar.ru/reacher-1.html',
            currentSourcesUrl: 'http://seasonvar.ru/reacher-4.html',
            seasons: mockSeasons
        });

        assert.strictEqual(rendered, true, 'renderPlayer succeeded');

        const state = container.__seasonvarPlaybackState;
        assert.strictEqual(state.activeSeasonNumber, 1, 'Mounted activeSeasonNumber is Season 1');
        assert.strictEqual(state.activeEpisodeNumber, 1, 'Mounted activeEpisodeNumber is Episode 1');
        assert.strictEqual(state.activeEpisodeUrl, 'http://data.seasonvar.ru/s1e1.mp4', 'Mounted stream URL is S1E1');

        console.log('✅ Group 4 Passed: Generic Watch correctly mounts Season 1 Episode 1 on Seasonvar');
    }

    // ─── TEST GROUP 5: Defensive Seasonvar Fallback When S/E is Null ───────
    console.log('\n--- Test Group 5: Defensive Seasonvar Fallback When S/E is Null ---');

    {
        const dom = new JSDOM('<!DOCTYPE html><html><body><div id="playerContainer"></div></body></html>');
        dom.window.postMessage = () => {};

        const pCtx = vm.createContext({
            console,
            window: dom.window,
            document: dom.window.document,
            fetch: null,
            chrome: { storage: { local: { get: (k, cb) => cb({}) } } },
            DOMParser: dom.window.DOMParser,
            MovieExtension_PlayerCleaner: { init: () => {} }
        });

        vm.runInContext(baseParserSource, pCtx);
        vm.runInContext(seasonvarParserSource, pCtx);

        const parser = new pCtx.window.SeasonvarParser();
        const container = dom.window.document.getElementById('playerContainer');

        const mockSeasons = [
            { season_number: '1', url: 'http://seasonvar.ru/reacher-1.html', name: '1 сезон' },
            { season_number: '2', url: 'http://seasonvar.ru/reacher-2.html', name: '2 сезон' }
        ];

        parser.getSeriesInfo = async (url) => {
            return {
                episodes: [
                    { title: '1 серия', url: 'http://data.seasonvar.ru/s1e1.mp4' }
                ]
            };
        };

        // Render with null season/episode but with seasons present
        await parser.renderPlayer(container, [
            { name: '1 серия (S2)', url: 'http://data.seasonvar.ru/s2e1.mp4' }
        ], {
            movieId: '1209839',
            season: null,
            episode: null,
            currentSourcesUrl: 'http://seasonvar.ru/reacher-2.html',
            seasons: mockSeasons
        });

        const state = container.__seasonvarPlaybackState;
        assert.strictEqual(state.activeSeasonNumber, 1, 'Defensive fallback picked Season 1');
        assert.strictEqual(state.activeEpisodeNumber, 1, 'Defensive fallback picked Episode 1');

        console.log('✅ Group 5 Passed: Defensive Seasonvar fallback safely mounts Season 1 when no S/E requested');
    }

    console.log('\n🎉 ALL Generic Watch Seasonvar Selection Gap Tests Passed Successfully!');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
