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
    delete store.person_details_v2_kp_10;
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
    assert.equal(store.person_details_v2_kp_10.data._meta.enrichment.status, 'pending');
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
    assert.equal(store.person_details_v2_tmdb_20.data._meta.enrichment.status, 'pending');

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
    delete store.person_details_v2_kp_10;
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
console.log('PersonDetails progressive rendering, cache, deadline, cancellation and carousel regressions passed.');
