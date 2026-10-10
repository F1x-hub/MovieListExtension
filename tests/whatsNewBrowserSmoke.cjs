const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
async function checkLayout(page) {
    await page.waitForFunction(() => {
        const panel = document.querySelector('.whats-new-version-panel');
        return panel?.getBoundingClientRect().height > 0 && getComputedStyle(panel).visibility === 'visible';
    });
    const state = await page.locator('.whats-new-version-panel').evaluateAll(panels => panels.map(panel => ({
        height: panel.getBoundingClientRect().height,
        visibility: getComputedStyle(panel).visibility,
        expanded: document.getElementById(panel.getAttribute('aria-labelledby')).getAttribute('aria-expanded'),
        children: panel.children.length,
        inert: panel.inert
    })));
    assert(state[0].height > 0 && state[0].visibility === 'visible' && state[0].expanded === 'true');
    assert.equal(state[0].children, 1, 'the grid panel needs one content wrapper');
    assert.equal(state[0].inert, false);
    assert(state.slice(1).every(panel => panel.height === 0 && panel.expanded === 'false' && panel.inert), 'older panels must collapse to zero height');
    const firstItem = page.locator('.whats-new-list li strong').first();
    assert(await firstItem.isVisible(), 'first highlight must be visible');
    const bounds = await firstItem.boundingBox();
    assert(bounds.height > 0 && bounds.y >= 0 && bounds.y + bounds.height <= page.viewportSize().height);
    const rotation = await page.locator('.whats-new-version-chevron').first().evaluate(node => new DOMMatrix(getComputedStyle(node).transform).b);
    assert(Math.abs(rotation - 1) < 0.01, 'open chevron rotates 90 degrees');
}
const fixture = (prefix, preview) => `<!doctype html><html><head>${[
    'shared/styles/common.css', 'shared/styles/theme.css', 'shared/styles/components.css',
    'shared/styles/navigation.css', 'pages/settings/settings.css'
].map(file => `<link rel="stylesheet" href="/${prefix}/${file}">`).join('')}</head>
<body class="settings-page-body"><script>
window.chrome = { runtime: { getManifest: () => ({version:'1.3.5'}) }, storage: {
 local: {get: async () => ({whatsNewV1:{seenVersion:'1.3.5'}}), set: async () => {}},
 sync: {get: async () => ({language:'ru'})},
 onChanged: {addListener() {}, removeListener() {}}
}};
</script><script type="module">
import { i18n } from '/${prefix}/shared/i18n/I18n.js';
import { WhatsNewDialog } from '/${prefix}/shared/components/WhatsNewDialog.js';
await i18n.init();
window.dialog = new WhatsNewDialog();
await window.dialog.open({manual:true,preview:${preview}});
window.ready = true;
</script></body></html>`;

(async () => {
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/fixture') {
            response.setHeader('Content-Type', 'text/html');
            return response.end(fixture(url.searchParams.get('prefix') || 'src', url.searchParams.get('preview') !== 'false'));
        }
        const file = path.resolve(root, '.' + url.pathname);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
            response.writeHead(404); return response.end();
        }
        response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
        fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({headless:true});
    try {
        for (const prefix of ['src', 'dist/src']) {
            const page = await browser.newPage({viewport:{width:400,height:520},reducedMotion:'reduce'});
            await page.goto(`http://127.0.0.1:${server.address().port}/fixture?prefix=${prefix}`);
            await page.waitForFunction(() => window.ready);
            await checkLayout(page);
            for (const language of ['en', 'ru']) {
                await page.evaluate(language => {
                    document.body.classList.toggle('light-theme', language === 'en');
                    window.i18n.setLanguage(language, {persist:false});
                }, language);
                await checkLayout(page);
            }
            assert.equal(await page.locator('.whats-new-version-date').first().textContent(), '· 10 октября 2026');
            const toggle = page.locator('.whats-new-version-toggle').first();
            await toggle.focus(); await page.keyboard.press('Enter');
            assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
            assert.equal(await page.locator('.whats-new-version-panel').first().evaluate(node => node.getBoundingClientRect().height), 0);
            await page.keyboard.press('Space'); await checkLayout(page);
            console.log(`${prefix}: preview layout, language changes, light/dark and keyboard passed`);
            await page.goto(`http://127.0.0.1:${server.address().port}/fixture?prefix=${prefix}&preview=false`);
            await page.waitForFunction(() => window.ready);
            await checkLayout(page);
            assert((await page.locator('.whats-new-version-toggle').first().textContent()).includes('Версия 1.3.5'));
            console.log(`${prefix}: published history opens newest version`);
            await page.close();
        }
        const page = await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
        await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== '127.0.0.1' || url.pathname.includes('/libs/firebase')) return route.fulfill({body:'',contentType:'text/javascript'});
            return route.continue();
        });
        await page.addInitScript(() => {
            const storage = {get: async () => ({language:'ru',whatsNewV1:{seenVersion:'1.3.5'}}),set:async () => {}};
            window.chrome = {runtime:{getManifest:()=>({version:'1.3.5'}),getURL:value=>value,
                sendMessage:async()=>({safe:true}),onMessage:{addListener(){}}},
            storage:{local:storage,sync:storage,onChanged:{addListener(){},removeListener(){}}}};
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/src/pages/settings/settings.html?whatsNewPreview=draft`);
        await page.waitForSelector('.whats-new-version-panel.is-open');
        await checkLayout(page);
        await page.evaluate(() => window.i18n.setLanguage('en', {persist:false}));
        await checkLayout(page);
        console.log('Settings HTML with real page scripts and mocked Chrome/network: preview layout passed');
        await page.close();
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
