class FirebaseManager {
    constructor() {
        this.db = null;
        this.auth = null;
        this.user = null;
        this.isInitialized = false;
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

    async onAuthStateChanged(user) {
        // Sync auth state to chrome.storage for cross-page consistency
        try {
            if (typeof chrome !== 'undefined' && chrome.storage) {
                await chrome.storage.local.set({
                    user: user ? {
                        uid: user.uid,
                        email: user.email,
                        displayName: user.displayName,
                        photoURL: user.photoURL
                    } : null,
                    isAuthenticated: !!user,
                    authTimestamp: Date.now()
                });
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
        await user.updateProfile({ displayName, photoURL });
        await user.reload();
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
            const objectPath = `users/${user.uid}/profile.jpg`;
            const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?name=${encodeURIComponent(objectPath)}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Firebase ${token}`, 'Content-Type': file.type || 'application/octet-stream' },
                body: file
            });
            if (!res.ok) throw new Error('upload failed');
            const info = await res.json();
            let photoURL;
            if (info && info.downloadTokens) {
                photoURL = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=${info.downloadTokens}`;
            } else {
                photoURL = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media`;
            }
            
            return {
                photoURL,
                photoPath: objectPath
            };
        } catch (e) {
            console.error('Avatar upload error:', e);
            const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(file);
            });
            return {
                photoURL: dataUrl,
                photoPath: ''
            };
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
                headers: { 'Authorization': `Firebase ${token}` }
            });

            if (!res.ok && res.status !== 404) {
                throw new Error('Failed to delete photo');
            }

            return true;
        } catch (error) {
            console.error('Error deleting profile photo:', error);
            throw error;
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
                        .then((userCredential) => {
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
        
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
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
