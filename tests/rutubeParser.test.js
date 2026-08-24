import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('🧪 Running RutubeParser tests...');

const baseParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/BaseParserService.js', import.meta.url),
    'utf8'
);
const rutubeParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/RutubeParser.js', import.meta.url),
    'utf8'
);

const parserContext = vm.createContext({
    console,
    window: {},
    fetch: null,
    DOMParser: class MockDOMParser {}
});

vm.runInContext(baseParserSource, parserContext);
vm.runInContext(rutubeParserSource, parserContext);

const RutubeParser = parserContext.window.RutubeParser;
assert(RutubeParser, 'RutubeParser must be exported on window');

const parser = new RutubeParser();

// 1. Basic parser configuration & contracts
assert.strictEqual(parser.id, 'rutube');
assert.strictEqual(parser.name, 'Rutube');
assert.strictEqual(parser.getPlayerType(), 'video');

// 2. Query building test
console.log('  1. Testing _buildSearchQueries...');
const queriesWithYear = parser._buildSearchQueries('Матрица', 1999);
assert.deepStrictEqual([...queriesWithYear], ['Матрица 1999', 'Матрица фильм', 'Матрица']);

const queriesWithoutYear = parser._buildSearchQueries('Интерстеллар');
assert.deepStrictEqual([...queriesWithoutYear], ['Интерстеллар фильм', 'Интерстеллар']);

const queriesWithSpecialChars = parser._buildSearchQueries('Гарри Поттер: Философский камень', 2001);
assert.deepStrictEqual([...queriesWithSpecialChars], [
    'Гарри Поттер Философский камень 2001',
    'Гарри Поттер Философский камень фильм',
    'Гарри Поттер Философский камень'
]);

// 3. UGC garbage detection test
console.log('  2. Testing _isUgcGarbage...');
assert.strictEqual(parser._isUgcGarbage('Обзор на фильм Матрица 1999'), true, 'Review should be flagged as garbage');
assert.strictEqual(parser._isUgcGarbage('Матрица (1999) - Разбор сюжета и скрытый смысл'), true, 'Analysis should be flagged as garbage');
assert.strictEqual(parser._isUgcGarbage('Матрица 1999 Реакция блогера'), true, 'Reaction should be flagged as garbage');
assert.strictEqual(parser._isUgcGarbage('Прохождение игры The Matrix Path of Neo стрим 1'), true, 'Stream/walkthrough should be flagged as garbage');
assert.strictEqual(parser._isUgcGarbage('Матрица 1999 Трейлер на русском'), true, 'Trailer should be flagged as garbage');
assert.strictEqual(parser._isUgcGarbage('Матрица 1999 Саундтрек OST Clubbed to Death'), true, 'OST should be flagged as garbage');
assert.strictEqual(parser._isUgcGarbage('Саундтреки из фильма "Амели" 2004 г.', 'Амели'), true, 'Amelie soundtrack compilation must be flagged as garbage');
assert.strictEqual(parser._isUgcGarbage('Музыка из фильма Амели', 'Амели'), true, 'Movie music compilation must be flagged as garbage');
assert.strictEqual(parser._isUgcGarbage('Матрица 1999 Топ 10 фактов и пасхалок'), true, 'Top 10 / easter eggs should be flagged as garbage');
assert.strictEqual(parser._isUgcGarbage('Матрица / The Matrix (1999)'), false, 'Clean movie title should NOT be flagged as garbage');
assert.strictEqual(parser._isUgcGarbage('Матрица (1999) Full HD'), false, 'Full movie upload should NOT be flagged as garbage');
assert.strictEqual(parser._isUgcGarbage('Амели (2001) смотреть онлайн в Full HD', 'Амели'), false, 'Real Amelie movie upload should NOT be flagged as garbage');

// 4. Relevance scoring test
console.log('  3. Testing _scoreResult...');
const fullMovie = {
    title: 'Матрица (1999) Фильм в HD',
    duration: 8160, // 2h 16m
    is_official: false,
    category: { id: 4, name: 'Фильмы' }
};

const longReviewStream = {
    title: 'Подробный обзор фильма Матрица 1999 на 2 часа',
    duration: 7200,
    is_official: false,
    category: { id: 10, name: 'Блоги' }
};

const shortTrailer = {
    title: 'Матрица (1999) Официальный трейлер',
    duration: 150,
    is_official: true,
    category: { id: 4, name: 'Фильмы' }
};

const gameplayStream = {
    title: 'Матрица 1999 геймплей игры на стриме',
    duration: 9000,
    is_official: false
};

const wrongYearMovie = {
    title: 'Матрица: Воскрешение (2021) Фильм',
    duration: 8800,
    is_official: false,
    category: { id: 4, name: 'Фильмы' }
};

