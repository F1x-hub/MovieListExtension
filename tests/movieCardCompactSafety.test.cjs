const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { PosterUrl } = require('../src/shared/utils/PosterUrl.js');

const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.document = dom.window.document;
global.window = {
    i18n: { currentLocale: 'ru', get: key => key },
    location: { href: '' }
};
global.chrome = { runtime: { getURL: path => `chrome-extension://test/${path}` } };
global.Utils = { extractKinopoiskId: movie => movie.kinopoiskId || null };
const { MovieCard } = require('../src/shared/components/MovieCard.js');

for (const url of [
    'https://avatars.mds.yandex.net/get-kinopoisk-image/1629390/id/600x900',
    'https://st.kp.yandex.net/images/film_big/278217.jpg',
    'https://image.tmdb.org/t/p/w500/poster.jpg',
    'https://image.openmoviedb.com/poster?id=123&size=600'
]) {
    assert.equal(PosterUrl.safe(url), url, `Known provider poster must survive: ${url}`);
    const card = MovieCard.createCompactDetail({ kinopoiskId: 123, name: 'Movie', posterUrl: url });
    assert.equal(card.querySelector('.cmc-poster').getAttribute('src'), url);
    assert.equal(card.querySelector('.cmc-poster').hasAttribute('onerror'), false);
}
assert.equal(
    PosterUrl.safe('http://st.kp.yandex.net/images/film_big/278217.jpg?size=600#poster'),
    'https://st.kp.yandex.net/images/film_big/278217.jpg?size=600#poster'
);
assert.equal(
    PosterUrl.safe('//avatars.mds.yandex.net/get-kinopoisk-image/id/orig'),
    'https://avatars.mds.yandex.net/get-kinopoisk-image/id/orig'
);

for (const url of [
    'javascript:alert(1)',
    'data:image/svg+xml,<svg onload="alert(1)">',
    'https://image.tmdb.org.evil.example/t/p/a.jpg',
    'https://evil.example/a.jpg',
    'https://username:password@image.tmdb.org/t/p/a.jpg',
    'https://image.tmdb.org:444/t/p/a.jpg',
    'https://image.tmdb.org:443/t/p/a.jpg',
    'https://image.tmdb.org/redirect?url=https://evil.example',
    'https://st.kp.yandex.net/redirect',
    'ftp://image.tmdb.org/t/p/a.jpg',
    'https://image.tmdb.org/t/p/a\njpg',
    'https://image.tmdb.org/t/p/' + 'a'.repeat(2048),
    null,
    {}
]) {
    assert.equal(PosterUrl.safe(url), '', `Invalid URL rejected: ${String(url).slice(0, 80)}`);
    const card = MovieCard.createCompactDetail({ name: 'Movie', posterUrl: url });
    assert.equal(card.querySelector('.cmc-poster').getAttribute('src'), '/src/shared/assets/icons/app/icon48.png');
}

// Even a trusted URL containing attribute delimiters must stay inside src.
const injected = 'https://image.openmoviedb.com/poster?text=" onerror="alert(1)&x=\'hello\'';
const card = MovieCard.createCompactDetail({ kinopoiskId: 456, name: '<script>movie</script>', posterUrl: injected });
assert.equal(card.querySelectorAll('img').length, 1);
assert.equal(card.querySelector('.cmc-poster').getAttribute('src'), PosterUrl.safe(injected));
assert.equal(card.querySelector('.cmc-poster').hasAttribute('onerror'), false);
assert.equal(card.querySelector('script'), null);
assert.ok(card.innerHTML.includes('&amp;'), 'HTML attributes escape ampersands too');

// Native buttons activate through click (including Enter/Space synthesized by browsers).
const watch = card.querySelector('.cmc-watch-btn');
watch.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
assert.equal(window.location.href, '', 'Pointer down must not navigate prematurely');
watch.click();
assert.equal(window.location.href, 'chrome-extension://test/src/pages/movie-details/movie-details.html?movieId=456');

delete global.PosterUrl;
const missingHelperCard = MovieCard.createCompactDetail({ posterUrl: 'https://evil.example/a.jpg' });
assert.equal(missingHelperCard.querySelector('.cmc-poster').getAttribute('src'), '/src/shared/assets/icons/app/icon48.png');
global.PosterUrl = PosterUrl;

// Shared normal/search cards retain their existing lazy-poster contract.
const deferred = MovieCard.create({ movie: {
    kinopoiskId: 789,
    name: 'Normal shared card',
    posterUrl: 'https://avatars.mds.yandex.net/get-kinopoisk-image/id/orig'
} }, { variant: 'search', showThreeDotMenu: false, deferPoster: true, lazyPoster: true });
assert.equal(deferred.querySelector('.mc-poster').getAttribute('data-deferred-poster-url'), 'https://avatars.mds.yandex.net/get-kinopoisk-image/id/orig');
assert.equal(deferred.querySelector('.mc-poster').getAttribute('loading'), 'lazy');
console.log('MovieCard compact poster safety and click activation passed');
