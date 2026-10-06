/**
 * Image Cache Service
 * Handles local caching of profile images to reduce Firebase Storage usage
 */
class ImageCacheService {
    constructor() {
        this.CACHE_KEY = 'profile_cache';
        this.MAX_CACHE_SIZE = 10 * 1024 * 1024; // 10MB limit
        // One entry above this (base64 characters) is not cached: a single large
        // GIF would otherwise evict every other cached avatar and banner.
        this.MAX_ITEM_SIZE = 2 * 1024 * 1024;
        this.CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days
        // All entries share one storage key, so writes are serialized: concurrent
        // read-modify-write cycles (avatar and banner together) lost one update.
        this.writeQueue = Promise.resolve();
    }

    /**
     * Runs a read-modify-write of the shared cache key after the previous one.
     * @param {Function} task
     * @returns {Promise<*>}
     */
    runExclusive(task) {
        const run = this.writeQueue.then(task, task);
        this.writeQueue = run.catch(() => {});
        return run;
    }

    /**
     * Get cached image data
     * @param {string} userId - User ID
     * @param {string} type - 'avatar' or 'banner'
     * @param {string|null} expectedUrl - The expected URL for the image
     * @returns {Promise<string|null>} - Base64 image data or null
     */
    async getCachedImage(userId, type, expectedUrl = null) {
        try {
            const result = await chrome.storage.local.get(this.CACHE_KEY);
            const cache = result[this.CACHE_KEY] || {};

            if (!cache[userId] || !cache[userId][type]) {
                return null;
            }

            const item = cache[userId][type];

            // Check if the URL has changed or if it's an old cache entry without a URL
            if (expectedUrl && (!item.url || item.url !== expectedUrl)) {
                await this.invalidateCache(userId, type);
                return null;
            }

            // Check expiry; entries that are not images (an error page cached by an
            // earlier version) are dropped as well.
            if (Date.now() - item.timestamp > this.CACHE_EXPIRY || !ImageCacheService.isImageDataUrl(item.data)) {
                await this.invalidateCache(userId, type);
                return null;
            }

            return item.data;
        } catch (error) {
            console.error('Error getting cached image:', error);
            return null;
        }
    }

    static isImageDataUrl(value) {
        return typeof value === 'string' && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value);
    }

    /**
     * Cache image data
     * @param {string} userId - User ID
     * @param {string} type - 'avatar' or 'banner'
     * @param {string|Blob} data - Base64 string or Blob
     * @param {string|null} url - The URL of the image
     */
    async cacheImage(userId, type, data, url = null) {
        try {
            let base64Data = data;
            if (data instanceof Blob) {
                base64Data = await this.blobToBase64(data);
            }
            if (!ImageCacheService.isImageDataUrl(base64Data) || base64Data.length > this.MAX_ITEM_SIZE) {
                // Not cacheable: drop a stale entry so the URL is used directly.
                await this.invalidateCache(userId, type);
                return;
            }

            await this.runExclusive(async () => {
                const result = await chrome.storage.local.get(this.CACHE_KEY);
                const cache = result[this.CACHE_KEY] || {};

                if (!cache[userId]) {
                    cache[userId] = {};
                }

                cache[userId][type] = {
                    data: base64Data,
                    url: url,
                    timestamp: Date.now()
                };

                // Check size and clean up if needed
                await this.enforceCacheLimit(cache);

                await chrome.storage.local.set({ [this.CACHE_KEY]: cache });
            });
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
            await this.runExclusive(async () => {
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
            });
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
     * Fetch image from URL and cache it. Error responses (404/403 pages) and
     * non-image bodies are never cached, so a failed fetch cannot pin a broken
     * avatar for the whole cache lifetime.
     * @param {string} userId
     * @param {string} type
     * @param {string} url
     */
    async fetchAndCache(userId, type, url) {
        if (!url) return;
        try {
            const response = await fetch(url);
            if (!response.ok) return;
            const blob = await response.blob();
            if (!/^image\//i.test(blob.type || '')) return;
            await this.cacheImage(userId, type, blob, url);
        } catch (error) {
            console.error(`Error fetching image to cache (${type}):`, error);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImageCacheService;
}
if (typeof window !== 'undefined') {
    // Export instance
    window.imageCacheService = new ImageCacheService();
}
