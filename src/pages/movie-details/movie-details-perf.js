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
            return this.trace;
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
            const requests = this.trace.requests.filter(request => /^(SEASONVAR|KINOGO|EXFS|RUTUBE)_/.test(request.category));
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
            if (this.isDebugEnabled()) console.info('[MovieDetailsPerf][Startup]', summary);
            return summary;
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
            try {
                const parsed = JSON.parse(global.localStorage?.getItem(TRACE_STORAGE_KEY) || '[]');
                return Array.isArray(parsed) ? parsed.slice(-TRACE_STORAGE_MAX) : [];
            } catch { return []; }
        }

        exportRecentTraces() {
            return JSON.stringify(this.getRecentTraces(), null, 2);
        }
    }

    const instance = new MovieDetailsPerf();
    instance.TRACE_STORAGE_KEY = TRACE_STORAGE_KEY;
    instance.TRACE_STORAGE_MAX = TRACE_STORAGE_MAX;
    instance.DEBUG_STORAGE_KEY = DEBUG_STORAGE_KEY;
    global.MovieDetailsPerf = instance;
})(window);
