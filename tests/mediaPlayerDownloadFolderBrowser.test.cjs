const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { pageStyles } = require('./motionP0BrowserSmoke.cjs');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const initialPath = 'C:\\MediaPlayer\\downloads';
const selectedPath = 'D:\\Films and series\\Очень длинная папка для семейной коллекции фильмов и сериалов';
const screenshots = path.join(root, 'artifacts/mediaplayer-download-folder');
const settingsSource = read('src/pages/settings/settings.js').replace(/^import .*;\r?$/gm, '');
const i18nSource = read('src/shared/i18n/I18n.js').replace(/^import .*;\r?$/gm, '')
    .replace('export const i18n =', 'window.i18n =').replace('export { I18n };', '');
const settingsHtml = read('src/pages/settings/settings.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<link\b[^>]*>/g, '');

async function mount(browser, { legacy = false, enabled = true, deferredGet = false, theme = 'dark-theme', width = 1280, language = 'ru', componentState = null, componentSettings = null, activePane = 'mediaplayer' } = {}) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://movielist.fixture/**', route => route.fulfill({ contentType: 'text/html', body: settingsHtml }));
    await page.goto('http://movielist.fixture/settings.html');
    await page.addStyleTag({ content: pageStyles('src/pages/settings/settings.html') });
    await page.addScriptTag({ content: read('src/shared/i18n/locales.js').replace('export const locales', 'window.locales') });
    await page.evaluate(({ legacy, enabled, deferredGet, theme, language, initialPath, selectedPath, componentState, componentSettings, activePane }) => {
        document.documentElement.className = theme;
        document.body.classList.add(theme);
        localStorage.setItem('movieExtensionActiveSettingsPaneV1', activePane);
        window.fixture = { legacy, deferredGet, nextFolder: selectedPath, nativeMode: 'success', patchMode: 'success', patches: [], native: [], writes: [], pendingGet: [], pendingPatch: [], pendingNative: [] };
        const setup = { enabled, status: enabled ? 'ready' : 'disabled', installPath: 'C:\\Fixture\\MediaPlayer', checks: [] };
        fixture.values = { language, mediaPlayerEnabled: enabled, mediaplayer_setup_v1: setup, mediaplayer_device_token_v1: 'fixture-token' };
        fixture.componentState = componentState || { configured: true, status: 'idle', componentCatalogStatus: 'unknown', components: {} };
        fixture.componentSettings = componentSettings || { updater: false, mediaPlayerSuite: false };
        fixture.componentCalls = [];
        fixture.componentMode = 'success';
        fixture.pendingComponent = [];
        fixture.listeners = [];
        fixture.emitComponentState = state => {
            fixture.componentState = state;
            fixture.listeners.forEach(listener => listener({ extension_update_state_v2: { newValue: state } }, 'local'));
        };
        fixture.settings = { torrentRetentionDays: 7, options: [0, 1, 3, 7, 14, 30], updatedAt: null, storage: { supported: true, downloadPath: initialPath, defaultDownloadPath: initialPath } };
        const storage = {
            get(keys, callback) {
                const values = Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, fixture.values[key]]));
                if (callback) callback(values);
                return Promise.resolve(values);
            },
            set(values, callback) { fixture.writes.push(structuredClone(values)); Object.assign(fixture.values, values); callback?.(); return Promise.resolve(); },
            remove(key, callback) { delete fixture.values[key]; callback?.(); return Promise.resolve(); }
        };
        window.chrome = {
            i18n: { getUILanguage: () => language },
            storage: { local: storage, sync: storage, onChanged: { addListener(listener) { fixture.listeners.push(listener); } } },
            runtime: {
                getManifest: () => ({ version: '1.4.0' }),
                sendMessage: (_message, callback) => callback?.({ success: true, settings: { autoUpdateEnabled: true, componentAutoUpdateEnabled: fixture.componentSettings }, state: fixture.componentState }),
                sendNativeMessage(_host, message, callback) {
                    fixture.native.push(message);
                    if (message.action === 'select_download_folder') {
                        if (fixture.nativeMode === 'pending') fixture.pendingNative.push(callback);
                        else callback(fixture.nativeMode === 'cancelled' ? { error: 'folder_selection_cancelled' }
                            : fixture.nativeMode === 'old' ? { error: 'unknown_action' } : { downloadPath: fixture.nextFolder });
                    } else if (message.action === 'grant_download_folder_access') {
                        if (fixture.grantError) callback({ error: fixture.grantError });
                        else { fixture.patchMode = 'success'; callback({ downloadPath: message.downloadPath, granted: true }); }
                    } else if (['detect_installation', 'verify_installation'].includes(message.action)) callback({ ...setup, enabled: true, ready: true, status: 'ready' });
                    else callback({ accessToken: 'fixture-token' });
                }
            }
        };
        const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => structuredClone(body) });
        const getSettings = () => {
            const body = structuredClone(fixture.settings);
            if (fixture.legacy) delete body.storage;
            return response(body);
        };
        window.fetch = async (url, options = {}) => {
            const apiPath = new URL(url).pathname;
            if (apiPath === '/api/capabilities') return response({ torrents: { movies: { supported: true, status: 'ready' } } });
            if (apiPath === '/api/settings' && options.method !== 'PATCH') {
                if (fixture.deferredGet) return new Promise(resolve => fixture.pendingGet.push(() => resolve(getSettings())));
                return getSettings();
            }
            if (apiPath === '/api/settings') {
                const changes = JSON.parse(options.body);
                fixture.patches.push(changes);
                if (fixture.patchMode === 'error') return response({ error: 'invalid_settings', reason: 'download_path_permission_denied', message: 'Fixture service cannot write.' }, 400);
                if (fixture.patchMode === 'future-error') return response({ error: 'invalid_settings', reason: 'download_path_future_reason', message: 'Precise backend folder error.' }, 400);
                const apply = () => {
                    if (changes.downloadPath) fixture.settings.storage.downloadPath = changes.downloadPath;
                    if (changes.torrentRetentionDays !== undefined) fixture.settings.torrentRetentionDays = changes.torrentRetentionDays;
                    return getSettings();
                };
                if (fixture.patchMode === 'pending') return new Promise(resolve => fixture.pendingPatch.push(() => resolve(apply())));
                return apply();
            }
            if (apiPath === '/api/jackett/indexers') return response({ indexers: [{ id: 'fixture', name: 'Fixture', enabled: true }], enabledIds: ['fixture'] });
            throw new Error(`Unexpected fixture request: ${apiPath}`);
        };
        window.Navigation = class { render() {} };
        window.bindWhatsNewSettings = () => {};
        const componentAction = async (method, id, options) => {
            fixture.componentCalls.push({ method, id, options });
            if (fixture.componentMode === 'error') throw new Error('COMPONENT_APPLY_FAILED');
            if (fixture.componentMode === 'pending') return new Promise(resolve => fixture.pendingComponent.push(resolve));
            return fixture.componentState;
        };
        window.UpdateService = {
            checkComponentUpdates: options => componentAction('check', null, options),
            applyComponent: (id, options) => componentAction('apply', id, options),
            installComponent: id => componentAction('install', id, {}),
            dismissComponentOperation: id => componentAction('dismiss', id, {}),
            setComponentAutoUpdateEnabled: (id, enabled) => {
                fixture.componentSettings = { ...fixture.componentSettings, [id]: enabled };
                fixture.listeners.forEach(listener => listener({ extension_update_settings_v1: { newValue: { componentAutoUpdateEnabled: fixture.componentSettings } } }, 'local'));
                return componentAction('auto', id, enabled);
            },
            getState: async () => ({ state: fixture.componentState, settings: { componentAutoUpdateEnabled: fixture.componentSettings } }),
            getSetupUrl: () => 'https://github.com/F1x-hub/MovieListExtension/releases/latest/download/MovieListSetup.exe',
            getComponentSetupUrl: async id => {
                fixture.componentCalls.push({ method: 'setupUrl', id });
                return id === 'updater' ? 'https://github.com/F1x-hub/MovieListExtension/releases/latest/download/MovieListSetup.exe' : fixture.suiteSetupUrl || null;
            }
        };
    }, { legacy, enabled, deferredGet, theme, language, initialPath, selectedPath, componentState, componentSettings, activePane });
    await page.addScriptTag({ content: i18nSource });
    await page.addScriptTag({ content: read('src/shared/services/MediaPlayerService.js') });
    await page.addScriptTag({ content: settingsSource });
    await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
    if (deferredGet) await page.waitForFunction(() => fixture.pendingGet.length === 1);
    else await page.waitForFunction(() => document.querySelector('#mediaPlayerStorageStatus').dataset.state !== 'loading');
    return { page, errors };
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    fs.mkdirSync(screenshots, { recursive: true });
    try {
        for (const theme of ['dark-theme', 'light-theme']) {
            for (const width of [1280, 375]) {
                const { page, errors } = await mount(browser, { theme, width });
                const current = page.locator('#mediaPlayerDownloadPath');
                const choose = page.locator('#mediaPlayerDownloadChooseBtn');
                assert.equal(await current.inputValue(), initialPath);
                await choose.click();
                await page.waitForFunction(() => !document.querySelector('#mediaPlayerDownloadSaveBtn').disabled);
                assert.equal(await current.inputValue(), initialPath, 'native selection is only a preview');
                assert.equal(await page.locator('#mediaPlayerDownloadPreview').textContent(), selectedPath);
                assert.equal(await page.evaluate(() => fixture.patches.length), 0);
                await page.locator('#torrentRetentionDays').selectOption('14');
                await page.screenshot({ path: path.join(screenshots, `${theme}-${width}-selected.png`), fullPage: true, animations: 'disabled' });
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
                await page.locator('#mediaPlayerDownloadCancelBtn').click();
                assert.equal(await page.locator('#mediaPlayerDownloadDraft').isHidden(), true);
                assert.equal(await page.locator('#torrentRetentionDays').inputValue(), '14', 'folder cancellation preserves retention draft');
                await page.evaluate(() => { fixture.nativeMode = 'cancelled'; });
                await choose.click();
                await page.waitForFunction(() => document.querySelector('#mediaPlayerStorageStatus').dataset.state === 'cancelled');
                assert.equal(await current.inputValue(), initialPath);
                await page.evaluate(() => { fixture.nativeMode = 'success'; fixture.patchMode = 'error'; });
                await choose.click();
                await page.locator('#saveBtn').click();
                await page.waitForFunction(() => document.querySelector('#mediaPlayerStorageStatus').dataset.state === 'error');
                assert.match(await page.locator('#mediaPlayerStorageStatus').textContent(), /Служба MediaPlayer не может записывать/);
                assert.equal(await current.inputValue(), initialPath);
                assert.equal(await page.locator('#torrentRetentionDays').inputValue(), '14');
                assert.equal(await page.locator('#mediaPlayerDownloadDraft').isVisible(), true);
                assert.equal(await page.evaluate(() => fixture.settings.torrentRetentionDays), 7, 'failed atomic PATCH changes no retention');
                await page.evaluate(() => { fixture.patchMode = 'pending'; });
                await page.locator('#mediaPlayerDownloadSaveBtn').click();
                await page.waitForFunction(() => fixture.pendingPatch.length === 1);
                assert.equal(await page.locator('#saveBtn').isDisabled(), true);
                await page.evaluate(() => { document.querySelector('#mediaPlayerDownloadSaveBtn').click(); document.querySelector('#saveBtn').click(); });
                assert.equal(await page.evaluate(() => fixture.patches.length), 2, 'overlapping saves are suppressed');
                await page.evaluate(() => fixture.pendingPatch.shift()());
                await page.waitForFunction(() => document.querySelector('#mediaPlayerStorageStatus').dataset.state === 'saved');
                assert.equal(await current.inputValue(), selectedPath);
                assert.equal(await page.locator('#torrentRetentionDays').inputValue(), '14', 'folder-only save preserves retention draft');
                assert.equal(await page.evaluate(() => fixture.settings.torrentRetentionDays), 7);
                await page.evaluate(() => { fixture.patchMode = 'success'; });
                await page.locator('#saveBtn').click();
                await page.waitForFunction(() => fixture.settings.torrentRetentionDays === 14);
                assert.equal(await page.evaluate(() => fixture.writes.some(write => JSON.stringify(write).includes(fixture.settings.storage.downloadPath))), false, 'paths never enter browser persistence');
                assert.deepEqual(errors, []);
                await page.close();
            }
        }
        {
            const { page, errors } = await mount(browser);
            assert.equal(await page.locator('#mediaPlayerDownloadGrantBtn').isHidden(), true);
            await page.locator('#mediaPlayerDownloadChooseBtn').click();
            await page.locator('#torrentRetentionDays').selectOption('30');
            await page.evaluate(() => { fixture.patchMode = 'error'; });
            await page.locator('#saveBtn').click();
            await page.locator('#mediaPlayerDownloadGrantBtn').waitFor({ state: 'visible' });
            assert.equal(await page.evaluate(() => fixture.native.filter(message => message.action === 'grant_download_folder_access').length), 0, 'a permission error never grants access automatically');
            await page.locator('#mediaPlayerDownloadGrantBtn').click();
            await page.waitForFunction(() => document.querySelector('#mediaPlayerStorageStatus').dataset.state === 'saved');
            assert.equal(await page.locator('#mediaPlayerDownloadPath').inputValue(), selectedPath);
            assert.equal(await page.evaluate(() => fixture.settings.torrentRetentionDays), 30);
            assert.deepEqual(await page.evaluate(() => fixture.patches), [
                { torrentRetentionDays: 30, downloadPath: selectedPath },
                { torrentRetentionDays: 30, downloadPath: selectedPath }
            ], 'explicit permission grant retries the intended atomic settings update');
            assert.equal(await page.evaluate(() => fixture.native.filter(message => message.action === 'grant_download_folder_access').length), 1);
            assert.deepEqual(errors, []);
            await page.close();
        }
        {
            const { page, errors } = await mount(browser);
            await page.locator('#mediaPlayerDownloadChooseBtn').click();
            await page.evaluate(() => { fixture.patchMode = 'error'; fixture.grantError = 'download_folder_not_owned'; });
            await page.locator('#mediaPlayerDownloadSaveBtn').click();
            await page.locator('#mediaPlayerDownloadGrantBtn').click();
            await page.waitForFunction(() => document.querySelector('#mediaPlayerStorageStatus').textContent.includes('у папки другой владелец'));
            assert.equal(await page.locator('#mediaPlayerDownloadPath').inputValue(), initialPath);
            assert.equal(await page.locator('#mediaPlayerDownloadDraft').isVisible(), true);
            assert.equal(await page.evaluate(() => fixture.patches.length), 1, 'a rejected native ACL operation never retries PATCH');
            assert.deepEqual(errors, []);
            await page.close();
        }
        {
            const { page, errors } = await mount(browser, { legacy: true, language: 'en' });
            assert.equal(await page.locator('#mediaPlayerDownloadChooseBtn').isDisabled(), true);
            assert.match(await page.locator('#mediaPlayerStorageStatus').textContent(), /Update MediaPlayer Suite/);
            assert.equal(await page.locator('#torrentRetentionDays').isEnabled(), true);
            await page.locator('#torrentRetentionDays').selectOption('30');
            await page.locator('#saveBtn').click();
            await page.waitForFunction(() => fixture.settings.torrentRetentionDays === 30);
            assert.deepEqual(await page.evaluate(() => fixture.patches[0]), { torrentRetentionDays: 30 });
            assert.deepEqual(errors, []);
            await page.close();
        }
        {
            const { page, errors } = await mount(browser, { enabled: false });
            assert.equal(await page.locator('#mediaPlayerDownloadChooseBtn').isDisabled(), true);
            assert.equal(await page.locator('#torrentRetentionDays').isDisabled(), true);
            assert.equal(await page.evaluate(() => fixture.native.length), 0);
            assert.deepEqual(errors, []);
            await page.close();
        }
        {
            const { page, errors } = await mount(browser, { deferredGet: true });
            await page.locator('#mediaPlayerEnabledToggle').locator('..').click();
            await page.evaluate(() => fixture.pendingGet.shift()());
            await page.waitForFunction(() => document.querySelector('#mediaPlayerStorageStatus').dataset.state === 'disabled');
            assert.equal(await page.locator('#mediaPlayerDownloadPath').inputValue(), '', 'late GET cannot revive a disabled integration');
            assert.equal(await page.locator('#torrentRetentionDays').isDisabled(), true);
            assert.deepEqual(errors, []);
            await page.close();
        }
        {
            const { page, errors } = await mount(browser);
            await page.evaluate(() => { fixture.nativeMode = 'pending'; });
            await page.locator('#mediaPlayerDownloadChooseBtn').click();
            await page.locator('#mediaPlayerEnabledToggle').locator('..').click();
            await page.evaluate(() => fixture.pendingNative.shift()({ downloadPath: fixture.nextFolder }));
            await page.waitForFunction(() => document.querySelector('#mediaPlayerStorageStatus').dataset.state === 'disabled');
            assert.equal(await page.locator('#mediaPlayerDownloadDraft').isHidden(), true, 'late picker cannot restore a draft');
            assert.equal(await page.evaluate(() => fixture.patches.length), 0);
            assert.deepEqual(errors, []);
            await page.close();
        }
        {
            const { page, errors } = await mount(browser);
            await page.locator('#mediaPlayerDownloadChooseBtn').click();
            await page.evaluate(() => { fixture.patchMode = 'pending'; });
            await page.locator('#mediaPlayerDownloadSaveBtn').click();
            await page.waitForFunction(() => fixture.pendingPatch.length === 1);
            await page.locator('#mediaPlayerEnabledToggle').locator('..').click();
            await page.evaluate(() => fixture.pendingPatch.shift()());
            await page.waitForFunction(() => document.querySelector('#mediaPlayerStorageStatus').dataset.state === 'disabled');
            assert.equal(await page.locator('#mediaPlayerDownloadPath').inputValue(), '', 'late PATCH cannot revive disabled UI');
            assert.deepEqual(errors, []);
            await page.close();
        }
        console.log('PASS actual Settings Chromium fixture: folder preview/save/cancel, atomic failure, locks, old/disabled servers, stale GET/native/PATCH; dark/light × 1280/375');
    } finally { await browser.close(); }
}

module.exports = { mount, initialPath, selectedPath };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
