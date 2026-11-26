const { test, expect, setTheme, waitForStillness } = require('../lib/fixtures.cjs');
const { SECTIONS, kinopoiskIdFor } = require('../lib/catalog.cjs');

// The ambient light on the built film page. The rig reaches no provider, so the player dialog
// is shown with a local picture in #videoContainer (a canvas stream, as a video of this page
// would be); PlayerAmbientLight itself is the one the page created. Provider frames and tab
// capture are covered by tests/playerAmbientLightBrowser.test.cjs and the owner's Chrome.
const film = SECTIONS.films[0];
const CARD = '#films-grid .movie-card-component';

for (const theme of ['dark', 'light']) {
    test(`the light behind the player in the ${theme} theme`, async ({ page, extension }, testInfo) => {
        await setTheme(page, theme);
        await page.goto(extension.url('src/pages/home/home.html'));
        await expect(page.locator(CARD)).toHaveCount(SECTIONS.films.length);
        await waitForStillness(page);
        await page.locator(`${CARD} [data-action="view-details"]`).first().click();
        await expect(page).toHaveURL(new RegExp(`movieId=${kinopoiskIdFor(film.id)}`));
        await expect(page.locator('h1.movie-detail-page-title')).toHaveText(film.title);
        await expect.poll(() => page.evaluate(() => Boolean(window.movieAmbientLight))).toBe(true);
        await waitForStillness(page);

        await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 180;
            const context = canvas.getContext('2d');
            const paint = () => {
                const sky = context.createLinearGradient(0, 0, 320, 180);
                sky.addColorStop(0, '#c2552b');
                sky.addColorStop(1, '#2b1b4a');
                context.fillStyle = sky;
                context.fillRect(0, 0, 320, 180);
                requestAnimationFrame(paint);
            };
            paint();
            const video = document.createElement('video');
            video.className = 'player-surface__media';
            video.muted = true;
            video.srcObject = canvas.captureStream(20);
            const container = document.getElementById('videoContainer');
            container.replaceChildren(video);
            document.getElementById('videoPlayerModal').style.display = 'flex';
            return video.play();
        });

        const light = page.locator('#videoPlayerModal > canvas.player-ambient');
        await expect(light).toHaveClass(/is-lit/);
        const layout = await page.evaluate(() => {
            const canvas = document.querySelector('#videoPlayerModal > canvas.player-ambient');
            const stage = document.getElementById('playerStage').getBoundingClientRect();
            const box = canvas.getBoundingClientRect();
            const centre = document.elementFromPoint(stage.left + stage.width / 2, stage.top + stage.height / 2);
            const { data } = canvas.getContext('2d').getImageData(0, 0, 48, 27);
            let red = 0;
            let blue = 0;
            for (let i = 0; i < data.length; i += 4) { red += data[i]; blue += data[i + 2]; }
            return {
                around: box.left < stage.left && box.right > stage.right && box.top < stage.top && box.bottom > stage.bottom,
                behindDialog: !canvas.contains(centre),
                lit: red + blue > 0,
                status: window.movieAmbientLight.status
            };
        });
        expect(layout).toEqual({ around: true, behindDialog: true, lit: true, status: 'on' });

        // Opacity fades in over 600ms.
        await page.waitForTimeout(900);
        const file = testInfo.outputPath(`player-ambient-${theme}.png`);
        await page.screenshot({ path: file });
        await testInfo.attach(`player-ambient-${theme}`, { path: file, contentType: 'image/png' });

        await page.evaluate(() => { document.getElementById('videoPlayerModal').style.display = 'none'; });
    });
}
