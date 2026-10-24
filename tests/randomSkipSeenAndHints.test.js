// Behaviour of the Random page additions: skipping rated / recently shown movies,
// the collapsed filter summary and the "loosen one filter" suggestions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { locales } from '../src/shared/i18n/locales.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pageCode = read('src/pages/random/random.js');

// Only the network (Kinopoisk draws, Firestore rating lookups) is controlled;
// the page, filter controls and markup are the production sources.
function harness({ user = { uid: 'alice' }, ratedIds = [] } = {}) {
    const dom = new JSDOM(read('src/pages/random/random.html'), { url: 'https://random.test/' });
    const document = dom.window.document;
    const ratingQueries = [];
    const i18n = {
        currentLocale: 'ru',
        get(key) { return key.split('.').reduce((value, part) => value?.[part], locales[this.currentLocale]) ?? key; },
        async init() {},
        translatePage() {}
    };
    const ratingService = {
        async getUserRatingsForMovies(uid, ids) {
            ratingQueries.push({ uid, ids: [...ids] });
            return new Map(ids.filter(id => ratedIds.includes(Number(id))).map(id => [String(id), { rating: 8 }]));
        }
    };
    dom.window.i18n = i18n;
    dom.window.matchMedia = () => ({ matches: false });
    const context = {
        document, window: dom.window, HTMLElement: dom.window.HTMLElement,
        localStorage: dom.window.localStorage, Event: dom.window.Event, URL,
        console: { log() {}, warn() {}, error() {} }, i18n,
        chrome: { runtime: { getURL: value => value, onMessage: { addListener() {} } }, storage: { local: { async get() { return {}; }, async set() {} }, onChanged: { addListener() {}, removeListener() {} } } },
        Image: class {}, RandomWheelAudio: class { stop() {} setVolume() {} },
        KinopoiskService: class {},
        firebaseManager: {
            getCurrentUser: () => user,
            getRatingService: () => ratingService,
            waitForAuthReady: async () => user
        },
        setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
        getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
        requestAnimationFrame() {}, performance: { now: () => 0 }
    };
    for (const file of [
        'src/shared/config/discoveryFilters.js',
        'src/shared/components/FilterControls.js',
        'src/shared/utils/PosterUrl.js',
        'src/shared/services/RandomPoolService.js',
        'src/shared/components/MovieCard.js'
    ]) {
        runInNewContext(read(file), context);
    }
    context.MovieCard = dom.window.MovieCard;
    context.DiscoveryFilters = dom.window.DiscoveryFilters;
    context.FilterChoice = dom.window.FilterChoice;
    context.RangeControl = dom.window.RangeControl;
    runInNewContext(`${pageCode.replace(/^import .*;\r?\n/gm, '').split('// Initialize')[0]}\nglobalThis.RandomManager = RandomManager;`, context);
    context.RandomManager.prototype.init = () => {};
    const manager = new context.RandomManager();
    manager.populateFilterData();
    manager.renderTags();
    manager.setupSliders();
    return { dom, document, manager, ratingQueries, element: id => document.getElementById(id), dispose: () => dom.window.close() };
}

function drawsFrom(manager, movies) {
    const calls = [];
    manager.kinopoiskService.getRandomMovie = async filters => {
        calls.push(filters);
        const next = movies.shift();
        if (next instanceof Error) throw next;
        return next ?? null;
    };
    return calls;
}

// Recently shown and rated movies are skipped; the first unseen draw is returned.
{
    const h = harness({ ratedIds: [2] });
    h.dom.window.localStorage.setItem('random_recent_results', JSON.stringify(['1']));
    const calls = drawsFrom(h.manager, [{ id: 1, name: 'Recent' }, { id: 2, name: 'Rated' }, { id: 3, name: 'Fresh' }]);
    const movie = await h.manager._getUnseenRandomMovie({}, h.manager._requestId);
    assert.equal(movie.name, 'Fresh');
    assert.equal(calls.length, 3);
    assert.deepEqual(h.ratingQueries.map(query => query.ids), [[2], [3]], 'A recent movie needs no rating lookup');
    h.dispose();
}

