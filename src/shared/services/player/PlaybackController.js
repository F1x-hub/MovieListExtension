/**
 * PlaybackController.
 * Central coordinator and single canonical state owner for MovieDetails video playback,
 * provider adapters, async race protection, and modal lifecycle.
 */

const normalizeSelection = typeof normalizePlaybackSelection !== 'undefined'
    ? normalizePlaybackSelection
    : (typeof require !== 'undefined' ? require('./PlaybackSelection').normalizePlaybackSelection : (input) => input);

const createDefaultRuntime = typeof createDefaultPlaybackRuntimeState !== 'undefined'
    ? createDefaultPlaybackRuntimeState
    : (typeof require !== 'undefined' ? require('./PlaybackRuntime').createDefaultPlaybackRuntimeState : (opts) => ({
        providerId: opts?.providerId || null,
        currentTime: typeof opts?.currentTime === 'number' ? opts.currentTime : 0,
        duration: typeof opts?.duration === 'number' ? opts.duration : 0,
        isPlaying: false,
        isPaused: true,
        isEnded: false,
        progressConfidence: opts?.progressConfidence || 'OPAQUE',
        supportsTimestampResume: Boolean(opts?.supportsTimestampResume),
        supportsEnded: Boolean(opts?.supportsEnded),
        mountToken: typeof opts?.mountToken === 'number' ? opts.mountToken : 0,
        mediaIdentity: {
            kinopoiskId: opts?.mediaIdentity?.kinopoiskId != null ? opts.mediaIdentity.kinopoiskId : null,
            seasonNumber: opts?.mediaIdentity?.seasonNumber != null ? opts.mediaIdentity.seasonNumber : null,
            episodeNumber: opts?.mediaIdentity?.episodeNumber != null ? opts.mediaIdentity.episodeNumber : null
        },
        lastTelemetryAt: null
    }));

const isMediaMatching = typeof isMediaIdentityMatching !== 'undefined'
    ? isMediaIdentityMatching
    : (typeof require !== 'undefined' ? require('./PlaybackRuntime').isMediaIdentityMatching : () => true);

const checkPlaybackCompleted = typeof isPlaybackCompleted !== 'undefined'
    ? isPlaybackCompleted
    : (typeof require !== 'undefined' ? require('./PlaybackRuntime').isPlaybackCompleted : () => false);

const EpisodeHistoryServiceClass = typeof EpisodeHistoryService !== 'undefined'
    ? EpisodeHistoryService
    : (typeof require !== 'undefined' ? (() => { try { return require('../EpisodeHistoryService').EpisodeHistoryService; } catch { return null; } })() : null);

class PlaybackController {
    /**
     * @param {Object} options
     * @param {HTMLElement} [options.container] Video mount container (#videoContainer)
     * @param {HTMLElement} [options.modal] Video modal element (#videoPlayerModal)
     * @param {Object} [options.lifecycle] PlayerSourceLifecycle instance
     * @param {Object} [options.progressService] ProgressService instance
     * @param {Object} [options.episodeHistoryService] EpisodeHistoryService instance
     * @param {Function} [options.onSelectionChange] Callback when canonical selection updates
     * @param {Function} [options.onProviderChange] Callback when active provider changes
     * @param {Function} [options.onStateChange] Callback for modal state (loading, ready, error, minimized)
     * @param {Function} [options.onRuntimeChange] Callback when runtime state updates
     * @param {Function} [options.onCompletion] Callback when an episode completes
     */
    constructor(options = {}) {
        this.container = options.container || null;
        this.modal = options.modal || null;
        this.lifecycle = options.lifecycle || null;
        this.progressService = options.progressService || null;
        this.episodeHistoryService = options.episodeHistoryService || (EpisodeHistoryServiceClass ? new EpisodeHistoryServiceClass() : null);

        this.onSelectionChange = options.onSelectionChange || null;
        this.onProviderChange = options.onProviderChange || null;
        this.onStateChange = options.onStateChange || null;
        this.onRuntimeChange = options.onRuntimeChange || null;
        this.onCompletion = options.onCompletion || null;

        // Canonical Selection State (User Intent)
        this.currentSelection = null;
        this.activeProviderId = null;
        this.activeAdapter = null;
        this.activeMount = null;
        this.currentTimestamp = 0;

        // Canonical Runtime State (Live Telemetry - Phase 3E & 3F)
        this.runtimeState = createDefaultRuntime();
        this.runtimeListeners = new Set();
        this.completionListeners = new Set();
        this.endedListeners = new Set();
        this.cancelAutoNextListeners = new Set();
        if (typeof this.onCompletion === 'function') {
            this.completionListeners.add(this.onCompletion);
        }
        this.activeVideoElement = null;
        this.videoEventListeners = [];
        this.lastProgressSaveTime = 0;
        this.PROGRESS_WRITE_THROTTLE_MS = 15000; // 15 seconds

        // Edge-triggered completion state & seeking tracking (Phase 3F)
        this.hasCompletedCurrentSession = false;
        this.isSeeking = false;

        // Async Race Generation Token
        this.mountRequestId = 0;

        // Modal Lifecycle State
        this.isOpen = false;
        this.isMinimized = false;

        // Registered Adapters (id -> BasePlaybackAdapter)
        this.adapters = new Map();
        this._initDefaultAdapters();
    }

