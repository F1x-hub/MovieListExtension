/**
 * Favorites, Watchlist and Watching became Bookmarks filters, so an old link to
 * one must land on its filter. Collection keeps its own page.
 */
const { test, expect, emulator } = require('../lib/fixtures.cjs');

const OLD_LINKS = [
    { name: 'Favorites', path: 'src/pages/favorites/favorites.html', filter: 'favorite', other: 'watching' },
    { name: 'Watchlist', path: 'src/pages/watchlist/watchlist.html', filter: 'plan_to_watch', other: 'favorite' },
    { name: 'Watching', path: 'src/pages/watching/watching.html', filter: 'watching', other: 'plan_to_watch' }
];

function seedBookmark(extension, movieId, status) {
    return emulator.putDocument(`favorites/${extension.user.uid}_${movieId}`, {
        userId: extension.user.uid,
        movieId,
        movieTitle: `Фильм ${movieId}`,
        status
    });
}

for (const { name, path, filter, other } of OLD_LINKS) {
    test(`an old ${name} link opens that Bookmarks filter, and Back does not return to it`, async ({ page, extension }) => {
        await seedBookmark(extension, 101, filter);
        await seedBookmark(extension, 102, other);
        const before = page.url();

        await page.goto(extension.url(path));

        await expect(page).toHaveURL(new RegExp(`/bookmarks/bookmarks\\.html\\?filter=${filter}$`));
        await expect(page.locator(`.sidebar-item[data-filter="${filter}"]`)).toHaveClass(/active/);
        await expect(page.getByText('Фильм 101')).toBeVisible();
        await expect(page.getByText('Фильм 102')).toHaveCount(0);

        await page.goBack();
        await expect(page).toHaveURL(before);
    });
}

test('Collection asks to sign in after signing out, and shows nothing else', async ({ page, extension }) => {
    await emulator.putDocument(`users/${extension.user.uid}/collections/list-1`, { id: 'list-1', name: 'Подборка', icon: 'L' });

    await page.goto(extension.url('src/pages/collection/collection.html?id=list-1'));
    await expect(page.locator('#emptyState')).toBeVisible();
    await expect(page.locator('#errorState')).toBeHidden();

    await page.evaluate(() => globalThis.firebaseManager.signOut());

    await expect(page.locator('#errorMessage')).toHaveText('Для просмотра коллекции необходимо войти в аккаунт.');
    await expect(page.locator('#errorState')).toBeVisible();
    await expect(page.locator('#emptyState')).toBeHidden();
    await expect(page.locator('#resultsCount')).toContainText('0');
});
