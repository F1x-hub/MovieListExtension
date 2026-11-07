const assert = require('node:assert/strict');

global.window = global;

const storageValues = {
    movie_card_ratings_v4: {
        'kp:5287148': {
            kpId: 5287148,
            kpRating: 5.9,
            imdbRating: 8.1,
            votes: { kp: 3662, imdb: 16300 },
            expiresAt: Date.now() + 60_000
        }
    }
};

global.chrome = {
    storage: {
        local: {
            async get(key) {
                if (typeof key === 'string') return { [key]: storageValues[key] };
                return Object.fromEntries(key.map(name => [name, storageValues[name]]));
            },
            async set(values) {
                Object.assign(storageValues, values);
            }
        }
    }
};

const database = {
    collection() {
        return {
            doc() {
                return {
                    async get() {
                        return { exists: false, data: () => ({}) };
                    }
                };
            }
        };
    }
};

global.firebase = {
    firestore: {
        FieldValue: {
            serverTimestamp: () => 'server-timestamp'
        }
    }
};

let kpCalls = 0;
let imdbCalls = 0;
global.KinopoiskRatingParsingService = class {
    async getKinopoiskRating() {
        kpCalls += 1;
        return { rating: 6.1, votes: 4000 };
    }
};
global.ImdbParsingService = class {
    async getImdbRating() {
        imdbCalls += 1;
        return { rating: 8.4, votes: 17000 };
    }
};

require('../src/shared/services/RatingsRefreshService.js');

async function run() {
    const service = new global.RatingsRefreshService({ db: database });
    const result = await service.checkAndRefreshRatings(5287148, 'tt27165187');

    assert.equal(result.kpRating, 5.9);
    assert.equal(result.imdbRating, 8.1);
    assert.equal(result.votes.imdb, 16300);
    assert.equal(kpCalls, 0);
    assert.equal(imdbCalls, 0);

    storageValues.movie_card_ratings_v4['kp:5287148'].imdbRating = 0;
    storageValues.movie_card_ratings_v4['kp:5287148'].votes.imdb = 0;
    const partialResult = await service.checkAndRefreshRatings(5287148, 'tt27165187');

    assert.equal(partialResult.kpRating, 5.9);
    assert.equal(partialResult.imdbRating, 8.4);
    assert.equal(partialResult.votes.imdb, 17000);
    assert.equal(kpCalls, 0);
    assert.equal(imdbCalls, 1);

    console.log('✅ RatingsRefreshService reuses fresh Home/Catalog provider cache');

    // Kinopoisk's GraphQL answers first; the page parser runs only without it.
    {
        const local = {};
        const parse = new global.RatingsRefreshService({ db: database });
        parse.getLocalMovie = async id => local[id] || {};
        parse.saveLocalMovie = async (id, movie) => { local[id] = movie; };
        global.KinopoiskGraphqlService = class {
            async getMovieRatings() {
                return { kpRating: 5.4, kpVotes: 621, imdbRating: 0, imdbVotes: 0, imdbAnswered: false };
            }
        };
        kpCalls = 0;
        imdbCalls = 0;
        const result = await parse.checkAndRefreshRatings(9147477, 'tt13611778');
        assert.equal(result.kpRating, 5.4);
        assert.equal(result.votes.kp, 621);
        assert.equal(kpCalls, 0, 'no Kinopoisk page parse when GraphQL answered');
        assert.equal(imdbCalls, 1, 'IMDb still comes from its own source');
        assert.equal(result.imdbRating, 8.4);

        // A title with both ratings in GraphQL needs no other source.
        global.KinopoiskGraphqlService = class {
            async getMovieRatings() {
                return { kpRating: 9.1, kpVotes: 10, imdbRating: 9.3, imdbVotes: 20, imdbAnswered: true };
            }
        };
        imdbCalls = 0;
        const full = await parse.checkAndRefreshRatings(326, 'tt0111161');
        assert.equal(full.kpRating, 9.1);
        assert.equal(full.imdbRating, 9.3);
        assert.equal(imdbCalls, 0);

        // A GraphQL failure falls back to the page parser.
        global.KinopoiskGraphqlService = class {
            async getMovieRatings() { throw new Error('the query is not allowed'); }
        };
        kpCalls = 0;
        const fallback = await parse.checkAndRefreshRatings(435, null);
        assert.equal(fallback.kpRating, 6.1);
        assert.equal(kpCalls, 1);
        delete global.KinopoiskGraphqlService;
    }

    // A parse from earlier this week may have run while the IMDb proxy was down.
    {
        const parse = new global.RatingsRefreshService({ db: database });
        parse.getLocalMovie = async () => ({ kpRating: 7.1, votes: { kp: 50 }, lastRatingsParsedAt: new Date().toISOString() });
        const originalParser = global.ImdbParsingService;
        const asked = [];
        global.ImdbParsingService = class {
            async getImdbRatingsBatch(ids) {
                asked.push(...ids);
                return new Map([[ids[0], { rating: 7.8, votes: 14696 }]]);
            }
        };
        const result = await parse.checkAndRefreshRatings(5158783, 'tt23112594');
        assert.deepEqual(asked, ['tt23112594']);
        assert.equal(result.imdbRating, 7.8);
        assert.equal(result.votes.imdb, 14696);
        assert.equal(result.imdbChecked, true);

        global.ImdbParsingService = class {
            async getImdbRatingsBatch(ids) { return new Map([[ids[0], { rating: 0, votes: 0 }]]); }
        };
        const unrated = await parse.checkAndRefreshRatings(5158783, 'tt23112594');
        assert.equal(unrated.imdbRating, 0);
        assert.ok(unrated.imdbCheckedAt > 0, 'a real "no rating" answer is remembered');
        global.ImdbParsingService = originalParser;
    }

    // Parallel patches each replace the whole cache: none may lose another's title.
    if (globalThis.navigator?.locks) {
        const slow = new global.RatingsRefreshService({ db: database });
        const savedGet = global.chrome.storage.local.get;
        global.chrome.storage.local.get = async key => {
            await new Promise(resolve => setTimeout(resolve, 2));
            return savedGet(key);
        };
        await Promise.all([386, 467099, 695548, 8366].map(id => slow.persistCardRatingPatch(id, { kpRating: 7, imdbRating: 7 })));
        global.chrome.storage.local.get = savedGet;
        for (const id of [386, 467099, 695548, 8366]) {
            assert.equal(storageValues.movie_card_ratings_v4[`kp:${id}`]?.kpRating, 7, `kp:${id} must survive parallel patches`);
        }
    }
    console.log('✅ RatingsRefreshService reads GraphQL first, asks the IMDb proxy again and keeps parallel patches');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