    /**
     * Registers default adapters if classes are available.
     * @private
     */
    _initDefaultAdapters() {
        const adapterClasses = [
            typeof SeasonvarAdapter !== 'undefined' ? SeasonvarAdapter : (typeof require !== 'undefined' ? require('./adapters/SeasonvarAdapter').SeasonvarAdapter : null),
            typeof VidSrcAdapter !== 'undefined' ? VidSrcAdapter : (typeof require !== 'undefined' ? require('./adapters/VidSrcAdapter').VidSrcAdapter : null),
            typeof KinogoAdapter !== 'undefined' ? KinogoAdapter : (typeof require !== 'undefined' ? require('./adapters/KinogoAdapter').KinogoAdapter : null),
            typeof ExFsAdapter !== 'undefined' ? ExFsAdapter : (typeof require !== 'undefined' ? require('./adapters/ExFsAdapter').ExFsAdapter : null),
            typeof RutubeAdapter !== 'undefined' ? RutubeAdapter : (typeof require !== 'undefined' ? require('./adapters/RutubeAdapter').RutubeAdapter : null)
        ];

        for (const Cls of adapterClasses) {
            if (Cls) {
                try {
                    const instance = new Cls();
                    this.registerAdapter(instance);
                } catch (e) {
                    console.warn('[PlaybackController] Failed to initialize adapter class:', e);
                }
            }
        }
    }

    /**
     * Registers a provider adapter.
     * @param {Object} adapter BasePlaybackAdapter instance
     */
    registerAdapter(adapter) {
        if (!adapter || !adapter.id) {
            throw new Error('PlaybackController.registerAdapter: valid adapter required');
        }
        this.adapters.set(adapter.id, adapter);
    }

    /**
     * Retrieves an adapter by provider ID.
     * @param {string} providerId
     * @returns {Object|null}
     */
    getAdapter(providerId) {
        if (!providerId) return null;
        return this.adapters.get(providerId) || null;
    }

    /**
     * Returns capability metadata for a provider.
     * @param {string} providerId
     * @returns {Object|null}
     */
    getProviderCapabilities(providerId) {
        const adapter = this.getAdapter(providerId);
        if (!adapter) return null;
        return {
            id: adapter.id,
            label: adapter.label,
            supportsMovies: adapter.supportsMovies(),
            supportsSeries: adapter.supportsSeries(),
            supportsDirectSeasonEpisode: adapter.supportsDirectSeasonEpisode(),
            selectionMode: typeof adapter.getSelectionMode === 'function'
                ? adapter.getSelectionMode()
                : (adapter.supportsDirectSeasonEpisode() ? 'DIRECT' : 'OPAQUE'),
            supportsProviderInternalSelection: typeof adapter.supportsProviderInternalSelection === 'function'
                ? adapter.supportsProviderInternalSelection()
                : false,
            canApplySelection: typeof adapter.canApplySelection === 'function'
                ? adapter.canApplySelection(this.currentSelection)
                : false,
            supportsProgressTracking: typeof adapter.supportsProgressTracking === 'function' ? adapter.supportsProgressTracking() : false,
            supportsDuration: typeof adapter.supportsDuration === 'function' ? adapter.supportsDuration() : false,
            supportsEnded: typeof adapter.supportsEnded === 'function' ? adapter.supportsEnded() : false,
            supportsTimestampResume: typeof adapter.supportsTimestampResume === 'function' ? adapter.supportsTimestampResume() : false,
            progressConfidence: typeof adapter.getProgressConfidence === 'function' ? adapter.getProgressConfidence() : 'OPAQUE',
            roomSync: typeof adapter.getRoomSyncCapabilities === 'function'
                ? { ...adapter.getRoomSyncCapabilities() }
                : {
                    observeTime: false,
                    play: false,
                    pause: false,
                    seek: false,
                    duration: false,
                    lockGuestTimeline: false
                }
        };
    }

    /**
     * Returns the current canonical selection (User Intent).
     * @returns {Object|null}
     */
    getSelection() {
        return this.currentSelection ? { ...this.currentSelection } : null;
    }

    /**
     * Sets the canonical selection.
     * @param {Object} selection
     */
    setSelection(selection) {
        if (!selection) {
            this.clearSelection();
            return;
        }

        // Flush previous selection's progress if changing to a different episode
        if (this.currentSelection && (
            this.currentSelection.seasonNumber !== selection.seasonNumber ||
            this.currentSelection.episodeNumber !== selection.episodeNumber ||
            this.currentSelection.kinopoiskId !== selection.kinopoiskId
        )) {
            this.flushProgress({ force: true });
            this._notifyCancelAutoNext();
        }

        const normalized = normalizeSelection(selection);
        this.currentSelection = normalized;
        if (normalized.initialTimestamp) {
            this.currentTimestamp = normalized.initialTimestamp;
        }

        // Keep runtime state mediaIdentity in sync if idle
        if (!this.isOpen && this.runtimeState) {
            this.runtimeState.mediaIdentity = {
                kinopoiskId: normalized.kinopoiskId || null,
                seasonNumber: normalized.seasonNumber != null ? normalized.seasonNumber : null,
                episodeNumber: normalized.episodeNumber != null ? normalized.episodeNumber : null
            };
        }

        if (typeof this.onSelectionChange === 'function') {
            this.onSelectionChange(this.getSelection());
        }
    }

    /**
     * Updates canonical selection with a partial patch while preserving media identity.
     * @param {Object} patch
     */
    updateSelection(patch) {
        if (!this.currentSelection) {
            if (patch) this.setSelection(patch);
            return;
        }
        const merged = {
            ...this.currentSelection,
            ...patch
        };
        this.setSelection(merged);
    }

