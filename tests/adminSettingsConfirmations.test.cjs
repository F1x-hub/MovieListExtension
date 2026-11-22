// Admin and Settings confirmations go through the shared ConfirmDialog: the texts
// stay the page's own, Cancel/Escape abort, and the action only runs after Confirm.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const adminHtml = read('src/pages/admin/admin.html');
const adminJs = read('src/pages/admin/admin.js');
const adminCss = read('src/shared/styles/admin.css');
const settingsJs = read('src/pages/settings/settings.js');

function createWindow() {
    const dom = new JSDOM('<!doctype html><body><button id="trigger" class="btn-delete">Удалить</button><button id="bulkDeleteBtn">Удалить</button></body>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    dom.window.eval(read('src/shared/components/ConfirmDialog.js'));
    return dom.window;
}

function dialogParts(window) {
    const element = window.ConfirmDialog.getElement();
    return {
        element,
        title: element.querySelector('.confirm-dialog__title').textContent,
        message: element.querySelector('.confirm-dialog__message').textContent,
        confirm: element.querySelector('[data-confirm-dialog="confirm"]'),
        cancel: element.querySelector('[data-confirm-dialog="cancel"]')
    };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function createAdminPanel(window) {
    window.eval(read('src/shared/utils/Utils.js'));
    // Only the class: the page bootstrap would start Firebase and navigation.
    const classSource = adminJs.slice(0, adminJs.lastIndexOf('// Initialize when DOM is loaded'));
    window.eval(`${classSource}\nwindow.__AdminPanelManager = AdminPanelManager;`);
    const panel = Object.create(window.__AdminPanelManager.prototype);
    Object.assign(panel, {
        currentUser: { uid: 'admin-1' },
        userToDelete: null,
        bulkDeleteInFlight: false,
        providerKeyActionRequest: false,
        errors: [],
        successes: [],
        showError(message) { this.errors.push(message); },
        showSuccessMessage(message) { this.successes.push(message); },
        loadUsers: async () => {},
        updateSelectionUI() {}
    });
    return panel;
}

async function testAdminUserDelete() {
    const window = createWindow();
    const panel = createAdminPanel(window);
    const button = window.document.getElementById('trigger');
    const deletion = deferred();
    const deleted = [];
    panel.adminService = {
        getUserDeletionPreview: async () => ({
            user: { displayName: 'Анна <b>', email: 'anna@example.test' },
            ratingsCount: 3,
            collectionCount: 1
        }),
        deleteUser: (id, adminId) => { deleted.push([id, adminId]); return deletion.promise; }
    };

    // Cancel keeps the user.
    const cancelled = panel.showDeleteConfirmation({ id: 'u1', displayName: 'Анна' }, button);
    await tick();
    let dialog = dialogParts(window);
    assert.equal(dialog.element.hidden, false, 'user deletion opens the shared dialog');
    assert.equal(dialog.title, 'Удалить пользователя?');
    assert.match(dialog.message, /Имя: Анна <b>/, 'user name is shown as text');
    assert.match(dialog.message, /Email: anna@example\.test/);
    assert.match(dialog.message, /• 3 оценки/);
    assert.match(dialog.message, /• 1 элемент коллекции/);
    assert.match(dialog.message, /Действие необратимо/);
    assert.equal(dialog.confirm.textContent, 'Удалить пользователя');
    assert.ok(dialog.confirm.classList.contains('btn-danger'), 'user deletion is a danger confirmation');
    dialog.cancel.click();
    await cancelled;
    assert.equal(deleted.length, 0, 'Cancel must not delete the user');
    assert.equal(panel.userToDelete, null);

    // Confirm runs the deletion with a busy row button.
    const confirmed = panel.showDeleteConfirmation({ id: 'u1', displayName: 'Анна' }, button);
    await tick();
    dialog = dialogParts(window);
    dialog.confirm.click();
    await tick();
    assert.deepEqual(deleted, [['u1', 'admin-1']]);
    assert.equal(button.disabled, true, 'the row button is busy while the deletion runs');
    assert.equal(button.textContent, 'Удаление...');
    // A second click while the deletion runs is ignored.
    await panel.showDeleteConfirmation({ id: 'u1', displayName: 'Анна' }, button);
    assert.equal(window.ConfirmDialog.isOpen(), false, 'no second dialog while a deletion runs');
    deletion.resolve();
    await confirmed;
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Удалить');
    assert.deepEqual(panel.successes, ['Пользователь «Анна» удалён']);
    assert.deepEqual(panel.errors, []);

    // A failed deletion reports the page error and frees the button.
    panel.adminService.deleteUser = async () => { throw new Error('denied'); };
    const failing = panel.showDeleteConfirmation({ id: 'u2', displayName: 'Борис' }, button);
    await tick();
    dialogParts(window).confirm.click();
    await failing;
    assert.deepEqual(panel.errors, ['Не удалось удалить пользователя. Повторите попытку.']);
    assert.equal(button.disabled, false);
}

async function testAdminBulkDelete() {
    const window = createWindow();
    const panel = createAdminPanel(window);
    const calls = [];
    Object.assign(panel, {
        selectedMovies: new Set([101, 102]),
        movies: [{ kinopoiskId: 101 }, { kinopoiskId: 102 }, { kinopoiskId: 103 }],
        ratingsMap: new Map([[101, []], [102, []]]),
        cacheService: {
            checkWriteAccess: () => ({ canWrite: true }),
            removeMoviesFromCache: (ids) => calls.push(['cache', ids])
        },
        adminService: {
            bulkDeleteMoviesAndRatings: async (ids) => { calls.push(['delete', ids]); return { moviesDeleted: 2, ratingsDeleted: 5 }; }
        },
        applyMoviesFilters() {}
    });

    const escaped = panel.showBulkDeleteConfirmation();
    await tick();
    let dialog = dialogParts(window);
    assert.equal(dialog.title, 'Подтверждение удаления');
    assert.match(dialog.message, /^Вы собираетесь удалить выбранные фильмы и их оценки:\n2 фильмов/);
    assert.match(dialog.message, /Это действие необратимо\./);
    assert.equal(dialog.confirm.textContent, 'Удалить');
    dialog.element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await escaped;
    assert.equal(calls.length, 0, 'Escape must not delete');

    const confirmed = panel.showBulkDeleteConfirmation();
    await tick();
    dialog = dialogParts(window);
    dialog.confirm.click();
    await confirmed;
    assert.equal(JSON.stringify(calls), JSON.stringify([['delete', [101, 102]], ['cache', [101, 102]]]));
    assert.equal(JSON.stringify(panel.movies), JSON.stringify([{ kinopoiskId: 103 }]));
    assert.equal(panel.selectedMovies.size, 0);
    assert.deepEqual(panel.successes, ['Удалено 2 фильмов и 5 оценок']);
}

async function testAdminProviderKeyRevoke() {
    const window = createWindow();
    const panel = createAdminPanel(window);
    const revoked = [];
    window.document.body.insertAdjacentHTML('beforeend', '<button data-provider-key-action="revoke" data-provider-key-id="key-1">Отозвать</button>');
    Object.assign(panel, {
        providerKeys: [{ id: 'key-1', label: 'Основной', provider: 'kinopoisk', maskedValue: '••••alue' }],
        adminService: { revokeProviderKey: async (id) => { revoked.push(id); } },
        loadProviderKeys: async () => {},
        renderProviderKeysError() {}
    });

    const cancelled = panel.handleProviderKeyAction('revoke', 'key-1');
    await tick();
    let dialog = dialogParts(window);
    assert.equal(dialog.title, 'Отозвать ключ?');
    assert.equal(dialog.message, 'Ключ «Основной» (kinopoisk, ••••alue) будет отключён и удалён из Secret Manager. Это действие нельзя отменить.');
    assert.equal(dialog.confirm.textContent, 'Отозвать ключ');
    assert.ok(dialog.confirm.classList.contains('btn-danger'));
    dialog.cancel.click();
    await cancelled;
    assert.deepEqual(revoked, []);
    assert.equal(panel.providerKeyActionRequest, false);

    const confirmed = panel.handleProviderKeyAction('revoke', 'key-1');
    await tick();
    dialogParts(window).confirm.click();
    await confirmed;
    assert.deepEqual(revoked, ['key-1']);
    assert.deepEqual(panel.successes, ['API-ключ отозван']);
}

function extractFunction(source, name) {
    const start = source.indexOf(`    function ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    const end = source.indexOf('\n    }\n', start);
    return source.slice(start, end + '\n    }\n'.length);
}

async function testSettingsDialogs() {
    const window = createWindow();
    const strings = {
        'settings.updates.playback_warning_title': 'Сейчас идёт воспроизведение',
        'settings.updates.playback_warning': 'Обновление до версии {version} может прервать просмотр.',
        'settings.updates.playback_confirm_button': 'Да, обновить',
        'settings.updates.playback_decline_button': 'Нет, подождать'
    };
    window.i18n = { get: (key) => strings[key] || key };
    const source = settingsJs.replace(/\r\n/g, '\n');
    window.eval(`window.__settingsDialogs = (() => {
${extractFunction(source, 'showJackettDeleteDialog')}
${extractFunction(source, 'showPlaybackUpdateDialog')}
return { showJackettDeleteDialog, showPlaybackUpdateDialog };
})();`);
    const { showJackettDeleteDialog, showPlaybackUpdateDialog } = window.__settingsDialogs;

    const jackett = showJackettDeleteDialog({ name: 'RuTracker' });
    let dialog = dialogParts(window);
    assert.equal(dialog.title, 'Удалить RuTracker?');
    assert.equal(dialog.message, 'Jackett удалит индексер из настроенных источников. Скачанные файлы MediaPlayer не затрагиваются.');
    assert.equal(dialog.confirm.textContent, 'Удалить');
    assert.ok(dialog.confirm.classList.contains('btn-danger'));
    dialog.confirm.click();
    assert.equal(await jackett, true);

    const playback = showPlaybackUpdateDialog('1.6.0');
    dialog = dialogParts(window);
    assert.equal(dialog.title, 'Сейчас идёт воспроизведение');
    assert.equal(dialog.message, 'Обновление до версии 1.6.0 может прервать просмотр.');
    assert.equal(dialog.confirm.textContent, 'Да, обновить');
    assert.equal(dialog.cancel.textContent, 'Нет, подождать');
    assert.ok(dialog.confirm.classList.contains('btn-primary'), 'the update prompt is not a danger action');
    dialog.element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(await playback, false, 'Escape declines the update');
}

function testMarkupContract() {
    for (const removedId of ['deleteModal', 'deleteRatingModal', 'bulkDeleteModal', 'providerKeyConfirmModal']) {
        assert.doesNotMatch(adminHtml, new RegExp(`id="${removedId}"`), `admin.html must not keep its own #${removedId}`);
    }
    assert.match(adminHtml, /<script[^>]+src="[^"]*shared\/components\/ConfirmDialog\.js"/, 'admin.html loads ConfirmDialog.js');
    assert.doesNotMatch(adminJs, /hideDeleteModal|hideBulkDeleteModal|openProviderKeyConfirm|showDeleteRatingConfirmation/,
        'admin.js must not keep the removed dialog code');
    assert.doesNotMatch(adminCss, /\.delete-modal|\.deletion-stats|\.bulk-delete-preview|\.rating-preview/,
        'admin.css must not keep styles of the removed dialogs');
    assert.doesNotMatch(settingsJs, /jackett-delete-dialog-overlay|update-playback-dialog-overlay/,
        'Settings must not build its own yes/no overlays');
    // The unsaved-changes prompt is a two-way choice without a "stay" answer, and
    // the Jackett add and config dialogs are forms: they stay page-owned.
    assert.match(settingsJs, /function showUnsavedDialog\(/);
    assert.match(settingsJs, /function showJackettIndexerAddDialog\(/);
    assert.match(settingsJs, /function showJackettIndexerConfigDialog\(/);
}

(async () => {
    testMarkupContract();
    await testAdminUserDelete();
    await testAdminBulkDelete();
    await testAdminProviderKeyRevoke();
    await testSettingsDialogs();
    console.log('adminSettingsConfirmations.test.cjs: all tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
