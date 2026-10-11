const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { isSeriesMedia, resolveWatchTarget } = require('../src/shared/services/player/PlaybackSelection.js');

function createHarness(language = 'ru') {
    const dom = new JSDOM('<div class="movie-detail-info-container"><div class="movie-detail-short-description"></div></div>');
    const addEventListener = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (type, ...args) => {
        if (type !== 'DOMContentLoaded') addEventListener(type, ...args);
    };
    const listeners = new Set();
    let pending = null;
    const context = vm.createContext({
        window: dom.window, document: dom.window.document, console: { ...console, error: () => {} },
        isSeriesMedia, resolveWatchTarget,
        chrome: { storage: { onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } } },
        setTimeout: fn => { pending = fn; return 1; },
        clearTimeout: () => { pending = null; }
    });
    vm.runInContext(fs.readFileSync('src/shared/i18n/locales.js', 'utf8').replace('export const locales', 'const locales') + '\nglobalThis.testLocales = locales;', context);
    context.i18n = { get(key) {
        return key.split('.').reduce((value, part) => value?.[part], context.testLocales[language]) || key;
    } };
    vm.runInContext(fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8').replace(/^import .*;\r?$/gm, ''), context);
    const manager = Object.create(context.window.MovieDetailsManager.prototype);
    manager.pageGeneration = 1;
    manager.activePageContext = { generation: 1, kinopoiskId: '42' };
    manager.selectedMovie = {
        kinopoiskId: 42, name: 'Series', isSeries: true,
        seasons: [{ number: 1, episodes: [{ episodeNumber: 1, name: '<Title>' }, { episodeNumber: 2, name: 'Two' }] }],
        nextEpisode: { seasonNumber: 1, episodeNumber: 4, name: 'Future', airDate: '2099-01-01' }
    };
    manager.currentProgressRecord = { season: 1, episode: 1, timestamp: 10, duration: 100, completed: false };
    manager.currentWatchTarget = { reason: 'RESUME_IN_PROGRESS' };
    manager.currentEpisodeHistory = {};
    manager.updateSeasonsBrowserState = () => {};
    manager.updateEpisodeChartScrollControls = () => {};
    return { manager, dom, listeners, flushTimer: () => { const fn = pending; pending = null; fn?.(); }, hasTimer: () => !!pending };
}

