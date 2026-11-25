/**
 * Kinopoisk's catalogue sometimes gives an obscure record a famous film's TMDB ID. On
 * 2026-11-25 «Две крепости» opened as KP 5080635 (a 2021 fan short with 12 votes) and
 * «Терминатор 2» as KP 44029 (a namesake with 22), so both pages showed no ratings: those
 * belong to KP 312 and KP 444. Such a mapping was kept for good.
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

const root = path.join(__dirname, '..');
const DAY = 24 * 60 * 60 * 1000;

let store = {};
globalThis.KINOPOISK_CONFIG = { BASE_URL: 'https://kp.test', ENDPOINTS: { MOVIE: '/movie' }, API_KEYS: [] };
globalThis.chrome = { storage: { local: {
    get(keys, done) {
        const names = keys === null ? Object.keys(store) : [].concat(keys);
        const result = Object.fromEntries(names.filter(name => name in store).map(name => [name, structuredClone(store[name])]));
        done?.(result);
        return Promise.resolve(result);
    },
    set(values, done) { Object.assign(store, structuredClone(values)); done?.(); return Promise.resolve(); },
    remove(keys, done) { [].concat(keys).forEach(key => delete store[key]); done?.(); return Promise.resolve(); }
} } };

const IdMappingService = require(path.join(root, 'src/shared/services/IdMappingService.js'));
const MediaAggregatorService = require(path.join(root, 'src/shared/services/MediaAggregatorService.js'));
const RecommendationService = require(path.join(root, 'src/shared/services/RecommendationService.js'));
const FranchiseService = require(path.join(root, 'src/shared/services/FranchiseService.js'));
console.log = console.info = console.warn = () => {};

const towers = { id: 312, type: 'movie', year: 2002, name: 'Властелин колец: Две крепости', alternativeName: 'The Lord of the Rings: The Two Towers', externalId: { tmdb: 121, imdb: 'tt0167261' }, votes: { kp: 649186 } };
const towersShort = { id: 5080635, type: 'movie', year: 2021, alternativeName: 'The Lord of the Rings: The Two Towers', externalId: { tmdb: 121 }, votes: { kp: 12 } };
const terminator = { id: 444, type: 'movie', year: 1991, name: 'Терминатор 2: Судный день', alternativeName: 'Terminator 2: Judgment Day', externalId: { imdb: 'tt0103064' }, votes: { kp: 805412 } };
const judgment = { id: 44029, type: 'movie', year: 1991, name: 'Судный день', alternativeName: 'Судный день', externalId: { tmdb: 280, imdb: 'tt0196125' }, votes: { kp: 22 } };

function kinopoisk(docs, { fail = false } = {}) {
    const requests = [];
    return {
        requests,
        baseUrl: 'https://kp.test',
        async _fetchWithRotation(url) {
            requests.push(url);
            if (fail) return { ok: false, status: 503 };
            const params = new URL(url).searchParams;
            const tmdb = params.getAll('externalId.tmdb').map(Number);
            const imdb = params.getAll('externalId.imdb');
            const found = docs.filter(doc => tmdb.includes(doc.externalId.tmdb) || imdb.includes(doc.externalId.imdb));
            return { ok: true, status: 200, json: async () => ({ docs: found, total: found.length, pages: 1 }) };
        },
        async searchMovies() { requests.push('search'); return { docs: [] }; }
    };
}

function service(docs, { imdb = {}, ...options } = {}) {
    const kp = kinopoisk(docs, options);
    const tmdbCalls = [];
    const tmdb = { async getExternalIds(id) { tmdbCalls.push(id); return { imdb_id: imdb[id] || null }; } };
    const mapping = new IdMappingService(kp, tmdb);
    mapping.RECHECK_DELAY_MS = 5;
    return { mapping, kp, tmdbCalls };
}

const saved = (tmdbId, kpId, extra = {}) => ({
    tmdbId, kpId, mediaType: 'movie', kpType: 'movie', status: 'resolved', identityStatus: 'VERIFIED',
    verificationMethod: 'exact_external_tmdb', verificationSource: 'automatic', resolutionSource: 'automatic',
    resolvedAt: Date.now() - 90 * DAY, ...extra
});
function remember(mapping, ...entries) {
    const cache = {};
    for (const entry of entries) {
        cache[`movie:${entry.tmdbId}`] = entry;
        cache[`kp:movie:${entry.kpId}`] = { ...entry, isReverseIndex: true };
    }
    store = { [mapping.CACHE_KEY]: cache, tmdb_raimi_identity_repair_v1: 1 };
}
const cached = mapping => store[mapping.CACHE_KEY];
const settle = () => new Promise(resolve => setTimeout(resolve, 60));
const twoTowers = { tmdbId: 121, mediaType: 'movie', title: 'Властелин колец: Две крепости', originalTitle: 'The Lord of the Rings: The Two Towers', year: 2002, voteCount: 25055 };
const t2 = { tmdbId: 280, mediaType: 'movie', title: 'Терминатор 2: Судный день', originalTitle: 'Terminator 2: Judgment Day', year: 1991, voteCount: 13500 };

test('of the records with one TMDB ID the film everyone rated wins, even when the year is unknown', async () => {
    store = {};
    const { mapping, tmdbCalls } = service([towersShort, towers]);
    const result = await mapping.resolveBatch([{ ...twoTowers, year: null }], { skipQueue: true });
    assert.equal(result.get('movie:121').kinopoiskId, 312);
    assert.deepEqual(tmdbCalls, [], 'a record with many votes needs no second opinion');
    assert.ok(cached(mapping)['movie:121'].checkedAt > 0);
});

test('a namesake holding a famous TMDB ID gives way to the record with TMDB\'s IMDb ID', async () => {
    store = {};
    const { mapping } = service([judgment, terminator], { imdb: { 280: 'tt0103064' } });
    const result = await mapping.resolveBatch([t2], { skipQueue: true });
    assert.equal(result.get('movie:280').kinopoiskId, 444);
    assert.equal(cached(mapping)['movie:280'].verificationMethod, 'exact_external_imdb');
});

test('a namesake with another IMDb title is not accepted when Kinopoisk has nothing better', async () => {
    store = {};
    const { mapping } = service([judgment], { imdb: { 280: 'tt0103064' } });
    const result = await mapping.resolveBatch([t2], { skipQueue: true });
    assert.equal(result.get('movie:280').kinopoiskId, null);
});

test('an obscure film keeps its mapping: no IMDb ID to contradict it, or few TMDB votes as well', async () => {
    store = {};
    const quiet = { id: 900, type: 'movie', year: 2025, name: 'Тихий фильм', externalId: { tmdb: 50 }, votes: { kp: 40 } };
    const item = { tmdbId: 50, mediaType: 'movie', title: 'Тихий фильм', year: 2025 };
    const asked = service([quiet], { imdb: { 50: 'tt7777777' } });
    assert.equal((await asked.mapping.resolveBatch([{ ...item, voteCount: 5000 }], { skipQueue: true })).get('movie:50').kinopoiskId, 900);
    assert.deepEqual(asked.tmdbCalls, [50]);

    store = {};
    const unasked = service([quiet], { imdb: { 50: 'tt7777777' } });
    assert.equal((await unasked.mapping.resolveBatch([{ ...item, voteCount: 12 }], { skipQueue: true })).get('movie:50').kinopoiskId, 900);
    assert.deepEqual(unasked.tmdbCalls, [], 'unknown on both sides is what an obscure film looks like');
});

test('an old mapping answers at once and is corrected in the background', async () => {
    const { mapping, kp } = service([towers]);
    remember(mapping, saved(121, 5080635));
    const result = await mapping.resolveBatch([twoTowers], { skipQueue: true });
    assert.equal(result.get('movie:121').kinopoiskId, 5080635, 'the page does not wait');
    await settle();
    const cache = cached(mapping);
    assert.equal(cache['movie:121'].kpId, 312);
    assert.equal(cache['kp:movie:312'].tmdbId, 121);
    assert.equal(cache['kp:movie:5080635'], undefined, 'the old record is nobody\'s film any more');
    const asked = kp.requests.length;
    await mapping.resolveBatch([twoTowers], { skipQueue: true });
    await settle();
    assert.equal(kp.requests.length, asked, 'checked mappings rest until the next term');
});

test('a failed or empty answer changes no mapping, and admin mappings are never rechecked', async () => {
    const failing = service([], { fail: true });
    remember(failing.mapping, saved(121, 5080635));
    await failing.mapping.recheckMappings([{ ...twoTowers, key: 'movie:121' }]);
    assert.equal(cached(failing.mapping)['movie:121'].kpId, 5080635);
    assert.equal(cached(failing.mapping)['movie:121'].checkedAt, undefined, 'it is asked again later');

    const empty = service([]);
    remember(empty.mapping, saved(121, 312));
    await empty.mapping.recheckMappings([{ ...twoTowers, key: 'movie:121' }]);
    assert.equal(cached(empty.mapping)['movie:121'].kpId, 312);
    assert.ok(!empty.kp.requests.includes('search'), 'a recheck spends no title searches');

    const manual = service([towers]);
    remember(manual.mapping, saved(121, 5080635, { isManual: true, verificationMethod: 'admin_verified' }));
    await manual.mapping.resolveBatch([twoTowers], { skipQueue: true });
    await settle();
    assert.equal(cached(manual.mapping)['movie:121'].kpId, 5080635);
    assert.deepEqual(manual.kp.requests, []);
});

test('a page opened on the borrowed record finds the film; ordinary pages ask nothing', async () => {
    const page = (kinopoiskId, kp, tmdb) => ({ kinopoiskId, tmdbId: 121, type: 'movie', name: twoTowers.title, year: 2021, votes: { kp, tmdb } });
    const { mapping, kp } = service([towers]);
    remember(mapping, saved(121, 5080635));
    assert.equal(await mapping.findSupersedingKinopoiskId(page(312, 649186, 25055)), null);
    assert.equal(await mapping.findSupersedingKinopoiskId(page(900, 40, 12)), null);
    assert.equal(await mapping.findSupersedingKinopoiskId(page(900, null, 25055)), null, 'built without Kinopoisk: nothing to judge by');
    assert.deepEqual(kp.requests, []);
    assert.equal(await mapping.findSupersedingKinopoiskId(page(5080635, 12, 25055)), 312);
    assert.equal(await mapping.findSupersedingKinopoiskId(page(312, 12, 25055)), null, 'the film itself stays');
});

test('a collection kept for two weeks takes the corrected film', async () => {
    const { mapping } = service([towers]);
    remember(mapping, saved(121, 312, { checkedAt: Date.now() }));
    const franchise = new FranchiseService({ idMappingService: mapping, tmdbService: {} });
    await franchise.setCachedFranchise(119, { id: 119, name: 'Властелин колец', parts: [
        { tmdbId: 121, kinopoiskId: 5080635, title: twoTowers.title, year: 2002 },
        { tmdbId: 122, kinopoiskId: 3498, title: 'Возвращение короля', year: 2003 }
    ] });
    const parts = (await franchise.getFranchise(119)).parts;
    assert.deepEqual(parts.map(part => part.kinopoiskId), [312, 3498]);
});

test('TMDB data is not laid over an obscure record of another year or another IMDb title', () => {
    const fits = (kp, tmdb) => MediaAggregatorService.isTmdbCompatibleWithKinopoisk(kp, tmdb);
    const tmdbTowers = { title: twoTowers.title, original_title: twoTowers.originalTitle, release_date: '2002-12-18', voteCount: 25055, imdb_id: 'tt0167261' };
    assert.equal(fits(towersShort, tmdbTowers), false);
    assert.equal(fits(towers, tmdbTowers), true);
    const tmdbT2 = { title: t2.title, original_title: t2.originalTitle, release_date: '1991-07-03', voteCount: 13500, imdb_id: 'tt0103064' };
    assert.equal(fits(judgment, tmdbT2), false);
    assert.equal(fits(terminator, tmdbT2), true);
    assert.equal(fits({ ...terminator, year: 1997 }, tmdbT2), true, 'a well-known record keeps the exact-title allowance');
});

test('recommendation cards name TMDB genres', () => {
    assert.deepEqual(RecommendationService.genreNames([12, 14, 10751, 999999]), ['приключения', 'фэнтези', 'семейный']);
    assert.deepEqual(RecommendationService.genreNames(undefined), []);
});
