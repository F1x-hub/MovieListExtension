// The bundled frame's own CSP checks each request and redirect before network access.
(function () {
    'use strict';
    const nonce = location.hash.slice(1);
    if (!/^[a-f0-9]{32}$/.test(nonce)) return;
    chrome.runtime.onConnect.addListener(port => {
        if (port.name !== `hdrezka-resolver:${nonce}` || port.sender?.id !== chrome.runtime.id
            || !port.sender?.url?.startsWith(chrome.runtime.getURL(''))) return;
        let used = false;
        const controller = new AbortController();
        port.onDisconnect.addListener(() => controller.abort());
        port.onMessage.addListener(async message => {
            if (used) return;
            used = true;
            const url = HdrezkaProtocol.streamUrl(message?.url, { routing: true });
            const timer = setTimeout(() => controller.abort(), 8000);
            const fail = (cdnReason, details = {}) => {
                throw Object.assign(new Error('CDN resolution failed'), { code: 'HDREZKA_RESOLVER_RESPONSE_FAILED', cdnReason, ...details });
            };
            try {
                if (!url) fail('invalid-request');
                // Every hop is checked by this frame's connect-src policy. The
                // ordinary HLS loader still rejects all redirects itself.
                const response = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: controller.signal });
                if ([401, 403, 404, 410].includes(response.status)) {
                    fail('http', { code: 'HDREZKA_STREAM_EXPIRED', status: response.status });
                }
                if (!response.ok) fail('http', { status: response.status });
                if (!HdrezkaProtocol.streamUrl(response.url)) fail('invalid-final-url');
                const text = await response.text();
                if (text.length > 2000000) fail('response-too-large');
                const body = text.trimStart();
                if (!body.startsWith('#EXTM3U')) {
                    const responseType = !body ? 'empty' : body.startsWith('<') ? 'html' : body.startsWith('{') || body.startsWith('[') ? 'json' : 'other';
                    fail('invalid-manifest', { responseType });
                }
                port.postMessage({ url: response.url });
            } catch (failure) {
                const diagnostic = HdrezkaProtocol.resolverFailure(['HDREZKA_STREAM_EXPIRED', 'HDREZKA_RESOLVER_RESPONSE_FAILED'].includes(failure?.code) ? failure : {
                    code: controller.signal.aborted ? 'HDREZKA_RESOLVE_FAILED' : 'HDREZKA_RESOLVER_RESPONSE_FAILED',
                    cdnReason: controller.signal.aborted ? 'timeout' : 'network'
                });
                try { port.postMessage({ ...diagnostic, error: diagnostic.code }); }
                catch { /* caller left */ }
            }
            finally { clearTimeout(timer); }
        });
    });
})();
