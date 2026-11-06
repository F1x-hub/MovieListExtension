/**
 * A placeholder only prevents jumps if it is exactly as tall as what replaces
 * it. Layout comes from the real page and stylesheets, so this catches a later
 * change to the card that the placeholder does not follow.
 *
 * The gap is compared rather than two rounded heights, which disagree by 1px
 * whenever they fall either side of .5, however close they are. The limit is well
 * under a pixel because the gap repeats on every row of a grid.
 */
const { test, expect, waitForStillness } = require('../lib/fixtures.cjs');

const WIDTHS = [1440, 1100, 800, 500];
const MAX_GAP_PX = 0.1;
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

function expectSameHeight(label, placeholder, real) {
    expect.soft(Math.abs(placeholder - real), `${label}: placeholder ${placeholder}px, real ${real}px`).toBeLessThan(MAX_GAP_PX);
}

test('placeholders hold the height of what replaces them', async ({ page, extension }) => {
    await page.goto(extension.url('src/pages/home/home.html'));
    await expect(page.locator('#films-grid .movie-card-component')).toHaveCount(12);
    await waitForStillness(page);

    for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        const heights = await page.evaluate(movies => {
            const { renderer, dashboardSection: section, categoryElements } = globalThis.homePage;
            const height = element => element.getBoundingClientRect().height;

            renderer.renderDashboardSkeleton(section);
            const dashboardPlaceholder = height(section);
            renderer.renderDashboard({ isAuthenticated: true, stats: null, communityTop: movies }, section);
            const dashboard = height(section);

            const grid = categoryElements.filmsGrid;
            const realCard = grid.querySelector('.movie-card-component');
            const card = height(realCard);
            const poster = height(realCard.querySelector('.mc-poster-container'));
            const kept = [...grid.children];
            renderer.renderGridSkeleton(grid, 1);
            const placeholder = grid.querySelector('.home-skeleton-card');
            const cardPlaceholder = height(placeholder);
            const posterPlaceholder = height(placeholder.querySelector('.home-skeleton-poster'));
            grid.replaceChildren(...kept);
            grid.removeAttribute('aria-busy');
            return { dashboardPlaceholder, dashboard, cardPlaceholder, card, posterPlaceholder, poster };
        }, picks);
        expectSameHeight(`dashboard at ${width}px`, heights.dashboardPlaceholder, heights.dashboard);
        expectSameHeight(`card at ${width}px`, heights.cardPlaceholder, heights.card);
        // Whole cards can agree at 100% by compensating for a poster of another
        // size, and part ways on a scaled display. Only the poster shows it here.
        expectSameHeight(`poster at ${width}px`, heights.posterPlaceholder, heights.poster);
    }
});
