import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import PersonDetailsService from '../src/shared/services/PersonDetailsService.js';
import KinopoiskPersonHtmlService from '../src/shared/services/KinopoiskPersonHtmlService.js';
import KinopoiskService from '../src/shared/services/KinopoiskService.js';
import { PersonDetailsPageController } from '../src/pages/person-details/person-details.js';

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const rawKp = { id: 10, name: 'Person', movies: [
    { id: 100, name: 'First', enProfession: 'actor', year: 2020, rating: 8 },
    { id: 101, name: 'Second', enProfession: 'actor', year: 2021, rating: 7 },
    { id: 102, name: 'Third', enProfession: 'actor', year: 2022, rating: 6 }
] };
const rawTmdb = { id: 20, name: 'Person', combined_credits: { cast: [
    { id: 200, title: 'Film', media_type: 'movie', release_date: '2020-01-01', vote_count: 100 }
], crew: [] } };
const store = {};
let storageReads = [];
globalThis.chrome = { storage: { local: {
    async get(keys) {
        storageReads.push(keys);
        return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, store[key]]));
    },
    async set(items) { Object.assign(store, JSON.parse(JSON.stringify(items))); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; }
} } };

// Base data never starts poster work, pending cache is repairable, complete cache is network-free.
{
    let providerCalls = 0, posterCalls = 0;
    const gate = deferred();
    delete store.person_details_v3_kp_10;
    const service = new PersonDetailsService({
        kinopoiskService: { async getPersonDetails() { providerCalls++; return rawKp; } },
        kinopoiskPersonHtmlService: { async getMoviePostersByIds(ids, options) {
            posterCalls++;
            await gate.promise;
            const result = new Map(ids.map(id => [id, `https://example.com/${id}.jpg`]));
            for (const [id, url] of result) options.onPoster(id, url);
            return result;
        } }
    });
    const base = await service.getPersonDetails('kp:10', { forceRefresh: true });
    assert.equal(posterCalls, 0);
    assert.equal(base._meta.enrichment.status, 'pending');
    assert.equal(store.person_details_v3_kp_10.data._meta.enrichment.status, 'pending');
    const cached = await service.getPersonDetails('kp:10');
    const work = service.enrichPersonDetails(cached);
    assert.equal(posterCalls, 1);
    gate.resolve();
    await work;
    assert.equal(cached.knownFor[0].posterSource, 'kp-html');
    assert.equal(cached.filmography.acting[0].posterSource, 'kp-html');
    const warm = await service.getPersonDetails('kp:10');
    await service.enrichPersonDetails(warm);
    assert.equal(providerCalls, 1);
    assert.equal(posterCalls, 1);
    assert.equal(warm._meta.enrichment.status, 'complete');
}

// Mapping is deferred, signals/queue isolation are forwarded; failed mapping is never a complete cache hit.
{
    let calls = 0, mappingOptions;
    const gate = deferred();
    const service = new PersonDetailsService({
        tmdbService: { async getPersonDetails() { return rawTmdb; } },
        idMappingService: { async resolveBatch(items, options) {
            calls++; mappingOptions = options;
            return gate.promise;
        } },
        kinopoiskPersonHtmlService: null
    });
    const base = await service.getPersonDetails('tmdb:20', { forceRefresh: true });
    assert.equal(calls, 0);
    assert.equal(base.filmography.acting[0].tmdbId, 200);
    assert.equal(base.filmography.acting[0].kinopoiskId, null);
    const pending = service.enrichPersonDetails(base);
    assert.equal(mappingOptions.skipQueue, true);
    assert.ok(mappingOptions.signal instanceof AbortSignal);
    gate.resolve(new Map([['movie:200', { kinopoiskId: 300, status: 'resolved' }]]));
    await pending;
    assert.equal(base.knownFor[0].kinopoiskId, 300);
    assert.equal(base._meta.enrichment.status, 'complete');
    service.idMappingService.resolveBatch = async () => new Map([['movie:200', { status: 'unresolved' }]]);
    const failure = await service.getPersonDetails('tmdb:20', { forceRefresh: true });
    await service.enrichPersonDetails(failure);
    assert.equal(failure._meta.enrichment.status, 'partial');
}

