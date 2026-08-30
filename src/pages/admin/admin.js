/**
 * Admin Panel Manager
 * Handles admin interface for user management
 */
class AdminPanelManager {
    constructor() {
        this.adminService = null;
        this.cacheService = null;
        this.currentUser = null;
        this.isAdmin = false;
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
        this.firestoreUsage = null;
        this.firestoreUsageRequest = null;
        this.providerKeys = [];
        this.providerKeysRequest = null;
        this.providerKeyActionRequest = null;
        this.providerKeyModalTrigger = null;
        this.providerKeyConfirmTrigger = null;
        this.providerKeyPendingRevoke = null;
        this.commentReactionConfig = null;
        this.commentReactionConfigRequest = null;
        this.commentReactionSavePending = false;
        this.commentReactionAssetPreviewUrl = null;
        this.commentReactionAssetFile = null;
        
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
            this.setAdminAccessState(isAdmin);
            
            if (!isAdmin) {
                this.showError('Доступ запрещён. Для просмотра этой страницы требуются права администратора.');
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

            console.time('[Admin Perf] 4. UI & Event Setup');
            // Initialize Reports & TMDB Fallbacks / Manual Mapping before data loads
            this.initReports();
            this.initTmdbFallbacks();

            // Bind controls before network work so the shell never becomes inert
            this.setupEventListeners();
            console.timeEnd('[Admin Perf] 4. UI & Event Setup');

            console.time('[Admin Perf] 5. Load Data Sequentially');
            // Load users, movies and approvals sequentially to avoid WebChannel stream congestion
            this.showLoading();
            await this.loadUsers();
            await this.loadMovies();
            await this.loadApprovals();
            this.hideLoading();
            console.timeEnd('[Admin Perf] 5. Load Data Sequentially');
            console.timeEnd('[Admin Perf] Total Init');
            
            console.log(`[Admin Performance] Init fully complete. Data size - Users: ${this.users.length}, Movies: ${this.movies.length}`);
        } catch (error) {
            console.error('Error initializing admin panel:', error);
            this.showError('Не удалось открыть админ-панель. Повторите попытку.');
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
        this.clearAdminError();
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
            this.renderUsersError();
            this.showError('Не удалось загрузить пользователей. Повторите попытку.');
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
            this.clearAdminError();
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
                this.renderUsersError();
                this.showError('Не удалось загрузить пользователей. Повторите попытку.');
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
            const countLabel = this.formatRussianCount(
                this.displayedUsers.length,
                'пользователь',
                'пользователя',
                'пользователей'
            );
            usersCount.textContent = `${countLabel}${this.userPagination.currentPage > 1 ? ` (стр. ${this.userPagination.currentPage})` : ''}`;
        }

        // Clear existing rows
        tableBody.innerHTML = '';

        if (this.displayedUsers.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: var(--space-xl); color: var(--text-secondary);">
                        Пользователи не найдены
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
            const start = this.displayedUsers.length > 0
                ? (this.userPagination.currentPage - 1) * this.userPagination.itemsPerPage + 1
                : 0;
            const end = this.displayedUsers.length > 0
                ? start + this.displayedUsers.length - 1
                : 0;
            pageInfo.innerHTML = `Показано <span id="user-range-start">${start}</span>-<span id="user-range-end">${end}</span> пользователей`;
        }
        
        if (pageNumbers) {
            pageNumbers.textContent = `Страница ${this.userPagination.currentPage}`;
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
            (user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Неизвестно');

        const status = user.approvalStatus || 'approved';
        let statusBadge;
        if (status === 'approved') {
            statusBadge = '<span class="status-badge status-badge-approved">Одобрен</span>';
        } else if (status === 'pending') {
            statusBadge = '<span class="status-badge status-badge-pending">Ожидает</span>';
        } else if (status === 'rejected') {
            statusBadge = '<span class="status-badge status-badge-rejected">Отклонён</span>';
        } else {
            statusBadge = `<span class="status-badge status-badge-approved">${this.escapeHtml(status)}</span>`;
        }

        let actionsHtml;
        if (isCurrentUser) {
            actionsHtml = `
                <div class="row-actions-group">
                    <button class="btn-delete" 
                            data-user-id="${user.id}"
                            disabled title="Нельзя удалить собственный аккаунт">
                        Удалить
                    </button>
                </div>
            `;
        } else {
            let statusButtons = '';
            if (status === 'approved') {
                statusButtons = `
                    <button class="btn-status-toggle btn-reject-sm" data-action="reject" data-user-id="${user.id}">Заблокировать</button>
                    <button class="btn-status-toggle" data-action="pending" data-user-id="${user.id}">В ожидание</button>
                `;
            } else if (status === 'pending') {
                statusButtons = `
                    <button class="btn-approve-sm" data-action="approve" data-user-id="${user.id}">Одобрить</button>
                    <button class="btn-reject-sm" data-action="reject" data-user-id="${user.id}">Отклонить</button>
                `;
            } else if (status === 'rejected') {
                statusButtons = `
                    <button class="btn-approve-sm" data-action="approve" data-user-id="${user.id}">Разблокировать</button>
                    <button class="btn-status-toggle" data-action="pending" data-user-id="${user.id}">В ожидание</button>
                `;
            }

            actionsHtml = `
                <div class="row-actions-group">
                    ${statusButtons}
                    <button class="btn-delete" data-user-id="${user.id}">
                        Удалить
                    </button>
                </div>
            `;
        }

        row.innerHTML = `
            <td>
                <div class="user-info">
                    <img src="${user.photoURL || IconUtils.getCurrentThemeIconPath(48)}"
                         alt="${user.displayName || 'Пользователь'}"
                         class="user-avatar"
                         loading="lazy">
                    <div>
                        <div class="user-name">
                            ${this.escapeHtml(user.displayName || 'Пользователь без имени')}
                            ${user.isAdmin ? '<span class="admin-badge"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg> Админ</span>' : ''}
                            ${isCurrentUser ? '<span class="you-badge">Вы</span>' : ''}
                        </div>
                    </div>
                </div>
            </td>
            <td>
                <div class="user-email">${this.escapeHtml(user.email || 'Нет email')}</div>
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
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleUserApprovalAction(btn.dataset.userId, btn.dataset.action, btn);
            });
        });

        // Add click handler for delete button
        const deleteBtn = row.querySelector('.btn-delete');
        if (deleteBtn && !isCurrentUser) {
            deleteBtn.addEventListener('click', () => this.showDeleteConfirmation(user));
        }

        const avatar = row.querySelector('.user-avatar');
        if (avatar) {
            avatar.addEventListener('error', () => {
                avatar.src = IconUtils.getCurrentThemeIconPath(48);
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
        this.clearAdminError();
        try {
            const pendingUsers = await this.adminService.getPendingApprovals(100);
            this.pendingUsers = pendingUsers || [];
            this.selectedApprovalIds.clear();

            // Update counts
            const count = this.pendingUsers.length;
            const navBadge = document.getElementById('adminNavApprovalsCount');
            const headerBadge = document.getElementById('approvalsCount');
            if (navBadge) {
                navBadge.textContent = count > 0 ? count : '—';
                navBadge.classList.remove('admin-nav-count-warning');
            }
            if (headerBadge) {
                headerBadge.textContent = this.formatRussianCount(count, 'заявка', 'заявки', 'заявок');
            }

            this.renderApprovalsTable();
            this.updateBatchApproveButton();
        } catch (error) {
            console.error('Error loading approvals:', error);
            this.pendingUsers = [];
            this.selectedApprovalIds.clear();
            const navBadge = document.getElementById('adminNavApprovalsCount');
            const headerBadge = document.getElementById('approvalsCount');
            if (navBadge) {
                navBadge.textContent = '!';
                navBadge.classList.add('admin-nav-count-warning');
            }
            if (headerBadge) headerBadge.textContent = '—';
            this.renderApprovalsError();
            this.showError('Не удалось загрузить заявки. Повторите попытку.');
        }
    }

    async loadFirestoreUsage(force = false) {
        if (!this.adminService) return null;
        if (this.firestoreUsageRequest) return this.firestoreUsageRequest;
        if (this.firestoreUsage && !force) {
            this.renderFirestoreUsage(this.firestoreUsage);
            return this.firestoreUsage;
        }

        this.renderFirestoreUsageLoading(true);
        this.firestoreUsageRequest = this.adminService.getFirestoreUsage()
            .then((usage) => {
                this.firestoreUsage = usage;
                this.renderFirestoreUsage(usage);
                return usage;
            })
            .catch((error) => {
                console.error('Error loading Firestore usage:', error);
                this.renderFirestoreUsageError();
                throw error;
            })
            .finally(() => {
                this.firestoreUsageRequest = null;
                this.renderFirestoreUsageLoading(false);
            });

        return this.firestoreUsageRequest;
    }

    renderFirestoreUsageLoading(isLoading) {
        const cards = document.getElementById('firestoreUsageCards');
        const refreshButton = document.getElementById('refreshFirestoreUsageBtn');
        if (cards) cards.setAttribute('aria-busy', String(isLoading));
        if (refreshButton) {
            refreshButton.disabled = isLoading;
            refreshButton.classList.toggle('loading', isLoading);
        }
    }

    renderFirestoreUsageError() {
        const errorBox = document.getElementById('firestoreUsageError');
        const navStatus = document.getElementById('adminNavUsageStatus');
        if (errorBox) {
            errorBox.hidden = false;
            errorBox.textContent = 'Не удалось получить статистику Firestore. Повторите попытку.';
        }
        if (navStatus) {
            navStatus.textContent = '!';
            navStatus.classList.add('admin-nav-count-warning');
        }
    }

    renderFirestoreUsage(usage) {
        const errorBox = document.getElementById('firestoreUsageError');
        const updated = document.getElementById('firestoreUsageUpdated');
        const navStatus = document.getElementById('adminNavUsageStatus');
        if (errorBox) {
            errorBox.hidden = true;
            errorBox.textContent = '';
        }

        if (updated) {
            const measuredAt = usage?.measuredAt ? new Date(usage.measuredAt) : null;
            updated.textContent = measuredAt && !Number.isNaN(measuredAt.getTime())
                ? `Снято в ${measuredAt.toLocaleTimeString('ru-RU')}`
                : 'Время неизвестно';
        }
        if (navStatus) {
            navStatus.textContent = 'Готово';
            navStatus.classList.remove('admin-nav-count-warning');
        }

        this.renderFirestoreUsageMetric('storage', usage?.storage, {
            valueId: 'firestoreUsageStorageValue',
            limitId: 'firestoreUsageStorageLimit',
            barId: 'firestoreUsageStorageBar',
            statusId: 'firestoreUsageStorageStatus',
            noteId: 'firestoreUsageStorageNote',
            formatValue: (value) => this.formatFirestoreBytes(value),
            formatLimit: (value) => `из ${this.formatFirestoreBytes(value)}`,
            unavailableNote: 'Метрика хранилища недоступна в Cloud Monitoring.'
        });
        this.renderFirestoreUsageMetric('reads', usage?.reads, {
            valueId: 'firestoreUsageReadsValue',
            limitId: 'firestoreUsageReadsLimit',
            barId: 'firestoreUsageReadsBar',
            statusId: 'firestoreUsageReadsStatus',
            noteId: 'firestoreUsageReadsNote',
            formatValue: (value) => this.formatFirestoreCount(value),
            formatLimit: (value) => `из ${this.formatFirestoreCount(value)}`,
            unavailableNote: 'Метрика чтений недоступна в Cloud Monitoring.'
        });
        this.renderFirestoreUsageMetric('writes', usage?.writes, {
            valueId: 'firestoreUsageWritesValue',
            limitId: 'firestoreUsageWritesLimit',
            barId: 'firestoreUsageWritesBar',
            statusId: 'firestoreUsageWritesStatus',
            noteId: 'firestoreUsageWritesNote',
            formatValue: (value) => this.formatFirestoreCount(value),
            formatLimit: (value) => `из ${this.formatFirestoreCount(value)}`,
            unavailableNote: 'Метрика записей недоступна в Cloud Monitoring.'
        });
    }

    async loadProviderKeys(force = false) {
        if (!this.adminService) return [];
        if (this.providerKeysRequest) return this.providerKeysRequest;
        if (this.providerKeys.length > 0 && !force) {
            this.renderProviderKeys(this.providerKeys);
            return this.providerKeys;
        }

        this.renderProviderKeysLoading(true);
        this.providerKeysRequest = this.adminService.listProviderKeys()
            .then((keys) => {
                this.providerKeys = Array.isArray(keys) ? keys : [];
                this.renderProviderKeys(this.providerKeys);
                return this.providerKeys;
            })
            .catch((error) => {
                console.error('Error loading provider keys:', error?.code || 'unknown error');
                this.renderProviderKeysError(error);
                throw error;
            })
            .finally(() => {
                this.providerKeysRequest = null;
                this.renderProviderKeysLoading(false);
            });

        return this.providerKeysRequest;
    }

    renderProviderKeysLoading(isLoading) {
        const loading = document.getElementById('providerKeysLoading');
        const refreshButton = document.getElementById('refreshProviderKeysBtn');
        const list = document.getElementById('providerKeysList');
        if (loading) loading.hidden = !isLoading;
        if (list) list.setAttribute('aria-busy', String(isLoading));
        if (refreshButton) {
            refreshButton.disabled = isLoading;
            refreshButton.classList.toggle('loading', isLoading);
        }
    }

    getProviderKeyErrorMessage(error) {
        const messages = {
            AUTH_REQUIRED: 'Сессия администратора завершена. Войдите снова.',
            DUPLICATE_KEY: 'Такой ключ уже добавлен в реестр.',
            INVALID_CREDENTIAL: 'Значение ключа отклонено. Проверьте его и попробуйте снова.',
            INVALID_PROVIDER: 'Этот провайдер пока не поддерживается.',
            PROVIDER_UNSUPPORTED: 'Для этого провайдера ещё нет проверки квоты.',
            PROVIDER_UNAVAILABLE: 'Провайдер временно недоступен. Повторите попытку позже.',
            SECRET_REVOKE_FAILED: 'Ключ отключён, но его не удалось полностью отозвать. Проверьте состояние позже.',
            KEY_NOT_FOUND: 'Ключ не найден. Обновите список.',
        };
        return messages[error?.code] || 'Операция с API-ключом не выполнена. Повторите попытку.';
    }

    renderProviderKeysError(error) {
        const errorBox = document.getElementById('providerKeysError');
        if (!errorBox) return;
        errorBox.hidden = false;
        errorBox.textContent = this.getProviderKeyErrorMessage(error);
        const count = document.getElementById('adminNavProviderKeysCount');
        if (count) {
            count.textContent = '!';
            count.classList.add('admin-nav-count-warning');
        }
    }

    clearProviderKeysError() {
        const errorBox = document.getElementById('providerKeysError');
        if (errorBox) {
            errorBox.hidden = true;
            errorBox.textContent = '';
        }
    }

    formatProviderKeyDate(value) {
        const date = value?.toDate?.() || (value ? new Date(value) : null);
        return date && !Number.isNaN(date.getTime())
            ? date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
            : 'Ещё не проверялся';
    }

    formatProviderKeyQuota(quota) {
        if (!quota || quota.mode === 'unavailable') {
            return quota?.unit === 'requests_per_second'
                ? 'Остаток не публикуется'
                : 'Квота недоступна';
        }
        if (Number.isFinite(quota.remaining) && Number.isFinite(quota.limit)) {
            return `${this.formatFirestoreCount(quota.remaining)} из ${this.formatFirestoreCount(quota.limit)}`;
        }
        if (quota.mode === 'local_estimate') return 'Локальная оценка';
        return 'Проверено провайдером';
    }

    renderProviderKeysQuotaSummary(keys) {
        const summary = document.getElementById('providerKeysQuotaSummary');
        const label = document.getElementById('providerKeysQuotaLabel');
        const value = document.getElementById('providerKeysQuotaValue');
        const note = document.getElementById('providerKeysQuotaNote');
        if (!summary || !label || !value || !note) return;

        const activeKeys = (Array.isArray(keys) ? keys : []).filter((key) => key?.status === 'active');
        const kinopoiskKeys = activeKeys.filter((key) => key?.provider === 'kinopoisk');
        const tmdbKeys = activeKeys.filter((key) => key?.provider === 'tmdb');
        const measuredKeys = kinopoiskKeys.filter((key) => (
            key?.quota?.mode === 'provider_exact'
            && Number.isFinite(key.quota.remaining)
            && Number.isFinite(key.quota.limit)
        ));

        if (!activeKeys.length) {
            summary.dataset.state = 'empty';
            label.textContent = 'Дневная квота';
            value.textContent = '— / —';
            note.textContent = 'Нет активных ключей';
            summary.setAttribute('aria-label', 'Квоты провайдеров: нет активных ключей');
            return;
        }

        if (!kinopoiskKeys.length && tmdbKeys.length) {
            summary.dataset.state = 'unavailable';
            label.textContent = 'TMDB · рейт-лимит';
            value.textContent = '— / —';
            note.textContent = 'TMDB не публикует дневной остаток; учитываются ответы 429';
            summary.setAttribute('aria-label', 'TMDB не публикует дневной остаток запросов');
            return;
        }

        if (!measuredKeys.length) {
            summary.dataset.state = 'unavailable';
            label.textContent = 'Кинопоиск · на сегодня';
            value.textContent = '— / —';
            note.textContent = 'Проверьте квоту активных ключей Кинопоиска';
            summary.setAttribute('aria-label', 'Дневная квота Кинопоиска пока недоступна');
            return;
        }

        const remaining = measuredKeys.reduce((total, key) => total + key.quota.remaining, 0);
        const limit = measuredKeys.reduce((total, key) => total + key.quota.limit, 0);
        label.textContent = 'Кинопоиск · на сегодня';
        value.textContent = `${this.formatFirestoreCount(remaining)} / ${this.formatFirestoreCount(limit)}`;

        if (measuredKeys.length === kinopoiskKeys.length) {
            summary.dataset.state = 'exact';
            note.textContent = tmdbKeys.length
                ? `TMDB: ${tmdbKeys.length} активн. · дневной остаток не публикуется`
                : `${kinopoiskKeys.length} активных ключа · по последней проверке`;
            summary.setAttribute('aria-label', `Дневная квота Кинопоиска: осталось ${remaining} из ${limit}`);
            return;
        }

        summary.dataset.state = 'partial';
        note.textContent = `Точные данные: ${measuredKeys.length} из ${kinopoiskKeys.length} ключей Кинопоиска`;
        summary.setAttribute('aria-label', `Частичная дневная квота Кинопоиска: осталось ${remaining} из ${limit}`);
    }

    renderProviderKeys(keys) {
        const list = document.getElementById('providerKeysList');
        const count = document.getElementById('adminNavProviderKeysCount');
        if (!list) return;
        this.clearProviderKeysError();
        this.renderProviderKeysQuotaSummary(keys);
        if (count) {
            count.textContent = String(keys.length);
            count.classList.remove('admin-nav-count-warning');
        }

        if (!keys.length) {
            list.innerHTML = '<div class="provider-keys-empty">Ключи ещё не добавлены. Добавьте первый ключ для подключения провайдера.</div>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'provider-keys-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Провайдер</th>
                    <th>Название и назначение</th>
                    <th>Ключ</th>
                    <th>Статус</th>
                    <th>Квота</th>
                    <th>Последняя проверка</th>
                    <th><span class="sr-only">Действия</span></th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const body = table.querySelector('tbody');
        keys.forEach((key) => {
            const row = document.createElement('tr');
            const status = key.status === 'active' ? 'active' : 'disabled';
            const statusLabel = status === 'active' ? 'Активен' : 'Отключён';
            const actionLabel = status === 'active' ? 'Отключить' : 'Включить';
            const action = status === 'active' ? 'disable' : 'enable';
            row.innerHTML = `
                <td data-label="Провайдер"><span class="provider-key-provider">${this.escapeHtml(key.provider || '—')}</span></td>
                <td data-label="Название и назначение">
                    <strong class="provider-key-label">${this.escapeHtml(key.label || 'Без названия')}</strong>
                    <span class="provider-key-purpose">${this.escapeHtml(key.purpose || 'Назначение не указано')}</span>
                </td>
                <td data-label="Ключ"><code class="provider-key-mask">${this.escapeHtml(key.maskedValue || '••••')}</code></td>
                <td data-label="Статус"><span class="provider-key-status provider-key-status--${status}">${statusLabel}</span></td>
                <td data-label="Квота"><span class="provider-key-quota">${this.escapeHtml(this.formatProviderKeyQuota(key.quota))}</span><small>${key.quota?.mode === 'provider_exact' ? 'Точные данные' : key.quota?.unit === 'requests_per_second' ? 'TMDB: суточная квота не публикуется' : key.quota?.mode === 'local_estimate' ? 'Оценка' : 'Нет данных'}</small></td>
                <td data-label="Последняя проверка"><span class="provider-key-date">${this.escapeHtml(this.formatProviderKeyDate(key.lastCheckedAt))}</span></td>
                <td data-label="Действия">
                    <div class="provider-key-actions">
                        <button class="provider-key-action" type="button" data-provider-key-action="test" data-provider-key-id="${this.escapeHtml(key.id || '')}">Проверить</button>
                        <button class="provider-key-action" type="button" data-provider-key-action="quota" data-provider-key-id="${this.escapeHtml(key.id || '')}">Квота</button>
                        <button class="provider-key-action" type="button" data-provider-key-action="${action}" data-provider-key-id="${this.escapeHtml(key.id || '')}">${actionLabel}</button>
                        <button class="provider-key-action provider-key-action--danger" type="button" data-provider-key-action="revoke" data-provider-key-id="${this.escapeHtml(key.id || '')}">Отозвать</button>
                    </div>
                </td>
            `;
            body.appendChild(row);
        });
        list.replaceChildren(table);
    }

    async loadCommentReactionConfig(force = false) {
        if (!this.adminService) return null;
        if (this.commentReactionConfigRequest) return this.commentReactionConfigRequest;

        this.renderCommentReactionConfigLoading(true);
        this.commentReactionConfigRequest = this.adminService.getCommentReactionConfig(force)
            .then((config) => {
                this.commentReactionConfig = config;
                this.renderCommentReactionConfig(config);
                return config;
            })
            .catch((error) => {
                console.error('Error loading comment reaction config:', error);
                this.renderCommentReactionConfigError('Не удалось загрузить каталог реакций. Повторите попытку.');
                throw error;
            })
            .finally(() => {
                this.commentReactionConfigRequest = null;
                this.renderCommentReactionConfigLoading(false);
            });

        return this.commentReactionConfigRequest;
    }

    renderCommentReactionConfigLoading(isLoading) {
        const list = document.getElementById('commentReactionList');
        const refreshButton = document.getElementById('refreshCommentReactionsBtn');
        const submitButton = document.getElementById('addCommentReactionBtn');
        if (list) list.setAttribute('aria-busy', String(isLoading));
        if (refreshButton) refreshButton.disabled = isLoading || this.commentReactionSavePending;
        if (submitButton) submitButton.disabled = isLoading || this.commentReactionSavePending;
    }

    renderCommentReactionConfigError(message) {
        const errorBox = document.getElementById('commentReactionError');
        if (!errorBox) return;
        errorBox.hidden = !message;
        errorBox.textContent = message || '';
        const count = document.getElementById('adminNavReactionCount');
        if (count && message) {
            count.textContent = '!';
            count.classList.add('admin-nav-count-warning');
        }
    }

    renderCommentReactionConfig(config) {
        const list = document.getElementById('commentReactionList');
        const count = document.getElementById('commentReactionCount');
        const navCount = document.getElementById('adminNavReactionCount');
        const status = document.getElementById('commentReactionConfigStatus');
        if (!list) return;

        const reactions = Array.isArray(config?.reactions) ? config.reactions : [];
        this.renderCommentReactionConfigError('');
        const maxCatalogSize = typeof CommentReactionService !== 'undefined'
            ? CommentReactionService.MAX_REACTION_CATALOG_SIZE
            : 24;
        if (count) count.textContent = `${reactions.length} из ${maxCatalogSize}`;
        if (navCount) {
            navCount.textContent = String(reactions.length);
            navCount.classList.remove('admin-nav-count-warning');
        }
        if (status) status.textContent = reactions.length ? 'Синхронизировано' : 'Каталог пуст';

        if (!reactions.length) {
            list.innerHTML = '<div class="comment-reaction-admin-state">Добавьте первую реакцию.</div>';
            return;
        }

        list.innerHTML = reactions.map((reaction) => `
            <div class="comment-reaction-admin-item">
                ${this.renderCommentReactionAdminPreview(reaction)}
                <span class="comment-reaction-admin-name">${this.escapeHtml(reaction.label)}</span>
                <code class="comment-reaction-admin-id">${this.escapeHtml(reaction.id)}</code>
                <button type="button" class="comment-reaction-delete" data-reaction-id="${this.escapeHtml(reaction.id)}"
                    aria-label="Удалить реакцию ${this.escapeHtml(reaction.label)}">Удалить</button>
            </div>
        `).join('');

        list.querySelectorAll('[data-reaction-id]').forEach((button) => {
            button.addEventListener('click', () => this.handleCommentReactionDelete(button.dataset.reactionId));
        });
    }

    renderCommentReactionAdminPreview(reaction) {
        const imageUrl = globalThis.CommentReactionService?.normalizeReactionImageUrl?.(reaction?.imageUrl);
        if (reaction?.renderType === 'image' && imageUrl) {
            return `<span class="comment-reaction-admin-preview" aria-hidden="true"><img src="${this.escapeHtml(imageUrl)}" alt="" loading="lazy"></span>`;
        }
        return `<span class="comment-reaction-admin-preview" aria-hidden="true">${this.escapeHtml(reaction?.emoji || '')}</span>`;
    }

    getCommentReactionFormValues() {
        const emojiInput = document.getElementById('commentReactionEmojiInput');
        const labelInput = document.getElementById('commentReactionLabelInput');
        const assetInput = document.getElementById('commentReactionAssetInput');
        return {
            emoji: emojiInput?.value?.trim() || '',
            label: labelInput?.value?.trim() || '',
            file: assetInput?.files?.[0] || this.commentReactionAssetFile || null,
            emojiInput,
            labelInput,
            assetInput
        };
    }

    validateCommentReactionEmoji(emoji) {
        if (!emoji) return 'Укажите эмодзи.';
        if (emoji.length > 32) return 'Эмодзи слишком длинный.';
        const graphemes = typeof Intl?.Segmenter === 'function'
            ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(emoji)]
            : [...emoji];
        return graphemes.length === 1 ? '' : 'Укажите один эмодзи без нескольких символов.';
    }

    validateCommentReactionFallback(value, hasAsset) {
        if (hasAsset) {
            return /^:[a-z0-9](?:[a-z0-9_-]{0,29}):$/i.test(value)
                ? ''
                : 'Для картинки укажите shortcode в формате :название:.';
        }
        if (/^:[a-z0-9](?:[a-z0-9_-]{0,29}):$/i.test(value)) {
            return 'Загрузите картинку для кастомного shortcode.';
        }
        return this.validateCommentReactionEmoji(value);
    }

    validateCommentReactionAsset(file) {
        if (!file) return '';
        const allowedTypes = globalThis.CommentReactionService?.REACTION_ASSET_CONTENT_TYPES
            || ['image/png', 'image/webp', 'image/gif'];
        const maxSize = globalThis.CommentReactionService?.MAX_REACTION_ASSET_SIZE || (256 * 1024);
        if (!allowedTypes.includes(String(file.type || '').toLowerCase())) {
            return 'Поддерживаются только PNG, WebP и GIF.';
        }
        if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxSize) {
            return 'Размер изображения не должен превышать 256 КБ.';
        }
        return '';
    }

    clearCommentReactionAssetPreview() {
        if (this.commentReactionAssetPreviewUrl && typeof URL !== 'undefined') {
            URL.revokeObjectURL(this.commentReactionAssetPreviewUrl);
        }
        this.commentReactionAssetPreviewUrl = null;
        this.commentReactionAssetFile = null;
        const preview = document.getElementById('commentReactionAssetPreview');
        const image = document.getElementById('commentReactionAssetPreviewImage');
        const name = document.getElementById('commentReactionAssetPreviewName');
        if (preview) preview.hidden = true;
        if (image) image.removeAttribute('src');
        if (name) name.textContent = '';
    }

    previewCommentReactionAsset(file) {
        this.clearCommentReactionAssetPreview();
        const error = this.validateCommentReactionAsset(file);
        if (error || !file || typeof URL === 'undefined') {
            if (error) this.renderCommentReactionConfigError(error);
            return error;
        }

        const preview = document.getElementById('commentReactionAssetPreview');
        const image = document.getElementById('commentReactionAssetPreviewImage');
        const name = document.getElementById('commentReactionAssetPreviewName');
        this.commentReactionAssetPreviewUrl = URL.createObjectURL(file);
        if (image) image.src = this.commentReactionAssetPreviewUrl;
        if (name) name.textContent = file.name || 'Кастомный эмодзи';
        if (preview) preview.hidden = false;
        return '';
    }

    setCommentReactionAssetFile(file) {
        const input = document.getElementById('commentReactionAssetInput');
        const dropzone = document.getElementById('commentReactionAssetDropzone');
        const error = this.previewCommentReactionAsset(file);

        if (error || !file) {
            this.commentReactionAssetFile = null;
            if (input) {
                input.value = '';
                input.setAttribute('aria-invalid', error ? 'true' : 'false');
            }
            dropzone?.setAttribute('data-invalid', error ? 'true' : 'false');
            return error;
        }

        this.commentReactionAssetFile = file;
        if (input && typeof DataTransfer === 'function') {
            try {
                const transfer = new DataTransfer();
                transfer.items.add(file);
                input.files = transfer.files;
            } catch (error) {
                console.warn('Unable to mirror reaction asset into file input:', error);
            }
        }
        input?.setAttribute('aria-invalid', 'false');
        dropzone?.setAttribute('data-invalid', 'false');
        return '';
    }

    handleCommentReactionAssetPaste(event) {
        if (event.defaultPrevented) return;
        const items = Array.from(event.clipboardData?.items || []);
        const file = items
            .filter((item) => item.kind === 'file')
            .map((item) => item.getAsFile?.())
            .find(Boolean);
        if (!file) return;
        event.preventDefault();
        this.setCommentReactionAssetFile(file);
    }

    handleCommentReactionAssetDrop(event) {
        event.preventDefault();
        const dropzone = document.getElementById('commentReactionAssetDropzone');
        dropzone?.classList.remove('is-dragover');
        const files = Array.from(event.dataTransfer?.files || []);
        const allowedTypes = globalThis.CommentReactionService?.REACTION_ASSET_CONTENT_TYPES
            || ['image/png', 'image/webp', 'image/gif'];
        const file = files.find((item) => allowedTypes.includes(String(item.type || '').toLowerCase()))
            || files[0]
            || null;
        this.setCommentReactionAssetFile(file);
    }

    async persistCommentReactionConfig(reactions, successMessage) {
        if (this.commentReactionSavePending) return;
        this.commentReactionSavePending = true;
        this.renderCommentReactionConfigLoading(true);
        try {
            const config = await this.adminService.saveCommentReactionConfig(
                reactions,
                this.currentUser?.uid
            );
            this.commentReactionConfig = config;
            this.renderCommentReactionConfig(config);
            this.showSuccessMessage(successMessage);
            return true;
        } catch (error) {
            console.error('Error saving comment reaction config:', error);
            this.renderCommentReactionConfigError(error?.message || 'Не удалось сохранить каталог реакций.');
            return false;
        } finally {
            this.commentReactionSavePending = false;
            this.renderCommentReactionConfigLoading(false);
        }
    }

    async handleCommentReactionSubmit(event) {
        event.preventDefault();
        if (this.commentReactionSavePending) return;

        const { emoji, label, file, emojiInput, labelInput } = this.getCommentReactionFormValues();
        const emojiError = this.validateCommentReactionFallback(emoji, !!file);
        const assetError = this.validateCommentReactionAsset(file);
        if (emojiError || assetError || !label) {
            this.renderCommentReactionConfigError(emojiError || assetError || 'Укажите название реакции.');
            emojiInput?.setAttribute('aria-invalid', emojiError ? 'true' : 'false');
            labelInput?.setAttribute('aria-invalid', label ? 'false' : 'true');
            (emojiError || assetError ? emojiInput : labelInput)?.focus();
            return;
        }

        let config = this.commentReactionConfig;
        if (!config) {
            try {
                config = await this.loadCommentReactionConfig();
            } catch {
                return;
            }
        }
        const reactions = Array.isArray(config?.reactions) ? config.reactions : [];
        const maxCatalogSize = typeof CommentReactionService !== 'undefined'
            ? CommentReactionService.MAX_REACTION_CATALOG_SIZE
            : 24;
        if (reactions.length >= maxCatalogSize) {
            this.renderCommentReactionConfigError(`Нельзя добавить больше ${maxCatalogSize} реакций.`);
            return;
        }
        if (reactions.some((reaction) => reaction.emoji === emoji || reaction.shortcode === emoji)) {
            this.renderCommentReactionConfigError('Такая реакция уже есть в каталоге.');
            emojiInput?.focus();
            return;
        }

        const reactionId = typeof CommentReactionService !== 'undefined'
            && typeof CommentReactionService.createCustomReactionId === 'function'
            ? CommentReactionService.createCustomReactionId()
            : `custom_${Date.now().toString(36)}`;
        let uploadedAsset = null;
        if (file) {
            try {
                uploadedAsset = await this.adminService.uploadCommentReactionAsset(
                    file,
                    reactionId,
                    this.currentUser?.uid
                );
            } catch (error) {
                console.error('Error uploading comment reaction asset:', error);
                this.renderCommentReactionConfigError(error?.message || 'Не удалось загрузить изображение.');
                return;
            }
        }

        const reaction = uploadedAsset
            ? {
                id: reactionId,
                emoji,
                shortcode: emoji,
                label,
                renderType: 'image',
                imageUrl: uploadedAsset.imageUrl,
                storagePath: uploadedAsset.storagePath
            }
            : { id: reactionId, emoji, label };
        const saved = await this.persistCommentReactionConfig(
            [...reactions, reaction],
            'Реакция добавлена и опубликована для всех пользователей.'
        );

        if (!saved && uploadedAsset?.storagePath) {
            try {
                await this.adminService.deleteCommentReactionAsset(
                    uploadedAsset.storagePath,
                    this.currentUser?.uid
                );
            } catch (cleanupError) {
                console.warn('Failed to clean up unused reaction asset:', cleanupError);
            }
        }

        if (saved) {
            emojiInput.value = '';
            labelInput.value = '';
            const assetInput = document.getElementById('commentReactionAssetInput');
            if (assetInput) assetInput.value = '';
            this.clearCommentReactionAssetPreview();
            emojiInput.setAttribute('aria-invalid', 'false');
            labelInput.setAttribute('aria-invalid', 'false');
            emojiInput.focus();
        }
    }

    async handleCommentReactionDelete(reactionId) {
        if (!reactionId || this.commentReactionSavePending) return;
        const config = this.commentReactionConfig;
        const reactions = Array.isArray(config?.reactions) ? config.reactions : [];
        const reaction = reactions.find((item) => item.id === reactionId);
        if (!reaction) return;
        if (reactions.length <= 1) {
            this.renderCommentReactionConfigError('Нельзя удалить последнюю реакцию из каталога.');
            return;
        }
        if (!confirm(`Удалить реакцию ${reaction.emoji} «${reaction.label}»? Она исчезнет у новых клиентов, а старые записи пользователей сохранятся.`)) return;

        const saved = await this.persistCommentReactionConfig(
            reactions.filter((item) => item.id !== reactionId),
            'Реакция удалена из общего каталога.'
        );
        if (saved && reaction.storagePath) {
            try {
                await this.adminService.deleteCommentReactionAsset(
                    reaction.storagePath,
                    this.currentUser?.uid
                );
            } catch (error) {
                console.warn('Reaction removed from catalog, but asset cleanup failed:', error);
                this.renderCommentReactionConfigError('Реакция удалена, но её файл не удалось очистить.');
            }
        }
    }

    async handleProviderKeyAction(action, keyId) {
        if (!keyId || this.providerKeyActionRequest) return;
        if (action === 'revoke') {
            this.openProviderKeyConfirm(keyId);
            return;
        }

        this.providerKeyActionRequest = true;
        try {
            if (action === 'test') await this.adminService.testProviderKey(keyId);
            else if (action === 'quota') await this.adminService.getProviderKeyQuota(keyId);
            else if (action === 'enable' || action === 'disable') {
                await this.adminService.setProviderKeyStatus(keyId, action === 'enable' ? 'active' : 'disabled');
            } else return;
            await this.loadProviderKeys(true);
            this.showSuccessMessage(action === 'quota' ? 'Квота обновлена' : 'Состояние ключа обновлено');
        } catch (error) {
            console.error('Provider key action failed:', error?.code || 'unknown error');
            this.renderProviderKeysError(error);
        } finally {
            this.providerKeyActionRequest = false;
        }
    }

    openAddProviderKeyModal() {
        const modal = document.getElementById('addProviderKeyModal');
        if (!modal) return;
        this.providerKeyModalTrigger = document.activeElement;
        this.setProviderKeyFormError('');
        ['providerKeyLabel', 'providerKeyPurpose', 'providerKeySecret'].forEach((id) => {
            document.getElementById(id)?.setAttribute('aria-invalid', 'false');
        });
        modal.style.display = 'flex';
        document.getElementById('providerKeyLabel')?.focus();
    }

    closeAddProviderKeyModal() {
        const modal = document.getElementById('addProviderKeyModal');
        const form = document.getElementById('providerKeyForm');
        const secret = document.getElementById('providerKeySecret');
        if (modal) modal.style.display = 'none';
        if (form) form.reset();
        if (secret) secret.type = 'password';
        ['providerKeyLabel', 'providerKeyPurpose', 'providerKeySecret'].forEach((id) => {
            document.getElementById(id)?.setAttribute('aria-invalid', 'false');
        });
        this.setProviderKeyFormError('');
        this.providerKeyModalTrigger?.focus?.();
        this.providerKeyModalTrigger = null;
    }

    setProviderKeyFormError(message) {
        const errorBox = document.getElementById('providerKeyFormError');
        if (!errorBox) return;
        errorBox.hidden = !message;
        errorBox.textContent = message || '';
    }

    async handleProviderKeySubmit(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const provider = form.elements.provider?.value || 'kinopoisk';
        const label = form.elements.label?.value.trim() || '';
        const purpose = form.elements.purpose?.value.trim() || '';
        const secretInput = form.elements.secret;
        const secret = secretInput?.value || '';
        const submitButton = document.getElementById('submitProviderKeyBtn');
        if (!label || !purpose || !secret.trim()) {
            this.setProviderKeyFormError('Заполните название, назначение и значение ключа.');
            const invalidFields = [
                ['providerKeyLabel', label],
                ['providerKeyPurpose', purpose],
                ['providerKeySecret', secret.trim()]
            ];
            invalidFields.forEach(([id, value]) => document.getElementById(id)?.setAttribute('aria-invalid', value ? 'false' : 'true'));
            document.getElementById(!label ? 'providerKeyLabel' : !purpose ? 'providerKeyPurpose' : 'providerKeySecret')?.focus();
            return;
        }

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = 'Проверка…';
        }
        this.setProviderKeyFormError('');
        try {
            await this.adminService.addProviderKey({ provider, label, purpose, secret });
            this.closeAddProviderKeyModal();
            await this.loadProviderKeys(true);
            this.showSuccessMessage('API-ключ добавлен и проверен');
        } catch (error) {
            console.error('Provider key add failed:', error?.code || 'unknown error');
            this.setProviderKeyFormError(this.getProviderKeyErrorMessage(error));
            if (error?.code === 'INVALID_CREDENTIAL') secretInput?.setAttribute('aria-invalid', 'true');
        } finally {
            if (secretInput) secretInput.value = '';
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = 'Проверить и сохранить';
            }
        }
    }

    toggleProviderKeySecret() {
        const input = document.getElementById('providerKeySecret');
        const button = document.getElementById('toggleProviderKeySecretBtn');
        if (!input || !button) return;
        const isVisible = input.type === 'text';
        input.type = isVisible ? 'password' : 'text';
        button.textContent = isVisible ? 'Показать' : 'Скрыть';
        button.setAttribute('aria-label', isVisible ? 'Показать ключ' : 'Скрыть ключ');
    }

    openProviderKeyConfirm(keyId) {
        const key = this.providerKeys.find((item) => item.id === keyId);
        const modal = document.getElementById('providerKeyConfirmModal');
        const text = document.getElementById('providerKeyConfirmText');
        if (!key || !modal) return;
        this.providerKeyPendingRevoke = keyId;
        this.providerKeyConfirmTrigger = document.activeElement;
        if (text) text.textContent = `Ключ «${key.label || 'Без названия'}» (${key.provider || 'провайдер'}, ${key.maskedValue || 'маска недоступна'}) будет отключён и удалён из Secret Manager.`;
        modal.style.display = 'flex';
        document.getElementById('cancelProviderKeyConfirmBtn')?.focus();
    }

    closeProviderKeyConfirm() {
        const modal = document.getElementById('providerKeyConfirmModal');
        if (modal) modal.style.display = 'none';
        this.providerKeyPendingRevoke = null;
        this.providerKeyConfirmTrigger?.focus?.();
        this.providerKeyConfirmTrigger = null;
    }

    async confirmProviderKeyRevoke() {
        const keyId = this.providerKeyPendingRevoke;
        const button = document.getElementById('confirmProviderKeyBtn');
        if (!keyId || this.providerKeyActionRequest) return;
        this.providerKeyActionRequest = true;
        if (button) button.disabled = true;
        try {
            await this.adminService.revokeProviderKey(keyId);
            this.closeProviderKeyConfirm();
            await this.loadProviderKeys(true);
            this.showSuccessMessage('API-ключ отозван');
        } catch (error) {
            console.error('Provider key revoke failed:', error?.code || 'unknown error');
            this.renderProviderKeysError(error);
        } finally {
            this.providerKeyActionRequest = false;
            if (button) button.disabled = false;
        }
    }

    renderFirestoreUsageMetric(name, metric, options) {
        const valueElement = document.getElementById(options.valueId);
        const limitElement = document.getElementById(options.limitId);
        const barElement = document.getElementById(options.barId);
        const statusElement = document.getElementById(options.statusId);
        const noteElement = document.getElementById(options.noteId);
        const progressElement = barElement?.parentElement;
        const isAvailable = metric?.available === true && Number.isFinite(metric.percent);
        const percent = isAvailable ? Math.max(0, Math.min(100, metric.percent)) : 0;
        const status = isAvailable ? metric.status : 'unavailable';
        const statusLabels = {
            normal: 'В норме',
            warning: 'Внимание',
            critical: 'Критично',
            unavailable: 'Недоступно'
        };

        if (valueElement) {
            valueElement.textContent = isAvailable ? options.formatValue(metric[name === 'storage' ? 'usedBytes' : 'usedToday']) : '—';
        }
        if (limitElement) {
            limitElement.textContent = metric?.limit ? options.formatLimit(metric.limit) : 'Лимит неизвестен';
        }
        if (barElement) barElement.style.width = `${percent}%`;
        if (progressElement) progressElement.setAttribute('aria-valuenow', String(Math.round(percent)));
        if (statusElement) {
            statusElement.className = `firestore-usage-status usage-status--${status}`;
            statusElement.textContent = statusLabels[status] || statusLabels.unavailable;
        }
        if (noteElement) {
            if (!isAvailable) {
                noteElement.textContent = options.unavailableNote;
            } else if (metric.stale) {
                noteElement.textContent = 'Данные могут быть устаревшими — Cloud Monitoring ещё обновляется.';
            } else {
                noteElement.textContent = `${metric.percent.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}% лимита использовано`;
            }
        }
    }

    formatFirestoreBytes(bytes) {
        if (!Number.isFinite(bytes)) return '—';
        const gib = 1024 ** 3;
        const mib = 1024 ** 2;
        if (bytes >= gib) return `${(bytes / gib).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} GiB`;
        if (bytes >= mib) return `${(bytes / mib).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} MiB`;
        return `${Math.round(bytes / 1024).toLocaleString('ru-RU')} KiB`;
    }

    formatFirestoreCount(count) {
        return Number.isFinite(count) ? count.toLocaleString('ru-RU') : '—';
    }

    formatRussianCount(count, one, few, many) {
        const value = Math.abs(Number(count)) % 100;
        const lastDigit = value % 10;
        const word = value > 10 && value < 20
            ? many
            : lastDigit === 1
                ? one
                : lastDigit >= 2 && lastDigit <= 4
                    ? few
                    : many;
        return `${count} ${word}`;
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
                (user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Неизвестно');

            const isChecked = this.selectedApprovalIds.has(user.id);

            row.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" class="approval-checkbox" data-user-id="${user.id}" ${isChecked ? 'checked' : ''}>
                </td>
                <td>
                    <div class="user-info">
                        <img src="${user.photoURL || IconUtils.getCurrentThemeIconPath(48)}"
                             alt="${user.displayName || 'Пользователь'}"
                             class="user-avatar"
                             loading="lazy">
                        <div>
                            <div class="user-name">
                                ${this.escapeHtml(user.displayName || 'Пользователь без имени')}
                            </div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="user-email">${this.escapeHtml(user.email || 'Нет email')}</div>
                </td>
                <td>
                    <div class="user-id">${this.escapeHtml(user.id.substring(0, 12))}...</div>
                </td>
                <td>${joinDate}</td>
                <td>
                    <span class="status-badge status-badge-pending">Ожидает</span>
                </td>
                <td style="text-align: right;">
                    <div class="row-actions-group">
                        <button class="btn-approve-sm" data-action="approve" data-user-id="${user.id}">Одобрить</button>
                        <button class="btn-reject-sm" data-action="reject" data-user-id="${user.id}">Отклонить</button>
                        <button class="btn-delete" data-user-id="${user.id}">Удалить</button>
                    </div>
                </td>
            `;

            const avatar = row.querySelector('.user-avatar');
            if (avatar) {
                avatar.addEventListener('error', () => {
                    avatar.src = IconUtils.getCurrentThemeIconPath(48);
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
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleUserApprovalAction(btn.dataset.userId, btn.dataset.action, btn);
                });
            });

            // Delete button listener
            const deleteBtn = row.querySelector('.btn-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => this.showDeleteConfirmation(user));
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
                this.showSuccessMessage(`Одобрено заявок: ${userIds.length}`);
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

    renderTableState(tableBodyId, colspan, message, retryLabel, onRetry) {
        const tableBody = document.getElementById(tableBodyId);
        if (!tableBody) return;

        tableBody.innerHTML = '';
        const row = document.createElement('tr');
        row.className = 'admin-table-state-row admin-table-state-row--error';

        const cell = document.createElement('td');
        cell.colSpan = colspan;
        cell.className = 'admin-table-state-cell';

        const messageElement = document.createElement('div');
        messageElement.className = 'admin-table-state-message';
        messageElement.textContent = message;
        cell.appendChild(messageElement);

        if (typeof onRetry === 'function') {
            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.className = 'admin-table-state-retry';
            retryButton.textContent = retryLabel || 'Повторить';
            retryButton.addEventListener('click', onRetry);
            cell.appendChild(retryButton);
        }

        row.appendChild(cell);
        tableBody.appendChild(row);
    }

    renderUsersError() {
        this.renderTableState(
            'usersTableBody',
            8,
            'Не удалось загрузить пользователей.',
            'Повторить',
            () => this.fetchUsersFromDb()
        );
    }

    renderApprovalsError() {
        this.renderTableState(
            'approvalsTableBody',
            7,
            'Не удалось загрузить заявки.',
            'Повторить',
            () => this.loadApprovals()
        );
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
                    <p><strong>Имя:</strong> ${this.escapeHtml(preview.user.displayName || 'Пользователь без имени')}</p>
                    <p><strong>Email:</strong> ${this.escapeHtml(preview.user.email || 'Нет email')}</p>
                `;
            }
            
            if (statsList) {
                statsList.innerHTML = `
                    <li>${this.formatRussianCount(preview.ratingsCount, 'оценка', 'оценки', 'оценок')}</li>
                    <li>${this.formatRussianCount(preview.collectionCount, 'элемент коллекции', 'элемента коллекции', 'элементов коллекции')}</li>
                    <li>Профиль пользователя и связанные данные</li>
                `;
            }
            
            // Show modal
            const modal = document.getElementById('deleteModal');
            if (modal) {
                modal.style.display = 'flex';
            }
        } catch (error) {
            console.error('Error getting deletion preview:', error);
            this.showError('Не удалось получить данные пользователя. Повторите попытку.');
        }
    }

    async confirmDelete() {
        if (!this.userToDelete) return;

        try {
            const confirmBtn = document.getElementById('confirmDeleteBtn');
            if (confirmBtn) {
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Удаление...';
            }

            await this.adminService.deleteUser(this.userToDelete.id, this.currentUser.uid);
            
            // Close modal
            this.hideDeleteModal();
            
            // Reload users
            await this.loadUsers();
            
            // Show success message
            this.showSuccessMessage(`Пользователь «${this.userToDelete.displayName || 'без имени'}» удалён`);
            
            this.userToDelete = null;
        } catch (error) {
            console.error('Error deleting user:', error);
            const confirmBtn = document.getElementById('confirmDeleteBtn');
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Удалить пользователя';
            }
            this.showError('Не удалось удалить пользователя. Повторите попытку.');
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
                this.setAdminAccessState(false);
                this.showError('Сессия завершена. Для доступа к панели администратора необходимо войти в систему.');
                if (window.adminNav && typeof window.adminNav.showAuthModal === 'function') {
                    window.adminNav.showAuthModal('login');
                }
            } else {
                const isAdmin = await this.checkAdminAccess();
                this.setAdminAccessState(isAdmin);
                if (isAdmin) {
                    this.currentUser = user;
                    this.clearAdminError();
                    this.cacheService?.clearUsersCache();
                    this.cacheService?.clearCache();
                    await this.loadUsers();
                    await this.loadMovies();
                    await this.loadApprovals();
                } else {
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

                if (link.dataset.target === 'usage') {
                    this.loadFirestoreUsage().catch(() => {});
                }
                if (link.dataset.target === 'provider-keys') {
                    this.loadProviderKeys().catch(() => {});
                }
                if (link.dataset.target === 'reaction-settings') {
                    this.loadCommentReactionConfig().catch(() => {});
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
            refreshApprovalsBtn.addEventListener('click', () => this.loadApprovals());
        }

        const refreshFirestoreUsageBtn = document.getElementById('refreshFirestoreUsageBtn');
        if (refreshFirestoreUsageBtn) {
            refreshFirestoreUsageBtn.addEventListener('click', () => {
                this.loadFirestoreUsage(true).catch(() => {});
            });
        }

        const refreshProviderKeysBtn = document.getElementById('refreshProviderKeysBtn');
        if (refreshProviderKeysBtn) {
            refreshProviderKeysBtn.addEventListener('click', () => {
                this.loadProviderKeys(true).catch(() => {});
            });
        }

        const refreshCommentReactionsBtn = document.getElementById('refreshCommentReactionsBtn');
        if (refreshCommentReactionsBtn) {
            refreshCommentReactionsBtn.addEventListener('click', () => {
                this.loadCommentReactionConfig(true).catch(() => {});
            });
        }

        const commentReactionForm = document.getElementById('commentReactionForm');
        if (commentReactionForm) {
            commentReactionForm.addEventListener('submit', (event) => this.handleCommentReactionSubmit(event));
            commentReactionForm.addEventListener('paste', (event) => this.handleCommentReactionAssetPaste(event));
        }

        const commentReactionAssetInput = document.getElementById('commentReactionAssetInput');
        const commentReactionAssetDropzone = document.getElementById('commentReactionAssetDropzone');
        if (commentReactionAssetInput && commentReactionAssetDropzone) {
            commentReactionAssetInput.addEventListener('change', () => {
                this.setCommentReactionAssetFile(commentReactionAssetInput.files?.[0] || null);
            });
            commentReactionAssetDropzone.addEventListener('click', (event) => {
                if (event.target !== commentReactionAssetInput) commentReactionAssetInput.click();
            });
            commentReactionAssetDropzone.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                commentReactionAssetInput.click();
            });
            let dragDepth = 0;
            commentReactionAssetDropzone.addEventListener('dragenter', (event) => {
                event.preventDefault();
                dragDepth += 1;
                commentReactionAssetDropzone.classList.add('is-dragover');
            });
            commentReactionAssetDropzone.addEventListener('dragover', (event) => {
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
            });
            commentReactionAssetDropzone.addEventListener('dragleave', (event) => {
                event.preventDefault();
                dragDepth = Math.max(0, dragDepth - 1);
                if (dragDepth === 0) commentReactionAssetDropzone.classList.remove('is-dragover');
            });
            commentReactionAssetDropzone.addEventListener('drop', (event) => {
                dragDepth = 0;
                this.handleCommentReactionAssetDrop(event);
            });
        }

        const addProviderKeyBtn = document.getElementById('addProviderKeyBtn');
        if (addProviderKeyBtn) addProviderKeyBtn.addEventListener('click', () => this.openAddProviderKeyModal());

        const closeAddProviderKeyBtn = document.getElementById('closeAddProviderKeyBtn');
        const cancelAddProviderKeyBtn = document.getElementById('cancelAddProviderKeyBtn');
        if (closeAddProviderKeyBtn) closeAddProviderKeyBtn.addEventListener('click', () => this.closeAddProviderKeyModal());
        if (cancelAddProviderKeyBtn) cancelAddProviderKeyBtn.addEventListener('click', () => this.closeAddProviderKeyModal());

        const providerKeyForm = document.getElementById('providerKeyForm');
        if (providerKeyForm) providerKeyForm.addEventListener('submit', (event) => this.handleProviderKeySubmit(event));

        const toggleProviderKeySecretBtn = document.getElementById('toggleProviderKeySecretBtn');
        if (toggleProviderKeySecretBtn) toggleProviderKeySecretBtn.addEventListener('click', () => this.toggleProviderKeySecret());

        const addProviderKeyModal = document.getElementById('addProviderKeyModal');
        if (addProviderKeyModal) {
            addProviderKeyModal.addEventListener('click', (event) => {
                if (event.target === addProviderKeyModal) this.closeAddProviderKeyModal();
            });
        }

        const providerKeysList = document.getElementById('providerKeysList');
        if (providerKeysList) {
            providerKeysList.addEventListener('click', (event) => {
                const button = event.target.closest('[data-provider-key-action]');
                if (!button) return;
                this.handleProviderKeyAction(button.dataset.providerKeyAction, button.dataset.providerKeyId);
            });
        }

        const closeProviderKeyConfirmBtn = document.getElementById('closeProviderKeyConfirmBtn');
        const cancelProviderKeyConfirmBtn = document.getElementById('cancelProviderKeyConfirmBtn');
        const confirmProviderKeyBtn = document.getElementById('confirmProviderKeyBtn');
        const providerKeyConfirmModal = document.getElementById('providerKeyConfirmModal');
        if (closeProviderKeyConfirmBtn) closeProviderKeyConfirmBtn.addEventListener('click', () => this.closeProviderKeyConfirm());
        if (cancelProviderKeyConfirmBtn) cancelProviderKeyConfirmBtn.addEventListener('click', () => this.closeProviderKeyConfirm());
        if (confirmProviderKeyBtn) confirmProviderKeyBtn.addEventListener('click', () => this.confirmProviderKeyRevoke());
        if (providerKeyConfirmModal) {
            providerKeyConfirmModal.addEventListener('click', (event) => {
                if (event.target === providerKeyConfirmModal) this.closeProviderKeyConfirm();
            });
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
            batchApproveBtn.addEventListener('click', () => this.handleBatchApprove());
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
                this.closeAddProviderKeyModal();
                this.closeProviderKeyConfirm();
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

    setAdminAccessState(isAdmin) {
        this.isAdmin = Boolean(isAdmin);

        const adminContent = document.getElementById('adminContent');
        const sectionNav = document.getElementById('adminSectionNav');
        const display = this.isAdmin ? 'block' : 'none';

        if (adminContent) adminContent.style.display = display;
        if (sectionNav) sectionNav.style.display = display;
    }

    hideLoading() {
        const loading = document.getElementById('adminLoading');
        
        if (loading) loading.style.display = 'none';
        this.setAdminAccessState(this.isAdmin);
    }

    showError(message) {
        const errorDiv = document.getElementById('adminError');
        const errorText = document.getElementById('errorText');
        
        if (errorDiv && errorText) {
            errorText.textContent = message;
            errorDiv.style.display = 'block';
            errorDiv.setAttribute('aria-hidden', 'false');
        }
        
        this.hideLoading();
    }

    clearAdminError() {
        const errorDiv = document.getElementById('adminError');
        const errorText = document.getElementById('errorText');

        if (errorDiv) {
            errorDiv.style.display = 'none';
            errorDiv.setAttribute('aria-hidden', 'true');
        }
        if (errorText) errorText.textContent = '';
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
        this.clearAdminError();
        try {
            this.showSkeletonRows(this.pagination.itemsPerPage);
            
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
            this.renderMoviesError();
            this.showError('Не удалось загрузить фильмы. Повторите попытку.');
        }
        console.timeEnd('[Admin Perf] loadMovies total');
    }

    renderMoviesError() {
        this.renderTableState(
            'ratingsTableBody',
            6,
            'Не удалось загрузить фильмы.',
            'Повторить',
            () => this.loadMovies()
        );
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
            const start = this.displayedMovies.length > 0
                ? (this.pagination.currentPage - 1) * this.pagination.itemsPerPage + 1
                : 0;
            const end = this.displayedMovies.length > 0
                ? start + this.displayedMovies.length - 1
                : 0;
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
            option.textContent = user.displayName || user.email || 'Пользователь без имени';
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
                displayName: user.displayName || user.email || 'Пользователь без имени',
                email: user.email || '',
                photoURL: user.photoURL
            };
            ratingValue = latestRating.rating || '—';
            ratingComment = latestRating.comment || '—';
            ratingDate = latestRating.createdAt?.toDate ? 
                latestRating.createdAt.toDate().toLocaleDateString() : 
                (latestRating.createdAt ? new Date(latestRating.createdAt).toLocaleDateString() : '—');
        }

        const movieTitle = movie.name || 'Фильм без названия';
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
                    <img src="${userInfo.photoURL || IconUtils.getCurrentThemeIconPath(48)}"
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
                userAvatar.src = IconUtils.getCurrentThemeIconPath(48);
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
            const movieTitle = movie.name || 'Фильм без названия';
            const userName = user.displayName || user.email || 'Пользователь без имени';

            const ratingPreview = document.getElementById('ratingPreview');
            if (ratingPreview) {
                ratingPreview.innerHTML = `
                    <p><strong>Фильм:</strong> ${this.escapeHtml(movieTitle)}</p>
                    <p><strong>Пользователь:</strong> ${this.escapeHtml(userName)}</p>
                    <p><strong>Оценка:</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> ${rating.rating}</p>
                    ${rating.comment ? `<p><strong>Комментарий:</strong> ${this.escapeHtml(rating.comment.substring(0, 100))}${rating.comment.length > 100 ? '...' : ''}</p>` : ''}
                `;
            }

            const modal = document.getElementById('deleteRatingModal');
            if (modal) {
                modal.style.display = 'flex';
            }
        } catch (error) {
            console.error('Error showing delete rating confirmation:', error);
            this.showError('Не удалось получить данные оценки. Повторите попытку.');
        }
    }

    async confirmDeleteRating() {
        if (!this.ratingToDelete) return;

        try {
            const confirmBtn = document.getElementById('confirmDeleteRatingBtn');
            if (confirmBtn) {
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Удаление...';
            }

            await this.adminService.deleteRatingAsAdmin(this.ratingToDelete.id, this.currentUser.uid);
            
            // Close modal
            this.hideDeleteRatingModal();
            
            // Reload movies/ratings
            await this.loadMovies();
            
            // Show success message
            this.showSuccessMessage('Оценка удалена');
            
            this.ratingToDelete = null;
        } catch (error) {
            console.error('Error deleting rating:', error);
            const confirmBtn = document.getElementById('confirmDeleteRatingBtn');
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Удалить оценку';
            }
            this.showError('Не удалось удалить оценку. Повторите попытку.');
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
        const movieTitle = rating.movie?.name || 'фильм без названия';

        try {
            // Show loading state
            const buttons = document.querySelectorAll(`.btn-update-info[data-movie-id="${movieId}"]`);
            buttons.forEach(btn => {
                btn.disabled = true;
                btn.textContent = 'Обновление...';
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

            this.showSuccessMessage(`Информация обновлена: «${movieTitle}»`);

        } catch (error) {
            console.error('Error updating movie info:', error);
            
            // Reset button state
            const buttons = document.querySelectorAll(`.btn-update-info[data-movie-id="${movieId}"]`);
            buttons.forEach(btn => {
                btn.disabled = false;
                btn.textContent = 'Обновить инфо';
            });

            this.showError('Не удалось обновить информацию о фильме. Повторите попытку.');
        }
    }

    async clearMovieCache(movieId, movieData) {
        if (!movieId) return;

        const movieTitle = movieData?.name || 'фильм без названия';

        if (!confirm(`Очистить кэш для фильма «${movieTitle}»?\n\nВсе сохранённые данные этого фильма будут удалены из Firestore и localStorage.`)) {
            return;
        }

        try {
            // Show loading indicator on the button
            const buttons = document.querySelectorAll(`.btn-clear-cache[data-movie-id="${movieId}"]`);
            buttons.forEach(btn => {
                btn.disabled = true;
                btn.textContent = 'Очистка...';
            });

            await this.adminService.clearMovieCacheAsAdmin(movieId, this.currentUser.uid);

            // Show success message
            this.showSuccessMessage(`Кэш очищен: «${movieTitle}»`);

            // Reset button state
            buttons.forEach(btn => {
                btn.disabled = false;
                btn.textContent = 'Очистить кэш';
            });
        } catch (error) {
            console.error('Error clearing movie cache:', error);
            
            // Reset button state
            const buttons = document.querySelectorAll(`.btn-clear-cache[data-movie-id="${movieId}"]`);
            buttons.forEach(btn => {
                btn.disabled = false;
                btn.textContent = 'Очистить кэш';
            });

            this.showError('Не удалось очистить кэш. Повторите попытку.');
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
            ? new IdMappingService(null, null, firebaseManager)
            : null;
        this.kinopoiskService = (typeof KinopoiskService !== 'undefined')
            ? new KinopoiskService()
            : null;

        this.activeQueueFilter = 'all';
        this.unmappedQueueData = [];
        this.activeIdentitySubtab = 'tmdb-to-kp';
        this.hasAutoSelectedIdentitySubtab = false;

        // Subtabs switching
        const subtabBtns = document.querySelectorAll('.admin-subtab-btn');
        subtabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.hasAutoSelectedIdentitySubtab = true;
                this.switchIdentitySubtab(btn.dataset.subtab);
            });
        });

        document.querySelectorAll('[data-identity-subtab]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.hasAutoSelectedIdentitySubtab = true;
                this.switchIdentitySubtab(btn.dataset.identitySubtab);
                document.querySelector('.admin-subtabs')?.scrollIntoView({ block: 'nearest' });
            });
        });

        const startWorkflowBtn = document.getElementById('startIdentityWorkflowBtn');
        if (startWorkflowBtn) {
            startWorkflowBtn.addEventListener('click', () => {
                this.hasAutoSelectedIdentitySubtab = true;
                this.switchIdentitySubtab(startWorkflowBtn.dataset.subtab);
                document.querySelector('.admin-subtabs')?.scrollIntoView({ block: 'nearest' });
            });
        }

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

        const publishManualMappingsBtn = document.getElementById('publishManualMappingsBtn');
        if (publishManualMappingsBtn) {
            publishManualMappingsBtn.addEventListener('click', async () => {
                if (!this.idMappingService) this.idMappingService = new IdMappingService(null, null, firebaseManager);
                let preview;
                try {
                    preview = await this.idMappingService.getLocalManualMappingPublicationPreview();
                } catch (error) {
                    console.error('Error preparing local mapping publication:', error);
                    this.showError(`Не удалось подготовить публикацию: ${error.message}`);
                    return;
                }
                if (preview.total === 0) {
                    this.showSuccessMessage('Локальных связей для публикации нет.');
                    return;
                }
                const invalidHint = preview.invalid > 0 ? ` Некорректных записей: ${preview.invalid}.` : '';
                if (!confirm(`Опубликовать ${preview.total} локальных ручных связей в общую базу? Конфликтующие записи не будут перезаписаны.${invalidHint}`)) return;

                publishManualMappingsBtn.disabled = true;
                publishManualMappingsBtn.textContent = 'Публикация...';
                try {
                    const result = await this.idMappingService.publishLocalManualMappings();
                    const conflictText = result.conflicts.length > 0 ? ` Конфликтов: ${result.conflicts.length}.` : '';
                    const invalidText = result.invalid.length > 0 ? ` Некорректных: ${result.invalid.length}.` : '';
                    this.showSuccessMessage(`Проверено: ${result.total}; опубликовано: ${result.published}; уже общие: ${result.alreadyShared}.${conflictText}${invalidText}`);
                    await this.loadTmdbFallbacks();
                } catch (error) {
                    console.error('Error publishing local manual mappings:', error);
                    this.showError(`Не удалось опубликовать связи: ${error.message}`);
                } finally {
                    publishManualMappingsBtn.disabled = false;
                    publishManualMappingsBtn.textContent = 'Опубликовать локальные связи';
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

        // Quick manual mapping form submit. A manual relationship must first
        // show a real Kinopoisk candidate; direct save would be unreviewable.
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

                await this.verifyQuickManualMapping({
                    form: quickForm,
                    mediaType,
                    tmdbId,
                    kpId,
                    submittedTitle: titleInput.trim()
                });
            });
        }

        // Initial load
        this.loadTmdbFallbacks();
    }

    switchIdentitySubtab(targetSubtab) {
        const validSubtabs = new Set(['tmdb-to-kp', 'kp-to-imdb']);
        if (!validSubtabs.has(targetSubtab)) return;

        this.activeIdentitySubtab = targetSubtab;
        document.querySelectorAll('.admin-subtab-btn').forEach(btn => {
            const isActive = btn.dataset.subtab === targetSubtab;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
        });

        const tabTmdbToKp = document.getElementById('subtab-tmdb-to-kp');
        const tabKpToImdb = document.getElementById('subtab-kp-to-imdb');
        if (tabTmdbToKp) tabTmdbToKp.hidden = targetSubtab !== 'tmdb-to-kp';
        if (tabKpToImdb) tabKpToImdb.hidden = targetSubtab !== 'kp-to-imdb';

        document.querySelectorAll('[data-identity-subtab]').forEach(btn => {
            const isActive = btn.dataset.identitySubtab === targetSubtab;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-current', isActive ? 'true' : 'false');
        });
    }

    renderIdentityWorkspaceSummary(counts, pendingImdb) {
        const tmdbCount = Number(counts?.all) || 0;
        const criticalTmdbCount = Number(counts?.critical) || 0;
        const imdbCount = Array.isArray(pendingImdb) ? pendingImdb.length : 0;
        const total = tmdbCount + imdbCount;

        const tmdbCountEl = document.getElementById('identityTmdbSummaryCount');
        const imdbCountEl = document.getElementById('identityImdbSummaryCount');
        const tmdbStateEl = document.getElementById('identityTmdbSummaryState');
        const imdbStateEl = document.getElementById('identityImdbSummaryState');
        const summaryEl = document.getElementById('identityWorkspaceSummary');
        const startBtn = document.getElementById('startIdentityWorkflowBtn');

        if (tmdbCountEl) tmdbCountEl.textContent = tmdbCount;
        if (imdbCountEl) imdbCountEl.textContent = imdbCount;
        if (tmdbStateEl) {
            tmdbStateEl.textContent = tmdbCount > 0
                ? (criticalTmdbCount > 0 ? `${criticalTmdbCount} влияют на Главную` : 'Требуют проверки для Главной')
                : 'Нет активных задач';
        }
        if (imdbStateEl) {
            imdbStateEl.textContent = imdbCount > 0
                ? 'Не хватает IMDb ID для оценок'
                : 'Нет активных задач';
        }

        let recommendedSubtab = null;
        let summary = 'Активных задач нет.';
        let actionLabel = 'Открыть задачи';

        if (tmdbCount === 0 && imdbCount > 0) {
            recommendedSubtab = 'kp-to-imdb';
            summary = `${imdbCount} ${this.pluralizeTask(imdbCount)} ждут IMDb ID для оценок.`;
            actionLabel = `Открыть ${imdbCount} ${this.pluralizeTask(imdbCount)}`;
        } else if (tmdbCount > 0 && imdbCount === 0) {
            recommendedSubtab = 'tmdb-to-kp';
            summary = criticalTmdbCount > 0
                ? `${criticalTmdbCount} ${this.pluralizeTask(criticalTmdbCount)} влияют на выдачу Главной.`
                : `${tmdbCount} ${this.pluralizeTask(tmdbCount)} ждут связи с Кинопоиском.`;
            actionLabel = `Открыть ${tmdbCount} ${this.pluralizeTask(tmdbCount)}`;
        } else if (tmdbCount > 0 && imdbCount > 0) {
            recommendedSubtab = criticalTmdbCount > 0 ? 'tmdb-to-kp' : 'kp-to-imdb';
            summary = `${total} ${this.pluralizeTask(total)} в двух очередях. Начните с ${recommendedSubtab === 'tmdb-to-kp' ? 'Главной' : 'оценок'}.`;
            const suggestedCount = recommendedSubtab === 'tmdb-to-kp' ? tmdbCount : imdbCount;
            actionLabel = `Открыть ${suggestedCount} ${this.pluralizeTask(suggestedCount)}`;
        }

        if (summaryEl) summaryEl.textContent = summary;
        if (startBtn) {
            startBtn.hidden = total === 0;
            startBtn.dataset.subtab = recommendedSubtab || '';
            startBtn.textContent = actionLabel;
        }

        if (!this.hasAutoSelectedIdentitySubtab) {
            if (recommendedSubtab) this.switchIdentitySubtab(recommendedSubtab);
            this.hasAutoSelectedIdentitySubtab = true;
        }
    }

    pluralizeTask(count) {
        const value = Math.abs(Number(count)) % 100;
        const remainder = value % 10;
        if (value > 10 && value < 20) return 'задач';
        if (remainder > 1 && remainder < 5) return 'задачи';
        if (remainder === 1) return 'задача';
        return 'задач';
    }

    async verifyQuickManualMapping({ form, mediaType, tmdbId, kpId, submittedTitle }) {
        const preview = document.getElementById('quickManualMappingPreview');
        const submitBtn = form?.querySelector('button[type="submit"]');
        if (!preview || !submitBtn) return;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Проверяем...';
        preview.innerHTML = '<div class="identity-verification-message">Загружаем карточку Кинопоиска для проверки.</div>';

        try {
            if (!this.idMappingService) this.idMappingService = new IdMappingService();
            if (!this.kinopoiskService) this.kinopoiskService = new KinopoiskService();

            const kpMovie = await this.kinopoiskService.getMovieById(kpId);
            const resolvedKpId = Number(kpMovie?.kinopoiskId || kpMovie?.id);
            if (!kpMovie || !Number.isInteger(resolvedKpId) || resolvedKpId <= 0) {
                throw new Error('Фильм или сериал с таким ID не найден на Кинопоиске');
            }

            const kpType = kpMovie.type || '';
            const isCompatible = this.idMappingService.isCompatibleType(mediaType, kpType, kpMovie);
            const kpYear = Number(kpMovie.year) || null;
            const candidateTitle = kpMovie.name || kpMovie.alternativeName || `Кинопоиск #${resolvedKpId}`;
            const posterUrl = kpMovie.posterUrl || (typeof kpMovie.poster === 'string' ? kpMovie.poster : kpMovie.poster?.url) || '';
            const sourceTitle = submittedTitle || `TMDB #${tmdbId}`;
            const compatibilityText = isCompatible
                ? `Типы совместимы: ${mediaType} и ${kpType || 'не указан'}.`
                : `Типы не совпадают: TMDB ${mediaType}, Кинопоиск ${kpType || 'не указан'}.`;
            const yearText = kpYear ? `Год в Кинопоиске: ${kpYear}.` : 'Год в Кинопоиске не указан.';

            preview.innerHTML = `
                <article class="identity-verification-card" aria-label="Проверка кандидата Кинопоиска">
                    <div class="identity-verification-heading">
                        <div>
                            <p class="identity-workspace-eyebrow">Проверка кандидата</p>
                            <h4>${this.escapeHtml(candidateTitle)}</h4>
                        </div>
                        <a class="tmdb-link-btn" href="https://www.kinopoisk.ru/film/${resolvedKpId}/" target="_blank" rel="noopener noreferrer">Открыть Кинопоиск</a>
                    </div>
                    <div class="identity-verification-content">
                        ${posterUrl ? `<img class="identity-verification-poster" src="${this.escapeHtml(posterUrl)}" alt="Постер: ${this.escapeHtml(candidateTitle)}">` : ''}
                        <dl class="identity-verification-details">
                            <div><dt>Связь</dt><dd>${this.escapeHtml(sourceTitle)} · TMDB ${mediaType}:${tmdbId}</dd></div>
                            <div><dt>Кандидат</dt><dd>Кинопоиск ${resolvedKpId}${kpYear ? ` · ${kpYear}` : ''}</dd></div>
                            <div><dt>Проверка типа</dt><dd class="${isCompatible ? 'identity-verification-pass' : 'identity-verification-fail'}">${this.escapeHtml(compatibilityText)}</dd></div>
                            <div><dt>Данные</dt><dd>${this.escapeHtml(yearText)}</dd></div>
                        </dl>
                    </div>
                    <div class="identity-verification-actions">
                        ${isCompatible
                            ? '<button class="tmdb-btn-bind identity-confirm-manual-mapping" type="button">Подтвердить связь</button>'
                            : '<p class="identity-verification-block">Подтверждение заблокировано: выберите совместимый тип медиа или другой ID Кинопоиска.</p>'}
                    </div>
                </article>
            `;

            const confirmBtn = preview.querySelector('.identity-confirm-manual-mapping');
            if (confirmBtn) {
                confirmBtn.addEventListener('click', async () => {
                    confirmBtn.disabled = true;
                    confirmBtn.textContent = 'Сохраняем...';
                    try {
                        await this.idMappingService.setManualMapping(mediaType, tmdbId, resolvedKpId, {
                            title: candidateTitle,
                            year: kpYear,
                            kpType
                        });
                        this.showSuccessMessage(`Связь сохранена: TMDB ${mediaType}:${tmdbId} → Кинопоиск ${resolvedKpId}`);
                        form.reset();
                        preview.innerHTML = '';
                        await this.loadTmdbFallbacks();
                    } catch (error) {
                        console.error('Error saving verified manual mapping:', error);
                        this.showError(`Ошибка сохранения связи: ${error.message}`);
                        confirmBtn.disabled = false;
                        confirmBtn.textContent = 'Подтвердить связь';
                    }
                });
            }
        } catch (error) {
            console.error('Error verifying quick manual mapping:', error);
            preview.innerHTML = `<div class="identity-verification-message identity-verification-message-error">Не удалось проверить кандидата: ${this.escapeHtml(error.message)}</div>`;
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Проверить кандидата';
        }
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
            this.pendingImdbItems = pendingImdb || [];

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

            this.renderIdentityWorkspaceSummary(counts, this.pendingImdbItems);
            this.applyQueueFiltersAndRender();
            this.renderManualMappingsList(manualMappings || []);
            this.renderImdbFallbacksList(this.pendingImdbItems);
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
