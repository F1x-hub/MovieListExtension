/**
 * AdminService - Handles administrative operations like user management
 */
class AdminService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.firebaseManager = firebaseManager;
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

    /**
     * Get all users with their statistics
     * @returns {Promise<Array>} - Array of user objects with stats
     */
    async getAllUsers() {
        try {
            const usersSnapshot = await this.db.collection('users').get();
            const users = [];

            for (const doc of usersSnapshot.docs) {
                const userData = doc.data();
                
                // Get user's rating count
                const ratingsSnapshot = await this.db
                    .collection('ratings')
                    .where('userId', '==', doc.id)
                    .get();
                
                // Get user's collection count
                const collectionSnapshot = await this.db
                    .collection('collections')
                    .where('userId', '==', doc.id)
                    .get();

                users.push({
                    id: doc.id,
                    ...userData,
                    ratingsCount: ratingsSnapshot.size,
                    collectionCount: collectionSnapshot.size
                });
            }

            return users.sort((a, b) => {
                // Sort by creation date (newest first)
                const dateA = a.createdAt?.toDate?.() || new Date(0);
                const dateB = b.createdAt?.toDate?.() || new Date(0);
                return dateB - dateA;
            });
        } catch (error) {
            console.error('Error getting all users:', error);
            throw new Error(`Failed to fetch users: ${error.message}`);
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
            
            deletionStats.success = true;
            return deletionStats;
        } catch (error) {
            console.error('Error deleting user:', error);
            throw new Error(`Failed to delete user: ${error.message}`);
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
            throw new Error(`Failed to get deletion preview: ${error.message}`);
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
            throw new Error(`Failed to fetch ratings: ${error.message}`);
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
            throw new Error(`Failed to delete rating: ${error.message}`);
        }
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdminService;
}
