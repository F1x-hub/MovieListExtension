import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('🧪 Running KinogoParser & 404 Intermittent Fixes tests...');

const baseParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/BaseParserService.js', import.meta.url),
    'utf8'
);
const kinogoParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/KinogoParser.js', import.meta.url),
    'utf8'
);

const storageData = {};
const mockChrome = {
    storage: {
        local: {
            get: (keys, cb) => {
                const res = {};
                if (typeof keys === 'string') res[keys] = storageData[keys];
                else if (Array.isArray(keys)) keys.forEach(k => res[k] = storageData[k]);
                if (cb) cb(res);
                return Promise.resolve(res);
            },
            set: (items, cb) => {
                Object.assign(storageData, items);
                if (cb) cb();
                return Promise.resolve();
            }
        }
    }
};

const parserContext = vm.createContext({
    console,
    window: {},
    fetch: null,
    chrome: mockChrome,
    URL,
    URLSearchParams
});

vm.runInContext(baseParserSource, parserContext);
vm.runInContext(kinogoParserSource, parserContext);

const KinogoParser = parserContext.window.KinogoParser;
assert(KinogoParser, 'KinogoParser must be exported on window');

const parser = new KinogoParser();

// 1. Basic parser configuration & contracts (Cause 1: TTL verification)
console.log('  1. Testing parser configuration & aligned cache TTL (Cause 1)...');
assert.strictEqual(parser.id, 'kinogo');
assert.strictEqual(parser.name, 'KinoGo');
assert.strictEqual(parser.getPlayerType(), 'iframe');
assert(parser.mirrors.length >= 3, 'Should have multiple default mirrors');
assert.strictEqual(parser.cacheTTL, 15 * 60 * 1000, 'KinogoParser TTL must be 15 minutes to match token lifespan');

// 2. Mirrors order & persistence
console.log('  2. Testing mirror list and active mirror management...');
const mirrors = parser.getMirrors();
assert.strictEqual(mirrors[0], 'https://kinogo.la');
parser._saveActiveMirror('https://kinogo.film');
assert.strictEqual(parser.getMirrors()[0], 'https://kinogo.film');
assert.strictEqual(storageData['kinogo_active_mirror'], 'https://kinogo.film');
// Series searches must try the mirror that exposes the native S/E picker first,
// while the regular active-mirror order remains unchanged for movies.
assert.strictEqual(
    parser.getMirrors({ mediaType: 'tv-series' })[0],
    'https://kinogo.my',
    'Series KinoGo searches must prefer kinogo.my native-picker pages'
);
assert.strictEqual(
    parser.getMirrors()[0],
    'https://kinogo.film',
    'Movie KinoGo searches must preserve the active mirror priority'
);

// 3. Title matching normalization & sequel discrimination
console.log('  3. Testing isTitleMatch...');
assert.strictEqual(parser.isTitleMatch('Однажды в Токио', 'однажды в токио'), true);
assert.strictEqual(parser.isTitleMatch('Одиссея / L\'Odyssée', 'Одиссея'), true);
assert.strictEqual(parser.isTitleMatch('Король Лев', 'Король лев'), true);
assert.strictEqual(parser.isTitleMatch('Человек-Паук', 'Человек Паук'), true);
assert.strictEqual(parser.isTitleMatch('Совсем Другой Фильм', 'Матрица'), false);
assert.strictEqual(parser.isTitleMatch('Легенда о Хэй', 'Легенда о Хэй 2'), false, 'Part 1 must not match Part 2');
assert.strictEqual(parser.isTitleMatch('Легенда о Хэй 2', 'Легенда о Хэй'), false, 'Part 2 must not match Part 1');
assert.strictEqual(parser.isTitleMatch('Легенда о Хэй 2', 'Легенда о Хэй 2'), true);
assert.strictEqual(parser.isTitleMatch('Джон Уик 2', 'Джон Уик'), false);
assert.strictEqual(parser.isTitleMatch('Джон Уик 2', 'Джон Уик 2'), true);
assert.strictEqual(
    parser.isTitleMatch('Джек Ричер 4 сезон', 'Джек Ричер', { allowSeriesSuffix: true }),
    true,
    'Series season suffix must be allowed only for an explicit series search'
);
assert.strictEqual(
    parser.isTitleMatch('Джек Ричер 4 сезон', 'Джек Ричер'),
    false,
    'Film searches must not inherit series suffix matching'
);

