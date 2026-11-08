#!/usr/bin/env node
/**
 * One debugging connection to the owner's Chrome for a whole task.
 *
 * Chrome asks the owner to allow every new remote-debugging connection. That question is
 * Chrome's protection against any local program taking over the profile (cookies, saved
 * data, sign-ins), so it is never answered by a script. Instead, the bridge connects once,
 * while the owner is at the screen, and keeps that connection: later checks and
 * `npm run test:live:player` send their commands through it, and Chrome does not ask again.
 *
 *   npm run live:bridge                    start in the background; Chrome asks once
 *   node tests/live/chrome-bridge.cjs status
 *   node tests/live/chrome-bridge.cjs send <method> [paramsJson] [sessionId]
 *   node tests/live/chrome-bridge.cjs eval <sessionId> <file.js>
 *   node tests/live/chrome-bridge.cjs stop
 *
 * Commands are accepted on 127.0.0.1 only, under a random path kept in
 * .e2e-output/live/bridge.json (git-ignored). The bridge stops after two idle hours
 * (`--idle <seconds>`), when Chrome closes the connection, or on `stop`; it gives up waiting
 * for the owner's answer after 30 minutes (`--wait <seconds>`).
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT_FILE = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'DevToolsActivePort');
const OUTPUT = path.join(__dirname, '..', '..', '.e2e-output', 'live');
const STATE_FILE = path.join(OUTPUT, 'bridge.json');
const EVENTS_LIMIT = 5000;
const RECORDED_EVENTS = new Set([
    'Target.attachedToTarget', 'Target.detachedFromTarget', 'Target.targetDestroyed',
    'Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Page.loadEventFired'
]);

const option = (name, fallback) => {
    const index = process.argv.indexOf(name);
    const value = index >= 0 ? Number(process.argv[index + 1]) : NaN;
    return Number.isFinite(value) && value > 0 ? value * 1000 : fallback;
};

function readState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return null;
    }
}

/** The running bridge's base URL, or null when none answers. */
async function bridgeUrl() {
    const state = readState();
    if (!state?.url) return null;
    try {
        const response = await fetch(`${state.url}status`, { signal: AbortSignal.timeout(2000) });
        const status = await response.json();
        return status.connected ? state.url : null;
    } catch {
        return null;
    }
}

