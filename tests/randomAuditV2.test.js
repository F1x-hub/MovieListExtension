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
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

// Only browser/network/timing boundaries are controlled. All page, card,
// confirmation and pool logic below comes from the production source files.
function harness() {
    const dom = new JSDOM(read('src/pages/random/random.html'), { url: 'https://random.test/' });
    const document = dom.window.document;
    const timeouts = new Map();
    const intervals = new Map();
    const images = [];
    const storageListeners = new Set();
    const storage = {};
    const writes = [];
    const audio = [];
    const frames = [];
    let timerId = 0;
    let failWrites = false;
    let writeDelay = null;
    const i18n = {
        currentLocale: 'ru',
        get(key) { return key.split('.').reduce((value, part) => value?.[part], locales[this.currentLocale]) ?? key; },
        async init() { this.currentLocale = 'en'; },
        translatePage() {}
    };
    class Image {
        constructor() { images.push(this); }
        set src(value) { this.url = value; }
        get src() { return this.url; }
    }
    class Audio {
        constructor() {}
        stop() { audio.push('stop'); }
        finish() { audio.push('finish'); }
        startSpin() { audio.push('spin'); }
        setVolume() {}
    }
    const chrome = {
        runtime: { getURL: value => `https://random.test/${value}`, onMessage: { addListener() {} } },
        storage: {
            onChanged: {
                addListener: fn => storageListeners.add(fn),
                removeListener: fn => storageListeners.delete(fn)
            },
            local: {
                async get(key) { return { [key]: structuredClone(storage[key]) }; },
                async set(values) {
                    if (writeDelay) await writeDelay;
                    if (failWrites) throw new Error('Storage unavailable');
                    writes.push(structuredClone(values));
                    Object.assign(storage, structuredClone(values));
                }
            }
        }
    };
    dom.window.i18n = i18n;
    dom.window.matchMedia = () => ({ matches: false });
    const context = {
        document, window: dom.window, HTMLElement: dom.window.HTMLElement,
        localStorage: dom.window.localStorage, Event: dom.window.Event, URL,
        console: { log() {}, warn() {}, error() {} }, i18n, chrome, Image,
        RandomWheelAudio: Audio, KinopoiskService: class {
            sortMoviesByRelevance(docs) { return docs; }
        },
        setTimeout: (fn, delay) => { const id = ++timerId; timeouts.set(id, { fn, delay }); return id; },
        clearTimeout: id => timeouts.delete(id),
        setInterval: fn => { const id = ++timerId; intervals.set(id, fn); return id; },
        clearInterval: id => intervals.delete(id),
        getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
        requestAnimationFrame: callback => frames.push(callback), performance: { now: () => 0 }
    };
    for (const file of [
        'src/shared/utils/PosterUrl.js',
        'src/shared/services/RandomPoolService.js',
        'src/shared/components/MovieCard.js',
        'src/shared/components/ConfirmDialog.js',
        'src/shared/components/ImageLightbox.js'
    ]) {
        runInNewContext(read(file), context);
    }
    context.MovieCard = dom.window.MovieCard;
    runInNewContext(`${pageCode.replace(/^import .*;\r?\n/gm, '').split('// Initialize')[0]}\nglobalThis.RandomManager = RandomManager;`, context);
    context.RandomManager.prototype.init = () => {};
    const manager = new context.RandomManager();
    manager.populateFilterData();
    manager.renderTags();
    manager.setupSliders();
    const element = id => document.getElementById(id);
    const tick = async delay => {
        for (const [id, timer] of [...timeouts]) {
            if (timer.delay !== delay) continue;
            timeouts.delete(id);
            timer.fn();
        }
        await flush();
    };
    const input = (id, value) => {
        element(id).value = value;
        element(id).dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    };
    const key = (target, value, shiftKey = false) => {
        const event = new dom.window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event;
    };
    return {
        dom, context, manager, document, element, input, key, tick, timeouts, intervals,
        images, storage, writes, audio, frames, storageListeners,
        failWrites(value) { failWrites = value; },
        delayWrites(promise) { writeDelay = promise; },
        dispose() { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); }
    };
}

