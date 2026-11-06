const { test, expect, stored, waitForStillness } = require('../lib/fixtures.cjs');
const { SECTIONS, kinopoiskIdFor } = require('../lib/catalog.cjs');

const CARD = '#films-grid .movie-card-component';
const TITLE = 'h1.movie-detail-page-title';
const TMDB_DETAILS = /^https:\/\/(us-central1-[^/]+\.cloudfunctions\.net\/tmdbProxy|api\.themoviedb\.org\/3\/movie\/)/;

/** TMDB answers nothing until release(), so what is on screen cannot have come from it. */
async function holdTmdb(context) {
    let open;
    const gate = new Promise(resolve => { open = resolve; });
    const handler = async route => {
        await gate;
        await route.fallback();
    };
    await context.route(TMDB_DETAILS, handler);
    return { release: () => open(), stop: () => context.unroute(TMDB_DETAILS, handler) };
}

async function openFromHome(page, extension, film, index) {
    await page.goto(extension.url('src/pages/home/home.html'));
    await expect(page.locator(CARD)).toHaveCount(SECTIONS.films.length);
    await waitForStillness(page);
    const link = page.locator(CARD).nth(index).locator('[data-action="view-details"]').first();
    await link.scrollIntoViewIfNeeded();
    await waitForStillness(page);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`movieId=${kinopoiskIdFor(film.id)}`));
}

const resolveAddress = film => `src/pages/movie-details/movie-details.html?${new URLSearchParams({
    resolveTmdbId: String(film.id),
    source: 'home-tmdb-only',
    title: film.title,
    originalTitle: film.original_title,
    year: film.release_date.slice(0, 4),
    mediaType: 'movie'
})}`;

test('a film opened from Home opens again without waiting for the network', async ({ page, extension }) => {
    const film = SECTIONS.films[1];
    const key = `local_movie_cache_${kinopoiskIdFor(film.id)}`;

    await test.step('the first open keeps the film in this browser', async () => {
        await openFromHome(page, extension, film, 1);
        await expect(page.locator(TITLE)).toHaveText(film.title);
        await expect.poll(async () => (await stored(page, key))?.name).toBe(film.title);
        const record = await stored(page, key);
        expect(record.identity.status, 'caching does not verify the film').toBe('UNVERIFIED');
    });

    const tmdb = await holdTmdb(extension.context);
    await test.step('the second open shows it while TMDB is silent', async () => {
        await openFromHome(page, extension, film, 1);
        await expect(page.locator(TITLE)).toHaveText(film.title);
    });

    await test.step('a card that has not learned its ID shows it too, with no search screen', async () => {
        await page.goto(extension.url(resolveAddress(film)));
        await expect(page.locator(TITLE)).toHaveText(film.title);
        await expect(page).toHaveURL(new RegExp(`movieId=${kinopoiskIdFor(film.id)}`));
        await expect(page.locator('.loading-title')).not.toContainText('Ищем');
    });
    tmdb.release();
    await tmdb.stop();

    await test.step('the refresh behind it does not redraw the page', async () => {
        await page.waitForFunction(() => globalThis.MovieDetailsPerf?.trace?.completed === true);
        const heading = await page.locator(TITLE).elementHandle();
        await page.waitForTimeout(500);
        expect(await heading.evaluate(node => node.isConnected)).toBe(true);
    });
});

test('a record holding only ratings does not paint as an unknown film', async ({ page, extension }) => {
    const film = SECTIONS.films[2];
    const id = kinopoiskIdFor(film.id);
    await page.evaluate(([key, record]) => chrome.storage.local.set({ [key]: record }),
        [`local_movie_cache_${id}`, { kinopoiskId: id, kpRating: 7.5, votes: { kp: 900 }, lastRatingsParsedAt: '2026-06-15T00:00:00.000Z' }]);

    const tmdb = await holdTmdb(extension.context);
    await openFromHome(page, extension, film, 2);
    await page.waitForTimeout(800);
    await expect(page.locator(TITLE), 'nothing is drawn until the film is known').toHaveCount(0);
    tmdb.release();
    await tmdb.stop();

    await expect(page.locator(TITLE)).toHaveText(film.title);
    await expect.poll(async () => (await stored(page, `local_movie_cache_${id}`))?.name).toBe(film.title);
    const record = await stored(page, `local_movie_cache_${id}`);
    expect(record.lastRatingsParsedAt, 'the parsed ratings survive').toBe('2026-06-15T00:00:00.000Z');
    expect(record.kpRating).toBe(7.5);
});
