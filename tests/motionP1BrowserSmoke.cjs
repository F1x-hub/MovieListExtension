const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { pageStyles } = require('./motionP0BrowserSmoke.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pixel = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/%3E';

async function main() {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const theme of ['dark-theme', 'light-theme']) {
            for (const reducedMotion of ['no-preference', 'reduce']) {
              for (const width of [1280, 375]) {
                const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: width === 375 });
                await page.emulateMedia({ reducedMotion });
                await page.setContent(`<html class="${theme}"><style>${pageStyles('src/pages/settings/settings.html')}</style><body><button id="trigger" class="btn btn-primary">Open</button></body></html>`);
                await page.locator('#trigger').hover();
                await page.mouse.down();
                assert.equal(await page.locator('#trigger').evaluate(node => getComputedStyle(node).transitionDuration.split(',')[0]), reducedMotion === 'reduce' ? '0s' : '0.08s', 'press timing overrides hover');
                await page.mouse.up();
                await page.addScriptTag({ content: read('src/shared/utils/Utils.js') });
                await page.addScriptTag({ content: read('src/shared/components/ConfirmDialog.js') });
                await page.evaluate(() => {
                    document.querySelector('#trigger').focus();
                    window.confirmResult = null;
                    ConfirmDialog.confirm({ message: 'First' }).then(value => { window.confirmResult = value; });
                });
                await page.waitForTimeout(40);
                const entry = await page.evaluate(() => ConfirmDialog.getElement().getAnimations({ subtree: true }).length);
                assert(reducedMotion === 'reduce' ? entry === 0 : entry > 0, `confirm entry/${theme}/${reducedMotion}`);
                await page.keyboard.press('Escape');
                assert(await page.evaluate(() => ConfirmDialog.getElement().hidden && ConfirmDialog.getElement().inert));
                const exit = await page.evaluate(() => ConfirmDialog.getElement().getAnimations({ subtree: true }).length);
                assert(reducedMotion === 'reduce' ? exit === 0 : exit > 0, 'confirm visual exit does not delay hidden');
                assert.equal(await page.evaluate(() => window.confirmResult), false);
                assert.equal(await page.evaluate(() => document.activeElement.id), 'trigger');
                await page.evaluate(() => { ConfirmDialog.confirm({ message: 'Second' }); });
                await page.waitForTimeout(260);
                assert(await page.evaluate(() => ConfirmDialog.isOpen()), 'previous close cannot hide reopened dialog');
                await page.evaluate(() => ConfirmDialog.cancel());

                await page.addScriptTag({ content: read('src/shared/errors/ErrorDialog.js') });
                await page.evaluate(() => {
                    window.ErrorPresentation = { getPresentation: () => ({ title: 'Error', message: 'Offline', detailsLabel: 'Details', technicalDetails: '', primaryLabel: 'Close', primary: 'close', closeLabel: 'Close' }) };
                    document.querySelector('#trigger').focus();
                    errorDialog.show(new Error('Offline'));
                });
                await page.waitForTimeout(40);
                const errorEntry = await page.evaluate(() => errorDialog.overlay.getAnimations({ subtree: true }).length);
                assert(reducedMotion === 'reduce' ? errorEntry === 0 : errorEntry > 0, 'error entry');
                await page.evaluate(() => errorDialog.hide());
                assert(await page.evaluate(() => errorDialog.overlay.hidden && errorDialog.overlay.inert && document.activeElement.id === 'trigger'), 'error hidden/inert/focus are immediate');

                // Load the actual module class, replacing imports with fixture services.
                const whatsNewSource = read('src/shared/components/WhatsNewDialog.js')
                    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
                await page.addScriptTag({ content: `const i18n = {}; const whatsNew = [];\n${whatsNewSource}\nwindow.MotionWhatsNewDialog = WhatsNewDialog;` });
                await page.evaluate(async () => {
                    window.acknowledged = 0;
                    window.notes = new MotionWhatsNewDialog({
                        service: { history: () => [], read: async () => ({}), acknowledge: () => { window.acknowledged++; return new Promise(resolve => { window.finishAck = resolve; }); } },
                        locale: { currentLocale: 'en', locales: { en: { whats_new: { title: 'Updates', empty: 'Empty', done: 'Done', close: 'Close' } } }, onLocaleChange: () => () => {} },
                        chrome: { storage: { onChanged: { addListener() {}, removeListener() {} } } }
                    });
                    document.querySelector('#trigger').focus();
                    await window.notes.open({ manual: true });
                });
                const notesEntry = await page.evaluate(() => window.notes.root.getAnimations({ subtree: true }).length);
                assert(reducedMotion === 'reduce' ? notesEntry === 0 : notesEntry >= 2, 'notes overlay and surface entry');
                await page.evaluate(() => Promise.all(window.notes.root.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
                await page.evaluate(() => window.notes.render('en'));
                assert.equal(await page.evaluate(() => window.notes.root.getAnimations().length + window.notes.root.querySelector('.whats-new-surface').getAnimations().length), 0, 'locale/history rerender does not replay entry');
                await page.evaluate(() => { window.notes.close(true); });
                assert(await page.evaluate(() => !window.notes.root && window.acknowledged === 1 && document.activeElement.id === 'trigger'), 'close/ack/focus precede visual exit');
                const ghosts = await page.locator('.whats-new-overlay[aria-hidden="true"]').count();
                assert.equal(ghosts, reducedMotion === 'reduce' ? 0 : 1);
                await page.evaluate(async () => { await window.notes.open({ manual: true }); window.finishAck(); });
                await page.waitForTimeout(200);
                assert(await page.evaluate(() => window.notes.root?.isConnected), 'old exit/ack cannot remove new notes');
                await page.evaluate(() => window.notes.close(false));

                // Real Settings toast function, with timers controlled independently of motion.
                const settings = read('src/pages/settings/settings.js');
                const toast = settings.slice(settings.indexOf('    function showToast('), settings.indexOf('    // Input Event Listeners for tracking dirty state'));
                await page.evaluate(code => {
                    window.motionTimers = [];
                    window.setTimeout = (callback, ms) => { motionTimers.push({ callback, ms }); return motionTimers.length; };
                    window.eval(`${code}\nwindow.motionShowToast = showToast;`);
                    motionShowToast('Old');
                    motionShowToast('New');
                    motionTimers.shift().callback();
                }, toast);
                assert.equal(await page.locator('.toast').textContent(), 'New', 'old dwell timer does not close replacement');
                assert.equal(await page.locator('.toast').getAttribute('aria-live'), 'polite');
                await page.evaluate(() => motionTimers.shift().callback());
                if (reducedMotion === 'reduce') assert.equal(await page.locator('.toast').count(), 0);
                else {
                    assert.equal(await page.evaluate(() => motionTimers[0].ms), 120);
                    await page.evaluate(() => { motionShowToast('Newest'); motionTimers.shift().callback(); });
                    assert.equal(await page.locator('.toast').textContent(), 'Newest', 'old exit timer only removes its own node');
                }
                // Shared and Admin timers obey the same concrete-node contract.
                const admin = read('src/pages/admin/admin.js');
                const success = admin.slice(admin.indexOf('    showSuccessMessage('), admin.indexOf('    async loadMovies(', admin.indexOf('    showSuccessMessage(')));
                await page.evaluate(code => { window.adminMotion = window.eval(`({${code}})`); }, success);
                for (const kind of ['utils', 'admin']) {
                    await page.evaluate(kind => {
                        window.motionTimers = [];
                        const show = kind === 'utils' ? message => Utils.showToast(message) : message => adminMotion.showSuccessMessage(message);
                        show('Old'); show('New'); motionTimers.shift().callback();
                    }, kind);
                    const selector = kind === 'utils' ? '.utils-toast' : '.admin-success';
                    assert.equal(await page.locator(selector).textContent(), 'New', `${kind} replacement survives old timer`);
                    await page.evaluate(() => motionTimers.shift().callback());
                    if (reducedMotion === 'reduce') assert.equal(await page.locator(selector).count(), 0);
                    else {
                        assert.equal(await page.evaluate(() => motionTimers[0].ms), 120);
                        await page.evaluate(() => motionTimers.shift().callback());
                        assert.equal(await page.locator(selector).count(), 0);
                    }
                }
                await page.close();
              }
            }
        }

        // A fresh document restores native timers for asynchronous image work.
        const images = await browser.newPage();
        let slowRoute;
        await images.route('**/slow*.svg', route => { slowRoute = route; });
        await images.route('**/broken.svg', route => route.abort());
        await images.setContent(`<style>${pageStyles('src/pages/home/home.html')}</style><div id="images"><img id="cached" width="20" height="30" src='${pixel}'><img id="slow" width="20" height="30" src="https://fixture.test/slow.svg"><img id="broken" width="20" height="30" src="https://fixture.test/broken.svg"></div>`, { waitUntil: 'domcontentloaded' });
        await images.waitForFunction(() => document.querySelector('#cached').complete);
        await images.addScriptTag({ content: read('src/shared/utils/Utils.js') });
        await images.evaluate(() => {
            const cached = document.querySelector('#cached');
            cached.decode = () => Promise.reject(new Error('decode rejected'));
            Utils.bindImageReveal(document.querySelector('#images'));
        });
        await images.waitForFunction(() => document.querySelector('#cached').dataset.motionImage === 'ready');
        assert.equal(await images.locator('#slow').getAttribute('data-motion-image'), 'pending');
        const oldSize = await images.locator('#slow').boundingBox();
        await slowRoute.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>' });
        await images.waitForFunction(() => document.querySelector('#slow').dataset.motionImage === 'ready');
        assert.equal((await images.locator('#slow').boundingBox()).height, oldSize.height, 'load preserves geometry');
        await images.waitForFunction(() => document.querySelector('#broken').dataset.motionImage === 'ready');
        await images.waitForFunction(() => getComputedStyle(document.querySelector('#broken')).opacity === '1');
        await images.evaluate(() => {
            const node = document.querySelector('#cached');
            node.decode = () => new Promise(resolve => { window.oldDecode = resolve; });
            node.dispatchEvent(new Event('load'));
        });
        await images.evaluate(() => {
            const node = document.querySelector('#cached');
            node.decode = () => Promise.resolve();
            node.src = 'https://fixture.test/slow-again.svg';
        });
        await images.evaluate(() => window.oldDecode());
        assert.equal(await images.locator('#cached').getAttribute('data-motion-image'), 'pending', 'stale decode cannot reveal a new source');
        await images.emulateMedia({ reducedMotion: 'reduce' });
        await slowRoute.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>' });
        await images.waitForFunction(() => document.querySelector('#cached').dataset.motionImage === 'ready');
        assert.equal(await images.locator('#cached').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
        const calendar = read('src/pages/calendar/calendar.js');
        const bindCalendar = calendar.slice(calendar.indexOf('function bindInteractions('), calendar.indexOf('function ensureNavigationState('));
        const disclosures = await browser.newPage();
        for (const reducedMotion of ['no-preference', 'reduce']) {
            await disclosures.emulateMedia({ reducedMotion });
            await disclosures.setContent(`<style>${pageStyles('src/pages/calendar/calendar.html')}</style><div id="calendar"><button class="calendar-month-header" aria-expanded="false">Month</button><div class="calendar-month-body" inert><div class="calendar-month-content"><div style="height:150px"><button id="inside">Episode</button></div></div></div></div>`);
            await disclosures.evaluate(code => { window.eval(code); bindInteractions(document.querySelector('#calendar')); }, bindCalendar);
            await disclosures.locator('.calendar-month-header').focus();
            await disclosures.keyboard.press('Enter');
            assert.equal(await disclosures.locator('.calendar-month-header').getAttribute('aria-expanded'), 'true');
            assert.equal(await disclosures.locator('.calendar-month-body').evaluate(node => node.inert), false);
            await disclosures.waitForFunction(() => document.querySelector('.calendar-month-content').getBoundingClientRect().height >= 149);
            await disclosures.keyboard.press('Enter');
            assert.equal(await disclosures.locator('.calendar-month-body').evaluate(node => node.inert), true, 'accordion becomes inert synchronously');
            await disclosures.keyboard.press('Tab');
            assert.notEqual(await disclosures.evaluate(() => document.activeElement.id), 'inside', 'collapsed accordion is outside Tab');
            await disclosures.waitForFunction(() => document.querySelector('.calendar-month-content').getBoundingClientRect().height === 0);
        }
        await disclosures.addScriptTag({ content: read('src/shared/utils/Utils.js') });
        await disclosures.emulateMedia({ reducedMotion: 'no-preference' });
        await disclosures.evaluate(() => Utils.revealContent(document.querySelector('#calendar')));
        assert.equal(await disclosures.locator('#calendar').evaluate(node => node.getAnimations().length), 1);
        await disclosures.emulateMedia({ reducedMotion: 'reduce' });
        await disclosures.evaluate(() => Utils.revealContent(document.querySelector('#calendar')));
        assert.equal(await disclosures.locator('#calendar').evaluate(node => node.getAnimations().length), 0, 'reduced content reveal cancels earlier motion without waiting');
        console.log('Motion P1 Chromium smoke passed: dialog semantics/reopen, notes entry/exit/ack/locale, toast replace/timing, cached/slow/error/stale-decode images and reduce in dark/light, desktop/narrow');
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
