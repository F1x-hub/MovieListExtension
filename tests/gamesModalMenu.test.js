import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/shared/components/GamesModal.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/shared/styles/GamesModal.css', import.meta.url), 'utf8');

assert.match(source, /this\.activeGame = null/);
assert.match(source, /this\.showGameMenu\(\);/);
assert.match(source, /if \(!this\.activeGame\) return;/);
assert.equal((source.match(/class="game-menu-card /g) || []).length, 6,
    'the initial menu must expose all six games');
assert.match(source, /data-game="rubiks"/);
assert.match(styles, /rubiks-game-mode/);
assert.match(styles, /rubiks-face-turn-forward/);
assert.match(styles, /rubiks-face-turn-reverse/);
assert.match(source, /id="gamesPlayView" hidden/);
assert.match(source, /id="gamesBackBtn"/);
assert.match(styles, /\.games-modal-container\.menu-mode \.games-tab-bar/);
assert.match(styles, /\.game-menu-card:active/);
assert.match(styles, /prefers-reduced-motion/);

console.log('✅ Games modal menu contract tests passed!');
