const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const sharedStyles = read('src/shared/styles/components.css');
const collectionStyles = read('src/shared/styles/collection.css');
const watchlistStyles = read('src/shared/styles/watchlist.css');
const favoritesStyles = read('src/shared/styles/favorites.css');
const ratingsStyles = read('src/shared/styles/ratings.css');
const settingsStyles = read('src/pages/settings/settings.css');
const navigationStyles = read('src/shared/styles/navigation.css');
const profileStyles = read('src/shared/styles/profile.css');
const themeStyles = read('src/shared/styles/theme.css');
const collectionHtml = read('src/pages/collection/collection.html');
const watchlistHtml = read('src/pages/watchlist/watchlist.html');
const favoritesHtml = read('src/pages/favorites/favorites.html');
const ratingsHtml = read('src/pages/ratings/ratings.html');
const settingsHtml = read('src/pages/settings/settings.html');

for (const selector of [
    'custom-dropdown',
    'dropdown-trigger',
    'dropdown-list',
    'dropdown-option',
    'filter-select-hidden'
]) {
    assert.match(sharedStyles, new RegExp(`\\.${selector}\\s*\\{`));
}

assert.match(sharedStyles, /\.custom-dropdown\.open \.dropdown-list/);
assert.match(sharedStyles, /\.custom-dropdown\.active \.dropdown-list/);
assert.match(collectionHtml, /class="custom-dropdown"/);
assert.match(watchlistHtml, /class="custom-dropdown"/);
assert.match(favoritesHtml, /class="custom-dropdown"/);
assert.match(ratingsHtml, /class="custom-dropdown"/);
assert.match(settingsHtml, /class="dropdown-trigger"/);
assert.match(settingsHtml, /class="dropdown-option"/);

for (const [name, styles] of [
    ['Collection', collectionStyles],
    ['Watchlist', watchlistStyles],
    ['Favorites', favoritesStyles],
    ['Ratings', ratingsStyles]
]) {
    for (const selector of ['custom-dropdown', 'dropdown-trigger', 'dropdown-list', 'dropdown-option', 'filter-select-hidden']) {
        assert.doesNotMatch(
            styles,
            new RegExp(`^\\.${selector}\\s*\\{`, 'm'),
            `${name} must not redefine generic .${selector} ownership`
        );
    }
}

for (const [name, styles] of [
    ['Collection', collectionStyles],
    ['Watchlist', watchlistStyles],
    ['Favorites', favoritesStyles],
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
