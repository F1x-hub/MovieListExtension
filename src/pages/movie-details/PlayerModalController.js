/**
 * MovieDetailsPlayerModal - owns the visible state of the player dialog:
 * open, minimized (restore dock), PiP-hidden, hidden, and focus hand-off.
 *
 * Playback lifecycle (sources, registry, torrent, HLS) stays in MovieDetails;
 * this controller only receives a pausePlayback() callback for minimizing.
 *
 * States:
 *   hidden     - dialog display:none
 *   open       - dialog shown, body scroll locked
 *   minimized  - dialog hidden behind the restore dock, playback paused
 *   pip        - dialog hidden while the video plays picture-in-picture
 */
class MovieDetailsPlayerModal {
    constructor({
        getModal,
        getRestoreDock = () => null,
        getCloseButton = () => null,
        getRestoreTitle = () => '',
        openDialog = null,
        closeDialog = null,
        pausePlayback = async () => ({ success: false, reason: 'no_player_found' })
    } = {}) {
        if (typeof getModal !== 'function') throw new TypeError('PlayerModal needs getModal()');
        this.getModal = getModal;
        this.getRestoreDock = getRestoreDock;
        this.getCloseButton = getCloseButton;
        this.getRestoreTitle = getRestoreTitle;
        this.openDialog = openDialog;
        this.closeDialog = closeDialog;
        this.pausePlayback = pausePlayback;
    }

    get panel() {
        return this.getModal()?.querySelector?.('.modal') || null;
    }

    setBodyLocked(locked) {
        if (typeof document === 'undefined') return;
        document.body?.classList?.[locked ? 'add' : 'remove']('player-modal-open');
    }

    isMinimized() {
        return Boolean(this.getModal()?.classList?.contains('minimized-overlay'));
    }

    /** Shown means visible to the user: not hidden and not minimized/PiP. */
    isShown() {
        const modal = this.getModal();
        return Boolean(modal) && modal.style.display !== 'none' && !this.isMinimized();
    }

    open() {
        const modal = this.getModal();
        if (!modal) return;
        if (this.openDialog) this.openDialog(modal);
        else modal.style.display = 'flex';
        this.setBodyLocked(true);
    }

    async minimize({ pause = true } = {}) {
        const modal = this.getModal();
        if (!modal) return;
        if (pause) {
            try {
                const result = await this.pausePlayback();
                if (result && !result.success && !['already_paused', 'no_player_found'].includes(result.reason)) {
                    console.warn('[PlayerModal] Pause was not confirmed before minimizing:', result.reason);
                }
            } catch (error) {
                console.warn('[PlayerModal] Pause failed before minimizing:', error);
            }
        }
        // Keep keyboard focus reachable: it moves to the restore dock when it was inside the dialog.
        const hadFocus = typeof document !== 'undefined' && Boolean(modal.contains?.(document.activeElement));
        modal.classList.add('minimized-overlay');
        this.setBodyLocked(false);
        // PiP keeps playing, so its dialog is hidden without the paused look.
        this.panel?.classList.toggle('minimized', pause);
        this.panel?.classList.toggle('pip-hidden', !pause);
        this.showRestoreDock();
        if (hadFocus) this.getRestoreDock()?.querySelector?.('.restore-player-btn__main')?.focus?.();
    }

    restore() {
        const modal = this.getModal();
        if (!modal) return;
        modal.classList.remove('minimized-overlay');
        this.panel?.classList.remove('minimized', 'pip-hidden');
        this.setBodyLocked(true);
        this.getCloseButton()?.focus?.();
        this.hideRestoreDock();
    }

    /** Fully hides the dialog; MovieDetails tears playback down separately. */
    hide({ restoreFocus = false } = {}) {
        const modal = this.getModal();
        if (!modal) return;
        modal.classList.remove('minimized-overlay');
        this.panel?.classList.remove('minimized', 'pip-hidden');
        if (restoreFocus && this.closeDialog) this.closeDialog(modal);
        else modal.style.display = 'none';
        this.setBodyLocked(false);
        this.hideRestoreDock();
    }

    showRestoreDock() {
        const dock = this.getRestoreDock();
        if (!dock) return;
        dock.style.display = 'flex';
        const title = this.getRestoreTitle();
        const titleElement = dock.querySelector?.('.restore-title');
        if (titleElement && title) titleElement.textContent = title;
    }

    hideRestoreDock() {
        const dock = this.getRestoreDock();
        if (dock) dock.style.display = 'none';
    }
}

if (typeof window !== 'undefined') {
    window.MovieDetailsPlayerModal = MovieDetailsPlayerModal;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MovieDetailsPlayerModal };
}
