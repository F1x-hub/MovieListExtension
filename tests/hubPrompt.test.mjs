import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

globalThis.chrome = { storage: { sync: { get: async () => ({}) } } };
const { HubPrompt, hubPromptReason } = await import('../src/shared/components/HubPrompt.js');
const { locales } = await import('../src/shared/i18n/locales.js');

const windows = 'Win32';
assert.equal(hubPromptReason({ hostAvailability: 'missing' }, windows), 'missing');
assert.equal(hubPromptReason({ hostAvailability: 'forbidden' }, windows), 'missing');
assert.equal(hubPromptReason({ hostAvailability: 'not_configured' }, windows), 'missing');
assert.equal(hubPromptReason({ hostAvailability: 'unavailable' }, windows), null, 'a transient host failure never prompts');
assert.equal(hubPromptReason({ hostAvailability: 'available', componentCapabilities: { protocolVersion: 1 } }, windows), 'outdated');
assert.equal(hubPromptReason({ hostAvailability: 'available', componentCapabilities: { mediaPlayerInstall: true } }, windows), null);
assert.equal(hubPromptReason({}, windows), null, 'no host check yet means no prompt');
assert.equal(hubPromptReason({ hostAvailability: 'missing' }, 'MacIntel'), null, 'the hub exists only on Windows');

function environment(state, { path = '/src/pages/home/home.html', prompt, now = 1_000_000 } = {}) {
    const dom = new JSDOM('<body></body>', { url: `https://extension.test${path}` });
    const data = { extension_update_state_v2: state, ...(prompt ? { hubPromptV1: prompt } : {}) };
    const listeners = new Set();
    const chrome = { storage: {
        local: {
            async get(keys) { return Object.fromEntries(keys.map(key => [key, data[key]])); },
            async set(values) {
                Object.assign(data, values);
                const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }]));
                listeners.forEach(listener => listener(changes, 'local'));
            }
        },
        onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) }
    } };
    const locale = { get: key => key.split('.').reduce((value, part) => value?.[part], locales.ru) };
    const hub = new HubPrompt({ document: dom.window.document, chrome, locale, platform: windows, now: () => now });
    return { dom, data, hub, document: dom.window.document };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const missing = environment({ hostAvailability: 'missing' });
await missing.hub.start();
const root = missing.document.querySelector('.hub-prompt');
assert(root, 'a missing host shows the prompt');
assert.equal(root.getAttribute('role'), 'region', 'the prompt is a non-modal region, never a blocking dialog');
assert.equal(root.querySelector('.hub-prompt__title').textContent, 'Установите MovieList Hub');
assert.equal(root.querySelector('.hub-prompt__download').getAttribute('href'),
    'https://github.com/F1x-hub/MovieListExtension/releases/latest/download/MovieListSetup.exe');
root.querySelector('.hub-prompt__download').dispatchEvent(new missing.dom.window.MouseEvent('click', { cancelable: true }));
await settle();
assert(missing.document.querySelector('.hub-prompt'), 'download instructions stay visible after the click');
assert.match(missing.document.querySelector('.hub-prompt__text').textContent, /MovieListSetup\.exe/);
assert.equal(missing.data.hubPromptV1.reason, 'missing');
missing.document.querySelector('.hub-prompt__later').click();
assert.equal(missing.document.querySelector('.hub-prompt'), null, 'Close removes the instructions');

const later = environment({ hostAvailability: 'available', componentCapabilities: {} });
await later.hub.start();
assert.equal(later.document.querySelector('.hub-prompt__title').textContent, 'Обновите MovieList Hub');
later.document.querySelector('.hub-prompt__later').click();
await settle();
assert.equal(later.document.querySelector('.hub-prompt'), null);
assert.equal(later.data.hubPromptV1.until, 1_000_000 + 7 * 24 * 60 * 60 * 1000, 'Later snoozes for a week');

const snoozed = environment({ hostAvailability: 'missing' }, { prompt: { reason: 'missing', until: 2_000_000 } });
await snoozed.hub.start();
assert.equal(snoozed.document.querySelector('.hub-prompt'), null, 'a snoozed reason stays hidden');
const changedReason = environment({ hostAvailability: 'available', componentCapabilities: {} }, { prompt: { reason: 'missing', until: 2_000_000 } });
await changedReason.hub.start();
assert(changedReason.document.querySelector('.hub-prompt'), 'a different reason is not covered by an older snooze');

const fixed = environment({ hostAvailability: 'missing' });
await fixed.hub.start();
await fixed.hub.chrome.storage.local.set({ extension_update_state_v2: { hostAvailability: 'available', componentCapabilities: { mediaPlayerInstall: true } } });
await settle();
assert.equal(fixed.document.querySelector('.hub-prompt'), null, 'the prompt disappears once the hub connects');

const popup = environment({ hostAvailability: 'missing' }, { path: '/src/popup/popup.html' });
await popup.hub.start();
assert.equal(popup.document.querySelector('.hub-prompt'), null, 'the popup never shows the prompt');

const navigation = fs.readFileSync('src/shared/components/Navigation.js', 'utf8');
assert(navigation.includes("import('./HubPrompt.js')"), 'extension pages load the prompt through Navigation');
assert(!fs.readFileSync('src/popup/popup.js', 'utf8').includes('HubPrompt'));
for (const locale of ['ru', 'en']) {
    for (const key of ['missing_title', 'missing_text', 'outdated_title', 'outdated_text', 'download', 'later', 'close', 'after_download'])
        assert.equal(typeof locales[locale].hub_prompt[key], 'string', `${locale}.hub_prompt.${key}`);
}
console.log('hubPrompt.test.mjs passed: Windows-only missing/outdated detection, transient failures ignored, non-modal region, download link, weekly snooze, live dismissal and popup exclusion');
