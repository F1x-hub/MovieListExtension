/**
 * Navigation Component
 * Global navigation header for all pages
 */
class Navigation {
    // Cache key for storing user display data
    static USER_DISPLAY_CACHE_KEY = 'userDisplayCache';
    // Owned by MediaPlayerService; Navigation only reads it.
    static MEDIA_PLAYER_SETUP_KEY = 'mediaplayer_setup_v1';
    // Setup errors that mean "set up, but the service does not answer right now".
    static MEDIA_PLAYER_TRANSIENT_ERRORS = new Set(['connection_failed', 'timeout', 'torrent_not_configured', 'engine_closed']);
    // Networked games with news for other pages. Imports stay literal: the page
    // bundler keeps a script with a relative import() out of a bundle.
    static GAME_NOTIFIERS = [
        {
            property: 'battleshipNotifier',
            pagePath: '/src/pages/battleship/',
            label: 'Battleship',
            load: () => import('./BattleshipNotifier.js').then(module => module.BattleshipNotifier)
        },
        {
            property: 'chessNotifier',
            pagePath: '/src/pages/chess/',
            label: 'Chess',
            load: () => import('./ChessNotifier.js').then(module => module.ChessNotifier)
        }
    ];

    /**
     * Whether the person has connected MediaPlayer in Settings. Downloads exist only
     * then: without it there is no Downloads entry at all. A setup that worked but
     * whose service is down right now still counts, so the page can say so.
     */
    static isMediaPlayerSetUp(enabled, setup) {
        if (enabled !== true || !setup || typeof setup !== 'object' || setup.enabled !== true) return false;
        if (setup.status === 'ready') return true;
        return setup.status === 'error'
            && Boolean(String(setup.installPath || '').trim())
            && Navigation.MEDIA_PLAYER_TRANSIENT_ERRORS.has(String(setup.errorCode || ''));
    }

