const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const sharedStyles = read('src/shared/styles/components.css');
const popupStyles = read('src/shared/styles/popup.css');
const popupScript = read('src/popup/popup.js');
const searchStyles = read('src/shared/styles/search.css');
const profileStyles = read('src/shared/styles/profile.css');
const popupHtml = read('src/popup/popup.html');
const searchHtml = read('src/pages/search/search.html');

assert.match(sharedStyles, /\.menu-item\s*\{/);
assert.match(sharedStyles, /\.menu-item:hover\s*\{/);
assert.match(sharedStyles, /\.menu-icon\s*\{/);
assert.match(sharedStyles, /\.tooltip-surface\s*\{/);
assert.match(sharedStyles, /\.popover-surface\s*\{/);

assert.match(popupScript, /class="tooltip-surface average-score-tooltip"/);
assert.match(popupStyles, /\.rating-menu-dropdown \.menu-item/);
assert.match(searchStyles, /\.user-rating-menu-dropdown \.menu-item/);
assert.match(popupScript, /class="popover-surface rating-menu-dropdown"/);
assert.match(searchStyles, /--popover-surface-backdrop:\s*none/);
assert.match(searchStyles, /\.user-rating-menu-dropdown\s*\{/);
assert.match(popupHtml, /href="\.\.\/shared\/styles\/components\.css"/);
assert.match(searchHtml, /href="\.\.\/\.\.\/shared\/styles\/components\.css"/);
assert.doesNotMatch(popupStyles, /@import\s+url\([^)]*common\.css\)/);
assert.doesNotMatch(popupStyles, /@import\s+url\([^)]*components\.css\)/);
assert.doesNotMatch(searchStyles, /@import\s+url\([^)]*common\.css\)/);
assert.doesNotMatch(searchStyles, /@import\s+url\([^)]*components\.css\)/);

for (const [name, styles] of [['Popup', popupStyles], ['Search', searchStyles]]) {
    assert.doesNotMatch(styles, /^\.menu-item\s*\{/m, `${name} must not own generic .menu-item`);
    assert.doesNotMatch(styles, /^\.menu-icon\s*\{/m, `${name} must not own generic .menu-icon`);
}

assert.doesNotMatch(popupStyles, /^\.dropdown-item\s*\{/m, 'Popup must not own generic .dropdown-item');
assert.doesNotMatch(popupStyles, /^\.dropdown-divider\s*\{/m, 'Popup must not own generic .dropdown-divider');
assert.doesNotMatch(profileStyles, /^\.menu-icon\s*\{/m, 'Profile must scope .menu-icon');

const tooltipBlock = popupStyles.match(/\.average-score-tooltip\s*\{([\s\S]*?)\}/)?.[1] || '';
for (const property of ['background', 'border', 'border-radius', 'box-shadow', 'backdrop-filter']) {
    assert.doesNotMatch(
        tooltipBlock,
        new RegExp(`(^|\\n)\\s*${property}\\s*:`),
        `Popup tooltip surface must inherit ${property} from shared owner`
    );
}

console.log('✅ Shared popup menu and tooltip surface contracts passed');
