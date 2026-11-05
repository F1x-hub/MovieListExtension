/**
 * Captures the frames Chromium actually paints and lays them out on one image,
 * so a person (or a reviewing agent) can look at an animation without video.
 */

async function startFilmstrip(page) {
    const cdp = await page.context().newCDPSession(page);
    const frames = [];
    let acknowledging = true;
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        frames.push({ data, timestamp: metadata.timestamp });
        if (acknowledging) cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: 720, maxHeight: 450, everyNthFrame: 1 });
    return {
        async stop() {
            acknowledging = false;
            await cdp.send('Page.stopScreencast').catch(() => {});
            await cdp.detach().catch(() => {});
            return frames;
        }
    };
}

function pickEvenly(frames, count) {
    if (frames.length <= count) return frames;
    return Array.from({ length: count }, (_, index) => frames[Math.round(index * (frames.length - 1) / (count - 1))]);
}

/** @returns {Promise<Buffer|null>} A PNG contact sheet, or null with no frames. */
async function renderFilmstrip(context, frames, { title = '', columns = 4, maxFrames = 12 } = {}) {
    if (!frames.length) return null;
    const start = frames[0].timestamp;
    const cells = pickEvenly(frames, maxFrames).map(frame => `
        <figure>
            <img src="data:image/jpeg;base64,${frame.data}">
            <figcaption>${Math.round((frame.timestamp - start) * 1000)} ms</figcaption>
        </figure>`).join('');
    const sheet = await context.newPage();
    try {
        await sheet.setContent(`<!doctype html><style>
            body { margin: 0; padding: 16px; background: #111; color: #eee; font: 14px system-ui, sans-serif; }
            h1 { margin: 0 0 12px; font-size: 16px; font-weight: 600; }
            main { display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: 10px; }
            figure { margin: 0; }
            img { display: block; width: 100%; border: 1px solid #333; }
            figcaption { padding-top: 4px; color: #aaa; }
        </style><h1>${title} · ${frames.length} painted frames</h1><main>${cells}</main>`);
        await sheet.evaluate(() => Promise.all([...document.images].map(image => image.decode().catch(() => {}))));
        return await sheet.screenshot({ fullPage: true });
    } finally {
        await sheet.close();
    }
}

/** Average brightness (0-1) of each painted frame, read back from the JPEGs. */
async function measureBrightness(context, frames) {
    if (!frames.length) return [];
    const start = frames[0].timestamp;
    const sampled = pickEvenly(frames, 120);
    const probe = await context.newPage();
    try {
        const values = await probe.evaluate(async images => {
            const canvas = new OffscreenCanvas(32, 20);
            const draw = canvas.getContext('2d', { willReadFrequently: true });
            const results = [];
            for (const data of images) {
                const blob = await (await fetch(`data:image/jpeg;base64,${data}`)).blob();
                draw.drawImage(await createImageBitmap(blob), 0, 0, 32, 20);
                const pixels = draw.getImageData(0, 0, 32, 20).data;
                let sum = 0;
                for (let i = 0; i < pixels.length; i += 4) {
                    sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
                }
                results.push(sum / (pixels.length / 4) / 255);
            }
            return results;
        }, sampled.map(frame => frame.data));
        return values.map((value, index) => ({
            atMs: Math.round((sampled[index].timestamp - start) * 1000),
            value: Math.round(value * 1000) / 1000
        }));
    } finally {
        await probe.close();
    }
}

module.exports = { startFilmstrip, renderFilmstrip, measureBrightness };
