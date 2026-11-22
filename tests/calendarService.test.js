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

// 7. Load cost: long-released movies make no requests; finished shows fetch no seasons.
{
    const urls = [];
    class CountingTmdb extends MockTMDBServiceProxy {
        async _fetchWithRotation(url) {
            urls.push(url);
            if (url.includes('/tv/303')) {
                return { ok: true, json: async () => ({ id: 303, status: 'Ended', number_of_seasons: 5, last_episode_to_air: { season_number: 5 } }) };
            }
            return super._fetchWithRotation(url);
        }
    }
    const thisYear = new Date().getFullYear();
    const counted = await fetchCalendarEpisodes({
        tmdbService: new CountingTmdb(),
        useCache: false,
        items: [
            { movieId: 4004, movieTitle: 'Old Classic', year: thisYear - 30, isSeries: false },
            { movieId: 3003, movieTitle: 'Finished Show', tmdbId: 303, isSeries: true }
        ]
    });
    assert.equal(counted.total, 0);
    assert.ok(!urls.some(url => /Old%20Classic|search\/movie/.test(url)), 'a movie released decades ago is not looked up');
    assert.ok(!urls.some(url => url.includes('/season/')), 'an ended show needs no season requests');
    assert.equal(urls.length, 1, 'one details request for the ended show and nothing else');
}

// 8. Cache: a second open reuses TMDB IDs and events instead of refetching; snapshot paints instantly.
{
    const store = { user: { uid: 'u1' } };
    globalThis.chrome = { storage: { local: {
        get: async keys => Object.fromEntries(keys.filter(key => key in store).map(key => [key, structuredClone(store[key])])),
        set: async values => { Object.assign(store, structuredClone(values)); }
    } } };
    let requests = 0;
    class CountingTmdb extends MockTMDBServiceProxy {
        async _fetchWithRotation(url) { requests++; return super._fetchWithRotation(url); }
    }
    const items = [{ ...mockSeriesItem }];
    const first = await fetchCalendarEpisodes({ tmdbService: new CountingTmdb(), items });
    const afterFirst = requests;
    assert.ok(afterFirst > 0);
    const second = await fetchCalendarEpisodes({ tmdbService: new CountingTmdb(), items });
    assert.equal(requests, afterFirst, 'second open is served from the cache');
    assert.deepEqual(second, first);
    const { readCalendarSnapshot } = await import('../src/shared/services/CalendarService.js');
    const snapshot = await readCalendarSnapshot();
    assert.equal(snapshot.total, 1, 'snapshot of the last result is available for the first paint');
    delete globalThis.chrome;
}

// 9. Countdown wording, month and weekday names follow the page language.
{
    const { i18n } = await import('../src/shared/i18n/I18n.js');
    const { formatCountdown, formatMonthTitle, parseLocalDate, renderMonth, renderSignedOutState, renderEmptyState } =
        await import('../src/pages/calendar/CalendarView.js');
    const previous = i18n.currentLocale;
    const premiere = { '2027-01-03': [{ isMovie: true, showName: 'X' }] };

    i18n.currentLocale = 'ru';
    assert.equal(formatCountdown(0).text, 'Сегодня');
    assert.equal(formatCountdown(1).text, 'Завтра');
    assert.equal(formatCountdown(3).text, 'через 3 дня');
    assert.equal(formatCountdown(11).text, 'через 11 дней');
    assert.equal(formatCountdown(21).text, 'через 21 день');
    assert.equal(formatCountdown(22).text, 'через 22 дня');
    assert.equal(formatCountdown(25).text, 'через 25 дней');
    assert.equal(formatMonthTitle('2027-01'), 'Январь 2027');
    const ruMonth = renderMonth('2027-01', premiere, true, new Date(2027, 0, 1));
    assert.match(ruMonth, /Премьера фильма/);
    assert.match(ruMonth, /через 2 дня/);
    assert.match(ruMonth, />вс</);
    assert.match(renderSignedOutState(), /Войдите в аккаунт/);

    i18n.currentLocale = 'en';
    assert.equal(formatCountdown(0).text, 'Today');
    assert.equal(formatCountdown(1).text, 'Tomorrow');
    assert.equal(formatCountdown(2).text, 'in 2 days');
    assert.equal(formatCountdown(21).text, 'in 21 days');
    assert.equal(formatMonthTitle('2027-01'), 'January 2027');
    const enMonth = renderMonth('2027-01', premiere, true, new Date(2027, 0, 1));
    assert.match(enMonth, /Movie premiere/);
    assert.match(enMonth, /in 2 days/);
    assert.match(enMonth, />Sun</, 'weekday names come from the page language');
    assert.match(renderSignedOutState(), /Sign in/);
    assert.doesNotMatch(renderEmptyState() + renderSignedOutState() + enMonth, /[А-Яа-яЁё]/, 'no Russian text in the English calendar');

    i18n.currentLocale = previous;
    assert.equal(parseLocalDate('2026-03-01').getDate(), 1, 'YYYY-MM-DD is a local date, not UTC midnight');
}

