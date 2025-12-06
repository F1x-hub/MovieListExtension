/**
 * Navigation Component
 * Global navigation header for all pages
 */
class Navigation {
    constructor(currentPage = '') {
        this.currentPage = currentPage;
        this.user = null;
        this.authCheckInterval = null;
        this.collectionService = null;
        this.init();
    }

    init() {
        this.applyTheme(this.getCurrentTheme());
        this.render();
        this.updateThemeButton(this.getCurrentTheme()); // Update UI after render
        this.setupEventListeners();
        this.setupAuthListener();
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.ensureCollectionsLoaded();
            });
        } else {
            this.ensureCollectionsLoaded();
        }
    }

    ensureCollectionsLoaded() {
        if (typeof CollectionService !== 'undefined') {
            if (!this.collectionService) {
                this.collectionService = new CollectionService();
            }
            this.loadCustomCollections();
        } else {
            setTimeout(() => this.ensureCollectionsLoaded(), 200);
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

        const navHTML = `
            <header class="nav-header">
                <div class="nav-container">
                    <!-- Logo Section -->
                    <a href="#" class="nav-logo" id="navLogo">
                        <img src="${chrome.runtime.getURL(typeof IconUtils !== 'undefined' ? IconUtils.getIconPath(this.getCurrentTheme(), 48) : 'icons/icon48-white.png')}" alt="Movie Ratings" class="nav-logo-image">
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
                                <div class="dropdown-divider"></div>
                                <div class="dropdown-section-header">Custom Collections</div>
                                <div class="custom-collections-list" id="customCollectionsList"></div>
                                <div class="dropdown-item create-collection-item" id="createCollectionBtn">
                                    <span class="dropdown-icon">➕</span>
                                    <span>Create Collection</span>
                                </div>
                            </div>
                        </div>
                    </nav>

                    <!-- User Section -->
                    <div class="nav-user" id="navUser">
                        <!-- User Profile Dropdown -->
                        <div class="nav-user-profile" id="navUserProfile" style="display: none;">
                            <button class="nav-user-trigger" id="navUserTrigger">
                                <img src="${chrome.runtime.getURL('icons/icon48.png')}" alt="User" class="nav-user-avatar" id="navUserAvatar">
                                <span class="nav-user-name" id="navUserName">User</span>
                                <span class="nav-dropdown-arrow">▼</span>
                            </button>
                            
                            <!-- Dropdown Menu -->
                            <div class="nav-user-dropdown" id="navUserDropdown">
                                <div class="nav-dropdown-item" id="navDropdownSettings">
                                    <span class="nav-dropdown-icon">👤</span>
                                    <span>View Profile</span>
                                </div>
                                <div class="nav-dropdown-item" id="navDropdownAdmin" style="display: none;">
                                    <span class="nav-dropdown-icon">🛡️</span>
                                    <span>Admin Panel</span>
                                </div>
                                <div class="nav-dropdown-item" id="navDropdownTheme">
                                    <span class="nav-dropdown-icon" id="navThemeIcon">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20" style="width: 16px; height: 16px;">
                                            <path fill-rule="evenodd" d="M10.606 1.987a.75.75 0 0 1-.217.835 5.795 5.795 0 0 0 6.387 9.58.75.75 0 0 1 1.031.965A8.502 8.502 0 0 1 1.5 10a8.5 8.5 0 0 1 8.395-8.5.75.75 0 0 1 .711.487M8.004 3.288a7 7 0 1 0 7.421 11.137A7.295 7.295 0 0 1 8.004 3.288" clip-rule="evenodd"></path>
                                        </svg>
                                    </span>
                                    <span id="navThemeText">Theme (Dark)</span>
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
        this.initializeCollectionService();
        this.setupCollectionStorageListener();

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

            // Admin Panel dropdown item
            const dropdownAdmin = document.getElementById('navDropdownAdmin');
            if (dropdownAdmin) {
                dropdownAdmin.addEventListener('click', () => {
                    this.closeAllDropdowns();
                    this.navigateToPage('admin');
                });
            }

            // Theme dropdown item
            const dropdownTheme = document.getElementById('navDropdownTheme');
            if (dropdownTheme) {
                dropdownTheme.addEventListener('click', () => {
                    this.closeAllDropdowns();
                    this.showThemeModal();
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

        // Create collection button
        const createCollectionBtn = document.getElementById('createCollectionBtn');
        if (createCollectionBtn) {
            createCollectionBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showCollectionModal();
                setTimeout(() => {
                    collectionDropdown.classList.remove('open');
                    collectionLink.classList.remove('dropdown-open');
                    isOpen = false;
                    isHovering = false;
                }, 100);
            });
        }

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

        // Close submenus when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.collection-submenu') && !e.target.closest('.collection-menu-button')) {
                this.closeAllSubmenus();
            }
        });
    }

    initializeCollectionService() {
        if (typeof CollectionService !== 'undefined') {
            this.collectionService = new CollectionService();
            this.loadCustomCollections();
        } else {
            setTimeout(() => {
                if (typeof CollectionService !== 'undefined') {
                    this.collectionService = new CollectionService();
                    this.loadCustomCollections();
                } else {
                    setTimeout(() => {
                        if (typeof CollectionService !== 'undefined') {
                            this.collectionService = new CollectionService();
                            this.loadCustomCollections();
                        }
                    }, 500);
                }
            }, 100);
        }
    }

    setupCollectionStorageListener() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, namespace) => {
                if (namespace === 'local' && changes.movieCollections) {
                    this.loadCustomCollections();
                    
                    if (typeof window.collectionPage !== 'undefined' && window.collectionPage.collectionId) {
                        const collectionData = changes.movieCollections.newValue || [];
                        const currentCollection = collectionData.find(c => c.id === window.collectionPage.collectionId);
                        
                        if (currentCollection && window.collectionPage.loadCollection) {
                            window.collectionPage.loadCollection();
                        } else if (!currentCollection && window.collectionPage) {
                            window.location.href = chrome.runtime.getURL('src/pages/ratings/ratings.html');
                        }
                    }
                }
            });
        }
    }

    async loadCustomCollections() {
        if (!this.collectionService) {
            if (typeof CollectionService !== 'undefined') {
                this.collectionService = new CollectionService();
            } else {
                return;
            }
        }

        try {
            const collections = await this.collectionService.getCollections();
            this.renderCustomCollections(collections);
        } catch (error) {
            console.error('Error loading custom collections:', error);
        }
    }

    renderCustomCollections(collections) {
        const listContainer = document.getElementById('customCollectionsList');
        if (!listContainer) return;

        listContainer.innerHTML = '';

        if (collections.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'dropdown-empty-state';
            emptyState.textContent = 'No collections yet';
            listContainer.appendChild(emptyState);
            return;
        }

        collections.forEach(collection => {
            const item = document.createElement('div');
            item.className = 'dropdown-item custom-collection-item';
            item.setAttribute('data-collection-id', collection.id);
            
            // Check if icon is a custom image (base64 or Firebase Storage URL) or emoji
        const isCustomIcon = collection.icon && (collection.icon.startsWith('data:') || collection.icon.startsWith('https://') || collection.icon.startsWith('http://'));
            const iconHtml = isCustomIcon 
                ? `<img src="${collection.icon}" style="width: 22px; height: 22px; object-fit: cover; border-radius: 4px; vertical-align: middle;">`
                : collection.icon;
            
            item.innerHTML = `
                <div class="collection-info">
                    <span class="dropdown-icon">${iconHtml}</span>
                    <span class="collection-name">${this.escapeHtml(collection.name)}</span>
                    <span class="count">(${collection.movieIds?.length || 0})</span>
                </div>
                <button class="collection-menu-button" data-collection-id="${collection.id}" title="Menu">
                    <span>⋮</span>
                </button>
            `;
            
            const submenu = document.createElement('div');
            submenu.className = 'collection-submenu';
            submenu.id = `submenu-${collection.id}`;
            submenu.style.display = 'none';
            submenu.innerHTML = `
                <div class="submenu-item" data-action="edit" data-collection-id="${collection.id}">
                    <span>✏️</span> Редактировать
                </div>
                <div class="submenu-item delete" data-action="delete" data-collection-id="${collection.id}">
                    <span>🗑️</span> Удалить
                </div>
            `;
            document.body.appendChild(submenu);

            const collectionInfo = item.querySelector('.collection-info');
            if (collectionInfo) {
                collectionInfo.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.navigateToCollection(collection.id);
                });
            }

            const menuButton = item.querySelector('.collection-menu-button');
            if (menuButton) {
                menuButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.toggleCollectionSubmenu(e, collection.id);
                });
            }

            const editItem = submenu.querySelector('[data-action="edit"]');
            if (editItem) {
                editItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.closeAllSubmenus();
                    this.editCollection(collection);
                });
            }

            const deleteItem = submenu.querySelector('[data-action="delete"]');
            if (deleteItem) {
                deleteItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.closeAllSubmenus();
                    this.deleteCollection(collection.id);
                });
            }

            listContainer.appendChild(item);
        });
    }

    navigateToCollection(collectionId) {
        const url = chrome.runtime.getURL(`src/pages/collection/collection.html?id=${collectionId}`);
        if (window.location.pathname.includes('popup.html')) {
            chrome.tabs.create({ url });
        } else {
            window.location.href = url;
        }
    }

    toggleCollectionSubmenu(event, collectionId) {
        event.stopPropagation();
        
        const submenu = document.getElementById(`submenu-${collectionId}`);
        if (!submenu) return;
        
        const isOpen = submenu.style.display === 'block';
        
        this.closeAllSubmenus();
        
        if (!isOpen) {
            submenu.style.display = 'block';
            this.positionSubmenu(submenu);
        }
    }

    closeAllSubmenus() {
        document.querySelectorAll('.collection-submenu').forEach(menu => {
            menu.style.display = 'none';
        });
    }
    
    cleanupSubmenus() {
        document.querySelectorAll('.collection-submenu').forEach(menu => {
            if (menu.parentNode) {
                menu.parentNode.removeChild(menu);
            }
        });
    }

    positionSubmenu(submenu) {
        const collectionId = submenu.id.replace('submenu-', '');
        const item = document.querySelector(`.custom-collection-item[data-collection-id="${collectionId}"]`);
        if (!item) return;
        
        const button = item.querySelector('.collection-menu-button');
        if (!button) return;
        
        const dropdown = item.closest('.collection-dropdown');
        if (!dropdown) return;
        
        const itemRect = item.getBoundingClientRect();
        const dropdownRect = dropdown.getBoundingClientRect();
        
        const calculatedTop = itemRect.top;
        const calculatedLeft = dropdownRect.right + 4;
        
        submenu.style.position = 'fixed';
        submenu.style.top = `${calculatedTop}px`;
        submenu.style.left = `${calculatedLeft}px`;
        submenu.style.right = 'auto';
        submenu.style.marginLeft = '0';
        submenu.style.marginRight = '0';
        
        requestAnimationFrame(() => {
            const submenuRect = submenu.getBoundingClientRect();
            
            if (submenuRect.right > window.innerWidth) {
                const newLeft = dropdownRect.left - submenuRect.width - 4;
                submenu.style.left = `${newLeft}px`;
                submenu.style.right = 'auto';
            }
        });
    }

    async editCollection(collection) {
        this.showCollectionModal(collection);
    }

    async deleteCollection(collectionId) {
        if (!confirm('Are you sure you want to delete this collection? Movies will not be removed.')) {
            return;
        }

        try {
            if (!this.collectionService) {
                this.initializeCollectionService();
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            await this.collectionService.deleteCollection(collectionId);
            await this.loadCustomCollections();
            
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Collection deleted', 'success');
            }
        } catch (error) {
            console.error('Error deleting collection:', error);
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Failed to delete collection', 'error');
            }
        }
    }

    showCollectionModal(collection = null) {
        // Detect current theme
        const isLightTheme = document.body.classList.contains('light-theme');
        
        // Define theme colors
        const themeColors = isLightTheme ? {
            overlay: 'rgba(0, 0, 0, 0.5)',
            background: '#ededed',
            text: '#333335',
            textSecondary: '#495057',
            border: 'rgba(0, 0, 0, 0.1)',
            inputBg: '#ffffff',
            inputBorder: '#ced4da',
            iconBg: '#e9ecef',
            selectedIconBorder: '#333335',
            selectedIconBg: '#ededed',
            cancelBg: '#e9ecef',
            cancelText: '#333335',
            saveBg: '#333335',
            saveText: '#ffffff'
        } : {
            overlay: 'rgba(0, 0, 0, 0.7)',
            background: '#1e293b',
            text: '#e2e8f0',
            textSecondary: '#94a3b8',
            border: '#334155',
            inputBg: '#0f172a',
            inputBorder: '#334155',
            iconBg: '#0f172a',
            selectedIconBorder: '#6366f1',
            selectedIconBg: '#1e293b',
            cancelBg: '#334155',
            cancelText: '#e2e8f0',
            saveBg: '#6366f1',
            saveText: '#ffffff'
        };
        
        const modal = document.createElement('div');
        modal.className = 'collection-modal-overlay';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: ${themeColors.overlay};
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const isEdit = !!collection;
        const defaultIcons = ['🎬', '🎭', '🎨', '🎪', '🎯', '🎲', '🎸', '🎺', '🎻', '🎤', '🎧', '🎮', '🎰', '🎱', '🎳', '🎴', '🎵', '🎶', '🎼', '🎹'];
        
        // Check if current icon is a custom image (base64 or Firebase Storage URL)
        const isCustomIcon = collection && collection.icon && (collection.icon.startsWith('data:') || collection.icon.startsWith('https://') || collection.icon.startsWith('http://'));

        modal.innerHTML = `
            <div class="collection-modal-content" style="
                background: ${themeColors.background};
                padding: 24px;
                border-radius: 12px;
                max-width: 500px;
                width: 90%;
                color: ${themeColors.text};
                box-shadow: 0 20px 40px rgba(0, 0, 0, ${isLightTheme ? '0.15' : '0.5'});
                max-height: 90vh;
                overflow-y: auto;
            ">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                    <h3 style="margin: 0; font-size: 20px;">${isEdit ? 'Edit Collection' : 'Create Collection'}</h3>
                    <button class="modal-close-btn" style="
                        background: none;
                        border: none;
                        color: ${themeColors.textSecondary};
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
                                   border: 1px solid ${themeColors.inputBorder};
                                   background: ${themeColors.inputBg};
                                   color: ${themeColors.text};
                                   font-size: 14px;
                               ">
                        <div style="margin-top: 4px; font-size: 12px; color: ${themeColors.textSecondary};">
                            <span id="nameCharCount">0</span>/50 characters
                        </div>
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">Icon</label>
                        
                        <!-- Custom Icon Upload Section -->
                        <div style="margin-bottom: 12px;">
                            <input type="file" id="customIconInput" accept="image/png,image/jpeg,image/jpg,image/gif" style="display: none;">
                            <button type="button" id="uploadIconBtn" style="
                                background: ${themeColors.saveBg};
                                color: ${themeColors.saveText};
                                border: none;
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
                                background: ${themeColors.iconBg};
                                border-radius: 8px;
                            ">
                                <img id="customIconImg" src="${isCustomIcon ? collection.icon : ''}" style="
                                    width: 40px;
                                    height: 40px;
                                    object-fit: cover;
                                    border-radius: 6px;
                                    border: 2px solid ${themeColors.selectedIconBorder};
                                ">
                                <span style="flex: 1; font-size: 13px; color: ${themeColors.textSecondary};">Custom icon</span>
                                <button type="button" id="removeCustomIconBtn" style="
                                    background: none;
                                    border: none;
                                    color: ${themeColors.textSecondary};
                                    cursor: pointer;
                                    font-size: 18px;
                                    padding: 4px;
                                ">×</button>
                            </div>
                            <div style="margin-top: 4px; font-size: 11px; color: ${themeColors.textSecondary};">
                                Max 500KB • PNG, JPG, GIF
                            </div>
                        </div>
                        
                        <!-- Emoji Icons Grid -->
                        <div id="iconsGrid" style="display: flex; flex-wrap: wrap; gap: 8px; max-height: 150px; overflow-y: auto; padding: 8px; background: ${themeColors.iconBg}; border-radius: 8px;">
                            <!-- Icons will be populated dynamically -->
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px;">
                        <button type="button" id="cancelCollectionBtn" style="
                            background: ${themeColors.cancelBg};
                            color: ${themeColors.cancelText};
                            border: none;
                            padding: 10px 16px;
                            border-radius: 8px;
                            cursor: pointer;
                            font-weight: 500;
                        ">Cancel</button>
                        <button type="submit" id="saveCollectionBtn" style="
                            background: ${themeColors.saveBg};
                            color: ${themeColors.saveText};
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
        uploadIconBtn.addEventListener('click', () => {
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
                        // Allow some flexibility (e.g., between 1:1.5 and 1.5:1), but reject extreme wide/tall
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
                            // Landscape: crop center square based on height
                            sourceSize = height;
                            sourceX = (width - height) / 2;
                            sourceY = 0;
                        } else {
                            // Portrait: crop center square based on width
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
                                    btn.style.borderColor = themeColors.border;
                                    btn.style.background = 'transparent';
                                    btn.classList.remove('selected');
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
        removeCustomIconBtn.addEventListener('click', () => {
            customIconData = null;
            selectedIcon = defaultIcons[0];
            customIconPreview.style.display = 'none';
            customIconInput.value = '';
            
            // Select first emoji by default
            const firstIconBtn = modal.querySelector('.icon-select-btn');
            if (firstIconBtn) {
                firstIconBtn.style.borderColor = themeColors.selectedIconBorder;
                firstIconBtn.style.background = themeColors.selectedIconBg;
                firstIconBtn.classList.add('selected');
            }
        });

        // Function to render icons grid
        const renderIconsGrid = async () => {
            const iconsGrid = modal.querySelector('#iconsGrid');
            if (!iconsGrid) return;

            // Get saved custom icons
            let savedIcons = [];
            if (this.collectionService) {
                savedIcons = await this.collectionService.getSavedIcons();
            } else {
                // Fallback if service not ready
                const result = await chrome.storage.local.get(['savedCustomIcons']);
                savedIcons = result.savedCustomIcons || [];
            }

            let html = '';

            // Render saved custom icons
            if (savedIcons.length > 0) {
                html += savedIcons.map(icon => `
                    <button type="button" class="icon-select-btn custom-icon-btn ${collection && collection.icon === icon ? 'selected' : ''}" 
                            data-icon="${icon}" 
                            style="
                                width: 40px;
                                height: 40px;
                                padding: 0;
                                border: 2px solid ${collection && collection.icon === icon ? themeColors.selectedIconBorder : themeColors.border};
                                background: ${collection && collection.icon === icon ? themeColors.selectedIconBg : 'transparent'};
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
                <button type="button" class="icon-select-btn emoji-icon-btn ${collection && collection.icon === icon ? 'selected' : ''}" 
                        data-icon="${icon}" 
                        style="
                            width: 40px;
                            height: 40px;
                            font-size: 20px;
                            border: 2px solid ${collection && collection.icon === icon ? themeColors.selectedIconBorder : themeColors.border};
                            background: ${collection && collection.icon === icon ? themeColors.selectedIconBg : 'transparent'};
                            border-radius: 8px;
                            cursor: pointer;
                            transition: all 0.2s;
                        ">${icon}</button>
            `).join('');

            iconsGrid.innerHTML = html;

            // Add event listeners
            const iconButtons = iconsGrid.querySelectorAll('.icon-select-btn');
            iconButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    // Clear custom icon preview/input
                    customIconData = null;
                    customIconPreview.style.display = 'none';
                    customIconInput.value = '';
                    
                    // Update selection UI
                    iconButtons.forEach(b => {
                        b.style.borderColor = themeColors.border;
                        b.style.background = 'transparent';
                        b.classList.remove('selected');
                    });
                    
                    btn.style.borderColor = themeColors.selectedIconBorder;
                    btn.style.background = themeColors.selectedIconBg;
                    btn.classList.add('selected');
                    
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
                    this.initializeCollectionService();
                    await new Promise(resolve => setTimeout(resolve, 100));
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
                
                if (typeof window.navigation !== 'undefined' && window.navigation.loadCustomCollections) {
                    await window.navigation.loadCustomCollections();
                }
                
                if (typeof window.collectionPage !== 'undefined' && window.collectionPage.loadCollection) {
                    await window.collectionPage.loadCollection();
                }
                
                close();
            } catch (error) {
                console.error('Error saving collection:', error);
                alert(error.message || 'Failed to save collection');
            }
        });
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
        modal.querySelector('.modal-close-btn').addEventListener('click', close);
        modal.querySelector('#cancelCollectionSelectorBtn').addEventListener('click', close);
        modal.addEventListener('click', (e) => {
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

                    await this.loadCustomCollections();
                    
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
            window.addEventListener('authStateChanged', (e) => {
                const user = e.detail.user;
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
                    window.addEventListener('authStateChanged', (e) => {
                        const user = e.detail.user;
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

    async updateUserDisplay(user) {
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

            // Get display name based on user preference
            let displayText = user.displayName || user.email || 'User';
            
            if (typeof firebaseManager !== 'undefined' && firebaseManager.getUserService) {
                try {
                    const userService = firebaseManager.getUserService();
                    const profile = await userService.getUserProfile(user.uid);
                    
                    if (profile) {
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
                    }
                } catch (error) {
                    console.error('Error loading user profile for display:', error);
                }
            }

            userName.textContent = displayText;
            
            if (userAvatar) {
                if (user.photoURL) {
                    userAvatar.src = user.photoURL;
                } else {
                    // Use default avatar if no photo
                    userAvatar.src = chrome.runtime.getURL('icons/icon48.png');
                }
            }

            // Show/hide Admin Panel menu item based on admin status
            const adminMenuItem = document.getElementById('navDropdownAdmin');
            if (adminMenuItem) {
                try {
                    if (typeof firebaseManager !== 'undefined' && firebaseManager.getUserService) {
                        const userService = firebaseManager.getUserService();
                        const profile = await userService.getUserProfile(user.uid);
                        
                        if (profile && profile.isAdmin === true) {
                            adminMenuItem.style.display = 'block';
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

    // Reload collections to ensure we show the correct ones (Firestore vs Local)
    this.loadCustomCollections();
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
                    url = chrome.runtime.getURL('src/pages/search/search.html');
                    break;
                case 'ratings':
                    url = chrome.runtime.getURL('src/pages/ratings/ratings.html');
                    break;
                case 'watchlist':
                    url = chrome.runtime.getURL('src/pages/watchlist/watchlist.html');
                    break;
                case 'favorites':
                    url = chrome.runtime.getURL('src/pages/favorites/favorites.html');
                    break;
                case 'profile':
                case 'settings':
                    url = chrome.runtime.getURL('src/pages/profile/profile.html');
                    break;
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
                url = chrome.runtime.getURL('src/pages/search/search.html');
                break;
            case 'ratings':
                url = chrome.runtime.getURL('src/pages/ratings/ratings.html');
                break;
            case 'watchlist':
                url = chrome.runtime.getURL('src/pages/watchlist/watchlist.html');
                break;
            case 'favorites':
                url = chrome.runtime.getURL('src/pages/favorites/favorites.html');
                break;
            case 'profile':
            case 'settings':
                url = chrome.runtime.getURL('src/pages/profile/profile.html');
                break;
            case 'admin':
                url = chrome.runtime.getURL('src/pages/admin/admin.html');
                break;
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
            // Apply theme class to document root
            if (theme === 'light') {
                document.documentElement.classList.add('light-theme');
            } else {
                document.documentElement.classList.remove('light-theme');
            }

            // Save theme to localStorage
            localStorage.setItem('movieExtensionTheme', theme);
            
            // Sync to chrome.storage.local for background script access
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ theme: theme });
            }

            // Update extension icon
            if (typeof IconUtils !== 'undefined') {
                IconUtils.updateExtensionIcon(theme);
                
                // Update internal logo if it exists
                const navLogoImg = document.querySelector('#navLogo img');
                if (navLogoImg) {
                    navLogoImg.src = chrome.runtime.getURL(IconUtils.getIconPath(theme, 48));
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
            themeText.textContent = theme === 'dark' ? 'Theme (Dark)' : 'Theme (Light)';
        }

        if (themeIcon) {
            if (theme === 'dark') {
                // Moon icon for dark theme
                themeIcon.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20" style="width: 16px; height: 16px;">
                        <path fill-rule="evenodd" d="M10.606 1.987a.75.75 0 0 1-.217.835 5.795 5.795 0 0 0 6.387 9.58.75.75 0 0 1 1.031.965A8.502 8.502 0 0 1 1.5 10a8.5 8.5 0 0 1 8.395-8.5.75.75 0 0 1 .711.487M8.004 3.288a7 7 0 1 0 7.421 11.137A7.295 7.295 0 0 1 8.004 3.288" clip-rule="evenodd"></path>
                    </svg>
                `;
            } else {
                // Sun icon for light theme
                themeIcon.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" style="width: 16px; height: 16px;">
                        <path d="M12.002 1a.9.9 0 0 1 .9.9v2.2a.9.9 0 0 1-1.8 0V1.9a.9.9 0 0 1 .9-.9m.002 18a.9.9 0 0 1 .9.9v2.2a.9.9 0 0 1-1.8 0v-2.2a.9.9 0 0 1 .9-.9M4.661 8.884a.9.9 0 0 0 .9-1.559L3.355 6.128a.9.9 0 0 0-.9 1.559zm17.223 8.663a.9.9 0 0 1-1.23.33l-2.205-1.193a.9.9 0 1 1 .9-1.56l2.205 1.193a.9.9 0 0 1 .33 1.23m-3.43-10.23a.9.9 0 1 0 .9 1.56l2.198-1.197a.9.9 0 1 0-.9-1.558zM2.128 17.547a.9.9 0 0 1 .33-1.23l2.191-1.2a.9.9 0 0 1 .9 1.559l-2.19 1.2a.9.9 0 0 1-1.23-.33ZM12.004 7a5 5 0 0 0-3.536 1.464A4.98 4.98 0 0 0 7.003 12c0 1.38.56 2.63 1.465 3.536A4.99 4.99 0 0 0 12.004 17c1.382 0 2.632-.56 3.537-1.464A4.98 4.98 0 0 0 17.006 12c0-1.38-.56-2.63-1.465-3.536A4.99 4.99 0 0 0 12.004 7M9.741 9.737a3.19 3.19 0 0 1 2.263-.937c.885 0 1.683.356 2.264.937s.938 1.379.938 2.263-.357 1.682-.938 2.263a3.19 3.19 0 0 1-2.264.937 3.19 3.19 0 0 1-2.263-.937A3.18 3.18 0 0 1 8.803 12c0-.884.357-1.682.938-2.263" clip-rule="evenodd"></path>
                    </svg>
                `;
            }
        }
    }

    showThemeModal() {
        const currentTheme = this.getCurrentTheme();
        const isDark = currentTheme === 'dark';
        
        // Define colors based on theme
        const colors = {
            bg: isDark ? '#262627' : '#ffffff',
            text: isDark ? '#ffffff' : '#333335',
            closeBtn: isDark ? '#C0C0C0' : '#64748b',
            optionBg: isDark ? '#3a3a3a' : '#f8fafc',
            optionHover: isDark ? '#454545' : '#e2e8f0',
            accent: isDark ? '#C0C0C0' : '#333335',
            border: isDark ? 'rgba(255, 255, 255, 0.1)' : '#e2e8f0'
        };
        
        const modal = document.createElement('div');
        modal.className = 'theme-modal-overlay';
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
            animation: fadeIn 0.2s ease;
        `;

        modal.innerHTML = `
            <div class="theme-modal-content" style="
                background: ${colors.bg};
                padding: 24px;
                border-radius: 12px;
                min-width: 280px;
                color: ${colors.text};
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
                animation: scaleIn 0.2s ease;
                border: 1px solid ${colors.border};
            ">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                    <h3 style="margin: 0; font-size: 18px; font-weight: 600;">Select Theme</h3>
                    <button class="modal-close-btn" style="
                        background: none;
                        border: none;
                        color: ${colors.closeBtn};
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
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div class="theme-option" data-theme="dark" style="
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        padding: 14px 16px;
                        border-radius: 8px;
                        background: ${currentTheme === 'dark' ? colors.optionHover : colors.optionBg};
                        cursor: pointer;
                        transition: all 0.2s;
                        border: 2px solid ${currentTheme === 'dark' ? colors.accent : 'transparent'};
                    ">
                        <span class="theme-option-icon" style="font-size: 24px;">🌙</span>
                        <span style="flex: 1; font-weight: 500;">Dark Theme</span>
                        <span class="theme-checkmark" style="
                            font-size: 18px;
                            color: ${colors.accent};
                            display: ${currentTheme === 'dark' ? 'block' : 'none'};
                        ">✓</span>
                    </div>
                    <div class="theme-option" data-theme="light" style="
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        padding: 14px 16px;
                        border-radius: 8px;
                        background: ${currentTheme === 'light' ? colors.optionHover : colors.optionBg};
                        cursor: pointer;
                        transition: all 0.2s;
                        border: 2px solid ${currentTheme === 'light' ? colors.accent : 'transparent'};
                    ">
                        <span class="theme-option-icon" style="font-size: 24px;">☀️</span>
                        <span style="flex: 1; font-weight: 500;">Light Theme</span>
                        <span class="theme-checkmark" style="
                            font-size: 18px;
                            color: ${colors.accent};
                            display: ${currentTheme === 'light' ? 'block' : 'none'};
                        ">✓</span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => {
            modal.style.animation = 'fadeOut 0.2s ease';
            setTimeout(() => modal.remove(), 200);
        };

        // Close button
        modal.querySelector('.modal-close-btn').addEventListener('click', close);
        
        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });

        // Close on escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Theme option selection
        const themeOptions = modal.querySelectorAll('.theme-option');
        themeOptions.forEach(option => {
            option.addEventListener('mouseenter', () => {
                option.style.background = colors.optionHover;
            });
            option.addEventListener('mouseleave', () => {
                const theme = option.dataset.theme;
                option.style.background = currentTheme === theme ? colors.optionHover : colors.optionBg;
            });
            option.addEventListener('click', () => {
                const selectedTheme = option.dataset.theme;
                this.applyTheme(selectedTheme);
                close();
                
                // Show toast notification
                if (typeof Utils !== 'undefined' && Utils.showToast) {
                    Utils.showToast(`Theme changed to ${selectedTheme}`);
                }
            });
        });

        // Add fadeOut animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeOut {
                from { opacity: 1; }
                to { opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    handleSignIn() {
        // Redirect to popup for sign in
        if (!window.location.pathname.includes('popup.html')) {
            window.location.href = chrome.runtime.getURL('src/popup/popup.html');
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
                    window.location.href = chrome.runtime.getURL('src/popup/popup.html');
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
        } else if (window.location.pathname.includes('watchlist.html')) {
            currentPage = 'watchlist';
        } else if (window.location.pathname.includes('favorites.html')) {
            currentPage = 'favorites';
        } else if (window.location.pathname.includes('admin.html') || window.location.pathname.includes('src/pages/admin/')) {
            currentPage = 'admin';
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
