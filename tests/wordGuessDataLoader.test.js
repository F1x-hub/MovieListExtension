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

// Dates are local: the daily puzzle switches at the player's local midnight.
const [exactA, exactB] = await Promise.all([
    loader.getPuzzleForDate(new Date(2026, 7, 22, 3)),
    loader.getPuzzleForDate(new Date(2026, 7, 22, 22))
]);

assert.equal(exactA.puzzleId, 'puzzle-002');
assert.equal(exactB.puzzleId, 'puzzle-002');
assert.equal(exactA.getRank(' ЛАМПА '), 1);
assert.equal(exactA.getRank('море'), 3);
assert.equal(exactA.getWordByRank(1), 'лампа', 'reverse rank lookup returns the answer for rank 1');
assert.equal(exactA.getWordByRank(3), 'море');
assert.equal(exactA.getWordByRank(4), undefined, 'ranks outside the table resolve to undefined');
assert.equal(calls.get('src/shared/data/games/word-guess/manifest.json'), 1, 'manifest requests must be deduplicated');
assert.equal(calls.get('puzzle-002.json'), 1, 'puzzle requests must be deduplicated');
assert.equal(calls.get('vocabulary.json'), 1, 'vocabulary requests must be deduplicated');

assert.equal(calls.get('puzzle-001.json'), undefined, 'only the requested puzzle is fetched');

const afterSchedule = await loader.getPuzzleForDate(new Date(2026, 7, 23, 12));
assert.equal(afterSchedule.puzzleId, 'puzzle-001', 'dates after the calendar cycle back to the anchor puzzle');
const farAfterSchedule = await loader.getPuzzleForDate(new Date(2026, 7, 26, 12));
assert.equal(farAfterSchedule.puzzleId, 'puzzle-002', 'the rotation keeps cycling in calendar order');
const beforeSchedule = await loader.getPuzzleForDate(new Date(2026, 7, 20, 12));
assert.equal(beforeSchedule.puzzleId, 'puzzle-002', 'dates before the anchor wrap to the end of the cycle');

const unrotatedLoader = new WordGuessDataLoader({
    getUrl: (path) => path,
    fetchImpl: async (path) => {
        const payload = path.endsWith('manifest.json')
            ? { ...manifest, rotation: undefined }
            : path === 'vocabulary.json' ? vocabulary : puzzles[path];
        return { ok: true, json: async () => payload };
    }
});
await assert.rejects(
    unrotatedLoader.getPuzzleForDate(new Date(2026, 7, 23, 12)),
    /нет загадки WordGuess/,
    'a manifest without a rotation keeps rejecting unscheduled dates'
);

console.log('✅ WordGuess data loader tests passed!');
