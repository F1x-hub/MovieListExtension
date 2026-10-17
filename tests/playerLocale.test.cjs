const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const catalogScope = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/shared/i18n/locales.js'), 'utf8').replace('export const locales', 'globalThis.locales'), catalogScope);
const source = fs.readFileSync(path.join(root, 'src/shared/services/player/PlayerLocale.js'), 'utf8');
function harness(language) {
    const dom = new JSDOM('<div id="root"><button aria-label="Настройки"><svg></svg><span>Настройки субтитров</span></button><span class="player-settings-menu__label">Качество</span><span class="player-settings-menu__value">Основная</span><div id="provider">Субтитры</div></div>', { runScripts: 'outside-only' });
    const events = new Set();
    let pageListener;
    dom.window.i18n = { locales: catalogScope.locales, onLocaleChange: listener => { pageListener = listener; return () => { pageListener = null; }; } };
    dom.window.chrome = { storage: { sync: { get: async () => ({ language }) }, onChanged: { addListener: fn => events.add(fn), removeListener: fn => events.delete(fn) } }, i18n: { getUILanguage: () => 'ru-RU' } };
    dom.window.eval(source);
    return { dom, locale: dom.window.PlayerLocale, events, pageChange: value => pageListener(value) };
}
test('canonical player catalog has matching RU/EN keys and service consumes it', async () => {
    assert.deepEqual(Object.keys(catalogScope.locales.ru.player).sort(), Object.keys(catalogScope.locales.en.player).sort());
    const h = harness('en');
    assert.equal(h.locale.t('quality', {}, 'Качество'), 'Качество');
    await h.locale.init();
    assert.equal(h.locale.ready, true);
    assert.equal(h.locale.t('quality'), catalogScope.locales.en.player.quality);
    assert.equal(h.locale.t('track', { number: 3 }), 'Track 3');
    assert.equal(h.locale.t('missing', {}, 'fallback'), 'fallback');
    h.locale.destroy(); h.dom.window.close();
});
test('storage/page locale changes notify once, and dispose removes listeners', async () => {
    const h = harness('ru'); await h.locale.init(); await h.locale.init();
    assert.equal(h.events.size, 1);
    const changes = [];
    const unsubscribe = h.locale.subscribe(value => changes.push(value));
    for (const listener of h.events) listener({ language: { newValue: 'en' } }, 'sync');
    assert.equal(h.locale.t('quality'), 'Quality');
    h.pageChange('ru');
    assert.deepEqual(changes, ['en', 'ru']);
    unsubscribe(); h.locale.setLocale('en');
    assert.equal(changes.length, 2);
    h.locale.destroy(); assert.equal(h.events.size, 0); h.dom.window.close();
});
test('relabels owned text/attributes while preserving SVG/provider names', async () => {
    const h = harness('en'); await h.locale.init();
    const root = h.dom.window.document.getElementById('root');
    h.locale.localize(root);
    assert.equal(root.querySelector('button').getAttribute('aria-label'), 'Settings');
    assert.equal(root.querySelector('button span').textContent, 'Subtitle settings');
    assert.equal(root.querySelectorAll('svg').length, 1);
    assert.equal(root.querySelector('.player-settings-menu__label').textContent, 'Quality');
    assert.equal(root.querySelector('.player-settings-menu__value').textContent, 'Основная');
    assert.equal(root.querySelector('#provider').textContent, 'Субтитры');
    h.locale.destroy(); h.dom.window.close();
});
test('uses browser RU locale without saved language', async () => {
    const h = harness(null); await h.locale.init();
    assert.equal(h.locale.t('quality'), 'Качество');
    h.locale.destroy(); h.dom.window.close();
});
