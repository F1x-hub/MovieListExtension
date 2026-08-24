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
        this.userStatusFilter = 'all';
        this.userSearchTimeout = null;
        this.displayedUsers = [];
        this.pendingUsers = [];
        this.selectedApprovalIds = new Set();
        
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
                const adminContent = document.getElementById('adminContent');
                if (adminContent) adminContent.style.display = 'none';
                if (window.adminNav && typeof window.adminNav.showAuthModal === 'function') {
                    window.adminNav.showAuthModal('login');
                }
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
            // Load users, movies and approvals sequentially to avoid WebChannel stream congestion
            this.showLoading();
            await this.loadUsers();
            await this.loadMovies();
            await this.loadApprovals();
            this.hideLoading();
            console.timeEnd('[Admin Perf] 4. Load Data Sequentially');

            console.time('[Admin Perf] 5. UI & Event Setup');
            // Initialize Reports & TMDB Fallbacks / Manual Mapping
            this.initReports();
            this.initTmdbFallbacks();

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
                    <td><div class="skeleton-text" style="width: 70px;"></div></td>
                    <td><div class="skeleton-text" style="width: 80px;"></div></td>
                    <td><div class="skeleton-text" style="width: 40px;"></div></td>
                    <td><div class="skeleton-text" style="width: 40px;"></div></td>
                    <td><div class="skeleton-text" style="width: 120px;"></div></td>
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

            this.applyUserFilters();
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

    applyUserFilters() {
        let result = [...this.users];

        if (this.userStatusFilter && this.userStatusFilter !== 'all') {
            result = result.filter(user => {
                const status = user.approvalStatus || 'approved';
                return status === this.userStatusFilter;
            });
        }

        if (this.userSearchTerm) {
            const term = this.userSearchTerm.toLowerCase();
            result = result.filter(user => 
                (user.displayName && user.displayName.toLowerCase().includes(term)) ||
                (user.email && user.email.toLowerCase().includes(term)) ||
                (user.id && user.id.toLowerCase().includes(term))
            );
        }

        this.displayedUsers = result;
        this.renderUsers();
        this.renderUserPagination();
    }

    applyUserSearch() {
        this.applyUserFilters();
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
                    <td colspan="8" style="text-align: center; padding: var(--space-xl); color: var(--text-secondary);">
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
        const isCurrentUser = this.currentUser && user.id === this.currentUser.uid;
        const joinDate = user.createdAt?.toDate ? 
            user.createdAt.toDate().toLocaleDateString() : 
            (user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown');

        const status = user.approvalStatus || 'approved';
        let statusBadge;
        if (status === 'approved') {
            statusBadge = '<span class="status-badge status-badge-approved">Approved</span>';
        } else if (status === 'pending') {
            statusBadge = '<span class="status-badge status-badge-pending">Pending</span>';
        } else if (status === 'rejected') {
            statusBadge = '<span class="status-badge status-badge-rejected">Rejected</span>';
        } else {
            statusBadge = `<span class="status-badge status-badge-approved">${this.escapeHtml(status)}</span>`;
        }

        let actionsHtml;
        if (isCurrentUser) {
            actionsHtml = `
                <div class="row-actions-group">
                    <button class="btn-delete" 
                            data-user-id="${user.id}"
                            disabled title="You cannot delete your own account">
                        Delete
                    </button>
                </div>
            `;
        } else {
            let statusButtons = '';
            if (status === 'approved') {
                statusButtons = `
                    <button class="btn-status-toggle btn-reject-sm" data-action="reject" data-user-id="${user.id}">Заблокировать</button>
                    <button class="btn-status-toggle" data-action="pending" data-user-id="${user.id}">В Pending</button>
                `;
            } else if (status === 'pending') {
                statusButtons = `
                    <button class="btn-approve-sm" data-action="approve" data-user-id="${user.id}">Одобрить</button>
                    <button class="btn-reject-sm" data-action="reject" data-user-id="${user.id}">Отклонить</button>
                `;
            } else if (status === 'rejected') {
                statusButtons = `
                    <button class="btn-approve-sm" data-action="approve" data-user-id="${user.id}">Разблокировать</button>
                    <button class="btn-status-toggle" data-action="pending" data-user-id="${user.id}">В Pending</button>
                `;
            }

            actionsHtml = `
                <div class="row-actions-group">
                    ${statusButtons}
                    <button class="btn-delete" data-user-id="${user.id}">
                        Delete
                    </button>
                </div>
            `;
        }

        row.innerHTML = `
            <td>
                <div class="user-info">
                    <img src="${user.photoURL || chrome.runtime.getURL('icons/icon48.png')}" 
                         alt="${user.displayName || 'User'}" 
                         class="user-avatar"
                         loading="lazy">
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
            <td>${statusBadge}</td>
            <td>${joinDate}</td>
            <td>
                <div class="user-stats">${user.ratingsCount || 0}</div>
            </td>
            <td>
                <div class="user-stats">${user.collectionCount || 0}</div>
            </td>
            <td style="text-align: right;">
                ${actionsHtml}
            </td>
        `;

        // Add event listeners for status toggle buttons
        const actionBtns = row.querySelectorAll('[data-action]');
        actionBtns.forEach(btn => {
            btn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this.handleUserApprovalAction(btn.dataset.userId, btn.dataset.action, btn);
            });
        });

        // Add click handler for delete button
        const deleteBtn = row.querySelector('.btn-delete');
        if (deleteBtn && !isCurrentUser) {
            deleteBtn.addEventListener('mousedown', () => this.showDeleteConfirmation(user));
        }

        const avatar = row.querySelector('.user-avatar');
        if (avatar) {
            avatar.addEventListener('error', () => {
                avatar.src = chrome.runtime.getURL('icons/icon48.png');
            });
        }

        return row;
    }

    async handleUserApprovalAction(userId, action, btn) {
        try {
            if (btn) btn.disabled = true;
            let targetStatus = action;
            if (action === 'block' || action === 'reject') targetStatus = 'rejected';
            if (action === 'approve') targetStatus = 'approved';
            if (action === 'pending') targetStatus = 'pending';

            const targetUser = this.users.find(u => u.id === userId);
            const success = await this.adminService.updateUserApprovalStatus(userId, targetStatus, this.currentUser.uid);
            if (success) {
                if (targetUser) {
                    targetUser.approvalStatus = targetStatus;
                }
                this.cacheService.saveUsersToCache(this.users);
                this.applyUserFilters();
                await this.loadApprovals();
                const statusLabels = { approved: 'одобрен', rejected: 'заблокирован / отклонён', pending: 'переведён в ожидание' };
                this.showSuccessMessage(`Пользователь ${targetUser?.displayName || userId} ${statusLabels[targetStatus] || targetStatus}`);
            }
        } catch (err) {
            console.error('Error updating user approval status:', err);
            this.showError(`Ошибка обновления статуса: ${err.message}`);
            if (btn) btn.disabled = false;
        }
    }

    async loadApprovals() {
        try {
            const pendingUsers = await this.adminService.getPendingApprovals(100);
            this.pendingUsers = pendingUsers || [];
            this.selectedApprovalIds.clear();

            // Update counts
            const count = this.pendingUsers.length;
            const navBadge = document.getElementById('adminNavApprovalsCount');
            const headerBadge = document.getElementById('approvalsCount');
            if (navBadge) navBadge.textContent = count > 0 ? count : '—';
            if (headerBadge) headerBadge.textContent = `${count} заяв${count === 1 ? 'ка' : (count > 1 && count < 5 ? 'ки' : 'ок')}`;

            this.renderApprovalsTable();
            this.updateBatchApproveButton();
        } catch (error) {
            console.error('Error loading approvals:', error);
        }
    }

    renderApprovalsTable() {
        const tableBody = document.getElementById('approvalsTableBody');
        if (!tableBody) return;
        tableBody.innerHTML = '';

        if (this.pendingUsers.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: var(--space-xl); color: var(--text-secondary);">
                        Нет ожидающих заявок на одобрение
                    </td>
                </tr>
            `;
            return;
        }

        this.pendingUsers.forEach(user => {
            const row = document.createElement('tr');
            const joinDate = user.createdAt?.toDate ? 
                user.createdAt.toDate().toLocaleDateString() : 
                (user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown');

            const isChecked = this.selectedApprovalIds.has(user.id);

            row.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" class="approval-checkbox" data-user-id="${user.id}" ${isChecked ? 'checked' : ''}>
                </td>
                <td>
                    <div class="user-info">
                        <img src="${user.photoURL || chrome.runtime.getURL('icons/icon48.png')}" 
                             alt="${user.displayName || 'User'}" 
                             class="user-avatar"
                             loading="lazy">
                        <div>
                            <div class="user-name">
                                ${this.escapeHtml(user.displayName || 'Unknown User')}
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
                    <span class="status-badge status-badge-pending">Pending</span>
                </td>
                <td style="text-align: right;">
                    <div class="row-actions-group">
                        <button class="btn-approve-sm" data-action="approve" data-user-id="${user.id}">Одобрить</button>
                        <button class="btn-reject-sm" data-action="reject" data-user-id="${user.id}">Отклонить</button>
                        <button class="btn-delete" data-user-id="${user.id}">Delete</button>
                    </div>
                </td>
            `;

            const avatar = row.querySelector('.user-avatar');
            if (avatar) {
                avatar.addEventListener('error', () => {
                    avatar.src = chrome.runtime.getURL('icons/icon48.png');
                });
            }

            // Checkbox change listener
            const checkbox = row.querySelector('.approval-checkbox');
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        this.selectedApprovalIds.add(user.id);
                    } else {
                        this.selectedApprovalIds.delete(user.id);
                    }
                    this.updateBatchApproveButton();
                });
            }

            // Action buttons listeners
            const actionBtns = row.querySelectorAll('[data-action]');
            actionBtns.forEach(btn => {
                btn.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    this.handleUserApprovalAction(btn.dataset.userId, btn.dataset.action, btn);
                });
            });

            // Delete button listener
            const deleteBtn = row.querySelector('.btn-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('mousedown', () => this.showDeleteConfirmation(user));
            }

            tableBody.appendChild(row);
        });
    }

    updateBatchApproveButton() {
        const batchBtn = document.getElementById('batchApproveBtn');
        const countSpan = document.getElementById('selectedApprovalsCount');
        const selectAllCb = document.getElementById('selectAllApprovalsCheckbox');
        
        const selectedCount = this.selectedApprovalIds.size;
        if (countSpan) countSpan.textContent = selectedCount;
        if (batchBtn) batchBtn.disabled = selectedCount === 0;

        if (selectAllCb) {
            selectAllCb.checked = this.pendingUsers.length > 0 && selectedCount === this.pendingUsers.length;
            selectAllCb.indeterminate = selectedCount > 0 && selectedCount < this.pendingUsers.length;
        }
    }

    async handleBatchApprove() {
        if (this.selectedApprovalIds.size === 0) return;
        const userIds = Array.from(this.selectedApprovalIds);
        try {
            const batchBtn = document.getElementById('batchApproveBtn');
            if (batchBtn) {
                batchBtn.disabled = true;
                batchBtn.innerHTML = 'Одобрение...';
            }

            const success = await this.adminService.batchApproveUsers(userIds, this.currentUser.uid);
            if (success) {
                this.showSuccessMessage(`Одобрено ${userIds.length} пользователей`);
                await this.loadApprovals();
                await this.fetchUsersFromDb();
            }
        } catch (error) {
            console.error('Error in batch approve:', error);
            this.showError(`Ошибка пакетного одобрения: ${error.message}`);
        } finally {
            this.updateBatchApproveButton();
        }
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
        // Listen for auth state changes (e.g. user logged out from popup or another tab)
        window.addEventListener('authStateChanged', async (e) => {
            const user = e.detail?.user;
            if (!user) {
                this.currentUser = null;
                const adminContent = document.getElementById('adminContent');
                if (adminContent) adminContent.style.display = 'none';
                this.showError('Сессия завершена. Для доступа к панели администратора необходимо войти в систему.');
                if (window.adminNav && typeof window.adminNav.showAuthModal === 'function') {
                    window.adminNav.showAuthModal('login');
                }
            } else {
                const isAdmin = await this.checkAdminAccess();
                if (isAdmin) {
                    this.currentUser = user;
                    const adminError = document.getElementById('adminError');
                    if (adminError) adminError.style.display = 'none';
                    const adminContent = document.getElementById('adminContent');
                    if (adminContent) adminContent.style.display = 'block';
                    this.cacheService?.clearUsersCache();
                    this.cacheService?.clearCache();
                    await this.loadUsers();
                    await this.loadMovies();
                    await this.loadApprovals();
                } else {
                    const adminContent = document.getElementById('adminContent');
                    if (adminContent) adminContent.style.display = 'none';
                    this.showError('Доступ запрещен. У текущего аккаунта нет прав администратора.');
                }
            }
        });

        // Delete user modal controls
        const closeBtn = document.getElementById('closeDeleteModal');
        const cancelBtn = document.getElementById('cancelDeleteBtn');
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        const modal = document.getElementById('deleteModal');

        if (closeBtn) {
            closeBtn.addEventListener('mousedown', () => this.hideDeleteModal());
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('mousedown', () => this.hideDeleteModal());
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('mousedown', () => this.confirmDelete());
        }

        // Close modal on outside click
        if (modal) {
            modal.addEventListener('mousedown', (e) => {
                if (e.target === modal) {
                    this.hideDeleteModal();
                }
            });
        }

        // Sidebar Navigation
        const sidebarLinks = document.querySelectorAll('.sidebar-link');
        const settingsPanes = document.querySelectorAll('.settings-pane');

        sidebarLinks.forEach(link => {
            link.addEventListener('mousedown', () => {
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

        // User Status Filter Select
        const userStatusSelect = document.getElementById('userStatusFilterSelect');
        if (userStatusSelect) {
            userStatusSelect.addEventListener('change', (e) => {
                this.userStatusFilter = e.target.value;
                this.applyUserFilters();
            });
        }

        // Approvals Pane Listeners
        const refreshApprovalsBtn = document.getElementById('refreshApprovalsBtn');
        if (refreshApprovalsBtn) {
            refreshApprovalsBtn.addEventListener('mousedown', () => this.loadApprovals());
        }

        const selectAllApprovalsCb = document.getElementById('selectAllApprovalsCheckbox');
        if (selectAllApprovalsCb) {
            selectAllApprovalsCb.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.pendingUsers.forEach(u => this.selectedApprovalIds.add(u.id));
                } else {
                    this.selectedApprovalIds.clear();
                }
                this.renderApprovalsTable();
                this.updateBatchApproveButton();
            });
        }

        const batchApproveBtn = document.getElementById('batchApproveBtn');
        if (batchApproveBtn) {
            batchApproveBtn.addEventListener('mousedown', () => this.handleBatchApprove());
        }
        
        // Users Pagination controls
        const userFirstPageBtn = document.getElementById('user-first-page');
        const userPrevPageBtn = document.getElementById('user-prev-page');
        const userNextPageBtn = document.getElementById('user-next-page');
        const userPageSizeSelect = document.getElementById('user-page-size-select');
        
        if (userFirstPageBtn) userFirstPageBtn.addEventListener('mousedown', () => this.changeUserPage('first'));
        if (userPrevPageBtn) userPrevPageBtn.addEventListener('mousedown', () => this.changeUserPage('prev'));
        if (userNextPageBtn) userNextPageBtn.addEventListener('mousedown', () => this.changeUserPage('next'));
        
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
            closeRatingBtn.addEventListener('mousedown', () => this.hideDeleteRatingModal());
        }

        if (cancelRatingBtn) {
            cancelRatingBtn.addEventListener('mousedown', () => this.hideDeleteRatingModal());
        }

        if (confirmRatingBtn) {
            confirmRatingBtn.addEventListener('mousedown', () => this.confirmDeleteRating());
        }

        if (ratingModal) {
            ratingModal.addEventListener('mousedown', (e) => {
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
            clearFiltersBtn.addEventListener('mousedown', () => {
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
            refreshBtn.addEventListener('mousedown', () => this.forceRefresh());
        }

        // Pagination controls
        const firstPageBtn = document.getElementById('first-page');
        const prevPageBtn = document.getElementById('prev-page');
        const nextPageBtn = document.getElementById('next-page');
        const lastPageBtn = document.getElementById('last-page');
        const pageSizeSelect = document.getElementById('page-size-select');

        if (firstPageBtn) firstPageBtn.addEventListener('mousedown', () => this.changePage('first'));
        if (prevPageBtn) prevPageBtn.addEventListener('mousedown', () => this.changePage('prev'));
        if (nextPageBtn) nextPageBtn.addEventListener('mousedown', () => this.changePage('next'));
        if (lastPageBtn) lastPageBtn.addEventListener('mousedown', () => this.changePage('last')); // Note: Firestore doesn't support true "last" easily without reading all
        
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
            bulkClearCacheBtn.addEventListener('mousedown', () => this.bulkClearCache());
        }

        const bulkUpdateInfoBtn = document.getElementById('bulkUpdateInfoBtn');
        if (bulkUpdateInfoBtn) {
            bulkUpdateInfoBtn.addEventListener('mousedown', () => this.bulkUpdateInfo());
        }

        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
        if (bulkDeleteBtn) {
            bulkDeleteBtn.addEventListener('mousedown', () => this.showBulkDeleteConfirmation());
        }

        // Bulk delete modal controls
        const closeBulkDeleteBtn = document.getElementById('closeBulkDeleteModal');
        const cancelBulkDeleteBtn = document.getElementById('cancelBulkDeleteBtn');
        const confirmBulkDeleteBtn = document.getElementById('confirmBulkDeleteBtn');
        const bulkDeleteModal = document.getElementById('bulkDeleteModal');

        if (closeBulkDeleteBtn) {
            closeBulkDeleteBtn.addEventListener('mousedown', () => this.hideBulkDeleteModal());
        }
        if (cancelBulkDeleteBtn) {
            cancelBulkDeleteBtn.addEventListener('mousedown', () => this.hideBulkDeleteModal());
        }
        if (confirmBulkDeleteBtn) {
            confirmBulkDeleteBtn.addEventListener('mousedown', () => this.confirmBulkDelete());
        }
        if (bulkDeleteModal) {
            bulkDeleteModal.addEventListener('mousedown', (e) => {
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
                        `<img src="${movie.posterUrl}" alt="${this.escapeHtml(movieTitle)}" class="movie-poster">` : 
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
                         class="user-avatar">
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

        const moviePoster = row.querySelector('.movie-poster');
        if (moviePoster) {
            moviePoster.addEventListener('error', () => {
                moviePoster.style.display = 'none';
            });
        }
        const userAvatar = row.querySelector('.user-avatar');
        if (userAvatar) {
            userAvatar.addEventListener('error', () => {
                userAvatar.src = chrome.runtime.getURL('icons/icon48.png');
            });
        }

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
            
            // Reload movies/ratings
            await this.loadMovies();
            
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

            // 4. Reload movies/ratings to reflect changes
            await this.loadMovies();

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
                ImageLightbox.show(e.target.dataset.photoUrl);
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

    initTmdbFallbacks() {
        this.tmdbFallbackService = (typeof TmdbFallbackQueueService !== 'undefined')
            ? new TmdbFallbackQueueService(firebaseManager)
            : null;
        this.idMappingService = (typeof IdMappingService !== 'undefined')
            ? new IdMappingService()
            : null;
        this.kinopoiskService = (typeof KinopoiskService !== 'undefined')
            ? new KinopoiskService()
            : null;

        this.activeQueueFilter = 'all';
        this.unmappedQueueData = [];

        // Subtabs switching
        const subtabBtns = document.querySelectorAll('.admin-subtab-btn');
        subtabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetSubtab = btn.dataset.subtab;
                subtabBtns.forEach(b => {
                    b.classList.remove('active');
                    b.style.fontWeight = '500';
                    b.style.color = 'var(--text-secondary)';
                });
                btn.classList.add('active');
                btn.style.fontWeight = '600';
                btn.style.color = 'var(--theme-text-primary)';

                const tabTmdbToKp = document.getElementById('subtab-tmdb-to-kp');
                const tabKpToImdb = document.getElementById('subtab-kp-to-imdb');
                if (tabTmdbToKp) tabTmdbToKp.style.display = targetSubtab === 'tmdb-to-kp' ? 'block' : 'none';
                if (tabKpToImdb) tabKpToImdb.style.display = targetSubtab === 'kp-to-imdb' ? 'block' : 'none';
            });
        });

        // Queue filter bar buttons
        const filterBtns = document.querySelectorAll('#tmdbQueueFilterBar .queue-filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeQueueFilter = btn.dataset.filter || 'all';
                this.applyQueueFiltersAndRender();
            });
        });

        // Refresh button
        const refreshBtn = document.getElementById('refreshTmdbFallbacksBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadTmdbFallbacks());
        }

        // Clear unmapped queue button
        const clearQueueBtn = document.getElementById('clearUnmappedQueueBtn');
        if (clearQueueBtn) {
            clearQueueBtn.addEventListener('click', async () => {
                if (!confirm('Очистить локальную очередь несмаппленных тайтлов TMDB?')) return;
                if (this.idMappingService) {
                    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                        await new Promise(res => chrome.storage.local.remove([this.idMappingService.UNMAPPED_QUEUE_KEY], res));
                    }
                    await this.loadTmdbFallbacks();
                    this.showSuccessMessage('Очередь TMDB очищена');
                }
            });
        }

        // Auto-map entire queue button (Level 1 TMDB + Level 2 IMDb + Level 3 Metadata Search)
        const autoMapQueueBtn = document.getElementById('autoMapQueueBtn');
        if (autoMapQueueBtn) {
            autoMapQueueBtn.addEventListener('click', async () => {
                const unmappedItems = this.unmappedQueueData || [];
                if (unmappedItems.length === 0) {
                    this.showSuccessMessage('Очередь пуста — нет тайтлов для сопоставления.');
                    return;
                }

                if (!confirm(`Запустить авто-поиск и привязку для ${unmappedItems.length} тайтлов в очереди?`)) return;

                try {
                    autoMapQueueBtn.disabled = true;
                    autoMapQueueBtn.innerHTML = `
                        <svg class="spin-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
                        Сопоставление...
                    `;

                    if (!this.idMappingService) this.idMappingService = new IdMappingService();
                    const kinopoiskService = this.kinopoiskService || (typeof window !== 'undefined' && window.firebaseManager?.getKinopoiskService?.()) || new KinopoiskService();

                    // Force batch resolution with cascade
                    const resultMap = await this.idMappingService.resolveBatch(unmappedItems, {
                        forceRefresh: true,
                        kinopoiskService,
                        skipQueue: true
                    });

                    let resolvedCount = 0;
                    let notFoundCount = 0;

                    for (const [key, res] of resultMap.entries()) {
                        if (res.status === 'resolved' && res.kinopoiskId) {
                            resolvedCount++;
                            await this.idMappingService.removeUnmappedQueueItem(key);
                        } else if (res.status === 'not-found') {
                            notFoundCount++;
                            // Snooze confirmed missing items on KP for 14 days so they don't clutter the queue
                            await this.idMappingService.snoozeUnmappedQueueItem(key, 14, 'no-kp-page');
                        }
                    }

                    this.showSuccessMessage(`Авто-сопоставление завершено! Найдено и привязано: ${resolvedCount}, отложено (нет на КП): ${notFoundCount}`);
                    await this.loadTmdbFallbacks();
                } catch (err) {
                    console.error('Error during auto-mapping queue:', err);
                    this.showError(`Ошибка авто-сопоставления: ${err.message}`);
                } finally {
                    autoMapQueueBtn.disabled = false;
                    autoMapQueueBtn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                        Автоматически сопоставить очередь
                    `;
                }
            });
        }

        // Auto-map Kinopoisk -> IMDb fallback queue button via TMDB search
        const autoMapKpToImdbBtn = document.getElementById('autoMapKpToImdbBtn');
        if (autoMapKpToImdbBtn) {
            autoMapKpToImdbBtn.addEventListener('click', async () => {
                const pendingItems = this.pendingImdbItems || [];
                if (pendingItems.length === 0) {
                    this.showSuccessMessage('Очередь пуста — нет фильмов Кинопоиска без IMDb ID.');
                    return;
                }

                if (!confirm(`Запустить авто-поиск IMDb ID через TMDB для ${pendingItems.length} фильмов?`)) return;

                try {
                    autoMapKpToImdbBtn.disabled = true;
                    autoMapKpToImdbBtn.innerHTML = `
                        <svg class="spin-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
                        Поиск IMDb...
                    `;

                    let tmdbService = null;
                    if (typeof window !== 'undefined' && window.firebaseManager?.getTMDBService) {
                        tmdbService = window.firebaseManager.getTMDBService();
                    } else if (typeof TMDBService !== 'undefined') {
                        tmdbService = new TMDBService();
                    }

                    if (!tmdbService) {
                        throw new Error('TMDBService недоступен');
                    }

                    let foundCount = 0;
                    for (const item of pendingItems) {
                        const title = item.name || item.alternativeName;
                        if (!title) continue;

                        try {
                            const tmdbData = await tmdbService.searchByTitleYear(title, item.year);
                            if (tmdbData?.id) {
                                const ext = await tmdbService.getExternalIds(tmdbData.id, tmdbData.mediaType || 'movie');
                                const imdbId = ext?.imdb_id;
                                if (imdbId && TmdbFallbackQueueService.isValidImdbId(imdbId)) {
                                    await this.tmdbFallbackService.saveManualMapping(item, imdbId, this.currentUser?.uid || 'admin');
                                    foundCount++;
                                }
                            }
                        } catch (err) {
                            console.warn(`[AutoMap IMDb] Failed to find IMDb for [${item.kinopoiskId}] ${title}:`, err.message);
                        }
                    }

                    this.showSuccessMessage(`Авто-поиск IMDb завершен! Найдено и сохранено: ${foundCount} из ${pendingItems.length}`);
                    await this.loadTmdbFallbacks();
                } catch (err) {
                    console.error('Error during auto-mapping IMDb queue:', err);
                    this.showError(`Ошибка авто-поиска IMDb: ${err.message}`);
                } finally {
                    autoMapKpToImdbBtn.disabled = false;
                    autoMapKpToImdbBtn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                        Авто-поиск IMDb через TMDB
                    `;
                }
            });
        }

        // Export JSON button
        const exportBtn = document.getElementById('exportManualMappingsBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', async () => {
                try {
                    if (!this.idMappingService) this.idMappingService = new IdMappingService();
                    const jsonStr = await this.idMappingService.exportManualMappingsJson();
                    const blob = new Blob([jsonStr], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `tmdb-kp-mappings-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    this.showSuccessMessage('Файл экспорта успешно скачан');
                } catch (err) {
                    console.error('Export error:', err);
                    this.showError(`Ошибка экспорта: ${err.message}`);
                }
            });
        }

        // Import JSON button and file picker
        const importBtn = document.getElementById('importManualMappingsBtn');
        const importFile = document.getElementById('importManualMappingsFile');
        if (importBtn && importFile) {
            importBtn.addEventListener('click', () => importFile.click());
            importFile.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                    if (!this.idMappingService) this.idMappingService = new IdMappingService();
                    const text = await file.text();
                    const res = await this.idMappingService.importManualMappingsJson(text);
                    if (res.errors && res.errors.length > 0) {
                        this.showSuccessMessage(`Импортировано: ${res.imported}. Ошибок: ${res.errors.length}`);
                        console.warn('Import warnings/errors:', res.errors);
                    } else {
                        this.showSuccessMessage(`Успешно импортировано привязок: ${res.imported}`);
                    }
                    importFile.value = '';
                    await this.loadTmdbFallbacks();
                } catch (err) {
                    console.error('Import error:', err);
                    this.showError(`Ошибка импорта: ${err.message}`);
                    importFile.value = '';
                }
            });
        }

        // Quick manual mapping form submit
        const quickForm = document.getElementById('quickManualMappingForm');
        if (quickForm) {
            quickForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const mediaType = document.getElementById('manualMapMediaType')?.value || 'tv';
                const tmdbInput = document.getElementById('manualMapTmdbId')?.value || '';
                const kpInput = document.getElementById('manualMapKpId')?.value || '';
                const titleInput = document.getElementById('manualMapTitle')?.value || '';

                const tmdbId = this.extractNumericId(tmdbInput);
                const kpId = this.extractNumericId(kpInput);

                if (!tmdbId) {
                    this.showError('Пожалуйста, укажите корректный числовой TMDB ID или ссылку');
                    return;
                }
                if (!kpId) {
                    this.showError('Пожалуйста, укажите корректный числовой Kinopoisk ID или ссылку');
                    return;
                }

                try {
                    if (!this.idMappingService) {
                        this.idMappingService = new IdMappingService();
                    }
                    await this.idMappingService.setManualMapping(mediaType, tmdbId, kpId, {
                        title: titleInput.trim(),
                        kpType: mediaType === 'tv' ? 'tv-series' : 'movie'
                    });

                    this.showSuccessMessage(`Привязка успешно сохранена: TMDB [${mediaType}:${tmdbId}] → Кинопоиск [${kpId}]`);
                    quickForm.reset();
                    await this.loadTmdbFallbacks();
                } catch (err) {
                    console.error('Error saving manual mapping:', err);
                    this.showError(`Ошибка сохранения привязки: ${err.message}`);
                }
            });
        }

        // Initial load
        this.loadTmdbFallbacks();
    }

    extractNumericId(input) {
        if (!input) return null;
        const str = String(input).trim();
        if (/^\d+$/.test(str)) return Number(str);
        const match = str.match(/(?:film|movie|series|tv|id)\/(\d+)/i) || str.match(/(\d{3,10})/);
        if (match && match[1]) return Number(match[1]);
        return null;
    }

    async loadTmdbFallbacks() {
        const unmappedList = document.getElementById('tmdbUnmappedList');
        const manualList = document.getElementById('tmdbManualMappingsList');
        const imdbList = document.getElementById('tmdbFallbacksList');

        if (unmappedList) unmappedList.innerHTML = '<div class="reports-loading">Загрузка очереди TMDB...</div>';
        if (manualList) manualList.innerHTML = '<div class="reports-loading">Загрузка списка привязок...</div>';
        if (imdbList) imdbList.innerHTML = '<div class="reports-loading">Загрузка очереди...</div>';

        try {
            if (!this.idMappingService) this.idMappingService = new IdMappingService();
            if (!this.tmdbFallbackService && typeof TmdbFallbackQueueService !== 'undefined') {
                this.tmdbFallbackService = new TmdbFallbackQueueService(firebaseManager);
            }

            const [unmappedQueue, manualMappings, pendingImdb] = await Promise.all([
                this.idMappingService ? this.idMappingService.getUnmappedQueue() : Promise.resolve([]),
                this.idMappingService ? this.idMappingService.getManualMappings() : Promise.resolve([]),
                this.tmdbFallbackService ? this.tmdbFallbackService.getPendingItems().catch(err => {
                    console.warn('[Admin] Could not load IMDb queue:', err);
                    return [];
                }) : Promise.resolve([])
            ]);

            this.unmappedQueueData = unmappedQueue || [];

            // Update filter counters
            const now = Date.now();
            const counts = {
                all: 0,
                critical: 0,
                films: 0,
                series: 0,
                cartoons: 0,
                anime: 0,
                snoozed: 0
            };

            this.unmappedQueueData.forEach(item => {
                const isSnoozed = item.snoozedUntil && now < item.snoozedUntil && (item.manualStatus === 'no-kp-page' || item.manualStatus === 'ignored');
                if (isSnoozed) {
                    counts.snoozed++;
                } else {
                    counts.all++;
                    if (item.priority === 'CRITICAL') counts.critical++;
                    const sec = item.section || (item.mediaType === 'tv' ? 'series' : 'films');
                    if (sec === 'films') counts.films++;
                    else if (sec === 'series') counts.series++;
                    else if (sec === 'cartoons') counts.cartoons++;
                    else if (sec === 'anime') counts.anime++;
                }
            });

            const elAll = document.getElementById('filterCountAll');
            const elCrit = document.getElementById('filterCountCritical');
            const elFilms = document.getElementById('filterCountFilms');
            const elSeries = document.getElementById('filterCountSeries');
            const elCartoons = document.getElementById('filterCountCartoons');
            const elAnime = document.getElementById('filterCountAnime');
            const elSnoozed = document.getElementById('filterCountSnoozed');

            if (elAll) elAll.textContent = counts.all;
            if (elCrit) elCrit.textContent = counts.critical;
            if (elFilms) elFilms.textContent = counts.films;
            if (elSeries) elSeries.textContent = counts.series;
            if (elCartoons) elCartoons.textContent = counts.cartoons;
            if (elAnime) elAnime.textContent = counts.anime;
            if (elSnoozed) elSnoozed.textContent = counts.snoozed;

            // Update badge counts
            const unmappedBadge = document.getElementById('unmappedTmdbCountBadge');
            const imdbBadge = document.getElementById('kpMissingImdbCountBadge');
            const totalCountBadge = document.getElementById('tmdbFallbacksCount');
            const navTmdbCountBadge = document.getElementById('adminNavTmdbCount');

            const totalTasks = counts.all + (pendingImdb?.length || 0);
            if (unmappedBadge) unmappedBadge.textContent = counts.all;
            if (imdbBadge) imdbBadge.textContent = pendingImdb?.length || 0;
            if (totalCountBadge) totalCountBadge.textContent = `${totalTasks} задач`;
            if (navTmdbCountBadge) navTmdbCountBadge.textContent = totalTasks > 0 ? totalTasks : '—';

            this.applyQueueFiltersAndRender();
            this.renderManualMappingsList(manualMappings || []);
            this.renderImdbFallbacksList(pendingImdb || []);
        } catch (error) {
            console.error('Error loading TMDB fallbacks:', error);
            if (unmappedList) unmappedList.innerHTML = `<div class="reports-empty" style="color: var(--status-error);">Ошибка: ${this.escapeHtml(error.message)}</div>`;
            if (manualList) manualList.innerHTML = `<div class="reports-empty" style="color: var(--status-error);">Ошибка: ${this.escapeHtml(error.message)}</div>`;
            if (imdbList) imdbList.innerHTML = `<div class="reports-empty" style="color: var(--status-error);">Ошибка: ${this.escapeHtml(error.message)}</div>`;
        }
    }

    applyQueueFiltersAndRender() {
        const now = Date.now();
        const filter = this.activeQueueFilter || 'all';

        let filtered = this.unmappedQueueData.filter(item => {
            const isSnoozed = item.snoozedUntil && now < item.snoozedUntil && (item.manualStatus === 'no-kp-page' || item.manualStatus === 'ignored');
            if (filter === 'snoozed') {
                return isSnoozed;
            }
            if (isSnoozed) return false;

            if (filter === 'critical') return item.priority === 'CRITICAL';
            const sec = item.section || (item.mediaType === 'tv' ? 'series' : 'films');
            if (filter === 'films') return sec === 'films';
            if (filter === 'series') return sec === 'series';
            if (filter === 'cartoons') return sec === 'cartoons';
            if (filter === 'anime') return sec === 'anime';
            return true; // 'all'
        });

        // Priority sort
        const priorityWeight = { 'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
        filtered.sort((a, b) => {
            const weightA = priorityWeight[a.priority] || 1;
            const weightB = priorityWeight[b.priority] || 1;
            if (weightA !== weightB) return weightB - weightA;

            const seenA = a.timesSeen || 1;
            const seenB = b.timesSeen || 1;
            if (seenA !== seenB) return seenB - seenA;

            const rankA = (Number.isInteger(a.productRank) && a.productRank > 0)
                ? a.productRank
                : ((Number.isInteger(a.tmdbRank) && a.tmdbRank > 0) ? a.tmdbRank : 999);
            const rankB = (Number.isInteger(b.productRank) && b.productRank > 0)
                ? b.productRank
                : ((Number.isInteger(b.tmdbRank) && b.tmdbRank > 0) ? b.tmdbRank : 999);
            if (rankA !== rankB) return rankA - rankB;

            return (b.updatedAt || 0) - (a.updatedAt || 0);
        });

        this.renderTmdbUnmappedList(filtered);
    }

    renderTmdbUnmappedList(unmappedItems) {
        const container = document.getElementById('tmdbUnmappedList');
        if (!container) return;
        container.innerHTML = '';

        if (!unmappedItems || unmappedItems.length === 0) {
            const filterLabel = this.activeQueueFilter === 'snoozed' ? 'отложенных' : 'несмаппленных';
            container.innerHTML = `
                <div class="tmdb-empty-state">
                    <div class="tmdb-empty-icon">✨</div>
                    <div class="tmdb-empty-title">В этой категории нет тайтлов</div>
                    <div class="tmdb-empty-desc">Очередь ${filterLabel} элементов пуста. Все элементы либо привязаны, либо находятся в других секциях.</div>
                </div>
            `;
            return;
        }

        const currentYear = new Date().getFullYear();

        unmappedItems.forEach(item => {
            const card = document.createElement('div');
            card.className = 'tmdb-fallback-item';
            card.dataset.key = item.key;

            const posterImg = item.posterUrl
                ? `<img src="${item.posterUrl}" class="movie-poster" alt="Poster" loading="lazy">`
                : `<div class="movie-poster" style="display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--text-tertiary, #64748b);">НЕТ</div>`;

            // Priority badge
            let priorityBadge;
            if (item.priority === 'CRITICAL') {
                priorityBadge = `<span class="tmdb-priority-badge tmdb-priority-critical">🔥 Critical</span>`;
            } else if (item.priority === 'HIGH') {
                priorityBadge = `<span class="tmdb-priority-badge tmdb-priority-high">⚡ High</span>`;
            } else if (item.priority === 'MEDIUM') {
                priorityBadge = `<span class="tmdb-priority-badge tmdb-priority-medium">Medium</span>`;
            } else {
                priorityBadge = `<span class="tmdb-priority-badge tmdb-priority-low">Low</span>`;
            }

            // Section tag
            const sectionNames = { 'films': 'Фильмы', 'series': 'Сериалы', 'cartoons': 'Мультфильмы', 'anime': 'Аниме' };
            const secKey = item.section || (item.mediaType === 'tv' ? 'series' : 'films');
            const secTag = `<span class="tmdb-tag-pill tmdb-tag-${secKey}">${sectionNames[secKey] || secKey}</span>`;

            // Rank tags (Product Rank + TMDB Source Rank)
            let rankTag = '';
            if (Number.isInteger(item.productRank) && item.productRank > 0) {
                const isTop12 = item.productRank <= 12;
                rankTag += `<span class="tmdb-tag-pill tmdb-tag-product-rank" style="font-weight: 600; ${isTop12 ? 'background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);' : ''}" title="Позиция в продуктовой витрине ${sectionNames[secKey] || secKey}">Product #${item.productRank}</span> `;
            }
            if (Number.isInteger(item.tmdbRank) && item.tmdbRank > 0) {
                rankTag += `<span class="tmdb-tag-pill tmdb-tag-section" title="Позиция в ответе TMDB API">TMDB #${item.tmdbRank}</span>`;
            }

            // Display tags: Hot, Frequent, Fresh
            let displayTags = '';
            if ((Number(item.popularity) > 50) || (Number(item.voteCount) > 100)) {
                displayTags += `<span class="tmdb-tag-pill tmdb-tag-hot">🔥 Hot</span> `;
            }
            if (item.timesSeen && item.timesSeen >= 2) {
                displayTags += `<span class="tmdb-tag-pill tmdb-tag-frequent">🔁 ${item.timesSeen} раз</span> `;
            }
            if (item.year && item.year >= currentYear) {
                displayTags += `<span class="tmdb-tag-pill tmdb-tag-fresh">🆕 ${item.year}</span> `;
            }

            // Impact banner for CRITICAL
            const impactBanner = (item.priority === 'CRITICAL')
                ? `<div class="tmdb-impact-banner">⚡ Влияет на Home Top-12 (${sectionNames[secKey] || secKey}${item.productRank ? ` #${item.productRank}` : (item.tmdbRank ? ` #${item.tmdbRank}` : '')})</div>`
                : '';

            // Action URLs
            const tmdbUrl = `https://www.themoviedb.org/${item.mediaType === 'tv' ? 'tv' : 'movie'}/${item.tmdbId}`;
            const kpSearchQuery = encodeURIComponent(item.title || item.originalTitle || '');
            const kpSearchUrl = `https://www.kinopoisk.ru/index.php?kp_query=${kpSearchQuery}`;

            const previewId = `kpPreview_${item.key.replace(/[^a-zA-Z0-9]/g, '_')}`;

            card.innerHTML = `
                <div style="display: flex; flex-direction: column; width: 100%; gap: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;">
                        <div class="tmdb-fallback-movie" style="flex: 1; min-width: 0;">
                            ${posterImg}
                            <div style="min-width: 0; flex: 1;">
                                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px;">
                                    ${priorityBadge}
                                    ${secTag}
                                    ${rankTag}
                                    ${displayTags}
                                </div>
                                <div style="font-weight: 600; color: var(--theme-text-primary, #f8fafc); font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.escapeHtml(item.title || '')}">
                                    ${this.escapeHtml(item.title || item.originalTitle || `TMDB #${item.tmdbId}`)}
                                </div>
                                ${item.originalTitle && item.originalTitle !== item.title ? `
                                    <div style="font-size: 12px; color: var(--theme-text-secondary, #94a3b8); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                        ${this.escapeHtml(item.originalTitle)}
                                    </div>
                                ` : ''}
                                <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--theme-text-secondary, #94a3b8); margin-top: 6px; flex-wrap: wrap;">
                                    ${item.year ? `<span style="font-weight: 500;">${item.year}</span> <span>•</span>` : ''}
                                    <span>TMDB ID: <code style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; color: #cbd5e1;">${item.mediaType}:${item.tmdbId}</code></span>
                                    <span>•</span>
                                    <a href="${tmdbUrl}" target="_blank" class="tmdb-link-btn" title="Открыть карточку на TMDB">🔗 TMDB ↗</a>
                                    <a href="${kpSearchUrl}" target="_blank" class="tmdb-link-btn" title="Искать тайтл на Кинопоиске">🔍 Поиск КП ↗</a>
                                </div>
                                ${impactBanner ? `<div style="margin-top: 6px;">${impactBanner}</div>` : ''}
                            </div>
                        </div>

                        <!-- Manual Binding Action Controls -->
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="text" class="admin-input tmdb-unmapped-kp-input" placeholder="KP ID или ссылка" style="width: 160px; height: 38px;" data-key="${item.key}">
                                <button class="btn-verify-kp btn-verify-action" type="button" data-key="${item.key}" data-media-type="${item.mediaType}" data-tmdb-id="${item.tmdbId}" data-year="${item.year || ''}">
                                    Проверить
                                </button>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <button class="btn-snooze-kp btn-snooze-action" type="button" title="Отложить тайтл на 7 дней (страница на КП ещё не создана)" data-key="${item.key}" data-title="${this.escapeHtml(item.title || '')}">
                                    Нет страницы на КП
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Kinopoisk Verification Preview Box -->
                    <div id="${previewId}" class="tmdb-preview-container" style="display: none;"></div>
                </div>
            `;

            container.appendChild(card);
        });

        // Event listeners for "Проверить" (Kinopoisk ID inspection)
        container.querySelectorAll('.btn-verify-action').forEach(btn => {
            const card = btn.closest('.tmdb-fallback-item');
            const input = card?.querySelector('.tmdb-unmapped-kp-input');
            if (input) {
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        btn.click();
                    }
                });
            }

            btn.addEventListener('click', async () => {
                const key = btn.dataset.key;
                const mediaType = btn.dataset.mediaType;
                const tmdbId = btn.dataset.tmdbId;
                const tmdbYear = btn.dataset.year ? parseInt(btn.dataset.year, 10) : null;

                const curCard = container.querySelector(`.tmdb-fallback-item[data-key="${key}"]`);
                if (!curCard) return;

                const curInput = curCard.querySelector('.tmdb-unmapped-kp-input');
                const kpId = this.extractNumericId(curInput?.value);
                const previewBox = curCard.querySelector('.tmdb-preview-container');

                if (!kpId) {
                    this.showError('Пожалуйста, введите корректный числовой Kinopoisk ID или ссылку');
                    return;
                }

                btn.disabled = true;
                btn.textContent = 'Проверка...';
                if (previewBox) {
                    previewBox.style.display = 'block';
                    previewBox.innerHTML = '<div style="font-size: 12px; color: var(--theme-text-secondary); padding: 8px 12px;">Запрос данных с Кинопоиска...</div>';
                }

                try {
                    if (!this.kinopoiskService) this.kinopoiskService = new KinopoiskService();
                    const kpMovie = await this.kinopoiskService.getMovieById(kpId);

                    const resolvedKpId = Number(kpMovie?.kinopoiskId || kpMovie?.id);
                    if (!kpMovie || !Number.isInteger(resolvedKpId) || resolvedKpId <= 0) {
                        throw new Error('Фильм/сериал с таким ID не найден на Кинопоиске');
                    }

                    const kpType = kpMovie.type || (mediaType === 'tv' ? 'tv-series' : 'movie');
                    const kpYear = Number(kpMovie.year) || null;

                    // Check type compatibility
                    const isCompatible = this.idMappingService.isCompatibleType(mediaType, kpType, kpMovie);
                    const yearDiff = (tmdbYear && kpYear) ? Math.abs(tmdbYear - kpYear) : 0;

                    let compatHtml = isCompatible
                        ? `<span class="tmdb-compat-ok">🟢 Тип совместим (${mediaType} ↔ ${kpType || 'фильм'})</span>`
                        : `<span class="tmdb-compat-warn">⚠️ Внимание: Несоответствие типов (TMDB: ${mediaType}, КП: ${kpType || 'сериал'})</span>`;

                    let yearWarnHtml = (yearDiff > 3)
                        ? `<div class="tmdb-year-warn">⚠️ Разница годов выпуска: TMDB (${tmdbYear}) vs КП (${kpYear})</div>`
                        : '';

                    const kpPoster = kpMovie.posterUrl || (typeof kpMovie.poster === 'string' ? kpMovie.poster : kpMovie.poster?.url) || '';
                    const kpPosterHtml = kpPoster
                        ? `<img src="${kpPoster}" class="tmdb-preview-poster" alt="KP Poster">`
                        : `<div class="tmdb-preview-poster" style="display:flex;align-items:center;justify-content:center;font-size:9px;color:#64748b;">НЕТ</div>`;

                    const genresStr = Array.isArray(kpMovie.genres)
                        ? kpMovie.genres.map(g => (typeof g === 'string' ? g : g?.name)).filter(Boolean).slice(0, 3).join(', ')
                        : '';

                    if (previewBox) {
                        previewBox.innerHTML = `
                            <div class="tmdb-preview-card">
                                <div style="display: flex; gap: 12px; align-items: center; width: 100%;">
                                    ${kpPosterHtml}
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-size: 14px; font-weight: 600; color: #f8fafc;">
                                            ${this.escapeHtml(kpMovie.name || kpMovie.alternativeName || `КП #${resolvedKpId}`)}
                                            ${kpYear ? `<span style="color: #94a3b8; font-weight: normal;">(${kpYear})</span>` : ''}
                                        </div>
                                        ${kpMovie.alternativeName && kpMovie.alternativeName !== kpMovie.name ? `
                                            <div style="font-size: 11px; color: #94a3b8; margin-top: 1px;">${this.escapeHtml(kpMovie.alternativeName)}</div>
                                        ` : ''}
                                        <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 11px; flex-wrap: wrap;">
                                            ${compatHtml}
                                            ${genresStr ? `<span style="color: #cbd5e1;">• ${this.escapeHtml(genresStr)}</span>` : ''}
                                            <a href="https://www.kinopoisk.ru/film/${resolvedKpId}/" target="_blank" style="color: #818cf8; text-decoration: none; font-weight: 500;">Открыть на КП ↗</a>
                                        </div>
                                        ${yearWarnHtml}
                                    </div>
                                </div>
                                <div class="tmdb-confirm-center-wrap">
                                    <button class="btn-confirm-map btn-confirm-action" type="button" 
                                            data-key="${key}" 
                                            data-media-type="${mediaType}" 
                                            data-tmdb-id="${tmdbId}" 
                                            data-kp-id="${resolvedKpId}" 
                                            data-kp-type="${kpType}" 
                                            data-title="${this.escapeHtml(kpMovie.name || kpMovie.alternativeName || '')}" 
                                            data-year="${kpYear ? String(kpYear) : ''}">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        Подтвердить привязку
                                    </button>
                                </div>
                            </div>
                        `;

                        const imgEl = previewBox.querySelector('.tmdb-preview-poster');
                        if (imgEl && imgEl.tagName === 'IMG') {
                            imgEl.addEventListener('error', () => {
                                imgEl.style.display = 'none';
                            });
                        }

                        // Attach event listener to centered confirm button
                        const confirmBtn = previewBox.querySelector('.btn-confirm-action');
                        if (confirmBtn) {
                            confirmBtn.addEventListener('click', async () => {
                                const cMediaType = confirmBtn.dataset.mediaType;
                                const cTmdbId = confirmBtn.dataset.tmdbId;
                                const cKpId = confirmBtn.dataset.kpId;
                                const cTitle = confirmBtn.dataset.title;
                                const cYear = confirmBtn.dataset.year ? parseInt(confirmBtn.dataset.year, 10) : null;
                                const cKpType = confirmBtn.dataset.kpType;

                                if (!cKpId) {
                                    this.showError('Сначала нажмите "Проверить" для верификации тайтла на Кинопоиске');
                                    return;
                                }

                                try {
                                    confirmBtn.disabled = true;
                                    confirmBtn.textContent = 'Сохранение...';
                                    await this.idMappingService.setManualMapping(cMediaType, cTmdbId, cKpId, {
                                        title: cTitle,
                                        year: cYear,
                                        kpType: cKpType
                                    });

                                    this.showSuccessMessage(`Привязка сохранена: "${cTitle || cTmdbId}" → КП: ${cKpId}`);
                                    await this.loadTmdbFallbacks();
                                } catch (err) {
                                    console.error('Error confirming manual mapping:', err);
                                    this.showError(`Ошибка: ${err.message}`);
                                    confirmBtn.disabled = false;
                                    confirmBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><polyline points="20 6 9 17 4 12"></polyline></svg> Подтвердить привязку`;
                                }
                            });
                        }
                    }

                    btn.textContent = 'Проверено ✓';
                    btn.disabled = false;
                } catch (err) {
                    console.error('Error verifying KP ID:', err);
                    if (previewBox) {
                        previewBox.innerHTML = `<div style="font-size: 12px; color: var(--status-error); padding: 8px 12px;">Ошибка проверки: ${this.escapeHtml(err.message)}</div>`;
                    }
                    btn.textContent = 'Проверить';
                    btn.disabled = false;
                }
            });
        });

        // Event listeners for "Нет страницы на КП" (Snooze candidate for 7 days)
        container.querySelectorAll('.btn-snooze-action').forEach(btn => {
            btn.addEventListener('click', async () => {
                const key = btn.dataset.key;
                const title = btn.dataset.title || key;

                try {
                    btn.disabled = true;
                    await this.idMappingService.snoozeUnmappedQueueItem(key, 7, 'no-kp-page');
                    this.showSuccessMessage(`Тайтл "${title}" отложен на 7 дней (страница на КП ещё отсутствует)`);
                    await this.loadTmdbFallbacks();
                } catch (err) {
                    console.error('Error snoozing unmapped item:', err);
                    this.showError(`Ошибка: ${err.message}`);
                    btn.disabled = false;
                }
            });
        });
    }

    renderManualMappingsList(manualMappings) {
        const container = document.getElementById('tmdbManualMappingsList');
        if (!container) return;
        container.innerHTML = '';

        if (!manualMappings || manualMappings.length === 0) {
            container.innerHTML = `
                <div class="tmdb-empty-state">
                    <div class="tmdb-empty-icon">📋</div>
                    <div class="tmdb-empty-title">Нет пользовательских привязок</div>
                    <div class="tmdb-empty-desc">Здесь будут отображаться созданные вручную связки TMDB → Кинопоиск.</div>
                </div>
            `;
            return;
        }

        const table = document.createElement('table');
        table.className = 'tmdb-mappings-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th style="text-align: left;">Тайтл / Название</th>
                    <th style="text-align: center;">Тип</th>
                    <th style="text-align: center;">TMDB ID</th>
                    <th style="text-align: center;">Kinopoisk ID</th>
                    <th style="text-align: center;">Дата привязки</th>
                    <th style="text-align: right;">Действие</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        const tbody = table.querySelector('tbody');

        manualMappings.forEach(item => {
            const tr = document.createElement('tr');
            const dateStr = item.resolvedAt ? new Date(item.resolvedAt).toLocaleDateString() : '—';
            const tagClass = item.mediaType === 'movie' ? 'tmdb-tag-movie' : 'tmdb-tag-tv';

            tr.innerHTML = `
                <td style="font-weight: 500; color: var(--theme-text-primary, #f8fafc);">
                    ${this.escapeHtml(item.title || `TMDB #${item.tmdbId}`)}
                    ${item.year ? `<span style="color: var(--theme-text-secondary, #94a3b8); font-size: 12px; margin-left: 4px;">(${item.year})</span>` : ''}
                </td>
                <td style="text-align: center;"><span class="tmdb-tag-pill ${tagClass}">${item.mediaType}</span></td>
                <td style="text-align: center;"><code style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; color: #cbd5e1;">${item.tmdbId}</code></td>
                <td style="text-align: center;"><a href="https://www.kinopoisk.ru/film/${item.kpId}/" target="_blank" style="color: #818cf8; font-weight: 600; text-decoration: none;">${item.kpId} ↗</a></td>
                <td style="text-align: center; color: var(--theme-text-secondary, #94a3b8); font-size: 12px;">${dateStr}</td>
                <td style="text-align: right;">
                    <button class="btn-delete-mapping btn-delete-manual-mapping" data-media-type="${item.mediaType}" data-tmdb-id="${item.tmdbId}" type="button">
                        Отвязать
                    </button>
                </td>
            `;

            tbody.appendChild(tr);
        });

        container.appendChild(table);

        // Delete mapping listener
        container.querySelectorAll('.btn-delete-manual-mapping').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Удалить эту ручную привязку?')) return;
                const mediaType = btn.dataset.mediaType;
                const tmdbId = btn.dataset.tmdbId;
                try {
                    await this.idMappingService.removeManualMapping(mediaType, tmdbId);
                    this.showSuccessMessage('Привязка удалена');
                    await this.loadTmdbFallbacks();
                } catch (err) {
                    console.error('Error deleting mapping:', err);
                    this.showError(`Ошибка: ${err.message}`);
                }
            });
        });
    }

    renderImdbFallbacksList(pendingItems) {
        const container = document.getElementById('tmdbFallbacksList');
        if (!container) return;
        container.innerHTML = '';

        if (!pendingItems || pendingItems.length === 0) {
            container.innerHTML = `
                <div class="tmdb-empty-state">
                    <div class="tmdb-empty-icon">🎬</div>
                    <div class="tmdb-empty-title">Все фильмы имеют IMDb ID</div>
                    <div class="tmdb-empty-desc">В данный момент нет фильмов Кинопоиска, требующих ручного ввода IMDb ID.</div>
                </div>
            `;
            return;
        }

        pendingItems.forEach(item => {
            const card = document.createElement('div');
            card.className = 'tmdb-fallback-item';

            const posterImg = item.posterUrl
                ? `<img src="${item.posterUrl}" class="movie-poster" alt="Poster">`
                : `<div class="movie-poster" style="display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--text-tertiary, #64748b);">НЕТ</div>`;

            card.innerHTML = `
                <div class="tmdb-fallback-movie">
                    ${posterImg}
                    <div style="min-width: 0; flex: 1;">
                        <div style="font-weight: 600; color: var(--theme-text-primary, #f8fafc); font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${this.escapeHtml(item.name || item.alternativeName || 'Фильм Кинопоиска')}
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--theme-text-secondary, #94a3b8); margin-top: 4px;">
                            ${item.year ? `<span style="font-weight: 500;">${item.year}</span> <span>•</span>` : ''}
                            <span>Kinopoisk ID: <code style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; color: #cbd5e1;">${item.kinopoiskId}</code></span>
                        </div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="text" class="admin-input tmdb-imdb-input" placeholder="tt1234567" style="width: 150px; height: 38px;" data-kp-id="${item.kinopoiskId}">
                    <button class="tmdb-btn-bind btn-save-imdb-mapping" type="button" style="height: 38px; padding: 0 16px;" data-kp-id="${item.kinopoiskId}">
                        Сохранить
                    </button>
                </div>
            `;

            container.appendChild(card);
        });

        // Add event listeners for IMDb save buttons
        container.querySelectorAll('.btn-save-imdb-mapping').forEach(btn => {
            btn.addEventListener('click', async () => {
                const kpId = btn.dataset.kpId;
                const input = container.querySelector(`.tmdb-imdb-input[data-kp-id="${kpId}"]`);
                const imdbId = input?.value?.trim();

                if (!imdbId || !TmdbFallbackQueueService.isValidImdbId(imdbId)) {
                    this.showError('Пожалуйста, укажите валидный IMDb ID в формате tt1234567');
                    return;
                }

                try {
                    btn.disabled = true;
                    btn.textContent = 'Сохранение...';
                    const item = pendingItems.find(p => String(p.kinopoiskId) === String(kpId));
                    await this.tmdbFallbackService.saveManualMapping(item, imdbId, this.currentUser?.uid || 'admin');

                    this.showSuccessMessage(`IMDb ID ${imdbId} успешно сохранён для фильма [KP: ${kpId}]`);
                    await this.loadTmdbFallbacks();
                } catch (err) {
                    console.error('Error saving IMDb mapping:', err);
                    this.showError(`Ошибка: ${err.message}`);
                    btn.disabled = false;
                    btn.textContent = 'Сохранить';
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
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.adminPanel = new AdminPanelManager();
});
