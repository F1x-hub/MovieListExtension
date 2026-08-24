/**
 * Seasonvar Playback Adapter.
 * Wraps SeasonvarParser for direct MP4 playlist extraction and native video rendering.
 */
class SeasonvarAdapter extends (typeof BasePlaybackAdapter !== 'undefined' ? BasePlaybackAdapter : (typeof require !== 'undefined' ? require('./BasePlaybackAdapter').BasePlaybackAdapter : Object)) {
    constructor(parserService = null) {
        super('seasonvar', 'Seasonvar');
        this.parserService = parserService;
        this.activeContainer = null;
    }

    supportsMovies() {
        return false;
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

    supportsSeasonDiscovery() {
        return true;
    }

    supportsEpisodeDiscovery() {
        return true;
    }

    supportsPrevNext() {
        return true;
    }

    supportsAutoNext() {
        return true;
    }

    supportsTitleOnlyPlayback() {
        return false;
    }

    supportsProviderInternalSelection() {
        return false;
    }

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

    canHandle(selection) {
        if (!super.canHandle(selection)) return false;
        return selection.mediaType !== 'movie';
    }

    getParser(context = {}) {
        if (this.parserService) return this.parserService;
        if (context.parser) return context.parser;
        if (typeof window !== 'undefined' && window.parserRegistry) {
            return window.parserRegistry.get('seasonvar');
        }
        return null;
    }

    async applySelection(selection, context = {}) {
        if (!this.activeContainer || !selection) return false;
        const parser = this.getParser(context);
        if (!parser) return false;

        const currentState = this.activeContainer.__seasonvarPlaybackState;
        if (!currentState) return false;

        const targetSeason = selection.seasonNumber || 1;
        const targetEpisode = selection.episodeNumber || 1;

        // If target season is already active in structured state, update video stream in-place
        if (currentState.activeSeasonNumber === targetSeason && currentState.episodes?.length) {
            const ep = currentState.episodes.find(e => e.episodeNumber === targetEpisode)
                || currentState.episodes[targetEpisode - 1];
            if (ep?.url) {
                const video = this.activeContainer.querySelector('video');
                if (video) {
                    parser._isEpisodeSwitch = true;
                    video.src = ep.url;
                    currentState.activeEpisodeNumber = targetEpisode;
                    currentState.activeEpisodeUrl = ep.url;
                    try {
                        window.postMessage(currentState, '*');
                    } catch {
                        // ignore
                    }
                    video.load();
                    video.play().catch(() => {});
                    return true;
                }
            }
        }
        return false;
    }

    async mount(container, selection, context = {}) {
        if (!container) throw new Error('SeasonvarAdapter.mount: container is required');
        const parser = this.getParser(context);
        if (!parser) {
            const error = new Error('Seasonvar parser service unavailable');
            error.code = 'PROVIDER_UNAVAILABLE';
            throw error;
        }

        this.activeContainer = container;

        let sources = context.sources || null;
        if (!sources || sources.length === 0) {
            let targetUrl = selection.seasonUrl || selection.sourceUrl || null;
            if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
                // Search Seasonvar by title to get canonical search results with absolute URLs
                const searchTitle = selection.title || '';
                if (searchTitle && typeof parser.search === 'function') {
                    try {
                        const searchResults = await parser.search(searchTitle, selection.kinopoiskId);
                        if (searchResults && searchResults.length > 0 && searchResults[0].url) {
                            targetUrl = searchResults[0].url;
                        }
                    } catch (err) {
                        console.warn('[SeasonvarAdapter] Search failed during mount:', err);
                    }
                } else if (searchTitle && typeof parser.getVideoSources === 'function') {
                    targetUrl = searchTitle;
                }
            }

            if (targetUrl) {
                try {
                    sources = await parser.getVideoSources(targetUrl);
                } catch (err) {
                    console.warn('[SeasonvarAdapter] getVideoSources failed during mount:', err);
                }
            }
        }

        if (!sources || sources.length === 0) {
            const error = new Error('No Seasonvar video sources found');
            error.code = 'PROVIDER_LOAD_FAILED';
            throw error;
        }

        const renderOptions = {
            movieId: selection.kinopoiskId,
            mediaType: selection.mediaType,
            season: selection.seasonNumber,
            episode: selection.episodeNumber,
            resolvedSeasonUrl: selection.seasonUrl || null,
            resolvedSeasonNumber: selection.seasonNumber || null,
            resolvedEpisodeNumber: selection.episodeNumber || null,
            initialTimestamp: selection.initialTimestamp || 0,
            onReady: context.onReady,
            onError: context.onError
        };

        const renderResult = await parser.renderPlayer(container, sources, renderOptions);

        return {
            element: renderResult || container.querySelector('video'),
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
                    video.load();
                } catch (e) {
                    console.warn('[SeasonvarAdapter] Error unmounting video:', e);
                }
            }
            this.activeContainer.innerHTML = '';
            this.activeContainer = null;
        }
    }
}

if (typeof window !== 'undefined') {
    window.SeasonvarAdapter = SeasonvarAdapter;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SeasonvarAdapter };
}
