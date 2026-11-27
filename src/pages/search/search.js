import { i18n } from '../../shared/i18n/I18n.js';

function searchTraceNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function createSearchTraceId(generation) {
    return `search-${Date.now()}-${generation}-${Math.random().toString(36).slice(2, 8)}`;
}

function searchTraceDurationMs(startedAt) {
    return Math.round((searchTraceNow() - startedAt) * 10) / 10;
}

/**
 * SearchManager - Controller for the movie search page
 * Handles movie search, filtering, and rating functionality
 */
class SearchManager {
    constructor() {
        this.elements = this.initializeElements();
        this.currentQuery = '';
        this.currentPage = 1;
        this.currentResults = [];
        this.currentUser = null;
        this.searchHistoryService = new SearchHistoryService();
        this.isHistoryDropdownOpen = false;
        this.availableCollections = []; // Store for menu
        this.cardActions = null; // MovieCardActions, bound with the grid listeners

        // Infinite Scroll State
        this.CHUNK_SIZE = 12;
        this.scrapedPool = [];
        this.renderedMovieIds = new Set();
        this.hasMore = false;
        this.isLoadingMore = false;
        this.consecutiveAutoLoads = 0;
        this.MAX_CONSECUTIVE_AUTO_LOADS = 2;
        this.isCircuitBreakerTripped = false;
        this.lastLoadMoreTime = 0;
        this.MIN_LOAD_MORE_INTERVAL_MS = 400;
        this.apiFallbackPage = 1;
        this.observer = null;
        this._isSearching = false;
        this.searchGeneration = 0;
        this.activeSearchController = null;
        this.activeSearchTraceId = null;
        this.activeSearchTraceStartedAt = null;

        // UI State Manager (for search results area)
        const _psm = Utils.createPageStateManager({
            loader: document.querySelector('.initial-loading-content'),
            errorScreen: document.querySelector('.error-message'),
            errorMessage: document.querySelector('.error-message'),
            contentContainer: document.getElementById('resultsGrid')
        });
        // Add setLoading convenience wrapper
        this.page = Object.assign(_psm, {
            setLoading(isLoading) {
                if (isLoading) this.showLoader();
                else this.showContent(); // restores contentContainer visibility
            }
        });

        this.setupEventListeners();
        this.init();
        
        // Standardized movie card navigation
        Utils.bindMovieCardNavigation(this.elements.resultsGrid);
        
        // Tab navigation & Menu delegation
        Utils.bindTabsAndMenus(document);
        
        // Spoiler reveal logic
        Utils.bindSpoilerReveal(document);
    }

