import assert from 'node:assert/strict';
import PersonDetailsService from '../src/shared/services/PersonDetailsService.js';
import KinopoiskService from '../src/shared/services/KinopoiskService.js';

// A Kinopoisk person's films come without posters, years, types and votes. One batch
// request gives them; film pages are read one by one only when it fails.
const store = {};
globalThis.chrome = { storage: { local: {
    async get(keys) { return Object.fromEntries([].concat(keys).map(key => [key, store[key]])); },
    async set(items) { Object.assign(store, JSON.parse(JSON.stringify(items))); },
    async remove(keys) { for (const key of [].concat(keys)) delete store[key]; }
} } };
const card = (kinopoiskId, extra = {}) => ({ kinopoiskId, posterUrl: `https://cdn.example/${kinopoiskId}.jpg`, year: 2001, mediaType: 'movie', ratingKp: 7.04, votesKp: 1000, ...extra });
const emptyPage = { async getPersonFilmographyById() { return { items: [] }; } };
const noFilmPages = { ...emptyPage, async getMoviePostersByIds() { throw new Error('Film pages must not be read'); } };
const rawOf = movies => ({ id: 10, name: 'Персона', movies });
const items = dto => Object.values(dto.filmography).flat();

// Every title has its poster, year, type and votes before the first render.
{
    const movies = [
        { id: 1, name: 'Хит', enProfession: 'actor', rating: 7 },
        { id: 2, name: 'Ток-шоу', enProfession: 'cameo', rating: 9.5 },
        { id: 3, name: 'Без постера', enProfession: 'actor', rating: 5 }
    ];
    const asked = [];
    let pageReads = 0;
    const service = new PersonDetailsService({
        kinopoiskService: {
            async getPersonDetails() { return rawOf(movies); },
            async getFilmCardsByIds(ids) {
                asked.push(ids);
                return [card(1, { votesKp: 900000, ratingKp: 8.14 }), card(2, { mediaType: 'tv', votesKp: 300 }), card(3, { posterUrl: null, votesKp: null })];
            }
        },
        kinopoiskPersonHtmlService: { ...noFilmPages, async getPersonFilmographyById() {
            pageReads++;
            return { items: [{ kinopoiskId: 3, posterUrl: 'https://cdn.example/page-3.jpg', providerMediaType: 'movie', roles: [{ character: 'Отец' }] }] };
        } }
    });
    const dto = await service.getPersonDetails('kp:10');
    assert.deepEqual(asked, [[1, 3, 2]], 'One request: roles first, appearances as themselves last');
    const first = dto.filmography.acting[0];
    assert.deepEqual([first.posterUrl, first.posterSource, first.year, first.releaseDate, first.rating, first.voteCount],
        ['https://cdn.example/1.jpg', 'kp', 2001, '2001-01-01', 8.1, 900000]);
    assert.equal(dto.filmography.self[0].providerMediaType, 'tv');
    assert.equal(dto.filmography.acting[1].posterUrl, null, 'A film without a poster stays without one');
    assert.deepEqual(dto.knownFor.map(item => item.kinopoiskId), [1, 2, 3], 'Known For follows votes, not the rating of a talk show');
    assert.equal(dto._meta.filmDetailsVersion, 1);
    assert.equal(store.person_details_v3_kp_10.data.filmography.acting[0].posterUrl, 'https://cdn.example/1.jpg', 'It is cached');

    await service.enrichPersonDetails(dto);
    assert.equal(dto._meta.enrichment.status, 'complete');
    assert.equal(dto.filmography.acting[1].characterLocal, 'Отец');
    assert.deepEqual([dto.filmography.acting[1].posterUrl, dto.filmography.acting[1].posterSource], ['https://cdn.example/page-3.jpg', 'kp-page'], 'The person page fills a missing poster');
    const again = await service.getPersonDetails('kp:10');
    await service.enrichPersonDetails(again);
    assert.equal(asked.length, 1, 'A reopened person asks for nothing');
    assert.equal(pageReads, 1);
}

