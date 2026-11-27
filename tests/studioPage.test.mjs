// Studio page: TMDB company requests, the «Студии» row of a film page, and the page itself
// (tabs, paging, orders, stale answers, the user's scores, errors).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { locales } from '../src/shared/i18n/locales.js';
import { countryName } from '../src/shared/data/countries.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 1. TMDBService: company details and the company's titles
// ---------------------------------------------------------------------------
global.TMDB_CONFIG = { BASE_URL: 'https://tmdb.test/3', DEFAULT_LANGUAGE: 'ru-RU', API_KEYS: ['k'], API_KEY: 'k', rotateKey() {} };
const TMDBService = require('../src/shared/services/TMDBService.js');
{
    const service = new TMDBService();
    const urls = [];
    service._fetchWithRotation = async url => {
        urls.push(new URL(url));
        const parsed = new URL(url);
        if (parsed.pathname === '/3/company/41077') {
            return { ok: true, json: async () => ({ id: 41077, name: ' A24 ', logo_path: '/a24.png', origin_country: 'us', headquarters: 'New York, USA', homepage: 'javascript:alert(1)', description: '', parent_company: { id: 9, name: 'Parent', logo_path: null } }) };
        }
        if (parsed.pathname === '/3/company/404') return { ok: false, status: 404 };
        const isTv = parsed.pathname.endsWith('/tv');
        return {
            ok: true,
            json: async () => ({
                page: Number(parsed.searchParams.get('page')),
                total_pages: 900,
                total_results: 3,
                results: [
                    isTv ? { id: 1, name: 'Эйфория', original_name: 'Euphoria', first_air_date: '2019-06-16', poster_path: '/p.jpg' } : { id: 2, title: 'Маяк', original_title: 'The Lighthouse', release_date: '2019-10-18' },
                    isTv ? { id: 3, name: 'Без даты', original_name: 'Undated' } : { id: 4, title: 'Adult', adult: true },
                    null
                ]
            })
        };
    };

    const company = await service.getCompanyDetails('41077');
    assert.equal(company.name, 'A24');
    assert.equal(company.originCountry, 'US');
    assert.equal(company.homepage, '', 'only http(s) sites are kept');
    assert.deepEqual(company.parent, { tmdbId: 9, name: 'Parent', logoUrl: null });
    assert.match(company.logoUrl, /w300\/a24\.png$/);
    await assert.rejects(() => service.getCompanyDetails(404), error => error.status === 404);
    await assert.rejects(() => service.getCompanyDetails('abc'), /positive integer/);

    const expectSort = async (mediaType, sort, sortBy, extra = {}) => {
        urls.length = 0;
        const result = await service.getCompanyTitlesPage({ companyId: 41077, mediaType, sort, page: 2 });
        const params = urls[0].searchParams;
        assert.equal(urls[0].pathname, `/3/discover/${mediaType}`);
        assert.equal(params.get('with_companies'), '41077');
        assert.equal(params.get('sort_by'), sortBy, `${mediaType} ${sort}`);
        assert.equal(params.get('page'), '2');
        assert.equal(params.get('include_adult'), 'false');
        Object.entries(extra).forEach(([key, value]) => assert.equal(params.get(key), value, key));
        if (sort !== 'rating') assert.equal(params.get('vote_count.gte'), null);
        return result;
    };
    await expectSort('movie', 'popular', 'popularity.desc');
    await expectSort('movie', 'newest', 'primary_release_date.desc');
    await expectSort('movie', 'oldest', 'primary_release_date.asc', { 'primary_release_date.gte': '1870-01-01' });
    await expectSort('movie', 'rating', 'vote_average.desc', { 'vote_count.gte': String(TMDBService.COMPANY_RATING_MIN_VOTES) });
    await expectSort('movie', 'title', 'title.asc');
    await expectSort('tv', 'oldest', 'first_air_date.asc', { 'first_air_date.gte': '1870-01-01' });
    await expectSort('tv', 'title', 'name.asc');
    const unknownSort = await expectSort('movie', 'nonsense', 'popularity.desc');
    assert.deepEqual(unknownSort.items.map(item => item.tmdbId), [2], 'adult titles and empty rows are dropped');
    assert.equal(unknownSort.totalPages, 500, 'TMDB serves 500 pages at most');

    const series = await service.getCompanyTitlesPage({ companyId: 41077, mediaType: 'tv' });
    assert.deepEqual(series.items.map(item => [item.tmdbId, item.name, item.mediaType, item.type, item.year]), [
        [1, 'Эйфория', 'tv', 'tv-series', 2019],
        [3, 'Без даты', 'tv', 'tv-series', 0]
    ], 'a series without a date is still read as a series');
    assert.ok(series.items.every(item => item.isTmdbOnly && item.kinopoiskId === null));
}
console.log('  ✅ TMDB company details and titles');