// Native activation and accessible tri-state buttons, including language changes.
{
    const h = harness();
    const { manager, element, document } = h;
    let rolls = 0;
    manager.findRandomMovie = async () => { rolls++; };
    manager.setupEventListeners();
    element('rollDiceBtn').click();
    assert.equal(rolls, 1, 'Native click activation must reach the roll handler');
    const header = element('configHeader');
    assert.equal(header.tagName, 'BUTTON');
    assert.equal(header.getAttribute('aria-controls'), 'configBody');
    header.click();
    assert.equal(header.getAttribute('aria-expanded'), 'true');
    header.click();
    assert.equal(header.getAttribute('aria-expanded'), 'false');
    const tag = element('typeTags').querySelector('[data-value="movie"]');
    assert.equal(tag.tagName, 'BUTTON');
    assert.equal(tag.type, 'button');
    const descriptions = new Set();
    for (const state of ['neutral', 'include', 'exclude']) {
        assert.equal(tag.dataset.state, state);
        assert.ok(tag.getAttribute('aria-label') || tag.getAttribute('aria-description'), 'Each state needs a readable description');
        descriptions.add(tag.getAttribute('aria-label') + tag.getAttribute('aria-description'));
        tag.click();
    }
    assert.equal(descriptions.size, 3, 'The three filter states must have distinct accessible descriptions');
    tag.click();
    manager.currentMovie = { kinopoiskId: 42, name: 'Retained movie', year: 2024 };
    await manager.displayMovie(manager.currentMovie);
    const oldCard = element('movieResult').firstElementChild;
    oldCard.querySelector('.cmc-reload-btn').focus();
    // Navigation can update shared i18n before Random receives the same message.
    h.context.i18n.currentLocale = 'en';
    await manager.handleSettingsUpdate({ language: 'en' });
    assert.equal(element('typeTags').querySelector('[data-value="movie"]').dataset.state, 'include');
    assert.ok(element('movieResult').textContent.includes('Retained movie'));
    assert.notEqual(element('movieResult').firstElementChild, oldCard, 'Language refresh recreates the displayed card safely');
    assert.equal(document.activeElement.classList.contains('cmc-reload-btn'), true, 'Card refresh preserves focused action');
    assert.equal(rolls, 1, 'Changing language must not request a new random movie');
    const pendingLocale = deferred();
    h.context.i18n.init = () => pendingLocale.promise;
    const refresh = manager.handleSettingsUpdate({ language: 'ru' });
    element('typeTags').querySelector('[data-value="movie"]').click();
    h.context.i18n.currentLocale = 'ru';
    pendingLocale.resolve();
    await refresh;
    assert.equal(element('typeTags').querySelector('[data-value="movie"]').dataset.state, 'exclude', 'Filter edits while locale loading must survive refresh');
    element('resetFiltersBtn').click();
    assert.equal(document.querySelector('.tag-btn[data-value="movie"]').dataset.state, 'neutral');
    h.dispose();
}

// The reload delay and final result transition belong to the current request.
{
    const h = harness();
    await h.manager.displayMovie({ kinopoiskId: 1, name: 'Current' });
    const reload = h.document.querySelector('.cmc-reload-btn');
    let requests = 0;
    h.manager.kinopoiskService.getRandomMovie = async () => {
        requests++;
        return { kinopoiskId: 2, name: 'Next', posterUrl: 'https://attacker.test/x.jpg' };
    };
    reload.click();
    reload.click();
    assert.equal([...h.timeouts.values()].filter(timer => timer.delay === 300).length, 1);
    h.manager.resetFilters();
    await h.tick(300);
    assert.equal(requests, 0, 'Reset must cancel queued reload');
    const roll = h.manager.findRandomMovie();
    await flush();
    assert.equal(requests, 1);
    assert.ok(!h.element('skeletonPosterImg').src.includes('attacker.test'));
    await h.manager.findRandomMovie();
    assert.equal(requests, 1, 'Busy covers the 350ms poster transition');
    h.manager.resetFilters();
    await roll;
    await h.tick(350);
    assert.equal(h.element('initialState').style.display, 'block', 'Cancelled result timer cannot show a stale card');
    const success = h.manager.findRandomMovie();
    await flush();
    await h.tick(350);
    await success;
    assert.equal(h.element('movieResult').style.display, 'flex');
    h.dispose();
}