// A hanging provider that ignores signals still respects the enrichment deadline; late results cannot publish.
{
    const gate = deferred();
    let updates = 0, signal;
    const service = new PersonDetailsService({
        tmdbService: { async getPersonDetails() { return rawTmdb; } },
        idMappingService: { async resolveBatch(items, options) { signal = options.signal; return gate.promise; } },
        kinopoiskPersonHtmlService: null
    });
    const base = await service.getPersonDetails('tmdb:20', { forceRefresh: true });
    await service.enrichPersonDetails(base, { timeoutMs: 10, onUpdate() { updates++; } });
    assert.equal(signal.aborted, true);
    assert.equal(base._meta.enrichment.status, 'partial');
    gate.resolve(new Map([['movie:200', { kinopoiskId: 900 }]]));
    await flush();
    assert.equal(base.knownFor[0].kinopoiskId, null);
    assert.equal(updates, 0);
}

// Explicit cancellation preserves pending cache, suppresses late updates, and allows same-key retry.
{
    const gate = deferred();
    let updates = 0;
    const service = new PersonDetailsService({
        tmdbService: { async getPersonDetails() { return rawTmdb; } },
        idMappingService: { async resolveBatch() { return gate.promise; } },
        kinopoiskPersonHtmlService: null
    });
    const dto = await service.getPersonDetails('tmdb:20', { forceRefresh: true });
    const abort = new AbortController();
    const pending = service.enrichPersonDetails(dto, { signal: abort.signal, onUpdate() { updates++; } });
    abort.abort();
    await pending;
    gate.resolve(new Map([['movie:200', { kinopoiskId: 999 }]]));
    await flush();
    assert.equal(updates, 0);
    assert.equal(dto.knownFor[0].kinopoiskId, null);
    assert.equal(store.person_details_v3_tmdb_20.data._meta.enrichment.status, 'pending');

    const first = deferred(), second = deferred();
    let providerCalls = 0;
    service.tmdbService.getPersonDetails = async () => ++providerCalls === 1 ? first.promise : second.promise;
    const request = new AbortController();
    const old = service.getPersonDetails('tmdb:20', { forceRefresh: true, signal: request.signal });
    await flush();
    request.abort();
    const fresh = service.getPersonDetails('tmdb:20', { forceRefresh: true });
    await flush();
    assert.equal(providerCalls, 2, 'An aborted same-key request cannot poison a fresh load');
    first.resolve(rawTmdb);
    await old;
    assert.ok(service.inFlightRequests.has('tmdb:20'), 'Old completion cannot delete the new request');
    second.resolve(rawTmdb);
    await fresh;
}

// Offscreen title requests use their own cancellation keys; technical failures remain repairable.
{
    const gate = deferred(), requestKeys = [], cancelledKeys = [];
    chrome.runtime = { async sendMessage(message) { cancelledKeys.push(message.requestKey); } };
    const service = new PersonDetailsService({ kinopoiskPersonHtmlService: {
        async findMovieByTitle(titles, year, options) {
            requestKeys.push(options.requestKey);
            return gate.promise;
        }
    } });
    const abort = new AbortController();
    const pending = service._applyKinopoiskHtmlTitleMapping([
        { tmdbId: 1, name: 'Film', providerMediaType: 'movie', year: 2020 }
    ], { signal: abort.signal });
    abort.abort();
    gate.resolve({ kinopoiskId: 400 });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.deepEqual(cancelledKeys, requestKeys);
    service.kinopoiskPersonHtmlService.findMovieByTitle = async () => ({ failed: true, reason: 'TIMEOUT' });
    await assert.rejects(service._applyKinopoiskHtmlTitleMapping([{ tmdbId: 1, name: 'Film' }]), /unavailable/);
    delete chrome.runtime;
}

// Direct HTML deadline covers both fetch and a hanging response body; cancellation forwards to fetch.
{
    let captured;
    const html = new KinopoiskPersonHtmlService({ requestTimeoutMs: 10, fetchImpl: async (url, options) => {
        captured = options.signal;
        return { ok: true, text: () => new Promise(() => {}) };
    } });
    await assert.rejects(html._fetchHtml('https://example.com', 'test'), { name: 'TimeoutError' });
    assert.equal(captured.aborted, true);
    const abort = new AbortController();
    const pending = html._fetchHtml('https://example.com', 'test', { signal: abort.signal });
    abort.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(captured.aborted, true);
    const api = Object.create(KinopoiskService.prototype);
    api.baseUrl = 'https://api.example.com/v1.4';
    api._fetchWithRotation = async (url, options) => { captured = options.signal; return new Promise(() => {}); };
    await assert.rejects(api.getPersonDetails(10, { timeoutMs: 10 }), { name: 'TimeoutError' });
    assert.equal(captured.aborted, true);
}

