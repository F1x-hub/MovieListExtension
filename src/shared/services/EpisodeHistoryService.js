/**
 * EpisodeHistoryService.js
 * 
 * Manages persistent per-episode completion history using a compact per-series map.
 * 
 * Storage Key: episode_history_v1_{movieId}
 * Storage Shape: { [s:e]: { cAt: timestampMs, src: "AUTO_RELIABLE" | "MANUAL" } }
 * 
 * Architectural Invariants:
 * - Completion-Only: Stores ONLY completed episodes (never partial timestamps).
 * - Per-Series Granularity: Exactly 1 storage read for an entire series.
 * - Zero Write Amplification: Written only on verified completion or manual user toggle.
 * - Idempotency & Lost-Update Protection: Per-movie write serialization queues.
 * - No TTL / No LRU: User-created watch history is never silently evicted.
 */

/**
 * Valid completion sources.
 */
const VALID_COMPLETION_SOURCES = Object.freeze(['AUTO_RELIABLE', 'MANUAL']);

/**
 * Constructs a canonical episode history key string: "season:episode".
 * @param {number|string} seasonNumber 
 * @param {number|string} episodeNumber 
 * @returns {string|null} Canonical key e.g. "1:1", "0:2", or null if invalid
 */
function buildEpisodeHistoryKey(seasonNumber, episodeNumber) {
    if (seasonNumber === null || seasonNumber === undefined || typeof seasonNumber === 'boolean') return null;
    if (episodeNumber === null || episodeNumber === undefined || typeof episodeNumber === 'boolean') return null;

    const s = Number(seasonNumber);
    const e = Number(episodeNumber);

    if (Number.isNaN(s) || !Number.isInteger(s) || s < 0) return null;
    if (Number.isNaN(e) || !Number.isInteger(e) || e <= 0) return null;

    return `${s}:${e}`;
}

/**
 * Parses a canonical episode history key string into season and episode numbers.
 * @param {string} key 
 * @returns {{ seasonNumber: number, episodeNumber: number } | null}
 */
function parseEpisodeHistoryKey(key) {
    if (typeof key !== 'string') return null;
    const parts = key.split(':');
    if (parts.length !== 2) return null;

    const s = Number(parts[0]);
    const e = Number(parts[1]);

    if (Number.isNaN(s) || !Number.isInteger(s) || s < 0) return null;
    if (Number.isNaN(e) || !Number.isInteger(e) || e <= 0) return null;

    return { seasonNumber: s, episodeNumber: e };
}

/**
 * Normalizes raw storage data into a sanitized EpisodeHistory map.
 * Corrupt, malformed, or invalid entries are defensively pruned without crashing.
 * @param {any} raw 
 * @returns {Record<string, { cAt: number, src: string }>}
 */
function normalizeEpisodeHistory(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {};
    }

    const normalized = {};

    for (const [key, val] of Object.entries(raw)) {
        const parsedKey = parseEpisodeHistoryKey(key);
        if (!parsedKey) continue;

        if (!val || typeof val !== 'object') continue;

        // Normalize completedAt timestamp
        let cAt = Number(val.cAt || val.completedAt);
        if (Number.isNaN(cAt) || !Number.isFinite(cAt) || cAt <= 0) {
            cAt = Date.now();
        } else {
            cAt = Math.floor(cAt);
        }

        // Normalize source
        let src = typeof val.src === 'string' ? val.src : (typeof val.source === 'string' ? val.source : 'AUTO_RELIABLE');
        if (!VALID_COMPLETION_SOURCES.includes(src)) {
            src = 'AUTO_RELIABLE';
        }

        normalized[key] = {
            cAt,
            src
        };
    }

    return normalized;
}

class EpisodeHistoryService {
    constructor() {
        this.STORAGE_PREFIX = 'episode_history_v1_';
        this.writeQueues = new Map(); // Map<movieId, Promise> for per-movie serialization
    }

