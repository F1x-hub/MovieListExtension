'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Icons.js holds what the generator draws.
execFileSync(process.execPath, [path.join(root, 'scripts/icon-set/build.cjs'), '--check'], { stdio: 'pipe' });

const drawings = require('../scripts/icon-set/icons.cjs');
const Icons = require('../src/shared/utils/Icons.js');
const navigation = read('src/shared/components/Navigation.js');

for (const name of Object.keys(drawings)) {
    const svg = Icons[name];
    assert.ok(svg, `${name} is in the shared set`);
    assert.doesNotMatch(svg, /\b(id|mask|clip-path|filter)=|url\(|NaN|undefined/, `${name} is plain paths, safe to repeat on a page`);
    assert.doesNotMatch(svg, /(fill|stroke)="(?!currentColor|none)/, `${name} takes its color from the text`);
    assert.match(svg, /viewBox="0 0 20 20"/, `${name} sits on the 20px grid`);
}

// The header draws from the shared set only, so every page with the header must load it.
const used = [...navigation.matchAll(/this\.icon\('([A-Z_]+)'\)/g)].map(match => match[1]);
assert.ok(used.length >= 15, 'the header uses the shared icons');
used.forEach(name => assert.ok(Icons[name], `the header asks for an existing icon: ${name}`));

const pages = fs.readdirSync(path.join(root, 'src/pages'), { recursive: true })
    .map(file => path.join('src/pages', String(file)))
    .filter(file => file.endsWith('.html'));
const withHeader = pages.filter(file => /<script[^>]+components\/Navigation\.js/.test(read(file)));
assert.ok(withHeader.length > 10, 'pages with the header were found');
withHeader.forEach(file => assert.match(read(file), /<script[^>]+utils\/Icons\.js/, `${file} loads Icons.js for its header`));

console.log(`Icon set tests passed (${Object.keys(drawings).length} icons, ${withHeader.length} pages)`);
