const assert = require('node:assert/strict');
const ImdbParsingService = require('../src/shared/services/ImdbParsingService.js');

async function run() {
    const parser = new ImdbParsingService();

    // 1. Test vote parsing
    assert.equal(parser.parseVotes('20K'), 20_000);
    assert.equal(parser.parseVotes('1.5M'), 1_500_000);
    assert.equal(parser.parseVotes('2,345'), 2_345);
    assert.equal(parser.parseVotes(''), 0);

    // 2. Test JSON-LD schema parsing
    const jsonLdHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <script type="application/ld+json">
            {
                "@context": "https://schema.org",
                "@type": "Movie",
                "name": "The Dog Stars",
                "aggregateRating": {
                    "@type": "AggregateRating",
                    "ratingCount": 2048,
                    "bestRating": 10,
                    "worstRating": 1,
                    "ratingValue": 6.5
                }
            }
            </script>
        </head>
        <body></body>
        </html>
    `;
    const jsonLdResult = parser.parseImdbPage(jsonLdHtml);
    assert.deepEqual(jsonLdResult, { rating: 6.5, votes: 2048 });

    // 3. Test DOM fallback parsing
    const votesNode = { textContent: '395K' };
    const scoreNode = {
        textContent: '8.1',
        parentElement: { children: [{}, {}, votesNode] }
    };
    const previousDomParser = global.DOMParser;
    global.DOMParser = class {
        parseFromString() {
            return {
                querySelector(selector) {
                    if (selector.includes('__score')) return scoreNode;
                    return null;
                }
            };
        }
    };

    let requestedUrls = [];
    global.fetch = async url => {
        requestedUrls.push(url);
        if (url.includes('/suggestion/')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    d: [
                        { id: 'tt21285562', l: 'The Dog Stars', y: 2026, q: 'feature' },
                        { id: 'tt0271902', l: 'Children of the Dog Star', y: 1984, q: 'TV mini-series' }
                    ]
                })
            };
        }
        return { ok: true, status: 200, text: async () => '<html>title page</html>' };
    };

    // 4. Test getImdbRating by ID
    const resultById = await parser.getImdbRating('tt1234567');
    assert.match(requestedUrls[0], /imdb\.com\/title\/tt1234567\//);
    assert.deepEqual(resultById, { rating: 8.1, votes: 395000, imdbId: 'tt1234567' });

    // 5. Test findImdbId by title & year
    const foundId = await parser.findImdbId('The Dog Stars', 2026);
    assert.equal(foundId, 'tt21285562');

    // 6. Test getImdbRatingByTitle
    const resultByTitle = await parser.getImdbRatingByTitle('The Dog Stars', 2026);
    assert.deepEqual(resultByTitle, { rating: 8.1, votes: 395000, imdbId: 'tt21285562' });

    global.DOMParser = previousDomParser;
    console.log('✅ IMDb title-page parser, suggestions search, and JSON-LD schema tests passed successfully!');
}

run().catch(error => {
    console.error('❌ IMDb title-page parser test failed:', error);
    process.exitCode = 1;
});
