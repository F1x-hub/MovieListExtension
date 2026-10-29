/**
 * ActorAgeService
 *
 * Resolves actors' birth dates so a movie page can show how old each actor was
 * when the film came out. Built to spend almost no Kinopoisk quota:
 *  - a birth date never changes, so every answer is cached per person in
 *    chrome.storage.local and reused by every movie (found dates never expire,
 *    "unknown" answers are retried after MISS_TTL_MS);
 *  - all uncached people of a cast go out in ONE batched /v1.4/person request
 *    (selectFields limits the payload to id + birthday), never one request per
 *    actor and never a person page;
 *  - callers fetch lazily (when the Actors tab opens), and a failed or
 *    quota-limited request is not cached, so it simply retries next time.
 */
(function (global) {
    'use strict';

    const CACHE_PREFIX = 'actorBirth:';
    const MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const BATCH_SIZE = 50;
    const MAX_AGE = 110;

    function parseIsoDate(value) {
        const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (year < 1800 || month < 1 || month > 12 || day < 1 || day > 31) return null;
        return { year, month, day };
    }

    /**
     * Age on the release date. With a full release date the age is exact; with
     * only a release year it is the year difference.
     * @param {string|null} birthday - ISO birth date
     * @param {{date?: string|null, year?: number|string|null}} release
     * @returns {number|null}
     */
    function computeAgeAtRelease(birthday, release = {}) {
        const birth = parseIsoDate(birthday);
        if (!birth) return null;
        const releaseDate = parseIsoDate(release.date);
        let age;
        if (releaseDate) {
            age = releaseDate.year - birth.year;
            if (releaseDate.month < birth.month
                || (releaseDate.month === birth.month && releaseDate.day < birth.day)) age -= 1;
        } else {
            const year = Number(release.year);
            if (!Number.isInteger(year) || year < 1800) return null;
            age = year - birth.year;
        }
        return age >= 0 && age <= MAX_AGE ? age : null;
    }

    class ActorAgeService {
        /**
         * @param {{kinopoiskService?: Object, storage?: Object}} [deps]
         */
        constructor({ kinopoiskService = null, storage = null } = {}) {
            this.kinopoiskService = kinopoiskService;
            this.storage = storage;
            this._memory = new Map();
            this._inflight = new Map();
        }

        _getStorage() {
            if (this.storage) return this.storage;
            return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
        }

        _isFresh(entry, now) {
            if (!entry || typeof entry !== 'object') return false;
            if (typeof entry.b === 'string') return true;
            return Number.isFinite(entry.t) && now - entry.t < MISS_TTL_MS;
        }

        async _readCached(ids) {
            const now = Date.now();
            const found = new Map();
            const unread = [];
            for (const id of ids) {
                const entry = this._memory.get(id);
                if (this._isFresh(entry, now)) found.set(id, entry.b || null);
                else unread.push(id);
            }
            const storage = this._getStorage();
            if (unread.length && storage) {
                try {
                    const keys = unread.map(id => `${CACHE_PREFIX}${id}`);
                    const result = await storage.get(keys);
                    for (const id of unread) {
                        const entry = result?.[`${CACHE_PREFIX}${id}`];
                        if (this._isFresh(entry, now)) {
                            this._memory.set(id, entry);
                            found.set(id, entry.b || null);
                        }
                    }
                } catch (error) {
                    console.warn('ActorAgeService: cache read failed', error?.message);
                }
            }
            return found;
        }

        async _writeCached(entries) {
            if (!entries.size) return;
            const payload = {};
            for (const [id, entry] of entries) {
                this._memory.set(id, entry);
                payload[`${CACHE_PREFIX}${id}`] = entry;
            }
            const storage = this._getStorage();
            if (!storage) return;
            try {
                await storage.set(payload);
            } catch (error) {
                console.warn('ActorAgeService: cache write failed', error?.message);
            }
        }

        async _fetchBatch(ids, signal) {
            const service = this.kinopoiskService;
            if (!service?._fetchWithRotation) return null;
            const params = new URLSearchParams();
            params.append('limit', String(ids.length));
            params.append('selectFields', 'id');
            params.append('selectFields', 'birthday');
            ids.forEach(id => params.append('id', String(id)));
            const response = await service._fetchWithRotation(
                `${service.baseUrl}/person?${params.toString()}`, { method: 'GET', signal });
            if (!response.ok) return null;
            const data = await response.json();
            return Array.isArray(data?.docs) ? data.docs : [];
        }

        /**
         * Birth dates for Kinopoisk person ids. Unknown people map to null.
         * Network failures (including quota) leave those ids out of the result.
         * @param {Array<number|string>} kpPersonIds
         * @param {{signal?: AbortSignal}} [options]
         * @returns {Promise<Map<number, string|null>>}
         */
        async getBirthDates(kpPersonIds, options = {}) {
            const ids = [...new Set((kpPersonIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
            const result = await this._readCached(ids);
            const missing = ids.filter(id => !result.has(id));
            for (let start = 0; start < missing.length; start += BATCH_SIZE) {
                const chunk = missing.slice(start, start + BATCH_SIZE);
                const key = chunk.join(',');
                let pending = this._inflight.get(key);
                if (!pending) {
                    pending = this._fetchBatch(chunk, options.signal).finally(() => this._inflight.delete(key));
                    this._inflight.set(key, pending);
                }
                let docs;
                try {
                    docs = await pending;
                } catch (error) {
                    if (error?.name === 'AbortError') throw error;
                    console.warn('ActorAgeService: birth date lookup failed', error?.message);
                    continue;
                }
                if (!docs) continue;
                const now = Date.now();
                const entries = new Map();
                const byId = new Map(docs.map(doc => [Number(doc?.id), doc]));
                for (const id of chunk) {
                    const birthday = parseIsoDate(byId.get(id)?.birthday)
                        ? String(byId.get(id).birthday).slice(0, 10) : null;
                    entries.set(id, birthday ? { b: birthday, t: now } : { b: null, t: now });
                    result.set(id, birthday);
                }
                await this._writeCached(entries);
            }
            return result;
        }
    }

    ActorAgeService.computeAgeAtRelease = computeAgeAtRelease;
    ActorAgeService.CACHE_PREFIX = CACHE_PREFIX;
    ActorAgeService.MISS_TTL_MS = MISS_TTL_MS;

    global.ActorAgeService = ActorAgeService;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ActorAgeService;
    }
})(typeof window !== 'undefined' ? window : globalThis);
