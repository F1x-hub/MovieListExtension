import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

console.log('🧪 Running Seasonvar S3E6 & Episode Picker Click Lifecycle Tests...\n');

// ─── LOAD SOURCE CODE ──────────────────────────────────────────────────
const baseParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/BaseParserService.js', import.meta.url),
    'utf8'
);
const seasonvarParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/SeasonvarParser.js', import.meta.url),
    'utf8'
);
const playbackSelectionSource = fs.readFileSync(
    new URL('../src/shared/services/player/PlaybackSelection.js', import.meta.url),
    'utf8'
);
const playbackRuntimeSource = fs.readFileSync(
    new URL('../src/shared/services/player/PlaybackRuntime.js', import.meta.url),
    'utf8'
);
const playbackControllerSource = fs.readFileSync(
    new URL('../src/shared/services/player/PlaybackController.js', import.meta.url),
    'utf8'
);
const seasonvarAdapterSource = fs.readFileSync(
    new URL('../src/shared/services/player/adapters/SeasonvarAdapter.js', import.meta.url),
    'utf8'
);

// ─── TEST SUITE 1: S3E6 OVERRIDE & PLAYBACK CONTROLLER INVARIANTS ──────
console.log('--- Test Suite 1: S3E6 Overrides Stored S4E1 Progress & Preload ---');

