/**
 * PlaybackRuntime.
 * Canonical contract and factory for ephemeral live execution playback telemetry.
 * Strictly decoupled from PlaybackSelection (user intent).
 */

/**
 * Creates default initial PlaybackRuntimeState.
 * @param {Object} [options]
 * @returns {Object} Canonical PlaybackRuntimeState
 */
function createDefaultPlaybackRuntimeState(options = {}) {
    const identity = options.mediaIdentity || {};
    return {
        providerId: options.providerId || null,

        currentTime: typeof options.currentTime === 'number' && !Number.isNaN(options.currentTime) && options.currentTime >= 0
            ? options.currentTime
            : 0,
        duration: typeof options.duration === 'number' && !Number.isNaN(options.duration) && options.duration >= 0
            ? options.duration
            : 0,

        isPlaying: Boolean(options.isPlaying),
        isPaused: options.isPaused !== undefined ? Boolean(options.isPaused) : true,
        isEnded: Boolean(options.isEnded),

        // Telemetry confidence: 'RELIABLE' (native video / direct) | 'PARTIAL' (cleaner iframe) | 'OPAQUE' (unobserved iframe)
        progressConfidence: options.progressConfidence || 'OPAQUE',

        supportsTimestampResume: Boolean(options.supportsTimestampResume),
        supportsEnded: Boolean(options.supportsEnded),

        mountToken: typeof options.mountToken === 'number' ? options.mountToken : 0,

        mediaIdentity: {
            kinopoiskId: identity.kinopoiskId != null ? identity.kinopoiskId : null,
            seasonNumber: identity.seasonNumber != null ? identity.seasonNumber : null,
            episodeNumber: identity.episodeNumber != null ? identity.episodeNumber : null
        },

        lastTelemetryAt: typeof options.lastTelemetryAt === 'number' ? options.lastTelemetryAt : null
    };
}

/**
 * Validates whether incoming telemetry identity matches active selection identity.
 * @param {Object} currentIdentity Active runtime media identity
 * @param {Object} incomingIdentity Incoming telemetry media identity
 * @returns {boolean}
 */
function isMediaIdentityMatching(currentIdentity, incomingIdentity) {
    if (!currentIdentity || !incomingIdentity) return false;

    if (currentIdentity.kinopoiskId != null && incomingIdentity.kinopoiskId != null) {
        if (Number(currentIdentity.kinopoiskId) !== Number(incomingIdentity.kinopoiskId)) {
            return false;
        }
    }

    if (currentIdentity.seasonNumber != null && incomingIdentity.seasonNumber != null) {
        if (Number(currentIdentity.seasonNumber) !== Number(incomingIdentity.seasonNumber)) {
            return false;
        }
    }

    if (currentIdentity.episodeNumber != null && incomingIdentity.episodeNumber != null) {
        if (Number(currentIdentity.episodeNumber) !== Number(incomingIdentity.episodeNumber)) {
            return false;
        }
    }

    return true;
}

/**
 * Evaluates whether current runtime telemetry indicates completed playback.
 * Completion requires RELIABLE provider confidence (Seasonvar native video).
 * @param {Object} runtime PlaybackRuntimeState snapshot
 * @param {Object} [context] Optional context (e.g. { isSeeking: boolean })
 * @returns {boolean} True if playback is completed
 */
function isPlaybackCompleted(runtime, context = {}) {
    if (!runtime || runtime.progressConfidence !== 'RELIABLE') {
        return false;
    }

    if (context.isSeeking === true) {
        return false;
    }

    if (runtime.isEnded === true) {
        return true;
    }

    const duration = typeof runtime.duration === 'number' && !Number.isNaN(runtime.duration) && Number.isFinite(runtime.duration)
        ? runtime.duration
        : 0;
    const currentTime = typeof runtime.currentTime === 'number' && !Number.isNaN(runtime.currentTime) && Number.isFinite(runtime.currentTime)
        ? runtime.currentTime
        : 0;

    // Short content safety (Part 3): duration <= 120s requires reliable isEnded === true
    if (duration <= 120) {
        return false;
    }

    // 90% threshold for regular content
    if ((currentTime / duration) >= 0.90) {
        return true;
    }

    return false;
}

/**
 * Normalizes a viewing progress record from storage or memory into canonical shape.
 * Backward-compatible with legacy strings ("3 сезон", "7 серия") and missing fields.
 * @param {Object|null} record
 * @returns {Object|null}
 */
