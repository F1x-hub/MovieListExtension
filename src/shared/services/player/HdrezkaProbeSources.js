/** Local HAR reader for the HDRezka pilot. Signed URLs stay in page memory. */
(function (global) {
    'use strict';
    const MAX_BYTES = 32 * 1024 * 1024;
    function fromHar(value) {
        const entries = value?.log?.entries;
        if (!Array.isArray(entries) || entries.length > 10000) throw new Error('invalid-har');
        const sources = new Map();
        for (const entry of entries) {
            if (entry?.request?.method !== 'GET' || entry?.response?.status !== 200) continue;
            const checked = global.UrlPolicy.check(entry.request.url, { profile: 'hdrezka', kind: 'manifest' });
            if (!checked.ok) continue;
            const url = new URL(checked.url);
            if (!url.pathname.endsWith('.m3u8')) continue;
            if (sources.has(checked.url)) continue;
            sources.set(checked.url, { url: checked.url, host: url.hostname });
            if (sources.size === 12) break;
        }
        return [...sources.values()];
    }
    global.HdrezkaProbeSources = Object.freeze({ fromHar, MAX_BYTES });
})(typeof window !== 'undefined' ? window : globalThis);
