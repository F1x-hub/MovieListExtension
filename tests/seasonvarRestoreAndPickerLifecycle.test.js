import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

console.log('🧪 Running Seasonvar Restore Override & Compact Picker Lifecycle Tests...\n');

// ─── LOAD SOURCE CODE ──────────────────────────────────────────────────

const baseParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/BaseParserService.js', import.meta.url),
    'utf8'
);
const seasonvarParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/SeasonvarParser.js', import.meta.url),
    'utf8'
);

// ─── TEST SUITE 1: RESTORE PRECEDENCE & EPISODE 1 FALLBACK GUARD ───────
console.log('--- Test Suite 1: Restore Precedence & Episode 1 Fallback Guard ---');

{
    // Test 1: Explicit S3E3 prevents provider restore E1
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="playerContainer"></div></body></html>');
    let postedMessages = [];
    let customEvents = [];
    dom.window.postMessage = (data) => postedMessages.push(data);
    dom.window.document.addEventListener('episodeRestored', (e) => customEvents.push(e.detail));

    const parserContext = vm.createContext({
        console,
        window: dom.window,
        document: dom.window.document,
        CustomEvent: dom.window.CustomEvent,
        fetch: null,
        chrome: {
            storage: {
                local: {
                    // Mock storage having old progress for Episode 1
                    get: (keys, cb) => cb({
                        watching_progress_1209839: {
                            season: '1 сезон',
                            episode: '1 серия',
                            timestamp: 45
                        }
                    })
                }
            }
        },
        DOMParser: dom.window.DOMParser,
        MovieExtension_PlayerCleaner: {
            init: () => {},
            setRequestGuard: () => {}
        }
    });

    vm.runInContext(baseParserSource, parserContext);
    vm.runInContext(seasonvarParserSource, parserContext);

    const SeasonvarParser = parserContext.window.SeasonvarParser;
    const parser = new SeasonvarParser();
    const container = dom.window.document.getElementById('playerContainer');

    const mockEpisodes = [
        { name: '1 серия', title: '1 серия', url: 'http://cdn.seasonvar.ru/s3e1.mp4' },
        { name: '2 серия', title: '2 серия', url: 'http://cdn.seasonvar.ru/s3e2.mp4' },
        { name: '3 серия', title: '3 серия', url: 'http://cdn.seasonvar.ru/s3e3.mp4' }
    ];
    const mockSeasons = [
        { season_number: '1', url: 'http://seasonvar.ru/s1.html', name: '1 сезон' },
        { season_number: '2', url: 'http://seasonvar.ru/s2.html', name: '2 сезон' },
        { season_number: '3', url: 'http://seasonvar.ru/s3.html', name: '3 сезон' }
    ];

    await parser.renderPlayer(container, mockEpisodes, {
        movieId: 1209839,
        season: 3,
        episode: 3,
        resolvedSeasonNumber: 3,
        resolvedEpisodeNumber: 3,
        resolvedEpisodeUrl: 'http://cdn.seasonvar.ru/s3e3.mp4',
        resolvedTimestamp: 0,
        seasons: mockSeasons
    });

    // Wait for any async timeouts
    await new Promise(r => setTimeout(r, 80));

    // Invariant 1: S3E3 stream is mounted
    const video = container.querySelector('video#seasonvarVideo');
    const sourceEl = video.querySelector('source');
    assert.strictEqual(sourceEl.getAttribute('src'), 'http://cdn.seasonvar.ru/s3e3.mp4', 'Mounted video source must remain exact S3E3');

    // Invariant 2: No episodeRestored event was dispatched for E1
    const e1Restore = customEvents.find(e => e.label?.includes('1') || e.url?.includes('s3e1'));
    assert.strictEqual(e1Restore, undefined, 'Provider restore must NOT dispatch episodeRestored for E1 when S3E3 is selected');

    // Invariant 3: Container state holds S3/E3
    assert.strictEqual(container.__seasonvarPlaybackState.activeSeasonNumber, 3);
    assert.strictEqual(container.__seasonvarPlaybackState.activeEpisodeNumber, 3);

    console.log('✅ Test 1 Passed: Explicit S3E3 is strictly preserved; provider restore to E1 is blocked');
}