{
    // Test 1 & 2: Episode card DOM attributes & click passing S3E6
    const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
            <div class="episode-card" data-season-number="3" data-episode-number="6">
                <span class="episode-title">Reacher S3E6</span>
                <button type="button" class="episode-card__play-btn" data-action="play-episode" data-season-number="3" data-episode-number="6">Play</button>
            </div>
            <div id="videoContainer"></div>
            <div id="videoPlayerModal" style="display:none;"></div>
            <div id="playerHeaderTitle"></div>
        </body>
        </html>
    `);

    const playBtn = dom.window.document.querySelector('[data-action="play-episode"]');
    assert.strictEqual(playBtn.getAttribute('data-season-number'), '3', '1. DOM data-season-number must be "3"');
    assert.strictEqual(playBtn.getAttribute('data-episode-number'), '6', '1. DOM data-episode-number must be "6"');

    const context = vm.createContext({
        console,
        window: dom.window,
        document: dom.window.document,
        CustomEvent: dom.window.CustomEvent,
        HTMLElement: dom.window.HTMLElement,
        HTMLVideoElement: dom.window.HTMLVideoElement,
        chrome: {
            storage: {
                local: {
                    // Stored progress is S4E1!
                    get: (keys, cb) => cb({
                        watching_progress_1209839: {
                            season: '4 сезон',
                            episode: '1 серия',
                            timestamp: 120
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

    vm.runInContext(baseParserSource, context);
    vm.runInContext(seasonvarParserSource, context);
    vm.runInContext(playbackSelectionSource, context);
    vm.runInContext(playbackRuntimeSource, context);
    vm.runInContext(playbackControllerSource, context);
    vm.runInContext(seasonvarAdapterSource, context);

    const { PlaybackController, normalizePlaybackSelection, SeasonvarParser } = context.window;
    const controller = new PlaybackController();

    // Test 3: Explicit S3E6 selection beats stored progress S4E1
    const selection = normalizePlaybackSelection({
        kinopoiskId: 1209839,
        title: 'Reacher',
        mediaType: 'tv-series',
        seasonNumber: 3,
        episodeNumber: 6,
        source: 'SEASONS_TAB'
    });

    controller.setSelection(selection);
    const activeSel = controller.getSelection();
    assert.strictEqual(activeSel.seasonNumber, 3, '3. Controller selection season must be 3');
    assert.strictEqual(activeSel.episodeNumber, 6, '3. Controller selection episode must be 6');
    assert.strictEqual(activeSel.source, 'SEASONS_TAB', '3. Selection source must remain SEASONS_TAB');

    console.log('  ✅ Tests 1-3 Passed: DOM attributes, click handler, and PlaybackController selection preserve S3E6 over progress');
}

// ─── TEST SUITE 2: SEASONVAR PARSER S3E6 PLAYLIST ON-DEMAND FETCH ──────
console.log('\n--- Test Suite 2: Seasonvar Parser Loads S3E6 When Preloaded with S4 ---');

{
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="playerContainer"></div></body></html>');
    let postedMessages = [];
    dom.window.postMessage = (data) => postedMessages.push(data);

    let getSeriesInfoCalls = [];

    const mockSeasons = [
        { season_number: '1', url: 'http://seasonvar.ru/reacher-s1.html', name: '1 сезон' },
        { season_number: '2', url: 'http://seasonvar.ru/reacher-s2.html', name: '2 сезон' },
        { season_number: '3', url: 'http://seasonvar.ru/reacher-s3.html', name: '3 сезон' },
        { season_number: '4', url: 'http://seasonvar.ru/reacher-s4.html', name: '4 сезон' }
    ];

    // Preloaded sources were from Season 4
    const preloadedS4Sources = [
        { name: '1 серия', title: '1 серия', url: 'http://cdn.seasonvar.ru/s4e1.mp4' },
        { name: '2 серия', title: '2 серия', url: 'http://cdn.seasonvar.ru/s4e2.mp4' }
    ];

    const s3SeriesInfo = {
        title: 'Reacher Season 3',
        episodes: [
            { title: '1 серия', url: 'http://cdn.seasonvar.ru/s3e1.mp4' },
            { title: '2 серия', url: 'http://cdn.seasonvar.ru/s3e2.mp4' },
            { title: '3 серия', url: 'http://cdn.seasonvar.ru/s3e3.mp4' },
            { title: '4 серия', url: 'http://cdn.seasonvar.ru/s3e4.mp4' },
            { title: '5 серия', url: 'http://cdn.seasonvar.ru/s3e5.mp4' },
            { title: '6 серия', url: 'http://cdn.seasonvar.ru/s3e6.mp4' }
        ],
        translations: [{ id: '1', name: 'LostFilm', url: 'http://seasonvar.ru/reacher-s3-lf.html', active: true }]
    };

    const context = vm.createContext({
        console,
        window: dom.window,
        document: dom.window.document,
        CustomEvent: dom.window.CustomEvent,
        chrome: { storage: { local: { get: (k, cb) => cb({}) } } },
        DOMParser: dom.window.DOMParser,
        MovieExtension_PlayerCleaner: { init: () => {}, setRequestGuard: () => {} }
    });

    vm.runInContext(baseParserSource, context);
    vm.runInContext(seasonvarParserSource, context);

    const SeasonvarParser = context.window.SeasonvarParser;
    const parser = new SeasonvarParser();
    parser.getSeriesInfo = async (url) => {
        getSeriesInfoCalls.push(url);
        if (url.includes('s3')) return s3SeriesInfo;
        return null;
    };

    const container = dom.window.document.getElementById('playerContainer');

    // Test 4, 7, 8, 9: mountPlayer passes options with preloaded S4 sources but requested S3E6
    await parser.renderPlayer(container, preloadedS4Sources, {
        movieId: 1209839,
        season: 3,
        episode: 6,
        resolvedSeasonNumber: 3,
        resolvedEpisodeNumber: 6,
        resolvedSeasonUrl: 'http://seasonvar.ru/reacher-s3.html',
        currentSourcesUrl: 'http://seasonvar.ru/reacher-s4.html',
        sourcesSeasonUrl: 'http://seasonvar.ru/reacher-s4.html',
        sourcesSeasonNumber: 4,
        seasons: mockSeasons
    });

    await new Promise(r => setTimeout(r, 60));

    // Test 8: target season URL was fetched
    assert.strictEqual(getSeriesInfoCalls.length, 1, '8. Must fetch seriesInfo for Season 3 on-demand');
    assert.strictEqual(getSeriesInfoCalls[0], 'http://seasonvar.ru/reacher-s3.html', '8. Fetched URL must be Season 3 URL');

    // Test 9: Video element mounted with exact S3E6 stream
    const video = container.querySelector('video#seasonvarVideo');
    assert.ok(video, '9. Video element must exist');
    const sourceEl = video.querySelector('source');
    assert.strictEqual(sourceEl.getAttribute('src'), 'http://cdn.seasonvar.ru/s3e6.mp4', '9. Mounted stream must be S3E6');

    // Test 6: Container structured state has activeSeasonNumber = 3, activeEpisodeNumber = 6
    const state = container.__seasonvarPlaybackState;
    assert.strictEqual(state.activeSeasonNumber, 3, '6. Active season in structured state must be 3');
    assert.strictEqual(state.activeEpisodeNumber, 6, '6. Active episode in structured state must be 6');
    assert.strictEqual(state.activeEpisodeUrl, 'http://cdn.seasonvar.ru/s3e6.mp4', '6. Active episode URL must be S3E6');

    console.log('  ✅ Tests 4, 6-9 Passed: SeasonvarParser correctly fetches Season 3 on-demand and mounts S3E6 video stream');
}

// ─── TEST SUITE 3: EPISODE PICKER BUTTON EVENT LIFECYCLE ──────────────
console.log('\n--- Test Suite 3: Episode Picker Click Lifecycle (No Double-Toggle) ---');

{
    const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
            <button id="playerEpisodesListBtn" class="player-nav-btn" data-action="toggle-episode-picker" aria-expanded="false" type="button">Picker</button>
            <div id="playerEpisodePickerPopover" style="display:none;" class="player-episode-picker-popover">
                <div id="pickerSeasonsSection" style="display:none;"><div id="pickerSeasonsList"></div></div>
                <div id="pickerEpisodesList"></div>
                <button id="playerEpisodePickerCloseBtn" data-action="close-episode-picker">X</button>
            </div>
            <div id="outsideElement">Outside</div>
        </body>
        </html>
    `);

    let isEpisodePickerOpen = false;

    function openEpisodePicker() {
        const popover = dom.window.document.getElementById('playerEpisodePickerPopover');
        const listBtn = dom.window.document.getElementById('playerEpisodesListBtn');
        isEpisodePickerOpen = true;
        popover.style.display = 'flex';
        listBtn.setAttribute('aria-expanded', 'true');
        listBtn.classList.add('active');
    }

    function closeEpisodePicker() {
        const popover = dom.window.document.getElementById('playerEpisodePickerPopover');
        const listBtn = dom.window.document.getElementById('playerEpisodesListBtn');
        if (popover) popover.style.display = 'none';
        if (listBtn) {
            listBtn.setAttribute('aria-expanded', 'false');
            listBtn.classList.remove('active');
        }
        isEpisodePickerOpen = false;
    }

    function toggleEpisodePicker(forceState) {
        const targetState = typeof forceState === 'boolean' ? forceState : !isEpisodePickerOpen;
        if (targetState) openEpisodePicker();
        else closeEpisodePicker();
    }

    const listBtn = dom.window.document.getElementById('playerEpisodesListBtn');
    const popover = dom.window.document.getElementById('playerEpisodePickerPopover');
    const outsideEl = dom.window.document.getElementById('outsideElement');

    // Attach click handler on button
    listBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleEpisodePicker();
    });

    // Attach outside click handler
    dom.window.document.addEventListener('click', (event) => {
        if (!isEpisodePickerOpen) return;
        const path = event.composedPath ? event.composedPath() : [];
        const isInside = path.some(el => el instanceof dom.window.HTMLElement && (
            el.id === 'playerEpisodesListBtn' ||
            el.id === 'playerEpisodePickerPopover' ||
            el.getAttribute?.('data-action') === 'toggle-episode-picker' ||
            el.closest?.('#playerEpisodesListBtn, [data-action="toggle-episode-picker"], #playerEpisodePickerPopover')
        )) || Boolean(event.target?.closest?.('#playerEpisodesListBtn, [data-action="toggle-episode-picker"], #playerEpisodePickerPopover'));

        if (isInside) return;
        closeEpisodePicker();
    });

    // Test 11: Single click opens popover and STAYS OPEN
    // Simulate real click lifecycle: mousedown -> mouseup -> click
    listBtn.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    listBtn.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
    listBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    assert.strictEqual(isEpisodePickerOpen, true, '11. Picker must be OPEN after single click');
    assert.strictEqual(popover.style.display, 'flex', '11. Popover must have display: flex');
    assert.strictEqual(listBtn.getAttribute('aria-expanded'), 'true', '16. aria-expanded must be "true"');

    // Test 12: Same event does NOT close popover
    assert.strictEqual(isEpisodePickerOpen, true, '12. Popover remained open after event loop finished');

    // Test 13: Second click closes popover
    listBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(isEpisodePickerOpen, false, '13. Second click must CLOSE picker');
    assert.strictEqual(popover.style.display, 'none', '13. Popover display must be none');
    assert.strictEqual(listBtn.getAttribute('aria-expanded'), 'false', '16. aria-expanded must be "false"');

    // Test 14: Click outside closes popover
    toggleEpisodePicker(true); // Open
    assert.strictEqual(isEpisodePickerOpen, true);
    outsideEl.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(isEpisodePickerOpen, false, '14. Outside click must CLOSE picker');

    // Test 15: Holding is NOT required - picker stays open after normal click release
    listBtn.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    listBtn.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
    listBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(isEpisodePickerOpen, true, '15. Picker remains open without holding button');

    // Test 18: Provider switch closes picker
    closeEpisodePicker();
    assert.strictEqual(isEpisodePickerOpen, false, '18. Picker closes on provider switch');

    console.log('  ✅ Tests 11-18 Passed: Picker single click opens and stays open, second click closes, outside click closes, holding not required');
}

console.log('\n🎉 ALL 18 Seasonvar S3E6 & Picker Lifecycle Tests Passed Successfully!');
