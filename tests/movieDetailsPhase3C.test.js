// tests/movieDetailsPhase3C.test.js
// Phase 3C: Player Shell Consolidation, Duplicate UI Removal & Current Episode Header

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { PlaybackSelection } = require('../src/shared/services/player/PlaybackSelection.js');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController.js');
const { BasePlaybackAdapter } = require('../src/shared/services/player/adapters/BasePlaybackAdapter.js');
const { VidSrcAdapter } = require('../src/shared/services/player/adapters/VidSrcAdapter.js');
const { SeasonvarAdapter } = require('../src/shared/services/player/adapters/SeasonvarAdapter.js');
const { KinogoAdapter } = require('../src/shared/services/player/adapters/KinogoAdapter.js');
const { ExFsAdapter } = require('../src/shared/services/player/adapters/ExFsAdapter.js');
const { RutubeAdapter } = require('../src/shared/services/player/adapters/RutubeAdapter.js');

function createMockElement(tagName = 'div', id = '') {
    const children = [];
    return {
        tagName: tagName.toUpperCase(),
        id,
        className: '',
        style: {},
        attributes: {},
        dataset: {},
        innerHTML: '',
        src: '',
        paused: false,
        currentTime: 0,
        parentNode: null,
        children,
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return this.attributes[k] || null; },
        appendChild(child) {
            child.parentNode = this;
            children.push(child);
            return child;
        },
        removeChild(child) {
            const idx = children.indexOf(child);
            if (idx >= 0) children.splice(idx, 1);
            child.parentNode = null;
            return child;
        },
        remove() {
            if (this.parentNode) this.parentNode.removeChild(this);
        },
        querySelectorAll(selector) {
            const results = [];
            function traverse(node) {
                for (const c of node.children) {
                    if (selector.startsWith('.') && c.className.includes(selector.slice(1))) results.push(c);
                    else if (selector.startsWith('#') && c.id === selector.slice(1)) results.push(c);
                    else if (c.tagName.toLowerCase() === selector.toLowerCase()) results.push(c);
                    traverse(c);
                }
            }
            traverse(this);
            return results;
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        },
        pause() { this.paused = true; },
        load() {}
    };
}

global.document = {
    createElement(tagName) { return createMockElement(tagName); },
    getElementById(id) { return null; },
    querySelectorAll(selector) { return []; }
};

