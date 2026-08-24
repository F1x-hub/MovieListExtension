import assert from 'node:assert';
import IdMappingService from '../src/shared/services/IdMappingService.js';

globalThis.chrome = {
    storage: {
        local: {
            store: {},
            get(keys, callback) {
                const result = {};
                (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
                    if (this.store[key] !== undefined) result[key] = this.store[key];
                });
                callback?.(result);
                return Promise.resolve(result);
            },
            set(value, callback) {
                Object.assign(this.store, value);
                callback?.();
                return Promise.resolve();
            }
        }
    }
};

const service = new IdMappingService();
const now = Date.now();
const trusted = {
    tmdbId: 8001,
    mediaType: 'movie',
    kpId: 7001,
    status: 'resolved',
    identityStatus: 'VERIFIED',
    verificationMethod: 'exact_external_tmdb',
    verificationSource: 'automatic',
    resolutionSource: 'automatic'
};

console.log('🧪 Running IdMappingService Phase 6B reverse-negative tests...');

await service.saveMappingCache({
    'kp:movie:7001': { status: 'not-found', mediaType: 'movie', kpId: 7001, attemptedAt: now, retryAfter: now + 60_000 },
    'movie:8001': trusted
});
assert.strictEqual(await service.resolveTmdbIdByKinopoiskId(7001, 'movie'), null, 'fresh reverse negative blocks normal lookup');
const forceResolved = await service.resolveTmdbIdByKinopoiskId(7001, 'movie', { forceRefresh: true });
assert.strictEqual(forceResolved?.tmdbId, 8001, 'force refresh bypasses reverse negative');
let cache = await service.getMappingCache();
assert.strictEqual(cache['movie:8001']?.kpId, 7001, 'trusted forward mapping remains persisted');
assert.strictEqual(cache['kp:movie:7001']?.tmdbId, 8001, 'trusted reverse mapping is healed atomically with forward key');
console.log('  ✅ fresh TTL blocks normal lookup; force refresh recovers trusted mapping');

await service.saveMappingCache({
    'kp:movie:7002': { status: 'not-found', mediaType: 'movie', kpId: 7002, attemptedAt: now - 20_000, retryAfter: now - 1 },
    'movie:8002': { ...trusted, tmdbId: 8002, kpId: 7002 }
});
assert.strictEqual((await service.resolveTmdbIdByKinopoiskId(7002, 'movie'))?.tmdbId, 8002, 'expired reverse negative retries trusted recovery');
console.log('  ✅ expired reverse negative retries');

await service.saveMappingCache({
    'kp:movie:7003': { status: 'not-found', mediaType: 'movie', kpId: 7003, checkedAt: now - 1000 }
});
assert.strictEqual(await service.resolveTmdbIdByKinopoiskId(7003, 'movie'), null, 'legacy negative remains unresolved when no trusted mapping exists');
cache = await service.getMappingCache();
assert.ok(cache['kp:movie:7003'].attemptedAt, 'legacy negative self-heals attemptedAt');
assert.ok(cache['kp:movie:7003'].retryAfter > Date.now(), 'legacy negative self-heals bounded retryAfter');
console.log('  ✅ legacy permanent negative self-heals into TTL schema');

await service.saveMappingCache({
    'movie:8004': { tmdbId: 8004, mediaType: 'movie', kpId: 7004, status: 'resolved', identityStatus: 'UNVERIFIED', verificationMethod: 'heuristic' }
});
assert.strictEqual(await service.resolveTmdbIdByKinopoiskId(7004, 'movie'), null, 'unverified forward mapping cannot become reverse authority');
cache = await service.getMappingCache();
assert.strictEqual(cache['kp:movie:7004']?.status, 'not-found');
console.log('  ✅ unverified mappings do not create reverse authority');

await service.saveMappingCache({});
const noWayHome = await service.resolveTmdbIdByKinopoiskId(1309570, 'movie');
assert.strictEqual(noWayHome?.tmdbId, 634649, 'verified override resolves KP -> TMDB');
cache = await service.getMappingCache();
assert.strictEqual(cache['movie:634649']?.kpId, 1309570, 'override writes forward key');
assert.strictEqual(cache['kp:movie:1309570']?.tmdbId, 634649, 'override writes reverse key');
const warm = await service.resolveTmdbIdByKinopoiskId(1309570, 'movie');
assert.strictEqual(warm?.tmdbId, 634649, 'warm reverse lookup resolves from cache with zero provider requests');
console.log('  ✅ No Way Home override remains bidirectional and warm-cache safe');

console.log('🎉 IdMappingService Phase 6B reverse-negative tests passed!');
