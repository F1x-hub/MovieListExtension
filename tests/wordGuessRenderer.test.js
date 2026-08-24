import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/shared/games/WordGuessRenderer.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/shared/styles/WordGuessGame.css', import.meta.url), 'utf8');

assert.match(source, /const sortedHistory = \[\.\.\.history\]\.sort/);
assert.match(source, /left\.rank - right\.rank \|\| left\.attempt - right\.attempt/);
assert.match(source, /--word-guess-rank-fill/);
assert.match(source, /--word-guess-rank-color/);
assert.match(source, /rankFill\(rank, maxRank\)/);
assert.match(source, /rankColor\(rank, maxRank\)/);
assert.match(source, /Math\.log\(rank\)/);
assert.match(source, /word-guess-history-list" data-role="history" tabindex="0"/);
assert.match(styles, /\.word-guess-history-list \{[\s\S]*max-height:/);
assert.match(styles, /\.word-guess-history-list \{[\s\S]*overflow-y: auto;/);

console.log('✅ WordGuess renderer ranking contract tests passed!');
