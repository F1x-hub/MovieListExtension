const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionContext } = require('./helpers/extensionContext.cjs');
const { startFixtureServer } = require('./helpers/fixtureServer.cjs');
async function main() {
    const fixture = await startFixtureServer({ port: 0 });
    let harness;
    try {
        harness = await launchExtensionContext({ fixtureOrigin: fixture.origin });
        const out = path.resolve(process.env.PLAYER_WATCH_CAPTURE_DIR || path.join(__dirname, '../artifacts/watch-entry')); fs.mkdirSync(out, { recursive: true });
        for (const theme of ['dark-theme', 'light-theme']) for (const width of [1366, 400]) {
            const page = await harness.context.newPage();
            await page.setViewportSize({ width, height: 780 });
            await page.goto(`chrome-extension://${harness.extensionId}/tests/fixtures/watch-entry.html`);
            for (const file of ['src/shared/services/player/ProPlayerPreferences.js', 'src/shared/services/player/WatchSourcePolicy.js',
                'src/pages/movie-details/WatchEntryController.js', 'src/pages/movie-details/WatchEntryPage.js',
                'src/shared/services/player/PlayerMetrics.js', 'src/pages/movie-details/PlayerDiagnosticsPanel.js']) {
                await page.addScriptTag({ url: `chrome-extension://${harness.extensionId}/${file}` });
            }
            await page.evaluate(async theme => {
                document.documentElement.className = document.body.className = theme;
                const container = document.getElementById('sourceButtonsContainer');
                const add = (value, text) => {
                    const button = document.createElement('button'); button.className = 'source-btn';
                    button.dataset.value = value; button.textContent = text; container.append(button);
                };
                add('parser:exfs', 'Ex-FS'); add('parser:animego', 'AnimeGo'); add('parser:seasonvar', 'Seasonvar — проверится при запуске');
                add('https://example.com/embed?q="]', 'Другой источник'); add('parser:rutube', 'Rutube');
                window.originalContainer = container; window.choices = [];
                container.addEventListener('click', event => { const value = event.target.closest('.source-btn')?.dataset.value; if (value) choices.push(value); });
                const manager = window.manager = { ...MovieDetailsWatchEntryMethods,
                    elements: { sourceButtonsContainer: container, videoContainer: document.getElementById('videoContainer') },
                    selectedMovie: { kinopoiskId: 42, type: 'anime' }, mediaPlayerReady: true, isTorrentMovie: () => true,
                    activeSourceValue: 'parser:animego', handleWatchClick: async () => { window.watchClicks = (window.watchClicks || 0) + 1; },
                    openTorrentPicker: () => { window.torrentClicks = (window.torrentClicks || 0) + 1; },
                    populateSourceSelector() { this.syncWatchEntry(); }
                };
                await manager.initializeWatchEntry(); manager.syncWatchEntry();
            }, theme);
            await page.locator('#watchEntryBtn').waitFor();
            assert.equal(await page.locator('.source-toolbar .player-diagnostics-trigger').count(), 0);
            assert.equal(await page.locator('#minimizeVideoBtn').evaluate(node => node.previousElementSibling.classList.contains('player-diagnostics-trigger')), true);
            const toolbarStyles = await page.locator('#watchEntryBtn, #sourcePopoverToggle, #torrentEntryBtn').evaluateAll(nodes => nodes.map(node => {
                const style = getComputedStyle(node);
                return [style.height, style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight, style.borderRadius];
            }));
            assert.equal(toolbarStyles.length, 3);
            toolbarStyles.forEach(style => assert.deepEqual(style, toolbarStyles[0], 'toolbar actions share height, typography and radius'));
            await page.locator('#watchEntryBtn').click();
            assert.equal(await page.evaluate(() => watchClicks), 1);
            await page.locator('#torrentEntryBtn').click();
            assert.equal(await page.evaluate(() => torrentClicks), 1);
            await page.locator('#sourcePopoverToggle').focus();
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            assert.equal(await page.evaluate(() => choices.length), 1, 'original delegated handler survives move');
            assert.equal(await page.locator('#sourcePopoverToggle').getAttribute('aria-expanded'), 'false');
            await page.locator('#sourcePopoverToggle').click();
            const box = await page.locator('#sourcePopover').boundingBox();
            assert.equal(await page.evaluate(() => {
                const container = document.getElementById('sourceButtonsContainer');
                return container.scrollHeight <= container.clientHeight + 1;
            }), true, 'all provider rows fit without hidden vertical clipping');
            await page.screenshot({ path: path.join(out, `${theme}-${width}.png`) });
            assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `popover fits ${theme}/${width}: ${JSON.stringify(box)}`);
            await page.keyboard.press('Escape');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'sourcePopoverToggle');
            await page.locator('#sourcePopoverToggle').click();
            await page.locator('#outside').click();
            assert.equal(await page.locator('#sourcePopoverToggle').getAttribute('aria-expanded'), 'false');
            await page.evaluate(async () => {
                await PlayerMetrics.reset();
                await PlayerMetrics.record('resolveOk', { providerId: 'kinogo' });
                await PlayerMetrics.record('ttff', { providerId: 'kinogo' });
            });
            await page.locator('.player-diagnostics-trigger').click();
            await page.locator('dialog[open]').waitFor();
            assert.equal(await page.locator('dialog[open]').count(), 1);
            await page.waitForFunction(() => document.querySelector('.player-diagnostics-summary')?.textContent.includes('готовности источника: 1'));
            assert.ok((await page.locator('.player-diagnostics-summary').textContent()).includes('это не ошибка воспроизведения'));
            assert.equal(await page.locator('.player-diagnostics-dialog details').evaluate(node => node.open), false);
            await page.keyboard.press('Tab');
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('dialog[open]'))), true, 'native dialog focus returns to its controls after the browser chrome tab stop');
            await page.evaluate(async () => {
                await PlayerMetrics.record('session', { providerId: 'animego' });
                await PlayerMetrics.record('stall', { providerId: 'animego', durationMs: 900 });
                await PlayerMetrics.record('ttff', { providerId: 'animego', durationMs: 800 });
                await manager.playerDiagnosticsPanel.refresh();
            });
            const qoeSummary = await page.locator('.player-diagnostics-summary').textContent();
            assert.ok(qoeSummary.includes('animego — Остановок для буферизации: 1'));
            assert.ok(qoeSummary.includes('animego — Всего буферизация: 900 мс'));
            assert.ok(qoeSummary.includes('animego (exact) — TTFF p50 / p95: 1000 мс / 1000 мс'));
            assert.ok(qoeSummary.includes('kinogo (unknown) — TTFF p50 / p95: Нет данных'));
            await page.screenshot({ path: path.join(out, `diagnostics-${theme}-${width}.png`) });
            await page.locator('dialog [data-action="close"]').scrollIntoViewIfNeeded();
            const closeBox = await page.locator('dialog [data-action="close"]').boundingBox();
            assert.ok(closeBox && closeBox.y >= 0 && closeBox.y + closeBox.height <= 780, 'long QoE summary leaves dialog controls reachable by scrolling');
            await page.keyboard.press('Escape');
            await page.close();
        }
        const matched = await harness.worker.evaluate(async id => {
            const test = async (url, type, initiator = `chrome-extension://${id}`) => {
                const result = await chrome.declarativeNetRequest.testMatchOutcome({ url, type, initiator });
                return result.matchedRules.filter(rule => rule.rulesetId === 'player_response_headers').map(rule => rule.ruleId).sort();
            };
            return { widget: await test('https://widgets.kinopoisk.ru/discovery/', 'sub_frame'),
                xhr: await test('https://widgets.kinopoisk.ru/discovery/', 'xmlhttprequest'),
                foreign: await test('https://widgets.kinopoisk.ru/discovery/', 'sub_frame', 'https://unrelated.example'),
                spoof: await test('https://unrelated.example/?widgets.kinopoisk.ru/', 'sub_frame'),
                rutube: await test('https://video.rtbcdn.ru/segment', 'media') };
        }, harness.extensionId);
        assert.deepEqual(matched.widget, [1]); assert.deepEqual(matched.xhr, []);
        assert.deepEqual(matched.foreign, []); assert.deepEqual(matched.spoof, []); assert.deepEqual(matched.rutube, [6]);
        assert.equal(harness.externalResponses(), 0);
        console.log('Watch fixture Chromium: default-off/storage toggle, alias/torrent, keyboard/outside/focus, diagnostics and dark/light 1366/400 passed; compiled DNR positive/negative matching passed.');
    } finally { try { await harness?.close(); } finally { await fixture.close(); } }
}
main().catch(error => { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; });
