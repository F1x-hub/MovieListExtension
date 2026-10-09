const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../src/shared/components/BackToTop.js'), 'utf8');
const doms = [];

function createDom(body) {
    const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { runScripts: 'outside-only' });
    doms.push(dom);
    Object.defineProperty(dom.window.document, 'readyState', { value: 'complete' });
    dom.window.matchMedia = () => ({ matches: false });
    dom.window.eval(source);
    return dom;
}

try {
    const popup = createDom('<div class="popup-container"><div id="feedContent"></div></div>');
    const container = popup.window.document.querySelector('.popup-container');
    const feed = popup.window.document.getElementById('feedContent');
    const button = popup.window.document.getElementById('backToTopButton');
    let clickedTarget = null;
    feed.scrollTo = options => { clickedTarget = { target: 'feed', ...options }; };
    container.scrollTo = () => { throw new Error('The outer popup does not own feed scrolling'); };
    popup.window.scrollTo = () => { throw new Error('Popup must not scroll the document'); };

    assert.equal(button.disabled, true, 'hidden control cannot be activated');
    assert.equal(button.tabIndex, -1, 'hidden control is outside the Tab order');
    container.scrollTop = 500;
    container.dispatchEvent(new popup.window.Event('scroll'));
    assert.equal(button.classList.contains('is-visible'), false, 'outer popup scroll does not control visibility');
    feed.scrollTop = 500;
    feed.dispatchEvent(new popup.window.Event('scroll'));
    assert.equal(button.disabled, false);
    assert.equal(button.tabIndex, 0);
    assert.equal(button.getAttribute('aria-hidden'), 'false');
    button.click();
    assert.deepEqual(clickedTarget, { target: 'feed', top: 0, behavior: 'smooth' });

    popup.window.matchMedia = () => ({ matches: true });
    button.click();
    assert.equal(clickedTarget.behavior, 'auto', 'reduced motion uses an immediate scroll');
    feed.scrollTop = 0;
    feed.dispatchEvent(new popup.window.Event('scroll'));
    assert.equal(button.disabled, true);
    assert.equal(button.tabIndex, -1);
    assert.equal(button.getAttribute('aria-hidden'), 'true');

    popup.window.BackToTop.dispose();
    assert.equal(popup.window.document.getElementById('backToTopButton'), null);
    feed.scrollTop = 500;
    feed.dispatchEvent(new popup.window.Event('scroll'));
    assert.equal(button.classList.contains('is-visible'), false, 'dispose removes the old scroll listener');
    popup.window.BackToTop.init();
    popup.window.BackToTop.init();
    assert.equal(popup.window.document.querySelectorAll('#backToTopButton').length, 1, 'reinitialization is idempotent');
    popup.window.dispatchEvent(new popup.window.PageTransitionEvent('pagehide', { persisted: true }));
    assert.ok(popup.window.document.getElementById('backToTopButton'), 'BFCache suspension preserves the control');
    popup.window.dispatchEvent(new popup.window.PageTransitionEvent('pagehide', { persisted: false }));
    assert.equal(popup.window.document.getElementById('backToTopButton'), null, 'page teardown disposes the control');

    const fallback = createDom('<div class="popup-container"></div>');
    const fallbackContainer = fallback.window.document.querySelector('.popup-container');
    const fallbackButton = fallback.window.document.getElementById('backToTopButton');
    fallbackContainer.scrollTo = options => { clickedTarget = { target: 'container', ...options }; };
    fallbackContainer.scrollTop = 400;
    fallbackContainer.dispatchEvent(new fallback.window.Event('scroll'));
    fallbackButton.click();
    assert.deepEqual(clickedTarget, { target: 'container', top: 0, behavior: 'smooth' }, 'legacy popup container remains supported');

    const page = createDom('<main><div id="feedContent"></div></main>');
    const pageButton = page.window.document.getElementById('backToTopButton');
    page.window.document.getElementById('feedContent').scrollTo = () => { throw new Error('Unrelated page feed must not become a popup scroll target'); };
    Object.defineProperty(page.window, 'scrollY', { value: 400, writable: true });
    page.window.scrollTo = options => { clickedTarget = { target: 'window', ...options }; };
    page.window.dispatchEvent(new page.window.Event('scroll'));
    pageButton.click();
    assert.deepEqual(clickedTarget, { target: 'window', top: 0, behavior: 'smooth' }, 'full pages preserve document scrolling');

    console.log('Popup BackToTop audit fixes passed');
} finally {
    doms.forEach(dom => dom.window.close());
}
