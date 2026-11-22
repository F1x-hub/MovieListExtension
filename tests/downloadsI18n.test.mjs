/**
 * Downloads page translations: every text the page writes comes from the
 * `downloads` locale group, both locales carry the same keys and placeholders,
 * and every key the page asks for exists.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locales } from '../src/shared/i18n/locales.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const CYRILLIC = /[Ѐ-ӿ]/;

function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ---------- No hardcoded Russian in the page code ----------

const pageSource = read('src/pages/downloads/downloads.js');
const modelSource = read('src/pages/downloads/DownloadsLibraryModel.js');
stripComments(pageSource).split('\n').forEach((line, index) => {
    assert.ok(!CYRILLIC.test(line), `downloads.js:${index + 1} has hardcoded Cyrillic: ${line.trim()}`);
});
stripComments(modelSource).split('\n').forEach((line, index) => {
    // Search folds «ё» into «е»; that is matching, not a text on the page.
    const checked = line.replace("replace(/ё/g, 'е')", '');
    assert.ok(!CYRILLIC.test(checked), `DownloadsLibraryModel.js:${index + 1} has hardcoded Cyrillic: ${line.trim()}`);
});

// ---------- Markup: every Russian text is translated ----------

const html = read('src/pages/downloads/downloads.html').replace(/<!--[\s\S]*?-->/g, '');
const htmlKeys = [];
for (const match of html.matchAll(/<([a-z0-9]+)\b([^>]*)>([^<]*)/gi)) {
    const [, tag, attrs, text] = match;
    const i18nAttr = attrs.match(/data-i18n="([^"]+)"/)?.[1] || '';
    if (i18nAttr) htmlKeys.push(i18nAttr.replace(/^\[[^\]]+\]/, ''));
    const translatedAttr = i18nAttr.match(/^\[([^\]]+)\]/)?.[1] || null;
    if (CYRILLIC.test(text)) {
        assert.ok(i18nAttr && !translatedAttr, `<${tag}> text «${text.trim()}» needs data-i18n`);
    }
    for (const [, name, value] of attrs.matchAll(/([a-z-]+)="([^"]*)"/gi)) {
        if (!CYRILLIC.test(value)) continue;
        const covered = translatedAttr === name
            || (name === 'placeholder' && i18nAttr && !translatedAttr && /^(input|textarea)$/i.test(tag))
            || (name === 'aria-label' && /id="downloadsSearch"/.test(attrs)
                && /search\?\.setAttribute\('aria-label', t\('controls\.search_label'\)\)/.test(pageSource));
        assert.ok(covered, `<${tag}> ${name}="${value}" is not translated`);
    }
}
assert.ok(htmlKeys.length >= 25, 'the markup is translated');

// ---------- Both locales: same keys, same placeholders ----------

function flatten(object, prefix = '') {
    return Object.entries(object).flatMap(([key, value]) => (value && typeof value === 'object'
        ? flatten(value, `${prefix}${key}.`)
        : [[`${prefix}${key}`, value]]));
}

const en = Object.fromEntries(flatten(locales.en.downloads));
const ru = Object.fromEntries(flatten(locales.ru.downloads));
assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort(), 'en and ru downloads groups have the same keys');
const placeholders = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
for (const key of Object.keys(en)) {
    assert.equal(typeof en[key], 'string', `en downloads.${key} is a string`);
    assert.ok(en[key].trim() && ru[key].trim(), `downloads.${key} is not empty`);
    assert.ok(!CYRILLIC.test(en[key]), `en downloads.${key} has no Cyrillic`);
    assert.deepEqual(placeholders(ru[key]), placeholders(en[key]), `downloads.${key} has the same placeholders in both`);
}

// ---------- Every key the page asks for exists ----------

const has = key => Object.hasOwn(en, key.replace(/^downloads\./, ''));
for (const key of htmlKeys) assert.ok(key.startsWith('downloads.') && has(key), `data-i18n key ${key} exists`);

const code = stripComments(pageSource);
const used = new Set([...code.matchAll(/\bt\('([^']+)'/g)].map(match => match[1]));
// t(condition ? 'one.key' : 'other.key')
for (const match of code.matchAll(/\bt\(([^()]*)\?\s*'([^']+)'\s*:\s*'([^']+)'\)/g)) {
    used.add(match[2]);
    used.add(match[3]);
}
for (const filter of ['all', 'active', 'ready', 'paused', 'error']) used.add(`titles.${filter}`);
for (const status of ['starting', 'downloading', 'paused', 'error', 'complete', 'unknown']) used.add(`status.${status}`);
for (const unit of ['b', 'kb', 'mb', 'gb', 'tb']) used.add(`units.${unit}`);
for (const verb of ['paused', 'resumed']) { used.add(`bulk.${verb}`); used.add(`bulk.${verb}_partial`); }
for (const [, noun] of code.matchAll(/\bplural\([^,]+,\s*'([^']+)'\)/g)) {
    for (const form of ['one', 'few', 'many']) used.add(`plural.${noun}_${form}`);
}
assert.ok(used.size > 80, `the page asks for its texts by key (${used.size})`);
for (const key of used) assert.ok(has(key), `downloads.${key} exists in the locale`);

// Language change repaints the open page.
assert.match(code, /message\?\.type === 'SETTINGS_UPDATED'\) void this\.handleSettingsUpdate/);
assert.match(code, /JSON\.stringify\(\[\s*i18n\.currentLocale,/, 'card signatures hold the locale, so cards rebuild');
assert.match(html, /<script type="module" src="downloads\.js"><\/script>/, 'the page script imports I18n as a module');

console.log(`downloadsI18n tests passed (${Object.keys(en).length} keys, ${used.size} used by code, ${htmlKeys.length} in markup)`);
