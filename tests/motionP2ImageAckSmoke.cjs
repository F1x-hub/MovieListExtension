const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pixel = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/%3E';

async function main() {
    const server = http.createServer((_request, response) => { response.end('<div id="grid"></div>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        const url = `http://127.0.0.1:${server.address().port}`;
        const page = await context.newPage();
        await page.goto(url);
        await page.evaluate(() => {
            const NativeObserver = MutationObserver;
            window.observerCount = 0;
            window.MutationObserver = class extends NativeObserver {
                constructor(callback) { super(callback); window.observerCount++; }
            };
        });
        await page.addScriptTag({ content: read('src/shared/utils/Utils.js') });
        const stats = await page.evaluate(pixel => {
            window.observerCount = 0; // Exclude Playwright's script insertion observer.
            const start = performance.now();
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < 1000; i++) {
                const card = document.createElement('div');
                const image = document.createElement('img');
                image.src = pixel;
                card.append(image);
                Utils.bindImageReveal(card);
                fragment.append(card);
            }
            document.querySelector('#grid').append(fragment);
            return { observers: observerCount, setupMs: performance.now() - start };
        }, pixel);
        assert.equal(stats.observers, 1, '1000 detached MovieCard registrations share one page observer');
        await page.waitForFunction(() => [...document.images].every(img => img.dataset.motionImage === 'ready'));
        await page.evaluate(pixel => {
            const card = document.querySelector('#grid').firstElementChild;
            const image = document.createElement('img');
            image.id = 'inserted'; image.src = pixel;
            card.append(image);
        }, pixel);
        await page.waitForFunction(() => document.querySelector('#inserted').dataset.motionImage === 'ready');
        await page.evaluate(() => {
            const img = document.createElement('img');
            img.id = 'removed';
            Object.defineProperty(img, 'complete', { value: false });
            document.querySelector('#grid').firstElementChild.append(img);
        });
        await page.evaluate(() => {
            window.removedImage = document.querySelector('#removed');
            removedImage.remove();
            removedImage.dispatchEvent(new Event('load'));
        });
        assert.equal(await page.evaluate(() => removedImage.dataset.motionImage), 'pending', 'detached late load cannot reveal a removed image');
        await page.evaluate(() => {
            const img = document.images[0];
            img.decode = () => new Promise(resolve => { window.oldDecode = resolve; });
            img.dispatchEvent(new Event('load'));
        });
        await page.evaluate(() => {
            document.images[0].src = 'https://fixture.invalid/new-source.svg';
            oldDecode();
        });
        // A failed source terminates reveal without inserting any generic artwork.
        await page.waitForFunction(() => document.images[0].dataset.motionImage === 'ready');
        assert.equal(await page.evaluate(() => document.images[0].getAttribute('src')), 'https://fixture.invalid/new-source.svg');

        let state = { seenVersion: '1.3.5' }, releaseWrite, writeStarted = false, failWrite = false;
        await context.exposeBinding('readAck', () => ({ whatsNewV1: state }));
        await context.exposeBinding('writeAck', async (_source, patch) => {
            writeStarted = true;
            await new Promise(resolve => { releaseWrite = resolve; });
            if (failWrite) throw new Error('fixture storage failure');
            state = patch.whatsNewV1;
        });
        const second = await context.newPage();
        await second.goto(url);
        for (const tab of [page, second]) {
            await tab.addScriptTag({ content: read('src/shared/services/WhatsNewService.js') });
            await tab.evaluate(() => {
                window.service = new WhatsNewService({ storage: { get: () => readAck(), set: patch => writeAck(patch) },
                    version: '1.3.6', entries: [{ version: '1.3.6', highlights: [{}] }] });
            });
        }
        await page.evaluate(() => { window.saving = service.acknowledge(); });
        while (!writeStarted) await new Promise(resolve => setTimeout(resolve, 5));
        await second.evaluate(() => { window.selection = null; window.opening = service.pending().then(value => { selection = value; }); });
        await second.waitForTimeout(40);
        assert.equal(await second.evaluate(() => selection), null, 'another tab waits for acknowledgement persistence');
        releaseWrite();
        await page.evaluate(() => saving);
        assert.equal(await second.evaluate(async () => { await opening; return selection.entries.length; }), 0);
        // A rejected write releases the lock and allows a later legitimate announcement.
        state = { seenVersion: '1.3.5' }; writeStarted = false; failWrite = true;
        await page.evaluate(() => { window.saving = service.acknowledge().catch(() => {}); });
        while (!writeStarted) await new Promise(resolve => setTimeout(resolve, 5));
        releaseWrite(); await page.evaluate(() => saving);
        assert.equal(await second.evaluate(async () => (await service.pending()).entries.length), 1);
        console.log(`Motion P2 image/ack Chromium smoke passed: 1000 cards / ${stats.observers} observer / setup ${stats.setupMs.toFixed(1)}ms; owner fallback, cross-tab delayed ack and rejected-write recovery`);
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
