import assert from 'node:assert';
import KINOPOISK_CONFIG from '../src/shared/config/kinopoisk.config.js';
globalThis.KINOPOISK_CONFIG = KINOPOISK_CONFIG;
import KinopoiskService from '../src/shared/services/KinopoiskService.js';

console.log('🧪 Running Hybrid Search Relevance & Scraper Fallback Tests...\n');

const service = new KinopoiskService();

// -------------------------------------------------------------
// Test 1: HTML Parsing with valid sections & divergent anchors
// -------------------------------------------------------------
console.log('1. Testing parseSearchResultsHtml with valid sections and divergent anchors...');

const mockHtml = `
<!DOCTYPE html>
<html>
<body>
<main>
  <!-- Top result section -->
  <section data-testid="search-top-result" class="top-result">
    <div class="card">
      <div class="styles_root__vaZRT"><a href="/film/6530127/">Image</a></div>
      <a data-test-id="next-link" href="/film/6530127/">Вот это драма!</a>
    </div>
  </section>

  <!-- Persons section - MUST BE IGNORED -->
  <section data-testid="search-persons">
    <div class="person-card">
      <a data-test-id="next-link" href="/name/12345/">Иван Драматический</a>
    </div>
  </section>

  <!-- Movie lists section - MUST BE IGNORED -->
  <section data-testid="search-movie-lists">
    <div class="list-card">
      <a data-test-id="next-link" href="https://www.kinopoisk.ru/lists/movies/100/">Лучшие драмы</a>
    </div>
  </section>

  <!-- Films and series section -->
  <section data-testid="search-films">
    <!-- Anime series: Image wrapper says /film/843937/, but next-link says /series/843937/ -->
    <div class="card">
      <div class="styles_root__vaZRT"><a href="/film/843937/">Anime Img</a></div>
      <a href="/series/843937/" data-test-id="next-link">Драматическое убийство</a>
    </div>

    <!-- Regular film -->
    <div class="card">
      <a data-test-id="next-link" href="/film/549301/">Драма (2010)</a>
    </div>

    <!-- Duplicate of top-result (must be deduplicated) -->
    <div class="card">
      <a data-test-id="next-link" href="/film/6530127/">Вот это драма!</a>
    </div>

    <!-- Short film -->
    <div class="card">
      <a data-test-id="next-link" href="/film/43891/">Драма (1960)</a>
    </div>
  </section>
</main>
</body>
</html>
`;

const parsed = service.parseSearchResultsHtml(mockHtml, 20);

assert.strictEqual(parsed.success, true, 'Parsing should succeed');
assert.strictEqual(parsed.items.length, 4, 'Should extract exactly 4 unique movies/series');

// Check items and order
assert.deepStrictEqual(parsed.items[0], { type: 'film', id: 6530127 }, 'First item must be "Вот это драма!" (film)');
assert.deepStrictEqual(parsed.items[1], { type: 'series', id: 843937 }, 'Second item must be "Драматическое убийство" with type "series" (not "film" from image wrapper)');
assert.deepStrictEqual(parsed.items[2], { type: 'film', id: 549301 }, 'Third item must be "Драма" 2010 (film)');
assert.deepStrictEqual(parsed.items[3], { type: 'film', id: 43891 }, 'Fourth item must be "Драма" 1960 (film)');

console.log('✅ HTML parsing, section filtering, type extraction, and deduplication passed!');

// -------------------------------------------------------------
// Test 2: Detection of Captcha / SSO Redirect / Anti-bot Challenge
// -------------------------------------------------------------
console.log('\n2. Testing anti-bot / SSO challenge detection...');

const ssoChallengeHtml = `
<body></body><script nonce="123">var it = {"host":"https://sso.kinopoisk.ru/install?uuid=abc","retpath":"https://www.kinopoisk.ru/new-search/?text=драма","root":"sso.passport.yandex.ru"};_runBlockingProbe();</script>
`;

const ssoResult = service.parseSearchResultsHtml(ssoChallengeHtml, 20);
assert.strictEqual(ssoResult.success, false, 'SSO challenge must fail parsing');
assert.strictEqual(ssoResult.reason, 'CAPTCHA_OR_SSO_CHALLENGE', 'Reason should be CAPTCHA_OR_SSO_CHALLENGE');

const smartCaptchaHtml = `<html><body><div id="smartcaptcha" class="smart-captcha"></div></body></html>`;
const captchaResult = service.parseSearchResultsHtml(smartCaptchaHtml, 20);
assert.strictEqual(captchaResult.success, false, 'Captcha challenge must fail parsing');
assert.strictEqual(captchaResult.reason, 'CAPTCHA_OR_SSO_CHALLENGE', 'Reason should be CAPTCHA_OR_SSO_CHALLENGE');

console.log('✅ SSO and Captcha challenge detection passed!');

// -------------------------------------------------------------
// Test 3: Unexpected layout / empty page handling
// -------------------------------------------------------------
console.log('\n3. Testing unexpected layout vs empty page...');

const largeUnexpectedHtml = '<html><body>' + '<div>Unknown layout content</div>'.repeat(100) + '</body></html>';
const unexpectedResult = service.parseSearchResultsHtml(largeUnexpectedHtml, 20);
assert.strictEqual(unexpectedResult.success, false, 'Large unrecognized HTML should trigger layout error');
assert.strictEqual(unexpectedResult.reason, 'LAYOUT_CHANGED_OR_UNEXPECTED_HTML');

