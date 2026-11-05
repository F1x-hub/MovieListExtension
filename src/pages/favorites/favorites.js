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
        this.watchingProgressMap = {}; // Map to store progress by movieId
        this.currentUser = null;
        this.isLoading = false;
        
        this.init();
    }

    async init() {
        this.initializeElements();
        this.initializeSortControl();
        this.setupEventListeners();
        
        await this.setupFirebase();
        await this.loadWatchingProgress(); // Load progress before rendering
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
        };

        // UI State Manager
        this.page = Utils.createPageStateManager({
            loader: this.elements.loadingSection,
            errorScreen: this.elements.errorState,
            errorMessage: document.getElementById('errorMessage'),
            contentContainer: this.elements.moviesGrid
        });
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
        if (this.elements.favoritesSearchInput) {
            this.elements.favoritesSearchInput.addEventListener('input', (e) => {
                this.filters.search = e.target.value.trim();
                this.applyFilters();
            });
        }

        // Retry button
        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('mousedown', () => {
                this.loadFavorites();
            });
        }

        // Limit Modal
        this.setupLimitModal();

    }

    setupLimitModal() {
        if (!this.elements.limitModal) return;

        // Close modal
        if (this.elements.limitModalClose) {
            this.elements.limitModalClose.addEventListener('mousedown', () => {
                this.closeLimitModal();
            });
        }

        if (this.elements.cancelLimitBtn) {
            this.elements.cancelLimitBtn.addEventListener('mousedown', () => {
                this.closeLimitModal();
            });
        }

        if (this.elements.manageFavoritesBtn) {
            this.elements.manageFavoritesBtn.addEventListener('mousedown', () => {
                this.closeLimitModal();
                // Already on favorites page, just scroll to top
                window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
            });
        }

        // Close on overlay click
        this.elements.limitModal.addEventListener('mousedown', (e) => {
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
                this.favorites = [];
                this.filteredFavorites = [];
                this.renderFavorites();
                this.page.showError('Для просмотра избранного необходимо войти в аккаунт.');
            } else if (!this.currentUser || this.currentUser.uid !== user.uid) {
                this.currentUser = user;
                await this.loadFavorites();
            }
        });
    }

    async loadFavorites() {
        if (!this.currentUser) {
            this.page.showError('Для просмотра избранного необходимо войти в аккаунт.');
            return;
        }

        try {
            this.page.showLoader();

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
                        ratingsCount: avgData.count,
                        isFavorite: true
                    });
                } catch (error) {
                    console.warn(`Failed to load movie data for ${favorite.movieId}:`, error);
                    const avgData = averageRatings[favorite.movieId] || { average: 0, count: 0 };
                    this.favorites.push({
                        ...favorite,
                        movie: null,
                        averageRating: avgData.average,
                        ratingsCount: avgData.count,
                        isFavorite: true
                    });
                }
            }

            // Update count display
            const count = this.favorites.length;
            if (this.elements.favoritesCurrentCount) {
                this.elements.favoritesCurrentCount.textContent = count;
            }

            this.applyFilters();
            this.page.showContent();
        } catch (error) {
            console.error('Error loading favorites:', error);
            this.page.showError('Failed to load favorites. Please try again.');
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
        const card = MovieCard.create(favorite, {
            showFavorite: true,  // Show favorite toggle (to remove from favorites)
            showWatchlist: false,
            showUserInfo: false,
            showAddToCollection: false,
            showThreeDotMenu: true,
            animeStyle: true, // Use anime style for favorites
            watchingProgress: this.getFormattedProgress(favorite.kinopoiskId)
        });
        
        return card;
    }

    attachCardEventListeners() {
        const grid = this.elements.moviesGrid;
        if (!grid) return;

        // Use centralized delegation for new cards
        Utils.bindMovieCardNavigation(grid);
        Utils.bindTabsAndMenus(grid);
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

    // Local showLoading/showError removed in favor of this.page (PageStateManager)

    formatDate(date) {
        const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        const day = date.getDate();
        const month = months[date.getMonth()];
        const year = date.getFullYear();
        return `${day} ${month} ${year}`;
    }

    async handleMigration() {
        if (!this.migrationTool) {
             if (typeof MigrationTool !== 'undefined') {
                 this.migrationTool = new MigrationTool(firebaseManager);
             } else {
                 (window.ConfirmDialog ? window.ConfirmDialog.alert({ message: 'Migration tool not loaded. Please refresh the page.' }) : window.alert('Migration tool not loaded. Please refresh the page.'));
                 return;
             }
        }

        const btn = document.getElementById('runMigrationBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Migrating...';
        }

        try {
            const user = firebaseManager.getCurrentUser();
            if (!user) {
                throw new Error('You must be logged in to migrate.');
            }

            const result = await this.migrationTool.migrateFavoritesForUser(user.uid);
            
            if (result.count > 0) {
                await (window.ConfirmDialog ? window.ConfirmDialog.alert({ message: `Successfully migrated ${result.count} favorites! The page will reload.` }) : window.alert(`Successfully migrated ${result.count} favorites! The page will reload.`));
                window.location.reload();
            } else {
                (window.ConfirmDialog ? window.ConfirmDialog.alert({ message: 'No old favorites found to migrate.' }) : window.alert('No old favorites found to migrate.'));
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'No data found';
                }
            }
        } catch (error) {
            console.error('Migration error:', error);
            (window.ConfirmDialog ? window.ConfirmDialog.alert({ message: `Migration failed: ${error.message}` }) : window.alert(`Migration failed: ${error.message}`));
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Retry Migration';
            }
        }
    }

    async loadWatchingProgress() {
        return new Promise((resolve) => {
            chrome.storage.local.get(null, (items) => {
                this.watchingProgressMap = {};
                
                Object.keys(items).forEach(key => {
                    if (key.startsWith('watching_progress_')) {
                        const movieId = parseInt(key.replace('watching_progress_', ''));
                        if (movieId) {
                            this.watchingProgressMap[movieId] = items[key];
                        }
                    }
                });
                
                resolve();
            });
        });
    }

    getFormattedProgress(movieId) {
        const progress = this.watchingProgressMap[movieId];
        
        if (!progress) {
            return null;
        }
        
        // For TV series: show season and episode
        if (progress.season || progress.episode) {
            // Check if values are already formatted (contain text) or are numbers
            const seasonIsNumber = typeof progress.season === 'number' || /^\d+$/.test(progress.season);
            const episodeIsNumber = typeof progress.episode === 'number' || /^\d+$/.test(progress.episode);
            
            let label = '';
            if (progress.season) {
                label += seasonIsNumber ? `${progress.season} сезон` : progress.season;
            }
            if (progress.season && progress.episode) label += ', ';
            if (progress.episode) {
                label += episodeIsNumber ? `${progress.episode} серия` : progress.episode;
            }
            return label;
        }
        
        // For movies: show timestamp
        if (progress.timestamp) {
            return this.formatTimestamp(progress.timestamp);
        }
        
        return null;
    }

    formatTimestamp(seconds) {
        if (!seconds || seconds < 0) return null;
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        // Format as H:MM:SS
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
}

// Initialize favorites page manager when DOM is loaded
let favoritesPage;
document.addEventListener('DOMContentLoaded', () => {
    favoritesPage = new FavoritesPageManager();
});

// Bind migration button
document.addEventListener('mousedown', (e) => {
    if (e.target && e.target.id === 'runMigrationBtn') {
        if (favoritesPage) {
            favoritesPage.handleMigration();
        }
    }
});

