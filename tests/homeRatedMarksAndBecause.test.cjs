// Behaviour of the Home additions: "★ N" marks on discovery cards whose Kinopoisk
// ID arrives after render, and the "Because you rated" row (data and page wiring).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function homeContext() {
    const dom = new JSDOM(read('src/pages/home/home.html'), { url: 'https://home.test/' });
    const { window } = dom;
    const context = vm.createContext({
        window, document: window.document, MutationObserver: window.MutationObserver,
        setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} }
    });
    // The page bootstrap (DOMContentLoaded) is not part of the behaviour under test.
    const code = read('src/pages/home/home.js').split("document.addEventListener('DOMContentLoaded'")[0];
    vm.runInContext(`${code}\nglobalThis.HomePage = HomePage;`, context);
    return { dom, window, document: window.document, HomePage: context.HomePage };
}

function card(document, grid, movieId = null) {
    const element = document.createElement('div');
    element.className = 'movie-card-component';
    if (movieId) element.dataset.movieId = String(movieId);
    grid.append(element);
    return element;
}

// Marks follow late Kinopoisk IDs, query each ID once, and clear on sign-out.
(async () => {
    {
        const { document, HomePage, dom } = homeContext();
        const queries = [];
        const rated = new Map([['10', { rating: 9 }], ['20', { rating: 6 }]]);
        const page = Object.create(HomePage.prototype);
        page.categoryElements = {
            filmsGrid: document.getElementById('films-grid'),
            seriesGrid: document.getElementById('series-grid'),
            tvShowsTitle: document.getElementById('tvShows-title')
        };
        page.dataController = { firebaseManager: { getRatingService: () => ({
            async getUserRatingsForMovies(uid, ids) {
                queries.push([...ids].map(Number));
                return new Map(ids.map(String).filter(id => rated.has(id)).map(id => [id, rated.get(id)]));
            }
        }) } };
        page.personalUid = 'alice';

        const tmdbOnly = card(document, page.categoryElements.filmsGrid);
        const known = card(document, page.categoryElements.seriesGrid, 20);
        await page.markRatedCards('alice');
        assert.deepEqual(queries, [[20]], 'Only cards with a Kinopoisk ID are looked up');
        assert.equal(known.querySelector('.home-rated-badge').textContent, '★ 6');
        assert.equal(tmdbOnly.querySelector('.home-rated-badge'), null);

        // The enrichment service identifies the TMDB-only card later.
        tmdbOnly.dataset.movieId = '10';
        await wait(320);
        assert.deepEqual(queries, [[20], [10]], 'A late ID triggers one query for that ID only');
        assert.equal(tmdbOnly.querySelector('.home-rated-badge').textContent, '★ 9');
        assert.equal(tmdbOnly.classList.contains('home-rated'), true);

        // Writing badges must not schedule more passes or queries.
        await wait(320);
        assert.equal(queries.length, 2);

        // Re-rendered grids reuse known scores without new reads.
        page.categoryElements.filmsGrid.innerHTML = '';
        const again = card(document, page.categoryElements.filmsGrid, 10);
        await wait(320);
        assert.equal(queries.length, 2);
        assert.equal(again.querySelector('.home-rated-badge').textContent, '★ 9');

        await page.markRatedCards(null);
        assert.equal(document.querySelectorAll('.home-rated-badge').length, 0, 'Sign-out removes every mark');
        page.ratedObserver.disconnect();
        dom.window.close();
    }

    // The row is requested once per user and language and hidden for guests or no data.
    {
        const { document, HomePage, window, dom } = homeContext();
        const requests = [];
        let answer = { source: { kinopoiskId: 3, name: 'Дюна' }, items: [{ kinopoiskId: 11, name: 'Rec' }] };
        window.i18n = { currentLocale: 'ru', get: key => key };
        const page = Object.create(HomePage.prototype);
        page.personalUid = 'alice';
        page.dataController = { async getBecauseYouRated(uid, locale) { requests.push(`${uid}|${locale}`); return answer; } };
        const rendered = [];
        page.renderer = { renderCategoryGrid(items) { rendered.push(items.map(item => item.kinopoiskId)); } };
        const section = document.getElementById('because-section');

        await page.loadBecauseYouRated('alice');
        await page.loadBecauseYouRated('alice');
        assert.deepEqual(requests, ['alice|ru'], 'Repeated personal-tier updates share one request');
        assert.equal(section.hidden, false);
        assert.equal(document.getElementById('because-title').textContent, 'Потому что вы оценили «Дюна»');
        assert.deepEqual(rendered.at(-1), [11]);

        window.i18n.currentLocale = 'en';
        answer = null;
        await page.loadBecauseYouRated('alice');
        assert.deepEqual(requests, ['alice|ru', 'alice|en'], 'A language change requests localized titles');
        assert.equal(section.hidden, true, 'Nothing usable hides the row');

        page.personalUid = null;
        await page.loadBecauseYouRated(null);
        assert.equal(section.hidden, true);
        dom.window.close();
    }

    // Data: seeds come from the newest ratings, unmapped seeds are skipped and
    // recommendations the user already rated are removed by a batched lookup.
    {
        const calls = { all: [], batch: [], mapping: [], recs: [] };
        const ratingService = {
            async getAllRatings(limit, cursor, uid) {
                calls.all.push([limit, cursor, uid]);
                return { ratings: [{ movieId: 1, rating: 6 }, { movieId: 2, rating: 9 }, { movieId: 3, rating: 10 }] };
            },
            async getUserRatingsForMovies(uid, ids) {
                calls.batch.push([...ids]);
                return new Map([['10', { rating: 7 }]]);
            }
        };
        const context = vm.createContext({
            window: {}, console: { log() {}, warn() {}, error() {} },
            RecommendationService: class {
                async getRecommendationsForMovie(source, options) {
                    calls.recs.push({ tmdbId: source.tmdbId, kinopoiskId: source.kinopoiskId, language: options.language });
                    return [{ kinopoiskId: 10 }, { kinopoiskId: 11 }, { kinopoiskId: 0 }];
                }
            }
        });
        vm.runInContext(`${read('src/pages/home/HomeDataController.js')}\nglobalThis.HomeDataController = HomeDataController;`, context);
        const fm = {
            getRatingService: () => ratingService,
            getTMDBService: () => ({}),
            getMovieCacheService: () => ({ async getCachedMovie(id) { return id === 3 ? { name: 'Дюна', type: 'movie' } : null; } }),
            getIdMappingService: () => ({
                async resolveTmdbIdByKinopoiskId(id, mediaType) {
                    calls.mapping.push([id, mediaType]);
                    return id === 3 && mediaType === 'movie' ? { tmdbId: 438631, mediaType: 'movie' } : null;
                }
            })
        };
        const controller = new context.HomeDataController(fm);
        const result = await controller.getBecauseYouRated('alice', 'en');
        assert.deepEqual(calls.all, [[20, null, 'alice']], 'Newest ratings come from the ordered, indexed query');
        assert.deepEqual(calls.mapping, [[2, 'movie'], [2, 'tv'], [3, 'movie']], 'An unmapped seed falls through to the next one');
        assert.deepEqual(calls.recs, [{ tmdbId: 438631, kinopoiskId: 3, language: 'en-US' }]);
        assert.deepEqual(calls.batch, [[10, 11]], 'Only identified recommendations are checked, in one batch');
        assert.equal(result.source.name, 'Дюна');
        assert.deepEqual(result.items.map(item => item.kinopoiskId), [11]);
    }

    // Styles: the mark stays clear of the Kinopoisk/IMDb badges; hidden wins over .btn.
    const css = read('src/pages/home/home.css');
    const badgeRule = css.match(/\.home-rated-badge \{[^}]*\}/)[0];
    assert.match(badgeRule, /right:\s*8px/);
    assert.doesNotMatch(badgeRule, /left:/);
    assert.match(css, /\.season-banner__cta\[hidden\]\s*\{\s*display:\s*none;/);

    console.log('Home rated marks and because-you-rated row passed.');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
