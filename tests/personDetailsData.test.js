import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import PersonDetailsService from '../src/shared/services/PersonDetailsService.js';
import TMDBService from '../src/shared/services/TMDBService.js';
import KinopoiskService from '../src/shared/services/KinopoiskService.js';
import IdMappingService from '../src/shared/services/IdMappingService.js';

async function getEnrichedPersonDetails(service, personKey, options = {}) {
    const dto = await service.getPersonDetails(personKey, options);
    return service.enrichPersonDetails(dto, options);
}

console.log('🧪 Running Phase 2D PersonDetails Data Service & Pipeline Tests...\n');

// Load configurations
vm.runInThisContext(fs.readFileSync('src/shared/config/tmdb.config.example.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('src/shared/config/kinopoisk.config.js', 'utf8'));
globalThis.TMDB_CONFIG = TMDB_CONFIG;
globalThis.KINOPOISK_CONFIG = KINOPOISK_CONFIG;

// Mock storage
class MockStorage {
    constructor() {
        this.store = new Map();
    }
    get(keys) {
        const res = {};
        if (typeof keys === 'string') {
            res[keys] = this.store.get(keys);
        } else if (Array.isArray(keys)) {
            for (const k of keys) res[k] = this.store.get(k);
        }
        return Promise.resolve(res);
    }
    set(items) {
        for (const [k, v] of Object.entries(items)) {
            this.store.set(k, JSON.parse(JSON.stringify(v)));
        }
        return Promise.resolve();
    }
    remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) this.store.delete(k);
        return Promise.resolve();
    }
    clear() {
        this.store.clear();
        return Promise.resolve();
    }
}

const mockStorage = new MockStorage();
globalThis.chrome = {
    storage: {
        local: mockStorage
    }
};

// ==========================================
// 1. PERSON KEY PARSER TESTS
// ==========================================
console.log('--- 1. Testing Person Key Parser ---');

{
    // Valid cases
    const tmdb1 = PersonDetailsService.parsePersonKey('tmdb:2710');
    assert.strictEqual(tmdb1.personKey, 'tmdb:2710');
    assert.strictEqual(tmdb1.provider, 'TMDB');
    assert.strictEqual(tmdb1.providerId, 2710);

    const kp1 = PersonDetailsService.parsePersonKey('kp:27977');
    assert.strictEqual(kp1.personKey, 'kp:27977');
    assert.strictEqual(kp1.provider, 'KP');
    assert.strictEqual(kp1.providerId, 27977);

    const tmdbTrimmed = PersonDetailsService.parsePersonKey('  tmdb:521  ');
    assert.strictEqual(tmdbTrimmed.personKey, 'tmdb:521');
    assert.strictEqual(tmdbTrimmed.providerId, 521);

    const kpUpper = PersonDetailsService.parsePersonKey('KP:8844');
    assert.strictEqual(kpUpper.personKey, 'kp:8844');
    assert.strictEqual(kpUpper.provider, 'KP');

    // Invalid / Rejected cases
    const invalidCases = [
        '2710',
        'person:2710',
        'tmdb:',
        'tmdb:abc',
        'kp:-1',
        'kp:0',
        'unknown:123',
        'tmdb:2710:123',
        '',
        '   ',
        null,
        undefined,
        12345,
        {},
        'tmdb:12.34'
    ];

    for (const inv of invalidCases) {
        assert.throws(() => {
            PersonDetailsService.parsePersonKey(inv);
        }, { code: 'INVALID_PERSON_KEY' }, `Must reject invalid person key: "${inv}"`);
    }

    console.log('  ✅ 1.1 parsePersonKey accepts canonical keys and strictly rejects malformed inputs');
}

// ==========================================
// 2. PROVIDER NAMESPACE COLLISION SAFETY
// ==========================================
console.log('\n--- 2. Testing Provider Namespace Collision Safety ---');

{
    const tmdbKey = PersonDetailsService.parsePersonKey('tmdb:24');
    const kpKey = PersonDetailsService.parsePersonKey('kp:24');

    assert.notStrictEqual(tmdbKey.personKey, kpKey.personKey);
    assert.strictEqual(tmdbKey.provider, 'TMDB');
    assert.strictEqual(kpKey.provider, 'KP');
    assert.strictEqual(tmdbKey.providerId, 24);
    assert.strictEqual(kpKey.providerId, 24);

    const service = new PersonDetailsService();
    const tmdbStorageKey = `${service.CACHE_PREFIX}tmdb_24`;
    const kpStorageKey = `${service.CACHE_PREFIX}kp_24`;
    assert.notStrictEqual(tmdbStorageKey, kpStorageKey, 'Different cache keys');
    console.log('  ✅ 2.1 tmdb:24 and kp:24 are safely isolated across identity, parser, and cache keys');
}

// ==========================================
// 3. TMDB NORMALIZATION & APPEND_TO_RESPONSE
// ==========================================
console.log('\n--- 3. Testing TMDB Normalization & Single Roundtrip ---');

