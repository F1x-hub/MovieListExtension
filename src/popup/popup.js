import { i18n } from '../shared/i18n/I18n.js';

/**
 * PopupManager - Main controller for the Movie Rating Extension popup
 * Handles authentication, search, and rating feed display
 */
class PopupManager {
    constructor() {
        console.log('🎨 PopupManager: Initializing...');
        
        this.ratings = [];
        this.searchTimeout = null;
        this.ratingsLoaded = false;
        this.isLoadingRatings = false; // true only during initial load / force refresh
        
        // Pagination state
        this.lastDocId = null;
        this.lastDoc = null; // Store actual document snapshot for better pagination
        this.hasMore = true;
        this.isLoadingMore = false;      // true only while a pagination fetch is in flight
        this.isBackgroundRefreshing = false; // true during background cache refresh (does NOT block scroll)
        this.ITEMS_PER_PAGE = 10;
        this.observer = null;
        
        // Start initialization
        this.start();
    }

    async start() {
        // Initialize theme first
        this.initializeTheme();
        
        this.elements = this.initializeElements();
        this.setupEventListeners();
        this.setupAuthStateListener();
        
        // Initialize i18n BEFORE loading UI
        await this.initI18n();
        
        // Then initialize UI which might load ratings
        await this.initializeUI();
        
        // Trigger update check when popup opens
        chrome.runtime.sendMessage({ type: 'CHECK_FOR_UPDATES' });
    }

