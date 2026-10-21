const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionContext } = require('./helpers/extensionContext.cjs');
const { startFixtureServer } = require('./helpers/fixtureServer.cjs');

async function main() {
    const sink = await startFixtureServer({ port: 0 });
    let harness;
    let redirectTarget = null;
    let challenge = false;
    let detailsChallenge = false;
    let heldDetails = null;
    let streamRequests = 0;
    let expiredManifests = 0;
    let responseMode = null;
    let invalidManifest = false;
    let cdnFailureMode = null;
    let heldResolution = null;
    const translations = [];
    const cdnRequests = [];
    const providerRequestContexts = [];
    const providerNavigations = [];
    const movieUrl = 'https://hdrezka.co/films/fiction/1234-synthetic-film-2024.html';
    const movieHtml = '<!doctype html><h1>Synthetic Film</h1><ul id="translators-list"><li><a class="b-translator__item b-prem_translator active" data-translator_id="111">HDrezka Studio</a></li><li data-translator_id="56">Дубляж</li><li data-translator_id="336">Киномания</li></ul><input id="ctrl_favs" value="fixture-only">';
    try {
        harness = await launchExtensionContext({ extensionPath: process.env.HDREZKA_TEST_EXTENSION_PATH, fixtureOrigin: sink.origin });
        harness.context.on('page', child => {
            child.on('console', message => { if (message.type() === 'error' && /resolver|Port|receiv|connect/i.test(message.text())) console.log(message.text()); });
            child.on('pageerror', error => console.log('resolver-page-error', error.message));
        });
        await harness.context.route('https://hdrezka.co/**', async route => {
            const request = route.request();
            const url = new URL(request.url());
            if (request.isNavigationRequest()) providerNavigations.push(url.href);
            if (!request.isNavigationRequest()) {
                try { providerRequestContexts.push(new URL(request.frame().url()).protocol); }
                catch { providerRequestContexts.push('worker'); }
            }
            if (heldDetails && url.href === movieUrl && !request.isNavigationRequest()) await heldDetails;
            if (challenge || detailsChallenge && url.href === movieUrl) return route.fulfill({ status: 403, contentType: 'text/html', body: 'Just a moment... cf-chl' });
            if (url.pathname === '/search/') return route.fulfill({ status: 200, contentType: 'text/html', body:
                `<div class="b-content__inline_item"><div class="b-content__inline_item-link"><a href="${movieUrl}">Synthetic Film</a><div>2024, США, Фантастика</div></div></div>` });
            if (url.pathname === '/ajax/get_cdn_series/') {
                streamRequests += 1;
                const params = new URLSearchParams(request.postData());
                translations.push(params.get('translator_id'));
                if (responseMode === 'invalid-response') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Unexpected upstream response</html>' });
                if (params.get('translator_id') === '111' || responseMode === 'premium') {
                    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, premium_content: 1 }) });
                }
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, premium_content: 0,
                    quality: '480p', url: responseMode === 'empty' ? '' : [480, 720].map(height => `[${height}p]https://${height === 480 ? 'ember' : 'eleos'}.stream.voidboost.one/session/1234/${height}.m3u8`).join(',') }) });
            }
            return route.fulfill({ status: 200, contentType: 'text/html', body: movieHtml });
        });
        await harness.context.route('https://stream.voidboost.one/**', route => { cdnRequests.push('router'); return route.fulfill({ status: 302, headers: {
            location: redirectTarget || route.request().url().replace('://stream.', route.request().url().includes('/480.m3u8') ? '://ember.stream.' : '://eleos.stream.')
        } }); });
        await harness.context.route(/^https:\/\/(?:ember|eleos)\.stream\.voidboost\.one\//, async route => {
            const url = new URL(route.request().url());
            cdnRequests.push(url.hostname);
            if (heldResolution?.url === url.href) {
                await heldResolution.release;
                await route.abort('aborted').catch(() => {});
                return;
            }
            if (cdnFailureMode === 'network') return route.abort('blockedbyclient');
            if (cdnFailureMode === 'http') return route.fulfill({ status: 503, body: 'Private upstream details must not enter diagnostics' });
            if (cdnFailureMode === 'json') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"token":"fixture-secret"}' });
            if (invalidManifest) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Not an HLS manifest</html>' });
            if (url.pathname.endsWith('.m3u8') && expiredManifests > 0) {
                expiredManifests -= 1;
                return route.fulfill({ status: 403 });
            }
            const file = url.pathname.endsWith('.m3u8') ? 'index.m3u8' : path.basename(url.pathname);
            const full = path.join(__dirname, 'fixtures/hls-vp9', file);
            assert.ok(fs.existsSync(full));
            return route.fulfill({ status: 200, contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4', body: fs.readFileSync(full) });
        });
        const providerPage = await harness.context.newPage();
        await providerPage.goto('https://hdrezka.co/');
        const page = await harness.context.newPage();
        const failureDiagnostics = [];
        page.on('console', message => { if (message.text().startsWith('[HDRezka] Playback failed')) failureDiagnostics.push(message.text()); });
        await page.goto(`chrome-extension://${harness.extensionId}/tests/fixtures/hdrezka-provider.html`);
        await page.addScriptTag({ url: `chrome-extension://${harness.extensionId}/src/pages/movie-details/movie-details.js`, type: 'module' });
        page.setDefaultTimeout(15000);
        await page.waitForFunction(() => window.PlayerLocale?.ready);
        await page.evaluate(() => PlayerLocale.setLocale('ru'));
        assert.equal(await page.evaluate(() => typeof window.Hls), 'undefined', 'exercise the same cold lazy HLS start as MovieDetails');
        const pagesAtStart = harness.context.pages().length;
        let additionalPages = 0;
        let expectedExplicitPages = 0;
        harness.context.on('page', () => { additionalPages += 1; });
        const assertNoNewPages = label => assert.equal(additionalPages, expectedExplicitPages, `${label} must not open automatic tabs`);
        const assertResolverClean = async label => assert.equal(await page.evaluate(() => {
            const source = chrome.runtime.getURL('src/pages/hdrezka-resolver/resolver.html');
            return [...document.querySelectorAll('iframe')].filter(frame => frame.src.startsWith(source)).length;
        }), 0, `${label} removes the hidden resolver iframe`);
        const baselineRules = await page.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).map(rule => rule.id));
        const discovery = await page.evaluate(async () => {
            window.hdService = new HdrezkaSessionService();
            const resolve = hdService.resolve.bind(hdService);
            hdService.resolve = async value => { try { return await resolve(value); } catch (error) { window.resolveFailure = error.message; throw error; } };
            window.hdParser = new HdrezkaParser({ service: hdService });
            const result = await hdParser.cachedSearch('Synthetic Film', 2024, { mediaType: 'FILM' });
            window.hdSources = await hdParser.cachedVideoSources(result);
            return { result, sources: hdSources, access: hdParser.accessRequired,
                probe: result ? null : await hdService.request('search', { query: 'Synthetic Film' }).catch(error => ({ code: error.code })) };
        });
        assert.ok(discovery.result, JSON.stringify(discovery));
        assert.equal(discovery.result.url, movieUrl);
        assert.equal(JSON.stringify(discovery.sources).includes('m3u8'), false);
        assert.ok(providerRequestContexts.includes('https:'), 'an existing user-opened site tab serves MAIN requests');
        assertNoNewPages('search and source discovery');
        assert.equal(providerPage.isClosed(), false, 'discovery preserves the existing user site tab');
        const mounted = await page.evaluate(async () => {
            window.hdStates = [];
            const video = await hdParser.renderPlayer(document.getElementById('videoContainer'), hdSources, {
                movieId: '838', resolvedTimestamp: 1, onProviderDubChange: id => window.owner.onProviderDubChange(id), onLifecycleState: state => {
                    hdStates.push(state); document.getElementById('status').textContent = state;
                }
            });
            if (video) { video.muted = true; await video.play(); }
            return { mounted: Boolean(video), resolveFailure: window.resolveFailure || null, states: hdStates };
        });
        assert.equal(mounted.mounted, true, JSON.stringify({ ...mounted, cdnRequests }));
        assertNoNewPages('initial playback');
        await assertResolverClean('initial playback');
        assert.ok(cdnRequests.includes('ember.stream.voidboost.one'), 'the default 480p path must be tested on its own CDN');
        await page.waitForFunction(() => document.querySelector('video[data-progress-owner="canonical"]')?.currentTime > 1.2);
        assert.equal(await page.locator('.native-player-wrapper').count(), 1, 'the real player-cleaner owns the native controls');
        assert.equal(await page.evaluate(() => LazyLoader.isLoaded('../../shared/lib/hls.min.js')), true);
        assert.deepEqual(translations, ['56']);
        const original = await page.locator('video[data-progress-owner="canonical"]').elementHandle();
        await page.locator('video[data-progress-owner="canonical"]').evaluate(video => { video.currentTime = 3; });
        await page.waitForFunction(() => !document.querySelector('video[data-progress-owner="canonical"]').seeking && document.querySelector('video[data-progress-owner="canonical"]').currentTime > 3.1);
        const position = await page.locator('video[data-progress-owner="canonical"]').evaluate(video => { video.pause(); return video.currentTime; });
        await page.locator('.player-settings-button').click();
        await page.locator('.player-settings-menu').getByText('Качество', { exact: true }).click();
        // Navigate synchronously before the quality view's delayed refresh can
        // run, then prove that its stale timer cannot replace the voice menu.
        await page.evaluate(() => {
            const menu = document.querySelector('.player-settings-menu');
            [...menu.querySelectorAll('[role="menuitemradio"]')].find(node => node.textContent.trim() === '720p').click();
            menu.querySelector('.player-settings-menu__back').click();
            [...menu.querySelectorAll('.player-settings-menu__item')]
                .find(node => node.querySelector('.player-settings-menu__label')?.textContent === 'Озвучка').click();
        });
        assert.equal(await page.locator('.player-settings-menu__back').innerText(), 'Озвучка');
        await page.waitForTimeout(250);
        assert.equal(await page.locator('.player-settings-menu__back').innerText(), 'Озвучка', 'an old quality refresh must preserve the newer voice view');
        assert.deepEqual(await page.locator('.player-settings-menu [role="menuitemradio"]').allTextContents(), ['Дубляж', 'Киномания']);
        await page.keyboard.press('Escape');
        await page.waitForFunction(time => {
            const video = document.querySelector('video[data-progress-owner="canonical"]');
            return document.querySelector('[data-quality-option="720"]')?.classList.contains('active')
                && video?.readyState >= 2 && Math.abs(video.currentTime - time) < 0.3;
        }, position);
        assert.ok(cdnRequests.includes('eleos.stream.voidboost.one'), 'quality changes may resolve to a different reviewed CDN');
        assert.equal(await original.evaluate(node => node === document.querySelector('video[data-progress-owner="canonical"]')), true, 'quality switch preserves canonical video');
        assert.equal(await page.locator('video[data-progress-owner="canonical"]').evaluate(video => video.paused), true, 'quality switch preserves pause');
        assert.equal(streamRequests, 1, 'quality selection reuses only this mount response');
        assertNoNewPages('quality switching');
        await assertResolverClean('quality switching');
        await page.evaluate(async () => {
            window.owner = Object.assign(Object.create(MovieDetailsManager.prototype), {
                elements: { videoContainer: document.getElementById('videoContainer'), sourceButtonsContainer: document.getElementById('sourceButtonsContainer') },
                parserRegistry: { get: id => id === 'hdrezka' ? hdParser : null, getAll: () => [hdParser] },
                selectedMovie: { kinopoiskId: '838', name: 'Synthetic Film', year: 2024, type: 'FILM' },
                sourceAvailability: new Map([['hdrezka', 'found']]), sourceProbeDone: true, activeSourceValue: 'parser:hdrezka', activePlayerId: 'hdrezka',
                normalizeVideoSources: () => [], refreshSourceButtonStates() {}, updateActiveSourceButton() {}
            });
            window.controller = new PlaybackController();
            controller.setSelection({ kinopoiskId: '838', mediaType: 'FILM', initialTimestamp: 1 });
            owner.playbackController = controller;
            owner.bindProviderVideoTracking('hdrezka');
            owner.populateSourceSelector();
            owner.refreshProviderDubSelector('hdrezka');
        });
        assert.equal(await page.locator('#sourceDubControl').isVisible(), false, 'HDRezka dubbing belongs only to player settings');
        await page.locator('.player-settings-button').click();
        await page.locator('.player-settings-menu').getByText('Озвучка', { exact: true }).click();
        await page.locator('.player-settings-menu').getByRole('menuitemradio', { name: 'Киномания', exact: true }).click();
        await page.waitForFunction(time => {
            const video = document.querySelector('video[data-progress-owner="canonical"]');
            return document.querySelector('[data-voiceover-option="336"]')?.classList.contains('active') && video?.readyState >= 2 && Math.abs(video.currentTime - time) < 0.3;
        }, position);
        await page.keyboard.press('Escape');
        assert.equal(await original.evaluate(node => node === document.querySelector('video[data-progress-owner="canonical"]')), true, 'settings dubbing change keeps the canonical video');
        assert.equal(await page.locator('video[data-progress-owner="canonical"]').evaluate(video => video.paused), true, 'settings dubbing change preserves pause');
        assert.deepEqual(translations, ['56', '336'], 'dub switch requests a fresh matching translation');
        const state = await page.evaluate(() => ({ dub: document.getElementById('videoContainer').__providerDubState.activeTranslationId,
            hasCanonicalProgress: document.querySelector('video[data-progress-owner="canonical"]').dataset.progressOwner === 'canonical', states: hdStates }));
        assert.equal(state.dub, '336');
        assert.equal(state.hasCanonicalProgress, true);
        assert.ok(state.states.includes('ready'));
        assertNoNewPages('dubbing switching');
        await assertResolverClean('dubbing switching');
        expiredManifests = 1;
        await page.evaluate(() => document.querySelector('[data-quality-option="480"]').click());
        await page.waitForFunction(() => document.querySelector('[data-quality-option="480"]')?.classList.contains('active') && document.querySelector('video[data-progress-owner="canonical"]')?.readyState >= 2);
        assert.equal(streamRequests, 3, 'expired manifest refreshes links once for the current translation');
        assert.deepEqual(translations, ['56', '336', '336']);
        assert.equal(await page.locator('video[data-progress-owner="canonical"]').evaluate(video => video.paused), true);
        assertNoNewPages('expired-link refresh');
        await assertResolverClean('expired-link refresh');
        await page.waitForFunction(() => !document.querySelector('video[data-progress-owner="canonical"]').seeking && document.querySelector('video[data-progress-owner="canonical"]').readyState >= 3);
        fs.mkdirSync(path.join(__dirname, '../artifacts/hdrezka-provider'), { recursive: true });
        for (const theme of ['dark', 'light']) {
            await page.evaluate(value => ThemeService.applyTheme(value, { persist: false, syncChromeStorage: false }), theme);
            for (const width of [1120, 375]) {
                await page.setViewportSize({ width, height: 850 });
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'source toolbar fits the viewport');
                await page.locator('.player-settings-button').click();
                await page.locator('.player-settings-menu').getByText('Озвучка', { exact: true }).click();
                assert.equal(await page.locator('.player-settings-menu [role="menuitemradio"][aria-checked="true"]').innerText(), 'Киномания');
                await page.screenshot({ path: path.join(__dirname, `../artifacts/hdrezka-provider/fixture-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
                await page.keyboard.press('Escape');
            }
        }
        const staleDub = await page.evaluate(async () => {
            const container = document.getElementById('videoContainer');
            const state = container.__providerDubState;
            const change = hdParser.changeTranslation;
            let finish;
            hdParser.changeTranslation = () => new Promise(resolve => { finish = resolve; });
            const pending = owner.onProviderDubChange('56');
            container.__providerDubState = { providerId: 'animego', contextId: 'other', activeTranslationId: '1',
                translations: [{ id: '1', name: 'Other dub' }, { id: '2', name: 'Second dub' }] };
            owner.activePlayerId = 'animego';
            owner.refreshProviderDubSelector('animego');
            const before = !document.getElementById('sourceDubControl').hidden;
            finish(false);
            await pending;
            const after = !document.getElementById('sourceDubControl').hidden;
            hdParser.changeTranslation = change;
            container.__providerDubState = state;
            owner.activePlayerId = 'hdrezka';
            owner.refreshProviderDubSelector('hdrezka');
            return { before, after };
        });
        assert.deepEqual(staleDub, { before: true, after: true }, 'a late HDRezka dub result does not hide the next provider controls');
        await page.evaluate(() => document.getElementById('videoContainer')._hdrezkaDispose());
        assert.equal(await page.evaluate(() => hdParser.disposers.size), 0);

        // The bundled resolver iframe's CSP stops an unapproved redirect
        // before the forbidden endpoint receives a request. No DNR is added.
        const before = sink.hits('/health');
        redirectTarget = `${sink.origin}/health`;
        const refused = await page.evaluate(async () => {
            try { await hdService.resolve('https://stream.voidboost.one/session/1234/480.m3u8'); return false; }
            catch { return true; }
        });
        assert.equal(refused, true);
        assert.equal(sink.hits('/health'), before, 'unapproved redirect receives zero requests');
        assertNoNewPages('forbidden redirect handling');
        await assertResolverClean('forbidden redirect handling');
        assert.deepEqual(await page.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).map(rule => rule.id)), baselineRules, 'iframe resolution does not change DNR rules');

        // Exercise a direct forbidden fetch inside the same bundled document;
        // rejecting an untrusted input before loading an iframe is insufficient
        // proof that its document-level CSP constrains actual network access.
        const resolverSource = `chrome-extension://${harness.extensionId}/src/pages/hdrezka-resolver/resolver.html#${'f'.repeat(32)}`;
        await page.evaluate(source => {
            const frame = document.createElement('iframe');
            frame.id = 'hdrezkaCspAuditFrame'; frame.hidden = true; frame.src = source;
            document.body.appendChild(frame);
        }, resolverSource);
        await page.waitForFunction(source => {
            const frame = document.getElementById('hdrezkaCspAuditFrame');
            return frame?.contentDocument?.readyState === 'complete' && frame.contentWindow.location.href === source;
        }, resolverSource);
        const resolverFrame = page.frames().find(frame => frame.url() === resolverSource);
        assert.ok(resolverFrame);
        const directForbidden = await resolverFrame.evaluate(async url => {
            let violation = false;
            addEventListener('securitypolicyviolation', event => { violation ||= event.effectiveDirective === 'connect-src'; });
            try { await fetch(url, { credentials: 'omit', redirect: 'follow' }); return { rejected: false, violation }; }
            catch {
                await new Promise(resolve => setTimeout(resolve, 0));
                return { rejected: true, violation };
            }
        }, `${sink.origin}/health`);
        assert.deepEqual(directForbidden, { rejected: true, violation: true });
        assert.equal(sink.hits('/health'), before, 'CSP blocks a direct forbidden fetch before network');
        await page.evaluate(() => document.getElementById('hdrezkaCspAuditFrame').remove());
        await assertResolverClean('direct forbidden fetch');

        const requestsBeforeScopeChecks = cdnRequests.length;
        const scopeFailures = await page.evaluate(async () => {
            const Loader = HlsPolicyLoader.forProfile('hdrezka', {
                providerManifestUrl: 'https://ember.stream.voidboost.one/session/1234/480.m3u8'
            });
            return Promise.all([
                'https://eleos.stream.voidboost.one/session/1234/part.ts',
                'https://ember.stream.voidboost.one/session/other/part.ts',
                'https://ember.stream.voidboost.one/session/1234/%2e%2e/other/part.ts'
            ].map(url => new Promise(resolve => new Loader().load({ url, responseType: 'arraybuffer', frag: { sn: 1 } },
                { timeout: 1000 }, { onError: error => resolve(error.text), onSuccess: () => resolve('unexpected-success'), onTimeout: () => resolve('unexpected-timeout') }))));
        });
        assert.deepEqual(scopeFailures, ['POLICY_VIOLATION', 'POLICY_VIOLATION', 'POLICY_VIOLATION']);
        assert.equal(cdnRequests.length, requestsBeforeScopeChecks, 'HLS origin/path failures make no network requests');

        // Dispose while the resolver's actual fetch is in flight. Removing its
        // frame must settle the caller and must not affect the next resolution.
        let releaseResolution;
        heldResolution = { url: 'https://ember.stream.voidboost.one/session/1234/cancel.m3u8',
            release: new Promise(resolve => { releaseResolution = resolve; }) };
        try {
            const pendingRequest = page.waitForRequest(request => request.url() === heldResolution.url);
            await page.evaluate(url => {
                window.cancelService = new HdrezkaSessionService();
                window.cancelOutcome = cancelService.resolve(url).then(() => 'unexpected-success', error => error.code);
            }, heldResolution.url);
            await pendingRequest;
            assert.equal(await page.locator('[data-hdrezka-resolver]').count(), 1);
            const canceled = await page.evaluate(async () => {
                cancelService.dispose();
                return { code: await cancelOutcome, cleanups: cancelService.cleanups.size };
            });
            assert.deepEqual(canceled, { code: 'HDREZKA_RESOLVER_DISCONNECTED', cleanups: 0 });
            await assertResolverClean('canceled resolution');
            assertNoNewPages('canceled resolution');
        } finally { releaseResolution(); heldResolution = null; }
        assert.equal(await page.evaluate(() => hdService.resolve('https://ember.stream.voidboost.one/session/1234/480.m3u8')),
            'https://ember.stream.voidboost.one/session/1234/480.m3u8', 'another service still resolves after cancellation');
        await assertResolverClean('resolution after cancellation');

        // Close only the tab explicitly opened by this test, then establish that
        // ordinary discovery falls back to extension fetch without replacing it.
        assert.equal(providerPage.isClosed(), false, 'playback never closes a user-owned site tab');
        await providerPage.close();
        const directDiscovery = await page.evaluate(async () => {
            hdParser.clearCache();
            const result = await hdParser.cachedSearch('Synthetic Film', 2024, { mediaType: 'FILM' });
            const sources = await hdParser.cachedVideoSources(result);
            const streams = await hdService.request('streams', { url: result.url, translationId: '56' });
            return { url: result?.url, sourceCount: sources.length, activeTranslationId: streams.activeTranslationId };
        });
        assert.equal(directDiscovery.url, movieUrl);
        assert.ok(directDiscovery.sourceCount > 0);
        assert.equal(directDiscovery.activeTranslationId, '56');
        assert.ok(providerRequestContexts.includes('chrome-extension:'), 'without a site tab, discovery runs in the extension');
        assertNoNewPages('extension-context discovery without a site tab');
        assert.equal(harness.context.pages().length, pagesAtStart - 1);
        // Exercise the explicit challenge fallback when automatic background
        // acquisition is unavailable. Automatic acquisition itself has its own
        // cold-session browser test with no pre-opened provider page.
        await page.evaluate(() => {
            const send = chrome.runtime.sendMessage.bind(chrome.runtime);
            window.hdOriginalSendMessage = send;
            chrome.runtime.sendMessage = (message, ...args) => message?.type === 'HDREZKA_SITE_REQUEST'
                ? Promise.resolve({ error: 'HDREZKA_ACCESS_REQUIRED' }) : send(message, ...args);
        });
        challenge = true;
        const blocked = await page.evaluate(async () => {
            hdParser.clearCache();
            return { result: await hdParser.cachedSearch('Synthetic Film', 2024, { mediaType: 'FILM' }), access: hdParser.accessRequired };
        });
        assert.equal(blocked.result, null);
        assert.equal(blocked.access, true);
        await page.evaluate(() => { owner.activeSourceValue = ''; owner.sourceAvailability.set('hdrezka', 'access-required'); owner.populateSourceSelector(); });
        await page.evaluate(() => owner.refreshProviderDubSelector(null));
        assert.equal(await page.locator('.source-btn').count(), 0, 'challenge actions never claim film availability');
        assert.equal(await page.getByRole('link', { name: 'Открыть HDRezka' }).count(), 1);
        assert.equal(await page.getByRole('button', { name: 'Повторить поиск HDRezka' }).count(), 1);
        for (const theme of ['dark', 'light']) {
            await page.evaluate(value => ThemeService.applyTheme(value, { persist: false, syncChromeStorage: false }), theme);
            assert.ok(await page.evaluate(() => [...document.querySelectorAll('.hdrezka-access-actions > .btn')]
                .every(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1)), 'access action labels fit without clipping');
            await page.screenshot({ path: path.join(__dirname, `../artifacts/hdrezka-provider/access-${theme}.png`), fullPage: true, animations: 'disabled' });
        }
        assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('voidboost.one'))), false);

        // The real manager's blocked-search path must offer access recovery even
        // when no background discovery repaint remains outstanding.
        const requestsBeforeBlockedRetry = providerRequestContexts.length;
        const blockedLoad = await page.evaluate(async () => {
            owner.sourceSwitchRequestId = 71;
            owner.playerRegistry = { hdrezka: { movieId: '838', initialized: false } };
            owner.unavailableProviderIds = new Set();
            owner.observePlayerMetrics = () => {};
            owner.syncWatchEntry = () => {};
            owner.invalidateSourceCache = () => {};
            window.automaticFallbacks = 0;
            owner.handleWatchSourceFailure = () => { automaticFallbacks += 1; };
            const loaded = await owner.loadParserSource('hdrezka');
            return { loaded, access: hdParser.accessRequired, fallbackCount: automaticFallbacks };
        });
        assert.deepEqual(blockedLoad, { loaded: false, access: true, fallbackCount: 0 });
        assert.equal(providerRequestContexts.length, requestsBeforeBlockedRetry, 'failed automatic acquisition does not repeat direct requests');
        assert.equal(await page.getByRole('link', { name: 'Открыть HDRezka' }).count(), 1);
        assert.ok((await page.locator('.player-source-lifecycle__message').innerText()).includes('оставьте вкладку открытой'));
        assertNoNewPages('blocked search recovery');

        const navigationsBeforeOpen = providerNavigations.length;
        expectedExplicitPages += 1;
        const siteOpened = harness.context.waitForEvent('page', { timeout: 15000 });
        await page.getByRole('link', { name: 'Открыть HDRezka' }).click();
        const sessionPage = await siteOpened;
        await sessionPage.waitForLoadState('domcontentloaded');
        const openedSiteTabs = await page.evaluate(() => chrome.tabs.query({ url: 'https://hdrezka.co/*' }));
        assert.equal(openedSiteTabs.length, 1);
        assert.equal(openedSiteTabs[0].active, true);
        const openedUrl = new URL(openedSiteTabs[0].url);
        assert.equal(openedUrl.pathname, '/search/');
        assert.equal(openedUrl.searchParams.get('q'), 'Synthetic Film');
        if (sessionPage.url() === 'chrome-error://chromewebdata/') {
            // tabs.create can navigate before Playwright attaches Fetch routing
            // to the new target. Our deny proxy/DNS intentionally rejects that
            // missed request. Reload only this demonstrated fixture miss.
            assert.equal(providerNavigations.length, navigationsBeforeOpen, 'reload is allowed only when the API-created navigation missed interception');
            await sessionPage.goto(openedSiteTabs[0].url);
            console.log('HDRezka fixture: API-created first navigation missed Playwright routing and was denied; reloaded the same test-owned tab after attachment.');
        }
        assert.equal(new URL(sessionPage.url()).hostname, 'hdrezka.co');
        assertNoNewPages('one explicit open-site click');
        await sessionPage.goto(movieUrl);
        const connectedUrl = sessionPage.url();
        await page.getByRole('link', { name: 'Открыть HDRezka' }).click();
        await page.waitForFunction(() => hdService.openingSite === null);
        assert.equal(sessionPage.url(), connectedUrl, 'opening again focuses the user session without navigating it');
        assertNoNewPages('repeated explicit open-site click');

        // Contract harness: retain the real retry method and parser playback,
        // while replacing only the manager's wider source-switch orchestration.
        await page.evaluate(() => {
            window.recoveryMounts = [];
            owner.activeSourceValue = 'parser:hdrezka';
            owner.changeVideoSource = async (url, options) => {
                recoveryMounts.push({ url, options });
                const result = await hdParser.cachedSearch('Synthetic Film', 2024, { mediaType: 'FILM' });
                const sources = await hdParser.cachedVideoSources(result);
                const video = await hdParser.renderPlayer(owner.elements.videoContainer, sources, {
                    ...owner.createSourceLifecycleOptions({ url, parserId: 'hdrezka', movieId: '838', requestId: owner.sourceSwitchRequestId }),
                    onProviderDubChange: id => owner.onProviderDubChange(id)
                });
                if (video) { video.muted = true; await video.play(); owner.bindProviderVideoTracking('hdrezka'); }
                return Boolean(video);
            };
        });
        challenge = false; // Synthetic equivalent of confirming access in the normal site tab.
        await page.evaluate(() => { chrome.runtime.sendMessage = hdOriginalSendMessage; });
        const contextsBeforeRecovery = providerRequestContexts.length;
        const streamsBeforeRecovery = streamRequests;
        await page.getByRole('button', { name: 'Повторить поиск HDRezka' }).click();
        await page.waitForFunction(() => document.querySelector('video[data-progress-owner="canonical"]')?.currentTime > 1);
        const recovery = await page.evaluate(() => ({ mounts: recoveryMounts, access: hdParser.accessRequired,
            availability: owner.sourceAvailability.get('hdrezka'), fallbackCount: automaticFallbacks }));
        assert.deepEqual(recovery.mounts, [{ url: 'parser:hdrezka', options: { manualRetry: true } }]);
        assert.equal(recovery.access, false);
        assert.equal(recovery.availability, 'found');
        assert.equal(recovery.fallbackCount, 0);
        assert.equal(streamRequests, streamsBeforeRecovery + 1, 'retry obtains a fresh get_movie response');
        assert.ok(providerRequestContexts.slice(contextsBeforeRecovery).every(value => value === 'https:'), 'recovery reuses MAIN in the explicitly opened site tab');
        assert.equal(await page.locator('.hdrezka-access-actions').count(), 0);
        assertNoNewPages('confirmed-session retry and fresh playback');
        await assertResolverClean('confirmed-session playback');
        await page.locator('video[data-progress-owner="canonical"]').evaluate(video => video.pause());
        await page.evaluate(() => document.querySelector('[data-quality-option="720"]').click());
        await page.waitForFunction(() => document.querySelector('[data-quality-option="720"]')?.classList.contains('active') && document.querySelector('video')?.readyState >= 2);
        const nextRecoveryDub = await page.evaluate(() => {
            const target = document.querySelector('[data-voiceover-option]:not(.active)');
            target.click();
            return target.dataset.voiceoverOption;
        });
        await page.waitForFunction(id => document.querySelector(`[data-voiceover-option="${id}"]`)?.classList.contains('active') && document.querySelector('video')?.readyState >= 2, nextRecoveryDub);
        assert.equal(await page.locator('video[data-progress-owner="canonical"]').evaluate(video => video.paused), true);
        assert.equal(streamRequests, streamsBeforeRecovery + 2, 'only dubbing needs another get_movie response');
        assert.equal(sessionPage.isClosed(), false, 'playback leaves the connected normal site tab open');
        assertNoNewPages('quality and dubbing after confirmed-session recovery');
        await assertResolverClean('quality and dubbing after recovery');
        await page.evaluate(() => document.getElementById('videoContainer')._hdrezkaDispose());

        detailsChallenge = true;
        await page.evaluate(() => owner.retryHdrezkaSource());
        assert.equal(await page.evaluate(() => hdParser.accessRequired), true);
        assert.equal(await page.evaluate(() => owner.sourceAvailability.get('hdrezka')), 'access-required');
        assert.equal(await page.getByRole('link', { name: 'Открыть HDRezka' }).count(), 1, 'search success must not hide a later details challenge');
        assert.equal(await page.getByRole('button', { name: 'Повторить поиск HDRezka' }).count(), 1);
        assert.equal(await page.evaluate(() => recoveryMounts.length), 1, 'blocked details must not attempt playback');
        assertNoNewPages('search-success/details-403 retry');
        detailsChallenge = false;

        let releaseDetails;
        heldDetails = new Promise(resolve => { releaseDetails = resolve; });
        try {
            const pendingDetails = sessionPage.waitForRequest(request => request.url() === movieUrl && !request.isNavigationRequest());
            await page.evaluate(() => { window.lateRetry = owner.retryHdrezkaSource(); });
            await pendingDetails;
            await page.evaluate(() => { owner.activeSourceValue = 'parser:exfs'; owner.sourceSwitchRequestId += 1; });
            releaseDetails();
            await page.evaluate(() => lateRetry);
        } finally { releaseDetails(); heldDetails = null; }
        const lateRecovery = await page.evaluate(() => ({ source: owner.activeSourceValue, mounts: recoveryMounts.length,
            availability: owner.sourceAvailability.get('hdrezka') }));
        assert.deepEqual(lateRecovery, { source: 'parser:exfs', mounts: 1, availability: 'found' }, 'a late retry result must not replace another chosen provider');
        await page.evaluate(() => owner.retryHdrezkaSource());
        assert.equal(await page.evaluate(() => recoveryMounts.length), 1, 'a retry begun on another provider only updates availability');
        assertNoNewPages('late and inactive-provider retry');

        for (const scenario of [
            { mode: 'challenge', code: 'HDREZKA_ACCESS_REQUIRED', text: 'подтверждения доступа' },
            { mode: 'premium', code: 'HDREZKA_PREMIUM_REQUIRED', text: 'Premium' },
            { mode: 'empty', code: 'HDREZKA_NO_STREAMS', text: 'HLS-поток' },
            { mode: 'invalid-response', code: 'HDREZKA_INVALID_RESPONSE', text: 'неожиданный ответ' },
            { mode: 'cdn-response', code: 'HDREZKA_RESOLVER_RESPONSE_FAILED', text: 'HLS-поток с видеосервера', cdnReason: 'invalid-manifest', responseType: 'html' },
            { mode: 'cdn-json', cdn: 'json', code: 'HDREZKA_RESOLVER_RESPONSE_FAILED', text: 'HLS-поток с видеосервера', cdnReason: 'invalid-manifest', responseType: 'json' },
            { mode: 'cdn-http', cdn: 'http', code: 'HDREZKA_RESOLVER_RESPONSE_FAILED', text: 'HLS-поток с видеосервера', cdnReason: 'http', status: 503 },
            { mode: 'cdn-network', cdn: 'network', code: 'HDREZKA_RESOLVER_RESPONSE_FAILED', text: 'HLS-поток с видеосервера', cdnReason: 'network' }
        ]) {
            challenge = scenario.mode === 'challenge';
            responseMode = scenario.mode;
            invalidManifest = scenario.mode === 'cdn-response';
            cdnFailureMode = scenario.cdn;
            const failure = await page.evaluate(async () => {
                const container = document.getElementById('videoContainer');
                const video = await hdParser.renderPlayer(container, hdSources, { movieId: '838' });
                return { mounted: Boolean(video), code: container.dataset.hdrezkaFailure, access: hdParser.accessRequired };
            });
            assert.equal(failure.mounted, false);
            assert.equal(failure.code, scenario.code);
            assert.equal(failure.access, scenario.mode === 'challenge');
            const diagnosticText = failureDiagnostics.at(-1);
            const diagnostic = JSON.parse(diagnosticText.slice(diagnosticText.indexOf('{')));
            assert.equal(diagnostic.code, scenario.code);
            assert.equal(diagnostic.phase, scenario.cdnReason ? 'cdn-resolve' : 'streams');
            assert.equal(diagnostic.cdnReason, scenario.cdnReason);
            assert.equal(diagnostic.responseType, scenario.responseType);
            assert.equal(diagnostic.status, scenario.status);
            assert.equal(/voidboost|https?:\/\/|fixture-secret|Private upstream/.test(diagnosticText), false, 'console diagnostics never expose a stream address or response body');
            assert.deepEqual(await page.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).map(rule => rule.id)), baselineRules, 'failed resolution leaves existing DNR rules unchanged');
            await assertResolverClean('failed resolution');
            assertNoNewPages('failed playback and challenge handling');
            assert.ok((await page.locator('.player-source-lifecycle__message').innerText()).includes(scenario.text));
            for (const theme of ['dark', 'light']) {
                await page.evaluate(value => ThemeService.applyTheme(value, { persist: false, syncChromeStorage: false }), theme);
                await page.screenshot({ path: path.join(__dirname, `../artifacts/hdrezka-provider/error-${scenario.mode}-${theme}.png`), fullPage: true, animations: 'disabled' });
            }
        }
        assert.equal(translations.includes('111'), false, 'the active b-prem_translator is never requested');
        assertNoNewPages('complete HDRezka workflow');
        assert.equal(harness.context.pages().length, pagesAtStart - 1 + expectedExplicitPages);
        console.log('HDRezka browser: existing-session playback creates no extra tabs; explicit recovery when automatic acquisition fails, repeated-open reuse, MAIN retry with fresh parser playback, details challenges and late-provider retry guard; hidden resolver cleanup, CSP zero-forbidden-hit boundary, HLS origin/path limits, continuity and dark/light errors passed.');
    } finally { await harness?.close(); await sink.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
