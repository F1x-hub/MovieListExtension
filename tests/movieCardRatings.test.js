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

const unavailableOverlay = { innerHTML: '', dataset: {} };
MovieCard.updateCompactRatings({
    dataset: {},
    querySelector: selector => selector === '.mc-badges-overlay' ? unavailableOverlay : null
}, { status: 'no-ratings', kpRating: 0, imdbRating: 0 });
assert.match(unavailableOverlay.innerHTML, /mc-badge-unavailable/);
assert.match(unavailableOverlay.innerHTML, />КП<\/span><span>—<\/span>/);
assert.match(unavailableOverlay.innerHTML, />IMDb<\/span><span>—<\/span>/);

console.log('✅ Movie card KP/IMDb labels and TMDB suppression passed');