    /** The name a profile shows, falling back to the session's own copy of the user. */
    static displayTextFor(profile, user) {
        if (profile?.displayNameFormat === 'username' && profile.username) return profile.username;
        const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
        return fullName || profile?.displayName || user?.displayName || user?.email || 'User';
    }

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
        this.showGames = false;
        this.showDownloads = false;
        this._updateInProgress = false;
        this._pendingUser = null;
        this._searchNavigationPending = false;
        if (typeof window !== 'undefined') {
            window.navigationInstance = this;
            window.navigation = this;
        }
        this.init();
    }

    async init() {
        this.applyTheme(this.getCurrentTheme());
        
        // CRITICAL: Load this BEFORE rendering, so nothing in the bar changes width a frame later
        await this.loadFirstPaintState();
        
        // Initialize i18n via dynamic import to maintain compatibility with non-module scripts
        try {
            const module = await import('../i18n/I18n.js');
            this.i18n = module.i18n;
            if (this.i18n) {
                if (!this.i18n.currentLocale || this.i18n.currentLocale === 'en') {
                    await this.i18n.init();
                }

                // Keep the protected admin surface consistent with its Russian copy.
                // This is intentionally local to the page and does not persist a global preference.
                if (this.currentPage === 'admin') {
                    this.i18n.currentLocale = 'ru';
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
        if (this.currentPage !== 'admin') {
            void import('./WhatsNewDialog.js').then(module => module.showWhatsNew())
                .catch(error => console.warn('Navigation: release notes unavailable', error));
            void import('./HubPrompt.js').then(module => module.showHubPrompt())
                .catch(error => console.warn('Navigation: MovieList Hub prompt unavailable', error));
        }
    }

    /**
     * Reads from chrome.storage.local what the first paint needs.
     */
    async loadFirstPaintState() {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                const result = await chrome.storage.local.get([
                    Navigation.USER_DISPLAY_CACHE_KEY,
                    'isAuthenticated',
                    'user',
                    'showGames',
                    'mediaPlayerEnabled',
                    Navigation.MEDIA_PLAYER_SETUP_KEY
                ]);
                this.showGames = Boolean(result.showGames);
                this.showDownloads = Navigation.isMediaPlayerSetUp(
                    result.mediaPlayerEnabled,
                    result[Navigation.MEDIA_PLAYER_SETUP_KEY]
                );
                if (result.isAuthenticated) {
                    this.cachedUserDisplay = await this.bestKnownUserDisplay(result[Navigation.USER_DISPLAY_CACHE_KEY], result.user);
                }
            }
        } catch (error) {
            console.warn('Navigation: Could not load cached user display:', error);
        }
    }

    /**
     * The saved display if it belongs to this session, however old: Firestore
     * corrects it anyway, and it is the closest guess. Otherwise the profile the
     * popup keeps, as signing in there saves no display, then the session's copy.
     */
    async bestKnownUserDisplay(cache, user) {
        if (cache) {
            if (cache.uid === user?.uid) return cache;
            await chrome.storage.local.remove([Navigation.USER_DISPLAY_CACHE_KEY]);
        }
        if (!user) return null;
        const profileKey = `user_profile_${user.uid}`;
        const { [profileKey]: profile } = await chrome.storage.local.get([profileKey]);
        return {
            uid: user.uid,
            displayName: Navigation.displayTextFor(profile, user),
            photoURL: profile?.photoURL || user.photoURL || null
        };
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
                if (areaName === 'local' && changes.navRankFrame) {
                    this.applyRankFrame(changes.navRankFrame.newValue);
                }
            });
        }
        chrome.storage?.local?.get(['navRankFrame']).then(result => this.applyRankFrame(result?.navRankFrame)).catch(() => {});
    }

    /**
     * Profile rank frame around the navbar avatar. The profile page publishes
     * {uid, level} to chrome.storage.local (level 0 = no rank or hidden by the
     * owner), so other pages draw it without reading Firestore.
     */
    async applyRankFrame(state) {
        const frame = document.getElementById('navRankFrame');
        if (!frame) return;
        const uid = this.user?.uid || this.cachedUserDisplay?.uid;
        const level = Number(state?.level) || 0;
        if (!state || !uid || state.uid !== uid || level <= 0) {
            frame.hidden = true;
            frame.innerHTML = '';
            return;
        }
        try {
            const { renderAvatarFrame } = await import('../achievements/AchievementBadge.js');
            frame.innerHTML = renderAvatarFrame(level, { label: false });
            frame.hidden = false;
        } catch (error) {
            console.warn('Navigation: rank frame unavailable', error);
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
            case 'live':
                return chrome.runtime.getURL('src/pages/live/live.html');
            case 'downloads':
                return chrome.runtime.getURL('src/pages/downloads/downloads.html');
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

        // Everything in the bar sits where the account block leaves room, so it
        // paints in its final shape, as far as anything known so far can tell.
        const cachedName = this.cachedUserDisplay?.displayName || 'User';
        const cachedAvatar = this.cachedUserDisplay?.photoURL || chrome.runtime.getURL('src/shared/assets/icons/app/icon48.png');
        const isSignedIn = !!this.cachedUserDisplay;

        const navHTML = `
            <header class="nav-header">
                    <!-- Radio Player (absolute, outside flex flow) -->
                    <div id="navigationLeft" class="nav-radio" style="display: none;">
                        <span class="nav-radio-controls">
                            <button class="nav-radio-btn" id="radioPlayBtn" title="Play"><svg data-icon="PLAY" aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 3.9C5 2.9 5.9 2.3 6.7 2.9L16.2 8.9C17 9.5 17 10.5 16.2 11.1L6.7 17.1C5.9 17.7 5 17.1 5 16.1Z"/></svg></button>
                            <button class="nav-radio-btn" id="radioStopBtn" title="Stop" style="display:none;"><svg data-icon="STOP" aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M6.5 4H13.5A2.5 2.5 0 0 1 16 6.5V13.5A2.5 2.5 0 0 1 13.5 16H6.5A2.5 2.5 0 0 1 4 13.5V6.5A2.5 2.5 0 0 1 6.5 4Z"/></svg></button>
                        </span>
                        <span id="volumeControl" class="nav-radio-volume">
                            <span id="volumeIcon"><svg data-icon="VOLUME_HIGH" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2 8A1 1 0 0 1 3 7H5.4L9.3 3.4A1 1 0 0 1 11 4.1V15.9A1 1 0 0 1 9.3 16.6L5.4 13H3A1 1 0 0 1 2 12Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.6 7.4A3.8 3.8 0 0 1 13.6 12.6M15.8 4.6A7.6 7.6 0 0 1 15.8 15.4"/></svg></span>
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
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" class="nav-logo-image nav-logo-image--default" aria-hidden="true" style="fill: var(--theme-text-primary, currentColor);"><g transform="translate(28 112) rotate(-14) translate(0 -42)"><path fill-rule="evenodd" d="M11 0H189A11 11 0 0 1 200 11V31A11 11 0 0 1 189 42H11A11 11 0 0 1 0 31V11A11 11 0 0 1 11 0ZM22 34L36 8L56 8L42 34ZM66 34L80 8L100 8L86 34ZM110 34L124 8L144 8L130 34ZM154 34L168 8L188 8L174 34Z"/></g><path fill-rule="evenodd" d="M46 120H210A18 18 0 0 1 228 138V218A18 18 0 0 1 210 236H46A18 18 0 0 1 28 218V138A18 18 0 0 1 46 120ZM110 155Q110 148 116.12 151.4L157.88 174.6Q164 178 157.88 181.4L116.12 204.6Q110 208 110 201Z"/></svg>${window.SeasonalThemeService?.getLogoMarkup?.('nav-logo-image', window.SeasonalThemeService.getActiveDecor?.()?.id) || ''}
                    </a>

                    <!-- Mobile Toggle -->
                    <button type="button" class="nav-mobile-toggle" id="navMobileToggle" aria-controls="navMenu" aria-expanded="false" aria-label="${this.i18n?.get('navbar.open_menu') || 'Открыть меню'}">
                        <span>${this.icon('MENU')}</span>
                    </button>

                    <!-- Navigation Menu -->
                    <nav class="nav-menu" id="navMenu">
                        <div class="nav-item">
                            <a href="${this.getPageUrl('random')}" class="nav-link" data-page="random" id="navRandom">
                                <span class="nav-icon">${this.icon('DICE')}</span>
                                <span data-i18n="navbar.random">Random</span>
                            </a>
                        </div>

                        <div class="nav-item">
                            <a href="${this.getPageUrl('ratings')}" class="nav-link" data-page="ratings" id="navRatings">
                                <span class="nav-icon">${this.icon('RATED')}</span>
                                <span data-i18n="navbar.rated">Rated</span>
                            </a>
                        </div>

                        <div class="nav-item">
                            <a href="${this.getPageUrl('live')}" class="nav-link" data-page="live" id="navLive">
                                <span class="nav-icon">${this.icon('LIVE')}</span>
                                <span data-i18n="navbar.live">Эфир</span>
                            </a>
                        </div>
                    </nav>

                    <!-- Search & Bookmarks Section -->
                    <div class="nav-search-container">
                        <button type="button" class="nav-search-toggle" id="navSearchToggle" aria-controls="navSearchInputWrapper" aria-expanded="false" aria-label="${this.i18n?.get('navbar.search') || 'Поиск фильмов'}" title="Search Movies" style="margin-right: 5px;">
                            <span class="nav-icon">${this.icon('SEARCH')}</span>
                        </button>
                        <div class="nav-search-input-wrapper" id="navSearchInputWrapper">
                            <input type="text" class="nav-search-input" id="navSearchInput" data-i18n="navbar.search_placeholder" placeholder="Search movies...">
                        </div>

                        <!-- Bookmarks Button -->
                        <a href="${this.getPageUrl('bookmarks')}" class="nav-icon-btn" id="navBookmarksBtn" data-page="bookmarks" aria-label="${this.i18n?.get('bookmarks.title') || 'Закладки'}" title="Bookmarks">
                            <span class="nav-icon">${this.icon('BOOKMARK')}</span>
                        </a>

                        <!-- Calendar Button -->
                        <a href="${this.getPageUrl('calendar')}" class="nav-icon-btn" id="navCalendarBtn" data-page="calendar" aria-label="${this.i18n?.get('navbar.calendar') || 'Календарь'}" title="Calendar">
                            <span class="nav-icon">${this.icon('CALENDAR')}</span>
                        </a>

                        <!-- Downloads: only once MediaPlayer is connected in Settings -->
                        <a href="${this.getPageUrl('downloads')}" class="nav-icon-btn" id="navDownloadsBtn" data-page="downloads" aria-label="${this.i18n?.get('navbar.downloads') || 'Загрузки'}" title="${this.i18n?.get('navbar.downloads') || 'Загрузки'}" style="display: ${this.showDownloads ? 'inline-flex' : 'none'};">
                            <span class="nav-icon">${this.icon('DOWNLOADS')}</span>
                        </a>

                        <!-- Games Button -->
                        <button class="nav-icon-btn" id="navGamesBtn" title="Мини-игры" style="display: ${this.showGames ? 'inline-flex' : 'none'}; margin-left: 2px;">
                            <span class="nav-icon">${this.icon('GAMES')}</span>
                        </button>
                    </div>

                    <!-- User Section -->
                    <div class="nav-user" id="navUser">
                        <!-- User Profile Dropdown -->
                        <div class="nav-user-profile" id="navUserProfile" style="display: ${isSignedIn ? 'block' : 'none'};">
                            <button type="button" class="nav-user-trigger" id="navUserTrigger" aria-controls="navUserDropdown" aria-expanded="false">
                                <span class="nav-user-avatar-wrap"><img src="${cachedAvatar}" alt="User" class="nav-user-avatar" id="navUserAvatar"><span class="nav-rank-frame" id="navRankFrame" hidden></span></span>
                                <span class="nav-user-name" id="navUserName">${this.escapeHtml(cachedName)}</span>
                                <span class="nav-dropdown-arrow">${this.icon('CHEVRON_DOWN')}</span>
                            </button>
                            
                            <!-- Dropdown Menu -->
                            <div class="nav-user-dropdown" id="navUserDropdown">
                                <a href="${this.getPageUrl('profile')}" class="nav-dropdown-item" id="navDropdownSettings">
                                    <span class="nav-dropdown-icon">${this.icon('USER')}</span>
                                    <span data-i18n="navbar.view_profile">View Profile</span>
                                </a>
                                <a href="${this.getPageUrl('settings')}" class="nav-dropdown-item" id="navDropdownSettingsPage">
                                    <span class="nav-dropdown-icon">${this.icon('SETTINGS')}</span>
                                    <span data-i18n="navbar.settings">Settings</span>
                                </a>
                                <a href="${this.getPageUrl('admin')}" class="nav-dropdown-item" id="navDropdownAdmin" style="display: none;">
                                    <span class="nav-dropdown-icon">${this.icon('ADMIN')}</span>
                                    <span data-i18n="navbar.admin_panel">Admin Panel</span>
                                </a>
                                <div class="nav-dropdown-item" id="navDropdownTheme">
                                    <span class="nav-dropdown-icon" id="navThemeIcon">
                                        ${this.icon('MOON')}
                                    </span>
                                    <span id="navThemeText" data-i18n="navbar.theme">Theme</span>
                                </div>
                                <div class="nav-dropdown-divider"></div>
                                <div class="nav-dropdown-item nav-dropdown-logout" id="navDropdownLogout">
                                    <span class="nav-dropdown-icon">${this.icon('LOGOUT')}</span>
                                    <span data-i18n="navbar.log_out">Log Out</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Sign In Button (for non-authenticated users) -->
                        <button class="nav-signin-btn" id="navSignInBtn" style="display: ${isSignedIn ? 'none' : 'flex'};">
                            <span class="nav-signin-icon">${this.icon('USER')}</span>
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
            mobileToggle.addEventListener('click', () => {
                const isOpen = navMenu.classList.toggle('active');
                mobileToggle.setAttribute('aria-expanded', String(isOpen));
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

        const downloadsBtn = document.getElementById('navDownloadsBtn');
        if (downloadsBtn) {
            downloadsBtn.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                this.navigateToPage('downloads');
            });
        }

        const gamesBtn = document.getElementById('navGamesBtn');
        if (gamesBtn) {
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
                    this.showGames = Boolean(changes.showGames.newValue);
                    if (this.showGames && this.user) this.startGameNotifiers(this.user);
                    else this.stopGameNotifiers();
                }
                if (area === 'local' && (changes.mediaPlayerEnabled || changes[Navigation.MEDIA_PLAYER_SETUP_KEY])) {
                    void this.refreshDownloadsEntry();
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
                mobileToggle.setAttribute('aria-expanded', 'false');
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && navMenu?.classList.contains('active')) {
                navMenu.classList.remove('active');
                mobileToggle.setAttribute('aria-expanded', 'false');
                mobileToggle.focus();
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
            userTrigger.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const isOpen = userDropdown.classList.contains('active');
                
                // Close all other dropdowns first
                this.closeAllDropdowns();
                
                if (!isOpen) {
                    userDropdown.classList.add('active');
                    userDropdown.inert = false;
                    userTrigger.classList.add('active');
                    userTrigger.setAttribute('aria-expanded', 'true');
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
                    const wasOpen = userDropdown.classList.contains('active');
                    this.closeAllDropdowns();
                    if (wasOpen) userTrigger.focus();
                }
            });
        }
    }

    closeAllDropdowns() {
        const userDropdown = document.getElementById('navUserDropdown');
        const userTrigger = document.getElementById('navUserTrigger');
        
        if (userDropdown && userTrigger) {
            userDropdown.classList.remove('active');
            userDropdown.inert = true;
            userTrigger.classList.remove('active');
            userTrigger.setAttribute('aria-expanded', 'false');
        }
    }

    setupSearchToggle() {
        const searchToggle = document.getElementById('navSearchToggle');
        const searchInputWrapper = document.getElementById('navSearchInputWrapper');
        const searchInput = document.getElementById('navSearchInput');

        if (!searchToggle || !searchInputWrapper || !searchInput) return;

        // Toggle search input on button click
        const closeSearch = () => {
            searchInputWrapper.classList.remove('active');
            searchToggle.setAttribute('aria-expanded', 'false');
        };
        searchToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = searchInputWrapper.classList.contains('active');
            
            if (isOpen) {
                const query = searchInput.value.trim();
                if (query) {
                    closeSearch();
                    this.navigateToSearchWithQuery(query);
                }
            } else {
                searchInputWrapper.classList.add('active');
                searchToggle.setAttribute('aria-expanded', 'true');
                searchInput.focus();
            }
        });

        // Handle Enter key to navigate to search page
        searchInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;

            e.preventDefault();
            if (e.repeat || this._searchNavigationPending) return;

            const query = searchInput.value.trim();
            closeSearch();
            this.navigateToSearchWithQuery(query);
        });

        // Close search when clicking outside
        document.addEventListener('mousedown', (e) => {
            if (!searchToggle.contains(e.target) && !searchInputWrapper.contains(e.target)) {
                closeSearch();
            }
        });

        // Close search on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && searchInputWrapper.classList.contains('active')) {
                closeSearch();
                searchToggle.focus();
            }
        });
    }

    navigateToSearchWithQuery(query) {
        if (this._searchNavigationPending) return;

        const normalizedQuery = String(query ?? '').trim();
        const queryString = normalizedQuery ? `?q=${encodeURIComponent(normalizedQuery)}` : '';
        const searchUrl = chrome.runtime.getURL(`src/pages/search/search.html${queryString}`);
        this._searchNavigationPending = true;

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
            if (vol == 0) volumeIcon.innerHTML = `<svg data-icon="VOLUME_MUTE" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2 8A1 1 0 0 1 3 7H5.4L9.3 3.4A1 1 0 0 1 11 4.1V15.9A1 1 0 0 1 9.3 16.6L5.4 13H3A1 1 0 0 1 2 12Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.6 7.8L18 12.2M18 7.8L13.6 12.2"/></svg>`;
            else if (vol < 0.5) volumeIcon.innerHTML = `<svg data-icon="VOLUME_LOW" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2 8A1 1 0 0 1 3 7H5.4L9.3 3.4A1 1 0 0 1 11 4.1V15.9A1 1 0 0 1 9.3 16.6L5.4 13H3A1 1 0 0 1 2 12Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.6 7.4A3.8 3.8 0 0 1 13.6 12.6"/></svg>`;
            else volumeIcon.innerHTML = `<svg data-icon="VOLUME_HIGH" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2 8A1 1 0 0 1 3 7H5.4L9.3 3.4A1 1 0 0 1 11 4.1V15.9A1 1 0 0 1 9.3 16.6L5.4 13H3A1 1 0 0 1 2 12Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.6 7.4A3.8 3.8 0 0 1 13.6 12.6M15.8 4.6A7.6 7.6 0 0 1 15.8 15.4"/></svg>`;
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
                            const iconHtml = CollectionService.renderIconHtml(collection.icon, { size: 22 });
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
        // Quote-safe: the result also goes into attribute values. Utils is not loaded on every page.
        if (typeof Utils !== 'undefined' && Utils.escapeHtml) return Utils.escapeHtml(text);
        if (text === null || text === undefined) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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
                    // Firebase on this page answers for the session and refreshes this
                    // copy. Clearing the copy first would show the sign-in button until then.
                    const firebaseWillAnswer = typeof firebaseManager !== 'undefined' && firebaseManager.isInitialized;

                    if (authAge < maxAge || firebaseWillAnswer) {
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

    /**
     * Show unread reactions on the user's ratings once per page. The module
     * reads one Firestore document at most every 10 minutes across pages.
     * @param {Object} user - Firebase user
     */
    async checkReactionNotifications(user) {
        const uid = user?.uid;
        const manager = typeof firebaseManager !== 'undefined' ? firebaseManager : null;
        if (!uid || !manager || this._reactionNotificationsUid === uid) return;
        this._reactionNotificationsUid = uid;
        try {
            // The first call often comes from the chrome.storage auth copy,
            // before Firebase Auth restores the session. Reading the inbox then
            // fails the owner rule, so wait until Firebase signs in as this uid.
            await manager.waitForAuthReady?.(10000);
            const db = manager.db;
            if (!db || manager.getCurrentUser?.()?.uid !== uid) {
                this._reactionNotificationsUid = null;
                return;
            }
            const { ReactionNotificationCenter } = await import('./ReactionNotifications.js');
            this.reactionNotifications = this.reactionNotifications
                || new ReactionNotificationCenter({ db, i18n: this.i18n });
            await this.reactionNotifications.checkOnOpen(uid);
        } catch (error) {
            console.warn('Navigation: reaction notifications unavailable', error);
        }
    }

    /**
     * News from the networked games (Battleship, chess) on every page but the
     * game's own. Only with mini-games switched on: each holds one listener on
     * the player's own document, so nobody who never plays pays for it.
     * @param {Object} user - Firebase user
     */
    startGameNotifiers(user) {
        Navigation.GAME_NOTIFIERS.forEach(entry => this.startGameNotifier(entry, user));
    }

    stopGameNotifiers() {
        Navigation.GAME_NOTIFIERS.forEach(entry => this.stopGameNotifier(entry));
    }

    startGameNotifier(entry, user) {
        const uid = user?.uid;
        const onGamePage = typeof location !== 'undefined' && location.pathname.includes(entry.pagePath);
        const state = this.gameNotifierState(entry);
        if (!uid || !this.showGames || onGamePage) {
            this.stopGameNotifier(entry);
            return;
        }
        if (state.uid === uid) return;
        this.stopGameNotifier(entry);
        state.uid = uid;
        const token = state.token;
        const manager = typeof firebaseManager !== 'undefined' ? firebaseManager : null;
        (async () => {
            // Like the reaction inbox: wait until Firebase itself is signed in as this uid.
            await manager?.waitForAuthReady?.(10000);
            if (token !== state.token || manager?.auth?.currentUser?.uid !== uid || !manager.db) {
                if (token === state.token) state.uid = null;
                return;
            }
            const Notifier = await entry.load();
            if (token !== state.token) return;
            this[entry.property] = new Notifier({ db: manager.db, uid });
            this[entry.property].start();
        })().catch(error => {
            if (token === state.token) state.uid = null;
            console.warn(`Navigation: ${entry.label} notifications unavailable`, error);
        });
    }

    stopGameNotifier(entry) {
        const state = this.gameNotifierState(entry);
        state.token += 1;
        state.uid = null;
        this[entry.property]?.stop();
        this[entry.property] = null;
    }

    gameNotifierState(entry) {
        this._gameNotifierStates = this._gameNotifierStates || {};
        if (!this._gameNotifierStates[entry.property]) this._gameNotifierStates[entry.property] = { uid: null, token: 0 };
        return this._gameNotifierStates[entry.property];
    }

    async updateUserDisplay(user) {
        // Prevent multiple simultaneous updates (race condition protection)
        if (this._updateInProgress) {
            // Another account, or none, corrects the one running: it must not be lost.
            const sameAccount = (user?.uid ?? null) === (this.user?.uid ?? null);
            this._pendingUser = sameAccount ? null : { user };
            return;
        }
        this._updateInProgress = true;

        try {
            this.user = user;
            // The rank frame belongs to one account: re-check it whenever the user changes.
            chrome.storage?.local?.get(['navRankFrame']).then(result => this.applyRankFrame(result?.navRankFrame)).catch(() => {});
            const userProfile = document.getElementById('navUserProfile');
            const userAvatar = document.getElementById('navUserAvatar');
            const userName = document.getElementById('navUserName');
            const signInBtn = document.getElementById('navSignInBtn');

            // console.log('Navigation: Updating user display:', user ? (user.displayName || user.email) : 'No user');

            if (user && userProfile && userName) {
                // Show user profile dropdown
                userProfile.style.display = 'block';
                if (signInBtn) signInBtn.style.display = 'none';

                // Non-blocking: unread reactions on the user's ratings.
                this.checkReactionNotifications(user);
                this.startGameNotifiers(user);

                // Get display name based on user preference
                let displayText = Navigation.displayTextFor(null, user);
                let photoURL = user.photoURL || null;
                
                // Try to get from cache first for immediate update
                try {
                    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                        const cacheKey = `user_profile_${user.uid}`;
                        const cachedResult = await chrome.storage.local.get([cacheKey]);
                        const cachedProfile = cachedResult[cacheKey];

                        if (cachedProfile) {
                            displayText = Navigation.displayTextFor(cachedProfile, user);
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

                            displayText = Navigation.displayTextFor(profile, user);
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
                            uid: user.uid
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
                this.stopGameNotifiers();
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
            const pending = this._pendingUser;
            this._pendingUser = null;
            if (pending) this.updateUserDisplay(pending.user);
        }
    }

    /** Shows or hides the Downloads entry after MediaPlayer is connected or turned off. */
    async refreshDownloadsEntry() {
        try {
            const result = await chrome.storage.local.get(['mediaPlayerEnabled', Navigation.MEDIA_PLAYER_SETUP_KEY]);
            this.showDownloads = Navigation.isMediaPlayerSetUp(
                result.mediaPlayerEnabled,
                result[Navigation.MEDIA_PLAYER_SETUP_KEY]
            );
        } catch (error) {
            console.warn('Navigation: Could not read MediaPlayer setup:', error);
            return;
        }
        const btn = document.getElementById('navDownloadsBtn');
        if (btn) btn.style.display = this.showDownloads ? 'inline-flex' : 'none';
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

    getCustomThemes() {
        return window.ThemeService ? window.ThemeService.getCustomThemes() : [];
    }

    saveCustomThemes(customThemes) {
        if (window.ThemeService) {
            return window.ThemeService.saveCustomThemes(customThemes);
        }
        return [];
    }

    getCurrentTheme() {
        return window.ThemeService ? window.ThemeService.getCurrentTheme() : 'dark';
    }

    applyTheme(theme) {
        if (!window.ThemeService) return 'dark';
        const state = window.ThemeService.applyTheme(theme);
        this.updateThemeButton(state.theme);
        return state.theme;
    }

    /** Markup from the shared icon set; every page loads Icons.js before the header is built. */
    icon(name) {
        return (typeof Icons !== 'undefined' && Icons[name]) || '';
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
                themeIcon.innerHTML = this.icon('SUN');
            } else if (theme === 'dark') {
                themeIcon.innerHTML = this.icon('MOON');
            } else {
                themeIcon.innerHTML = this.icon('PALETTE');
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
            animation: nav-theme-fade-in 0.2s ease;
            backdrop-filter: blur(4px);
        `;

        const renderModalHTML = () => {
            currentTheme = this.getCurrentTheme();
            customThemes = this.getCustomThemes();
            const isLight = document.documentElement.classList.contains('light-theme');

            const checkIcon = this.icon('CHECK');
            const plusIcon = this.icon('PLUS');
            const moonIcon = this.icon('MOON');
            const sunIcon = this.icon('SUN');
            const paletteIcon = this.icon('PALETTE');
            const editIcon = this.icon('EDIT');
            const trashIcon = this.icon('TRASH');

            return `
                <div class="theme-modal-content" style="
                    background: var(--theme-bg-secondary, #121214);
                    padding: 24px;
                    border-radius: 14px;
                    width: 360px;
                    max-width: 92vw;
                    color: var(--theme-text-primary, #f4f4f5);
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
                    animation: nav-theme-scale-in 0.2s ease;
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
                                            <span style="width: 14px; height: 14px; border-radius: var(--radius-sm); background: ${primaryDot}; border: 1px solid var(--theme-border, rgba(255,255,255,0.2)); display: inline-block;"></span>
                                            <span style="width: 14px; height: 14px; border-radius: var(--radius-sm); background: ${accentDot}; display: inline-block;"></span>
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
            const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            modal.style.animation = 'nav-theme-fade-out 0.2s ease';
            if (reducedMotion) modal.remove();
            else setTimeout(() => modal.remove(), 200);
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
                @keyframes nav-theme-fade-out {
                    from { opacity: 1; }
                    to { opacity: 0; }
                }
                @keyframes nav-theme-fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes nav-theme-scale-in {
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

        const authTitle = document.body.classList.contains('admin-page-body')
            ? 'Админ-панель'
            : null;
        const authLocale = document.body.classList.contains('admin-page-body')
            ? 'ru'
            : null;

        this.authModal = new AuthClass({
            container: document.body,
            mode: 'modal',
            initialView: initialView,
            title: authTitle,
            locale: authLocale,
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
            (window.ConfirmDialog ? window.ConfirmDialog.alert({ message: 'Failed to sign out. Please try again.' }) : window.alert('Failed to sign out. Please try again.'));
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
        } else if (window.location.pathname.includes('src/pages/downloads/')) {
            currentPage = 'downloads';
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
// Tactile feedback: toggle-style actions (favourite, watchlist, watched…) give a short spring pop.
if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.addEventListener && !window.__uiPopFeedbackBound) {
    window.__uiPopFeedbackBound = true;
    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element
            ? event.target.closest('[data-action^="toggle-"], .rate-movie-btn')
            : null;
        if (!target) return;
        const icon = target.querySelector('svg') || target;
        icon.classList.remove('ui-pop');
        // Restart the animation when the same control is pressed again quickly.
        void icon.getBoundingClientRect();
        icon.classList.add('ui-pop');
        icon.addEventListener('animationend', () => icon.classList.remove('ui-pop'), { once: true });
    }, true);
}

// Count-up: numbers marked with data-count-to roll up from zero once when they appear.
if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof MutationObserver === 'function' && !window.__countUpBound) {
    window.__countUpBound = true;
    const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const animate = (element) => {
        if (element.dataset.counted) return;
        element.dataset.counted = 'true';
        const raw = String(element.dataset.countTo || '');
        const target = parseFloat(raw.replace(',', '.'));
        if (!Number.isFinite(target) || target <= 0 || reduceMotion()) return;
        const decimals = (raw.split(/[.,]/)[1] || '').length;
        const start = performance.now();
        const duration = 650;
        const step = (now) => {
            if (!element.isConnected) return;
            // A frame's time can precede `start` when a long task ran in between; a
            // negative progress would roll the number below zero.
            const progress = Math.min(1, Math.max(0, (now - start) / duration));
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = progress < 1 ? (target * eased).toFixed(decimals) : raw;
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };
    const scan = (root) => {
        if (!(root instanceof Element)) return;
        if (root.matches('[data-count-to]')) animate(root);
        root.querySelectorAll('[data-count-to]:not([data-counted])').forEach(animate);
    };
    const start = () => {
        scan(document.body);
        new MutationObserver((records) => {
            for (const record of records) record.addedNodes.forEach(scan);
        }).observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Navigation;
} else {
    window.Navigation = Navigation;
}
