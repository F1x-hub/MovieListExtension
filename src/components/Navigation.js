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
                        <div class="nav-item nav-item-dropdown">
                            <a href="#" class="nav-link" data-page="ratings" id="navRatings">
                                <span class="nav-icon">⭐</span>
                                <span>My Collection</span>
                                <span class="nav-dropdown-arrow">▼</span>
                            </a>
                            <div class="collection-dropdown" id="collectionDropdown">
                                <div class="dropdown-item" data-page="ratings">
                                    <span class="dropdown-icon">⭐</span>
                                    <span>All Movies</span>
                                </div>
                                <div class="dropdown-item" data-page="watchlist">
                                    <span class="dropdown-icon">🔖</span>
                                    <span>Watchlist</span>
                                    <span class="count" id="watchlistCount">(0)</span>
                                </div>
                                <div class="dropdown-item" data-page="favorites">
                                    <span class="dropdown-icon">❤️</span>
                                    <span>Favorites</span>
                                    <span class="count" id="favoritesCount">(0)</span>
                                </div>
                            </div>
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
                                    <span>Edit Profile</span>
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

        // Collection dropdown functionality
        this.setupCollectionDropdown();

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
        const collectionDropdown = document.getElementById('collectionDropdown');
        const collectionLink = document.getElementById('navRatings');
        
        if (userDropdown && userTrigger) {
            userDropdown.classList.remove('active');
            userTrigger.classList.remove('active');
        }
        
        if (collectionDropdown && collectionLink) {
            collectionDropdown.classList.remove('open');
            collectionLink.classList.remove('dropdown-open');
        }
    }

    setupCollectionDropdown() {
        const collectionLink = document.getElementById('navRatings');
        const collectionDropdown = document.getElementById('collectionDropdown');
        const dropdownItems = collectionDropdown ? collectionDropdown.querySelectorAll('.dropdown-item') : [];

        if (!collectionLink || !collectionDropdown) return;

        let hoverTimeout = null;
        let isHovering = false;
        let isOpen = false;

        // Show dropdown on hover with delay
        const showDropdown = () => {
            if (hoverTimeout) {
                clearTimeout(hoverTimeout);
            }
            hoverTimeout = setTimeout(() => {
                if (isHovering) {
                    collectionDropdown.classList.add('open');
                    collectionLink.classList.add('dropdown-open');
                    isOpen = true;
                }
            }, 200);
        };

        // Hide dropdown with delay
        const hideDropdown = () => {
            if (hoverTimeout) {
                clearTimeout(hoverTimeout);
            }
            hoverTimeout = setTimeout(() => {
                if (!isHovering) {
                    collectionDropdown.classList.remove('open');
                    collectionLink.classList.remove('dropdown-open');
                    isOpen = false;
                }
            }, 150);
        };

        // Mouse enter on link
        collectionLink.addEventListener('mouseenter', () => {
            isHovering = true;
            showDropdown();
        });

        // Mouse enter on dropdown
        collectionDropdown.addEventListener('mouseenter', () => {
            isHovering = true;
            if (hoverTimeout) {
                clearTimeout(hoverTimeout);
            }
            collectionDropdown.classList.add('open');
            collectionLink.classList.add('dropdown-open');
            isOpen = true;
        });

        // Mouse leave from link - check if moving to dropdown
        collectionLink.addEventListener('mouseleave', (e) => {
            const relatedTarget = e.relatedTarget;
            // If mouse is moving to dropdown, keep it open
            if (collectionDropdown.contains(relatedTarget)) {
                return;
            }
            // Otherwise, start hide timer
            isHovering = false;
            hideDropdown();
        });

        // Mouse leave from dropdown
        collectionDropdown.addEventListener('mouseleave', (e) => {
            const relatedTarget = e.relatedTarget;
            // If mouse is moving back to link, keep it open
            if (collectionLink.contains(relatedTarget)) {
                return;
            }
            // Otherwise, hide it
            isHovering = false;
            hideDropdown();
        });

        // Handle dropdown item clicks
        dropdownItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const page = item.dataset.page;
                // Don't hide immediately, let navigation handle it
                setTimeout(() => {
                    collectionDropdown.classList.remove('open');
                    collectionLink.classList.remove('dropdown-open');
                    isOpen = false;
                    isHovering = false;
                }, 100);
                this.navigateToPage(page);
            });
        });

        // Also handle click on the main link
        collectionLink.addEventListener('click', (e) => {
            // If dropdown is open, don't navigate immediately
            if (isOpen) {
                e.preventDefault();
                // Let user click on dropdown items
                return;
            }
        });

        // Update watchlist count
        this.updateWatchlistCount();
    }

    async updateWatchlistCount() {
        try {
            if (typeof firebaseManager === 'undefined') {
                return;
            }

            const user = firebaseManager.getCurrentUser();
            if (!user) {
                const countElement = document.getElementById('watchlistCount');
                if (countElement) {
                    countElement.textContent = '(0)';
                }
                return;
            }

            const watchlistService = firebaseManager.getWatchlistService();
            if (watchlistService) {
                const count = await watchlistService.getWatchlistCount(user.uid);
                const countElement = document.getElementById('watchlistCount');
                if (countElement) {
                    countElement.textContent = `(${count})`;
                }
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
                case 'watchlist':
                    url = chrome.runtime.getURL('watchlist.html');
                    break;
                case 'favorites':
                    url = chrome.runtime.getURL('favorites.html');
                    break;
                case 'settings':
                    this.showProfileModal();
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
            case 'watchlist':
                url = chrome.runtime.getURL('watchlist.html');
                break;
            case 'favorites':
                url = chrome.runtime.getURL('favorites.html');
                break;
            case 'settings':
                this.showProfileModal();
                return;
            default:
                return;
        }

        if (url) {
            // Navigate on same tab
            window.location.href = url;
        }
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
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        modal.querySelector('#profileCloseBtn').addEventListener('click', close);
        modal.querySelector('#cancelProfileBtn').addEventListener('click', close);

        const avatarInput = modal.querySelector('#avatarInput');
        const avatarPreview = modal.querySelector('#avatarPreview');
        const avatarPlaceholder = modal.querySelector('#avatarPlaceholder');
        const uploadBtn = modal.querySelector('#uploadAvatarBtn');

        uploadBtn.addEventListener('click', () => avatarInput.click());
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
        if (toggleBtn) toggleBtn.addEventListener('click', () => { fields.style.display = fields.style.display === 'none' ? 'flex' : 'none'; });

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
                } catch (err) {
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
        } else if (window.location.pathname.includes('watchlist.html')) {
            currentPage = 'watchlist';
        } else if (window.location.pathname.includes('favorites.html')) {
            currentPage = 'favorites';
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
