/**
 * Batched IMDb ratings: the `imdbRatings` Cloud Function handler, the
 * ImdbParsingService client with its failure back-off, Kinopoisk search
 * matching by media type and title length, and the movie-page scraper exit.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createImdbRatingsHandler, parseImdbIds, IMDB_MAX_IDS } = require('../functions/imdbRatingsProxy.js');
const ImdbParsingService = require('../src/shared/services/ImdbParsingService.js');
const KinopoiskPersonHtmlService = require('../src/shared/services/KinopoiskPersonHtmlService.js');

function createResponse() {
    return {
        body: null,
        headers: {},
        statusCode: null,
        json(value) { this.body = value; return this; },
        send(value) { this.body = value; return this; },
        set(name, value) { this.headers[name] = value; return this; },
        status(value) { this.statusCode = value; return this; }
    };
}

async function run() {
    // --- Cloud Function -----------------------------------------------------
    assert.deepEqual(parseImdbIds('tt0111161, tt0111161,tt1375666'), ['tt0111161', 'tt1375666']);
    assert.equal(parseImdbIds('tt0111161,} title(id:"x")'), null, 'GraphQL text is never accepted');
    assert.equal(parseImdbIds(''), null);
    assert.equal(parseImdbIds(Array.from({ length: IMDB_MAX_IDS + 1 }, (_, i) => `tt${String(1000000 + i)}`).join(',')), null);

    let upstreamRequest = null;
    const handler = createImdbRatingsHandler({
        fetchImpl: async (url, options) => {
            upstreamRequest = { url, options };
            return {
                ok: true,
                json: async () => ({
                    data: {
                        titles: [
                            { id: 'tt0111161', ratingsSummary: { aggregateRating: 9.3, voteCount: 3000000 } },
                            { id: 'tt30000001', ratingsSummary: { aggregateRating: null, voteCount: 0 } }
                        ]
                    }
                })
            };
        },
        logger: { warn() {}, error() {} }
    });

    const ok = createResponse();
    await handler({ method: 'GET', headers: { origin: 'chrome-extension://abc' }, query: { ids: 'tt0111161,tt30000001' } }, ok);
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.body.ratings, {
        tt0111161: { rating: 9.3, votes: 3000000 },
        tt30000001: { rating: 0, votes: 0 }
    });
    assert.equal(ok.headers['Access-Control-Allow-Origin'], 'chrome-extension://abc');
    assert.match(ok.headers['Cache-Control'], /max-age=\d+/);
    assert.equal(upstreamRequest.options.method, 'POST');
    assert.equal(upstreamRequest.options.headers['x-imdb-client-name'], 'imdb-web-next-localized');
    assert.match(JSON.parse(upstreamRequest.options.body).query, /titles\(ids: \["tt0111161","tt30000001"\]\)/);

    const forbidden = createResponse();
    await handler({ method: 'GET', headers: { origin: 'https://evil.example' }, query: { ids: 'tt0111161' } }, forbidden);
    assert.equal(forbidden.statusCode, 403);

    const badIds = createResponse();
    await handler({ method: 'GET', headers: {}, query: { ids: 'nope' } }, badIds);
    assert.equal(badIds.statusCode, 400);

    const failing = createImdbRatingsHandler({
        fetchImpl: async () => ({ ok: false, status: 403 }),
        logger: { warn() {}, error() {} }
    });
    const upstreamFailure = createResponse();
    await failing({ method: 'GET', headers: {}, query: { ids: 'tt0111161' } }, upstreamFailure);
    assert.equal(upstreamFailure.statusCode, 502);

    // --- Client -------------------------------------------------------------
    const requests = [];
    let failNext = false;
    global.fetch = async url => {
        requests.push(url);
        if (failNext) return { ok: false, status: 404, json: async () => ({}) };
        const ids = decodeURIComponent(new URL(url).searchParams.get('ids')).split(',');
        return {
            ok: true,
            json: async () => ({ ratings: Object.fromEntries(ids.map(id => [id, { rating: 7, votes: 10 }])) })
        };
    };
    const client = new ImdbParsingService();
    client.ratingsBatchSize = 2;
    const batch = await client.getImdbRatingsBatch(['tt0000001', 'tt0000002', 'tt0000003', 'bad', 'tt0000001']);
    assert.equal(requests.length, 2, 'IDs are deduplicated and sent in chunks');
    assert.equal(batch.size, 3);
    assert.deepEqual(batch.get('tt0000003'), { rating: 7, votes: 10 });

    failNext = true;
    assert.equal(await client.getImdbRatingsBatch(['tt0000009']), null, 'proxy failure returns null');
    const requestsAfterFailure = requests.length;
    assert.equal(await client.getImdbRatingsBatch(['tt0000010']), null);
    assert.equal(requests.length, requestsAfterFailure, 'a failed proxy is not retried immediately');
    delete global.fetch;

    // --- Kinopoisk search matching --------------------------------------------
    const kp = new KinopoiskPersonHtmlService({});
    const results = [
        { id: 1, type: 'film', title: 'Колония', year: 2026 },
        { id: 2, type: 'series', title: 'Колония', year: 2026 }
    ];
    assert.equal(kp._selectMovieSearchResult(results, ['Колония'], 2026, { mediaType: 'tv' }).id, 2, 'TV cards prefer series');
    assert.equal(kp._selectMovieSearchResult(results, ['Колония'], 2026, { mediaType: 'movie' }).id, 1);
    assert.equal(
        kp._selectMovieSearchResult([{ id: 3, type: 'film', title: 'Колония', year: 2026 }], ['Колония'], 2026, { mediaType: 'tv' }),
        null,
        'a candidate with the wrong media type cannot verify an identity'
    );
    assert.equal(
        kp._selectMovieSearchResult([{ id: 4, type: 'film', title: 'Мятеж на Баунти', year: 2026 }], ['Мятеж'], 2026, { mediaType: 'movie' }),
        null,
        'a short title inside a much longer one is not a match'
    );
    assert.equal(
        kp._selectMovieSearchResult([{ id: 5, type: 'film', title: 'Одиссея: начало', year: 2026 }], ['Одиссея начало'], 2026, { mediaType: 'movie' }).id,
        5
    );

    // --- Movie-page scraper -------------------------------------------------
    const scraper = fs.readFileSync(path.join(__dirname, '../content-scripts/kinopoisk-search-scraper.js'), 'utf8');
    assert.match(scraper, /if \(ratings\.kpRating > 0 && ratings\.imdbRating > 0\) \{/, 'both ratings end the wait without vote counts');
    assert.ok(!scraper.includes('(?:IMDb|imdb)[^\\d]{0,80}'), 'loose script regex removed');
    assert.match(scraper, /"imdb"\\s\*:\\s\*\\\{/);

    console.log('IMDb ratings batch tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
