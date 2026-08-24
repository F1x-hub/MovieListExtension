const assert = require('assert');
const fs = require('fs');
const { SeasonvarAdapter } = require('../src/shared/services/player/adapters/SeasonvarAdapter');
const { VidSrcAdapter } = require('../src/shared/services/player/adapters/VidSrcAdapter');
const { KinogoAdapter } = require('../src/shared/services/player/adapters/KinogoAdapter');
const { ExFsAdapter } = require('../src/shared/services/player/adapters/ExFsAdapter');
const { RutubeAdapter } = require('../src/shared/services/player/adapters/RutubeAdapter');
const { canAutoNext } = require('../src/shared/services/player/PlaybackRuntime');

console.log('🧪 Running Phase 7 capability contract tests...');

const seasonvar = new SeasonvarAdapter();
const vidsrc = new VidSrcAdapter();
const kinogo = new KinogoAdapter();
const exfs = new ExFsAdapter();
const rutube = new RutubeAdapter();

assert.equal(seasonvar.supportsPrevNext(), true);
assert.equal(seasonvar.supportsAutoNext(), true);
assert.equal(vidsrc.supportsPrevNext(), true);
assert.equal(vidsrc.supportsAutoNext(), false);
assert.equal(vidsrc.canHandle({ mediaType: 'tv-series', imdbId: null }), false);
assert.equal(vidsrc.canHandle({ mediaType: 'tv-series', imdbId: 'tt9288030' }), true);
assert.equal(kinogo.supportsPrevNext(), true);
assert.equal(exfs.supportsPrevNext(), true);
assert.equal(rutube.supportsPrevNext(), false);
assert.equal(kinogo.supportsProviderInternalSelection(), true);
assert.equal(exfs.supportsProviderInternalSelection(), true);
assert.equal(rutube.supportsProviderInternalSelection(), true);
assert.equal(seasonvar.getSelectionMode(), 'DIRECT');
assert.equal(vidsrc.getSelectionMode(), 'DIRECT');
assert.equal(kinogo.getSelectionMode(), 'NATIVE_BRIDGE');
assert.equal(exfs.getSelectionMode(), 'NATIVE_BRIDGE');
assert.equal(rutube.getSelectionMode(), 'OPAQUE');

const selection = {
    kinopoiskId: 1209839,
    mediaType: 'tv-series',
    seasonNumber: 3,
    episodeNumber: 6,
    providerId: 'vidsrc'
};
const nextEpisode = { seasonNumber: 3, episodeNumber: 7, isReleased: true };
assert.equal(canAutoNext({
    selection,
    runtime: { progressConfidence: 'OPAQUE', isEnded: true },
    providerCapabilities: vidsrc,
    nextEpisode
}), false, 'Opaque VidSrc telemetry must not enable AutoNext');

