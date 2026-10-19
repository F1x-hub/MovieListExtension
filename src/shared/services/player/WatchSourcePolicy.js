(function(global) {
    'use strict';
    const TORRENT = 'mediaplayer:torrent';
    const key = movieId => `watchPrefs_${String(movieId)}`;
    const NEUTRAL_HEALTH = 0.5;
    const MIN_ATTEMPTS = 3;

    function providerOf(value) {
        try {
            const safe = global.PlayerDiagnostics?.safeSourceId?.(value);
            if (safe && safe !== 'unknown') return safe;
        } catch { /* fall back to the value itself */ }
        return typeof value === 'string' && value.startsWith('parser:') ? value.slice(7) : String(value || '').split(':')[0];
    }

    /**
     * Turns the local 7-day PlayerMetrics report into a 0..1 score per provider:
     * how often a source actually started for this user, minus a small penalty for
     * a slow first frame. Providers with too few attempts stay neutral.
     */
    function healthFromReport(report) {
        const totals = new Map();
        for (const entry of report?.counters || []) {
            if (entry.type !== 'resolveOk' && entry.type !== 'resolveFail') continue;
            const total = totals.get(entry.providerId) || { ok: 0, fail: 0 };
            total[entry.type === 'resolveOk' ? 'ok' : 'fail'] += Number(entry.count) || 0;
            totals.set(entry.providerId, total);
        }
        const p50 = new Map((report?.ttff || []).filter(entry => entry.quality === 'exact' && Number.isFinite(entry.p50Ms))
            .map(entry => [entry.providerId, entry.p50Ms]));
        const health = {};
        for (const [providerId, { ok, fail }] of totals) {
            const attempts = ok + fail;
            if (attempts < MIN_ATTEMPTS) continue;
            const slowPenalty = Math.min(0.3, (p50.get(providerId) || 0) / 30000);
            health[providerId] = Math.max(0, Math.min(1, ok / attempts - slowPenalty));
        }
        return health;
    }

    function rank(values, { anime = false, film = false, health = null } = {}) {
        const unique = [...new Set(values.filter(value => typeof value === 'string' && value && value !== TORRENT))];
        const score = value => {
            const known = health ? health[providerOf(value)] : undefined;
            return Number.isFinite(known) ? known : NEUTRAL_HEALTH;
        };
        return unique.map((value, index) => ({ value, index, health: score(value),
            rank: anime && value === 'parser:animego' ? -1 : film && value === 'parser:rutube' ? 1 : 0
        })).sort((a, b) => a.rank - b.rank || b.health - a.health || a.index - b.index).map(entry => entry.value);
    }
    function select(values, { room, explicit, preference, last, ...options } = {}) {
        const ordered = rank(values, options);
        return [room, explicit, preference, last].find(value => ordered.includes(value)) || ordered[0] || null;
    }
    async function read(movieId) {
        if (!movieId) return null;
        if (global.WatchPreferences) return (await global.WatchPreferences.get(movieId)).innerId || null;
        try {
            const data = await global.chrome?.storage?.local?.get([key(movieId)]);
            return typeof data?.[key(movieId)]?.innerId === 'string' ? data[key(movieId)].innerId : null;
        } catch { return null; }
    }
    async function save(movieId, value) {
        if (!movieId || typeof value !== 'string' || !value || value === TORRENT) return;
        if (global.WatchPreferences) { await global.WatchPreferences.patch(movieId, { innerId: value }); return; }
        try { await global.chrome?.storage?.local?.set({ [key(movieId)]: { innerId: value } }); } catch { /* local preference is optional */ }
    }
    function createRun(movieId, manual = false) {
        return { movieId: String(movieId), manual, attempted: new Set(), failed: new Set(), switching: false };
    }
    global.WatchSourcePolicy = Object.freeze({ rank, select, read, save, createRun, healthFromReport, providerOf });
})(typeof window !== 'undefined' ? window : globalThis);
