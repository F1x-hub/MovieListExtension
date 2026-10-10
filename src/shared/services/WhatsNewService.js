/* Shared with the classic background worker; no Firebase or UI dependencies. */
(function (global) {
    const KEY = 'whatsNewV1';
    class WhatsNewService {
        static key = KEY;
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
            const result = await this.storage.get(KEY);
            return result[KEY] || {};
        }
        async observeInstallation(details) {
            const state = await this.read();
            if (details.reason === 'install') {
                await this.storage.set({ [KEY]: { seenVersion: this.version } });
            } else if (details.reason === 'update' && !WhatsNewService.validVersion(state.seenVersion)) {
                const previous = details.previousVersion;
                const baseline = WhatsNewService.validVersion(previous) && WhatsNewService.compare(previous, this.version) < 0
                    ? previous : this.version;
                await this.storage.set({ [KEY]: { seenVersion: baseline } });
            }
        }
        published() {
            return this.entries.filter(entry => !entry.draft && !entry.skipAnnouncement
                && WhatsNewService.validVersion(entry.version) && WhatsNewService.compare(entry.version, this.version) <= 0)
                .sort((a, b) => WhatsNewService.compare(b.version, a.version));
        }
        history({ preview = false } = {}) {
            return preview ? this.entries.filter(entry => entry.draft) : this.published();
        }
        async pending() {
            const state = await this.read();
            if (!WhatsNewService.validVersion(state.seenVersion)) {
                await this.acknowledge();
                return { entries: [], truncated: false };
            }
            if (WhatsNewService.compare(state.seenVersion, this.version) >= 0) return { entries: [], truncated: false };
            const eligible = this.published().filter(entry => WhatsNewService.compare(entry.version, state.seenVersion) > 0);
            let budget = 12;
            const entries = eligible.slice(0, 3).map(entry => {
                const highlights = entry.highlights.slice(0, budget);
                budget -= highlights.length;
                return { ...entry, highlights };
            }).filter(entry => entry.highlights.length);
            const shown = entries.reduce((sum, entry) => sum + entry.highlights.length, 0);
            const total = eligible.reduce((sum, entry) => sum + entry.highlights.length, 0);
            if (!entries.length && this.entries.some(entry => !entry.draft && entry.skipAnnouncement
                && WhatsNewService.compare(entry.version, this.version) === 0)) await this.acknowledge();
            return { entries, truncated: shown < total };
        }
        async acknowledge() {
            const state = await this.read();
            const seenVersion = WhatsNewService.validVersion(state.seenVersion)
                && WhatsNewService.compare(state.seenVersion, this.version) > 0 ? state.seenVersion : this.version;
            await this.storage.set({ [KEY]: { seenVersion } });
        }
    }
    global.WhatsNewService = WhatsNewService;
    if (typeof module !== 'undefined' && module.exports) module.exports = WhatsNewService;
}(globalThis));