    /**
     * Resolves the storage engine (chrome.storage.local or fallback).
     * @private
     */
    _getStorage() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return chrome.storage.local;
        }
        if (typeof window !== 'undefined' && window.localStorage) {
            return {
                get: (keys, callback) => {
                    const result = {};
                    const keyArr = Array.isArray(keys) ? keys : [keys];
                    keyArr.forEach(k => {
                        try {
                            const val = window.localStorage.getItem(k);
                            if (val) result[k] = JSON.parse(val);
                        } catch {
                            // ignore parse error
                        }
                    });
                    if (callback) callback(result);
                    return Promise.resolve(result);
                },
                set: (items, callback) => {
                    Object.entries(items).forEach(([k, v]) => {
                        window.localStorage.setItem(k, JSON.stringify(v));
                    });
                    if (callback) callback();
                    return Promise.resolve();
                },
                remove: (keys, callback) => {
                    const keyArr = Array.isArray(keys) ? keys : [keys];
                    keyArr.forEach(k => window.localStorage.removeItem(k));
                    if (callback) callback();
                    return Promise.resolve();
                }
            };
        }
        // Fallback in-memory
        if (!this._memoryStore) this._memoryStore = {};
        return {
            get: (keys, callback) => {
                const result = {};
                const keyArr = Array.isArray(keys) ? keys : [keys];
                keyArr.forEach(k => { if (this._memoryStore[k]) result[k] = this._memoryStore[k]; });
                if (callback) callback(result);
                return Promise.resolve(result);
            },
            set: (items, callback) => {
                Object.assign(this._memoryStore, items);
                if (callback) callback();
                return Promise.resolve();
            },
            remove: (keys, callback) => {
                const keyArr = Array.isArray(keys) ? keys : [keys];
                keyArr.forEach(k => delete this._memoryStore[k]);
                if (callback) callback();
                return Promise.resolve();
            }
        };
    }

    /**
     * Generates storage key for a movie.
     * @param {number|string} movieId 
     * @returns {string}
     */
    getStorageKey(movieId) {
        return `${this.STORAGE_PREFIX}${movieId}`;
    }

    /**
     * Serializes execution of write operations per movie ID.
     * @private
     * @param {number|string} movieId 
     * @param {Function} task 
     * @returns {Promise<any>}
     */
    _enqueue(movieId, task) {
        const key = String(movieId);
        const previousPromise = this.writeQueues.get(key) || Promise.resolve();
        const nextPromise = previousPromise.then(() => task()).catch((err) => {
            console.warn(`[EpisodeHistoryService] Queue error for movie ${movieId}:`, err);
            throw err;
        });

        this.writeQueues.set(key, nextPromise.finally(() => {
            if (this.writeQueues.get(key) === nextPromise) {
                this.writeQueues.delete(key);
            }
        }));

        return nextPromise;
    }

    /**
     * Retrieves the full normalized episode history map for a movie.
     * Single storage read for the whole series.
     * @param {number|string} movieId 
     * @returns {Promise<Record<string, { cAt: number, src: string }>>}
     */
    async getHistory(movieId) {
        if (!movieId) return {};

        const storage = this._getStorage();
        const key = this.getStorageKey(movieId);

        return new Promise((resolve) => {
            storage.get(key, (res) => {
                const raw = res ? res[key] : null;
                resolve(normalizeEpisodeHistory(raw));
            });
        });
    }

    /**
     * Checks if a specific season and episode is completed.
     * @param {number|string} movieId 
     * @param {number|string} seasonNumber 
     * @param {number|string} episodeNumber 
     * @returns {Promise<boolean>}
     */
    async isCompleted(movieId, seasonNumber, episodeNumber) {
        const epKey = buildEpisodeHistoryKey(seasonNumber, episodeNumber);
        if (!movieId || !epKey) return false;

        const history = await this.getHistory(movieId);
        return Boolean(history[epKey]);
    }

    /**
     * Returns an array of completed episode descriptor objects.
     * @param {number|string} movieId 
     * @returns {Promise<Array<{ seasonNumber: number, episodeNumber: number, completedAt: number, source: string }>>}
     */
    async getCompletedEpisodes(movieId) {
        const history = await this.getHistory(movieId);
        const list = [];

        for (const [key, val] of Object.entries(history)) {
            const parsed = parseEpisodeHistoryKey(key);
            if (parsed) {
                list.push({
                    seasonNumber: parsed.seasonNumber,
                    episodeNumber: parsed.episodeNumber,
                    completedAt: val.cAt,
                    source: val.src
                });
            }
        }

        return list;
    }

    /**
     * Returns the count of completed episodes for a movie, optionally filtered by season.
     * @param {number|string} movieId 
     * @param {number|string} [seasonNumber] Optional season filter
     * @returns {Promise<number>}
     */
    async getCompletedCount(movieId, seasonNumber = null) {
        const history = await this.getHistory(movieId);
        let count = 0;

        const targetSeason = seasonNumber != null ? Number(seasonNumber) : null;

        for (const key of Object.keys(history)) {
            const parsed = parseEpisodeHistoryKey(key);
            if (!parsed) continue;

            if (targetSeason !== null) {
                if (parsed.seasonNumber === targetSeason) {
                    count++;
                }
            } else {
                count++;
            }
        }

        return count;
    }

    /**
     * Marks an episode as completed in the history store.
     * Serialized per movie to guarantee lost-update safety.
     * @param {number|string} movieId 
     * @param {number|string} seasonNumber 
     * @param {number|string} episodeNumber 
     * @param {Object} [options]
     * @param {string} [options.source='AUTO_RELIABLE'] 'AUTO_RELIABLE' | 'MANUAL'
     * @param {number} [options.completedAt] Timestamp in ms
     * @returns {Promise<Record<string, { cAt: number, src: string }>>} Updated history map
     */
    async markCompleted(movieId, seasonNumber, episodeNumber, options = {}) {
        const epKey = buildEpisodeHistoryKey(seasonNumber, episodeNumber);
        if (!movieId || !epKey) {
            throw new Error(`[EpisodeHistoryService] Invalid parameters for markCompleted: movieId=${movieId}, S=${seasonNumber}, E=${episodeNumber}`);
        }

        const source = VALID_COMPLETION_SOURCES.includes(options.source) ? options.source : 'AUTO_RELIABLE';
        const completedAt = (typeof options.completedAt === 'number' && options.completedAt > 0)
            ? Math.floor(options.completedAt)
            : Date.now();

        return this._enqueue(movieId, async () => {
            const history = await this.getHistory(movieId);

            // Idempotency check: if already completed with same source, retain original completedAt
            const existing = history[epKey];
            if (existing) {
                // If existing record was AUTO_RELIABLE and user clicks MANUAL, update source
                history[epKey] = {
                    cAt: existing.cAt || completedAt,
                    src: source === 'MANUAL' ? 'MANUAL' : existing.src
                };
            } else {
                history[epKey] = {
                    cAt: completedAt,
                    src: source
                };
            }

            const storage = this._getStorage();
            const storageKey = this.getStorageKey(movieId);

            await new Promise((resolve, reject) => {
                storage.set({ [storageKey]: history }, () => {
                    if (typeof chrome !== 'undefined' && chrome?.runtime?.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve();
                    }
                });
            });

            return history;
        });
    }

    /**
     * Unmarks an episode as completed (manual user action).
     * Serialized per movie.
     * @param {number|string} movieId 
     * @param {number|string} seasonNumber 
     * @param {number|string} episodeNumber 
     * @returns {Promise<Record<string, { cAt: number, src: string }>>} Updated history map
     */
    async unmarkCompleted(movieId, seasonNumber, episodeNumber) {
        const epKey = buildEpisodeHistoryKey(seasonNumber, episodeNumber);
        if (!movieId || !epKey) {
            throw new Error(`[EpisodeHistoryService] Invalid parameters for unmarkCompleted: movieId=${movieId}, S=${seasonNumber}, E=${episodeNumber}`);
        }

        return this._enqueue(movieId, async () => {
            const history = await this.getHistory(movieId);

            if (!history[epKey]) {
                return history; // Already not present
            }

            delete history[epKey];

            const storage = this._getStorage();
            const storageKey = this.getStorageKey(movieId);

            await new Promise((resolve, reject) => {
                storage.set({ [storageKey]: history }, () => {
                    if (typeof chrome !== 'undefined' && chrome?.runtime?.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve();
                    }
                });
            });

            return history;
        });
    }

    /**
     * Clears all episode history for a movie (settings / test cleanup).
     * @param {number|string} movieId 
     * @returns {Promise<void>}
     */
    async clearMovieHistory(movieId) {
        if (!movieId) return;

        return this._enqueue(movieId, async () => {
            const storage = this._getStorage();
            const storageKey = this.getStorageKey(movieId);

            await new Promise((resolve) => {
                storage.remove(storageKey, resolve);
            });
        });
    }

    /**
     * Lazy migration helper: Seeds a single trusted completion record from an existing
     * completed ProgressService record if not already present.
     * Invariant: Never infers or touches prior episodes.
     * @param {number|string} movieId 
     * @param {Object|null} progressRecord 
     * @returns {Promise<boolean>} True if seeded
     */
    async seedFromProgress(movieId, progressRecord) {
        if (!movieId || !progressRecord || !progressRecord.completed) {
            return false;
        }

        const seasonNum = progressRecord.season;
        const episodeNum = progressRecord.episode;
        const epKey = buildEpisodeHistoryKey(seasonNum, episodeNum);
        if (!epKey) return false;

        const history = await this.getHistory(movieId);
        if (history[epKey]) {
            return false; // Already present
        }

        await this.markCompleted(movieId, seasonNum, episodeNum, {
            source: 'AUTO_RELIABLE',
            completedAt: progressRecord.updatedAt || Date.now()
        });

        return true;
    }
}

// Global and CommonJS export
if (typeof window !== 'undefined') {
    window.EpisodeHistoryService = EpisodeHistoryService;
    window.buildEpisodeHistoryKey = buildEpisodeHistoryKey;
    window.parseEpisodeHistoryKey = parseEpisodeHistoryKey;
    window.normalizeEpisodeHistory = normalizeEpisodeHistory;
    window.VALID_COMPLETION_SOURCES = VALID_COMPLETION_SOURCES;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        EpisodeHistoryService,
        buildEpisodeHistoryKey,
        parseEpisodeHistoryKey,
        normalizeEpisodeHistory,
        VALID_COMPLETION_SOURCES
    };
}
