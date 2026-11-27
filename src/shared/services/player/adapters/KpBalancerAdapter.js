/**
 * Playback adapter for the balancers that are asked by Kinopoisk ID (KpBalancerParser).
 * Collaps and Alloha open the same frames as Ex-FS and KinoGo, so the host picker
 * reaches their season and episode menus through the native bridge. Veoveo's frame
 * has no extension scripts in it: the provider owns everything inside.
 */
const KP_BALANCER_ADAPTERS = Object.freeze({
    collaps: Object.freeze({ label: 'Collaps', bridge: true }),
    alloha: Object.freeze({ label: 'Alloha', bridge: true }),
    veoveo: Object.freeze({ label: 'Veoveo', bridge: false })
});

class KpBalancerAdapter extends (typeof BasePlaybackAdapter !== 'undefined' ? BasePlaybackAdapter : (typeof require !== 'undefined' ? require('./BasePlaybackAdapter').BasePlaybackAdapter : Object)) {
    /** @param {'collaps'|'alloha'|'veoveo'} balancerId */
    constructor(balancerId, parserService = null) {
        const balancer = KP_BALANCER_ADAPTERS[balancerId];
        if (!balancer) throw new Error(`Unknown balancer: ${balancerId}`);
        super(balancerId, balancer.label);
        this.bridge = balancer.bridge;
        this.parserService = parserService;
        this.activeContainer = null;
    }

    static get IDS() {
        return Object.keys(KP_BALANCER_ADAPTERS);
    }

    supportsMovies() {
        return true;
    }

    supportsSeries() {
        return true;
    }

    supportsDirectSeasonEpisode() {
        return false; // The address names the title; the episode is chosen inside the frame.
    }

    getSelectionMode() {
        return this.bridge ? 'NATIVE_BRIDGE' : 'OPAQUE';
    }

    supportsEpisodePicker() {
        return this.bridge;
    }

    supportsPrevNext() {
        return this.bridge;
    }

    /** Every one of these frames lists the seasons and episodes itself, with or without the bridge. */
    hasOwnEpisodeList() {
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
        return this.bridge; // PARTIAL: via player-cleaner in the balancer frame
    }

    supportsDuration() {
        return this.bridge;
    }

    supportsEnded() {
        return this.bridge;
    }

    supportsTimestampResume() {
        return false;
    }

    getProgressConfidence() {
        return this.bridge ? 'PARTIAL' : 'OPAQUE';
    }

    /**
     * Alloha's frame is opened on an episode by its address (KpBalancerParser.getFrameUrl).
     * Steering it to another one through its menu is not reliable: after a season change
     * the menu drops to the first episode and reports that as the viewer's move. Declining
     * here makes the page open the frame again on the new episode.
     */
    async applySelection(selection, context = {}) {
        if (this.id === 'alloha' && !this._frameOpenedOn(selection)) return false;
        return super.applySelection(selection, context);
    }

    /** @private */
    _frameOpenedOn(selection) {
        const iframe = this.activeContainer?.querySelector?.('iframe[data-player-source-active="true"]')
            || this.activeContainer?.querySelector?.('iframe');
        try {
            const params = new URL(iframe.src || iframe.getAttribute('src')).searchParams;
            return Number(params.get('season')) === Number(selection?.seasonNumber)
                && Number(params.get('episode')) === Number(selection?.episodeNumber);
        } catch {
            return false;
        }
    }

    getParser(context = {}) {
        if (this.parserService) return this.parserService;
        if (context.parser) return context.parser;
        if (typeof window !== 'undefined' && window.parserRegistry) {
            return window.parserRegistry.get(this.id);
        }
        return null;
    }

    async mount(container, selection, context = {}) {
        if (!container) throw new Error('KpBalancerAdapter.mount: container is required');
        const parser = this.getParser(context);
        if (!parser) {
            const error = new Error(`${this.label} parser service unavailable`);
            error.code = 'PROVIDER_UNAVAILABLE';
            throw error;
        }

        this.activeContainer = container;

        let sources = context.sources || null;
        if (!sources || sources.length === 0) {
            try {
                let target = /^https:\/\//.test(selection.sourceUrl || '') ? selection.sourceUrl : null;
                // The balancer is asked by the title's Kinopoisk ID, never by its name.
                target ||= await parser.cachedSearch(selection.title || '', null, {
                    kinopoiskId: selection.kinopoiskId,
                    mediaType: selection.mediaType || null
                });
                if (target) sources = await parser.cachedVideoSources(target);
            } catch (err) {
                console.warn(`[KpBalancerAdapter] ${this.label} lookup failed during mount:`, err);
            }
        }

        if (!sources || sources.length === 0) {
            const error = new Error(`No ${this.label} video sources found`);
            error.code = 'PROVIDER_LOAD_FAILED';
            throw error;
        }

        const renderResult = await parser.renderPlayer(container, sources, {
            movieId: selection.kinopoiskId,
            mediaType: selection.mediaType,
            season: selection.seasonNumber ?? null,
            episode: selection.episodeNumber ?? null,
            initialTimestamp: selection.initialTimestamp || 0,
            onReady: context.onReady,
            onError: context.onError
        });

        return {
            element: renderResult || container.querySelector('iframe, video'),
            type: 'iframe',
            providerId: this.id,
            rawSources: sources
        };
    }

    unmount() {
        if (!this.activeContainer) return;
        const iframe = this.activeContainer.querySelector('iframe');
        if (iframe) {
            try {
                iframe.src = 'about:blank';
            } catch (e) {
                console.warn('[KpBalancerAdapter] Error unmounting iframe:', e);
            }
        }
        this.activeContainer.innerHTML = '';
        this.activeContainer = null;
    }
}

if (typeof window !== 'undefined') {
    window.KpBalancerAdapter = KpBalancerAdapter;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KpBalancerAdapter };
}
