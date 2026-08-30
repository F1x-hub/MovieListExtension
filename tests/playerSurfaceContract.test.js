import assert from 'node:assert';
import fs from 'node:fs';

console.log('🧪 Running player surface contract tests...');

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const sharedStyles = read('../src/shared/styles/components.css');
const playerStyles = read('../src/shared/styles/player.css');
const movieHtml = read('../src/pages/movie-details/movie-details.html');
const movieDetailsStyles = read('../src/pages/movie-details/movie-details.css');
const cleaner = read('../content-scripts/player-cleaner.js');

assert.match(sharedStyles, /\.popover-surface\s*\{/);
assert.match(sharedStyles, /background:\s*var\(--popover-surface-bg\)/);
assert.match(sharedStyles, /border-radius:\s*var\(--popover-surface-radius\)/);
assert.match(sharedStyles, /box-shadow:\s*var\(--popover-surface-shadow\)/);
assert.match(sharedStyles, /backdrop-filter:\s*var\(--popover-surface-backdrop\)/);

assert.match(
    movieHtml,
    /class="popover-surface player-episode-picker"[^>]*id="playerEpisodePickerPopover"/,
    'episode picker must use the shared popover surface owner'
);
assert.match(movieHtml, /href="\.\.\/\.\.\/shared\/styles\/common\.css"/);
assert.match(movieHtml, /href="\.\.\/\.\.\/shared\/styles\/components\.css"/);
assert.doesNotMatch(movieDetailsStyles, /@import\s+url\([^)]*common\.css\)/);
assert.doesNotMatch(movieDetailsStyles, /@import\s+url\([^)]*components\.css\)/);

const volumeBlock = playerStyles.match(/\.video-container \.player-volume-popover\s*\{([\s\S]*?)\}/)?.[1] || '';
const settingsBlock = playerStyles.match(/\.video-container \.player-settings-menu\s*\{([\s\S]*?)\}/)?.[1] || '';
const pickerBlock = playerStyles.match(/\.player-episode-picker\s*\{([\s\S]*?)\}/)?.[1] || '';

for (const [name, block] of [
    ['volume popover', volumeBlock],
    ['settings menu', settingsBlock],
    ['episode picker', pickerBlock]
]) {
    assert.match(block, /--popover-surface-bg:/, `${name} must configure the shared surface background token`);
    assert.match(block, /--popover-surface-border:/, `${name} must configure the shared surface border token`);
    assert.match(block, /--popover-surface-radius:/, `${name} must configure the shared surface radius token`);
    assert.match(block, /--popover-surface-shadow:/, `${name} must configure the shared surface shadow token`);
    assert.match(block, /--popover-surface-backdrop:/, `${name} must configure the shared surface backdrop token`);
    assert.doesNotMatch(
        block,
        /(?:^|\n)\s*(?:background|border|border-radius|box-shadow|backdrop-filter)\s*:/,
        `${name} must leave common surface properties to .popover-surface`
    );
}

assert.match(
    cleaner,
    /\.native-player-wrapper \.popover-surface\s*\{/,
    'iframe-safe cleaner styles must provide the same popover surface contract'
);
assert.match(cleaner, /sliderContainer\.className = 'popover-surface player-volume-popover'/);
assert.match(cleaner, /settingsMenu\.className = 'popover-surface player-settings-menu'/);

for (const forbiddenInlineSurfaceRule of [
    /sliderContainer\.style\.backgroundColor\s*=/,
    /sliderContainer\.style\.borderRadius\s*=/,
    /settingsMenu\.style\.backgroundColor\s*=/,
    /settingsMenu\.style\.borderRadius\s*=/,
    /settingsMenu\.style\.boxShadow\s*=/,
    /settingsMenu\.style\.backdropFilter\s*=/
]) {
    assert.doesNotMatch(
        cleaner,
        forbiddenInlineSurfaceRule,
        'player popover surface must not be redefined through inline styles'
    );
}

assert.match(
    cleaner,
    /player-volume-popover\s*\{[\s\S]*?--popover-surface-radius:/,
    'volume popover must keep only its density-specific surface variant'
);

console.log('✅ Player surface contract tests passed!');