// Saved pairs are restored together and normalized at bounds, without selectors from storage.
{
    const h = harness();
    h.dom.window.localStorage.setItem('random_filter_preferences', JSON.stringify({
        year: { from: 1900, to: 1905 }, rating: { from: 10, to: 1 },
        votes: { from: 2000000, to: 2000000 },
        types: ['"]:invalid([', 'movie'], excludeGenres: ['комедия']
    }));
    assert.doesNotThrow(() => h.manager.loadPreferences());
    assert.equal(h.element('yearFrom').value, '1900');
    assert.equal(h.element('yearTo').value, '1905', 'A low saved pair must not be clamped against previous default min');
    for (const [prefix, gap] of [['rating', 0.5], ['votes', 1000]]) {
        assert.ok(Number(h.element(`${prefix}To`).value) - Number(h.element(`${prefix}From`).value) >= gap);
    }
    assert.equal(h.element('typeTags').querySelector('[data-value="movie"]').dataset.state, 'include');
    assert.equal(h.element('genreTags').querySelector('[data-value="комедия"]').dataset.state, 'exclude');
    h.dom.window.localStorage.setItem('random_filter_preferences', '{broken');
    assert.doesNotThrow(() => h.manager.loadPreferences());
    h.dom.window.localStorage.setItem('random_filter_preferences', 'null');
    assert.doesNotThrow(() => h.manager.loadPreferences());
    h.dom.window.localStorage.setItem('random_filter_preferences', JSON.stringify({
        year: { from: -100, to: 9999 }, rating: { from: null, to: 'bad' }, votes: { from: '', to: {} }
    }));
    h.manager.loadPreferences();
    assert.equal(h.element('yearFrom').value, '1900');
    assert.equal(h.element('yearTo').value, '2030');
    assert.equal(h.element('ratingFrom').value, '7');
    assert.equal(h.element('ratingTo').value, '10');
    assert.equal(h.element('votesFrom').value, '10000');
    assert.equal(h.element('votesTo').value, '2000000');
    h.dispose();
}

// Real async flow ignores duplicate rolls and invalidates late responses on reset/pagehide.
{
    const h = harness();
    const pending = deferred();
    let requests = 0;
    h.manager.kinopoiskService.getRandomMovie = () => { requests++; return pending.promise; };
    const first = h.manager.findRandomMovie();
    await h.manager.findRandomMovie();
    assert.equal(requests, 1);
    h.manager.resetFilters();
    pending.resolve({ kinopoiskId: 1, name: 'Stale movie', posterUrl: 'https://image.tmdb.org/t/p/w500/one.jpg' });
    await first;
    assert.equal(h.element('initialState').style.display, 'block');
    assert.equal(h.element('movieResult').children.length, 0);
    const later = deferred();
    h.manager.kinopoiskService.getRandomMovie = () => later.promise;
    const second = h.manager.findRandomMovie();
    h.dom.window.dispatchEvent(new h.dom.window.Event('pagehide'));
    later.resolve({ kinopoiskId: 2, name: 'After leave' });
    await second;
    assert.equal(h.element('movieResult').children.length, 0);
    assert.equal(h.intervals.size, 0);
    assert.equal(h.timeouts.size, 0);
    h.dispose();
}

// Auth completing after pagehide cannot create a marathon service or resurrect its listeners.
for (const fails of [false, true]) {
    const h = harness();
    const auth = deferred();
    let services = 0;
    h.context.firebaseManager = { waitForAuthReady: () => auth.promise };
    h.context.RandomMarathonService = class { constructor() { services++; } };
    const initializing = h.manager.initMarathon();
    h.dom.window.dispatchEvent(new h.dom.window.Event('pagehide'));
    if (fails) auth.reject(new Error('Auth unavailable'));
    else auth.resolve();
    await initializing;
    assert.equal(services, 0);
    assert.equal(h.manager._marathonAuthHandler, undefined);
    h.dispose();
}

// Render errors are caught by the real page; empty and network states offer different actions.
{
    const h = harness();
    h.manager.setupEventListeners();
    h.manager.kinopoiskService.getRandomMovie = async () => null;
    await h.manager.findRandomMovie();
    const emptyText = h.element('errorState').textContent;
    assert.equal(h.element('errorState').style.display, 'flex');
    h.input('yearFrom', '2005');
    let filters;
    h.manager.kinopoiskService.getRandomMovie = async value => { filters = value; throw new Error('Offline'); };
    await h.manager.findRandomMovie();
    assert.notEqual(h.element('errorState').textContent, emptyText);
    h.element('tryAgainBtn').click();
    await flush();
    assert.equal(filters.yearFrom, '2005', 'Retry after a network error must preserve filters');
    h.manager.kinopoiskService.getRandomMovie = async () => ({ kinopoiskId: 3, name: 'Crash' });
    h.context.MovieCard.createCompactDetail = () => { throw new Error('Render failure'); };
    await h.manager.findRandomMovie();
    assert.equal(h.element('errorState').style.display, 'flex');
    h.dispose();
}