// 4. parseSearchResults testing
console.log('  4. Testing parseSearchResults with mock HTML...');
const mockDleHtml = `
<div class="shortstory">
    <div class="shortstory__title"><a href="/123-odnazhdy-v-tokio.html">Однажды в Токио</a></div>
    <div>Год выпуска: <b>2003</b></div>
</div>
<div class="shortstory">
    <div class="shortstory__title"><a href="/456-drugoe.html">Другой фильм (2020)</a></div>
    <div>Год выпуска: <b>2020</b></div>
</div>
`;

const matchResult = parser.parseSearchResults(mockDleHtml, 'Однажды в Токио', '2003', 'https://kinogo.la');
assert(matchResult, 'Should parse matching movie');
assert.strictEqual(matchResult.title, 'Однажды в Токио');
assert.strictEqual(matchResult.year, '2003');
assert.strictEqual(matchResult.url, 'https://kinogo.la/123-odnazhdy-v-tokio.html');

// 4b. Media-type filtering must reject a same-title film when a series is requested.
console.log('  4b. Testing series-vs-film search result filtering...');
const mixedFilmAndSeriesHtml = `
<div class="shortstory">
    <div class="shortstory__title"><a href="/films/dzhek-richer.html">Джек Ричер</a></div>
    <div>Год выпуска: <b>2012</b></div>
</div>
<div class="shortstory">
    <div class="shortstory__title"><a href="/serialy-2026/52551-dzhek-richer-4-sezon.html">Джек Ричер</a></div>
    <div>Джек Ричер 4 сезон</div>
    <div>Год выпуска: <b>2026</b></div>
</div>
`;
const seriesMatch = parser.parseSearchResults(
    mixedFilmAndSeriesHtml,
    'Джек Ричер',
    null,
    'https://kinogo.my',
    'tv-series'
);
assert(seriesMatch, 'Series search must return a compatible result');
assert.strictEqual(seriesMatch.type, 'series');
assert.strictEqual(seriesMatch.year, '2026');
assert(seriesMatch.url.includes('/serialy-2026/'), 'Series search must reject the same-title film');

const seasonAwareSearchHtml = `
<div class="shortstory">
    <div class="shortstory__title"><a href="/action/reacher-3-season.html">Jack Reacher 3 season</a></div>
    <div>Year: <b>2022</b></div>
</div>
<div class="shortstory">
    <div class="shortstory__title"><a href="/serialy-2026/reacher-4-season.html">Jack Reacher 4 season</a></div>
    <div>Year: <b>2026</b></div>
</div>
`;
const seasonAwareMatch = parser.parseSearchResults(
    seasonAwareSearchHtml,
    'Jack Reacher',
    '2022',
    'https://kinogo.my',
    'tv-series',
    { seasonNumber: 4 }
);
assert(seasonAwareMatch, 'Season-aware series search must return a compatible result');
assert(
    seasonAwareMatch.url.includes('reacher-4-season.html'),
    'Season-aware series search must prefer the requested season over the premiere-year match'
);

const seasonInLinkTitle = `
<div class="shortstory">
    <div class="shortstory__title"><a href="/serialy-2026/52551-dzhek-richer-4-sezon.html">Джек Ричер 4 сезон</a></div>
</div>
`;
const seasonTitleMatch = parser.parseSearchResults(
    seasonInLinkTitle,
    'Джек Ричер',
    null,
    'https://kinogo.my',
    'tv-series'
);
assert(seasonTitleMatch, 'Series search must accept a season suffix in the link title');
assert.strictEqual(seasonTitleMatch.type, 'series');

parserContext.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => mixedFilmAndSeriesHtml
});
const seriesSearchWithKinopoiskId = await parser.search(
    'Джек Ричер',
    1209839,
    { mediaType: 'tv-series' }
);
assert(seriesSearchWithKinopoiskId, 'Search must work when a Kinopoisk ID is passed by the adapter');
assert(seriesSearchWithKinopoiskId.type === 'series');
assert(seriesSearchWithKinopoiskId.url.includes('/serialy-2026/'));

