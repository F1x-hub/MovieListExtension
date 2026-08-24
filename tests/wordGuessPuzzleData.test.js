import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WordGuessDataLoader } from '../src/shared/games/WordGuessDataLoader.js';

const dataRoot = new URL('../src/shared/data/games/word-guess/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dataRoot), 'utf8'));
const vocabulary = JSON.parse(readFileSync(new URL('vocabulary.json', dataRoot), 'utf8'));
const answerSet = new Set();

assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.puzzles.length, 90, 'WordGuess must have a 90-day schedule');
assert.equal(new Set(manifest.puzzles.map((entry) => entry.date)).size, 90,
    'WordGuess dates must be unique');
assert.equal(new Set(manifest.puzzles.map((entry) => entry.id)).size, 90,
    'WordGuess puzzle IDs must be unique');
assert.ok(vocabulary.words.length > 1000, 'shared vocabulary must remain expanded');

const loader = new WordGuessDataLoader({
    getUrl: (path) => new URL(`../${path}`, import.meta.url),
    fetchImpl: async (url) => ({
        ok: true,
        json: async () => JSON.parse(readFileSync(url, 'utf8'))
    })
});

for (const entry of manifest.puzzles) {
    const puzzle = await loader.getPuzzleForDate(new Date(`${entry.date}T12:00:00Z`));
    assert.equal(puzzle.puzzleId, entry.id);
    assert.equal(puzzle.getRank(puzzle.answer), 1, `${entry.id} answer must have rank 1`);
    assert.equal(puzzle.wordCount, vocabulary.words.length, `${entry.id} vocabulary size must match`);
    assert.equal(puzzle.rankTable.length, vocabulary.words.length, `${entry.id} rank table must match`);
    assert.equal(answerSet.has(puzzle.answer), false, `daily answer repeats: ${puzzle.answer}`);
    answerSet.add(puzzle.answer);
}

console.log('✅ WordGuess compact puzzle data tests passed!');
