(function (global) {
    'use strict';

    // Values are copied only from these closed sets, never from URL/error text.
    const SOURCES = new Set(['animego', 'seasonvar', 'exfs', 'kinogo', 'rutube', 'officialyt', 'kodik', 'vidsrc', 'torrent']);
    const RESOURCES = new Set(['manifest', 'level', 'init', 'fragment', 'key', 'file', 'subtitle', 'iframe', 'preview']);

    function ownData(value, key) {
        if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
        try {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
        } catch {
            return undefined;
        }
    }

    function safeSourceId(value) {
        if (typeof value !== 'string') return 'unknown';
        const id = value.startsWith('parser:') ? value.slice(7) : value;
        return SOURCES.has(id) ? id : 'unknown';
    }

    function httpStatus(error) {
        const response = ownData(error, 'response');
        for (const value of [ownData(error, 'status'), ownData(response, 'code'), ownData(error, 'code')]) {
            if (Number.isInteger(value) && value >= 400 && value <= 599) return value;
        }
        return undefined;
    }

    function errorCategory(error) {
        const name = ownData(error, 'name');
        const message = ownData(error, 'message');
        const responseText = ownData(ownData(error, 'response'), 'text');
        if (responseText === 'POLICY_VIOLATION' || message === 'POLICY_VIOLATION') return 'policy';
        if (message === 'decode_failed') return 'decode';
        if (name === 'AbortError') return 'aborted';
        if (name === 'TimeoutError') return 'timeout';
        if (name === 'NetworkError') return 'network';
        if (httpStatus(error) !== undefined) return 'http';
        return 'unknown';
    }

    function sanitizeError(error) {
        const category = errorCategory(error);
        const code = httpStatus(error);
        return category === 'http' ? { category, code } : { category };
    }

    // Deliberately ignores every part of the URL, including path and origin.
    function redactUrl(_url, providerId, resource = 'unknown') {
        return { providerId: safeSourceId(providerId), resource: RESOURCES.has(resource) ? resource : 'unknown' };
    }

    const api = Object.freeze({ safeSourceId, errorCategory, sanitizeError, redactUrl });
    global.PlayerDiagnostics = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
