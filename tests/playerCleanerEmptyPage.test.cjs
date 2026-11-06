/**
 * A refused embed: the frame's load event fires anyway, so only the frame can say
 * that nothing came. Runs the real cleaner in a real frame with a real HTTP status.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
// The same files, in the same order, as the manifest injects them into provider frames.
const injected = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).content_scripts
    .find(entry => entry.js.includes('content-scripts/player-cleaner.js')).js
    .map(file => fs.readFileSync(path.join(root, file), 'utf8'));
const LATE_CHECK_MS = 8000;
const EARLY_CHECK_MS = 750;

const CASES = [
    { name: 'an HTTP error with an empty page', status: 422, body: '', reportedBy: EARLY_CHECK_MS },
    { name: 'an empty page with no error', status: 200, body: '', reportedBy: LATE_CHECK_MS },
    { name: 'an empty page holding only scripts', status: 200, body: '<script>/* nothing shown */</script>', reportedBy: LATE_CHECK_MS },
    { name: 'an HTTP error with a page, such as a challenge', status: 403, body: '<div id="challenge">Проверка</div>', reportedBy: null },
    { name: 'a working player', status: 200, body: '<div id="player"></div>', reportedBy: null },
    { name: 'a page holding only text', status: 200, body: 'Плеер загружается', reportedBy: null }
];

async function runCase(browser, { status, body }) {
    const page = await browser.newPage();
    try {
        await page.route('http://host.test/**', route => route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><body><iframe id="frame" src="http://provider.test/embed/1"></iframe></body>'
        }));
        await page.route('http://provider.test/**', route => route.fulfill({
            status,
            contentType: 'text/html',
            body: `<!doctype html><html><head><title></title></head><body>${body}</body></html>`
        }));
        await page.goto('http://host.test/');
        await page.evaluate(() => {
            globalThis.reports = [];
            addEventListener('message', event => {
                if (event.data?.type === 'PLAYER_SOURCE_STATE') globalThis.reports.push({ at: performance.now(), ...event.data });
            });
        });
        const frame = page.frameLocator('#frame').owner();
        const handle = await (await frame.elementHandle()).contentFrame();
        await handle.evaluate(() => { globalThis.chrome = { runtime: { getURL: () => 'data:text/javascript,' } }; });
        const started = await page.evaluate(() => performance.now());
        for (const content of injected) await handle.addScriptTag({ content });
        await page.waitForTimeout(LATE_CHECK_MS + 700);
        const reports = await page.evaluate(() => globalThis.reports);
        return reports.map(report => ({ ...report, after: report.at - started }));
    } finally {
        await page.close();
    }
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const results = await Promise.all(CASES.map(item => runCase(browser, item)));
        CASES.forEach((item, index) => {
            const reports = results[index].filter(report => report.reason === 'provider-empty-page');
            if (!item.reportedBy) {
                assert.equal(reports.length, 0, `${item.name}: left alone`);
                return;
            }
            assert.equal(reports.length, 1, `${item.name}: reported once`);
            assert.equal(reports[0].state, 'unavailable', item.name);
            assert.ok(reports[0].after >= item.reportedBy - 100, `${item.name}: not before the host has handled the load event, or a slow page has had its time (${Math.round(reports[0].after)} ms)`);
            assert.ok(reports[0].after <= item.reportedBy + 1500, `${item.name}: reported promptly (${Math.round(reports[0].after)} ms)`);
        });
        console.log('Player cleaner empty page: an HTTP error is reported soon, an empty page after a grace period, and a page with content is left alone.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
