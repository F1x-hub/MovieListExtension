/**
 * Favorites Page Manager
 * Handles the Favorites page functionality
 */
class FavoritesPageManager {
    constructor() {
        this.filters = {
            search: '',
            sort: 'favoritedAt-desc'
        };
        this.favorites = [];
        this.filteredFavorites = [];
        this.currentUser = null;
        this.isLoading = false;
        this.currentRatingMovie = null;
        
        this.init();
    }

    async init() {
        this.initializeElements();
        this.initializeCustomDropdowns();
        this.setupEventListeners();
        
        await this.setupFirebase();
        await this.loadFavorites();
    }

    initializeElements() {
        this.elements = {
            // Filters
            favoritesSearchInput: document.getElementById('favoritesSearchInput'),
            sortFilter: document.getElementById('sortFilter'),
            
            // Content areas
            loadingSection: document.getElementById('loadingSection'),
            moviesGrid: document.getElementById('moviesGrid'),
            emptyState: document.getElementById('emptyState'),
            errorState: document.getElementById('errorState'),
            retryBtn: document.getElementById('retryBtn'),
            
            // Results info
            resultsCount: document.getElementById('resultsCount'),
            favoritesCountDisplay: document.getElementById('favoritesCountDisplay'),
            favoritesCurrentCount: document.getElementById('favoritesCurrentCount'),
            
            // Limit Modal
            limitModal: document.getElementById('limitModal'),
            limitModalClose: document.getElementById('limitModalClose'),
            manageFavoritesBtn: document.getElementById('manageFavoritesBtn'),
            cancelLimitBtn: document.getElementById('cancelLimitBtn'),
            
            // Rating Modal
            ratingModal: document.getElementById('ratingModal'),
            ratingModalTitle: document.getElementById('ratingModalTitle'),
            ratingModalClose: document.getElementById('ratingModalClose'),
            ratingSlider: document.getElementById('ratingSlider'),
            ratingValue: document.getElementById('ratingValue'),
            ratingComment: document.getElementById('ratingComment'),
            charCount: document.getElementById('charCount'),
            saveRatingBtn: document.getElementById('saveRatingBtn'),
            cancelRatingBtn: document.getElementById('cancelRatingBtn'),
            movieRatingInfo: document.getElementById('movieRatingInfo'),
            currentRatingInfo: document.getElementById('currentRatingInfo'),
            existingRatingValue: document.getElementById('existingRatingValue'),
            existingRatingComment: document.getElementById('existingRatingComment')
        };
    }

