const assert = require('assert');
const KINOPOISK_CONFIG = require('../src/shared/config/kinopoisk.config.js');
const TMDB_CONFIG = require('../src/shared/config/tmdb.config.example.js');
globalThis.KINOPOISK_CONFIG = KINOPOISK_CONFIG;
globalThis.TMDB_CONFIG = TMDB_CONFIG;
const KinopoiskService = require('../src/shared/services/KinopoiskService.js');
const TMDBService = require('../src/shared/services/TMDBService.js');
const MediaAggregatorService = require('../src/shared/services/MediaAggregatorService.js');

console.log('🧪 Running MediaAggregatorService V1 Comprehensive Test Suite...\n');

// ==========================================
// 1. Metadata Quality Classification Tests
// ==========================================
console.log('--- 1. Testing Metadata Quality Classification ---');

// 1.1 KP FULL (without ratings required)
const kpFull = {
    kinopoiskId: 12345,
    name: 'Интерстеллар',
    alternativeName: 'Interstellar',
    year: 2014,
    description: 'Когда засуха, пыльные бури и вымирание растений приводят человечество к продовольственному кризису...',
    posterUrl: 'https://kinopoisk.ru/poster.jpg',
    genres: [{ name: 'фантастика' }, { name: 'драма' }],
    countries: [{ name: 'США' }],
    duration: 169
};
assert.strictEqual(MediaAggregatorService.classifyKpQuality(kpFull), 'FULL', 'KP with full info must be FULL (ratings NOT required)');

// 1.2 Upcoming movie (2026) with no ratings
const kpUpcoming2026 = {
    kinopoiskId: 99999,
    name: 'Дюна 3',
    year: 2026,
    description: 'Продолжение эпической саги Дени Вильнева на пустынной планете Арракис.',
    posterUrl: 'https://kinopoisk.ru/dune3.jpg',
    genres: [{ name: 'фантастика' }],
    kpRating: null,
    imdbRating: null
};
assert.strictEqual(MediaAggregatorService.classifyKpQuality(kpUpcoming2026), 'FULL', 'Upcoming movie with 0 ratings must still be FULL');

// 1.3 KP DRAFT (The Backrooms KP entity)
const kpBackroomsDraft = {
    kinopoiskId: 5452840,
    name: 'Фильм',
    year: 2026,
    description: '',
    posterUrl: '',
    genres: [],
    externalId: { tmdb: 1083381 }
};
assert.strictEqual(MediaAggregatorService.classifyKpQuality(kpBackroomsDraft), 'DRAFT', 'KP entity with generic title and missing poster/description must be DRAFT');

// 1.4 KP EMPTY
assert.strictEqual(MediaAggregatorService.classifyKpQuality({ kinopoiskId: 111 }), 'EMPTY', 'Empty KP object must be EMPTY');
assert.strictEqual(MediaAggregatorService.classifyKpQuality(null), 'UNAVAILABLE', 'Null KP object must be UNAVAILABLE');

// 1.5 TMDB FULL
const tmdbFull = {
    tmdbId: 1083381,
    name: 'The Backrooms',
    originalName: 'The Backrooms',
    year: 2026,
    release_date: '2026-05-15',
    description: 'A young filmmaker’s terrifying journey into an alternate dimension of endless yellow rooms.',
    posterUrl: 'https://image.tmdb.org/t/p/w500/backrooms.jpg',
    backdrop: 'https://image.tmdb.org/t/p/original/backrooms_bg.jpg',
    genres: [{ name: 'ужасы' }, { name: 'фантастика' }],
    duration: 110,
    vote_average: 7.8,
    vote_count: 320
};
assert.strictEqual(MediaAggregatorService.classifyTmdbQuality(tmdbFull), 'FULL', 'TMDB with full info must be FULL');

console.log('  ✅ Quality classification tests passed');

// ==========================================
// 2. Identity Verification & Contradiction Tests
// ==========================================
console.log('\n--- 2. Testing Identity Contract & Contradiction Rejection ---');

// 2.1 Exact externalId.tmdb verification
const identityAuto = MediaAggregatorService.resolveIdentity(
    { kinopoiskId: 5452840, externalId: { tmdb: 1083381 } },
    { tmdbId: 1083381 }
);
assert.strictEqual(identityAuto.status, 'VERIFIED', 'Exact externalId.tmdb must yield status: VERIFIED');
assert.strictEqual(identityAuto.verificationMethod, 'exact_external_tmdb', 'Verification method must be exact_external_tmdb');
assert.strictEqual(identityAuto.verificationSource, 'automatic', 'Verification source must be automatic');
assert.strictEqual(identityAuto.kinopoiskId, 5452840);
assert.strictEqual(identityAuto.tmdbId, 1083381);

// 2.2 Exact externalId.imdb verification
const identityImdb = MediaAggregatorService.resolveIdentity(
    { kinopoiskId: 100, externalId: { imdb: 'tt0111161' } },
    { tmdbId: 278, externalId: { imdb: 'tt0111161' } }
);
assert.strictEqual(identityImdb.status, 'VERIFIED');
assert.strictEqual(identityImdb.verificationMethod, 'exact_external_imdb');
assert.strictEqual(identityImdb.verificationSource, 'automatic');

// 2.3 Admin Manual Verification
const identityManual = MediaAggregatorService.resolveIdentity(
    { kinopoiskId: 200 },
    { tmdbId: 300 },
    { isManual: true }
);
assert.strictEqual(identityManual.status, 'VERIFIED');
assert.strictEqual(identityManual.verificationMethod, 'admin_verified');
assert.strictEqual(identityManual.verificationSource, 'manual');

// 2.4 Legacy Resolved Mappings Adaptation
const identityLegacy = MediaAggregatorService.resolveIdentity(
    { kinopoiskId: 500 },
    { tmdbId: 600 },
    { isLegacyResolved: true, status: 'resolved' }
);
assert.strictEqual(identityLegacy.status, 'VERIFIED');
assert.strictEqual(identityLegacy.verificationMethod, 'legacy_resolved');
assert.strictEqual(identityLegacy.verificationSource, 'system_legacy');

// 2.5 Heuristic Title/Year Match MUST NOT auto-verify
const identityHeuristic = MediaAggregatorService.resolveIdentity(
    { kinopoiskId: 700, name: 'Sample Movie', year: 2024 },
    { tmdbId: 800, name: 'Sample Movie', year: 2024 }
);
assert.strictEqual(identityHeuristic.status, 'UNVERIFIED', 'Heuristic match alone must remain UNVERIFIED');
assert.strictEqual(identityHeuristic.verificationMethod, null);

// 2.6 LEVIT FIXTURE: Hard External ID Contradiction Rejection
// TMDB 1564614, Candidate KP 616152 declares externalId.tmdb = 257814
const identityLevitContradiction = MediaAggregatorService.resolveIdentity(
    { kinopoiskId: 616152, externalId: { tmdb: 257814 } },
    { tmdbId: 1564614 },
    { candidateTmdbId: 1564614 }
);
assert.strictEqual(identityLevitContradiction.status, 'UNVERIFIED', 'Contradicting external ID must be UNVERIFIED');
assert.strictEqual(identityLevitContradiction.contradiction, true, 'Contradiction flag must be set');
assert.strictEqual(identityLevitContradiction.tmdbId, null, 'Contradicting TMDB ID must not be bound');

console.log('  ✅ Identity verification and contradiction rejection tests passed');

// ==========================================
// 3. Mandatory Acceptance Fixture: The Backrooms
// ==========================================
console.log('\n--- 3. Testing The Backrooms Acceptance Fixture (TMDB 1083381 ↔ KP 5452840) ---');

const backroomsKp = {
    kinopoiskId: 5452840,
    name: 'Фильм',
    alternativeName: '',
    year: 2026,
    description: '',
    posterUrl: '',
    genres: [],
    countries: [],
    externalId: { tmdb: 1083381 },
    kpRating: null,
    imdbRating: null
};