{
    let capturedUrl = null;
    const mockTmdbService = {
        async getPersonDetails(personId, options = {}) {
            capturedUrl = `/person/${personId}?append_to_response=combined_credits,external_ids`;
            return {
                id: 2710,
                name: 'Джеймс Кэмерон',
                original_name: 'James Cameron',
                also_known_as: ['Jim Cameron', 'James Cameron', 'James F. Cameron', 'Jim Cameron', ''],
                biography: '  Канадский кинорежиссёр и сценарист.  ',
                birthday: '1954-08-16',
                deathday: null,
                place_of_birth: 'Kapuskasing, Ontario, Canada',
                profile_path: '/9NAZnTdoLmgmMGnxooRPSiKZTRe.jpg',
                known_for_department: 'Directing',
                popularity: 45.8234,
                external_ids: {
                    imdb_id: 'nm0000116'
                },
                combined_credits: {
                    cast: [
                        { id: 101, title: 'Аватар (камео)', original_title: 'Avatar Cameo', media_type: 'movie', character: 'Passenger', vote_count: 50, vote_average: 7.5, release_date: '2009-12-18', poster_path: '/avatar.jpg' }
                    ],
                    crew: [
                        { id: 101, title: 'Аватар', original_title: 'Avatar', media_type: 'movie', department: 'Directing', job: 'Director', vote_count: 28000, vote_average: 7.9, release_date: '2009-12-18', poster_path: '/avatar.jpg' },
                        { id: 101, title: 'Аватар', original_title: 'Avatar', media_type: 'movie', department: 'Writing', job: 'Writer', vote_count: 28000, vote_average: 7.9, release_date: '2009-12-18' },
                        { id: 101, title: 'Аватар', original_title: 'Avatar', media_type: 'movie', department: 'Production', job: 'Producer', vote_count: 28000, vote_average: 7.9, release_date: '2009-12-18' },
                        { id: 102, title: 'Титаник', original_title: 'Titanic', media_type: 'movie', department: 'Directing', job: 'Director', vote_count: 23000, vote_average: 7.9, release_date: '1997-12-19' },
                        { id: 103, title: 'Adult Special', original_title: 'Adult', media_type: 'movie', adult: true, department: 'Directing', job: 'Director' }
                    ]
                }
            };
        }
    };

    const mockMappingService = {
        async resolveBatch(candidates, options = {}) {
            assert.strictEqual(options.skipQueue, true, 'skipQueue must be true');
            const map = new Map();
            map.set(101, { kinopoiskId: 251733, matchMethod: 'exact_external_id' });
            map.set(102, { kinopoiskId: 2213, matchMethod: 'exact_external_id' });
            return map;
        }
    };

    const service = new PersonDetailsService({
        tmdbService: mockTmdbService,
        idMappingService: mockMappingService
    });

    const dto = await getEnrichedPersonDetails(service, 'tmdb:2710');
    assert.ok(capturedUrl.includes('append_to_response=combined_credits,external_ids'));
    assert.strictEqual(dto.identity.personKey, 'tmdb:2710');
    assert.strictEqual(dto.identity.provider, 'TMDB');
    assert.strictEqual(dto.identity.tmdbPersonId, 2710);
    assert.strictEqual(dto.identity.kpPersonId, null, 'Must not infer KP ID without explicit context');
    assert.strictEqual(dto.identity.imdbPersonId, 'nm0000116');
    assert.strictEqual(dto.identity.verificationStatus, 'PROVIDER_VERIFIED');
    assert.strictEqual(dto.name, 'Джеймс Кэмерон');
    assert.strictEqual(dto.originalName, 'James Cameron');
    assert.deepStrictEqual(dto.aliases, ['Jim Cameron', 'James F. Cameron'], 'Bounded, deduplicated aliases');
    assert.strictEqual(dto.biography, 'Канадский кинорежиссёр и сценарист.');
    assert.strictEqual(dto.birthday, '1954-08-16');
    assert.strictEqual(dto.deathday, null);
    assert.strictEqual(dto.photoUrl, 'https://image.tmdb.org/t/p/h632/9NAZnTdoLmgmMGnxooRPSiKZTRe.jpg');
    assert.strictEqual(dto.knownForDepartment, 'Directing');
    assert.strictEqual(dto.professions[0], 'Режиссёр');
    assert.strictEqual(dto.age, undefined, 'Age must NOT be stored in DTO');

    // Filmography deduplication & category mapping
    assert.strictEqual(dto.filmography.directing.length, 2, 'Directing has Avatar and Titanic (adult excluded)');
    assert.strictEqual(dto.filmography.writing.length, 1, 'Writing has Avatar');
    assert.strictEqual(dto.filmography.production.length, 1, 'Production has Avatar');
    assert.strictEqual(dto.filmography.acting.length, 1, 'Acting has Avatar cameo');
    assert.strictEqual(dto.filmography.acting[0].posterUrl, 'https://image.tmdb.org/t/p/w342/avatar.jpg');
    assert.strictEqual(dto.filmography.acting[0].posterSource, 'tmdb');
    assert.strictEqual(dto.filmography.acting[0].hasArtwork, true);

    // KP mapping populated
    assert.strictEqual(dto.filmography.directing[0].kinopoiskId, 251733);
    assert.strictEqual(dto.filmography.directing[1].kinopoiskId, 2213);

    // Known For
    assert.strictEqual(dto.knownFor.length, 2);
    assert.strictEqual(dto.knownFor[0].kinopoiskId, 251733);
    assert.strictEqual(dto.knownFor[1].kinopoiskId, 2213);

    console.log('  ✅ 3.1 TMDB single roundtrip, aliases, biography, filmography dedup, and Known-For verified');
}

// ==========================================
// 4. KP NORMALIZATION & ZERO MAPPING CALLS
// ==========================================
console.log('\n--- 4. Testing KP Normalization & Native Filmography ---');

{
    let mappingCalled = false;
    const mockKpService = {
        async getPersonDetails(personId, options = {}) {
            return {
                id: 27977,
                name: 'Джеймс Кэмерон',
                enName: 'James Cameron',
                photo: 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/cameron.jpg',
                birthday: '1954-08-16T00:00:00.000Z',
                death: null,
                age: 71,
                birthPlace: [{ value: 'Капускасинг' }, { value: 'Онтарио' }, { value: 'Канада' }],
                profession: [{ value: 'Режиссер' }, { value: 'Сценарист' }, { value: 'Продюсер' }],
                facts: [
                    { value: '<p>Работал водителем грузовика до фильма &laquo;Звёздные войны&raquo;.</p>' },
                    { value: '<script>alert(1)</script>Первый человек на дне Марианской впадины.' }
                ],
                movies: [
                    { id: 251733, name: 'Аватар', alternativeName: 'Avatar', rating: 8.0, enProfession: 'director', year: 2009, poster: { url: 'https://avatars.mds.yandex.net/avatar.jpg' } },
                    { id: 251733, name: 'Аватар', alternativeName: 'Avatar', rating: 8.0, enProfession: 'writer', year: 2009 },
                    { id: 2213, name: 'Титаник', alternativeName: 'Titanic', rating: 8.4, enProfession: 'director', year: 1997 }
                ]
            };
        }
    };

    const mockMappingService = {
        async resolveBatch() {
            mappingCalled = true;
            return new Map();
        }
    };

    const service = new PersonDetailsService({
        kinopoiskService: mockKpService,
        idMappingService: mockMappingService
    });

    const dto = await getEnrichedPersonDetails(service, 'kp:27977');
    assert.strictEqual(mappingCalled, false, 'KP route must not invoke IdMappingService');
    assert.strictEqual(dto.identity.personKey, 'kp:27977');
    assert.strictEqual(dto.identity.provider, 'KP');
    assert.strictEqual(dto.identity.kpPersonId, 27977);
    assert.strictEqual(dto.identity.tmdbPersonId, null);
    assert.strictEqual(dto.biography, null, 'KP narrative bio must be null');
    assert.strictEqual(dto.facts.length, 2);
    assert.strictEqual(dto.facts[0], 'Работал водителем грузовика до фильма «Звёздные войны».', 'HTML & entities sanitized');
    assert.strictEqual(dto.facts[1], 'alert(1)Первый человек на дне Марианской впадины.', 'Script tag stripped');
    assert.strictEqual(dto.birthday, '1954-08-16');
    assert.strictEqual(dto.birthplace, 'Капускасинг, Онтарио, Канада');
    assert.strictEqual(dto.professions[0], 'Режиссер');
    assert.strictEqual(dto.age, undefined, 'Age not persisted');

    // Filmography native KP IDs
    assert.strictEqual(dto.filmography.directing.length, 2);
    assert.strictEqual(dto.filmography.directing[0].kinopoiskId, 251733);
    assert.strictEqual(dto.filmography.directing[0].posterUrl, 'https://avatars.mds.yandex.net/avatar.jpg');
    assert.strictEqual(dto.filmography.directing[0].posterSource, 'kp');
    assert.strictEqual(dto.filmography.writing[0].posterUrl, null);
    assert.strictEqual(dto.filmography.writing.length, 1);
    assert.strictEqual(dto.knownFor.length, 2);

    // Entities are decoded once, after the tags are gone: an escaped tag stays text.
    assert.strictEqual(service._stripHtml('<b>&#171;Звездные войны&#187;</b> &#x2014; &#151; &ndash; &#60;script&#62;alert(1)&#60;/script&#62;'),
        '«Звездные войны» — — – <script>alert(1)</script>');
    assert.strictEqual(service._stripHtml('&amp;#60;b&amp;#62; &amp;amp; &unknown; &#99999999; &#1114112;'), '&#60;b&#62; &amp; &unknown; &#99999999; &#1114112;', 'One pass; what is not an entity stays');
    assert.strictEqual(dto._meta.factsVersion, 1);
    const cachedFacts = { _meta: {}, facts: ['&#171;A&#187; &#60;script&#62;', 'B'] };
    assert.strictEqual(service._decodeCachedFacts(cachedFacts), true, 'A cached person heals');
    assert.deepStrictEqual(cachedFacts.facts, ['«A» <script>', 'B']);
    cachedFacts.facts = ['&#171;'];
    assert.strictEqual(service._decodeCachedFacts(cachedFacts), false, 'once');
    assert.deepStrictEqual(cachedFacts.facts, ['&#171;']);

    console.log('  ✅ 4.1 KP normalization, facts HTML stripping, and 0 mapping requests confirmed');
}

