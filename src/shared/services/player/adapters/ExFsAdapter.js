/**
 * Ex-FS Playback Adapter.
 * Title-only scraper wrapper.
 */
class ExFsAdapter extends (typeof BasePlaybackAdapter !== 'undefined' ? BasePlaybackAdapter : (typeof require !== 'undefined' ? require('./BasePlaybackAdapter').BasePlaybackAdapter : Object)) {
    constructor(parserService = null) {
        super('exfs', 'Ex-FS');
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
        return false; // TITLE_ONLY
    }

    getSelectionMode() {
        return 'NATIVE_BRIDGE';
    }

    supportsEpisodePicker() {
        return true;
    }

    supportsPrevNext() {
        // The native bridge can now execute exact adjacent S/E clicks without
        // claiming direct URL addressing or enabling AutoNext.
        return true;
    }

    supportsSeasonDiscovery() {
        return false;
    }

    supportsEpisodeDiscovery() {
        return false;
    }

    supportsTitleOnlyPlayback() {
        return true;
    }

    supportsProviderInternalSelection() {
        return true;
    }

    supportsProgressTracking() {
        return true; // PARTIAL: via player-cleaner on supported balancer mirrors
    }

    supportsDuration() {
        return true; // PARTIAL
    }

    supportsEnded() {
        return true; // PARTIAL
    }

    supportsTimestampResume() {
        return false;
    }

    getProgressConfidence() {
        return 'PARTIAL';
    }

    getParser(context = {}) {
        if (this.parserService) return this.parserService;
        if (context.parser) return context.parser;
        if (typeof window !== 'undefined' && window.parserRegistry) {
            return window.parserRegistry.get('exfs');
        }
        return null;
    }

    async mount(container, selection, context = {}) {
        if (!container) throw new Error('ExFsAdapter.mount: container is required');
        const parser = this.getParser(context);
        if (!parser) {
            const error = new Error('Ex-FS parser service unavailable');
            error.code = 'PROVIDER_UNAVAILABLE';
            throw error;
        }

        this.activeContainer = container;

        let sources = context.sources || null;
        if (!sources || sources.length === 0) {
            let targetUrl = selection.sourceUrl || null;
            if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
                const searchTitle = selection.title || '';
                if (searchTitle && typeof parser.search === 'function') {
                    try {
                        const searchResults = await parser.search(searchTitle, selection.kinopoiskId);
                        if (searchResults && searchResults.length > 0 && searchResults[0].url) {
                            targetUrl = searchResults[0].url;
                        }
                    } catch (err) {
                        console.warn('[ExFsAdapter] Search failed during mount:', err);
                    }
                } else if (searchTitle && typeof parser.getVideoSources === 'function') {
                    targetUrl = searchTitle;
                }
            }

            if (targetUrl) {
                try {
                    sources = await parser.getVideoSources(targetUrl);
                } catch (err) {
                    console.warn('[ExFsAdapter] getVideoSources failed during mount:', err);
                }
            }
        }

        if (!sources || sources.length === 0) {
            const error = new Error('No Ex-FS video sources found');
            error.code = 'PROVIDER_LOAD_FAILED';
            throw error;
        }

        const renderOptions = {
            movieId: selection.kinopoiskId,
            mediaType: selection.mediaType,
            initialTimestamp: selection.initialTimestamp || 0,
            onReady: context.onReady,
            onError: context.onError
        };

        const renderResult = await parser.renderPlayer(container, sources, renderOptions);

        return {
            element: renderResult || container.querySelector('iframe, video'),
            type: 'video',
            providerId: this.id,
            rawSources: sources
        };
    }

    unmount(context = {}) {
        if (this.activeContainer) {
            const video = this.activeContainer.querySelector('video');
            if (video) {
                try {
                    video.pause();
                    video.src = '';
                } catch (e) {
                    console.warn('[ExFsAdapter] Error unmounting video:', e);
                }
            }
            const iframe = this.activeContainer.querySelector('iframe');
            if (iframe) {
                try {
                    iframe.src = 'about:blank';
                } catch (e) {
                    console.warn('[ExFsAdapter] Error unmounting iframe:', e);
                }
            }
            this.activeContainer.innerHTML = '';
            this.activeContainer = null;
        }
    }
}

if (typeof window !== 'undefined') {
    window.ExFsAdapter = ExFsAdapter;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ExFsAdapter };
}
