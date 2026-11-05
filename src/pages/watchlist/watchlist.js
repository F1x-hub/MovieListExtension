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
        this.initializeSortControl();
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
        };
    }

    initializeSortControl() {
        this.sortControl = SortControl.enhance(this.elements.sortFilter);
        this.elements.sortFilter?.addEventListener('change', (event) => {
            this.filters.sort = event.target.value;
            this.applyFilters();
        });
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
            this.elements.retryBtn.addEventListener('mousedown', () => {
                this.loadWatchlist();
            });
        }
    }

    async setupFirebase() {
        if (typeof firebaseManager === 'undefined') {
            throw new Error('Firebase Manager not available');
        }

        await firebaseManager.waitForAuthReady();
        this.currentUser = firebaseManager.getCurrentUser();

        // Listen for cross-tab auth state changes
        window.addEventListener('authStateChanged', async (e) => {
            const user = e.detail?.user;
            if (!user) {
                this.currentUser = null;
                this.watchlist = [];
                this.filteredWatchlist = [];
                this.renderWatchlist();
                this.showError('Для просмотра списка "Буду смотреть" необходимо войти в аккаунт.');
            } else if (!this.currentUser || this.currentUser.uid !== user.uid) {
                this.currentUser = user;
                await this.loadWatchlist();
            }
        });
    }

    async loadWatchlist() {
        if (!this.currentUser) {
            this.showError('Для просмотра списка "Буду смотреть" необходимо войти в аккаунт.');
            return;
        }

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

            const movieCacheService = firebaseManager.getMovieCacheService();
            const movieIds = this.watchlist.map(item => item.movieId).filter(Boolean);
            const cachedMovies = await movieCacheService.getBatchCachedMovies(movieIds);
            this.watchlist = this.watchlist.map(item => {
                const cachedMovie = cachedMovies[item.movieId];
                if (!cachedMovie) return item;
                return {
                    ...item,
                    kpRating: cachedMovie.kpRating ?? item.kpRating,
                    imdbRating: cachedMovie.imdbRating ?? item.imdbRating,
                    votes: { ...(item.votes || {}), ...(cachedMovie.votes || {}) }
                };
            });

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
                imdbRating: item.imdbRating || 0,
                votes: item.votes || {}
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
        grid.addEventListener('mousedown', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            
            const action = target.getAttribute('data-action');
            const movieId = target.getAttribute('data-movie-id');
            
            switch (action) {
                case 'view-details':
                    if (movieId) {
                        const url = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`);
                        window.location.href = url;
                    }
                    break;
                case 'remove-from-watchlist':
                    if (movieId) {
                        ConfirmDialog.confirm({
                            title: 'Убрать из «Буду смотреть»?',
                            message: 'Фильм пропадёт из списка просмотра.',
                            confirmLabel: 'Убрать',
                            danger: true
                        }).then(confirmed => {
                            if (confirmed) this.removeFromWatchlist(movieId);
                        });
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

}

// Initialize watchlist page manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new WatchlistPageManager();
});
