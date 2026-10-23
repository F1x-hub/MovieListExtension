const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { buildCatalog, signCatalog, verifyCatalog } = require('../scripts/generate-component-metadata.js');
const source = fs.readFileSync('src/shared/services/UpdateService.js', 'utf8');
const prefix = 'https://github.com/F1x-hub/MovieListExtension/releases/download/';

function descriptor(id, version) {
    const name = id === 'updater' ? 'MovieListSetup.exe' : 'MediaPlayerSuiteSetup.exe';
    return { version, assetName: name, assetUrl: `${prefix}v1.4.0/${name}`, sha256: 'a'.repeat(64), size: 100,
        ...(id === 'mediaPlayerSuite' ? { apiMajor: 1, buildId: 'suite-fixture' } : {}) };
}
function lockManager() {
    const queues = new Map();
    return { request(name, action) {
        const task = (queues.get(name) || Promise.resolve()).then(action);
        queues.set(name, task.catch(() => {}));
        return task;
    } };
}
function harness(options = {}) {
    const catalog = { schemaVersion: 1, productId: 'movielist', channel: 'stable', publishedAt: '2026-10-23T00:00:00Z',
        components: { updater: descriptor('updater', '1.1.5'), mediaPlayerSuite: descriptor('mediaPlayerSuite', '0.2.0') } };
    const storage = options.storage || { extension_update_settings_v1: { autoUpdateEnabled: false, componentAutoUpdateEnabled: options.auto || {} } };
    const host = { success: true, configured: true, updaterVersion: '1.1.4', operation: null,
        componentCapabilities: { protocolVersion: 1, signedCatalog: true, updaterSelfUpdate: true, mediaPlayerSuite: true },
        components: { updater: { installed: true, version: '1.1.4' }, mediaPlayerSuite: {
            installed: true, layoutValid: true, version: '0.1.0', brokerAvailable: true, ready: false, status: 'installed' } } };
    const calls = [];
    const alarms = [];
    const urls = [];
    const chrome = {
        runtime: { id: 'ext', getManifest: () => ({ version: '1.4.0' }), sendMessage: () => Promise.resolve(),
            sendNativeMessage(name, message, callback) {
                calls.push(message);
                if (message.action === 'validate_component_catalog') callback(options.badSignature
                    ? { success: false, errorCode: 'COMPONENT_CATALOG_INVALID' } : { success: true });
                else if (message.action === 'apply_component') callback({ success: true, operationId: message.operationId, status: 'queued' });
                else callback(JSON.parse(JSON.stringify(host)));
            } },
        storage: { local: {
            async get(keys) { return keys === null ? storage : Object.fromEntries(keys.map(key => [key, storage[key]])); },
            async set(values) { Object.assign(storage, values); }, async remove(keys) { keys.forEach(key => delete storage[key]); }
        } },
        alarms: { create(name) { alarms.push(['create', name]); }, clear: async (name) => { alarms.push(['clear', name]); return true; } },
        tabs: { query: async () => [{ id: 5, url: 'https://example.com' }] },
        scripting: { executeScript: async () => [{ result: options.playing === true }] }
    };
    const context = { chrome, console, URL, AbortController, setTimeout, clearTimeout,
        navigator: { locks: options.locks || lockManager() },
        crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
        fetch: async url => {
            urls.push(url);
            if (url.includes('components.json')) return { ok: !options.missingCatalog, status: options.missingCatalog ? 404 : 200,
                text: async () => url.endsWith('.sig') ? 'fixture-signature' : JSON.stringify(catalog) };
            return { ok: true, status: 200, text: async () => url.endsWith('.sig') ? 'legacy-signature' : JSON.stringify({
                schemaVersion: 1, extensionId: 'ext', version: '1.4.0', assetName: 'MovieList-extension-1.4.0.zip',
                assetUrl: `${prefix}v1.4.0/MovieList-extension-1.4.0.zip`, sha256: 'b'.repeat(64), size: 10, minUpdaterVersion: '1.1.4' }) };
        } };
    context.globalThis = context;
    vm.runInNewContext(source, context);
    return { service: context.UpdateService, storage, host, calls, urls, catalog, alarms, chrome };
}

