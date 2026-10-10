import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import '../src/shared/services/WhatsNewService.js';
import { WhatsNewDialog, canShowWhatsNew } from '../src/shared/components/WhatsNewDialog.js';
import { locales } from '../src/shared/i18n/locales.js';
import gate from '../scripts/validate-whats-new.cjs';

const Service = globalThis.WhatsNewService;
const highlight = id => ({ id, title: { ru: `Заголовок ${id}`, en: `Title ${id}` }, text: { ru: 'Описание', en: 'Description' } });
const entry = (version, count = 3) => ({ id: version, version, date: '2026-10-10', highlights: Array.from({ length: count }, (_, i) => highlight(String(i))) });
function store(initial = {}) {
    const data = structuredClone(initial), listeners = new Set();
    return {
        data, listeners, writes: 0,
        async get(key) { return { [key]: structuredClone(data[key]) }; },
        async set(patch) {
            this.writes++;
            Object.assign(data, structuredClone(patch));
            for (const listener of [...listeners]) listener(Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { newValue }])), 'local');
        }
    };
}
const make = (storage, version = '1.3.6', entries = [entry('1.3.6')]) => new Service({ storage, version, entries });
assert(Service.compare('1.3.9', '1.3.10') < 0);
assert.equal(Service.compare('1.3.5', '1.3.5.0'), 0);
assert(Service.compare('1.3.5.1', '1.3.5') > 0);
assert.throws(() => Service.compare('next', '1.3.5'));

for (const [details, baseline] of [
    [{ reason: 'install' }, '1.3.6'],
    [{ reason: 'update', previousVersion: '1.3.5' }, '1.3.5'],
    [{ reason: 'update', previousVersion: '1.3.6' }, '1.3.6'],
    [{ reason: 'update', previousVersion: '1.3.7' }, '1.3.6']
]) {
    const storage = store(), service = make(storage);
    await service.observeInstallation(details);
    assert.equal(storage.data.whatsNewV1.seenVersion, baseline);
    assert.equal((await service.pending()).entries.length, baseline === '1.3.5' ? 1 : 0);
}
const fresh = store();
assert.equal((await make(fresh).pending()).entries.length, 0);
assert.equal(fresh.data.whatsNewV1.seenVersion, '1.3.6');
const old = store({ whatsNewV1: { seenVersion: '1.0.0' } });
const skippedEvent = make(old);
assert.equal((await skippedEvent.pending()).entries.length, 1);
assert.equal(old.data.whatsNewV1.seenVersion, '1.0.0', 'opening without ack never marks seen');
await skippedEvent.observeInstallation({ reason: 'update', previousVersion: '1.3.5' });
assert.equal(old.data.whatsNewV1.seenVersion, '1.0.0');
const downgraded = store({ whatsNewV1: { seenVersion: '1.3.7' } });
assert.equal((await make(downgraded).pending()).entries.length, 0);
await make(downgraded).acknowledge();
assert.equal(downgraded.data.whatsNewV1.seenVersion, '1.3.7');
const silent = make(old, '1.3.6', [{ ...entry('1.3.6', 0), skipAnnouncement: true }]);
assert.equal((await silent.pending()).entries.length, 0);
assert.equal(old.data.whatsNewV1.seenVersion, '1.3.6');
const versions = [entry('1.3.8'), { ...entry('next'), draft: true }, entry('1.3.6', 6), entry('1.3.5', 6), entry('1.3.4'), entry('1.3.3')];
const historyStore = store({ whatsNewV1: { seenVersion: '1.0.0' } });
const history = make(historyStore, '1.3.6', versions);
const selection = await history.pending();
assert.equal(selection.entries.length, 4);
assert.equal(selection.entries.reduce((n, release) => n + release.highlights.length, 0), 18, 'automatic history no longer truncates highlights');
assert.equal(history.history().length, 4);
assert.equal(history.history({ preview: true })[0].version, 'next');
const complete = await make(historyStore, '1.3.6', versions.map(release => release.draft ? release : { ...release, highlights: release.highlights.slice(0, 3) })).pending();
assert.equal(complete.entries.length, 4);

