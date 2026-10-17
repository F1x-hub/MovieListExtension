const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');
const start = source.indexOf('    async changeVideoSource(');
const nextMethod = source.indexOf('    async loadParserSource(', start);
const end = source.lastIndexOf('\n    }', nextMethod);
assert.ok(start > 0 && end > start);
const method = source.slice(start, end + '\n    }'.length);

(async () => {
    let releaseSave;
    const saveGate = new Promise(resolve => { releaseSave = resolve; });
    const scope = { performance, MEDIA_PLAYER_TORRENT_SOURCE: 'mediaplayer:torrent', window: { WatchSourcePolicy: {
        createRun: (movieId, manual) => ({ movieId, manual, attempted: new Set() }),
        save: async (_id, url) => { if (url === 'parser:animego') await saveGate; }
    } } };
    vm.runInNewContext(`globalThis.TestManager = class { ${method} };`, scope);
    const manager = Object.assign(new scope.TestManager(), {
        selectedMovie: { kinopoiskId: 42 }, proPlayerEnabled: true, sourceSwitchRequestId: 0,
        playerRegistry: {}, activeSourceValue: null, loaded: [], detached: 0,
        beginSourceSwitchRequest() { return ++this.sourceSwitchRequestId; },
        isSourceSwitchRequestCurrent(id, movieId) { return id === this.sourceSwitchRequestId && String(movieId) === String(this.selectedMovie.kinopoiskId); },
        closeEpisodePicker() {}, getWatchInnerValues: () => ['parser:animego', 'parser:seasonvar'],
        updateActiveSourceButton(value) { this.activeSourceValue = value; },
        playbackController: { detachExternalVideo() { manager.detached++; }, setActiveProvider() {}, getSelection: () => null },
        updateSourceGuidance() {}, updatePlayerHeaderTitle() {}, updatePlayerNavigationControls() {},
        saveLastSource: async () => {},
        async loadParserSource(id) { this.loaded.push(id); return true; }
    });
    const first = manager.changeVideoSource('parser:animego', { userInitiated: true });
    assert.equal(await manager.changeVideoSource('parser:seasonvar', { userInitiated: true }), true);
    assert.equal(manager.activeSourceValue, 'parser:seasonvar');
    releaseSave();
    assert.equal(await first, false);
    assert.equal(manager.activeSourceValue, 'parser:seasonvar', 'late first storage write cannot restore stale source state');
    assert.equal(manager.detached, 1, 'stale continuation cannot detach current video');
    assert.deepEqual(manager.loaded, ['seasonvar']);
    assert.equal(manager.playerMetricsAttempt.providerId, 'seasonvar');
    console.log('Watch source storage race test passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
