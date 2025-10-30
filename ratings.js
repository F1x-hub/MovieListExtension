/**
 * Ratings Page Manager
 * Handles the My Collection page functionality
 */
class RatingsPageManager {
    constructor() {
        this.currentMode = 'my-ratings'; // 'my-ratings' or 'all-ratings'
        this.filters = {
            search: '',
            genre: '',
            year: '',
            myRating: '',
            avgRating: '',
            sort: 'date-desc'
        };
        this.movies = [];
        this.filteredMovies = [];
        this.currentUser = null;
        this.isLoading = false;
        
        this.init();
    }

    async init() {
        this.initializeElements();
        this.setupEventListeners();
        this.loadFiltersFromStorage();
        await this.setupFirebase();
        await this.loadMovies();
    }

    initializeElements() {
        this.elements = {
            // Mode toggle
            myRatingsBtn: document.getElementById('myRatingsBtn'),
            allRatingsBtn: document.getElementById('allRatingsBtn'),
            
            // Filters
            movieSearchInput: document.getElementById('movieSearchInput'),
            genreFilter: document.getElementById('genreFilter'),
            yearFilter: document.getElementById('yearFilter'),
            myRatingFilter: document.getElementById('myRatingFilter'),
            avgRatingFilter: document.getElementById('avgRatingFilter'),
            sortFilter: document.getElementById('sortFilter'),
            clearFiltersBtn: document.getElementById('clearFiltersBtn'),
            
            // Content areas
            loadingSection: document.getElementById('loadingSection'),
            moviesGrid: document.getElementById('moviesGrid'),
            emptyState: document.getElementById('emptyState'),
            errorState: document.getElementById('errorState'),
            retryBtn: document.getElementById('retryBtn'),
            
            // Results info
            resultsCount: document.getElementById('resultsCount'),
            resultsMode: document.getElementById('resultsMode'),
            
            // Modals
            movieModal: document.getElementById('movieModal'),
            modalClose: document.getElementById('modalClose'),
            modalTitle: document.getElementById('modalTitle'),
            modalBody: document.getElementById('modalBody'),
            
            editRatingModal: document.getElementById('editRatingModal'),
            editModalClose: document.getElementById('editModalClose'),
            editRatingSlider: document.getElementById('editRatingSlider'),
            editRatingValue: document.getElementById('editRatingValue'),
            editRatingComment: document.getElementById('editRatingComment'),
            editCommentCount: document.getElementById('editCommentCount'),
            editSaveBtn: document.getElementById('editSaveBtn'),
            editCancelBtn: document.getElementById('editCancelBtn')
        };
    }

    setupEventListeners() {
        // Mode toggle
        this.elements.myRatingsBtn?.addEventListener('click', () => this.setMode('my-ratings'));
        this.elements.allRatingsBtn?.addEventListener('click', () => this.setMode('all-ratings'));
        
        // Filters
        this.elements.movieSearchInput?.addEventListener('input', (e) => {
            this.filters.search = e.target.value;
            this.debounceFilter();
        });
        
        this.elements.genreFilter?.addEventListener('change', (e) => {
            this.filters.genre = e.target.value;
            this.applyFilters();
        });
        
        this.elements.yearFilter?.addEventListener('change', (e) => {
            this.filters.year = e.target.value;
            this.applyFilters();
        });
        
        this.elements.myRatingFilter?.addEventListener('change', (e) => {
            this.filters.myRating = e.target.value;
            this.applyFilters();
        });
        
        this.elements.avgRatingFilter?.addEventListener('change', (e) => {
            this.filters.avgRating = e.target.value;
            this.applyFilters();
        });
        
        this.elements.sortFilter?.addEventListener('change', (e) => {
            this.filters.sort = e.target.value;
            this.applyFilters();
        });
        
        this.elements.clearFiltersBtn?.addEventListener('click', () => this.clearFilters());
        
        // Retry button
        this.elements.retryBtn?.addEventListener('click', () => this.loadMovies());
        
        // Modal close buttons
        this.elements.modalClose?.addEventListener('click', () => this.closeModal());
        this.elements.editModalClose?.addEventListener('click', () => this.closeEditModal());
        
        // Edit rating modal
        this.elements.editRatingSlider?.addEventListener('input', (e) => {
            this.elements.editRatingValue.textContent = e.target.value;
        });
        
        this.elements.editRatingComment?.addEventListener('input', (e) => {
            const count = e.target.value.length;
            this.elements.editCommentCount.textContent = count;
        });
        
        this.elements.editSaveBtn?.addEventListener('click', () => this.saveEditedRating());
        this.elements.editCancelBtn?.addEventListener('click', () => this.closeEditModal());
        
        // Close modals on background click
        this.elements.movieModal?.addEventListener('click', (e) => {
            if (e.target === this.elements.movieModal) this.closeModal();
        });
        
        this.elements.editRatingModal?.addEventListener('click', (e) => {
            if (e.target === this.elements.editRatingModal) this.closeEditModal();
        });
    }