// The number of Kinopoisk draws is bounded; the last draw is shown when all were seen.
{
    const h = harness({ ratedIds: [1, 2, 3, 4] });
    const calls = drawsFrom(h.manager, [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    const movie = await h.manager._getUnseenRandomMovie({}, h.manager._requestId);
    assert.equal(calls.length, 3, 'At most three API draws per roll');
    assert.equal(movie.id, 3);
    h.dispose();
}

// A rating answer is remembered per user, so a repeated draw costs no query.
{
    const h = harness({ ratedIds: [7] });
    drawsFrom(h.manager, [{ id: 7 }, { id: 7 }, { id: 8 }]);
    const movie = await h.manager._getUnseenRandomMovie({}, h.manager._requestId);
    assert.equal(movie.id, 8);
    assert.deepEqual(h.ratingQueries.map(query => query.ids), [[7], [8]]);
    h.dispose();
}

// A failing later draw keeps the movie already in hand; a failing first draw still fails.
{
    const h = harness({ ratedIds: [5] });
    drawsFrom(h.manager, [{ id: 5, name: 'Seen' }, new Error('quota')]);
    const movie = await h.manager._getUnseenRandomMovie({}, h.manager._requestId);
    assert.equal(movie.name, 'Seen');
    drawsFrom(h.manager, [new Error('offline')]);
    await assert.rejects(() => h.manager._getUnseenRandomMovie({}, h.manager._requestId), /offline/);
    h.dispose();
}

// With the toggle off a single draw is used and nothing is looked up.
{
    const h = harness({ ratedIds: [1] });
    h.element('skipSeenToggle').checked = false;
    const calls = drawsFrom(h.manager, [{ id: 1 }, { id: 2 }]);
    const movie = await h.manager._getUnseenRandomMovie({}, h.manager._requestId);
    assert.equal(movie.id, 1);
    assert.equal(calls.length, 1);
    assert.equal(h.ratingQueries.length, 0);
    h.dispose();
}

// Guests only skip recent results; no rating service is queried.
{
    const h = harness({ user: null, ratedIds: [1] });
    drawsFrom(h.manager, [{ id: 1 }]);
    assert.equal((await h.manager._getUnseenRandomMovie({}, h.manager._requestId)).id, 1);
    assert.equal(h.ratingQueries.length, 0);
    h.dispose();
}

// Shown results are recorded newest first, without duplicates, capped at 30.
{
    const h = harness();
    for (let id = 1; id <= 32; id++) h.manager._rememberRecentResult({ id });
    h.manager._rememberRecentResult({ id: 20 });
    const recent = JSON.parse(h.dom.window.localStorage.getItem('random_recent_results'));
    assert.equal(recent.length, 30);
    assert.equal(recent[0], '20');
    assert.equal(recent.filter(id => id === '20').length, 1);
    h.dispose();
}

// The collapsed header summarises ranges and chosen tags (exclusions marked).
{
    const h = harness();
    const genres = [...h.element('genreTags').querySelectorAll('.tag-btn')];
    h.manager._setTagState(genres[0], 'include');
    h.manager._setTagState(genres[1], 'exclude');
    h.manager.savePreferences();
    const summary = h.element('configSummary').textContent;
    const text = button => button.querySelector('.tag-text').textContent;
    assert.ok(summary.startsWith('1990–2026 · ★ 7.0–10.0'), summary);
    assert.ok(summary.includes(text(genres[0])));
    assert.ok(summary.includes(`−${text(genres[1])}`));
    h.dispose();
}

// An empty result offers only the relevant fixes; each one saves and rolls again.
{
    const h = harness();
    const genre = h.element('genreTags').querySelector('.tag-btn');
    h.manager._setTagState(genre, 'include');
    h.manager._lastRandomFilters = h.manager.getFilters();
    h.manager._showFailure('empty');
    const container = h.element('randomRelaxOptions');
    assert.equal(container.hidden, false);
    const buttons = [...container.querySelectorAll('button')];
    assert.deepEqual(buttons.map(button => button.textContent), [
        `Голосов от ${(1000).toLocaleString('ru')}`, 'Рейтинг от 6.0', 'Любой год', 'Снять жанры и страны'
    ]);
    let rolls = 0;
    h.manager.findRandomMovie = () => { rolls++; };
    buttons[0].click();
    assert.equal(h.element('votesFrom').value, '1000');
    assert.equal(rolls, 1);
    buttons[3].click();
    assert.equal(genre.dataset.state, 'neutral');
    assert.equal(JSON.parse(h.dom.window.localStorage.getItem('random_filter_preferences')).genres.length, 0);

    // Loose filters leave nothing to suggest: the block is hidden.
    h.manager._lastRandomFilters = { votesFrom: 0, ratingFrom: 1, yearFrom: 1900, yearTo: 2030, genres: [], countries: [] };
    h.manager._showFailure('empty');
    assert.equal(container.hidden, true);
    // A network failure never shows filter suggestions.
    h.manager._showFailure('network');
    assert.equal(container.hidden, true);
    h.dispose();
}

// A shown result gets a visible "roll again" that reuses the card's reload action.
{
    const h = harness();
    await h.manager.displayMovie({ kinopoiskId: 9, name: 'Shown' }, { transition: false });
    const again = h.element('movieResult').querySelector('.random-again-btn');
    assert.ok(again, 'The result has a visible roll-again button');
    assert.equal(again.dataset.action, 'reload');
    assert.equal(again.getAttribute('aria-keyshortcuts'), 'R');
    assert.ok(again.textContent.includes('Ещё раз'));
    h.dispose();
}

// "R" rolls again by physical key, but not while typing, with modifiers or over dialogs.
{
    const h = harness();
    let rolls = 0;
    h.manager.findRandomMovie = () => { rolls++; };
    h.manager._setupRollShortcut();
    const press = (target, init = {}) => target.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', {
        code: 'KeyR', key: 'r', bubbles: true, cancelable: true, ...init
    }));
    press(h.document.body);
    assert.equal(rolls, 1);
    press(h.document.body, { key: 'к' });
    assert.equal(rolls, 2, 'The Russian layout key on the same position also rolls');
    press(h.element('poolSearchInput'));
    press(h.document.body, { ctrlKey: true });
    press(h.document.body, { repeat: true });
    assert.equal(rolls, 2, 'Typing, modifiers and auto-repeat do not roll');
    h.manager._activeModalId = 'poolModal';
    press(h.document.body);
    assert.equal(rolls, 2, 'An open pool or marathon dialog blocks the shortcut');
    h.manager._activeModalId = null;
    h.manager._findBusy = true;
    press(h.document.body);
    assert.equal(rolls, 2, 'A roll in progress is not restarted');
    h.manager._findBusy = false;
    h.manager._cleanup();
    press(h.document.body);
    assert.equal(rolls, 2, 'The shortcut is removed on page cleanup');
    h.dispose();
}

// The hidden attribute wins over the block's flex display.
assert.match(read('src/pages/random/random.css'), /\.random-relax-options\[hidden\]\s*\{\s*display:\s*none;/);

console.log('Random skip-seen, filter summary, relax suggestions, roll-again button and R shortcut passed.');