    /**
     * Clears active canonical selection.
     */
    clearSelection() {
        this.currentSelection = null;
        this.currentTimestamp = 0;
        if (typeof this.onSelectionChange === 'function') {
            this.onSelectionChange(null);
        }
    }

    // ─── PlaybackRuntimeState Methods (Phase 3E) ──────────────────────

    /**
     * Returns a snapshot of the current live execution telemetry.
     * @returns {Object}
     */
    getRuntimeState() {
        return {
            ...this.runtimeState,
            mediaIdentity: {
                ...this.runtimeState.mediaIdentity
            }
        };
    }

    /**
     * Resets runtime telemetry to default state.
     * @param {Object} [options]
     */
    resetRuntimeState(options = {}) {
        this.runtimeState = createDefaultRuntime(options);
        this.lastProgressSaveTime = Date.now();
        this.hasCompletedCurrentSession = false;
        this.isSeeking = false;
        this._notifyRuntimeListeners();
    }

    /**
     * Updates live runtime telemetry if token and media identity match.
     * @param {Object} patch Telemetry patch
     * @param {number|null} [token] Mount generation token
     * @param {Object|null} [mediaIdentity] Associated media identity
     * @returns {boolean} True if update was committed; false if discarded as stale
     */
    updateRuntimeState(patch = {}, token = null, mediaIdentity = null) {
        // Discard stale events from superseded mounts (Part 18, 19)
        if (token !== null && token !== this.mountRequestId) {
            return false;
        }

        // Discard stale events with mismatched media identity (Part 20)
        if (mediaIdentity !== null && !isMediaMatching(this.runtimeState.mediaIdentity, mediaIdentity)) {
            return false;
        }

        Object.assign(this.runtimeState, patch);
        this.runtimeState.lastTelemetryAt = Date.now();

        if (typeof patch.currentTime === 'number' && !Number.isNaN(patch.currentTime)) {
            this.currentTimestamp = Math.floor(patch.currentTime);
        }

        this._notifyRuntimeListeners();
        return true;
    }

    /**
     * Subscribes a listener to live runtime telemetry updates.
     * @param {Function} listener
     * @returns {Function} Unsubscribe function
     */
    subscribeRuntime(listener) {
        if (typeof listener !== 'function') return () => {};
        this.runtimeListeners.add(listener);
        try {
            listener(this.getRuntimeState());
        } catch (e) {
            console.warn('[PlaybackController] Runtime listener error:', e);
        }
        return () => this.unsubscribeRuntime(listener);
    }

    /**
     * Removes a runtime telemetry subscriber.
     * @param {Function} listener
     */
    unsubscribeRuntime(listener) {
        this.runtimeListeners.delete(listener);
    }

    /**
     * Subscribes a listener to playback completion events.
     * @param {Function} listener
     * @returns {Function} Unsubscribe function
     */
    subscribeCompletion(listener) {
        if (typeof listener !== 'function') return () => {};
        this.completionListeners.add(listener);
        return () => this.unsubscribeCompletion(listener);
    }

    /**
     * Removes a playback completion subscriber.
     * @param {Function} listener
     */
    unsubscribeCompletion(listener) {
        this.completionListeners.delete(listener);
    }

    /**
     * Subscribes a listener to reliable ended events.
     * @param {Function} listener
     * @returns {Function} Unsubscribe function
     */
    subscribeEnded(listener) {
        if (typeof listener !== 'function') return () => {};
        this.endedListeners.add(listener);
        return () => this.unsubscribeEnded(listener);
    }

    /**
     * Removes a playback ended subscriber.
     * @param {Function} listener
     */
    unsubscribeEnded(listener) {
        this.endedListeners.delete(listener);
    }

    /**
     * Subscribes a listener to auto-next cancellation triggers (provider switch, close, nav, etc.).
     * @param {Function} listener
     * @returns {Function} Unsubscribe function
     */
    subscribeCancelAutoNext(listener) {
        if (typeof listener !== 'function') return () => {};
        this.cancelAutoNextListeners.add(listener);
        return () => this.unsubscribeCancelAutoNext(listener);
    }

    /**
     * Removes an auto-next cancellation subscriber.
     * @param {Function} listener
     */
    unsubscribeCancelAutoNext(listener) {
        this.cancelAutoNextListeners.delete(listener);
    }

    /**
     * Notifies all registered cancelAutoNext listeners.
     * @private
     */
    _notifyCancelAutoNext() {
        for (const listener of this.cancelAutoNextListeners) {
            try {
                listener();
            } catch (e) {
                console.warn('[PlaybackController] Error in cancelAutoNext listener:', e);
            }
        }
    }

    /**
     * Notifies all registered runtime listeners.
     * @private
     */
    _notifyRuntimeListeners() {
        const stateSnapshot = this.getRuntimeState();
        for (const listener of this.runtimeListeners) {
            try {
                listener(stateSnapshot);
            } catch (e) {
                console.warn('[PlaybackController] Error in runtime subscriber:', e);
            }
        }
        if (typeof this.onRuntimeChange === 'function') {
            try {
                this.onRuntimeChange(stateSnapshot);
            } catch (e) {
                console.warn('[PlaybackController] Error in onRuntimeChange handler:', e);
            }
        }
    }