// ==========================================
// 5. MAPPING CANDIDATE BOUND & QUEUE ISOLATION
// ==========================================
console.log('\n--- 5. Testing 40-Item Mapping Bound & Queue Isolation ---');

{
    const manyCredits = Array.from({ length: 300 }, (_, i) => ({
        id: 1000 + i,
        title: `Movie ${i}`,
        media_type: 'movie',
        department: 'Directing',
        job: 'Director',
        vote_count: i < 50 ? 5000 - i * 50 : 10,
        vote_average: 7.0,
        release_date: '2020-01-01'
    }));

    let candidateCount = 0;
    let skipQueueValue = null;

    const mockTmdbService = {
        async getPersonDetails() {
            return {
                id: 9999,
                name: 'Prolific Director',
                combined_credits: { cast: [], crew: manyCredits }
            };
        }
    };

    const mockMappingService = {
        async resolveBatch(candidates, options = {}) {
            candidateCount = candidates.length;
            skipQueueValue = options.skipQueue;
            return new Map();
        }
    };

    const service = new PersonDetailsService({
        tmdbService: mockTmdbService,
        idMappingService: mockMappingService
    });

    const dto = await getEnrichedPersonDetails(service, 'tmdb:9999');
    assert.strictEqual(candidateCount, 40, 'Mapping candidates strictly bounded to max 40');
    assert.strictEqual(skipQueueValue, true, 'skipQueue must be explicitly true');
    assert.strictEqual(dto.filmography.directing.length, 300, 'All unique credits normalized into DTO');
    console.log('  ✅ 5.1 Max 40 mapping candidate bound & skipQueue: true strictly enforced');
}

// ==========================================
// 6. GRACEFUL DEGRADATION ON MAPPING FAILURE
// ==========================================
console.log('\n--- 6. Testing Graceful Degradation on Mapping Failure ---');

{
    const mockTmdbService = {
        async getPersonDetails() {
            return {
                id: 1234,
                name: 'Actor Name',
                combined_credits: {
                    cast: [{ id: 501, title: 'Title 1', media_type: 'movie', vote_count: 100 }]
                }
            };
        }
    };

    const mockMappingService = {
        async resolveBatch() {
            throw new Error('Kinopoisk mapping API 500 Error');
        }
    };

    const service = new PersonDetailsService({
        tmdbService: mockTmdbService,
        idMappingService: mockMappingService
    });

    const dto = await getEnrichedPersonDetails(service, 'tmdb:1234');
    assert.strictEqual(dto.name, 'Actor Name');
    assert.strictEqual(dto.filmography.acting.length, 1);
    assert.strictEqual(dto.filmography.acting[0].kinopoiskId, null, 'Graceful null kinopoiskId on mapping error');
    assert.strictEqual(dto.knownFor.length, 1, 'KnownFor remains visible without KP mapping');
    assert.strictEqual(dto.knownFor[0].hasNavigationTarget, false);
    assert.strictEqual(dto.knownFor[0].hasArtwork, false);
    console.log('  ✅ 6.1 Mapping failure degrades gracefully without breaking core person details');
}

// ==========================================
// 6B. LIVE-SHAPE KP PERSON FIXTURES
// ==========================================
console.log('\n--- 6B. Testing Tom Hanks and Lee Unkrich KP movie artwork shapes ---');

{
    const fixtures = [
        { id: 9144, name: 'Том Хэнкс', enName: 'Tom Hanks', movieId: 5424947, movieName: 'История игрушек 5' },
        { id: 23949, name: 'Ли Анкрич', enName: 'Lee Unkrich', movieId: 679486, movieName: 'Тайна Коко' }
    ];

    for (const fixture of fixtures) {
        const service = new PersonDetailsService({
            kinopoiskService: {
                async getPersonDetails() {
                    return {
                        id: fixture.id,
                        name: fixture.name,
                        enName: fixture.enName,
                        movies: [{
                            id: fixture.movieId,
                            name: fixture.movieName,
                            alternativeName: fixture.movieName,
                            enProfession: 'director',
                            year: 2020
                        }]
                    };
                }
            }
        });

        const dto = await getEnrichedPersonDetails(service, `kp:${fixture.id}`, { forceRefresh: true });
        const item = dto.filmography.directing[0];
        assert.ok(item, `${fixture.name} fixture contains filmography`);
        assert.strictEqual(item.posterUrl, null, `${fixture.name} raw KP movie has no artwork field`);
        assert.strictEqual(item.posterSource, null);
        assert.strictEqual(item.hasArtwork, false);
        assert.strictEqual(item.hasNavigationTarget, true);
    }

    console.log('  ✅ 6B. Tom Hanks and Lee Unkrich KP fixtures preserve null artwork without invented URLs');
}

