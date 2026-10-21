(function (global) {
    'use strict';
    const KEY = 'movieExtension.playerMetricsV1';
    const DAY = 86400000;
    const LIMIT = 1000000;
    const MAX_TIME_MS = 300000;
    const TTFF_BUCKETS_MS = Object.freeze([250, 500, 1000, 2000, 4000, 8000, 15000, 30000, 60000, 120000, MAX_TIME_MS]);
    const SOURCES = new Set(['animego', 'seasonvar', 'exfs', 'kinogo', 'rutube', 'officialyt', 'hdrezka', 'kodik', 'vidsrc', 'torrent', 'unknown']);
    const TYPES = new Set(['resolveOk', 'resolveFail', 'fallback', 'decodeFailed']);
    const REASONS = new Set(['policy', 'decode', 'aborted', 'timeout', 'network', 'http', 'unknown']);
    let queue = Promise.resolve();
    const own = (value, key) => {
        try { return Object.getOwnPropertyDescriptor(value || {}, key)?.value; } catch { return undefined; }
    };
    function source(value) {
        let result;
        try { result = global.PlayerDiagnostics?.safeSourceId(value); } catch { /* Closed fallback below. */ }
        if (SOURCES.has(result)) return result;
        const id = typeof value === 'string' && value.startsWith('parser:') ? value.slice(7) : value;
        return SOURCES.has(id) ? id : 'unknown';
    }
    function bounded(value, max = LIMIT) { return Number.isFinite(value) && value > 0 ? Math.min(max, Math.floor(value)) : 0; }
    const histogram = (value, count = LIMIT) => TTFF_BUCKETS_MS.map((_, index) => {
        const size = Math.min(count, bounded(own(value, String(index)))); count -= size; return size;
    });
    const emptyQoe = () => ({ sessions: 0, stallCount: 0, rebufferMsTotal: 0, rebufferMsMax: 0 });
    function cleanQoe(value) {
        return { sessions: bounded(own(value, 'sessions')), stallCount: bounded(own(value, 'stallCount')),
            rebufferMsTotal: bounded(own(value, 'rebufferMsTotal'), LIMIT * MAX_TIME_MS),
            rebufferMsMax: bounded(own(value, 'rebufferMsMax'), MAX_TIME_MS) };
    }
    function percentile(buckets, fraction) {
        const count = buckets.reduce((total, value) => total + value, 0);
        if (!count) return null;
        const target = Math.ceil(count * fraction);
        let cumulative = 0;
        return TTFF_BUCKETS_MS.find((_, index) => (cumulative += buckets[index]) >= target) ?? null;
    }
    const day = () => Math.floor(Date.now() / DAY);
    function clean(raw) {
        const result = { schema: 1, days: {} };
        const days = own(raw, 'days');
        for (let current = day() - 6; current <= day(); current++) {
            const entries = own(days, String(current));
            if (!entries || typeof entries !== 'object') continue;
            const safe = {};
            // Iterate a fixed vocabulary, never persisted attacker-controlled keys.
            for (const provider of SOURCES) {
                for (const type of TYPES) for (const reason of REASONS) {
                    const key = `${provider}:${type}:${reason}`;
                    const count = bounded(own(entries, key));
                    if (count) safe[key] = count;
                }
                for (const quality of ['exact', 'approximate', 'unknown']) {
                    const key = `${provider}:ttff:${quality}`;
                    const value = own(entries, key);
                    const count = bounded(own(value, 'count'));
                    if (count) safe[key] = { count, totalMs: quality === 'unknown' ? 0 : bounded(own(value, 'totalMs'), LIMIT * MAX_TIME_MS), maxMs: quality === 'unknown' ? 0 : bounded(own(value, 'maxMs'), MAX_TIME_MS),
                        histogram: histogram(quality === 'unknown' ? null : own(value, 'histogram'), count) };
                }
                const qoe = cleanQoe(own(entries, `${provider}:qoe`));
                if (Object.values(qoe).some(Boolean)) safe[`${provider}:qoe`] = qoe;
            }
            result.days[current] = safe;
        }
        return result;
    }
    function serial(task) {
        const run = () => global.navigator?.locks?.request
            ? global.navigator.locks.request(KEY, task) : task();
        const next = queue.then(run, run);
        queue = next.catch(() => {});
        return next;
    }
    async function read() {
        try { return clean((await global.chrome?.storage?.local?.get(KEY))?.[KEY]); } catch { return clean(null); }
    }
    function record(type, options = {}) {
        // Sanitize before enqueue, retaining no caller object or arbitrary text.
        if (!TYPES.has(type) && !['ttff', 'session', 'stall'].includes(type)) return Promise.resolve(false);
        const provider = source(own(options, 'providerId'));
        const reasonValue = own(options, 'reason');
        const reason = REASONS.has(reasonValue) ? reasonValue : 'unknown';
        const duration = own(options, 'durationMs');
        const quality = typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 ? 'unknown' : own(options, 'approximate') === true ? 'approximate' : 'exact';
        const elapsed = bounded(duration, MAX_TIME_MS);
        if (type === 'stall' && quality === 'unknown') return Promise.resolve(false);
        return serial(async () => {
            const storage = global.chrome?.storage?.local;
            if (!storage) return false;
            const data = await read();
            const entries = data.days[day()] ||= {};
            if (type === 'ttff') {
                const key = `${provider}:ttff:${quality}`;
                const value = entries[key] ||= { count: 0, totalMs: 0, maxMs: 0, histogram: histogram(null) };
                if (value.count < LIMIT) {
                    value.count++;
                    value.totalMs += quality === 'unknown' ? 0 : elapsed;
                    value.maxMs = Math.max(value.maxMs, quality === 'unknown' ? 0 : elapsed);
                    if (quality !== 'unknown') value.histogram[TTFF_BUCKETS_MS.findIndex(limit => elapsed <= limit)]++;
                }
            } else if (type === 'session' || type === 'stall') {
                const value = entries[`${provider}:qoe`] ||= emptyQoe();
                if (type === 'session') value.sessions = Math.min(LIMIT, value.sessions + 1);
                else if (value.stallCount < LIMIT) {
                    value.stallCount++;
                    value.rebufferMsTotal = Math.min(LIMIT * MAX_TIME_MS, value.rebufferMsTotal + elapsed);
                    value.rebufferMsMax = Math.max(value.rebufferMsMax, elapsed);
                }
            } else {
                const key = `${provider}:${type}:${reason}`;
                entries[key] = Math.min(LIMIT, (entries[key] || 0) + 1);
            }
            try { await storage.set({ [KEY]: data }); return true; } catch { return false; }
        });
    }
    function report() {
        return serial(async () => {
            const data = await read();
            // Persist pruning on inspection as well as on the next recorded attempt.
            try { await global.chrome?.storage?.local?.set({ [KEY]: data }); } catch { /* Read-only report still remains sanitized. */ }
            const counters = new Map();
            const timings = new Map();
            const qoe = new Map();
            for (const entries of Object.values(data.days)) for (const [key, value] of Object.entries(entries)) {
                if (key.includes(':ttff:')) {
                    const total = timings.get(key) || { count: 0, totalMs: 0, maxMs: 0, histogram: histogram(null) };
                    total.count += value.count; total.totalMs += value.totalMs; total.maxMs = Math.max(total.maxMs, value.maxMs);
                    total.histogram = total.histogram.map((count, index) => count + value.histogram[index]);
                    timings.set(key, total);
                } else if (key.endsWith(':qoe')) {
                    const total = qoe.get(key) || emptyQoe();
                    total.sessions += value.sessions; total.stallCount += value.stallCount;
                    total.rebufferMsTotal += value.rebufferMsTotal;
                    total.rebufferMsMax = Math.max(total.rebufferMsMax, value.rebufferMsMax);
                    qoe.set(key, total);
                } else counters.set(key, (counters.get(key) || 0) + value);
            }
            return { schema: 1, retentionDays: 7,
                counters: [...counters].map(([key, count]) => { const [providerId, type, reason] = key.split(':'); return { providerId, type, reason, count }; }),
                ttff: [...timings].map(([key, value]) => { const [providerId, , quality] = key.split(':'); return { providerId, quality, count: value.count, meanMs: quality === 'unknown' ? null : Math.round(value.totalMs / value.count), maxMs: quality === 'unknown' ? null : value.maxMs,
                    histogram: value.histogram, measuredCount: value.histogram.reduce((total, count) => total + count, 0),
                    p50Ms: percentile(value.histogram, .5), p95Ms: percentile(value.histogram, .95) }; }),
                qoe: [...qoe].map(([key, value]) => ({ providerId: key.split(':')[0], ...value })) };
        });
    }
    function reset() {
        return serial(async () => {
            try {
                const storage = global.chrome?.storage?.local;
                if (!storage) return false;
                await storage.set({ [KEY]: { schema: 1, days: {} } });
                return true;
            } catch { return false; }
        });
    }
    function attach(video, options = {}) {
        // Only the caller's native primary video is observed. Provider iframe
        // telemetry stays unknown; preview decoders must never become sessions.
        const protocol = video?.ownerDocument?.location?.protocol;
        if (video?.dataset?.ghost === 'true' || (video?.tagName && video.tagName !== 'VIDEO')
            || (protocol && protocol !== 'chrome-extension:')) return () => {};
        const providerId = source(own(options, 'providerId'));
        const now = () => global.performance.now();
        let start = Number.isFinite(own(options, 'startAt')) ? own(options, 'startAt') : now();
        const isCurrent = typeof own(options, 'isCurrent') === 'function' ? own(options, 'isCurrent') : () => true;
        const isAdPlaying = typeof own(options, 'isAdPlaying') === 'function' ? own(options, 'isAdPlaying') : () => video?.dataset?.playerAd === 'true';
        let active = true;
        let handle;
        let firstFrame = false;
        let played = video?.paused === false && !video.seeking && !video.ended && video.readyState >= 3;
        let stallAt = null;
        const listeners = [];
        const clearFrame = () => {
            if (handle !== undefined) video?.cancelVideoFrameCallback?.(handle);
            handle = undefined;
            video?.removeEventListener?.('loadeddata', approximate);
        };
        const dispose = () => {
            active = false; stallAt = null;
            clearFrame();
            for (const [event, listener] of listeners) video?.removeEventListener?.(event, listener);
        };
        const current = () => {
            if (!active) return false;
            try { if (isCurrent()) return true; } catch { /* Stale owner. */ }
            dispose(); return false;
        };
        const content = () => {
            try { return video?.dataset?.ghost !== 'true' && !isAdPlaying(); } catch { return false; }
        };
        const finish = approximate => {
            if (!current() || firstFrame || !content()) return;
            firstFrame = true; clearFrame();
            void record('ttff', { providerId, durationMs: Math.max(0, now() - start), approximate });
            void record('session', { providerId });
        };
        const approximate = () => finish(true);
        const armFrame = () => {
            if (typeof video?.requestVideoFrameCallback === 'function') handle = video.requestVideoFrameCallback(() => {
                finish(false);
                if (active && !firstFrame) armFrame();
            });
            else if (video?.addEventListener) {
                video.addEventListener('loadeddata', approximate);
                if (video.readyState >= 2) approximate();
            }
            else { dispose(); void record('ttff', { providerId }); }
        };
        const discard = () => { stallAt = null; played = false; };
        const endStall = () => {
            if (!current()) return;
            if (stallAt !== null && content() && !video.paused && !video.seeking && !video.ended) {
                void record('stall', { providerId, durationMs: Math.max(0, now() - stallAt) });
            }
            stallAt = null;
        };
        const listen = (event, callback) => {
            const listener = () => { if (current()) callback(); };
            video?.addEventListener?.(event, listener); listeners.push([event, listener]);
        };
        listen('waiting', () => {
            if (!content() || video.paused || video.seeking || video.ended) { discard(); return; }
            if (firstFrame && played && video.readyState < 3 && stallAt === null) stallAt = now();
        });
        listen('playing', () => { endStall(); played = content(); });
        listen('canplay', endStall);
        for (const event of ['pause', 'seeking', 'adstart']) listen(event, discard);
        for (const event of ['ended', 'error']) listen(event, dispose);
        listen('emptied', () => { discard(); clearFrame(); firstFrame = false; });
        listen('loadstart', () => {
            discard(); clearFrame(); firstFrame = false; start = now(); armFrame();
        });
        armFrame();
        return dispose;
    }
    global.PlayerMetrics = Object.freeze({ KEY, TTFF_BUCKETS_MS, record, report, reset, attach });
})(typeof window === 'undefined' ? globalThis : window);
