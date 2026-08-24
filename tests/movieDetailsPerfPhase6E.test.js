import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/pages/movie-details/movie-details-perf.js', 'utf8');
const values = new Map();
const marks = [];
const measures = [];
let consoleCalls = 0;
let tick = 0;
const window = {
    location: { origin: 'chrome-extension://test' },
    localStorage: {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, String(value))
    },
    performance: {
        now: () => ++tick,
        mark: (name) => marks.push(name),
        measure: (...args) => measures.push(args)
    }
};
const sandbox = { window, URL, console: { info: () => { consoleCalls += 1; } } };
vm.runInNewContext(source, sandbox);
const perf = window.MovieDetailsPerf;

perf.start({ movieId: 123 });
perf.mark('md:i18n-ready');
perf.mark('md:first-content-rendered');
perf.mark('md:first-content-rendered');
assert.deepStrictEqual(marks, ['md:start', 'md:i18n-ready', 'md:first-content-rendered'], 'marks are stable and emitted in lifecycle order');
assert(measures.length >= 2, 'measures are created from stable marks');

assert.equal(perf.classifyScenario(), 'COLD_AUTHENTICATED');
perf.setScenarioHint('movieCacheHit');
assert.equal(perf.classifyScenario(), 'WARM_MOVIECACHE');
perf.setScenarioHint('instantLocalStorage');
assert.equal(perf.classifyScenario(), 'INSTANT_LOCALSTORAGE');
perf.setScenarioHint('guest');
assert.equal(perf.classifyScenario(), 'GUEST');

const first = perf.requestStart('SEASONVAR_DETAIL', { purpose: 'getSeriesInfo', url: 'https://seasonvar.ru/show/1?token=secret' });
perf.requestEnd(first);
const second = perf.requestStart('SEASONVAR_SEASONS', { purpose: 'getSeasons', url: 'https://seasonvar.ru/show/1?token=secret' });
perf.requestEnd(second);
assert.equal(perf.trace.counters.SEASONVAR_DETAIL, 1, 'request counters increment by category');
assert.equal(first.url, 'https://seasonvar.ru/show/1', 'stored requests strip query strings');

perf.mark('md:player-preload-start');
perf.mark('md:player-preload-ready');
const preload = perf.completePlayerPreload();
assert.equal(JSON.stringify(preload.seasonvarDuplicateUrls), JSON.stringify(['https://seasonvar.ru/show/1']), 'duplicate Seasonvar URLs are summarized');
assert.equal(consoleCalls, 0, 'debug logs are gated by localStorage flag');

perf.complete();
for (let index = 0; index < 25; index += 1) {
    perf.start({ movieId: index + 1 });
    perf.mark('md:first-content-rendered');
    perf.complete();
}
const traces = perf.getRecentTraces();
assert.equal(traces.length, 20, 'trace storage is bounded');
assert(!JSON.stringify(traces).includes('secret'), 'persisted traces exclude sensitive query data');
assert.equal(typeof perf.exportRecentTraces(), 'string', 'developer export helper returns JSON');

window.performance.now = () => Date.now();
perf.start({ movieId: 999 });
const lateRequest = perf.trackRequest('KINOGO_SEARCH', { purpose: 'async-search', url: 'https://kinogo.la/search?q=secret' }, () => new Promise(resolve => setTimeout(resolve, 55)));
perf.complete();
await lateRequest;
const lateTrace = perf.getRecentTraces().at(-1);
assert(lateTrace.requests[0].duration >= 50, 'request duration waits for actual async settlement');
assert.equal(lateTrace.requestStatsByCategory.KINOGO_SEARCH.networkRequestCount, 1, 'physical network requests are counted separately');
assert.equal(lateTrace.requests[0].url, 'https://kinogo.la/search', 'late trace updates remain sanitized');

perf.start({ movieId: 1000 });
perf.recordCall('SEASONVAR_SEARCH', { cacheHit: true });
perf.recordCall('SEASONVAR_SEARCH', { inFlightDedupHit: true });
perf.complete();
const cacheTrace = perf.getRecentTraces().at(-1);
assert.deepStrictEqual(JSON.parse(JSON.stringify(cacheTrace.requestStatsByCategory.SEASONVAR_SEARCH)), {
    callCount: 2,
    networkRequestCount: 0,
    cacheHitCount: 1,
    inFlightDedupCount: 1
}, 'cache and in-flight dedup calls do not inflate physical network counts');
console.log('✅ MovieDetails Phase 6E performance instrumentation tests passed');
