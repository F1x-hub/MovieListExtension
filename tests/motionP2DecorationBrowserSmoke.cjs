const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { pageStyles } = require('./motionP0BrowserSmoke.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

async function main() {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const theme of ['dark-theme', 'light-theme']) {
            for (const reducedMotion of ['no-preference', 'reduce']) {
                const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
                await page.emulateMedia({ reducedMotion });
                await page.setContent(`<html class="${theme}"><style>${pageStyles('src/pages/home/home.html')}
                    #grid { display:grid;grid-template-columns:repeat(3, 150px);gap:8px }
                    #grid > div { height:180px } #below { margin-top:1500px }
                    </style><body><div id="grid"></div><div id="below"><div style="height:100px">Below</div></div></body></html>`);
                await page.addScriptTag({ content: read('src/pages/home/HomeRenderer.js') });
                const result = await page.evaluate(() => {
                    window.renderer = new HomeRenderer();
                    const grid = document.querySelector('#grid');
                    for (let i = 0; i < 30; i++) grid.appendChild(document.createElement('div'));
                    renderer.enterVisibleGrid(grid);
                    renderer.enterVisibleGrid(document.querySelector('#below'));
                    return {
                        count: grid.querySelectorAll('.home-card-animate').length,
                        delays: [...grid.querySelectorAll('.home-card-animate')].map(node => parseFloat(node.style.animationDelay)),
                        below: document.querySelector('#below .home-card-animate') !== null
                    };
                });
                assert.equal(result.count, reducedMotion === 'reduce' ? 0 : 6);
                assert(result.delays.every(delay => delay <= 120));
                assert.equal(result.below, false);
                await page.evaluate(async () => {
                    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
                    renderer.enterVisibleGrid(document.querySelector('#grid'));
                });
                assert.equal(await page.locator('.home-card-animate').count(), 0, 'refresh never repeats initial stagger');
                await page.setContent(`<html class="${theme}"><style>${pageStyles('src/pages/random/random.html')}</style><body>
                    <div class="result-placeholder"><div class="placeholder-icon-animated">Random</div></div>
                    <button class="btn-primary-gradient pulse-animation">Roll</button>
                    <div class="skeleton-title"></div><img class="skeleton-poster-img spinning"></body></html>`);
                const iterations = await page.evaluate(() => [
                    getComputedStyle(document.querySelector('.result-placeholder'), '::before'),
                    getComputedStyle(document.querySelector('.placeholder-icon-animated')),
                    getComputedStyle(document.querySelector('.btn-primary-gradient'), '::after'),
                    getComputedStyle(document.querySelector('.pulse-animation')),
                    getComputedStyle(document.querySelector('.skeleton-title')),
                    getComputedStyle(document.querySelector('.spinning'))
                ].map(style => ({ name: style.animationName, iterations: style.animationIterationCount })));
                assert(iterations.every(item => item.iterations !== 'infinite'), 'decorative effects have bounded cycles');
                if (reducedMotion === 'reduce') assert(iterations.every(item => item.name === 'none'));
                await page.close();
            }
        }
        console.log('PASS motion P2 decoration: first visible batch, no refresh stagger, finite Random effects, both themes/reduce');
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
