const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('src/shared/services/UpdateService.js', 'utf8');
const backgroundSource = fs.readFileSync('src/background/background.js', 'utf8');
const popupSource = fs.readFileSync('src/popup/popup.js', 'utf8');
const nativeHostSource = fs.readFileSync('native-host/Updater/Program.cs', 'utf8');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const settingsHtmlSource = fs.readFileSync('src/pages/settings/settings.html', 'utf8');
const settingsJsSource = fs.readFileSync('src/pages/settings/settings.js', 'utf8');
const storage = {};
const alarms = [];
let nativeUpdaterVersion = '1.1.0';
const extensionId = 'dgdejomdgiabgcfijcdhjefijdfiemhd';

const chrome = {
    runtime: {
        id: extensionId,
        getManifest: () => ({ version: '1.2.9' }),
        sendNativeMessage: (name, message, callback) => {
            callback({ success: true, configured: true, updaterVersion: nativeUpdaterVersion, operation: null });
        }
    },
    storage: {
        local: {
            async get(keys) {
                if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, storage[key]]));
                return storage;
            },
            async set(values) {
                Object.assign(storage, values);
            }
        }
    },
    alarms: {
        create(name, info) {
            alarms.push({ name, info });
        }
    }
};

const metadata = {
    schemaVersion: 1,
    extensionId,
    version: '1.3.0',
    assetName: 'MovieList-extension-1.3.0.zip',
    assetUrl: 'https://github.com/F1x-hub/MovieListExtension/releases/download/v1.3.0/MovieList-extension-1.3.0.zip',
    sha256: 'a'.repeat(64),
    size: 123,
    minUpdaterVersion: '1.1.0',
    publishedAt: '2026-09-08T00:00:00.000Z'
};

let fetchCount = 0;
const context = {
    chrome,
    fetch: async (url) => {
        fetchCount += 1;
        return {
            ok: true,
            status: 200,
            async text() {
                return url.endsWith('.sig') ? 'test-signature' : JSON.stringify(metadata);
            }
        };
    },
    console,
    globalThis: null,
    setTimeout,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' }
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'UpdateService.js' });

(async () => {
    await chrome.storage.local.set({ extension_update_settings_v1: { autoUpdateEnabled: false } });
    const state = await context.UpdateService.checkForUpdates({ force: true });
    assert.strictEqual(state.status, 'available_manual');
    assert.strictEqual(state.availableVersion, '1.3.0');
    assert.strictEqual(fetchCount, 2);
    assert.strictEqual(alarms.length, 0);
    assert.strictEqual(
        context.UpdateService.getSetupUrl(),
        'https://github.com/F1x-hub/MovieListExtension/releases/latest/download/MovieListSetup.exe'
    );
    assert.match(source, /checkAndInstallLatestRelease/);
    assert.doesNotMatch(source, /installLatestReleaseForTesting/);
    assert.doesNotMatch(source, /test_apply/);
    assert.strictEqual(fetchCount, 2);
    assert.match(settingsHtmlSource, /id="extensionUpdateInstallBtn"/);
    assert.match(settingsJsSource, /UpdateService\.checkAndInstallLatestRelease\(\)/);
    assert.doesNotMatch(settingsHtmlSource, /\(test\)/i);
    assert.doesNotMatch(settingsJsSource, /extensionUpdateDownload/);
    assert.ok(
        manifest.host_permissions.includes('https://release-assets.githubusercontent.com/*'),
        'GitHub release redirects must remain accessible to extension fetches'
    );
    assert.match(nativeHostSource, /"apply" => StartApply\(request, config\)/);
    assert.doesNotMatch(nativeHostSource, /test_apply/);
    assert.doesNotMatch(nativeHostSource, /allowSameVersion/);
    assert.match(nativeHostSource, /if \(currentVersion is not null/);

    assert.match(backgroundSource, /\['checkUpdates', 'checkUpdatesSafeRetry', 'checkUpdateOperation'\]\.includes\(alarm\.name\)/);
    assert.match(source, /const OPERATION_ALARM = 'checkUpdateOperation'/);
    assert.match(source, /function isOperationPending\(/);
    assert.match(source, /createOperationAlarm\(\)/);
    assert.match(source, /if \(isOperationPending\(state\) \|\| state\.status === 'awaiting_confirmation'\) return state/);
    assert.match(source, /await syncNativeOperation\(\{ reloadWhenReady: isOperationPending\(refreshed\.state\) \}\)\.catch/);
    assert.match(nativeHostSource, /allowed_origins = new\[\] \{ \$"chrome-extension:\/\/\{extensionId\}\/" \}/);
    assert.doesNotMatch(nativeHostSource, /chrome-extension:\/\/\{extensionId\}\/\*\//);
    assert.match(nativeHostSource, /FirstOrDefault\(arg => arg\.StartsWith\("chrome-extension:\/\/"/);
    assert.match(nativeHostSource, /\?\.TrimEnd\('\/'\)/);
    assert.doesNotMatch(source, /rollbackUpdate/);
    assert.doesNotMatch(backgroundSource, /ROLLBACK_UPDATE/);
    assert.doesNotMatch(popupSource, /rollbackAvailable|ROLLBACK_UPDATE/);
    const cachedState = await context.UpdateService.checkForUpdates();
    assert.strictEqual(cachedState.status, 'available_manual');
    assert.strictEqual(fetchCount, 2, 'a throttled check must not fetch the release again');
   await context.UpdateService.handleAlarm({ name: 'checkUpdatesSafeRetry' });
   assert.strictEqual(fetchCount, 4);
    nativeUpdaterVersion = '1.0.0';
    const migrationState = await context.UpdateService.checkForUpdates({ force: true });
    assert.strictEqual(migrationState.status, 'setup_required');
    assert.strictEqual(migrationState.errorCode, 'UPDATER_UPGRADE_REQUIRED');
   console.log('updateService.test.js passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
