const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const sharedStyles = read('src/shared/styles/components.css');
const collectionStyles = read('src/shared/styles/collection.css');
const collectionHtml = read('src/pages/collection/collection.html');
const ratingsStyles = read('src/shared/styles/ratings.css');
const ratingsHtml = read('src/pages/ratings/ratings.html');
const adminStyles = read('src/shared/styles/admin.css');
const adminHtml = read('src/pages/admin/admin.html');
const profileStyles = read('src/shared/styles/profile.css');
const profileHtml = read('src/pages/profile/profile.html');
const searchStyles = read('src/shared/styles/search.css');
const searchHtml = read('src/pages/search/search.html');
const favoritesStyles = read('src/shared/styles/favorites.css');
const favoritesHtml = read('src/pages/favorites/favorites.html');
const watchlistStyles = read('src/shared/styles/watchlist.css');
const watchlistHtml = read('src/pages/watchlist/watchlist.html');
const watchingHtml = read('src/pages/watching/watching.html');
const movieDetailsStyles = read('src/pages/movie-details/movie-details.css');
const overflowFixesStyles = read('src/shared/styles/overflow-fixes.css');

for (const selector of [
    'modal-overlay',
    'modal',
    'modal-header',
    'modal-close',
    'modal-body',
    'modal-footer'
]) {
    assert.match(sharedStyles, new RegExp(`\\.${selector}\\s*\\{`));
}

assert.match(collectionHtml, /class="modal-overlay"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(collectionHtml, /class="modal collection-modal"/);
assert.match(collectionStyles, /\.collection-modal(?:\s|\.)/);

for (const selector of ['modal-overlay', 'modal-content', 'modal-header', 'modal-close', 'modal-body', 'modal-footer']) {
    assert.doesNotMatch(
        collectionStyles,
        new RegExp(`^\\.${selector}\\s*\\{`, 'm'),
        `Collection must not redefine generic .${selector} ownership`
    );
}

assert.match(ratingsHtml, /class="modal-overlay ratings-modal-overlay"/);
assert.match(ratingsHtml, /class="modal ratings-detail-modal"/);
assert.match(ratingsStyles, /\.ratings-detail-modal(?:\s|\.)/);

for (const selector of ['modal-overlay', 'modal-content', 'modal-header', 'modal-title', 'modal-close', 'modal-body', 'modal-footer']) {
    assert.doesNotMatch(
        ratingsStyles,
        new RegExp(`^\\.${selector}\\s*\\{`, 'm'),
        `Ratings must not redefine generic .${selector} ownership`
    );
}

assert.match(searchHtml, /class="modal search-detail-modal"/);
assert.match(searchHtml, /id="ratingModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(searchHtml, /id="videoPlayerModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(searchStyles, /\.search-detail-modal(?:\s|\.)/);

for (const selector of ['modal', 'modal-body', 'modal-close']) {
    assert.doesNotMatch(
        searchStyles,
        new RegExp(`^\\.${selector}\\s*\\{`, 'm'),
        `Search must not redefine generic .${selector} ownership`
    );
}

assert.match(adminHtml, /class="modal-overlay"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(adminHtml, /class="modal delete-modal"/);
assert.match(adminStyles, /\.delete-modal(?:\s|\.)/);

for (const selector of ['modal-header', 'modal-close', 'modal-body', 'modal-footer']) {
    assert.doesNotMatch(
        adminStyles,
        new RegExp(`^\\.${selector}\\s*\\{`, 'm'),
        `Admin must not redefine generic .${selector} ownership`
    );
}

assert.match(favoritesHtml, /class="modal limit-modal"/);
assert.match(favoritesHtml, /class="modal rating-modal"/);
assert.match(watchlistHtml, /class="modal rating-modal"/);
assert.match(watchingHtml, /class="modal rating-modal"/);

for (const [name, styles] of [['Favorites', favoritesStyles], ['Watchlist', watchlistStyles]]) {
    for (const selector of ['modal-content', 'modal-header', 'modal-title', 'modal-close', 'modal-body', 'modal-footer']) {
        assert.doesNotMatch(
            styles,
            new RegExp(`^\\.${selector}\\s*\\{`, 'm'),
            `${name} must not redefine generic .${selector} ownership`
        );
    }
}

const movieDetailsHtml = read('src/pages/movie-details/movie-details.html');
assert.match(movieDetailsHtml, /class="modal-overlay movie-details-modal-overlay"/);
assert.match(movieDetailsStyles, /\.movie-details-modal-overlay\s*\{/);
assert.doesNotMatch(movieDetailsStyles, /^\.modal-overlay\s*\{/m);
assert.doesNotMatch(overflowFixesStyles, /^\.modal\s*\{/m);
assert.doesNotMatch(overflowFixesStyles, /^\.modal-body\s*\{/m);

assert.match(profileHtml, /class="modal-overlay profile-modal-overlay"/);
assert.match(profileHtml, /class="modal profile-modal edit-profile-modal"/);
assert.match(profileHtml, /class="modal profile-modal cropper-modal"/);
assert.match(profileStyles, /\.profile-modal(?:\s|\.)/);

for (const selector of ['modal-overlay', 'modal-content', 'modal-header', 'modal-title', 'modal-close', 'modal-body', 'modal-footer']) {
    assert.doesNotMatch(
        profileStyles,
        new RegExp(`^\\.${selector}\\s*\\{`, 'm'),
        `Profile must not redefine generic .${selector} ownership`
    );
}

console.log('✅ Shared modal owner and page variant contracts passed');
