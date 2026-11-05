/**
 * What the rating dialog does while the write is on its way. The write itself
 * is the real one; only its timing and outcome are put in the test's hands, by
 * gating the page's own rating service.
 */
const { test, expect: baseExpect, emulator, setTheme, waitForStillness } = require('../lib/fixtures.cjs');
const { SECTIONS, kinopoiskIdFor } = require('../lib/catalog.cjs');

// Soft, so one run reports everything that is wrong with the dialog.
const expect = baseExpect.configure({ soft: true, timeout: 6000 });
const film = SECTIONS.films[0];
const dialog = '#ratingModal';
const saveButton = '#saveRatingBtn';
const toast = text => `.utils-toast:has-text("${text}")`;

async function openDialogWithRating(page, extension, rating) {
    await page.goto(extension.url('src/pages/home/home.html'));
    const card = page.locator('#films-grid .movie-card-component [data-action="view-details"]').first();
    await baseExpect(card).toBeAttached();
    await card.click();
    await baseExpect(page.locator('h1.movie-detail-page-title')).toHaveText(film.title);
    await waitForStillness(page);
    await page.locator('.rate-movie-btn').click();
    await baseExpect(page.locator(dialog)).toBeVisible();
    await baseExpect(page.locator('.star-rating-btn')).toHaveCount(10);
    await waitForStillness(page);
    await page.locator(`.star-rating-btn[data-rating="${rating}"]`).click();
}

/** Holds every write until the test calls __e2eGate.release() or .fail(). */
async function gateRatingWrites(page) {
    await page.evaluate(() => {
        const service = globalThis.firebaseManager.getRatingService();
        const write = service.addOrUpdateRating.bind(service);
        const gate = { calls: 0 };
        gate.opened = new Promise((resolve, reject) => {
            gate.release = () => resolve();
            gate.fail = () => reject(new Error('Failed to save rating: simulated outage'));
        });
        gate.opened.catch(() => {});
        service.addOrUpdateRating = async (...args) => {
            gate.calls++;
            await gate.opened;
            return write(...args);
        };
        globalThis.__e2eGate = gate;
    });
}

const writeAttempts = page => page.evaluate(() => globalThis.__e2eGate.calls);
const spinnerOpacity = page => page.evaluate(selector => getComputedStyle(document.querySelector(selector), '::after').opacity, saveButton);

for (const theme of ['dark', 'light']) {
    test(`the dialog shows the write is running and locks until it settles (${theme})`, async ({ page, extension }) => {
        await setTheme(page, theme);
        await openDialogWithRating(page, extension, 8);
        await gateRatingWrites(page);
        const before = await page.locator(saveButton).boundingBox();

        await test.step('quick saves never flash a spinner', async () => {
            const opacityAtPress = await page.evaluate(selector => {
                const button = document.querySelector(selector);
                button.click();
                return getComputedStyle(button, '::after').opacity;
            }, saveButton);
            expect(opacityAtPress).toBe('0');
        });

        await test.step('the button reacts at once and keeps its size', async () => {
            await expect(page.locator(saveButton)).toBeDisabled();
            await expect(page.locator(saveButton)).toHaveAttribute('aria-busy', 'true');
            await expect(page.locator(saveButton)).toHaveClass(/btn--pending/);
            expect(await page.locator(saveButton).boundingBox()).toEqual(before);
        });

        await test.step('a slow write shows a spinner', async () => {
            await expect.poll(() => spinnerOpacity(page), { timeout: 2000 }).toBe('1');
            await expect(page.locator('.rating-modal-footer')).toHaveScreenshot(`rating-saving-${theme}.png`);
        });

        await test.step('nothing can change what is being written', async () => {
            // Counted once the write finishes: a second one would start later.
            await page.locator(saveButton).dispatchEvent('click');
            await page.keyboard.press('Escape');
            await expect(page.locator(dialog)).toBeVisible();
            await expect(page.locator('#cancelRatingBtn')).toBeDisabled();
            await expect(page.locator('#ratingModalClose')).toBeDisabled();
            expect(await page.locator('.rating-modal-body').evaluate(body => body.inert)).toBe(true);
        });

        await test.step('a finished write closes the dialog and is stored once', async () => {
            await page.evaluate(() => globalThis.__e2eGate.release());
            await expect(page.locator(dialog)).toBeHidden();
            await expect(page.locator(toast('Оценка сохранена'))).toBeVisible();
            await expect.poll(() => emulator.listDocuments('ratings')).toEqual([
                baseExpect.objectContaining({ rating: 8, userId: extension.user.uid, movieId: kinopoiskIdFor(film.id) })
            ]);
            expect(await writeAttempts(page)).toBe(1);
        });

        await test.step('the dialog opens clean the next time', async () => {
            await page.locator('.rate-movie-btn').click();
            await expect(page.locator(dialog)).toBeVisible();
            await expect(page.locator(saveButton)).toBeEnabled();
            await expect(page.locator(saveButton)).not.toHaveClass(/btn--pending/);
            await expect(page.locator('#cancelRatingBtn')).toBeEnabled();
            await expect(page.locator('#ratingModalClose')).toBeEnabled();
            expect(await page.locator('.rating-modal-body').evaluate(body => body.inert)).toBe(false);
        });
    });
}

test('with reduced motion the spinner shows at once and stays still', async ({ page, extension }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDialogWithRating(page, extension, 7);
    await gateRatingWrites(page);
    const spinner = await page.evaluate(selector => {
        const button = document.querySelector(selector);
        button.click();
        const style = getComputedStyle(button, '::after');
        return { opacity: style.opacity, animation: style.animationName };
    }, saveButton);
    expect(spinner).toEqual({ opacity: '1', animation: 'none' });
    await page.evaluate(() => globalThis.__e2eGate.release());
    await expect(page.locator(dialog)).toBeHidden();
});

test('a failed write says so, keeps the choice and can be retried', async ({ page, extension }) => {
    await openDialogWithRating(page, extension, 6);
    await gateRatingWrites(page);
    await page.locator(saveButton).click();
    await expect(page.locator(saveButton)).toBeDisabled();
    await page.evaluate(() => globalThis.__e2eGate.fail());

    await expect(page.locator(toast('Не удалось сохранить оценку'))).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('failed-save.png') });
    await expect(page.locator(dialog)).toBeVisible();
    await expect(page.locator(saveButton)).toBeEnabled();
    await expect(page.locator(saveButton)).toBeFocused();
    await expect(page.locator(saveButton)).not.toHaveClass(/btn--pending/);
    await expect(page.locator('.star-rating-btn[data-rating="6"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await emulator.listDocuments('ratings')).toEqual([]);

    // Retrying from the same dialog works.
    await page.evaluate(() => { globalThis.__e2eGate.opened = Promise.resolve(); });
    await page.locator(saveButton).click();
    await expect(page.locator(dialog)).toBeHidden();
    await expect.poll(() => emulator.listDocuments('ratings')).toEqual([baseExpect.objectContaining({ rating: 6 })]);
});
