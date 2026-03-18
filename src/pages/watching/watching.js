/**
 * Watching Page Manager
 * Handles the Currently Watching page functionality
 */
class WatchingPageManager {
    constructor() {
        this.filters = {
            search: '',
            sort: 'addedAt-desc'
        };
        this.watchingList = [];
        this.filteredWatchingList = [];
        this.watchingProgressMap = {}; // Map to store progress by movieId
        this.currentUser = null;
        this.isLoading = false;
        
        this.init();
    }

    async init() {
        this.initializeElements();
        this.initializeCustomDropdowns();
        this.setupEventListeners();
        
        await this.setupFirebase();
        await this.loadWatchingList();
    }

    initializeElements() {
        this.elements = {
            // Filters
            watchingSearchInput: document.getElementById('watchingSearchInput'),
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
            
            trigger.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this.toggleDropdown(dropdownId);
            });
            
            options.forEach(option => {
                option.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    const value = option.getAttribute('data-value');
                    const text = option.textContent.trim();
                    this.selectDropdownOption(dropdownId, value, text);
                });
            });
        });
        
        document.addEventListener('mousedown', (e) => {
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
        if (this.elements.watchingSearchInput) {
            this.elements.watchingSearchInput.addEventListener('input', (e) => {
                this.filters.search = e.target.value.trim();
                this.applyFilters();
            });
        }

        // Retry button
        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('mousedown', () => {
                this.loadWatchingList();
            });
        }

        // Rating modal
        this.setupRatingModal();
    }

    setupRatingModal() {
        if (!this.elements.ratingModal) return;

        // Close modal
        if (this.elements.ratingModalClose) {
            this.elements.ratingModalClose.addEventListener('mousedown', () => {
                this.closeRatingModal();
            });
        }

        if (this.elements.cancelRatingBtn) {
            this.elements.cancelRatingBtn.addEventListener('mousedown', () => {
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
            this.elements.saveRatingBtn.addEventListener('mousedown', () => {
                this.saveRating();
            });
        }

        // Close on overlay click
        this.elements.ratingModal.addEventListener('mousedown', (e) => {
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

    async loadWatchingList() {
        if (!this.currentUser) return;

        try {
            this.showLoading();
            this.hideError();

            const watchingService = firebaseManager.getWatchingService();
            
            // Parse sort filter
            const [sortBy, order] = this.filters.sort.split('-');
            const sortOrder = order === 'asc' ? 'asc' : 'desc';
            
            this.watchingList = await watchingService.getWatching(
                this.currentUser.uid,
                sortBy,
                sortOrder
            );

            // Load progress data from chrome.storage
            await this.loadWatchingProgress();

            this.applyFilters();
            this.hideLoading();
        } catch (error) {
            console.error('Error loading watching list:', error);
            this.showError('Failed to load watching list. Please try again.');
            this.hideLoading();
        }
    }

    applyFilters() {
        let filtered = [...this.watchingList];

        // Apply search filter
        if (this.filters.search) {
            const searchTerm = this.filters.search.toLowerCase();
            filtered = filtered.filter(item => {
                const title = (item.movieTitle || '').toLowerCase();
                const titleRu = (item.movieTitleRu || '').toLowerCase();
                return title.includes(searchTerm) || titleRu.includes(searchTerm);
            });
        }

        // Apply sort
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

        this.filteredWatchingList = filtered;
        this.renderMovies();
        this.updateResultsInfo();
    }

    renderMovies() {
        const grid = this.elements.moviesGrid;
        if (!grid) return;
        
        grid.innerHTML = '';
        
        if (this.filteredWatchingList.length === 0) {
            this.showEmptyState();
            return;
        }
        
        this.hideEmptyState();
        
        this.filteredWatchingList.forEach(item => {
            const card = this.createMovieCard(item);
            grid.appendChild(card);
        });
        
        // Add event listeners
        this.attachCardEventListeners();
    }

    createMovieCard(item) {
        // Transform watching item to movie data format for MovieCard
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
            rating: 0
        };

        // Use the MovieCard component
        // Note: We might want to add "Remove from Watching" logic here or reuse watchlist/favorites buttons differently
        // For now, I'll rely on the 3-dot menu or custom buttons.
        // There is 'showRemoveFromWatchlist', but no 'showRemoveFromWatching'.
        // I might need to add that later to MovieCard.js or reuse an existing logic
        // or just use data-action in 3-dot menu.
        
        const card = MovieCard.create(movieData, {
            showFavorite: true,
            showWatchlist: true, // Allow adding to watchlist (e.g. move back to plan to watch)
            showUserInfo: false,
            showEditRating: false,
            showAddToCollection: true,
            showThreeDotMenu: true,
            showThreeDotMenu: true,
            showRemoveFromWatchlist: false, // This is watching list, not watchlist
            showRemoveFromWatching: true, // Enable remove button
            watchingProgress: this.getFormattedProgress(item.movieId) // Pass progress string
        });

        // Add watching-specific data attributes
        card.setAttribute('data-watching-id', item.id || item.movieId);
        card.setAttribute('data-added-at', item.addedAt?.toDate?.().toISOString() || '');
        
        // Mark as watching
        card.setAttribute('data-is-watching', 'true');

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
            // Check if there is a remove action for watching we need to handle manually
            // Since MovieCard doesn't have native remove-from-watching yet, we might need to handle it 
            // via a custom button if we added one, or if we use the menu item.
            // But currently MovieCard checks `data-action` which we can intercept.
            
            if (action === 'remove-from-watching') { 
                 if (movieId) {
                    if (confirm('Вы уверены, что хотите удалить этот фильм из списка "Смотрю"?')) {
                        this.removeFromWatching(movieId);
                    }
                }
            } else if (action === 'view-details') {
                if (movieId) {
                    const url = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`);
                    window.location.href = url;
                }
            } else if (action === 'resume-watching') {
                if (movieId) {
                    const url = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}&autoplay=true`);
                    window.location.href = url;
                }
            }
        });
    }

    async removeFromWatching(movieId) {
        if (!this.currentUser) return;

        try {
            const watchingService = firebaseManager.getWatchingService();
            await watchingService.removeFromWatching(this.currentUser.uid, movieId);
            
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Удалено из списка "Смотрю"', 'success');
            }
            
            // Reload list
            await this.loadWatchingList();
            
            // Update count in navigation
            if (window.navigation && typeof window.navigation.updateWatchingCount === 'function') {
                await window.navigation.updateWatchingCount();
            }
        } catch (error) {
            console.error('Error removing from watching:', error);
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Ошибка при удалении', 'error');
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

            // Remove from watching after rating
            const watchingService = firebaseManager.getWatchingService();
            await watchingService.removeFromWatching(this.currentUser.uid, this.currentRatingMovie.movieId);

            if (typeof Utils !== 'undefined') {
                Utils.showToast('Фильм оценен и перемещен в просмотренные!', 'success');
            }

            this.closeRatingModal();
            
            // Reload list
            await this.loadWatchingList();
            
            // Update counts in navigation
            if (window.navigation && typeof window.navigation.updateCounts === 'function') {
                await window.navigation.updateCounts();
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

        const count = this.filteredWatchingList.length;
        const total = this.watchingList.length;
        
        if (this.filters.search) {
            this.elements.resultsCount.textContent = `Found ${count} of ${total} movies`;
        } else {
            this.elements.resultsCount.textContent = `${total} movie${total !== 1 ? 's' : ''} in watching`;
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
        if (!progress) return null;
        
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

// Initialize watching page manager when DOM is loaded
let watchingPage;
document.addEventListener('DOMContentLoaded', () => {
    watchingPage = new WatchingPageManager();
});
