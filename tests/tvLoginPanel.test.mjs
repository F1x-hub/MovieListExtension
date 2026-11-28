// Settings → «Телевизор»: a late answer never shows or approves a code the user has left
// (the Async UI rule in .agents/rules/agent.md), the confirmation sends the code it showed,
// and a guest gets no form. The entry is in Settings only, not on the profile.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const html = readFileSync(path.join(root, 'src/pages/settings/settings.html'), 'utf8');
const dom = new JSDOM(html);
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { TvLoginPanel, normalizeTvCode } = await import('../src/pages/settings/TvLoginPanel.js');

assert.equal(normalizeTvCode('k7q·4md'), 'K7Q4MD');
assert.equal(normalizeTvCode('K7Q4M0'), null, '0 is not in the alphabet');

const $ = (id) => document.getElementById(id);

// The section has its own entry in the Settings menu; the profile no longer offers it.
assert.ok(document.querySelector('.sidebar-link[data-target="tv"]'), 'Settings menu has «Телевизор»');
assert.ok($('pane-tv'), 'Settings has the TV pane');
const profileHtml = readFileSync(path.join(root, 'src/pages/profile/profile.html'), 'utf8');
assert.doesNotMatch(profileHtml, /tvLogin/, 'the profile has no TV sign-in entry');

/** A fetch whose answers the test releases one by one. */
function controlledFetch() {
    const calls = [];
    const fetchImpl = (url, options) => new Promise((resolve) => {
        calls.push({ url, body: JSON.parse(options.body), auth: options.headers.Authorization, resolve });
    });
    const answer = (index, body, status = 200) => calls[index].resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    });
    return { calls, fetchImpl, answer };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const user = { uid: 'owner', getIdToken: async () => 'id-token' };

let currentUser = user;
// One panel for the page, as in settings.js; each case starts from a reset.
const net = { fetchImpl: (...args) => net.current.fetchImpl(...args), current: null };
const panel = new TvLoginPanel({ getUser: () => currentUser, fetchImpl: net.fetchImpl });
panel.bind();

function start() {
    net.current = controlledFetch();
    panel.reset();
    return net.current;
}

function submitCode(code) {
    $('tvLoginCodeInput').value = code;
    $('tvLoginCodeForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
}

const found = { ok: true, status: 'found', deviceName: 'Телевизор TCL', requestedAt: Date.UTC(2026, 10, 27, 19, 20) };

// 1. The normal path: look up, show the device, confirm the code that was shown.
{
    const calls = start();
    assert.equal($('tvLoginCodeForm').hidden, false);
    assert.equal($('tvLoginSignedOut').hidden, true);
    submitCode('k7q-4md');
    await flush();
    assert.equal(calls.calls[0].body.userCode, 'K7Q4MD');
    assert.equal(calls.calls[0].body.confirm, false);
    assert.equal(calls.calls[0].auth, 'Bearer id-token');
    calls.answer(0, found);
    await flush();
    assert.equal($('tvLoginConfirmStep').hidden, false);
    assert.equal($('tvLoginCodeForm').hidden, true);
    assert.equal($('tvLoginDeviceName').textContent, 'Телевизор TCL');
    $('tvLoginConfirmBtn').click();
    await flush();
    assert.deepEqual(calls.calls[1].body, { userCode: 'K7Q4MD', confirm: true });
    calls.answer(1, { ok: true, status: 'approved' });
    await flush();
    assert.equal($('tvLoginDoneStep').hidden, false);
    $('tvLoginAgainBtn').click();
    assert.equal($('tvLoginCodeForm').hidden, false, '«Ввести другой код» returns to an empty code step');
    assert.equal($('tvLoginCodeInput').value, '');
}

// 2. «Отмена» before the lookup answered: the late answer shows nothing and arms no confirmation.
{
    const calls = start();
    submitCode('K7Q4MD');
    await flush();
    panel.reset();
    calls.answer(0, found);
    await flush();
    assert.equal($('tvLoginConfirmStep').hidden, true, 'the panel stays on the code step');
    assert.equal(panel.userCode, null, 'no code is armed for confirmation');
    assert.equal($('tvLoginFindBtn').disabled, false);
}

// 3. The user edits the code while the lookup runs: the old answer is dropped.
{
    const calls = start();
    submitCode('K7Q4MD');
    await flush();
    $('tvLoginCodeInput').value = 'ABCDEF';
    $('tvLoginCodeInput').dispatchEvent(new window.Event('input'));
    calls.answer(0, found);
    await flush();
    assert.equal($('tvLoginConfirmStep').hidden, true);
    submitCode('ABCDEF');
    await flush();
    assert.equal(calls.calls[1].body.userCode, 'ABCDEF');
    calls.answer(1, { ...found, deviceName: 'Второй телевизор' });
    await flush();
    assert.equal($('tvLoginDeviceName').textContent, 'Второй телевизор');
}

// 4. «Отмена» while the confirmation runs: a late answer does not move a step or show an error.
{
    const calls = start();
    submitCode('K7Q4MD');
    await flush();
    calls.answer(0, found);
    await flush();
    $('tvLoginConfirmBtn').click();
    await flush();
    $('tvLoginCancelBtn').click();
    calls.answer(1, { error: 'x', code: 'CODE_USED' }, 409);
    await flush();
    assert.equal($('tvLoginConfirmError').textContent, '', 'no error written after cancelling');
    assert.equal($('tvLoginCodeForm').hidden, false);
    assert.equal($('tvLoginDoneStep').hidden, true);
}

// 5. The same account announced again keeps the step; signing out drops it and hides the form.
{
    const calls = start();
    submitCode('K7Q4MD');
    await flush();
    calls.answer(0, found);
    await flush();
    panel.applyUser(user);
    assert.equal($('tvLoginConfirmStep').hidden, false, 'a repeated auth event keeps the confirmation');
    currentUser = null;
    panel.applyUser(null);
    assert.equal($('tvLoginSignedOut').hidden, false);
    assert.equal($('tvLoginConfirmStep').hidden, true);
    assert.equal($('tvLoginCodeForm').hidden, true, 'a guest gets no code form');
    assert.equal(panel.userCode, null);
    currentUser = user;
    panel.applyUser(user);
    assert.equal($('tvLoginCodeForm').hidden, false);
}

console.log('tvLoginPanel tests passed');
