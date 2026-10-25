/**
 * VidSrc Playback Adapter.
 * Direct URL template generator with deterministic Season/Episode deep-linking.
 */
class VidSrcAdapter extends (typeof BasePlaybackAdapter !== 'undefined' ? BasePlaybackAdapter : (typeof require !== 'undefined' ? require('./BasePlaybackAdapter').BasePlaybackAdapter : Object)) {
    constructor() {
        super('vidsrc', 'VidSrc');
        this.BASE_URL = 'https://vidsrc-embed.ru/embed';
    }

    supportsMovies() {
        return true;
    }

    supportsSeries() {
        return true;
    }

    supportsDirectSeasonEpisode() {
        return true;
    }

    supportsBroadcastSelection(selection) {
        // The embed URL carries canonical season=0 without coercing it to season 1.
        return Number.isInteger(selection.seasonNumber) && selection.seasonNumber >= 0
            && Number.isInteger(selection.episodeNumber) && selection.episodeNumber >= 1;
    }

    getSelectionMode() {
        return 'DIRECT';
    }

    supportsEpisodePicker() {
        return true;
    }

    supportsSeasonDiscovery() {
        return false;
    }

    supportsEpisodeDiscovery() {
        return false;
    }

    supportsPrevNext() {
        return true;
    }

    // Cross-origin iframe telemetry is opaque; direct URLs do not prove ended state.
    supportsAutoNext() {
        return false;
    }

    supportsTitleOnlyPlayback() {
        return false;
    }

    supportsProviderInternalSelection() {
        return false;
    }

    supportsProgressTracking() {
        return false;
    }

    supportsDuration() {
        return false;
    }

    supportsEnded() {
        return false;
    }

    supportsTimestampResume() {
        return false;
    }

    getProgressConfidence() {
        return 'OPAQUE';
    }

    canHandle(selection) {
        if (!super.canHandle(selection)) return false;
        return Boolean(selection.imdbId);
    }

    async applySelection(selection, context = {}) {
        if (!this.activeIframe || !selection) return false;
        const newUrl = this.buildUrl(selection);
        if (!newUrl) return false;
        this.activeIframe.src = newUrl;
        return true;
    }

    buildUrl(selection) {
        if (!selection || !selection.imdbId) return null;
        const imdbId = selection.imdbId;
        const isSeries = selection.mediaType !== 'movie';

        if (isSeries) {
            const season = selection.seasonNumber != null ? selection.seasonNumber : 1;
            const episode = selection.episodeNumber != null ? selection.episodeNumber : 1;
            return `${this.BASE_URL}/tv?imdb=${encodeURIComponent(imdbId)}&season=${season}&episode=${episode}&autoplay=1`;
        }

        return `${this.BASE_URL}/movie?imdb=${encodeURIComponent(imdbId)}&autoplay=1`;
    }

    async mount(container, selection, context = {}) {
        if (!container) throw new Error('VidSrcAdapter.mount: container is required');
        const url = this.buildUrl(selection);
        if (!url) {
            const error = new Error('IMDb ID is required for VidSrc playback');
            error.code = 'PROVIDER_UNAVAILABLE';
            throw error;
        }

        const iframe = document.createElement('iframe');
        iframe.src = url;
        const sandbox = typeof window !== 'undefined'
            ? window.MovieDetailsPlayerSurface?.getProviderSandbox?.(url) : null;
        if (sandbox) iframe.setAttribute('sandbox', sandbox);
        iframe.setAttribute('allow', 'autoplay; fullscreen');
        iframe.setAttribute('allowfullscreen', 'true');
        iframe.className = 'player-surface__content';
        iframe.setAttribute('data-provider-id', this.id);
        if (iframe.dataset) iframe.dataset.providerId = this.id;

        if (context.lifecycle && typeof context.lifecycle.watchIframe === 'function') {
            context.lifecycle.watchIframe(iframe, {
                onLoad: () => {
                    if (typeof context.onReady === 'function') context.onReady();
                },
                onError: (err) => {
                    if (typeof context.onError === 'function') context.onError(err);
                }
            });
        }

        container.appendChild(iframe);
        this.activeIframe = iframe;

        return {
            element: iframe,
            type: 'iframe',
            url,
            providerId: this.id
        };
    }

    unmount(context = {}) {
        // A stale mount owns only its returned iframe, even when this adapter
        // has already mounted a newer request into the same container.
        const iframe = context.element || this.activeIframe;
        if (iframe) {
            try {
                iframe.src = 'about:blank';
                if (iframe.parentNode) {
                    iframe.parentNode.removeChild(iframe);
                }
            } catch (e) {
                console.warn('[VidSrcAdapter] Error during unmount:', e);
            }
            if (this.activeIframe === iframe) this.activeIframe = null;
        }
    }
}

if (typeof window !== 'undefined') {
    window.VidSrcAdapter = VidSrcAdapter;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VidSrcAdapter };
}
