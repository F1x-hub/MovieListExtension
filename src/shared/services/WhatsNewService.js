/* Shared with the classic background worker; no Firebase or UI dependencies. */
(function (global) {
    const KEY = 'whatsNewV1';
    class WhatsNewService {
        static key = KEY;
        static queues = new WeakMap();
        // Web Locks serializes storage reads/writes across extension tabs and
        // the worker. The per-storage queue also covers tests/older contexts.
        transaction(callback) {
            if (global.isSecureContext && global.navigator?.locks?.request) {
                return global.navigator.locks.request('movie-extension-whats-new-ack', callback);
            }
            const previous = WhatsNewService.queues.get(this.storage);
            const operation = previous ? previous.catch(() => {}).then(callback) : Promise.resolve(callback());
            WhatsNewService.queues.set(this.storage, operation);
            operation.then(() => {
                if (WhatsNewService.queues.get(this.storage) === operation) WhatsNewService.queues.delete(this.storage);
            }, () => {
                if (WhatsNewService.queues.get(this.storage) === operation) WhatsNewService.queues.delete(this.storage);
            });
            return operation;
        }
        static validVersion(value) {
            return typeof value === 'string' && /^\d+(?:\.\d+){2,3}$/.test(value)
                && value.split('.').every(part => Number(part) <= 65535);
        }
        static compare(a, b) {
            if (!this.validVersion(a) || !this.validVersion(b)) throw new Error('Invalid extension version');
            const first = a.split('.').map(Number), second = b.split('.').map(Number);
            for (let i = 0; i < 4; i++) {
                const difference = (first[i] || 0) - (second[i] || 0);
                if (difference) return Math.sign(difference);
            }
            return 0;
        }
        constructor({ storage = global.chrome.storage.local, version = global.chrome.runtime.getManifest().version, entries = [] } = {}) {
            this.storage = storage;
            this.version = version;
            this.entries = entries;
        }
        async read() {
            return this.transaction(async () => {
                const result = await this.storage.get(KEY);
                return result[KEY] || {};
            });
        }
        async observeInstallation(details) {
            return this.transaction(async () => {
                const result = await this.storage.get(KEY);
                const state = result[KEY] || {};
                if (details.reason === 'install') {
                    await this.storage.set({ [KEY]: { seenVersion: this.version } });
                } else if (details.reason === 'update' && !WhatsNewService.validVersion(state.seenVersion)) {
                    const previous = details.previousVersion;
                    const baseline = WhatsNewService.validVersion(previous) && WhatsNewService.compare(previous, this.version) < 0
                        ? previous : this.version;
                    await this.storage.set({ [KEY]: { seenVersion: baseline } });
                }
            });
        }
        published() {
            return this.entries.filter(entry => !entry.draft && entry.highlights?.length
                && WhatsNewService.validVersion(entry.version) && WhatsNewService.compare(entry.version, this.version) <= 0)
                .sort((a, b) => WhatsNewService.compare(b.version, a.version));
        }
        history({ preview = false } = {}) {
            return preview ? [...this.entries.filter(entry => entry.draft), ...this.published()] : this.published();
        }
        async hasUnseenRelease() {
            const { seenVersion } = await this.read();
            return WhatsNewService.validVersion(seenVersion)
                && this.published().some(entry => WhatsNewService.compare(entry.version, seenVersion) > 0);
        }
        async pending() {
            const state = await this.read();
            if (!WhatsNewService.validVersion(state.seenVersion)) {
                await this.acknowledge();
                return { entries: [] };
            }
            if (WhatsNewService.compare(state.seenVersion, this.version) >= 0) return { entries: [] };
            const history = this.published();
            const hasNew = history.some(entry => !entry.skipAnnouncement && WhatsNewService.compare(entry.version, state.seenVersion) > 0);
            if (!hasNew && this.entries.some(entry => !entry.draft && entry.skipAnnouncement
                && WhatsNewService.compare(entry.version, this.version) === 0)) await this.acknowledge();
            return { entries: hasNew ? history : [], seenVersion: state.seenVersion };
        }
        async acknowledge() {
            return this.transaction(async () => {
                const result = await this.storage.get(KEY);
                const state = result[KEY] || {};
                const seenVersion = WhatsNewService.validVersion(state.seenVersion)
                    && WhatsNewService.compare(state.seenVersion, this.version) > 0 ? state.seenVersion : this.version;
                await this.storage.set({ [KEY]: { seenVersion } });
            });
        }
    }
    global.WhatsNewService = WhatsNewService;
    if (typeof module !== 'undefined' && module.exports) module.exports = WhatsNewService;
}(globalThis));
