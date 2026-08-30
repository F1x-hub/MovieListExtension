/**
 * ThemeService
 *
 * The single runtime owner for extension theme persistence, migration, and
 * DOM application. Legacy callers may keep using their old method names, but
 * they must delegate here instead of changing classes or CSS variables.
 */
(function (global) {
    'use strict';

    const THEME_KEY = 'movieExtensionTheme';
    const CUSTOM_THEMES_KEY = 'movieExtensionCustomThemes';
    const CUSTOM_THEME_SCHEMA_VERSION = 2;
    const DEFAULT_THEME = 'dark';

    const MANAGED_CUSTOM_VARIABLES = Object.freeze([
        '--theme-bg-primary',
        '--theme-bg-secondary',
        '--theme-bg-tertiary',
        '--theme-bg-card',
        '--theme-text-primary',
        '--theme-text-secondary',
        '--theme-text-muted',
        '--theme-border',
        '--theme-input-bg',
        '--theme-input-text',
        '--theme-hover-bg',
        '--theme-active-bg',
        '--accent-color'
    ]);

    const listeners = new Set();
    let externalListenersBound = false;

    function getStorage() {
        try {
            return global.localStorage || null;
        } catch {
            return null;
        }
    }

    function getRoot() {
        return typeof document !== 'undefined' ? document.documentElement : null;
    }

    function getBody() {
        return typeof document !== 'undefined' ? document.body : null;
    }

    function safeParse(value, fallback) {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }

    function normalizeVariableMap(variables) {
        if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
            return {};
        }

        return Object.entries(variables).reduce((normalized, [key, value]) => {
            if (/^--[a-z0-9-]+$/i.test(key) && (typeof value === 'string' || typeof value === 'number')) {
                normalized[key] = String(value);
            }
            return normalized;
        }, {});
    }

    function normalizeCustomTheme(theme, index = 0) {
        if (!theme || typeof theme !== 'object') return null;

        const id = typeof theme.id === 'string' && theme.id.trim()
            ? theme.id.trim()
            : `custom_migrated_${index}`;

        return {
            version: CUSTOM_THEME_SCHEMA_VERSION,
            id,
            name: typeof theme.name === 'string' && theme.name.trim()
                ? theme.name.trim()
                : 'Custom Theme',
            base: theme.base === 'light' ? 'light' : 'dark',
            variables: normalizeVariableMap(theme.variables)
        };
    }

    function persistCustomThemes(themes) {
        const storage = getStorage();
        if (storage) {
            try {
                storage.setItem(CUSTOM_THEMES_KEY, JSON.stringify({
                    version: CUSTOM_THEME_SCHEMA_VERSION,
                    themes
                }));
            } catch (error) {
                console.warn('ThemeService: could not persist custom themes', error);
            }
        }
    }

    function readCustomThemes() {
        const storage = getStorage();
        if (!storage) return [];

        let raw;
        try {
            raw = storage.getItem(CUSTOM_THEMES_KEY);
        } catch {
            return [];
        }

        if (!raw) return [];

        const parsed = safeParse(raw, null);
        const sourceThemes = Array.isArray(parsed)
            ? parsed
            : (parsed && Array.isArray(parsed.themes) ? parsed.themes : []);
        const themes = sourceThemes
            .map((theme, index) => normalizeCustomTheme(theme, index))
            .filter(Boolean);

        const isCurrentSchema = parsed
            && !Array.isArray(parsed)
            && parsed.version === CUSTOM_THEME_SCHEMA_VERSION;

        if (!isCurrentSchema) {
            persistCustomThemes(themes);
        }

        return themes;
    }

    function getCustomThemes() {
        return readCustomThemes().map(theme => ({
            ...theme,
            variables: { ...theme.variables }
        }));
    }

    function saveCustomThemes(customThemes) {
        const sourceThemes = Array.isArray(customThemes) ? customThemes : [];
        const themes = sourceThemes
            .map((theme, index) => normalizeCustomTheme(theme, index))
            .filter(Boolean);

        persistCustomThemes(themes);

        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const result = chrome.storage.local.set({ customThemes: themes });
            result?.catch?.(() => {});
        }

        return getCustomThemes();
    }

    function getCurrentTheme() {
        const storage = getStorage();
        if (!storage) return DEFAULT_THEME;

        try {
            const savedTheme = storage.getItem(THEME_KEY);
            return typeof savedTheme === 'string' && savedTheme.trim()
                ? savedTheme.trim()
                : DEFAULT_THEME;
        } catch {
            return DEFAULT_THEME;
        }
    }

    function resolveTheme(theme) {
        const requestedTheme = typeof theme === 'string' && theme.trim()
            ? theme.trim()
            : DEFAULT_THEME;

        if (requestedTheme === 'dark' || requestedTheme === 'light') {
            return { id: requestedTheme, customTheme: null };
        }

        const customTheme = getCustomThemes().find(item => item.id === requestedTheme);
        return customTheme
            ? { id: customTheme.id, customTheme }
            : { id: DEFAULT_THEME, customTheme: null };
    }

    function clearManagedVariables(root) {
        if (!root || !root.style) return;
        MANAGED_CUSTOM_VARIABLES.forEach(variable => root.style.removeProperty(variable));
    }

    function updateExtensionIcon(isLight) {
        if (typeof IconUtils === 'undefined' || !IconUtils.updateExtensionIcon) return;

        try {
            IconUtils.updateExtensionIcon(isLight ? 'light' : 'dark');

            if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
                const navLogoImg = document.querySelector('#navLogo img');
                if (navLogoImg && IconUtils.getIconPath) {
                    navLogoImg.src = chrome.runtime.getURL(
                        IconUtils.getIconPath(isLight ? 'light' : 'dark', 48)
                    );
                }
            }
        } catch (error) {
            console.warn('ThemeService: could not update extension icon', error);
        }
    }

    function notify(themeState) {
        listeners.forEach(listener => {
            try {
                listener(themeState);
            } catch (error) {
                console.warn('ThemeService: theme listener failed', error);
            }
        });
    }

    function applyTheme(theme = getCurrentTheme(), options = {}) {
        const {
            persist = true,
            syncChromeStorage = true
        } = options;
        const resolved = resolveTheme(theme);
        const isLight = resolved.id === 'light' || resolved.customTheme?.base === 'light';
        const root = getRoot();
        const body = getBody();

        [root, body].filter(Boolean).forEach(element => {
            element.classList.toggle('light-theme', isLight);
            element.classList.toggle('dark-theme', !isLight);
        });

        clearManagedVariables(root);
        if (root && resolved.customTheme) {
            Object.entries(resolved.customTheme.variables).forEach(([variable, value]) => {
                root.style.setProperty(variable, value);
            });
        }

        if (persist) {
            const storage = getStorage();
            try {
                storage?.setItem(THEME_KEY, resolved.id);
            } catch (error) {
                console.warn('ThemeService: could not persist active theme', error);
            }
        }

        if (syncChromeStorage && typeof chrome !== 'undefined' && chrome.storage?.local) {
            try {
                const result = chrome.storage.local.set({ theme: resolved.id });
                result?.catch?.(() => {});
            } catch (error) {
                console.warn('ThemeService: could not sync active theme', error);
            }
        }

        updateExtensionIcon(isLight);

        const state = {
            theme: resolved.id,
            isLight,
            customTheme: resolved.customTheme
        };
        notify(state);
        return state;
    }

    function applyCurrentTheme(options = {}) {
        return applyTheme(getCurrentTheme(), options);
    }

    function bindExternalListeners() {
        if (externalListenersBound || typeof global.addEventListener !== 'function') return;
        externalListenersBound = true;

        global.addEventListener('storage', event => {
            if (event.key === THEME_KEY && event.newValue) {
                applyTheme(event.newValue, { persist: false, syncChromeStorage: false });
            } else if (event.key === CUSTOM_THEMES_KEY) {
                applyCurrentTheme({ persist: false, syncChromeStorage: false });
            }
        });
    }

    const ThemeService = {
        CUSTOM_THEME_SCHEMA_VERSION,
        DEFAULT_THEME,
        MANAGED_CUSTOM_VARIABLES,
        getCurrentTheme,
        getCustomThemes,
        saveCustomThemes,
        applyTheme,
        applyCurrentTheme,
        subscribe(listener) {
            if (typeof listener !== 'function') return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };

    global.ThemeService = ThemeService;
    bindExternalListeners();
    applyCurrentTheme({ persist: false, syncChromeStorage: false });
})(typeof window !== 'undefined' ? window : globalThis);
