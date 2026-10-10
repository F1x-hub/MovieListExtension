const assert = require('node:assert/strict');
const RatingService = require('../src/shared/services/RatingService.js');

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
        this.transactions = [];
        this.directReads = [];
        this.deniedTransactionCollections = new Set();
    }

    collection(name) {
        return {
            doc: id => {
                const ref = { collectionName: name, id: String(id) };
                ref.get = async () => {
                    this.directReads.push(name);
                    const data = this.read(ref);
                    return { exists: data !== null, id: ref.id, data: () => clone(data) };
                };
                ref.delete = async () => this.applyWrite({ type: 'delete', ref });
                return ref;
            }
        };
    }

    read(ref) {
        return this.collections.get(ref.collectionName)?.get(ref.id) ?? null;
    }

    seed(collectionName, id, data) {
        let collection = this.collections.get(collectionName);
        if (!collection) this.collections.set(collectionName, collection = new Map());
        collection.set(String(id), clone(data));
    }

    applyWrite(write) {
        let collection = this.collections.get(write.ref.collectionName);
        if (!collection) this.collections.set(write.ref.collectionName, collection = new Map());
        if (write.type === 'delete') {
            collection.delete(write.ref.id);
            return;
        }
        if (write.type === 'set') {
            collection.set(write.ref.id, clone(write.data));
            return;
        }
        const next = clone(collection.get(write.ref.id) || {});
        Object.entries(write.data).forEach(([key, value]) => {
            if (value?.deleteField === true) delete next[key];
            else next[key] = clone(value);
        });
        collection.set(write.ref.id, next);
    }

    async runTransaction(callback) {
        const reads = [];
        const writes = [];
        const transaction = {
            get: async ref => {
                reads.push(ref.collectionName);
                if (this.deniedTransactionCollections.has(ref.collectionName)) {
                    const error = new Error('Missing or insufficient permissions.');
                    error.code = 'permission-denied';
                    throw error;
                }
                const data = this.read(ref);
                return { exists: data !== null, id: ref.id, data: () => clone(data) };
            },
            set: (ref, data) => writes.push({ type: 'set', ref, data: clone(data) }),
            update: (ref, data) => writes.push({ type: 'update', ref, data: clone(data) }),
            delete: ref => writes.push({ type: 'delete', ref })
        };
        const result = await callback(transaction);
        writes.forEach(write => this.applyWrite(write));
        this.transactions.push({ reads, writes });
        return result;
    }
}

function createHarness() {
    const db = new FakeFirestore();
    const cacheClears = [];
    global.firebase = {
        firestore: {
            FieldValue: {
                serverTimestamp: () => new Date('2026-10-10T00:00:00.000Z'),
                delete: () => DELETE_FIELD
            }
        }
    };
    global.RatingConfig = {
        SHORT_COMMENT_MAX_LENGTH: 500,
        LONG_REVIEW_MAX_LENGTH: 5000,
        normalizeComment: value => String(value || '').trim(),
        normalizeReview: value => String(value || '').trim()
    };
    global.window = {
        firebaseManager: {
            seriesEpisodeRatingService: {
                clearEpisodeRatingsCache: (userId, movieId) => cacheClears.push(`${userId}_${movieId}`)
            },
            getMovieCacheService: () => null,
            getRatingsCacheService: () => null,
            getWatchlistService: () => ({ isInWatchlist: async () => false })
        }
    };
    const service = new RatingService({ db });
    service.getRating = async (userId, movieId) => {
        const id = service.getRatingDocumentId(userId, movieId);
        const data = db.read({ collectionName: 'ratings', id });
        return data ? { id, ...clone(data) } : null;
    };
    service.resolveMovieDataForRating = async (_movieId, movieData) => movieData;
    service.invalidateRatingsCache = async () => {};
    service.invalidateAverageRatingsCache = async () => {};
    service.recalculateUserTopGenres = async () => [];
    return { db, service, cacheClears };
}

const movie = { kinopoiskId: 77, name: 'Test title', posterUrl: 'poster.jpg' };

async function run() {
    for (const source of [undefined, 'episodes', 'manual']) {
        const { db, service, cacheClears } = createHarness();
        const createdAt = new Date('2025-01-01');
        const title = { userId: 'alice', movieId: 77, rating: 8,
            review: 'Keep review', isFavorite: true, createdAt, favoritedAt: createdAt,
            ...(source ? { ratingSource: source, episodeAverage: 8.4, episodesRatedCount: 12 } : {}) };
        const privateDocument = { userId: 'alice', movieId: 77,
            episodes: { '1:1': { r: 8, t: createdAt } }, mode: 'episodes', manualBackup: { rating: 3 } };
        db.seed('ratings', 'alice_77', title);
        db.seed('seriesEpisodeRatings', 'alice_77', privateDocument);
        db.deniedTransactionCollections.add('seriesEpisodeRatings');
        const result = await service.addOrUpdateRating('alice', 'Alice', '', 77, 6, 'new', movie);
        assert.deepEqual(db.transactions[0].reads, ['ratings'], 'title changes never read private episodes');
        const rating = db.read({ collectionName: 'ratings', id: 'alice_77' });
        assert.equal(rating.rating, 6);
        assert.equal(rating.review, 'Keep review');
        assert.equal(rating.isFavorite, true);
        assert.deepEqual(rating.createdAt, createdAt);
        for (const key of ['ratingSource', 'episodeAverage', 'episodesRatedCount']) {
            assert.equal(key in rating, false);
            assert.equal(key in result, false);
        }
        assert.deepEqual(db.read({ collectionName: 'seriesEpisodeRatings', id: 'alice_77' }), privateDocument);
        assert.deepEqual(cacheClears, [], 'public mutation does not invalidate independent private cache');
        await service.deleteRating('alice', 'alice_77');
        assert.deepEqual(db.directReads, ['ratings']);
        assert.equal(db.transactions.length, 1, 'delete uses original direct path');
        assert.equal(db.read({ collectionName: 'ratings', id: 'alice_77' }), null);
        assert.deepEqual(db.read({ collectionName: 'seriesEpisodeRatings', id: 'alice_77' }), privateDocument);
    }
    {
        const { db, service } = createHarness();
        db.seed('ratings', 'alice_77', { userId: 'alice', movieId: 77, rating: 5, episodeAverage: 5.2 });
        await service.addOrUpdateRating('alice', 'Alice', '', 77, 7, '', movie);
        assert.equal('episodeAverage' in db.read({ collectionName: 'ratings', id: 'alice_77' }), false,
            'partial legacy metadata is cleaned even without ratingSource');
    }
    {
        const { db, service } = createHarness();
        service.invalidateRatingTextCaches = async () => {};
        db.seed('ratings', 'alice_77', { userId: 'alice', movieId: 77, rating: 8,
            ratingSource: 'episodes', episodeAverage: 8.4, episodesRatedCount: 12 });
        const result = await service.updateRatingText('alice', 'alice_77', { comment: 'text only' });
        assert.equal(result.rating, 8);
        const stored = db.read({ collectionName: 'ratings', id: 'alice_77' });
        for (const key of ['ratingSource', 'episodeAverage', 'episodesRatedCount']) {
            assert.equal(key in stored, false);
            assert.equal(key in result, false);
        }
        assert.deepEqual(db.transactions[0].reads, ['ratings']);
        assert.equal('episodeAverage' in service.toRatingViewModel({ rating: 8, episodeAverage: 8.4 }), false);
    }
    console.log('seriesEpisodeRatingTransitions.test.cjs: independent title isolation tests passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
