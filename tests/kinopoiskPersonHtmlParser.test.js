import assert from 'node:assert/strict';
import KinopoiskPersonHtmlService from '../src/shared/services/KinopoiskPersonHtmlService.js';
import PersonDetailsService from '../src/shared/services/PersonDetailsService.js';

console.log('🧪 Running Kinopoisk person HTML parser tests...');

const apolloState = {
    'Person:9144': {
        __typename: 'Person',
        id: 9144,
        name: 'Том Хэнкс',
        originalName: 'Tom Hanks',
        poster: { avatarsUrl: '//avatars.example/person-9144' },
        'roles({"isCareer":true})': {
            items: [
                { role: { slug: 'ACTOR', title: { russian: 'Актер' } } },
                { role: { slug: 'PRODUCER', title: { russian: 'Продюсер' } } }
            ]
        },
        'filmographyRelations:{"roleSlugs":["ACTOR"]}': {
            items: [
                {
                    movie: { __ref: 'Film:448' },
                    'participations({"limit":30})': {
                        items: [{
                            role: { slug: 'ACTOR', title: { russian: 'Актер' } },
                            name: 'Форрест Гамп',
                            notice: null
                        }]
                    }
                },
                {
                    movie: { __ref: 'TvSeries:426030' },
                    'participations({"limit":30})': {
                        items: [{
                            role: { slug: 'ACTOR', title: { russian: 'Актер' } },
                            name: 'Narrator'
                        }]
                    }
                }
            ]
        }
    },
    'Film:448': {
        __typename: 'Film',
        id: 448,
        title: { russian: 'Форрест Гамп', original: 'Forrest Gump' },
        productionYear: 1994,
        gallery: { posters: { vertical: { avatarsUrl: '//avatars.example/448' } } },
        rating: { kinopoisk: { value: 8.9 } }
    },
    'TvSeries:426030': {
        __typename: 'TvSeries',
        id: 426030,
        title: { russian: 'Тихий океан', original: 'The Pacific' },
        releaseYears: [{ start: 2010 }]
    }
};

const pageHtml = `<script>window.Ya.__ssr_initial_data = ${JSON.stringify({ apolloState })};</script>`;
const searchHtml = '<a href="/name/9144/">Том Хэнкс</a>';
const movieSearchHtml = '<a href="/film/3556/">С Земли на Луну</a><span>1998</span>';
const ssrSearchHtml = `<script>window.Ya.__ssr_initial_data = ${JSON.stringify({
    apolloState: {
        'Person:9144': { id: 9144, name: 'Том Хэнкс', originalName: 'Tom Hanks' }
    }
})};</script>`;

{
    const service = new KinopoiskPersonHtmlService({ fetchImpl: async (url) => ({
        ok: true,
        text: async () => url.includes('/new-search/') ? searchHtml : pageHtml
    }) });

    assert.strictEqual(service.parsePersonSearchHtml(searchHtml, ['Том Хэнкс']), 9144);
    assert.strictEqual(service.parsePersonSearchHtml(ssrSearchHtml, ['Tom Hanks']), 9144);
    assert.deepStrictEqual(service.parseMovieSearchHtml(movieSearchHtml, ['С Земли на Луну'], 1998), {
        kinopoiskId: 3556,
        name: 'С Земли на Луну',
        year: 1998
    });

    const parsed = service.parsePersonPageHtml(pageHtml, 9144);
    assert.strictEqual(parsed.personId, 9144);
    assert.strictEqual(parsed.name, 'Том Хэнкс');
    assert.strictEqual(parsed.items.length, 2);
    assert.strictEqual(parsed.items[0].kinopoiskId, 448);
    assert.strictEqual(parsed.items[0].category, 'acting');
    assert.strictEqual(parsed.items[1].providerMediaType, 'tv');
    assert.strictEqual(parsed.items[1].year, 2010);

    console.log('  ✅ SSR Apollo state, person identity, movie search links, roles, IDs, years, posters, and TV type parsed');
}

{
    const posterUrl = 'https://avatars.example/movie-448.jpg';
    const posterHtml = `
        <img class="film-poster styles_root__95qkI" src="${posterUrl}">
        <meta content="https://avatars.example/promo.jpg" property="og:image">
        <meta name="twitter:image" content="https://avatars.example/twitter-448.jpg">
    `;
    const service = new KinopoiskPersonHtmlService({
        fetchImpl: async (url) => ({
            ok: true,
            text: async () => {
                const id = url.match(/\/(\d+)\/$/)?.[1] || 'unknown';
                return `<img class="film-poster" src="https://avatars.example/${id}.jpg">`;
            }
        })
    });

    assert.strictEqual(service.parseMoviePosterHtml(posterHtml, 448), posterUrl);

    assert.strictEqual(
        service.parseMoviePosterHtml('<meta property="og:image" content="https://avatars.example/promo.jpg">', 448),
        null,
        'Promo social metadata must not be treated as a movie poster'
    );

    const posters = await service.getMoviePostersByIds([448, 449, 448]);
    assert.strictEqual(posters.get(448), 'https://avatars.example/448.jpg');
    assert.strictEqual(posters.get(449), 'https://avatars.example/449.jpg');
    assert.strictEqual(posters.size, 2);

    console.log('  ✅ Movie-page og:image parsing, exact-ID batch lookup, and duplicate suppression verified');
}

