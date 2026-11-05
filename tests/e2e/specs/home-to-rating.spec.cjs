const { test, expect, emulator, setTheme, waitForStillness } = require('../lib/fixtures.cjs');
const { SECTIONS, kinopoiskIdFor } = require('../lib/catalog.cjs');

const THEMES = ['dark', 'light'];
const firstFilm = SECTIONS.films[0];
const firstCard = '#films-grid .movie-card-component';

// Each entry was looked at on a filmstrip. Anything else that moves while a page
// loads fails the journey, including small elements the shift score forgives.
// These loads are a returning user's; see tests/e2e/README.md for what they miss.
const EXPLAINED_LOAD_JUMPS = {
    home: [
        // Expected once for an empty account: a saved preview may not be shown
        // before Firebase confirms the session, so the personal tier reserves
        // full lists and then collapses, moving the dashboard up. It moves one
        // way, and the sections below it stay out of view.
        /^(section#dashboard-section|div\.home-dashboard-card)[^ ]* entering view$/
    ],
    filmPage: [
        // Harmless: the loader's top margin collapses through this empty
        // container, so the box moves 30px and back while nothing visible does.
        /^div\.movie-details-page-container moved$/
    ]
};

function unexplainedJumps(report, page) {
    return report.shifts.jumps.filter(jump => !EXPLAINED_LOAD_JUMPS[page].some(known => known.test(jump.what)));
}

async function loadedImagesIn(locator) {
    await expect.poll(() => locator.evaluate(root => [...root.querySelectorAll('img')]
        .every(image => image.complete && image.naturalWidth > 0))).toBe(true);
}

for (const theme of THEMES) {
    test(`home, film page and rating in the ${theme} theme`, async ({ page, extension, motion }) => {
        await setTheme(page, theme);

        await test.step('home opens with every section filled', async () => {
            const report = await motion.pageLoad('home-load', theme, async () => {
                await page.goto(extension.url('src/pages/home/home.html'));
                await expect(page.locator(firstCard)).toHaveCount(SECTIONS.films.length);
                await waitForStillness(page);
            });
            expect.soft(unexplainedJumps(report, 'home')).toEqual([]);
            await expect(page.locator('html')).toHaveClass(new RegExp(`${theme}-theme`));
            await expect(page).toHaveScreenshot(`home-${theme}.png`);
        });

        await test.step('film card reacts to hover', async () => {
            const card = page.locator(firstCard).first();
            await card.scrollIntoViewIfNeeded();
            await waitForStillness(page);
            await loadedImagesIn(card);
            const report = await motion.record('card-hover', theme, { card: firstCard }, () => card.hover());
            expect.soft(report.problems).toEqual([]);
            expect.soft(report.layoutAnimations).toEqual([]);
            expect.soft(report.shifts.score).toBeLessThanOrEqual(0.01);
        });

        await test.step('clicking the card opens that film', async () => {
            const report = await motion.pageLoad('film-page-load', theme, async () => {
                await page.locator(`${firstCard} [data-action="view-details"]`).first().click();
                await expect(page).toHaveURL(new RegExp(`movieId=${kinopoiskIdFor(firstFilm.id)}`));
                await expect(page.locator('h1.movie-detail-page-title')).toHaveText(firstFilm.title);
                await expect(page.locator('.rate-movie-btn')).toBeVisible();
                await waitForStillness(page);
            });
            expect.soft(unexplainedJumps(report, 'filmPage')).toEqual([]);
            // Recommendations give up after a few seconds without the live
            // Kinopoisk site; the screenshot needs that final state.
            await expect(page.locator('.movie-recommendations-skeleton-card')).toHaveCount(0);
            await waitForStillness(page);
            await expect(page).toHaveScreenshot(`film-page-${theme}.png`);
        });

        await test.step('rating dialog opens without jumping', async () => {
            const report = await motion.record('rating-open', theme, {
                dialog: '#ratingModal .rating-modal-redesign',
                backdrop: '#ratingModal'
            }, async () => {
                await page.locator('.rate-movie-btn').click();
                await expect(page.locator('#ratingModal')).toBeVisible();
            });
            expect.soft(report.problems).toEqual([]);
            expect.soft(report.layoutAnimations).toEqual([]);
            expect.soft(report.shifts.score).toBeLessThanOrEqual(0.01);
            await expect(page.locator('.star-rating-btn')).toHaveCount(10);
            await expect(page.locator('#ratingModal')).toHaveScreenshot(`rating-dialog-${theme}.png`);
        });

        await test.step('Escape closes the dialog and returns focus', async () => {
            await page.keyboard.press('Escape');
            await expect(page.locator('#ratingModal')).toBeHidden();
            await expect(page.locator('.rate-movie-btn')).toBeFocused();
            await page.locator('.rate-movie-btn').click();
            await expect(page.locator('#ratingModal')).toBeVisible();
            await page.waitForTimeout(300);
        });

        await test.step('a rating is saved through the real security rules', async () => {
            await page.locator('.star-rating-btn[data-rating="8"]').click();
            await expect(page.locator('.star-rating-btn[data-rating="8"]')).toHaveAttribute('aria-pressed', 'true');
            const report = await motion.record('rating-save', theme, { dialog: '#ratingModal .rating-modal-redesign' }, async () => {
                await page.locator('#saveRatingBtn').click();
                await expect(page.locator('#ratingModal')).toBeHidden();
            });
            expect.soft(report.problems).toEqual([]);
            await expect.poll(() => emulator.listDocuments('ratings')).toEqual([
                expect.objectContaining({ rating: 8, userId: extension.user.uid, movieId: kinopoiskIdFor(firstFilm.id) })
            ]);
        });
    });
}
