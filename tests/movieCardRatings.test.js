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
    name: 'TMDB title',
    tmdbRating: 8.1
});
assert.doesNotMatch(tmdbOnlyCard.innerHTML, /TMDB/);
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

console.log('✅ Movie card KP/IMDb labels and TMDB suppression passed');
