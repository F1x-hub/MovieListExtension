import { i18n } from '../../shared/i18n/I18n.js';
import { getTimestamp } from '../../shared/utils/dateUtils.js';
import { buildProviderRatingCache, mergeProviderRatingsIntoMovies } from '../../shared/utils/providerRatings.js';

/**
 * Ratings Page Manager
 * Handles the Rated page functionality
 */
class RatingsPageManager {
    static CACHE_KEY_PREFIX = 'ratings_cache_';

    constructor() {
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
        this.fetchedProfileIds = new Set(); // Profile IDs already fetched from Firestore this session
        this.availableCollections = []; // Store for menu
        this.renderedMoviesState = new Map(); // Store rendered movie signatures for diffing
        this.pendingStatusActions = new Set(); // Movie IDs with a bookmark/status write in flight
        // Live updates (newest rated movies listener + revalidation on return)
        this.liveUnsubscribe = null;
        this.liveSeenTimestamps = null; // movieId -> lastRatingUpdatedAt ms; null until the baseline snapshot
        this.liveBaselineMinTs = 0;
        this.pendingLiveMovies = new Map(); // movieId -> movie document awaiting display
        this.recentLocalEdits = new Map(); // movieId -> ms of a rating saved from this page
        this.applyingLive = false;
        this.lastRevalidateAt = 0;
        this.cacheSnapshot = null; // { timestamp, ids } of the cached first screen
        this.nextBatchPromise = null;
        this.BATCH_SIZE = 12;
        // Client-only sorts read every page: larger pages, one render at the end
        this.CLIENT_SORT_BATCH_SIZE = 40;
        this.bulkLoading = false;
        this.isSavingRating = false;
        this.modalReturnFocus = null;
        this._moviesLoadTriggered = false;
        this.init();
    }

    /** Localized ratings page message (`ratings.toast.*`). */
    t(key) {
        return i18n.get(`ratings.toast.${key}`);
    }

    /** Localized ratings page text (`ratings.*`) with `{name}` placeholders filled in. */
    text(key, params = {}) {
        return Object.entries(params).reduce(
            (result, [name, value]) => result.split(`{${name}}`).join(String(value)),
            i18n.get(`ratings.${key}`)
        );
    }

    isUserInfoLoading(movieData) {
        const id = String(movieData?.userId || movieData?.uid || '').trim();
        return !this.userProfilesMap.has(id) && !this.fetchedProfileIds.has(id);
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
            // Must match createMovieCard's userInfoLoading, or a profile that arrives with
            // the same name/photo as the fallback would leave the skeleton in place.
            userInfoLoading: this.isUserInfoLoading(movieData),
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
        // Legacy ?collection= links belong to the collection page; leave before any work
        const collectionId = new URLSearchParams(window.location.search).get('collection');
        if (collectionId) {
            window.location.href = chrome.runtime.getURL(`src/pages/collection/collection.html?id=${encodeURIComponent(collectionId)}`);
            return;
        }

        this.initializeElements();
        // Registered before Utils.bindMovieCardNavigation so card actions and profile
        // links can stop the card's own navigation listener on the same grid.
        this.setupGridEventListeners();
        // Standardized movie card navigation, bound before cached cards render.
        // (Previously passed the undefined this.moviesGrid, so it never bound.)
        Utils.bindMovieCardNavigation(this.elements.moviesGrid);

        await i18n.init();
        i18n.translatePage();
        document.documentElement.lang = i18n.currentLocale;
        document.title = this.text('page_title');

        // Restore saved filters before the cached render: applyFilters() persists the
        // current filters, so rendering first used to overwrite them with defaults.
        this.initializeCustomDropdowns();
        this.loadFiltersFromStorage();
        this.loadFiltersCollapseState();

        // Load cached ratings immediately
        await this.loadCachedRatings();

        this.setupEventListeners();

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
        
        // Spoiler reveal logic
        Utils.bindSpoilerReveal(document);
        
        // Single controlled initial load
        this.ensureInitialLoad('init: end of initialization');
    }


    initializeElements() {
        this.elements = {
            // Filters
            movieSearchInput: document.getElementById('movieSearchInput'),
            genreFilter: document.getElementById('genreFilter'),
            yearFilter: document.getElementById('yearFilter'),
            avgRatingFrom: document.getElementById('avgRatingFrom'),
            avgRatingTo: document.getElementById('avgRatingTo'),
            avgRatingMinDisplay: document.getElementById('avgRatingMinDisplay'),
            avgRatingMaxDisplay: document.getElementById('avgRatingMaxDisplay'),
            avgRatingRange: document.getElementById('avgRatingRange'),
            userFilter: document.getElementById('userFilter'),
            sortFilter: document.getElementById('sortFilter'),
            clearFiltersBtn: document.getElementById('clearFiltersBtn'),
            
            // Content areas
            loadingSection: document.getElementById('loadingSection'),
            moviesGrid: document.getElementById('moviesGrid'),
            emptyState: document.getElementById('emptyState'),
            emptyStateSearchBtn: document.getElementById('emptyStateSearchBtn'),
            livePill: document.getElementById('ratingsLivePill'),
            livePillText: document.getElementById('ratingsLivePillText'),
            errorState: document.getElementById('errorState'),
            retryBtn: document.getElementById('retryBtn'),
            
            // Results info
            resultsCount: document.getElementById('resultsCount'),
            resultsMode: document.getElementById('resultsMode'),
            
            // Rating modal (edit own rating)
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

    /**
     * Custom filter dropdowns (listbox pattern). Triggers are real buttons, so mouse,
     * Enter and Space all open them through `click`; arrow keys move between options,
     * Enter/Space select, Escape closes and returns focus to the trigger. Option
     * clicks are delegated on the list, so rebuilt option lists need no listeners.
     */
    initializeCustomDropdowns() {
        this.dropdowns = {};
        const dropdownElements = document.querySelectorAll('.custom-dropdown');

        dropdownElements.forEach(dropdown => {
            const dropdownId = dropdown.getAttribute('data-dropdown');
            const trigger = dropdown.querySelector('.dropdown-trigger');
            const list = dropdown.querySelector('.dropdown-list');
            const hiddenSelect = dropdown.querySelector('.filter-select-hidden');

            if (!dropdownId || !trigger || !list || !hiddenSelect) return;

            this.dropdowns[dropdownId] = {
                element: dropdown,
                trigger: trigger,
                list: list,
                hiddenSelect: hiddenSelect,
                isOpen: false,
                optionsKey: null
            };

            if (!list.id) list.id = `${dropdownId}List`;
            list.setAttribute('role', 'listbox');
            list.tabIndex = -1;
            trigger.setAttribute('aria-haspopup', 'listbox');
            trigger.setAttribute('aria-controls', list.id);
            trigger.setAttribute('aria-expanded', 'false');
            this.decorateDropdownOptions(dropdownId);

            trigger.addEventListener('click', () => this.toggleDropdown(dropdownId, { focusOption: true }));
            trigger.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.openDropdown(dropdownId, { focusOption: true });
                }
            });

            list.addEventListener('click', (e) => {
                const option = e.target.closest('.dropdown-option');
                if (!option || !list.contains(option)) return;
                this.selectDropdownOption(dropdownId, option.getAttribute('data-value') ?? '', option.textContent.trim());
                trigger.focus();
            });
            list.addEventListener('keydown', (e) => this.handleDropdownKeydown(dropdownId, e));

            // Closes when focus leaves the dropdown (Tab, or a click elsewhere)
            dropdown.addEventListener('focusout', (e) => {
                if (!dropdown.contains(e.relatedTarget)) this.closeDropdown(dropdownId);
            });
        });