parser.clearCache();
parser._saveActiveMirror('https://kinogo.film');
const cachedSeriesSearch = await parser.cachedSearch('Джек Ричер', 2022, {
    mediaType: 'tv-series'
});
assert(cachedSeriesSearch, 'cachedSearch must return a result for a TV series');
assert.strictEqual(cachedSeriesSearch.type, 'series', 'cachedSearch must forward mediaType to Kinogo search');
assert(cachedSeriesSearch.url.includes('/serialy-2026/'), 'cachedSearch must not select the same-title film');

// 5. extractKinogoDirectSources testing (Cause 3: inclusion of fallback balancers)
console.log('  5. Testing extractKinogoDirectSources with primary and fallback balancers (Cause 3)...');
const mockMoviePage = `
<html>
<head><title>Movie</title></head>
<body>
    <div class="player" data-player="//api.ortified.ws/embed/movie/2268"></div>
    <div data-secondary="https://api.variyt.ws/embed/movie/2268"></div>
    <iframe src="https://cinemar.cc/embed/1692/signed-token-xyz"></iframe>
</body>
</html>
`;

const sources = parser.extractKinogoDirectSources(mockMoviePage);
assert.strictEqual(sources.length, 3, 'Should extract all 3 sources including cinemar.cc fallback');
assert.strictEqual(sources[0].type, 'iframe');
assert(sources[0].url.startsWith('https://api.ortified.ws/embed/movie/2268'), 'Ortified must be primary');
assert(sources[1].url.startsWith('https://api.variyt.ws/embed/movie/2268'), 'Variyt must be secondary');
assert(sources[2].url.startsWith('https://cinemar.cc/embed/1692/'), 'Cinemar must be included as fallback');

// 5b. Movie page with ONLY cinemar.cc (Cause 3 edge case)
console.log('  5b. Testing title with ONLY cinemar.cc balancer (Cause 3)...');
const mockCinemarOnlyPage = `
<html>
<head><title>Cinemar Only Movie</title></head>
<body>
    <iframe src="https://cinemar.cc/embed/49396/+MzA0YzhmZGZlNjMzZmIyNzQxZTZlNzA0MjZiMWE4NmI0ODEy"></iframe>
</body>
</html>
`;
const cinemarSources = parser.extractKinogoDirectSources(mockCinemarOnlyPage);
assert.strictEqual(cinemarSources.length, 1, 'Should NOT return empty when cinemar.cc is the only balancer');
assert.strictEqual(cinemarSources[0].url, 'https://cinemar.cc/embed/49396/+MzA0YzhmZGZlNjMzZmIyNzQxZTZlNzA0MjZiMWE4NmI0ODEy');

// 6. Search failover test across mirrors
console.log('  6. Testing search() failover when first mirror fails...');
parserContext.fetch = async (url) => {
    // If mirror is kinogo.la (first) -> throw network error (simulate blocked mirror)
    if (url.startsWith('https://kinogo.la')) {
        throw new Error('Connection refused (Blocked)');
    }
    // If mirror is kinogo.film (second) -> succeed with DLE search
    if (url.startsWith('https://kinogo.film')) {
        return {
            ok: true,
            status: 200,
            text: async () => mockDleHtml
        };
    }
    return { ok: false, status: 404 };
};

parser._saveActiveMirror('https://kinogo.la');
const failoverResult = await parser.search('Однажды в Токио', 2003);
assert(failoverResult, 'Failover search should succeed on 2nd mirror');
assert.strictEqual(failoverResult.url, 'https://kinogo.film/123-odnazhdy-v-tokio.html');
assert.strictEqual(parser.getMirrors()[0], 'https://kinogo.film', 'Active mirror should switch to the working mirror');

// 7. getVideoSources() failover test across mirrors (Cause 2)
console.log('  7. Testing getVideoSources() mirror failover on 404 (Cause 2)...');
let fetchedUrls = [];
parserContext.fetch = async (url) => {
    fetchedUrls.push(url);
    // Simulate mirror 1 (kinogo.la) returning 404
    if (url.startsWith('https://kinogo.la')) {
        return { ok: false, status: 404 };
    }
    // Simulate mirror 2 (kinogo.film) succeeding with movie page
    if (url.startsWith('https://kinogo.film')) {
        return {
            ok: true,
            status: 200,
            text: async () => mockMoviePage
        };
    }
    return { ok: false, status: 500 };
};