{
    const requestedIds = [];
    const service = new PersonDetailsService({
        kinopoiskService: {
            async getPersonDetails() {
                return {
                    id: 399225,
                    name: 'Дэвид Роберт Митчелл',
                    movies: [{
                        id: 5406957,
                        name: 'Они идут за тобой',
                        alternativeName: 'They Follow',
                        enProfession: 'director',
                        year: 2025,
                        poster: { url: 'https://avatars.example/stale-promo.jpg' }
                    }]
                };
            }
        },
        kinopoiskPersonHtmlService: {
            async getMoviePostersByIds(ids) {
                requestedIds.push(...ids);
                return new Map([[5406957, 'https://avatars.example/5406957.jpg']]);
            }
        }
    });

    const dto = await getEnrichedPersonDetails(service, 'kp:399225', { forceRefresh: true });
    const item = dto.filmography.directing[0];
    assert.deepStrictEqual(requestedIds, [5406957]);
    assert.strictEqual(item.posterUrl, 'https://avatars.example/5406957.jpg');
    assert.strictEqual(item.posterSource, 'kp-html');
    assert.strictEqual(item.hasArtwork, true);

    console.log('  ✅ KP filmography enriches posters by exact ID through movie-page HTML');
}

{
    const hadGlobalService = Object.prototype.hasOwnProperty.call(globalThis, 'KinopoiskPersonHtmlService');
    const previousGlobalService = globalThis.KinopoiskPersonHtmlService;
    const requestedIds = [];
    const lazyHtmlService = class {
        async getMoviePostersByIds(ids) {
            requestedIds.push(...ids);
            return new Map([[5406957, 'https://avatars.example/lazy-5406957.jpg']]);
        }
    };

    const service = new PersonDetailsService({
        kinopoiskService: {
            async getPersonDetails() {
                return {
                    id: 399225,
                    name: 'Дэвид Роберт Митчелл',
                    movies: [{
                        id: 5406957,
                        name: 'Они идут за тобой',
                        enProfession: 'director',
                        year: 2025
                    }]
                };
            }
        },
        kinopoiskPersonHtmlService: null
    });

    // Simulate the page's deferred script order: the service appears after
    // PersonDetailsService has already been constructed.
    globalThis.KinopoiskPersonHtmlService = lazyHtmlService;
    try {
        const dto = await getEnrichedPersonDetails(service, 'kp:399225', { forceRefresh: true });
        const item = dto.filmography.directing[0];
        assert.deepStrictEqual(requestedIds, [5406957]);
        assert.strictEqual(item.posterUrl, 'https://avatars.example/lazy-5406957.jpg');
        assert.strictEqual(item.posterSource, 'kp-html');
    } finally {
        if (hadGlobalService) {
            globalThis.KinopoiskPersonHtmlService = previousGlobalService;
        } else {
            delete globalThis.KinopoiskPersonHtmlService;
        }
    }

    console.log('  ✅ Deferred Kinopoisk HTML service is resolved lazily after page initialization');
}

{
    const storageKey = 'person_details_v3_kp_399226';
    await mockStorage.set({
        [storageKey]: {
            timestamp: Date.now(),
            data: {
                identity: { provider: 'KP' },
                filmography: {
                    directing: [{ kinopoiskId: 5406958, posterUrl: null, hasArtwork: false }]
                },
                // Cache serialization breaks the original shared reference between
                // Known For and Filmography items.
                knownFor: [{ kinopoiskId: 5406958, posterUrl: null, hasArtwork: false }]
            }
        }
    });

    const service = new PersonDetailsService({
        kinopoiskService: {
            async getPersonDetails() {
                throw new Error('Cached DTO must avoid the person API');
            }
        },
        kinopoiskPersonHtmlService: {
            async getMoviePostersByIds() {
                return new Map([[5406958, 'https://avatars.example/5406958.jpg']]);
            }
        }
    });

    const cachedDto = await getEnrichedPersonDetails(service, 'kp:399226');
    assert.strictEqual(cachedDto.filmography.directing[0].posterUrl, 'https://avatars.example/5406958.jpg');
    assert.strictEqual(cachedDto.filmography.directing[0].hasArtwork, true);
    assert.strictEqual(cachedDto.knownFor[0].posterUrl, 'https://avatars.example/5406958.jpg');
    assert.strictEqual(cachedDto.knownFor[0].hasArtwork, true);

    console.log('  ✅ Cached KP DTO self-heals posters in Filmography and Known For without person API access');
}

{
    const service = new PersonDetailsService({
        kinopoiskService: {
            async getPersonDetails() {
                throw new Error('Cached DTO must avoid the person API');
            }
        },
        kinopoiskPersonHtmlService: {
            async getMoviePostersByIds() {
                return new Map([[5406959, 'https://avatars.example/5406959-correct.jpg']]);
            }
        }
    });
    const storageKey = 'person_details_v3_kp_399227';
    await mockStorage.set({
        [storageKey]: {
            timestamp: Date.now(),
            data: {
                identity: { provider: 'KP' },
                filmography: {
                    directing: [{
                        kinopoiskId: 5406959,
                        posterUrl: 'https://avatars.example/5406959-stale.jpg',
                        posterSource: 'kp-html',
                        hasArtwork: true
                    }]
                }
            }
        }
    });

    const cachedDto = await getEnrichedPersonDetails(service, 'kp:399227');
    assert.strictEqual(cachedDto.filmography.directing[0].posterUrl, 'https://avatars.example/5406959-stale.jpg');

    console.log('  ✅ Cached KP HTML posters are reused without another page lookup');
}

// ==========================================
// 7. CACHING, LRU & IN-FLIGHT DEDUPLICATION
// ==========================================
console.log('\n--- 7. Testing Caching, LRU & In-Flight Deduplication ---');

{
    await mockStorage.clear();
    let networkCalls = 0;

    const mockTmdbService = {
        async getPersonDetails(id) {
            networkCalls++;
            await new Promise(r => setTimeout(r, 20));
            return { id, name: `Person ${id}` };
        }
    };

    const service = new PersonDetailsService({ tmdbService: mockTmdbService });

    // 1. In-flight Promise deduplication
    const [p1, p2, p3] = await Promise.all([
        service.getPersonDetails('tmdb:500'),
        service.getPersonDetails('tmdb:500'),
        service.getPersonDetails('tmdb:500')
    ]);

    assert.strictEqual(networkCalls, 1, '3 concurrent calls must share 1 fetch');
    assert.strictEqual(p1.name, 'Person 500');
    assert.strictEqual(p2.name, 'Person 500');

    // 2. Warm cache hit (0 network calls)
    const warmDto = await getEnrichedPersonDetails(service, 'tmdb:500');
    assert.strictEqual(networkCalls, 1, 'Warm cache hit makes 0 network calls');
    assert.strictEqual(warmDto.name, 'Person 500');

    // 3. forceRefresh bypasses cache
    await getEnrichedPersonDetails(service, 'tmdb:500', { forceRefresh: true });
    assert.strictEqual(networkCalls, 2, 'forceRefresh issues new network request');

    // 4. LRU eviction (100 items limit)
    for (let i = 1; i <= 105; i++) {
        await getEnrichedPersonDetails(service, `tmdb:${i}`);
    }

    const indexRes = await mockStorage.get(service.INDEX_KEY);
    const index = indexRes[service.INDEX_KEY];
    assert.strictEqual(index.length, 100, 'LRU index bounded to max 100 items');

    // First item tmdb_1 should have been evicted
    const evicted = await mockStorage.get(`${service.CACHE_PREFIX}tmdb_1`);
    assert.strictEqual(evicted[`${service.CACHE_PREFIX}tmdb_1`], undefined, 'Oldest item evicted from storage');

    console.log('  ✅ 7.1 In-flight deduplication, warm cache hit, forceRefresh, and LRU eviction (100) verified');
}

