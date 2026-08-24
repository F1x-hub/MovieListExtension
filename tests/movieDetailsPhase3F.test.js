/**
 * tests/movieDetailsPhase3F.test.js
 * Comprehensive automated test suite for MovieDetails Phase 3F:
 * Reliable Completion Detection + Next-Watched Resolution (Generic Watch Progress Intelligence)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { normalizePlaybackSelection, resolveWatchTarget } = require('../src/shared/services/player/PlaybackSelection');
const { createDefaultPlaybackRuntimeState, isMediaIdentityMatching, isPlaybackCompleted, normalizeProgressRecord } = require('../src/shared/services/player/PlaybackRuntime');
const { ProgressService } = require('../src/shared/services/ProgressService');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');
const { SeasonvarAdapter } = require('../src/shared/services/player/adapters/SeasonvarAdapter');
const { VidSrcAdapter } = require('../src/shared/services/player/adapters/VidSrcAdapter');
const { KinogoAdapter } = require('../src/shared/services/player/adapters/KinogoAdapter');
const { ExFsAdapter } = require('../src/shared/services/player/adapters/ExFsAdapter');
const { RutubeAdapter } = require('../src/shared/services/player/adapters/RutubeAdapter');

// ─── Test Mocking Harness ──────────────────────────────────────────

class MockProgressService {
    constructor() {
        this.storage = {};
        this.writeCount = 0;
        this.writeHistory = [];
    }

    async saveProgress(movieId, data) {
        this.writeCount++;
        const record = normalizeProgressRecord(data);
        const existing = this.storage[movieId];
        let completed = record.completed;
        if (existing && existing.season === record.season && existing.episode === record.episode) {
            if (existing.completed && !completed) {
                completed = true;
            }
        }
        const saved = {
            ...record,
            completed,
            updatedAt: Date.now()
        };
        this.storage[movieId] = saved;
        this.writeHistory.push({ movieId, ...saved });
        return saved;
    }

    async getProgress(movieId) {
        return this.storage[movieId] || null;
    }
}

class MockVideoElement {
    constructor() {
        this.tagName = 'VIDEO';
        this.currentTime = 0;
        this.duration = 0;
        this.paused = true;
        this.ended = false;
        this.listeners = {};
    }

    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(l => l !== fn);
    }

    emit(event) {
        if (this.listeners[event]) {
            for (const fn of this.listeners[event]) {
                fn();
            }
        }
    }
}

// ─── Test Execution Suite ──────────────────────────────────────────

async function runTests() {
    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            await fn();
            passed++;
            console.log(`  ✓ ${name}`);
        } catch (err) {
            failed++;
            console.error(`  ✗ ${name}`);
            console.error(`    ${err.message}`);
        }
    }

    console.log('--- MOVIEDETAILS PHASE 3F TEST SUITE ---');

    // =========================================================================
    // SECTION 1: isPlaybackCompleted Contract & Edge Boundaries
    // =========================================================================
    console.log('\n[Section 1: isPlaybackCompleted Contract & Edge Boundaries]');

    await test('1. Null/undefined/empty runtime returns false', () => {
        assert.strictEqual(isPlaybackCompleted(null), false);
        assert.strictEqual(isPlaybackCompleted(undefined), false);
        assert.strictEqual(isPlaybackCompleted({}), false);
    });

    await test('2. OPAQUE / PARTIAL confidence always returns false (even at 99% or ended)', () => {
        const opaqueRuntime = createDefaultPlaybackRuntimeState({
            progressConfidence: 'OPAQUE',
            currentTime: 999,
            duration: 1000,
            isEnded: true
        });
        assert.strictEqual(isPlaybackCompleted(opaqueRuntime), false);

        const partialRuntime = createDefaultPlaybackRuntimeState({
            progressConfidence: 'PARTIAL',
            currentTime: 950,
            duration: 1000,
            isEnded: true
        });
        assert.strictEqual(isPlaybackCompleted(partialRuntime), false);
    });

    await test('3. RELIABLE confidence with isEnded === true returns true regardless of duration', () => {
        const endedRuntime = createDefaultPlaybackRuntimeState({
            progressConfidence: 'RELIABLE',
            currentTime: 100,
            duration: 100,
            isEnded: true
        });
        assert.strictEqual(isPlaybackCompleted(endedRuntime), true);
    });

    await test('4. Short content safety: duration <= 120s does NOT use 90% rule, requires isEnded', () => {
        const shortRuntime = createDefaultPlaybackRuntimeState({
            progressConfidence: 'RELIABLE',
            currentTime: 95,
            duration: 100,
            isEnded: false
        });
        assert.strictEqual(isPlaybackCompleted(shortRuntime), false);

        const shortEnded = createDefaultPlaybackRuntimeState({
            progressConfidence: 'RELIABLE',
            currentTime: 100,
            duration: 100,
            isEnded: true
        });
        assert.strictEqual(isPlaybackCompleted(shortEnded), true);
    });

    await test('5. Regular content (duration > 120s) triggers completed at exactly ratio >= 0.90', () => {
        const below89 = createDefaultPlaybackRuntimeState({
            progressConfidence: 'RELIABLE',
            currentTime: 899,
            duration: 1000,
            isEnded: false
        });
        assert.strictEqual(isPlaybackCompleted(below89), false);

        const exact90 = createDefaultPlaybackRuntimeState({
            progressConfidence: 'RELIABLE',
            currentTime: 900,
            duration: 1000,
            isEnded: false
        });
        assert.strictEqual(isPlaybackCompleted(exact90), true);

        const above95 = createDefaultPlaybackRuntimeState({
            progressConfidence: 'RELIABLE',
            currentTime: 950,
            duration: 1000,
            isEnded: false
        });
        assert.strictEqual(isPlaybackCompleted(above95), true);
    });

    await test('6. Seeking guard: context.isSeeking === true returns false', () => {
        const seekingRuntime = createDefaultPlaybackRuntimeState({
            progressConfidence: 'RELIABLE',
            currentTime: 950,
            duration: 1000,
            isEnded: false
        });
        assert.strictEqual(isPlaybackCompleted(seekingRuntime, { isSeeking: true }), false);
    });

    // =========================================================================
    // SECTION 2: Progress Record Normalization & Monotonic Retention
    // =========================================================================
    console.log('\n[Section 2: Progress Normalization & Monotonic Retention]');

    await test('7. normalizeProgressRecord correctly parses string and numeric legacy shapes', () => {
        const raw = {
            season: '3 сезон',
            episode: '7 серия',
            timestamp: 450.7,
            duration: '2400',
            movieId: 1001,
            movieTitle: 'Game of Thrones'
        };
        const norm = normalizeProgressRecord(raw);
        assert.strictEqual(norm.season, 3);
        assert.strictEqual(norm.episode, 7);
        assert.strictEqual(norm.seasonLabel, '3 сезон');
        assert.strictEqual(norm.episodeLabel, '7 серия');
        assert.strictEqual(norm.timestamp, 450);
        assert.strictEqual(norm.duration, 2400);
        assert.strictEqual(norm.completed, false);
    });

    await test('8. ProgressService preserves completed: true when saved', async () => {
        const service = new MockProgressService();
        await service.saveProgress(1001, {
            season: 3,
            episode: 7,
            timestamp: 2160,
            duration: 2400,
            completed: true,
            movieTitle: 'Game of Thrones'
        });

        const progress = await service.getProgress(1001);
        assert.strictEqual(progress.completed, true);
        assert.strictEqual(progress.season, 3);
        assert.strictEqual(progress.episode, 7);
    });

    await test('9. Monotonic completion preservation: completed cannot revert to false for same S/E', async () => {
        const service = new MockProgressService();
        await service.saveProgress(1001, {
            season: 3,
            episode: 7,
            timestamp: 2160,
            duration: 2400,
            completed: true
        });

        // User opens same episode in opaque provider (completed: false or missing)
        await service.saveProgress(1001, {
            season: 3,
            episode: 7,
            timestamp: 120,
            completed: false
        });

        const progress = await service.getProgress(1001);
        assert.strictEqual(progress.completed, true, 'Completed flag must remain true for same S/E');
    });

    await test('10. New episode navigation resets completed to false', async () => {
        const service = new MockProgressService();
        await service.saveProgress(1001, {
            season: 3,
            episode: 7,
            completed: true
        });

        // Move to S3E8
        await service.saveProgress(1001, {
            season: 3,
            episode: 8,
            timestamp: 10,
            completed: false
        });

        const progress = await service.getProgress(1001);
        assert.strictEqual(progress.completed, false);
        assert.strictEqual(progress.season, 3);
        assert.strictEqual(progress.episode, 8);
    });

    // =========================================================================
    // SECTION 3: PlaybackController Edge-Triggered Completion & Immediate Flush
    // =========================================================================
    console.log('\n[Section 3: PlaybackController Edge-Triggered Completion]');

    await test('11. Completion fires subscriber exactly ONCE per episode mount (no spam on 91%, 92%)', () => {
        const controller = new PlaybackController();
        const events = [];
        controller.subscribeCompletion((evt) => events.push(evt));

        controller.setSelection({
            kinopoiskId: 444,
            mediaType: 'tv-series',
            seasonNumber: 2,
            episodeNumber: 1,
            title: 'Sherlock'
        });

        const video = new MockVideoElement();
        video.duration = 1000;

        controller.resetRuntimeState({
            progressConfidence: 'RELIABLE',
            providerId: 'seasonvar',
            mediaIdentity: { kinopoiskId: 444, seasonNumber: 2, episodeNumber: 1 }
        });

        controller._attachNativeVideoListeners(video, controller.mountRequestId, controller.getSelection(), {});

        video.currentTime = 850;
        video.paused = false;
        video.emit('timeupdate');
        assert.strictEqual(events.length, 0);

        // Cross 90% threshold
        video.currentTime = 900;
        video.emit('timeupdate');
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].seasonNumber, 2);
        assert.strictEqual(events[0].episodeNumber, 1);

        // Continuous playback past 90%
        video.currentTime = 910;
        video.emit('timeupdate');
        video.currentTime = 950;
        video.emit('timeupdate');
        assert.strictEqual(events.length, 1, 'Must not duplicate completion event');
    });

    await test('12. Completion immediately flushes progress with completed: true without waiting for throttle', async () => {
        const mockProgress = new MockProgressService();
        const controller = new PlaybackController({
            progressService: mockProgress
        });

        controller.setSelection({
            kinopoiskId: 444,
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 3
        });

        const video = new MockVideoElement();
        video.duration = 1000;

        controller.resetRuntimeState({
            progressConfidence: 'RELIABLE',
            providerId: 'seasonvar',
            mediaIdentity: { kinopoiskId: 444, seasonNumber: 1, episodeNumber: 3 }
        });

        controller._attachNativeVideoListeners(video, controller.mountRequestId, controller.getSelection(), {});

        video.currentTime = 950;
        video.paused = false;
        video.emit('timeupdate');

        const saved = await mockProgress.getProgress(444);
        assert.ok(saved);
        assert.strictEqual(saved.completed, true);
        assert.strictEqual(saved.season, 1);
        assert.strictEqual(saved.episode, 3);
        assert.strictEqual(saved.timestamp, 950);
    });

    await test('13. Stale telemetry with superseded mountRequestId does not trigger completion', () => {
        const controller = new PlaybackController();
        const events = [];
        controller.subscribeCompletion((evt) => events.push(evt));

        const video = new MockVideoElement();
        video.duration = 1000;
        const oldToken = controller.mountRequestId;

        controller._attachNativeVideoListeners(video, oldToken, { kinopoiskId: 10, seasonNumber: 1, episodeNumber: 1 }, {});

        // Supersede mount token
        controller.mountRequestId = 999;

        video.currentTime = 950;
        video.emit('timeupdate');

        assert.strictEqual(events.length, 0, 'Stale token must be discarded');
    });

    // =========================================================================
    // SECTION 4: resolveWatchTarget Generic Watch Intelligence
    // =========================================================================
    console.log('\n[Section 4: resolveWatchTarget Generic Watch Intelligence]');

    const mockSeriesMovie = {
        kinopoiskId: 777,
        isSeries: true,
        type: 'tv-series',
        nameRu: 'Фарго',
        seasons: [
            { season_number: 0, episode_count: 2 }, // Specials
            { season_number: 1, episode_count: 10 },
            { season_number: 2, episode_count: 10 },
            { season_number: 3, episode_count: 10 }
        ]
    };

    const mockAdjacentResolver = (movie, selection, direction, opts = {}) => {
        if (direction !== 'next') return null;
        const sNum = selection.seasonNumber;
        const eNum = selection.episodeNumber;

        if (sNum === 0) {
            if (eNum < 2) return { seasonNumber: 0, episodeNumber: eNum + 1 };
            return null; // Specials do NOT jump to S1
        }
        if (sNum === 1) {
            if (eNum < 10) return { seasonNumber: 1, episodeNumber: eNum + 1 };
            return { seasonNumber: 2, episodeNumber: 1 };
        }
        if (sNum === 2) {
            if (eNum < 10) {
                // If checking playability and next is unreleased
                if (eNum + 1 === 10 && opts.unreleasedNext) return null;
                return { seasonNumber: 2, episodeNumber: eNum + 1 };
            }
            return { seasonNumber: 3, episodeNumber: 1 };
        }
        if (sNum === 3) {
            if (eNum < 10) return { seasonNumber: 3, episodeNumber: eNum + 1 };
            return null; // Series finale
        }
        return null;
    };

    const watchOptions = {
        resolveAdjacentEpisode: mockAdjacentResolver
    };

    await test('14. New series without progress targets S1E1 at timestamp 0 (NEW_SERIES)', () => {
        const target = resolveWatchTarget(mockSeriesMovie, null, watchOptions);
        assert.deepStrictEqual(target, {
            seasonNumber: 1,
            episodeNumber: 1,
            initialTimestamp: 0,
            reason: 'NEW_SERIES'
        });
    });

    await test('15. Incomplete progress targets exact S/E at saved timestamp (RESUME_IN_PROGRESS)', () => {
        const progress = {
            season: 2,
            episode: 4,
            timestamp: 850,
            completed: false
        };
        const target = resolveWatchTarget(mockSeriesMovie, progress, watchOptions);
        assert.deepStrictEqual(target, {
            seasonNumber: 2,
            episodeNumber: 4,
            initialTimestamp: 850,
            reason: 'RESUME_IN_PROGRESS'
        });
    });

    await test('16. Completed progress targets next same-season episode at timestamp 0 (NEXT_AFTER_COMPLETED)', () => {
        const progress = {
            season: 2,
            episode: 4,
            timestamp: 2100,
            completed: true
        };
        const target = resolveWatchTarget(mockSeriesMovie, progress, watchOptions);
        assert.deepStrictEqual(target, {
            seasonNumber: 2,
            episodeNumber: 5,
            initialTimestamp: 0,
            reason: 'NEXT_AFTER_COMPLETED'
        });
    });

    await test('17. Completed season finale (S1E10) targets next season episode 1 (S2E1) at timestamp 0', () => {
        const progress = {
            season: 1,
            episode: 10,
            timestamp: 2300,
            completed: true
        };
        const target = resolveWatchTarget(mockSeriesMovie, progress, watchOptions);
        assert.deepStrictEqual(target, {
            seasonNumber: 2,
            episodeNumber: 1,
            initialTimestamp: 0,
            reason: 'NEXT_AFTER_COMPLETED'
        });
    });

    await test('18. Completed series finale (S3E10) targets same final episode at timestamp 0 (FINAL_EPISODE_COMPLETED)', () => {
        const progress = {
            season: 3,
            episode: 10,
            timestamp: 2400,
            completed: true
        };
        const target = resolveWatchTarget(mockSeriesMovie, progress, watchOptions);
        assert.deepStrictEqual(target, {
            seasonNumber: 3,
            episodeNumber: 10,
            initialTimestamp: 0,
            reason: 'FINAL_EPISODE_COMPLETED'
        });
    });

    await test('19. Completed latest released episode when next is unreleased falls back to FINAL_EPISODE_COMPLETED', () => {
        const progress = {
            season: 2,
            episode: 9,
            completed: true
        };
        const unreleasedOpts = {
            resolveAdjacentEpisode: (m, s, d) => mockAdjacentResolver(m, s, d, { unreleasedNext: true })
        };
        const target = resolveWatchTarget(mockSeriesMovie, progress, unreleasedOpts);
        assert.deepStrictEqual(target, {
            seasonNumber: 2,
            episodeNumber: 9,
            initialTimestamp: 0,
            reason: 'FINAL_EPISODE_COMPLETED'
        });
    });

    await test('20. Specials (Season 0) advance within season 0 and never jump into Season 1', () => {
        const s0e1 = { season: 0, episode: 1, completed: true };
        const target1 = resolveWatchTarget(mockSeriesMovie, s0e1, watchOptions);
        assert.strictEqual(target1.seasonNumber, 0);
        assert.strictEqual(target1.episodeNumber, 2);
        assert.strictEqual(target1.reason, 'NEXT_AFTER_COMPLETED');

        const s0e2 = { season: 0, episode: 2, completed: true };
        const target2 = resolveWatchTarget(mockSeriesMovie, s0e2, watchOptions);
        assert.strictEqual(target2.seasonNumber, 0);
        assert.strictEqual(target2.episodeNumber, 2);
        assert.strictEqual(target2.reason, 'FINAL_EPISODE_COMPLETED');
    });

    await test('21. Non-series single movie targets null S/E with timestamp', () => {
        const movie = {
            kinopoiskId: 888,
            isSeries: false,
            type: 'movie',
            nameRu: 'Начало'
        };

        const newTarget = resolveWatchTarget(movie, null, watchOptions);
        assert.deepStrictEqual(newTarget, {
            seasonNumber: null,
            episodeNumber: null,
            initialTimestamp: 0,
            reason: 'NEW_SERIES'
        });

        const resumeTarget = resolveWatchTarget(movie, { timestamp: 4500 }, watchOptions);
        assert.deepStrictEqual(resumeTarget, {
            seasonNumber: null,
            episodeNumber: null,
            initialTimestamp: 4500,
            reason: 'RESUME_IN_PROGRESS'
        });
    });

    console.log(`\n========================================`);
    console.log(`PHASE 3F RESULTS: ${passed} passed, ${failed} failed`);
    console.log(`========================================\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

if (typeof require !== 'undefined' && require.main === module) {
    runTests();
}

module.exports = { runTests };
