const os = require('node:os');
const path = require('node:path');

const ORIGIN = 'https://hdrezka.co';
const DEADLINE_MS = 5000;
const fail = code => Object.assign(new Error(code), { code });

/** CDP routing for the real offscreen document of an isolated fixture harness. */
async function attachOffscreenRouting(harness, handler) {
    if (typeof handler !== 'function' || typeof harness?.blockedProxyRequests !== 'function'
        || !/^[a-p]{32}$/.test(harness.extensionId || '') || typeof harness.userDataDir !== 'string'
        || path.dirname(path.resolve(harness.userDataDir)) !== path.resolve(os.tmpdir())
        || !path.basename(harness.userDataDir).startsWith('mle-player-')) {
        throw fail('OFFSCREEN_FIXTURE_HARNESS_REQUIRED');
    }
    await harness.worker.evaluate(() => ensureOffscreen());
    const cdp = await harness.context.browser().newBrowserCDPSession();
    const errors = [];
    const requests = [];
    const pending = new Map();
    const sessions = new Map();
    const paused = new Map();
    const network = new Set();
    const releasing = new Map();
    let serial = 0;
    let closing = false;
    let closed = false;
    let closePromise;
    let cancelHandlers;
    const canceled = new Promise(resolve => { cancelHandlers = resolve; });
    const keyOf = route => route.join('/');
    const record = (stage, code) => errors.push(Object.freeze({ stage, code }));

    async function bounded(promise, code, interrupt = false) {
        let timer;
        const deadline = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(fail(code)), DEADLINE_MS); });
        try {
            return await Promise.race([promise, deadline, ...(interrupt ? [canceled.then(() => { throw fail('CLOSED'); })] : [])]);
        } finally { clearTimeout(timer); }
    }

    function send(route, method, params = {}, cleanup = false) {
        if (closed || closing && !cleanup) return Promise.reject(fail('CLOSED'));
        const id = ++serial;
        return new Promise((resolve, reject) => {
            const settle = (error, result) => {
                const request = pending.get(id);
                if (!request) return;
                clearTimeout(request.timer);
                pending.delete(id);
                if (error) reject(error); else resolve(result);
            };
            const timer = setTimeout(() => settle(fail('COMMAND_TIMEOUT')), DEADLINE_MS);
            pending.set(id, { timer, route: keyOf(route), cleanup, settle });
            let packet = { id, method, params };
            for (let index = route.length - 1; index > 0; index--) {
                packet = { id: ++serial, method: 'Target.sendMessageToTarget',
                    params: { sessionId: route[index], message: JSON.stringify(packet) } };
            }
            void cdp.send('Target.sendMessageToTarget', { sessionId: route[0], message: JSON.stringify(packet) })
                .catch(() => settle(fail('COMMAND_FAILED')));
        });
    }

    async function release(route) {
        const key = keyOf(route);
        if (releasing.has(key)) return releasing.get(key);
        const work = (async () => {
            if (!sessions.has(key)) return;
            // Resume debugger-paused targets before disabling interception or
            // detaching, including a target whose setup was interrupted.
            for (const [method, params] of [
                ['Runtime.runIfWaitingForDebugger', {}], ['Fetch.disable', {}],
                ['Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: false }]
            ]) await send(route, method, params, true).catch(() => {});
            if (route.length > 1) {
                await send(route.slice(0, -1), 'Target.detachFromTarget', { sessionId: route.at(-1) }, true).catch(() => {});
            } else {
                await bounded(cdp.send('Target.detachFromTarget', { sessionId: route[0] }), 'DETACH_TIMEOUT').catch(() => {});
            }
            sessions.delete(key);
        })();
        releasing.set(key, work);
        return work;
    }

    async function setup(route) {
        sessions.set(keyOf(route), route);
        if (closing) return release(route);
        try {
            await send(route, 'Fetch.enable', { patterns: [{ urlPattern: `${ORIGIN}/*`, requestStage: 'Request' }] });
            await send(route, 'Network.enable');
            await send(route, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false });
            await send(route, 'Runtime.runIfWaitingForDebugger');
        } catch (error) {
            if (!closing) record('setup', error.code || 'COMMAND_FAILED');
            await release(route);
            if (!closing) throw fail('OFFSCREEN_ROUTING_SETUP_FAILED');
        }
    }

    async function intercept(route, params) {
        const key = `${keyOf(route)}:${params.requestId}`;
        paused.set(key, { route, requestId: params.requestId });
        try {
            const url = new URL(params.request.url);
            if (closing || url.origin !== ORIGIN || url.username || url.password) throw fail('NON_PROVIDER_REQUEST');
            requests.push(Object.freeze({
                method: ['GET', 'POST', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'].includes(params.request.method) ? params.request.method : 'OTHER',
                resourceType: ['Document', 'XHR', 'Fetch', 'Script', 'Stylesheet', 'Image', 'Media', 'Font', 'Other'].includes(params.resourceType)
                    ? params.resourceType : 'Other',
                targetDepth: route.length
            }));
            const response = await bounded(Promise.resolve().then(() => handler({ url: url.href, method: params.request.method,
                postData: params.request.postData, resourceType: params.resourceType })), 'HANDLER_TIMEOUT', true);
            if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599
                || typeof response.contentType !== 'string' || /[\r\n]/.test(response.contentType)) throw fail('INVALID_FIXTURE_RESPONSE');
            const headers = Array.isArray(response.headers) ? response.headers : Object.entries(response.headers || {})
                .map(([name, value]) => ({ name, value: String(value) }));
            if (headers.some(header => typeof header.name !== 'string' || typeof header.value !== 'string'
                || /[\r\n]/.test(header.name + header.value))) throw fail('INVALID_FIXTURE_HEADERS');
            const responseHeaders = headers.filter(header => header.name.toLowerCase() !== 'content-type');
            responseHeaders.push({ name: 'Content-Type', value: response.contentType });
            await send(route, 'Fetch.fulfillRequest', { requestId: params.requestId, responseCode: response.status,
                responseHeaders, body: Buffer.from(response.body ?? '').toString('base64') });
        } catch (error) {
            if (!closing) record('request', ['HANDLER_TIMEOUT', 'INVALID_FIXTURE_RESPONSE', 'INVALID_FIXTURE_HEADERS',
                'NON_PROVIDER_REQUEST', 'COMMAND_TIMEOUT', 'COMMAND_FAILED'].includes(error?.code) ? error.code : 'HANDLER_FAILED');
            // Unknown routes and handler failures are failed, never continued
            // into the network. The harness deny proxy remains in force too.
            await send(route, 'Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }, true).catch(() => {});
        } finally { paused.delete(key); }
    }

    async function onPacket(route, packet) {
        if (packet.id && pending.has(packet.id)) {
            pending.get(packet.id).settle(packet.error ? fail('COMMAND_FAILED') : null, packet.result);
        }
        if (packet.method === 'Target.receivedMessageFromTarget') {
            await onPacket([...route, packet.params.sessionId], JSON.parse(packet.params.message));
        } else if (packet.method === 'Target.attachedToTarget') {
            await setup([...route, packet.params.sessionId]);
        } else if (packet.method === 'Target.detachedFromTarget') {
            const key = keyOf([...route, packet.params.sessionId]);
            sessions.delete(key);
            for (const request of pending.values()) if (request.route === key) request.settle(fail('TARGET_DETACHED'));
        } else if (packet.method === 'Fetch.requestPaused') {
            await intercept(route, packet.params);
        } else if (packet.method === 'Network.requestWillBeSent') {
            try { if (new URL(packet.params.request.url).origin === ORIGIN) network.add(`${keyOf(route)}:${packet.params.requestId}`); }
            catch { /* No unparsed URLs enter diagnostics. */ }
        } else if (packet.method === 'Network.loadingFailed' && network.delete(`${keyOf(route)}:${packet.params.requestId}`) && !closing) {
            record('network', /^net::ERR_[A-Z_]+$/.test(packet.params.errorText) ? packet.params.errorText : 'NETWORK_FAILED');
        } else if (packet.method === 'Network.loadingFinished') {
            network.delete(`${keyOf(route)}:${packet.params.requestId}`);
        }
    }

    const onMessage = event => {
        void Promise.resolve().then(() => onPacket([event.sessionId], JSON.parse(event.message)))
            .catch(() => { if (!closing) record('event', 'EVENT_HANDLER_FAILED'); });
    };
    cdp.on('Target.receivedMessageFromTarget', onMessage);

    async function close() {
        if (closePromise) return closePromise;
        closePromise = (async () => {
            closing = true;
            cancelHandlers();
            for (const request of pending.values()) if (!request.cleanup) request.settle(fail('CLOSED'));
            await Promise.allSettled([...paused.values()].map(request => send(request.route, 'Fetch.failRequest',
                { requestId: request.requestId, errorReason: 'BlockedByClient' }, true)));
            while (sessions.size) {
                const routes = [...sessions.values()];
                const depth = Math.max(...routes.map(route => route.length));
                await Promise.allSettled(routes.filter(route => route.length === depth).map(release));
            }
            for (const request of pending.values()) request.settle(fail('CLOSED'));
            cdp.off('Target.receivedMessageFromTarget', onMessage);
            await bounded(cdp.detach(), 'DETACH_TIMEOUT').catch(() => {});
            closed = true;
            paused.clear(); network.clear();
        })();
        return closePromise;
    }

    try {
        const { targetInfos } = await bounded(cdp.send('Target.getTargets'), 'TARGETS_TIMEOUT');
        const matches = targetInfos.filter(target => target.type === 'background_page'
            && target.url === `chrome-extension://${harness.extensionId}/src/offscreen/offscreen.html`);
        if (matches.length !== 1) throw fail('OFFSCREEN_FIXTURE_TARGET_REQUIRED');
        const { sessionId } = await bounded(cdp.send('Target.attachToTarget', { targetId: matches[0].targetId, flatten: false }), 'ATTACH_TIMEOUT');
        await setup([sessionId]);
    } catch (error) { await close(); throw error; }

    return Object.freeze({ get errors() { return Object.freeze([...errors]); },
        get requests() { return Object.freeze([...requests]); }, close });
}

module.exports = { attachOffscreenRouting };
