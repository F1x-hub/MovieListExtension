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
 * Quality and buffering: renditions are capped to the player's on-screen size
 * (device pixel ratio included; manual quality choices are not capped), the
 * played-back buffer is bounded, and provider streams start from the last
 * measured bandwidth instead of hls.js' conservative 500 kbps guess, so the
 * first fragments are not needlessly low quality.
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
        // Skip renditions larger than the player box; hls.js re-measures every
        // second and does not cap while the box is 0x0 (hidden preload).
        capLevelToPlayerSize: true,
        // hls.js keeps the whole played-back buffer by default (Infinity).
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 120
    });
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
     * bandwidth (provider streams only), then caller overrides.
     * @param {Object} [overrides]
     * @param {{rememberBandwidth?: boolean}} [options]
     * @returns {Object}
     */
    function buildConfig(overrides = {}, { rememberBandwidth = true } = {}) {
        const config = { ...DEFAULT_HLS_CONFIG };
        const estimate = rememberBandwidth ? readBandwidthEstimate() : null;
        if (estimate) config.abrEwmaDefaultEstimate = estimate;
        return { ...config, ...(overrides || {}) };
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
        const hls = new HlsCtor(buildConfig(options.config, { rememberBandwidth }));
        let networkRetries = 0;
        let mediaRecoveries = 0;
        let audioCodecSwapped = false;
        let retryTimer = null;
        let recovering = false;
        let failed = false;
        let destroyed = false;

        const clearRetryTimer = () => {
            if (retryTimer !== null) clearTimeout(retryTimer);
            retryTimer = null;
        };
        const active = () => !destroyed && !failed && isCurrent();

        const fail = (reason, data) => {
            if (failed || destroyed) return;
            failed = true;
            clearRetryTimer();
            try { hls.stopLoad(); } catch { /* ignore */ }
            if (!isCurrent()) return;
            let handled = false;
            try { handled = options.onFatal?.({ reason, data }) === true; } catch (error) {
                console.warn('[HlsPlaybackFactory] onFatal handler failed:', error);
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
                        hls.startLoad(-1);
                    }
                } catch (error) {
                    console.warn('[HlsPlaybackFactory] HLS recovery retry failed:', error);
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
            const status = responseStatus(data);

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
        if (options.attachFirst) {
            hls.attachMedia(video);
            hls.loadSource(url);
        } else {
            hls.loadSource(url);
            hls.attachMedia(video);
        }
        return hls;
    }

    global.HlsPlaybackFactory = {
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
