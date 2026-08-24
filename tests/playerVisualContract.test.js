import assert from 'node:assert';
import fs from 'node:fs';

console.log('🧪 Running player visual contract tests...');

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/shared/styles/player.css');
const html = read('../src/pages/movie-details/movie-details.html');
const movieDetails = read('../src/pages/movie-details/movie-details.js');
const baseParser = read('../src/shared/services/parsers/BaseParserService.js');
const seasonvar = read('../src/shared/services/parsers/SeasonvarParser.js');
const cleaner = read('../content-scripts/player-cleaner.js');

assert.doesNotMatch(css, /\.watch-btn(?:\b|-)/, 'legacy Netflix-red watch button CSS must be removed');
assert.doesNotMatch(css, /height:\s*(?:80|70)vh\b/, 'player modal must not use fixed 80vh/70vh heights');
assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/, 'player viewport must use a 16:9 aspect ratio');
assert.match(css, /body\.player-modal-open\s*\{[\s\S]*?overflow:\s*hidden/, 'open player must lock page scrolling');
assert.match(css, /width:\s*min\(94vw,\s*1180px,\s*calc\(177\.78dvh\s*-\s*220px\)\)/, 'modal width must reserve vertical room for its controls');
assert.match(css, /\.video-modal\s*>\s*\.video-body\s*\{[\s\S]*?overflow:\s*hidden\s*!important/, 'player body must not expose a vertical scrollbar');

const sourceListCss = css.match(/\.source-buttons-container\s*\{([\s\S]*?)\}/)?.[1] || '';
assert.match(sourceListCss, /flex-wrap:\s*nowrap/, 'source buttons must stay on one row');
assert.match(sourceListCss, /max-height:/, 'source list height must be bounded');
assert.match(sourceListCss, /overflow-x:\s*auto/, 'long source lists must scroll horizontally');

assert.strictEqual(
    (html.match(/id="videoContainer"/g) || []).length,
    1,
    'movie modal must expose exactly one player owner'
);
assert.match(html, /class="video-container player-surface" id="videoContainer"/);
assert.match(html, /data-player-bootstrap-loader/, 'initial player loader must hand off to the source lifecycle');
assert.match(html, /class="video-heading"/, 'player must use the compact cinematic heading');
assert.match(html, /class="source-toolbar"/, 'sources must live in the shared player toolbar');
assert.match(html, /id="closeVideoBtn"[^>]*type="button"[^>]*aria-label=/);
assert.match(html, /id="closeVideoBtn"[\s\S]*?<svg[\s\S]*?<\/button>/, 'player close must use the shared SVG pattern');

assert.match(movieDetails, /sourceButtonsContainer\.addEventListener\('click'/);
assert.doesNotMatch(movieDetails, /sourceButtonsContainer\.addEventListener\('mousedown'/);
assert.match(movieDetails, /closeVideoBtn\.addEventListener\('click'/);
assert.match(movieDetails, /event\.key !== 'Escape'/, 'Escape must close the player modal');
assert.match(movieDetails, /aria-pressed/);
assert.match(movieDetails, /document\.body\.classList\.add\('player-modal-open'\)/);
assert.match(movieDetails, /document\.body\.classList\.remove\('player-modal-open'\)/);

assert.doesNotMatch(movieDetails, /<iframe[^>]*style="[^"]*(?:width|height|border)/);
assert.doesNotMatch(baseParser, /<iframe[^>]*style="[^"]*(?:width|height|border)/);
assert.match(seasonvar, /class="player-clean player-surface__content"/);
assert.match(seasonvar, /class="player-surface__bridge" hidden/);
assert.doesNotMatch(seasonvar, /seasonvar-controls/);
assert.doesNotMatch(seasonvar, /addEventListener\('mousedown'/);

assert.match(cleaner, /native-player-wrapper player-surface__content/);
assert.match(cleaner, /bottomControls\.className = 'player-control-dock'/);
assert.match(cleaner, /bottomControls\.style\.bottom = '14px'/, 'custom controls must use a floating dock');
assert.match(cleaner, /centerPlayBtn\.style\.borderRadius = '20px'/, 'center action must use the modern squircle shape');
assert.match(cleaner, /centerPlayBtn = document\.createElement\('button'\)/, 'center action must be a native keyboard control');
assert.match(cleaner, /progressContainer\.className = 'player-progress-track'/);
assert.doesNotMatch(cleaner, /const thumbTooltip = document\.createElement\('div'\)/, 'progress track must not create a duplicate time tooltip');
assert.match(cleaner, /new GhostPlayer\(/, 'GhostPlayer must remain the single hover-preview owner');
assert.match(cleaner, /iframe-safe visual contract/, 'cleaner controls must carry their styles into cross-origin player frames');
assert.match(cleaner, /uiVersion: 'obsidian-3'/, 'cleaner readiness log must identify the active UI contract');
assert.match(cleaner, /player-settings-menu__list::-webkit-scrollbar/, 'settings popup must provide an iframe-safe custom scrollbar');
assert.match(cleaner, /player-settings-menu__list::-webkit-scrollbar-button/, 'custom scrollbar must suppress Windows arrow buttons');
assert.match(cleaner, /player-settings-menu__option\.is-active/, 'settings popup must use the shared monochrome active state');
assert.match(cleaner, /function makeKeyboardActivatable/);
assert.match(cleaner, /player-keyboard-action:focus-visible/);

console.log('✅ Player visual contract tests passed!');
