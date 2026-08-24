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
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
