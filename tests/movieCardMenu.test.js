const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.chrome = {
    runtime: {
        getURL: path => `chrome-extension://test/${path}`
    }
};
global.Utils = {
    extractKinopoiskId: value => value?.kinopoiskId || value?.movie?.kinopoiskId || null
};
window.i18n = {
    currentLocale: 'ru',
    get: key => key
};

const { MovieCard } = require('../src/shared/components/MovieCard.js');
MovieCard._documentMenuListenerBound = false;

let documentMenuListenerCount = 0;
const originalAddEventListener = document.addEventListener.bind(document);
document.addEventListener = (type, listener, options) => {
    if (type === 'mousedown' || type === 'keydown') {
        documentMenuListenerCount += 1;
    }
    return originalAddEventListener(type, listener, options);
};

const cardOne = MovieCard.create({ movie: { kinopoiskId: 101, name: 'First movie' } }, {
    showRemoveFromCollection: true
});
const cardTwo = MovieCard.create({ movie: { kinopoiskId: 102, name: 'Second movie' } }, {
    showRemoveFromCollection: true
});
document.body.append(cardOne, cardTwo);

assert.equal(documentMenuListenerCount, 2, 'MovieCard must bind one outside-click and one Escape listener');

for (const card of [cardOne, cardTwo]) {
    const menuButton = card.querySelector('.mc-menu-btn');
    const menu = card.querySelector('.mc-menu-dropdown');

    assert.equal(menuButton.getAttribute('aria-haspopup'), 'menu');
    assert.equal(menuButton.getAttribute('aria-expanded'), 'false');
    assert.equal(menu.getAttribute('role'), 'menu');
    assert.ok(card.querySelector('[data-action="remove-from-collection"]'));
}

const menuButtonOne = cardOne.querySelector('.mc-menu-btn');
const menuOne = cardOne.querySelector('.mc-menu-dropdown');
const menuButtonTwo = cardTwo.querySelector('.mc-menu-btn');
const menuTwo = cardTwo.querySelector('.mc-menu-dropdown');

menuButtonOne.click();
assert.equal(menuOne.classList.contains('active'), true);
assert.equal(menuButtonOne.getAttribute('aria-expanded'), 'true');
assert.equal(document.activeElement, menuOne.querySelector('.mc-menu-item'));

menuButtonTwo.click();
assert.equal(menuOne.classList.contains('active'), false, 'Opening one menu must close another');
assert.equal(menuButtonOne.getAttribute('aria-expanded'), 'false');
assert.equal(menuTwo.classList.contains('active'), true);

document.body.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
assert.equal(menuTwo.classList.contains('active'), false, 'Outside click must close the menu');
assert.equal(menuButtonTwo.getAttribute('aria-expanded'), 'false');

menuButtonOne.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'ArrowDown',
    bubbles: true
}));
assert.equal(menuOne.classList.contains('active'), true, 'ArrowDown must open the menu');
assert.equal(document.activeElement, menuOne.querySelector('.mc-menu-item'));

menuOne.querySelector('.mc-menu-item').dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true
}));
assert.equal(menuOne.classList.contains('active'), false, 'Escape must close the menu');
assert.equal(document.activeElement, menuButtonOne);

assert.doesNotMatch(
    cardOne.innerHTML,
    /V4a2 2 0 0 1 2 2v2/,
    'Collection removal icon must include the complete lid path'
);
assert.match(cardOne.innerHTML, /V4a2 2 0 0 1 2 2h4a2 2/);

const collectionSource = fs.readFileSync(
    require.resolve('../src/pages/collection/collection.js'),
    'utf8'
);
assert.match(collectionSource, /grid\.addEventListener\('click'/);
assert.match(collectionSource, /buttonElement\.setAttribute\('aria-busy', 'true'\)/);
assert.doesNotMatch(collectionSource, /querySelectorAll\('\[data-action="remove-from-collection"\]\)/);
assert.doesNotMatch(collectionSource, /data-collection-movie-id/);

document.addEventListener = originalAddEventListener;
console.log('✅ MovieCard menu accessibility and lifecycle passed');
