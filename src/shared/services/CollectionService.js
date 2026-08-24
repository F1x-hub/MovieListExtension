class CollectionService {
    constructor() {
        this.storageKey = 'movieCollections';
        this.defaultIcons = [
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>',
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM8 15c0-1.66 1.34-3 3-3 .35 0 .69.07 1 .18V6h5v2h-3v7.03c-.02 1.64-1.35 2.97-3 2.97-1.66 0-3-1.34-3-3z"/></svg>',
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H3V8h18v8zM9 10v4l4-2z"/></svg>',
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/></svg>',
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.11-.9-2-2-2zm0 14H3V5h18v12z"/></svg>'
        ];
    }

    getCurrentUser() {
        return window.firebaseManager ? window.firebaseManager.getCurrentUser() : null;
    }

    async getSavedIcons() {
        try {
            // Local storage fallback (or just return empty if user wants to disable history completely)
            // Keeping local storage for now as it doesn't affect Firestore settings
            const result = await chrome.storage.local.get([this.savedIconsKey]);
            return result[this.savedIconsKey] || [];
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

                // Local storage only
                await chrome.storage.local.set({ [this.savedIconsKey]: icons });
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
            
            // Local storage only
            await chrome.storage.local.set({ [this.savedIconsKey]: newIcons });
            return true;
        } catch (error) {
            console.error('Error deleting saved icon:', error);
            return false;
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
            throw new Error(`Failed to save collections: ${error.message}`, { cause: error });
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
                const docRef = window.firebaseManager.db.collection('users').doc(user.uid).collection('collections').doc(collectionId);
                
                // Get collection to check for custom icon
                const doc = await docRef.get();
                if (doc.exists) {
                    const collection = doc.data();
                    
                    // If icon is custom (not in default list/has storage path), try to delete it
                    if (collection.icon && 
                        window.firebaseManager && 
                        typeof window.firebaseManager.deleteCollectionIcon === 'function') {
                        
                        // We rely on deleteCollectionIcon to safe-check if it's a storage URL
                        await window.firebaseManager.deleteCollectionIcon(collection.icon).catch(err => {
                            console.warn('Failed to delete collection icon from storage:', err);
                            // Continue with collection deletion even if icon deletion fails
                        });
                    }

                    await docRef.delete();
                }
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