// 10. Months are grouped by "YYYY-MM", not by a Russian month name.
{
    const keys = Object.keys(result.grouped);
    assert.ok(keys.every(key => /^\d{4}-\d{2}$/.test(key)), `month keys are YYYY-MM: ${keys.join(', ')}`);
}

// 11. A signed-out guest never sees the previous account's lists. Firebase has already
//     answered "no user" while the stored `user` copy still names the old account.
{
    const store = {
        user: { uid: 'old-account' },
        'bookmarks_cache_old-account': { bookmarks: [{ movieId: 7, movieTitle: 'Old Show', status: 'watching', isSeries: true }] },
        calendar_snapshot_v1: { userId: 'old-account', at: Date.now(), events: [{ airDate: '2999-01-01', showName: 'Old Show' }] }
    };
    let backgroundAsked = false;
    globalThis.chrome = {
        storage: { local: {
            get: async keys => Object.fromEntries([].concat(keys).filter(key => key in store).map(key => [key, structuredClone(store[key])])),
            set: async values => { Object.assign(store, structuredClone(values)); }
        } },
        runtime: { sendMessage: (message, reply) => { backgroundAsked = true; reply({ success: true, items: [{ movieId: 7 }] }); } }
    };
    globalThis.window = { firebaseManager: { isAuthReady: true, waitForAuthReady: async () => null, getCurrentUser: () => null } };
    const { resolveCalendarUserId, readCalendarSnapshot } = await import('../src/shared/services/CalendarService.js');

    assert.equal(await resolveCalendarUserId(), null, 'a resolved guest is a guest, whatever the stored copy says');
    assert.deepEqual(await getTrackedItems(), [], 'no lists of the previous account for a guest');
    assert.equal(backgroundAsked, false, 'the background fallback (which reads the stored copy) is not asked for a guest');
    const guestResult = await fetchCalendarEpisodes({ tmdbService: new MockTMDBServiceProxy() });
    assert.equal(guestResult.total, 0);
    assert.equal(store.calendar_snapshot_v1.userId, 'old-account', 'a guest load writes no snapshot');
    assert.equal(await readCalendarSnapshot({ userId: null }), null, 'no snapshot paint for a guest');

    // While Firebase has not answered yet, the stored copy is the best guess for the signed-in account.
    globalThis.window = { firebaseManager: { isAuthReady: false, waitForAuthReady: async () => null, getCurrentUser: () => null } };
    assert.equal(await resolveCalendarUserId(), 'old-account');
    assert.equal((await getTrackedItems()).length, 1);

    // A signed-in account reads its own cache.
    globalThis.window = { firebaseManager: { isAuthReady: true, waitForAuthReady: async () => null, getCurrentUser: () => ({ uid: 'old-account' }) } };
    assert.equal((await getTrackedItems()).length, 1);

    delete globalThis.window;
    delete globalThis.chrome;
}

// 12. The page is translated and follows auth: static strings carry data-i18n, the page
//     waits for auth before a guest or personal state and listens for sign-in elsewhere.
{
    const { readFileSync } = await import('node:fs');
    const { locales } = await import('../src/shared/i18n/locales.js');
    const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
    const html = read('../src/pages/calendar/calendar.html');
    const page = read('../src/pages/calendar/calendar.js');
    const view = read('../src/pages/calendar/CalendarView.js');
    for (const key of ['title', 'subtitle', 'loading_label', 'news_title', 'page_title']) {
        assert.ok(html.includes(`calendar.${key}`), `calendar.html translates calendar.${key}`);
    }
    const usedKeys = new Set([...(html + page + view).matchAll(/calendar\.([a-z_]+)/g)]
        .map(match => match[1])
        .filter(key => !['html', 'js', 'css', 'in_days_'].includes(key)));
    for (const key of usedKeys) {
        assert.ok(locales.en.calendar[key], `en calendar.${key} exists`);
        assert.ok(locales.ru.calendar[key], `ru calendar.${key} exists`);
    }
    for (const key of Object.keys(locales.en.calendar)) assert.ok(locales.ru.calendar[key], `ru calendar.${key} exists`);
    assert.doesNotMatch(page + view, /[А-Яа-яЁё]/, 'calendar scripts hold no hardcoded Russian text');
    assert.match(page, /waitForAuthReady/);
    assert.match(page, /isAuthReady/, 'an unresolved auth state is not treated as a guest');
    assert.match(page, /authStateChanged/);
    assert.match(page, /SETTINGS_UPDATED/);
}

console.log('✅ ALL CalendarService Tests Passed Successfully!');
