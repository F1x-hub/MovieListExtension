const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { extractMoviePageRatingsFromDOM } = require('../content-scripts/kinopoisk-search-scraper.js');

const directMarkup = `
  <main>
    <div data-tid="kp-movie-rating.rating-value">
      <span aria-hidden="true">7,5</span>
    </div>
    <div data-tid="kp-movie-rating"><span class="rating-count">3.7k оценок</span></div>
    <section data-testid="rating-imdb">
      <span aria-hidden="true">6.2</span>
      <span class="vote-count">645k votes</span>
    </section>
    <a href="https://www.imdb.com/title/tt1234567/">IMDb</a>
  </main>
`;

const directRatings = extractMoviePageRatingsFromDOM(new JSDOM(directMarkup).window.document);
assert.equal(directRatings.kpRating, 7.5);
assert.equal(directRatings.imdbRating, 6.2);
assert.equal(directRatings.kpVotes, 3700);
assert.equal(directRatings.imdbVotes, 645000);
assert.equal(directRatings.imdbId, 'tt1234567');

const hydratedKinopoiskMarkup = `
  <div class="film-rating">
    <span data-tid="kp-movie-rating.rating-value"><span aria-hidden="true">5.9</span></span>
    <div class="styles_countBlock"><span class="styles_count">3 663 оценки</span></div>
  </div>
  <div data-tid="3d4f49c8" class="film-sub-rating">
    <span class="styles_valueSection">IMDb: 6.70</span>
    <span class="styles_count__XJaJv">13 136 оценок</span>
  </div>
`;

const hydratedRatings = extractMoviePageRatingsFromDOM(new JSDOM(hydratedKinopoiskMarkup).window.document);
assert.equal(hydratedRatings.kpVotes, 3663);
assert.equal(hydratedRatings.imdbVotes, 13136);

const labelledMarkup = `
  <div data-testid="ratings">
    <span>IMDb</span>
    <strong>8,1</strong>
  </div>
`;

const labelledRatings = extractMoviePageRatingsFromDOM(new JSDOM(labelledMarkup).window.document);
assert.equal(labelledRatings.imdbRating, 8.1);

console.log('✅ Kinopoisk movie-page parser extracts KP and IMDb ratings without visible tabs');