// A cached person without the marker heals once, and its «no poster» pictures go away.
{
    const placeholder = 'https://clstorage.example/no-poster.png';
    const kept = id => ({ kinopoiskId: id, name: `Фильм ${id}`, posterUrl: placeholder, posterSource: 'kp-html', hasArtwork: true, category: 'acting' });
    const old = () => ({ timestamp: Date.now(), data: {
        identity: { provider: 'KP', personKey: 'kp:11', providerId: 11 },
        filmography: { acting: [kept(1), kept(2), kept(3), { kinopoiskId: 4, name: 'Пусто', posterUrl: null }] },
        knownFor: [kept(1)],
        _meta: { enrichment: { version: 1, status: 'partial' } }
    } });
    store.person_details_v3_kp_11 = old();
    let requests = 0;
    let fail = true;
    const service = new PersonDetailsService({
        kinopoiskService: {
            async getPersonDetails() { throw new Error('The person is cached'); },
            async getFilmCardsByIds() {
                requests++;
                if (fail) throw new Error('Kinopoisk daily quota exhausted');
                return [card(1), card(2, { posterUrl: null }), card(3), card(4)];
            }
        },
        kinopoiskPersonHtmlService: noFilmPages
    });
    const failed = await service.getPersonDetails('kp:11');
    assert.ok(items(failed).every(item => item.posterUrl === null), 'The shared picture is not a poster even when the batch fails');
    assert.equal(failed._meta.filmDetailsVersion, undefined, 'A failed batch leaves the marker for the next time');
    fail = false;
    const healed = await service.getPersonDetails('kp:11');
    assert.deepEqual(items(healed).map(item => item.posterUrl && item.posterUrl.slice(-6)), ['1.jpg', null, '3.jpg', '4.jpg'].map(url => url && `/${url}`));
    assert.equal(healed.knownFor.length, 4);
    assert.equal(store.person_details_v3_kp_11.data._meta.filmDetailsVersion, 1);
    await service.getPersonDetails('kp:11');
    assert.equal(requests, 2, 'Healed once');

    // A newer marker is left alone.
    store.person_details_v3_kp_11 = old();
    store.person_details_v3_kp_11.data._meta.filmDetailsVersion = 9;
    const newer = await service.getPersonDetails('kp:11');
    assert.equal(newer.filmography.acting[0].posterUrl, placeholder);
    assert.equal(requests, 2);
}

// A single leftover page picture also goes when the API knows the film has no poster.
{
    const service = new PersonDetailsService({});
    const dto = { filmography: { acting: [{ kinopoiskId: 5, posterUrl: 'https://clstorage.example/one.png', posterSource: 'kp-html' }, { kinopoiskId: 6, posterUrl: 'https://clstorage.example/two.png', posterSource: 'kp-html' }] }, knownFor: [] };
    service._applyFilmDetails(dto, [5], [card(5, { posterUrl: null })]);
    assert.deepEqual(dto.filmography.acting.map(item => item.posterUrl), [null, 'https://clstorage.example/two.png'], 'Films that were not asked about keep theirs');
}

// Without the API the slow path still works: the person page, then film pages.
{
    delete store.person_details_v3_kp_12;
    const read = [];
    const service = new PersonDetailsService({
        kinopoiskService: {
            async getPersonDetails() { return rawOf([{ id: 1, name: 'Один', enProfession: 'actor', rating: 5 }, { id: 2, name: 'Два', enProfession: 'actor', rating: 8 }]); },
            async getFilmCardsByIds() { throw new Error('Kinopoisk daily quota exhausted'); }
        },
        kinopoiskPersonHtmlService: {
            async getPersonFilmographyById() { return { items: [{ kinopoiskId: 1, posterUrl: 'https://cdn.example/page-1.jpg', year: 1999 }] }; },
            async getMoviePostersByIds(ids, options) { read.push(...ids); options.onPoster(2, 'https://cdn.example/film-2.jpg', { year: 2002, mediaType: 'movie' }); return new Map(); }
        }
    });
    const dto = await service.getPersonDetails('kp:12');
    await service.enrichPersonDetails(dto);
    assert.deepEqual(read, [2], 'Only films the person page gave no poster for are read');
    assert.deepEqual(dto.filmography.acting.map(item => item.posterUrl), ['https://cdn.example/page-1.jpg', 'https://cdn.example/film-2.jpg']);
    assert.equal(dto._meta.filmDetailsVersion, undefined);
}

// A slow answer does not hold the page; it goes into the rendered one.
{
    delete store.person_details_v3_kp_13;
    let answer;
    const service = new PersonDetailsService({
        kinopoiskService: {
            async getPersonDetails() { return rawOf([{ id: 1, name: 'Один', enProfession: 'actor' }]); },
            getFilmCardsByIds: () => new Promise(resolve => { answer = resolve; })
        },
        kinopoiskPersonHtmlService: noFilmPages
    });
    service.FILM_BATCH_WAIT_MS = 5;
    const dto = await service.getPersonDetails('kp:13');
    assert.equal(items(dto)[0].posterUrl, null);
    let updates = 0;
    const work = service.enrichPersonDetails(dto, { onUpdate() { updates++; } });
    answer([card(1)]);
    await work;
    assert.equal(items(dto)[0].posterUrl, 'https://cdn.example/1.jpg');
    assert.ok(updates > 0);
    assert.equal(store.person_details_v3_kp_13.data._meta.filmDetailsVersion, 1);
}

