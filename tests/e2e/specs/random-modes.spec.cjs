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

        // Reset and the disclosure chevron sit in one row: one height.
        expect(await heightOf(page.locator('#toggleConfigBtn'))).toBe(await heightOf(page.locator('#resetFiltersBtn')));
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
