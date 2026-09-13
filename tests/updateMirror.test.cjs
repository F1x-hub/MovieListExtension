const assert = require('node:assert/strict');
const { compare } = require('../scripts/update-mirror.cjs');
assert.equal(compare('1.10.0', '1.9.9'), 1);
assert.equal(compare('1.3.2', '1.3.3'), -1);
assert.equal(compare('1.3.3', '1.3.3'), 0);
assert.equal(compare('1.3.2', '1.3.2.1'), -1);
assert.equal(compare('1.3.2.1', '1.3.2'), 1);
assert.equal(compare('1.3.2.1', '1.3.2.1'), 0);
assert.throws(() => compare('v1.3.3', '1.3.3'));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../scripts/update-mirror.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update-mirror-test-'));
const original = process.cwd();
const originalFetch = global.fetch;
const originalTag = process.env.GITHUB_REF_NAME;
(async () => {
    process.chdir(root);
    process.env.GITHUB_REF_NAME = 'v1.3.3';
    fs.writeFileSync('update.json', JSON.stringify({ version: '1.3.3', sha256: 'a' }));
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ version: '1.3.4', sha256: 'b' }) });
    await assert.rejects(main('prepare'), /newer mirror/);
    global.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(main('prepare'), /Cannot establish/);
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ version: '1.3.3', sha256: 'b' }) });
    await assert.rejects(main('prepare'), /different content/);
    assert.equal(fs.existsSync('.update-mirror'), false);
    const bytes = Buffer.from('archive');
    const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync('update.json', JSON.stringify({ version: '1.3.3', sha256: hash }));
    fs.writeFileSync('update.json.sig', 'signature');
    const active = 'sites/movielistdb-13208-updates/versions/active';
    const previous = 'sites/movielistdb-13208-updates/versions/previous';
    const deleted = [];
    const originalToken = process.env.GOOGLE_ACCESS_TOKEN;
    process.env.GOOGLE_ACCESS_TOKEN = 'test-only';
    global.fetch = async (url, options = {}) => {
        if (options.method === 'DELETE') { deleted.push(url); return { ok: true }; }
        if (options.method === 'PATCH') return { ok: true };
        if (url.includes('/channels/live')) return { ok: true, json: async () => ({ release: { version: { name: active } } }) };
        if (url.includes('/versions?')) return { ok: true, json: async () => ({ versions: [
            { name: active, status: 'FINALIZED' }, { name: previous, status: 'FINALIZED' },
            { name: 'sites/movielistdb-13208-updates/versions/pending', status: 'CREATED' }
        ] }) };
        const file = url.split('/').pop();
        const content = file.endsWith('.zip') ? bytes : fs.readFileSync(file);
        return { ok: true, text: async () => content.toString(), arrayBuffer: async () => content };
    };
    try {
        await main('verify-cleanup');
        assert.deepEqual(deleted, ['https://firebasehosting.googleapis.com/v1beta1/' + previous]);
    } finally {
        if (originalToken === undefined) delete process.env.GOOGLE_ACCESS_TOKEN;
        else process.env.GOOGLE_ACCESS_TOKEN = originalToken;
    }
    console.log('Mirror rejects downgrades, uncertain network state and same-version replacements.');
    console.log('Cleanup preserves active and unfinished Hosting versions.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    process.chdir(original);
    global.fetch = originalFetch;
    if (originalTag === undefined) delete process.env.GITHUB_REF_NAME;
    else process.env.GITHUB_REF_NAME = originalTag;
    fs.rmSync(root, { recursive: true, force: true });
});
