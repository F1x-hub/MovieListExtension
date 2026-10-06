/**
 * AnimeGo matching for titles that Kinopoisk and AnimeGo inflect differently
 * ("Невероятные приключения ДжоДжо" vs "Невероятное приключение ДжоДжо") and
 * for later seasons AnimeGo lists under a subtitle instead of a number, plus
 * the Movie Details IMDb fallback used while the ratings proxy is unavailable.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const rootDir = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

function card({ title, original = '', href, kind = 'Сериал', year }) {
    return `
        <div class="ani-grid__item g-col-6">
            <div class="ani-grid__item-body pt-2">
                <div class="fw-lighter small mb-1">${original}</div>
                <div class="ani-grid__item-title h5"><a title="${title}" href="${href}">${title}</a></div>
                <div class="ani-grid__item-genres">
                    <span><span class="ani-grid__item-genres__link">${kind}</span></span>
                    <span><span class="ani-grid__item-genres__link">${year}</span></span>
                </div>
            </div>
        </div>`;
}

const searchHtml = `<div class="grid ani-list">${[
    card({ title: 'Невероятное приключение ДжоДжо', original: 'JoJo no Kimyou na Bouken (TV)', href: '/anime/jojo-983', year: 2012 }),
    card({ title: 'Невероятное приключение ДжоДжо: Золотой ветер', href: '/anime/jojo-golden-1520', year: 2018 }),
    card({ title: 'Невероятное приключение ДжоДжо OVA (2000)', href: '/anime/jojo-ova-500', kind: 'OVA', year: 2000 }),
    card({ title: 'Невероятное приключение ДжоДжо: Каменный океан. Часть 2', href: '/anime/jojo-stone-2-2100', kind: 'ONA', year: 2022 }),
    card({ title: 'Невероятное приключение ДжоДжо: Каменный океан', href: '/anime/jojo-stone-2000', kind: 'ONA', year: 2021 }),
    card({ title: 'Невероятное приключение ДжоДжо: Спешл', href: '/anime/jojo-special-2601', kind: 'Спешл', year: 2026 }),
    card({ title: 'Невероятное приключение ДжоДжо: Гонка «Стальной шар»', href: '/anime/jojo-sbr-2600', kind: 'ONA', year: 2026 }),
    card({ title: 'Пляжные приключения Муроми', href: '/anime/muromi-700', year: 2013 })
].join('')}</div>`;

function createParser() {
    const dom = new JSDOM('<!doctype html><body></body>', {
        runScripts: 'dangerously',
        url: 'chrome-extension://test/src/pages/movie-details/movie-details.html'
    });
    dom.window.eval(read('src/shared/services/parsers/BaseParserService.js'));
    dom.window.eval(`${read('src/shared/services/parsers/AnimeGoParser.js')};window.__AnimeGoParser = AnimeGoParser;`);
    return { AnimeGoParser: dom.window.__AnimeGoParser, parser: new dom.window.__AnimeGoParser() };
}

async function run() {
    const { AnimeGoParser, parser } = createParser();

    // Inflected Russian titles match by word stems; the year still decides.
    const base = parser.parseSearchResults(searchHtml, 'Невероятные приключения ДжоДжо', 2012);
    assert.equal(base?.title, 'Невероятное приключение ДжоДжо');
    assert.equal(parser.parseSearchResults(searchHtml, 'Невероятные приключения ДжоДжо', 2017), null, 'a different year is a different title');
    assert.equal(parser.parseSearchResults(searchHtml, 'Приключения', 2013), null, 'one shared word is not a match');
    assert.equal(AnimeGoParser.titleStems('Невероятные приключения ДжоДжо'), AnimeGoParser.titleStems('Невероятное приключение ДжоДжо'));
    assert.equal(AnimeGoParser.normalizeTitle('JoJo no Kimyou na Bouken (TV)'), AnimeGoParser.normalizeTitle('JoJo no Kimyou na Bouken'));
    assert.equal(parser.parseSearchResults(searchHtml, 'JoJo no Kimyou na Bouken', 2012)?.title, 'Невероятное приключение ДжоДжо');

    // Later seasons named by subtitle are found by the season's year.
    const season6 = parser.findSeasonResult(searchHtml, base, 6, 2026);
    assert.equal(season6?.title, 'Невероятное приключение ДжоДжо: Гонка «Стальной шар»', 'series kinds win over specials');
    assert.equal(season6.seasonNumber, 6);
    assert.equal(parser.findSeasonResult(searchHtml, base, 5, 2021)?.title, 'Невероятное приключение ДжоДжо: Каменный океан');
    assert.equal(parser.findSeasonResult(searchHtml, base, 4, 2018)?.title, 'Невероятное приключение ДжоДжо: Золотой ветер');
    assert.equal(parser.findSeasonResult(searchHtml, base, 6, null), null, 'without a year there is no guess');
    assert.equal(parser.findSeasonResult(searchHtml, base, 7, 2030), null);

    // resolveSeasonEpisodes passes the season year to the season search.
    const searches = [];
    parser.cachedSearch = async (query, year, options) => {
        searches.push({ query, year, options });
        return options.seasonYear === 2026 ? { ...season6, url: 'https://animego.me/anime/jojo-sbr-2600' } : null;
    };
    parser.cachedVideoSources = async () => [1, 2, 3].map(number => ({
        type: 'animego-episode', episodeNumber: number, episodeId: String(number), seasonScope: 6
    }));
    const baseSources = [1, 2].map(number => ({
        type: 'animego-episode', episodeNumber: number, episodeId: `b${number}`,
        query: 'Невероятные приключения ДжоДжо', queryYear: 2012, seasonScope: null
    }));
    const resolved = await parser.resolveSeasonEpisodes(baseSources, 6, {
        canonicalSeasons: [
            { seasonNumber: 1, episodeCount: 26, airYear: 2012 },
            { seasonNumber: 6, episodeCount: 12, airYear: 2026 }
        ]
    });
    assert.equal(searches[0].options.seasonNumber, 6);
    assert.equal(searches[0].options.seasonYear, 2026);
    assert.equal(resolved?.mode, 'scoped');
    assert.equal(resolved.episodes.length, 3);

    // The search cache key separates season years.
    assert.match(read('src/shared/services/parsers/BaseParserService.js'), /_\$\{seasonNumber\}_\$\{seasonYear\}_/);
    // Movie Details supplies season years.
    assert.match(read('src/pages/movie-details/movie-details.js'), /airYear: Number\(String\(season\?\.airDate/);

    // --- Movie Details IMDb ----------------------------------------------------
    const details = read('src/pages/movie-details/movie-details.js');
    assert.match(details, /const needsVoteRepair = resultKpRating <= 0\s*\|\| \(\(resultImdbRating <= 0 \|\| !hasImdbId\) && !imdbRecentlyChecked\)/,
        'a missing IMDb rating loads the hidden Kinopoisk page, which shows it');
    assert.match(read('src/shared/services/TMDBService.js'), /append_to_response: 'credits,videos,content_ratings,images,external_ids'/,
        'TV details carry the IMDb ID');

    console.log('AnimeGo season matching tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