    async setupFirebase() {
        try {
            console.log('Setting up Firebase...');
            
            // Wait for firebaseManager to be available
            let attempts = 0;
            while (typeof firebaseManager === 'undefined' && attempts < 50) {
                console.log('Waiting for firebaseManager, attempt:', attempts);
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            
            if (typeof firebaseManager !== 'undefined') {
                console.log('FirebaseManager found, initializing...');
                await firebaseManager.init();
                
                // Check if user is already authenticated
                const currentUser = firebaseManager.getCurrentUser();
                console.log('Current user after init:', currentUser ? currentUser.email : 'null');
                
                if (currentUser) {
                    this.currentUser = currentUser;
                    this.loadMovies();
                }
                
                firebaseManager.onAuthStateChanged((user) => {
                    console.log('Auth state changed, user:', user ? user.email : 'null');
                    this.currentUser = user;
                    if (user) {
                        this.loadMovies();
                    } else {
                        this.showError('Please sign in to view your collection');
                    }
                });
                
                // If still no user after setup, show error
                setTimeout(() => {
                    if (!this.currentUser) {
                        console.log('No user found after timeout, checking auth again...');
                        const user = firebaseManager.getCurrentUser();
                        if (user) {
                            console.log('Found user on retry:', user.email);
                            this.currentUser = user;
                            this.loadMovies();
                        } else {
                            this.showError('Please sign in to view your collection');
                        }
                    }
                }, 2000);
            } else {
                throw new Error('Firebase manager not available after waiting');
            }
        } catch (error) {
            console.error('Firebase setup error:', error);
            this.showError('Failed to initialize. Please refresh the page.');
        }
    }

    setMode(mode) {
        this.currentMode = mode;
        
        // Update button states
        this.elements.myRatingsBtn?.classList.toggle('active', mode === 'my-ratings');
        this.elements.allRatingsBtn?.classList.toggle('active', mode === 'all-ratings');
        
        // Save to storage
        localStorage.setItem('ratingsPageMode', mode);
        
        // Reload movies
        this.loadMovies();
    }

    async loadMovies() {
        console.log('loadMovies called, isLoading:', this.isLoading, 'currentUser:', this.currentUser);
        
        if (this.isLoading || !this.currentUser) {
            console.log('Skipping loadMovies - isLoading or no user');
            return;
        }
        
        this.isLoading = true;
        this.showLoading(true);
        this.hideError();
        
        try {
            console.log('Getting rating service...');
            const ratingService = firebaseManager.getRatingService();
            const movieCacheService = firebaseManager.getMovieCacheService();
            
            let ratings = [];
            
            console.log('Loading ratings for mode:', this.currentMode);
            
            if (this.currentMode === 'my-ratings') {
                // Get only current user's ratings
                ratings = await ratingService.getUserRatings(this.currentUser.uid, 100);
                console.log('Loaded user ratings:', ratings.length);
            } else {
                // Get all ratings
                const result = await ratingService.getAllRatings(100);
                ratings = result.ratings;
                console.log('Loaded all ratings:', ratings.length);
            }
            
            // Enrich with movie data and average ratings
            console.log('Enriching ratings with movie data...');
            this.movies = await this.enrichRatingsWithMovieData(ratings);
            console.log('Enriched movies:', this.movies.length);
            
            // Populate year filter
            this.populateYearFilter();
            
            // Apply current filters
            this.applyFilters();
            
        } catch (error) {
            console.error('Error loading movies:', error);
            this.showError(`Failed to load movies: ${error.message}`);
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }

    async enrichRatingsWithMovieData(ratings) {
        const movieCacheService = firebaseManager.getMovieCacheService();
        const ratingService = firebaseManager.getRatingService();
        const kinopoiskService = firebaseManager.getKinopoiskService();
        
        const enrichedMovies = [];
        
        for (const rating of ratings) {
            try {
                // Get movie data from cache
                let movieData = await movieCacheService.getCachedMovie(rating.movieId);
                
                // If not in cache, try to fetch from Kinopoisk
                if (!movieData) {
                    try {
                        movieData = await kinopoiskService.getMovieById(rating.movieId);
                        if (movieData) {
                            await movieCacheService.cacheMovie(movieData);
                        }
                    } catch (fetchError) {
                        console.warn('Failed to fetch movie data:', fetchError);
                        // Create minimal movie data
                        movieData = {
                            kinopoiskId: rating.movieId,
                            name: 'Unknown Movie',
                            year: '',
                            genres: [],
                            description: '',
                            posterUrl: ''
                        };
                    }
                }
                
                // Get average rating for this movie
                const averageData = await ratingService.getMovieAverageRating(rating.movieId);
                
                enrichedMovies.push({
                    ...rating,
                    movie: movieData,
                    averageRating: averageData.average,
                    ratingsCount: averageData.count
                });
                
            } catch (error) {
                console.error('Error enriching rating:', error);
                // Add with minimal data
                enrichedMovies.push({
                    ...rating,
                    movie: {
                        kinopoiskId: rating.movieId,
                        name: 'Unknown Movie',
                        year: '',
                        genres: [],
                        description: '',
                        posterUrl: ''
                    },
                    averageRating: 0,
                    ratingsCount: 0
                });
            }
        }
        
        return enrichedMovies;
    }

    populateYearFilter() {
        const years = new Set();
        this.movies.forEach(movie => {
            if (movie.movie?.year) {
                years.add(movie.movie.year);
            }
        });
        
        const sortedYears = Array.from(years).sort((a, b) => b - a);
        const yearFilter = this.elements.yearFilter;
        
        if (yearFilter) {
            // Clear existing options except "All Years"
            yearFilter.innerHTML = '<option value="">All Years</option>';
            
            sortedYears.forEach(year => {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                yearFilter.appendChild(option);
            });
        }
    }

    applyFilters() {
        let filtered = [...this.movies];
        
        // Search filter
        if (this.filters.search) {
            const searchTerm = this.filters.search.toLowerCase();
            filtered = filtered.filter(movie => 
                movie.movie?.name?.toLowerCase().includes(searchTerm)
            );
        }
        
        // Genre filter
        if (this.filters.genre) {
            filtered = filtered.filter(movie => 
                movie.movie?.genres?.some(genre => 
                    genre.toLowerCase().includes(this.filters.genre.toLowerCase())
                )
            );
        }
        
        // Year filter
        if (this.filters.year) {
            filtered = filtered.filter(movie => 
                movie.movie?.year?.toString() === this.filters.year
            );
        }
        
        // My rating filter
        if (this.filters.myRating && this.currentMode === 'my-ratings') {
            const [min, max] = this.filters.myRating.split('-').map(Number);
            filtered = filtered.filter(movie => 
                movie.rating >= min && movie.rating <= max
            );
        }
        
        // Average rating filter
        if (this.filters.avgRating) {
            const [min, max] = this.filters.avgRating.split('-').map(Number);
            filtered = filtered.filter(movie => 
                movie.averageRating >= min && movie.averageRating <= max
            );
        }
        
        // Sort
        this.sortMovies(filtered);
        
        this.filteredMovies = filtered;
        this.renderMovies();
        this.updateResultsInfo();
        this.saveFiltersToStorage();
    }

    sortMovies(movies) {
        const [field, direction] = this.filters.sort.split('-');
        
        movies.sort((a, b) => {
            let valueA, valueB;
            
            switch (field) {
                case 'date':
                    valueA = a.createdAt?.toDate?.() || new Date(a.createdAt) || new Date(0);
                    valueB = b.createdAt?.toDate?.() || new Date(b.createdAt) || new Date(0);
                    break;
                case 'rating':
                    valueA = a.rating || 0;
                    valueB = b.rating || 0;
                    break;
                case 'avg':
                    valueA = a.averageRating || 0;
                    valueB = b.averageRating || 0;
                    break;
                case 'title':
                    valueA = a.movie?.name?.toLowerCase() || '';
                    valueB = b.movie?.name?.toLowerCase() || '';
                    break;
                case 'year':
                    valueA = a.movie?.year || 0;
                    valueB = b.movie?.year || 0;
                    break;
                default:
                    return 0;
            }
            
            if (direction === 'desc') {
                return valueA > valueB ? -1 : valueA < valueB ? 1 : 0;
            } else {
                return valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
            }
        });
    }

    renderMovies() {
        const grid = this.elements.moviesGrid;
        if (!grid) return;
        
        grid.innerHTML = '';
        
        if (this.filteredMovies.length === 0) {
            this.showEmptyState();
            return;
        }
        
        this.hideEmptyState();
        
        this.filteredMovies.forEach(movieData => {
            const card = this.createMovieCard(movieData);
            grid.appendChild(card);
        });
    }

    createMovieCard(movieData) {
        console.log('Creating movie card for:', movieData);
        const { movie, rating, averageRating, ratingsCount, comment, createdAt } = movieData;
        
        const card = document.createElement('div');
        card.className = 'movie-card fade-in';
        
        const posterUrl = movie?.posterUrl || '/icons/icon48.png';
        const title = movie?.name || 'Unknown Movie';
        const year = movie?.year || '';
        const genres = movie?.genres?.slice(0, 3) || [];
        const description = movie?.description || '';
        
        console.log('Movie data:', { title, year, genres, rating, averageRating });
        
        const truncatedDescription = description.length > 150 
            ? description.substring(0, 150) + '...' 
            : description;
        
        const avgDisplay = ratingsCount > 0 ? `${averageRating.toFixed(1)}/10` : 'No ratings';
        
        card.innerHTML = `
            <img src="${posterUrl}" alt="${title}" class="movie-poster" onerror="this.src='/icons/icon48.png'">
            <div class="movie-content">
                <h3 class="movie-title">${title}</h3>
                <div class="movie-meta">${year}${year && genres.length ? ' • ' : ''}${genres.join(', ')}</div>
                
                ${genres.length > 0 ? `
                    <div class="movie-genres">
                        ${genres.map(genre => `<span class="genre-tag">${genre}</span>`).join('')}
                    </div>
                ` : ''}
                
                ${description ? `
                    <div class="movie-description">${truncatedDescription}</div>
                ` : ''}
                
                <div class="movie-ratings">
                    <div class="rating-item">
                        <div class="rating-label">My Rating</div>
                        <div class="rating-value my-rating">⭐ ${rating}/10</div>
                    </div>
                    <div class="rating-item">
                        <div class="rating-label">Avg Rating</div>
                        <div class="rating-value avg-rating">${avgDisplay}</div>
                    </div>
                </div>
                
                <div class="movie-actions">
                    <button class="action-btn btn-primary" onclick="ratingsPage.showMovieDetails(${movie?.kinopoiskId})">
                        View Details
                    </button>
                    ${this.currentMode === 'my-ratings' ? `
                        <button class="action-btn edit-btn" onclick="ratingsPage.editRating(${movie?.kinopoiskId}, ${rating}, '${comment || ''}')">
                            Edit Rating
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
        
        return card;
    }

    showMovieDetails(movieId) {
        const movieData = this.filteredMovies.find(m => m.movie?.kinopoiskId === movieId);
        if (!movieData) return;
        
        const { movie, rating, averageRating, ratingsCount, comment } = movieData;
        
        this.elements.modalTitle.textContent = movie?.name || 'Movie Details';
        
        const avgDisplay = ratingsCount > 0 ? `${averageRating.toFixed(1)}/10 (${ratingsCount} ratings)` : 'No ratings yet';
        
        this.elements.modalBody.innerHTML = `
            <div style="display: flex; gap: 20px; margin-bottom: 20px;">
                <img src="${movie?.posterUrl || '/icons/icon48.png'}" 
                     alt="${movie?.name}" 
                     style="width: 150px; height: 200px; object-fit: cover; border-radius: 8px;"
                     onerror="this.src='/icons/icon48.png'">
                <div style="flex: 1;">
                    <h3 style="margin: 0 0 10px 0;">${this.escapeHtml(movie?.name || 'Unknown Movie')}</h3>
                    <p style="color: #666; margin: 0 0 10px 0;">${movie?.year || ''} • ${movie?.genres?.join(', ') || ''}</p>
                    <div style="margin: 15px 0;">
                        <strong>My Rating:</strong> ⭐ ${rating}/10<br>
                        <strong>Average Rating:</strong> ${avgDisplay}
                    </div>
                    ${comment ? `
                        <div style="margin: 15px 0;">
                            <strong>My Comment:</strong><br>
                            <em>"${this.escapeHtml(comment)}"</em>
                        </div>
                    ` : ''}
                </div>
            </div>
            ${movie?.description ? `
                <div>
                    <strong>Description:</strong><br>
                    <p style="line-height: 1.5; color: #555;">${this.escapeHtml(movie.description)}</p>
                </div>
            ` : ''}
        `;
        
        this.elements.movieModal.style.display = 'flex';
    }

    editRating(movieId, currentRating, currentComment) {
        this.currentEditMovieId = movieId;
        
        this.elements.editRatingSlider.value = currentRating;
        this.elements.editRatingValue.textContent = currentRating;
        this.elements.editRatingComment.value = currentComment || '';
        this.elements.editCommentCount.textContent = (currentComment || '').length;
        
        this.elements.editRatingModal.style.display = 'flex';
    }

    async saveEditedRating() {
        if (!this.currentEditMovieId || !this.currentUser) return;
        
        try {
            const rating = parseInt(this.elements.editRatingSlider.value);
            const comment = this.elements.editRatingComment.value.trim();
            
            const ratingService = firebaseManager.getRatingService();
            
            await ratingService.addOrUpdateRating(
                this.currentUser.uid,
                this.currentUser.displayName || this.currentUser.email,
                this.currentUser.photoURL || '',
                this.currentEditMovieId,
                rating,
                comment
            );
            
            this.closeEditModal();
            await this.loadMovies(); // Reload to show updated data
            
        } catch (error) {
            console.error('Error saving rating:', error);
            alert('Failed to save rating. Please try again.');
        }
    }

    closeModal() {
        this.elements.movieModal.style.display = 'none';
    }

    closeEditModal() {
        this.elements.editRatingModal.style.display = 'none';
        this.currentEditMovieId = null;
    }

    clearFilters() {
        this.filters = {
            search: '',
            genre: '',
            year: '',
            myRating: '',
            avgRating: '',
            sort: 'date-desc'
        };
        
        // Reset form elements
        this.elements.movieSearchInput.value = '';
        this.elements.genreFilter.value = '';
        this.elements.yearFilter.value = '';
        this.elements.myRatingFilter.value = '';
        this.elements.avgRatingFilter.value = '';
        this.elements.sortFilter.value = 'date-desc';
        
        this.applyFilters();
    }

    debounceFilter() {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.applyFilters();
        }, 300);
    }

