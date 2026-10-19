(function (global) {
    'use strict';
    const PROVIDERS = new Set(['animego', 'seasonvar', 'exfs', 'kinogo', 'rutube', 'officialyt', 'kodik', 'vidsrc']);
    const queues = new Map();

    function storageKey(movieId) {
        if (typeof movieId !== 'string' && !Number.isSafeInteger(movieId)) return null;
        const id = String(movieId);
        return /^[1-9]\d{0,15}$/.test(id) ? `watchPrefs_${id}` : null;
    }

    function providerFields(value) {
        const clean = {};
        if (!value || typeof value !== 'object') return clean;
        if ((typeof value.translationId === 'string' || Number.isSafeInteger(value.translationId))
            && /^[a-zA-Z0-9_-]{1,80}$/.test(String(value.translationId))) clean.translationId = String(value.translationId);
        if (Number.isInteger(value.qualityHeight) && value.qualityHeight >= 0 && value.qualityHeight <= 8640) clean.qualityHeight = value.qualityHeight;
        return clean;
    }

    function normalize(value) {
        const clean = {};
        if (!value || typeof value !== 'object') return clean;
        // Legacy source IDs may be URLs. They are retained only in their existing field.
        if (typeof value.innerId === 'string' && value.innerId.length > 0 && value.innerId.length <= 4096) clean.innerId = value.innerId;
        if (value.providers && typeof value.providers === 'object') {
            for (const id of PROVIDERS) {
                if (!Object.hasOwn(value.providers, id)) continue;
                const fields = providerFields(value.providers[id]);
                if (Object.keys(fields).length) (clean.providers ||= {})[id] = fields;
            }
        }
        return clean;
    }

    function create({ storage = global.chrome?.storage?.local, locks = global.navigator?.locks } = {}) {
        const memory = new Map();
        const dirty = new Set();
        const copy = value => JSON.parse(JSON.stringify(value));
        function remember(key, value) {
            memory.delete(key);
            memory.set(key, value);
            while (memory.size > 128) {
                const oldest = memory.keys().next().value;
                memory.delete(oldest);
                dirty.delete(oldest);
            }
        }
        async function read(key) {
            if (dirty.has(key)) return copy(memory.get(key) || {});
            try {
                const data = await storage?.get([key]);
                if (data && Object.hasOwn(data, key)) {
                    const clean = normalize(data[key]);
                    remember(key, clean);
                    return clean;
                }
            } catch { /* Optional storage degrades to the local in-memory copy. */ }
            return copy(memory.get(key) || {});
        }
        function serial(key, task) {
            const previous = queues.get(key) || Promise.resolve();
            const next = previous.catch(() => {}).then(() => locks?.request
                ? locks.request(`movie-watch-preferences:${key}`, task) : task());
            queues.set(key, next);
            next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
            return next;
        }
        async function get(movieId) {
            const key = storageKey(movieId);
            return key ? serial(key, () => read(key)) : {};
        }
        async function patch(movieId, delta) {
            const key = storageKey(movieId);
            if (!key || !delta || typeof delta !== 'object') return {};
            return serial(key, async () => {
                const current = await read(key);
                if (Object.hasOwn(delta, 'innerId')) {
                    if (delta.innerId === null) delete current.innerId;
                    else if (typeof delta.innerId === 'string' && delta.innerId.length > 0 && delta.innerId.length <= 4096) current.innerId = delta.innerId;
                }
                if (delta.providers && typeof delta.providers === 'object') {
                    for (const id of PROVIDERS) {
                        if (!Object.hasOwn(delta.providers, id)) continue;
                        const value = delta.providers[id];
                        if (value === null) { if (current.providers) delete current.providers[id]; continue; }
                        const merged = { ...(current.providers?.[id] || {}), ...providerFields(value) };
                        if (value && typeof value === 'object') {
                            if (value.translationId === null) delete merged.translationId;
                            if (value.qualityHeight === null) delete merged.qualityHeight;
                        }
                        if (Object.keys(merged).length) (current.providers ||= {})[id] = merged;
                        else if (current.providers) delete current.providers[id];
                    }
                }
                if (current.providers && Object.keys(current.providers).length === 0) delete current.providers;
                remember(key, current);
                try {
                    await storage?.set({ [key]: current });
                    dirty.delete(key);
                } catch { dirty.add(key); }
                return copy(current);
            });
        }
        return Object.freeze({ get, patch });
    }
    const api = Object.freeze({ ...create(), create });
    global.WatchPreferences = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
