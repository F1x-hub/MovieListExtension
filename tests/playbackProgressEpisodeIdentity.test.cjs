const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');

const SERIES = { kinopoiskId: 412344, title: 'Менталист', mediaType: 'tv-series', seasonNumber: 1, providerId: 'kinogo' };

function harness() {
    const saves = [];
    const controller = new PlaybackController({
        progressService: { saveProgress: async (movieId, payload) => { saves.push({ movieId, ...payload }); } }
    });
    controller.episodeHistoryService = null;
    const last = () => saves.at(-1);
    return { controller, saves, last };
}

test('a time report without the episode keeps the episode the player shows', () => {
    const { controller, last } = harness();
    controller.setSelection({ ...SERIES, episodeNumber: 7, source: 'PROVIDER_SWITCH' });
    // An Allplay frame (KinoGo) cannot read its own menus, so it reports the time alone.
    controller.handleProgressUpdate({ timestamp: 22, movieId: 412344 });
    assert.equal(last().season, '1 сезон');
    assert.equal(last().episode, '7 серия',
        'saved without the episode, every report erased it and «Смотреть» started the series at S1E1');
    assert.equal(last().timestamp, 22);
});

test('a film\'s time report stays a film\'s', () => {
    const { controller, last } = harness();
    controller.setSelection({ kinopoiskId: 301, title: 'Матрица', mediaType: 'movie' });
    controller.handleProgressUpdate({ timestamp: 1200, movieId: 301 });
    assert.equal(last().season, null);
    assert.equal(last().episode, null);
    assert.equal(last().timestamp, 1200);
});

test('a report that names the episode still wins over the selection', () => {
    const { controller, last } = harness();
    // Nothing canonical yet (no source chosen), so the provider's own episode is accepted.
    controller.setSelection({ ...SERIES, episodeNumber: 2, source: 'HERO_WATCH', providerId: null });
    controller.handleProgressUpdate({ season: 'Сезон 1', episode: 'Серия 3', timestamp: 340, movieId: 412344 });
    assert.equal(Number(String(last().episode).match(/\d+/)?.[0]), 3);
    assert.equal(last().timestamp, 340);
    assert.equal(controller.getSelection().episodeNumber, 3);
});

test('moving to another episode does not give it the old episode\'s time', async () => {
    const { controller, saves, last } = harness();
    controller.setSelection({ ...SERIES, episodeNumber: 1, source: 'PROVIDER_SWITCH' });
    controller.handleProgressUpdate({ timestamp: 133, movieId: 412344 });
    controller.setSelection({ ...SERIES, episodeNumber: 2, source: 'PLAYER_NAVIGATION', initialTimestamp: 0 });
    assert.deepEqual([last().episode, last().timestamp], ['1 серия', 133], 'the old episode keeps its time');
    // Closing or moving on before the new episode reports flushes again.
    await controller.flushProgress({ force: true });
    assert.deepEqual([last().episode, last().timestamp], ['2 серия', 0],
        'the flush saved episode 1\'s 2:13 as episode 2\'s position');
    assert.ok(saves.every(save => !(save.episode === '2 серия' && save.timestamp === 133)));
});

test('a resume selection keeps its own position until the episode reports', async () => {
    const { controller, last } = harness();
    controller.setSelection({ ...SERIES, episodeNumber: 3, source: 'PROVIDER_SWITCH' });
    controller.handleProgressUpdate({ timestamp: 50, movieId: 412344 });
    controller.setSelection({ ...SERIES, episodeNumber: 6, source: 'RESUME', initialTimestamp: 1335 });
    await controller.flushProgress({ force: true });
    assert.deepEqual([last().episode, last().timestamp], ['6 серия', 1335]);
});

test('the provider\'s own move to another episode starts it from the beginning', () => {
    const { controller } = harness();
    controller.setSelection({ ...SERIES, episodeNumber: 6, source: 'PROVIDER_SWITCH', initialTimestamp: 1366 });
    controller.updateSelection({ seasonNumber: 1, episodeNumber: 7, providerId: 'kinogo' });
    assert.equal(controller.getSelection().episodeNumber, 7);
    assert.equal(controller.getSelection().initialTimestamp, 0, 'a later remount would seek episode 7 to 22:46');

    controller.updateSelection({ providerId: 'exfs', source: 'PROVIDER_SWITCH', initialTimestamp: 90 });
    controller.updateSelection({ providerId: 'kinogo', source: 'PROVIDER_SWITCH' });
    assert.equal(controller.getSelection().initialTimestamp, 90, 'a source switch on the same episode keeps its position');
});

test('an in-place episode change in an open player resets the position too', async () => {
    const { controller, last } = harness();
    controller.registerAdapter({
        id: 'kinogo', label: 'KinoGo', canHandle: () => true, canApplySelection: () => true,
        getSelectionMode: () => 'NATIVE_BRIDGE', supportsEpisodePicker: () => true, applySelection: async () => true
    });
    controller.setSelection({ ...SERIES, episodeNumber: 4, source: 'PROVIDER_SWITCH' });
    controller.setActiveProvider('kinogo');
    controller.isOpen = true;
    controller.handleProgressUpdate({ timestamp: 610, movieId: 412344 });
    const result = await controller.applySelection({ ...SERIES, episodeNumber: 5, source: 'PLAYER_PROVIDER_PICKER', initialTimestamp: 0 });
    assert.equal(result.status, 'PENDING_NATIVE_UI');
    assert.deepEqual(controller.getRuntimeState().mediaIdentity, { kinopoiskId: 412344, seasonNumber: 1, episodeNumber: 5 });
    await controller.flushProgress({ force: true });
    assert.deepEqual([last().episode, last().timestamp], ['5 серия', 0]);
});
