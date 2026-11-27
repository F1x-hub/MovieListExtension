const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// A tiny DOM and storage, enough for the service's <style> and persistence.
const storage = new Map();
const listeners = {};
const head = { children: [], append(node) { this.children = this.children.filter(item => item !== node).concat(node); node.parent = this; } };
const document = {
    readyState: 'complete',
    head,
    documentElement: head,
    getElementById: id => head.children.find(node => node.id === id) || null,
    createElement: () => ({ id: '', textContent: '', remove() { head.children = head.children.filter(item => item !== this); } }),
};
global.document = document;
global.localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
};
global.addEventListener = (type, listener) => { listeners[type] = listener; };

const cursors = require('../src/shared/services/CursorService.js');
const KEY = 'movieExtensionCursor';
const styleNode = () => document.getElementById('extension-cursor-settings');

// The default set is the one cursors.css ships, value for value.
const css = read('src/shared/styles/cursors.css');
const blockOf = selector => css.split(selector)[1].split('}')[0];
for (const [ink, block] of [['dark', blockOf(':root,\n.dark-theme {')], ['light', blockOf('.light-theme {')]]) {
    const expected = cursors.variables(cursors.DEFAULTS, ink);
    for (const name of ['default', 'pointer', 'text']) {
        const actual = block.match(new RegExp(`--cursor-${name}: (.+);`))[1];
        assert.strictEqual(actual, expected[name], `cursors.css --cursor-${name} (${ink}) is not CursorService's default`);
    }
}

// Defaults need no extra stylesheet; anything else does.
assert.strictEqual(cursors.styleText(cursors.DEFAULTS), '');
assert.strictEqual(styleNode(), null);

// Settings are clamped to their steps, and an unknown variant falls back.
assert.deepStrictEqual(cursors.normalize({ size: 31, softness: 9, variant: 'nope', enabled: 'yes' }),
    { enabled: true, variant: 'soft', size: 32, softness: 3.2 });
assert.deepStrictEqual(cursors.normalize(null), { ...cursors.DEFAULTS });

// Off: every variable is the system keyword, and the choice is stored.
let seen = null;
const unsubscribe = cursors.subscribe(settings => { seen = settings; });
cursors.update({ enabled: false });
assert.strictEqual(JSON.parse(storage.get(KEY)).enabled, false);
assert.strictEqual(seen.enabled, false);
assert.match(styleNode().textContent, /--cursor-default: default; --cursor-pointer: pointer; --cursor-text: text;/);

// A bigger, rounder cursor: images at the new size, hotspots scaled with it.
cursors.update({ enabled: true, size: 32, softness: 3.2 });
const dark = cursors.variables(cursors.getSettings(), 'dark');
assert.match(dark.default, /width='32' height='32'/);
assert.match(dark.default, /\) 7 6, default$/);
assert.match(dark.pointer, /\) 14 4, pointer$/);
assert.match(dark.text, /\) 16 16, text$/);
for (const value of Object.values(dark)) {
    assert.doesNotMatch(value, /#/, 'colours inside a data: URI must be encoded');
}
const text = styleNode().textContent;
assert.match(text, /\.light-theme \{ --cursor-default: url\("data:image\/svg\+xml,[^"]+%2318181b/);
assert.match(text, /\.native-player-wrapper \{ --cursor-default: url\("data:image\/svg\+xml,[^"]+%23f4f4f5/);
assert.match(text, /@media \(forced-colors: active\), \(prefers-contrast: more\)/);

// Preview images are plain data: URIs that an <img> can load.
const images = cursors.images(cursors.getSettings(), 'light');
assert.ok(images.pointer.startsWith('data:image/svg+xml,%3Csvg'));

// Another tab changed it: the storage event re-reads and re-applies.
storage.set(KEY, JSON.stringify({ size: 24 }));
listeners.storage({ key: KEY });
assert.strictEqual(seen.size, 24);

// Back to the defaults: nothing stored, no extra stylesheet.
cursors.reset();
assert.strictEqual(storage.has(KEY), false);
assert.strictEqual(styleNode(), null);
unsubscribe();

// Every page with the theme service also loads the cursor service right after it.
const pages = fs.readdirSync(path.join(root, 'src'), { recursive: true })
    .map(file => `src/${String(file).replace(/\\/g, '/')}`)
    .filter(file => file.endsWith('.html'));
for (const page of pages) {
    const source = read(page);
    if (!/services\/ThemeService\.js"><\/script>/.test(source)) continue;
    assert.match(source, /services\/ThemeService\.js"><\/script>\s*<script src="[^"]*services\/CursorService\.js"><\/script>/,
        `${page} loads ThemeService but not CursorService right after it`);
}

console.log('Cursor service tests passed');