// Debounce and query generations apply to both search modes, including stale failures.
for (const mode of ['Pool', 'Marathon']) {
    const h = harness();
    h.manager.marathonService = {};
    h.manager.setupPoolListeners();
    const id = mode === 'Pool' ? 'pool' : 'marathon';
    const requests = [];
    h.manager.kinopoiskService.searchMovies = query => {
        const request = deferred();
        requests.push({ query, ...request });
        return request.promise;
    };
    h.manager.kinopoiskService.sortMoviesByRelevance = docs => docs;
    h.input(`${id}SearchInput`, 'old');
    await h.tick(mode === 'Pool' ? 1000 : 500);
    assert.equal(requests.length, 1);
    h.input(`${id}SearchInput`, 'new');
    assert.equal(h.element(`${id}SearchResults`).innerHTML, '', 'Changing query must clear results before the debounce expires');
    await h.tick(mode === 'Pool' ? 1000 : 500);
    requests[1].resolve({ docs: [{ kinopoiskId: 9, name: 'Latest' }] });
    await flush();
    requests[0].resolve({ docs: [{ kinopoiskId: 8, name: 'Obsolete' }] });
    await flush();
    assert.ok(h.element(`${id}SearchResults`).textContent.includes('Latest'));
    assert.ok(!h.element(`${id}SearchResults`).textContent.includes('Obsolete'));
    assert.ok(h.element(`${id}SearchResults`).querySelector('a[href*="movieId=9"]'), 'Both search modes need keyboard-accessible details links');
    h.input(`${id}SearchInput`, 'pending');
    await h.tick(mode === 'Pool' ? 1000 : 500);
    h.input(`${id}SearchInput`, '');
    requests[2].reject(new Error('Late error'));
    await flush();
    assert.equal(h.element(`${id}SearchResults`).innerHTML, '');
    assert.equal(h.element(`${id}SearchResults`).classList.contains('hidden'), true);
    assert.equal(requests.length, 3);
    h.dispose();
}

{
    const h = harness();
    h.manager.marathonService = {};
    h.element('marathonSearchInput').value = 'malicious';
    h.manager.kinopoiskService.searchMovies = async () => ({ docs: [{
        kinopoiskId: 3, name: '<svg onload=alert(1)>', year: '<img onerror=alert(1)>',
        posterUrl: 'https://attacker.test/x.jpg'
    }] });
    await h.manager._searchForMarathon('malicious');
    const container = h.element('marathonSearchResults');
    assert.ok(container.textContent.includes('<svg onload=alert(1)>'));
    assert.equal(container.querySelector('[onload], [onerror]'), null);
    assert.ok(!container.innerHTML.includes('attacker.test'));
    h.dispose();
}

// Remote text never becomes HTML; unsafe srcs and nullable ratings degrade safely.
{
    const h = harness();
    const container = h.element('poolSearchResults');
    h.manager._renderSearchResults([
        { kinopoiskId: 1, name: '<img src=x onerror=alert(1)>', year: '<svg onload=alert(1)>', posterUrl: 'javascript:alert(1)', kpRating: null },
        { kinopoiskId: 2, name: 'String rating', posterUrl: 'https://image.tmdb.org/t/p/w500/safe.jpg', kpRating: '8.2' },
        { kinopoiskId: 3, name: 'Invalid rating', kpRating: 'not-a-number' }
    ], container);
    assert.ok(container.textContent.includes('<img src=x onerror=alert(1)>'));
    assert.equal(container.querySelector('[onerror], [onload], svg[onload]'), null);
    assert.ok(![...container.querySelectorAll('img')].some(img => img.src.startsWith('javascript:')));
    assert.ok(container.querySelector('.pool-result-sub').textContent.includes('—'));
    assert.ok(container.textContent.includes('8.2'));
    assert.ok(container.querySelector('a[href*="movieId=1"]'), 'Search rows must have keyboard-native details links');
    const poster = container.querySelector('img[src*="safe.jpg"]');
    assert.equal(poster.tabIndex, 0);
    assert.equal(poster.getAttribute('role'), 'button');
    h.key(poster, 'Enter');
    assert.equal(h.element('shared-image-lightbox-image').src, poster.src, 'Keyboard can open a search poster');
    h.manager.pool = [{ kpId: 1, title: 'Unsafe poster', poster: 'https://attacker.test/x.jpg' }];
    h.manager._renderPoolModal();
    assert.ok(!h.element('poolList').innerHTML.includes('attacker.test'));
    assert.ok(h.element('poolList').querySelector('a[href*="movieId=1"]'));
    h.dispose();
}