    async init() {
        await i18n.init();
        i18n.translatePage();
        await this.initializeUI();
        
        // Listen for language changes
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'UPDATE_QUERY_PLAYBACK') {
                const nativeMediaPlaying = Array.from(document.querySelectorAll('audio,video'))
                    .some(media => Boolean(media.currentSrc || media.src || media.srcObject)
                        && media.readyState >= HTMLMediaElement.HAVE_METADATA
                        && !media.paused && !media.ended && !media.error);
                sendResponse({ isPlaying: nativeMediaPlaying });
                return false;
            }
            if (message.type === 'SETTINGS_UPDATED') {
                this.handleSettingsUpdate(message.settings);
            }
        });
    }

    async handleSettingsUpdate(settings) {
        if (settings.language && settings.language !== this._filterLocale) {
            await i18n.init();
            i18n.translatePage();
            
            // Re-initialize filters to update their labels
            this.initializeFilters();
            this.updateFiltersCount();
            
            if (this.currentQuery) {
                await this.searchMovies();
            }
        }
    }

    initializeElements() {
        return {
            // Navigation
            backBtn: document.getElementById('backBtn'),
            settingsBtn: document.getElementById('settingsBtn'),
            
            // Search
            searchInput: document.getElementById('searchInput'),
            searchBtn: document.getElementById('searchBtn'),
            clearSearchInputBtn: document.getElementById('clearSearchInputBtn'),
            toggleFiltersBtn: document.getElementById('toggleFiltersBtn'),
            filtersCount: document.getElementById('filtersCount'),
            filters: document.getElementById('filters'),
            clearFiltersBtn: document.getElementById('clearFiltersBtn'),
            
            // Search History
            searchInputWrapper: document.querySelector('.search-input-wrapper'),
            searchHistoryDropdown: document.getElementById('searchHistoryDropdown'),
            searchHistoryList: document.getElementById('searchHistoryList'),
            searchHistoryEmpty: document.getElementById('searchHistoryEmpty'),
            clearHistoryBtn: document.getElementById('clearHistoryBtn'),
            
            // Filters
            yearFromFilter: document.getElementById('yearFromFilter'),
            yearToFilter: document.getElementById('yearToFilter'),
            genreCheckboxes: document.getElementById('genreCheckboxes'),
            countryCheckboxes: document.getElementById('countryCheckboxes'),
            applyFiltersBtn: document.getElementById('applyFiltersBtn'),
            
            // Results
            resultsHeader: document.getElementById('resultsHeader'),
            resultsInfo: document.getElementById('resultsInfo'),
            resultsGrid: document.getElementById('resultsGrid'),
            infiniteScrollTrigger: document.getElementById('infiniteScrollTrigger'),
            searchEndOfResults: document.getElementById('searchEndOfResults'),
        };

    }

    setupEventListeners() {
        // Navigation (optional elements for router compatibility)
        if (this.elements.backBtn) {
            this.elements.backBtn.addEventListener('mousedown', () => this.goBack());
        }
        if (this.elements.settingsBtn) {
            this.elements.settingsBtn.addEventListener('mousedown', () => this.openSettings());
        }
        
        // Search
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.performSearch();
            });
            this.elements.searchInput.addEventListener('focus', () => this.showSearchHistory());
            this.elements.searchInput.addEventListener('input', (e) => this.handleSearchInput(e));
        }
        this.elements.clearSearchInputBtn?.addEventListener('click', () => {
            this.elements.searchInput.value = '';
            this.elements.searchInput.focus();
        });
        if (this.elements.searchBtn) {
            this.elements.searchBtn.addEventListener('click', () => this.performSearch());
        }
        
        // Search History
        if (this.elements.clearHistoryBtn) {
            this.elements.clearHistoryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.clearSearchHistory();
            });
        }
        
        // Click outside to close dropdown
        document.addEventListener('mousedown', (e) => {
            if (!this.elements.searchInputWrapper?.contains(e.target)) {
                this.hideSearchHistory();
            }
        });
        if (this.elements.toggleFiltersBtn) {
            this.elements.toggleFiltersBtn.addEventListener('click', () => this.toggleFilters());
        }
        if (this.elements.clearFiltersBtn) {
            this.elements.clearFiltersBtn.addEventListener('click', () => this.clearFilters());
        }
        if (this.elements.applyFiltersBtn) {
            this.elements.applyFiltersBtn.addEventListener('click', () => this.applyFilters());
        }
        // Every choice and year commit inside the panel bubbles a change event.
        this.elements.filters?.addEventListener('change', () => this.updateFiltersCount());
        
        // Infinite scroll observer & scroll event listener (circuit breaker reset)
        this.setupIntersectionObserver();
        window.addEventListener('scroll', () => {
            this.consecutiveAutoLoads = 0;
        }, { passive: true });

        // Status and collection items in the card menu: the shared quick-action handler (on click)
        if (typeof MovieCardActions !== 'undefined') {
            this.cardActions = this.createCardActions().bind(this.elements.resultsGrid);
        }

        // Delegation for the remaining MovieCard actions
        this.elements.resultsGrid.addEventListener('mousedown', (e) => {
            // If it's not a left click, let the browser handle it (e.g. middle click for new tab)
            if (e.button !== 0) return;

            const target = e.target;
            const actionBtn = target.closest('[data-action]');
            
            if (!actionBtn) return;
            
            const action = actionBtn.getAttribute('data-action');
            const movieId = actionBtn.getAttribute('data-movie-id');
            const ratingId = actionBtn.getAttribute('data-rating-id');

            if (action === 'open-review' && movieId) {
                const params = new URLSearchParams({ movieId: String(movieId) });
                if (ratingId) params.set('reviewId', String(ratingId));
                window.location.href = chrome.runtime.getURL(
                    `src/pages/movie-details/movie-details.html?${params.toString()}`
                );
            }
        });

        // Card menus: close on outside click, toggle on the menu button
        document.addEventListener('mousedown', (e) => {
            // Close menus if clicking outside
            if (!e.target.closest('.mc-menu-btn') && !e.target.closest('.mc-menu-dropdown')) {
                document.querySelectorAll('.mc-menu-dropdown.active').forEach(menu => {
                    menu.classList.remove('active');
                });
            }

            if (e.target.closest('.mc-menu-btn')) {
                e.stopPropagation();
                const btn = e.target.closest('.mc-menu-btn');
                const menu = btn.nextElementSibling;
                if (menu && menu.classList.contains('mc-menu-dropdown')) {
                    // Close other menus
                    document.querySelectorAll('.mc-menu-dropdown.active').forEach(m => {
                        if (m !== menu) m.classList.remove('active');
                    });
                    menu.classList.toggle('active');
                }
            }
        });


    }

    async initializeUI() {
        // Keep the search page usable when an optional Firestore read is slow or offline.
        this.showInitialLoading();
        let routeOwnsResults = false;

        try {
            if (!window.firebaseManager) {
                await this.waitForFirebaseManager();
            }

            await firebaseManager.waitForAuthReady();
            if (!firebaseManager.isAuthenticated()) {
                Utils.showToast(i18n.get('search.error_login'), 'error');
                return;
            }

            this.currentUser = firebaseManager.getCurrentUser();
            if (typeof CollectionService !== 'undefined') {
                this.collectionService = new CollectionService();
                void this.loadCollectionsWithTimeout().catch((error) => {
                    console.error('[SearchInit] Failed to refresh collections:', error);
                });
            }

            const urlParams = new URLSearchParams(window.location.search);
            const movieId = urlParams.get('movieId');
            const query = urlParams.get('q') || urlParams.get('query');
            const legacyCatalogType = urlParams.get('type');

            // Search no longer renders a film page of its own: a legacy ?sourceUrl= link
            // (an ex-fs page address, no Kinopoisk id) falls back to the plain search page.
            if (urlParams.has('sourceUrl')) {
                urlParams.delete('sourceUrl');
                const rest = urlParams.toString();
                window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
            }

            if (!movieId && !query && legacyCatalogType) {
                routeOwnsResults = true;
                const category = typeof window.normalizeCatalogCategory === 'function'
                    ? window.normalizeCatalogCategory(legacyCatalogType)
                    : 'films';
                const catalogUrl = chrome.runtime.getURL(`src/pages/catalog/catalog.html?category=${encodeURIComponent(category)}`);
                window.location.replace(catalogUrl);
                return;
            }

            if (movieId) {
                routeOwnsResults = true;
                let redirectUrl = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`);
                if (urlParams.get('autoplay') === 'true') {
                    redirectUrl += '&autoplay=true';
                }
                window.location.replace(redirectUrl);
                return;
            }

            this.initializeFilters();
            this.loadFilterState();
            this.updateFiltersCount();

            if (query) {
                routeOwnsResults = true;
                this.elements.searchInput.value = query;
                this.currentQuery = query;
                this.currentPage = 1;
                await this.searchMovies();
                return;
            }
        } catch (error) {
            console.error('[SearchInit] Failed to initialize search page:', error);
            Utils.showToast(i18n.get('search.error_generic'), 'error');
        } finally {
            if (!routeOwnsResults && this.searchGeneration === 0) {
                this.hideInitialLoading();
            }
        }
    }

    waitForFirebaseManager(timeoutMs = 3000) {
        if (window.firebaseManager) return Promise.resolve(window.firebaseManager);

        return new Promise((resolve, reject) => {
            const startedAt = Date.now();
            const check = () => {
                if (window.firebaseManager) {
                    resolve(window.firebaseManager);
                    return;
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    reject(new Error('Firebase Manager initialization timed out'));
                    return;
                }
                setTimeout(check, 50);
            };
            check();
        });
    }

    async loadCollectionsWithTimeout(timeoutMs = 3000) {
        const collectionsPromise = this.collectionService.getCollections()
            .catch((error) => {
                console.warn('[SearchInit] Failed to load collections:', error);
                return [];
            });
        let timeoutId = null;
        const timeoutPromise = new Promise((resolve) => {
            timeoutId = setTimeout(() => resolve(null), timeoutMs);
        });

        const collections = await Promise.race([collectionsPromise, timeoutPromise]);
        if (timeoutId) clearTimeout(timeoutId);
        if (collections === null) {
            console.warn('[SearchInit] Collections timed out; continuing without them');
            collectionsPromise
                .then((lateCollections) => {
                    this.applyAvailableCollections(lateCollections);
                })
                .catch((error) => {
                    console.error('[SearchInit] Failed to apply late collections:', error);
                });
            return;
        }
        this.applyAvailableCollections(collections);
    }

    applyAvailableCollections(collections) {
        this.availableCollections = Array.isArray(collections) ? collections : [];
        this.refreshCollectionMenus();
    }

    refreshCollectionMenus() {
        if (!this.availableCollections.length || !Array.isArray(this.currentResults?.docs)) return;

        this.currentResults.docs.forEach((movie) => {
            const card = this.getSearchMovieCard(movie?.kinopoiskId);
            const menu = card?.querySelector('.mc-menu');
            if (!menu) return;

            const templateCard = MovieCard.create({
                movie,
                id: null,
                isFavorite: false,
                rating: 0,
                comment: ''
            }, this.getSearchCardOptions(movie));
            const freshCollections = templateCard.querySelector('.mc-menu-collections');
            if (!freshCollections) return;

            const freshDivider = freshCollections.previousElementSibling?.classList.contains('mc-menu-divider')
                ? freshCollections.previousElementSibling
                : null;
            const existingCollections = menu.querySelector('.mc-menu-collections');
            if (existingCollections) {
                const existingDivider = existingCollections.previousElementSibling?.classList.contains('mc-menu-divider')
                    ? existingCollections.previousElementSibling
                    : null;
                if (existingDivider && freshDivider) existingDivider.replaceWith(freshDivider);
                existingCollections.replaceWith(freshCollections);
                return;
            }

            if (freshDivider) menu.appendChild(freshDivider);
            menu.appendChild(freshCollections);
        });
    }

    initializeFilters() {
        this._filterLocale = i18n.currentLocale;
        const previous = new Map();
        for (const container of [this.elements.genreCheckboxes, this.elements.countryCheckboxes]) {
            container.querySelectorAll('[data-filter-id]').forEach(item =>
                previous.set(item.dataset.filterId, item.dataset.filterState));
        }
        const options = DiscoveryFilters.getOptions(i18n);
        const labels = this.getFilterStateLabels();
        const legendLabels = this.getFilterStateLegendLabels();
        let legendId = null;
        for (const [name, prefix, container, captionKey] of [
            ['genres', 'genre', this.elements.genreCheckboxes, 'search.genres'],
            ['countries', 'country', this.elements.countryCheckboxes, 'search.countries']
        ]) {
            container.replaceChildren(...options[name].map(option => {
                const id = `${prefix}-${option.labelKey.split('.').at(-1)}`;
                const item = this.createCheckboxItem(id, option.value, option.label);
                FilterChoice.setState(item, previous.get(id) || 'neutral');
                return item;
            }));
            FilterChoice.enhanceGroup(container, {
                label: i18n.get(captionKey), labels,
                legendLabels,
                showLegend: legendId === null, legendId, compactLimit: 6,
                moreLabel: i18n.get('filter_controls.more'), lessLabel: i18n.get('filter_controls.less')
            });
            legendId ||= container.querySelector('.filter-choices__legend')?.id || null;
            FilterChoice.enhanceSummary(container, {
                empty: i18n.get('filter_controls.any'),
                include: i18n.get('filter_controls.included_count'),
                exclude: i18n.get('filter_controls.excluded_count')
            });
        }
        this.yearRange = RangeControl.enhance(this.elements.yearFromFilter, this.elements.yearToFilter, {
            fromLabel: `${i18n.get('search.year_range')} ${i18n.get('search.from')}`,
            toLabel: `${i18n.get('search.year_range')} ${i18n.get('search.to')}`
        });
        this.yearRange.syncFromNative();
    }

    getFilterStateLabels() {
        return Object.fromEntries(['neutral', 'include', 'exclude'].map(state =>
            [state, i18n.get(`random.tag_states.${state}`)]));
    }

    getFilterStateLegendLabels() {
        return Object.fromEntries(['neutral', 'include', 'exclude'].map(state =>
            [state, i18n.get(`random.tag_state_legend.${state}`)]));
    }

    createCheckboxItem(id, value, label) {
        const item = FilterChoice.create({ id, value, label, className: 'checkbox-item',
            labels: this.getFilterStateLabels() });
        item.dataset.filterId = id;
        item.dataset.filterValue = value;
        return item;
    }

    setupIntersectionObserver() {
        const options = {
            root: null, // Viewport
            rootMargin: '200px',
            threshold: 0.1
        };
        
        this.observer = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (entry && entry.isIntersecting && this.hasMore && !this.isLoadingMore && !this.isCircuitBreakerTripped) {
                this.loadMoreResults();
            }
        }, options);
        
        if (this.elements.infiniteScrollTrigger) {
            this.observer.observe(this.elements.infiniteScrollTrigger);
        }
    }

    showTrigger() {
        const el = this.elements.infiniteScrollTrigger;
        if (!el) return;
        if (this.observer) this.observer.unobserve(el);
        el.style.display = 'flex';
        if (this.observer) this.observer.observe(el);
    }

    hideTrigger() {
        const el = this.elements.infiniteScrollTrigger;
        if (!el) return;
        if (this.observer) this.observer.unobserve(el);
        el.style.display = 'none';
    }

    showEndOfResults() {
        if (this.elements.searchEndOfResults) {
            this.elements.searchEndOfResults.style.display = 'flex';
        }
    }

    hideEndOfResults() {
        if (this.elements.searchEndOfResults) {
            this.elements.searchEndOfResults.style.display = 'none';
        }
    }

    async performSearch() {
        const query = this.elements.searchInput.value.trim();
        if (!query) {
            Utils.showToast(i18n.get('search.error_query'), 'warning');
            return;
        }

        const submitTraceId = createSearchTraceId(this.searchGeneration + 1);
        const submitStartedAt = searchTraceNow();
        this.logSearchTrace(submitTraceId, this.searchGeneration + 1, submitStartedAt, 'search-submit:start', { query });
        
        // Hide search history dropdown
        this.hideSearchHistory();
        
        // Add to search history
        const historyStartedAt = searchTraceNow();
        await this.searchHistoryService.addToHistory(query);
        this.logSearchTrace(submitTraceId, this.searchGeneration + 1, submitStartedAt, 'search-history:end', {
            stageDurationMs: searchTraceDurationMs(historyStartedAt)
        });
        
        this.currentQuery = query;
        this.currentPage = 1;
        await this.searchMovies({ traceId: submitTraceId, startedAt: submitStartedAt });
    }

    isCurrentSearchGeneration(generation) {
        return generation === this.searchGeneration;
    }

    logSearchTrace(traceId, generation, startedAt, stage, details = {}) {
        console.info('[SearchTrace]', {
            traceId,
            generation,
            stage,
            elapsedMs: searchTraceDurationMs(startedAt),
            ...details
        });
    }

    async searchMovies(traceContext = null) {
        const searchGeneration = ++this.searchGeneration;
        this.activeSearchController?.abort();

        const searchController = typeof AbortController === 'function'
            ? new AbortController()
            : null;
        this.activeSearchController = searchController;
        const query = this.currentQuery;
        const searchTraceId = traceContext?.traceId || createSearchTraceId(searchGeneration);
        const searchStartedAt = traceContext?.startedAt || searchTraceNow();
        this.activeSearchTraceId = searchTraceId;
        this.activeSearchTraceStartedAt = searchStartedAt;
        this._isSearching = true;
        this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'search:start', {
            query,
            hasAbortController: Boolean(searchController)
        });

        try {
            // Reset infinite scroll state
            this.currentResults = { docs: [], total: 0, pages: 0 };
            this.scrapedPool = [];
            this.renderedMovieIds.clear();
            this.hasMore = false;
            this.isLoadingMore = false;
            this.consecutiveAutoLoads = 0;
            this.isCircuitBreakerTripped = false;
            this.apiFallbackPage = 1;
            
            this.elements.resultsHeader.style.display = 'none';
            this.hideTrigger();
            this.hideEndOfResults();
            this.showSearchLoading();
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'search:state-reset');
            
            // Wait for firebaseManager to be ready
            const firebaseWaitStartedAt = searchTraceNow();
            const firebaseWasReady = Boolean(window.firebaseManager);
            if (!firebaseWasReady) {
                await this.waitForFirebaseManager();
            }
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'firebase:ready', {
                stageDurationMs: searchTraceDurationMs(firebaseWaitStartedAt),
                wasAlreadyReady: firebaseWasReady
            });
            
            const kinopoiskService = firebaseManager.getKinopoiskService();
            
            // Check if API is configured
            if (!kinopoiskService.isConfigured()) {
                this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'provider-config:missing');
                Utils.showToast(i18n.get('search.error_api'), 'error');
                return;
            }
            
            // Get current filters
            const filters = this.getSelectedFilters();
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'filters:ready', {
                filterKeys: Object.keys(filters || {}).filter(key => key !== 'signal')
            });

            // Search movies (first page / scrape candidates pool)
            const providerStartedAt = searchTraceNow();
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'provider-search:start', {
                provider: 'kinopoisk',
                query
            });
            let searchResults = await kinopoiskService.searchMovies(
                query,
                1,
                30,
                {
                    ...filters,
                    signal: searchController?.signal,
                    searchTraceId,
                    searchTraceStartedAt: searchStartedAt,
                    deferEntityResolution: true
                }
            );
            if (searchResults?.entityResolutionDeferred && searchResults.entityResolutionPromise) {
                const enrichmentStartedAt = searchTraceNow();
                this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'entity-enrichment:wait-for-render', {
                    candidateCount: searchResults.docs?.length || 0
                });
                const enrichedMovies = await searchResults.entityResolutionPromise;
                if (!this.isCurrentSearchGeneration(searchGeneration)) return;

                const resolvedDocs = Array.isArray(enrichedMovies) ? enrichedMovies : [];
                searchResults = {
                    ...searchResults,
                    docs: resolvedDocs,
                    total: resolvedDocs.length,
                    totalScraped: resolvedDocs.length,
                    entityResolutionDeferred: false
                };
                this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'entity-enrichment:ready-for-render', {
                    stageDurationMs: searchTraceDurationMs(enrichmentStartedAt),
                    resolvedCount: resolvedDocs.length,
                    status: resolvedDocs.length > 0 ? 'fulfilled' : 'empty'
                });
            }
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'provider-search:end', {
                provider: 'kinopoisk',
                stageDurationMs: searchTraceDurationMs(providerStartedAt),
                searchSource: searchResults?.searchSource || null,
                resultCount: searchResults?.docs?.length || 0,
                total: searchResults?.totalScraped || searchResults?.total || 0,
                entityResolutionDeferred: searchResults?.entityResolutionDeferred === true
            });

            if (!this.isCurrentSearchGeneration(searchGeneration)) return;
            
            // Catalogue stubs (cancelled projects, fan shorts) give a viewer nothing to open.
            const foundDocs = searchResults?.docs || [];
            const realDocs = kinopoiskService.withoutEmptyRecords?.(foundDocs, query) ?? foundDocs;
            if (realDocs.length !== foundDocs.length) {
                const hidden = foundDocs.length - realDocs.length;
                searchResults = {
                    ...searchResults,
                    docs: realDocs,
                    total: Math.max(realDocs.length, (searchResults.total || 0) - hidden),
                    totalScraped: searchResults.totalScraped ? searchResults.totalScraped - hidden : searchResults.totalScraped
                };
            }

            // Apply client-side filtering (for filters not supported by API)
            let filteredDocs = searchResults?.docs || [];
            if (searchResults && searchResults.docs) {
                filteredDocs = this.applyClientSideFilters(searchResults.docs, filters);
            }
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'client-filter:end', {
                inputCount: searchResults?.docs?.length || 0,
                outputCount: filteredDocs.length
            });
            
            this.currentResults = {
                ...searchResults,
                docs: filteredDocs,
                total: searchResults?.totalScraped || searchResults?.total || filteredDocs.length
            };
            
            if (filteredDocs.length === 0) {
                this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'results:empty');
                this.displayEmptyResults(searchResults?.docs?.length || 0);
                return;
            }
            
            // Show results header
            this.elements.resultsHeader.style.display = 'flex';
            this.resultsFiltered = this.countActiveFilters(filters) > 0;
            this.renderResultsCount(filteredDocs.length);
            this.elements.resultsGrid.classList.remove('single-item');
            
            // Kinopoisk-ordered candidate pools: hidden-page scrapes and the GraphQL search.
            const isScrapeSource = /scrape|graphql/.test(searchResults?.searchSource || '');
            const renderStartedAt = searchTraceNow();
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'cards-render:start', {
                source: isScrapeSource ? 'scrape-pool' : 'api',
                chunkSize: this.CHUNK_SIZE,
                orderedResultCount: filteredDocs.length
            });
            if (isScrapeSource) {
                this.scrapedPool = [...filteredDocs];
                const firstChunk = this.scrapedPool.splice(0, this.CHUNK_SIZE);
                
                // If there are more items in scrape pool or potential API fallback
                const hasFilters = filters.yearFrom || (filters.genresInclude && filters.genresInclude.length > 0) || (filters.countriesInclude && filters.countriesInclude.length > 0);
                // Scraper returns up to 25-30 top matches. If total scraped is < 20 (e.g. 11), all matches are already in memory.
                this.hasMore = this.scrapedPool.length > 0 || (filteredDocs.length >= 20 && !hasFilters);
                
                await this.renderMovieCardsChunk(firstChunk, false, searchGeneration, searchTraceId);
                this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'cards-render:end', {
                    stageDurationMs: searchTraceDurationMs(renderStartedAt),
                    renderedCount: firstChunk.length,
                    hasMore: this.hasMore
                });
            } else {
                // Direct API search
                const firstChunk = filteredDocs.slice(0, this.CHUNK_SIZE);
                if (filteredDocs.length > this.CHUNK_SIZE) {
                    this.scrapedPool = filteredDocs.slice(this.CHUNK_SIZE);
                }
                this.hasMore = filteredDocs.length > this.CHUNK_SIZE || (searchResults.pages && searchResults.pages > 1);
                
                await this.renderMovieCardsChunk(firstChunk, false, searchGeneration, searchTraceId);
                this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'cards-render:end', {
                    stageDurationMs: searchTraceDurationMs(renderStartedAt),
                    renderedCount: firstChunk.length,
                    hasMore: this.hasMore
                });
            }
            
        } catch (error) {
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'search:error', {
                errorName: error?.name || 'Error',
                errorMessage: error?.message || String(error),
                isCurrentGeneration: this.isCurrentSearchGeneration(searchGeneration)
            });
            if (!this.isCurrentSearchGeneration(searchGeneration)) return;
            if (error?.name === 'AbortError') return;
            console.error('Search error:', error);
            
            let errorMessage = i18n.get('search.error_generic');
            const errorMessageText = error?.message || '';
            if (errorMessageText.includes('DAILY_LIMIT_REACHED') || errorMessageText.includes('403')) {
                this.isCircuitBreakerTripped = true;
                this.hasMore = false;
                errorMessage = i18n.get('search.error_forbidden');
            } else if (errorMessageText.includes('500')) {
                if (this.hasCyrillic(query)) {
                    errorMessage = i18n.get('search.error_cyrillic').replace('{query}', query);
                } else {
                    errorMessage = i18n.get('search.error_server');
                }
            } else if (errorMessageText.includes('404')) {
                errorMessage = i18n.get('search.error_not_found');
            } else if (errorMessageText.includes('network') || errorMessageText.includes('fetch')) {
                errorMessage = i18n.get('search.error_network');
            }
            
            Utils.showToast(errorMessage, 'error');
        } finally {
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'search:complete', {
                status: this.isCurrentSearchGeneration(searchGeneration) ? 'active' : 'stale',
                resultCount: this.currentResults?.docs?.length || 0
            });
            if (this.isCurrentSearchGeneration(searchGeneration)) {
                this.hideSearchLoading();
                if (!this.elements.resultsGrid.querySelector('.movie-card-component, .empty-state')) {
                    this.displayEmptyResults();
                }
                this.page.setLoading(false);
                this._isSearching = false;
                if (this.activeSearchController === searchController) {
                    this.activeSearchController = null;
                }
            }
        }
    }

    async loadMoreResults() {
        if (this.isLoadingMore || !this.hasMore || this.isCircuitBreakerTripped) return;

        const searchGeneration = this.searchGeneration;
        const query = this.currentQuery;
        const searchTraceId = this.activeSearchTraceId;
        const searchStartedAt = this.activeSearchTraceStartedAt || searchTraceNow();
        const loadMoreStartedAt = searchTraceNow();
        
        const now = performance.now();
        if (now - this.lastLoadMoreTime < this.MIN_LOAD_MORE_INTERVAL_MS) return;
        
        if (this.consecutiveAutoLoads >= this.MAX_CONSECUTIVE_AUTO_LOADS) {
            console.warn('SearchManager: Circuit breaker tripped after consecutive auto-loads without scroll');
            return;
        }
        
        this.consecutiveAutoLoads++;
        this.lastLoadMoreTime = now;
        this.isLoadingMore = true;
        this.showTrigger();
        this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'load-more:start', {
            query,
            poolCountBefore: this.scrapedPool.length,
            renderedCount: this.renderedMovieIds.size
        });
        
        try {
            // Priority 1: Serve from in-memory pool (scraped candidates)
            if (this.scrapedPool.length > 0) {
                const nextChunk = this.scrapedPool.splice(0, this.CHUNK_SIZE);
                this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'load-more:pool-chunk', {
                    stageDurationMs: searchTraceDurationMs(loadMoreStartedAt),
                    chunkCount: nextChunk.length,
                    poolCountAfter: this.scrapedPool.length
                });
                if (this.scrapedPool.length === 0) {
                    const filters = this.getSelectedFilters();
                    const hasFilters = filters.yearFrom || (filters.genresInclude && filters.genresInclude.length > 0) || (filters.countriesInclude && filters.countriesInclude.length > 0);
                    // For scrape queries with < 20 items or active filters, all items are exhausted
                    if (this.renderedMovieIds.size < 20 || hasFilters) {
                        this.hasMore = false;
                    }
                }
                if (this.isCurrentSearchGeneration(searchGeneration)) {
                    await this.renderMovieCardsChunk(nextChunk, true, searchGeneration, searchTraceId);
                }
                return;
            }
            
            // Priority 2: API Fallback for additional pages
            const kinopoiskService = firebaseManager?.getKinopoiskService();
            if (!kinopoiskService || !kinopoiskService.isConfigured()) {
                this.hasMore = false;
                this.hideTrigger();
                this.showEndOfResults();
                return;
            }
            
            this.apiFallbackPage++;
            const filters = this.getSelectedFilters();
            const fallbackStartedAt = searchTraceNow();
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'load-more:api-start', {
                page: this.apiFallbackPage,
                query
            });
            const fallbackResults = await kinopoiskService.searchMovies(
                query,
                this.apiFallbackPage,
                this.CHUNK_SIZE,
                {
                    ...filters,
                    skipScraper: true,
                    signal: this.activeSearchController?.signal,
                    searchTraceId,
                    searchTraceStartedAt: searchStartedAt
                }
            );
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'load-more:api-end', {
                stageDurationMs: searchTraceDurationMs(fallbackStartedAt),
                page: this.apiFallbackPage,
                resultCount: fallbackResults?.docs?.length || 0
            });

            if (!this.isCurrentSearchGeneration(searchGeneration)) return;
            
            let docs = fallbackResults?.docs || [];
            if (docs.length > 0) {
                docs = kinopoiskService.withoutEmptyRecords?.(docs, query, { laterPage: true }) ?? docs;
                docs = this.applyClientSideFilters(docs, filters);
                // Deduplicate against already rendered movie IDs
                const uniqueNewMovies = docs.filter(m => !this.renderedMovieIds.has(m.kinopoiskId) && !this.renderedMovieIds.has(String(m.kinopoiskId)));
                
                if (uniqueNewMovies.length > 0) {
                    this.hasMore = fallbackResults.docs.length >= this.CHUNK_SIZE && (fallbackResults.pages ? this.apiFallbackPage < fallbackResults.pages : true);
                    await this.renderMovieCardsChunk(uniqueNewMovies, true, searchGeneration, searchTraceId);
                    this.renderResultsCount(this.renderedMovieIds.size);
                } else if (fallbackResults.docs.length >= this.CHUNK_SIZE) {
                    this.hasMore = this.apiFallbackPage < (fallbackResults.pages || 10);
                } else {
                    this.hasMore = false;
                }
            } else {
                this.hasMore = false;
            }
            
            if (!this.hasMore) {
                this.hideTrigger();
                this.showEndOfResults();
            }
        } catch (error) {
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'load-more:error', {
                stageDurationMs: searchTraceDurationMs(loadMoreStartedAt),
                errorName: error?.name || 'Error',
                errorMessage: error?.message || String(error),
                isCurrentGeneration: this.isCurrentSearchGeneration(searchGeneration)
            });
            if (!this.isCurrentSearchGeneration(searchGeneration)) return;
            if (error?.name === 'AbortError') return;
            console.error('Error loading more search results:', error);
            const errorMessage = error?.message || '';
            if (errorMessage.includes('DAILY_LIMIT_REACHED') || errorMessage.includes('403')) {
                this.isCircuitBreakerTripped = true;
                this.hasMore = false;
                Utils.showToast(i18n.get('search.error_forbidden'), 'error');
            }
            this.hideTrigger();
        } finally {
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'load-more:complete', {
                stageDurationMs: searchTraceDurationMs(loadMoreStartedAt),
                status: this.isCurrentSearchGeneration(searchGeneration) ? 'active' : 'stale',
                renderedCount: this.renderedMovieIds.size,
                hasMore: this.hasMore
            });
            if (this.isCurrentSearchGeneration(searchGeneration)) {
                this.isLoadingMore = false;
            }
        }
    }

    /** @param {number} hiddenCount - titles the query found but the filters left out */
    displayEmptyResults(hiddenCount = 0) {
        const title = hiddenCount > 0 ? 'hidden_by_filters_title' : 'no_results_title';
        const text = hiddenCount > 0
            ? i18n.get('search.hidden_by_filters_text').replace('{count}', hiddenCount)
            : i18n.get('search.no_results_text');
        this.elements.resultsGrid.removeAttribute('aria-busy');
        this.elements.resultsGrid.classList.add('single-item');
        this.elements.resultsGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><svg data-icon="SEARCH" aria-hidden="true" width="40" height="40" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3A6 6 0 1 0 9 15A6 6 0 1 0 9 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M9 3L9 15C12.32 15 15 12.31 15 9C15 5.69 12.32 3 9 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M13.6 13.6L17.6 17.6"/></svg></div>
                <h3 class="empty-state-title">${i18n.get(`search.${title}`)}</h3>
                <p class="empty-state-text">${text}</p>
                ${hiddenCount > 0 ? `<button type="button" class="btn btn-secondary empty-state-btn">${i18n.get('search.clear_filters_action')}</button>` : ''}
            </div>
        `;
        this.elements.resultsGrid.querySelector('.empty-state-btn')?.addEventListener('click', () => this.clearFilters());
        this.elements.resultsHeader.style.display = 'none';
        this.hideTrigger();
        this.hideEndOfResults();
    }

    async renderMovieCardsChunk(
        movies,
        append = true,
        searchGeneration = this.searchGeneration,
        searchTraceId = this.activeSearchTraceId
    ) {
        if (!this.isCurrentSearchGeneration(searchGeneration)) return;

        const renderStartedAt = searchTraceNow();
        const searchStartedAt = this.activeSearchTraceStartedAt || renderStartedAt;
        this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'cards-render:method-start', {
            append,
            movieCount: movies?.length || 0
        });

        if (!movies || movies.length === 0) {
            if (!append) this.displayEmptyResults();
            return;
        }
        
        if (!append) {
            this.hideSearchLoading();
            this.elements.resultsGrid.innerHTML = '';
        }
        
        // Register rendered IDs for deduplication
        movies.forEach(m => {
            if (m.kinopoiskId) {
                this.renderedMovieIds.add(m.kinopoiskId);
                this.renderedMovieIds.add(String(m.kinopoiskId));
                this.renderedMovieIds.add(Number(m.kinopoiskId));
            }
        });
        
        const fragment = document.createDocumentFragment();
        
        movies.forEach(movie => {
            // Clean title
            if (movie.name) movie.name = Utils.cleanTitle(movie.name);
            if (movie.nameRu) movie.nameRu = Utils.cleanTitle(movie.nameRu);
            if (movie.nameEn) movie.nameEn = Utils.cleanTitle(movie.nameEn);

            // Prepare data for MovieCard
            const cardData = {
                movie: movie,
                id: null,
                isFavorite: false,
                rating: 0,
                comment: '',
            };
            
            // Options for MovieCard
            const cardOptions = this.getSearchCardOptions(movie);
            
            const cardElement = MovieCard.create(cardData, cardOptions);
            
            // Make entire card clickable
            cardElement.style.cursor = 'var(--cursor-pointer, pointer)';
            cardElement.setAttribute('data-action', 'view-details');
            cardElement.setAttribute('data-movie-id', movie.kinopoiskId);
            cardElement.dataset.personalState = this.currentUser ? 'pending' : 'not-required';
            
            fragment.appendChild(cardElement);
        });
        
        this.elements.resultsGrid.appendChild(fragment);
        this.hideSearchLoading();
        this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'cards-render:dom-appended', {
            stageDurationMs: searchTraceDurationMs(renderStartedAt),
            movieCount: movies.length,
            personalHydrationScheduled: Boolean(this.currentUser && window.firebaseManager)
        });
        
        // Update trigger / end of results indicator visibility
        if (this.hasMore) {
            this.showTrigger();
            this.hideEndOfResults();
        } else {
            this.hideTrigger();
            this.showEndOfResults();
        }

        // Personal state is optional and must never delay the ordered card render.
        if (this.currentUser && window.firebaseManager) {
            this.hydratePersonalState(movies, searchGeneration, searchTraceId).catch(error => {
                console.error('Error hydrating search personal state:', error);
            });
        } else {
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'personal-hydration:skipped', {
                reason: this.currentUser ? 'firebase-not-ready' : 'unauthenticated'
            });
        }
    }

    getSearchMovieCard(movieId) {
        const normalizedMovieId = String(Number(movieId));
        return Array.from(this.elements.resultsGrid.querySelectorAll('.movie-card-component'))
            .find(card => String(Number(card.dataset.movieId)) === normalizedMovieId) || null;
    }

    getSearchCardOptions(movie) {
        const collections = this.availableCollections || [];
        return {
            variant: 'search',
            showFavorite: true,
            showWatching: true,
            showWatchlist: true,
            showUserInfo: false,
            showAverageRating: true,
            showThreeDotMenu: true,
            showEditRating: false,
            showAddToCollection: false,
            availableCollections: collections,
            movieCollections: collections
                .filter(c => c.movieIds && (c.movieIds.includes(Number(movie.kinopoiskId)) || c.movieIds.includes(String(movie.kinopoiskId))))
                .map(c => c.id)
        };
    }

    getProviderRating(movie, provider) {
        if (!movie) return 0;

        if (provider === 'kp') {
            return Number(
                movie.kpRating
                ?? movie.ratingKp
                ?? movie.ratingKinopoisk
                ?? (typeof movie.rating === 'object' ? movie.rating?.kp : movie.rating)
                ?? 0
            ) || 0;
        }

        return Number(
            movie.imdbRating
            ?? movie.ratingImdb
            ?? (typeof movie.rating === 'object' ? movie.rating?.imdb : 0)
            ?? 0
        ) || 0;
    }

    applyPersonalRating(movie, rating) {
        const card = this.getSearchMovieCard(movie?.kinopoiskId);
        if (!card) return;

        const userRating = Number(rating?.rating) || 0;
        MovieCard.updateCompactRatings(card, {
            kpRating: this.getProviderRating(movie, 'kp'),
            imdbRating: this.getProviderRating(movie, 'imdb'),
            userRating,
            showUnavailable: false
        });

        if (userRating > 0) {
            card.dataset.userRating = String(userRating);
        } else {
            delete card.dataset.userRating;
        }

        const favoriteButton = card.querySelector('[data-action="toggle-favorite"]');
        if (favoriteButton) {
            favoriteButton.setAttribute('data-rating-id', rating?.id || '');
        }
    }

    async hydratePersonalState(movies, searchGeneration, searchTraceId = this.activeSearchTraceId) {
        if (!this.currentUser || !this.isCurrentSearchGeneration(searchGeneration)) return;

        const searchStartedAt = this.activeSearchTraceStartedAt || searchTraceNow();
        const hydrationStartedAt = searchTraceNow();
        this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'personal-hydration:start', {
            movieCount: movies.length
        });

        const movieIds = movies
            .map(movie => Number(movie?.kinopoiskId))
            .filter(movieId => Number.isInteger(movieId) && movieId > 0);
        if (movieIds.length === 0) {
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'personal-hydration:skipped', {
                reason: 'no-valid-movie-ids'
            });
            return;
        }

        const ratingService = firebaseManager.getRatingService();
        const ratingsStartedAt = searchTraceNow();
        this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'personal-ratings:start', {
            movieCount: movieIds.length,
            uniqueMovieCount: new Set(movieIds).size
        });
        const ratingsPromise = typeof ratingService.getUserRatingsForMovies === 'function'
            ? ratingService.getUserRatingsForMovies(this.currentUser.uid, movieIds)
            : Promise.reject(new Error('Batch personal-rating API is unavailable'));
        const tracedRatingsPromise = ratingsPromise.then(result => {
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'personal-ratings:end', {
                stageDurationMs: searchTraceDurationMs(ratingsStartedAt),
                ratingCount: result instanceof Map ? result.size : null,
                status: 'fulfilled'
            });
            return result;
        }, error => {
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'personal-ratings:error', {
                stageDurationMs: searchTraceDurationMs(ratingsStartedAt),
                status: 'rejected',
                errorName: error?.name || 'Error',
                errorMessage: error?.message || String(error)
            });
            throw error;
        });

        const bookmarksStartedAt = searchTraceNow();
        this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'personal-bookmarks:start', {
            movieCount: movieIds.length
        });
        const bookmarksPromise = this.updateButtonStates(movies, searchGeneration, searchTraceId).then(result => {
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'personal-bookmarks:end', {
                stageDurationMs: searchTraceDurationMs(bookmarksStartedAt),
                status: result === true ? 'fulfilled' : 'degraded'
            });
            return result;
        }, error => {
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'personal-bookmarks:error', {
                stageDurationMs: searchTraceDurationMs(bookmarksStartedAt),
                status: 'rejected',
                errorName: error?.name || 'Error',
                errorMessage: error?.message || String(error)
            });
            throw error;
        });

        const [ratingsResult, bookmarksResult] = await Promise.allSettled([
            tracedRatingsPromise,
            bookmarksPromise
        ]);

        this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'personal-hydration:complete', {
            stageDurationMs: searchTraceDurationMs(hydrationStartedAt),
            ratingsStatus: ratingsResult.status,
            bookmarksStatus: bookmarksResult.status
        });

        if (!this.isCurrentSearchGeneration(searchGeneration)) {
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'personal-hydration:stale');
            return;
        }

        const ratingsReady = ratingsResult.status === 'fulfilled' && ratingsResult.value instanceof Map;
        if (ratingsReady) {
            movies.forEach(movie => {
                const rating = ratingsResult.value.get(String(Number(movie.kinopoiskId))) || null;
                this.applyPersonalRating(movie, rating);
            });
        } else {
            console.warn('SearchManager: Personal ratings hydration degraded:', ratingsResult.reason);
        }

        const bookmarksReady = bookmarksResult.status === 'fulfilled' && bookmarksResult.value === true;
        movies.forEach(movie => {
            const card = this.getSearchMovieCard(movie?.kinopoiskId);
            if (card) {
                card.dataset.personalState = ratingsReady && bookmarksReady ? 'ready' : 'degraded';
            }
        });
        this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'personal-hydration:dom-patched', {
            ratingsReady,
            bookmarksReady,
            movieCount: movies.length
        });
    }

    toggleFilters() {
        const isVisible = this.elements.filters.style.display !== 'none';
        this.elements.filters.style.display = isVisible ? 'none' : 'grid';
        this.elements.toggleFiltersBtn.setAttribute('aria-expanded', String(!isVisible));
        this.elements.toggleFiltersBtn.setAttribute('aria-controls', 'filters');
        const label = this.elements.toggleFiltersBtn.querySelector('[data-i18n="search.filters_btn"]');
        if (label) label.textContent = i18n.get('search.filters_btn');
    }

    clearFilters() {
        this.elements.yearFromFilter.value = '';
        this.elements.yearToFilter.value = '';
        this.yearRange?.syncFromNative();
        for (const container of [this.elements.genreCheckboxes, this.elements.countryCheckboxes]) {
            container.querySelectorAll('.checkbox-item').forEach(item => FilterChoice.setState(item, 'neutral'));
        }
        // Persist open bounds as empty values.
        this.saveFilterState();
        this.updateFiltersCount();
        // Results on screen were cut by the filters just cleared.
        if (this.resultsFiltered || this.elements.resultsGrid?.querySelector('.empty-state-btn')) this.searchAgain();
    }

    applyFilters() {
        this.saveFilterState();
        // Without a title there is nothing to search yet: the filters wait for one.
        if (!this.elements.searchInput.value.trim()) this.elements.searchInput.focus();
        else this.performSearch();
    }

    /** Repeats the query on screen, unless another title is being typed. */
    searchAgain() {
        if (this.currentQuery && this.elements.searchInput.value.trim() === this.currentQuery) this.performSearch();
    }

    /** The year range counts once, every included or excluded choice separately. */
    countActiveFilters(filters = this.getSelectedFilters()) {
        return (filters.yearFrom || filters.yearTo ? 1 : 0)
            + [filters.genresInclude, filters.genresExclude, filters.countriesInclude, filters.countriesExclude]
                .reduce((total, values) => total + (values?.length || 0), 0);
    }

    updateFiltersCount() {
        const badge = this.elements.filtersCount;
        if (!badge) return;
        const count = this.countActiveFilters();
        badge.hidden = count === 0;
        badge.textContent = String(count);
        if (count) this.elements.toggleFiltersBtn.setAttribute('aria-label', i18n.get('search.filters_active').replace('{count}', count));
        else this.elements.toggleFiltersBtn.removeAttribute('aria-label');
    }

    renderResultsCount(fitting) {
        this.elements.resultsInfo.textContent = this.resultsFiltered
            ? i18n.get('search.found_filtered').replace('{count}', fitting)
            : i18n.get('search.found_count').replace('{count}', this.currentResults.total);
    }

    getSelectedFilters() {
        this.yearRange?.syncFromNative();
        const filters = {
            yearFrom: this.elements.yearFromFilter.value ? parseInt(this.elements.yearFromFilter.value) : null,
            yearTo: this.elements.yearToFilter.value ? parseInt(this.elements.yearToFilter.value) : null,
            genresInclude: [],
            genresExclude: [],
            countriesInclude: [],
            countriesExclude: []
        };
        
        // Get genre filters by state
        this.elements.genreCheckboxes.querySelectorAll('.checkbox-item').forEach(item => {
            const state = item.getAttribute('data-filter-state');
            const value = item.getAttribute('data-filter-value');
            
            if (state === 'include') {
                filters.genresInclude.push(value);
            } else if (state === 'exclude') {
                filters.genresExclude.push(value);
            }
        });

        // Get country filters by state
        this.elements.countryCheckboxes.querySelectorAll('.checkbox-item').forEach(item => {
            const state = item.getAttribute('data-filter-state');
            const value = item.getAttribute('data-filter-value');
            
            if (state === 'include') {
                filters.countriesInclude.push(value);
            } else if (state === 'exclude') {
                filters.countriesExclude.push(value);
            }
        });
        
        return filters;
    }

    goBack() {
        window.close();
    }

    openSettings() {
        Utils.showToast('Settings feature coming soon!', 'info');
    }

    /**
     * Apply client-side filtering to movie results
     * Used for filters not supported by the API or for additional filtering
     */
    applyClientSideFilters(movies, filters) {
        if (!movies || movies.length === 0) return movies;
        
        return movies.filter(movie => {
            // Year range filter
            if (filters.yearFrom && movie.year < filters.yearFrom) return false;
            if (filters.yearTo && movie.year > filters.yearTo) return false;
            
            // Genre include filter (movie must have at least one of these genres)
            if (filters.genresInclude && filters.genresInclude.length > 0) {
                const movieGenres = typeof Utils !== 'undefined' && Utils.normalizeGenres ? Utils.normalizeGenres(movie.genres) : (movie.genres || []);
                const hasIncludedGenre = filters.genresInclude.some(genre =>
                    movieGenres.some(mg => (typeof mg === 'string' ? mg.toLowerCase() : '') === genre.toLowerCase())
                );
                if (!hasIncludedGenre) return false;
            }
            
            // Genre exclude filter (movie must not have any of these genres)
            if (filters.genresExclude && filters.genresExclude.length > 0) {
                const movieGenres = typeof Utils !== 'undefined' && Utils.normalizeGenres ? Utils.normalizeGenres(movie.genres) : (movie.genres || []);
                const hasExcludedGenre = filters.genresExclude.some(genre =>
                    movieGenres.some(mg => (typeof mg === 'string' ? mg.toLowerCase() : '') === genre.toLowerCase())
                );
                if (hasExcludedGenre) return false;
            }
            
            // Country include filter (movie must be from at least one of these countries)
            if (filters.countriesInclude && filters.countriesInclude.length > 0) {
                const movieCountries = typeof Utils !== 'undefined' && Utils.normalizeCountries ? Utils.normalizeCountries(movie.countries) : (movie.countries || []);
                const hasIncludedCountry = filters.countriesInclude.some(country =>
                    movieCountries.some(mc => (typeof mc === 'string' ? mc.toLowerCase() : '') === country.toLowerCase())
                );
                if (!hasIncludedCountry) return false;
            }
            
            // Country exclude filter (movie must not be from any of these countries)
            if (filters.countriesExclude && filters.countriesExclude.length > 0) {
                const movieCountries = typeof Utils !== 'undefined' && Utils.normalizeCountries ? Utils.normalizeCountries(movie.countries) : (movie.countries || []);
                const hasExcludedCountry = filters.countriesExclude.some(country =>
                    movieCountries.some(mc => (typeof mc === 'string' ? mc.toLowerCase() : '') === country.toLowerCase())
                );
                if (hasExcludedCountry) return false;
            }
            
            return true;
        });
    }

    /**
     * Save current filter state to localStorage
     */
    saveFilterState() {
        const filterState = {
            openYears: true,
            yearFrom: this.elements.yearFromFilter.value,
            yearTo: this.elements.yearToFilter.value,
            genres: [],
            countries: []
        };

        // Save genre filter states
        this.elements.genreCheckboxes.querySelectorAll('.checkbox-item').forEach(item => {
            const state = item.getAttribute('data-filter-state');
            if (state !== 'neutral') {
                filterState.genres.push({
                    id: item.getAttribute('data-filter-id'),
                    value: item.getAttribute('data-filter-value'),
                    state: state
                });
            }
        });

        // Save country filter states
        this.elements.countryCheckboxes.querySelectorAll('.checkbox-item').forEach(item => {
            const state = item.getAttribute('data-filter-state');
            if (state !== 'neutral') {
                filterState.countries.push({
                    id: item.getAttribute('data-filter-id'),
                    value: item.getAttribute('data-filter-value'),
                    state: state
                });
            }
        });

        localStorage.setItem('movieSearchFilters', JSON.stringify(filterState));
    }

    /**
     * Load filter state from localStorage
     */
    loadFilterState() {
        try {
            const savedState = localStorage.getItem('movieSearchFilters');
            if (!savedState) return;
            const filterState = JSON.parse(savedState);
            if (!filterState || typeof filterState !== 'object' || Array.isArray(filterState)) return;
            // The upper year used to fill itself in with the current one and was saved as a choice.
            if (!filterState.openYears && !filterState.yearFrom && Number(filterState.yearTo) === new Date().getFullYear()) filterState.yearTo = '';
            for (const [key, input] of [['yearFrom', this.elements.yearFromFilter], ['yearTo', this.elements.yearToFilter]]) {
                if (Object.hasOwn(filterState, key)) input.value = filterState[key] ?? '';
            }
            this.yearRange?.syncFromNative();
            for (const [key, container] of [['genres', this.elements.genreCheckboxes], ['countries', this.elements.countryCheckboxes]]) {
                for (const saved of Array.isArray(filterState[key]) ? filterState[key] : []) {
                    // Stable IDs migrate older localized values without altering provider data.
                    const item = Array.from(container.querySelectorAll('.checkbox-item'))
                        .find(choice => choice.dataset.filterId === saved?.id);
                    if (item) FilterChoice.setState(item, saved.state);
                }
            }
        } catch (error) {
            console.error('Error loading filter state:', error);
        }
    }

    showLoading(show) {
        // No-op: Using modal loader in results grid instead
    }

    getSearchLoadingMarkup() {
        return `
            <div class="initial-loading-content search-loading-state app-loader app-loader--section" role="status" aria-live="polite">
                <div class="app-loader__indicator" aria-hidden="true"></div>
                <h3 class="loading-title">Ищем фильмы</h3>
                <p class="loading-text app-loader__label">Ищем фильмы…</p>
            </div>
        `;
    }

    showSearchLoading() {
        const resultsGrid = this.elements.resultsGrid;
        if (!resultsGrid) return;

        this.hideTrigger();
        this.hideEndOfResults();
        resultsGrid.classList.add('single-item');
        resultsGrid.setAttribute('aria-busy', 'true');

        const existingLoader = resultsGrid.querySelector('.search-loading-state');
        if (!existingLoader) {
            resultsGrid.innerHTML = this.getSearchLoadingMarkup();
        }

        const loaderDiagnostics = {
            action: existingLoader ? 'reuse' : 'show',
            generation: this.searchGeneration,
            traceId: this.activeSearchTraceId || null,
            elapsedMs: this.activeSearchTraceStartedAt
                ? searchTraceDurationMs(this.activeSearchTraceStartedAt)
                : null
        };
        if (this.activeSearchTraceId && this.activeSearchTraceStartedAt) {
            this.logSearchTrace(
                this.activeSearchTraceId,
                this.searchGeneration,
                this.activeSearchTraceStartedAt,
                `loader:${loaderDiagnostics.action}`
            );
        } else {
            console.info('[SearchLoader]', loaderDiagnostics);
        }
    }

    hideSearchLoading() {
        const resultsGrid = this.elements.resultsGrid;
        if (!resultsGrid) return;

        const hadLoader = Boolean(resultsGrid.querySelector('.search-loading-state'));
        resultsGrid.removeAttribute('aria-busy');
        resultsGrid.querySelector('.search-loading-state')?.remove();
        if (resultsGrid.querySelector('.movie-card-component')) {
            resultsGrid.classList.remove('single-item');
        }

        if (hadLoader) {
            const loaderDiagnostics = {
                action: 'hide',
                generation: this.searchGeneration,
                traceId: this.activeSearchTraceId || null,
                elapsedMs: this.activeSearchTraceStartedAt
                    ? searchTraceDurationMs(this.activeSearchTraceStartedAt)
                    : null
            };
            if (this.activeSearchTraceId && this.activeSearchTraceStartedAt) {
                this.logSearchTrace(
                    this.activeSearchTraceId,
                    this.searchGeneration,
                    this.activeSearchTraceStartedAt,
                    'loader:hide'
                );
            } else {
                console.info('[SearchLoader]', loaderDiagnostics);
            }
        }
    }

    showInitialLoading() {
        this.showSearchLoading();
    }

    hideInitialLoading() {
        // Restore default empty state in results grid
        const resultsGrid = this.elements.resultsGrid;
        if (resultsGrid) {
            resultsGrid.removeAttribute('aria-busy');
            resultsGrid.classList.add('single-item');
            resultsGrid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><svg data-icon="SEARCH" aria-hidden="true" width="40" height="40" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3A6 6 0 1 0 9 15A6 6 0 1 0 9 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M9 3L9 15C12.32 15 15 12.31 15 9C15 5.69 12.32 3 9 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M13.6 13.6L17.6 17.6"/></svg></div>
                    <h3 class="empty-state-title" data-i18n="search.empty_title">${i18n.get('search.empty_title')}</h3>
                    <p class="empty-state-text" data-i18n="search.empty_text">${i18n.get('search.empty_text')}</p>
                </div>
            `;
        }
    }

    applyBookmarkStates(movies, bookmarksMap) {
        movies.forEach(movie => {
            const movieId = Number(movie?.kinopoiskId);
            if (!Number.isInteger(movieId) || movieId <= 0) return;

            const card = this.getSearchMovieCard(movieId);
            if (!card) return;

            const bookmark = bookmarksMap?.[String(movieId)] || bookmarksMap?.[movieId] || null;
            MovieCard.setStatusButtons(card, bookmark?.status || null);
        });
    }

    async updateButtonStates(
        movies = null,
        searchGeneration = this.searchGeneration,
        searchTraceId = this.activeSearchTraceId
    ) {
        if (!this.currentUser || !this.isCurrentSearchGeneration(searchGeneration)) return false;

        const searchStartedAt = this.activeSearchTraceStartedAt || searchTraceNow();
        const batchStartedAt = searchTraceNow();

        const targetMovies = Array.isArray(movies) && movies.length > 0
            ? movies
            : (this.currentResults?.docs || []);
        const movieIds = targetMovies
            .map(movie => Number(movie?.kinopoiskId))
            .filter(movieId => Number.isInteger(movieId) && movieId > 0);

        if (movieIds.length === 0) return true;

        try {
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'bookmark-batch:start', {
                movieCount: movieIds.length,
                uniqueMovieCount: new Set(movieIds).size
            });
            const favoriteService = firebaseManager.getFavoriteService();
            const bookmarksMap = await favoriteService.getBookmarksBatch(this.currentUser.uid, movieIds);
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'bookmark-batch:end', {
                stageDurationMs: searchTraceDurationMs(batchStartedAt),
                bookmarkCount: Object.keys(bookmarksMap || {}).length
            });

            if (!this.isCurrentSearchGeneration(searchGeneration)) {
                this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'bookmark-batch:stale');
                return false;
            }
            this.applyBookmarkStates(targetMovies, bookmarksMap || {});
            return true;
        } catch (error) {
            console.error('Error updating button states:', error);
            this.logSearchTrace(searchTraceId, searchGeneration, searchStartedAt, 'bookmark-batch:error', {
                stageDurationMs: searchTraceDurationMs(batchStartedAt),
                errorName: error?.name || 'Error',
                errorMessage: error?.message || String(error)
            });
            return false;
        }
    }

    // Search History Methods
    async showSearchHistory() {
        if (!this.elements.searchHistoryDropdown) return;

        const history = await this.searchHistoryService.getFormattedHistory();
        
        if (history.length === 0) {
            this.elements.searchHistoryList.style.display = 'none';
            this.elements.searchHistoryEmpty.style.display = 'block';
        } else {
            this.elements.searchHistoryEmpty.style.display = 'none';
            this.elements.searchHistoryList.style.display = 'block';
            this.renderSearchHistory(history);
        }

        this.elements.searchHistoryDropdown.style.display = 'block';
        this.elements.searchInputWrapper?.classList.add('dropdown-open');
        this.isHistoryDropdownOpen = true;
    }

    hideSearchHistory() {
        if (!this.elements.searchHistoryDropdown) return;

        this.elements.searchHistoryDropdown.style.display = 'none';
        this.elements.searchInputWrapper?.classList.remove('dropdown-open');
        this.isHistoryDropdownOpen = false;
    }

    renderSearchHistory(history) {
        if (!this.elements.searchHistoryList) return;

        this.elements.searchHistoryList.innerHTML = '';

        history.forEach(item => {
            const historyItem = document.createElement('div');
            historyItem.className = 'search-history-item';
            historyItem.innerHTML = `
                <div class="history-item-content">
                    <div class="history-item-query">${this.escapeHtml(item.query)}</div>
                    <div class="history-item-time">${this.escapeHtml(i18n.formatRelativeTime(item.timestamp))}</div>
                </div>
                <div class="history-item-actions">
                    <button class="history-item-delete" data-item-id="${item.id}" title="${this.escapeHtml(i18n.get('search.remove_from_history'))}">
                        <span class="delete-icon">×</span>
                    </button>
                </div>
            `;

            // Click on item to select it
            historyItem.addEventListener('click', (e) => {
                if (!e.target.closest('.history-item-delete')) {
                    this.selectHistoryItem(item.query);
                }
            });

            // Delete item
            const deleteBtn = historyItem.querySelector('.history-item-delete');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeHistoryItem(item.id);
            });

            this.elements.searchHistoryList.appendChild(historyItem);
        });
    }

    async selectHistoryItem(query) {
        this.elements.searchInput.value = query;
        this.hideSearchHistory();
        
        // Automatically perform search
        await this.performSearch();
    }

    async removeHistoryItem(itemId) {
        await this.searchHistoryService.removeFromHistory(itemId);
        
        // Refresh the dropdown if it's open
        if (this.isHistoryDropdownOpen) {
            await this.showSearchHistory();
        }
    }

    async clearSearchHistory() {
        await this.searchHistoryService.clearHistory();
        
        // Refresh the dropdown if it's open
        if (this.isHistoryDropdownOpen) {
            await this.showSearchHistory();
        }
    }

    handleSearchInput(e) {
        // Optional: Filter history based on current input
        // For now, just show all history when focused
    }

    escapeHtml(text) {
        // Quote-safe: the result also goes into attribute values.
        return Utils.escapeHtml(text);
    }

    /**
     * Check if string contains Cyrillic characters
     * @param {string} str - String to check
     * @returns {boolean} - True if contains Cyrillic
     */
    hasCyrillic(str) {
        return /[а-яё]/i.test(str);
    }

    /** Card menu quick actions; bookmarks are created from the search result's film data. */
    createCardActions() {
        return new MovieCardActions({
            getUser: () => this.currentUser,
            getMovie: movieId => this.currentResults?.docs?.find(movie => String(movie.kinopoiskId) === String(movieId)) || null,
            getCollectionService: () => this.collectionService || null,
            getCollections: () => this.availableCollections
        });
    }
}

// Initialize search manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => new SearchManager());

// Alias for router compatibility
window.SearchPageManager = SearchManager;
