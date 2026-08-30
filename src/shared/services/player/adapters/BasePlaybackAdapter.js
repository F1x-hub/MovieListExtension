/**
 * BasePlaybackAdapter Contract.
 * Wraps existing parsers and streaming mechanisms under a unified interface.
 */
class BasePlaybackAdapter {
    /**
     * @param {string} id Unique provider ID
     * @param {string} label User-friendly label
     */
    constructor(id, label) {
        if (!id) throw new Error('BasePlaybackAdapter requires a valid id');
        this.id = id;
        this.label = label || id;
    }

    /**
     * Whether this adapter supports standalone movies.
     * @returns {boolean}
     */
    supportsMovies() {
        return true;
    }

    /**
     * Whether this adapter supports episodic TV series.
     * @returns {boolean}
     */
    supportsSeries() {
        return true;
    }

    /**
     * Whether this adapter can deterministically play an exact Season + Episode.
     * True for VidSrc and Seasonvar; False for Title-only balancers like KinoGo & Ex-FS.
     * @returns {boolean}
     */
    supportsDirectSeasonEpisode() {
        return false;
    }

    /**
     * Describes how an exact season/episode selection can be applied.
     * DIRECT is handled by the adapter itself; OPAQUE means the provider
     * owns the selection UI and no host-side application is promised yet.
     * @returns {'DIRECT'|'NATIVE_BRIDGE'|'OPAQUE'|'UNAVAILABLE'}
     */
    getSelectionMode() {
        if (this.supportsDirectSeasonEpisode()) return 'DIRECT';
        if (this.supportsProviderInternalSelection()) return 'OPAQUE';
        return 'UNAVAILABLE';
    }

    /**
     * Whether this adapter can apply the exact selection through the host
     * contract without guessing or silently falling back to another source.
     * @param {Object} selection Canonical PlaybackSelection
     * @returns {boolean}
     */
    canApplySelection(selection) {
        const mode = this.getSelectionMode();
        if (mode === 'NATIVE_BRIDGE') {
            const iframe = this.activeContainer?.querySelector?.(
                'iframe[data-player-source-active="true"]'
            ) || this.activeContainer?.querySelector?.('iframe');
            const result = Boolean(
                selection
                && this.canHandle(selection)
                && iframe
            );
            console.info('[ExFsBridgeTrace] adapter canApplySelection', {
                adapterId: this.id,
                mode,
                selection,
                hasActiveContainer: Boolean(this.activeContainer),
                iframeCount: this.activeContainer?.querySelectorAll?.('iframe')?.length || 0,
                iframeSrc: iframe?.src || iframe?.getAttribute?.('src') || null,
                result
            });
            return result;
        }
        return Boolean(
            selection
            && this.canHandle(selection)
            && mode === 'DIRECT'
        );
    }

    /**
     * Whether this adapter supports the host compact episode picker popover.
     * @returns {boolean}
     */
    supportsEpisodePicker() {
        return this.supportsDirectSeasonEpisode();
    }

    /**
     * Whether this adapter discovers and exposes season lists from provider API/HTML.
     * @returns {boolean}
     */
    supportsSeasonDiscovery() {
        return false;
    }

    /**
     * Whether this adapter discovers and exposes episode lists from provider API/HTML.
     * @returns {boolean}
     */
    supportsEpisodeDiscovery() {
        return false;
    }

    /**
     * Whether the host can execute adjacent-episode navigation for this provider.
     * This is intentionally separate from season metadata availability.
     * @returns {boolean}
     */
    supportsPrevNext() {
        return this.supportsDirectSeasonEpisode();
    }

    /**
     * Whether the host may automatically advance after reliable completion.
     * @returns {boolean}
     */
    supportsAutoNext() {
        return this.supportsDirectSeasonEpisode()
            && this.supportsEnded()
            && this.getProgressConfidence() === 'RELIABLE';
    }

    /**
     * Whether season/episode is selected inside provider's own UI iframe (title-only balancers).
     * @returns {boolean}
     */
    supportsProviderInternalSelection() {
        return this.supportsTitleOnlyPlayback();
    }

    /**
     * Whether this adapter only searches by title without deterministic host S/E addressing.
     * @returns {boolean}
     */
    supportsTitleOnlyPlayback() {
        return !this.supportsDirectSeasonEpisode();
    }

