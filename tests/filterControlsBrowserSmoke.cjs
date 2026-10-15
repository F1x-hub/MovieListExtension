const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mimeTypes = {
    '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp'
};

async function main() {
    const server = http.createServer((request, response) => {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const filePath = path.resolve(root, `.${pathname}`);
        const relative = path.relative(root, filePath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            response.writeHead(403).end();
            return;
        }
        fs.readFile(filePath, (error, data) => {
            if (error) {
                response.writeHead(404).end();
                return;
            }
            response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            response.end(data);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.request().url().startsWith(baseUrl) ? route.continue() : route.abort());
        await page.addInitScript(() => {
            const listeners = { addListener() {}, removeListener() {} };
            const local = {
                get(keys, callback) {
                    const data = {};
                    if (Array.isArray(keys)) keys.forEach(key => { data[key] = undefined; });
                    else if (typeof keys === 'string') data[keys] = undefined;
                    callback?.(data);
                    return Promise.resolve(data);
                },
                set(data, callback) { callback?.(); return Promise.resolve(); },
                remove(keys, callback) { callback?.(); return Promise.resolve(); }
            };
            Object.defineProperty(window, 'chrome', {
                configurable: true,
                value: {
                    runtime: {
                        getURL: file => new URL(file, location.origin + '/').href,
                        sendMessage: (message, callback) => { callback?.({}); return Promise.resolve({}); },
                        onMessage: listeners
                    },
                    storage: { local, sync: local, onChanged: listeners },
                    tabs: { create() {}, query: async () => [], update() {}, sendMessage: async () => ({}) },
                    sidePanel: { open: async () => {} }
                }
            });
            window.firebaseManager = {
                waitForAuthReady: async () => {},
                isAuthenticated: () => true,
                getCurrentUser: () => ({ uid: 'fixture-user', displayName: 'Fixture' }),
                onAuthStateChanged() {}
            };
        });

        await page.goto(`${baseUrl}/src/pages/random/random.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.locator('#configHeader').click();
        await page.locator('.filter-range__fields input[type="number"]').first().waitFor({ timeout: 10000 });
        await page.locator('.filter-range__fields .number-stepper__button').first().waitFor({ timeout: 10000 });

        const numericNames = await page.locator('.filter-range__fields input[type="number"]').evaluateAll(inputs => inputs.slice(0, 6).map(input => input.getAttribute('aria-label')));
        assert.deepEqual(numericNames, ['Year Range: Min', 'Year Range: Max', 'Rating (Kinopoisk): Min', 'Rating (Kinopoisk): Max', 'Votes Count: Min', 'Votes Count: Max']);

        await page.locator('#yearFrom').focus();
        await page.keyboard.press('Tab');
        let focus = await page.evaluate(() => {
            const input = document.activeElement;
            const inputStyle = getComputedStyle(input);
            return {
                id: input?.id,
                visible: input?.matches(':focus-visible'),
                targetSize: inputStyle.getPropertyValue('--filter-slider-thumb-size').trim(),
                inputOutline: inputStyle.outlineStyle,
                inputFilter: inputStyle.filter
            };
        });
        assert.equal(focus.id, 'yearTo', 'Tab advances between paired bounds');
        assert.equal(focus.visible, true);
        assert.equal(focus.targetSize, '24px', 'Slider thumb provides the minimum target size');
        assert.equal(focus.inputOutline, 'solid', 'Chromium shows the keyboard focus ring on the slider');
        assert.notEqual(focus.inputFilter, 'none', 'The focused thumb is highlighted');
        await page.keyboard.press('Shift+Tab');
        focus = await page.evaluate(() => {
            const input = document.activeElement;
            const style = getComputedStyle(input);
            return { id: input?.id, visible: input?.matches(':focus-visible'), outline: style.outlineStyle, targetSize: style.getPropertyValue('--filter-slider-thumb-size').trim() };
        });
        assert.equal(focus.id, 'yearFrom');
        assert.equal(focus.visible, true);
        assert.equal(focus.outline, 'solid');
        assert.equal(focus.targetSize, '24px');

        await page.evaluate(() => document.activeElement?.blur());
        await page.locator('#yearFrom').scrollIntoViewIfNeeded();
        const initial = await page.locator('#yearFrom').inputValue();
        const pointerTarget = await page.locator('#yearFrom').evaluate(input => {
            const rect = input.getBoundingClientRect();
            const thumbWidth = Number.parseFloat(getComputedStyle(input).getPropertyValue('--filter-slider-thumb-size')) || 24;
            const ratio = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
            return { x: rect.left + thumbWidth / 2 + ratio * (rect.width - thumbWidth) + 11, y: rect.top + rect.height / 2 };
        });
        await page.mouse.move(pointerTarget.x, pointerTarget.y);
        await page.mouse.down();
        await page.mouse.move(pointerTarget.x + 30, pointerTarget.y);
        await page.mouse.up();
        assert.notEqual(await page.locator('#yearFrom').inputValue(), initial, 'Pointer drag works from the edge of the 24px target');

        const yearTo = page.locator('#yearTo');
        const upperInitial = await yearTo.inputValue();
        const touchTarget = await yearTo.evaluate(input => {
            const rect = input.getBoundingClientRect();
            const thumbWidth = Number.parseFloat(getComputedStyle(input).getPropertyValue('--filter-slider-thumb-size')) || 24;
            const ratio = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
            return { x: rect.left + thumbWidth / 2 + ratio * (rect.width - thumbWidth) - 11, y: rect.top + rect.height / 2 };
        });
        const touchClient = await page.context().newCDPSession(page);
        await touchClient.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchTarget.x, y: touchTarget.y, id: 1 }] });
        await touchClient.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchTarget.x - 30, y: touchTarget.y, id: 1 }] });
        await touchClient.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.notEqual(await yearTo.inputValue(), upperInitial, 'Touch drag works from the edge of the 24px target');

        const overlapResult = await page.evaluate(() => {
            const setRange = (input, value) => {
                input.value = String(value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            };
            const rangePoint = (input, edge) => {
                const rect = input.getBoundingClientRect();
                const min = Number(input.min);
                const max = Number(input.max);
                const value = Number(input.value);
                const thumbWidth = Number.parseFloat(getComputedStyle(input).getPropertyValue('--filter-slider-thumb-size')) || 24;
                const center = rect.left + thumbWidth / 2 + ((value - min) / (max - min)) * (rect.width - thumbWidth);
                return { x: center + edge, y: rect.top + rect.height / 2 };
            };
            const lower = document.getElementById('ratingFrom');
            const upper = document.getElementById('ratingTo');
            setRange(lower, 7);
            setRange(upper, 7.5);
            const lowerBefore = Number(lower.value);
            const upperBefore = Number(upper.value);
            return { lowerPoint: rangePoint(lower, -11), upperPoint: rangePoint(upper, 11), lowerBefore, upperBefore };
        });
        await page.mouse.move(overlapResult.lowerPoint.x, overlapResult.lowerPoint.y);
        await page.mouse.down();
        await page.mouse.move(overlapResult.lowerPoint.x - 30, overlapResult.lowerPoint.y);
        await page.mouse.up();
        const afterLowerHit = await page.evaluate(() => ({ lower: Number(document.getElementById('ratingFrom').value), upper: Number(document.getElementById('ratingTo').value) }));
        assert.ok(afterLowerHit.lower < overlapResult.lowerBefore, 'The lower handle remains reachable at the minimum range gap');
        assert.equal(afterLowerHit.upper, overlapResult.upperBefore);
        const upperPoint = await page.locator('#ratingTo').evaluate(input => {
            const rect = input.getBoundingClientRect();
            const min = Number(input.min);
            const max = Number(input.max);
            const value = Number(input.value);
            const thumbWidth = Number.parseFloat(getComputedStyle(input).getPropertyValue('--filter-slider-thumb-size')) || 24;
            const center = rect.left + thumbWidth / 2 + ((value - min) / (max - min)) * (rect.width - thumbWidth);
            return { x: center + 11, y: rect.top + rect.height / 2 };
        });
        await touchClient.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: upperPoint.x, y: upperPoint.y, id: 2 }] });
        await touchClient.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: upperPoint.x + 30, y: upperPoint.y, id: 2 }] });
        await touchClient.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const afterUpperHit = await page.evaluate(() => ({ lower: Number(document.getElementById('ratingFrom').value), upper: Number(document.getElementById('ratingTo').value) }));
        assert.equal(afterUpperHit.lower, afterLowerHit.lower);
        assert.ok(afterUpperHit.upper > afterLowerHit.upper, 'The upper handle remains reachable by touch while the handles overlap');
        assert.ok(afterUpperHit.upper - afterUpperHit.lower >= 0.5, 'The configured minimum range gap is preserved');
        assert.deepEqual(errors, [], `Page errors: ${errors.join('; ')}`);
        console.log('Filter controls Chromium smoke passed: paired keyboard focus, contextual names and pointer/touch hit targets at the minimum range gap.');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
