
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

        this.init();
    }


    async init() {
        await i18n.init();
        i18n.translatePage();
        
        this.populateFilterData();
        this.renderTags();
        this.setupSliders();
        this.loadPreferences(); 
        this.setupEventListeners();

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
        this.elements.movieResult.innerHTML = '';
        
        // Use MovieCard component's compact detail view
        if (typeof MovieCard !== 'undefined') {
            // Create compact detailed card
            const card = MovieCard.createCompactDetail(movie);
            
            this.elements.movieResult.innerHTML = '';
            this.elements.movieResult.appendChild(card);
            this.showState('result');
            
            // Setup delegation for any interactive elements
            this.setupCardDelegation();

        } else {
            console.error('MovieCard component not found');
        }
    }
    
    setupCardDelegation() {
        // Simple delegation for the result container
        if (this.delegationSetup) return;
        this.delegationSetup = true;

        this.elements.movieResult.addEventListener('mousedown', (e) => {
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
                 
                 // Trigger new search after a short delay for animation
                 setTimeout(() => {
                     this.findRandomMovie();
                 }, 300);
                 return;
             }
             
             const movieId = actionBtn.dataset.movieId;
             
             if (action === 'view-details') {
                 // Open details page
                 window.location.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`);
                 return;
             }
             
             // Handle other actions via helper
             if (window.firebaseManager) {
                 this.handleAction(action, movieId, actionBtn);
             }
        });
    }
    
    async handleAction(action, movieId, btn) {
        // Placeholder for quick actions
        // Ideally we should move action logic to a shared helper or mixin
        if (action === 'view-details') {
             window.location.href = `../search/search.html?movieId=${movieId}`;
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
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    new RandomManager();
});
