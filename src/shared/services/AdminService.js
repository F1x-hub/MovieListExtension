/**
 * AdminService - Handles administrative operations like user management
 */
const FIRESTORE_USAGE_URL = 'https://us-central1-movielistdb-13208.cloudfunctions.net/firestoreUsage';
const PROVIDER_KEYS_URL = 'https://us-central1-movielistdb-13208.cloudfunctions.net/providerKeysAdmin';

class AdminService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.firebaseManager = firebaseManager;
    }

    /**
     * Read Firestore free-tier usage from the admin-only Cloud Function.
     * @returns {Promise<Object>} Usage metrics and quota limits
     */
    async getFirestoreUsage() {
        const currentUser = this.firebaseManager.getCurrentUser?.()
            || (typeof firebase !== 'undefined' ? firebase.auth?.().currentUser : null);
        if (!currentUser || typeof currentUser.getIdToken !== 'function') {
            throw new Error('Authentication is required to read Firestore usage');
        }

        const idToken = await currentUser.getIdToken();
        const response = await fetch(FIRESTORE_USAGE_URL, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${idToken}`
            }
        });

        let payload;
        try {
            payload = await response.json();
        } catch {
            // Keep payload undefined when the function returns a non-JSON error.
        }

        if (!response.ok) {
            throw new Error(payload?.error || `Firestore usage request failed (${response.status})`);
        }

        if (!payload?.storage || !payload?.reads || !payload?.writes) {
            throw new Error('Firestore usage response is incomplete');
        }

        return payload;
    }

    async requestProviderKeys({ action = 'list', method = 'GET', body = null } = {}) {
        const currentUser = this.firebaseManager.getCurrentUser?.()
            || (typeof firebase !== 'undefined' ? firebase.auth?.().currentUser : null);
        if (!currentUser || typeof currentUser.getIdToken !== 'function') {
            throw new Error('Authentication is required to manage provider keys');
        }

        const idToken = await currentUser.getIdToken();
        const url = new URL(PROVIDER_KEYS_URL);
        const request = {
            method,
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${idToken}`
            }
        };
        if (method === 'GET') {
            url.searchParams.set('action', action);
        } else {
            request.headers['Content-Type'] = 'application/json';
            request.body = JSON.stringify({ action, ...(body || {}) });
        }

        const response = await fetch(url.toString(), request);
        let payload;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }

        if (!response.ok) {
            const error = new Error(payload?.error?.message || `Provider key request failed (${response.status})`);
            error.code = payload?.error?.code || 'PROVIDER_KEY_OPERATION_FAILED';
            error.status = response.status;
            throw error;
        }
        if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
            throw new Error('Provider key response is incomplete');
        }
        return payload.data;
    }

    validateProviderKeyDto(key) {
        if (!key || typeof key !== 'object' || 'secret' in key || 'value' in key) {
            throw new Error('Provider key response is unsafe');
        }
        const allowedFields = [
            'id', 'provider', 'label', 'purpose', 'status', 'fingerprint', 'maskedValue',
            'createdAt', 'createdBy', 'updatedAt', 'lastCheckedAt', 'lastSuccessAt',
            'lastFailureAt', 'lastErrorCode', 'quota'
        ];
        return Object.fromEntries(allowedFields
            .filter((field) => Object.prototype.hasOwnProperty.call(key, field))
            .map((field) => [field, key[field]]));
    }

    async listProviderKeys() {
        const data = await this.requestProviderKeys({ action: 'list' });
        if (!Array.isArray(data)) throw new Error('Provider key list is incomplete');
        return data.map((key) => this.validateProviderKeyDto(key));
    }

    async addProviderKey({ provider = 'kinopoisk', label, purpose, secret }) {
        const data = await this.requestProviderKeys({
            action: 'add',
            method: 'POST',
            body: { provider, label, purpose, secret }
        });
        return this.validateProviderKeyDto(data);
    }

    async testProviderKey(keyId) {
        const data = await this.requestProviderKeys({
            action: 'test',
            method: 'POST',
            body: { keyId }
        });
        return this.validateProviderKeyDto(data);
    }

    async setProviderKeyStatus(keyId, status) {
        if (!['active', 'disabled'].includes(status)) {
            throw new Error('Provider key status is invalid');
        }
        const data = await this.requestProviderKeys({
            action: status === 'active' ? 'enable' : 'disable',
            method: 'POST',
            body: { keyId }
        });
        return this.validateProviderKeyDto(data);
    }

    async revokeProviderKey(keyId) {
        const data = await this.requestProviderKeys({
            action: 'revoke',
            method: 'POST',
            body: { keyId }
        });
        return this.validateProviderKeyDto(data);
    }

    async getProviderKeyQuota(keyId) {
        const data = await this.requestProviderKeys({
            action: 'quota',
            method: 'POST',
            body: { keyId }
        });
        if (!data || typeof data !== 'object' ||
            !['provider_exact', 'local_estimate', 'unavailable'].includes(data.mode)) {
            throw new Error('Provider key quota response is incomplete');
        }
        const allowedFields = ['mode', 'unit', 'used', 'limit', 'remaining', 'status', 'measuredAt', 'stale'];
        return Object.fromEntries(allowedFields
            .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
            .map((field) => [field, data[field]]));
    }

    /**
     * Check if a user is an admin
     * @param {string} userId - User ID to check
     * @returns {Promise<boolean>} - True if user is admin
     */
    async isUserAdmin(userId) {
        try {
            const userRef = this.db.collection('users').doc(userId);
            const userDoc = await userRef.get();
            
            if (userDoc.exists) {
                const userData = userDoc.data();
                return userData.isAdmin === true;
            }
            return false;
        } catch (error) {
            console.error('Error checking admin status:', error);
            return false;
        }
    }

    getCommentReactionService() {
        if (this.firebaseManager?.getCommentReactionService) {
            return this.firebaseManager.getCommentReactionService();
        }
        if (typeof CommentReactionService === 'undefined') {
            throw new Error('CommentReactionService class not found');
        }
        return new CommentReactionService(this.firebaseManager);
    }

    async getCommentReactionConfig(force = false) {
        return this.getCommentReactionService().loadConfig(force);
    }

    async saveCommentReactionConfig(reactions, currentAdminId) {
        const isAdmin = await this.isUserAdmin(currentAdminId);
        if (!isAdmin) {
            throw new Error('Unauthorized: Admin access required');
        }

        return this.getCommentReactionService().saveConfig(reactions, currentAdminId);
    }

    async uploadCommentReactionAsset(file, reactionId, currentAdminId) {
        const isAdmin = await this.isUserAdmin(currentAdminId);
        if (!isAdmin) {
            throw new Error('Unauthorized: Admin access required');
        }
        if (typeof this.firebaseManager?.uploadCommentReactionAsset !== 'function') {
            throw new Error('Comment reaction asset upload is unavailable');
        }
        return this.firebaseManager.uploadCommentReactionAsset(file, reactionId);
    }

    async deleteCommentReactionAsset(storagePath, currentAdminId) {
        const isAdmin = await this.isUserAdmin(currentAdminId);
        if (!isAdmin) {
            throw new Error('Unauthorized: Admin access required');
        }
        if (typeof this.firebaseManager?.deleteCommentReactionAsset !== 'function') {
            throw new Error('Comment reaction asset deletion is unavailable');
        }
        return this.firebaseManager.deleteCommentReactionAsset(storagePath);
    }

    /**
     * Get all users with their statistics (Optimized with Promise.all and counts if possible, fallback to size)
     * @returns {Promise<Array>} - Array of user objects with stats
     */
    async getAllUsers() {
        try {
            const usersSnapshot = await this.db.collection('users').get();
            
            const userPromises = usersSnapshot.docs.map(async (doc) => {
                const userData = doc.data();
                
                // Fetch stats concurrently via Promise.all
                // `count().get()` is an optimized feature in modern Firestore, we use try/catch fallback
                let ratingsCount;
                let collectionCount;
                
                try {
                    const [ratingsSnapshot, collectionSnapshot] = await Promise.all([
                        this.db.collection('ratings').where('userId', '==', doc.id).count().get(),
                        this.db.collection('collections').where('userId', '==', doc.id).count().get()
                    ]);
                    ratingsCount = ratingsSnapshot.data().count;
                    collectionCount = collectionSnapshot.data().count;
                } catch {
                    console.warn(`[AdminService] count() failed, falling back to .get() for user ${doc.id}`);
                    const [ratingsSnapshot, collectionSnapshot] = await Promise.all([
                        this.db.collection('ratings').where('userId', '==', doc.id).get(),
                        this.db.collection('collections').where('userId', '==', doc.id).get()
                    ]);
                    ratingsCount = ratingsSnapshot.size;
                    collectionCount = collectionSnapshot.size;
                }

                return {
                    id: doc.id,
                    ...userData,
                    ratingsCount,
                    collectionCount
                };
            });

            const users = await Promise.all(userPromises);

            return users.sort((a, b) => {
                // Sort by creation date (newest first)
                const dateA = a.createdAt?.toDate?.() || new Date(0);
                const dateB = b.createdAt?.toDate?.() || new Date(0);
                return dateB - dateA;
            });
        } catch (error) {
            console.error('Error getting all users:', error);
            throw new Error(`Failed to fetch users: ${error.message}`, { cause: error });
        }
    }

    /**
     * Get users paginated
     * @param {Object} lastVisibleDoc - Last document from previous page
     * @param {number} pageSize - Number of users to fetch
     * @returns {Promise<{users: Array, lastDoc: Object, hasMore: boolean}>}
     */
    async getUsersPage(lastVisibleDoc = null, pageSize = 20) {
        try {
            // Removed orderBy('createdAt', 'desc') to prevent Firestore from
            // excluding legacy users that don't have a 'createdAt' field.
            let query = this.db.collection('users')
                .limit(pageSize);
                
            if (lastVisibleDoc) {
                query = query.startAfter(lastVisibleDoc);
            }
            
            const snapshot = await query.get();
            const lastDoc = snapshot.docs[snapshot.docs.length - 1];
            const hasMore = snapshot.size === pageSize;
            
            const userPromises = snapshot.docs.map(async (doc) => {
                const userData = doc.data();
                
                let ratingsCount;
                let collectionCount;
                
                try {
                    const [ratingsSnapshot, collectionSnapshot] = await Promise.all([
                        this.db.collection('ratings').where('userId', '==', doc.id).count().get(),
                        this.db.collection('collections').where('userId', '==', doc.id).count().get()
                    ]);
                    ratingsCount = ratingsSnapshot.data().count;
                    collectionCount = collectionSnapshot.data().count;
                } catch {
                    const [ratingsSnapshot, collectionSnapshot] = await Promise.all([
                        this.db.collection('ratings').where('userId', '==', doc.id).get(),
                        this.db.collection('collections').where('userId', '==', doc.id).get()
                    ]);
                    ratingsCount = ratingsSnapshot.size;
                    collectionCount = collectionSnapshot.size;
                }

                return {
                    id: doc.id,
                    ...userData,
                    ratingsCount,
                    collectionCount
                };
            });
            
            const users = await Promise.all(userPromises);
            
            return { users, lastDoc, hasMore };
        } catch (error) {
            console.error('Error getting users page:', error);
            throw new Error(`Failed to fetch users page: ${error.message}`, { cause: error });
        }
    }

    /**
     * Delete a user and all their associated data (cascading delete)
     * @param {string} userId - User ID to delete
     * @param {string} currentUserId - ID of user performing the deletion (for safety check)
     * @returns {Promise<Object>} - Deletion summary
     */
    async deleteUser(userId, currentUserId) {
        try {
            // Safety check: can't delete yourself
            if (userId === currentUserId) {
                throw new Error('You cannot delete your own account');
            }

            // Verify the user exists
            const userRef = this.db.collection('users').doc(userId);
            const userDoc = await userRef.get();
            
            if (!userDoc.exists) {
                throw new Error('User not found');
            }

            const deletionStats = {
                userId,
                ratingsDeleted: 0,
                collectionsDeleted: 0,
                success: false
            };

            // Delete all ratings by this user
            const ratingsSnapshot = await this.db
                .collection('ratings')
                .where('userId', '==', userId)
                .get();
            
            const ratingDeletePromises = ratingsSnapshot.docs.map(doc => doc.ref.delete());
            await Promise.all(ratingDeletePromises);
            deletionStats.ratingsDeleted = ratingsSnapshot.size;

            // Delete all collection entries by this user
            const collectionSnapshot = await this.db
                .collection('collections')
                .where('userId', '==', userId)
                .get();
            
            const collectionDeletePromises = collectionSnapshot.docs.map(doc => doc.ref.delete());
            await Promise.all(collectionDeletePromises);
            deletionStats.collectionsDeleted = collectionSnapshot.size;

            // Finally, delete the user document
            await userRef.delete();
            
            // Invalidate users cache since a user was deleted
            const cacheService = this.firebaseManager.getAdminRatingsCacheService ? 
                                 this.firebaseManager.getAdminRatingsCacheService() : null;
            if (cacheService && typeof cacheService.invalidateUsersCache === 'function') {
                cacheService.invalidateUsersCache();
            } else if (typeof window !== 'undefined' && window.AdminRatingsCacheService) {
                // Fallback attempt to clear cache manually via a temp instance
                new window.AdminRatingsCacheService(this.firebaseManager).invalidateUsersCache();
            }
            
            deletionStats.success = true;
            return deletionStats;
        } catch (error) {
            console.error('Error deleting user:', error);
            throw new Error(`Failed to delete user: ${error.message}`, { cause: error });
        }
    }

    /**
     * Get deletion preview for a user (shows what will be deleted)
     * @param {string} userId - User ID to preview
     * @returns {Promise<Object>} - Preview of data to be deleted
     */
    async getUserDeletionPreview(userId) {
        try {
            const userRef = this.db.collection('users').doc(userId);
            const userDoc = await userRef.get();
            
            if (!userDoc.exists) {
                throw new Error('User not found');
            }

            const userData = userDoc.data();

            // Count ratings
            const ratingsSnapshot = await this.db
                .collection('ratings')
                .where('userId', '==', userId)
                .get();

            // Count collection entries
            const collectionSnapshot = await this.db
                .collection('collections')
                .where('userId', '==', userId)
                .get();

            return {
                user: {
                    id: userId,
                    displayName: userData.displayName || 'Unknown User',
                    email: userData.email || 'No email'
                },
                ratingsCount: ratingsSnapshot.size,
                collectionCount: collectionSnapshot.size
            };
        } catch (error) {
            console.error('Error getting deletion preview:', error);
            throw new Error(`Failed to get deletion preview: ${error.message}`, { cause: error });
        }
    }

    /**
     * Get all ratings with user and movie details
     * @param {number} limit - Maximum number of ratings to return
     * @param {Object} filters - Filter options (userId, movieId, dateFrom, dateTo)
     * @returns {Promise<Array>} - Array of ratings with enriched data
     */
    async getAllRatingsWithDetails(limit = 500, filters = {}) {
        try {
            let query = this.db.collection('ratings');

            // Apply basic filter if only one is provided (to avoid composite index issues)
            if (filters.userId && !filters.movieId && !filters.dateFrom && !filters.dateTo) {
                query = query.where('userId', '==', filters.userId);
            } else if (filters.movieId && !filters.userId && !filters.dateFrom && !filters.dateTo) {
                query = query.where('movieId', '==', filters.movieId);
            } else if (filters.dateFrom && !filters.userId && !filters.movieId) {
                const dateFrom = filters.dateFrom instanceof Date ? filters.dateFrom : new Date(filters.dateFrom);
                query = query.where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(dateFrom));
            }

            query = query.orderBy('createdAt', 'desc').limit(limit);

            const results = await query.get();
            const ratings = [];

            for (const doc of results.docs) {
                const ratingData = { id: doc.id, ...doc.data() };
                
                // Apply client-side filters
                if (filters.userId && ratingData.userId !== filters.userId) continue;
                if (filters.movieId && ratingData.movieId !== filters.movieId) continue;
                
                if (filters.dateFrom) {
                    const dateFrom = filters.dateFrom instanceof Date ? filters.dateFrom : new Date(filters.dateFrom);
                    const ratingDate = ratingData.createdAt?.toDate?.() || new Date(ratingData.createdAt);
                    if (ratingDate < dateFrom) continue;
                }
                
                if (filters.dateTo) {
                    const dateTo = filters.dateTo instanceof Date ? filters.dateTo : new Date(filters.dateTo);
                    const ratingDate = ratingData.createdAt?.toDate?.() || new Date(ratingData.createdAt);
                    if (ratingDate > dateTo) continue;
                }
                
                // Get user info
                try {
                    const userRef = this.db.collection('users').doc(ratingData.userId);
                    const userDoc = await userRef.get();
                    if (userDoc.exists) {
                        ratingData.user = {
                            id: userDoc.id,
                            ...userDoc.data()
                        };
                    }
                } catch (userError) {
                    console.warn('Error loading user for rating:', userError);
                }

                ratings.push(ratingData);
            }

            return ratings;
        } catch (error) {
            console.error('Error getting all ratings with details:', error);
            throw new Error(`Failed to fetch ratings: ${error.message}`, { cause: error });
        }
    }

    /**
     * Delete a rating as admin (includes removing from collections)
     * @param {string} ratingId - Rating document ID
     * @param {string} currentAdminId - ID of admin performing the deletion
     * @returns {Promise<Object>} - Deletion summary
     */
    async deleteRatingAsAdmin(ratingId, currentAdminId) {
        try {
            // Verify admin status
            const isAdmin = await this.isUserAdmin(currentAdminId);
            if (!isAdmin) {
                throw new Error('Unauthorized: Admin access required');
            }

            // Get rating data first
            const ratingRef = this.db.collection('ratings').doc(ratingId);
            const ratingDoc = await ratingRef.get();

            if (!ratingDoc.exists) {
                throw new Error('Rating not found');
            }

            const ratingData = ratingDoc.data();
            const userId = ratingData.userId;
            const movieId = ratingData.movieId;

            const deletionStats = {
                ratingId,
                userId,
                movieId,
                collectionsUpdated: 0,
                success: false
            };

            // Delete rating from Firestore
            await ratingRef.delete();

            // Try to remove movie from user's collections
            // Note: Collections are stored in chrome.storage.sync (browser-local)
            // This only works if we're in the user's browser context
            // For admin panel, we attempt this but it may not work for other users
            try {
                if (typeof CollectionService !== 'undefined' && chrome && chrome.storage) {
                    const collectionService = new CollectionService();
                    const collections = await collectionService.getCollections();
                    
                    let updatedCollections = 0;
                    for (const collection of collections) {
                        if (collection.movieIds && collection.movieIds.includes(movieId)) {
                            await collectionService.removeMovieFromCollection(collection.id, movieId);
                            updatedCollections++;
                        }
                    }
                    deletionStats.collectionsUpdated = updatedCollections;
                }
            } catch (collectionError) {
                console.warn('Could not update collections (may be expected if admin is deleting another user\'s rating):', collectionError);
                // Continue anyway - rating deletion succeeded
            }

            deletionStats.success = true;
            return deletionStats;
        } catch (error) {
            console.error('Error deleting rating as admin:', error);
            throw new Error(`Failed to delete rating: ${error.message}`, { cause: error });
        }
    }

    /**
     * Clear movie cache as admin
     * @param {number} movieId - Kinopoisk movie ID
     * @param {string} currentAdminId - ID of admin performing the action
     * @returns {Promise<Object>} - Result of cache clearing
     */
    async clearMovieCacheAsAdmin(movieId, currentAdminId) {
        try {
            // Verify admin status
            const isAdmin = await this.isUserAdmin(currentAdminId);
            if (!isAdmin) {
                throw new Error('Unauthorized: Admin access required');
            }

            const movieCacheService = this.firebaseManager.getMovieCacheService();
            if (!movieCacheService) {
                throw new Error('MovieCacheService not available');
            }

            await movieCacheService.clearMovieCache(movieId);

            return {
                movieId,
                success: true,
                message: 'Movie cache cleared successfully'
            };
        } catch (error) {
            console.error('Error clearing movie cache as admin:', error);
            throw new Error(`Failed to clear movie cache: ${error.message}`, { cause: error });
        }
    }

    /**
     * Bulk delete movies and their ratings
     * @param {Array<number>} movieIds - Array of Kinopoisk movie IDs
     * @param {string} currentAdminId - ID of admin performing the deletion
     * @returns {Promise<Object>} - Deletion summary
     */
    async bulkDeleteMoviesAndRatings(movieIds, currentAdminId) {
        try {
            // Verify admin status
            const isAdmin = await this.isUserAdmin(currentAdminId);
            if (!isAdmin) {
                throw new Error('Unauthorized: Admin access required');
            }

            const results = {
                moviesDeleted: 0,
                ratingsDeleted: 0,
                errors: []
            };

            // Process each movie
            for (const movieId of movieIds) {
                try {
                    // Delete all ratings for this movie
                    const ratingsSnapshot = await this.db.collection('ratings')
                        .where('movieId', '==', movieId)
                        .get();
                    
                    const ratingDeletePromises = ratingsSnapshot.docs.map(doc => doc.ref.delete());
                    await Promise.all(ratingDeletePromises);
                    results.ratingsDeleted += ratingsSnapshot.size;

                    // Delete movie from cache
                    const movieRef = this.db.collection('movies').doc(movieId.toString());
                    const movieDoc = await movieRef.get();
                    if (movieDoc.exists) {
                        await movieRef.delete();
                        results.moviesDeleted++;
                    }

                    // Clear local storage cache
                    localStorage.removeItem(`kp_movie_${movieId}`);
                } catch (error) {
                    console.error(`Error deleting movie ${movieId}:`, error);
                    results.errors.push({ movieId, error: error.message });
                }
            }

            console.log(`[AdminService] Bulk delete completed:`, results);
            return results;
        } catch (error) {
            console.error('Error in bulk delete:', error);
            throw new Error(`Bulk delete failed: ${error.message}`, { cause: error });
        }
    }

    /**
     * Bulk update movie info from Kinopoisk
     * @param {Array<number>} movieIds - Array of Kinopoisk movie IDs
     * @param {string} currentAdminId - ID of admin performing the update
     * @param {Function} onProgress - Progress callback (current, total)
     * @returns {Promise<Object>} - Update summary
     */
    async bulkUpdateMoviesInfo(movieIds, currentAdminId, onProgress = null) {
        try {
            // Verify admin status
            const isAdmin = await this.isUserAdmin(currentAdminId);
            if (!isAdmin) {
                throw new Error('Unauthorized: Admin access required');
            }

            const results = {
                updated: 0,
                errors: []
            };

            const kinopoiskService = new KinopoiskService();
            const movieCacheService = this.firebaseManager.getMovieCacheService();

            for (let i = 0; i < movieIds.length; i++) {
                const movieId = movieIds[i];
                
                if (onProgress) {
                    onProgress(i + 1, movieIds.length);
                }

                try {
                    // Fetch fresh data from Kinopoisk
                    const freshMovieData = await kinopoiskService.getMovieById(movieId);
                    
                    if (freshMovieData) {
                        // Update Firestore cache
                        await movieCacheService.cacheRatedMovie(freshMovieData);
                        // Clear local storage cache
                        localStorage.removeItem(`kp_movie_${movieId}`);
                        results.updated++;
                    }
                } catch (error) {
                    console.error(`Error updating movie ${movieId}:`, error);
                    results.errors.push({ movieId, error: error.message });
                }
            }

            console.log(`[AdminService] Bulk update completed:`, results);
            return results;
        } catch (error) {
            console.error('Error in bulk update:', error);
            throw new Error(`Bulk update failed: ${error.message}`, { cause: error });
        }
    }

    /**
     * Bulk clear movie caches
     * @param {Array<number>} movieIds - Array of Kinopoisk movie IDs
     * @param {string} currentAdminId - ID of admin performing the action
     * @returns {Promise<Object>} - Result summary
     */
    async bulkClearMoviesCache(movieIds, currentAdminId) {
        try {
            // Verify admin status
            const isAdmin = await this.isUserAdmin(currentAdminId);
            if (!isAdmin) {
                throw new Error('Unauthorized: Admin access required');
            }

            const results = {
                cleared: 0,
                errors: []
            };

            const movieCacheService = this.firebaseManager.getMovieCacheService();

            for (const movieId of movieIds) {
                try {
                    await movieCacheService.clearMovieCache(movieId);
                    results.cleared++;
                } catch (error) {
                    console.error(`Error clearing cache for movie ${movieId}:`, error);
                    results.errors.push({ movieId, error: error.message });
                }
            }

            console.log(`[AdminService] Bulk cache clear completed:`, results);
            return results;
        } catch (error) {
            console.error('Error in bulk cache clear:', error);
            throw new Error(`Bulk cache clear failed: ${error.message}`, { cause: error });
        }
    }

    /**
     * Get all pending user approval requests
     * @returns {Promise<Array>} - Array of pending user profiles
     */
    async getPendingApprovals() {
        try {
            const snapshot = await this.db.collection('users')
                .where('approvalStatus', '==', 'pending')
                .get();

            const pendingUsers = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Sort by createdAt desc (newest registration first)
            return pendingUsers.sort((a, b) => {
                const dateA = a.createdAt?.toDate?.() || (a.createdAt instanceof Date ? a.createdAt : new Date(0));
                const dateB = b.createdAt?.toDate?.() || (b.createdAt instanceof Date ? b.createdAt : new Date(0));
                return dateB - dateA;
            });
        } catch (error) {
            console.error('Error fetching pending approvals:', error);
            throw new Error(`Failed to fetch pending approvals: ${error.message}`, { cause: error });
        }
    }

    /**
     * Get count of pending user approval requests
     * @returns {Promise<number>} - Count of pending users
     */
    async getPendingApprovalsCount() {
        try {
            try {
                const snapshot = await this.db.collection('users')
                    .where('approvalStatus', '==', 'pending')
                    .count()
                    .get();
                return snapshot.data().count;
            } catch {
                const snapshot = await this.db.collection('users')
                    .where('approvalStatus', '==', 'pending')
                    .get();
                return snapshot.size;
            }
        } catch (error) {
            console.error('Error fetching pending approvals count:', error);
            return 0;
        }
    }

    /**
     * Update a user's approval status (Approved, Rejected, Pending)
     * @param {string} userId - User ID to update
     * @param {'approved'|'rejected'|'pending'} newStatus - New approval status
     * @param {string} currentAdminId - ID of admin performing update
     * @returns {Promise<boolean>}
     */
    async updateUserApprovalStatus(userId, newStatus, currentAdminId) {
        try {
            if (currentAdminId) {
                const isAdmin = await this.isUserAdmin(currentAdminId);
                if (!isAdmin) {
                    throw new Error('Unauthorized: Admin access required');
                }
            }

            const validStatuses = ['approved', 'rejected', 'pending'];
            if (!validStatuses.includes(newStatus)) {
                throw new Error(`Invalid approval status: ${newStatus}`);
            }

            const timestamp = (typeof firebase !== 'undefined' && firebase.firestore) ? 
                firebase.firestore.FieldValue.serverTimestamp() : new Date();

            await this.db.collection('users').doc(userId).update({
                approvalStatus: newStatus,
                approvalUpdatedAt: timestamp,
                updatedAt: timestamp
            });

            console.log(`[AdminService] User ${userId} approval status updated to ${newStatus}`);
            return true;
        } catch (error) {
            console.error(`Error updating approval status for user ${userId}:`, error);
            throw new Error(`Failed to update approval status: ${error.message}`, { cause: error });
        }
    }

    /**
     * Batch update approval status for multiple users
     * @param {Array<string>} userIds - Array of User IDs
     * @param {'approved'|'rejected'|'pending'} newStatus - New approval status
     * @param {string} currentAdminId - ID of admin performing update
     * @returns {Promise<{updated: number, failed: number}>}
     */
    async batchUpdateUserApprovalStatus(userIds, newStatus, currentAdminId) {
        try {
            if (!userIds || userIds.length === 0) {
                return { updated: 0, failed: 0 };
            }

            if (currentAdminId) {
                const isAdmin = await this.isUserAdmin(currentAdminId);
                if (!isAdmin) {
                    throw new Error('Unauthorized: Admin access required');
                }
            }

            const validStatuses = ['approved', 'rejected', 'pending'];
            if (!validStatuses.includes(newStatus)) {
                throw new Error(`Invalid approval status: ${newStatus}`);
            }

            const timestamp = (typeof firebase !== 'undefined' && firebase.firestore) ? 
                firebase.firestore.FieldValue.serverTimestamp() : new Date();

            // Process in chunks of 400 (Firestore batch limit is 500)
            const chunkSize = 400;
            let updated = 0;

            for (let i = 0; i < userIds.length; i += chunkSize) {
                const chunk = userIds.slice(i, i + chunkSize);
                const batch = this.db.batch();

                chunk.forEach(uid => {
                    const docRef = this.db.collection('users').doc(uid);
                    batch.update(docRef, {
                        approvalStatus: newStatus,
                        approvalUpdatedAt: timestamp,
                        updatedAt: timestamp
                    });
                });

                await batch.commit();
                updated += chunk.length;
            }

            console.log(`[AdminService] Batch updated ${updated} users to ${newStatus}`);
            return { updated, failed: 0 };
        } catch (error) {
            console.error('Error in batch approval status update:', error);
            throw new Error(`Batch update failed: ${error.message}`, { cause: error });
        }
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdminService;
}
