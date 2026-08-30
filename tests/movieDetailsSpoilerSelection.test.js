import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');
const styles = fs.readFileSync('src/pages/movie-details/movie-details.css', 'utf8');

assert.match(source, /this\.setupEventListeners\(\);\s*this\.setupCommentReactionListeners\(\);\s*this\.initSelectionPopup\(\);/,
    'the rating-review spoiler popup is initialized with the movie details page');
assert.match(source, /className = 'selection-popup'/,
    'the selection popup is created for a non-empty review selection');
assert.match(source, /Скрыть как спойлер/,
    'the spoiler action communicates its purpose');
assert.match(source, /`\|\|\$\{selectedText\}\|\|`/,
    'the selected review text is persisted using the shared spoiler markup');
assert.match(styles, /\.selection-popup\s*\{[\s\S]*?position:\s*fixed;/,
    'the selection popup is positioned above the viewport content');
assert.match(styles, /\.selection-popup-btn\s*\{/,
    'the spoiler action has a visible button style');

console.log('✅ MovieDetails spoiler-selection contract tests passed');
