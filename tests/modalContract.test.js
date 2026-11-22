const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const sharedStyles = read('src/shared/styles/components.css');
const ratingsStyles = read('src/shared/styles/ratings.css');
const ratingsHtml = read('src/pages/ratings/ratings.html');
const adminStyles = read('src/shared/styles/admin.css');
const adminHtml = read('src/pages/admin/admin.html');
const profileStyles = read('src/shared/styles/profile.css');
const profileHtml = read('src/pages/profile/profile.html');
const searchStyles = read('src/shared/styles/search.css');
const searchHtml = read('src/pages/search/search.html');
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

// Ratings and Movie Details rate a film in the one shared dialog (RatingDialog.js),
// which builds its own modal markup; neither page carries a rating dialog of its own.
const ratingDialogJs = read('src/shared/components/RatingDialog.js');
assert.match(ratingDialogJs, /root\.className = 'modal-overlay rating-dialog-overlay'/);
assert.match(ratingDialogJs, /root\.setAttribute\('aria-labelledby', 'ratingModalTitle'\)/);
for (const html of [ratingsHtml, read('src/pages/movie-details/movie-details.html')]) {
    assert.doesNotMatch(html, /id="ratingModal"/);
    assert.match(html, /shared\/components\/RatingDialog\.js/);
}
assert.doesNotMatch(ratingsHtml, /ratings-detail-modal|id="movieModal"/);
assert.doesNotMatch(ratingsStyles, /\.ratings-detail-modal/);

for (const selector of ['modal-overlay', 'modal-content', 'modal-header', 'modal-title', 'modal-close', 'modal-body', 'modal-footer']) {
    assert.doesNotMatch(
        ratingsStyles,
        new RegExp(`^\\.${selector}\\s*\\{`, 'm'),
        `Ratings must not redefine generic .${selector} ownership`
    );
}

// Search opens films on Movie Details; its own film and player dialogs were unreachable and are gone.
assert.doesNotMatch(searchHtml, /id="movieModal"|id="videoPlayerModal"|search-detail-modal/,
    'Search must not carry the unreachable film and player dialogs');
assert.doesNotMatch(searchStyles, /\.search-detail-modal\b/);

for (const selector of ['modal', 'modal-body', 'modal-close']) {
    assert.doesNotMatch(
        searchStyles,
        new RegExp(`^\\.${selector}\\s*\\{`, 'm'),
        `Search must not redefine generic .${selector} ownership`
    );
}

// Admin confirmations use the shared ConfirmDialog; the API-key form is its own dialog.
assert.match(adminHtml, /class="modal-overlay provider-key-modal"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(adminHtml, /class="modal provider-key-dialog"/);
assert.match(adminStyles, /\.provider-key-dialog\s*\{/);

for (const selector of ['modal-header', 'modal-close', 'modal-body', 'modal-footer']) {
    assert.doesNotMatch(
        adminStyles,
        new RegExp(`^\\.${selector}\\s*\\{`, 'm'),
        `Admin must not redefine generic .${selector} ownership`
    );
}

// Nothing opened Search's rating dialog, so it was removed. Ratings and Movie
// Details own the rating dialogs people can reach.
assert.doesNotMatch(searchHtml, /id="ratingModal"|id="saveRatingBtn"/, 'Search must not carry an unreachable rating dialog');

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
