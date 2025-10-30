/**
 * PopupManager - Main controller for the Movie Rating Extension popup
 * Handles authentication, search, and rating feed display
 */
class PopupManager {
    constructor() {
        this.elements = this.initializeElements();
        this.ratings = [];
        this.searchTimeout = null;
        this.ratingsLoaded = false;
        this.isLoadingRatings = false; // Add flag to prevent multiple simultaneous loads
        this.setupEventListeners();
        this.setupAuthStateListener();
        this.initializeUI();
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
            this.updateAuthUI(isAuthenticated, user);
            
            // Auto-load ratings when user signs in (only if not already loaded or loading)
            if (isAuthenticated && user && !this.ratingsLoaded && !this.isLoadingRatings) {
                console.log('PopupManager: Auth state changed, loading ratings');
                this.loadRatings();
            }
        });
    }

    async initializeUI() {
        // Check auth state immediately first
        let currentUser = firebaseManager.getCurrentUser();
        let isAuthenticated = firebaseManager.isAuthenticated();
        
        // Update UI immediately if user is already authenticated
        if (isAuthenticated && currentUser) {
            this.updateAuthUI(true, currentUser);
            this.loadRatings();
            return;
        }
        
        // Otherwise wait for auth initialization
        await this.waitForAuthInit();
        
        currentUser = firebaseManager.getCurrentUser();
        isAuthenticated = firebaseManager.isAuthenticated();
        
        this.updateAuthUI(isAuthenticated, currentUser);
        
        // Only load ratings if not already loaded and user is authenticated
        if (isAuthenticated && currentUser && !this.ratingsLoaded && !this.isLoadingRatings) {
            this.loadRatings();
        }
    }

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

    updateAuthUI(isAuthenticated, user) {
        // Hide initial loading indicator
        this.elements.initialLoading.style.display = 'none';
        
        if (isAuthenticated) {
            this.elements.authSection.style.display = 'none';
            this.elements.mainContent.style.display = 'flex';
            this.elements.statusIndicator.classList.add('authenticated');
            this.elements.statusText.textContent = `Signed in as ${user?.displayName || user?.email || 'User'}`;
            
            // Update user info
            this.elements.userName.textContent = user?.displayName || user?.email || 'User';
            if (user?.photoURL) {
                this.elements.userAvatar.src = user.photoURL;
                this.elements.userAvatar.style.display = 'block';
            }
        } else {
            this.elements.authSection.style.display = 'block';
            this.elements.mainContent.style.display = 'none';
            this.elements.statusIndicator.classList.remove('authenticated');
            this.elements.statusText.textContent = 'Not authenticated';
        }
    }

    async handleGoogleLogin() {
        try {
            this.showLoading(true);
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
            
            this.loadRatings();
        } catch (error) {
            this.showError(`Google login failed: ${error.message}`);
        } finally {
            this.showLoading(false);
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
            this.showLoading(true);
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
            this.loadRatings();
        } catch (error) {
            this.showError(`Email login failed: ${error.message}`);
        } finally {
            this.showLoading(false);
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
            this.showLoading(true);
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
            this.loadRatings();
        } catch (error) {
            this.showError(`Registration failed: ${error.message}`);
        } finally {
            this.showLoading(false);
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
            const url = chrome.runtime.getURL(`search.html?query=${encodedQuery}`);
            chrome.tabs.create({ url: url });
        } else {
            chrome.tabs.create({ url: chrome.runtime.getURL('search.html') });
        }
    }

    openMovieDetails(movieId) {
        // For now, open in advanced search page with movie ID
        chrome.tabs.create({ 
            url: chrome.runtime.getURL(`search.html?movieId=${movieId}`) 
        });
    }

    openRatingsPage() {
        chrome.tabs.create({ 
            url: chrome.runtime.getURL('ratings.html') 
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
            this.showLoading(true);
            this.hideError();
            
            // Check if chrome.storage is available
            if (!chrome || !chrome.storage || !chrome.storage.local) {
                console.error('PopupManager: chrome.storage.local is not available');
                throw new Error('Storage not available');
            }
            
            const ratingsCacheService = firebaseManager.getRatingsCacheService();
            console.log('PopupManager: Got RatingsCacheService instance');
            
            const cacheStartTime = performance.now();
            const result = await ratingsCacheService.getCachedRatingsWithBackgroundRefresh(50);
            const cacheEndTime = performance.now();
            const cacheLoadTime = Math.round(cacheEndTime - cacheStartTime);
            
            console.log(`⚡ PopupManager: Got result from cache service in ${cacheLoadTime}ms:`, { 
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
            this.showError(`Failed to load ratings: ${error.message}`);
        } finally {
            this.showLoading(false);
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
            this.showLoading(true);
            this.hideError();
            
            console.log('🔄 PopupManager: Force refreshing ratings...');
            
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
            this.showError(`Failed to refresh ratings: ${error.message}`);
        } finally {
            this.showLoading(false);
            this.isLoadingRatings = false; // Reset flag
        }
    }

    async renderRatings() {
        console.log('PopupManager: Rendering ratings, clearing existing content');
        this.elements.feedContent.innerHTML = '';

        if (this.ratings.length === 0) {
            this.elements.feedContent.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🎬</div>
                    <h3 class="empty-state-title">No ratings yet</h3>
                    <p class="empty-state-text">Start rating movies to see them here!</p>
                </div>
            `;
            return;
        }

        console.log(`PopupManager: Rendering ${this.ratings.length} ratings`);
        
        // Pre-load all average ratings in batch to avoid multiple Firebase calls
        const averageRatingsStartTime = performance.now();
        const averageRatingsMap = await this.preloadAverageRatings();
        const averageRatingsTime = Math.round(performance.now() - averageRatingsStartTime);
        console.log(`⚡ Pre-loaded average ratings in ${averageRatingsTime}ms`);
        
        // Process ratings synchronously now that we have all data
        for (const rating of this.ratings) {
            try {
                // Check if element already exists to prevent duplicates
                const existingElement = document.getElementById(`rating-${rating.id}`);
                if (existingElement) {
                    console.warn(`Skipping duplicate rating element: rating-${rating.id}`);
                    continue;
                }
                
                const ratingElement = this.createRatingElementSync(rating, averageRatingsMap);
                this.elements.feedContent.appendChild(ratingElement);
            } catch (error) {
                console.error('Error creating rating element:', error);
                // Continue with other ratings even if one fails
            }
        }
        console.log('PopupManager: Finished rendering ratings');
    }

    async preloadAverageRatings() {
        const movieIds = [...new Set(this.ratings.map(r => r.movie?.kinopoiskId || r.movieId))];
        const averageRatingsMap = new Map();
        
        try {
            const ratingService = firebaseManager.getRatingService();
            
            // Load all average ratings in parallel
            const promises = movieIds.map(async (movieId) => {
                try {
                    const averageData = await ratingService.getMovieAverageRating(movieId);
                    return { movieId, averageData };
                } catch (error) {
                    console.warn(`Failed to get average rating for movie ${movieId}:`, error);
                    return { movieId, averageData: { average: 0, count: 0 } };
                }
            });
            
            const results = await Promise.all(promises);
            
            // Build map for quick lookup
            results.forEach(({ movieId, averageData }) => {
                averageRatingsMap.set(movieId, averageData);
            });
            
        } catch (error) {
            console.error('Error preloading average ratings:', error);
        }
        
        return averageRatingsMap;
    }

    createRatingElementSync(rating, averageRatingsMap) {
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

        ratingDiv.innerHTML = `
            <img src="${posterUrl}" alt="${movieTitle}" class="rating-poster" onerror="this.src='/icons/icon48.png'">
            <div class="rating-content">
                <div class="rating-header">
                    <img src="${rating.userPhoto || '/icons/icon48.png'}" alt="${rating.userName}" class="rating-user-avatar" onerror="this.src='/icons/icon48.png'">
                    <span class="rating-user-name" title="${this.escapeHtml(rating.userName)}">${this.escapeHtml(this.truncateText(rating.userName, 20))}</span>
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

        // Add click handler to navigate to movie detail page
        ratingDiv.addEventListener('click', () => {
            if (movieId) {
                chrome.tabs.create({ 
                    url: chrome.runtime.getURL(`search.html?movieId=${movieId}`) 
                });
            }
        });

        return ratingDiv;
    }


    showLoading(show) {
        this.elements.loading.style.display = show ? 'flex' : 'none';
    }

    showError(message) {
        this.elements.errorMessage.textContent = message;
        this.elements.errorMessage.style.display = 'block';
        setTimeout(() => this.hideError(), 5000);
    }

    hideError() {
        this.elements.errorMessage.style.display = 'none';
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
    new PopupManager();
});