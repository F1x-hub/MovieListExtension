const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function readProjectFile(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function assertNotPresent(source, pattern, message) {
    assert.doesNotMatch(source, pattern, message);
}

const ratingsHtml = readProjectFile('src/pages/ratings/ratings.html');
const ratingsJs = readProjectFile('src/pages/ratings/ratings.js');
const ratingsCss = readProjectFile('src/shared/styles/ratings.css');
const backgroundJs = readProjectFile('src/background/background.js');

for (const id of ['resultsInfo', 'loadingSection', 'moviesGrid', 'emptyState', 'errorState']) {
    assert.match(ratingsHtml, new RegExp(`id=["']${id}["']`), `Ratings page must keep ${id}`);
}

assert.match(ratingsHtml, /id=["']ratingModal["']/, 'Ratings page must keep ratingModal');
assert.doesNotMatch(ratingsHtml, /id=["']movieModal["']/, 'The unused movie details modal stays removed');

for (const pattern of [
    /<canvas\b/i,
    /sphereViewBtn/i,
    /sphereView/i,
    /sphereCanvas/i,
    /ratings-sphere/i,
    />\s*Фокус\s*</i
]) {
    assertNotPresent(ratingsHtml, pattern, `Retired Focus markup must be absent: ${pattern}`);
}

for (const pattern of [
    /RatingsSphere/,
    /sphereView/i,
    /sphereSelectedMovie/i,
    /sphereSelectionLocked/i,
    /syncSphereView/i,
    /setViewMode/i,
    /RATINGS_FETCH_POSTER/,
    /RATINGS_CANCEL_POSTER/
]) {
    assertNotPresent(ratingsJs, pattern, `Retired Focus wiring must be absent: ${pattern}`);
}

assert.match(ratingsJs, /this\.createMovieCard\(movieData\)/, 'Ratings must keep the ordinary card path');
// Movie details open through Utils.bindMovieCardNavigation; the never-called
// showMovieDetails() modal path was removed as dead code.
assert.doesNotMatch(ratingsJs, /showMovieDetails\(/, 'The dead details modal path stays removed');
assert.match(ratingsJs, /Utils\.bindMovieCardNavigation\(this\.elements\.moviesGrid\)/, 'Ratings opens details through card navigation');
assert.match(ratingsJs, /editRating\(/, 'Ratings must keep the ordinary rating path');

assertNotPresent(ratingsCss, /ratings-sphere-/i, 'Sphere CSS must be absent');
assertNotPresent(ratingsCss, /ratings-view-toggle/i, 'Retired view-toggle CSS must be absent');
assertNotPresent(backgroundJs, /RATINGS_FETCH_POSTER|RATINGS_CANCEL_POSTER/i, 'Retired poster messages must be absent');
assert.match(
    backgroundJs,
    /caches\.delete\(RETIRED_RATINGS_CACHE_NAME\)/,
    'Retired sphere cache must be explicitly deleted'
);
assertNotPresent(backgroundJs, /caches\.open\(/, 'Retired sphere cache must not be recreated');

assert.equal(
    fs.existsSync(path.join(projectRoot, 'src/pages/ratings/ratings-sphere.js')),
    false,
    'Retired sphere renderer must not exist'
);

console.log('Ratings page retirement contract tests passed');
