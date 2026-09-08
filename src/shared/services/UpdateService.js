/*
 * GitHub ZIP updater coordinator.
 *
 * The service worker owns the update state, while the Native Host owns every
 * filesystem operation. The extension never passes a shell command or a
 * destination path to the host.
 */
(function (global) {
    'use strict';

    const HOST_NAME = 'com.movielist.updater';
    const STATE_KEY = 'extension_update_state_v2';
    const SETTINGS_KEY = 'extension_update_settings_v1';
    const METADATA_URL = 'https://github.com/F1x-hub/MovieListExtension/releases/latest/download/update.json';
    const SIGNATURE_URL = 'https://github.com/F1x-hub/MovieListExtension/releases/latest/download/update.json.sig';
    const SETUP_URL = 'https://github.com/F1x-hub/MovieListExtension/releases/latest/download/MovieListSetup.exe';
    const CHECK_ALARM = 'checkUpdates';
    const SAFE_RETRY_ALARM = 'checkUpdatesSafeRetry';
    const CHECK_INTERVAL_MINUTES = 360;
    const RETRY_DELAY_MINUTES = 30;
    const HOST_PROTOCOL_VERSION = 1;

    let alarmRegistered = false;
    let activeCheck = null;

    function now() {
        return Date.now();
    }

    function normalizeVersion(version) {
        const value = String(version || '').trim().replace(/^v/i, '');
        if (!/^\d+\.\d+\.\d+$/.test(value)) return null;
        return value;
    }

    function compareVersions(first, second) {
        const left = String(first || '').split('.').map(Number);
        const right = String(second || '').split('.').map(Number);
        for (let index = 0; index < 3; index += 1) {
            const a = Number.isFinite(left[index]) ? left[index] : 0;
            const b = Number.isFinite(right[index]) ? right[index] : 0;
            if (a !== b) return a > b ? 1 : -1;
        }
        return 0;
    }

    function defaultState() {
        return {
            status: 'idle',
            currentVersion: chrome.runtime.getManifest().version,
            availableVersion: null,
            operationId: null,
            lastCheckedAt: 0,
            nextCheckAt: 0,
            deferredUntil: 0,
            errorCode: null,
            errorMessage: null,
            configured: null
        };
    }

    function defaultSettings() {
        return { autoUpdateEnabled: true };
    }

    async function readState() {
        const result = await chrome.storage.local.get([STATE_KEY, SETTINGS_KEY]);
        return {
            state: { ...defaultState(), ...(result[STATE_KEY] || {}) },
            settings: { ...defaultSettings(), ...(result[SETTINGS_KEY] || {}) }
        };
    }

    async function writeState(patch) {
        const { state } = await readState();
        const next = { ...state, ...patch };
        await chrome.storage.local.set({ [STATE_KEY]: next });
        try {
            const notification = chrome.runtime.sendMessage({ type: 'UPDATE_STATE_CHANGED', state: next });
            notification?.catch?.(() => {});
        } catch {
            // The popup is normally closed while background work runs.
        }
        return next;
    }

    function nativeMessage(message) {
        return new Promise((resolve, reject) => {
            if (!chrome.runtime.sendNativeMessage) {
                reject(new Error('NATIVE_MESSAGING_UNAVAILABLE'));
                return;
            }

            chrome.runtime.sendNativeMessage(HOST_NAME, {
                protocolVersion: HOST_PROTOCOL_VERSION,
                extensionId: chrome.runtime.id,
                ...message
            }, (response) => {
                const runtimeError = chrome.runtime.lastError;
                if (runtimeError) {
                    reject(new Error(runtimeError.message || 'NATIVE_HOST_UNAVAILABLE'));
                    return;
                }
                if (!response || response.success !== true) {
                    reject(new Error(response?.errorCode || response?.error || 'NATIVE_HOST_ERROR'));
                    return;
                }
                resolve(response);
            });
        });
    }

    function isExpectedMetadata(metadata) {
        const version = normalizeVersion(metadata?.version);
        const extensionId = String(metadata?.extensionId || '');
        const assetName = String(metadata?.assetName || '');
        const assetUrl = String(metadata?.assetUrl || '');
        return Boolean(
            version
            && extensionId === chrome.runtime.id
            && /^[A-Za-z0-9._-]+\.zip$/.test(assetName)
            && /^https:\/\/github\.com\/F1x-hub\/MovieListExtension\/releases\/download\//.test(assetUrl)
            && /^[a-f0-9]{64}$/i.test(String(metadata?.sha256 || ''))
            && Number.isSafeInteger(Number(metadata?.size))
            && Number(metadata.size) > 0
        );
    }

    async function fetchReleaseMetadata() {
        const [metadataResponse, signatureResponse] = await Promise.all([
            fetch(METADATA_URL, { cache: 'no-store', headers: { Accept: 'application/json' } }),
            fetch(SIGNATURE_URL, { cache: 'no-store', headers: { Accept: 'text/plain' } })
        ]);
        if (!metadataResponse.ok || !signatureResponse.ok) {
            throw new Error(`RELEASE_METADATA_HTTP_${metadataResponse.status}_${signatureResponse.status}`);
        }
        const metadataText = await metadataResponse.text();
        const signature = (await signatureResponse.text()).trim();
        let metadata;
        try {
            metadata = JSON.parse(metadataText);
        } catch (error) {
            throw new Error('RELEASE_METADATA_INVALID_JSON', { cause: error });
        }
        if (!isExpectedMetadata(metadata) || !signature) {
            throw new Error('RELEASE_METADATA_INVALID');
        }
        return { metadata, metadataText, signature };
    }

    async function installLatestReleaseForTesting() {
        const release = await fetchReleaseMetadata();
        const { metadata } = release;
        const { state } = await readState();
        if (['installing', 'awaiting_confirmation', 'waiting_for_safe_moment'].includes(state.status)) {
            throw new Error('UPDATE_IN_PROGRESS');
        }

        const hostStatus = await getNativeStatus();
        if (hostStatus.configured !== true) {
            throw new Error('SETUP_REQUIRED');
        }
        if (['queued', 'downloading', 'replacing', 'awaiting_confirmation'].includes(hostStatus.operation?.status)) {
            throw new Error('UPDATE_IN_PROGRESS');
        }
        if (!(await isSafeToApply())) {
            throw new Error('UPDATE_NOT_SAFE');
        }

        const operationId = crypto.randomUUID();
        await writeState({
            status: 'installing',
            currentVersion: chrome.runtime.getManifest().version,
            availableVersion: metadata.version,
            operationId,
            metadata,
            metadataText: release.metadataText,
            signature: release.signature,
            deferredUntil: 0,
            errorCode: null,
            errorMessage: null
        });

        try {
            const response = await nativeMessage({
                action: 'test_apply',
                operationId,
                metadata,
                metadataText: release.metadataText,
                signature: release.signature
            });
            const nextState = await writeState({
                status: response.status || 'installing',
                operationId: response.operationId || operationId,
                errorCode: null,
                errorMessage: null
            });
            void pollNativeOperation(nextState.operationId);
            return nextState;
        } catch (error) {
            return writeState({
                status: 'failed',
                operationId,
                errorCode: 'TEST_APPLY_FAILED',
                errorMessage: error.message || 'TEST_APPLY_FAILED'
            });
        }
    }

    async function checkForUpdates(options = {}) {
        if (activeCheck) return activeCheck;
        activeCheck = (async () => {
            const { state, settings } = await readState();
            const currentVersion = chrome.runtime.getManifest().version;
            if (!options.force && state.nextCheckAt > now()) return state;

            try {
                const release = await fetchReleaseMetadata();
                const availableVersion = normalizeVersion(release.metadata.version);
                if (compareVersions(availableVersion, currentVersion) <= 0) {
                    return writeState({
                        status: 'up_to_date',
                        currentVersion,
                        availableVersion: null,
                        lastCheckedAt: now(),
                        nextCheckAt: now() + CHECK_INTERVAL_MINUTES * 60 * 1000,
                        errorCode: null,
                        errorMessage: null
                    });
                }

                const nextState = await writeState({
                    status: settings.autoUpdateEnabled ? 'available' : 'available_manual',
                    currentVersion,
                    availableVersion,
                    metadata: release.metadata,
                    metadataText: release.metadataText,
                    signature: release.signature,
                    lastCheckedAt: now(),
                    nextCheckAt: now() + CHECK_INTERVAL_MINUTES * 60 * 1000,
                    errorCode: null,
                    errorMessage: null
                });

                let hostReady = false;
                try {
                    const hostStatus = await getNativeStatus();
                    hostReady = hostStatus.configured === true;
                } catch {
                    hostReady = false;
                }
                if (!hostReady) {
                    return writeState({
                        status: 'setup_required',
                        errorCode: 'SETUP_REQUIRED',
                        errorMessage: 'Run MovieListSetup.exe once to connect automatic updates.'
                    });
                }

                if (settings.autoUpdateEnabled && !nextState.deferredUntil) {
                    return applyUpdate({ automatic: true });
                }
                return nextState;
            } catch (error) {
                return writeState({
                    status: state.availableVersion ? 'available' : 'check_failed',
                    lastCheckedAt: now(),
                    nextCheckAt: now() + RETRY_DELAY_MINUTES * 60 * 1000,
                    errorCode: 'CHECK_FAILED',
                    errorMessage: error.message || 'UPDATE_CHECK_FAILED'
                });
            } finally {
                activeCheck = null;
            }
        })();
        return activeCheck;
    }

    async function getNativeStatus() {
        try {
            const response = await nativeMessage({ action: 'status' });
            await writeState({ configured: response.configured === true });
            return response;
        } catch (error) {
            await writeState({ configured: false });
            throw error;
        }
    }

    async function isSafeToApply() {
        try {
            if (chrome.offscreen?.hasDocument && await chrome.offscreen.hasDocument()) {
                const radioState = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ type: 'RADIO_GET_STATE' }, (response) => {
                        resolve(chrome.runtime.lastError ? null : response);
                    });
                });
                if (radioState?.isPlaying === true) return false;
            }

            const tabs = await chrome.tabs.query({});
            if (!chrome.scripting?.executeScript) return false;
            const checks = await Promise.all(tabs
                .filter(tab => Number.isInteger(tab.id))
                .map(async (tab) => {
                    try {
                        const result = await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            func: () => Array.from(document.querySelectorAll('audio,video'))
                                .some(media => !media.paused && !media.ended)
                        });
                        return result?.[0]?.result !== true;
                    } catch {
                        // Chrome-internal pages cannot be inspected. An ordinary
                        // web page that cannot be inspected is treated as busy.
                        return !/^https?:/i.test(String(tab.url || ''));
                    }
                }));
            return checks.every(Boolean);
        } catch (error) {
            console.warn('[Update] Could not prove a safe install moment:', error);
            return false;
        }
    }

    async function syncNativeOperation({ reloadWhenReady = false } = {}) {
        const response = await getNativeStatus();
        const operation = response.operation;
        if (!operation?.operationId) return response;
        const { state } = await readState();
        if (state.operationId && state.operationId !== operation.operationId) return response;

        if (operation.status === 'failed') {
            await writeState({
                status: 'failed',
                operationId: operation.operationId,
                errorCode: operation.errorCode || 'EXECUTION_FAILED',
                errorMessage: operation.errorMessage || 'UPDATE_EXECUTION_FAILED'
            });
        } else if (operation.status === 'awaiting_confirmation') {
            await writeState({
                status: 'awaiting_confirmation',
                operationId: operation.operationId
            });
            if (reloadWhenReady) {
                setTimeout(() => chrome.runtime.reload(), 250);
            }
        } else if (operation.status === 'succeeded') {
            await writeState({ status: 'succeeded', operationId: operation.operationId });
        }
        return response;
    }

    async function applyUpdate(options = {}) {
        const { state, settings } = await readState();
        if (!state.metadata || !state.signature || !state.availableVersion) {
            return writeState({ status: 'idle', errorCode: 'NO_UPDATE_READY' });
        }
        if (!options.automatic && settings.autoUpdateEnabled === false) {
            // A manual click is still allowed when automatic installation is off.
        }
        if (state.status === 'installing' || state.status === 'awaiting_confirmation') return state;

        try {
            const hostStatus = await getNativeStatus();
            if (hostStatus.configured !== true) {
                return writeState({ status: 'setup_required', errorCode: 'SETUP_REQUIRED' });
            }
        } catch (error) {
            return writeState({ status: 'setup_required', errorCode: 'SETUP_REQUIRED', errorMessage: error.message });
        }

        if (!(await isSafeToApply())) {
            chrome.alarms.create(SAFE_RETRY_ALARM, { delayInMinutes: 10 });
            return writeState({
                status: 'waiting_for_safe_moment',
                nextCheckAt: now() + 10 * 60 * 1000,
                errorCode: null,
                errorMessage: null
            });
        }

        const operationId = crypto.randomUUID();
        await writeState({
            status: 'installing',
            operationId,
            errorCode: null,
            errorMessage: null
        });
        try {
            const response = await nativeMessage({
                action: 'apply',
                operationId,
                metadata: state.metadata,
                metadataText: state.metadataText,
                signature: state.signature
            });
            const nextState = await writeState({
                status: response.status || 'installing',
                operationId: response.operationId || operationId,
                errorCode: null,
                errorMessage: null
            });
            void pollNativeOperation(nextState.operationId);
            return nextState;
        } catch (error) {
            return writeState({
                status: 'failed',
                errorCode: 'APPLY_FAILED',
                errorMessage: error.message || 'UPDATE_APPLY_FAILED'
            });
        }
    }

    async function confirmInstalled(details) {
        const { state } = await readState();
        if (details?.reason !== 'update' && state.status !== 'awaiting_confirmation') return;
        if (!state.operationId || !state.availableVersion) return;
        const version = chrome.runtime.getManifest().version;
        if (compareVersions(version, state.availableVersion) !== 0) return;
        try {
            await nativeMessage({ action: 'confirm', operationId: state.operationId, version });
            await writeState({
                status: 'succeeded',
                currentVersion: version,
                availableVersion: null,
                metadata: null,
                metadataText: null,
                signature: null,
                errorCode: null,
                errorMessage: null
            });
        } catch (error) {
            await writeState({ status: 'awaiting_confirmation', errorCode: 'CONFIRM_FAILED', errorMessage: error.message });
        }
    }

    async function deferUpdate() {
        return writeState({
            status: 'deferred',
            deferredUntil: now() + 24 * 60 * 60 * 1000
        });
    }

    async function setAutoUpdateEnabled(enabled) {
        const settings = { autoUpdateEnabled: enabled === true };
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
        const { state } = await readState();
        if (settings.autoUpdateEnabled && state.availableVersion && !state.deferredUntil) {
            return applyUpdate({ automatic: true });
        }
        return state;
    }

    async function pollNativeOperation(operationId) {
        for (let attempt = 0; attempt < 30; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const { state } = await readState();
            if (state.operationId !== operationId || state.status === 'failed' || state.status === 'succeeded') return;
            try {
                await syncNativeOperation({ reloadWhenReady: true });
                const refreshed = await readState();
                if (refreshed.state.status === 'awaiting_confirmation') return;
            } catch (error) {
                await writeState({ status: 'installing', errorCode: 'STATUS_UNAVAILABLE', errorMessage: error.message });
            }
        }
    }

    function setupBackground() {
        if (alarmRegistered) return;
        alarmRegistered = true;
        chrome.alarms.create(CHECK_ALARM, { periodInMinutes: CHECK_INTERVAL_MINUTES });
        readState()
            .then(async () => {
                await confirmInstalled();
                const refreshed = await readState();
                return syncNativeOperation({
                    reloadWhenReady: ['installing', 'awaiting_confirmation'].includes(refreshed.state.status)
                });
            })
            .catch(() => {});
        checkForUpdates().catch(() => {});
    }

    async function handleAlarm(alarm) {
        if (![CHECK_ALARM, SAFE_RETRY_ALARM].includes(alarm?.name)) return;
        const { state } = await readState();
        if (state.deferredUntil && state.deferredUntil <= now()) {
            await writeState({ deferredUntil: 0 });
        }
        await syncNativeOperation({
            reloadWhenReady: ['installing', 'awaiting_confirmation'].includes(state.status)
        }).catch(() => {});
        await checkForUpdates({ force: alarm.name === SAFE_RETRY_ALARM });
    }

    global.UpdateService = {
        applyUpdate,
        checkForUpdates,
        confirmInstalled,
        deferUpdate,
        getNativeStatus,
        getState: readState,
        handleAlarm,
        setAutoUpdateEnabled,
        syncNativeOperation,
        setupBackground,
        installLatestReleaseForTesting,
        getSetupUrl: () => SETUP_URL
    };
}(globalThis));
