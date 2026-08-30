import assert from 'node:assert/strict';
import {
    fetchCalendarEpisodes,
    isTmdbConfigured,
    getTrackedItems,
    getTmdbId,
    getMovieRelease,
    getUpcomingEpisodes
} from '../src/shared/services/CalendarService.js';

console.log('🧪 Running CalendarService Test Suite...');

// Mock TMDBService with Proxy Access (hasProxyAccess = true, hasDirectCredentials = false)
class MockTMDBServiceProxy {
    constructor() {
        this.baseUrl = 'https://api.themoviedb.org/3';
        this.defaultLanguage = 'ru-RU';
    }
    hasDirectCredentials() {
        return false;
    }
    hasProxyAccess() {
        return true;
    }
    isConfigured() {
        return true;
    }
    async _fetchWithRotation(url) {
        if (url.includes('/find/tt1234567')) {
            return {
                ok: true,
                json: async () => ({
                    tv_results: [{ id: 101, name: 'Mock Series' }],
                    movie_results: []
                })
            };
        }
        if (url.includes('/tv/101/season/1')) {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 10);
            const airDate = futureDate.toISOString().split('T')[0];

            return {
                ok: true,
                json: async () => ({
                    episodes: [
                        { season_number: 1, episode_number: 1, name: 'Episode 1', air_date: airDate }
                    ]
                })
            };
        }
        if (url.includes('/tv/101')) {
            return {
                ok: true,
                json: async () => ({
                    id: 101,
                    name: 'Mock Series',
                    number_of_seasons: 1,
                    next_episode_to_air: { season_number: 1, episode_number: 1 }
                })
            };
        }
        if (url.includes('/movie/202')) {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 20);
            const airDate = futureDate.toISOString().split('T')[0];
            return {
                ok: true,
                json: async () => ({
                    id: 202,
                    title: 'Mock Movie',
                    release_date: airDate
                })
            };
        }
        if (url.toLowerCase().includes('/search/movie?query=mock%20movie')) {
            return {
                ok: true,
                json: async () => ({
                    results: [{ id: 202, title: 'Mock Movie', release_date: '2026-09-01' }]
                })
            };
        }
        return {
            ok: false,
            status: 404,
            text: async () => 'Not found'
        };
    }
}

// 1. isTmdbConfigured with Mock TMDBService Proxy
assert.equal(isTmdbConfigured(new MockTMDBServiceProxy()), true, 'isTmdbConfigured must return true when proxy is enabled');

// 2. Unconfigured Service Test
class UnconfiguredTMDBService {
    isConfigured() { return false; }
    hasDirectCredentials() { return false; }
    hasProxyAccess() { return false; }
}
assert.equal(isTmdbConfigured(new UnconfiguredTMDBService()), false, 'isTmdbConfigured must return false when unconfigured');

// 3. fetchCalendarEpisodes throws when unconfigured
await assert.rejects(
    async () => {
        await fetchCalendarEpisodes({ tmdbService: new UnconfiguredTMDBService(), items: [{ id: 1 }] });
    },
    /TMDB API key is not configured/,
    'fetchCalendarEpisodes must reject when TMDB is unconfigured'
);

// 4. Empty items handling
const emptyResult = await fetchCalendarEpisodes({
    tmdbService: new MockTMDBServiceProxy(),
    items: []
});
assert.deepEqual(emptyResult, { grouped: {}, total: 0 }, 'Empty items must yield empty grouped object and 0 total');

// 5. Resolving series via IMDb and fetching upcoming episodes
const mockSeriesItem = {
    movieId: 1001,
    movieTitleRu: 'Тестовый Сериал',
    imdbId: 'tt1234567',
    isSeries: true
};

const result = await fetchCalendarEpisodes({
    tmdbService: new MockTMDBServiceProxy(),
    items: [mockSeriesItem]
});

assert.equal(result.total, 1, 'Should resolve 1 upcoming episode');
const monthKeys = Object.keys(result.grouped);
assert.equal(monthKeys.length, 1, 'Should have 1 grouped month');
const dayKeys = Object.keys(result.grouped[monthKeys[0]]);
assert.equal(dayKeys.length, 1, 'Should have 1 grouped day');
const event = result.grouped[monthKeys[0]][dayKeys[0]][0];
assert.equal(event.showName, 'Тестовый Сериал');
assert.equal(event.kinoId, 1001);
assert.equal(event.tmdbId, 101);
assert.equal(event.season, 1);
assert.equal(event.episode, 1);

// 6. Resolving movie via Title and fetching release
const mockMovieItem = {
    movieId: 2002,
    movieTitle: 'Mock Movie',
    isSeries: false
};

const movieResult = await fetchCalendarEpisodes({
    tmdbService: new MockTMDBServiceProxy(),
    items: [mockMovieItem]
});

assert.equal(movieResult.total, 1, 'Should resolve 1 movie release');
const movieMonthKeys = Object.keys(movieResult.grouped);
const movieDayKeys = Object.keys(movieResult.grouped[movieMonthKeys[0]]);
const movieEvent = movieResult.grouped[movieMonthKeys[0]][movieDayKeys[0]][0];
assert.equal(movieEvent.showName, 'Mock Movie');
assert.equal(movieEvent.kinoId, 2002);
assert.equal(movieEvent.tmdbId, 202);
assert.equal(movieEvent.isMovie, true);

console.log('✅ ALL CalendarService Tests Passed Successfully!');