// Poster batch cache read is one operation; known-for priority and max two fetches; warm kp-html entries skip lookup.
{
    const html = new KinopoiskPersonHtmlService({ fetchImpl: async () => { throw new Error('No network expected'); } });
    for (const id of [500, 501]) store[html.MOVIE_POSTER_CACHE_PREFIX + id] = { timestamp: Date.now(), posterUrl: `https://example.com/${id}.jpg` };
    storageReads = [];
    await html.getMoviePostersByIds([500, 501, 500], { reportFailure: true });
    assert.deepEqual(storageReads, [[html.MOVIE_POSTER_CACHE_PREFIX + 500, html.MOVIE_POSTER_CACHE_PREFIX + 501]]);
    let active = 0, maxActive = 0;
    const fetched = [];
    html.getMoviePosterById = async id => {
        fetched.push(id); active++; maxActive = Math.max(maxActive, active);
        await flush(); active--; return `https://example.com/${id}.jpg`;
    };
    await html.getMoviePostersByIds([1, 2, 3, 4]);
    assert.equal(maxActive, 2);
    const service = new PersonDetailsService({ kinopoiskPersonHtmlService: {
        async getMoviePostersByIds(ids) { assert.deepEqual(ids, [3, 2]); return new Map(); }
    } });
    await service._applyKinopoiskHtmlPosters({ acting: [
        { kinopoiskId: 1, posterSource: 'kp-html' }, { kinopoiskId: 2 }
    ] }, {}, null, [{ kinopoiskId: 3 }]);
    assert.deepEqual(fetched, [1, 2, 3, 4]);
}

