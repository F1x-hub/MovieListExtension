// Token validation constants
const TOKEN_VALIDATION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const TOKEN_REFRESH_THRESHOLD = 2 * 60 * 60 * 1000; // 2 hours before expiration

class FirebaseManager {
    constructor() {
        this.db = null;
        this.auth = null;
        this.user = null;
        this.isInitialized = false;
        this.tokenRefreshTimeout = null; // For scheduled token refresh
        this.init();
    }

    init() {
        try {
            const firebaseConfig = {
                apiKey: "AIzaSyC6PI4cBRzn6KLVJ6ikensKus6LaulabO4",
                authDomain: "movielistdb-13208.firebaseapp.com",
                projectId: "movielistdb-13208",
                storageBucket: "movielistdb-13208.firebasestorage.app",
                messagingSenderId: "532518163829",
                appId: "1:532518163829:web:36a6a62a14adc188f1af3c",
                measurementId: "G-ERR3F3Z7S4"
              };

            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }

            this.db = firebase.firestore();
            this.auth = firebase.auth();
            this.isInitialized = true;

            this.auth.onAuthStateChanged((user) => {
                this.user = user;
                this.onAuthStateChanged(user);
            });
        } catch (error) {
            console.error('Firebase initialization error:', error);
            this.isInitialized = false;
        }
    }

    async shouldValidateToken() {
        // Check if token validation is needed (more than 24 hours since last validation)
        try {
            if (typeof chrome !== 'undefined' && chrome.storage) {
                const result = await chrome.storage.local.get(['tokenValidationTimestamp']);
                if (!result.tokenValidationTimestamp) {
                    return true; // No validation timestamp, need to validate
                }
                const timeSinceValidation = Date.now() - result.tokenValidationTimestamp;
                return timeSinceValidation >= TOKEN_VALIDATION_TTL; // More than 24 hours
            }
        } catch (error) {
            console.error('[FirebaseManager] Error checking token validation timestamp:', error);
        }
        return true; // Default to validating if we can't check
    }

    scheduleTokenRefresh(user) {
        // Clear any existing scheduled refresh
        if (this.tokenRefreshTimeout) {
            clearTimeout(this.tokenRefreshTimeout);
            this.tokenRefreshTimeout = null;
        }

        // Schedule background token refresh 1-2 hours before 24-hour validation expires
        if (typeof chrome !== 'undefined' && chrome.storage && user) {
            chrome.storage.local.get(['tokenValidationTimestamp'], async (result) => {
                if (result.tokenValidationTimestamp) {
                    const timeSinceValidation = Date.now() - result.tokenValidationTimestamp;
                    const timeUntilExpiry = TOKEN_VALIDATION_TTL - timeSinceValidation;
                    const refreshTime = timeUntilExpiry - TOKEN_REFRESH_THRESHOLD; // 2 hours before expiry

                    if (refreshTime > 0 && refreshTime < TOKEN_VALIDATION_TTL) {
                        console.log(`[FirebaseManager] Scheduling token refresh in ${Math.round(refreshTime / 1000 / 60)} minutes`);
                        this.tokenRefreshTimeout = setTimeout(async () => {
                            try {
                                // Refresh token in background
                                const token = await user.getIdToken();
                                const tokenResult = await user.getIdTokenResult();
                                const expiryTime = tokenResult.expirationTime ? new Date(tokenResult.expirationTime).getTime() : Date.now() + (55 * 60 * 1000);
                                
                                await chrome.storage.local.set({
                                    authToken: token,
                                    authTokenExpiry: expiryTime,
                                    tokenValidationTimestamp: Date.now()
                                });
                                
                                console.log('[FirebaseManager] Token refreshed in background, expires at:', new Date(expiryTime));
                                
                                // Schedule next refresh
                                this.scheduleTokenRefresh(user);
                            } catch (error) {
                                console.error('[FirebaseManager] Error refreshing token in background:', error);
                            }
                        }, refreshTime);
                    }
                }
            });
        }
    }

    async onAuthStateChanged(user) {
        // Sync auth state to chrome.storage for cross-page consistency
        try {
            if (typeof chrome !== 'undefined' && chrome.storage) {
                const storageData = {
                    user: user ? {
                        uid: user.uid,
                        email: user.email,
                        displayName: user.displayName,
                        photoURL: user.photoURL
                    } : null,
                    isAuthenticated: !!user,
                    authTimestamp: Date.now()
                };

                // If user is authenticated, get and store the auth token
                if (user && typeof user.getIdToken === 'function') {
                    try {
                        const needsValidation = await this.shouldValidateToken();
                        const cachedData = await chrome.storage.local.get(['authToken', 'authTokenExpiry']);
                        const now = Date.now();
                        
                        // Check if cached token is still valid (not expired)
                        const cachedTokenValid = cachedData.authToken && 
                                                cachedData.authTokenExpiry && 
                                                now < cachedData.authTokenExpiry;
                        
                        if (!needsValidation && cachedTokenValid) {
                            // Use cached token if validation is not needed and token is still valid
                            storageData.authToken = cachedData.authToken;
                            storageData.authTokenExpiry = cachedData.authTokenExpiry;
                            console.log('[FirebaseManager] Using cached auth token (validation not needed)');
                        } else if (!needsValidation && !cachedTokenValid) {
                            // Token expired but validation is still valid, refresh token without server validation
                            const token = await user.getIdToken(false);
                            const tokenResult = await user.getIdTokenResult(false);
                            const expiryTime = tokenResult.expirationTime ? new Date(tokenResult.expirationTime).getTime() : Date.now() + (55 * 60 * 1000);
                            storageData.authToken = token;
                            storageData.authTokenExpiry = expiryTime;
                            console.log('[FirebaseManager] Auth token refreshed (without server validation), expires at:', new Date(expiryTime));
                        } else {
                            // Need full validation - call getIdToken() which may check with server
                            const token = await user.getIdToken();
                            const tokenResult = await user.getIdTokenResult();
                            const expiryTime = tokenResult.expirationTime ? new Date(tokenResult.expirationTime).getTime() : Date.now() + (55 * 60 * 1000);
                            storageData.authToken = token;
                            storageData.authTokenExpiry = expiryTime;
                            storageData.tokenValidationTimestamp = Date.now();
                            console.log('[FirebaseManager] Auth token validated and saved to chrome.storage, expires at:', new Date(expiryTime));
                            
                            // Schedule background token refresh
                            this.scheduleTokenRefresh(user);
                        }
                    } catch (tokenError) {
                        console.error('[FirebaseManager] Error getting auth token:', tokenError);
                    }
                } else {
                    // Clear token if user is logged out or user object is invalid
                    storageData.authToken = null;
                    storageData.authTokenExpiry = null;
                    storageData.tokenValidationTimestamp = null;
                    // Clear scheduled refresh
                    if (this.tokenRefreshTimeout) {
                        clearTimeout(this.tokenRefreshTimeout);
                        this.tokenRefreshTimeout = null;
                    }
                }

                await chrome.storage.local.set(storageData);
            }
        } catch (error) {
            console.log('Could not sync auth state to storage:', error);
        }

        const event = new CustomEvent('authStateChanged', { 
            detail: { user: user, isAuthenticated: !!user } 
        });
        window.dispatchEvent(event);
    }

    async updateAuthProfile({ displayName, photoURL }) {
        const user = this.getCurrentUser();
        if (!user) throw new Error('No authenticated user');
        
        const updateData = {};
        if (displayName !== undefined) {
            updateData.displayName = displayName;
        }
        if (photoURL !== undefined) {
            if (photoURL && photoURL.length > 2048) {
                console.warn('Photo URL is too long for Firebase Auth. Skipping photoURL update in auth profile.');
            } else {
                updateData.photoURL = photoURL;
            }
        }
        
        if (Object.keys(updateData).length > 0) {
            await user.updateProfile(updateData);
        await user.reload();
        }
        
        this.user = this.auth.currentUser;
        await this.onAuthStateChanged(this.user);
        return this.user;
    }

    async changePasswordWithReauth(currentPassword, newPassword) {
        const user = this.getCurrentUser();
        if (!user || !user.email) throw new Error('No email user');
        const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
        await user.reauthenticateWithCredential(credential);
        await user.updatePassword(newPassword);
        return true;
    }

    async uploadAvatar(file) {
        const user = this.getCurrentUser();
        if (!user) throw new Error('No authenticated user');

        try {
            const token = await user.getIdToken();
            const bucket = 'movielistdb-13208.firebasestorage.app';
            const objectPath = `avatars/${user.uid}/profile.jpg`;
            
            const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?name=${encodeURIComponent(objectPath)}&uploadType=media`;
            
            console.log('Uploading file:', {
                size: file.size,
                type: file.type || 'image/jpeg',
                path: objectPath
            });
            
            const res = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': file.type || 'image/jpeg'
                },
                body: file
            });

            if (!res.ok) {
                const errorText = await res.text();
                console.error('Upload error response:', errorText);
                console.error('Upload URL:', uploadUrl);
                console.error('User UID:', user.uid);
                throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
            }

            const info = await res.json();
            console.log('Upload success, response:', info);
            
            if (info.size && parseInt(info.size) !== file.size) {
                console.warn('File size mismatch! Uploaded:', info.size, 'bytes, Expected:', file.size, 'bytes');
            }
            
            if (info.contentType && info.contentType !== (file.type || 'image/jpeg')) {
                console.warn('Content type mismatch! Uploaded:', info.contentType, 'Expected:', file.type || 'image/jpeg');
            }
            
            const uploadedPath = info.name || objectPath;
            let photoURL;
            if (info && info.downloadTokens && info.downloadTokens.length > 0) {
                const tokenParam = Array.isArray(info.downloadTokens) ? info.downloadTokens[0] : info.downloadTokens;
                photoURL = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(uploadedPath)}?alt=media&token=${tokenParam}`;
            } else if (info && info.downloadTokens) {
                photoURL = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(uploadedPath)}?alt=media&token=${info.downloadTokens}`;
            } else {
                photoURL = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(uploadedPath)}?alt=media`;
            }

            if (photoURL.length > 2048) {
                console.warn('Photo URL is too long for Firebase Auth. Using Storage URL only.');
            }
            
            // Update metadata for cache control
            try {
                const metadataUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}`;
                await fetch(metadataUrl, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        cacheControl: 'public, max-age=31536000'
                    })
                });
            } catch (metaError) {
                console.warn('Failed to update metadata:', metaError);
            }

            return {
                photoURL,
                photoPath: objectPath
            };
        } catch (e) {
            console.error('Avatar upload error:', e);
            throw e;
        }
    }

    async deleteProfilePhoto(photoPath) {
        if (!photoPath) return;

        try {
            const user = this.getCurrentUser();
            if (!user) throw new Error('No authenticated user');

            const token = await user.getIdToken();
            const bucket = 'movielistdb-13208.firebasestorage.app';
            const encodedPath = encodeURIComponent(photoPath);
            const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}`;
            
            const res = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!res.ok && res.status !== 404) {
                const errorText = await res.text();
                console.error('Delete error response:', errorText);
                throw new Error(`Failed to delete photo: ${res.status} ${res.statusText}`);
            }

            return true;
        } catch (error) {
            console.error('Error deleting profile photo:', error);
            throw error;
        }
    }

    async uploadBanner(file) {
        const user = this.getCurrentUser();
        if (!user) throw new Error('No authenticated user');

        try {
            const token = await user.getIdToken();
            const bucket = 'movielistdb-13208.firebasestorage.app';
            // Use a fixed name or timestamped name. Fixed name saves space/cleanup logic.
            const objectPath = `banners/${user.uid}/banner.jpg`;
            
            const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?name=${encodeURIComponent(objectPath)}&uploadType=media`;
            
            console.log('Uploading banner:', {
                size: file.size,
                type: file.type || 'image/jpeg',
                path: objectPath
            });
            
            const res = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': file.type || 'image/jpeg'
                },
                body: file
            });

            if (!res.ok) {
                const errorText = await res.text();
                console.error('Upload error response:', errorText);
                throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
            }

            const info = await res.json();
            
            const uploadedPath = info.name || objectPath;
            let bannerURL;
            if (info && info.downloadTokens) {
                const tokenParam = Array.isArray(info.downloadTokens) ? info.downloadTokens[0] : info.downloadTokens;
                bannerURL = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(uploadedPath)}?alt=media&token=${tokenParam}`;
            } else {
                bannerURL = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(uploadedPath)}?alt=media`;
            }
            
            // Update metadata for cache control
            try {
                const metadataUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}`;
                await fetch(metadataUrl, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        cacheControl: 'public, max-age=31536000'
                    })
                });
            } catch (metaError) {
                console.warn('Failed to update metadata:', metaError);
            }

            return {
                bannerURL,
                bannerPath: objectPath
            };
        } catch (e) {
            console.error('Banner upload error:', e);
            throw e;
        }
    }

    async deleteBanner(bannerPath) {
        if (!bannerPath) return;
        // Reuse delete logic as it's just a path
        return this.deleteProfilePhoto(bannerPath);
    }

    async uploadCollectionIcon(file) {
        const user = this.getCurrentUser();
        if (!user) throw new Error('No authenticated user');

        try {
            const token = await user.getIdToken();
            const bucket = 'movielistdb-13208.firebasestorage.app';
            // Use timestamp to ensure uniqueness and avoid caching issues
            const timestamp = Date.now();
            const objectPath = `collection_icons/${user.uid}/icon_${timestamp}.jpg`;
            
            const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?name=${encodeURIComponent(objectPath)}&uploadType=media`;
            
            console.log('Uploading collection icon:', {
                size: file.size,
                type: file.type || 'image/jpeg',
                path: objectPath
            });
            
            const res = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': file.type || 'image/jpeg'
                },
                body: file
            });

            if (!res.ok) {
                const errorText = await res.text();
                console.error('Upload error response:', errorText);
                throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
            }

            const info = await res.json();
            
            const uploadedPath = info.name || objectPath;
            let iconURL;
            if (info && info.downloadTokens) {
                const tokenParam = Array.isArray(info.downloadTokens) ? info.downloadTokens[0] : info.downloadTokens;
                iconURL = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(uploadedPath)}?alt=media&token=${tokenParam}`;
            } else {
                iconURL = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(uploadedPath)}?alt=media`;
            }
            
            // Update metadata for cache control
            try {
                const metadataUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}`;
                await fetch(metadataUrl, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        cacheControl: 'public, max-age=31536000'
                    })
                });
            } catch (metaError) {
                console.warn('Failed to update metadata:', metaError);
            }

            return {
                iconURL,
                iconPath: objectPath
            };
        } catch (e) {
            console.error('Collection icon upload error:', e);
            throw e;
        }
    }

    async deleteCollectionIcon(iconUrl) {
        if (!iconUrl) return;
        
        // Extract path from URL if possible, or expect path
        // URL format: https://firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH?alt=media...
        let path = iconUrl;
        if (iconUrl.includes('/o/')) {
            try {
                const urlObj = new URL(iconUrl);
                const pathPart = urlObj.pathname.split('/o/')[1];
                if (pathPart) {
                    path = decodeURIComponent(pathPart);
                }
            } catch (e) {
                console.warn('Could not parse icon URL for deletion:', e);
            }
        }

        // Only delete if it looks like a storage path
        if (path.includes('collection_icons/')) {
            return this.deleteProfilePhoto(path);
        }
    }

    async signInWithGoogle() {
        try {
            if (!this.isInitialized) {
                throw new Error('Firebase not initialized');
            }

            return new Promise((resolve, reject) => {
                chrome.identity.getAuthToken({ interactive: true }, (token) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    if (!token) {
                        reject(new Error('No token received'));
                        return;
                    }

                    const credential = firebase.auth.GoogleAuthProvider.credential(null, token);
                    this.auth.signInWithCredential(credential)
                        .then(async (userCredential) => {
                            // Set tokenValidationTimestamp on successful login
                            if (typeof chrome !== 'undefined' && chrome.storage) {
                                await chrome.storage.local.set({
                                    tokenValidationTimestamp: Date.now()
                                });
                            }
                            resolve(userCredential.user);
                        })
                        .catch((error) => {
                            reject(error);
                        });
                });
            });
        } catch (error) {
            throw error;
        }
    }

    async signOut() {
        try {
            await this.auth.signOut();
            chrome.identity.clearAllCachedAuthTokens();
            
            // Clear token validation timestamp and cancel scheduled refresh
            if (typeof chrome !== 'undefined' && chrome.storage) {
                await chrome.storage.local.set({
                    tokenValidationTimestamp: null
                });
            }
            
            if (this.tokenRefreshTimeout) {
                clearTimeout(this.tokenRefreshTimeout);
                this.tokenRefreshTimeout = null;
            }
        } catch (error) {
            throw error;
        }
    }

    async signInWithEmail(email, password) {
        try {
            if (!this.isInitialized) {
                throw new Error('Firebase not initialized');
            }

            const userCredential = await this.auth.signInWithEmailAndPassword(email, password);
            // Set tokenValidationTimestamp on successful login
            if (typeof chrome !== 'undefined' && chrome.storage) {
                await chrome.storage.local.set({
                    tokenValidationTimestamp: Date.now()
                });
            }
            return userCredential.user;
        } catch (error) {
            throw error;
        }
    }

    async createUserWithEmail(email, password) {
        try {
            if (!this.isInitialized) {
                throw new Error('Firebase not initialized');
            }

            const userCredential = await this.auth.createUserWithEmailAndPassword(email, password);
            // Set tokenValidationTimestamp on successful registration
            if (typeof chrome !== 'undefined' && chrome.storage) {
                await chrome.storage.local.set({
                    tokenValidationTimestamp: Date.now()
                });
            }
            return userCredential.user;
        } catch (error) {
            throw error;
        }
    }

    async addRecord(title, content) {
        try {
            if (!this.isInitialized) {
                throw new Error('Firebase not initialized');
            }

            if (!this.user) {
                throw new Error('User not authenticated');
            }

            if (!this.db) {
                throw new Error('Database not available');
            }

            const recordData = {
                title: title,
                content: content,
                userId: this.user.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            const docRef = await this.db.collection('records').add(recordData);
            return { id: docRef.id, ...recordData };
        } catch (error) {
            console.error('Error adding record:', error);
            throw error;
        }
    }

    async getRecords() {
        try {
            if (!this.isInitialized) {
                throw new Error('Firebase not initialized');
            }

            if (!this.user) {
                throw new Error('User not authenticated');
            }

            if (!this.db) {
                throw new Error('Database not available');
            }

            const querySnapshot = await this.db
                .collection('records')
                .where('userId', '==', this.user.uid)
                .orderBy('createdAt', 'desc')
                .get();

            const records = [];
            querySnapshot.forEach((doc) => {
                records.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            return records;
        } catch (error) {
            console.error('Error getting records:', error);
            throw error;
        }
    }

    async updateRecord(recordId, title, content) {
        try {
            if (!this.isInitialized) {
                throw new Error('Firebase not initialized');
            }

            if (!this.user) {
                throw new Error('User not authenticated');
            }

            if (!this.db) {
                throw new Error('Database not available');
            }

            const recordRef = this.db.collection('records').doc(recordId);
            const recordDoc = await recordRef.get();

            if (!recordDoc.exists) {
                throw new Error('Record not found');
            }

            if (recordDoc.data().userId !== this.user.uid) {
                throw new Error('Unauthorized to update this record');
            }

            await recordRef.update({
                title: title,
                content: content,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            return { id: recordId, title, content };
        } catch (error) {
            console.error('Error updating record:', error);
            throw error;
        }
    }

    async deleteRecord(recordId) {
        try {
            if (!this.user) {
                throw new Error('User not authenticated');
            }

            const recordRef = this.db.collection('records').doc(recordId);
            const recordDoc = await recordRef.get();

            if (!recordDoc.exists) {
                throw new Error('Record not found');
            }

            if (recordDoc.data().userId !== this.user.uid) {
                throw new Error('Unauthorized to delete this record');
            }

            await recordRef.delete();
            return true;
        } catch (error) {
            throw error;
        }
    }

    async listenToRecords(callback) {
        try {
            if (!this.user) {
                throw new Error('User not authenticated');
            }

            return this.db
                .collection('records')
                .where('userId', '==', this.user.uid)
                .orderBy('createdAt', 'desc')
                .onSnapshot((querySnapshot) => {
                    const records = [];
                    querySnapshot.forEach((doc) => {
                        records.push({
                            id: doc.id,
                            ...doc.data()
                        });
                    });
                    callback(records);
                });
        } catch (error) {
            throw error;
        }
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return 'Unknown';
        
        const date = timestamp.toDate ? timestamp.toDate() : (timestamp.seconds ? new Date(timestamp.seconds * 1000) : new Date(timestamp));
        const now = new Date();
        const diffInSeconds = Math.floor((now - date) / 1000);

        if (diffInSeconds < 60) {
            return 'Just now';
        } else if (diffInSeconds < 3600) {
            const minutes = Math.floor(diffInSeconds / 60);
            return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        } else if (diffInSeconds < 86400) {
            const hours = Math.floor(diffInSeconds / 3600);
            return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    isAuthenticated() {
        return !!this.user || !!(this.auth && this.auth.currentUser);
    }

    getCurrentUser() {
        // Return cached user or get from auth directly
        return this.user || (this.auth ? this.auth.currentUser : null);
    }

    async waitForAuthReady() {
        return new Promise((resolve) => {
            if (this.user !== null) {
                resolve();
                return;
            }

            const unsubscribe = this.auth.onAuthStateChanged((user) => {
                unsubscribe();
                resolve();
            });

            setTimeout(() => {
                unsubscribe();
                resolve();
            }, 3000);
        });
    }

    // Initialize service instances
    initializeServices() {
        this.movieCacheService = new MovieCacheService(this);
        this.ratingService = new RatingService(this);
        this.userService = new UserService(this);
        this.kinopoiskService = new KinopoiskService();
        this.ratingsCacheService = new RatingsCacheService(this);
        this.watchlistService = new WatchlistService(this);
        this.favoriteService = new FavoriteService(this);
    }

    // Get service instances
    getMovieCacheService() {
        if (!this.movieCacheService) {
            this.movieCacheService = new MovieCacheService(this);
        }
        return this.movieCacheService;
    }

    getRatingService() {
        if (!this.ratingService) {
            this.ratingService = new RatingService(this);
        }
        return this.ratingService;
    }

    getUserService() {
        if (!this.userService) {
            this.userService = new UserService(this);
        }
        return this.userService;
    }

    getKinopoiskService() {
        if (!this.kinopoiskService) {
            this.kinopoiskService = new KinopoiskService();
        }
        return this.kinopoiskService;
    }

    getRatingsCacheService() {
        if (!this.ratingsCacheService) {
            this.ratingsCacheService = new RatingsCacheService(this);
        }
        return this.ratingsCacheService;
    }

    getWatchlistService() {
        if (!this.watchlistService) {
            this.watchlistService = new WatchlistService(this);
        }
        return this.watchlistService;
    }

    getFavoriteService() {
        if (!this.favoriteService) {
            this.favoriteService = new FavoriteService(this);
        }
        return this.favoriteService;
    }
}

const firebaseManager = new FirebaseManager();
window.firebaseManager = firebaseManager;

setTimeout(() => {
    if (window.firebaseManager && window.firebaseManager.isInitialized) {
        window.dispatchEvent(new CustomEvent('firebaseManagerReady'));
    }
}, 100);
