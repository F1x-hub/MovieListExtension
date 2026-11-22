// Catalog text comes only from the `catalog` locale group, in both languages.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const CYRILLIC = /[Ѐ-ӿ]/;

const { locales } = await import('../src/shared/i18n/locales.js');
const { I18n } = await import('../src/shared/i18n/I18n.js');
const { CATALOG_CATEGORIES } = require('../src/shared/config/catalogCategories.js');

function flatten(object, prefix = '') {
    return Object.entries(object).flatMap(([key, value]) => (
        value && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]
    ));
}

// 1. Both locales have the same catalog keys, all filled; English has no Russian left in it.
assert.ok(locales.en.catalog && locales.ru.catalog, 'both locales need a catalog group');
const en = new Map(flatten(locales.en.catalog));
const ru = new Map(flatten(locales.ru.catalog));
assert.deepEqual([...en.keys()].sort(), [...ru.keys()].sort(), 'en and ru catalog groups must have the same keys');
for (const [key, value] of [...en, ...ru]) {
    assert.equal(typeof value, 'string', `catalog.${key} must be a string`);
    assert.ok(value.trim(), `catalog.${key} must not be empty`);
}
for (const [key, value] of en) assert.ok(!CYRILLIC.test(value), `en catalog.${key} is still Russian: ${value}`);

// 2. Script and stylesheet carry no user-visible Russian of their own.
for (const file of ['src/pages/catalog/catalog.js', 'src/pages/catalog/catalog.css']) {
    read(file).split('\n').forEach((line, index) => {
        assert.ok(!CYRILLIC.test(line), `${file}:${index + 1} has hardcoded Cyrillic: ${line.trim()}`);
    });
}

// 3. Russian left in the markup is only the first-paint copy of a data-i18n key, word for word.
const html = new JSDOM(read('src/pages/catalog/catalog.html')).window.document;
const keyOf = element => {
    const raw = element.getAttribute('data-i18n') || '';
    const match = raw.match(/^\[(.*?)\](.*)$/);
    return match ? { attr: match[1], key: match[2] } : { attr: null, key: raw };
};
const lookup = (locale, key) => key.split('.').reduce((value, part) => value?.[part], locales[locale]);
html.querySelectorAll('*').forEach(element => {
    const ownText = Array.from(element.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join('').trim();
    const { attr, key } = keyOf(element);
    if (CYRILLIC.test(ownText)) {
        assert.ok(key && !attr, `<${element.tagName.toLowerCase()}> "${ownText}" has no data-i18n text key`);
        assert.ok(ownText.startsWith(lookup('ru', key)), `"${ownText}" differs from ru ${key}`);
    }
    Array.from(element.attributes).filter(attribute => attribute.name !== 'data-i18n' && CYRILLIC.test(attribute.value)).forEach(attribute => {
        assert.equal(attr, attribute.name, `${attribute.name}="${attribute.value}" has no data-i18n="[${attribute.name}]…" key`);
        assert.equal(attribute.value, lookup('ru', key), `${attribute.name}="${attribute.value}" differs from ru ${key}`);
    });
    if (key) {
        assert.equal(typeof lookup('en', key), 'string', `en is missing ${key}`);
        assert.equal(typeof lookup('ru', key), 'string', `ru is missing ${key}`);
    }
});

// 4. Text the script builds resolves to real keys in both languages for every category.
globalThis.window = { getComputedStyle: () => ({ gridTemplateColumns: '' }), CATALOG_CATEGORIES };
globalThis.document = { addEventListener() {} };
require('../src/pages/catalog/catalog.js');
const i18n = new I18n();
window.i18n = i18n;

const staticKeys = [...read('src/pages/catalog/catalog.js').matchAll(/this\.t\('([a-z_.]+)'\)/g)].map(match => match[1]);
const codeKeys = [...staticKeys, 'loading', 'load_more', 'stale', 'error_aborted', 'error_not_configured', 'error_generic'];
for (const key of codeKeys) {
    assert.ok(en.has(key) && ru.has(key), `catalog.${key} used by catalog.js is missing`);
}

for (const locale of ['en', 'ru']) {
    i18n.currentLocale = locale;
    for (const category of Object.keys(CATALOG_CATEGORIES)) {
        const page = Object.create(window.CatalogPage.prototype);
        page.state = { category, keyword: '' };
        const copy = page.getCategoryCopy();
        assert.ok(!copy.title.startsWith('catalog.') && !copy.description.startsWith('catalog.'), `${locale} ${category} heading is missing`);
        const options = page.getSortOptions();
        assert.deepEqual(options.map(option => option.value), CATALOG_CATEGORIES[category].sortOptions.map(option => option.value));
        options.forEach(option => assert.notEqual(option.label, option.labelKey, `${locale} ${option.labelKey} is missing`));
        if (locale === 'ru') {
            // The Russian wording stays what the category config always showed.
            assert.equal(copy.title, CATALOG_CATEGORIES[category].title);
            assert.equal(copy.description, CATALOG_CATEGORIES[category].description);
            assert.deepEqual(options.map(option => option.label), CATALOG_CATEGORIES[category].sortOptions.map(option => option.label));
        } else {
            assert.ok(!CYRILLIC.test(copy.title + copy.description + options.map(option => option.label).join('')), `en ${category} still shows Russian`);
        }
    }
}

// 5. A status set in one language is shown again in the other.
const page = Object.create(window.CatalogPage.prototype);
page.elements = { status: { textContent: '' } };
i18n.currentLocale = 'ru';
page.setStatus('stale');
assert.equal(page.elements.status.textContent, locales.ru.catalog.stale);
i18n.currentLocale = 'en';
page.setStatus(page.statusKey);
assert.equal(page.elements.status.textContent, locales.en.catalog.stale);
assert.equal(page.formatCount(12345), '12,345');

console.log('✅ Catalog text is fully localized in en and ru');
