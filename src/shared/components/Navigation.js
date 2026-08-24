/**
 * Navigation Component
 * Global navigation header for all pages
 */
class Navigation {
    // Cache key for storing user display data
    static USER_DISPLAY_CACHE_KEY = 'userDisplayCache';
    // Cache lifetime: 7 days
    static CACHE_LIFETIME = 7 * 24 * 60 * 60 * 1000;

    constructor(currentPage = '') {
        this.currentPage = currentPage;
        this.user = null;
        this.authCheckInterval = null;
        this.collectionService = null;
        this.userId = null;
        this.watchlistService = null;
        this.favoriteService = null;
        this.watchingService = null;
        this.cachedUserDisplay = null;
        this._updateInProgress = false;
        if (typeof window !== 'undefined') {
            window.navigationInstance = this;
            window.navigation = this;
        }
        this.init();
    }

    async init() {
        this.applyTheme(this.getCurrentTheme());
        
        // CRITICAL: Load cached user display BEFORE rendering to prevent flickering
        await this.loadCachedUserDisplay();
        
        // Initialize i18n via dynamic import to maintain compatibility with non-module scripts
        try {
            const module = await import('../i18n/I18n.js');
            this.i18n = module.i18n;
            if (this.i18n) {
                if (!this.i18n.currentLocale || this.i18n.currentLocale === 'en') {
                    await this.i18n.init();
                }
            }
        } catch (e) {
            console.warn('Navigation: i18n module not loaded', e);
        }

        this.render();
        this.updateThemeButton(this.getCurrentTheme()); // Update UI after render
        this.setupEventListeners();
        this.setupAuthListener();
        this.setupDisplayCacheListener();
        
        if (this.i18n) {
            this.i18n.translatePage(); // Translate newly inserted navigation
        }
    }

