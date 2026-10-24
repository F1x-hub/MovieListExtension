const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { mount } = require('./mediaPlayerDownloadFolderBrowser.test.cjs');
const { launchExtensionContext } = require('./helpers/extensionContext.cjs');

const output = path.resolve(__dirname, '../artifacts/component-updates-settings');
const state = () => ({
    status: 'idle', configured: true, updaterVersion: '1.2.0', componentCatalogStatus: 'available',
    componentCapabilities: { protocolVersion: 1, signedCatalog: true, updaterSelfUpdate: true, mediaPlayerSuite: true },
    components: {
        updater: { componentId: 'updater', installed: true, currentVersion: '1.2.0', availableVersion: '1.3.0', status: 'available_manual' },
        mediaPlayerSuite: { componentId: 'mediaPlayerSuite', installed: true, currentVersion: '2.1.0', availableVersion: '2.2.0', status: 'available_manual', brokerAvailable: true, apiMajor: 1, buildId: 'fixture-build' }
    }
});
const card = (page, id) => page.locator(`.component-update-card[data-component-id="${id}"]`);
const actionCalls = page => page.evaluate(() => fixture.componentCalls.filter(call => call.method !== 'setupUrl'));

async function verifyConcurrentPreferences() {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'movielist-preferences-'));
    let harness;
    try {
        const { key } = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
        fs.writeFileSync(path.join(fixture, 'manifest.json'), JSON.stringify({ manifest_version: 3,
            name: 'Preference fixture', version: '1.4.0', key, permissions: ['storage', 'alarms'],
            background: { service_worker: 'background.js' } }));
        fs.copyFileSync('src/shared/services/UpdateService.js', path.join(fixture, 'UpdateService.js'));
        // No network or real Native Messaging: only the production coordinator,
        // real extension storage and real Web Locks participate in this fixture.
        fs.writeFileSync(path.join(fixture, 'host.js'),
            "chrome.runtime.sendNativeMessage = (_name, _message, callback) => callback({success:true,configured:true,updaterVersion:'1.1.4'});");
        fs.writeFileSync(path.join(fixture, 'background.js'), "importScripts('host.js', 'UpdateService.js');");
        fs.writeFileSync(path.join(fixture, 'settings.html'), '<!doctype html><script src="host.js"></script><script src="UpdateService.js"></script>');
        harness = await launchExtensionContext({ extensionPath: fixture, fixtureOrigin: 'http://127.0.0.1:9' });
        const pages = await Promise.all([harness.context.newPage(), harness.context.newPage()]);
        await Promise.all(pages.map(page => page.goto(`chrome-extension://${harness.extensionId}/settings.html`)));
        await Promise.all([
            pages[0].evaluate(() => UpdateService.setComponentAutoUpdateEnabled('updater', true)),
            pages[1].evaluate(() => UpdateService.setComponentAutoUpdateEnabled('mediaPlayerSuite', true)),
            harness.worker.evaluate(() => UpdateService.setAutoUpdateEnabled(false))
        ]);
        assert.deepEqual(await pages[0].evaluate(async () => (await chrome.storage.local.get('extension_update_settings_v1')).extension_update_settings_v1), {
            autoUpdateEnabled: false, componentAutoUpdateEnabled: { updater: true, mediaPlayerSuite: true }
        }, 'real extension pages and the service worker must preserve simultaneous preference writes');
        assert.equal(harness.externalResponses(), 0);
    } finally {
        await harness?.close();
        fs.rmSync(fixture, { recursive: true, force: true });
    }
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    fs.mkdirSync(output, { recursive: true });
    try {
        await verifyConcurrentPreferences();
        for (const theme of ['dark-theme', 'light-theme']) {
            for (const width of [1280, 375]) {
                const { page, errors } = await mount(browser, { componentState: state(), activePane: 'updates', theme, width });
                const updater = card(page, 'updater');
                const suite = card(page, 'mediaPlayerSuite');
                assert.equal(await updater.locator('[data-component-version]').textContent(), '1.2.0');
                assert.equal(await suite.locator('[data-component-version]').textContent(), '2.1.0');
                assert.equal(await updater.locator('[data-component-auto]').isChecked(), false);
                assert.equal(await suite.locator('[data-component-auto]').isChecked(), false);
                assert.equal(await page.evaluate(() => fixture.componentCalls.filter(call => call.method === 'setupUrl').length), 2, 'renders reuse setup URL results');
                assert.deepEqual(await actionCalls(page), [], 'rendering must not check or install automatically');
                await page.locator('#componentUpdatesCheckBtn').click();
                await page.waitForFunction(() => !document.querySelector('#componentUpdatesCheckBtn').disabled);
                assert.deepEqual((await actionCalls(page))[0], { method: 'check', id: null, options: { force: true, interactive: true } });
                await updater.locator('[data-component-apply]').click();
                await page.waitForFunction(() => !document.querySelector('#componentUpdatesCheckBtn').disabled);
                assert.deepEqual((await actionCalls(page))[1], { method: 'apply', id: 'updater', options: { automatic: false } });
                await suite.locator('[data-component-apply]').click();
                await page.waitForFunction(() => !document.querySelector('#componentUpdatesCheckBtn').disabled);
                assert.deepEqual((await actionCalls(page))[2], { method: 'apply', id: 'mediaPlayerSuite', options: { automatic: false } });
                await updater.locator('[data-component-auto]').check();
                await page.waitForFunction(() => !document.querySelector('#componentUpdatesCheckBtn').disabled);
                assert.equal(await page.evaluate(() => fixture.componentSettings.updater), true);
                assert.equal(await page.evaluate(() => fixture.componentSettings.mediaPlayerSuite), false);
                assert.equal(await suite.locator('[data-component-auto]').isChecked(), false);
                await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
                assert.equal(await page.locator('.settings-actions-footer').evaluate(footer => [...footer.children].every(button => button.scrollWidth <= button.clientWidth)), true, 'footer labels remain readable');
                assert.equal(await page.locator('.updates-action-buttons').evaluate(actions => [...actions.querySelectorAll('button:not([hidden])')].every(button => button.scrollWidth <= button.clientWidth)), true, 'update action labels remain readable');
                assert.equal(await page.locator('#extensionUpdateSetupBtn').isHidden(), true, 'configured hosts hide the legacy Setup action');
                await page.evaluate(() => {
                    const next = structuredClone(fixture.componentState);
                    Object.assign(next.components.mediaPlayerSuite, { status: 'waiting_for_safe_moment', errorCode: 'PLAYBACK_ACTIVE' });
                    fixture.emitComponentState(next);
                });
                assert.match(await suite.locator('[data-component-status]').textContent(), /Ожидаем завершения просмотра/);
                await page.evaluate(() => {
                    const next = structuredClone(fixture.componentState);
                    Object.assign(next.components.mediaPlayerSuite, { status: 'queued', errorCode: null });
                    fixture.emitComponentState(next);
                });
                assert.equal(await updater.locator('[data-component-apply]').isDisabled(), true);
                assert.equal(await page.locator('#componentUpdatesCheckBtn').isDisabled(), true);
                assert.equal(await page.locator('#extensionUpdateInstallBtn').isDisabled(), true);
                await page.evaluate(() => {
                    const next = structuredClone(fixture.componentState);
                    Object.assign(next.components.mediaPlayerSuite, { status: 'succeeded', currentVersion: '2.2.0', availableVersion: null });
                    fixture.emitComponentState(next);
                });
                assert.equal(await suite.locator('[data-component-version]').textContent(), '2.2.0');
                assert.equal(await suite.locator('[data-component-apply]').isDisabled(), true);
                assert.equal(await page.locator('#componentUpdatesCheckBtn').isEnabled(), true);
                assert.deepEqual(errors, []);
                await page.close();
            }
        }
        {
            const legacy = state();
            legacy.componentCapabilities = null;
            legacy.componentCatalogStatus = 'setup_required';
            for (const component of Object.values(legacy.components)) Object.assign(component, { status: 'setup_required', errorCode: 'UPDATER_COMPONENT_SETUP_REQUIRED' });
            const { page, errors } = await mount(browser, { componentState: legacy, activePane: 'updates', language: 'en' });
            const updater = card(page, 'updater');
            await updater.locator('[data-component-setup]').waitFor({ state: 'visible' });
            assert.match(await updater.locator('[data-component-setup]').getAttribute('href'), /MovieListSetup\.exe$/);
            assert.equal(await updater.locator('[data-component-apply]').isDisabled(), true);
            assert.equal(await card(page, 'mediaPlayerSuite').locator('[data-component-auto]').isDisabled(), true);
            assert.match(await page.locator('#componentUpdatesStatus').textContent(), /MovieListSetup\.exe/);
            assert.deepEqual(errors, []);
            await page.close();
        }
        {
            const absent = state();
            Object.assign(absent.components.mediaPlayerSuite, { installed: false, status: 'absent', currentVersion: null, availableVersion: '2.2.0' });
            const { page, errors } = await mount(browser, { componentState: absent, activePane: 'updates' });
            const suite = card(page, 'mediaPlayerSuite');
            assert.equal(await suite.locator('[data-component-version]').textContent(), 'Не установлен');
            assert.equal(await suite.locator('[data-component-apply]').isHidden(), true);
            assert.equal(await suite.locator('[data-component-auto]').isDisabled(), true);
            assert.equal(await suite.locator('[data-component-setup]').isHidden(), true);
            assert.equal(await suite.locator('[data-component-install]').isHidden(), true, 'an older hub cannot install the Suite');
            assert.deepEqual(await actionCalls(page), [], 'an absent Suite never triggers installation');
            assert.deepEqual(errors, []);
            await page.close();
        }
        {
            const installable = state();
            installable.componentCapabilities = { ...installable.componentCapabilities, mediaPlayerInstall: true };
            installable.componentCatalog = { verified: true, metadata: { components: { mediaPlayerSuite: { version: '2.2.0' } } } };
            Object.assign(installable.components.mediaPlayerSuite, { installed: false, status: 'absent', currentVersion: null, availableVersion: '2.2.0' });
            const { page, errors } = await mount(browser, { componentState: installable, activePane: 'updates' });
            const suite = card(page, 'mediaPlayerSuite');
            assert.equal(await suite.locator('[data-component-install]').textContent(), 'Установить');
            assert.deepEqual(await actionCalls(page), [], 'rendering never installs by itself');
            await suite.locator('[data-component-install]').click();
            assert.deepEqual((await actionCalls(page))[0], { method: 'install', id: 'mediaPlayerSuite', options: {} }, 'the user installs the Suite through the hub');
            assert.deepEqual(errors, []);
            await page.close();
        }
        {
            const manual = state();
            Object.assign(manual.components.mediaPlayerSuite, { brokerAvailable: false, status: 'setup_required', errorCode: 'SUITE_MAINTENANCE_SETUP_REQUIRED' });
            const { page, errors } = await mount(browser, { componentState: manual, activePane: 'updates' });
            const suite = card(page, 'mediaPlayerSuite');
            assert.equal(await suite.locator('[data-component-auto]').isDisabled(), true);
            assert.equal(await suite.locator('[data-component-apply]').isEnabled(), true);
            assert.match(await suite.locator('[data-component-note]').textContent(), /после нажатия «Обновить»/);
            assert.equal(await suite.locator('[data-component-setup]').isHidden(), true, 'no invented Suite setup asset');
            await suite.locator('[data-component-apply]').click();
            assert.deepEqual((await actionCalls(page))[0], { method: 'apply', id: 'mediaPlayerSuite', options: { automatic: false } });
            assert.deepEqual(errors, []);
            await page.close();
        }
        {
            const migration = state();
            Object.assign(migration.components.mediaPlayerSuite, { currentVersion: null, status: 'migration_required', errorCode: 'SUITE_MIGRATION_REQUIRED' });
            const { page, errors } = await mount(browser, { componentState: migration, activePane: 'updates' });
            const suite = card(page, 'mediaPlayerSuite');
            assert.equal(await suite.locator('[data-component-apply]').isDisabled(), true);
            assert.equal(await suite.locator('[data-component-auto]').isDisabled(), true);
            assert.equal(await suite.locator('[data-component-setup]').isHidden(), true);
            await page.evaluate(() => {
                fixture.suiteSetupUrl = 'https://github.com/F1x-hub/MovieListExtension/releases/download/v1.4.0/MediaPlayerSuiteSetup.exe';
                const next = structuredClone(fixture.componentState);
                next.components.mediaPlayerSuite.errorCode = 'COMPONENT_VERSION_UNKNOWN';
                fixture.emitComponentState(next);
            });
            await suite.locator('[data-component-setup]').waitFor({ state: 'visible' });
            assert.match(await suite.locator('[data-component-setup]').getAttribute('href'), /MediaPlayerSuiteSetup\.exe$/);
            assert.deepEqual(errors, []);
            await page.close();
        }
        {
            const { page, errors } = await mount(browser, { componentState: state(), activePane: 'updates' });
            await page.evaluate(() => { fixture.componentMode = 'pending'; });
            await page.locator('#componentUpdatesCheckBtn').click();
            await page.waitForFunction(() => fixture.pendingComponent.length === 1);
            await page.evaluate(() => {
                window.dispatchEvent(new PageTransitionEvent('pagehide'));
                const stale = structuredClone(fixture.componentState);
                stale.components.updater.currentVersion = 'stale-after-pagehide';
                fixture.pendingComponent.shift()(stale);
            });
            assert.equal(await card(page, 'updater').locator('[data-component-version]').textContent(), '1.2.0');
            await page.evaluate(() => {
                fixture.componentMode = 'success';
                const next = structuredClone(fixture.componentState);
                next.components.updater.currentVersion = '1.3.0';
                fixture.componentState = next;
                window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
            });
            await page.waitForFunction(() => document.querySelector('[data-component-id="updater"] [data-component-version]').textContent === '1.3.0');
            assert.deepEqual(errors, []);
            await page.close();
        }
        {
            const { page, errors } = await mount(browser, { componentState: state(), activePane: 'updates' });
            await page.evaluate(() => { fixture.componentMode = 'pending'; });
            await page.locator('#componentUpdatesCheckBtn').click();
            await page.waitForFunction(() => fixture.pendingComponent.length === 1);
            await page.evaluate(() => {
                document.querySelector('#componentUpdatesCheckBtn').click();
                document.querySelector('[data-component-id="updater"] [data-component-apply]').click();
                const next = structuredClone(fixture.componentState);
                Object.assign(next.components.updater, { currentVersion: '1.3.0', availableVersion: null, status: 'succeeded' });
                fixture.emitComponentState(next);
                fixture.pendingComponent.shift()({ ...next, components: { ...next.components, updater: { ...next.components.updater, currentVersion: 'stale' } } });
            });
            await page.waitForFunction(() => !document.querySelector('#componentUpdatesCheckBtn').disabled);
            assert.equal((await actionCalls(page)).length, 1, 'overlapping operations are suppressed');
            assert.equal(await card(page, 'updater').locator('[data-component-version]').textContent(), '1.3.0', 'a late action result cannot overwrite a newer storage event');
            assert.deepEqual(errors, []);
            await page.close();
        }
        console.log('PASS Settings component updates Chromium fixture: per-component actions/opt-in, legacy host, absent/unknown Suite, broker/UAC hint, playback/operation states, stale replies, dark/light × 1280/375');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
