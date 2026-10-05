import assert from 'node:assert/strict';
import { WordGuessController, normalizeWord } from '../src/shared/games/WordGuessController.js';

const puzzle = {
    schemaVersion: 1,
    puzzleId: 'fixture',
    embeddingModel: 'manual-fixture-v1',
    answer: 'океан',
    wordLength: 5,
    getRank(word) {
        return {
            океан: 1,
            море: 2,
            еж: 3
        }[word];
    }
};

const dataLoader = {
    async getPuzzleForDate() {
        return puzzle;
    }
};

assert.equal(normalizeWord('  ЁЖ  '), 'еж', 'normalization must trim, lowercase and replace ё with е');

const controller = new WordGuessController({ dataLoader });
await controller.start();

const unknown = controller.submit('неизвестно');
assert.equal(unknown.kind, 'not-found');
assert.equal(controller.getState().attempts, 0, 'unknown words must not consume attempts');
assert.equal(controller.getState().history.length, 0, 'unknown words must not enter history');

const first = controller.submit('  МОРЕ  ');
assert.equal(first.kind, 'attempt');
assert.equal(first.rank, 2);
assert.equal(controller.getState().history[0].word, 'море');
assert.equal(controller.getState().attempts, 1);

const duplicate = controller.submit('море');
assert.equal(duplicate.kind, 'duplicate');
assert.equal(duplicate.rank, 2, 'duplicate must return the existing rank');
assert.equal(controller.getState().attempts, 1, 'duplicate must not consume an attempt');
assert.equal(controller.getState().history.length, 1, 'duplicate must not add history');

const normalizedShortWord = controller.submit(' ЁЖ ');
assert.equal(normalizedShortWord.kind, 'attempt', 'rank dictionary controls allowed input length');
assert.equal(normalizedShortWord.rank, 3);
assert.equal(controller.getState().attempts, 2);

const victory = controller.submit(' ОКЕАН ');
assert.equal(victory.kind, 'win');
assert.equal(victory.rank, 1);
assert.equal(controller.getState().isWon, true);
assert.equal(controller.getState().attempts, 3);
assert.equal(controller.getState().bestRank, 1);

// Hints reveal a closer unguessed word; giving up reveals the answer for the day.
const rankedWords = ['океан', 'море', 'волна', 'берег', 'песок', 'лампа'];
const hintPuzzle = {
    puzzleId: 'hint-fixture',
    answer: 'океан',
    wordCount: rankedWords.length,
    getRank: (word) => {
        const index = rankedWords.indexOf(word);
        return index === -1 ? undefined : index + 1;
    },
    getWordByRank: (rank) => rankedWords[rank - 1]
};
const memory = new Map();
const memoryStorage = {
    get: async (key) => ({ [key]: memory.get(key) }),
    set: async (key, value) => { memory.set(key, value); },
    remove: async (key) => { memory.delete(key); }
};
const hintLoader = { async getPuzzleForDate() { return hintPuzzle; } };
const fixedNow = () => new Date(2026, 9, 5, 12);

const hinted = new WordGuessController({ dataLoader: hintLoader, storage: memoryStorage, now: fixedNow });
await hinted.start();
const firstHint = hinted.hint();
assert.equal(firstHint.kind, 'hint');
assert.equal(firstHint.rank, 6, 'the first hint is capped by the vocabulary size');
assert.equal(hinted.getState().attempts, 1, 'a hint counts as an attempt');
assert.equal(hinted.getState().history[0].hint, true);
assert.equal(hinted.hint().rank, 3, 'each next hint halves the best rank');
assert.equal(hinted.hint().rank, 2, 'hints stop one step short of the answer');
assert.equal(hinted.getState().hintsUsed, 3);
assert.equal(hinted.hint().kind, 'hint-unavailable', 'no hint is offered once only the answer is closer');
assert.equal(hinted.getState().attempts, 3, 'an unavailable hint does not consume an attempt');

const midGame = new WordGuessController({
    dataLoader: hintLoader,
    storage: null,
    now: fixedNow
});
await midGame.start();
midGame.submit('лампа');
const halved = midGame.hint();
assert.equal(halved.rank, 3, 'a hint halves the best rank');
midGame.submit('волна');
assert.equal(midGame.hint().word, 'море', 'a hint skips words that were already guessed');

assert.equal(hinted.giveUp().kind, 'revealed');
const revealedState = hinted.getState();
assert.equal(revealedState.isRevealed, true);
assert.equal(revealedState.status, 'revealed');
assert.equal(revealedState.answer, 'океан', 'the answer is exposed only after giving up');
assert.equal(hinted.submit('океан').kind, 'revealed', 'guesses are closed after giving up');
assert.equal(hinted.hint().kind, 'unavailable');
await hinted.persistencePromise;

const restoredReveal = new WordGuessController({ dataLoader: hintLoader, storage: memoryStorage, now: fixedNow });
await restoredReveal.start();
assert.equal(restoredReveal.getState().isRevealed, true, 'giving up persists for the same day');
assert.equal(restoredReveal.getState().history[0].hint, true, 'hint markers survive a restart');

const freshState = new WordGuessController({ dataLoader: hintLoader, storage: null, now: fixedNow });
await freshState.start();
assert.equal(freshState.getState().answer, null, 'the answer is hidden during play');

console.log('✅ WordGuess controller tests passed!');