// Stopped image pre-cache callbacks cannot replace a newer selected poster.
{
    const h = harness();
    h.manager.pool = [{ kpId: 1, poster: 'https://image.tmdb.org/t/p/w500/old.jpg' }];
    h.manager._startPosterSpinning();
    assert.ok(h.images.length);
    const staleErrors = h.images.map(image => image.onerror).filter(Boolean);
    h.manager._stopPosterSpinning();
    h.element('skeletonPosterImg').src = 'https://image.tmdb.org/t/p/w500/winner.jpg';
    for (const error of staleErrors) error();
    assert.equal(h.element('skeletonPosterImg').src, 'https://image.tmdb.org/t/p/w500/winner.jpg');
    h.manager.pool = [
        { kpId: 1, poster: 'https://image.tmdb.org/t/p/w500/one.jpg' },
        { kpId: 2, poster: 'https://image.tmdb.org/t/p/w500/two.jpg' },
        { kpId: 3, poster: 'http://attacker.test/unsafe.jpg' }
    ];
    h.manager._startPosterSpinning();
    assert.equal(h.intervals.size, 1);
    assert.ok(!h.images.some(image => image.src.includes('attacker.test')));
    h.manager._startPosterSpinning();
    assert.equal(h.intervals.size, 1, 'Only one poster interval may remain after restarting');
    h.dom.window.dispatchEvent(new h.dom.window.Event('pagehide'));
    assert.equal(h.intervals.size, 0);
    assert.equal(h.audio.at(-1), 'stop');
    h.dispose();
}

// Mutations use the service's atomic commands and preserve a concurrent external add.
{
    const h = harness();
    h.manager.setupPoolListeners();
    h.storage.randomPool = [{ kpId: 10, title: 'Added in another page' }];
    h.manager.pool = [];
    h.manager._renderSearchResults([{ kinopoiskId: 20, name: 'Search add', year: 2024 }], h.element('poolSearchResults'));
    h.element('poolSearchResults').querySelector('.pool-result-add').click();
    await flush();
    assert.deepEqual(h.storage.randomPool.map(movie => movie.kpId), [10, 20]);
    assert.equal(h.element('poolCount').textContent, '2');
    h.manager._renderPoolModal();
    h.element('poolList').querySelector('.pool-list-item-remove').click();
    await flush();
    assert.deepEqual(h.storage.randomPool.map(movie => movie.kpId), [20]);
    h.manager.currentMovie = { kinopoiskId: 30, name: 'Failed add' };
    h.failWrites(true);
    const added = h.manager._addCurrentMovieToPool();
    if (added?.then) await added.catch(() => {});
    assert.deepEqual(Array.from(h.manager.pool, movie => movie.kpId), [20], 'Failed persistence must not leave a phantom movie');
    h.failWrites(false);
    h.dispose();
}

// Storage events update all Random pool affordances, including an already displayed card.
{
    const h = harness();
    await h.manager.loadPool();
    h.manager.setupPoolListeners();
    await h.manager.displayMovie({ kinopoiskId: 4, name: 'External addition' });
    h.element('showPoolBtn').click();
    assert.ok(h.storageListeners.size > 0);
    for (const listener of h.storageListeners) {
        listener({ randomPool: { newValue: [{ kpId: 4, title: 'External addition' }] } }, 'local');
    }
    await flush();
    assert.equal(h.element('poolCount').textContent, '1');
    assert.ok(h.element('poolList').textContent.includes('External addition'));
    assert.equal(h.document.querySelector('.cmc-pool-btn').classList.contains('in-pool'), true);
    for (const listener of h.storageListeners) listener({ randomPool: { newValue: [] } }, 'local');
    await flush();
    assert.equal(h.element('poolCount').textContent, '0');
    assert.equal(h.document.querySelector('.cmc-pool-btn').classList.contains('in-pool'), false);
    h.dispose();
    assert.equal(h.storageListeners.size, 0, 'Page leave removes storage listeners');
}

