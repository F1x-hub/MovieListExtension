(function (global) {
    'use strict';
    let catalog = null;
    let language = 'ru';
    let pending = null;
    let removeStorage = null;
    let removePageLocale = null;
    let generation = 0;
    const listeners = new Set();
    const notify = () => { for (const listener of listeners) { try { listener(language); } catch { /* Isolate UI listeners. */ } } };
    function setLanguage(value) { language = value === 'ru' || value === 'en' ? value : 'en'; notify(); }
    function t(key, params = {}, fallback = key) {
        const value = catalog?.[language]?.player?.[key] ?? catalog?.en?.player?.[key] ?? fallback;
        if (typeof value !== 'string') return fallback;
        return value.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
    }
    function init() {
        if (pending) return pending;
        const token = generation;
        pending = (async () => {
            try {
                catalog = global.i18n?.locales || (await import(global.chrome.runtime.getURL('src/shared/i18n/locales.js'))).locales;
                let saved;
                try { saved = (await global.chrome?.storage?.sync?.get(['language']))?.language; } catch { /* Browser language fallback. */ }
                if (token !== generation) return false;
                let browser = '';
                try { browser = global.chrome?.i18n?.getUILanguage?.() || global.navigator?.language || ''; } catch { /* Default English. */ }
                setLanguage(saved === 'ru' || saved === 'en' ? saved : String(browser).toLowerCase().split('-')[0]);
                const events = global.chrome?.storage?.onChanged;
                if (events) {
                    const handler = (changes, area) => { if (area === 'sync' && Object.hasOwn(changes, 'language')) setLanguage(changes.language.newValue); };
                    events.addListener(handler); removeStorage = () => events.removeListener(handler);
                }
                removePageLocale = global.i18n?.onLocaleChange?.(setLanguage) || null;
                return true;
            } catch { return false; }
        })();
        return pending;
    }
    function subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); }
    function localize(root) {
        if (!catalog || !root?.querySelectorAll) return;
        const values = new Map();
        for (const locale of ['ru', 'en']) for (const [key, value] of Object.entries(catalog[locale]?.player || {})) {
            if (typeof value === 'string' && !value.includes('{')) values.set(value, key);
        }
        // Only extension-owned labels, never provider options, track names or page text.
        for (const element of root.querySelectorAll('button,[role="button"],[role="slider"],.player-shortcut-help,.player-settings-menu__label,.player-subtitle-appearance__body,.player-subtitle-appearance__preview')) {
            for (const attribute of ['title', 'aria-label']) {
                const key = values.get(element.getAttribute(attribute));
                if (key) element.setAttribute(attribute, t(key));
            }
            if (element.matches('.player-shortcut-help,.player-settings-menu__label')) {
                const key = values.get(element.textContent);
                if (key) element.textContent = t(key);
            }
            if (element.matches('button')) for (const child of element.querySelectorAll('span')) {
                if (child.classList.contains('player-settings-menu__value')) continue;
                const key = values.get(child.textContent);
                if (key) child.textContent = t(key);
            }
        }
        for (const element of root.querySelectorAll('.player-subtitle-appearance__control label,.player-subtitle-appearance__caption,.player-subtitle-appearance__note,.player-subtitle-appearance__reset,.player-subtitle-appearance__control option')) {
            const key = values.get(element.textContent);
            if (key) element.textContent = t(key);
        }
    }
    function destroy() { generation++; removeStorage?.(); removePageLocale?.(); removeStorage = removePageLocale = null; listeners.clear(); pending = null; }
    global.addEventListener?.('pagehide', event => { if (!event.persisted) destroy(); });
    global.PlayerLocale = Object.freeze({ t, init, subscribe, destroy, localize, setLocale: setLanguage,
        get ready() { return catalog !== null; }, get locale() { return language; } });
})(typeof window === 'undefined' ? globalThis : window);
