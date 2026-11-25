/**
 * HlsPlaybackFactory - the single place that creates hls.js instances for
 * extension-owned <video> players and decides how stream errors recover.
 *
 * Policies:
 * - `bounded` (scraped provider streams): fatal network errors are retried
 *   with backoff a limited number of times; manifests rejected with
 *   401/403/404/410 (expired or signed-off URLs) fail immediately so the
 *   caller can fall back to another source.
 * - `persistent` (local torrent sessions): the backend answers 5xx while the
 *   torrent buffers, so network errors are retried indefinitely.
 *
 * Fatal media errors are recovered in place (recoverMediaError, then one
 * swapAudioCodec attempt) under both policies. Retry state resets once the
 * video plays again. When recovery is exhausted, `onFatal` is called; unless
 * it returns true (failure handled, e.g. by a source fallback), an
 * `extension-hls-fatal` event is dispatched on the video element.
 *
 * Quality and buffering: the best rendition the connection carries plays whatever the
 * player's size, and drops only when the computer loses frames. Provider streams start at
 * that rendition, from the last measured bandwidth or Chrome's own estimate, without
 * hls.js' low-quality test fragment. The buffer is bounded by seconds and by bytes, so a
 * heavy stream stays inside Chrome's media memory.
 */
(function(global) {
    'use strict';

    const HLS_FATAL_EVENT = 'extension-hls-fatal';
    const HLS_RETRY_EVENT = 'extension-hls-retry';
    const TERMINAL_MANIFEST_STATUSES = new Set([401, 403, 404, 410]);
    const DEFAULTS = Object.freeze({
        maxNetworkRetries: 3,
        maxMediaRecoveries: 2,
        maxRetryDelaySeconds: 8,
        retryBaseDelayMs: 1000
    });
    const DEFAULT_HLS_CONFIG = Object.freeze({
        enableWorker: true,
        capLevelToPlayerSize: false,
        capLevelOnFPSDrop: true,
        // hls.js keeps the whole played-back buffer by default (Infinity).
        backBufferLength: 60,
        maxBufferLength: 60,
        maxMaxBufferLength: 240,
        maxBufferSize: 90 * 1000 * 1000
    });
    // Chrome never reports more than 10 Mbit/s, which is also a sane first guess.
    const FIRST_GUESS_FACTOR = 0.8;
    const STALL_MS = 2500;
    const STALL_WINDOW_MS = 120_000;
    const START_LIMIT_MS = 12_000;
    const BANDWIDTH_STORAGE_KEY = 'movieExtension.hlsBandwidthEstimate';
    const BANDWIDTH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const BANDWIDTH_MIN_BPS = 150_000;
    const BANDWIDTH_MAX_BPS = 200_000_000;
    const BANDWIDTH_SAVE_INTERVAL_MS = 15_000;

    const isPlausibleBandwidth = (bps) => Number.isFinite(bps)
        && bps >= BANDWIDTH_MIN_BPS
        && bps <= BANDWIDTH_MAX_BPS;

    /**
     * Last bandwidth measured by a provider stream, or null when absent/stale.
     * Storage may be unavailable (private mode, tests); that only loses the hint.
     * @returns {number|null} bits per second
     */
    function readBandwidthEstimate() {
        try {
            const stored = JSON.parse(global.localStorage?.getItem(BANDWIDTH_STORAGE_KEY) || 'null');
            const bps = Number(stored?.bps);
            const measuredAt = Number(stored?.measuredAt);
            if (!isPlausibleBandwidth(bps) || !Number.isFinite(measuredAt)) return null;
            if (Date.now() - measuredAt > BANDWIDTH_MAX_AGE_MS) return null;
            return Math.round(bps);
        } catch {
            return null;
        }
    }

    /** Chrome's estimate of the connection, for a browser that has measured no stream yet. */
    function guessBandwidth() {
        const bps = Number(global.navigator?.connection?.downlink) * 1_000_000 * FIRST_GUESS_FACTOR;
        return isPlausibleBandwidth(bps) ? Math.round(bps) : null;
    }

    function writeBandwidthEstimate(bps) {
        if (!isPlausibleBandwidth(bps)) return;
        try {
            global.localStorage?.setItem(BANDWIDTH_STORAGE_KEY, JSON.stringify({
                bps: Math.round(bps),
                measuredAt: Date.now()
            }));
        } catch { /* ignore */ }
    }

    /**
     * hls.js config for one stream: shared defaults, then the remembered
     * bandwidth (provider streams only), then caller quality/buffer overrides.
     * Transport restrictions are applied last and cannot be overridden.
     * @param {Object} [overrides]
     * @param {{rememberBandwidth?: boolean, networkProfile?: 'remote'|'local'|'hdrezka', localManifestUrl?: string, providerManifestUrl?: string}} [options]
     * @returns {Object|null}
     */
    function buildConfig(overrides = {}, { rememberBandwidth = true, networkProfile = 'remote', localManifestUrl, providerManifestUrl } = {}) {
        if (!['remote', 'local', 'hdrezka'].includes(networkProfile)
            || typeof global.UrlPolicy?.check !== 'function'
            || typeof global.UrlPolicy?.kindOf !== 'function'
            || typeof global.HlsPolicyLoader?.forProfile !== 'function') return null;
        const loader = global.HlsPolicyLoader.forProfile(networkProfile, { localManifestUrl, providerManifestUrl });
        if (typeof loader !== 'function') return null;
        const config = { ...DEFAULT_HLS_CONFIG };
        const estimate = rememberBandwidth ? Math.max(readBandwidthEstimate() || 0, guessBandwidth() || 0) : 0;
        if (estimate) {
            config.abrEwmaDefaultEstimate = estimate;
            config.testBandwidth = false;
        }
        return {
            ...config, ...(overrides || {}), loader,
            pLoader: undefined, fLoader: undefined,
            fetchSetup: undefined, xhrSetup: undefined,
            cmcd: undefined, cmcdController: undefined,
            progressive: false,
            emeEnabled: false, emeController: undefined,
            drmSystems: undefined, drmSystemOptions: undefined,
            widevineLicenseUrl: undefined, licenseXhrSetup: undefined,
            licenseResponseCallback: undefined,
            contentSteeringController: undefined,
            // Asset-list contexts are outside this first controlled HLS slice.
            interstitialsController: undefined
        };
    }

    const isManifestError = (data) => /^manifest/i.test(String(data?.details || ''));
    const responseStatus = (data) => Number(data?.response?.code ?? data?.networkDetails?.status) || 0;

    /**
     * Whether a stream error means the URL itself is no longer valid, so a
     * retry cannot help (expired token, removed video, forbidden embed).
     * @param {Object} data - hls.js ERROR event data
     * @returns {boolean}
     */
    function isTerminalNetworkError(data) {
        return isManifestError(data) && TERMINAL_MANIFEST_STATUSES.has(responseStatus(data));
    }

    /**
     * Create, attach and load an hls.js instance with shared error recovery.
     * The returned instance is a plain Hls object; destroying it also cancels
     * pending recovery timers.
     *
     * @param {HTMLVideoElement} video
     * @param {string} url
     * @param {Object} [options]
     * @param {Function} [options.Hls] - hls.js constructor (defaults to global Hls)
     * @param {Object} [options.config] - Extra hls.js config
     * @param {'bounded'|'persistent'} [options.policy='bounded']
     * @param {'remote'|'local'|'hdrezka'} [options.networkProfile='remote'] - Independent URL trust boundary
     * @param {string} [options.localManifestUrl] - Captured local session manifest; scopes every local request
     * @param {string} [options.providerManifestUrl] - Captured HDRezka manifest; scopes every pilot request
     * @param {number} [options.maxNetworkRetries=3] - bounded policy only
     * @param {number} [options.maxMediaRecoveries=2]
     * @param {number} [options.retryBaseDelayMs=1000] - Backoff unit (1, 2, 4, 8 units)
     * @param {() => boolean} [options.isCurrent] - Ignore events once false
     * @param {(info: {delaySeconds: number, attempt: number, data: Object}) => void} [options.onRetryScheduled]
     * @param {(info: {reason: string, data: Object}) => boolean|void} [options.onFatal] - Return true when handled
     * @param {() => void} [options.onRecovered] - Playback resumed after a retry/recovery
     * @param {(hls: Object) => void} [options.beforeLoad] - Register listeners/ownership before loading starts
     * @param {boolean} [options.attachFirst=false] - attachMedia() before loadSource()
     * @param {boolean} [options.rememberBandwidth] - Seed/persist the ABR estimate
     *   (defaults to true for `bounded`; local torrent throughput would skew it)
     * @returns {Object|null} Hls instance, or null when hls.js is unavailable/unsupported
     */
    function create(video, url, options = {}) {
        const HlsCtor = options.Hls || global.Hls;
        if (!video || !url || typeof HlsCtor !== 'function' || !HlsCtor.isSupported?.()) return null;

        const policy = options.policy === 'persistent' ? 'persistent' : 'bounded';
        const maxNetworkRetries = options.maxNetworkRetries ?? DEFAULTS.maxNetworkRetries;
        const maxMediaRecoveries = options.maxMediaRecoveries ?? DEFAULTS.maxMediaRecoveries;
        const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULTS.retryBaseDelayMs;
        const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true;
        const Events = HlsCtor.Events || {};
        const ErrorTypes = HlsCtor.ErrorTypes || {};
        const NETWORK_ERROR = ErrorTypes.NETWORK_ERROR || 'networkError';
        const MEDIA_ERROR = ErrorTypes.MEDIA_ERROR || 'mediaError';

        const rememberBandwidth = options.rememberBandwidth ?? policy === 'bounded';
        const config = buildConfig(options.config, {
            rememberBandwidth, networkProfile: options.networkProfile, localManifestUrl: options.localManifestUrl,
            providerManifestUrl: options.providerManifestUrl
        });
        if (!config) return null;
        const hls = new HlsCtor(config);
        let networkRetries = 0;
        let mediaRecoveries = 0;
        let audioCodecSwapped = false;
        let retryTimer = null;
        let recovering = false;
        let failed = false;
        let destroyed = false;
        let refreshPending = false;
        let refreshAttempted = false;

        const clearRetryTimer = () => {
            if (retryTimer !== null) clearTimeout(retryTimer);
            retryTimer = null;
        };
        const active = () => !destroyed && !failed && isCurrent();

        const fail = (reason, data, destroyTransport = false) => {
            if (failed || destroyed) return;
            failed = true;
            clearRetryTimer();
            try { hls.stopLoad(); } catch { /* ignore */ }
            if (destroyTransport) {
                // Set failed before destroy: DESTROYING or nested ERROR events
                // must never reopen recovery or report this failure twice.
                try { hls.destroy(); } catch { /* ignore */ }
            }
            if (!isCurrent()) return;
            let handled = false;
            try { handled = options.onFatal?.({ reason, data }) === true; } catch (error) {
                console.warn('[HlsPlaybackFactory] onFatal handler failed:', global.PlayerDiagnostics?.sanitizeError(error) || { category: 'unknown' });
            }
            // A handler that already replaced the source (fallback) owns the
            // UI; outer lifecycle watchers must not report an error.
            if (handled) return;
            try {
                video.dispatchEvent(new CustomEvent(HLS_FATAL_EVENT, { detail: { reason, url } }));
            } catch { /* ignore */ }
        };

        const scheduleNetworkRetry = (data) => {
            if (!active() || retryTimer !== null) return;
            if (policy === 'bounded' && networkRetries >= maxNetworkRetries) {
                fail('network-retries-exhausted', data);
                return;
            }
            const attempt = networkRetries;
            networkRetries += 1;
            recovering = true;
            const delaySeconds = Math.min(DEFAULTS.maxRetryDelaySeconds, 2 ** Math.min(attempt, 3));
            const delayMs = delaySeconds * retryBaseDelayMs;
            const reloadManifest = isManifestError(data);
            try { options.onRetryScheduled?.({ delaySeconds, attempt: networkRetries, data }); } catch { /* ignore */ }
            try {
                video.dispatchEvent(new CustomEvent(HLS_RETRY_EVENT, { detail: { delayMs } }));
            } catch { /* ignore */ }
            retryTimer = setTimeout(() => {
                retryTimer = null;
                if (!active()) return;
                try {
                    // A failed manifest never produced levels: startLoad() alone
                    // would not request it again.
                    if (reloadManifest) {
                        hls.loadSource(url);
                    } else {
                        hls.stopLoad();
                        // A growing playlist is live to hls.js: before the first frame,
                        // startLoad(-1) would jump to its live edge, past the caller's start.
                        const configuredStart = Number(hls.config?.startPosition);
                        hls.startLoad(!(video.currentTime > 0) && configuredStart >= 0 ? configuredStart : -1);
                    }
                } catch (error) {
                    console.warn('[HlsPlaybackFactory] HLS recovery retry failed:', global.PlayerDiagnostics?.sanitizeError(error) || { category: 'unknown' });
                    scheduleNetworkRetry(data);
                }
            }, delayMs);
        };

        const recoverMedia = (data) => {
            if (mediaRecoveries < maxMediaRecoveries && typeof hls.recoverMediaError === 'function') {
                mediaRecoveries += 1;
                recovering = true;
                hls.recoverMediaError();
                return;
            }
            if (!audioCodecSwapped && typeof hls.swapAudioCodec === 'function'
                && typeof hls.recoverMediaError === 'function') {
                audioCodecSwapped = true;
                recovering = true;
                hls.swapAudioCodec();
                hls.recoverMediaError();
                return;
            }
            fail('media-recovery-exhausted', data);
        };

        hls.on(Events.ERROR || 'hlsError', (_event, data) => {
            if (!active()) return;
            if (data?.response?.text === 'POLICY_VIOLATION') {
                fail('policy', data, true);
                return;
            }
            const status = responseStatus(data);
            if (refreshPending) return;
            const resource = /key/i.test(data?.details || '') ? 'key'
                : /frag/i.test(data?.details || '') ? 'fragment'
                    : /manifest/i.test(data?.details || '') ? 'manifest'
                        : /level|audioTrack|subtitleTrack/i.test(data?.details || '') ? 'level' : null;
            if (options.networkProfile !== 'local' && resource && TERMINAL_MANIFEST_STATUSES.has(status)
                && typeof options.onSourceExpired === 'function') {
                if (refreshAttempted) { fail('source-rejected', data); return; }
                refreshAttempted = refreshPending = true;
                clearRetryTimer();
                try { hls.stopLoad(); } catch { /* ignore */ }
                Promise.resolve().then(() => active() && options.onSourceExpired({ status, resource, data }))
                    .then(result => {
                        refreshPending = false;
                        if (active() && result !== true && result?.recovered !== true) fail('source-rejected', data);
                    }).catch(() => {
                        refreshPending = false;
                        if (active()) fail('source-rejected', data);
                    });
                return;
            }

            if (data?.type === MEDIA_ERROR && data?.fatal) {
                recoverMedia(data);
                return;
            }

            if (policy === 'persistent') {
                // Torrent HLS: 5xx while buffering is expected and transient.
                if (data?.type === NETWORK_ERROR || status >= 500 || data?.fatal) {
                    scheduleNetworkRetry(data);
                }
                return;
            }

            if (!data?.fatal) return; // hls.js retries non-fatal errors itself.
            if (isTerminalNetworkError(data)) {
                fail('source-rejected', data);
                return;
            }
            if (data.type === NETWORK_ERROR) {
                scheduleNetworkRetry(data);
                return;
            }
            fail('fatal-error', data);
        });

        const onPlaying = () => {
            if (destroyed || failed) return;
            clearRetryTimer();
            networkRetries = 0;
            mediaRecoveries = 0;
            if (recovering) {
                recovering = false;
                try { options.onRecovered?.(); } catch { /* ignore */ }
            }
        };
        video.addEventListener('playing', onPlaying);

        // Persist the measured throughput so the next stream starts at a
        // realistic quality. Sample after real fragment loads, throttled.
        let measuredBandwidth = false;
        let lastBandwidthSaveAt = 0;
        const saveBandwidth = () => {
            if (!rememberBandwidth || !measuredBandwidth) return;
            writeBandwidthEstimate(Number(hls.bandwidthEstimate));
            lastBandwidthSaveAt = Date.now();
        };
        if (rememberBandwidth) {
            hls.on(Events.FRAG_LOADED || 'hlsFragLoaded', () => {
                measuredBandwidth = true;
                if (Date.now() - lastBandwidthSaveAt >= BANDWIDTH_SAVE_INTERVAL_MS) saveBandwidth();
            });
        }

        hls.on(Events.DESTROYING || 'hlsDestroying', () => {
            saveBandwidth();
            destroyed = true;
            clearRetryTimer();
            video.removeEventListener('playing', onPlaying);
        });

        options.beforeLoad?.(hls);
        if (!active()) return null;
        if (options.attachFirst) {
            hls.attachMedia(video);
            if (!active()) return null;
            hls.loadSource(url);
        } else {
            hls.loadSource(url);
            if (!active()) return null;
            hls.attachMedia(video);
        }
        return active() ? hls : null;
    }

    /**
     * For qualities that are separate streams, which hls.js cannot switch between: says when
     * the connection does not keep the one playing (two long stalls in two minutes, or a
     * start that takes too long).
     * @param {HTMLVideoElement} video
     * @param {() => void} onPersistent
     * @returns {() => void} stop watching
     */
    function watchStalls(video, onPersistent) {
        const stalls = [];
        let started = false;
        let stallTimer = null;
        let startTimer = null;
        const clear = () => {
            clearTimeout(stallTimer);
            clearTimeout(startTimer);
            stallTimer = startTimer = null;
        };
        const report = () => {
            clear();
            stalls.length = 0;
            onPersistent();
        };
        const handlers = {
            play: () => { if (!started && !startTimer) startTimer = setTimeout(report, START_LIMIT_MS); },
            playing: () => { started = true; clear(); },
            pause: clear,
            seeking: clear,
            waiting: () => {
                if (!started || video.seeking || stallTimer) return;
                stallTimer = setTimeout(() => {
                    stallTimer = null;
                    if (video.paused || video.seeking || video.readyState > 2) return;
                    const now = Date.now();
                    stalls.push(now);
                    while (now - stalls[0] > STALL_WINDOW_MS) stalls.shift();
                    if (stalls.length >= 2) report();
                }, STALL_MS);
            }
        };
        for (const [type, handler] of Object.entries(handlers)) video.addEventListener(type, handler);
        return () => {
            clear();
            for (const [type, handler] of Object.entries(handlers)) video.removeEventListener(type, handler);
        };
    }

    global.HlsPlaybackFactory = {
        watchStalls,
        HLS_FATAL_EVENT,
        HLS_RETRY_EVENT,
        DEFAULTS,
        DEFAULT_HLS_CONFIG,
        BANDWIDTH_STORAGE_KEY,
        buildConfig,
        create,
        isTerminalNetworkError
    };
})(typeof window !== 'undefined' ? window : globalThis);