const cleanEmptyHtml = '<html><body><main></main></body></html>';
const emptyResult = service.parseSearchResultsHtml(cleanEmptyHtml, 20);
assert.strictEqual(emptyResult.success, true, 'Small clean page should succeed with empty array');
assert.strictEqual(emptyResult.items.length, 0);

console.log('✅ Layout and empty page handling passed!');

// -------------------------------------------------------------
// Test 4: Batch ID fetching and exact order preservation
// -------------------------------------------------------------
console.log('\n4. Testing getMoviesByIdsBatch order preservation...');

// Mock _fetchWithRotation on the service instance
const originalFetch = service._fetchWithRotation;
service._fetchWithRotation = async () => {
    // Return mock docs in randomized/out-of-order sequence
    return {
        ok: true,
        json: async () => ({
            docs: [
                { id: 43891, name: 'Драма', year: 1960, genres: [{ name: 'короткометражка' }] },
                { id: 6530127, name: 'Вот это драма!', year: 2026, genres: [{ name: 'комедия' }] },
                { id: 843937, name: 'Драматическое убийство', year: 2014, genres: [{ name: 'аниме' }] },
                { id: 549301, name: 'Драма', year: 2010, genres: [{ name: 'драма' }] }
            ]
        })
    };
};

const scrapedItems = [
    { type: 'film', id: 6530127 },
    { type: 'series', id: 843937 },
    { type: 'film', id: 549301 },
    { type: 'film', id: 43891 }
];

const batchResult = await service.getMoviesByIdsBatch(scrapedItems);
assert.strictEqual(batchResult.length, 4, 'Should return all 4 movies');
assert.strictEqual(batchResult[0].name, 'Вот это драма!', '1st movie must be "Вот это драма!"');
assert.strictEqual(batchResult[1].name, 'Драматическое убийство', '2nd movie must be "Драматическое убийство"');
assert.strictEqual(batchResult[1].isSeries, true, 'Series item must have isSeries: true');
assert.strictEqual(batchResult[2].name, 'Драма', '3rd movie must be "Драма" (2010)');
assert.strictEqual(batchResult[2].year, 2010);
assert.strictEqual(batchResult[3].name, 'Драма', '4th movie must be "Драма" (1960)');
assert.strictEqual(batchResult[3].year, 1960);

console.log('✅ Batch ID fetching preserved exact scraped order without popularity reordering!');

// -------------------------------------------------------------
// Test 5: Full searchMovies orchestration & searchSource tag
// -------------------------------------------------------------
console.log('\n5. Testing searchMovies hybrid success vs fallback...');

// Scenario A: Scraper succeeds
service.scrapeSearchResults = async () => scrapedItems;
const searchSuccess = await service.searchMovies('драма', 1, 10);
assert.strictEqual(searchSuccess.searchSource, 'kinopoisk-scrape', 'Source must be kinopoisk-scrape');
assert.strictEqual(searchSuccess.docs[0].name, 'Вот это драма!');

// Scenario A2: Search page receives ordered parser candidates before slow entity resolution
let fastPathBatchSettled = false;
service._fetchWithRotation = async () => {
    await new Promise(resolve => setTimeout(resolve, 15));
    fastPathBatchSettled = true;
    return {
        ok: true,
        json: async () => ({
            docs: [
                { id: 43891, name: 'Драма', year: 1960 },
                { id: 6530127, name: 'Вот это драма!', year: 2026 },
                { id: 843937, name: 'Драматическое убийство', year: 2014 },
                { id: 549301, name: 'Драма', year: 2010 }
            ]
        })
    };
};
const fastPathResult = await service.searchMovies('драма', 1, 10, {
    skipOffscreen: true,
    deferEntityResolution: true
});
assert.strictEqual(fastPathResult.entityResolutionDeferred, true, 'Entity resolution must be deferred');
assert.strictEqual(fastPathBatchSettled, false, 'Search must return before the batch request settles');
assert.deepStrictEqual(
    fastPathResult.docs.map(movie => movie.kinopoiskId),
    scrapedItems.map(item => item.id),
    'Fast candidates must preserve parser order'
);
const fastPathEnriched = await fastPathResult.entityResolutionPromise;
assert.strictEqual(fastPathEnriched[0].name, 'Вот это драма!', 'Deferred enrichment must preserve parser order');
assert.strictEqual(fastPathBatchSettled, true, 'Deferred batch must eventually settle');

// Scenario B: Scraper fails (returns null) -> Fallback to /movie/search
service.scrapeSearchResults = async () => null;
service._fetchWithRotation = async () => ({
    ok: true,
    json: async () => ({
        docs: [
            { id: 1100777, name: 'Триггер', year: 2018, votes: { kp: 2000000 } },
            { id: 326, name: 'Побег из Шоушенка', year: 1994, votes: { kp: 1100000 } }
        ],
        total: 1000,
        page: 1,
        limit: 10,
        pages: 100
    })
});

const searchFallback = await service.searchMovies('драма', 1, 10);
assert.strictEqual(searchFallback.searchSource, 'api-fallback', 'Source must be api-fallback on scraper failure');
assert.strictEqual(searchFallback.docs.length, 2);

// Restore original method
service._fetchWithRotation = originalFetch;

console.log('✅ Hybrid search orchestration and searchSource tagging passed!');
console.log('\n🎉 ALL HYBRID SEARCH RELEVANCE TESTS PASSED SUCCESSFULLY!\n');
