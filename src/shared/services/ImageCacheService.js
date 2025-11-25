/**
 * Image Cache Service
 * Handles local caching of profile images to reduce Firebase Storage usage
 */
class ImageCacheService {
    constructor() {
        this.CACHE_KEY = 'profile_cache';
        this.MAX_CACHE_SIZE = 10 * 1024 * 1024; // 10MB limit
        this.CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days
    }

    /**
     * Get cached image data
     * @param {string} userId - User ID
     * @param {string} type - 'avatar' or 'banner'
     * @returns {Promise<string|null>} - Base64 image data or null
     */
    async getCachedImage(userId, type) {
        try {
            const result = await chrome.storage.local.get(this.CACHE_KEY);
            const cache = result[this.CACHE_KEY] || {};
            
            if (!cache[userId] || !cache[userId][type]) {
                return null;
            }

            const item = cache[userId][type];
            
            // Check expiry
            if (Date.now() - item.timestamp > this.CACHE_EXPIRY) {
                await this.invalidateCache(userId, type);
                return null;
            }

            return item.data;
        } catch (error) {
            console.error('Error getting cached image:', error);
            return null;
        }
    }

    /**
     * Cache image data
     * @param {string} userId - User ID
     * @param {string} type - 'avatar' or 'banner'
     * @param {string|Blob} data - Base64 string or Blob
     */
    async cacheImage(userId, type, data) {
        try {
            let base64Data = data;
            if (data instanceof Blob) {
                base64Data = await this.blobToBase64(data);
            }

            const result = await chrome.storage.local.get(this.CACHE_KEY);
            const cache = result[this.CACHE_KEY] || {};

            if (!cache[userId]) {
                cache[userId] = {};
            }

            cache[userId][type] = {
                data: base64Data,
                timestamp: Date.now()
            };

            // Check size and clean up if needed
            await this.enforceCacheLimit(cache);

            await chrome.storage.local.set({ [this.CACHE_KEY]: cache });
            console.log(`Cached ${type} for user ${userId}`);
        } catch (error) {
            console.error('Error caching image:', error);
        }
    }

    /**
     * Remove specific image from cache
     * @param {string} userId - User ID
     * @param {string} type - 'avatar' or 'banner'
     */
    async invalidateCache(userId, type) {
        try {
            const result = await chrome.storage.local.get(this.CACHE_KEY);
            const cache = result[this.CACHE_KEY];

            if (cache && cache[userId]) {
                if (type) {
                    delete cache[userId][type];
                } else {
                    delete cache[userId];
                }
                await chrome.storage.local.set({ [this.CACHE_KEY]: cache });
            }
        } catch (error) {
            console.error('Error invalidating cache:', error);
        }
    }

    /**
     * Enforce cache size limit by removing oldest entries
     * @param {Object} cache - The cache object
     */
    async enforceCacheLimit(cache) {
        let currentSize = JSON.stringify(cache).length;
        
        if (currentSize <= this.MAX_CACHE_SIZE) return;

        console.log('Cache limit exceeded, cleaning up...');

        // Flatten cache to list of items with timestamps
        const items = [];
        for (const userId in cache) {
            for (const type in cache[userId]) {
                items.push({
                    userId,
                    type,
                    timestamp: cache[userId][type].timestamp
                });
            }
        }

        // Sort by timestamp (oldest first)
        items.sort((a, b) => a.timestamp - b.timestamp);

        // Remove items until size is within limit
        while (currentSize > this.MAX_CACHE_SIZE && items.length > 0) {
            const itemToRemove = items.shift();
            delete cache[itemToRemove.userId][itemToRemove.type];
            
            // Cleanup empty user objects
            if (Object.keys(cache[itemToRemove.userId]).length === 0) {
                delete cache[itemToRemove.userId];
            }

            currentSize = JSON.stringify(cache).length;
        }
    }

    /**
     * Convert Blob to Base64
     * @param {Blob} blob 
     * @returns {Promise<string>}
     */
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Fetch image from URL and cache it
     * @param {string} userId 
     * @param {string} type 
     * @param {string} url 
     */
    async fetchAndCache(userId, type, url) {
        if (!url) return;
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            await this.cacheImage(userId, type, blob);
        } catch (error) {
            console.error(`Error fetching image to cache (${type}):`, error);
        }
    }
}

// Export instance
window.imageCacheService = new ImageCacheService();
