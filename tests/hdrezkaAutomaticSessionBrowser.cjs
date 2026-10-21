const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionContext } = require('./helpers/extensionContext.cjs');
const { startFixtureServer } = require('./helpers/fixtureServer.cjs');
const { attachOffscreenRouting } = require('./helpers/offscreenRouting.cjs');

async function main() {
    const sink = await startFixtureServer({ port: 0 });
    let harness;
    let directRejections = 0;
    let streamRequests = 0;
    let siteNavigations = 0;
    let blockHidden = false;
    let hidden;
    const siteContexts = [];
    const movieUrl = 'https://hdrezka.co/films/fiction/1234-synthetic-film-2024.html';
    const movieHtml = '<!doctype html><h1>Fixture film</h1><ul id="translators-list"><li class="active" data-translator_id="56">Дубляж</li><li data-translator_id="336">Киномания</li></ul>';
    try {
        harness = await launchExtensionContext({ extensionPath: process.env.HDREZKA_TEST_EXTENSION_PATH, fixtureOrigin: sink.origin });
        const providerReply = ({ url, postData, source }) => {
            if (source === 'extension' || source === 'hidden' && blockHidden) {
                if (source === 'extension') directRejections++;
                return { status: 403, contentType: 'text/html', body: 'Just a moment... cf-chl' };
            }
            siteContexts.push(source);
            if (url.pathname === '/search/') return { status: 200, contentType: 'text/html', body:
                `<div class="b-content__inline_item"><div class="b-content__inline_item-link"><a href="${movieUrl}">Synthetic Film</a><div>2024</div></div></div>` };
            if (url.pathname === '/ajax/get_cdn_series/') {
                streamRequests++;
                assert.ok(['56', '336'].includes(new URLSearchParams(postData).get('translator_id')));
                return { status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, premium_content: 0,
                    quality: '480p', url: [480, 720].map(height => `[${height}p]https://ember.stream.voidboost.one/session/1234/${height}.m3u8`).join(',') }) };
            }
            // Fetch.fulfillRequest bypasses the DNR response-header stage, so
            // this fixture represents the homepage after its narrow XFO rule.
            return { status: 200, contentType: 'text/html', body: movieHtml };
        };
        await harness.context.route('https://hdrezka.co/**', async route => {
            const request = route.request();
            const url = new URL(request.url());
            if (request.isNavigationRequest()) siteNavigations++;
            return route.fulfill(providerReply({ url, postData: request.postData(),
                source: request.isNavigationRequest() || request.frame().url().startsWith('https://hdrezka.co/') ? 'site' : 'extension' }));
        });
        await harness.context.route('https://ember.stream.voidboost.one/**', route => {
            const url = new URL(route.request().url());
            const file = url.pathname.endsWith('.m3u8') ? 'index.m3u8' : path.basename(url.pathname);
            return route.fulfill({ status: 200, contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
                body: fs.readFileSync(path.join(__dirname, 'fixtures/hls-vp9', file)) });
        });
        // Playwright context.route does not cover real offscreen targets.
        hidden = await attachOffscreenRouting(harness, request => providerReply({ ...request, url: new URL(request.url), source: 'hidden' }));
        const page = await harness.context.newPage();
        await page.goto(`chrome-extension://${harness.extensionId}/tests/fixtures/hdrezka-provider.html`);
        await page.bringToFront();
        page.setDefaultTimeout(15000);
        await page.evaluate(() => {
            window.siteTabsCreated = [];
            chrome.tabs.onCreated.addListener(tab => {
                if (tab.pendingUrl?.startsWith('https://hdrezka.co/') || tab.url?.startsWith('https://hdrezka.co/')) siteTabsCreated.push({ id: tab.id, active: tab.active });
            });
            window.hdService = new HdrezkaSessionService();
            window.hdParser = new HdrezkaParser({ service: hdService });
        });
        assert.equal((await page.evaluate(() => chrome.tabs.query({ url: 'https://hdrezka.co/*' }))).length, 0, 'start without a manually opened provider tab');
        // Native tabs.create may finish the first navigation before Playwright
        // attaches request interception. Hold only that API's return until the
        // test-owned target is routed; application acquisition/messaging still
        // runs unchanged, and missed navigation stays denied by the fixture.
        await harness.worker.evaluate(() => {
            const create = chrome.tabs.create.bind(chrome.tabs);
            globalThis.hdFixtureCreated = new Map();
            chrome.tabs.create = async options => {
                const tab = await create(options);
                if (options.url?.startsWith('https://hdrezka.co/')) await new Promise(resolve => hdFixtureCreated.set(tab.id, resolve));
                return tab;
            };
        });
        let fixtureAttachError;
        harness.context.on('page', child => { void (async () => {
            await child.waitForLoadState('domcontentloaded');
            if (child.url() === 'chrome-error://chromewebdata/') {
                assert.equal(siteNavigations, 0, 'only a demonstrated interception miss may be reloaded');
                await child.goto('https://hdrezka.co/');
                console.log('HDRezka fixture: API-created navigation missed interception; routed the same owned tab before releasing native create.');
            }
            assert.equal(new URL(child.url()).origin, 'https://hdrezka.co');
            for (let attempt = 0; attempt < 100; attempt++) {
                const released = await harness.worker.evaluate(() => {
                    const entry = [...hdFixtureCreated.entries()][0];
                    if (!entry) return false;
                    hdFixtureCreated.delete(entry[0]); entry[1](); return true;
                });
                if (released) return;
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            throw new Error('Native create fixture barrier was not registered');
        })().catch(error => { fixtureAttachError = error; }); });
        const discovered = await page.evaluate(async () => {
            const [first, simultaneous] = await Promise.all([
                hdParser.cachedSearch('Synthetic Film', 2024, { mediaType: 'FILM' }),
                new HdrezkaSessionService().request('search', { query: 'Synthetic Film' })
            ]);
            window.hdSources = first ? await hdParser.cachedVideoSources(first) : [];
            return { url: first?.url, duplicateCount: simultaneous.results.length, sources: hdSources.length };
        }).catch(async error => {
            console.error('Owned fixture diagnostics:', await page.evaluate(async () => ({ tabs: (await chrome.tabs.query({ url: 'https://hdrezka.co/*' }))
                .map(tab => ({ id: tab.id, status: tab.status, active: tab.active, url: tab.url, pendingUrl: tab.pendingUrl })), created: siteTabsCreated })), harness.context.pages().map(child => child.url()));
            throw error;
        });
        if (fixtureAttachError) throw fixtureAttachError;
        assert.equal(discovered.url, movieUrl, 'cold discovery recovers automatically from extension 403');
        assert.equal(discovered.duplicateCount, 1);
        assert.equal(discovered.sources, 1);
        const tabs = await page.evaluate(async () => ({ site: await chrome.tabs.query({ url: 'https://hdrezka.co/*' }), current: await chrome.tabs.getCurrent(), created: siteTabsCreated }));
        assert.equal(tabs.site.length, 0, 'cold acquisition uses the real hidden context without a site tab');
        assert.equal(tabs.current.active, true, 'automatic acquisition preserves the film page focus');
        assert.deepEqual(tabs.created, []);
        assert.equal(directRejections, 2, 'only the two initial callers attempt rejected direct fetches');
        assert.ok(siteContexts.length >= 3 && siteContexts.every(value => value === 'hidden'));
        const rule = await page.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).find(value => value.id === 5070));
        assert.deepEqual(rule.condition.initiatorDomains, [harness.extensionId]);
        assert.deepEqual(rule.condition.resourceTypes, ['sub_frame']);
        assert.equal(rule.condition.regexFilter, '^https://hdrezka\\.co/(#movielist-hdrezka=[a-f0-9]+)?$');
        assert.deepEqual(rule.action.responseHeaders, [{ header: 'x-frame-options', operation: 'remove' }]);
        const matches = await page.evaluate(async () => {
            const origin = chrome.runtime.getURL('').replace(/\/$/, '');
            const requests = [
                { url: 'https://hdrezka.co/', type: 'sub_frame', initiator: origin },
                { url: `https://hdrezka.co/#movielist-hdrezka=${'a'.repeat(32)}`, type: 'sub_frame', initiator: origin },
                { url: 'https://hdrezka.co/?other=1', type: 'sub_frame', initiator: origin },
                { url: 'https://hdrezka.co/films/fiction/1234-synthetic-film-2024.html', type: 'sub_frame', initiator: origin },
                { url: 'https://hdrezka.co/#other', type: 'sub_frame', initiator: origin },
                { url: 'https://hdrezka.co/', type: 'main_frame', initiator: origin },
                { url: 'https://hdrezka.co/', type: 'sub_frame', initiator: 'https://example.test' }
            ];
            return Promise.all(requests.map(async request => (await chrome.declarativeNetRequest.testMatchOutcome(request)).matchedRules.some(value => value.ruleId === 5070)));
        });
        assert.deepEqual(matches, [true, true, false, false, false, false, false], 'embedding rule stays confined to the marked homepage and this extension');
        assert.equal(await page.evaluate(async () => {
            const video = await hdParser.renderPlayer(document.getElementById('videoContainer'), hdSources, { movieId: '838', resolvedTimestamp: 1 });
            if (video) { video.muted = true; await video.play(); }
            return Boolean(video);
        }), true);
        await page.waitForFunction(() => document.querySelector('video[data-progress-owner="canonical"]')?.currentTime > 1.1);
        await page.locator('video[data-progress-owner="canonical"]').evaluate(video => { video.pause(); video.currentTime = 3; });
        await page.waitForFunction(() => !document.querySelector('video').seeking);
        await page.evaluate(() => document.querySelector('[data-quality-option="720"]').click());
        await page.waitForFunction(() => document.querySelector('[data-quality-option="720"]')?.classList.contains('active') && document.querySelector('video')?.readyState >= 2);
        assert.equal(await page.evaluate(() => hdParser.changeTranslation(document.getElementById('videoContainer'), '336')), true);
        await page.waitForFunction(() => document.querySelector('[data-voiceover-option="336"]')?.classList.contains('active') && document.querySelector('video')?.readyState >= 2);
        assert.equal(streamRequests, 2, 'quality reuses links and dubbing gets fresh links');
        assert.equal(await page.evaluate(() => siteTabsCreated.length), 0, 'hidden playback and settings create no site tabs');
        assert.equal(await page.evaluate(async () => (await chrome.tabs.getCurrent()).active), true);
        assert.equal(await page.locator('video[data-progress-owner="canonical"]').evaluate(video => video.paused && Math.abs(video.currentTime - 3) < 0.4), true);
        assert.equal(await page.locator('[data-hdrezka-resolver]').count(), 0);
        for (const theme of ['dark', 'light']) {
            await page.evaluate(value => ThemeService.applyTheme(value, { persist: false, syncChromeStorage: false }), theme);
            await page.screenshot({ path: path.join(__dirname, `../artifacts/hdrezka-provider/automatic-session-${theme}.png`), fullPage: true, animations: 'disabled' });
        }
        // A normal-tab fallback must disappear while acquired video stays usable.
        blockHidden = true;
        assert.equal((await page.evaluate(() => hdService.request('search', { query: 'Synthetic Film' }))).results.length, 1);
        const temporary = await page.evaluate(async () => ({ tabs: await chrome.tabs.query({ url: 'https://hdrezka.co/*' }), created: siteTabsCreated }));
        assert.equal(temporary.tabs.length, 1);
        assert.deepEqual(temporary.created, [{ id: temporary.tabs[0].id, active: false }]);
        assert.equal(await page.evaluate(async id => {
            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
                try { await chrome.tabs.get(id); } catch { return true; }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            return false;
        }, temporary.tabs[0].id), true, 'the temporary tab is physically removed after idle discovery');
        assert.equal(await page.evaluate(async () => (await chrome.tabs.getCurrent()).active), true);
        const resumedAt = await page.locator('video[data-progress-owner="canonical"]').evaluate(async video => { const time = video.currentTime; await video.play(); return time; });
        await page.waitForFunction(time => document.querySelector('video[data-progress-owner="canonical"]').currentTime > time + 0.4, resumedAt);
        await page.locator('video[data-progress-owner="canonical"]').evaluate(video => video.pause());
        const beforeQuality = streamRequests;
        await page.evaluate(() => document.querySelector('[data-quality-option="480"]').click());
        await page.waitForFunction(() => document.querySelector('[data-quality-option="480"]')?.classList.contains('active') && document.querySelector('video')?.readyState >= 2);
        assert.equal(streamRequests, beforeQuality, 'quality uses acquired variants after the bootstrap tab closes');
        assert.equal(await page.evaluate(() => siteTabsCreated.length), 1, 'quality never reopens the bootstrap');
        blockHidden = false; // Synthetic recovery, not a live clearance claim.
        assert.equal(await page.evaluate(() => hdParser.changeTranslation(document.getElementById('videoContainer'), '56')), true);
        await page.waitForFunction(() => document.querySelector('[data-voiceover-option="56"]')?.classList.contains('active') && document.querySelector('video')?.readyState >= 2);
        assert.equal(await page.evaluate(() => siteTabsCreated.length), 1, 'dubbing uses the recovered hidden session');
        const remaining = await page.evaluate(async () => ({ tabs: await chrome.tabs.query({ url: 'https://hdrezka.co/*' }),
            contexts: (await chrome.runtime.getContexts({})).map(value => ({ type: value.contextType, url: value.documentUrl })) }));
        assert.equal(remaining.tabs.length, 0, JSON.stringify({ remaining, temporaryId: temporary.tabs[0].id, errors: hidden.errors }));
        assert.deepEqual(hidden.errors, []);
        await page.evaluate(() => hdService.dispose());
        console.log('HDRezka automatic session: real offscreen discovery and HLS/settings without site tabs; inactive fallback closes after discovery, preserves focus and does not reopen for quality.');
    } finally { await hidden?.close(); await harness?.close(); await sink.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
