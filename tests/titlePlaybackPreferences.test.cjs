const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { create } = require('../src/shared/services/player/WatchPreferences.js');
const source = name => fs.readFileSync(`src/shared/services/parsers/${name}.js`, 'utf8');

(async () => {
    const dom = new JSDOM('<div id="player"></div>', { runScripts: 'outside-only', url: 'https://extension.test/' });
    const { window } = dom;
    const data = { watchPrefs_123: { innerId: 'parser:animego' } };
    window.WatchPreferences = create({ storage: {
        get: async () => structuredClone(data), set: async patch => Object.assign(data, structuredClone(patch))
    }, locks: null });
    window.eval(source('BaseParserService'));
    window.eval(source('AnimeGoParser'));
    window.eval(source('SeasonvarParser'));
    const anime = new window.AnimeGoParser();
    anime.setPreferredTranslation('anime-1', 'dub-7', 123);
    await window.WatchPreferences.get(123);
    assert.equal(data.watchPrefs_123.innerId, 'parser:animego');
    assert.equal(data.watchPrefs_123.providers.animego.translationId, 'dub-7');
    await window.WatchPreferences.patch(123, { providers: { animego: { qualityHeight: 720 } } });
    const restored = new window.AnimeGoParser();
    await restored.restoreTitlePreferences(123, 'anime-1');
    assert.equal(restored._preferredHeight, 720);
    assert.equal(restored.orderByPreferredTranslation([{ translationId: 'dub-1' }, { translationId: 'dub-7' }], 'anime-1')[0].translationId, 'dub-7');
    await restored.restoreTitlePreferences(124, 'anime-2');
    assert.equal(restored._preferredHeight, null);
    assert.equal(restored._lastPreferredTranslation, null, 'another title does not inherit a global dub preference');
    let resolveRead;
    const normalPreferences = window.WatchPreferences;
    window.WatchPreferences = { get: () => new Promise(resolve => { resolveRead = resolve; }) };
    const stale = restored.restoreTitlePreferences(123, 'anime-1', () => false);
    resolveRead({ providers: { animego: { translationId: 'wrong', qualityHeight: 2160 } } });
    await stale;
    assert.equal(restored._preferredHeight, null);
    const raced = restored.restoreTitlePreferences(123, 'anime-1');
    restored.setPreferredTranslation('anime-1', 'explicit-dub');
    resolveRead({ providers: { animego: { translationId: 'saved-dub' } } });
    await raced;
    assert.equal(restored._preferredTranslationByAnime.get('anime-1'), 'explicit-dub', 'late restore cannot override explicit choice');
    window.WatchPreferences = normalPreferences;
    const container = window.document.getElementById('player');
    const low = { height: 360, url: 'https://cloud.solodcdn.com/low.m3u8' };
    const high = { height: 720, url: 'https://cloud.solodcdn.com/high.m3u8' };
    container.__animegoNativeState = { streams: [high, low], stream: low, options: { movieId: 123 } };
    restored.buildMountSources = () => [];
    restored.swapNativeStream = () => true;
    restored.mountNativeBridge = () => {};
    assert.equal(restored.switchNativeQuality(container, 720), true);
    await normalPreferences.get(123);
    assert.equal(data.watchPrefs_123.providers.animego.qualityHeight, 720);
    assert.equal(data.watchPrefs_123.innerId, 'parser:animego');

    container.innerHTML = '<video id="seasonvarVideo" src="https://media.example/episode6.mp4"></video>'
        + '<div class="seasonvar-voiceover-item active" data-id="0" data-url="https://seasonvar.ru/default"></div>'
        + '<div class="seasonvar-voiceover-item" data-id="7" data-url="https://seasonvar.ru/dub7"></div>';
    const video = container.querySelector('video');
    let sourceChanges = 0;
    video.pause = () => { sourceChanges++; };
    video.load = () => { sourceChanges++; };
    container.__seasonvarPlaybackState = { activeEpisodeNumber: 6, activeEpisodeUrl: video.src, activeSeasonNumber: 3 };
    const seasonvar = new window.SeasonvarParser();
    const states = [];
    window.PlayerSourceLifecycle = { setState: (_container, state, details) => states.push({ state, details }) };
    seasonvar.fetchAndParsePlaylist = async () => [{ name: '1 серия', episodeNumber: 1, url: 'https://media.example/episode1.mp4' }];
    seasonvar._attachListeners(container, { movieId: 123 });
    container.querySelector('[data-id="7"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(sourceChanges, 0, 'missing exact episode does not pause or replace current media');
    assert.equal(container.__seasonvarPlaybackState.activeEpisodeNumber, 6);
    assert.equal(video.src, 'https://media.example/episode6.mp4');
    assert.equal(container.querySelector('[data-id="0"]').classList.contains('active'), true);
    assert.equal(states.at(-1).state, 'unavailable');
    assert.equal(data.watchPrefs_123.providers.seasonvar, undefined, 'failed dub is not persisted');
    await normalPreferences.patch(123, { providers: { seasonvar: { translationId: '7' } } });
    const renderSeasonvar = new window.SeasonvarParser();
    renderSeasonvar.handleProgressRestoration = async () => {};
    renderSeasonvar._attachListeners = () => {};
    renderSeasonvar._postPlaybackState = () => {};
    renderSeasonvar.fetchAndParsePlaylist = async () => [{ name: '6 серия', episodeNumber: 6, url: 'https://media.example/dub7-episode6.mp4' }];
    await renderSeasonvar.renderPlayer(container, [{ name: '6 серия', episodeNumber: 6, url: 'https://media.example/episode6.mp4' }], {
        movieId: 123, season: 3, episode: 6, translations: [{ id: '7', name: 'Dub', url: 'https://seasonvar.ru/dub7' }]
    });
    assert.equal(container.__seasonvarPlaybackState.activeEpisodeNumber, 6);
    assert.equal(container.__seasonvarPlaybackState.activeEpisodeUrl, 'https://media.example/dub7-episode6.mp4', 'saved stable dub restores exact episode');
    dom.window.close();
    console.log('Title playback preferences tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
