/**
 * UserService - Service for managing user profiles
 * Handles user profile creation, updates, and retrieval
 */
class UserService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.collection = 'users';
    }

    /**
     * Create or update user profile
     * @param {string} userId - Firebase Auth user ID
     * @param {Object} userData - User data from Firebase Auth
     * @returns {Promise<Object>} - Created/updated user profile
     */
    async createOrUpdateUserProfile(userId, userData) {
        try {
            const userProfile = {
                userId,
                displayName: userData.displayName || userData.name || 'Anonymous User',
                photoURL: userData.photoURL || userData.photo || '',
                email: userData.email || '',
                createdAt: userData.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                // Additional profile fields
                bio: userData.bio || '',
                preferences: {
                    theme: userData.preferences?.theme || 'dark',
                    language: userData.preferences?.language || 'en',
                    notifications: userData.preferences?.notifications || true
                },
                stats: {
                    totalRatings: 0,
                    averageRating: 0,
                    joinDate: userData.createdAt || firebase.firestore.FieldValue.serverTimestamp()
                }
            };

            const userRef = this.db.collection(this.collection).doc(userId);
            const userDoc = await userRef.get();

            if (userDoc.exists) {
                // Update existing user
                const updateData = {
                    displayName: userProfile.displayName,
                    photoURL: userProfile.photoURL,
                    email: userProfile.email,
                    updatedAt: userProfile.updatedAt
                };

                // Only update bio and preferences if they're provided
                if (userData.bio !== undefined) updateData.bio = userData.bio;
                if (userData.preferences) {
                    updateData.preferences = {
                        ...userDoc.data().preferences,
                        ...userData.preferences
                    };
                }

                await userRef.update(updateData);
                return { id: userId, ...userDoc.data(), ...updateData };
            } else {
                // Create new user
                await userRef.set(userProfile);
                return { id: userId, ...userProfile };
            }
        } catch (error) {
            console.error('Error creating/updating user profile:', error);
            throw new Error(`Failed to save user profile: ${error.message}`);
        }
    }

    /**
     * Get user profile by ID
     * @param {string} userId - User ID
     * @returns {Promise<Object|null>} - User profile or null
     */
    async getUserProfile(userId) {
        try {
            const userRef = this.db.collection(this.collection).doc(userId);
            const userDoc = await userRef.get();

            if (userDoc.exists) {
                return { id: userDoc.id, ...userDoc.data() };
            }
            return null;
        } catch (error) {
            console.error('Error getting user profile:', error);
            return null;
        }
    }

    /**
     * Update user profile fields
     * @param {string} userId - User ID
     * @param {Object} updateData - Fields to update
     * @returns {Promise<Object>} - Updated user profile
     */
    async updateUserProfile(userId, updateData) {
        try {
            const userRef = this.db.collection(this.collection).doc(userId);
            const userDoc = await userRef.get();

            if (!userDoc.exists) {
                throw new Error('User profile not found');
            }

            const updatePayload = {
                ...updateData,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            await userRef.update(updatePayload);
            const updatedDoc = await userRef.get();
            return { id: userId, ...updatedDoc.data() };
        } catch (error) {
            console.error('Error updating user profile:', error);
            throw new Error(`Failed to update user profile: ${error.message}`);
        }
    }

    /**
     * Update user statistics (ratings count, average rating)
     * @param {string} userId - User ID
     * @param {Object} stats - Statistics to update
     * @returns {Promise<Object>} - Updated user profile
     */
    async updateUserStats(userId, stats) {
        try {
            const userRef = this.db.collection(this.collection).doc(userId);
            
            const updateData = {
                'stats.totalRatings': stats.totalRatings || 0,
                'stats.averageRating': stats.averageRating || 0,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            await userRef.update(updateData);
            const updatedDoc = await userRef.get();
            return { id: userId, ...updatedDoc.data() };
        } catch (error) {
            console.error('Error updating user stats:', error);
            throw new Error(`Failed to update user stats: ${error.message}`);
        }
    }

    /**
     * Get multiple user profiles by IDs
     * @param {Array<string>} userIds - Array of user IDs
     * @returns {Promise<Array>} - Array of user profiles
     */
    async getUserProfilesByIds(userIds) {
        try {
            const profiles = [];
            const batchSize = 10; // Firestore 'in' query limit
            
            for (let i = 0; i < userIds.length; i += batchSize) {
                const batch = userIds.slice(i, i + batchSize);
                const query = this.db.collection(this.collection)
                    .where('userId', 'in', batch);
                
                const results = await query.get();
                results.forEach(doc => {
                    profiles.push({ id: doc.id, ...doc.data() });
                });
            }
            
            return profiles;
        } catch (error) {
            console.error('Error getting user profiles by IDs:', error);
            return [];
        }
    }

    /**
     * Search users by display name
     * @param {string} query - Search query
     * @param {number} limit - Maximum results
     * @returns {Promise<Array>} - Array of matching users
     */
    async searchUsers(query, limit = 20) {
        try {
            const queryLower = query.toLowerCase();
            
            const nameQuery = this.db.collection(this.collection)
                .where('displayName', '>=', query)
                .where('displayName', '<=', query + '\uf8ff')
                .limit(limit);

            const results = await nameQuery.get();
            const users = [];
            
            results.forEach(doc => {
                const data = doc.data();
                if (data.displayName.toLowerCase().includes(queryLower)) {
                    users.push({ id: doc.id, ...data });
                }
            });

            return users;
        } catch (error) {
            console.error('Error searching users:', error);
            return [];
        }
    }

    /**
     * Get user activity (recent ratings)
     * @param {string} userId - User ID
     * @param {number} limit - Maximum results
     * @returns {Promise<Array>} - User's recent activity
     */
    async getUserActivity(userId, limit = 10) {
        try {
            // This would typically join with ratings collection
            // For now, return basic user info
            const userProfile = await this.getUserProfile(userId);
            return userProfile ? [userProfile] : [];
        } catch (error) {
            console.error('Error getting user activity:', error);
            return [];
        }
    }

    /**
     * Delete user profile
     * @param {string} userId - User ID
     * @returns {Promise<boolean>} - Success status
     */
    async deleteUserProfile(userId) {
        try {
            const userRef = this.db.collection(this.collection).doc(userId);
            await userRef.delete();
            return true;
        } catch (error) {
            console.error('Error deleting user profile:', error);
            throw new Error(`Failed to delete user profile: ${error.message}`);
        }
    }

    /**
     * Get user profile with statistics
     * @param {string} userId - User ID
     * @returns {Promise<Object>} - User profile with computed stats
     */
    async getUserProfileWithStats(userId) {
        try {
            const userProfile = await this.getUserProfile(userId);
            if (!userProfile) {
                return null;
            }

            // Get user's rating statistics
            const ratingsQuery = this.db.collection('ratings')
                .where('userId', '==', userId);

            const ratingsResults = await ratingsQuery.get();
            
            let totalRatings = 0;
            let averageRating = 0;
            let recentRatings = [];

            ratingsResults.forEach(doc => {
                const data = doc.data();
                totalRatings++;
                averageRating += data.rating;
                
                if (recentRatings.length < 5) {
                    recentRatings.push({
                        id: doc.id,
                        movieId: data.movieId,
                        rating: data.rating,
                        createdAt: data.createdAt
                    });
                }
            });

            averageRating = totalRatings > 0 ? Math.round((averageRating / totalRatings) * 10) / 10 : 0;

            return {
                ...userProfile,
                computedStats: {
                    totalRatings,
                    averageRating,
                    recentRatings
                }
            };
        } catch (error) {
            console.error('Error getting user profile with stats:', error);
            return null;
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UserService;
} else {
    window.UserService = UserService;
}
