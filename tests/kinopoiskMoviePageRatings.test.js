const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { extractMoviePageRatingsFromDOM, parseRequestHash, isEmptySearchPage } = require('../content-scripts/kinopoisk-search-scraper.js');

// A title that is not on Kinopoisk is an answer: the frame does not wait out its timeout.
assert.equal(isEmptySearchPage(new JSDOM('<h2 class="styles_title__MFWNV">К сожалению, по вашему запросу ничего не найдено...</h2><h3>Билеты в кино</h3>').window.document), true);
assert.equal(isEmptySearchPage(new JSDOM('<h2>Результаты поиска</h2><h3>Билеты в кино</h3>').window.document), false);
assert.equal(isEmptySearchPage(new JSDOM('<div class="styles_empty__abc"></div>').window.document), true);

// Kinopoisk adds to the hash of a signed-in user's page. The worker ignores a result sent
// under any ID but its own, so the ID must survive whatever follows it.
assert.equal(parseRequestHash('#agy_req_1794018145388_ulkfaq'), '1794018145388_ulkfaq');
assert.equal(parseRequestHash('#agy_req_1794018145388_ulkfaq?socialAlias=MTIz'), '1794018145388_ulkfaq');
assert.equal(parseRequestHash('#agy_req_1794018145388_ulkfaq&agy_rating_1'), '1794018145388_ulkfaq');
assert.equal(parseRequestHash('#agy_req_1794018145388_ulkfaq&agy_rating_1?socialAlias=MTIz'), '1794018145388_ulkfaq');
// A page the owner opened carries no request: nothing there may answer the worker.
assert.equal(parseRequestHash(''), '');
assert.equal(parseRequestHash('#reviews'), '');
assert.equal(parseRequestHash(undefined), '');

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
