/**
 * Profile images are uploaded as WebP. A GIF keeps its animation and is queued as
 * a smaller animated WebP; a still image is cropped and queued as a still WebP.
 * The browser does both conversions, so this runs them where users do: in the
 * profile page of the built extension. Nothing is saved, so no file storage is
 * needed, and the upload itself is not covered.
 */
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('../lib/fixtures.cjs');

const PROFILE = 'src/pages/profile/profile.html';
const GIF = path.resolve(__dirname, '../../fixtures/animated-images/gradient-6-frames.gif');
const IMAGES = [
    { name: 'avatar', input: '#photoInput', preview: '#photoPreviewImg', field: 'photoFile' },
    { name: 'banner', input: '#bannerInput', preview: '#bannerPreviewImg', field: 'bannerFile' }
];

for (const { name, input, preview, field } of IMAGES) {
    test(`a GIF ${name} is previewed and queued as an animated WebP`, async ({ page, extension }) => {
        await page.goto(extension.url(PROFILE));
        await page.locator('#headerEditBtn').click();
        await page.locator(input).setInputFiles(GIF);

        await expect(page.locator(preview)).toHaveAttribute('src', /^data:image\/webp;base64,/);
        await expect(page.locator(preview)).toBeVisible();

        const queued = await page.evaluate(async (key) => {
            const file = window.profilePageManager[key];
            const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
            await decoder.tracks.ready;
            await decoder.completed;
            const track = decoder.tracks.selectedTrack;
            const facts = { type: file.type, size: file.size, frames: track.frameCount, animated: track.animated };
            decoder.close();
            return facts;
        }, field);
        expect(queued).toEqual({ type: 'image/webp', size: expect.any(Number), frames: 6, animated: true });
        expect(queued.size).toBeLessThan(fs.statSync(GIF).size);
    });
}

test('a cropped still image is queued as WebP, whatever it was', async ({ page, extension }) => {
    const PNG = path.resolve(__dirname, '../../../src/shared/assets/icons/app/icon128-white.png');
    await page.goto(extension.url(PROFILE));
    await page.locator('#headerEditBtn').click();
    await page.locator('#photoInput').setInputFiles(PNG);

    await expect(page.locator('#cropperModal')).toBeVisible();
    // The crop frame appears once the picture has loaded into the cropper.
    await expect(page.locator('#cropperSelection')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.profilePageManager.cropperData?.w || 0)).toBeGreaterThan(0);
    await page.locator('#cropperApplyBtn').click();

    await expect(page.locator('#photoPreviewImg')).toHaveAttribute('src', /^data:image\/webp;base64,/);
    const queued = await page.evaluate(async () => {
        const file = window.profilePageManager.photoFile;
        const bitmap = await createImageBitmap(file);
        return { type: file.type, name: file.name.replace(/\d+/, 'N'), width: bitmap.width, height: bitmap.height };
    });
    expect(queued.type).toBe('image/webp');
    expect(queued.name).toBe('cropped-avatar-N.webp');
    expect(queued.width).toBe(queued.height);
    expect(queued.width).toBeLessThanOrEqual(128);
});
