import assert from 'node:assert/strict';
import fs from 'node:fs';

const cleaner = fs.readFileSync('content-scripts/player-cleaner.js', 'utf8');
const hostMarkup = fs.readFileSync('src/pages/movie-details/movie-details.html', 'utf8');
const hostController = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');

assert.equal(
    cleaner.includes('__movieExtensionLegacyEpisodePicker'),
    false,
    'legacy episode-picker emergency flag must be retired'
);
assert.equal(
    cleaner.includes('legacy-episode-list-disabled'),
    false,
    'legacy episode-picker element must not be created'
);
assert.equal(
    cleaner.includes('episodeListBtn.addEventListener'),
    false,
    'legacy episode-picker listener must be retired'
);
assert.match(hostMarkup, /id="playerEpisodesListBtn"/);
assert.match(hostMarkup, /id="playerEpisodePickerPopover"/);
assert.match(hostController, /toggle-episode-picker/);

console.log('✅ legacy episode picker retirement contract tests passed');
