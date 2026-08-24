/**
 * QuotaTrackerService - lightweight in-memory diagnostics for provider usage.
 *
 * The extension currently loads services as classic scripts, so the singleton
 * is exposed on globalThis and also exported for CommonJS-based tests.
 */
class QuotaTrackerService {
    constructor() {
        this._reset();
    }

    _reset() {
        this.counters = {};
    }

    track(sourceName, type) {
        if (!this.counters[sourceName]) {
            this.counters[sourceName] = {
                networkRequests: 0,
                cacheHits: 0,
                retries: 0,
                skipped: 0
            };
        }

        if (type === 'network') this.counters[sourceName].networkRequests++;
        if (type === 'cacheHit') this.counters[sourceName].cacheHits++;
        if (type === 'retry') this.counters[sourceName].retries++;
        if (type === 'skipped') this.counters[sourceName].skipped++;
    }

    getSnapshot() {
        return JSON.parse(JSON.stringify(this.counters));
    }

    logSummary(label = 'Quota Summary') {
        console.group(`[QuotaTracker] ${label}`);
        console.table(this.counters);
        console.groupEnd();
    }

    resetForNewPageLoad() {
        this._reset();
    }
}

const quotaTracker = (typeof globalThis !== 'undefined' && globalThis.quotaTracker)
    ? globalThis.quotaTracker
    : new QuotaTrackerService();

if (typeof globalThis !== 'undefined') {
    globalThis.QuotaTrackerService = QuotaTrackerService;
    globalThis.quotaTracker = quotaTracker;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { QuotaTrackerService, quotaTracker };
}
