import { locales } from '../i18n/locales.js';

/**
 * Translation helper for the mini-games. Strings live in the `games` section of
 * `src/shared/i18n/locales.js`; the active locale comes from `window.i18n` and the
 * Russian copy is the fallback when i18n is not loaded (tests, early renders).
 */

function lookup(locale, key) {
    return key.split('.').reduce((value, part) => value?.[part], locale);
}

export function getGamesLocale() {
    const current = globalThis.window?.i18n?.currentLocale;
    return current && locales[current] ? current : 'ru';
}

export function t(key, params) {
    const fullKey = `games.${key}`;
    let value = lookup(locales[getGamesLocale()], fullKey);
    if (typeof value !== 'string') value = lookup(locales.en, fullKey);
    if (typeof value !== 'string') value = lookup(locales.ru, fullKey);
    if (typeof value !== 'string') return key;
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/** Picks a plural form from a "one|few|many" string using the active locale's rules. */
export function plural(count, formsKey) {
    const forms = t(formsKey).split('|');
    const value = Math.abs(Number(count)) || 0;
    if (getGamesLocale() !== 'ru') return value === 1 ? forms[0] : forms[forms.length - 1];
    const mod10 = value % 10;
    const mod100 = value % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1] ?? forms[0];
    return forms[2] ?? forms[forms.length - 1];
}

/** Escapes text interpolated into HTML templates. */
export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Sizes a canvas backing store for the device pixel ratio so drawing stays sharp on
 * HiDPI screens. Games draw in CSS pixels and read the logical size from dataset.
 */
export function setupHiDpiCanvas(canvas, width, height) {
    if (!canvas) return null;
    const ratio = Math.max(1, Math.min(3, Number(globalThis.window?.devicePixelRatio) || 1));
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.dataset.viewWidth = String(width);
    canvas.dataset.viewHeight = String(height);
    const context = canvas.getContext?.('2d');
    context?.setTransform?.(ratio, 0, 0, ratio, 0, 0);
    return context;
}

export function getCanvasViewSize(canvas) {
    return {
        width: Number(canvas?.dataset?.viewWidth) || canvas?.width || 0,
        height: Number(canvas?.dataset?.viewHeight) || canvas?.height || 0
    };
}

/** Unbiased Fisher–Yates shuffle that returns a new array. */
export function shuffled(items, random = Math.random) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
}
