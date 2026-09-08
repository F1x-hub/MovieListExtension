const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('src/shared/services/UpdateService.js', 'utf8');
const backgroundSource = fs.readFileSync('src/background/background.js', 'utf8');
const nativeHostSource = fs.readFileSync('native-host/Updater/Program.cs', 'utf8');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const settingsHtmlSource = fs.readFileSync('src/pages/settings/settings.html', 'utf8');
const settingsJsSource = fs.readFileSync('src/pages/settings/settings.js', 'utf8');
const storage = {};
const alarms = [];
const extensionId = 'dgdejomdgiabgcfijcdhjefijdfiemhd';

const chrome = {
    runtime: {
        id: extensionId,
        getManifest: () => ({ version: '1.2.9' }),
        sendNativeMessage: (name, message, callback) => {
            callback({ success: true, configured: true, operation: null });
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
    minUpdaterVersion: '1.0.0',
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
    assert.match(source, /installLatestReleaseForTesting/);
    assert.match(source, /action: 'test_apply'/);
    assert.strictEqual(fetchCount, 2);
    assert.match(settingsHtmlSource, /id="extensionUpdateDownloadBtn"/);
    assert.match(settingsJsSource, /UpdateService\.installLatestReleaseForTesting\(\)/);
    assert.ok(
        manifest.host_permissions.includes('https://release-assets.githubusercontent.com/*'),
        'GitHub release redirects must remain accessible to extension fetches'
    );
    assert.match(nativeHostSource, /"test_apply" => StartApply\(request, config, allowSameVersion: true\)/);
    assert.match(nativeHostSource, /if \(!allowSameVersion && currentVersion is not null/);

    assert.match(backgroundSource, /\['checkUpdates', 'checkUpdatesSafeRetry'\]\.includes\(alarm\.name\)/);
    assert.match(nativeHostSource, /allowed_origins = new\[\] \{ \$"chrome-extension:\/\/\{extensionId\}\/" \}/);
    assert.doesNotMatch(nativeHostSource, /chrome-extension:\/\/\{extensionId\}\/\*\//);
    await context.UpdateService.handleAlarm({ name: 'checkUpdatesSafeRetry' });
    assert.strictEqual(fetchCount, 4);
    console.log('updateService.test.js passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
