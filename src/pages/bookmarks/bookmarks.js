import { i18n } from '../../shared/i18n/I18n.js';

/**
 * Bookmarks Page Manager
 * Handles the unified Bookmarks page functionality
 */
class BookmarksPageManager {
    static BOOKMARKS_CACHE_KEY_PREFIX = 'bookmarks_cache_';
    static COLLECTIONS_CACHE_KEY_PREFIX = 'collections_cache_';
    static CACHE_LIFETIME = 7 * 24 * 60 * 60 * 1000; // 7 days

    constructor() {
        this.statusFilter = 'all'; // all, watching, plan_to_watch, favorite
        this.currentSort = 'updatedAt-desc';
        this.searchTerm = '';
        this.allBookmarks = []; // Cache of all loaded bookmarks
        this.collectionService = null;
        this.activeCollectionId = null;
        this.movieCacheService = null;
        this.availableCollections = []; // Store for menu
        // Card ratings/posters and watching progress are read once per visit: a
        // switch between lists used to wait on Firestore and on all of local
        // storage every time (about a second with 72 bookmarks).
        this.cardMovieCache = new Map();
        this.cardMoviePending = new Map();
        this.progressSnapshot = null;
        this.renderToken = 0;

        this.init();
    }

    async init() {
        this.initializeElements();
        this.setupEventListeners();

        // Initialize Services early so cached data renders with full metadata, progress, and ratings
        if (typeof ProgressService !== 'undefined') {
            this.progressService = new ProgressService();
        }
        if (typeof MovieCacheService !== 'undefined') {
            this.movieCacheService = new MovieCacheService(typeof window !== 'undefined' ? window.firebaseManager : null);
        }
        if (typeof CollectionService !== 'undefined') {
            this.collectionService = new CollectionService();
        }

        await i18n.init();
        i18n.translatePage();

        // Check URL query parameters for initial filter (e.g. ?filter=plan_to_watch, ?filter=watching)
        const urlParams = new URLSearchParams(window.location.search);
        let filterParam = urlParams.get('filter');
        if (filterParam) {
            if (filterParam === 'watchlist') filterParam = 'plan_to_watch';
            if (filterParam === 'favorites') filterParam = 'favorite';
            this.setFilter(filterParam);
        }

        // Load cached data immediately for instant render
        const cacheHit = await this.loadCachedData();
        
        await this.setupFirebase();
        
        if (window.firebaseManager?.getMovieCacheService) {
            this.movieCacheService = window.firebaseManager.getMovieCacheService();
        } else if (this.movieCacheService && window.firebaseManager?.db) {
            this.movieCacheService.db = window.firebaseManager.db;
        }
        
        // Collections drawn from the cache are still refreshed: other pages add
        // films to collections without invalidating this page's copy.
        if (!cacheHit.collections) {
            await this.loadCustomCollections();
        } else {
            void this.loadCustomCollections();
        }
        if (!cacheHit.bookmarks) {
            await this.loadBookmarks();
        }
        
        // Standardized movie card navigation
        Utils.bindMovieCardNavigation(this.elements.moviesGrid);
        
        // Spoiler reveal logic
        Utils.bindSpoilerReveal(document);

        // Setup listener for cache invalidation from other contexts
        this.setupCacheInvalidationListener();
    }

    async loadCachedData() {
        const result = { bookmarks: false, collections: false };
        
        try {
            if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return result;

            // Get current user ID from storage (without waiting for auth)
            const userResult = await chrome.storage.local.get(['user']);
            const userId = userResult.user?.uid;
            
            if (!userId) return result;

            // Load Collections Cache
            const collectionCacheKey = `${BookmarksPageManager.COLLECTIONS_CACHE_KEY_PREFIX}${userId}`;
            const bookmarkCacheKey = `${BookmarksPageManager.BOOKMARKS_CACHE_KEY_PREFIX}${userId}`;
            
            const cacheResult = await chrome.storage.local.get([collectionCacheKey, bookmarkCacheKey]);
            
            // 1. Render Collections
            const colCache = cacheResult[collectionCacheKey];
            if (colCache && colCache.collections) {
                if (Date.now() - (colCache.timestamp || 0) < BookmarksPageManager.CACHE_LIFETIME) {
                    console.log('BookmarksPage: Using cached collections');
                    this.availableCollections = colCache.collections;
                    this.renderCustomCollections(this.availableCollections);
                    result.collections = true;
                }
            }

            // 2. Render Bookmarks
            const bkCache = cacheResult[bookmarkCacheKey];
            if (bkCache && bkCache.bookmarks) {
                if (Date.now() - (bkCache.timestamp || 0) < BookmarksPageManager.CACHE_LIFETIME) {
                    console.log('BookmarksPage: Using cached bookmarks');
                    this.allBookmarks = bkCache.bookmarks;
                    this.updateCounts();
                    this.applyFilters(); // This renders the grid
                    this.page.showContent();
                    result.bookmarks = true;
                }
            }

        } catch (error) {
            console.error('BookmarksPage: Error loading cache', error);
        }
        
        return result;
    }

