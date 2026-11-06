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

assert.equal(values.has(perf.REPORT_STORAGE_KEY), false, 'no report is written or stored without the debug flag');

// The console report, with the debug flag on.
{
    const stored = new Map([['movie_details_perf_debug', '1']]);
    const printed = { info: [], table: [] };
    const listeners = new Map();
    const timers = [];
    let clock = 0;
    const entries = {
        navigation: [{ type: 'navigate', responseEnd: 10, domInteractive: 120, domContentLoadedEventEnd: 160, loadEventEnd: 0 }],
        resource: [
            { name: 'https://example.test/late?token=secret', initiatorType: 'fetch', startTime: 900, responseEnd: 950 },
            { name: 'https://example.test/poster.jpg', initiatorType: 'img', startTime: 300, responseEnd: 400 },
            { name: 'https://example.test/details?token=secret', initiatorType: 'fetch', startTime: 300, responseEnd: 500, responseStatus: 200 },
            { name: 'http://auth.test/lookup?key=secret', initiatorType: 'xmlhttprequest', startTime: 200, responseEnd: 280 }
        ]
    };
    const reportWindow = {
        location: { origin: 'chrome-extension://test', search: '?resolveTmdbId=7&source=home-tmdb-only' },
        localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, String(value)) },
        performance: {
            now: () => clock,
            mark: () => {},
            measure: () => {},
            getEntriesByType: type => entries[type] || [],
            getEntriesByName: name => (name === 'first-contentful-paint' ? [{ startTime: 150 }] : [])
        },
        PerformanceObserver: class {
            constructor(callback) { this.callback = callback; }
            observe(options) {
                assert.equal(options.type, 'largest-contentful-paint');
                this.callback({ getEntries: () => [{ startTime: 400 }, { startTime: 700 }] });
            }
        },
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: type => listeners.delete(type),
        setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
        clearTimeout: () => {}
    };
    const reportConsole = { info: (...args) => printed.info.push(args), table: rows => printed.table.push(rows) };
    vm.runInNewContext(source, { window: reportWindow, URL, URLSearchParams, console: reportConsole });
    const reporting = reportWindow.MovieDetailsPerf;

    clock = 50;
    reporting.start({ movieId: null });
    reportWindow.location.search = '?movieId=42&source=home-tmdb-only';
    clock = 600;
    reporting.mark('md:first-content-rendered');
    clock = 650;
    reporting.complete();
    assert.equal(reporting.getReports().length, 0, 'the report waits, so the largest paint can be counted');
    assert.equal(timers[0].delay, 3000);

    listeners.get('pagehide')();
    const reports = reporting.getReports();
    assert.equal(reports.length, 1, 'leaving the page before the delay still reports');
    timers[0].callback();
    assert.equal(reporting.getReports().length, 1, 'one page load gives one report');

    const report = reports[0];
    assert.equal(report.route, 'resolve-tmdb', 'the route is read before the page rewrites its address');
    assert.equal(report.movieId, 42, 'a route that starts without an ID reports the one it resolved');
    assert.equal(report.firstContentMs, 600);
    assert.equal(report.timeline['first-contentful-paint'], 150);
    assert.equal(report.timeline['largest-paint'], 700);
    assert.equal(report.timeline['load-event'], undefined, 'a stage that has not happened is left out');
    const times = Object.values(report.timeline);
    assert.deepStrictEqual([...times], [...times].sort((a, b) => a - b), 'the timeline reads in order');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(report.network)), [
        { url: 'http://auth.test/lookup', startMs: 200, endMs: 280, durationMs: 80, status: null },
        { url: 'https://example.test/details', startMs: 300, endMs: 500, durationMs: 200, status: 200 }
    ], 'only data requests before the first content, in order, without query strings');
    assert(!reporting.exportReports().includes('secret'), 'exported reports exclude query strings');
    assert.equal(printed.table.length, 2, 'the console gets the stages and the requests');
    assert(String(printed.info.at(-1)[0]).includes('first content at 600 ms'), 'the console line names the result');
}
console.log('✅ MovieDetails Phase 6E performance instrumentation tests passed');