// ---------------------------------------------------------------------------
// 2. The «Студии» row on a film page
// ---------------------------------------------------------------------------
{
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://extension.test/src/pages/movie-details/movie-details.html' });
    global.window = dom.window;
    global.i18n = { get: key => key.split('.').reduce((value, part) => value?.[part], locales.ru) || key };
    const { MovieDetailsMetaRendererMethods } = require('../src/pages/movie-details/MetaRenderer.js');
    const renderer = Object.create(MovieDetailsMetaRendererMethods.prototype);
    renderer.escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const companies = Array.from({ length: 8 }, (_, index) => ({ tmdbId: index === 7 ? null : index + 1, name: `Studio "${index + 1}"`, originCountry: 'US' }));

    const html = renderer.renderProductionCompanies(companies, { isSeries: true });
    const host = dom.window.document.body;
    host.innerHTML = html;
    const links = [...host.querySelectorAll('a.production-company-pill')];
    assert.equal(links.length, 7, 'studios with a TMDB ID are links');
    assert.equal(links[0].getAttribute('href'), '../studio/studio.html?id=1&media=tv', 'a series opens the series tab');
    assert.equal(host.querySelectorAll('span.production-company-pill').length, 1, 'a studio without a TMDB ID stays a label');
    assert.ok(!html.includes('Studio "1"'), 'names are escaped');
    const extras = [...host.querySelectorAll('[data-extra="true"]')];
    assert.equal(extras.length, 2);
    assert.ok(extras.every(pill => pill.hidden));
    const more = host.querySelector('.production-company-more');
    assert.equal(more.tagName, 'BUTTON');
    assert.equal(more.textContent, '+2');

    renderer.toggleProductionCompanies(more);
    assert.ok(extras.every(pill => !pill.hidden), '«+2» shows the rest in place');
    assert.equal(more.getAttribute('aria-expanded'), 'true');
    assert.equal(more.textContent, 'Свернуть');
    renderer.toggleProductionCompanies(more);
    assert.ok(extras.every(pill => pill.hidden));
    assert.equal(more.textContent, '+2');
    assert.equal(more.getAttribute('aria-label'), 'Показать ещё студии: 2');

    const film = renderer.renderProductionCompanies([{ tmdbId: 5, name: 'Solo' }]);
    assert.ok(film.includes('href="../studio/studio.html?id=5"'), 'a film opens the films tab');
    assert.ok(!film.includes('production-company-more'), 'no button for six or fewer');
    delete global.window;
    delete global.i18n;
}
console.log('  ✅ Studio row links and «+N»');

