
import { i18n } from '../../shared/i18n/I18n.js';

/**
 * RandomManager - Controller for the Random Movie page
 */
class RandomManager {
    constructor() {
        this.types = [];
        this.genres = [];
        this.countries = [];
        this.elements = {
            typeTags: document.getElementById('typeTags'),
            genreTags: document.getElementById('genreTags'),
            countryTags: document.getElementById('countryTags'),
            yearFrom: document.getElementById('yearFrom'),
            yearTo: document.getElementById('yearTo'),
            ratingFrom: document.getElementById('ratingFrom'),
            ratingTo: document.getElementById('ratingTo'),
            votesFrom: document.getElementById('votesFrom'),
            votesTo: document.getElementById('votesTo'),
            resetBtn: document.getElementById('resetFiltersBtn'),
            rollDiceBtn: document.getElementById('rollDiceBtn'),
            initialState: document.getElementById('initialState'),
            loadingState: document.getElementById('loadingState'),
            resultContainer: document.getElementById('resultContainer'),
            movieResult: document.getElementById('movieResult'),
            errorState: document.getElementById('errorState'),
            configHeader: document.getElementById('configHeader'),
            configBody: document.getElementById('configBody'),
            toggleConfigBtn: document.getElementById('toggleConfigBtn'),
            tryAgainBtn: document.getElementById('tryAgainBtn')
        };

        this.kinopoiskService = new KinopoiskService();

        // ── Pool State ──
        this.pool = [];        // [{ kpId, title, year, poster, rating }]
        this.currentMovie = null;
        this.POOL_KEY = 'randomPool';
        this._searchTimer = null;
        this.rollAnimRunning = false;
        this.rollDrumOffset = 0;

        this.init();

    }


