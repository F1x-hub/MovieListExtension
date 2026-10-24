/*
 * Signed multi-source ZIP updater coordinator.
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
    const COMPONENTS_URL = 'https://github.com/F1x-hub/MovieListExtension/releases/latest/download/components.json';
    const COMPONENTS_SIGNATURE_URL = COMPONENTS_URL + '.sig';
    const COMPONENT_IDS = ['updater', 'mediaPlayerSuite'];
    const MIRROR_ROOT = 'https://movielistdb-13208-updates.web.app/updates/latest/';
    const SETUP_URL = 'https://github.com/F1x-hub/MovieListExtension/releases/latest/download/MovieListSetup.exe';
    const FIREBASE_ASSET_URL = MIRROR_ROOT + 'MovieList-extension-latest.zip';
    const MAX_HTTP_ATTEMPTS = 3;
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
    let activeCheckDidFetch = false;
    let reloadScheduled = false;
    const DIAGNOSTIC_PREFIX = 'update_diagnostic_';
    const MEDIA_PLAYER_PORT_KEY = 'mediaPlayerServicePort';
    const RELOAD_MISMATCH_CODE = 'RELOAD_VERSION_MISMATCH';

    function diagnostic(event, details = {}) {
        const record = { at: new Date().toISOString(), event, details };
        const key = DIAGNOSTIC_PREFIX + Date.now() + '_' + Math.random().toString(36).slice(2);
        void chrome.storage.local.set({ [key]: record }).then(async () => {
            const all = await chrome.storage.local.get(null);
            const keys = Object.keys(all).filter(item => item.startsWith(DIAGNOSTIC_PREFIX)).sort();
            if (keys.length > 500) await chrome.storage.local.remove(keys.slice(0, keys.length - 500));
        }).catch(() => {});
    }

    async function diagnosticFetch(url, label, attempt = 1) {
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
            const retryableStatus = response.status === 408 || response.status === 429 || response.status >= 500;
            if (retryableStatus && attempt < MAX_HTTP_ATTEMPTS) {
                diagnostic('http_retry', { label, attempt, status: response.status });
                clearTimeout(timer);
                await new Promise(resolve => setTimeout(resolve, 1500));
                return diagnosticFetch(url, label, attempt + 1);
            }
            return { ok: response.ok, status: response.status, text: async () => body };
        } catch (error) {
            diagnostic('http_failed', { label, type: error.name, timeout: controller.signal.aborted,
                elapsedMs: Date.now() - started });
            if (attempt < MAX_HTTP_ATTEMPTS && global.navigator?.onLine !== false) {
                diagnostic('http_retry', { label, attempt, timeout: controller.signal.aborted });
                clearTimeout(timer);
                await new Promise(resolve => setTimeout(resolve, 1500));
                return diagnosticFetch(url, label, attempt + 1);
            }
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
                configured: state.configured, updaterVersion: state.updaterVersion, errorCode: state.errorCode,
                requiresConfirmation: state.requiresConfirmation,
                playbackReasons: Array.isArray(state.playbackReasons) ? state.playbackReasons : [] },
            events: Object.entries(all).filter(([key]) => key.startsWith(DIAGNOSTIC_PREFIX))
                .map(([, value]) => value).sort((a, b) => a.at.localeCompare(b.at))
        };
    }

    function now() {
        return Date.now();
    }

    function normalizeVersion(version) {
        const value = String(version || '').trim().replace(/^v/i, '');
        if (!/^\d+(?:\.\d+){2,3}$/.test(value)) return null;
        return value;
    }

    function compareVersions(first, second) {
        const left = String(first || '').split('.').map(Number);
        const right = String(second || '').split('.').map(Number);
        for (let index = 0; index < 4; index += 1) {
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
            updaterVersion: null,
            components: {},
            componentCatalogStatus: 'unknown',
            componentCapabilities: null,
            componentInventory: null
        };
    }

    function defaultSettings() {
        // The extension decides when components update; the hub applies them.
        // Suite updates still run only through the maintenance broker, never
        // through a surprise Windows elevation prompt.
        return { autoUpdateEnabled: true, componentAutoUpdateEnabled: { updater: true, mediaPlayerSuite: true } };
    }

    async function updateSettings(change) {
        // Settings pages and the service worker share storage, but have separate
        // service instances. Re-read inside an origin-wide lock before merging.
        if (typeof global.navigator?.locks?.request !== 'function') {
            throw new Error('UPDATE_SETTINGS_LOCK_UNAVAILABLE');
        }
        return global.navigator.locks.request(SETTINGS_KEY, async () => {
            const { settings } = await readState();
            const next = change(settings);
            await chrome.storage.local.set({ [SETTINGS_KEY]: next });
            return next;
        });
    }

    function isOperationPending(state) {
        return OPERATION_STATUSES.has(state?.status);
    }

    function isComponentOperationPending(state) {
        return Object.values(state?.components || {}).some(item =>
            ['queued', 'downloading', 'replacing', 'installing', 'verifying'].includes(item?.status));
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
            settings: { ...defaultSettings(), ...(result[SETTINGS_KEY] || {}), componentAutoUpdateEnabled: {
                ...defaultSettings().componentAutoUpdateEnabled, ...result[SETTINGS_KEY]?.componentAutoUpdateEnabled } }
        };
    }

    async function writeState(patch) {
        if (patch.status) diagnostic('state', { status: patch.status, errorCode: patch.errorCode,
            operationId: patch.operationId, availableVersion: patch.availableVersion,
            requiresConfirmation: patch.requiresConfirmation,
            playbackReasons: Array.isArray(patch.playbackReasons) ? patch.playbackReasons : undefined });
        // The service worker and settings pages run separate UpdateService
        // instances; an unlocked read-merge-write lost concurrent patches.
        const merge = async () => {
            const { state } = await readState();
            const merged = { ...state, ...patch };
            await chrome.storage.local.set({ [STATE_KEY]: merged });
            return merged;
        };
        const next = typeof global.navigator?.locks?.request === 'function'
            ? await global.navigator.locks.request(STATE_KEY, merge)
            : await merge();
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

    // Tells the host to close a journal waiting for a reload that loaded another
    // folder; otherwise the host keeps it active and rejects every later update.
    async function abandonOperation(operationId) {
        try {
            await nativeMessage({ action: 'abandon', operationId, reason: RELOAD_MISMATCH_CODE });
        } catch (error) {
            diagnostic('abandon_failed', { errorCode: error?.message });
        }
    }

    function isExpectedMetadata(metadata) {
        const version = normalizeVersion(metadata?.version);
        const extensionId = String(metadata?.extensionId || '');
        const assetName = String(metadata?.assetName || '');
        const assetUrl = String(metadata?.assetUrl || '');
        const assetUrls = Array.isArray(metadata?.assetUrls) && metadata.assetUrls.length
            ? metadata.assetUrls
            : [assetUrl];
        const minUpdaterVersion = normalizeVersion(metadata?.minUpdaterVersion);
        return Boolean(
            version
            && minUpdaterVersion
            && extensionId === chrome.runtime.id
            && /^[A-Za-z0-9._-]+\.zip$/.test(assetName)
            && /^https:\/\/github\.com\/F1x-hub\/MovieListExtension\/releases\/download\//.test(assetUrl)
            && assetUrls.length <= 3
            && assetUrls.includes(assetUrl)
            && assetUrls.every((url) => (
                /^https:\/\/github\.com\/F1x-hub\/MovieListExtension\/releases\/download\//.test(String(url))
                || String(url) === FIREBASE_ASSET_URL
            ))
            && /^[a-f0-9]{64}$/i.test(String(metadata?.sha256 || ''))
            && Number.isSafeInteger(Number(metadata?.size))
            && Number(metadata.size) > 0
        );
    }

    async function fetchReleaseMetadata() {
        let lastError;
        for (const [metadataUrl, signatureUrl] of [
            [METADATA_URL, SIGNATURE_URL],
            [MIRROR_ROOT + 'update.json', MIRROR_ROOT + 'update.json.sig']
        ]) {
            try {
                return await fetchMetadataPair(metadataUrl, signatureUrl);
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError;
    }

    async function fetchMetadataPair(metadataUrl, signatureUrl) {
        const results = await Promise.allSettled([
            diagnosticFetch(metadataUrl, 'metadata'),
            diagnosticFetch(signatureUrl, 'signature')
        ]);
        const failed = results.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
        const [metadataResponse, signatureResponse] = results.map(result => result.value);
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
        if (activeCheck) {
            const inFlightCheck = activeCheck;
            const sharedState = await inFlightCheck;
            // A manual request may arrive while the scheduled check is already
            // fetching metadata. Preserve the caller's intent: a silent
            // automatic wait must be upgraded to a confirmation-required state.
            if (options.interactive === true
                && sharedState?.status === 'waiting_for_safe_moment'
                && sharedState.requiresConfirmation !== true) {
                return applyUpdate({ automatic: false });
            }
            // A forced/manual request may have joined a background check that
            // returned only because its persisted nextCheckAt is still future.
            // Re-run that request once the shared promise is released instead
            // of silently returning the throttled state to the caller.
            if ((options.force === true || options.interactive === true)
                && activeCheckDidFetch !== true
                && !isOperationPending(sharedState)
                && sharedState?.status !== 'awaiting_confirmation') {
                return checkForUpdates(options);
            }
            return sharedState;
        }
        activeCheckDidFetch = false;
        activeCheck = (async () => {
            try {
                const snapshot = await readState();
                const state = snapshot.state;
                const { settings } = snapshot;
                if (isOperationPending(state) || state.status === 'awaiting_confirmation') return state;
                const currentVersion = chrome.runtime.getManifest().version;
                if (!options.force && state.nextCheckAt > now()) return state;

                activeCheckDidFetch = true;
                // Independent inventory/catalog reconciliation must run even when
                // the legacy extension feed reports the current extension version.
                await checkComponentUpdates({ force: true, interactive: options.interactive === true });
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
                    if (isComponentOperationPending((await readState()).state)) return (await readState()).state;
                    return applyUpdate({ automatic: options.interactive !== true });
                }
                return nextState;
            } catch (error) {
                return writeState({
                    status: 'check_failed',
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
                updaterVersion: response.updaterVersion || null,
                componentCapabilities: response.componentCapabilities || null,
                componentInventory: response.components || null,
                hostAvailability: 'available',
                hostCheckedAt: now()
            });
            await syncMediaPlayerPort(response.components?.mediaPlayerSuite?.port);
            return response;
        } catch (error) {
            await writeState({ configured: false, updaterVersion: null,
                hostAvailability: classifyHostError(error), hostCheckedAt: now() });
            throw error;
        }
    }

    // Chrome's own error texts distinguish a host that was never registered
    // (or registered for another extension ID) from a transient failure; only
    // the former should ask the user to install MovieList Hub.
    function classifyHostError(error) {
        const message = String(error?.message || '');
        if (/native messaging host not found/i.test(message)) return 'missing';
        if (/access to the specified native messaging host is forbidden/i.test(message)) return 'forbidden';
        if (/native host has exited/i.test(message)) return 'not_configured';
        return 'unavailable';
    }

    // MediaPlayerService reads this when it was not given an explicit URL, so a
    // Suite configured with another PORT is still reached.
    async function syncMediaPlayerPort(port) {
        if (!Number.isInteger(port) || port < 1 || port > 65535) return;
        const stored = await chrome.storage.local.get([MEDIA_PLAYER_PORT_KEY]);
        if (stored[MEDIA_PLAYER_PORT_KEY] !== port) await chrome.storage.local.set({ [MEDIA_PLAYER_PORT_KEY]: port });
    }

    async function inspectPlaybackSafety() {
        const playbackReasons = [];

        try {
            if (chrome.offscreen?.hasDocument && await chrome.offscreen.hasDocument()) {
                const radioState = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ type: 'RADIO_GET_STATE', target: 'offscreen-radio' }, (response) => {
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
                        if (String(tab.url || '').startsWith(`chrome-extension://${chrome.runtime.id}/`)
                            && typeof chrome.tabs.sendMessage === 'function') {
                            const response = await new Promise((resolve) => {
                                chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_QUERY_PLAYBACK' }, (result) => {
                                    resolve(chrome.runtime.lastError ? null : result);
                                });
                            });
                            if (response?.isPlaying === true) playbackReasons.push('extension_page_media');
                            return;
                        }
                        const inspectMedia = () => Array.from(document.querySelectorAll('audio,video'))
                            .some(media => {
                                // Pages often keep an empty media element mounted while
                                // their player is closed. It is playback only when the
                                // element has a source, metadata, and is actively running.
                                const source = media.currentSrc || media.src || media.srcObject
                                    || media.querySelector('source[src]')?.src;
                                return Boolean(source)
                                    && media.readyState >= HTMLMediaElement.HAVE_METADATA
                                    && !media.paused
                                    && !media.ended
                                    && !media.error;
                            });
                        let result;
                        try {
                            result = await chrome.scripting.executeScript({
                                target: { tabId: tab.id, allFrames: true },
                                func: inspectMedia
                            });
                        } catch {
                            // A cross-origin frame without host permission can make
                            // an all-frames injection fail as a whole. Recheck the
                            // top frame so an accessible player still blocks updates.
                            result = await chrome.scripting.executeScript({
                                target: { tabId: tab.id },
                                func: inspectMedia
                            });
                        }
                        if (result?.some(frame => frame?.result === true)) playbackReasons.push('tab_media');
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
        await syncComponentOperation(response);
        const operation = response.operation;
        if (!operation?.operationId) return response;
        // A completed legacy extension journal must not cancel polling for a
        // concurrently running component worker.
        if (isComponentOperationPending((await readState()).state)
            && !isOperationPending(operation) && operation.status !== 'awaiting_confirmation') return response;
        const { state } = await readState();
        if (state.operationId && state.operationId !== operation.operationId) return response;
        if (state.status === 'failed' && state.errorCode === RELOAD_MISMATCH_CODE
            && state.operationId === operation.operationId) {
            clearOperationAlarm();
            return response;
        }

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
            } else if (state.reloadOperationId === operation.operationId) {
                // Already reloaded once for this operation and Chrome still runs
                // the old version: the host replaced a different folder than the
                // one Chrome loaded. Reloading again would loop forever.
                clearOperationAlarm();
                await abandonOperation(operation.operationId);
                await writeState({
                    status: 'failed',
                    operationId: operation.operationId,
                    errorCode: RELOAD_MISMATCH_CODE,
                    errorMessage: 'Chrome still runs the old version after reload. Open MovieList Hub and select the folder loaded in Chrome.'
                });
            } else {
                await writeState({ reloadOperationId: operation.operationId });
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
            if (hostStatus.operation?.status === 'awaiting_confirmation'
                && state.reloadOperationId === hostStatus.operation.operationId
                && hostStatus.operation.version !== chrome.runtime.getManifest().version) {
                await abandonOperation(hostStatus.operation.operationId);
                return writeState({
                    status: 'failed',
                    operationId: hostStatus.operation.operationId,
                    errorCode: RELOAD_MISMATCH_CODE,
                    errorMessage: 'Chrome still runs the old version after reload. Open MovieList Hub and select the folder loaded in Chrome.'
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
                // Adopt only a host operation that is really in flight. A finished
                // journal from an earlier update would otherwise be reported as
                // "installing" and then "succeeded" although nothing was installed.
                const hostOperation = response?.operation;
                if (hostOperation?.operationId
                    && (isOperationPending(hostOperation) || hostOperation.status === 'awaiting_confirmation')) {
                    return writeState({
                        status: 'installing',
                        operationId: hostOperation.operationId,
                        errorCode: null,
                        errorMessage: null
                    });
                }
            }
            return writeState({
                status: 'failed',
                errorCode: error?.message === 'UPDATE_IN_PROGRESS' ? 'UPDATE_BLOCKED' : 'APPLY_FAILED',
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
        if (isOperationPending(snapshot.state) || snapshot.state.status === 'awaiting_confirmation'
            || isComponentOperationPending(snapshot.state)) {
            try {
                await syncNativeOperation();
            } catch {
                // The caller still receives the persisted state and can retry.
            }
        }
        return readState();
    }

    async function setAutoUpdateEnabled(enabled) {
        const settings = await updateSettings(current => ({ ...current, autoUpdateEnabled: enabled === true }));
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

    function isExpectedComponentCatalog(catalog) {
        if (catalog?.schemaVersion !== 1 || catalog.productId !== 'movielist' || catalog.channel !== 'stable'
            || !Number.isFinite(Date.parse(catalog.publishedAt)) || !catalog.components
            || Array.isArray(catalog.components) || typeof catalog.components !== 'object') return false;
        const entries = Object.entries(catalog.components);
        if (!entries.length || entries.some(([id]) => !['extension', ...COMPONENT_IDS].includes(id))) return false;
        return entries.every(([id, descriptor]) => {
            if (!descriptor || typeof descriptor !== 'object') return false;
            const version = normalizeVersion(descriptor.version);
            const name = id === 'extension' ? `MovieList-extension-${version}.zip`
                : id === 'updater' ? 'MovieListSetup.exe' : 'MediaPlayerSuiteSetup.exe';
            const prefix = 'https://github.com/F1x-hub/MovieListExtension/releases/download/';
            const suffix = typeof descriptor.assetUrl === 'string' && descriptor.assetUrl.startsWith(prefix)
                ? descriptor.assetUrl.slice(prefix.length) : '';
            const slash = suffix.indexOf('/');
            return version && descriptor.version === version && descriptor.assetName === name
                && suffix[0] === 'v' && normalizeVersion(suffix.slice(1, slash)) === suffix.slice(1, slash)
                && slash > 1 && suffix.slice(slash + 1) === name
                && /^[a-f0-9]{64}$/i.test(descriptor.sha256)
                && Number.isSafeInteger(descriptor.size) && descriptor.size > 0 && descriptor.size <= 1024 ** 3
                && (descriptor.minUpdaterVersion === undefined
                    || normalizeVersion(descriptor.minUpdaterVersion) === descriptor.minUpdaterVersion)
                && (descriptor.apiMajor === undefined || (id === 'mediaPlayerSuite'
                    && Number.isInteger(descriptor.apiMajor) && descriptor.apiMajor >= 1 && descriptor.apiMajor <= 100))
                && (descriptor.buildId === undefined || (id === 'mediaPlayerSuite'
                    && /^[A-Za-z0-9._-]{1,128}$/.test(descriptor.buildId)));
        });
    }

    async function writeComponent(componentId, patch) {
        const { state } = await readState();
        return writeState({ components: { ...state.components,
            [componentId]: { ...state.components?.[componentId], componentId, ...patch } } });
    }

    async function syncComponentOperation(response) {
        const operation = response.componentOperation;
        if (!COMPONENT_IDS.includes(operation?.componentId) || !operation.operationId) return;
        // A dismissed journal leaves the status to the next inventory check.
        if (operation.status === 'dismissed') return;
        const { state } = await readState();
        const previous = state.components?.[operation.componentId];
        if (previous?.operationId && previous.operationId !== operation.operationId
            && ['queued', 'downloading', 'replacing', 'installing', 'verifying'].includes(previous.status)) return;
        const inventory = response.components?.[operation.componentId];
        const deferred = operation.status === 'failed' && operation.errorCode === 'SUITE_BROKER_DEFERRED';
        await writeComponent(operation.componentId, {
            status: deferred ? 'waiting_for_safe_moment' : operation.status === 'recovery_required' ? 'failed' : operation.status,
            operationId: operation.operationId,
            availableVersion: operation.status === 'succeeded' ? null : operation.version,
            currentVersion: inventory?.version || previous?.currentVersion || null,
            installed: inventory?.installed,
            errorCode: operation.errorCode || null
        });
        if (['queued', 'downloading', 'replacing', 'installing', 'verifying'].includes(operation.status)) createOperationAlarm();
        if (deferred) chrome.alarms.create(SAFE_RETRY_ALARM, { delayInMinutes: 10 });
    }

    async function checkComponentUpdates({ force = false, interactive = false } = {}) {
        const snapshot = await readState();
        if (!force && snapshot.state.componentNextCheckAt > now()) return snapshot.state;
        try {
            const host = await getNativeStatus();
            await syncComponentOperation(host);
            if (host.componentCapabilities?.protocolVersion !== 1 || host.componentCapabilities.signedCatalog !== true) {
                for (const id of COMPONENT_IDS) await writeComponent(id, {
                    status: 'setup_required', currentVersion: id === 'updater' ? host.updaterVersion || null : null,
                    errorCode: 'UPDATER_COMPONENT_SETUP_REQUIRED'
                });
                return writeState({ componentCatalogStatus: 'setup_required' });
            }
            const response = await diagnosticFetch(COMPONENTS_URL, 'component_catalog');
            if (response.status === 404) return writeState({ componentCatalogStatus: 'legacy', componentCatalog: null });
            if (!response.ok) throw new Error('COMPONENT_CATALOG_HTTP_FAILED');
            const text = await response.text();
            if (text.length > 128 * 1024) throw new Error('COMPONENT_CATALOG_TOO_LARGE');
            const signatureResponse = await diagnosticFetch(COMPONENTS_SIGNATURE_URL, 'component_signature');
            if (!signatureResponse.ok) throw new Error('COMPONENT_SIGNATURE_HTTP_FAILED');
            const signature = (await signatureResponse.text()).trim();
            if (!signature || signature.length > 4096) throw new Error('COMPONENT_SIGNATURE_INVALID');
            const catalog = JSON.parse(text);
            if (!isExpectedComponentCatalog(catalog)) throw new Error('COMPONENT_CATALOG_INVALID');
            await nativeMessage({ action: 'validate_component_catalog', metadataText: text, signature });
            await writeState({ componentCatalogStatus: 'available', componentNextCheckAt: now() + CHECK_INTERVAL_MINUTES * 60000,
                componentCatalog: { metadataText: text, signature, metadata: catalog, verified: true } });
            for (const id of COMPONENT_IDS) {
                const inventory = host.components?.[id];
                const descriptor = catalog.components[id];
                const latest = (await readState()).state.components?.[id];
                if (host.componentOperation?.componentId === id && host.componentOperation.status === 'recovery_required') continue;
                if (['queued', 'downloading', 'replacing', 'installing', 'verifying'].includes(latest?.status)) continue;
                const current = normalizeVersion(inventory?.version || (id === 'updater' ? host.updaterVersion : null));
                let status = 'up_to_date';
                let errorCode = null;
                if (id === 'mediaPlayerSuite' && inventory?.installed === false) status = 'absent';
                else if (!inventory || inventory.installed !== true) { status = 'setup_required'; errorCode = 'COMPONENT_INVENTORY_UNAVAILABLE'; }
                else if (id === 'mediaPlayerSuite' && inventory.layoutValid === false) { status = 'failed'; errorCode = 'SUITE_INSTALLATION_INVALID'; }
                else if (!current) { status = 'migration_required'; errorCode = 'SUITE_MIGRATION_REQUIRED'; }
                else if (descriptor && compareVersions(descriptor.version, current) > 0) {
                    status = snapshot.settings.componentAutoUpdateEnabled?.[id] === true ? 'available' : 'available_manual';
                    if (descriptor.minUpdaterVersion && compareVersions(host.updaterVersion, descriptor.minUpdaterVersion) < 0) {
                        status = 'setup_required'; errorCode = 'UPDATER_UPGRADE_REQUIRED';
                    } else if (id === 'mediaPlayerSuite' && descriptor.apiMajor !== undefined && descriptor.apiMajor !== 1) {
                        status = 'failed'; errorCode = 'SUITE_API_UNSUPPORTED';
                    } else if (id === 'mediaPlayerSuite' && snapshot.settings.componentAutoUpdateEnabled?.[id] === true
                        && inventory.brokerAvailable !== true) {
                        status = 'setup_required'; errorCode = 'SUITE_MAINTENANCE_SETUP_REQUIRED';
                    }
                }
                await writeComponent(id, { currentVersion: current, installed: inventory?.installed,
                    availableVersion: descriptor && current && compareVersions(descriptor.version, current) > 0 ? descriptor.version : null,
                    status, errorCode, brokerAvailable: inventory?.brokerAvailable === true,
                    layoutValid: inventory?.layoutValid !== false,
                    apiMajor: inventory?.apiMajor ?? null, buildId: inventory?.buildId || null });
            }
            if (!interactive) {
                for (const id of COMPONENT_IDS) {
                    const latest = (await readState()).state;
                    if (!isComponentOperationPending(latest) && latest.components?.[id]?.status === 'available'
                        && snapshot.settings.componentAutoUpdateEnabled?.[id] === true) await applyComponent(id, { automatic: true });
                }
            }
            return (await readState()).state;
        } catch {
            // Component transport/schema failures do not disable the established
            // independently signed legacy extension feed.
            return writeState({ componentCatalogStatus: 'check_failed', componentNextCheckAt: now() + RETRY_DELAY_MINUTES * 60000 });
        }
    }

    async function applyComponent(componentId, { automatic = false, install = false } = {}) {
        if (!COMPONENT_IDS.includes(componentId)) throw new Error('COMPONENT_ID_INVALID');
        const snapshot = await readState();
        const envelope = snapshot.state.componentCatalog;
        const descriptor = envelope?.metadata?.components?.[componentId];
        if (!descriptor || !envelope.signature || !envelope.metadataText) return writeComponent(componentId, { status: 'failed', errorCode: 'NO_COMPONENT_READY' });
        if (isComponentOperationPending(snapshot.state) || isOperationPending(snapshot.state)
            || snapshot.state.status === 'awaiting_confirmation') return snapshot.state;
        if (automatic && snapshot.settings.componentAutoUpdateEnabled?.[componentId] !== true) return snapshot.state;
        try {
            const host = await getNativeStatus();
            if (host.componentCapabilities?.protocolVersion !== 1) return writeComponent(componentId,
                { status: 'setup_required', errorCode: 'UPDATER_COMPONENT_SETUP_REQUIRED' });
            const inventory = host.components?.[componentId];
            // An explicit install also repairs damaged or legacy (unversioned)
            // Suites through the full interactive Setup started by the hub.
            const needsFullSetup = componentId === 'mediaPlayerSuite' && (inventory?.installed === false
                || inventory?.layoutValid === false || (inventory?.installed === true && !normalizeVersion(inventory.version)));
            if (install && needsFullSetup && !automatic) {
                if (host.componentCapabilities?.mediaPlayerInstall !== true)
                    return writeComponent(componentId, { status: 'setup_required', errorCode: 'UPDATER_UPGRADE_REQUIRED' });
                const operationId = crypto.randomUUID();
                const response = await nativeMessage({ action: 'apply_component', componentId, operationId, install: true,
                    metadataText: envelope.metadataText, signature: envelope.signature });
                createOperationAlarm();
                return writeComponent(componentId, { status: response.status || 'queued', operationId: response.operationId || operationId, errorCode: null });
            }
            if (componentId === 'mediaPlayerSuite' && inventory?.installed === false)
                return writeComponent(componentId, { status: 'absent', installed: false, errorCode: 'SUITE_NOT_INSTALLED' });
            if (inventory?.installed !== true || !normalizeVersion(inventory.version))
                return writeComponent(componentId, { status: 'migration_required', errorCode: 'COMPONENT_VERSION_UNKNOWN' });
            if (componentId === 'mediaPlayerSuite' && inventory.layoutValid === false)
                return writeComponent(componentId, { status: 'failed', errorCode: 'SUITE_INSTALLATION_INVALID' });
            if (compareVersions(descriptor.version, inventory.version) <= 0)
                return writeComponent(componentId, { status: 'up_to_date', availableVersion: null, currentVersion: inventory.version, errorCode: null });
            if (descriptor.minUpdaterVersion && compareVersions(host.updaterVersion, descriptor.minUpdaterVersion) < 0)
                return writeComponent(componentId, { status: 'setup_required', errorCode: 'UPDATER_UPGRADE_REQUIRED' });
            if (componentId === 'mediaPlayerSuite' && descriptor.apiMajor !== undefined && descriptor.apiMajor !== 1)
                return writeComponent(componentId, { status: 'failed', errorCode: 'SUITE_API_UNSUPPORTED' });
            if (automatic && componentId === 'mediaPlayerSuite' && inventory.brokerAvailable !== true)
                return writeComponent(componentId, { status: 'setup_required', errorCode: 'SUITE_MAINTENANCE_SETUP_REQUIRED' });
            if (componentId === 'mediaPlayerSuite') {
                const playback = await inspectPlaybackSafety();
                if (!playback.safe) {
                    chrome.alarms.create(SAFE_RETRY_ALARM, { delayInMinutes: 10 });
                    return writeComponent(componentId, { status: 'waiting_for_safe_moment', errorCode: 'PLAYBACK_ACTIVE' });
                }
            }
            const operationId = crypto.randomUUID();
            const response = await nativeMessage({ action: 'apply_component', componentId, operationId,
                metadataText: envelope.metadataText, signature: envelope.signature });
            createOperationAlarm();
            return writeComponent(componentId, { status: response.status || 'queued', operationId: response.operationId || operationId, errorCode: null });
        } catch (error) {
            return writeComponent(componentId, { status: 'failed', errorCode: error.message || 'COMPONENT_APPLY_FAILED' });
        }
    }

    async function dismissComponentOperation(componentId) {
        if (!COMPONENT_IDS.includes(componentId)) throw new Error('COMPONENT_ID_INVALID');
        const { state } = await readState();
        const operationId = state.components?.[componentId]?.operationId;
        if (!operationId) return state;
        try {
            await nativeMessage({ action: 'dismiss_component', operationId });
        } catch (error) {
            return writeComponent(componentId, { errorCode: error.message || 'DISMISS_FAILED' });
        }
        return checkComponentUpdates({ force: true, interactive: true });
    }

    async function setComponentAutoUpdateEnabled(componentId, enabled) {
        if (!COMPONENT_IDS.includes(componentId)) throw new Error('COMPONENT_ID_INVALID');
        await updateSettings(current => ({ ...current, componentAutoUpdateEnabled: {
            ...current.componentAutoUpdateEnabled, [componentId]: enabled === true } }));
        return checkComponentUpdates({ force: true, interactive: true });
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
        if (isOperationPending(refreshed.state) || refreshed.state.status === 'awaiting_confirmation'
            || isComponentOperationPending(refreshed.state)) return;
        if (alarm.name === OPERATION_ALARM) {
            clearOperationAlarm();
            return;
        }
        await checkForUpdates({ force: alarm.name === SAFE_RETRY_ALARM });
    }

    global.UpdateService = {
        checkComponentUpdates,
        applyComponent,
        installComponent: (componentId) => applyComponent(componentId, { automatic: false, install: true }),
        dismissComponentOperation,
        setComponentAutoUpdateEnabled,
        inspectPlaybackSafety,
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
        getComponentSetupUrl: async (id) => {
            if (id === 'updater') return SETUP_URL;
            const { state } = await readState();
            return id === 'mediaPlayerSuite' && state.componentCatalog?.verified === true
                ? state.componentCatalog.metadata?.components?.mediaPlayerSuite?.assetUrl || null : null;
        },
        getSetupUrl: () => SETUP_URL
    };
}(globalThis));