// ---------------------------------------------------------------------------
// 3. The studio page
// ---------------------------------------------------------------------------
async function makePage({ search = '?id=41077&media=tv', totals = { movie: 45, tv: 6 }, company = null, uid = 'u1', scores = new Map() } = {}) {
    const body = read('src/pages/studio/studio.html').match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
    const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
        url: `https://extension.test/src/pages/studio/studio.html${search}`,
        runScripts: 'outside-only'
    });
    const { window } = dom;
    // Evaluated after DOMContentLoaded, the page script does not start a page of its own.
    if (window.document.readyState !== 'complete') await new Promise(resolve => window.addEventListener('load', resolve));
    const calls = [];
    const deferred = new Map();
    window.i18n = {
        currentLocale: 'ru',
        init: async () => {},
        translatePage() {},
        onLocaleChange() {},
        get: key => key.split('.').reduce((value, part) => value?.[part], locales.ru) ?? key
    };
    window.TMDBService = class {
        static COMPANY_SORTS = TMDBService.COMPANY_SORTS;
        static COMPANY_RATING_MIN_VOTES = TMDBService.COMPANY_RATING_MIN_VOTES;
        async getCompanyDetails(id) {
            if (company instanceof Error) throw company;
            return company || { tmdbId: id, name: 'A24', logoUrl: null, originCountry: 'US', headquarters: 'Нью-Йорк', homepage: 'https://www.a24films.com', description: '', parent: null };
        }
        async getCompanyTitlesPage({ mediaType, sort, page }) {
            calls.push(`${mediaType}:${sort}:${page}`);
            const key = `${mediaType}:${sort}:${page}`;
            if (deferred.has(key)) await deferred.get(key);
            const total = totals[mediaType];
            const start = (page - 1) * 20;
            const count = Math.max(0, Math.min(20, total - start));
            return {
                page,
                totalPages: Math.max(1, Math.ceil(total / 20)),
                totalResults: total,
                items: Array.from({ length: count }, (_, index) => ({ tmdbId: (mediaType === 'tv' ? 9000 : 1000) + start + index, mediaType, sort, name: `${sort} ${start + index}` }))
            };
        }
    };
    window.HomeRenderer = class {
        createMovieCard(item) {
            const card = window.document.createElement('div');
            card.className = 'movie-card-component';
            card.dataset.tmdbId = String(item.tmdbId);
            card.dataset.sort = item.sort;
            card.innerHTML = '<div class="mc-badges-overlay"></div>';
            return card;
        }
        bindMovieCardNavigation() {}
    };
    const ratingQueries = [];
    window.firebaseManager = {
        async waitForAuthReady() { return uid ? { uid } : null; },
        getCurrentUser() { return uid ? { uid } : null; },
        getRatingService() {
            return {
                async getUserRatingsForMovies(userId, ids) {
                    ratingQueries.push([userId, [...ids]]);
                    return new Map(ids.filter(id => scores.has(id)).map(id => [String(id), { rating: scores.get(id) }]));
                }
            };
        }
    };
    window.eval(read('src/shared/components/MovieCard.js'));
    window.eval(read('src/pages/studio/studio.js'));
    const page = new window.StudioPage();
    // A page script loads the shared country names with import(); window.eval cannot.
    page.loadCountryNames = async () => { page.countryNameOf = countryName; };
    return { window, page, calls, deferred, ratingQueries, $: id => window.document.getElementById(id) };
}

{
    const { window, page, calls, deferred, ratingQueries, $ } = await makePage({ scores: new Map([[555, 8], [556, 0]]) });
    await page.init();
    assert.equal($('studioName').textContent, 'A24');
    assert.equal(window.document.title, 'A24 — Сеанс');
    assert.equal($('studioKind').textContent, 'Студия · США');
    const facts = $('studioFacts').textContent;
    assert.ok(facts.includes('45 фильмов и 6 сериалов'), facts);
    assert.ok(facts.includes('a24films.com'), 'the site shows its host');
    assert.equal($('studioLogoText').textContent, 'A24', 'without a logo the name fills the well');
    assert.ok(!$('studioContent').hidden && $('studioError').hidden);
    assert.ok(!$('studioMedia').hidden, 'the switch shows for a studio with films and series');
    const tvChoice = $('studioMedia').querySelector('[data-media="tv"]');
    assert.equal(tvChoice.getAttribute('aria-pressed'), 'true', 'a series page opens the series tab');
    assert.equal(tvChoice.querySelector('[data-count-for]').textContent, '6');
    assert.equal($('studioGrid').children.length, 6);
    assert.ok($('studioMore').hidden, 'one page of series: no «Показать ещё»');
    assert.deepEqual(calls.sort(), ['movie:popular:1', 'tv:popular:1'], 'the first pages give the counts and the first grid');

    $('studioMedia').querySelector('[data-media="movie"]').click();
    await wait(0);
    assert.equal($('studioGrid').children.length, 20);
    assert.equal(new URL(window.location.href).searchParams.get('media'), null);
    assert.ok(!$('studioMore').hidden);
    assert.equal($('studioMore').textContent, 'Показать ещё 20');
    $('studioMore').click();
    await wait(0);
    assert.equal($('studioGrid').children.length, 40);
    assert.equal($('studioMore').textContent, 'Показать ещё 5');
    $('studioMore').click();
    await wait(0);
    assert.equal($('studioGrid').children.length, 45);
    assert.ok($('studioMore').hidden);

    // Orders: the rating order says which titles it counts; a late answer for an older order is dropped.
    const sort = $('studioSort');
    let releaseNewest;
    deferred.set('movie:newest:1', new Promise(resolve => { releaseNewest = resolve; }));
    sort.value = 'newest';
    sort.dispatchEvent(new window.Event('change'));
    await wait(0);
    assert.equal($('studioGrid').querySelectorAll('.studio-skeleton').length, 12, 'a new order shows placeholders');
    sort.value = 'rating';
    sort.dispatchEvent(new window.Event('change'));
    await wait(0);
    releaseNewest();
    await wait(0);
    const sorts = new Set([...$('studioGrid').children].map(card => card.dataset.sort));
    assert.deepEqual([...sorts], ['rating'], 'the newest-first answer came late and was dropped');
    assert.ok(!$('studioNote').hidden);
    assert.ok($('studioNote').textContent.includes('50'));
    assert.equal(window.localStorage.getItem('studioTitlesSortV1'), 'rating', 'the order is remembered');

    // The user's scores follow the Kinopoisk IDs the rating enrichment writes on cards.
    await wait(300);
    const [first, second] = $('studioGrid').children;
    first.dataset.movieId = '555';
    second.dataset.movieId = '556';
    await wait(350);
    assert.deepEqual(ratingQueries.at(-1), ['u1', [555, 556]], 'one batched query for the new IDs');
    assert.ok(first.querySelector('.mc-badge-user')?.textContent.includes('8'), 'a rated title shows the score');
    assert.equal(first.dataset.userRating, '8');
    assert.equal(second.querySelector('.mc-badge-user'), null, 'an unrated title shows none');
    const queriesBefore = ratingQueries.length;
    first.dataset.movieId = '555';
    $('studioGrid').append(page.renderer.createMovieCard({ tmdbId: 1, mediaType: 'movie', sort: 'rating' }));
    await wait(350);
    assert.equal(ratingQueries.length, queriesBefore, 'known IDs are not asked again');
    window.close();
}
console.log('  ✅ Studio page tabs, paging, orders and scores');

