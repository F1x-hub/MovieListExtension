/**
 * CursorService
 *
 * The single runtime owner of the extension's own cursors: whether they are on, which
 * variant, its size and roundness. It draws the cursor images from those settings and
 * hands them to src/shared/styles/cursors.css through its --cursor-* variables. The
 * stylesheet already holds the default set, so a page with default settings (or without
 * this script) needs nothing from here; any other choice is written into one <style>.
 *
 * Runs synchronously in <head>, before the first paint, like ThemeService. A change
 * applies at once on every open page through the `storage` event.
 */
(function (global) {
    'use strict';

    const STORAGE_KEY = 'movieExtensionCursor';
    const STYLE_ID = 'extension-cursor-settings';

    const LIMITS = Object.freeze({
        size: { min: 24, max: 32, step: 2 },
        softness: { min: 1, max: 3.2, step: 0.1 },
    });

    // Light ink is the dark theme's, and the player's in both themes.
    const INKS = Object.freeze({
        dark: { fill: '#f4f4f5', edge: '#09090b' },
        light: { fill: '#18181b', edge: '#ffffff' },
    });

    const OUTLINE = 1.3;
    const round2 = value => +value.toFixed(2);
    const encodeColor = color => color.replace('#', '%23');

    /*
     * A variant draws the three cursors in a 24-unit box. Each cursor is a thin skeleton
     * under a thick round stroke, so softness is one radius for every edge. Hotspots are
     * in the same 24-unit box and are scaled with the size.
     */
    const ARROW = 'M5.2 4.6L5.2 16.4L8.2 13.8L10.4 18.4L11.5 17.9L9.5 13.3L13.6 13.3Z';
    const TEXT_BAR = 'M9.4 4.2H14.6M12 4.2V19.8M9.4 19.8H14.6';

    const VARIANTS = Object.freeze({
        soft: {
            hotspots: { default: [5.2, 4.6], pointer: [10.2, 3.2], text: [12, 12] },
            draw(softness, { fill, edge }) {
                const r = softness;
                const arrow = `<path d='${ARROW}' fill='${edge}' stroke='${edge}' stroke-width='${round2(2 * r + 2 * OUTLINE)}' stroke-linejoin='round'/>`
                    + `<path d='${ARROW}' fill='${fill}' stroke='${fill}' stroke-width='${round2(2 * r)}' stroke-linejoin='round'/>`;

                const finger = 2.9 * Math.min(1, 0.55 + r * 0.18) + 0.6;
                const handLayer = (color, extra) => `<g fill='${color}' stroke='${color}' stroke-linecap='round' stroke-linejoin='round'>`
                    + `<path d='M10.2 4.4V13' stroke-width='${round2(finger + extra)}' fill='none'/>`
                    + `<path d='M13.3 10.6V13M16 11.2V13.4M18.4 12.4V14' stroke-width='${round2(finger - 0.2 + extra)}' fill='none'/>`
                    + `<path d='M10.4 15.4L6.6 12.8' stroke-width='${round2(finger - 0.3 + extra)}' fill='none'/>`
                    + `<rect x='9.4' y='12.4' width='10' height='7' rx='${round2(1.5 + r)}' stroke-width='${round2(extra)}'/></g>`;
                const pointer = handLayer(edge, 2 * OUTLINE) + handLayer(fill, 0)
                    + `<path d='M11.8 12.6V14M14.6 12.9V14.4M17.2 13.4V14.8' stroke='${edge}' stroke-width='0.9' stroke-linecap='round' opacity='0.55'/>`;

                const bar = 1.6 + r * 0.25;
                const text = `<path d='${TEXT_BAR}' fill='none' stroke='${edge}' stroke-width='${round2(bar + 2 * OUTLINE)}' stroke-linecap='round' stroke-linejoin='round'/>`
                    + `<path d='${TEXT_BAR}' fill='none' stroke='${fill}' stroke-width='${round2(bar)}' stroke-linecap='round'/>`;

                return { default: arrow, pointer, text };
            },
        },
    });

    const DEFAULTS = Object.freeze({ enabled: true, variant: 'soft', size: 28, softness: 2.2 });
    const FALLBACKS = Object.freeze({ default: 'default', pointer: 'pointer', text: 'text' });

    const listeners = new Set();

    function clampToStep(value, { min, max, step }, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        const stepped = Math.round((Math.min(max, Math.max(min, number)) - min) / step) * step + min;
        return round2(stepped);
    }

    function normalize(value) {
        const source = value && typeof value === 'object' ? value : {};
        return {
            enabled: source.enabled !== false,
            variant: Object.hasOwn(VARIANTS, source.variant) ? source.variant : DEFAULTS.variant,
            size: clampToStep(source.size, LIMITS.size, DEFAULTS.size),
            softness: clampToStep(source.softness, LIMITS.softness, DEFAULTS.softness),
        };
    }

    const isDefault = settings => Object.keys(DEFAULTS).every(key => settings[key] === DEFAULTS[key]);

    function readSettings() {
        try {
            const raw = global.localStorage?.getItem(STORAGE_KEY);
            return normalize(raw ? JSON.parse(raw) : null);
        } catch {
            return normalize(null);
        }
    }

    function writeSettings(settings) {
        try {
            if (isDefault(settings)) global.localStorage?.removeItem(STORAGE_KEY);
            else global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (error) {
            console.warn('CursorService: could not persist the cursor', error);
        }
    }

    function svg(body, size) {
        return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 24 24'>${body}</svg>`;
    }

    /** The three cursor images of one ink as `data:` URIs, for previews. */
    function images(settings, inkName = 'dark') {
        const chosen = normalize(settings);
        const ink = INKS[inkName] || INKS.dark;
        const bodies = VARIANTS[chosen.variant].draw(chosen.softness, ink);
        return Object.fromEntries(Object.entries(bodies).map(([name, body]) => [
            name, `data:image/svg+xml,${encodeURIComponent(svg(body, chosen.size))}`,
        ]));
    }

    /** The values of --cursor-default, --cursor-pointer and --cursor-text for one ink. */
    function variables(settings, inkName = 'dark') {
        const chosen = normalize(settings);
        if (!chosen.enabled) return { ...FALLBACKS };
        const ink = INKS[inkName] || INKS.dark;
        const variant = VARIANTS[chosen.variant];
        const bodies = variant.draw(chosen.softness, { fill: encodeColor(ink.fill), edge: encodeColor(ink.edge) });
        const scale = chosen.size / 24;
        return Object.fromEntries(Object.entries(bodies).map(([name, body]) => {
            const [x, y] = variant.hotspots[name];
            return [name, `url("data:image/svg+xml,${svg(body, chosen.size)}") ${Math.round(x * scale)} ${Math.round(y * scale)}, ${FALLBACKS[name]}`];
        }));
    }

    const PLAYER_SURFACES = '.player-surface__content, .video-wrapper, .player-clean, .native-player-wrapper';

    /** The stylesheet for settings other than the defaults; empty for the defaults. */
    function styleText(settings) {
        const chosen = normalize(settings);
        if (isDefault(chosen)) return '';
        const block = inkName => Object.entries(variables(chosen, inkName))
            .map(([name, value]) => `--cursor-${name}: ${value};`).join(' ');
        return `:root, .dark-theme { ${block('dark')} }\n`
            + `.light-theme { ${block('light')} }\n`
            + `${PLAYER_SURFACES} { ${block('dark')} }\n`
            + `@media (forced-colors: active), (prefers-contrast: more) { :root, .dark-theme, .light-theme, ${PLAYER_SURFACES} { --cursor-default: default; --cursor-pointer: pointer; --cursor-text: text; } }\n`;
    }

    function applyStyle(settings) {
        if (typeof document === 'undefined') return;
        const css = styleText(settings);
        let style = document.getElementById(STYLE_ID);
        if (!css) {
            style?.remove();
            return;
        }
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
        }
        style.textContent = css;
        // Last in <head>, so it follows cursors.css whatever order the page links things in.
        (document.head || document.documentElement).append(style);
    }

    function notify(settings) {
        listeners.forEach(listener => {
            try {
                listener(settings);
            } catch (error) {
                console.error('CursorService listener failed', error);
            }
        });
    }

    function apply(settings = readSettings()) {
        const chosen = normalize(settings);
        applyStyle(chosen);
        notify(chosen);
        return chosen;
    }

    function update(changes) {
        const settings = normalize({ ...readSettings(), ...changes });
        writeSettings(settings);
        return apply(settings);
    }

    function reset() {
        writeSettings(normalize(null));
        return apply(normalize(null));
    }

    const api = {
        DEFAULTS,
        LIMITS,
        VARIANTS: Object.keys(VARIANTS),
        normalize,
        getSettings: readSettings,
        update,
        reset,
        apply,
        images,
        variables,
        styleText,
        subscribe(listener) {
            if (typeof listener !== 'function') return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };

    global.CursorService = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    if (typeof document !== 'undefined') {
        global.addEventListener?.('storage', event => {
            if (event.key === STORAGE_KEY || event.key === null) apply();
        });
        apply();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => applyStyle(readSettings()), { once: true });
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
