import { i18n } from '../../shared/i18n/I18n.js';
import { getTimestamp } from '../../shared/utils/dateUtils.js';
import { buildProviderRatingCache, mergeProviderRatingsIntoMovies } from '../../shared/utils/providerRatings.js';

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
            avgRatingFrom: 1.0,
            avgRatingTo: 10.0,
            user: '',
            sort: 'date-desc'
        };
        this.movies = [];
        this.filteredMovies = [];
        this.currentUser = null;
        this.isLoading = false;
        this.currentRequestId = 0;
        this.lastMovieDoc = null;
        this.allUsers = []; // Store all users who have rated movies
        this.userProfilesMap = new Map(); // Store user profiles for display name formatting
        this.availableCollections = []; // Store for menu
        this.renderedMoviesState = new Map(); // Store rendered movie signatures for diffing
        this.BATCH_SIZE = 8;
        this._moviesLoadTriggered = false;
        this.init();
    }

    buildRenderSignature(movieData) {
        if (!movieData) return '';
        const movieId = movieData.movie?.kinopoiskId || movieData.movieId;
        const signatureObj = {
            rating: movieData.rating,
            comment: Utils.normalizeRatingComment(movieData.comment),
            isFavorite: movieData.isFavorite,
            isWatching: movieData.isWatching,
            isInWatchlist: movieData.isInWatchlist,
            status: movieData.status,
            averageRating: movieData.averageRating,
            ratingsCount: movieData.ratingsCount,
            movieName: movieData.movie?.name,
            moviePosterUrl: movieData.movie?.posterUrl,
            movieYear: movieData.movie?.year,
            movieGenres: JSON.stringify(movieData.movie?.genres),
            movieDescription: movieData.movie?.description,
            movieKpRating: movieData.movie?.kpRating,
            movieImdbRating: movieData.movie?.imdbRating,
            userDisplayName: this.getDisplayNameForUser(movieData.userId || movieData.uid, movieData.userDisplayName, movieData.userName, movieData.userEmail),
            userPhoto: this.getUserPhoto(movieData.userId || movieData.uid, movieData.userPhoto),
            movieCollections: JSON.stringify(
                (this.availableCollections || [])
                    .filter(c => c.movieIds && (c.movieIds.includes(Number(movieId)) || c.movieIds.includes(String(movieId))))
                    .map(c => c.id)
            ),
            allRaters: JSON.stringify(
                (movieData.allRaters || []).map(r => ({
                    userId: r.userId || r.uid,
                    rating: r.rating,
                    comment: Utils.normalizeRatingComment(r.comment),
                    userDisplayName: this.getDisplayNameForUser(r.userId || r.uid, r.userDisplayName, r.userName, r.userEmail),
                    userPhoto: this.getUserPhoto(r.userId || r.uid, r.userPhoto)
                }))
            )
        };
        return JSON.stringify(signatureObj);
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
        this.loadFiltersCollapseState();
        
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
        
        // Standardized movie card navigation
        Utils.bindMovieCardNavigation(this.moviesGrid);
        
        // Spoiler reveal logic
        Utils.bindSpoilerReveal(document);
        
        // Single controlled initial load
        this.ensureInitialLoad('init: end of initialization');
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
            avgRatingSlider: document.getElementById('avgRatingSlider'),
            avgRatingFrom: document.getElementById('avgRatingFrom'),
            avgRatingTo: document.getElementById('avgRatingTo'),
            avgRatingMinDisplay: document.getElementById('avgRatingMinDisplay'),
            avgRatingMaxDisplay: document.getElementById('avgRatingMaxDisplay'),
            avgRatingTrack: document.getElementById('avgRatingTrack'),
            avgRatingRange: document.getElementById('avgRatingRange'),
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
            existingRatingComment: document.getElementById('existingRatingComment'),
            
            // Active Filters
            activeFiltersContainer: document.getElementById('activeFiltersContainer'),
            activeFiltersList: document.getElementById('activeFiltersList'),
            
            // Toggle Filters
            toggleFiltersBtn: document.getElementById('toggleFiltersBtn'),
            filtersSection: document.querySelector('.filters-section')
        };

        // UI State Manager
        this.page = Utils.createPageStateManager({
            loader: this.elements.loadingSection,
            errorScreen: this.elements.errorState,
            errorMessage: document.getElementById('errorMessage'),
            contentContainer: this.elements.moviesGrid
        });
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
        
        // Rating Range Slider
        if (this.elements.avgRatingFrom && this.elements.avgRatingTo) {
            this.initDoubleSlider(
                this.elements.avgRatingFrom,
                this.elements.avgRatingTo,
                this.elements.avgRatingMinDisplay,
                this.elements.avgRatingMaxDisplay,
                this.elements.avgRatingRange,
                (min, max) => {
                    this.filters.avgRatingFrom = parseFloat(min);
                    this.filters.avgRatingTo = parseFloat(max);
                    this.loadMovies();
                }
            );
        }
        
        this.elements.userFilter?.addEventListener('change', (e) => {
            this.filters.user = e.target.value;
            this.applyFilters();
        });
        
        this.elements.sortFilter?.addEventListener('change', (e) => {
            this.filters.sort = e.target.value;
            this.applyFilters();
        });
        
        this.elements.clearFiltersBtn?.addEventListener('mousedown', () => this.clearFilters());
        
        // Active Filter Tags Click (Event Delegation)
        this.elements.activeFiltersList?.addEventListener('mousedown', (e) => {
            const removeBtn = e.target.closest('.remove-filter');
            if (removeBtn) {
                const filterType = removeBtn.dataset.filterType;
                this.removeFilter(filterType);
            }
        });
        
        // Toggle Filters
        this.elements.toggleFiltersBtn?.addEventListener('mousedown', () => this.toggleFilters());
        
        // Retry button
        this.elements.retryBtn?.addEventListener('mousedown', () => this.loadMovies());
        
        // Event delegation for Movie Cards (Actions and Edit Rating)
        this.elements.moviesGrid?.addEventListener('mousedown', (e) => {
            // If it's not a left click, let the browser handle it (e.g. middle click for new tab)
            if (e.button !== 0) return;

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
            if (action === 'stop-propagation') return;
            const movieId = target.dataset.movieId;
            const ratingId = target.dataset.ratingId || target.closest('.movie-card-component')?.dataset.ratingId;

            switch (action) {
                case 'toggle-favorite':
                    Utils.toggleActionButton(target, 'favorite');
                    this.toggleFavorite(ratingId || movieId, target.dataset.isFavorite === 'true', target, movieId);
                    break;
                case 'toggle-watching':
                    Utils.toggleActionButton(target, 'watching');
                    this.handleWatchingToggle(movieId, target);
                    break;
                case 'toggle-watchlist':
                    Utils.toggleActionButton(target, 'watchlist');
                    this.handleWatchlistToggle(movieId, target);
                    break;
                case 'toggle-collection': {
                    const collectionId = target.dataset.collectionId;
                    if (collectionId) {
                        this.handleToggleCollection(movieId, collectionId, target);
                    }
                    break;
                }
                 case 'edit-rating': {
                     const r = parseInt(target.dataset.rating || 0);
                     const c = target.dataset.comment || '';
                     this.editRating(movieId, r, c);
                     break;
                 }
            }
        });
        
        // Modal close buttons
        this.elements.modalClose?.addEventListener('mousedown', () => this.closeModal());
        this.elements.ratingModalClose?.addEventListener('mousedown', () => this.closeRatingModal());
        
        // Rating modal
        this.elements.ratingSlider?.addEventListener('input', (e) => {
            this.elements.ratingValue.textContent = e.target.value;
        });
        
        this.elements.ratingComment?.addEventListener('input', (e) => {
            const count = e.target.value.length;
            this.elements.charCount.textContent = count;
        });
        
        this.elements.saveRatingBtn?.addEventListener('mousedown', () => this.saveRating());
        this.elements.cancelRatingBtn?.addEventListener('mousedown', () => this.closeRatingModal());
        
        // Close modals on background click
        this.elements.movieModal?.addEventListener('mousedown', (e) => {
            if (e.target === this.elements.movieModal) this.closeModal();
        });
        
        this.elements.ratingModal?.addEventListener('mousedown', (e) => {
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
                    this.ensureInitialLoad('setupFirebase: currentUser detected');
                }
                
                // Listen for auth state changes via window event (dispatched by firestore.js)
                window.addEventListener('authStateChanged', (e) => {
                    const user = e.detail.user;
                    const previousUid = this.currentUser?.uid;
                    this.currentUser = user;
                    
                    if (user) {
                        if (previousUid && previousUid !== user.uid) {
                            // User account switched -> reset trigger and clear signature cache
                            this._moviesLoadTriggered = false;
                            this.renderedMoviesState.clear();
                            this.ensureInitialLoad('authStateChanged: user switched');
                        } else {
                            this.ensureInitialLoad('authStateChanged: initial user event');
                        }
                    } else {
                        this.page.showError('Please sign in to view your collection');
                    }
                });
                
                // If still no user after setup, show error or retry
                setTimeout(() => {
                    if (!this.currentUser) {
                        const retryUser = firebaseManager.getCurrentUser();
                        if (retryUser) {
                            this.currentUser = retryUser;
                            this.ensureInitialLoad('setupFirebase: retryUser');
                        } else {
                            this.page.showError('Please sign in to view your collection');
                        }
                    }
                }, 2000);
            } else {
                this.page.showError('Failed to initialize Firebase');
            }
        } catch (error) {
            console.error('Error setting up Firebase:', error);
            this.page.showError(`Firebase setup failed: ${error.message}`);
        }
    }

    ensureInitialLoad(callerContext = 'unspecified') {
        if (this._moviesLoadTriggered) {
            console.log(`[RatingsPage] Startup loadMovies already triggered once, skipping duplicate call from: ${callerContext}`);
            return;
        }
        if (!this.currentUser) {
            console.log(`[RatingsPage] Cannot load movies yet, no authenticated user (caller: ${callerContext})`);
            return;
        }
        this._moviesLoadTriggered = true;
        this.loadMovies(callerContext);
    }

    updateUserFilterVisibility() {
        // Ensure user filter is always visible in all-ratings mode
        if (this.elements.userFilterGroup) {
            this.elements.userFilterGroup.classList.add('visible');
        }
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
                const firstBatch = this.allRawRatings.slice(0, 8);
                const enrichedStart = this.enrichFromLocalStorage(firstBatch);
                if (enrichedStart.length > 0) {
                    this.movies = await this.mergeProviderRatingsForPage(enrichedStart);
                    this.hasMore = this.allRawRatings.length > 8;
                    this.nextLoadIndex = 8;
                    this.BATCH_SIZE = 8;
                    
                    this.populateYearFilter();
                    this.populateGenreFilter();
                    this.applyFilters();
                    this.page.showContent(); // Ensure content shown
                    
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
            } catch {
                // Ignore local storage parse error
            }
            
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

    async loadSharedProviderRatings() {
        try {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) return {};
            const stored = await chrome.storage.local.get('movie_card_ratings_v4');
            return stored?.movie_card_ratings_v4 || {};
        } catch (error) {
            console.warn('[RatingsPage] Failed to load shared provider ratings:', error);
            return {};
        }
    }

    async mergeProviderRatingsForPage(items) {
        const previousRatings = buildProviderRatingCache(this.movies);
        const withPreviousRatings = mergeProviderRatingsIntoMovies(items, previousRatings);
        const sharedRatings = await this.loadSharedProviderRatings();
        const merged = mergeProviderRatingsIntoMovies(withPreviousRatings, sharedRatings);
        return merged;
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

    async loadMovies(callerContext = 'unspecified') {
        if (this.isLoading && this.activeLoadPromise && callerContext !== 'filterChange' && callerContext !== 'userAction') {
            console.log(`[loadMovies] Reusing active in-flight request (caller: ${callerContext})`);
            return this.activeLoadPromise;
        }

        const requestId = ++this.currentRequestId;
        console.log(`[loadMovies #${requestId}] Initiated by: ${callerContext}`);
        console.trace(`[loadMovies #${requestId}] Call stack trace:`);

        this.activeLoadPromise = (async () => {
            const isBackgroundUpdate = this.movies.length > 0;

            // Reset pagination cursors & state on initial load
            if (!this.loadingMore) {
                this.lastMovieDoc = null;
                this.hasMore = true;
                if (!isBackgroundUpdate) {
                    this.movies = [];
                }
                this.allRawRatings = [];
                this.renderedMoviesState.clear();
            }
            
            this.isLoading = true;
            if (!isBackgroundUpdate) {
                this.page.showLoader();
            }
            
            const loadingTimeout = setTimeout(() => {
                if (this.isLoading && this.currentRequestId === requestId) {
                    console.warn('Loading timeout - forcing completion');
                    this.isLoading = false;
                    this.page.showError('Loading timed out. Please refresh the page.');
                }
            }, 30000);
            
            try {
                const movieCacheService = firebaseManager.getMovieCacheService();
                const ratingService = firebaseManager.getRatingService();

                this.updateSortFilterUIState();

                const [sortField, sortDir] = (this.filters.sort || 'date-desc').split('-');
                const pagedResult = await movieCacheService.getMoviesByAvgRating({
                    minAvgRating: this.filters.avgRatingFrom,
                    maxAvgRating: this.filters.avgRatingTo,
                    sortBy: sortField,
                    sortDir: sortDir,
                    limit: this.BATCH_SIZE || 8,
                    lastDoc: this.lastMovieDoc
                });

                if (this.currentRequestId !== requestId) {
                    console.log(`[loadMovies] Outdated request ${requestId} ignored (current is ${this.currentRequestId}).`);
                    clearTimeout(loadingTimeout);
                    return;
                }

                const pagedMovies = pagedResult.movies;
                this.lastMovieDoc = pagedResult.lastDoc;
                this.hasMore = pagedResult.hasMore;

                if (pagedMovies.length === 0) {
                    this.movies = [];
                    this.filteredMovies = [];
                    this.renderMovies();
                    this.updateResultsInfo();
                    this.renderActiveTags();
                    clearTimeout(loadingTimeout);
                    this.page.showContent();
                    this.isLoading = false;
                    return;
                }

                const moviesWithProviderRatings = await this.mergeProviderRatingsForPage(pagedMovies);
                const movieIds = moviesWithProviderRatings.map(m => parseInt(m.kinopoiskId || m.id)).filter(Boolean);

                // Fetch user ratings for these movies
                const ratingsSnapshot = await ratingService.fetchAverageRatingsFromFirestore(movieIds);

                // Group all ratings for each movie
                const allRatingsForMovies = await Promise.all(
                    movieIds.map(async (id) => {
                        const r = await ratingService.getMovieRatings(id, 50);
                        return { movieId: id, raters: r };
                    })
                );
                const ratersMap = new Map(allRatingsForMovies.map(item => [item.movieId, item.raters]));

                // Build card structures matching ratings page expectation
                const enrichedMovies = moviesWithProviderRatings.map(movieObj => {
                    const movieId = parseInt(movieObj.kinopoiskId || movieObj.id);
                    const allRaters = ratersMap.get(movieId) || [];
                    
                    let currentUserRating = allRaters.find(r => r.userId === this.currentUser?.uid) || allRaters[0] || {};
                    
                    const avgInfo = ratingsSnapshot[movieId] || { average: movieObj.avgRating || 0, count: movieObj.ratingsCount || 0 };
                    const movieAverage = Number(movieObj.avgRating);
                    const fetchedAverage = Number(avgInfo.average);
                    const movieRatingsCount = Number(movieObj.ratingsCount);
                    const fetchedRatingsCount = Number(avgInfo.count);

                    // Use the same field Firestore sorts by (lastRatingUpdatedAt) to keep
                    // client-side order consistent with server-side pagination order.
                    // Previously Math.max() across 4 date sources caused order divergence.
                    const effectiveDate = getTimestamp(movieObj.lastRatingUpdatedAt) ||
                        getTimestamp(movieObj.updatedAt) ||
                        Date.now();

                    return {
                        ...currentUserRating,
                        movieId: movieId,
                        movie: movieObj,
                        createdAt: effectiveDate,
                        rating: currentUserRating.rating || 0,
                        comment: Utils.normalizeRatingComment(currentUserRating.comment),
                        averageRating: movieAverage > 0 ? movieAverage : (fetchedAverage > 0 ? fetchedAverage : 0),
                        ratingsCount: movieRatingsCount > 0 ? movieRatingsCount : fetchedRatingsCount,
                        allRaters: allRaters
                    };
                });

                await this.enrichWithWatchStatuses(enrichedMovies);

                if (this.currentRequestId !== requestId) {
                    console.log(`[loadMovies] Outdated request ${requestId} after enrichment ignored (current is ${this.currentRequestId}).`);
                    clearTimeout(loadingTimeout);
                    return;
                }

                await this.loadUserProfiles(enrichedMovies);

                this.movies = enrichedMovies;
                this.populateYearFilter();
                this.populateGenreFilter();

                this.applyFilters();

                if (this.hasMore) {
                    this.setupInfiniteScroll();
                } else {
                    this.removeInfiniteScroll();
                }

                const isFilterActive = this.filters.avgRatingFrom > 1.0 || this.filters.avgRatingTo < 10.0;
                if (!isFilterActive) {
                    this.saveRatingsToCache(enrichedMovies, this.allUsers);
                }

                clearTimeout(loadingTimeout);
                this.page.showContent();
                this.isLoading = false;
            } catch (error) {
                if (this.currentRequestId !== requestId) {
                    console.log(`[loadMovies] Outdated request ${requestId} error ignored.`);
                    clearTimeout(loadingTimeout);
                    return;
                }
                console.error('Error loading movies:', error);
                clearTimeout(loadingTimeout);
                this.page.showError(`Failed to load movies: ${error.message}`);
                this.isLoading = false;
            }
        })();

        try {
            return await this.activeLoadPromise;
        } finally {
            this.activeLoadPromise = null;
        }
    }

    async loadNextBatch() {
        if (!this.hasMore || this.loadingMore) {
            return;
        }

        const requestId = this.currentRequestId;
        this.loadingMore = true;

        try {
            const movieCacheService = firebaseManager.getMovieCacheService();
            const ratingService = firebaseManager.getRatingService();

            const [sortField, sortDir] = (this.filters.sort || 'date-desc').split('-');
            const pagedResult = await movieCacheService.getMoviesByAvgRating({
                minAvgRating: this.filters.avgRatingFrom,
                maxAvgRating: this.filters.avgRatingTo,
                sortBy: sortField,
                sortDir: sortDir,
                limit: this.BATCH_SIZE || 8,
                lastDoc: this.lastMovieDoc
            });

            if (this.currentRequestId !== requestId) {
                console.log(`[loadNextBatch] Outdated request ${requestId} ignored.`);
                this.loadingMore = false;
                return;
            }

            const pagedMovies = pagedResult.movies;
            this.lastMovieDoc = pagedResult.lastDoc;
            this.hasMore = pagedResult.hasMore;

            if (pagedMovies.length > 0) {
                const moviesWithProviderRatings = await this.mergeProviderRatingsForPage(pagedMovies);
                const movieIds = moviesWithProviderRatings.map(m => parseInt(m.kinopoiskId || m.id)).filter(Boolean);

                const ratingsSnapshot = await ratingService.fetchAverageRatingsFromFirestore(movieIds);
                const allRatingsForMovies = await Promise.all(
                    movieIds.map(async (id) => {
                        const r = await ratingService.getMovieRatings(id, 50);
                        return { movieId: id, raters: r };
                    })
                );
                const ratersMap = new Map(allRatingsForMovies.map(item => [item.movieId, item.raters]));

                const enrichedBatch = moviesWithProviderRatings.map(movieObj => {
                    const movieId = parseInt(movieObj.kinopoiskId || movieObj.id);
                    const allRaters = ratersMap.get(movieId) || [];
                    let currentUserRating = allRaters.find(r => r.userId === this.currentUser?.uid) || allRaters[0] || {};
                    const avgInfo = ratingsSnapshot[movieId] || { average: movieObj.avgRating || 0, count: movieObj.ratingsCount || 0 };
                    const movieAverage = Number(movieObj.avgRating);
                    const fetchedAverage = Number(avgInfo.average);
                    const movieRatingsCount = Number(movieObj.ratingsCount);
                    const fetchedRatingsCount = Number(avgInfo.count);

                    // Use the same field Firestore sorts by (lastRatingUpdatedAt) to keep
                    // client-side order consistent with server-side pagination order.
                    const effectiveDate = getTimestamp(movieObj.lastRatingUpdatedAt) ||
                        getTimestamp(movieObj.updatedAt) ||
                        Date.now();

                    return {
                        ...currentUserRating,
                        movieId: movieId,
                        movie: movieObj,
                        createdAt: effectiveDate,
                        rating: currentUserRating.rating || 0,
                        comment: Utils.normalizeRatingComment(currentUserRating.comment),
                        averageRating: movieAverage > 0 ? movieAverage : (fetchedAverage > 0 ? fetchedAverage : 0),
                        ratingsCount: movieRatingsCount > 0 ? movieRatingsCount : fetchedRatingsCount,
                        allRaters: allRaters
                    };
                });

                await this.enrichWithWatchStatuses(enrichedBatch);

                if (this.currentRequestId !== requestId) {
                    console.log(`[loadNextBatch] Outdated request ${requestId} after enrichment ignored.`);
                    this.loadingMore = false;
                    return;
                }

                await this.loadUserProfiles(enrichedBatch);

                this.movies = [...this.movies, ...enrichedBatch];
                this.populateYearFilter();
                this.populateGenreFilter();
                this.applyFilters();
            }

            this.loadingMore = false;

            if (!this.hasMore) {
                this.removeInfiniteScroll();
            }
        } catch (error) {
            console.error('Error loading next batch:', error);
            this.loadingMore = false;
        }
    }

    setupInfiniteScroll() {
        if (this.observer) this.observer.disconnect();

        const options = {
            root: null,
            rootMargin: '300px',
            threshold: 0.05
        };

        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !this.loadingMore && this.hasMore) {
                    this.loadNextBatch().then(() => {
                        this.checkToFillViewport();
                    });
                }
            });
        }, options);

        let sentinel = document.getElementById('scrollSentinel');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.id = 'scrollSentinel';
            sentinel.style.height = '20px';
            sentinel.style.width = '100%';
            this.elements.moviesGrid.parentNode.insertBefore(sentinel, this.elements.moviesGrid.nextSibling);
        }
        
        this.observer.observe(sentinel);
        this.checkToFillViewport();
    }

    checkToFillViewport() {
        if (!this.hasMore || this.loadingMore) return;
        const sentinel = document.getElementById('scrollSentinel');
        if (sentinel) {
            const rect = sentinel.getBoundingClientRect();
            if (rect.top <= window.innerHeight + 300) {
                this.loadNextBatch().then(() => {
                    this.checkToFillViewport();
                });
            }
        }
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
            console.log(`[loadUserProfiles] Checking ${ratings.length} grouped items for user profiles...`);
            
            // Collect all unique user IDs (handling both userId and uid fields for robustness)
            const userIdsSet = new Set();
            ratings.forEach(r => {
                if (r.userId) userIdsSet.add(String(r.userId).trim());
                if (r.uid) userIdsSet.add(String(r.uid).trim());
                if (r.allRaters) {
                    r.allRaters.forEach(arter => {
                        if (arter.userId) userIdsSet.add(String(arter.userId).trim());
                        if (arter.uid) userIdsSet.add(String(arter.uid).trim());
                    });
                }
            });
            
            const userIds = Array.from(userIdsSet).filter(Boolean);
            console.log(`[loadUserProfiles] Found ${userIds.length} unique user IDs to fetch:`, userIds);
            
            if (userIds.length === 0) {
                console.warn('[loadUserProfiles] No user IDs found to fetch.');
                return;
            }
            
            const userService = firebaseManager.getUserService();
            const userProfiles = await userService.getUserProfilesByIds(userIds);
            console.log(`[loadUserProfiles] Successfully fetched ${userProfiles.length} profiles from database.`);
            
            this.userProfilesMap.clear();
            userProfiles.forEach(profile => {
                const id = String(profile.userId || profile.id || '').trim();
                if (id) {
                    this.userProfilesMap.set(id, profile);
                    // Also indexing by profile.id if it's different, just in case
                    if (profile.id && String(profile.id).trim() !== id) {
                        this.userProfilesMap.set(String(profile.id).trim(), profile);
                    }
                }
            });
            
            console.log(`[loadUserProfiles] Map now contains ${this.userProfilesMap.size} user profiles.`);
            if (this.userProfilesMap.size > 0) {
                console.log(`[loadUserProfiles] Profile IDs in map:`, Array.from(this.userProfilesMap.keys()));
            }
        } catch (error) {
            console.error('[loadUserProfiles] Error loading user profiles:', error);
        }
    }

    async enrichWithWatchStatuses(movies) {
        if (!this.currentUser || movies.length === 0) return;

        try {
            const favoriteService = firebaseManager.getFavoriteService();
            
            // Get all movie IDs
            const movieIds = movies.map(m => m.movie?.kinopoiskId || m.movieId).filter(Boolean);
            
            // Fetch bookmarks in batch
            const bookmarksMap = await favoriteService.getBookmarksBatch(this.currentUser.uid, movieIds);
            
            // Attach statuses to movies
            movies.forEach((movie) => {
                const movieId = movie.movie?.kinopoiskId || movie.movieId;
                const bookmark = bookmarksMap[movieId];
                
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
                
                // Check if cached data is complete (sometimes search results cache partial data)
                const isIncomplete = movieData && (
                    !movieData.description || 
                    !movieData.genres || 
                    movieData.genres.length === 0 ||
                    movieData.name === 'Loading...' ||
                    movieData.name === 'Unknown Movie'
                );

                if (!movieData || isIncomplete) {
                    try {
                        // console.log(`Cache miss or incomplete for ${rating.movieId}, fetching from API... (${index + 1}/${ratings.length})`);
                        movieData = await kinopoiskService.getMovieById(rating.movieId);
                        
                        if (movieData) {
                            await movieCacheService.cacheMovie(movieData, true);
                            apiHits++;
                        }
                    } catch (fetchError) {
                        console.warn(`Failed to fetch movie ${rating.movieId} from API:`, fetchError);
                        if (!movieData) {
                            movieData = {
                                kinopoiskId: rating.movieId,
                                name: 'Unknown Movie',
                                year: '',
                                genres: [],
                                description: '',
                                posterUrl: ''
                            };
                        }
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
                    option.addEventListener('mousedown', (e) => {
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
                    const name = typeof Utils !== 'undefined' && Utils.extractGenreName
                        ? Utils.extractGenreName(genre)
                        : (typeof genre === 'string' ? genre.trim() : (genre?.name ? String(genre.name).trim() : (genre?.genre ? String(genre.genre).trim() : '')));
                    if (name) genres.add(name);
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
                    option.addEventListener('mousedown', (e) => {
                        e.stopPropagation();
                        this.selectDropdownOption('genreFilter', genre, genre);
                    });
                    dropdownList.appendChild(option);
                });
            }
            if (currentSelection && genres.has(currentSelection)) {
                genreFilter.value = currentSelection;
            }
        }
    }

    getDisplayNameForUser(userId, userDisplayName, userName, userEmail) {
        const profileId = String(userId || '').trim();
        let userProfile = profileId ? this.userProfilesMap.get(profileId) : null;
        
        let targetDisplayName = null;
        if (userProfile && typeof Utils !== 'undefined' && Utils.getDisplayName) {
            targetDisplayName = Utils.getDisplayName(userProfile, null);
        } else {
            // If the ID lookup failed, try searching the map for a profile matching the email or name as a last resort
            if (userEmail || userDisplayName) {
                for (const profile of this.userProfilesMap.values()) {
                    if ((userEmail && profile.email === userEmail) || 
                        (userDisplayName && profile.displayName === userDisplayName)) {
                        userProfile = profile;
                        targetDisplayName = Utils.getDisplayName(profile, null);
                        break;
                    }
                }
            }
            
            if (!targetDisplayName) {
                targetDisplayName = userDisplayName || userName || userEmail?.split('@')[0] || 'Unknown User';
            }
        }

        if (profileId === 'some_suspicious_id_or_debug_all') {
             // Optional: specifically log for certain users
        }
        
        if (this.debug) {
            console.log(`[getDisplayNameForUser] ID: "${profileId}", Name: "${userDisplayName || 'N/A'}". Profile found: ${!!userProfile}. Resolved: "${targetDisplayName}"`);
        }
        return targetDisplayName;
    }

    getUserPhoto(userId, userPhoto) {
        if (userId) {
            const userProfile = this.userProfilesMap.get(userId);
            if (userProfile?.photoURL) {
                return userProfile.photoURL;
            }
        }
        return userPhoto || '/src/shared/assets/icons/app/icon48.png';
    }

    extractAndPopulateUsers(ratings) {
        const usersMap = new Map();
        
        ratings.forEach(rating => {
            const raters = rating.allRaters || [rating];
            raters.forEach(r => {
                if (r.userId && (r.userEmail || r.userName || r.userDisplayName)) {
                    const displayName = this.getDisplayNameForUser(
                        r.userId,
                        r.userDisplayName,
                        r.userName,
                        r.userEmail
                    );
                    usersMap.set(r.userId, {
                        id: r.userId,
                        email: r.userEmail,
                        displayName: displayName
                    });
                }
            });
        });
        
        this.allUsers = Array.from(usersMap.values()).sort((a, b) => 
            a.displayName.localeCompare(b.displayName)
        );
        
        const userFilter = this.elements.userFilter;
        if (userFilter) {
            const allUsersLabel = i18n.get('ratings.filters.all_users') || 'All Users';
            userFilter.innerHTML = `<option value="">${allUsersLabel}</option>`;
            
            this.allUsers.forEach(user => {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = user.displayName;
                userFilter.appendChild(option);
            });
            
            if (this.dropdowns?.userFilter) {
                const dropdownList = this.dropdowns.userFilter.list;
                dropdownList.innerHTML = `<div class="dropdown-option" data-value="">${allUsersLabel}</div>`;
                
                this.allUsers.forEach(user => {
                    const option = document.createElement('div');
                    option.className = 'dropdown-option';
                    option.setAttribute('data-value', user.id);
                    option.textContent = user.displayName;
                    option.addEventListener('mousedown', (e) => {
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
            const filterGenreLower = this.filters.genre.toLowerCase();
            filtered = filtered.filter(movie => 
                movie.movie?.genres?.some(genre => {
                    const name = typeof Utils !== 'undefined' && Utils.extractGenreName
                        ? Utils.extractGenreName(genre)
                        : (typeof genre === 'string' ? genre : (genre?.name || genre?.genre || ''));
                    return typeof name === 'string' && name.toLowerCase().includes(filterGenreLower);
                })
            );
        }
        
        // Year filter
        if (this.filters.year) {
            filtered = filtered.filter(movie => 
                movie.movie?.year?.toString() === this.filters.year
            );
        }
        
        // Average rating filter
        if (this.filters.avgRatingFrom !== 1.0 || this.filters.avgRatingTo !== 10.0) {
            filtered = filtered.filter(movie => 
                Number.isFinite(Number(movie.averageRating)) &&
                Number(movie.averageRating) >= this.filters.avgRatingFrom &&
                Number(movie.averageRating) <= this.filters.avgRatingTo
            );
        }
        
        // User filter (only in all-ratings mode)
        if (this.filters.user && this.currentMode === 'all-ratings') {
            filtered = filtered.filter(movie => {
                const raters = movie.allRaters || [movie];
                return raters.some(r => r.userId === this.filters.user);
            });
        }
        
        // Sort
        this.sortMovies(filtered);
        
        this.filteredMovies = filtered;
        this.renderMovies();
        this.updateResultsInfo();
        this.renderActiveTags();
        this.saveFiltersToStorage();
    }

    renderActiveTags() {
        if (!this.elements.activeFiltersList) return;
        
        const tags = [];
        
        if (this.filters.search) {
            tags.push({ type: 'search', label: `Search: ${this.filters.search}` });
        }
        
        if (this.filters.genre) {
            tags.push({ type: 'genre', label: `Genre: ${this.filters.genre}` });
        }
        
        if (this.filters.year) {
            tags.push({ type: 'year', label: `Year: ${this.filters.year}` });
        }
        
        if (this.filters.avgRatingFrom !== 1.0 || this.filters.avgRatingTo !== 10.0) {
            tags.push({ 
                type: 'avgRating', 
                label: `Rating: ${this.filters.avgRatingFrom.toFixed(1)} - ${this.filters.avgRatingTo.toFixed(1)}` 
            });
        }
        
        if (this.filters.user) {
            const user = this.allUsers.find(u => u.id === this.filters.user);
            tags.push({ type: 'user', label: `User: ${user ? user.displayName : this.filters.user}` });
        }
        
        // Render tags
        this.elements.activeFiltersList.innerHTML = '';
        
        if (tags.length > 0) {
            tags.forEach(tag => {
                const tagEl = document.createElement('div');
                tagEl.className = 'filter-tag';
                tagEl.innerHTML = `
                    <span>${tag.label}</span>
                    <span class="remove-filter" data-filter-type="${tag.type}">×</span>
                `;
                this.elements.activeFiltersList.appendChild(tagEl);
            });
            this.elements.activeFiltersContainer.style.display = 'flex';
        } else {
            this.elements.activeFiltersContainer.style.display = 'none';
        }
    }



    removeFilter(type) {
        switch (type) {
            case 'search':
                this.filters.search = '';
                if (this.elements.movieSearchInput) this.elements.movieSearchInput.value = '';
                break;
            case 'genre':
                this.filters.genre = '';
                this.updateDropdownValue('genreFilter', '');
                break;
            case 'year':
                this.filters.year = '';
                this.updateDropdownValue('yearFilter', '');
                break;
            case 'avgRating': {
                this.filters.avgRatingFrom = 1.0;
                this.filters.avgRatingTo = 10.0;
                if (this.elements.avgRatingFrom) this.elements.avgRatingFrom.value = 1.0;
                if (this.elements.avgRatingTo) this.elements.avgRatingTo.value = 10.0;
                // Trigger slider update visually
                const event = new Event('input');
                this.elements.avgRatingFrom?.dispatchEvent(event);
                this.loadMovies();
                return;
            }
            case 'user':
                this.filters.user = '';
                this.updateDropdownValue('userFilter', '');
                break;
        }
        this.applyFilters();
    }

    initDoubleSlider(fromInput, toInput, fromDisplay, toDisplay, sliderRange, onChange) {
        const updateSlider = (evt) => {
            const min = parseFloat(fromInput.value);
            const max = parseFloat(toInput.value);

            if (min > max) {
                if (evt?.target === fromInput) {
                    fromInput.value = max;
                } else {
                    toInput.value = min;
                }
            }

            const finalMin = Math.min(parseFloat(fromInput.value), parseFloat(toInput.value));
            const finalMax = Math.max(parseFloat(fromInput.value), parseFloat(toInput.value));

            fromDisplay.textContent = finalMin.toFixed(1);
            toDisplay.textContent = finalMax.toFixed(1);

            // Update track highlights
            const percent1 = ((finalMin - 1) / 9) * 100;
            const percent2 = ((finalMax - 1) / 9) * 100;
            
            sliderRange.style.left = percent1 + '%';
            sliderRange.style.width = (percent2 - percent1) + '%';
        };

        const handleInput = (e) => {
            updateSlider(e);
        };

        const handleChange = (e) => {
            const min = Math.min(parseFloat(fromInput.value), parseFloat(toInput.value));
            const max = Math.max(parseFloat(fromInput.value), parseFloat(toInput.value));
            onChange(min, max);
        };

        fromInput.addEventListener('input', handleInput);
        toInput.addEventListener('input', handleInput);
        fromInput.addEventListener('change', handleChange);
        toInput.addEventListener('change', handleChange);

        // Initial update
        updateSlider();
    }

    updateSortFilterUIState() {
        const isFilterActive = this.filters.avgRatingFrom > 1.0 || this.filters.avgRatingTo < 10.0;
        const sortFilter = this.elements.sortFilter;

        if (sortFilter) {
            sortFilter.disabled = isFilterActive;
        }

        const dropdown = this.dropdowns?.sortFilter;
        const dropdownElement = dropdown?.element || dropdown?.container;
        if (dropdownElement) {
            if (isFilterActive) {
                dropdownElement.style.pointerEvents = 'none';
                dropdownElement.style.opacity = '0.6';
                dropdownElement.title = 'Сортировка зафиксирована по среднему рейтингу, пока активен фильтр рейтинга';
            } else {
                dropdownElement.style.pointerEvents = 'auto';
                dropdownElement.style.opacity = '1';
                dropdownElement.title = '';
            }
        }
    }

    sortMovies(movies) {
        const [field, direction] = this.filters.sort.split('-');

        // Targeted debug logging for diagnostic verification
        const debugTitles = ['за пивом', 'звёздные войны'];
        movies.forEach(m => {
            const name = (m.movie?.name || '').toLowerCase();
            if (debugTitles.some(t => name.includes(t))) {
                const computedTs = getTimestamp(m.createdAt);
                console.log(`[SortDebug] Movie: "${m.movie?.name}", raw createdAt:`, m.createdAt, `-> parsed timestamp:`, computedTs, `(${new Date(computedTs).toISOString()})`);
            }
        });

        movies.sort((a, b) => {
            let valueA, valueB;
            
            switch (field) {
                case 'date':
                    valueA = getTimestamp(a.createdAt);
                    valueB = getTimestamp(b.createdAt);
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
            
            if (valueA === valueB) {
                // Secondary tie-breaker by ID to guarantee deterministic order
                const idA = Number(a.movieId || a.kinopoiskId || 0);
                const idB = Number(b.movieId || b.kinopoiskId || 0);
                return direction === 'desc' ? idB - idA : idA - idB;
            }

            if (typeof valueA === 'string' && typeof valueB === 'string') {
                return direction === 'desc' ? valueB.localeCompare(valueA) : valueA.localeCompare(valueB);
            }

            return direction === 'desc' ? (valueB - valueA) : (valueA - valueB);
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
                const key = child.getAttribute('data-movie-id') || child.getAttribute('data-rating-id');
                if (key) existingCards.set(key, child);
            }
        });

        // Use a document fragment for new items if we were clearing, but here we update in place
        // Actually, for list reconciliation, we can just iterate and insertBefore
        
        let currentIdx = 0;
        
        this.filteredMovies.forEach((movieData) => {
            const key = (movieData.movieId || movieData.movie?.kinopoiskId || movieData.id).toString();
            let card = existingCards.get(key);
            
            const currentSignature = this.buildRenderSignature(movieData);
            
            // If card doesn't exist (new item), create it
            if (!card) {
                card = this.createMovieCard(movieData);
                // Ensure the card has the ID for future diffing
                if (movieData.id) card.setAttribute('data-rating-id', movieData.id);
                if (movieData.movieId || movieData.kinopoiskId) {
                    card.setAttribute('data-movie-id', movieData.movieId || movieData.kinopoiskId);
                }
                this.renderedMoviesState.set(key, currentSignature);
            } else {
                existingCards.delete(key);
                
                // Compare with previous signature
                const oldSignature = this.renderedMoviesState.get(key);
                if (oldSignature === currentSignature) {
                    // Item is identical, skip DOM update
                    const childAtPosition = grid.children[currentIdx];
                    if (childAtPosition !== card) {
                        if (childAtPosition) {
                            grid.insertBefore(card, childAtPosition);
                        } else {
                            grid.appendChild(card);
                        }
                    }
                    currentIdx++;
                    return;
                }
                
                // Save the new state signature
                this.renderedMoviesState.set(key, currentSignature);
                
                // create a temporary new card to extract the latest enriched HTML
                const newCardHTML = this.createMovieCard(movieData);
                
                // Update movie title if changed (cache → enriched)
                const titleEl = card.querySelector('.mc-title');
                const newTitleEl = newCardHTML.querySelector('.mc-title');
                if (titleEl && newTitleEl) {
                    if (titleEl.textContent.trim() !== newTitleEl.textContent.trim()) {
                        titleEl.textContent = newTitleEl.textContent;
                        titleEl.title = newTitleEl.title;
                    }
                    if (!newTitleEl.classList.contains('mc-skeleton')) {
                        titleEl.classList.remove('mc-skeleton');
                    }
                }

                // Update movie poster if changed
                const posterContainer = card.querySelector('.mc-poster-container');
                const newPosterContainer = newCardHTML.querySelector('.mc-poster-container');
                if (posterContainer && newPosterContainer && !newPosterContainer.classList.contains('mc-skeleton')) {
                    posterContainer.classList.remove('mc-skeleton');
                }

                const posterEl = card.querySelector('.mc-poster');
                const newPosterEl = newCardHTML.querySelector('.mc-poster');
                if (posterEl && newPosterEl) {
                    const newPosterSrc = newPosterEl.getAttribute('src');
                    if (posterEl.getAttribute('src') !== newPosterSrc) {
                        posterEl.src = newPosterSrc;
                        posterEl.alt = newPosterEl.alt;
                    }
                }

                // Update movie year
                const yearEl = card.querySelector('.mc-year');
                const newYearEl = newCardHTML.querySelector('.mc-year');
                if (yearEl && newYearEl) {
                    if (yearEl.textContent.trim() !== newYearEl.textContent.trim()) {
                        yearEl.textContent = newYearEl.textContent;
                    }
                    if (!newYearEl.classList.contains('mc-skeleton')) {
                        yearEl.classList.remove('mc-skeleton');
                    }
                }

                // Update movie genres
                const genresEl = card.querySelector('.mc-genres');
                const newGenresEl = newCardHTML.querySelector('.mc-genres');
                if (genresEl && newGenresEl) {
                    if (genresEl.innerHTML !== newGenresEl.innerHTML) {
                        genresEl.innerHTML = newGenresEl.innerHTML;
                    }
                    if (!newGenresEl.classList.contains('mc-skeleton')) {
                        genresEl.classList.remove('mc-skeleton');
                        genresEl.style.height = '';
                        genresEl.style.borderRadius = '';
                    }
                }

                // Update KP and IMDb ratings
                const kpEl = card.querySelector('.mc-rating-kp');
                const newKpEl = newCardHTML.querySelector('.mc-rating-kp');
                if (kpEl && newKpEl && kpEl.textContent.trim() !== newKpEl.textContent.trim()) {
                    kpEl.textContent = newKpEl.textContent;
                }

                const imdbEl = card.querySelector('.mc-rating-imdb');
                const newImdbEl = newCardHTML.querySelector('.mc-rating-imdb');
                if (imdbEl && newImdbEl && imdbEl.textContent.trim() !== newImdbEl.textContent.trim()) {
                    imdbEl.textContent = newImdbEl.textContent;
                }

                // Update movie description
                let descEl = card.querySelector('.mc-description');
                const newDescEl = newCardHTML.querySelector('.mc-description');
                if (newDescEl) {
                    if (descEl) {
                        if (descEl.textContent.trim() !== newDescEl.textContent.trim()) {
                            descEl.textContent = newDescEl.textContent;
                        }
                    } else {
                        // If description was missing but now exists, insert it after genres
                        const genresArea = card.querySelector('.mc-genres');
                        if (genresArea) {
                            genresArea.insertAdjacentHTML('afterend', newDescEl.outerHTML);
                        } else {
                            const titleRow = card.querySelector('.mc-title-row');
                            if (titleRow) {
                                titleRow.insertAdjacentHTML('afterend', newDescEl.outerHTML);
                            }
                        }
                    }
                } else if (descEl) {
                    descEl.remove();
                }

                // Update user info section (avatar, name, rating, raters count, raters popup)
                const oldUserInfo = card.querySelector('.mc-user-info');
                const newUserInfo = newCardHTML.querySelector('.mc-user-info');
                if (oldUserInfo && newUserInfo) {
                    if (oldUserInfo.innerHTML !== newUserInfo.innerHTML) {
                        oldUserInfo.innerHTML = newUserInfo.innerHTML;
                    }
                } else if (!oldUserInfo && newUserInfo) {
                    const contentEl = card.querySelector('.mc-content');
                    if (contentEl) {
                        contentEl.appendChild(newUserInfo.cloneNode(true));
                    }
                } else if (oldUserInfo && !newUserInfo) {
                    oldUserInfo.remove();
                }

                // Update average rating if data has changed (e.g. cache → enriched data)
                const avgRatingEl = card.querySelector('.mc-rating-avg');
                const newAvgRatingEl = newCardHTML.querySelector('.mc-rating-avg');
                if (avgRatingEl && newAvgRatingEl) {
                    if (avgRatingEl.textContent.trim() !== newAvgRatingEl.textContent.trim()) {
                        avgRatingEl.textContent = newAvgRatingEl.textContent;
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
            if (action === 'stop-propagation') return;
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
                    
                case 'toggle-watched':
                    if (movieId) {
                        this.handleWatchedToggle(movieId, target);
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

            const raterRow = e.target.closest('.mc-rater-row.clickable-rater');
            if (raterRow) {
                e.stopPropagation();
                const userId = raterRow.getAttribute('data-user-id');
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
            userPhoto: this.getUserPhoto(movieData.userId || movieData.uid, movieData.userPhoto),
            userDisplayName: this.getDisplayNameForUser(
                movieData.userId || movieData.uid,
                movieData.userDisplayName,
                movieData.userName,
                movieData.userEmail
            )
        };
        
        if (enrichedData.allRaters) {
            enrichedData.allRaters = enrichedData.allRaters.map(r => ({
                ...r,
                userPhoto: this.getUserPhoto(r.userId || r.uid, r.userPhoto),
                userDisplayName: this.getDisplayNameForUser(r.userId || r.uid, r.userDisplayName, r.userName, r.userEmail)
            }));
        }

        // Clean titles
        if (enrichedData.name) enrichedData.name = Utils.cleanTitle(enrichedData.name);
        if (enrichedData.movie && enrichedData.movie.name) enrichedData.movie.name = Utils.cleanTitle(enrichedData.movie.name);
        
        // Use the new MovieCard component
        const card = MovieCard.create(enrichedData, {
            showFavorite: !!movieData.rating,
            showWatching: !!movieData.rating,
            showWatchlist: !!movieData.rating,
            showWatched: true,
            showUserInfo: true,
            showEditRating: false,
            showAddToCollection: false,
            isWatching: movieData.isWatching || movieData.status === 'watching' || false,
            isInWatchlist: movieData.isInWatchlist || movieData.status === 'plan_to_watch' || false,
            isWatched: movieData.status === 'watched',
            userInfoLoading: !this.userProfilesMap.has(movieData.userId),
            animeStyle: false,
            
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
            Utils.toggleActionButton(button, isActive, {
                active: 'Remove from Favorites',
                inactive: 'Add to Favorites'
            }, {
                active: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>',
                inactive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>'
            });
        } else if (type === 'watching') {
            button.setAttribute('data-is-watching', isActive);
            Utils.toggleActionButton(button, isActive, {
                active: 'Remove from Watching',
                inactive: 'Add to Watching'
            }, {
                active: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
                inactive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'
            });
        } else if (type === 'watchlist') {
            button.setAttribute('data-is-in-watchlist', isActive);
            Utils.toggleActionButton(button, isActive, {
                active: 'Remove from Plan to Watch',
                inactive: 'Add to Plan to Watch'
            }, {
                active: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>',
                inactive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>'
            });
        } else if (type === 'watched') {
            button.setAttribute('data-is-watched', isActive);
            Utils.toggleActionButton(button, isActive, {
                active: 'Remove from Watched',
                inactive: 'Add to Watched'
            }, {
                active: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
                inactive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
            });
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
        const watchedBtn = card.querySelector('[data-action="toggle-watched"]');

        this.updateButtonState(favBtn, 'favorite', movieData.status === 'favorite');
        this.updateButtonState(watchBtn, 'watching', movieData.status === 'watching');
        this.updateButtonState(planBtn, 'watchlist', movieData.status === 'plan_to_watch');
        this.updateButtonState(watchedBtn, 'watched', movieData.status === 'watched');
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

    async handleWatchedToggle(movieId, buttonElement) {
        if (!this.checkAuth()) return;

        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const movieData = this.filteredMovies.find(m => (m.movie?.kinopoiskId || m.movieId) == movieId);
            if (!movieData) return;

            const isWatched = movieData.status === 'watched';

            if (isWatched) {
                // Remove
                await favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
                movieData.status = null;
                
                this.updateButtonState(buttonElement, 'watched', false);
                if (typeof Utils !== 'undefined') Utils.showToast('Removed from Watched', 'success');
            } else {
                // Add to Watched
                await favoriteService.addToFavorites(this.currentUser.uid, {
                    ...movieData.movie,
                    movieId: movieId
                }, 'watched');
                
                movieData.isWatching = false;
                movieData.isFavorite = false;
                movieData.isInWatchlist = false;
                movieData.status = 'watched';
                
                this.updateButtonState(buttonElement, 'watched', true);
                this.refreshCardButtons(movieId);
                
                if (typeof Utils !== 'undefined') Utils.showToast('Added to Watched', 'success');
            }

        } catch (error) {
            console.error('Error toggling watched:', error);
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
            let checkSpan = Array.from(buttonElement.children).find(child => child.classList?.contains('mc-collection-check') || child.textContent.includes('✓') || child.querySelector('svg'));
            const isChecked = !!checkSpan;
            
            if (isChecked) {
                checkSpan.remove();
                if (textSpan) {
                    textSpan.style.fontWeight = 'normal';
                    textSpan.style.color = '';
                }
            } else {
                const newCheck = document.createElement('span');
                newCheck.className = 'mc-collection-check';
                newCheck.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
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
                    Utils.showToast('Добавлено в Watchlist', 'success');
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
                <img src="${movie?.posterUrl || '/src/shared/assets/icons/app/icon48.png'}" 
                     alt="${movie?.name}" 
                     style="width: 150px; height: 200px; object-fit: cover; border-radius: 8px;"
                     onerror="Utils.handlePosterError(this)">
                <div style="flex: 1;">
                    <h3 style="margin: 0 0 10px 0;">${this.escapeHtml(movie?.name || 'Unknown Movie')}</h3>
                    <p style="color: #666; margin: 0 0 10px 0;">${movie?.year || ''} • ${(typeof Utils !== 'undefined' && Utils.formatGenres ? Utils.formatGenres(movie?.genres) : (Array.isArray(movie?.genres) ? movie.genres.filter(Boolean).join(', ') : ''))}</p>
                    <div style="margin: 15px 0;">
                        <strong>My Rating:</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> ${rating}/10<br>
                        <strong>Average Rating:</strong> ${avgDisplay}
                    </div>
                    ${comment ? `
                        <div style="margin: 15px 0;">
                            <strong>My Comment:</strong><br>
                            <em class="user-comment-text">"${Utils.parseSpoilers(this.escapeHtml(comment))}"</em>
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
                <img src="${movie.posterUrl || '/src/shared/assets/icons/app/icon48.png'}" alt="${movie.name}" class="movie-detail-poster">
                <div class="movie-detail-info">
                    <h3 class="movie-detail-title">${this.escapeHtml(movie.name)}</h3>
                    <p class="movie-detail-meta">${movie.year} • ${(typeof Utils !== 'undefined' && Utils.formatGenres ? Utils.formatGenres(movie.genres, 3) : (Array.isArray(movie.genres) ? movie.genres.slice(0, 3).filter(Boolean).join(', ') : ''))}</p>
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
        this.elements.existingRatingComment.innerHTML = currentComment ? Utils.parseSpoilers(this.escapeHtml(currentComment)) : 'No comment';
        
        // Set form values
        this.elements.ratingSlider.value = currentRating;
        this.elements.ratingValue.textContent = currentRating;
        this.elements.ratingComment.value = currentComment || '';
        this.elements.charCount.textContent = (currentComment || '').length;
        
        this.elements.ratingModal.style.display = 'flex';
    }

    async saveRating() {
        if (!this.elements.ratingSlider || !this.elements.ratingComment) return;
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
            
            const photoURL = userProfile?.photoURL || this.currentUser.photoURL || '';
            const movieId = this.selectedMovie.kinopoiskId || this.selectedMovie.movieId;
            
            // Backup old states for rollback
            const oldMoviesState = JSON.parse(JSON.stringify(this.movies));
            const oldRawRatingsState = JSON.parse(JSON.stringify(this.allRawRatings));
            
            let addedNew = false;
            
            // 1. Update this.movies
            const movieIndex = this.movies.findIndex(m => (m.movie?.kinopoiskId || m.movieId) === movieId);
            if (movieIndex > -1) {
                const movieItem = this.movies[movieIndex];
                movieItem.rating = rating;
                movieItem.comment = comment;
                movieItem.updatedAt = new Date();
                movieItem.createdAt = new Date();
                if (movieItem.movie) movieItem.movie.lastRatingUpdatedAt = new Date();
                
                let raterIndex = movieItem.allRaters.findIndex(r => r.userId === this.currentUser.uid);
                if (raterIndex > -1) {
                    movieItem.allRaters[raterIndex].rating = rating;
                    movieItem.allRaters[raterIndex].comment = comment;
                    movieItem.allRaters[raterIndex].updatedAt = new Date();
                } else {
                    movieItem.allRaters.push({
                        userId: this.currentUser.uid,
                        userName: displayName,
                        userPhoto: photoURL,
                        movieId: movieId,
                        rating: rating,
                        comment: comment,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                }
                const sum = movieItem.allRaters.reduce((acc, r) => acc + r.rating, 0);
                movieItem.averageRating = Math.round((sum / movieItem.allRaters.length) * 10) / 10;
                movieItem.ratingsCount = movieItem.allRaters.length;
            } else {
                addedNew = true;
                const newMovieItem = {
                    id: `opt_${Date.now()}`,
                    movieId: movieId,
                    rating: rating,
                    comment: comment,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    allRaters: [
                        {
                            userId: this.currentUser.uid,
                            userName: displayName,
                            userPhoto: photoURL,
                            movieId: movieId,
                            rating: rating,
                            comment: comment,
                            createdAt: new Date(),
                            updatedAt: new Date()
                        }
                    ],
                    averageRating: rating,
                    ratingsCount: 1,
                    movie: this.selectedMovie
                };
                this.movies.unshift(newMovieItem);
            }
            
            // 2. Update this.allRawRatings
            const rawIndex = this.allRawRatings.findIndex(r => r.movieId === movieId);
            if (rawIndex > -1) {
                const rawItem = this.allRawRatings[rawIndex];
                rawItem.rating = rating;
                rawItem.comment = comment;
                rawItem.updatedAt = new Date();
                
                let raterIndex = rawItem.allRaters.findIndex(r => r.userId === this.currentUser.uid);
                if (raterIndex > -1) {
                    rawItem.allRaters[raterIndex].rating = rating;
                    rawItem.allRaters[raterIndex].comment = comment;
                    rawItem.allRaters[raterIndex].updatedAt = new Date();
                } else {
                    rawItem.allRaters.push({
                        userId: this.currentUser.uid,
                        userName: displayName,
                        userPhoto: photoURL,
                        movieId: movieId,
                        rating: rating,
                        comment: comment,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                }
                const sum = rawItem.allRaters.reduce((acc, r) => acc + r.rating, 0);
                rawItem.averageRating = Math.round((sum / rawItem.allRaters.length) * 10) / 10;
                rawItem.ratingsCount = rawItem.allRaters.length;
            } else {
                this.allRawRatings.unshift({
                    id: `opt_${Date.now()}`,
                    movieId: movieId,
                    rating: rating,
                    comment: comment,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    allRaters: [
                        {
                            userId: this.currentUser.uid,
                            userName: displayName,
                            userPhoto: photoURL,
                            movieId: movieId,
                            rating: rating,
                            comment: comment,
                            createdAt: new Date(),
                            updatedAt: new Date()
                        }
                    ],
                    averageRating: rating,
                    ratingsCount: 1
                });
            }
            
            // Close modal and apply filters immediately
            this.closeRatingModal();
            this.applyFilters();
            
            if (typeof Utils !== 'undefined') {
                Utils.showToast(movieIndex > -1 ? 'Rating updated' : 'Rating added', 'success');
            }
            
            // Perform Firestore write in background
            ratingService.addOrUpdateRating(
                this.currentUser.uid,
                displayName,
                photoURL,
                movieId,
                rating,
                comment,
                this.selectedMovie
            ).then((actualRating) => {
                console.log('Optimistic rating confirmed by Firestore:', actualRating);
                // Update temporary opt_ IDs with real ones
                if (addedNew) {
                    const freshIndex = this.movies.findIndex(m => (m.movie?.kinopoiskId || m.movieId) === movieId);
                    if (freshIndex > -1) {
                        this.movies[freshIndex].id = actualRating.id;
                    }
                    const freshRawIndex = this.allRawRatings.findIndex(r => r.movieId === movieId);
                    if (freshRawIndex > -1) {
                        this.allRawRatings[freshRawIndex].id = actualRating.id;
                    }
                }
            }).catch((err) => {
                console.error('Optimistic rating failed:', err);
                if (typeof Utils !== 'undefined') {
                    Utils.showToast('Failed to save rating. Rolling back.', 'error');
                }
                // Rollback states
                this.movies = oldMoviesState;
                this.allRawRatings = oldRawRatingsState;
                this.applyFilters();
            });
            
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

    showEmptyState() {
        if (this.elements.emptyState) this.elements.emptyState.style.display = 'flex';
        if (this.elements.moviesGrid) this.elements.moviesGrid.style.display = 'none';
    }

    hideEmptyState() {
        if (this.elements.emptyState) this.elements.emptyState.style.display = 'none';
        // Grid visibility is handled by this.page.showContent()
    }

    clearFilters() {
        this.filters = {
            search: '',
            genre: '',
            year: '',
            avgRatingFrom: 1.0,
            avgRatingTo: 10.0,
            user: '',
            sort: 'date-desc'
        };
        
        if (this.elements.movieSearchInput) this.elements.movieSearchInput.value = '';
        this.updateDropdownValue('genreFilter', '');
        this.updateDropdownValue('yearFilter', '');
        this.updateDropdownValue('userFilter', '');
        
        // Reset slider
        if (this.elements.avgRatingFrom) this.elements.avgRatingFrom.value = 1.0;
        if (this.elements.avgRatingTo) this.elements.avgRatingTo.value = 10.0;
        const event = new Event('input');
        this.elements.avgRatingFrom?.dispatchEvent(event);
        
        this.loadMovies();
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
        
        const isRussian = window.i18n?.currentLocale === 'ru';
        const countText = isRussian
            ? `Показано ${count} из ${total} фильмов`
            : `Showing ${count} of ${total} movies`;
            
        this.elements.resultsCount.textContent = countText;
        
        const modeText = isRussian ? 'Все оценки' : 'All Ratings';
        this.elements.resultsMode.textContent = modeText;
    }

    // Local showLoading/showError/hideError removed in favor of this.page (PageStateManager)

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

    toggleFilters() {
        if (!this.elements.filtersSection) return;
        
        const isCollapsed = this.elements.filtersSection.classList.toggle('collapsed');
        localStorage.setItem('ratingsFiltersCollapsed', isCollapsed);
    }

    loadFiltersCollapseState() {
        const isCollapsed = localStorage.getItem('ratingsFiltersCollapsed') === 'true';
        if (isCollapsed && this.elements.filtersSection) {
            this.elements.filtersSection.classList.add('collapsed');
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.ratingsPage = new RatingsPageManager();
});