    /**
     * Checks whether playback is completed and fires edge-triggered completion event.
     * @param {Object} runtime PlaybackRuntimeState snapshot
     * @param {number} token Mount request token
     * @param {Object} mediaIdentity Media identity
     * @private
     */
    _checkAndTriggerCompletion(runtime, token, mediaIdentity) {
        if (token !== this.mountRequestId) return;
        if (this.hasCompletedCurrentSession) return; // Edge-trigger: only once per episode mount

        const completed = checkPlaybackCompleted(runtime, { isSeeking: this.isSeeking });
        if (!completed) return;

        this.hasCompletedCurrentSession = true;

        const completionPayload = {
            movieId: mediaIdentity?.kinopoiskId != null ? mediaIdentity.kinopoiskId : null,
            seasonNumber: mediaIdentity?.seasonNumber != null ? mediaIdentity.seasonNumber : null,
            episodeNumber: mediaIdentity?.episodeNumber != null ? mediaIdentity.episodeNumber : null,
            duration: runtime.duration,
            timestamp: runtime.currentTime,
            providerId: runtime.providerId,
            progressConfidence: runtime.progressConfidence
        };

        for (const listener of this.completionListeners) {
            try {
                listener(completionPayload);
            } catch (e) {
                console.warn('[PlaybackController] Error in completion subscriber:', e);
            }
        }

        // Force immediate progress flush with completed: true
        this.flushProgress({ force: true, completed: true });

        // Phase 4C: Auto-write EpisodeHistory on RELIABLE completion only
        if (runtime.progressConfidence === 'RELIABLE' && mediaIdentity?.kinopoiskId && mediaIdentity?.seasonNumber != null && mediaIdentity?.episodeNumber != null) {
            if (this.episodeHistoryService && typeof this.episodeHistoryService.markCompleted === 'function') {
                this.episodeHistoryService.markCompleted(
                    mediaIdentity.kinopoiskId,
                    mediaIdentity.seasonNumber,
                    mediaIdentity.episodeNumber,
                    { source: 'AUTO_RELIABLE' }
                ).catch(err => {
                    console.warn('[PlaybackController] Failed to auto-write EpisodeHistory on completion:', err);
                });
            }
        }
    }

    // ─── Native Video Event Bridge (Phase 3E) ─────────────────────────

    /**
     * Attaches live playback DOM event listeners to a native <video> element.
     * @param {HTMLVideoElement} video
     * @param {number} token
     * @param {Object} selection
     * @param {Object} adapter
     * @private
     */
    _attachNativeVideoListeners(video, token, selection, adapter) {
        this._detachNativeVideoListeners();
        if (!video || typeof video.addEventListener !== 'function') return;

        this.activeVideoElement = video;
        this.hasCompletedCurrentSession = false;
        this.isSeeking = false;

        const mediaIdentity = {
            kinopoiskId: selection?.kinopoiskId != null ? selection.kinopoiskId : null,
            seasonNumber: selection?.seasonNumber != null ? selection.seasonNumber : null,
            episodeNumber: selection?.episodeNumber != null ? selection.episodeNumber : null
        };

        const addScopedListener = (type, handler) => {
            video.addEventListener(type, handler);
            this.videoEventListeners.push(() => {
                try {
                    video.removeEventListener(type, handler);
                } catch { /* ignore */ }
            });
        };

        // 1. loadedmetadata: Sets total duration and performs timestamp resume if supported
        addScopedListener('loadedmetadata', () => {
            if (this.mountRequestId !== token) return;
            const dur = typeof video.duration === 'number' && !Number.isNaN(video.duration) && video.duration >= 0
                ? video.duration
                : 0;

            this.updateRuntimeState({ duration: dur }, token, mediaIdentity);

            // Exact timestamp resume (Part 8, Part 9)
            if (selection && selection.initialTimestamp > 0 && adapter && typeof adapter.supportsTimestampResume === 'function' && adapter.supportsTimestampResume()) {
                const initialTs = selection.initialTimestamp;
                const safeTs = (dur > 10 && initialTs >= dur) ? Math.max(0, dur - 5) : initialTs;
                if (safeTs >= 0 && Math.abs((video.currentTime || 0) - safeTs) > 1) {
                    try {
                        video.currentTime = safeTs;
                    } catch (e) {
                        console.warn('[PlaybackController] Error restoring currentTime:', e);
                    }
                }
            }
        });

        // 2. timeupdate: Updates live currentTime, checks completion, and triggers 15-second write throttling
        addScopedListener('timeupdate', () => {
            if (this.mountRequestId !== token) return;
            const curTime = typeof video.currentTime === 'number' && !Number.isNaN(video.currentTime)
                ? video.currentTime
                : 0;
            const curDur = (typeof video.duration === 'number' && !Number.isNaN(video.duration) && video.duration >= 0)
                ? video.duration
                : (this.runtimeState.duration || 0);

            this.updateRuntimeState({
                currentTime: curTime,
                duration: curDur,
                isPlaying: !video.paused
            }, token, mediaIdentity);

            this._checkAndTriggerCompletion(this.getRuntimeState(), token, mediaIdentity);

            // 15-second write throttle (Part 11)
            const now = Date.now();
            if (now - this.lastProgressSaveTime >= this.PROGRESS_WRITE_THROTTLE_MS) {
                this.flushProgress({ force: false });
            }
        });

        // 3. play: Updates playback flags
        addScopedListener('play', () => {
            if (this.mountRequestId !== token) return;
            this.updateRuntimeState({
                isPlaying: true,
                isPaused: false,
                isEnded: false
            }, token, mediaIdentity);
        });

        // 4. pause: Updates playback flags and forces immediate progress flush
        addScopedListener('pause', () => {
            if (this.mountRequestId !== token) return;
            this.updateRuntimeState({
                isPlaying: false,
                isPaused: true
            }, token, mediaIdentity);
            this.flushProgress({ force: true });
        });

        // 5. ended: Updates playback flags, records completion, and forces immediate progress flush
        addScopedListener('ended', () => {
            if (this.mountRequestId !== token) return;
            const endDuration = video.duration || video.currentTime || 0;
            this.updateRuntimeState({
                isPlaying: false,
                isPaused: true,
                isEnded: true,
                currentTime: endDuration
            }, token, mediaIdentity);
            this._checkAndTriggerCompletion(this.getRuntimeState(), token, mediaIdentity);
            this.flushProgress({ force: true, completed: true });

            // Phase 3G: Notify ended subscribers
            for (const listener of this.endedListeners) {
                try {
                    listener({
                        selection: this.getSelection(),
                        runtime: this.getRuntimeState(),
                        token,
                        mediaIdentity: { ...mediaIdentity },
                        adapter
                    });
                } catch (e) {
                    console.warn('[PlaybackController] Error in ended listener:', e);
                }
            }
        });

        // 6. seeking / seeked: Reflects manual scrub position without forcing write storm
        addScopedListener('seeking', () => {
            if (this.mountRequestId !== token) return;
            this.isSeeking = true;
            this.updateRuntimeState({ currentTime: video.currentTime || 0 }, token, mediaIdentity);
        });

        addScopedListener('seeked', () => {
            if (this.mountRequestId !== token) return;
            this.isSeeking = false;
            this.updateRuntimeState({ currentTime: video.currentTime || 0 }, token, mediaIdentity);
            if (video.ended) {
                this._checkAndTriggerCompletion(this.getRuntimeState(), token, mediaIdentity);
            }
        });
    }

