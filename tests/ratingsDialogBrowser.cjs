// Ratings: a card's "edit rating" opens the shared rating dialog (RatingDialog.js), the
// same one as Movie Details. Real HTML, CSS, locales and RatingsPageManager code; auth,
// Firestore and providers are stubbed. RATINGS_DIALOG_CAPTURE_DIR saves screenshots.
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
    await page.addScriptTag({ content: read('src/shared/i18n/I18n.js').replace(/^import .*;\r?\n/gm, '').replace('export const i18n', 'const i18n').replace('export { I18n };', '').replace('this.locales = locales;', 'this.locales = window.testLocales;') + '\nwindow.i18n = i18n;' });
    for (const file of ['src/shared/utils/Utils.js', 'src/shared/config/rating.config.js', 'src/shared/components/NumberStepper.js', 'src/shared/components/SortControl.js', 'src/shared/components/FilterControls.js', 'src/shared/components/RatingDialog.js']) {
        await page.addScriptTag({ content: read(file).replace(/^import .*;\r?\n/gm, '').replace(/^export (default )?/gm, '') });
    }
    // ratings.js imports these two; the stripped copy below reads them from window.
    await page.addScriptTag({ type: 'module', content: `
        import { getRatingTheme } from '/src/shared/config/franchiseRatingThemes.js';
        import { getRatingIconMarkup } from '/src/shared/components/RatingIcons.js';
        Object.assign(window, { getRatingTheme, getRatingIconMarkup, ratingIconsReady: true });
    ` });
    await page.waitForFunction(() => window.ratingIconsReady === true);
    await page.addScriptTag({ content: read('src/pages/ratings/ratings.js').replace(/^import .*;\r?\n/gm, '') + '\nwindow.FixtureManager = RatingsPageManager;' });
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; } .main-container { opacity: 1; }' });
    await page.evaluate(theme => {
        document.documentElement.classList.toggle('light-theme', theme === 'light');
        document.body.classList.toggle('light-theme', theme === 'light');
        i18n.currentLocale = 'ru';
        i18n.translatePage();
        window.chrome = { runtime: { getURL: path => `chrome-extension://test/${path}` } };
        const calls = [];
        window.writes = calls;
        window.readReply = null;
        window.firebaseManager = {
            getRatingService: () => ({
                getRating: async () => window.readReply,
                addOrUpdateRating: async (...args) => { calls.push(['addOrUpdateRating', ...args.slice(3, 6)]); return { id: 'u1_1' }; },
                updateRatingText: async (...args) => { calls.push(['updateRatingText', ...args.slice(1)]); return { id: args[1] }; }
            }),
            getUserService: () => ({ getUserProfile: async () => ({ displayName: 'Tester' }) })
        };
        const manager = Object.create(window.FixtureManager.prototype);
        manager.filters = {};
        manager.pendingLiveMovies = new Set();
        manager.recentLocalEdits = new Map();
        manager.renderedMoviesState = new Map();
        manager.userProfilesMap = new Map();
        manager.currentUser = { uid: 'u1', displayName: 'Tester' };
        manager.applyFilters = () => {};
        manager.initializeElements();
        manager.setupEventListeners();
        manager.movies = [
            { movieId: 1, myRating: 7, myComment: 'Хорошо', allRaters: [{ userId: 'u1', rating: 7, comment: 'Хорошо' }],
                movie: { kinopoiskId: 1, name: 'Фильм', year: 2020, genres: ['драма', 'триллер'], posterUrl: '' } },
            { movieId: 2, myRating: 8, myComment: '', allRaters: [{ userId: 'u1', rating: 8 }],
                movie: { kinopoiskId: 2, name: 'Сериал', year: 2021, type: 'tv-series', posterUrl: '' } },
            { movieId: 3, myRating: 9, myComment: '', allRaters: [{ userId: 'u1', rating: 9 }],
                movie: { kinopoiskId: 3, name: 'Дюна', year: 2021, posterUrl: '' } }
        ];
        manager.filteredMovies = manager.movies;
        window.manager = manager;
    }, theme);
}

async function open(page, movieId = 1, reply = null) {
    await page.evaluate(({ movieId, reply }) => {
        window.readReply = reply;
        document.getElementById('toggleFiltersBtn')?.focus();
        window.manager.editRating(String(movieId));
    }, { movieId, reply });
    await page.waitForFunction(() => document.querySelector('#ratingModal .rating-modal-body')?.inert === false);
}

