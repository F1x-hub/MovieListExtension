// Build-time page bundling: order, run boundaries, preload cleanup and refusals.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { bundlePage, findDeferRuns, hasRelativeDynamicImport } = require('../scripts/bundle-pages.js');

function fixture(files, html) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-pages-'));
    for (const [name, code] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), code);
    }
    const page = path.join(dir, 'page', 'page.html');
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(page, html);
    return { dir, page };
}

const log = name => `globalThis.order = (globalThis.order || []).concat('${name}')`;
const files = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(name => [`lib/${name}.js`, `${log(name)}\n`]));
files['lib/nav.js'] = `${log('nav')}\nconst load = () => import('./lazy.js');\n`;
files['lib/no-semicolon.js'] = `${log('x')}\nvar tail = 1`;
files['lib/next.js'] = `(${log('next')})\n`;

const html = `<!doctype html><html><head>
<link rel="preload" as="script" href="../lib/a.js">
<link rel="stylesheet" href="x.css">
<script defer src="../lib/stepper.js"></script>
<script src="../lib/sync.js"></script>
</head><body>
<script defer src="../lib/a.js"></script>
<script defer src="../lib/b.js"></script>
<!-- comment between tags keeps the run -->
<script defer src="../lib/c.js"></script>
<script defer src="../lib/no-semicolon.js"></script>
<script defer src="../lib/next.js"></script>
<script defer src="../lib/nav.js"></script>
<script defer src="../lib/d.js"></script>
<script defer src="../lib/e.js"></script>
<script defer src="../lib/f.js"></script>
<script defer src="../lib/g.js"></script>
<script defer src="../lib/h.js"></script>
<script type="module" src="../lib/module.js"></script>
<script defer src="../lib/after.js"></script>
</body></html>`;

// Runs stop at module, non-deferred and vetoed scripts.
{
    const runs = findDeferRuns(html, src => !src.endsWith('nav.js')).map(run => run.map(item => item.src));
    assert.deepEqual(runs, [
        ['../lib/stepper.js'],
        ['../lib/a.js', '../lib/b.js', '../lib/c.js', '../lib/no-semicolon.js', '../lib/next.js'],
        ['../lib/d.js', '../lib/e.js', '../lib/f.js', '../lib/g.js', '../lib/h.js'],
        ['../lib/after.js']
    ]);
}

assert.equal(hasRelativeDynamicImport("import('./x.js')"), true);
assert.equal(hasRelativeDynamicImport('import(`../x.js`)'), true);
assert.equal(hasRelativeDynamicImport("import('https://cdn.test/x.js')"), false);
assert.equal(hasRelativeDynamicImport("const important = 1; // import is fine"), false);

// Bundles keep document order, the relative-import file stays separate, preloads go.
{
    const { dir, page } = fixture(files, html);
    const written = bundlePage(page);
    assert.deepEqual(written.map(item => path.basename(item.bundlePath)), ['page.bundle-1.js', 'page.bundle-2.js']);
    const out = fs.readFileSync(page, 'utf8');
    const tags = [...out.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)].map(match => match[1]);
    assert.deepEqual(tags, ['../lib/stepper.js', '../lib/sync.js', 'page.bundle-1.js', '../lib/nav.js',
        'page.bundle-2.js', '../lib/module.js', '../lib/after.js']);
    assert.doesNotMatch(out, /rel="preload"[^>]*a\.js/, 'A preload of a bundled file is removed');
    assert.match(out, /rel="stylesheet"/, 'Other links stay');

    // Executing the bundles in tag order reproduces the original order, and a file
    // without a trailing semicolon cannot swallow the next file's leading paren.
    const context = vm.createContext({});
    for (const name of ['page.bundle-1.js', 'page.bundle-2.js']) {
        vm.runInContext(fs.readFileSync(path.join(dir, 'page', name), 'utf8'), context);
    }
    assert.deepEqual([...context.order], ['a', 'b', 'c', 'x', 'next', 'd', 'e', 'f', 'g', 'h']);
    fs.rmSync(dir, { recursive: true, force: true });
}

// Files whose behaviour depends on being their own script refuse to bundle.
for (const code of ["'use strict';\nvar a = 1;", '/* header */\n"use strict"\nvar a;', 'var me = document.currentScript;']) {
    const strictFiles = Object.fromEntries(['a', 'b', 'c', 'd'].map(name => [`lib/${name}.js`, 'var ok = 1;\n']));
    strictFiles['lib/e.js'] = code;
    const body = ['a', 'b', 'c', 'd', 'e'].map(name => `<script defer src="../lib/${name}.js"></script>`).join('\n');
    const { dir, page } = fixture(strictFiles, `<body>\n${body}\n</body>`);
    assert.throws(() => bundlePage(page), /use strict|currentScript/);
    fs.rmSync(dir, { recursive: true, force: true });
}

// Short runs are left alone.
{
    const shortFiles = { 'lib/a.js': 'var a;', 'lib/b.js': 'var b;' };
    const { dir, page } = fixture(shortFiles, '<body><script defer src="../lib/a.js"></script><script defer src="../lib/b.js"></script></body>');
    assert.deepEqual(bundlePage(page), []);
    assert.match(fs.readFileSync(page, 'utf8'), /lib\/a\.js/);
    fs.rmSync(dir, { recursive: true, force: true });
}

console.log('Page bundling: order, boundaries, preloads and refusals passed.');
