/**
 * A placeholder only prevents jumps if it is exactly as tall as what replaces
 * it. Layout comes from the real page and stylesheets, so this catches a later
 * change to the card that the placeholder does not follow.
 */
const { test, expect, waitForStillness } = require('../lib/fixtures.cjs');

const WIDTHS = [1440, 1100, 800, 500];
const picks = [1, 2, 3, 4].map(index => ({
    id: `community-${index}`,
    movieId: 6000 + index,
    kinopoiskId: 6000 + index,
    name: `Выбор ${index}`,
    year: 2026,
    type: 'movie',
    avgRating: 8.1,
    ratingsCount: 12,
    posterUrl: `https://image.tmdb.org/t/p/w342/e2e-poster-9200${index}.jpg`
}));

test('placeholders hold the height of what replaces them', async ({ page, extension }) => {
    await page.goto(extension.url('src/pages/home/home.html'));
    await expect(page.locator('#films-grid .movie-card-component')).toHaveCount(12);
    await waitForStillness(page);

    for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        const heights = await page.evaluate(movies => {
            const { renderer, dashboardSection: section, categoryElements } = globalThis.homePage;
            const height = element => Math.round(element.getBoundingClientRect().height);

            renderer.renderDashboardSkeleton(section);
            const dashboardPlaceholder = height(section);
            renderer.renderDashboard({ isAuthenticated: true, stats: null, communityTop: movies }, section);
            const dashboard = height(section);

            const grid = categoryElements.filmsGrid;
            const card = height(grid.querySelector('.movie-card-component'));
            const kept = [...grid.children];
            renderer.renderGridSkeleton(grid, 1);
            const cardPlaceholder = height(grid.querySelector('.home-skeleton-card'));
            grid.replaceChildren(...kept);
            grid.removeAttribute('aria-busy');
            return { dashboardPlaceholder, dashboard, cardPlaceholder, card };
        }, picks);
        expect.soft(heights.dashboardPlaceholder, `dashboard at ${width}px`).toBe(heights.dashboard);
        expect.soft(heights.cardPlaceholder, `card at ${width}px`).toBe(heights.card);
    }
});
