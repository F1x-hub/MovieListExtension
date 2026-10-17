(function(global) {
    'use strict';
    const TORRENT = 'mediaplayer:torrent';
    const key = movieId => `watchPrefs_${String(movieId)}`;
    function rank(values, { anime = false, film = false } = {}) {
        const unique = [...new Set(values.filter(value => typeof value === 'string' && value && value !== TORRENT))];
        return unique.map((value, index) => ({ value, index,
            rank: anime && value === 'parser:animego' ? -1 : film && value === 'parser:rutube' ? 1 : 0
        })).sort((a, b) => a.rank - b.rank || a.index - b.index).map(entry => entry.value);
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
    global.WatchSourcePolicy = Object.freeze({ rank, select, read, save, createRun });
})(typeof window !== 'undefined' ? window : globalThis);