// Controller renders before poster resolution; updates replace only affected cards, preserving hero/track/scroll/filter.
{
    const dom = new JSDOM('<div id="loadingState"></div><div id="errorState"></div><main id="personDetailsContainer"></main>');
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    window.i18n = { get: key => key };
    const configs = [];
    window.MovieCard = { create(data, options) {
        configs.push(options);
        const card = document.createElement('div');
        card.className = 'movie-card-component';
        card.innerHTML = '<a data-action="view-details" href="#"><img class="mc-poster"></a>';
        return card;
    } };
    delete store.person_details_v3_kp_10;
    const gate = deferred();
    const service = new PersonDetailsService({
        kinopoiskService: { async getPersonDetails() { return rawKp; } },
        kinopoiskPersonHtmlService: { async getMoviePostersByIds(ids, options) {
            await gate.promise;
            for (const id of ids) options.onPoster(id, `https://example.com/${id}.jpg`);
            return new Map();
        } }
    });
    const controller = new PersonDetailsPageController();
    controller.personDetailsService = service;
    controller.renderPerson = person => {
        controller.personContainer.innerHTML = '<header id="hero">Person</header><div id="knownForCarousel"></div><div id="filmographyGrid_acting"></div>';
        controller.mountMovieCards(person);
    };
    await controller.loadPerson('kp:10');
    assert.equal(controller.personContainer.style.display, 'flex');
    assert.equal(controller.currentPerson.knownFor[0].posterSource, null, 'First render must precede poster completion');
    const hero = document.getElementById('hero');
    const track = document.getElementById('knownForCarousel');
    const unaffectedGrid = document.getElementById('filmographyGrid_acting');
    track.scrollLeft = 170;
    assert.ok(configs.slice(0, 3).every(options => options.lazyPoster === false));
    assert.ok(configs.slice(3).every(options => options.lazyPoster === true));
    controller.activeMediaFilter = 'movie';
    gate.resolve();
    await flush(); await flush();
    assert.equal(document.getElementById('hero'), hero);
    assert.equal(document.getElementById('knownForCarousel'), track);
    assert.equal(document.getElementById('filmographyGrid_acting'), unaffectedGrid);
    assert.equal(track.scrollLeft, 170);
    assert.equal(controller.activeMediaFilter, 'movie');
    assert.equal(controller.currentPerson.knownFor[0].posterSource, 'kp-html');

    // Page exit aborts the current work. Switching routes prevents late base completion/error state.
    const gate2 = deferred();
    const calls = [];
    controller.personDetailsService = { getPersonDetails: (key, options) => {
        calls.push(options.signal);
        return key === 'kp:old' ? gate2.promise : Promise.resolve(controller.currentPerson);
    } };
    const old = controller.loadPerson('kp:old');
    await controller.loadPerson('kp:new');
    assert.equal(calls[0].aborted, true);
    gate2.resolve({ name: 'Stale' });
    await old;
    assert.equal(controller.currentPerson.name, 'Person');
    window.dispatchEvent(new window.Event('pagehide'));
    assert.equal(calls[1].aborted, true);
    dom.window.close();
    delete globalThis.window; delete globalThis.document;
}
// The filmography in a real DOM: role tabs, media filters, whole-row paging, sorting,
// credit lines on the cards, and late data that keeps the cards it can.
{
    const dom = new JSDOM('<div id="loadingState"></div><div id="errorState"></div><main id="personDetailsContainer"></main>', { url: 'https://example.test/person', pretendToBeVisual: true });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    const saved = new Map();
    const previousLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)) } });
    const { I18n } = await import('../src/shared/i18n/I18n.js');
    window.i18n = new I18n();
    window.i18n.currentLocale = 'ru';
    window.MovieCard = { create(data) {
        const card = document.createElement('div');
        card.className = 'movie-card-component mc-variant-search';
        card.innerHTML = `<a class="mc-poster-container" data-action="view-details" href="#"><img class="mc-poster"></a><div class="mc-content"><a class="mc-title mc-title-link" data-action="view-details" href="#">${data.movie.name}</a><div class="mc-meta-subtitle">${data.movie.year || ''}</div></div>`;
        return card;
    } };
    // Three columns: four rows are twelve cards.
    const computed = window.getComputedStyle.bind(window);
    window.getComputedStyle = (element, ...rest) => (element.classList?.contains('filmography-grid') ? { gridTemplateColumns: '150px 150px 150px' } : computed(element, ...rest));

    const nextYear = new Date().getFullYear() + 1;
    const person = {
        identity: { provider: 'TMDB', personKey: 'tmdb:1' },
        name: 'Актёр',
        knownForDepartment: 'Acting',
        knownFor: [],
        filmography: {
            acting: Array.from({ length: 14 }, (_, i) => ({
                tmdbId: 100 + i, providerMediaType: i % 4 === 0 ? 'tv' : 'movie', name: `Роль ${i}`, year: 2000 + i,
                releaseDate: `${2000 + i}-05-01`, character: `Персонаж ${i}`, episodeCount: i % 4 === 0 ? 3 : null,
                voteCount: 100 * i, rating: 7, category: 'acting'
            })),
            directing: [
                { tmdbId: 300, providerMediaType: 'movie', name: 'Скоро', year: nextYear, releaseDate: `${nextYear}-02-01`, jobs: ['Director'], category: 'directing' },
                { tmdbId: 301, providerMediaType: 'movie', name: 'Режиссура', year: 2015, releaseDate: '2015-01-01', jobs: ['Director', 'Co-Director'], category: 'directing' }
            ],
            self: [{ tmdbId: 400, providerMediaType: 'tv', name: 'Шоу', year: 2010, releaseDate: '2010-01-01', character: 'Self - Guest', category: 'self' }],
            writing: [], production: [], music: [], other: []
        }
    };
    const controller = new PersonDetailsPageController();
    controller.bindGlobalEvents();
    controller.currentPerson = person;
    controller.renderPerson(person);

    const grid = role => document.getElementById(`filmographyGrid_${role}`);
    const titles = role => Array.from(grid(role).querySelectorAll('.mc-title')).map(link => link.textContent);
    const moreButton = () => document.querySelector('.btn-show-more-filmography');
    const roleButtons = Array.from(document.querySelectorAll('[data-action="filter-filmography-role"]'));
    assert.deepStrictEqual(roleButtons.map(button => button.dataset.role), ['acting', 'directing', 'self'], 'The main role leads the tabs');
    assert.deepStrictEqual(roleButtons.map(button => button.querySelector('[data-count]').textContent), ['14', '2', '1']);
    assert.equal(document.getElementById('filmographyTotal').textContent, '17');
    assert.equal(grid('acting').children.length, 12, 'Four whole rows of three');
    assert.deepStrictEqual(titles('acting').slice(0, 3), ['Роль 13', 'Роль 12', 'Роль 11'], 'Newest first');
    const second = grid('acting').children[1];
    assert.equal(second.querySelector('.person-credit__role').textContent, 'Персонаж 12', 'The card names the character');
    assert.equal(second.querySelector('.person-credit__episodes').textContent, '3 эпизода', 'A series names the episodes');
    assert.equal(moreButton().textContent.trim(), 'Показать ещё 2');
    const mediaCounts = () => Array.from(document.querySelectorAll('[data-action="filter-filmography"] [data-count]')).map(count => count.textContent);
    assert.deepStrictEqual(mediaCounts(), ['14', '10', '4']);

    const firstCard = grid('acting').children[0];
    moreButton().focus();
    moreButton().click();
    assert.equal(grid('acting').children.length, 14, 'Show more adds the next rows');
    assert.equal(grid('acting').children[0], firstCard, 'Cards already shown are kept');
    assert.equal(moreButton().hidden, true, 'No button once everything shows');
    assert.ok(document.activeElement?.classList.contains('mc-title-link'), 'Focus moves to the first new card');

    const tvButton = document.querySelector('[data-filter="tv"]');
    tvButton.click();
    assert.deepStrictEqual(titles('acting'), ['Роль 12', 'Роль 8', 'Роль 4', 'Роль 0'], 'Series only');
    assert.equal(document.querySelector('[data-filter="tv"]'), tvButton, 'Choices update in place and keep focus');
    assert.equal(tvButton.getAttribute('aria-pressed'), 'true');

    const sort = document.getElementById('filmographySort');
    sort.value = 'oldest';
    sort.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.deepStrictEqual(titles('acting'), ['Роль 0', 'Роль 4', 'Роль 8', 'Роль 12'], 'Oldest first');
    assert.equal(saved.get('personFilmographySortV1'), 'oldest', 'The order is remembered');
    sort.value = 'newest';
    sort.dispatchEvent(new window.Event('change', { bubbles: true }));

    roleButtons[1].click();
    assert.ok(grid('directing'), 'Directing has its own grid');
    assert.equal(controller.activeMediaFilter, 'all', 'A filter the role has nothing for falls back to all');
    assert.equal(document.querySelector('[data-filter="tv"]').disabled, true);
    assert.deepStrictEqual(titles('directing'), ['Скоро', 'Режиссура']);
    assert.equal(grid('directing').children[0].querySelector('.person-credit__status')?.textContent, 'Анонс', 'A later premiere is announced beside its year');
    assert.equal(grid('directing').children[0].querySelector('.person-credit'), null, 'A plain director credit repeats nothing');
    assert.equal(grid('directing').children[1].querySelector('.person-credit__role').textContent, 'Сорежиссёр', 'The precise job is shown');
    roleButtons[2].click();
    assert.equal(grid('self').children[0].querySelector('.person-credit__role').textContent, 'Guest', '«Self» is dropped from the part');
    assert.equal(roleButtons[2].getAttribute('aria-pressed'), 'true');

    // Late data: a changed card is replaced, the rest are kept and reordered.
    roleButtons[0].click();
    const kept = Array.from(grid('acting').children);
    const updated = JSON.parse(JSON.stringify(person));
    updated.filmography.acting[13].posterUrl = 'https://example.test/13.jpg';
    updated.filmography.acting[1].releaseDate = '2030-01-01';
    updated.filmography.acting[1].year = 2030;
    controller.updateEnrichedCards(updated);
    assert.deepStrictEqual(titles('acting').slice(0, 2), ['Роль 1', 'Роль 13'], 'A late date moves its title to the top');
    const after = Array.from(grid('acting').children);
    assert.equal(after.length, 12, 'Still four rows');
    assert.ok(!kept.includes(after[0]) && !kept.includes(after[1]), 'The moved title and the new poster get new cards');
    assert.equal(after.filter(card => kept.includes(card)).length, 10, 'Every other card is kept');

    window.getComputedStyle = computed;
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousLocalStorage });
    dom.window.close();
    delete globalThis.window; delete globalThis.document;
}
// Character names translated on the device by Chrome's Translator API, by themselves.
{
    const { default: CharacterNameTranslator } = await import('../src/shared/services/CharacterNameTranslator.js');
    const parts = CharacterNameTranslator.parts('Victor Stone / Cyborg (озвучка)');
    assert.deepEqual(parts, [{ base: 'Victor Stone', notes: '' }, { base: 'Cyborg', notes: ' (озвучка)' }], 'Each name keeps the notes after it');
    assert.equal(CharacterNameTranslator.needsTranslation('Patrick Jane'), true);
    assert.equal(CharacterNameTranslator.needsTranslation('Шурик'), false, 'A Cyrillic name is left alone');
    assert.equal(CharacterNameTranslator.needsTranslation('Шурик (озвучка)'), false, 'A Cyrillic note stays');
    assert.equal(CharacterNameTranslator.needsTranslation('Гость (Self)'), true, 'A note in Latin letters is translated too');
    assert.equal(CharacterNameTranslator.needsTranslation('Сосед / Neighbour'), true);
    assert.deepEqual(
        CharacterNameTranslator.segments('Grace Rigsby (Van Pelt) (озвучка) / Мама (1990)').filter(segment => segment.latin).map(segment => segment.text),
        ['Grace Rigsby', 'Van Pelt'],
        'Names and Latin notes are translated; Cyrillic notes and years stay'
    );

    const dom = new JSDOM('<span class="role">Patrick Jane</span><span class="role">Victor Stone / Cyborg (озвучка)</span><span class="role">Шурик</span>');
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    const delay = CharacterNameTranslator.ACTIVATION_DELAY_MS;
    CharacterNameTranslator.ACTIVATION_DELAY_MS = 5;
    const warn = console.warn;
    console.warn = () => {};
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const settle = async () => { for (let i = 0; i < 4; i++) await flush(); };
    const click = target => target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const dictionary = { 'Patrick Jane': 'Патрик Джейн', 'Victor Stone': 'Виктор Стоун', Cyborg: 'Киборг', 'Grace Rigsby': 'Грейс Ригсби', 'Van Pelt': 'Ван Пелт' };
    const translated = [];
    const created = [];
    const model = { async translate(text) { translated.push(text); return dictionary[text] || text; } };
    const makeApi = (availability, create = () => Promise.resolve(model)) => ({
        async availability(options) {
            assert.deepEqual(options, { sourceLanguage: 'en', targetLanguage: 'ru' });
            return availability;
        },
        create(options) {
            created.push(options.targetLanguage);
            return create();
        }
    });
    const kept = {};
    const storage = {
        async get(keys) { return Object.fromEntries([].concat(keys).map(key => [key, kept[key]])); },
        async set(items) { Object.assign(kept, JSON.parse(JSON.stringify(items))); }
    };
    const roles = () => document.querySelectorAll('.role');
    const texts = () => Array.from(roles(), node => node.textContent);
    const originalLabel = name => `Оригинал: ${name}`;
    const restore = () => roles().forEach(node => {
        if (node.dataset.characterOriginal === undefined) return;
        node.textContent = node.dataset.characterOriginal;
        delete node.dataset.characterOriginal;
        node.removeAttribute('title');
    });

    // A model to download: Chrome allows it only with a user activation, so nothing
    // asks for it before the reader interacts with the page.
    const activation = { isActive: true };
    const download = deferred();
    const translator = new CharacterNameTranslator({ translatorApi: makeApi('downloadable', () => download.promise), storage, eventTarget: dom.window, userActivation: activation });
    const control = translator.autoTranslate({ elements: roles, originalLabel });
    assert.equal(control.active, true, 'The Russian interface translates without a button');
    await settle();
    assert.deepEqual(created, [], 'Nothing is downloaded before an interaction');
    assert.equal(texts()[0], 'Patrick Jane');

    // Starting the download uses the activation up: the page's own handlers go first,
    // and an activation they used up is left for the next interaction.
    activation.isActive = false;
    click(document.body);
    await wait(25);
    assert.deepEqual(created, [], 'An activation the page used up is left alone');
    activation.isActive = true;
    click(document.body);
    click(document.body);
    assert.deepEqual(created, [], 'The click goes to the page first');
    await wait(25);
    assert.deepEqual(created, ['ru'], 'A moment after the click the model download starts, once');
    download.resolve(model);
    await control.ready;
    assert.deepEqual(texts(), ['Патрик Джейн', 'Виктор Стоун / Киборг (озвучка)', 'Шурик'], 'Every Latin part is translated; notes and Cyrillic names stay');
    assert.equal(roles()[0].title, 'Оригинал: Patrick Jane', 'The original stays in the tooltip');
    assert.equal(roles()[0].dataset.characterOriginal, 'Patrick Jane');
    click(document.body);
    await wait(25);
    assert.deepEqual(created, ['ru'], 'Later clicks start nothing');
    await translator.flush();
    assert.ok(kept.characterNameTranslationsV1.some(([source, value]) => source === 'Patrick Jane' && value === 'Патрик Джейн'), 'Translations are kept for later pages');
    control.destroy();
    restore();
    const dedupe = new CharacterNameTranslator({ translatorApi: makeApi('available'), storage: null, eventTarget: null });
    await dedupe.create();
    translated.length = 0;
    await Promise.all([dedupe.translateText('Patrick Jane'), dedupe.translateText('Patrick Jane (озвучка)')]);
    assert.deepEqual(translated, ['Patrick Jane'], 'A name asked for twice at once goes to the model once');
    assert.equal(await dedupe.translateText('Grace Rigsby (Van Pelt) (озвучка)'), 'Грейс Ригсби (Ван Пелт) (озвучка)', 'A Latin note in parentheses is translated with the name');
    assert.equal(dedupe.cachedText('Grace Rigsby (Van Pelt) (озвучка)'), 'Грейс Ригсби (Ван Пелт) (озвучка)', 'and kept');
    assert.equal(dedupe.cachedText('Grace Rigsby (Unknown)'), null, 'A piece not translated yet waits for the model');
    assert.equal(dedupe.cachedText('(Van Pelt)'), '(Ван Пелт)', 'A text that starts with its note');
    await dedupe.flush();

    // A later page: kept translations show at once, with no model and no interaction.
    created.length = 0;
    translated.length = 0;
    const later = new CharacterNameTranslator({ translatorApi: makeApi('downloadable'), storage, eventTarget: null });
    const laterControl = later.autoTranslate({ elements: roles, originalLabel });
    await flush();
    assert.deepEqual(texts(), ['Патрик Джейн', 'Виктор Стоун / Киборг (озвучка)', 'Шурик'], 'Kept translations show before the model');
    assert.deepEqual([created, translated], [[], []], 'They need neither the model nor a click');
    laterControl.destroy();
    restore();

    // The model on the device, or one already downloading: no interaction needed.
    for (const availability of ['available', 'downloading']) {
        const ready = new CharacterNameTranslator({ translatorApi: makeApi(availability), storage: null, eventTarget: null, userActivation: { isActive: false } });
        const readyControl = ready.autoTranslate({ elements: roles, originalLabel });
        await readyControl.ready;
        assert.equal(texts()[0], 'Патрик Джейн', `${availability}: names translate as the page opens`);
        readyControl.destroy();
        restore();
    }
    assert.deepEqual(created, ['ru', 'ru'], 'Neither waits for an activation');

    // Chrome refuses a download it reports as under way without an activation: the next interaction.
    created.length = 0;
    const target = new dom.window.EventTarget();
    let refuse = true;
    const insist = new CharacterNameTranslator({
        translatorApi: makeApi('downloading', () => (refuse ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(model))),
        storage: null, eventTarget: target, userActivation: { isActive: true }
    });
    const insistControl = insist.autoTranslate({ elements: roles, originalLabel });
    await settle();
    assert.deepEqual(created, ['ru'], 'Tried at once');
    assert.equal(texts()[0], 'Patrick Jane');
    refuse = false;
    click(target);
    await insistControl.ready;
    assert.deepEqual(created, ['ru', 'ru']);
    assert.equal(texts()[0], 'Патрик Джейн', 'and again after the next interaction');
    insistControl.destroy();
    restore();

    // A start that keeps failing gives up after a few interactions.
    created.length = 0;
    const failingTarget = new dom.window.EventTarget();
    const failing = new CharacterNameTranslator({
        translatorApi: makeApi('downloadable', () => Promise.reject(new Error('NotAllowedError'))),
        storage: null, eventTarget: failingTarget, userActivation: { isActive: true }
    });
    const failingControl = failing.autoTranslate({ elements: roles, originalLabel });
    await settle();
    for (let attempt = 0; attempt <= CharacterNameTranslator.ACTIVATION_ATTEMPTS; attempt++) {
        click(failingTarget);
        await wait(25);
    }
    await failingControl.ready;
    assert.equal(created.length, CharacterNameTranslator.ACTIVATION_ATTEMPTS, 'Each failed start waits for the next interaction, a few times');
    assert.equal(texts()[0], 'Patrick Jane');

    // No Translator API, or the English interface: nothing to do.
    const unsupported = new CharacterNameTranslator({ translatorApi: undefined, storage }).autoTranslate({ elements: roles, originalLabel });
    const english = new CharacterNameTranslator({ translatorApi: makeApi('available'), storage }).autoTranslate({ elements: roles, originalLabel, enabled: false });
    await Promise.all([unsupported.ready, english.ready]);
    assert.deepEqual([unsupported.active, english.active], [false, false]);
    assert.equal(texts()[0], 'Patrick Jane');

    // A page that draws its names again stops the old control.
    const slow = deferred();
    const stale = new CharacterNameTranslator({ translatorApi: makeApi('available', () => slow.promise), storage: null, eventTarget: null });
    const staleControl = stale.autoTranslate({ elements: roles, originalLabel });
    await settle();
    staleControl.destroy();
    slow.resolve(model);
    await staleControl.ready;
    assert.equal(texts()[0], 'Patrick Jane', 'A replaced control translates nothing');

    CharacterNameTranslator.ACTIVATION_DELAY_MS = delay;
    console.warn = warn;
    dom.window.close();
    delete globalThis.window; delete globalThis.document;
}

