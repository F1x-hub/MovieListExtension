const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('src/shared/services/UpdateService.js', 'utf8');
const settingsSource = fs.readFileSync('src/pages/settings/settings.js', 'utf8');
const localesSource = fs.readFileSync('src/shared/i18n/locales.js', 'utf8');

function createHarness({ executeResult = false, executeError = false, automatic = false, allowPlayback = false, nativeApplyStatus = 'succeeded' }) {
    const storage = {
        extension_update_state_v2: {
            status: 'available',
            currentVersion: '1.3.0',
            availableVersion: '1.3.1',
            metadata: {
                version: '1.3.1',
                extensionId: 'ext',
                assetName: 'MovieList-extension-1.3.1.zip',
                assetUrl: 'https://github.com/F1x-hub/MovieListExtension/releases/download/v1.3.1/MovieList-extension-1.3.1.zip',
                sha256: 'a'.repeat(64),
                size: 123
            },
            metadataText: '{}',
            signature: 'signature'
        },
        extension_update_settings_v1: { autoUpdateEnabled: true }
    };
    const alarms = [];
    let applyCalls = 0;
    let reloadCalls = 0;

    const chrome = {
        runtime: {
            id: 'ext',
            getManifest: () => ({ version: '1.3.0' }),
            lastError: null,
            reload: () => {
                reloadCalls += 1;
            },
            sendMessage: () => undefined,
            sendNativeMessage: (name, message, callback) => {
                if (message.action === 'apply') {
                    applyCalls += 1;
                    callback({ success: true, status: nativeApplyStatus, operationId: 'operation-1' });
                    return;
                }
            callback({ success: true, configured: true, updaterVersion: '1.1.1', operation: null });
            }
        },
        storage: {
            local: {
                async get(keys) {
                    return Object.fromEntries(keys.map(key => [key, storage[key]]));
                },
                async set(values) {
                    Object.assign(storage, values);
                }
            }
        },
        offscreen: {
            hasDocument: async () => false
        },
        tabs: {
            query: async () => [{ id: 7, url: 'https://example.com' }]
        },
        scripting: {
            executeScript: async () => {
                if (executeError) throw new Error('Missing host permission');
                return [{ result: executeResult }];
            }
        },
        alarms: {
            create(name, info) {
                alarms.push({ name, info });
            }
        }
    };

    const context = {
        chrome,
        console,
        fetch: async (url) => ({
            ok: true,
            status: 200,
            text: async () => url.endsWith('.sig')
                ? 'signature'
                : JSON.stringify(storage.extension_update_state_v2.metadata)
        }),
        setTimeout: (callback) => {
            callback();
            return 0;
        },
        crypto: { randomUUID: () => 'operation-1' },
        globalThis: null
    };
    context.globalThis = context;
    vm.runInNewContext(source, context, { filename: 'UpdateService.js' });

    return {
        apply: () => context.UpdateService.applyUpdate({ automatic, allowPlayback }),
        installLatest: () => context.UpdateService.checkAndInstallLatestRelease(),
        getState: () => context.UpdateService.getState(),
        get applyCalls() {
            return applyCalls;
        },
        get reloadCalls() {
            return reloadCalls;
        },
        alarms
    };
}

(async () => {
    const inaccessibleTab = createHarness({ executeError: true });
    const inaccessibleResult = await inaccessibleTab.apply();
    assert.strictEqual(inaccessibleResult.status, 'succeeded',
        'an inaccessible ordinary tab must not be treated as active playback');
    assert.strictEqual(inaccessibleTab.applyCalls, 1);

    const reloadBeforeReplacement = createHarness({ nativeApplyStatus: 'queued' });
    const queuedResult = await reloadBeforeReplacement.apply();
    assert.strictEqual(queuedResult.status, 'queued');
    assert.strictEqual(reloadBeforeReplacement.reloadCalls, 1,
        'the extension must reload before the native host replaces its unpacked folder');

    const activePlayback = createHarness({ executeResult: true });
    const blockedResult = await activePlayback.apply();
    assert.strictEqual(blockedResult.status, 'waiting_for_safe_moment');
    assert.strictEqual(blockedResult.requiresConfirmation, true,
        'manual update must expose a confirmation requirement');
    assert.deepStrictEqual(Array.from(blockedResult.playbackReasons), ['tab_media']);
    assert.strictEqual(activePlayback.applyCalls, 0);
    assert.strictEqual(activePlayback.alarms.length, 1);

    const manualFlow = createHarness({ executeResult: true });
    const manualResult = await manualFlow.installLatest();
    assert.strictEqual(manualResult.status, 'waiting_for_safe_moment');
    assert.strictEqual(manualResult.requiresConfirmation, true,
        'the settings button must receive a confirmation-required result');

    const confirmedPlayback = createHarness({ executeResult: true, allowPlayback: true });
    const confirmedResult = await confirmedPlayback.apply();
    assert.strictEqual(confirmedResult.status, 'succeeded',
        'explicit user confirmation must allow a manual update during playback');
    assert.strictEqual(confirmedPlayback.applyCalls, 1);

    const automaticPlayback = createHarness({ executeResult: true, automatic: true });
    const automaticResult = await automaticPlayback.apply();
    assert.strictEqual(automaticResult.status, 'waiting_for_safe_moment');
    assert.strictEqual(automaticResult.requiresConfirmation, false,
        'automatic updates must wait silently instead of opening a confirmation flow');

    assert.match(settingsSource, /showPlaybackUpdateDialog/);
    assert.match(settingsSource, /allowPlayback: true/);
    assert.match(settingsSource, /EXTENSION_UPDATE_STATE_STORAGE_KEY/);
    assert.match(settingsSource, /storage\.onChanged\.addListener/);
    assert.match(localesSource, /playback_confirm_button/);
    assert.match(localesSource, /playback_decline_button/);

    console.log('updateServicePlayback.test.js passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
