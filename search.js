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
            ratingModalClose: document.getElementById('ratingModalClose')
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
                    window.location.href = `search.html?movieId=${this.selectedMovie.kinopoiskId}`;
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

    displayResults() {
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
        
        // Display movie cards
        this.elements.resultsGrid.innerHTML = this.currentResults.docs.map(movie => this.createMovieCard(movie)).join('');
        
        // Show pagination
        this.elements.pagination.style.display = 'flex';
        this.elements.pageInfo.textContent = `Страница ${this.currentPage} из ${this.currentResults.pages}`;
        this.elements.prevPageBtn.disabled = this.currentPage <= 1;
        this.elements.nextPageBtn.disabled = this.currentPage >= this.currentResults.pages;
    }

    createMovieCard(movie) {
        const posterUrl = movie.posterUrl || '';
        const year = movie.year || '';
        const genres = movie.genres?.slice(0, 3).join(', ') || '';
        const kpRating = movie.kpRating || 0;
        const imdbRating = movie.imdbRating || 0;
        const description = movie.description || '';
        const votes = movie.votes?.kp || 0;
        const imdbVotes = movie.votes?.imdb || 0;
        
        return `
            <div class="movie-card" data-movie-id="${movie.kinopoiskId}">
                <div class="movie-poster-container">
                    <img src="${posterUrl}" alt="${movie.name}" class="movie-poster" data-fallback="poster">
                    <div class="movie-poster-placeholder" style="display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(135deg, var(--accent-color) 0%, var(--accent-hover) 100%); align-items: center; justify-content: center; color: var(--text-primary); font-size: var(--font-size-2xl); opacity: 0.7;">🎬</div>
                    <div class="movie-overlay">
                        <div class="movie-rating-badge">${kpRating.toFixed(1)}</div>
                    </div>
                </div>
                <div class="movie-info">
                    <h3 class="movie-title">${this.escapeHtml(movie.name)}</h3>
                    <p class="movie-meta">${year} • ${genres}</p>
                    <div class="movie-ratings">
                        <span class="rating-badge kp">KP: ${kpRating.toFixed(1)}</span>
                        <span class="rating-badge imdb">IMDb: ${imdbRating.toFixed(1)}</span>
                        ${votes > 0 ? `<span class="rating-badge votes">${votes} оценок</span>` : ''}
                        ${imdbVotes > 0 ? `<span class="rating-badge votes">${imdbVotes} оценок</span>` : ''}
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

    displaySingleMovieResult(movie) {
        // Show results header for single movie
        this.elements.resultsHeader.style.display = 'flex';
        this.elements.resultsInfo.textContent = `Информация о фильме`;
        
        // Create detailed movie card for single movie view
        const movieHTML = this.createDetailedMovieCard(movie);
        
        // Remove single-item class for movie display
        this.elements.resultsGrid.classList.remove('single-item');
        this.elements.resultsGrid.innerHTML = movieHTML;
        
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

    createDetailedMovieCard(movie) {
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
        
        return `
            <div class="movie-detail-page">
                <div class="movie-detail-header">
                    <div class="movie-detail-poster-container">
                        <img src="${posterUrl}" alt="${movie.name}" class="movie-detail-page-poster" data-fallback="detail">
                        <div class="movie-poster-placeholder" style="display: none;">🎬</div>
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
                                ${votes > 0 ? `<span class="rating-votes">${votes} оценок</span>` : ''}
                            </div>
                            ${imdbRating > 0 ? `
                            <div class="rating-item-large imdb">
                                <span class="rating-label">IMDb</span>
                                <span class="rating-value">${imdbRating.toFixed(1)}</span>
                                ${imdbVotes > 0 ? `<span class="rating-votes">${imdbVotes} оценок</span>` : '<span class="rating-votes">&nbsp;</span>'}
                            </div>` : ''}
                        </div>
                        
                        <div class="movie-actions-container">
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
        this.selectedMovie = null;
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
            
            await ratingService.addOrUpdateRating(
                currentUser.uid,
                userProfile?.displayName || currentUser.displayName || currentUser.email,
                userProfile?.photoURL || currentUser.photoURL || '',
                this.selectedMovie.kinopoiskId,
                rating,
                comment,
                this.selectedMovie // Pass movie data for potential caching
            );
            
            this.closeRatingModal();
            this.showSuccess('Rating saved successfully!');
            
        } catch (error) {
            console.error('Error saving rating:', error);
            this.showError(`Failed to save rating: ${error.message}`);
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
        window.location.href = `search.html?movieId=${movieId}`;
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
});

// Initialize search manager when DOM is loaded
let searchManager;
document.addEventListener('DOMContentLoaded', () => {
    searchManager = new SearchManager();
});

// Alias for router compatibility
window.SearchPageManager = SearchManager;
