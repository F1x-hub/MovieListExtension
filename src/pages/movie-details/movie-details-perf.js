/**
 * MovieDetailsPerf — bounded, opt-in runtime diagnostics for MovieDetails.
 * It records timing metadata only; provider payloads, auth data, and query strings
 * are deliberately excluded from persisted traces.
 */
(function attachMovieDetailsPerf(global) {
    'use strict';

    const TRACE_STORAGE_KEY = 'movie_details_perf_traces_v1';
    const TRACE_STORAGE_MAX = 20;
    const DEBUG_STORAGE_KEY = 'movie_details_perf_debug';
    const REPORT_STORAGE_KEY = 'movie_details_perf_reports_v1';
    const REPORT_STORAGE_MAX = 30;
    const REPORT_NETWORK_MAX = 40;
    // Long enough for the poster to count as the largest paint; leaving sooner still reports.
    const REPORT_DELAY_MS = 3000;

    const safeNow = () => global.performance?.now?.() ?? 0;
    const safeMark = (name) => {
        try { global.performance?.mark?.(name); } catch { /* Performance API is diagnostic only. */ }
    };
    const safeMeasure = (name, startMark, endMark = name) => {
        try { global.performance?.measure?.(name, startMark, endMark); } catch { /* Mark may not exist in test/legacy contexts. */ }
    };
    const round = (value) => Math.max(0, Math.round(Number(value) || 0));

    const sanitizeUrl = (value) => {
        if (!value || typeof value !== 'string') return null;
        try {
            const url = new URL(value, global.location?.origin || 'https://movie-details.invalid');
            return `${url.origin}${url.pathname}`;
        } catch {
            return String(value).split('?')[0].slice(0, 200);
        }
    };

    // Read at the start: the resolve route later rewrites the address to the canonical one.
    const routeOf = (search) => {
        try {
            const params = new URLSearchParams(search || '');
            if (params.has('resolveTmdbId')) return 'resolve-tmdb';
            return params.get('source') === 'home-tmdb-only' ? 'home-tmdb-only' : 'direct';
        } catch {
            return 'unknown';
        }
    };

    const movieIdInAddress = (search) => {
        try {
            return Number(new URLSearchParams(search || '').get('movieId')) || null;
        } catch {
            return null;
        }
    };

    const readStoredList = (key, max) => {
        try {
            const parsed = JSON.parse(global.localStorage?.getItem(key) || '[]');
            return Array.isArray(parsed) ? parsed.slice(-max) : [];
        } catch { return []; }
    };

    class MovieDetailsPerf {
        constructor() {
            this.trace = null;
            this.sequence = 0;
        }

        isDebugEnabled() {
            try { return global.localStorage?.getItem(DEBUG_STORAGE_KEY) === '1'; } catch { return false; }
        }

        start({ movieId = null, instantLocalStorage = false } = {}) {
            this.sequence += 1;
            this.trace = {
                version: 1,
                traceId: `md-${this.sequence}`,
                movieId: Number(movieId) || null,
                startedAt: safeNow(),
                scenarioHints: { instantLocalStorage: Boolean(instantLocalStorage), movieCacheHit: false, guest: false },
                marks: {},
                counters: {},
                requestStats: {},
                requests: [],
                playerPreload: null
            };
            this.mark('md:start');
            if (this.isDebugEnabled()) this.prepareReport(this.trace);
            return this.trace;
        }

        prepareReport(trace) {
            trace.route = routeOf(global.location?.search);
            try {
                new global.PerformanceObserver((list) => {
                    const entry = list.getEntries().at(-1);
                    if (entry) trace.largestPaintAt = entry.startTime;
                }).observe({ type: 'largest-contentful-paint', buffered: true });
            } catch { /* Diagnostic only: the report then has no largest paint. */ }
        }

        mark(name) {
            if (!this.trace || this.trace.marks[name] != null) return;
            const at = safeNow();
            this.trace.marks[name] = at;
            safeMark(name);
            safeMeasure(`${name}:from-start`, 'md:start', name);
        }

        setScenarioHint(name, value = true) {
            if (this.trace && Object.prototype.hasOwnProperty.call(this.trace.scenarioHints, name)) {
                this.trace.scenarioHints[name] = Boolean(value);
            }
        }

        classifyScenario() {
            const hints = this.trace?.scenarioHints || {};
            if (hints.guest) return 'GUEST';
            if (hints.instantLocalStorage) return 'INSTANT_LOCALSTORAGE';
            if (hints.movieCacheHit) return 'WARM_MOVIECACHE';
            return 'COLD_AUTHENTICATED';
        }

        requestStart(category, details = {}) {
            if (!this.trace) return null;
            const request = {
                requestId: `mdr-${++this.sequence}`,
                category: String(category || 'OTHER'),
                purpose: String(details.purpose || 'request'),
                url: sanitizeUrl(details.url),
                startedAt: safeNow(),
                completedAt: null,
                duration: null,
                cacheHit: Boolean(details.cacheHit),
                inFlightDedupHit: Boolean(details.inFlightDedupHit)
            };
            this.trace.requests.push(request);
            this.trace.counters[request.category] = (this.trace.counters[request.category] || 0) + 1;
            const stats = this.getRequestStats(request.category);
            stats.networkRequestCount += 1;
            return request;
        }

        getRequestStats(category) {
            if (!this.trace) return { callCount: 0, networkRequestCount: 0, cacheHitCount: 0, inFlightDedupCount: 0 };
            const key = String(category || 'OTHER');
            return this.trace.requestStats[key] || (this.trace.requestStats[key] = {
                callCount: 0,
                networkRequestCount: 0,
                cacheHitCount: 0,
                inFlightDedupCount: 0
            });
        }

        recordCall(category, details = {}) {
            if (!this.trace) return;
            const stats = this.getRequestStats(category);
            stats.callCount += 1;
            if (details.cacheHit) stats.cacheHitCount += 1;
            if (details.inFlightDedupHit) stats.inFlightDedupCount += 1;
            if (this.trace.completed) this.sync();
        }

        requestEnd(request, outcome = 'success') {
            if (!request || request.completedAt != null) return;
            request.completedAt = safeNow();
            request.duration = round(request.completedAt - request.startedAt);
            request.outcome = outcome;
            if (this.trace?.completed) this.sync();
        }

        async trackRequest(category, details, work) {
            const request = this.requestStart(category, details);
            try {
                return await work();
            } catch (error) {
                this.requestEnd(request, 'error');
                throw error;
            } finally {
                this.requestEnd(request);
            }
        }

        completePlayerPreload() {
            if (!this.trace) return null;
            const requests = this.trace.requests.filter(request => /^(SEASONVAR|KINOGO|EXFS|RUTUBE|ANIMEGO)_/.test(request.category));
            const byProvider = requests.reduce((result, request) => {
                const provider = request.category.split('_')[0];
                result[provider] = (result[provider] || 0) + 1;
                return result;
            }, {});
            const seen = new Set();
            const seasonvarDuplicateUrls = [];
            requests.filter(request => request.category.startsWith('SEASONVAR_') && request.url).forEach(request => {
                const key = request.url;
                if (seen.has(key) && !seasonvarDuplicateUrls.includes(key)) seasonvarDuplicateUrls.push(key);
                seen.add(key);
            });
            this.trace.playerPreload = {
                totalRequests: requests.length,
                byProvider,
                seasonvarDuplicateUrls,
                dispatchDuration: this.duration('md:player-preload-start', 'md:player-preload-dispatched'),
                settledDuration: this.duration('md:player-preload-start', 'md:player-preload-settled')
            };
            if (this.trace.completed) this.sync();
            if (this.isDebugEnabled()) console.info('[MovieDetailsPerf][PlayerPreload]', this.trace.playerPreload);
            return this.trace.playerPreload;
        }

        duration(startMark, endMark) {
            const start = this.trace?.marks?.[startMark];
            const end = this.trace?.marks?.[endMark];
            return start == null || end == null ? null : round(end - start);
        }

        complete() {
            if (!this.trace || this.trace.completed) return this.trace?.summary || null;
            this.mark('md:startup-complete');
            const summary = this.buildSummary();
            this.trace.completed = true;
            this.trace.summary = summary;
            this.sync();
            if (this.isDebugEnabled()) {
                console.info('[MovieDetailsPerf][Startup]', summary);
                this.scheduleReport();
            }
            return summary;
        }

        scheduleReport() {
            const trace = this.trace;
            let timer = null;
            const write = () => {
                global.clearTimeout?.(timer);
                global.removeEventListener?.('pagehide', write);
                if (this.trace === trace) this.writeReport();
            };
            global.addEventListener?.('pagehide', write);
            timer = global.setTimeout?.(write, REPORT_DELAY_MS);
        }

        /** Times are milliseconds after the navigation started, about 2 ms after the click. */
        buildReport() {
            const { marks, movieId, route, largestPaintAt } = this.trace;
            const perf = global.performance;
            const navigation = perf?.getEntriesByType?.('navigation')?.[0] || {};
            const paint = (name) => perf?.getEntriesByName?.(name)?.[0]?.startTime;
            const firstContent = marks['md:first-content-rendered'];
            const timeline = Object.entries({
                'html-read': navigation.responseEnd,
                'first-paint': paint('first-paint'),
                'first-contentful-paint': paint('first-contentful-paint'),
                'dom-interactive': navigation.domInteractive,
                'dom-content-loaded': navigation.domContentLoadedEventEnd,
                'load-event': navigation.loadEventEnd,
                'largest-paint': largestPaintAt,
                ...marks
            }).filter(([, at]) => at > 0).sort((a, b) => a[1] - b[1]);
            // Only requests the first content could have waited for; a request still open
            // when the report is written has no entry yet, and shows as a gap in the list.
            const network = (perf?.getEntriesByType?.('resource') || [])
                .filter(entry => /^https?:/.test(entry.name)
                    && ['fetch', 'xmlhttprequest'].includes(entry.initiatorType)
                    && (firstContent == null || entry.startTime <= firstContent))
                .sort((a, b) => a.startTime - b.startTime)
                .slice(0, REPORT_NETWORK_MAX)
                .map(entry => ({
                    url: sanitizeUrl(entry.name),
                    startMs: round(entry.startTime),
                    endMs: round(entry.responseEnd),
                    durationMs: round(entry.responseEnd - entry.startTime),
                    status: entry.responseStatus ?? null
                }));
            return {
                version: 1,
                // The resolve route starts without an ID and learns it on the way.
                movieId: movieId || movieIdInAddress(global.location?.search),
                route: route || 'unknown',
                scenario: this.classifyScenario(),
                navigationType: navigation.type || null,
                paintedFromCache: marks['md:speculative-rendered'] != null,
                firstContentMs: firstContent == null ? null : round(firstContent),
                timeline: Object.fromEntries(timeline.map(([name, at]) => [name, round(at)])),
                network
            };
        }

        writeReport() {
            if (!this.trace || this.trace.reported) return null;
            this.trace.reported = true;
            const report = this.buildReport();
            console.info(`[MovieDetailsPerf][Report] film ${report.movieId}: first content at ${report.firstContentMs} ms, ${report.scenario}, route ${report.route}. All reports: copy(MovieDetailsPerf.exportReports())`);
            console.table?.(Object.entries(report.timeline).map(([stage, ms]) => ({ stage, ms })));
            if (report.network.length) console.table?.(report.network);
            try {
                global.localStorage?.setItem(REPORT_STORAGE_KEY, JSON.stringify([...this.getReports(), report].slice(-REPORT_STORAGE_MAX)));
            } catch { /* Diagnostics must never affect MovieDetails behavior. */ }
            return report;
        }

        getReports() {
            return readStoredList(REPORT_STORAGE_KEY, REPORT_STORAGE_MAX);
        }

        exportReports() {
            return JSON.stringify(this.getReports(), null, 2);
        }

        buildSummary() {
            return {
                scenario: this.classifyScenario(),
                movieId: this.trace.movieId,
                firstContentMs: this.duration('md:start', 'md:first-content-rendered'),
                authMs: this.duration('md:start', 'md:auth-ready'),
                profileMs: this.duration('md:auth-ready', 'md:profile-ready'),
                collectionsMs: this.duration('md:profile-ready', 'md:collections-ready'),
                aggregationMs: this.duration('md:aggregation-start', 'md:aggregation-ready'),
                framesMs: this.duration('md:aggregation-ready', 'md:frames-ready'),
                userStateMs: this.duration('md:render-start', 'md:bookmark-state-ready'),
                preloadRequests: this.trace.playerPreload?.totalRequests || 0,
                playerPreloadDispatchMs: this.trace.playerPreload?.dispatchDuration || null,
                playerPreloadSettledMs: this.trace.playerPreload?.settledDuration || null,
                totalRequestsByCategory: { ...this.trace.counters },
                requestStatsByCategory: { ...this.trace.requestStats }
            };
        }

        snapshot() {
            const summary = this.buildSummary();
            this.trace.summary = summary;
            return {
                traceId: this.trace.traceId,
                ...summary,
                requests: this.trace.requests,
                marks: this.trace.marks,
                playerPreload: this.trace.playerPreload
            };
        }

        sync() {
            if (!this.trace?.completed) return;
            this.persist(this.snapshot());
        }

        persist(trace) {
            try {
                const existing = this.getRecentTraces();
                const withoutCurrent = existing.filter(entry => entry?.traceId !== trace.traceId);
                global.localStorage?.setItem(TRACE_STORAGE_KEY, JSON.stringify([...withoutCurrent, trace].slice(-TRACE_STORAGE_MAX)));
            } catch { /* Diagnostics must never affect MovieDetails behavior. */ }
        }

        getRecentTraces() {
            return readStoredList(TRACE_STORAGE_KEY, TRACE_STORAGE_MAX);
        }

        exportRecentTraces() {
            return JSON.stringify(this.getRecentTraces(), null, 2);
        }
    }

    const instance = new MovieDetailsPerf();
    instance.TRACE_STORAGE_KEY = TRACE_STORAGE_KEY;
    instance.TRACE_STORAGE_MAX = TRACE_STORAGE_MAX;
    instance.DEBUG_STORAGE_KEY = DEBUG_STORAGE_KEY;
    instance.REPORT_STORAGE_KEY = REPORT_STORAGE_KEY;
    global.MovieDetailsPerf = instance;
})(window);
