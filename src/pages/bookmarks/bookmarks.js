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
        
        this.init();
    }

    async init() {
        this.initializeElements();
        this.setupEventListeners();

        // Initialize ProgressService early so cached data renders with progress info
        if (typeof ProgressService !== 'undefined') {
            this.progressService = new ProgressService();
        }

        await i18n.init();
        i18n.translatePage();

        // Load cached data immediately for instant render
        const cacheHit = await this.loadCachedData();
        
        if (typeof CollectionService !== 'undefined') {
            this.collectionService = new CollectionService();
        }
        
        if (typeof MovieCacheService !== 'undefined' && typeof window.firebaseManager !== 'undefined') {
            this.movieCacheService = new MovieCacheService(window.firebaseManager);
        }
        
        await this.setupFirebase();
        
        // Only fetch from server if cache was not found
        if (!cacheHit.collections) {
            await this.loadCustomCollections();
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
                    console.log('BookmarksPage: Progress updated, refreshing grid...');
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
        this.elements.sidebarItems.forEach(item => {
            item.addEventListener('mousedown', () => {
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
            this.elements.sortSelect.addEventListener('change', (e) => {
                this.currentSort = e.target.value;
                this.applyFilters();
            });
        }

        // Migration removed

        // Event Delegation for Movie Cards
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
                case 'toggle-favorite':
                    // If currently favorite (is-favorite="true"), remove. Else set to favorite.
                    // Actually, we can just use the target's state or the movie's current state.
                    // But simpler: just toggle to 'favorite' if not already, or remove if is.
                    // However, we have handleStatusChange which takes newStatus.
                    // If we are toggling, we need to know current state.
                    // Let's check the button's data attribute or the local movie object.
                    this.handleToggleAction(movieId, 'favorite', target);
                    break;
                case 'toggle-watching':
                    this.handleToggleAction(movieId, 'watching', target);
                    break;
                case 'toggle-watchlist':
                    this.handleToggleAction(movieId, 'plan_to_watch', target);
                    break;
                case 'toggle-watched':
                    this.handleToggleAction(movieId, 'watched', target);
                    break;
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
                case 'toggle-collection':
                    const collectionId = target.dataset.collectionId;
                    if (collectionId) {
                        this.handleToggleCollection(movieId, collectionId, target);
                    }
                    break;
                case 'resume-watching':
                    // Redirect to search page with autoplay=true
                    if (movieId) {
                        window.location.href = `../movie-details/movie-details.html?movieId=${movieId}&autoplay=true`;
                    }
                    break;
            }
        });

        document.addEventListener('movie-card-status-change', async (e) => {
            const { movieId, status } = e.detail;
            await this.handleStatusChange(movieId, status);
        });

        document.addEventListener('movie-card-remove', async (e) => {
            const { movieId } = e.detail;
            await this.handleRemoveBookmark(movieId);
        });


        // Collection Modal Listeners
        if (this.elements.createCollectionBtn) {
            this.elements.createCollectionBtn.addEventListener('mousedown', () => {
                this.showCollectionModal();
            });
        }
        
        // Collection Menu Button
        if (this.elements.collectionMenuBtn) {
            this.elements.collectionMenuBtn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this.toggleCollectionMenuDropdown();
            });
        }

        // Use centralized menu delegation
        Utils.bindTabsAndMenus(document);
    }

    async handleToggleAction(movieId, targetStatus, button) {
        // Find current movie status
        const movie = this.allBookmarks.find(m => m.movieId == movieId || m.id == movieId);
        if (!movie) return;

        if (movie.status === targetStatus) {
            // If already in this status, remove it (toggle off)
            await this.handleRemoveBookmark(movieId); // Or just set status to null if we supported that? usually remove.
        } else {
            // Set to new status
            await this.handleStatusChange(movieId, targetStatus);
            
            // Optimistic button update could happen here but handleStatusChange does full re-render/update
        }
    }

    async handleStatusChange(movieId, newStatus) {
        if (!this.currentUser || !movieId) return;

        try {
            // Update in Firestore
            await this.favoriteService.updateStatus(this.currentUser.uid, movieId, newStatus);
            
            // Update local data
            const movie = this.allBookmarks.find(m => m.movieId == movieId || m.id == movieId);
            if (movie) {
                movie.status = newStatus;
                movie.updatedAt = new Date(); // Optimistic update
            }

            // Update UI (counts)
            this.updateCounts();
            
            // Update grid without full re-render
            const card = this.elements.moviesGrid.querySelector(`[data-movie-id="${movieId}"]`);
            if (card) {
                const isFilteredOut = this.statusFilter !== 'all' && 
                                     !this.statusFilter.startsWith('collection:') && 
                                     this.statusFilter !== newStatus;
                
                if (isFilteredOut) {
                    card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    card.style.opacity = '0';
                    card.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        if (card && card.parentNode) card.remove();
                        const visibleCards = this.elements.moviesGrid.querySelectorAll('.movie-card-component:not([style*="opacity: 0"])');
                        if (visibleCards.length === 0) {
                            this.elements.emptyState.style.display = 'flex';
                            this.elements.moviesGrid.style.display = 'none';
                        }
                    }, 300);
                } else {
                    const btnActions = [
                        { action: 'favorite', statusMatch: 'favorite', iconOn: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>', iconOff: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>' },
                        { action: 'watching', statusMatch: 'watching', iconOn: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>', iconOff: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>' },
                        { action: 'watched', statusMatch: 'watched', iconOn: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>', iconOff: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>' },
                        { action: 'watchlist', statusMatch: 'plan_to_watch', iconOn: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>', iconOff: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>' }
                    ];
                    
                    btnActions.forEach(item => {
                        const btn = card.querySelector(`[data-action="toggle-${item.action}"]`);
                        if (btn) {
                            const isActive = newStatus === item.statusMatch;
                            btn.style.backgroundColor = isActive ? '#c0c0c0' : '';
                            btn.style.color = isActive ? '#000' : '';
                            
                            const textSpan = btn.querySelector('.mc-menu-item-text');
                            if (textSpan) {
                                textSpan.style.fontWeight = isActive ? '500' : '';
                                if (window.i18n) {
                                    textSpan.textContent = window.i18n.get(`movie_card.${isActive ? 'remove' : 'add'}_${item.action}`);
                                }
                            }
                            
                            const iconSpan = btn.querySelector('.mc-menu-item-icon');
                            if (iconSpan) {
                                iconSpan.innerHTML = isActive ? item.iconOn : item.iconOff;
                            }
                            
                            const attrName = item.action === 'watchlist' ? 'data-is-in-watchlist' : `data-is-${item.action}`;
                            btn.setAttribute(attrName, isActive.toString());
                        }
                    });
                }
            } else if (this.statusFilter === newStatus) {
                this.applyFilters();
            }
            
            // Show toast (if Utils available)
            if (typeof Utils !== 'undefined') {
                Utils.showToast(`Status updated to ${newStatus.replace('_', ' ')}`, 'success');
            }
        } catch (error) {
            console.error('Failed to update status:', error);
            if (typeof Utils !== 'undefined') {
                Utils.showToast('Failed to update status', 'error');
            }
        }
    }

    async handleRemoveBookmark(movieId) {
        if (!this.currentUser || !movieId) return;
        
        if (!confirm('Are you sure you want to remove this movie from all lists (Favorites, Watching, Plan to Watch)?')) {
            return;
        }

        try {
            const success = await this.favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
            if (success) {
                // Remove from local list
                this.allBookmarks = this.allBookmarks.filter(m => 
                    (m.movieId && String(m.movieId) !== String(movieId)) && 
                    (m.kinopoiskId && String(m.kinopoiskId) !== String(movieId))
                );
                
                // Update counts
                this.updateCounts();
                
                const card = this.elements.moviesGrid.querySelector(`[data-movie-id="${movieId}"]`);
                if (card) {
                    card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    card.style.opacity = '0';
                    card.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        if (card && card.parentNode) card.remove();
                        const visibleCards = this.elements.moviesGrid.querySelectorAll('.movie-card-component:not([style*="opacity: 0"])');
                        if (visibleCards.length === 0) {
                            this.elements.emptyState.style.display = 'flex';
                            this.elements.moviesGrid.style.display = 'none';
                        }
                    }, 300);
                }
                
                if (typeof Utils !== 'undefined') Utils.showToast('Removed from bookmarks', 'success');
            }
        } catch (error) {
            console.error('Error removing bookmark:', error);
            if (typeof Utils !== 'undefined') Utils.showToast('Error removing bookmark', 'error');
        }
    }

    async handleToggleCollection(movieId, collectionId, buttonElement) {
        if (!this.collectionService) return;
        
        // Optimistic UI update
        const originalHtml = buttonElement.innerHTML;
        const textSpan = buttonElement.querySelector('.mc-menu-item-text');
        
        try {
            // Check if checkmark exists (it's a span with margin-left: auto)
            // We can look for the specific content or style
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

            await this.collectionService.toggleMovieInCollection(collectionId, parseInt(movieId)); // ID type?
            
            // Update availableCollections cache? 
            // The collection object in availableCollections needs update for renderGrid correctness on next render
            const col = this.availableCollections.find(c => c.id === collectionId);
            if (col) {
                const idToCheck = parseInt(movieId); // Assuming numbers
                // If it was already there (based on isCheck), remove it.
                // But checks were based on DOM.
                // Let's rely on server response or manually update cache.
                const idx = col.movieIds.indexOf(idToCheck);
                if (idx > -1) {
                    col.movieIds.splice(idx, 1);
                } else {
                    col.movieIds.push(idToCheck);
                }
            }

            if (typeof Utils !== 'undefined') Utils.showToast(isChecked ? 'Removed from collection' : 'Added to collection', 'success');

        } catch (error) {
            console.error('Error toggling collection:', error);
            // Revert UI
            buttonElement.innerHTML = originalHtml;
            if (typeof Utils !== 'undefined') Utils.showToast('Error updating collection', 'error');
        }
    }
    async setupFirebase() {
        if (typeof firebaseManager === 'undefined') {
            throw new Error('Firebase Manager not available');
        }
        await firebaseManager.waitForAuthReady();
        this.currentUser = firebaseManager.getCurrentUser();
        
        if (!this.currentUser) {
            window.location.href = chrome.runtime.getURL('src/popup/popup.html');
        }

        this.favoriteService = firebaseManager.getFavoriteService();
    }

    async loadBookmarks() {
        if (!this.currentUser) return;

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
            if (counts.hasOwnProperty(item.status)) {
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

        this.elements.customCollectionsList.innerHTML = collections.map(col => {
            // Check if icon is custom
            const isCustomIcon = col.icon && (col.icon.startsWith('data:') || col.icon.startsWith('https://') || col.icon.startsWith('http://'));
            const iconHtml = isCustomIcon 
                ? `<img src="${col.icon}" style="width: 20px; height: 20px; object-fit: cover; border-radius: 4px;">`
                : (col.icon || '🎬');

            return `
                <button class="sidebar-item collection-item ${this.activeCollectionId === col.id ? 'active' : ''}" data-collection-id="${col.id}">
                    <span class="sidebar-icon">${iconHtml}</span>
                    <span class="sidebar-label">${col.name}</span>
                    <span class="sidebar-count">${col.movieIds?.length || 0}</span>
                </button>
            `;
        }).join('');

        // Add click handlers
        this.elements.customCollectionsList.querySelectorAll('.collection-item').forEach(item => {
            item.addEventListener('mousedown', () => {
                const collectionId = item.dataset.collectionId;
                this.setFilter(`collection:${collectionId}`);
            });
        });
    }


    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>', // Film
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM8 15c0-1.66 1.34-3 3-3 .35 0 .69.07 1 .18V6h5v2h-3v7.03c-.02 1.64-1.35 2.97-3 2.97-1.66 0-3-1.34-3-3z"/></svg>', // Music
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H3V8h18v8zM9 10v4l4-2z"/></svg>', // Play/Video
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>', // Search/Mystery
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>', // Favorites/Check
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>', // Star/Featured
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/></svg>', // Calendar/Schedule
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>', // Person/Actor
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 12c0 .28-.11.53-.29.71l-3.54 3.54c-.19.19-.44.29-.71.29s-.52-.1-.7-.29-.29-.44-.29-.71V9.54c0-.27.1-.52.29-.71s.43-.29.7-.29c.28 0 .53.11.71.29l3.54 3.54c.19.18.29.43.29.71zM23 12c0-3.26-1.46-6.34-4-8.47V3.5c0-.28-.22-.5-.5-.5s-.5.22-.5.5v.89c-.37-.23-.74-.44-1.13-.64C15.46 2.65 13.76 2 12 2S8.54 2.65 7.13 3.75c-.39.2-.76.41-1.13.64V3.5c0-.28-.22-.5-.5-.5s-.5.22-.5.5v.03C2.46 5.66 1 8.74 1 12s1.46 6.34 4 8.47v.03c0 .28.22.5.5.5s.5-.22.5-.5v-.89c.37.23.74.44 1.13.64C8.54 21.35 10.24 22 12 22s3.46-.65 4.87-1.75c.39-.2.76-.41 1.13-.64v.89c0 .28.22.5.5.5s.5-.22.5-.5v-.03c2.54-2.13 4-5.21 4-8.47zM3 12c0-2.39.93-4.64 2.62-6.33l1.23 1.23C5.29 8.46 4.5 10.17 4.5 12s.79 3.54 2.35 5.1l-1.23 1.23C3.93 16.64 3 14.39 3 12zm9 7.5c-1.83 0-3.54-.79-5.1-2.35l1.23-1.23c1.11 1.11 2.52 1.73 3.87 1.73s2.76-.62 3.87-1.73l1.23 1.23c-1.56 1.56-3.27 2.35-5.1 2.35zm6.38-1.17l-1.23-1.23C18.71 15.54 19.5 13.83 19.5 12s-.79-3.54-2.35-5.1l1.23-1.23C20.07 7.36 21 9.61 21 12s-.93 4.64-2.62 6.33z"/></svg>', // Target/Aim
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>', // Message/Dialog
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>', // Chart/Stats
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>', // Happy/Comedy
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.11-.9-2-2-2zm0 14H3V5h18v12z"/></svg>', // TV/Series
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>', // Info/Documentary
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>', // Settings/Sci-Fi
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 6h10l-5.01 6.3L7 6zm-2.75-.39C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39c.51-.66.04-1.61-.79-1.61H5.04c-.83 0-1.3.95-.79 1.61z"/></svg>', // Filter/Genre
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>', // Camera/Director
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/></svg>', // Music Note
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM8 20H5v-2h3v2zm0-4H5v-2h3v2zm0-4H5V8h3v4zm6 8h-3v-2h3v2zm0-4h-3v-2h3v2zm0-4h-3V8h3v4zm5 8h-3v-2h3v2zm0-4h-3v-2h3v2zm0-4h-3V8h3v4z"/></svg>', // Building/Studio
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/></svg>' // List/Playlist
        ];
        
        // Check if current icon is a custom image (base64 or Firebase Storage URL)
        const isCustomIcon = collection && collection.icon && (collection.icon.startsWith('data:') || collection.icon.startsWith('https://') || collection.icon.startsWith('http://'));

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
                        
                        <!-- Custom Icon Upload Section -->
                        <div style="margin-bottom: 12px;">
                            <input type="file" id="customIconInput" accept="image/png,image/jpeg,image/jpg,image/gif" style="display: none;">
                            <button type="button" id="uploadIconBtn" style="
                                background: var(--filter-include-bg);
                                color: var(--filter-include-text);
                                border: 1px solid var(--filter-include-border);
                                padding: 8px 12px;
                                border-radius: 6px;
                                cursor: pointer;
                                font-size: 13px;
                                font-weight: 500;
                                display: flex;
                                align-items: center;
                                gap: 6px;
                            ">
                                <span>📁</span> Upload Custom Icon
                            </button>
                            <div id="customIconPreview" style="
                                margin-top: 8px;
                                display: ${isCustomIcon ? 'flex' : 'none'};
                                align-items: center;
                                gap: 8px;
                                padding: 8px;
                                background: var(--theme-bg-tertiary);
                                border-radius: 8px;
                            ">
                                <img id="customIconImg" src="${isCustomIcon ? collection.icon : ''}" style="
                                    width: 40px;
                                    height: 40px;
                                    object-fit: cover;
                                    border-radius: 6px;
                                    border: 2px solid var(--accent-color);
                                ">
                                <span style="flex: 1; font-size: 13px; color: var(--text-secondary);">Custom icon</span>
                                <button type="button" id="removeCustomIconBtn" style="
                                    background: none;
                                    border: none;
                                    color: var(--text-secondary);
                                    cursor: pointer;
                                    font-size: 18px;
                                    padding: 4px;
                                ">×</button>
                            </div>
                            <div style="margin-top: 4px; font-size: 11px; color: var(--text-secondary);">
                                Max 500KB • PNG, JPG, GIF
                            </div>
                        </div>
                        
                        <!-- Emoji Icons Grid -->
                        <div id="iconsGrid" style="display: flex; flex-wrap: wrap; gap: 8px; max-height: 150px; overflow-y: auto; padding: 8px; background: var(--theme-input-bg); border-radius: 8px; border: 1px solid var(--theme-border);">
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
        const customIconInput = modal.querySelector('#customIconInput');
        const uploadIconBtn = modal.querySelector('#uploadIconBtn');
        const customIconPreview = modal.querySelector('#customIconPreview');
        const customIconImg = modal.querySelector('#customIconImg');
        const removeCustomIconBtn = modal.querySelector('#removeCustomIconBtn');
        
        let selectedIcon = collection ? collection.icon : defaultIcons[0];
        let customIconData = isCustomIcon ? collection.icon : null;

        nameInput.addEventListener('input', () => {
            charCount.textContent = nameInput.value.length;
        });
        charCount.textContent = nameInput.value.length;

        // Custom icon upload handler
        uploadIconBtn.addEventListener('mousedown', () => {
            customIconInput.click();
        });

        customIconInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Validate file type
            const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
            if (!validTypes.includes(file.type)) {
                alert('Please select a valid image file (PNG, JPG, or GIF)');
                return;
            }

            // Validate file size (500KB)
            if (file.size > 500 * 1024) {
                alert('Image size must be less than 500KB');
                return;
            }

            try {
                // Convert image to base64
                const reader = new FileReader();
                reader.onload = async (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const width = img.width;
                        const height = img.height;
                        const aspectRatio = width / height;

                        // Validate aspect ratio (prevent too wide or too tall)
                        if (aspectRatio > 1.5) {
                            alert('Image is too wide. Please use a square or near-square image.');
                            customIconInput.value = ''; // Clear input
                            return;
                        }
                        if (aspectRatio < 0.67) {
                            alert('Image is too tall. Please use a square or near-square image.');
                            customIconInput.value = ''; // Clear input
                            return;
                        }

                        // Create canvas to resize and crop
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        
                        // Set fixed standard size for all icons
                        const standardSize = 128;
                        canvas.width = standardSize;
                        canvas.height = standardSize;

                        // Calculate center crop
                        let sourceX = 0;
                        let sourceY = 0;
                        let sourceSize = 0;

                        if (width > height) {
                            sourceSize = height;
                            sourceX = (width - height) / 2;
                            sourceY = 0;
                        } else {
                            sourceSize = width;
                            sourceX = 0;
                            sourceY = (height - width) / 2;
                        }

                        // Draw cropped and resized image
                        ctx.drawImage(
                            img, 
                            sourceX, sourceY, sourceSize, sourceSize, // Source crop
                            0, 0, standardSize, standardSize          // Destination resize
                        );
                        
                        // Upload to Firebase Storage if authenticated, otherwise use base64
                        canvas.toBlob(async (blob) => {
                            if (!blob) return;

                            // Show loading state
                            const originalBtnContent = uploadIconBtn.innerHTML;
                            uploadIconBtn.textContent = 'Uploading...';
                            uploadIconBtn.disabled = true;

                            try {
                                let iconUrl;
                                const user = (typeof firebaseManager !== 'undefined') ? firebaseManager.getCurrentUser() : null;

                                if (user && typeof firebaseManager !== 'undefined' && firebaseManager.uploadCollectionIcon) {
                                    // Authenticated: Upload to Storage
                                    try {
                                        const result = await firebaseManager.uploadCollectionIcon(blob);
                                        iconUrl = result.iconURL;
                                    } catch (uploadError) {
                                        console.error('Upload failed, falling back to base64:', uploadError);
                                        iconUrl = canvas.toDataURL(file.type, 0.9);
                                    }
                                } else {
                                    // Unauthenticated: Use base64
                                    iconUrl = canvas.toDataURL(file.type, 0.9);
                                }

                                customIconData = iconUrl;
                                selectedIcon = customIconData;
                                
                                // Show preview
                                customIconImg.src = customIconData;
                                customIconPreview.style.display = 'flex';
                                
                                // Deselect all grid icons
                                const iconButtons = modal.querySelectorAll('.icon-select-btn');
                                iconButtons.forEach(btn => {
                                    btn.style.borderColor = 'var(--theme-border)';
                                    btn.style.background = 'transparent';
                                    btn.dataset.selected = 'false';
                                });

                                // Save the new custom icon
                                if (this.collectionService) {
                                    this.collectionService.saveCustomIcon(customIconData).then(() => {
                                        // Refresh grid to show new icon
                                        renderIconsGrid();
                                    });
                                }
                            } catch (error) {
                                console.error('Error processing icon:', error);
                                alert('Failed to process icon');
                            } finally {
                                uploadIconBtn.innerHTML = originalBtnContent;
                                uploadIconBtn.disabled = false;
                            }
                        }, file.type, 0.9);
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            } catch (error) {
                console.error('Error processing image:', error);
                alert('Failed to process image');
            }
        });

        // Remove custom icon handler
        removeCustomIconBtn.addEventListener('mousedown', () => {
            customIconData = null;
            selectedIcon = defaultIcons[0];
            customIconPreview.style.display = 'none';
            customIconInput.value = '';
            
            // Select first emoji by default (re-render grid is safer but let's do manual update for now)
            const firstIconBtn = modal.querySelector('.icon-select-btn');
            if (firstIconBtn) {
                firstIconBtn.style.borderColor = 'var(--filter-include-border)';
                firstIconBtn.style.background = 'var(--filter-include-bg)';
                firstIconBtn.dataset.selected = 'true';
            }
        });

        // Function to render icons grid
        const renderIconsGrid = async () => {
            const iconsGrid = modal.querySelector('#iconsGrid');
            if (!iconsGrid) return;

            // Get saved custom icons from local storage
            let savedIcons = [];
            if (this.collectionService) {
                savedIcons = await this.collectionService.getSavedIcons();
            } else {
                // Fallback if service not ready
                const result = await chrome.storage.local.get(['savedCustomIcons']);
                savedIcons = result.savedCustomIcons || [];
            }

            // ALSO get custom icons from existing collections (Firebase Storage URLs)
            const existingCollections = await this.collectionService.getCollections();
            const customIconsFromCollections = existingCollections
                .map(c => c.icon)
                .filter(icon => icon && (icon.startsWith('data:') || icon.startsWith('https://') || icon.startsWith('http://')))
                .filter((icon, index, self) => self.indexOf(icon) === index); // unique only

            // Merge: prioritize locally saved icons, then add collection icons not already in the list
            const allCustomIcons = [...savedIcons];
            customIconsFromCollections.forEach(icon => {
                if (!allCustomIcons.includes(icon)) {
                    allCustomIcons.push(icon);
                }
            });

            let html = '';

            // Render saved custom icons (including Firebase Storage URLs from collections)
            if (allCustomIcons.length > 0) {
                html += allCustomIcons.map(icon => `
                    <button type="button" class="icon-select-btn custom-icon-btn" 
                            data-icon="${icon}" 
                            data-selected="${collection && collection.icon === icon ? 'true' : 'false'}"
                            style="
                                width: 40px;
                                height: 40px;
                                padding: 0;
                                border: 2px solid ${collection && collection.icon === icon ? 'var(--filter-include-border)' : 'var(--theme-border)'};
                                background: ${collection && collection.icon === icon ? 'var(--filter-include-bg)' : 'transparent'};
                                border-radius: 8px;
                                cursor: pointer;
                                transition: all 0.2s;
                                overflow: hidden;
                                position: relative;
                            ">
                        <img src="${icon}" style="width: 100%; height: 100%; object-fit: cover;">
                    </button>
                `).join('');
            }

            // Render default emoji icons
            html += defaultIcons.map(icon => `
                <button type="button" class="icon-select-btn emoji-icon-btn" 
                        data-icon="${this.escapeHtml(icon)}" 
                        data-selected="${collection && collection.icon === icon ? 'true' : 'false'}"
                        style="
                            width: 40px;
                            height: 40px;
                            padding: 4px;
                            border: 2px solid ${collection && collection.icon === icon ? 'var(--filter-include-border)' : 'var(--theme-border)'};
                            background: ${collection && collection.icon === icon ? 'var(--filter-include-bg)' : 'transparent'};
                            border-radius: 8px;
                            cursor: pointer;
                            transition: all 0.2s;
                            color: var(--text-primary);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        ">${icon}</button>
            `).join('');

            iconsGrid.innerHTML = html;

            // Add event listeners
            const iconButtons = iconsGrid.querySelectorAll('.icon-select-btn');
            iconButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    // Clear custom icon preview/input if it was active
                    customIconData = null;
                    customIconPreview.style.display = 'none';
                    customIconInput.value = '';
                    
                    // Update selection UI
                    iconButtons.forEach(b => {
                        b.style.borderColor = 'var(--theme-border)';
                        b.style.background = 'transparent';
                        b.dataset.selected = 'false';
                    });
                    
                    btn.style.borderColor = 'var(--filter-include-border)';
                    btn.style.background = 'var(--filter-include-bg)';
                    btn.dataset.selected = 'true';
                    
                    selectedIcon = btn.dataset.icon;
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
                alert('Collection name is required');
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
                alert(error.message || 'Failed to save collection');
            }
        });
    }

    setFilter(filter) {
        this.statusFilter = filter;
        
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
            this.collectionService.getCollection(collectionId).then(col => {
                if (this.elements.pageTitle) {
                    this.elements.pageTitle.textContent = col ? col.name : 'Collection';
                }
            });
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

        this.applyFilters();
    }

    async applyFilters() {
        let filtered = [];

        // 1. Status/Collection Filter
        if (this.statusFilter.startsWith('collection:')) {
            const collectionId = this.statusFilter.split(':')[1];
            if (this.collectionService) {
                try {
                    const movieIds = await this.collectionService.getMoviesInCollection(collectionId);
                    
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
                    if (missingIds.length > 0 && this.movieCacheService) {
                        try {
                            const cachedMoviesMap = await this.movieCacheService.getBatchCachedMovies(missingIds);
                            
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

        this.renderGrid(filtered);
    }

    async renderGrid(movies) {
        const grid = this.elements.moviesGrid;
        
        // Fetch all progress data
        let allProgress = {};
        if (this.progressService) {
            allProgress = await this.progressService.getAllProgress();
        }

        grid.innerHTML = '';

        if (movies.length === 0) {
            this.elements.emptyState.style.display = 'flex';
            this.elements.moviesGrid.style.display = 'none';
            return;
        }

        this.elements.emptyState.style.display = 'none';
        this.elements.moviesGrid.style.display = 'grid';
        this.elements.moviesGrid.classList.add('anime-grid'); // Enable anime-style grid spacing

        movies.forEach(movieData => {
            // Prepare movie object for card with normalized fields
            const rawName = movieData.name || movieData.movieTitle || 'Unknown Movie';
            const cleanName = Utils.cleanTitle(rawName);
            
            const movieObj = {
                kinopoiskId: movieData.movieId || movieData.kinopoiskId,
                name: cleanName,
                originalName: movieData.originalName || movieData.movieTitleOriginal,
                year: movieData.year || movieData.releaseYear,
                posterUrl: movieData.posterUrl || movieData.posterPath,
                kpRating: movieData.kpRating || movieData.rating || 0,
                imdbRating: movieData.imdbRating || 0,
                genres: movieData.genres || [],
                description: movieData.description
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
                animeStyle: true, // Enable anime-style card design
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

            grid.appendChild(card);
            
            // Make the entire card clickable
            card.style.cursor = 'pointer';
            card.setAttribute('data-action', 'view-details');
            card.setAttribute('data-movie-id', cardData.movieId);
        });
        
        // Attach delegation for dynamic card events if needed
        // Assuming MovieCard handles its own menu events which bubble up or are handled globally
        // Usually we need to handle specific actions here if MovieCard doesn't do it all
    }



    // Local showLoading/hideLoading removed in favor of this.page (PageStateManager)

    toggleCollectionMenuDropdown() {
        // Remove existing dropdown
        const existingDropdown = document.querySelector('.collection-dropdown');
        if (existingDropdown) {
            existingDropdown.remove();
            return;
        }

        // Create dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'collection-dropdown show';
        dropdown.innerHTML = `
            <button class="dropdown-item" data-action="edit-collection">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                Edit Collection
            </button>
            <button class="dropdown-item delete" data-action="delete-collection">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                Delete Collection
            </button>
        `;

        // Position dropdown
        const menuBtn = this.elements.collectionMenuBtn;
        menuBtn.style.position = 'relative';
        menuBtn.appendChild(dropdown);

        // Add event listeners
        dropdown.querySelector('[data-action="edit-collection"]').addEventListener('click', (e) => {
            e.stopPropagation();
            this.editActiveCollection();
            dropdown.remove();
        });

        dropdown.querySelector('[data-action="delete-collection"]').addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteActiveCollection();
            dropdown.remove();
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

        const confirmed = confirm(`Are you sure you want to delete "${collection.name}"? This action cannot be undone.`);
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
            alert('Failed to delete collection: ' + error.message);
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