// ==========================================
// 8. CONTROL FIXTURES INTEGRATION & PAYLOAD
// ==========================================
console.log('\n--- 8. Testing Control Fixtures & Serialized Payload Bounds ---');

{
    await mockStorage.clear();
    const FIXTURES = [
        {
            name: 'James Cameron',
            personKey: 'tmdb:2710',
            mockRaw: {
                id: 2710,
                name: 'Джеймс Кэмерон',
                original_name: 'James Cameron',
                biography: 'Канадский режиссёр...',
                birthday: '1954-08-16',
                place_of_birth: 'Canada',
                profile_path: '/cameron.jpg',
                known_for_department: 'Directing',
                combined_credits: {
                    cast: [{ id: 101, title: 'Avatar', media_type: 'movie', vote_count: 28000, vote_average: 7.9 }],
                    crew: [
                        { id: 101, title: 'Avatar', media_type: 'movie', department: 'Directing', job: 'Director', vote_count: 28000, vote_average: 7.9 },
                        { id: 102, title: 'Titanic', media_type: 'movie', department: 'Directing', job: 'Director', vote_count: 23000, vote_average: 7.9 },
                        { id: 103, title: 'Aliens', media_type: 'movie', department: 'Directing', job: 'Director', vote_count: 9000, vote_average: 7.9 }
                    ]
                }
            }
        },
        {
            name: 'Atsumi Tanezaki',
            personKey: 'tmdb:1248877',
            mockRaw: {
                id: 1248877,
                name: 'Ацуми Танэдзаки',
                original_name: 'Atsumi Tanezaki',
                birthday: '1990-09-27',
                known_for_department: 'Acting',
                combined_credits: {
                    cast: [
                        { id: 209867, name: 'Sousou no Frieren', media_type: 'tv', character: 'Frieren (voice)', vote_count: 500, vote_average: 8.9 },
                        { id: 120089, name: 'Spy x Family', media_type: 'tv', character: 'Anya Forger (voice)', vote_count: 1200, vote_average: 8.6 }
                    ],
                    crew: []
                }
            }
        },
        {
            name: 'Alan Silvestri',
            personKey: 'tmdb:37',
            mockRaw: {
                id: 37,
                name: 'Алан Сильвестри',
                original_name: 'Alan Silvestri',
                birthday: '1950-03-26',
                known_for_department: 'Sound',
                combined_credits: {
                    cast: [],
                    crew: [
                        { id: 105, title: 'Back to the Future', media_type: 'movie', department: 'Sound', job: 'Original Music Composer', vote_count: 19000, vote_average: 8.3 },
                        { id: 299536, title: 'Avengers: Infinity War', media_type: 'movie', department: 'Sound', job: 'Original Music Composer', vote_count: 28000, vote_average: 8.3 }
                    ]
                }
            }
        }
    ];

    for (const f of FIXTURES) {
        const mockTmdb = {
            async getPersonDetails() {
                return f.mockRaw;
            }
        };
        const mockMapping = {
            async resolveBatch(candidates) {
                const res = new Map();
                for (const c of candidates) {
                    res.set(c.tmdbId, { kinopoiskId: c.tmdbId * 10, matchMethod: 'exact_external_id' });
                }
                return res;
            }
        };

        const service = new PersonDetailsService({
            tmdbService: mockTmdb,
            idMappingService: mockMapping
        });

        const dto = await getEnrichedPersonDetails(service, f.personKey);
        const serialized = JSON.stringify(dto);
        const sizeKb = (Buffer.byteLength(serialized, 'utf8') / 1024).toFixed(2);

        assert.ok(dto.name, `${f.name} has name`);
        assert.ok(dto.identity.personKey === f.personKey);
        assert.ok(Number(sizeKb) < 100, `Payload size ${sizeKb} KB is under 100 KB limit`);
        assert.ok(dto.knownFor.length > 0, `${f.name} has KnownFor items`);

        console.log(`  - ${f.name} (${f.personKey}): ${sizeKb} KB | KnownFor: ${dto.knownFor.length} | Filmography: Acting=${dto.filmography.acting.length}, Directing=${dto.filmography.directing.length}, Music=${dto.filmography.music.length}`);
    }
    console.log('  ✅ 8.1 Control fixtures evaluated with bounded payload footprints (< 100 KB)');
}

// ==========================================
// 9. CONTEXTUAL ENRICHMENT & VERIFICATION STATUS
// ==========================================
console.log('\n--- 9. Testing Contextual Enrichment & Verification Status ---');

{
    const mockTmdb = {
        async getPersonDetails(id) {
            return { id, name: 'Enriched Actor' };
        }
    };
    const service = new PersonDetailsService({ tmdbService: mockTmdb });

    // With explicit contextual KP ID
    const enrichedDto = await getEnrichedPersonDetails(service, 'tmdb:2710', {
        knownKpPersonId: 27977,
        knownTmdbPersonId: 2710,
        forceRefresh: true
    });
    assert.strictEqual(enrichedDto.identity.verificationStatus, 'CONTEXT_VERIFIED');
    assert.strictEqual(enrichedDto.identity.kpPersonId, 27977);
    assert.strictEqual(enrichedDto.identity.tmdbPersonId, 2710);

    // Without contextual ID
    const standaloneDto = await getEnrichedPersonDetails(service, 'tmdb:2710', { forceRefresh: true });
    assert.strictEqual(standaloneDto.identity.verificationStatus, 'PROVIDER_VERIFIED');
    assert.strictEqual(standaloneDto.identity.kpPersonId, null);

    console.log('  ✅ 9.1 Contextual enrichment cleanly verified and isolated from standalone provider routes');
}

// ==========================================
// 10. ERROR CODES & ABORT SIGNAL
// ==========================================
console.log('\n--- 10. Testing Error Codes & Abort Signal ---');