    /**
     * Load cached user display data from chrome.storage.local
     * This is called BEFORE render to prevent flickering
     */
    async loadCachedUserDisplay() {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                const result = await chrome.storage.local.get([
                    Navigation.USER_DISPLAY_CACHE_KEY,
                    'isAuthenticated',
                    'user'
                ]);
                
                const cache = result[Navigation.USER_DISPLAY_CACHE_KEY];
                
                if (result.isAuthenticated && cache) {
                    // Validate: cache belongs to current user
                    const currentUserId = result.user?.uid;
                    if (cache.uid === currentUserId) {
                        // Check cache lifetime (7 days)
                        const isExpired = cache.timestamp && (Date.now() - cache.timestamp > Navigation.CACHE_LIFETIME);
                        
                        if (!isExpired) {
                            this.cachedUserDisplay = cache;
                            // console.log('Navigation: Loaded cached user display:', cache.displayName);
                        } else {
                            // Clear expired cache
                            // console.log('Navigation: Cached user display expired, clearing');
                            await chrome.storage.local.remove([Navigation.USER_DISPLAY_CACHE_KEY]);
                        }
                    } else {
                        // UID mismatch, clear stale cache
                        // console.log('Navigation: Cached user display UID mismatch, clearing');
                        await chrome.storage.local.remove([Navigation.USER_DISPLAY_CACHE_KEY]);
                    }
                }
            }
        } catch (error) {
            console.warn('Navigation: Could not load cached user display:', error);
        }
    }

    /**
     * Listen for display cache changes from other tabs
     */
    setupDisplayCacheListener() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, areaName) => {
                if (areaName === 'local' && changes[Navigation.USER_DISPLAY_CACHE_KEY]) {
                    const newCache = changes[Navigation.USER_DISPLAY_CACHE_KEY].newValue;
                    this.handleDisplayCacheUpdate(newCache);
                }
            });
        }
    }

    /**
     * Handle display cache updates from other tabs
     */
    handleDisplayCacheUpdate(newCache) {
        if (newCache && this.user && newCache.uid === this.user.uid) {
            this.cachedUserDisplay = newCache;
            // Update UI without full re-render
            const userAvatar = document.getElementById('navUserAvatar');
            const userName = document.getElementById('navUserName');
            if (userAvatar && newCache.photoURL) {
                userAvatar.src = newCache.photoURL;
            }
            if (userName && newCache.displayName) {
                userName.textContent = newCache.displayName;
            }
            // console.log('Navigation: Updated display from other tab cache:', newCache.displayName);
        }
    }



    /**
     * Get the absolute URL for a page
     */
    getPageUrl(page) {
        switch (page) {
            case 'home':
                return chrome.runtime.getURL('src/pages/home/home.html');
            case 'search':
                return chrome.runtime.getURL('src/pages/search/search.html');
            case 'ratings':
                return chrome.runtime.getURL('src/pages/ratings/ratings.html');
            case 'watchlist':
                return chrome.runtime.getURL('src/pages/watchlist/watchlist.html');
            case 'favorites':
                return chrome.runtime.getURL('src/pages/favorites/favorites.html');
            case 'watching':
                return chrome.runtime.getURL('src/pages/watching/watching.html');
            case 'bookmarks':
                return chrome.runtime.getURL('src/pages/bookmarks/bookmarks.html');
            case 'random':
                return chrome.runtime.getURL('src/pages/random/random.html');
            case 'profile':
                return chrome.runtime.getURL('src/pages/profile/profile.html');
            case 'settings':
                return chrome.runtime.getURL('src/pages/settings/settings.html');
            case 'admin':
                return chrome.runtime.getURL('src/pages/admin/admin.html');
            case 'calendar':
                return chrome.runtime.getURL('src/pages/calendar/calendar.html');
            default:
                console.warn(`[Navigation] No URL mapping for page: "${page}", falling back to "#"`);
                return '#';
        }
    }

    render() {
        // Check if navigation already exists in DOM
        const existingNav = document.querySelector('.nav-header');
        if (existingNav) {
            // Navigation already rendered, just set active page
            this.setActivePage(this.currentPage);
            return;
        }

        // Use cached user display data to prevent flickering
        const cachedName = this.cachedUserDisplay?.displayName || 'User';
        const cachedAvatar = this.cachedUserDisplay?.photoURL || chrome.runtime.getURL('src/shared/assets/icons/app/icon48.png');
        const hasCachedUser = !!this.cachedUserDisplay;
        
        // Determine initial visibility based on cache
        const userProfileDisplay = hasCachedUser ? 'block' : 'none';

        const navHTML = `
            <header class="nav-header">
                    <!-- Radio Player (absolute, outside flex flow) -->
                    <div id="navigationLeft" class="nav-radio" style="display: none;">
                        <span class="nav-radio-controls">
                            <button class="nav-radio-btn" id="radioPlayBtn" title="Play"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>
                            <button class="nav-radio-btn" id="radioStopBtn" title="Stop" style="display:none;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg></button>
                        </span>
                        <span id="volumeControl" class="nav-radio-volume">
                            <span id="volumeIcon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg></span>
                            <input type="range" id="volumeSlider" class="nav-radio-slider"
                                min="0" max="1" step="0.05" value="0.8">
                        </span>
                        <div class="nav-radio-meta" id="radioMeta">
                            <img class="nav-radio-poster" id="radioPoster" src="" alt="" style="display:none;">
                            <div class="nav-radio-meta-text">
                                <span class="nav-radio-track" id="radioTrackName">Anime Radio</span>
                                <span class="nav-radio-duration" id="radioDuration"></span>
                            </div>
                        </div>
                    </div>

                <div class="nav-container">
                    <!-- Logo Section -->
                    <a href="${this.getPageUrl('home')}" class="nav-logo" id="navLogo" aria-label="${this.i18n?.get('navbar.home') || 'Главная'}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" class="nav-logo-image" aria-hidden="true" style="fill: var(--theme-text-primary, currentColor);"><path d="M241.1 104.7h-162l149.8-44.03c5.09-1.52 7.34-5.32 5.81-10.41l-8.8-27.33c-4.1-12.65-16.27-16.87-27.97-13.5l-172.6 49c-12.87 3.94-20.3 16.5-16.36 30.35l6.04 23.68v111.8c0 12.55 10.16 23.76 23.48 23.76h97.2c5.5 0 8.35-4.89 7.75-8.29-.68-3.74-3.68-6.59-7.44-6.59H38.5c-4.94 0-7.38-4.29-7.38-7.5v-65.56h201.5v64.45c0 4.52-3.4 8.61-8.49 8.61H207.7c-5.09 0-8.15 3.99-8.15 7.44 0 4.34 3.59 7.44 7.84 7.44h16.74c12.97 0 24.59-10.89 24.59-23.69v-112c0-4.37-3.32-7.55-7.68-7.55zm-38.5-81.56c4.54-.86 7.25 2.51 8.05 5.47l5.16 19.29-23.18 6.53L170 33.45zm-50.31 14.94 22.63 20.98-35.67 10.62-21.8-20.98zM99.65 53.7l22.63 20.98L90.6 84.72 67.62 62.88zM23.69 84.79c-1.6-6.05 1.99-10.91 7.19-12.21l18.95-4.53 22.63 20.98-43.61 13.16zm7.51 34.79h42.29l-14.04 24.74H31.2zm46.23 24.74 15.55-24.33h36.61l-13.73 24.33zm55.82 0 14.83-24.33h37.65l-14.54 24.33zm56.69 0 14.14-23.92h28.6v23.92z"/><path d="M168.1 232.7c-5.38 0-8.44 3.92-8.44 7.51 0 4.6 3.79 7.78 7.94 7.78h8.22c4.87 0 7.93-3.79 7.93-7.78 0-4.41-3.83-7.51-7.67-7.51z"/></svg>
                    </a>

                    <!-- Mobile Toggle -->
                    <button class="nav-mobile-toggle" id="navMobileToggle" aria-label="${this.i18n?.get('navbar.open_menu') || 'Открыть меню'}">
                        <span>${typeof Icons !== 'undefined' ? Icons.MENU : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>'}</span>
                    </button>

                    <!-- Navigation Menu -->
                    <nav class="nav-menu" id="navMenu">
                        <div class="nav-item">
                            <a href="${this.getPageUrl('random')}" class="nav-link" data-page="random" id="navRandom">
                                <span class="nav-icon">${typeof Icons !== 'undefined' ? Icons.DICE : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><circle cx="16" cy="16" r="2"></circle><circle cx="16" cy="8" r="2"></circle><circle cx="8" cy="16" r="2"></circle><circle cx="8" cy="8" r="2"></circle><circle cx="12" cy="12" r="2"></circle></svg>'}</span>
                                <span data-i18n="navbar.random">Random</span>
                            </a>
                        </div>

                        <div class="nav-item">
                            <a href="${this.getPageUrl('ratings')}" class="nav-link" data-page="ratings" id="navRatings">
                                <span class="nav-icon">${typeof Icons !== 'undefined' ? Icons.STAR : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'}</span>
                                <span data-i18n="navbar.rated">Rated</span>
                            </a>
                        </div>
                    </nav>

                    <!-- Search & Bookmarks Section -->
                    <div class="nav-search-container">
                        <button class="nav-search-toggle" id="navSearchToggle" aria-label="${this.i18n?.get('navbar.search') || 'Поиск фильмов'}" title="Search Movies" style="margin-right: 5px;">
                            <span class="nav-icon">${typeof Icons !== 'undefined' ? Icons.SEARCH : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'}</span>
                        </button>
                        <div class="nav-search-input-wrapper" id="navSearchInputWrapper">
                            <input type="text" class="nav-search-input" id="navSearchInput" data-i18n="navbar.search_placeholder" placeholder="Search movies...">
                        </div>

                        <!-- Bookmarks Button -->
                        <a href="${this.getPageUrl('bookmarks')}" class="nav-icon-btn" id="navBookmarksBtn" data-page="bookmarks" aria-label="${this.i18n?.get('bookmarks.title') || 'Закладки'}" title="Bookmarks">
                            <span class="nav-icon">${typeof Icons !== 'undefined' ? Icons.BOOKMARK : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>'}</span>
                        </a>

                        <!-- Calendar Button -->
                        <a href="${this.getPageUrl('calendar')}" class="nav-icon-btn" id="navCalendarBtn" data-page="calendar" aria-label="${this.i18n?.get('navbar.calendar') || 'Календарь'}" title="Calendar">
                            <span class="nav-icon">${typeof Icons !== 'undefined' ? Icons.CALENDAR : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>'}</span>
                        </a>

                        <!-- Games Button -->
                        <button class="nav-icon-btn" id="navGamesBtn" title="Мини-игры" style="display: none; margin-left: 2px;">
                            <span class="nav-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="10" y2="12"></line><line x1="8" y1="10" x2="8" y2="14"></line><line x1="15" y1="13" x2="15.01" y2="13"></line><line x1="18" y1="11" x2="18.01" y2="11"></line><rect x="2" y="6" width="20" height="12" rx="6"></rect></svg></span>
                        </button>
                    </div>

                    <!-- User Section -->
                    <div class="nav-user" id="navUser">
                        <!-- User Profile Dropdown -->
                        <div class="nav-user-profile" id="navUserProfile" style="display: ${userProfileDisplay};">
                            <button class="nav-user-trigger" id="navUserTrigger">
                                <img src="${cachedAvatar}" alt="User" class="nav-user-avatar" id="navUserAvatar">
                                <span class="nav-user-name" id="navUserName">${cachedName}</span>
                                <span class="nav-dropdown-arrow">${typeof Icons !== 'undefined' && Icons.CHEVRON_DOWN ? Icons.CHEVRON_DOWN : '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>'}</span>
                            </button>
                            
                            <!-- Dropdown Menu -->
                            <div class="nav-user-dropdown" id="navUserDropdown">
                                <a href="${this.getPageUrl('profile')}" class="nav-dropdown-item" id="navDropdownSettings">
                                    <span class="nav-dropdown-icon">${typeof Icons !== 'undefined' ? Icons.USER : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'}</span>
                                    <span data-i18n="navbar.view_profile">View Profile</span>
                                </a>
                                <a href="${this.getPageUrl('settings')}" class="nav-dropdown-item" id="navDropdownSettingsPage">
                                    <span class="nav-dropdown-icon">${typeof Icons !== 'undefined' ? Icons.SETTINGS : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>'}</span>
                                    <span data-i18n="navbar.settings">Settings</span>
                                </a>
                                <a href="${this.getPageUrl('admin')}" class="nav-dropdown-item" id="navDropdownAdmin" style="display: none;">
                                    <span class="nav-dropdown-icon">${typeof Icons !== 'undefined' ? Icons.ADMIN : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>'}</span>
                                    <span data-i18n="navbar.admin_panel">Admin Panel</span>
                                </a>
                                <div class="nav-dropdown-item" id="navDropdownTheme">
                                    <span class="nav-dropdown-icon" id="navThemeIcon">
                                        ${typeof Icons !== 'undefined' ? Icons.THEME : '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20" style="width: 16px; height: 16px;"><path fill-rule="evenodd" d="M10.606 1.987a.75.75 0 0 1-.217.835 5.795 5.795 0 0 0 6.387 9.58.75.75 0 0 1 1.031.965A8.502 8.502 0 0 1 1.5 10a8.5 8.5 0 0 1 8.395-8.5.75.75 0 0 1 .711.487M8.004 3.288a7 7 0 1 0 7.421 11.137A7.295 7.295 0 0 1 8.004 3.288" clip-rule="evenodd"></path></svg>'}
                                    </span>
                                    <span id="navThemeText" data-i18n="navbar.theme">Theme</span>
                                </div>
                                <div class="nav-dropdown-divider"></div>
                                <div class="nav-dropdown-item nav-dropdown-logout" id="navDropdownLogout">
                                    <span class="nav-dropdown-icon">${typeof Icons !== 'undefined' ? Icons.LOGOUT : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>'}</span>
                                    <span data-i18n="navbar.log_out">Log Out</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Sign In Button (for non-authenticated users) -->
                        <button class="nav-signin-btn" id="navSignInBtn" style="display: none;">
                            <span class="nav-signin-icon">${typeof Icons !== 'undefined' ? Icons.USER : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'}</span>
                            <span data-i18n="navbar.sign_in">Sign In</span>
                        </button>
                    </div>
                </div>
            </header>
        `;

        // Insert navigation at the beginning of body
        document.body.insertAdjacentHTML('afterbegin', navHTML);
        
        // Set active page
        this.setActivePage(this.currentPage);
    }

    setupEventListeners() {
        // Mobile toggle
        const mobileToggle = document.getElementById('navMobileToggle');
        const navMenu = document.getElementById('navMenu');
        
        if (mobileToggle && navMenu) {
            mobileToggle.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return; // Only left click
                navMenu.classList.toggle('active');
            });
        }

        // Navigation links
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('mousedown', (e) => {
                // If it's not a left click, let the browser handle it (e.g. middle click for new tab)
                if (e.button !== 0) return;
                
                e.preventDefault();
                const page = link.dataset.page;
                this.navigateToPage(page);
            });
        });

        // Logo click - go to popup/home
        const navLogo = document.getElementById('navLogo');
        if (navLogo) {
            navLogo.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                this.navigateToPage('home');
            });
        }

        // User dropdown functionality
        this.setupUserDropdown();

        // Sign In button
        const signInBtn = document.getElementById('navSignInBtn');
        if (signInBtn) {
            signInBtn.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                this.handleSignIn();
            });
        }

        // Search toggle functionality
        this.setupSearchToggle();

        // Radio player
        this.setupRadioPlayer();

        // Bookmarks button functionality
        const bookmarksBtn = document.getElementById('navBookmarksBtn');
        if (bookmarksBtn) {
            bookmarksBtn.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                // console.log('Bookmarks button clicked');
                e.preventDefault();
                this.navigateToPage('bookmarks');
            });
        } else {
            console.error('Bookmarks button not found in DOM during setup');
        }

        const calendarBtn = document.getElementById('navCalendarBtn');
        if (calendarBtn) {
            calendarBtn.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                this.navigateToPage('calendar');
            });
        }

        const gamesBtn = document.getElementById('navGamesBtn');
        if (gamesBtn) {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get('showGames', (data) => {
                    gamesBtn.style.display = (data.showGames ?? false) ? 'inline-flex' : 'none';
                });
            }

            gamesBtn.addEventListener('mousedown', async (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                try {
                    const module = await import('./GamesModal.js');
                    const modal = module.GamesModal.getInstance();
                    modal.open();
                } catch (err) {
                    console.error('Failed to open GamesModal:', err);
                }
            });
        }

        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes.showGames) {
                    const btn = document.getElementById('navGamesBtn');
                    if (btn) {
                        btn.style.display = changes.showGames.newValue ? 'inline-flex' : 'none';
                    }
                }
            });
        }

        // Global delegation fallback for Bookmarks
        document.addEventListener('mousedown', (e) => {
            const btn = e.target.closest('#navBookmarksBtn');
            if (btn) {
                // Future handling for bookmarks global clicks
            }
        });

        // Close mobile menu when clicking outside
        document.addEventListener('mousedown', (e) => {
            if (navMenu && !navMenu.contains(e.target) && !mobileToggle.contains(e.target)) {
                navMenu.classList.remove('active');
            }
        });
    }

    setupUserDropdown() {
        const userTrigger = document.getElementById('navUserTrigger');
        const userDropdown = document.getElementById('navUserDropdown');
        const dropdownSettings = document.getElementById('navDropdownSettings');
        const dropdownLogout = document.getElementById('navDropdownLogout');

        if (userTrigger && userDropdown) {
            // Prevent duplicate listeners
            if (userTrigger.dataset.listenerAttached === 'true') {
                return;
            }
            userTrigger.dataset.listenerAttached = 'true';
            
            // Toggle dropdown on user trigger click
            userTrigger.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const isOpen = userDropdown.classList.contains('active');
                
                // Close all other dropdowns first
                this.closeAllDropdowns();
                
                if (!isOpen) {
                    userDropdown.classList.add('active');
                    userTrigger.classList.add('active');
                }
            });

            // Settings dropdown item (View Profile)
            if (dropdownSettings) {
                dropdownSettings.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    this.closeAllDropdowns();
                    this.navigateToPage('profile');
                });
            }

            // Settings page dropdown item
            const dropdownSettingsPage = document.getElementById('navDropdownSettingsPage');
            if (dropdownSettingsPage) {
                dropdownSettingsPage.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    this.closeAllDropdowns();
                    this.navigateToPage('settings');
                });
            }

            // Admin Panel dropdown item
            const dropdownAdmin = document.getElementById('navDropdownAdmin');
            if (dropdownAdmin) {
                dropdownAdmin.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    this.closeAllDropdowns();
                    this.navigateToPage('admin');
                });
            }

            // Theme dropdown item
            const dropdownTheme = document.getElementById('navDropdownTheme');
            if (dropdownTheme) {
                dropdownTheme.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    this.closeAllDropdowns();
                    this.showThemeModal();
                });
            }

            // Logout dropdown item
            if (dropdownLogout) {
                dropdownLogout.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    this.closeAllDropdowns();
                    this.handleLogout();
                });
            }

            // Close dropdown when clicking outside
            document.addEventListener('mousedown', (e) => {
                if (!userTrigger.contains(e.target) && !userDropdown.contains(e.target)) {
                    this.closeAllDropdowns();
                }
            });

            // Close dropdown on escape key
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.closeAllDropdowns();
                }
            });
        }
    }

    closeAllDropdowns() {
        const userDropdown = document.getElementById('navUserDropdown');
        const userTrigger = document.getElementById('navUserTrigger');
        
        if (userDropdown && userTrigger) {
            userDropdown.classList.remove('active');
            userTrigger.classList.remove('active');
        }
    }

    setupSearchToggle() {
        const searchToggle = document.getElementById('navSearchToggle');
        const searchInputWrapper = document.getElementById('navSearchInputWrapper');
        const searchInput = document.getElementById('navSearchInput');

        if (!searchToggle || !searchInputWrapper || !searchInput) return;

        // Toggle search input on button click
        searchToggle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            const isOpen = searchInputWrapper.classList.contains('active');
            
            if (isOpen) {
                const query = searchInput.value.trim();
                if (query) {
                    searchInputWrapper.classList.remove('active');
                    this.navigateToSearchWithQuery(query);
                    searchInput.value = '';
                }
            } else {
                searchInputWrapper.classList.add('active');
                setTimeout(() => searchInput.focus(), 300);
            }
        });

        // Handle Enter key to navigate to search page
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                searchInputWrapper.classList.remove('active');
                if (query) {
                    this.navigateToSearchWithQuery(query);
                    searchInput.value = '';
                } else {
                    this.navigateToPage('search');
                }
            }
        });

        // Close search when clicking outside
        document.addEventListener('mousedown', (e) => {
            if (!searchToggle.contains(e.target) && !searchInputWrapper.contains(e.target)) {
                searchInputWrapper.classList.remove('active');
            }
        });

        // Close search on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && searchInputWrapper.classList.contains('active')) {
                searchInputWrapper.classList.remove('active');
            }
        });
    }

    navigateToSearchWithQuery(query) {
        const searchUrl = chrome.runtime.getURL(`src/pages/search/search.html?q=${encodeURIComponent(query)}`);
        if (window.location.pathname.includes('popup.html')) {
            chrome.tabs.create({ url: searchUrl });
        } else {
            window.location.href = searchUrl;
        }
    }

    async setupRadioPlayer() {
        const playBtn = document.getElementById('radioPlayBtn');
        const stopBtn = document.getElementById('radioStopBtn');
        const volumeSlider = document.getElementById('volumeSlider');
        const volumeIcon = document.getElementById('volumeIcon');
        const trackNameEl = document.getElementById('radioTrackName');
        const durationEl = document.getElementById('radioDuration');
        const posterEl = document.getElementById('radioPoster');

        if (!playBtn || !stopBtn) return;

        // Check visibility setting
        const radioBlock = document.getElementById('navigationLeft');
        if (radioBlock) {
            chrome.storage.local.get('showAnimeRadio', (data) => {
                radioBlock.style.display = (data.showAnimeRadio ?? false) ? 'flex' : 'none';
            });
        }

        // Stream URL map
        const STREAM_URLS = {
            anison: 'https://pool.anison.fm/AniSonFM(320)?nocache=' + Date.now(),
            radionami: 'https://relay.radionami.com/any-anime.ru'
        };

        // Read selected source and set stream URL
        let currentSource = 'anison';
        try {
            const data = await new Promise(resolve => {
                chrome.storage.local.get('animeRadioSource', resolve);
            });
            currentSource = data.animeRadioSource || 'anison';
        } catch { /* default */ }

        // Helper to send commands to the offscreen radio via background
        const radioCmd = (type, data = {}) => {
            return chrome.runtime.sendMessage({ type, ...data });
        };

        // Ensure the offscreen doc has the correct source, without interrupting if already playing
        try {
            const state = await radioCmd('RADIO_GET_STATE');
            const targetBaseUrl = STREAM_URLS[currentSource].split('?')[0];
            const currentStreamUrl = state && state.streamUrl ? state.streamUrl.split('?')[0] : '';
            
            if (!state || state.error || currentStreamUrl !== targetBaseUrl) {
                radioCmd('RADIO_SET_SOURCE', { streamUrl: STREAM_URLS[currentSource] });
            }
        } catch {
            radioCmd('RADIO_SET_SOURCE', { streamUrl: STREAM_URLS[currentSource] });
        }

        // Listen for storage changes to update UI dynamically
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.animeRadioSource) {
                const newSource = changes.animeRadioSource.newValue;
                if (newSource && newSource !== currentSource) {
                    currentSource = newSource;
                    if (currentSource === 'radionami') {
                        if (trackNameEl) trackNameEl.textContent = 'Radio Nami';
                        if (posterEl) posterEl.style.display = 'none';
                        if (durationEl) durationEl.textContent = '';
                        stopMetaPolling();
                    } else if (currentSource === 'anison') {
                        if (trackNameEl) trackNameEl.textContent = 'Anison.FM';
                        radioCmd('RADIO_GET_STATE').then(state => {
                            if (state && state.isPlaying) {
                                startMetaPolling();
                            }
                        }).catch(() => {});
                    }
                }
            }
        });

        const updateVolumeIcon = (vol) => {
            if (!volumeIcon) return;
            if (vol == 0) volumeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
            else if (vol < 0.5) volumeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
            else volumeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`;
        };

        // --- Metadata display for Anison.FM ---
        let metaInterval = null;
        let countdownInterval = null;
        let remainingSeconds = 0;

        const formatTime = (totalSec) => {
            if (totalSec <= 0) return '';
            const m = Math.floor(totalSec / 60);
            const s = totalSec % 60;
            return `${m}:${s.toString().padStart(2, '0')}`;
        };

        const parseDuration = (str) => {
            // "2:40" → 160 seconds
            if (!str) return 0;
            const parts = str.split(':').map(Number);
            if (parts.length === 2) return parts[0] * 60 + parts[1];
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
            return 0;
        };

        const startCountdown = () => {
            stopCountdown();
            countdownInterval = setInterval(() => {
                if (remainingSeconds > 0) {
                    remainingSeconds--;
                    if (durationEl) durationEl.textContent = formatTime(remainingSeconds);
                } else {
                    // Time's up — fetch fresh metadata
                    updateMetadata();
                }
            }, 1000);
        };

        const stopCountdown = () => {
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
        };

        const updateMetadata = async () => {
            if (currentSource !== 'anison') return;
            try {
                const meta = await radioCmd('RADIO_GET_METADATA');
                if (meta && !meta.error) {
                    const fullName = meta.animeName
                        ? `${meta.animeName} — ${meta.trackTitle}`
                        : (meta.trackTitle || 'Anison.FM');
                    if (trackNameEl) {
                        trackNameEl.textContent = fullName;
                        trackNameEl.title = fullName; // tooltip on hover
                    }
                    // Sync countdown from server
                    remainingSeconds = parseDuration(meta.duration);
                    if (durationEl) durationEl.textContent = formatTime(remainingSeconds);

                    if (posterEl && meta.posterUrl) {
                        posterEl.src = meta.posterUrl;
                        posterEl.style.display = 'block';
                    }
                }
            } catch {
                // Metadata fetch failed, not critical
            }
        };

        const startMetaPolling = () => {
            if (currentSource !== 'anison') return;
            updateMetadata();
            metaInterval = setInterval(updateMetadata, 10000);
            startCountdown();
        };

        const stopMetaPolling = () => {
            if (metaInterval) {
                clearInterval(metaInterval);
                metaInterval = null;
            }
            stopCountdown();
        };

        // Set default label based on source
        if (currentSource === 'radionami') {
            if (trackNameEl) trackNameEl.textContent = 'Radio Nami';
            if (posterEl) posterEl.style.display = 'none';
            if (durationEl) durationEl.textContent = '';
        }

        // Restore UI from offscreen state
        try {
            const state = await radioCmd('RADIO_GET_STATE');
            if (state && !state.error) {
                if (state.isPlaying) {
                    playBtn.style.display = 'none';
                    stopBtn.style.display = 'inline-flex';
                    startMetaPolling();
                }
                if (volumeSlider) {
                    volumeSlider.value = state.isMuted ? 0 : state.volume;
                }
                updateVolumeIcon(state.isMuted ? 0 : state.volume);
            }
        } catch {
            // Offscreen not created yet — that's fine, defaults are used
        }

        playBtn.addEventListener('mousedown', () => {
            radioCmd('RADIO_PLAY');
            playBtn.style.display = 'none';
            stopBtn.style.display = 'inline-flex';
            startMetaPolling();
        });

        stopBtn.addEventListener('mousedown', () => {
            radioCmd('RADIO_STOP');
            stopBtn.style.display = 'none';
            playBtn.style.display = 'inline-flex';
            stopMetaPolling();
            if (currentSource === 'anison') {
                if (trackNameEl) trackNameEl.textContent = 'Anison.FM';
            } else {
                if (trackNameEl) trackNameEl.textContent = 'Radio Nami';
            }
            if (durationEl) durationEl.textContent = '';
        });

        // Volume control
        if (volumeSlider && volumeIcon) {
            volumeSlider.addEventListener('input', (e) => {
                const vol = parseFloat(e.target.value);
                radioCmd('RADIO_SET_VOLUME', { volume: vol });
                if (vol > 0) radioCmd('RADIO_SET_MUTED', { muted: false });
                updateVolumeIcon(vol);
            });

            // Toggle mute on icon click
            volumeIcon.addEventListener('mousedown', async () => {
                try {
                    const state = await radioCmd('RADIO_GET_STATE');
                    const newMuted = !state.isMuted;
                    radioCmd('RADIO_SET_MUTED', { muted: newMuted });
                    if (newMuted) {
                        updateVolumeIcon(0);
                        volumeSlider.value = 0;
                    } else {
                        updateVolumeIcon(state.volume);
                        volumeSlider.value = state.volume;
                    }
                } catch (e) {
                    console.warn('Radio mute toggle error:', e);
                }
            });
            volumeIcon.style.cursor = 'pointer';
        }
    }

    initializeCollectionService() {
        if (typeof CollectionService !== 'undefined') {
            this.collectionService = new CollectionService();
        } else {
            setTimeout(() => {
                if (typeof CollectionService !== 'undefined') {
                    this.collectionService = new CollectionService();
                }
            }, 200);
        }
    }





    async showCollectionSelector(movieId, buttonElement) {
        if (!this.collectionService) {
            this.initializeCollectionService();
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!this.collectionService) {
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Collection service not available', 'error');
            }
            return;
        }

        const collections = await this.collectionService.getCollections();
        const movieCollections = await this.collectionService.getCollectionsForMovie(movieId);

        const modal = document.createElement('div');
        modal.className = 'collection-selector-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        modal.innerHTML = `
            <div style="
                background: #1e293b;
                padding: 24px;
                border-radius: 12px;
                max-width: 500px;
                width: 90%;
                color: #e2e8f0;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
                max-height: 80vh;
                overflow-y: auto;
            ">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                    <h3 style="margin: 0; font-size: 20px;">Add to Collections</h3>
                    <button class="modal-close-btn" style="
                        background: none;
                        border: none;
                        color: #94a3b8;
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
                ${collections.length === 0 ? `
                    <div style="text-align: center; padding: 20px; color: #94a3b8;">
                        <p>No collections yet. Create one from the navigation menu!</p>
                    </div>
                ` : `
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        ${collections.map(collection => {
                            const isInCollection = movieCollections.some(c => c.id === collection.id);
                            const isCustomIcon = collection.icon && (collection.icon.startsWith('data:') || collection.icon.startsWith('https://') || collection.icon.startsWith('http://'));
                            const iconHtml = isCustomIcon 
                                ? `<img src="${collection.icon}" style="width: 22px; height: 22px; object-fit: cover; border-radius: 4px; vertical-align: middle;">`
                                : collection.icon;
                            return `
                                <label style="
                                    display: flex;
                                    align-items: center;
                                    gap: 12px;
                                    padding: 12px;
                                    border-radius: 8px;
                                    background: ${isInCollection ? '#1e3a5f' : '#0f172a'};
                                    cursor: pointer;
                                    transition: background 0.2s;
                                ">
                                    <input type="checkbox" 
                                           ${isInCollection ? 'checked' : ''} 
                                           data-collection-id="${collection.id}"
                                           style="width: 18px; height: 18px; cursor: pointer;">
                                    <span style="font-size: 20px; display: flex; align-items: center; justify-content: center;">${iconHtml}</span>
                                    <span style="flex: 1; font-weight: 500;">${this.escapeHtml(collection.name)}</span>
                                    <span style="color: #94a3b8; font-size: 12px;">(${collection.movieIds?.length || 0})</span>
                                </label>
                            `;
                        }).join('')}
                    </div>
                `}
                <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px;">
                    <button type="button" id="cancelCollectionSelectorBtn" style="
                        background: #334155;
                        color: #e2e8f0;
                        border: none;
                        padding: 10px 16px;
                        border-radius: 8px;
                        cursor: pointer;
                        font-weight: 500;
                    ">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.querySelector('.modal-close-btn').addEventListener('mousedown', close);
        modal.querySelector('#cancelCollectionSelectorBtn').addEventListener('mousedown', close);
        modal.addEventListener('mousedown', (e) => {
            if (e.target === modal) close();
        });

        const checkboxes = modal.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', async (e) => {
                const collectionId = checkbox.dataset.collectionId;
                const isChecked = checkbox.checked;

                try {
                    if (isChecked) {
                        await this.collectionService.addMovieToCollection(collectionId, movieId);
                    } else {
                        await this.collectionService.removeMovieFromCollection(collectionId, movieId);
                    }


                    
                    if (typeof window.collectionPage !== 'undefined' && window.collectionPage.collectionId === collectionId) {
                        await window.collectionPage.loadCollection();
                    }

                    const label = checkbox.closest('label');
                    if (isChecked) {
                        label.style.background = '#1e3a5f';
                    } else {
                        label.style.background = '#0f172a';
                    }

                    const countSpan = label.querySelector('span:last-child');
                    const updatedCollections = await this.collectionService.getCollections();
                    const collection = updatedCollections.find(c => c.id === collectionId);
                    if (countSpan && collection) {
                        countSpan.textContent = `(${collection.movieIds?.length || 0})`;
                    }

                    if (typeof Utils !== 'undefined' && Utils.showToast) {
                        Utils.showToast(
                            isChecked ? 'Фильм добавлен в коллекцию' : 'Фильм удален из коллекции',
                            'success'
                        );
                    }
                } catch (error) {
                    console.error('Error toggling movie in collection:', error);
                    checkbox.checked = !isChecked;
                    if (typeof Utils !== 'undefined' && Utils.showToast) {
                        Utils.showToast('Failed to update collection', 'error');
                    }
                }
            });
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async updateCounts() {
        await Promise.all([
            this.updateWatchlistCount(),
            this.updateFavoritesCount(),
            this.updateWatchingCount()
        ]);
    }


    async updateWatchingCount() {
        try {
            if (typeof firebaseManager === 'undefined') {
                return;
            }

            const countElement = document.getElementById('watchingCount');
            if (!countElement) return;

            const user = firebaseManager.getCurrentUser();
            if (!user) {
                countElement.textContent = '(0)';
                return;
            }

            const watchingService = firebaseManager.getWatchingService();
            if (watchingService) {
                const count = await watchingService.getWatchingCount(user.uid);
                if (countElement) {
                    countElement.textContent = `(${count})`;
                }
            }
        } catch (error) {
            console.error('Error updating watching count:', error);
        }
    }

    async updateWatchlistCount() {
        try {
            if (typeof firebaseManager === 'undefined') {
                return;
            }

            const countElement = document.getElementById('watchlistCount');
            if (!countElement) return;

            const user = firebaseManager.getCurrentUser();
            if (!user) {
                countElement.textContent = '(0)';
                return;
            }

            // check if service is available before calling
            try {
                const watchlistService = firebaseManager.getWatchlistService();
                if (watchlistService) {
                    const count = await watchlistService.getWatchlistCount(user.uid);
                    if (countElement) {
                        countElement.textContent = `(${count})`;
                    }
                }
            } catch (e) {
                console.warn('WatchlistService not available:', e.message);
            }
        } catch (error) {
            console.error('Error updating watchlist count:', error);
        }
    }

    async updateFavoritesCount() {
        try {
            if (typeof firebaseManager === 'undefined') {
                return;
            }

            const countElement = document.getElementById('favoritesCount');
            if (!countElement) return;

            const user = firebaseManager.getCurrentUser();
            if (!user) {
                const countElement = document.getElementById('favoritesCount');
                if (countElement) {
                    countElement.textContent = '(0)';
                }
                return;
            }

            const favoriteService = firebaseManager.getFavoriteService();
            if (favoriteService) {
                const count = await favoriteService.getFavoritesCount(user.uid);
                const countElement = document.getElementById('favoritesCount');
                if (countElement) {
                    countElement.textContent = `(${count})`;
                }
            }
        } catch (error) {
            console.error('Error updating favorites count:', error);
        }
    }

    setupAuthListener() {
        // Listen for auth state changes via firebaseManager
        if (typeof firebaseManager !== 'undefined') {
            // console.log('Navigation: Firebase Manager available, setting up auth listener');
            window.addEventListener('authStateChanged', (e) => {
                if (e.detail?.fromAuthModal) return;
                const user = e.detail.user;
                // console.log('Navigation: Firebase auth state changed:', user ? (user.displayName || user.email) : 'No user');
                this.updateUserDisplay(user);
            });
            
            // Also check current user immediately
            const currentUser = firebaseManager.getCurrentUser();
            if (currentUser) {
                // console.log('Navigation: Found current Firebase user:', currentUser.displayName || currentUser.email);
                this.updateUserDisplay(currentUser);
            }
        } else {
            // Fallback for pages without firebaseManager
            // console.log('Navigation: Firebase Manager not available, setting up fallback');
            setTimeout(() => {
                if (typeof firebaseManager !== 'undefined') {
                    // console.log('Navigation: Firebase Manager became available');
                    window.addEventListener('authStateChanged', (e) => {
                        if (e.detail?.fromAuthModal) return;
                        const user = e.detail.user;
                        // console.log('Navigation: Firebase auth state changed (delayed):', user ? (user.displayName || user.email) : 'No user');
                        this.updateUserDisplay(user);
                    });
                    
                    // Check current user
                    const currentUser = firebaseManager.getCurrentUser();
                    if (currentUser) {
                        // console.log('Navigation: Found current Firebase user (delayed):', currentUser.displayName || currentUser.email);
                        this.updateUserDisplay(currentUser);
                    }
                } else {
                    // If no firebaseManager, check chrome.storage periodically
                    // console.log('Navigation: Firebase Manager still not available, using storage fallback');
                    this.startStorageAuthCheck();
                }
            }, 1000);
        }

        // Also check chrome.storage for auth state
        this.checkStorageAuth();
        
        // Listen for storage changes to sync auth state across pages
        this.setupStorageListener();
        
        // Listen for firebaseManagerReady event
        window.addEventListener('firebaseManagerReady', () => {
            // console.log('Navigation: Received firebaseManagerReady event');
            if (typeof firebaseManager !== 'undefined') {
                const currentUser = firebaseManager.getCurrentUser();
                if (currentUser) {
                    // console.log('Navigation: Found user after firebaseManagerReady:', currentUser.displayName || currentUser.email);
                    this.updateUserDisplay(currentUser);
                }
            }
        });
    }

    async checkStorageAuth() {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage) {
                const result = await chrome.storage.local.get(['user', 'isAuthenticated', 'authTimestamp']);
                
                if (result.isAuthenticated && result.user) {
                    // Check if auth data is not too old (max 24 hours)
                    const authAge = Date.now() - (result.authTimestamp || 0);
                    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
                    
                    if (authAge < maxAge) {
                        // User is authenticated according to storage
                        // console.log('Navigation: Found valid auth in storage:', result.user.displayName || result.user.email);
                        this.updateUserDisplay(result.user);
                        return;
                    } else {
                        // Auth data is too old, clear it
                        await chrome.storage.local.set({
                            user: null,
                            isAuthenticated: false,
                            authTimestamp: null
                        });
                    }
                }
                
                // Not authenticated or auth expired
                // console.log('Navigation: No valid auth found in storage');
                this.updateUserDisplay(null);
            }
        } catch (error) {
            console.log('Chrome storage not available or error:', error);
        }
    }

    setupStorageListener() {
        // Listen for chrome.storage changes to sync auth state across pages
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, namespace) => {
                if (namespace === 'local' && (changes.user || changes.isAuthenticated)) {
                    // console.log('Navigation: Storage auth state changed, updating display');
                    this.checkStorageAuth();
                }
            });
        }
    }

    startStorageAuthCheck() {
        // Check auth state every 5 seconds if firebaseManager is not available
        this.authCheckInterval = setInterval(() => {
            this.checkStorageAuth();
        }, 5000);
    }

    stopStorageAuthCheck() {
        if (this.authCheckInterval) {
            clearInterval(this.authCheckInterval);
            this.authCheckInterval = null;
        }
    }

    async updateUserDisplay(user) {
        // Prevent multiple simultaneous updates (race condition protection)
        if (this._updateInProgress) {
            // console.log('Navigation: Update already in progress, skipping');
            return;
        }
        this._updateInProgress = true;

        try {
            this.user = user;
            const userProfile = document.getElementById('navUserProfile');
            const userAvatar = document.getElementById('navUserAvatar');
            const userName = document.getElementById('navUserName');
            const signInBtn = document.getElementById('navSignInBtn');

            // console.log('Navigation: Updating user display:', user ? (user.displayName || user.email) : 'No user');

            if (user && userProfile && userName) {
                // Show user profile dropdown
                userProfile.style.display = 'block';
                if (signInBtn) signInBtn.style.display = 'none';

                // Get display name based on user preference
                let displayText = user.displayName || user.email || 'User';
                let photoURL = user.photoURL || null;
                
                // Try to get from cache first for immediate update
                try {
                    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                        const cacheKey = `user_profile_${user.uid}`;
                        const cachedResult = await chrome.storage.local.get([cacheKey]);
                        const cachedProfile = cachedResult[cacheKey];

                        if (cachedProfile) {
                            const displayNameFormat = cachedProfile.displayNameFormat || 'fullname';
                            
                            if (displayNameFormat === 'username' && cachedProfile.username) {
                                displayText = cachedProfile.username;
                            } else {
                                const firstName = cachedProfile.firstName || '';
                                const lastName = cachedProfile.lastName || '';
                                const fullName = [firstName, lastName].filter(Boolean).join(' ');
                                if (fullName) {
                                    displayText = fullName;
                                } else {
                                    displayText = cachedProfile.displayName || user.displayName || user.email || 'User';
                                }
                            }
                            // Use cached photoURL if available
                            if (cachedProfile.photoURL) {
                                photoURL = cachedProfile.photoURL;
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error loading cached profile:', error);
                }

                if (typeof firebaseManager !== 'undefined' && firebaseManager.getUserService) {
                    try {
                        const userService = firebaseManager.getUserService();
                        const profile = await userService.getUserProfile(user.uid);
                        
                        if (profile) {
                            // Check if user is pending or rejected
                            if (profile.approvalStatus === 'pending' || profile.approvalStatus === 'rejected') {
                                console.warn(`[Navigation] User status is "${profile.approvalStatus}", revoking active session`);
                                this._updateInProgress = false;
                                await this.handleLogout(false);
                                await this.showAuthModal('approval', { status: profile.approvalStatus, isNewRegistration: false });
                                return;
                            }

                            const displayNameFormat = profile.displayNameFormat || 'fullname';
                            
                            if (displayNameFormat === 'username' && profile.username) {
                                displayText = profile.username;
                            } else {
                                const firstName = profile.firstName || '';
                                const lastName = profile.lastName || '';
                                const fullName = [firstName, lastName].filter(Boolean).join(' ');
                                if (fullName) {
                                    displayText = fullName;
                                } else {
                                    displayText = profile.displayName || user.displayName || user.email || 'User';
                                }
                            }
                            // Use profile photoURL if available
                            if (profile.photoURL) {
                                photoURL = profile.photoURL;
                            }
                        }
                    } catch (error) {
                        console.error('Error loading user profile for display:', error);
                    }
                }

                userName.textContent = displayText;
                
                // Determine final avatar URL
                let finalAvatarUrl;
                if (photoURL) {
                    finalAvatarUrl = photoURL;
                } else if (user.photoURL) {
                    finalAvatarUrl = user.photoURL;
                } else {
                    // Use default avatar if no photo
                    finalAvatarUrl = chrome.runtime.getURL('src/shared/assets/icons/app/icon48.png');
                }
                
                if (userAvatar) {
                    userAvatar.src = finalAvatarUrl;
                }

                // Save to display cache for instant loading on next page visit
                try {
                    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                        const cacheData = {
                            displayName: displayText,
                            photoURL: finalAvatarUrl,
                            uid: user.uid,
                            timestamp: Date.now()
                        };
                        await chrome.storage.local.set({
                            [Navigation.USER_DISPLAY_CACHE_KEY]: cacheData
                        });
                        this.cachedUserDisplay = cacheData;
                        // console.log('Navigation: Saved user display cache:', displayText);
                    }
                } catch (error) {
                    console.warn('Navigation: Could not save user display cache:', error);
                }

                // Show/hide Admin Panel menu item based on admin status
                const adminMenuItem = document.getElementById('navDropdownAdmin');
                if (adminMenuItem) {
                    try {
                        if (typeof firebaseManager !== 'undefined' && firebaseManager.getUserService) {
                            const userService = firebaseManager.getUserService();
                            const profile = await userService.getUserProfile(user.uid);
                            
                            if (profile && profile.isAdmin === true) {
                                adminMenuItem.style.display = 'flex';
                            } else {
                                adminMenuItem.style.display = 'none';
                            }
                        } else {
                            adminMenuItem.style.display = 'none';
                        }
                    } catch (error) {
                        console.error('Error checking admin status:', error);
                        adminMenuItem.style.display = 'none';
                    }
                }

                // Update watchlist and favorites counts when user is logged in
                this.updateWatchlistCount();
                this.updateFavoritesCount();
            } else {
                // Hide user profile, show sign in button
                if (userProfile) userProfile.style.display = 'none';
                if (signInBtn) signInBtn.style.display = 'flex';
                
                // Reset watchlist and favorites counts
                const watchlistCountElement = document.getElementById('watchlistCount');
                if (watchlistCountElement) {
                    watchlistCountElement.textContent = '(0)';
                }
                const favoritesCountElement = document.getElementById('favoritesCount');
                if (favoritesCountElement) {
                    favoritesCountElement.textContent = '(0)';
                }
            }
        } finally {
            this._updateInProgress = false;
        }
    }

    setActivePage(page) {
        // Remove active class from all links
        const navLinks = document.querySelectorAll('.nav-link, .nav-icon-btn[data-page]');
        navLinks.forEach(link => {
            link.classList.remove('active');
        });

        // Add active class to current page
        const activeLink = document.querySelector(`[data-page="${page}"]`);
        if (activeLink) {
            activeLink.classList.add('active');
        }

        this.currentPage = page;
    }

    navigateToPage(page) {
        // console.log(`[Navigation] navigateToPage called with page: ${page}`);
        
        const url = this.getPageUrl(page);
        if (!url || url === '#') {
            console.warn(`[Navigation] No valid URL found for page: ${page}`);
            return;
        }

        // Check if we're in popup context
        if (window.location.pathname.includes('popup.html')) {
            // console.log('[Navigation] Context: Popup, opening in new tab');
            if (url && chrome.tabs) {
                chrome.tabs.create({ url });
            }
            return;
        }

        // For extension pages, use simple navigation on same tab
        // console.log('[Navigation] Context: Extension Page, navigating current tab');
        window.location.href = url;
    }

    showProfileModal() {
        const modal = document.createElement('div');
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

        const user = (typeof firebaseManager !== 'undefined') ? firebaseManager.getCurrentUser() : null;
        const email = user ? (user.email || '') : '';
        const displayName = user ? (user.displayName || '') : '';
        const firstName = displayName.includes(' ') ? displayName.split(' ')[0] : displayName;
        const lastName = displayName.includes(' ') ? displayName.split(' ').slice(1).join(' ') : '';
        const photoURL = user && user.photoURL ? user.photoURL : '';
        const isGoogle = user && Array.isArray(user.providerData) && user.providerData.some(p => p.providerId === 'google.com');

        modal.innerHTML = `
            <div style="
                background: #0f172a;
                padding: 24px;
                border-radius: 12px;
                max-width: 560px;
                width: 92%;
                color: #e2e8f0;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35);
            ">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
                    <h3 style="margin:0; font-size:20px;">Edit Profile</h3>
                    <button id="profileCloseBtn" style="background:#334155; color:#e2e8f0; border:none; padding:8px 12px; border-radius:8px; cursor:pointer;">Close</button>
                </div>

                <form id="profileForm" style="display:flex; flex-direction:column; gap:12px;">
                    <div style="display:flex; gap:16px; align-items:center;">
                        <div style="width:84px; height:84px; border-radius:50%; overflow:hidden; background:#1f2937; display:flex; align-items:center; justify-content:center;">
                            <img id="avatarPreview" src="${photoURL || ''}" alt="avatar" style="width:100%; height:100%; object-fit:cover; display:${photoURL ? 'block' : 'none'};">
                            <div id="avatarPlaceholder" style="display:${photoURL ? 'none' : 'flex'}; width:100%; height:100%; align-items:center; justify-content:center; font-weight:600; color:#94a3b8;">${(firstName||'U').slice(0,1)}${(lastName||'').slice(0,1)}</div>
                        </div>
                        <div>
                            <input id="avatarInput" type="file" accept="image/png,image/jpeg,image/webp" style="display:none;">
                            <button id="uploadAvatarBtn" type="button" style="background:#6366f1; color:#fff; border:none; padding:8px 12px; border-radius:8px; cursor:pointer;">Upload Avatar</button>
                            <span style="margin-left:8px; color:#94a3b8; font-size:12px;">JPG/PNG/WEBP · max 5MB</span>
                        </div>
                    </div>

                    <div style="display:flex; gap:12px;">
                        <input id="firstNameInput" type="text" placeholder="First Name" value="${firstName}" style="flex:1; padding:10px 12px; border-radius:8px; border:1px solid #334155; background:#0b1220; color:#e2e8f0;">
                        <input id="lastNameInput" type="text" placeholder="Last Name" value="${lastName}" style="flex:1; padding:10px 12px; border-radius:8px; border:1px solid #334155; background:#0b1220; color:#e2e8f0;">
                    </div>

                    <input id="emailInput" type="email" value="${email}" ${user ? 'disabled' : ''} style="padding:10px 12px; border-radius:8px; border:1px solid #334155; background:#111827; color:#9ca3af;">

                    <div id="passwordSection" style="display:${isGoogle ? 'none' : 'block'}; border-top:1px solid #1f2937; padding-top:8px; margin-top:8px;">
                        <button id="togglePasswordChange" type="button" style="background:#334155; color:#e2e8f0; border:none; padding:8px 12px; border-radius:8px; cursor:pointer;">Change Password</button>
                        <div id="passwordFields" style="display:none; margin-top:8px; display:flex; flex-direction:column; gap:8px;">
                            <input id="currentPasswordInput" type="password" placeholder="Current Password" style="padding:10px 12px; border-radius:8px; border:1px solid #334155; background:#0b1220; color:#e2e8f0;">
                            <input id="newPasswordInput" type="password" placeholder="New Password (min 6 chars)" minlength="6" style="padding:10px 12px; border-radius:8px; border:1px solid #334155; background:#0b1220; color:#e2e8f0;">
                            <input id="confirmPasswordInput" type="password" placeholder="Confirm New Password" minlength="6" style="padding:10px 12px; border-radius:8px; border:1px solid #334155; background:#0b1220; color:#e2e8f0;">
                        </div>
                    </div>

                    <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:8px;">
                        <button type="button" id="cancelProfileBtn" style="background:#334155; color:#e2e8f0; border:none; padding:10px 16px; border-radius:8px; cursor:pointer;">Cancel</button>
                        <button type="submit" id="saveProfileBtn" style="background:#22c55e; color:#062e0f; border:none; padding:10px 16px; border-radius:8px; cursor:pointer; font-weight:600;">Save Changes</button>
                    </div>
                </form>
                <div id="profileNotice" style="margin-top:8px; font-size:12px; color:#94a3b8; ${isGoogle ? 'display:block' : 'display:none'};">Email and password are managed by Google.</div>
                <div id="profileToast" style="display:none; margin-top:8px; padding:8px 12px; border-radius:8px;"></div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
        modal.querySelector('#profileCloseBtn').addEventListener('mousedown', close);
        modal.querySelector('#cancelProfileBtn').addEventListener('mousedown', close);

        const avatarInput = modal.querySelector('#avatarInput');
        const avatarPreview = modal.querySelector('#avatarPreview');
        const avatarPlaceholder = modal.querySelector('#avatarPlaceholder');
        const uploadBtn = modal.querySelector('#uploadAvatarBtn');

        uploadBtn.addEventListener('mousedown', () => avatarInput.click());
        avatarInput.addEventListener('change', () => {
            const file = avatarInput.files && avatarInput.files[0];
            if (!file) return;
            const valid = ['image/jpeg','image/png','image/webp'].includes(file.type) && file.size <= 5 * 1024 * 1024;
            if (!valid) { alert('Invalid file. Use JPG/PNG/WEBP up to 5MB.'); avatarInput.value=''; return; }
            const reader = new FileReader();
            reader.onload = () => {
                avatarPreview.src = reader.result;
                avatarPreview.style.display = 'block';
                avatarPlaceholder.style.display = 'none';
            };
            reader.readAsDataURL(file);
        });

        const toggleBtn = modal.querySelector('#togglePasswordChange');
        const fields = modal.querySelector('#passwordFields');
        if (toggleBtn) toggleBtn.addEventListener('mousedown', () => { fields.style.display = fields.style.display === 'none' ? 'flex' : 'none'; });

        modal.querySelector('#profileForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (typeof firebaseManager !== 'undefined' && firebaseManager.waitForAuthReady) {
                await firebaseManager.waitForAuthReady();
            }
            const first = modal.querySelector('#firstNameInput').value.trim();
            const last = modal.querySelector('#lastNameInput').value.trim();
            let name = [first, last].filter(Boolean).join(' ');
            if (!name) {
                const current = firebaseManager.getCurrentUser();
                name = current && (current.displayName || current.email || 'User');
            }

            let photo = photoURL;
            const file = avatarInput.files && avatarInput.files[0];
            if (file) {
                try {
                    photo = await firebaseManager.uploadAvatar(file);
                } catch {
                    alert('Avatar upload failed');
                    return;
                }
            }

            const toast = modal.querySelector('#profileToast');
            const setToast = (ok, msg) => {
                toast.style.display = 'block';
                toast.style.background = ok ? '#16a34a' : '#dc2626';
                toast.style.color = '#fff';
                toast.textContent = msg;
            };

            try {
                await firebaseManager.updateAuthProfile({ displayName: name, photoURL: photo });
                const userNow = firebaseManager.getCurrentUser();
                if (typeof UserService !== 'undefined') {
                    const userService = firebaseManager.getUserService();
                    await userService.updateUserProfile(userNow.uid, { displayName: name, photoURL: photo, email: userNow.email });
                }

                if (!isGoogle && fields.style.display !== 'none') {
                    const currentPw = modal.querySelector('#currentPasswordInput').value;
                    const newPw = modal.querySelector('#newPasswordInput').value;
                    const confirmPw = modal.querySelector('#confirmPasswordInput').value;
                    if (newPw && newPw === confirmPw) {
                        await firebaseManager.changePasswordWithReauth(currentPw, newPw);
                    } else if (newPw || confirmPw) {
                        setToast(false, 'Password confirmation does not match');
                        return;
                    }
                }

                setToast(true, 'Profile saved');
                setTimeout(close, 600);
                this.updateUserDisplay(firebaseManager.getCurrentUser());
            } catch (error) {
                console.error('Profile save failed:', error);
                setToast(false, (error && error.message) ? `Save failed: ${error.message}` : 'Save failed');
            }
        });
    }

    getCustomThemes() {
        try {
            const raw = localStorage.getItem('movieExtensionCustomThemes');
            return raw ? JSON.parse(raw) : [];
        } catch (error) {
            console.error('Error reading custom themes from localStorage:', error);
            return [];
        }
    }

    saveCustomThemes(customThemes) {
        try {
            localStorage.setItem('movieExtensionCustomThemes', JSON.stringify(customThemes));
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ customThemes });
            }
        } catch (error) {
            console.error('Error saving custom themes to localStorage:', error);
        }
    }

    getCurrentTheme() {
        try {
            const savedTheme = localStorage.getItem('movieExtensionTheme');
            return savedTheme || 'dark';
        } catch (error) {
            console.error('Error reading theme from localStorage:', error);
            return 'dark';
        }
    }

    applyTheme(theme) {
        try {
            let isLight = theme === 'light';
            let customTheme = null;

            if (theme && theme.startsWith('custom_')) {
                const customs = this.getCustomThemes();
                customTheme = customs.find(t => t.id === theme);
                if (customTheme) {
                    isLight = customTheme.base === 'light';
                }
            }

            // Apply theme class to document root and body
            if (isLight) {
                document.documentElement.classList.add('light-theme');
                if (document.body) document.body.classList.add('light-theme');
            } else {
                document.documentElement.classList.remove('light-theme');
                if (document.body) document.body.classList.remove('light-theme');
            }

            // Apply custom CSS variables or reset to stylesheet defaults
            const customVariablesList = [
                '--theme-bg-primary',
                '--theme-bg-secondary',
                '--theme-bg-tertiary',
                '--theme-bg-card',
                '--theme-text-primary',
                '--theme-text-secondary',
                '--theme-text-muted',
                '--theme-border',
                '--theme-input-bg',
                '--theme-input-text',
                '--theme-hover-bg',
                '--theme-active-bg',
                '--accent-color'
            ];

            if (customTheme && customTheme.variables) {
                Object.keys(customTheme.variables).forEach(varName => {
                    document.documentElement.style.setProperty(varName, customTheme.variables[varName]);
                });
            } else {
                customVariablesList.forEach(v => document.documentElement.style.removeProperty(v));
            }

            // Save active theme to localStorage & chrome.storage
            localStorage.setItem('movieExtensionTheme', theme);
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ theme });
            }

            // Update extension icon
            if (typeof IconUtils !== 'undefined') {
                IconUtils.updateExtensionIcon(isLight ? 'light' : 'dark');
                const navLogoImg = document.querySelector('#navLogo img');
                if (navLogoImg) {
                    navLogoImg.src = chrome.runtime.getURL(IconUtils.getIconPath(isLight ? 'light' : 'dark', 48));
                }
            }

            // Update theme button text and icon
            this.updateThemeButton(theme);
        } catch (error) {
            console.error('Error applying theme:', error);
        }
    }

    updateThemeButton(theme) {
        const themeText = document.getElementById('navThemeText');
        const themeIcon = document.getElementById('navThemeIcon');
        
        if (themeText) {
            if (theme === 'dark') {
                themeText.textContent = 'Theme (Dark)';
            } else if (theme === 'light') {
                themeText.textContent = 'Theme (Light)';
            } else {
                const customs = this.getCustomThemes();
                const ct = customs.find(t => t.id === theme);
                themeText.textContent = `Theme (${ct ? ct.name : 'Custom'})`;
            }
        }

        if (themeIcon) {
            if (theme === 'light') {
                themeIcon.innerHTML = typeof Icons !== 'undefined' && Icons.SUN ? Icons.SUN : `
                    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" style="width: 16px; height: 16px;">
                        <path d="M12.002 1a.9.9 0 0 1 .9.9v2.2a.9.9 0 0 1-1.8 0V1.9a.9.9 0 0 1 .9-.9m.002 18a.9.9 0 0 1 .9.9v2.2a.9.9 0 0 1-1.8 0v-2.2a.9.9 0 0 1 .9-.9M4.661 8.884a.9.9 0 0 0 .9-1.559L3.355 6.128a.9.9 0 0 0-.9 1.559zm17.223 8.663a.9.9 0 0 1-1.23.33l-2.205-1.193a.9.9 0 1 1 .9-1.56l2.205 1.193a.9.9 0 0 1 .33 1.23m-3.43-10.23a.9.9 0 1 0 .9 1.56l2.198-1.197a.9.9 0 1 0-.9-1.558zM2.128 17.547a.9.9 0 0 1 .33-1.23l2.191-1.2a.9.9 0 0 1 .9 1.559l-2.19 1.2a.9.9 0 0 1-1.23-.33ZM12.004 7a5 5 0 0 0-3.536 1.464A4.98 4.98 0 0 0 7.003 12c0 1.38.56 2.63 1.465 3.536A4.99 4.99 0 0 0 12.004 17c1.382 0 2.632-.56 3.537-1.464A4.98 4.98 0 0 0 17.006 12c0-1.38-.56-2.63-1.465-3.536A4.99 4.99 0 0 0 12.004 7M9.741 9.737a3.19 3.19 0 0 1 2.263-.937c.885 0 1.683.356 2.264.937s.938 1.379.938 2.263-.357 1.682-.938 2.263a3.19 3.19 0 0 1-2.264.937 3.19 3.19 0 0 1-2.263-.937A3.18 3.18 0 0 1 8.803 12c0-.884.357-1.682.938-2.263" clip-rule="evenodd"></path>
                    </svg>
                `;
            } else if (theme === 'dark') {
                themeIcon.innerHTML = typeof Icons !== 'undefined' && Icons.MOON ? Icons.MOON : `
                    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20" style="width: 16px; height: 16px;">
                        <path fill-rule="evenodd" d="M10.606 1.987a.75.75 0 0 1-.217.835 5.795 5.795 0 0 0 6.387 9.58.75.75 0 0 1 1.031.965A8.502 8.502 0 0 1 1.5 10a8.5 8.5 0 0 1 8.395-8.5.75.75 0 0 1 .711.487M8.004 3.288a7 7 0 1 0 7.421 11.137A7.295 7.295 0 0 1 8.004 3.288" clip-rule="evenodd"></path>
                    </svg>
                `;
            } else {
                themeIcon.innerHTML = typeof Icons !== 'undefined' && Icons.PALETTE ? Icons.PALETTE : `
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                `;
            }
        }
    }

    showThemeModal() {
        let currentTheme = this.getCurrentTheme();
        let customThemes = this.getCustomThemes();

        // Helper to get active color scheme values
        const getActiveColors = () => {
            const computedStyle = getComputedStyle(document.documentElement);
            return {
                primaryBg: computedStyle.getPropertyValue('--theme-bg-primary').trim() || '#09090b',
                secondaryBg: computedStyle.getPropertyValue('--theme-bg-secondary').trim() || '#121214',
                cardBg: computedStyle.getPropertyValue('--theme-bg-card').trim() || 'rgba(18, 18, 20, 0.65)',
                textPrimary: computedStyle.getPropertyValue('--theme-text-primary').trim() || '#f4f4f5',
                textSecondary: computedStyle.getPropertyValue('--theme-text-secondary').trim() || '#a1a1aa',
                textMuted: computedStyle.getPropertyValue('--theme-text-muted').trim() || '#52525b',
                border: computedStyle.getPropertyValue('--theme-border').trim() || 'rgba(255, 255, 255, 0.06)',
                inputBg: computedStyle.getPropertyValue('--theme-input-bg').trim() || '#121214',
                inputText: computedStyle.getPropertyValue('--theme-input-text').trim() || '#f4f4f5',
                accentColor: computedStyle.getPropertyValue('--accent-color').trim() || '#6366f1'
            };
        };

        // Convert color format to hex for <input type="color">
        const toHexColor = (colorStr, fallback = '#121214') => {
            if (!colorStr) return fallback;
            colorStr = colorStr.trim();
            if (colorStr.startsWith('#')) {
                if (colorStr.length === 4) {
                    return '#' + colorStr[1] + colorStr[1] + colorStr[2] + colorStr[2] + colorStr[3] + colorStr[3];
                }
                return colorStr.slice(0, 7);
            }
            if (colorStr.startsWith('rgb')) {
                const parts = colorStr.match(/\d+/g);
                if (parts && parts.length >= 3) {
                    const r = parseInt(parts[0]).toString(16).padStart(2, '0');
                    const g = parseInt(parts[1]).toString(16).padStart(2, '0');
                    const b = parseInt(parts[2]).toString(16).padStart(2, '0');
                    return `#${r}${g}${b}`;
                }
            }
            return fallback;
        };

        const modal = document.createElement('div');
        modal.className = 'theme-modal-overlay';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.75);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            animation: fadeIn 0.2s ease;
            backdrop-filter: blur(4px);
        `;

        const renderModalHTML = () => {
            currentTheme = this.getCurrentTheme();
            customThemes = this.getCustomThemes();
            const isLight = document.documentElement.classList.contains('light-theme');

            const checkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            const plusIcon = typeof Icons !== 'undefined' && Icons.PLUS ? Icons.PLUS : '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
            const moonIcon = typeof Icons !== 'undefined' && Icons.MOON ? Icons.MOON : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10.606 1.987a.75.75 0 0 1-.217.835 5.795 5.795 0 0 0 6.387 9.58.75.75 0 0 1 1.031.965A8.502 8.502 0 0 1 1.5 10a8.5 8.5 0 0 1 8.395-8.5.75.75 0 0 1 .711.487M8.004 3.288a7 7 0 1 0 7.421 11.137A7.295 7.295 0 0 1 8.004 3.288" clip-rule="evenodd"></path></svg>';
            const sunIcon = typeof Icons !== 'undefined' && Icons.SUN ? Icons.SUN : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M12.002 1a.9.9 0 0 1 .9.9v2.2a.9.9 0 0 1-1.8 0V1.9a.9.9 0 0 1 .9-.9m.002 18a.9.9 0 0 1 .9.9v2.2a.9.9 0 0 1-1.8 0v-2.2a.9.9 0 0 1 .9-.9M4.661 8.884a.9.9 0 0 0 .9-1.559L3.355 6.128a.9.9 0 0 0-.9 1.559zm17.223 8.663a.9.9 0 0 1-1.23.33l-2.205-1.193a.9.9 0 1 1 .9-1.56l2.205 1.193a.9.9 0 0 1 .33 1.23m-3.43-10.23a.9.9 0 1 0 .9 1.56l2.198-1.197a.9.9 0 1 0-.9-1.558zM2.128 17.547a.9.9 0 0 1 .33-1.23l2.191-1.2a.9.9 0 0 1 .9 1.559l-2.19 1.2a.9.9 0 0 1-1.23-.33ZM12.004 7a5 5 0 0 0-3.536 1.464A4.98 4.98 0 0 0 7.003 12c0 1.38.56 2.63 1.465 3.536A4.99 4.99 0 0 0 12.004 17c1.382 0 2.632-.56 3.537-1.464A4.98 4.98 0 0 0 17.006 12c0-1.38-.56-2.63-1.465-3.536A4.99 4.99 0 0 0 12.004 7M9.741 9.737a3.19 3.19 0 0 1 2.263-.937c.885 0 1.683.356 2.264.937s.938 1.379.938 2.263-.357 1.682-.938 2.263a3.19 3.19 0 0 1-2.264.937 3.19 3.19 0 0 1-2.263-.937A3.18 3.18 0 0 1 8.803 12c0-.884.357-1.682.938-2.263" clip-rule="evenodd"></path></svg>';
            const paletteIcon = typeof Icons !== 'undefined' && Icons.PALETTE ? Icons.PALETTE : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.92 0 1.7-.71 1.7-1.63 0-.44-.18-.85-.46-1.15-.27-.3-.44-.71-.44-1.17 0-.92.78-1.67 1.7-1.67h2.5c2.76 0 5-2.24 5-5 0-4.97-4.48-9.38-10-9.38z"/></svg>';
            const editIcon = typeof Icons !== 'undefined' && Icons.EDIT ? Icons.EDIT : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
            const trashIcon = typeof Icons !== 'undefined' && Icons.TRASH ? Icons.TRASH : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';

            return `
                <div class="theme-modal-content" style="
                    background: var(--theme-bg-secondary, #121214);
                    padding: 24px;
                    border-radius: 14px;
                    width: 360px;
                    max-width: 92vw;
                    color: var(--theme-text-primary, #f4f4f5);
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
                    animation: scaleIn 0.2s ease;
                    border: 1px solid var(--theme-border, rgba(255, 255, 255, 0.1));
                    max-height: 90vh;
                    display: flex;
                    flex-direction: column;
                ">
                    <!-- Main Theme Selection View -->
                    <div id="themeModalMain">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                            <h3 style="margin: 0; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                                <span style="display: flex; align-items: center; justify-content: center; color: var(--accent-color, #6366f1);">${paletteIcon}</span>
                                <span data-i18n="navbar.select_theme">Select Theme</span>
                            </h3>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <button id="addCustomThemeBtn" title="Create custom theme" style="
                                    background: #6366f1;
                                    color: #ffffff;
                                    border: 1px solid rgba(255, 255, 255, 0.25);
                                    border-radius: 8px;
                                    width: 32px;
                                    height: 32px;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    cursor: pointer;
                                    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
                                    transition: all 0.2s ease;
                                ">${plusIcon}</button>
                                <button class="modal-close-btn" style="
                                    background: none;
                                    border: none;
                                    color: var(--theme-text-secondary, #a1a1aa);
                                    font-size: 24px;
                                    cursor: pointer;
                                    padding: 0;
                                    width: 32px;
                                    height: 32px;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    transition: color 0.2s;
                                ">×</button>
                            </div>
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 8px; max-height: 60vh; overflow-y: auto; padding-right: 4px;">
                            <!-- Dark Theme Option -->
                            <div class="theme-option" data-theme="dark" style="
                                display: flex;
                                align-items: center;
                                gap: 12px;
                                padding: 14px 16px;
                                border-radius: 10px;
                                background: ${currentTheme === 'dark' ? 'var(--theme-active-bg, rgba(255, 255, 255, 0.1))' : 'var(--theme-hover-bg, rgba(255, 255, 255, 0.04))'};
                                cursor: pointer;
                                transition: all 0.2s;
                                border: 2px solid ${currentTheme === 'dark' ? 'var(--accent-color, #6366f1)' : 'var(--theme-border, transparent)'};
                            ">
                                <span class="theme-option-icon" style="display: flex; align-items: center; justify-content: center; color: #a1a1aa;">${moonIcon}</span>
                                <span style="flex: 1; font-weight: 500;">Dark Theme</span>
                                <span class="theme-checkmark" style="
                                    font-size: 18px;
                                    color: var(--accent-color, #6366f1);
                                    display: ${currentTheme === 'dark' ? 'flex' : 'none'};
                                    align-items: center;
                                ">${checkIcon}</span>
                            </div>

                            <!-- Light Theme Option -->
                            <div class="theme-option" data-theme="light" style="
                                display: flex;
                                align-items: center;
                                gap: 12px;
                                padding: 14px 16px;
                                border-radius: 10px;
                                background: ${currentTheme === 'light' ? 'var(--theme-active-bg, rgba(255, 255, 255, 0.1))' : 'var(--theme-hover-bg, rgba(255, 255, 255, 0.04))'};
                                cursor: pointer;
                                transition: all 0.2s;
                                border: 2px solid ${currentTheme === 'light' ? 'var(--accent-color, #6366f1)' : 'var(--theme-border, transparent)'};
                            ">
                                <span class="theme-option-icon" style="display: flex; align-items: center; justify-content: center; color: #eab308;">${sunIcon}</span>
                                <span style="flex: 1; font-weight: 500;">Light Theme</span>
                                <span class="theme-checkmark" style="
                                    font-size: 18px;
                                    color: var(--accent-color, #6366f1);
                                    display: ${currentTheme === 'light' ? 'flex' : 'none'};
                                    align-items: center;
                                ">${checkIcon}</span>
                            </div>

                            <!-- Custom Themes List -->
                            ${customThemes.map(ct => {
                                const isSelected = currentTheme === ct.id;
                                const primaryDot = ct.variables?.['--theme-bg-primary'] || '#09090b';
                                const accentDot = ct.variables?.['--accent-color'] || '#6366f1';
                                return `
                                    <div class="theme-option custom-theme-item" data-theme="${ct.id}" style="
                                        display: flex;
                                        align-items: center;
                                        gap: 12px;
                                        padding: 12px 16px;
                                        border-radius: 10px;
                                        background: ${isSelected ? 'var(--theme-active-bg, rgba(255, 255, 255, 0.1))' : 'var(--theme-hover-bg, rgba(255, 255, 255, 0.04))'};
                                        cursor: pointer;
                                        transition: all 0.2s;
                                        border: 2px solid ${isSelected ? 'var(--accent-color, #6366f1)' : 'var(--theme-border, transparent)'};
                                    ">
                                        <div style="display: flex; align-items: center; gap: 4px;">
                                            <span style="width: 14px; height: 14px; border-radius: 50%; background: ${primaryDot}; border: 1px solid var(--theme-border, rgba(255,255,255,0.2)); display: inline-block;"></span>
                                            <span style="width: 14px; height: 14px; border-radius: 50%; background: ${accentDot}; display: inline-block;"></span>
                                        </div>
                                        <span style="flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.escapeHtml(ct.name)}</span>
                                        <div style="display: flex; align-items: center; gap: 6px;" class="custom-theme-actions">
                                            <button class="edit-custom-theme-btn" data-theme-id="${ct.id}" title="Edit Theme" style="
                                                background: none; border: none; color: var(--theme-text-secondary, #a1a1aa); cursor: pointer; padding: 4px; display: flex; align-items: center;
                                            ">${editIcon}</button>
                                            <button class="delete-custom-theme-btn" data-theme-id="${ct.id}" title="Delete Theme" style="
                                                background: none; border: none; color: #ef4444; cursor: pointer; padding: 4px; display: flex; align-items: center;
                                            ">${trashIcon}</button>
                                            <span class="theme-checkmark" style="
                                                font-size: 18px; color: var(--accent-color, #6366f1); display: ${isSelected ? 'flex' : 'none'}; align-items: center; margin-left: 4px;
                                            ">${checkIcon}</span>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>

                    <!-- Custom Theme Editor View (Hidden initially) -->
                    <div id="themeModalEditor" style="display: none; flex-direction: column; gap: 16px;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <h3 id="themeEditorTitle" style="margin: 0; font-size: 18px; font-weight: 600;">Create Custom Theme</h3>
                            <button id="cancelThemeEditorBtnTop" style="background: none; border: none; color: var(--theme-text-secondary, #a1a1aa); font-size: 20px; cursor: pointer;">×</button>
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 12px; max-height: 60vh; overflow-y: auto; padding-right: 4px;">
                            <div>
                                <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--theme-text-secondary, #a1a1aa);">Theme Name</label>
                                <input type="text" id="customThemeNameInput" placeholder="My Custom Theme" style="
                                    width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
                                    border: 1px solid var(--theme-border, rgba(255,255,255,0.1));
                                    background: var(--theme-input-bg, #121214); color: var(--theme-input-text, #f4f4f5);
                                    font-size: 14px;
                                ">
                            </div>

                            <div>
                                <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--theme-text-secondary, #a1a1aa);">Base Mode</label>
                                <select id="customThemeBaseSelect" style="
                                    width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
                                    border: 1px solid var(--theme-border, rgba(255,255,255,0.1));
                                    background: var(--theme-input-bg, #121214); color: var(--theme-input-text, #f4f4f5);
                                    font-size: 14px;
                                ">
                                    <option value="dark" ${!isLight ? 'selected' : ''}>Dark Base</option>
                                    <option value="light" ${isLight ? 'selected' : ''}>Light Base</option>
                                </select>
                            </div>

                            <div style="border-top: 1px solid var(--theme-border, rgba(255,255,255,0.1)); padding-top: 12px; margin-top: 4px;">
                                <div style="font-size: 13px; font-weight: 600; margin-bottom: 10px; color: var(--theme-text-primary, #f4f4f5);">Colors Customization</div>
                                <div id="colorFieldsContainer" style="display: flex; flex-direction: column; gap: 10px;">
                                    <!-- Dynamic color field rows injected via JS -->
                                </div>
                            </div>
                        </div>

                        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px;">
                            <button type="button" id="cancelThemeEditorBtn" style="
                                background: var(--theme-hover-bg, rgba(255,255,255,0.08));
                                color: var(--theme-text-primary, #f4f4f5);
                                border: 1px solid var(--theme-border, transparent);
                                padding: 10px 16px; border-radius: 8px; cursor: pointer; font-weight: 500;
                            ">Cancel</button>
                            <button type="button" id="saveCustomThemeBtn" style="
                                background: #6366f1;
                                color: #ffffff;
                                border: none;
                                padding: 10px 18px; border-radius: 8px; cursor: pointer; font-weight: 600;
                                box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
                            ">Save Theme</button>
                        </div>
                    </div>
                </div>
            `;
        };

        modal.innerHTML = renderModalHTML();
        document.body.appendChild(modal);

        let editingThemeId = null;

        const close = () => {
            modal.style.animation = 'fadeOut 0.2s ease';
            setTimeout(() => modal.remove(), 200);
        };

        // Presets for Base Mode switching
        const presets = {
            dark: {
                '--theme-bg-primary': '#09090b',
                '--theme-bg-secondary': '#121214',
                '--theme-bg-tertiary': '#1b1b1f',
                '--theme-bg-card': '#18181b',
                '--theme-text-primary': '#f4f4f5',
                '--theme-text-secondary': '#a1a1aa',
                '--theme-text-muted': '#52525b',
                '--theme-border': '#27272a',
                '--theme-input-bg': '#121214',
                '--theme-input-text': '#f4f4f5',
                '--accent-color': '#6366f1'
            },
            light: {
                '--theme-bg-primary': '#f4f4f5',
                '--theme-bg-secondary': '#ffffff',
                '--theme-bg-tertiary': '#e4e4e7',
                '--theme-bg-card': '#ffffff',
                '--theme-text-primary': '#09090b',
                '--theme-text-secondary': '#52525b',
                '--theme-text-muted': '#a1a1aa',
                '--theme-border': '#e4e4e7',
                '--theme-input-bg': '#ffffff',
                '--theme-input-text': '#09090b',
                '--accent-color': '#18181b'
            }
        };

        // Attach main modal event handlers
        const attachMainEvents = () => {
            const closeBtn = modal.querySelector('.modal-close-btn');
            if (closeBtn) closeBtn.addEventListener('mousedown', close);

            modal.addEventListener('mousedown', (e) => {
                if (e.target === modal) close();
            });

            // Theme options selection
            const themeOptions = modal.querySelectorAll('.theme-option');
            themeOptions.forEach(option => {
                option.addEventListener('mousedown', (e) => {
                    if (e.target.closest('.custom-theme-actions')) return; // Ignore action clicks
                    const selectedTheme = option.dataset.theme;
                    this.applyTheme(selectedTheme);
                    close();
                    if (typeof Utils !== 'undefined' && Utils.showToast) {
                        Utils.showToast(`Theme updated`);
                    }
                });
            });

            // Add custom theme (+) button
            const addBtn = modal.querySelector('#addCustomThemeBtn');
            if (addBtn) {
                addBtn.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    openEditor(null);
                });
            }

            // Edit custom theme buttons
            const editBtns = modal.querySelectorAll('.edit-custom-theme-btn');
            editBtns.forEach(btn => {
                btn.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.themeId;
                    openEditor(id);
                });
            });

            // Delete custom theme buttons
            const deleteBtns = modal.querySelectorAll('.delete-custom-theme-btn');
            deleteBtns.forEach(btn => {
                btn.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.themeId;
                    let customs = this.getCustomThemes();
                    customs = customs.filter(c => c.id !== id);
                    this.saveCustomThemes(customs);
                    
                    if (this.getCurrentTheme() === id) {
                        this.applyTheme('dark');
                    }
                    
                    modal.innerHTML = renderModalHTML();
                    attachMainEvents();
                    if (typeof Utils !== 'undefined' && Utils.showToast) {
                        Utils.showToast('Custom theme deleted');
                    }
                });
            });
        };

        // Custom Theme Color Schema
        const colorSchema = [
            { key: '--theme-bg-primary', label: 'Primary Background' },
            { key: '--theme-bg-secondary', label: 'Secondary / Container BG' },
            { key: '--theme-bg-tertiary', label: 'Tertiary / Sub-panel BG' },
            { key: '--theme-bg-card', label: 'Card Background' },
            { key: '--theme-text-primary', label: 'Primary Text Color' },
            { key: '--theme-text-secondary', label: 'Secondary Text Color' },
            { key: '--theme-text-muted', label: 'Muted / Hint Text Color' },
            { key: '--theme-border', label: 'Border Color' },
            { key: '--theme-input-bg', label: 'Input Background' },
            { key: '--theme-input-text', label: 'Input Text Color' },
            { key: '--accent-color', label: 'Accent Color' }
        ];

        // Open custom theme editor
        const openEditor = (themeId = null) => {
            editingThemeId = themeId;
            const mainView = modal.querySelector('#themeModalMain');
            const editorView = modal.querySelector('#themeModalEditor');
            const titleEl = modal.querySelector('#themeEditorTitle');
            const nameInput = modal.querySelector('#customThemeNameInput');
            const baseSelect = modal.querySelector('#customThemeBaseSelect');
            const colorContainer = modal.querySelector('#colorFieldsContainer');

            mainView.style.display = 'none';
            editorView.style.display = 'flex';

            let initialVariables = {};
            let themeName = '';
            let baseMode = document.documentElement.classList.contains('light-theme') ? 'light' : 'dark';

            if (themeId) {
                const ct = customThemes.find(t => t.id === themeId);
                if (ct) {
                    titleEl.textContent = 'Edit Custom Theme';
                    themeName = ct.name;
                    baseMode = ct.base || 'dark';
                    initialVariables = { ...ct.variables };
                }
            } else {
                titleEl.textContent = 'Create Custom Theme';
                themeName = '';
                const active = getActiveColors();
                initialVariables = {
                    '--theme-bg-primary': active.primaryBg,
                    '--theme-bg-secondary': active.secondaryBg,
                    '--theme-bg-card': active.cardBg,
                    '--theme-text-primary': active.textPrimary,
                    '--theme-text-secondary': active.textSecondary,
                    '--theme-border': active.border,
                    '--theme-input-bg': active.inputBg,
                    '--theme-input-text': active.inputText,
                    '--accent-color': active.accentColor
                };
            }

            nameInput.value = themeName;
            baseSelect.value = baseMode;

            // Render color input rows
            colorContainer.innerHTML = colorSchema.map(item => {
                const rawVal = initialVariables[item.key] || '#121214';
                const hexVal = toHexColor(rawVal);
                return `
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                        <span style="font-size: 12px; color: var(--theme-text-secondary, #a1a1aa); flex: 1;">${item.label}</span>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="color" class="color-picker-input" data-var="${item.key}" value="${hexVal}" style="
                                border: none; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; background: none; padding: 0;
                            ">
                            <input type="text" class="color-hex-input" data-var="${item.key}" value="${hexVal}" style="
                                width: 70px; padding: 4px 6px; border-radius: 6px; border: 1px solid var(--theme-border, rgba(255,255,255,0.1));
                                background: var(--theme-input-bg, #121214); color: var(--theme-input-text, #f4f4f5); font-size: 12px; font-family: monospace;
                            ">
                        </div>
                    </div>
                `;
            }).join('');

            // Dynamic update when changing Base Mode select dropdown
            baseSelect.onchange = (e) => {
                const selectedMode = e.target.value;
                const preset = presets[selectedMode] || presets.dark;
                colorSchema.forEach(item => {
                    const val = preset[item.key];
                    if (val) {
                        const hexVal = toHexColor(val);
                        const picker = colorContainer.querySelector(`.color-picker-input[data-var="${item.key}"]`);
                        const hexInput = colorContainer.querySelector(`.color-hex-input[data-var="${item.key}"]`);
                        if (picker) picker.value = hexVal;
                        if (hexInput) hexInput.value = hexVal;
                    }
                });
            };

            // Sync color picker with hex text input
            colorContainer.querySelectorAll('.color-picker-input').forEach(picker => {
                picker.addEventListener('input', (e) => {
                    const varName = picker.dataset.var;
                    const hexInput = colorContainer.querySelector(`.color-hex-input[data-var="${varName}"]`);
                    if (hexInput) hexInput.value = picker.value;
                });
            });

            colorContainer.querySelectorAll('.color-hex-input').forEach(hexInput => {
                hexInput.addEventListener('input', (e) => {
                    const varName = hexInput.dataset.var;
                    const picker = colorContainer.querySelector(`.color-picker-input[data-var="${varName}"]`);
                    if (picker && e.target.value.match(/^#[0-9A-Fa-f]{6}$/)) {
                        picker.value = e.target.value;
                    }
                });
            });

            // Handle Save
            const saveBtn = modal.querySelector('#saveCustomThemeBtn');
            const cancelBtn = modal.querySelector('#cancelThemeEditorBtn');
            const cancelBtnTop = modal.querySelector('#cancelThemeEditorBtnTop');

            const backToMain = () => {
                mainView.style.display = 'block';
                editorView.style.display = 'none';
            };

            cancelBtn.onclick = backToMain;
            cancelBtnTop.onclick = backToMain;

            saveBtn.onclick = () => {
                const name = nameInput.value.trim() || 'Custom Theme';
                const base = baseSelect.value;
                const variables = {};

                colorContainer.querySelectorAll('.color-picker-input').forEach(picker => {
                    variables[picker.dataset.var] = picker.value;
                });

                let customs = this.getCustomThemes();
                const newId = editingThemeId || ('custom_' + Date.now());

                if (editingThemeId) {
                    const idx = customs.findIndex(c => c.id === editingThemeId);
                    if (idx !== -1) {
                        customs[idx] = { id: newId, name, base, variables };
                    } else {
                        customs.push({ id: newId, name, base, variables });
                    }
                } else {
                    customs.push({ id: newId, name, base, variables });
                }

                this.saveCustomThemes(customs);
                this.applyTheme(newId);

                close();
                if (typeof Utils !== 'undefined' && Utils.showToast) {
                    Utils.showToast(`Custom theme "${name}" saved!`);
                }
            };
        };

        attachMainEvents();

        // Handle escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Add animations
        if (!document.getElementById('themeModalAnimations')) {
            const style = document.createElement('style');
            style.id = 'themeModalAnimations';
            style.textContent = `
                @keyframes fadeOut {
                    from { opacity: 1; }
                    to { opacity: 0; }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes scaleIn {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Show FullPageAuth modal in-place on full-page pages
     * @param {'login'|'register'|'approval'} initialView
     * @param {Object} [approvalParams]
     */
    async showAuthModal(initialView = 'login', approvalParams = null) {
        if (window.location.pathname.includes('popup.html')) {
            window.location.reload();
            return;
        }

        // Close any existing modal
        if (this.authModal) {
            this.authModal.destroy();
            this.authModal = null;
        }

        // Lazy-inject full-page-auth.css
        if (!document.getElementById('fullPageAuthStyles')) {
            const link = document.createElement('link');
            link.id = 'fullPageAuthStyles';
            link.rel = 'stylesheet';
            link.href = chrome.runtime.getURL('src/shared/styles/full-page-auth.css');
            document.head.appendChild(link);
        }

        // Lazy-load FullPageAuth class if not present in window
        let AuthClass = (typeof FullPageAuth !== 'undefined') ? FullPageAuth : (window.FullPageAuth || null);
        if (!AuthClass) {
            try {
                const module = await import('./FullPageAuth.js');
                AuthClass = module.default || module.FullPageAuth || window.FullPageAuth;
            } catch {
                try {
                    await new Promise((resolve) => {
                        const script = document.createElement('script');
                        script.src = chrome.runtime.getURL('src/shared/components/FullPageAuth.js');
                        script.onload = resolve;
                        script.onerror = resolve;
                        document.head.appendChild(script);
                    });
                    AuthClass = window.FullPageAuth || null;
                } catch (scriptErr) {
                    console.error('[Navigation] Failed to load FullPageAuth script:', scriptErr);
                }
            }
        }

        if (!AuthClass) {
            console.error('[Navigation] FullPageAuth class is not available');
            return;
        }

        this.authModal = new AuthClass({
            container: document.body,
            mode: 'modal',
            initialView: initialView,
            onAuthSuccess: async (user) => {
                if (this.authModal) {
                    this.authModal.destroy();
                    this.authModal = null;
                }
                await this.updateUserDisplay(user);
                // Dispatch event so active page and sub-components update seamlessly
                window.dispatchEvent(new CustomEvent('authStateChanged', {
                    detail: { user, isAuthenticated: !!user, fromAuthModal: true }
                }));
            },
            onCancel: () => {
                if (this.authModal) {
                    this.authModal.destroy();
                    this.authModal = null;
                }
            }
        });

        if (initialView === 'approval' && approvalParams) {
            this.authModal.switchView('approval', approvalParams);
        }
    }

    handleSignIn() {
        if (window.location.pathname.includes('popup.html')) {
            window.location.reload();
            return;
        }
        this.showAuthModal('login');
    }

    async handleLogout(showModalAfter = true) {
        try {
            // Clear display cache before logout
            try {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    await chrome.storage.local.remove([Navigation.USER_DISPLAY_CACHE_KEY]);
                    this.cachedUserDisplay = null;
                    // console.log('Navigation: Cleared user display cache on logout');
                }
            } catch (cacheError) {
                console.warn('Navigation: Could not clear user display cache:', cacheError);
            }

            if (typeof AuthManager !== 'undefined' && AuthManager.clearAuthData) {
                await AuthManager.clearAuthData();
            }

            if (typeof firebaseManager !== 'undefined' && firebaseManager.signOut) {
                await firebaseManager.signOut();
            }

            await this.updateUserDisplay(null);

            // In popup context, just reload. On full-page, show in-place auth component!
            if (!window.location.pathname.includes('popup.html')) {
                if (showModalAfter) {
                    await this.showAuthModal('login');
                }
            } else {
                window.location.reload();
            }
        } catch (error) {
            console.error('Logout error:', error);
            alert('Failed to sign out. Please try again.');
        }
    }

    // Public method to update active page from outside
    updateActivePage(page) {
        this.setActivePage(page);
    }

    // Method to show loading state
    setLoading(isLoading) {
        const navHeader = document.querySelector('.nav-header');
        if (navHeader) {
            if (isLoading) {
                navHeader.classList.add('nav-loading');
            } else {
                navHeader.classList.remove('nav-loading');
            }
        }
    }

    // Cleanup method
    destroy() {
        this.stopStorageAuthCheck();
        this.closeAllDropdowns();
    }
}

// Auto-initialize navigation if not in popup
if (typeof window !== 'undefined' && !window.location.pathname.includes('popup.html')) {
    document.addEventListener('DOMContentLoaded', () => {
        // Skip auto-initialization if navigation already exists in DOM
        if (document.querySelector('.nav-header')) {
            return;
        }
        
        // Determine current page from URL
        let currentPage = '';
        if (window.location.pathname.includes('search.html') || window.location.pathname.includes('src/pages/search/')) {
            currentPage = 'search';
        } else if (window.location.pathname.includes('ratings.html') || window.location.pathname.includes('src/pages/ratings/')) {
            currentPage = 'ratings';
        } else if (window.location.pathname.includes('calendar.html') || window.location.pathname.includes('src/pages/calendar/')) {
            currentPage = 'calendar';
        } else if (window.location.pathname.includes('watchlist.html')) {
            currentPage = 'watchlist';
        } else if (window.location.pathname.includes('favorites.html')) {
            currentPage = 'favorites';
        } else if (window.location.pathname.includes('admin.html') || window.location.pathname.includes('src/pages/admin/')) {
            // Admin page handles its own navigation init
            return;
        } else if (window.location.pathname.includes('settings.html') || window.location.pathname.includes('src/pages/settings/')) {
             // Settings page handles its own navigation init
            return;
        }
        
        window.navigation = new Navigation(currentPage);
    });
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Navigation;
} else {
    window.Navigation = Navigation;
}