function normalizeProgressRecord(record) {
    if (!record || typeof record !== 'object') {
        return null;
    }

    let seasonNum = null;
    let episodeNum = null;

    if (record.season != null) {
        if (typeof record.season === 'number' && Number.isInteger(record.season) && record.season >= 0) {
            seasonNum = record.season;
        } else if (typeof record.season === 'string') {
            const match = record.season.match(/(\d+)/);
            if (match) seasonNum = parseInt(match[1], 10);
        }
    }

    if (record.episode != null) {
        if (typeof record.episode === 'number' && Number.isInteger(record.episode) && record.episode > 0) {
            episodeNum = record.episode;
        } else if (typeof record.episode === 'string') {
            const match = record.episode.match(/(\d+)/);
            if (match) episodeNum = parseInt(match[1], 10);
        }
    }

    let timestamp = 0;
    if (record.timestamp != null && record.timestamp !== '') {
        const parsedTs = Number(record.timestamp);
        if (!Number.isNaN(parsedTs) && Number.isFinite(parsedTs) && parsedTs >= 0) {
            timestamp = Math.floor(parsedTs);
        }
    }

    let duration = null;
    if (record.duration != null && record.duration !== '') {
        const parsedDur = Number(record.duration);
        if (!Number.isNaN(parsedDur) && Number.isFinite(parsedDur) && parsedDur > 0) {
            duration = Math.floor(parsedDur);
        }
    }

    const completed = Boolean(record.completed);

    return {
        movieId: record.movieId != null ? record.movieId : null,
        movieTitle: typeof record.movieTitle === 'string' ? record.movieTitle : '',
        season: seasonNum,
        episode: episodeNum,
        seasonLabel: seasonNum != null ? `${seasonNum} сезон` : (record.season || null),
        episodeLabel: episodeNum != null ? `${episodeNum} серия` : (record.episode || null),
        timestamp,
        duration,
        completed,
        providerId: record.providerId || null,
        updatedAt: record.updatedAt || null
    };
}

/**
 * Evaluates whether auto-next playback is eligible.
 * Requires RELIABLE confidence, verified isEnded === true, direct S/E support, series media only, and valid playable next episode.
 * @param {Object} params
 * @param {Object} [params.selection] Current PlaybackSelection
 * @param {Object} [params.runtime] PlaybackRuntimeState
 * @param {Object} [params.providerCapabilities] Provider capabilities / adapter
 * @param {Object} [params.nextEpisode] Target next episode candidate
 * @returns {boolean}
 */
function canAutoNext(params = {}) {
    const { selection, runtime, providerCapabilities, nextEpisode } = params;
    if (!selection || !runtime || !nextEpisode) return false;

    // 1. Series only (movies cannot auto-next)
    if (selection.mediaType === 'movie') {
        return false;
    }

    // 2. Confidence must be RELIABLE (Seasonvar only)
    const confidence = runtime.progressConfidence || (typeof providerCapabilities?.getProgressConfidence === 'function' ? providerCapabilities.getProgressConfidence() : providerCapabilities?.progressConfidence);
    if (confidence !== 'RELIABLE') {
        return false;
    }

    // 3. Provider must support direct season/episode and ended detection
    if (providerCapabilities) {
        const supportsDirect = typeof providerCapabilities.supportsDirectSeasonEpisode === 'function'
            ? providerCapabilities.supportsDirectSeasonEpisode()
            : Boolean(providerCapabilities.supportsDirectSeasonEpisode);
        if (!supportsDirect) return false;

        const supportsEnded = typeof providerCapabilities.supportsEnded === 'function'
            ? providerCapabilities.supportsEnded()
            : Boolean(providerCapabilities.supportsEnded);
        if (!supportsEnded) return false;
    }

    // 4. CRITICAL: Auto-next prompt strictly requires verified isEnded === true
    // (90% completion is saved to progress, but does NOT start countdown)
    if (runtime.isEnded !== true) {
        return false;
    }

    // 5. Next episode must exist, have valid S/E, and be playable/released
    if (nextEpisode.seasonNumber == null || nextEpisode.episodeNumber == null) {
        return false;
    }
    if (nextEpisode.isReleased === false) {
        return false;
    }

    return true;
}

/**
 * Formats a duration or timestamp in seconds to mm:ss or hh:mm:ss string.
 * @param {number|null|undefined} seconds
 * @returns {string} Formatted time string
 */
function formatPlaybackTime(seconds) {
    if (seconds == null || Number.isNaN(Number(seconds)) || Number(seconds) < 0) {
        return '00:00';
    }
    const totalSecs = Math.floor(Number(seconds));
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

if (typeof window !== 'undefined') {
    window.createDefaultPlaybackRuntimeState = createDefaultPlaybackRuntimeState;
    window.isMediaIdentityMatching = isMediaIdentityMatching;
    window.isPlaybackCompleted = isPlaybackCompleted;
    window.canAutoNext = canAutoNext;
    window.normalizeProgressRecord = normalizeProgressRecord;
    window.formatPlaybackTime = formatPlaybackTime;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createDefaultPlaybackRuntimeState,
        isMediaIdentityMatching,
        isPlaybackCompleted,
        canAutoNext,
        normalizeProgressRecord,
        formatPlaybackTime
    };
}
