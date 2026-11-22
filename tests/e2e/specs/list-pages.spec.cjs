/**
 * Favorites, Watchlist, Watching and custom collections live in Bookmarks, so an
 * old link to one must land on its filter there.
 */
const { test, expect, emulator, storeTheme, waitForStillness } = require('../lib/fixtures.cjs');

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

const OLD_COLLECTION_LINKS = [
    { name: 'collection page', path: 'src/pages/collection/collection.html?id=list-1' },
    { name: 'Ratings ?collection=', path: 'src/pages/ratings/ratings.html?collection=list-1' }
];

for (const { name, path } of OLD_COLLECTION_LINKS) {
    test(`an old ${name} link opens the collection in Bookmarks, and Back does not return to it`, async ({ page, extension }) => {
        await emulator.putDocument(`users/${extension.user.uid}/collections/list-1`, { id: 'list-1', name: 'Подборка', icon: 'L' });
        const before = page.url();

        await page.goto(extension.url(path));

        await expect(page).toHaveURL(/\/bookmarks\/bookmarks\.html\?filter=collection:list-1$/);
        await expect(page.locator('#pageTitle')).toHaveText('Подборка');
        await expect(page.locator('.collection-item[data-collection-id="list-1"]')).toHaveClass(/active/);
        await expect(page.locator('#collectionMenuBtn')).toBeVisible();
        await expect(page.locator('#emptyState')).toContainText('В коллекции пока нет фильмов');

        await page.goBack();
        await expect(page).toHaveURL(before);
    });
}

test('an open collection asks to sign in after signing out', async ({ page, extension }) => {
    await emulator.putDocument(`users/${extension.user.uid}/collections/list-1`, { id: 'list-1', name: 'Подборка', icon: 'L' });

    await page.goto(extension.url('src/pages/bookmarks/bookmarks.html?filter=collection:list-1'));
    await expect(page.locator('#emptyState')).toBeVisible();

    await page.evaluate(() => globalThis.firebaseManager.signOut());

    await expect(page.locator('#emptyState')).toContainText('Для просмотра закладок необходимо войти в аккаунт.');
    await expect(page.locator('.collection-item')).toHaveCount(0);
    await expect(page.locator('#collectionMenuBtn')).toBeHidden();
});

for (const theme of ['dark', 'light']) {
    test(`card menu quick actions switch the status and the collection through the shared handler (${theme})`, async ({ page, extension }, testInfo) => {
        await seedBookmark(extension, 101, 'watching');
        await emulator.putDocument(`users/${extension.user.uid}/collections/list-1`, { id: 'list-1', name: 'Подборка', icon: 'L', movieIds: [] });
        await storeTheme(page, theme);

        await page.goto(extension.url('src/pages/bookmarks/bookmarks.html'));
        await expect(page.locator('html')).toHaveClass(new RegExp(`${theme}-theme`));
        const card = page.locator('.movie-card-component[data-movie-id="101"]');
        await expect(card).toBeVisible();

        await card.locator('.mc-menu-btn').click();
        const watching = card.locator('[data-action="toggle-watching"]');
        const favorite = card.locator('[data-action="toggle-favorite"]');
        await expect(watching).toHaveAttribute('data-is-watching', 'true');

        // Another status switches the bookmark; only one item stays on.
        await favorite.click();
        await expect(favorite).toHaveAttribute('data-is-favorite', 'true');
        await expect(watching).toHaveAttribute('data-is-watching', 'false');
        await expect.poll(async () => (await emulator.listDocuments('favorites')).find(doc => doc.movieId === 101)?.status)
            .toBe('favorite');
        await expect(page.locator('#count-favorite')).toHaveText('1');
        await expect(page.locator('#count-watching')).toHaveText('0');

        // A saved status invalidates the bookmarks cache and Bookmarks redraws its grid,
        // which closes the menu; open it again on the redrawn card.
        await waitForStillness(page);
        await card.locator('.mc-menu-btn').click();
        await expect(favorite).toHaveAttribute('data-is-favorite', 'true');

        // A collection item checks at once and is saved.
        const collection = card.locator('[data-action="toggle-collection"][data-collection-id="list-1"]');
        await collection.click();
        await expect(collection).toHaveAttribute('data-in-collection', 'true');
        await expect(collection.locator('.mc-collection-check')).toBeVisible();
        await expect.poll(async () => (await emulator.listDocuments(`users/${extension.user.uid}/collections`))[0]?.movieIds)
            .toEqual([101]);
        await expect(page.locator('.collection-item[data-collection-id="list-1"]')).toContainText('1');

        // The collection write redraws the grid too; the reopened menu shows both changes.
        await waitForStillness(page);
        await card.locator('.mc-menu-btn').click();
        await expect(collection).toHaveAttribute('data-in-collection', 'true');
        await expect(favorite).toHaveAttribute('data-is-favorite', 'true');
        await waitForStillness(page);
        const file = testInfo.outputPath(`card-menu-${theme}.png`);
        await page.screenshot({ path: file, fullPage: true });
        await testInfo.attach(`card-menu-${theme}`, { path: file, contentType: 'image/png' });

        // The shown status removes the bookmark; Bookmarks asks first.
        await favorite.click();
        await expect(page.locator('.confirm-dialog__title')).toBeVisible();
        await page.locator('[data-confirm-dialog="confirm"]').click();
        await expect(card).toHaveCount(0);
        await expect.poll(async () => (await emulator.listDocuments('favorites')).some(doc => doc.movieId === 101))
            .toBe(false);
    });

    test(`deleting an open collection asks through the shared dialog (${theme})`, async ({ page, extension }, testInfo) => {
        await emulator.putDocument(`users/${extension.user.uid}/collections/list-1`, { id: 'list-1', name: 'Подборка', icon: 'L' });
        await storeTheme(page, theme);

        await page.goto(extension.url('src/pages/bookmarks/bookmarks.html?filter=collection:list-1'));
        await expect(page.locator('html')).toHaveClass(new RegExp(`${theme}-theme`));
        await expect(page.locator('#emptyState')).toContainText('Откройте меню на карточке фильма и выберите эту коллекцию.');

        const shoot = async name => {
            await waitForStillness(page);
            const file = testInfo.outputPath(`${name}-${theme}.png`);
            await page.screenshot({ path: file, fullPage: true });
            await testInfo.attach(`${name}-${theme}`, { path: file, contentType: 'image/png' });
        };
        await shoot('collection-empty');

        const askToDelete = async () => {
            await page.locator('#collectionMenuBtn').click();
            await page.locator('.collection-dropdown [data-action="delete-collection"]').click();
            await expect(page.locator('.confirm-dialog__title')).toHaveText('Удалить коллекцию «Подборка»?');
        };

        await askToDelete();
        await shoot('collection-delete-dialog');
        await page.keyboard.press('Escape');
        await expect(page.locator('.confirm-dialog')).toBeHidden();
        await expect(page.locator('.collection-item[data-collection-id="list-1"]')).toBeVisible();

        await askToDelete();
        await page.locator('[data-confirm-dialog="confirm"]').click();
        await expect(page.locator('.collection-item[data-collection-id="list-1"]')).toHaveCount(0);
        await expect(page.locator('.sidebar-item[data-filter="all"]')).toHaveClass(/active/);
        await expect(page.locator('#collectionMenuBtn')).toBeHidden();
    });
}
