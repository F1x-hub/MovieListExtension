/** A single hidden provider document shared by background HDRezka requests. */
(function (global) {
    'use strict';
    const runtime = global.chrome.runtime;
    const SITE_ORIGIN = 'https://hdrezka.co';
    const accessRequired = () => ({ error: 'HDREZKA_ACCESS_REQUIRED' });
    const inFlight = new Map();
    let context = null;
    let disposed = false;

    function inputFor(action, input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
        if (action === 'search') {
            return typeof input.query === 'string' && input.query.length >= 2 && input.query.length <= 200
                ? { query: input.query } : null;
        }
        if (!['details', 'streams'].includes(action)) return null;
        const url = global.HdrezkaProtocol.pageUrl(input.url);
        if (!url) return null;
        if (action === 'details') return { url };
        if (input.translationId != null && !/^[1-9]\d{0,8}$/.test(input.translationId)) return null;
        return input.translationId == null ? { url } : { url, translationId: String(input.translationId) };
    }

    function closeContext(current) {
        if (context !== current) return;
        context = null;
        clearTimeout(current.readyTimer);
        current.rejectReady();
        for (const pending of current.pending.values()) {
            clearTimeout(pending.timer);
            pending.resolve(accessRequired());
        }
        current.pending.clear();
        current.frame.remove();
    }

    function ensureContext() {
        if (context) return context;
        const frame = document.createElement('iframe');
        frame.hidden = true;
        frame.style.cssText = 'display:none;width:0;height:0;border:0;';
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        frame.setAttribute('allow', "autoplay 'none'; camera 'none'; microphone 'none'");
        frame.referrerPolicy = 'no-referrer';
        const current = { frame, nonce: crypto.randomUUID().replaceAll('-', ''), pending: new Map(), ready: false, loaded: false };
        current.readyPromise = new Promise((resolve, reject) => {
            current.resolveReady = resolve;
            current.rejectReady = () => reject(new Error('HDREZKA_ACCESS_REQUIRED'));
        });
        context = current;
        current.readyTimer = setTimeout(() => closeContext(current), 5000);
        frame.addEventListener('error', () => closeContext(current));
        frame.addEventListener('load', () => {
            if (current.loaded) closeContext(current);
            current.loaded = true;
        });
        frame.src = `${SITE_ORIGIN}/#movielist-hdrezka=${current.nonce}`;
        document.body.appendChild(frame);
        return current;
    }

    global.addEventListener('message', event => {
        const current = context;
        const message = event.data;
        if (!current || !event.isTrusted || event.source !== current.frame.contentWindow || event.origin !== SITE_ORIGIN
            || message?.nonce !== current.nonce) return;
        if (message.type === 'HDREZKA_SITE_READY') {
            if (!current.ready) {
                current.ready = true;
                clearTimeout(current.readyTimer);
                current.resolveReady();
            }
        } else if (message.type === 'HDREZKA_SITE_CLOSED') {
            closeContext(current);
        } else if (message.type === 'HDREZKA_SITE_RESULT') {
            const pending = current.pending.get(message.requestId);
            if (!pending) return;
            current.pending.delete(message.requestId);
            clearTimeout(pending.timer);
            pending.resolve(message.data && typeof message.data === 'object' && !Array.isArray(message.data)
                ? message.data : accessRequired());
        }
    });

    async function request(action, input) {
        if (disposed) return accessRequired();
        const current = ensureContext();
        try { await current.readyPromise; }
        catch { return accessRequired(); }
        if (context !== current || disposed) return accessRequired();
        return new Promise(resolve => {
            const requestId = crypto.randomUUID().replaceAll('-', '');
            const timer = setTimeout(() => closeContext(current), 20000);
            current.pending.set(requestId, { resolve, timer });
            try {
                current.frame.contentWindow.postMessage({ type: 'HDREZKA_SITE_REQUEST', nonce: current.nonce, requestId, action, input }, SITE_ORIGIN);
            } catch { closeContext(current); }
        });
    }

    runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== 'HDREZKA_OFFSCREEN_REQUEST' || message.target !== 'offscreen-hdrezka') return false;
        if (sender?.id !== runtime.id || sender?.url !== runtime.getURL('src/background/background.js') || sender.tab) {
            sendResponse(accessRequired());
            return false;
        }
        const input = inputFor(message.action, message.input);
        if (!input) {
            sendResponse(accessRequired());
            return false;
        }
        const key = JSON.stringify([message.action, input]);
        if (!inFlight.has(key)) {
            const work = request(message.action, input).catch(accessRequired).finally(() => {
                if (inFlight.get(key) === work) inFlight.delete(key);
            });
            inFlight.set(key, work);
        }
        inFlight.get(key).then(result => {
            try { sendResponse(result); }
            catch { /* The requesting background stopped while work was pending. */ }
        });
        return true;
    });

    global.addEventListener('pagehide', () => {
        disposed = true;
        if (context) closeContext(context);
    }, { once: true });
})(globalThis);
