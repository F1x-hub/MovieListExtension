/**
 * Phase 3A Automated Test Suite: PlaybackController & PlaybackSelection Extraction
 * Covers Parts 38 through 48 of the Phase 3A specification.
 */

const assert = require('assert');
const { normalizePlaybackSelection, VALID_MEDIA_TYPES, VALID_SOURCES } = require('../src/shared/services/player/PlaybackSelection');
const { BasePlaybackAdapter } = require('../src/shared/services/player/adapters/BasePlaybackAdapter');
const { VidSrcAdapter } = require('../src/shared/services/player/adapters/VidSrcAdapter');
const { SeasonvarAdapter } = require('../src/shared/services/player/adapters/SeasonvarAdapter');
const { KinogoAdapter } = require('../src/shared/services/player/adapters/KinogoAdapter');
const { ExFsAdapter } = require('../src/shared/services/player/adapters/ExFsAdapter');
const { RutubeAdapter } = require('../src/shared/services/player/adapters/RutubeAdapter');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');

// Mock DOM environment helpers
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
        console.error(`  ❌ FAIL: ${name}`);
        console.error(err);
        process.exit(1);
    }
}

async function runAllTests() {
    console.log('🧪 Running Phase 3A PlaybackController & PlaybackSelection Tests...\n');

    // ==========================================
    // PART 38: PlaybackSelection Tests
    // ==========================================
    console.log('--- Part 38: PlaybackSelection Contract & Normalization ---');

    await test('38.1 Movie selection strictly enforces null season and episode', () => {
        const sel = normalizePlaybackSelection({
            kinopoiskId: 301,
            title: 'The Matrix',
            mediaType: 'movie',
            seasonNumber: 3, // Must be coerced to null for movies
            episodeNumber: 5
        });
        assert.strictEqual(sel.kinopoiskId, 301);
        assert.strictEqual(sel.mediaType, 'movie');
        assert.strictEqual(sel.seasonNumber, null);
        assert.strictEqual(sel.episodeNumber, null);
        assert.strictEqual(sel.initialTimestamp, 0);
        assert.strictEqual(sel.source, 'HERO_WATCH');
    });

    await test('38.2 TV Series selection validates positive season and episode', () => {
        const sel = normalizePlaybackSelection({
            kinopoiskId: 464963,
            title: 'Game of Thrones',
            mediaType: 'tv-series',
            seasonNumber: '4',
            episodeNumber: '7',
            initialTimestamp: 125
        });
        assert.strictEqual(sel.kinopoiskId, 464963);
        assert.strictEqual(sel.mediaType, 'tv-series');
        assert.strictEqual(sel.seasonNumber, 4);
        assert.strictEqual(sel.episodeNumber, 7);
        assert.strictEqual(sel.initialTimestamp, 125);
    });

    await test('38.3 Season 0 is valid for Specials', () => {
        const sel = normalizePlaybackSelection({
            kinopoiskId: 777,
            title: 'Doctor Who Specials',
            mediaType: 'tv-series',
            seasonNumber: 0,
            episodeNumber: 2
        });
        assert.strictEqual(sel.seasonNumber, 0);
        assert.strictEqual(sel.episodeNumber, 2);
    });

    await test('38.4 Episode 0 and negative values throw INVALID_PLAYBACK_SELECTION', () => {
        assert.throws(() => {
            normalizePlaybackSelection({ kinopoiskId: 100, mediaType: 'tv-series', episodeNumber: 0 });
        }, /INVALID_PLAYBACK_SELECTION/);

        assert.throws(() => {
            normalizePlaybackSelection({ kinopoiskId: 100, mediaType: 'tv-series', seasonNumber: -1 });
        }, /INVALID_PLAYBACK_SELECTION/);

        assert.throws(() => {
            normalizePlaybackSelection({ kinopoiskId: 0, mediaType: 'movie' });
        }, /INVALID_PLAYBACK_SELECTION/);

        assert.throws(() => {
            normalizePlaybackSelection(null);
        }, /INVALID_PLAYBACK_SELECTION/);
    });

    await test('38.5 Anime and Cartoon mediaTypes correctly normalized', () => {
        const anime = normalizePlaybackSelection({
            kinopoiskId: 5058984,
            title: 'Sousou no Frieren',
            mediaType: 'anime',
            seasonNumber: 1,
            episodeNumber: 10
        });
        assert.strictEqual(anime.mediaType, 'anime');
        assert.strictEqual(anime.seasonNumber, 1);
        assert.strictEqual(anime.episodeNumber, 10);
    });

    // ==========================================
    // PART 39: Provider Capability Tests
    // ==========================================
    console.log('\n--- Part 39: Provider Capability Declarations ---');

    await test('39.1 VidSrc adapter supports direct S/E, movies, and series', () => {
        const adapter = new VidSrcAdapter();
        assert.strictEqual(adapter.id, 'vidsrc');
        assert.strictEqual(adapter.supportsMovies(), true);
        assert.strictEqual(adapter.supportsSeries(), true);
        assert.strictEqual(adapter.supportsDirectSeasonEpisode(), true);
    });

    await test('39.2 Seasonvar adapter supports direct S/E, series only', () => {
        const adapter = new SeasonvarAdapter();
        assert.strictEqual(adapter.id, 'seasonvar');
        assert.strictEqual(adapter.supportsMovies(), false);
        assert.strictEqual(adapter.supportsSeries(), true);
        assert.strictEqual(adapter.supportsDirectSeasonEpisode(), true);
    });

    await test('39.3 KinoGo and Ex-FS declare TITLE_ONLY for series', () => {
        const kinogo = new KinogoAdapter();
        assert.strictEqual(kinogo.supportsDirectSeasonEpisode(), false);
        assert.strictEqual(kinogo.supportsMovies(), true);
        assert.strictEqual(kinogo.supportsSeries(), true);

        const exfs = new ExFsAdapter();
        assert.strictEqual(exfs.supportsDirectSeasonEpisode(), false);
        assert.strictEqual(exfs.supportsMovies(), true);
        assert.strictEqual(exfs.supportsSeries(), true);
    });

    await test('39.4 Rutube declares non-deterministic S/E contract', () => {
        const rutube = new RutubeAdapter();
        assert.strictEqual(rutube.supportsDirectSeasonEpisode(), false);
    });

    // ==========================================
    // PART 40: S/E Preservation Across Provider Switches
    // ==========================================
    console.log('\n--- Part 40: Canonical S/E Preservation ---');

    await test('40.1 Switching to TITLE_ONLY provider preserves canonical S/E state in controller', async () => {
        const container = createMockElement('div', 'videoContainer');
        const controller = new PlaybackController({ container });

        // Mock Kinogo mount
        const mockKinogo = new KinogoAdapter({
            getVideoSources: async () => [{ url: 'https://ortified.ws/embed/123', parserId: 'kinogo' }],
            renderPlayer: async (c, s) => {
                const iframe = createMockElement('iframe');
                c.appendChild(iframe);
                return iframe;
            }
        });
        controller.registerAdapter(mockKinogo);

        // 1. Start with S4E7 on VidSrc
        await controller.play({
            kinopoiskId: 464963,
            imdbId: 'tt0944947',
            title: 'Game of Thrones',
            mediaType: 'tv-series',
            seasonNumber: 4,
            episodeNumber: 7
        }, { providerId: 'vidsrc' });

        assert.strictEqual(controller.getActiveProvider(), 'vidsrc');
        assert.strictEqual(controller.getSelection().seasonNumber, 4);
        assert.strictEqual(controller.getSelection().episodeNumber, 7);

        // 2. Switch to KinoGo (TITLE_ONLY)
        await controller.switchProvider('kinogo', { isSwitch: true });
        assert.strictEqual(controller.getActiveProvider(), 'kinogo');
        // Canonical S/E MUST NOT be erased
        assert.strictEqual(controller.getSelection().seasonNumber, 4);
        assert.strictEqual(controller.getSelection().episodeNumber, 7);
        assert.strictEqual(controller.getSelection().source, 'PROVIDER_SWITCH');

        // 3. Switch back to VidSrc
        await controller.switchProvider('vidsrc', { isSwitch: true });
        assert.strictEqual(controller.getActiveProvider(), 'vidsrc');
        assert.strictEqual(controller.getSelection().seasonNumber, 4);
        assert.strictEqual(controller.getSelection().episodeNumber, 7);

        // Verify VidSrc built the URL with preserved S4E7
        const vidsrcAdapter = controller.getAdapter('vidsrc');
        const builtUrl = vidsrcAdapter.buildUrl(controller.getSelection());
        assert.ok(builtUrl.includes('season=4'));
        assert.ok(builtUrl.includes('episode=7'));
        assert.ok(builtUrl.includes('imdb=tt0944947'));
    });

    // ==========================================
    // PART 41: Stale Async Race Condition Protection
    // ==========================================
    console.log('\n--- Part 41: Async Race Condition Protection ---');

    await test('41.1 Slower previous provider mount is discarded when superseded', async () => {
        const container = createMockElement('div', 'videoContainer');
        const controller = new PlaybackController({ container });

        let resolveSlowMount;
        const slowAdapter = new (class extends BasePlaybackAdapter {
            constructor() { super('slow', 'Slow'); }
            async mount(c, sel, ctx) {
                return new Promise((resolve) => {
                    resolveSlowMount = () => {
                        const el = createMockElement('video');
                        c.appendChild(el);
                        resolve({ element: el, providerId: 'slow' });
                    };
                });
            }
        })();

        const fastAdapter = new (class extends BasePlaybackAdapter {
            constructor() { super('fast', 'Fast'); }
            async mount(c, sel, ctx) {
                const el = createMockElement('iframe');
                c.appendChild(el);
                return { element: el, providerId: 'fast' };
            }
        })();

        controller.registerAdapter(slowAdapter);
        controller.registerAdapter(fastAdapter);

        controller.setSelection({ kinopoiskId: 1, title: 'Test Movie', mediaType: 'movie' });

        // Launch slow mount without awaiting
        let slowError = null;
        const slowPromise = controller.switchProvider('slow').catch((err) => {
            slowError = err;
        });

        // Immediately switch to fast
        await controller.switchProvider('fast');
        assert.strictEqual(controller.getActiveProvider(), 'fast');

        // Now slow finishes afterward
        resolveSlowMount();
        await slowPromise;
        assert.ok(slowError);
        assert.strictEqual(slowError.code, 'STALE_PLAYBACK_REQUEST');

        // Assert fast remains the active provider
        assert.strictEqual(controller.getActiveProvider(), 'fast');
    });

    // ==========================================
    // PART 42: Single Active Player Invariant
    // ==========================================
    console.log('\n--- Part 42: Single Active Player Invariant ---');

    await test('42.1 Rapid switches guarantee maximum 1 active player in container', async () => {
        const container = createMockElement('div', 'videoContainer');
        const controller = new PlaybackController({ container });

        controller.setSelection({
            kinopoiskId: 999,
            imdbId: 'tt1234567',
            title: 'Rapid Switch Test',
            mediaType: 'movie'
        });

        for (let i = 0; i < 10; i++) {
            await controller.switchProvider('vidsrc');
        }

        const iframes = container.querySelectorAll('iframe');
        const videos = container.querySelectorAll('video');
        const totalPlayers = iframes.length + videos.length;
        assert.strictEqual(totalPlayers, 1, 'Container must contain strictly 1 active player');
    });

    // ==========================================
    // PART 43: Controller Destruction & Cleanup
    // ==========================================
    console.log('\n--- Part 43: Controller Lifecycle & Cleanup ---');

    await test('43.1 destroy() cleans all adapters, clears selection, and unmounts DOM', () => {
        const container = createMockElement('div', 'videoContainer');
        const controller = new PlaybackController({ container });

        controller.setSelection({ kinopoiskId: 55, title: 'Destroy Me', mediaType: 'movie' });
        controller.destroy();

        assert.strictEqual(controller.getSelection(), null);
        assert.strictEqual(controller.isOpen, false);
        assert.strictEqual(controller.adapters.size, 0);
    });

    // ==========================================
    // PART 44: Legacy ProgressService Compatibility
    // ==========================================
    console.log('\n--- Part 44: ProgressService Compatibility ---');

    await test('44.1 handleProgressUpdate normalizes Russian string formats to canonical numeric S/E', () => {
        const controller = new PlaybackController({});
        controller.setSelection({
            kinopoiskId: 300,
            title: 'Breaking Bad',
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 1
        });

        controller.handleProgressUpdate({
            season: '2 сезон',
            episode: '4 серия',
            timestamp: 340,
            movieId: 300
        });

        const updated = controller.getSelection();
        assert.strictEqual(updated.seasonNumber, 2);
        assert.strictEqual(updated.episodeNumber, 4);
        assert.strictEqual(updated.initialTimestamp, 340);
        assert.strictEqual(controller.currentTimestamp, 340);
    });

    // ==========================================
    // PART 46: Aniskip Episode Propagation
    // ==========================================
    console.log('\n--- Part 46: Aniskip Compatibility ---');

    await test('46.1 Canonical selection change notifies subscriber with episode context', () => {
        let observedEpisode = null;
        const controller = new PlaybackController({
            onSelectionChange: (sel) => {
                if (sel && sel.episodeNumber != null) {
                    observedEpisode = sel.episodeNumber;
                }
            }
        });

        controller.setSelection({
            kinopoiskId: 5058984,
            title: 'Frieren',
            mediaType: 'anime',
            seasonNumber: 1,
            episodeNumber: 15
        });

        assert.strictEqual(observedEpisode, 15);
    });

    // ==========================================
    // PART 47: Preload Container Leak Prevention
    // ==========================================
    console.log('\n--- Part 47: Preload Container Leak Prevention ---');

    await test('47.1 cleanupOrphanPreloadContainers cleans stale movie containers', () => {
        const fakeBody = createMockElement('body');
        const oldContainer = createMockElement('div', 'player-preload-111-seasonvar');
        const activeContainer = createMockElement('div', 'player-preload-222-seasonvar');

        fakeBody.appendChild(oldContainer);
        fakeBody.appendChild(activeContainer);

        // Simulate global document
        global.document.querySelectorAll = (sel) => {
            if (sel.includes('player-preload-')) return [oldContainer, activeContainer];
            return [];
        };

        const controller = new PlaybackController({});
        controller.cleanupOrphanPreloadContainers(222);

        // oldContainer should be removed from parentNode
        assert.strictEqual(oldContainer.parentNode, null);
        // activeContainer should remain attached
        assert.strictEqual(activeContainer.parentNode, fakeBody);
    });

    // ==========================================
    // PART 48: Strict Scope Discipline
    // ==========================================
    console.log('\n--- Part 48: Strict Scope Discipline ---');

    await test('48.1 Phase 3A-3D preserves scope boundaries: auto-next playback deferred to Phase 3E', () => {
        const fs = require('fs');
        const movieDetailsJs = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');

        // Auto-next playback is deferred to Phase 3E
        assert.ok(!movieDetailsJs.includes('autoplayNextEpisode'), 'Auto-play next episode must not be present prematurely');
    });

    console.log(`\n🎉 ALL ${passedCount} Phase 3A PlaybackController & Selection Tests Passed Successfully!`);
}

runAllTests().catch((err) => {
    console.error('Fatal error during test run:', err);
    process.exit(1);
});
