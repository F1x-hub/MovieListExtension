const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const sharedStyles = read('src/shared/styles/components.css');
const collectionStyles = read('src/shared/styles/collection.css');
const ratingsStyles = read('src/shared/styles/ratings.css');
const settingsStyles = read('src/pages/settings/settings.css');
const navigationStyles = read('src/shared/styles/navigation.css');
const profileStyles = read('src/shared/styles/profile.css');
const themeStyles = read('src/shared/styles/theme.css');
const collectionHtml = read('src/pages/collection/collection.html');
const ratingsHtml = read('src/pages/ratings/ratings.html');
const settingsHtml = read('src/pages/settings/settings.html');

for (const selector of [
    'custom-dropdown',
    'dropdown-trigger',
    'dropdown-list',
    'dropdown-option',
    'sort-control'
]) {
    assert.match(sharedStyles, new RegExp(`\\.${selector}\\s*\\{`));
}

assert.match(sharedStyles, /\.custom-dropdown\.active \.dropdown-list/);

// Settings is the only page still built on the shared dropdown shell.
assert.match(settingsHtml, /class="custom-dropdown"/);
assert.match(settingsHtml, /class="dropdown-trigger"/);
assert.match(settingsHtml, /class="dropdown-option"/);

// The list pages sort through a native select that SortControl enhances.
for (const [name, html] of [
    ['Collection', collectionHtml],
    ['Ratings', ratingsHtml]
]) {
    assert.match(
        html,
        /<select\b(?=[^>]*\bid="sortFilter")(?=[^>]*\bdata-sort-control\b)/,
        `${name} must sort through a native select`
    );
    assert.doesNotMatch(
        html,
        /class="[^"]*\b(?:custom-dropdown|dropdown-trigger|dropdown-list|dropdown-option|filter-select-hidden)\b/,
        `${name} must not bring back the retired dropdown shell`
    );
}

for (const id of ['genreFilter', 'yearFilter', 'userFilter', 'myRatingFilter']) {
    assert.match(
        ratingsHtml,
        new RegExp(`<select\\b(?=[^>]*\\bid="${id}")(?=[^>]*\\bdata-filter-control\\b)`),
        `Ratings must offer ${id} as a native select`
    );
}

for (const [name, styles] of [
    ['Collection', collectionStyles],
    ['Ratings', ratingsStyles]
]) {
    for (const selector of ['custom-dropdown', 'dropdown-trigger', 'dropdown-list', 'dropdown-option', 'sort-control']) {
        assert.doesNotMatch(
            styles,
            new RegExp(`^\\.${selector}\\s*\\{`, 'm'),
            `${name} must not redefine generic .${selector} ownership`
        );
    }
}

for (const [name, styles] of [
    ['Collection', collectionStyles],
    ['Ratings', ratingsStyles]
]) {
    assert.doesNotMatch(
        styles,
        /\.light-theme\s+\.dropdown-(trigger|list|option)/,
        `${name} must scope light-theme dropdown variants`
    );
}

for (const selector of ['custom-dropdown', 'dropdown-trigger', 'dropdown-list', 'dropdown-option']) {
    assert.doesNotMatch(
        settingsStyles,
        new RegExp(`^\\.${selector}\\s*\\{`, 'm'),
        `Settings must not redefine generic .${selector} ownership`
    );
}

for (const [name, styles] of [
    ['Navigation', navigationStyles],
    ['Profile', profileStyles],
    ['Theme', themeStyles]
]) {
    assert.doesNotMatch(styles, /^\.dropdown-item\s*\{/m, `${name} must scope .dropdown-item`);
    assert.doesNotMatch(styles, /^\.dropdown-divider\s*\{/m, `${name} must scope .dropdown-divider`);
}

assert.doesNotMatch(themeStyles, /\.light-theme\s+\.dropdown-item/);
assert.doesNotMatch(themeStyles, /\.light-theme\s+\.dropdown-divider/);

console.log('✅ Shared dropdown owner and page variant contracts passed');