    /**
     * Detaches all video event listeners and cleans up native bridge.
     * @private
     */
    _detachNativeVideoListeners() {
        while (this.videoEventListeners.length > 0) {
            try {
                const disposer = this.videoEventListeners.pop();
                if (typeof disposer === 'function') disposer();
            } catch { /* ignore */ }
        }
        this.activeVideoElement = null;
    }

    /**
     * Flushes current in-memory progress to ProgressService.
     * Throttled to 15s during continuous playback unless force=true is passed.
     * @param {Object} [options]
     * @param {boolean} [options.force] Force write regardless of throttle
     * @param {boolean} [options.completed] Explicit completion flag
     * @returns {Promise<void>}
     */
    async flushProgress(options = {}) {
        // Do NOT write timestamp 0 for opaque providers (Part 15, Part 56)
        if (this.runtimeState.progressConfidence === 'OPAQUE') {
            return;
        }

        const targetMovieId = this.runtimeState.mediaIdentity.kinopoiskId || (this.currentSelection ? this.currentSelection.kinopoiskId : null);
        if (!targetMovieId || !this.progressService) {
            return;
        }

        const now = Date.now();
        if (!options.force && (now - this.lastProgressSaveTime < this.PROGRESS_WRITE_THROTTLE_MS)) {
            return;
        }

        this.lastProgressSaveTime = now;

        const sNum = this.runtimeState.mediaIdentity.seasonNumber;
        const eNum = this.runtimeState.mediaIdentity.episodeNumber;
        const timestamp = Math.floor(this.runtimeState.currentTime || 0);
        const isCompleted = options.completed !== undefined ? Boolean(options.completed) : Boolean(this.hasCompletedCurrentSession);

        const progressPayload = {
            season: sNum != null ? `${sNum} сезон` : null,
            episode: eNum != null ? `${eNum} серия` : null,
            timestamp,
            movieId: targetMovieId,
            movieTitle: this.currentSelection?.title || '',
            completed: isCompleted,
            providerId: this.runtimeState.providerId || null
        };

        if (this.runtimeState.duration > 0) {
            progressPayload.duration = Math.floor(this.runtimeState.duration);
        }

        try {
            await this.progressService.saveProgress(targetMovieId, progressPayload);
        } catch (e) {
            console.warn('[PlaybackController] Failed to flush progress:', e);
        }
    }

    // ─── Provider & Lifecycle Management ──────────────────────────────

    /**
     * Returns currently active provider ID.
     * @returns {string|null}
     */
    getActiveProvider() {
        return this.activeProviderId;
    }

    /**
     * Sets currently active provider ID.
     * @param {string|null} providerId
     */
    setActiveProvider(providerId) {
        this.activeProviderId = providerId ? providerId.replace(/^parser:/, '').toLowerCase() : null;
        this.activeAdapter = this.activeProviderId ? this.getAdapter(this.activeProviderId) : null;
    }