    updateResultsInfo() {
        const count = this.filteredMovies.length;
        const total = this.movies.length;
        
        this.elements.resultsCount.textContent = `Showing ${count} of ${total} movies`;
        this.elements.resultsMode.textContent = this.currentMode === 'my-ratings' ? 'My Ratings Only' : 'All Ratings';
    }

    showLoading(show) {
        this.elements.loadingSection.style.display = show ? 'block' : 'none';
        this.elements.moviesGrid.style.display = show ? 'none' : 'grid';
    }

    showEmptyState() {
        this.elements.emptyState.style.display = 'block';
        this.elements.moviesGrid.style.display = 'none';
    }

    hideEmptyState() {
        this.elements.emptyState.style.display = 'none';
        this.elements.moviesGrid.style.display = 'grid';
    }

    showError(message) {
        this.elements.errorState.style.display = 'block';
        this.elements.loadingSection.style.display = 'none';
        this.elements.moviesGrid.style.display = 'none';
        document.getElementById('errorMessage').textContent = message;
    }

    hideError() {
        this.elements.errorState.style.display = 'none';
    }

    saveFiltersToStorage() {
        localStorage.setItem('ratingsPageFilters', JSON.stringify(this.filters));
    }

    loadFiltersFromStorage() {
        const savedMode = localStorage.getItem('ratingsPageMode');
        if (savedMode) {
            this.currentMode = savedMode;
        }
        
        const savedFilters = localStorage.getItem('ratingsPageFilters');
        if (savedFilters) {
            try {
                this.filters = { ...this.filters, ...JSON.parse(savedFilters) };
                this.restoreFilterUI();
            } catch (error) {
                console.warn('Failed to load saved filters:', error);
            }
        }
    }

    restoreFilterUI() {
        if (this.elements.movieSearchInput) this.elements.movieSearchInput.value = this.filters.search;
        if (this.elements.genreFilter) this.elements.genreFilter.value = this.filters.genre;
        if (this.elements.yearFilter) this.elements.yearFilter.value = this.filters.year;
        if (this.elements.myRatingFilter) this.elements.myRatingFilter.value = this.filters.myRating;
        if (this.elements.avgRatingFilter) this.elements.avgRatingFilter.value = this.filters.avgRating;
        if (this.elements.sortFilter) this.elements.sortFilter.value = this.filters.sort;
    }

    escapeHtml(text) {
        if (typeof Utils !== 'undefined' && Utils.escapeHtml) {
            return Utils.escapeHtml(text);
        }
        
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.ratingsPage = new RatingsPageManager();
});
