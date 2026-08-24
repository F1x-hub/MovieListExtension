/**
 * MovieDetails Phase 3G Test Suite:
 * Capability-Gated Auto-Next Prompt, Reliable Ended Countdown, and Interruption Lifecycle.
 */

const assert = require('assert');

// Mock localStorage and window
global.localStorage = {
    _data: {},
    getItem(key) { return this._data[key] || null; },
    setItem(key, val) { this._data[key] = String(val); },
    removeItem(key) { delete this._data[key]; },
    clear() { this._data = {}; }
};

global.window = {
    localStorage: global.localStorage
};

// Import modules
const { normalizePlaybackSelection, resolveAdjacentEpisode, resolveWatchTarget, VALID_SOURCES } = require('../src/shared/services/player/PlaybackSelection');
const { createDefaultPlaybackRuntimeState, isPlaybackCompleted, canAutoNext, normalizeProgressRecord } = require('../src/shared/services/player/PlaybackRuntime');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');
const { AutoNextCoordinator } = require('../src/shared/services/player/AutoNextCoordinator');
const { SeasonvarAdapter } = require('../src/shared/services/player/adapters/SeasonvarAdapter');
const { VidSrcAdapter } = require('../src/shared/services/player/adapters/VidSrcAdapter');
const { KinogoAdapter } = require('../src/shared/services/player/adapters/KinogoAdapter');
const { ExFsAdapter } = require('../src/shared/services/player/adapters/ExFsAdapter');
const { RutubeAdapter } = require('../src/shared/services/player/adapters/RutubeAdapter');

// Mock DOM elements
function createMockElement(id, tagName = 'div') {
    const listeners = {};
    return {
        id,
        tagName,
        style: { display: 'none' },
        textContent: '',
        disabled: false,
        title: '',
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k] || null; },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        appendChild() {},
        removeChild() {},
        addEventListener(event, fn) {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
        },
        removeEventListener(event, fn) {
            if (listeners[event]) {
                listeners[event] = listeners[event].filter(cb => cb !== fn);
            }
        },
        click() {
            if (listeners['click']) {
                listeners['click'].forEach(fn => fn({ preventDefault: () => {} }));
            }
        }
    };
}

// Sample series fixture
const mockSeries = {
    kinopoiskId: 301,
    name: 'The Matrix Series',
    type: 'tv-series',
    isSeries: true,
    seasons: [
        {
            season_number: 0,
            episodes: [
                { episode_number: 1, name: 'Special Behind The Scenes 1', air_date: '2020-01-01' },
                { episode_number: 2, name: 'Special Behind The Scenes 2', air_date: '2020-01-02' },
                { episode_number: 3, name: 'Special Behind The Scenes 3', air_date: '2020-01-03' }
            ]
        },
        {
            season_number: 1,
            episodes: [
                { episode_number: 1, name: 'Pilot', air_date: '2020-02-01' },
                { episode_number: 2, name: 'Episode 2', air_date: '2020-02-08' },
                { episode_number: 3, name: 'Season 1 Finale', air_date: '2020-02-15' }
            ]
        },
        {
            season_number: 2,
            episodes: [
                { episode_number: 1, name: 'Season 2 Premiere', air_date: '2021-03-01' },
                { episode_number: 2, name: 'Season 2 Finale', air_date: '2021-03-08' }
            ]
        },
        {
            season_number: 3,
            episodes: [
                { episode_number: 1, name: 'Season 3 Premiere', air_date: '2022-01-01' },
                { episode_number: 2, name: 'Future Unreleased', air_date: '2099-01-01' } // Future
            ]
        }
    ]
};

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (e) {
        console.error(`  ✗ ${description}`);
        console.error(e);
        failed++;
    }
}

console.log('\n--- MOVIEDETAILS PHASE 3G TEST SUITE ---');

// =========================================================================
// Section 1: Auto-Next Eligibility & Provider Gating (canAutoNext)
// =========================================================================
console.log('\n[Section 1: Auto-Next Eligibility & Provider Gating]');

