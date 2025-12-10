/**
 * Admin Panel Manager
 * Handles admin interface for user management
 */
class AdminPanelManager {
    constructor() {
        this.adminService = null;
        this.currentUser = null;
        this.users = [];
        this.userToDelete = null;
        this.ratings = [];
        this.filteredRatings = [];
        this.ratingToDelete = null;
        this.ratingsFilters = {
            movieTitle: '',
            userId: '',
            dateFrom: '',
            dateTo: ''
        };
        this.init();
    }

    async init() {
        try {
            // Initialize navigation
            window.navigation = new Navigation('admin');

            // Wait for Firebase to be ready
            await this.waitForFirebase();

            // Check if user is admin
            const isAdmin = await this.checkAdminAccess();
            if (!isAdmin) {
                this.showError('Access denied. You must be an administrator to view this page.');
                setTimeout(() => {
                    window.location.href = chrome.runtime.getURL('src/pages/search/search.html');
                }, 2000);
                return;
            }

            // Initialize services
            this.adminService = new AdminService(firebaseManager);

            // Load users
            await this.loadUsers();

            // Load ratings
            await this.loadRatings();

            // Setup event listeners
            this.setupEventListeners();
        } catch (error) {
            console.error('Error initializing admin panel:', error);
            this.showError(`Failed to initialize: ${error.message}`);
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

            const userProfile = await userService.getUserProfile(this.currentUser.uid);
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
        try {
            this.showLoading();
            
            this.users = await this.adminService.getAllUsers();
            
            this.hideLoading();
            this.renderUsers();
        } catch (error) {
            console.error('Error loading users:', error);
            this.hideLoading();
            this.showError(`Failed to load users: ${error.message}`);
        }
    }

    renderUsers() {
        const tableBody = document.getElementById('usersTableBody');
        const usersCount = document.getElementById('usersCount');
        
        if (!tableBody) return;

        // Update count
        if (usersCount) {
            usersCount.textContent = `${this.users.length} user${this.users.length !== 1 ? 's' : ''}`;
        }

        // Clear existing rows
        tableBody.innerHTML = '';

        if (this.users.length === 0) {
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
        this.users.forEach(user => {
            const row = this.createUserRow(user);
            tableBody.appendChild(row);
        });
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
                         onerror="this.src='${chrome.runtime.getURL('icons/icon48.png')}'">
                    <div>
                        <div class="user-name">
                            ${this.escapeHtml(user.displayName || 'Unknown User')}
                            ${user.isAdmin ? '<span class="admin-badge">🛡️ Admin</span>' : ''}
                            ${isCurrentUser ? '<span class="admin-badge" style="background: #22c55e;">You</span>' : ''}
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

        // Ratings filters
        const movieSearchFilter = document.getElementById('movieSearchFilter');
        const userFilter = document.getElementById('userFilter');
        const dateFromFilter = document.getElementById('dateFromFilter');
        const dateToFilter = document.getElementById('dateToFilter');
        const clearFiltersBtn = document.getElementById('clearRatingsFilters');

        if (movieSearchFilter) {
            movieSearchFilter.addEventListener('input', () => {
                this.ratingsFilters.movieTitle = movieSearchFilter.value.trim();
                this.applyRatingsFilters();
            });
        }

        if (userFilter) {
            userFilter.addEventListener('change', () => {
                this.ratingsFilters.userId = userFilter.value;
                this.applyRatingsFilters();
            });
        }

        if (dateFromFilter) {
            dateFromFilter.addEventListener('change', () => {
                this.ratingsFilters.dateFrom = dateFromFilter.value;
                this.applyRatingsFilters();
            });
        }

        if (dateToFilter) {
            dateToFilter.addEventListener('change', () => {
                this.ratingsFilters.dateTo = dateToFilter.value;
                this.applyRatingsFilters();
            });
        }

        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => {
                this.ratingsFilters = {
                    movieTitle: '',
                    userId: '',
                    dateFrom: '',
                    dateTo: ''
                };
                if (movieSearchFilter) movieSearchFilter.value = '';
                if (userFilter) userFilter.value = '';
                if (dateFromFilter) dateFromFilter.value = '';
                if (dateToFilter) dateToFilter.value = '';
                this.applyRatingsFilters();
            });
        }

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideDeleteModal();
                this.hideDeleteRatingModal();
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

    async loadRatings() {
        try {
            const filters = {};
            if (this.ratingsFilters.userId) {
                filters.userId = this.ratingsFilters.userId;
            }

            const allRatings = await this.adminService.getAllRatingsWithDetails(500, filters);
            
            // Enrich with movie data
            const movieCacheService = firebaseManager.getMovieCacheService();
            const movieIds = [...new Set(allRatings.map(r => r.movieId))];
            const cachedMovies = await movieCacheService.getBatchCachedMovies(movieIds);

            this.ratings = allRatings.map(rating => {
                const movie = cachedMovies[rating.movieId] || null;
                return {
                    ...rating,
                    movie
                };
            });

            this.populateUserFilter();
            this.applyRatingsFilters();
        } catch (error) {
            console.error('Error loading ratings:', error);
            this.showError(`Failed to load ratings: ${error.message}`);
        }
    }

    populateUserFilter() {
        const userFilter = document.getElementById('userFilter');
        if (!userFilter) return;

        // Clear existing options except "All Users"
        userFilter.innerHTML = '<option value="">All Users</option>';

        // Get unique users from ratings
        const uniqueUsers = new Map();
        this.ratings.forEach(rating => {
            if (rating.user && !uniqueUsers.has(rating.userId)) {
                uniqueUsers.set(rating.userId, rating.user);
            }
        });

        // Add user options
        uniqueUsers.forEach((user, userId) => {
            const option = document.createElement('option');
            option.value = userId;
            option.textContent = user.displayName || user.email || 'Unknown User';
            userFilter.appendChild(option);
        });
    }

    applyRatingsFilters() {
        this.filteredRatings = this.ratings.filter(rating => {
            // Movie title filter
            if (this.ratingsFilters.movieTitle) {
                const movieTitle = rating.movie?.name?.toLowerCase() || '';
                const searchTerm = this.ratingsFilters.movieTitle.toLowerCase();
                if (!movieTitle.includes(searchTerm)) {
                    return false;
                }
            }

            // User filter (already applied in loadRatings, but double-check)
            if (this.ratingsFilters.userId && rating.userId !== this.ratingsFilters.userId) {
                return false;
            }

            // Date filters
            if (this.ratingsFilters.dateFrom) {
                const ratingDate = rating.createdAt?.toDate?.() || new Date(rating.createdAt);
                const filterDate = new Date(this.ratingsFilters.dateFrom);
                if (ratingDate < filterDate) {
                    return false;
                }
            }

            if (this.ratingsFilters.dateTo) {
                const ratingDate = rating.createdAt?.toDate?.() || new Date(rating.createdAt);
                const filterDate = new Date(this.ratingsFilters.dateTo);
                filterDate.setHours(23, 59, 59, 999); // Include entire day
                if (ratingDate > filterDate) {
                    return false;
                }
            }

            return true;
        });

        this.renderRatings();
    }

    renderRatings() {
        const tableBody = document.getElementById('ratingsTableBody');
        const ratingsCount = document.getElementById('ratingsCount');
        
        if (!tableBody) return;

        // Update count
        if (ratingsCount) {
            ratingsCount.textContent = `${this.filteredRatings.length} rating${this.filteredRatings.length !== 1 ? 's' : ''}`;
        }

        // Clear existing rows
        tableBody.innerHTML = '';

        if (this.filteredRatings.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: var(--space-xl); color: var(--text-secondary);">
                        No ratings found
                    </td>
                </tr>
            `;
            return;
        }

        // Render each rating
        this.filteredRatings.forEach(rating => {
            const row = this.createRatingRow(rating);
            tableBody.appendChild(row);
        });
    }

    createRatingRow(rating) {
        const row = document.createElement('tr');
        const movie = rating.movie || {};
        const user = rating.user || {};
        const movieTitle = movie.name || 'Unknown Movie';
        const movieYear = movie.year ? ` (${movie.year})` : '';
        const userName = user.displayName || user.email || 'Unknown User';
        const ratingDate = rating.createdAt?.toDate ? 
            rating.createdAt.toDate().toLocaleDateString() : 
            (rating.createdAt ? new Date(rating.createdAt).toLocaleDateString() : 'Unknown');
        const comment = rating.comment || '';
        const truncatedComment = comment.length > 50 ? comment.substring(0, 50) + '...' : comment;

        row.innerHTML = `
            <td>
                <div class="movie-info">
                    ${movie.posterUrl ? 
                        `<img src="${movie.posterUrl}" alt="${movieTitle}" class="movie-poster" onerror="this.style.display='none'">` : 
                        ''
                    }
                    <div>
                        <div class="movie-title">${this.escapeHtml(movieTitle)}${movieYear}</div>
                        <div class="movie-id">ID: ${rating.movieId}</div>
                    </div>
                </div>
            </td>
            <td>
                <div class="user-info">
                    <img src="${user.photoURL || chrome.runtime.getURL('icons/icon48.png')}" 
                         alt="${userName}" 
                         class="user-avatar"
                         onerror="this.src='${chrome.runtime.getURL('icons/icon48.png')}'">
                    <div>
                        <div class="user-name">${this.escapeHtml(userName)}</div>
                        <div class="user-email">${this.escapeHtml(user.email || '')}</div>
                    </div>
                </div>
            </td>
            <td>
                <div class="rating-value"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> ${rating.rating}/10</div>
            </td>
            <td>
                <div class="rating-comment" title="${this.escapeHtml(comment)}">
                    ${this.escapeHtml(truncatedComment || 'No comment')}
                </div>
            </td>
            <td>
                <div class="rating-date">${ratingDate}</div>
            </td>
            <td>
                <button class="btn-delete" data-rating-id="${rating.id}">
                    Delete
                </button>
            </td>
        `;

        // Add click handler for delete button
        const deleteBtn = row.querySelector('.btn-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this.showDeleteRatingConfirmation(rating));
        }

        return row;
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
                    <p><strong>Rating:</strong> <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> ${rating.rating}/10</p>
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

    escapeHtml(text) {
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
