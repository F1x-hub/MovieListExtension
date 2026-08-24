/**
 * SeasonvarParser - Parser for seasonvar.ru series source.
 * Searches for series and extracts video player sources / playlists.
 * Parser for seasonvar.ru streaming source.
 * 
 * @extends BaseParserService
 */
class SeasonvarParser extends (typeof BaseParserService !== 'undefined' ? BaseParserService : (typeof require !== 'undefined' ? require('./BaseParserService').BaseParserService : Object)) {
    constructor() {
        super({
            id: 'seasonvar',
            name: 'Seasonvar',
            baseUrl: 'http://seasonvar.ru'
        });
        this.searchUrl = 'http://seasonvar.ru/search';
        this.selectionRequestId = 0;
        this.renderRequestId = 0;
        this.pageCache = new Map();
        this.pageInFlight = new Map();
        this.seriesInfoCache = new Map();
        this.seriesInfoInFlight = new Map();
        this.seasonsCache = new Map();
        this.seasonsInFlight = new Map();
        this.maxDiscoveryCacheEntries = 50;
    }

    beginSelectionRequest() {
        this.selectionRequestId += 1;
        return this.selectionRequestId;
    }

    isSelectionRequestCurrent(requestId) {
        return requestId === this.selectionRequestId;
    }

    normalizePageUrl(url) {
        try {
            const normalized = new URL(url, this.baseUrl);
            normalized.hash = '';
            return normalized.toString();
        } catch {
            return String(url || '');
        }
    }

    rememberDiscoveryValue(cache, key, value) {
        if (cache.has(key)) cache.delete(key);
        cache.set(key, { value, timestamp: Date.now() });
        while (cache.size > this.maxDiscoveryCacheEntries) cache.delete(cache.keys().next().value);
    }

    getCachedDiscoveryValue(cache, key) {
        const cached = cache.get(key);
        if (!cached || Date.now() - cached.timestamp >= this.cacheTTL) return null;
        cache.delete(key);
        cache.set(key, cached);
        return cached.value;
    }

    async getSeasonvarPage(url, purpose = 'pageDiscovery') {
        const key = this.normalizePageUrl(url);
        const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
        const cached = this.getCachedDiscoveryValue(this.pageCache, key);
        if (cached) {
            perf?.recordCall('SEASONVAR_PAGE', { cacheHit: true });
            return cached;
        }
        const pending = this.pageInFlight.get(key);
        if (pending) {
            perf?.recordCall('SEASONVAR_PAGE', { inFlightDedupHit: true });
            return pending;
        }
        perf?.recordCall('SEASONVAR_PAGE');
        const request = (async () => {
            const response = perf
                ? await perf.trackRequest('SEASONVAR_DETAIL', { purpose, url: key }, () => fetch(key))
                : await fetch(key);
            if (!response.ok) throw new Error('Failed to load series page');
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const page = { url: key, html, doc };
            this.rememberDiscoveryValue(this.pageCache, key, page);
            return page;
        })();
        this.pageInFlight.set(key, request);
        try {
            return await request;
        } finally {
            if (this.pageInFlight.get(key) === request) this.pageInFlight.delete(key);
        }
    }

    async getCachedDiscovery(cache, inFlight, url, purpose, loader) {
        const key = this.normalizePageUrl(url);
        const cached = this.getCachedDiscoveryValue(cache, key);
        if (cached) return cached;
        const pending = inFlight.get(key);
        if (pending) return pending;
        const request = (async () => {
            const value = await loader(key, purpose);
            this.rememberDiscoveryValue(cache, key, value);
            return value;
        })();
        inFlight.set(key, request);
        try {
            return await request;
        } finally {
            if (inFlight.get(key) === request) inFlight.delete(key);
        }
    }

    clearCache() {
        super.clearCache();
        this.pageCache.clear();
        this.pageInFlight.clear();
        this.seriesInfoCache.clear();
        this.seriesInfoInFlight.clear();
        this.seasonsCache.clear();
        this.seasonsInFlight.clear();
    }

    // ─── BaseParserService Contract ───────────────────────────────────

    /**
     * Search for a series by title (and optionally year).
     * @param {string} title - Series title
     * @param {string|number|null} [year] - Release year (unused by Seasonvar, kept for interface compliance)
     * @returns {Promise<SearchResult|null>} Best matching result
     */
    async search(title, year, options = {}) {
        console.log(`[DEBUG SeasonvarParser] search() called. title: "${title}", year: ${year}`);
        try {
            const url = `${this.searchUrl}?q=${encodeURIComponent(title)}`;
            const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
            const response = perf
                ? await perf.trackRequest('SEASONVAR_SEARCH', { purpose: 'search', url }, () => fetch(url))
                : await fetch(url);
            
            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const html = await response.text();
            const results = this.parseSearchResults(html);

            if (!results || results.length === 0) return null;

            const best = this.selectBestSearchResult(results, title, options?.altName, year);
            if (!best) return null;

            best.parserId = this.id;
            console.log(`[DEBUG SeasonvarParser] search result: url=${best.url?.substring(0,80)}, title=${best.title}`);
            return best;

        } catch (error) {
            console.error(`[${this.name}] Search error:`, error);
            return null;
        }
    }

