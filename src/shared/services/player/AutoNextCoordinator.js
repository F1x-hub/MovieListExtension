/**
 * AutoNextCoordinator.
 * Owns the capability-gated Auto-Next prompt and countdown lifecycle for MovieDetails player.
 * Strictly decoupled from general page rendering.
 */

const canAutoNextCheck = typeof canAutoNext !== 'undefined'
    ? canAutoNext
    : (typeof require !== 'undefined' ? require('./PlaybackRuntime').canAutoNext : () => false);

const resolveAdjacentHelper = typeof resolveAdjacentEpisode !== 'undefined'
    ? resolveAdjacentEpisode
    : (typeof require !== 'undefined' ? require('./PlaybackSelection').resolveAdjacentEpisode : () => null);

const normalizeSelectionHelper = typeof normalizePlaybackSelection !== 'undefined'
    ? normalizePlaybackSelection
    : (typeof require !== 'undefined' ? require('./PlaybackSelection').normalizePlaybackSelection : (s) => s);

class AutoNextCoordinator {
    /**
     * @param {Object} options
     * @param {Object} [options.playbackController] PlaybackController instance
     * @param {Function} [options.onPlayNext] Callback to execute playback for target selection
     * @param {Function} [options.resolveNextEpisode] Custom resolver for next episode
     * @param {Object} [options.elements] UI elements
     */
    constructor(options = {}) {
        this.playbackController = options.playbackController || null;
        this.onPlayNext = options.onPlayNext || null;
        this.resolveNextEpisode = options.resolveNextEpisode || resolveAdjacentHelper;

        this.elements = {
            promptEl: options.elements?.promptEl || null,
            countdownTextEl: options.elements?.countdownTextEl || null,
            targetTitleEl: options.elements?.targetTitleEl || null,
            playNowBtn: options.elements?.playNowBtn || null,
            cancelBtn: options.elements?.cancelBtn || null
        };

        this.COUNTDOWN_SECONDS = 10;
        this.timerId = null;

        this.state = {
            active: false,
            remainingSeconds: 0,
            targetSelection: null,
            sourceMediaIdentity: null,
            sourceMountToken: 0
        };

        this._boundPlayNow = this.playNow.bind(this);
        this._boundCancel = this.cancel.bind(this);

        this._setupElementListeners();
    }

    /**
     * Binds DOM elements to the coordinator.
     * @param {Object} elements
     */
    bindElements(elements = {}) {
        this._removeElementListeners();
        this.elements = {
            promptEl: elements.promptEl || null,
            countdownTextEl: elements.countdownTextEl || null,
            targetTitleEl: elements.targetTitleEl || null,
            playNowBtn: elements.playNowBtn || null,
            cancelBtn: elements.cancelBtn || null
        };
        this._setupElementListeners();
    }

    _setupElementListeners() {
        if (this.elements.playNowBtn) {
            this.elements.playNowBtn.addEventListener('click', this._boundPlayNow);
        }
        if (this.elements.cancelBtn) {
            this.elements.cancelBtn.addEventListener('click', this._boundCancel);
        }
    }

    _removeElementListeners() {
        if (this.elements.playNowBtn) {
            this.elements.playNowBtn.removeEventListener('click', this._boundPlayNow);
        }
        if (this.elements.cancelBtn) {
            this.elements.cancelBtn.removeEventListener('click', this._boundCancel);
        }
    }

    /**
     * Returns current coordinator state.
     * @returns {Object}
     */
    getState() {
        return {
            active: this.state.active,
            remainingSeconds: this.state.remainingSeconds,
            targetSelection: this.state.targetSelection ? { ...this.state.targetSelection } : null,
            sourceMediaIdentity: this.state.sourceMediaIdentity ? { ...this.state.sourceMediaIdentity } : null,
            sourceMountToken: this.state.sourceMountToken
        };
    }

