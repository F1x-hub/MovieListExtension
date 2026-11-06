/**
 * A guest's invitation on Home holds a long unbreakable button label beside its
 * text. Below 640px they cannot share a row, so the button goes under the text;
 * from 640px up the card must keep the row it has always had.
 */
const { test, expect, storeTheme, waitForStillness } = require('../lib/fixtures.cjs');

const HOME = 'src/pages/home/home.html';
const STACKED_WIDTHS = [320, 375, 420, 480, 560, 639];
const ROW_WIDTHS = [640, 800, 1100, 1440];
// Browsers report fractions of a pixel; a whole one is a real overflow.
const TOLERANCE_PX = 0.5;

test.use({ startSignedIn: false });

const measure = page => page.evaluate(() => {
    const box = selector => {
        const { left, right, top, bottom } = document.querySelector(selector).getBoundingClientRect();
        return { left, right, top, bottom };
    };
    const root = document.documentElement;
    const button = document.querySelector('.home-cta-btn');
    return {
        card: box('.home-cta-card'),
        content: box('.home-cta-content'),
        button: box('.home-cta-btn'),
        labelClipped: button.scrollWidth > button.clientWidth,
        pageOverflow: Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth
    };
});

function expectEverythingInside(layout, width) {
    const { card, content, button } = layout;
    expect.soft(button.left, `${width}px: button's left edge inside the card`).toBeGreaterThanOrEqual(card.left - TOLERANCE_PX);
    expect.soft(button.right, `${width}px: button's right edge inside the card`).toBeLessThanOrEqual(card.right + TOLERANCE_PX);
    expect.soft(content.right, `${width}px: text inside the card`).toBeLessThanOrEqual(card.right + TOLERANCE_PX);
    expect.soft(layout.labelClipped, `${width}px: whole label visible`).toBe(false);
    expect.soft(layout.pageOverflow, `${width}px: no sideways scroll`).toBeLessThanOrEqual(0);
}

for (const theme of ['dark', 'light']) {
    test(`a guest's invitation fits the window, ${theme} theme`, async ({ page, extension }, testInfo) => {
        await page.goto(extension.url(HOME));
        await storeTheme(page, theme);
        await page.reload();
        const card = page.locator('.home-cta-card');
        await expect(page.locator('#homeSignInBtn')).toBeVisible();
        await waitForStillness(page);

        // For a person to look at: the card alone, then the window around it.
        const look = async width => {
            const shots = [['card', card], ['window', page]];
            for (const [name, target] of shots) {
                const file = `guest-${name}-${theme}-${width}.png`;
                await target.screenshot({ path: testInfo.outputPath(file), animations: 'disabled' });
                await testInfo.attach(file, { path: testInfo.outputPath(file), contentType: 'image/png' });
            }
        };

        for (const width of STACKED_WIDTHS) {
            await page.setViewportSize({ width, height: 900 });
            const layout = await measure(page);
            expectEverythingInside(layout, width);
            expect.soft(layout.button.top, `${width}px: button under the text`).toBeGreaterThanOrEqual(layout.content.bottom);
            expect.soft(layout.button.right - layout.button.left, `${width}px: button takes the card's width`)
                .toBeGreaterThan((layout.card.right - layout.card.left) * 0.8);
            await look(width);
        }

        for (const width of ROW_WIDTHS) {
            await page.setViewportSize({ width, height: 900 });
            const layout = await measure(page);
            expectEverythingInside(layout, width);
            expect.soft(layout.button.left, `${width}px: button beside the text`).toBeGreaterThanOrEqual(layout.content.right);
            await look(width);
        }
    });
}
