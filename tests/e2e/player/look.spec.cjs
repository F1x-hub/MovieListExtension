/**
 * How the player looks around a real picture: both themes and three window sizes.
 * The picture changes from run to run, so geometry is asserted and the screenshots
 * are kept for a person to look at, rather than compared with a baseline.
 */
const { test, expect } = require('./viewer.cjs');
const { storeTheme } = require('../lib/fixtures.cjs');
const { FILM } = require('./films.cjs');

const soft = expect.soft;
const SIZES = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 640 }];
const SLACK = 1;

function inside(inner, outer) {
    return inner.x >= outer.x - SLACK && inner.y >= outer.y - SLACK
        && inner.x + inner.width <= outer.x + outer.width + SLACK
        && inner.y + inner.height <= outer.y + outer.height + SLACK;
}

async function checkGeometry(viewer, label) {
    const { page } = viewer;
    const size = page.viewportSize();
    const panel = await page.locator('#videoPlayerModal .video-modal').boundingBox();
    const area = await viewer.videoArea.boundingBox();
    soft(inside(panel, { x: 0, y: 0, ...size }), `${label}: the player fits the window`).toBe(true);
    soft(inside(area, panel), `${label}: the picture stays inside the player`).toBe(true);
    soft(area.width, `${label}: the picture uses the player's width`).toBeGreaterThan(panel.width * 0.9);

    // The frame or video fills the area; the film's own black bars are inside it.
    const media = await viewer.videoArea.locator('iframe, video').first().boundingBox();
    soft(media && inside(media, area), `${label}: the video stays inside its area`).toBe(true);
    soft(media && media.width >= area.width - 2, `${label}: the video fills its area across`).toBe(true);

    await viewer.showControls();
    const frame = await viewer.controlsFrame();
    expect(frame, `${label}: controls exist`).not.toBeNull();
    const dock = await frame.locator('.player-control-dock').first().boundingBox();
    soft(dock && inside(dock, area), `${label}: the control bar stays inside the picture`).toBe(true);
    const buttons = await frame.locator('.player-control-dock button:visible').all();
    soft(buttons.length, `${label}: the control bar has its buttons`).toBeGreaterThan(3);
    for (const button of buttons) {
        const box = await button.boundingBox();
        if (box) soft(inside(box, dock), `${label}: every button stays on the bar`).toBe(true);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    soft(overflow, `${label}: no sideways scrolling`).toBeLessThanOrEqual(0);
}

for (const theme of ['dark', 'light']) {
    test(`the player around a real picture, ${theme}`, async ({ viewer, page, extension }) => {
        await page.goto(extension.url('src/pages/home/home.html'));
        await storeTheme(page, theme);
        await viewer.open(FILM);
        await expect(page.locator('body')).toHaveClass(new RegExp(`${theme}-theme`));
        // What is measured is the player around a picture, so any working source will do.
        await viewer.playAnySource(FILM);

        for (const size of SIZES) {
            await page.setViewportSize(size);
            await viewer.showControls();
            const label = `${theme} ${size.width}×${size.height}`;
            await viewer.shot(`look-${theme}-${size.width}`);
            await checkGeometry(viewer, label);
        }
        await page.setViewportSize(SIZES[0]);
        await page.locator('#sourcePopoverToggle').click();
        await expect(page.locator('#sourcePopover')).toBeVisible();
        await viewer.shot(`look-${theme}-source-list`);

        await test.step('Esc closes the source list and leaves the film playing', async () => {
            await page.keyboard.press('Escape');
            await expect(page.locator('#sourcePopover')).toBeHidden();
            // Closing has its own animation, so an open player needs a moment to tell.
            await page.waitForTimeout(600);
            soft(await page.locator('#videoPlayerModal').isVisible(), 'the player stays open').toBe(true);
            soft((await viewer.allPlaying()).length, 'the film keeps playing').toBe(1);
        });
    });
}
