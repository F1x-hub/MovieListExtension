/**
 * KinoGo Playback Adapter.
 * Title-only embed iframe balancer wrapper.
 */
class KinogoAdapter extends (typeof BasePlaybackAdapter !== 'undefined' ? BasePlaybackAdapter : (typeof require !== 'undefined' ? require('./BasePlaybackAdapter').BasePlaybackAdapter : Object)) {
    constructor(parserService = null) {
        super('kinogo', 'KinoGo');
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
        return false; // TITLE_ONLY: Balancer embeds do not accept external S/E deep linking
    }

    getSelectionMode() {
        return 'NATIVE_BRIDGE';
    }

    supportsNativeBridgeSource(sourceUrl = null) {
        const value = String(sourceUrl || '').trim();
        // No iframe yet means the provider is still mounting. Do not hide the
        // host controls during that short loading window.
        if (!value || value.startsWith('parser:')) return true;
        return /(?:stravers\.live|allarknow\.online)/i.test(value);
    }

    supportsEpisodePicker() {
        return true;
    }

    supportsPrevNext() {
        // KinoGo exposes exact season/episode controls in the provider DOM;
        // the native bridge can reuse them for canonical adjacent navigation.
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
        return true; // PARTIAL: via player-cleaner content script on matching balancer domains
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
            return window.parserRegistry.get('kinogo');
        }
        return null;
    }

    /**
     * KinoGo exposes its real season/episode selectors only on the verified
     * Stravers/Allarknow balancers. Prefer those embeds for series so the
     * canonical host picker has a provider DOM to control. Other balancers may
     * still be returned for diagnostics, but they are not canonical bridge targets.
     * @param {Array<Object>} sources
     * @param {Object} selection
     * @returns {Array<Object>}
     */
    orderSourcesForNativeBridge(sources, selection) {
        if (!Array.isArray(sources) || sources.length < 2
            || selection?.mediaType === 'movie') {
            return Array.isArray(sources) ? sources : [];
        }

        const isBridgeCompatible = source => /(?:stravers\.live|allarknow\.online)/i
            .test(String(source?.url || ''));
        const preferred = sources.find(isBridgeCompatible);
        if (!preferred) return sources;

        return [preferred, ...sources.filter(source => source !== preferred)];
    }

    async mount(container, selection, context = {}) {
        if (!container) throw new Error('KinogoAdapter.mount: container is required');
        const parser = this.getParser(context);
        if (!parser) {
            const error = new Error('KinoGo parser service unavailable');
            error.code = 'PROVIDER_UNAVAILABLE';
            throw error;
        }

        this.activeContainer = container;

        console.log('[KinogoSearchTrace] adapter mount input', {
            title: selection.title || null,
            mediaType: selection.mediaType || null,
            kinopoiskId: selection.kinopoiskId || null,
            sourceUrl: selection.sourceUrl || null,
            contextSourceCount: Array.isArray(context.sources) ? context.sources.length : 0
        });

        let sources = context.sources || null;
        if (!sources || sources.length === 0) {
            let targetUrl = selection.sourceUrl || null;
            if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
                const searchTitle = selection.title || '';
                if (searchTitle && typeof parser.search === 'function') {
                    try {
                        const searchResult = await parser.search(searchTitle, null, {
                            mediaType: selection.mediaType || null,
                            seasonNumber: selection.seasonNumber ?? null
                        });
                        const normalizedResult = Array.isArray(searchResult)
                            ? searchResult[0]
                            : searchResult;
                        console.log('[KinogoSearchTrace] adapter parser result received', {
                            resultShape: Array.isArray(searchResult) ? 'array' : typeof searchResult,
                            resultCount: Array.isArray(searchResult) ? searchResult.length : (searchResult ? 1 : 0),
                            title: normalizedResult?.title || null,
                            url: normalizedResult?.url || null,
                            detectedType: normalizedResult?.type || null,
                            year: normalizedResult?.year || null,
                            requestedMediaType: selection.mediaType || null
                        });
                        if (normalizedResult?.url) {
                            targetUrl = normalizedResult.url;
                            console.log('[KinogoSearchTrace] adapter selected target URL', {
                                targetUrl,
                                detectedType: normalizedResult.type || null,
                                requestedMediaType: selection.mediaType || null
                            });
                        } else {
                            console.warn('[KinogoSearchTrace] adapter received no usable search URL', {
                                requestedTitle: searchTitle,
                                requestedMediaType: selection.mediaType || null
                            });
                        }
                    } catch (err) {
                        console.warn('[KinogoSearchTrace] adapter search failed', {
                            title: searchTitle,
                            mediaType: selection.mediaType || null,
                            message: err.message
                        });
                        console.warn('[KinogoAdapter] Search failed during mount:', err);
                    }
                } else if (searchTitle && typeof parser.getVideoSources === 'function') {
                    console.log('[KinogoSearchTrace] adapter using title as fallback source input', {
                        title: searchTitle,
                        mediaType: selection.mediaType || null
                    });
                    targetUrl = searchTitle;
                }
            }

            if (targetUrl) {
                console.log('[KinogoSearchTrace] adapter requesting video sources', {
                    targetUrl,
                    mediaType: selection.mediaType || null
                });
                try {
                    sources = await parser.getVideoSources(targetUrl);
                    console.log('[KinogoSearchTrace] adapter video sources received', {
                        targetUrl,
                        sourceCount: Array.isArray(sources) ? sources.length : 0,
                        mediaType: selection.mediaType || null
                    });
                } catch (err) {
                    console.warn('[KinogoSearchTrace] adapter getVideoSources failed', {
                        targetUrl,
                        message: err.message
                    });
                    console.warn('[KinogoAdapter] getVideoSources failed during mount:', err);
                }
            }
        }

        if (!sources || sources.length === 0) {
            const error = new Error('No KinoGo video sources found');
            error.code = 'PROVIDER_LOAD_FAILED';
            throw error;
        }

        const orderedSources = this.orderSourcesForNativeBridge(sources, selection);
        console.info('[KinogoSearchTrace] adapter source order', {
            mediaType: selection.mediaType || null,
            nativeBridgePreferred: orderedSources[0]?.url || null,
            sources: orderedSources.map(source => source?.url || null)
        });

        const renderOptions = {
            movieId: selection.kinopoiskId,
            mediaType: selection.mediaType,
            initialTimestamp: selection.initialTimestamp || 0,
            onReady: context.onReady,
            onError: context.onError
        };

        const renderResult = await parser.renderPlayer(container, orderedSources, renderOptions);

        return {
            element: renderResult || container.querySelector('iframe, video'),
            type: 'iframe',
            providerId: this.id,
            rawSources: orderedSources
        };
    }

    unmount(context = {}) {
        if (this.activeContainer) {
            const iframe = this.activeContainer.querySelector('iframe');
            if (iframe) {
                try {
                    iframe.src = 'about:blank';
                } catch (e) {
                    console.warn('[KinogoAdapter] Error unmounting iframe:', e);
                }
            }
            this.activeContainer.innerHTML = '';
            this.activeContainer = null;
        }
    }
}

if (typeof window !== 'undefined') {
    window.KinogoAdapter = KinogoAdapter;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KinogoAdapter };
}
