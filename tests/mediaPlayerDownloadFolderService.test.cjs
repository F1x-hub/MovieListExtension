const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/shared/services/MediaPlayerService.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window, AbortController, URL, setTimeout, clearTimeout });
const Service = window.MediaPlayerService;
const pathA = 'C:\\Media\\Downloads';
const pathB = 'D:\\Movies and series';
const settings = { torrentRetentionDays: 7, options: [0, 1, 3, 7, 14, 30], storage: { supported: true, downloadPath: pathA, defaultDownloadPath: pathA } };

(async () => {
    let nativeCallback;
    const nativeMessages = [];
    const service = new Service({ chromeApi: { runtime: { sendNativeMessage: (_host, message, callback) => {
        nativeMessages.push(message);
        nativeCallback = callback;
    } } } });
    let pending = service.chooseDownloadFolder();
    nativeCallback({ downloadPath: pathB });
    assert.equal((await pending).downloadPath, pathB);
    assert.equal(nativeMessages[0].action, 'select_download_folder');
    pending = service.chooseDownloadFolder();
    nativeCallback({ installPath: pathB });
    await assert.rejects(pending, error => error.code === 'download_path_missing', 'installation paths must never become download folders');
    pending = service.chooseDownloadFolder();
    nativeCallback({ error: 'folder_selection_cancelled' });
    await assert.rejects(pending, error => error.code === 'folder_selection_cancelled');
    const controller = new AbortController();
    pending = service.chooseDownloadFolder({ signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error.code === 'request_aborted');
    nativeCallback({ downloadPath: pathB }); // A late native callback must be harmless.
    pending = service.grantDownloadFolderAccess(pathB);
    nativeCallback({ downloadPath: pathB, granted: true });
    assert.equal((await pending).granted, true);
    assert.equal(nativeMessages.at(-1).action, 'grant_download_folder_access');
    assert.equal(nativeMessages.at(-1).downloadPath, pathB);
    assert.equal(Object.hasOwn(nativeMessages.at(-1), 'installPath'), false);
    pending = service.grantDownloadFolderAccess(pathB);
    nativeCallback({ error: 'download_folder_not_owned' });
    await assert.rejects(pending, error => error.code === 'download_folder_not_owned');
    await assert.rejects(service.grantDownloadFolderAccess(''), error => error.code === 'download_path_invalid');

    const requests = [];
    service.getDeviceToken = async () => 'fixture-device-token';
    service.fetchImpl = async (_url, options) => {
        requests.push(options);
        return { ok: true, status: 200, json: async () => ({ ...settings, storage: { ...settings.storage, downloadPath: JSON.parse(options.body).downloadPath || pathA } }) };
    };
    assert.equal((await service.setDownloadPath(pathB)).storage.downloadPath, pathB);
    assert.deepEqual(JSON.parse(requests[0].body), { downloadPath: pathB });
    await service.updateSettings({ torrentRetentionDays: 14, downloadPath: pathB });
    assert.deepEqual(JSON.parse(requests[1].body), { torrentRetentionDays: 14, downloadPath: pathB });
    await assert.rejects(service.updateSettings({}), error => error.code === 'invalid_settings');
    await assert.rejects(service.setDownloadPath(''), error => error.code === 'download_path_invalid');
    assert.equal(service.normalizeSettings({ torrentRetentionDays: 14 }).storage.supported, false);
    service.fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ torrentRetentionDays: 7 }) });
    await assert.rejects(service.setDownloadPath(pathB), error => error.code === 'download_path_unsupported');
    service.fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_settings', reason: 'download_path_permission_denied', message: 'Service cannot write here.' }) });
    await assert.rejects(service.setDownloadPath(pathB), error => error.reason === 'download_path_permission_denied' && error.message === 'Service cannot write here.');
    console.log('PASS download-folder service: native protocol, cancellation, late replies, partial/atomic PATCH, legacy server, precise error');
})().catch(error => { console.error(error); process.exitCode = 1; });
