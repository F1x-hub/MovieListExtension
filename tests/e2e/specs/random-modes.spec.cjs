/**
 * The Random page is three modes on one page: Pick (filters), Pool (the device-local
 * list) and Marathon (the shared round). Controls that share a row share a height.
 */
const { test, expect, emulator, storeTheme, waitForStillness } = require('../lib/fixtures.cjs');

const RANDOM = 'src/pages/random/random.html';

async function heightOf(locator) {
    const box = await locator.boundingBox();
    return Math.round(box.height);
}

async function seedPool(page, count) {
    const today = Date.parse('2026-11-22T12:00:00Z');
    await page.evaluate(movies => chrome.storage.local.set({ randomPool: movies }), Array.from({ length: count }, (_, index) => ({
        kpId: 1000 + index,
        title: `Фильм пула ${index + 1}`,
        year: 1930 + index,
        rating: 7.5,
        poster: '',
        addedAt: new Date(today - index * 86400000).toISOString()
    })));
}

async function seedMarathon(uid, round, items) {
    await emulator.putDocument('randomMarathons/current', { roundId: 4, ...round });
    for (const [index, item] of items.entries()) {
        await emulator.putDocument(`randomMarathons/current/items/4_${item.kpId}`, {
            roundId: 4,
            title: `Фильм марафона ${item.kpId}`,
            year: 1940,
            poster: '',
            addedBy: item.mine ? uid : 'someone-else',
            addedByName: item.mine ? 'Я' : 'Аня',
            addedAt: new Date(Date.UTC(2026, 10, 1 + index)).toISOString(),
            ...item
        });
    }
}