test('1. Seasonvar ended + next released series episode is eligible (true)', () => {
    const selection = { mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 1, providerId: 'seasonvar' };
    const runtime = { progressConfidence: 'RELIABLE', isEnded: true, currentTime: 2400, duration: 2400 };
    const adapter = new SeasonvarAdapter();
    const nextEp = { seasonNumber: 1, episodeNumber: 2, isReleased: true };

    const result = canAutoNext({ selection, runtime, providerCapabilities: adapter, nextEpisode: nextEp });
    assert.strictEqual(result, true);
});

test('2. Seasonvar 90% completion but isEnded === false is NOT eligible for auto-next prompt (false)', () => {
    const selection = { mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 1, providerId: 'seasonvar' };
    const runtime = { progressConfidence: 'RELIABLE', isEnded: false, currentTime: 2160, duration: 2400 }; // 90%
    const adapter = new SeasonvarAdapter();
    const nextEp = { seasonNumber: 1, episodeNumber: 2, isReleased: true };

    // Progress may be completed, but auto-next requires actual isEnded === true!
    assert.strictEqual(isPlaybackCompleted(runtime), true);
    assert.strictEqual(canAutoNext({ selection, runtime, providerCapabilities: adapter, nextEpisode: nextEp }), false);
});

test('3. Seasonvar ended + future next episode is NOT eligible (false)', () => {
    const selection = { mediaType: 'tv-series', seasonNumber: 3, episodeNumber: 1, providerId: 'seasonvar' };
    const runtime = { progressConfidence: 'RELIABLE', isEnded: true, currentTime: 2400, duration: 2400 };
    const adapter = new SeasonvarAdapter();
    const nextEp = { seasonNumber: 3, episodeNumber: 2, isReleased: false }; // Unreleased

    const result = canAutoNext({ selection, runtime, providerCapabilities: adapter, nextEpisode: nextEp });
    assert.strictEqual(result, false);
});

test('4. Series finale (no next episode) is NOT eligible (false)', () => {
    const selection = { mediaType: 'tv-series', seasonNumber: 2, episodeNumber: 2, providerId: 'seasonvar' };
    const runtime = { progressConfidence: 'RELIABLE', isEnded: true, currentTime: 2400, duration: 2400 };
    const adapter = new SeasonvarAdapter();

    const result = canAutoNext({ selection, runtime, providerCapabilities: adapter, nextEpisode: null });
    assert.strictEqual(result, false);
});

test('5. Movies are NEVER eligible for Auto-Next (false)', () => {
    const selection = { mediaType: 'movie', seasonNumber: null, episodeNumber: null, providerId: 'seasonvar' };
    const runtime = { progressConfidence: 'RELIABLE', isEnded: true, currentTime: 7200, duration: 7200 };
    const adapter = new SeasonvarAdapter();
    const nextEp = { seasonNumber: 1, episodeNumber: 2, isReleased: true };

    const result = canAutoNext({ selection, runtime, providerCapabilities: adapter, nextEpisode: nextEp });
    assert.strictEqual(result, false);
});

test('6. VidSrc (ended unsupported / OPAQUE) is NOT eligible (false)', () => {
    const selection = { mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 1, providerId: 'vidsrc' };
    const runtime = { progressConfidence: 'OPAQUE', isEnded: true, currentTime: 0, duration: 0 };
    const adapter = new VidSrcAdapter();
    const nextEp = { seasonNumber: 1, episodeNumber: 2, isReleased: true };

    const result = canAutoNext({ selection, runtime, providerCapabilities: adapter, nextEpisode: nextEp });
    assert.strictEqual(result, false);
});

test('7. KinoGo (PARTIAL) is NOT eligible (false)', () => {
    const selection = { mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 1, providerId: 'kinogo' };
    const runtime = { progressConfidence: 'PARTIAL', isEnded: true, currentTime: 2400, duration: 2400 };
    const adapter = new KinogoAdapter();
    const nextEp = { seasonNumber: 1, episodeNumber: 2, isReleased: true };

    const result = canAutoNext({ selection, runtime, providerCapabilities: adapter, nextEpisode: nextEp });
    assert.strictEqual(result, false);
});

test('8. Ex-FS (PARTIAL) is NOT eligible (false)', () => {
    const selection = { mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 1, providerId: 'exfs' };
    const runtime = { progressConfidence: 'PARTIAL', isEnded: true, currentTime: 2400, duration: 2400 };
    const adapter = new ExFsAdapter();
    const nextEp = { seasonNumber: 1, episodeNumber: 2, isReleased: true };

    const result = canAutoNext({ selection, runtime, providerCapabilities: adapter, nextEpisode: nextEp });
    assert.strictEqual(result, false);
});

