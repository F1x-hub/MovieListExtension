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
        this.selectedMovie = null;
        this.currentUser = null;
        this.currentRating = 0; // State for new rating system
        this.isReviewVisible = false;
        this.searchHistoryService = new SearchHistoryService();
        this.streamingService = new StreamingService();
        this.isHistoryDropdownOpen = false;
        this.isPlaying = false;
        this.currentVideoUrl = '';
        this.setupEventListeners();
        this.setupImageErrorHandlers();
        this.initializeUI();
    }

    initializeElements() {
        return {
            // Navigation
            backBtn: document.getElementById('backBtn'),
            settingsBtn: document.getElementById('settingsBtn'),
            
            // Search
            searchInput: document.getElementById('searchInput'),
            searchBtn: document.getElementById('searchBtn'),
            toggleFiltersBtn: document.getElementById('toggleFiltersBtn'),
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
            loading: document.getElementById('loading'),
            pagination: document.getElementById('pagination'),
            prevPageBtn: document.getElementById('prevPageBtn'),
            nextPageBtn: document.getElementById('nextPageBtn'),
            pageInfo: document.getElementById('pageInfo'),
            
            // Modals
            movieModal: document.getElementById('movieModal'),
            modalTitle: document.getElementById('modalTitle'),
            modalBody: document.getElementById('modalBody'),
            modalClose: document.getElementById('modalClose'),
            closeModalBtn: document.getElementById('closeModalBtn'),
            rateMovieBtn: document.getElementById('rateMovieBtn'),
            movieDetailBtn: document.getElementById('movieDetailBtn'),
            
            // Rating Modal
            ratingModal: document.getElementById('ratingModal'),
            ratingMoviePoster: document.getElementById('ratingMoviePoster'),
            ratingMovieTitle: document.getElementById('ratingMovieTitle'),
            ratingMovieMeta: document.getElementById('ratingMovieMeta'),
            ratingStars: document.getElementById('ratingStars'),
            writeReviewBtn: document.getElementById('writeReviewBtn'),
            reviewContainer: document.getElementById('reviewContainer'),
            ratingComment: document.getElementById('ratingComment'),
            charCount: document.getElementById('charCount'),
            saveRatingBtn: document.getElementById('saveRatingBtn'),
            cancelRatingBtn: document.getElementById('cancelRatingBtn'),
            ratingModalClose: document.getElementById('ratingModalClose'),

            // Video Player Modal
            videoPlayerModal: document.getElementById('videoPlayerModal'),
            videoTitle: document.getElementById('videoTitle'),
            videoContainer: document.getElementById('videoContainer'),
            closeVideoBtn: document.getElementById('closeVideoBtn'),
            sourceSelect: document.getElementById('sourceSelect'),

        };
    }

    setupEventListeners() {
        // Navigation (optional elements for router compatibility)
        if (this.elements.backBtn) {
            this.elements.backBtn.addEventListener('click', () => this.goBack());
        }
        if (this.elements.settingsBtn) {
            this.elements.settingsBtn.addEventListener('click', () => this.openSettings());
        }
        
        // Search
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.performSearch();
            });
            this.elements.searchInput.addEventListener('focus', () => this.showSearchHistory());
            this.elements.searchInput.addEventListener('input', (e) => this.handleSearchInput(e));
        }
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
        document.addEventListener('click', (e) => {
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
        
        // Pagination
        if (this.elements.prevPageBtn) {
            this.elements.prevPageBtn.addEventListener('click', () => this.previousPage());
        }
        if (this.elements.nextPageBtn) {
            this.elements.nextPageBtn.addEventListener('click', () => this.nextPage());
        }
        
        // Modals
        if (this.elements.modalClose) {
            this.elements.modalClose.addEventListener('click', () => this.closeMovieModal());
        }
        if (this.elements.closeModalBtn) {
            this.elements.closeModalBtn.addEventListener('click', () => this.closeMovieModal());
        }
        if (this.elements.rateMovieBtn) {
            this.elements.rateMovieBtn.addEventListener('click', () => this.showRatingModal(this.selectedMovie));
        }
        if (this.elements.movieDetailBtn) {
            this.elements.movieDetailBtn.addEventListener('click', () => {
                if (this.selectedMovie) {
                    window.location.href = chrome.runtime.getURL(`src/pages/search/search.html?movieId=${this.selectedMovie.kinopoiskId}`);
                }
            });
        }
        if (this.elements.ratingModalClose) {
            this.elements.ratingModalClose.addEventListener('click', () => this.closeRatingModal());
        }
        if (this.elements.cancelRatingBtn) {
            this.elements.cancelRatingBtn.addEventListener('click', () => this.closeRatingModal());
        }

        // Delegation for MovieCard actions
        this.elements.resultsGrid.addEventListener('click', (e) => {
            const target = e.target;
            const actionBtn = target.closest('[data-action]');
            
            if (!actionBtn) return;
            
            const action = actionBtn.getAttribute('data-action');
            const movieId = actionBtn.getAttribute('data-movie-id');
            const ratingId = actionBtn.getAttribute('data-rating-id');
            const currentStatus = actionBtn.getAttribute('data-is-favorite') === 'true';
            
            if (action === 'view-details' && movieId) {
                window.location.href = chrome.runtime.getURL(`src/pages/search/search.html?movieId=${movieId}`);
            } else if (action === 'toggle-favorite' && ratingId) {
                // For favorites, we need the button element to update its state
                this.toggleFavorite(ratingId, currentStatus, actionBtn, movieId);
            } else if (action === 'toggle-watchlist' && movieId) {
                // Find the movie object from current results
                const movie = this.currentResults.docs.find(m => String(m.kinopoiskId) === String(movieId));
                if (movie) {
                    this.toggleWatchlist(movie, actionBtn);
                }
            } else if (action === 'add-to-collection' && movieId) {
                // TODO: Implement collection adding logic
                 if (typeof Utils !== 'undefined') {
                    Utils.showToast('Collection feature coming soon!', 'info');
                }
            } else if (action === 'edit-rating' || action === 'edit') {
                // Handle edit rating action
                let targetMovieId = movieId;
                
                // If movieId is missing on the button (e.g. inside a menu item), try to find it on the card
                if (!targetMovieId) {
                    const card = actionBtn.closest('.movie-card') || actionBtn.closest('.movie-card-component');
                    if (card) {
                        targetMovieId = card.getAttribute('data-movie-id');
                    }
                }

                if (targetMovieId) {
                    const movie = this.currentResults.docs.find(m => String(m.kinopoiskId) === String(targetMovieId));
                    if (movie) {
                        this.showRatingModal(movie);
                    } else if (this.selectedMovie && String(this.selectedMovie.kinopoiskId) === String(targetMovieId)) {
                         this.showRatingModal(this.selectedMovie);
                    }
                }
            }
        });
        
        // Rating Interactions
        if (this.elements.ratingStars) {
            // Star hover delegation
            this.elements.ratingStars.addEventListener('mouseover', (e) => {
                const btn = e.target.closest('.star-rating-btn');
                if (btn) {
                    const rating = parseInt(btn.dataset.rating);
                    this.updateStarVisuals(rating, true); // true for hover state
                }
            });

            this.elements.ratingStars.addEventListener('mouseout', () => {
                this.updateStarVisuals(this.currentRating, false); // restore actual rating
            });

            // Star click delegation
            this.elements.ratingStars.addEventListener('click', (e) => {
                const btn = e.target.closest('.star-rating-btn');
                if (btn) {
                    e.preventDefault(); // Prevent focus issues
                    const rating = parseInt(btn.dataset.rating);
                    this.currentRating = rating;
                    this.updateStarVisuals(rating, false);
                }
            });
        }

        if (this.elements.writeReviewBtn) {
            this.elements.writeReviewBtn.addEventListener('click', () => {
                this.isReviewVisible = !this.isReviewVisible;
                this.elements.reviewContainer.style.display = this.isReviewVisible ? 'block' : 'none';
                if (this.isReviewVisible) {
                    this.elements.ratingComment.focus();
                }
            });
        }

        if (this.elements.ratingComment && this.elements.charCount) {
            this.elements.ratingComment.addEventListener('input', (e) => {
                this.elements.charCount.textContent = e.target.value.length;
            });
        }
        if (this.elements.saveRatingBtn) {
            this.elements.saveRatingBtn.addEventListener('click', () => this.saveRating());
        }
        
        // Modal overlays
        if (this.elements.movieModal) {
            this.elements.movieModal.addEventListener('click', (e) => {
                if (e.target === this.elements.movieModal) this.closeMovieModal();
            });
        }
        if (this.elements.ratingModal) {
            this.elements.ratingModal.addEventListener('click', (e) => {
                if (e.target === this.elements.ratingModal) this.closeRatingModal();
            });
        }

        
        // Video Player Modal
        if (this.elements.closeVideoBtn) {
            this.elements.closeVideoBtn.addEventListener('click', () => this.closeVideoModal());
        }
        if (this.elements.videoPlayerModal) {
            this.elements.videoPlayerModal.addEventListener('click', (e) => {
                if (e.target === this.elements.videoPlayerModal) this.closeVideoModal();
            });
        }
        if (this.elements.sourceSelect) {
            this.elements.sourceSelect.addEventListener('change', (e) => this.changeVideoSource(e.target.value));
        }
        // Refresh button repurposed as Play/Pause or removed? 
        // We'll dynamically add a Play/Pause button in the controls panel

        
        // Tab navigation
        document.addEventListener('click', (e) => {
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

            if (e.target.classList.contains('tab-btn')) {
                const tabName = e.target.dataset.tab;
                
                // Update active buttons
                document.querySelectorAll('.tab-btn').forEach(btn => {
                    btn.classList.remove('active');
                });
                e.target.classList.add('active');
                
                // Update active tab content
                document.querySelectorAll('.tab-pane').forEach(pane => {
                    pane.classList.remove('active');
                });
                const targetPane = document.getElementById(`tab-${tabName}`);
                if (targetPane) {
                    targetPane.classList.add('active');
                }
            }
        });


    }

    async initializeUI() {
        // Show loading indicator immediately
        this.showInitialLoading();
        
        // Wait for firebaseManager to be ready
        if (!window.firebaseManager) {
            await this.waitForFirebaseManager();
        }
        
        // Wait for auth to be ready
        await firebaseManager.waitForAuthReady();
        
        // Check authentication
        const isAuth = firebaseManager.isAuthenticated();
        
        if (!isAuth) {
            this.showError('Пожалуйста, войдите в систему для поиска фильмов');
            return;
        }
        
        this.currentUser = firebaseManager.getCurrentUser();
        
        // Check for parameters in URL
        const urlParams = new URLSearchParams(window.location.search);
        const movieId = urlParams.get('movieId');
        const query = urlParams.get('q') || urlParams.get('query'); // Support both 'q' and 'query'
        
        if (movieId) {
            await this.loadMovieById(movieId, false);
        } else if (query) {
            this.elements.searchInput.value = query;
            this.currentQuery = query;
            this.currentPage = 1;
            await this.searchMovies();
        }
        
        // Initialize filters
        this.initializeFilters();
        
        // Load saved filter state
        this.loadFilterState();
        
        // Hide initial loading only if no movie/query was processed
        if (!movieId && !query) {
            this.hideInitialLoading();
        }
    }

    initializeFilters() {
        // Set current year as default max for year range
        const currentYear = new Date().getFullYear();
        this.elements.yearToFilter.value = currentYear;
        
        // Common genres with Russian translations
        const genres = [
            'боевик', 'приключения', 'анимация', 'биография', 'комедия', 
            'криминал', 'документальный', 'драма', 'семейный', 'фэнтези', 
            'история', 'ужасы', 'музыка', 'мюзикл', 'детектив', 'мелодрама', 
            'фантастика', 'спорт', 'триллер', 'военный', 'вестерн'
        ];
        
        this.elements.genreCheckboxes.innerHTML = '';
        genres.forEach((genre, index) => {
            const checkboxItem = this.createCheckboxItem(`genre-${index}`, genre, genre);
            this.elements.genreCheckboxes.appendChild(checkboxItem);
        });
        
        // Common countries with Russian names
        const countries = [
            'США', 'Великобритания', 'Франция', 'Германия', 'Италия', 
            'Испания', 'Россия', 'Япония', 'Китай', 'Индия', 
            'Австралия', 'Канада', 'Бразилия', 'Мексика', 'Южная Корея'
        ];
        
        this.elements.countryCheckboxes.innerHTML = '';
        countries.forEach((country, index) => {
            const checkboxItem = this.createCheckboxItem(`country-${index}`, country, country);
            this.elements.countryCheckboxes.appendChild(checkboxItem);
        });
    }

    createCheckboxItem(id, value, label) {
        const item = document.createElement('div');
        item.className = 'checkbox-item';
        item.setAttribute('data-filter-state', 'neutral'); // neutral, include, exclude
        item.setAttribute('data-filter-value', value);
        item.setAttribute('data-filter-id', id);
        
        // Hidden checkbox for backward compatibility
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = id;
        checkbox.value = value;
        checkbox.style.display = 'none';
        
        const labelEl = document.createElement('label');
        labelEl.htmlFor = id;
        labelEl.textContent = label;
        
        item.appendChild(checkbox);
        item.appendChild(labelEl);
        
        // Three-state toggle on click
        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const currentState = item.getAttribute('data-filter-state');
            let newState;
            
            // Cycle through states: neutral → include → exclude → neutral
            if (currentState === 'neutral') {
                newState = 'include';
                item.classList.add('filter-include');
                item.classList.remove('filter-exclude', 'selected');
                checkbox.checked = true;
            } else if (currentState === 'include') {
                newState = 'exclude';
                item.classList.add('filter-exclude');
                item.classList.remove('filter-include', 'selected');
                checkbox.checked = false;
            } else { // exclude
                newState = 'neutral';
                item.classList.remove('filter-include', 'filter-exclude', 'selected');
                checkbox.checked = false;
            }
            
            item.setAttribute('data-filter-state', newState);
        });
        
        return item;
    }

    async performSearch() {
        const query = this.elements.searchInput.value.trim();
        if (!query) {
            this.showError('Please enter a search query');
            return;
        }
        
        // Hide search history dropdown
        this.hideSearchHistory();
        
        // Add to search history
        await this.searchHistoryService.addToHistory(query);
        
        this.currentQuery = query;
        this.currentPage = 1;
        await this.searchMovies();
    }

    async searchMovies() {
        try {
            // Clear old results immediately to prevent flickering
            this.currentResults = { docs: [], total: 0, pages: 0 };
            this.elements.resultsGrid.innerHTML = '';
            this.elements.resultsHeader.style.display = 'none';
            this.elements.pagination.style.display = 'none';
            
            this.showLoading(true);
            this.hideError();
            
            // Wait for firebaseManager to be ready
            if (!window.firebaseManager) {
                await this.waitForFirebaseManager();
            }
            
            const kinopoiskService = firebaseManager.getKinopoiskService();
            const movieCacheService = firebaseManager.getMovieCacheService();
            
            // Check if API is configured
            if (!kinopoiskService.isConfigured()) {
                this.showError('Kinopoisk API key not configured. Please check the configuration.');
                return;
            }
            
            // Get current filters
            const filters = this.getSelectedFilters();
            
            // Search movies with year range filter if available
            const searchResults = await kinopoiskService.searchMovies(
                this.currentQuery,
                this.currentPage,
                20,
                filters
            );
            
            // Apply client-side filtering (for filters not supported by API)
            let filteredResults = searchResults;
            if (searchResults && searchResults.docs) {
                // Filter out movies with no KP rating
                const ratedDocs = searchResults.docs.filter(movie => movie.kpRating && movie.kpRating > 0);
                const filteredDocs = this.applyClientSideFilters(ratedDocs, filters);
                filteredResults = {
                    ...searchResults,
                    docs: filteredDocs,
                    total: filteredDocs.length
                };
            }
            
            // Note: Movies are no longer cached here to save database quota
            // They will be cached only when users rate them
            
            this.currentResults = filteredResults;
            
            if (filteredResults && filteredResults.docs) {
                await this.displayResults();
            } else {
                this.currentResults = { docs: [], total: 0, pages: 0 };
                await this.displayResults();
            }
            
        } catch (error) {
            console.error('Search error:', error);
            
            // Provide more user-friendly error messages
            let errorMessage = 'Произошла ошибка при поиске фильмов';
            
            if (error.message.includes('500')) {
                if (this.hasCyrillic(this.currentQuery)) {
                    errorMessage = `Проблема с поиском на кириллице "${this.currentQuery}". Попробуйте английское название или другие ключевые слова.`;
                } else {
                    errorMessage = 'Сервер временно недоступен. Попробуйте позже или измените запрос.';
                }
            } else if (error.message.includes('404')) {
                errorMessage = 'По вашему запросу ничего не найдено. Попробуйте другие ключевые слова.';
            } else if (error.message.includes('403')) {
                errorMessage = 'Проблема с доступом к API. Проверьте настройки.';
            } else if (error.message.includes('network') || error.message.includes('fetch')) {
                errorMessage = 'Проблема с подключением к интернету. Проверьте соединение.';
            }
            
            this.showError(errorMessage);
        } finally {
            this.showLoading(false);
        }
    }

    async waitForFirebaseManager() {
        return new Promise((resolve) => {
            if (window.firebaseManager && window.firebaseManager.isInitialized) {
                resolve();
                return;
            }
            
            const onReady = () => {
                window.removeEventListener('firebaseManagerReady', onReady);
                resolve();
            };
            window.addEventListener('firebaseManagerReady', onReady);
            
            let attempts = 0;
            const maxAttempts = 50;
            
            const checkInterval = setInterval(() => {
                attempts++;
                
                if (window.firebaseManager && window.firebaseManager.isInitialized) {
                    clearInterval(checkInterval);
                    window.removeEventListener('firebaseManagerReady', onReady);
                    resolve();
                }
                
                if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    window.removeEventListener('firebaseManagerReady', onReady);
                    resolve();
                }
            }, 100);
        });
    }

    async displayResults() {
        if (this.currentResults.docs.length === 0) {
            this.elements.resultsGrid.classList.add('single-item');
            this.elements.resultsGrid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div>
                    <h3 class="empty-state-title">Фильмы не найдены</h3>
                    <p class="empty-state-text">Попробуйте изменить поисковый запрос или воспользуйтесь фильтрами</p>
                </div>
            `;
            this.elements.resultsHeader.style.display = 'none';
            this.elements.pagination.style.display = 'none';
            return;
        }
        
        // Show results header
        this.elements.resultsHeader.style.display = 'flex';
        this.elements.resultsInfo.textContent = `Найдено ${this.currentResults.total} фильмов`;
        
        // Remove single-item class for grid layout
        this.elements.resultsGrid.classList.remove('single-item');
        
        // Load user ratings for movies if user is logged in
        let userRatingsMap = {};
        if (this.currentUser) {
            try {
                const ratingService = firebaseManager.getRatingService();
                const movieIds = this.currentResults.docs.map(m => m.kinopoiskId);
                
                // Use Promise.all for parallel fetching
                const ratingPromises = movieIds.map(async (movieId) => {
                    try {
                        const rating = await ratingService.getRating(this.currentUser.uid, movieId);
                        return { movieId, rating };
                    } catch (error) {
                        return { movieId, rating: null };
                    }
                });

                const results = await Promise.all(ratingPromises);
                results.forEach(({ movieId, rating }) => {
                    if (rating) {
                        userRatingsMap[movieId] = rating;
                    }
                });
            } catch (error) {
                console.error('Error loading user ratings:', error);
            }
        }
        
        // Display movie cards with user ratings
        this.elements.resultsGrid.innerHTML = ''; // Clear existing content
        
        this.currentResults.docs.forEach(movie => {
            const userRating = userRatingsMap[movie.kinopoiskId] || null;
            const isFavorite = userRating?.isFavorite === true;
            const ratingId = userRating?.id || null;
            
            // Prepare data for MovieCard
            const cardData = {
                movie: movie,
                id: ratingId,
                isFavorite: isFavorite,
                // Pass user rating if exists
                rating: userRating ? userRating.rating : 0,
                comment: userRating ? userRating.comment : '',
            };
            
            // Options for MovieCard
            const cardOptions = {
                showFavorite: true,
                showWatchlist: true,
                showUserInfo: false, // Don't show user info on search results
                showAverageRating: true,
                showThreeDotMenu: true,
                showEditRating: false, // Edit is handled via menu or modal
                showAddToCollection: true
            };
            
            const cardElement = MovieCard.create(cardData, cardOptions);
            this.elements.resultsGrid.appendChild(cardElement);
        });
        
        // Update button states
        if (this.currentUser) {
            this.updateButtonStates().catch(err => console.error('Error updating button states:', err));
        }
        
        // Show pagination
        this.elements.pagination.style.display = 'flex';
        this.elements.pageInfo.textContent = `Страница ${this.currentPage} из ${this.currentResults.pages}`;
        this.elements.prevPageBtn.disabled = this.currentPage <= 1;
        this.elements.nextPageBtn.disabled = this.currentPage >= this.currentResults.pages;
    }

    // Removed createMovieCard method as it is replaced by MovieCard component

    async loadMovieById(movieId, showLoading = true) {
        try {
            if (showLoading) {
                this.showLoading(true);
            }
            
            const kinopoiskService = firebaseManager.getKinopoiskService();
            const movieCacheService = firebaseManager.getMovieCacheService();
            
            // Check cache/firebase first
            // Note: getCachedMovie already checks localStorage then Firestore
            let movie = await movieCacheService.getCachedMovie(movieId);
            
            // Check if movie exists and has detailed info (using budget/fees/persons as proxy)
            // Search results might be cached but lack detailed info like budget/fees/full crew
            const hasDetailedInfo = movie && (movie.budget || movie.fees?.world || movie.fees?.usa || (movie.persons && movie.persons.length > 0));
            
            if (!movie || !hasDetailedInfo) {
                console.log('Movie not found in cache or missing details, fetching from API...');
                movie = await kinopoiskService.getMovieById(movieId);
                
                // Cache the new movie data
                if (movie) {
                    await movieCacheService.cacheMovie(movie);
                }
            } else {
                console.log('Loaded movie from cache');
            }
            
            if (!movie) {
               throw new Error('Movie not found');
            }
            
            // Check and fetch awards (works for both cached and newly fetched movies)
            // Awards are parsed for display but saved to Firebase only if movie is rated
            console.log('[Awards Debug] Checking awards for movie...');
            console.log('[Awards Debug] movie.awards:', movie.awards);
            console.log('[Awards Debug] Awards exists?', !!movie.awards);
            console.log('[Awards Debug] Awards length:', movie.awards?.length);
            
            if (!movie.awards || movie.awards.length === 0) {
                console.log('[Awards Debug] ✓ Awards missing or empty, starting parsing...');
                try {
                    console.log('Fetching awards by parsing kinopoisk.ru...');
                    const awardsParser = new AwardsParsingService();
                    const awards = await awardsParser.getAwards(movieId);
                    movie.awards = awards;
                    console.log(`Fetched ${awards.length} awards from Kinopoisk.ru`);
                    
                    // Check if movie is already rated by user
                    try {
                        const ratingService = firebaseManager.getRatingService();
                        const currentUser = firebaseManager.getCurrentUser();
                        
                        if (currentUser) {
                            const userRating = await ratingService.getRating(currentUser.uid, movieId);
                            
                            if (userRating) {
                                // Movie is rated → save awards to Firebase
                                console.log('[Awards Debug] Movie is rated, saving awards to Firebase');
                                await movieCacheService.cacheMovie(movie, true); // isRated = true
                            } else {
                                // Movie not rated → don't save to Firebase
                                console.log('[Awards Debug] Movie NOT rated, awards parsed but NOT saved to Firebase');
                            }
                        } else {
                            console.log('[Awards Debug] User not authenticated, not saving awards');
                        }
                    } catch (ratingError) {
                        console.warn('[Awards Debug] Could not check rating status:', ratingError);
                        // If can't check rating, don't save to be safe
                    }
                } catch (e) {
                     console.error('Failed to parse awards', e);
                     movie.awards = [];
                }
            } else {
                console.log('[Awards Debug] ✗ Awards already present, skipping parsing');
            }
            
            // Try to get movie images/frames
            // We only fetch frames if we are showing the details view
            try {
                // Determine if we need to fetch frames (e.g. if cached frames are missing or empty)
                // For now, we attempt to fetch if not present, but maybe cache them too? 
                // The current MovieCacheService structure might not store strict "frames", 
                // but let's see if we can attach them to the movie object before display.
                
                // If the movie came from cache and has frames stored, reuse them?
                // Standard movie object might not have frames. 
                // We will try to fetch frames from API if they are missing, 
                // but this is a secondary request so it is less critical.
                // To totally minimize API calls per user request, we could skip this if "only db" is strict,
                // but frames usually need API. User asked "details of movie... from base",
                // usually meaning the main metadata.
                
                if (!movie.frames || movie.frames.length === 0) {
                     const images = await kinopoiskService.getMovieImages(movieId);
                     if (images && images.length > 0) {
                        movie.frames = images;
                        // Optional: update cache with frames if the structure allows, 
                        // but MovieCacheService might need update for that. 
                        // For now we just display them.
                     }
                }
            } catch (imagesError) {
                // Silently handle image loading errors
            }
            
            // Start preloading video sources in background
            this.preloadSources(movie);
            
            await this.displaySingleMovieResult(movie);
            
        } catch (error) {
            console.error('Error loading movie:', error);
            this.showError(`Failed to load movie: ${error.message}`);
        } finally {
            if (showLoading) {
                this.showLoading(false);
            }
        }
    }

    async displaySingleMovieResult(movie) {
        // Show results header for single movie
        this.elements.resultsHeader.style.display = 'flex';
        this.elements.resultsInfo.textContent = `Информация о фильме`;
        
        // Load user rating if user is logged in
        let userRating = null;
        if (this.currentUser) {
            try {
                const ratingService = firebaseManager.getRatingService();
                userRating = await ratingService.getRating(this.currentUser.uid, movie.kinopoiskId);
            } catch (error) {
                console.warn('Failed to load user rating:', error);
            }
        }
        
        // Create detailed movie card for single movie view with user rating
        const movieHTML = this.createDetailedMovieCard(movie, userRating);
        
        // Remove single-item class for movie display
        this.elements.resultsGrid.classList.remove('single-item');
        this.elements.resultsGrid.innerHTML = movieHTML;
        
        // Setup show all awards button listener
        const showAllAwardsBtn = this.elements.resultsGrid.querySelector('.btn-show-all-awards');
        if (showAllAwardsBtn) {
            showAllAwardsBtn.addEventListener('click', function() {
                this.style.display = 'none';
                const hiddenGrid = this.previousElementSibling;
                if (hiddenGrid && hiddenGrid.classList.contains('awards-grid-hidden')) {
                    hiddenGrid.style.display = 'grid';
                }
            });
        }
        
        // Load user ratings after displaying movie
        this.loadAndDisplayUserRatings(movie.kinopoiskId);
        
        // Update button states for detail page
        if (this.currentUser) {
            setTimeout(() => {
                this.updateButtonStates().catch(err => console.error('Error updating button states:', err));
            }, 200);
        }
        
        // Hide pagination for single movie
        this.elements.pagination.style.display = 'none';
        
        // Store the movie for rating functionality
        this.selectedMovie = movie;
    }

    createMovieFramesSection(movie) {
        // Check if movie has frames/images
        
        // Try various possible sources for frames/images
        let frames = [];
        
        // Check API response fields
        if (movie.frames && Array.isArray(movie.frames)) {
            frames = movie.frames;
        } else if (movie.images && Array.isArray(movie.images)) {
            frames = movie.images;
        } else if (movie.backdrop && Array.isArray(movie.backdrop)) {
            frames = movie.backdrop;
        } else if (movie.backdrops && Array.isArray(movie.backdrops)) {
            frames = movie.backdrops;
        } else if (movie.screenshots && Array.isArray(movie.screenshots)) {
            frames = movie.screenshots;
        } else if (movie.stills && Array.isArray(movie.stills)) {
            frames = movie.stills;
        }
        
        // Also check if backdrop is a single object with URL
        if (frames.length === 0 && movie.backdrop && typeof movie.backdrop === 'object') {
            if (movie.backdrop.url || movie.backdrop.previewUrl) {
                frames = [movie.backdrop];
            }
        }
        
        console.log('Found frames:', frames);
        
        // If no frames found, create test frames using movie poster as fallback
        if (!frames || frames.length === 0) {
            console.log('No frames found for movie, using poster as fallback');
            if (movie.posterUrl) {
                frames = [
                    { url: movie.posterUrl, type: 'poster' }
                ];
            } else {
                return '';
            }
        }
        
        // Take first 6 frames for display
        const displayFrames = frames.slice(0, 6);
        
        // Save displayFrames to movie object for modal navigation
        if (!movie.displayFrames) {
            movie.displayFrames = displayFrames;
        }
        
        const framesHTML = displayFrames.map((frame, index) => {
            // Handle different possible frame data structures
            let frameUrl = '';
            
            if (typeof frame === 'string') {
                frameUrl = frame;
            } else if (typeof frame === 'object') {
                frameUrl = frame.url || frame.previewUrl || frame.image || frame.src || 
                          (frame.backdrop && frame.backdrop.url) || 
                          (frame.poster && frame.poster.url);
            }
            
            if (!frameUrl) {
                console.log('No valid URL found for frame:', frame);
                return '';
            }
            
            return `
                <div class="movie-frame" data-frame-url="${frameUrl}" data-frame-index="${index}">
                    <img src="${frameUrl}" alt="Кадр из фильма" class="movie-frame-image" data-fallback="frame">
                </div>
            `;
        }).join('');
        
        if (framesHTML) {
            return `
                <div class="movie-frames-section">
                    <h4>Кадры из фильма</h4>
                    <div class="movie-frames-grid">
                        ${framesHTML}
                    </div>
                </div>
            `;
        }
        
        return '';
    }

    async loadAndDisplayUserRatings(movieId) {
        const ratingsSection = document.getElementById('userRatingsSection');
        if (!ratingsSection) return;
        
        const loadingEl = ratingsSection.querySelector('.user-ratings-loading');
        const contentEl = ratingsSection.querySelector('.user-ratings-content');
        
        try {
            loadingEl.style.display = 'flex';
            contentEl.innerHTML = '';
            
            const ratingService = firebaseManager.getRatingService();
            const userService = firebaseManager.getUserService();
            const currentUser = firebaseManager.getCurrentUser();
            
            const movieIdNum = typeof movieId === 'string' ? parseInt(movieId) : movieId;
            const ratings = await ratingService.getMovieRatings(movieIdNum, 50);
            
            if (ratings.length === 0) {
                contentEl.innerHTML = `
                    <div class="user-ratings-empty">
                        <p>Будьте первым, кто оценит этот фильм!</p>
                    </div>
                `;
                loadingEl.style.display = 'none';
                return;
            }
            
            const userIds = [...new Set(ratings.map(r => r.userId))];
            const userProfiles = await userService.getUserProfilesByIds(userIds);
            const userProfileMap = new Map(userProfiles.map(u => [u.userId || u.id, u]));
            
            if (currentUser) {
                const currentUserProfile = await userService.getUserProfile(currentUser.uid);
                if (currentUserProfile) {
                    userProfileMap.set(currentUser.uid, currentUserProfile);
                } else if (currentUser.photoURL || currentUser.displayName) {
                    userProfileMap.set(currentUser.uid, {
                        userId: currentUser.uid,
                        photoURL: currentUser.photoURL,
                        displayName: currentUser.displayName
                    });
                }
            }
            
            const ratingsHTML = this.createUserRatingsSection(ratings, userProfileMap, currentUser?.uid);
            contentEl.innerHTML = ratingsHTML;
            
            // Add event listener for watch button
            const watchBtn = document.querySelector('.watch-movie-btn');
            if (watchBtn) {
                watchBtn.addEventListener('click', () => this.handleWatchClick());
            }

            // Setup menu event listeners
            this.setupRatingMenuListeners();
            
            // Setup username click listeners
            this.setupUsernameClickListeners();
            
        } catch (error) {
            console.error('Error loading user ratings:', error);
            contentEl.innerHTML = `
                <div class="user-ratings-error">
                    <p>Ошибка загрузки отзывов. Попробуйте обновить страницу.</p>
                </div>
            `;
        } finally {
            loadingEl.style.display = 'none';
        }
    }

    createUserRatingsSection(ratings, userProfileMap, currentUserId) {
        if (ratings.length === 0) {
            return `
                <div class="user-ratings-empty">
                    <p>Будьте первым, кто оценит этот фильм!</p>
                </div>
            `;
        }
        
        const ratingsHTML = ratings.map(rating => {
            const userProfile = userProfileMap.get(rating.userId);
            const userName = typeof Utils !== 'undefined' && Utils.getDisplayName
                ? Utils.getDisplayName(userProfile, null)
                : (userProfile?.displayName || rating.userName || 'Неизвестный пользователь');
            const userPhoto = userProfile?.photoURL || rating.userPhoto || '/icons/icon48.png';
            const isCurrentUser = currentUserId && rating.userId === currentUserId;
            const userId = rating.userId;
            
            const timestamp = rating.createdAt?.toDate ? rating.createdAt.toDate() : new Date(rating.createdAt);
            const formattedDate = this.formatRatingDate(timestamp);
            
            return `
                <div class="user-rating-card ${isCurrentUser ? 'current-user' : ''}" data-rating-id="${rating.id}">
                    <div class="user-rating-header">
                        <img src="${userPhoto}" alt="${this.escapeHtml(userName)}" class="user-rating-avatar" onerror="this.src='/icons/icon48.png'">
                        <div class="user-rating-info">
                            <div class="user-rating-name clickable-username" data-user-id="${userId}">${this.escapeHtml(userName)}</div>
                            <div class="user-rating-score"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> ${rating.rating}/10</div>
                        </div>
                        ${isCurrentUser ? `
                            <div class="user-rating-menu">
                                <button class="user-rating-menu-btn" data-rating-id="${rating.id}" aria-label="Меню отзыва">
                                    <span>⋮</span>
                                </button>
                                <div class="user-rating-menu-dropdown" id="menu-${rating.id}" style="display: none;">
                                    <button class="menu-item edit-item" data-rating-id="${rating.id}" data-action="edit">
                                        <span class="menu-icon">✏️</span>
                                        <span>Редактировать</span>
                                    </button>
                                    <button class="menu-item delete-item" data-rating-id="${rating.id}" data-action="delete">
                                        <span class="menu-icon">🗑️</span>
                                        <span>Удалить</span>
                                    </button>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    ${rating.comment ? `
                        <div class="user-rating-comment">${this.escapeHtml(rating.comment)}</div>
                    ` : ''}
                    <div class="user-rating-date">${formattedDate}</div>
                </div>
            `;
        }).join('');
        
        return `
            <div class="user-ratings-container">
                <h4 class="user-ratings-title">Оценки пользователей</h4>
                <div class="user-ratings-list">
                    ${ratingsHTML}
                </div>
            </div>
        `;
    }

    formatRatingDate(date) {
        if (!date || !(date instanceof Date)) {
            return 'Дата неизвестна';
        }
        
        const now = new Date();
        const diffInMs = now - date;
        const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
        
        if (diffInDays === 0) {
            return 'Сегодня';
        } else if (diffInDays === 1) {
            return 'Вчера';
        } else if (diffInDays < 7) {
            return `${diffInDays} ${this.getDayWord(diffInDays)} назад`;
        } else if (diffInDays < 30) {
            const weeks = Math.floor(diffInDays / 7);
            return `${weeks} ${this.getWeekWord(weeks)} назад`;
        } else {
            const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 
                          'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
            const day = date.getDate();
            const month = months[date.getMonth()];
            const year = date.getFullYear();
            return `${day} ${month} ${year}`;
        }
    }

    getDayWord(days) {
        if (days === 1) return 'день';
        if (days >= 2 && days <= 4) return 'дня';
        return 'дней';
    }

    getWeekWord(weeks) {
        if (weeks === 1) return 'неделю';
        if (weeks >= 2 && weeks <= 4) return 'недели';
        return 'недель';
    }

    createDetailedMovieCard(movie, userRating = null) {
        const posterUrl = movie.posterUrl || '/icons/icon48.png';
        const year = movie.year || '';
        const genres = movie.genres?.join(', ') || '';
        const countries = movie.countries?.join(', ') || '';
        const kpRating = movie.kpRating || 0;
        const imdbRating = movie.imdbRating || 0;
        const duration = movie.duration || 0;
        const description = movie.description || 'Описание отсутствует';
        const votes = movie.votes?.kp || 0;
        const imdbVotes = movie.votes?.imdb || 0;
        
        const isRated = !!userRating;
        const isFavorite = userRating?.isFavorite === true;
        const ratingId = userRating?.id || null;
        
        // Get kinopoisk service for helper functions
        const kinopoiskService = typeof window !== 'undefined' && window.kinopoiskService 
            ? window.kinopoiskService 
            : new KinopoiskService();
        
        // Extract crew information
        const directors = kinopoiskService.getPersonsByProfession(movie.persons, 'DIRECTOR');
        const writers = kinopoiskService.getPersonsByProfession(movie.persons, 'WRITER');
        const producers = kinopoiskService.getPersonsByProfession(movie.persons, 'PRODUCER');
        const operators = kinopoiskService.getPersonsByProfession(movie.persons, 'OPERATOR');
        const composers = kinopoiskService.getPersonsByProfession(movie.persons, 'COMPOSER');
        const designers = kinopoiskService.getPersonsByProfession(movie.persons, 'DESIGNER');
        const editors = kinopoiskService.getPersonsByProfession(movie.persons, 'EDITOR');
        const actors = kinopoiskService.getPersonsByProfession(movie.persons, 'ACTOR');
        
        // Format crew names
        const directorsStr = kinopoiskService.formatPersonNames(directors);
        const writersStr = kinopoiskService.formatPersonNames(writers);
        const producersStr = kinopoiskService.formatPersonNames(producers);
        const operatorsStr = kinopoiskService.formatPersonNames(operators);
        const composersStr = kinopoiskService.formatPersonNames(composers);
        const designersStr = kinopoiskService.formatPersonNames(designers);
        const editorsStr = kinopoiskService.formatPersonNames(editors);
        
        // Format financial data
        const budgetStr = kinopoiskService.formatCurrency(movie.budget);
        const feesUsaStr = kinopoiskService.formatCurrency(movie.fees?.usa);
        const feesWorldStr = kinopoiskService.formatCurrency(movie.fees?.world);
        const feesRussiaStr = kinopoiskService.formatCurrency(movie.fees?.russia);
        
        // Format premiere dates
        // Extract distributor
        let distributorStr = '';
        if (movie.distributors) {
            const distObj = Array.isArray(movie.distributors) ? movie.distributors[0] : movie.distributors;
            distributorStr = distObj?.distributor || distObj?.value || '';
        }

        const premiereRussiaStr = movie.premiere?.russia 
            ? kinopoiskService.formatDate(movie.premiere.russia) + (distributorStr ? `, «${distributorStr}»` : '')
            : '';
        const premiereWorldStr = movie.premiere?.world 
            ? kinopoiskService.formatDate(movie.premiere.world) 
            : '';
        const premiereDigitalStr = movie.premiere?.digital 
            ? kinopoiskService.formatDate(movie.premiere.digital) + (distributorStr ? `, «${distributorStr}»` : '')
            : '';
        
        // Get audience data for Russia
        const audienceRussia = movie.audience?.find(a => a.country === 'Россия' || a.country === 'Russia');
        const audienceRussiaStr = audienceRussia 
            ? `${(audienceRussia.count / 1000).toFixed(1)} тыс` 
            : '';
        
        return `
            <div class="movie-detail-page">
                <div class="movie-detail-header">
                    <div class="movie-detail-poster-container">
                        <img src="${posterUrl}" alt="${movie.name}" class="movie-detail-page-poster" data-fallback="detail">
                        <div class="movie-poster-placeholder" style="display: none;">🎬</div>
                        <!-- Menu Button -->
                        <div class="mc-menu-container" style="position: absolute; top: 10px; right: 10px; z-index: 20;">
                            <button class="mc-menu-btn" title="More options">
                                <span>⋮</span>
                            </button>
                            <div class="mc-menu-dropdown">
                                <button class="mc-menu-item" data-action="toggle-favorite" 
                                        data-rating-id="${ratingId || 'null'}" 
                                        data-movie-id="${movie.kinopoiskId}"
                                        data-is-favorite="${isFavorite}">
                                    <span class="mc-menu-item-icon">${isFavorite ? '💔' : '❤️'}</span>
                                    <span class="mc-menu-item-text">${isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}</span>
                                </button>
                                
                                <button class="mc-menu-item" data-action="toggle-watchlist"
                                        data-movie-id="${movie.kinopoiskId}">
                                    <span class="mc-menu-item-icon">🔖</span>
                                    <span class="mc-menu-item-text">Add to Watchlist</span>
                                </button>
                                
                                <button class="mc-menu-item" data-action="add-to-collection"
                                        data-movie-id="${movie.kinopoiskId}">
                                    <span class="mc-menu-item-icon">📁</span>
                                    <span class="mc-menu-item-text">Add to Collection</span>
                                </button>
                            </div>
                        </div>
                        
                        <!-- Ratings under poster -->
                        <div class="movie-detail-ratings-container">
                            <div class="rating-item-large kp">
                                <span class="rating-label">Кинопоиск</span>
                                <span class="rating-value">${parseFloat(kpRating.toFixed(1))}</span>
                                ${votes > 0 ? `<span class="rating-votes">${this.formatVotes(votes)} оценок</span>` : ''}
                            </div>
                            ${imdbRating > 0 ? `
                            <div class="rating-item-large imdb">
                                <span class="rating-label">IMDb</span>
                                <span class="rating-value">${parseFloat(imdbRating.toFixed(1))}</span>
                                ${imdbVotes > 0 ? `<span class="rating-votes">${this.formatVotes(imdbVotes)} оценок</span>` : '<span class="rating-votes">&nbsp;</span>'}
                            </div>` : ''}
                        </div>
                        
                        <!-- Action buttons under ratings -->
                        <div class="movie-actions-container">
                            <button class="btn btn-primary btn-lg watch-movie-btn" data-movie-id="${movie.kinopoiskId}">
                                <span class="btn-icon"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
                                Смотреть
                            </button>
                            <button class="btn btn-accent btn-lg rate-movie-btn" data-movie-id="${movie.kinopoiskId}">
                                <span class="btn-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></span>
                                Оценить фильм
                            </button>
                        </div>
                    </div>
                    
                    <div class="movie-detail-info-container">
                        <h1 class="movie-detail-page-title">${this.escapeHtml(movie.name)}</h1>
                        ${movie.alternativeName ? `<h2 class="movie-detail-alt-title">${this.escapeHtml(movie.alternativeName)}</h2>` : ''}
                        
                        <!-- Tabs Navigation -->
                        <div class="movie-tabs">
                            <div class="tab-buttons">
                                <button class="tab-btn active" data-tab="about">О фильме</button>
                                <button class="tab-btn ${actors.length === 0 ? 'disabled' : ''}" data-tab="actors" ${actors.length === 0 ? 'disabled' : ''}>Актёры</button>
                                <button class="tab-btn ${!movie.awards || movie.awards.length === 0 ? 'disabled' : ''}" data-tab="awards" ${!movie.awards || movie.awards.length === 0 ? 'disabled' : ''}>Награды</button>
                            </div>
                            
                            <div class="tab-content">
                                <!-- About Film Tab -->
                                <div class="tab-pane active" id="tab-about">
                                    <div class="movie-detail-meta-grid">
                                        <!-- Basic Info -->
                                        <div class="meta-item">
                                            <span class="meta-label">Год производства:</span>
                                            <span class="meta-value">${year}</span>
                                        </div>
                                        ${countries ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Страна:</span>
                                            <span class="meta-value">${countries}</span>
                                        </div>` : ''}
                                        <div class="meta-item">
                                            <span class="meta-label">Жанр:</span>
                                            <span class="meta-value">${genres}</span>
                                        </div>
                                        <div class="meta-item">
                                            <span class="meta-label">Слоган:</span>
                                            <span class="meta-value">${movie.slogan ? `«${this.escapeHtml(movie.slogan)}»` : '—'}</span>
                                        </div>
                                        
                                        <!-- Crew -->
                                        ${directorsStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Режиссер:</span>
                                            <span class="meta-value">${this.escapeHtml(directorsStr)}</span>
                                        </div>` : ''}
                                        ${writersStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Сценарий:</span>
                                            <span class="meta-value">${this.escapeHtml(writersStr)}</span>
                                        </div>` : ''}
                                        ${producersStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Продюсер:</span>
                                            <span class="meta-value">${this.escapeHtml(producersStr)}</span>
                                        </div>` : ''}
                                        ${operatorsStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Оператор:</span>
                                            <span class="meta-value">${this.escapeHtml(operatorsStr)}</span>
                                        </div>` : ''}
                                        ${composersStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Композитор:</span>
                                            <span class="meta-value">${this.escapeHtml(composersStr)}</span>
                                        </div>` : ''}
                                        ${designersStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Художник:</span>
                                            <span class="meta-value">${this.escapeHtml(designersStr)}</span>
                                        </div>` : ''}
                                        ${editorsStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Монтаж:</span>
                                            <span class="meta-value">${this.escapeHtml(editorsStr)}</span>
                                        </div>` : ''}
                                        
                                        <!-- Financial Info -->
                                        ${budgetStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Бюджет:</span>
                                            <span class="meta-value">${budgetStr}</span>
                                        </div>` : ''}
                                        ${feesUsaStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Сборы в США:</span>
                                            <span class="meta-value">${feesUsaStr}</span>
                                        </div>` : ''}
                                        ${feesWorldStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Сборы в мире:</span>
                                            <span class="meta-value">${feesWorldStr}</span>
                                        </div>` : ''}
                                        ${feesRussiaStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Сборы в России:</span>
                                            <span class="meta-value">${feesRussiaStr}</span>
                                        </div>` : ''}
                                        ${audienceRussiaStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Зрители:</span>
                                            <span class="meta-value">${audienceRussiaStr}</span>
                                        </div>` : ''}
                                        
                                        <!-- Premiere Info -->
                                        ${premiereRussiaStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Премьера в России:</span>
                                            <span class="meta-value">${premiereRussiaStr}</span>
                                        </div>` : ''}
                                        ${premiereWorldStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Премьера в мире:</span>
                                            <span class="meta-value">${premiereWorldStr}</span>
                                        </div>` : ''}
                                        ${premiereDigitalStr ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Цифровой релиз:</span>
                                            <span class="meta-value">${premiereDigitalStr}</span>
                                        </div>` : ''}
                                        
                                        <!-- Age and Duration -->
                                        ${movie.ageRating ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Возраст:</span>
                                            <span class="meta-value">${movie.ageRating}+</span>
                                        </div>` : ''}
                                        ${movie.ratingMpaa ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Рейтинг MPAA:</span>
                                            <span class="meta-value">${movie.ratingMpaa.toUpperCase()}</span>
                                        </div>` : ''}
                                        ${duration ? `
                                        <div class="meta-item">
                                            <span class="meta-label">Время:</span>
                                            <span class="meta-value">${Math.floor(duration / 60)} ч ${duration % 60} мин</span>
                                        </div>` : ''}
                                    </div>
                                </div>
                                
                                <!-- Actors Tab -->
                                <div class="tab-pane" id="tab-actors">
                                    ${actors.length > 0 ? `
                                        <div class="actors-grid">
                                            ${actors.map(actor => {
                                                const photoUrl = actor.photo || '';
                                                const name = actor.name || actor.enName || 'Неизвестно';
                                                const role = actor.description || actor.enProfession || '';
                                                
                                                return `
                                                <div class="actor-card">
                                                    <div class="actor-photo-container">
                                                        ${photoUrl ? 
                                                            `<img src="${photoUrl}" alt="${this.escapeHtml(name)}" class="actor-photo" loading="lazy">` : 
                                                            `<div class="actor-placeholder">🎭</div>`
                                                        }
                                                    </div>
                                                    <div class="actor-info">
                                                        <div class="actor-name">${this.escapeHtml(name)}</div>
                                                        <div class="actor-role">${this.escapeHtml(role)}</div>
                                                    </div>
                                                </div>
                                                `;
                                            }).join('')}
                                        </div>
                                    ` : `
                                        <div class="no-data-placeholder">
                                            <p>Информация об актерах отсутствует</p>
                                        </div>
                                    `}
                                </div>
                                
                                <!-- Awards Tab -->
                                <div class="tab-pane" id="tab-awards">
                                    ${(() => {
                                        if (!movie.awards || movie.awards.length === 0) return '';
                                        
                                        if (!movie.awards || movie.awards.length === 0) {
                                            console.log('No awards in movie object');
                                            return '<div class="no-data-placeholder"><p>Нет информации о наградах</p></div>';
                                        }
                                        
                                        console.log('Processing awards:', movie.awards);

                                        // Parser already returns Oscar and Golden Globe only
                                        // Data format: { name, nominationName, win, year }
                                        const notableAwards = movie.awards.sort((a, b) => (b.win ? 1 : 0) - (a.win ? 1 : 0)); // Winners first

                                        if (notableAwards.length === 0) return '<div class="no-data-placeholder"><p>Нет информации о крупных наградах</p></div>';

                                        const getAwardIcon = (name) => {
                                            if (name.includes('Оскар')) return '<img src="../../../icons/oscar.png" alt="Oscar" class="award-icon-img">'; 
                                            if (name.includes('Золотой глобус')) return '<img src="../../../icons/golden-globe.png" alt="Golden Globe" class="award-icon-img">';
                                            // Default fallback
                                            return '<img src="../../../icons/award-default.png" alt="Award" class="award-icon-img">';
                                        };

                                        const hasMoreThan6 = notableAwards.length > 6;
                                        const initialAwards = hasMoreThan6 ? notableAwards.slice(0, 6) : notableAwards;
                                        const hiddenAwards = hasMoreThan6 ? notableAwards.slice(6) : [];

                                        return `
                                            <div class="awards-grid">
                                                ${initialAwards.map(award => `
                                                    <div class="award-card">
                                                        <div class="award-icon-container">
                                                            ${getAwardIcon(award.name || '')}
                                                        </div>
                                                        <div class="award-title">${this.escapeHtml(award.name)}</div>
                                                        <div class="award-nomination">${this.escapeHtml(award.nominationName || 'Номинация')}</div>
                                                        <div class="award-badge ${award.win ? 'winner' : 'nominee'}">
                                                            ${award.win ? 'Победитель' : 'Номинация'}
                                                        </div>
                                                    </div>
                                                `).join('')}
                                            </div>
                                            ${hasMoreThan6 ? `
                                                <div class="awards-grid awards-grid-hidden" style="display: none;">
                                                    ${hiddenAwards.map(award => `
                                                        <div class="award-card">
                                                            <div class="award-icon-container">
                                                                ${getAwardIcon(award.name || '')}
                                                            </div>
                                                            <div class="award-title">${this.escapeHtml(award.name)}</div>
                                                            <div class="award-nomination">${this.escapeHtml(award.nominationName || 'Номинация')}</div>
                                                            <div class="award-badge ${award.win ? 'winner' : 'nominee'}">
                                                                ${award.win ? 'Победитель' : 'Номинация'}
                                                            </div>
                                                        </div>
                                                    `).join('')}
                                                </div>
                                                <button class="btn-show-all-awards" data-action="show-all-awards">
                                                    Показать все награды (${notableAwards.length})
                                                </button>
                                            ` : ''}
                                        `;
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="movie-detail-description">
                    <h3>Описание</h3>
                    <p>${this.escapeHtml(description)}</p>
                    ${this.createMovieFramesSection(movie)}
                    <div id="userRatingsSection" class="user-ratings-section" data-movie-id="${movie.kinopoiskId}">
                        <div class="user-ratings-loading" style="display: none;">
                            <div class="loading-spinner"></div>
                            <span>Загрузка отзывов...</span>
                        </div>
                        <div class="user-ratings-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    showMovieModal(movie) {
        this.selectedMovie = movie;
        
        this.elements.modalTitle.textContent = movie.name;
        this.elements.modalBody.innerHTML = this.createMovieDetailHTML(movie);
        
        this.elements.movieModal.style.display = 'flex';
        
        // Start preloading video sources in background
        this.preloadSources(movie);
    }
    
    /**
     * Preload video sources in background
     */
    async preloadSources(movie) {
        if (!movie) return;
         // Check cache first
        const cached = this.getCachedSources(movie.kinopoiskId);
        if (cached) {
            console.log('Sources already cached for', movie.name);
            this.currentSources = cached;
            return;
        }

        console.log('Preloading sources for', movie.name);
        try {
             const searchResult = await this.streamingService.search(movie.name, movie.year);
             if (searchResult) {
                 const sources = await this.streamingService.getVideoSources(searchResult.url);
                 if (sources && sources.length > 0) {
                     this.saveSourcesToCache(movie.kinopoiskId, sources);
                     // If this movie is still selected, update currentSources
                     if (this.selectedMovie && this.selectedMovie.kinopoiskId === movie.kinopoiskId) {
                         this.currentSources = sources;
                     }
                     console.log('Preloaded sources count:', sources.length);
                 }
             }
        } catch (e) {
            console.warn('Preload failed:', e);
        }
    }

    getCachedSources(movieId) {
        try {
            const key = `movie_sources_${movieId}`;
            const data = localStorage.getItem(key);
            if (!data) return null;
            
            const cached = JSON.parse(data);
            // Check expiry (24h)
            if (Date.now() - cached.timestamp > 24 * 60 * 60 * 1000) {
                localStorage.removeItem(key);
                return null;
            }
            return cached.sources;
        } catch (e) {
            return null;
        }
    }

    saveSourcesToCache(movieId, sources) {
        try {
            const key = `movie_sources_${movieId}`;
            const data = {
                timestamp: Date.now(),
                sources: sources
            };
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to cache sources', e);
        }
    }

    createMovieDetailHTML(movie) {
        const posterUrl = movie.posterUrl || '/icons/icon48.png';
        const year = movie.year || '';
        const genres = movie.genres?.join(', ') || '';
        const countries = movie.countries?.join(', ') || '';
        const kpRating = movie.kpRating || 0;
        const imdbRating = movie.imdbRating || 0;
        const duration = movie.duration || 0;
        const description = movie.description || '';
        
            return `
                <div class="movie-detail">
                    <img src="${posterUrl}" alt="${movie.name}" class="movie-detail-poster" data-fallback="modal">
                    <div class="movie-detail-info">
                        <h2 class="movie-detail-title">${this.escapeHtml(movie.name)}</h2>
                        <p class="movie-detail-meta">${year} • ${duration} min • ${genres}</p>
                        <div class="movie-detail-ratings">
                            <span class="rating-badge kp">Kinopoisk: ${parseFloat(kpRating.toFixed(1))}</span>
                            <span class="rating-badge imdb">IMDb: ${parseFloat(imdbRating.toFixed(1))}</span>
                        </div>
                        <p class="movie-detail-description">${this.escapeHtml(description)}</p>
                    </div>
                </div>
            `;
    }

    closeMovieModal() {
        this.elements.movieModal.style.display = 'none';
        this.selectedMovie = null;
    }

    async showRatingModal(movie) {
        this.selectedMovie = movie;
        
        // Get current user dynamically
        const currentUser = firebaseManager.getCurrentUser();
        
        // Check if user is authenticated
        if (!currentUser) {
            this.showError('Please sign in to rate movies');
            return;
        }
        
        // Update cached user
        this.currentUser = currentUser;
        
        // 1. Setup UI Content
        this.elements.ratingMoviePoster.src = movie.posterUrl || '/icons/icon48.png';
        this.elements.ratingMoviePoster.alt = movie.name;
        this.elements.ratingMovieTitle.textContent = movie.name;
        this.elements.ratingMovieMeta.textContent = `${movie.year} • ${movie.genres?.slice(0, 3).join(', ')}`;
        
        // 2. Generate Stars
        this.elements.ratingStars.innerHTML = '';
        const starSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;

        for (let i = 1; i <= 10; i++) {
            const btn = document.createElement('button');
            btn.className = 'star-rating-btn';
            btn.dataset.rating = i;
            btn.innerHTML = starSvg;
            this.elements.ratingStars.appendChild(btn);
        }
        
        // 3. Check existing rating
        const ratingService = firebaseManager.getRatingService();
        const existingRating = await ratingService.getRating(currentUser.uid, movie.kinopoiskId);
        
        if (existingRating) {
            this.currentRating = existingRating.rating;
            this.updateStarVisuals(this.currentRating, false);
            
            this.elements.ratingComment.value = existingRating.comment || '';
            this.elements.charCount.textContent = (existingRating.comment || '').length;
            
            // Show review section if there is a comment
            this.isReviewVisible = !!existingRating.comment;
            this.elements.reviewContainer.style.display = this.isReviewVisible ? 'block' : 'none';
        } else {
            this.currentRating = 0;
            this.updateStarVisuals(0, false);
            
            this.elements.ratingComment.value = '';
            this.elements.charCount.textContent = '0';
            
            this.isReviewVisible = false;
            this.elements.reviewContainer.style.display = 'none';
        }
        
        this.elements.ratingModal.style.display = 'flex';
    }

    closeRatingModal() {
        this.elements.ratingModal.style.display = 'none';
        // Reset state
        this.currentRating = 0;
        this.elements.ratingComment.value = ''; // extra safety
    }

    async saveRating() {
        try {
            // Get current user dynamically
            const currentUser = firebaseManager.getCurrentUser();
            
            // Check if user is authenticated
            if (!currentUser) {
                this.showError('Please sign in to save rating');
                return;
            }
            
            const rating = this.currentRating;
            const comment = this.elements.ratingComment.value.trim();
            
            if (!rating || rating < 1 || rating > 10) {
                this.showError('Please select a star rating');
                return;
            }
            
            const ratingService = firebaseManager.getRatingService();
            const userService = firebaseManager.getUserService();
            
            // Get user profile
            const userProfile = await userService.getUserProfile(currentUser.uid);
            
            // Get display name based on user preference
            const displayName = typeof Utils !== 'undefined' && Utils.getDisplayName
                ? Utils.getDisplayName(userProfile, currentUser)
                : (userProfile?.displayName || currentUser.displayName || currentUser.email);
            
            await ratingService.addOrUpdateRating(
                currentUser.uid,
                displayName,
                userProfile?.photoURL || currentUser.photoURL || '',
                this.selectedMovie.kinopoiskId,
                rating,
                comment,
                this.selectedMovie // Pass movie data for potential caching
            );
            
            this.closeRatingModal();
            this.showSuccess('Rating saved successfully!');
            
            // Reload user ratings section if on detail page
            if (this.selectedMovie && document.getElementById('userRatingsSection')) {
                await this.loadAndDisplayUserRatings(this.selectedMovie.kinopoiskId);
            }
            
            // Reload movie detail page to show favorite button if movie is now rated
            if (this.selectedMovie) {
                await this.loadMovieById(this.selectedMovie.kinopoiskId, false);
            }
            
            // Update button states to show favorite button if movie is now rated
            if (this.currentUser) {
                setTimeout(() => {
                    this.updateButtonStates().catch(err => console.error('Error updating button states:', err));
                }, 200);
            }
            
        } catch (error) {
            console.error('Error saving rating:', error);
            this.showError(`Failed to save rating: ${error.message}`);
        }
    }

    updateStarVisuals(rating, isHover) {
        const buttons = this.elements.ratingStars.querySelectorAll('.star-rating-btn');
        buttons.forEach(btn => {
            const starRating = parseInt(btn.dataset.rating);
            if (starRating <= rating) {
                btn.classList.add(isHover ? 'hover' : 'active');
                if (isHover) btn.classList.remove('active'); // Priority to hover class during hover
            } else {
                btn.classList.remove('active', 'hover');
            }
        });
    }

    setupRatingMenuListeners() {
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.user-rating-menu')) {
                document.querySelectorAll('.user-rating-menu-dropdown').forEach(menu => {
                    menu.style.display = 'none';
                });
            }
        });

        document.querySelectorAll('.user-rating-menu-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const ratingId = btn.getAttribute('data-rating-id');
                const menu = document.getElementById(`menu-${ratingId}`);
                
                document.querySelectorAll('.user-rating-menu-dropdown').forEach(m => {
                    if (m.id !== `menu-${ratingId}`) {
                        m.style.display = 'none';
                    }
                });
                
                if (menu) {
                    const isVisible = menu.style.display !== 'none';
                    menu.style.display = isVisible ? 'none' : 'block';
                    
                    if (!isVisible) {
                        const btnRect = btn.getBoundingClientRect();
                        menu.style.top = `${btnRect.bottom + 4}px`;
                        menu.style.right = `${window.innerWidth - btnRect.right}px`;
                    }
                }
            });
        });

        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const ratingId = item.getAttribute('data-rating-id');
                const action = item.getAttribute('data-action');
                
                const menu = document.getElementById(`menu-${ratingId}`);
                if (menu) menu.style.display = 'none';
                
                if (action === 'edit') {
                    await this.editUserRating(ratingId);
                } else if (action === 'delete') {
                    await this.deleteUserRating(ratingId);
                }
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.user-rating-menu-dropdown').forEach(menu => {
                    menu.style.display = 'none';
                });
            }
        });
    }

    setupUsernameClickListeners() {
        document.querySelectorAll('.clickable-username').forEach(usernameEl => {
            usernameEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const userId = usernameEl.getAttribute('data-user-id');
                if (userId) {
                    const url = chrome.runtime.getURL(`src/pages/profile/profile.html?userId=${userId}`);
                    window.location.href = url;
                }
            });
        });
    }

    async editUserRating(ratingId) {
        try {
            const currentUser = firebaseManager.getCurrentUser();
            if (!currentUser) {
                this.showError('Please sign in');
                return;
            }

            // We assume the edit action is for the currently selected movie
            // or we try to find the movie from results if available.
            // Since this is search.js, we prioritize selectedMovie.
            
            if (this.selectedMovie) {
                // Verify this rating belongs to this movie?
                // For simplicity/performance, we just open the rating modal for the selected movie.
                // The modal will fetch the user's existing rating for this movie.
                this.showRatingModal(this.selectedMovie);
            } else {
                // Try to find movie from ratingId? 
                // Getting rating doc is needed to know which movie it is if selectedMovie is null
                const ratingDoc = await firebaseManager.db.collection('ratings').doc(ratingId).get();
                if (!ratingDoc.exists) {
                    this.showError('Rating not found');
                    return;
                }
                const data = ratingDoc.data();
                const movieId = data.movieId;
                
                // Find movie in results
                const movie = this.currentResults.docs.find(m => String(m.kinopoiskId) === String(movieId));
                if (movie) {
                    this.showRatingModal(movie);
                } else {
                    // Fetch movie if not in results?
                    // For now, show error or try to fetch
                     this.showError('Movie data not found. Please try opening the movie details first.');
                }
            }
            
        } catch (error) {
            console.error('Error editing rating:', error);
            this.showError(`Error opening edit modal: ${error.message}`);
        }
    }

    // showEditRatingModal removed - legacy code
    // Old modal logic removed

    async deleteUserRating(ratingId) {
        const confirmed = confirm('Вы уверены, что хотите удалить свой отзыв?');
        
        if (!confirmed) return;
        
        try {
            const ratingService = firebaseManager.getRatingService();
            const currentUser = firebaseManager.getCurrentUser();
            
            if (!currentUser) {
                this.showError('Пожалуйста, войдите в систему');
                return;
            }
            
            await ratingService.deleteRating(currentUser.uid, ratingId);
            
            const ratingCard = document.querySelector(`[data-rating-id="${ratingId}"]`);
            if (ratingCard) {
                ratingCard.style.transition = 'opacity 0.3s, transform 0.3s';
                ratingCard.style.opacity = '0';
                ratingCard.style.transform = 'translateX(-20px)';
                
                setTimeout(() => {
                    ratingCard.remove();
                    
                    if (this.selectedMovie) {
                        this.loadAndDisplayUserRatings(this.selectedMovie.kinopoiskId);
                    }
                }, 300);
            }
            
            this.showSuccess('Отзыв удален');
            
        } catch (error) {
            console.error('Error deleting rating:', error);
            this.showError(`Ошибка при удалении: ${error.message}`);
        }
    }

    toggleFilters() {
        const isVisible = this.elements.filters.style.display !== 'none';
        this.elements.filters.style.display = isVisible ? 'none' : 'grid';
        this.elements.toggleFiltersBtn.textContent = isVisible ? 'Filters' : 'Hide Filters';
    }

    clearFilters() {
        this.elements.yearFromFilter.value = '';
        this.elements.yearToFilter.value = '';
        
        // Reset all genre filters to neutral state
        this.elements.genreCheckboxes.querySelectorAll('.checkbox-item').forEach(item => {
            item.setAttribute('data-filter-state', 'neutral');
            item.classList.remove('filter-include', 'filter-exclude', 'selected');
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (checkbox) checkbox.checked = false;
        });
        
        // Reset all country filters to neutral state
        this.elements.countryCheckboxes.querySelectorAll('.checkbox-item').forEach(item => {
            item.setAttribute('data-filter-state', 'neutral');
            item.classList.remove('filter-include', 'filter-exclude', 'selected');
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (checkbox) checkbox.checked = false;
        });
        
        // Clear saved filter state
        this.clearFilterState();
    }

    applyFilters() {
        // Save filter state to localStorage
        this.saveFilterState();
        
        // Apply filters and perform search
        this.performSearch();
    }

    getSelectedFilters() {
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

    previousPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.searchMovies();
        }
    }

    nextPage() {
        if (this.currentPage < this.currentResults.pages) {
            this.currentPage++;
            this.searchMovies();
        }
    }

    goBack() {
        window.close();
    }

    openSettings() {
        this.showError('Settings feature coming soon!');
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
                const movieGenres = movie.genres || [];
                const hasIncludedGenre = filters.genresInclude.some(genre => 
                    movieGenres.some(mg => mg.toLowerCase() === genre.toLowerCase())
                );
                if (!hasIncludedGenre) return false;
            }
            
            // Genre exclude filter (movie must not have any of these genres)
            if (filters.genresExclude && filters.genresExclude.length > 0) {
                const movieGenres = movie.genres || [];
                const hasExcludedGenre = filters.genresExclude.some(genre => 
                    movieGenres.some(mg => mg.toLowerCase() === genre.toLowerCase())
                );
                if (hasExcludedGenre) return false;
            }
            
            // Country include filter (movie must be from at least one of these countries)
            if (filters.countriesInclude && filters.countriesInclude.length > 0) {
                const movieCountries = movie.countries || [];
                const hasIncludedCountry = filters.countriesInclude.some(country => 
                    movieCountries.some(mc => mc.toLowerCase() === country.toLowerCase())
                );
                if (!hasIncludedCountry) return false;
            }
            
            // Country exclude filter (movie must not be from any of these countries)
            if (filters.countriesExclude && filters.countriesExclude.length > 0) {
                const movieCountries = movie.countries || [];
                const hasExcludedCountry = filters.countriesExclude.some(country => 
                    movieCountries.some(mc => mc.toLowerCase() === country.toLowerCase())
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
            
            // Restore year range
            if (filterState.yearFrom) this.elements.yearFromFilter.value = filterState.yearFrom;
            if (filterState.yearTo) this.elements.yearToFilter.value = filterState.yearTo;
            
            // Restore genre filters
            if (filterState.genres) {
                filterState.genres.forEach(savedFilter => {
                    const item = this.elements.genreCheckboxes.querySelector(`[data-filter-id="${savedFilter.id}"]`);
                    if (item && savedFilter.state) {
                        item.setAttribute('data-filter-state', savedFilter.state);
                        item.classList.remove('filter-include', 'filter-exclude');
                        if (savedFilter.state === 'include') {
                            item.classList.add('filter-include');
                        } else if (savedFilter.state === 'exclude') {
                            item.classList.add('filter-exclude');
                        }
                    }
                });
            }
            
            // Restore country filters
            if (filterState.countries) {
                filterState.countries.forEach(savedFilter => {
                    const item = this.elements.countryCheckboxes.querySelector(`[data-filter-id="${savedFilter.id}"]`);
                    if (item && savedFilter.state) {
                        item.setAttribute('data-filter-state', savedFilter.state);
                        item.classList.remove('filter-include', 'filter-exclude');
                        if (savedFilter.state === 'include') {
                            item.classList.add('filter-include');
                        } else if (savedFilter.state === 'exclude') {
                            item.classList.add('filter-exclude');
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Error loading filter state:', error);
        }
    }

    /**
     * Clear saved filter state from localStorage
     */
    clearFilterState() {
        localStorage.removeItem('movieSearchFilters');
    }

    showLoading(show) {
        this.elements.loading.style.display = show ? 'flex' : 'none';
    }

    showInitialLoading() {
        // Show loading in results area instead of full overlay
        const resultsGrid = this.elements.resultsGrid;
        if (resultsGrid) {
            resultsGrid.classList.add('single-item');
            resultsGrid.innerHTML = `
                <div class="initial-loading-content">
                    <div class="loading-spinner-large"></div>
                    <h3 class="loading-title">Инициализация поиска</h3>
                    <p class="loading-text">Подождите, пока загружается система поиска фильмов...</p>
                </div>
            `;
        }
    }

    hideInitialLoading() {
        // Restore default empty state in results grid
        const resultsGrid = this.elements.resultsGrid;
        if (resultsGrid) {
            resultsGrid.classList.add('single-item');
            resultsGrid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div>
                    <h3 class="empty-state-title">Search for movies</h3>
                    <p class="empty-state-text">Enter a movie title to start searching</p>
                </div>
            `;
        }
    }

    showError(message) {
        // Create or update error message
        let errorDiv = document.querySelector('.error-message');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            document.body.appendChild(errorDiv);
        }
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 5000);
    }

    showSuccess(message) {
        // Create success message
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--success);
            color: white;
            padding: var(--space-md);
            border-radius: var(--radius-md);
            z-index: var(--z-tooltip);
            animation: slideIn 0.3s ease;
        `;
        successDiv.textContent = message;
        document.body.appendChild(successDiv);
        
        setTimeout(() => {
            successDiv.remove();
        }, 3000);
    }

    hideError() {
        const errorDiv = document.querySelector('.error-message');
        if (errorDiv) {
            errorDiv.style.display = 'none';
        }
    }

    escapeHtml(text) {
        return Utils.escapeHtml(text);
    }

    async toggleFavorite(ratingId, currentStatus, buttonElement, movieId) {
        if (!this.currentUser) {
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Войдите в систему, чтобы добавить фильм в Избранное', 'warning');
            }
            return;
        }

        try {
            const favoriteService = firebaseManager.getFavoriteService();
            
            // Check limit before adding
            if (!currentStatus) {
                const limitReached = await favoriteService.isFavoritesLimitReached(this.currentUser.uid, 50);
                if (limitReached) {
                    if (typeof Utils !== 'undefined') {
                        Utils.showToast('Достигнут лимит избранного (50 фильмов)', 'warning');
                    }
                    return;
                }
            }

            // Add animation
            if (buttonElement) {
                buttonElement.classList.add('animating');
                setTimeout(() => {
                    buttonElement.classList.remove('animating');
                }, 600);
            }

            // Toggle favorite
            const newStatus = await favoriteService.toggleFavorite(ratingId, currentStatus);
            
            // Update button state
            if (buttonElement) {
                if (newStatus) {
                    buttonElement.classList.add('active');
                    buttonElement.setAttribute('data-is-favorite', 'true');
                    buttonElement.title = 'Удалить из Избранного';
                } else {
                    buttonElement.classList.remove('active');
                    buttonElement.setAttribute('data-is-favorite', 'false');
                    buttonElement.title = 'Добавить в Избранное';
                }
            }
            
            if (typeof Utils !== 'undefined') {
                if (newStatus) {
                    Utils.showToast('❤️ Добавлено в Избранное', 'success');
                } else {
                    Utils.showToast('Удалено из Избранного', 'success');
                }
            }
            
            // Update navigation count
            if (window.navigation && typeof window.navigation.updateFavoritesCount === 'function') {
                await window.navigation.updateFavoritesCount();
            }
        } catch (error) {
            console.error('Error toggling favorite:', error);
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Ошибка. Попробуйте снова', 'error');
            }
        }
    }

    async toggleWatchlist(movie, buttonElement) {
        if (!this.currentUser) {
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Войдите в систему, чтобы добавить фильм в Watchlist', 'warning');
            }
            return;
        }

        try {
            const watchlistService = firebaseManager.getWatchlistService();
            const isInWatchlist = await watchlistService.isInWatchlist(this.currentUser.uid, movie.kinopoiskId);

            if (isInWatchlist) {
                // Remove from watchlist
                await watchlistService.removeFromWatchlist(this.currentUser.uid, movie.kinopoiskId);
                
                // Update button state (menu item)
                if (buttonElement) {
                    const textSpan = buttonElement.querySelector('.mc-menu-item-text');
                    const iconSpan = buttonElement.querySelector('.mc-menu-item-icon');
                        
                    buttonElement.classList.remove('active');
                    buttonElement.title = 'Add to Watchlist';
                    if (textSpan) textSpan.textContent = 'Add to Watchlist';
                }
                
                if (typeof Utils !== 'undefined') {
                    Utils.showToast('Удалено из Watchlist', 'success');
                }
            } else {
                // Check if movie is already rated
                const ratingService = firebaseManager.getRatingService();
                const existingRating = await ratingService.getRating(this.currentUser.uid, movie.kinopoiskId);
                
                if (existingRating) {
                    if (typeof Utils !== 'undefined') {
                        Utils.showToast('Фильм уже оценен. Watchlist только для неоцененных фильмов', 'info');
                    }
                    // Refresh to show favorite button instead
                    await this.displayResults();
                    return;
                }

                // Add to watchlist
                const movieData = {
                    movieId: movie.kinopoiskId,
                    movieTitle: movie.name || '',
                    movieTitleRu: movie.alternativeName || '',
                    posterPath: movie.posterUrl || '',
                    releaseYear: movie.year || null,
                    genres: movie.genres || [],
                    description: movie.description || '',
                    kpRating: movie.kpRating || 0,
                    imdbRating: movie.imdbRating || 0,
                    avgRating: movie.kpRating || 0
                };
                
                await watchlistService.addToWatchlist(this.currentUser.uid, movieData);
                
                // Update button state (menu item)
                if (buttonElement) {
                    const textSpan = buttonElement.querySelector('.mc-menu-item-text');
                    const iconSpan = buttonElement.querySelector('.mc-menu-item-icon');
                    
                    buttonElement.classList.add('active');
                    buttonElement.title = 'Remove from Watchlist';
                    if (textSpan) textSpan.textContent = 'Remove from Watchlist';
                    // Optional: Change icon if desired
                }
                
                if (typeof Utils !== 'undefined') {
                    Utils.showToast('Добавлено в Watchlist ✓', 'success');
                }
            }

            // Update count in navigation
            if (window.navigation && typeof window.navigation.updateWatchlistCount === 'function') {
                await window.navigation.updateWatchlistCount();
            }
        } catch (error) {
            console.error('Error toggling watchlist:', error);
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Ошибка. Попробуйте снова', 'error');
            }
        }
    }

    async updateButtonStates() {
        if (!this.currentUser) return;

        try {
            const watchlistService = firebaseManager.getWatchlistService();
            const favoriteService = firebaseManager.getFavoriteService();
            
            // Update watchlist buttons (in menu)
            const watchlistButtons = document.querySelectorAll('[data-action="toggle-watchlist"]');
            for (const button of watchlistButtons) {
                const movieId = parseInt(button.getAttribute('data-movie-id'));
                if (movieId) {
                    const isInWatchlist = await watchlistService.isInWatchlist(this.currentUser.uid, movieId);
                    
                    const textSpan = button.querySelector('.mc-menu-item-text');
                    
                    if (isInWatchlist) {
                        button.classList.add('active');
                        button.title = 'Remove from Watchlist';
                        if (textSpan) textSpan.textContent = 'Remove from Watchlist';
                    } else {
                        button.classList.remove('active');
                        button.title = 'Add to Watchlist';
                        if (textSpan) textSpan.textContent = 'Add to Watchlist';
                    }
                }
            }
            
            // Update favorite buttons (in menu)
            // Note: Menu items might be hidden, selecting them all is fine
            const favoriteButtons = document.querySelectorAll('[data-action="toggle-favorite"]');
            for (const button of favoriteButtons) {
                const ratingId = button.getAttribute('data-rating-id');
                if (ratingId) {
                    const isFavorite = await favoriteService.isFavoriteById(ratingId);
                    
                    // Update the menu item text and icon
                    const textSpan = button.querySelector('.mc-menu-item-text');
                    const iconSpan = button.querySelector('.mc-menu-item-icon');
                    
                    if (isFavorite) {
                        button.classList.add('active'); // Optional, logic mainly depends on data attr
                        button.setAttribute('data-is-favorite', 'true');
                        if (textSpan) textSpan.textContent = 'Remove from Favorites';
                        if (iconSpan) iconSpan.textContent = '💔';
                    } else {
                        button.classList.remove('active');
                        button.setAttribute('data-is-favorite', 'false');
                        if (textSpan) textSpan.textContent = 'Add to Favorites';
                        if (iconSpan) iconSpan.textContent = '❤️';
                    }
                }
            }
        } catch (error) {
            console.error('Error updating button states:', error);
        }
    }

    async updateWatchlistButtonStates() {
        await this.updateButtonStates();
    }

    setupImageErrorHandlers() {
        // Handle all images with data-fallback attribute
        document.addEventListener('error', (event) => {
            if (event.target.tagName === 'IMG' && event.target.hasAttribute('data-fallback')) {
                const img = event.target;
                const fallbackType = img.getAttribute('data-fallback');
                
                switch (fallbackType) {
                    case 'poster':
                        // Hide image and show placeholder for movie cards
                        img.style.display = 'none';
                        const placeholder = img.nextElementSibling;
                        if (placeholder && placeholder.classList.contains('movie-poster-placeholder')) {
                            placeholder.style.display = 'flex';
                        }
                        break;
                    
                    case 'detail':
                        // Hide image and show placeholder for detail page
                        img.style.display = 'none';
                        const detailPlaceholder = img.nextElementSibling;
                        if (detailPlaceholder && detailPlaceholder.classList.contains('movie-poster-placeholder')) {
                            detailPlaceholder.style.display = 'flex';
                        }
                        break;
                    
                    case 'modal':
                    case 'rating-modal':
                        // Set fallback icon for modal images
                        img.src = '/icons/icon48.png';
                        break;
                    
                    case 'frame':
                        // Hide broken frame images
                        img.closest('.movie-frame').style.display = 'none';
                        break;
                }
                
                // Remove data-fallback to prevent infinite loop
                img.removeAttribute('data-fallback');
            }
        }, true);
        
        // Handle frame clicks
        document.addEventListener('click', (event) => {
            const frameElement = event.target.closest('.movie-frame');
            if (frameElement) {
                const frameUrl = frameElement.getAttribute('data-frame-url');
                const frameIndex = frameElement.getAttribute('data-frame-index');
                if (frameUrl && frameIndex !== null) {
                    this.showFrameModal(frameUrl, parseInt(frameIndex));
                }
            }
        });
    }
    
    showFrameModal(frameUrl, frameIndex) {
        const movie = this.selectedMovie;
        if (!movie) return;
        
        // Use displayFrames (the ones actually shown in grid) instead of all frames
        const frames = movie.displayFrames || [];
        if (frames.length === 0) return;
        
        let frameModal = document.getElementById('frameModal');
        if (!frameModal) {
            frameModal = document.createElement('div');
            frameModal.id = 'frameModal';
            frameModal.className = 'modal-overlay';
            frameModal.innerHTML = `
                <div class="modal frame-modal">
                    <div class="modal-header">
                        <h2 class="modal-title">Кадр из фильма</h2>
                        <button class="modal-close" id="frameModalClose">×</button>
                    </div>
                    <div class="modal-body frame-modal-body">
                        <button class="frame-modal-nav prev" id="frameNavPrev">‹</button>
                        <img id="frameModalImage" src="" alt="Кадр из фильма" class="frame-modal-image">
                        <button class="frame-modal-nav next" id="frameNavNext">›</button>
                    </div>
                </div>
            `;
            document.body.appendChild(frameModal);
            
            // Add close handler
            frameModal.addEventListener('click', (e) => {
                if (e.target === frameModal || e.target.id === 'frameModalClose') {
                    frameModal.style.display = 'none';
                }
            });
            
            const prevBtn = document.getElementById('frameNavPrev');
            const nextBtn = document.getElementById('frameNavNext');
            
            prevBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentIndex = parseInt(prevBtn.dataset.currentIndex || '0');
                if (currentIndex > 0) {
                    this.showFrameAtIndex(frames, currentIndex - 1);
                }
            });
            
            nextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentIndex = parseInt(nextBtn.dataset.currentIndex || '0');
                if (currentIndex < frames.length - 1) {
                    this.showFrameAtIndex(frames, currentIndex + 1);
                }
            });
            
            document.addEventListener('keydown', (e) => {
                if (frameModal.style.display !== 'none' && frameModal.style.display) {
                    if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        prevBtn.click();
                    } else if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        nextBtn.click();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        frameModal.style.display = 'none';
                    }
                }
            });
        }
        
        this.showFrameAtIndex(frames, frameIndex);
        frameModal.style.display = 'flex';
    }
    
    showFrameAtIndex(frames, index) {
        if (index < 0 || index >= frames.length) return;
        
        const frame = frames[index];
        const frameUrl = frame.url || frame.previewUrl || (frame.poster && frame.poster.url);
        if (!frameUrl) return;
        
        const frameImage = document.getElementById('frameModalImage');
        const prevBtn = document.getElementById('frameNavPrev');
        const nextBtn = document.getElementById('frameNavNext');
        
        frameImage.classList.add('fade-out');
        
        setTimeout(() => {
            frameImage.src = frameUrl;
            frameImage.classList.remove('fade-out');
            frameImage.classList.add('fade-in');
            
            if (prevBtn && nextBtn) {
                prevBtn.dataset.currentIndex = index;
                nextBtn.dataset.currentIndex = index;
                prevBtn.disabled = index === 0;
                nextBtn.disabled = index === frames.length - 1;
            }
        }, 150);
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
                    <div class="history-item-time">${item.timeAgo}</div>
                </div>
                <div class="history-item-actions">
                    <button class="history-item-delete" data-item-id="${item.id}" title="Remove from history">
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
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Check if string contains Cyrillic characters
     * @param {string} str - String to check
     * @returns {boolean} - True if contains Cyrillic
     */
    hasCyrillic(str) {
        return /[а-яё]/i.test(str);
    }

    /**
     * Format large numbers to compact format (1.06m, 582k)
     * @param {number} num - Number to format
     * @returns {string} - Formatted number string
     */
    formatVotes(num) {
        if (!num || num === 0) return '0';
        
        if (num >= 1000000) {
            const millions = num / 1000000;
            // Format to 1 decimal place, remove trailing zeros
            const formatted = millions.toFixed(1);
            return formatted.replace(/\.?0+$/, '') + 'm';
        } else if (num >= 100000) {
            // For numbers >= 100k, show whole thousands only (582k)
            const thousands = Math.round(num / 1000);
            return thousands + 'k';
        } else if (num >= 1000) {
            // For numbers < 100k, show with 1 decimal place (1.5k, 5.8k)
            const thousands = num / 1000;
            const formatted = thousands.toFixed(1);
            return formatted.replace(/\.?0+$/, '') + 'k';
        }
        
        return num.toString();
    }


    async handleWatchClick() {
        if (!this.selectedMovie) return;
        
        // Reset current sources if it's a new movie (unless preloaded)
        if (this.currentSources && this.currentSources._movieId !== this.selectedMovie.kinopoiskId) {
             // If we have preloaded sources for this movie, keep them? 
             // Logic in preloadSources sets currentSources correctly if matches.
             // If mismatch, clear it.
             // Actually, simplest is to let the cache check below handle it.
             // We just need to make sure we don't use stale sources from previous movie.
             // But since we set currentSources = null or cached in logic below, it's safer to just clear it if we are starting fresh?
             // Or rely on logic:
             // We need to attach movieId to currentSources to verify.
        }
        
        try {
            this.showVideoModal(this.selectedMovie);
            
            // Show loading state in player
            this.elements.videoContainer.innerHTML = `
                <div class="video-placeholder">
                    <div class="loading-spinner"></div>
                    <span>Searching for video sources...</span>
                </div>
            `;
            
            
            // Try cache first
            if (this.currentSources && this.currentSources.length > 0) {
                 // Use preloaded sources
                 console.log('Using preloaded sources');
            } else {
                const cached = this.getCachedSources(this.selectedMovie.kinopoiskId);
                if (cached) {
                    console.log('Using cached sources');
                    this.currentSources = cached;
                } else {
                    // Search for movie on ex-fs.net
                    const searchResult = await this.streamingService.search(
                        this.selectedMovie.name, 
                        this.selectedMovie.year
                    );
                    
                    if (!searchResult) {
                        this.elements.videoContainer.innerHTML = `
                            <div class="video-placeholder">
                                <span>Movie not found on streaming service.</span>
                            </div>
                        `;
                        return;
                    }
                    
                    // Get video sources
                    const sources = await this.streamingService.getVideoSources(searchResult.url);
                    
                    if (sources.length === 0) {
                        this.elements.videoContainer.innerHTML = `
                            <div class="video-placeholder">
                                <span>No video sources found.</span>
                            </div>
                        `;
                        return;
                    }

                    this.currentSources = sources;
                    this.saveSourcesToCache(this.selectedMovie.kinopoiskId, sources);
                }
            }
            
            // Create sources map for easy access
            const sources = this.currentSources;

        // Populate source selector
        sources.forEach((source, index) => {
            const option = document.createElement('option');
            option.value = source.url;
            option.textContent = source.name || `Source ${index + 1}`;
            this.elements.sourceSelect.appendChild(option);
        });

        // Select source (restore last used or default to first)
        if (sources.length > 0) {
            // Check for saved preference
            let targetSource = sources[0].url; // Default
            const lastSource = this.getLastSource(this.selectedMovie.kinopoiskId);
            
            if (lastSource) {
                // Verify the saved source still exists in current list
                const exists = sources.find(s => s.url === lastSource);
                if (exists) targetSource = lastSource;
            }

            this.elements.sourceSelect.value = targetSource;
            this.changeVideoSource(targetSource); // Will save as last source too
            this.togglePlayPause(); // Start playing immediately
        }

        // Setup message listener for iframe communication
        if (!this.messageListenerSetup) {
            window.addEventListener('message', (event) => {
                // Verify origin if possible, but we accept from our iframes
                
                if (event.data.type === 'PLAYER_READY') {
                    // Send sources to iframe
                    const iframe = this.elements.videoContainer.querySelector('iframe');
                    if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.postMessage({
                            type: 'SET_SOURCES',
                            sources: this.currentSources, // Send full objects with names
                            currentUrl: this.currentVideoUrl
                        }, '*');
                    }
                } else if (event.data.type === 'CHANGE_SOURCE') {
                    const newUrl = event.data.url;
                    if (newUrl && newUrl !== this.currentVideoUrl) {
                        this.elements.sourceSelect.value = newUrl;
                        this.changeVideoSource(newUrl);
                        // Auto-play the new source
                        this.togglePlayPause(); 
                    }
                }
            });
            this.messageListenerSetup = true;
        }
            
        } catch (error) {
            console.error('Error in handleWatchClick:', error);
            this.elements.videoContainer.innerHTML = `
                <div class="video-placeholder">
                    <span>Error loading video: ${error.message}</span>
                </div>
            `;
        }
    }

    showVideoModal(movie) {
        this.elements.videoTitle.textContent = `Watching: ${movie.name}`;
        this.elements.videoPlayerModal.style.display = 'flex';
    }

    closeVideoModal() {
        this.elements.videoPlayerModal.style.display = 'none';
        // Stop video and reset state
        this.isPlaying = false;
        this.currentVideoUrl = '';
        this.elements.videoContainer.innerHTML = '';
        if (this.currentHls) {
            this.currentHls.destroy();
            this.currentHls = null;
        }
    }

    changeVideoSource(url) {
        if (!url) return;
        
        this.currentVideoUrl = url;
        // Don't render simple player, just update state. 
        // Actual playback is triggered by togglePlayPause call.
        this.isPlaying = false; 
        
        // Save as last selected source
        if (this.selectedMovie) {
            this.saveLastSource(this.selectedMovie.kinopoiskId, url);
        }
    }

    getLastSource(movieId) {
        try {
            return localStorage.getItem(`last_source_${movieId}`);
        } catch (e) { return null; }
    }

    saveLastSource(movieId, url) {
        try {
            localStorage.setItem(`last_source_${movieId}`, url);
        } catch (e) { }
    }

    renderSimplePlayer() {
        const posterUrl = this.selectedMovie?.posterUrl || this.selectedMovie?.images?.[0]?.url || '';
        
        // Update container with simple player UI
        this.elements.videoContainer.innerHTML = `
            <div class="simple-player-container">
                <div class="simple-player-overlay" style="background-image: url('${posterUrl}')">
                    <button class="play-pause-btn" id="mainPlayBtn" aria-label="Play">
                        <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    </button>
                </div>
            </div>
        `;

        // Update control panel button
        this.updateControlPanel();

        // Add event listener to main play button
        const mainPlayBtn = document.getElementById('mainPlayBtn');
        if (mainPlayBtn) {
            mainPlayBtn.addEventListener('click', () => this.togglePlayPause());
        }
    }

    togglePlayPause() {
        this.isPlaying = !this.isPlaying;
        
        if (this.isPlaying) {
            // Check source type
            // We need to know the type associated with the currentVideoUrl.
            // Since we stored only the URL string, we might lose the type.
            // But we can re-find it from the source options or store it better.
            
            // To be safe, we check if the URL ends with .mp4 or .m3u8, 
            // OR we store the current source object instead of just the URL.
            
            const isMp4 = this.currentVideoUrl.includes('.mp4');
            const isHls = this.currentVideoUrl.includes('.m3u8');
            
            if (isMp4 || isHls) {
                // Native Player
                this.elements.videoContainer.innerHTML = `
                    <video id="nativeVideoPlayer" controls autoplay style="width:100%; height:100%; outline:none;" ${isHls && !this.currentVideoUrl.includes('.m3u8') ? '' : ''}>
                        <source src="${this.currentVideoUrl}" type="${isHls ? 'application/x-mpegURL' : 'video/mp4'}">
                        Your browser does not support the video tag.
                    </video>
                `;
                
                const videoElement = document.getElementById('nativeVideoPlayer');
                
                // If HLS and not natively supported (like on Chrome Desktop typically), use Hls.js
                // Assuming Hls.js is loaded globally or available
                if (isHls) {
                    if (Hls.isSupported()) {
                        const hls = new Hls();
                        hls.loadSource(this.currentVideoUrl);
                        hls.attachMedia(videoElement);
                        hls.on(Hls.Events.MANIFEST_PARSED, function() {
                            videoElement.play().catch(e => console.log('Autoplay blocked:', e));
                        });
                        this.currentHls = hls; // Store to destroy later
                    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
                        // Safari
                        videoElement.play().catch(e => console.log('Autoplay blocked:', e));
                    }
                }
            } else {
                // Iframe Fallback
                let url = this.currentVideoUrl;
                try {
                    const urlObj = new URL(url);
                    urlObj.searchParams.set('autoplay', '1');
                    urlObj.searchParams.set('mute', '0'); 
                    url = urlObj.toString();
                } catch (e) {
                    if (url.includes('?')) {
                        url += '&autoplay=1';
                    } else {
                        url += '?autoplay=1';
                    }
                }

                this.elements.videoContainer.innerHTML = `
                    <iframe src="${url}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture" style="width:100%; height:100%; border:none;"></iframe>
                `;
            }
        } else {
            // Pause: Show simple player (which unloads iframe/video)
            if (this.currentHls) {
                this.currentHls.destroy();
                this.currentHls = null;
            }
            this.renderSimplePlayer();
        }
        

    }



}

// Add event listeners for movie cards
document.addEventListener('click', (e) => {
    if (e.target.closest('.movie-card')) {
        const movieCard = e.target.closest('.movie-card');
        const movieId = movieCard.dataset.movieId;
        const movie = searchManager.currentResults.docs.find(m => m.kinopoiskId == movieId);
        if (movie) {
            searchManager.showMovieModal(movie);
        }
    }
    
    if (e.target.classList.contains('movie-detail-btn')) {
        e.stopPropagation();
        const movieId = e.target.dataset.movieId;
        
        // Navigate to movie detail page with movieId parameter
        window.location.href = chrome.runtime.getURL(`src/pages/search/search.html?movieId=${movieId}`);
    }
    
    if (e.target.classList.contains('rate-movie-btn')) {
        e.stopPropagation();
        const movieId = e.target.dataset.movieId;
        
        // Try to find movie in search results first
        let movie = searchManager.currentResults.docs?.find(m => m.kinopoiskId == movieId);
        
        // If not found in search results, check if it's the selected movie (detail page)
        if (!movie && searchManager.selectedMovie && searchManager.selectedMovie.kinopoiskId == movieId) {
            movie = searchManager.selectedMovie;
        }
        
        if (movie) {
            searchManager.showRatingModal(movie);
        }
    }

    if (e.target.classList.contains('watch-movie-btn') || e.target.closest('.watch-movie-btn')) {
        e.stopPropagation();
        const btn = e.target.classList.contains('watch-movie-btn') ? e.target : e.target.closest('.watch-movie-btn');
        const movieId = btn.dataset.movieId;
        
        // Try to find movie in search results first
        let movie = searchManager.currentResults.docs?.find(m => m.kinopoiskId == movieId);
        
        // If not found in search results, check if it's the selected movie (detail page)
        if (!movie && searchManager.selectedMovie && searchManager.selectedMovie.kinopoiskId == movieId) {
            movie = searchManager.selectedMovie;
        }
        
        if (movie) {
            // Set selected movie if not already set (important for handleWatchClick)
            searchManager.selectedMovie = movie;
            searchManager.handleWatchClick();
        }
    }
    
    if (e.target.classList.contains('watchlist-btn-card')) {
        e.stopPropagation();
        const movieId = e.target.dataset.movieId;
        
        // Try to find movie in search results first
        let movie = searchManager.currentResults.docs?.find(m => m.kinopoiskId == movieId);
        
        // If not found in search results, check if it's the selected movie (detail page)
        if (!movie && searchManager.selectedMovie && searchManager.selectedMovie.kinopoiskId == movieId) {
            movie = searchManager.selectedMovie;
        }
        
        if (movie) {
            searchManager.toggleWatchlist(movie, e.target);
        }
    }
    
    if (e.target.classList.contains('favorite-btn-card')) {
        e.stopPropagation();
        const ratingId = e.target.getAttribute('data-rating-id');
        const isFavorite = e.target.getAttribute('data-is-favorite') === 'true';
        const movieId = e.target.getAttribute('data-movie-id');
        
        if (ratingId) {
            searchManager.toggleFavorite(ratingId, isFavorite, e.target, movieId);
        }
    }
});

// Initialize search manager when DOM is loaded
let searchManager;
document.addEventListener('DOMContentLoaded', () => {
    searchManager = new SearchManager();
});

// Alias for router compatibility
window.SearchPageManager = SearchManager;
