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
        // Set while a deletion is being confirmed or runs, so a second click waits.
        this.userToDelete = null;
        this.bulkDeleteInFlight = false;
        
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
            
            if (!isAdmin && this.adminCheckFailed) {
                this.showAccessError('Не удалось проверить права администратора: Firebase не ответил. Проверьте соединение и повторите.', { retry: true });
                return;
            }
            if (!isAdmin) {
                this.showAccessError('Доступ запрещён. Для просмотра этой страницы требуются права администратора.');
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

            // The shell opens at once; each section loads its own data the first time it is shown
            // (AdminWorkspace.js), so no section waits for another one.
            this.hideLoading();
            this.initWorkspace();
            console.timeEnd('[Admin Perf] Total Init');
        } catch (error) {
            console.error('Error initializing admin panel:', error);
            this.showAccessError('Не удалось открыть админ-панель. Повторите попытку.');
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
        this.adminCheckFailed = false;
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
                // A read that never settles would keep the loader forever; give up after 15 s.
                userProfile = await this.withTimeout(
                    userService.getUserProfile(this.currentUser.uid, { throwOnError: true }),
                    15000
                );
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
            // Not a refusal: the check itself failed, so the page offers to retry.
            this.adminCheckFailed = true;
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
            Utils.showToast('Не удалось загрузить пользователей. Повторите попытку.', 'error');
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
                    <td><div class="skeleton-text" style="width: 70px;"></div></td>
                    <td><div class="skeleton-text" style="width: 40px;"></div></td>
                    <td><div class="skeleton-text" style="width: 40px;"></div></td>
                    <td><div class="skeleton-text" style="width: 80px;"></div></td>
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
            this.hydrateUserCounts(this.users);
        } catch (error) {
            console.error('Error fetching users from DB:', error);
            if (!isBackground) {
                this.renderUsersError();
                Utils.showToast('Не удалось загрузить пользователей. Повторите попытку.', 'error');
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
                    <td colspan="5" class="admin-table-empty">
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
        const status = user.approvalStatus || 'approved';
        const name = user.displayName || 'Пользователь без имени';
        row.dataset.userId = user.id;
        row.classList.add('admin-user-row');
        row.classList.toggle('is-selected', this.selectedUserId === user.id);

        row.innerHTML = `
            <td>
                <div class="user-info">
                    <img src="${this.escapeHtml(user.photoURL || IconUtils.getCurrentThemeIconPath(48))}"
                         alt=""
                         class="user-avatar"
                         loading="lazy">
                    <div class="user-info-text">
                        <button class="user-row-open" type="button" data-user-id="${this.escapeHtml(user.id)}" aria-controls="userDetailPanel">
                            <span class="user-name">${this.escapeHtml(name)}</span>
                            ${user.isAdmin ? '<span class="admin-badge">Админ</span>' : ''}
                            ${isCurrentUser ? '<span class="you-badge">Вы</span>' : ''}
                        </button>
                        <div class="user-email">${this.escapeHtml(user.email || 'Нет email')}</div>
                    </div>
                </div>
            </td>
            <td>${this.renderUserStatusBadge(status)}</td>
            <td><div class="user-stats" data-user-count="ratings">${this.formatUserCount(user.ratingsCount)}</div></td>
            <td><div class="user-stats" data-user-count="collections">${this.formatUserCount(user.collectionCount)}</div></td>
            <td class="user-joined">${this.formatUserJoinDate(user)}</td>
        `;

        row.addEventListener('click', (event) => {
            if (event.target.closest('a')) return;
            this.selectUser(user.id);
        });

        const avatar = row.querySelector('.user-avatar');
        if (avatar) {
            avatar.addEventListener('error', () => {
                avatar.src = IconUtils.getCurrentThemeIconPath(48);
            });
        }

        return row;
    }

    renderUserStatusBadge(status) {
        if (status === 'approved') return '<span class="status-badge status-badge-approved">Одобрен</span>';
        if (status === 'pending') return '<span class="status-badge status-badge-pending">Ожидает</span>';
        if (status === 'rejected') return '<span class="status-badge status-badge-rejected">Заблокирован</span>';
        return `<span class="status-badge status-badge-approved">${this.escapeHtml(status)}</span>`;
    }

    formatUserCount(value) {
        return Number.isFinite(value) ? value.toLocaleString('ru-RU') : '<span class="user-stats-pending" aria-label="Загрузка">…</span>';
    }

    formatUserJoinDate(user) {
        const formatted = this.formatAdminDate(user?.createdAt);
        return formatted === '—' ? 'Неизвестно' : formatted;
    }

    // Fills the counters of a page that has just been drawn, a few users at a time.
    async hydrateUserCounts(users) {
        const pending = (users || []).filter((user) => !Number.isFinite(user.ratingsCount) || !Number.isFinite(user.collectionCount));
        if (!pending.length || !this.adminService?.getUserActivityCounts) return;
        const token = Symbol('userCounts');
        this.userCountsToken = token;
        const batchSize = 5;
        for (let index = 0; index < pending.length; index += batchSize) {
            const batch = pending.slice(index, index + batchSize);
            const results = await Promise.all(batch.map((user) => this.adminService.getUserActivityCounts(user.id)));
            if (this.userCountsToken !== token) return;
            batch.forEach((user, position) => {
                const counts = results[position] || {};
                if (Number.isFinite(counts.ratingsCount)) user.ratingsCount = counts.ratingsCount;
                if (Number.isFinite(counts.collectionCount)) user.collectionCount = counts.collectionCount;
                const row = document.querySelector(`#usersTableBody tr[data-user-id="${CSS.escape(user.id)}"]`);
                if (row) {
                    const ratingsCell = row.querySelector('[data-user-count="ratings"]');
                    const collectionsCell = row.querySelector('[data-user-count="collections"]');
                    if (ratingsCell) ratingsCell.innerHTML = Number.isFinite(user.ratingsCount) ? this.formatUserCount(user.ratingsCount) : '—';
                    if (collectionsCell) collectionsCell.innerHTML = Number.isFinite(user.collectionCount) ? this.formatUserCount(user.collectionCount) : '—';
                }
                if (this.selectedUserId === user.id) this.renderUserDetail(user);
            });
        }
        if (this.userPagination.currentPage === 1 && !this.userSearchTerm) {
            this.cacheService?.saveUsersToCache(this.users);
        }
    }

    selectUser(userId) {
        this.selectedUserId = userId;
        document.querySelectorAll('#usersTableBody tr[data-user-id]').forEach((row) => {
            row.classList.toggle('is-selected', row.dataset.userId === userId);
        });
        const user = this.users.find((candidate) => candidate.id === userId)
            || this.pendingUsers.find((candidate) => candidate.id === userId);
        this.renderUserDetail(user || null);
        // In one column the card sits under the table.
        if (user && window.matchMedia?.('(max-width: 1024px)').matches) {
            document.getElementById('userDetailPanel')?.scrollIntoView({ block: 'start' });
        }
    }

    renderUserDetail(user) {
        const panel = document.getElementById('userDetailPanel');
        if (!panel) return;
        if (!user) {
            panel.innerHTML = '<p class="admin-user-panel-empty">Выберите пользователя в таблице, чтобы увидеть его карточку и действия.</p>';
            return;
        }

        const isCurrentUser = this.currentUser && user.id === this.currentUser.uid;
        const status = user.approvalStatus || 'approved';
        const name = user.displayName || 'Пользователь без имени';
        const statusButtons = [];
        if (!isCurrentUser) {
            if (status === 'approved') {
                statusButtons.push('<button class="btn-status-toggle btn-reject-sm" data-action="reject" type="button">Заблокировать</button>');
                statusButtons.push('<button class="btn-status-toggle" data-action="pending" type="button">В ожидание</button>');
            } else if (status === 'pending') {
                statusButtons.push('<button class="btn-approve-sm" data-action="approve" type="button">Одобрить</button>');
                statusButtons.push('<button class="btn-reject-sm" data-action="reject" type="button">Отклонить</button>');
            } else if (status === 'rejected') {
                statusButtons.push('<button class="btn-approve-sm" data-action="approve" type="button">Разблокировать</button>');
                statusButtons.push('<button class="btn-status-toggle" data-action="pending" type="button">В ожидание</button>');
            }
        }
        const profileUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
            ? chrome.runtime.getURL(`src/pages/profile/profile.html?userId=${encodeURIComponent(user.id)}`)
            : `../profile/profile.html?userId=${encodeURIComponent(user.id)}`;
        const stat = (value, label) => `
            <div class="admin-user-stat">
                <strong>${Number.isFinite(value) ? value.toLocaleString('ru-RU') : '—'}</strong>
                <span>${label}</span>
            </div>`;

        panel.innerHTML = `
            <div class="admin-user-head">
                <img class="user-avatar user-avatar--large" src="${this.escapeHtml(user.photoURL || IconUtils.getCurrentThemeIconPath(48))}" alt="">
                <div class="admin-user-head-text">
                    <h3>${this.escapeHtml(name)}</h3>
                    <span>${this.escapeHtml(user.email || 'Нет email')}</span>
                </div>
                ${this.renderUserStatusBadge(status)}
            </div>
            ${status === 'pending' ? '<p class="admin-user-notice">Заявка ждёт решения. Пока аккаунт не одобрен, его оценки и комментарии не видны другим.</p>' : ''}
            <div class="admin-user-stats">
                ${stat(user.ratingsCount, 'оценок')}
                ${stat(user.collectionCount, 'коллекций')}
            </div>
            <dl class="admin-user-facts">
                <div><dt>С нами с</dt><dd>${this.formatUserJoinDate(user)}</dd></div>
                <div><dt>Роль</dt><dd>${user.isAdmin ? 'Администратор' : 'Участник'}${isCurrentUser ? ' · это вы' : ''}</dd></div>
                <div><dt>UID</dt><dd><code class="admin-user-uid">${this.escapeHtml(user.id)}</code></dd></div>
            </dl>
            <div class="admin-user-actions">
                ${statusButtons.join('')}
                <a class="btn-status-toggle admin-user-profile-link" href="${this.escapeHtml(profileUrl)}">Открыть профиль</a>
                <button class="btn-delete" type="button" ${isCurrentUser ? 'disabled title="Нельзя удалить собственный аккаунт"' : ''}>Удалить</button>
            </div>
        `;

        panel.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', () => this.handleUserApprovalAction(user.id, button.dataset.action, button));
        });
        const deleteBtn = panel.querySelector('.btn-delete');
        if (deleteBtn && !isCurrentUser) {
            deleteBtn.addEventListener('click', () => this.showDeleteConfirmation(user, deleteBtn));
        }
        const avatar = panel.querySelector('.user-avatar');
        avatar?.addEventListener('error', () => { avatar.src = IconUtils.getCurrentThemeIconPath(48); });
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
                if (this.selectedUserId === userId) this.renderUserDetail(targetUser || null);
                await this.loadApprovals();
                const statusLabels = { approved: 'одобрен', rejected: 'заблокирован / отклонён', pending: 'переведён в ожидание' };
                Utils.showToast(`Пользователь ${targetUser?.displayName || userId} ${statusLabels[targetStatus] || targetStatus}`, 'success');
            }
        } catch (err) {
            console.error('Error updating user approval status:', err);
            Utils.showToast(`Ошибка обновления статуса: ${err.message}`, 'error');
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
                navBadge.textContent = count > 0 ? String(count) : '';
                navBadge.dataset.tone = count > 0 ? 'warning' : '';
                navBadge.classList.remove('admin-nav-count-warning');
            }
            if (headerBadge) {
                headerBadge.textContent = this.formatRussianCount(count, 'заявка', 'заявки', 'заявок');
            }
            const pendingTabCount = document.getElementById('userStatusCountPending');
            if (pendingTabCount) pendingTabCount.textContent = count > 0 ? String(count) : '';
            this.approvalsLoadFailed = false;

            this.renderApprovalsTable();
            this.updateBatchApproveButton();
            this.renderOverview?.();
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
            this.approvalsLoadFailed = true;
            this.renderApprovalsError();
            this.renderOverview?.();
            Utils.showToast('Не удалось загрузить заявки. Повторите попытку.', 'error');
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
                this.usageLoadFailed = false;
                this.renderFirestoreUsage(usage);
                return usage;
            })
            .catch((error) => {
                console.error('Error loading Firestore usage:', error);
                this.usageLoadFailed = true;
                this.renderFirestoreUsageError();
                this.renderOverview?.();
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
            const reads = usage?.reads;
            const readsKnown = reads?.available === true && Number.isFinite(reads.percent);
            navStatus.textContent = readsKnown ? `${Math.round(reads.percent)}%` : '';
            navStatus.dataset.tone = readsKnown && (reads.status === 'warning' || reads.status === 'critical') ? 'warning' : '';
            navStatus.classList.remove('admin-nav-count-warning');
        }
        this.renderOverview?.();

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
        this.renderFirestoreHourly(usage?.reads);
    }

    // Reads per hour of the Pacific day, local times: shows when a spike happened.
    renderFirestoreHourly(reads) {
        const card = document.getElementById('firestoreUsageHourlyCard');
        const list = document.getElementById('firestoreUsageHourly');
        const meta = document.getElementById('firestoreUsageHourlyMeta');
        const hours = Array.isArray(reads?.hourly) ? reads.hourly : [];
        if (!card || !list) return;
        card.hidden = hours.length === 0;
        if (!hours.length) return;

        const peak = Math.max(1, ...hours.map((hour) => hour.count));
        const peakHour = hours.reduce((best, hour) => (hour.count > best.count ? hour : best), hours[0]);
        const timeOf = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        if (meta) meta.textContent = `Больше всего в ${timeOf(peakHour.startAt)}: ${this.formatFirestoreCount(peakHour.count)}`;

        list.replaceChildren(...hours.map((hour) => {
            const item = document.createElement('li');
            item.className = 'firestore-hourly-bar';
            const label = `${timeOf(hour.startAt)} — ${this.formatFirestoreCount(hour.count)}`;
            item.title = label;
            item.setAttribute('aria-label', label);
            const fill = document.createElement('span');
            fill.className = 'firestore-hourly-fill';
            fill.style.height = `${Math.max(hour.count > 0 ? 3 : 0, Math.round((hour.count / peak) * 100))}%`;
            const time = document.createElement('span');
            time.className = 'firestore-hourly-time';
            time.textContent = timeOf(hour.startAt).slice(0, 2);
            time.setAttribute('aria-hidden', 'true');
            item.append(fill, time);
            return item;
        }));
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
                this.providerKeysFetched = true;
                this.providerKeysLoadFailed = false;
                this.renderProviderKeys(this.providerKeys);
                return this.providerKeys;
            })
            .catch((error) => {
                console.error('Error loading provider keys:', error?.code || 'unknown error');
                this.providerKeysLoadFailed = true;
                this.renderProviderKeysError(error);
                this.renderOverview?.();
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
            const troubled = this.getProviderKeyProblems?.(keys).length || 0;
            count.textContent = troubled > 0 ? String(troubled) : String(keys.length);
            count.dataset.tone = troubled > 0 ? 'warning' : '';
            count.classList.remove('admin-nav-count-warning');
        }
        this.renderOverview?.();

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
            Utils.showToast(successMessage, 'success');
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
        if (!(await ConfirmDialog.confirm({ title: `Удалить реакцию ${reaction.emoji} «${reaction.label}»?`, message: 'Она исчезнет у новых клиентов, а старые записи пользователей сохранятся.', confirmLabel: 'Удалить', danger: true }))) return;

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
            await this.confirmProviderKeyRevoke(keyId);
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
            Utils.showToast(action === 'quota' ? 'Квота обновлена' : 'Состояние ключа обновлено', 'success');
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
            Utils.showToast('API-ключ добавлен и проверен', 'success');
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

    async confirmProviderKeyRevoke(keyId) {
        const key = this.providerKeys.find((item) => item.id === keyId);
        if (!key || this.providerKeyActionRequest) return;
        this.providerKeyActionRequest = true;
        try {
            const confirmed = await ConfirmDialog.confirm({
                title: 'Отозвать ключ?',
                message: `Ключ «${key.label || 'Без названия'}» (${key.provider || 'провайдер'}, ${key.maskedValue || 'маска недоступна'}) будет отключён и удалён из Secret Manager. Это действие нельзя отменить.`,
                confirmLabel: 'Отозвать ключ',
                danger: true
            });
            if (!confirmed) return;
            this.setProviderKeyRowBusy(keyId, true);
            await this.adminService.revokeProviderKey(keyId);
            await this.loadProviderKeys(true);
            Utils.showToast('API-ключ отозван', 'success');
        } catch (error) {
            console.error('Provider key revoke failed:', error?.code || 'unknown error');
            this.renderProviderKeysError(error);
        } finally {
            this.providerKeyActionRequest = false;
            this.setProviderKeyRowBusy(keyId, false);
        }
    }

    setProviderKeyRowBusy(keyId, busy) {
        document.querySelectorAll('[data-provider-key-action]').forEach((button) => {
            if (button.dataset.providerKeyId !== keyId) return;
            button.disabled = busy;
            button.toggleAttribute('aria-busy', busy);
        });
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
        return `${count} ${Utils.selectRussianPlural(count, [one, few, many])}`;
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
                deleteBtn.addEventListener('click', () => this.showDeleteConfirmation(user, deleteBtn));
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
                Utils.showToast(`Одобрено заявок: ${userIds.length}`, 'success');
                await this.loadApprovals();
                await this.fetchUsersFromDb();
            }
        } catch (error) {
            console.error('Error in batch approve:', error);
            Utils.showToast(`Ошибка пакетного одобрения: ${error.message}`, 'error');
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
            5,
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

    async showDeleteConfirmation(user, triggerButton = null) {
        if (!user || this.userToDelete) return;
        this.userToDelete = user;
        try {
            let preview;
            try {
                preview = await this.adminService.getUserDeletionPreview(user.id);
            } catch (error) {
                console.error('Error getting deletion preview:', error);
                Utils.showToast('Не удалось получить данные пользователя. Повторите попытку.', 'error');
                return;
            }

            const confirmed = await ConfirmDialog.confirm({
                title: 'Удалить пользователя?',
                message: [
                    'Пользователь будет удалён навсегда:',
                    `Имя: ${preview.user.displayName || 'Пользователь без имени'}`,
                    `Email: ${preview.user.email || 'Нет email'}`,
                    '',
                    'Будут удалены:',
                    `• ${this.formatRussianCount(preview.ratingsCount, 'оценка', 'оценки', 'оценок')}`,
                    `• ${this.formatRussianCount(preview.collectionCount, 'элемент коллекции', 'элемента коллекции', 'элементов коллекции')}`,
                    '• Профиль пользователя и связанные данные',
                    '',
                    'Действие необратимо. Все данные будут удалены.'
                ].join('\n'),
                confirmLabel: 'Удалить пользователя',
                danger: true
            });
            if (!confirmed) return;

            this.setDeleteButtonBusy(triggerButton, true);
            try {
                await this.adminService.deleteUser(user.id, this.currentUser.uid);
            } catch (error) {
                console.error('Error deleting user:', error);
                Utils.showToast('Не удалось удалить пользователя. Повторите попытку.', 'error');
                return;
            }
            Utils.showToast(`Пользователь «${user.displayName || 'без имени'}» удалён`, 'success');
            if (this.selectedUserId === user.id) this.selectUser(null);
            // The cached page still lists the deleted account.
            this.cacheService?.clearUsersCache();
            await this.loadUsers();
        } finally {
            this.setDeleteButtonBusy(triggerButton, false);
            this.userToDelete = null;
        }
    }

    setDeleteButtonBusy(button, busy) {
        if (!button?.isConnected) return;
        if (busy) {
            button.dataset.idleLabel = button.textContent;
            button.textContent = 'Удаление...';
        } else if (button.dataset.idleLabel) {
            button.textContent = button.dataset.idleLabel;
            delete button.dataset.idleLabel;
        }
        button.disabled = busy;
        button.toggleAttribute('aria-busy', busy);
    }

    setupEventListeners() {
        // Listen for auth state changes (e.g. user logged out from popup or another tab)
        window.addEventListener('authStateChanged', async (e) => {
            const user = e.detail?.user;
            if (!user) {
                this.currentUser = null;
                this.setAdminAccessState(false);
                this.showAccessError('Сессия завершена. Для доступа к панели администратора необходимо войти в систему.');
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
                    this.reloadWorkspace();
                } else {
                    this.showAccessError('Доступ запрещен. У текущего аккаунта нет прав администратора.');
                }
            }
        });

        // Sidebar Navigation
        const sidebarLinks = document.querySelectorAll('.sidebar-link');
        const settingsPanes = document.querySelectorAll('.settings-pane');

        sidebarLinks.forEach(link => {
            link.addEventListener('click', () => this.showSection(link.dataset.target));
        });
        this.settingsPanes = settingsPanes;

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

        // User status tabs
        document.querySelectorAll('#userStatusTabs [data-user-status]').forEach((tab) => {
            tab.addEventListener('click', () => {
                this.userStatusFilter = tab.dataset.userStatus;
                document.querySelectorAll('#userStatusTabs [data-user-status]').forEach((other) => {
                    const isActive = other === tab;
                    other.classList.toggle('is-active', isActive);
                    other.setAttribute('aria-pressed', String(isActive));
                });
                this.applyUserFilters();
            });
        });

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

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAddProviderKeyModal();
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

    // The page-level block for states that replace the panel (no access, failed start).
    // Action results go through the shared Utils.showToast.
    showAccessError(message, { retry = false } = {}) {
        const errorDiv = document.getElementById('adminError');
        const errorText = document.getElementById('errorText');
        
        if (errorDiv && errorText) {
            errorText.textContent = message;
            errorDiv.style.display = 'block';
            errorDiv.setAttribute('aria-hidden', 'false');
            errorDiv.querySelector('.admin-error-retry')?.remove();
            if (retry) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'button-refresh admin-error-retry';
                button.textContent = 'Повторить';
                button.addEventListener('click', () => window.location.reload());
                errorDiv.appendChild(button);
            }
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
            const updateTime = new Date().toLocaleTimeString('ru-RU');
            const ageDiv = document.getElementById('dataAge');
            if (ageDiv) ageDiv.textContent = `Обновлено: ${updateTime}`;
            
        } catch (error) {
            console.error('Error loading movies:', error);
            this.renderMoviesError();
            Utils.showToast('Не удалось загрузить фильмы. Повторите попытку.', 'error');
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
            ratingDate = this.formatAdminDate(latestRating.createdAt);
        }

        const movieTitle = movie.name || 'Фильм без названия';
        const movieYear = movie.year ? ` (${movie.year})` : '';
        const truncatedComment = ratingComment.length > 50 ? ratingComment.substring(0, 50) + '...' : ratingComment;
        const reviewIndicator = hasRating && latestRating?.hasReview
            ? `<span class="admin-review-indicator" title="Рецензия: ${latestRating.reviewLength || 0} символов">Есть рецензия</span>`
            : '';

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
                    ${reviewIndicator}
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
            Utils.showToast('Нет подключения к интернету', 'warning');
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
            
            Utils.showToast('Данные обновлены', 'success');
        } catch (error) {
            console.error('Error refreshing data:', error);
            Utils.showToast(`Ошибка обновления: ${error.message}`, 'error');
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
            btn.dataset.idleHtml = btn.innerHTML;
            btn.textContent = 'Очистка…';
        }

        try {
            // Update local cache only
            this.cacheService.removeMoviesFromCache(movieIds);
            
            Utils.showToast(`Кэш очищен для ${movieIds.length} фильмов`, 'success');
            this.selectedMovies.clear();
            this.updateSelectionUI();
            
            // Optionally refresh the view or just mark them as needing refresh?
            // Since we just cleared cache, the current view is technically "stale" but matches what was loaded.
            // Let's just update UI.
        } catch (error) {
            console.error('Bulk clear cache error:', error);
            Utils.showToast(`Ошибка: ${error.message}`, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                if (btn.dataset.idleHtml) btn.innerHTML = btn.dataset.idleHtml;
            }
        }
    }


    async bulkUpdateInfo() {
        const check = this.cacheService.checkWriteAccess();
        if (!check.canWrite) {
            Utils.showToast(check.reason, 'warning');
            return;
        }

        const movieIds = Array.from(this.selectedMovies);
        if (movieIds.length === 0) return;

        const btn = document.getElementById('bulkUpdateInfoBtn');
        if (btn) {
            btn.disabled = true;
            btn.dataset.idleHtml = btn.innerHTML;
        }

        try {
            const result = await this.adminService.bulkUpdateMoviesInfo(
                movieIds, 
                this.currentUser.uid,
                (current, total) => {
                    if (btn) {
                        btn.textContent = `Обновляем ${current} из ${total}`;
                    }
                }
            );

            Utils.showToast(`Обновлено ${result.updated} фильмов`, 'success');
            
            // Refresh to show updated data
            await this.forceRefresh();
        } catch (error) {
            console.error('Bulk update error:', error);
            Utils.showToast(`Ошибка: ${error.message}`, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                if (btn.dataset.idleHtml) btn.innerHTML = btn.dataset.idleHtml;
            }
        }
    }

    async showBulkDeleteConfirmation() {
        const count = this.selectedMovies.size;
        if (count === 0 || this.bulkDeleteInFlight) return;
        this.bulkDeleteInFlight = true;
        try {
            const confirmed = await ConfirmDialog.confirm({
                title: 'Подтверждение удаления',
                message: [
                    'Вы собираетесь удалить выбранные фильмы и их оценки:',
                    `${count} фильмов`,
                    '',
                    'Это действие:',
                    '• Удалит все оценки для выбранных фильмов',
                    '• Удалит фильмы из кэша',
                    '• Очистит локальный кэш',
                    '',
                    'Это действие необратимо.'
                ].join('\n'),
                confirmLabel: 'Удалить',
                danger: true
            });
            if (confirmed) await this.confirmBulkDelete();
        } finally {
            this.bulkDeleteInFlight = false;
        }
    }

    async confirmBulkDelete() {
        const check = this.cacheService.checkWriteAccess();
        if (!check.canWrite) {
            Utils.showToast(check.reason, 'warning');
            return;
        }

        const movieIds = Array.from(this.selectedMovies);
        if (movieIds.length === 0) return;

        const deleteBtn = document.getElementById('bulkDeleteBtn');
        this.setDeleteButtonBusy(deleteBtn, true);

        try {
            const result = await this.adminService.bulkDeleteMoviesAndRatings(movieIds, this.currentUser.uid);

            // Update local cache
            this.cacheService.removeMoviesFromCache(movieIds);

            // Remove from local arrays
            this.movies = this.movies.filter(m => !movieIds.includes(m.kinopoiskId));
            movieIds.forEach(id => this.ratingsMap.delete(id));

            this.selectedMovies.clear();
            this.applyMoviesFilters();

            Utils.showToast(`Удалено ${result.moviesDeleted} фильмов и ${result.ratingsDeleted} оценок`, 'success');
        } catch (error) {
            console.error('Bulk delete error:', error);
            Utils.showToast(`Ошибка удаления: ${error.message}`, 'error');
        } finally {
            this.setDeleteButtonBusy(deleteBtn, false);
            this.updateSelectionUI();
        }
    }

    async clearMovieCache(movieId, movieData) {
        if (!movieId) return;

        const movieTitle = movieData?.name || 'фильм без названия';

        if (!(await ConfirmDialog.confirm({ title: `Очистить кэш для фильма «${movieTitle}»?`, message: 'Все сохранённые данные этого фильма будут удалены из Firestore и localStorage.', confirmLabel: 'Очистить', danger: true }))) {
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
            Utils.showToast(`Кэш очищен: «${movieTitle}»`, 'success');

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

            Utils.showToast('Не удалось очистить кэш. Повторите попытку.', 'error');
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
        
        if (countSpan) countSpan.textContent = this.formatRussianCount(reports.length, 'репорт', 'репорта', 'репортов');
        if (pendingCountBadge) pendingCountBadge.textContent = pending.length;
        if (resolvedCountBadge) resolvedCountBadge.textContent = resolved.length;
        const navReports = document.getElementById('adminNavReportsCount');
        if (navReports) {
            navReports.textContent = pending.length > 0 ? String(pending.length) : '';
            navReports.dataset.tone = pending.length > 0 ? 'danger' : '';
        }
        this.pendingReports = pending;
        this.reportsLoaded = true;

        this.renderReportsList(pendingList, pending, true);
        this.renderReportsList(resolvedList, resolved, false);
        this.renderOverview?.();
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
                this.formatAdminDate(report.createdAt, true)
                : 'Недавно';
            
            let photoHtml = '';
            if (report.photoUrl) {
                photoHtml = `<img class="report-photo" src="${report.photoUrl}" alt="Прикрепленное фото" data-photo-url="${report.photoUrl}">`;
            }
            
            let actionHtml = '';
            if (isPending) {
                actionHtml = `<button class="btn-resolve" data-id="${report.id}">Решено</button>`;
            }
            actionHtml += `<button class="btn-report-delete" data-id="${report.id}" data-photo="${report.photoPath || ''}">Удалить</button>`;
            
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
                    (window.ConfirmDialog ? window.ConfirmDialog.alert({ message: 'Ошибка: ' + err.message }) : window.alert('Ошибка: ' + err.message));
                    e.target.disabled = false;
                    e.target.textContent = 'Решено';
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
                if (!(await ConfirmDialog.confirm({ title: 'Удалить репорт?', message: 'Репорт и приложенный скриншот будут удалены.', confirmLabel: 'Удалить', danger: true }))) return;
                const id = e.target.dataset.id;
                const photoPath = e.target.dataset.photo;
                try {
                    e.target.disabled = true;
                    e.target.textContent = 'Удаление...';
                    await firebaseManager.deleteReport(id, photoPath);
                } catch (err) {
                    console.error('Ошибка:', err);
                    (window.ConfirmDialog ? window.ConfirmDialog.alert({ message: 'Ошибка: ' + err.message }) : window.alert('Ошибка: ' + err.message));
                    e.target.disabled = false;
                    e.target.textContent = 'Удалить';
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
                if (!(await ConfirmDialog.confirm({ title: 'Очистить очередь TMDB?', message: 'Локальная очередь несмаппленных тайтлов TMDB будет очищена.', confirmLabel: 'Очистить', danger: true }))) return;
                if (this.idMappingService) {
                    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                        await new Promise(res => chrome.storage.local.remove([this.idMappingService.UNMAPPED_QUEUE_KEY], res));
                    }
                    await this.loadTmdbFallbacks();
                    Utils.showToast('Очередь TMDB очищена', 'success');
                }
            });
        }

        // Auto-map entire queue button (Level 1 TMDB + Level 2 IMDb + Level 3 Metadata Search)
        const autoMapQueueBtn = document.getElementById('autoMapQueueBtn');
        if (autoMapQueueBtn) {
            autoMapQueueBtn.addEventListener('click', async () => {
                const unmappedItems = this.unmappedQueueData || [];
                if (unmappedItems.length === 0) {
                    Utils.showToast('Очередь пуста — нет тайтлов для сопоставления.', 'info');
                    return;
                }

                if (!(await ConfirmDialog.confirm({ title: 'Запустить авто-привязку?', message: `Авто-поиск и привязка для ${unmappedItems.length} тайтлов в очереди.`, confirmLabel: 'Запустить' }))) return;

                try {
                    autoMapQueueBtn.disabled = true;
                    autoMapQueueBtn.innerHTML = `
                        <svg data-icon="LOADING" class="spin-icon" style="animation: spin 1s linear infinite;" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 3A7 7 0 1 1 3 10"/></svg>
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

                    Utils.showToast(`Авто-сопоставление завершено! Найдено и привязано: ${resolvedCount}, отложено (нет на КП): ${notFoundCount}`, 'success');
                    await this.loadTmdbFallbacks();
                } catch (err) {
                    console.error('Error during auto-mapping queue:', err);
                    Utils.showToast(`Ошибка авто-сопоставления: ${err.message}`, 'error');
                } finally {
                    autoMapQueueBtn.disabled = false;
                    autoMapQueueBtn.innerHTML = `
                        <svg data-icon="BOLT" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 2.6L4.4 11H9.4L8.6 17.4L15.6 8.6H10.2Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M11 2.6L4.4 11H9.4L8.6 17.4L15.6 8.6H10.2Z"/></svg>
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
                    Utils.showToast('Очередь пуста — нет фильмов Кинопоиска без IMDb ID.', 'info');
                    return;
                }

                if (!(await ConfirmDialog.confirm({ title: 'Запустить поиск IMDb ID?', message: `Авто-поиск IMDb ID через TMDB для ${pendingItems.length} фильмов.`, confirmLabel: 'Запустить' }))) return;

                try {
                    autoMapKpToImdbBtn.disabled = true;
                    autoMapKpToImdbBtn.innerHTML = `
                        <svg data-icon="LOADING" class="spin-icon" style="animation: spin 1s linear infinite;" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 3A7 7 0 1 1 3 10"/></svg>
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

                    Utils.showToast(`Авто-поиск IMDb завершен! Найдено и сохранено: ${foundCount} из ${pendingItems.length}`, 'success');
                    await this.loadTmdbFallbacks();
                } catch (err) {
                    console.error('Error during auto-mapping IMDb queue:', err);
                    Utils.showToast(`Ошибка авто-поиска IMDb: ${err.message}`, 'error');
                } finally {
                    autoMapKpToImdbBtn.disabled = false;
                    autoMapKpToImdbBtn.innerHTML = `
                        <svg data-icon="BOLT" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 2.6L4.4 11H9.4L8.6 17.4L15.6 8.6H10.2Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M11 2.6L4.4 11H9.4L8.6 17.4L15.6 8.6H10.2Z"/></svg>
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
                    Utils.showToast('Файл экспорта успешно скачан', 'success');
                } catch (err) {
                    console.error('Export error:', err);
                    Utils.showToast(`Ошибка экспорта: ${err.message}`, 'error');
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
                    Utils.showToast(`Не удалось подготовить публикацию: ${error.message}`, 'error');
                    return;
                }
                if (preview.total === 0) {
                    Utils.showToast('Локальных связей для публикации нет.', 'info');
                    return;
                }
                const invalidHint = preview.invalid > 0 ? ` Некорректных записей: ${preview.invalid}.` : '';
                if (!(await ConfirmDialog.confirm({ title: `Опубликовать ${preview.total} ручных связей?`, message: `Локальные ручные связи попадут в общую базу. Конфликтующие записи не будут перезаписаны.${invalidHint}`, confirmLabel: 'Опубликовать' }))) return;

                publishManualMappingsBtn.disabled = true;
                publishManualMappingsBtn.textContent = 'Публикация...';
                try {
                    const result = await this.idMappingService.publishLocalManualMappings();
                    const conflictText = result.conflicts.length > 0 ? ` Конфликтов: ${result.conflicts.length}.` : '';
                    const invalidText = result.invalid.length > 0 ? ` Некорректных: ${result.invalid.length}.` : '';
                    Utils.showToast(`Проверено: ${result.total}; опубликовано: ${result.published}; уже общие: ${result.alreadyShared}.${conflictText}${invalidText}`, 'success');
                    await this.loadTmdbFallbacks();
                } catch (error) {
                    console.error('Error publishing local manual mappings:', error);
                    Utils.showToast(`Не удалось опубликовать связи: ${error.message}`, 'error');
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
                        Utils.showToast(`Импортировано: ${res.imported}. Ошибок: ${res.errors.length}`, 'warning');
                        console.warn('Import warnings/errors:', res.errors);
                    } else {
                        Utils.showToast(`Успешно импортировано привязок: ${res.imported}`, 'success');
                    }
                    importFile.value = '';
                    await this.loadTmdbFallbacks();
                } catch (err) {
                    console.error('Import error:', err);
                    Utils.showToast(`Ошибка импорта: ${err.message}`, 'error');
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
                    Utils.showToast('Пожалуйста, укажите корректный числовой TMDB ID или ссылку', 'warning');
                    return;
                }
                if (!kpId) {
                    Utils.showToast('Пожалуйста, укажите корректный числовой Kinopoisk ID или ссылку', 'warning');
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

        // The queue loads with the overview or when «Проверка ID» opens (AdminWorkspace.js).
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
        return Utils.selectRussianPlural(count, ['задача', 'задачи', 'задач']);
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
                        Utils.showToast(`Связь сохранена: TMDB ${mediaType}:${tmdbId} → Кинопоиск ${resolvedKpId}`, 'success');
                        form.reset();
                        preview.innerHTML = '';
                        await this.loadTmdbFallbacks();
                    } catch (error) {
                        console.error('Error saving verified manual mapping:', error);
                        Utils.showToast(`Ошибка сохранения связи: ${error.message}`, 'error');
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
            if (totalCountBadge) totalCountBadge.textContent = `${totalTasks} ${this.pluralizeTask(totalTasks)}`;
            if (navTmdbCountBadge) {
                navTmdbCountBadge.textContent = totalTasks > 0 ? String(totalTasks) : '';
                navTmdbCountBadge.dataset.tone = totalTasks > 0 ? 'warning' : '';
            }
            this.identityCounts = { ...counts, imdb: pendingImdb?.length || 0, total: totalTasks };
            this.identityLoadFailed = false;
            this.renderOverview?.();

            this.renderIdentityWorkspaceSummary(counts, this.pendingImdbItems);
            this.applyQueueFiltersAndRender();
            this.renderManualMappingsList(manualMappings || []);
            this.renderImdbFallbacksList(this.pendingImdbItems);
        } catch (error) {
            console.error('Error loading TMDB fallbacks:', error);
            this.identityLoadFailed = true;
            this.renderOverview?.();
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

    // «Проверка ID»: the queue on the left, one title at a time on the right.
    // A link is saved only after the Kinopoisk card was inspected and the admin confirmed it.
    renderTmdbUnmappedList(unmappedItems) {
        const container = document.getElementById('tmdbUnmappedList');
        if (!container) return;
        const items = Array.isArray(unmappedItems) ? unmappedItems : [];
        this.identityQueueItems = items;

        if (!items.length) {
            const filterLabel = this.activeQueueFilter === 'snoozed' ? 'Отложенных тайтлов нет.' : 'В этой категории нечего проверять.';
            container.innerHTML = `<div class="identity-queue-empty">${filterLabel}</div>`;
            this.selectedIdentityKey = null;
            this.renderIdentityTask(null);
            return;
        }

        const sectionNames = { films: 'Фильмы', series: 'Сериалы', cartoons: 'Мультфильмы', anime: 'Аниме', featured: 'Витрина Главной' };
        container.replaceChildren(...items.map((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'identity-queue-item';
            button.dataset.key = item.key;
            const section = item.section || (item.mediaType === 'tv' ? 'series' : 'films');
            const poster = item.posterUrl
                ? `<img class="identity-queue-poster" src="${this.escapeHtml(item.posterUrl)}" alt="" loading="lazy">`
                : '<span class="identity-queue-poster identity-queue-poster--empty" aria-hidden="true"></span>';
            button.innerHTML = `
                ${poster}
                <span class="identity-queue-text">
                    <span class="identity-queue-title">${this.escapeHtml(item.title || item.originalTitle || `TMDB ${item.tmdbId}`)}</span>
                    <span class="identity-queue-meta">${item.year ? `${this.escapeHtml(String(item.year))} · ` : ''}${sectionNames[section] || this.escapeHtml(section)}</span>
                </span>
                ${item.priority === 'CRITICAL' ? '<span class="identity-queue-flag" title="Влияет на топ-12 Главной">Топ-12</span>' : ''}
            `;
            button.querySelector('img')?.addEventListener('error', (event) => {
                event.currentTarget.replaceWith(Object.assign(document.createElement('span'), { className: 'identity-queue-poster identity-queue-poster--empty' }));
            });
            button.addEventListener('click', () => this.selectIdentityTask(item.key, { focus: true }));
            return button;
        }));

        const stillListed = items.some((item) => item.key === this.selectedIdentityKey);
        const refocus = this.identityRefocus === true;
        this.identityRefocus = false;
        this.selectIdentityTask(stillListed ? this.selectedIdentityKey : items[0].key, { focus: refocus });
    }

    selectIdentityTask(key, { focus = false } = {}) {
        const items = this.identityQueueItems || [];
        const item = items.find((candidate) => candidate.key === key) || null;
        this.selectedIdentityKey = item ? item.key : null;
        document.querySelectorAll('#tmdbUnmappedList .identity-queue-item').forEach((button) => {
            const isActive = button.dataset.key === this.selectedIdentityKey;
            button.classList.toggle('is-active', isActive);
            if (isActive) button.setAttribute('aria-current', 'true');
            else button.removeAttribute('aria-current');
        });
        this.renderIdentityTask(item);
        if (item && focus) {
            document.getElementById('identityTaskKpInput')?.focus({ preventScroll: true });
            document.querySelector(`#tmdbUnmappedList .identity-queue-item[data-key="${CSS.escape(item.key)}"]`)?.scrollIntoView({ block: 'nearest' });
        }
    }

    advanceIdentityTask() {
        const items = this.identityQueueItems || [];
        const index = items.findIndex((item) => item.key === this.selectedIdentityKey);
        const next = items[index + 1] || items[0];
        // The queue reloads right after a decision; keep the keyboard in the next task.
        this.identityRefocus = true;
        if (next && next.key !== this.selectedIdentityKey) this.selectIdentityTask(next.key, { focus: true });
    }

    renderIdentityTask(item) {
        const panel = document.getElementById('tmdbTaskPanel');
        if (!panel) return;
        if (!item) {
            panel.innerHTML = '<p class="identity-task-empty">Очередь пуста. Новые тайтлы появятся, когда Главная встретит фильм без связи с Кинопоиском.</p>';
            return;
        }

        const items = this.identityQueueItems || [];
        const position = items.findIndex((candidate) => candidate.key === item.key) + 1;
        const sectionNames = { films: 'Фильмы', series: 'Сериалы', cartoons: 'Мультфильмы', anime: 'Аниме', featured: 'Витрина Главной' };
        const priorityNames = { CRITICAL: 'Топ-12 Главной', HIGH: 'Высокий приоритет', MEDIUM: 'Средний приоритет' };
        const section = item.section || (item.mediaType === 'tv' ? 'series' : 'films');
        const tags = [];
        if (priorityNames[item.priority]) tags.push(`<span class="identity-tag" data-tone="${item.priority === 'CRITICAL' ? 'warning' : 'neutral'}">${priorityNames[item.priority]}</span>`);
        tags.push(`<span class="identity-tag">${sectionNames[section] || this.escapeHtml(section)}</span>`);
        if (Number.isInteger(item.productRank) && item.productRank > 0) tags.push(`<span class="identity-tag" title="Позиция в витрине Главной">Витрина #${item.productRank}</span>`);
        if (Number.isInteger(item.tmdbRank) && item.tmdbRank > 0) tags.push(`<span class="identity-tag" title="Позиция в ответе TMDB">TMDB #${item.tmdbRank}</span>`);
        if (Number(item.popularity) > 50 || Number(item.voteCount) > 100) tags.push('<span class="identity-tag">Популярный</span>');
        if (item.timesSeen >= 2) tags.push(`<span class="identity-tag">Встречался ${item.timesSeen} раз</span>`);

        const title = item.title || item.originalTitle || `TMDB ${item.tmdbId}`;
        const tmdbUrl = `https://www.themoviedb.org/${item.mediaType === 'tv' ? 'tv' : 'movie'}/${encodeURIComponent(item.tmdbId)}`;
        const kpSearchUrl = `https://www.kinopoisk.ru/index.php?kp_query=${encodeURIComponent(item.title || item.originalTitle || '')}`;
        const poster = item.posterUrl
            ? `<img class="identity-task-poster" src="${this.escapeHtml(item.posterUrl)}" alt="">`
            : '<div class="identity-task-poster identity-task-poster--empty" aria-hidden="true">Нет постера</div>';
        const subtitle = [
            item.originalTitle && item.originalTitle !== item.title ? this.escapeHtml(item.originalTitle) : '',
            item.year ? this.escapeHtml(String(item.year)) : '',
            `TMDB ${this.escapeHtml(item.mediaType)}:${this.escapeHtml(String(item.tmdbId))}`
        ].filter(Boolean).join(' · ');

        panel.innerHTML = `
            <div class="identity-task-head">
                ${poster}
                <div class="identity-task-info">
                    <div class="identity-task-tags">${tags.join('')}</div>
                    <h4 class="identity-task-title">${this.escapeHtml(title)}</h4>
                    <p class="identity-task-sub">${subtitle}</p>
                    <div class="identity-task-links">
                        <a href="${tmdbUrl}" target="_blank" rel="noopener noreferrer">Карточка TMDB ↗</a>
                        <a href="${kpSearchUrl}" target="_blank" rel="noopener noreferrer">Искать на Кинопоиске ↗</a>
                    </div>
                </div>
            </div>
            <form class="identity-task-form" novalidate>
                <label class="identity-task-label" for="identityTaskKpInput">Kinopoisk ID или ссылка</label>
                <div class="identity-task-row">
                    <input type="text" id="identityTaskKpInput" class="admin-input tmdb-unmapped-kp-input" autocomplete="off" spellcheck="false" placeholder="например, 1143242">
                    <button class="btn-verify-kp btn-verify-action" type="submit">Проверить</button>
                    <button class="identity-task-find" type="button">Подобрать</button>
                </div>
                <p class="identity-task-hint">Enter проверяет карточку, затем «Подтвердить» сохраняет связь. «Подобрать» ищет на Кинопоиске по названию и тратит запрос из квоты.</p>
            </form>
            <div class="identity-candidates" hidden></div>
            <div class="tmdb-preview-container identity-task-preview" hidden></div>
            <div class="identity-task-footer">
                <button class="btn-snooze-kp btn-snooze-action" type="button" title="Отложить тайтл на 7 дней: страницы на Кинопоиске ещё нет">Нет страницы на КП</button>
                <button class="identity-task-next" type="button"${items.length < 2 ? ' disabled' : ''}>Следующий ›</button>
                <span class="identity-task-progress">${position} из ${items.length}</span>
            </div>
        `;

        panel.querySelector('.identity-task-poster')?.addEventListener('error', (event) => {
            event.currentTarget.replaceWith(Object.assign(document.createElement('div'), {
                className: 'identity-task-poster identity-task-poster--empty',
                textContent: 'Нет постера'
            }));
        });

        const form = panel.querySelector('.identity-task-form');
        const input = panel.querySelector('#identityTaskKpInput');
        const verifyBtn = panel.querySelector('.btn-verify-action');
        const preview = panel.querySelector('.identity-task-preview');

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            this.inspectIdentityCandidate(item, input.value, { verifyBtn, preview });
        });
        panel.querySelector('.identity-task-find').addEventListener('click', (event) => {
            this.findIdentityCandidates(item, event.currentTarget, panel.querySelector('.identity-candidates'), (kpId) => {
                input.value = String(kpId);
                this.inspectIdentityCandidate(item, input.value, { verifyBtn, preview });
            });
        });
        panel.querySelector('.identity-task-next').addEventListener('click', () => this.advanceIdentityTask());
        panel.querySelector('.btn-snooze-action').addEventListener('click', async (event) => {
            const btn = event.currentTarget;
            try {
                btn.disabled = true;
                await this.idMappingService.snoozeUnmappedQueueItem(item.key, 7, 'no-kp-page');
                Utils.showToast(`«${title}» отложен на 7 дней: страницы на Кинопоиске ещё нет`, 'success');
                this.advanceIdentityTask();
                await this.loadTmdbFallbacks();
            } catch (err) {
                console.error('Error snoozing unmapped item:', err);
                Utils.showToast(`Не удалось отложить тайтл: ${err.message}`, 'error');
                btn.disabled = false;
            }
        });
    }

    async findIdentityCandidates(item, button, box, onPick) {
        const query = (item.title || item.originalTitle || '').trim();
        if (!query || !box) return;
        if (!this.kinopoiskService) this.kinopoiskService = new KinopoiskService();
        button.disabled = true;
        box.hidden = false;
        box.innerHTML = '<p class="identity-candidates-state">Ищем на Кинопоиске…</p>';
        try {
            const data = await this.kinopoiskService.searchMovies(query, 1, 6);
            const docs = (data?.docs || [])
                .map((movie) => ({
                    kpId: Number(movie.kinopoiskId || movie.id),
                    name: movie.name || movie.alternativeName || movie.enName || 'Без названия',
                    original: movie.alternativeName || movie.enName || '',
                    year: Number(movie.year) || null,
                    poster: movie.posterUrl || movie.poster?.previewUrl || movie.poster?.url || ''
                }))
                .filter((movie) => Number.isSafeInteger(movie.kpId) && movie.kpId > 0)
                .slice(0, 5);
            if (!docs.length) {
                box.innerHTML = '<p class="identity-candidates-state">Ничего не нашлось. Найдите тайтл по ссылке «Искать на Кинопоиске» и вставьте его ID.</p>';
                return;
            }
            const tmdbYear = Number(item.year) || null;
            const original = (item.originalTitle || '').trim().toLowerCase();
            box.replaceChildren(...docs.map((movie) => {
                const yearMatch = tmdbYear && movie.year ? Math.abs(tmdbYear - movie.year) <= 1 : null;
                const titleMatch = original && movie.original ? movie.original.trim().toLowerCase() === original : null;
                const checks = [];
                if (yearMatch !== null) checks.push(`<span class="identity-tag" data-tone="${yearMatch ? 'success' : 'danger'}">${yearMatch ? 'год совпадает' : 'другой год'}</span>`);
                if (titleMatch !== null) checks.push(`<span class="identity-tag" data-tone="${titleMatch ? 'success' : 'neutral'}">${titleMatch ? 'оригинальное название совпадает' : 'другое оригинальное название'}</span>`);
                const candidate = document.createElement('button');
                candidate.type = 'button';
                candidate.className = 'identity-candidate';
                candidate.innerHTML = `
                    ${movie.poster ? `<img class="identity-candidate-poster" src="${this.escapeHtml(movie.poster)}" alt="" loading="lazy">` : '<span class="identity-candidate-poster" aria-hidden="true"></span>'}
                    <span class="identity-candidate-text">
                        <span class="identity-candidate-title">${this.escapeHtml(movie.name)}${movie.year ? ` <span class="identity-candidate-year">${movie.year}</span>` : ''}</span>
                        <span class="identity-candidate-meta">KP ${movie.kpId}${movie.original ? ` · ${this.escapeHtml(movie.original)}` : ''}</span>
                        <span class="identity-task-tags">${checks.join('')}</span>
                    </span>
                    <span class="identity-candidate-pick">Проверить</span>
                `;
                candidate.addEventListener('click', () => onPick(movie.kpId));
                return candidate;
            }));
        } catch (error) {
            console.warn('[Admin] Kinopoisk candidate search failed:', error);
            box.innerHTML = '<p class="identity-candidates-state">Поиск Кинопоиска не ответил. Попробуйте позже или вставьте ID вручную.</p>';
        } finally {
            button.disabled = false;
        }
    }

    async inspectIdentityCandidate(item, rawValue, { verifyBtn, preview }) {
        const kpId = this.extractNumericId(rawValue);
        if (!kpId) {
            Utils.showToast('Введите числовой Kinopoisk ID или ссылку на Кинопоиск', 'warning');
            return;
        }
        const mediaType = item.mediaType;
        const tmdbYear = Number(item.year) || null;
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Проверяем…';
        preview.hidden = false;
        preview.innerHTML = '<p class="identity-candidates-state">Запрашиваем карточку Кинопоиска…</p>';

        try {
            if (!this.kinopoiskService) this.kinopoiskService = new KinopoiskService();
            const kpMovie = await this.kinopoiskService.getMovieById(kpId);
            const resolvedKpId = Number(kpMovie?.kinopoiskId || kpMovie?.id);
            if (!kpMovie || !Number.isInteger(resolvedKpId) || resolvedKpId <= 0) {
                throw new Error('Фильм или сериал с таким ID не найден на Кинопоиске');
            }
            const kpType = kpMovie.type || (mediaType === 'tv' ? 'tv-series' : 'movie');
            const kpYear = Number(kpMovie.year) || null;
            const isCompatible = this.idMappingService.isCompatibleType(mediaType, kpType, kpMovie);
            const yearDiff = tmdbYear && kpYear ? Math.abs(tmdbYear - kpYear) : 0;
            const kpTitle = kpMovie.name || kpMovie.alternativeName || `КП ${resolvedKpId}`;
            const kpPoster = kpMovie.posterUrl || (typeof kpMovie.poster === 'string' ? kpMovie.poster : kpMovie.poster?.url) || '';
            const genres = Array.isArray(kpMovie.genres)
                ? kpMovie.genres.map((genre) => (typeof genre === 'string' ? genre : genre?.name)).filter(Boolean).slice(0, 3).join(', ')
                : '';
            const checks = [
                `<span class="identity-tag" data-tone="${isCompatible ? 'success' : 'danger'}">${isCompatible ? 'тип совпадает' : `другой тип: TMDB ${this.escapeHtml(mediaType)}, КП ${this.escapeHtml(kpType)}`}</span>`
            ];
            if (tmdbYear && kpYear) {
                checks.push(`<span class="identity-tag" data-tone="${yearDiff <= 1 ? 'success' : yearDiff > 3 ? 'danger' : 'warning'}">${yearDiff === 0 ? 'год совпадает' : `год: TMDB ${tmdbYear}, КП ${kpYear}`}</span>`);
            }

            preview.innerHTML = `
                <div class="identity-verdict">
                    ${kpPoster ? `<img class="identity-candidate-poster" src="${this.escapeHtml(kpPoster)}" alt="">` : '<span class="identity-candidate-poster" aria-hidden="true"></span>'}
                    <div class="identity-candidate-text">
                        <span class="identity-candidate-title">${this.escapeHtml(kpTitle)}${kpYear ? ` <span class="identity-candidate-year">${kpYear}</span>` : ''}</span>
                        <span class="identity-candidate-meta">KP ${resolvedKpId}${kpMovie.alternativeName && kpMovie.alternativeName !== kpMovie.name ? ` · ${this.escapeHtml(kpMovie.alternativeName)}` : ''}${genres ? ` · ${this.escapeHtml(genres)}` : ''}</span>
                        <span class="identity-task-tags">${checks.join('')}</span>
                        <a class="identity-verdict-link" href="https://www.kinopoisk.ru/film/${resolvedKpId}/" target="_blank" rel="noopener noreferrer">Открыть на Кинопоиске ↗</a>
                    </div>
                    <button class="btn-confirm-map btn-confirm-action" type="button">Подтвердить связь</button>
                </div>
            `;
            preview.querySelector('img')?.addEventListener('error', (event) => {
                event.currentTarget.replaceWith(Object.assign(document.createElement('span'), { className: 'identity-candidate-poster' }));
            });

            const confirmBtn = preview.querySelector('.btn-confirm-action');
            confirmBtn.addEventListener('click', async () => {
                try {
                    confirmBtn.disabled = true;
                    confirmBtn.textContent = 'Сохраняем…';
                    await this.idMappingService.setManualMapping(mediaType, item.tmdbId, resolvedKpId, {
                        title: kpMovie.name || kpMovie.alternativeName || '',
                        year: kpYear,
                        kpType
                    });
                    Utils.showToast(`Связь сохранена: «${item.title || item.tmdbId}» → КП ${resolvedKpId}`, 'success');
                    this.advanceIdentityTask();
                    await this.loadTmdbFallbacks();
                } catch (err) {
                    console.error('Error confirming manual mapping:', err);
                    Utils.showToast(`Не удалось сохранить связь: ${err.message}`, 'error');
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = 'Подтвердить связь';
                }
            });
            confirmBtn.focus();
        } catch (err) {
            console.error('Error verifying KP ID:', err);
            preview.innerHTML = `<p class="identity-candidates-state" data-tone="danger">Проверка не удалась: ${this.escapeHtml(err.message)}</p>`;
        } finally {
            verifyBtn.disabled = false;
            verifyBtn.textContent = 'Проверить';
        }
    }

    renderManualMappingsList(manualMappings) {
        const container = document.getElementById('tmdbManualMappingsList');
        if (!container) return;
        container.innerHTML = '';

        if (!manualMappings || manualMappings.length === 0) {
            container.innerHTML = `
                <div class="tmdb-empty-state">
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
            const dateStr = this.formatAdminDate(item.resolvedAt);
            const tagClass = item.mediaType === 'movie' ? 'tmdb-tag-movie' : 'tmdb-tag-tv';

            tr.innerHTML = `
                <td style="font-weight: 500; color: var(--theme-text-primary);">
                    ${this.escapeHtml(item.title || `TMDB #${item.tmdbId}`)}
                    ${item.year ? `<span style="color: var(--theme-text-secondary); font-size: 12px; margin-left: 4px;">(${item.year})</span>` : ''}
                </td>
                <td style="text-align: center;"><span class="tmdb-tag-pill ${tagClass}">${item.mediaType}</span></td>
                <td style="text-align: center;"><code style="background: var(--theme-bg-tertiary); padding: 2px 6px; border-radius: var(--radius-sm); color: var(--theme-text-primary);">${item.tmdbId}</code></td>
                <td style="text-align: center;"><a href="https://www.kinopoisk.ru/film/${item.kpId}/" target="_blank" rel="noopener noreferrer" style="color: var(--theme-text-primary); font-weight: 600;">${item.kpId} ↗</a></td>
                <td style="text-align: center; color: var(--theme-text-secondary); font-size: 12px;">${dateStr}</td>
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
                if (!(await ConfirmDialog.confirm({ title: 'Удалить ручную привязку?', message: '', confirmLabel: 'Удалить', danger: true }))) return;
                const mediaType = btn.dataset.mediaType;
                const tmdbId = btn.dataset.tmdbId;
                try {
                    await this.idMappingService.removeManualMapping(mediaType, tmdbId);
                    Utils.showToast('Привязка удалена', 'success');
                    await this.loadTmdbFallbacks();
                } catch (err) {
                    console.error('Error deleting mapping:', err);
                    Utils.showToast(`Ошибка: ${err.message}`, 'error');
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
                ? `<img src="${this.escapeHtml(item.posterUrl)}" class="movie-poster" alt="">`
                : `<div class="movie-poster" style="display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--theme-text-muted);">НЕТ</div>`;

            card.innerHTML = `
                <div class="tmdb-fallback-movie">
                    ${posterImg}
                    <div style="min-width: 0; flex: 1;">
                        <div style="font-weight: 600; color: var(--theme-text-primary); font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${this.escapeHtml(item.name || item.alternativeName || 'Фильм Кинопоиска')}
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--theme-text-secondary); margin-top: 4px;">
                            ${item.year ? `<span style="font-weight: 500;">${item.year}</span> <span>•</span>` : ''}
                            <span>Kinopoisk ID: <code style="background: var(--theme-bg-tertiary); padding: 2px 6px; border-radius: var(--radius-sm); color: var(--theme-text-primary);">${item.kinopoiskId}</code></span>
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
                    Utils.showToast('Пожалуйста, укажите валидный IMDb ID в формате tt1234567', 'warning');
                    return;
                }

                try {
                    btn.disabled = true;
                    btn.textContent = 'Сохранение...';
                    const item = pendingItems.find(p => String(p.kinopoiskId) === String(kpId));
                    await this.tmdbFallbackService.saveManualMapping(item, imdbId, this.currentUser?.uid || 'admin');

                    Utils.showToast(`IMDb ID ${imdbId} успешно сохранён для фильма [KP: ${kpId}]`, 'success');
                    await this.loadTmdbFallbacks();
                } catch (err) {
                    console.error('Error saving IMDb mapping:', err);
                    Utils.showToast(`Ошибка: ${err.message}`, 'error');
                    btn.disabled = false;
                    btn.textContent = 'Сохранить';
                }
            });
        });
    }

    withTimeout(promise, ms) {
        let timer = null;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('ADMIN_CHECK_TIMEOUT')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    // Firestore Timestamp, its cached {seconds} form, a number or a string; '—' when unknown.
    formatAdminDate(value, withTime = false) {
        let date = null;
        if (value?.toDate) date = value.toDate();
        else if (Number.isFinite(value?.seconds)) date = new Date(value.seconds * 1000);
        else if (Number.isFinite(value?._seconds)) date = new Date(value._seconds * 1000);
        else if (value) date = new Date(value);
        if (!date || Number.isNaN(date.getTime())) return '—';
        return withTime
            ? date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    escapeHtml(text) {
        if (!text) return '';
        return Utils.escapeHtml(text);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.adminPanel = new AdminPanelManager();
});
