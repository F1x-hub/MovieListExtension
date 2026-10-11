const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function stylesheet(file, seen = new Set()) {
    if (seen.has(file)) return '';
    seen.add(file);
    return read(file).replace(/@import\s+(?:url\(['"]?([^'"\)]+)['"]?\)|['"]([^'"]+)['"])\s*;/g, (_match, url, quoted) => {
        const ref = url || quoted;
        if (/^(?:https?:)?\/\//.test(ref)) return '';
        return stylesheet(path.posix.normalize(path.posix.join(path.posix.dirname(file), ref)), seen);
    });
}

function pageStyles(file) {
    return [...read(file).matchAll(/<link\b[^>]*>/g)].filter(match => /rel=["']stylesheet["']/.test(match[0]))
        .map(match => /href=["']([^"']+)["']/.exec(match[0])?.[1])
        .filter(ref => ref && !/^(?:https?:)?\/\//.test(ref))
        .map(ref => stylesheet(ref.startsWith('/') ? ref.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(file), ref))))
        .join('\n');
}

const fixture = '<div class="settings-main"><div class="settings-pane active"></div></div>' +
    '<div class="movie-details-page-container"><div class="movie-card-component fade-in"></div>' +
    '<div class="rating-card-entering rating-card-visible"></div></div>' +
    '<div class="main-container"></div><div class="app-loader__indicator"></div>' +
    '<div class="report-widget-drawer"></div><div class="toast motion-toast"></div><button class="btn btn-primary">Focus</button>' +
    '<div class="games-modal-overlay"><div id="gameProbe" style="animation: probe-game 2s linear infinite"></div></div>';

async function mount(page, css, theme, reducedMotion) {
    await page.emulateMedia({ reducedMotion });
    await page.setContent(`<html class="${theme}"><head><style>${css}</style>` +
        '<style>@keyframes probe-game { from { opacity: .5; } to { opacity: 1; } }</style></head>' +
        `<body class="${theme}">${fixture}</body></html>`);
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const pages = fs.readdirSync(path.join(root, 'src/pages')).flatMap(dir => {
            const folder = path.join(root, 'src/pages', dir);
            if (!fs.statSync(folder).isDirectory()) return [];
            return fs.readdirSync(folder).filter(name => name.endsWith('.html')).map(name => `src/pages/${dir}/${name}`);
        }).concat('src/popup/popup.html');
        let graphs = 0;
        for (const file of pages) {
            const css = pageStyles(file);
            if (!css.includes('--motion-duration-base:')) {
                assert(!/var\(--(?:motion-|ease-)/.test(css), `${file} uses motion without its token owner`);
                continue; // Static updater instructions have no shared-motion consumers.
            }
            graphs++;
            for (const theme of ['dark-theme', 'light-theme']) {
                await mount(page, css, theme, 'no-preference');
                const normal = await page.evaluate(() => {
                    const tokens = getComputedStyle(document.documentElement);
                    return { ease: tokens.getPropertyValue('--ease-out'), spring: tokens.getPropertyValue('--ease-spring'),
                        duration: tokens.getPropertyValue('--motion-duration-base') };
                });
                assert(normal.ease.trim() && normal.spring.trim(), `${file}/${theme}: missing easing aliases`);
                assert.equal(normal.duration.trim(), '180ms');
                await mount(page, css, theme, 'reduce');
                const reduced = await page.evaluate(() => Object.fromEntries([
                    '.movie-card-component', '.rating-card-entering', '.app-loader__indicator', '.toast', '.report-widget-drawer'
                ].map(selector => {
                    const style = getComputedStyle(document.querySelector(selector));
                    return [selector, { animation: style.animationName, transition: style.transitionDuration, scroll: style.scrollBehavior }];
                })));
                for (const [selector, style] of Object.entries(reduced)) {
                    assert.equal(style.animation, 'none', `${file}/${theme}/${selector}: animation under reduce`);
                    assert(style.transition.split(',').every(value => parseFloat(value) === 0), `${file}/${theme}/${selector}: transition under reduce`);
                    assert.equal(style.scroll, 'auto');
                }
                assert.equal(await page.locator('#gameProbe').evaluate(node => getComputedStyle(node).animationName), 'probe-game', 'shared policy must not disable game-owned animations');
                if (file.includes('/random/')) {
                    assert.equal(await page.locator('.main-container').evaluate(node => getComputedStyle(node).opacity), '1', 'Random remains visible without its entry animation');
                }
            }
        }

        const settingsCss = pageStyles('src/pages/settings/settings.html');
        await mount(page, settingsCss, 'dark-theme', 'no-preference');
        assert.equal(await page.locator('.settings-pane').evaluate(node => getComputedStyle(node).animationName), 'paneFadeIn');
        assert.equal(await page.locator('.toast').evaluate(node => getComputedStyle(node).animationName), 'ui-toast-enter');
        const drawer = page.locator('.report-widget-drawer');
        assert(await drawer.evaluate(node => parseFloat(getComputedStyle(node).transitionDuration) > 0), 'drawer transform transition exists');
        await drawer.evaluate(node => node.classList.add('open'));
        await page.waitForFunction(() => document.querySelector('.report-widget-drawer').getBoundingClientRect().left >= -1);
        const closing = await drawer.evaluate(node => {
            node.classList.remove('open');
            const style = getComputedStyle(node);
            return { visibility: style.visibility, pointerEvents: style.pointerEvents };
        });
        assert.equal(closing.visibility, 'visible', 'drawer stays rendered during exit');
        assert.equal(closing.pointerEvents, 'none', 'drawer interaction closes immediately');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.report-widget-drawer')).visibility === 'hidden');

        const settingsJs = read('src/pages/settings/settings.js');
        const toastFunction = settingsJs.slice(settingsJs.indexOf('    function showToast('), settingsJs.indexOf('    // Input Event Listeners for tracking dirty state'));
        await page.evaluate(code => {
            window.toastTimers = [];
            window.setTimeout = (callback, ms) => { window.toastTimers.push({ callback, ms }); return window.toastTimers.length; };
            window.eval(`${code}\nwindow.showMotionToast = showToast;`);
            window.showMotionToast('Saved');
        }, toastFunction);
        await page.evaluate(() => window.toastTimers.shift().callback());
        assert.equal(await page.evaluate(() => window.toastTimers[0].ms), 120, 'toast removal matches its real transition duration');
        assert(await page.locator('.toast').count() > 0, 'toast remains mounted for its visual exit');
        await page.evaluate(() => window.toastTimers.shift().callback());
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(() => { window.showMotionToast('Reduced'); window.toastTimers.shift().callback(); });
        assert.equal(await page.locator('.toast').count(), 0, 'the reduced-motion toast is removed immediately');
        assert.equal(await page.evaluate(() => window.toastTimers.length), 0, 'reduce does not schedule a removal wait');

        for (const order of [0, 1]) {
            const files = ['src/shared/styles/common.css', 'src/shared/styles/movie-card.css'];
            if (order) files.reverse();
            await mount(page, files.map(file => stylesheet(file)).join('\n'), 'dark-theme', 'no-preference');
            assert.equal(await page.locator('.movie-card-component').evaluate(node => getComputedStyle(node).animationName), 'mc-card-enter', 'card animation is independent of common/card stylesheet order');
        }
        for (const site of ['kinopoisk', 'imdb', 'hdrezka', 'kinogo', 'zfilms', 'ex-fs']) {
            const script = read(`content-scripts/${site}-watchlist-injected.js`);
            const css = site === 'ex-fs' ? /const styles = `([\s\S]*?)`;/m.exec(script)[1] : /style.textContent = `([\s\S]*?)`;/m.exec(script)[1];
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.setContent(`<style>${stylesheet('src/shared/styles/ex-fs-watchlist.css')}\n${css}</style><button class="movieListWatchlistBtn added"><span class="spin"></span></button><div class="movie-list-toast"></div>`);
            assert.equal(await page.locator('.spin').evaluate(node => getComputedStyle(node).animationName), 'none', `${site}: static spinner under reduce`);
            if (site === 'ex-fs') assert.equal(await page.locator('.movie-list-toast').evaluate(node => getComputedStyle(node).animationName), 'none');
        }
        console.log(`Motion P0 Chromium smoke passed: ${graphs} stylesheet graphs, dark/light, reduced motion, drawer exit, toast timing, CSS order and six injected adapters`);
    } finally {
        await browser.close();
    }
}

module.exports = { stylesheet, pageStyles };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
