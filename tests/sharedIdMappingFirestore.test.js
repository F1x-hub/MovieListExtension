const assert = require('assert');
const IdMappingService = require('../src/shared/services/IdMappingService.js');

const documents = new Map();
const reverseLocks = new Map();

function snapshotFor(store, id) {
    const data = store.get(id);
    return {
        id,
        exists: data !== undefined,
        data: () => data
    };
}

function createCollection(store, name) {
    return {
        doc(id) {
        return {
            id,
                collectionName: name,
                get: async () => snapshotFor(store, id),
                delete: async () => store.delete(id)
            };
        }
    };
}

const collection = createCollection(documents, 'tmdbKinopoiskMappings');
const reverseCollection = createCollection(reverseLocks, 'tmdbKinopoiskReverseIndex');

const db = {
    collection(name) {
        if (name === 'tmdbKinopoiskMappings') return collection;
        if (name === 'tmdbKinopoiskReverseIndex') return reverseCollection;
        throw new Error(`Unexpected collection: ${name}`);
    },
    async runTransaction(callback) {
        const transaction = {
            get: reference => reference.get(),
            set(reference, data) {
                (reference.collectionName === 'tmdbKinopoiskMappings' ? documents : reverseLocks)
                    .set(reference.id, data);
            },
            delete(reference) {
                (reference.collectionName === 'tmdbKinopoiskMappings' ? documents : reverseLocks)
                    .delete(reference.id);
            }
        };
        return callback(transaction);
    }
};

const firebaseManager = {
    db,
    getCurrentUser: () => ({ uid: 'admin-1' })
};

global.firebase = {
    firestore: {
        FieldValue: {
            serverTimestamp: () => ({ serverTimestamp: true })
        }
    }
};

const localStore = {};
global.chrome = {
    storage: {
        local: {
            get: (keys, callback) => {
                const requestedKeys = Array.isArray(keys) ? keys : Object.keys(localStore);
                const result = Object.fromEntries(requestedKeys
                    .filter(key => Object.prototype.hasOwnProperty.call(localStore, key))
                    .map(key => [key, localStore[key]]));
                if (callback) callback(result);
            },
            set: (value, callback) => {
                Object.assign(localStore, value);
                if (callback) callback();
            },
            remove: (keys, callback) => {
                (Array.isArray(keys) ? keys : [keys]).forEach(key => delete localStore[key]);
                if (callback) callback();
            }
        }
    }
};

(async () => {
    const adminMapper = new IdMappingService(null, null, firebaseManager);
    await adminMapper.setManualMapping('movie', 550, 361, {
        title: 'Fight Club',
        year: 1999,
        kpType: 'movie'
    });

    const shared = documents.get('movie:550');
    assert.strictEqual(shared?.kpId, 361);
    assert.strictEqual(shared?.reverseKey, 'kp:movie:361');
    assert.strictEqual(shared?.confirmedBy, 'admin-1');
    assert.strictEqual(reverseLocks.get('kp:movie:361')?.mappingId, 'movie:550');

    const userMapper = new IdMappingService(null, null, firebaseManager);
    const resolved = await userMapper.resolveBatch([{ tmdbId: 550, mediaType: 'movie' }], {
        kinopoiskService: { _fetchWithRotation: async () => { throw new Error('Provider lookup must not run'); } },
        skipQueue: true
    });
    assert.strictEqual(resolved.get('movie:550')?.kinopoiskId, 361);

    const reverse = await userMapper.resolveTmdbIdByKinopoiskId(361, 'movie');
    assert.strictEqual(reverse?.tmdbId, 550);

    await assert.rejects(
        () => adminMapper.setManualMapping('movie', 551, 361, { kpType: 'movie' }),
        /уже связан/i
    );

    const migrationMapper = new IdMappingService(null, null, firebaseManager);
    migrationMapper.getManualMappings = async () => [{
        key: 'tv:700',
        tmdbId: 700,
        mediaType: 'tv',
        kpId: 701,
        kpType: 'tv-series',
        title: 'Shared series',
        year: 2026,
        isManual: true,
        resolvedAt: Date.now()
    }];
    const publicationPreview = await migrationMapper.getLocalManualMappingPublicationPreview();
    assert.deepStrictEqual(publicationPreview, { total: 1, invalid: 0 });
    const migration = await migrationMapper.publishLocalManualMappings();
    assert.strictEqual(migration.total, 1);
    assert.strictEqual(migration.published, 1);
    assert.strictEqual(documents.get('tv:700')?.kpId, 701);
    assert.strictEqual(reverseLocks.get('kp:tv:701')?.mappingId, 'tv:700');

    documents.set('movie:900', {
        tmdbId: 900,
        mediaType: 'movie',
        kpId: 901,
        status: 'resolved',
        identityStatus: 'UNVERIFIED',
        isManual: true,
        reverseKey: 'kp:movie:901'
    });
    const malformed = await userMapper._readSharedMapping('movie', 900);
    assert.strictEqual(malformed.available, true);
    assert.strictEqual(malformed.mapping, null, 'Malformed cloud records must not become trusted mappings');

    await adminMapper.removeManualMapping('movie', 550);
    assert.strictEqual(documents.has('movie:550'), false);
    assert.strictEqual(reverseLocks.has('kp:movie:361'), false);
    const stale = await userMapper.resolveBatch([{ tmdbId: 550, mediaType: 'movie' }], {
        kinopoiskService: null,
        skipQueue: true
    });
    assert.notStrictEqual(stale.get('movie:550')?.kinopoiskId, 361, 'Deleted cloud mapping must not survive in local cache');

    console.log('Shared Firestore ID mapping contract passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
