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
        this.setupEventListeners();
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
            
            // Filters
            yearFilter: document.getElementById('yearFilter'),
            genreFilter: document.getElementById('genreFilter'),
            countryFilter: document.getElementById('countryFilter'),
            
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
        // Navigation
        this.elements.backBtn.addEventListener('click', () => this.goBack());
        this.elements.settingsBtn.addEventListener('click', () => this.openSettings());
        
        // Search
        this.elements.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.performSearch();
        });
        this.elements.searchBtn.addEventListener('click', () => this.performSearch());
        this.elements.toggleFiltersBtn.addEventListener('click', () => this.toggleFilters());
        this.elements.clearFiltersBtn.addEventListener('click', () => this.clearFilters());
        
        // Pagination
        this.elements.prevPageBtn.addEventListener('click', () => this.previousPage());
        this.elements.nextPageBtn.addEventListener('click', () => this.nextPage());
        
        // Modals
        this.elements.modalClose.addEventListener('click', () => this.closeMovieModal());
        this.elements.closeModalBtn.addEventListener('click', () => this.closeMovieModal());
        this.elements.rateMovieBtn.addEventListener('click', () => this.showRatingModal(this.selectedMovie));
        this.elements.ratingModalClose.addEventListener('click', () => this.closeRatingModal());
        this.elements.cancelRatingBtn.addEventListener('click', () => this.closeRatingModal());
        
        // Rating
        this.elements.ratingSlider.addEventListener('input', (e) => {
            this.elements.ratingValue.textContent = e.target.value;
        });
        this.elements.ratingComment.addEventListener('input', (e) => {
            this.elements.charCount.textContent = e.target.value.length;
        });
        this.elements.saveRatingBtn.addEventListener('click', () => this.saveRating());
        
        // Modal overlays
        this.elements.movieModal.addEventListener('click', (e) => {
            if (e.target === this.elements.movieModal) this.closeMovieModal();
        });
        this.elements.ratingModal.addEventListener('click', (e) => {
            if (e.target === this.elements.ratingModal) this.closeRatingModal();
        });
    }

    async initializeUI() {
        // Check authentication
        if (!firebaseManager.isAuthenticated()) {
            this.showError('Please sign in to search movies');
            return;
        }
        
        this.currentUser = firebaseManager.getCurrentUser();
        
        // Check for movie ID in URL
        const urlParams = new URLSearchParams(window.location.search);
        const movieId = urlParams.get('movieId');
        if (movieId) {
            await this.loadMovieById(movieId);
        }
        
        // Initialize filters
        this.initializeFilters();
    }

    initializeFilters() {
        // Populate year filter (last 50 years)
        const currentYear = new Date().getFullYear();
        for (let year = currentYear; year >= currentYear - 50; year--) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            this.elements.yearFilter.appendChild(option);
        }
        
        // Common genres
        const genres = ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'Film-Noir', 'History', 'Horror', 'Music', 'Musical', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'];
        genres.forEach(genre => {
            const option = document.createElement('option');
            option.value = genre;
            option.textContent = genre;
            this.elements.genreFilter.appendChild(option);
        });
        
        // Common countries
        const countries = ['USA', 'UK', 'France', 'Germany', 'Italy', 'Spain', 'Russia', 'Japan', 'China', 'India', 'Australia', 'Canada', 'Brazil', 'Mexico', 'South Korea'];
        countries.forEach(country => {
            const option = document.createElement('option');
            option.value = country;
            option.textContent = country;
            this.elements.countryFilter.appendChild(option);
        });
    }

    async performSearch() {
        const query = this.elements.searchInput.value.trim();
        if (!query) {
            this.showError('Please enter a search query');
            return;
        }
        
        this.currentQuery = query;
        this.currentPage = 1;
        await this.searchMovies();
    }

    async searchMovies() {
        try {
            this.showLoading(true);
            this.hideError();
            
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
            
            // Cache movies with error handling for Firestore permissions
            try {
                for (const movie of searchResults.docs) {
                    await movieCacheService.cacheMovie(movie);
                }
            } catch (cacheError) {
                console.warn('Failed to cache movies (permissions issue):', cacheError.message);
                // Continue without caching
            }
            
            this.currentResults = searchResults;
            this.displayResults();
            
        } catch (error) {
            console.error('Search error:', error);
            this.showError(`Search failed: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    displayResults() {
        if (this.currentResults.docs.length === 0) {
            this.elements.resultsGrid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <h3 class="empty-state-title">No movies found</h3>
                    <p class="empty-state-text">Try a different search term</p>
                </div>
            `;
            this.elements.resultsHeader.style.display = 'none';
            this.elements.pagination.style.display = 'none';
            return;
        }
        
        // Show results header
        this.elements.resultsHeader.style.display = 'flex';
        this.elements.resultsInfo.textContent = `Found ${this.currentResults.total} movies`;
        
        // Display movie cards
        this.elements.resultsGrid.innerHTML = this.currentResults.docs.map(movie => this.createMovieCard(movie)).join('');
        
        // Show pagination
        this.elements.pagination.style.display = 'flex';
        this.elements.pageInfo.textContent = `Page ${this.currentPage} of ${this.currentResults.pages}`;
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
        
        return `
            <div class="movie-card" data-movie-id="${movie.kinopoiskId}">
                <div class="movie-poster-container">
                    <img src="${posterUrl}" alt="${movie.name}" class="movie-poster" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
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
                    </div>
                    <p class="movie-description">${this.escapeHtml(description)}</p>
                </div>
                <div class="movie-actions">
                    <button class="btn btn-accent btn-sm rate-movie-btn" data-movie-id="${movie.kinopoiskId}">Rate Movie</button>
                </div>
            </div>
        `;
    }

    async loadMovieById(movieId) {
        try {
            this.showLoading(true);
            
            const kinopoiskService = firebaseManager.getKinopoiskService();
            const movie = await kinopoiskService.getMovieById(movieId);
            
            // Cache the movie (with error handling for permissions)
            try {
                const movieCacheService = firebaseManager.getMovieCacheService();
                await movieCacheService.cacheMovie(movie);
            } catch (cacheError) {
                console.warn('Failed to cache movie (permissions issue):', cacheError.message);
                // Continue without caching
            }
            
            this.showMovieModal(movie);
            
        } catch (error) {
            console.error('Error loading movie:', error);
            this.showError(`Failed to load movie: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
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
                <img src="${posterUrl}" alt="${movie.name}" class="movie-detail-poster" onerror="this.src='/icons/icon48.png'">
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
                <img src="${movie.posterUrl || '/icons/icon48.png'}" alt="${movie.name}" class="movie-detail-poster" onerror="this.src='/icons/icon48.png'">
                <div class="movie-detail-info">
                    <h3>${this.escapeHtml(movie.name)}</h3>
                    <p>${movie.year} • ${movie.genres?.slice(0, 3).join(', ')}</p>
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
                comment
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
        this.elements.yearFilter.value = '';
        this.elements.genreFilter.value = '';
        this.elements.countryFilter.value = '';
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
    
    if (e.target.classList.contains('rate-movie-btn')) {
        const movieId = e.target.dataset.movieId;
        const movie = searchManager.currentResults.docs.find(m => m.kinopoiskId == movieId);
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
