const assert = require('node:assert/strict');

global.KINOPOISK_CONFIG = {
    BASE_URL: 'https://api.poiskkino.dev/v1.4',
    API_KEY: 'test-key',
    DEFAULT_LIMIT: 20
};

const KinopoiskService = require('../src/shared/services/KinopoiskService.js');
const KinopoiskPersonHtmlService = require('../src/shared/services/KinopoiskPersonHtmlService.js');
const HomeMovieNavigationService = require('../src/pages/home/HomeMovieNavigationService.js');

const searchHtml = `
    <section data-testid="search-films">
        <div data-test-id="movie-list-item">
            <a data-test-id="next-link" href="/film/123456/">
                <span class="styles_mainTitle__abc">Тестовый фильм</span>
                <span class="desktop-list-main-info_secondaryTitle__abc">Test Movie</span>
            </a>
            <div class="styles_kinopoiskValuePositive__abc">
                <div>Рейтинг Кинопоиска 7.4</div>
                <span>7.4</span>
            </div>
            <span class="styles_kinopoiskCount__abc">62 592</span>
            <span>2022</span>
        </div>
    </section>
`;

const service = new KinopoiskService();
const parsed = service.parseSearchResultsHtml(searchHtml, 10);
assert.equal(parsed.success, true);
assert.equal(parsed.items[0].id, 123456);
assert.equal(parsed.items[0].kpRating, 7.4);
assert.equal(parsed.items[0].kpVotes, 62592);

const htmlSearchService = new KinopoiskPersonHtmlService({ fetchImpl: null });
const resolved = htmlSearchService.parseMovieSearchHtml(searchHtml, ['Тестовый фильм'], 2022);
assert.equal(resolved.kinopoiskId, 123456);
assert.equal(resolved.kpRating, 7.4);
assert.equal(resolved.kpVotes, 62592);
assert.equal(resolved.originalTitle, 'Test Movie');
const seriesResolved = htmlSearchService.parseMovieSearchHtml(
    searchHtml.replace('/film/123456/', '/series/123456/'),
    ['Тестовый фильм'],
    2022
);
assert.equal(seriesResolved.kinopoiskId, 123456);
assert.equal(seriesResolved.kpRating, 7.4);

async function runDirectRatingLookupTest() {
    let directLookupOptions = null;
    const navigation = new HomeMovieNavigationService({
        htmlSearchService: {
            async findMovieByTitle(titles, year, options) {
                directLookupOptions = { titles, year, options };
                return {
                    kinopoiskId: 123456,
                    kpRating: 7.4,
                    kpVotes: 62592,
                    imdbRating: 8.1,
                    imdbId: 'tt1234567',
                    originalTitle: 'Test Movie'
                };
            }
        }
    });
    const directResolved = await navigation.resolve({
        movieId: 123456,
        name: 'Тестовый фильм',
        year: 2022
    }, { lookupRatings: true });
    assert.equal(directResolved.kpRating, 7.4);
    assert.equal(directResolved.imdbRating, 8.1);
    assert.equal(directResolved.originalTitle, 'Test Movie');
    assert.equal(directLookupOptions.options.requireRating, true);
}

async function runSchedulerConsumerAccountingTest() {
    let schedulerRequestCalls = 0;
    const schedulerService = new KinopoiskPersonHtmlService({
        kinopoiskService: {
            async scrapeSearchResultsOffscreen() {
                schedulerRequestCalls += 1;
                return {
                    items: [{ id: 123456, title: 'Test Movie', year: 2022, kpRating: 7.4 }]
                };
            }
        }
    });
    await Promise.all([
        schedulerService.findMovieByTitle(['Test Movie'], 2022, {
            requestKey: 'kp-search:test|2022|identity'
        }),
        schedulerService.findMovieByTitle(['Test Movie'], 2022, {
            requestKey: 'kp-search:test|2022|identity'
        })
    ]);
    assert.equal(schedulerRequestCalls, 2);
}

runSchedulerConsumerAccountingTest()
    .catch(error => {
        console.error('âŒ Kinopoisk scheduler consumer test failed:', error);
        process.exitCode = 1;
    });

runDirectRatingLookupTest()
    .then(() => console.log('✅ Kinopoisk search HTML parser extracts KP rating without API calls'))
    .catch(error => {
        console.error('❌ Kinopoisk search ratings test failed:', error);
        process.exitCode = 1;
    });
