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

console.log('Random pool service and Movie Details integration contract passed.');