(async () => {
    const current = harness();
    const currentState = await current.service.checkForUpdates({ force: true, interactive: true });
    assert.equal(currentState.status, 'up_to_date');
    assert.equal(currentState.components.updater.availableVersion, '1.1.5');
    assert.equal(currentState.components.mediaPlayerSuite.status, 'available_manual', 'not ready must still count as installed');
    assert.equal(current.calls.filter(call => call.action === 'apply_component').length, 0, 'new automatic controls are opt-in');
    assert.equal((await current.service.getState()).settings.componentAutoUpdateEnabled.updater, false);
    assert.equal(await current.service.getComponentSetupUrl('mediaPlayerSuite'), current.catalog.components.mediaPlayerSuite.assetUrl);
    current.host.components.mediaPlayerSuite.installed = false;
    const absentBeforeActivation = await current.service.applyComponent('mediaPlayerSuite');
    assert.equal(absentBeforeActivation.components.mediaPlayerSuite.status, 'absent');
    assert.equal(current.calls.filter(call => call.action === 'apply_component').length, 0, 'uninstalled Suite must never be reinstalled');

    const legacy = harness({ missingCatalog: true });
    assert.equal((await legacy.service.checkForUpdates({ force: true })).status, 'up_to_date');
    assert.equal((await legacy.service.getState()).state.componentCatalogStatus, 'legacy');
    assert.equal(await legacy.service.getComponentSetupUrl('mediaPlayerSuite'), null);
    const oldHost = harness(); oldHost.host.componentCapabilities = null;
    const old = await oldHost.service.checkForUpdates({ force: true });
    assert.equal(old.status, 'up_to_date');
    assert.equal(old.components.updater.status, 'setup_required');
    assert.equal(oldHost.urls.some(url => url.includes('components.json')), false);

    const invalid = harness({ badSignature: true });
    const failed = await invalid.service.checkForUpdates({ force: true });
    assert.equal(failed.status, 'up_to_date', 'a rejected catalog must not break legacy extension updates');
    assert.equal(failed.componentCatalogStatus, 'check_failed');
    assert.equal(await invalid.service.getComponentSetupUrl('mediaPlayerSuite'), null);
    const unknown = harness(); unknown.host.components.mediaPlayerSuite.version = null;
    assert.equal((await unknown.service.checkComponentUpdates({ force: true })).components.mediaPlayerSuite.status, 'migration_required');

    const noBroker = harness({ auto: { mediaPlayerSuite: true } }); noBroker.host.components.mediaPlayerSuite.brokerAvailable = false;
    const unattended = await noBroker.service.checkComponentUpdates({ force: true });
    assert.equal(unattended.components.mediaPlayerSuite.status, 'setup_required');
    assert.equal(unattended.components.mediaPlayerSuite.errorCode, 'SUITE_MAINTENANCE_SETUP_REQUIRED');
    assert.equal(noBroker.calls.filter(call => call.action === 'apply_component').length, 0, 'automatic checks cannot raise UAC');
    await noBroker.service.applyComponent('mediaPlayerSuite', { automatic: false });
    assert.equal(noBroker.calls.filter(call => call.action === 'apply_component').length, 1, 'manual marked-Suite migration may request UAC');
    const request = noBroker.calls.find(call => call.action === 'apply_component');
    assert.deepEqual(Object.keys(request).sort(), ['action', 'componentId', 'extensionId', 'metadataText', 'operationId', 'protocolVersion', 'signature'].sort());

    const playing = harness({ playing: true }); await playing.service.checkComponentUpdates({ force: true });
    assert.equal((await playing.service.applyComponent('mediaPlayerSuite')).components.mediaPlayerSuite.status, 'waiting_for_safe_moment');
    assert.equal(playing.calls.filter(call => call.action === 'apply_component').length, 0);
    const minimum = harness(); minimum.catalog.components.updater.minUpdaterVersion = '1.2.0';
    assert.equal((await minimum.service.checkComponentUpdates({ force: true })).components.updater.errorCode, 'UPDATER_UPGRADE_REQUIRED');
    assert.equal((await minimum.service.applyComponent('updater')).components.updater.status, 'setup_required');
    const protocol = harness(); protocol.catalog.components.mediaPlayerSuite.apiMajor = 2;
    assert.equal((await protocol.service.checkComponentUpdates({ force: true })).components.mediaPlayerSuite.errorCode, 'SUITE_API_UNSUPPORTED');
    const auto = harness({ auto: { updater: true } });
    assert.equal((await auto.service.checkComponentUpdates({ force: true })).components.updater.status, 'queued');
    auto.host.componentOperation = { componentId: 'updater', operationId: '00000000-0000-4000-8000-000000000001', version: '1.1.5', status: 'installing' };
    auto.host.operation = { operationId: 'old-extension-operation', status: 'failed' };
    auto.alarms.length = 0;
    await auto.service.syncNativeOperation();
    assert.equal(auto.alarms.some(([action]) => action === 'clear'), false, 'legacy terminal journals must not cancel component polling');
    auto.host.componentOperation = { componentId: 'updater', operationId: '00000000-0000-4000-8000-000000000001', version: '1.1.5', status: 'succeeded' };
    auto.host.components.updater.version = '1.1.5';
    await auto.service.syncNativeOperation();
    assert.equal((await auto.service.getState()).state.components.updater.currentVersion, '1.1.5');
    const deferred = harness({ auto: { mediaPlayerSuite: true } });
    deferred.host.componentOperation = { componentId: 'mediaPlayerSuite', operationId: 'deferred-suite-operation', version: '0.2.0', status: 'failed', errorCode: 'SUITE_BROKER_DEFERRED' };
    await deferred.service.syncNativeOperation();
    assert.equal((await deferred.service.getState()).state.components.mediaPlayerSuite.status, 'waiting_for_safe_moment');
    assert.ok(deferred.alarms.some(([action, name]) => action === 'create' && name === 'checkUpdatesSafeRetry'));
    const settings = harness();
    await settings.service.setComponentAutoUpdateEnabled('updater', true);
    await settings.service.setAutoUpdateEnabled(false);
    assert.equal((await settings.service.getState()).settings.componentAutoUpdateEnabled.updater, true, 'legacy settings save must preserve opt-in choices');

    const shared = { storage: { extension_update_settings_v1: { autoUpdateEnabled: true, futureSetting: 'preserved' } }, locks: lockManager() };
    const windowA = harness(shared), windowB = harness(shared), worker = harness(shared);
    await Promise.all([
        windowA.service.setComponentAutoUpdateEnabled('updater', true),
        windowB.service.setComponentAutoUpdateEnabled('mediaPlayerSuite', true),
        worker.service.setAutoUpdateEnabled(false)
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(shared.storage.extension_update_settings_v1)), {
        autoUpdateEnabled: false, futureSetting: 'preserved',
        componentAutoUpdateEnabled: { updater: true, mediaPlayerSuite: true }
    }, 'independent windows and the worker must merge preferences without lost writes');
    const originalSet = windowA.chrome.storage.local.set;
    windowA.chrome.storage.local.set = async values => {
        if (values.extension_update_settings_v1) throw new Error('fixture storage failure');
        return originalSet(values);
    };
    await assert.rejects(windowA.service.setComponentAutoUpdateEnabled('updater', false), /fixture storage failure/);
    await windowB.service.setComponentAutoUpdateEnabled('mediaPlayerSuite', false);
    assert.equal(shared.storage.extension_update_settings_v1.componentAutoUpdateEnabled.updater, true);
    assert.equal(shared.storage.extension_update_settings_v1.componentAutoUpdateEnabled.mediaPlayerSuite, false,
        'a failed write must release the cross-context lock');

    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'movielist-catalog-'));
    try {
        const extensionFile = path.join(fixture, 'extension.zip'), updaterFile = path.join(fixture, 'updater.exe'), suiteFile = path.join(fixture, 'suite.exe');
        fs.writeFileSync(extensionFile, 'fixture-extension'); fs.writeFileSync(updaterFile, 'fixture-updater'); fs.writeFileSync(suiteFile, 'fixture-suite');
        const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
        const inputs = { extensionFile, extensionVersion: '1.4.0', updaterFile, updaterVersion: '1.1.4', tag: 'v1.4.0' };
        const first = buildCatalog({ ...inputs, suiteFile, suiteVersion: '0.1.0', suiteApiMajor: 1, suiteBuildId: 'fixture' });
        const newerHost = buildCatalog({ ...inputs, updaterVersion: '1.1.5', suiteFile, suiteVersion: '0.2.0', suiteApiMajor: 1 });
        assert.equal(newerHost.components.mediaPlayerSuite.minUpdaterVersion, '1.1.4', 'compatibility floor must remain independent of the updater release version');
        const signed = signCatalog(first, privateKey, publicKey);
        assert.deepEqual(verifyCatalog(signed.text, signed.signature, publicKey), first);
        const next = buildCatalog({ ...inputs, extensionVersion: '1.4.1', tag: 'v1.4.1', previous: first });
        assert.deepEqual(next.components.mediaPlayerSuite, first.components.mediaPlayerSuite, 'extension-only releases must retain the immutable existing Suite URL/hash/version');
        assert.equal(buildCatalog(inputs).components.mediaPlayerSuite, undefined, 'missing explicit Suite artifact must never create a fake descriptor');
        assert.throws(() => buildCatalog({ ...inputs, suiteVersion: '0.1.0' }));
        assert.throws(() => buildCatalog({ ...inputs, updaterVersion: '1.1.3', previous: first }), /downgrade/);
        assert.throws(() => verifyCatalog(signed.text.replace('fixture', 'tampered'), signed.signature, publicKey), /signature/);
        const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
        assert.throws(() => signCatalog(first, other, publicKey), /match/);
        fs.writeFileSync(suiteFile, 'different-suite');
        assert.throws(() => buildCatalog({ ...inputs, suiteFile, suiteVersion: '0.1.0', suiteApiMajor: 1, previous: first }), /different bytes/);
    } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
    console.log('componentUpdates.test.cjs passed: independent checks, migration/absence, signature gate, opt-in/UAC, playback, minimum version and signed catalog packaging.');
})().catch(error => { console.error(error); process.exitCode = 1; });
