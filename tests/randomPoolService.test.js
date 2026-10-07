import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serviceSource = fs.readFileSync(path.join(root, 'src/shared/services/RandomPoolService.js'), 'utf8');
const movieDetailsSource = fs.readFileSync(path.join(root, 'src/pages/movie-details/movie-details.js'), 'utf8');
const movieDetailsHtml = fs.readFileSync(path.join(root, 'src/pages/movie-details/movie-details.html'), 'utf8');
const randomHtml = fs.readFileSync(path.join(root, 'src/pages/random/random.html'), 'utf8');

let storedPool = [
    { kpId: '61325', title: 'Existing copy' },
    { kpId: 61325, title: 'Duplicate copy' }
];

const context = vm.createContext({
    console,
    chrome: {
        storage: {
            local: {
                async get(key) {
                    return { [key]: storedPool };
                },
                async set(value) {
                    storedPool = value.randomPool;
                }
            }
        }
    }
});
context.globalThis = context;
vm.runInContext(serviceSource, context, { filename: 'RandomPoolService.js' });
const RandomPoolService = context.RandomPoolService;

assert.ok(RandomPoolService, 'RandomPoolService must expose a global page dependency');

const normalized = await RandomPoolService.getPool();
assert.equal(normalized.length, 1, 'Pool reads must remove duplicate IDs');
assert.equal(normalized[0].kpId, 61325, 'Pool IDs must be normalized to positive numbers');

const added = await RandomPoolService.addMovie({
    kinopoiskId: '700',
    name: 'New movie',
    year: 2024,
    posterUrl: 'https://example.test/poster.jpg',
    kpRating: '8.4'
});
assert.equal(added.added, true, 'A movie from Movie Details must be added once');
assert.equal(added.movie.kpId, 700);
assert.equal(added.movie.rating, 8.4);
assert.equal(storedPool.length, 2);

const duplicate = await RandomPoolService.addMovie({ kinopoiskId: 700, name: 'Same movie' });
assert.equal(duplicate.added, false, 'Adding the same movie with another ID type must be idempotent');
assert.equal(storedPool.length, 2);

assert.match(movieDetailsSource, /data-action="add-to-random-pool"/);
assert.match(movieDetailsSource, /RandomPoolService\.addMovie/);
assert.match(movieDetailsHtml, /shared\/services\/RandomPoolService\.js/);
assert.match(randomHtml, /shared\/services\/RandomPoolService\.js/);

function createStorage(pool = []) {
    return {
        pool: structuredClone(pool),
        writes: 0,
        readError: null,
        writeError: null,
        async get(key) {
            if (this.readError) throw this.readError;
            const snapshot = structuredClone(this.pool);
            await Promise.resolve();
            return { [key]: snapshot };
        },
        async set(value) {
            if (this.writeError) throw this.writeError;
            await Promise.resolve();
            this.pool = structuredClone(value.randomPool);
            this.writes += 1;
        }
    };
}

function createLocks() {
    let queue = Promise.resolve();
    return {
        calls: [],
        request(name, operation) {
            this.calls.push(name);
            const result = queue.then(() => operation({ name }));
            queue = result.catch(() => {});
            return result;
        }
    };
}

function createService(storage, locks) {
    const page = vm.createContext({
        console,
        chrome: { storage: { local: storage } },
        ...(locks ? { navigator: { locks } } : {})
    });
    vm.runInContext(serviceSource, page, { filename: 'RandomPoolService.js' });
    return page.RandomPoolService;
}

const sharedStorage = createStorage([{ kpId: '1', title: 'Initial' }]);
const originLocks = createLocks();
const randomPage = createService(sharedStorage, originLocks);
const detailsPage = createService(sharedStorage, originLocks);

const competingAdds = await Promise.all([
    randomPage.addMovie({ id: '2', title: 'Random addition' }),
    detailsPage.addMovie({ kinopoiskId: 3, title: 'Details addition' }),
    detailsPage.addMovie({ kpId: '2', title: 'Duplicate addition' })
]);
assert.deepEqual(sharedStorage.pool.map(item => item.kpId), [1, 2, 3],
    'Web Locks must preserve concurrent additions from separate page contexts');