{
    let fetchCount = 0;
    const service = new KinopoiskPersonHtmlService({ fetchImpl: async (url) => {
        fetchCount++;
        return { ok: true, text: async () => url.includes('/new-search/') ? searchHtml : pageHtml };
    } });

    const result = await service.getPersonFilmography(['Том Хэнкс']);
    assert.strictEqual(result.personId, 9144);
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(fetchCount, 2, 'HTML lookup should use one search and one person request');

    console.log('  ✅ Person lookup performs exactly one search and one person HTML request');
}

{
    let offscreenQuery = null;
    const service = new KinopoiskPersonHtmlService({
        kinopoiskService: {
            async scrapeSearchResultsOffscreen(query) {
                offscreenQuery = query;
                return [{ type: 'film', id: 448 }];
            }
        },
        fetchImpl: async () => {
            throw new Error('Direct fetch must not be used when browser scraping is available');
        }
    });

    const result = await service.findMovieByTitle(['Forrest Gump'], 1994);
    assert.deepStrictEqual(result, {
        kinopoiskId: 448,
        name: 'Forrest Gump',
        year: 1994
    });
    assert.strictEqual(offscreenQuery, 'Forrest Gump');

    const sequelAwareService = new KinopoiskPersonHtmlService({
        kinopoiskService: {
            async scrapeSearchResultsOffscreen() {
                return [
                    { type: 'film', id: 5424947, title: 'История игрушек 5', originalTitle: 'Toy Story 5', year: 2026 },
                    { type: 'film', id: 1, title: 'История игрушек', originalTitle: 'Toy Story', year: 1995 }
                ];
            }
        }
    });
    const sequelAwareResult = await sequelAwareService.findMovieByTitle(['История игрушек', 'Toy Story'], 1995);
    assert.strictEqual(sequelAwareResult.kinopoiskId, 1, 'Matching must prefer the requested year over a newer sequel');

    const releaseYearToleranceService = new KinopoiskPersonHtmlService({
        kinopoiskService: {
            async scrapeSearchResultsOffscreen() {
                return [
                    { type: 'film', id: 700, title: 'Мятеж', originalTitle: 'Mutiny', year: 2025 },
                    { type: 'film', id: 701, title: 'Мятеж', originalTitle: 'Revolt', year: 2020 }
                ];
            }
        }
    });
    const releaseYearToleranceResult = await releaseYearToleranceService.findMovieByTitle(
        ['Мятеж', 'Mutiny'],
        2026,
        { allowYearTolerance: true }
    );
    assert.equal(releaseYearToleranceResult.kinopoiskId, 700);

    const strictYearResult = await releaseYearToleranceService.findMovieByTitle(
        ['Мятеж', 'Mutiny'],
        2026
    );
    assert.equal(strictYearResult, null, 'Strict matching must reject a different release year');

    console.log('  ✅ Movie lookup uses browser-context scraping and selects the requested title/year over sequels');
}

{
    let mappingFallbackCalled = false;
    const personService = new PersonDetailsService({
        tmdbService: {
            async getPersonDetails() {
                return {
                    id: 31,
                    name: 'Том Хэнкс',
                    original_name: 'Tom Hanks',
                    combined_credits: {
                        cast: [{
                            id: 448,
                            media_type: 'movie',
                            title: 'Форрест Гамп',
                            original_title: 'Forrest Gump',
                            release_date: '1994-07-06',
                            vote_average: 8.9,
                            vote_count: 1000
                        }],
                        crew: []
                    }
                };
            }
        },
        kinopoiskPersonHtmlService: {
            async getPersonFilmography() {
                return {
                    items: [{
                        kinopoiskId: 448,
                        name: 'Форрест Гамп',
                        originalName: 'Forrest Gump',
                        year: 1994
                    }]
                };
            }
        },
        idMappingService: {
            async resolveBatch() {
                mappingFallbackCalled = true;
                return new Map();
            }
        }
    });

    const dto = await personService.getPersonDetails('tmdb:31', { forceRefresh: true });
    assert.strictEqual(dto.filmography.acting[0].kinopoiskId, 448);
    assert.strictEqual(dto._meta.mappedCount, 1);
    assert.strictEqual(mappingFallbackCalled, false, 'HTML mapping must bypass API mapping fallback');

    console.log('  ✅ PersonDetailsService uses local HTML mapping and skips the 40-item API fallback');
}

console.log('🎉 Kinopoisk person HTML parser tests passed!');
