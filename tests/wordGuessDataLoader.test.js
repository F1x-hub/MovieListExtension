import assert from 'node:assert/strict';
import { WordGuessDataLoader } from '../src/shared/games/WordGuessDataLoader.js';

const previousFetch = globalThis.fetch;
globalThis.fetch = async function fetchFromWindow(path) {
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    return { ok: true, json: async () => ({ path }) };
};
const browserDefaultLoader = new WordGuessDataLoader({ getUrl: (path) => path });
await assert.doesNotReject(
    browserDefaultLoader.fetchJson('manifest.json'),
    'default fetch adapter must preserve the Window receiver'
);
globalThis.fetch = previousFetch;

const manifest = {
    schemaVersion: 2,
    rotation: { timezone: 'UTC', anchorDate: '2026-08-21', endDate: '2026-08-22' },
    vocabulary: { path: 'vocabulary.json', encoding: 'uint16-le-base64' },
    puzzles: [
        { id: 'puzzle-001', date: '2026-08-21', path: 'puzzle-001.json' },
        { id: 'puzzle-002', date: '2026-08-22', path: 'puzzle-002.json' }
    ]
};

const vocabulary = {
    schemaVersion: 1,
    words: ['лампа', 'море', 'океан']
};

const puzzles = {
    'puzzle-001.json': {
        schemaVersion: 2,
        puzzleId: 'puzzle-001',
        embeddingModel: 'fixture-v1',
        answer: 'океан',
        wordLength: 5,
        wordCount: 3,
        rankEncoding: 'uint16-le-base64',
        rankTable: 'AwACAAEA'
    },
    'puzzle-002.json': {
        schemaVersion: 2,
        puzzleId: 'puzzle-002',
        embeddingModel: 'fixture-v1',
        answer: 'лампа',
        wordLength: 5,
        wordCount: 3,
        rankEncoding: 'uint16-le-base64',
        rankTable: 'AQADAAIA'
    }
};

const calls = new Map();
const loader = new WordGuessDataLoader({
    getUrl: (path) => path,
    fetchImpl: async (path) => {
        calls.set(path, (calls.get(path) || 0) + 1);
        const payload = path.endsWith('manifest.json')
            ? manifest
            : path === 'vocabulary.json' ? vocabulary : puzzles[path];
        return { ok: true, json: async () => payload };
    }
});

const [exactA, exactB] = await Promise.all([
    loader.getPuzzleForDate(new Date('2026-08-22T03:00:00Z')),
    loader.getPuzzleForDate(new Date('2026-08-22T18:00:00Z'))
]);

assert.equal(exactA.puzzleId, 'puzzle-002');
assert.equal(exactB.puzzleId, 'puzzle-002');
assert.equal(exactA.getRank(' ЛАМПА '), 1);
assert.equal(exactA.getRank('море'), 3);
assert.equal(calls.get('src/shared/data/games/word-guess/manifest.json'), 1, 'manifest requests must be deduplicated');
assert.equal(calls.get('puzzle-002.json'), 1, 'puzzle requests must be deduplicated');
assert.equal(calls.get('vocabulary.json'), 1, 'vocabulary requests must be deduplicated');

await assert.rejects(
    loader.getPuzzleForDate(new Date('2026-08-23T12:00:00Z')),
    /нет загадки WordGuess/,
    'dates outside the bundled schedule must not repeat an old puzzle'
);
assert.equal(calls.get('puzzle-001.json'), undefined);

console.log('✅ WordGuess data loader tests passed!');