    async initI18n() {
        await i18n.init();
        i18n.translatePage();
        
        // Listen for storage changes to update language in real-time
        chrome.storage.onChanged.addListener((changes) => {
            if (changes.language) {
                console.log('PopupManager: Language changed, re-translating...');
                i18n.currentLocale = changes.language.newValue;
                i18n.translatePage();
                if (this.ratings.length > 0) {
                    this.renderRatings();
                }
            }
        });
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

        // Sync to chrome.storage.local
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ theme: theme });
        }

        // Update extension icon
        if (typeof IconUtils !== 'undefined') {
            IconUtils.updateExtensionIcon(theme);
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
            loginBtn: document.getElementById('loginBtn'), // May not exist anymore, need to check if we renamed it. We used googleLoginBtn
            googleLoginBtn: document.getElementById('googleLoginBtn'),
            logoutBtn: document.getElementById('logoutBtn'),
            
            // Login Forms (Step 1 & 2)
            loginEmailForm: document.getElementById('loginEmailForm'),
            loginPasswordForm: document.getElementById('loginPasswordForm'),
            
            // Login Inputs & Containers
            loginEmail: document.getElementById('loginEmail'),
            loginPassword: document.getElementById('loginPassword'),
            staticEmail: document.getElementById('staticEmail'),
            loginStep1: document.getElementById('loginStep1'),
            loginStep2: document.getElementById('loginStep2'),
            loginFooter: document.getElementById('loginFooter'),
            backToEmailBtn: document.getElementById('backToEmailBtn'),
            
            // Registration Forms
            registerInfoForm: document.getElementById('registerInfoForm'),
            registerPasswordForm: document.getElementById('registerPasswordForm'),
            
            // Registration Inputs & Containers
            registerForm: document.getElementById('registerForm'), // Might be unused if we removed it from HTML, let's keep it if I missed removing references or check logic
            registerEmail: document.getElementById('registerEmail'),
            registerPassword: document.getElementById('registerPassword'),
            registerConfirmPassword: document.getElementById('registerConfirmPassword'),
            registerFirstName: document.getElementById('registerFirstName'),
            registerLastName: document.getElementById('registerLastName'),
            
            staticRegisterEmail: document.getElementById('staticRegisterEmail'),
            staticName: document.getElementById('staticName'),
            staticSurname: document.getElementById('staticSurname'),
            
            registerStep1: document.getElementById('registerStep1'),
            registerStep2: document.getElementById('registerStep2'),
            registerFooter: document.getElementById('registerFooter'),
            backToRegisterInfoBtn: document.getElementById('backToRegisterInfoBtn'),
            googleRegisterBtn: document.getElementById('googleRegisterBtn'), // New button
            
            // Auth Switchers
            showRegisterLink: document.getElementById('showRegisterLink'),
            showLoginLink: document.getElementById('showLoginLink'),
            loginFormSection: document.getElementById('loginFormSection'),
            registerFormSection: document.getElementById('registerFormSection'),
            
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
            errorMessage: document.getElementById('errorMessage'),
            infiniteScrollTrigger: document.getElementById('infiniteScrollTrigger')
        };
    }

    setupEventListeners() {
        // Logo click handler
        const popupLogo = document.getElementById('popupLogo');
        if (popupLogo) {
            popupLogo.addEventListener('click', (e) => {
                e.preventDefault();
                chrome.tabs.create({ url: 'src/pages/home/home.html' });
            });
        }
        
        // Auth events
        if (this.elements.googleLoginBtn) {
            this.elements.googleLoginBtn.addEventListener('click', () => this.handleGoogleLogin());
        }
        this.elements.logoutBtn.addEventListener('click', () => this.handleLogout());
        
        // Two-step login listeners
        if (this.elements.loginEmailForm) {
            this.elements.loginEmailForm.addEventListener('submit', (e) => this.handleEmailStep(e));
        }
        if (this.elements.loginPasswordForm) {
            this.elements.loginPasswordForm.addEventListener('submit', (e) => this.handleEmailLogin(e));
        }
        if (this.elements.backToEmailBtn) {
            this.elements.backToEmailBtn.addEventListener('click', (e) => this.goToStep1(e));
        }
        
        // Two-step registration listeners
        if (this.elements.registerInfoForm) {
            this.elements.registerInfoForm.addEventListener('submit', (e) => this.handleRegisterStep1(e));
        }
        if (this.elements.registerPasswordForm) {
            this.elements.registerPasswordForm.addEventListener('submit', (e) => this.handleRegisterFinal(e));
        }
        if (this.elements.backToRegisterInfoBtn) {
            this.elements.backToRegisterInfoBtn.addEventListener('click', (e) => this.goToRegisterStep1(e));
        }
        if (this.elements.googleRegisterBtn) {
            this.elements.googleRegisterBtn.addEventListener('click', () => this.handleGoogleLogin());
        }
        
        // Replaced old register listener
        // this.elements.registerForm.addEventListener('submit', (e) => this.handleEmailRegister(e));
        
        // Auth Switching
        this.setupAuthSwitching();
         
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
        this.elements.settingsBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: 'src/pages/settings/settings.html' });
        });
        
        // Password toggle
        this.setupPasswordToggles();
        
        // Infinite scroll observer
        this.setupIntersectionObserver();
    }

    setupIntersectionObserver() {
        const options = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1
        };
        
        this.observer = new IntersectionObserver((entries) => {
            const entry = entries[0];
            const el = this.elements.infiniteScrollTrigger;
            // 🔍 Log 4: every IO callback
            console.log('👁️ IntersectionObserver fired:', {
                isIntersecting: entry.isIntersecting,
                intersectionRatio: entry.intersectionRatio,
                triggerDisplay: el?.style.display,
                isLoadingMore: this.isLoadingMore,
                isBackgroundRefreshing: this.isBackgroundRefreshing,
                hasMore: this.hasMore,
                ratingsLoaded: this.ratingsLoaded
            });
            // Only isLoadingMore blocks pagination — background refresh runs in parallel
            if (entry.isIntersecting && this.hasMore && !this.isLoadingMore && this.ratingsLoaded) {
                console.log('🔄 Infinite scroll: trigger visible, conditions met → loadMoreRatings()');
                this.loadMoreRatings();
            } else if (entry.isIntersecting) {
                console.log('⛔ Infinite scroll: trigger visible but blocked:', {
                    hasMore: this.hasMore,
                    isLoadingMore: this.isLoadingMore,
                    ratingsLoaded: this.ratingsLoaded
                });
            }
        }, options);
        
        if (this.elements.infiniteScrollTrigger) {
            this.observer.observe(this.elements.infiniteScrollTrigger);
            console.log('👁️ IntersectionObserver attached to #infiniteScrollTrigger');
        }
    }

    /** Show the infinite scroll trigger and re-attach the observer so it fires reliably */
    showTrigger() {
        const el = this.elements.infiniteScrollTrigger;
        if (!el) return;
        // 🔍 Log 6: trigger visibility change
        console.log('🎯 SHOW trigger', { hasMore: this.hasMore, ratingsCount: this.ratings?.length });
        if (this.observer) this.observer.unobserve(el);
        el.style.display = 'flex';
        if (this.observer) this.observer.observe(el);
    }

    /** Hide the infinite scroll trigger and detach the observer */
    hideTrigger() {
        const el = this.elements.infiniteScrollTrigger;
        if (!el) return;
        // 🔍 Log 6: trigger visibility change
        console.log('🎯 HIDE trigger', { hasMore: this.hasMore, ratingsCount: this.ratings?.length });
        if (this.observer) this.observer.unobserve(el);
        el.style.display = 'none';
    }

    setupAuthSwitching() {
        if (this.elements.showRegisterLink) {
            this.elements.showRegisterLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchAuthForm('register');
            });
        }

        if (this.elements.showLoginLink) {
            this.elements.showLoginLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchAuthForm('login');
            });
        }
    }

    switchAuthForm(target) {
        if (target === 'register') {
            this.elements.loginFormSection.classList.remove('active');
            setTimeout(() => {
                this.elements.loginFormSection.style.display = 'none';
                this.elements.registerFormSection.style.display = 'block';
                // Trigger reflow
                void this.elements.registerFormSection.offsetWidth;
                this.elements.registerFormSection.classList.add('active');
                
                // Reset registration steps to 1 just in case
                this.goToRegisterStep1();
                
            }, 300); // Wait for fade out
        } else {
            this.elements.registerFormSection.classList.remove('active');
            setTimeout(() => {
                this.elements.registerFormSection.style.display = 'none';
                this.elements.loginFormSection.style.display = 'block';
                // Trigger reflow
                void this.elements.loginFormSection.offsetWidth;
                this.elements.loginFormSection.classList.add('active');
                
                // Reset login steps to 1
                this.goToStep1();
                
            }, 300);
        }
    }

    setupPasswordToggles() {
        document.querySelectorAll('.toggle-password').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault(); // Prevent focus loss or form submit
                const input = btn.previousElementSibling;
                if (input && input.tagName === 'INPUT') {
                    if (input.type === 'password') {
                        input.type = 'text';
                        btn.innerHTML = Icons.EYE_OFF;
                    } else {
                        input.type = 'password';
                        btn.innerHTML = Icons.EYE;
                    }
                }
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
        console.log('🚀 PopupManager: Initializing UI...');
        
        // Check for updates first
        this.checkPendingUpdate();

        // ===== FAST PATH: Check stored auth data FIRST =====
        // This allows instant loading when user is already authenticated
        const authData = await AuthManager.getAuthData();
        
        // Optimistic check: if we have a user stored, we are likely logged in.
        // Don't wait for strict token validation for the VISUAL state to prevent flickering.
        if (authData && authData.user) {
            console.log('✅ PopupManager: Found stored user, showing UI immediately (Optimistic)');
            
            // Show authenticated UI immediately
            this.updateAuthUI(true, authData.user, false);
            this.elements.authSection.style.display = 'none';
            this.elements.initialLoading.style.display = 'none';
            this.elements.mainContent.style.display = 'flex';
            
            // Check if token is actually valid for data fetching
            if (AuthManager.isTokenValid(authData)) {
                // Load ratings in background
                this.loadRatings().catch(err => {
                    console.error('Background ratings load failed:', err);
                    this.showError('Failed to load ratings');
                });
            } else {
                console.log('⏳ PopupManager: Token expired/invalid, waiting for refresh...');
                // Show loading state in the feed/content area while we wait for token refresh
                this.showLoading(true);
                
                // If we have a refresh token (added in recent updates), we could try to refresh proactively here
                // if the background alarm didn't catch it. 
                // But typically firebaseSDK will auto-refresh and fire authStateChanged.
            }
            
            return; // Early exit
        }
        
        // ===== SLOW PATH: No valid stored auth, need to check Firebase =====
        console.log('⏳ PopupManager: No valid stored auth, checking Firebase...');
        
        // Check if Firebase already has a user (edge case: just logged in)
        const currentUser = firebaseManager.getCurrentUser();
        
        if (currentUser) {
            console.log('✅ PopupManager: Firebase user found, showing authenticated UI');
            this.updateAuthUI(true, currentUser, false);
            this.elements.authSection.style.display = 'none';
            this.elements.initialLoading.style.display = 'flex';
            
            // Load ratings (with loading spinner this time)
            this.loadRatings().catch(err => {
                console.error('Ratings load failed:', err);
                this.showError('Failed to load ratings');
                this.updateAuthUI(false, null, true);
            });
        } else {
            // No auth anywhere - show login form
            console.log('❌ PopupManager: No authentication found, showing login form');
            this.updateAuthUI(false, null, true);
        }
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
            versionEl.textContent = `${i18n.get('popup.update.version')} ${version}`;
            banner.style.display = 'flex';

            // Update button handler
            updateBtn.onclick = () => {
                updateBtn.textContent = i18n.currentLocale === 'ru' ? 'Загрузка...' : 'Downloading...';
                updateBtn.disabled = true;
                
                chrome.runtime.sendMessage({ type: 'DOWNLOAD_UPDATE', url: url }, (response) => {
                    if (response && response.success) {
                        // Banner will stay until download completes and instructions open
                        // But we can update text to show progress
                        updateBtn.textContent = i18n.currentLocale === 'ru' ? 'Открытие...' : 'Opening...';
                    } else {
                        updateBtn.textContent = i18n.currentLocale === 'ru' ? 'Ошибка' : 'Error';
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

    async loadUserDisplayPreferences(userId) {
        try {
            // Check if we have cached profile data first to avoid flickering
            const cachedProfile = await this.getCachedProfile(userId);
            if (cachedProfile) {
                this.applyDisplayName(cachedProfile);
            }

            // Fetch fresh data
            if (firebaseManager && firebaseManager.getUserService) {
                const userService = firebaseManager.getUserService();
                const profile = await userService.getUserProfile(userId);
                
                if (profile) {
                    this.cacheProfile(userId, profile);
                    this.applyDisplayName(profile);
                }
            }
        } catch (error) {
            console.error('Error loading user display preferences:', error);
        }
    }

    applyDisplayName(profile) {
        if (!this.elements.userName || !profile) return;

        const format = profile.displayNameFormat || 'fullname';
        let displayText = profile.displayName || 'User';

        if (format === 'username' && profile.username) {
            displayText = profile.username;
        }

        this.elements.userName.textContent = displayText;
    }

    async getCachedProfile(userId) {
        return new Promise((resolve) => {
            chrome.storage.local.get([`user_profile_${userId}`], (result) => {
                resolve(result[`user_profile_${userId}`] || null);
            });
        });
    }

    cacheProfile(userId, profile) {
        const key = `user_profile_${userId}`;
        chrome.storage.local.set({ [key]: profile });
    }

    updateAuthUI(isAuthenticated, user, showContent = true) {
        if (isAuthenticated) {
            this.elements.authSection.style.display = 'none';
            this.elements.statusIndicator.classList.add('authenticated');
            this.elements.statusText.textContent = i18n.get('popup.header.signed_in_as').replace('{user}', user?.displayName || user?.email || 'User');
            
            // Update user info
            this.elements.userName.textContent = user?.displayName || user?.email || 'User';
            if (user?.photoURL) {
                this.elements.userAvatar.src = user.photoURL;
                this.elements.userAvatar.style.display = 'block';
            }

            // Fetch and apply profile preferences (display name format)
            if (user?.uid) {
                this.loadUserDisplayPreferences(user.uid);
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
            this.elements.statusText.textContent = i18n.get('popup.header.not_authenticated');
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
            this.showError(`${i18n.currentLocale === 'ru' ? 'Ошибка входа через Google' : 'Google login failed'}: ${error.message}`);
        }
    }

    handleRegisterStep1(e) {
        e.preventDefault();
        const firstName = this.elements.registerFirstName.value.trim();
        const lastName = this.elements.registerLastName.value.trim();
        const email = this.elements.registerEmail.value.trim();
        
        if (!firstName || !lastName || !email) {
            this.showError(i18n.get('popup.auth.fill_all'));
            return;
        }
        
        if (!this.isValidEmail(email)) {
            this.showError(i18n.currentLocale === 'ru' ? 'Пожалуйста, введите корректный адрес электронной почты' : 'Please enter a valid email address');
            return;
        }
        
        this.hideError();
        
        // Populate static fields
        this.elements.staticName.textContent = firstName;
        this.elements.staticSurname.textContent = lastName;
        this.elements.staticRegisterEmail.textContent = email;
        
        // Switch views
        this.elements.registerStep1.style.display = 'none';
        
        // Hide Step 1 elements
        const dividers = document.getElementById('registerFormSection').querySelectorAll('.auth-divider');
        dividers.forEach(d => d.style.display = 'none');
        if (this.elements.registerFooter) this.elements.registerFooter.style.display = 'none';
        
        this.elements.registerStep2.style.display = 'block';
        this.elements.registerPassword.focus();
    }
    
    goToRegisterStep1(e) {
        if (e) e.preventDefault();
        
        this.elements.registerStep2.style.display = 'none';
        this.elements.registerStep1.style.display = 'block';
        
        const dividers = document.getElementById('registerFormSection').querySelectorAll('.auth-divider');
        dividers.forEach(d => d.style.display = 'block');
        if (this.elements.registerFooter) this.elements.registerFooter.style.display = 'block';
    }

    goToStep1(e) {
        if (e) e.preventDefault();
        
        this.elements.loginStep2.style.display = 'none';
        this.elements.loginStep1.style.display = 'block';
        
        // Show Google button and footer again
        if (this.elements.googleLoginBtn) this.elements.googleLoginBtn.style.display = 'flex';
        // Re-show divider if it was hidden (it's a sibling usually, handled by parent visibility but if we hid specific elements we need to show them)
        const dividers = document.querySelectorAll('.auth-divider');
        dividers.forEach(d => d.style.display = 'block');
        
        if (this.elements.loginFooter) this.elements.loginFooter.style.display = 'block';
        
        // Focus email
        this.elements.loginEmail.focus();
    }

    handleEmailStep(e) {
        e.preventDefault();
        const email = this.elements.loginEmail.value.trim();
        
        if (!email) {
            this.showError(i18n.currentLocale === 'ru' ? 'Пожалуйста, введите ваш email' : 'Please enter your email');
            return;
        }
        
        if (!this.isValidEmail(email)) {
            this.showError(i18n.currentLocale === 'ru' ? 'Пожалуйста, введите корректный адрес электронной почты' : 'Please enter a valid email address');
            return;
        }
        
        this.hideError();
        this.elements.staticEmail.textContent = email;
        
        // Switch to Step 2
        this.elements.loginStep1.style.display = 'none';
        
        // Hide Google button and specific footer for clean look in step 2
        if (this.elements.googleLoginBtn) this.elements.googleLoginBtn.style.display = 'none';
        const dividers = document.querySelectorAll('.auth-divider');
        dividers.forEach(d => d.style.display = 'none');
        
        if (this.elements.loginFooter) this.elements.loginFooter.style.display = 'none';
        
        this.elements.loginStep2.style.display = 'block';
        this.elements.loginPassword.focus();
    }

    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    async handleEmailLogin(e) {
        e.preventDefault();
        
        const email = this.elements.loginEmail.value.trim();
        const password = this.elements.loginPassword.value;

        if (!email || !password) {
            this.showError(i18n.get('popup.auth.fill_all'));
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
            
            // Reset forms
            if (this.elements.loginEmailForm) this.elements.loginEmailForm.reset();
            if (this.elements.loginPasswordForm) this.elements.loginPasswordForm.reset();
            
            // Hide auth section, show initial loading, prepare for content
            this.elements.authSection.style.display = 'none';
            this.elements.initialLoading.style.display = 'flex';
            this.updateAuthUI(true, user, false);
            
            this.loadRatings();
        } catch (error) {
            this.showError(`${i18n.currentLocale === 'ru' ? 'Ошибка входа по email' : 'Email login failed'}: ${error.message}`);
        }
    }

    async handleRegisterFinal(e) {
        e.preventDefault();
        
        const email = this.elements.registerEmail.value.trim();
        const password = this.elements.registerPassword.value;
        const confirmPassword = this.elements.registerConfirmPassword.value;

        if (!password || !confirmPassword) {
            this.showError(i18n.get('popup.auth.fill_all'));
            return;
        }

        if (password.length < 6) {
            this.showError(i18n.get('popup.auth.password_min_length'));
            return;
        }
        
        if (password !== confirmPassword) {
            this.showError(i18n.get('popup.auth.passwords_dont_match'));
            return;
        }

        try {
            this.hideError();
            await firebaseManager.createUserWithEmail(email, password);
            
            // Create user profile
            const user = firebaseManager.getCurrentUser();
            const userService = firebaseManager.getUserService();
            
            const firstName = this.elements.registerFirstName.value.trim();
            const lastName = this.elements.registerLastName.value.trim();
            const displayName = `${firstName} ${lastName}`.trim() || user.email.split('@')[0];

            await userService.createOrUpdateUserProfile(user.uid, {
                displayName: displayName,
                firstName: firstName,
                lastName: lastName,
                photoURL: user.photoURL,
                email: user.email,
                createdAt: user.metadata.creationTime
            });
            
            // Reset forms
            if (this.elements.registerInfoForm) this.elements.registerInfoForm.reset();
            if (this.elements.registerPasswordForm) this.elements.registerPasswordForm.reset();
            if (this.elements.registerForm) this.elements.registerForm.reset();
            
            this.goToRegisterStep1(); // Reset UI state
            
            // Hide auth section, show initial loading, prepare for content
            this.elements.authSection.style.display = 'none';
            this.elements.initialLoading.style.display = 'flex';
            this.updateAuthUI(true, user, false);
            
            this.loadRatings();
        } catch (error) {
            this.showError(`${i18n.currentLocale === 'ru' ? 'Ошибка регистрации' : 'Registration failed'}: ${error.message}`);
        }
    }

    async handleLogout() {
        try {
            this.showLoading(true);
            this.hideError();
            
            // Clear ratings cache on logout
            const ratingsCacheService = firebaseManager.getRatingsCacheService();
            await ratingsCacheService.clearCache();
            
            // Clear AuthManager data (chrome.storage.local)
            await AuthManager.clearAuthData();
            
            await firebaseManager.signOut();
            this.ratings = [];
            this.ratingsLoaded = false;
            this.isLoadingRatings = false;
            this.lastDocId = null;
            this.hasMore = true;
            this.isLoadingMore = false;
            this.hideTrigger();
            this.renderRatings();
        } catch (error) {
            this.showError(`${i18n.currentLocale === 'ru' ? 'Ошибка выхода' : 'Logout failed'}: ${error.message}`);
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
                    <img src="${movie.posterUrl || (typeof IconUtils !== 'undefined' ? IconUtils.getIconPath(document.body.classList.contains('light-theme') ? 'light' : 'dark', 48) : '/icons/icon48-white.png')}" alt="${name}" class="search-result-poster">
                    <div class="search-result-info">
                        <h4 class="search-result-title">${this.escapeHtml(name)}</h4>
                        <p class="search-result-meta">${movie.year} • ${movie.genres.slice(0, 2).join(', ')}</p>
                        ${movie.votes?.kp ? `<span class="search-result-votes">${i18n.get('movie_details.votes_count').replace('{count}', movie.votes.kp)}</span>` : ''}
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
            url: chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`) 
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
            
            // Reset pagination state for fresh load
            this.lastDocId = null;
            this.lastDoc = null;
            this.hasMore = true;
            this.isLoadingMore = false;
            // Hide trigger spinner — it must never appear during initial load
            this.hideTrigger();
            
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
            
            // Temporarily wrap refreshCacheInBackground to track isBackgroundRefreshing flag
            const origRefresh = ratingsCacheService.refreshCacheInBackground.bind(ratingsCacheService);
            ratingsCacheService.refreshCacheInBackground = async (...args) => {
                this.isBackgroundRefreshing = true;
                console.log('🔄 [PopupManager] Background cache refresh started');
                try {
                    return await origRefresh(...args);
                } finally {
                    this.isBackgroundRefreshing = false;
                    console.log('✅ [PopupManager] Background cache refresh finished');
                    // Restore original method
                    ratingsCacheService.refreshCacheInBackground = origRefresh;
                }
            };
            
            const result = await ratingsCacheService.getCachedRatingsWithBackgroundRefresh(this.ITEMS_PER_PAGE, null); // Load first page
            const cacheEndTime = performance.now();
            const cacheLoadTime = Math.round(cacheEndTime - cacheStartTime);
            
            console.log(`✅ [PopupManager] Got result from cache service in ${cacheLoadTime}ms:`, { 
                ratingsCount: result.ratings.length, 
                isFromCache: result.isFromCache,
                hasMore: result.hasMore,
                loadTime: `${cacheLoadTime}ms`
            });
            
            this.ratings = result.ratings;
            this.lastDocId = result.lastDocId;
            this.lastDoc = result.lastDoc;
            this.hasMore = result.hasMore !== undefined ? result.hasMore : (result.ratings.length === this.ITEMS_PER_PAGE);
            
            // Render ratings (both cached and fresh data)
            const renderStartTime = performance.now();
            await this.renderRatings(false); // false = replace content (not append)
            const renderEndTime = performance.now();
            const renderTime = Math.round(renderEndTime - renderStartTime);
            
            this.ratingsLoaded = true;
            
            // Now that first batch is shown, update trigger visibility based on hasMore
            if (this.hasMore) { this.showTrigger(); } else { this.hideTrigger(); }
            
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
            this.showError(`${i18n.currentLocale === 'ru' ? 'Не удалось загрузить оценки' : 'Failed to load ratings'}: ${error.message}`);
        } finally {
            this.isLoadingRatings = false; // Reset flag
        }
    }

    async loadMoreRatings() {
        // 🔍 Log 2: state before the guard check
        console.log('🔄 loadMoreRatings called:', {
            isLoadingMore: this.isLoadingMore,
            isBackgroundRefreshing: this.isBackgroundRefreshing,
            hasMore: this.hasMore,
            lastDocId: this.lastDocId,
            lastDocType: this.lastDoc ? typeof this.lastDoc : 'null',
            lastDocClass: this.lastDoc?.constructor?.name ?? 'null',
            ratingsCount: this.ratings?.length
        });
        // isLoadingMore is the ONLY flag that blocks pagination
        // isBackgroundRefreshing does NOT block — background refresh and pagination can coexist
        if (this.isLoadingMore || !this.hasMore) {
            console.warn('⛔ loadMoreRatings BLOCKED:', { isLoadingMore: this.isLoadingMore, hasMore: this.hasMore });
            return;
        }
        
        try {
            this.isLoadingMore = true;
            const cursor = this.lastDoc || this.lastDocId;
            console.log('📤 loadMoreRatings: sending cursor to fetchAndCacheRatings:', {
                cursorType: cursor === null ? 'null' : typeof cursor,
                cursorIsSnapshot: cursor !== null && typeof cursor === 'object',
                cursorId: cursor?.id ?? cursor,
                cursorClass: cursor?.constructor?.name ?? 'N/A'
            });
            
            const ratingsCacheService = firebaseManager.getRatingsCacheService();
            const result = await ratingsCacheService.fetchAndCacheRatings(this.ITEMS_PER_PAGE, cursor);
            
            // 🔍 Log 3: what came back
            console.log('📦 loadMoreRatings: fetchAndCacheRatings result:', {
                ratingsCount: result?.ratings?.length,
                newLastDocId: result?.lastDocId,
                newLastDocType: result?.lastDoc ? typeof result.lastDoc : 'null',
                newLastDocClass: result?.lastDoc?.constructor?.name ?? 'null',
                hasMore: result?.hasMore
            });
            
            if (result.ratings.length > 0) {
                const startIndex = this.ratings.length;
                this.ratings = [...this.ratings, ...result.ratings];
                // 🔍 Log 1: what we save as cursors
                console.log('💾 Saving new cursors after loadMore:', {
                    lastDocId: result.lastDocId,
                    lastDocType: result.lastDoc ? typeof result.lastDoc : 'null',
                    lastDocClass: result.lastDoc?.constructor?.name ?? 'null',
                    hasMore: result.hasMore
                });
                this.lastDocId = result.lastDocId;
                this.lastDoc = result.lastDoc;
                // Trust the server-side hasMore flag; fallback to count check if missing
                this.hasMore = (result.hasMore !== undefined)
                    ? result.hasMore
                    : (result.ratings.length === this.ITEMS_PER_PAGE);
                
                await this.renderRatings(true, startIndex);
                // renderRatings now handles showTrigger/hideTrigger at the end
            } else {
                // Zero results returned — definitely no more data
                this.hasMore = false;
                this.hideTrigger();
            }
            
        } catch (error) {
            console.error('❌ Error loading more ratings:', error);
            this.hasMore = false;
            this.hideTrigger();
        } finally {
            // 🔍 Log 5: finally block always runs
            console.log('✅ loadMoreRatings finally: isLoadingMore will be reset to false (was:', this.isLoadingMore, ')');
            this.isLoadingMore = false;
            console.log('✅ isLoadingMore reset to false');
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
            
            // Reset pagination state before refresh
            this.lastDocId = null;
            this.lastDoc = null;
            this.hasMore = true;
            this.isLoadingMore = false;
            this.hideTrigger();
            
            console.log('🔄 PopupManager: Force refreshing ratings...');
            
            // Hide feed content with fade out
            await this.hideFeedContentWithFade();
            
            // Show loader with fade in
            await this.showLoadingWithFade();
            
            // Clear cache and fetch fresh data
            const ratingsCacheService = firebaseManager.getRatingsCacheService();
            await ratingsCacheService.clearCache();
            
            const fetchStartTime = performance.now();
            // Force fetch first page
            const result = await ratingsCacheService.fetchAndCacheRatings(this.ITEMS_PER_PAGE, null);
            const ratings = result.ratings;
            const fetchEndTime = performance.now();
            const fetchTime = Math.round(fetchEndTime - fetchStartTime);
            
            this.ratings = result.ratings;
            this.lastDocId = result.lastDocId;
            this.lastDoc = result.lastDoc;
            this.hasMore = result.hasMore;
            
            this.ratingsLoaded = false; // Prevent premature trigger show inside renderRatings
            const renderStartTime = performance.now();
            await this.renderRatings(false); // Replace content
            const renderEndTime = performance.now();
            const renderTime = Math.round(renderEndTime - renderStartTime);
            
            this.ratingsLoaded = true;
            
            // Update trigger visibility now that the refresh is complete
            if (this.hasMore) { this.showTrigger(); } else { this.hideTrigger(); }
            
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
            this.showError(`${i18n.currentLocale === 'ru' ? 'Не удалось обновить оценки' : 'Failed to refresh ratings'}: ${error.message}`);
        } finally {
            this.isLoadingRatings = false; // Reset flag
        }
    }

    async renderRatings(append = false, startIndex = 0) {
        const startTime = performance.now();
        console.log(`⏱️ [PopupManager] Starting renderRatings (append=${append}, index=${startIndex})`);
        
        if (!append) {
            const clearStart = performance.now();
            this.elements.feedContent.innerHTML = '';
            const clearTime = Math.round(performance.now() - clearStart);
            console.log(`⏱️ [PopupManager] Clear feedContent: ${clearTime}ms`);
        } else {
             // If appending, ensure we only process new items
             // The loop below uses this.ratings, so we can iterate starting from startIndex
        }

        if (this.ratings.length === 0 && !this.isLoadingMore) {
            const emptyStateStart = performance.now();
            this.elements.feedContent.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🎬</div>
                    <h3 class="empty-state-title" data-i18n="popup.content.empty_title">${i18n.get('popup.content.empty_title')}</h3>
                    <p class="empty-state-text" data-i18n="popup.content.empty_text">${i18n.get('popup.content.empty_text')}</p>
                </div>
            `;
            const emptyStateTime = Math.round(performance.now() - emptyStateStart);
            console.log(`⏱️ [PopupManager] Render empty state: ${emptyStateTime}ms`);
            return;
        }

        const itemsToRender = append ? this.ratings.slice(startIndex) : this.ratings;
        console.log(`⏱️ [PopupManager] Rendering ${itemsToRender.length} ratings (total: ${this.ratings.length})`);
        
        // Pre-load all average ratings in batch to avoid multiple Firebase calls (only for items to render)
        const averageRatingsStartTime = performance.now();
        const averageRatingsMap = await this.preloadAverageRatings(itemsToRender);
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
        
        for (let i = 0; i < itemsToRender.length; i++) {
            const rating = itemsToRender[i];
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
                    console.log(`⏱️ [PopupManager] Rating ${i+1}/${itemsToRender.length} rendered in ${elementTime}ms (slow)`);
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

        // Re-attach observer AFTER all cards are in the DOM so the trigger's
        // position is final. This ensures IntersectionObserver fires correctly
        // whether the trigger is already in the viewport or not.
        if (append || this.ratingsLoaded) {
            if (this.hasMore) {
                this.showTrigger(); // unobserve → display:flex → observe
            } else {
                this.hideTrigger();
            }
        }
    }

    async preloadAverageRatings(ratingsToLoad = null) {
        const startTime = performance.now();
        const targetRatings = ratingsToLoad || this.ratings;
        const movieIds = [...new Set(targetRatings.map(r => r.movie?.kinopoiskId || r.movieId))];
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
        const timestamp = i18n.formatRelativeTime(rating.createdAt);

        // Get pre-loaded average rating
        const averageData = averageRatingsMap.get(movieId) || { average: 0, count: 0 };
        const averageDisplay = averageData.count > 0 
            ? `${parseFloat(averageData.average.toFixed(1))}` 
            : (i18n.currentLocale === 'ru' ? 'Нет оценок' : 'No ratings');

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
                                    <span class="menu-icon">${Icons.EDIT}</span>
                                    <span>${i18n.get('movie_details.edit')}</span>
                                </button>
                                <button class="menu-item delete-item" data-rating-id="${rating.id}" data-action="delete">
                                    <span class="menu-icon">${Icons.TRASH}</span>
                                    <span>${i18n.get('movie_details.delete')}</span>
                                </button>
                            </div>
                        </div>
                    ` : ''}
                </div>
                <h3 class="rating-movie-title" title="${this.escapeHtml(movieTitle)}">${this.escapeHtml(this.truncateText(movieTitle, 50))}</h3>
                <p class="rating-movie-meta">${movieYear} • ${this.truncateText(movieGenres, 30)}</p>
                <div class="rating-scores">
                    <div class="rating-user-score">
                        <span>${i18n.get('movie_card.my_rating')}:</span>
                        <span class="rating-badge">${rating.rating}</span>
                    </div>
                    <div class="rating-average-score">
                        <span>${i18n.get('movie_card.avg_rating')}:</span>
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
                    url: chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`) 
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
                this.showError(i18n.get('navbar.sign_in'));
                return;
            }
            
            const ratingDoc = await firebaseManager.db.collection('ratings').doc(ratingId).get();
            if (!ratingDoc.exists) {
                this.showError(i18n.currentLocale === 'ru' ? 'Отзыв не найден' : 'Review not found');
                return;
            }
            
            const ratingData = ratingDoc.data();
            this.showEditRatingModalPopup(ratingId, ratingData);
            
        } catch (error) {
            console.error('Error editing rating:', error);
            this.showError(`${i18n.currentLocale === 'ru' ? 'Ошибка при редактировании' : 'Error editing'}: ${error.message}`);
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
                    <h3 style="margin:0; font-size:20px;">${i18n.get('ratings.modal.rate_movie')}</h3>
                    <button id="closeEditModalPopup" style="background:#334155; color:#e2e8f0; border:none; padding:8px 12px; border-radius:8px; cursor:pointer;">✕</button>
                </div>
                
                <form id="editRatingFormPopup">
                    <div style="margin-bottom:16px;">
                        <label style="display:block; margin-bottom:8px; color:#94a3b8;">${i18n.get('ratings.modal.your_rating')}: <span id="editRatingValuePopup">${ratingData.rating}</span></label>
                        <input type="range" id="editRatingSliderPopup" min="1" max="10" value="${ratingData.rating}" style="width:100%;">
                    </div>
                    
                    <div style="margin-bottom:16px;">
                        <label style="display:block; margin-bottom:8px; color:#94a3b8;">${i18n.get('ratings.modal.share_thoughts')}:</label>
                        <textarea id="editRatingCommentPopup" rows="4" maxlength="500" style="width:100%; padding:10px 12px; border-radius:8px; border:1px solid #334155; background:#0b1220; color:#e2e8f0; resize:vertical;">${this.escapeHtml(ratingData.comment || '')}</textarea>
                        <div style="text-align:right; margin-top:4px; font-size:12px; color:#94a3b8;">
                            <span id="editCommentCountPopup">${(ratingData.comment || '').length}</span>/500
                        </div>
                    </div>
                    
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button type="button" id="cancelEditBtnPopup" style="background:#334155; color:#e2e8f0; border:none; padding:10px 16px; border-radius:8px; cursor:pointer;">${i18n.get('ratings.modal.cancel')}</button>
                        <button type="submit" id="saveEditBtnPopup" style="background:#22c55e; color:#062e0f; border:none; padding:10px 16px; border-radius:8px; cursor:pointer; font-weight:600;">${i18n.get('ratings.modal.save')}</button>
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
                this.showSuccess(i18n.get('settings.saved'));
                await this.forceRefreshRatings();
                
            } catch (error) {
                console.error('Error updating rating:', error);
                this.showError(`${i18n.get('settings.save_failed')}: ${error.message}`);
            }
        });
    }

    async deletePopupRating(ratingId) {
        const confirmed = confirm(i18n.get('settings.reset_confirm'));
        
        if (!confirmed) return;
        
        try {
            const ratingService = firebaseManager.getRatingService();
            const currentUser = firebaseManager.getCurrentUser();
            
            if (!currentUser) {
                this.showError(i18n.get('navbar.sign_in'));
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
            
            this.showSuccess(i18n.get('movie_card.remove'));
            
        } catch (error) {
            console.error('Error deleting rating:', error);
            this.showError(`${i18n.currentLocale === 'ru' ? 'Ошибка при удалении' : 'Error deleting'}: ${error.message}`);
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
        console.log('🔍 ========== LAYER DIAGNOSTICS ==========');
        
        // Information about the loader itself
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

        // Check all parent elements
        let parent = loadingElement.parentElement;
        let level = 1;
        console.log('\n📚 PARENT ELEMENTS:');
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

        // Check all elements with z-index in popup-container
        const popupContainer = document.querySelector('.popup-container');
        if (popupContainer) {
            console.log('\n🎯 ELEMENTS WITH Z-INDEX IN POPUP:');
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

            // Sort by z-index
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

        // Check elements that might overlap the loader by coordinates
        console.log('\n📍 ELEMENTS THAT MIGHT OVERLAP LOADER:');
        const loadingCenterX = loadingRect.left + loadingRect.width / 2;
        const loadingCenterY = loadingRect.top + loadingRect.height / 2;
        console.log('  Loader center:', `x:${Math.round(loadingCenterX)} y:${Math.round(loadingCenterY)}`);
        
        const allElementsInPopup = popupContainer ? popupContainer.querySelectorAll('*') : [];
        const overlappingElements = [];
        
        allElementsInPopup.forEach(el => {
            if (el === loadingElement || el.contains(loadingElement)) return;
            
            const rect = el.getBoundingClientRect();
            const styles = window.getComputedStyle(el);
            
            // Check if element overlaps the center of the loader
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
                const status = item.overlapsLoader ? '⚠️ OVERLAPS' : '✅ BELOW';
                console.log(`  ${index + 1}. ${status} - ${item.tag}${item.id ? '#' + item.id : ''}${item.className ? '.' + item.className.split(' ').join('.') : ''}`);
                console.log('     z-index:', item.zIndex, `(${item.zIndexNum})`, '| position:', item.position, '| display:', item.display);
                console.log('     rect:', `top:${item.rect.top} left:${item.rect.left} width:${item.rect.width} height:${item.rect.height}`);
            });
        } else {
            console.log('  ✅ No elements overlapping loader');
        }

        // Additional check: elements above loader by z-index in same area
        console.log('\n🔎 ELEMENTS WITH HIGH Z-INDEX IN LOADER AREA:');
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
            
            // Check if element intersects with loader area
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
            console.log('  ✅ No elements with high z-index in loader area');
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