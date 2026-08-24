const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync('src/shared/components/BackToTop.js', 'utf8');

function createDom(body) {
    const dom = new JSDOM(`<!doctype html><body>${body}</body>`, {
        runScripts: 'dangerously',
        pretendToBeVisual: true
    });

    dom.window.eval(source);
    dom.window.BackToTop.init();
    return dom;
}

const documentDom = createDom('<main></main>');
const documentButton = documentDom.window.document.getElementById('backToTopButton');
assert.ok(documentButton, 'creates a button on regular pages');
assert.equal(documentButton.getAttribute('aria-hidden'), 'true', 'starts hidden');

Object.defineProperty(documentDom.window, 'scrollY', { value: 300, writable: true });
documentDom.window.dispatchEvent(new documentDom.window.Event('scroll'));
assert.ok(documentButton.classList.contains('is-visible'), 'shows after document scroll');

documentDom.window.scrollTo = ({ top }) => {
    documentDom.window.scrollTopAfterClick = top;
};
documentButton.click();
assert.equal(documentDom.window.scrollTopAfterClick, 0, 'scrolls the document to the top');

const popupDom = createDom('<div class="popup-container"><div style="height: 1000px"></div></div>');
const popupContainer = popupDom.window.document.querySelector('.popup-container');
const popupButton = popupDom.window.document.getElementById('backToTopButton');
popupContainer.scrollTo = ({ top }) => {
    popupContainer.scrollTop = top;
};
popupContainer.scrollTop = 300;
popupContainer.dispatchEvent(new popupDom.window.Event('scroll'));
assert.ok(popupButton.classList.contains('is-visible'), 'shows after popup scroll');
popupButton.click();
assert.equal(popupContainer.scrollTop, 0, 'scrolls the popup container to the top');

console.log('✅ BackToTop component tests passed');