async function run() {
    const { manager: m, dom, listeners, flushTimer, hasTimer } = createHarness();
    const doc = dom.window.document;
    m.patchHeroEpisodeCard();
    const button = doc.querySelector('.hero-continue-button');
    assert(button.textContent.includes('Продолжить · S1E1 <Title>'));
    assert.equal(button.type, 'button');
    assert.equal(button.getAttribute('aria-label'), 'Продолжить просмотр S1E1');
    assert.equal(button.querySelector('title'), null, 'episode titles are escaped');
    assert(doc.querySelector('.hero-next-episode-content').textContent.includes('S1E4'));
    button.focus();
    m.currentProgressRecord.timestamp = 45;
    m.patchHeroEpisodeCard();
    assert.equal(doc.querySelector('.hero-continue-button'), button, 'timestamp does not replace the button');
    assert.equal(button.dataset.timestamp, '45');
    assert.equal(doc.activeElement, button);
    const selections = [];
    m.playSelection = value => selections.push(value);
    m.handleContinueWatching();
    doc.body.insertAdjacentHTML('beforeend', m.renderSeasonsContinueBanner(m.selectedMovie, m.currentProgressRecord, m.currentWatchTarget, m.selectedMovie.seasons));
    m.handleContinueWatching();
    assert.deepEqual(selections[0], selections[1], 'both surfaces share canonical selection');
    assert.equal(selections[0].initialTimestamp, 45);
    assert.equal(selections[0].episodeTitle, '<Title>');
    assert.equal(selections[0].source, 'RESUME');
    m.currentProgressRecord.episode = 2;
    m.patchHeroEpisodeCard();
    assert.equal(doc.activeElement, doc.querySelector('.hero-continue-button'), 'focus survives target changes');
    assert(doc.activeElement.textContent.includes('S1E2 Two'));
    delete m.selectedMovie.nextEpisode;
    m.patchHeroEpisodeCard();
    assert(doc.querySelector('.hero-next-episode-card--continue-only'));
    assert.equal(doc.querySelector('.hero-next-episode-header'), null);
    m.selectedMovie.status = 'ended';
    assert(m.renderHeroNextEpisode(m.selectedMovie).includes('continue-watch-progress'));
    m.currentProgressRecord.completed = true;
    m.currentWatchTarget = { reason: 'NEXT_AFTER_COMPLETED', seasonNumber: 2, episodeNumber: 1, episodeTitle: 'Next' };
    m.handleContinueWatching();
    assert.equal(selections.at(-1).seasonNumber, 2);
    assert.equal(selections.at(-1).initialTimestamp, 0);
    m.currentWatchTarget.reason = 'FINAL_EPISODE_COMPLETED';
    assert.equal(m.renderHeroNextEpisode(m.selectedMovie), '');
    m.currentProgressRecord = null;
    assert.equal(m.getContinueWatchingAction(), null);
    m.selectedMovie.status = 'returning';
    m.selectedMovie.nextEpisode = { seasonNumber: 1, episodeNumber: 4 };
    assert(m.renderHeroNextEpisode(m.selectedMovie).includes('play-next-episode'));
    assert(!m.renderHeroNextEpisode(m.selectedMovie).includes('continue-watch-progress'));
    m.currentProgressRecord = { season: NaN, episode: 1 };
    m.currentWatchTarget = { reason: 'RESUME_IN_PROGRESS' };
    assert.equal(m.getContinueWatchingAction(), null);
    m.currentProgressRecord.season = 0;
    assert.equal(m.getContinueWatchingAction().seasonNumber, 0, 'specials retain season zero');

    const en = createHarness('en').manager;
    assert(en.renderHeroNextEpisode(en.selectedMovie).includes('Continue · S1E1'));
    assert(en.renderSeasonsContinueBanner(en.selectedMovie, en.currentProgressRecord, en.currentWatchTarget).includes('Continue watching'));
    assert(en.renderHeroNextEpisode(en.selectedMovie).includes('Next episode'));

    const hydrate = createHarness().manager;
    delete hydrate.selectedMovie.seasons;
    hydrate.progressService = { getProgress: async () => ({ season: 1, episode: 1, timestamp: 12, completed: false }) };
    hydrate.episodeHistoryService = { getHistory: async () => ({}) };
    await hydrate._hydrateSeasonsProgressAndHistory(hydrate.selectedMovie, null);
    assert.equal(hydrate.currentProgressRecord.timestamp, 12, 'resume hydrates even without a seasons list');
    const race = createHarness().manager;
    let resolveOldProgress;
    race.progressService = { getProgress: () => new Promise(resolve => { resolveOldProgress = resolve; }) };
    race.episodeHistoryService = { getHistory: async () => ({}) };
    const refresh = race.refreshSeasonsProgress();
    race.beginPageGeneration(99);
    race.selectedMovie = { kinopoiskId: 99, isSeries: true };
    resolveOldProgress({ season: 1, episode: 1, timestamp: 300 });
    await refresh;
    assert.equal(race.currentProgressRecord, null, 'late progress reads cannot overwrite the next movie');

    let reads = 0;
    m.progressService = { getProgress: async () => { reads++; return { season: 1, episode: 2, timestamp: 77, completed: false }; } };
    m.episodeHistoryService = { getHistory: async () => ({}) };
    m.bindProgressUpdates(m.selectedMovie);
    m.bindProgressUpdates(m.selectedMovie);
    assert.equal(listeners.size, 1);
    const listener = [...listeners][0];
    listener({ watching_progress_99: {} }, 'local');
    listener({ watching_progress_42: {} }, 'sync');
    assert(!hasTimer());
    for (let i = 0; i < 20; i++) listener({ watching_progress_42: {} }, 'local');
    flushTimer();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 1, 'writes coalesce');
    assert(doc.querySelector('.hero-continue-button').textContent.includes('S1E2'));
    assert.equal(doc.querySelector('.hero-continue-button').dataset.timestamp, '77');
    m.progressService.getProgress = async () => null;
    listener({ watching_progress_42: {} }, 'local');
    flushTimer();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(doc.querySelector('.hero-continue-button'), null, 'deleting progress removes resume');
    listener({ watching_progress_42: {} }, 'local');
    m.resetMovieStateForNavigation('99');
    assert.equal(listeners.size, 0);
    assert(!hasTimer());
    assert.equal(m.currentProgressRecord, null);
    m.selectedMovie = { kinopoiskId: 99, isSeries: true };
    m.activePageContext = { generation: 2, kinopoiskId: '99' };
    listener({ watching_progress_42: {} }, 'local');
    assert(!hasTimer(), 'old callbacks cannot affect a new movie');
    m.bindProgressUpdates(m.selectedMovie);
    m.invalidatePageGeneration();
    assert.equal(listeners.size, 0, 'unload removes subscription');
    console.log('MovieDetails hero continuation: real manager behavior passed');
}

module.exports = { createHarness };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
