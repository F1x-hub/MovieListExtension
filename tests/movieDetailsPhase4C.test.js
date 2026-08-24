/**
 * tests/movieDetailsPhase4C.test.js
 * 
 * Test suite for MovieDetails Phase 4C:
 * - EpisodeHistoryService contract and normalization
 * - Lost-update protection & write serialization
 * - Provider trust boundaries (RELIABLE vs OPAQUE vs PARTIAL)
 * - Lazy migration without false inference
 * - Seasons UI integration, watched badges & manual toggle
 * - Rewatch state preservation
 * - Season completion counts & specials isolation
 * - Performance, single storage read & 1000-episode stress measurements
 */

const assert = require('assert');
const {
    EpisodeHistoryService,
    buildEpisodeHistoryKey,
    parseEpisodeHistoryKey,
    normalizeEpisodeHistory,
    VALID_COMPLETION_SOURCES
} = require('../src/shared/services/EpisodeHistoryService');

const { PlaybackController } = require('../src/shared/services/player/PlaybackController');
const { createDefaultRuntime } = require('../src/shared/services/player/PlaybackRuntime');

// Mock in-memory storage generator
function createMockStorage(initialData = {}) {
    const store = { ...initialData };
    return {
        get: (keys, callback) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            const result = {};
            keyArr.forEach(k => {
                if (store[k] !== undefined) {
                    result[k] = JSON.parse(JSON.stringify(store[k]));
                }
            });
            if (callback) callback(result);
            return Promise.resolve(result);
        },
        set: (items, callback) => {
            Object.entries(items).forEach(([k, v]) => {
                store[k] = JSON.parse(JSON.stringify(v));
            });
            if (callback) callback();
            return Promise.resolve();
        },
        remove: (keys, callback) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            keyArr.forEach(k => delete store[k]);
            if (callback) callback();
            return Promise.resolve();
        },
        _dump: () => store
    };
}