test('9. Rutube (OPAQUE) is NOT eligible (false)', () => {
    const selection = { mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 1, providerId: 'rutube' };
    const runtime = { progressConfidence: 'OPAQUE', isEnded: true, currentTime: 0, duration: 0 };
    const adapter = new RutubeAdapter();
    const nextEp = { seasonNumber: 1, episodeNumber: 2, isReleased: true };

    const result = canAutoNext({ selection, runtime, providerCapabilities: adapter, nextEpisode: nextEp });
    assert.strictEqual(result, false);
});

// =========================================================================
// Section 2: Countdown Lifecycle & AutoNextCoordinator
// =========================================================================
console.log('\n[Section 2: Countdown Lifecycle & AutoNextCoordinator]');

test('10. AutoNextCoordinator starts prompt at 10 seconds and renders UI', () => {
    const promptEl = createMockElement('playerAutoNextPrompt');
    const countdownTextEl = createMockElement('playerAutoNextCountdown');
    const targetTitleEl = createMockElement('playerAutoNextTargetTitle');
    const playNowBtn = createMockElement('playerAutoNextPlayBtn');
    const cancelBtn = createMockElement('playerAutoNextCancelBtn');

    const coordinator = new AutoNextCoordinator({
        elements: { promptEl, countdownTextEl, targetTitleEl, playNowBtn, cancelBtn }
    });

    const targetSelection = {
        kinopoiskId: 301,
        seasonNumber: 1,
        episodeNumber: 2,
        episodeTitle: 'Episode 2',
        providerId: 'seasonvar',
        source: 'AUTO_NEXT'
    };

    coordinator.startPrompt(targetSelection, { kinopoiskId: 301, seasonNumber: 1, episodeNumber: 1 }, 1);

    const state = coordinator.getState();
    assert.strictEqual(state.active, true);
    assert.strictEqual(state.remainingSeconds, 10);
    assert.strictEqual(promptEl.style.display, 'flex');
    assert.ok(countdownTextEl.textContent.includes('10 сек'));
    assert.ok(targetTitleEl.textContent.includes('S1E2 · Episode 2'));

    coordinator.cancel();
});

test('11. Play Now immediately plays target and cancels timer', () => {
    let playedSelection = null;
    const playNowBtn = createMockElement('playerAutoNextPlayBtn');
    const coordinator = new AutoNextCoordinator({
        onPlayNext: (target) => { playedSelection = target; },
        elements: { playNowBtn }
    });

    const target = {
        kinopoiskId: 301,
        seasonNumber: 1,
        episodeNumber: 2,
        source: 'AUTO_NEXT',
        initialTimestamp: 0
    };

    coordinator.startPrompt(target, { kinopoiskId: 301, seasonNumber: 1, episodeNumber: 1 }, 1);
    assert.strictEqual(coordinator.getState().active, true);

    coordinator.playNow();

    assert.strictEqual(coordinator.getState().active, false);
    assert.strictEqual(coordinator.timerId, null);
    assert.deepStrictEqual(playedSelection, target);
});

test('12. Cancel stops timer and prevents later auto-play', () => {
    let playedCount = 0;
    const coordinator = new AutoNextCoordinator({
        onPlayNext: () => { playedCount++; }
    });

    const target = { kinopoiskId: 301, seasonNumber: 1, episodeNumber: 2 };
    coordinator.startPrompt(target, { kinopoiskId: 301, seasonNumber: 1, episodeNumber: 1 }, 1);

    coordinator.cancel();

    assert.strictEqual(coordinator.getState().active, false);
    assert.strictEqual(coordinator.timerId, null);
    assert.strictEqual(playedCount, 0);
});

// =========================================================================
// Section 3: Interruption Lifecycle & Cancellation Triggers
// =========================================================================
console.log('\n[Section 3: Interruption Lifecycle & Cancellation Triggers]');

test('13. PlaybackController switchProvider notifies cancelAutoNext', () => {
    const controller = new PlaybackController();
    controller.setContainer(createMockElement('videoContainer'));
    let cancelFired = false;
    controller.subscribeCancelAutoNext(() => { cancelFired = true; });

    controller.setSelection({ kinopoiskId: 301, mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 1 });
    controller.switchProvider('seasonvar').catch(() => {});

    assert.strictEqual(cancelFired, true);
    controller.destroy();
});

