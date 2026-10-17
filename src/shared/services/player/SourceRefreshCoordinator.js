(function (global) {
    'use strict';
    const STORAGE_KEY = 'playerRefreshBudgetV1';
    const DAY = 24 * 60 * 60 * 1000;
    const RESOURCES = new Set(['manifest', 'level', 'fragment', 'key']);
    const result = (handled, recovered, reason) => ({ handled, recovered, reason });

    class SourceRefreshCoordinator {
        constructor({ storage = global.chrome?.storage?.local, now = Date.now, crypto = global.crypto } = {}) {
            this.storage = storage;
            this.now = now;
            this.crypto = crypto;
            this.records = new Map();
            this.flights = new Map();
            this.generations = new Map();
            this.epoch = 0;
            this.loaded = null;
            this.writes = Promise.resolve();
        }

        _identity(identity) {
            if (!identity || typeof identity !== 'object') return null;
            const { titleId, providerId, season = null, episode = null, requestId = 0, attemptId = requestId } = identity;
            if (!(typeof titleId === 'string' || Number.isSafeInteger(titleId)) || !String(titleId).trim()
                || typeof providerId !== 'string' || !providerId
                || ![season, episode].every(value => value === null || (Number.isSafeInteger(value) && value >= 0))
                || ((season === null) !== (episode === null))
                || !(typeof requestId === 'string' || Number.isSafeInteger(requestId))
                || !(typeof attemptId === 'string' || Number.isSafeInteger(attemptId))) return null;
            return { media: JSON.stringify([String(titleId), providerId, season, episode]), requestId, attemptId };
        }

        async _hash(value) {
            if (!this.crypto?.subtle) return null;
            const bytes = await this.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
            return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
        }

        _prune() {
            const now = this.now();
            for (const [key, record] of this.records) if (record.expiresAt <= now) this.records.delete(key);
            while (this.records.size > 64) this.records.delete(this.records.keys().next().value);
        }

        async _load() {
            if (!this.loaded) this.loaded = (async () => {
                try {
                    const data = await this.storage?.get(STORAGE_KEY);
                    for (const record of (Array.isArray(data?.[STORAGE_KEY]) ? data[STORAGE_KEY] : []).slice(-64)) {
                        if (/^[a-f0-9]{64}$/.test(record?.key) && Number.isFinite(record.expiresAt)
                            && record.expiresAt > this.now() && record.expiresAt <= this.now() + 7 * DAY
                            && Number.isFinite(record.cooldownUntil) && record.cooldownUntil >= 0
                            && (record.attempt === null || /^[a-f0-9]{64}$/.test(record.attempt))) {
                            this.records.set(record.key, { expiresAt: record.expiresAt, cooldownUntil: record.cooldownUntil, attempt: record.attempt });
                        }
                    }
                } catch { /* Storage failure retains in-memory protection. */ }
                this._prune();
            })();
            await this.loaded;
        }

        _save() {
            this._prune();
            // Hash-less memory fallback keys must never enter persistent storage.
            const rows = [...this.records].filter(([key, record]) => /^[a-f0-9]{64}$/.test(key)
                && (record.attempt === null || /^[a-f0-9]{64}$/.test(record.attempt)))
                .map(([key, record]) => ({ key, ...record }));
            this.writes = this.writes.then(() => this.storage?.set({ [STORAGE_KEY]: rows })).catch(() => {});
        }

        invalidate(identity) {
            const parsed = this._identity(identity);
            if (parsed) this.generations.set(parsed.media, (this.generations.get(parsed.media) || 0) + 1);
            else this.epoch++;
            if (this.generations.size > 64) {
                this.epoch++;
                this.generations.clear();
            }
        }

        async run({ identity, status, resource, networkProfile = 'remote', isCurrent = () => true, refresh, manual = false, policyViolation = false } = {}) {
            if (policyViolation) return result(false, false, 'policy');
            if (networkProfile === 'local') return result(false, false, 'local');
            if (networkProfile !== 'remote' || !RESOURCES.has(resource) || ![401, 403, 404, 410].includes(status)) return result(false, false, 'not-expired');
            const parsed = this._identity(identity);
            if (!parsed || typeof refresh !== 'function' || typeof isCurrent !== 'function') return result(false, false, 'invalid');
            const epoch = this.epoch;
            const generation = this.generations.get(parsed.media) || 0;
            const current = () => {
                try { return this.epoch === epoch && (this.generations.get(parsed.media) || 0) === generation && isCurrent() === true; }
                catch { return false; }
            };
            if (!current()) return result(true, false, 'stale');
            await this._load();
            const key = await this._hash(parsed.media).catch(() => null) || `memory:${parsed.media}`;
            // Budget follows the logical source attempt across force-refresh mounts.
            const attempt = await this._hash(JSON.stringify([parsed.media, parsed.attemptId])).catch(() => null) || `memory:${parsed.attemptId}`;
            if (!current()) return result(true, false, 'stale');
            // Duplicate errors from one physical player share its in-flight refresh.
            const flightKey = JSON.stringify([key, attempt, parsed.requestId]);
            const existing = this.flights.get(flightKey);
            if (existing) {
                const outcome = await existing;
                return current() ? outcome : result(true, false, 'stale');
            }
            if (this.flights.size >= 64) return result(true, false, 'busy');
            this._prune();
            let record = this.records.get(key);
            if (!manual && record?.cooldownUntil > this.now()) return result(true, false, 'cooldown');
            if (!manual && record?.attempt === attempt) {
                if (status === 403) { record.cooldownUntil = this.now() + DAY; this._save(); }
                return result(true, false, 'exhausted');
            }
            record = { attempt, cooldownUntil: 0, expiresAt: this.now() + 7 * DAY };
            this.records.delete(key);
            this.records.set(key, record);
            this._save();
            const task = (async () => {
                try {
                    // The refresh callback must check this token before mounting/reloading.
                    const recovered = await refresh({ isCurrent: current });
                    if (!current()) return result(true, false, 'stale');
                    return result(true, recovered === true, recovered === true ? 'refreshed' : 'failed');
                } catch { return result(true, false, current() ? 'failed' : 'stale'); }
            })();
            this.flights.set(flightKey, task);
            try { return await task; }
            finally { if (this.flights.get(flightKey) === task) this.flights.delete(flightKey); }
        }
    }
    global.SourceRefreshCoordinator = SourceRefreshCoordinator;
    if (typeof module !== 'undefined' && module.exports) module.exports = { SourceRefreshCoordinator };
})(typeof window !== 'undefined' ? window : globalThis);
