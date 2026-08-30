const assert = require('assert');
const fs = require('fs');
const IconUtils = require('../src/shared/utils/IconUtils.js');

const canonicalIcon = 'src/shared/assets/icons/app/icon48-white.png';
const pagesWithFormerBrokenFallbacks = [
    'src/pages/admin/admin.js',
    'src/pages/search/search.js',
];

assert.ok(fs.existsSync(canonicalIcon), `Missing fallback icon asset: ${canonicalIcon}`);
assert.strictEqual(IconUtils.getIconPath('dark', 48), '/src/shared/assets/icons/app/icon48-white.png');
assert.strictEqual(IconUtils.getIconPath('light', 48), '/src/shared/assets/icons/app/icon48-black.png');

for (const file of pagesWithFormerBrokenFallbacks) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /(?:chrome\.runtime\.getURL\()?['"]\/?icons\/icon48\.png['"]\)?/);
    assert.match(source, /IconUtils\.getCurrentThemeIconPath\(48\)/);
}

console.log('Icon fallback contract tests passed');