    /**
     * Applies a new selection to the active provider when that provider can do
     * so deterministically in-place. A structured result keeps the caller from
     * treating an opaque/native provider as if the selection was applied.
     * @param {Object} rawSelection
     * @param {Object} [options]
     * @returns {Promise<Object>}
     */
    async applySelection(rawSelection, options = {}) {
        const selection = normalizeSelection(rawSelection);
        const adapter = this.activeAdapter || this.getAdapter(this.activeProviderId);

        console.info('[ExFsBridgeTrace] controller applySelection entered', {
            providerId: this.activeProviderId,
            adapterId: adapter?.id || null,
            selection,
            selectionMode: typeof adapter?.getSelectionMode === 'function'
                ? adapter.getSelectionMode()
                : null,
            hasActiveMount: Boolean(this.activeMount),
            hasContainer: Boolean(this.container)
        });

        if (!selection || !adapter) {
            console.warn('[ExFsBridgeTrace] controller applySelection rejected', {
                reason: 'NO_ACTIVE_PROVIDER',
                selection
            });
            return {
                status: 'FAILED',
                reason: 'NO_ACTIVE_PROVIDER',
                selection: selection || null
            };
        }

        if (typeof adapter.canHandle === 'function' && !adapter.canHandle(selection)) {
            return {
                status: 'UNAVAILABLE',
                reason: 'PROVIDER_CANNOT_HANDLE_SELECTION',
                providerId: adapter.id,
                selection
            };
        }

        const canApply = typeof adapter.canApplySelection === 'function'
            ? adapter.canApplySelection(selection)
            : Boolean(adapter.supportsDirectSeasonEpisode?.());
        console.info('[ExFsBridgeTrace] controller capability result', {
            providerId: adapter.id,
            selectionMode: typeof adapter.getSelectionMode === 'function'
                ? adapter.getSelectionMode()
                : null,
            canApply,
            hasActiveContainer: Boolean(adapter.activeContainer),
            iframeCount: adapter.activeContainer?.querySelectorAll?.('iframe')?.length || 0
        });
        if (!canApply || typeof adapter.applySelection !== 'function') {
            console.info('[ExFsBridgeTrace] controller selection deferred', {
                providerId: adapter.id,
                reason: 'SELECTION_MODE_UNAVAILABLE'
            });
            return {
                status: typeof adapter.getSelectionMode === 'function'
                    && adapter.getSelectionMode() === 'NATIVE_BRIDGE'
                    ? 'PENDING_NATIVE_UI'
                    : 'UNAVAILABLE',
                reason: 'SELECTION_MODE_UNAVAILABLE',
                providerId: adapter.id,
                selection
            };
        }

        this.setSelection(selection);
        try {
            const applied = await adapter.applySelection(selection, {
                ...options,
                controller: this,
                providerId: adapter.id
            });
            console.info('[ExFsBridgeTrace] controller adapter result', {
                providerId: adapter.id,
                applied,
                selection
            });
            if (!applied) {
                return {
                    status: 'UNAVAILABLE',
                    reason: 'ADAPTER_DECLINED_SELECTION',
                    providerId: adapter.id,
                    selection
                };
            }

            this.runtimeState.mediaIdentity = {
                kinopoiskId: selection.kinopoiskId || null,
                seasonNumber: selection.seasonNumber != null ? selection.seasonNumber : null,
                episodeNumber: selection.episodeNumber != null ? selection.episodeNumber : null
            };
            this.currentTimestamp = selection.initialTimestamp || 0;
            this._notifyRuntimeListeners();
            return {
                status: typeof adapter.getSelectionMode === 'function'
                    && adapter.getSelectionMode() === 'NATIVE_BRIDGE'
                    ? 'PENDING_NATIVE_UI'
                    : 'APPLIED',
                providerId: adapter.id,
                selection: this.getSelection()
            };
        } catch (error) {
            console.warn('[PlaybackController] Failed to apply selection in-place:', error);
            return {
                status: 'FAILED',
                reason: error?.code || 'ADAPTER_APPLY_FAILED',
                providerId: adapter.id,
                selection,
                error
            };
        }
    }

    /**
     * Attaches container elements if not provided at construction.
     * @param {HTMLElement} container
     * @param {HTMLElement} [modal]
     */
    setContainer(container, modal = null) {
        this.container = container;
        if (modal) this.modal = modal;
    }

    /**
     * Primary entry point to initiate playback with a canonical PlaybackSelection.
     * @param {Object} rawSelection
     * @param {Object} [options]
     * @returns {Promise<Object>}
     */
    async play(rawSelection, options = {}) {
        const selection = normalizeSelection(rawSelection);
        this.setSelection(selection);

        const targetProvider = options.providerId || selection.providerId || this.activeProviderId || 'seasonvar';
        return this.switchProvider(targetProvider, {
            ...options,
            forceMount: true
        });
    }

