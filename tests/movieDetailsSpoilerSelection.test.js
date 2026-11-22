import assert from 'node:assert/strict';
import fs from 'node:fs';

// The spoiler action belongs to the shared rating dialog, on Movie Details and Ratings.
const source = fs.readFileSync('src/shared/components/RatingDialog.js', 'utf8');
const styles = fs.readFileSync('src/shared/styles/rating-dialog.css', 'utf8');
const locales = fs.readFileSync('src/shared/i18n/locales.js', 'utf8');

for (const field of ['comment', 'review']) {
    assert.match(source, new RegExp(`for \\(const field of \\[comment, review\\]\\)[\\s\\S]*?updateSpoilerPopup\\(field\\)`),
        `the ${field} field offers the spoiler action for a selection`);
}
assert.match(source, /className = 'selection-popup'/,
    'the selection popup is created for a non-empty review selection');
assert.match(source, /t\('spoiler_title'\)/, 'the spoiler action has a title');
assert.match(locales, /spoiler_title: "Скрыть как спойлер"/,
    'the spoiler action communicates its purpose');
assert.match(source, /`\|\|\$\{selected\}\|\|`/,
    'the selected review text is persisted using the shared spoiler markup');
assert.match(source, /textLength\(candidate\) > max/, 'a spoiler never pushes a field over its limit');
assert.match(styles, /\.selection-popup\s*\{[\s\S]*?position:\s*fixed;/,
    'the selection popup is positioned above the viewport content');
assert.match(styles, /\.selection-popup-btn\s*\{/,
    'the spoiler action has a visible button style');

console.log('✅ Rating dialog spoiler-selection contract tests passed');
