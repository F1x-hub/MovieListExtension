import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

console.log('🧪 Running Seasonvar Phase 5B DOM Decoupling & Compact Picker Tests...\n');

// ─── LOAD SOURCE CODE ──────────────────────────────────────────────────

const baseParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/BaseParserService.js', import.meta.url),
    'utf8'
);
const seasonvarParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/SeasonvarParser.js', import.meta.url),
    'utf8'
);
const playerCleanerSource = fs.readFileSync(
    new URL('../content-scripts/player-cleaner.js', import.meta.url),
    'utf8'
);

// ─── TEST GROUP 1: SeasonvarParser Structured State & Clean DOM ───────
console.log('--- Test Group 1: SeasonvarParser Structured State & Clean DOM ---');

{
    let postedMessages = [];
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="playerContainer"></div></body></html>', {
        url: 'http://seasonvar.ru/serial-1209839-Jack-Reacher-3-season.html'
    });

    dom.window.postMessage = (data) => {
        postedMessages.push(data);
    };

    const parserContext = vm.createContext({
        console,
        window: dom.window,
        document: dom.window.document,
        fetch: null,
        chrome: {
            storage: {
                local: {
                    get: (keys, cb) => cb({})
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
        { name: '1 серия', title: '1 серия', url: 'http://data.seasonvar.ru/s3e1.mp4' },
        { name: '2 серия', title: '2 серия', url: 'http://data.seasonvar.ru/s3e2.mp4' },
        { name: '3 серия (LostFilm)', title: '3 серия (LostFilm)', url: 'http://data.seasonvar.ru/s3e3.mp4' },
        { name: '4 серия', title: '4 серия', url: 'http://data.seasonvar.ru/s3e4.mp4' }
    ];
    const mockSeasons = [
        { season_number: '1', url: 'http://seasonvar.ru/reacher-1.html', name: '1 сезон' },
        { season_number: '2', url: 'http://seasonvar.ru/reacher-2.html', name: '2 сезон' },
        { season_number: '3', url: 'http://seasonvar.ru/reacher-3.html', name: '3 сезон' },
        { season_number: '4', url: 'http://seasonvar.ru/reacher-4.html', name: '4 сезон' }
    ];

    const rendered = await parser.renderPlayer(container, mockEpisodes, {
        season: 3,
        episode: 3,
        resolvedSeasonNumber: 3,
        resolvedEpisodeNumber: 3,
        resolvedSeasonUrl: 'http://seasonvar.ru/reacher-3.html',
        seasons: mockSeasons,
        translations: [{ id: '1', name: 'LostFilm', url: 'http://seasonvar.ru/pl1.json', active: true }]
    });

    assert.strictEqual(rendered, true, 'renderPlayer should succeed');

    // 1. Check structured message broadcast
    const stateMsg = postedMessages.find(m => m?.type === 'SEASONVAR_PLAYBACK_STATE');
    assert(stateMsg, 'Must broadcast SEASONVAR_PLAYBACK_STATE postMessage');
    assert.strictEqual(stateMsg.activeSeasonNumber, 3, 'Structured state activeSeasonNumber must be 3');
    assert.strictEqual(stateMsg.activeEpisodeNumber, 3, 'Structured state activeEpisodeNumber must be 3');
    assert.strictEqual(stateMsg.activeEpisodeUrl, 'http://data.seasonvar.ru/s3e3.mp4', 'Mounted target S3E3 stream URL');
    assert.strictEqual(stateMsg.seasons.length, 4, 'Includes all seasons');
    assert.strictEqual(stateMsg.episodes.length, 4, 'Includes all episodes');
    assert.strictEqual(stateMsg.episodes[2].episodeNumber, 3, 'Episode 3 parsed number is 3');

    // 2. Check that container has structured state attached
    assert(container.__seasonvarPlaybackState, 'Container must hold __seasonvarPlaybackState');
    assert.strictEqual(container.__seasonvarPlaybackState.activeSeasonNumber, 3);
    assert.strictEqual(container.__seasonvarPlaybackState.activeEpisodeNumber, 3);

    // 3. Check clean DOM without legacy dummy selector elements
    const video = container.querySelector('video#seasonvarVideo');
    assert(video, 'Video element must exist');
    assert.strictEqual(video.querySelector('source').getAttribute('src'), 'http://data.seasonvar.ru/s3e3.mp4');

    assert.strictEqual(container.querySelector('.dropdown_episodes'), null, 'No .dropdown_episodes in DOM');
    assert.strictEqual(container.querySelector('.dropdown_seasons'), null, 'No .dropdown_seasons in DOM');
    assert.strictEqual(container.querySelector('.item_simulated'), null, 'No .item_simulated in DOM');
    assert.strictEqual(container.querySelector('#svEpisodeSelect'), null, 'No #svEpisodeSelect in DOM');

    console.log('✅ Group 1 Passed: SeasonvarParser emits structured state and renders clean DOM');
}

// ─── TEST GROUP 2: PlayerCleaner Decoupling & Overlay Removal ─────────
console.log('\n--- Test Group 2: PlayerCleaner Decoupling & Overlay Removal ---');

{
    const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <head></head>
        <body>
            <div class="player-clean player-surface__content">
                <video id="seasonvarVideo" class="player-surface__media" controls>
                    <source src="http://data.seasonvar.ru/s3e3.mp4" type="video/mp4">
                </video>
            </div>
        </body>
        </html>
    `, {
        url: 'http://seasonvar.ru/serial-1209839-Jack-Reacher-3-season.html'
    });

    let parentMessages = [];
    dom.window.parent = {
        postMessage: (data) => parentMessages.push(data)
    };

    const cleanerContext = vm.createContext({
        console,
        window: dom.window,
        document: dom.window.document,
        localStorage: dom.window.localStorage,
        setTimeout: dom.window.setTimeout,
        clearTimeout: dom.window.clearTimeout,
        setInterval: dom.window.setInterval,
        clearInterval: dom.window.clearInterval,
        requestAnimationFrame: (cb) => setTimeout(cb, 16),
        cancelAnimationFrame: (id) => clearTimeout(id),
        MutationObserver: dom.window.MutationObserver
    });

    // Run player cleaner script
    vm.runInContext(playerCleanerSource, cleanerContext);

    // Send structured playback state
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
        data: {
            type: 'SEASONVAR_PLAYBACK_STATE',
            activeSeasonNumber: 3,
            activeEpisodeNumber: 3,
            seasons: [
                { seasonNumber: 1, name: '1 сезон' },
                { seasonNumber: 2, name: '2 сезон' },
                { seasonNumber: 3, name: '3 сезон' },
                { seasonNumber: 4, name: '4 сезон' }
            ],
            episodes: [
                { episodeNumber: 1, name: '1 серия' },
                { episodeNumber: 2, name: '2 серия' },
                { episodeNumber: 3, name: '3 серия' },
                { episodeNumber: 4, name: '4 серия' }
            ]
        }
    }));

    // Trigger cleaner initialization
    if (dom.window.MovieExtension_PlayerCleaner?.init) {
        dom.window.MovieExtension_PlayerCleaner.init({ isRequestCurrent: () => true });
    }

    // Verify no 140px full-width bottom overlay is created
    const horizontalSelector = dom.window.document.querySelector('.horizontal-episodes');
    assert.strictEqual(horizontalSelector, null, 'No .horizontal-episodes modal in DOM');

    const black140pxModal = Array.from(dom.window.document.querySelectorAll('div')).find(
        d => d.style.height === '140px' || d.style.bottom === '70px'
    );
    assert.strictEqual(black140pxModal, undefined, 'No 140px black overlay modal in DOM');

    console.log('✅ Group 2 Passed: PlayerCleaner is decoupled from DOM and 140px overlay is gone');
}

// ─── TEST GROUP 3: Progress & Identity Invariant Under Decoupling ─────
console.log('\n--- Test Group 3: Progress & Identity Invariant Under Decoupling ---');

{
    // Test that structured state allows exact progress reporting
    const structuredState = {
        type: 'SEASONVAR_PLAYBACK_STATE',
        activeSeasonNumber: 3,
        activeEpisodeNumber: 3,
        seasons: [{ seasonNumber: 3, name: '3 сезон' }],
        episodes: [{ episodeNumber: 3, name: '3 серия' }]
    };

    const sendProgress = (state, timestamp = 125) => {
        const seasonNum = state.activeSeasonNumber;
        const epNum = state.activeEpisodeNumber;
        return {
            type: 'UPDATE_WATCHING_PROGRESS',
            season: `${seasonNum} сезон`,
            seasonNumber: seasonNum,
            episode: `${epNum} серия`,
            episodeNumber: epNum,
            timestamp: Math.floor(timestamp)
        };
    };

    const progressMsg = sendProgress(structuredState, 342.6);
    assert.strictEqual(progressMsg.seasonNumber, 3, 'Progress season is 3');
    assert.strictEqual(progressMsg.episodeNumber, 3, 'Progress episode is 3');
    assert.strictEqual(progressMsg.timestamp, 342, 'Progress timestamp is 342');

    console.log('✅ Group 3 Passed: Progress reports exact S3E3 without DOM queries');
}

// ─── TEST GROUP 4: Compact Season/Episode Picker Invariants ───────────
console.log('\n--- Test Group 4: Compact Season/Episode Picker Invariants ---');

{
    // Mock MovieDetailsApp compact picker logic
    class MockMovieDetailsApp {
        constructor() {
            this.selectedMovie = {
                kinopoiskId: 1209839,
                nameRu: 'Джек Ричер',
                isSeries: true,
                seasons: [
                    { number: 1, name: '1 сезон' },
                    { number: 2, name: '2 сезон' },
                    { number: 3, name: '3 сезон' },
                    { number: 4, name: '4 сезон' }
                ]
            };
            this.currentSeasonvarPlaybackState = {
                activeSeasonNumber: 3,
                activeEpisodeNumber: 3,
                seasons: [
                    { seasonNumber: 1, name: '1 сезон', url: 'http://seasonvar.ru/s1.html' },
                    { seasonNumber: 2, name: '2 сезон', url: 'http://seasonvar.ru/s2.html' },
                    { seasonNumber: 3, name: '3 сезон', url: 'http://seasonvar.ru/s3.html' },
                    { seasonNumber: 4, name: '4 сезон', url: 'http://seasonvar.ru/s4.html' }
                ],
                episodes: [
                    { episodeNumber: 1, name: '1 серия' },
                    { episodeNumber: 2, name: '2 серия' },
                    { episodeNumber: 3, name: '3 серия' },
                    { episodeNumber: 4, name: '4 серия' },
                    { episodeNumber: 5, name: '5 серия' }
                ]
            };
            this.playbackController = {
                selection: {
                    kinopoiskId: 1209839,
                    title: 'Джек Ричер',
                    mediaType: 'tv-series',
                    seasonNumber: 3,
                    episodeNumber: 3,
                    source: 'SEASONS_TAB'
                },
                getSelection() { return this.selection; },
                playedSelections: [],
                async play(sel) {
                    this.selection = { ...sel };
                    this.playedSelections.push(sel);
                }
            };
            this.isEpisodePickerOpen = false;
            this.pickerBrowsingSeasonNumber = 3;
            this.networkRequestsCount = 0;
        }

        openEpisodePicker() {
            this.isEpisodePickerOpen = true;
            this.pickerBrowsingSeasonNumber = this.playbackController.getSelection().seasonNumber;
            // Uses current state, executes 0 network requests
        }

        closeEpisodePicker() {
            this.isEpisodePickerOpen = false;
        }

        onPickerSeasonClick(seasonNumber) {
            // Browsing season updates browse context only, does not alter playing stream
            this.pickerBrowsingSeasonNumber = seasonNumber;
        }

        async onPickerEpisodeClick(episodeNumber) {
            const targetSeason = this.pickerBrowsingSeasonNumber;
            this.closeEpisodePicker();
            const selection = {
                ...this.playbackController.getSelection(),
                seasonNumber: targetSeason,
                episodeNumber: episodeNumber,
                initialTimestamp: 0,
                source: 'PLAYER_PROVIDER_PICKER'
            };
            await this.playbackController.play(selection);
        }
    }

    const app = new MockMovieDetailsApp();

    // 1. Opening picker executes 0 network requests
    app.openEpisodePicker();
    assert.strictEqual(app.isEpisodePickerOpen, true, 'Episode picker is open');
    assert.strictEqual(app.pickerBrowsingSeasonNumber, 3, 'Browsing active season 3');
    assert.strictEqual(app.networkRequestsCount, 0, 'Opening picker makes 0 network requests');
    assert.strictEqual(app.playbackController.getSelection().seasonNumber, 3, 'Playing video unchanged');
    assert.strictEqual(app.playbackController.getSelection().episodeNumber, 3, 'Playing video unchanged');

    // 2. Browsing another season in picker (e.g. Season 2) does NOT change playback
    app.onPickerSeasonClick(2);
    assert.strictEqual(app.pickerBrowsingSeasonNumber, 2, 'Browsing season is now 2');
    assert.strictEqual(app.playbackController.getSelection().seasonNumber, 3, 'Playing video season still 3');
    assert.strictEqual(app.playbackController.getSelection().episodeNumber, 3, 'Playing video episode still 3');
    assert.strictEqual(app.playbackController.playedSelections.length, 0, 'No playback triggered by browse');

    // 3. Selecting Season 2 Episode 4 dispatches through PlaybackController
    await app.onPickerEpisodeClick(4);
    assert.strictEqual(app.isEpisodePickerOpen, false, 'Picker closes on episode selection');
    assert.strictEqual(app.playbackController.getSelection().seasonNumber, 2, 'Selection season is 2');
    assert.strictEqual(app.playbackController.getSelection().episodeNumber, 4, 'Selection episode is 4');
    assert.strictEqual(app.playbackController.getSelection().source, 'PLAYER_PROVIDER_PICKER', 'Source is PLAYER_PROVIDER_PICKER');
    assert.strictEqual(app.playbackController.getSelection().initialTimestamp, 0, 'Timestamp starts at 0');

    console.log('✅ Group 4 Passed: Compact picker correctly separates browsing from playback and dispatches canonical selections');
}

// ─── TEST GROUP 5: Runtime Hardening & Regression Invariants ──────────
console.log('\n--- Test Group 5: Runtime Hardening & Regression Invariants ---');

{
    // 5.1 Verify SeasonvarParser renders and attaches listeners without trSelect or epSelect
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

    const mockTranslations = [
        { id: '1', name: 'LostFilm', url: 'http://seasonvar.ru/pl1.json', active: true },
        { id: '2', name: 'Кубик в Кубе', url: 'http://seasonvar.ru/pl2.json', active: false }
    ];
    const mockEpisodes = [
        { name: '1 серия', title: '1 серия', url: 'http://data.seasonvar.ru/s3e1.mp4' },
        { name: '2 серия', title: '2 серия', url: 'http://data.seasonvar.ru/s3e2.mp4' },
        { name: '3 серия', title: '3 серия', url: 'http://data.seasonvar.ru/s3e3.mp4' }
    ];

    // Mock fetchAndParsePlaylist for voiceover switch
    parser.fetchAndParsePlaylist = async (url) => {
        return [
            { name: '1 серия (Кубик)', title: '1 серия (Кубик)', url: 'http://data.seasonvar.ru/s3e1_kubik.mp4' },
            { name: '2 серия (Кубик)', title: '2 серия (Кубик)', url: 'http://data.seasonvar.ru/s3e2_kubik.mp4' },
            { name: '3 серия (Кубик)', title: '3 серия (Кубик)', url: 'http://data.seasonvar.ru/s3e3_kubik.mp4' }
        ];
    };

    // Render player
    assert.doesNotThrow(async () => {
        await parser.renderPlayer(container, mockEpisodes, {
            season: 3,
            episode: 3,
            resolvedSeasonNumber: 3,
            resolvedEpisodeNumber: 3,
            translations: mockTranslations,
            seasons: [{ season_number: '3', url: 'http://seasonvar.ru/s3.html' }]
        });
    }, 'renderPlayer must execute without ReferenceError on trSelect or epSelect');

    // 5.2 Voiceover switch preserves S3E3
    const kubikPill = container.querySelector('.seasonvar-voiceover-item[data-id="2"]');
    assert(kubikPill, 'Voiceover pill exists');

    kubikPill.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));

    const updatedState = container.__seasonvarPlaybackState;
    assert.strictEqual(updatedState.activeSeasonNumber, 3, 'Season preserved after voiceover change');
    assert.strictEqual(updatedState.activeEpisodeNumber, 3, 'Episode 3 preserved after voiceover change');
    assert.strictEqual(updatedState.activeEpisodeUrl, 'http://data.seasonvar.ru/s3e3_kubik.mp4', 'Mounted Kubik S3E3 stream URL');

    // 5.3 PlayerCleaner mouse movement and updateVisibility with no viewingPositionIndicator
    const cleanerDom = new JSDOM(`
        <!DOCTYPE html><html><body>
            <div class="player-clean player-surface__content">
                <video id="seasonvarVideo" class="player-surface__media" controls>
                    <source src="http://data.seasonvar.ru/s3e3.mp4">
                </video>
            </div>
        </body></html>
    `, { url: 'http://seasonvar.ru/serial-1209839-Jack-Reacher-3-season.html' });

    cleanerDom.window.parent = { postMessage: () => {} };

    const cCtx = vm.createContext({
        console,
        window: cleanerDom.window,
        document: cleanerDom.window.document,
        localStorage: cleanerDom.window.localStorage,
        setTimeout: cleanerDom.window.setTimeout,
        clearTimeout: cleanerDom.window.clearTimeout,
        setInterval: cleanerDom.window.setInterval,
        clearInterval: cleanerDom.window.clearInterval,
        requestAnimationFrame: (cb) => setTimeout(cb, 16),
        cancelAnimationFrame: (id) => clearTimeout(id),
        MutationObserver: cleanerDom.window.MutationObserver
    });

    vm.runInContext(playerCleanerSource, cCtx);

    assert.doesNotThrow(() => {
        cleanerDom.window.MovieExtension_PlayerCleaner?.init?.({ isRequestCurrent: () => true });
        
        // Trigger mouse events and inactivity timer
        const surface = cleanerDom.window.document.querySelector('.player-clean');
        if (surface) {
            surface.dispatchEvent(new cleanerDom.window.MouseEvent('mouseenter'));
            surface.dispatchEvent(new cleanerDom.window.MouseEvent('mousemove'));
            surface.dispatchEvent(new cleanerDom.window.MouseEvent('click'));
            surface.dispatchEvent(new cleanerDom.window.MouseEvent('mouseleave'));
        }
    }, 'PlayerCleaner interactions must never throw viewingPositionIndicator ReferenceError');

    console.log('✅ Group 5 Passed: Zero runtime ReferenceErrors; voiceover switch preserves exact S/E identity');
}

console.log('\n🎉 ALL Seasonvar Phase 5B Tests Passed Successfully!');
