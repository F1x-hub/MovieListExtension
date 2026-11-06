/**
 * The language control sits at the bottom of its section, just above a footer that
 * stays on top of the section. The clicks here land on the coordinates an option is
 * painted at, so a covered option loses the click to whatever covers it. Playwright's
 * own click would scroll to the option first, even inside a box a person cannot scroll.
 */
const { test, expect, storeTheme, waitForStillness } = require('../lib/fixtures.cjs');

const SETTINGS = 'src/pages/settings/settings.html';
const THEMES = ['dark', 'light'];
// Below 887 the card stops shrinking and the page scrolls instead.
const WINDOW_HEIGHTS = [900, 720, 640, 480, 400];

test.use({ startSignedIn: false });

async function chooseWithMouse(page, nativeName) {
    // Scrolls the trigger into view if it has to, as a person would to reach it.
    await page.locator('#languageDropdown .dropdown-trigger').click();
    await waitForStillness(page);

    const option = page.locator('#languageDropdown .dropdown-option', { hasText: nativeName });
    const box = await option.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.locator('#languageDropdown .selected-name'), `${nativeName} did not take the click`).toHaveText(nativeName);
    await expect(page.locator('#languageDropdown .dropdown-list')).toBeHidden();
}

for (const theme of THEMES) {
    for (const height of WINDOW_HEIGHTS) {
        test(`every language can be chosen with the mouse at 1440×${height}, ${theme} theme`, async ({ page, extension }) => {
            await page.setViewportSize({ width: 1440, height });
            await page.goto(extension.url(SETTINGS));
            await storeTheme(page, theme);
            await page.reload();
            await waitForStillness(page);

            await chooseWithMouse(page, 'English');
            await chooseWithMouse(page, 'Русский');
        });
    }
}