    /**
     * Switches active provider while strictly preserving canonical season/episode state.
     * @param {string} providerId
     * @param {Object} [options]
     * @returns {Promise<Object>}
     */
    async switchProvider(providerId, options = {}) {
        if (!this.currentSelection) {
            const error = new Error('No active playback selection');
            error.code = 'INVALID_PLAYBACK_SELECTION';
            throw error;
        }

        const normalizedProviderId = (providerId || '').replace(/^parser:/, '').toLowerCase();
        const adapter = this.getAdapter(normalizedProviderId);

        if (!adapter) {
            const error = new Error(`Provider '${providerId}' is not registered`);
            error.code = 'PROVIDER_UNAVAILABLE';
            throw error;
        }

        // Check if provider can handle the current selection
        if (!adapter.canHandle(this.currentSelection)) {
            const error = new Error(`Provider '${adapter.label}' cannot handle mediaType '${this.currentSelection.mediaType}'`);
            error.code = 'PROVIDER_UNAVAILABLE';
            throw error;
        }

        // Immediately cancel any active auto-next countdown on provider switch (Phase 3G)
        this._notifyCancelAutoNext();

        // Flush active provider's progress before unmounting (Part 14)
        await this.flushProgress({ force: true });

        // Increment generation token for async race condition protection (Part 18)
        const currentToken = ++this.mountRequestId;

        // Update selection state with new provider ID and switch source
        this.updateSelection({
            providerId: adapter.id,
            source: options.isSwitch ? 'PROVIDER_SWITCH' : this.currentSelection.source
        });

        // Unmount previous active player before mounting new one (Part 19: Single active player invariant)
        this.unmountActive();

        this.activeProviderId = adapter.id;
        this.activeAdapter = adapter;
        this.isOpen = true;
        this.isMinimized = false;

        // Reset live telemetry state for the newly mounted provider (Part 3, Part 48)
        const progressConfidence = typeof adapter.getProgressConfidence === 'function'
            ? adapter.getProgressConfidence()
            : 'OPAQUE';
        const supportsTimestampResume = typeof adapter.supportsTimestampResume === 'function'
            ? adapter.supportsTimestampResume()
            : false;
        const supportsEnded = typeof adapter.supportsEnded === 'function'
            ? adapter.supportsEnded()
            : false;

        this.resetRuntimeState({
            providerId: adapter.id,
            progressConfidence,
            supportsTimestampResume,
            supportsEnded,
            mountToken: currentToken,
            mediaIdentity: {
                kinopoiskId: this.currentSelection?.kinopoiskId || null,
                seasonNumber: this.currentSelection?.seasonNumber != null ? this.currentSelection.seasonNumber : null,
                episodeNumber: this.currentSelection?.episodeNumber != null ? this.currentSelection.episodeNumber : null
            }
        });

        if (typeof this.onProviderChange === 'function') {
            this.onProviderChange(adapter.id);
        }

        if (typeof this.onStateChange === 'function') {
            this.onStateChange('loading', { providerId: adapter.id, selection: this.getSelection() });
        }

        try {
            const mountContext = {
                sources: options.sources || null,
                parser: options.parser || null,
                lifecycle: this.lifecycle,
                token: currentToken,
                onReady: () => {
                    if (this.mountRequestId === currentToken) {
                        if (typeof this.onStateChange === 'function') {
                            this.onStateChange('ready', { providerId: adapter.id, selection: this.getSelection() });
                        }
                    }
                },
                onError: (err) => {
                    if (this.mountRequestId === currentToken) {
                        if (typeof this.onStateChange === 'function') {
                            this.onStateChange('error', { providerId: adapter.id, error: err });
                        }
                    }
                }
            };

            const container = options.container || this.container;
            if (!container) {
                const error = new Error('PlaybackController: mount container not configured');
                error.code = 'PROVIDER_LOAD_FAILED';
                throw error;
            }

            const mountResult = await adapter.mount(container, this.currentSelection, mountContext);

            // Verify generation token has not been superseded by a newer request
            if (this.mountRequestId !== currentToken) {
                console.warn(`[PlaybackController] Stale mount request ${currentToken} discarded (current: ${this.mountRequestId})`);
                if (adapter && typeof adapter.unmount === 'function') {
                    adapter.unmount(mountContext);
                }
                const staleError = new Error('Playback request was superseded');
                staleError.code = 'STALE_PLAYBACK_REQUEST';
                throw staleError;
            }

            this.activeMount = mountResult;

            // Native Video Bridge: attach DOM event listeners if a native <video> element is mounted
            const video = mountResult?.element?.tagName === 'VIDEO'
                ? mountResult.element
                : (container ? container.querySelector('video') : null);

            if (video) {
                this._attachNativeVideoListeners(video, currentToken, this.currentSelection, adapter);
            }

            if (typeof this.onStateChange === 'function') {
                this.onStateChange('ready', { providerId: adapter.id, selection: this.getSelection() });
            }

            return mountResult;
        } catch (error) {
            if (this.mountRequestId === currentToken) {
                if (typeof this.onStateChange === 'function') {
                    this.onStateChange('error', { providerId: adapter.id, error });
                }
            }
            throw error;
        }
    }

