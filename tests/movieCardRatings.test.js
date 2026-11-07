const assert = require('node:assert/strict');

class MockElement {
    constructor() {
        this.dataset = {};
        this.style = {};
        this.className = '';
        this.innerHTML = '';
    }

    querySelector() { return null; }
    querySelectorAll() { return []; }
    addEventListener() {}
}

global.document = {
    createElement: () => new MockElement()
};
global.window = {
    i18n: {
        currentLocale: 'ru',
        get: key => key
    }
};
global.chrome = {
    runtime: {
        getURL: path => `chrome-extension://test/${path}`
    }
};

const { MovieCard } = require('../src/shared/components/MovieCard.js');

function createSearchCard(movie) {
    return MovieCard.create({ movie }, {
        variant: 'search',
        showThreeDotMenu: false,
        showDescription: false,
        showUserRating: false
    });
}

const tmdbOnlyCard = createSearchCard({
    tmdbId: 100,
    isTmdbOnly: true,
    // The title must not contain "TMDB" itself, or the check below would
    // match the title instead of a leaked TMDB rating badge.
    name: 'Unmapped title',
    tmdbRating: 8.1
});
assert.doesNotMatch(tmdbOnlyCard.innerHTML, /TMDB/);
assert.doesNotMatch(tmdbOnlyCard.innerHTML, /8\.1/, 'TMDB score is never shown as a provider rating');
assert.doesNotMatch(tmdbOnlyCard.innerHTML, /mc-badge-kp/);

const providerCard = createSearchCard({
    kinopoiskId: 200,
    name: 'Mapped title',
    kpRating: 7.6,
    imdbRating: 8.2
});
assert.match(providerCard.innerHTML, />КП<\/span><span>7\.6<\/span>/);
assert.match(providerCard.innerHTML, />IMDb<\/span><span>8\.2<\/span>/);
assert.doesNotMatch(providerCard.innerHTML, /mc-badge-tmdb/);

assert.match(providerCard.className, /movie-card-component/, 'MovieCard must expose the canonical root class');

const originalEscapeHtml = MovieCard.escapeHtml;
MovieCard.escapeHtml = value => String(value ?? '');
try {
    const deferredPosterCard = MovieCard.create({ movie: {
        kinopoiskId: 201,
        name: 'Deferred poster',
        posterUrl: 'https://avatars.mds.yandex.net/get-kinopoisk-image/abc/600x900'
    } }, {
        variant: 'search',
        showThreeDotMenu: false,
        lazyPoster: true,
        deferPoster: true
    });
    assert(deferredPosterCard.innerHTML.includes('data-deferred-poster-url="https://avatars.mds.yandex.net/get-kinopoisk-image/abc/600x900"'));
    assert(deferredPosterCard.innerHTML.includes('src="/src/shared/assets/icons/app/icon48.png"'));
    assert.match(deferredPosterCard.innerHTML, /loading="lazy" decoding="async"/);
} finally {
    MovieCard.escapeHtml = originalEscapeHtml;
}

const collectionCard = MovieCard.create({ movie: { kinopoiskId: 300, name: 'Collection title' } }, {
    showRemoveFromCollection: true
});
assert.match(collectionCard.innerHTML, /data-action="remove-from-collection"/, 'Collection removal must use MovieCard actions');

const unavailableOverlay = { innerHTML: '', dataset: {} };
MovieCard.updateCompactRatings({
    dataset: {},
    querySelector: selector => selector === '.mc-badges-overlay' ? unavailableOverlay : null
}, { status: 'no-ratings', kpRating: 0, imdbRating: 0 });
assert.match(unavailableOverlay.innerHTML, /mc-badge-unavailable/);
assert.match(unavailableOverlay.innerHTML, />КП<\/span><span>—<\/span>/);
assert.match(unavailableOverlay.innerHTML, />IMDb<\/span><span>—<\/span>/);

// A person's score is never shown as the Kinopoisk rating.
const ratedWithoutProviders = createSearchCard({ kinopoiskId: 400, name: 'Rated title' });
assert.doesNotMatch(ratedWithoutProviders.innerHTML, /mc-badge-kp/);
const standardRatedCard = MovieCard.create({
    rating: 2,
    averageRating: 2,
    ratingsCount: 1,
    movie: { kinopoiskId: 401, name: 'Rated title', rating: { kp: 0, imdb: 0 } }
});
assert.match(standardRatedCard.innerHTML, /mc-rating-kp mc-rating-none">—</, 'A rater\'s 2 stays out of the Kinopoisk cell');
assert.equal(standardRatedCard.dataset.kpRating, undefined);

// Provider ratings read one way everywhere.
const wholeNumbers = createSearchCard({ kinopoiskId: 402, name: 'Whole numbers', kpRating: 6, imdbRating: 7 });
assert.match(wholeNumbers.innerHTML, />КП<\/span><span>6\.0<\/span>/);
assert.match(wholeNumbers.innerHTML, />IMDb<\/span><span>7\.0<\/span>/);

// Each provider keeps its place whatever its state.
const order = html => [...html.matchAll(/(?:mc-badge-source|mc-rating-skeleton-label)">(КП|IMDb)</g)].map(match => match[1]);
for (const ratings of [
    { kpRating: 0, kpUnavailable: true, imdbRating: 6.7 },
    { kpRating: 7.2, imdbRating: 0, imdbUnavailable: true },
    { kpRating: 0, kpPending: true, imdbRating: 6.7 },
    { kpRating: 0, kpUnavailable: true, imdbRating: 0, imdbPending: true }
]) {
    assert.deepEqual(order(MovieCard.renderCompactRatingBadges(ratings)), ['КП', 'IMDb'], JSON.stringify(ratings));
}
assert.equal(order(MovieCard.renderCompactRatingBadges({ showSkeleton: true, kpUnavailable: true })).length, 2, 'One badge per provider');

console.log('✅ Movie card KP/IMDb labels and TMDB suppression passed');

// Keep compact renderer regressions in the existing shared MovieCard test gate.
require('./movieCardCompactSafety.test.cjs');
