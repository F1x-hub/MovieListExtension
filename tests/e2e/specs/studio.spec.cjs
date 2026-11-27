/**
 * The studio page: its header, the films/series switch, the orders, «Показать ещё» and
 * the user's own score on a title they rated, in both themes and at phone width.
 */
const { test, expect, emulator, setTheme, waitForStillness } = require('../lib/fixtures.cjs');
const { SECTIONS, STUDIO, kinopoiskIdFor } = require('../lib/catalog.cjs');

const rated = SECTIONS.films[0];

async function openStudio(page, extension, query = '') {
    await page.goto(extension.url(`src/pages/studio/studio.html?id=${STUDIO.id}${query}`));
    await expect(page.locator('#studioName')).toHaveText(STUDIO.name);
    await expect(page.locator('#studioGrid .movie-card-component')).toHaveCount(12);
}

for (const theme of ['dark', 'light']) {
    test(`the studio page shows the studio, its titles and the user's score (${theme})`, async ({ page, extension }, testInfo) => {
        await emulator.putDocument(`ratings/${extension.user.uid}_${kinopoiskIdFor(rated.id)}`, {
            userId: extension.user.uid, movieId: kinopoiskIdFor(rated.id), rating: 8, comment: ''
        });
        await openStudio(page, extension);
        await setTheme(page, theme);
        await expect(page.locator('#studioGrid .movie-card-component')).toHaveCount(12);

        await test.step('header', async () => {
            await expect(page).toHaveTitle(`${STUDIO.name} — Сеанс`);
            await expect(page.locator('#studioKind')).toHaveText('Студия · Россия');
            await expect(page.locator('#studioFacts')).toContainText('Мурманск');
            await expect(page.locator('#studioFacts')).toContainText('12 фильмов и 12 сериалов');
            await expect(page.locator('#studioFacts a[href="https://studio.example"]')).toHaveText('studio.example');
        });

        await test.step("the user's score on the title they rated", async () => {
            const card = page.locator(`#studioGrid .movie-card-component:has([data-tmdb-id="${rated.id}"]), #studioGrid .movie-card-component[data-tmdb-id="${rated.id}"]`).first();
            await expect(card.locator('.mc-badge-user')).toContainText('8', { timeout: 15000 });
            await expect(page.locator('#studioGrid .mc-badge-user')).toHaveCount(1);
        });

        await waitForStillness(page);
        await testInfo.attach(`studio-${theme}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

        await test.step('series, then the rating order', async () => {
            await page.locator('#studioMedia [data-media="tv"]').click();
            await expect(page.locator('#studioMedia [data-media="tv"]')).toHaveAttribute('aria-pressed', 'true');
            await expect(page.locator('#studioGrid .movie-card-component')).toHaveCount(12);
            await expect(page.locator('#studioGrid')).toContainText(SECTIONS.series[0].name);
            await expect(page).toHaveURL(/media=tv/);

            await page.locator('.studio-sort .sort-control__trigger').click();
            await page.getByRole('option', { name: 'По оценке' }).click();
            await expect(page.locator('#studioSort')).toHaveValue('rating');
            await expect(page.locator('#studioNote')).toBeVisible();
            await expect(page.locator('#studioNote')).toContainText('50');
            await expect(page.locator('#studioGrid .movie-card-component')).toHaveCount(12);
        });
    });
}

test('the studio page fits a phone-width window', async ({ page, extension }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStudio(page, extension, '&media=tv');
    await waitForStillness(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const columns = await page.locator('#studioGrid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(2);
    await testInfo.attach('studio-390', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('a wrong studio link says so', async ({ page, extension }) => {
    await page.goto(extension.url('src/pages/studio/studio.html?id=nope'));
    await expect(page.locator('#studioErrorTitle')).toHaveText('Неверная ссылка на студию');
    await expect(page.locator('#studioErrorRetry')).toBeHidden();
});
