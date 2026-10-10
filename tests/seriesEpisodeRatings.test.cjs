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
        this.transactionReads = [];
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
                this.transactionReads.push(ref.collection);
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
    assert.equal(SeriesEpisodeRatingService.getEpisodeKey(0, 1), '0:1');
    assert.throws(() => SeriesEpisodeRatingService.getEpisodeKey(-1, 1));
    const ref = { collection: 'seriesEpisodeRatings', id: 'user-a_42' };
    {
        const { db, service } = createHarness();
        const [first, second] = await Promise.all([
            service.getEpisodeRatings('user-a', 42), service.getEpisodeRatings('user-a', 42)
        ]);
        assert.equal(db.readCount, 1);
        assert.equal(first.exists, false);
        assert.equal(second.exists, false);
    }
    {
        const { db, service, sideEffects } = createHarness();
        const title = { userId: 'user-a', movieId: 42, rating: 6,
            comment: 'Keep', review: 'Review', isFavorite: true, createdAt: new Date() };
        db.collections.set('ratings', new Map([['user-a_42', clone(title)]]));
        const first = await service.setEpisodeRating(input({ rating: 9, seasonNumber: 0, tmdbEpisodeId: 901 }));
        assert.equal(first.state.episodes['0:1'].r, 9);
        assert.equal(db.get(ref).episodes['0:1'].id, 901);
        assert.deepEqual(Object.keys(db.get(ref)).sort(),
            ['userId', 'movieId', 'tmdbId', 'episodes', 'lastKey', 'updatedAt'].sort());
        const cached = await service.getEpisodeRatings('user-a', 42);
        cached.episodes['0:1'].r = 1;
        assert.equal((await service.getEpisodeRatings('user-a', 42)).episodes['0:1'].r, 9,
            'returned state does not share mutable episode entries with cache');
        await service.setEpisodeRating(input({ rating: 5, seasonNumber: 0 }));
        assert.equal(db.get(ref).episodes['0:1'].r, 5);
        await service.removeEpisodeRating(input({ seasonNumber: 0 }));
        assert.equal(db.get(ref), null, 'last private score deletes only private document');
        assert.deepEqual(db.get({ collection: 'ratings', id: 'user-a_42' }), title);
        assert.ok(Object.values(sideEffects).every(count => count === 0), 'no public caches, genres or movie metadata effects');
        assert.ok(db.transactionReads.every(name => name === 'seriesEpisodeRatings'));
        assert.equal((await service.removeEpisodeRating(input())).changed, false);
    }
    {
        const { db, service } = createHarness();
        const t = new Date();
        db.collections.set('seriesEpisodeRatings', new Map([['user-a_42', {
            userId: 'user-a', movieId: 42, tmdbId: 123,
            episodes: { '1:1': { r: 8, t, id: 91 } }, lastKey: '1:1', updatedAt: t,
            ratingSum: 8, ratedCount: 1, mode: 'episodes', manualBackup: { rating: 4 }
        }]]));
        const legacy = await service.getEpisodeRatings('user-a', 42);
        assert.equal(legacy.episodes['1:1'].r, 8);
        assert.equal('mode' in legacy, false);
        await service.setEpisodeRating(input({ rating: 10, episodeNumber: 2 }));
        const document = db.get(ref);
        assert.equal(document.episodes['1:1'].id, 91);
        for (const key of ['ratingSum', 'ratedCount', 'mode', 'manualBackup']) assert.equal(key in document, false);
        await service.removeEpisodeRating(input({ episodeNumber: 1 }));
        assert.equal(Object.keys(db.get(ref).episodes).length, 1);
        assert.equal(db.get({ collection: 'ratings', id: 'user-a_42' }), null);
    }
    {
        const { db, service } = createHarness();
        const [first, second] = await Promise.all([
            service.setEpisodeRating(input({ rating: 7 })),
            service.setEpisodeRating(input({ rating: 9, episodeNumber: 2 }))
        ]);
        assert.equal(Object.keys(first.state.episodes).length, 1);
        assert.equal(Object.keys(second.state.episodes).length, 2, 'series queue prevents lost updates');
        assert.equal(Object.keys(db.get(ref).episodes).length, 2);
    }
    {
        const { db, service } = createHarness();
        const collection = db.collection.bind(db);
        let finishRead;
        db.collection = name => {
            const original = collection(name);
            return {
                doc: id => {
                    const doc = original.doc(id);
                    const get = doc.get;
                    doc.get = async () => {
                        const stale = await get();
                        await new Promise(resolve => { finishRead = resolve; });
                        return stale;
                    };
                    return doc;
                }
            };
        };
        const loading = service.getEpisodeRatings('user-a', 42);
        await Promise.resolve();
        await service.setEpisodeRating(input({ rating: 8 }));
        finishRead();
        await loading;
        assert.equal((await service.getEpisodeRatings('user-a', 42)).episodes['1:1'].r, 8,
            'a late page read cannot overwrite a newly committed private cache');
    }
    {
        const { db, service } = createHarness();
        await service.setEpisodeRating(input({ rating: 4 }));
        db.failTransactions = true;
        await assert.rejects(service.setEpisodeRating(input({ rating: 8 })), error => error.code === 'permission-denied');
        assert.equal(db.get(ref).episodes['1:1'].r, 4);
        assert.equal((await service.getEpisodeRatings('user-a', 42)).episodes['1:1'].r, 4);
        db.failTransactions = false;
        await service.setEpisodeRating(input({ rating: 9 }));
        assert.equal(db.get(ref).episodes['1:1'].r, 9, 'failed request does not poison series queue');
        await assert.rejects(service.setEpisodeRating(input({ rating: 7.5 })));
    }
    console.log('seriesEpisodeRatings.test.cjs: all tests passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
