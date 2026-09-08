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
    const OPERATION_ALARM = 'checkUpdateOperation';
    const CHECK_INTERVAL_MINUTES = 360;
    const RETRY_DELAY_MINUTES = 30;
    const HOST_PROTOCOL_VERSION = 1;
    const MIN_SUPPORTED_UPDATER_VERSION = '1.1.1';
    const OPERATION_STATUSES = new Set([
        'installing',
        'queued',
        'downloading',
        'replacing'
    ]);

    let alarmRegistered = false;
    let activeCheck = null;
    let reloadScheduled = false;
    const DIAGNOSTIC_PREFIX = 'update_diagnostic_';

    function diagnostic(event, details = {}) {
        const record = { at: new Date().toISOString(), event, details };
        const key = DIAGNOSTIC_PREFIX + Date.now() + '_' + Math.random().toString(36).slice(2);
        void chrome.storage.local.set({ [key]: record }).then(async () => {
            const all = await chrome.storage.local.get(null);
            const keys = Object.keys(all).filter(item => item.startsWith(DIAGNOSTIC_PREFIX)).sort();
            if (keys.length > 500) await chrome.storage.local.remove(keys.slice(0, keys.length - 500));
        }).catch(() => {});
    }

    async function diagnosticFetch(url, label) {
        const controller = new AbortController();
        const started = Date.now();
        diagnostic('http_start', { label, host: new URL(url).hostname, online: global.navigator?.onLine });
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
            diagnostic('http_headers', { label, status: response.status, redirected: response.redirected,
                host: response.url ? new URL(response.url).hostname : null,
                contentType: response.headers?.get('content-type'), elapsedMs: Date.now() - started });
            const body = await response.text();
            diagnostic('http_complete', { label, status: response.status, characters: body.length,
                elapsedMs: Date.now() - started });
            return { ok: response.ok, status: response.status, text: async () => body };
        } catch (error) {
            diagnostic('http_failed', { label, type: error.name, timeout: controller.signal.aborted,
                elapsedMs: Date.now() - started });
            throw new Error(controller.signal.aborted ? `NETWORK_TIMEOUT_${label}` : `NETWORK_FAILED_${label}`, { cause: error });
        } finally {
            clearTimeout(timer);
        }
    }

    async function exportDiagnostics() {
        const all = await chrome.storage.local.get(null);
        const state = all[STATE_KEY] || {};
        return {
            exportedAt: new Date().toISOString(), version: chrome.runtime.getManifest().version,
            extensionId: chrome.runtime.id, userAgent: global.navigator?.userAgent,
            online: global.navigator?.onLine, language: global.navigator?.language,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            state: { status: state.status, currentVersion: state.currentVersion,
                availableVersion: state.availableVersion, operationId: state.operationId,
                configured: state.configured, updaterVersion: state.updaterVersion, errorCode: state.errorCode },
            events: Object.entries(all).filter(([key]) => key.startsWith(DIAGNOSTIC_PREFIX))
                .map(([, value]) => value).sort((a, b) => a.at.localeCompare(b.at))
        };
    }

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

    function isUpdaterCompatible(hostStatus, metadata) {
        const updaterVersion = normalizeVersion(hostStatus?.updaterVersion);
        const requiredVersion = normalizeVersion(metadata?.minUpdaterVersion)
            || MIN_SUPPORTED_UPDATER_VERSION;
        return Boolean(
            updaterVersion
            && compareVersions(updaterVersion, MIN_SUPPORTED_UPDATER_VERSION) >= 0
            && compareVersions(updaterVersion, requiredVersion) >= 0
        );
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
            requiresConfirmation: false,
            playbackReasons: [],
            configured: null,
            updaterVersion: null
        };
    }

    function defaultSettings() {
        return { autoUpdateEnabled: true };
    }

    function isOperationPending(state) {
        return OPERATION_STATUSES.has(state?.status);
    }

    function createOperationAlarm() {
        try {
            chrome.alarms.create(OPERATION_ALARM, { periodInMinutes: 1 });
        } catch {
            // The short-lived polling loop remains the immediate fallback.
        }
    }

    function clearOperationAlarm() {
        try {
            const result = chrome.alarms.clear?.(OPERATION_ALARM);
            result?.catch?.(() => {});
        } catch {
            // Alarm cleanup is best effort; the next tick will be harmless.
        }
    }

    function scheduleExtensionReload() {
        if (reloadScheduled || typeof chrome.runtime?.reload !== 'function') return;
        reloadScheduled = true;
        setTimeout(() => {
            try {
                chrome.runtime.reload();
            } catch (error) {
                reloadScheduled = false;
                console.warn('[Update] Could not activate the installed extension:', error);
            }
        }, 250);
    }

    async function closeExtensionPages() {
        if (typeof chrome.tabs?.query !== 'function' || typeof chrome.tabs?.remove !== 'function') {
            return 0;
        }

        let tabs;
        try {
            tabs = await chrome.tabs.query({});
        } catch {
            return 0;
        }

        const extensionOrigin = `chrome-extension://${chrome.runtime.id}/`;
        const extensionTabIds = (Array.isArray(tabs) ? tabs : [])
            .filter(tab => Number.isInteger(tab?.id) && String(tab.url || '').startsWith(extensionOrigin))
            .map(tab => tab.id);

        await Promise.all(extensionTabIds.map(async (tabId) => {
            try {
                await chrome.tabs.remove(tabId);
            } catch {
                // The tab may already have been closed by the user.
            }
        }));

        // Chrome releases extension-page file handles asynchronously. The native
        // host moves the whole unpacked directory, so let those handles drain.
        if (extensionTabIds.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        return extensionTabIds.length;
    }

    async function readState() {
        const result = await chrome.storage.local.get([STATE_KEY, SETTINGS_KEY]);
        return {
            state: { ...defaultState(), ...(result[STATE_KEY] || {}) },
            settings: { ...defaultSettings(), ...(result[SETTINGS_KEY] || {}) }
        };
    }

    async function writeState(patch) {
        if (patch.status) diagnostic('state', { status: patch.status, errorCode: patch.errorCode,
            operationId: patch.operationId, availableVersion: patch.availableVersion });
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
            const started = Date.now();
            diagnostic('native_start', { action: message.action });
            const timer = setTimeout(() => {
                diagnostic('native_timeout', { action: message.action, elapsedMs: Date.now() - started });
                reject(new Error('NATIVE_HOST_TIMEOUT'));
            }, 20000);
            if (!chrome.runtime.sendNativeMessage) {
                clearTimeout(timer);
                reject(new Error('NATIVE_MESSAGING_UNAVAILABLE'));
                return;
            }

            chrome.runtime.sendNativeMessage(HOST_NAME, {
                protocolVersion: HOST_PROTOCOL_VERSION,
                extensionId: chrome.runtime.id,
                ...message
            }, (response) => {
                clearTimeout(timer);
                diagnostic('native_response', { action: message.action, elapsedMs: Date.now() - started,
                    success: response?.success, configured: response?.configured,
                    updaterVersion: response?.updaterVersion, status: response?.operation?.status,
                    errorCode: response?.errorCode || response?.operation?.errorCode,
                    transportError: Boolean(chrome.runtime.lastError) });
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
        const minUpdaterVersion = normalizeVersion(metadata?.minUpdaterVersion);
        return Boolean(
            version
            && minUpdaterVersion
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
            diagnosticFetch(METADATA_URL, 'metadata'),
            diagnosticFetch(SIGNATURE_URL, 'signature')
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

    async function checkForUpdates(options = {}) {
        if (activeCheck) return activeCheck;
        activeCheck = (async () => {
            let state = null;
            try {
                const snapshot = await readState();
                state = snapshot.state;
                const { settings } = snapshot;
                if (isOperationPending(state) || state.status === 'awaiting_confirmation') return state;
                const currentVersion = chrome.runtime.getManifest().version;
                if (!options.force && state.nextCheckAt > now()) return state;

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
                        errorMessage: null,
                        requiresConfirmation: false,
                        playbackReasons: []
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
                    errorMessage: null,
                    requiresConfirmation: false,
                    playbackReasons: []
                });

                let hostReady = false;
                let hostVersionReady = false;
                try {
                    const hostStatus = await getNativeStatus();
                    hostReady = hostStatus.configured === true;
                    hostVersionReady = hostReady && isUpdaterCompatible(hostStatus, release.metadata);
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
                if (!hostVersionReady) {
                    return writeState({
                        status: 'setup_required',
                        errorCode: 'UPDATER_UPGRADE_REQUIRED',
                        errorMessage: 'Run the latest MovieListSetup.exe once to upgrade automatic updates.'
                    });
                }

                if (settings.autoUpdateEnabled && !nextState.deferredUntil && options.interactive !== true) {
                    return applyUpdate({ automatic: options.interactive !== true });
                }
                return nextState;
            } catch (error) {
                return writeState({
                    status: state?.availableVersion ? 'available' : 'check_failed',
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

    async function checkAndInstallLatestRelease() {
        const state = await checkForUpdates({ force: true, interactive: true });
        if (['available', 'available_manual', 'deferred'].includes(state.status)) {
            return applyUpdate({ automatic: false });
        }
        return state;
    }

    async function getNativeStatus() {
        try {
            const response = await nativeMessage({ action: 'status' });
            await writeState({
                configured: response.configured === true,
                updaterVersion: response.updaterVersion || null
            });
            return response;
        } catch (error) {
            await writeState({ configured: false, updaterVersion: null });
            throw error;
        }
    }

    async function inspectPlaybackSafety() {
        const playbackReasons = [];

        try {
            if (chrome.offscreen?.hasDocument && await chrome.offscreen.hasDocument()) {
                const radioState = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ type: 'RADIO_GET_STATE' }, (response) => {
                        resolve(chrome.runtime.lastError ? null : response);
                    });
                });
                if (radioState?.isPlaying === true) playbackReasons.push('radio_playing');
            }

            const tabs = await chrome.tabs.query({});
            if (!chrome.scripting?.executeScript) {
                return { safe: playbackReasons.length === 0, playbackReasons };
            }

            await Promise.all(tabs
                .filter(tab => Number.isInteger(tab.id))
                .map(async (tab) => {
                    try {
                        const result = await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            func: () => Array.from(document.querySelectorAll('audio,video'))
                                .some(media => !media.paused && !media.ended)
                        });
                        if (result?.[0]?.result === true) playbackReasons.push('tab_media');
                    } catch {
                        // A missing host permission means that the tab cannot be
                        // inspected, not that it is playing media. Only a positive
                        // media signal should block a manual update.
                    }
                }));
            return { safe: playbackReasons.length === 0, playbackReasons };
        } catch (error) {
            console.warn('[Update] Could not prove a safe install moment:', error);
            return { safe: playbackReasons.length === 0, playbackReasons };
        }
    }

    async function syncNativeOperation() {
        const response = await getNativeStatus();
        const operation = response.operation;
        if (!operation?.operationId) return response;
        const { state } = await readState();
        if (state.operationId && state.operationId !== operation.operationId) return response;

        if (operation.status === 'failed') {
            clearOperationAlarm();
            await writeState({
                status: 'failed',
                operationId: operation.operationId,
                errorCode: operation.errorCode || 'EXECUTION_FAILED',
                errorMessage: operation.errorMessage || 'UPDATE_EXECUTION_FAILED'
            });
        } else if (operation.status === 'recovery_required') {
            clearOperationAlarm();
            await writeState({
                status: 'failed',
                operationId: operation.operationId,
                errorCode: operation.errorCode || 'RECOVERY_REQUIRED',
                errorMessage: operation.errorMessage || 'UPDATE_RECOVERY_REQUIRED'
            });
        } else if (operation.status === 'awaiting_confirmation') {
            createOperationAlarm();
            await writeState({
                status: 'awaiting_confirmation',
                operationId: operation.operationId,
                availableVersion: operation.version || state.availableVersion
            });
            const targetVersion = operation.version || state.availableVersion;
            if (targetVersion === chrome.runtime.getManifest().version) {
                await confirmInstalled();
            } else {
                scheduleExtensionReload();
            }
        } else if (operation.status === 'succeeded') {
            clearOperationAlarm();
            await writeState({ status: 'succeeded', operationId: operation.operationId });
        } else if (isOperationPending(operation)) {
            createOperationAlarm();
        }
        return response;
    }

    async function applyUpdate({ automatic = false, allowPlayback = false } = {}) {
        const { state } = await readState();
        if (!state.metadata || !state.signature || !state.availableVersion) {
            return writeState({ status: 'idle', errorCode: 'NO_UPDATE_READY' });
        }
        if (isOperationPending(state) || state.status === 'awaiting_confirmation') {
            return state;
        }

        try {
            const hostStatus = await getNativeStatus();
            if (hostStatus.configured !== true) {
                return writeState({ status: 'setup_required', errorCode: 'SETUP_REQUIRED' });
            }
            if (!isUpdaterCompatible(hostStatus, state.metadata)) {
                return writeState({
                    status: 'setup_required',
                    errorCode: 'UPDATER_UPGRADE_REQUIRED',
                    errorMessage: 'Run the latest MovieListSetup.exe once to upgrade automatic updates.'
                });
            }
            if (hostStatus.operation?.status === 'recovery_required') {
                return writeState({
                    status: 'failed',
                    operationId: hostStatus.operation.operationId || null,
                    errorCode: hostStatus.operation.errorCode || 'RECOVERY_REQUIRED',
                    errorMessage: hostStatus.operation.errorMessage || 'UPDATE_RECOVERY_REQUIRED'
                });
            }
            if (isOperationPending(hostStatus.operation)) {
                createOperationAlarm();
                return writeState({
                    status: 'installing',
                    operationId: hostStatus.operation.operationId || null,
                    errorCode: null,
                    errorMessage: null
                });
            }
        } catch (error) {
            return writeState({ status: 'setup_required', errorCode: 'SETUP_REQUIRED', errorMessage: error.message });
        }

        const playbackCheck = await inspectPlaybackSafety();
        if (!playbackCheck.safe && !allowPlayback) {
            chrome.alarms.create(SAFE_RETRY_ALARM, { delayInMinutes: 10 });
            return writeState({
                status: 'waiting_for_safe_moment',
                nextCheckAt: now() + 10 * 60 * 1000,
                errorCode: null,
                errorMessage: null,
                requiresConfirmation: !automatic,
                playbackReasons: playbackCheck.playbackReasons
            });
        }

        const operationId = crypto.randomUUID();
        await writeState({
            status: 'installing',
            operationId,
            errorCode: null,
            errorMessage: null,
            requiresConfirmation: false,
            playbackReasons: []
        });
        createOperationAlarm();
        try {
            await closeExtensionPages();
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
            // Reload only after the host has finished replacing files. Reloading
            // while queued restarts the old version and interrupts this observer.
            void pollNativeOperation(nextState.operationId);
            return nextState;
        } catch (error) {
            clearOperationAlarm();
            if (error?.message === 'UPDATE_IN_PROGRESS') {
                const response = await syncNativeOperation().catch(() => null);
                if (response?.operation?.operationId) {
                    return writeState({
                        status: 'installing',
                        operationId: response.operation.operationId,
                        errorCode: null,
                        errorMessage: null
                    });
                }
            }
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
            clearOperationAlarm();
            await writeState({
                status: 'succeeded',
                currentVersion: version,
                availableVersion: null,
                metadata: null,
                metadataText: null,
                signature: null,
                errorCode: null,
                errorMessage: null,
                requiresConfirmation: false,
                playbackReasons: []
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

    async function getState() {
        const snapshot = await readState();
        if (isOperationPending(snapshot.state) || snapshot.state.status === 'awaiting_confirmation') {
            try {
                await syncNativeOperation();
            } catch {
                // The caller still receives the persisted state and can retry.
            }
        }
        return readState();
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
                await syncNativeOperation();
                const refreshed = await readState();
                if (refreshed.state.status === 'awaiting_confirmation') return;
            } catch (error) {
                await writeState({ status: 'installing', errorCode: 'STATUS_UNAVAILABLE', errorMessage: error.message });
            }
        }
        createOperationAlarm();
    }

    function setupBackground() {
        if (alarmRegistered) return;
        alarmRegistered = true;
        chrome.alarms.create(CHECK_ALARM, { periodInMinutes: CHECK_INTERVAL_MINUTES });
        (async () => {
            await confirmInstalled();
            await syncNativeOperation().catch(() => {});
            const afterSync = await readState();
            if (isOperationPending(afterSync.state) || afterSync.state.status === 'awaiting_confirmation') return;
            await checkForUpdates();
        })().catch(() => {});
    }

    async function handleAlarm(alarm) {
        if (![CHECK_ALARM, SAFE_RETRY_ALARM, OPERATION_ALARM].includes(alarm?.name)) return;
        const { state } = await readState();
        if (state.deferredUntil && state.deferredUntil <= now()) {
            await writeState({ deferredUntil: 0 });
        }
        await syncNativeOperation().catch(() => {});
        await confirmInstalled();
        const refreshed = await readState();
        if (isOperationPending(refreshed.state) || refreshed.state.status === 'awaiting_confirmation') return;
        if (alarm.name === OPERATION_ALARM) {
            clearOperationAlarm();
            return;
        }
        await checkForUpdates({ force: alarm.name === SAFE_RETRY_ALARM });
    }

    global.UpdateService = {
        exportDiagnostics,
        applyUpdate,
        checkForUpdates,
        confirmInstalled,
        deferUpdate,
        getNativeStatus,
        getState,
        handleAlarm,
        setAutoUpdateEnabled,
        syncNativeOperation,
        setupBackground,
        checkAndInstallLatestRelease,
        getSetupUrl: () => SETUP_URL
    };
}(globalThis));
