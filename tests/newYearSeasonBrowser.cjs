/**
 * The New Year season in a real browser, on the built extension with a pinned clock.
 *
 *     npm run build && npm run test:new-year-browser
 *     SCREENSHOT_DIR=some/folder npm run test:new-year-browser    keeps screenshots
 *
 * Needs no emulators: the page runs as a guest, TMDB traffic is answered locally and
 * every other host stays blocked by the harness.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { launchExtensionContext } = require('./helpers/extensionContext.cjs');
const { installInitScripts } = require('./e2e/lib/initScripts.cjs');
const { installTmdb } = require('./e2e/lib/externalWorld.cjs');
const config = require('./e2e/lib/config.cjs');

const SHOTS = process.env.SCREENSHOT_DIR || '';
const HOME = 'src/pages/home/home.html';

async function withExtension({ date, viewport = { width: 1920, height: 1080 } }, run) {
    const harness = await launchExtensionContext({
        extensionPath: config.EXTENSION_PATH,
        fixtureOrigin: config.AUTH_ORIGIN,
        additionalFixtureOrigins: [config.FIRESTORE_ORIGIN],
        contextOptions: { viewport, timezoneId: config.TIMEZONE, deviceScaleFactor: 1 }
    });
    try {
        await installInitScripts(harness.context, {
            pinnedDate: date,
            projectId: config.PROJECT_ID,
            authOrigin: config.AUTH_ORIGIN,
            firestoreHost: config.FIRESTORE_HOST,
            firestorePort: config.FIRESTORE_PORT,
            live: false
        });
        await installTmdb(harness.context);
        const page = await harness.context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await run(page, url => `chrome-extension://${harness.extensionId}/${url}`, errors);
        await page.close();
    } finally {
        await harness.close();
    }
}

async function shot(page, name) {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const waitForSign = page => page.waitForFunction(() => document.querySelector('.ny-marquee .ny-tree__body')?.complete
    && document.querySelector('.ny-marquee')?.dataset.layout, null, { timeout: 20000 });

/* Points a real pointer can click, from left to right along the pile. */
const giftPoints = page => page.evaluate(() => {
    document.querySelector('.ny-marquee').scrollIntoView({ block: 'center' });
    return [...document.querySelectorAll('.ny-gift')].map((gift, index) => {
        const box = gift.getBoundingClientRect();
        const x = box.left + parseFloat(gift.style.getPropertyValue('--ox'));
        const y = box.top + parseFloat(gift.style.getPropertyValue('--oy')) - gift.offsetHeight * 0.26;
        return { index, x, y, reachable: document.elementFromPoint(x, y)?.closest('.ny-gift') === gift };
    }).filter(point => point.reachable).sort((a, b) => a.x - b.x);
});

/* What the viewer really sees of the film card, not just its classes. */
const cardState = page => page.evaluate(() => {
    const reveal = document.querySelector('.ny-reveal');
    const style = getComputedStyle(reveal);
    const box = reveal.getBoundingClientRect();
    const poster = document.querySelector('.ny-reveal__poster');
    return {
        visible: style.visibility === 'visible' && Number(style.opacity) > 0.98,
        onTop: !!document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('.ny-reveal'),
        open: [...document.querySelectorAll('.ny-gift')].flatMap((gift, index) => (gift.getAttribute('aria-expanded') === 'true' ? [index] : [])),
        title: document.querySelector('.ny-reveal__title').textContent,
        href: document.querySelector('.ny-reveal__card').getAttribute('href') || '',
        posterShown: getComputedStyle(poster).display !== 'none' && poster.complete && poster.naturalWidth > 0
    };
});

function assertCardHolds(state, index, label) {
    assert.deepEqual(state.open, [index], `${label}: the gift must stay open`);
    assert.ok(state.visible, `${label}: the film card must be visible, not an empty gift`);
    assert.ok(state.onTop, `${label}: the film card must be on top`);
    assert.ok(state.title, `${label}: the film card must name a film`);
    assert.match(state.href, /resolveTmdbId=\d+/, `${label}: the film card must lead to the film`);
    assert.ok(state.posterShown, `${label}: the film card must show its poster`);
}