{
    const { page, $ } = await makePage({ search: '?id=41077', totals: { movie: 3, tv: 0 }, uid: null });
    await page.init();
    assert.ok($('studioMedia').hidden, 'a studio with films only has no switch');
    assert.ok($('studioFacts').textContent.includes('3 фильма'));
    assert.equal($('studioGrid').children.length, 3);
}
{
    const { page, $ } = await makePage({ search: '?id=41077&media=tv', totals: { movie: 2, tv: 0 } });
    await page.init();
    assert.equal(page.media, 'movie', 'a requested tab without titles gives way to the other');
}
{
    const { page, $ } = await makePage({ totals: { movie: 0, tv: 0 } });
    await page.init();
    assert.ok(!$('studioEmpty').hidden);
    assert.equal($('studioEmpty').textContent, locales.ru.studio.empty_studio);
}
{
    const { page, $ } = await makePage({ search: '?id=abc' });
    await page.init();
    assert.ok(!$('studioError').hidden);
    assert.equal($('studioErrorTitle').textContent, locales.ru.studio.error_invalid_title);
    assert.ok($('studioErrorRetry').hidden, 'a broken link has nothing to retry');
}
{
    const missing = Object.assign(new Error('HTTP 404'), { status: 404 });
    const { page, $ } = await makePage({ company: missing });
    await page.init();
    assert.equal($('studioErrorTitle').textContent, locales.ru.studio.error_not_found_title);
}
{
    const { page, $ } = await makePage({ company: new Error('offline') });
    await page.init();
    assert.equal($('studioErrorTitle').textContent, locales.ru.studio.error_title);
    assert.ok(!$('studioErrorRetry').hidden);
}
console.log('  ✅ Studio page single-type, empty and error states');

// Every studio text exists in both languages.
const keys = object => Object.entries(object).flatMap(([key, value]) => (value && typeof value === 'object' ? keys(value).map(sub => `${key}.${sub}`) : [key]));
const enKeys = new Set(keys(locales.en.studio));
const ruKeys = new Set(keys(locales.ru.studio).filter(key => !/\.(few|many)$/.test(key)));
assert.deepEqual([...ruKeys].sort(), [...enKeys].sort());
assert.ok(locales.en.app.titles.studio && locales.ru.app.titles.studio);
console.log('  ✅ Studio copy in both languages');
console.log('\nStudio page tests passed');
