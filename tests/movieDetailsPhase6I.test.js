import assert from 'node:assert';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/pages/movie-details/movie-details.js', import.meta.url), 'utf8');
const perfSource = fs.readFileSync(new URL('../src/pages/movie-details/movie-details-perf.js', import.meta.url), 'utf8');
const aggregator = fs.readFileSync(new URL('../src/shared/services/MediaAggregatorService.js', import.meta.url), 'utf8');

assert(source.includes('const authPromise = firebaseManager.waitForAuthReady();'), 'auth readiness must start as a promise');
assert(source.includes('const cachePromise = movieId && canSpeculate'), 'cache lookup must start alongside auth');
for (const mark of [
    'md:start',
    'md:speculative-cache-start',
    'md:speculative-cache-ready',
    'md:speculative-rendered',
    'md:auth-ready',
    'md:first-content-rendered'
]) {
    assert(source.includes(mark) || perfSource.includes(mark), `${mark} must be present`);
}
assert(source.includes('this.speculativeCacheResolved = true'), 'cache result must be reusable after auth');
assert(source.includes('prefetchedCacheResolved: this.speculativeCacheResolved'), 'authenticated continuation must receive cache result');
assert(aggregator.includes('options.prefetchedCacheResolved'), 'aggregation must reuse prefetched cache state');
assert(source.includes("this.authDecision === 'guest'"), 'guest transition must invalidate speculative continuation');
assert(source.includes('this.authVerified = true'), 'auth verification must be explicit');
assert(source.includes('this.setProtectedControlsEnabled(true)'), 'protected controls must unlock only after auth');
assert(source.includes('this.setProtectedControlsEnabled(this.authVerified)'), 'speculative controls must start disabled');
assert(source.includes('if (this.authVerified) this.startPostRenderEnrichment'), 'provider enrichment must be auth-gated');
assert(source.includes('if (skipRender) this.startPostRenderEnrichment'), 'cached authenticated continuation must resume enrichment');
assert(source.includes('postRenderEnrichmentMovieId'), 'auth-race continuation must not duplicate post-render enrichment');
assert(source.includes('this.preloadAllPlayers(movieId)'), 'player preload remains available after auth');
assert(source.includes("this.perf?.setScenarioHint(movie === localMovie ? 'instantLocalStorage' : 'movieCacheHit')"), 'trace scenario must identify actual cache source');
assert(source.includes('shouldUpgradeSpeculativeMovie'), 'richer/newer cache DTO may upgrade local render');

const speculativeStart = source.indexOf('async loadSpeculativeCachedMovie');
const speculativeEnd = source.indexOf('shouldUpgradeSpeculativeMovie', speculativeStart);
const speculativeBody = source.slice(speculativeStart, speculativeEnd);
assert(!speculativeBody.includes('getMovieDetails('), 'speculative path must not invoke provider aggregation');
assert.equal((speculativeBody.match(/getCachedMovie\(/g) || []).length, 1, 'speculative path performs one public MovieCache read');

console.log('✅ MovieDetails Phase 6I speculative cache/auth boundary contract passed');
