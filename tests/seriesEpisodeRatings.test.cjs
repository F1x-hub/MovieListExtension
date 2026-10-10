const assert = require('node:assert/strict');
const SeriesEpisodeRatingService = require('../src/shared/services/SeriesEpisodeRatingService.js');

const DELETE_FIELD = Object.freeze({ deleteField: true });
const clone = value => {
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
};

class FakeFirestore {
    constructor() {
        this.collections = new Map();
        this.failTransactions = false;
        this.readCount = 0;
    }

    collection(name) {
        return {
            doc: id => {
                const ref = { collection: name, id: String(id) };
                ref.get = async () => {
                    this.readCount += 1;
                    const data = this.get(ref);
                    return { exists: data !== null, id: ref.id, data: () => clone(data) };
                };
                return ref;
            }
        };
    }

    get(ref) {
        return this.collections.get(ref.collection)?.get(ref.id) || null;
    }

    runTransaction(callback) {
        if (this.failTransactions) {
            const error = new Error('permission denied');
            error.code = 'permission-denied';
            return Promise.reject(error);
        }
        const writes = [];
        const transaction = {
            get: async ref => {
                const data = this.get(ref);
                return { exists: data !== null, id: ref.id, data: () => clone(data) };
            },
            set: (ref, data) => writes.push({ type: 'set', ref, data: clone(data) }),
            update: (ref, data) => writes.push({ type: 'update', ref, data: clone(data) }),
            delete: ref => writes.push({ type: 'delete', ref })
        };
        return Promise.resolve(callback(transaction)).then(result => {
            writes.forEach(write => {
                let collection = this.collections.get(write.ref.collection);
                if (!collection) this.collections.set(write.ref.collection, collection = new Map());
                if (write.type === 'delete') {
                    collection.delete(write.ref.id);
                } else if (write.type === 'set') {
                    collection.set(write.ref.id, clone(write.data));
                } else {
                    const current = collection.get(write.ref.id);
                    assert.ok(current, `cannot update missing ${write.ref.collection}/${write.ref.id}`);
                    const next = clone(current);
                    Object.entries(write.data).forEach(([key, value]) => {
                        if (value?.deleteField === true) delete next[key];
                        else next[key] = clone(value);
                    });
                    collection.set(write.ref.id, next);
                }
            });
            return result;
        });
    }
}

function createHarness() {
    const db = new FakeFirestore();
    const sideEffects = { ratingsCache: 0, averageCache: 0, personalCache: 0, topGenres: 0, movieCache: 0 };
    const ratingService = {
        db,
        getRatingDocumentId: (uid, movieId) => `${uid}_${movieId}`,
        getRating: async (uid, movieId) => {
            const id = `${uid}_${movieId}`;
            const data = db.get({ collection: 'ratings', id });
            return data ? { id, ...clone(data) } : null;
        },
        resolveMovieDataForRating: async (_movieId, movieData) => movieData,
        normalizeCommentForWrite: value => String(value || '').trim(),
        normalizeReviewForWrite: value => String(value || '').trim(),
        invalidateAverageRatingsCache: async () => { sideEffects.averageCache += 1; },
        invalidateRatingsCache: async () => { sideEffects.personalCache += 1; },
        recalculateUserTopGenres: async () => { sideEffects.topGenres += 1; }
    };
    const manager = {
        db,
        getRatingService: () => ratingService,
        getRatingsCacheService: () => ({ clearCache: async () => { sideEffects.ratingsCache += 1; } }),
        getMovieCacheService: () => ({ cacheMovie: async () => { sideEffects.movieCache += 1; } })
    };
    global.firebase = {
        firestore: {
            Timestamp: { now: () => new Date() },
            FieldValue: { serverTimestamp: () => new Date(), delete: () => DELETE_FIELD }
        }
    };
    return { db, service: new SeriesEpisodeRatingService(manager), sideEffects };
}

const input = (overrides = {}) => ({
    userId: 'user-a',
    userName: 'User A',
    userPhoto: '',
    movieId: 42,
    tmdbId: 84000,
    movieData: { kinopoiskId: 42, tmdbId: 84000, name: 'Series' },
    seasonNumber: 1,
    episodeNumber: 1,
    ...overrides
});

