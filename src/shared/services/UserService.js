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
            const displayName = userData.displayName || userData.name || 'Anonymous User';
            const nameParts = displayName.split(' ');
            const firstName = userData.firstName || nameParts[0] || '';
            const lastName = userData.lastName || nameParts.slice(1).join(' ') || '';
            const username = userData.username || this.generateUsernameFromEmail(userData.email) || 'user';

            const userProfile = {
                userId,
                displayName,
                firstName,
                lastName,
                username,
                usernameLower: username.toLowerCase(),
                photoURL: userData.photoURL || userData.photo || '',
                photoPath: userData.photoPath || '',
                email: userData.email || '',
                createdAt: userData.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                bio: userData.bio || '',
                displayNameFormat: userData.displayNameFormat || 'fullname',
                favoriteGenre: userData.favoriteGenre || '',
                isAdmin: userData.isAdmin || false, // Admin status, defaults to false
                socialLinks: userData.socialLinks || {
                    twitter: '',
                    instagram: '',
                    facebook: ''
                },
                preferences: {
                    theme: userData.preferences?.theme || 'dark',
                    language: userData.preferences?.language || 'en',
                    notifications: userData.preferences?.notifications || true
                },
                stats: {
                    totalRatings: 0,
                    averageRating: 0,
                    favoritesCount: 0,
                    watchlistCount: 0,
                    joinDate: userData.createdAt || firebase.firestore.FieldValue.serverTimestamp()
                }
            };

            const userRef = this.db.collection(this.collection).doc(userId);
            const userDoc = await userRef.get();

            if (userDoc.exists) {
                const existingData = userDoc.data();
                const updateData = {
                    displayName: userProfile.displayName,
                    photoURL: userProfile.photoURL,
                    email: userProfile.email,
                    updatedAt: userProfile.updatedAt
                };

                if (userData.firstName !== undefined) updateData.firstName = userData.firstName;
                if (userData.lastName !== undefined) updateData.lastName = userData.lastName;
                if (userData.username !== undefined) {
                    updateData.username = userData.username;
                    updateData.usernameLower = userData.username.toLowerCase();
                }
                if (userData.usernameLower !== undefined) updateData.usernameLower = userData.usernameLower;
                if (userData.bio !== undefined) updateData.bio = userData.bio;
                if (userData.displayNameFormat !== undefined) updateData.displayNameFormat = userData.displayNameFormat;
                if (userData.favoriteGenre !== undefined) updateData.favoriteGenre = userData.favoriteGenre;
                if (userData.photoPath !== undefined) updateData.photoPath = userData.photoPath;
                // Preserve isAdmin status - never override unless explicitly set
                if (userData.isAdmin !== undefined) updateData.isAdmin = userData.isAdmin;
                if (userData.socialLinks) {
                    updateData.socialLinks = {
                        ...(existingData.socialLinks || {}),
                        ...userData.socialLinks
                    };
                }
                if (userData.preferences) {
                    updateData.preferences = {
                        ...(existingData.preferences || {}),
                        ...userData.preferences
                    };
                }

                await userRef.update(updateData);
                return { id: userId, ...existingData, ...updateData };
            } else {
                await userRef.set(userProfile);
                return { id: userId, ...userProfile };
            }
        } catch (error) {
            console.error('Error creating/updating user profile:', error);
            throw new Error(`Failed to save user profile: ${error.message}`);
        }
    }

    /**
     * Generate username from email
     * @param {string} email - Email address
     * @returns {string} - Generated username
     */
    generateUsernameFromEmail(email) {
        if (!email) return 'user';
        const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_');
        return username || 'user';
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

            if (updateData.username && !updateData.usernameLower) {
                updatePayload.usernameLower = updateData.username.toLowerCase();
            }

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

            if (!userProfile.firstName && userProfile.displayName) {
                const nameParts = userProfile.displayName.split(' ');
                userProfile.firstName = nameParts[0] || '';
                userProfile.lastName = nameParts.slice(1).join(' ') || '';
            }

            if (!userProfile.username && userProfile.email) {
                userProfile.username = this.generateUsernameFromEmail(userProfile.email);
            }

            if (userProfile.username && !userProfile.usernameLower) {
                userProfile.usernameLower = userProfile.username.toLowerCase();
            }

            if (!userProfile.socialLinks) {
                userProfile.socialLinks = {
                    twitter: '',
                    instagram: '',
                    facebook: ''
                };
            }

            return userProfile;
        } catch (error) {
            console.error('Error getting user profile with stats:', error);
            return null;
        }
    }

    /**
     * Check if username is available
     * @param {string} username - Username to check
     * @param {string} currentUserId - Current user ID (to exclude from check)
     * @returns {Promise<boolean>} - True if username is available
     */
    async isUsernameAvailable(username, currentUserId) {
        try {
            if (!username || username.trim() === '') {
                return false;
            }

            const usernameLower = username.toLowerCase().trim();
            const query = this.db.collection(this.collection)
                .where('usernameLower', '==', usernameLower);

            const snapshot = await query.get();

            if (snapshot.empty) {
                return true;
            }

            if (snapshot.docs.length === 1 && snapshot.docs[0].id === currentUserId) {
                return true;
            }

            return false;
        } catch (error) {
            console.error('Error checking username availability:', error);
            return false;
        }
    }

    /**
     * Get user statistics
     * @param {string} userId - User ID
     * @returns {Promise<Object>} - Statistics object
     */
    async getUserStats(userId) {
        try {
            const ratingsQuery = this.db.collection('ratings')
                .where('userId', '==', userId);

            const favoritesQuery = this.db.collection('ratings')
                .where('userId', '==', userId)
                .where('isFavorite', '==', true);

            const watchlistQuery = this.db.collection('watchlist')
                .where('userId', '==', userId);

            const [ratingsSnapshot, favoritesSnapshot, watchlistSnapshot] = await Promise.all([
                ratingsQuery.get(),
                favoritesQuery.get(),
                watchlistQuery.get()
            ]);

            let totalRatings = 0;
            let sumRatings = 0;

            ratingsSnapshot.forEach(doc => {
                const data = doc.data();
                if (data.rating) {
                    totalRatings++;
                    sumRatings += data.rating;
                }
            });

            const averageRating = totalRatings > 0 
                ? Math.round((sumRatings / totalRatings) * 10) / 10 
                : 0;

            return {
                totalRatings,
                averageRating,
                favoritesCount: favoritesSnapshot.size,
                watchlistCount: watchlistSnapshot.size
            };
        } catch (error) {
            console.error('Error getting user stats:', error);
            return {
                totalRatings: 0,
                averageRating: 0,
                favoritesCount: 0,
                watchlistCount: 0
            };
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UserService;
}
if (typeof window !== 'undefined') {
    window.UserService = UserService;
}
