const assert = require('node:assert/strict');
const KinopoiskGraphqlService = require('../src/shared/services/KinopoiskGraphqlService.js');

const checksum = text => {
    let sum = 0;
    for (let i = 0; i < text.length; i++) sum = (sum + text.charCodeAt(i) * (i + 1)) % 1000000007;
    return sum;
};

function fetchReturning(data, calls) {
    return async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return { ok: true, status: 200, json: async () => ({ data }) };
    };
}

(async () => {
    // kinopoisk.ru only accepts its own query texts: these must stay byte-exact
    // with the site's bundle (verified against graphql.kinopoisk.ru on 2026-10-18).
    assert.equal(KinopoiskGraphqlService.TOUCH_MOVIE_RATING_QUERY.length, 2046);
    assert.equal(checksum(KinopoiskGraphqlService.TOUCH_MOVIE_RATING_QUERY), 196392538);
    assert.equal(KinopoiskGraphqlService.SUGGEST_SEARCH_QUERY.length, 2498);
    assert.equal(checksum(KinopoiskGraphqlService.SUGGEST_SEARCH_QUERY), 294550437);

    // Ratings by Kinopoisk ID, with vote counts.
    {
        const calls = [];
        const service = new KinopoiskGraphqlService({ fetchImpl: fetchReturning({ movie: { id: 326, rating: {
            imdb: { value: 9.3, isActive: true, count: 3200000 },
            kinopoisk: { value: 9.111, isActive: true, count: 1149476 }
        } } }, calls) });
        assert.deepEqual(await service.getMovieRatings('326'), {
            kpRating: 9.1, kpVotes: 1149476, imdbRating: 9.3, imdbVotes: 3200000, imdbAnswered: true
        });
        assert.equal(calls[0].url, 'https://graphql.kinopoisk.ru/graphql/?operationName=TouchMovieRating');
        assert.equal(calls[0].init.credentials, 'include');
        assert.equal(calls[0].init.headers['service-id'], '25');
        assert.deepEqual(calls[0].body.variables, { movieId: 326, withUserData: false });
        assert.equal(calls[0].body.query, KinopoiskGraphqlService.TOUCH_MOVIE_RATING_QUERY);
    }

    // A new title without an IMDb block reports imdbAnswered: false.
    {
        const service = new KinopoiskGraphqlService({ fetchImpl: fetchReturning({ movie: { id: 6601550, rating: {
            imdb: null, kinopoisk: { value: 5.93, count: 764 }
        } } }, []) });
        const ratings = await service.getMovieRatings(6601550);
        assert.equal(ratings.kpRating, 5.9);
        assert.equal(ratings.kpVotes, 764);
        assert.equal(ratings.imdbAnswered, false);
    }

    // Title search maps suggestions to the hidden-page item shape.
    {
        const calls = [];
        const service = new KinopoiskGraphqlService({ fetchImpl: fetchReturning({ suggest: { top: {
            topResult: { global: { __typename: 'Film', id: 13421214, title: { russian: 'Тенцинг', original: 'Tenzing' }, rating: { kinopoisk: { value: null } }, productionYear: 2026 } },
            movies: [
                { movie: { __typename: 'Film', id: 13421214, title: { russian: 'Тенцинг', original: 'Tenzing' }, productionYear: 2026 } },
                { movie: { __typename: 'TvSeries', id: 77, title: { russian: 'Сериал', original: '' }, rating: { kinopoisk: { value: 7.84 } }, releaseYears: [{ start: 2019, end: 2021 }] } }
            ]
        } } }, calls) });
        assert.deepEqual(await service.searchMovies(' Тенцинг '), [
            { id: 13421214, type: 'film', title: 'Тенцинг', originalTitle: 'Tenzing', year: 2026, kpRating: 0 },
            { id: 77, type: 'series', title: 'Сериал', originalTitle: '', year: 2019, kpRating: 7.8 }
        ]);
        assert.equal(calls[0].body.variables.keyword, 'Тенцинг');
        assert.equal(calls[0].body.query, KinopoiskGraphqlService.SUGGEST_SEARCH_QUERY);
        assert.deepEqual(await service.searchMovies('   '), []);
    }

    // GraphQL errors (e.g. "the query is not allowed") surface as exceptions.
    {
        const service = new KinopoiskGraphqlService({ fetchImpl: async () => ({ ok: true, json: async () => ({ errors: [{ message: 'the query is not allowed' }] }) }) });
        await assert.rejects(service.getMovieRatings(1), /not allowed/);
    }

    // KinopoiskService prefers GraphQL and falls back to the hidden page when IMDb is missing.
    {
        global.KinopoiskGraphqlService = KinopoiskGraphqlService;
        const proto = require('../src/shared/services/KinopoiskService.js').prototype
            || globalThis.KinopoiskService?.prototype;
        if (proto?.scrapeMoviePageRatingsOffscreen) {
            const host = Object.create(proto);
            let pageLoads = 0;
            global.chrome = { runtime: { sendMessage: async () => { pageLoads++; return { success: true, ratings: { kpRating: 5.9, imdbRating: 5.7 } }; } } };
            host.graphqlService = { getMovieRatings: async id => (id === 326
                ? { kpRating: 9.1, kpVotes: 1, imdbRating: 9.3, imdbVotes: 2, imdbAnswered: true }
                : { kpRating: 5.9, kpVotes: 764, imdbRating: 0, imdbVotes: 0, imdbAnswered: false }) };
            const fast = await host.scrapeMoviePageRatingsOffscreen(326);
            assert.equal(fast.source, 'graphql');
            assert.equal(pageLoads, 0, 'no hidden page when GraphQL has both ratings');
            const fallback = await host.scrapeMoviePageRatingsOffscreen(6601550);
            assert.equal(fallback.imdbRating, 5.7);
            assert.equal(pageLoads, 1, 'the hidden page still supplies IMDb for new titles');
            delete global.chrome;
        }
    }

    console.log('Kinopoisk GraphQL service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
