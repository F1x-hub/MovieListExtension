const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

function createStorage() {
    const values = new Map();
    return {
        getItem: key => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
        clear: () => values.clear()
    };
}

function createElement() {
    const classes = new Set();
    const attributes = new Map();
    return {
        hidden: false,
        textContent: '',
        title: '',
        dataset: {},
        classList: {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name)
        },
        setAttribute: (name, value) => attributes.set(name, String(value)),
        getAttribute: name => attributes.get(name) ?? null,
        addEventListener(type, handler) {
            this[`on${type}`] = handler;
        }
    };
}

const root = createElement();
globalThis.localStorage = createStorage();
globalThis.document = {
    documentElement: root,
    body: null,
    readyState: 'complete',
    visibilityState: 'visible',
    addEventListener() {},
    querySelectorAll: () => [],
    getElementById: () => null
};

const service = require(path.join(__dirname, '../src/shared/services/SeasonalThemeService.js'));
const at = (month, day, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute);

// Window boundaries are inclusive local days: 17 Oct through 7 Nov.
assert.strictEqual(service.getActiveSeason(at(10, 16, 23, 59)), null);
assert.strictEqual(service.getActiveSeason(at(10, 17, 0, 0))?.id, 'halloween');
assert.strictEqual(service.getActiveSeason(at(10, 31))?.id, 'halloween');
assert.strictEqual(service.getActiveSeason(at(11, 7, 23, 59))?.id, 'halloween');
assert.strictEqual(service.getActiveSeason(at(11, 8, 0, 0)), null);
assert.strictEqual(service.getActiveSeason(at(6, 1)), null);
assert.strictEqual(service.getActiveSeason(new Date('invalid')), null);
assert.strictEqual(service.getActiveSeason(new Date(2027, 9, 20)).year, 2027);

const season = service.getActiveSeason(at(10, 19));
assert.strictEqual(service.getDaysUntilPeak(season, at(10, 19, 23, 30)), 12);
assert.strictEqual(service.getDaysUntilPeak(season, at(10, 31, 0, 5)), 0);
assert.strictEqual(service.getDaysUntilPeak(season, at(11, 3)), -3);

// Enabled by default; the class lives on <html> only inside the window.
assert.strictEqual(service.isEnabled(), true);
service.apply({ date: at(10, 20) });
assert.ok(root.classList.contains('season-halloween'));
assert.strictEqual(root.dataset.season, 'halloween');
service.apply({ date: at(11, 20) });
assert.ok(!root.classList.contains('season-halloween'));
assert.strictEqual(root.dataset.season, undefined);

// The opt-out persists through the synchronous mirror.
service.setEnabled(false);
assert.strictEqual(localStorage.getItem(service.MIRROR_KEY), '0');
assert.strictEqual(service.getActiveDecor(at(10, 20)), null);
service.apply({ date: at(10, 20) });
assert.ok(!root.classList.contains('season-halloween'));

// Settings preview is page-local and does not touch storage.
service.preview(true);
assert.strictEqual(service.isEnabled(), true);
assert.strictEqual(localStorage.getItem(service.MIRROR_KEY), '0');
service.preview(null);
assert.strictEqual(service.isEnabled(), false);
service.setEnabled(true);
assert.strictEqual(service.isEnabled(), true);

