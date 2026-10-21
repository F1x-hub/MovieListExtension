/** Closed URL and response contracts for the movie-only HDRezka provider. */
(function (global) {
    'use strict';
    const CDN_HOSTS = Object.freeze(['weyland', 'hronos', 'dagon', 'magic', 'bingo', 'eleos', 'ember'].map(name => `${name}.stream.voidboost.one`));
    const ROUTER = 'stream.voidboost.one';
    function parse(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
        } catch { return null; }
    }
    function pageUrl(value) {
        const url = parse(value);
        if (!url || url.hostname !== 'hdrezka.co' || url.search || url.hash
            || !/^\/films\/[a-z-]+\/[1-9]\d*-[a-z0-9-]+\.html$/.test(url.pathname)) return null;
        return url.href;
    }
    function streamUrl(value, { routing = false } = {}) {
        const url = parse(value);
        if (!url || url.hash || !url.pathname.endsWith('.m3u8')
            || !(CDN_HOSTS.includes(url.hostname) || routing && url.hostname === ROUTER)) return null;
        return url.href;
    }
    function qualities(response) {
        if (response?.success !== true || Number(response.premium_content || 0) !== 0 || typeof response.url !== 'string') return [];
        const results = new Map();
        for (const match of response.url.matchAll(/\[([^\]]+)\]([^[\]]+)/g)) {
            const quality = /^(240|360|480|720|1080|1440|2160)p$/.exec(match[1].trim());
            if (!quality) continue;
            const url = match[2].replace(/,\s*$/, '').split(/\s+or\s+/).map(value => streamUrl(value.trim(), { routing: true })).find(Boolean);
            if (url) results.set(Number(quality[1]), { height: Number(quality[1]), url });
        }
        return [...results.values()].sort((a, b) => a.height - b.height);
    }
    // Only these fields may cross the resolver port or reach diagnostics. Never
    // forward fetch errors, response bodies, redirect URLs or signed paths.
    function resolverFailure(value) {
        const code = ['HDREZKA_STREAM_EXPIRED', 'HDREZKA_RESOLVE_FAILED', 'HDREZKA_RESOLVER_RESPONSE_FAILED'].includes(value?.code)
            ? value.code : 'HDREZKA_RESOLVER_RESPONSE_FAILED';
        const result = { code };
        if (['network', 'timeout', 'http', 'invalid-request', 'invalid-final-url', 'invalid-manifest', 'response-too-large'].includes(value?.cdnReason)) {
            result.cdnReason = value.cdnReason;
        }
        if (Number.isInteger(value?.status) && value.status >= 400 && value.status <= 599) result.status = value.status;
        if (['html', 'json', 'empty', 'other'].includes(value?.responseType)) result.responseType = value.responseType;
        return result;
    }
    global.HdrezkaProtocol = Object.freeze({ CDN_HOSTS, ROUTER, pageUrl, streamUrl, qualities, resolverFailure });
})(typeof window !== 'undefined' ? window : globalThis);
