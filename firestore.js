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

    onAuthStateChanged(user) {
        const event = new CustomEvent('authStateChanged', { 
            detail: { user: user, isAuthenticated: !!user } 
        });
        window.dispatchEvent(event);
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
        return !!this.user;
    }

    getCurrentUser() {
        return this.user;
    }
}

const firebaseManager = new FirebaseManager();
