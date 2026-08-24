import assert from 'node:assert';
import fs from 'node:fs';

const html = fs.readFileSync('src/pages/movie-details/movie-details.html', 'utf8');
const js = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');

for (const id of ['ratingModal', 'videoPlayerModal', 'trailerModal', 'announceModal']) {
    const tag = html.match(new RegExp(`<div id="${id}"[^>]+>`))?.[0] || '';
    assert(tag.includes('role="dialog"'), `${id} has dialog role`);
    assert(tag.includes('aria-modal="true"'), `${id} is modal`);
}
assert(html.includes('aria-controls="playerEpisodePickerPopover"'), 'episode picker button controls popover');
assert(html.includes('aria-modal="false"'), 'episode picker remains non-modal');
assert(js.includes('openAccessibleDialog('), 'shared focus entry helper exists');
assert(js.includes('closeAccessibleDialog('), 'shared focus restoration helper exists');
assert(js.includes('trapDialogFocus('), 'shared focus trap helper exists');
assert(js.includes("const announceOpen = announceModal?.style.display !== 'none';"), 'announcement dialog participates in global dialog lifecycle');
assert(js.includes('this.closeAnnounceModal();'), 'Escape closes announcement dialog');
assert(/showAnnounceModal[\s\S]*?this\.openAccessibleDialog\(modal\);/.test(js), 'announcement dialog receives focus on entry');
assert(/closeAnnounceModal[\s\S]*?this\.closeAccessibleDialog\(modal\);/.test(js), 'announcement dialog restores focus on close');
assert(js.includes('if (this.isEpisodePickerOpen && playerOpen)'), 'Escape closes picker before player');
assert(js.includes("if (trailerOpen)"), 'Escape closes topmost trailer modal');
assert(js.includes("if (ratingOpen)"), 'Escape closes rating modal');
console.log('✅ MovieDetails Phase 6C accessibility contract tests passed');