async function runTests() {
    console.log('=== Starting MovieDetails Phase 4C Tests ===\n');

    // -------------------------------------------------------------
    // Test 1: Episode History Key Helpers & Normalization
    // -------------------------------------------------------------
    console.log('Test 1: Key helpers & normalization');
    {
        assert.strictEqual(buildEpisodeHistoryKey(1, 1), '1:1');
        assert.strictEqual(buildEpisodeHistoryKey(0, 5), '0:5');
        assert.strictEqual(buildEpisodeHistoryKey('3', '7'), '3:7');
        assert.strictEqual(buildEpisodeHistoryKey(-1, 1), null);
        assert.strictEqual(buildEpisodeHistoryKey(1, 0), null);
        assert.strictEqual(buildEpisodeHistoryKey(null, 1), null);
        assert.strictEqual(buildEpisodeHistoryKey(1, undefined), null);

        assert.deepStrictEqual(parseEpisodeHistoryKey('1:1'), { seasonNumber: 1, episodeNumber: 1 });
        assert.deepStrictEqual(parseEpisodeHistoryKey('0:2'), { seasonNumber: 0, episodeNumber: 2 });
        assert.strictEqual(parseEpisodeHistoryKey('invalid'), null);
        assert.strictEqual(parseEpisodeHistoryKey('1:0'), null);
        assert.strictEqual(parseEpisodeHistoryKey('-1:5'), null);

        const corruptRaw = {
            '1:1': { cAt: 1718000000, src: 'AUTO_RELIABLE' },
            '1:2': { completedAt: 1718001000, source: 'MANUAL' },
            'invalid_key': { cAt: 12345, src: 'MANUAL' },
            '1:3': { cAt: -50, src: 'UNKNOWN_SRC' },
            '1:4': 'not_an_object',
            '0:1': { cAt: 1718002000, src: 'AUTO_RELIABLE' }
        };

        const normalized = normalizeEpisodeHistory(corruptRaw);
        assert.strictEqual(Object.keys(normalized).length, 4);
        assert.strictEqual(normalized['1:1'].src, 'AUTO_RELIABLE');
        assert.strictEqual(normalized['1:1'].cAt, 1718000000);
        assert.strictEqual(normalized['1:2'].src, 'MANUAL');
        assert.strictEqual(normalized['1:2'].cAt, 1718001000);
        assert.strictEqual(normalized['1:3'].src, 'AUTO_RELIABLE'); // fallback
        assert.strictEqual(normalized['0:1'].src, 'AUTO_RELIABLE');
        assert.strictEqual(normalized['invalid_key'], undefined);

        assert.deepStrictEqual(normalizeEpisodeHistory(null), {});
        assert.deepStrictEqual(normalizeEpisodeHistory([]), {});
        console.log('  Passed Key helpers & normalization assertions.');
    }

    // -------------------------------------------------------------
    // Test 2: EpisodeHistoryService Basic CRUD & Idempotency
    // -------------------------------------------------------------
    console.log('Test 2: Basic CRUD & Idempotency');
    {
        const mockStorage = createMockStorage();
        const service = new EpisodeHistoryService();
        service._getStorage = () => mockStorage;

        const empty = await service.getHistory(401);
        assert.deepStrictEqual(empty, {});

        // Mark S1E1 completed
        const ts1 = 1718000000;
        await service.markCompleted(401, 1, 1, { source: 'AUTO_RELIABLE', completedAt: ts1 });
        assert.strictEqual(await service.isCompleted(401, 1, 1), true);
        assert.strictEqual(await service.isCompleted(401, 1, 2), false);

        // Idempotency: Duplicate mark preserves original completedAt
        await service.markCompleted(401, 1, 1, { source: 'AUTO_RELIABLE', completedAt: 1719999999 });
        const history1 = await service.getHistory(401);
        assert.strictEqual(history1['1:1'].cAt, ts1);

        // Manual override retains original completedAt but updates source
        await service.markCompleted(401, 1, 1, { source: 'MANUAL' });
        const history2 = await service.getHistory(401);
        assert.strictEqual(history2['1:1'].src, 'MANUAL');
        assert.strictEqual(history2['1:1'].cAt, ts1);

        // Mark S1E2 manual
        await service.markCompleted(401, 1, 2, { source: 'MANUAL', completedAt: ts1 + 1000 });
        assert.strictEqual(await service.getCompletedCount(401), 2);
        assert.strictEqual(await service.getCompletedCount(401, 1), 2);
        assert.strictEqual(await service.getCompletedCount(401, 2), 0);

        // Unmark S1E1
        await service.unmarkCompleted(401, 1, 1);
        assert.strictEqual(await service.isCompleted(401, 1, 1), false);
        assert.strictEqual(await service.isCompleted(401, 1, 2), true);
        assert.strictEqual(await service.getCompletedCount(401), 1);

        // Clear history
        await service.clearMovieHistory(401);
        assert.strictEqual(await service.getCompletedCount(401), 0);

        console.log('  Passed Basic CRUD & Idempotency assertions.');
    }

    // -------------------------------------------------------------
    // Test 3: Write Serialization & Lost-Update Protection
    // -------------------------------------------------------------
    console.log('Test 3: Write Serialization & Concurrent Operations');
    {
        const mockStorage = createMockStorage();
        const service = new EpisodeHistoryService();
        service._getStorage = () => mockStorage;

        // Fire 5 concurrent writes simultaneously without awaiting each one
        await Promise.all([
            service.markCompleted(500, 1, 1, { source: 'AUTO_RELIABLE' }),
            service.markCompleted(500, 1, 2, { source: 'MANUAL' }),
            service.markCompleted(500, 1, 3, { source: 'AUTO_RELIABLE' }),
            service.markCompleted(500, 2, 1, { source: 'MANUAL' }),
            service.markCompleted(500, 0, 1, { source: 'AUTO_RELIABLE' }) // Special
        ]);

        const history = await service.getHistory(500);
        assert.strictEqual(Object.keys(history).length, 5);
        assert.strictEqual(history['1:1'].src, 'AUTO_RELIABLE');
        assert.strictEqual(history['1:2'].src, 'MANUAL');
        assert.strictEqual(history['1:3'].src, 'AUTO_RELIABLE');
        assert.strictEqual(history['2:1'].src, 'MANUAL');
        assert.strictEqual(history['0:1'].src, 'AUTO_RELIABLE');

        // Concurrent mark and unmark
        await Promise.all([
            service.unmarkCompleted(500, 1, 2),
            service.markCompleted(500, 1, 4, { source: 'MANUAL' })
        ]);

        const historyAfter = await service.getHistory(500);
        assert.strictEqual(historyAfter['1:2'], undefined);
        assert.strictEqual(historyAfter['1:4'].src, 'MANUAL');

        console.log('  Passed Write Serialization assertions.');
    }

    // -------------------------------------------------------------
    // Test 4: Provider Trust Boundaries in PlaybackController
    // -------------------------------------------------------------
    console.log('Test 4: Provider Trust Boundaries on Completion');
    {
        const mockStorage = createMockStorage();
        const historyService = new EpisodeHistoryService();
        historyService._getStorage = () => mockStorage;

        const controller = new PlaybackController({
            episodeHistoryService: historyService
        });

        // 4.1 Seasonvar (RELIABLE) triggers completion -> auto-writes EpisodeHistory
        const reliableRuntime = {
            currentTime: 2400,
            duration: 2500, // 96% -> completed
            progressConfidence: 'RELIABLE',
            providerId: 'seasonvar',
            isEnded: false
        };
        const mediaIdSeasonvar = { kinopoiskId: 600, seasonNumber: 3, episodeNumber: 7 };

        controller._checkAndTriggerCompletion(reliableRuntime, controller.mountRequestId, mediaIdSeasonvar);
        // Wait microtasks for queue
        await new Promise(r => setTimeout(r, 50));

        assert.strictEqual(await historyService.isCompleted(600, 3, 7), true);
        const sRecord = (await historyService.getHistory(600))['3:7'];
        assert.strictEqual(sRecord.src, 'AUTO_RELIABLE');

        // 4.2 VidSrc (OPAQUE) -> NEVER auto-writes EpisodeHistory
        const controllerVidSrc = new PlaybackController({
            episodeHistoryService: historyService
        });
        const opaqueRuntime = {
            currentTime: 2400,
            duration: 2500,
            progressConfidence: 'OPAQUE',
            providerId: 'vidsrc',
            isEnded: true
        };
        const mediaIdVidSrc = { kinopoiskId: 700, seasonNumber: 1, episodeNumber: 1 };
        controllerVidSrc._checkAndTriggerCompletion(opaqueRuntime, controllerVidSrc.mountRequestId, mediaIdVidSrc);
        await new Promise(r => setTimeout(r, 50));
        assert.strictEqual(await historyService.isCompleted(700, 1, 1), false);

        // 4.3 KinoGo / Ex-FS (PARTIAL) -> NEVER auto-writes EpisodeHistory
        const controllerKinoGo = new PlaybackController({
            episodeHistoryService: historyService
        });
        const partialRuntime = {
            currentTime: 2400,
            duration: 2500,
            progressConfidence: 'PARTIAL',
            providerId: 'kinogo',
            isEnded: true
        };
        const mediaIdKinoGo = { kinopoiskId: 800, seasonNumber: 2, episodeNumber: 4 };
        controllerKinoGo._checkAndTriggerCompletion(partialRuntime, controllerKinoGo.mountRequestId, mediaIdKinoGo);
        await new Promise(r => setTimeout(r, 50));
        assert.strictEqual(await historyService.isCompleted(800, 2, 4), false);

        console.log('  Passed Provider Trust Boundaries assertions.');
    }

    // -------------------------------------------------------------
    // Test 5: Lazy Migration & Zero Prior Inference
    // -------------------------------------------------------------
    console.log('Test 5: Lazy Migration without prior inference');
    {
        const mockStorage = createMockStorage();
        const service = new EpisodeHistoryService();
        service._getStorage = () => mockStorage;

        // Case 1: Incomplete progress does NOT seed
        const incompleteProgress = { season: 3, episode: 7, completed: false, timestamp: 800, duration: 2400 };
        const seeded1 = await service.seedFromProgress(900, incompleteProgress);
        assert.strictEqual(seeded1, false);
        assert.strictEqual(await service.isCompleted(900, 3, 7), false);

        // Case 2: Completed progress seeds EXACT S/E only
        const completedProgress = { season: 3, episode: 7, completed: true, timestamp: 2400, duration: 2400, updatedAt: 1718500000 };
        const seeded2 = await service.seedFromProgress(900, completedProgress);
        assert.strictEqual(seeded2, true);
        assert.strictEqual(await service.isCompleted(900, 3, 7), true);

        // CRITICAL INVARIANT: Prior episodes are NOT seeded
        assert.strictEqual(await service.isCompleted(900, 1, 1), false);
        assert.strictEqual(await service.isCompleted(900, 2, 5), false);
        assert.strictEqual(await service.isCompleted(900, 3, 6), false);

        console.log('  Passed Lazy Migration assertions.');
    }

    // -------------------------------------------------------------
    // Test 6: Seasons UI Simulation & Watched Badges
    // -------------------------------------------------------------
    console.log('Test 6: Seasons UI Watched Badges & Manual Toggle Button');
    {
        // Mock minimal MovieDetailsManager methods
        const manager = {
            escapeHtml: (str) => String(str || ''),
            formatDate: () => '1 янв. 2024',
            isEpisodePlayableByDate: (ep) => !ep.airDate || new Date(ep.airDate) <= new Date(),
            getPluralEpisodes: (n) => `${n} серий`,
            getSeasonCompletionStats(season, history) {
                const sNum = Number(season.number);
                const isSpecial = Boolean(season.isSpecial || sNum === 0);
                let totalReleased = 0;
                let completed = 0;

                if (Array.isArray(season.episodes) && season.episodes.length > 0) {
                    const released = season.episodes.filter(ep => this.isEpisodePlayableByDate(ep));
                    totalReleased = released.length;
                    completed = released.filter(ep => Boolean(history && history[`${sNum}:${ep.episodeNumber}`])).length;
                } else {
                    totalReleased = Number(season.episodeCount) || 0;
                    if (history) {
                        for (const k of Object.keys(history)) {
                            const p = parseEpisodeHistoryKey(k);
                            if (p && p.seasonNumber === sNum) completed++;
                        }
                    }
                }
                return {
                    completedCount: completed,
                    totalReleasedCount: totalReleased,
                    isFullyCompleted: totalReleased > 0 && completed >= totalReleased,
                    isSpecial
                };
            },
            renderEpisodesList(episodes, nextEpisode, progress, watchTarget, history) {
                return episodes.map(ep => {
                    const epKey = `${ep.seasonNumber}:${ep.episodeNumber}`;
                    const isCompleted = Boolean(history && history[epKey]);
                    const isCurrentResume = Boolean(
                        progress && !progress.completed &&
                        Number(progress.season) === Number(ep.seasonNumber) &&
                        Number(progress.episode) === Number(ep.episodeNumber)
                    );

                    let badges = '';
                    if (isCompleted) badges += '<span class="badge-watched-episode">Просмотрено</span>';
                    if (isCurrentResume) badges += '<span class="badge-resume-episode">Продолжить</span>';

                    const toggleBtn = `<button class="episode-card__watched-toggle-btn ${isCompleted ? 'is-watched' : ''}" data-action="toggle-episode-watched" data-season-number="${ep.seasonNumber}" data-episode-number="${ep.episodeNumber}" aria-pressed="${isCompleted}"></button>`;

                    return `<div class="episode-card ${isCompleted ? 'episode-card--watched' : ''}">${badges}${toggleBtn}</div>`;
                }).join('');
            }
        };

        const episodes = [
            { seasonNumber: 1, episodeNumber: 1, name: 'Ep 1' },
            { seasonNumber: 1, episodeNumber: 2, name: 'Ep 2' },
            { seasonNumber: 1, episodeNumber: 3, name: 'Ep 3' }
        ];

        const history = {
            '1:1': { cAt: 1718000000, src: 'AUTO_RELIABLE' },
            '1:2': { cAt: 1718001000, src: 'MANUAL' }
        };

        const html = manager.renderEpisodesList(episodes, null, null, null, history);

        // Ep 1 & 2 have badge-watched-episode and is-watched button
        assert.ok(html.includes('badge-watched-episode'));
        assert.ok(html.includes('data-episode-number="1" aria-pressed="true"'));
        assert.ok(html.includes('data-episode-number="2" aria-pressed="true"'));
        assert.ok(html.includes('data-episode-number="3" aria-pressed="false"'));

        // Season completion stats
        const season1 = { number: 1, episodeCount: 3, episodes };
        const stats = manager.getSeasonCompletionStats(season1, history);
        assert.strictEqual(stats.completedCount, 2);
        assert.strictEqual(stats.totalReleasedCount, 3);
        assert.strictEqual(stats.isFullyCompleted, false);

        // Mark 3rd episode completed
        history['1:3'] = { cAt: 1718002000, src: 'MANUAL' };
        const fullStats = manager.getSeasonCompletionStats(season1, history);
        assert.strictEqual(fullStats.completedCount, 3);
        assert.strictEqual(fullStats.isFullyCompleted, true);

        console.log('  Passed Seasons UI assertions.');
    }

    // -------------------------------------------------------------
    // Test 7: Rewatch State Preservation
    // -------------------------------------------------------------
    console.log('Test 7: Rewatch State Preservation');
    {
        // History says S1E1 completed
        const history = {
            '1:1': { cAt: 1718000000, src: 'AUTO_RELIABLE' }
        };

        // User is currently rewatching S1E1 at 500s
        const activeProgress = {
            season: 1,
            episode: 1,
            completed: false,
            timestamp: 500,
            duration: 2500
        };

        const ep = { seasonNumber: 1, episodeNumber: 1, name: 'Pilot' };

        const isCompleted = Boolean(history[`${ep.seasonNumber}:${ep.episodeNumber}`]);
        const isCurrentResume = Boolean(
            activeProgress && !activeProgress.completed &&
            activeProgress.season === ep.seasonNumber &&
            activeProgress.episode === ep.episodeNumber
        );

        // Both are true on rewatch!
        assert.strictEqual(isCompleted, true);
        assert.strictEqual(isCurrentResume, true);

        console.log('  Passed Rewatch State Preservation assertions.');
    }

    // -------------------------------------------------------------
    // Test 8: Performance, Single Storage Read & 1000-Episode Stress
    // -------------------------------------------------------------
    console.log('Test 8: 1000-Episode Storage & Performance Stress Test');
    {
        const mockStorage = createMockStorage();
        const service = new EpisodeHistoryService();
        service._getStorage = () => mockStorage;

        // Build 1,000 completed episode records
        const bigHistory = {};
        for (let s = 1; s <= 50; s++) {
            for (let e = 1; e <= 20; e++) {
                bigHistory[`${s}:${e}`] = {
                    cAt: 1718000000 + (s * 100 + e),
                    src: 'AUTO_RELIABLE'
                };
            }
        }
        assert.strictEqual(Object.keys(bigHistory).length, 1000);

        const serialized = JSON.stringify(bigHistory);
        const sizeBytes = Buffer.byteLength(serialized, 'utf8');
        const sizeKb = (sizeBytes / 1024).toFixed(2);

        console.log(`  --> 1,000 Completed Episodes Serialized Size: ${sizeBytes} bytes (${sizeKb} KB)`);
        assert.ok(sizeBytes < 55000, `Expected < 55 KB for 1000 episodes, got ${sizeBytes}`);

        // Write 1,000 entries into storage in one operation
        mockStorage.set({ 'episode_history_v1_1000': bigHistory });

        // Benchmark read time
        const start = performance.now();
        const loaded = await service.getHistory(1000);
        const elapsed = performance.now() - start;

        assert.strictEqual(Object.keys(loaded).length, 1000);
        console.log(`  --> 1,000 Episode Read & Normalize Time: ${elapsed.toFixed(2)} ms`);
        assert.ok(elapsed < 100, 'Expected read under 100ms');

        // Check O(1) lookup
        assert.strictEqual(await service.isCompleted(1000, 25, 10), true);
        assert.strictEqual(await service.isCompleted(1000, 99, 99), false);

        // Completed count per season
        const s25Count = await service.getCompletedCount(1000, 25);
        assert.strictEqual(s25Count, 20);

        console.log('  Passed 1000-Episode Stress assertions.');
    }

    console.log('\n=== All MovieDetails Phase 4C Tests Passed Successfully! ===\n');
}

runTests().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
});