const backroomsTmdb = {
    tmdbId: 1083381,
    name: 'The Backrooms',
    originalName: 'The Backrooms',
    year: 2026,
    release_date: '2026-05-15',
    description: 'A young filmmaker’s terrifying journey into an alternate dimension.',
    posterUrl: 'https://image.tmdb.org/t/p/w500/backrooms.jpg',
    backdrop: 'https://image.tmdb.org/t/p/original/backrooms_bg.jpg',
    logoUrl: null,
    genres: [{ name: 'ужасы' }, { name: 'фантастика' }],
    countries: [{ name: 'США' }],
    duration: 105,
    ratingTmdb: 7.9,
    voteCount: 450
};

const backroomsDto = MediaAggregatorService.aggregate(backroomsKp, backroomsTmdb);

assert.strictEqual(backroomsDto.kinopoiskId, 5452840, 'Root kinopoiskId must be 5452840');
assert.strictEqual(backroomsDto.tmdbId, 1083381, 'tmdbId must be 1083381');
assert.strictEqual(backroomsDto.identity.status, 'VERIFIED', 'Identity status must be VERIFIED');
assert.strictEqual(backroomsDto.identity.verificationMethod, 'exact_external_tmdb');
assert.strictEqual(backroomsDto._meta.providers.kp.quality, 'DRAFT', 'KP quality must be DRAFT');
assert.strictEqual(backroomsDto._meta.providers.tmdb.quality, 'FULL', 'TMDB quality must be FULL');
assert.strictEqual(backroomsDto._meta.pipelineStatus, 'READY', 'Pipeline status must be READY');

// Check field hydration
assert.strictEqual(backroomsDto.name, 'The Backrooms', 'Name must be hydrated from TMDB because KP is placeholder "Фильм"');
assert.strictEqual(backroomsDto._meta.fieldSources.name, 'tmdb');
assert.strictEqual(backroomsDto.posterUrl, 'https://image.tmdb.org/t/p/w500/backrooms.jpg');
assert.strictEqual(backroomsDto._meta.fieldSources.posterUrl, 'tmdb');
assert.strictEqual(backroomsDto.description, 'A young filmmaker’s terrifying journey into an alternate dimension.');
assert.strictEqual(backroomsDto._meta.fieldSources.description, 'tmdb');
assert.strictEqual(backroomsDto.genres.length, 2);
assert.strictEqual(backroomsDto._meta.fieldSources.genres, 'tmdb');

// Check rating isolation
assert.strictEqual(backroomsDto.rating.kp, null, 'KP rating must be null');
assert.strictEqual(backroomsDto.rating.imdb, null, 'IMDb rating must be null');
assert.strictEqual(backroomsDto.rating.tmdb, 7.9, 'TMDB rating must be 7.9');
assert.strictEqual(backroomsDto.imdbRating, 0, 'Legacy imdbRating alias must not take TMDB rating');
assert.strictEqual(backroomsDto.ratingTmdb, 7.9, 'ratingTmdb must hold TMDB rating');

// Check renderability
assert.strictEqual(MediaAggregatorService.isRenderable(backroomsDto), true, 'Backrooms DTO must be renderable');

console.log('  ✅ The Backrooms acceptance fixture passed');

// ==========================================
// 4. Rating & Votes Isolation Tests
// ==========================================
console.log('\n--- 4. Testing Rating & Votes Isolation Invariant ---');

const mixedMovieKp = {
    kinopoiskId: 4444,
    name: 'Тестовый Фильм',
    year: 2023,
    description: 'Описание фильма на русском языке достаточной длины для проверки.',
    posterUrl: 'https://kp.ru/poster.jpg',
    genres: [{ name: 'боевик' }],
    kpRating: 8.2,
    imdbRating: 7.9,
    votes: { kp: 15000, imdb: 25000 },
    externalId: { tmdb: 9999 }
};

const mixedMovieTmdb = {
    tmdbId: 9999,
    name: 'Test Movie',
    description: 'English description from TMDB.',
    ratingTmdb: 6.5,
    voteCount: 4000
};

const mixedDto = MediaAggregatorService.aggregate(mixedMovieKp, mixedMovieTmdb);

assert.strictEqual(mixedDto.rating.kp, 8.2, 'KP rating must be 8.2');
assert.strictEqual(mixedDto.rating.imdb, 7.9, 'IMDb rating must be 7.9');
assert.strictEqual(mixedDto.rating.tmdb, 6.5, 'TMDB rating must be 6.5');
assert.strictEqual(mixedDto.votes.kp, 15000, 'KP votes must be 15000');
assert.strictEqual(mixedDto.votes.imdb, 25000, 'IMDb votes must be 25000');
assert.strictEqual(mixedDto.votes.tmdb, 4000, 'TMDB votes must be 4000');

// Verify TMDB rating NEVER leaks into IMDb rating
assert.notStrictEqual(mixedDto.rating.imdb, mixedDto.rating.tmdb, 'IMDb rating must never equal TMDB rating');
assert.notStrictEqual(mixedDto.votes.imdb, mixedDto.votes.tmdb, 'IMDb votes must never equal TMDB votes');

console.log('  ✅ Rating and votes isolation invariant passed');

// ==========================================
// 5. Failure Simulations & Degraded State Tests
// ==========================================
console.log('\n--- 5. Testing Failure Simulations & Degraded State ---');

// 5.1 KP Full + TMDB Unavailable
const kpFullTmdbDown = MediaAggregatorService.aggregate(kpFull, null);
assert.strictEqual(kpFullTmdbDown._meta.pipelineStatus, 'READY', 'KP Full + TMDB down must be READY');
assert.strictEqual(kpFullTmdbDown.name, 'Интерстеллар');
assert.strictEqual(MediaAggregatorService.isRenderable(kpFullTmdbDown), true);

// 5.2 KP Draft + TMDB Unavailable (DEGRADED but renderable if title exists)
const kpDraftWithTitle = {
    kinopoiskId: 77777,
    name: 'Инди Проект 2026',
    year: 2026,
    description: '',
    posterUrl: ''
};
const degradedDto = MediaAggregatorService.aggregate(kpDraftWithTitle, null);
assert.strictEqual(degradedDto._meta.pipelineStatus, 'DEGRADED', 'KP Draft + TMDB Unavailable must yield DEGRADED');
assert.strictEqual(degradedDto._meta.providers.kp.quality, 'DRAFT');
assert.strictEqual(degradedDto._meta.providers.tmdb.quality, 'UNAVAILABLE');
assert.strictEqual(MediaAggregatorService.isRenderable(degradedDto), true, 'DEGRADED DTO with valid title must still be renderable');

// 5.3 Identity Survives Metadata Downgrade
const initialVerifiedIdentity = MediaAggregatorService.resolveIdentity(
    { kinopoiskId: 5452840, externalId: { tmdb: 1083381 } },
    { tmdbId: 1083381 }
);
// Later, KP drops poster and description
const kpDegradedPayload = {
    kinopoiskId: 5452840,
    name: 'The Backrooms',
    externalId: { tmdb: 1083381 },
    posterUrl: null,
    description: null
};
const downgradedDto = MediaAggregatorService.aggregate(kpDegradedPayload, null, {
    verifiedAt: initialVerifiedIdentity.verifiedAt
});
assert.strictEqual(downgradedDto.identity.status, 'VERIFIED', 'Verified identity must survive metadata downgrade');

console.log('  ✅ Failure simulations and degraded state tests passed');

// ==========================================
// 6. Service Integration Flow & Caching Tests
// ==========================================
console.log('\n--- 6. Testing MediaAggregatorService async getMovieDetails flow ---');