    setupCacheInvalidationListener() {
        // Listen for cache invalidation signals from other contexts (popup, movie-details, etc.)
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, areaName) => {
                if (areaName !== 'local') return;
                
                // Check for progress updates (watching_progress_* keys)
                const hasProgressUpdate = Object.keys(changes).some(key => 
                    key.startsWith('watching_progress_')
                );
                
                if (hasProgressUpdate) {
                    this.progressSnapshot = null;
                    this.applyFilters(); // Re-render grid with new progress
                    return;
                }
                
                // Check if bookmarks cache was cleared (invalidated)
                const userId = this.currentUser?.uid;
                if (!userId) return;
                
                const bookmarkCacheKey = `${BookmarksPageManager.BOOKMARKS_CACHE_KEY_PREFIX}${userId}`;
                const collectionCacheKey = `${BookmarksPageManager.COLLECTIONS_CACHE_KEY_PREFIX}${userId}`;
                
                // If cache was removed (invalidated), reload data
                if (changes[bookmarkCacheKey] && changes[bookmarkCacheKey].newValue === undefined) {
                    console.log('BookmarksPage: Cache invalidated, reloading...');
                    this.loadBookmarks();
                }
                if (changes[collectionCacheKey] && changes[collectionCacheKey].newValue === undefined) {
                    console.log('BookmarksPage: Collections cache invalidated, reloading...');
                    this.loadCustomCollections();
                }
            });
        }
    }

    initializeElements() {
        this.elements = {
            sidebarItems: document.querySelectorAll('.sidebar-item'),
            sidebarNav: document.querySelector('.sidebar-nav'),
            searchInput: document.getElementById('bookmarksSearchInput'),
            sortSelect: document.getElementById('sortFilter'),
            moviesGrid: document.getElementById('moviesGrid'),
            loadingSection: document.getElementById('loadingSection'),
            emptyState: document.getElementById('emptyState'),
            pageTitle: document.getElementById('pageTitle'),
            
            // Counts
            countAll: document.getElementById('count-all'),
            countWatching: document.getElementById('count-watching'),
            countWatched: document.getElementById('count-watched'),
            countPlanToWatch: document.getElementById('count-plan_to_watch'),
            countFavorite: document.getElementById('count-favorite'),
            

            
            // Collections
            customCollectionsList: document.getElementById('customCollectionsList'),
            createCollectionBtn: document.getElementById('createCollectionBtn'),
            collectionMenuBtn: document.getElementById('collectionMenuBtn'),
        };

        // UI State Manager
        this.page = Utils.createPageStateManager({
            loader: this.elements.loadingSection,
            errorScreen: null, // No error screen in this file? Using alert/toast usually
            errorMessage: null,
            contentContainer: this.elements.moviesGrid
        });
    }

    setupEventListeners() {
        // Sidebar filtering
        window.FilterChoice?.enhanceSingleGroup(this.elements.sidebarNav, {
            selector: '.sidebar-item', label: 'Списки фильмов'
        });
        this.elements.sidebarItems.forEach(item => {
            item.addEventListener('click', () => {
                const filter = item.dataset.filter;
                this.setFilter(filter);
            });
        });

        // Search
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value;
                this.applyFilters();
            });
        }

        // Sort
        if (this.elements.sortSelect) {
            this.sortControl = window.SortControl?.enhance(this.elements.sortSelect);
            this.elements.sortSelect.addEventListener('change', (e) => {
                this.currentSort = e.target.value;
                this.applyFilters();
            });
        }

        // Migration removed

        // Status and collection items in the card menu: the shared quick-action handler (on click)
        if (typeof MovieCardActions !== 'undefined') {
            this.cardActions = this.createCardActions().bind(this.elements.moviesGrid);
        }

        // Event Delegation for the remaining Movie Card actions
        this.elements.moviesGrid.addEventListener('mousedown', (e) => {
            // If it's not a left click, let the browser handle it (e.g. middle click for new tab)
            if (e.button !== 0) return;

            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.dataset.action;
            if (action === 'stop-propagation') return;
            const movieId = target.dataset.movieId;

            if (!movieId && action !== 'view-details') return; // movieId might be needed, check logic

            switch (action) {
                case 'remove-from-watching':
                    this.handleRemoveBookmark(movieId);
                    break; 
                 case 'remove-from-watchlist':
                    this.handleRemoveBookmark(movieId);
                    break;
                 case 'remove-from-watched':
                    this.handleRemoveBookmark(movieId);
                    break;
                case 'remove-from-bookmarks':
                    this.handleRemoveBookmark(movieId);
                    break;
                case 'resume-watching':
                    // Redirect to search page with autoplay=true
                    if (movieId) {
                        window.location.href = `../movie-details/movie-details.html?movieId=${movieId}&autoplay=true`;
                    }
                    break;
            }
        });


        // Collection Modal Listeners
        if (this.elements.createCollectionBtn) {
            this.elements.createCollectionBtn.addEventListener('mousedown', () => {
                this.showCollectionModal();
            });
        }
        
        // Collection Menu Button
        if (this.elements.collectionMenuBtn) {
            // click, not mousedown, so Enter and Space open it too.
            this.elements.collectionMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleCollectionMenuDropdown();
            });
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.collection-menu-anchor')) this.closeCollectionMenu();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape' || !this.collectionMenu) return;
                const hadFocus = this.collectionMenu.contains(document.activeElement);
                this.closeCollectionMenu();
                if (hadFocus) this.elements.collectionMenuBtn.focus();
            });
        }

        // Use centralized menu delegation
        Utils.bindTabsAndMenus(document);
    }

    /**
     * Card menu quick actions. Bookmarks differs from Search and Ratings only here:
     * removing asks first, and a film that leaves the open list fades out of it.
     */
    createCardActions() {
        return new MovieCardActions({
            getUser: () => this.currentUser,
            getMovie: movieId => this.findBookmark(movieId),
            getStatus: movieId => {
                const bookmark = this.findBookmark(movieId);
                return bookmark ? (bookmark.status || null) : undefined;
            },
            confirmRemove: () => this.confirmRemoveBookmark(),
            onStatusChange: (movieId, status) => this.applyBookmarkStatus(movieId, status),
            getCollectionService: () => this.collectionService || null,
            getCollections: () => this.availableCollections,
            onCollectionChange: (movieId, collectionId) => {
                // The sidebar counts and an open collection read this list.
                this.renderCustomCollections(this.availableCollections);
                if (this.activeCollectionId === collectionId) this.applyFilters();
            }
        });
    }

    findBookmark(movieId) {
        const id = String(movieId);
        return this.allBookmarks.find(m => String(m.movieId) === id || String(m.id) === id) || null;
    }

    confirmRemoveBookmark() {
        return ConfirmDialog.confirm({
            title: i18n.get('confirm_dialog.remove_bookmark_title'),
            message: i18n.get('confirm_dialog.remove_bookmark_message'),
            confirmLabel: i18n.get('confirm_dialog.remove'),
            danger: true
        });
    }

    /** Keeps the local list, counts and grid in step after a saved status change (null = removed). */
    applyBookmarkStatus(movieId, status) {
        const id = String(movieId);
        if (status === null) {
            this.allBookmarks = this.allBookmarks.filter(m =>
                String(m.movieId) !== id && String(m.kinopoiskId) !== id && String(m.id) !== id
            );
        } else {
            const bookmark = this.findBookmark(movieId);
            if (bookmark) {
                bookmark.status = status;
                bookmark.updatedAt = new Date();
            }
        }
        this.updateCounts();

        const card = this.elements.moviesGrid.querySelector(`.movie-card-component[data-movie-id="${CSS.escape(id)}"]`);
        const inCollectionView = this.statusFilter.startsWith('collection:');
        const leavesList = status === null || (this.statusFilter !== 'all' && !inCollectionView && this.statusFilter !== status);
        if (card && leavesList) {
            this.fadeOutCard(card);
        } else if (!card && status !== null && this.statusFilter === status) {
            this.applyFilters();
        }
    }

    /** Fades a card out of the grid and shows the empty state when it was the last one. */
    fadeOutCard(card) {
        card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => {
            if (card.parentNode) card.remove();
            const visibleCards = this.elements.moviesGrid.querySelectorAll('.movie-card-component:not([style*="opacity: 0"])');
            if (visibleCards.length === 0) {
                this.elements.emptyState.style.display = 'flex';
                this.elements.moviesGrid.style.display = 'none';
            }
        }, 300);
    }

    /** The "Remove" menu items: asks, deletes the bookmark and drops the card. */
    async handleRemoveBookmark(movieId) {
        if (!this.currentUser || !movieId) return;
        if (!(await this.confirmRemoveBookmark())) return;

        try {
            const success = await this.favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
            if (success) {
                this.applyBookmarkStatus(movieId, null);
                window.navigation?.updateCounts?.();
                if (typeof Utils !== 'undefined') Utils.showToast(i18n.get('bookmarks.toast.removed'), 'success');
            }
        } catch (error) {
            console.error('Error removing bookmark:', error);
            if (typeof Utils !== 'undefined') Utils.showToast(i18n.get('bookmarks.toast.remove_error'), 'error');
        }
    }

    async setupFirebase() {
        if (typeof firebaseManager === 'undefined') {
            throw new Error('Firebase Manager not available');
        }
        await firebaseManager.waitForAuthReady();
        this.currentUser = firebaseManager.getCurrentUser();
        this.signedOut = !this.currentUser;

        if (this.currentUser) {
            this.favoriteService = firebaseManager.getFavoriteService();
        }

        // Listen for cross-tab auth state changes
        window.addEventListener('authStateChanged', async (e) => {
            const user = e.detail?.user;
            if (!user) {
                this.currentUser = null;
                this.signedOut = true;
                this.allBookmarks = [];
                this.filteredBookmarks = [];
                // Another account's collections must not stay on screen.
                this.availableCollections = [];
                this.renderCustomCollections([]);
                this.closeCollectionMenu();
                if (this.elements.collectionMenuBtn) this.elements.collectionMenuBtn.style.display = 'none';
                this.updateCounts();
                this.page.showContent();
                this.applyFilters();
            } else if (!this.currentUser || this.currentUser.uid !== user.uid) {
                this.currentUser = user;
                this.signedOut = false;
                this.favoriteService = firebaseManager.getFavoriteService();
                await this.loadCustomCollections();
                if (this.activeCollectionId && this.elements.collectionMenuBtn) {
                    this.elements.collectionMenuBtn.style.display = 'flex';
                }
                await this.loadBookmarks();
            }
        });
    }

    async loadBookmarks() {
        if (!this.currentUser) {
            // The empty state carries the sign-in message (the page has no error screen).
            this.page.showContent();
            this.applyFilters();
            return;
        }

        this.page.showLoader();
        try {
            // Load ALL bookmarks initially to allow client-side filtering (efficient for < 1000 items)
            // If user has huge collection, we might need server-side filtering, but for now this is smoother
            // fetching all with one query
            this.allBookmarks = await this.favoriteService.getFavorites(this.currentUser.uid, 'all');
            
            this.updateCounts();
            this.applyFilters();
        } catch (error) {
            console.error('Error loading bookmarks:', error);
            // Show error state?
        } finally {
            this.page.showContent();

            // Cache the loaded bookmarks
            if (this.currentUser && this.allBookmarks.length > 0) {
                try {
                    const cacheKey = `${BookmarksPageManager.BOOKMARKS_CACHE_KEY_PREFIX}${this.currentUser.uid}`;
                    // Optimize cache: Map to essential fields if needed, but for now store full object
                    // to ensure filters work correctly.
                    await chrome.storage.local.set({
                        [cacheKey]: {
                            bookmarks: this.allBookmarks,
                            timestamp: Date.now()
                        }
                    });
                } catch (e) {
                    console.warn('BookmarksPage: Failed to cache bookmarks', e);
                }
            }
        }
    }

    updateCounts() {
        const counts = {
            all: this.allBookmarks.length,
            watching: 0,
            watched: 0,
            plan_to_watch: 0,
            favorite: 0
        };

        this.allBookmarks.forEach(item => {
            if (Object.prototype.hasOwnProperty.call(counts, item.status)) {
                counts[item.status]++;
            }
        });

        if (this.elements.countAll) this.elements.countAll.textContent = counts.all;
        if (this.elements.countWatching) this.elements.countWatching.textContent = counts.watching;
        if (this.elements.countWatched) this.elements.countWatched.textContent = counts.watched;
        if (this.elements.countPlanToWatch) this.elements.countPlanToWatch.textContent = counts.plan_to_watch;
        if (this.elements.countFavorite) this.elements.countFavorite.textContent = counts.favorite;
    }



    async loadCustomCollections() {
        if (!this.collectionService) return;

        try {
            const collections = await this.collectionService.getCollections();
            this.availableCollections = collections; // Store for menu
            this.renderCustomCollections(collections);
            
            // Re-render grid if bookmarks are already loaded, to update menus
            if (this.allBookmarks.length > 0) {
                 this.applyFilters();
            }

            // Cache collections
            if (this.currentUser && collections) {
                try {
                    const cacheKey = `${BookmarksPageManager.COLLECTIONS_CACHE_KEY_PREFIX}${this.currentUser.uid}`;
                    await chrome.storage.local.set({
                        [cacheKey]: {
                            collections: collections,
                            timestamp: Date.now()
                        }
                    });
                } catch (e) {
                    console.warn('BookmarksPage: Failed to cache collections', e);
                }
            }
        } catch (error) {
            console.error('Error loading custom collections:', error);
        }
    }

    renderCustomCollections(collections) {
        if (!this.elements.customCollectionsList) return;

        // A collection opened from the address is chosen before sign-in finishes, when its
        // name cannot be read yet; name the title once the list is here.
        const open = this.activeCollectionId && collections.find(col => col.id === this.activeCollectionId);
        if (open && this.elements.pageTitle) this.elements.pageTitle.textContent = open.name;

        this.elements.customCollectionsList.innerHTML = collections.map(col => {
            const iconHtml = CollectionService.renderIconHtml(col.icon, { size: 20 });

            return `
                <button type="button" class="sidebar-item filter-choice collection-item ${this.activeCollectionId === col.id ? 'active is-active' : ''}" data-collection-id="${this.escapeHtml(col.id)}" aria-pressed="${this.activeCollectionId === col.id}">
                    <span class="sidebar-icon">${iconHtml}</span>
                    <span class="sidebar-label">${this.escapeHtml(col.name)}</span>
                    <span class="sidebar-count">${col.movieIds?.length || 0}</span>
                </button>
            `;
        }).join('');

        window.FilterChoice?.enhanceSingleGroup(this.elements.customCollectionsList, {
            selector: '.collection-item', label: 'Пользовательские подборки'
        });

        // Add click handlers
        this.elements.customCollectionsList.querySelectorAll('.collection-item').forEach(item => {
            item.addEventListener('click', () => {
                const collectionId = item.dataset.collectionId;
                this.setFilter(`collection:${collectionId}`);
            });
        });
    }


    escapeHtml(text) {
        // Quote-safe: the result also goes into attribute values.
        return Utils.escapeHtml(text);
    }

    showCollectionModal(collection = null) {
        const modal = document.createElement('div');
        modal.className = 'collection-modal-overlay';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const isEdit = !!collection;
        // Modern SVG icon set for collections
        const defaultIcons = [
            '<svg data-icon="MOVIE_CLAPPER" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2.27 3.28L5.78 2.47L5.12 6.73L2.2 7.4L1.53 4.48Q1.3 3.5 2.27 3.28ZM7.54 2.06L11.04 1.25L10.38 5.51L6.88 6.32ZM12.8 0.85L15.92 0.13Q16.89 -0.1 17.12 0.88L17.79 3.8L12.14 5.11Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9H17V15A2 2 0 0 1 15 17H5A2 2 0 0 1 3 15Z"/></svg>', // Film
            '<svg data-icon="MUSIC_CARD" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.4 12.6V6.4H13"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M8.8 10.7A2.1 2.1 0 1 0 8.8 14.9A2.1 2.1 0 1 0 8.8 10.7Z"/></svg>', // Music
            '<svg data-icon="PLAY_BOX" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M8 7.2C8 6.6 8.7 6.2 9.2 6.6L13 9.3C13.5 9.7 13.5 10.3 13 10.7L9.2 13.4C8.7 13.8 8 13.4 8 12.8Z"/></svg>', // Play/Video
            '<svg data-icon="SEARCH" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3A6 6 0 1 0 9 15A6 6 0 1 0 9 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M9 3L9 15C12.32 15 15 12.31 15 9C15 5.69 12.32 3 9 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M13.6 13.6L17.6 17.6"/></svg>', // Search/Mystery
            '<svg data-icon="WATCHED" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6.6 10.2L9 12.6L13.4 7.6"/></svg>', // Favorites/Check
            '<svg data-icon="RATED" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M10 2.3L12.59 7.14L17.99 8.1L14.18 12.06L14.94 17.5L10 15.1L5.06 17.5L5.82 12.06L2.01 8.1L7.41 7.14Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 2.31L10 15.1L14.94 17.5L14.18 12.06L17.99 8.1L12.59 7.14L10 2.31Z"/></svg>', // Star/Featured
            '<svg data-icon="CALENDAR" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 3H15A3 3 0 0 1 18 6V8H2V6A3 3 0 0 1 5 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 1H7V4H5ZM13 1H15V4H13Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8V15A2 2 0 0 0 5 17H15A2 2 0 0 0 17 15V8"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M11.75 11H13.25A0.75 0.75 0 0 1 14 11.75V13.25A0.75 0.75 0 0 1 13.25 14H11.75A0.75 0.75 0 0 1 11 13.25V11.75A0.75 0.75 0 0 1 11.75 11Z"/></svg>', // Calendar/Schedule
            '<svg data-icon="USER" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 2A4 4 0 1 0 10 10A4 4 0 1 0 10 2Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 12C13.6 12 16 13.8 16.6 16.2C16.7 16.7 16.4 17 15.9 17H4.1C3.6 17 3.3 16.7 3.4 16.2C4 13.8 6.4 12 10 12Z"/></svg>', // Person/Actor
            '<svg data-icon="TARGET" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 3A7 7 0 1 0 10 17A7 7 0 1 0 10 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 7A3 3 0 1 0 10 13A3 3 0 1 0 10 7Z"/></svg>', // Target/Aim
            '<svg data-icon="MESSAGE" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3H15A2 2 0 0 1 17 5V11A2 2 0 0 1 15 13H9.4L5.4 16.6V13H5A2 2 0 0 1 3 11V5A2 2 0 0 1 5 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M6.8 6.8A1.2 1.2 0 1 0 6.8 9.2A1.2 1.2 0 1 0 6.8 6.8ZM10 6.8A1.2 1.2 0 1 0 10 9.2A1.2 1.2 0 1 0 10 6.8ZM13.2 6.8A1.2 1.2 0 1 0 13.2 9.2A1.2 1.2 0 1 0 13.2 6.8Z"/></svg>', // Message/Dialog
            '<svg data-icon="CHART_BARS" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M4 10H6A1 1 0 0 1 7 11V16A1 1 0 0 1 6 17H4A1 1 0 0 1 3 16V11A1 1 0 0 1 4 10ZM9 3H11A1 1 0 0 1 12 4V16A1 1 0 0 1 11 17H9A1 1 0 0 1 8 16V4A1 1 0 0 1 9 3ZM14 7H16A1 1 0 0 1 17 8V16A1 1 0 0 1 16 17H14A1 1 0 0 1 13 16V8A1 1 0 0 1 14 7Z"/></svg>', // Chart/Stats
            '<svg data-icon="SMILE" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 3H12A5 5 0 0 1 17 8V12A5 5 0 0 1 12 17H8A5 5 0 0 1 3 12V8A5 5 0 0 1 8 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M7.4 6.7A1.3 1.3 0 1 0 7.4 9.3A1.3 1.3 0 1 0 7.4 6.7ZM12.6 6.7A1.3 1.3 0 1 0 12.6 9.3A1.3 1.3 0 1 0 12.6 6.7ZM6.4 11H13.6A3.6 3.6 0 0 1 6.4 11Z"/></svg>', // Happy/Comedy
            '<svg data-icon="TV" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6.6 2L10 5L13.4 2"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 6H15A2 2 0 0 1 17 8V15A2 2 0 0 1 15 17H5A2 2 0 0 1 3 15V8A2 2 0 0 1 5 6Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M12 6H15A2 2 0 0 1 17 8V15A2 2 0 0 1 15 17H12ZM14.6 8.4A1 1 0 1 0 14.6 10.4A1 1 0 1 0 14.6 8.4ZM14.6 11.8A1 1 0 1 0 14.6 13.8A1 1 0 1 0 14.6 11.8Z"/></svg>', // TV/Series
            '<svg data-icon="INFO" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 10V13.4"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 5.5A1.3 1.3 0 1 0 10 8.1A1.3 1.3 0 1 0 10 5.5Z"/></svg>', // Info/Documentary
            '<svg data-icon="SETTINGS" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10.58 1.22C10.96 1.25 11.41 1.12 11.58 2.04C11.76 2.97 11.88 3.57 12.13 3.71C12.39 3.85 12.66 3.96 12.94 4.04C13.22 4.13 13.73 3.78 14.51 3.25C15.29 2.73 15.51 3.14 15.8 3.38C16.1 3.63 16.37 3.9 16.62 4.2C16.86 4.49 17.27 4.71 16.75 5.49C16.22 6.27 15.87 6.78 15.96 7.06C16.04 7.34 16.15 7.61 16.29 7.87C16.43 8.12 17.03 8.24 17.96 8.42C18.88 8.59 18.75 9.04 18.78 9.42C18.82 9.81 18.82 10.19 18.78 10.58C18.75 10.96 18.88 11.41 17.96 11.58C17.03 11.76 16.43 11.88 16.29 12.13C16.15 12.39 16.04 12.66 15.96 12.94C15.87 13.22 16.22 13.73 16.75 14.51C17.27 15.29 16.86 15.51 16.62 15.8C16.37 16.1 16.1 16.37 15.8 16.62C15.51 16.86 15.29 17.27 14.51 16.75C13.73 16.22 13.22 15.87 12.94 15.96C12.66 16.04 12.39 16.15 12.13 16.29C11.88 16.43 11.76 17.03 11.58 17.96C11.41 18.88 10.96 18.75 10.58 18.78C10.19 18.82 9.81 18.82 9.42 18.78C9.04 18.75 8.59 18.88 8.42 17.96C8.24 17.03 8.12 16.43 7.87 16.29C7.61 16.15 7.34 16.04 7.06 15.96C6.78 15.87 6.27 16.22 5.49 16.75C4.71 17.27 4.49 16.86 4.2 16.62C3.9 16.37 3.63 16.1 3.38 15.8C3.14 15.51 2.73 15.29 3.25 14.51C3.78 13.73 4.13 13.22 4.04 12.94C3.96 12.66 3.85 12.39 3.71 12.13C3.57 11.88 2.97 11.76 2.04 11.58C1.12 11.41 1.25 10.96 1.22 10.58C1.18 10.19 1.18 9.81 1.22 9.42C1.25 9.04 1.12 8.59 2.04 8.42C2.97 8.24 3.57 8.12 3.71 7.87C3.85 7.61 3.96 7.34 4.04 7.06C4.13 6.78 3.78 6.27 3.25 5.49C2.73 4.71 3.14 4.49 3.38 4.2C3.63 3.9 3.9 3.63 4.2 3.38C4.49 3.14 4.71 2.73 5.49 3.25C6.27 3.78 6.78 4.13 7.06 4.04C7.34 3.96 7.61 3.85 7.87 3.71C8.12 3.57 8.24 2.97 8.42 2.04C8.59 1.12 9.04 1.25 9.42 1.22C9.81 1.18 10.19 1.18 10.58 1.22ZM10 6.8A3.2 3.2 0 1 0 10 13.2A3.2 3.2 0 1 0 10 6.8Z"/></svg>', // Settings/Sci-Fi
            '<svg data-icon="FILTER" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4H17L12 10.4V16L8 14V10.4Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 4L10 15L12 16L12 10.4L17 4L10 4Z"/></svg>', // Filter/Genre
            '<svg data-icon="VIDEO_CAMERA" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5H10A2 2 0 0 1 12 7V13A2 2 0 0 1 10 15H5A2 2 0 0 1 3 13V7A2 2 0 0 1 5 5Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M13 9L17 6.3A.7 .7 0 0 1 18 6.9V13.1A.7 .7 0 0 1 17 13.7L13 11Z"/></svg>', // Camera/Director
            '<svg data-icon="NOTE" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 15V5L16 3.4V13"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M6 12A3 3 0 1 0 6 18A3 3 0 1 0 6 12ZM14 10A3 3 0 1 0 14 16A3 3 0 1 0 14 10Z"/></svg>', // Music Note
            '<svg data-icon="BUILDING" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M4 2H10A2 2 0 0 1 12 4V16A2 2 0 0 1 10 18H4A2 2 0 0 1 2 16V4A2 2 0 0 1 4 2ZM5.4 5H6.6A0.4 0.4 0 0 1 7 5.4V6.6A0.4 0.4 0 0 1 6.6 7H5.4A0.4 0.4 0 0 1 5 6.6V5.4A0.4 0.4 0 0 1 5.4 5ZM8.4 5H9.6A0.4 0.4 0 0 1 10 5.4V6.6A0.4 0.4 0 0 1 9.6 7H8.4A0.4 0.4 0 0 1 8 6.6V5.4A0.4 0.4 0 0 1 8.4 5ZM5.4 9H6.6A0.4 0.4 0 0 1 7 9.4V10.6A0.4 0.4 0 0 1 6.6 11H5.4A0.4 0.4 0 0 1 5 10.6V9.4A0.4 0.4 0 0 1 5.4 9ZM8.4 9H9.6A0.4 0.4 0 0 1 10 9.4V10.6A0.4 0.4 0 0 1 9.6 11H8.4A0.4 0.4 0 0 1 8 10.6V9.4A0.4 0.4 0 0 1 8.4 9ZM6 14H8A0 0 0 0 1 8 14V18A0 0 0 0 1 8 18H6A0 0 0 0 1 6 18V14A0 0 0 0 1 6 14Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 8H15A2 2 0 0 1 17 10V17H13"/></svg>', // Building/Studio
            '<svg data-icon="LIST_NUMBERED" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 4L4.4 3V8M3 12.6A1.4 1.4 0 0 1 5.6 13.4C5.6 14.4 3 15.4 3 17H6"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 5H17M10 15H17"/></svg>' // List/Playlist
        ];
        
        modal.innerHTML = `
            <div class="collection-modal-content" style="
                background: var(--theme-bg-secondary);
                padding: 24px;
                border-radius: 12px;
                max-width: 500px;
                width: 90%;
                color: var(--theme-text-primary);
                box-shadow: var(--shadow-xl);
                max-height: 90vh;
                overflow-y: auto;
                border: 1px solid var(--theme-border);
            ">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                    <h3 style="margin: 0; font-size: 20px;">${isEdit ? 'Edit Collection' : 'Create Collection'}</h3>
                    <button class="modal-close-btn" style="
                        background: none;
                        border: none;
                        color: var(--text-secondary);
                        font-size: 24px;
                        cursor: pointer;
                        padding: 0;
                        width: 32px;
                        height: 32px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    ">×</button>
                </div>
                <form id="collectionForm" style="display: flex; flex-direction: column; gap: 16px;">
                    <div>
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">Collection Name</label>
                        <input type="text" id="collectionNameInput" 
                               value="${collection ? this.escapeHtml(collection.name) : ''}" 
                               placeholder="e.g., Комедии 90-х, Аниме 2025"
                               maxlength="50"
                               style="
                                   width: 100%;
                                   padding: 10px 12px;
                                   border-radius: 8px;
                                   border: 1px solid var(--theme-input-border);
                                   background: var(--theme-input-bg);
                                   color: var(--theme-input-text);
                                   font-size: 14px;
                               ">
                        <div style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">
                            <span id="nameCharCount">0</span>/50 characters
                        </div>
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">Icon</label>
                        
                        <!-- Icon grid: general icons, then franchise tiles -->
                        <div id="iconsGrid" style="display: flex; flex-wrap: wrap; gap: 8px; max-height: 360px; overflow-y: auto; padding: 8px; background: var(--theme-input-bg); border-radius: 8px; border: 1px solid var(--theme-border);">
                            <!-- Icons will be populated dynamically -->
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px;">
                        <button type="button" id="cancelCollectionBtn" style="
                            background: var(--theme-bg-tertiary);
                            color: var(--text-primary);
                            border: 1px solid var(--theme-border);
                            padding: 10px 16px;
                            border-radius: 8px;
                            cursor: pointer;
                            font-weight: 500;
                        ">Cancel</button>
                        <button type="submit" id="saveCollectionBtn" style="
                            background: var(--filter-include-border);
                            color: #ffffff;
                            border: none;
                            padding: 10px 16px;
                            border-radius: 8px;
                            cursor: pointer;
                            font-weight: 600;
                        ">${isEdit ? 'Save Changes' : 'Create'}</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        const nameInput = modal.querySelector('#collectionNameInput');
        const charCount = modal.querySelector('#nameCharCount');
        
        // An icon that can no longer be drawn (a truncated SVG from the old picker or
        // a picture from the removed upload) starts from the first icon, so saving
        // repairs the record.
        let selectedIcon = collection && CollectionService.isUsableIcon(collection.icon) ? collection.icon : defaultIcons[0];

        nameInput.addEventListener('input', () => {
            charCount.textContent = nameInput.value.length;
        });
        charCount.textContent = nameInput.value.length;

        // Function to render icons grid
        const renderIconsGrid = () => {
            const iconsGrid = modal.querySelector('#iconsGrid');
            if (!iconsGrid) return;

            let html = '';

            // Buttons point into this list by index: SVG markup does not survive a
            // round trip through an attribute, which is how collections ended up
            // saved with a truncated `<svg viewBox=` icon.
            const franchiseIcons = window.CollectionIcons?.FRANCHISE_ICONS || [];
            const gridIcons = [...defaultIcons, ...franchiseIcons.map(item => item.svg)];
            const isSelected = icon => selectedIcon === icon;
            const glyphButton = (icon, index, className, label = '', { box = 40, inset = 4, size = 28 } = {}) => `
                <button type="button" class="icon-select-btn ${className}"
                        data-icon-index="${index}"
                        data-selected="${isSelected(icon) ? 'true' : 'false'}"
                        ${label ? `title="${this.escapeHtml(label)}" aria-label="${this.escapeHtml(label)}"` : ''}
                        style="
                            width: ${box}px;
                            height: ${box}px;
                            padding: ${inset}px;
                            border: 2px solid ${isSelected(icon) ? 'var(--filter-include-border)' : 'var(--theme-border)'};
                            background: ${isSelected(icon) ? 'var(--filter-include-bg)' : 'transparent'};
                            border-radius: 8px;
                            cursor: pointer;
                            transition: all 0.2s;
                            color: var(--text-primary);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        ">${CollectionService.renderIconHtml(icon, { size })}</button>`;
            const groupTitle = text => `<div style="flex: 0 0 100%; margin-top: 4px; font-size: 12px; font-weight: 600; color: var(--text-secondary);">${text}</div>`;

            // General icons
            html += defaultIcons.map((icon, index) => glyphButton(icon, index, 'emoji-icon-btn')).join('');

            // Franchise tiles carry their own colour and corners, so they sit almost
            // edge to edge and are a little larger; each is named on hover.
            // With 50 of them they are split under the section's groups (Marvel,
            // DC, Кино…); an icon from an unknown group still shows, last.
            if (franchiseIcons.length > 0) {
                const offset = defaultIcons.length;
                const groups = window.CollectionIcons?.GROUPS || [];
                const tile = (item, index) => glyphButton(item.svg, offset + index, 'franchise-icon-btn', item.label, { box: 46, inset: 2, size: 38 });
                const sections = [...groups, { id: null, label: 'Другие' }].map(group => {
                    const items = franchiseIcons
                        .map((item, index) => ({ item, index }))
                        .filter(({ item }) => group.id ? item.group === group.id : !groups.some(known => known.id === item.group));
                    return items.length ? groupTitle(`Франшизы · ${group.label}`) + items.map(({ item, index }) => tile(item, index)).join('') : '';
                });
                html += sections.join('');
            }

            iconsGrid.innerHTML = html;

            // Add event listeners
            const iconButtons = iconsGrid.querySelectorAll('.icon-select-btn');
            iconButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    // Update selection UI
                    iconButtons.forEach(b => {
                        b.style.borderColor = 'var(--theme-border)';
                        b.style.background = 'transparent';
                        b.dataset.selected = 'false';
                    });
                    
                    btn.style.borderColor = 'var(--filter-include-border)';
                    btn.style.background = 'var(--filter-include-bg)';
                    btn.dataset.selected = 'true';
                    
                    selectedIcon = gridIcons[Number(btn.dataset.iconIndex)] ?? defaultIcons[0];
                });
            });
        };

        // Initial render
        renderIconsGrid();

        const close = () => modal.remove();
        modal.querySelector('.modal-close-btn').addEventListener('click', close);
        modal.querySelector('#cancelCollectionBtn').addEventListener('click', close);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });

        modal.querySelector('#collectionForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = nameInput.value.trim();

            if (!name) {
                (window.ConfirmDialog ? window.ConfirmDialog.alert({ message: 'Collection name is required' }) : window.alert('Collection name is required'));
                return;
            }

            try {
                if (!this.collectionService) {
                    if (typeof CollectionService !== 'undefined') {
                        this.collectionService = new CollectionService();
                    }
                }

                if (isEdit) {
                    await this.collectionService.updateCollection(collection.id, {
                        name: name,
                        icon: selectedIcon
                    });
                    if (typeof Utils !== 'undefined' && Utils.showToast) {
                        Utils.showToast('Collection updated', 'success');
                    }
                } else {
                    await this.collectionService.createCollection(name, selectedIcon);
                    if (typeof Utils !== 'undefined' && Utils.showToast) {
                        Utils.showToast('Collection created', 'success');
                    }
                }

                await this.loadCustomCollections();
                
                close();
            } catch (error) {
                console.error('Error saving collection:', error);
                (window.ConfirmDialog ? window.ConfirmDialog.alert({ message: error.message || 'Failed to save collection' }) : window.alert(error.message || 'Failed to save collection'));
            }
        });
    }

    setFilter(filter) {
        this.statusFilter = filter;
        this.closeCollectionMenu();
        
        // Update UI
        // Clear active from standard items
        this.elements.sidebarItems.forEach(item => {
            item.classList.remove('active');
        });
        
        // Clear active from collections
        if (this.elements.customCollectionsList) {
            this.elements.customCollectionsList.querySelectorAll('.collection-item').forEach(item => item.classList.remove('active'));
        }

        if (filter.startsWith('collection:')) {
            const collectionId = filter.split(':')[1];
            this.activeCollectionId = collectionId;
            const collectionItem = this.elements.customCollectionsList.querySelector(`[data-collection-id="${collectionId}"]`);
            if (collectionItem) collectionItem.classList.add('active');
            
            // Show collection menu button
            if (this.elements.collectionMenuBtn) {
                this.elements.collectionMenuBtn.style.display = 'flex';
            }
            
            // Set Title
            const known = this.availableCollections.find(c => c.id === collectionId);
            if (known && this.elements.pageTitle) {
                this.elements.pageTitle.textContent = known.name;
            } else {
                this.collectionService.getCollection(collectionId).then(col => {
                    if (this.statusFilter === filter && this.elements.pageTitle) {
                        this.elements.pageTitle.textContent = col ? col.name : 'Collection';
                    }
                });
            }
        } else {
            this.activeCollectionId = null;
            
            // Hide collection menu button
            if (this.elements.collectionMenuBtn) {
                this.elements.collectionMenuBtn.style.display = 'none';
            }
            
            // Activate standard item
            this.elements.sidebarItems.forEach(item => {
                 if (item.dataset.filter === filter) {
                    item.classList.add('active');
                }
            });
        
            // Update Title
            const titleMap = {
                'all': i18n.get('bookmarks.header.all_bookmarks'),
                'watching': i18n.get('bookmarks.sidebar.watching'),
                'watched': i18n.get('bookmarks.sidebar.watched'),
                'plan_to_watch': i18n.get('bookmarks.sidebar.plan_to_watch'),
                'favorite': i18n.get('bookmarks.sidebar.favorites')
            };
            if (this.elements.pageTitle) {
                this.elements.pageTitle.textContent = titleMap[filter] || i18n.get('bookmarks.title');
            }
        }

        window.FilterChoice?.syncSingleGroup(this.elements.sidebarNav, {
            value: filter.startsWith('collection:') ? '' : filter,
            attribute: 'data-filter', selector: '.sidebar-item'
        });
        window.FilterChoice?.syncSingleGroup(this.elements.customCollectionsList, {
            value: filter.startsWith('collection:') ? filter.slice('collection:'.length) : '',
            attribute: 'data-collection-id', selector: '.collection-item'
        });

        this.applyFilters();
    }

    async applyFilters() {
        const token = ++this.renderToken;
        let filtered = [];

        // 1. Status/Collection Filter
        if (this.statusFilter.startsWith('collection:')) {
            const collectionId = this.statusFilter.split(':')[1];
            if (this.collectionService) {
                try {
                    const known = this.availableCollections.find(c => c.id === collectionId);
                    const movieIds = known
                        ? (known.movieIds || [])
                        : await this.collectionService.getMoviesInCollection(collectionId);
                    
                    const collectionMovies = [];
                    // Create a map for fast lookup of existing bookmarks
                    const allBookmarksMap = new Map(this.allBookmarks.map(m => [String(m.movieId || m.id || m.kinopoiskId), m]));
                    const missingIds = [];
                    
                    for (const id of movieIds) {
                        const strId = String(id);
                        if (allBookmarksMap.has(strId)) {
                            collectionMovies.push(allBookmarksMap.get(strId));
                        } else {
                            missingIds.push(id);
                        }
                    }

                    // Fetch missing movies from cache/server
                    if (missingIds.length > 0) {
                        try {
                            const cachedMoviesMap = await this.loadCardMovies(missingIds);
                            
                            // Process cached movies
                            missingIds.forEach(id => {
                                const movieData = cachedMoviesMap[id];
                                if (movieData) {
                                    // Normalize for display
                                    const normalized = {
                                        ...movieData,
                                        movieId: movieData.id || movieData.kinopoiskId,
                                        // Ensure status is handled if relevant (might be 'viewed' or undefined)
                                        status: movieData.status || 'unknown' 
                                    };
                                    collectionMovies.push(normalized);
                                }
                            });
                        } catch (cacheError) {
                            console.error('Error fetching cached movies for collection:', cacheError);
                        }
                    }

                    filtered = collectionMovies;
                } catch (e) {
                    console.error("Error filtering collection", e);
                    filtered = [];
                }
            }
        } else if (this.statusFilter !== 'all') {
            filtered = [...this.allBookmarks].filter(item => item.status === this.statusFilter);
        } else {
             filtered = [...this.allBookmarks];
        }

        // 2. Search Filter
        if (this.searchTerm) {
            const term = this.searchTerm.toLowerCase();
            filtered = filtered.filter(item => {
                const title = (item.movieTitle || item.name || '').toLowerCase();
                const titleRu = (item.movieTitleRu || '').toLowerCase();
                return title.includes(term) || titleRu.includes(term);
            });
        }

        // 3. Sort
        const [sortBy, order] = this.currentSort.split('-');
        filtered.sort((a, b) => {
            let valA = a[sortBy];
            let valB = b[sortBy];

            // Date handling
            if (valA && typeof valA.toDate === 'function') valA = valA.toDate();
            if (valB && typeof valB.toDate === 'function') valB = valB.toDate();
            
            // Text comparison
            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            // Default values
            if (!valA) valA = 0;
            if (!valB) valB = 0;

            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        if (token !== this.renderToken) return;
        this.renderGrid(filtered, token);
    }

    /**
     * Cached movie data (ratings, posters) for cards, fetched once per visit and
     * shared by every list. A film being fetched is waited for, not fetched again.
     */
    async loadCardMovies(ids) {
        const wanted = [...new Set(ids.filter(Boolean).map(String))];
        const missing = wanted.filter(id => !this.cardMovieCache.has(id) && !this.cardMoviePending.has(id));
        if (missing.length > 0 && this.movieCacheService) {
            const request = this.movieCacheService.getBatchCachedMovies(missing)
                .then(found => {
                    // An empty answer may be a failed request (the service swallows
                    // errors), so those films stay unknown and are asked for again.
                    const answered = Object.keys(found || {}).length > 0;
                    for (const id of missing) {
                        if (found?.[id]) this.cardMovieCache.set(id, found[id]);
                        else if (answered) this.cardMovieCache.set(id, null);
                    }
                })
                .catch(error => console.warn('BookmarksPage: Could not load cached card ratings', error))
                .finally(() => missing.forEach(id => this.cardMoviePending.delete(id)));
            missing.forEach(id => this.cardMoviePending.set(id, request));
        }
        await Promise.all(new Set(wanted.map(id => this.cardMoviePending.get(id)).filter(Boolean)));
        const result = {};
        for (const id of wanted) {
            const movie = this.cardMovieCache.get(id);
            if (movie) result[id] = movie;
        }
        return result;
    }

    /** Watching progress, read once and dropped when a progress key changes. */
    loadProgress() {
        if (!this.progressSnapshot) {
            this.progressSnapshot = this.progressService
                ? this.progressService.getAllProgress().catch(error => {
                    console.warn('BookmarksPage: Could not read watching progress', error);
                    this.progressSnapshot = null;
                    return {};
                })
                : Promise.resolve({});
        }
        return this.progressSnapshot;
    }

    async renderGrid(movies, token = this.renderToken) {
        const grid = this.elements.moviesGrid;
        const movieIds = movies.map(movie => movie.movieId || movie.kinopoiskId).filter(Boolean);
        const [cachedMovies, allProgress] = await Promise.all([this.loadCardMovies(movieIds), this.loadProgress()]);

        // A later switch already owns the grid; drawing this one would replace it.
        if (token !== this.renderToken) return;

        // Fetch the other bookmarks in the background so the next switch draws at once.
        void this.loadCardMovies(this.allBookmarks.map(movie => movie.movieId || movie.kinopoiskId));

        grid.innerHTML = '';

        if (movies.length === 0) {
            this.updateEmptyStateText();
            this.elements.emptyState.style.display = 'flex';
            this.elements.moviesGrid.style.display = 'none';
            return;
        }

        this.elements.emptyState.style.display = 'none';
        this.elements.moviesGrid.style.display = 'grid';
        this.elements.moviesGrid.classList.add('anime-grid'); // Enable anime-style grid spacing

        const cards = document.createDocumentFragment();
        movies.forEach(movieData => {
            const movieId = movieData.movieId || movieData.kinopoiskId;
            const cachedMovie = cachedMovies[movieId] || cachedMovies[String(movieId)] || cachedMovies[Number(movieId)];
            // Prepare movie object for card with normalized fields
            const rawName = movieData.name || movieData.movieTitle || 'Unknown Movie';
            const cleanName = Utils.cleanTitle(rawName);

            const kpScore = cachedMovie?.kpRating || cachedMovie?.ratingKp || cachedMovie?.ratingKinopoisk 
                || (typeof cachedMovie?.rating === 'object' ? cachedMovie.rating?.kp : null)
                || movieData.kpRating || movieData.ratingKp 
                || (typeof movieData.rating === 'object' ? movieData.rating?.kp : null)
                || (typeof movieData.rating === 'number' ? movieData.rating : null) || 0;

            const imdbScore = cachedMovie?.imdbRating || cachedMovie?.ratingImdb 
                || (typeof cachedMovie?.rating === 'object' ? cachedMovie.rating?.imdb : null)
                || movieData.imdbRating || movieData.ratingImdb 
                || (typeof movieData.rating === 'object' ? movieData.rating?.imdb : null) || 0;
            
            const movieObj = {
                kinopoiskId: movieId,
                name: cleanName,
                originalName: movieData.originalName || movieData.movieTitleOriginal || cachedMovie?.originalName || cachedMovie?.alternativeName || '',
                year: movieData.year || movieData.releaseYear || cachedMovie?.year || cachedMovie?.releaseYear || '',
                posterUrl: movieData.posterUrl || movieData.posterPath || cachedMovie?.posterUrl || cachedMovie?.posterPath || cachedMovie?.poster || '',
                kpRating: Number(kpScore) || 0,
                imdbRating: Number(imdbScore) || 0,
                votes: { ...(movieData.votes || {}), ...(cachedMovie?.votes || {}) },
                genres: (Array.isArray(movieData.genres) && movieData.genres.length > 0) ? movieData.genres : (cachedMovie?.genres || []),
                description: movieData.description || cachedMovie?.description || ''
            };

            const cardData = {
                movieId: movieObj.kinopoiskId,
                id: movieData.id || movieObj.kinopoiskId, // ensure id is present for keys
                ...movieData,
                movie: movieObj, // Explicitly pass movie object
                // Status for card logic
                status: movieData.status, // Pass status to card
                // Boolean flags for toggles
                isFavorite: movieData.status === 'favorite',
                isWatching: movieData.status === 'watching',
                isWatched: movieData.status === 'watched',
                isInWatchlist: movieData.status === 'plan_to_watch',
                
                // Collections
                availableCollections: this.availableCollections || [],
                movieCollections: (this.availableCollections || [])
                    .filter(c => c.movieIds && (c.movieIds.includes(Number(movieObj.kinopoiskId)) || c.movieIds.includes(String(movieObj.kinopoiskId))))
                    .map(c => c.id)
            };

            // Determine progress text
            let progressText = null;
            if (allProgress && allProgress[movieObj.kinopoiskId]) {
                const p = allProgress[movieObj.kinopoiskId];
                const type = movieData.type || movieData.movieType || 'unknown';
                const isMovie = type === 'movie' || type === 'film';
                const isSeries = ['tv-series', 'mini-series', 'cartoon', 'animated-series', 'anime', 'tv-show'].includes(type);

                // Helper to format season/episode string
                const formatSeasonEpisode = () => {
                    if (!p.season && !p.episode) return null;
                    const seasonIsNumber = typeof p.season === 'number' || /^\d+$/.test(p.season);
                    const episodeIsNumber = typeof p.episode === 'number' || /^\d+$/.test(p.episode);
                    
                    let label = '';
                    if (p.season) {
                        label += seasonIsNumber ? `${p.season} сезон` : p.season;
                    }
                    if (p.season && p.episode) label += ', ';
                    if (p.episode) {
                        label += episodeIsNumber ? `${p.episode} серия` : p.episode;
                    }
                    return label;
                };

                if (isMovie) {
                    // For movies: STRICTLY show timestamp if available
                    if (p.timestamp) {
                        progressText = this.formatTimestamp(p.timestamp);
                    }
                } else if (isSeries) {
                    // For series: STRICTLY show season/episode
                    // Ignore timestamp for series unless user specifically wants it (usually they don't)
                    progressText = formatSeasonEpisode();
                } else {
                    // Fallback for unknown types (legacy logic)
                    // Try season/episode first, then timestamp
                    const se = formatSeasonEpisode();
                    if (se) {
                        progressText = se;
                    } else if (p.timestamp) {
                        progressText = this.formatTimestamp(p.timestamp);
                    }
                }
            }

            const card = MovieCard.create(cardData, {
                watchingProgress: progressText,
                showThreeDotMenu: true,
                showBookmarkStatus: true,
                animeStyle: false, // Standard clean card design
                // Enable status toggles (like in Rated page)
                showFavorite: true,
                showWatching: true,
                showWatched: true,
                showWatchlist: true,
                showRemoveFromBookmarks: false, // Disabled as requested, now we have status toggles
                
                showAverageRating: false, // User requested KP/IMDb instead of Avg Rating
                showGenres: false, // User requested short info
                showDescription: false, // User requested short info
                // We'll update MovieCard to handle "status" visualization
                currentStatus: movieData.status,
                
                // Pass collections
                availableCollections: cardData.availableCollections,
                movieCollections: cardData.movieCollections
            });

            cards.appendChild(card);

            // Make the entire card clickable
            card.style.cursor = 'pointer';
            card.setAttribute('data-action', 'view-details');
            card.setAttribute('data-movie-id', cardData.movieId);
        });
        grid.appendChild(cards);
    }



    /**
     * A signed-out visitor is asked to sign in, an empty collection says so, and
     * the other lists keep the bookmarks wording.
     */
    updateEmptyStateText() {
        const state = this.elements.emptyState;
        const title = state?.querySelector('h3');
        const message = state?.querySelector('p');
        if (!title || !message || typeof i18n === 'undefined') return;
        let prefix = 'bookmarks.empty.';
        if (this.signedOut) prefix = 'bookmarks.empty.signed_out_';
        else if (this.statusFilter.startsWith('collection:')) prefix = 'bookmarks.empty.collection_';
        title.textContent = i18n.get(`${prefix}title`);
        message.textContent = i18n.get(`${prefix}message`);
    }

    // Local showLoading/hideLoading removed in favor of this.page (PageStateManager)

    closeCollectionMenu() {
        if (!this.collectionMenu) return;
        this.collectionMenu.remove();
        this.collectionMenu = null;
        this.elements.collectionMenuBtn?.setAttribute('aria-expanded', 'false');
    }

    toggleCollectionMenuDropdown() {
        if (this.collectionMenu) {
            this.closeCollectionMenu();
            return;
        }

        // The menu is the button's sibling. It used to be appended inside the
        // button with a class the styles never open ('show' instead of 'open'), so
        // it stayed invisible, and a press on an item reached the button first and
        // removed the menu before the item's click.
        const dropdown = document.createElement('div');
        dropdown.className = 'collection-dropdown';
        dropdown.setAttribute('role', 'menu');
        dropdown.innerHTML = `
            <button type="button" class="dropdown-item" role="menuitem" data-action="edit-collection">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                Edit Collection
            </button>
            <button type="button" class="dropdown-item delete" role="menuitem" data-action="delete-collection">
                <svg data-icon="TRASH" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M7 4V3A1 1 0 0 1 8 2H12A1 1 0 0 1 13 3V4H16A1 1 0 0 1 17 5V6A1 1 0 0 1 16 7H4A1 1 0 0 1 3 6V5A1 1 0 0 1 4 4Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8V15A2 2 0 0 0 7 17H13A2 2 0 0 0 15 15V8M10 10V13"/></svg>
                Delete Collection
            </button>
        `;

        const menuBtn = this.elements.collectionMenuBtn;
        menuBtn.after(dropdown);
        this.collectionMenu = dropdown;
        menuBtn.setAttribute('aria-expanded', 'true');
        // Read layout once so the opening transition starts from the closed state.
        // (requestAnimationFrame would not run while the tab is in the background.)
        void dropdown.offsetHeight;
        dropdown.classList.add('open');

        dropdown.querySelector('[data-action="edit-collection"]').addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeCollectionMenu();
            this.editActiveCollection();
        });

        dropdown.querySelector('[data-action="delete-collection"]').addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeCollectionMenu();
            this.deleteActiveCollection();
        });
    }

    async editActiveCollection() {
        if (!this.activeCollectionId) return;

        const collection = await this.collectionService.getCollection(this.activeCollectionId);
        if (collection) {
            this.showCollectionModal(collection);
        }
    }

    async deleteActiveCollection() {
        if (!this.activeCollectionId) return;

        const collection = await this.collectionService.getCollection(this.activeCollectionId);
        if (!collection) return;

        const confirmed = await ConfirmDialog.confirm({
            title: i18n.get('confirm_dialog.delete_collection_title').replace('{name}', collection.name || ''),
            message: i18n.get('confirm_dialog.delete_collection_message'),
            confirmLabel: i18n.get('confirm_dialog.delete'),
            danger: true
        });
        if (!confirmed) return;

        try {
            await this.collectionService.deleteCollection(this.activeCollectionId);
            
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Collection deleted', 'success');
            }

            // Reload collections and switch to "All" view
            await this.loadCustomCollections();
            this.setFilter('all');
        } catch (error) {
            console.error('Error deleting collection:', error);
            (window.ConfirmDialog ? window.ConfirmDialog.alert({ message: 'Failed to delete collection: ' + error.message }) : window.alert('Failed to delete collection: ' + error.message));
        }
    }
    
    /**
     * Format timestamp in seconds to H:MM:SS format
     */
    formatTimestamp(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }


}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.bookmarksPage = new BookmarksPageManager();
});
