class CollectionService {
    constructor() {
        this.storageKey = 'movieCollections';
        this.defaultIcons = ['🎬', '🎭', '🎨', '🎪', '🎯', '🎲', '🎸', '🎺', '🎻', '🎤', '🎧', '🎮', '🎰', '🎱', '🎳', '🎴', '🎵', '🎶', '🎼', '🎹'];
    }

    async getCollections() {
        try {
            const result = await chrome.storage.sync.get([this.storageKey]);
            return result[this.storageKey] || [];
        } catch (error) {
            console.error('Error getting collections:', error);
            return [];
        }
    }

    async saveCollections(collections) {
        try {
            await chrome.storage.sync.set({ [this.storageKey]: collections });
            return true;
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

            collections.push(newCollection);
            await this.saveCollections(collections);

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

            await this.saveCollections(collections);
            return collections[index];
        } catch (error) {
            console.error('Error updating collection:', error);
            throw error;
        }
    }

    async deleteCollection(collectionId) {
        try {
            const collections = await this.getCollections();
            const filtered = collections.filter(c => c.id !== collectionId);
            
            if (filtered.length === collections.length) {
                throw new Error('Collection not found');
            }

            await this.saveCollections(filtered);
            return true;
        } catch (error) {
            console.error('Error deleting collection:', error);
            throw error;
        }
    }

    async addMovieToCollection(collectionId, movieId) {
        try {
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
        } catch (error) {
            console.error('Error adding movie to collection:', error);
            throw error;
        }
    }

    async removeMovieFromCollection(collectionId, movieId) {
        try {
            const collections = await this.getCollections();
            const collection = collections.find(c => c.id === collectionId);
            
            if (!collection) {
                throw new Error('Collection not found');
            }

            collection.movieIds = collection.movieIds.filter(id => id !== movieId);
            await this.saveCollections(collections);

            return collection;
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
} else {
    window.CollectionService = CollectionService;
}
