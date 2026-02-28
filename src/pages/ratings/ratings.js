import { i18n } from '../../shared/i18n/I18n.js';

/**
 * Ratings Page Manager
 * Handles the Rated page functionality
 */
class RatingsPageManager {
    static CACHE_KEY_PREFIX = 'ratings_cache_';
    static CACHE_LIFETIME = 7 * 24 * 60 * 60 * 1000; // 7 days

    constructor() {
        this.currentMode = 'all-ratings'; // Always show all ratings
        this.filters = {
            search: '',
            genre: '',
            year: '',
            avgRating: '',
            user: '',
            sort: 'date-desc'
        };
        this.movies = [];
        this.filteredMovies = [];
        this.currentUser = null;
        this.isLoading = false;
        this.allUsers = []; // Store all users who have rated movies
        this.userProfilesMap = new Map(); // Store user profiles for display name formatting
        this.availableCollections = []; // Store for menu
        this.init();
    }

    async init() {
        this.initializeElements();
        
        await i18n.init();
        i18n.translatePage();
        
        // Load cached ratings immediately
        await this.loadCachedRatings();

        this.initializeCustomDropdowns();
        this.setupEventListeners();
        this.loadFiltersFromStorage();
        
        const urlParams = new URLSearchParams(window.location.search);
        const collectionId = urlParams.get('collection');
        if (collectionId) {
            window.location.href = chrome.runtime.getURL(`src/pages/collection/collection.html?id=${collectionId}`);
            return;
        }
        
        // Initialize user filter visibility based on current mode
        this.updateUserFilterVisibility();
        
        await this.setupFirebase();
        
        // Load collections using CollectionService
        if (typeof CollectionService !== 'undefined') {
            this.collectionService = new CollectionService();
            try {
                this.availableCollections = await this.collectionService.getCollections();
            } catch (e) {
                console.error('Error loading collections:', e);
            }
        }
        
        await this.loadMovies();
    }


