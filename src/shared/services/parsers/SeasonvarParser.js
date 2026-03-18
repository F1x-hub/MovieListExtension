/**
 * SeasonvarParser - Parser for seasonvar.ru series source.
 * Searches for series and extracts video player sources / playlists.
 * Parser for seasonvar.ru streaming source.
 * 
 * @extends BaseParserService
 */
class SeasonvarParser extends BaseParserService {
    constructor() {
        super({
            id: 'seasonvar',
            name: 'Seasonvar',
            baseUrl: 'http://seasonvar.ru'
        });
        this.searchUrl = 'http://seasonvar.ru/search';
    }

    // ─── BaseParserService Contract ───────────────────────────────────

    /**
     * Search for a series by title (and optionally year).
     * @param {string} title - Series title
     * @param {string|number|null} [year] - Release year (unused by Seasonvar, kept for interface compliance)
     * @returns {Promise<SearchResult|null>} Best matching result
     */
    async search(title, year) {
        console.log(`[DEBUG SeasonvarParser] search() called. title: "${title}", year: ${year}`);
        try {
            const url = `${this.searchUrl}?q=${encodeURIComponent(title)}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const html = await response.text();
            const results = this.parseSearchResults(html);

            if (!results || results.length === 0) return null;

            // Return the first (best) match with parserId
            const best = results[0];
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
            const url = typeof searchResult === 'string' ? searchResult : searchResult.url;
            console.log('=== ДИАГНОСТИКА СЕЗОНОВ (getVideoSources) ===');
            console.log('URL:', url);
            
            const seriesInfo = await this.getSeriesInfo(url);
            
            // Try to get seasons info too, to attach if needed (though existing architecture might unlikely use it yet)
            let seasons = [];
            try {
                 seasons = await this.getSeasons(url);
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
            return [];
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
     * Render Seasonvar's custom player with episode & translation selectors.
     * @param {HTMLElement} container
     * @param {Array} sources - Episode list
     * @param {Object} [options]
     * @param {Object} [options.translations] - Translation playlists map
     * @param {Function} [options.onPlayerReady] - Callback when player is ready
     */
    async renderPlayer(container, sources, options = {}) {
        console.log(`[DEBUG SeasonvarParser] renderPlayer called. sources: ${sources?.length}, options.seasons: ${options.seasons?.length}, options.translations:`, !!options.translations);
        console.log(`[DEBUG SeasonvarParser] Container BEFORE render:`, container?.tagName, 'children:', Array.from(container.children).map(c => c.tagName + '.' + c.className?.substring(0,30)));
        if (!sources || sources.length === 0) {
            container.innerHTML = '<div class="video-placeholder"><span>Серии не найдены</span></div>';
            return;
        }

        let episodes = sources;
        let translations = options.translations || null;
        let seasons = options.seasons || null;
        let firstEp = episodes[0];
        
        // --- PROBLEM 1: AUTO-SELECT SEASON BASED ON PROGRESS ---
        let activeSeasonUrl = options.resolvedSeasonUrl || null;
        let activeEpisodeUrl = options.resolvedEpisodeUrl || null;

        if (options.movieId && !activeSeasonUrl && !activeEpisodeUrl && typeof options.resolvedTimestamp === 'undefined') {
            try {
                // Check saved progress
                const key = `watching_progress_${options.movieId}`;
                const result = await new Promise(resolve => chrome.storage.local.get([key], resolve));
                const progress = result[key];
                
                console.log(`[${this.name}] Auto-select check. Progress:`, progress);

                if (progress && progress.season && seasons && seasons.length > 0) {
                    // Try to find the season URL from progress
                    // Progress.season is usually string "X сезон"
                    const progSeasonNum = parseInt(progress.season);
                    if (!isNaN(progSeasonNum)) {
                         const targetSeason = seasons.find(s => s.season_number === progSeasonNum);
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

        // If we determined a different active season than the default one (which corresponds to sources), load it
        if (activeSeasonUrl) {
            // But we need to check if the CURRENT sources already match this season?
            // Usually 'sources' passed to renderPlayer are default (Season 1 or whatever the page loaded).
            // We can check if 'sources' URL belongs to the season? Not easily.
            // Assumption: if activeSeasonUrl is set, we prefer it.
            // BUT: avoiding double-fetch if we are already there?
            // Let's just fetch if we have a targetUrl.
            
            try {
                 const seriesInfo = await this.getSeriesInfo(activeSeasonUrl);
                 if (seriesInfo && seriesInfo.episodes) {
                     episodes = seriesInfo.episodes.map(ep => ({
                        name: ep.title,
                        url: ep.url,
                        type: 'video',
                        subtitle: ep.subtitle
                    }));
                    translations = seriesInfo.translations;
                    firstEp = episodes[0]; // Reset first ep to new season's first ep
                    // We will let handleProgressRestoration set the exact episode later
                 }
            } catch (err) {
                console.error(`[${this.name}] Failed to load auto-selected season`, err);
                // Fallback to default sources
            }
        }
        
        // Mark active season in seasons list
        // If no activeSeasonUrl set (e.g. no progress), we assume the First season in the list is active?
        // Or we should try to match 'firstEp.url' to a season? Harder.
        // Let's default to highlighting the first one if not set.
        if (!activeSeasonUrl && seasons && seasons.length > 0) {
             // Heuristic: usually the first one in the sorted list?
             // Or the one with smallest number?
             // actually seasons are sorted.
             activeSeasonUrl = seasons[0].url; 
        }


        const playerHtml = `
            <div class="player-clean" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%; overflow: hidden; background: #000;">
                <video id="seasonvarVideo" controls style="width: 100%; height: 100%; object-fit: contain; flex-grow: 1; outline: none; border: none; max-height: 100%; display: block;">
                    <source src="${firstEp.url}" type="video/mp4">
                    Ваш браузер не поддерживает video тег.
                </video>
                <div class="seasonvar-controls" style="display: none;">
                    ${this._renderEpisodeSelect(episodes)}
                    ${this._renderTranslationSelect(translations)}
                </div>
                
                <!-- Hidden Compatibility Layer & Lists -->
                <div class="list_simulated" style="display:none;">
                    ${this._renderHiddenEpisodes(episodes)}
                    ${this._renderHiddenSeasons(seasons, activeSeasonUrl)}
                </div>
            </div>
        `;
        
        container.innerHTML = playerHtml;
    console.log(`[DEBUG SeasonvarParser] Container AFTER render:`, 'children:', Array.from(container.children).map(c => c.tagName + '.' + c.className?.substring(0,30)));
        
        // Attach all listeners
        this._attachListeners(container, options);

        // Load Saved Progress (Time & Episode)
        if (options.movieId) {
            this.handleProgressRestoration(document.getElementById('seasonvarVideo'), options.movieId, episodes, document.getElementById('svEpisodeSelect'), options);
        }

        if (options.onPlayerReady) {
            options.onPlayerReady(document.getElementById('seasonvarVideo'));
        }
    }

    _renderEpisodeSelect(episodes) {
        return `
            <select id="svEpisodeSelect" class="form-select" style="max-width: 200px;">
                ${episodes.map((ep, i) => `<option value="${ep.url}">${ep.name || ep.title}</option>`).join('')}
            </select>
        `;
    }

    _renderTranslationSelect(translations) {
        if (!translations || translations.length <= 1) return '';
        return `
            <select id="svTranslationSelect" class="form-select" style="max-width: 200px;">
                ${translations.map(t => `
                    <option value="${t.url}" ${t.active ? 'selected' : ''}>
                        ${t.name} ${t.popularity ? `(${t.popularity}%)` : ''}
                    </option>
                `).join('')}
            </select>
            <div id="seasonvar-voiceover-source" style="display:none;">
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

    _renderHiddenEpisodes(episodes) {
         return `
            <div class="dropdown_episodes"> 
                <span class="headText_simulated">серия</span>
                ${episodes.map((ep, i) => `
                    <div class="item_simulated ${i===0 ? 'active' : ''}" data-url="${ep.url}">${ep.name || ep.title}</div>
                `).join('')}
            </div>
         `;
    }

    _renderHiddenSeasons(seasons, activeUrl) {
        if (!seasons || seasons.length <= 1) return '';
        return `
            <div class="dropdown_seasons">
                <span class="headText_simulated">сезон</span>
                ${seasons.map(s => {
                    const isActive = s.url === activeUrl;
                    return `<div class="item_simulated ${isActive ? 'active' : ''}" data-url="${s.url}">${s.season_number} сезон</div>`;
                }).join('')}
            </div>
        `;
    }

    _attachListeners(container, options) {
        const video = document.getElementById('seasonvarVideo');
        const epSelect = document.getElementById('svEpisodeSelect');
        const trSelect = document.getElementById('svTranslationSelect');

        // 1. Voiceover items
        const voiceoverItems = container.querySelectorAll('.seasonvar-voiceover-item');
        voiceoverItems.forEach(item => {
            item.addEventListener('mousedown', async (e) => {
                 e.stopPropagation();
                 const url = item.getAttribute('data-url');
                 
                 const currentVideo = document.getElementById('seasonvarVideo') || document.querySelector('video');
                 const savedTime = currentVideo ? currentVideo.currentTime : 0;
                 
                 // Visual update
                 const previousActive = container.querySelector('.seasonvar-voiceover-item.active');
                 voiceoverItems.forEach(vi => vi.classList.remove('active'));
                 item.classList.add('active');
                 
                 try {
                     if (!this.fetchAndParsePlaylist) {
                         if (previousActive) {
                             item.classList.remove('active');
                             previousActive.classList.add('active');
                         }
                         return;
                     }
                     
                     const newEpisodes = await this.fetchAndParsePlaylist(url);
                     
                     // Find current episode index
                     const currentEpSelect = document.getElementById('svEpisodeSelect');
                     const currentEpIndex = currentEpSelect ? currentEpSelect.selectedIndex : 0;
                     
                     // Pick same episode
                     const newEp = newEpisodes[currentEpIndex] || newEpisodes[0];
                     
                     if (!newEp) return;
                     
                     // Swap source
                     this._isVoiceoverChange = true;
                     this._voiceoverSavedTime = savedTime;
                     
                     if (currentVideo) {
                         currentVideo.pause();
                         currentVideo.src = newEp.url;
                         currentVideo.load();
                     }
                     
                     // Update Select
                     if (currentEpSelect) {
                         currentEpSelect.innerHTML = newEpisodes.map((ep, i) => 
                             `<option value="${ep.url}" ${i === currentEpIndex ? 'selected' : ''}>${ep.name || ep.title}</option>`
                         ).join('');
                     }
                     
                     // Update Hidden Episodes
                     const hiddenEpContainer = container.querySelector('.dropdown_episodes');
                     if (hiddenEpContainer) {
                         const headText = hiddenEpContainer.querySelector('.headText_simulated');
                         hiddenEpContainer.innerHTML = '';
                         if (headText) hiddenEpContainer.appendChild(headText);
                         newEpisodes.forEach((ep, i) => {
                             const div = document.createElement('div');
                             div.className = `item_simulated ${i === currentEpIndex ? 'active' : ''}`;
                             div.setAttribute('data-url', ep.url);
                             div.textContent = ep.name || ep.title;
                             hiddenEpContainer.appendChild(div);
                         });
                         // Re-attach listeners to new hidden items
                         this._attachHiddenEpisodeListeners(container, video, epSelect);
                     }
                     
                 } catch (err) {
                     console.error('[SeasonvarParser] Failed to switch translation', err);
                     this._isVoiceoverChange = false;
                     if (previousActive) {
                        item.classList.remove('active');
                        previousActive.classList.add('active');
                     }
                 }
            });
        });

        // 2. Episode Select
        if (epSelect) {
            epSelect.addEventListener('change', (e) => {
                 const newUrl = e.target.value;
                 this._isEpisodeSwitch = true;
                 video.pause();
                 video.src = newUrl;
                 video.load();
            });
        }
        
        // 3. Translation Select
        if (trSelect) {
             trSelect.addEventListener('change', async (e) => {
                  container.innerHTML = '<div class="video-placeholder"><div class="loading-spinner"></div><span>Меняем перевод...</span></div>';
                  try {
                      const newPlUrl = e.target.value.startsWith('/') ? (this.baseUrl || 'http://seasonvar.ru') + e.target.value : e.target.value; 
                      const newEpisodes = await this.fetchAndParsePlaylist(newPlUrl);
                      const newSources = newEpisodes.map(ep => ({ name: ep.title, url: ep.url, type: 'video', subtitle: ep.subtitle }));
                      
                      this.renderPlayer(container, newSources, { translations: options.translations, seasons: options.seasons, movieId: options.movieId });
                      
                      const newTrSelect = document.getElementById('svTranslationSelect');
                      if (newTrSelect) newTrSelect.value = e.target.value;
                  } catch(err) {
                      console.error(`[${this.name}] Translation switch failed:`, err);
                  }
             });
        }

        // 4. Seamless Season Switch
        const seasonItems = container.querySelectorAll('.dropdown_seasons .item_simulated');
        seasonItems.forEach(item => {
             item.addEventListener('mousedown', async (e) => {
                 e.stopPropagation();
                 const url = item.getAttribute('data-url');
                 if (!url || item.classList.contains('active')) return;

                 console.log(`[${this.name}] Seamless season switch to: ${url}`);
                 seasonItems.forEach(s => s.classList.remove('active'));
                 item.classList.add('active');

                 try {
                     const seriesInfo = await this.getSeriesInfo(url);
                     if (seriesInfo && seriesInfo.episodes) {
                         const newEpisodes = seriesInfo.episodes.map(ep => ({
                             name: ep.title, url: ep.url, type: 'video', subtitle: ep.subtitle
                         }));
                         
                         // Update internals
                         if (epSelect) {
                             epSelect.innerHTML = newEpisodes.map((ep, i) => `<option value="${ep.url}">${ep.name || ep.title}</option>`).join('');
                         }
                         
                         const hiddenEpContainer = container.querySelector('.dropdown_episodes');
                         if (hiddenEpContainer) {
                             hiddenEpContainer.innerHTML = `<span class="headText_simulated">серия</span>` +
                                 newEpisodes.map((ep, i) => 
                                     `<div class="item_simulated ${i===0 ? 'active' : ''}" data-url="${ep.url}">${ep.name || ep.title}</div>`
                                 ).join('');
                                 
                             this._attachHiddenEpisodeListeners(container, video, epSelect);
                         }

                         // Don't auto-load video — wait for user to pick an episode
                         // video.pause();
                         // video.removeAttribute('src');
                         // video.load();
                     }
                 } catch (err) {
                     console.error('[Seasonvar] Seamless switch failed', err);
                 }
             });
        });
        
        // 5. Hidden Episode Listeners
        this._attachHiddenEpisodeListeners(container, video, epSelect);

        // 6. Auto-seek blocker logic
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
                     // explicitly call play here 
                     video.play().catch(err => console.warn(`[Seasonvar] Autoplay error:`, err));
                     return;
                 }
                 // Progress restoration seek
                 // (handled by handleProgressRestoration's own loadedmetadata listener)
             });
        }
        
        if (window.MovieExtension_PlayerCleaner && window.MovieExtension_PlayerCleaner.init && !this._playerCleanerInitialized) {
            this._playerCleanerInitialized = true;
            setTimeout(() => {
                window.MovieExtension_PlayerCleaner.init();
            }, 100);
        }
    }

    _attachHiddenEpisodeListeners(container, video, epSelect) {
        const episodeItems = container.querySelectorAll('.dropdown_episodes .item_simulated');
        episodeItems.forEach(item => {
             item.addEventListener('mousedown', (e) => {
                 e.stopPropagation();
                 const url = item.getAttribute('data-url');
                 if (!url || item.classList.contains('active')) return;
                 
                 episodeItems.forEach(ep => ep.classList.remove('active'));
                 item.classList.add('active');
                 
                 if (epSelect) epSelect.value = url;
                 
                 this._isEpisodeSwitch = true;
                 video.pause();
                 video.src = url;
                 video.load();
             });
        });
    }
    
    /**
     * Restore progress from storage
     */
    async handleProgressRestoration(video, movieId, sources, epSelect, options = {}) {
        try {
            let targetSource = null;
            let targetTimestamp = 0;
            
            if (options.resolvedEpisodeUrl) {
                targetSource = sources.find(s => s.url === options.resolvedEpisodeUrl);
                targetTimestamp = options.resolvedTimestamp || 0;
            } else {
                // Replicate key generation logic from ProgressService
                const key = `watching_progress_${movieId}`;
                // Use chrome.storage directly as we might not have the service instance here
                // Note: Parser service is usually synchronous or promise-based.
                const result = await new Promise(resolve => chrome.storage.local.get([key], resolve));
                const progress = result[key];
                
                console.log(`[${this.name}] Loaded saved progress:`, progress);
    
                if (progress) {
                     // Format: { season: "1 сезон", episode: "3 серия", timestamp: 123 }
                     // We need to match episode label/title to source URL
                     // Seasonvar sources name formats: "3 серия" or "1 сезон - 3 серия" 
                     targetTimestamp = progress.timestamp || 0;
                     
                     // Strategy: Try to find by exact episode match + season if applicable
                     // If sources list is flat but has "X сезон - Y серия" titles
                     if (progress.episode) {
                         // Normalize titles for comparison
                         const pSeason = (progress.season || '').toLowerCase().trim();
                         const pEpisode = (progress.episode || '').toLowerCase().trim();
                         
                         targetSource = sources.find(s => {
                             const sName = (s.name || s.title || '').toLowerCase();
                             // Case 1: Source has "season" in name
                             // Case 2: Source only has "episode" (single season)
                             if (pSeason) {
                                 return sName.includes(pSeason) && sName.includes(pEpisode);
                             } else {
                                 return sName.includes(pEpisode);
                             }
                         });
                         
                         // Fallback: simple text match
                         if (!targetSource) {
                              targetSource = sources.find(s => (s.name || '').includes(progress.episode));
                         }
                     }
                }
            }
            
            if (targetSource || targetTimestamp > 5) {
                 if (targetSource && targetSource.url !== video.src) {
                     console.log(`[${this.name}] Restoring to episode: ${targetSource.name}`);
                     
                     // Update hidden .item_simulated elements to mark correct episode as active
                     const allSimulatedItems = document.querySelectorAll('.item_simulated');
                     allSimulatedItems.forEach(item => {
                         if (item.getAttribute('data-url') === targetSource.url) {
                             item.classList.add('active');
                         } else {
                             item.classList.remove('active');
                         }
                     });
                     
                     // Switch source
                     video.pause();
                     video.removeAttribute('src');
                     video.load();
                     video.currentTime = 0;
 
                     setTimeout(() => {
                         video.src = targetSource.url;
                         if (epSelect) epSelect.value = targetSource.url;
                         video.load();
                         
                         // Restore timestamp
                         if (targetTimestamp > 5) {
                             // VALIDATION: Check for invalid timestamp
                             if (targetTimestamp > 100000) {
                                  console.warn(`[${this.name}] Invalid timestamp detected:`, targetTimestamp);
                             } else {
                                 this.seekToTime = targetTimestamp;
                                 console.log(`[${this.name}] Queuing seek to: ${this.seekToTime}`);
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
                         // We do NOT call play() here so the video starts paused when restored on initial open
                         
                         // Dispatch custom event for player-cleaner to update its UI
                         const episodeLabel = targetSource.name || targetSource.title || '';
                         console.log(`[${this.name}] Dispatching episodeRestored event:`, episodeLabel);
                         document.dispatchEvent(new CustomEvent('episodeRestored', { 
                             detail: { label: episodeLabel, url: targetSource.url } 
                         }));
                     }, 50);
                 } else if (targetTimestamp > 5) {
                     // Same episode, just seek
                     if (targetTimestamp > 100000) {
                          console.warn(`[${this.name}] Invalid timestamp detected (looks like Date.now()):`, targetTimestamp);
                     } else {
                          video.currentTime = targetTimestamp;
                     }
                 }
            }
        } catch (e) {
            console.warn(`[${this.name}] Progress restoration failed`, e);
        }
    }

    // ─── Internal Methods ─────────────────────────────────────────────

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
    async getSeriesInfo(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to load series page');
            const html = await response.text();

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
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const transList = doc.querySelectorAll('.pgs-trans li[data-translate]');
            
            const translations = [];
            let activeTranslationId = null;

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
                        activeTranslationId = id;
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
                         } catch (e) { }
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
                         activeTranslationId = '0';
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
            const response = await fetch(url);
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
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Search failed: ${response.status}`);
            
            const html = await response.text();
            const results = this.parseSearchResults(html);
            
            if (!results || results.length === 0) return null;
            if (results.length === 1) return results[0];

            const searchNameLower = name.toLowerCase().trim();
            const altNameLower = (altName || '').toLowerCase().trim();

            // Priority 1: Exact Title Match (Russian)
            const exactMatch = results.find(r => r.title && r.title.toLowerCase().trim() === searchNameLower);
            if (exactMatch) return exactMatch;

            // Priority 2: Exact Original Title Match
            if (altNameLower) {
                const exactOriginalMatch = results.find(r => r.originalTitle && r.originalTitle.toLowerCase().trim() === altNameLower);
                if (exactOriginalMatch) return exactOriginalMatch;
            }

            // Priority 3: Starts-with match
            const startsWithMatch = results.find(r => r.title && r.title.toLowerCase().trim().startsWith(searchNameLower));
            if (startsWithMatch) return startsWithMatch;

            return results[0];
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
    async getSeasons(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to load page');
            const html = await response.text();
            
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
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

            // Identify seasons with missing episode counts (likely the one corresponding to 'url' or active tab)
            // and fetch them to get accurate count from playlist
            const results = [];
            const fetchPromises = seasons.map(async (s) => {
                if (s.episodes_count === 0) {
                     try {
                         // Optimization: If the URL matches the one we just fetched, we could reuse info, 
                         // but getSeriesInfo does specialized playlist parsing. 
                         // For simplicity and robustness, we call getSeriesInfo.
                         const sInfo = await this.getSeriesInfo(s.url);
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
