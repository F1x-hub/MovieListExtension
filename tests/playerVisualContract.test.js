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
// Exact viewport fit is exercised in Chromium by torrentModalLayout.test.cjs.
assert.match(css, /width:\s*min\(94vw,\s*1180px,\s*calc\(177\.78dvh\s*-\s*\d+px\)\)/, 'modal width must reserve vertical room for its controls');
assert.match(css, /\.video-modal\s*>\s*\.video-body\s*\{[^}]*overflow-y:\s*auto\s*!important/, 'player body must allow access to the torrent workspace');

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
assert.match(cleaner, /centerPlayBtn\.style\.top = '50%'/, 'center action must sit halfway down the surface');
assert.match(cleaner, /centerPlayBtn\.style\.left = '50%'/, 'center action must sit halfway across the surface');
assert.match(cleaner, /centerPlayBtn\.style\.transform = 'translate\(-50%, -50%\)'/, 'center action must be geometrically centered');
assert.match(cleaner, /centerPlayBtn\.dataset\.icon = currentVid\.paused \? 'play' : 'pause'/, 'play and pause must expose their visual state');
assert.match(cleaner, /\.native-player-wrapper \.player-center-action\[data-icon="play"\] svg/, 'only the Play glyph may receive its optical offset');
assert.match(css, /\.video-container \.player-center-action\[data-icon="play"\] svg/, 'shared player CSS must scope the optical offset to Play');
assert.match(cleaner, /playPauseBtn\.dataset\.icon = currentVid\.paused \? 'play' : 'pause'/, 'bottom Play and Pause states must be distinguishable for optical alignment');
assert.match(cleaner, /player-control-button--primary\[data-icon="play"\] svg\s*\{[\s\S]*?translate\(-1\.5px, -0\.5px\)/, 'bottom Play glyph must compensate for its horizontal and vertical optical offset');
assert.match(css, /player-control-button--primary\[data-icon="play"\] svg\s*\{[\s\S]*?translate\(-1\.5px, -0\.5px\)/, 'shared player CSS must keep the bottom Play glyph optically centered');
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
assert.match(cleaner, /const SUBTITLE_APPEARANCE_STORAGE_KEY = 'movieExtensionSubtitleAppearanceV1';/, 'player must read the shared subtitle appearance preference');
assert.match(cleaner, /movie-extension-subtitle-host/, 'subtitle styling must remain scoped to the active native-player wrapper');
assert.match(cleaner, /controlsSafetyOffset/, 'visible controls must reserve caption-safe space');
assert.match(cleaner, /activeSubtitleResizeObserver/, 'caption positioning must react to player geometry changes');
assert.match(cleaner, /chrome\.storage\.onChanged\.addListener/, 'an open player must react to saved subtitle changes');
assert.match(cleaner, /const renderSubtitleAppearanceView = \(\)/, 'subtitle appearance must be editable inside the player');
assert.match(cleaner, /Настройки субтитров/, 'subtitle track menu must expose its appearance settings');
assert.match(cleaner, /player-subtitle-appearance__body/, 'in-player subtitle controls must have a scoped body');
assert.match(cleaner, /persistSubtitleAppearance/, 'in-player subtitle controls must persist changes');
assert.match(cleaner, /type: 'PLAYER_EPISODE_NAVIGATE'/, 'embedded arrows must request canonical host navigation');

console.log('✅ Player visual contract tests passed!');