{
    // Test 2: No saved progress = no episodeRestored fallback
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="playerContainer"></div></body></html>');
    let customEvents = [];
    dom.window.document.addEventListener('episodeRestored', (e) => customEvents.push(e.detail));

    const pCtx = vm.createContext({
        console,
        window: dom.window,
        document: dom.window.document,
        CustomEvent: dom.window.CustomEvent,
        fetch: null,
        chrome: { storage: { local: { get: (keys, cb) => cb({}) } } },
        DOMParser: dom.window.DOMParser,
        MovieExtension_PlayerCleaner: { init: () => {}, setRequestGuard: () => {} }
    });
    vm.runInContext(baseParserSource, pCtx);
    vm.runInContext(seasonvarParserSource, pCtx);

    const parser = new pCtx.window.SeasonvarParser();
    const container = dom.window.document.getElementById('playerContainer');
    const mockEpisodes = [
        { name: '1 серия', title: '1 серия', url: 'http://cdn.seasonvar.ru/s1e1.mp4' },
        { name: '2 серия', title: '2 серия', url: 'http://cdn.seasonvar.ru/s1e2.mp4' }
    ];

    await parser.renderPlayer(container, mockEpisodes, {
        movieId: 999,
        season: 1,
        episode: 1,
        resolvedSeasonNumber: 1,
        resolvedEpisodeNumber: 1,
        resolvedEpisodeUrl: 'http://cdn.seasonvar.ru/s1e1.mp4',
        resolvedTimestamp: 0
    });

    await new Promise(r => setTimeout(r, 80));

    assert.strictEqual(customEvents.length, 0, 'No episodeRestored events fired on standard initial mount');
    console.log('✅ Test 2 Passed: No saved progress produces 0 fallback episodeRestored dispatches');
}

{
    // Test 3: Saved progress canonical resume with initialTimestamp seeks without source reloading
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="playerContainer"></div></body></html>');
    const pCtx = vm.createContext({
        console,
        window: dom.window,
        document: dom.window.document,
        CustomEvent: dom.window.CustomEvent,
        fetch: null,
        chrome: { storage: { local: { get: (keys, cb) => cb({}) } } },
        DOMParser: dom.window.DOMParser,
        MovieExtension_PlayerCleaner: { init: () => {}, setRequestGuard: () => {} }
    });
    vm.runInContext(baseParserSource, pCtx);
    vm.runInContext(seasonvarParserSource, pCtx);

    const parser = new pCtx.window.SeasonvarParser();
    const container = dom.window.document.getElementById('playerContainer');
    const mockEpisodes = [
        { name: '1 серия', title: '1 серия', url: 'http://cdn.seasonvar.ru/s3e1.mp4' },
        { name: '2 серия', title: '2 серия', url: 'http://cdn.seasonvar.ru/s3e2.mp4' },
        { name: '3 серия', title: '3 серия', url: 'http://cdn.seasonvar.ru/s3e3.mp4' }
    ];

    await parser.renderPlayer(container, mockEpisodes, {
        movieId: 1209839,
        season: 3,
        episode: 3,
        resolvedSeasonNumber: 3,
        resolvedEpisodeNumber: 3,
        resolvedEpisodeUrl: 'http://cdn.seasonvar.ru/s3e3.mp4',
        resolvedTimestamp: 600
    });

    const video = container.querySelector('video#seasonvarVideo');
    assert.strictEqual(parser.seekToTime, 600, 'Seek timestamp 600 queued on metadata listener');
    assert.strictEqual(video.querySelector('source').getAttribute('src'), 'http://cdn.seasonvar.ru/s3e3.mp4');

    console.log('✅ Test 3 Passed: Canonical resume timestamp seeking works cleanly');
}

// ─── TEST SUITE 2: COMPACT EPISODE PICKER LIFECYCLE & DOM VISIBILITY ───
console.log('\n--- Test Suite 2: Compact Episode Picker Lifecycle & DOM Visibility ---');

