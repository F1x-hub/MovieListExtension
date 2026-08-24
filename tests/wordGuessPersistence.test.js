import assert from 'node:assert/strict';
import { WordGuessController, WORD_GUESS_PROGRESS_KEY } from '../src/shared/games/WordGuessController.js';

const puzzleOne = {
    schemaVersion: 2,
    puzzleId: 'puzzle-001',
    embeddingModel: 'fixture-v1',
    answer: 'океан',
    wordLength: 5,
    getRank(word) {
        return { океан: 1, море: 2, берег: 10 }[word];
    }
};
const puzzleTwo = {
    ...puzzleOne,
    puzzleId: 'puzzle-002',
    answer: 'лампа',
    getRank(word) {
        return { лампа: 1, свет: 2 }[word];
    }
};

let currentDate = new Date('2026-08-22T12:00:00Z');
let storedProgress = null;
const storage = {
    async get(key) {
        return storedProgress ? { [key]: storedProgress } : {};
    },
    async set(key, value) {
        assert.equal(key, WORD_GUESS_PROGRESS_KEY);
        storedProgress = value;
    },
    async remove(key) {
        assert.equal(key, WORD_GUESS_PROGRESS_KEY);
        storedProgress = null;
    }
};
const dataLoader = {
    async getPuzzleForDate() {
        return currentDate.getUTCDate() === 22 ? puzzleOne : puzzleTwo;
    }
};

const firstSession = new WordGuessController({ dataLoader, storage, now: () => currentDate });
await firstSession.start();
assert.equal(firstSession.submit('море').kind, 'attempt');
await firstSession.persistencePromise;

const restoredSession = new WordGuessController({ dataLoader, storage, now: () => currentDate });
await restoredSession.start();
assert.equal(restoredSession.getState().attempts, 1, 'same-day history must survive a restart');
assert.equal(restoredSession.getState().history[0].word, 'море');

currentDate = new Date('2026-08-23T12:00:00Z');
const nextDaySession = new WordGuessController({ dataLoader, storage, now: () => currentDate });
await nextDaySession.start();
assert.equal(nextDaySession.getState().attempts, 0, 'new daily puzzle must start with empty history');
assert.equal(storedProgress, null, 'old daily progress must be removed after rotation');

console.log('✅ WordGuess daily persistence tests passed!');
