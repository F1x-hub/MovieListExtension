/**
 * The controls a viewer uses, checked on the real stream: a press must change what
 * the video does, not just the icon. KinoGo plays inside a provider frame and Rutube
 * in the extension's own page, so they cover the two ways the player is built.
 */
const { test, expect, wait } = require('./viewer.cjs');
const { FILM } = require('./films.cjs');

const soft = expect.soft;
const SOURCES = [
    { name: 'KinoGo', value: 'parser:kinogo' },
    { name: 'Rutube', value: 'parser:rutube' }
];

/** @returns {Promise<boolean>} Whether this source shows the film today. */
async function startOn(viewer, wanted) {
    await viewer.open(FILM);
    const first = await viewer.checkSource(FILM, { filmstrip: false, watchSeconds: 3 });
    if (first.value === wanted && first.outcome === 'plays') return true;
    const source = (await viewer.sources()).find(candidate => candidate.value === wanted);
    if (!source) return false;
    return (await viewer.checkSource(FILM, { source, filmstrip: false, watchSeconds: 3 })).outcome === 'plays';
}

/** Waits for the time to move past a point: proof that the video is really running. */
async function expectRunning(viewer, what, { from, by = 1.5, timeout = 30000 } = {}) {
    const start = from ?? (await viewer.mainVideo()).currentTime;
    const startedAt = Date.now();
    await expect.poll(async () => {
        const video = await viewer.mainVideo();
        return video && !video.paused && video.currentTime >= start + by;
    }, { message: what, timeout, intervals: [250] }).toBe(true);
    return (Date.now() - startedAt) / 1000;
}

for (const { name, value } of SOURCES) {
    test(`${name}: the controls change what the video does`, async ({ viewer, page }) => {
        test.skip(!await startOn(viewer, value), `${name} does not show this film today`);
        const frame = await viewer.controlsFrame();
        expect(frame, 'the player has its controls').not.toBeNull();
        const control = selector => frame.locator(selector).first();
        const press = async selector => {
            await viewer.showControls();
            await control(selector).click();
        };
        const video = () => viewer.mainVideo();

        await test.step('pause stops the picture, play resumes it', async () => {
            await press('.player-control-button--primary');
            await expect.poll(async () => (await video()).paused, { message: 'pause', intervals: [100] }).toBe(true);
            const stoppedAt = (await video()).currentTime;
            await wait(2000);
            soft(Math.abs((await video()).currentTime - stoppedAt), 'time stands still while paused').toBeLessThan(0.3);
            await viewer.shot(`${name}-paused`);
            await press('.player-control-button--primary');
            await expectRunning(viewer, 'playback resumes after a press', { from: stoppedAt });
        });

        await test.step('the timeline jumps to the place pressed', async () => {
            await viewer.showControls();
            const track = await control('.player-progress-track').boundingBox();
            await page.mouse.click(track.x + track.width * 0.5, track.y + track.height / 2);
            const { duration } = await video();
            await expect.poll(async () => Math.abs((await video()).currentTime - duration * 0.5),
                { message: 'the middle of the film', intervals: [100], timeout: 10000 }).toBeLessThan(duration * 0.03);
            const seconds = await expectRunning(viewer, 'playback goes on from the new place', { from: duration * 0.47, by: duration * 0.03 + 1, timeout: 45000 });
            console.log(`[player] ${name}: picture back ${seconds.toFixed(1)} s after a jump to the middle`);
            await viewer.showControls();
            soft(await control('.player-timecode').textContent(), 'the time shown follows the jump').toMatch(/^1:2\d:\d\d/);
            await viewer.shot(`${name}-after-seek`);
        });

        await test.step('keys work once the player has been used', async () => {
            const before = (await video()).currentTime;
            await page.keyboard.press('l');
            await expect.poll(async () => (await video()).currentTime, { message: 'L jumps ahead', intervals: [100], timeout: 8000 }).toBeGreaterThan(before + 7);
            await page.keyboard.press('k');
            await expect.poll(async () => (await video()).paused, { message: 'K pauses', intervals: [100] }).toBe(true);
            await page.keyboard.press('k');
            await expect.poll(async () => (await video()).paused, { message: 'K resumes', intervals: [100] }).toBe(false);
        });

        await test.step('volume mutes and comes back', async () => {
            const silent = async () => { const { muted, volume } = await video(); return muted || volume === 0; };
            expect(await silent(), 'starts with sound').toBe(false);
            await press('.mre-volume-button');
            await expect.poll(silent, { message: 'mute', intervals: [100] }).toBe(true);
            await press('.mre-volume-button');
            await expect.poll(silent, { message: 'unmute', intervals: [100] }).toBe(false);
        });

        await test.step('the settings menu opens and Esc closes only the menu', async () => {
            await press('.player-settings-button');
            const menu = control('.player-settings-menu');
            await expect(menu).toBeVisible();
            console.log(`[player] ${name} settings: ${(await menu.innerText()).replace(/\s+/g, ' ').slice(0, 160)}`);
            await viewer.shot(`${name}-settings`);
            await page.keyboard.press('Escape');
            await expect(menu).toBeHidden();
            await expect(page.locator('#videoPlayerModal'), 'the player stays open').toBeVisible();
        });

        await test.step('full screen fills the screen and comes back', async () => {
            await press('.mre-fullscreen-button');
            await expect.poll(() => frame.evaluate(() => Boolean(document.fullscreenElement)), { message: 'full screen', intervals: [100] }).toBe(true);
            await wait(500);
            await viewer.showControls();
            const box = await viewer.videoArea.boundingBox();
            const size = page.viewportSize();
            console.log(`[player] ${name} full screen: player ${Math.round(box.width)}×${Math.round(box.height)} in ${size.width}×${size.height}`);
            await viewer.shot(`${name}-fullscreen`);
            await press('.mre-fullscreen-button');
            await expect.poll(() => frame.evaluate(() => Boolean(document.fullscreenElement)), { message: 'leaves full screen', intervals: [100] }).toBe(false);
        });

        await test.step('minimising pauses, and restoring returns to the same place', async () => {
            await page.locator('#minimizeVideoBtn').click();
            await expect(page.locator('#videoPlayerModal')).toHaveClass(/minimized-overlay/);
            await expect.poll(async () => (await viewer.allPlaying()).length, { message: 'nothing plays while minimised', intervals: [200] }).toBe(0);
            await viewer.shot(`${name}-minimised`);
            const longest = videos => videos.sort((a, b) => b.duration - a.duration)[0];
            const position = longest(await viewer.everyVideo()).currentTime;
            await page.locator('#restorePlayerMainBtn').click();
            await expect(page.locator('#videoPlayerModal')).not.toHaveClass(/minimized-overlay/);
            await expect.poll(video, { message: 'the video is back on screen', intervals: [100] }).not.toBeNull();
            const after = await video();
            soft(Math.abs(after.currentTime - position), 'the same place after restoring').toBeLessThan(3);
            if (after.paused) await press('.player-control-button--primary');
            await expectRunning(viewer, 'playback goes on after restoring', { from: position });
        });

        await test.step('closing stops every picture, and nothing keeps playing', async () => {
            await page.locator('#closeVideoBtn').click();
            await expect(page.locator('#videoPlayerModal')).toBeHidden();
            await expect.poll(async () => (await viewer.allPlaying()).length, { message: 'nothing plays after closing', intervals: [200] }).toBe(0);
            await wait(2000);
            soft((await viewer.allPlaying()).length, 'nothing starts by itself afterwards').toBe(0);
            await viewer.shot(`${name}-closed`);
        });
    });
}
