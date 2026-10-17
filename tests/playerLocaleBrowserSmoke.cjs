const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchExtensionContext } = require('./helpers/extensionContext.cjs');
async function main() {
    const source = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><body style="margin:0;background:#111"><video controls style="width:100%;height:300px" src="data:video/mp4;base64,AAAA"></video></body></html>');
    });
    let harness;
    let extensionPath;
    try {
        await new Promise((resolve, reject) => { source.once('error', reject); source.listen(0, '127.0.0.1', resolve); });
        const origin = `http://127.0.0.1:${source.address().port}`;
        const root = path.resolve(__dirname, '..');
        const production = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
        // Test-only isolated-world host grant; production permissions remain exact.
        extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mle-locale-extension-'));
        const files = ['src/shared/services/player/PlayerGhostPreview.js', 'src/shared/services/player/PlayerMediaControls.js', 'src/shared/services/player/PlayerSettingsMenu.js', 'src/shared/services/player/PlayerLocale.js',
            'src/shared/i18n/locales.js', 'content-scripts/player-cleaner.js'];
        for (const file of files) {
            const target = path.join(extensionPath, file);
            fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, file), target);
        }
        fs.writeFileSync(path.join(extensionPath, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
        fs.writeFileSync(path.join(extensionPath, 'manifest.json'), JSON.stringify({
            manifest_version: 3, name: 'Owned locale isolation fixture', version: production.version, key: production.key,
            background: { service_worker: 'worker.js' }, permissions: ['scripting', 'storage'],
            host_permissions: [`${origin}/*`], web_accessible_resources: production.web_accessible_resources
        }));
        harness = await launchExtensionContext({ fixtureOrigin: origin, extensionPath });
        const page = await harness.context.newPage();
        await page.goto(origin);
        const tabId = await harness.worker.evaluate(async origin => (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/`).id, origin);
        await harness.worker.evaluate(async tabId => {
            await chrome.storage.sync.set({ language: 'en' });
            await chrome.scripting.executeScript({ target: { tabId }, files: [
                'src/shared/services/player/PlayerGhostPreview.js', 'src/shared/services/player/PlayerMediaControls.js', 'src/shared/services/player/PlayerSettingsMenu.js', 'content-scripts/player-cleaner.js'
            ] });
        }, tabId);
        const call = func => harness.worker.evaluate(async ({ tabId, source }) => {
            const result = await chrome.scripting.executeScript({ target: { tabId }, func: async source => {
                if (source === 'ready') {
                    const until = Date.now() + 8000;
                    while (!window.PlayerLocale?.ready && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
                    return Boolean(window.PlayerLocale?.ready);
                }
                if (source === 'mount') {
                    document.querySelector('video')._movieExtensionHls = { levels: [], audioTracks: [], subtitleTracks: [], currentLevel: -1, autoLevelEnabled: true };
                    window.MovieExtension_PlayerCleaner._test.replacePlayerForTest();
                }
                return { settings: document.querySelector('.native-player-wrapper button[title="Settings"],.native-player-wrapper button[title="Настройки"]')?.title,
                    wrappers: document.querySelectorAll('.native-player-wrapper').length,
                    language: window.PlayerLocale?.locale,
                    label: window.PlayerLocale?.t('quality', {}, 'missing') };
            }, args: [source] });
            return result[0].result;
        }, { tabId, source: func });
        assert.equal(await call('ready'), true, 'isolated content script imports canonical extension catalog');
        const english = await call('mount');
        assert.equal(english.settings, 'Settings'); assert.equal(english.label, 'Quality'); assert.equal(english.wrappers, 1);
        assert.equal(await page.evaluate(() => typeof window.MovieExtension_PlayerCleaner), 'undefined', 'provider main world does not own extension globals');
        await harness.worker.evaluate(() => chrome.storage.sync.set({ language: 'ru' }));
        let russian;
        for (let attempt = 0; attempt < 30; attempt++) {
            russian = await call('inspect');
            if (russian.settings === 'Настройки') break;
            await page.waitForTimeout(25);
        }
        assert.equal(russian.settings, 'Настройки'); assert.equal(russian.label, 'Качество'); assert.equal(russian.wrappers, 1);
        assert.equal(harness.externalResponses(), 0);
        console.log('Player locale Chromium: isolated content-script dynamic imports, canonical EN/RU catalog, live relabel without remount and main-world isolation passed.');
    } finally {
        try { await harness?.close(); }
        finally {
            source.closeAllConnections(); await new Promise(resolve => source.close(resolve));
            if (extensionPath) {
                assert.ok(path.resolve(extensionPath).startsWith(path.resolve(os.tmpdir()) + path.sep)
                    && path.basename(extensionPath).startsWith('mle-locale-extension-'));
                fs.rmSync(extensionPath, { recursive: true, force: true });
            }
        }
    }
}
main().catch(error => { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; });