gate.validateCurrent();
const actualCatalog = gate.readCatalog('src/shared/config/whatsNew.js');
const currentInstallation = store({ whatsNewV1: { seenVersion: '1.3.5' } });
assert.equal((await make(currentInstallation, '1.3.5', actualCatalog).pending()).entries.length, 0, 'adding 1.3.5 history never announces it again');
assert.equal(currentInstallation.writes, 0);
assert.equal(make(currentInstallation, '1.3.5', actualCatalog).history().length, 3);
gate.validate([entry('1.3.6')], '1.3.6');
gate.validate([{ ...entry('1.3.6', 0), skipAnnouncement: true }], '1.3.6');
assert.throws(() => gate.validate([entry('1.3.7')], '1.3.6'), /exact/);
assert.throws(() => gate.validate([{ ...entry('next'), draft: true }], '1.3.6'), /exact/);
assert.throws(() => gate.validate([entry('1.3.6'), entry('1.3.6')], '1.3.6'), /Duplicate/);
assert.throws(() => gate.validate([entry('1.3.5'), entry('1.3.6')], '1.3.6'), /newest/);
assert.throws(() => gate.validate([{ ...entry('1.3.6'), date: '2026-02-30' }], '1.3.6'), /date/);
assert.throws(() => gate.validate([entry('1.3.6', 2)], '1.3.6'), /3–6/);
const missingEn = entry('1.3.6'); missingEn.highlights[0].text.en = '';
assert.throws(() => gate.validate([missingEn], '1.3.6'), /localized/);

function environment(storage, url = 'https://extension.test/src/popup/popup.html') {
    const dom = new JSDOM('<button id="trigger">Open</button>', { url, pretendToBeVisual: true });
    const localeListeners = new Set();
    const locale = { currentLocale: 'ru', locales, onLocaleChange(fn) { localeListeners.add(fn); return () => localeListeners.delete(fn); } };
    const chrome = { runtime: { sendMessage: async () => ({ safe: true }) }, storage: { onChanged: {
        addListener: fn => storage.listeners.add(fn), removeListener: fn => storage.listeners.delete(fn)
    } } };
    const service = make(storage);
    return { dom, document: dom.window.document, locale, chrome, localeListeners,
        dialog: new WhatsNewDialog({ service, document: dom.window.document, chrome, locale }) };
}
const shared = store({ whatsNewV1: { seenVersion: '1.3.5' } });
const first = environment(shared), second = environment(shared);
first.document.querySelector('#trigger').focus();
await first.dialog.open(); await second.dialog.open();
assert(first.dialog.root && second.dialog.root, 'multiple surfaces may show independently');
assert.equal(first.dialog.root.getAttribute('role'), 'dialog');
assert.equal(first.document.activeElement.dataset.whatsNew, 'done');
const press = (env, key, shiftKey = false) => env.document.activeElement.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
press(first, 'Tab'); assert.equal(first.document.activeElement.dataset.whatsNew, 'close');
press(first, 'Tab', true); assert.equal(first.document.activeElement.dataset.whatsNew, 'done');
const body = first.dialog.root.querySelector('.whats-new-body'); body.scrollTop = 27;
first.locale.currentLocale = 'en';
for (const listener of first.localeListeners) listener('en');
assert(first.dialog.root.textContent.includes('What’s new'));
assert(first.dialog.root.textContent.includes('Version 1.3.6'));
assert.equal(first.dialog.root.querySelector('.whats-new-body').scrollTop, 27);
for (const listener of shared.listeners) listener({ language: { newValue: 'ru' } }, 'sync');
assert(first.dialog.root.textContent.includes('Версия 1.3.6'));
first.dialog.render('unknown'); assert(first.dialog.root.textContent.includes('Title 0'));
press(first, 'Escape');
await new Promise(resolve => setImmediate(resolve));
assert.equal(shared.data.whatsNewV1.seenVersion, '1.3.6');
assert.equal(first.dialog.root, null); assert.equal(second.dialog.root, null);
assert.equal(first.document.activeElement.id, 'trigger');
assert.equal(shared.listeners.size, 0);

