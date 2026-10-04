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
const layerOrder = id => Number(js.match(new RegExp(`stack\\.register\\('${id}', \\{\\s*order: (\\d+)`))?.[1]);
assert(Number.isFinite(layerOrder('announce')), 'announcement dialog participates in global dialog lifecycle');
assert(/register\('announce'[\s\S]*?close: \(\) => this\.closeAnnounceModal\(\)/.test(js), 'Escape closes announcement dialog');
assert(/showAnnounceModal[\s\S]*?this\.openAccessibleDialog\(modal\);/.test(js), 'announcement dialog receives focus on entry');
assert(/closeAnnounceModal[\s\S]*?this\.closeAccessibleDialog\(modal\);/.test(js), 'announcement dialog restores focus on close');
assert(layerOrder('episode-picker') < layerOrder('video-player'), 'Escape closes picker before player');
assert(layerOrder('trailer') < layerOrder('video-player'), 'Escape closes topmost trailer modal');
assert(layerOrder('rating') < layerOrder('video-player'), 'Escape closes rating modal');
console.log('✅ MovieDetails Phase 6C accessibility contract tests passed');
