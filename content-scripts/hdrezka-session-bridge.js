/** Isolated bridge for the extension-owned HDRezka subframe only. */
(function (global) {
    'use strict';
    const nonce = /^#movielist-hdrezka=([a-f0-9]{32})$/.exec(location.hash)?.[1];
    if (!nonce || global === global.top || location.origin !== 'https://hdrezka.co') return;
    const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
    if (location.ancestorOrigins?.[0] !== extensionOrigin || typeof global.HdrezkaSiteRequest !== 'function') return;
    const pending = new Set();
    const work = new Map();
    let disposed = false;
    const accessRequired = () => ({ error: 'HDREZKA_ACCESS_REQUIRED' });
    const post = message => {
        try { global.parent.postMessage({ ...message, nonce }, extensionOrigin); }
        catch { /* The owning document left. */ }
    };
    const onMessage = event => {
        const message = event.data;
        if (disposed || !event.isTrusted || event.source !== global.parent || event.origin !== extensionOrigin
            || message?.type !== 'HDREZKA_SITE_REQUEST' || message.nonce !== nonce
            || !/^[a-f0-9]{32}$/.test(message.requestId) || pending.has(message.requestId)
            || !['search', 'details', 'streams'].includes(message.action)
            || !message.input || typeof message.input !== 'object' || Array.isArray(message.input)) return;
        const requestId = message.requestId;
        const key = JSON.stringify([message.action, message.input]);
        pending.add(requestId);
        if (!work.has(key)) {
            const promise = Promise.resolve().then(() => global.HdrezkaSiteRequest(message.action, message.input))
                .catch(accessRequired).finally(() => { if (work.get(key) === promise) work.delete(key); });
            work.set(key, promise);
        }
        work.get(key).then(data => {
            if (disposed || !pending.delete(requestId)) return;
            post({ type: 'HDREZKA_SITE_RESULT', requestId, data });
        });
    };
    global.addEventListener('message', onMessage);
    global.addEventListener('pagehide', () => {
        disposed = true;
        global.removeEventListener('message', onMessage);
        for (const requestId of pending) post({ type: 'HDREZKA_SITE_RESULT', requestId, data: accessRequired() });
        pending.clear();
        work.clear();
        post({ type: 'HDREZKA_SITE_CLOSED' });
    }, { once: true });
    post({ type: 'HDREZKA_SITE_READY' });
})(globalThis);