    /**
     * Checks eligibility and triggers the auto-next prompt countdown if valid.
     * @param {Object} params
     * @param {Object} params.movie
     * @param {Object} params.selection
     * @param {Object} params.runtime
     * @param {Object} [params.adapter]
     * @param {number} [params.mountToken]
     * @param {Object} [params.options]
     * @returns {boolean} Whether prompt was started
     */
    handlePlaybackEnded(params = {}) {
        const { movie, selection, runtime, adapter, mountToken, options } = params;
        if (!movie || !selection || !runtime) return false;

        const currentToken = typeof mountToken === 'number' ? mountToken : (this.playbackController?.mountRequestId || 0);

        // Resolve next episode
        const resolver = this.resolveNextEpisode || resolveAdjacentHelper;
        const nextCandidate = resolver(movie, selection, 'next', options || {});

        // Check eligibility
        const eligible = canAutoNextCheck({
            selection,
            runtime,
            providerCapabilities: adapter || (this.playbackController ? this.playbackController.getAdapter(selection.providerId) : null),
            nextEpisode: nextCandidate
        });

        if (!eligible || !nextCandidate) {
            return false;
        }

        // Build target PlaybackSelection
        const targetSelection = normalizeSelectionHelper({
            kinopoiskId: selection.kinopoiskId,
            tmdbId: selection.tmdbId,
            imdbId: selection.imdbId,
            title: selection.title,
            mediaType: selection.mediaType,
            seasonNumber: nextCandidate.seasonNumber,
            episodeNumber: nextCandidate.episodeNumber,
            episodeTitle: nextCandidate.episodeTitle || null,
            providerId: selection.providerId,
            sourceUrl: null,
            source: 'AUTO_NEXT',
            initialTimestamp: 0
        });

        const sourceMediaIdentity = {
            kinopoiskId: selection.kinopoiskId,
            seasonNumber: selection.seasonNumber,
            episodeNumber: selection.episodeNumber
        };

        this.startPrompt(targetSelection, sourceMediaIdentity, currentToken);
        return true;
    }

    /**
     * Starts the 10-second countdown prompt.
     * @param {Object} targetSelection
     * @param {Object} sourceMediaIdentity
     * @param {number} sourceMountToken
     */
    startPrompt(targetSelection, sourceMediaIdentity, sourceMountToken = 0) {
        this.cancel(); // Cancel any existing timer first

        this.state = {
            active: true,
            remainingSeconds: this.COUNTDOWN_SECONDS,
            targetSelection,
            sourceMediaIdentity,
            sourceMountToken
        };

        this._renderPromptUI();

        // 1-second interval timer
        this.timerId = setInterval(() => {
            this.state.remainingSeconds -= 1;
            if (this.state.remainingSeconds <= 0) {
                this.playNow();
            } else {
                this._renderPromptUI();
            }
        }, 1000);
    }

    /**
     * Immediately plays target next episode and closes prompt.
     */
    playNow() {
        if (!this.state.active) return;

        const target = this.state.targetSelection;
        const sourceIdent = this.state.sourceMediaIdentity;
        const sourceToken = this.state.sourceMountToken;

        this.cancel();

        if (!target) return;

        // Revalidate against controller state to prevent stale firing
        if (this.playbackController) {
            const currentSel = this.playbackController.getSelection();
            const currentToken = this.playbackController.mountRequestId;
            if (sourceToken > 0 && currentToken !== sourceToken) {
                console.warn('[AutoNextCoordinator] Stale mount token detected, aborting auto-play');
                return;
            }
            if (currentSel && sourceIdent) {
                if (currentSel.kinopoiskId !== sourceIdent.kinopoiskId ||
                    currentSel.seasonNumber !== sourceIdent.seasonNumber ||
                    currentSel.episodeNumber !== sourceIdent.episodeNumber) {
                    console.warn('[AutoNextCoordinator] Selection changed since ended event, aborting auto-play');
                    return;
                }
            }
        }

        if (typeof this.onPlayNext === 'function') {
            this.onPlayNext(target);
        } else if (this.playbackController && typeof this.playbackController.play === 'function') {
            this.playbackController.play(target);
        }
    }

    /**
     * Cancels countdown and hides prompt.
     */
    cancel() {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }

        this.state.active = false;
        this.state.remainingSeconds = 0;
        this.state.targetSelection = null;
        this.state.sourceMediaIdentity = null;
        this.state.sourceMountToken = 0;

        this._hidePromptUI();
    }

    _renderPromptUI() {
        if (!this.elements.promptEl) return;

        this.elements.promptEl.style.display = 'flex';

        if (this.elements.countdownTextEl) {
            this.elements.countdownTextEl.textContent = `Следующая серия через ${this.state.remainingSeconds} сек`;
        }

        if (this.elements.targetTitleEl && this.state.targetSelection) {
            const s = this.state.targetSelection.seasonNumber;
            const e = this.state.targetSelection.episodeNumber;
            const title = this.state.targetSelection.episodeTitle;
            let label = `S${s}E${e}`;
            if (title) {
                label += ` · ${title}`;
            }
            this.elements.targetTitleEl.textContent = label;
        }
    }

    _hidePromptUI() {
        if (this.elements.promptEl) {
            this.elements.promptEl.style.display = 'none';
        }
    }

    /**
     * Cleans up listeners and timers.
     */
    destroy() {
        this.cancel();
        this._removeElementListeners();
    }
}

if (typeof window !== 'undefined') {
    window.AutoNextCoordinator = AutoNextCoordinator;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        AutoNextCoordinator
    };
}
