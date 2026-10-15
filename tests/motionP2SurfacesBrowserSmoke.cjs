const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { pageStyles, stylesheet } = require('./motionP0BrowserSmoke.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const artwork = color => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="${color}"/></svg>`);

async function main() {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const theme of ['dark-theme', 'light-theme']) {
            for (const reducedMotion of ['no-preference', 'reduce']) {
                for (const width of [1280, 375]) {
                    const page = await browser.newPage({ viewport: { width, height: 800 } });
                    await page.emulateMedia({ reducedMotion });
                    const css = pageStyles('src/pages/profile/profile.html') + stylesheet('src/shared/styles/image-lightbox.css')
                        + stylesheet('src/shared/styles/report-widget.css') + stylesheet('src/shared/styles/GamesModal.css');
                    await page.setContent(`<html class="${theme}"><style>${css}</style><body><button id="trigger">Open</button><div id="profile" class="modal-overlay profile-modal-overlay" style="display: none"><div class="modal profile-modal"><button>Close</button></div></div><div id="games" class="games-modal-overlay"><div class="games-modal-container" tabindex="-1"><div id="gamesMenu"><button>Play</button></div><div id="gamesPlayView" hidden>Board</div></div></div></body></html>`);
                    await page.addScriptTag({ content: read('src/pages/profile/profile.js').replace(/^import .*;\r?\n/gm, '').split('let profilePageManager;')[0] + '\nwindow.ProfilePageManager = ProfilePageManager;' });
                    await page.evaluate(() => {
                        window.profileOwner = Object.create(ProfilePageManager.prototype);
                        profileOwner.modalReturnFocus = new Map();
                        document.querySelector('#trigger').focus();
                        profileOwner.showModal(document.querySelector('#profile'));
                    });
                    await page.waitForTimeout(40);
                    assert(await page.evaluate(() => document.querySelector('#profile').getAnimations({ subtree: true }).length > 0) === (reducedMotion !== 'reduce'), 'Profile entry');
                    await page.evaluate(() => profileOwner.hideModal(document.querySelector('#profile')));
                    assert(await page.evaluate(() => document.querySelector('#profile').hidden && document.querySelector('#profile').inert && document.activeElement.id === 'trigger'), 'Profile closes/focus restores synchronously');
                    await page.evaluate(() => profileOwner.showModal(document.querySelector('#profile')));
                    await page.waitForTimeout(220);
                    assert(await page.evaluate(() => !document.querySelector('#profile').hidden), 'Rapid reopen survives previous exit');
                    await page.evaluate(() => profileOwner.hideModal(document.querySelector('#profile')));

                    await page.addScriptTag({ content: read('src/shared/components/ImageLightbox.js') });
                    const images = ['red', 'green', 'blue'].map(artwork);
                    await page.evaluate(images => {
                        window.galleryUrls = images;
                        window.preloads = [];
                        window.Image = class {
                            constructor() { preloads.push(this); this.complete = Boolean(window.preloadCached); this.naturalWidth = 120; }
                            decode() { return Promise.reject(new Error('decode rejected')); }
                        };
                        ImageLightbox.show(images);
                    }, images);
                    await page.locator('#shared-image-lightbox-image').evaluate(img => img.decode().catch(() => {}));
                    await page.evaluate(() => { ImageLightbox.next(); ImageLightbox.next(); });
                    if (reducedMotion !== 'reduce') {
                        await page.evaluate(() => preloads[1].onload());
                        await page.waitForTimeout(25);
                        assert(await page.evaluate(() => ImageLightbox.imageAnimation !== null && document.querySelector('.image-lightbox-crossfade').getAttribute('aria-hidden') === 'true'), 'Image uses a decorative crossfade');
                        await page.evaluate(() => preloads[0].onload());
                    }
                    assert.equal(await page.locator('#shared-image-lightbox-image').getAttribute('src'), images[2], 'Late preload cannot overwrite next/prev selection');
                    await page.evaluate(() => { ImageLightbox.prev(); document.querySelector('.image-lightbox-close').click(); });
                    if (reducedMotion !== 'reduce') await page.evaluate(() => preloads.at(-1).onerror());
                    await page.waitForTimeout(20);
                    assert(await page.evaluate(() => document.querySelector('.image-lightbox-overlay').inert && ImageLightbox.previousImage === null), 'Close invalidates preload and visual copies');
                    await page.evaluate(() => ImageLightbox.show(galleryUrls));
                    await page.evaluate(() => ImageLightbox.next());
                    if (reducedMotion !== 'reduce') await page.evaluate(() => preloads.at(-1).onerror());
                    await page.waitForTimeout(15);
                    assert.equal(await page.locator('#shared-image-lightbox-image').getAttribute('src'), images[1], 'Error reaches selected terminal source');
                    await page.evaluate(() => { window.preloadCached = true; ImageLightbox.show(galleryUrls); ImageLightbox.next(); });
                    await page.waitForTimeout(15);
                    assert.equal(await page.locator('#shared-image-lightbox-image').getAttribute('src'), images[1], 'Cached preload completes without a new load event');

                    await page.addScriptTag({ content: read('src/shared/components/ReportWidget.js') });
                    await page.evaluate(() => {
                        window.widget = window.reportWidget;
                        window.readers = [];
                        window.FileReader = class { constructor() { readers.push(this); } readAsDataURL() {} };
                        const file = name => ({ name, size: 50, type: 'image/png' });
                        widget.processFile(file('old'));
                        widget.processFile(file('new'));
                        readers[1].onload({ target: { result: galleryUrls[1] } });
                        readers[0].onload({ target: { result: galleryUrls[0] } });
                    });
                    assert.equal(await page.locator('#reportWidgetPreviewImg').getAttribute('src'), images[1], 'Stale FileReader does not replace newer attachment');
                    await page.evaluate(() => { widget.processFile({ size: 50, type: 'image/png' }); widget.removePhoto(); readers.at(-1).onload({ target: { result: galleryUrls[2] } }); widget.openDrawer(); widget.closeDrawer(); });
                    assert(await page.evaluate(() => widget.drawer.inert && widget.previewContainer.inert && widget.previewContainer.style.display === 'none'), 'Remove and drawer close are immediate, late reader stays hidden');
                    await page.evaluate(() => { widget.processFile({ size: 50, type: 'image/png' }); widget.closeDrawer(); readers.at(-1).onload({ target: { result: galleryUrls[2] } }); });
                    assert(await page.evaluate(() => widget.pendingPreviewFile !== null), 'Closing invalidates pending preview read');
                    await page.evaluate(() => { widget.openDrawer(); readers.at(-1).onerror(); });
                    assert(await page.evaluate(() => widget.pendingPreviewFile === null && widget.previewContainer.inert && widget.messageBox.getAttribute('role') === 'alert'), 'Reopen restarts pending read; failure is terminal and announced');

                    await page.addScriptTag({ content: read('src/shared/components/GamesModal.js').replace(/^import .*;\r?\n/gm, '').replace(/^export \{.*\};\r?\n/gm, '').replace('export class GamesModal', 'class GamesModal') + '\nwindow.GamesModal = GamesModal;' });
                    await page.evaluate(() => {
                        window.gamesOwner = Object.create(GamesModal.prototype);
                        Object.assign(gamesOwner, { overlay: document.querySelector('#games'), createDOM() {}, audio: { init() {} }, keyHandler() {}, keyUpHandler() {}, blurHandler() {}, visibilityHandler() {}, hideCloseConfirm() {}, game: null });
                        document.querySelector('#trigger').focus();
                        gamesOwner.open();
                        gamesOwner.close();
                    });
                    assert(await page.evaluate(() => gamesOwner.overlay.inert && document.activeElement.id === 'trigger'), 'Games semantic close/focus is immediate');
                    await page.evaluate(() => gamesOwner.open());
                    await page.waitForTimeout(220);
                    assert(await page.evaluate(() => gamesOwner.overlay.classList.contains('active')), 'Games rapid reopen');
                    assert.equal(await page.evaluate(() => gamesOwner.viewAnimation !== null), reducedMotion !== 'reduce', 'Game pane motion skips reduce');
                    assert(await page.evaluate(() => {
                        const exiting = document.createElement('div');
                        exiting.inert = true;
                        exiting.innerHTML = '<button id="exitingGameControl">Resume</button>';
                        gamesOwner.overlay.appendChild(exiting);
                        gamesOwner.isCloseConfirmOpen = () => false;
                        return !gamesOwner.getFocusableElements().includes(exiting.firstElementChild);
                    }), 'Custom game focus trap excludes an inert visual exit');

                    const exfs = read('content-scripts/ex-fs-watchlist-injected.js');
                    await page.addStyleTag({ content: /const styles = `([\s\S]*?)`;/m.exec(exfs)[1] });
                    await page.evaluate(() => {
                        document.body.insertAdjacentHTML('beforeend', '<div id="exMenu" class="movie-list-dropdown active"><button>Item</button></div><div id="exModal" class="movie-list-modal-overlay"><div id="exSurface" class="movie-list-modal" data-movie-list-rating-modal="true"><button>Close</button></div></div>');
                    });
                    await page.addScriptTag({ content: exfs.slice(exfs.indexOf('    function closeDropdown'), exfs.indexOf('    // CSS Styles')) });
                    await page.waitForTimeout(40);
                    await page.evaluate(() => closeDropdown(document.querySelector('#exMenu')));
                    assert(await page.evaluate(() => document.querySelector('#exMenu').inert && !document.querySelector('#exMenu').classList.contains('active')), 'External menu closes semantically at once');
                    const closeCode = exfs.slice(exfs.indexOf('        const close = () => {'), exfs.indexOf('        closeBtn.onclick'));
                    await page.addScriptTag({ content: `(() => { const overlay = document.querySelector('#exModal'); ${closeCode} window.closeExternal = close; })();` });
                    await page.evaluate(() => closeExternal());
                    assert.equal(await page.locator('#exModal').count(), 0, 'External modal root is removed immediately');
                    const visual = page.locator('.movie-list-modal-overlay[aria-hidden="true"]');
                    assert.equal(await visual.count(), reducedMotion === 'reduce' ? 0 : 1, 'External close has only an inert decorative copy, skipped for reduce');
                    if (reducedMotion !== 'reduce') {
                        assert.equal(await visual.locator('[id], [data-movie-list-rating-modal]').count(), 0, 'Visual copy cannot collide with ids/owners');
                        await page.evaluate(() => Promise.all(document.querySelector('.movie-list-modal-overlay[aria-hidden="true"]').getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
                        await page.waitForTimeout(0);
                        assert.equal(await visual.count(), 0, 'External visual exit removes its own copy');
                    }
                    await page.close();
                }
            }
        }
        console.log('P2 surfaces Chromium smoke passed: themes, narrow/desktop, reduce, immediate close/reopen, stale image/FileReader, game chrome.');
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