        document.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.custom-dropdown')) {
                this.closeAllDropdowns();
            }
        });
    }

    /** ARIA roles and selection state for the current options of a dropdown. */
    decorateDropdownOptions(dropdownId) {
        const dropdown = this.dropdowns?.[dropdownId];
        if (!dropdown) return;
        const selectedValue = dropdown.hiddenSelect?.value ?? '';
        dropdown.list.querySelectorAll('.dropdown-option').forEach(option => {
            const isSelected = (option.getAttribute('data-value') ?? '') === selectedValue;
            option.setAttribute('role', 'option');
            option.tabIndex = -1;
            option.setAttribute('aria-selected', String(isSelected));
            option.classList.toggle('selected', isSelected);
        });
    }

    getDropdownOptions(dropdownId) {
        const dropdown = this.dropdowns?.[dropdownId];
        return dropdown ? Array.from(dropdown.list.querySelectorAll('.dropdown-option')) : [];
    }

    handleDropdownKeydown(dropdownId, e) {
        const dropdown = this.dropdowns[dropdownId];
        if (!dropdown) return;
        const options = this.getDropdownOptions(dropdownId);
        const index = options.indexOf(document.activeElement);

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                options[Math.min(options.length - 1, index + 1)]?.focus();
                break;
            case 'ArrowUp':
                e.preventDefault();
                options[Math.max(0, index - 1)]?.focus();
                break;
            case 'Home':
                e.preventDefault();
                options[0]?.focus();
                break;
            case 'End':
                e.preventDefault();
                options[options.length - 1]?.focus();
                break;
            case 'Enter':
            case ' ':
                if (index > -1) {
                    e.preventDefault();
                    const option = options[index];
                    this.selectDropdownOption(dropdownId, option.getAttribute('data-value') ?? '', option.textContent.trim());
                    dropdown.trigger.focus();
                }
                break;
            case 'Escape':
                e.preventDefault();
                this.closeDropdown(dropdownId);
                dropdown.trigger.focus();
                break;
            case 'Tab':
                this.closeDropdown(dropdownId);
                break;
        }
    }

    openDropdown(dropdownId, { focusOption = false } = {}) {
        const dropdown = this.dropdowns[dropdownId];
        if (!dropdown || dropdown.trigger.disabled) return;
        if (!dropdown.isOpen) {
            this.closeAllDropdowns();
            dropdown.element.classList.add('open');
            dropdown.trigger.setAttribute('aria-expanded', 'true');
            dropdown.isOpen = true;
        }
        if (focusOption) {
            const options = this.getDropdownOptions(dropdownId);
            (options.find(option => option.classList.contains('selected')) || options[0])?.focus();
        }
    }

    closeDropdown(dropdownId) {
        const dropdown = this.dropdowns?.[dropdownId];
        if (!dropdown || !dropdown.isOpen) return;
        dropdown.element.classList.remove('open');
        dropdown.trigger.setAttribute('aria-expanded', 'false');
        dropdown.isOpen = false;
    }

    toggleDropdown(dropdownId, options = {}) {
        const dropdown = this.dropdowns[dropdownId];
        if (!dropdown) return;
        if (dropdown.isOpen) {
            this.closeDropdown(dropdownId);
        } else {
            this.openDropdown(dropdownId, options);
        }
    }

    closeAllDropdowns() {
        Object.keys(this.dropdowns || {}).forEach(dropdownId => this.closeDropdown(dropdownId));
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
            this.decorateDropdownOptions(dropdownId);
            const changeEvent = new Event('change', { bubbles: true });
            dropdown.hiddenSelect.dispatchEvent(changeEvent);
        }

        this.closeAllDropdowns();
    }

    updateDropdownValue(dropdownId, value) {
        const dropdown = this.dropdowns?.[dropdownId];
        if (!dropdown) return;

        const option = this.getDropdownOptions(dropdownId)
            .find(item => (item.getAttribute('data-value') ?? '') === value);
        if (option) {
            const valueElement = dropdown.trigger.querySelector('.dropdown-value');
            if (valueElement) {
                valueElement.textContent = option.textContent.trim();
            }
        }

        if (dropdown.hiddenSelect) {
            dropdown.hiddenSelect.value = value;
        }
        this.decorateDropdownOptions(dropdownId);
    }

    /**
     * Rebuild a filter's hidden <select> and its custom option list. Skipped when the
     * values are unchanged, which is the common case for every loaded page.
     */
    setDropdownOptions(dropdownId, selectElement, allLabel, items) {
        const dropdown = this.dropdowns?.[dropdownId];
        const optionsKey = JSON.stringify([allLabel, ...items.map(item => [item.value, item.label])]);
        if (dropdown && dropdown.optionsKey === optionsKey) return false;
        if (dropdown) dropdown.optionsKey = optionsKey;

        if (selectElement) {
            const createSelectOption = (value, label) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                return option;
            };
            selectElement.innerHTML = '';
            selectElement.appendChild(createSelectOption('', allLabel));
            items.forEach(item => selectElement.appendChild(createSelectOption(item.value, item.label)));
        }

        if (dropdown) {
            const createOption = (value, label) => {
                const option = document.createElement('div');
                option.className = 'dropdown-option';
                option.setAttribute('data-value', value);
                option.textContent = label;
                return option;
            };
            const fragment = document.createDocumentFragment();
            fragment.appendChild(createOption('', allLabel));
            items.forEach(item => fragment.appendChild(createOption(item.value, item.label)));
            dropdown.list.innerHTML = '';
            dropdown.list.appendChild(fragment);
            this.decorateDropdownOptions(dropdownId);
        }
        return true;
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
                    this.loadMovies('filterChange');
                }
            );
        }
        
        this.elements.userFilter?.addEventListener('change', (e) => {
            this.filters.user = e.target.value;
            this.applyFilters();
        });
        
        this.elements.sortFilter?.addEventListener('change', (e) => {
            const previousServerSort = this.getServerSortParams();
            this.filters.sort = e.target.value;
            const nextServerSort = this.getServerSortParams();

            if (previousServerSort.sortBy !== nextServerSort.sortBy
                || previousServerSort.sortDir !== nextServerSort.sortDir) {
                // Server pagination order changed: reload from the first page.
                this.loadMovies('filterChange');
                return;
            }

            this.applyFilters();
            this.loadAllForClientSort();
        });
        
        // `click` (not mousedown) so every control also works from the keyboard
        this.elements.clearFiltersBtn?.addEventListener('click', () => this.clearFilters());
        
        // Active Filter Tags Click (Event Delegation)
        this.elements.activeFiltersList?.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.remove-filter');
            if (removeBtn) {
                const filterType = removeBtn.dataset.filterType;
                this.removeFilter(filterType);
            }
        });
        
        // Toggle Filters
        this.elements.toggleFiltersBtn?.addEventListener('click', () => this.toggleFilters());
        
        // Retry button
        this.elements.retryBtn?.addEventListener('click', () => this.loadMovies('userAction'));
        
        // Empty state: open Search (inline handlers are blocked by the extension CSP)
        this.elements.emptyStateSearchBtn?.addEventListener('click', () => {
            if (window.navigation?.navigateToPage) {
                window.navigation.navigateToPage('search');
            } else {
                window.location.href = chrome.runtime.getURL('src/pages/search/search.html');
            }
        });

        // Live updates: show queued new ratings, refresh when the user comes back
        this.elements.livePill?.addEventListener('click', () => this.applyPendingLiveMovies({ reveal: true }));
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.onPageReturn();
        });
        window.addEventListener('pageshow', (e) => {
            // Restored from the back/forward cache: the page state may be minutes old
            if (e.persisted) this.onPageReturn({ force: true });
        });
        // Scrolling back to the top shows queued new ratings without a click
        let scrollFrame = 0;
        window.addEventListener('scroll', () => {
            if (this.pendingLiveMovies.size === 0 || scrollFrame) return;
            scrollFrame = requestAnimationFrame(() => {
                scrollFrame = 0;
                if (this.isNearTop()) this.processPendingLiveMovies();
            });
        }, { passive: true });
        // Release the Firestore listener so the page stays eligible for the back/forward cache
        window.addEventListener('pagehide', () => this.stopLiveUpdates());

        // Modal close buttons
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
        // Escape closes the dialog; Tab stays inside it while it is open
        this.elements.ratingModal?.addEventListener('keydown', (e) => this.handleRatingModalKeydown(e));
        // Enter in the form saves instead of submitting the page
        document.getElementById('ratingForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveRating();
        });
        
        // Close modals on background click
        
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
                            this.userProfilesMap.clear();
                            this.fetchedProfileIds.clear();
                            this.stopLiveUpdates();
                            this.cacheSnapshot = null;
                            this.ensureInitialLoad('authStateChanged: user switched');
                        } else {
                            const loadAlreadyStarted = this._moviesLoadTriggered;
                            this.ensureInitialLoad('authStateChanged: initial user event');
                            // A load started from the cached mock user may have run before
                            // auth was restored, when `users` profiles could not be read.
                            if (loadAlreadyStarted) this.refreshMissingProfiles();
                        }
                    } else {
                        this.page.showError(this.text('errors.sign_in'));
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
                            this.page.showError(this.text('errors.sign_in'));
                        }
                    }
                }, 2000);
            } else {
                this.page.showError(this.text('errors.firebase_init'));
            }
        } catch (error) {
            console.error('Error setting up Firebase:', error);
            this.page.showError(this.text('errors.firebase_setup', { message: error.message }));
        }
    }

    ensureInitialLoad(callerContext = 'unspecified') {
        if (this._moviesLoadTriggered) {
            return;
        }
        if (!this.currentUser) {
            return;
        }
        this._moviesLoadTriggered = true;
        this.loadMovies(callerContext);
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
                
                // Restore rater profiles so cached cards render names/avatars instead of skeletons
                this.restoreCachedProfiles(cache.profiles);
                this.currentUser = { uid: userId }; // Temporary mock for current user
                this.extractAndPopulateUsers(cache.ratings);
                // Lets the first network load mark films rated since this cache was saved
                this.cacheSnapshot = {
                    timestamp: Number(cache.timestamp) || 0,
                    ids: new Set(cache.ratings.map(item => String(item.movieId || item.movie?.kinopoiskId)))
                };

                // The cache holds only the first page; pagination starts with the
                // server load in loadMovies(), so no infinite scroll is set up here.
                const enrichedStart = this.enrichFromLocalStorage(cache.ratings.slice(0, this.BATCH_SIZE));
                if (enrichedStart.length > 0) {
                    this.movies = await this.mergeProviderRatingsForPage(enrichedStart);

                    this.populateYearFilter();
                    this.populateGenreFilter();
                    this.applyFilters();
                    this.page.showContent(); // Ensure content shown
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

            const cachedMovie = rating.movie && typeof rating.movie === 'object' ? rating.movie : null;
            const fallbackMovie = {
                ...(cachedMovie || {}),
                kinopoiskId: cachedMovie?.kinopoiskId || rating.movieId,
                name: cachedMovie?.name || 'Loading...',
                year: cachedMovie?.year || '',
                genres: cachedMovie?.genres || [],
                description: cachedMovie?.description || '',
                posterUrl: cachedMovie?.posterUrl || ''
            };

            const preferredMovie = movieData || cachedMovie || fallbackMovie;
            const metadataMerger = typeof window !== 'undefined'
                ? window.MovieCacheService?.mergeMovieMetadata
                : null;
            const hydratedMovie = metadataMerger
                ? metadataMerger(preferredMovie, movieData ? (cachedMovie || fallbackMovie) : fallbackMovie)
                : { ...fallbackMovie, ...(movieData || {}) };
            
            return {
                ...rating,
                movie: hydratedMovie,
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

    mergeCachedMovieMetadata(items, movieCacheService) {
        const previousMovies = new Map(
            (this.movies || [])
                .map(item => {
                    const movie = item?.movie;
                    const movieId = movie?.kinopoiskId || item?.movieId || item?.id;
                    return movieId && movie ? [String(movieId), movie] : null;
                })
                .filter(Boolean)
        );

        return (items || []).map(movie => {
            const movieId = movie?.kinopoiskId || movie?.id;
            const cachedMovie = previousMovies.get(String(movieId));
            return cachedMovie
                ? movieCacheService.mergeMovieMetadata(movie, cachedMovie)
                : movie;
        });
    }

    async saveRatingsToCache(ratings) {
        try {
            if (!this.currentUser || !this.currentUser.uid) return;
            
            const cacheKey = `${RatingsPageManager.CACHE_KEY_PREFIX}${this.currentUser.uid}`;
            const cacheData = {
                ratings: ratings,
                profiles: this.getCachedProfilesFor(ratings),
                timestamp: Date.now()
            };
            
            await chrome.storage.local.set({ [cacheKey]: cacheData });
        } catch (e) {
            console.warn('RatingsPage: Failed to save cache', e);
        }
    }

    async loadMovies(callerContext = 'unspecified') {
        if (this.isLoading && this.activeLoadPromise && callerContext !== 'filterChange' && callerContext !== 'userAction') {
            return this.activeLoadPromise;
        }

        const requestId = ++this.currentRequestId;

        this.activeLoadPromise = (async () => {
            const isBackgroundUpdate = this.movies.length > 0;

            // Reset pagination cursors & state. An in-flight next batch belongs to the
            // previous request ID and discards its own result, so it must not keep the
            // old cursor (a sort change would otherwise continue from the wrong order).
            this.lastMovieDoc = null;
            this.hasMore = true;
            this.loadingMore = false;
            this.nextBatchPromise = null;
            if (!isBackgroundUpdate) {
                this.movies = [];
            }
            this.renderedMoviesState.clear();
            // A reload fetches fresh data; queued live updates would only duplicate it
            this.pendingLiveMovies.clear();
            this.updateLivePill();
            
            this.isLoading = true;
            if (!isBackgroundUpdate) {
                this.page.showLoader();
            }
            
            const loadingTimeout = setTimeout(() => {
                if (this.isLoading && this.currentRequestId === requestId) {
                    console.warn('Loading timeout - forcing completion');
                    this.isLoading = false;
                    if (isBackgroundUpdate && this.movies.length > 0) {
                        // Cards from the cache or an earlier load stay usable
                        if (typeof Utils !== 'undefined') Utils.showToast(this.text('errors.refresh_timeout'), 'warning');
                    } else {
                        this.page.showError(this.text('errors.timeout'));
                    }
                }
            }, 30000);
            
            try {
                const movieCacheService = firebaseManager.getMovieCacheService();
                const ratingService = firebaseManager.getRatingService();

                this.updateSortFilterUIState();

                const { sortBy, sortDir } = this.getServerSortParams();
                const pagedResult = await movieCacheService.getMoviesByAvgRating({
                    minAvgRating: this.filters.avgRatingFrom,
                    maxAvgRating: this.filters.avgRatingTo,
                    sortBy,
                    sortDir,
                    limit: this.BATCH_SIZE || 8,
                    lastDoc: this.lastMovieDoc
                });

                if (this.currentRequestId !== requestId) {
                    clearTimeout(loadingTimeout);
                    return;
                }

                const pagedMovies = this.mergeCachedMovieMetadata(pagedResult.movies, movieCacheService);
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
                    // The very first rated film should still appear without a reload
                    this.startLiveUpdates();
                    return;
                }

                // First page refreshes every rater profile (cached ones may be stale)
                const enrichedMovies = await this.enrichMoviePage(pagedMovies, ratingService, { refreshProfiles: true });

                if (this.currentRequestId !== requestId) {
                    clearTimeout(loadingTimeout);
                    return;
                }

                this.movies = enrichedMovies;
                this.extractAndPopulateUsers(this.movies);
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
                    this.saveRatingsToCache(enrichedMovies);
                }

                clearTimeout(loadingTimeout);
                this.page.showContent();
                this.isLoading = false;

                // Films rated since the cached first screen was saved get the "new" mark once
                this.highlightNewSinceCache(enrichedMovies);
                this.startLiveUpdates();
                // Fill cards whose movie document has no title/poster (does not block the page)
                this.hydrateMissingMetadata(enrichedMovies);

                // Sorts the server cannot order (my rating, title, year) need every page.
                this.loadAllForClientSort();
            } catch (error) {
                if (this.currentRequestId !== requestId) {
                    clearTimeout(loadingTimeout);
                    return;
                }
                console.error('Error loading movies:', error);
                clearTimeout(loadingTimeout);
                this.page.showError(this.text('errors.load_failed', { message: error.message }));
                this.isLoading = false;
            }
        })();

        try {
            return await this.activeLoadPromise;
        } finally {
            this.activeLoadPromise = null;
        }
    }

    /**
     * Split a sort key such as 'avg-rating-desc' into field and direction.
     * (A plain split('-') read 'avg-rating-desc' as field 'avg', direction 'rating'.)
     */
    isAvgRatingFilterActive() {
        return this.filters.avgRatingFrom > 1.0 || this.filters.avgRatingTo < 10.0;
    }

    /**
     * The sort actually in effect. While the average-rating range filter is active
     * Firestore can only order by avgRating (range filter + orderBy on the same field),
     * so the client must sort the same way or later pages land between earlier cards.
     * The user's chosen sort stays in filters.sort and returns when the filter is cleared.
     */
    getEffectiveSortKey() {
        return this.isAvgRatingFilterActive() ? 'avg-rating-desc' : this.filters.sort;
    }

    parseSortKey(sortKey = this.getEffectiveSortKey()) {
        const key = String(sortKey || 'date-desc');
        const separator = key.lastIndexOf('-');
        const direction = key.slice(separator + 1) === 'asc' ? 'asc' : 'desc';
        const field = separator > 0 ? key.slice(0, separator) : key;
        return { field: field === 'avg-rating' ? 'avg' : field, direction };
    }

    /**
     * Firestore can only order rated movies by fields every aggregate document has:
     * lastRatingUpdatedAt ('date') and avgRating ('avg'). "My rating" is per user and
     * name/year may be missing (orderBy would drop those movies), so those sorts load
     * pages in date order and are sorted on the client over the full list.
     */
    getServerSortParams() {
        const { field, direction } = this.parseSortKey();
        if (field === 'date' || field === 'avg') {
            return { sortBy: field, sortDir: direction, clientOnly: false };
        }
        return { sortBy: 'date', sortDir: 'desc', clientOnly: true };
    }

    /**
     * Load the remaining pages when the active sort is applied on the client only.
     * Pages are read CLIENT_SORT_BATCH_SIZE at a time and the list is rendered once
     * at the end (progress is shown in the results line), instead of re-rendering
     * and rebuilding every filter after each small page.
     */
    async loadAllForClientSort() {
        if (this.loadAllPromise) return this.loadAllPromise;
        if (!this.hasMore || !this.getServerSortParams().clientOnly) return;

        this.loadAllPromise = (async () => {
            const requestId = this.currentRequestId;
            this.bulkLoading = true;
            try {
                while (this.hasMore && this.getServerSortParams().clientOnly && this.currentRequestId === requestId) {
                    const cursorBefore = this.lastMovieDoc;
                    await this.loadNextBatch({ limit: this.CLIENT_SORT_BATCH_SIZE, render: false });
                    // Stop if a batch failed or made no progress instead of retrying forever
                    if (this.lastMovieDoc === cursorBefore) break;
                    if (this.hasMore) this.showBulkProgress();
                }
            } finally {
                this.bulkLoading = false;
            }
            if (this.currentRequestId === requestId) this.refreshFilterOptionsAndRender();
        })();

        try {
            await this.loadAllPromise;
        } finally {
            this.loadAllPromise = null;
        }
    }

    showBulkProgress() {
        if (this.elements?.resultsCount) {
            this.elements.resultsCount.textContent = this.text('results.loading_all', { count: this.movies.length });
        }
    }

    /** Rebuild the filter options from the loaded films and render the list. */
    refreshFilterOptionsAndRender() {
        this.extractAndPopulateUsers(this.movies);
        this.populateYearFilter();
        this.populateGenreFilter();
        this.applyFilters();
    }

    loadNextBatch(options = {}) {
        if (!this.hasMore) return Promise.resolve();
        // Share one in-flight batch between the scroll observer and loadAllForClientSort
        if (!this.nextBatchPromise) {
            this.nextBatchPromise = this.fetchNextBatch(options).finally(() => {
                this.nextBatchPromise = null;
            });
        }
        return this.nextBatchPromise;
    }

    async fetchNextBatch({ limit = this.BATCH_SIZE || 8, render = true } = {}) {
        const requestId = this.currentRequestId;
        this.loadingMore = true;

        try {
            const movieCacheService = firebaseManager.getMovieCacheService();
            const ratingService = firebaseManager.getRatingService();

            const { sortBy, sortDir } = this.getServerSortParams();
            const pagedResult = await movieCacheService.getMoviesByAvgRating({
                minAvgRating: this.filters.avgRatingFrom,
                maxAvgRating: this.filters.avgRatingTo,
                sortBy,
                sortDir,
                limit,
                lastDoc: this.lastMovieDoc
            });

            if (this.currentRequestId !== requestId) {
                this.loadingMore = false;
                return;
            }

            const pagedMovies = this.mergeCachedMovieMetadata(pagedResult.movies, movieCacheService);
            this.lastMovieDoc = pagedResult.lastDoc;
            this.hasMore = pagedResult.hasMore;

            if (pagedMovies.length > 0) {
                const enrichedBatch = await this.enrichMoviePage(pagedMovies, ratingService);

                if (this.currentRequestId !== requestId) {
                    this.loadingMore = false;
                    return;
                }

                // Merge by ID: a film inserted live may come back in a later server page
                this.mergeMoviesById(enrichedBatch);
                this.hydrateMissingMetadata(enrichedBatch);
                if (render) this.refreshFilterOptionsAndRender();
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

    /**
     * Turn one page of rated movie documents into card data. Provider ratings,
     * community ratings (one batched query set), bookmarks and rater profiles are
     * loaded in parallel; profiles start as soon as the rater list is known.
     */
    async enrichMoviePage(pagedMovies, ratingService, { refreshProfiles = false } = {}) {
        const movieIds = pagedMovies.map(m => parseInt(m.kinopoiskId || m.id)).filter(Boolean);

        const ratingsPromise = ratingService.getMovieRatingsBatch(movieIds, 50);
        const profilesPromise = ratingsPromise.then(({ ratersByMovie }) =>
            this.loadUserProfiles([...ratersByMovie.values()].flat(), { refresh: refreshProfiles }));

        const [moviesWithProviderRatings, { averages, ratersByMovie }, bookmarksMap] = await Promise.all([
            this.mergeProviderRatingsForPage(pagedMovies),
            ratingsPromise,
            this.fetchBookmarksMap(movieIds),
            profilesPromise
        ]);

        const enrichedMovies = moviesWithProviderRatings.map(movieObj => {
            const movieId = parseInt(movieObj.kinopoiskId || movieObj.id);
            const allRaters = ratersByMovie.get(movieId) || [];

            // The card features the signed-in user's rating when present, otherwise the
            // newest rater; myRating/myComment always describe the signed-in user only.
            const ownRating = allRaters.find(r => r.userId === this.currentUser?.uid) || null;
            const currentUserRating = ownRating || allRaters[0] || {};

            const avgInfo = averages[movieId] || { average: movieObj.avgRating || 0, count: movieObj.ratingsCount || 0 };
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
                myRating: Number(ownRating?.rating) || 0,
                myComment: Utils.normalizeRatingComment(ownRating?.comment),
                averageRating: movieAverage > 0 ? movieAverage : (fetchedAverage > 0 ? fetchedAverage : 0),
                ratingsCount: movieRatingsCount > 0 ? movieRatingsCount : fetchedRatingsCount,
                allRaters: allRaters
            };
        });

        this.applyWatchStatuses(enrichedMovies, bookmarksMap);
        return enrichedMovies;
    }

    // ---------------------------------------------------------------------------
    // Missing film metadata
    //
    // A movies/{id} document can carry only rating aggregates (title, poster and
    // description missing) — e.g. films first rated before cacheMovie() honoured
    // `isRated`, or when the rater's metadata write failed. Instead of showing a
    // placeholder until someone opens the details page, the page fills such cards
    // itself: local caches first, then a bounded Kinopoisk API lookup, and stores
    // the result in Firestore so the document is repaired for everyone.
    // ---------------------------------------------------------------------------

    static METADATA_HYDRATION_LIMIT = 8;
    static METADATA_API_CONCURRENCY = 2;

    hasDisplayMetadata(movie) {
        const name = typeof movie?.name === 'string' ? movie.name.trim().toLowerCase() : '';
        const hasName = Boolean(name) && !['loading...', 'unknown movie', 'unknown title'].includes(name);
        return hasName && Boolean(movie?.posterUrl);
    }

    async hydrateMissingMetadata(items = this.movies) {
        this.metadataHydrationAttempted = this.metadataHydrationAttempted || new Set();
        const missing = (items || [])
            .filter(item => !this.hasDisplayMetadata(item.movie))
            .map(item => this.getMovieKey(item))
            .filter(key => key && !this.metadataHydrationAttempted.has(key))
            .slice(0, RatingsPageManager.METADATA_HYDRATION_LIMIT);
        if (missing.length === 0) return;

        // Each film is tried once per page session so a failing lookup cannot loop
        missing.forEach(key => this.metadataHydrationAttempted.add(key));
        const requestId = this.currentRequestId;

        let movieCacheService;
        try {
            movieCacheService = firebaseManager.getMovieCacheService();
        } catch {
            return;
        }

        // 1. Local caches (this browser may have the metadata from browsing or rating).
        // Local only: the Firestore documents are the ones known to lack metadata.
        const found = new Map();
        try {
            const cached = typeof movieCacheService.getLocalCachedMovies === 'function'
                ? await movieCacheService.getLocalCachedMovies(missing) || {}
                : {};
            missing.forEach(key => {
                const movie = cached[key] || cached[Number(key)];
                if (this.hasDisplayMetadata(movie)) found.set(key, movie);
            });
        } catch (error) {
            console.warn('[RatingsPage] Local metadata lookup failed:', error);
        }

        // 2. Kinopoisk API for the rest, a few at a time to respect the shared quota
        const remaining = missing.filter(key => !found.has(key));
        let kinopoiskService = null;
        try {
            kinopoiskService = remaining.length ? firebaseManager.getKinopoiskService() : null;
        } catch {
            kinopoiskService = null;
        }
        if (kinopoiskService?.getMovieById) {
            for (let i = 0; i < remaining.length; i += RatingsPageManager.METADATA_API_CONCURRENCY) {
                const chunk = remaining.slice(i, i + RatingsPageManager.METADATA_API_CONCURRENCY);
                const results = await Promise.all(chunk.map(key => kinopoiskService.getMovieById(Number(key))
                    .catch(error => {
                        console.warn(`[RatingsPage] Metadata fetch failed for ${key}:`, error);
                        return null;
                    })));
                chunk.forEach((key, index) => {
                    if (this.hasDisplayMetadata(results[index])) found.set(key, results[index]);
                });
            }
        }
        if (found.size === 0 || requestId !== this.currentRequestId) return;

        // 3. Repair the Firestore document (metadata fields only) and update the cards
        const merge = window.MovieCacheService?.mergeMovieMetadata
            || ((primary, fallback) => ({ ...fallback, ...primary }));
        found.forEach((metadata, key) => {
            movieCacheService.cacheMovie({ ...metadata, kinopoiskId: Number(key) }, true)
                .catch(error => console.warn(`[RatingsPage] Could not store metadata for ${key}:`, error));
            this.movies.forEach(item => {
                if (this.getMovieKey(item) === key) item.movie = merge(item.movie || {}, metadata);
            });
        });

        // A bulk load for a client-only sort renders once when it finishes
        if (this.bulkLoading) return;
        this.populateYearFilter();
        this.populateGenreFilter();
        this.applyFilters();
        this.saveDefaultFirstPageToCache();
    }

    // ---------------------------------------------------------------------------
    // Live updates
    //
    // A Firestore listener watches the newest rated movies (the default first page).
    // A rating made elsewhere reaches it once aggregateMovieRatings has updated
    // movies/{id}. When the user is at the top of the default "newest first" list
    // the film is inserted directly; otherwise it waits behind the "new ratings"
    // pill so the grid never shifts under the user.
    // ---------------------------------------------------------------------------

    static LIVE_HIGHLIGHT_MS = 6000;
    static LOCAL_EDIT_GRACE_MS = 60000;
    static REVALIDATE_INTERVAL_MS = 30000;
    static NEAR_TOP_PX = 120;

    getMovieKey(item) {
        return String(item?.movie?.kinopoiskId || item?.movieId || item?.kinopoiskId || item?.id || '');
    }

    getLastRatingMs(item) {
        return getTimestamp(item?.lastRatingUpdatedAt ?? item?.movie?.lastRatingUpdatedAt) || 0;
    }

    startLiveUpdates() {
        if (this.liveUnsubscribe || !this.currentUser) return;
        let movieCacheService;
        try {
            movieCacheService = firebaseManager.getMovieCacheService();
        } catch {
            return;
        }
        if (typeof movieCacheService?.watchNewestRatedMovies !== 'function') return;

        this.liveSeenTimestamps = null;
        this.liveUnsubscribe = movieCacheService.watchNewestRatedMovies({
            limit: this.BATCH_SIZE,
            onChange: movies => this.handleLiveSnapshot(movies),
            // A failed listener is not fatal: revalidation on return still catches up
            onError: () => this.stopLiveUpdates()
        });
    }

    stopLiveUpdates() {
        if (this.liveUnsubscribe) {
            try { this.liveUnsubscribe(); } catch { /* already closed */ }
        }
        this.liveUnsubscribe = null;
        this.liveSeenTimestamps = null;
    }

    handleLiveSnapshot(movies) {
        // The first snapshot is the current state, already shown by loadMovies()
        if (!this.liveSeenTimestamps) {
            this.liveSeenTimestamps = new Map(movies.map(doc => [this.getMovieKey(doc), this.getLastRatingMs(doc)]));
            const timestamps = movies.map(doc => this.getLastRatingMs(doc)).filter(Boolean);
            this.liveBaselineMinTs = timestamps.length ? Math.min(...timestamps) : 0;
            return;
        }

        const now = Date.now();
        let queued = false;
        movies.forEach(doc => {
            const key = this.getMovieKey(doc);
            const ts = this.getLastRatingMs(doc);
            // A film that only slid into the top N because another one left it is
            // older than the baseline and is not "new"; a fresh rating is newer.
            const previous = this.liveSeenTimestamps.get(key) ?? this.liveBaselineMinTs;
            this.liveSeenTimestamps.set(key, Math.max(ts, previous));
            if (!key || ts <= previous) return;

            // A rating saved on this page is already shown (optimistically)
            const localEditAt = this.recentLocalEdits.get(key) || 0;
            if (now - localEditAt < RatingsPageManager.LOCAL_EDIT_GRACE_MS) return;

            this.pendingLiveMovies.set(key, doc);
            queued = true;
        });

        if (queued) this.processPendingLiveMovies();
    }

    isNearTop() {
        return (window.scrollY || 0) < RatingsPageManager.NEAR_TOP_PX;
    }

    /** True when the default newest-first list is shown without client-side filters. */
    isDefaultNewestView() {
        const { field, direction } = this.parseSortKey();
        return field === 'date' && direction === 'desc';
    }

    hasClientFilters() {
        return Boolean(this.filters.search || this.filters.genre || this.filters.year || this.filters.user)
            || this.isAvgRatingFilterActive();
    }

    processPendingLiveMovies() {
        if (this.pendingLiveMovies.size === 0) {
            this.updateLivePill();
            return;
        }
        const canInsertDirectly = !document.hidden
            && !this.isLoading
            && this.isNearTop()
            && this.isDefaultNewestView();

        if (canInsertDirectly) {
            this.applyPendingLiveMovies();
        } else {
            this.updateLivePill();
        }
    }

    updateLivePill() {
        const pill = this.elements?.livePill;
        if (!pill) return;
        const count = this.pendingLiveMovies.size;
        pill.hidden = count === 0;
        if (count > 0 && this.elements.livePillText) {
            this.elements.livePillText.textContent = this.text('live.new_ratings', { count });
        }
    }

    /**
     * Enrich queued live movies, merge them into the list and mark them as new.
     * With `reveal` (pill click) the view moves to them: the top of the default
     * list, or the first marked card for other sorts.
     */
    async applyPendingLiveMovies({ reveal = false } = {}) {
        if (this.applyingLive || this.pendingLiveMovies.size === 0) return;
        this.applyingLive = true;

        const pending = [...this.pendingLiveMovies.values()];
        this.pendingLiveMovies.clear();
        this.updateLivePill();
        const requestId = this.currentRequestId;

        try {
            const movieCacheService = firebaseManager.getMovieCacheService();
            const ratingService = firebaseManager.getRatingService();
            const enriched = await this.enrichMoviePage(
                this.mergeCachedMovieMetadata(pending, movieCacheService),
                ratingService
            );
            // A reload started meanwhile already carries this data
            if (requestId !== this.currentRequestId) return;

            enriched.forEach(item => {
                this.liveSeenTimestamps?.set(this.getMovieKey(item), this.getLastRatingMs(item));
            });
            this.mergeMoviesById(enriched);
            this.extractAndPopulateUsers(this.movies);
            this.populateYearFilter();
            this.populateGenreFilter();
            this.applyFilters();
            this.saveDefaultFirstPageToCache();

            const keys = enriched.map(item => this.getMovieKey(item));
            this.highlightMovies(keys);
            if (reveal) this.revealMovies(keys);
            this.hydrateMissingMetadata(enriched);
        } catch (error) {
            console.warn('[RatingsPage] Failed to apply live rating updates:', error);
            // Put them back so the pill can retry
            pending.forEach(doc => this.pendingLiveMovies.set(this.getMovieKey(doc), doc));
            this.updateLivePill();
        } finally {
            this.applyingLive = false;
            if (this.pendingLiveMovies.size > 0) this.processPendingLiveMovies();
        }
    }

    /** Replace items already in this.movies by movie ID and append the rest. */
    mergeMoviesById(items) {
        const indexByKey = new Map(this.movies.map((item, index) => [this.getMovieKey(item), index]));
        items.forEach(item => {
            const index = indexByKey.get(this.getMovieKey(item));
            if (index === undefined) {
                indexByKey.set(this.getMovieKey(item), this.movies.length);
                this.movies.push(item);
            } else {
                this.movies[index] = item;
            }
        });
    }

    /** The cache holds the default first screen; keep it current after live inserts. */
    saveDefaultFirstPageToCache() {
        if (!this.isDefaultNewestView() || this.hasClientFilters()) return;
        this.saveRatingsToCache(this.filteredMovies.slice(0, this.BATCH_SIZE));
    }

    findCardElement(key) {
        const grid = this.elements?.moviesGrid;
        if (!grid || !key) return null;
        const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key.replace(/"/g, '\\"');
        return grid.querySelector(`.movie-card-component[data-movie-id="${escaped}"]`);
    }

    /** Neutral outline plus a "New" label (never color alone), removed after a few seconds. */
    highlightMovies(keys) {
        const label = this.text('live.new_badge');
        keys.forEach(key => {
            const card = this.findCardElement(key);
            if (!card) return;
            clearTimeout(card._ratingsNewTimer);
            card.classList.add('ratings-card--new');
            if (!card.querySelector('.ratings-new-badge')) {
                const badge = document.createElement('span');
                badge.className = 'ratings-new-badge';
                badge.textContent = label;
                (card.querySelector('.mc-poster-container') || card).appendChild(badge);
            }
            card._ratingsNewTimer = setTimeout(() => {
                card.classList.remove('ratings-card--new');
                card.querySelector('.ratings-new-badge')?.remove();
            }, RatingsPageManager.LIVE_HIGHLIGHT_MS);
        });
    }

    revealMovies(keys) {
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const behavior = reducedMotion ? 'auto' : 'smooth';
        if (this.isDefaultNewestView()) {
            window.scrollTo({ top: 0, behavior });
            return;
        }
        const firstCard = keys.map(key => this.findCardElement(key)).find(Boolean);
        firstCard?.scrollIntoView({ behavior, block: 'center' });
    }

    /** Mark films whose latest rating is newer than the cached first screen. */
    highlightNewSinceCache(movies) {
        const snapshot = this.cacheSnapshot;
        this.cacheSnapshot = null; // only the first load after the cached render
        if (!snapshot?.timestamp) return;
        const keys = movies
            .filter(item => this.getLastRatingMs(item) > snapshot.timestamp)
            .map(item => this.getMovieKey(item));
        if (keys.length > 0) this.highlightMovies(keys);
    }

    /** Back on the tab or restored from the back/forward cache. */
    onPageReturn({ force = false } = {}) {
        if (!this._moviesLoadTriggered || !this.currentUser) return;
        this.startLiveUpdates();

        const now = Date.now();
        if (this.isLoading || (!force && now - this.lastRevalidateAt < RatingsPageManager.REVALIDATE_INTERVAL_MS)) {
            this.processPendingLiveMovies();
            return;
        }
        this.lastRevalidateAt = now;
        this.revalidateFirstPage();
    }

    /**
     * Re-read the first page of the current sort and queue changed or new films
     * through the live path. Loaded pages and scroll position are kept.
     */
    async revalidateFirstPage() {
        const requestId = this.currentRequestId;
        try {
            const movieCacheService = firebaseManager.getMovieCacheService();
            const { sortBy, sortDir } = this.getServerSortParams();
            const { movies } = await movieCacheService.getMoviesByAvgRating({
                minAvgRating: this.filters.avgRatingFrom,
                maxAvgRating: this.filters.avgRatingTo,
                sortBy,
                sortDir,
                limit: this.BATCH_SIZE,
                lastDoc: null
            });
            if (requestId !== this.currentRequestId) return;

            const known = new Map(this.movies.map(item => [this.getMovieKey(item), item]));
            const now = Date.now();
            movies.forEach(doc => {
                const key = this.getMovieKey(doc);
                if (now - (this.recentLocalEdits.get(key) || 0) < RatingsPageManager.LOCAL_EDIT_GRACE_MS) return;
                const current = known.get(key);
                const changed = !current
                    || this.getLastRatingMs(doc) > this.getLastRatingMs(current)
                    || Number(doc.ratingsCount || 0) !== Number(current.ratingsCount || 0);
                if (key && changed) this.pendingLiveMovies.set(key, doc);
            });
            this.processPendingLiveMovies();
        } catch (error) {
            console.warn('[RatingsPage] Revalidation on return failed:', error);
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
                // A bulk load for a client-only sort renders the full list itself
                if (entry.isIntersecting && !this.loadingMore && this.hasMore && !this.bulkLoading) {
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
        if (!this.hasMore || this.loadingMore || this.bulkLoading) return;
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

    /**
     * Load rater profiles into userProfilesMap. Profiles accumulate across pages
     * (earlier cards keep their names/avatars); an ID is fetched once per session,
     * or again when `refresh` is set so profiles restored from cache get updated.
     */
    async loadUserProfiles(ratings, { refresh = false } = {}) {
        try {
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
            
            const userIds = Array.from(userIdsSet)
                .filter(Boolean)
                .filter(id => refresh || !this.fetchedProfileIds.has(id));

            if (userIds.length === 0) return;

            const userService = firebaseManager.getUserService();
            // `users` can only be read when signed in; failed lookups resolve to no
            // profiles, so an empty answer before auth is restored is not conclusive.
            const requestedWhileSignedIn = Boolean(firebaseManager.getCurrentUser?.());
            let userProfiles;
            let failedIds = null;
            if (typeof userService.getUserProfilesByIdsDetailed === 'function') {
                ({ profiles: userProfiles, failedIds } = await userService.getUserProfilesByIdsDetailed(userIds));
            } else {
                userProfiles = await userService.getUserProfilesByIds(userIds);
            }

            // A conclusive lookup marks every requested ID done, including users without a
            // profile document (they render their fallback name instead of a skeleton).
            // IDs whose lookup failed, or any ID before sign-in, stay open for a retry.
            if (failedIds) {
                if (requestedWhileSignedIn) {
                    const failed = new Set(failedIds.map(String));
                    userIds.filter(id => !failed.has(id)).forEach(id => this.fetchedProfileIds.add(id));
                }
            } else if (requestedWhileSignedIn || userProfiles.length > 0) {
                userIds.forEach(id => this.fetchedProfileIds.add(id));
            }
            userProfiles.forEach(profile => {
                const id = String(profile.userId || profile.id || '').trim();
                if (id) {
                    this.fetchedProfileIds.add(id);
                    if (profile.id) this.fetchedProfileIds.add(String(profile.id).trim());
                    this.userProfilesMap.set(id, profile);
                    // Also indexing by profile.id if it's different, just in case
                    if (profile.id && String(profile.id).trim() !== id) {
                        this.userProfilesMap.set(String(profile.id).trim(), profile);
                    }
                }
            });
        } catch (error) {
            console.error('[loadUserProfiles] Error loading user profiles:', error);
        }
    }

    /** Fetch profiles still missing for loaded cards and repaint those cards. */
    async refreshMissingProfiles() {
        // Wait for an in-flight first load so its own profile request settles first
        if (this.activeLoadPromise) {
            try { await this.activeLoadPromise; } catch { /* handled by loadMovies */ }
        }

        const stateBefore = `${this.userProfilesMap.size}:${this.fetchedProfileIds.size}`;
        await this.loadUserProfiles(this.movies || []);
        if (`${this.userProfilesMap.size}:${this.fetchedProfileIds.size}` !== stateBefore) this.applyFilters();
    }

    async fetchBookmarksMap(movieIds) {
        if (!this.currentUser || movieIds.length === 0) return {};

        try {
            const favoriteService = firebaseManager.getFavoriteService();
            return await favoriteService.getBookmarksBatch(this.currentUser.uid, movieIds) || {};
        } catch (error) {
            console.error('Error loading watch statuses:', error);
            return {};
        }
    }

    applyWatchStatuses(movies, bookmarksMap) {
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
    }

    /** Compact profile fields needed for display names/avatars, for the page cache. */
    getCachedProfilesFor(movies) {
        const ids = new Set();
        movies.forEach(item => {
            [item, ...(item.allRaters || [])].forEach(r => {
                const id = String(r?.userId || r?.uid || '').trim();
                if (id) ids.add(id);
            });
        });

        return [...ids]
            .map(id => this.userProfilesMap.get(id))
            .filter(Boolean)
            .map(profile => ({
                id: profile.id,
                userId: profile.userId,
                displayName: profile.displayName,
                displayNameFormat: profile.displayNameFormat,
                username: profile.username,
                firstName: profile.firstName,
                lastName: profile.lastName,
                email: profile.email,
                photoURL: profile.photoURL
            }));
    }

    restoreCachedProfiles(profiles) {
        if (!Array.isArray(profiles)) return;
        profiles.forEach(profile => {
            const id = String(profile?.userId || profile?.id || '').trim();
            if (id && !this.userProfilesMap.has(id)) this.userProfilesMap.set(id, profile);
        });
    }

    populateYearFilter() {
        const years = new Set();
        this.movies.forEach(movie => {
            if (movie.movie?.year) {
                years.add(String(movie.movie.year));
            }
        });
        // Keep an active (e.g. restored) year selectable even before its films load
        if (this.filters.year) years.add(String(this.filters.year));

        const sortedYears = Array.from(years).sort((a, b) => b - a);
        const rebuilt = this.setDropdownOptions(
            'yearFilter',
            this.elements.yearFilter,
            i18n.get('ratings.filters.all_years'),
            sortedYears.map(year => ({ value: year, label: year }))
        );

        // Rebuilding the options reset the selection; restore the active year filter
        if (rebuilt && this.filters.year) this.updateDropdownValue('yearFilter', String(this.filters.year));
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
        // Keep an active (e.g. restored) genre selectable even before its films load
        if (this.filters.genre) genres.add(this.filters.genre);

        const sortedGenres = Array.from(genres).sort();
        const rebuilt = this.setDropdownOptions(
            'genreFilter',
            this.elements.genreFilter,
            i18n.get('ratings.filters.all_genres'),
            sortedGenres.map(genre => ({ value: genre, label: genre }))
        );

        // Restores both the hidden select and the visible dropdown label
        if (rebuilt && this.filters.genre && genres.has(this.filters.genre)) {
            this.updateDropdownValue('genreFilter', this.filters.genre);
        }
    }

    getDisplayNameForUser(userId, userDisplayName, userName, userEmail) {
        const profileId = String(userId || '').trim();
        const userProfile = profileId ? this.userProfilesMap.get(profileId) : null;

        let targetDisplayName = null;
        if (userProfile && typeof Utils !== 'undefined' && Utils.getDisplayName) {
            targetDisplayName = Utils.getDisplayName(userProfile, null);
        } else {
            // If the ID lookup failed, try searching the map for a profile matching the email or name as a last resort
            if (userEmail || userDisplayName) {
                for (const profile of this.userProfilesMap.values()) {
                    if ((userEmail && profile.email === userEmail) || 
                        (userDisplayName && profile.displayName === userDisplayName)) {
                        targetDisplayName = Utils.getDisplayName(profile, null);
                        break;
                    }
                }
            }
            
            if (!targetDisplayName) {
                targetDisplayName = userDisplayName || userName || userEmail?.split('@')[0] || this.text('unknown_user');
            }
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
        
        const rebuilt = this.setDropdownOptions(
            'userFilter',
            this.elements.userFilter,
            i18n.get('ratings.filters.all_users') || 'All Users',
            this.allUsers.map(user => ({ value: user.id, label: user.displayName }))
        );

        // Rebuilding the options reset the selection; restore the active user filter
        if (rebuilt && this.filters.user) this.updateDropdownValue('userFilter', this.filters.user);
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
        
        // User filter
        if (this.filters.user) {
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
            tags.push({ type: 'search', label: this.text('active_filters.search', { value: this.filters.search }) });
        }
        
        if (this.filters.genre) {
            tags.push({ type: 'genre', label: this.text('active_filters.genre', { value: this.filters.genre }) });
        }
        
        if (this.filters.year) {
            tags.push({ type: 'year', label: this.text('active_filters.year', { value: this.filters.year }) });
        }
        
        if (this.filters.avgRatingFrom !== 1.0 || this.filters.avgRatingTo !== 10.0) {
            tags.push({ 
                type: 'avgRating', 
                label: this.text('active_filters.rating', { from: this.filters.avgRatingFrom.toFixed(1), to: this.filters.avgRatingTo.toFixed(1) })
            });
        }
        
        if (this.filters.user) {
            const user = this.allUsers.find(u => u.id === this.filters.user);
            tags.push({ type: 'user', label: this.text('active_filters.user', { value: user ? user.displayName : this.filters.user }) });
        }
        
        // Render tags
        this.elements.activeFiltersList.innerHTML = '';
        
        if (tags.length > 0) {
            tags.forEach(tag => {
                // Built with textContent: labels contain user input (the search text)
                const tagEl = document.createElement('div');
                tagEl.className = 'filter-tag';
                const labelEl = document.createElement('span');
                labelEl.textContent = tag.label;
                const removeEl = document.createElement('button');
                removeEl.type = 'button';
                removeEl.className = 'remove-filter';
                removeEl.dataset.filterType = tag.type;
                removeEl.setAttribute('aria-label', `${this.text('active_filters.remove')}: ${tag.label}`);
                removeEl.textContent = '×';
                tagEl.append(labelEl, removeEl);
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
                this.loadMovies('filterChange');
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
        const isFilterActive = this.isAvgRatingFilterActive();
        const sortFilter = this.elements.sortFilter;

        if (sortFilter) {
            sortFilter.disabled = isFilterActive;
        }

        // Show the sort in effect (fixed to average rating while the range filter is on)
        // without overwriting the user's choice in filters.sort.
        this.updateDropdownValue('sortFilter', this.getEffectiveSortKey());

        const dropdown = this.dropdowns?.sortFilter;
        const dropdownElement = dropdown?.element || dropdown?.container;
        if (dropdownElement) {
            // A disabled trigger is skipped by the mouse and the keyboard alike
            if (dropdown.trigger) dropdown.trigger.disabled = isFilterActive;
            if (isFilterActive) this.closeDropdown('sortFilter');
            dropdownElement.classList.toggle('is-locked', isFilterActive);
            dropdownElement.style.opacity = isFilterActive ? '0.6' : '1';
            dropdownElement.title = isFilterActive ? i18n.get('ratings.sort.locked_by_avg_filter') : '';
        }
    }

    sortMovies(movies) {
        const { field, direction } = this.parseSortKey();

        movies.sort((a, b) => {
            let valueA, valueB;

            switch (field) {
                case 'date':
                    valueA = getTimestamp(a.createdAt);
                    valueB = getTimestamp(b.createdAt);
                    break;
                case 'rating':
                    // "My rating": the signed-in user's own score, not the featured rater's
                    valueA = this.getMyRating(a).rating;
                    valueB = this.getMyRating(b).rating;
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
                // Secondary tie-breaker by ID to guarantee deterministic order. Compared as
                // strings to match Firestore's orderBy(documentId()) on movie documents
                // ('999' sorts after '1000'), so ties keep the server pagination order.
                const idA = String(a.movieId || a.kinopoiskId || 0);
                const idB = String(b.movieId || b.kinopoiskId || 0);
                if (idA === idB) return 0;
                const ascending = idA < idB ? -1 : 1;
                return direction === 'desc' ? -ascending : ascending;
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

                if (card.classList.contains('mc-is-loading') && !newCardHTML.classList.contains('mc-is-loading')) {
                    // A placeholder card (no title/poster yet) is replaced as a whole once the
                    // film metadata arrives; patching it piecemeal left loading-only markup behind.
                    if (movieData.id) newCardHTML.setAttribute('data-rating-id', movieData.id);
                    newCardHTML.setAttribute('data-movie-id', key);
                    card.replaceWith(newCardHTML);
                    card = newCardHTML;
                } else {

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
    }

    /**
     * Single delegated click handler for card actions and profile links. Card
     * navigation itself belongs to Utils.bindMovieCardNavigation (registered later
     * on the same grid), so handled clicks stop it with stopImmediatePropagation.
     * Uses click (not mousedown) so each action runs once and works from the keyboard.
     */
    setupGridEventListeners() {
        const grid = this.elements.moviesGrid;
        if (!grid) return;

        const openProfile = (userId) => {
            window.location.href = chrome.runtime.getURL(`src/pages/profile/profile.html?userId=${encodeURIComponent(userId)}`);
        };

        grid.addEventListener('click', (e) => {
            if (e.button !== 0) return;

            const profileEl = e.target.closest('.clickable-username, .mc-rater-row.clickable-rater');
            if (profileEl) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const userId = profileEl.getAttribute('data-user-id');
                if (userId) openProfile(userId);
                return;
            }

            const collectionBtn = e.target.closest('.collection-btn');
            if (collectionBtn) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const movieId = parseInt(collectionBtn.getAttribute('data-movie-id'));
                if (movieId && window.navigation?.showCollectionSelector) {
                    window.navigation.showCollectionSelector(movieId, collectionBtn);
                }
                return;
            }

            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.getAttribute('data-action');
            // view-details is handled by Utils.bindMovieCardNavigation
            if (action === 'stop-propagation' || action === 'view-details') return;

            const movieId = target.getAttribute('data-movie-id')
                || target.closest('.movie-card-component')?.getAttribute('data-movie-id');
            if (!movieId) return;

            e.preventDefault();
            e.stopImmediatePropagation();

            switch (action) {
                case 'toggle-favorite':
                    this.runStatusAction(movieId, () => this.toggleFavorite(movieId, target));
                    break;
                case 'toggle-watching':
                    this.runStatusAction(movieId, () => this.handleWatchingToggle(movieId, target));
                    break;
                case 'toggle-watchlist':
                    this.runStatusAction(movieId, () => this.handleWatchlistToggle(movieId, target));
                    break;
                case 'toggle-watched':
                    this.runStatusAction(movieId, () => this.handleWatchedToggle(movieId, target));
                    break;
                case 'toggle-collection': {
                    const collectionId = target.getAttribute('data-collection-id');
                    if (collectionId) this.handleToggleCollection(movieId, collectionId, target);
                    break;
                }
                case 'edit-rating':
                    this.editRating(movieId);
                    break;
                case 'open-review': {
                    const params = new URLSearchParams({ movieId: String(movieId) });
                    const ratingId = target.getAttribute('data-rating-id');
                    if (ratingId) params.set('reviewId', String(ratingId));
                    window.location.href = chrome.runtime.getURL(
                        `src/pages/movie-details/movie-details.html?${params.toString()}`
                    );
                    break;
                }
                case 'add-to-collection':
                    if (window.navigation?.showCollectionPicker) {
                        window.navigation.showCollectionPicker(parseInt(movieId));
                    }
                    break;
            }
        });
    }

    /** Ignore repeat clicks while a bookmark/status write for the same movie is in flight. */
    async runStatusAction(movieId, action) {
        const key = String(movieId);
        if (this.pendingStatusActions.has(key)) return;
        this.pendingStatusActions.add(key);
        try {
            await action();
        } finally {
            this.pendingStatusActions.delete(key);
        }
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
            // Only the signed-in user's own rating can be edited here
            showEditRating: this.getMyRating(movieData).rating > 0,
            showAddToCollection: false,
            isWatching: movieData.isWatching || movieData.status === 'watching' || false,
            isInWatchlist: movieData.isInWatchlist || movieData.status === 'plan_to_watch' || false,
            isWatched: movieData.status === 'watched',
            userInfoLoading: this.isUserInfoLoading(movieData),
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
                Utils.showToast(this.t('sign_in'), 'warning');
            }
            return false;
        }
        return true;
    }

    static STATUS_BUTTONS = {
        favorite: {
            attribute: 'data-is-favorite',
            labels: ['movie_card.remove_favorite', 'movie_card.add_favorite'],
            path: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>',
            fillWhenActive: true
        },
        watching: {
            attribute: 'data-is-watching',
            labels: ['movie_card.remove_watching', 'movie_card.add_watching'],
            path: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>',
            fillWhenActive: false
        },
        watchlist: {
            attribute: 'data-is-in-watchlist',
            labels: ['movie_card.remove_watchlist', 'movie_card.add_watchlist'],
            path: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>',
            fillWhenActive: true
        },
        watched: {
            attribute: 'data-is-watched',
            labels: ['movie_card.remove_watched', 'movie_card.add_watched'],
            path: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
            fillWhenActive: false
        }
    };

    static statusIcon(path, filled) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    }

    updateButtonState(button, type, isActive) {
        const config = RatingsPageManager.STATUS_BUTTONS[type];
        if (!button || !config) return;

        button.setAttribute(config.attribute, isActive);
        Utils.toggleActionButton(button, isActive, {
            active: i18n.get(config.labels[0]),
            inactive: i18n.get(config.labels[1])
        }, {
            active: RatingsPageManager.statusIcon(config.path, config.fillWhenActive),
            inactive: RatingsPageManager.statusIcon(config.path, false)
        });
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

    findMovieData(movieId) {
        const id = Number(movieId);
        const matches = m => Number(m.movie?.kinopoiskId || m.movieId) === id;
        return this.filteredMovies.find(matches) || this.movies.find(matches) || null;
    }

    /**
     * The signed-in user's own rating for a card item. `rating`/`comment` on the item
     * describe the featured rater shown on the card, who may be someone else.
     */
    getMyRating(movieData) {
        if (Number.isFinite(movieData?.myRating)) {
            return {
                rating: movieData.myRating,
                comment: movieData.myComment || ''
            };
        }
        const uid = this.currentUser?.uid;
        const own = uid ? (movieData?.allRaters || []).find(r => r.userId === uid) : null;
        return {
            rating: Number(own?.rating) || 0,
            comment: Utils.normalizeRatingComment(own?.comment)
        };
    }

    async toggleFavorite(cardMovieId, buttonElement) {
        if (!this.checkAuth()) return;

        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const movieData = this.findMovieData(cardMovieId);

            if (!movieData) {
                console.error('Movie data not found for movie:', cardMovieId);
                return;
            }

            const movieId = movieData.movie?.kinopoiskId || movieData.movieId;
            const isFavorite = movieData.isFavorite || movieData.status === 'favorite';

            // Optimistic UI update
            if (buttonElement) buttonElement.classList.add('animating');

            if (isFavorite) {
                // If currently favorite, remove it (or set to null status? usually remove)
                await favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
                movieData.isFavorite = false;
                movieData.status = null;
                
                this.updateButtonState(buttonElement, 'favorite', false);
                if (typeof Utils !== 'undefined') Utils.showToast(this.t('favorite_removed'), 'success');
            } else {
                // Check limit before adding
                 const limitReached = await favoriteService.isFavoritesLimitReached(this.currentUser.uid, 50);
                 if (limitReached) {
                     if (typeof Utils !== 'undefined') {
                         Utils.showToast(this.t('favorites_limit'), 'warning');
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
                this.refreshCardButtons(movieId);
                
                if (typeof Utils !== 'undefined') Utils.showToast(this.t('favorite_added'), 'success');
            }
            
            if (window.navigation?.updateFavoritesCount) window.navigation.updateFavoritesCount();

        } catch (error) {
            console.error('Error toggling favorite:', error);
            if (typeof Utils !== 'undefined') Utils.showToast(this.t('status_error'), 'error');
        } finally {
            if (buttonElement) setTimeout(() => buttonElement.classList.remove('animating'), 600);
        }
    }

    async handleWatchingToggle(movieId, buttonElement) {
        if (!this.checkAuth()) return;

        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const movieData = this.findMovieData(movieId);
            if (!movieData) return;

            const isWatching = movieData.isWatching || (movieData.status === 'watching');

            if (isWatching) {
                // Remove
                await favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
                movieData.isWatching = false;
                movieData.status = null;
                
                this.updateButtonState(buttonElement, 'watching', false);
                if (typeof Utils !== 'undefined') Utils.showToast(this.t('watching_removed'), 'success');
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
                
                if (typeof Utils !== 'undefined') Utils.showToast(this.t('watching_added'), 'success');
            }

            if (window.navigation?.updateWatchingCount) window.navigation.updateWatchingCount();
        } catch (error) {
            console.error('Error toggling watching:', error);
            if (typeof Utils !== 'undefined') Utils.showToast(this.t('status_error'), 'error');
        }
    }

    async handleWatchedToggle(movieId, buttonElement) {
        if (!this.checkAuth()) return;

        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const movieData = this.findMovieData(movieId);
            if (!movieData) return;

            const isWatched = movieData.status === 'watched';

            if (isWatched) {
                // Remove
                await favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
                movieData.status = null;
                
                this.updateButtonState(buttonElement, 'watched', false);
                if (typeof Utils !== 'undefined') Utils.showToast(this.t('watched_removed'), 'success');
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
                
                if (typeof Utils !== 'undefined') Utils.showToast(this.t('watched_added'), 'success');
            }

        } catch (error) {
            console.error('Error toggling watched:', error);
            if (typeof Utils !== 'undefined') Utils.showToast(this.t('status_error'), 'error');
        }
    }

    async handleWatchlistToggle(movieId, buttonElement) {
        if (!this.checkAuth()) return;

        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const movieData = this.findMovieData(movieId);
            if (!movieData) return;

            const isInWatchlist = movieData.isInWatchlist || (movieData.status === 'plan_to_watch');

            if (isInWatchlist) {
                // Remove
                await favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
                movieData.isInWatchlist = false;
                movieData.status = null;
                
                this.updateButtonState(buttonElement, 'watchlist', false);
                if (typeof Utils !== 'undefined') Utils.showToast(this.t('watchlist_removed'), 'success');
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
                
                if (typeof Utils !== 'undefined') Utils.showToast(this.t('watchlist_added'), 'success');
            }

            if (window.navigation?.updateWatchlistCount) window.navigation.updateWatchlistCount();
        } catch (error) {
            console.error('Error toggling watchlist:', error);
            if (typeof Utils !== 'undefined') Utils.showToast(this.t('status_error'), 'error');
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
                if (textSpan) textSpan.style.fontWeight = 'normal';
            } else {
                const newCheck = document.createElement('span');
                newCheck.className = 'mc-collection-check';
                newCheck.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                newCheck.style.marginLeft = 'auto';
                newCheck.style.fontWeight = 'bold';
                newCheck.style.color = 'var(--accent-color, #4CAF50)';
                buttonElement.appendChild(newCheck);

                // Text keeps the theme's menu color (a fixed white was unreadable in the light theme)
                if (textSpan) textSpan.style.fontWeight = '500';
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

            if (typeof Utils !== 'undefined') Utils.showToast(isChecked ? this.t('collection_removed') : this.t('collection_added'), 'success');

        } catch (error) {
            console.error('Error toggling collection:', error);
            buttonElement.innerHTML = originalHtml;
            if (typeof Utils !== 'undefined') Utils.showToast(this.t('collection_error'), 'error');
        }
    }

    async editRating(movieId) {
        // movieId arrives as a string from data attributes; findMovieData compares numerically
        const movieData = this.findMovieData(movieId);
        if (!movieData) return;

        // Edit the signed-in user's own rating, never the featured rater's values
        const personalRating = this.getMyRating(movieData);
        const { rating: currentRating, comment: currentComment } = personalRating;
        if (!currentRating) return;

        const movie = movieData.movie;
        this.selectedMovie = movie;
        
        // Update modal title
        this.elements.ratingModalTitle.textContent = this.text('modal.edit_title', { title: movie.name });
        
        // Show movie info in rating modal
        const formatScore = value => {
            const score = Number(value);
            return Number.isFinite(score) && score > 0 ? String(parseFloat(score.toFixed(1))) : '';
        };
        const kpScore = formatScore(movie.kpRating);
        const imdbScore = formatScore(movie.imdbRating);
        const genresText = Utils.formatGenres
            ? Utils.formatGenres(movie.genres, 3)
            : (Array.isArray(movie.genres) ? movie.genres.slice(0, 3).filter(Boolean).join(', ') : '');
        const metaText = [movie.year, genresText].filter(Boolean).join(' • ');

        this.elements.movieRatingInfo.innerHTML = `
            <div class="movie-detail">
                <img src="${this.escapeHtml(movie.posterUrl || '/src/shared/assets/icons/app/icon48.png')}" alt="${this.escapeHtml(movie.name || '')}" class="movie-detail-poster">
                <div class="movie-detail-info">
                    <h3 class="movie-detail-title">${this.escapeHtml(movie.name)}</h3>
                    <p class="movie-detail-meta">${this.escapeHtml(metaText)}</p>
                    <div class="movie-detail-ratings">
                        <span class="rating-badge kp">${this.escapeHtml(this.text('modal.kp_label'))}: ${kpScore || this.escapeHtml(this.text('modal.no_score'))}</span>
                        ${imdbScore ? `<span class="rating-badge imdb">IMDb: ${imdbScore}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
        
        // Show current rating info
        this.elements.currentRatingInfo.style.display = 'block';
        this.elements.existingRatingValue.textContent = `${currentRating}/10`;
        this.elements.existingRatingComment.innerHTML = currentComment ? Utils.parseSpoilers(this.escapeHtml(currentComment)) : this.escapeHtml(this.text('modal.no_comment'));
        
        // Set form values
        this.elements.ratingSlider.value = currentRating;
        this.elements.ratingValue.textContent = currentRating;
        this.elements.ratingComment.value = currentComment || '';
        this.elements.charCount.textContent = (currentComment || '').length;
        
        this.openRatingModal();
    }

    async saveRating() {
        if (!this.elements.ratingSlider || !this.elements.ratingComment) return;
        if (!this.selectedMovie || !this.currentUser) return;
        // One save at a time: a second click while the profile loads must not write twice
        if (this.isSavingRating) return;
        this.isSavingRating = true;
        if (this.elements.saveRatingBtn) this.elements.saveRatingBtn.disabled = true;

        try {
            const rating = parseInt(this.elements.ratingSlider.value);
            const comment = this.elements.ratingComment.value.trim();

            // Validation
            if (rating < 1 || rating > 10) {
                Utils.showToast(this.t('rating_invalid'), 'warning');
                return;
            }

            const ratingService = firebaseManager.getRatingService();
            const uid = this.currentUser.uid;

            // The signed-in user's profile is normally already loaded for the cards;
            // only fetch it when it is not, instead of on every save.
            let userProfile = this.userProfilesMap.get(String(uid)) || null;
            if (!userProfile) {
                userProfile = await firebaseManager.getUserService().getUserProfile(uid);
                if (userProfile) this.userProfilesMap.set(String(uid), userProfile);
            }

            // Get display name based on user preference
            const displayName = typeof Utils !== 'undefined' && Utils.getDisplayName
                ? Utils.getDisplayName(userProfile, this.currentUser)
                : (userProfile?.displayName || this.currentUser.displayName || this.currentUser.email);

            const photoURL = userProfile?.photoURL || this.currentUser.photoURL || '';
            // closeRatingModal() clears this.selectedMovie before the background write below
            const selectedMovie = this.selectedMovie;
            const movieId = Number(selectedMovie.kinopoiskId || selectedMovie.movieId);

            let addedNew = false;
            // Rollback restores only this card, so pages or live updates that arrive
            // while the write is in flight are kept.
            let backupItem = null;

            // 1. Update this.movies
            const movieIndex = this.movies.findIndex(m => Number(m.movie?.kinopoiskId || m.movieId) === movieId);
            if (movieIndex > -1) {
                const movieItem = this.movies[movieIndex];
                backupItem = this.cloneMovieItem(movieItem);
                // Mirrors aggregateMovieRatings: only a changed score moves the film's
                // lastRatingUpdatedAt. A comment-only edit keeps the card in place, as it
                // will be after a reload.
                const scoreChanged = this.getMyRating(movieItem).rating !== rating;
                // The saved rating becomes the card's featured rating
                movieItem.userId = uid;
                movieItem.userName = displayName;
                movieItem.userDisplayName = displayName;
                movieItem.userPhoto = photoURL;
                movieItem.rating = rating;
                movieItem.comment = comment;
                movieItem.myRating = rating;
                movieItem.myComment = comment;
                movieItem.allRaters = movieItem.allRaters || [];
                movieItem.updatedAt = new Date();
                if (scoreChanged) {
                    movieItem.createdAt = new Date();
                    if (movieItem.movie) movieItem.movie.lastRatingUpdatedAt = new Date();
                    // The listener will report this change; the card is already up to date
                    this.recentLocalEdits.set(String(movieId), Date.now());
                }

                let raterIndex = movieItem.allRaters.findIndex(r => r.userId === uid);
                if (raterIndex > -1) {
                    movieItem.allRaters[raterIndex].rating = rating;
                    movieItem.allRaters[raterIndex].comment = comment;
                    movieItem.allRaters[raterIndex].updatedAt = new Date();
                } else {
                    movieItem.allRaters.push({
                        userId: uid,
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
                this.recentLocalEdits.set(String(movieId), Date.now());
                const newMovieItem = {
                    id: `opt_${Date.now()}`,
                    movieId: movieId,
                    rating: rating,
                    comment: comment,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    allRaters: [
                        {
                            userId: uid,
                            userName: displayName,
                            userPhoto: photoURL,
                            movieId: movieId,
                            rating: rating,
                            comment: comment,
                            createdAt: new Date(),
                            updatedAt: new Date()
                        }
                    ],
                    myRating: rating,
                    myComment: comment,
                    averageRating: rating,
                    ratingsCount: 1,
                    movie: selectedMovie
                };
                this.movies.unshift(newMovieItem);
            }

            // Close modal and apply filters immediately
            this.closeRatingModal();
            this.applyFilters();

            if (typeof Utils !== 'undefined') {
                Utils.showToast(movieIndex > -1 ? this.t('rating_updated') : this.t('rating_added'), 'success');
            }

            // Perform Firestore write in background
            const savePromise = ratingService.addOrUpdateRating(uid, displayName, photoURL, movieId, rating, comment, selectedMovie);
            savePromise.then((actualRating) => {
                // Update temporary opt_ IDs with real ones
                if (addedNew && actualRating?.id) {
                    const freshIndex = this.movies.findIndex(m => Number(m.movie?.kinopoiskId || m.movieId) === movieId);
                    if (freshIndex > -1) {
                        this.movies[freshIndex].id = actualRating.id;
                    }
                }
            }).catch((err) => {
                console.error('Optimistic rating failed:', err);
                if (typeof Utils !== 'undefined') {
                    Utils.showToast(this.t('rating_save_failed'), 'error');
                }
                this.rollbackRating(movieId, backupItem);
            });

        } catch (error) {
            console.error('Error saving rating:', error);
            Utils.showToast(this.t('rating_save_error'), 'error');
        } finally {
            this.isSavingRating = false;
            if (this.elements.saveRatingBtn) this.elements.saveRatingBtn.disabled = false;
        }
    }

    /** Copy of a card item deep enough to undo the optimistic edit in saveRating(). */
    cloneMovieItem(item) {
        return {
            ...item,
            movie: item.movie ? { ...item.movie } : item.movie,
            allRaters: Array.isArray(item.allRaters) ? item.allRaters.map(rater => ({ ...rater })) : item.allRaters
        };
    }

    /** Undo one failed optimistic rating: restore the card's backup, or drop a new card. */
    rollbackRating(movieId, backupItem) {
        const key = String(movieId);
        this.recentLocalEdits.delete(key);
        const index = this.movies.findIndex(m => Number(m.movie?.kinopoiskId || m.movieId) === Number(movieId));
        if (index > -1) {
            if (backupItem) {
                this.movies[index] = backupItem;
            } else {
                this.movies.splice(index, 1);
            }
        }
        this.renderedMoviesState.delete(key);
        this.applyFilters();
    }

    openRatingModal() {
        const modal = this.elements.ratingModal;
        if (!modal) return;
        this.modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        modal.style.display = 'flex';
        // Move focus into the dialog so the keyboard and screen readers land on it
        this.elements.ratingSlider?.focus();
    }

    closeRatingModal() {
        const wasOpen = this.elements.ratingModal.style.display !== 'none';
        this.elements.ratingModal.style.display = 'none';
        this.selectedMovie = null;
        const returnTo = this.modalReturnFocus;
        this.modalReturnFocus = null;
        if (wasOpen && returnTo?.isConnected) returnTo.focus();
    }

    getRatingModalFocusables() {
        const modal = this.elements.ratingModal;
        if (!modal) return [];
        return Array.from(modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter(el => !el.disabled && el.offsetParent !== null);
    }

    /** Escape closes the rating dialog; Tab and Shift+Tab cycle inside it. */
    handleRatingModalKeydown(e) {
        if (this.elements.ratingModal?.style.display === 'none') return;
        if (e.key === 'Escape') {
            e.preventDefault();
            this.closeRatingModal();
            return;
        }
        if (e.key !== 'Tab') return;
        const focusables = this.getRatingModalFocusables();
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
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
        this.updateDropdownValue('sortFilter', this.filters.sort);

        // Reset slider
        if (this.elements.avgRatingFrom) this.elements.avgRatingFrom.value = 1.0;
        if (this.elements.avgRatingTo) this.elements.avgRatingTo.value = 10.0;
        const event = new Event('input');
        this.elements.avgRatingFrom?.dispatchEvent(event);

        // Persist now: an empty result skips applyFilters(), which normally saves
        this.saveFiltersToStorage();
        this.loadMovies('filterChange');
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
        
        this.elements.resultsCount.textContent = this.text('results.count', { count, total });
        this.elements.resultsMode.textContent = this.text('results.mode');
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
        // Average rating range slider (the old code targeted a non-existent
        // avgRatingFilter element, so a saved range was applied but shown as 1–10)
        const clampRating = (value, fallback) => {
            const number = parseFloat(value);
            return Number.isFinite(number) ? Math.min(10, Math.max(1, number)) : fallback;
        };
        const from = clampRating(this.filters.avgRatingFrom, 1.0);
        const to = clampRating(this.filters.avgRatingTo, 10.0);
        this.filters.avgRatingFrom = Math.min(from, to);
        this.filters.avgRatingTo = Math.max(from, to);
        if (this.elements.avgRatingFrom) this.elements.avgRatingFrom.value = this.filters.avgRatingFrom;
        if (this.elements.avgRatingTo) this.elements.avgRatingTo.value = this.filters.avgRatingTo;
        // Track and labels are drawn by initDoubleSlider() from these input values
        if (this.elements.userFilter) {
            this.elements.userFilter.value = this.filters.user;
            this.updateDropdownValue('userFilter', this.filters.user);
        }
        if (this.elements.sortFilter) {
            this.elements.sortFilter.value = this.filters.sort;
        }
        // Label shows the sort in effect (fixed to average rating under a saved range)
        this.updateSortFilterUIState();
    }

    escapeHtml(text) {
        if (typeof Utils !== 'undefined' && Utils.escapeHtml) {
            return Utils.escapeHtml(text);
        }
        
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    toggleFilters() {
        if (!this.elements.filtersSection) return;
        
        const isCollapsed = this.elements.filtersSection.classList.toggle('collapsed');
        this.elements.toggleFiltersBtn?.setAttribute('aria-expanded', String(!isCollapsed));
        localStorage.setItem('ratingsFiltersCollapsed', isCollapsed);
    }

    loadFiltersCollapseState() {
        const isCollapsed = localStorage.getItem('ratingsFiltersCollapsed') === 'true';
        if (isCollapsed && this.elements.filtersSection) {
            this.elements.filtersSection.classList.add('collapsed');
            this.elements.toggleFiltersBtn?.setAttribute('aria-expanded', 'false');
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.ratingsPage = new RatingsPageManager();
});
