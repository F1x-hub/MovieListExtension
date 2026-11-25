/**
 * A page opens once on screen. It is painted from a cache and filled from the server a
 * moment later; that second paint used to replay the entry (Rated and Profile faded out
 * and in, Movie Details rebuilt with its tab and numbers starting over), which looked
 * like the page loading several times.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function checkEntryPlaysOnce() {
    const { window } = new JSDOM('<div id="loader"></div><div id="content"></div>', { runScripts: 'outside-only' });
    window.eval(read('src/shared/utils/Utils.js'));
    let entries = 0;
    const content = window.document.getElementById('content');
    content.animate = () => { entries++; return { cancel() {} }; };
    const page = window.Utils.createPageStateManager({ loader: window.document.getElementById('loader'), contentContainer: content });

    page.showContent();
    assert.equal(entries, 1, 'The first paint enters');
    page.showContent();
    page.hideLoader();
    page.showContent();
    assert.equal(entries, 1, 'Fresh data for content on screen does not enter again');

    page.showLoader();
    page.showContent();
    assert.equal(entries, 2, 'Content that replaces a loader enters');
    page.showError('failed');
    page.showContent();
    assert.equal(entries, 3, 'Content that replaces an error enters');
    window.close();
}

function checkSameFilmKeepsTheView() {
    const { window } = new JSDOM('<div id="movieDetailsContainer"></div>', { runScripts: 'outside-only' });
    const context = vm.createContext({
        window: Object.assign(Object.create(null), { location: { search: '' }, scrollY: 640, scrolled: [], scrollTo(options) { this.scrolled.push(options.top); } }),
        document: { addEventListener() {} }, URLSearchParams, console
    });
    vm.runInContext(read('src/pages/movie-details/movie-details.js').replace(/^import .*;\r?$/gm, ''), context);
    const prototype = context.window.MovieDetailsManager.prototype;
    const container = window.document.getElementById('movieDetailsContainer');
    const page = Object.assign(Object.create(prototype), { elements: { movieDetailsContainer: container } });
    const markup = `<div class="movie-detail-page">
        <button class="tab-btn active" data-tab="about"></button><button class="tab-btn" data-tab="actors"></button><button class="tab-btn disabled" data-tab="awards"></button>
        <div class="tab-pane active" id="tab-about"></div><div class="tab-pane" id="tab-actors"></div><div class="tab-pane" id="tab-awards"></div></div>`;
    const active = () => [...container.querySelectorAll('.active')].map(node => node.dataset.tab || node.id);

    assert.equal(page.captureRenderedView(), null, 'Nothing to keep before the first paint');
    container.innerHTML = markup;
    container.querySelector('[data-tab="about"]').classList.remove('active');
    container.querySelector('#tab-about').classList.remove('active');
    container.querySelector('[data-tab="actors"]').classList.add('active');
    container.querySelector('#tab-actors').classList.add('active');
    const view = page.captureRenderedView();

    container.innerHTML = markup;
    const finished = [];
    const animation = animationName => ({ animationName, finish: () => finished.push(animationName) });
    container.getAnimations = () => [animation('ui-fade-in'), animation('tabFadeIn'), animation('mc-shimmer')];
    context.window.scrollY = 0;
    page.restoreRenderedView(view);
    assert.deepEqual(active(), ['actors', 'tab-actors'], 'The open tab stays open');
    assert.deepEqual(finished, ['ui-fade-in', 'tabFadeIn'], 'Entry animations end; a placeholder keeps its shimmer');
    assert.deepEqual(context.window.scrolled, [640], 'The scroll position stays');

    container.innerHTML = markup;
    page.restoreRenderedView({ tab: 'awards', scrollY: 0 });
    assert.deepEqual(active(), ['about', 'tab-about'], 'A tab that is no longer available is not opened');
    window.close();
}

async function checkEqualMarkupIsKept() {
    const { setMarkup } = await import(`data:text/javascript,${encodeURIComponent(read('src/shared/utils/setMarkup.js'))}`);
    const { window } = new JSDOM('<div id="block"></div>');
    const block = window.document.getElementById('block');
    assert.equal(setMarkup(block, '<i id="a1"></i>', '<i id="a"></i>'), true);
    const node = block.firstChild;
    assert.equal(setMarkup(block, '<i id="a2"></i>', '<i id="a"></i>'), false, 'Only generated ids differ');
    assert.equal(block.firstChild, node);
    assert.equal(setMarkup(block, '<b></b>'), true);
    block.replaceChildren();
    assert.equal(setMarkup(block, '<b></b>'), true, 'An emptied block is filled again');
    window.close();
}

function checkSearchLinkShowsNoInvitation() {
    const marked = search => {
        const { window } = new JSDOM('', { url: `https://extension.test/search.html${search}`, runScripts: 'outside-only' });
        window.eval(read('src/pages/search/search-boot.js'));
        return window.document.documentElement.classList.contains('search-route-opening');
    };
    assert.equal(marked('?query=dune'), true);
    assert.equal(marked('?q=dune'), true);
    assert.equal(marked(''), false);
    assert.equal(marked('?query='), false);
}

(async () => {
    checkEntryPlaysOnce();
    checkSameFilmKeepsTheView();
    await checkEqualMarkupIsKept();
    checkSearchLinkShowsNoInvitation();
    console.log('Page entry passed: one entry per page, the same film keeps its view, equal markup stays, a search link shows no invitation.');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