    async init() {
        this._buildRollOverlay();
        await i18n.init();
        i18n.translatePage();
        
        this.populateFilterData();
        this.renderTags();
        this.setupSliders();
        this.loadPreferences(); 
        this.setupEventListeners();
        await this.loadPool();

        // Listen for language changes
        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === 'SETTINGS_UPDATED') {
                this.handleSettingsUpdate(message.settings);
            }
        });
    }

    handleSettingsUpdate(settings) {
        if (settings.language && settings.language !== i18n.currentLocale) {
            // Re-fetch i18n and update page
            i18n.init().then(() => {
                i18n.translatePage();
                this.populateFilterData();
                this.renderTags();
            });
        }
    }

    populateFilterData() {
        this.types = [
            { label: i18n.get('random.types.movie'), value: 'movie' },
            { label: i18n.get('random.types.tv_series'), value: 'tv-series' },
            { label: i18n.get('random.types.cartoon'), value: 'cartoon' },
            { label: i18n.get('random.types.anime'), value: 'anime' }
        ];

        this.genres = [
            { label: i18n.get('random.genres.comedy'), value: 'комедия' },
            { label: i18n.get('random.genres.cartoon'), value: 'мультфильм' },
            { label: i18n.get('random.genres.horror'), value: 'ужасы' },
            { label: i18n.get('random.genres.sci_fi'), value: 'фантастика' },
            { label: i18n.get('random.genres.thriller'), value: 'триллер' },
            { label: i18n.get('random.genres.action'), value: 'боевик' },
            { label: i18n.get('random.genres.melodrama'), value: 'мелодрама' },
            { label: i18n.get('random.genres.detective'), value: 'детектив' },
            { label: i18n.get('random.genres.adventure'), value: 'приключения' },
            { label: i18n.get('random.genres.fantasy'), value: 'фэнтези' },
            { label: i18n.get('random.genres.war'), value: 'военный' },
            { label: i18n.get('random.genres.family'), value: 'семейный' },
            { label: i18n.get('random.genres.anime'), value: 'аниме' },
            { label: i18n.get('random.genres.history'), value: 'история' },
            { label: i18n.get('random.genres.drama'), value: 'драма' },
            { label: i18n.get('random.genres.documentary'), value: 'документальный' },
            { label: i18n.get('random.genres.kids'), value: 'детский' },
            { label: i18n.get('random.genres.crime'), value: 'криминал' },
            { label: i18n.get('random.genres.biography'), value: 'биография' },
            { label: i18n.get('random.genres.western'), value: 'вестерн' },
            { label: i18n.get('random.genres.film_noir'), value: 'фильм-нуар' },
            { label: i18n.get('random.genres.sport'), value: 'спорт' },
            { label: i18n.get('random.genres.reality_tv'), value: 'реальное ТВ' },
            { label: i18n.get('random.genres.short'), value: 'короткометражка' },
            { label: i18n.get('random.genres.music'), value: 'музыка' },
            { label: i18n.get('random.genres.musical'), value: 'мюзикл' },
            { label: i18n.get('random.genres.talk_show'), value: 'ток-шоу' },
            { label: i18n.get('random.genres.game'), value: 'игра' }
        ];

        this.countries = [
            { label: i18n.get('random.countries.russia'), value: 'Россия' },
            { label: i18n.get('random.countries.ussr'), value: 'СССР' },
            { label: i18n.get('random.countries.usa'), value: 'США' },
            { label: i18n.get('random.countries.kazakhstan'), value: 'Казахстан' },
            { label: i18n.get('random.countries.france'), value: 'Франция' },
            { label: i18n.get('random.countries.south_korea'), value: 'Южная Корея' },
            { label: i18n.get('random.countries.uk'), value: 'Великобритания' },
            { label: i18n.get('random.countries.japan'), value: 'Япония' },
            { label: i18n.get('random.countries.italy'), value: 'Италия' },
            { label: i18n.get('random.countries.spain'), value: 'Испания' },
            { label: i18n.get('random.countries.germany'), value: 'Германия' },
            { label: i18n.get('random.countries.turkey'), value: 'Турция' },
            { label: i18n.get('random.countries.sweden'), value: 'Швеция' },
            { label: i18n.get('random.countries.denmark'), value: 'Дания' },
            { label: i18n.get('random.countries.norway'), value: 'Норвегия' },
            { label: i18n.get('random.countries.hong_kong'), value: 'Гонконг' },
            { label: i18n.get('random.countries.australia'), value: 'Австралия' },
            { label: i18n.get('random.countries.belgium'), value: 'Бельгия' },
            { label: i18n.get('random.countries.netherlands'), value: 'Нидерланды' },
            { label: i18n.get('random.countries.greece'), value: 'Греция' },
            { label: i18n.get('random.countries.austria'), value: 'Австрия' }
        ];
    }

    setupSliders() {
        this.initDoubleSlider('year', 1900, 2030, 0); // min gap 0
        this.initDoubleSlider('rating', 1, 10, 0.5); // min gap 0.5
        this.initDoubleSlider('votes', 0, 2000000, 1000); // Votes
    }

    initDoubleSlider(idPrefix, minLimit, maxLimit, minGap) {
        const minInput = document.getElementById(`${idPrefix}From`);
        const maxInput = document.getElementById(`${idPrefix}To`);
        const minDisplay = document.getElementById(`${idPrefix}MinDisplay`);
        const maxDisplay = document.getElementById(`${idPrefix}MaxDisplay`);
        const rangeBar = document.getElementById(`${idPrefix}RangeBar`);

        const formatValue = (val) => {
            if (idPrefix === 'votes') {
                if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
                if (val >= 1000) return (val / 1000).toFixed(0) + 'k';
                return val;
            }
            return val;
        };

        const save = () => this.savePreferences();

        const updateSlider = () => {
            let minVal = parseFloat(minInput.value);
            let maxVal = parseFloat(maxInput.value);

            // Prevent crossover
            if (maxVal - minVal < minGap) {
                if (document.activeElement === minInput) {
                    minInput.value = maxVal - minGap;
                    minVal = parseFloat(minInput.value);
                } else {
                    maxInput.value = minVal + minGap;
                    maxVal = parseFloat(maxInput.value);
                }
            }

            // Update displays
            minDisplay.textContent = formatValue(minVal);
            maxDisplay.textContent = formatValue(maxVal);

            // Update bar position
            // Calculate percentages
            // Formula: ((value - minLimit) / (maxLimit - minLimit)) * 100
            const range = maxLimit - minLimit;
            const leftPercent = ((minVal - minLimit) / range) * 100;
            const rightPercent = 100 - (((maxVal - minLimit) / range) * 100);

            rangeBar.style.left = `${leftPercent}%`;
            rangeBar.style.right = `${rightPercent}%`;
        };

        minInput.addEventListener('input', updateSlider);
        maxInput.addEventListener('input', updateSlider);
        minInput.addEventListener('change', save);
        maxInput.addEventListener('change', save);
        
        // Initial call
        updateSlider();
    }

    renderTags() {
        this.elements.typeTags.innerHTML = this.types.map(type => 
            this.createTag(type, 'type')
        ).join('');

        this.elements.genreTags.innerHTML = this.genres.map(genre => 
            this.createTag(genre, 'genre')
        ).join('');

        this.elements.countryTags.innerHTML = this.countries.map(country => 
            this.createTag(country, 'country')
        ).join('');
    }

    createTag(data, type) {
        // Handle both object {label, value} and string input (legacy support)
        let label, value;
        if (typeof data === 'object' && data !== null) {
            label = data.label;
            value = data.value;
        } else {
            label = data;
            value = data;
        }

        // Tag now includes an icon span for the state
        return `
            <div class="tag-btn" data-value="${value}" data-type="${type}" data-state="neutral">
                <span class="tag-text">${label}</span>
                <span class="tag-status-icon"></span>
            </div>
        `;
    }

    setDefaultFilters() {
        // Set default values for sliders
        const filterIds = {
            'yearFrom': 1990,
            'yearTo': 2026,
            'ratingFrom': 7,
            'ratingTo': 10,
            'votesFrom': 10000,
            'votesTo': 2000000
        };

        Object.keys(filterIds).forEach(id => {
            const el = document.getElementById(id);
            if(el) {
                el.value = filterIds[id];
                // Trigger input event to update slider visuals
                el.dispatchEvent(new Event('input'));
            }
        });
    }

    setupEventListeners() {
        // Use Delegation for Tags
        document.body.addEventListener('mousedown', (e) => {
            const btn = e.target.closest('.tag-btn');
            if (btn) {
                this.handleTagClick(btn);
            }
        });

        // Reset
        this.elements.resetBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation(); // Prevent header toggle
            this.resetFilters();
        });

        // Toggle Config
        if (this.elements.configHeader) {
            this.elements.configHeader.addEventListener('mousedown', () => this.toggleConfig());
        }

        // Roll Dice
        this.elements.rollDiceBtn.addEventListener('mousedown', () => this.findRandomMovie());

        // Try Again
        if (this.elements.tryAgainBtn) {
            this.elements.tryAgainBtn.addEventListener('mousedown', () => {
                this.resetFilters();
                this.toggleConfig(true); // Open config
            });
        }

        this.setupPoolListeners();
    }

    toggleConfig(forceState = null) {
        const body = this.elements.configBody;
        const btn = this.elements.toggleConfigBtn;
        
        if (!body || !btn) return;

        const icon = btn.querySelector('.icon-chevron');
        const isCollapsed = body.classList.contains('collapsed');
        const shouldExpand = forceState !== null ? forceState : isCollapsed;

        if (shouldExpand) {
            body.classList.remove('collapsed');
            if(icon) icon.style.transform = 'rotate(90deg)';
        } else {
            body.classList.add('collapsed');
            if(icon) icon.style.transform = 'rotate(0deg)';
        }
    }

    handleTagClick(btn) {
        const currentState = btn.dataset.state;
        let newState;
        const iconSpan = btn.querySelector('.tag-status-icon');

        if (currentState === 'neutral') {
            newState = 'include';
            btn.classList.add('state-include');
            if(iconSpan) iconSpan.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        } else if (currentState === 'include') {
            newState = 'exclude';
            btn.classList.remove('state-include');
            btn.classList.add('state-exclude');
            if(iconSpan) iconSpan.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        } else {
            newState = 'neutral';
            btn.classList.remove('state-exclude');
            if(iconSpan) iconSpan.innerHTML = '';
        }

        btn.dataset.state = newState;
        this.savePreferences();
    }

    resetFilters() {
        document.querySelectorAll('.tag-btn').forEach(btn => {
            btn.dataset.state = 'neutral';
            btn.classList.remove('state-include', 'state-exclude');
            const iconSpan = btn.querySelector('.tag-status-icon');
            if(iconSpan) iconSpan.innerHTML = '';
        });
        
        this.setDefaultFilters();
        this.savePreferences();
        this.showState('initial');
    }

    getFilters() {
        const filters = {
            yearFrom: document.getElementById('yearFrom').value,
            yearTo: document.getElementById('yearTo').value,
            ratingFrom: document.getElementById('ratingFrom').value,
            ratingTo: document.getElementById('ratingTo').value,
            votesFrom: document.getElementById('votesFrom').value,
            votesTo: document.getElementById('votesTo').value,
            countries: [],
            excludeCountries: [],
            genres: [],
            excludeGenres: [],
            types: [],
            excludeTypes: []
        };

        document.querySelectorAll('.tag-btn').forEach(btn => {
            const state = btn.dataset.state;
            const value = btn.dataset.value;
            const type = btn.dataset.type; // 'genre' or 'country' or 'type'

            if (state === 'include') {
                if (type === 'type') filters.types.push(value);
                if (type === 'genre') filters.genres.push(value);
                if (type === 'country') filters.countries.push(value);
            } else if (state === 'exclude') {
                if (type === 'type') filters.excludeTypes.push(value);
                if (type === 'genre') filters.excludeGenres.push(value);
                if (type === 'country') filters.excludeCountries.push(value);
            }
        });

        return filters;
    }

    savePreferences() {
        const filters = this.getFilters();
        const prefs = {
            year: { from: filters.yearFrom, to: filters.yearTo },
            rating: { from: filters.ratingFrom, to: filters.ratingTo },
            votes: { from: filters.votesFrom, to: filters.votesTo },
            types: filters.types,
            excludeTypes: filters.excludeTypes,
            genres: filters.genres,
            excludeGenres: filters.excludeGenres,
            countries: filters.countries,
            excludeCountries: filters.excludeCountries
        };
        localStorage.setItem('random_filter_preferences', JSON.stringify(prefs));
    }

    loadPreferences() {
        const saved = localStorage.getItem('random_filter_preferences');
        if (!saved) return;

        try {
            const prefs = JSON.parse(saved);

            // Restore sliders
            const setSlider = (id, val) => {
                const el = document.getElementById(id);
                if (el) {
                    el.value = val;
                    el.dispatchEvent(new Event('input'));
                }
            };

            if (prefs.year) {
                setSlider('yearFrom', prefs.year.from);
                setSlider('yearTo', prefs.year.to);
            }
            if (prefs.rating) {
                setSlider('ratingFrom', prefs.rating.from);
                setSlider('ratingTo', prefs.rating.to);
            }
            if (prefs.votes) {
                setSlider('votesFrom', prefs.votes.from);
                setSlider('votesTo', prefs.votes.to);
            }

            // Restore tags
            const restoreTags = (tagList, type, state) => {
                if (!tagList || !Array.isArray(tagList)) return;
                tagList.forEach(value => {
                    const btn = document.querySelector(`.tag-btn[data-value="${value}"][data-type="${type}"]`);
                    if (btn) {
                        btn.dataset.state = state;
                        btn.classList.remove('state-include', 'state-exclude');
                        const iconSpan = btn.querySelector('.tag-status-icon');
                        
                        if (state === 'include') {
                            btn.classList.add('state-include');
                            if(iconSpan) iconSpan.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                        } else if (state === 'exclude') {
                            btn.classList.add('state-exclude');
                            if(iconSpan) iconSpan.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                        }
                    }
                });
            };

            restoreTags(prefs.types, 'type', 'include');
            restoreTags(prefs.excludeTypes, 'type', 'exclude');
            restoreTags(prefs.genres, 'genre', 'include');
            restoreTags(prefs.excludeGenres, 'genre', 'exclude');
            restoreTags(prefs.countries, 'country', 'include');
            restoreTags(prefs.excludeCountries, 'country', 'exclude');

        } catch (e) {
            console.error('Failed to load preferences', e);
        }
    }

    async findRandomMovie() {
        this.showState('loading');
        this.toggleConfig(false); // Collapse config to show result
        
        try {
            const filters = this.getFilters();
            
            // Wait for auth to be ready if needed, mostly for services
            if (window.firebaseManager) {
                await window.firebaseManager.waitForAuthReady();
            }

            const movie = await this.kinopoiskService.getRandomMovie(filters);

            if (movie) {
                this.displayMovie(movie);
             } else {
                this.showState('error');
             }

        } catch (error) {
            console.error('Error finding random movie:', error);
            this.showState('error');
        }
    }

    async displayMovie(movie) {
        this.currentMovie = movie;  // ── Track current movie for pool feature
        this.elements.movieResult.innerHTML = '';
        
        // Use MovieCard component's compact detail view
        if (typeof MovieCard !== 'undefined') {
            // Create compact detailed card
            const card = MovieCard.createCompactDetail(movie);
            
            this.elements.movieResult.innerHTML = '';
            this.elements.movieResult.appendChild(card);
            this.showState('result');
            
            // Inject Add-to-Pool FAB over poster
            this._injectPoolFab(card, movie);

            // Setup delegation for any interactive elements
            this.setupCardDelegation();

        } else {
            console.error('MovieCard component not found');
        }
    }

    /** Inject "add to pool" button into the card header, right of the reload button */
    _injectPoolFab(card, movie) {
        const header = card.querySelector('.cmc-header');
        if (!header) return;

        const svgPlus = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
        const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;

        const setAdded = () => {
            btn.classList.add('in-pool');
            btn.title = 'Убрать из пула';
            btn.innerHTML = svgCheck;
        };

        const setRemoved = () => {
            btn.classList.remove('in-pool');
            btn.title = 'Добавить в пул';
            btn.innerHTML = svgPlus;
        };

        const btn = document.createElement('button');
        const inPool = this._isInPool(movie.kinopoiskId);
        btn.className = 'cmc-pool-btn' + (inPool ? ' in-pool' : '');
        btn.title = inPool ? 'Убрать из пула' : 'Добавить в пул';
        btn.innerHTML = inPool ? svgCheck : svgPlus;

        btn.addEventListener('click', () => {
            const kpId = movie.kinopoiskId;
            if (this._isInPool(kpId)) {
                // Remove from pool
                this.pool = this.pool.filter(m => m.kpId !== kpId);
                this._savePool();
                setRemoved();
            } else {
                // Add to pool
                this._addCurrentMovieToPool();
                setAdded();
            }
        });

        header.appendChild(btn);
    }
    
    setupCardDelegation() {
        // Simple delegation for the result container
        if (this.delegationSetup) return;
        this.delegationSetup = true;

        this.elements.movieResult.addEventListener('mousedown', (e) => {
             // If it's not a left click, let the browser handle it (e.g. middle click for new tab)
             if (e.button !== 0) return;

             const target = e.target;
             const actionBtn = target.closest('[data-action]');
             if (!actionBtn) return;
             
             const action = actionBtn.dataset.action;
             
             if (action === 'reload') {
                 // Animate button
                 const icon = actionBtn.querySelector('svg');
                 if (icon) {
                     icon.style.transition = 'transform 0.5s ease';
                     icon.style.transform = 'rotate(360deg)';
                 }
                 
                 // Always roll a new random movie (pool rolls only via the pool modal)
                 setTimeout(() => {
                     this.findRandomMovie();
                 }, 300);
                 return;
             }

             
             const movieId = actionBtn.dataset.movieId;
             
             if (action === 'view-details') {
                 // Open details page
                 e.preventDefault();
                 window.location.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`);
                 return;
             }
             
             // Handle other actions via helper
             if (window.firebaseManager) {
                 this.handleAction(action, movieId, actionBtn, e);
             }
        });
    }
    
    async handleAction(action, movieId, btn, e) {
        // If it's not a left click, let the browser handle it
        if (e && e.button !== 0) return;

        // Placeholder for quick actions
        // Ideally we should move action logic to a shared helper or mixin
        if (action === 'view-details') {
             if (e) e.preventDefault();
             window.location.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`);
        }
    }

    showState(state) {
        this.elements.initialState.style.display = 'none';
        this.elements.loadingState.style.display = 'none';
        this.elements.movieResult.style.display = 'none';
        this.elements.errorState.style.display = 'none';

        if (state === 'initial') this.elements.initialState.style.display = 'block';
        if (state === 'loading') this.elements.loadingState.style.display = 'block';
        if (state === 'result') this.elements.movieResult.style.display = 'flex'; // Flex for centering
        if (state === 'error') this.elements.errorState.style.display = 'block';
    }

    // ════════════════════════════════════════════════════════════
    //  POOL FEATURE
    // ════════════════════════════════════════════════════════════

    /** Load pool from chrome.storage.local */
    async loadPool() {
        try {
            const data = await chrome.storage.local.get(this.POOL_KEY);
            this.pool = data[this.POOL_KEY] || [];
            this._updatePoolUI();
        } catch (e) {
            console.warn('RandomManager: Failed to load pool', e);
        }
    }

    /** Persist pool to chrome.storage.local and refresh counter */
    async _savePool() {
        try {
            await chrome.storage.local.set({ [this.POOL_KEY]: this.pool });
        } catch (e) {
            console.warn('RandomManager: Failed to save pool', e);
        }
        this._updatePoolUI();
    }

    /** Update the pool count badge */
    _updatePoolUI() {
        const el = document.getElementById('poolCount');
        if (el) el.textContent = this.pool.length;
    }

    /** Check if a kpId is already in the pool */
    _isInPool(kpId) {
        return this.pool.some(m => m.kpId === kpId);
    }

    /** Add the currently displayed movie to the pool */
    _addCurrentMovieToPool() {
        if (!this.currentMovie) return;
        const kpId = this.currentMovie.kinopoiskId;
        if (this._isInPool(kpId)) return;
        this.pool.push({
            kpId,
            title: this.currentMovie.name || this.currentMovie.alternativeName,
            year: this.currentMovie.year,
            poster: this.currentMovie.posterUrl,
            rating: this.currentMovie.kpRating
        });
        this._savePool();
    }

    /** Setup all pool-related event listeners */
    setupPoolListeners() {
        // Pool search input
        const searchInput = document.getElementById('poolSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this._searchTimer);
                const q = e.target.value.trim();
                const resultsEl = document.getElementById('poolSearchResults');
                
                if (q.length < 2) { 
                    resultsEl.classList.add('hidden'); 
                    searchInput.style.borderColor = '';
                    return; 
                }
                
                // Показываем что идёт отсчёт
                searchInput.style.borderColor = 'var(--theme-text-secondary, #999)';
                
                this._searchTimer = setTimeout(() => {
                    searchInput.style.borderColor = 'var(--accent-color, #e67e22)';
                    this._searchForPool(q);
                }, 1000);
            });
        }

        // Close dropdown on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.pool-search-wrap')) {
                const resultsEl = document.getElementById('poolSearchResults');
                if (resultsEl) resultsEl.classList.add('hidden');
            }
        });

        // Show pool modal
        const showPoolBtn = document.getElementById('showPoolBtn');
        if (showPoolBtn) {
            showPoolBtn.addEventListener('click', () => {
                this._renderPoolModal();
                document.getElementById('poolModal').classList.remove('hidden');
            });
        }

        // Close pool modal
        const closePoolModal = document.getElementById('closePoolModal');
        if (closePoolModal) {
            closePoolModal.addEventListener('click', () => {
                document.getElementById('poolModal').classList.add('hidden');
            });
        }

        // Close modal on backdrop click
        const poolModal = document.getElementById('poolModal');
        if (poolModal) {
            poolModal.addEventListener('click', (e) => {
                if (e.target === poolModal) poolModal.classList.add('hidden');
            });
        }

        // Clear pool
        const clearPoolBtn = document.getElementById('clearPoolBtn');
        if (clearPoolBtn) {
            clearPoolBtn.addEventListener('click', () => {
                this.pool = [];
                this._savePool();
                this._renderPoolModal();
            });
        }

        // Roll from pool
        const rollFromPoolBtn = document.getElementById('rollFromPoolBtn');
        if (rollFromPoolBtn) {
            rollFromPoolBtn.addEventListener('click', () => {
                document.getElementById('poolModal').classList.add('hidden');
                this._rollFromPool();
            });
        }
    }

    /** Search Kinopoisk and display dropdown results */
    async _searchForPool(query) {
        const resultsEl = document.getElementById('poolSearchResults');
        resultsEl.innerHTML = '<div style="padding:12px;color:#999;font-size:13px">Поиск...</div>';
        resultsEl.classList.remove('hidden');

        try {
            const data = await this.kinopoiskService.searchMovies(query, 1, 7);
            const movies = data.docs || [];
            this._renderSearchResults(movies, resultsEl);
        } catch (err) {
            resultsEl.innerHTML = '<div style="padding:12px;color:#e74c3c;font-size:13px">Ошибка поиска</div>';
        }
    }

    /** Render dropdown search results */
    _renderSearchResults(movies, container) {
        if (!movies.length) {
            container.innerHTML = '<div style="padding:12px;color:#999;font-size:13px">Ничего не найдено</div>';
            return;
        }
        container.innerHTML = '';
        movies.forEach(m => {
            const kpId = m.kinopoiskId;
            const inPool = this._isInPool(kpId);
            const item = document.createElement('div');
            item.className = 'pool-result-item';
            item.innerHTML = `
                <img src="${m.posterUrl || ''}" alt="" onerror="this.style.display='none'">
                <div class="pool-result-meta">
                    <div class="pool-result-title">${m.name || m.alternativeName || '—'}</div>
                    <div class="pool-result-sub">${m.year || ''} · КП ${m.kpRating ? m.kpRating.toFixed(1) : '—'}</div>
                </div>
                <button class="pool-result-add${inPool ? ' added' : ''}" title="${inPool ? 'Уже в пуле' : 'Добавить'}">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                </button>`;
            const addBtn = item.querySelector('.pool-result-add');
            if (!inPool) {
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.pool.push({
                        kpId,
                        title: m.name || m.alternativeName,
                        year: m.year,
                        poster: m.posterUrl,
                        rating: m.kpRating
                    });
                    this._savePool();
                    addBtn.classList.add('added');
                });
            }
            container.appendChild(item);
        });
    }

    /** Render contents of the pool modal list */
    _renderPoolModal() {
        const list = document.getElementById('poolList');
        list.innerHTML = '';
        if (!this.pool.length) {
            list.innerHTML = '<div class="pool-list-empty">Пул пуст. Добавляй фильмы через поиск или кнопку «+» на постере.</div>';
            return;
        }
        this.pool.forEach((m, idx) => {
            const item = document.createElement('div');
            item.className = 'pool-list-item';
            item.innerHTML = `
                <img src="${m.poster || ''}" alt="" onerror="this.style.display='none'">
                <div class="pool-list-item-meta">
                    <div class="pool-list-item-title">${m.title || '—'}</div>
                    <div class="pool-list-item-sub">${m.year || ''} · КП ${m.rating ? m.rating.toFixed(1) : '—'}</div>
                </div>
                <button class="pool-list-item-remove" title="Удалить из пула">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>`;

            // Click on row → go to movie details page
            item.addEventListener('click', (e) => {
                if (e.target.closest('.pool-list-item-remove')) return;
                const url = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${m.kpId}`);
                window.location.href = url;
            });

            item.querySelector('.pool-list-item-remove').addEventListener('click', () => {
                this.pool.splice(idx, 1);
                this._savePool();
                this._renderPoolModal();
            });

            list.appendChild(item);
        });
    }

    /** Pick a random movie from the pool and display it */
    _rollFromPool() {
        if (!this.pool.length) return;
        const winnerIdx = Math.floor(Math.random() * this.pool.length);
        this._showRollAnimation(winnerIdx);
    }

    // ── Roll Animation ────────────────────────────────────────────

    _buildRollOverlay() {
        const el = document.createElement('div');
        el.id = 'rollAnimOverlay';
        el.className = 'roll-modal-overlay hidden';
        el.innerHTML = `
            <div class="roll-modal-box">
                <div class="roll-title">Выбираем фильм...</div>
                <div class="roll-drum-wrap" id="rollDrumWrap">
                    <div class="roll-drum-track" id="rollDrumTrack"></div>
                    <div class="roll-drum-border" id="rollDrumBorder"></div>
                    <div class="roll-winner-badge" id="rollWinnerBadge">Выбран!</div>
                </div>
                <div class="roll-pool-chips" id="rollPoolChips"></div>
                <div class="roll-actions" id="rollActions" style="display:none">
                    <button class="roll-action-btn secondary" id="rollRerollBtn" style="flex:1" title="Перекрутить">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                    </button>
                    <button class="roll-action-btn" id="rollGoBtn" style="flex:3">Смотреть</button>
                </div>
            </div>`;
        document.body.appendChild(el);

        // Закрыть по фону
        el.addEventListener('click', (e) => {
            if (e.target === el && !this.rollAnimRunning) {
                el.classList.add('hidden');
            }
        });

        // Перекрутить
        const rerollBtn = el.querySelector('#rollRerollBtn');
        if (rerollBtn) {
            rerollBtn.addEventListener('click', () => {
                this._rollFromPool();
            });
        }
    }

    _showRollAnimation(winnerIdx) {
        const overlay = document.getElementById('rollAnimOverlay');
        const track   = document.getElementById('rollDrumTrack');
        const border  = document.getElementById('rollDrumBorder');
        const badge   = document.getElementById('rollWinnerBadge');
        const chips   = document.getElementById('rollPoolChips');
        const goBtn   = document.getElementById('rollGoBtn');
        const actionsBox = document.getElementById('rollActions');
        const CARD_W  = 340;

        border.classList.remove('winner');
        badge.classList.remove('show');
        actionsBox.style.display = 'none';
        goBtn.disabled = true;
        this.rollAnimRunning = true;
        
        // Reset offset so we always start from 0
        this.rollDrumOffset = 0;

        // Ensure we have enough laps regardless of pool size
        const targetLap = Math.max(3, Math.ceil(20 / this.pool.length));
        const totalLaps = targetLap + 2; // +2 for visual buffer at the end

        // Собрать карточки
        track.innerHTML = '';
        for (let i = 0; i < totalLaps; i++) {
            this.pool.forEach(m => {
                const d = document.createElement('div');
                d.className = 'roll-drum-card';
                d.innerHTML = `
                    <img src="${m.poster || ''}" alt=""
                         onerror="this.style.background='#2a2a2a';this.removeAttribute('src')">
                    <div class="roll-drum-card-meta">
                        <div class="roll-drum-card-title">${m.title || '—'}</div>
                        <div class="roll-drum-card-sub">${m.year || ''}</div>
                    </div>
                    <div class="roll-drum-card-rating">${m.rating ? parseFloat(m.rating).toFixed(1) : '—'}</div>`;
                track.appendChild(d);
            });
        }

        // Чипсы
        chips.innerHTML = '';
        this.pool.forEach((m, i) => {
            const c = document.createElement('div');
            c.className = 'roll-pool-chip';
            c.id = `rollChip_${i}`;
            c.textContent = m.title;
            chips.appendChild(c);
        });

        overlay.classList.remove('hidden');

        // Easing: замедление к концу
        const easeOut = (t) => 1 - Math.pow(1 - t, 3);

        const loopLen = this.pool.length * CARD_W;
        // Целевая позиция: центр победителя по центру барабана
        const wrapEl = document.getElementById('rollDrumWrap');
        const drumCenter = wrapEl ? (wrapEl.offsetWidth || 340) / 2 : 170;
        
        const targetRaw  = -(targetLap * loopLen + winnerIdx * CARD_W + CARD_W / 2 - drumCenter);
        const startOffset = 0;
        const delta = targetRaw - startOffset;
        const duration = 2600;
        const startTime = performance.now();

        const step = (now) => {
            const elapsed = Math.min(now - startTime, duration);
            const t = elapsed / duration;
            const offset = startOffset + delta * easeOut(t);
            track.style.transform = `translateX(${offset}px)`;

            if (elapsed < duration) {
                requestAnimationFrame(step);
            } else {
                // Финиш
                this.rollAnimRunning = false;
                border.classList.add('winner');
                badge.classList.add('show');
                const chip = document.getElementById(`rollChip_${winnerIdx}`);
                if (chip) chip.classList.add('winner');

                const winner = this.pool[winnerIdx];
                goBtn.textContent = `Смотреть · ${winner.title}`;
                actionsBox.style.display = 'flex';
                goBtn.disabled = false;
                goBtn.onclick = () => {
                    overlay.classList.add('hidden');
                    // Открыть страницу деталей фильма
                    window.location.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${winner.kpId}`);
                };
            }
        };
        requestAnimationFrame(step);
    }

    /** Load and display a specific movie by Kinopoisk ID */
    async _loadMovieById(kpId) {
        this.showState('loading');
        this.toggleConfig(false);
        try {
            if (window.firebaseManager) {
                await window.firebaseManager.waitForAuthReady();
            }
            const movie = await this.kinopoiskService.getMovieById(kpId);
            if (movie) {
                this.displayMovie(movie);
            } else {
                this.showState('error');
            }
        } catch (error) {
            console.error('RandomManager: Error loading movie by id:', error);
            this.showState('error');
        }
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    new RandomManager();
});
