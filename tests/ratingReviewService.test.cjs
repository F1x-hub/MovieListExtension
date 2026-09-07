const assert = require('assert/strict');

global.RatingConfig = require('../src/shared/config/rating.config.js');
global.firebase = {
    firestore: {
        FieldValue: {
            serverTimestamp: () => ({ __serverTimestamp: true })
        }
    }
};

const RatingService = require('../src/shared/services/RatingService.js');
const RatingsCacheService = require('../src/shared/services/RatingsCacheService.js');

function createDocument(id, data, exists = true) {
    return {
        id,
        exists,
        data: () => data
    };
}

function createTransactionDb(document) {
    const updates = [];
    const ratingRef = {
        id: document.id,
        get: async () => document
    };
    const db = {
        updates,
        collection(name) {
            assert.equal(name, 'ratings');
            return {
                doc(id) {
                    assert.equal(String(id), document.id);
                    return ratingRef;
                }
            };
        },
        async runTransaction(callback) {
            const transaction = {
                get: async () => document,
                update: (ref, data) => updates.push({ ref, data })
            };
            return callback(transaction);
        }
    };
    return db;
}

async function testTextOnlyUpdatePreservesAggregateFields() {
    const document = createDocument('user-1_42', {
        userId: 'user-1',
        movieId: 42,
        rating: 8,
        comment: 'старый комментарий',
        review: 'старая рецензия',
        updatedAt: { seconds: 123 },
        createdAt: { seconds: 100 }
    });
    const db = createTransactionDb(document);
    const service = new RatingService({ db });
    service.invalidateRatingTextCaches = async () => {};

    const result = await service.updateRatingText('user-1', document.id, {
        comment: 'новый\r\nкомментарий',
        review: ''
    });

    assert.equal(db.updates.length, 1);
    assert.deepEqual(db.updates[0].data.comment, 'новый\nкомментарий');
    assert.equal(db.updates[0].data.review, '');
    assert.ok(db.updates[0].data.contentUpdatedAt);
    assert.equal(Object.hasOwn(db.updates[0].data, 'rating'), false);
    assert.equal(Object.hasOwn(db.updates[0].data, 'movieId'), false);
    assert.equal(Object.hasOwn(db.updates[0].data, 'updatedAt'), false);
    assert.equal(result.review, '');
    assert.equal(result.hasReview, false);
}

async function testTextOnlyUpdateRejectsInvalidOwnerAndLength() {
    const document = createDocument('user-1_42', {
        userId: 'user-1',
        movieId: 42,
        rating: 8
    });
    const service = new RatingService({ db: createTransactionDb(document) });

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        await assert.rejects(
            service.updateRatingText('user-2', document.id, { review: 'текст' }),
            /Only the rating owner can edit its text/
        );
        await assert.rejects(
            service.updateRatingText('user-1', document.id, { review: 'x'.repeat(5001) }),
            /5000 characters or less/
        );
    } finally {
        console.error = originalConsoleError;
    }
}

async function testReadModelsAreCompactByDefault() {
    const docs = [
        createDocument('user-1_42', {
            userId: 'user-1', movieId: 42, rating: 9,
            review: 'полный текст', createdAt: new Date('2026-01-02')
        })
    ];
    const db = {
        collection() {
            return {
                where() {
                    return { get: async () => ({ forEach: callback => docs.forEach(callback) }) };
                }
            };
        }
    };
    const service = new RatingService({ db });
    const compact = await service.getMovieRatings(42);
    const full = await service.getMovieRatings(42, 20, { includeReview: true });

    assert.equal(compact[0].hasReview, true);
    assert.equal(compact[0].reviewLength, 12);
    assert.equal(Object.hasOwn(compact[0], 'review'), false);
    assert.equal(full[0].review, 'полный текст');
}

async function testCompactCachePreservesReviewMetadata() {
    const storage = {};
    global.chrome = {
        storage: {
            local: {
                set: async values => Object.assign(storage, values),
                get: async keys => {
                    if (keys === null) return { ...storage };
                    return keys.reduce((result, key) => {
                        if (Object.hasOwn(storage, key)) result[key] = storage[key];
                        return result;
                    }, {});
                }
            }
        }
    };

    const cache = new RatingsCacheService({});
    await cache.cacheRatings([{
        id: 'user-1_42',
        movieId: 42,
        hasReview: true,
        reviewLength: 12
    }]);

    const cached = await cache.getCacheData();
    assert.equal(cached.ratings[0].hasReview, true);
    assert.equal(cached.ratings[0].reviewLength, 12);
    assert.equal(Object.hasOwn(cached.ratings[0], 'review'), false);
    delete global.chrome;
}

Promise.resolve()
    .then(testTextOnlyUpdatePreservesAggregateFields)
    .then(testTextOnlyUpdateRejectsInvalidOwnerAndLength)
    .then(testReadModelsAreCompactByDefault)
    .then(testCompactCachePreservesReviewMetadata)
    .then(() => console.log('Rating review service tests passed'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