async function shoot(page, testInfo, name) {
    await waitForStillness(page);
    const file = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

for (const theme of ['dark', 'light']) {
    test(`modes switch by tab, hash and memory, and row controls line up (${theme})`, async ({ page, extension }, testInfo) => {
        await page.goto(extension.url(RANDOM));
        await storeTheme(page, theme);
        await seedPool(page, 5);
        await page.evaluate(() => localStorage.removeItem('random_page_mode'));
        await page.goto(extension.url(RANDOM));

        const tabs = page.getByRole('tab');
        await expect(tabs).toHaveCount(3);
        await expect(page.locator('#randomModeTabPick')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#randomPanelPick')).toBeVisible();
        await expect(page.locator('#poolCount')).toHaveText('5');

        // Reset and «find» share the open panel's action bar, which stays in view over long groups.
        await page.locator('#configHeader').click();
        await page.locator('#genreFilterSection > summary').click();
        expect(await heightOf(page.locator('#applyConfigBtn'))).toBe(await heightOf(page.locator('#resetFiltersBtn')));
        await expect(page.locator('#applyConfigBtn')).toBeInViewport({ ratio: 1 });
        await page.locator('#configHeader').click();
        await expect(page.locator('#applyConfigBtn')).toBeHidden();
        await shoot(page, testInfo, `pick-${theme}`);

        await page.locator('#randomModeTabPool').click();
        await expect(page).toHaveURL(/#pool$/);
        await expect(page.locator('#randomPanelPool')).toBeVisible();
        await expect(page.locator('#randomPanelPick')).toBeHidden();
        await expect(page.locator('#poolList .pool-list-item')).toHaveCount(5);
        // The search field and the roll button beside it: one height.
        expect(await heightOf(page.locator('#poolSearchInput'))).toBe(await heightOf(page.locator('#rollFromPoolBtn')));
        await page.keyboard.press('KeyR');
        await expect(page.locator('#loadingState')).toBeHidden();
        await shoot(page, testInfo, `pool-${theme}`);

        // Without a hash the remembered mode opens again.
        await page.goto(extension.url(RANDOM));
        await expect(page.locator('#randomModeTabPool')).toHaveAttribute('aria-selected', 'true');

        await page.locator('#randomModeTabPool').focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#randomModeTabMarathon')).toBeFocused();
        await expect(page).toHaveURL(/#marathon$/);
        await expect(page.locator('#randomPanelMarathon')).toBeVisible();
        await shoot(page, testInfo, `marathon-empty-${theme}`);

        await seedPool(page, 0);
        await page.locator('#randomModeTabPool').click();
        await expect(page.locator('#rollFromPoolBtn')).toBeDisabled();
        await shoot(page, testInfo, `pool-empty-${theme}`);
        await page.getByRole('button', { name: /Подбор/ }).last().click();
        await expect(page.locator('#randomModeTabPick')).toHaveAttribute('aria-selected', 'true');
    });
}

test('the marathon shows the picked movie, the wheel state and groups from the real round', async ({ page, extension }, testInfo) => {
    await emulator.putDocument(`users/${extension.user.uid}`, {
        displayName: 'E2E', email: 'e2e@example.test', approvalStatus: 'approved', isAdmin: true
    });
    await seedMarathon(extension.user.uid, { status: 'active', currentItemId: '4_3' }, [
        { kpId: 1, state: 'watched' },
        { kpId: 2, state: 'queued', mine: true },
        { kpId: 3, state: 'selected' },
        { kpId: 4, state: 'queued' },
        { kpId: 5, state: 'removed' }
    ]);

    await page.goto(extension.url(`${RANDOM}#marathon`));
    const spotlight = page.locator('#marathonCurrent');
    await expect(spotlight).toBeVisible();
    await expect(spotlight).toContainText('Фильм марафона 3');
    await expect(spotlight.locator('[data-marathon-action="watched"]')).toBeVisible();
    await expect(spotlight.locator('[data-marathon-action="removed"]')).toBeVisible();
    await expect(page.locator('#marathonSearchWrap')).toBeHidden();
    await expect(page.locator('.marathon-group-title')).toHaveText([/· 2$/, /· 1$/, /· 1$/]);
    await expect(page.locator('#marathonList')).not.toContainText('Фильм марафона 3');
    await expect(page.locator('#marathonLiveDot')).toBeVisible();
    await shoot(page, testInfo, 'marathon-picked-dark');

    await emulator.putDocument('randomMarathons/current', { roundId: 4, status: 'collecting', currentItemId: null });
    await page.reload();
    await expect(page.locator('#marathonSearchWrap')).toBeVisible();
    await expect(page.locator('#marathonSummary')).toContainText('без лимита');
    await expect(page.locator('#marathonActions [data-marathon-action="start"]')).toBeVisible();
    await shoot(page, testInfo, 'marathon-collecting-dark');
});

for (const theme of ['dark', 'light']) {
    test(`past rounds show scores and the winner, and the profile leads to them (${theme})`, async ({ page, extension }, testInfo) => {
        const me = extension.user.uid;
        const day = number => new Date(Date.UTC(2026, 9, number, 18));
        await emulator.putDocument(`users/${me}`, { displayName: 'E2E Viewer', email: 'e2e@example.test', approvalStatus: 'approved', isAdmin: false });
        await emulator.putDocument('users/friend', { displayName: 'Аня', email: 'anya@example.test', approvalStatus: 'approved', isAdmin: false });
        await emulator.putDocument('users/viewer', { displayName: 'Боря', email: 'boris@example.test', approvalStatus: 'approved', isAdmin: false });
        await emulator.putDocument('randomMarathons/current', { roundId: 3, status: 'active', currentItemId: null });
        const films = [
            [1, 101, 'Гаттака', me, 2], [1, 102, 'Капля', 'friend', 4], [2, 201, 'Коралина в Стране Кошмаров', 'friend', 8],
            [2, 202, 'Весна, лето, осень, зима... и снова весна', me, 10], [2, 203, 'Видеодром', me, 12]
        ];
        for (const [roundId, kpId, title, addedBy, at] of films) {
            await emulator.putDocument(`randomMarathons/current/items/${roundId}_${kpId}`, {
                roundId, kpId, title, year: 1997, poster: '', addedBy, addedByName: addedBy, state: 'watched',
                addedAt: day(1), selectedAt: day(at), resolvedAt: day(at + 1)
            });
        }
        await emulator.putDocument('randomMarathons/current/items/3_301', { roundId: 3, kpId: 301, title: 'Седьмая печать', year: 1957, poster: '', addedBy: me, addedByName: 'E2E', state: 'queued', addedAt: day(20) });
        for (const [userId, userName, movieId, rating, at] of [
            [me, 'E2E Viewer', 101, 10, 3], ['friend', 'Аня', 101, 9, 3], ['friend', 'Аня', 102, 5, 5], [me, 'E2E Viewer', 102, 6, 5],
            [me, 'E2E Viewer', 201, 10, 9], ['friend', 'Аня', 201, 9, 9], ['viewer', 'Борис Настоящее-Имя', 201, 8, 10], [me, 'E2E Viewer', 202, 4, 11], ['friend', 'Аня', 202, 3, 11]
        ]) {
            await emulator.putDocument(`ratings/${userId}_${movieId}`, { userId, userName, movieId, rating, comment: '', createdAt: day(at), updatedAt: day(at) });
        }

        await page.goto(extension.url(RANDOM));
        await storeTheme(page, theme);
        await page.goto(extension.url(`${RANDOM}?round=2#marathon`));
        const rounds = page.locator('.marathon-history-round');
        await expect(rounds).toHaveCount(2);
        // The address opens the round it names; the running one is not history.
        await expect(rounds.nth(0)).toHaveAttribute('open', '');
        await expect(rounds.nth(0)).toContainText('Раунд 2');
        await expect(rounds.nth(0).locator('.marathon-history-best')).toContainText('«Коралина в Стране Кошмаров», 9,0');
        await expect(rounds.nth(0).locator('.marathon-history-best')).toContainText('Аня');
        await expect(rounds.nth(0).locator('.marathon-history-score')).toHaveText(['9,0', '3,5', '—']);
        // A rating given while the film was on counts without bringing a film.
        await expect(rounds.nth(0).locator('.marathon-history-film').first()).toContainText('Боря 8');
        await expect(page.locator('#marathonHistory')).not.toContainText('Настоящее-Имя');
        await rounds.nth(1).locator('summary').click();
        await expect(rounds.nth(1).locator('.marathon-history-score')).toHaveText(['9,5', '5,5']);
        await shoot(page, testInfo, `marathon-history-${theme}`);

        await page.goto(extension.url('src/pages/profile/profile.html?tab=statistics'));
        const section = page.locator('.insight-marathon');
        await expect(section.locator('.insight-verdict')).toContainText('6,5');
        await expect(section.locator('.insight-verdict a')).toContainText('«Гаттака»: 9,5');
        await expect(section).toContainText('3 раунда, принесено 4 фильма, вместе посмотрено 4');
        await expect(section.locator('.insight-poster__caption').first()).toContainText('без оценок');
        await section.scrollIntoViewIfNeeded();
        await shoot(page, testInfo, `profile-marathon-${theme}`);
        await section.locator('.insight-verdict a').click();
        await expect(page).toHaveURL(/random\.html\?round=1#marathon$/);
        await expect(page.locator('.marathon-history-round[data-round="1"]')).toHaveAttribute('open', '');
    });
}

test('a running round shows scores of watched films, a finished one is told once', async ({ page, extension }, testInfo) => {
    const me = extension.user.uid;
    const day = number => new Date(Date.UTC(2026, 9, number, 18));
    const watched = (roundId, kpId, title, addedBy) => emulator.putDocument(`randomMarathons/current/items/${roundId}_${kpId}`, {
        roundId, kpId, title, year: 1997, poster: '', addedBy, addedByName: addedBy, state: 'watched', addedAt: day(1), selectedAt: day(2), resolvedAt: day(3)
    });
    await emulator.putDocument('users/friend', { displayName: 'Аня', email: 'anya@example.test', approvalStatus: 'approved', isAdmin: false });
    await emulator.putDocument('randomMarathons/current', { roundId: 8, status: 'active', currentItemId: null });
    for (let roundId = 1; roundId <= 7; roundId++) await watched(roundId, roundId * 100, `Фильм раунда ${roundId}`, 'friend');
    await watched(8, 800, 'Фильм раунда 8', 'friend');
    await emulator.putDocument('randomMarathons/current/items/8_801', { roundId: 8, kpId: 801, title: 'В очереди', year: 1957, poster: '', addedBy: 'friend', addedByName: 'Аня', state: 'queued', addedAt: day(1) });
    await emulator.putDocument(`ratings/${me}_800`, { userId: me, userName: 'E2E', movieId: 800, rating: 7, comment: '', createdAt: day(3), updatedAt: day(3) });

    await page.goto(extension.url(`${RANDOM}#marathon`));
    await expect(page.locator('#marathonList .marathon-history-score')).toHaveText('7,0');
    // Six newer rounds; the earlier one waits behind a button.
    await expect(page.locator('.marathon-history-round:visible')).toHaveCount(6);
    await page.locator('.marathon-history-more').click();
    await expect(page.locator('.marathon-history-round:visible')).toHaveCount(7);
    await expect(page.locator('.marathon-history-round[data-round="1"] summary')).toBeFocused();

    await emulator.putDocument('randomMarathons/current', { roundId: 8, status: 'completed', currentItemId: null });
    await page.reload();
    const finished = page.locator('.marathon-history-round[data-round="8"]');
    await expect(finished).toHaveAttribute('open', '');
    await expect(finished.locator('.marathon-history-score').first()).toHaveText('7,0');
    await expect(page.locator('.marathon-card')).toBeHidden();
    await expect(page.getByText('Фильм раунда 8', { exact: true })).toHaveCount(1);
    await shoot(page, testInfo, 'marathon-finished-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    await shoot(page, testInfo, 'marathon-finished-390');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Someone else's profile speaks about their films.
    await page.setViewportSize({ width: 1440, height: 900 });
    await emulator.putDocument('ratings/friend_800', { userId: 'friend', userName: 'Аня', movieId: 800, rating: 9, comment: '', createdAt: day(3), updatedAt: day(3) });
    await page.goto(extension.url('src/pages/profile/profile.html?userId=friend&tab=statistics'));
    const section = page.locator('.insight-marathon');
    await expect(section.locator('.insight-verdict')).toContainText('Компания оценивает эти фильмы в среднем на 8,0');
    await shoot(page, testInfo, 'profile-other-dark');
});
