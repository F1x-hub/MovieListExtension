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
        this.searchHistoryService = new SearchHistoryService();
        this.streamingService = new StreamingService();
        this.isHistoryDropdownOpen = false;
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
            movieRatingInfo: document.getElementById('movieRatingInfo'),
            ratingForm: document.getElementById('ratingForm'),
            ratingSlider: document.getElementById('ratingSlider'),
            ratingValue: document.getElementById('ratingValue'),
            ratingComment: document.getElementById('ratingComment'),
            charCount: document.getElementById('charCount'),
            currentRatingInfo: document.getElementById('currentRatingInfo'),
            existingRatingValue: document.getElementById('existingRatingValue'),
            existingRatingComment: document.getElementById('existingRatingComment'),
            saveRatingBtn: document.getElementById('saveRatingBtn'),
            cancelRatingBtn: document.getElementById('cancelRatingBtn'),
            saveRatingBtn: document.getElementById('saveRatingBtn'),
            cancelRatingBtn: document.getElementById('cancelRatingBtn'),
            ratingModalClose: document.getElementById('ratingModalClose'),

            // Video Player Modal
            videoPlayerModal: document.getElementById('videoPlayerModal'),
            videoTitle: document.getElementById('videoTitle'),
            videoContainer: document.getElementById('videoContainer'),
            closeVideoBtn: document.getElementById('closeVideoBtn'),
            sourceSelect: document.getElementById('sourceSelect'),
            refreshPlayerBtn: document.getElementById('refreshPlayerBtn')
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
        
        // Rating
        if (this.elements.ratingSlider && this.elements.ratingValue) {
            this.elements.ratingSlider.addEventListener('input', (e) => {
                this.elements.ratingValue.textContent = e.target.value;
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
        if (this.elements.refreshPlayerBtn) {
            this.elements.refreshPlayerBtn.addEventListener('click', () => this.refreshPlayer());
        }
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
        const query = urlParams.get('query');
        
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
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = id;
        checkbox.value = value;
        
        const labelEl = document.createElement('label');
        labelEl.htmlFor = id;
        labelEl.textContent = label;
        
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
        
        item.appendChild(checkbox);
        item.appendChild(labelEl);
        
        // Make the whole item clickable
        item.addEventListener('click', (e) => {
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            }
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
            
            // Search movies
            const searchResults = await kinopoiskService.searchMovies(
                this.currentQuery,
                this.currentPage,
                20
            );
            
            // Note: Movies are no longer cached here to save database quota
            // They will be cached only when users rate them
            
            this.currentResults = searchResults;
            
            if (searchResults && searchResults.docs) {
                this.displayResults();
            } else {
                this.currentResults = { docs: [], total: 0, pages: 0 };
                this.displayResults();
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
                    <div class="empty-state-icon">🔍</div>
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
                
                for (const movieId of movieIds) {
                    try {
                        const rating = await ratingService.getRating(this.currentUser.uid, movieId);
                        if (rating) {
                            userRatingsMap[movieId] = rating;
                        }
                    } catch (error) {
                        console.warn(`Failed to load rating for movie ${movieId}:`, error);
                    }
                }
            } catch (error) {
                console.error('Error loading user ratings:', error);
            }
        }
        
        // Display movie cards with user ratings
        this.elements.resultsGrid.innerHTML = this.currentResults.docs.map(movie => {
            const userRating = userRatingsMap[movie.kinopoiskId] || null;
            return this.createMovieCard(movie, userRating);
        }).join('');
        
        // Update button states
        if (this.currentUser) {
            await this.updateButtonStates();
        }
        
        // Show pagination
        this.elements.pagination.style.display = 'flex';
        this.elements.pageInfo.textContent = `Страница ${this.currentPage} из ${this.currentResults.pages}`;
        this.elements.prevPageBtn.disabled = this.currentPage <= 1;
        this.elements.nextPageBtn.disabled = this.currentPage >= this.currentResults.pages;
    }

    createMovieCard(movie, userRating = null) {
        const posterUrl = movie.posterUrl || '';
        const year = movie.year || '';
        const genres = movie.genres?.slice(0, 3).join(', ') || '';
        const kpRating = movie.kpRating || 0;
        const imdbRating = movie.imdbRating || 0;
        const description = movie.description || '';
        const votes = movie.votes?.kp || 0;
        const imdbVotes = movie.votes?.imdb || 0;
        
        const isRated = !!userRating;
        const isFavorite = userRating?.isFavorite === true;
        const ratingId = userRating?.id || null;
        
        return `
            <div class="movie-card" data-movie-id="${movie.kinopoiskId}">
                <div class="movie-poster-container">
                    <img src="${posterUrl}" alt="${movie.name}" class="movie-poster" data-fallback="poster">
                    <div class="movie-poster-placeholder" style="display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(135deg, var(--accent-color) 0%, var(--accent-hover) 100%); align-items: center; justify-content: center; color: var(--text-primary); font-size: var(--font-size-2xl); opacity: 0.7;">🎬</div>
                    <div class="movie-overlay">
                        <div class="movie-rating-badge">${kpRating.toFixed(1)}</div>
                    </div>
                    ${isRated && ratingId ? `
                        <button class="favorite-btn-card ${isFavorite ? 'active' : ''}" data-rating-id="${ratingId}" data-is-favorite="${isFavorite}" data-movie-id="${movie.kinopoiskId}" title="${isFavorite ? 'Удалить из Избранного' : 'Добавить в Избранное'}">
                        </button>
                    ` : `
                        <button class="watchlist-btn-card" data-movie-id="${movie.kinopoiskId}" title="Добавить в Watchlist">
                            🔖
                        </button>
                    `}
                </div>
                <div class="movie-info">
                    <h3 class="movie-title">${this.escapeHtml(movie.name)}</h3>
                    <p class="movie-meta">${year} • ${genres}</p>
                    <div class="movie-ratings">
                        <span class="rating-badge kp">KP: ${kpRating.toFixed(1)}</span>
                        <span class="rating-badge imdb">IMDb: ${imdbRating.toFixed(1)}</span>
                        ${votes > 0 ? `<span class="rating-badge votes">${this.formatVotes(votes)} оценок</span>` : ''}
                        ${imdbVotes > 0 ? `<span class="rating-badge votes">${this.formatVotes(imdbVotes)} оценок</span>` : ''}
                    </div>
                    <p class="movie-description">${this.escapeHtml(description)}</p>
                </div>
                <div class="movie-actions">
                    <button class="btn btn-ghost btn-sm movie-detail-btn" data-movie-id="${movie.kinopoiskId}">Movie Detail</button>
                    <button class="btn btn-accent btn-sm rate-movie-btn" data-movie-id="${movie.kinopoiskId}">Rate Movie</button>
                </div>
            </div>
        `;
    }

    async loadMovieById(movieId, showLoading = true) {
        try {
            if (showLoading) {
                this.showLoading(true);
            }
            
            const kinopoiskService = firebaseManager.getKinopoiskService();
            const movie = await kinopoiskService.getMovieById(movieId);
            
            // Try to get movie images/frames
            try {
                const images = await kinopoiskService.getMovieImages(movieId);
                if (images && images.length > 0) {
                    movie.frames = images;
                }
            } catch (imagesError) {
                // Silently handle image loading errors
            }
            
            this.displaySingleMovieResult(movie);
            
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
                            <div class="user-rating-score">⭐ ${rating.rating}/10</div>
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
        
        return `
            <div class="movie-detail-page">
                <div class="movie-detail-header">
                    <div class="movie-detail-poster-container">
                        <img src="${posterUrl}" alt="${movie.name}" class="movie-detail-page-poster" data-fallback="detail">
                        <div class="movie-poster-placeholder" style="display: none;">🎬</div>
                        ${isRated && ratingId ? `
                            <button class="favorite-btn-card ${isFavorite ? 'active' : ''}" data-rating-id="${ratingId}" data-is-favorite="${isFavorite}" data-movie-id="${movie.kinopoiskId}" title="${isFavorite ? 'Удалить из Избранного' : 'Добавить в Избранное'}">
                            </button>
                        ` : `
                            <button class="watchlist-btn-card watchlist-btn-detail" data-movie-id="${movie.kinopoiskId}" title="Добавить в Watchlist">
                                🔖
                            </button>
                        `}
                    </div>
                    <div class="movie-detail-info-container">
                        <h1 class="movie-detail-page-title">${this.escapeHtml(movie.name)}</h1>
                        ${movie.alternativeName ? `<h2 class="movie-detail-alt-title">${this.escapeHtml(movie.alternativeName)}</h2>` : ''}
                        
                        <div class="movie-detail-meta-grid">
                            <div class="meta-item">
                                <span class="meta-label">Год:</span>
                                <span class="meta-value">${year}</span>
                            </div>
                            ${duration ? `
                            <div class="meta-item">
                                <span class="meta-label">Длительность:</span>
                                <span class="meta-value">${duration} мин</span>
                            </div>` : ''}
                            <div class="meta-item">
                                <span class="meta-label">Жанры:</span>
                                <span class="meta-value">${genres}</span>
                            </div>
                            ${countries ? `
                            <div class="meta-item">
                                <span class="meta-label">Страны:</span>
                                <span class="meta-value">${countries}</span>
                            </div>` : ''}
                        </div>
                        
                        <div class="movie-detail-ratings-container">
                            <div class="rating-item-large kp">
                                <span class="rating-label">Кинопоиск</span>
                                <span class="rating-value">${kpRating.toFixed(1)}</span>
                                ${votes > 0 ? `<span class="rating-votes">${this.formatVotes(votes)} оценок</span>` : ''}
                            </div>
                            ${imdbRating > 0 ? `
                            <div class="rating-item-large imdb">
                                <span class="rating-label">IMDb</span>
                                <span class="rating-value">${imdbRating.toFixed(1)}</span>
                                ${imdbVotes > 0 ? `<span class="rating-votes">${this.formatVotes(imdbVotes)} оценок</span>` : '<span class="rating-votes">&nbsp;</span>'}
                            </div>` : ''}
                        </div>
                        
                        <div class="movie-actions-container">
                            <button class="btn btn-primary btn-lg watch-movie-btn" data-movie-id="${movie.kinopoiskId}">
                                <span class="btn-icon">▶️</span>
                                Смотреть
                            </button>
                            <button class="btn btn-accent btn-lg rate-movie-btn" data-movie-id="${movie.kinopoiskId}">
                                <span class="btn-icon">⭐</span>
                                Оценить фильм
                            </button>
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
                            <span class="rating-badge kp">Kinopoisk: ${kpRating.toFixed(1)}</span>
                            <span class="rating-badge imdb">IMDb: ${imdbRating.toFixed(1)}</span>
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
        
        // Show movie info in rating modal
        this.elements.movieRatingInfo.innerHTML = `
            <div class="movie-detail">
                <img src="${movie.posterUrl || '/icons/icon48.png'}" alt="${movie.name}" class="movie-detail-poster" data-fallback="rating-modal">
                <div class="movie-detail-info">
                    <h3 class="movie-detail-title">${this.escapeHtml(movie.name)}</h3>
                    <p class="movie-detail-meta">${movie.year} • ${movie.genres?.slice(0, 3).join(', ')}</p>
                    <div class="movie-detail-ratings">
                        <span class="rating-badge kp">КП: ${movie.kpRating?.toFixed(1) || 'N/A'}</span>
                        ${movie.imdbRating ? `<span class="rating-badge imdb">IMDb: ${movie.imdbRating.toFixed(1)}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
        
        // Check if user already rated this movie
        const ratingService = firebaseManager.getRatingService();
        const existingRating = await ratingService.getRating(currentUser.uid, movie.kinopoiskId);
        
        if (existingRating) {
            this.elements.currentRatingInfo.style.display = 'block';
            this.elements.existingRatingValue.textContent = `${existingRating.rating}/10`;
            this.elements.existingRatingComment.textContent = existingRating.comment || 'No comment';
            this.elements.ratingSlider.value = existingRating.rating;
            this.elements.ratingValue.textContent = existingRating.rating;
            this.elements.ratingComment.value = existingRating.comment || '';
            this.elements.charCount.textContent = (existingRating.comment || '').length;
        } else {
            this.elements.currentRatingInfo.style.display = 'none';
            this.elements.ratingSlider.value = 5;
            this.elements.ratingValue.textContent = '5';
            this.elements.ratingComment.value = '';
            this.elements.charCount.textContent = '0';
        }
        
        this.elements.ratingModal.style.display = 'flex';
    }

    closeRatingModal() {
        this.elements.ratingModal.style.display = 'none';
        // Do not clear selectedMovie here, as the parent movie modal might still be open
        // and relying on it. selectedMovie is cleared when the main movie modal is closed.
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
            
            const rating = parseInt(this.elements.ratingSlider.value);
            const comment = this.elements.ratingComment.value.trim();
            
            if (rating < 1 || rating > 10) {
                this.showError('Rating must be between 1 and 10');
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
            const ratingService = firebaseManager.getRatingService();
            const currentUser = firebaseManager.getCurrentUser();
            
            if (!currentUser) {
                this.showError('Пожалуйста, войдите в систему');
                return;
            }
            
            const ratingDoc = await firebaseManager.db.collection('ratings').doc(ratingId).get();
            if (!ratingDoc.exists) {
                this.showError('Отзыв не найден');
                return;
            }
            
            const ratingData = ratingDoc.data();
            this.showEditRatingModal(ratingId, ratingData);
            
        } catch (error) {
            console.error('Error editing rating:', error);
            this.showError(`Ошибка при редактировании: ${error.message}`);
        }
    }

    showEditRatingModal(ratingId, ratingData) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'editRatingModal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        modal.innerHTML = `
            <div style="
                background: #0f172a;
                padding: 24px;
                border-radius: 12px;
                max-width: 500px;
                width: 90%;
                color: #e2e8f0;
            ">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px;">
                    <h3 style="margin:0; font-size:20px;">Редактировать отзыв</h3>
                    <button id="closeEditModal" style="background:#334155; color:#e2e8f0; border:none; padding:8px 12px; border-radius:8px; cursor:pointer;">✕</button>
                </div>
                
                <form id="editRatingForm">
                    <div style="margin-bottom:16px;">
                        <label style="display:block; margin-bottom:8px; color:#94a3b8;">Оценка: <span id="editRatingValue">${ratingData.rating}</span>/10</label>
                        <input type="range" id="editRatingSlider" min="1" max="10" value="${ratingData.rating}" style="width:100%;">
                    </div>
                    
                    <div style="margin-bottom:16px;">
                        <label style="display:block; margin-bottom:8px; color:#94a3b8;">Комментарий:</label>
                        <textarea id="editRatingComment" rows="4" maxlength="500" style="width:100%; padding:10px 12px; border-radius:8px; border:1px solid #334155; background:#0b1220; color:#e2e8f0; resize:vertical;">${this.escapeHtml(ratingData.comment || '')}</textarea>
                        <div style="text-align:right; margin-top:4px; font-size:12px; color:#94a3b8;">
                            <span id="editCommentCount">${(ratingData.comment || '').length}</span>/500
                        </div>
                    </div>
                    
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button type="button" id="cancelEditBtn" style="background:#334155; color:#e2e8f0; border:none; padding:10px 16px; border-radius:8px; cursor:pointer;">Отмена</button>
                        <button type="submit" id="saveEditBtn" style="background:#22c55e; color:#062e0f; border:none; padding:10px 16px; border-radius:8px; cursor:pointer; font-weight:600;">Сохранить</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const slider = modal.querySelector('#editRatingSlider');
        const valueDisplay = modal.querySelector('#editRatingValue');
        const comment = modal.querySelector('#editRatingComment');
        const commentCount = modal.querySelector('#editCommentCount');
        
        slider.addEventListener('input', (e) => {
            valueDisplay.textContent = e.target.value;
        });
        
        comment.addEventListener('input', (e) => {
            commentCount.textContent = e.target.value.length;
        });
        
        const closeModal = () => modal.remove();
        
        modal.querySelector('#closeEditModal').addEventListener('click', closeModal);
        modal.querySelector('#cancelEditBtn').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        
        modal.querySelector('#editRatingForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const newRating = parseInt(slider.value);
            const newComment = comment.value.trim();
            
            try {
                const ratingService = firebaseManager.getRatingService();
                const currentUser = firebaseManager.getCurrentUser();
                const userService = firebaseManager.getUserService();
                
                const userProfile = await userService.getUserProfile(currentUser.uid);
                
                // Get display name based on user preference
                const displayName = typeof Utils !== 'undefined' && Utils.getDisplayName
                    ? Utils.getDisplayName(userProfile, currentUser)
                    : (userProfile?.displayName || currentUser.displayName || currentUser.email);
                
                await ratingService.addOrUpdateRating(
                    currentUser.uid,
                    displayName,
                    userProfile?.photoURL || currentUser.photoURL || '',
                    ratingData.movieId,
                    newRating,
                    newComment
                );
                
                closeModal();
                this.showSuccess('Отзыв обновлен!');
                
                if (this.selectedMovie) {
                    await this.loadAndDisplayUserRatings(this.selectedMovie.kinopoiskId);
                }
                
            } catch (error) {
                console.error('Error updating rating:', error);
                this.showError(`Ошибка при сохранении: ${error.message}`);
            }
        });
    }

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
        
        // Uncheck all genre checkboxes
        this.elements.genreCheckboxes.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = false;
            checkbox.closest('.checkbox-item').classList.remove('selected');
        });
        
        // Uncheck all country checkboxes
        this.elements.countryCheckboxes.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = false;
            checkbox.closest('.checkbox-item').classList.remove('selected');
        });
    }

    applyFilters() {
        // Apply filters and perform search
        this.performSearch();
    }

    getSelectedFilters() {
        const filters = {
            yearFrom: this.elements.yearFromFilter.value ? parseInt(this.elements.yearFromFilter.value) : null,
            yearTo: this.elements.yearToFilter.value ? parseInt(this.elements.yearToFilter.value) : null,
            genres: [],
            countries: []
        };
        
        // Get selected genres
        this.elements.genreCheckboxes.querySelectorAll('input[type="checkbox"]:checked').forEach(checkbox => {
            filters.genres.push(checkbox.value);
        });
        
        // Get selected countries
        this.elements.countryCheckboxes.querySelectorAll('input[type="checkbox"]:checked').forEach(checkbox => {
            filters.countries.push(checkbox.value);
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
                    <div class="empty-state-icon">🔍</div>
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
                
                // Update button state
                if (buttonElement) {
                    buttonElement.classList.remove('active');
                    buttonElement.title = 'Добавить в Watchlist';
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
                    avgRating: movie.kpRating || 0
                };
                
                await watchlistService.addToWatchlist(this.currentUser.uid, movieData);
                
                // Update button state
                if (buttonElement) {
                    buttonElement.classList.add('active');
                    buttonElement.title = 'Удалить из Watchlist';
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
            
            // Update watchlist buttons
            const watchlistButtons = document.querySelectorAll('.watchlist-btn-card');
            for (const button of watchlistButtons) {
                const movieId = parseInt(button.getAttribute('data-movie-id'));
                if (movieId) {
                    const isInWatchlist = await watchlistService.isInWatchlist(this.currentUser.uid, movieId);
                    
                    if (isInWatchlist) {
                        button.classList.add('active');
                        button.title = 'Удалить из Watchlist';
                    } else {
                        button.classList.remove('active');
                        button.title = 'Добавить в Watchlist';
                    }
                }
            }
            
            // Update favorite buttons
            const favoriteButtons = document.querySelectorAll('.favorite-btn-card');
            for (const button of favoriteButtons) {
                const ratingId = button.getAttribute('data-rating-id');
                if (ratingId) {
                    const isFavorite = await favoriteService.isFavoriteById(ratingId);
                    
                    if (isFavorite) {
                        button.classList.add('active');
                        button.setAttribute('data-is-favorite', 'true');
                        button.title = 'Удалить из Избранного';
                    } else {
                        button.classList.remove('active');
                        button.setAttribute('data-is-favorite', 'false');
                        button.title = 'Добавить в Избранное';
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
            // Format to 2 decimal places, remove trailing zeros
            const formatted = millions.toFixed(2);
            return formatted.replace(/\.?0+$/, '') + 'm';
        } else if (num >= 100000) {
            // For numbers >= 100k, show whole thousands only (582k)
            const thousands = Math.round(num / 1000);
            return thousands + 'k';
        } else if (num >= 1000) {
            // For numbers < 100k, show with 2 decimal places (1.5k, 5.82k)
            const thousands = num / 1000;
            const formatted = thousands.toFixed(2);
            return formatted.replace(/\.?0+$/, '') + 'k';
        }
        
        return num.toString();
    }


    async handleWatchClick() {
        if (!this.selectedMovie) return;
        
        try {
            this.showVideoModal(this.selectedMovie);
            
            // Show loading state in player
            this.elements.videoContainer.innerHTML = `
                <div class="video-placeholder">
                    <div class="loading-spinner"></div>
                    <span>Searching for video sources...</span>
                </div>
            `;
            
            // Clear previous sources
            this.elements.sourceSelect.innerHTML = '<option value="" disabled selected>Select a source</option>';
            
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
            
            // Populate source selector
            sources.forEach((source, index) => {
                const option = document.createElement('option');
                option.value = source.url;
                option.textContent = source.name || `Source ${index + 1}`;
                this.elements.sourceSelect.appendChild(option);
            });
            
            // Select first source automatically
            if (sources.length > 0) {
                this.elements.sourceSelect.value = sources[0].url;
                this.changeVideoSource(sources[0].url);
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
        // Stop video by clearing iframe
        this.elements.videoContainer.innerHTML = '';
    }

    changeVideoSource(url) {
        if (!url) return;
        
        this.elements.videoContainer.innerHTML = `
            <iframe src="${url}" allowfullscreen allow="autoplay; encrypted-media"></iframe>
        `;
    }

    refreshPlayer() {
        const currentUrl = this.elements.sourceSelect.value;
        if (currentUrl) {
            this.changeVideoSource(currentUrl);
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
