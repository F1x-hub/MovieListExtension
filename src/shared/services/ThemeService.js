/**
 * ThemeService
 *
 * The single runtime owner of the extension theme: persistence, DOM classes,
 * following the browser's own light/dark mode, and the toolbar icon. Other code
 * delegates here instead of changing classes or CSS variables.
 *
 * Runs synchronously in <head>, before the first paint.
 */
(function (global) {
    'use strict';

    // Always 'dark' or 'light', also while following the browser: it is what an older
    // version of the extension understands, so going back to one keeps the theme.
    const THEME_KEY = 'movieExtensionTheme';
    // Present while the theme follows the browser.
    const AUTO_KEY = 'movieExtensionThemeAuto';
    // Themes users made in the removed editor. Only their base is read, the data is kept.
    const CUSTOM_THEMES_KEY = 'movieExtensionCustomThemes';
    const DEFAULT_THEME = 'dark';
    const AUTO = 'auto';

    const listeners = new Set();
    const lightQuery = typeof global.matchMedia === 'function'
        ? global.matchMedia('(prefers-color-scheme: light)')
        : null;
    // A frame's media query describes the page around it, not the browser.
    const isFramed = global.top !== undefined && global.top !== global.self;

    const isTheme = value => value === 'dark' || value === 'light';

    function readStorage(key) {
        try {
            return global.localStorage?.getItem(key) ?? null;
        } catch {
            return null;
        }
    }

    function writeStorage(key, value) {
        try {
            if (value === null) global.localStorage?.removeItem(key);
            else global.localStorage?.setItem(key, value);
        } catch (error) {
            console.warn('ThemeService: could not persist the theme', error);
        }
    }

    /** The base of a theme made in the removed editor, or null. */
    function customThemeBase(id) {
        try {
            const parsed = JSON.parse(readStorage(CUSTOM_THEMES_KEY));
            const themes = Array.isArray(parsed) ? parsed : parsed?.themes;
            const theme = themes?.find?.(item => item?.id === id);
            return theme ? (theme.base === 'light' ? 'light' : 'dark') : null;
        } catch {
            return null;
        }
    }

    function storedTheme() {
        const stored = readStorage(THEME_KEY);
        if (isTheme(stored)) return stored;
        const base = stored ? customThemeBase(stored) : null;
        if (base) writeStorage(THEME_KEY, base);
        return base || DEFAULT_THEME;
    }

    /** What the user chose: 'dark', 'light' or 'auto'. */
    function getPreference() {
        return readStorage(AUTO_KEY) ? AUTO : storedTheme();
    }

    function resolve(preference) {
        if (preference !== AUTO) return isTheme(preference) ? preference : DEFAULT_THEME;
        if (isFramed || !lightQuery) return storedTheme();
        return lightQuery.matches ? 'light' : 'dark';
    }

    /** The theme on screen: 'dark' or 'light'. */
    function getCurrentTheme() {
        return resolve(getPreference());
    }

    function notify(state) {
        listeners.forEach(listener => {
            try {
                listener(state);
            } catch (error) {
                console.warn('ThemeService: theme listener failed', error);
            }
        });
    }

    /**
     * Elements have transitions of different lengths, so a theme change would reach them
     * one after another. Everything changes in one frame instead.
     */
    function withoutTransitions(root, change) {
        root.classList.add('theme-switching');
        change();
        if (typeof global.requestAnimationFrame !== 'function') {
            root.classList.remove('theme-switching');
            return;
        }
        global.requestAnimationFrame(() => global.requestAnimationFrame(() => {
            root.classList.remove('theme-switching');
        }));
    }

    function applyClasses(theme) {
        const isLight = theme === 'light';
        const root = typeof document !== 'undefined' ? document.documentElement : null;
        if (!root) return;
        const body = document.body;
        const change = () => [root, body].filter(Boolean).forEach(element => {
            element.classList.toggle('light-theme', isLight);
            element.classList.toggle('dark-theme', !isLight);
        });
        if (body && root.classList.contains(isLight ? 'dark-theme' : 'light-theme')) {
            withoutTransitions(root, change);
        } else {
            change();
        }
    }

    function applyTheme(preference = getPreference(), { persist = true } = {}) {
        const chosen = preference === AUTO || isTheme(preference) ? preference : DEFAULT_THEME;
        const theme = resolve(chosen);

        if (persist) {
            writeStorage(AUTO_KEY, chosen === AUTO ? '1' : null);
        }
        // Frames read it, and the browser may have changed while no page was open.
        if (persist || (chosen === AUTO && !isFramed)) writeStorage(THEME_KEY, theme);

        applyClasses(theme);

        const state = { preference: chosen, theme, isLight: theme === 'light' };
        notify(state);
        return state;
    }

    function applyCurrentTheme() {
        return applyTheme(getPreference(), { persist: false });
    }

    /**
     * The toolbar belongs to the browser, so its icon follows the browser's mode and not
     * the extension's theme. The service worker has no media queries: it repeats the last
     * value seen by a page (background.js).
     */
    function updateToolbarIcon() {
        if (isFramed || !lightQuery || typeof chrome === 'undefined') return;
        try {
            const result = chrome.storage?.local?.set({ toolbarScheme: lightQuery.matches ? 'light' : 'dark' });
            result?.catch?.(() => {});
        } catch (error) {
            console.warn('ThemeService: could not update the toolbar icon', error);
        }
    }

    function bindExternalListeners() {
        global.addEventListener?.('storage', event => {
            if (event.key === THEME_KEY || event.key === AUTO_KEY) applyCurrentTheme();
        });

        lightQuery?.addEventListener?.('change', () => {
            updateToolbarIcon();
            if (!isFramed && getPreference() === AUTO) applyTheme(AUTO);
        });

        // The service runs before <body> exists; pages without Navigation need it there too.
        if (typeof document !== 'undefined' && !document.body) {
            document.addEventListener?.('DOMContentLoaded', () => applyCurrentTheme(), { once: true });
        }
    }

    global.ThemeService = {
        AUTO,
        DEFAULT_THEME,
        getPreference,
        getCurrentTheme,
        applyTheme,
        applyCurrentTheme,
        subscribe(listener) {
            if (typeof listener !== 'function') return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };

    bindExternalListeners();
    applyCurrentTheme();
    updateToolbarIcon();
})(typeof window !== 'undefined' ? window : globalThis);
