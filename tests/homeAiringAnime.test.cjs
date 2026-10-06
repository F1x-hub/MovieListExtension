/**
 * Home "Аниме" shows anime that is coming out now: new series from the last
 * ~4 months and older series with episodes airing this week, without
 * year-round long-runners. TMDB responses are stubbed.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TMDBService = require('../src/shared/services/TMDBService.js');

const dayMs = 24 * 60 * 60 * 1000;
const isoDate = offsetDays => new Date(Date.now() + offsetDays * dayMs).toISOString().split('T')[0];
const show = (id, overrides = {}) => ({
    id,
    name: `Show ${id}`,
    original_name: `ショー${id}`,
    poster_path: `/${id}.jpg`,
    first_air_date: isoDate(-2000),
    vote_count: 500,
    popularity: 50,
    genre_ids: [16],
    original_language: 'ja',
    ...overrides
});

async function run() {
    const airing = [
        show(1, { name: 'Detective Conan', popularity: 150 }),          // long-runner
        show(2, { name: 'JoJo', popularity: 140 }),                     // new season 6
        show(3, { name: 'Apothecary', popularity: 120 }),               // episodes appended to S1
        show(4, { name: 'No poster', poster_path: null, popularity: 110 }),
        show(5, { name: 'New series airing', first_air_date: isoDate(-20), popularity: 60 })
    ];
    const fresh = [
        show(5, { name: 'New series airing', first_air_date: isoDate(-20), popularity: 60 }),
        show(6, { name: 'Quiet new series', first_air_date: isoDate(-30), vote_count: 2, popularity: 5 }),
        show(7, { name: 'Popular new series', first_air_date: isoDate(-10), vote_count: 1, popularity: 35 })
    ];
    const details = {
        1: { number_of_episodes: 1216, seasons: [{ season_number: 1, air_date: isoDate(-9000), episode_count: 1216 }] },
        2: { number_of_episodes: 220, seasons: [
            { season_number: 5, air_date: isoDate(-1500), episode_count: 39 },
            { season_number: 6, air_date: isoDate(-200), episode_count: 24 }
        ] },
        3: { number_of_episodes: 60, seasons: [{ season_number: 1, air_date: isoDate(-1100), episode_count: 60 }] }
    };

    const requested = [];
    const tmdb = new TMDBService();
    tmdb._fetchWithRotation = async url => {
        const parsed = new URL(url);
        requested.push(parsed.pathname + parsed.search);
        const json = body => ({ ok: true, json: async () => body });
        if (parsed.pathname.endsWith('/discover/tv')) {
            const page = parsed.searchParams.get('page');
            if (parsed.searchParams.has('air_date.gte')) return json({ results: page === '1' ? airing : [] });
            return json({ results: page === '1' ? fresh : [] });
        }
        const id = Number(parsed.pathname.split('/').pop());
        return json(details[id] || { seasons: [] });
    };

    const items = await tmdb.getAiringAnime();
    const byName = Object.fromEntries(items.map(item => [item.name, item]));

    assert.ok(!byName['Detective Conan'], 'year-round long-runners are excluded');
    assert.ok(!byName['No poster']);
    assert.equal(byName.JoJo.airingStatus, 'airing');
    assert.equal(byName.JoJo.seasonNumber, 6, 'a new numbered season is labelled');
    assert.equal(byName.Apothecary.airingStatus, 'airing');
    assert.equal(byName.Apothecary.seasonNumber, null, 'episodes appended to an old season get no season label');
    assert.equal(byName['New series airing'].airingStatus, 'new', 'new series count as new even while airing');
    assert.ok(byName['Popular new series'], 'popular new series pass without votes');
    assert.ok(!byName['Quiet new series'], 'new series need votes or popularity');
    assert.deepEqual(
        items.map(item => item.name),
        ['JoJo', 'Apothecary', 'New series airing', 'Popular new series'],
        'airing sequels first, then new series by popularity'
    );
    assert.ok(items.every(item => item.mediaType === 'tv' && item.posterUrl.includes('/t/p/w342/')));

    const discoverCalls = requested.filter(entry => entry.includes('/discover/tv'));
    assert.equal(discoverCalls.length, 4);
    assert.ok(discoverCalls.every(entry => entry.includes('with_original_language=ja') && entry.includes('include_adult=false')));
    assert.equal(requested.length - discoverCalls.length, 3, 'details only for older airing series with posters');

    // Home renders the labels; translations exist in both languages.
    const renderer = fs.readFileSync(path.join(__dirname, '../src/pages/home/HomeRenderer.js'), 'utf8');
    assert.match(renderer, /this\.applyAiringBadges\(items, container\);/);
    assert.match(renderer, /this\.t\('badges\.new', 'Новинка'\)/);
    const { locales } = await import('../src/shared/i18n/locales.js');
    assert.equal(locales.ru.home.badges.season.replace('{season}', 2), '2 сезон');
    assert.equal(locales.en.home.badges.airing, 'New episodes');

    console.log('Home airing anime tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