const accordionStore = store({ whatsNewV1: { seenVersion: '1.2.2' } });
const accordion = environment(accordionStore);
accordion.dialog.service.entries = [
    { ...entry('1.3.0', 0), skipAnnouncement: true },
    ...Array.from({ length: 12 }, (_, index) => entry(`1.2.${12 - index}`))
];
await accordion.dialog.open({ manual: true });
let toggles = accordion.dialog.root.querySelectorAll('.whats-new-version-toggle');
assert.equal(toggles.length, 10);
assert.equal(toggles[0].getAttribute('aria-expanded'), 'true');
assert([...toggles].slice(1).every(toggle => toggle.getAttribute('aria-expanded') === 'false'));
assert.equal(accordion.dialog.root.querySelectorAll('.whats-new-version-new').length, 9);
assert(accordion.dialog.root.textContent.includes('10 октября 2026'));
assert.equal(accordion.dialog.root.querySelector('.whats-new-version-date').textContent, '· 10 октября 2026');
assert(!accordion.dialog.root.textContent.includes('Версия 1.3.0'), 'empty skip entries stay out of history');
for (const toggle of toggles) {
    const panel = accordion.document.getElementById(toggle.getAttribute('aria-controls'));
    assert.equal(panel.getAttribute('role'), 'region');
    assert.equal(panel.getAttribute('aria-labelledby'), toggle.id);
    assert.equal(panel.inert, toggle.getAttribute('aria-expanded') === 'false');
}
toggles[0].focus(); press(accordion, 'Enter');
assert.equal(toggles[0].getAttribute('aria-expanded'), 'false');
press(accordion, ' '); assert.equal(toggles[0].getAttribute('aria-expanded'), 'true');
toggles[1].click(); assert.equal(toggles[1].getAttribute('aria-expanded'), 'true', 'multiple panels may stay open');
accordion.dialog.render('en');
toggles = accordion.dialog.root.querySelectorAll('.whats-new-version-toggle');
assert.equal(toggles[1].getAttribute('aria-expanded'), 'true', 'language changes preserve accordion state');
assert(accordion.dialog.root.textContent.includes('October 10, 2026'));
assert(accordion.dialog.root.querySelector('.whats-new-version-new').textContent.includes('New'));
accordion.dialog.root.querySelector('[data-whats-new="more"]').click();
toggles = accordion.dialog.root.querySelectorAll('.whats-new-version-toggle');
assert.equal(toggles.length, 12);
assert.equal(toggles[10].getAttribute('aria-expanded'), 'false');
assert.equal(accordion.dialog.root.querySelector('[data-whats-new="more"]'), null);
assert.equal(accordion.document.activeElement, toggles[10]);
assert.equal(accordion.dialog.root.querySelector('[data-whats-new="history"]'), null);
await accordion.dialog.close(false);

const unfinishedStore = store({ whatsNewV1: { seenVersion: '1.3.5' } });
const unfinished = environment(unfinishedStore);
await unfinished.dialog.open(); unfinished.dom.window.dispatchEvent(new unfinished.dom.window.Event('pagehide'));
assert.equal(unfinishedStore.data.whatsNewV1.seenVersion, '1.3.5');
await unfinished.dialog.open(); assert(unfinished.dialog.root); await unfinished.dialog.close(false);
for (const path of ['admin/admin.html', 'options/options.html', 'update/update_instructions.html', 'offscreen/offscreen.html']) {
    const env = environment(unfinishedStore, `https://extension.test/src/pages/${path}`);
    await env.dialog.open(); assert.equal(env.dialog.root, null);
}
const blocked = environment(unfinishedStore);
blocked.document.body.append(blocked.document.createElement('div'));
blocked.document.body.lastChild.setAttribute('role', 'dialog');
assert(!canShowWhatsNew(blocked.document, blocked.document.location.pathname));
await blocked.dialog.open(); assert.equal(blocked.dialog.root, null);
blocked.document.body.lastChild.remove();
const hiddenParent = blocked.document.createElement('div');
hiddenParent.style.display = 'none';
hiddenParent.innerHTML = '<div role="dialog"></div>';
blocked.document.body.append(hiddenParent);
assert(canShowWhatsNew(blocked.document, blocked.document.location.pathname), 'a dialog inside a closed surface cannot block release notes');
hiddenParent.remove();
Object.defineProperty(blocked.document, 'fullscreenElement', { value: blocked.document.body, configurable: true });
await blocked.dialog.open(); assert.equal(blocked.dialog.root, null);
Object.defineProperty(blocked.document, 'fullscreenElement', { value: null });
blocked.chrome.runtime.sendMessage = async () => ({ safe: false });
await blocked.dialog.open(); assert.equal(blocked.dialog.root, null);