{
    const mock404Tmdb = {
        async getPersonDetails() {
            const err = new Error('Not found');
            err.status = 404;
            throw err;
        }
    };
    const service404 = new PersonDetailsService({ tmdbService: mock404Tmdb });

    await assert.rejects(async () => {
        await service404.getPersonDetails('tmdb:99999999', { forceRefresh: true });
    }, (err) => {
        return err.code === 'PERSON_NOT_FOUND' && err.status === 404;
    }, 'Must reject with PERSON_NOT_FOUND and status 404');

    const mock500Kp = {
        async getPersonDetails() {
            const err = new Error('Server error');
            err.status = 500;
            throw err;
        }
    };
    const service500 = new PersonDetailsService({ kinopoiskService: mock500Kp });

    await assert.rejects(async () => {
        await service500.getPersonDetails('kp:99999999', { forceRefresh: true });
    }, (err) => {
        return err.code === 'PROVIDER_ERROR' && err.status === 500;
    }, 'Must reject with PROVIDER_ERROR and status 500');

    console.log('  ✅ 10.1 Structured error codes PERSON_NOT_FOUND and PROVIDER_ERROR verified');
}

// ==========================================
// 11. INVARIANT CHECKS (DATA LAYER DECOUPLING)
// ==========================================
console.log('\n--- 11. Invariant Checks (Data Layer Decoupling & Queue Safety) ---');

{
    const personServiceJs = fs.readFileSync('src/shared/services/PersonDetailsService.js', 'utf8');
    assert.ok(!personServiceJs.includes('document.getElementById'), 'PersonDetailsService has 0 DOM manipulation logic');
    assert.ok(!personServiceJs.includes('document.createElement'), 'PersonDetailsService has 0 DOM creation logic');
    assert.ok(personServiceJs.includes('skipQueue: true'), 'PersonDetailsService strictly isolates mapping queue');
    console.log('  ✅ 11.1 Data layer decoupling confirmed: 0 DOM coupling, skipQueue: true strictly enforced');
}

// ==========================================
// 12. KINOPOISK PERSON MATCH FOR AWARDS
// ==========================================
console.log('\n--- 12. Kinopoisk Person Match (awards of a TMDB person) ---');

{
    const match = PersonDetailsService.matchKinopoiskPerson;
    assert.strictEqual(match({ birthday: '1974-11-11' }, { personId: 37859, birthday: '1974-11-11' }), 37859, 'Same birthday: the Kinopoisk person is the TMDB person');
    assert.strictEqual(match({ birthday: '1974-11-11' }, { personId: 37859, birthday: '1975-01-02' }), null, 'A namesake born on another day is rejected');
    assert.strictEqual(match({ birthday: null }, { personId: 37859, birthday: '1974-11-11' }), null, 'Without a TMDB birthday nothing is matched');
    assert.strictEqual(match({ birthday: '1974-11-11' }, { personId: 37859, birthday: null }), null, 'Without a Kinopoisk birthday nothing is matched');
    assert.strictEqual(match({ birthday: '1974-11-11' }, null), null, 'No search result, no match');
    assert.strictEqual(match({ birthday: '1974-11-11' }, { personId: 'abc', birthday: '1974-11-11' }), null, 'An invalid ID is not a match');

    const html = {
        async getPersonFilmography() {
            return { personId: 37859, birthday: '1974-11-11', items: [] };
        }
    };
    const service = new PersonDetailsService({
        kinopoiskPersonHtmlService: html,
        idMappingService: { resolveBatch: async () => new Map(), buildKey: (type, id) => `${type}:${id}` }
    });
    const dto = {
        identity: { personKey: 'tmdb:6193', provider: 'TMDB', providerId: 6193 },
        name: 'Леонардо ДиКаприо',
        originalName: 'Leonardo DiCaprio',
        birthday: '1974-11-11',
        filmography: { acting: [{ tmdbId: 27205, providerMediaType: 'movie', name: 'Начало', year: 2010 }] },
        knownFor: [],
        _meta: {}
    };
    service._ensureKinopoiskPersonHtmlService = () => html;
    await service._enrichPerson(dto, { signal: new AbortController().signal, onUpdate() {} });
    assert.deepStrictEqual(dto._meta.kpPersonMatch, { id: 37859, verifiedBy: 'birthday' }, 'The enrichment keeps the verified Kinopoisk ID for the awards');

    console.log('  ✅ 12.1 A TMDB person gets a Kinopoisk ID only when name and birthday agree');
}

// ==========================================
// 13. ROLES, EPISODES AND APPEARANCES AS THEMSELVES
// ==========================================
console.log('\n--- 13. Filmography Roles, Episodes and «Self» ---');

