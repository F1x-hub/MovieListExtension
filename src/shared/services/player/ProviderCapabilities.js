/** A read-only view of existing adapter declarations, never a provider registry. */
(function (global) {
    'use strict';
    function call(owner, name, ...args) {
        try { return typeof owner?.[name] === 'function' ? owner[name](...args) : null; }
        catch { return null; }
    }
    function bool(owner, name, ...args) {
        const value = call(owner, name, ...args);
        return typeof value === 'boolean' ? value : null;
    }
    function positive(value) { return Number.isInteger(value) && value > 0; }
    function describe({ providerId = null, adapter = null, parser = null, selection = null, readiness = null } = {}) {
        const id = typeof providerId === 'string' ? providerId : typeof adapter?.id === 'string' ? adapter.id : null;
        // A mismatched adapter must not describe another source's capabilities.
        const active = adapter && (!id || !adapter.id || adapter.id === id) ? adapter : null;
        const mode = call(active, 'getSelectionMode');
        const confidence = call(active, 'getProgressConfidence');
        const state = typeof readiness === 'string' ? readiness : readiness?.state;
        const lifecycle = ['loading', 'ready', 'error', 'unavailable', 'cancelled'].includes(state) ? state : null;
        const titleIdentity = positive(selection?.kinopoiskId);
        const episodeIdentity = titleIdentity && positive(selection?.seasonNumber) && positive(selection?.episodeNumber);
        const exactIdentity = titleIdentity && (selection?.mediaType === 'movie' || episodeIdentity);
        const declared = Object.freeze({
            movies: bool(active, 'supportsMovies'), series: bool(active, 'supportsSeries'),
            directSeasonEpisode: bool(active, 'supportsDirectSeasonEpisode'),
            seasonDiscovery: bool(active, 'supportsSeasonDiscovery'), episodeDiscovery: bool(active, 'supportsEpisodeDiscovery'),
            episodePicker: bool(active, 'supportsEpisodePicker'), previousNext: bool(active, 'supportsPrevNext'),
            autoNext: bool(active, 'supportsAutoNext'), progress: bool(active, 'supportsProgressTracking'),
            duration: bool(active, 'supportsDuration'), ended: bool(active, 'supportsEnded'),
            timestampResume: bool(active, 'supportsTimestampResume'),
            selectionMode: ['DIRECT', 'NATIVE_BRIDGE', 'OPAQUE', 'UNAVAILABLE'].includes(mode) ? mode : null,
            progressConfidence: ['RELIABLE', 'PARTIAL', 'OPAQUE'].includes(confidence) ? confidence : null,
            // Existing parsers have no shared capability declarations for these.
            audioTracks: null, qualities: null, subtitles: null, linkExpiry: null, requiresReferer: null
        });
        return Object.freeze({
            providerId: id, declared,
            parserAvailable: parser != null || active?.parserService != null,
            readiness: lifecycle,
            // 'ready' is the existing lifecycle acknowledgement, not a codec/network guarantee.
            playable: lifecycle === 'ready' ? true : lifecycle === 'error' || lifecycle === 'unavailable' || lifecycle === 'cancelled' ? false : null,
            canHandleSelection: selection ? bool(active, 'canHandle', selection) : null,
            canApplySelection: selection ? bool(active, 'canApplySelection', selection) : null,
            identity: Object.freeze({ title: titleIdentity, episode: episodeIdentity, exact: exactIdentity }),
            // This gate is necessary, never sufficient: individual track identity and
            // synchronization must still be verified before controls are enabled.
            trackIdentityEligible: exactIdentity && lifecycle === 'ready'
        });
    }
    global.ProviderCapabilities = Object.freeze({ describe });
})(typeof window === 'undefined' ? globalThis : window);
