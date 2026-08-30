const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { extractSimilarMoviesFromDOM } = require('../content-scripts/kinopoisk-search-scraper.js');

function parse(markup, url) {
    const dom = new JSDOM(markup, { url });
    const previousWindow = global.window;
    global.window = dom.window;
    try {
        return extractSimilarMoviesFromDOM(dom.window.document);
    } finally {
        global.window = previousWindow;
    }
}

const modernMarkup = `
  <section class="similar-films-block similar-movies-block_root__qt3MU">
    <div role="list">
      <div role="listitem">
        <a class="styles_posterLink__Dv8JT" href="/film/468466/">
          <img src="//avatars.mds.yandex.net/get-kinopoisk-image/1629390/17f0480e-220c-4ff5-a7a6-1003ffbf18dd/150x225" srcset="//avatars.mds.yandex.net/get-kinopoisk-image/1629390/17f0480e-220c-4ff5-a7a6-1003ffbf18dd/150x225 1x, //avatars.mds.yandex.net/get-kinopoisk-image/1629390/17f0480e-220c-4ff5-a7a6-1003ffbf18dd/280x420 2x">
        </a>
        <a class="styles_captions__RVmaa" href="/film/468466/">
          <span class="styles_title__tS7Ds"><span>Гравитация</span></span>
          <span class="styles_subtitle__1zjFk">2013, фантастика</span>
        </a>
        <div class="styles_ratingPosterNameplate__65eRk"><span aria-hidden="true">7.4</span></div>
      </div>
      <div role="listitem">
        <a class="styles_posterLink__Dv8JT" href="/series/574690/">
          <img src="//avatars.mds.yandex.net/get-kinopoisk-image/10953618/9b4bab5b-ef3d-478d-858a-6c09c55e0c56/150x225">
        </a>
        <a class="styles_captions__RVmaa" href="/series/574690/">
          <span class="styles_title__tS7Ds"><span>Великий Человек-паук</span></span>
          <span class="styles_subtitle__1zjFk">2012, мультфильм</span>
        </a>
        <div class="styles_ratingPosterNameplate__65eRk"><span aria-hidden="true">7.3</span></div>
      </div>
      <div role="listitem"><a href="/film/258687/like/">Показать все</a></div>
    </div>
  </section>`;

const modernItems = parse(modernMarkup, 'https://www.kinopoisk.ru/film/258687/');
assert.equal(modernItems.length, 2);
assert.deepEqual(modernItems.map(item => item.kinopoiskId), [468466, 574690]);
assert.equal(modernItems[0].mediaType, 'movie');
assert.equal(modernItems[1].mediaType, 'tv');
assert.equal(modernItems[0].posterUrl, 'https://avatars.mds.yandex.net/get-kinopoisk-image/1629390/17f0480e-220c-4ff5-a7a6-1003ffbf18dd/600x900');
assert.equal(modernItems[0].kpRating, 7.4);
assert.equal(modernItems[0].sourcePosition, 0);
assert.equal(modernItems[1].sourcePosition, 1);
console.log('✅ Modern Kinopoisk similar carousel parsing preserves order, IDs, type, poster and rating');

const legacyMarkup = `
  <table class="ten_items">
    <tr id="tr_278217">
      <td><a id="film_img_278217" href="/film/278217/"><img src="https://st.kp.yandex.net/images/sm_film/278217.jpg"></a></td>
      <td class="news">
        <div><div><a class="all" href="/film/278217/">Новый Человек-паук</a>
          <span>The Amazing Spider-Man, (2012) <nobr>131 мин.</nobr></span></div>
          <span class="gray_text">США, (фантастика, боевик, приключения)</span>
        </div>
      </td>
      <td><div id="film_votes_278217" value="6.953"><div class="numVoteRecomm"><span class="all">6.953 (410 046)</span></div></div>IMDb: 6.90</td>
    </tr>
    <tr id="tr_574690">
      <td><a id="film_img_574690" href="/series/574690/"><img src="https://st.kp.yandex.net/images/sm_film/574690.jpg"></a></td>
      <td class="news">
        <div><div><a class="all" href="/series/574690/">Великий Человек-паук</a>
          <span>Ultimate Spider-Man, (2012 – 2017) <nobr>22 мин.</nobr></span></div>
          <span class="gray_text">США, (мультфильм, фантастика, боевик)</span>
        </div>
      </td>
      <td><div id="film_votes_574690" value="7.336"><div class="numVoteRecomm"><span class="all">7.336 (41 603)</span></div></div>IMDb: 7.20</td>
    </tr>
  </table>`;

const legacyItems = parse(legacyMarkup, 'https://www.kinopoisk.ru/film/690593/like/');
assert.equal(legacyItems.length, 2);
assert.deepEqual(legacyItems.map(item => item.kinopoiskId), [278217, 574690]);
assert.equal(legacyItems[0].alternativeName, 'The Amazing Spider-Man');
assert.equal(legacyItems[0].posterUrl, 'https://st.kp.yandex.net/images/film_big/278217.jpg');
assert.equal(legacyItems[0].year, 2012);
assert.equal(legacyItems[0].kpRating, 6.953);
assert.equal(legacyItems[0].kpVotes, 410046);
assert.equal(legacyItems[0].imdbRating, 6.9);
assert.equal(legacyItems[1].mediaType, 'tv');
console.log('✅ Legacy Kinopoisk /like/ table parsing preserves metadata and film/series type');