// Destructive clear uses the real shared confirmation; cancellation never writes.
{
    const h = harness();
    h.storage.randomPool = [{ kpId: 1, title: 'Keep me' }];
    await h.manager.loadPool();
    h.manager.setupPoolListeners();
    h.element('showPoolBtn').focus();
    h.element('showPoolBtn').click();
    h.element('clearPoolBtn').click();
    await flush();
    assert.equal(h.dom.window.ConfirmDialog.isOpen(), true);
    h.key(h.document.activeElement, 'Escape');
    await flush();
    assert.equal(h.dom.window.ConfirmDialog.isOpen(), false);
    assert.equal(h.element('poolModal').classList.contains('hidden'), false, 'Escape in confirmation must preserve underlying pool dialog');
    assert.equal(h.writes.length, 0);
    h.element('clearPoolBtn').click();
    await flush();
    h.document.querySelector('[data-confirm-dialog="confirm"]').click();
    await flush();
    assert.deepEqual(h.storage.randomPool, []);
    assert.equal(h.element('poolCount').textContent, '0');
    h.dispose();
}

// Pool dialog traps keyboard focus and respects the image lightbox above it.
{
    const h = harness();
    h.manager.pool = [{ kpId: 1, title: 'Modal movie' }];
    h.manager.setupPoolListeners();
    h.element('showPoolBtn').focus();
    h.element('showPoolBtn').click();
    const modal = h.element('poolModal');
    assert.equal(modal.getAttribute('role'), 'dialog');
    assert.ok(h.element(modal.getAttribute('aria-labelledby')));
    assert.equal(modal.contains(h.document.activeElement), true, 'Opening pool moves focus into its dialog');
    const first = h.element('closePoolModal');
    const last = h.element('rollFromPoolBtn');
    last.focus();
    assert.equal(h.key(last, 'Tab').defaultPrevented, true);
    assert.equal(h.document.activeElement, first);
    first.focus();
    assert.equal(h.key(first, 'Tab', true).defaultPrevented, true);
    assert.equal(h.document.activeElement, last);
    last.blur();
    assert.equal(h.document.activeElement, h.document.body);
    assert.equal(h.key(h.document.body, 'Tab').defaultPrevented, true, 'Tab recovers focus after an asynchronous render removes the focused node');
    assert.equal(h.document.activeElement, first);
    h.dom.window.ImageLightbox.show('https://image.tmdb.org/t/p/w500/one.jpg');
    while (h.frames.length) h.frames.shift()(0);
    h.key(h.document, 'Escape');
    assert.equal(modal.classList.contains('hidden'), false);
    assert.equal(h.element('shared-image-lightbox-overlay').classList.contains('visible'), false);
    h.key(last, 'Escape');
    assert.equal(modal.classList.contains('hidden'), true);
    assert.equal(h.document.activeElement, h.element('showPoolBtn'));
    h.dispose();
}

// Escape on the foreground wheel keeps the underlying marathon dialog open.
{
    const h = harness();
    h.manager.setupPoolListeners();
    h.manager._openModal('marathonModal', 'closeMarathonModal');
    h.manager._buildRollOverlay();
    h.manager._showRollReady([{ kpId: 1, title: 'One' }], () => {});
    h.key(h.document.activeElement, 'Escape');
    assert.equal(h.element('rollAnimOverlay').classList.contains('hidden'), true);
    assert.equal(h.element('marathonModal').classList.contains('hidden'), false);
    assert.equal(h.manager._activeModalId, 'marathonModal');
    h.dispose();
}