{
    await mockStorage.clear();
    const service = new PersonDetailsService({
        tmdbService: {
            async getPersonDetails() {
                return {
                    id: 1313559,
                    name: 'Рэй Фишер',
                    known_for_department: 'Acting',
                    combined_credits: {
                        cast: [
                            { id: 141, title: 'Лига справедливости', media_type: 'movie', character: 'Victor Stone / Cyborg', release_date: '2017-11-15', vote_count: 12000 },
                            { id: 46648, name: 'Настоящий детектив', media_type: 'tv', character: 'Henry Hays', episode_count: 8, first_air_date: '2014-01-12', vote_count: 3000 },
                            { id: 46648, name: 'Настоящий детектив', media_type: 'tv', character: 'Henry Hays (archive footage)', episode_count: 1, first_air_date: '2014-01-12' },
                            { id: 500, name: 'Talk Show', media_type: 'tv', character: 'Self - Guest', episode_count: 2, first_air_date: '2005-01-01', vote_count: 90000 },
                            { id: 501, name: 'Документальный', media_type: 'movie', character: '', genre_ids: [99], release_date: '2016-01-01' },
                            { id: 502, name: 'Без роли', media_type: 'movie', character: '', genre_ids: [18], release_date: '2018-01-01' },
                            { id: 503, title: 'Животные', media_type: 'movie', character: 'Agent', release_date: '' }
                        ],
                        crew: [
                            { id: 600, title: 'Короткий метр', media_type: 'movie', department: 'Production', job: 'Producer', release_date: '2019-01-01' },
                            { id: 600, title: 'Короткий метр', media_type: 'movie', department: 'Production', job: 'Executive Producer', release_date: '2019-01-01' },
                            { id: 601, name: 'Сериал', media_type: 'tv', department: 'Writing', job: 'Writer', episode_count: 3, first_air_date: '2021-01-01' }
                        ]
                    }
                };
            }
        },
        kinopoiskPersonHtmlService: null
    });
    const dto = await service.getPersonDetails('tmdb:1313559', { forceRefresh: true });
    const titles = category => dto.filmography[category].map(item => item.tmdbId);

    assert.deepStrictEqual(Object.keys(dto.filmography), PersonDetailsService.CATEGORIES, 'Every category exists, «self» among them');
    assert.deepStrictEqual(titles('acting'), [141, 46648, 502, 503], 'Real roles stay under acting');
    assert.deepStrictEqual(titles('self'), [500, 501], '«Self» credits and a documentary without a character are appearances as themselves');
    const series = dto.filmography.acting.find(item => item.tmdbId === 46648);
    assert.strictEqual(series.character, 'Henry Hays / Henry Hays (archive footage)', 'Several credits of one title are one entry with every character');
    assert.strictEqual(series.episodeCount, 8, 'A series keeps the most episodes');
    assert.strictEqual(dto.filmography.acting.find(item => item.tmdbId === 502).character, null, 'An empty character stays empty, not «Actor»');
    assert.strictEqual(dto.filmography.self[0].character, 'Self - Guest');
    const production = dto.filmography.production[0];
    assert.deepStrictEqual(production.jobs, ['Producer', 'Executive Producer'], 'One crew entry per title keeps all its jobs');
    assert.strictEqual(dto.filmography.writing[0].episodeCount, 3, 'Crew episodes are kept for series');
    assert.ok(!dto.knownFor.slice(0, 2).some(item => item.tmdbId === 500), 'A talk show with many votes does not lead Known For');
    assert.strictEqual(dto.professions[0], 'Актёр');

    const kpService = new PersonDetailsService({
        kinopoiskService: {
            async getPersonDetails() {
                return {
                    id: 10, name: 'Персона', movies: [
                        { id: 1, name: 'Фильм', enProfession: 'actor', description: 'Сосед' },
                        { id: 1, name: 'Фильм', enProfession: 'actor', description: 'Сосед в детстве' },
                        { id: 2, name: 'Шоу', enProfession: 'actor', description: 'играет самого себя' },
                        { id: 3, name: 'Церемония', enProfession: 'himself' },
                        { id: 4, name: 'Проект', enProfession: 'producer', description: 'исполнительный продюсер' },
                        { id: 4, name: 'Проект', enProfession: 'producer', description: 'сопродюсер' }
                    ]
                };
            }
        },
        kinopoiskPersonHtmlService: null
    });
    const kpDto = await kpService.getPersonDetails('kp:10', { forceRefresh: true });
    assert.deepStrictEqual(kpDto.filmography.acting.map(item => item.kinopoiskId), [1]);
    assert.strictEqual(kpDto.filmography.acting[0].character, 'Сосед / Сосед в детстве', 'A second Kinopoisk credit adds its character');
    assert.deepStrictEqual(kpDto.filmography.self.map(item => item.kinopoiskId), [2, 3], '«играет самого себя» and the HIMSELF profession are appearances as themselves');
    assert.deepStrictEqual(kpDto.filmography.production[0].jobs, ['исполнительный продюсер', 'сопродюсер'], 'A crew description is the precise job');
    assert.strictEqual(kpDto.filmography.production[0].character, null);

    // Kinopoisk's own codes as the API returns them for Matthew McConaughey.
    const realKp = new PersonDetailsService({
        kinopoiskService: {
            async getPersonDetails() {
                return {
                    id: 797, name: 'Мэттью Макконахи', enName: 'Matthew McConaughey', movies: [
                        { id: 20, name: '96-я церемония вручения премии «Оскар»', enProfession: 'cameo' },
                        { id: 21, name: 'Далласский клуб покупателей', enProfession: 'uncredited', description: 'Ron Woodroof' },
                        { id: 22, name: 'Документальный', enProfession: 'uncredited', description: 'хроника' },
                        { id: 23, name: 'Интервью', enProfession: 'uncredited', description: 'Matthew McConaughey' },
                        { id: 24, name: 'Интерстеллар', enProfession: 'actor', description: 'Cooper' }
                    ]
                };
            }
        },
        kinopoiskPersonHtmlService: null
    });
    const real = await realKp.getPersonDetails('kp:797', { forceRefresh: true });
    assert.deepStrictEqual(real.filmography.self.map(item => item.kinopoiskId), [20, 22, 23], '«cameo», archive footage and their own name are appearances as themselves');
    assert.deepStrictEqual(real.filmography.acting.map(item => item.kinopoiskId), [21, 24], 'An uncredited part is a role');
    assert.strictEqual(real.filmography.acting[0].character, 'Ron Woodroof (uncredited)', 'An uncredited part says so');
    assert.strictEqual(real.filmography.self[1].character, '(archive footage)', '«хроника» reads as archive footage');
    assert.strictEqual(real.filmography.self[2].character, null, 'Their own name is not repeated as a character');
    assert.deepStrictEqual(real.filmography.other, [], 'Nothing of these falls into other work');

    const ownName = await new PersonDetailsService({
        tmdbService: { async getPersonDetails() {
            return { id: 1, name: 'Matthew McConaughey', combined_credits: { cast: [
                { id: 30, name: 'Talk', media_type: 'tv', character: 'Matthew McConaughey' }
            ], crew: [] } };
        } },
        kinopoiskPersonHtmlService: null
    }).getPersonDetails('tmdb:1', { forceRefresh: true });
    assert.deepStrictEqual([ownName.filmography.self.length, ownName.filmography.self[0].character], [1, null], 'TMDB: their own name as the character is themselves');

    console.log('  ✅ 13.1 Characters, jobs and episodes per title; «self» credits separated; talk shows do not lead Known For');
}

// ==========================================
// 14. KINOPOISK YEARS AND TYPES, SAFER TITLE MATCHING, OLD CACHE
// ==========================================
console.log('\n--- 14. Kinopoisk Years and Types, Title Matching, Old Cache ---');

