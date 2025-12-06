class CollectionPageManager {
    constructor() {
        this.collectionId = null;
        this.collection = null;
        this.filters = {
            search: '',
            sort: 'date-desc'
        };
        this.movies = [];
        this.filteredMovies = [];
        this.currentUser = null;
        this.isLoading = false;
        this.collectionService = null;
        
        this.init();
    }

    async init() {
        this.initializeElements();
        this.initializeCustomDropdowns();
        this.setupEventListeners();
        this.initializeCollectionService();
        
        const urlParams = new URLSearchParams(window.location.search);
        const collectionId = urlParams.get('id');
        
        if (!collectionId) {
            this.showError('Collection ID is required');
            return;
        }
        
        this.collectionId = collectionId;
        
        await this.setupFirebase();
        await this.loadCollection();
    }

    initializeElements() {
        this.elements = {
            collectionHeader: document.getElementById('collectionHeader'),
            collectionIcon: document.getElementById('collectionIcon'),
            collectionTitle: document.getElementById('collectionTitle'),
            collectionCount: document.getElementById('collectionCount'),
            editCollectionBtn: document.getElementById('editCollectionBtn'),
            deleteCollectionBtn: document.getElementById('deleteCollectionBtn'),
            
            collectionSearchInput: document.getElementById('collectionSearchInput'),
            searchLabel: document.getElementById('searchLabel'),
            sortFilter: document.getElementById('sortFilter'),
            clearFiltersBtn: document.getElementById('clearFiltersBtn'),
            
            loadingSection: document.getElementById('loadingSection'),
            moviesGrid: document.getElementById('moviesGrid'),
            emptyState: document.getElementById('emptyState'),
            emptyStateIcon: document.getElementById('emptyStateIcon'),
            emptyStateText: document.getElementById('emptyStateText'),
            errorState: document.getElementById('errorState'),
            retryBtn: document.getElementById('retryBtn'),
            
            resultsCount: document.getElementById('resultsCount'),
            
            deleteCollectionModal: document.getElementById('deleteCollectionModal'),
            deleteModalClose: document.getElementById('deleteModalClose'),
            cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
            confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
            deleteCollectionName: document.getElementById('deleteCollectionName')
        };
    }

    initializeCollectionService() {
        if (typeof CollectionService !== 'undefined') {
            this.collectionService = new CollectionService();
        } else {
            setTimeout(() => {
                if (typeof CollectionService !== 'undefined') {
                    this.collectionService = new CollectionService();
                }
            }, 500);
        }
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
        if (this.elements.collectionSearchInput) {
            this.elements.collectionSearchInput.addEventListener('input', (e) => {
                this.filters.search = e.target.value.trim();
                this.applyFilters();
            });
        }

        if (this.elements.clearFiltersBtn) {
            this.elements.clearFiltersBtn.addEventListener('click', () => {
                this.clearFilters();
            });
        }

        if (this.elements.editCollectionBtn) {
            this.elements.editCollectionBtn.addEventListener('click', () => {
                this.editCollection();
            });
        }

        if (this.elements.deleteCollectionBtn) {
            this.elements.deleteCollectionBtn.addEventListener('click', () => {
                this.showDeleteConfirmation();
            });
        }

        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('click', () => {
                this.loadCollection();
            });
        }

        if (this.elements.deleteModalClose) {
            this.elements.deleteModalClose.addEventListener('click', () => {
                this.closeDeleteModal();
            });
        }

        if (this.elements.cancelDeleteBtn) {
            this.elements.cancelDeleteBtn.addEventListener('click', () => {
                this.closeDeleteModal();
            });
        }

        if (this.elements.confirmDeleteBtn) {
            this.elements.confirmDeleteBtn.addEventListener('click', () => {
                this.confirmDeleteCollection();
            });
        }

        if (this.elements.deleteCollectionModal) {
            this.elements.deleteCollectionModal.addEventListener('click', (e) => {
                if (e.target === this.elements.deleteCollectionModal) {
                    this.closeDeleteModal();
                }
            });
        }

        this.setupStorageListener();
    }

    setupStorageListener() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, namespace) => {
                if (namespace === 'local' && changes.movieCollections && this.collectionId) {
                    this.loadCollection();
                }
            });
        }
    }

    async setupFirebase() {
        try {
            let attempts = 0;
            while (typeof firebaseManager === 'undefined' && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            
            if (typeof firebaseManager !== 'undefined') {
                await firebaseManager.init();
                await firebaseManager.waitForAuthReady();
                
                const currentUser = firebaseManager.getCurrentUser();
                
                if (currentUser) {
                    this.currentUser = currentUser;
                }
                
                if (!this.currentUser) {
                    setTimeout(() => {
                        const retryUser = firebaseManager.getCurrentUser();
                        if (retryUser) {
                            this.currentUser = retryUser;
                        } else {
                            window.location.href = chrome.runtime.getURL('src/popup/popup.html');
                        }
                    }, 2000);
                }
            } else {
                this.showError('Failed to initialize Firebase');
            }
        } catch (error) {
            console.error('Error setting up Firebase:', error);
            this.showError(`Firebase setup failed: ${error.message}`);
        }
    }

    async loadCollection() {
        if (!this.collectionId || !this.collectionService) {
            if (!this.collectionService) {
                this.initializeCollectionService();
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            if (!this.collectionService) {
                this.showError('Collection service not available');
                return;
            }
        }

        if (this.isLoading || !this.currentUser) {
            return;
        }
        
        this.isLoading = true;
        this.showLoading(true);
        this.hideError();
        
        try {
            this.collection = await this.collectionService.getCollection(this.collectionId);
            
            if (!this.collection) {
                this.showError('Collection not found');
                return;
            }
            
            this.updateCollectionHeader();
            await this.loadMovies();
            
        } catch (error) {
            console.error('Error loading collection:', error);
            this.showError(`Failed to load collection: ${error.message}`);
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }

    updateCollectionHeader() {
        if (!this.collection) return;
        
        if (this.elements.collectionIcon) {
            const icon = this.collection.icon || '🎬';
            const isCustomIcon = icon.startsWith('data:') || icon.startsWith('https://') || icon.startsWith('http://');
            
            if (isCustomIcon) {
                this.elements.collectionIcon.innerHTML = `<img src="${icon}" style="width: 32px; height: 32px; object-fit: cover; border-radius: 6px;" alt="Collection icon">`;
            } else {
                this.elements.collectionIcon.textContent = icon;
            }
        }
        
        if (this.elements.collectionTitle) {
            this.elements.collectionTitle.textContent = this.collection.name || 'Collection';
        }
        
        if (this.elements.collectionCount) {
            const count = this.collection.movieIds?.length || 0;
            this.elements.collectionCount.textContent = `${count} фильмов в коллекции`;
        }
        
        if (this.elements.searchLabel) {
            this.elements.searchLabel.textContent = `Search in ${this.collection.name}`;
        }
        
        document.title = `${this.collection.name} - Movie Rating Extension`;
    }

    async loadMovies() {
        if (!this.collection || !this.currentUser) return;
        
        try {
            const movieIds = this.collection.movieIds || [];
            
            if (movieIds.length === 0) {
                this.movies = [];
                this.applyFilters();
                return;
            }
            
            const ratingService = firebaseManager.getRatingService();
            const movieCacheService = firebaseManager.getMovieCacheService();
            const kinopoiskService = firebaseManager.getKinopoiskService();
            
            const ratings = await ratingService.getUserRatingsByMovieIds(this.currentUser.uid, movieIds);
            const averageRatings = await ratingService.getBatchMovieAverageRatings(movieIds);
            const cachedMovies = await movieCacheService.getBatchCachedMovies(movieIds);
            
            this.movies = [];
            
            for (const rating of ratings) {
                try {
                    let movieData = cachedMovies[rating.movieId];
                    
                    if (!movieData) {
                        try {
                            movieData = await kinopoiskService.getMovieById(rating.movieId);
                            if (movieData) {
                                await movieCacheService.cacheMovie(movieData, true);
                            }
                        } catch (fetchError) {
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
                    
                    const averageData = averageRatings[rating.movieId] || { average: 0, count: 0 };
                    
                    this.movies.push({
                        ...rating,
                        movie: movieData,
                        averageRating: averageData.average,
                        ratingsCount: averageData.count
                    });
                } catch (error) {
                    console.error('Error enriching rating:', error);
                    const averageData = averageRatings[rating.movieId] || { average: 0, count: 0 };
                    this.movies.push({
                        ...rating,
                        movie: {
                            kinopoiskId: rating.movieId,
                            name: 'Unknown Movie',
                            year: '',
                            genres: [],
                            description: '',
                            posterUrl: ''
                        },
                        averageRating: averageData.average,
                        ratingsCount: averageData.count
                    });
                }
            }
            
            this.applyFilters();
            
        } catch (error) {
            console.error('Error loading movies:', error);
            this.showError(`Failed to load movies: ${error.message}`);
        }
    }

    applyFilters() {
        let filtered = [...this.movies];
        
        if (this.filters.search) {
            const searchTerm = this.filters.search.toLowerCase();
            filtered = filtered.filter(movie => 
                movie.movie?.name?.toLowerCase().includes(searchTerm)
            );
        }
        
        const [sortBy, order] = this.filters.sort.split('-');
        filtered.sort((a, b) => {
            let valueA, valueB;
            
            switch (sortBy) {
                case 'date':
                    valueA = a.createdAt?.toDate?.() || new Date(a.createdAt) || new Date(0);
                    valueB = b.createdAt?.toDate?.() || new Date(b.createdAt) || new Date(0);
                    break;
                case 'title':
                    valueA = a.movie?.name?.toLowerCase() || '';
                    valueB = b.movie?.name?.toLowerCase() || '';
                    break;
                case 'rating':
                    valueA = a.rating || 0;
                    valueB = b.rating || 0;
                    break;
                case 'year':
                    valueA = a.movie?.year || 0;
                    valueB = b.movie?.year || 0;
                    break;
                default:
                    return 0;
            }
            
            if (order === 'desc') {
                return valueA > valueB ? -1 : valueA < valueB ? 1 : 0;
            } else {
                return valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
            }
        });
        
        this.filteredMovies = filtered;
        this.renderMovies();
        this.updateResultsInfo();
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
        
        this.attachCardEventListeners();
    }

    createMovieCard(movieData) {
        const { movie, rating, averageRating, ratingsCount } = movieData;
        
        const card = document.createElement('div');
        card.className = 'movie-card fade-in';
        
        const posterUrl = movie?.posterUrl || '/icons/icon48.png';
        const title = movie?.name || 'Unknown Movie';
        const year = movie?.year || '';
        const genres = movie?.genres?.slice(0, 3) || [];
        const userRating = rating || 0;
        const avgRatingValue = averageRating || 0;
        const ratingsCountValue = ratingsCount || 0;
        
        card.innerHTML = `
            <div class="movie-poster-container">
                <img src="${posterUrl}" alt="${title}" class="movie-poster" onerror="this.src='/icons/icon48.png'">
                <button class="remove-from-collection-btn" data-movie-id="${movie?.kinopoiskId}" title="Удалить из коллекции">
                    ❌
                </button>
            </div>
            <div class="movie-content">
                <h3 class="movie-title">${this.escapeHtml(title)}</h3>
                <div class="movie-meta">${year}${year && genres.length ? ' • ' : ''}${genres.join(', ')}</div>
                
                ${genres.length > 0 ? `
                    <div class="movie-genres">
                        ${genres.map(genre => `<span class="genre-tag">${genre}</span>`).join('')}
                    </div>
                ` : ''}
                
                <div class="movie-ratings">
                    <div class="rating-item">
                        <div class="rating-label">My Rating</div>
                        <div class="rating-value my-rating">⭐ ${userRating}/10</div>
                    </div>
                    <div class="rating-item">
                        <div class="rating-label">Avg Rating</div>
                        <div class="rating-value avg-rating">${ratingsCountValue > 0 ? avgRatingValue.toFixed(1) : 'N/A'}${ratingsCountValue > 0 ? '/10' : ''}</div>
                    </div>
                </div>
                
                <div class="movie-actions">
                    <button class="action-btn btn-primary" data-movie-id="${movie?.kinopoiskId}">
                        👁️ View Details
                    </button>
                </div>
            </div>
        `;
        
        return card;
    }

    attachCardEventListeners() {
        const grid = this.elements.moviesGrid;
        if (!grid) return;

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

        grid.querySelectorAll('.remove-from-collection-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                e.stopPropagation();
                const movieId = parseInt(button.getAttribute('data-movie-id'));
                if (movieId) {
                    await this.removeMovieFromCollection(movieId, button);
                }
            });
        });
    }

    async removeMovieFromCollection(movieId, buttonElement) {
        if (!this.collectionService || !this.collectionId) return;

        try {
            if (buttonElement) {
                buttonElement.classList.add('animating');
                setTimeout(() => {
                    buttonElement.classList.remove('animating');
                }, 300);
            }

            await this.collectionService.removeMovieFromCollection(this.collectionId, movieId);
            
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Фильм удален из коллекции', 'success');
            }
            
            await this.loadCollection();
            
            if (window.navigation && window.navigation.loadCustomCollections) {
                await window.navigation.loadCustomCollections();
            }
        } catch (error) {
            console.error('Error removing movie from collection:', error);
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Ошибка при удалении фильма', 'error');
            }
        }
    }

    editCollection() {
        if (window.navigation && window.navigation.showCollectionModal) {
            window.navigation.showCollectionModal(this.collection);
        }
    }

    showDeleteConfirmation() {
        if (!this.elements.deleteCollectionModal || !this.collection) return;
        
        if (this.elements.deleteCollectionName) {
            this.elements.deleteCollectionName.textContent = this.collection.name;
        }
        
        this.elements.deleteCollectionModal.style.display = 'flex';
    }

    closeDeleteModal() {
        if (this.elements.deleteCollectionModal) {
            this.elements.deleteCollectionModal.style.display = 'none';
        }
    }

    async confirmDeleteCollection() {
        if (!this.collectionService || !this.collectionId) return;

        try {
            await this.collectionService.deleteCollection(this.collectionId);
            
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Коллекция удалена', 'success');
            }
            
            this.closeDeleteModal();
            
            if (window.navigation && window.navigation.loadCustomCollections) {
                await window.navigation.loadCustomCollections();
            }
            
            window.location.href = chrome.runtime.getURL('src/pages/ratings/ratings.html');
        } catch (error) {
            console.error('Error deleting collection:', error);
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Ошибка при удалении коллекции', 'error');
            }
        }
    }

    clearFilters() {
        this.filters.search = '';
        this.filters.sort = 'date-desc';
        
        if (this.elements.collectionSearchInput) {
            this.elements.collectionSearchInput.value = '';
        }
        
        if (this.elements.sortFilter) {
            this.elements.sortFilter.value = 'date-desc';
            this.updateDropdownValue('sortFilter', 'date-desc');
        }
        
        this.applyFilters();
    }

    updateDropdownValue(dropdownId, value) {
        const dropdown = this.dropdowns[dropdownId];
        if (!dropdown) return;
        
        const options = dropdown.list.querySelectorAll('.dropdown-option');
        let selectedText = '';
        
        options.forEach(option => {
            option.classList.remove('selected');
            if (option.getAttribute('data-value') === value) {
                option.classList.add('selected');
                selectedText = option.textContent.trim();
            }
        });
        
        if (selectedText) {
            const valueElement = dropdown.trigger.querySelector('.dropdown-value');
            if (valueElement) {
                valueElement.textContent = selectedText;
            }
        }
        
        if (dropdown.hiddenSelect) {
            dropdown.hiddenSelect.value = value;
        }
    }

    updateResultsInfo() {
        const count = this.filteredMovies.length;
        const total = this.movies.length;
        
        if (this.elements.resultsCount) {
            this.elements.resultsCount.textContent = `Showing ${count} of ${total} movies`;
        }
    }

    showLoading(show) {
        if (this.elements.loadingSection) {
            this.elements.loadingSection.style.display = show ? 'block' : 'none';
        }
        if (this.elements.moviesGrid) {
            this.elements.moviesGrid.style.display = show ? 'none' : 'grid';
        }
    }

    showEmptyState() {
        if (this.elements.emptyState) {
            this.elements.emptyState.style.display = 'block';
        }
        if (this.elements.moviesGrid) {
            this.elements.moviesGrid.style.display = 'none';
        }
        if (this.collection && this.elements.emptyStateText) {
            this.elements.emptyStateText.textContent = `Начните добавлять фильмы в "${this.collection.name}"`;
        }
        if (this.collection && this.elements.emptyStateIcon) {
            const icon = this.collection.icon || '🎬';
            const isCustomIcon = icon.startsWith('data:') || icon.startsWith('https://') || icon.startsWith('http://');
            
            if (isCustomIcon) {
                this.elements.emptyStateIcon.innerHTML = `<img src="${icon}" style="width: 48px; height: 48px; object-fit: cover; border-radius: 8px;" alt="Collection icon">`;
            } else {
                this.elements.emptyStateIcon.textContent = icon;
            }
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
            this.elements.errorState.style.display = 'block';
        }
        if (this.elements.loadingSection) {
            this.elements.loadingSection.style.display = 'none';
        }
        if (this.elements.moviesGrid) {
            this.elements.moviesGrid.style.display = 'none';
        }
        const errorMessage = document.getElementById('errorMessage');
        if (errorMessage) {
            errorMessage.textContent = message;
        }
    }

    hideError() {
        if (this.elements.errorState) {
            this.elements.errorState.style.display = 'none';
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.collectionPage = new CollectionPageManager();
});