async function main() {
    // In season, before midnight: sign, countdown, tree, gifts, snow, sky, Santa.
    await withExtension({ date: '2026-12-20T12:00:00+03:00' }, async (page, url, errors) => {
        await page.goto(url(HOME));
        await waitForSign(page);
        await page.waitForTimeout(4500);
        const state = await page.evaluate(() => ({
            season: document.documentElement.dataset.season,
            layout: document.querySelector('.ny-marquee').dataset.layout,
            oldBanner: document.getElementById('season-banner').hidden,
            title: document.querySelector('.ny-marquee__title').textContent,
            days: document.querySelector('.ny-leader__num').textContent,
            daysUnit: document.querySelector('.ny-leader__unit').textContent,
            digits: document.querySelectorAll('.ny-flip').length,
            gifts: document.querySelectorAll('.ny-gift').length,
            loadedGifts: [...document.querySelectorAll('.ny-gift img')].filter(img => img.complete && img.naturalWidth > 0).length,
            sky: !!document.querySelector('.ny-sky'),
            snow: !!document.querySelector('#seasonalDecor .ny-fx'),
            piles: !!document.querySelector('.ny-piles canvas'),
            wings: document.querySelectorAll('.ny-wing__layer').length,
            logo: !!document.querySelector('.nav-logo .season-logo__heap'),
            font: document.fonts.check('58px "Poiret One"', 'Новогодний'),
            docOverflow: document.documentElement.scrollWidth - innerWidth
        }));
        assert.equal(state.season, 'newyear');
        assert.equal(state.layout, 'wide');
        assert.equal(state.oldBanner, true);
        assert.equal(state.title, 'Новогодний сеанс');
        assert.equal(state.days, '11');
        assert.equal(state.daysUnit, 'дней');
        assert.equal(state.digits, 6);
        assert.equal(state.gifts, 12);
        assert.equal(state.loadedGifts, 24);
        assert.ok(state.sky && state.snow && state.piles && state.logo);
        assert.equal(state.wings, 4);
        assert.ok(state.font, 'the bundled title font must load');
        assert.ok(state.docOverflow <= 0, `the page must not scroll sideways (${state.docOverflow}px)`);
        await shot(page, 'dark-1920');

        // A digit really flips: one second later the seconds run a flip animation.
        const flipped = await page.evaluate(async () => {
            const flips = [...document.querySelectorAll('.ny-flip')];
            const last = flips[flips.length - 1];
            await new Promise(resolve => {
                const observer = new MutationObserver(() => { observer.disconnect(); resolve(); });
                observer.observe(last, { attributes: true, attributeFilter: ['class'] });
            });
            return last.querySelector('.ny-flip__flap--top').getAnimations().map(a => a.animationName);
        });
        assert.match(flipped[0], /^ny-flip-top-/);

        // A gift opens with a film from the catalogue, and closes again.
        const opened = await page.evaluate(async () => {
            const gift = document.querySelectorAll('.ny-gift')[4];
            const box = gift.getBoundingClientRect();
            const el = document.elementFromPoint(box.left + +gift.style.getPropertyValue('--ox').replace('px', ''), box.top + +gift.style.getPropertyValue('--oy').replace('px', '') - gift.offsetHeight * 0.26);
            const hit = !!el?.closest('.ny-gift');
            gift.click();
            await new Promise(resolve => setTimeout(resolve, 1800));
            return {
                hit,
                expanded: gift.getAttribute('aria-expanded'),
                shown: document.querySelector('.ny-reveal').classList.contains('is-shown'),
                title: document.querySelector('.ny-reveal__title').textContent,
                href: document.querySelector('.ny-reveal__card').getAttribute('href') || ''
            };
        });
        assert.ok(opened.hit, 'the gift must be reachable under the pointer');
        assert.equal(opened.expanded, 'true');
        assert.ok(opened.shown);
        assert.ok(opened.title);
        assert.notEqual(opened.title, 'Выбрать случайный фильм', 'the gift must hold a film when the catalogue answers');
        assert.match(opened.href, /movie-details\.html\?resolveTmdbId=\d+/);
        await shot(page, 'gift-open');
        await page.evaluate(() => document.querySelector('.ny-reveal__close').click());
        await page.waitForTimeout(1200);
        assert.equal(await page.evaluate(() => document.querySelector('.ny-reveal').classList.contains('is-shown')), false);

        // Every gift shares one card, and a gift that is still closing must not take it
        // from the next one: that left an open gift with nothing inside.
        const points = await giftPoints(page);
        const first = points[0], last = points[points.length - 1];
        assert.ok(last.x - first.x > 300, 'the two gifts must be far enough apart for the card not to cover them');
        const closeCard = () => page.evaluate(() => document.querySelector('.ny-reveal__close').click());

        await page.mouse.click(first.x, first.y);
        await page.waitForTimeout(500);
        await page.mouse.click(last.x, last.y);
        await page.waitForTimeout(1600);
        assertCardHolds(await cardState(page), last.index, 'another gift opened while one was open');
        await shot(page, 'gift-switched');

        await closeCard();
        await page.waitForTimeout(250);
        await page.mouse.click(last.x, last.y);
        await page.waitForTimeout(1600);
        assertCardHolds(await cardState(page), last.index, 'the same gift opened again while closing');

        const titleBox = await page.evaluate(() => {
            const box = document.querySelector('.ny-marquee__title').getBoundingClientRect();
            return { x: box.left + 40, y: box.top + box.height / 2 };
        });
        await page.mouse.click(titleBox.x, titleBox.y);
        await page.waitForTimeout(200);
        await page.mouse.click(first.x, first.y);
        await page.waitForTimeout(1600);
        assertCardHolds(await cardState(page), first.index, 'a gift opened right after a click outside');

        await page.mouse.click(last.x, last.y);
        await page.waitForTimeout(200);
        await closeCard();
        await page.waitForTimeout(1600);
        const closedCard = await cardState(page);
        assert.deepEqual(closedCard.open, []);
        assert.equal(closedCard.visible, false, 'the card must go away once every gift has closed');

        // A card in flight catches no clicks, so a double click stays on the page,
        // and a card that has arrived still leads to its film.
        const homeUrl = page.url();
        await page.mouse.dblclick(first.x, first.y);
        await page.waitForTimeout(1600);
        assert.equal(page.url(), homeUrl, 'a double click on a gift must not open the film');
        await page.mouse.click(first.x, first.y);
        await page.waitForTimeout(1600);
        const arrived = await cardState(page);
        assertCardHolds(arrived, first.index, 'a gift opened after a double click');
        const cardBox = await page.evaluate(() => {
            const box = document.querySelector('.ny-reveal__card').getBoundingClientRect();
            return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        });
        await Promise.all([page.waitForURL(/movie-details\.html\?resolveTmdbId=\d+/), page.mouse.click(cardBox.x, cardBox.y)]);
        await page.goto(homeUrl);
        await waitForSign(page);
        assert.deepEqual(errors, []);

        // Scrolling does not grow the page: the snow layer stays within it.
        const growth = await page.evaluate(async () => {
            const before = document.documentElement.scrollHeight;
            scrollTo(0, 1e6);
            await new Promise(resolve => setTimeout(resolve, 500));
            const after = document.documentElement.scrollHeight;
            scrollTo(0, 0);
            return after - before;
        });
        assert.ok(growth <= 0, `scrolling must not extend the page (${growth}px)`);

        // The opt-out removes everything the season added.
        const off = await page.evaluate(async () => {
            window.SeasonalThemeService.setEnabled(false);
            await new Promise(resolve => setTimeout(resolve, 100));
            const state = {
                cls: document.documentElement.classList.contains('season-newyear'),
                sky: !!document.querySelector('.ny-sky'),
                piles: !!document.querySelector('.ny-piles'),
                decor: !!document.getElementById('seasonalDecor'),
                sign: !document.getElementById('season-marquee').hidden
            };
            window.SeasonalThemeService.setEnabled(true);
            return state;
        });
        assert.deepEqual(off, { cls: false, sky: false, piles: false, decor: false, sign: false });
        await page.waitForFunction(() => document.querySelector('.ny-sky'), null, { timeout: 8000 });

        // Behind the open player the snow does not produce a single frame.
        const frozen = await page.evaluate(async () => {
            const canvas = document.querySelector('#seasonalDecor .ny-fx');
            document.body.classList.add('player-modal-open');
            await new Promise(resolve => setTimeout(resolve, 200));
            const first = canvas.toDataURL();
            await new Promise(resolve => setTimeout(resolve, 700));
            const same = first === canvas.toDataURL();
            document.body.classList.remove('player-modal-open');
            await new Promise(resolve => setTimeout(resolve, 400));
            return { same, resumed: first !== canvas.toDataURL() };
        });
        assert.deepEqual(frozen, { same: true, resumed: true });

        // A theme switch rebuilds the sky without leaving a second one behind.
        const themed = await page.evaluate(async () => {
            document.documentElement.classList.add('light-theme');
            await new Promise(resolve => setTimeout(resolve, 600));
            return { skies: document.querySelectorAll('.ny-sky').length, piles: document.querySelectorAll('.ny-piles').length };
        });
        assert.deepEqual(themed, { skies: 1, piles: 1 });
        const signColors = await page.evaluate(() => ({
            title: getComputedStyle(document.querySelector('.ny-marquee__title')).color,
            message: getComputedStyle(document.querySelector('.ny-marquee__message')).color
        }));
        assert.equal(signColors.title, 'rgb(255, 243, 210)', 'the sign stays a night scene in the light theme');
        assert.equal(signColors.message, 'rgba(240, 244, 255, 0.82)');
        await page.waitForTimeout(1200);
        await shot(page, 'light-1920');
        assert.deepEqual(errors, []);
    });

    // The sign's link opens the catalogue on the season's keyword.
    await withExtension({ date: '2026-12-20T12:00:00+03:00' }, async (page, url, errors) => {
        const requests = [];
        page.on('request', request => {
            const decoded = decodeURIComponent(request.url());
            if (decoded.includes('/discover/')) requests.push(decoded);
        });
        await page.goto(url('src/pages/catalog/catalog.html?category=films&keyword=207317'));
        await page.waitForFunction(() => document.querySelectorAll('.movie-card-component').length > 0, null, { timeout: 20000 });
        await page.waitForTimeout(3000);
        assert.ok(requests.some(item => item.includes('with_keywords=207317')), 'the catalogue must ask for the keyword');
        assert.match(page.url(), /keyword=207317/);
        assert.equal(await page.textContent('#catalogTitle'), 'Новогодние фильмы');
        const skyShows = await page.evaluate(() => getComputedStyle(document.querySelector('.catalog-page')).backgroundColor);
        assert.equal(skyShows, 'rgba(0, 0, 0, 0)', 'the sky must show through the page root');
        await shot(page, 'catalog-1920');
        assert.deepEqual(errors, []);
    });

    // Reduced motion: one still picture, the tree already lit, gifts still open.
    await withExtension({ date: '2026-12-20T12:00:00+03:00' }, async (page, url, errors) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(url(HOME));
        await waitForSign(page);
        await page.waitForTimeout(2500);
        const state = await page.evaluate(async () => {
            const canvas = document.querySelector('.ny-tree__live');
            const snow = document.querySelector('#seasonalDecor .ny-fx');
            const first = canvas.toDataURL() + snow.toDataURL();
            await new Promise(resolve => setTimeout(resolve, 900));
            const gift = document.querySelector('.ny-gift');
            gift.click();
            await new Promise(resolve => setTimeout(resolve, 300));
            return {
                still: first === canvas.toDataURL() + snow.toDataURL(),
                santa: getComputedStyle(document.querySelector('.ny-sky__santa')).visibility,
                opened: document.querySelector('.ny-reveal').classList.contains('is-shown')
            };
        });
        assert.deepEqual(state, { still: true, santa: 'hidden', opened: true });
        await shot(page, 'reduced-motion');
        const swapped = await page.evaluate(() => {
            document.querySelector('.ny-marquee__collapse').click();
            return {
                sign: !!document.querySelector('.ny-marquee'),
                strip: !!document.querySelector('.ny-strip'),
                lamps: getComputedStyle(document.querySelector('.ny-strip__lamps'), '::before').animationName,
                title: getComputedStyle(document.querySelector('.ny-strip__title')).animationName
            };
        });
        assert.deepEqual(swapped, { sign: false, strip: true, lamps: 'none', title: 'none' });
        assert.deepEqual(errors, []);
    });

    // 1 January: the greeting, no countdown.
    await withExtension({ date: '2027-01-01T12:00:00+03:00' }, async (page, url, errors) => {
        await page.goto(url(HOME));
        await waitForSign(page);
        await page.waitForTimeout(3000);
        const state = await page.evaluate(() => ({
            title: document.querySelector('.ny-marquee__title').textContent,
            count: getComputedStyle(document.querySelector('.ny-count')).display
        }));
        assert.equal(state.title, 'С Новым годом!');
        assert.equal(state.count, 'none');
        await shot(page, 'first-of-january');
        await page.click('.ny-marquee__collapse');
        await page.waitForSelector('.ny-marquee', { state: 'detached', timeout: 3000 });
        assert.equal(await page.textContent('.ny-strip__title'), 'С Новым годом!');
        assert.equal(await page.textContent('.ny-strip__left'), 'В каждом подарке спрятан фильм');
        assert.deepEqual(errors, []);
    });

    // After the window: nothing of the season is loaded.
    await withExtension({ date: '2027-01-15T12:00:00+03:00' }, async (page, url, errors) => {
        await page.goto(url(HOME));
        await page.waitForTimeout(2500);
        const state = await page.evaluate(() => ({
            season: document.documentElement.dataset.season || '',
            scripts: [...document.scripts].filter(s => s.src.includes('/seasonal/')).length,
            sky: !!document.querySelector('.ny-sky')
        }));
        assert.deepEqual(state, { season: '', scripts: 0, sky: false });
        assert.deepEqual(errors, []);
    });

    // A card is never blank: it says so while the film is on its way, and an answer that
    // failed is asked for again by the next gift.
    await withExtension({ date: '2026-12-20T12:00:00+03:00' }, async (page, url, errors) => {
        let answerMode = 'fail';
        let release;
        const released = new Promise(resolve => { release = resolve; });
        await page.route(/with_keywords/, async route => {
            if (answerMode === 'fail') return route.abort();
            await released;
            return route.fallback();
        });
        await page.goto(url(HOME));
        await waitForSign(page);
        const points = await giftPoints(page);
        const first = points[0], last = points[points.length - 1];

        await page.mouse.click(first.x, first.y);
        await page.waitForTimeout(1600);
        const failed = await cardState(page);
        assert.ok(failed.visible);
        assert.equal(failed.title, 'Выбрать случайный фильм');
        assert.match(failed.href, /random\.html/);
        assert.equal(failed.posterShown, false);

        answerMode = 'hold';
        await page.mouse.click(last.x, last.y);
        await page.waitForTimeout(1600);
        const waiting = await cardState(page);
        assert.ok(waiting.visible);
        assert.equal(waiting.title, 'Ищем фильм…');
        assert.equal(waiting.href, '');
        assert.equal(waiting.posterShown, false);

        release();
        await page.waitForFunction(() => document.querySelector('.ny-reveal__card').getAttribute('href'), null, { timeout: 10000 });
        await page.waitForFunction(() => document.querySelector('.ny-reveal__poster').naturalWidth > 0, null, { timeout: 10000 });
        assertCardHolds(await cardState(page), last.index, 'the film that arrived late');
        assert.deepEqual(errors, []);
    });

    // The sign collapses into a strip that brings it back, and stays as it was left.
    await withExtension({ date: '2026-12-20T12:00:00+03:00' }, async (page, url, errors) => {
        const scene = () => page.evaluate(() => ({
            sign: !!document.querySelector('.ny-marquee'),
            strip: !!document.querySelector('.ny-strip'),
            saved: localStorage.getItem('movieExtensionSeasonBannerDismissed')
        }));
        const hostHeight = () => page.evaluate(() => document.getElementById('season-marquee').offsetHeight);
        await page.goto(url(HOME));
        await waitForSign(page);
        await page.waitForTimeout(1500);
        const signHeight = await hostHeight();
        assert.equal(await page.textContent('.ny-marquee__collapse'), 'Свернуть');
        await shot(page, 'sign-with-collapse');

        // An open gift goes away with the sign, and the page eases instead of jumping.
        const points = await giftPoints(page);
        await page.mouse.click(points[0].x, points[0].y);
        await page.waitForTimeout(400);
        await page.click('.ny-marquee__collapse');
        await page.waitForTimeout(170);
        const midway = await hostHeight();
        assert.ok(midway < signHeight && midway > 100, `the box must ease between the heights (${midway})`);
        await shot(page, 'strip-moving');
        await page.waitForSelector('.ny-marquee', { state: 'detached', timeout: 3000 });
        await page.waitForTimeout(1400);
        assert.deepEqual(await scene(), { sign: false, strip: true, saved: 'newyear-2026' });
        const strip = await page.evaluate(() => {
            const button = document.querySelector('.ny-strip');
            const box = button.getBoundingClientRect();
            return {
                title: document.querySelector('.ny-strip__title').textContent,
                left: document.querySelector('.ny-strip__left').textContent,
                action: document.querySelector('.ny-strip__action').textContent,
                expanded: button.getAttribute('aria-expanded'),
                focused: document.activeElement === button,
                giftsLoaded: [...button.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0),
                onTop: !!document.elementFromPoint(box.right - 60, box.top + box.height / 2)?.closest('.ny-strip'),
                height: document.getElementById('season-marquee').offsetHeight,
                overflow: document.documentElement.scrollWidth - innerWidth
            };
        });
        assert.deepEqual(strip, {
            title: 'Новогодний сеанс',
            left: 'До Нового года 11 дней',
            action: 'Развернуть',
            expanded: 'false',
            focused: true,
            giftsLoaded: true,
            onTop: true,
            height: strip.height,
            overflow: strip.overflow
        });
        assert.ok(strip.height < 140, `the strip must be slim (${strip.height})`);
        assert.ok(strip.overflow <= 0);
        await shot(page, 'strip-1920');

        await page.evaluate(() => document.documentElement.classList.add('light-theme'));
        await page.waitForTimeout(1800);
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ny-strip__title')).color), 'rgb(255, 243, 210)');
        await shot(page, 'strip-light');
        await page.evaluate(() => document.documentElement.classList.remove('light-theme'));
        await page.waitForTimeout(800);

        // A collapsed sign stays collapsed on the next page view and costs nothing of the scene.
        await page.reload();
        await page.waitForSelector('.ny-strip', { timeout: 20000 });
        await page.waitForTimeout(1200);
        assert.deepEqual(await scene(), { sign: false, strip: true, saved: 'newyear-2026' });
        assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(item => item.name.includes('tree-body'))), false);

        // The opt-out takes the strip away too, and turning decor on brings back the strip.
        const optedOut = await page.evaluate(async () => {
            window.SeasonalThemeService.setEnabled(false);
            await new Promise(resolve => setTimeout(resolve, 100));
            const state = { strip: !!document.querySelector('.ny-strip'), host: !document.getElementById('season-marquee').hidden };
            window.SeasonalThemeService.setEnabled(true);
            return state;
        });
        assert.deepEqual(optedOut, { strip: false, host: false });
        await page.waitForSelector('.ny-strip', { timeout: 8000 });
        assert.equal((await scene()).sign, false);

        // One click brings everything back and the choice is forgotten.
        await page.click('.ny-strip');
        await page.waitForSelector('.ny-strip', { state: 'detached', timeout: 3000 });
        await page.waitForTimeout(600);
        assert.deepEqual(await scene(), { sign: true, strip: false, saved: null });
        assert.equal(await hostHeight(), signHeight);
        assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.ny-marquee__collapse')), true);
        assert.equal(await page.evaluate(() => document.querySelectorAll('.ny-gift').length), 12);

        // A double click does no harm: the second click lands on the sign that is arriving.
        await page.click('.ny-marquee__collapse');
        await page.waitForSelector('.ny-marquee', { state: 'detached', timeout: 3000 });
        const before = page.url();
        await page.dblclick('.ny-strip');
        await page.waitForSelector('.ny-strip', { state: 'detached', timeout: 3000 });
        await page.waitForTimeout(600);
        assert.equal(page.url(), before);
        assert.deepEqual(await scene(), { sign: true, strip: false, saved: null });

        const backPoints = await giftPoints(page);
        await page.mouse.click(backPoints[0].x, backPoints[0].y);
        await page.waitForTimeout(1600);
        assertCardHolds(await cardState(page), backPoints[0].index, 'a gift of the sign that came back');
        await page.reload();
        await waitForSign(page);
        assert.deepEqual(await scene(), { sign: true, strip: false, saved: null });

        // A mark left by last season does not collapse this one.
        await page.evaluate(() => localStorage.setItem('movieExtensionSeasonBannerDismissed', 'newyear-2025'));
        await page.reload();
        await waitForSign(page);
        assert.equal((await scene()).strip, false);
        await page.evaluate(() => localStorage.removeItem('movieExtensionSeasonBannerDismissed'));
        assert.deepEqual(errors, []);
    });

    // The preview date shows a season out of its dates, on every page, until it is removed.
    await withExtension({ date: '2026-06-15T12:00:00+03:00' }, async (page, url, errors) => {
        await page.goto(url(HOME));
        await page.waitForTimeout(800);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.season || ''), '');
        await page.evaluate(() => localStorage.setItem('movieExtensionSeasonPreviewDate', '2026-12-20'));
        await page.reload();
        await waitForSign(page);
        assert.equal(await page.evaluate(() => document.querySelector('.ny-leader__num').textContent), '11');
        await page.evaluate(() => localStorage.setItem('movieExtensionSeasonPreviewDate', '2027-01-01'));
        await page.reload();
        await waitForSign(page);
        assert.equal(await page.evaluate(() => document.querySelector('.ny-marquee__title').textContent), 'С Новым годом!');
        await page.evaluate(() => localStorage.removeItem('movieExtensionSeasonPreviewDate'));
        await page.reload();
        await page.waitForTimeout(800);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.season || ''), '');
        assert.deepEqual(errors, []);
    });

    // A laptop, then a phone-sized window.
    await withExtension({ date: '2026-12-20T12:00:00+03:00', viewport: { width: 1280, height: 800 } }, async (page, url) => {
        await page.goto(url(HOME));
        await waitForSign(page);
        await page.waitForTimeout(3500);
        assert.equal(await page.evaluate(() => document.querySelector('.ny-marquee').dataset.layout), 'wide');
        await shot(page, 'dark-1280');
    });
    await withExtension({ date: '2026-12-20T12:00:00+03:00', viewport: { width: 1100, height: 800 } }, async (page, url) => {
        await page.goto(url(HOME));
        await waitForSign(page);
        await page.waitForTimeout(3500);
        assert.equal(await page.evaluate(() => document.querySelector('.ny-marquee').dataset.layout), 'compact');
        await shot(page, 'dark-1100');
        await page.click('.ny-marquee__collapse');
        await page.waitForSelector('.ny-marquee', { state: 'detached', timeout: 3000 });
        await page.waitForTimeout(1400);
        await shot(page, 'strip-1100');
    });
    await withExtension({ date: '2026-12-20T12:00:00+03:00', viewport: { width: 420, height: 900 } }, async (page, url) => {
        await page.goto(url(HOME));
        await waitForSign(page);
        await page.waitForTimeout(3500);
        assert.equal(await page.evaluate(() => document.querySelector('.ny-marquee').dataset.layout), 'stacked');
        const sign = await page.$('.ny-marquee');
        await sign.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await shot(page, 'stacked-420');
        await page.click('.ny-marquee__collapse');
        await page.waitForSelector('.ny-marquee', { state: 'detached', timeout: 3000 });
        await page.waitForTimeout(1400);
        const narrow = await page.evaluate(() => {
            const title = document.querySelector('.ny-strip__title').getBoundingClientRect();
            const action = document.querySelector('.ny-strip__action').getBoundingClientRect();
            return {
                labelHidden: getComputedStyle(document.querySelector('.ny-strip__action-label')).display === 'none',
                clear: title.right <= action.left,
                overflow: document.documentElement.scrollWidth - innerWidth
            };
        });
        assert.deepEqual(narrow, { labelHidden: true, clear: true, overflow: narrow.overflow });
        assert.ok(narrow.overflow <= 0, `the strip must not scroll the page sideways (${narrow.overflow}px)`);
        await shot(page, 'strip-420');
    });

    console.log('New Year season browser tests passed');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