// More than 250 titles: the second batch waits for the role the user opens.
{
    const movies = [
        ...Array.from({ length: 120 }, (_, i) => ({ id: 1000 + i, name: `Церемония ${i}`, enProfession: 'cameo', rating: 9 })),
        ...Array.from({ length: 200 }, (_, i) => ({ id: 1 + i, name: `Роль ${i}`, enProfession: 'actor', rating: 6 }))
    ];
    const asked = [];
    const service = new PersonDetailsService({
        kinopoiskService: {
            async getPersonDetails() { return rawOf(movies); },
            async getFilmCardsByIds(ids) { asked.push(ids); return ids.map(id => card(id)); }
        },
        kinopoiskPersonHtmlService: noFilmPages
    });
    const dto = await service.getPersonDetails('kp:14');
    assert.deepEqual([asked.length, asked[0].length, asked[0].filter(id => id < 1000).length], [1, 250, 200], 'Every role is in the first batch');
    assert.equal(await service.loadRoleFilmDetails(dto, 'acting'), false, 'A role with nothing left asks for nothing');
    const [first, second] = await Promise.all([service.loadRoleFilmDetails(dto, 'self'), service.loadRoleFilmDetails(dto, 'self')]);
    assert.ok(first && second);
    assert.deepEqual([asked.length, asked[1].length], [2, 70], 'One request for the rest');
    assert.ok(items(dto).every(item => item.posterUrl));
    assert.equal(await service.loadRoleFilmDetails(dto, 'self'), false);
    assert.equal(items(store.person_details_v3_kp_14.data).filter(item => item.posterUrl).length, 320, 'The rest is cached');
    assert.equal(asked.length, 2);
}

// The request: one page of at most 250 films through the quota-aware proxy call.
{
    globalThis.KINOPOISK_CONFIG = { BASE_URL: 'https://api.example/v1.4', ENDPOINTS: { MOVIE: '/movie' } };
    const service = new KinopoiskService();
    service.baseUrl = 'https://api.example/v1.4';
    const urls = [];
    service._fetchWithRotation = async url => {
        urls.push(new URL(url));
        return { ok: true, json: async () => ({ docs: [
            { id: 1, poster: { previewUrl: 'https://cdn.example/1/300x450', url: 'https://cdn.example/1/orig' }, year: 2009, type: 'movie', isSeries: false, rating: { kp: 8 }, votes: { kp: 12 } },
            { id: 2, poster: { url: 'https://image.tmdb.org/t/p/w500null' }, type: 'tv-series', rating: { kp: 0 }, votes: {} },
            { id: 3, type: 'anime' }
        ] }) };
    };
    assert.deepEqual(await service.getFilmCardsByIds([1, '2', 2, 'x', 3]), [
        { kinopoiskId: 1, posterUrl: 'https://cdn.example/1/300x450', year: 2009, mediaType: 'movie', ratingKp: 8, votesKp: 12 },
        { kinopoiskId: 2, posterUrl: null, year: null, mediaType: 'tv', ratingKp: null, votesKp: null },
        { kinopoiskId: 3, posterUrl: null, year: null, mediaType: 'tv', ratingKp: null, votesKp: null }
    ]);
    assert.deepEqual([urls[0].searchParams.getAll('id'), urls[0].searchParams.get('limit')], [['1', '2', '3'], '3']);
    assert.ok(urls[0].searchParams.getAll('selectFields').includes('poster'));
    await service.getFilmCardsByIds(Array.from({ length: 400 }, (_, i) => 10000000 + i));
    assert.equal(urls[1].searchParams.getAll('id').length, 250);
    assert.ok(`${urls[1].pathname}${urls[1].search}`.length < 4096, 'The proxy accepts targets up to 4096 characters');
    assert.deepEqual(await service.getFilmCardsByIds([]), []);
    assert.equal(urls.length, 2);
    service._fetchWithRotation = async () => ({ ok: false, status: 403 });
    await assert.rejects(service.getFilmCardsByIds([1]), /HTTP 403/, 'A failure is not «no posters»');
}

delete globalThis.KINOPOISK_CONFIG;
delete globalThis.chrome;
console.log('Person film batch: posters in one request, healing, fallback, lazy second batch');