    initializeCustomDropdowns() {
        this.dropdowns = {};
        const dropdownElements = document.querySelectorAll('.custom-dropdown');
        
        dropdownElements.forEach(dropdown => {
            const dropdownId = dropdown.getAttribute('data-dropdown');
            const trigger = dropdown.querySelector('.dropdown-trigger');
            const list = dropdown.querySelector('.dropdown-list');
            const hiddenSelect = dropdown.querySelector('.filter-select-hidden');
            const options = list.querySelectorAll('.dropdown-option');
            
            if (!dropdownId || !trigger || !list || !hiddenSelect) return;
            
            this.dropdowns[dropdownId] = {
                element: dropdown,
                trigger: trigger,
                list: list,
                hiddenSelect: hiddenSelect,
                isOpen: false
            };
            
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleDropdown(dropdownId);
            });
            
            options.forEach(option => {
                option.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const value = option.getAttribute('data-value');
                    const text = option.textContent.trim();
                    this.selectDropdownOption(dropdownId, value, text);
                });
            });
        });
        
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.custom-dropdown')) {
                this.closeAllDropdowns();
            }
        });
    }

    toggleDropdown(dropdownId) {
        const dropdown = this.dropdowns[dropdownId];
        if (!dropdown) return;
        
        const isCurrentlyOpen = dropdown.isOpen;
        
        this.closeAllDropdowns();
        
        if (!isCurrentlyOpen) {
            dropdown.element.classList.add('open');
            dropdown.isOpen = true;
        }
    }

    closeAllDropdowns() {
        Object.keys(this.dropdowns).forEach(dropdownId => {
            const dropdown = this.dropdowns[dropdownId];
            if (dropdown && dropdown.isOpen) {
                dropdown.element.classList.remove('open');
                dropdown.isOpen = false;
            }
        });
    }

    selectDropdownOption(dropdownId, value, text) {
        const dropdown = this.dropdowns[dropdownId];
        if (!dropdown) return;
        
        dropdown.hiddenSelect.value = value;
        dropdown.trigger.querySelector('.dropdown-value').textContent = text;
        this.closeAllDropdowns();
        
        if (dropdownId === 'sortFilter') {
            this.filters.sort = value;
            this.applyFilters();
        }
    }

    setupEventListeners() {
        // Search input
        if (this.elements.favoritesSearchInput) {
            this.elements.favoritesSearchInput.addEventListener('input', (e) => {
                this.filters.search = e.target.value.trim();
                this.applyFilters();
            });
        }

        // Retry button
        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('click', () => {
                this.loadFavorites();
            });
        }

        // Limit Modal
        this.setupLimitModal();

        // Rating modal
        this.setupRatingModal();
    }

    setupLimitModal() {
        if (!this.elements.limitModal) return;

        // Close modal
        if (this.elements.limitModalClose) {
            this.elements.limitModalClose.addEventListener('click', () => {
                this.closeLimitModal();
            });
        }

        if (this.elements.cancelLimitBtn) {
            this.elements.cancelLimitBtn.addEventListener('click', () => {
                this.closeLimitModal();
            });
        }

        if (this.elements.manageFavoritesBtn) {
            this.elements.manageFavoritesBtn.addEventListener('click', () => {
                this.closeLimitModal();
                // Already on favorites page, just scroll to top
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }

        // Close on overlay click
        this.elements.limitModal.addEventListener('click', (e) => {
            if (e.target === this.elements.limitModal) {
                this.closeLimitModal();
            }
        });
    }

    showLimitModal() {
        if (this.elements.limitModal) {
            this.elements.limitModal.style.display = 'flex';
        }
    }

    closeLimitModal() {
        if (this.elements.limitModal) {
            this.elements.limitModal.style.display = 'none';
        }
    }

    setupRatingModal() {
        if (!this.elements.ratingModal) return;

        // Close modal
        if (this.elements.ratingModalClose) {
            this.elements.ratingModalClose.addEventListener('click', () => {
                this.closeRatingModal();
            });
        }

        if (this.elements.cancelRatingBtn) {
            this.elements.cancelRatingBtn.addEventListener('click', () => {
                this.closeRatingModal();
            });
        }

        // Rating slider
        if (this.elements.ratingSlider && this.elements.ratingValue) {
            this.elements.ratingSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                this.elements.ratingValue.textContent = value;
            });
        }

        // Comment character counter
        if (this.elements.ratingComment && this.elements.charCount) {
            this.elements.ratingComment.addEventListener('input', (e) => {
                const length = e.target.value.length;
                this.elements.charCount.textContent = length;
            });
        }

        // Save rating
        if (this.elements.saveRatingBtn) {
            this.elements.saveRatingBtn.addEventListener('click', () => {
                this.saveRating();
            });
        }

        // Close on overlay click
        this.elements.ratingModal.addEventListener('click', (e) => {
            if (e.target === this.elements.ratingModal) {
                this.closeRatingModal();
            }
        });
    }

    async setupFirebase() {
        if (typeof firebaseManager === 'undefined') {
            throw new Error('Firebase Manager not available');
        }

        await firebaseManager.waitForAuthReady();
        this.currentUser = firebaseManager.getCurrentUser();
        
        if (!this.currentUser) {
            window.location.href = chrome.runtime.getURL('src/popup/popup.html');
            return;
        }
    }

    async loadFavorites() {
        if (!this.currentUser) return;

        try {
            this.showLoading();
            this.hideError();

            const favoriteService = firebaseManager.getFavoriteService();
            const movieCacheService = firebaseManager.getMovieCacheService();
            
            // Parse sort filter
            const [sortBy, order] = this.filters.sort.split('-');
            const sortOrder = order === 'asc' ? 'asc' : 'desc';
            
            const favoritesData = await favoriteService.getFavorites(
                this.currentUser.uid,
                sortBy,
                sortOrder
            );

            // Load movie data and average ratings for each favorite
            const ratingService = firebaseManager.getRatingService();
            const movieIds = favoritesData.map(f => f.movieId);
            const averageRatings = await ratingService.getBatchMovieAverageRatings(movieIds);
            
            this.favorites = [];
            for (const favorite of favoritesData) {
                try {
                    const movie = await movieCacheService.getCachedMovie(favorite.movieId);
                    const avgData = averageRatings[favorite.movieId] || { average: 0, count: 0 };
                    this.favorites.push({
                        ...favorite,
                        movie: movie,
                        averageRating: avgData.average,
                        ratingsCount: avgData.count
                    });
                } catch (error) {
                    console.warn(`Failed to load movie data for ${favorite.movieId}:`, error);
                    const avgData = averageRatings[favorite.movieId] || { average: 0, count: 0 };
                    this.favorites.push({
                        ...favorite,
                        movie: null,
                        averageRating: avgData.average,
                        ratingsCount: avgData.count
                    });
                }
            }

            // Update count display
            const count = this.favorites.length;
            if (this.elements.favoritesCurrentCount) {
                this.elements.favoritesCurrentCount.textContent = count;
            }

            this.applyFilters();
            this.hideLoading();
        } catch (error) {
            console.error('Error loading favorites:', error);
            this.showError('Failed to load favorites. Please try again.');
            this.hideLoading();
        }
    }

    applyFilters() {
        let filtered = [...this.favorites];

        // Apply search filter
        if (this.filters.search) {
            const searchTerm = this.filters.search.toLowerCase();
            filtered = filtered.filter(item => {
                const movieTitle = item.movie?.name || item.movieTitle || '';
                return movieTitle.toLowerCase().includes(searchTerm);
            });
        }

        // Apply sort (always sort in memory since we have movie data loaded)
        const [sortBy, order] = this.filters.sort.split('-');
        filtered.sort((a, b) => {
            if (sortBy === 'favoritedAt') {
                const dateA = a.favoritedAt?.toDate?.() || new Date(a.favoritedAt) || new Date(0);
                const dateB = b.favoritedAt?.toDate?.() || new Date(b.favoritedAt) || new Date(0);
                return order === 'desc' ? dateB - dateA : dateA - dateB;
            } else if (sortBy === 'rating') {
                const ratingA = a.rating || 0;
                const ratingB = b.rating || 0;
                return order === 'desc' ? ratingB - ratingA : ratingA - ratingB;
            } else if (sortBy === 'movieTitle') {
                const titleA = (a.movie?.name || '').toLowerCase();
                const titleB = (b.movie?.name || '').toLowerCase();
                return order === 'asc' 
                    ? titleA.localeCompare(titleB)
                    : titleB.localeCompare(titleA);
            } else if (sortBy === 'releaseYear') {
                const yearA = a.movie?.year || 0;
                const yearB = b.movie?.year || 0;
                return order === 'desc' ? yearB - yearA : yearA - yearB;
            } else if (sortBy === 'watchedDate') {
                const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt) || new Date(0);
                const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt) || new Date(0);
                return order === 'desc' ? dateB - dateA : dateA - dateB;
            }
            return 0;
        });

        this.filteredFavorites = filtered;
        this.renderMovies();
        this.updateResultsInfo();
    }

    renderMovies() {
        const grid = this.elements.moviesGrid;
        if (!grid) return;
        
        grid.innerHTML = '';
        
        if (this.filteredFavorites.length === 0) {
            this.showEmptyState();
            return;
        }
        
        this.hideEmptyState();
        
        this.filteredFavorites.forEach(favorite => {
            const card = this.createMovieCard(favorite);
            grid.appendChild(card);
        });
        
        this.attachCardEventListeners();
    }

    createMovieCard(favorite) {
        // Use the new MovieCard component
        return MovieCard.create(favorite, {
            showFavorite: true,  // Show favorite toggle (to remove from favorites)
            showWatchlist: false,
            showUserInfo: false,
            showEditRating: true,  // Show edit rating in menu
            showAddToCollection: false,
            showThreeDotMenu: true
        });
    }

    attachCardEventListeners() {
        const grid = this.elements.moviesGrid;
        if (!grid) return;

        // View Details buttons
        grid.querySelectorAll('.action-btn.btn-primary').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const movieId = button.getAttribute('data-movie-id');
                if (movieId) {
                    const url = chrome.runtime.getURL(`src/pages/search/search.html?movieId=${movieId}`);
                    window.location.href = url;
                }
            });
        });

        // Edit Rating buttons
        grid.querySelectorAll('.edit-rating-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                e.stopPropagation();
                const ratingId = button.getAttribute('data-rating-id');
                const movieId = button.getAttribute('data-movie-id');
                
                if (ratingId && movieId) {
                    const favorite = this.favorites.find(f => f.id === ratingId);
                    if (favorite) {
                        await this.showRatingModal(favorite);
                    }
                }
            });
        });

        // Remove from Favorites buttons
        grid.querySelectorAll('.favorite-btn-remove').forEach(button => {
            button.addEventListener('click', async (e) => {
                e.stopPropagation();
                const ratingId = button.getAttribute('data-rating-id');
                if (ratingId) {
                    await this.removeFromFavorites(ratingId);
                }
            });
        });
    }

    async removeFromFavorites(ratingId) {
        if (!this.currentUser) return;

        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const favorite = this.favorites.find(f => f.id === ratingId);
            
            if (favorite && favorite.isFavorite) {
                await favoriteService.toggleFavorite(ratingId, true);
            } else {
                await favoriteService.removeFromFavorites(ratingId);
            }
            
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Удалено из Избранного', 'success');
            }
            
            await this.loadFavorites();
            
            if (window.navigation && typeof window.navigation.updateFavoritesCount === 'function') {
                await window.navigation.updateFavoritesCount();
            }
        } catch (error) {
            console.error('Error removing from favorites:', error);
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Ошибка при удалении из Избранного', 'error');
            }
        }
    }

    async showRatingModal(favorite) {
        if (!this.elements.ratingModal) return;

        this.currentRatingMovie = favorite;
        const movie = favorite.movie;
        
        // Set movie info
        if (this.elements.movieRatingInfo) {
            const posterUrl = movie?.posterUrl || '/icons/icon48.png';
            const title = movie?.name || favorite.movieTitle || 'Unknown Movie';
            const year = movie?.year || favorite.releaseYear || '';
            
            this.elements.movieRatingInfo.innerHTML = `
                <div class="movie-rating-poster">
                    <img src="${posterUrl}" alt="${title}" onerror="this.src='/icons/icon48.png'">
                </div>
                <div class="movie-rating-info">
                    <h3>${this.escapeHtml(title)}</h3>
                    ${year ? `<p>${year}</p>` : ''}
                </div>
            `;
        }

        // Set current rating info
        if (this.elements.currentRatingInfo && favorite.rating) {
            this.elements.currentRatingInfo.style.display = 'block';
            if (this.elements.existingRatingValue) {
                this.elements.existingRatingValue.textContent = `${favorite.rating}`;
            }
            if (this.elements.existingRatingComment) {
                this.elements.existingRatingComment.textContent = favorite.comment || 'No comment';
            }
        } else if (this.elements.currentRatingInfo) {
            this.elements.currentRatingInfo.style.display = 'none';
        }

        // Set form values
        if (this.elements.ratingSlider) {
            this.elements.ratingSlider.value = favorite.rating || 5;
        }
        if (this.elements.ratingValue) {
            this.elements.ratingValue.textContent = favorite.rating || 5;
        }
        if (this.elements.ratingComment) {
            this.elements.ratingComment.value = favorite.comment || '';
        }
        if (this.elements.charCount) {
            this.elements.charCount.textContent = (favorite.comment || '').length;
        }

        // Show modal
        this.elements.ratingModal.style.display = 'flex';
    }

    closeRatingModal() {
        if (this.elements.ratingModal) {
            this.elements.ratingModal.style.display = 'none';
        }
        this.currentRatingMovie = null;
    }

    async saveRating() {
        if (!this.currentUser || !this.currentRatingMovie) return;

        try {
            const rating = parseInt(this.elements.ratingSlider.value);
            const comment = this.elements.ratingComment.value.trim();
            const movie = this.currentRatingMovie.movie;

            const ratingService = firebaseManager.getRatingService();
            const user = this.currentUser;
            
            await ratingService.addOrUpdateRating(
                user.uid,
                user.displayName || user.email || 'User',
                user.photoURL || '',
                this.currentRatingMovie.movieId,
                rating,
                comment,
                movie ? {
                    kinopoiskId: movie.kinopoiskId || this.currentRatingMovie.movieId,
                    name: movie.name,
                    posterUrl: movie.posterUrl,
                    year: movie.year,
                    genres: movie.genres || []
                } : null
            );

            if (typeof Utils !== 'undefined') {
                Utils.showToast('Рейтинг обновлен', 'success');
            }

            this.closeRatingModal();
            
            await this.loadFavorites();
        } catch (error) {
            console.error('Error saving rating:', error);
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Ошибка при сохранении рейтинга', 'error');
            }
        }
    }

    updateResultsInfo() {
        if (!this.elements.resultsCount) return;

        const count = this.filteredFavorites.length;
        const total = this.favorites.length;
        
        if (this.filters.search) {
            this.elements.resultsCount.textContent = `Found ${count} of ${total} favorites`;
        } else {
            this.elements.resultsCount.textContent = `${total} favorite${total !== 1 ? 's' : ''}`;
        }
    }

    showLoading() {
        if (this.elements.loadingSection) {
            this.elements.loadingSection.style.display = 'flex';
        }
        if (this.elements.moviesGrid) {
            this.elements.moviesGrid.style.display = 'none';
        }
        this.isLoading = true;
    }

    hideLoading() {
        if (this.elements.loadingSection) {
            this.elements.loadingSection.style.display = 'none';
        }
        if (this.elements.moviesGrid) {
            this.elements.moviesGrid.style.display = 'grid';
        }
        this.isLoading = false;
    }

    showEmptyState() {
        if (this.elements.emptyState) {
            this.elements.emptyState.style.display = 'flex';
        }
        if (this.elements.moviesGrid) {
            this.elements.moviesGrid.style.display = 'none';
        }
    }

    hideEmptyState() {
        if (this.elements.emptyState) {
            this.elements.emptyState.style.display = 'none';
        }
        if (this.elements.moviesGrid) {
            this.elements.moviesGrid.style.display = 'grid';
        }
    }

    showError(message) {
        if (this.elements.errorState) {
            this.elements.errorState.style.display = 'flex';
            const errorMessage = this.elements.errorState.querySelector('#errorMessage');
            if (errorMessage) {
                errorMessage.textContent = message;
            }
        }
    }

    hideError() {
        if (this.elements.errorState) {
            this.elements.errorState.style.display = 'none';
        }
    }

    formatDate(date) {
        const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        const day = date.getDate();
        const month = months[date.getMonth()];
        const year = date.getFullYear();
        return `${day} ${month} ${year}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize favorites page manager when DOM is loaded
let favoritesPage;
document.addEventListener('DOMContentLoaded', () => {
    favoritesPage = new FavoritesPageManager();
});

