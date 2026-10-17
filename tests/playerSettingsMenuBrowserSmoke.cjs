const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionContext } = require('./helpers/extensionContext.cjs');
const { startFixtureServer } = require('./helpers/fixtureServer.cjs');

async function main() {
    const server = await startFixtureServer({ port: 0 });
    let harness;
    try {
        const root = path.resolve(__dirname, '..');
        harness = await launchExtensionContext({ extensionPath: root, fixtureOrigin: server.origin });
        const out = path.resolve(process.env.PLAYER_MENU_CAPTURE_DIR || path.join(root, 'artifacts/player-settings-escaping'));
        fs.mkdirSync(out, { recursive: true });
        for (const theme of ['dark-theme', 'light-theme']) {
            for (const width of [1366, 400]) {
                const page = await harness.context.newPage();
                page.setDefaultTimeout(15000);
                await page.setViewportSize({ width, height: 720 });
                await page.goto(`chrome-extension://${harness.extensionId}/tests/fixtures/player-menu.html`);
                await page.evaluate(async theme => {
                    await chrome.storage.sync.set({ language: 'ru' });
                    document.documentElement.className = theme;
                    document.body.className = theme;
                    const video = document.querySelector('video');
                    video.src = 'data:video/mp4;base64,AAAA';
                    video._movieExtensionHls = {
                        levels: [], audioTracks: [], currentLevel: -1, autoLevelEnabled: true,
                        subtitleTracks: [{ name: '<img src=x onerror="window.__pwn=1"> & English' }],
                        subtitleDisplay: true, subtitleTrack: 0
                    };
                }, theme);
                await page.addScriptTag({ url: `chrome-extension://${harness.extensionId}/src/shared/services/player/PlayerSettingsMenu.js` });
                await page.addScriptTag({ url: `chrome-extension://${harness.extensionId}/src/pages/movie-details/PlayerDiagnosticsPanel.js` });
                await page.evaluate(() => {
                    const header = document.createElement('div'); header.className = 'video-header';
                    header.innerHTML = '<button id="minimizeVideoBtn" class="modal-close">−</button>';
                    document.body.prepend(header);
                    window.PlayerMetrics = { report: async () => ({ counters: [], ttff: [] }), reset: async () => true };
                    window.diagnostics = new PlayerDiagnosticsPanel({ host: header,
                        before: header.firstChild, playerHost: document.getElementById('videoContainer') });
                });
                await page.addScriptTag({ url: `chrome-extension://${harness.extensionId}/src/shared/services/player/PlayerMediaControls.js` });
                await page.addScriptTag({ url: `chrome-extension://${harness.extensionId}/src/shared/services/player/PlayerGhostPreview.js` });
                await page.addScriptTag({ url: `chrome-extension://${harness.extensionId}/content-scripts/player-cleaner.js` });
                await page.evaluate(() => MovieExtension_PlayerCleaner._test.replacePlayerForTest());
                await page.getByTitle('Настройки', { exact: true }).click();
                const menu = page.locator('.player-settings-menu');
                assert.equal(await menu.locator('button').first().evaluate(node => node === document.activeElement), true, 'opening the menu focuses its first action');
                assert.equal(await menu.locator('img').count(), 0);
                assert.equal(await page.evaluate(() => window.__pwn), undefined);
                assert.equal(await menu.locator('.player-settings-menu__item:not([data-action="diagnostics"])').last()
                    .locator('.player-settings-menu__value').textContent(), '<img src=x onerror="window.__pwn=1"> & English');
                const box = await menu.boundingBox();
                assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, 'settings menu fits fixture viewport');
                const playerBox = await page.locator('.native-player-wrapper').boundingBox();
                assert.ok(playerBox && box.y >= playerBox.y - 1
                    && box.y + box.height <= playerBox.y + playerBox.height + 1,
                    `settings menu must fit inside the player without clipping options: ${JSON.stringify({ box, playerBox })}`);
                await page.screenshot({ path: path.join(out, `${theme}-${width}.png`) });
                assert.equal(await page.locator('.player-diagnostics-trigger').isVisible(), false);
                assert.equal(await menu.locator('[data-action="diagnostics"]').count(), 1);
                await page.keyboard.press('End');
                assert.equal(await menu.locator('[data-action="diagnostics"]').evaluate(node => node === document.activeElement), true);
                const diagnosticsBox = await menu.locator('[data-action="diagnostics"]').boundingBox();
                assert.ok(diagnosticsBox && diagnosticsBox.y >= box.y - 1
                    && diagnosticsBox.y + diagnosticsBox.height <= box.y + box.height + 1,
                    'keyboard navigation scrolls diagnostics fully into the bounded menu');
                await page.screenshot({ path: path.join(out, `diagnostics-${theme}-${width}.png`) });
                await menu.getByRole('menuitem', { name: 'Диагностика', exact: true }).click();
                await page.locator('.player-diagnostics-dialog[open]').waitFor();
                assert.equal(await menu.isVisible(), false);
                await page.locator('[data-action="close"]').click();
                assert.equal(await page.locator('.player-settings-button').evaluate(node => node === document.activeElement), true);
                await page.evaluate(() => {
                    MovieExtension_PlayerCleaner._test.teardownActiveWrapper();
                    document.getElementById('videoContainer').replaceChildren(document.createElement('iframe'));
                });
                await page.locator('.player-diagnostics-trigger').waitFor({ state: 'visible' });
                await page.locator('.player-diagnostics-trigger').click();
                await page.locator('.player-diagnostics-dialog[open]').waitFor();
                await page.evaluate(() => diagnostics.destroy());
                assert.equal(await page.locator('.player-diagnostics-trigger, .player-diagnostics-dialog').count(), 0);
                await page.close();
            }
        }
        assert.equal(harness.externalResponses(), 0);
        console.log('Settings menu extension Chromium: escaped provider label, constant icons and dark/light 1366/400px fixtures passed.');
    } finally {
        try { await harness?.close(); }
        finally { await server.close(); }
    }
}
main().catch(error => { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; });