test('14. PlaybackController close() cancels auto-next', () => {
    const controller = new PlaybackController();
    let cancelFired = false;
    controller.subscribeCancelAutoNext(() => { cancelFired = true; });

    controller.close();
    assert.strictEqual(cancelFired, true);
    controller.destroy();
});

test('15. PlaybackController minimize() cancels auto-next', () => {
    const controller = new PlaybackController();
    let cancelFired = false;
    controller.subscribeCancelAutoNext(() => { cancelFired = true; });

    controller.minimize();
    assert.strictEqual(cancelFired, true);
    controller.destroy();
});

test('16. Manual episode selection change cancels auto-next', () => {
    const controller = new PlaybackController();
    let cancelFired = false;
    controller.subscribeCancelAutoNext(() => { cancelFired = true; });

    controller.setSelection({ kinopoiskId: 301, mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 1 });
    controller.setSelection({ kinopoiskId: 301, mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 2 });

    assert.strictEqual(cancelFired, true);
    controller.destroy();
});

// =========================================================================
// Section 4: Target Resolution & Navigation Matrix
// =========================================================================
console.log('\n[Section 4: Target Resolution & Navigation Matrix]');

test('17. Same-season target resolution (S1E1 -> S1E2)', () => {
    const current = { mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 1 };
    const next = resolveAdjacentEpisode(mockSeries, current, 'next');
    assert.deepStrictEqual(next, {
        seasonNumber: 1,
        episodeNumber: 2,
        episodeTitle: 'Episode 2',
        airDate: '2020-02-08',
        isReleased: true
    });
});

test('18. Cross-season target resolution (S1E3 finale -> S2E1 premiere)', () => {
    const current = { mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 3 };
    const next = resolveAdjacentEpisode(mockSeries, current, 'next');
    assert.deepStrictEqual(next, {
        seasonNumber: 2,
        episodeNumber: 1,
        episodeTitle: 'Season 2 Premiere',
        airDate: '2021-03-01',
        isReleased: true
    });
});

test('19. Specials isolation: S0E1 -> S0E2, but final special S0E3 never jumps to S1E1', () => {
    const s0e1 = { mediaType: 'tv-series', seasonNumber: 0, episodeNumber: 1 };
    assert.strictEqual(resolveAdjacentEpisode(mockSeries, s0e1, 'next')?.episodeNumber, 2);

    const s0e3 = { mediaType: 'tv-series', seasonNumber: 0, episodeNumber: 3 };
    assert.strictEqual(resolveAdjacentEpisode(mockSeries, s0e3, 'next'), null);
});

test('20. Stale mount token prevents auto-play if provider/mount changed during countdown', () => {
    let played = false;
    const controller = new PlaybackController();
    controller.mountRequestId = 5;

    const coordinator = new AutoNextCoordinator({
        playbackController: controller,
        onPlayNext: () => { played = true; }
    });

    // Start with token 4
    coordinator.startPrompt({ kinopoiskId: 301, seasonNumber: 1, episodeNumber: 2 }, { kinopoiskId: 301, seasonNumber: 1, episodeNumber: 1 }, 4);

    // Controller is now at token 5
    coordinator.playNow();

    // Auto-play should be safely aborted
    assert.strictEqual(played, false);
    controller.destroy();
});

test('21. VALID_PLAYBACK_SOURCES includes AUTO_NEXT', () => {
    assert.ok(VALID_SOURCES.has('AUTO_NEXT'));
    const norm = normalizePlaybackSelection({
        kinopoiskId: 301,
        seasonNumber: 1,
        episodeNumber: 2,
        source: 'AUTO_NEXT'
    });
    assert.strictEqual(norm.source, 'AUTO_NEXT');
    assert.strictEqual(norm.initialTimestamp, 0);
});

// =========================================================================
// RESULTS SUMMARY
// =========================================================================
console.log('\n========================================');
console.log(`PHASE 3G RESULTS: ${passed} passed, ${failed} failed`);
console.log('========================================\n');

if (failed > 0) {
    process.exit(1);
}
