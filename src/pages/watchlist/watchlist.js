/**
 * Watchlist Page Manager
 * Handles the Watchlist page functionality
 */
class WatchlistPageManager {
    constructor() {
        this.filters = {
            search: '',
            sort: 'addedAt-desc'
        };
        this.watchlist = [];
        this.filteredWatchlist = [];
        this.currentUser = null;
        this.isLoading = false;
        
        this.init();
    }

    async init() {
        this.initializeElements();
        this.initializeCustomDropdowns();
        this.setupEventListeners();
        
        await this.setupFirebase();
        await this.loadWatchlist();
    }

    initializeElements() {
        this.elements = {
            // Filters
            watchlistSearchInput: document.getElementById('watchlistSearchInput'),
            sortFilter: document.getElementById('sortFilter'),
            
            // Content areas
            loadingSection: document.getElementById('loadingSection'),
            moviesGrid: document.getElementById('moviesGrid'),
            emptyState: document.getElementById('emptyState'),
            errorState: document.getElementById('errorState'),
            retryBtn: document.getElementById('retryBtn'),
            
            // Results info
            resultsCount: document.getElementById('resultsCount'),
            
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
            movieRatingInfo: document.getElementById('movieRatingInfo')
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
        if (this.elements.watchlistSearchInput) {
            this.elements.watchlistSearchInput.addEventListener('input', (e) => {
                this.filters.search = e.target.value.trim();
                this.applyFilters();
            });
        }

        // Retry button
        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('click', () => {
                this.loadWatchlist();
            });
        }

        // Rating modal
        this.setupRatingModal();
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
            // Redirect to popup for sign in
            window.location.href = chrome.runtime.getURL('src/popup/popup.html');
            return;
        }
    }

    async loadWatchlist() {
        if (!this.currentUser) return;

        try {
            this.showLoading();
            this.hideError();

            const watchlistService = firebaseManager.getWatchlistService();
            
            // Parse sort filter
            const [sortBy, order] = this.filters.sort.split('-');
            const sortOrder = order === 'asc' ? 'asc' : 'desc';
            
            this.watchlist = await watchlistService.getWatchlist(
                this.currentUser.uid,
                sortBy,
                sortOrder
            );

            this.applyFilters();
            this.hideLoading();
        } catch (error) {
            console.error('Error loading watchlist:', error);
            this.showError('Failed to load watchlist. Please try again.');
            this.hideLoading();
        }
    }

    applyFilters() {
        let filtered = [...this.watchlist];

        // Apply search filter
        if (this.filters.search) {
            const searchTerm = this.filters.search.toLowerCase();
            filtered = filtered.filter(item => {
                const title = (item.movieTitle || '').toLowerCase();
                const titleRu = (item.movieTitleRu || '').toLowerCase();
                return title.includes(searchTerm) || titleRu.includes(searchTerm);
            });
        }

        // Apply sort (already sorted by getWatchlist, but re-sort if needed for search results)
        if (this.filters.search) {
            const [sortBy, order] = this.filters.sort.split('-');
            filtered.sort((a, b) => {
                if (sortBy === 'addedAt') {
                    const dateA = a.addedAt?.toDate?.() || new Date(a.addedAt) || new Date(0);
                    const dateB = b.addedAt?.toDate?.() || new Date(b.addedAt) || new Date(0);
                    return order === 'desc' ? dateB - dateA : dateA - dateB;
                } else if (sortBy === 'movieTitle') {
                    const titleA = (a.movieTitle || '').toLowerCase();
                    const titleB = (b.movieTitle || '').toLowerCase();
                    return order === 'asc' 
                        ? titleA.localeCompare(titleB)
                        : titleB.localeCompare(titleA);
                } else if (sortBy === 'releaseYear') {
                    const yearA = a.releaseYear || 0;
                    const yearB = b.releaseYear || 0;
                    return order === 'desc' ? yearB - yearA : yearA - yearB;
                } else if (sortBy === 'avgRating') {
                    const ratingA = a.avgRating || 0;
                    const ratingB = b.avgRating || 0;
                    return order === 'desc' ? ratingB - ratingA : ratingA - ratingB;
                }
                return 0;
            });
        }

        this.filteredWatchlist = filtered;
        this.renderMovies();
        this.updateResultsInfo();
    }

    renderMovies() {
        const grid = this.elements.moviesGrid;
        if (!grid) return;
        
        grid.innerHTML = '';
        
        if (this.filteredWatchlist.length === 0) {
            this.showEmptyState();
            return;
        }
        
        this.hideEmptyState();
        
        this.filteredWatchlist.forEach(item => {
            const card = this.createMovieCard(item);
            grid.appendChild(card);
        });
        
        // Add event listeners
        this.attachCardEventListeners();
    }

    createMovieCard(item) {
        // Transform watchlist item to movie data format for MovieCard
        const movieData = {
            movie: {
                kinopoiskId: item.movieId,
                name: item.movieTitle,
                posterUrl: item.posterPath,
                year: item.releaseYear,
                genres: item.genres || [],
                description: item.description || '',
                kpRating: item.kpRating || 0,
                imdbRating: item.imdbRating || 0
            },
            movieId: item.movieId,
            averageRating: item.avgRating || 0,
            ratingsCount: item.ratingsCount || 0,
            rating: 0  // Watchlist items are not rated yet
        };

        // Use the new MovieCard component - no ratings yet, simple card
        const card = MovieCard.create(movieData, {
            showFavorite: false,
            showWatchlist: false,  // Don't show watchlist button since already in watchlist
            showUserInfo: false,
            showEditRating: false,
            showAddToCollection: false,
            showThreeDotMenu: true,
            showRemoveFromWatchlist: true,
            showAverageRating: false // Don't show average rating in watchlist
        });

        // Add watchlist-specific data attributes
        card.setAttribute('data-watchlist-id', item.id || item.movieId);
        card.setAttribute('data-added-at', item.addedAt?.toDate?.().toISOString() || '');

        return card;
    }

    attachCardEventListeners() {
        const grid = this.elements.moviesGrid;
        if (!grid) return;

        // Add event listeners using event delegation for MovieCard actions
        grid.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            
            const action = target.getAttribute('data-action');
            const movieId = target.getAttribute('data-movie-id');
            
            switch (action) {
                case 'view-details':
                    if (movieId) {
                        const url = chrome.runtime.getURL(`src/pages/search/search.html?movieId=${movieId}`);
                        window.location.href = url;
                    }
                    break;
                case 'remove-from-watchlist':
                    if (movieId) {
                        if (confirm('Вы уверены, что хотите удалить этот фильм из списка просмотра?')) {
                            this.removeFromWatchlist(movieId);
                        }
                    }
                    break;
            }
        });
    }

    async removeFromWatchlist(movieId) {
        if (!this.currentUser) return;

        try {
            const watchlistService = firebaseManager.getWatchlistService();
            await watchlistService.removeFromWatchlist(this.currentUser.uid, movieId);
            
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Удалено из Watchlist', 'success');
            }
            
            // Reload watchlist
            await this.loadWatchlist();
            
            // Update count in navigation
            if (window.navigation && typeof window.navigation.updateWatchlistCount === 'function') {
                await window.navigation.updateWatchlistCount();
            }
        } catch (error) {
            console.error('Error removing from watchlist:', error);
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Ошибка при удалении из Watchlist', 'error');
            }
        }
    }

    async showRatingModal(movieData) {
        if (!this.elements.ratingModal) return;

        this.currentRatingMovie = movieData;
        
        // Set movie info
        if (this.elements.movieRatingInfo) {
            const posterUrl = movieData.posterPath || '/icons/icon48.png';
            const title = movieData.movieTitle || 'Unknown Movie';
            const year = movieData.releaseYear || '';
            
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

        // Reset form
        if (this.elements.ratingSlider) {
            this.elements.ratingSlider.value = 5;
        }
        if (this.elements.ratingValue) {
            this.elements.ratingValue.textContent = '5';
        }
        if (this.elements.ratingComment) {
            this.elements.ratingComment.value = '';
        }
        if (this.elements.charCount) {
            this.elements.charCount.textContent = '0';
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

            const ratingService = firebaseManager.getRatingService();
            const user = this.currentUser;
            
            await ratingService.addOrUpdateRating(
                user.uid,
                user.displayName || user.email || 'User',
                user.photoURL || '',
                this.currentRatingMovie.movieId,
                rating,
                comment,
                {
                    kinopoiskId: this.currentRatingMovie.movieId,
                    name: this.currentRatingMovie.movieTitle,
                    posterUrl: this.currentRatingMovie.posterPath,
                    year: this.currentRatingMovie.releaseYear,
                    genres: this.currentRatingMovie.genres || []
                }
            );

            // Remove from watchlist after rating
            const watchlistService = firebaseManager.getWatchlistService();
            await watchlistService.removeFromWatchlist(this.currentUser.uid, this.currentRatingMovie.movieId);

            if (typeof Utils !== 'undefined') {
                Utils.showToast('Фильм добавлен в вашу коллекцию', 'success');
            }

            this.closeRatingModal();
            
            // Reload watchlist
            await this.loadWatchlist();
            
            // Update count in navigation
            if (window.navigation && typeof window.navigation.updateWatchlistCount === 'function') {
                await window.navigation.updateWatchlistCount();
            }
        } catch (error) {
            console.error('Error saving rating:', error);
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Ошибка при сохранении оценки', 'error');
            }
        }
    }

    updateResultsInfo() {
        if (!this.elements.resultsCount) return;

        const count = this.filteredWatchlist.length;
        const total = this.watchlist.length;
        
        if (this.filters.search) {
            this.elements.resultsCount.textContent = `Found ${count} of ${total} movies`;
        } else {
            this.elements.resultsCount.textContent = `${total} movie${total !== 1 ? 's' : ''} in watchlist`;
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

// Initialize watchlist page manager when DOM is loaded
let watchlistPage;
document.addEventListener('DOMContentLoaded', () => {
    watchlistPage = new WatchlistPageManager();
});