// The person page translates role lines by itself in the Russian interface, also the
// cards that show later, and keeps the original names in English.
{
    const dom = new JSDOM('<div id="loadingState"></div><div id="errorState"></div><main id="personDetailsContainer"></main>', { url: 'https://example.test/person', pretendToBeVisual: true });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    const { I18n } = await import('../src/shared/i18n/I18n.js');
    window.i18n = new I18n();
    window.i18n.currentLocale = 'ru';
    window.MovieCard = { create(data) {
        const card = document.createElement('div');
        card.className = 'movie-card-component mc-variant-search';
        card.innerHTML = `<a class="mc-poster-container" data-action="view-details" href="#"><img class="mc-poster"></a><div class="mc-content"><a class="mc-title mc-title-link" data-action="view-details" href="#">${data.movie.name}</a><div class="mc-meta-subtitle">${data.movie.year || ''}</div></div>`;
        return card;
    } };
    const { default: CharacterNameTranslator } = await import('../src/shared/services/CharacterNameTranslator.js');
    const kept = {};
    CharacterNameTranslator.instance = new CharacterNameTranslator({
        translatorApi: { availability: async () => 'available', create: async () => ({ translate: async text => `RU:${text}` }) },
        storage: { async get(keys) { return Object.fromEntries([].concat(keys).map(key => [key, kept[key]])); }, async set(items) { Object.assign(kept, items); } },
        eventTarget: null
    });
    window.CharacterNameTranslator = CharacterNameTranslator;
    const person = {
        identity: { provider: 'TMDB', personKey: 'tmdb:2' },
        name: 'Актёр',
        knownFor: [],
        filmography: {
            acting: Array.from({ length: 30 }, (_, i) => ({ tmdbId: 500 + i, providerMediaType: 'movie', name: `Фильм ${i}`, year: 2000 + i, releaseDate: `${2000 + i}-01-01`, character: `Hero ${i}`, category: 'acting' })),
            directing: [], writing: [], production: [], music: [], self: [], other: []
        }
    };
    const controller = new PersonDetailsPageController();
    controller.bindGlobalEvents();
    controller.currentPerson = person;
    controller.renderPerson(person);
    assert.equal(document.querySelector('[data-action="translate-character-names"]'), null, 'No button: the names translate by themselves');
    await controller.characterTranslation.ready;
    for (let i = 0; i < 6; i++) await flush();
    const roleLines = () => Array.from(document.querySelectorAll('#filmographyGrid_acting .person-credit__role'));
    const roleTexts = () => roleLines().map(node => node.textContent);
    assert.equal(roleTexts()[0], 'RU:Hero 29', 'Role lines are translated once the model is there');
    assert.equal(roleLines()[0].title, 'Оригинал: Hero 29', 'The original name is in the tooltip');
    document.querySelector('.btn-show-more-filmography').click();
    for (let i = 0; i < 6; i++) await flush();
    assert.ok(roleTexts().length > 24 && roleTexts().every(text => text.startsWith('RU:')), 'Cards added later are translated too');

    window.i18n.currentLocale = 'en';
    controller.renderPerson(person);
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(controller.characterTranslation, null, 'The English interface translates nothing');
    assert.equal(roleTexts()[0], 'Hero 29');
    CharacterNameTranslator.instance = null;
    dom.window.close();
    delete globalThis.window; delete globalThis.document;
}
console.log('PersonDetails progressive rendering, cache, deadline, cancellation and carousel regressions passed.');
