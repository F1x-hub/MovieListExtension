const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

(async () => {
    const baseline = process.argv.includes('--baseline');
    const cleaner = baseline
        ? execFileSync('git', ['show', 'HEAD:content-scripts/player-cleaner.js'], { encoding: 'utf8' })
        : fs.readFileSync(path.join(__dirname, '../content-scripts/player-cleaner.js'), 'utf8');
    const browser = await chromium.launch({ headless: true });
    try {
        for (const [theme, width] of [['dark', 1100], ['light', 1100], ['dark', 420], ['light', 420]]) {
            const page = await browser.newPage({ viewport: { width, height: 720 } });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('http://player-fixture.test/**', route => route.fulfill({
                contentType: 'text/html', body: `<body class="${theme}-theme"><div id="videoContainer"
                class="video-container"><video src="http://player-fixture.test/movie.webm"></video></div></body>`
            }));
            await page.goto('http://player-fixture.test/');
            await page.evaluate(() => {
                window.chrome = { runtime: { id: 'test', getURL: () => 'data:text/javascript,' } };
                const movie = document.querySelector('video');
                Object.defineProperty(movie, 'duration', { value: 300 });
                Object.defineProperty(movie, 'buffered', {
                    value: { length: 1, start: () => 0, end: () => 120 }
                });
            });
            await page.addScriptTag({ content: `(function(window) { ${cleaner}\n})(new Proxy(window, {
                get(target, key) {
                    if (key === 'location') return {
                        protocol: 'chrome-extension:', origin: 'chrome-extension://test',
                        href: 'chrome-extension://test/player', hostname: 'test'
                    };
                    const value = Reflect.get(target, key, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                }
            }));` });
            await page.locator('.native-player-wrapper').waitFor();
            const scans = await page.evaluate(async () => {
                const query = document.querySelectorAll;
                let count = 0;
                document.querySelectorAll = function(selector) {
                    if (selector.startsWith('video:not(.native-player-wrapper')) count += 1;
                    return query.call(this, selector);
                };
                try {
                    for (let index = 0; index < 20; index += 1) {
                        document.querySelector('video').dispatchEvent(new Event('timeupdate'));
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                    return count;
                } finally {
                    document.querySelectorAll = query;
                }
            });
            assert.deepEqual(errors, []);
            assert.equal(scans, baseline ? 20 : 0, 'timeline rendering must not repeatedly rescan provider videos');
            assert.equal(await page.locator('.native-buffer-container > div').count(), 1,
                'buffered ranges remain rendered');
            console.log(`${baseline ? 'BASELINE' : 'CURRENT'} ${theme} ${width}px: 20 timeline renders, ${scans} provider rescans`);
            if (!baseline) {
                const swapped = await page.evaluate(async () => {
                    const next = document.createElement('video');
                    next.src = 'http://player-fixture.test/next.webm';
                    let readyState = 0;
                    let playCalls = 0;
                    Object.defineProperty(next, 'readyState', { get: () => readyState });
                    Object.defineProperty(next, 'error', { value: null });
                    next.play = () => { playCalls += 1; return Promise.resolve(); };
                    localStorage.setItem('movieExtension_autoplay_next', 'true');
                    localStorage.setItem('movieExtension_autoplay_start_time', '123');
                    document.getElementById('videoContainer').appendChild(next);
                    await new Promise(resolve => setTimeout(resolve, 0));
                    const beforeReady = playCalls;
                    readyState = 2;
                    next.dispatchEvent(new Event('loadeddata'));
                    return {
                        beforeReady, afterReady: playCalls,
                        sameElement: document.querySelector('.native-player-wrapper video') === next,
                        flag: localStorage.getItem('movieExtension_autoplay_next'),
                        marker: localStorage.getItem('movieExtension_autoplay_start_time')
                    };
                });
                assert.deepEqual(swapped, {
                    beforeReady: 0, afterReady: 1, sameElement: true, flag: null, marker: null
                }, 'episode swaps must preserve the provider element and start through bounded readiness exactly once');
                assert.deepEqual(errors, []);
            }
            await page.close();
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
