const assert = require('node:assert/strict');

global.TMDB_CONFIG = {
    BASE_URL: 'https://tmdb.test/3',
    DEFAULT_LANGUAGE: 'ru-RU',
    API_KEYS: ['test-key'],
    API_KEY: 'test-key',
    rotateKey() {}
};

const TMDBService = require('../src/shared/services/TMDBService.js');

function responseFor(kind, page) {
    const isTv = kind === 'tv';
    return {
        ok: true,
        async json() {
            return {
                page,
                total_pages: 4,
                total_results: 80,
                results: Array.from({ length: 20 }, (_, index) => ({
                    id: page * 1000 + (isTv ? 500 : 0) + index,
                    name: isTv ? `Anime series ${page}-${index}` : undefined,
                    original_name: isTv ? `Anime series original ${page}-${index}` : undefined,
                    first_air_date: isTv ? '2024-01-01' : undefined,
                    title: isTv ? undefined : `Anime film ${page}-${index}`,
                    original_title: isTv ? undefined : `Anime film original ${page}-${index}`,
                    release_date: isTv ? undefined : '2024-01-01',
                    poster_path: null,
                    backdrop_path: null,
                    overview: '',
                    vote_average: isTv ? 8 : ((page * 20 + index) % 10) + 1,
                    vote_count: 100,
                    popularity: 1000 - (page * 20 + index),
                    original_language: 'ja',
                    adult: false
                }))
            };
        }
    };
}

async function run() {
    const service = new TMDBService();
    const requests = [];
    service._fetchWithRotation = async url => {
        const parsed = new URL(url);
        const kind = parsed.pathname.endsWith('/tv') ? 'tv' : 'movie';
        const page = Number(parsed.searchParams.get('page'));
        requests.push({ kind, page, params: parsed.searchParams });
        return responseFor(kind, page);
    };

    const result = await service.getCatalogPage({
        category: 'anime',
        page: 1,
        pageSize: 24
    });

    assert.equal(result.items.length, 24);
    assert.equal(result.items.every(item => item.category === 'anime'), true);
    assert.equal(result.items.every(item => item.isTmdbOnly === true), true);
    assert.equal(requests.length, 4, 'mixed page must fetch enough provider pages for stable pagination');
    assert.equal(requests.every(request => request.params.get('with_original_language') === 'ja'), true);

    const pageTwo = await service.getCatalogPage({
        category: 'anime',
        page: 2,
        pageSize: 24
    });

    assert.equal(pageTwo.items.length, 24);
    assert.equal(requests.length, 6, 'provider page cache should reuse first pages');
    assert.equal(new Set(pageTwo.items.map(item => item.tmdbId)).size, 24);

    const filmPageOne = await service.getCatalogPage({
        category: 'films',
        page: 1,
        pageSize: 24
    });
    const filmPageTwo = await service.getCatalogPage({
        category: 'films',
        page: 2,
        pageSize: 24
    });
    assert.equal(filmPageOne.items.length, 24, 'films page must fill the requested page size');
    assert.equal(filmPageTwo.items.length, 24, 'films page 2 must fill the requested page size');
    assert.equal(
        requests.filter(request => request.kind === 'movie' && request.params.get('without_genres') === '16').length,
        3,
        'films must query only TMDB movies'
    );
    assert.equal(
        requests.filter(request => request.kind === 'tv' && request.params.get('without_genres') === '16').length,
        0,
        'films must not query TMDB series'
    );
    const popularFilmRequest = requests.find(request => (
        request.kind === 'movie' &&
        request.page === 1 &&
        request.params.get('sort_by') === 'popularity.desc'
    ));
    assert.equal(popularFilmRequest.params.get('vote_count.gte'), '1000');
    assert.equal(
        popularFilmRequest.params.get('without_keywords'),
        '198385,256466,155477,445,325693,159551'
    );
    assert.equal(
        filmPageTwo.items.some(item => filmPageOne.items.some(first => first.tmdbId === item.tmdbId)),
        false,
        'films page 2 must not repeat page 1'
    );

    const seriesPageOne = await service.getCatalogPage({
        category: 'series',
        page: 1,
        pageSize: 24
    });
    const seriesPageTwo = await service.getCatalogPage({
        category: 'series',
        page: 2,
        pageSize: 24
    });
    assert.equal(seriesPageOne.items.length, 24, 'series page must fill the requested page size');
    assert.equal(seriesPageTwo.items.length, 24, 'series page 2 must fill the requested page size');
    assert.equal(
        requests.filter(request => request.kind === 'tv' && request.params.get('without_genres') === '16').length,
        3,
        'series must query only TMDB series'
    );
    assert.equal(
        requests.filter(request => request.kind === 'movie' && request.params.get('without_genres') === '16').length,
        3,
        'series must not query TMDB movies'
    );
    assert.equal(
        seriesPageTwo.items.some(item => seriesPageOne.items.some(first => first.tmdbId === item.tmdbId)),
        false,
        'series page 2 must not repeat page 1'
    );

    const namespaceService = new TMDBService();
    namespaceService._fetchWithRotation = async url => {
        const parsed = new URL(url);
        const kind = parsed.pathname.endsWith('/tv') ? 'tv' : 'movie';
        return {
            ok: true,
            async json() {
                return {
                    page: 1,
                    total_pages: 1,
                    total_results: 1,
                    results: [{
                        id: 42,
                        title: kind === 'movie' ? 'Shared ID film' : undefined,
                        original_title: kind === 'movie' ? 'Shared ID film' : undefined,
                        name: kind === 'tv' ? 'Shared ID series' : undefined,
                        original_name: kind === 'tv' ? 'Shared ID series' : undefined,
                        release_date: kind === 'movie' ? '2024-01-01' : undefined,
                        first_air_date: kind === 'tv' ? '2024-01-01' : undefined,
                        poster_path: null,
                        backdrop_path: null,
                        overview: '',
                        vote_average: 8,
                        vote_count: 100,
                        popularity: 100,
                        original_language: 'ja',
                        adult: false
                    }]
                };
            }
        };
    };
    const namespaceResult = await namespaceService.getCatalogPage({
        category: 'anime',
        page: 1,
        pageSize: 12
    });
    assert.equal(namespaceResult.items.length, 2, 'movie and TV IDs share separate TMDB namespaces');
    assert.deepEqual(
        new Set(namespaceResult.items.map(item => `${item.mediaType}:${item.tmdbId}`)),
        new Set(['movie:42', 'tv:42'])
    );

    const ratingResult = await service.getCatalogPage({
        category: 'films',
        page: 1,
        pageSize: 12,
        sort: 'vote_average.desc'
    });
    assert.equal(ratingResult.items.length, 12);
    assert.equal(ratingResult.items[0].ratingTmdb, 10);
    assert.equal(ratingResult.items.every((item, index, items) => (
        index === 0 || item.ratingTmdb <= items[index - 1].ratingTmdb
    )), true, 'catalog must preserve the selected rating sort');

    console.log('✅ TMDB catalogue category filtering and stable mixed pagination passed');
}

run().catch(error => {
    console.error('❌ TMDB catalogue tests failed:', error);
    process.exitCode = 1;
});
