// Ratings: the rating dialog is a native modal <dialog>. Real HTML, CSS and
// RatingsPageManager listeners; auth and providers are left out.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const captureDir = process.env.RATINGS_DIALOG_CAPTURE_DIR;

async function fixture(page, baseUrl, theme) {
    await page.goto(`${baseUrl}/src/pages/ratings/ratings.html`, { waitUntil: 'load' });
    await page.addScriptTag({ content: read('src/shared/i18n/locales.js').replace('export const locales', 'window.testLocales') });
    await page.addScriptTag({ content: read('src/shared/i18n/I18n.js').replace(/^import .*;\r?\n/gm, '').replace('export const i18n', 'const i18n').replace('export { I18n };', '').replace('this.locales = locales;', 'this.locales = window.testLocales;') });
    for (const file of ['src/shared/utils/Utils.js', 'src/shared/components/NumberStepper.js', 'src/shared/components/SortControl.js', 'src/shared/components/FilterControls.js']) {
        await page.addScriptTag({ content: read(file).replace(/^import .*;\r?\n/gm, '').replace(/^export (default )?/gm, '') });
    }
    await page.addScriptTag({ content: read('src/pages/ratings/ratings.js').replace(/^import .*;\r?\n/gm, '') + '\nwindow.FixtureManager = RatingsPageManager;' });
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; } .main-container { opacity: 1; }' });
    await page.evaluate(theme => {
        document.documentElement.classList.toggle('light-theme', theme === 'light');
        document.body.classList.toggle('light-theme', theme === 'light');
        i18n.currentLocale = 'ru';
        i18n.translatePage();
        const manager = Object.create(window.FixtureManager.prototype);
        manager.filters = {};
        manager.pendingLiveMovies = new Set();
        manager.initializeElements();
        manager.setupEventListeners();
        window.manager = manager;
    }, theme);
}

async function open(page) {
    await page.evaluate(() => {
        document.getElementById('toggleFiltersBtn')?.focus();
        window.manager.selectedMovie = { kinopoiskId: 1, name: 'Film' };
        window.manager.openRatingModal();
    });
}

const state = page => page.evaluate(() => {
    const dialog = document.getElementById('ratingModal');
    return {
        open: dialog.open,
        modal: dialog.matches(':modal'),
        display: getComputedStyle(dialog).display,
        active: document.activeElement?.id || document.activeElement?.tagName,
        selected: window.manager.selectedMovie
    };
});

async function main() {
    if (captureDir) fs.mkdirSync(captureDir, { recursive: true });
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const file = path.resolve(root, '.' + decodeURIComponent(pathname));
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return response.writeHead(403).end();
        fs.readFile(file, (error, data) => {
            if (error) return response.writeHead(404).end();
            const ext = path.extname(file);
            response.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' })[ext] || 'application/octet-stream');
            response.end(ext === '.html' ? data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') : data);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true });
    try {
        for (const theme of ['dark', 'light']) {
            const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
            await page.route('**/*', route => route.request().url().startsWith(baseUrl) ? route.continue() : route.abort());
            await fixture(page, baseUrl, theme);

            let s = await state(page);
            assert.equal(s.open, false);
            assert.equal(s.display, 'none', `${theme}: closed dialog is not rendered`);

            await open(page);
            s = await state(page);
            assert.equal(s.modal, true, `${theme}: opened with showModal()`);
            assert.equal(s.display, 'flex');
            assert.equal(s.active, 'ratingSlider', `${theme}: the autofocus slider takes focus`);

            const look = await page.evaluate(() => {
                const dialog = document.getElementById('ratingModal');
                const box = dialog.getBoundingClientRect();
                const surface = dialog.querySelector('.modal').getBoundingClientRect();
                const style = getComputedStyle(dialog);
                // The old overlay was a div with the same classes: the dialog must look the same
                const probe = document.createElement('div');
                probe.className = dialog.className;
                probe.style.display = 'none';
                document.body.append(probe);
                const before = getComputedStyle(probe);
                const expected = { background: before.backgroundColor, blur: before.backdropFilter };
                probe.remove();
                return {
                    expected,
                    box: [box.left, box.top, box.width, box.height],
                    center: [Math.round(surface.left + surface.width / 2), Math.round(surface.top + surface.height / 2)],
                    background: style.backgroundColor,
                    blur: style.backdropFilter,
                    border: style.borderTopWidth,
                    backdrop: getComputedStyle(dialog, '::backdrop').backgroundColor,
                    pageInert: !document.querySelector('main').checkVisibility || document.elementFromPoint(5, 5) === dialog
                };
            });
            assert.deepEqual(look.box, [0, 0, 1280, 800], `${theme}: the dialog is the full-viewport overlay`);
            assert.ok(Math.abs(look.center[0] - 640) <= 1 && Math.abs(look.center[1] - 400) <= 1, `${theme}: surface is centered (${look.center})`);
            assert.equal(look.background, look.expected.background, `${theme}: overlay keeps its dim`);
            assert.equal(look.blur, look.expected.blur, `${theme}: overlay keeps its blur`);
            assert.equal(look.border, '0px', `${theme}: UA dialog border is reset`);
            assert.equal(look.backdrop, 'rgba(0, 0, 0, 0)', `${theme}: ::backdrop adds no second dim`);
            assert.ok(look.pageInert, `${theme}: the overlay is on top of the page`);
            if (captureDir) await page.screenshot({ path: path.join(captureDir, `ratings-dialog-${theme}.png`) });

            for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.getElementById('ratingModal').contains(document.activeElement)), true, `${theme}: Tab stays in the dialog`);

            await page.keyboard.press('Escape');
            // The close event is queued after the dialog closes; it releases the film
            await page.waitForFunction(() => !document.getElementById('ratingModal').open && window.manager.selectedMovie === null, null, { timeout: 2000 });
            s = await state(page);
            assert.equal(s.display, 'none', `${theme}: Escape closes it`);
            assert.equal(s.selected, null, `${theme}: Escape releases the film`);
            assert.equal(s.active, 'toggleFiltersBtn', `${theme}: focus returns to the opener`);

            await open(page);
            await page.mouse.click(640, 400);
            assert.equal((await state(page)).open, true, `${theme}: a click on the surface keeps it open`);
            await page.mouse.click(8, 8);
            s = await state(page);
            assert.equal(s.open, false, `${theme}: a press on the dimmed background closes it`);
            assert.equal(s.selected, null);

            await open(page);
            await page.click('#cancelRatingBtn');
            assert.equal((await state(page)).open, false, `${theme}: Cancel closes it`);
            await open(page);
            await page.click('#ratingModalClose');
            assert.equal((await state(page)).open, false, `${theme}: the close button closes it`);
            await page.close();
        }
        console.log('ratings dialog browser: ok');
    } finally {
        await browser.close();
        server.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