    initializeElements() {
        this.elements = {
            // Mode toggle removed - always showing all ratings
            myRatingsBtn: null, // Removed
            allRatingsBtn: null, // Removed
            
            // Filters
            movieSearchInput: document.getElementById('movieSearchInput'),
            genreFilter: document.getElementById('genreFilter'),
            yearFilter: document.getElementById('yearFilter'),
            avgRatingFilter: document.getElementById('avgRatingFilter'),
            userFilter: document.getElementById('userFilter'),
            userFilterGroup: document.getElementById('userFilterGroup'),
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
            
            // Rating Modal (new beautiful one from search.html)
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
        
        const valueElement = dropdown.trigger.querySelector('.dropdown-value');
        if (valueElement) {
            valueElement.textContent = text;
        }
        
        if (dropdown.hiddenSelect) {
            dropdown.hiddenSelect.value = value;
            const changeEvent = new Event('change', { bubbles: true });
            dropdown.hiddenSelect.dispatchEvent(changeEvent);
        }
        
        const options = dropdown.list.querySelectorAll('.dropdown-option');
        options.forEach(option => {
            option.classList.remove('selected');
            if (option.getAttribute('data-value') === value) {
                option.classList.add('selected');
            }
        });
        
        this.closeAllDropdowns();
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

    setupEventListeners() {
        // Mode toggle removed - always using all-ratings mode
        // this.elements.myRatingsBtn?.addEventListener('click', () => this.setMode('my-ratings'));
        // this.elements.allRatingsBtn?.addEventListener('click', () => this.setMode('all-ratings'));
        
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
        
        this.elements.avgRatingFilter?.addEventListener('change', (e) => {
            this.filters.avgRating = e.target.value;
            this.applyFilters();
        });
        
        this.elements.userFilter?.addEventListener('change', (e) => {
            this.filters.user = e.target.value;
            this.applyFilters();
        });
        
        this.elements.sortFilter?.addEventListener('change', (e) => {
            this.filters.sort = e.target.value;
            this.applyFilters();
        });
        
        this.elements.clearFiltersBtn?.addEventListener('click', () => this.clearFilters());
        
        // Retry button
        this.elements.retryBtn?.addEventListener('click', () => this.loadMovies());
        
        // Event delegation for Movie Cards (Actions and Edit Rating)
        this.elements.moviesGrid?.addEventListener('click', (e) => {
            // Handle Edit Rating Button (legacy separate button outside menu if exists)
            const editBtn = e.target.closest('.edit-btn');
            if (editBtn) {
                const movieId = parseInt(editBtn.dataset.movieId);
                const rating = parseInt(editBtn.dataset.rating);
                const comment = editBtn.dataset.comment || '';
                this.editRating(movieId, rating, comment);
                return;
            }
            
            // Ignore clicks on user info block (handled in attachGridEventListeners)
            if (e.target.closest('.clickable-username')) return;

            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.dataset.action;
            const movieId = target.dataset.movieId;
            const ratingId = target.dataset.ratingId || target.closest('.movie-card-component')?.dataset.ratingId;

            switch (action) {
                case 'view-details':
                    if (movieId) {
                        window.location.href = `../movie-details/movie-details.html?movieId=${movieId}`;
                    }
                    break;
                case 'toggle-favorite':
                    // Pass current status boolean from data attribute
                    this.toggleFavorite(ratingId || movieId, target.dataset.isFavorite === 'true', target);
                    break;
                case 'toggle-watching':
                    this.handleWatchingToggle(movieId, target);
                    break;
                case 'toggle-watchlist':
                    this.handleWatchlistToggle(movieId, target);
                    break;
                case 'toggle-collection':
                    const collectionId = target.dataset.collectionId;
                    if (collectionId) {
                        this.handleToggleCollection(movieId, collectionId, target);
                    }
                    break;
                 case 'edit-rating':
                     const r = parseInt(target.dataset.rating || 0);
                     const c = target.dataset.comment || '';
                     this.editRating(movieId, r, c);
                     break;
            }
        });
        
        // Modal close buttons
        this.elements.modalClose?.addEventListener('click', () => this.closeModal());
        this.elements.ratingModalClose?.addEventListener('click', () => this.closeRatingModal());
        
        // Rating modal
        this.elements.ratingSlider?.addEventListener('input', (e) => {
            this.elements.ratingValue.textContent = e.target.value;
        });
        
        this.elements.ratingComment?.addEventListener('input', (e) => {
            const count = e.target.value.length;
            this.elements.charCount.textContent = count;
        });
        
        this.elements.saveRatingBtn?.addEventListener('click', () => this.saveRating());
        this.elements.cancelRatingBtn?.addEventListener('click', () => this.closeRatingModal());
        
        // Close modals on background click
        this.elements.movieModal?.addEventListener('click', (e) => {
            if (e.target === this.elements.movieModal) this.closeModal();
        });
        
        this.elements.ratingModal?.addEventListener('click', (e) => {
            if (e.target === this.elements.ratingModal) this.closeRatingModal();
        });
    }

    async setupFirebase() {
        try {
            // Wait for firebaseManager to be available
            let attempts = 0;
            while (typeof firebaseManager === 'undefined' && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            
            if (typeof firebaseManager !== 'undefined') {
                // Check if user is already authenticated
                const currentUser = firebaseManager.getCurrentUser();
                
                if (currentUser) {
                    this.currentUser = currentUser;
                    this.loadMovies();
                }
                
                // Listen for auth state changes via window event (dispatched by firestore.js)
                window.addEventListener('authStateChanged', (e) => {
                    const user = e.detail.user;
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
                        const retryUser = firebaseManager.getCurrentUser();
                        if (retryUser) {
                            this.currentUser = retryUser;
                            this.loadMovies();
                        } else {
                            this.showError('Please sign in to view your collection');
                        }
                    }
                }, 2000);
            } else {
                this.showError('Failed to initialize Firebase');
            }
        } catch (error) {
            console.error('Error setting up Firebase:', error);
            this.showError(`Firebase setup failed: ${error.message}`);
        }
    }

    updateUserFilterVisibility() {
        // Ensure user filter is always visible in all-ratings mode
        if (this.elements.userFilterGroup) {
            this.elements.userFilterGroup.classList.add('visible');
        }
    }

    setMode(mode) {
        this.currentMode = mode;
        
        // Update button states
        this.elements.myRatingsBtn?.classList.toggle('active', mode === 'my-ratings');
        this.elements.allRatingsBtn?.classList.toggle('active', mode === 'all-ratings');
        
        // Show/hide user filter based on mode
        this.updateUserFilterVisibility();
        
        // Reset user filter when switching to my-ratings
        if (mode === 'my-ratings') {
            this.filters.user = '';
            if (this.elements.userFilter) {
                this.elements.userFilter.value = '';
            }
        }
        
        // Save to storage
        localStorage.setItem('ratingsPageMode', mode);
        
        // Reload movies
        this.loadMovies();
    }
    
    async loadCachedRatings() {
        try {
            if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

            // Get user ID
            const userResult = await chrome.storage.local.get(['user']);
            const userId = userResult.user?.uid;
            
            if (!userId) return;

            const cacheKey = `${RatingsPageManager.CACHE_KEY_PREFIX}${userId}`;
            const result = await chrome.storage.local.get([cacheKey]);
            const cache = result[cacheKey];
            
            if (cache && cache.ratings) {
                console.log('RatingsPage: Loaded ratings from cache');
                
                this.allRawRatings = cache.ratings;
                this.allUsers = cache.users || []; // Restore users list if cached
                this.currentUser = { uid: userId }; // Temporary mock for current user
                this.extractAndPopulateUsers(this.allRawRatings);

                // Enrich first batch using LocalStorage immediately
                const firstBatch = this.allRawRatings.slice(0, 6);
                const enrichedStart = this.enrichFromLocalStorage(firstBatch);
                
                if (enrichedStart.length > 0) {
                    this.movies = enrichedStart;
                    this.hasMore = this.allRawRatings.length > 6;
                    this.nextLoadIndex = 6;
                    this.BATCH_SIZE = 6;
                    
                    this.populateYearFilter();
                    this.populateGenreFilter();
                    this.applyFilters();
                    this.showLoading(false); // Ensure loading spinner is hidden
                    
                    // Setup scroll observer if more exist
                    if (this.hasMore) {
                        this.setupInfiniteScroll();
                    }
                }
            }
        } catch (error) {
            console.error('RatingsPage: Error loading cache:', error);
        }
    }
    
    enrichFromLocalStorage(ratings) {
        return ratings.map(rating => {
            let movieData = null;
            try {
                const localKey = `kp_movie_${rating.movieId}`;
                const localData = localStorage.getItem(localKey);
                if (localData) {
                    movieData = JSON.parse(localData);
                }
            } catch (e) {}
            
            const fallbackMovie = {
                kinopoiskId: rating.movieId,
                name: 'Loading...',
                year: '',
                genres: [],
                description: '',
                posterUrl: ''
            };
            
            return {
                ...rating,
                movie: movieData || fallbackMovie,
                averageRating: rating.averageRating || 0, // Fallback
                ratingsCount: rating.ratingsCount || 0
            };
        });
    }

    async saveRatingsToCache(ratings, users) {
        try {
            if (!this.currentUser || !this.currentUser.uid) return;
            
            const cacheKey = `${RatingsPageManager.CACHE_KEY_PREFIX}${this.currentUser.uid}`;
            const cacheData = {
                ratings: ratings,
                users: users,
                timestamp: Date.now()
            };
            
            await chrome.storage.local.set({ [cacheKey]: cacheData });
            console.log('RatingsPage: Saved ratings to cache');
        } catch (e) {
            console.warn('RatingsPage: Failed to save cache', e);
        }
    }

    async loadMovies() {
        if (this.isLoading && !this.loadingMore) {
            return;
        }
        
        
        // If we have content (cache), perform background update without spinner
        const isBackgroundUpdate = this.movies.length > 0;
        
        this.isLoading = true;
        if (!isBackgroundUpdate) {
            this.showLoading(true);
        }
        this.hideError();
        
        // Add a timeout to prevent infinite loading
        const loadingTimeout = setTimeout(() => {
            if (this.isLoading) {
                console.warn('Loading timeout - forcing completion');
                this.isLoading = false;
                this.showLoading(false);
                this.showError('Loading timed out. Please refresh the page.');
            }
        }, 30000); // 30 second timeout
        
        try {
            const ratingService = firebaseManager.getRatingService();
            
            // fetch all ratings (lightweight)
            let ratings = [];
            
            const result = await ratingService.getAllRatings(500);
            ratings = result.ratings;

            // Fix: Fetch average ratings for ALL movies so they get cached
            // The existing flow only fetched them for the visible batch, causing "N/A" on cache load
            try {
                const movieIds = ratings.map(r => r.movieId);
                if (movieIds.length > 0) {
                    const averageRatings = await ratingService.getBatchMovieAverageRatings(movieIds);
                    
                    ratings = ratings.map(rating => {
                        const avg = averageRatings[rating.movieId];
                        // Only update if existing rating doesn't have average (though usually it won't)
                        return {
                            ...rating,
                            averageRating: avg ? avg.average : (rating.averageRating || 0),
                            ratingsCount: avg ? avg.count : (rating.ratingsCount || 0)
                        };
                    });
                }
            } catch (err) {
                console.warn('Failed to pre-fetch average ratings:', err);
                // Continue without averages (will be N/A but at least page loads)
            }            
            // Don't clear this.movies here to avoid flash
            // this.movies = []; 
            this.nextLoadIndex = 0;
            this.BATCH_SIZE = 6;
            this.hasMore = true;

            // Load user profiles if needed
            await this.loadUserProfiles(ratings);
            
            // Prepare new list without clearing existing one immediately (prevents flash)
            this.allRawRatings = ratings;
            this.nextLoadIndex = 0;
            this.BATCH_SIZE = 6;
            this.hasMore = true;

            // Load first batch manually to swap atomicly
            const endIndex = Math.min(this.BATCH_SIZE, this.allRawRatings.length);
            const batch = this.allRawRatings.slice(0, endIndex);
            
            // Enrich
            const enrichedBatch = await this.enrichRatingsWithMovieData(batch);
            await this.enrichWithWatchStatuses(enrichedBatch);
            
            // Swap lists
            this.movies = enrichedBatch;
            this.nextLoadIndex = endIndex;
            this.hasMore = this.nextLoadIndex < this.allRawRatings.length;
            
            // Update filters
            this.populateYearFilter(); 
            this.populateGenreFilter();
            
            // Render
            this.applyFilters();

            // Setup Infinite Scroll
            if (this.hasMore) {
                this.setupInfiniteScroll();
            } else {
                this.removeInfiniteScroll();
            }

            // Extract users for filter
            if (this.currentMode === 'all-ratings') {
                this.extractAndPopulateUsers(ratings);
            }
            
            // Save to cache
            this.saveRatingsToCache(ratings, this.allUsers);
            
            clearTimeout(loadingTimeout);
        } catch (error) {
            console.error('Error loading movies:', error);
            clearTimeout(loadingTimeout);
            this.showError(`Failed to load movies: ${error.message}`);
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }

    async loadNextBatch() {
        if (this.nextLoadIndex >= this.allRawRatings.length) {
            this.hasMore = false;
            return;
        }

        this.loadingMore = true;
        const endIndex = Math.min(this.nextLoadIndex + this.BATCH_SIZE, this.allRawRatings.length);
        const batch = this.allRawRatings.slice(this.nextLoadIndex, endIndex);
        
        // Enrich just this batch
        const enrichedBatch = await this.enrichRatingsWithMovieData(batch);
        
        // Load watching/watchlist statuses for this batch
        await this.enrichWithWatchStatuses(enrichedBatch);
        
        // Append to movies list
        this.movies = [...this.movies, ...enrichedBatch];
        this.nextLoadIndex = endIndex;
        
        // Update filters (year/genre) with NEW data
        this.populateYearFilter(); 
        this.populateGenreFilter();
        
        // Apply filters / Render
        // We need to maintain scroll position, applyFilters calls renderMovies
        this.applyFilters();
        
        this.loadingMore = false;

        // If we still have more, ensure observer is valid
        if (this.nextLoadIndex >= this.allRawRatings.length) {
            this.hasMore = false;
            this.removeInfiniteScroll();
        }
    }

    setupInfiniteScroll() {
        if (this.observer) this.observer.disconnect();

        const options = {
            root: null,
            rootMargin: '100px',
            threshold: 0.1
        };

        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !this.loadingMore && this.hasMore) {
                    this.loadNextBatch();
                }
            });
        }, options);

        // Create or get sentinel
        let sentinel = document.getElementById('scrollSentinel');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.id = 'scrollSentinel';
            sentinel.style.height = '20px';
            sentinel.style.width = '100%';
            // Place sentinel after movies grid
            this.elements.moviesGrid.parentNode.insertBefore(sentinel, this.elements.moviesGrid.nextSibling);
        }
        
        this.observer.observe(sentinel);
    }

    removeInfiniteScroll() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        const sentinel = document.getElementById('scrollSentinel');
        if (sentinel) sentinel.remove();
    }

    async loadUserProfiles(ratings) {
        try {
            const userIds = [...new Set(ratings.map(r => r.userId).filter(Boolean))];
            if (userIds.length === 0) return;
            
            const userService = firebaseManager.getUserService();
            const userProfiles = await userService.getUserProfilesByIds(userIds);
            
            this.userProfilesMap.clear();
            userProfiles.forEach(profile => {
                this.userProfilesMap.set(profile.userId || profile.id, profile);
            });
        } catch (error) {
            console.error('Error loading user profiles:', error);
        }
    }

    async enrichWithWatchStatuses(movies) {
        if (!this.currentUser || movies.length === 0) return;

        try {
            const favoriteService = firebaseManager.getFavoriteService();
            
            // Get all movie IDs
            const movieIds = movies.map(m => m.movie?.kinopoiskId || m.movieId).filter(Boolean);
            
            // Fetch bookmarks for all movies concurrently
            const bookmarkPromises = movieIds.map(id => 
                favoriteService.getBookmark(this.currentUser.uid, id)
                    .catch(err => {
                        console.warn(`Failed to fetch bookmark for ${id}:`, err);
                        return null;
                    })
            );
            
            const bookmarks = await Promise.all(bookmarkPromises);
            
            // Attach statuses to movies
            movies.forEach((movie, index) => {
                const bookmark = bookmarks[index];
                
                // Reset flags
                movie.isWatching = false;
                movie.isInWatchlist = false;
                movie.isFavorite = false;
                movie.status = null;

                if (bookmark) {
                    movie.status = bookmark.status;
                    if (bookmark.status === 'watching') movie.isWatching = true;
                    if (bookmark.status === 'plan_to_watch') movie.isInWatchlist = true;
                    if (bookmark.status === 'favorite') movie.isFavorite = true;
                }
            });
        } catch (error) {
            console.error('Error enriching with watch statuses:', error);
        }
    }

    async enrichRatingsWithMovieData(ratings) {
        console.time('Full Enrichment Process');
        const movieCacheService = firebaseManager.getMovieCacheService();
        const ratingService = firebaseManager.getRatingService();
        const kinopoiskService = firebaseManager.getKinopoiskService();
        
        const enrichedMovies = [];
        let cacheHits = 0;
        let apiHits = 0;
        let failures = 0;
        
        // Step 1: Batch load average ratings for all movies
        console.time('Step 1: Batch Avg Ratings');
        const movieIds = ratings.map(rating => rating.movieId);
        const averageRatings = await ratingService.getBatchMovieAverageRatings(movieIds);
        console.timeEnd('Step 1: Batch Avg Ratings');
        
        // Step 2: Batch load cached movies
        console.time('Step 2: Batch Cache Load');
        const cachedMovies = await movieCacheService.getBatchCachedMovies(movieIds);
        const cachedCount = Object.keys(cachedMovies).length;
        console.log(`Cache stats: Found ${cachedCount} of ${movieIds.length} movies in cache`);
        console.timeEnd('Step 2: Batch Cache Load');
        
        // Step 3: Process ratings with parallel execution (batches of 5)
        console.time('Step 3: Parallel Processing');
        console.log('Starting parallel processing of', ratings.length, 'movies');
        
        // Helper function to process a single rating
        const processRating = async (rating, index) => {
            try {
                let movieData = cachedMovies[rating.movieId];
                
                if (!movieData) {
                    try {
                        // console.log(`Cache miss for ${rating.movieId}, fetching from API... (${index + 1}/${ratings.length})`);
                        // const apiStartTime = performance.now();
                        movieData = await kinopoiskService.getMovieById(rating.movieId);
                        // const apiDuration = performance.now() - apiStartTime;
                        // console.log(`API fetch for ${rating.movieId} took ${apiDuration.toFixed(2)}ms`);
                        
                        if (movieData) {
                            await movieCacheService.cacheMovie(movieData, true);
                            apiHits++;
                        }
                    } catch (fetchError) {
                        console.warn(`Failed to fetch movie ${rating.movieId} from API:`, fetchError);
                        movieData = {
                            kinopoiskId: rating.movieId,
                            name: 'Unknown Movie',
                            year: '',
                            genres: [],
                            description: '',
                            posterUrl: ''
                        };
                        failures++;
                    }
                } else {
                    cacheHits++;
                }
                
                const averageData = averageRatings[rating.movieId] || { average: 0, count: 0 };
                
                return {
                    ...rating,
                    movie: movieData,
                    averageRating: averageData.average,
                    ratingsCount: averageData.count
                };
            } catch (error) {
                console.error('Error enriching rating:', error);
                failures++;
                return {
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
                };
            }
        };

        // Process in batches
        const BATCH_SIZE = 5;
        for (let i = 0; i < ratings.length; i += BATCH_SIZE) {
            const batch = ratings.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map((rating, batchIndex) => 
                processRating(rating, i + batchIndex)
            );
            
            const batchResults = await Promise.all(batchPromises);
            enrichedMovies.push(...batchResults);
        }
        
        console.timeEnd('Step 3: Parallel Processing');
        console.log(`Enrichment Summary:
        - Total: ${ratings.length}
        - Cache Hits: ${cacheHits}
        - API Hits: ${apiHits}
        - Failures: ${failures}`);
        console.timeEnd('Full Enrichment Process');
        
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
            yearFilter.innerHTML = `<option value="">${i18n.get('ratings.filters.all_years')}</option>`;
            
            sortedYears.forEach(year => {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                yearFilter.appendChild(option);
            });
            
            if (this.dropdowns?.yearFilter) {
                const dropdownList = this.dropdowns.yearFilter.list;
                dropdownList.innerHTML = `<div class="dropdown-option" data-value="">${i18n.get('ratings.filters.all_years')}</div>`;
                
                sortedYears.forEach(year => {
                    const option = document.createElement('div');
                    option.className = 'dropdown-option';
                    option.setAttribute('data-value', year);
                    option.textContent = year;
                    option.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.selectDropdownOption('yearFilter', year, year);
                    });
                    dropdownList.appendChild(option);
                });
            }
        }
    }

    populateGenreFilter() {
        const genres = new Set();
        this.movies.forEach(movie => {
            if (movie.movie?.genres && Array.isArray(movie.movie.genres)) {
                movie.movie.genres.forEach(genre => {
                    if (genre) genres.add(genre.trim());
                });
            }
        });
        
        const sortedGenres = Array.from(genres).sort();
        const genreFilter = this.elements.genreFilter;
        
        if (genreFilter) {
            // Preserve current selection if possible
            const currentSelection = this.filters.genre;
            
            genreFilter.innerHTML = `<option value="">${i18n.get('ratings.filters.all_genres')}</option>`;
            
            sortedGenres.forEach(genre => {
                const option = document.createElement('option');
                option.value = genre;
                option.textContent = genre; // Capitalize first letter if needed, but usually fine as is
                genreFilter.appendChild(option);
            });
            
            if (this.dropdowns?.genreFilter) {
                const dropdownList = this.dropdowns.genreFilter.list;
                dropdownList.innerHTML = `<div class="dropdown-option" data-value="">${i18n.get('ratings.filters.all_genres')}</div>`;
                
                sortedGenres.forEach(genre => {
                    const option = document.createElement('div');
                    option.className = 'dropdown-option';
                    option.setAttribute('data-value', genre);
                    option.textContent = genre;
                    option.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.selectDropdownOption('genreFilter', genre, genre);
                    });
                    dropdownList.appendChild(option);
                });
            }
            if (currentSelection && genres.has(currentSelection)) {
                genreFilter.value = currentSelection;
            }

            if (this.dropdowns?.genreFilter) {
                const dropdownList = this.dropdowns.genreFilter.list;
                dropdownList.innerHTML = '<div class="dropdown-option" data-value="">All Genres</div>';
                
                sortedGenres.forEach(genre => {
                    const option = document.createElement('div');
                    option.className = 'dropdown-option';
                    option.setAttribute('data-value', genre);
                    // Capitalize first letter for display
                    option.textContent = genre.charAt(0).toUpperCase() + genre.slice(1);
                    if (genre === currentSelection) {
                        option.classList.add('selected');
                        // Update trigger text as well
                        this.updateDropdownValue('genreFilter', genre);
                    }
                    
                    option.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.selectDropdownOption('genreFilter', genre, option.textContent);
                    });
                    dropdownList.appendChild(option);
                });
            }
        }
    }

    getDisplayNameForUser(userId, userDisplayName, userName, userEmail) {
        if (!userId) {
            return userDisplayName || userName || userEmail?.split('@')[0] || 'Unknown User';
        }
        
        const userProfile = this.userProfilesMap.get(userId);
        if (userProfile && typeof Utils !== 'undefined' && Utils.getDisplayName) {
            return Utils.getDisplayName(userProfile, null);
        }
        
        return userDisplayName || userName || userEmail?.split('@')[0] || 'Unknown User';
    }

    getUserPhoto(userId, userPhoto) {
        if (userId) {
            const userProfile = this.userProfilesMap.get(userId);
            if (userProfile?.photoURL) {
                return userProfile.photoURL;
            }
        }
        return userPhoto || '/icons/icon48.png';
    }

    extractAndPopulateUsers(ratings) {
        const usersMap = new Map();
        
        ratings.forEach(rating => {
            if (rating.userId && (rating.userEmail || rating.userName)) {
                const displayName = this.getDisplayNameForUser(
                    rating.userId,
                    rating.userDisplayName,
                    rating.userName,
                    rating.userEmail
                );
                usersMap.set(rating.userId, {
                    id: rating.userId,
                    email: rating.userEmail,
                    displayName: displayName
                });
            }
        });
        
        this.allUsers = Array.from(usersMap.values()).sort((a, b) => 
            a.displayName.localeCompare(b.displayName)
        );
        
        const userFilter = this.elements.userFilter;
        if (userFilter) {
            userFilter.innerHTML = '<option value="">All Users</option>';
            
            this.allUsers.forEach(user => {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = user.displayName;
                userFilter.appendChild(option);
            });
            
            if (this.dropdowns?.userFilter) {
                const dropdownList = this.dropdowns.userFilter.list;
                dropdownList.innerHTML = '<div class="dropdown-option" data-value="">All Users</div>';
                
                this.allUsers.forEach(user => {
                    const option = document.createElement('div');
                    option.className = 'dropdown-option';
                    option.setAttribute('data-value', user.id);
                    option.textContent = user.displayName;
                    option.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.selectDropdownOption('userFilter', user.id, user.displayName);
                    });
                    dropdownList.appendChild(option);
                });
            }
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
        
        // Average rating filter
        if (this.filters.avgRating) {
            const [min, max] = this.filters.avgRating.split('-').map(Number);
            filtered = filtered.filter(movie => 
                movie.averageRating >= min && movie.averageRating <= max
            );
        }
        
        // User filter (only in all-ratings mode)
        if (this.filters.user && this.currentMode === 'all-ratings') {
            filtered = filtered.filter(movie => 
                movie.userId === this.filters.user
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
        
        if (this.filteredMovies.length === 0) {
            grid.innerHTML = ''; // Safe to clear if empty
            this.showEmptyState();
            return;
        }
        
        this.hideEmptyState();
        
        // DOM Reconciliation (Diffing) to prevent flickering
        const existingCards = new Map();
        Array.from(grid.children).forEach(child => {
            if (child.nodeType === 1) { // Element node
                // Try rating ID first, then movie ID
                const key = child.getAttribute('data-rating-id') || child.getAttribute('data-movie-id');
                if (key) existingCards.set(key, child);
            }
        });

        // Use a document fragment for new items if we were clearing, but here we update in place
        // Actually, for list reconciliation, we can just iterate and insertBefore
        
        let currentIdx = 0;
        
        this.filteredMovies.forEach((movieData) => {
            const key = (movieData.id || movieData.movieId || movieData.kinopoiskId).toString();
            let card = existingCards.get(key);
            
            // If card doesn't exist (new item), create it
            if (!card) {
                card = this.createMovieCard(movieData);
                // Ensure the card has the ID for future diffing
                if (movieData.id) card.setAttribute('data-rating-id', movieData.id);
                if (movieData.movieId || movieData.kinopoiskId) {
                    card.setAttribute('data-movie-id', movieData.movieId || movieData.kinopoiskId);
                }
            } else {
                // If checking strict equality of data to update content would be expensive,
                // we assume content is static for now unless explicitly refreshed.
                // However, we remove it from the map to mark it as "used"
                existingCards.delete(key);
                
                // Update dynamic user info that might have been loaded after the cache
                const userNameEl = card.querySelector('.mc-user-name');
                if (userNameEl) {
                    const newName = this.getDisplayNameForUser(
                        movieData.userId, 
                        movieData.userDisplayName, 
                        movieData.userName, 
                        movieData.userEmail
                    );
                    if (userNameEl.textContent.trim() !== newName) {
                        userNameEl.textContent = newName;
                    }
                    if (this.userProfilesMap.has(movieData.userId)) {
                        userNameEl.classList.remove('mc-skeleton');
                    }
                }
                
                const userAvatarEl = card.querySelector('.mc-user-avatar');
                if (userAvatarEl) {
                    const newPhoto = this.getUserPhoto(movieData.userId, movieData.userPhoto);
                    if (userAvatarEl.getAttribute('src') !== newPhoto) {
                        userAvatarEl.src = newPhoto;
                    }
                    if (this.userProfilesMap.has(movieData.userId)) {
                        userAvatarEl.classList.remove('mc-skeleton');
                    }
                }
            }
            
            // Insert at correct position
            const childAtPosition = grid.children[currentIdx];
            
            if (childAtPosition !== card) {
                if (childAtPosition) {
                    grid.insertBefore(card, childAtPosition);
                } else {
                    grid.appendChild(card);
                }
            }
            
            currentIdx++;
        });
        
        // Remove any remaining cards (items that are no longer in the filtered list)
        existingCards.forEach(card => card.remove());
        
        
        // Ensure event delegation is set up (idempotent setup is better, but here we just leave it attached to grid)
        // The previous event listener logic (lines 932+) was adding a NEW listener every render!
        // That is a memory leak and performance issue. 
        // We should move event listeners to setupEventListeners or ensure they are added only once.
        // For now, I will NOT re-add them here. I will assume they are persistent on 'grid'.
        // WAIT: The valid implementation in the previous file snippet showed event listeners being added INSIDE renderMovies.
        // This causes multiple listeners to stack up! I must move them out or check if they exist.
        // Since I cannot move them easily to setupEventListeners without changing more code,
        // and 'grid' is a persistent element, adding listeners repeatedly is bad.
        // I will add a check property to grid.
        
        if (!grid.hasAttribute('data-listeners-attached')) {
            this.attachGridEventListeners(grid);
            grid.setAttribute('data-listeners-attached', 'true');
        }
    }

    attachGridEventListeners(grid) {
        // Add event listeners using event delegation for MovieCard actions
        grid.addEventListener('click', (e) => {
            // Ignore clicks on clickable usernames (handled in second listener)
            if (e.target.closest('.clickable-username')) return;
            
            const target = e.target.closest('[data-action]');
            if (!target) return;
            
            const action = target.getAttribute('data-action');
            const movieId = target.getAttribute('data-movie-id');
            const ratingId = target.getAttribute('data-rating-id');
            
            switch (action) {
                case 'view-details':
                    if (movieId) {
                        const url = chrome.runtime.getURL(`src/pages/search/search.html?movieId=${movieId}`);
                        window.location.href = url;
                    }
                    break;
                    
                case 'toggle-favorite':
                    if (ratingId) {
                        const isFavorite = target.getAttribute('data-is-favorite') === 'true';
                        this.toggleFavorite(ratingId, isFavorite, target);
                    }
                    break;
                    
                case 'edit-rating':
                    if (movieId) {
                        const rating = parseInt(target.getAttribute('data-rating'));
                        const comment = target.getAttribute('data-comment') || '';
                        this.editRating(movieId, rating, comment);
                    }
                    break;
                    
                case 'add-to-collection':
                    if (movieId) {
                        if (window.navigation && typeof window.navigation.showCollectionPicker === 'function') {
                            window.navigation.showCollectionPicker(parseInt(movieId));
                        }
                    }
                    break;
                    
                case 'toggle-watchlist':
                    if (movieId) {
                        this.handleWatchlistToggle(movieId, target);
                    }
                    break;
                    
                case 'toggle-watching':
                    if (movieId) {
                        this.handleWatchingToggle(movieId, target);
                    }
                    break;
            }
        });

        // Add event listeners for clickable usernames
        // Note: Because usernames are inside cards which are dynamic, we rely on bubbling. 
        // But the previous code attached listeners DIRECTLY to elements.
        // With diffing, we can't do that easily for new elements without complex logic.
        // We must switch username clicks to delegation as well.
        grid.addEventListener('click', (e) => {
            const usernameEl = e.target.closest('.clickable-username');
            if (usernameEl) {
                e.stopPropagation();
                const userId = usernameEl.getAttribute('data-user-id');
                if (userId) {
                    const url = chrome.runtime.getURL(`src/pages/profile/profile.html?userId=${userId}`);
                    window.location.href = url;
                }
            }
            
            const collectionBtn = e.target.closest('.collection-btn');
            if (collectionBtn) {
                 e.stopPropagation();
                const movieId = parseInt(collectionBtn.getAttribute('data-movie-id'));
                if (movieId && window.navigation && window.navigation.showCollectionSelector) {
                    window.navigation.showCollectionSelector(movieId, collectionBtn);
                }
            }
        });
    }

    createMovieCard(movieData) {
        // Enrich user data with correct photo from profile
        const enrichedData = {
            ...movieData,
            userPhoto: this.getUserPhoto(movieData.userId, movieData.userPhoto),
            userDisplayName: this.getDisplayNameForUser(
                movieData.userId,
                movieData.userDisplayName,
                movieData.userName,
                movieData.userEmail
            )
        };
        
        // Clean titles
        if (enrichedData.name) enrichedData.name = Utils.cleanTitle(enrichedData.name);
        if (enrichedData.movie && enrichedData.movie.name) enrichedData.movie.name = Utils.cleanTitle(enrichedData.movie.name);
        
        // Use the new MovieCard component
        const card = MovieCard.create(enrichedData, {
            showFavorite: !!movieData.rating,
            showWatching: !!movieData.rating,
            showWatchlist: !!movieData.rating,
            showUserInfo: true,
            showEditRating: false,
            showAddToCollection: false,
            isWatching: movieData.isWatching || false,
            isInWatchlist: movieData.isInWatchlist || false,
            userInfoLoading: !this.userProfilesMap.has(movieData.userId),
            
            // Collections
            availableCollections: this.availableCollections || [],
            movieCollections: (this.availableCollections || [])
                .filter(c => c.movieIds && (c.movieIds.includes(Number(movieData.movie?.kinopoiskId || movieData.movieId)) || c.movieIds.includes(String(movieData.movie?.kinopoiskId || movieData.movieId))))
                .map(c => c.id)
        });

        // Make entire card clickable
        card.style.cursor = 'pointer';
        card.setAttribute('data-action', 'view-details');
        card.setAttribute('data-movie-id', movieData.kinopoiskId || movieData.movieId || (movieData.movie && movieData.movie.kinopoiskId));

        return card;
    }
    checkAuth() {
        if (!this.currentUser) {
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Войдите в систему', 'warning');
            }
            return false;
        }
        return true;
    }

    updateButtonState(button, type, isActive) {
        if (!button) return;
        
        if (type === 'favorite') {
            button.setAttribute('data-is-favorite', isActive);
            const text = button.querySelector('.mc-menu-item-text');
            const icon = button.querySelector('.mc-menu-item-icon');
            if (text) text.textContent = isActive ? 'Remove from Favorites' : 'Add to Favorites';
            if (icon) icon.textContent = isActive ? '💔' : '❤️';
            button.classList.toggle('active', isActive);
        } else if (type === 'watching') {
            button.setAttribute('data-is-watching', isActive);
            const text = button.querySelector('.mc-menu-item-text');
            if (text) text.textContent = isActive ? 'Remove from Watching' : 'Add to Watching';
            button.classList.toggle('active', isActive);
        } else if (type === 'watchlist') {
            button.setAttribute('data-is-in-watchlist', isActive);
            const text = button.querySelector('.mc-menu-item-text');
            if (text) text.textContent = isActive ? 'Remove from Plan to Watch' : 'Add to Plan to Watch';
            button.classList.toggle('active', isActive);
        }
    }

    refreshCardButtons(descriptor) {
        // Find card by movie id or rating id
        // In existing implementation, cards have data-movie-id or data-rating-id
        const card = document.querySelector(`.movie-card-component[data-movie-id="${descriptor}"]`) || 
                     document.querySelector(`.movie-card-component[data-rating-id="${descriptor}"]`);
        
        if (!card) return;

        // Since statuses are mutually exclusive, if one is active, others must be inactive
        // We can just re-render the card, OR update all buttons in the menu
        
        // Let's update buttons
        const movieData = this.filteredMovies.find(m => m.id == descriptor || m.movieId == descriptor || m.movie?.kinopoiskId == descriptor) ||
                          this.movies.find(m => m.id == descriptor || m.movieId == descriptor || m.movie?.kinopoiskId == descriptor);

        if (!movieData) return;

        const favBtn = card.querySelector('[data-action="toggle-favorite"]');
        const watchBtn = card.querySelector('[data-action="toggle-watching"]');
        const planBtn = card.querySelector('[data-action="toggle-watchlist"]');

        this.updateButtonState(favBtn, 'favorite', movieData.status === 'favorite');
        this.updateButtonState(watchBtn, 'watching', movieData.status === 'watching');
        this.updateButtonState(planBtn, 'watchlist', movieData.status === 'plan_to_watch');
    }

    async toggleFavorite(ratingId, currentStatus, buttonElement) {
        if (!this.checkAuth()) return;

        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const movieData = this.filteredMovies.find(m => m.id === ratingId) || this.movies.find(m => m.id === ratingId);
            
            if (!movieData) {
                console.error('Movie data not found for rating:', ratingId);
                return;
            }

            const movieId = movieData.movie?.kinopoiskId || movieData.movieId;

            // Optimistic UI update
            if (buttonElement) buttonElement.classList.add('animating');

            if (currentStatus) {
                // If currently favorite, remove it (or set to null status? usually remove)
                await favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
                movieData.isFavorite = false;
                movieData.status = null;
                
                this.updateButtonState(buttonElement, 'favorite', false);
                if (typeof Utils !== 'undefined') Utils.showToast('Removed from Favorites', 'success');
            } else {
                // Check limit before adding
                 const limitReached = await favoriteService.isFavoritesLimitReached(this.currentUser.uid, 50);
                 if (limitReached) {
                     if (typeof Utils !== 'undefined') {
                         Utils.showToast('Достигнут лимит избранного (50 фильмов)', 'warning');
                     }
                     if (buttonElement) buttonElement.classList.remove('animating');
                     return;
                 }

                // Add to favorites
                await favoriteService.addToFavorites(this.currentUser.uid, {
                    ...movieData.movie,
                    movieId: movieId
                }, 'favorite');
                
                // Update local model
                movieData.isFavorite = true;
                movieData.isWatching = false; // Mutually exclusive
                movieData.isInWatchlist = false; // Mutually exclusive
                movieData.status = 'favorite';
                
                this.updateButtonState(buttonElement, 'favorite', true);
                // Also need to update other buttons for this card if they exist/are visible
                this.refreshCardButtons(movieData.id || movieData.movieId);
                
                if (typeof Utils !== 'undefined') Utils.showToast('Added to Favorites', 'success');
            }
            
            if (window.navigation?.updateFavoritesCount) window.navigation.updateFavoritesCount();

        } catch (error) {
            console.error('Error toggling favorite:', error);
            if (typeof Utils !== 'undefined') Utils.showToast('Error updating status', 'error');
        } finally {
            if (buttonElement) setTimeout(() => buttonElement.classList.remove('animating'), 600);
        }
    }

    async handleWatchingToggle(movieId, buttonElement) {
        if (!this.checkAuth()) return;

        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const movieData = this.filteredMovies.find(m => (m.movie?.kinopoiskId || m.movieId) == movieId);
            if (!movieData) return;

            const isWatching = movieData.isWatching || (movieData.status === 'watching');

            if (isWatching) {
                // Remove
                await favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
                movieData.isWatching = false;
                movieData.status = null;
                
                this.updateButtonState(buttonElement, 'watching', false);
                if (typeof Utils !== 'undefined') Utils.showToast('Removed from Watching', 'success');
            } else {
                // Add to Watching
                await favoriteService.addToFavorites(this.currentUser.uid, {
                    ...movieData.movie,
                    movieId: movieId
                }, 'watching');
                
                movieData.isWatching = true;
                movieData.isFavorite = false;
                movieData.isInWatchlist = false;
                movieData.status = 'watching';
                
                this.updateButtonState(buttonElement, 'watching', true);
                this.refreshCardButtons(movieId);
                
                if (typeof Utils !== 'undefined') Utils.showToast('Added to Watching', 'success');
            }

            if (window.navigation?.updateWatchingCount) window.navigation.updateWatchingCount();
        } catch (error) {
            console.error('Error toggling watching:', error);
            if (typeof Utils !== 'undefined') Utils.showToast('Error updating status', 'error');
        }
    }

    async handleWatchlistToggle(movieId, buttonElement) {
        if (!this.checkAuth()) return;

        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const movieData = this.filteredMovies.find(m => (m.movie?.kinopoiskId || m.movieId) == movieId);
            if (!movieData) return;

            const isInWatchlist = movieData.isInWatchlist || (movieData.status === 'plan_to_watch');

            if (isInWatchlist) {
                // Remove
                await favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
                movieData.isInWatchlist = false;
                movieData.status = null;
                
                this.updateButtonState(buttonElement, 'watchlist', false);
                if (typeof Utils !== 'undefined') Utils.showToast('Removed from Plan to Watch', 'success');
            } else {
                // Add to Plan to Watch
                await favoriteService.addToFavorites(this.currentUser.uid, {
                    ...movieData.movie,
                    movieId: movieId
                }, 'plan_to_watch');
                
                movieData.isInWatchlist = true;
                movieData.isFavorite = false;
                movieData.isWatching = false;
                movieData.status = 'plan_to_watch';
                
                this.updateButtonState(buttonElement, 'watchlist', true);
                this.refreshCardButtons(movieId);
                
                if (typeof Utils !== 'undefined') Utils.showToast('Added to Plan to Watch', 'success');
            }

            if (window.navigation?.updateWatchlistCount) window.navigation.updateWatchlistCount();
        } catch (error) {
            console.error('Error toggling watchlist:', error);
            if (typeof Utils !== 'undefined') Utils.showToast('Error updating status', 'error');
        }
    }

    async handleToggleCollection(movieId, collectionId, buttonElement) {
        if (!this.collectionService) return;
        
        // Optimistic UI update
        const originalHtml = buttonElement.innerHTML;
        const textSpan = buttonElement.querySelector('.mc-menu-item-text');
        
        try {
            // Check if checkmark exists
            let checkSpan = Array.from(buttonElement.children).find(child => child.textContent.includes('✓'));
            const isChecked = !!checkSpan;
            
            if (isChecked) {
                checkSpan.remove();
                if (textSpan) {
                    textSpan.style.fontWeight = 'normal';
                    textSpan.style.color = '';
                }
            } else {
                const newCheck = document.createElement('span');
                newCheck.textContent = '✓';
                newCheck.style.marginLeft = 'auto';
                newCheck.style.fontWeight = 'bold';
                newCheck.style.color = 'var(--accent-color, #4CAF50)';
                buttonElement.appendChild(newCheck);
                
                if (textSpan) {
                    textSpan.style.fontWeight = '500';
                    textSpan.style.color = '#fff';
                }
            }

            await this.collectionService.toggleMovieInCollection(collectionId, parseInt(movieId));
            
            // Update local cache
            const col = this.availableCollections.find(c => c.id === collectionId);
            if (col) {
                const idToCheck = parseInt(movieId);
                const idx = col.movieIds.indexOf(idToCheck);
                if (idx > -1) {
                    col.movieIds.splice(idx, 1);
                } else {
                    col.movieIds.push(idToCheck);
                }
            }
            // Logic to revert or ensure consistency if cache was string/number mix is handled loosely above

            if (typeof Utils !== 'undefined') Utils.showToast(isChecked ? 'Removed from collection' : 'Added to collection', 'success');

        } catch (error) {
            console.error('Error toggling collection:', error);
            buttonElement.innerHTML = originalHtml;
            if (typeof Utils !== 'undefined') Utils.showToast('Error updating collection', 'error');
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
                // Add to watchlist
                const movieData = {
                    movieId: movie.kinopoiskId,
                    movieTitle: movie.name || '',
                    movieTitleRu: movie.alternativeName || '',
                    posterPath: movie.posterUrl || '',
                    releaseYear: movie.year || null,
                    genres: movie.genres || [],
                    description: movie.description || '',
                    kpRating: movie.kpRating || 0,
                    imdbRating: movie.imdbRating || 0,
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

    async updateWatchlistButtonStates() {
        if (!this.currentUser) return;

        try {
            const watchlistService = firebaseManager.getWatchlistService();
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
        } catch (error) {
            console.error('Error updating watchlist button states:', error);
        }
    }

    showMovieDetails(movieId) {
        const movieData = this.filteredMovies.find(m => m.movie?.kinopoiskId === movieId);
        if (!movieData) return;
        
        const { movie, rating, averageRating, ratingsCount, comment } = movieData;
        
        this.elements.modalTitle.textContent = movie?.name || 'Movie Details';
        
        const avgDisplay = ratingsCount > 0 ? `${parseFloat(averageRating.toFixed(1))} (${ratingsCount} ratings)` : 'No ratings yet';
        
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
                        <strong>My Rating:</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> ${rating}/10<br>
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

    async editRating(movieId, currentRating, currentComment) {
        this.selectedMovie = { kinopoiskId: movieId };
        
        // Find movie data
        const movieData = this.filteredMovies.find(m => m.movie?.kinopoiskId === movieId);
        if (!movieData) return;
        
        const movie = movieData.movie;
        this.selectedMovie = movie;
        
        // Update modal title
        this.elements.ratingModalTitle.textContent = `Edit Rating: ${movie.name}`;
        
        // Show movie info in rating modal
        this.elements.movieRatingInfo.innerHTML = `
            <div class="movie-detail">
                <img src="${movie.posterUrl || '/icons/icon48.png'}" alt="${movie.name}" class="movie-detail-poster">
                <div class="movie-detail-info">
                    <h3 class="movie-detail-title">${this.escapeHtml(movie.name)}</h3>
                    <p class="movie-detail-meta">${movie.year} • ${movie.genres?.slice(0, 3).join(', ')}</p>
                    <div class="movie-detail-ratings">
                        <span class="rating-badge kp">КП: ${movie.kpRating ? parseFloat(movie.kpRating.toFixed(1)) : 'N/A'}</span>
                        ${movie.imdbRating ? `<span class="rating-badge imdb">IMDb: ${parseFloat(movie.imdbRating.toFixed(1))}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
        
        // Show current rating info
        this.elements.currentRatingInfo.style.display = 'block';
        this.elements.existingRatingValue.textContent = `${currentRating}/10`;
        this.elements.existingRatingComment.textContent = currentComment || 'No comment';
        
        // Set form values
        this.elements.ratingSlider.value = currentRating;
        this.elements.ratingValue.textContent = currentRating;
        this.elements.ratingComment.value = currentComment || '';
        this.elements.charCount.textContent = (currentComment || '').length;
        
        this.elements.ratingModal.style.display = 'flex';
    }

    async saveRating() {
        if (!this.selectedMovie || !this.currentUser) return;
        
        try {
            const rating = parseInt(this.elements.ratingSlider.value);
            const comment = this.elements.ratingComment.value.trim();
            
            // Validation
            if (rating < 1 || rating > 10) {
                alert('Rating must be between 1 and 10');
                return;
            }
            
            const ratingService = firebaseManager.getRatingService();
            const userService = firebaseManager.getUserService();
            
            // Get fresh user profile
            const userProfile = await userService.getUserProfile(this.currentUser.uid);
            
            // Get display name based on user preference
            const displayName = typeof Utils !== 'undefined' && Utils.getDisplayName
                ? Utils.getDisplayName(userProfile, this.currentUser)
                : (userProfile?.displayName || this.currentUser.displayName || this.currentUser.email);
            
            await ratingService.addOrUpdateRating(
                this.currentUser.uid,
                displayName,
                userProfile?.photoURL || this.currentUser.photoURL || '',
                this.selectedMovie.kinopoiskId,
                rating,
                comment,
                this.selectedMovie
            );
            
            this.closeRatingModal();
            
            // Reload to show updated data
            await this.loadMovies();
            
        } catch (error) {
            console.error('Error saving rating:', error);
            alert('Failed to save rating. Please try again.');
        }
    }

    closeModal() {
        this.elements.movieModal.style.display = 'none';
    }

    closeRatingModal() {
        this.elements.ratingModal.style.display = 'none';
        this.selectedMovie = null;
    }

    clearFilters() {
        this.filters = {
            search: '',
            genre: '',
            year: '',
            avgRating: '',
            user: '',
            sort: 'date-desc'
        };
        
        this.elements.movieSearchInput.value = '';
        this.elements.genreFilter.value = '';
        this.elements.yearFilter.value = '';
        this.elements.avgRatingFilter.value = '';
        if (this.elements.userFilter) {
            this.elements.userFilter.value = '';
        }
        this.elements.sortFilter.value = 'date-desc';
        
        this.updateDropdownValue('genreFilter', '');
        this.updateDropdownValue('yearFilter', '');
        this.updateDropdownValue('avgRatingFilter', '');
        this.updateDropdownValue('userFilter', '');
        this.updateDropdownValue('sortFilter', 'date-desc');
        
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
        this.elements.resultsMode.textContent = 'All Ratings';
    }

    showLoading(show) {
        this.elements.loadingSection.style.display = show ? 'block' : 'none';
        this.elements.moviesGrid.style.display = show ? 'none' : 'grid';
    }

    showEmptyState() {
        this.elements.emptyState.style.display = 'flex';
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
        if (this.elements.genreFilter) {
            this.elements.genreFilter.value = this.filters.genre;
            this.updateDropdownValue('genreFilter', this.filters.genre);
        }
        if (this.elements.yearFilter) {
            this.elements.yearFilter.value = this.filters.year;
            this.updateDropdownValue('yearFilter', this.filters.year);
        }
        if (this.elements.avgRatingFilter) {
            this.elements.avgRatingFilter.value = this.filters.avgRating;
            this.updateDropdownValue('avgRatingFilter', this.filters.avgRating);
        }
        if (this.elements.userFilter) {
            this.elements.userFilter.value = this.filters.user;
            this.updateDropdownValue('userFilter', this.filters.user);
        }
        if (this.elements.sortFilter) {
            this.elements.sortFilter.value = this.filters.sort;
            this.updateDropdownValue('sortFilter', this.filters.sort);
        }
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
