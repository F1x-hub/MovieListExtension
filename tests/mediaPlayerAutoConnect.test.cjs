const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/shared/services/MediaPlayerService.js'), 'utf8');
const nativeCalls = [];
let writes = 0;
let detectedPath = 'C:\\Apps\\MediaPlayer Suite\\current';
const window = {
    chrome: {
        runtime: {
            sendNativeMessage: (_host, message, done) => {
                nativeCalls.push(message);
                done(message.action === 'detect_installation'
                    ? { installPath: detectedPath }
                    : { ready: true, checks: [{ id: 'service_ready', status: 'pass' }] });
            }
        },
        storage: { local: { set: (_value, done) => { writes += 1; done(); } } }
    },
    fetch: async () => ({ ok: true, json: async () => ({ torrents: { movies: { status: 'ready' } } }) })
};
vm.runInNewContext(source, { window, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, console });

(async () => {
    const service = new window.MediaPlayerService();
    const connected = await service.autoConnectInstallation();
    assert.equal(connected.status, 'ready');
    assert.equal(connected.installPath, detectedPath);
    assert.deepEqual(nativeCalls.map(call => call.action), ['detect_installation', 'verify_installation']);
    assert.equal(writes, 1);
    await service.autoConnectInstallation({ shouldPersist: () => false });
    assert.equal(writes, 1, 'A disabled or superseded setup must not persist a late result');
    detectedPath = '';
    await assert.rejects(service.autoConnectInstallation(), error => error.code === 'installation_not_found');
    assert.equal(writes, 1, 'Failed detection must not enable the integration');
    console.log('PASS MediaPlayer automatic connection and stale setup protection');
})().catch(error => { console.error(error); process.exitCode = 1; });
