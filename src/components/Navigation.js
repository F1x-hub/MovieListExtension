/**
 * Navigation Component
 * Global navigation header for all pages
 */
class Navigation {
    constructor(currentPage = '') {
        this.currentPage = currentPage;
        this.user = null;
        this.authCheckInterval = null;
        this.init();
    }

    init() {
        this.render();
        this.setupEventListeners();
        this.setupAuthListener();
    }

    render() {
        const navHTML = `
            <header class="nav-header">
                <div class="nav-container">
                    <!-- Logo Section -->
                    <a href="#" class="nav-logo" id="navLogo">
                        <img src="/icons/icon48.png" alt="Movie Ratings" class="nav-logo-image">
                    </a>

                    <!-- Mobile Toggle -->
                    <button class="nav-mobile-toggle" id="navMobileToggle">
                        <span>☰</span>
                    </button>

                    <!-- Navigation Menu -->
                    <nav class="nav-menu" id="navMenu">
                        <div class="nav-item">
                            <a href="#" class="nav-link" data-page="search" id="navSearch">
                                <span class="nav-icon">🔍</span>
                                <span>Search Movies</span>
                            </a>
                        </div>
                        <div class="nav-item">
                            <a href="#" class="nav-link" data-page="ratings" id="navRatings">
                                <span class="nav-icon">⭐</span>
                                <span>My Collection</span>
                            </a>
                        </div>
                    </nav>

                    <!-- User Section -->
                    <div class="nav-user" id="navUser">
                        <!-- User Profile Dropdown -->
                        <div class="nav-user-profile" id="navUserProfile" style="display: none;">
                            <button class="nav-user-trigger" id="navUserTrigger">
                                <img src="/icons/icon48.png" alt="User" class="nav-user-avatar" id="navUserAvatar">
                                <span class="nav-user-name" id="navUserName">User</span>
                                <span class="nav-dropdown-arrow">▼</span>
                            </button>
                            
                            <!-- Dropdown Menu -->
                            <div class="nav-user-dropdown" id="navUserDropdown">
                                <div class="nav-dropdown-item" id="navDropdownSettings">
                                    <span class="nav-dropdown-icon">⚙️</span>
                                    <span>Settings</span>
                                </div>
                                <div class="nav-dropdown-divider"></div>
                                <div class="nav-dropdown-item nav-dropdown-logout" id="navDropdownLogout">
                                    <span class="nav-dropdown-icon">🚪</span>
                                    <span>Log Out</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Sign In Button (for non-authenticated users) -->
                        <button class="nav-signin-btn" id="navSignInBtn" style="display: none;">
                            <span class="nav-signin-icon">👤</span>
                            <span>Sign In</span>
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
                navMenu.classList.toggle('active');
            });
        }

        // Navigation links
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                this.navigateToPage(page);
            });
        });

        // Logo click - go to popup/home
        const navLogo = document.getElementById('navLogo');
        if (navLogo) {
            navLogo.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateToPage('home');
            });
        }

        // User dropdown functionality
        this.setupUserDropdown();

        // Sign In button
        const signInBtn = document.getElementById('navSignInBtn');
        if (signInBtn) {
            signInBtn.addEventListener('click', () => {
                this.handleSignIn();
            });
        }

        // Close mobile menu when clicking outside
        document.addEventListener('click', (e) => {
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
            // Toggle dropdown on user trigger click
            userTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = userDropdown.classList.contains('active');
                
                // Close all other dropdowns first
                this.closeAllDropdowns();
                
                if (!isOpen) {
                    userDropdown.classList.add('active');
                    userTrigger.classList.add('active');
                }
            });

            // Settings dropdown item
            if (dropdownSettings) {
                dropdownSettings.addEventListener('click', () => {
                    this.closeAllDropdowns();
                    this.navigateToPage('settings');
                });
            }

            // Logout dropdown item
            if (dropdownLogout) {
                dropdownLogout.addEventListener('click', () => {
                    this.closeAllDropdowns();
                    this.handleLogout();
                });
            }

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
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

    setupAuthListener() {
        // Listen for auth state changes via firebaseManager
        if (typeof firebaseManager !== 'undefined') {
            console.log('Navigation: Firebase Manager available, setting up auth listener');
            firebaseManager.onAuthStateChanged((user) => {
                console.log('Navigation: Firebase auth state changed:', user ? (user.displayName || user.email) : 'No user');
                this.updateUserDisplay(user);
            });
            
            // Also check current user immediately
            const currentUser = firebaseManager.getCurrentUser();
            if (currentUser) {
                console.log('Navigation: Found current Firebase user:', currentUser.displayName || currentUser.email);
                this.updateUserDisplay(currentUser);
            }
        } else {
            // Fallback for pages without firebaseManager
            console.log('Navigation: Firebase Manager not available, setting up fallback');
            setTimeout(() => {
                if (typeof firebaseManager !== 'undefined') {
                    console.log('Navigation: Firebase Manager became available');
                    firebaseManager.onAuthStateChanged((user) => {
                        console.log('Navigation: Firebase auth state changed (delayed):', user ? (user.displayName || user.email) : 'No user');
                        this.updateUserDisplay(user);
                    });
                    
                    // Check current user
                    const currentUser = firebaseManager.getCurrentUser();
                    if (currentUser) {
                        console.log('Navigation: Found current Firebase user (delayed):', currentUser.displayName || currentUser.email);
                        this.updateUserDisplay(currentUser);
                    }
                } else {
                    // If no firebaseManager, check chrome.storage periodically
                    console.log('Navigation: Firebase Manager still not available, using storage fallback');
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
            console.log('Navigation: Received firebaseManagerReady event');
            if (typeof firebaseManager !== 'undefined') {
                const currentUser = firebaseManager.getCurrentUser();
                if (currentUser) {
                    console.log('Navigation: Found user after firebaseManagerReady:', currentUser.displayName || currentUser.email);
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
                        console.log('Navigation: Found valid auth in storage:', result.user.displayName || result.user.email);
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
                console.log('Navigation: No valid auth found in storage');
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
                    console.log('Navigation: Storage auth state changed, updating display');
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

    updateUserDisplay(user) {
        this.user = user;
        const userProfile = document.getElementById('navUserProfile');
        const userAvatar = document.getElementById('navUserAvatar');
        const userName = document.getElementById('navUserName');
        const signInBtn = document.getElementById('navSignInBtn');

        console.log('Navigation: Updating user display:', user ? (user.displayName || user.email) : 'No user');

        if (user && userProfile && userName) {
            // Show user profile dropdown
            userProfile.style.display = 'block';
            if (signInBtn) signInBtn.style.display = 'none';

            // Update user data
            userName.textContent = user.displayName || user.email || 'User';
            if (userAvatar) {
                if (user.photoURL) {
                    userAvatar.src = user.photoURL;
                } else {
                    // Use default avatar if no photo
                    userAvatar.src = '/icons/icon48.png';
                }
            }
        } else {
            // Hide user profile, show sign in button
            if (userProfile) userProfile.style.display = 'none';
            if (signInBtn) signInBtn.style.display = 'flex';
        }
    }

    setActivePage(page) {
        // Remove active class from all links
        const navLinks = document.querySelectorAll('.nav-link');
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
        // Check if we're in popup context
        if (window.location.pathname.includes('popup.html')) {
            // In popup, open new tabs as before
            let url = '';
            
            switch (page) {
                case 'home':
                    window.location.reload();
                    return;
                case 'search':
                    url = chrome.runtime.getURL('search.html');
                    break;
                case 'ratings':
                    url = chrome.runtime.getURL('ratings.html');
                    break;
                case 'settings':
                    this.showSettingsModal();
                    return;
                default:
                    return;
            }

            if (url && chrome.tabs) {
                chrome.tabs.create({ url });
            }
            return;
        }

        // For extension pages, use simple navigation on same tab
        let url = '';
        
        switch (page) {
            case 'search':
                url = chrome.runtime.getURL('search.html');
                break;
            case 'ratings':
                url = chrome.runtime.getURL('ratings.html');
                break;
            case 'settings':
                this.showSettingsModal();
                return;
            default:
                return;
        }

        if (url) {
            // Navigate on same tab
            window.location.href = url;
        }
    }

    showSettingsModal() {
        // Simple settings modal for now
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

        modal.innerHTML = `
            <div style="
                background: white;
                padding: 30px;
                border-radius: 12px;
                max-width: 400px;
                width: 90%;
                text-align: center;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            ">
                <h3 style="margin: 0 0 20px 0; color: #333;">Settings</h3>
                <p style="color: #666; margin-bottom: 20px;">Settings feature coming soon!</p>
                <button onclick="this.closest('div').remove()" style="
                    background: #667eea;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 6px;
                    cursor: pointer;
                    font-weight: 500;
                ">Close</button>
            </div>
        `;

        document.body.appendChild(modal);

        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    handleSignIn() {
        // Redirect to popup for sign in
        if (!window.location.pathname.includes('popup.html')) {
            window.location.href = chrome.runtime.getURL('popup.html');
        } else {
            // If already on popup, just reload
            window.location.reload();
        }
    }

    async handleLogout() {
        try {
            if (typeof firebaseManager !== 'undefined') {
                await firebaseManager.signOut();
                // Redirect to popup or refresh
                if (!window.location.pathname.includes('popup.html')) {
                    window.location.href = chrome.runtime.getURL('popup.html');
                } else {
                    window.location.reload();
                }
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
        // Determine current page from URL
        let currentPage = '';
        if (window.location.pathname.includes('search.html')) {
            currentPage = 'search';
        } else if (window.location.pathname.includes('ratings.html')) {
            currentPage = 'ratings';
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
