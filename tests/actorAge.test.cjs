const assert = require('node:assert');
const ActorAgeService = require('../src/shared/services/ActorAgeService.js');

const { computeAgeAtRelease } = ActorAgeService;

// Exact age with a full release date, year difference with only a year.
assert.strictEqual(computeAgeAtRelease('1974-11-11T00:00:00.000Z', { date: '1997-12-19T00:00:00.000Z' }), 23);
assert.strictEqual(computeAgeAtRelease('1974-11-11T00:00:00.000Z', { date: '1997-10-01T00:00:00.000Z' }), 22, 'birthday not reached yet');
assert.strictEqual(computeAgeAtRelease('1974-11-11', { year: 1997 }), 23);
assert.strictEqual(computeAgeAtRelease('1974-11-11', { date: 'garbage', year: '1997' }), 23);
assert.strictEqual(computeAgeAtRelease(null, { year: 1997 }), null);
assert.strictEqual(computeAgeAtRelease('1974-11-11', {}), null);
assert.strictEqual(computeAgeAtRelease('2005-01-01', { year: 1997 }), null, 'born after release is bad data');
assert.strictEqual(computeAgeAtRelease('1800-01-01', { year: 2020 }), null, 'implausible age is dropped');

function createStorage() {
    const store = {};
    return {
        store,
        async get(keys) {
            const out = {};
            for (const key of [].concat(keys)) if (key in store) out[key] = store[key];
            return out;
        },
        async set(payload) { Object.assign(store, payload); }
    };
}

function createKinopoisk(docsFor, { fail = null } = {}) {
    const requests = [];
    return {
        requests,
        baseUrl: 'https://api.poiskkino.dev/v1.4',
        async _fetchWithRotation(url) {
            requests.push(new URL(url));
            if (fail) throw fail;
            const ids = new URL(url).searchParams.getAll('id').map(Number);
            return { ok: true, json: async () => ({ docs: docsFor(ids) }) };
        }
    };
}

(async () => {
    const storage = createStorage();
    const kp = createKinopoisk(ids => ids.filter(id => id !== 3).map(id => ({ id, birthday: id === 2 ? null : `19${70 + id}-05-20T00:00:00.000Z` })));
    const service = new ActorAgeService({ kinopoiskService: kp, storage });

    // One batched, field-limited request for the whole cast.
    let dates = await service.getBirthDates([1, 2, 3, '1', 'x', -4]);
    assert.strictEqual(kp.requests.length, 1);
    const params = kp.requests[0].searchParams;
    assert.strictEqual(kp.requests[0].pathname, '/v1.4/person');
    assert.deepStrictEqual(params.getAll('id'), ['1', '2', '3']);
    assert.deepStrictEqual(params.getAll('selectFields'), ['id', 'birthday']);
    assert.strictEqual(dates.get(1), '1971-05-20');
    assert.strictEqual(dates.get(2), null);
    assert.strictEqual(dates.get(3), null);

    // Everything, including unknowns, is answered from cache afterwards.
    dates = await service.getBirthDates([1, 2, 3]);
    assert.strictEqual(kp.requests.length, 1, 'cached ids must not hit the API again');
    assert.strictEqual(dates.get(1), '1971-05-20');

    // A fresh instance (new page) reads the persistent cache, not the API.
    const reopened = new ActorAgeService({ kinopoiskService: kp, storage });
    await reopened.getBirthDates([1, 2, 3]);
    assert.strictEqual(kp.requests.length, 1);

    // Only uncached people are requested.
    await reopened.getBirthDates([1, 4]);
    assert.strictEqual(kp.requests.length, 2);
    assert.deepStrictEqual(kp.requests[1].searchParams.getAll('id'), ['4']);

    // Unknown answers are retried after the miss TTL; found dates are not.
    storage.store[`${ActorAgeService.CACHE_PREFIX}2`].t -= ActorAgeService.MISS_TTL_MS + 1;
    storage.store[`${ActorAgeService.CACHE_PREFIX}1`].t -= ActorAgeService.MISS_TTL_MS * 10;
    await new ActorAgeService({ kinopoiskService: kp, storage }).getBirthDates([1, 2]);
    assert.strictEqual(kp.requests.length, 3);
    assert.deepStrictEqual(kp.requests[2].searchParams.getAll('id'), ['2']);

    // Failures (quota, network) are not cached and do not throw.
    const failing = createKinopoisk(() => [], { fail: new Error('quota') });
    const failStorage = createStorage();
    const failService = new ActorAgeService({ kinopoiskService: failing, storage: failStorage });
    const failed = await failService.getBirthDates([7]);
    assert.strictEqual(failed.has(7), false);
    assert.deepStrictEqual(Object.keys(failStorage.store), []);

    // Large casts are split into bounded batches.
    const big = createKinopoisk(ids => ids.map(id => ({ id, birthday: '1990-01-01' })));
    await new ActorAgeService({ kinopoiskService: big, storage: createStorage() })
        .getBirthDates(Array.from({ length: 120 }, (_, i) => i + 1));
    assert.strictEqual(big.requests.length, 3);

    console.log('Actor age tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
