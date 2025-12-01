/**
 * PopupManager - Main controller for the Movie Rating Extension popup
 * Handles authentication, search, and rating feed display
 */
class PopupManager {
    constructor() {
        console.log('🎨 PopupManager: Initializing...');
        
        // Initialize theme first
        this.initializeTheme();
        
        this.elements = this.initializeElements();
        this.ratings = [];
        this.searchTimeout = null;
        this.ratingsLoaded = false;
        this.isLoadingRatings = false; // Add flag to prevent multiple simultaneous loads
        this.setupEventListeners();
        this.setupAuthStateListener();
        this.initializeUI();
        
        // Trigger update check when popup opens
        chrome.runtime.sendMessage({ type: 'CHECK_FOR_UPDATES' });
    }

    initializeTheme() {
        console.log('🎨 PopupManager: Initializing theme...');
        
        // Get current theme from localStorage (same as Navigation.js)
        const theme = localStorage.getItem('movieExtensionTheme') || 'dark';
        console.log('🎨 PopupManager: Retrieved theme from localStorage:', theme);
        
        this.applyTheme(theme);
        
        // Listen for storage events (when theme changes in other windows/tabs)
        window.addEventListener('storage', (e) => {
            if (e.key === 'movieExtensionTheme' && e.newValue) {
                console.log('🎨 PopupManager: Theme changed via storage event:', e.newValue);
                this.applyTheme(e.newValue);
            }
        });
        
        // Also check periodically for theme changes (since storage events don't work in popups)
        setInterval(() => {
            const currentTheme = localStorage.getItem('movieExtensionTheme') || 'dark';
            const bodyHasLight = document.body.classList.contains('light-theme');
            const shouldBeLight = currentTheme === 'light';
            
            if (bodyHasLight !== shouldBeLight) {
                console.log('🎨 PopupManager: Theme mismatch detected, applying:', currentTheme);
                this.applyTheme(currentTheme);
            }
        }, 500); // Check every 500ms
    }

    applyTheme(theme) {
        console.log('🎨 PopupManager: Applying theme:', theme);
        
        if (theme === 'light') {
            console.log('🎨 PopupManager: Adding light-theme class to body');
            document.body.classList.add('light-theme');
            document.body.classList.remove('dark-theme');
        } else {
            console.log('🎨 PopupManager: Adding dark-theme class to body');
            document.body.classList.add('dark-theme');
            document.body.classList.remove('light-theme');
        }
        
        console.log('🎨 PopupManager: Body classes after theme application:', document.body.className);
    }

    initializeElements() {
        return {
            // Auth elements
            initialLoading: document.getElementById('initialLoading'),
            authSection: document.getElementById('authSection'),
            mainContent: document.getElementById('mainContent'),
            authStatus: document.getElementById('authStatus'),
            statusIndicator: document.getElementById('statusIndicator'),
            statusText: document.getElementById('statusText'),
            loginBtn: document.getElementById('loginBtn'),
            logoutBtn: document.getElementById('logoutBtn'),
            loginForm: document.getElementById('loginForm'),
            registerForm: document.getElementById('registerForm'),
            loginEmail: document.getElementById('loginEmail'),
            loginPassword: document.getElementById('loginPassword'),
            registerEmail: document.getElementById('registerEmail'),
            registerPassword: document.getElementById('registerPassword'),
            
            // User elements
            userAvatar: document.getElementById('userAvatar'),
            userName: document.getElementById('userName'),
            settingsBtn: document.getElementById('settingsBtn'),
            
            // Search elements
            searchInput: document.getElementById('searchInput'),
            searchResults: document.getElementById('searchResults'),
            searchIconBtn: document.getElementById('searchIconBtn'),
            
            // Feed elements
            feedContent: document.getElementById('feedContent'),
            refreshBtn: document.getElementById('refreshBtn'),
            viewAllRatingsBtn: document.getElementById('viewAllRatingsBtn'),
            loading: document.getElementById('loading'),
            errorMessage: document.getElementById('errorMessage')
        };
    }

