/**
 * AnimeGo Playback Adapter.
 * AnimeGo lists every episode with its own embeds, so an exact episode can be
 * addressed directly. While the resolved Kodik stream plays in the
 * extension's player, a new episode is swapped into the same video in place;
 * otherwise (iframe fallback) the host remounts the source.
 */
class AnimeGoAdapter extends (typeof BasePlaybackAdapter !== 'undefined' ? BasePlaybackAdapter : (typeof require !== 'undefined' ? require('./BasePlaybackAdapter').BasePlaybackAdapter : Object)) {
    constructor(parserService = null) {
        super('animego', 'AnimeGo');
        this.parserService = parserService;
        this.activeContainer = null;
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

    getSelectionMode() {
        return 'DIRECT';
    }

    supportsEpisodePicker() {
        return true;
    }

    supportsPrevNext() {
        return true;
    }

    supportsSeasonDiscovery() {
        return false;
    }

    supportsEpisodeDiscovery() {
        return true;
    }

    supportsTitleOnlyPlayback() {
        return false;
    }

    supportsProviderInternalSelection() {
        return false;
    }

    // The resolved Kodik stream plays in the extension's own <video>, so
    // position, duration and the end of an episode are observed directly
    // (MovieDetails attaches PlaybackController tracking to that video).
    // The iframe fallback reports nothing and therefore never fires them.

    supportsProgressTracking() {
        return true;
    }

    supportsDuration() {
        return true;
    }

    supportsEnded() {
        return true;
    }

    supportsTimestampResume() {
        return true;
    }

    getProgressConfidence() {
        return 'RELIABLE';
    }

    /**
     * Opt-in for MovieDetails: a manually mounted AnimeGo player applies a new
     * selection through applySelection() before falling back to a remount.
     * @returns {boolean}
     */
    supportsInPlaceSelection() {
        return true;
    }

    getParser(context = {}) {
        if (this.parserService) return this.parserService;
        if (context.parser) return context.parser;
        if (typeof window !== 'undefined' && window.parserRegistry) {
            return window.parserRegistry.get('animego');
        }
        return null;
    }

    /**
     * Swap the requested episode into the mounted native player.
     * @returns {Promise<boolean>} false when the host must remount instead
     */
    async applySelection(selection, context = {}) {
        if (!this.activeContainer || !selection || selection.episodeNumber == null) return false;
        const parser = this.getParser(context);
        if (typeof parser?.applyEpisodeSelection !== 'function') return false;
        try {
            return await parser.applyEpisodeSelection(this.activeContainer, selection);
        } catch (error) {
            console.warn('[AnimeGoAdapter] In-place episode switch failed:', error);
            return false;
        }
    }

    async mount(container, selection, context = {}) {
        if (!container) throw new Error('AnimeGoAdapter.mount: container is required');
        const parser = this.getParser(context);
        if (!parser) {
            const error = new Error('AnimeGo parser service unavailable');
            error.code = 'PROVIDER_UNAVAILABLE';
            throw error;
        }

        this.activeContainer = container;

        let sources = context.sources || null;
        if (!sources || sources.length === 0) {
            const title = selection.title || '';
            if (title && typeof parser.cachedSearch === 'function') {
                const result = await parser.cachedSearch(title, selection.year || null, {
                    mediaType: selection.mediaType || null,
                    seasonNumber: selection.seasonNumber ?? null
                });
                if (result) sources = await parser.cachedVideoSources(result);
            }
        }

        if (!sources || sources.length === 0) {
            const error = new Error('No AnimeGo sources found');
            error.code = 'PROVIDER_LOAD_FAILED';
            throw error;
        }

        const rendered = await parser.renderPlayer(container, sources, {
            movieId: selection.kinopoiskId,
            mediaType: selection.mediaType,
            season: selection.seasonNumber ?? null,
            episode: selection.episodeNumber ?? null,
            resolvedSeasonNumber: selection.seasonNumber ?? null,
            resolvedEpisodeNumber: selection.episodeNumber ?? null,
            resolvedTimestamp: selection.initialTimestamp || 0
        });
        if (!rendered) {
            const error = new Error('AnimeGo player could not be mounted');
            error.code = 'PROVIDER_LOAD_FAILED';
            throw error;
        }

        const video = container.querySelector('video');
        return {
            element: video || container.querySelector('iframe'),
            type: video ? 'video' : 'iframe',
            providerId: this.id,
            rawSources: sources
        };
    }

    unmount() {
        if (!this.activeContainer) return;
        const video = this.activeContainer.querySelector('video');
        if (video) {
            try {
                video._movieExtensionHls?.destroy?.();
                video.pause();
                video.removeAttribute('src');
                video.load();
            } catch (error) {
                console.warn('[AnimeGoAdapter] Error unmounting video:', error);
            }
        }
        this.activeContainer.innerHTML = '';
        this.activeContainer = null;
    }
}

if (typeof window !== 'undefined') {
    window.AnimeGoAdapter = AnimeGoAdapter;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AnimeGoAdapter };
}