// Errors from remove and confirmed clear remain visible within the active dialog.
for (const action of ['remove', 'clear']) {
    const h = harness();
    h.storage.randomPool = [{ kpId: 1, title: 'Write failed' }];
    await h.manager.loadPool();
    h.manager.setupPoolListeners();
    h.element('showPoolBtn').click();
    h.failWrites(true);
    if (action === 'remove') h.element('poolList').querySelector('.pool-list-item-remove').click();
    else {
        h.element('clearPoolBtn').click();
        await flush();
        h.document.querySelector('[data-confirm-dialog="confirm"]').click();
    }
    await flush();
    const status = h.element('poolModalStatus');
    assert.ok(status, 'The pool dialog owns visible mutation feedback');
    assert.equal(h.element('poolModal').contains(status), true);
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.hidden, false);
    assert.equal(status.closest('.hidden'), null);
    assert.equal(status.textContent, h.context.i18n.get('random.pool.save_error'));
    assert.equal(h.element('poolModal').classList.contains('hidden'), false);
    assert.deepEqual(Array.from(h.manager.pool, movie => movie.kpId), [1]);
    h.dispose();
}

// A pending winner commit locks controls; a later animation invalidates its navigation and finally block.
{
    const h = harness();
    h.manager._buildRollOverlay();
    h.manager.pool = [{ kpId: 1, title: 'Old winner' }];
    h.storage.randomPool = structuredClone(h.manager.pool);
    h.manager._rollFromPool();
    h.frames.shift()(6000);
    const commit = deferred();
    h.delayWrites(commit.promise);
    h.element('rollGoBtn').click();
    await flush();
    assert.equal(h.manager.rollAnimRunning, true, 'Storage commit is part of the busy wheel lifecycle');
    assert.equal(h.element('rollCloseBtn').disabled, true);
    assert.equal(h.element('rollRerollBtn').disabled, true);
    h.element('rollCloseBtn').click();
    h.element('rollRerollBtn').click();
    assert.equal(h.element('rollAnimOverlay').classList.contains('hidden'), false);
    assert.equal(h.frames.length, 0, 'Disabled reroll cannot start another wheel');
    // A programmatic cancellation/replacement can still occur while storage is pending.
    h.manager._stopRollAnimation();
    h.manager._showRollAnimation([{ kpId: 2, title: 'New generation' }], 0);
    assert.equal(h.element('rollGoBtn').disabled, true);
    commit.resolve();
    await flush();
    assert.equal(h.dom.window.location.href, 'https://random.test/', 'Late winner commit must not navigate');
    assert.equal(h.element('rollAnimOverlay').classList.contains('hidden'), false, 'Late commit cannot close the replacement animation');
    assert.equal(h.manager.rollAnimRunning, true);
    assert.equal(h.element('rollGoBtn').disabled, true, 'An old finally cannot enable the new animation action');
    h.frames.shift()(6000);
    assert.equal(h.element('rollResult').textContent, 'New generation');
    h.dispose();
}

// Winner details remain a regular link; only Watch removes the pool entry, and write failure keeps the result open.
{
    const h = harness();
    h.manager._buildRollOverlay();
    h.manager.pool = [{ kpId: 1, title: 'Winner' }];
    h.storage.randomPool = structuredClone(h.manager.pool);
    h.manager._rollFromPool();
    h.frames.shift()(6000);
    const overlay = h.element('rollAnimOverlay');
    const link = h.document.querySelector('.roll-result-link');
    assert.equal(link.tagName, 'A');
    assert.ok(link.href.includes('movieId=1'));
    const modifiedClick = new h.dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    // Prevent JSDOM's unimplemented navigation after observing the page handlers.
    h.document.addEventListener('click', event => {
        if (event.target !== link) return;
        assert.equal(event.defaultPrevented, false);
        event.preventDefault();
    });
    link.dispatchEvent(modifiedClick);
    assert.equal(h.writes.length, 0, 'The details link must never remove a pool movie');
    assert.equal(h.element('rollPoolHint').hidden, false, 'Pool results must show the removal hint');
    assert.ok(/Смотреть.*пул|пул.*Смотреть/.test(h.element('rollPoolHint').textContent), 'The result explains removal when watching');
    h.failWrites(true);
    h.element('rollGoBtn').click();
    await flush();
    assert.equal(h.dom.window.location.href, 'https://random.test/');
    assert.equal(overlay.classList.contains('hidden'), false);
    assert.deepEqual(Array.from(h.manager.pool, movie => movie.kpId), [1]);
    assert.equal(h.element('rollGoBtn').disabled, false, 'Storage failure must leave a usable retry button');
    h.dispose();
}

console.log('Random audit v2: real-page activation, preferences, cancellation, searches, safe posters, pool mutations, pending commits, modal focus and language refresh passed.');