    /**
     * Applies a new canonical selection to the active player without full unmount when supported.
     * @param {Object} selection Canonical PlaybackSelection
     * @param {Object} context
     * @returns {Promise<boolean>} True if applied in-place, false if full remount is required
     */
    async applySelection(selection, context = {}) {
        if (this.getSelectionMode() !== 'NATIVE_BRIDGE') return false;
        const iframe = this.activeContainer?.querySelector?.(
            'iframe[data-player-source-active="true"]'
        ) || this.activeContainer?.querySelector?.('iframe');
        if (!iframe?.contentWindow || !selection) {
            console.warn('[ExFsBridgeTrace] adapter bridge unavailable', {
                adapterId: this.id,
                hasIframe: Boolean(iframe),
                hasContentWindow: Boolean(iframe?.contentWindow),
                selection
            });
            return false;
        }

        const requestId = `selection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const timeoutMs = context.timeoutMs || 5000;
        console.info('[ExFsBridgeTrace] adapter bridge request', {
            adapterId: this.id,
            requestId,
            iframeSrc: iframe.src || iframe.getAttribute?.('src') || null,
            seasonNumber: selection.seasonNumber,
            episodeNumber: selection.episodeNumber,
            timeoutMs
        });
        return new Promise(resolve => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                window.removeEventListener('message', onMessage);
                clearTimeout(timeout);
                resolve(value);
            };
            const onMessage = event => {
                const data = event?.data;
                if (!data || data.type !== 'PLAYBACK_SELECTION_RESULT' || data.requestId !== requestId) return;
                console.info('[ExFsBridgeTrace] adapter bridge result received', {
                    adapterId: this.id,
                    requestId,
                    status: data.status,
                    reason: data.reason || null,
                    seasonNumber: data.seasonNumber,
                    episodeNumber: data.episodeNumber,
                    messageOrigin: event.origin || null
                });
                finish(data.status === 'DISPATCHED' || data.status === 'APPLIED');
            };
            const timeout = setTimeout(() => {
                console.warn('[ExFsBridgeTrace] adapter bridge timeout', {
                    adapterId: this.id,
                    requestId,
                    seasonNumber: selection.seasonNumber,
                    episodeNumber: selection.episodeNumber
                });
                finish(false);
            }, timeoutMs);
            window.addEventListener('message', onMessage);
            iframe.contentWindow.postMessage({
                type: 'APPLY_PLAYBACK_SELECTION',
                requestId,
                providerId: this.id,
                seasonNumber: selection.seasonNumber,
                episodeNumber: selection.episodeNumber
            }, '*');
            console.info('[ExFsBridgeTrace] adapter bridge postMessage sent', {
                adapterId: this.id,
                requestId
            });
        });
    }

    /**
     * Whether this adapter provides reliable continuous progress tracking.
     * @returns {boolean}
     */
    supportsProgressTracking() {
        return false;
    }

    /**
     * Whether this adapter provides total media duration.
     * @returns {boolean}
     */
    supportsDuration() {
        return false;
    }

    /**
     * Whether this adapter reliably receives media playback completion / ended events.
     * @returns {boolean}
     */
    supportsEnded() {
        return false;
    }

    /**
     * Whether this adapter can seek to and resume from an exact timestamp.
     * @returns {boolean}
     */
    supportsTimestampResume() {
        return false;
    }

    /**
     * Returns progress tracking confidence level for this provider:
     * 'RELIABLE' | 'PARTIAL' | 'OPAQUE'
     * @returns {string}
     */
    getProgressConfidence() {
        return 'OPAQUE';
    }

    /**
     * Declares whether this provider has completed the stricter watch-room
     * verification. Providers are deliberately opt-in: ordinary playback
     * capability, an iframe mount, or a matching duration is not enough to
     * synchronize a room timeline.
     *
     * @returns {{observeTime: boolean, play: boolean, pause: boolean, seek: boolean, duration: boolean, lockGuestTimeline: boolean}}
     */
    getRoomSyncCapabilities() {
        return {
            observeTime: false,
            play: false,
            pause: false,
            seek: false,
            duration: false,
            lockGuestTimeline: false
        };
    }

    /**
     * Checks if this adapter can fulfill the requested selection.
     * @param {Object} selection Canonical PlaybackSelection
     * @returns {boolean}
     */
    canHandle(selection) {
        if (!selection) return false;
        const isSeries = selection.mediaType !== 'movie';
        if (isSeries && !this.supportsSeries()) return false;
        if (!isSeries && !this.supportsMovies()) return false;
        return true;
    }

    /**
     * Mounts the player inside the container element.
     * @param {HTMLElement} container
     * @param {Object} selection Canonical PlaybackSelection
     * @param {Object} context Lifecycle & execution context
     * @returns {Promise<Object>} Object containing mounted element details
     */
    async mount(container, selection, context = {}) {
        throw new Error(`mount() not implemented on adapter ${this.id}`);
    }

    /**
     * Unmounts and detaches active player resources.
     * @param {Object} context
     */
    unmount(context = {}) {
        // Default no-op
    }

    /**
     * Disposes of any persistent background resources or caches.
     */
    dispose() {
        // Default no-op
    }
}

if (typeof window !== 'undefined') {
    window.BasePlaybackAdapter = BasePlaybackAdapter;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BasePlaybackAdapter };
}
