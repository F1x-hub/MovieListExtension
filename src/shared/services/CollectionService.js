class CollectionService {
    constructor() {
        this.storageKey = 'movieCollections';
        this.savedIconsKey = 'savedCustomIcons';
        this.defaultIcons = ['🎬', '🎭', '🎨', '🎪', '🎯', '🎲', '🎸', '🎺', '🎻', '🎤', '🎧', '🎮', '🎰', '🎱', '🎳', '🎴', '🎵', '🎶', '🎼', '🎹'];
        
        // Wait for Firebase to be ready before migrating
        if (window.firebaseManager) {
            this.init();
        } else {
            window.addEventListener('firebaseManagerReady', () => this.init());
        }
    }

    async init() {
        // Listen for auth state changes to trigger migration/sync
        if (window.firebaseManager && window.firebaseManager.auth) {
            window.firebaseManager.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    await this.migrateLocalToFirestore(user.uid);
                }
            });
        }
        
        // Initial check
        const user = this.getCurrentUser();
        if (user) {
            await this.migrateLocalToFirestore(user.uid);
        } else {
            this.migrateFromSyncToLocal();
        }
    }

    getCurrentUser() {
        return window.firebaseManager ? window.firebaseManager.getCurrentUser() : null;
    }

    async getSavedIcons() {
        try {
            const user = this.getCurrentUser();
            if (user) {
                // Firestore: users/{userId}/settings/icons
                const docRef = window.firebaseManager.db.collection('users').doc(user.uid).collection('settings').doc('icons');
                const doc = await docRef.get();
                if (doc.exists) {
                    return doc.data().customIcons || [];
                }
                return [];
            } else {
                // Local storage fallback
                const result = await chrome.storage.local.get([this.savedIconsKey]);
                return result[this.savedIconsKey] || [];
            }
        } catch (error) {
            console.error('Error getting saved icons:', error);
            return [];
        }
    }

    async saveCustomIcon(iconData) {
        try {
            const icons = await this.getSavedIcons();
            if (!icons.includes(iconData)) {
                // Add to beginning of array
                icons.unshift(iconData);
                // Limit to 50 saved icons
                if (icons.length > 50) {
                    icons.pop();
                }

                const user = this.getCurrentUser();
                if (user) {
                    // Firestore
                    const docRef = window.firebaseManager.db.collection('users').doc(user.uid).collection('settings').doc('icons');
                    await docRef.set({ customIcons: icons }, { merge: true });
                } else {
                    // Local storage
                    await chrome.storage.local.set({ [this.savedIconsKey]: icons });
                }
            }
            return true;
        } catch (error) {
            console.error('Error saving custom icon:', error);
            return false;
        }
    }

    async deleteSavedIcon(iconData) {
        try {
            const icons = await this.getSavedIcons();
            const newIcons = icons.filter(icon => icon !== iconData);
            
            const user = this.getCurrentUser();
            if (user) {
                // Firestore
                const docRef = window.firebaseManager.db.collection('users').doc(user.uid).collection('settings').doc('icons');
                await docRef.set({ customIcons: newIcons }, { merge: true });
            } else {
                // Local storage
                await chrome.storage.local.set({ [this.savedIconsKey]: newIcons });
            }
            return true;
        } catch (error) {
            console.error('Error deleting saved icon:', error);
            return false;
        }
    }

    async migrateFromSyncToLocal() {
        try {
            // Check if data exists in sync
            const syncData = await chrome.storage.sync.get([this.storageKey]);
            if (syncData[this.storageKey] && syncData[this.storageKey].length > 0) {
                console.log('Found collections in sync storage. Merging into local storage...');
                
                // Get existing local data
                const localData = await chrome.storage.local.get([this.storageKey]);
                let localCollections = localData[this.storageKey] || [];
                
                const syncCollections = syncData[this.storageKey];
                let addedCount = 0;

                // Merge sync collections into local collections
                syncCollections.forEach(syncCollection => {
                    // Check if collection already exists in local (by ID)
                    const exists = localCollections.some(c => c.id === syncCollection.id);
                    if (!exists) {
                        localCollections.push(syncCollection);
                        addedCount++;
                    }
                });

                if (addedCount > 0) {
                    await chrome.storage.local.set({ [this.storageKey]: localCollections });
                    console.log(`Merged ${addedCount} collections from sync to local.`);
                } else {
                    console.log('All sync collections already exist in local.');
                }

                // Clear sync storage after successful merge
                await chrome.storage.sync.remove(this.storageKey);
                console.log('Cleared sync storage.');
            }
        } catch (error) {
            console.error('Error migrating collections:', error);
        }
    }

    async migrateLocalToFirestore(userId) {
        try {
            // Check for local collections
            const localData = await chrome.storage.local.get([this.storageKey, this.savedIconsKey]);
            const localCollections = localData[this.storageKey] || [];
            const localIcons = localData[this.savedIconsKey] || [];

            if (localCollections.length === 0 && localIcons.length === 0) return;

            console.log('Migrating local data to Firestore for user:', userId);
            const batch = window.firebaseManager.db.batch();
            const userCollectionsRef = window.firebaseManager.db.collection('users').doc(userId).collection('collections');

            // Migrate collections
            for (const collection of localCollections) {
                // Check if already exists in Firestore to avoid overwrites/duplicates if needed
                // For now, we'll use set with merge: true, using the same ID
                const docRef = userCollectionsRef.doc(collection.id);
                batch.set(docRef, {
                    ...collection,
                    userId: userId,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }

            // Migrate icons
            if (localIcons.length > 0) {
                const iconsRef = window.firebaseManager.db.collection('users').doc(userId).collection('settings').doc('icons');
                // We need to get existing firestore icons to merge, but batch writes are write-only.
                // So we'll do a separate transaction or just overwrite/append via arrayUnion if possible, 
                // but arrayUnion with large base64 strings might be tricky. 
                // Simplest strategy: Read Firestore icons first, merge, then write.
                // Since we are inside migrate, let's just do a direct set for icons outside the batch or before.
                
                const currentIconsDoc = await iconsRef.get();
                let currentIcons = currentIconsDoc.exists ? currentIconsDoc.data().customIcons || [] : [];
                
                // Merge unique
                const newIcons = [...new Set([...localIcons, ...currentIcons])].slice(0, 50);
                batch.set(iconsRef, { customIcons: newIcons }, { merge: true });
            }

            await batch.commit();
            console.log('Migration to Firestore complete.');

            // Clear local storage after successful migration
            // We keep them in local storage as a cache? No, user wants them in Firestore.
            // But if we clear them, offline access is lost unless we implement caching.
            // For now, let's clear them to avoid confusion/duplication, assuming online-first.
            // Or better, we just stop using local storage when logged in.
            // Let's clear to be clean.
            await chrome.storage.local.remove([this.storageKey, this.savedIconsKey]);

        } catch (error) {
            console.error('Error migrating to Firestore:', error);
        }
    }

    async getCollections() {
        try {
            const user = this.getCurrentUser();
            if (user) {
                // Firestore
                const snapshot = await window.firebaseManager.db.collection('users').doc(user.uid).collection('collections').get();
                const collections = [];
                snapshot.forEach(doc => {
                    collections.push(doc.data());
                });
                return collections;
            } else {
                // Local Storage
                const result = await chrome.storage.local.get([this.storageKey]);
                return result[this.storageKey] || [];
            }
        } catch (error) {
            console.error('Error getting collections:', error);
            return [];
        }
    }

    async saveCollections(collections) {
        // This method is largely replaced by individual Firestore operations
        // or by the local storage fallback in other methods.
        // It's kept for local storage fallback consistency if needed,
        // but Firestore operations will handle saving directly.
        try {
            const user = this.getCurrentUser();
            if (user) {
                // For Firestore, we don't save all collections at once like this.
                // Individual create/update/delete operations handle it.
                // This path should ideally not be hit if Firestore is active.
                console.warn('saveCollections called with active user. This method is deprecated for Firestore.');
                return true; // Assume success if individual ops are used
            } else {
                await chrome.storage.local.set({ [this.storageKey]: collections });
                return true;
            }
        } catch (error) {
            console.error('Error saving collections:', error);
            throw new Error(`Failed to save collections: ${error.message}`);
        }
    }

    async createCollection(name, icon = null) {
        try {
            if (!name || name.trim().length === 0) {
                throw new Error('Collection name is required');
            }

            if (name.length > 50) {
                throw new Error('Collection name must be 50 characters or less');
            }

            const collections = await this.getCollections();
            
            const existingCollection = collections.find(c => c.name.toLowerCase() === name.toLowerCase().trim());
            if (existingCollection) {
                throw new Error('Collection with this name already exists');
            }

            const newCollection = {
                id: `collection_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: name.trim(),
                icon: icon || this.getRandomIcon(),
                movieIds: [],
                createdAt: Date.now()
            };

            const user = this.getCurrentUser();
            if (user) {
                // Firestore
                await window.firebaseManager.db.collection('users').doc(user.uid).collection('collections').doc(newCollection.id).set({
                    ...newCollection,
                    userId: user.uid,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // Local Storage
                collections.push(newCollection);
                await this.saveCollections(collections);
            }

            return newCollection;
        } catch (error) {
            console.error('Error creating collection:', error);
            throw error;
        }
    }

    async updateCollection(collectionId, updates) {
        try {
            const collections = await this.getCollections();
            const index = collections.findIndex(c => c.id === collectionId);
            
            if (index === -1) {
                throw new Error('Collection not found');
            }

            if (updates.name !== undefined) {
                if (!updates.name || updates.name.trim().length === 0) {
                    throw new Error('Collection name is required');
                }
                if (updates.name.length > 50) {
                    throw new Error('Collection name must be 50 characters or less');
                }
                
                const existingCollection = collections.find(c => 
                    c.id !== collectionId && c.name.toLowerCase() === updates.name.toLowerCase().trim()
                );
                if (existingCollection) {
                    throw new Error('Collection with this name already exists');
                }
                
                collections[index].name = updates.name.trim();
            }

            if (updates.icon !== undefined) {
                collections[index].icon = updates.icon;
            }

            const user = this.getCurrentUser();
            if (user) {
                // Firestore
                await window.firebaseManager.db.collection('users').doc(user.uid).collection('collections').doc(collectionId).update({
                    ...updates,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // Local Storage
                await this.saveCollections(collections);
            }
            return collections[index];
        } catch (error) {
            console.error('Error updating collection:', error);
            throw error;
        }
    }

    async deleteCollection(collectionId) {
        try {
            const user = this.getCurrentUser();
            if (user) {
                // Firestore
                await window.firebaseManager.db.collection('users').doc(user.uid).collection('collections').doc(collectionId).delete();
            } else {
                // Local Storage
                const collections = await this.getCollections();
                const filtered = collections.filter(c => c.id !== collectionId);
                
                if (filtered.length === collections.length) {
                    throw new Error('Collection not found');
                }

                await this.saveCollections(filtered);
            }
            return true;
        } catch (error) {
            console.error('Error deleting collection:', error);
            throw error;
        }
    }

    async addMovieToCollection(collectionId, movieId) {
        try {
            const user = this.getCurrentUser();
            if (user) {
                // Firestore
                const collectionRef = window.firebaseManager.db.collection('users').doc(user.uid).collection('collections').doc(collectionId);
                
                await collectionRef.update({
                    movieIds: firebase.firestore.FieldValue.arrayUnion(movieId),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                // Return updated collection (simulated or fetched)
                // For performance, we can just return what we know
                const collection = await this.getCollection(collectionId);
                return collection;
            } else {
                // Local Storage
                const collections = await this.getCollections();
                const collection = collections.find(c => c.id === collectionId);
                
                if (!collection) {
                    throw new Error('Collection not found');
                }

                if (!collection.movieIds.includes(movieId)) {
                    collection.movieIds.push(movieId);
                    await this.saveCollections(collections);
                }

                return collection;
            }
        } catch (error) {
            console.error('Error adding movie to collection:', error);
            throw error;
        }
    }

    async removeMovieFromCollection(collectionId, movieId) {
        try {
            const user = this.getCurrentUser();
            if (user) {
                // Firestore
                const collectionRef = window.firebaseManager.db.collection('users').doc(user.uid).collection('collections').doc(collectionId);
                
                await collectionRef.update({
                    movieIds: firebase.firestore.FieldValue.arrayRemove(movieId),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                const collection = await this.getCollection(collectionId);
                return collection;
            } else {
                // Local Storage
                const collections = await this.getCollections();
                const collection = collections.find(c => c.id === collectionId);
                
                if (!collection) {
                    throw new Error('Collection not found');
                }

                collection.movieIds = collection.movieIds.filter(id => id !== movieId);
                await this.saveCollections(collections);

                return collection;
            }
        } catch (error) {
            console.error('Error removing movie from collection:', error);
            throw error;
        }
    }

    async toggleMovieInCollection(collectionId, movieId) {
        try {
            const collections = await this.getCollections();
            const collection = collections.find(c => c.id === collectionId);
            
            if (!collection) {
                throw new Error('Collection not found');
            }

            const isInCollection = collection.movieIds.includes(movieId);
            
            if (isInCollection) {
                return await this.removeMovieFromCollection(collectionId, movieId);
            } else {
                return await this.addMovieToCollection(collectionId, movieId);
            }
        } catch (error) {
            console.error('Error toggling movie in collection:', error);
            throw error;
        }
    }

    async getMoviesInCollection(collectionId) {
        try {
            const collections = await this.getCollections();
            const collection = collections.find(c => c.id === collectionId);
            
            if (!collection) {
                return [];
            }

            return collection.movieIds || [];
        } catch (error) {
            console.error('Error getting movies in collection:', error);
            return [];
        }
    }

    async getCollectionsForMovie(movieId) {
        try {
            const collections = await this.getCollections();
            return collections.filter(c => c.movieIds.includes(movieId));
        } catch (error) {
            console.error('Error getting collections for movie:', error);
            return [];
        }
    }

    async isMovieInCollection(collectionId, movieId) {
        try {
            const movies = await this.getMoviesInCollection(collectionId);
            return movies.includes(movieId);
        } catch (error) {
            console.error('Error checking movie in collection:', error);
            return false;
        }
    }

    getRandomIcon() {
        return this.defaultIcons[Math.floor(Math.random() * this.defaultIcons.length)];
    }

    async getCollectionCount(collectionId) {
        try {
            const movies = await this.getMoviesInCollection(collectionId);
            return movies.length;
        } catch (error) {
            console.error('Error getting collection count:', error);
            return 0;
        }
    }

    async getCollection(collectionId) {
        try {
            if (!collectionId) {
                return null;
            }

            const collections = await this.getCollections();
            return collections.find(c => c.id === collectionId) || null;
        } catch (error) {
            console.error('Error getting collection:', error);
            return null;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CollectionService;
}
if (typeof window !== 'undefined') {
    window.CollectionService = CollectionService;
}