    setupEventListeners() {
        // Auth events
        this.elements.loginBtn.addEventListener('click', () => this.handleGoogleLogin());
        this.elements.logoutBtn.addEventListener('click', () => this.handleLogout());
        this.elements.loginForm.addEventListener('submit', (e) => this.handleEmailLogin(e));
        this.elements.registerForm.addEventListener('submit', (e) => this.handleEmailRegister(e));
        
        // Tab switching
        this.setupTabSwitching();
        
        // Search events
        this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e));
        this.elements.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.openSearchPage();
            }
        });
        this.elements.searchInput.addEventListener('blur', () => {
            // Delay hiding to allow click events on results
            setTimeout(() => this.hideSearchResults(), 150);
        });
        this.elements.searchIconBtn.addEventListener('click', () => this.openSearchPage());
        
        // Feed events
        this.elements.refreshBtn.addEventListener('click', () => this.forceRefreshRatings());
        this.elements.viewAllRatingsBtn.addEventListener('click', () => this.openRatingsPage());
        this.elements.settingsBtn.addEventListener('click', () => this.openSettings());
    }

    setupTabSwitching() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.tab;
                
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                
                btn.classList.add('active');
                document.getElementById(targetTab + 'Tab').classList.add('active');
            });
        });
    }

    setupAuthStateListener() {
        window.addEventListener('authStateChanged', (event) => {
            const { user, isAuthenticated } = event.detail;
            // If authenticated, don't show content until ratings are loaded
            // If not authenticated, show auth section immediately
            this.updateAuthUI(isAuthenticated, user, !isAuthenticated);
            
            // Auto-load ratings when user signs in (only if not already loaded or loading)
            if (isAuthenticated && user && !this.ratingsLoaded && !this.isLoadingRatings) {
                console.log('PopupManager: Auth state changed, loading ratings');
                this.loadRatings();
            }
        });
        
        // Listen for profile updates to refresh ratings
        window.addEventListener('profileUpdated', () => {
            console.log('PopupManager: Profile updated, refreshing ratings');
            this.forceRefreshRatings();
        });
    }

    async initializeUI() {
        // Check for updates first
        this.checkPendingUpdate();

        // Check auth state immediately first
        let currentUser = firebaseManager.getCurrentUser();
        // ... (rest of the function)
    }

    checkPendingUpdate() {
        chrome.storage.local.get(['pendingUpdateUrl', 'pendingUpdateVersion', 'updateAvailable'], (result) => {
            if (result.updateAvailable && result.pendingUpdateUrl && result.pendingUpdateVersion) {
                // Verify that the pending update is actually newer than current version
                const manifest = chrome.runtime.getManifest();
                if (this.compareVersions(result.pendingUpdateVersion, manifest.version) > 0) {
                    this.showUpdateBanner(result.pendingUpdateVersion, result.pendingUpdateUrl);
                } else {
                    // Stale update info, clear it
                    console.log('PopupManager: Clearing stale update info', result.pendingUpdateVersion);
                    chrome.storage.local.remove(['pendingUpdateUrl', 'pendingUpdateVersion', 'updateAvailable']);
                }
            }
        });

        // Listen for real-time update messages from background
        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === 'UPDATE_AVAILABLE') {
                const manifest = chrome.runtime.getManifest();
                if (this.compareVersions(message.version, manifest.version) > 0) {
                    this.showUpdateBanner(message.version, message.url);
                }
            }
        });
    }

    showUpdateBanner(version, url) {
        const banner = document.getElementById('updateBanner');
        const versionEl = document.getElementById('updateVersion');
        const updateBtn = document.getElementById('updateBtn');
        const dismissBtn = document.getElementById('dismissUpdateBtn');

        if (banner && versionEl) {
            versionEl.textContent = `Version ${version} is ready`;
            banner.style.display = 'flex';

            // Update button handler
            updateBtn.onclick = () => {
                updateBtn.textContent = 'Downloading...';
                updateBtn.disabled = true;
                
                chrome.runtime.sendMessage({ type: 'DOWNLOAD_UPDATE', url: url }, (response) => {
                    if (response && response.success) {
                        // Banner will stay until download completes and instructions open
                        // But we can update text to show progress
                        updateBtn.textContent = 'Opening...';
                    } else {
                        updateBtn.textContent = 'Error';
                        updateBtn.disabled = false;
                        console.error('Update download failed:', response?.error);
                    }
                });
            };

            // Dismiss button handler
            dismissBtn.onclick = () => {
                banner.style.display = 'none';
                // Optional: Mark as dismissed for this session? 
                // For now just hide it. It will reappear next time popup opens if still pending.
            };
        }
    }

    // ... (rest of the class methods)
    // ... (rest of the class methods)

    waitForAuthInit() {
        return new Promise((resolve) => {
            // Check if already authenticated
            const user = firebaseManager.getCurrentUser();
            if (user) {
                resolve();
                return;
            }
            
            // Wait for authStateChanged event with shorter timeout
            const handler = () => {
                window.removeEventListener('authStateChanged', handler);
                resolve();
            };
            window.addEventListener('authStateChanged', handler);
            
            // Shorter fallback timeout for better UX
            setTimeout(resolve, 300);
        });
    }

    updateAuthUI(isAuthenticated, user, showContent = true) {
        if (isAuthenticated) {
            this.elements.authSection.style.display = 'none';
            this.elements.statusIndicator.classList.add('authenticated');
            this.elements.statusText.textContent = `Signed in as ${user?.displayName || user?.email || 'User'}`;
            
            // Update user info
            this.elements.userName.textContent = user?.displayName || user?.email || 'User';
            if (user?.photoURL) {
                this.elements.userAvatar.src = user.photoURL;
                this.elements.userAvatar.style.display = 'block';
            }
            
            // Only show main content if explicitly requested
            if (showContent) {
                this.elements.initialLoading.style.display = 'none';
                this.elements.mainContent.style.display = 'flex';
            }
        } else {
            this.elements.initialLoading.style.display = 'none';
            this.elements.authSection.style.display = 'block';
            this.elements.mainContent.style.display = 'none';
            this.elements.statusIndicator.classList.remove('authenticated');
            this.elements.statusText.textContent = 'Not authenticated';
        }
    }

    async handleGoogleLogin() {
        try {
            this.hideError();
            await firebaseManager.signInWithGoogle();
            
            // Create/update user profile
            const user = firebaseManager.getCurrentUser();
            const userService = firebaseManager.getUserService();
            await userService.createOrUpdateUserProfile(user.uid, {
                displayName: user.displayName,
                photoURL: user.photoURL,
                email: user.email,
                createdAt: user.metadata.creationTime
            });
            
            // Hide auth section, show initial loading, prepare for content
            this.elements.authSection.style.display = 'none';
            this.elements.initialLoading.style.display = 'flex';
            this.updateAuthUI(true, user, false);
            
            this.loadRatings();
        } catch (error) {
            this.showError(`Google login failed: ${error.message}`);
        }
    }

    async handleEmailLogin(e) {
        e.preventDefault();
        
        const email = this.elements.loginEmail.value.trim();
        const password = this.elements.loginPassword.value;

        if (!email || !password) {
            this.showError('Please fill in all fields');
            return;
        }

        try {
            this.hideError();
            await firebaseManager.signInWithEmail(email, password);
            
            // Create/update user profile
            const user = firebaseManager.getCurrentUser();
            const userService = firebaseManager.getUserService();
            await userService.createOrUpdateUserProfile(user.uid, {
                displayName: user.displayName || user.email.split('@')[0],
                photoURL: user.photoURL,
                email: user.email,
                createdAt: user.metadata.creationTime
            });
            
            this.elements.loginForm.reset();
            
            // Hide auth section, show initial loading, prepare for content
            this.elements.authSection.style.display = 'none';
            this.elements.initialLoading.style.display = 'flex';
            this.updateAuthUI(true, user, false);
            
            this.loadRatings();
        } catch (error) {
            this.showError(`Email login failed: ${error.message}`);
        }
    }

    async handleEmailRegister(e) {
        e.preventDefault();
        
        const email = this.elements.registerEmail.value.trim();
        const password = this.elements.registerPassword.value;

        if (!email || !password) {
            this.showError('Please fill in all fields');
            return;
        }

        if (password.length < 6) {
            this.showError('Password must be at least 6 characters long');
            return;
        }

        try {
            this.hideError();
            await firebaseManager.createUserWithEmail(email, password);
            
            // Create user profile
            const user = firebaseManager.getCurrentUser();
            const userService = firebaseManager.getUserService();
            await userService.createOrUpdateUserProfile(user.uid, {
                displayName: user.displayName || user.email.split('@')[0],
                photoURL: user.photoURL,
                email: user.email,
                createdAt: user.metadata.creationTime
            });
            
            this.elements.registerForm.reset();
            
            // Hide auth section, show initial loading, prepare for content
            this.elements.authSection.style.display = 'none';
            this.elements.initialLoading.style.display = 'flex';
            this.updateAuthUI(true, user, false);
            
            this.loadRatings();
        } catch (error) {
            this.showError(`Registration failed: ${error.message}`);
        }
    }

    async handleLogout() {
        try {
            this.showLoading(true);
            this.hideError();
            
            // Clear ratings cache on logout
            const ratingsCacheService = firebaseManager.getRatingsCacheService();
            await ratingsCacheService.clearCache();
            
            await firebaseManager.signOut();
            this.ratings = [];
            this.ratingsLoaded = false;
            this.isLoadingRatings = false; // Reset loading flag
            this.renderRatings();
        } catch (error) {
            this.showError(`Logout failed: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async handleSearch(e) {
        const query = e.target.value.trim();
        
        if (query.length < 2) {
            this.hideSearchResults();
            return;
        }

        // Debounce search
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(async () => {
            await this.performSearch(query);
        }, 300);
    }

    async performSearch(query) {
        try {
            const movieCacheService = firebaseManager.getMovieCacheService();
            const movies = await movieCacheService.searchCachedMovies(query, 5);
            
            this.displaySearchResults(movies);
        } catch (error) {
            console.error('Search error:', error);
            this.hideSearchResults();
        }
    }

    displaySearchResults(movies) {
        if (movies.length === 0) {
            this.hideSearchResults();
            return;
        }

        const query = this.elements.searchInput.value.toLowerCase().trim();
        
        const resultsHTML = movies.map(movie => {
            const name = movie.name;
            const nameLower = name.toLowerCase();
            let relevanceClass = '';
            
            // Determine relevance level for styling
            if (nameLower === query) {
                relevanceClass = 'exact-match';
            } else if (nameLower.startsWith(query)) {
                relevanceClass = 'starts-with';
            } else if (nameLower.includes(query)) {
                relevanceClass = 'contains';
            }
            
            return `
                <div class="search-result-item ${relevanceClass}" data-movie-id="${movie.kinopoiskId}">
                    <img src="${movie.posterUrl || '/icons/icon48.png'}" alt="${name}" class="search-result-poster">
                    <div class="search-result-info">
                        <h4 class="search-result-title">${this.escapeHtml(name)}</h4>
                        <p class="search-result-meta">${movie.year} • ${movie.genres.slice(0, 2).join(', ')}</p>
                        ${movie.votes?.kp ? `<span class="search-result-votes">${movie.votes.kp} оценок</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        this.elements.searchResults.innerHTML = resultsHTML;
        this.elements.searchResults.style.display = 'block';

        // Add click handlers
        this.elements.searchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const movieId = item.dataset.movieId;
                this.openMovieDetails(movieId);
            });
        });
    }

    hideSearchResults() {
        this.elements.searchResults.style.display = 'none';
    }

    openSearchPage() {
        const query = this.elements.searchInput.value.trim();
        
        if (query) {
            const encodedQuery = encodeURIComponent(query);
            const url = chrome.runtime.getURL(`src/pages/search/search.html?query=${encodedQuery}`);
            chrome.tabs.create({ url: url });
        } else {
            chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/search/search.html') });
        }
    }

    openMovieDetails(movieId) {
        // For now, open in advanced search page with movie ID
        chrome.tabs.create({ 
            url: chrome.runtime.getURL(`src/pages/search/search.html?movieId=${movieId}`) 
        });
    }

    openRatingsPage() {
        chrome.tabs.create({ 
            url: chrome.runtime.getURL('src/pages/ratings/ratings.html') 
        });
    }

    openUserProfile(userId) {
        chrome.tabs.create({ 
            url: chrome.runtime.getURL(`src/pages/profile/profile.html?userId=${userId}`) 
        });
    }

    openSettings() {
        this.showError('Settings feature coming soon!');
    }

    async loadRatings() {
        // Prevent multiple simultaneous calls
        if (this.isLoadingRatings) {
            console.log('PopupManager: loadRatings already in progress, skipping');
            return;
        }

        try {
            this.isLoadingRatings = true;
            const startTime = performance.now();
            console.log('⏱️ PopupManager: Starting loadRatings()');
            
            // Hide main content and show initial loading
            this.elements.mainContent.style.display = 'none';
            this.elements.initialLoading.style.display = 'flex';
            this.hideError();
            
            // Update auth UI without showing content
            const currentUser = firebaseManager.getCurrentUser();
            this.updateAuthUI(true, currentUser, false);
            
            // Check if chrome.storage is available
            if (!chrome || !chrome.storage || !chrome.storage.local) {
                console.error('PopupManager: chrome.storage.local is not available');
                throw new Error('Storage not available');
            }
            
            const ratingsCacheService = firebaseManager.getRatingsCacheService();
            console.log('PopupManager: Got RatingsCacheService instance');
            
            const cacheStartTime = performance.now();
            console.log(`⏱️ [PopupManager] Starting getCachedRatingsWithBackgroundRefresh`);
            const result = await ratingsCacheService.getCachedRatingsWithBackgroundRefresh(50);
            const cacheEndTime = performance.now();
            const cacheLoadTime = Math.round(cacheEndTime - cacheStartTime);
            
            console.log(`✅ [PopupManager] Got result from cache service in ${cacheLoadTime}ms:`, { 
                ratingsCount: result.ratings.length, 
                isFromCache: result.isFromCache,
                loadTime: `${cacheLoadTime}ms`
            });
            
            this.ratings = result.ratings;
            
            // Render ratings (both cached and fresh data)
            const renderStartTime = performance.now();
            await this.renderRatings();
            const renderEndTime = performance.now();
            const renderTime = Math.round(renderEndTime - renderStartTime);
            
            this.ratingsLoaded = true;
            
            // Show main content after all ratings are rendered
            this.showMainContent();
            
            // Show feed content with fade in for smooth appearance
            if (this.elements.feedContent.style.display !== 'none') {
                this.elements.feedContent.classList.add('fade-in');
            }
            
            // Background refresh is automatically started in getCachedRatingsWithBackgroundRefresh()
            // if data was loaded from cache, ensuring fresh data for next time
            
            const totalTime = Math.round(performance.now() - startTime);
            
            // Show cache status in console
            if (result.isFromCache) {
                const cacheStats = await ratingsCacheService.getCacheStats();
                console.log(`🎯 Cached ratings displayed in ${totalTime}ms total (cache: ${cacheLoadTime}ms, render: ${renderTime}ms):`, {
                    count: this.ratings.length,
                    cacheAge: `${cacheStats.age} minutes`,
                    cacheValid: cacheStats.isValid,
                    performance: {
                        cacheLoad: `${cacheLoadTime}ms`,
                        render: `${renderTime}ms`,
                        total: `${totalTime}ms`
                    }
                });
            } else {
                console.log(`🌐 Fresh ratings displayed in ${totalTime}ms total (fetch: ${cacheLoadTime}ms, render: ${renderTime}ms):`, {
                    count: this.ratings.length,
                    performance: {
                        fetch: `${cacheLoadTime}ms`,
                        render: `${renderTime}ms`,
                        total: `${totalTime}ms`
                    }
                });
            }
        } catch (error) {
            // Show main content even on error
            this.showMainContent();
            this.showError(`Failed to load ratings: ${error.message}`);
        } finally {
            this.isLoadingRatings = false; // Reset flag
        }
    }

    async forceRefreshRatings() {
        // Prevent multiple simultaneous calls
        if (this.isLoadingRatings) {
            console.log('PopupManager: Ratings loading already in progress, skipping refresh');
            return;
        }

        try {
            this.isLoadingRatings = true;
            const startTime = performance.now();
            this.hideError();
            
            console.log('🔄 PopupManager: Force refreshing ratings...');
            
            // Hide feed content with fade out
            await this.hideFeedContentWithFade();
            
            // Show loader with fade in
            await this.showLoadingWithFade();
            
            // Clear cache and fetch fresh data
            const ratingsCacheService = firebaseManager.getRatingsCacheService();
            await ratingsCacheService.clearCache();
            
            const fetchStartTime = performance.now();
            const ratings = await ratingsCacheService.fetchAndCacheRatings(50);
            const fetchEndTime = performance.now();
            const fetchTime = Math.round(fetchEndTime - fetchStartTime);
            
            this.ratings = ratings;
            
            const renderStartTime = performance.now();
            await this.renderRatings();
            const renderEndTime = performance.now();
            const renderTime = Math.round(renderEndTime - renderStartTime);
            
            this.ratingsLoaded = true;
            
            // Hide loader with fade out
            await this.hideLoadingWithFade();
            
            // Show updated feed content with fade in
            await this.showFeedContentWithFade();
            
            const totalTime = Math.round(performance.now() - startTime);
            
            console.log(`🔄 Ratings force refreshed in ${totalTime}ms total (fetch: ${fetchTime}ms, render: ${renderTime}ms):`, {
                count: this.ratings.length,
                performance: {
                    fetch: `${fetchTime}ms`,
                    render: `${renderTime}ms`,
                    total: `${totalTime}ms`
                }
            });
        } catch (error) {
            // On error, hide loader and show content
            await this.hideLoadingWithFade();
            await this.showFeedContentWithFade();
            this.showError(`Failed to refresh ratings: ${error.message}`);
        } finally {
            this.isLoadingRatings = false; // Reset flag
        }
    }

    async renderRatings() {
        const startTime = performance.now();
        console.log('⏱️ [PopupManager] Starting renderRatings');
        
        const clearStart = performance.now();
        this.elements.feedContent.innerHTML = '';
        const clearTime = Math.round(performance.now() - clearStart);
        console.log(`⏱️ [PopupManager] Clear feedContent: ${clearTime}ms`);

        if (this.ratings.length === 0) {
            const emptyStateStart = performance.now();
            this.elements.feedContent.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🎬</div>
                    <h3 class="empty-state-title">No ratings yet</h3>
                    <p class="empty-state-text">Start rating movies to see them here!</p>
                </div>
            `;
            const emptyStateTime = Math.round(performance.now() - emptyStateStart);
            console.log(`⏱️ [PopupManager] Render empty state: ${emptyStateTime}ms`);
            return;
        }

        console.log(`⏱️ [PopupManager] Rendering ${this.ratings.length} ratings`);
        
        // Pre-load all average ratings in batch to avoid multiple Firebase calls
        const averageRatingsStartTime = performance.now();
        const averageRatingsMap = await this.preloadAverageRatings();
        const averageRatingsTime = Math.round(performance.now() - averageRatingsStartTime);
        console.log(`⏱️ [PopupManager] Pre-loaded average ratings: ${averageRatingsTime}ms`);
        
        // Pre-load current user profile once to avoid multiple calls
        const currentUserProfileStart = performance.now();
        let currentUserProfile = null;
        const currentUser = firebaseManager.getCurrentUser();
        if (currentUser) {
            try {
                const userService = firebaseManager.getUserService();
                currentUserProfile = await userService.getUserProfile(currentUser.uid);
                const currentUserProfileTime = Math.round(performance.now() - currentUserProfileStart);
                console.log(`⏱️ [PopupManager] Pre-loaded current user profile: ${currentUserProfileTime}ms`);
            } catch (error) {
                const currentUserProfileTime = Math.round(performance.now() - currentUserProfileStart);
                console.error(`❌ [PopupManager] Error loading current user profile (${currentUserProfileTime}ms):`, error);
            }
        }
        
        // Process ratings synchronously now that we have all data
        const renderStart = performance.now();
        let renderedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < this.ratings.length; i++) {
            const rating = this.ratings[i];
            const elementStart = performance.now();
            try {
                // Check if element already exists to prevent duplicates
                const existingElement = document.getElementById(`rating-${rating.id}`);
                if (existingElement) {
                    console.warn(`⏱️ [PopupManager] Skipping duplicate rating element: rating-${rating.id}`);
                    skippedCount++;
                    continue;
                }
                
                const ratingElement = await this.createRatingElementSync(rating, averageRatingsMap, currentUserProfile);
                this.elements.feedContent.appendChild(ratingElement);
                renderedCount++;
                
                const elementTime = Math.round(performance.now() - elementStart);
                if (elementTime > 50) {
                    console.log(`⏱️ [PopupManager] Rating ${i+1}/${this.ratings.length} rendered in ${elementTime}ms (slow)`);
                }
            } catch (error) {
                errorCount++;
                const elementTime = Math.round(performance.now() - elementStart);
                console.error(`❌ [PopupManager] Error creating rating element ${i+1} (${elementTime}ms):`, error);
                // Continue with other ratings even if one fails
            }
        }
        
        const renderTime = Math.round(performance.now() - renderStart);
        const totalTime = Math.round(performance.now() - startTime);
        console.log(`✅ [PopupManager] Finished rendering ratings in ${totalTime}ms (render: ${renderTime}ms, avg ratings: ${averageRatingsTime}ms, rendered: ${renderedCount}, skipped: ${skippedCount}, errors: ${errorCount})`);
    }

    async preloadAverageRatings() {
        const startTime = performance.now();
        const movieIds = [...new Set(this.ratings.map(r => r.movie?.kinopoiskId || r.movieId))];
        const averageRatingsMap = new Map();
        
        console.log(`⏱️ [PopupManager] preloadAverageRatings: ${movieIds.length} unique movies`);
        
        try {
            // First, try to get cached average ratings
            const cacheReadStart = performance.now();
            const ratingsCacheService = firebaseManager.getRatingsCacheService();
            const cachedAverageRatings = await ratingsCacheService.getCachedAverageRatings();
            const cacheReadTime = Math.round(performance.now() - cacheReadStart);
            console.log(`⏱️ [PopupManager] Read cached average ratings: ${cacheReadTime}ms`);
            
            if (cachedAverageRatings) {
                const mapStart = performance.now();
                // Use cached data for movies that are in cache
                let cachedCount = 0;
                movieIds.forEach(movieId => {
                    if (cachedAverageRatings.has(movieId)) {
                        averageRatingsMap.set(movieId, cachedAverageRatings.get(movieId));
                        cachedCount++;
                    }
                });
                const mapTime = Math.round(performance.now() - mapStart);
                console.log(`⏱️ [PopupManager] Mapped cached ratings: ${mapTime}ms (${cachedCount}/${movieIds.length} from cache)`);
            }
            
            // Find movies that are not in cache
            const missingMovieIds = movieIds.filter(movieId => !averageRatingsMap.has(movieId));
            
            if (missingMovieIds.length > 0) {
                console.log(`⏱️ [PopupManager] Loading average ratings for ${missingMovieIds.length} movies not in cache using batch query`);
                const ratingService = firebaseManager.getRatingService();
                
                // Load missing average ratings using batch query (one request instead of multiple)
                const fetchStart = performance.now();
                try {
                    const batchResults = await ratingService.getBatchMovieAverageRatings(missingMovieIds);
                    const fetchTime = Math.round(performance.now() - fetchStart);
                    console.log(`⏱️ [PopupManager] Fetched ${missingMovieIds.length} average ratings via batch: ${fetchTime}ms`);
                    
                    // Add new data to map
                    const addStart = performance.now();
                    Object.entries(batchResults).forEach(([movieId, averageData]) => {
                        const movieIdNum = parseInt(movieId);
                        averageRatingsMap.set(movieIdNum, averageData);
                    });
                    const addTime = Math.round(performance.now() - addStart);
                    console.log(`⏱️ [PopupManager] Added to map: ${addTime}ms`);
                    
                    // Cache the newly loaded average ratings
                    const cacheWriteStart = performance.now();
                    const newAverageRatingsMap = new Map();
                    Object.entries(batchResults).forEach(([movieId, averageData]) => {
                        const movieIdNum = parseInt(movieId);
                        newAverageRatingsMap.set(movieIdNum, averageData);
                    });
                    
                    // Merge with cached data and update cache
                    if (cachedAverageRatings) {
                        cachedAverageRatings.forEach((value, key) => {
                            newAverageRatingsMap.set(key, value);
                        });
                    }
                    await ratingsCacheService.cacheAverageRatings(newAverageRatingsMap);
                    const cacheWriteTime = Math.round(performance.now() - cacheWriteStart);
                    console.log(`⏱️ [PopupManager] Cached average ratings: ${cacheWriteTime}ms`);
                } catch (error) {
                    const fetchTime = Math.round(performance.now() - fetchStart);
                    console.error(`❌ [PopupManager] Error fetching batch average ratings (${fetchTime}ms):`, error);
                    // Fallback to individual requests if batch fails
                    console.log(`⏱️ [PopupManager] Fallback to individual requests`);
                    const fallbackStart = performance.now();
                    const promises = missingMovieIds.map(async (movieId) => {
                        try {
                            const averageData = await ratingService.getMovieAverageRating(movieId);
                            return { movieId, averageData };
                        } catch (error) {
                            console.warn(`❌ [PopupManager] Failed to get average rating for movie ${movieId}:`, error);
                            return { movieId, averageData: { average: 0, count: 0 } };
                        }
                    });
                    const results = await Promise.all(promises);
                    results.forEach(({ movieId, averageData }) => {
                        averageRatingsMap.set(movieId, averageData);
                    });
                    const fallbackTime = Math.round(performance.now() - fallbackStart);
                    console.log(`⏱️ [PopupManager] Fallback completed: ${fallbackTime}ms`);
                }
            } else {
                console.log(`✅ [PopupManager] All average ratings loaded from cache`);
            }
            
        } catch (error) {
            const totalTime = Math.round(performance.now() - startTime);
            console.error(`❌ [PopupManager] Error preloading average ratings (${totalTime}ms):`, error);
            // Fallback: try to load all ratings if cache fails
            try {
                console.log(`⏱️ [PopupManager] Fallback: loading all average ratings using batch`);
                const fallbackStart = performance.now();
                const ratingService = firebaseManager.getRatingService();
                const batchResults = await ratingService.getBatchMovieAverageRatings(movieIds);
                Object.entries(batchResults).forEach(([movieId, averageData]) => {
                    const movieIdNum = parseInt(movieId);
                    averageRatingsMap.set(movieIdNum, averageData);
                });
                const fallbackTime = Math.round(performance.now() - fallbackStart);
                console.log(`⏱️ [PopupManager] Fallback completed: ${fallbackTime}ms`);
            } catch (fallbackError) {
                const fallbackTime = Math.round(performance.now() - startTime);
                console.error(`❌ [PopupManager] Error in fallback average ratings loading (${fallbackTime}ms):`, fallbackError);
            }
        }
        
        const totalTime = Math.round(performance.now() - startTime);
        console.log(`✅ [PopupManager] preloadAverageRatings completed in ${totalTime}ms (${averageRatingsMap.size} ratings)`);
        return averageRatingsMap;
    }

    async createRatingElementSync(rating, averageRatingsMap, currentUserProfile = null) {
        const ratingDiv = document.createElement('div');
        ratingDiv.className = 'rating-item clickable-rating';
        
        const movie = rating.movie;
        const movieId = movie?.kinopoiskId || rating.movieId;
        
        // Add unique ID to prevent duplicates
        ratingDiv.id = `rating-${rating.id}`;
        
        // Add movie ID as data attribute for navigation
        ratingDiv.dataset.movieId = movieId;
        const posterUrl = movie?.posterUrl || '/icons/icon48.png';
        const movieTitle = movie?.name || 'Unknown Movie';
        const movieYear = movie?.year || '';
        const movieGenres = movie?.genres?.slice(0, 2).join(', ') || '';
        const timestamp = firebaseManager.formatTimestamp(rating.createdAt);

        // Get pre-loaded average rating
        const averageData = averageRatingsMap.get(movieId) || { average: 0, count: 0 };
        const averageDisplay = averageData.count > 0 
            ? `${averageData.average.toFixed(1)}/10` 
            : 'No ratings';

        // Get current user photo if this is current user's rating and photo is missing/outdated
        let userPhoto = rating.userPhoto || '/icons/icon48.png';
        const currentUser = firebaseManager.getCurrentUser();
        let displayUserName = rating.userName || 'Unknown User';
        
        if (currentUser && rating.userId === currentUser.uid) {
            if (currentUser.photoURL && (!rating.userPhoto || rating.userPhoto !== currentUser.photoURL)) {
                userPhoto = currentUser.photoURL;
            }
            
            // Use pre-loaded current user profile instead of fetching it again
            if (currentUserProfile && typeof Utils !== 'undefined' && Utils.getDisplayName) {
                displayUserName = Utils.getDisplayName(currentUserProfile, currentUser);
            } else if (currentUser.displayName) {
                displayUserName = currentUser.displayName;
            }
        }

        const isCurrentUser = currentUser && rating.userId === currentUser.uid;
        
        ratingDiv.innerHTML = `
            <img src="${posterUrl}" alt="${movieTitle}" class="rating-poster" onerror="this.src='/icons/icon48.png'">
            <div class="rating-content">
                <div class="rating-header">
                    <div class="rating-user-info clickable-user" data-user-id="${rating.userId}">
                        <img src="${userPhoto}" alt="${displayUserName}" class="rating-user-avatar" onerror="this.src='/icons/icon48.png'">
                        <span class="rating-user-name" title="${this.escapeHtml(displayUserName)}">${this.escapeHtml(this.truncateText(displayUserName, 20))}</span>
                    </div>
                    ${isCurrentUser ? `
                        <div class="rating-menu">
                            <button class="rating-menu-btn" data-rating-id="${rating.id}" aria-label="Меню отзыва">
                                <span>⋮</span>
                            </button>
                            <div class="rating-menu-dropdown" id="popup-menu-${rating.id}" style="display: none;">
                                <button class="menu-item edit-item" data-rating-id="${rating.id}" data-action="edit">
                                    <span class="menu-icon">✏️</span>
                                    <span>Редактировать</span>
                                </button>
                                <button class="menu-item delete-item" data-rating-id="${rating.id}" data-action="delete">
                                    <span class="menu-icon">🗑️</span>
                                    <span>Удалить</span>
                                </button>
                            </div>
                        </div>
                    ` : ''}
                </div>
                <h3 class="rating-movie-title" title="${this.escapeHtml(movieTitle)}">${this.escapeHtml(this.truncateText(movieTitle, 50))}</h3>
                <p class="rating-movie-meta">${movieYear} • ${this.truncateText(movieGenres, 30)}</p>
                <div class="rating-scores">
                    <div class="rating-user-score">
                        <span>Your rating:</span>
                        <span class="rating-badge">${rating.rating}/10</span>
                    </div>
                    <div class="rating-average-score">
                        <span>Average:</span>
                        <span class="rating-badge">${averageDisplay}</span>
                    </div>
                </div>
                ${rating.comment ? `<p class="rating-comment" title="${this.escapeHtml(rating.comment)}">${this.escapeHtml(this.truncateText(rating.comment, 100))}</p>` : ''}
                <p class="rating-timestamp">${timestamp}</p>
            </div>
        `;

        // Add click handler to navigate to movie detail page (but not if clicking menu or user info)
        ratingDiv.addEventListener('click', (e) => {
            if (e.target.closest('.rating-menu') || e.target.closest('.rating-user-info')) {
                return;
            }
            if (movieId) {
                chrome.tabs.create({ 
                    url: chrome.runtime.getURL(`src/pages/search/search.html?movieId=${movieId}`) 
                });
            }
        });

        // Setup menu listeners if this is current user's rating
        if (isCurrentUser) {
            this.setupPopupRatingMenu(ratingDiv, rating.id);
        }

        // Add click handler for user info
        const userInfo = ratingDiv.querySelector('.rating-user-info');
        if (userInfo) {
            userInfo.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openUserProfile(rating.userId);
            });
        }

        return ratingDiv;
    }

    setupPopupRatingMenu(ratingDiv, ratingId) {
        const menuBtn = ratingDiv.querySelector('.rating-menu-btn');
        let menu = ratingDiv.querySelector(`#popup-menu-${ratingId}`);
        
        if (!menuBtn || !menu) return;

        // Move menu to body to avoid parent transform and overflow issues
        const menuClone = menu.cloneNode(true);
        menu.remove();
        document.body.appendChild(menuClone);
        menu = menuClone;
        
        // Store reference for cleanup
        if (!this.popupMenus) this.popupMenus = new Map();
        this.popupMenus.set(ratingId, menu);

        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = menu.style.display === 'block';
            
            // Close all other menus
            document.querySelectorAll('.rating-menu-dropdown').forEach(m => {
                m.style.display = 'none';
            });
            
            if (isVisible) {
                menu.style.display = 'none';
            } else {
                // Calculate position
                const btnRect = menuBtn.getBoundingClientRect();
                const menuWidth = 160; // min-width from CSS
                
                menu.style.position = 'fixed';
                menu.style.top = `${btnRect.bottom + 4}px`;
                
                // Position to the left of the button to avoid cutoff
                const leftPos = btnRect.right - menuWidth;
                menu.style.left = `${Math.max(8, leftPos)}px`;
                menu.style.display = 'block';
            }
        });

        const menuItems = menu.querySelectorAll('.menu-item');
        menuItems.forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = item.getAttribute('data-action');
                menu.style.display = 'none';
                
                if (action === 'edit') {
                    await this.editPopupRating(ratingId);
                } else if (action === 'delete') {
                    await this.deletePopupRating(ratingId);
                }
            });
        });

        // Close menu when clicking outside
        if (!this.popupMenuClickHandler) {
            this.popupMenuClickHandler = (e) => {
                if (!e.target.closest('.rating-menu') && !e.target.closest('.rating-menu-dropdown')) {
                    document.querySelectorAll('.rating-menu-dropdown').forEach(m => {
                        m.style.display = 'none';
                    });
                }
            };
            document.addEventListener('click', this.popupMenuClickHandler);
        }

        // Close menu on Escape key
        if (!this.popupMenuEscapeHandler) {
            this.popupMenuEscapeHandler = (e) => {
                if (e.key === 'Escape') {
                    document.querySelectorAll('.rating-menu-dropdown').forEach(m => {
                        m.style.display = 'none';
                    });
                }
            };
            document.addEventListener('keydown', this.popupMenuEscapeHandler);
        }

        // Close menu on scroll
        if (!this.popupMenuScrollHandler) {
            this.popupMenuScrollHandler = () => {
                document.querySelectorAll('.rating-menu-dropdown').forEach(m => {
                    m.style.display = 'none';
                });
            };
            // Listen to scroll on feed-content container
            const feedContent = document.querySelector('.feed-content');
            if (feedContent) {
                feedContent.addEventListener('scroll', this.popupMenuScrollHandler);
            }
            // Also listen to window scroll
            window.addEventListener('scroll', this.popupMenuScrollHandler, true);
        }
    }

    async editPopupRating(ratingId) {
        try {
            const currentUser = firebaseManager.getCurrentUser();
            if (!currentUser) {
                this.showError('Пожалуйста, войдите в систему');
                return;
            }
            
            const ratingDoc = await firebaseManager.db.collection('ratings').doc(ratingId).get();
            if (!ratingDoc.exists) {
                this.showError('Отзыв не найден');
                return;
            }
            
            const ratingData = ratingDoc.data();
            this.showEditRatingModalPopup(ratingId, ratingData);
            
        } catch (error) {
            console.error('Error editing rating:', error);
            this.showError(`Ошибка при редактировании: ${error.message}`);
        }
    }

    showEditRatingModalPopup(ratingId, ratingData) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        modal.innerHTML = `
            <div style="
                background: #0f172a;
                padding: 24px;
                border-radius: 12px;
                max-width: 500px;
                width: 90%;
                color: #e2e8f0;
            ">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px;">
                    <h3 style="margin:0; font-size:20px;">Редактировать отзыв</h3>
                    <button id="closeEditModalPopup" style="background:#334155; color:#e2e8f0; border:none; padding:8px 12px; border-radius:8px; cursor:pointer;">✕</button>
                </div>
                
                <form id="editRatingFormPopup">
                    <div style="margin-bottom:16px;">
                        <label style="display:block; margin-bottom:8px; color:#94a3b8;">Оценка: <span id="editRatingValuePopup">${ratingData.rating}</span>/10</label>
                        <input type="range" id="editRatingSliderPopup" min="1" max="10" value="${ratingData.rating}" style="width:100%;">
                    </div>
                    
                    <div style="margin-bottom:16px;">
                        <label style="display:block; margin-bottom:8px; color:#94a3b8;">Комментарий:</label>
                        <textarea id="editRatingCommentPopup" rows="4" maxlength="500" style="width:100%; padding:10px 12px; border-radius:8px; border:1px solid #334155; background:#0b1220; color:#e2e8f0; resize:vertical;">${this.escapeHtml(ratingData.comment || '')}</textarea>
                        <div style="text-align:right; margin-top:4px; font-size:12px; color:#94a3b8;">
                            <span id="editCommentCountPopup">${(ratingData.comment || '').length}</span>/500
                        </div>
                    </div>
                    
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button type="button" id="cancelEditBtnPopup" style="background:#334155; color:#e2e8f0; border:none; padding:10px 16px; border-radius:8px; cursor:pointer;">Отмена</button>
                        <button type="submit" id="saveEditBtnPopup" style="background:#22c55e; color:#062e0f; border:none; padding:10px 16px; border-radius:8px; cursor:pointer; font-weight:600;">Сохранить</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const slider = modal.querySelector('#editRatingSliderPopup');
        const valueDisplay = modal.querySelector('#editRatingValuePopup');
        const comment = modal.querySelector('#editRatingCommentPopup');
        const commentCount = modal.querySelector('#editCommentCountPopup');
        
        slider.addEventListener('input', (e) => {
            valueDisplay.textContent = e.target.value;
        });
        
        comment.addEventListener('input', (e) => {
            commentCount.textContent = e.target.value.length;
        });
        
        const closeModal = () => modal.remove();
        
        modal.querySelector('#closeEditModalPopup').addEventListener('click', closeModal);
        modal.querySelector('#cancelEditBtnPopup').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        
        modal.querySelector('#editRatingFormPopup').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const newRating = parseInt(slider.value);
            const newComment = comment.value.trim();
            
            try {
                const ratingService = firebaseManager.getRatingService();
                const currentUser = firebaseManager.getCurrentUser();
                const userService = firebaseManager.getUserService();
                
                const userProfile = await userService.getUserProfile(currentUser.uid);
                
                // Get display name based on user preference
                const displayName = typeof Utils !== 'undefined' && Utils.getDisplayName
                    ? Utils.getDisplayName(userProfile, currentUser)
                    : (userProfile?.displayName || currentUser.displayName || currentUser.email);
                
                await ratingService.addOrUpdateRating(
                    currentUser.uid,
                    displayName,
                    userProfile?.photoURL || currentUser.photoURL || '',
                    ratingData.movieId,
                    newRating,
                    newComment
                );
                
                closeModal();
                this.showSuccess('Отзыв обновлен!');
                await this.forceRefreshRatings();
                
            } catch (error) {
                console.error('Error updating rating:', error);
                this.showError(`Ошибка при сохранении: ${error.message}`);
            }
        });
    }

    async deletePopupRating(ratingId) {
        const confirmed = confirm('Вы уверены, что хотите удалить свой отзыв?');
        
        if (!confirmed) return;
        
        try {
            const ratingService = firebaseManager.getRatingService();
            const currentUser = firebaseManager.getCurrentUser();
            
            if (!currentUser) {
                this.showError('Пожалуйста, войдите в систему');
                return;
            }
            
            await ratingService.deleteRating(currentUser.uid, ratingId);
            
            const ratingCard = document.getElementById(`rating-${ratingId}`);
            if (ratingCard) {
                ratingCard.style.transition = 'opacity 0.3s, transform 0.3s';
                ratingCard.style.opacity = '0';
                ratingCard.style.transform = 'translateX(-20px)';
                
                setTimeout(async () => {
                    ratingCard.remove();
                    await this.forceRefreshRatings();
                }, 300);
            }
            
            this.showSuccess('Отзыв удален');
            
        } catch (error) {
            console.error('Error deleting rating:', error);
            this.showError(`Ошибка при удалении: ${error.message}`);
        }
    }


    showLoading(show) {
        this.elements.loading.style.display = show ? 'flex' : 'none';
    }

    hideFeedContentWithFade() {
        return new Promise((resolve) => {
            const feedContent = this.elements.feedContent;
            feedContent.classList.remove('fade-in');
            feedContent.classList.add('fade-out');
            
            setTimeout(() => {
                feedContent.style.display = 'none';
                feedContent.classList.remove('fade-out');
                resolve();
            }, 300);
        });
    }

    showFeedContentWithFade() {
        return new Promise((resolve) => {
            const feedContent = this.elements.feedContent;
            // Restore original display (flex from CSS)
            feedContent.style.display = '';
            feedContent.classList.remove('fade-out');
            feedContent.classList.add('fade-in');
            
            setTimeout(() => {
                resolve();
            }, 50);
        });
    }

    showLoadingWithFade() {
        return new Promise((resolve) => {
            const loading = this.elements.loading;
            loading.style.display = 'flex';
            loading.classList.remove('fade-out');
            loading.classList.add('fade-in');
            
            // Диагностика слоев для определения проблемы с z-index
            // Используем небольшую задержку, чтобы DOM успел обновиться
            setTimeout(() => {
                this.diagnoseLayers(loading);
                resolve();
            }, 100);
        });
    }

    diagnoseLayers(loadingElement) {
        console.log('🔍 ========== ДИАГНОСТИКА СЛОЕВ ==========');
        
        // Информация о самом loader'е
        const loadingRect = loadingElement.getBoundingClientRect();
        const loadingStyles = window.getComputedStyle(loadingElement);
        console.log('📦 LOADER ELEMENT:');
        console.log('  ID:', loadingElement.id);
        console.log('  Class:', loadingElement.className);
        console.log('  z-index:', loadingStyles.zIndex);
        console.log('  position:', loadingStyles.position);
        console.log('  display:', loadingStyles.display);
        console.log('  visibility:', loadingStyles.visibility);
        console.log('  opacity:', loadingStyles.opacity);
        console.log('  rect:', `top:${Math.round(loadingRect.top)} left:${Math.round(loadingRect.left)} width:${Math.round(loadingRect.width)} height:${Math.round(loadingRect.height)}`);
        console.log('  parent:', loadingElement.parentElement?.tagName + '.' + (loadingElement.parentElement?.className || 'no class'));

        // Проверяем все родительские элементы
        let parent = loadingElement.parentElement;
        let level = 1;
        console.log('\n📚 РОДИТЕЛЬСКИЕ ЭЛЕМЕНТЫ:');
        while (parent && parent !== document.body) {
            const parentStyles = window.getComputedStyle(parent);
            const parentRect = parent.getBoundingClientRect();
            console.log(`  Level ${level}:`);
            console.log('    Tag:', parent.tagName);
            console.log('    ID:', parent.id || '(no id)');
            console.log('    Class:', parent.className || '(no class)');
            console.log('    z-index:', parentStyles.zIndex);
            console.log('    position:', parentStyles.position);
            console.log('    overflow:', parentStyles.overflow);
            console.log('    overflowY:', parentStyles.overflowY);
            console.log('    transform:', parentStyles.transform || 'none');
            console.log('    rect:', `top:${Math.round(parentRect.top)} left:${Math.round(parentRect.left)} width:${Math.round(parentRect.width)} height:${Math.round(parentRect.height)}`);
            parent = parent.parentElement;
            level++;
        }

        // Проверяем все элементы с z-index в popup-container
        const popupContainer = document.querySelector('.popup-container');
        if (popupContainer) {
            console.log('\n🎯 ЭЛЕМЕНТЫ С Z-INDEX В POPUP:');
            const allElements = popupContainer.querySelectorAll('*');
            const elementsWithZIndex = [];
            
            allElements.forEach(el => {
                const styles = window.getComputedStyle(el);
                const zIndex = styles.zIndex;
                if (zIndex !== 'auto' && zIndex !== '0') {
                    const rect = el.getBoundingClientRect();
                    elementsWithZIndex.push({
                        element: el,
                        tag: el.tagName,
                        id: el.id || '(no id)',
                        className: el.className || '(no class)',
                        zIndex: zIndex,
                        position: styles.position,
                        display: styles.display,
                        rect: {
                            top: Math.round(rect.top),
                            left: Math.round(rect.left),
                            width: Math.round(rect.width),
                            height: Math.round(rect.height)
                        }
                    });
                }
            });

            // Сортируем по z-index
            elementsWithZIndex.sort((a, b) => {
                const zA = parseInt(a.zIndex) || 0;
                const zB = parseInt(b.zIndex) || 0;
                return zB - zA;
            });

            elementsWithZIndex.forEach((item, index) => {
                console.log(`  ${index + 1}. ${item.tag}${item.id ? '#' + item.id : ''}${item.className ? '.' + item.className.split(' ').join('.') : ''}`);
                console.log('     z-index:', item.zIndex, '| position:', item.position, '| display:', item.display);
                console.log('     rect:', `top:${item.rect.top} left:${item.rect.left} width:${item.rect.width} height:${item.rect.height}`);
            });
        }

        // Проверяем элементы, которые могут перекрывать loader по координатам
        console.log('\n📍 ЭЛЕМЕНТЫ, КОТОРЫЕ МОГУТ ПЕРЕКРЫВАТЬ LOADER:');
        const loadingCenterX = loadingRect.left + loadingRect.width / 2;
        const loadingCenterY = loadingRect.top + loadingRect.height / 2;
        console.log('  Центр loader:', `x:${Math.round(loadingCenterX)} y:${Math.round(loadingCenterY)}`);
        
        const allElementsInPopup = popupContainer ? popupContainer.querySelectorAll('*') : [];
        const overlappingElements = [];
        
        allElementsInPopup.forEach(el => {
            if (el === loadingElement || el.contains(loadingElement)) return;
            
            const rect = el.getBoundingClientRect();
            const styles = window.getComputedStyle(el);
            
            // Проверяем, перекрывает ли элемент центр loader'а
            const overlapsX = rect.left <= loadingCenterX && rect.right >= loadingCenterX;
            const overlapsY = rect.top <= loadingCenterY && rect.bottom >= loadingCenterY;
            
            if (overlapsX && overlapsY && styles.display !== 'none' && styles.visibility !== 'hidden') {
                const zIndex = parseInt(styles.zIndex) || 0;
                const loadingZIndex = parseInt(loadingStyles.zIndex) || 0;
                
                overlappingElements.push({
                    element: el,
                    tag: el.tagName,
                    id: el.id || '(no id)',
                    className: el.className || '(no class)',
                    zIndex: styles.zIndex,
                    zIndexNum: zIndex,
                    position: styles.position,
                    display: styles.display,
                    rect: {
                        top: Math.round(rect.top),
                        left: Math.round(rect.left),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    },
                    overlapsLoader: zIndex >= loadingZIndex
                });
            }
        });

        overlappingElements.sort((a, b) => {
            return b.zIndexNum - a.zIndexNum;
        });

        if (overlappingElements.length > 0) {
            overlappingElements.forEach((item, index) => {
                const status = item.overlapsLoader ? '⚠️ ПЕРЕКРЫВАЕТ' : '✅ НИЖЕ';
                console.log(`  ${index + 1}. ${status} - ${item.tag}${item.id ? '#' + item.id : ''}${item.className ? '.' + item.className.split(' ').join('.') : ''}`);
                console.log('     z-index:', item.zIndex, `(${item.zIndexNum})`, '| position:', item.position, '| display:', item.display);
                console.log('     rect:', `top:${item.rect.top} left:${item.rect.left} width:${item.rect.width} height:${item.rect.height}`);
            });
        } else {
            console.log('  ✅ Нет элементов, перекрывающих loader');
        }

        // Дополнительная проверка: элементы выше loader'а по z-index в той же области
        console.log('\n🔎 ЭЛЕМЕНТЫ С БОЛЬШИМ Z-INDEX В ОБЛАСТИ LOADER:');
        const loaderTop = loadingRect.top;
        const loaderBottom = loadingRect.bottom;
        const loaderLeft = loadingRect.left;
        const loaderRight = loadingRect.right;
        
        const highZIndexElements = [];
        allElementsInPopup.forEach(el => {
            if (el === loadingElement || el.contains(loadingElement)) return;
            
            const rect = el.getBoundingClientRect();
            const styles = window.getComputedStyle(el);
            const zIndex = parseInt(styles.zIndex) || 0;
            const loadingZIndex = parseInt(loadingStyles.zIndex) || 0;
            
            // Проверяем, пересекается ли элемент с областью loader'а
            const intersectsX = !(rect.right < loaderLeft || rect.left > loaderRight);
            const intersectsY = !(rect.bottom < loaderTop || rect.top > loaderBottom);
            
            if (intersectsX && intersectsY && zIndex >= loadingZIndex && styles.display !== 'none' && styles.visibility !== 'hidden') {
                highZIndexElements.push({
                    element: el,
                    tag: el.tagName,
                    id: el.id || '(no id)',
                    className: el.className || '(no class)',
                    zIndex: styles.zIndex,
                    zIndexNum: zIndex,
                    position: styles.position,
                    rect: {
                        top: Math.round(rect.top),
                        left: Math.round(rect.left),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    }
                });
            }
        });

        highZIndexElements.sort((a, b) => b.zIndexNum - a.zIndexNum);

        if (highZIndexElements.length > 0) {
            highZIndexElements.forEach((item, index) => {
                console.log(`  ⚠️ ${index + 1}. ${item.tag}${item.id ? '#' + item.id : ''}${item.className ? '.' + item.className.split(' ').join('.') : ''}`);
                console.log('     z-index:', item.zIndex, `(${item.zIndexNum})`, '| position:', item.position);
                console.log('     rect:', `top:${item.rect.top} left:${item.rect.left} width:${item.rect.width} height:${item.rect.height}`);
            });
        } else {
            console.log('  ✅ Нет элементов с большим z-index в области loader');
        }

        console.log('🔍 =========================================\n');
    }

    hideLoadingWithFade() {
        return new Promise((resolve) => {
            const loading = this.elements.loading;
            loading.classList.remove('fade-in');
            loading.classList.add('fade-out');
            
            setTimeout(() => {
                loading.style.display = 'none';
                loading.classList.remove('fade-out');
                resolve();
            }, 300);
        });
    }

    showMainContent() {
        this.elements.initialLoading.style.display = 'none';
        this.elements.mainContent.style.display = 'flex';
        this.elements.loading.style.display = 'none';
    }

    showError(message) {
        this.elements.errorMessage.textContent = message;
        this.elements.errorMessage.style.display = 'block';
        setTimeout(() => this.hideError(), 5000);
    }

    hideError() {
        this.elements.errorMessage.style.display = 'none';
    }

    compareVersions(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            if (p1 > p2) return 1;
            if (p1 < p2) return -1;
        }
        return 0;
    }

    escapeHtml(text) {
        return Utils.escapeHtml(text);
    }

    truncateText(text, maxLength = 100) {
        return Utils.truncateText(text, maxLength);
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.popupManager = new PopupManager();
});