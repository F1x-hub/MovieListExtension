class CollectionService {
    constructor() {
        this.storageKey = 'movieCollections';
        this.defaultIcons = [
            '<svg data-icon="MOVIE_CLAPPER" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2.27 3.28L5.78 2.47L5.12 6.73L2.2 7.4L1.53 4.48Q1.3 3.5 2.27 3.28ZM7.54 2.06L11.04 1.25L10.38 5.51L6.88 6.32ZM12.8 0.85L15.92 0.13Q16.89 -0.1 17.12 0.88L17.79 3.8L12.14 5.11Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9H17V15A2 2 0 0 1 15 17H5A2 2 0 0 1 3 15Z"/></svg>',
            '<svg data-icon="MUSIC_CARD" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.4 12.6V6.4H13"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M8.8 10.7A2.1 2.1 0 1 0 8.8 14.9A2.1 2.1 0 1 0 8.8 10.7Z"/></svg>',
            '<svg data-icon="PLAY_BOX" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M8 7.2C8 6.6 8.7 6.2 9.2 6.6L13 9.3C13.5 9.7 13.5 10.3 13 10.7L9.2 13.4C8.7 13.8 8 13.4 8 12.8Z"/></svg>',
            '<svg data-icon="SEARCH" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3A6 6 0 1 0 9 15A6 6 0 1 0 9 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M9 3L9 15C12.32 15 15 12.31 15 9C15 5.69 12.32 3 9 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M13.6 13.6L17.6 17.6"/></svg>',
            '<svg data-icon="WATCHED" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6.6 10.2L9 12.6L13.4 7.6"/></svg>',
            '<svg data-icon="RATED" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M10 2.3L12.59 7.14L17.99 8.1L14.18 12.06L14.94 17.5L10 15.1L5.06 17.5L5.82 12.06L2.01 8.1L7.41 7.14Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 2.31L10 15.1L14.94 17.5L14.18 12.06L17.99 8.1L12.59 7.14L10 2.31Z"/></svg>',
            '<svg data-icon="CALENDAR" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 3H15A3 3 0 0 1 18 6V8H2V6A3 3 0 0 1 5 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 1H7V4H5ZM13 1H15V4H13Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8V15A2 2 0 0 0 5 17H15A2 2 0 0 0 17 15V8"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M11.75 11H13.25A0.75 0.75 0 0 1 14 11.75V13.25A0.75 0.75 0 0 1 13.25 14H11.75A0.75 0.75 0 0 1 11 13.25V11.75A0.75 0.75 0 0 1 11.75 11Z"/></svg>',
            '<svg data-icon="USER" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 2A4 4 0 1 0 10 10A4 4 0 1 0 10 2Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 12C13.6 12 16 13.8 16.6 16.2C16.7 16.7 16.4 17 15.9 17H4.1C3.6 17 3.3 16.7 3.4 16.2C4 13.8 6.4 12 10 12Z"/></svg>',
            '<svg data-icon="TV" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6.6 2L10 5L13.4 2"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 6H15A2 2 0 0 1 17 8V15A2 2 0 0 1 15 17H5A2 2 0 0 1 3 15V8A2 2 0 0 1 5 6Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M12 6H15A2 2 0 0 1 17 8V15A2 2 0 0 1 15 17H12ZM14.6 8.4A1 1 0 1 0 14.6 10.4A1 1 0 1 0 14.6 8.4ZM14.6 11.8A1 1 0 1 0 14.6 13.8A1 1 0 1 0 14.6 11.8Z"/></svg>'
        ];
    }

    static FALLBACK_ICON = '<svg data-icon="FOLDER" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2 9V6A2 2 0 0 1 4 4H7.6A2 2 0 0 1 9 4.6L10.4 6H16A2 2 0 0 1 18 8V9Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9V14A2 2 0 0 0 5 16H15A2 2 0 0 0 17 14V9"/></svg>';
    static iconHtmlCache = new Map();

    /**
     * A picture from the removed icon upload: a data: URL or a Storage URL. Its
     * Storage files are deleted, so it is drawn as the folder icon instead.
     */
    static isUploadedIcon(icon) {
        return typeof icon === 'string' && /^(?:data:|https?:\/\/)/i.test(icon.trim());
    }

    /** Whether a stored icon can be drawn as it is (an emoji or whole SVG markup). */
    static isUsableIcon(icon) {
        const value = typeof icon === 'string' ? icon.trim() : '';
        if (!value || CollectionService.isUploadedIcon(value)) return false;
        if (!value.startsWith('<')) return [...value].length <= 8;
        return Boolean(CollectionService.parseSvgIcon(value));
    }

    /**
     * Parses stored SVG markup strictly. A truncated value, such as the
     * `<svg viewBox=` left by the old icon picker, returns null instead of being
     * completed by the HTML parser into an element that swallows its neighbours.
     */
    static parseSvgIcon(markup) {
        if (typeof markup !== 'string' || !/^<svg[\s>]/i.test(markup) || typeof DOMParser === 'undefined') return null;
        const source = /^<svg\b[^>]*\bxmlns\s*=/i.test(markup)
            ? markup
            : markup.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
        const svg = doc.documentElement;
        if (!svg || svg.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg'
            || doc.getElementsByTagName('parsererror').length > 0) return null;
        svg.querySelectorAll('script, style, foreignObject').forEach(node => node.remove());
        [svg, ...svg.querySelectorAll('*')].forEach(element => {
            [...element.attributes].forEach(({ name, value }) => {
                const lower = name.toLowerCase();
                const externalLink = (lower === 'href' || lower === 'xlink:href') && !value.trim().startsWith('#');
                if (lower.startsWith('on') || externalLink) element.removeAttribute(name);
            });
        });
        return svg;
    }

    /**
     * Markup for a collection icon in a box of `size` pixels. Every render site
     * uses it, so an icon never sizes itself from its container and an
     * unreadable value shows the folder icon instead of breaking the row.
     */
    static renderIconHtml(icon, { size = 16 } = {}) {
        const stored = typeof icon === 'string' ? icon.trim() : '';
        const value = CollectionService.isUploadedIcon(stored) ? '' : stored;
        const px = Number(size) > 0 ? Number(size) : 16;
        const key = `${px}|${value}`;
        const cache = CollectionService.iconHtmlCache;
        if (cache.has(key)) return cache.get(key);

        let html;
        if (value && !value.startsWith('<') && [...value].length <= 8) {
            const text = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html = `<span aria-hidden="true" style="display: inline-flex; align-items: center; justify-content: center; width: ${px}px; height: ${px}px; font-size: ${Math.round(px * 0.9)}px; line-height: 1; overflow: hidden;">${text}</span>`;
        } else {
            const svg = CollectionService.parseSvgIcon(value) || CollectionService.parseSvgIcon(CollectionService.FALLBACK_ICON);
            if (svg) {
                svg.setAttribute('width', String(px));
                svg.setAttribute('height', String(px));
                svg.setAttribute('aria-hidden', 'true');
                svg.setAttribute('focusable', 'false');
                html = new XMLSerializer().serializeToString(svg);
            } else {
                html = CollectionService.FALLBACK_ICON.replace('<svg ', `<svg width="${px}" height="${px}" aria-hidden="true" `);
            }
        }

        if (cache.size > 200) cache.clear();
        cache.set(key, html);
        return html;
    }

    getCurrentUser() {
        return window.firebaseManager ? window.firebaseManager.getCurrentUser() : null;
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
                
                const doc = await docRef.get();
                if (doc.exists) {
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
