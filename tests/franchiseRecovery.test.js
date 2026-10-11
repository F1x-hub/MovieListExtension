import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import IdMappingService from '../src/shared/services/IdMappingService.js';
import FranchiseService from '../src/shared/services/FranchiseService.js';
import TMDBService from '../src/shared/services/TMDBService.js';
import MediaAggregatorService from '../src/shared/services/MediaAggregatorService.js';
import { i18n } from '../src/shared/i18n/I18n.js';

const identity = (tmdbId, kpId) => ({ tmdbId, kpId, mediaType: 'movie', status: 'resolved', identityStatus: 'VERIFIED', verificationMethod: 'exact_external_tmdb' });
const data = { unrelated: identity(1000, 2000), 'movie:557': identity(557, 396), 'kp:movie:396': identity(557, 396),
    'movie:558': identity(558, 397), 'kp:movie:397': identity(558, 397), 'movie:559': identity(559, 81692), 'kp:movie:81692': identity(559, 81692),
    'tv:557': { ...identity(557, 396), mediaType: 'tv' } };
const storage = { tmdb_kp_mapping_cache_v2: structuredClone(data), watching_progress_838: { timestamp: 999 }, ratings: { untouched: true } };
let writes = 0;
globalThis.chrome = { storage: { local: {
    get(keys, callback) { callback(Object.fromEntries(keys.map(key => [key, structuredClone(storage[key])]))); },
    set(value, callback) { writes++; Object.assign(storage, structuredClone(value)); callback(); }
} } };
const mapper = new IdMappingService();
const migrated = await mapper.getMappingCache();
assert.equal(migrated['movie:557'].kpId, 838);
assert.equal(migrated['movie:558'].kpId, 2898);
assert.equal(migrated['movie:559'].kpId, 82441);
assert(!migrated['kp:movie:396'] && !migrated['kp:movie:397'] && !migrated['kp:movie:81692']);
assert.deepEqual(migrated.unrelated, data.unrelated);
assert.deepEqual(migrated['tv:557'], data['tv:557']);
assert.equal(storage.watching_progress_838.timestamp, 999);
assert.deepEqual(storage.ratings, { untouched: true });
const writesAfterMigration = writes;
await mapper.getMappingCache();
assert.equal(writes, writesAfterMigration, 'migration runs once');
delete globalThis.chrome;

const shared = new IdMappingService();
shared._readSharedMappings = async () => new Map([['movie:557', { available: true, mapping: { ...identity(557, 396), isManual: true } }]]);
const forward = await shared.resolveBatch([{ id: 557, mediaType: 'movie' }], { skipQueue: true });
assert.equal(forward.get('movie:557').kinopoiskId, 838, 'verified correction wins over conflicting shared forward');
shared._readSharedMappingByReverseKey = async () => ({ available: true, mapping: identity(557, 396) });
assert.equal((await shared.resolveTmdbIdByKinopoiskId(838)).tmdbId, 557);
assert.equal(await shared.resolveTmdbIdByKinopoiskId(396), null, 'wrong shared reverse cannot attach Spider-Man to Jaws');

const service = new FranchiseService({ idMappingService: shared });
const cachedAt = Date.now() - 60000;
service._memoryCache.set(service.getCacheKey(556), { id: 556, schemaVersion: 2, cachedAt,
    parts: [{ tmdbId: 557, kinopoiskId: 396 }, { tmdbId: 558, kinopoiskId: 397 }, { tmdbId: 559, kinopoiskId: 81692 }] });
const collection = await service.getCachedFranchise(556);
assert.deepEqual(collection.parts.map(part => part.kinopoiskId), [838, 2898, 82441]);
assert.equal(collection.cachedAt, cachedAt, 'identity migration does not renew metadata TTL');

const tmdb = new TMDBService();
tmdb._fetchWithRotation = async () => ({ ok: false, status: 503 });
await assert.rejects(tmdb.getCollection(556), /503/);
tmdb._fetchWithRotation = async () => ({ ok: false, status: 404 });
assert.equal(await tmdb.getCollection(556), null);
tmdb._fetchWithRotation = async () => { throw new Error('timeout'); };
await assert.rejects(tmdb.getCollection(556), /timeout/);
const temporary = new FranchiseService({ tmdbService: { getCollection: async () => { throw Error('offline'); } } });
await assert.rejects(temporary.getFranchise(556), /offline/);
assert.equal(temporary._memoryCache.size, 0);
assert.equal(temporary.inFlightRequests.size, 0);
temporary.tmdbService.getCollection = async () => ({ id: 556, parts: [] });
assert.deepEqual((await temporary.getFranchise(556)).parts, []);
assert.equal(temporary._memoryCache.size, 0, 'valid empty is not cached for 14 days');
const partial = MediaAggregatorService.aggregate({ id: 838, name: 'Spider-Man', type: 'movie', externalId: { tmdb: 557 } }, { tmdbId: 557, name: 'Spider-Man' });
assert.equal(partial._meta.providers.tmdb.collectionChecked, false);