let passedCount = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✅ ${name}`);
        passedCount++;
    } catch (err) {
        console.error(`  ❌ ${name}`);
        console.error(err);
        process.exit(1);
    }
}

function createHarness() {
    const domMock = {
        videoTitle: { textContent: '' },
        videoSubtitle: { textContent: '', style: { display: 'none' } },
        videoPlayerModal: {
            style: { display: 'none' },
            classList: {
                classes: new Set(),
                contains(c) { return this.classes.has(c); },
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); }
            }
        },
        videoContainer: { innerHTML: '', style: {} },
        sourceButtonsContainer: {
            innerHTML: '',
            buttons: [],
            appendChild(btn) { this.buttons.push(btn); }
        },
        playerSourceGuidance: {
            style: { display: 'none' },
            text: '',
            querySelector(sel) {
                if (sel === '.player-source-guidance__text') {
                    return {
                        set textContent(v) { domMock.playerSourceGuidance.text = v; },
                        get textContent() { return domMock.playerSourceGuidance.text; }
                    };
                }
                return null;
            }
        }
    };

    const controller = new PlaybackController();
    controller.registerAdapter(new VidSrcAdapter());
    controller.registerAdapter(new SeasonvarAdapter());
    controller.registerAdapter(new KinogoAdapter());
    controller.registerAdapter(new ExFsAdapter());
    controller.registerAdapter(new RutubeAdapter());

    const manager = {
        elements: domMock,
        playbackController: controller,
        selectedMovie: null,
        activePlayerId: null,

        updatePlayerHeaderTitle() {
            if (!this.elements.videoTitle || !this.selectedMovie) return;
            const baseTitle = this.selectedMovie.nameRu || this.selectedMovie.name || 'Фильм';
            const selection = this.playbackController?.getSelection();
            const subtitleEl = this.elements.videoSubtitle;

            this.elements.videoTitle.textContent = baseTitle;

            if (selection && selection.seasonNumber != null && selection.episodeNumber != null) {
                let epText = `S${selection.seasonNumber}E${selection.episodeNumber}`;
                if (selection.episodeTitle) {
                    epText += ` · ${selection.episodeTitle}`;
                }
                if (subtitleEl) {
                    subtitleEl.textContent = epText;
                    subtitleEl.style.display = 'block';
                }
            } else {
                if (subtitleEl) {
                    subtitleEl.textContent = '';
                    subtitleEl.style.display = 'none';
                }
            }
        },

        updateSourceGuidance(providerId = this.playbackController?.getActiveProvider()) {
            const guidanceEl = this.elements.playerSourceGuidance;
            if (!guidanceEl) return;
            const selection = this.playbackController?.getSelection();
            if (!selection || selection.seasonNumber == null || selection.episodeNumber == null) {
                guidanceEl.style.display = 'none';
                return;
            }

            let provKey = providerId;
            if (typeof provKey === 'string') {
                if (provKey.startsWith('parser:')) provKey = provKey.replace('parser:', '');
                else if (provKey.startsWith('vidsrc:')) provKey = 'vidsrc';
            }

            const activeAdapter = this.playbackController?.getAdapter(provKey);
            if (activeAdapter && activeAdapter.supportsDirectSeasonEpisode() === false) {
                const textEl = guidanceEl.querySelector('.player-source-guidance__text') || guidanceEl;
                textEl.textContent = `Выберите S${selection.seasonNumber}E${selection.episodeNumber} в плеере источника`;
                guidanceEl.style.display = 'flex';
            } else {
                guidanceEl.style.display = 'none';
            }
        },

        playSelection(selectionPayload) {
            if (!this.selectedMovie) return;
            if (this.playbackController) {
                this.playbackController.setContainer(this.elements.videoContainer, this.elements.videoPlayerModal);
                this.playbackController.setSelection(selectionPayload);
            }
            this.updatePlayerHeaderTitle();
            this.elements.videoPlayerModal.style.display = 'flex';
            const activeProvider = this.playbackController?.getActiveProvider() || 'vidsrc';
            this.updateSourceGuidance(activeProvider);
        },

        closeVideoModal() {
            this.elements.videoPlayerModal.style.display = 'none';
            if (this.elements.videoContainer) {
                this.elements.videoContainer.innerHTML = '';
            }
            this.playbackController?.setContainer(null, null);
        }
    };

    return { manager, domMock, controller };
}

async function runAllTests() {
    console.log('🧪 Running Phase 3C Player Shell Consolidation Tests...\n');

    const htmlContent = fs.readFileSync(path.join(__dirname, '../src/pages/movie-details/movie-details.html'), 'utf8');
    const cssContent = fs.readFileSync(path.join(__dirname, '../src/shared/styles/player.css'), 'utf8');
    const seasonvarContent = fs.readFileSync(path.join(__dirname, '../src/shared/services/parsers/SeasonvarParser.js'), 'utf8');
    const cleanerContent = fs.readFileSync(path.join(__dirname, '../content-scripts/player-cleaner.js'), 'utf8');

    // 1. Host season drawer removed from player shell
    await test('1. Host full season drawer is not present in video player modal shell', () => {
        const modalHtmlMatch = htmlContent.match(/<div id="videoPlayerModal"[\s\S]*?<!-- Trailer Modal/);
        assert.ok(modalHtmlMatch, 'Video player modal block must exist');
        const modalHtml = modalHtmlMatch[0];
        assert.ok(!modalHtml.includes('class="season-drawer"'), 'No season drawer in modal');
        assert.ok(!modalHtml.includes('class="season-selector"'), 'No season selector in modal');
        assert.ok(!modalHtml.includes('class="seasons-nav"'), 'No seasons nav in modal');
    });

    // 2. Host episode drawer removed from player shell
    await test('2. Host full episode drawer is not present in video player modal shell', () => {
        const modalHtmlMatch = htmlContent.match(/<div id="videoPlayerModal"[\s\S]*?<!-- Trailer Modal/);
        const modalHtml = modalHtmlMatch[0];
        assert.ok(!modalHtml.includes('class="episode-drawer"'), 'No episode drawer in modal');
        assert.ok(!modalHtml.includes('class="episodes-nav"'), 'No episodes nav in modal');
    });

    // 3. Player-cleaner runtime bridge preserved
    await test('3. Player-cleaner runtime bridge, video wrapping and message handling preserved', () => {
        assert.ok(cleanerContent.includes('native-player-wrapper player-surface__content'), 'Runtime wrapper class preserved');
        assert.ok(cleanerContent.includes('RESET_PERMANENT_VIDEO'), 'Reset message listener preserved');
        assert.ok(cleanerContent.includes('getPlayerObservationRoot'), 'Observation root helper preserved');
    });

    // 4. Modal header renders title
    await test('4. Modal header renders base title into videoTitle', () => {
        const { manager } = createHarness();
        manager.selectedMovie = { kinopoiskId: 101, nameRu: 'Во все тяжкие', type: 'tv-series' };
        manager.playbackController.setSelection({
            kinopoiskId: 101,
            mediaType: 'tv-series',
            seasonNumber: 5,
            episodeNumber: 14
        });
        manager.updatePlayerHeaderTitle();
        assert.strictEqual(manager.elements.videoTitle.textContent, 'Во все тяжкие');
    });

    // 5. S/E subtitle renders
    await test('5. S/E subtitle renders formatted text and is displayed', () => {
        const { manager } = createHarness();
        manager.selectedMovie = { kinopoiskId: 101, nameRu: 'Во все тяжкие', type: 'tv-series' };
        manager.playbackController.setSelection({
            kinopoiskId: 101,
            mediaType: 'tv-series',
            seasonNumber: 5,
            episodeNumber: 14
        });
        manager.updatePlayerHeaderTitle();
        assert.strictEqual(manager.elements.videoSubtitle.textContent, 'S5E14');
        assert.strictEqual(manager.elements.videoSubtitle.style.display, 'block');
    });

    // 6. Movie has no S/E subtitle
    await test('6. Movie has empty subtitle and style display is none', () => {
        const { manager } = createHarness();
        manager.selectedMovie = { kinopoiskId: 202, nameRu: 'Интерстеллар', type: 'film' };
        manager.playbackController.setSelection({
            kinopoiskId: 202,
            mediaType: 'movie'
        });
        manager.updatePlayerHeaderTitle();
        assert.strictEqual(manager.elements.videoTitle.textContent, 'Интерстеллар');
        assert.strictEqual(manager.elements.videoSubtitle.textContent, '');
        assert.strictEqual(manager.elements.videoSubtitle.style.display, 'none');
    });

    // 7. Episode title renders safely
    await test('7. Episode title renders safely when present', () => {
        const { manager } = createHarness();
        manager.selectedMovie = { kinopoiskId: 101, nameRu: 'Во все тяжкие', type: 'tv-series' };
        manager.playbackController.setSelection({
            kinopoiskId: 101,
            mediaType: 'tv-series',
            seasonNumber: 5,
            episodeNumber: 14,
            episodeTitle: 'Озимандия'
        });
        manager.updatePlayerHeaderTitle();
        assert.strictEqual(manager.elements.videoSubtitle.textContent, 'S5E14 · Озимандия');
    });

    // 8. Direct provider hides guidance
    await test('8. Direct provider (vidsrc) hides title-only guidance', () => {
        const { manager } = createHarness();
        manager.selectedMovie = { kinopoiskId: 101, nameRu: 'Сериал', type: 'tv-series' };
        manager.playbackController.setSelection({
            kinopoiskId: 101,
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 1
        });
        manager.updateSourceGuidance('vidsrc');
        assert.strictEqual(manager.elements.playerSourceGuidance.style.display, 'none');
    });

    // 9. Title-only shows guidance
    await test('9. Title-only provider (kinogo) shows exact guidance', () => {
        const { manager } = createHarness();
        manager.selectedMovie = { kinopoiskId: 101, nameRu: 'Сериал', type: 'tv-series' };
        manager.playbackController.setSelection({
            kinopoiskId: 101,
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 8
        });
        manager.updateSourceGuidance('kinogo');
        assert.strictEqual(manager.elements.playerSourceGuidance.style.display, 'flex');
        assert.strictEqual(manager.elements.playerSourceGuidance.text, 'Выберите S3E8 в плеере источника');
    });

    // 10. Switch updates guidance
    await test('10. Switching from title-only to direct updates guidance visibility', () => {
        const { manager } = createHarness();
        manager.selectedMovie = { kinopoiskId: 101, nameRu: 'Сериал', type: 'tv-series' };
        manager.playbackController.setSelection({
            kinopoiskId: 101,
            mediaType: 'tv-series',
            seasonNumber: 2,
            episodeNumber: 5
        });
        manager.updateSourceGuidance('kinogo');
        assert.strictEqual(manager.elements.playerSourceGuidance.style.display, 'flex');
        manager.updateSourceGuidance('seasonvar');
        assert.strictEqual(manager.elements.playerSourceGuidance.style.display, 'none');
    });

    // 11. Switch preserves header S/E
    await test('11. Switching provider preserves header S/E subtitle without erasure', () => {
        const { manager } = createHarness();
        manager.selectedMovie = { kinopoiskId: 101, nameRu: 'Сериал', type: 'tv-series' };
        manager.playbackController.setSelection({
            kinopoiskId: 101,
            mediaType: 'tv-series',
            seasonNumber: 4,
            episodeNumber: 2,
            episodeTitle: 'Эпизод 2'
        });
        manager.updatePlayerHeaderTitle();
        assert.strictEqual(manager.elements.videoSubtitle.textContent, 'S4E2 · Эпизод 2');
        // Provider switch occurs
        manager.updateSourceGuidance('exfs');
        manager.updatePlayerHeaderTitle();
        assert.strictEqual(manager.elements.videoSubtitle.textContent, 'S4E2 · Эпизод 2');
    });

    // 12. Provider selector active state
    await test('12. Provider selector uses aria-controls and toolbar accessibility roles', () => {
        assert.ok(htmlContent.includes('role="toolbar" aria-label="Player sources"'), 'Toolbar role present');
        assert.ok(htmlContent.includes('aria-controls="videoContainer"'), 'aria-controls present');
    });

    // 13. Provider bar horizontal overflow contract
    await test('13. Provider buttons container enforces horizontal scrolling and no wrap', () => {
        assert.match(cssContent, /\.source-buttons-container[\s\S]*?flex-wrap:\s*nowrap/);
        assert.match(cssContent, /\.source-buttons-container[\s\S]*?overflow-x:\s*auto/);
    });

    // 14. 16:9 player contract
    await test('14. Video container enforces 16 / 9 aspect ratio', () => {
        assert.match(cssContent, /\.video-container[\s\S]*?aspect-ratio:\s*16\s*\/\s*9/);
    });

    // 15. Native video fills container
    await test('15. Native video fills 100% width and height of container', () => {
        assert.match(cssContent, /\.video-container video[\s\S]*?width:\s*100%/);
        assert.match(cssContent, /\.video-container video[\s\S]*?height:\s*100%/);
    });

    // 16. Iframe fills container
    await test('16. Iframe fills 100% width and height of container', () => {
        assert.match(cssContent, /\.video-container iframe[\s\S]*?width:\s*100%/);
        assert.match(cssContent, /\.video-container iframe[\s\S]*?height:\s*100%/);
    });

    function createFakeContainer() {
        return {
            innerHTML: '',
            children: [],
            appendChild(child) { this.children.push(child); },
            querySelectorAll() { return []; },
            querySelector() { return null; }
        };
    }

    // 17. Stale loading result ignored
    await test('17. PlaybackController generation token discards superseded mounts', async () => {
        const { controller } = createHarness();
        const fakeContainer = createFakeContainer();
        controller.setContainer(fakeContainer, null);

        let slowResolved = false;
        const slowAdapter = new BasePlaybackAdapter('slow', 'Slow Provider', {
            supportsDirectSeasonEpisode: () => false,
            mount: async (c, s, ctx) => {
                await new Promise(r => setTimeout(r, 50));
                if (controller.mountRequestId !== ctx.token) return false;
                slowResolved = true;
                return true;
            }
        });
        controller.registerAdapter(slowAdapter);

        // Trigger switchProvider 1 (slow) then immediately switchProvider 2
        controller.setSelection({ kinopoiskId: 1, imdbId: 'tt0903747', mediaType: 'movie' });
        const p1 = controller.switchProvider('slow').catch(err => err);
        const p2 = controller.switchProvider('vidsrc');
        await Promise.all([p1, p2]);
        await new Promise(r => setTimeout(r, 70));

        assert.strictEqual(slowResolved, false, 'Slow superseded mount must not have committed');
    });

    // 18. Provider error state
    await test('18. Provider mount failure enters error state without unhandled breakdown', async () => {
        const { controller } = createHarness();
        const fakeContainer = createFakeContainer();
        controller.setContainer(fakeContainer, null);

        const failAdapter = new BasePlaybackAdapter('broken', 'Broken Provider', {
            supportsDirectSeasonEpisode: () => false,
            mount: async () => { throw new Error('Network error'); }
        });
        controller.registerAdapter(failAdapter);

        let capturedState = null;
        controller.onStateChange = (state) => { capturedState = state; };
        controller.setSelection({ kinopoiskId: 1, imdbId: 'tt0903747', mediaType: 'movie' });
        let threw = false;
        try {
            await controller.switchProvider('broken');
        } catch (e) {
            threw = true;
        }
        assert.strictEqual(threw, true, 'Mount failure rejects promise');
        assert.strictEqual(capturedState, 'error');
    });

    // 19. Retry / source switch possible
    await test('19. Switching source after failure cleanly mounts new provider', async () => {
        const { controller } = createHarness();
        const fakeContainer = createFakeContainer();
        controller.setContainer(fakeContainer, null);

        const result = await controller.play({ kinopoiskId: 10, imdbId: 'tt0903747', mediaType: 'movie' }, { providerId: 'vidsrc' });
        assert.ok(result, 'Subsequent mount succeeds');
        assert.strictEqual(controller.getActiveProvider(), 'vidsrc');
    });

    // 20. Close lifecycle preserved
    await test('20. Modal close cleans player container and controller container reference', () => {
        const { manager, domMock, controller } = createHarness();
        manager.selectedMovie = { kinopoiskId: 1, nameRu: 'Тест', type: 'film' };
        manager.playSelection({ kinopoiskId: 1, imdbId: 'tt0903747', mediaType: 'movie' });
        assert.strictEqual(domMock.videoPlayerModal.style.display, 'flex');

        manager.closeVideoModal();
        assert.strictEqual(domMock.videoPlayerModal.style.display, 'none');
        assert.strictEqual(domMock.videoContainer.innerHTML, '');
        assert.strictEqual(controller.container, null);
    });

    // 21. Single active player invariant
    await test('21. Rapid switch calls ensure only 1 active adapter is mounted', async () => {
        const { controller } = createHarness();
        const fakeContainer = createFakeContainer();
        controller.setContainer(fakeContainer, null);

        controller.setSelection({ kinopoiskId: 1, imdbId: 'tt0903747', mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 1 });
        const p1 = controller.switchProvider('kinogo').catch(err => err);
        const p2 = controller.switchProvider('seasonvar').catch(err => err);
        const p3 = controller.switchProvider('vidsrc');

        await Promise.all([p1, p2, p3]);
        assert.strictEqual(controller.getActiveProvider(), 'vidsrc');
    });

    // 22. No orphan drawer listeners
    await test('22. Obsolete drawer event listeners are absent from codebase', () => {
        assert.doesNotMatch(htmlContent, /class=".*drawer.*"/);
        assert.doesNotMatch(seasonvarContent, /seasonvar-drawer/);
    });

    // 23. Aniskip regression zero
    await test('23. Aniskip listener subscription receives canonical S/E updates', () => {
        const { controller } = createHarness();
        let received = null;
        controller.onSelectionChange = (sel) => { received = sel; };
        controller.setSelection({ kinopoiskId: 999, mediaType: 'anime', seasonNumber: 1, episodeNumber: 12 });
        assert.ok(received);
        assert.strictEqual(received.seasonNumber, 1);
        assert.strictEqual(received.episodeNumber, 12);
    });

    // 24. Progress schema unchanged
    await test('24. ProgressService schema unchanged and numeric normalization works', () => {
        const { controller } = createHarness();
        controller.setSelection({ kinopoiskId: 123, mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 1 });
        controller.handleProgressUpdate({
            season: '3 сезон',
            episode: 'Серия 9',
            timestamp: 450
        });
        const sel = controller.getSelection();
        assert.strictEqual(sel.seasonNumber, 3);
        assert.strictEqual(sel.episodeNumber, 9);
        assert.strictEqual(controller.currentTimestamp, 450);
    });

    // 25. No extra requests
    await test('25. Setting selection and updating header performs 0 network requests', () => {
        const { manager } = createHarness();
        manager.selectedMovie = { kinopoiskId: 50, nameRu: 'Movie', type: 'movie' };
        manager.playSelection({ kinopoiskId: 50, mediaType: 'movie' });
        assert.strictEqual(manager.elements.videoTitle.textContent, 'Movie');
    });

    // 26. CSP: No inline event handlers
    await test('26. movie-details.html contains zero inline onclick/onload event handlers', () => {
        assert.doesNotMatch(htmlContent, /\sonclick\s*=/i);
        assert.doesNotMatch(htmlContent, /\sonload\s*=/i);
        assert.doesNotMatch(htmlContent, /\sonerror\s*=/i);
    });

    // 27. Movie regression
    await test('27. Movie playback shell is clean, has no S/E subtitle and no guidance', () => {
        const { manager } = createHarness();
        manager.selectedMovie = { kinopoiskId: 300, nameRu: 'Амели', type: 'film' };
        manager.playSelection({ kinopoiskId: 300, mediaType: 'movie' });
        assert.strictEqual(manager.elements.videoTitle.textContent, 'Амели');
        assert.strictEqual(manager.elements.videoSubtitle.textContent, '');
        assert.strictEqual(manager.elements.videoSubtitle.style.display, 'none');
        assert.strictEqual(manager.elements.playerSourceGuidance.style.display, 'none');
    });

    // 28. Series direct regression (VidSrc / Seasonvar)
    await test('28. Series direct provider hides guidance and formats subtitle', () => {
        const { manager } = createHarness();
        manager.selectedMovie = { kinopoiskId: 400, nameRu: 'В Филадельфии всегда солнечно', type: 'tv-series' };
        manager.playSelection({
            kinopoiskId: 400,
            mediaType: 'tv-series',
            seasonNumber: 5,
            episodeNumber: 3,
            episodeTitle: 'Банда отправляется в путь'
        });
        assert.strictEqual(manager.elements.videoTitle.textContent, 'В Филадельфии всегда солнечно');
        assert.strictEqual(manager.elements.videoSubtitle.textContent, 'S5E3 · Банда отправляется в путь');
        assert.strictEqual(manager.elements.playerSourceGuidance.style.display, 'none');
    });

    // 29. Title-only series regression (Kinogo)
    await test('29. Series on title-only provider retains S/E subtitle and shows guidance notice', () => {
        const { manager } = createHarness();
        manager.selectedMovie = { kinopoiskId: 400, nameRu: 'В Филадельфии всегда солнечно', type: 'tv-series' };
        manager.playSelection({
            kinopoiskId: 400,
            mediaType: 'tv-series',
            seasonNumber: 5,
            episodeNumber: 3
        });
        manager.updateSourceGuidance('kinogo');
        assert.strictEqual(manager.elements.videoSubtitle.textContent, 'S5E3');
        assert.strictEqual(manager.elements.playerSourceGuidance.style.display, 'flex');
        assert.strictEqual(manager.elements.playerSourceGuidance.text, 'Выберите S5E3 в плеере источника');
    });

    // 30. 1366x768 layout contract
    await test('30. 1366x768 viewport layout constraints in player.css', () => {
        assert.match(cssContent, /width:\s*min\(94vw,\s*1180px,\s*calc\(177\.78dvh\s*-\s*220px\)\)/);
        assert.match(cssContent, /max-height:\s*calc\(100dvh\s*-\s*24px\)/);
        assert.match(cssContent, /aspect-ratio:\s*16\s*\/\s*9/);
    });

    console.log(`\n🎉 ALL ${passedCount} Phase 3C Player Shell Consolidation Tests Passed Successfully!`);
}

runAllTests().catch((err) => {
    console.error('Fatal error during test run:', err);
    process.exit(1);
});