const movieDetailsSource = fs.readFileSync(
    require.resolve('../src/pages/movie-details/movie-details.js'),
    'utf8'
);
const kinogoParserSource = fs.readFileSync(
    require.resolve('../src/shared/services/parsers/KinogoParser.js'),
    'utf8'
);
const baseParserSource = fs.readFileSync(
    require.resolve('../src/shared/services/parsers/BaseParserService.js'),
    'utf8'
);
assert.equal(movieDetailsSource.includes('isSeasonvar'), false);
assert.equal(movieDetailsSource.includes('isVidSrc'), false);
assert.equal(movieDetailsSource.includes('activeProvider ==='), false);
assert.equal(
    movieDetailsSource.includes('this.playbackController.setActiveProvider(providerKey);'),
    true,
    'Manual parser/VidSrc source changes must synchronize the canonical active provider'
);
assert.equal(
    movieDetailsSource.includes('manuallyMountedParser'),
    true,
    'Already-mounted parser players must reuse parser lifecycle instead of empty adapter mounts'
);
assert.equal(
    movieDetailsSource.includes('const explicitSource = this.activeSourceValue'),
    true,
    'Explicit source-button intent must win over stale saved source selection'
);
assert.equal(
    movieDetailsSource.includes('const rawSeasonvarSeasons = this.currentSeasonvarPlaybackState?.seasons?.length'),
    true,
    'Picker must keep Seasonvar season URLs as the canonical browsing source'
);
assert.equal(
    movieDetailsSource.includes('&& !seasonvarSeasons.some(s => Number(s.seasonNumber) === Number(browsingSeason) && s.url)'),
    true,
    'Episode rendering must not fall back to stale TMDB counts when Seasonvar has the season URL'
);
assert.equal(
    movieDetailsSource.includes('data-season-number="${browsingSeason}"'),
    true,
    'Episode picker buttons must carry the season they belong to'
);
assert.equal(
    movieDetailsSource.includes('[SeasonPickerTrace] Seasonvar resolution'),
    true,
    'Season picker must expose detailed Seasonvar resolution diagnostics'
);
assert.equal(
    movieDetailsSource.includes('[SeasonPickerTrace] mountPlayer result'),
    true,
    'Season picker must expose the final mounted Seasonvar state'
);
assert.equal(
    movieDetailsSource.includes('(!supportsPrevNext && !supportsPicker)'),
    true,
    'Picker-only providers must keep host navigation visible without Prev/Next support'
);
assert.equal(
    movieDetailsSource.includes('prevBtn.style.display = supportsPrevNext ? \'\' : \'none\''),
    true,
    'Picker-only providers must hide only unsupported Prev/Next controls'
);
assert.equal(
    movieDetailsSource.includes('season?.season_number'),
    true,
    'Picker must normalize Seasonvar snake_case season numbers'
);
assert.equal(
    movieDetailsSource.includes("source: 'seasonvar-metadata'"),
    true,
    'Non-Seasonvar providers must use normalized season episode counts'
);
const kinogoSource = fs.readFileSync(
    require.resolve('../src/shared/services/parsers/KinogoParser.js'),
    'utf8'
);
assert.equal(
    kinogoSource.includes("getMirrors({ mediaType = null } = {})"),
    true,
    'KinoGo mirror selection must accept the requested media type'
);
assert.equal(
    kinogoSource.includes("mirror === 'https://kinogo.my'"),
    true,
    'KinoGo series searches must prefer the native-picker mirror'
);
assert.equal(
    kinogoSource.includes('isSearchResultCompatible(result, movieType)'),
    true,
    'KinoGo must validate search results against the requested media type'
);
assert.equal(
    baseParserSource.includes('const forceRefresh = options?.forceRefresh === true'),
    true,
    'Source cache must support bypassing expired provider embed tokens'
);
assert.equal(
    movieDetailsSource.includes('source cache policy'),
    true,
    'KinoGo season remounts must expose their source-cache policy in diagnostics'
);
const playerCleanerSource = fs.readFileSync(
    require.resolve('../content-scripts/player-cleaner.js'),
    'utf8'
);
assert.equal(
    playerCleanerSource.includes('APPLY_PLAYBACK_SELECTION'),
    true,
    'Provider-native selection bridge must use an explicit message contract'
);
assert.equal(
    playerCleanerSource.includes('PLAYBACK_SELECTION_RESULT'),
    true,
    'Provider-native selection bridge must acknowledge dispatch status'
);
assert.equal(
    playerCleanerSource.includes('div[class*="dropdown_"]'),
    true,
    'Provider-native bridge must target the source player dropdown structure'
);
assert.equal(
    playerCleanerSource.includes("includes(suffix)"),
    true,
    'Provider-native bridge must distinguish season and episode menu items'
);
assert.equal(
    playerCleanerSource.includes('[data-select="seasonType1"]'),
    true,
    'KinoGo bridge must target the real season selector'
);
assert.equal(
    playerCleanerSource.includes('[data-select="episodeType1"]'),
    true,
    'KinoGo bridge must target the real episode selector'
);
assert.equal(
    playerCleanerSource.includes('selection confirmation'),
    true,
    'KinoGo bridge must confirm the requested season and episode became active'
);
assert.equal(
    playerCleanerSource.includes('hasKinogoDataSelect'),
    true,
    'KinoGo bridge must detect which native selector contract is present'
);
assert.equal(
    playerCleanerSource.includes('trying class-based provider bridge'),
    true,
    'KinoGo must fall back to the Stravers class-based selector contract'
);
assert.equal(
    movieDetailsSource.includes('retryKinogoAfterContentError'),
    true,
    'KinoGo content 404s must trigger a bounded fresh-embed recovery'
);
assert.equal(
    movieDetailsSource.includes('maxAttempts: 1'),
    true,
    'KinoGo fresh-embed recovery must not enter an infinite retry loop'
);
const kinogoAdapterSource = fs.readFileSync(
    require.resolve('../src/shared/services/player/adapters/KinogoAdapter.js'),
    'utf8'
);
assert.equal(
    kinogoAdapterSource.includes('orderSourcesForNativeBridge'),
    true,
    'KinoGo series mounts must prefer a bridge-compatible balancer embed'
);
assert.equal(
    kinogoAdapterSource.includes('stravers\\.live|allarknow\\.online'),
    true,
    'KinoGo bridge-compatible balancers must remain explicitly allowlisted'
);
const orderedKinogoSources = kinogo.orderSourcesForNativeBridge([
    { url: 'https://api.ortified.ws/embed/movie/54533' },
    { url: 'https://kinogomy.stravers.live/embed/movie/54533' }
], { mediaType: 'tv-series' });
assert.equal(
    orderedKinogoSources[0].url.includes('stravers.live'),
    true,
    'KinoGo series must put the native-selector balancer first'
);
assert.equal(
    movieDetailsSource.includes('orderParserSourcesForNativeBridge'),
    true,
    'Legacy KinoGo mounts must reuse bridge-compatible source ordering'
);
assert.equal(
    movieDetailsSource.includes("sources = this.orderParserSourcesForNativeBridge(parserId, sources, selection)"),
    true,
    'Legacy KinoGo source loads must order embeds before rendering'
);
assert.equal(
    movieDetailsSource.includes('requiresSeasonSpecificSearch'),
    true,
    'KinoGo episode selection must bypass stale preloaded season sources'
);
assert.equal(
    movieDetailsSource.includes('seasonNumber: selection?.seasonNumber ?? null'),
    true,
    'KinoGo episode selection must pass the requested season into search'
);
assert.equal(
    kinogoParserSource.includes('extractSearchSeasonNumber'),
    true,
    'KinoGo search must extract season numbers from result titles and URLs'
);
assert.equal(
    kinogoParserSource.includes('requestedSeasonNumber'),
    true,
    'KinoGo search ranking must account for the requested season'
);
assert.equal(
    baseParserSource.includes("const seasonNumber = options?.seasonNumber ?? ''"),
    true,
    'Parser search cache keys must separate season-specific searches'
);
const manifestSource = fs.readFileSync(require.resolve('../manifest.json'), 'utf8');
assert.equal(
    manifestSource.includes('https://kinogo.my/*'),
    true,
    'KinoGo native bridge host must be covered by the manifest'
);

console.log('✅ Phase 7 capability contract and host UI ownership checks passed');
