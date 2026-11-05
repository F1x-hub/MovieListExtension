/**
 * The rating dialog must answer a press at once, however slow the network is.
 * The read that confirms the current rating is the real one unless a test says
 * otherwise; its timing is put in the test's hands by gating the page's service.
 */
const { test, expect: baseExpect, emulator, waitForStillness } = require('../lib/fixtures.cjs');
const { SECTIONS, kinopoiskIdFor } = require('../lib/catalog.cjs');

// Soft, so one run reports everything that is wrong with the dialog.
const expect = baseExpect.configure({ soft: true, timeout: 5000 });
const film = SECTIONS.films[0];
const movieId = kinopoiskIdFor(film.id);
const dialog = '#ratingModal';
const saveButton = '#saveRatingBtn';
const rateButton = '.rate-movie-btn';
const star = rating => `.star-rating-btn[data-rating="${rating}"]`;
const bodyInert = page => page.locator('.rating-modal-body').evaluate(body => body.inert);

async function openFilmPage(page, extension) {
    await page.goto(extension.url('src/pages/home/home.html'));
    const card = page.locator('#films-grid .movie-card-component [data-action="view-details"]').first();
    await baseExpect(card).toBeAttached();
    await card.click();
    await baseExpect(page.locator('h1.movie-detail-page-title')).toHaveText(film.title);
    await waitForStillness(page);
}

/** Holds rating reads until __e2eReads.release(reply); no reply means the real read. */
async function gateRatingReads(page) {
    await page.evaluate(() => {
        const service = globalThis.firebaseManager.getRatingService();
        const read = service.getRating.bind(service);
        const gate = { calls: 0 };
        gate.opened = new Promise(resolve => { gate.release = resolve; });
        service.getRating = async (...args) => {
            gate.calls++;
            const reply = await gate.opened;
            return reply === undefined ? read(...args) : reply;
        };
        globalThis.__e2eReads = gate;
    });
}

const release = (page, reply) => page.evaluate(value => globalThis.__e2eReads.release(value), reply);

async function seedRating(extension, rating, comment) {
    await emulator.putDocument(`ratings/${extension.user.uid}_${movieId}`, {
        userId: extension.user.uid, movieId, rating, comment
    });
}

test('the dialog opens before its read answers, and locks the choice until then', async ({ page, extension }) => {
    await openFilmPage(page, extension);
    await gateRatingReads(page);

    await test.step('a press answers at once', async () => {
        await page.locator(rateButton).click();
        await expect(page.locator(dialog)).toBeVisible();
        await expect(page.locator('.star-rating-btn')).toHaveCount(10);
    });

    await test.step('nothing can be chosen or saved from unconfirmed data', async () => {
        expect(await bodyInert(page)).toBe(true);
        await expect(page.locator(saveButton)).toHaveAttribute('aria-disabled', 'true');
        await page.locator(saveButton).dispatchEvent('click');
        await page.waitForTimeout(100);
        await expect(page.locator('.utils-toast')).toHaveCount(0);
    });

    await test.step('a slow read says what is happening', async () => {
        await expect(page.locator('#ratingStatus')).toHaveText('Загружаем вашу оценку…');
    });

    await test.step('the read unlocks the dialog', async () => {
        await release(page);
        await expect.poll(() => bodyInert(page)).toBe(false);
        await expect(page.locator(saveButton)).not.toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('#ratingStatus')).toHaveText('Выберите оценку');
        await page.locator(star(8)).click();
        await expect(page.locator(star(8))).toHaveAttribute('aria-pressed', 'true');
    });

    await test.step('and the rating saves as usual', async () => {
        await page.locator(saveButton).click();
        await expect(page.locator(dialog)).toBeHidden();
        await expect.poll(() => emulator.listDocuments('ratings')).toEqual([
            baseExpect.objectContaining({ rating: 8, userId: extension.user.uid, movieId })
        ]);
    });
});

test('a rating the page knows shows at once, and a newer one replaces it', async ({ page, extension }) => {
    await seedRating(extension, 7, 'Хорошо');
    await openFilmPage(page, extension);
    await expect(page.locator(rateButton)).toHaveAttribute('data-user-rating', '7');
    await gateRatingReads(page);

    await page.locator(rateButton).click();
    await expect(page.locator(dialog)).toBeVisible();
    await expect(page.locator(star(7))).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ratingComment')).toHaveValue('Хорошо');

    // Changed in another tab while this page stayed open.
    await release(page, { id: `${extension.user.uid}_${movieId}`, userId: extension.user.uid, movieId, rating: 9, comment: 'Другое' });
    await expect(page.locator(star(9))).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ratingComment')).toHaveValue('Другое');
    expect(await bodyInert(page)).toBe(false);
});

test('a failed read does not erase the rating the page knows', async ({ page, extension }) => {
    await seedRating(extension, 7, 'Хорошо');
    await openFilmPage(page, extension);
    await expect(page.locator(rateButton)).toHaveAttribute('data-user-rating', '7');
    await gateRatingReads(page);

    await page.locator(rateButton).click();
    await expect(page.locator(dialog)).toBeVisible();
    // RatingService reports a failed read as null.
    await release(page, null);
    await expect.poll(() => bodyInert(page)).toBe(false);
    await expect(page.locator(star(7))).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ratingComment')).toHaveValue('Хорошо');
});

test('closing before the read answers leaves nothing behind', async ({ page, extension }) => {
    await openFilmPage(page, extension);
    await gateRatingReads(page);

    await page.locator(rateButton).click();
    await expect(page.locator(dialog)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(dialog)).toBeHidden();

    await release(page, { id: 'late', userId: extension.user.uid, movieId, rating: 3, comment: 'Поздний ответ' });
    await page.waitForTimeout(300);
    await expect(page.locator(dialog)).toBeHidden();

    await page.evaluate(() => { globalThis.__e2eReads.opened = Promise.resolve(); });
    await page.locator(rateButton).click();
    await expect(page.locator(dialog)).toBeVisible();
    await expect.poll(() => bodyInert(page)).toBe(false);
    await expect(page.locator(star(3))).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#ratingComment')).toHaveValue('');
});