const state = page => page.evaluate(() => {
    const dialog = document.getElementById('ratingModal');
    return {
        display: dialog ? getComputedStyle(dialog).display : 'none',
        shown: Boolean(dialog && dialog.style.display !== 'none'),
        active: document.activeElement?.id || document.activeElement?.tagName,
        pressed: [...document.querySelectorAll('.star-rating-btn[aria-pressed="true"]')].map(button => Number(button.dataset.rating)),
        status: document.getElementById('ratingStatus')?.textContent,
        comment: document.getElementById('ratingComment')?.value,
        review: document.getElementById('ratingReview')?.value
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
            response.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' })[ext] || 'application/octet-stream');
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
            assert.equal(await page.locator('#ratingModal').count(), 0, `${theme}: the page has no dialog of its own`);

            await open(page, 1, { id: 'u1_1', userId: 'u1', rating: 7, comment: 'Хорошо', review: 'Длинная рецензия' });
            let s = await state(page);
            assert.equal(s.display, 'flex', `${theme}: the shared dialog opens`);
            assert.equal(await page.locator('.star-rating-btn').count(), 10, `${theme}: ten stars, not a slider`);
            assert.deepEqual(s.pressed, [7], `${theme}: the user's own rating is chosen`);
            assert.equal(s.status, 'Ваша оценка: 7/10 — Хорошо', `${theme}: the score has its word`);
            assert.equal(s.comment, 'Хорошо');
            assert.equal(s.review, 'Длинная рецензия', `${theme}: the stored review is shown and kept`);
            assert.equal(s.active, 'ratingModalClose', `${theme}: focus moves into the dialog`);
            assert.equal(await page.locator('#episodeRatingLink').isVisible(), false, `${theme}: films have no episode link`);

            const look = await page.evaluate(() => {
                const dialog = document.getElementById('ratingModal');
                const box = dialog.getBoundingClientRect();
                const surface = dialog.querySelector('.modal').getBoundingClientRect();
                return {
                    box: [box.left, box.top, box.width, box.height],
                    center: [Math.round(surface.left + surface.width / 2), Math.round(surface.top + surface.height / 2)],
                    width: Math.round(surface.width),
                    onTop: document.elementFromPoint(5, 5) === dialog,
                    title: document.getElementById('ratingModalTitle').textContent
                };
            });
            assert.deepEqual(look.box, [0, 0, 1280, 800], `${theme}: the dialog is the full-viewport overlay`);
            assert.ok(Math.abs(look.center[0] - 640) <= 1 && Math.abs(look.center[1] - 400) <= 1, `${theme}: surface is centered (${look.center})`);
            assert.equal(look.width, 480, `${theme}: the film page's dialog width`);
            assert.ok(look.onTop, `${theme}: the overlay is on top of the page`);
            assert.equal(look.title, 'Оценить');
            if (captureDir) await page.screenshot({ path: path.join(captureDir, `ratings-dialog-${theme}.png`) });

            for (let i = 0; i < 14; i++) await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.getElementById('ratingModal').contains(document.activeElement)), true, `${theme}: Tab stays in the dialog`);

            await page.keyboard.press('Escape');
            s = await state(page);
            assert.equal(s.shown, false, `${theme}: Escape closes it`);
            assert.equal(s.active, 'toggleFiltersBtn', `${theme}: focus returns to the opener`);

            await open(page);
            await page.mouse.click(640, 400);
            assert.equal((await state(page)).shown, true, `${theme}: a click on the surface keeps it open`);
            await page.mouse.click(8, 8);
            assert.equal((await state(page)).shown, false, `${theme}: a press on the dimmed background closes it`);
            await open(page);
            await page.click('#cancelRatingBtn');
            assert.equal((await state(page)).shown, false, `${theme}: Cancel closes it`);
            await open(page);
            await page.click('#ratingModalClose');
            assert.equal((await state(page)).shown, false, `${theme}: the close button closes it`);

            // A failed read keeps what the card knows.
            await open(page, 1, null);
            s = await state(page);
            assert.deepEqual(s.pressed, [7]);
            assert.equal(s.comment, 'Хорошо');

            // Saving a new score updates the card at once and writes once.
            await page.evaluate(() => { window.writes.length = 0; });
            await page.click('.star-rating-btn[data-rating="9"]');
            await page.click('#saveRatingBtn');
            await page.waitForFunction(() => document.getElementById('ratingModal').style.display === 'none');
            await page.waitForFunction(() => window.writes.length === 1);
            assert.deepEqual(await page.evaluate(() => window.writes[0]), ['addOrUpdateRating', 1, 9, 'Хорошо'], `${theme}: one write with the new score`);
            assert.equal(await page.evaluate(() => window.manager.movies[0].myRating), 9, `${theme}: the card updates at once`);
            if (captureDir) await page.screenshot({ path: path.join(captureDir, `ratings-dialog-saved-${theme}.png`) });

            // A comment-only edit patches the text and leaves the stored review alone.
            await page.evaluate(() => { window.writes.length = 0; });
            await open(page, 1, { id: 'u1_1', userId: 'u1', rating: 9, comment: 'Хорошо', review: 'Длинная рецензия' });
            await page.fill('#ratingComment', 'Лучше, чем ждал');
            await page.click('#saveRatingBtn');
            await page.waitForFunction(() => window.writes.length === 1);
            assert.deepEqual(await page.evaluate(() => window.writes[0]), ['updateRatingText', 'u1_1', { comment: 'Лучше, чем ждал' }]);

            // Series link to their episode scores on Movie Details.
            await open(page, 2, null);
            assert.equal(await page.locator('#episodeRatingLink').isVisible(), true, `${theme}: series get the episode link`);
            assert.match(await page.locator('#episodeRatingLink').getAttribute('href'), /movie-details\.html\?movieId=2$/);
            if (captureDir) await page.screenshot({ path: path.join(captureDir, `ratings-dialog-series-${theme}.png`) });
            await page.keyboard.press('Escape');

            // Franchise films get their own icons here too.
            await open(page, 3, null);
            assert.equal(await page.locator('.star-rating-btn.dune-rating-btn .dune-rating-icon').count(), 10, `${theme}: Dune is rated with its icons`);
            const iconImage = await page.locator('.star-rating-btn[data-rating="9"] .dune-rating-icon').evaluate(icon => getComputedStyle(icon).backgroundImage);
            assert.match(iconImage, /dune-rating-active\.svg/, `${theme}: the chosen icons use the active picture`);
            if (captureDir) await page.screenshot({ path: path.join(captureDir, `ratings-dialog-dune-${theme}.png`) });
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