const scoreFullMovie = parser._scoreResult(fullMovie, 'Матрица', 1999);
const scoreReview = parser._scoreResult(longReviewStream, 'Матрица', 1999);
const scoreTrailer = parser._scoreResult(shortTrailer, 'Матрица', 1999);
const scoreGameplay = parser._scoreResult(gameplayStream, 'Матрица', 1999);
const scoreWrongYear = parser._scoreResult(wrongYearMovie, 'Матрица', 1999);

console.log('    Full Movie Score:', scoreFullMovie);
console.log('    Review Stream Score:', scoreReview);
console.log('    Trailer Score:', scoreTrailer);
console.log('    Gameplay Score:', scoreGameplay);
console.log('    Wrong Year Score:', scoreWrongYear);

assert(scoreFullMovie > 200, 'Full movie should get a very high score');
assert(scoreReview < 0, 'Review should receive negative score');
assert(scoreTrailer < 0, 'Trailer should receive negative score');
assert(scoreGameplay < 0, 'Gameplay should receive negative score');
assert(scoreFullMovie > scoreWrongYear, 'Matching year movie must beat wrong year movie');

// 5. Title parsing test (parsePageTitle)
console.log('  4. Testing parsePageTitle...');
const parsedAnime = parser.parsePageTitle('Магическая битва / Jujutsu Kaisen 2 сезон 5 серия [DubLikTV] — смотреть онлайн');
assert.strictEqual(parsedAnime.title, 'Магическая битва');
assert.strictEqual(parsedAnime.season, 2);
assert.strictEqual(parsedAnime.episode, 5);
assert.strictEqual(parsedAnime.channelName, 'DubLikTV');

assert.strictEqual(parser.getPlayerType(), 'video');

// 6. Search execution with mock fetch
console.log('  5. Testing search() with simulated Rutube API...');
parserContext.fetch = async (url) => {
    if (url.includes('query=%D0%9C%D0%B0%D1%82%D1%80%D0%B8%D1%86%D0%B0%201999')) {
        return {
            ok: true,
            status: 200,
            json: async () => ({
                results: [
                    {
                        id: 'a1b2c3d4e5f6',
                        title: 'Матрица (1999) Фильм',
                        duration: 8160,
                        publication_ts: '2023-01-01T00:00:00Z',
                        embed_url: 'https://rutube.ru/play/embed/a1b2c3d4e5f6',
                        thumbnail_url: 'https://rutube.ru/thumb/a1b2c3d4e5f6.jpg',
                        author: { name: 'CinemaHub' }
                    },
                    {
                        id: 'junk123',
                        title: 'Матрица 1999 Обзор от блогера',
                        duration: 5400,
                        embed_url: 'https://rutube.ru/play/embed/junk123'
                    }
                ]
            })
        };
    }
    if (url.includes('/api/play/options/a1b2c3d4e5f6/')) {
        return {
            ok: true,
            status: 200,
            json: async () => ({
                video_balancer: {
                    m3u8: 'https://river-4-415.rtbcdn.ru/live/master.m3u8'
                },
                title: 'Матрица (1999) Фильм HD',
                duration: 8160
            })
        };
    }
    return {
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
    };
};

const searchResult = await parser.search('Матрица', 1999);
assert(searchResult, 'Search result must not be null');
assert.strictEqual(searchResult.url, 'https://rutube.ru/video/a1b2c3d4e5f6/');
assert.strictEqual(searchResult.embedUrl, 'https://rutube.ru/play/embed/a1b2c3d4e5f6');
assert.strictEqual(searchResult.parserId, 'rutube');
assert.strictEqual(searchResult.source, 'rutube');
assert.strictEqual(searchResult.duration, 8160);

// 7. VideoSources test - HLS stream extraction
console.log('  6. Testing getVideoSources() with HLS stream...');
const sources = await parser.getVideoSources(searchResult);
assert.strictEqual(sources.length, 2, 'Should return HLS source + iframe fallback');
assert.strictEqual(sources[0].type, 'hls');
assert.strictEqual(sources[0].name, 'Rutube');
assert.strictEqual(sources[0].url, 'https://river-4-415.rtbcdn.ru/live/master.m3u8');
assert.strictEqual(sources[1].type, 'iframe');
assert.strictEqual(sources[1].name, 'Rutube (Embed)');
assert.strictEqual(sources[1].url, 'https://rutube.ru/play/embed/a1b2c3d4e5f6');

// 8. VideoSources test - Fallback when API returns no m3u8
console.log('  7. Testing getVideoSources() iframe fallback...');
parserContext.fetch = async (url) => {
    if (url.includes('/api/play/options/')) {
        return {
            ok: false,
            status: 403
        };
    }
    return { ok: true, status: 200, json: async () => ({}) };
};
const fallbackSources = await parser.getVideoSources(searchResult);
assert.strictEqual(fallbackSources.length, 1);
assert.strictEqual(fallbackSources[0].type, 'iframe');
assert.strictEqual(fallbackSources[0].name, 'Rutube');
assert.strictEqual(fallbackSources[0].url, 'https://rutube.ru/play/embed/a1b2c3d4e5f6');

console.log('✅ ALL RutubeParser unit tests passed successfully!');
