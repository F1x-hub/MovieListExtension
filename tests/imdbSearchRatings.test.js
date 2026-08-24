const assert = require('node:assert/strict');
const ImdbParsingService = require('../src/shared/services/ImdbParsingService.js');

async function run() {
    const parser = new ImdbParsingService();
    assert.equal(parser.parseVotes('20K'), 20_000);
    assert.equal(parser.parseVotes('1.5M'), 1_500_000);
    assert.equal(parser.parseVotes('2,345'), 2_345);

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

    let requestedUrl = '';
    global.fetch = async url => {
        requestedUrl = url;
        return { ok: true, status: 200, text: async () => '<html>title page</html>' };
    };

    const result = await parser.getImdbRating('tt1234567');
    assert.match(requestedUrl, /imdb\.com\/title\/tt1234567\//);
    assert.deepEqual(result, { rating: 8.1, votes: 395000 });

    global.DOMParser = previousDomParser;
    console.log('✅ IMDb uses the legacy title-page parser by IMDb ID');
}

run().catch(error => {
    console.error('❌ IMDb title-page parser test failed:', error);
    process.exitCode = 1;
});
