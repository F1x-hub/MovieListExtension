const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { stripSourceMaps } = require('../scripts/strip-source-maps.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'movielist-strip-maps-'));
const write = (name, content) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
};
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

try {
    write('app.js', 'const a=1;\n//# sourceMappingURL=app.js.map');
    write('app.js.map', '{"version":3}');
    write('pages/home/home.bundle-1.js', 'const b=2;\r\n//# sourceMappingURL=home.bundle-1.js.map\r\n');
    write('pages/home/home.bundle-1.js.map', '{"version":3,"mappings":"AAAA"}');
    write('libs/vendor.min.js', 'var v=3;');
    // The same text inside code is not a reference and must survive untouched.
    write('literal.js', 'const marker="//# sourceMappingURL=x.js.map";');
    write('earlier.js', '//# sourceMappingURL=first.js.map\nconst c=4;');
    write('data/vocabulary.json', '{"note":"//# sourceMappingURL=data.map"}');

    const removed = stripSourceMaps(root);

    assert.deepEqual(
        { maps: removed.maps, references: removed.references },
        { maps: 2, references: 2 }
    );
    assert.equal(removed.bytes, '{"version":3}'.length + '{"version":3,"mappings":"AAAA"}'.length);
    assert.equal(fs.existsSync(path.join(root, 'app.js.map')), false);
    assert.equal(fs.existsSync(path.join(root, 'pages/home/home.bundle-1.js.map')), false);
    assert.equal(read('app.js'), 'const a=1;\n');
    assert.equal(read('pages/home/home.bundle-1.js'), 'const b=2;\r\n');
    assert.equal(read('libs/vendor.min.js'), 'var v=3;');
    assert.equal(read('literal.js'), 'const marker="//# sourceMappingURL=x.js.map";');
    assert.equal(read('earlier.js'), '//# sourceMappingURL=first.js.map\nconst c=4;',
        'only a reference on the last line is a source-map trailer');
    assert.equal(read('data/vocabulary.json'), '{"note":"//# sourceMappingURL=data.map"}');

    // A second pass finds nothing left to remove.
    assert.deepEqual(stripSourceMaps(root), { maps: 0, bytes: 0, references: 0 });
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

const packageScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'package-release.js'), 'utf8');
assert.ok(
    packageScript.indexOf("require('./strip-source-maps.cjs').stripSourceMaps(dist)")
        < packageScript.indexOf("run('tar', ['-a', '-c', '-f', assetPath"),
    'source maps must be removed before the release archive is created'
);
assert.ok(packageScript.indexOf("require('./strip-source-maps.cjs').stripSourceMaps(dist)") > 0);
assert.match(packageScript, /source maps remain in dist after stripping/);

console.log('stripSourceMaps.test.cjs passed');
