const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalogHtml = fs.readFileSync(
    path.join(__dirname, '../src/pages/catalog/catalog.html'),
    'utf8'
);

assert.match(catalogHtml, /shared\/components\/ReportWidget\.js/);
assert.match(catalogHtml, /shared\/styles\/report-widget\.css/);

console.log('✅ Catalog ReportWidget script and stylesheet contract passed');