    /**
     * Get video sources (episodes) from a search result.
     * @param {SearchResult} searchResult - Result from search()
     * @returns {Promise<Array<VideoSource>>}
     */
    async getVideoSources(searchResult) {
        try {
            const rawUrl = typeof searchResult === 'string' ? searchResult : (searchResult?.url || '');
            if (!rawUrl || typeof rawUrl !== 'string' || (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://'))) {
                throw new Error(`[SeasonvarParser] getVideoSources requires an absolute http/https URL, received: "${rawUrl}"`);
            }
            const url = rawUrl;
            console.log('=== ДИАГНОСТИКА СЕЗОНОВ (getVideoSources) ===');
            console.log('URL:', url);
            
            const seriesInfo = await this.getSeriesInfo(url, 'getVideoSources');
            
            // Try to get seasons info too, to attach if needed (though existing architecture might unlikely use it yet)
            let seasons = [];
            try {
                 seasons = await this.getSeasons(url, 'getVideoSources');
            } catch (e) {
                 console.warn('Failed to fetch seasons in getVideoSources', e);
            }

            console.log('Полученные данные о сериале (seriesInfo):', seriesInfo);
            console.log('Количество найденных сезонов (getSeasons):', seasons ? seasons.length : 0);
            console.log('Массив сезонов:', seasons);

            if (!seriesInfo || !seriesInfo.episodes || seriesInfo.episodes.length === 0) {
                return [];
            }

            // Convert episodes to VideoSource format
            const videoSources = seriesInfo.episodes.map(ep => ({
                name: ep.title,
                url: ep.url,
                type: 'video',
                subtitle: ep.subtitle || null
            }));
            return videoSources;
        } catch (error) {
            console.error(`[${this.name}] getVideoSources error:`, error);
            throw error;
        }
    }

    /**
     * Return player type — Seasonvar uses a custom player with episode selector.
     * @returns {'custom'}
     */
    getPlayerType() {
        return 'custom';
    }

    /**
     * Seasonvar only has series, cartoons, and anime — no movies.
     * @returns {Array<string>}
     */
    getSupportedTypes() {
        return ['tv-series', 'mini-series', 'cartoon', 'animated-series', 'anime', 'tv-show'];
    }

    /**
     * Pure helper to extract episode number from a source object or title string.
     * Supports formats like "1 серия", "3 сезон - 3 серия", "Серия 3", "3".
     * @param {Object|string} source
     * @returns {number|null}
     */
    static extractEpisodeNumber(source) {
        if (!source) return null;
        const label = typeof source === 'string'
            ? source
            : (source.name || source.title || source.label || '');
        if (!label) return null;

        // Check if label contains "сезон ... серия" e.g. "1 сезон - 3 серия" or "3 сезон, 2 серия"
        const seasonEpMatch = label.match(/(?:сезон|season)[^\d]*\d+[^\d]+(?:серия|эпизод|серии|episode)[^\d]*(\d+)/i);
        if (seasonEpMatch) {
            const ep = parseInt(seasonEpMatch[1], 10);
            if (!Number.isNaN(ep) && ep > 0) return ep;
        }

        // Match "3 серия" or "серия 3" or "эпизод 3" or "ep 3"
        const epMatch = label.match(/(?:серия|эпизод|серии|episode|ep\.?)[^\d]*(\d+)/i);
        if (epMatch) {
            const ep = parseInt(epMatch[1], 10);
            if (!Number.isNaN(ep) && ep > 0) return ep;
        }

        const reverseEpMatch = label.match(/(\d+)\s*(?:серия|эпизод|серии|episode|ep)/i);
        if (reverseEpMatch) {
            const ep = parseInt(reverseEpMatch[1], 10);
            if (!Number.isNaN(ep) && ep > 0) return ep;
        }

        // Standalone number match (e.g. "3")
        const numMatch = label.trim().match(/^(\d+)$/);
        if (numMatch) {
            const ep = parseInt(numMatch[1], 10);
            if (!Number.isNaN(ep) && ep > 0) return ep;
        }

        // Generic first number if no other matches
        const anyNumMatch = label.match(/(\d+)/);
        if (anyNumMatch) {
            const ep = parseInt(anyNumMatch[1], 10);
            if (!Number.isNaN(ep) && ep > 0) return ep;
        }

        return null;
    }

    extractEpisodeNumber(source) {
        return SeasonvarParser.extractEpisodeNumber(source);
    }

    /**
     * Render Seasonvar's custom player with episode & translation selectors.
     * @param {HTMLElement} container
     * @param {Array} sources - Episode list
     * @param {Object} [options]
     * @param {Object} [options.translations] - Translation playlists map
     * @param {Function} [options.onPlayerReady] - Callback when player is ready
     */
    async renderPlayer(container, sources, options = {}) {
        const renderRequestId = ++this.renderRequestId;
        const selectionRequestId = options.selectionRequestId ?? this.beginSelectionRequest();
        options = { ...options, selectionRequestId };
        const isRenderCurrent = () => renderRequestId === this.renderRequestId
            && this.isSelectionRequestCurrent(selectionRequestId)
            && (!options.isRequestCurrent || options.isRequestCurrent());
        const lifecycle = typeof window !== 'undefined' ? window.PlayerSourceLifecycle : null;

        if (!sources || sources.length === 0) {
            if (isRenderCurrent()) {
                lifecycle?.setState(container, 'unavailable', {
                    message: 'Серии не найдены.',
                    onRetry: options.onRetry,
                    onResearch: options.onResearch
                });
            }
            return false;
        }

        let episodes = sources;
        let translations = options.translations || null;
        let seasons = options.seasons || null;

        // --- CANONICAL SEASON SELECTION ---
        let activeSeasonUrl = options.resolvedSeasonUrl || null;
        if (!activeSeasonUrl && (options.resolvedSeasonNumber != null || options.season != null) && seasons && seasons.length > 0) {
            const targetSeasonNum = Number(options.resolvedSeasonNumber ?? options.season);
            const foundSeason = seasons.find(s => Number(s.season_number) === targetSeasonNum);
            if (foundSeason && foundSeason.url) {
                activeSeasonUrl = foundSeason.url;
            }
        }

        // Fallback: Check saved progress only if no explicit selection exists
        if (options.movieId && !activeSeasonUrl && !options.resolvedEpisodeUrl && options.season == null && options.episode == null && typeof options.resolvedTimestamp === 'undefined') {
            try {
                // Check saved progress
                const key = `watching_progress_${options.movieId}`;
                const result = await new Promise(resolve => chrome.storage.local.get([key], resolve));
                const progress = result[key];

                if (!isRenderCurrent()) return false;
                
                console.log(`[${this.name}] Auto-select check. Progress:`, progress);

                if (progress && progress.season && seasons && seasons.length > 0) {
                    const progSeasonNum = parseInt(progress.season, 10);
                    if (!isNaN(progSeasonNum)) {
                         const targetSeason = seasons.find(s => Number(s.season_number) === progSeasonNum);
                         if (targetSeason) {
                             activeSeasonUrl = targetSeason.url;
                             console.log(`[${this.name}] Will auto-switch to season ${progSeasonNum}: ${activeSeasonUrl}`);
                         }
                    }
                }
            } catch (e) {
                console.warn(`[${this.name}] Auto-select failed`, e);
            }
        }

        // Part 21 Defensive fallback: if no explicit season requested and no saved progress, default to Season 1
        if (!activeSeasonUrl && seasons && seasons.length > 0) {
            const season1 = seasons.find(s => Number(s.season_number) === 1) || seasons[0];
            if (season1?.url) {
                activeSeasonUrl = season1.url;
            }
        }

        // If we determined a different active season than the default one and need to load its episodes
        const needSeasonFetch = Boolean(activeSeasonUrl && (
            !episodes || episodes.length === 0 ||
            (options.currentSourcesUrl && activeSeasonUrl !== options.currentSourcesUrl) ||
            (options.sourcesSeasonUrl && activeSeasonUrl !== options.sourcesSeasonUrl) ||
            (options.sourcesSeasonNumber != null && options.resolvedSeasonNumber != null && Number(options.sourcesSeasonNumber) !== Number(options.resolvedSeasonNumber)) ||
            (options.sourcesSeasonNumber != null && options.season != null && Number(options.sourcesSeasonNumber) !== Number(options.season))
        ));

        if (needSeasonFetch) {
            try {
                 const seriesInfo = await this.getSeriesInfo(activeSeasonUrl);
                 if (!isRenderCurrent()) return false;
                 if (seriesInfo && seriesInfo.episodes) {
                     episodes = seriesInfo.episodes.map(ep => ({
                        name: ep.title,
                        url: ep.url,
                        type: 'video',
                        subtitle: ep.subtitle
                    }));
                    translations = seriesInfo.translations;
                 }
            } catch (err) {
                console.error(`[${this.name}] Failed to load target season`, err);
            }
        }

        if (!isRenderCurrent()) return false;

        // --- CANONICAL EPISODE SELECTION ---
        let targetEpisode = null;
        if (options.resolvedEpisodeUrl) {
            targetEpisode = episodes.find(e => e.url === options.resolvedEpisodeUrl);
        }
        if (!targetEpisode && (options.resolvedEpisodeNumber != null || options.episode != null)) {
            const targetEpNum = Number(options.resolvedEpisodeNumber ?? options.episode);
            targetEpisode = episodes.find(e => this.extractEpisodeNumber(e) === targetEpNum);
            if (!targetEpisode && targetEpNum > 0 && targetEpNum <= episodes.length) {
                targetEpisode = episodes[targetEpNum - 1];
            }
        }

        const firstEp = targetEpisode || episodes[0] || { name: '', url: '' };

        // Mark active season in seasons list (fallback to first if not determined)
        if (!activeSeasonUrl && seasons && seasons.length > 0) {
             activeSeasonUrl = seasons[0].url; 
        }

        let activeSeasonNumber = options.resolvedSeasonNumber ?? options.season;
        if (activeSeasonNumber == null && seasons && seasons.length > 0) {
            const matchedSeason = seasons.find(s => s.url === activeSeasonUrl) || seasons[0];
            activeSeasonNumber = Number(matchedSeason?.season_number) || 1;
        }
        if (activeSeasonNumber == null) activeSeasonNumber = 1;

        const activeEpisodeNumber = this.extractEpisodeNumber(firstEp) ?? options.resolvedEpisodeNumber ?? options.episode ?? 1;

        // Structured Seasonvar State Broadcast (Phase 5B)
        const structuredState = {
            type: 'SEASONVAR_PLAYBACK_STATE',
            seasons: (seasons || []).map(s => ({
                seasonNumber: Number(s.season_number),
                url: s.url,
                name: s.name || `${s.season_number} сезон`
            })),
            episodes: episodes.map(ep => ({
                name: ep.name || ep.title,
                title: ep.title || ep.name,
                url: ep.url,
                episodeNumber: this.extractEpisodeNumber(ep),
                seasonNumber: activeSeasonNumber
            })),
            activeSeasonNumber,
            activeEpisodeNumber,
            activeSeasonUrl,
            activeEpisodeUrl: firstEp.url,
            translations: (translations || []).map(t => ({
                id: t.id,
                name: t.name,
                url: t.url,
                active: options.activeTranslationUrl ? t.url === options.activeTranslationUrl : !!t.active
            })),
            mountToken: this.renderRequestId
        };

        try {
            window.postMessage(structuredState, '*');
        } catch {
            // ignore
        }
        container.__seasonvarPlaybackState = structuredState;

        if (!firstEp?.url || (!firstEp.url.startsWith('http://') && !firstEp.url.startsWith('https://'))) {
            console.error('[SeasonvarParser] Invalid or missing stream URL for target episode:', firstEp);
            lifecycle?.setState(container, 'error', {
                message: 'Источник серии недоступен.',
                onRetry: () => this.renderPlayer(container, sources, options)
            });
            return false;
        }

        const playerHtml = `
            <div class="player-clean player-surface__content">
                <video id="seasonvarVideo" class="player-surface__media" controls>
                    <source src="${firstEp.url}" type="video/mp4">
                    Ваш браузер не поддерживает video тег.
                </video>
                <div class="player-surface__bridge" hidden aria-hidden="true">
                    ${this._renderTranslationSelect(translations, options.activeTranslationUrl)}
                </div>
            </div>
        `;
        
        container.innerHTML = playerHtml;
        
        // Attach all listeners
        this._attachListeners(container, options);

        // Load Saved Progress (Time & Episode)
        const videoElement = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
            ? document.getElementById('seasonvarVideo')
            : (container?.querySelector ? container.querySelector('video') : null);

        if (options.movieId) {
            this.handleProgressRestoration(videoElement, options.movieId, episodes, options);
        }

        if (options.onPlayerReady) {
            options.onPlayerReady(videoElement);
        }
        lifecycle?.setState(container, 'ready');
        return true;
    }

    _renderTranslationSelect(translations, activeTranslationUrl = null) {
        if (!translations || translations.length <= 1) return '';
        return `
            <div id="seasonvar-voiceover-source">
                ${translations.map(t => `
                    <div class="seasonvar-voiceover-item ${t.active ? 'active' : ''}" 
                            data-url="${t.url}" 
                            data-id="${t.id}">
                            ${t.name}
                    </div>
                `).join('')}
            </div>
        `;
    }

    _attachListeners(container, options) {
        const video = typeof document !== 'undefined' ? document.getElementById('seasonvarVideo') : null;
        const lifecycle = typeof window !== 'undefined' ? window.PlayerSourceLifecycle : null;
        const setSourceState = (state, stateOptions = {}) => {
            if (options.isRequestCurrent && !options.isRequestCurrent()) return;
            lifecycle?.setState(container, state, stateOptions);
        };

        // 1. Voiceover items
        const voiceoverItems = container.querySelectorAll('.seasonvar-voiceover-item');
        voiceoverItems.forEach(item => {
            item.addEventListener('click', async (e) => {
                 e.stopPropagation();
                 const url = item.getAttribute('data-url');
                 const requestId = this.beginSelectionRequest();
                 
                 const currentVideo = document.getElementById('seasonvarVideo') || document.querySelector('video');
                 const savedTime = currentVideo ? currentVideo.currentTime : 0;
                 
                 // Visual update
                 const previousActive = container.querySelector('.seasonvar-voiceover-item.active');
                 voiceoverItems.forEach(vi => vi.classList.remove('active'));
                 item.classList.add('active');
                 setSourceState('loading', { message: 'Меняем перевод…' });
                 
                 try {
                     if (!this.fetchAndParsePlaylist) {
                         if (previousActive) {
                             item.classList.remove('active');
                             previousActive.classList.add('active');
                         }
                         throw new Error('Translation playlist loader is unavailable');
                     }
                     
                     const newEpisodes = await this.fetchAndParsePlaylist(url);

                     if (!this.isSelectionRequestCurrent(requestId)) return;

                     // Find current episode number / index
                     const currentEpNum = container.__seasonvarPlaybackState?.activeEpisodeNumber ?? options.resolvedEpisodeNumber ?? options.episode ?? 1;
                     
                     // Pick matching episode in new translation (Part 27 & 28)
                     let newEpIndex = -1;
                     if (currentEpNum) {
                         newEpIndex = newEpisodes.findIndex(ep => this.extractEpisodeNumber(ep) === currentEpNum);
                     }
                     if (newEpIndex === -1) {
                         newEpIndex = 0;
                     }
                     
                     const newEp = newEpisodes[newEpIndex] || newEpisodes[0];
                     
                     if (!newEp) throw new Error('Translation has no playable episodes');
                     
                     // Swap source
                     this._isVoiceoverChange = true;
                     this._voiceoverSavedTime = savedTime;
                     
                     if (currentVideo) {
                         currentVideo.pause();
                         currentVideo.src = newEp.url;
                         currentVideo.load();
                     }

                     // Update structured state
                     if (container.__seasonvarPlaybackState) {
                         container.__seasonvarPlaybackState.episodes = newEpisodes.map(ep => ({
                             name: ep.name || ep.title,
                             title: ep.title || ep.name,
                             url: ep.url,
                             episodeNumber: this.extractEpisodeNumber(ep),
                             seasonNumber: container.__seasonvarPlaybackState.activeSeasonNumber
                         }));
                         container.__seasonvarPlaybackState.activeEpisodeUrl = newEp.url;
                         container.__seasonvarPlaybackState.activeEpisodeNumber = this.extractEpisodeNumber(newEp);
                         try {
                             window.postMessage(container.__seasonvarPlaybackState, '*');
                         } catch {
                             // ignore
                         }
                     }
                     
                     setSourceState('ready');
                     
                 } catch (err) {
                     if (!this.isSelectionRequestCurrent(requestId)) return;
                     console.error('[SeasonvarParser] Failed to switch translation', err);
                     this._isVoiceoverChange = false;
                     if (previousActive) {
                        item.classList.remove('active');
                        previousActive.classList.add('active');
                     }
                     setSourceState('error', {
                         message: 'Не удалось сменить перевод.',
                         onRetry: () => item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
                     });
                 }
            });
        });

        // 2. Auto-seek blocker logic
        this._blockAutoSeek = false;
        this._isEpisodeSwitch = false;
        if (video) {
             video.addEventListener('loadedmetadata', () => {
                 // Voiceover change: restore saved time
                 if (this._isVoiceoverChange && this._voiceoverSavedTime !== undefined) {
                     const savedTime = this._voiceoverSavedTime;
                     this._isVoiceoverChange = false;
                     this._voiceoverSavedTime = undefined;
                     setTimeout(() => { video.currentTime = savedTime; video.play().catch(()=>{}); }, 50);
                     return;
                 }
                 // Episode switch: reset to 0 once, then clear flag
                 if (this._isEpisodeSwitch) {
                      this._isEpisodeSwitch = false;
                      video.currentTime = 0;
                      video.play().catch(err => console.warn(`[Seasonvar] Autoplay error:`, err));
                      return;
                  }
             });
        }
        if (typeof window !== 'undefined' && window.MovieExtension_PlayerCleaner && window.MovieExtension_PlayerCleaner.init) {
            const cleanerRequestGuard = () => this.isSelectionRequestCurrent(options.selectionRequestId)
                && (!options.isRequestCurrent || options.isRequestCurrent());
            window.MovieExtension_PlayerCleaner.setRequestGuard?.(cleanerRequestGuard);
        }
        if (typeof window !== 'undefined' && window.MovieExtension_PlayerCleaner && window.MovieExtension_PlayerCleaner.init && !this._playerCleanerInitialized) {
            this._playerCleanerInitialized = true;
            setTimeout(() => {
                window.MovieExtension_PlayerCleaner.init({
                    isRequestCurrent: () => this.isSelectionRequestCurrent(options.selectionRequestId)
                        && (!options.isRequestCurrent || options.isRequestCurrent())
                });
            }, 100);
        }
    }
    
    /**
     * Restore progress from storage
     */
    async handleProgressRestoration(video, movieId, sources, arg4, arg5) {
        let options = {};
        if (arg4 && typeof arg4 === 'object' && !Array.isArray(arg4)) {
            options = arg4;
        } else if (arg5 && typeof arg5 === 'object' && !Array.isArray(arg5)) {
            options = arg5;
        }
        const selectionRequestId = options.selectionRequestId;
        const isRequestCurrent = () => (selectionRequestId === undefined
            || this.isSelectionRequestCurrent(selectionRequestId))
            && (!options.isRequestCurrent || options.isRequestCurrent());

        try {
            const hasCanonicalSelection = options.hasCanonicalSelection
                || options.resolvedEpisodeNumber != null
                || options.episode != null
                || options.resolvedSeasonNumber != null
                || options.season != null
                || Boolean(options.selection);

            let targetSource = null;
            let targetTimestamp = Number(options.resolvedTimestamp) || 0;

            if (hasCanonicalSelection) {
                // Canonical selection is already mounted by renderPlayer.
                // Do NOT query storage or override mounted episode with legacy provider restore.
                if (options.resolvedEpisodeUrl) {
                    targetSource = sources.find(s => s.url === options.resolvedEpisodeUrl) || null;
                }
            } else {
                // Legacy fallback path: only if no canonical selection exists
                const key = `watching_progress_${movieId}`;
                const result = await new Promise(resolve => chrome.storage.local.get([key], resolve));
                const progress = result[key];

                if (!isRequestCurrent()) return;

                if (progress && (progress.episode || progress.season)) {
                    targetTimestamp = Number(progress.timestamp) || 0;
                    const pSeason = (progress.season || '').toLowerCase().trim();
                    const pEpisode = (progress.episode || '').toLowerCase().trim();

                    if (pEpisode) {
                        targetSource = sources.find(s => {
                            const sName = (s.name || s.title || '').toLowerCase();
                            if (pSeason) {
                                return sName.includes(pSeason) && sName.includes(pEpisode);
                            }
                            return sName.includes(pEpisode);
                        }) || sources.find(s => (s.name || '').includes(progress.episode)) || null;
                    }
                }
            }

            if (!isRequestCurrent() || !video) return;

            // Only seek if timestamp is valid
            if (targetTimestamp > 5) {
                if (targetTimestamp > 100000) {
                    console.warn(`[${this.name}] Invalid timestamp detected:`, targetTimestamp);
                } else {
                    if (video.readyState >= 1) {
                        video.currentTime = targetTimestamp;
                    } else {
                        this.seekToTime = targetTimestamp;
                        const restoreHandler = () => {
                            if (this.seekToTime !== undefined) {
                                video.currentTime = this.seekToTime;
                                this.seekToTime = undefined;
                                video.removeEventListener('loadedmetadata', restoreHandler);
                            }
                        };
                        video.addEventListener('loadedmetadata', restoreHandler);
                    }
                }
            }

            // Only perform source swap if legacy fallback found a different target and NO canonical selection exists
            if (!hasCanonicalSelection && targetSource && targetSource.url && video.src && targetSource.url !== video.src) {
                console.log(`[${this.name}] Restoring to episode: ${targetSource.name}`);
                video.pause();
                video.removeAttribute('src');
                video.load();
                video.currentTime = 0;

                setTimeout(() => {
                    if (!isRequestCurrent()) return;
                    video.src = targetSource.url;
                    video.load();

                    if (targetTimestamp > 5 && targetTimestamp <= 100000) {
                        video.currentTime = targetTimestamp;
                    }

                    const episodeLabel = targetSource.name || targetSource.title || '';
                    console.log(`[${this.name}] Dispatching episodeRestored event:`, episodeLabel);
                    document.dispatchEvent(new CustomEvent('episodeRestored', { 
                        detail: { label: episodeLabel, url: targetSource.url } 
                    }));
                }, 50);
            }
        } catch (e) {
            console.warn(`[${this.name}] Progress restoration failed`, e);
        }
    }

    // ─── Internal Methods ─────────────────────────────────────────────

    normalizeSearchTitle(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[ё]/g, 'е')
            .replace(/[^a-zа-я0-9]+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    getSearchTitleScore(foundTitle, targetTitle) {
        const found = this.normalizeSearchTitle(foundTitle);
        const target = this.normalizeSearchTitle(targetTitle);
        if (!found || !target) return 0;
        if (found === target) return 1000;

        const foundWords = found.split(' ');
        const targetWords = target.split(' ');
        const hasAllTargetWords = targetWords.every(word => foundWords.includes(word));
        if (!hasAllTargetWords) return 0;

        // Whole-word matches are valid when the provider adds a season suffix
        // or a franchise prefix (e.g. "Джек Ричер" for "Ричер").
        if (foundWords.slice(0, targetWords.length).join(' ') === target) return 900;
        return 800;
    }

    selectBestSearchResult(results, title, altName = '', year = null) {
        if (!Array.isArray(results) || results.length === 0) return null;

        const targetTitles = [title, altName].filter(Boolean);
        const targetYear = Number(year);
        const ranked = results.map((result, index) => {
            const titleScore = Math.max(
                ...targetTitles.map(target => this.getSearchTitleScore(result.title, target)),
                ...targetTitles.map(target => this.getSearchTitleScore(result.originalTitle, target))
            );
            const resultYear = Number(result.year);
            const yearScore = Number.isFinite(targetYear) && Number.isFinite(resultYear)
                ? (resultYear === targetYear ? 20 : -Math.min(20, Math.abs(resultYear - targetYear)))
                : 0;
            return { result, titleScore, score: titleScore + yearScore, index };
        });

        const best = ranked
            .filter(candidate => candidate.titleScore > 0)
            .sort((a, b) => b.score - a.score || a.index - b.index)[0];
        return best?.result || null;
    }

    /**
     * Parse search results HTML
     */
    parseSearchResults(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const results = [];

        const items = doc.querySelectorAll('.pgs-search-wrap');
        
        items.forEach(item => {
            const link = item.querySelector('a');
            if (!link) return;

            const href = link.getAttribute('href');
            let fullUrl = href;
            if (href && !href.startsWith('http')) {
                 fullUrl = href.startsWith('/') ? this.baseUrl + href : this.baseUrl + '/' + href;
            }
            
            const infoDiv = item.querySelector('.pgs-search-info');
            let ruTitle = '';
            let enTitle = '';
            
            if (infoDiv) {
                const anchors = infoDiv.querySelectorAll('a');
                if (anchors.length > 0) ruTitle = anchors[0].textContent.trim();
                if (anchors.length > 1) enTitle = anchors[1].textContent.trim();
            } else {
                ruTitle = link.textContent.trim();
            }

            if (fullUrl) {
                results.push({
                    url: fullUrl,
                    title: ruTitle,
                    originalTitle: enTitle,
                    isSeries: true,
                    source: 'seasonvar',
                    parserId: this.id
                });
            }
        });

        return results;
    }

    /**
     * Get video sources/playlist for a series page
     * @param {string} url - Series page URL
     * @returns {Promise<Object>} - Playlist data and available translations
     */
    async getSeriesInfo(url, purpose = 'getSeriesInfo') {
        return this.getCachedDiscovery(
            this.seriesInfoCache,
            this.seriesInfoInFlight,
            url,
            purpose,
            (key, requestPurpose) => this.getSeriesInfoUncached(key, requestPurpose)
        );
    }

    async getSeriesInfoUncached(url, purpose = 'getSeriesInfo') {
        try {
            const page = await this.getSeasonvarPage(url, purpose);
            const { html, doc } = page;

            // NEW PARSING LOGIC: Handle multiple translations structure
            // 1. Extract all pl[id] = "url" mappings from the raw HTML first (most robust)
            const playlistMap = {};
            // Regex to match: pl[123] = "/path/to/playlist.txt";
            // Supports variations in spacing and quotes
            const plRegex = /pl\[['"]?(\d+)['"]?\]\s*=\s*['"]([^"']+)['"]/g;
            let match;
            while ((match = plRegex.exec(html)) !== null) {
                playlistMap[match[1]] = match[2];
            }

            // 2. Parse the Translation List from HTML using DOMParser
            const transList = doc.querySelectorAll('.pgs-trans li[data-translate]');
            
            const translations = [];

            transList.forEach(li => {
                const id = li.getAttribute('data-translate');
                const name = li.textContent.trim();
                const percent = li.getAttribute('data-translate-percent');
                const isActive = li.classList.contains('act');
                const url = playlistMap[id];

                // Filter out utility items like "Trailers"
                if (name.toLowerCase().includes('трейлер') || name.toLowerCase().includes('тизер')) {
                    return;
                }

                if (url) {
                    // Fix URL if relative
                    const fullUrl = url.startsWith('/') ? this.baseUrl + url : url;
                    
                    if (isActive) {
                        // activeTranslationId = id; // redundant
                    }

                    translations.push({
                        id: id,
                        name: name,
                        popularity: percent ? parseFloat(percent) : 0,
                        url: fullUrl,
                        active: isActive
                    });
                }
            });

            // Fallback: If no translations found via regex/DOM (old structure or single translation)
            if (translations.length === 0) {
                 // Try finding single simple variable: var pl = {...} or var pl = "/path"
                 const simplePlMatch = html.match(/var\s+pl\s*=\s*(['"][^'"]+['"]|{[^;]+})/);
                 if (simplePlMatch) {
                     let val = simplePlMatch[1];
                     if (val.startsWith('{')) {
                         // JSON object format (Old Seasonvar)
                         try {
                             val = val.replace(/'/g, '"');
                             const parsed = JSON.parse(val);
                             Object.keys(parsed).forEach(k => {
                                  let u = parsed[k];
                                  if (u.startsWith('/')) u = this.baseUrl + u;
                                  translations.push({
                                      id: k,
                                      name: k === '0' ? 'Стандартный' : `Перевод ${k}`,
                                      popularity: 0,
                                      url: u,
                                      active: k === '0'
                                  });
                             });
                            } catch { /* Ignore */ }
                     } else {
                         // Simple string format
                         let u = val.replace(/['"]/g, '');
                         if (u.startsWith('/')) u = this.baseUrl + u;
                         translations.push({
                             id: '0',
                             name: 'Стандартный',
                             popularity: 100,
                             url: u,
                             active: true
                         });
                          // activeTranslationId = '0'; // redundant
                      }
                 }
            }
            
            // If still no translations, we can't proceed
            if (translations.length === 0) {
                throw new Error('No playlists found');
            }

            // Determine active playlist URL
            // Prefer the one marked 'active', otherwise the most popular, otherwise first
            let activeTranslation = translations.find(t => t.active) || translations.sort((a,b) => b.popularity - a.popularity)[0] || translations[0];
            
            // Fetch episodes for the active translation
            const episodes = await this.fetchAndParsePlaylist(activeTranslation.url);

            return {
                episodes: episodes,
                translations: translations, // Now an Array
                activeTranslationId: activeTranslation.id
            };

        } catch (error) {
            console.error(`[${this.name}] Error getting series info:`, error);
            throw error;
        }
    }

    /**
     * Fetch and parse playlist JSON
     */
    async fetchAndParsePlaylist(url) {
        try {
            const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
            const response = perf
                ? await perf.trackRequest('SEASONVAR_DETAIL', { purpose: 'playlist', url }, () => fetch(url))
                : await fetch(url);
            if (!response.ok) throw new Error('Failed to load playlist');
            const data = await response.json();
            return this.flattenPlaylist(data);
        } catch (e) {
            console.error(`[${this.name}] Playlist fetch/parse error:`, e);
            return [];
        }
    }

    /**
     * Decode Seasonvar URL (handles #2 Base64 encryption and garbage removal)
     */
    decodeUrl(url) {
        try {
            let cleanUrl = url;
            if (cleanUrl.startsWith('#2')) cleanUrl = cleanUrl.substring(2);
            cleanUrl = cleanUrl.replace(/\/\/b2xvbG8=/g, '');
            let decoded = atob(cleanUrl);
            if (decoded.startsWith('//')) decoded = 'https:' + decoded;
            return decoded;
        } catch (e) {
            console.error(`[${this.name}] URL decoding failed:`, url, e);
            return url;
        }
    }

    /**
     * Recursively flatten playlist structure
     */
    flattenPlaylist(items, parentTitle = '') {
        let result = [];
        
        items.forEach(item => {
            if (item.folder) {
                const folderTitle = item.title || '';
                const children = this.flattenPlaylist(item.folder, folderTitle);
                result = result.concat(children);
            } else {
                let finalTitle = item.title;
                const epMatch = finalTitle.match(/^(\d+\s+серия)/);
                if (epMatch) finalTitle = epMatch[1];

                if (parentTitle) {
                    const isRange = /^\d+-\d+\s+серия/.test(parentTitle);
                    if (!isRange) finalTitle = `${parentTitle} - ${finalTitle}`;
                }

                result.push({
                    title: finalTitle,
                    url: this.decodeUrl(item.file),
                    subtitle: item.subtitle || null
                });
            }
        });
        
        return result;
    }

    /**
     * Search with best-match filtering for a specific movie/series.
     * Enhanced version used by movie-details for better matching.
     * @param {string} name - Movie name
     * @param {string} [altName] - Alternative name
     * @param {string|number} [year] - Year
     * @returns {Promise<SearchResult|null>}
     */
    async searchBestMatch(name, altName, year) {
        try {
            const url = `${this.searchUrl}?q=${encodeURIComponent(name)}`;
            const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
            const response = perf
                ? await perf.trackRequest('SEASONVAR_SEARCH', { purpose: 'searchBestMatch', url }, () => fetch(url))
                : await fetch(url);
            if (!response.ok) throw new Error(`Search failed: ${response.status}`);
            
            const html = await response.text();
            const results = this.parseSearchResults(html);
            
            return this.selectBestSearchResult(results, name, altName, year);
        } catch (error) {
            console.error(`[${this.name}] searchBestMatch error:`, error);
            return null;
        }
    }

    /**
     * Get all seasons information for a series.
     * Extracts season number, URL, and episode count.
     * Fetches individual season pages if episode count is missing.
     * @param {string} url - Current page URL (or any season URL of the series)
     * @returns {Promise<Array<{season_number: number, url: string, episodes_count: number}>>}
     */
    async getSeasons(url, purpose = 'getSeasons') {
        return this.getCachedDiscovery(
            this.seasonsCache,
            this.seasonsInFlight,
            url,
            purpose,
            (key, requestPurpose) => this.getSeasonsUncached(key, requestPurpose)
        );
    }

    async getSeasonsUncached(url, purpose = 'getSeasons') {
        try {
            const page = await this.getSeasonvarPage(url, purpose);
            const { doc } = page;
            
            const seasons = [];
            
            // Seasonvar structure: <ul class="tabs-result"> ... <h2><a href="...">...</a></h2> ... </ul>
            const tabsResult = doc.querySelector('.tabs-result');
            
            if (!tabsResult) {
                // Return empty if no season tabs found (might be single season or different structure)
                return [];
            }

            const items = tabsResult.querySelectorAll('h2 a');
            
            for (const link of items) {
                const href = link.getAttribute('href');
                if (!href) continue;

                const fullUrl = href.startsWith('/') ? this.baseUrl + href : href;
                const text = link.textContent.trim();
                
                // Extract season number: "1 сезон", "2 season", etc.
                const seasonMatch = text.match(/(\d+)\s*(?:сезон|season)/i);
                if (!seasonMatch) continue;
                
                const seasonNumber = parseInt(seasonMatch[1]);
                
                // Extract episode count from span if available
                // Example: <span>(8 серий)</span> or <span>(8 serij)</span>
                let episodesCount = 0;
                const span = link.querySelector('span');
                if (span) {
                     const epMatch = span.textContent.match(/(\d+)\s*(?:сери|seri)/i);
                     if (epMatch) {
                         episodesCount = parseInt(epMatch[1]);
                     }
                }
                
                seasons.push({
                    season_number: seasonNumber,
                    url: fullUrl,
                    episodes_count: episodesCount
                });
            }

            console.log('=== ПАРСИНГ SEASONVAR (getSeasons) ===');
            console.log('Найденный блок tabs-result:', tabsResult ? 'Да' : 'Нет');
            console.log('Извлеченные данные сезонов:', seasons);

            // Identify seasons with missing episode counts
            const fetchPromises = seasons.map(async (s) => {
                if (s.episodes_count === 0) {
                     try {
                         // Optimization: If the URL matches the one we just fetched, we could reuse info, 
                         // but getSeriesInfo does specialized playlist parsing. 
                         // For simplicity and robustness, we call getSeriesInfo.
                         const sInfo = await this.getSeriesInfo(s.url, 'seasonEpisodeCount');
                         if (sInfo && sInfo.episodes) {
                             s.episodes_count = sInfo.episodes.length;
                         }
                     } catch (e) {
                         console.warn(`[${this.name}] Failed to fetch count for season ${s.season_number}`, e);
                     }
                }
                return s;
            });

            const finalSeasons = await Promise.all(fetchPromises);
            
            // Sort by season number
            return finalSeasons.sort((a, b) => a.season_number - b.season_number);

        } catch (error) {
            console.error(`[${this.name}] getSeasons error:`, error);
            return [];
        }
    }
}

// Export — backward compatible
if (typeof window !== 'undefined') {
    window.SeasonvarParser = SeasonvarParser;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SeasonvarParser };
}
