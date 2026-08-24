/**
 * Normalizes a viewing progress record into canonical shape.
 * @param {Object|null} record 
 * @returns {Object|null}
 */
function normalizeProgressRecord(record) {
    if (!record || typeof record !== 'object') {
        return null;
    }

    let seasonNum = null;
    let episodeNum = null;

    if (record.season != null) {
        if (typeof record.season === 'number' && Number.isInteger(record.season) && record.season >= 0) {
            seasonNum = record.season;
        } else if (typeof record.season === 'string') {
            const match = record.season.match(/(\d+)/);
            if (match) seasonNum = parseInt(match[1], 10);
        }
    }

    if (record.episode != null) {
        if (typeof record.episode === 'number' && Number.isInteger(record.episode) && record.episode > 0) {
            episodeNum = record.episode;
        } else if (typeof record.episode === 'string') {
            const match = record.episode.match(/(\d+)/);
            if (match) episodeNum = parseInt(match[1], 10);
        }
    }

    let timestamp = 0;
    if (record.timestamp != null && record.timestamp !== '') {
        const parsedTs = Number(record.timestamp);
        if (!Number.isNaN(parsedTs) && Number.isFinite(parsedTs) && parsedTs >= 0) {
            timestamp = Math.floor(parsedTs);
        }
    }

    let duration = null;
    if (record.duration != null && record.duration !== '') {
        const parsedDur = Number(record.duration);
        if (!Number.isNaN(parsedDur) && Number.isFinite(parsedDur) && parsedDur > 0) {
            duration = Math.floor(parsedDur);
        }
    }

    const completed = Boolean(record.completed);

    return {
        movieId: record.movieId != null ? record.movieId : null,
        movieTitle: typeof record.movieTitle === 'string' ? record.movieTitle : '',
        season: seasonNum,
        episode: episodeNum,
        seasonLabel: seasonNum != null ? `${seasonNum} сезон` : (record.season || null),
        episodeLabel: episodeNum != null ? `${episodeNum} серия` : (record.episode || null),
        timestamp,
        duration,
        completed,
        providerId: record.providerId || null,
        updatedAt: record.updatedAt || null
    };
}

/**
 * Service for managing viewing progress of TV shows.
 * Handles storage and retrieval of season/episode data.
 */
class ProgressService {
    constructor() {
        this.STORAGE_PREFIX = 'watching_progress_';
        this._writeQueues = new Map();
        this._writeGenerations = new Map();
    }

    /**
     * Save progress for a specific movie/show with write serialization and monotonic completion.
     * @param {string|number} movieId 
     * @param {Object} data - { season, episode, timestamp, duration, completed, movieTitle, providerId }
     * @returns {Promise<void>}
     */
    async saveProgress(movieId, data) {
        if (!movieId) {
            return;
        }

        const normalizedNew = normalizeProgressRecord(data);
        if (!normalizedNew) return;

        const currentGen = (this._writeGenerations.get(movieId) || 0) + 1;
        this._writeGenerations.set(movieId, currentGen);

        const previousPromise = this._writeQueues.get(movieId) || Promise.resolve();

        const writePromise = previousPromise.then(async () => {
            // Drop stale async writes if a newer write was queued for this movie
            if (this._writeGenerations.get(movieId) !== currentGen) {
                return;
            }

            const existing = await this.getProgress(movieId);

            let completed = normalizedNew.completed;
            // Enforce monotonic completion preservation for the exact same S/E
            if (existing && existing.season === normalizedNew.season && existing.episode === normalizedNew.episode) {
                if (existing.completed === true && !completed) {
                    completed = true;
                }
            }

            const storageData = {
                movieId,
                movieTitle: data.movieTitle || existing?.movieTitle || '',
                season: normalizedNew.season,
                episode: normalizedNew.episode,
                timestamp: normalizedNew.timestamp,
                duration: normalizedNew.duration != null ? normalizedNew.duration : (existing?.season === normalizedNew.season && existing?.episode === normalizedNew.episode ? (existing.duration || null) : null),
                completed,
                providerId: data.providerId || existing?.providerId || null,
                updatedAt: Date.now()
            };

            const key = `${this.STORAGE_PREFIX}${movieId}`;
            return new Promise((resolve, reject) => {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.set({ [key]: storageData }, () => {
                        if (chrome.runtime && chrome.runtime.lastError) {
                            console.error('Failed to save progress:', chrome.runtime.lastError);
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve(storageData);
                        }
                    });
                } else {
                    resolve(storageData);
                }
            });
        }).catch(e => {
            console.warn('[ProgressService] saveProgress error:', e);
        });

        this._writeQueues.set(movieId, writePromise);
        return writePromise;
    }

    /**
     * Get progress for a specific movie/show
     * @param {string|number} movieId 
     * @returns {Promise<Object|null>}
     */
    async getProgress(movieId) {
        if (!movieId) {
            return null;
        }
        
        const key = `${this.STORAGE_PREFIX}${movieId}`;
        
        return new Promise((resolve, reject) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get([key], (result) => {
                    if (chrome.runtime && chrome.runtime.lastError) {
                        console.error('[ProgressService] getProgress FAILED:', chrome.runtime.lastError);
                        reject(chrome.runtime.lastError);
                    } else {
                        const raw = result[key] || null;
                        const normalized = normalizeProgressRecord(raw);
                        resolve(normalized);
                    }
                });
            } else {
                resolve(null);
            }
        });
    }

    /**
     * Get progress for all movies (useful for lists)
     * @returns {Promise<Object>} Map of movieId -> progress object
     */
    async getAllProgress() {
        return new Promise((resolve, reject) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(null, (items) => {
                    if (chrome.runtime && chrome.runtime.lastError) {
                        console.error('[ProgressService] getAllProgress FAILED:', chrome.runtime.lastError);
                        reject(chrome.runtime.lastError);
                    } else {
                        const allProgress = {};
                        Object.keys(items || {}).forEach(key => {
                            if (key.startsWith(this.STORAGE_PREFIX)) {
                                const movieId = key.replace(this.STORAGE_PREFIX, '');
                                allProgress[movieId] = normalizeProgressRecord(items[key]);
                            }
                        });
                        resolve(allProgress);
                    }
                });
            } else {
                resolve({});
            }
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
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.remove(key, () => {
                    if (chrome.runtime && chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }
}

// Export for usage
if (typeof window !== 'undefined') {
    window.ProgressService = ProgressService;
    window.normalizeProgressRecord = normalizeProgressRecord;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ProgressService,
        normalizeProgressRecord
    };
}
