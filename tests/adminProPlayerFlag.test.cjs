const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/pages/admin/admin.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'src/pages/admin/admin.js'), 'utf8');
function harness(admin = true, fail = false) {
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    // Do not boot Firebase or the production manager constructor in this isolated UI test.
    dom.window.eval(source.replace(/document.addEventListener\('DOMContentLoaded',[\s\S]*$/, '') + '\nwindow.TestAdmin = AdminPanelManager;');
    const manager = Object.create(dom.window.TestAdmin.prototype);
    manager.isAdmin = admin;
    const writes = [];
    dom.window.ProPlayerPreferences = { isEnabled: async () => false, setEnabled: async enabled => { writes.push(enabled); if (fail) throw Error('quota'); }, subscribe: () => () => {} };
    return { dom, manager, writes, toggle: dom.window.document.getElementById('proPlayerEnabled') };
}
test('admin toggle lives inside gated content and dependency loads before manager', () => {
    const { dom, toggle } = harness();
    assert.ok(toggle.closest('#adminContent'));
    assert.equal(toggle.disabled, true);
    assert.ok(html.indexOf('player/ProPlayerPreferences.js') < html.indexOf('src="admin.js"'));
    dom.window.close();
});
test('nonadmin cannot bind or write; revoked access disables already bound control', async () => {
    const h = harness(false);
    await h.manager.setupProPlayerPreference();
    h.toggle.checked = true;
    h.toggle.dispatchEvent(new h.dom.window.Event('change'));
    assert.deepEqual(h.writes, []);
    h.manager.setAdminAccessState(false);
    assert.equal(h.toggle.disabled, true);
    h.dom.window.close();
    const bound = harness(true);
    await bound.manager.setupProPlayerPreference();
    bound.manager.setAdminAccessState(false);
    bound.toggle.checked = true;
    bound.toggle.dispatchEvent(new bound.dom.window.Event('change'));
    assert.deepEqual(bound.writes, []);
    assert.equal(bound.toggle.disabled, true);
    bound.dom.window.close();
});
test('admin saves locally and failed write rolls back with an accessible message', async () => {
    for (const fail of [false, true]) {
        const h = harness(true, fail);
        await h.manager.setupProPlayerPreference();
        assert.equal(h.toggle.disabled, false);
        h.toggle.checked = true;
        h.toggle.dispatchEvent(new h.dom.window.Event('change'));
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(h.writes, [true]);
        assert.equal(h.toggle.checked, !fail);
        assert.equal(h.toggle.disabled, false);
        assert.match(h.dom.window.document.getElementById('proPlayerStatus').textContent, fail ? /Не удалось/ : /включено/);
        h.dom.window.close();
    }
});