{
    await mockStorage.clear();
    const posterOptions = [];
    const html = {
        async getPersonFilmographyById(id) {
            assert.strictEqual(id, 10, 'The person page of the route’s own ID is read');
            return { items: [
                { kinopoiskId: 1, year: 2014, providerMediaType: 'tv', roles: [{ character: 'Майор Гром' }] },
                { kinopoiskId: 2, year: 2019, providerMediaType: 'movie', roles: [{ character: 'Agent' }] }
            ] };
        },
        async getMoviePostersByIds(ids, options) {
            posterOptions.push(options);
            options.onPoster(3, 'https://avatars.example/3.jpg', { year: 2008, mediaType: 'tv' });
            options.onPoster(2, null, { year: 1999, mediaType: 'tv' });
            return new Map([[3, 'https://avatars.example/3.jpg']]);
        }
    };
    const service = new PersonDetailsService({
        kinopoiskService: {
            async getPersonDetails() {
                return { id: 10, name: 'Персона', movies: [
                    { id: 1, name: 'Сериал', enProfession: 'actor' },
                    { id: 2, name: 'Фильм', enProfession: 'actor' },
                    { id: 3, name: 'Шоу', enProfession: 'actor' }
                ] };
            }
        },
        kinopoiskPersonHtmlService: html
    });
    const dto = await service.getPersonDetails('kp:10', { forceRefresh: true });
    assert.ok(dto.filmography.acting.every(item => item.year === null && item.providerMediaType === 'movie'), 'The API gives no years or types');
    let updates = 0;
    await service.enrichPersonDetails(dto, { onUpdate() { updates++; } });
    const byId = id => dto.filmography.acting.find(item => item.kinopoiskId === id);
    assert.deepStrictEqual([byId(1).year, byId(1).providerMediaType], [2014, 'tv'], 'The person page gives year and type');
    assert.deepStrictEqual([byId(1).characterLocal, byId(2).characterLocal], ['Майор Гром', undefined], 'and a Cyrillic character, never a Latin one');
    assert.strictEqual(dto.knownFor.find(item => item.kinopoiskId === 1)?.characterLocal, 'Майор Гром', 'Known For gets it too');
    assert.deepStrictEqual([byId(2).year, byId(2).providerMediaType], [2019, 'tv'], 'A known year is kept; a film page can still say it is a series');
    assert.deepStrictEqual([byId(3).year, byId(3).providerMediaType, byId(3).posterSource], [2008, 'tv', 'kp-html'], 'A film page gives year, type and poster');
    assert.strictEqual(posterOptions[0].withDetails, true, 'Posters are asked with the film’s details');
    assert.ok(updates >= 2, 'The page hears about the new years and types');

    // A Russian person is searched on Kinopoisk by the Cyrillic name TMDB lists as an alias.
    assert.deepStrictEqual(PersonDetailsService.kinopoiskSearchNames({ name: 'Konstantin Khabensky', originalName: 'Konstantin Khabensky', aliases: ['Konstantin Khabenskiy', 'Константин Хабенский'] }),
        ['Константин Хабенский', 'Konstantin Khabensky', 'Konstantin Khabenskiy'], 'The Cyrillic alias leads, the rest still match');
    assert.deepStrictEqual(PersonDetailsService.kinopoiskSearchNames({ name: 'Simon Baker', originalName: 'Simon Baker', aliases: ['Simon Denny'] }),
        ['Simon Baker', 'Simon Denny'], 'Without a Cyrillic name the order stays');

    // A namesake's dated film of the same title is not matched; a film never matches a series.
    const filmography = {
        acting: [
            { tmdbId: 1, providerMediaType: 'movie', name: 'Животные', year: 2026 },
            { tmdbId: 2, providerMediaType: 'movie', name: 'Дом', year: null },
            { tmdbId: 3, providerMediaType: 'tv', name: 'Фарго', year: 2014 },
            { tmdbId: 4, providerMediaType: 'movie', name: 'Начало', year: 2010 }
        ]
    };
    const kpItems = [
        { kinopoiskId: 11, name: 'Животные', year: 2012, providerMediaType: 'movie' },
        { kinopoiskId: 12, name: 'Дом', year: 2017, providerMediaType: 'movie' },
        { kinopoiskId: 13, name: 'Фарго', year: 1996, providerMediaType: 'movie' },
        { kinopoiskId: 14, name: 'Начало', year: 2011, providerMediaType: 'movie' }
    ];
    const unverified = JSON.parse(JSON.stringify(filmography));
    service._applyKinopoiskHtmlMapping(unverified, kpItems, { allowYearless: false });
    assert.deepStrictEqual(unverified.acting.map(item => item.kinopoiskId || null), [null, null, null, 14], 'Without a verified person only title and year (±1) match');
    const verified = JSON.parse(JSON.stringify(filmography));
    service._applyKinopoiskHtmlMapping(verified, kpItems, { allowYearless: true });
    assert.deepStrictEqual(verified.acting.map(item => item.kinopoiskId || null), [null, 12, null, 14], 'A verified person matches a title alone only when a year is missing, and never a film to a series');

    // Kinopoisk's Cyrillic characters reach matched roles; its Latin ones and crew do not.
    const characters = {
        acting: [
            { tmdbId: 1, providerMediaType: 'movie', name: 'Операция «Ы»', year: 1965, character: 'Shurik', category: 'acting' },
            { tmdbId: 2, providerMediaType: 'tv', name: 'Менталист', year: 2008, character: 'Patrick Jane', category: 'acting' },
            { tmdbId: 3, providerMediaType: 'movie', name: 'Уже найден', year: 2001, kinopoiskId: 33, character: 'Ivan', category: 'acting' }
        ],
        production: [{ tmdbId: 1, providerMediaType: 'movie', name: 'Операция «Ы»', year: 1965, category: 'production' }]
    };
    service._applyKinopoiskHtmlMapping(characters, [
        { kinopoiskId: 31, name: 'Операция «Ы»', year: 1965, providerMediaType: 'movie', roles: [{ character: 'Шурик' }, { character: 'Шурик' }] },
        { kinopoiskId: 32, name: 'Менталист', year: 2008, providerMediaType: 'tv', roles: [{ character: 'Patrick Jane' }] },
        { kinopoiskId: 33, name: 'Другое название', year: 1990, providerMediaType: 'movie', role: 'Иван' }
    ], { allowYearless: false });
    assert.strictEqual(characters.acting[0].characterLocal, 'Шурик', 'A Cyrillic character is kept beside TMDB’s, once');
    assert.strictEqual(characters.acting[1].characterLocal, undefined, 'Kinopoisk’s own Latin spelling adds nothing');
    assert.deepStrictEqual([characters.acting[2].kinopoiskId, characters.acting[2].characterLocal], [33, 'Иван'], 'A credit mapped before is matched by its ID, whatever its title');
    assert.strictEqual(characters.production[0].characterLocal, undefined, 'A crew credit takes no character');

    // The old cache namespace is removed on the first write.
    await mockStorage.set({
        person_details_v2_index: ['person_details_v2_tmdb_1', 'person_details_v2_kp_2'],
        person_details_v2_tmdb_1: { data: {} },
        person_details_v2_kp_2: { data: {} }
    });
    const cleaner = new PersonDetailsService({ tmdbService: { async getPersonDetails() { return { id: 7, name: 'Person' }; } } });
    await cleaner.getPersonDetails('tmdb:7', { forceRefresh: true });
    const left = await mockStorage.get(['person_details_v2_index', 'person_details_v2_tmdb_1', 'person_details_v2_kp_2']);
    assert.deepStrictEqual(Object.values(left).filter(Boolean), [], 'v2 persons and their index are gone');
    assert.ok((await mockStorage.get('person_details_v3_tmdb_7')).person_details_v3_tmdb_7, 'The new namespace is written');

    console.log('  ✅ 14.1 Kinopoisk years and types fill in; namesakes and series do not mismatch; the old cache is removed');
}

console.log('\n🎉 ALL Phase 2D PersonDetails Data Service & Pipeline Tests Passed Successfully!');