async function call(base, route, body) {
    const response = await fetch(base + route, body === undefined ? undefined : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const value = await response.json();
    if (value && value.error) throw new Error(value.error);
    return value;
}

async function start() {
    if (await bridgeUrl()) {
        console.log('A bridge is already connected.');
        return;
    }
    const waitMs = option('--wait', 30 * 60_000);
    const idleMs = option('--idle', 2 * 60 * 60_000);
    const token = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(OUTPUT, { recursive: true });

    let socket = null;
    let nextId = 1;
    let lastUse = Date.now();
    const pending = new Map();
    const events = [];
    let eventSeq = 0;

    const send = (method, params = {}, sessionId, timeoutMs = 60000) => new Promise((resolve, reject) => {
        if (!socket) return reject(new Error('Chrome has not allowed the connection yet.'));
        const id = nextId++;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, timeoutMs);
        pending.set(id, {
            method,
            resolve: value => { clearTimeout(timer); resolve(value); },
            reject: error => { clearTimeout(timer); reject(error); }
        });
        socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });

    const stop = code => {
        try { fs.rmSync(STATE_FILE, { force: true }); } catch { /* already gone */ }
        try { socket?.close(); } catch { /* closing anyway */ }
        process.exit(code);
    };

    const server = http.createServer(async (request, response) => {
        const reply = (status, value) => {
            response.writeHead(status, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify(value));
        };
        if (!request.url.startsWith(`/${token}/`)) return reply(404, { error: 'not found' });
        lastUse = Date.now();
        const route = request.url.slice(token.length + 2);
        const body = () => new Promise(resolve => {
            let text = '';
            request.on('data', chunk => { text += chunk; });
            request.on('end', () => resolve(text ? JSON.parse(text) : {}));
        });
        try {
            if (route === 'status') return reply(200, { connected: Boolean(socket), pid: process.pid });
            if (route === 'send') {
                const { method, params, sessionId, timeoutMs } = await body();
                return reply(200, await send(method, params, sessionId, timeoutMs));
            }
            if (route === 'eval') {
                const { sessionId, expression, timeoutMs } = await body();
                const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId, timeoutMs);
                if (result.exceptionDetails) return reply(200, { error: result.exceptionDetails.exception?.description || result.exceptionDetails.text });
                return reply(200, { value: result.result.value });
            }
            if (route.startsWith('events')) {
                const since = Number(new URL(request.url, 'http://bridge').searchParams.get('since') || 0);
                return reply(200, events.filter(event => event.seq > since));
            }
            if (route === 'stop') {
                reply(200, { stopped: true });
                setTimeout(() => stop(0), 50);
                return undefined;
            }
            return reply(404, { error: 'unknown route' });
        } catch (error) {
            return reply(500, { error: String(error.message || error) });
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/${token}/`;
    fs.writeFileSync(STATE_FILE, JSON.stringify({ url, pid: process.pid, startedAt: new Date().toISOString() }));

    if (!fs.existsSync(PORT_FILE)) {
        console.error('Remote debugging is off. Open chrome://inspect/#remote-debugging in Chrome and turn it on.');
        stop(2);
    }
    const [port, socketPath] = fs.readFileSync(PORT_FILE, 'utf8').trim().split(/\r?\n/);
    console.log('Connecting to Chrome. It asks once: press Allow.');
    const deadline = Date.now() + waitMs;
    for (;;) {
        try {
            socket = await new Promise((resolve, reject) => {
                const ws = new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);
                ws.onopen = () => resolve(ws);
                ws.onerror = () => reject(new Error('not allowed yet'));
            });
            break;
        } catch {
            if (Date.now() > deadline) {
                console.error('Chrome did not allow the connection in time; the live check stays pending.');
                stop(2);
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.id) {
            const entry = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) entry?.reject(new Error(`${entry.method}: ${message.error.message}`));
            else entry?.resolve(message.result);
            return;
        }
        if (!RECORDED_EVENTS.has(message.method)) return;
        const params = message.method === 'Runtime.consoleAPICalled'
            ? { type: message.params.type, text: message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ').slice(0, 2000) }
            : message.params;
        events.push({ seq: ++eventSeq, at: Date.now(), sessionId: message.sessionId || null, method: message.method, params });
        if (events.length > EVENTS_LIMIT) events.splice(0, events.length - EVENTS_LIMIT);
    };
    socket.onclose = () => {
        console.log('Chrome closed the connection.');
        stop(0);
    };
    lastUse = Date.now();
    console.log(`Connected. The command address is in ${STATE_FILE}; the bridge stops after ${Math.round(idleMs / 60000)} idle minutes.`);
    setInterval(() => {
        if (Date.now() - lastUse > idleMs) {
            console.log('Idle for too long; closing the connection.');
            stop(0);
        }
    }, 60_000).unref();
}

/**
 * A stand-in for a direct CDP socket, for scripts such as player-live.cjs: `send`,
 * `evaluate`, child-frame sessions in `frames`, and `close` (which leaves the bridge running).
 * Returns null when no bridge is connected.
 */
async function connectThroughBridge() {
    const base = await bridgeUrl();
    if (!base) return null;
    const frames = new Map();
    let since = (await call(base, 'events?since=0')).reduce((last, event) => Math.max(last, event.seq), 0);
    let stopped = false;
    const poll = async () => {
        while (!stopped) {
            try {
                for (const event of await call(base, `events?since=${since}`)) {
                    since = Math.max(since, event.seq);
                    if (event.method === 'Target.attachedToTarget' && event.sessionId) frames.set(event.params.sessionId, { parent: event.sessionId });
                    if (event.method === 'Target.detachedFromTarget') frames.delete(event.params.sessionId);
                }
            } catch { /* the next round tries again */ }
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    };
    void poll();
    return {
        frames,
        send: (method, params = {}, sessionId) => call(base, 'send', { method, params, sessionId }),
        async evaluate(sessionId, expression) {
            const { value } = await call(base, 'eval', { sessionId, expression, timeoutMs: 60000 });
            return value;
        },
        close() { stopped = true; }
    };
}

module.exports = { bridgeUrl, connectThroughBridge };

if (require.main === module) {
    const [command = 'start', ...args] = process.argv.slice(2);
    (async () => {
        if (command === 'start') return start();
        const base = await bridgeUrl();
        if (command === 'status') {
            console.log(base ? 'connected' : 'not connected');
            return undefined;
        }
        if (!base) throw new Error('No bridge is connected. Run `npm run live:bridge` while the owner is at the screen.');
        let result;
        if (command === 'send') {
            const [method, params, sessionId] = args;
            result = await call(base, 'send', { method, params: params ? JSON.parse(params) : {}, sessionId: sessionId || undefined });
        } else if (command === 'eval') {
            const [sessionId, file] = args;
            result = await call(base, 'eval', { sessionId: sessionId === '-' ? undefined : sessionId, expression: fs.readFileSync(file, 'utf8'), timeoutMs: 120000 });
        } else if (command === 'stop') {
            result = await call(base, 'stop', {});
        } else {
            throw new Error(`Unknown command: ${command}`);
        }
        console.log(JSON.stringify(result, null, 1));
        return undefined;
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
