/* Announcement-only checks. Installation safety remains owned by UpdateService. */
(function (global) {
    const bounded = (task, timeoutMs, fallback) => {
        let timer;
        return Promise.race([
            Promise.resolve().then(task).catch(() => fallback),
            new Promise(resolve => { timer = setTimeout(() => resolve(fallback), timeoutMs); })
        ]).finally(() => clearTimeout(timer));
    };
    async function inspect(chrome, senderTabId, { timeoutMs = 1200, probeTimeoutMs = 800 } = {}) {
        return bounded(async () => {
            const radio = bounded(async () => {
                if (!chrome.offscreen?.hasDocument || !await chrome.offscreen.hasDocument()) return false;
                const state = await new Promise(resolve => chrome.runtime.sendMessage(
                    { type: 'RADIO_GET_STATE', target: 'offscreen-radio' },
                    response => resolve(chrome.runtime.lastError ? null : response)));
                return state?.isPlaying === true;
            }, probeTimeoutMs, true);
            const tabs = await chrome.tabs.query({});
            const extensionPrefix = chrome.runtime.getURL('');
            const probes = tabs.filter(tab => Number.isInteger(tab.id) && tab.id !== senderTabId
                && !tab.discarded && tab.status === 'complete'
                && (/^https?:\/\//.test(tab.url || '')
                    || (String(tab.url || '').startsWith(extensionPrefix)
                        && /\/pages\/(movie-details|search)\//.test(tab.url))))
                .map(tab => bounded(async () => {
                    if (tab.audible) return true;
                    const result = await new Promise(resolve => chrome.tabs.sendMessage(tab.id,
                        { type: 'UPDATE_QUERY_PLAYBACK' }, response => resolve(chrome.runtime.lastError ? null : response)));
                    return result?.isPlaying === true;
                }, probeTimeoutMs, true));
            return { safe: !(await Promise.all([radio, ...probes])).some(Boolean) };
        }, timeoutMs, { safe: false });
    }
    global.WhatsNewPlaybackService = { inspect };
    if (typeof module !== 'undefined' && module.exports) module.exports = { inspect };
}(globalThis));