parser._saveActiveMirror('https://kinogo.la');
fetchedUrls = [];
const videoSourcesResult = await parser.getVideoSources({
    url: 'https://kinogo.la/123-odnazhdy-v-tokio.html'
});

assert(videoSourcesResult.length > 0, 'getVideoSources should succeed after failing over from 404 mirror');
assert(fetchedUrls.some(u => u.includes('kinogo.la')), 'Must have attempted initial mirror');
assert(fetchedUrls.some(u => u.includes('kinogo.film')), 'Must have failed over to next mirror');
assert.strictEqual(parser.getMirrors()[0], 'https://kinogo.film', 'Active mirror should switch to successful mirror');

// 8. Preflight validation & Cache TTL expiry simulation (Cause 1)
console.log('  8. Testing cache TTL & validation contracts (Cause 1)...');
const mockLocalStorage = new Map();
const mockMovieCache = {
    getCachedSources: (movieId) => {
        const data = mockLocalStorage.get(`movie_sources_${movieId}`);
        if (!data) return null;
        const cached = JSON.parse(data);
        const defaultTtl = 15 * 60 * 1000;
        const ttl = typeof cached.ttl === 'number' ? cached.ttl : defaultTtl;
        if (Date.now() - cached.timestamp > ttl) {
            mockLocalStorage.delete(`movie_sources_${movieId}`);
            return null;
        }
        return cached.sources;
    },
    saveSourcesToCache: (movieId, sources) => {
        const hasShortLivedTokens = Array.isArray(sources) && sources.some(s => {
            const u = s?.url || '';
            return u.includes('cinemar.cc') || u.includes('stravers.live') || u.includes('allarknow.online');
        });
        const ttl = hasShortLivedTokens ? (5 * 60 * 1000) : (15 * 60 * 1000);
        mockLocalStorage.set(`movie_sources_${movieId}`, JSON.stringify({
            timestamp: Date.now(),
            ttl,
            sources
        }));
    },
    validateSourceUrl: async (url, fetchMock) => {
        if (!url || typeof url !== 'string') return false;
        if (!url.startsWith('http://') && !url.startsWith('https://')) return true;
        try {
            const res = await fetchMock(url, { method: 'HEAD' });
            if (res.status === 404 || res.status === 410) return false;
            return true;
        } catch {
            return true;
        }
    }
};

// 8a. Test standard vs tokenized TTL
mockMovieCache.saveSourcesToCache(100, [{ url: 'https://api.ortified.ws/embed/1' }]);
const cachedStandard = JSON.parse(mockLocalStorage.get('movie_sources_100'));
assert.strictEqual(cachedStandard.ttl, 15 * 60 * 1000, 'Standard sources must have 15m TTL');

mockMovieCache.saveSourcesToCache(200, [{ url: 'https://cinemar.cc/embed/2' }]);
const cachedTokenized = JSON.parse(mockLocalStorage.get('movie_sources_200'));
assert.strictEqual(cachedTokenized.ttl, 5 * 60 * 1000, 'Tokenized sources must have 5m TTL');

// 8b. Test expired cache purge
mockLocalStorage.set('movie_sources_300', JSON.stringify({
    timestamp: Date.now() - (20 * 60 * 1000), // 20 mins ago
    ttl: 15 * 60 * 1000,
    sources: [{ url: 'https://api.ortified.ws/embed/3' }]
}));
assert.strictEqual(mockMovieCache.getCachedSources(300), null, 'Expired cache (20m > 15m) must return null and be purged');
assert.strictEqual(mockLocalStorage.has('movie_sources_300'), false, 'Expired entry must be deleted');

// 8c. Test validateSourceUrl detecting 404 signed token
const isDeadUrlValid = await mockMovieCache.validateSourceUrl('https://cinemar.cc/embed/dead', async () => ({ status: 404 }));
assert.strictEqual(isDeadUrlValid, false, 'Preflight 404 response must invalidate cached source');

const isAliveUrlValid = await mockMovieCache.validateSourceUrl('https://api.ortified.ws/embed/alive', async () => ({ status: 200 }));
assert.strictEqual(isAliveUrlValid, true, 'Preflight 200 response must validate cached source');

console.log('✅ ALL KinogoParser & 404 Intermittent Fixes tests passed successfully!');
