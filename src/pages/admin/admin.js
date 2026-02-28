/**
 * Admin Panel Manager
 * Handles admin interface for user management
 */
class AdminPanelManager {
    constructor() {
        this.adminService = null;
        this.cacheService = null;
        this.currentUser = null;
        this.users = [];
        this.userToDelete = null;
        
        // Movies and ratings data
        this.movies = [];
        this.ratings = [];
        this.ratingsMap = new Map(); // movieId -> [ratings]
        this.usersMap = new Map();
        this.filteredMovies = [];
        this.displayedMovies = [];
        this.BATCH_SIZE = 20;
        
        // Selection state
        this.selectedMovies = new Set();
        
        // Pagination state for users
        this.userPagination = {
            currentPage: 1,
            itemsPerPage: 20,
            totalItems: 0,
            lastVisibleDocs: [],
            hasMore: true
        };
        this.userSearchTerm = '';
        this.userSearchTimeout = null;
        this.displayedUsers = [];
        
        // Pagination state for movies
        this.pagination = {
            currentPage: 1,
            itemsPerPage: 20,
            totalItems: 0,
            lastVisibleDocs: [], // Stack of last visible docs for navigation
            hasMore: true
        };
        
        // Rating modal state
        this.ratingToDelete = null;
        
        // Filters
        this.ratingsFilters = {
            movieTitle: '',
            userId: '',
            ratingStatus: 'all' // 'all', 'rated', 'unrated'
        };
        
        // Online status
        this.isOnline = navigator.onLine;
        window.addEventListener('online', () => this.updateOnlineStatus(true));
        window.addEventListener('offline', () => this.updateOnlineStatus(false));
        
        this.init();
    }

    async init() {
        console.time('[Admin Perf] Total Init');
        console.time('[Admin Perf] 1. Navigation & Firebase Wait');
        try {
            // Initialize navigation
            window.adminNav = new Navigation('admin');

            // Wait for Firebase to be ready
            await this.waitForFirebase();
            console.timeEnd('[Admin Perf] 1. Navigation & Firebase Wait');

            // Check if user is admin
            console.time('[Admin Perf] 2. Check Admin Access');
            const isAdmin = await this.checkAdminAccess();
            console.timeEnd('[Admin Perf] 2. Check Admin Access');
            
            if (!isAdmin) {
                this.showError('Access denied. You must be an administrator to view this page.');
                setTimeout(() => {
                    window.location.href = chrome.runtime.getURL('src/pages/search/search.html');
                }, 2000);
                return;
            }

            console.time('[Admin Perf] 3. Services Init');
            // Initialize services
            this.adminService = new AdminService(firebaseManager);
            this.cacheService = new AdminRatingsCacheService(firebaseManager);
            console.timeEnd('[Admin Perf] 3. Services Init');

            // Update offline indicator
            this.updateOnlineIndicator();

            console.time('[Admin Perf] 4. Load Data Sequentially');
            // Load users and movies sequentially to avoid WebChannel stream congestion
            this.showLoading();
            await this.loadUsers();
            await this.loadMovies();
            this.hideLoading();
            console.timeEnd('[Admin Perf] 4. Load Data Sequentially');

            console.time('[Admin Perf] 5. UI & Event Setup');
            // Initialize Reports
            this.initReports();

            // Setup event listeners
            this.setupEventListeners();
            console.timeEnd('[Admin Perf] 5. UI & Event Setup');
            console.timeEnd('[Admin Perf] Total Init');
            
            console.log(`[Admin Performance] Init fully complete. Data size - Users: ${this.users.length}, Movies: ${this.movies.length}`);
        } catch (error) {
            console.error('Error initializing admin panel:', error);
            this.showError(`Failed to initialize: ${error.message}`);
            console.timeEnd('[Admin Perf] Total Init');
        }
    }