const dom = new JSDOM('<div class="movie-detail-description"><p>Description</p><div id="userRatingsSection">Ratings</div></div>');
const document = dom.window.document;
const register = document.addEventListener.bind(document);
document.addEventListener = (type, ...args) => { if (type !== 'DOMContentLoaded') register(type, ...args); };
i18n.currentLocale = 'ru';
const context = vm.createContext({ window: dom.window, document, console, i18n, FranchiseService, setTimeout, clearTimeout, URLSearchParams });
vm.runInContext(fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8').replace(/^import .*;\r?$/gm, ''), context);
const manager = Object.create(context.window.MovieDetailsManager.prototype);
const movie = { kinopoiskId: 838, tmdbId: 557, name: 'Spider-Man', collection: { tmdbId: 556, name: 'Spider-Man (Collection)' },
    sequelsAndPrequels: [{ id: 2898, name: 'Spider-Man 2' }, { id: 82441, name: 'Spider-Man 3' }, { id: 602409, name: 'Reboot' }] };
manager.selectedMovie = movie;
manager.patchFranchiseSection(movie);
assert(document.getElementById('movieFranchiseSection'), 'late collection creates the missing section');
assert.equal(document.querySelector('#userRatingsSection').textContent, 'Ratings');
let attempts = 0;
manager.franchiseService = { getFranchise: async () => {
    attempts++; if (attempts === 1) throw Error('temporary');
    return { parts: [{ tmdbId: 557, kinopoiskId: 838, title: 'Spider-Man' }, { tmdbId: 558, kinopoiskId: 2898, title: 'Spider-Man 2' }, { tmdbId: 559, kinopoiskId: 82441, title: 'Spider-Man 3' }] };
} };
await manager.loadFranchiseAsync(movie);
assert.equal(manager.franchiseState.status, 'failed');
assert(document.querySelector('[data-action="retry-franchise"]'));
await manager.loadFranchiseAsync(movie);
assert.equal(attempts, 1, 'backoff prevents immediate retries');
manager.franchiseState.retryAfter = 0;
await manager.loadFranchiseAsync(movie);
assert.equal(attempts, 2);
assert.equal(manager.franchiseState.status, 'ready');
assert.equal(document.querySelectorAll('.franchise-card').length, 3);
assert.equal(document.querySelector('.sequel-card').dataset.kinopoiskId, '602409');
const changed = { ...movie, collection: { tmdbId: 999, name: 'Other collection' } };
manager.selectedMovie = changed;
manager.patchFranchiseSection(changed);
assert.equal(document.getElementById('movieFranchiseSection').dataset.collectionId, '999');
assert.equal(document.querySelectorAll('.sequel-card').length, 3, 'changed collection restores original relations');
let settle;
manager.franchiseService.getFranchise = () => new Promise(resolve => { settle = resolve; });
const oldRequest = manager.loadFranchiseAsync(changed);
const newer = { ...movie, collection: { tmdbId: 1001, name: 'Newer' } };
manager.selectedMovie = newer;
manager.patchFranchiseSection(newer);
settle({ parts: [{ tmdbId: 1, kinopoiskId: 1 }, { tmdbId: 2, kinopoiskId: 2 }] });
await oldRequest;
assert.equal(document.querySelectorAll('.franchise-card').length, 0, 'old collection response cannot paint newer collection');
assert.equal(document.getElementById('movieFranchiseSection').dataset.collectionId, '1001');
await manager.loadFranchiseAsync(changed);
assert.equal(manager.franchiseState, null, 'an old observer callback cannot replace the current collection state');
manager.franchiseService.getFranchise = async () => { throw Error('offline'); };
for (let i = 0; i < 5; i++) {
    if (manager.franchiseState) manager.franchiseState.retryAfter = 0;
    await manager.loadFranchiseAsync(newer);
}
assert.equal(manager.franchiseState.attempts, 3, 'retry limit is bounded');
console.log('Franchise recovery: local migration, shared priority, errors, late DOM, relations and races passed');
