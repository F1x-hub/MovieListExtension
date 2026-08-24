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

console.log('✅ WordGuess controller tests passed!');