const logo = service.getLogoMarkup('nav-logo-image');
assert.match(logo, /class="season-logo nav-logo-image"/);
assert.match(logo, /season-logo__ember/);
assert.match(logo, /aria-hidden="true"/);
assert.doesNotMatch(logo, /#[0-9a-f]{3,8}\b/i, 'logo color must come from seasonal CSS tokens');

const scene = service.getSceneMarkup('season-banner__art');
assert.match(scene, /class="season-scene season-banner__art"/);
assert.match(scene, /season-scene__window/);
assert.doesNotMatch(scene, /#[0-9a-f]{3,8}\b/i, 'scene color must come from seasonal CSS tokens');

// Side art uses gradient references only; colors stay in seasonal.css tokens.
const sideArt = service.getSideArtMarkup();
for (const part of ['seasonal-side__branch', 'seasonal-side__graves', 'seasonal-side__spider', 'seasonal-side__pumpkins',
    'season-ghost', 'season-gy-crow', 'season-gy-candle', 'season-pk-face']) {
    assert.ok(sideArt.includes(part), `side art is missing ${part}`);
}
assert.doesNotMatch(sideArt.replace(/url\(#\w+\)/g, ''), /#[0-9a-f]{3,8}\b/i, 'side art color must come from seasonal CSS tokens');
const sideIds = [...sideArt.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.strictEqual(new Set(sideIds).size, sideIds.length, 'side art gradient ids must be unique');
for (const [, reference] of sideArt.matchAll(/url\(#(\w+)\)/g)) {
    assert.ok(sideIds.includes(reference), `side art references a missing gradient ${reference}`);
}

(async () => {
    const { locales } = await import(pathToFileURL(path.join(__dirname, '../src/shared/i18n/locales.js')).href);
    for (const locale of ['en', 'ru']) {
        const copy = locales[locale].home.season.halloween;
        for (const key of ['title', 'today', 'after', 'cta', 'dismiss']) {
            assert.ok(copy[key], `${locale} home.season.halloween.${key} is missing`);
        }
        assert.match(copy.before.other, /\{count\}/);
    }

    const makeI18n = locale => ({
        currentLocale: locale,
        get(key) {
            const value = key.split('.').reduce((node, part) => node?.[part], locales[locale]);
            return typeof value === 'string' ? value : key;
        }
    });

    require(path.join(__dirname, '../src/pages/home/HomeSeasonalBanner.js'));
    const parts = {
        '.season-banner__title': createElement(),
        '.season-banner__message': createElement(),
        '.season-banner__cta': createElement(),
        '.season-banner__close': createElement()
    };
    const bannerRoot = createElement();
    bannerRoot.hidden = true;
    bannerRoot.querySelector = selector => parts[selector] || null;

    globalThis.i18n = makeI18n('ru');
    const banner = new globalThis.HomeSeasonalBanner(bannerRoot);
    banner.render(at(10, 30));
    assert.strictEqual(bannerRoot.hidden, false);
    assert.strictEqual(parts['.season-banner__title'].textContent, 'Сезон Хэллоуина');
    assert.match(parts['.season-banner__message'].textContent, /До Хэллоуина 1 день\./);
    banner.render(at(10, 28));
    assert.match(parts['.season-banner__message'].textContent, /До Хэллоуина 3 дня\./);
    banner.render(at(10, 19));
    assert.match(parts['.season-banner__message'].textContent, /До Хэллоуина 12 дней\./);
    banner.render(at(10, 31));
    assert.match(parts['.season-banner__message'].textContent, /Счастливого Хэллоуина/);
    banner.render(at(11, 2));
    assert.match(parts['.season-banner__message'].textContent, /Хэллоуин позади/);
    assert.strictEqual(parts['.season-banner__close'].getAttribute('aria-label'), 'Скрыть баннер Хэллоуина');

    globalThis.i18n = makeI18n('en');
    banner.render(at(10, 30));
    assert.strictEqual(parts['.season-banner__message'].textContent.startsWith('1 day until Halloween'), true);
    banner.render(at(10, 20));
    assert.strictEqual(parts['.season-banner__message'].textContent.startsWith('11 days until Halloween'), true);

    // Off-season and opt-out both hide the banner.
    banner.render(at(12, 1));
    assert.strictEqual(bannerRoot.hidden, true);
    service.setEnabled(false);
    banner.render(at(10, 20));
    assert.strictEqual(bannerRoot.hidden, true);
    service.setEnabled(true);

    // Dismissal lasts for this season's year only.
    banner.render(at(10, 20));
    banner.dismiss();
    assert.strictEqual(bannerRoot.hidden, true);
    banner.render(at(10, 25));
    assert.strictEqual(bannerRoot.hidden, true);
    banner.render(new Date(2027, 9, 20));
    assert.strictEqual(bannerRoot.hidden, false);

    console.log('Seasonal theme tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
