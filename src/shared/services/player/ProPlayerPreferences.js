(function (global) {
    'use strict';
    const KEY = 'movieExtension.proPlayerEnabledV1';
    async function isEnabled() {
        try {
            const storage = global.chrome?.storage?.local;
            if (!storage) return false;
            const result = await storage.get(KEY);
            return result?.[KEY] === true;
        } catch { return false; }
    }
    async function setEnabled(enabled) {
        const storage = global.chrome?.storage?.local;
        if (!storage) throw new Error('LOCAL_STORAGE_UNAVAILABLE');
        await storage.set({ [KEY]: enabled === true });
        return enabled === true;
    }
    function subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        const events = global.chrome?.storage?.onChanged;
        if (!events) return () => {};
        const handle = (changes, area) => {
            if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, KEY)) listener(changes[KEY].newValue === true);
        };
        events.addListener(handle);
        return () => events.removeListener(handle);
    }
    global.ProPlayerPreferences = Object.freeze({ KEY, isEnabled, setEnabled, subscribe });
})(typeof window === 'undefined' ? globalThis : window);