    async waitForFirebase() {
        console.log('[Admin Panel] Waiting for Firebase initialization...');
        
        return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 50;
            
            const checkInterval = setInterval(() => {
                attempts++;
                
                if (typeof firebaseManager !== 'undefined' && firebaseManager.isInitialized) {
                    console.log('[Admin Panel] Firebase Manager initialized');
                    clearInterval(checkInterval);
                    
                    // Now wait for auth to be ready
                    if (firebaseManager.waitForAuthReady) {
                        console.log('[Admin Panel] Waiting for auth ready...');
                        firebaseManager.waitForAuthReady().then(() => {
                            console.log('[Admin Panel] Auth is ready');
                            resolve();
                        });
                    } else {
                        // Fallback: wait a bit for auth to initialize
                        setTimeout(() => {
                            console.log('[Admin Panel] Auth ready (fallback)');
                            resolve();
                        }, 500);
                    }
                } else if (attempts >= maxAttempts) {
                    console.error('[Admin Panel] Firebase initialization timeout');
                    clearInterval(checkInterval);
                    resolve(); // Resolve anyway to show error message
                }
            }, 100);
        });
    }

    async checkAdminAccess() {
        try {
            console.time('[Admin Perf] checkAdminAccess - getUserManager');
            this.currentUser = firebaseManager.getCurrentUser();
            console.log('[Admin Panel] Checking admin access for user:', this.currentUser?.email);
            
            if (!this.currentUser) {
                console.log('[Admin Panel] No current user found');
                return false;
            }

            const userService = firebaseManager.getUserService();
            if (!userService) {
                console.error('[Admin Panel] UserService not available');
                return false;
            }
            console.timeEnd('[Admin Perf] checkAdminAccess - getUserManager');

            console.time('[Admin Perf] checkAdminAccess - Firestore get');
            console.log('[Admin Panel] Attempting to fetch user profile from Firestore...');
            
            // Try fetching from server first, then cache if offline
            let userProfile;
            try {
                userProfile = await userService.getUserProfile(this.currentUser.uid);
            } catch (err) {
                console.warn('[Admin Panel] Firestore fetch error (possibly offline), trying again or ignoring:', err);
                throw err;
            }
            
            console.timeEnd('[Admin Perf] checkAdminAccess - Firestore get');
            
            console.log('[Admin Panel] User profile loaded:', {
                userId: this.currentUser.uid,
                email: userProfile?.email,
                isAdmin: userProfile?.isAdmin
            });
            
            if (!userProfile) {
                console.error('[Admin Panel] User profile not found in Firestore');
                return false;
            }

            const hasAdminAccess = userProfile.isAdmin === true;
            console.log('[Admin Panel] Admin access result:', hasAdminAccess);
            
            return hasAdminAccess;
        } catch (error) {
            console.error('[Admin Panel] Error checking admin access:', error);
            return false;
        }
    }

    async loadUsers() {
        console.time('[Admin Perf] loadUsers total');
        try {
            console.time('[Admin Perf] loadUsers - Get Cache');
            const cachedUsers = this.cacheService.getCachedUsers();
            console.timeEnd('[Admin Perf] loadUsers - Get Cache');
            
            if (cachedUsers && cachedUsers.length > 0 && this.cacheService.isUsersCacheValid()) {
                console.log(`[Admin] Using cached users`);
                this.users = cachedUsers;
                this.displayedUsers = this.users;
                
                this.renderUsers();
                this.renderUserPagination();
            } else if (cachedUsers && cachedUsers.length > 0) {
                console.log(`[Admin] Users cache stale, rendering instantly then background sync`);
                this.users = cachedUsers;
                this.displayedUsers = this.users;
                this.renderUsers();
                this.renderUserPagination();
                this.fetchUsersFromDb(true); // background update
            } else {
                await this.fetchUsersFromDb();
            }
        } catch (error) {
            console.error('Error loading users:', error);
            this.showError(`Failed to load users: ${error.message}`);
        }
        console.timeEnd('[Admin Perf] loadUsers total');
    }

    renderUsersSkeleton() {
        const tableBody = document.getElementById('usersTableBody');
        if (!tableBody) return;
        tableBody.innerHTML = '';
        for (let i = 0; i < 5; i++) {
            tableBody.innerHTML += `
                <tr>
                    <td>
                        <div class="user-info">
                            <div class="skeleton-avatar"></div>
                            <div><div class="skeleton-text" style="width: 100px;"></div></div>
                        </div>
                    </td>
                    <td><div class="skeleton-text" style="width: 150px;"></div></td>
                    <td><div class="skeleton-text" style="width: 80px;"></div></td>
                    <td><div class="skeleton-text" style="width: 80px;"></div></td>
                    <td><div class="skeleton-text" style="width: 40px;"></div></td>
                    <td><div class="skeleton-text" style="width: 40px;"></div></td>
                    <td><div class="skeleton-text" style="width: 60px;"></div></td>
                </tr>
            `;
        }
    }

    async fetchUsersFromDb(isBackground = false) {
        let fetchLabel = `[Admin Perf] fetchUsersFromDb (background=${isBackground})`;
        console.time(fetchLabel);
        if (!isBackground) {
            this.renderUsersSkeleton();
        }
        
        try {
            const lastDoc = this.userPagination.currentPage > 1 ? 
                this.userPagination.lastVisibleDocs[this.userPagination.currentPage - 2] : null;

            const result = await this.adminService.getUsersPage(lastDoc, this.userPagination.itemsPerPage);
            this.users = result.users;

            if (result.lastDoc) {
                if (this.userPagination.currentPage > this.userPagination.lastVisibleDocs.length) {
                    this.userPagination.lastVisibleDocs.push(result.lastDoc);
                } else {
                    this.userPagination.lastVisibleDocs[this.userPagination.currentPage - 1] = result.lastDoc;
                }
            }
            this.userPagination.hasMore = result.hasMore;
            this.displayedUsers = this.users;

            // Cache first page
            if (this.userPagination.currentPage === 1 && !this.userSearchTerm) {
                console.time('[Admin Perf] Save users to cache');
                this.cacheService.saveUsersToCache(this.users);
                console.timeEnd('[Admin Perf] Save users to cache');
            }

            this.applyUserSearch();
        } catch (error) {
            console.error('Error fetching users from DB:', error);
            if (!isBackground) {
                this.showError(`Failed to load users page: ${error.message}`);
            }
        }
        console.timeEnd(fetchLabel);
    }

    async changeUserPage(action) {
        if (action === 'next' && this.userPagination.hasMore) {
            this.userPagination.currentPage++;
            await this.fetchUsersFromDb();
        } else if (action === 'prev' && this.userPagination.currentPage > 1) {
            this.userPagination.currentPage--;
            await this.fetchUsersFromDb();
        } else if (action === 'first') {
            this.userPagination.currentPage = 1;
            this.userPagination.lastVisibleDocs = [];
            await this.fetchUsersFromDb();
        }
    }

    applyUserSearch() {
        if (this.userSearchTerm) {
            const term = this.userSearchTerm.toLowerCase();
            this.displayedUsers = this.users.filter(user => 
                (user.displayName && user.displayName.toLowerCase().includes(term)) ||
                (user.email && user.email.toLowerCase().includes(term)) ||
                (user.id && user.id.toLowerCase().includes(term))
            );
        } else {
            this.displayedUsers = this.users;
        }
        this.renderUsers();
        this.renderUserPagination();
    }

    renderUsers() {
        const tableBody = document.getElementById('usersTableBody');
        const usersCount = document.getElementById('usersCount');
        
        if (!tableBody) return;

        // Update count
        if (usersCount) {
            usersCount.textContent = `${this.displayedUsers.length} user${this.displayedUsers.length !== 1 ? 's' : ''}${this.userPagination.currentPage > 1 ? ` (pg ${this.userPagination.currentPage})` : ''}`;
        }

        // Clear existing rows
        tableBody.innerHTML = '';

        if (this.displayedUsers.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: var(--space-xl); color: var(--text-secondary);">
                        No users found
                    </td>
                </tr>
            `;
            return;
        }

        // Render each user
        this.displayedUsers.forEach(user => {
            const row = this.createUserRow(user);
            tableBody.appendChild(row);
        });
    }

    renderUserPagination() {
        const pageInfo = document.getElementById('usersPaginationInfo');
        const pageNumbers = document.getElementById('user-page-numbers');
        const prevBtn = document.getElementById('user-prev-page');
        const nextBtn = document.getElementById('user-next-page');
        const firstBtn = document.getElementById('user-first-page');
        
        if (pageInfo) {
            const start = (this.userPagination.currentPage - 1) * this.userPagination.itemsPerPage + 1;
            const end = start + this.displayedUsers.length - 1;
            pageInfo.innerHTML = `Showing <span id="user-range-start">${start}</span>-<span id="user-range-end">${end}</span> users`;
        }
        
        if (pageNumbers) {
            pageNumbers.textContent = `Page ${this.userPagination.currentPage}`;
        }
        
        if (prevBtn) prevBtn.disabled = this.userPagination.currentPage === 1;
        if (firstBtn) firstBtn.disabled = this.userPagination.currentPage === 1;
        if (nextBtn) nextBtn.disabled = !this.userPagination.hasMore;
    }

    createUserRow(user) {
        const row = document.createElement('tr');
        const isCurrentUser = user.id === this.currentUser.uid;
        const joinDate = user.createdAt?.toDate ? 
            user.createdAt.toDate().toLocaleDateString() : 
            'Unknown';

        row.innerHTML = `
            <td>
                <div class="user-info">
                    <img src="${user.photoURL || chrome.runtime.getURL('icons/icon48.png')}" 
                         alt="${user.displayName || 'User'}" 
                         class="user-avatar"
                         loading="lazy"
                         onerror="this.src='${chrome.runtime.getURL('icons/icon48.png')}'">
                    <div>
                        <div class="user-name">
                            ${this.escapeHtml(user.displayName || 'Unknown User')}
                            ${user.isAdmin ? '<span class="admin-badge"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg> Admin</span>' : ''}
                            ${isCurrentUser ? '<span class="you-badge">You</span>' : ''}
                        </div>
                    </div>
                </div>
            </td>
            <td>
                <div class="user-email">${this.escapeHtml(user.email || 'No email')}</div>
            </td>
            <td>
                <div class="user-id">${this.escapeHtml(user.id.substring(0, 12))}...</div>
            </td>
            <td>${joinDate}</td>
            <td>
                <div class="user-stats">${user.ratingsCount || 0}</div>
            </td>
            <td>
                <div class="user-stats">${user.collectionCount || 0}</div>
            </td>
            <td>
                <button class="btn-delete" 
                        data-user-id="${user.id}"
                        ${isCurrentUser ? 'disabled title="You cannot delete your own account"' : ''}>
                    Delete
                </button>
            </td>
        `;

        // Add click handler for delete button
        const deleteBtn = row.querySelector('.btn-delete');
        if (deleteBtn && !isCurrentUser) {
            deleteBtn.addEventListener('click', () => this.showDeleteConfirmation(user));
        }

        return row;
    }

    async showDeleteConfirmation(user) {
        try {
            // Get deletion preview
            const preview = await this.adminService.getUserDeletionPreview(user.id);
            
            this.userToDelete = user;
            
            // Fill modal with user info
            const userPreview = document.getElementById('userPreview');
            const statsList = document.getElementById('deletionStatsList');
            
            if (userPreview) {
                userPreview.innerHTML = `
                    <p><strong>Name:</strong> ${this.escapeHtml(preview.user.displayName)}</p>
                    <p><strong>Email:</strong> ${this.escapeHtml(preview.user.email)}</p>
                `;
            }
            
            if (statsList) {
                statsList.innerHTML = `
                    <li>${preview.ratingsCount} rating${preview.ratingsCount !== 1 ? 's' : ''}</li>
                    <li>${preview.collectionCount} collection item${preview.collectionCount !== 1 ? 's' : ''}</li>
                    <li>User profile and all associated data</li>
                `;
            }
            
            // Show modal
            const modal = document.getElementById('deleteModal');
            if (modal) {
                modal.style.display = 'flex';
            }
        } catch (error) {
            console.error('Error getting deletion preview:', error);
            this.showError(`Failed to load user data: ${error.message}`);
        }
    }

    async confirmDelete() {
        if (!this.userToDelete) return;

        try {
            const confirmBtn = document.getElementById('confirmDeleteBtn');
            if (confirmBtn) {
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Deleting...';
            }

            await this.adminService.deleteUser(this.userToDelete.id, this.currentUser.uid);
            
            // Close modal
            this.hideDeleteModal();
            
            // Reload users
            await this.loadUsers();
            
            // Show success message
            this.showSuccessMessage(`User "${this.userToDelete.displayName || 'Unknown'}" deleted successfully`);
            
            this.userToDelete = null;
        } catch (error) {
            console.error('Error deleting user:', error);
            const confirmBtn = document.getElementById('confirmDeleteBtn');
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Delete User';
            }
            this.showError(`Failed to delete user: ${error.message}`);
        }
    }

    hideDeleteModal() {
        const modal = document.getElementById('deleteModal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.userToDelete = null;
    }

    setupEventListeners() {
        // Delete user modal controls
        const closeBtn = document.getElementById('closeDeleteModal');
        const cancelBtn = document.getElementById('cancelDeleteBtn');
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        const modal = document.getElementById('deleteModal');

        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideDeleteModal());
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.hideDeleteModal());
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.confirmDelete());
        }

        // Close modal on outside click
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideDeleteModal();
                }
            });
        }

        // Sidebar Navigation
        const sidebarLinks = document.querySelectorAll('.sidebar-link');
        const settingsPanes = document.querySelectorAll('.settings-pane');

        sidebarLinks.forEach(link => {
            link.addEventListener('click', () => {
                sidebarLinks.forEach(l => l.classList.remove('active'));
                settingsPanes.forEach(p => p.classList.remove('active'));

                link.classList.add('active');
                const targetId = 'pane-' + link.dataset.target;
                const targetPane = document.getElementById(targetId);
                if (targetPane) {
                    targetPane.classList.add('active');
                }
            });
        });

        // User Search Filter (Debounced)
        const userSearchInput = document.getElementById('userSearchFilterInput');
        if (userSearchInput) {
            userSearchInput.addEventListener('input', () => {
                clearTimeout(this.userSearchTimeout);
                this.userSearchTimeout = setTimeout(() => {
                    this.userSearchTerm = userSearchInput.value.trim();
                    this.applyUserSearch();
                }, 300);
            });
        }
        
        // Users Pagination controls
        const userFirstPageBtn = document.getElementById('user-first-page');
        const userPrevPageBtn = document.getElementById('user-prev-page');
        const userNextPageBtn = document.getElementById('user-next-page');
        const userPageSizeSelect = document.getElementById('user-page-size-select');
        
        if (userFirstPageBtn) userFirstPageBtn.addEventListener('click', () => this.changeUserPage('first'));
        if (userPrevPageBtn) userPrevPageBtn.addEventListener('click', () => this.changeUserPage('prev'));
        if (userNextPageBtn) userNextPageBtn.addEventListener('click', () => this.changeUserPage('next'));
        
        if (userPageSizeSelect) {
            userPageSizeSelect.addEventListener('change', (e) => {
                this.userPagination.itemsPerPage = parseInt(e.target.value, 10);
                this.userPagination.currentPage = 1;
                this.userPagination.lastVisibleDocs = [];
                this.fetchUsersFromDb();
            });
        }

        // Delete rating modal controls
        const closeRatingBtn = document.getElementById('closeDeleteRatingModal');
        const cancelRatingBtn = document.getElementById('cancelDeleteRatingBtn');
        const confirmRatingBtn = document.getElementById('confirmDeleteRatingBtn');
        const ratingModal = document.getElementById('deleteRatingModal');

        if (closeRatingBtn) {
            closeRatingBtn.addEventListener('click', () => this.hideDeleteRatingModal());
        }

        if (cancelRatingBtn) {
            cancelRatingBtn.addEventListener('click', () => this.hideDeleteRatingModal());
        }

        if (confirmRatingBtn) {
            confirmRatingBtn.addEventListener('click', () => this.confirmDeleteRating());
        }

        if (ratingModal) {
            ratingModal.addEventListener('click', (e) => {
                if (e.target === ratingModal) {
                    this.hideDeleteRatingModal();
                }
            });
        }

        // Movies/Ratings filters
        const movieSearchFilter = document.getElementById('movieSearchFilter');
        const userFilter = document.getElementById('userFilter');
        const ratingStatusFilter = document.getElementById('ratingStatusFilter');
        const clearFiltersBtn = document.getElementById('clearRatingsFilters');

        if (movieSearchFilter) {
            movieSearchFilter.addEventListener('input', () => {
                this.ratingsFilters.movieTitle = movieSearchFilter.value.trim();
                this.applyMoviesFilters();
            });
        }

        if (userFilter) {
            userFilter.addEventListener('change', () => {
                this.ratingsFilters.userId = userFilter.value;
                this.applyMoviesFilters();
            });
        }

        if (ratingStatusFilter) {
            ratingStatusFilter.addEventListener('change', () => {
                this.ratingsFilters.ratingStatus = ratingStatusFilter.value;
                this.applyMoviesFilters();
            });
        }

        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => {
                this.ratingsFilters = {
                    movieTitle: '',
                    userId: '',
                    ratingStatus: 'all'
                };
                if (movieSearchFilter) movieSearchFilter.value = '';
                if (userFilter) userFilter.value = '';
                if (ratingStatusFilter) ratingStatusFilter.value = 'all';
                this.applyMoviesFilters();
            });
        }

        // Refresh data button
        const refreshBtn = document.getElementById('refreshDataBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.forceRefresh());
        }

        // Pagination controls
        const firstPageBtn = document.getElementById('first-page');
        const prevPageBtn = document.getElementById('prev-page');
        const nextPageBtn = document.getElementById('next-page');
        const lastPageBtn = document.getElementById('last-page');
        const pageSizeSelect = document.getElementById('page-size-select');

        if (firstPageBtn) firstPageBtn.addEventListener('click', () => this.changePage('first'));
        if (prevPageBtn) prevPageBtn.addEventListener('click', () => this.changePage('prev'));
        if (nextPageBtn) nextPageBtn.addEventListener('click', () => this.changePage('next'));
        if (lastPageBtn) lastPageBtn.addEventListener('click', () => this.changePage('last')); // Note: Firestore doesn't support true "last" easily without reading all
        
        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', (e) => {
                this.pagination.itemsPerPage = parseInt(e.target.value, 10);
                this.pagination.currentPage = 1;
                this.pagination.lastVisibleDocs = [];
                this.loadMovies();
            });
        }

        // Select all checkboxes
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => this.handleSelectAll(e.target.checked));
        }
        const headerCheckbox = document.getElementById('headerCheckbox');
        if (headerCheckbox) {
            headerCheckbox.addEventListener('change', (e) => this.handleSelectAll(e.target.checked));
        }

        // Bulk action buttons
        const bulkClearCacheBtn = document.getElementById('bulkClearCacheBtn');
        if (bulkClearCacheBtn) {
            bulkClearCacheBtn.addEventListener('click', () => this.bulkClearCache());
        }

        const bulkUpdateInfoBtn = document.getElementById('bulkUpdateInfoBtn');
        if (bulkUpdateInfoBtn) {
            bulkUpdateInfoBtn.addEventListener('click', () => this.bulkUpdateInfo());
        }

        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
        if (bulkDeleteBtn) {
            bulkDeleteBtn.addEventListener('click', () => this.showBulkDeleteConfirmation());
        }

        // Bulk delete modal controls
        const closeBulkDeleteBtn = document.getElementById('closeBulkDeleteModal');
        const cancelBulkDeleteBtn = document.getElementById('cancelBulkDeleteBtn');
        const confirmBulkDeleteBtn = document.getElementById('confirmBulkDeleteBtn');
        const bulkDeleteModal = document.getElementById('bulkDeleteModal');

        if (closeBulkDeleteBtn) {
            closeBulkDeleteBtn.addEventListener('click', () => this.hideBulkDeleteModal());
        }
        if (cancelBulkDeleteBtn) {
            cancelBulkDeleteBtn.addEventListener('click', () => this.hideBulkDeleteModal());
        }
        if (confirmBulkDeleteBtn) {
            confirmBulkDeleteBtn.addEventListener('click', () => this.confirmBulkDelete());
        }
        if (bulkDeleteModal) {
            bulkDeleteModal.addEventListener('click', (e) => {
                if (e.target === bulkDeleteModal) {
                    this.hideBulkDeleteModal();
                }
            });
        }

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideDeleteModal();
                this.hideDeleteRatingModal();
                this.hideBulkDeleteModal();
            }
        });
    }

    showLoading() {
        const loading = document.getElementById('adminLoading');
        const content = document.getElementById('adminContent');
        
        if (loading) loading.style.display = 'flex';
        if (content) content.style.display = 'none';
    }

    hideLoading() {
        const loading = document.getElementById('adminLoading');
        const content = document.getElementById('adminContent');
        
        if (loading) loading.style.display = 'none';
        if (content) content.style.display = 'block';
    }

    showError(message) {
        const errorDiv = document.getElementById('adminError');
        const errorText = document.getElementById('errorText');
        
        if (errorDiv && errorText) {
            errorText.textContent = message;
            errorDiv.style.display = 'block';
        }
        
        this.hideLoading();
    }

    showSuccessMessage(message) {
        // Create temporary success message
        const successDiv = document.createElement('div');
        successDiv.className = 'admin-success';
        successDiv.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: #22c55e;
            color: white;
            padding: var(--space-md) var(--space-lg);
            border-radius: var(--radius-lg);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        successDiv.textContent = message;
        
        document.body.appendChild(successDiv);
        
        setTimeout(() => {
            successDiv.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => successDiv.remove(), 300);
        }, 3000);
    }

    async loadMovies() {
        console.time('[Admin Perf] loadMovies total');
        try {
            this.showLoading();
            
            // Get last visible doc for current page (for Next button)
            // For Page 1, it's null. For Page 2, it's lastDocs[0].
            const lastDoc = this.pagination.currentPage > 1 ? 
                this.pagination.lastVisibleDocs[this.pagination.currentPage - 2] : null;

            console.time('[Admin Perf] loadMovies - DB fetchMoviesPage');
            const result = await this.cacheService.fetchMoviesPage(
                lastDoc,
                this.pagination.itemsPerPage
            );
            console.timeEnd('[Admin Perf] loadMovies - DB fetchMoviesPage');

            this.movies = result.movies;
            const hasMore = result.hasMore;
            const newLastDoc = result.lastDoc;

            // Update pagination state
            if (newLastDoc) {
                // If we are moving forward, add to stack
                if (this.pagination.currentPage > this.pagination.lastVisibleDocs.length) {
                    this.pagination.lastVisibleDocs.push(newLastDoc);
                } else {
                    // Updating existing (should match)
                    this.pagination.lastVisibleDocs[this.pagination.currentPage - 1] = newLastDoc;
                }
            }
            this.pagination.hasMore = hasMore;

            // Load ratings matching these movies (optimization: only fetch for current page?)
            // For now, to keep filters working, we might need more data, but let's try just showing what we have.
            // Or we can keep fetching all ratings if they are light.
            // Users requested "Reduce load".
            // We will fetch ALL ratings as per original design (caching them), assuming they are lighter than movies.
            
            console.time('[Admin Perf] loadMovies - Get cached ratings');
            const cachedRatings = this.cacheService.getCachedRatings();
            if (cachedRatings && this.cacheService.isCacheValid()) {
                 this.ratings = cachedRatings;
                 console.log(`[Admin] Using cached ratings (${this.cacheService.getCacheAgeMinutes()} min old)`);
                 console.timeEnd('[Admin Perf] loadMovies - Get cached ratings');
            } else {
                 console.timeEnd('[Admin Perf] loadMovies - Get cached ratings');
                 console.time('[Admin Perf] loadMovies - fetchAllRatings');
                 this.ratings = await this.cacheService.fetchAllRatings();
                 this.cacheService.saveRatingsToCache(this.ratings); // Update cache
                 console.timeEnd('[Admin Perf] loadMovies - fetchAllRatings');
            }
            
            console.time('[Admin Perf] loadMovies - buildMaps');
            this.ratingsMap = this.cacheService.buildRatingsMap(this.ratings);
            this.usersMap = await this.cacheService.fetchUsersForRatings(this.ratings);
            console.timeEnd('[Admin Perf] loadMovies - buildMaps');

            this.hideLoading();
            
            console.time('[Admin Perf] loadMovies - render');
            // Render
            this.filteredMovies = this.movies; // No client-side filtering on full DB anymore, only current page
            this.displayedMovies = this.movies;
            this.renderMovies();
            this.renderPagination();
            this.updateSelectionUI();
            console.timeEnd('[Admin Perf] loadMovies - render');

            // Show updated timestamp
            const updateTime = new Date().toLocaleTimeString();
            const ageDiv = document.getElementById('dataAge');
            if (ageDiv) ageDiv.textContent = `Обновлено: ${updateTime}`;
            
        } catch (error) {
            console.error('Error loading movies:', error);
            this.hideLoading();
            this.showError(`Не удалось загрузить фильмы: ${error.message}`);
        }
        console.timeEnd('[Admin Perf] loadMovies total');
    }

    async changePage(action) {
        if (action === 'next' && this.pagination.hasMore) {
            this.pagination.currentPage++;
            await this.loadMovies();
        } else if (action === 'prev' && this.pagination.currentPage > 1) {
            this.pagination.currentPage--;
            await this.loadMovies();
        } else if (action === 'first') {
            this.pagination.currentPage = 1;
            this.pagination.lastVisibleDocs = [];
            await this.loadMovies();
        }
        // 'last' is difficult with Firestore cursors without reading all. 
        // We will disable 'last' or implement it by reading a count if possible, but Firestore count is expensive.
        // For now, 'last' button will just be hidden or disabled if we can't implement it efficiently.
    }

    renderPagination() {
        const pageInfo = document.getElementById('paginationInfo');
        const pageNumbers = document.getElementById('page-numbers');
        const prevBtn = document.getElementById('prev-page');
        const nextBtn = document.getElementById('next-page');
        const firstBtn = document.getElementById('first-page');
        
        if (pageInfo) {
            const start = (this.pagination.currentPage - 1) * this.pagination.itemsPerPage + 1;
            const end = start + this.displayedMovies.length - 1;
            pageInfo.innerHTML = `Показано <span id="range-start">${start}</span>-<span id="range-end">${end}</span> фильмов`;
        }
        
        if (pageNumbers) {
            pageNumbers.textContent = `Страница ${this.pagination.currentPage}`;
        }
        
        if (prevBtn) prevBtn.disabled = this.pagination.currentPage === 1;
        if (firstBtn) firstBtn.disabled = this.pagination.currentPage === 1;
        if (nextBtn) nextBtn.disabled = !this.pagination.hasMore;
    }

    populateUserFilter() {
        const userFilter = document.getElementById('userFilter');
        if (!userFilter) return;

        // Clear existing options except "All Users"
        userFilter.innerHTML = '<option value="">Все пользователи</option>';

        // Get unique users from usersMap
        this.usersMap.forEach((user, userId) => {
            const option = document.createElement('option');
            option.value = userId;
            option.textContent = user.displayName || user.email || 'Unknown User';
            userFilter.appendChild(option);
        });
    }

    applyMoviesFilters() {
        // With server-side pagination, we only filter the CURRENT page
        // Or we should update the query. For now, we only filter the loaded movies client-side
        // Ideally, we would update the Firestore query, but that combines orderBy + where which needs indexes.
        
        this.filteredMovies = this.movies.filter(movie => {
            const movieId = movie.kinopoiskId;
            const movieRatings = this.ratingsMap.get(movieId) || [];
            const hasRating = movieRatings.length > 0;

            // Movie title filter
            if (this.ratingsFilters.movieTitle) {
                const movieTitle = movie.name?.toLowerCase() || '';
                const searchTerm = this.ratingsFilters.movieTitle.toLowerCase();
                if (!movieTitle.includes(searchTerm)) {
                    return false;
                }
            }

            // User filter - movie must have a rating from this user
            if (this.ratingsFilters.userId) {
                const hasRatingFromUser = movieRatings.some(r => r.userId === this.ratingsFilters.userId);
                if (!hasRatingFromUser) {
                    return false;
                }
            }

            // Rating status filter
            if (this.ratingsFilters.ratingStatus === 'rated' && !hasRating) {
                return false;
            }
            if (this.ratingsFilters.ratingStatus === 'unrated' && hasRating) {
                return false;
            }

            return true;
        });

        this.displayedMovies = this.filteredMovies; // Show all filtered from current page
        
        this.renderMovies();
        this.renderPagination();
        this.updateSelectionUI();
    }

    renderMovies() {
        const tableBody = document.getElementById('ratingsTableBody');
        const ratingsCount = document.getElementById('ratingsCount');
        
        if (!tableBody) return;

        // Update count
        if (ratingsCount) {
            ratingsCount.textContent = `${this.filteredMovies.length} фильмов`;
        }

        // Clear existing rows
        tableBody.innerHTML = '';

        if (this.displayedMovies.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: var(--space-xl); color: var(--text-secondary);">
                        Фильмы не найдены
                    </td>
                </tr>
            `;
            return;
        }

        // Render each movie
        this.displayedMovies.forEach(movie => {
            const row = this.createMovieRow(movie);
            tableBody.appendChild(row);
        });
    }

    createMovieRow(movie) {
        const row = document.createElement('tr');
        const movieId = movie.kinopoiskId;
        const isSelected = this.selectedMovies.has(movieId);
        
        // Get rating info for this movie
        const movieRatings = this.ratingsMap.get(movieId) || [];
        const latestRating = movieRatings[0]; // Ratings are sorted by date desc
        const hasRating = movieRatings.length > 0;
        
        // Get user info
        let userInfo = { displayName: '—', email: '', photoURL: null };
        let ratingValue = '—';
        let ratingComment = '—';
        let ratingDate = '—';
        
        if (hasRating && latestRating) {
            const user = latestRating.user || this.usersMap.get(latestRating.userId) || {};
            userInfo = {
                displayName: user.displayName || user.email || 'Unknown',
                email: user.email || '',
                photoURL: user.photoURL
            };
            ratingValue = latestRating.rating || '—';
            ratingComment = latestRating.comment || '—';
            ratingDate = latestRating.createdAt?.toDate ? 
                latestRating.createdAt.toDate().toLocaleDateString() : 
                (latestRating.createdAt ? new Date(latestRating.createdAt).toLocaleDateString() : '—');
        }

        const movieTitle = movie.name || 'Unknown Movie';
        const movieYear = movie.year ? ` (${movie.year})` : '';
        const truncatedComment = ratingComment.length > 50 ? ratingComment.substring(0, 50) + '...' : ratingComment;

        if (isSelected) {
            row.classList.add('selected');
        }

        row.innerHTML = `
            <td class="col-checkbox">
                <input type="checkbox" 
                       class="admin-checkbox row-checkbox" 
                       data-movie-id="${movieId}"
                       ${isSelected ? 'checked' : ''}>
            </td>
            <td>
                <div class="movie-info">
                    ${movie.posterUrl ? 
                        `<img src="${movie.posterUrl}" alt="${this.escapeHtml(movieTitle)}" class="movie-poster" onerror="this.style.display='none'">` : 
                        ''
                    }
                    <div>
                        <div class="movie-title">${this.escapeHtml(movieTitle)}${movieYear}</div>
                        <div class="movie-id">ID: ${movieId}</div>
                    </div>
                </div>
            </td>
            <td>
                ${hasRating ? `
                <div class="user-info">
                    <img src="${userInfo.photoURL || chrome.runtime.getURL('icons/icon48.png')}" 
                         alt="${this.escapeHtml(userInfo.displayName)}" 
                         class="user-avatar"
                         onerror="this.src='${chrome.runtime.getURL('icons/icon48.png')}'">
                    <div>
                        <div class="user-name">${this.escapeHtml(userInfo.displayName)}</div>
                        <div class="user-email">${this.escapeHtml(userInfo.email)}</div>
                    </div>
                </div>
                ` : `<span class="unrated-cell">Не оценен</span>`}
            </td>
            <td>
                ${hasRating ? `
                <div class="rating-value">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                    </svg> ${ratingValue}
                </div>
                ` : `<span class="unrated-cell">—</span>`}
            </td>
            <td>
                <div class="rating-comment" title="${this.escapeHtml(ratingComment)}">
                    ${hasRating ? this.escapeHtml(truncatedComment) : '<span class="unrated-cell">—</span>'}
                </div>
            </td>
            <td>
                <div class="rating-date">${ratingDate}</div>
            </td>
        `;

        // Add checkbox change handler
        const checkbox = row.querySelector('.row-checkbox');
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                this.handleCheckboxChange(movieId, e.target.checked, row);
            });
        }

        return row;
    }

    showSkeletonRows(count) {
        const tableBody = document.getElementById('ratingsTableBody');
        if (!tableBody) return;

        tableBody.innerHTML = '';
        
        for (let i = 0; i < count; i++) {
            const row = document.createElement('tr');
            row.className = 'skeleton-row';
            row.innerHTML = `
                <td class="col-checkbox">
                    <div class="skeleton skeleton-text short" style="width: 18px; height: 18px;"></div>
                </td>
                <td>
                    <div class="skeleton-movie">
                        <div class="skeleton skeleton-poster"></div>
                        <div>
                            <div class="skeleton skeleton-title"></div>
                            <div class="skeleton skeleton-subtitle"></div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="skeleton skeleton-avatar"></div>
                </td>
                <td>
                    <div class="skeleton skeleton-text short"></div>
                </td>
                <td>
                    <div class="skeleton skeleton-text long"></div>
                </td>
                <td>
                    <div class="skeleton skeleton-text"></div>
                </td>
            `;
            tableBody.appendChild(row);
        }
    }

    // loadMoreMovies and updateLoadMoreButton removed in favor of pagination

    updateProgress(loaded, total) {
        const loadedCount = document.getElementById('loadedCount');
        const progressFill = document.getElementById('progressBarFill');

        if (loadedCount) {
            loadedCount.textContent = `Загружено: ${loaded} из ${total} фильмов`;
        }

        if (progressFill) {
            const percent = total > 0 ? (loaded / total) * 100 : 0;
            progressFill.style.width = `${percent}%`;
        }
    }

    // Selection management
    handleCheckboxChange(movieId, isChecked, row) {
        if (isChecked) {
            this.selectedMovies.add(movieId);
            row.classList.add('selected');
        } else {
            this.selectedMovies.delete(movieId);
            row.classList.remove('selected');
        }
        this.updateSelectionUI();
    }

    handleSelectAll(isChecked) {
        // Select/deselect all displayed movies
        this.displayedMovies.forEach(movie => {
            const movieId = movie.kinopoiskId;
            if (isChecked) {
                this.selectedMovies.add(movieId);
            } else {
                this.selectedMovies.delete(movieId);
            }
        });

        // Update all checkboxes in table
        const checkboxes = document.querySelectorAll('.row-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = isChecked;
            const row = cb.closest('tr');
            if (row) {
                row.classList.toggle('selected', isChecked);
            }
        });

        this.updateSelectionUI();
    }

    updateSelectionUI() {
        const counter = document.getElementById('selectionCounter');
        const clearCacheBtn = document.getElementById('bulkClearCacheBtn');
        const updateInfoBtn = document.getElementById('bulkUpdateInfoBtn');
        const deleteBtn = document.getElementById('bulkDeleteBtn');
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const headerCheckbox = document.getElementById('headerCheckbox');

        const selectedCount = this.selectedMovies.size;

        if (counter) {
            counter.textContent = `Выбрано: ${selectedCount}`;
        }

        // Enable/disable bulk action buttons
        const hasSelection = selectedCount > 0;
        const canWrite = this.isOnline;
        
        if (clearCacheBtn) clearCacheBtn.disabled = !hasSelection || !canWrite;
        if (updateInfoBtn) updateInfoBtn.disabled = !hasSelection || !canWrite;
        if (deleteBtn) deleteBtn.disabled = !hasSelection || !canWrite;

        // Update "select all" checkbox state
        if (selectAllCheckbox) {
            const allDisplayedSelected = this.displayedMovies.every(m => 
                this.selectedMovies.has(m.kinopoiskId)
            );
            selectAllCheckbox.checked = allDisplayedSelected && this.displayedMovies.length > 0;
            selectAllCheckbox.indeterminate = selectedCount > 0 && !allDisplayedSelected;
        }
        if (headerCheckbox) {
            const allDisplayedSelected = this.displayedMovies.every(m => 
                this.selectedMovies.has(m.kinopoiskId)
            );
            headerCheckbox.checked = allDisplayedSelected && this.displayedMovies.length > 0;
            headerCheckbox.indeterminate = selectedCount > 0 && !allDisplayedSelected;
        }
    }

    // UI state indicators
    showBackgroundSyncIndicator(show) {
        const indicator = document.getElementById('backgroundSyncIndicator');
        if (indicator) {
            indicator.style.display = show ? 'inline-flex' : 'none';
        }
    }

    showDataUpdatedBadge() {
        const badge = document.getElementById('dataUpdatedBadge');
        if (badge) {
            badge.style.display = 'inline-flex';
            setTimeout(() => {
                badge.style.display = 'none';
            }, 3000);
        }
    }

    updateOnlineStatus(isOnline) {
        this.isOnline = isOnline;
        this.updateOnlineIndicator();
        this.updateSelectionUI();
    }

    updateOnlineIndicator() {
        const indicator = document.getElementById('offlineIndicator');
        if (indicator) {
            indicator.style.display = this.isOnline ? 'none' : 'inline-flex';
        }
    }

    // Force refresh
    async forceRefresh() {
        if (!this.isOnline) {
            this.showError('Нет подключения к интернету');
            return;
        }

        const refreshBtn = document.getElementById('refreshDataBtn');
        if (refreshBtn) {
            refreshBtn.classList.add('loading');
            refreshBtn.disabled = true;
        }

        try {
            // Clear selection before refresh
            this.selectedMovies.clear();
            
            // Show skeleton
            this.showSkeletonRows(this.pagination.itemsPerPage);
            
            // Clear cache to force fresh fetch for ratings too
            this.cacheService.clearCache();
            
            // Reset pagination
            this.pagination.currentPage = 1;
            this.pagination.lastVisibleDocs = [];
            
            // Load fresh data
            await this.loadMovies();
            
            this.showSuccessMessage('Данные обновлены');
        } catch (error) {
            console.error('Error refreshing data:', error);
            this.showError(`Ошибка обновления: ${error.message}`);
        } finally {
            if (refreshBtn) {
                refreshBtn.classList.remove('loading');
                refreshBtn.disabled = false;
            }
        }
    }

    // Bulk operations
    async bulkClearCache() {
        // Only clear local cache, do not delete from server
        
        // This check is for write access to server, which we don't need for local cache clearing
        // but we can keep it if we want to ensure only admins can do this, 
        // though strictly speaking clearing local cache should be allowed for anyone if the UI exposes it.
        // For consistency, let's just proceed.

        const movieIds = Array.from(this.selectedMovies);
        if (movieIds.length === 0) return;

        const btn = document.getElementById('bulkClearCacheBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="icon">⏳</span> Очистка...';
        }

        try {
            // Update local cache only
            this.cacheService.removeMoviesFromCache(movieIds);
            
            this.showSuccessMessage(`Кэш очищен для ${movieIds.length} фильмов`);
            this.selectedMovies.clear();
            this.updateSelectionUI();
            
            // Optionally refresh the view or just mark them as needing refresh?
            // Since we just cleared cache, the current view is technically "stale" but matches what was loaded.
            // Let's just update UI.
        } catch (error) {
            console.error('Bulk clear cache error:', error);
            this.showError(`Ошибка: ${error.message}`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span class="icon">🗑️</span> Очистить кэш';
            }
        }
    }

    async clearMovieCache(movieId, movieData) {
        if (!movieId) return;

        try {
            // Only clear local cache
            this.cacheService.removeMoviesFromCache([movieId]);
            this.showSuccessMessage(`Кэш очищен для фильма`);
        } catch (error) {
            console.error('Error clearing movie cache:', error);
            this.showError(`Failed to clear cache: ${error.message}`);
        }
    }

    async bulkUpdateInfo() {
        const check = this.cacheService.checkWriteAccess();
        if (!check.canWrite) {
            this.showError(check.reason);
            return;
        }

        const movieIds = Array.from(this.selectedMovies);
        if (movieIds.length === 0) return;

        const btn = document.getElementById('bulkUpdateInfoBtn');
        if (btn) {
            btn.disabled = true;
        }

        try {
            const result = await this.adminService.bulkUpdateMoviesInfo(
                movieIds, 
                this.currentUser.uid,
                (current, total) => {
                    if (btn) {
                        btn.innerHTML = `<span class="icon">🔄</span> ${current}/${total}`;
                    }
                }
            );

            this.showSuccessMessage(`Обновлено ${result.updated} фильмов`);
            
            // Refresh to show updated data
            await this.forceRefresh();
        } catch (error) {
            console.error('Bulk update error:', error);
            this.showError(`Ошибка: ${error.message}`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span class="icon">🔄</span> Обновить инфо';
            }
        }
    }

    showBulkDeleteConfirmation() {
        const count = this.selectedMovies.size;
        if (count === 0) return;

        const preview = document.getElementById('bulkDeletePreview');
        if (preview) {
            preview.textContent = `${count} фильмов`;
        }

        const modal = document.getElementById('bulkDeleteModal');
        if (modal) {
            modal.style.display = 'flex';
        }
    }

    hideBulkDeleteModal() {
        const modal = document.getElementById('bulkDeleteModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    async confirmBulkDelete() {
        const check = this.cacheService.checkWriteAccess();
        if (!check.canWrite) {
            this.showError(check.reason);
            return;
        }

        const movieIds = Array.from(this.selectedMovies);
        if (movieIds.length === 0) return;

        const confirmBtn = document.getElementById('confirmBulkDeleteBtn');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Удаление...';
        }

        try {
            const result = await this.adminService.bulkDeleteMoviesAndRatings(movieIds, this.currentUser.uid);

            // Update local cache
            this.cacheService.removeMoviesFromCache(movieIds);

            // Remove from local arrays
            this.movies = this.movies.filter(m => !movieIds.includes(m.kinopoiskId));
            movieIds.forEach(id => this.ratingsMap.delete(id));
            
            this.selectedMovies.clear();
            this.applyMoviesFilters();
            
            this.hideBulkDeleteModal();
            this.showSuccessMessage(`Удалено ${result.moviesDeleted} фильмов и ${result.ratingsDeleted} оценок`);
        } catch (error) {
            console.error('Bulk delete error:', error);
            this.showError(`Ошибка удаления: ${error.message}`);
        } finally {
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Удалить';
            }
        }
    }

    async showDeleteRatingConfirmation(rating) {
        try {
            this.ratingToDelete = rating;

            const movie = rating.movie || {};
            const user = rating.user || {};
            const movieTitle = movie.name || 'Unknown Movie';
            const userName = user.displayName || user.email || 'Unknown User';

            const ratingPreview = document.getElementById('ratingPreview');
            if (ratingPreview) {
                ratingPreview.innerHTML = `
                    <p><strong>Movie:</strong> ${this.escapeHtml(movieTitle)}</p>
                    <p><strong>User:</strong> ${this.escapeHtml(userName)}</p>
                    <p><strong>Rating:</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> ${rating.rating}</p>
                    ${rating.comment ? `<p><strong>Comment:</strong> ${this.escapeHtml(rating.comment.substring(0, 100))}${rating.comment.length > 100 ? '...' : ''}</p>` : ''}
                `;
            }

            const modal = document.getElementById('deleteRatingModal');
            if (modal) {
                modal.style.display = 'flex';
            }
        } catch (error) {
            console.error('Error showing delete rating confirmation:', error);
            this.showError(`Failed to load rating data: ${error.message}`);
        }
    }

    async confirmDeleteRating() {
        if (!this.ratingToDelete) return;

        try {
            const confirmBtn = document.getElementById('confirmDeleteRatingBtn');
            if (confirmBtn) {
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Deleting...';
            }

            await this.adminService.deleteRatingAsAdmin(this.ratingToDelete.id, this.currentUser.uid);
            
            // Close modal
            this.hideDeleteRatingModal();
            
            // Reload ratings
            await this.loadRatings();
            
            // Show success message
            this.showSuccessMessage('Rating deleted successfully');
            
            this.ratingToDelete = null;
        } catch (error) {
            console.error('Error deleting rating:', error);
            const confirmBtn = document.getElementById('confirmDeleteRatingBtn');
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Delete Rating';
            }
            this.showError(`Failed to delete rating: ${error.message}`);
        }
    }

    hideDeleteRatingModal() {
        const modal = document.getElementById('deleteRatingModal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.ratingToDelete = null;
    }

    async updateMovieInfo(rating) {
        if (!rating || !rating.movieId) return;
        
        const movieId = rating.movieId;
        const movieTitle = rating.movie?.name || 'this movie';

        try {
            // Show loading state
            const buttons = document.querySelectorAll(`.btn-update-info[data-movie-id="${movieId}"]`);
            buttons.forEach(btn => {
                btn.disabled = true;
                btn.textContent = 'Updating...';
            });

            // 1. Fetch fresh data from Kinopoisk
            const kinopoiskService = new KinopoiskService();
            const freshMovieData = await kinopoiskService.getMovieById(movieId);

            if (!freshMovieData) {
                throw new Error('Failed to fetch data from Kinopoisk');
            }

            // 2. Update Firestore cache
            const movieCacheService = firebaseManager.getMovieCacheService();
            await movieCacheService.cacheRatedMovie(freshMovieData);

            // 3. Clear local cache for this movie to ensure immediate update in UI
            localStorage.removeItem(`kp_movie_${movieId}`);

            // 4. Reload ratings to reflect changes
            await this.loadRatings();

            this.showSuccessMessage(`Updated info for "${movieTitle}"`);

        } catch (error) {
            console.error('Error updating movie info:', error);
            
            // Reset button state
            const buttons = document.querySelectorAll(`.btn-update-info[data-movie-id="${movieId}"]`);
            buttons.forEach(btn => {
                btn.disabled = false;
                btn.textContent = 'Update Info';
            });

            this.showError(`Failed to update movie info: ${error.message}`);
        }
    }

    async clearMovieCache(movieId, movieData) {
        if (!movieId) return;

        const movieTitle = movieData?.name || 'this movie';

        if (!confirm(`Are you sure you want to clear the cache for "${movieTitle}"?\n\nThis will remove all cached data for this movie from both Firestore and localStorage.`)) {
            return;
        }

        try {
            // Show loading indicator on the button
            const buttons = document.querySelectorAll(`.btn-clear-cache[data-movie-id="${movieId}"]`);
            buttons.forEach(btn => {
                btn.disabled = true;
                btn.textContent = 'Clearing...';
            });

            await this.adminService.clearMovieCacheAsAdmin(movieId, this.currentUser.uid);

            // Show success message
            this.showSuccessMessage(`Cache cleared successfully for "${movieTitle}"`);

            // Reset button state
            buttons.forEach(btn => {
                btn.disabled = false;
                btn.textContent = 'Clear Cache';
            });
        } catch (error) {
            console.error('Error clearing movie cache:', error);
            
            // Reset button state
            const buttons = document.querySelectorAll(`.btn-clear-cache[data-movie-id="${movieId}"]`);
            buttons.forEach(btn => {
                btn.disabled = false;
                btn.textContent = 'Clear Cache';
            });

            this.showError(`Failed to clear cache: ${error.message}`);
        }
    }

    initReports() {
        if (typeof firebaseManager === 'undefined' || !firebaseManager.isInitialized) return;
        
        let pendingList = document.getElementById('pendingReportsList');
        let resolvedList = document.getElementById('resolvedReportsList');
        if (!pendingList || !resolvedList) return;
        
        this.unsubscribeReports = firebaseManager.listenToReports((reports) => {
            this.renderReports(reports);
        });
    }

    renderReports(reports) {
        const pendingList = document.getElementById('pendingReportsList');
        const resolvedList = document.getElementById('resolvedReportsList');
        const countSpan = document.getElementById('reportsCount');
        const pendingCountBadge = document.getElementById('pendingReportsCount');
        const resolvedCountBadge = document.getElementById('resolvedReportsCount');
        
        if (!pendingList || !resolvedList) return;
        
        const pending = reports.filter(r => r.status === 'pending');
        const resolved = reports.filter(r => r.status === 'resolved');
        
        if (countSpan) countSpan.textContent = `${reports.length} репортов`;
        if (pendingCountBadge) pendingCountBadge.textContent = pending.length;
        if (resolvedCountBadge) resolvedCountBadge.textContent = resolved.length;
        
        this.renderReportsList(pendingList, pending, true);
        this.renderReportsList(resolvedList, resolved, false);
    }

    renderReportsList(container, reports, isPending) {
        container.innerHTML = '';
        if (reports.length === 0) {
            container.innerHTML = '<div class="reports-empty">Нет репортов</div>';
            return;
        }
        
        reports.forEach(report => {
            const card = document.createElement('div');
            card.className = 'report-card';
            
            const dateStr = report.createdAt ? 
                (typeof report.createdAt.toDate === 'function' ? report.createdAt.toDate().toLocaleString() : new Date(report.createdAt).toLocaleString()) 
                : 'Недавно';
            
            let photoHtml = '';
            if (report.photoUrl) {
                photoHtml = `<img class="report-photo" src="${report.photoUrl}" alt="Прикрепленное фото" data-photo-url="${report.photoUrl}">`;
            }
            
            let actionHtml = '';
            if (isPending) {
                actionHtml = `<button class="btn-resolve" data-id="${report.id}">✔ Решено</button>`;
            }
            actionHtml += `<button class="btn-report-delete" data-id="${report.id}" data-photo="${report.photoPath || ''}">🗑 Удалить</button>`;
            
            card.innerHTML = `
                <div class="report-header">
                    <span class="report-date">${dateStr}</span>
                    <a href="${report.pageUrl}" target="_blank" class="report-url" title="${report.pageUrl}">${report.pageUrl.replace('chrome-extension://', '').substring(0, 30)}...</a>
                </div>
                <div class="report-text">${this.escapeHtml(report.text)}</div>
                ${photoHtml}
                <div class="report-actions">
                    ${actionHtml}
                </div>
            `;
            
            container.appendChild(card);
        });
        
        // Add listeners
        container.querySelectorAll('.btn-resolve').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.dataset.id;
                try {
                    e.target.disabled = true;
                    e.target.textContent = 'Обработка...';
                    await firebaseManager.updateReportStatus(id, 'resolved');
                } catch (err) {
                    console.error('Ошибка:', err);
                    alert('Ошибка: ' + err.message);
                    e.target.disabled = false;
                    e.target.textContent = '✔ Решено';
                }
            });
        });
        
        container.querySelectorAll('.report-photo').forEach(img => {
            img.addEventListener('click', (e) => {
                this.openPhotoLightbox(e.target.dataset.photoUrl);
            });
        });
        
        container.querySelectorAll('.btn-report-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (!confirm('Вы точно хотите удалить этот репорт?')) return;
                const id = e.target.dataset.id;
                const photoPath = e.target.dataset.photo;
                try {
                    e.target.disabled = true;
                    e.target.textContent = 'Удаление...';
                    await firebaseManager.deleteReport(id, photoPath);
                } catch (err) {
                    console.error('Ошибка:', err);
                    alert('Ошибка: ' + err.message);
                    e.target.disabled = false;
                    e.target.textContent = '🗑 Удалить';
                }
            });
        });
    }

    escapeHtml(text) {
        if (!text) return '';
        if (typeof Utils !== 'undefined' && Utils.escapeHtml) {
            return Utils.escapeHtml(text);
        }
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    openPhotoLightbox(url) {
        let overlay = document.getElementById('report-lightbox-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'report-lightbox-overlay';
            overlay.className = 'report-lightbox-overlay';
            
            const img = document.createElement('img');
            img.id = 'report-lightbox-image';
            img.className = 'report-lightbox-image';
            
            const closeBtn = document.createElement('button');
            closeBtn.className = 'report-lightbox-close';
            closeBtn.innerHTML = '✕';
            
            overlay.appendChild(img);
            overlay.appendChild(closeBtn);
            document.body.appendChild(overlay);
            
            const closeLightbox = () => {
                overlay.classList.remove('visible');
            };
            
            closeBtn.addEventListener('click', closeLightbox);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeLightbox();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && overlay.classList.contains('visible')) {
                    closeLightbox();
                }
            });
        }
        
        const img = document.getElementById('report-lightbox-image');
        img.src = url;
        overlay.classList.add('visible');
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.adminPanel = new AdminPanelManager();
});
