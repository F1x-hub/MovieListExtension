/**
 * Service for managing viewing progress of TV shows.
 * Handles storage and retrieval of season/episode data.
 */
class ProgressService {
    constructor() {
        this.STORAGE_PREFIX = 'watching_progress_';
    }

    /**
     * Save progress for a specific movie/show
     * @param {string|number} movieId 
     * @param {Object} data - { season, episode, timestamp, movieTitle }
     * @returns {Promise<void>}
     */
    async saveProgress(movieId, data) {
        if (!movieId) {
            return;
        }
        
        const key = `${this.STORAGE_PREFIX}${movieId}`;
        const storageData = {
            ...data,
            updatedAt: Date.now()
        };
        
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ [key]: storageData }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Failed to save progress:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Get progress for a specific movie/show
     * @param {string|number} movieId 
     * @returns {Promise<Object|null>}
     */
    async getProgress(movieId) {
        console.log('[ProgressService] getProgress called for movieId:', movieId);
        
        if (!movieId) {
            console.warn('[ProgressService] getProgress: No movieId provided');
            return null;
        }
        
        const key = `${this.STORAGE_PREFIX}${movieId}`;
        
        return new Promise((resolve, reject) => {
            chrome.storage.local.get([key], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('[ProgressService] getProgress FAILED:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                } else {
                    const progress = result[key] || null;
                    console.log('[ProgressService] getProgress result for', movieId, ':', progress);
                    resolve(progress);
                }
            });
        });
    }

    /**
     * Get progress for all movies (useful for lists)
     * @returns {Promise<Object>} Map of movieId -> progress object
     */
    async getAllProgress() {
        console.log('[ProgressService] getAllProgress called');
        const startTime = Date.now();
        
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(null, (items) => {
                if (chrome.runtime.lastError) {
                    console.error('[ProgressService] getAllProgress FAILED:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                } else {
                    const allProgress = {};
                    let count = 0;
                    Object.keys(items).forEach(key => {
                        if (key.startsWith(this.STORAGE_PREFIX)) {
                            const movieId = key.replace(this.STORAGE_PREFIX, '');
                            allProgress[movieId] = items[key];
                            count++;
                        }
                    });
                    const elapsed = Date.now() - startTime;
                    console.log(`[ProgressService] getAllProgress: Found ${count} progress entries in ${elapsed}ms`);
                    console.log('[ProgressService] All progress data:', allProgress);
                    resolve(allProgress);
                }
            });
        });
    }

    /**
     * Remove progress for a specific movie
     * @param {string|number} movieId 
     * @returns {Promise<void>}
     */
    async removeProgress(movieId) {
        if (!movieId) return;
        const key = `${this.STORAGE_PREFIX}${movieId}`;
        
        return new Promise((resolve, reject) => {
            chrome.storage.local.remove(key, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    }
}

// Export for usage
if (typeof window !== 'undefined') {
    window.ProgressService = ProgressService;
}
