const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

async function main() {
    const dom = new JSDOM('<!doctype html><body><button id="trigger">Удалить</button></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    window.eval(read('src/shared/components/ConfirmDialog.js'));
    const { document } = window;
    const dialogApi = window.ConfirmDialog;
    assert.ok(dialogApi, 'ConfirmDialog is exposed as a window global');

    const key = (target, keyName, extra = {}) => {
        const event = new window.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...extra });
        target.dispatchEvent(event);
        return event;
    };

    // 1. Confirm resolves true, renders text safely, and uses the danger variant.
    const trigger = document.getElementById('trigger');
    trigger.focus();
    const confirmed = dialogApi.confirm({ title: '<b>Удалить?</b>', message: 'Нельзя отменить', confirmLabel: 'Удалить', danger: true });
    const rootEl = dialogApi.getElement();
    assert.equal(rootEl.hidden, false, 'dialog opens');
    assert.equal(rootEl.getAttribute('role'), 'alertdialog');
    assert.equal(rootEl.getAttribute('aria-modal'), 'true');
    assert.equal(rootEl.querySelector('.confirm-dialog__title').textContent, '<b>Удалить?</b>', 'title is text, not HTML');
    assert.equal(rootEl.querySelector('b'), null, 'title markup is not parsed');
    const cancelButton = rootEl.querySelector('[data-confirm-dialog="cancel"]');
    const confirmButton = rootEl.querySelector('[data-confirm-dialog="confirm"]');
    assert.equal(document.activeElement, cancelButton, 'focus starts on Cancel');
    assert.ok(confirmButton.classList.contains('btn-danger'));
    confirmButton.click();
    assert.equal(await confirmed, true, 'confirm button resolves true');
    assert.equal(rootEl.hidden, true, 'dialog closes after confirming');

    // 2. Escape cancels and does not reach page-level listeners (Movie Details modal stack).
    let documentSawEscape = false;
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') documentSawEscape = true; });
    const escaped = dialogApi.confirm({ title: 'Escape?' });
    key(cancelButton, 'Escape');
    assert.equal(await escaped, false, 'Escape resolves false');
    assert.equal(documentSawEscape, false, 'Escape is not propagated to the page');

    // 3. Backdrop mousedown cancels; non-danger requests use the primary button.
    const backdrop = dialogApi.confirm({ title: 'Backdrop?' });
    assert.ok(confirmButton.classList.contains('btn-primary'));
    assert.ok(!confirmButton.classList.contains('btn-danger'));
    rootEl.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    assert.equal(await backdrop, false, 'backdrop click resolves false');

    // 4. Tab is trapped between the two buttons.
    const trapped = dialogApi.confirm({ title: 'Tab?' });
    confirmButton.focus();
    const tab = key(confirmButton, 'Tab');
    assert.equal(tab.defaultPrevented, true);
    assert.equal(document.activeElement, cancelButton, 'Tab from the last button wraps to the first');
    key(cancelButton, 'Tab', { shiftKey: true });
    assert.equal(document.activeElement, confirmButton, 'Shift+Tab from the first button wraps to the last');

    // 5. A newer request supersedes the open one.
    const newer = dialogApi.confirm({ title: 'Newer' });
    assert.equal(await trapped, false, 'superseded request resolves false');
    dialogApi.cancel();
    assert.equal(await newer, false, 'cancel() resolves false');
    assert.equal(document.querySelectorAll('.confirm-dialog-overlay').length, 1, 'dialog DOM is created once');

    // 6. No native confirm() remains in extension sources, and every caller page loads the component.
    const sourceFiles = [
        'src/pages/admin/admin.js', 'src/pages/bookmarks/bookmarks.js', 'src/pages/search/search.js',
        'src/pages/settings/settings.js', 'src/pages/watching/watching.js', 'src/pages/watchlist/watchlist.js',
        'src/popup/popup.js', 'src/pages/movie-details/movie-details.js'
    ];
    for (const file of sourceFiles) {
        const source = read(file);
        assert.doesNotMatch(source, /[^.\w]confirm\(/, `${file} must use ConfirmDialog instead of window.confirm()`);
        assert.match(source, /ConfirmDialog\.confirm\(/, `${file} uses ConfirmDialog`);
        const html = read(file.replace(/\.js$/, '.html'));
        assert.match(html, /<script[^>]+src="[^"]*shared\/components\/ConfirmDialog\.js"/, `${file.replace(/\.js$/, '.html')} loads ConfirmDialog.js`);
    }

    // 7. Styles live with the other modal primitives.
    const components = read('src/shared/styles/components.css');
    assert.match(components, /\.modal-overlay\.confirm-dialog-overlay\[hidden\]\s*\{\s*display:\s*none;/);
    assert.match(components, /\.confirm-dialog__footer\s*\{/);

    console.log('✅ ConfirmDialog tests passed');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