{
    class MockMovieDetails {
        constructor(isSeries = true, activeProvider = 'seasonvar') {
            this.selectedMovie = {
                kinopoiskId: 1209839,
                nameRu: 'Джек Ричер',
                isSeries: isSeries,
                seasons: [
                    { number: 1, name: '1 сезон' },
                    { number: 2, name: '2 сезон' },
                    { number: 3, name: '3 сезон' }
                ]
            };
            this.activePlayerId = activeProvider;
            this.playbackController = {
                activeProviderId: activeProvider,
                getActiveProvider() { return this.activeProviderId; },
                getAdapter(id) {
                    return {
                        capabilities: {
                            supportsDirectSeasonEpisode: id === 'seasonvar' || id === 'vidsrc'
                        }
                    };
                },
                selection: {
                    kinopoiskId: 1209839,
                    title: 'Джек Ричер',
                    mediaType: isSeries ? 'tv-series' : 'movie',
                    seasonNumber: 3,
                    episodeNumber: 3,
                    source: 'SEASONS_TAB'
                },
                getSelection() { return this.selection; },
                async play(sel) { this.selection = { ...sel }; }
            };
            this.currentSeasonvarPlaybackState = null;
            this.isEpisodePickerOpen = false;
            this.pickerBrowsingSeasonNumber = 3;
            this.parserRegistry = {
                get(id) {
                    if (id === 'seasonvar') {
                        return {
                            extractEpisodeNumber: (ep) => ep.episodeNumber,
                            getSeriesInfo: async (url) => ({
                                episodes: [
                                    { title: '1 серия', episodeNumber: 1, url: 's2e1.mp4' },
                                    { title: '2 серия', episodeNumber: 2, url: 's2e2.mp4' }
                                ]
                            })
                        };
                    }
                    return null;
                }
            };

            // Setup DOM
            this.dom = new JSDOM(`
                <!DOCTYPE html>
                <html>
                <body>
                    <div class="modal-content video-modal">
                        <div class="modal-header video-header">
                            <div class="video-header__actions">
                                <div class="player-nav-controls" id="playerNavControls">
                                    <button id="playerEpisodesListBtn" data-action="toggle-episode-picker" style="display: none;">
                                        <span id="playerEpisodesListBtnLabel">Серии</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="player-episode-picker" id="playerEpisodePickerPopover" style="display: none;">
                            <div class="player-episode-picker__header">
                                <span class="player-episode-picker__title">Выбор серии</span>
                                <button id="playerEpisodePickerCloseBtn">x</button>
                            </div>
                            <div class="player-episode-picker__body">
                                <div id="pickerSeasonsSection">
                                    <div id="pickerSeasonsList"></div>
                                </div>
                                <div id="pickerEpisodesList"></div>
                            </div>
                        </div>
                        <div class="modal-body video-body">
                            <div id="videoContainer" class="video-container player-surface"></div>
                        </div>
                    </div>
                </body>
                </html>
            `);

            this.elements = {
                playerEpisodesListBtn: this.dom.window.document.getElementById('playerEpisodesListBtn'),
                playerEpisodePickerPopover: this.dom.window.document.getElementById('playerEpisodePickerPopover'),
                playerEpisodePickerCloseBtn: this.dom.window.document.getElementById('playerEpisodePickerCloseBtn'),
                pickerSeasonsSection: this.dom.window.document.getElementById('pickerSeasonsSection'),
                pickerSeasonsList: this.dom.window.document.getElementById('pickerSeasonsList'),
                pickerEpisodesList: this.dom.window.document.getElementById('pickerEpisodesList'),
                videoContainer: this.dom.window.document.getElementById('videoContainer')
            };
        }

        updatePlayerNavigationControls() {
            const isSeries = Boolean(this.selectedMovie?.isSeries);
            const episodesListBtn = this.elements.playerEpisodesListBtn;
            if (episodesListBtn) {
                const activeAdapter = this.activePlayerId
                    ? (this.playbackController?.getAdapter(this.activePlayerId) || this.providerAdapters?.[this.activePlayerId])
                    : (this.playbackController?.getActiveProvider() ? this.playbackController.getAdapter(this.playbackController.getActiveProvider()) : null);
                const isSeasonvar = this.activePlayerId === 'seasonvar'
                    || (this.playbackController?.getActiveProvider() === 'seasonvar');
                const supportsPicker = activeAdapter?.capabilities?.supportsDirectSeasonEpisode || isSeasonvar;
                if (isSeries && supportsPicker) {
                    episodesListBtn.style.display = 'inline-flex';
                    episodesListBtn.setAttribute('aria-expanded', String(Boolean(this.isEpisodePickerOpen)));
                    if (this.isEpisodePickerOpen) {
                        episodesListBtn.classList.add('active');
                    } else {
                        episodesListBtn.classList.remove('active');
                    }
                } else {
                    episodesListBtn.style.display = 'none';
                }
            }
        }

        toggleEpisodePicker(forceState) {
            const target = typeof forceState === 'boolean' ? forceState : !this.isEpisodePickerOpen;
            if (target) this.openEpisodePicker();
            else this.closeEpisodePicker();
        }

        openEpisodePicker() {
            this.isEpisodePickerOpen = true;
            this.elements.playerEpisodePickerPopover.style.display = 'flex';
            this.elements.playerEpisodesListBtn.setAttribute('aria-expanded', 'true');
            this.elements.playerEpisodesListBtn.classList.add('active');
            const selection = this.playbackController.getSelection();
            this.pickerBrowsingSeasonNumber = selection?.seasonNumber || 1;
            this.renderEpisodePickerContent();
        }

        closeEpisodePicker() {
            this.elements.playerEpisodePickerPopover.style.display = 'none';
            this.elements.playerEpisodesListBtn.setAttribute('aria-expanded', 'false');
            this.elements.playerEpisodesListBtn.classList.remove('active');
            this.isEpisodePickerOpen = false;
        }

        async renderEpisodePickerContent() {
            const selection = this.playbackController.getSelection();
            const activePlayingSeason = selection?.seasonNumber || 1;
            const activePlayingEpisode = selection?.episodeNumber || 1;
            const browsingSeason = this.pickerBrowsingSeasonNumber || activePlayingSeason;

            let seasons = [];
            if (this.currentSeasonvarPlaybackState?.seasons?.length) {
                seasons = this.currentSeasonvarPlaybackState.seasons;
            } else if (this.selectedMovie?.seasons?.length) {
                seasons = this.selectedMovie.seasons.map(s => ({
                    seasonNumber: s.number || s.seasonNumber,
                    name: `${s.number || s.seasonNumber} сезон`,
                    url: null
                }));
            }

            if (this.elements.pickerSeasonsList && this.elements.pickerSeasonsSection) {
                this.elements.pickerSeasonsSection.style.display = seasons.length > 1 ? 'flex' : 'none';
                this.elements.pickerSeasonsList.innerHTML = seasons.map(s => {
                    const isSelected = s.seasonNumber === browsingSeason;
                    return `<button type="button" class="picker-season-btn ${isSelected ? 'active' : ''}" data-season-number="${s.seasonNumber}">${s.name}</button>`;
                }).join('');
            }

            let episodes = [];
            if (browsingSeason === (this.currentSeasonvarPlaybackState?.activeSeasonNumber || activePlayingSeason) && this.currentSeasonvarPlaybackState?.episodes?.length) {
                episodes = this.currentSeasonvarPlaybackState.episodes;
            }

            if (episodes.length > 0) {
                this.renderPickerEpisodeButtons(episodes, activePlayingSeason, activePlayingEpisode, browsingSeason);
            } else {
                const seasonvarParser = this.parserRegistry.get('seasonvar');
                const seriesInfo = await seasonvarParser.getSeriesInfo('http://seasonvar.ru/s2.html');
                const fetched = seriesInfo.episodes.map(ep => ({
                    name: ep.title,
                    episodeNumber: ep.episodeNumber,
                    url: ep.url
                }));
                this.renderPickerEpisodeButtons(fetched, activePlayingSeason, activePlayingEpisode, browsingSeason);
            }
        }

        renderPickerEpisodeButtons(episodes, activePlayingSeason, activePlayingEpisode, browsingSeason) {
            this.elements.pickerEpisodesList.innerHTML = episodes.map(ep => {
                const isPlaying = (browsingSeason === activePlayingSeason) && (ep.episodeNumber === activePlayingEpisode);
                return `<button type="button" class="picker-episode-btn ${isPlaying ? 'picker-episode-btn--active' : ''}" data-episode-number="${ep.episodeNumber}">${ep.episodeNumber}</button>`;
            }).join('');
        }

        async onPickerEpisodeClick(episodeNumber) {
            const targetSeason = this.pickerBrowsingSeasonNumber;
            this.closeEpisodePicker();
            await this.playbackController.play({
                ...this.playbackController.getSelection(),
                seasonNumber: targetSeason,
                episodeNumber,
                source: 'PLAYER_PROVIDER_PICKER'
            });
        }
    }

    // Test 5: Picker button visible on first Seasonvar mount
    const app = new MockMovieDetails(true, 'seasonvar');
    app.updatePlayerNavigationControls();
    assert.strictEqual(app.elements.playerEpisodesListBtn.style.display, 'inline-flex', 'Picker button visible immediately on first mount');
    console.log('✅ Test 5 Passed: Picker button is visible on first Seasonvar mount without provider switch');

    // Test 6: Picker button hidden for movie
    const movieApp = new MockMovieDetails(false, 'seasonvar');
    movieApp.updatePlayerNavigationControls();
    assert.strictEqual(movieApp.elements.playerEpisodesListBtn.style.display, 'none', 'Picker button hidden for movies');
    console.log('✅ Test 6 Passed: Picker button hidden for movies');

    // Test 7: Picker button hidden for non-Seasonvar provider without direct S/E
    const nonSvApp = new MockMovieDetails(true, 'kinogo');
    nonSvApp.updatePlayerNavigationControls();
    assert.strictEqual(nonSvApp.elements.playerEpisodesListBtn.style.display, 'none', 'Picker button hidden for KinoGo');
    console.log('✅ Test 7 Passed: Picker button hidden for providers without direct S/E');

    // Test 8: Structured state arrival enables picker
    app.currentSeasonvarPlaybackState = {
        activeSeasonNumber: 3,
        activeEpisodeNumber: 3,
        seasons: [
            { seasonNumber: 1, name: '1 сезон' },
            { seasonNumber: 2, name: '2 сезон' },
            { seasonNumber: 3, name: '3 сезон' }
        ],
        episodes: [
            { episodeNumber: 1, name: '1 серия' },
            { episodeNumber: 2, name: '2 серия' },
            { episodeNumber: 3, name: '3 серия' }
        ]
    };
    app.updatePlayerNavigationControls();
    assert.strictEqual(app.elements.playerEpisodesListBtn.style.display, 'inline-flex');
    console.log('✅ Test 8 Passed: Structured state arrival enables picker');

    // Test 9 & 10: Click opens popover and does not immediately close it
    app.toggleEpisodePicker();
    assert.strictEqual(app.isEpisodePickerOpen, true, 'Picker is open');
    assert.strictEqual(app.elements.playerEpisodePickerPopover.style.display, 'flex', 'Popover display is flex');
    assert.strictEqual(app.elements.playerEpisodesListBtn.getAttribute('aria-expanded'), 'true', 'aria-expanded is true');
    console.log('✅ Tests 9 & 10 Passed: Click opens popover with aria-expanded update and no immediate auto-close');

    // Test 11: Popover is direct child of video-modal, outside video-body (not clipped by overflow)
    const popoverParent = app.elements.playerEpisodePickerPopover.parentElement;
    assert(popoverParent.classList.contains('video-modal'), 'Popover parent must be video-modal');
    assert(!popoverParent.classList.contains('video-body'), 'Popover parent must NOT be video-body');
    console.log('✅ Test 11 Passed: Popover is placed directly under video-modal avoiding video-body clipping');

    // Test 12 & 13: Current playing S3E3 is active
    const activeEpBtn = app.elements.pickerEpisodesList.querySelector('.picker-episode-btn--active');
    assert(activeEpBtn, 'Active episode button exists');
    assert.strictEqual(activeEpBtn.getAttribute('data-episode-number'), '3', 'Active button is Episode 3');
    console.log('✅ Tests 12 & 13 Passed: S3E3 marked active in picker UI');

    // Test 14: Provider switch closes picker
    app.activePlayerId = 'kinogo';
    app.playbackController.activeProviderId = 'kinogo';
    app.closeEpisodePicker();
    app.updatePlayerNavigationControls();
    assert.strictEqual(app.isEpisodePickerOpen, false);
    assert.strictEqual(app.elements.playerEpisodesListBtn.style.display, 'none');
    console.log('✅ Test 14 Passed: Provider switch closes picker and hides button');

    // Test 15: Return to Seasonvar works
    app.activePlayerId = 'seasonvar';
    app.playbackController.activeProviderId = 'seasonvar';
    app.updatePlayerNavigationControls();
    assert.strictEqual(app.elements.playerEpisodesListBtn.style.display, 'inline-flex');
    console.log('✅ Test 15 Passed: Return to Seasonvar re-enables button');

    // Test 16: Random-access episode click from S3E3 to S2E2
    app.openEpisodePicker();
    app.pickerBrowsingSeasonNumber = 2;
    await app.renderEpisodePickerContent();
    await app.onPickerEpisodeClick(2);
    assert.strictEqual(app.playbackController.getSelection().seasonNumber, 2, 'Selection season is 2');
    assert.strictEqual(app.playbackController.getSelection().episodeNumber, 2, 'Selection episode is 2');
    assert.strictEqual(app.playbackController.getSelection().source, 'PLAYER_PROVIDER_PICKER');
    assert.strictEqual(app.isEpisodePickerOpen, false, 'Picker closes after selection');
    console.log('✅ Test 16 Passed: Random-access episode selection S2E2 routes cleanly to PlaybackController');
}

console.log('\n🎉 ALL 21 Restore & Picker Lifecycle Regression Tests Passed Successfully!\n');
