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
    {
        const { db, service } = createHarness();
        db.seed('ratings', 'alice_77', {
            userId: 'alice', movieId: 77, rating: 4, comment: 'old'
        });
        await service.addOrUpdateRating('alice', 'Alice', '', 77, 8, 'new', movie);
        assert.equal(db.transactions[0].reads.length, 1);
        assert.deepEqual(db.transactions[0].reads, ['ratings'], 'ordinary ratings do not read the episode collection');
    }

    {
        const { db, service, cacheClears } = createHarness();
        const createdAt = new Date('2025-01-01T00:00:00.000Z');
        db.seed('ratings', 'alice_77', {
            userId: 'alice', movieId: 77, rating: 8, ratingSource: 'episodes',
            episodeAverage: 8.4, episodesRatedCount: 12, comment: 'Keep comment',
            review: 'Keep review', isFavorite: true, favoritedAt: createdAt, createdAt
        });
        db.seed('seriesEpisodeRatings', 'alice_77', {
            userId: 'alice', movieId: 77, tmdbId: 123, episodes: { '1:1': { r: 8, t: createdAt } },
            ratingSum: 8, ratedCount: 1, mode: 'episodes', manualBackup: null,
            lastKey: '1:1', updatedAt: createdAt
        });
        const result = await service.addOrUpdateRating('alice', 'Alice', '', 77, 6, 'Updated text', movie);
        const rating = db.read({ collectionName: 'ratings', id: 'alice_77' });
        const episodeState = db.read({ collectionName: 'seriesEpisodeRatings', id: 'alice_77' });
        assert.deepEqual(db.transactions[0].reads, ['ratings', 'seriesEpisodeRatings']);
        assert.equal(rating.rating, 6);
        assert.equal(rating.ratingSource, 'manual');
        assert.equal('episodeAverage' in rating, false);
        assert.equal('episodesRatedCount' in rating, false);
        assert.equal(rating.comment, 'Updated text');
        assert.equal(rating.review, 'Keep review');
        assert.equal(rating.isFavorite, true);
        assert.deepEqual(rating.createdAt, createdAt);
        assert.equal(episodeState.mode, 'manual');
        assert.equal(episodeState.manualBackup.rating, 6);
        assert.deepEqual(episodeState.episodes, { '1:1': { r: 8, t: createdAt } });
        assert.equal(result.ratingSource, 'manual');
        assert.equal('episodeAverage' in result, false);
        assert.deepEqual(cacheClears, ['alice_77']);
    }

    {
        const { db, service } = createHarness();
        db.seed('ratings', 'alice_77', {
            userId: 'alice', movieId: 77, rating: 8, ratingSource: 'episodes',
            episodeAverage: 8.4, episodesRatedCount: 12, comment: ''
        });
        await service.addOrUpdateRating('alice', 'Alice', '', 77, 7, '', movie);
        const rating = db.read({ collectionName: 'ratings', id: 'alice_77' });
        assert.equal(rating.ratingSource, 'manual');
        assert.equal('episodeAverage' in rating, false, 'episode display fields are removed even if private state is missing');
        assert.equal(db.transactions[0].reads.includes('seriesEpisodeRatings'), true);
    }

    {
        const { db, service } = createHarness();
        db.seed('ratings', 'alice_77', {
            userId: 'alice', movieId: 77, rating: 7, ratingSource: 'manual',
            comment: 'manual mode', createdAt: new Date('2025-01-01T00:00:00.000Z')
        });
        db.seed('seriesEpisodeRatings', 'alice_77', {
            userId: 'alice', movieId: 77, tmdbId: 123, episodes: { '1:1': { r: 8, t: new Date() } },
            ratingSum: 8, ratedCount: 1, mode: 'manual', manualBackup: { rating: 4 },
            lastKey: '1:1', updatedAt: new Date()
        });

        await service.addOrUpdateRating('alice', 'Alice', '', 77, 9, 'updated manual', movie);
        const rating = db.read({ collectionName: 'ratings', id: 'alice_77' });
        const episodeState = db.read({ collectionName: 'seriesEpisodeRatings', id: 'alice_77' });
        assert.deepEqual(db.transactions[0].reads, ['ratings', 'seriesEpisodeRatings']);
        assert.equal(rating.ratingSource, 'manual');
        assert.equal(episodeState.mode, 'manual', 'A manual rating update does not re-enable aggregate mode');
        assert.equal(episodeState.manualBackup.rating, 9, 'R2: the restore backup follows the latest manual score');
        assert.equal(episodeState.manualBackup.ratedAt instanceof Date, true);
        assert.deepEqual(episodeState.episodes, { '1:1': { r: 8, t: episodeState.episodes['1:1'].t } });
    }

    {
        const { db, service } = createHarness();
        db.seed('ratings', 'alice_77', {
            userId: 'alice', movieId: 77, rating: 7, comment: 'ordinary movie rating'
        });
        await service.deleteRating('alice', 'alice_77');
        assert.deepEqual(db.directReads, ['ratings'], 'R1: deletion uses one rating read and no episode-collection read');
        assert.equal(db.transactions.length, 0, 'Legacy deletion stays on the original direct-delete path');
        assert.equal(db.read({ collectionName: 'seriesEpisodeRatings', id: 'alice_77' }), null);
        assert.equal(db.read({ collectionName: 'ratings', id: 'alice_77' }), null);
    }

    {
        const { db, service, cacheClears } = createHarness();
        db.seed('ratings', 'alice_77', {
            userId: 'alice', movieId: 77, rating: 6, ratingSource: 'episodes',
            episodeAverage: 8, episodesRatedCount: 1, comment: 'remove'
        });
        db.seed('seriesEpisodeRatings', 'alice_77', {
            userId: 'alice', movieId: 77, tmdbId: 123, episodes: { '1:1': { r: 8, t: new Date() } },
            ratingSum: 8, ratedCount: 1, mode: 'episodes', manualBackup: { rating: 5 },
            lastKey: '1:1', updatedAt: new Date()
        });
        await service.deleteRating('alice', 'alice_77');
        const episodeState = db.read({ collectionName: 'seriesEpisodeRatings', id: 'alice_77' });
        assert.equal(db.read({ collectionName: 'ratings', id: 'alice_77' }), null);
        assert.deepEqual(episodeState.episodes, { '1:1': { r: 8, t: episodeState.episodes['1:1'].t } });
        assert.equal(episodeState.mode, 'manual');
        assert.equal(episodeState.manualBackup, null);
        assert.deepEqual(cacheClears, ['alice_77']);
        assert.deepEqual(db.transactions[0].reads, ['ratings', 'seriesEpisodeRatings']);
    }

    {
        const { db, service, cacheClears } = createHarness();
        db.deniedTransactionCollections.add('seriesEpisodeRatings');
        db.seed('ratings', 'alice_77', {
            userId: 'alice', movieId: 77, rating: 5, ratingSource: 'manual'
        });
        db.seed('seriesEpisodeRatings', 'alice_77', {
            userId: 'alice', movieId: 77, episodes: { '1:1': { r: 8, t: new Date() } },
            ratingSum: 8, ratedCount: 1, mode: 'manual', manualBackup: { rating: 4 }, lastKey: '1:1'
        });

        await service.addOrUpdateRating('alice', 'Alice', '', 77, 9, '', movie);
        const rating = db.read({ collectionName: 'ratings', id: 'alice_77' });
        assert.equal(rating.rating, 9,
            'R3: a manual title rating remains writable if private episode rules deny the state read');
        assert.equal(rating.ratingSource, 'manual');
        assert.deepEqual(cacheClears, ['alice_77']);
    }

    console.log('seriesEpisodeRatingTransitions.test.cjs: all tests passed');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
