const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = require(path.join(root, 'src/shared/config/rating.config.js'));

assert.equal(config.SHORT_COMMENT_MAX_LENGTH, 500);
assert.equal(config.LONG_REVIEW_MAX_LENGTH, 5000);
assert.equal(config.normalizeReview('  а\r\nб  '), 'а\nб');
assert.equal(config.getLength('🙂'.repeat(5000)), 5000);
assert.throws(() => config.normalizeReview('x'.repeat(5001)), /5000/);

const serviceSource = fs.readFileSync(path.join(root, 'src/shared/services/RatingService.js'), 'utf8');
assert.match(serviceSource, /updateRatingText/);
assert.match(serviceSource, /contentUpdatedAt/);
assert.match(serviceSource, /includeReview/);
assert.match(serviceSource, /Object\.prototype\.hasOwnProperty\.call\(options, 'review'\)/);

const cacheSource = fs.readFileSync(path.join(root, 'src/shared/services/RatingsCacheService.js'), 'utf8');
const adminCacheSource = fs.readFileSync(path.join(root, 'src/shared/services/AdminRatingsCacheService.js'), 'utf8');
assert.match(cacheSource, /delete safeRating\.review/);
assert.match(cacheSource, /CACHE_SCHEMA_VERSION = 2/);
assert.match(adminCacheSource, /delete safeRating\.review/);
assert.match(adminCacheSource, /RATINGS_CACHE_SCHEMA_VERSION = 2/);
assert.match(adminCacheSource, /hasReview: review\.length > 0/);

const rulesSource = fs.readFileSync(path.join(root, 'rules/firestore.rules'), 'utf8');
assert.match(rulesSource, /data\.review is string/);
assert.match(rulesSource, /data\.review\.size\(\) <= 5000/);
assert.match(rulesSource, /isValidReviewReport/);
assert.match(rulesSource, /rating-review/);

const backgroundSource = fs.readFileSync(path.join(root, 'src/background/background.js'), 'utf8');
assert.match(backgroundSource, /normalizeReview\(review\)/);
assert.match(backgroundSource, /hasReview/);

const reportWidgetSource = fs.readFileSync(path.join(root, 'src/shared/components/ReportWidget.js'), 'utf8');
const firestoreSource = fs.readFileSync(path.join(root, 'src/shared/firestore.js'), 'utf8');
assert.match(reportWidgetSource, /openForContext/);
assert.match(reportWidgetSource, /this\.reportContext/);
assert.match(firestoreSource, /targetRatingId/);
assert.doesNotMatch(firestoreSource, /targetReview/);

const htmlFiles = [];
function collectHtml(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) collectHtml(fullPath);
        else if (entry.name.endsWith('.html')) htmlFiles.push(fullPath);
    }
}
collectHtml(path.join(root, 'src'));
const pagesUsingRatingService = htmlFiles.filter(file => fs.readFileSync(file, 'utf8').includes('RatingService.js'));
assert.ok(pagesUsingRatingService.length > 0);
for (const file of pagesUsingRatingService) {
    const html = fs.readFileSync(file, 'utf8');
    assert.ok(
        html.indexOf('rating.config.js') < html.indexOf('RatingService.js'),
        `${path.relative(root, file)} must load rating.config.js before RatingService.js`
    );
}

const movieCardSource = fs.readFileSync(path.join(root, 'src/shared/components/MovieCard.js'), 'utf8');
assert.match(movieCardSource, /data\.hasReview/);
assert.match(movieCardSource, /data-action="open-review"/);
assert.doesNotMatch(movieCardSource, /data-review=/);

const detailsHtml = fs.readFileSync(path.join(root, 'src/pages/movie-details/movie-details.html'), 'utf8');
assert.match(detailsHtml, /ratingReview/);
assert.match(detailsHtml, /reviewReaderModal/);

console.log('Rating review contract tests passed');
