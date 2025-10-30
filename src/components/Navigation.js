/**
 * Navigation Component
 * Global navigation header for all pages
 */
class Navigation {
    constructor(currentPage = '') {
        this.currentPage = currentPage;
        this.user = null;
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
                        <div class="nav-logo-icon">🎬</div>
                        <span>Movie Ratings</span>
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
                        <div class="nav-item">
                            <a href="#" class="nav-link" data-page="settings" id="navSettings">
                                <span class="nav-icon">⚙️</span>
                                <span>Settings</span>
                            </a>
                        </div>
                    </nav>

                    <!-- User Section -->
                    <div class="nav-user" id="navUser">
                        <div class="nav-user-info" id="navUserInfo" style="display: none;">
                            <img src="/icons/icon48.png" alt="User" class="nav-user-avatar" id="navUserAvatar">
                            <span class="nav-user-name" id="navUserName">User</span>
                        </div>
                        <button class="nav-settings-btn" id="navSettingsBtn" style="display: none;">Settings</button>
                        <button class="nav-logout-btn" id="navLogoutBtn" style="display: none;">Sign Out</button>
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

        // Settings button
        const settingsBtn = document.getElementById('navSettingsBtn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                this.navigateToPage('settings');
            });
        }

        // Logout button
        const logoutBtn = document.getElementById('navLogoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.handleLogout();
            });
        }

        // Close mobile menu when clicking outside
        document.addEventListener('click', (e) => {
            if (navMenu && !navMenu.contains(e.target) && !mobileToggle.contains(e.target)) {
                navMenu.classList.remove('active');
            }
        });
    }

    setupAuthListener() {
        // Listen for auth state changes
        if (typeof firebaseManager !== 'undefined') {
            firebaseManager.onAuthStateChanged((user) => {
                this.updateUserDisplay(user);
            });
        } else {
            // Fallback for pages without firebaseManager
            setTimeout(() => {
                if (typeof firebaseManager !== 'undefined') {
                    firebaseManager.onAuthStateChanged((user) => {
                        this.updateUserDisplay(user);
                    });
                }
            }, 1000);
        }
    }

    updateUserDisplay(user) {
        this.user = user;
        const userInfo = document.getElementById('navUserInfo');
        const userAvatar = document.getElementById('navUserAvatar');
        const userName = document.getElementById('navUserName');
        const settingsBtn = document.getElementById('navSettingsBtn');
        const logoutBtn = document.getElementById('navLogoutBtn');

        if (user && userInfo && userName && settingsBtn && logoutBtn) {
            // Show user info
            userInfo.style.display = 'flex';
            settingsBtn.style.display = 'block';
            logoutBtn.style.display = 'block';

            // Update user data
            userName.textContent = user.displayName || user.email || 'User';
            if (userAvatar && user.photoURL) {
                userAvatar.src = user.photoURL;
            }
        } else if (userInfo && settingsBtn && logoutBtn) {
            // Hide user info
            userInfo.style.display = 'none';
            settingsBtn.style.display = 'none';
            logoutBtn.style.display = 'none';
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
