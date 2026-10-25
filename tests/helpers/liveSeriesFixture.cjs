// Deterministic catalogue responses for offline editor tests. Never used in production.
function installLiveSeriesFixture() {
    const series = { id: 101, kinopoiskId: 101, name: 'Тестовый сериал', type: 'tv-series', isSeries: true,
        year: 2025, duration: 99, externalId: { tmdb: 555 }, posterUrl: '/src/shared/assets/live/standby-pattern.png' };
    const episode = (seasonNumber, episodeNumber, runtime, name = `Название ${episodeNumber}`) => ({
        seasonNumber, episodeNumber, runtime, name, airDate: '2020-01-01'
    });
    const fixture = window.liveSeriesFixture = {
        series, requests: [], fail: false, delay: null,
        seasons: [{ number: 0, name: 'Спецвыпуски' }, { number: 1, name: 'Сезон 1' }, { number: 2, name: 'Сезон 2' }],
        episodes: { 0: [episode(0, 1, 20)], 1: [episode(1, 1, 42), episode(1, 2, 44), episode(1, 3, null),
            { ...episode(1, 4, 40), airDate: '2099-01-01' }], 2: [episode(2, 1, 50)] }
    };
    const tmdb = {
        async getTvDetails(id) {
            fixture.requests.push(['tv', id]);
            if (fixture.delay) await fixture.delay;
            if (fixture.fail) throw new Error('Тест: каталог недоступен');
            return { id, tmdbId: id, seasons: fixture.seasons };
        },
        async getSeasonDetails(id, season) {
            fixture.requests.push(['season', id, season]);
            if (fixture.fail) throw new Error('Тест: каталог недоступен');
            return { seasonNumber: season, episodes: fixture.episodes[season] || [] };
        }
    };
    window.firebaseManager.getTMDBService = () => tmdb;
    window.TMDBService = class { constructor() { return tmdb; } };
    window.IdMappingService = class { async resolveTmdbIdByKinopoiskId() { return { tmdbId: 555 }; } };
    window.KinopoiskService.prototype.searchMovies = async () => ({ docs: [series] });
    window.KinopoiskService.prototype.getMovieById = async id => id === 101 ? series : { id, kinopoiskId: id, name: 'Тестовый фильм', duration: 100 };
}
module.exports = { installLiveSeriesFixture };