const previewStore = store(), preview = environment(previewStore, 'https://extension.test/src/pages/settings/settings.html?whatsNewPreview=draft');
assert(!canShowWhatsNew(preview.document, preview.document.location.pathname), 'draft preview cannot initialize automatic acknowledgement');
preview.dialog.service.entries = versions;
await preview.dialog.open({ manual: true, preview: true });
assert(preview.dialog.root.textContent.includes('Черновик следующей версии'));
assert.equal(preview.dialog.root.querySelectorAll('.whats-new-version-toggle').length, 5, 'preview includes published history below the draft');
await preview.dialog.close(true); assert.equal(previewStore.writes, 0);
const manual = environment(downgraded);
await manual.dialog.open({ manual: true }); await manual.dialog.close(true);
assert.equal(downgraded.data.whatsNewV1.seenVersion, '1.3.7');

const broken = environment({ ...store(), async get() { throw new Error('storage unavailable'); } });
const originalWarn = console.warn; console.warn = () => {};
try { await broken.dialog.open(); assert.equal(broken.dialog.root, null); } finally { console.warn = originalWarn; }
const backdrop = environment(unfinishedStore); await backdrop.dialog.open();
backdrop.dialog.root.click(); await new Promise(resolve => setImmediate(resolve));
assert.equal(backdrop.dialog.root, null);
assert.equal(unfinishedStore.data.whatsNewV1.seenVersion, '1.3.6');

const css = fs.readFileSync('src/shared/styles/components.css', 'utf8');
assert(css.includes('max-height: min(680px, calc(100dvh - 24px))'));
assert(/\.whats-new-body\s*\{[^}]*overflow-y: auto/.test(css));
assert(css.includes('var(--ui-color-surface)') && css.includes('var(--ui-color-content)'));
assert(css.includes('grid-template-rows: 0fr') && css.includes('grid-template-rows: 1fr'));
assert(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.whats-new-version-panel, \.whats-new-version-chevron \{ transition: none;/s.test(css));
const popup = fs.readFileSync('src/popup/popup.js', 'utf8');
assert(popup.indexOf('await this.initI18n()') < popup.indexOf("import('../shared/components/WhatsNewDialog.js')"));
const settings = fs.readFileSync('src/pages/settings/settings.js', 'utf8');
assert(settings.includes("get('whatsNewPreview') === 'draft'"));
assert(!fs.readFileSync('src/shared/components/WhatsNewDialog.js', 'utf8').includes('innerHTML'));
const background = fs.readFileSync('src/background/background.js', 'utf8');
assert(background.indexOf('observeInstallation(details)') < background.indexOf('UpdateService.confirmInstalled(details)'));
assert(background.includes('UpdateService.inspectPlaybackSafety().then(sendResponse)'));
assert(fs.readFileSync('scripts/package-release.js', 'utf8').indexOf('validateCurrent()') < fs.readFileSync('scripts/package-release.js', 'utf8').indexOf("run('npm'"));
console.log('WhatsNew service, dialog, localization, preview and release contracts passed');