(async () => {
    let cachedMovies = {};
    const mockCacheService = {
        async getCachedMovie(id) {
            return cachedMovies[id] || null;
        },
        async cacheMovie(dto) {
            cachedMovies[dto.kinopoiskId] = dto;
            return dto;
        }
    };

    const mockKinopoiskService = {
        async getMovieById(id) {
            if (id === 5452840) return backroomsKp;
            if (id === 12345) return kpFull;
            throw new Error(`KP 404 for ${id}`);
        }
    };

    const mockTmdbService = {
        isConfigured() { return true; },
        isValidImdbId(id) { return typeof id === 'string' && id.startsWith('tt'); },
        async getMovieDetails(tmdbId) {
            if (tmdbId === 1083381) return backroomsTmdb;
            return null;
        }
    };

    const mockIdMappingService = {
        async getManualMappings() { return []; }
    };

    const aggregator = new MediaAggregatorService({
        kinopoiskService: mockKinopoiskService,
        tmdbService: mockTmdbService,
        idMappingService: mockIdMappingService,
        movieCacheService: mockCacheService
    });

    // 6.1 Cold Fetch for Backrooms (fetches KP + TMDB, caches result)
    const result1 = await aggregator.getMovieDetails(5452840);
    assert.strictEqual(result1.kinopoiskId, 5452840);
    assert.strictEqual(result1.name, 'The Backrooms');
    assert.strictEqual(result1.identity.status, 'VERIFIED');
    assert.strictEqual(Boolean(cachedMovies[5452840]), true, 'Result must be cached in movieCacheService');

    // 6.2 Warm Fetch (returns cached UnifiedMovieDTO with 0 API calls)
    const result2 = await aggregator.getMovieDetails(5452840);
    assert.strictEqual(result2.kinopoiskId, 5452840);
    assert.strictEqual(result2.name, 'The Backrooms');
    assert.strictEqual(result2._meta.providers.tmdb.quality, 'FULL');

    // 6.3 Invalid KP ID rejection
    let threwInvalid = false;
    try {
        await aggregator.getMovieDetails(-5);
    } catch (e) {
        threwInvalid = true;
        assert(e.message.includes('INVALID_KP_ID'));
    }
    assert.strictEqual(threwInvalid, true, 'Negative KP ID must throw INVALID_KP_ID');

    // 6.4 KP-only cached DTO self-heals through a verified reverse identity
    const noWayHomeKp = {
        id: 1309570,
        kinopoiskId: 1309570,
        name: 'Человек-паук: Нет пути домой',
        type: 'movie',
        externalId: { kpHD: 'example-kphd' },
        posterUrl: 'https://kp.example/no-way-home.jpg'
    };
    cachedMovies[1309570] = MediaAggregatorService.aggregate(noWayHomeKp, null, {
        isLegacyResolved: true,
        status: 'resolved'
    });

    let noWayHomeKpRequests = 0;
    let noWayHomeTmdbRequests = 0;
    let reverseRequests = 0;
    let titleSearchRequests = 0;
    const noWayHomeAggregator = new MediaAggregatorService({
        kinopoiskService: {
            async getMovieById(id) {
                noWayHomeKpRequests++;
                assert.strictEqual(id, 1309570);
                return noWayHomeKp;
            }
        },
        tmdbService: {
            isConfigured() { return true; },
            isValidImdbId() { return false; },
            async getMovieDetails(tmdbId, imdbId, mediaType) {
                noWayHomeTmdbRequests++;
                assert.strictEqual(tmdbId, 634649);
                assert.strictEqual(imdbId, '');
                assert.strictEqual(mediaType, 'movie');
                return {
                    tmdbId: 634649,
                    name: 'Человек-паук: Нет пути домой',
                    type: 'movie',
                    status: 'Released',
                    ratingTmdb: 7.9,
                    voteCount: 21000,
                    backdrop: 'https://image.tmdb.org/t/p/w1280/no-way-home.jpg',
                    posterUrl: 'https://image.tmdb.org/t/p/w500/no-way-home.jpg',
                    logoUrl: 'https://image.tmdb.org/t/p/w500/fy026eCkqSJ8gKNHqbx0DV8MeX5.png',
                    productionCompanies: [
                        { tmdbId: 420, name: 'Marvel Studios', logoUrl: 'https://image.tmdb.org/t/p/w185/marvel.png' }
                    ],
                    externalId: { tmdb: 634649 }
                };
            },
            async searchMovies() {
                titleSearchRequests++;
                throw new Error('Title search must not execute');
            }
        },
        idMappingService: {
            async resolveTmdbIdByKinopoiskId(kpId, mediaType) {
                reverseRequests++;
                assert.strictEqual(kpId, 1309570);
                assert.strictEqual(mediaType, 'movie');
                return {
                    tmdbId: 634649,
                    mediaType: 'movie',
                    kpId: 1309570,
                    status: 'resolved',
                    identityStatus: 'VERIFIED',
                    verificationMethod: 'provider_document_verified',
                    verificationSource: 'curated_provider_exception',
                    resolutionSource: 'curated_provider_exception',
                    resolvedAt: Date.now()
                };
            }
        },
        movieCacheService: mockCacheService
    });

    const healedNoWayHome = await noWayHomeAggregator.getMovieDetails(1309570);
    assert.strictEqual(reverseRequests, 1, 'Degraded cache must perform one reverse identity lookup');
    assert.strictEqual(noWayHomeKpRequests, 1, 'Degraded cache must re-fetch the canonical KP document once');
    assert.strictEqual(noWayHomeTmdbRequests, 1, 'Verified TMDB ID must trigger one normal details request');
    assert.strictEqual(titleSearchRequests, 0, 'Exact reverse identity must not trigger TMDB title search');
    assert.strictEqual(healedNoWayHome.tmdbId, 634649);
    assert.strictEqual(healedNoWayHome.identity.status, 'VERIFIED');
    assert.strictEqual(healedNoWayHome.identity.verificationMethod, 'provider_document_verified');
    assert.strictEqual(healedNoWayHome._meta.providers.tmdb.available, true);
    assert.strictEqual(healedNoWayHome._meta.fieldSources.status, 'tmdb');
    assert.strictEqual(healedNoWayHome._meta.fieldSources.tmdbRating, 'tmdb');
    assert.strictEqual(healedNoWayHome._meta.fieldSources.productionCompanies, 'tmdb');
    assert.strictEqual(healedNoWayHome._meta.fieldSources.backdropUrl, 'tmdb');
    assert.strictEqual(healedNoWayHome.status, 'Released');
    assert.strictEqual(healedNoWayHome.rating.tmdb, 7.9);
    assert.strictEqual(healedNoWayHome.productionCompanies.length, 1);
    assert.strictEqual(healedNoWayHome.logoUrl, 'https://image.tmdb.org/t/p/w500/fy026eCkqSJ8gKNHqbx0DV8MeX5.png');
    assert.strictEqual(healedNoWayHome._meta.fieldSources.logoUrl, 'tmdb');
    assert.strictEqual(cachedMovies[1309570].tmdbId, 634649, 'Healed hybrid DTO must overwrite the degraded cache');

    // 6.4.1 A KP-only cache must not become permanently warm after a negative
    // reverse lookup; the canonical KP document gets one provider-pipeline retry.
    const negativeMappingKp = {
        id: 5456450,
        kinopoiskId: 5456450,
        name: 'Дракула',
        type: 'movie',
        year: 2025,
        posterUrl: 'https://kp.example/dracula.jpg',
        description: 'A complete cached description for the negative-mapping fixture.',
        genres: [{ name: 'ужасы' }]
    };
    cachedMovies[5456450] = MediaAggregatorService.aggregate(negativeMappingKp, null, {
        identityStatus: 'VERIFIED',
        verificationMethod: 'admin_verified',
        verificationSource: 'test_fixture'
    });
    let negativeMappingKpRequests = 0;
    const negativeMappingAggregator = new MediaAggregatorService({
        kinopoiskService: {
            async getMovieById(id) {
                negativeMappingKpRequests++;
                assert.strictEqual(id, 5456450);
                return negativeMappingKp;
            }
        },
        tmdbService: {
            isConfigured() { return true; },
            isValidImdbId() { return false; },
            async getMovieDetails() {
                throw new Error('TMDB details must not run without a trusted mapping');
            }
        },
        idMappingService: {
            async resolveTmdbIdByKinopoiskId() { return null; }
        },
        movieCacheService: mockCacheService
    });
    const negativeMappingCachedBefore = cachedMovies[5456450];
    let negativeMappingReverseRequests = 0;
    negativeMappingAggregator.idMappingService.resolveTmdbIdByKinopoiskId = async () => {
        negativeMappingReverseRequests++;
        return null;
    };
    const negativeMappingResult = await negativeMappingAggregator.getMovieDetails(5456450);
    assert.strictEqual(negativeMappingKpRequests, 1, 'KP-only cache must re-enter the provider pipeline');
    assert.strictEqual(negativeMappingReverseRequests, 1, 'Negative reverse lookup must not be duplicated');
    assert.notStrictEqual(negativeMappingResult, negativeMappingCachedBefore, 'Negative mapping must not return the frozen cache object');
    assert.strictEqual(negativeMappingResult.logoUrl, null, 'No trusted provider logo must remain explicit');

    // 6.5 Normal externalId.tmdb precedence remains unchanged and skips reverse lookup
    let normalReverseRequests = 0;
    let normalTmdbRequests = 0;
    const normalExternalAggregator = new MediaAggregatorService({
        kinopoiskService: {
            async getMovieById() {
                return {
                    id: 5494049,
                    name: 'Brand New Day',
                    type: 'movie',
                    logoUrl: 'https://kp.example/brand-new-day-logo.png',
                    externalId: { tmdb: 969681 }
                };
            }
        },
        tmdbService: {
            isConfigured() { return true; },
            async getMovieDetails(tmdbId) {
                normalTmdbRequests++;
                assert.strictEqual(tmdbId, 969681);
                return {
                    tmdbId,
                    name: 'Brand New Day',
                    type: 'movie',
                    status: 'Post Production',
                    logoUrl: 'https://image.tmdb.org/t/p/w500/brand-new-day-tmdb.png'
                };
            }
        },
        idMappingService: {
            async resolveTmdbIdByKinopoiskId() {
                normalReverseRequests++;
                return null;
            }
        },
        movieCacheService: null
    });
    const normalExternalDto = await normalExternalAggregator.getMovieDetails(5494049);
    assert.strictEqual(normalReverseRequests, 0, 'KP externalId.tmdb must remain first priority');
    assert.strictEqual(normalTmdbRequests, 1);
    assert.strictEqual(normalExternalDto.tmdbId, 969681);
    assert.strictEqual(normalExternalDto.identity.verificationMethod, 'exact_external_tmdb');
    assert.strictEqual(normalExternalDto.logoUrl, 'https://kp.example/brand-new-day-logo.png', 'Existing KP logo must not be replaced by TMDB');
    assert.strictEqual(normalExternalDto._meta.fieldSources.logoUrl, 'kp');

    // 6.6 Pre-logo-schema hybrid cache refreshes once, then remains warm
    const staleLogoKp = {
        id: 24680,
        name: 'Cached Hybrid Without Logo Schema',
        type: 'movie',
        externalId: { tmdb: 13579 }
    };
    cachedMovies[24680] = MediaAggregatorService.aggregate(
        staleLogoKp,
        { tmdbId: 13579, name: 'Cached Hybrid Without Logo Schema', type: 'movie', status: 'Released' }
    );
    assert.strictEqual(cachedMovies[24680]._meta.providers.tmdb.logoChecked, false);

    let logoSchemaKpRequests = 0;
    let logoSchemaTmdbRequests = 0;
    const logoSchemaAggregator = new MediaAggregatorService({
        kinopoiskService: {
            async getMovieById() {
                logoSchemaKpRequests++;
                return staleLogoKp;
            }
        },
        tmdbService: {
            isConfigured() { return true; },
            async getMovieDetails(tmdbId) {
                logoSchemaTmdbRequests++;
                assert.strictEqual(tmdbId, 13579);
                return {
                    tmdbId,
                    name: 'Cached Hybrid Without Logo Schema',
                    type: 'movie',
                    status: 'Released',
                    logoUrl: 'https://image.tmdb.org/t/p/w500/cache-healed-logo.png'
                };
            }
        },
        idMappingService: null,
        movieCacheService: mockCacheService
    });

    const logoHealedDto = await logoSchemaAggregator.getMovieDetails(24680);
    assert.strictEqual(logoSchemaKpRequests, 1);
    assert.strictEqual(logoSchemaTmdbRequests, 1, 'Old hybrid cache must refresh exactly once for logo schema');
    assert.strictEqual(logoHealedDto.logoUrl, 'https://image.tmdb.org/t/p/w500/cache-healed-logo.png');
    assert.strictEqual(logoHealedDto._meta.providers.tmdb.logoChecked, true);

    const logoWarmDto = await logoSchemaAggregator.getMovieDetails(24680);
    assert.strictEqual(logoWarmDto.logoUrl, logoHealedDto.logoUrl);
    assert.strictEqual(logoSchemaKpRequests, 1, 'Healed logo cache must stay warm');
    assert.strictEqual(logoSchemaTmdbRequests, 1, 'Healed logo cache must not repeat TMDB request');

    // 6.6.1 A cached DTO with logoChecked=true is still refreshed after a selector-version change.
    const versionedLogoKp = { id: 24681, name: 'Versioned Logo Movie', type: 'movie', externalId: { tmdb: 13580 } };
    cachedMovies[24681] = MediaAggregatorService.aggregate(versionedLogoKp, {
        tmdbId: 13580,
        name: 'Versioned Logo Movie',
        type: 'movie',
        logoUrl: 'https://image.tmdb.org/t/p/w500/old-logo.png'
    });
    cachedMovies[24681]._meta.providers.tmdb.logoSelectionVersion = 1;
    let versionedLogoTmdbRequests = 0;
    const versionedLogoAggregator = new MediaAggregatorService({
        kinopoiskService: { async getMovieById() { return versionedLogoKp; } },
        tmdbService: {
            isConfigured() { return true; },
            async getMovieDetails(tmdbId) {
                versionedLogoTmdbRequests++;
                assert.strictEqual(tmdbId, 13580);
                return {
                    tmdbId,
                    name: 'Versioned Logo Movie',
                    type: 'movie',
                    logoUrl: 'https://image.tmdb.org/t/p/w500/new-logo.png'
                };
            }
        },
        idMappingService: null,
        movieCacheService: mockCacheService
    });
    const versionedLogoDto = await versionedLogoAggregator.getMovieDetails(24681);
    assert.strictEqual(versionedLogoDto.logoUrl, 'https://image.tmdb.org/t/p/w500/new-logo.png');
    assert.strictEqual(versionedLogoTmdbRequests, 1, 'Old logo selector versions must rehydrate once');
    await versionedLogoAggregator.getMovieDetails(24681);
    assert.strictEqual(versionedLogoTmdbRequests, 1, 'Current logo selector version must remain warm');

    // 6.6.2 A cache created by the previous selector can claim logoChecked=true
    // while still lacking a logo; the schema bump must heal it exactly once.
    const emptyLogoKp = { id: 24682, name: 'Previously Empty Logo', type: 'movie', externalId: { tmdb: 13581 } };
    cachedMovies[24682] = MediaAggregatorService.aggregate(emptyLogoKp, {
        tmdbId: 13581,
        name: 'Previously Empty Logo',
        type: 'movie',
        logoUrl: ''
    });
    cachedMovies[24682]._meta.providers.tmdb.logoSelectionVersion = 2;
    assert.strictEqual(cachedMovies[24682]._meta.providers.tmdb.logoChecked, true);
    let emptyLogoTmdbRequests = 0;
    const emptyLogoAggregator = new MediaAggregatorService({
        kinopoiskService: { async getMovieById() { return emptyLogoKp; } },
        tmdbService: {
            isConfigured() { return true; },
            async getMovieDetails(tmdbId) {
                emptyLogoTmdbRequests++;
                assert.strictEqual(tmdbId, 13581);
                return {
                    tmdbId,
                    name: 'Previously Empty Logo',
                    type: 'movie',
                    logoUrl: 'https://image.tmdb.org/t/p/w500/recovered-logo.png'
                };
            }
        },
        idMappingService: null,
        movieCacheService: mockCacheService
    });
    const emptyLogoDto = await emptyLogoAggregator.getMovieDetails(24682);
    assert.strictEqual(emptyLogoDto.logoUrl, 'https://image.tmdb.org/t/p/w500/recovered-logo.png');
    assert.strictEqual(emptyLogoTmdbRequests, 1, 'Selector schema bump must heal an empty old logo cache');
    await emptyLogoAggregator.getMovieDetails(24682);
    assert.strictEqual(emptyLogoTmdbRequests, 1, 'Healed empty logo cache must remain warm');

    // 6.7 Pre-collection-schema hybrid cache refreshes once, then retains franchise metadata.
    const staleCollectionKp = {
        id: 258328,
        name: 'История игрушек: Большой побег',
        type: 'movie',
        externalId: { tmdb: 10193 }
    };
    cachedMovies[258328] = MediaAggregatorService.aggregate(
        staleCollectionKp,
        { tmdbId: 10193, name: 'Toy Story 3', type: 'movie', status: 'Released' }
    );
    delete cachedMovies[258328]._meta.providers.tmdb.collectionChecked;
    assert.notStrictEqual(cachedMovies[258328]._meta.providers.tmdb.collectionChecked, true);

    let collectionSchemaKpRequests = 0;
    let collectionSchemaTmdbRequests = 0;
    const collectionSchemaAggregator = new MediaAggregatorService({
        kinopoiskService: {
            async getMovieById() {
                collectionSchemaKpRequests++;
                return staleCollectionKp;
            }
        },
        tmdbService: {
            isConfigured() { return true; },
            async getMovieDetails(tmdbId) {
                collectionSchemaTmdbRequests++;
                assert.strictEqual(tmdbId, 10193);
                return {
                    tmdbId,
                    name: 'Toy Story 3',
                    type: 'movie',
                    status: 'Released',
                    logoUrl: 'https://image.tmdb.org/t/p/w500/toy-story-3.png',
                    collection: { tmdbId: 10194, name: 'Toy Story Collection' }
                };
            }
        },
        idMappingService: null,
        movieCacheService: mockCacheService
    });

    const collectionHealedDto = await collectionSchemaAggregator.getMovieDetails(258328);
    assert.strictEqual(collectionSchemaKpRequests, 1);
    assert.strictEqual(collectionSchemaTmdbRequests, 1, 'Old hybrid cache must refresh exactly once for collection schema');
    assert.strictEqual(collectionHealedDto.collection?.tmdbId, 10194);
    assert.strictEqual(collectionHealedDto._meta.providers.tmdb.collectionChecked, true);

    const collectionWarmDto = await collectionSchemaAggregator.getMovieDetails(258328);
    assert.strictEqual(collectionWarmDto.collection?.tmdbId, 10194);
    assert.strictEqual(collectionSchemaKpRequests, 1, 'Healed collection cache must stay warm');
    assert.strictEqual(collectionSchemaTmdbRequests, 1, 'Healed collection cache must not repeat TMDB request');

    // 6.8 A conflicting cached TMDB ID is replaced by the trusted reverse mapping.
    const conflictingToyStoryKp = { ...staleCollectionKp, externalId: { tmdb: 322386 } };
    cachedMovies[258328] = MediaAggregatorService.aggregate(
        conflictingToyStoryKp,
        { tmdbId: 322386, name: 'Wrong cached identity', type: 'movie', status: 'Released' }
    );
    let identityRepairTmdbRequests = 0;
    const identityRepairAggregator = new MediaAggregatorService({
        kinopoiskService: { async getMovieById() { return conflictingToyStoryKp; } },
        tmdbService: {
            isConfigured() { return true; },
            async getMovieDetails(tmdbId) {
                identityRepairTmdbRequests++;
                assert.strictEqual(tmdbId, 10193, 'Trusted reverse mapping must supersede stale KP external ID');
                return {
                    tmdbId,
                    name: 'Toy Story 3',
                    type: 'movie',
                    status: 'Released',
                    collection: { tmdbId: 10194, name: 'Toy Story Collection' }
                };
            }
        },
        idMappingService: {
            async resolveTmdbIdByKinopoiskId() {
                return { tmdbId: 10193, identityStatus: 'VERIFIED', verificationMethod: 'exact_title_year_type' };
            }
        },
        movieCacheService: mockCacheService
    });
    const identityRepairedDto = await identityRepairAggregator.getMovieDetails(258328);
    assert.strictEqual(identityRepairTmdbRequests, 1);
    assert.strictEqual(identityRepairedDto.tmdbId, 10193);
    assert.strictEqual(identityRepairedDto.collection?.tmdbId, 10194);

    // ==========================================
    // 7. Phase 1B Rich Provider Data Preservation Tests
    // ==========================================
    console.log('\n--- 7. Testing Phase 1B Rich Provider Data Preservation ---');

    const richKpMovie = {
        id: 77777,
        name: 'Интерстеллар',
        alternativeName: 'Interstellar',
        year: 2014,
        description: 'Когда засуха, пыльные бури и вымирание растений приводят человечество к продовольственному кризису...',
        shortDescription: 'Фантастический эпос Кристофера Нолана.',
        poster: { url: 'https://kp.ru/interstellar.jpg' },
        backdrop: { url: 'https://kp.ru/interstellar_bg.jpg' },
        logo: { url: 'https://kp.ru/interstellar_logo.png' },
        rating: {
            kp: 8.6,
            imdb: 8.7,
            filmCritics: 8.1,
            russianFilmCritics: 9.2
        },
        votes: {
            kp: 900000,
            imdb: 1800000,
            filmCritics: 350,
            russianFilmCritics: 25
        },
        facts: [
            { value: 'Для съемок фильма <b>Кристофер Нолан</b> вырастил кукурузное поле.', type: 'FACT', spoiler: false },
            { value: 'В конце фильма Купер узнает тайну гравитации.', type: 'FACT', spoiler: true },
            { value: '   ', type: 'FACT', spoiler: false } // Empty fact to be filtered
        ],
        watchability: {
            items: [
                { name: 'Кинопоиск', logo: { url: 'https://kp.ru/ott.png' }, url: 'https://hd.kinopoisk.ru/film/77777' }
            ]
        },
        distributors: { distributor: 'Каро-Премьер' },
        externalId: { imdb: 'tt0816692', tmdb: 157336 }
    };

    const richTmdbMovie = {
        id: 157336,
        title: 'Interstellar',
        original_title: 'Interstellar',
        status: 'Released',
        revenue: 701729206,
        budget: 165000000,
        production_companies: [
            { id: 923, name: 'Legendary Pictures', logo_path: '/5U2529.png', origin_country: 'US' },
            { id: 9996, name: 'Syncopy', logo_path: null, origin_country: 'GB' },
            { id: 923, name: 'Legendary Pictures', logo_path: '/5U2529.png', origin_country: 'US' } // Duplicate
        ],
        spoken_languages: [
            { iso_639_1: 'en', english_name: 'English', name: 'English' }
        ],
        belongs_to_collection: {
            id: 5555,
            name: 'Nolan Space Collection',
            poster_path: '/space_poster.jpg',
            backdrop_path: '/space_bg.jpg'
        },
        images: {
            logos: [
                { file_path: '/interstellar_en.png', iso_639_1: 'en', width: 1600, height: 420, vote_average: 8, vote_count: 4 }
            ]
        },
        videos: {
            results: [
                { id: 'v1', site: 'YouTube', key: 'zSWdZVtXT7E', name: 'Official Trailer 3', type: 'Trailer', official: true, published_at: '2014-10-01T00:00:00Z' },
                { id: 'v2', site: 'YouTube', key: '2LqzF5WauAw', name: 'Teaser', type: 'Teaser', official: false, published_at: '2013-12-14T00:00:00Z' },
                { id: 'v3', site: 'Vimeo', key: '999999', name: 'Vimeo Video', type: 'Clip', official: false },
                { id: 'v4', site: 'YouTube', key: '0vxOhd4qlnA', name: 'Official Teaser', type: 'Teaser', official: true, published_at: '2014-05-16T00:00:00Z' },
                { id: 'v5', site: 'YouTube', key: 'Lm8p5rlrSkY', name: 'Behind The Scenes', type: 'Behind the Scenes', official: false, published_at: '2014-11-01T00:00:00Z' }
            ]
        },
        credits: {
            cast: [
                { id: 10297, name: 'Matthew McConaughey', original_name: 'Matthew McConaughey', character: 'Cooper', profile_path: '/e98.jpg', order: 0 },
                { id: 1813, name: 'Anne Hathaway', original_name: 'Anne Hathaway', character: 'Brand', profile_path: '/tL.jpg', order: 1 }
            ],
            crew: [
                { id: 525, name: 'Christopher Nolan', job: 'Director', department: 'Directing', profile_path: '/cn.jpg' },
                { id: 947, name: 'Hans Zimmer', job: 'Original Music Composer', department: 'Sound', profile_path: '/hz.jpg' }
            ]
        },
        vote_average: 8.4,
        vote_count: 34500
    };

    // Normalize through individual service normalizers first
    const normKp = KinopoiskService.prototype.normalizeMovieData(richKpMovie);
    const normTmdb = TMDBService.prototype.normalizeMovieData(richTmdbMovie, 'tt0816692');

    // Verify KinopoiskService normalization
    assert.strictEqual(normKp.facts.length, 2, 'KP normalizer must preserve facts and filter empty');
    assert.strictEqual(normKp.logoUrl, 'https://kp.ru/interstellar_logo.png', 'KP normalizer must preserve logoUrl');
    assert.strictEqual(normKp.rating.filmCritics, 8.1, 'KP normalizer must preserve filmCritics');
    assert.strictEqual(normKp.rating.russianFilmCritics, 9.2, 'KP normalizer must preserve russianFilmCritics');

    // Verify TMDBService normalization
    assert.strictEqual(normTmdb.status, 'Released', 'TMDB normalizer must preserve status');
    assert.strictEqual(normTmdb.productionCompanies.length, 2, 'TMDB normalizer must deduplicate production companies');
    assert.strictEqual(normTmdb.productionCompanies[0].logoUrl, 'https://image.tmdb.org/t/p/w185/5U2529.png');
    assert.strictEqual(normTmdb.spokenLanguages[0].code, 'en');
    assert.strictEqual(normTmdb.collection.name, 'Nolan Space Collection');
    assert.strictEqual(normTmdb.videos.length, 4, 'TMDB normalizer must filter non-YouTube videos');
    assert.strictEqual(normTmdb.videos[0].key, 'zSWdZVtXT7E', 'Official trailer must be ranked #1');
    assert.strictEqual(normTmdb.videos[1].key, '0vxOhd4qlnA', 'Official teaser must be ranked #2');
    assert.strictEqual(normTmdb.logoUrl, 'https://image.tmdb.org/t/p/w500/interstellar_en.png');

    // 7.0 TMDB localized title-logo selection contract
    const logoSelector = new TMDBService();
    const localizedLogos = [
        { file_path: '/neutral.png', iso_639_1: null, width: 2000, height: 600, vote_average: 10, vote_count: 20 },
        { file_path: '/english.png', iso_639_1: 'en', width: 2200, height: 700, vote_average: 10, vote_count: 20 },
        { file_path: '/russian_best.png', iso_639_1: 'ru', width: 1800, height: 500, vote_average: 6, vote_count: 3 },
        { file_path: '/russian_lower.png', iso_639_1: 'ru', width: 1700, height: 450, vote_average: 4, vote_count: 10 }
    ];
    assert.strictEqual(logoSelector.selectBestLogo(localizedLogos)?.filePath, '/russian_best.png', 'RU logo must outrank EN and neutral logos');
    assert.strictEqual(logoSelector.selectBestLogo(localizedLogos.filter(l => l.iso_639_1 !== 'ru'))?.filePath, '/english.png', 'EN logo must be the second language priority');
    assert.strictEqual(logoSelector.selectBestLogo(localizedLogos.filter(l => l.iso_639_1 === null))?.filePath, '/neutral.png', 'Neutral logo must be used when RU/EN are unavailable');

    const deterministicLogos = [
        { file_path: '/z_path.png', iso_639_1: 'ru', width: 1200, height: 300, vote_average: 7, vote_count: 5 },
        { file_path: '/a_path.png', iso_639_1: 'ru', width: 1200, height: 300, vote_average: 7, vote_count: 5 },
        { file_path: '/tiny_high_vote.png', iso_639_1: 'ru', width: 120, height: 30, vote_average: 10, vote_count: 50 }
    ];
    assert.strictEqual(logoSelector.selectBestLogo(deterministicLogos)?.filePath, '/a_path.png', 'Sufficient resolution and stable file-path tie-break must be deterministic');
    assert.strictEqual(logoSelector.selectBestLogo([{ file_path: 'https://evil.example/logo.png', iso_639_1: 'ru', width: 1000, height: 300 }]), null, 'Arbitrary provider URLs must be rejected');

    let combinedDetailsRequests = 0;
    let combinedDetailsUrl = '';
    logoSelector._fetchWithRotation = async (url) => {
        combinedDetailsRequests++;
        combinedDetailsUrl = url;
        return { ok: true, json: async () => ({ id: 634649, images: { logos: [] } }) };
    };
    await logoSelector._fetchMovieDetails(634649, 'ru-RU');
    const combinedParams = new URL(combinedDetailsUrl).searchParams;
    assert.strictEqual(combinedDetailsRequests, 1, 'Images must use the existing combined details request');
    assert.strictEqual(combinedParams.get('append_to_response'), 'credits,release_dates,videos,images');
    assert.strictEqual(combinedParams.get('include_image_language'), 'ru,en,null');

    combinedDetailsRequests = 0;
    await logoSelector._fetchTvDetails(94997, 'ru-RU');
    const combinedTvParams = new URL(combinedDetailsUrl).searchParams;
    assert.strictEqual(combinedDetailsRequests, 1, 'TV images must also use the existing combined details request');
    assert.strictEqual(combinedTvParams.get('append_to_response'), 'credits,videos,content_ratings,images');
    assert.strictEqual(combinedTvParams.get('include_image_language'), 'ru,en,null');

    // 7.0.1 A non-preferred-language TMDB logo must be recovered lazily.
    const allLanguageLogoService = new TMDBService();
    const allLanguageLogoRequests = [];
    allLanguageLogoService._fetchWithRotation = async (url) => {
        allLanguageLogoRequests.push(url);
        const params = new URL(url).searchParams;
        const raw = {
            id: 8555,
            title: 'Крип',
            original_title: 'Creep',
            release_date: '2004-08-10',
            overview: 'A valid overview prevents an unrelated text-language retry.'
        };
        if (params.has('include_image_language')) {
            return { ok: true, json: async () => ({ ...raw, images: { logos: [] } }) };
        }
        return {
            ok: true,
            json: async () => ({
                ...raw,
                images: {
                    logos: [{
                        file_path: '/creep_es.png',
                        iso_639_1: 'es',
                        width: 778,
                        height: 245,
                        vote_average: 1,
                        vote_count: 1
                    }]
                }
            })
        };
    };
    const allLanguageLogoMovie = await allLanguageLogoService.getMovieDetails(8555);
    assert.strictEqual(allLanguageLogoMovie.logoUrl, 'https://image.tmdb.org/t/p/w500/creep_es.png');
    assert.strictEqual(allLanguageLogoRequests.length, 2, 'Fallback image query must run only after preferred images are empty');
    assert.strictEqual(new URL(allLanguageLogoRequests[1]).searchParams.has('include_image_language'), false);
    assert.strictEqual(allLanguageLogoMovie.logoSelectionVersion, 3);

    const normalizedTvLogo = logoSelector.normalizeTvData({
        id: 94997,
        name: 'House of the Dragon',
        images: { logos: localizedLogos }
    });
    assert.strictEqual(normalizedTvLogo.logoUrl, 'https://image.tmdb.org/t/p/w500/russian_best.png', 'TV normalization must set the logo schema marker and localized fallback');

    const noWayHomeTmdbFixture = {
        id: 634649,
        title: 'Человек-паук: Нет пути домой',
        original_title: 'Spider-Man: No Way Home',
        images: {
            logos: [
                { file_path: '/9xjIoK8eGVvMdiqwUQbEBUeh9Ej.png', iso_639_1: 'en', width: 3662, height: 1132, vote_average: 10, vote_count: 4 },
                { file_path: '/fy026eCkqSJ8gKNHqbx0DV8MeX5.png', iso_639_1: 'ru', width: 3774, height: 691, vote_average: 3.334, vote_count: 1 }
            ]
        }
    };
    const normalizedNoWayHomeLogo = logoSelector.normalizeMovieData(noWayHomeTmdbFixture);
    assert.strictEqual(normalizedNoWayHomeLogo.logoUrl, 'https://image.tmdb.org/t/p/w500/fy026eCkqSJ8gKNHqbx0DV8MeX5.png', 'No Way Home fixture must select the real RU logo');

    const tmdbFallbackDto = MediaAggregatorService.aggregate(
        { id: 1309570, name: 'Человек-паук: Нет пути домой', externalId: { tmdb: 634649 } },
        normalizedNoWayHomeLogo
    );
    assert.strictEqual(tmdbFallbackDto.logoUrl, normalizedNoWayHomeLogo.logoUrl, 'TMDB logo must fill missing KP logo');
    assert.strictEqual(tmdbFallbackDto._meta.fieldSources.logoUrl, 'tmdb');

    const textFallbackDto = MediaAggregatorService.aggregate(
        { id: 123456, name: 'Text Fallback', externalId: { tmdb: 654321 } },
        logoSelector.normalizeMovieData({ id: 654321, title: 'Text Fallback', images: { logos: [] } })
    );
    assert.strictEqual(textFallbackDto.logoUrl, null, 'No provider logo must preserve the text-title fallback');

    // Aggregate into UnifiedMovieDTO
    const richDto = MediaAggregatorService.aggregate(normKp, normTmdb);

    // 7.1 Verify Root Identifiers
    assert.strictEqual(richDto.kinopoiskId, 77777);
    assert.strictEqual(richDto.tmdbId, 157336);
    assert.strictEqual(richDto.imdbId, 'tt0816692');
    assert.strictEqual(richDto.identity.status, 'VERIFIED');

    // 7.2 Verify Facts (HTML stripped, spoiler flag preserved)
    assert.strictEqual(richDto.facts.length, 2);
    assert.strictEqual(richDto.facts[0].value, 'Для съемок фильма Кристофер Нолан вырастил кукурузное поле.');
    assert.strictEqual(richDto.facts[0].spoiler, false);
    assert.strictEqual(richDto.facts[1].spoiler, true);
    assert.strictEqual(richDto._meta.fieldSources.facts, 'kp');

    // 7.3 Verify Isolated Critic Ratings
    assert.strictEqual(richDto.criticRatings.international.rating, 8.1);
    assert.strictEqual(richDto.criticRatings.international.votes, 350);
    assert.strictEqual(richDto.criticRatings.russian.rating, 9.2);
    assert.strictEqual(richDto.criticRatings.russian.votes, 25);
    assert.strictEqual(richDto._meta.fieldSources.criticRatings, 'kp');

    // 7.4 Verify Logo URL
    assert.strictEqual(richDto.logoUrl, 'https://kp.ru/interstellar_logo.png');
    assert.strictEqual(richDto._meta.fieldSources.logoUrl, 'kp');

    // 7.5 Verify Status
    assert.strictEqual(richDto.status, 'Released');
    assert.strictEqual(richDto._meta.fieldSources.status, 'tmdb');

    // 7.6 Verify Production Companies
    assert.strictEqual(richDto.productionCompanies.length, 2);
    assert.strictEqual(richDto.productionCompanies[0].name, 'Legendary Pictures');
    assert.strictEqual(richDto.productionCompanies[1].name, 'Syncopy');
    assert.strictEqual(richDto._meta.fieldSources.productionCompanies, 'tmdb');

    // 7.7 Verify Spoken Languages
    assert.strictEqual(richDto.spokenLanguages.length, 1);
    assert.strictEqual(richDto.spokenLanguages[0].englishName, 'English');
    assert.strictEqual(richDto._meta.fieldSources.spokenLanguages, 'tmdb');

    // 7.8 Verify Collection
    assert.strictEqual(richDto.collection.tmdbId, 5555);
    assert.strictEqual(richDto.collection.name, 'Nolan Space Collection');
    assert.strictEqual(richDto.collection.posterUrl, 'https://image.tmdb.org/t/p/w500/space_poster.jpg');
    assert.strictEqual(richDto._meta.fieldSources.collection, 'tmdb');

    // 7.9 Verify Videos
    assert.strictEqual(richDto.videos.length, 4);
    assert.strictEqual(richDto.videos[0].key, 'zSWdZVtXT7E');
    assert.strictEqual(richDto.videos[0].official, true);
    assert.strictEqual(richDto._meta.fieldSources.videos, 'tmdb');

    // 7.10 Verify TMDB Credits
    assert.strictEqual(richDto.tmdbCredits.cast.length, 2);
    assert.strictEqual(richDto.tmdbCredits.cast[0].name, 'Matthew McConaughey');
    assert.strictEqual(richDto.tmdbCredits.crew.length, 2);
    assert.strictEqual(richDto.tmdbCredits.crew[0].name, 'Christopher Nolan');

    // 7.11 Verify Watchability & Distributors
    assert.strictEqual(richDto.watchability.length, 1);
    assert.strictEqual(richDto.watchability[0].name, 'Кинопоиск');
    assert.strictEqual(richDto.distributors.distributor, 'Каро-Премьер');

    // 7.12 Measure DTO Serialized Size Budget
    const serialized = JSON.stringify(richDto);
    const byteSize = Buffer.byteLength(serialized, 'utf8');
    console.log(`  📊 Fully enriched UnifiedMovieDTO serialized size: ${(byteSize / 1024).toFixed(2)} KB (${byteSize} bytes)`);
    assert(byteSize < 50 * 1024, `DTO size (${byteSize} bytes) must be well within storage budget (< 50 KB)`);

    console.log('  ✅ Phase 1B Rich Provider Data Preservation passed');

    // ==========================================
    // 8. Phase 1E: Structured TV & Seasons Normalization
    // ==========================================
    console.log('\n--- 8. Testing Phase 1E: Structured TV & Seasons Normalization ---');

    const tvSeriesKp = {
        kinopoiskId: 1317565,
        name: 'Дом Дракона',
        type: 'tv-series',
        isSeries: true,
        year: 2022,
        seasonsInfo: [
            { number: 1, episodesCount: 10 },
            { number: 2, episodesCount: 8 }
        ]
    };

    const tvSeriesTmdb = {
        tmdbId: 94997,
        name: 'Дом Дракона',
        originalName: 'House of the Dragon',
        type: 'tv-series',
        isSeries: true,
        status: 'Returning Series',
        inProduction: true,
        totalSeasons: 2,
        totalEpisodes: 18,
        seasons: [
            {
                number: 0,
                name: 'Спецматериалы',
                episodeCount: 5,
                airDate: '2022-08-01',
                overview: 'Специальные материалы о создании сериала',
                posterUrl: 'https://image.tmdb.org/t/p/w500/specials.jpg',
                isSpecial: true,
                source: 'tmdb'
            },
            {
                number: 1,
                name: 'Сезон 1',
                episodeCount: 10,
                airDate: '2022-08-21',
                overview: 'Начало Танца Драконов',
                posterUrl: 'https://image.tmdb.org/t/p/w500/season1.jpg',
                isSpecial: false,
                source: 'tmdb'
            },
            {
                number: 2,
                name: 'Сезон 2',
                episodeCount: 8,
                airDate: '2024-06-16',
                overview: 'Война за престол разгорается',
                posterUrl: 'https://image.tmdb.org/t/p/w500/season2.jpg',
                isSpecial: false,
                source: 'tmdb'
            }
        ],
        nextEpisode: {
            id: 99991,
            seasonNumber: 3,
            episodeNumber: 1,
            name: 'Сезон 3, Эпизод 1',
            airDate: '2026-06-15',
            runtime: 60
        },
        lastEpisode: {
            id: 99990,
            seasonNumber: 2,
            episodeNumber: 8,
            name: 'The Queen Who Ever Was',
            airDate: '2024-08-04',
            runtime: 70
        }
    };

    const tvDto = MediaAggregatorService.aggregate(tvSeriesKp, tvSeriesTmdb);

    assert.strictEqual(tvDto.isSeries, true, 'isSeries must be true for TV show');
    assert.strictEqual(tvDto.type, 'tv-series', 'type must be tv-series');
    assert.strictEqual(tvDto.seasons.length, 3, 'All 3 seasons (including S0 specials) preserved');
    assert.strictEqual(tvDto.seasons[0].isSpecial, true, 'Season 0 marked as special');
    assert.strictEqual(tvDto.seasons[0].name, 'Спецматериалы', 'Special season name preserved');
    assert.strictEqual(tvDto.seasons[1].episodeCount, 10, 'Season 1 episode count correct');
    assert.strictEqual(tvDto.seasons[2].posterUrl, 'https://image.tmdb.org/t/p/w500/season2.jpg', 'Season 2 poster URL preserved');
    assert.strictEqual(tvDto._meta.fieldSources.seasons, 'tmdb', 'Seasons source marked as tmdb');

    // Verify next & last episode
    assert.strictEqual(tvDto.nextEpisode.seasonNumber, 3, 'Next episode season number is 3');
    assert.strictEqual(tvDto.nextEpisode.episodeNumber, 1, 'Next episode number is 1');
    assert.strictEqual(tvDto.nextEpisode.airDate, '2026-06-15');
    assert.strictEqual(tvDto.lastEpisode.episodeNumber, 8);
    assert.strictEqual(tvDto._meta.fieldSources.nextEpisode, 'tmdb');

    // Verify KP-only fallback for indie series
    const kpOnlySeries = {
        kinopoiskId: 999111,
        name: 'Российский мини-сериал',
        type: 'mini-series',
        isSeries: true,
        seasonsInfo: [
            { number: 1, episodesCount: 4 }
        ]
    };
    const kpOnlyDto = MediaAggregatorService.aggregate(kpOnlySeries, null);
    assert.strictEqual(kpOnlyDto.isSeries, true);
    assert.strictEqual(kpOnlyDto.seasons.length, 1);
    assert.strictEqual(kpOnlyDto.seasons[0].name, 'Сезон 1');
    assert.strictEqual(kpOnlyDto.seasons[0].episodeCount, 4);
    assert.strictEqual(kpOnlyDto._meta.fieldSources.seasons, 'kp');

    console.log('  ✅ Phase 1E Structured TV & Seasons Normalization passed');

    // ==========================================
    // 9. Phase 1F: Lazy Season Details & Cache Sizing
    // ==========================================
    console.log('\n--- 9. Testing Phase 1F: Lazy Season Details & Cache Sizing ---');

    const tmdbServiceInstance = new TMDBService();

    // 9.1 Test Season Details Normalization
    const rawSeason1 = {
        season_number: 1,
        name: 'Сезон 1',
        overview: 'Первый сезон сериала Дом Дракона',
        poster_path: '/poster_s1.jpg',
        air_date: '2022-08-21',
        episodes: Array.from({ length: 10 }, (_, i) => ({
            id: 1000 + i,
            season_number: 1,
            episode_number: i + 1,
            name: `Эпизод ${i + 1}`,
            overview: `Краткий синопсис серии ${i + 1} с деталями сюжета.`,
            air_date: '2022-08-21',
            runtime: 60,
            still_path: `/still_${i + 1}.jpg`,
            vote_average: 8.5,
            vote_count: 1200,
            episode_type: 'standard',
            production_code: `HOD-10${i + 1}`
        }))
    };

    const normSeason = tmdbServiceInstance.normalizeSeasonDetails(rawSeason1, 94997, 1);
    assert.strictEqual(normSeason.tmdbId, 94997);
    assert.strictEqual(normSeason.seasonNumber, 1);
    assert.strictEqual(normSeason.episodes.length, 10);
    assert.strictEqual(normSeason.episodes[0].name, 'Эпизод 1');
    assert.strictEqual(normSeason.episodes[0].voteAverage, 8.5);
    assert.strictEqual(normSeason.episodes[0].voteCount, 1200);
    assert.strictEqual(normSeason.episodes[0].source, 'tmdb');
    assert.strictEqual(normSeason.episodes[0].stillUrl, 'https://image.tmdb.org/t/p/w500/still_1.jpg');

    // 9.2 Measure Representative Season Payloads (8, 12, 24, 50 episodes)
    const testEpisodeCounts = [8, 12, 24, 50];
    for (const count of testEpisodeCounts) {
        const mockRaw = {
            season_number: 1,
            name: 'Сезон 1',
            overview: 'Описание сезона',
            poster_path: '/poster.jpg',
            air_date: '2024-01-01',
            episodes: Array.from({ length: count }, (_, i) => ({
                id: 2000 + i,
                season_number: 1,
                episode_number: i + 1,
                name: `Серия ${i + 1}`,
                overview: `Описание серии ${i + 1} с подробностями о событиях и персонажах.`,
                air_date: '2024-01-01',
                runtime: 45,
                still_path: `/still_${i + 1}.jpg`,
                vote_average: 8.0,
                vote_count: 500,
                episode_type: 'standard'
            }))
        };
        const normalized = tmdbServiceInstance.normalizeSeasonDetails(mockRaw, 12345, 1);
        const payloadJson = JSON.stringify(normalized);
        const sizeBytes = Buffer.byteLength(payloadJson, 'utf8');
        console.log(`  📊 Normalized Season (${count} episodes) serialized size: ${(sizeBytes / 1024).toFixed(2)} KB (${sizeBytes} bytes)`);
        assert(sizeBytes < 50 * 1024, `Season payload (${count} episodes) must be compact (< 50 KB)`);
    }

    // 9.3 Test Upper Safety Bound (>500 episodes truncated to 500)
    const pathologicalRaw = {
        season_number: 1,
        name: 'Патологический сезон',
        episodes: Array.from({ length: 600 }, (_, i) => ({
            season_number: 1,
            episode_number: i + 1,
            name: `Эпизод ${i + 1}`
        }))
    };
    const boundedSeason = tmdbServiceInstance.normalizeSeasonDetails(pathologicalRaw, 999, 1);
    assert.strictEqual(boundedSeason.episodes.length, 500, 'Season episodes must be bounded to max 500');

    // 9.4 Test In-flight Request Deduplication
    let fetchCalls = 0;
    tmdbServiceInstance._fetchSeasonDetails = async () => {
        fetchCalls++;
        await new Promise(r => setTimeout(r, 20));
        return rawSeason1;
    };

    const p1 = tmdbServiceInstance.getSeasonDetails(94997, 1, { forceRefresh: true });
    const p2 = tmdbServiceInstance.getSeasonDetails(94997, 1, { forceRefresh: true });
    const [res1, res2] = await Promise.all([p1, p2]);
    assert.strictEqual(fetchCalls, 1, 'Concurrent double-click on same season must trigger only 1 fetch call');
    assert.strictEqual(res1.tmdbId, 94997);
    assert.strictEqual(res2.tmdbId, 94997);

    console.log('  ✅ Phase 1F Lazy Season Details & Cache Sizing passed');

    console.log('\n🎉 ALL MediaAggregatorService V1 Tests Passed Successfully!\n');
})().catch(err => {
    console.error('❌ MediaAggregatorService Test Failed:', err);
    process.exit(1);
});
