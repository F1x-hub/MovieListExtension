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
let nativeUpdaterVersion = '1.1.1';
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
    minUpdaterVersion: '1.1.1',
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
    clearTimeout,
    AbortController,
    URL,
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
assert.match(source, /\\d\+\(\?:\\\.\\d\+\)\{2,3\}/);
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
    assert.match(settingsJsSource, /type: 'CHECK_FOR_UPDATES'/);
    assert.match(settingsJsSource, /type: 'APPLY_UPDATE'/);
    assert.match(popupSource, /type: 'CHECK_FOR_UPDATES'/,
        'the popup update action must perform an interactive update check');
    assert.match(popupSource, /showPlaybackUpdateDialog/,
        'the popup must ask before interrupting active playback');
    assert.match(popupSource, /this\.updateActionInFlight = false/,
        'the popup must release its action lock after a terminal update state');
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
    assert.match(source, /activeCheckDidFetch/,
        'manual checks must detect when a shared check was throttled before fetching');
    assert.match(source, /async function closeExtensionPages\(/);
    assert.match(source, /await closeExtensionPages\(\)/);
    assert.match(source, /async function getState\(/);
    assert.match(backgroundSource, /interactive: message\.interactive === true/);
    assert.match(backgroundSource, /allowPlayback: message\.allowPlayback === true/);
    assert.match(source, /createOperationAlarm\(\)/);
    assert.match(source, /if \(isOperationPending\(state\) \|\| state\.status === 'awaiting_confirmation'\) return state/);
    assert.match(source, /await syncNativeOperation\(\)\.catch/);
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
    let failedRequests = 0;
    context.fetch = async () => {
        failedRequests += 1;
        throw new TypeError('Failed to fetch');
    };
    const failedCheck = await context.UpdateService.checkForUpdates({ force: true });
    assert.strictEqual(failedCheck.status, 'check_failed', 'stale metadata must not hide a network failure');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.strictEqual(failedRequests, 12, 'two metadata files on two sources each make at most three attempts');
    assert.match(failedCheck.errorMessage, /NETWORK_FAILED_/);
    nativeUpdaterVersion = '1.1.4';
    let githubFailures = 0;
    let mirrorRequests = 0;
    context.fetch = async url => {
        if (url.startsWith('https://github.com/')) {
            githubFailures++;
            throw new TypeError('unreachable');
        }
        mirrorRequests++;
        return { ok: true, status: 200, text: async () => url.endsWith('.sig') ? 'mirror-signature' : JSON.stringify(metadata) };
    };
    const mirrorState = await context.UpdateService.checkForUpdates({ force: true });
    assert.strictEqual(mirrorState.status, 'available_manual');
    assert.strictEqual(mirrorState.signature, 'mirror-signature');
    assert.strictEqual(githubFailures, 6);
    assert.strictEqual(mirrorRequests, 2);

    let releaseRaceRead;
    let raceReadBlocked = new Promise(resolve => { releaseRaceRead = resolve; });
    let raceFirstRead = true;
    let raceFetchCount = 0;
    const raceStorageData = {
        extension_update_state_v2: {
            status: 'up_to_date',
            currentVersion: '1.2.9',
            availableVersion: null,
            nextCheckAt: Date.now() + 60 * 60 * 1000
        },
        extension_update_settings_v1: { autoUpdateEnabled: false }
    };
    const raceStorage = {
        async get(keys) {
            if (raceFirstRead && Array.isArray(keys)
                && keys.includes('extension_update_state_v2')) {
                raceFirstRead = false;
                await raceReadBlocked;
            }
            if (Array.isArray(keys)) {
                return Object.fromEntries(keys.map(key => [key, raceStorageData[key]]));
            }
            return { ...raceStorageData };
        },
        async set(values) {
            Object.assign(raceStorageData, values);
        }
    };
    const raceChrome = {
        runtime: {
            id: extensionId,
            getManifest: () => ({ version: '1.2.9' }),
            sendNativeMessage: (name, message, callback) => {
                callback({ success: true, configured: true, updaterVersion: '1.1.4', operation: null });
            }
        },
        storage: { local: raceStorage },
        alarms: { create() {} }
    };
    const raceContext = {
        chrome: raceChrome,
        fetch: async url => {
            raceFetchCount += 1;
            return {
                ok: true,
                status: 200,
                async text() {
                    return url.endsWith('.sig') ? 'race-signature' : JSON.stringify(metadata);
                }
            };
        },
        console,
        globalThis: null,
        setTimeout,
        clearTimeout,
        AbortController,
        URL,
        crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000002' }
    };
    raceContext.globalThis = raceContext;
    vm.runInNewContext(source, raceContext, { filename: 'UpdateService-race.js' });
    const backgroundCheck = raceContext.UpdateService.checkForUpdates();
    const manualCheck = raceContext.UpdateService.checkForUpdates({ force: true, interactive: true });
    releaseRaceRead();
    const [backgroundState, manualState] = await Promise.all([backgroundCheck, manualCheck]);
    assert.strictEqual(backgroundState.status, 'up_to_date');
    assert.strictEqual(manualState.status, 'available_manual',
        'a manual force check must not inherit a throttled background result');
    assert.strictEqual(raceFetchCount, 2,
        'the manual request must perform one fresh metadata/signature fetch pair');
    console.log('updateService.test.js passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
