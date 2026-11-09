// Real-browser check of the GIF -> animated WebP conversion: the frames are
// decoded and encoded by Chromium itself, so only a browser can prove the file
// that comes out is one a browser plays.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mimeTypes = { '.js': 'text/javascript', '.gif': 'image/gif' };

async function main() {
    const server = http.createServer((request, response) => {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (pathname === '/blank.html') {
            response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>animated WebP</title>');
            return;
        }
        const filePath = path.resolve(root, `.${pathname}`);
        const relative = path.relative(root, filePath);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !mimeTypes[path.extname(filePath)]) {
            response.writeHead(403).end();
            return;
        }
        fs.readFile(filePath, (error, data) => {
            if (error) { response.writeHead(404).end(); return; }
            response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)], 'Cache-Control': 'no-store' });
            response.end(data);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.request().url().startsWith(baseUrl) ? route.continue() : route.abort());
        await page.goto(`${baseUrl}/blank.html`);

        const result = await page.evaluate(async () => {
            const lib = await import('/src/shared/utils/animatedWebp.js');
            const load = async (name) => {
                const blob = await (await fetch(`/tests/fixtures/animated-images/${name}`)).blob();
                return new File([blob], name, { type: 'image/gif' });
            };
            // Decodes any animated image into per-frame facts and colour samples. A
            // sample is the mean of a `block`-sized square: lossy frames keep areas,
            // not single pixels on an edge.
            const inspect = async (bytes, type, points, block = 1) => {
                const decoder = new ImageDecoder({ data: bytes, type });
                await decoder.tracks.ready;
                await decoder.completed;
                const track = decoder.tracks.selectedTrack;
                const frames = [];
                for (let index = 0; index < track.frameCount; index += 1) {
                    const { image } = await decoder.decode({ frameIndex: index });
                    const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight);
                    const context = canvas.getContext('2d', { willReadFrequently: true });
                    context.drawImage(image, 0, 0);
                    frames.push({
                        width: image.displayWidth,
                        height: image.displayHeight,
                        duration: image.duration,
                        pixels: points.map(([x, y]) => {
                            const { data } = context.getImageData(
                                Math.floor(x * (image.displayWidth - block)), Math.floor(y * (image.displayHeight - block)), block, block
                            );
                            const mean = [0, 0, 0, 0];
                            data.forEach((value, index) => { mean[index % 4] += value / (block * block); });
                            return mean.map(Math.round);
                        })
                    });
                    image.close();
                }
                const facts = { animated: track.animated, repetitionCount: track.repetitionCount, frames };
                decoder.close();
                return facts;
            };
            const points = [[0.1, 0.1], [0.5, 0.5], [0.9, 0.2], [0.25, 0.8]];

            // 1. A real GIF at its own size.
            const testcard = await load('testcard-5-frames.gif');
            const source = await inspect(await testcard.arrayBuffer(), 'image/gif', points, 12);
            const sameSize = await lib.convertAnimatedImage(testcard, lib.ANIMATED_IMAGE_BOX.avatar);
            const converted = await inspect(sameSize.bytes.buffer, 'image/webp', points, 12);

            // 2. The same GIF for a smaller display box.
            const small = await lib.convertAnimatedImage(testcard, { width: 30, height: 30 });
            const smallFacts = await inspect(small.bytes.buffer, 'image/webp', []);

            // 3. An <img> plays the result.
            const image = new Image();
            const url = URL.createObjectURL(new Blob([sameSize.bytes], { type: 'image/webp' }));
            image.src = url;
            await image.decode();
            const imageSize = [image.naturalWidth, image.naturalHeight];
            URL.revokeObjectURL(url);

            // 4. Frames that do not change collapse into one still image.
            const still = await lib.convertAnimatedImage(await load('still-3-frames.gif'), lib.ANIMATED_IMAGE_BOX.avatar);
            const stillFacts = await inspect(still.bytes.buffer, 'image/webp', [[0.5, 0.5]]);

            // 5. Transparent frames: each replaces the canvas, nothing shows through.
            const drawFrame = async (x) => {
                const canvas = new OffscreenCanvas(40, 20);
                const context = canvas.getContext('2d');
                context.fillStyle = '#e02020';
                context.fillRect(x, 5, 10, 10);
                return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/webp', quality: 0.75 })).arrayBuffer());
            };
            const transparent = lib.muxAnimatedWebp([
                { data: await drawFrame(2), duration: 70 },
                { data: await drawFrame(28), duration: 130 }
            ], { width: 40, height: 20 });
            const transparentFacts = await inspect(transparent.buffer, 'image/webp', [[7 / 39, 10 / 19], [33 / 39, 10 / 19], [0.5, 0.05]]);

            // 6. Stopping, and the "only when smaller" rule.
            const stopped = await lib.convertAnimatedImage(testcard, lib.ANIMATED_IMAGE_BOX.avatar, { isCurrent: () => false });
            const sized = (size) => ({ type: 'image/gif', size, arrayBuffer: () => testcard.arrayBuffer() });
            const smaller = await lib.compressAnimatedImage(sized(10_000_000), 'banner');
            const notSmaller = await lib.compressAnimatedImage(sized(10), 'banner');

            return {
                source, converted, convertedSize: [sameSize.width, sameSize.height, sameSize.frameCount],
                small: [small.width, small.height, smallFacts.frames.length, smallFacts.frames[0].width, smallFacts.frames[0].height],
                imageSize,
                still: { frameCount: still.frameCount, decodedFrames: stillFacts.frames.length, animated: stillFacts.animated, pixel: stillFacts.frames[0].pixels[0] },
                transparent: transparentFacts,
                stopped,
                smaller: smaller && { type: smaller.type, name: smaller.name, isFile: smaller instanceof File, size: smaller.size },
                notSmaller
            };
        });

        assert.deepEqual(errors, []);

        // 1. Same frames, same pace, same picture.
        assert.equal(result.source.frames.length, 5);
        assert.deepEqual(result.convertedSize, [96, 64, 5]);
        assert.equal(result.converted.animated, true);
        assert.equal(result.converted.repetitionCount, Infinity, 'the animation loops forever');
        assert.equal(result.converted.frames.length, 5);
        assert.deepEqual(result.converted.frames.map(frame => frame.duration), result.source.frames.map(frame => frame.duration),
            'every frame keeps its duration');
        assert.deepEqual(result.converted.frames.map(frame => frame.duration), [200000, 200000, 200000, 200000, 200000]);
        for (const [index, frame] of result.converted.frames.entries()) {
            assert.deepEqual([frame.width, frame.height], [96, 64]);
            frame.pixels.forEach((pixel, point) => {
                const original = result.source.frames[index].pixels[point];
                const distance = Math.max(...pixel.map((value, channel) => Math.abs(value - original[channel])));
                assert.ok(distance <= 24, `frame ${index} point ${point}: ${pixel} is close to ${original}`);
            });
        }
        const firstAndLast = [result.converted.frames[0].pixels, result.converted.frames[4].pixels].map(value => JSON.stringify(value));
        assert.notEqual(firstAndLast[0], firstAndLast[1], 'the frames are different pictures, not one repeated');

        // 2. Scaled until it still covers the box.
        assert.deepEqual(result.small, [45, 30, 5, 45, 30]);

        // 3.
        assert.deepEqual(result.imageSize, [96, 64]);

        // 4.
        assert.deepEqual({ ...result.still, pixel: undefined }, { frameCount: 1, decodedFrames: 1, animated: false, pixel: undefined });
        const [red, green, blue, alpha] = result.still.pixel;
        assert.ok(Math.abs(red - 0x33) < 24 && Math.abs(green - 0x66) < 24 && Math.abs(blue - 0xCC) < 24 && alpha === 255,
            `the still keeps the colour: ${result.still.pixel}`);

        // 5.
        const [frameOne, frameTwo] = result.transparent.frames;
        assert.deepEqual([frameOne.duration, frameTwo.duration], [70000, 130000]);
        assert.ok(frameOne.pixels[0][3] === 255 && frameOne.pixels[0][0] > 180, 'frame 1 shows its square');
        assert.equal(frameOne.pixels[1][3], 0, 'frame 1 is transparent where frame 2 will draw');
        assert.equal(frameOne.pixels[2][3], 0, 'the background stays transparent');
        assert.ok(frameTwo.pixels[1][3] === 255 && frameTwo.pixels[1][0] > 180, 'frame 2 shows its square');
        assert.equal(frameTwo.pixels[0][3], 0, 'the square of frame 1 does not show through frame 2');

        // 6.
        assert.equal(result.stopped, null);
        assert.equal(result.smaller.type, 'image/webp');
        assert.equal(result.smaller.isFile, true);
        assert.match(result.smaller.name, /^animated-banner-\d+\.webp$/);
        assert.ok(result.smaller.size > 0);
        assert.equal(result.notSmaller, null, 'a copy that is not smaller is not used');

        console.log('animatedWebpBrowser.test.cjs passed');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