async function run() {
    const rounded = SeriesEpisodeRatingService.calculateAggregate(149, 20);
    assert.deepEqual(rounded, { avg10: 75, episodeAverage: 7.5, rating: 8 }, '7.45 rounds to 7.5 and the public integer is rounded separately');
    assert.equal(SeriesEpisodeRatingService.calculateAggregate(186, 25).episodeAverage, 7.4);
    assert.equal(SeriesEpisodeRatingService.getEpisodeKey(0, 1), '0:1');

    {
        const { db, service } = createHarness();
        const [first, second] = await Promise.all([
            service.getEpisodeRatings('user-a', 42),
            service.getEpisodeRatings('user-a', 42)
        ]);
        assert.equal(db.readCount, 1, 'concurrent page and dialog reads share one private document read');
        assert.equal(first.exists, false);
        assert.equal(second.exists, false);
    }

    {
        const { db, service } = createHarness();
        db.collections.set('ratings', new Map([['user-a_42', {
            userId: 'user-a', movieId: 42, rating: 6, comment: 'Keep this', review: 'Long review',
            isFavorite: true, createdAt: new Date(), updatedAt: new Date()
        }]]));
        await service.setEpisodeRating(input({ rating: 9, seasonNumber: 0, episodeNumber: 1, tmdbEpisodeId: 901 }));
        const episodeDoc = db.get({ collection: 'seriesEpisodeRatings', id: 'user-a_42' });
        const aggregateRating = db.get({ collection: 'ratings', id: 'user-a_42' });
        assert.equal(episodeDoc.episodes['0:1'].id, 901);
        assert.equal(episodeDoc.manualBackup.rating, 6);
        assert.equal(aggregateRating.ratingSource, 'episodes');
        assert.equal(aggregateRating.episodeAverage, 9);
        assert.equal(aggregateRating.rating, 9);
        assert.equal(aggregateRating.comment, 'Keep this');
        assert.equal(aggregateRating.review, 'Long review');
        assert.equal(aggregateRating.isFavorite, true);

        await service.removeEpisodeRating(input({ seasonNumber: 0, episodeNumber: 1 }));
        const restoredRating = db.get({ collection: 'ratings', id: 'user-a_42' });
        assert.equal(db.get({ collection: 'seriesEpisodeRatings', id: 'user-a_42' }), null);
        assert.equal(restoredRating.rating, 6);
        assert.equal(restoredRating.ratingSource, 'manual');
        assert.equal('episodeAverage' in restoredRating, false);
        assert.equal(restoredRating.comment, 'Keep this');
    }

    {
        const { db, service } = createHarness();
        await service.setEpisodeRating(input({ rating: 8 }));
        const ratingRef = { collection: 'ratings', id: 'user-a_42' };
        const existing = db.get(ratingRef);
        db.collections.get('ratings').set('user-a_42', { ...existing, comment: 'Review teaser', review: 'A review' });
        const removed = await service.removeEpisodeRating(input());
        const preserved = db.get(ratingRef);
        assert.equal(removed.commentFallback, true);
        assert.equal(preserved.ratingSource, 'manual');
        assert.equal(preserved.comment, 'Review teaser');
        assert.equal(preserved.review, 'A review');
        assert.equal(preserved.rating, 8);
        assert.equal(db.get({ collection: 'seriesEpisodeRatings', id: 'user-a_42' }), null);
    }

    {
        const { db, service } = createHarness();
        await service.setEpisodeRating(input({ rating: 4 }));
        await service.removeEpisodeRating(input());
        assert.equal(db.get({ collection: 'ratings', id: 'user-a_42' }), null, 'last episode rating without backup or review removes the series rating');
    }

    {
        const { db, service } = createHarness();
        await service.setEpisodeRating(input({ rating: 8, episodeNumber: 1 }));
        await service.saveManualRating({ ...input(), rating: 5 });
        let rating = db.get({ collection: 'ratings', id: 'user-a_42' });
        assert.equal(rating.rating, 5);
        assert.equal(rating.ratingSource, 'manual');
        await service.setEpisodeRating(input({ rating: 10, episodeNumber: 2 }));
        rating = db.get({ collection: 'ratings', id: 'user-a_42' });
        assert.equal(rating.rating, 5, 'episode ratings in manual mode do not overwrite the user override');
        const restored = await service.restoreEpisodeAggregate(input());
        assert.equal(restored.rating.rating, 9);
        assert.equal(restored.rating.episodeAverage, 9);
        assert.equal(restored.state.mode, 'episodes');
    }

    {
        const { db, service } = createHarness();
        await service.setEpisodeRating(input({ rating: 7, episodeNumber: 1 }));
        await service.setEpisodeRating(input({ rating: 9, episodeNumber: 2 }));
        const result = await service.deleteSeriesRating(input());
        assert.equal(result.deletedEpisodes, 2);
        assert.equal(db.get({ collection: 'seriesEpisodeRatings', id: 'user-a_42' }), null);
        assert.equal(db.get({ collection: 'ratings', id: 'user-a_42' }), null);
    }

    {
        const { db, service, sideEffects } = createHarness();
        const [first, second] = await Promise.all([
            service.setEpisodeRating(input({ rating: 7, episodeNumber: 1 })),
            service.setEpisodeRating(input({ rating: 9, episodeNumber: 2 }))
        ]);
        assert.equal(first.state.ratedCount, 1);
        assert.equal(second.state.ratedCount, 2);
        const episodeDoc = db.get({ collection: 'seriesEpisodeRatings', id: 'user-a_42' });
        assert.equal(episodeDoc.ratedCount, 2);
        assert.equal(episodeDoc.ratingSum, 16);
        assert.ok(sideEffects.ratingsCache >= 2);
        assert.equal(sideEffects.watchlist, undefined, 'episode ratings do not remove series from watchlist');
    }

    {
        const { db, service } = createHarness();
        db.failTransactions = true;
        await assert.rejects(service.setEpisodeRating(input({ rating: 8 })), error => error.code === 'permission-denied');
        assert.equal(db.get({ collection: 'seriesEpisodeRatings', id: 'user-a_42' }), null);
        assert.equal(db.get({ collection: 'ratings', id: 'user-a_42' }), null);
    }

    console.log('seriesEpisodeRatings.test.cjs: all tests passed');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