    /**
     * Unmounts the current active player without clearing canonical selection.
     */
    unmountActive() {
        this._detachNativeVideoListeners();

        if (this.activeAdapter && typeof this.activeAdapter.unmount === 'function') {
            try {
                this.activeAdapter.unmount({ container: this.container });
            } catch (e) {
                console.warn('[PlaybackController] Error unmounting adapter:', e);
            }
        }
        if (this.container) {
            // Remove any leftover iframes or videos
            const iframes = this.container.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                try {
                    iframe.src = 'about:blank';
                    iframe.remove();
                } catch { /* ignore */ }
            });
            const videos = this.container.querySelectorAll('video');
            videos.forEach(video => {
                try {
                    video.pause();
                    video.src = '';
                    video.remove();
                } catch { /* ignore */ }
            });
        }
        this.activeMount = null;
    }

    /**
     * Minimizes player modal while preserving playback state.
     */
    minimize() {
        this.isMinimized = true;
        this._notifyCancelAutoNext();
        if (typeof this.onStateChange === 'function') {
            this.onStateChange('minimized', { selection: this.getSelection() });
        }
    }

    /**
     * Restores player modal from minimized state.
     */
    restore() {
        this.isMinimized = false;
        this.isOpen = true;
        if (typeof this.onStateChange === 'function') {
            this.onStateChange('restored', { selection: this.getSelection() });
        }
    }

    /**
     * Closes the active playback session (unmounts player and pauses media).
     */
    close() {
        this._notifyCancelAutoNext();
        this.flushProgress({ force: true });
        this.unmountActive();
        this.resetRuntimeState();
        this.isOpen = false;
        this.isMinimized = false;
        if (typeof this.onStateChange === 'function') {
            this.onStateChange('closed', { selection: this.getSelection() });
        }
    }

    /**
     * Full destruction of the controller and all registered adapter resources.
     */
    destroy() {
        this._notifyCancelAutoNext();
        this.flushProgress({ force: true });

        // Discard any in-flight mounts
        this.mountRequestId++;

        this.close();
        this.clearSelection();

        for (const adapter of this.adapters.values()) {
            if (typeof adapter.dispose === 'function') {
                try {
                    adapter.dispose();
                } catch (e) {
                    console.warn(`[PlaybackController] Error disposing adapter ${adapter.id}:`, e);
                }
            }
        }
        this.adapters.clear();
        this.runtimeListeners.clear();
        this.completionListeners.clear();
        this.endedListeners.clear();
        this.cancelAutoNextListeners.clear();

        // Clean up any orphan preload containers (Part 20)
        this.cleanupOrphanPreloadContainers();
    }

    /**
     * Cleans up orphaned player-preload DOM containers left in document.body.
     * @param {string|number} [currentMovieId] Optional movie ID to preserve; if omitted cleans all.
     */
    cleanupOrphanPreloadContainers(currentMovieId = null) {
        if (typeof document === 'undefined') return;
        const pattern = /^player-preload-(.+)-(.+)$/;
        const nodes = Array.from(document.querySelectorAll('[id^="player-preload-"]'));

        nodes.forEach(node => {
            const match = node.id.match(pattern);
            if (match) {
                const movieId = match[1];
                if (currentMovieId == null || String(movieId) !== String(currentMovieId)) {
                    try {
                        const video = node.querySelector('video');
                        if (video) {
                            video.pause();
                            video.src = '';
                        }
                        const iframe = node.querySelector('iframe');
                        if (iframe) {
                            iframe.src = 'about:blank';
                        }
                        node.remove();
                    } catch (e) {
                        console.warn('[PlaybackController] Error removing preload container:', e);
                    }
                }
            }
        });
    }

    /**
     * Handles progress update payload from player-cleaner or native video events.
     * Synchronizes canonical selection and stores to ProgressService.
     * @param {Object} data - { season, episode, timestamp, movieId }
     */
    handleProgressUpdate(data) {
        if (!data || typeof data !== 'object') return;

        let seasonNum = null;
        let episodeNum = null;

        // Parse season number from string like "2 сезон" or number 2
        if (data.season != null) {
            if (typeof data.season === 'number') {
                seasonNum = data.season;
            } else if (typeof data.season === 'string') {
                const match = data.season.match(/(\d+)/);
                if (match) seasonNum = parseInt(match[1], 10);
            }
        }

        // Parse episode number from string like "5 серия" or number 5
        if (data.episode != null) {
            if (typeof data.episode === 'number') {
                episodeNum = data.episode;
            } else if (typeof data.episode === 'string') {
                const match = data.episode.match(/(\d+)/);
                if (match) episodeNum = parseInt(match[1], 10);
            }
        }

        const timestamp = typeof data.timestamp === 'number' && !Number.isNaN(data.timestamp) && data.timestamp >= 0
            ? data.timestamp
            : 0;

        const incomingMovieId = data.movieId || (this.currentSelection ? this.currentSelection.kinopoiskId : null);
        if (data.movieId != null && this.currentSelection?.kinopoiskId != null) {
            if (Number(data.movieId) !== Number(this.currentSelection.kinopoiskId)) {
                return; // Discard progress from a different movie
            }
        }

        const effectiveSeasonNum = seasonNum != null ? seasonNum : this.runtimeState.mediaIdentity.seasonNumber;
        const effectiveEpisodeNum = episodeNum != null ? episodeNum : this.runtimeState.mediaIdentity.episodeNumber;

        const incomingIdentity = {
            kinopoiskId: incomingMovieId,
            seasonNumber: effectiveSeasonNum,
            episodeNumber: effectiveEpisodeNum
        };

        // Update runtime telemetry with PARTIAL confidence (Part 6, Part 21)
        this.updateRuntimeState({
            currentTime: timestamp,
            progressConfidence: 'PARTIAL',
            mediaIdentity: incomingIdentity
        }, null, null);

        if (this.currentSelection && this.currentSelection.mediaType !== 'movie') {
            const patch = { initialTimestamp: timestamp };
            if (seasonNum != null) patch.seasonNumber = seasonNum;
            if (episodeNum != null) patch.episodeNumber = episodeNum;
            this.updateSelection(patch);
        }

        // Persist to ProgressService if available
        const targetMovieId = data.movieId || (this.currentSelection ? this.currentSelection.kinopoiskId : null);
        if (this.progressService && targetMovieId) {
            const progressPayload = {
                season: data.season != null ? data.season : (seasonNum != null ? `${seasonNum} сезон` : null),
                episode: data.episode != null ? data.episode : (episodeNum != null ? `${episodeNum} серия` : null),
                timestamp,
                movieId: targetMovieId,
                movieTitle: this.currentSelection?.title || ''
            };
            if (this.runtimeState.duration > 0) {
                progressPayload.duration = Math.floor(this.runtimeState.duration);
            }
            this.progressService.saveProgress(targetMovieId, progressPayload).catch(e => {
                console.warn('[PlaybackController] Failed to persist progress:', e);
            });
        }
    }
}

if (typeof window !== 'undefined') {
    window.PlaybackController = PlaybackController;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PlaybackController };
}