assert.deepEqual(competingAdds.map(result => result.added), [true, true, false]);
assert.equal(sharedStorage.writes, 2, 'A duplicate must not trigger another storage write');
assert.ok(originLocks.calls.every(name => name === 'randomPool'),
    'All pages must use the same origin-wide lock name');

await Promise.all([
    randomPage.removeMovie('2'),
    detailsPage.addMovie({ movieId: '4', title: 'Concurrent addition' })
]);
assert.deepEqual(sharedStorage.pool.map(item => item.kpId), [1, 3, 4],
    'Removal must read inside its lock and preserve another page\'s addition');
const writesBeforeAbsentRemoval = sharedStorage.writes;
const absentRemoval = await randomPage.removeMovie(999);
assert.deepEqual(Array.from(absentRemoval, item => item.kpId), [1, 3, 4]);
assert.equal(sharedStorage.writes, writesBeforeAbsentRemoval, 'Removing an absent ID must be idempotent');

const [, cleared] = await Promise.all([
    detailsPage.addMovie({ id: 5, title: 'Added before clear' }),
    randomPage.clear()
]);
assert.equal(cleared.length, 0);
assert.deepEqual(sharedStorage.pool, [], 'Clear must follow earlier locked mutations');
await Promise.all([
    randomPage.clear(),
    detailsPage.addMovie({ id: 6, title: 'Added after clear' })
]);
assert.deepEqual(sharedStorage.pool.map(item => item.kpId), [6],
    'An addition queued after clear must survive');

await randomPage.savePool([{ kpId: '7' }, { id: 7 }, { kpId: 0 }]);
assert.deepEqual(sharedStorage.pool.map(item => item.kpId), [7],
    'Legacy savePool must retain its normalized snapshot contract');
for (const invalid of [0, -1, 'bad', null, 2.5]) {
    await assert.rejects(randomPage.removeMovie(invalid), /valid Kinopoisk movie ID/);
    await assert.rejects(randomPage.addMovie({ id: invalid }), /valid Kinopoisk movie ID/);
}

const writesBeforeFailure = sharedStorage.writes;
sharedStorage.readError = new Error('Storage read failed');
await assert.rejects(randomPage.addMovie({ id: 8 }), /Storage read failed/);
await assert.rejects(randomPage.removeMovie(7), /Storage read failed/);
sharedStorage.readError = null;
sharedStorage.writeError = new Error('Storage write failed');
await assert.rejects(randomPage.addMovie({ id: 8 }), /Storage write failed/);
await assert.rejects(randomPage.removeMovie(7), /Storage write failed/);
await assert.rejects(randomPage.clear(), /Storage write failed/);
await assert.rejects(randomPage.savePool([]), /Storage write failed/);
assert.equal(sharedStorage.writes, writesBeforeFailure);
assert.deepEqual(sharedStorage.pool.map(item => item.kpId), [7],
    'Failed operations must leave persisted pool data intact');
sharedStorage.writeError = null;
await detailsPage.addMovie({ id: 8 });
assert.deepEqual(sharedStorage.pool.map(item => item.kpId), [7, 8],
    'A rejected operation must release the shared lock for later writes');

const rejectedLockService = createService(createStorage(), {
    request() { return Promise.reject(new Error('Lock request failed')); }
});
await assert.rejects(rejectedLockService.addMovie({ id: 1 }), /Lock request failed/,
    'Lock acquisition errors must propagate, not silently perform an unlocked write');

const fallbackStorage = createStorage();
const fallbackService = createService(fallbackStorage);
await Promise.all([
    fallbackService.addMovie({ id: 1 }),
    fallbackService.addMovie({ id: 2 }),
    fallbackService.removeMovie(1)
]);
assert.deepEqual(fallbackStorage.pool.map(item => item.kpId), [2],
    'Without Web Locks, operations within one page must still run in order');
fallbackStorage.writeError = new Error('Fallback write failed');
await assert.rejects(fallbackService.clear(), /Fallback write failed/);
fallbackStorage.writeError = null;
await fallbackService.addMovie({ id: 3 });
assert.deepEqual(fallbackStorage.pool.map(item => item.kpId), [2, 3],
    'The fallback queue must recover after a rejected write');

console.log('Random pool service and Movie Details integration contract passed.');
