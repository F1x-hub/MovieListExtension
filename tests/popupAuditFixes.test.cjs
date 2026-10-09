/**
 * Behavior regressions from the popup audit. The real PopupManager, HTML,
 * Utils and translations run in JSDOM; only platform/service boundaries are
 * mocked. This does not establish installed-extension or provider behavior.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const projectRoot = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
}

async function settle() {
    // Drain the real async handlers without using wall-clock sleeps.
    await new Promise(resolve => setImmediate(resolve));
}

function createClock(window) {
    let now = 1000;
    let nextId = 1;
    const tasks = new Map();
    window.setTimeout = (callback, delay = 0, ...args) => {
        const id = nextId++;
        tasks.set(id, { callback, args, at: now + Number(delay) });
        return id;
    };
    window.clearTimeout = id => tasks.delete(id);
    Object.defineProperty(window.performance, 'now', { value: () => now });
    return {
        tick(duration) {
            const end = now + duration;
            for (let count = 0; count < 1000; count++) {
                const due = [...tasks.entries()].filter(([, task]) => task.at <= end)
                    .sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) {
                    now = end;
                    return;
                }
                const [id, task] = due;
                tasks.delete(id);
                now = task.at;
                task.callback(...task.args);
            }
            throw new Error('Timer loop did not settle');
        }
    };
}

function createStorage() {
    const store = {};
    return {
        store,
        get(keys, callback) {
            const result = {};
            for (const key of Array.isArray(keys) ? keys : [keys]) result[key] = store[key];
            callback?.(result);
            return Promise.resolve(result);
        },
        set(values, callback) {
            Object.assign(store, values);
            callback?.();
            return Promise.resolve();
        },
        remove(keys, callback) {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
            callback?.();
            return Promise.resolve();
        }
    };
}

function rating(id, overrides = {}) {
    return {
        id: String(id), userId: 'viewer', userName: 'Viewer', userPhoto: '',
        movieId: Number(id), rating: 8, comment: '', createdAt: '2026-10-08T00:00:00Z',
        movie: { kinopoiskId: Number(id), name: `Film ${id}`, year: 2024, genres: ['Drama'], posterUrl: '' },
        ...overrides
    };
}

function page(ratings, overrides = {}) {
    return { ratings, lastDocId: ratings.at(-1)?.id || null, lastDoc: null, hasMore: false, isFromCache: false, ...overrides };
}

function createHarness({ locale = 'en', bindEvents = true } = {}) {
    const dom = new JSDOM(read('src/popup/popup.html'), {
        runScripts: 'outside-only', pretendToBeVisual: true,
        url: 'chrome-extension://popup-audit/src/popup/popup.html'
    });
    const { window } = dom;
    const { document } = window;
    const clock = createClock(window);
    const openedTabs = [];
    const errors = [];
    const writes = [];
    const resets = [];
    const state = { user: { uid: 'viewer', displayName: 'Viewer', email: 'viewer@example.test', photoURL: '' } };
    const userService = { getUserProfile: async () => ({ displayName: 'Viewer', approvalStatus: 'approved' }) };
    const cacheService = {
        getCachedRatingsWithBackgroundRefresh: async () => page([]),
        fetchAndCacheRatings: async () => page([]),
        refreshCacheInBackground: async () => {},
        getCachedAverageRatings: async () => new window.Map(),
        cacheAverageRatings: async () => {},
        getCacheStats: async () => ({ age: 0, isValid: true }),
        clearCache: async () => {}
    };
    const ratingService = {
        getBatchMovieAverageRatings: async () => ({}),
        addOrUpdateRating: async (...args) => { writes.push(args); },
        deleteRating: async () => {}
    };
    const kinopoiskService = { searchMovies: async () => ({ docs: [] }) };
    const movieCacheService = { searchCachedMovies: async () => [] };
    window.chrome = {
        runtime: {
            getURL: relativePath => `chrome-extension://popup-audit/${relativePath}`,
            sendMessage: (_message, callback) => { callback?.({ success: false }); return Promise.resolve({ success: false }); },
            onMessage: { addListener() {}, removeListener() {} }
        },
        storage: { local: createStorage(), sync: createStorage(), onChanged: { addListener() {} } },
        tabs: { create: options => { openedTabs.push(options); return Promise.resolve(options); } },
        i18n: { getUILanguage: () => locale }
    };
    window.firebaseManager = {
        getCurrentUser: () => state.user,
        getUserService: () => userService,
        getRatingService: () => ratingService,
        getRatingsCacheService: () => cacheService,
        getKinopoiskService: () => kinopoiskService,
        getMovieCacheService: () => movieCacheService,
        signOut: async () => { state.user = null; },
        sendPasswordResetEmail: async email => { resets.push(email); },
        auth: { sendPasswordResetEmail: async email => { resets.push(email); } }
    };
    window.AuthManager = { clearAuthData: async () => {}, getAuthData: async () => null };
    window.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    window.console = { log() {}, warn() {}, error() {}, debug() {}, table() {} };
    const context = dom.getInternalVMContext();
    const evaluate = (relativePath, source = read(relativePath)) => vm.runInContext(source, context, { filename: relativePath });
    evaluate('src/shared/utils/Utils.js');
    evaluate('src/shared/utils/Icons.js');
    evaluate('src/shared/utils/IconUtils.js');
    evaluate('src/shared/components/ConfirmDialog.js');
    evaluate('src/shared/i18n/locales.js', read('src/shared/i18n/locales.js').replace(/^export /gm, ''));
    evaluate('src/shared/i18n/I18n.js', read('src/shared/i18n/I18n.js').replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nwindow.i18n = i18n;');
    window.i18n.currentLocale = locale;
    const popupSource = read('src/popup/popup.js');
    const bootstrapIndex = popupSource.indexOf("document.addEventListener('DOMContentLoaded'");
    assert.ok(bootstrapIndex > 0, 'test must omit the page bootstrap, not application methods');
    evaluate('src/popup/popup.js', popupSource.slice(0, bootstrapIndex).replace(/^import .*$/gm, '') + '\nwindow.PopupManager = PopupManager;');
    window.PopupManager.prototype.start = async () => {};
    const manager = new window.PopupManager();
    manager.elements = manager.initializeElements();
    manager.elements.mainContent.style.display = 'flex';
    manager.elements.headerActionsGroup.style.display = 'flex';
    manager.showError = message => { errors.push(message); };
    // Animation timing and platform initialization are outside these regressions.
    manager.hideFeedContentWithFade = async () => {};
    manager.showFeedContentWithFade = async () => {};
    manager.showLoadingWithFade = async () => {};
    manager.hideLoadingWithFade = async () => {};
    if (bindEvents) manager.setupEventListeners();
    manager.updateAuthUI(true, state.user, false);
    return { dom, window, document, clock, manager, state, errors, writes, resets, openedTabs,
        userService, cacheService, ratingService, kinopoiskService, movieCacheService,
        dispose() { manager.dispose(); dom.window.close(); } };
}

function key(harness, target, name, options = {}) {
    const event = new harness.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
}

function submit(harness, form) {
    form.dispatchEvent(new harness.window.Event('submit', { bubbles: true, cancelable: true }));
}

const cases = [];
function test(name, run) { cases.push({ name, run }); }

test('popup and side panel sizing modes stay synchronized on the document and body', async h => {
    h.manager.initializeSurface();
    assert.equal(h.document.documentElement.classList.contains('popup-document--sidepanel'), false);
    assert.equal(h.document.body.classList.contains('popup-page--sidepanel'), false);

    h.dom.reconfigure({ url: 'http://localhost/popup.html?view=sidepanel' });
    h.manager.initializeSurface();
    assert.equal(h.document.documentElement.classList.contains('popup-document--sidepanel'), true);
    assert.equal(h.document.body.classList.contains('popup-page--sidepanel'), true);

    h.dom.reconfigure({ url: 'chrome-extension://popup-audit/src/popup/popup.html' });
    h.manager.initializeSurface();
    assert.equal(h.document.documentElement.classList.contains('popup-document--sidepanel'), false);
    assert.equal(h.document.body.classList.contains('popup-page--sidepanel'), false);
});

test('untrusted rating and search fields remain text; failed images use CSP-safe fallback listeners', async h => {
    const payload = '\"><button id="injected-control">Injected</button><img alt="';
    const item = rating(1, { userId: 'other', userName: payload, userPhoto: payload,
        movie: { kinopoiskId: 1, name: payload, year: payload, genres: [payload], posterUrl: payload } });
    const card = await h.manager.createRatingElementSync(item, new h.window.Map());
    h.manager.elements.feedContent.appendChild(card);
    assert.equal(h.document.getElementById('injected-control'), null, 'shared metadata must not create markup');
    assert.equal(card.querySelector('.rating-author-name').textContent, payload, 'author text is retained safely');
    assert.ok(card.querySelector('.rating-movie-title').textContent.includes(payload), 'movie title is retained safely');
    for (const image of card.querySelectorAll('img')) {
        assert.equal(image.hasAttribute('onerror'), false, 'MV3 cannot use an inline fallback handler');
        image.src = 'https://images.example.test/missing.jpg';
        image.dispatchEvent(new h.window.Event('error'));
        assert.ok(image.getAttribute('src').includes('/src/shared/assets/icons/app/'), 'error event applies a local fallback');
    }
    h.manager.elements.searchInput.value = 'Film';
    h.manager.displaySearchResults([{ kinopoiskId: 2, name: payload, year: payload, genres: [payload], posterUrl: payload }]);
    assert.equal(h.document.getElementById('injected-control'), null, 'search attributes must not create markup');
    const searchImage = h.manager.elements.searchResults.querySelector('img');
    assert.equal(searchImage.hasAttribute('onerror'), false);
    searchImage.src = 'https://images.example.test/missing.jpg';
    searchImage.dispatchEvent(new h.window.Event('error'));
    assert.ok(searchImage.getAttribute('src').includes('/src/shared/assets/icons/app/'));

    const unsafe = await h.manager.createRatingElementSync(rating(3, {
        userId: 'other', userPhoto: 'javascript:alert(1)',
        movie: { kinopoiskId: 3, name: 'Film', posterUrl: 'javascript:alert(1)' }
    }), new h.window.Map());
    assert.ok([...unsafe.querySelectorAll('img')].every(image => !/^javascript:/i.test(image.getAttribute('src') || '')), 'non-image schemes are rejected');
});

test('film, author, search result and rating menu support native keyboard activation', async h => {
    const card = await h.manager.createRatingElementSync(rating(4, {
        movie: { kinopoiskId: 4, name: 'Film', genres: [{ name: 'Drama' }, { name: 'Sci-Fi' }] }
    }), new h.window.Map());
    assert.equal(card.querySelector('.rating-genres-snippet').textContent, 'Drama, Sci-Fi', 'production renderer normalizes genre objects');
    h.manager.elements.feedContent.appendChild(card);
    const movieLink = card.querySelector('a[href*="movie-details.html"]');
    const authorLink = card.querySelector('a[href*="profile.html"]');
    assert.ok(movieLink && movieLink.href.includes('movieId=4'), 'film navigation is a native link');
    assert.ok(authorLink && authorLink.href.includes('userId=viewer'), 'author navigation is a native link');
    const button = card.querySelector('.rating-menu-btn');
    assert.equal(button.tagName, 'BUTTON');
    button.focus();
    // Browsers synthesize click for keyboard activation; JSDOM does not.
    button.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
    const menu = h.document.getElementById('popup-menu-4');
    assert.ok(!menu.hidden && menu.style.display !== 'none', 'keyboard-generated click opens the menu');
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    key(h, h.document.activeElement, 'Escape');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(h.document.activeElement, button, 'Escape returns menu focus to its trigger');
    h.manager.displaySearchResults([{ kinopoiskId: 5, name: 'Film', genres: [] }]);
    const result = h.manager.elements.searchResults.querySelector('.search-result-item');
    assert.equal(result.tagName, 'A');
    assert.ok(result.href.includes('movieId=5'));
});

test('closed account/search layers leave the tab order and restore their trigger focus', async h => {
    const { manager, document, clock } = h;
    assert.equal(manager.elements.avatarDropdown.hidden, true, 'closed account menu is hidden');
    assert.equal(manager.elements.searchLayer.hidden, true, 'closed search layer is hidden');
    manager.elements.userAvatarBtn.focus();
    manager.toggleAvatarDropdown();
    assert.equal(manager.elements.avatarDropdown.hidden, false);
    assert.equal(manager.elements.userAvatarBtn.getAttribute('aria-expanded'), 'true');
    manager.elements.profileMenuBtn.focus();
    key(h, manager.elements.profileMenuBtn, 'Escape');
    assert.equal(manager.elements.avatarDropdown.hidden, true);
    assert.equal(manager.elements.userAvatarBtn.getAttribute('aria-expanded'), 'false');
    assert.equal(document.activeElement, manager.elements.userAvatarBtn);

    manager.elements.searchToggleBtn.focus();
    manager.openSearchLayer();
    clock.tick(60);
    assert.equal(manager.elements.searchLayer.hidden, false);
    assert.equal(manager.elements.chipsLayer.hidden, true);
    assert.equal(document.activeElement, manager.elements.searchInput);
    key(h, manager.elements.searchInput, 'Escape');
    assert.equal(manager.elements.searchLayer.hidden, true);
    assert.equal(manager.elements.chipsLayer.hidden, false);
    assert.equal(document.activeElement, manager.elements.searchToggleBtn);
});

test('average score is available by keyboard and its tooltip escapes the clipped card', async h => {
    const card = await h.manager.createRatingElementSync(rating(24), new h.window.Map([
        [24, { average: 8.5, count: 2 }]
    ]));
    h.manager.elements.feedContent.appendChild(card);
    const score = card.querySelector('.rating-score-badge');
    assert.equal(score.tagName, 'BUTTON', 'score disclosure has native activation');
    score.focus();
    score.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
    const tooltip = h.document.getElementById('tooltip-24');
    assert.ok(tooltip);
    assert.equal(tooltip.closest('.rating-item'), null, 'tooltip is outside the clipped card');
    assert.equal(tooltip.hidden, false);
    assert.equal(score.getAttribute('aria-expanded'), 'true');
    assert.ok(tooltip.textContent.includes('8.5'));
    key(h, score, 'Escape');
    assert.equal(tooltip.hidden, true);
    assert.equal(score.getAttribute('aria-expanded'), 'false');
});

test('field errors expose validation and are cleared while typing', async h => {
    const { manager, window } = h;
    manager.elements.loginEmail.value = 'invalid-email';
    submit(h, manager.elements.loginEmailForm);
    assert.equal(manager.elements.loginEmail.getAttribute('aria-invalid'), 'true');
    assert.ok(manager.elements.loginEmail.getAttribute('aria-describedby')?.split(/\s+/).includes('loginEmailError'));
    assert.ok(manager.elements.loginEmailError.textContent);
    manager.elements.loginEmail.value = 'viewer@example.test';
    manager.elements.loginEmail.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.notEqual(manager.elements.loginEmail.getAttribute('aria-invalid'), 'true');
    assert.equal(manager.elements.loginEmailError.textContent, '');
});

test('rating dialog labels, focus containment, Escape and close activation work', async h => {
    const trigger = h.document.createElement('button');
    h.document.body.appendChild(trigger);
    trigger.focus();
    h.manager.showEditRatingModalPopup('6', rating(6, { comment: 'Draft' }));
    const form = h.document.getElementById('editRatingFormPopup');
    const dialog = form.closest('[role="dialog"]');
    assert.ok(dialog, 'edit form lives in a named dialog');
    assert.equal(h.document.getElementById('closeEditModalPopup').getAttribute('aria-label'), 'Close');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.ok(dialog.getAttribute('aria-labelledby') || dialog.getAttribute('aria-label'));
    assert.ok(dialog.contains(h.document.activeElement), 'focus enters the dialog');
    assert.ok(h.document.querySelector('label[for="editRatingSliderPopup"]'));
    assert.ok(h.document.querySelector('label[for="editRatingCommentPopup"]'));
    const controls = [...dialog.querySelectorAll('button, input, textarea, [tabindex]')]
        .filter(control => !control.disabled && control.tabIndex >= 0 && !control.hidden);
    const first = controls[0];
    const last = controls.at(-1);
    last.focus();
    assert.equal(key(h, last, 'Tab').defaultPrevented, true);
    assert.equal(h.document.activeElement, first, 'Tab wraps from the last control');
    assert.equal(key(h, first, 'Tab', { shiftKey: true }).defaultPrevented, true);
    assert.equal(h.document.activeElement, last, 'Shift+Tab wraps from the first control');
    key(h, last, 'Escape');
    assert.equal(h.document.getElementById('editRatingFormPopup'), null);
    assert.equal(h.document.activeElement, trigger);
    h.manager.showEditRatingModalPopup('6', rating(6));
    h.document.getElementById('closeEditModalPopup').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, detail: 0 }));
    assert.equal(h.document.getElementById('editRatingFormPopup'), null, 'keyboard-generated click closes the dialog');
});

test('successful rating write closes once, reports success and refreshes the feed', async h => {
    let refreshed = 0;
    h.manager.forceRefreshRatings = async () => { refreshed++; };
    h.manager.showEditRatingModalPopup('7', rating(7));
    h.document.getElementById('editRatingSliderPopup').value = '9';
    h.document.getElementById('editRatingCommentPopup').value = 'Edited review';
    submit(h, h.document.getElementById('editRatingFormPopup'));
    await settle();
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0][3], 7);
    assert.equal(h.writes[0][4], 9);
    assert.equal(h.writes[0][5], 'Edited review');
    assert.equal(h.document.getElementById('editRatingFormPopup'), null);
    assert.equal(refreshed, 1, 'notification handling must not prevent feed refresh');
    assert.equal(h.document.activeElement, h.manager.elements.refreshBtn, 'a replaced card leaves focus on an available feed control');
    assert.equal(h.errors.length, 0, 'a successful write must not surface a JavaScript error');
});

test('failed rating write retains the draft and duplicate submit is blocked', async h => {
    const write = deferred();
    let requests = 0;
    h.ratingService.addOrUpdateRating = async () => { requests++; return write.promise; };
    h.manager.showEditRatingModalPopup('8', rating(8));
    const form = h.document.getElementById('editRatingFormPopup');
    const comment = h.document.getElementById('editRatingCommentPopup');
    const save = h.document.getElementById('saveEditBtnPopup');
    comment.value = 'Keep this draft';
    submit(h, form);
    submit(h, form);
    await settle();
    assert.equal(requests, 1, 'in-flight write is not duplicated');
    assert.equal(save.disabled, true);
    write.reject(new Error('unavailable'));
    await settle();
    assert.equal(form.isConnected, true, 'error leaves the editor open');
    assert.equal(comment.value, 'Keep this draft');
    assert.equal(save.disabled, false, 'retry becomes available after the error');
    assert.ok(form.closest('[role="dialog"]').querySelector('[role="alert"]')?.textContent, 'write error is announced inside the dialog');
});

test('password recovery calls the Firebase-compatible reset API and prevents duplicate sends', async h => {
    const reset = deferred();
    h.window.firebaseManager.sendPasswordResetEmail = async email => { h.resets.push(email); return reset.promise; };
    h.state.user = null;
    h.manager.updateAuthUI(false, null, true);
    h.manager.elements.loginEmail.value = 'viewer@example.test';
    h.manager.elements.staticEmail.value = 'viewer@example.test';
    const control = h.document.querySelector('.forgot-password-link');
    assert.equal(control.tagName, 'BUTTON', 'recovery is an action, not a dead hash link');
    control.click();
    const form = h.document.getElementById('passwordResetFormPopup');
    const input = h.document.getElementById('passwordResetEmailPopup');
    const send = h.document.getElementById('passwordResetSubmitPopup');
    assert.ok(form?.closest('[role="dialog"]'), 'recovery opens a named dialog');
    assert.equal(input.value, 'viewer@example.test', 'current login email is prefilled');
    assert.ok(h.document.querySelector('label[for="passwordResetEmailPopup"]'));
    submit(h, form);
    submit(h, form);
    await settle();
    assert.deepEqual(h.resets, ['viewer@example.test']);
    assert.equal(send.disabled, true);
    reset.resolve();
    await settle();
    assert.equal(send.disabled, false);
    const status = h.document.getElementById('passwordResetStatusPopup');
    assert.ok(status?.textContent, 'recovery result is visible and available to assistive technology');
    assert.ok(status.getAttribute('role') || status.getAttribute('aria-live'));
});

test('password labels and tooltips follow the locale and current reveal state', async h => {
    h.window.i18n.currentLocale = 'ru';
    h.window.i18n.translatePage();
    h.manager.syncAccessibleLabels();
    const toggle = h.document.querySelector('.toggle-password');
    assert.equal(toggle.getAttribute('aria-label'), 'Показать пароль');
    assert.equal(toggle.title, 'Показать пароль');
    toggle.click();
    assert.equal(toggle.getAttribute('aria-label'), 'Скрыть пароль');
    assert.equal(toggle.title, 'Скрыть пароль');
    assert.equal(h.manager.elements.loginPassword.type, 'text');
    assert.equal(h.manager.elements.refreshBtn.title, 'Обновить');
});

test('password reset validates inline and retains a retryable email after provider failure', async h => {
    h.manager.showPasswordResetDialog();
    const form = h.document.getElementById('passwordResetFormPopup');
    const input = h.document.getElementById('passwordResetEmailPopup');
    const send = h.document.getElementById('passwordResetSubmitPopup');
    const status = h.document.getElementById('passwordResetStatusPopup');
    input.value = 'bad-email';
    submit(h, form);
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(status.getAttribute('role'), 'alert');
    assert.equal(h.resets.length, 0);
    input.value = 'retry@example.test';
    input.dispatchEvent(new h.window.Event('input', { bubbles: true }));
    h.window.firebaseManager.sendPasswordResetEmail = async () => { throw new Error('unavailable'); };
    submit(h, form);
    await settle();
    assert.equal(form.isConnected, true);
    assert.equal(input.value, 'retry@example.test');
    assert.equal(send.disabled, false);
    assert.equal(status.hidden, false);
    assert.equal(status.getAttribute('role'), 'alert');
    assert.ok(!status.textContent.includes('unavailable'), 'raw provider failure is not user-facing copy');
});

test('password reset does not disclose whether an email account exists', async h => {
    h.window.firebaseManager.sendPasswordResetEmail = async () => {
        throw Object.assign(new Error('user missing'), { code: 'auth/user-not-found' });
    };
    h.manager.showPasswordResetDialog();
    h.document.getElementById('passwordResetEmailPopup').value = 'unknown@example.test';
    submit(h, h.document.getElementById('passwordResetFormPopup'));
    await settle();
    const status = h.document.getElementById('passwordResetStatusPopup');
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.textContent, h.window.i18n.get('popup.password_reset.success'));
    assert.equal(h.document.getElementById('passwordResetSubmitPopup').disabled, false);
});

test('clearing search cancels pending debounce and late provider responses', async h => {
    let calls = 0;
    h.kinopoiskService.searchMovies = async () => { calls++; return { docs: [{ id: 9, name: 'Old result' }] }; };
    h.manager.openSearchLayer();
    h.manager.elements.searchInput.value = 'Old';
    await h.manager.handleSearch({ target: h.manager.elements.searchInput });
    h.manager.elements.searchInput.value = '';
    await h.manager.handleSearch({ target: h.manager.elements.searchInput });
    h.clock.tick(350);
    await settle();
    assert.equal(calls, 0, 'clearing before debounce must cancel its provider request');
    assert.equal(h.manager.elements.searchResults.style.display, 'none');

    const pending = deferred();
    h.kinopoiskService.searchMovies = () => pending.promise;
    h.manager.elements.searchInput.value = 'Old';
    await h.manager.handleSearch({ target: h.manager.elements.searchInput });
    h.clock.tick(350);
    h.manager.elements.searchInput.value = '';
    await h.manager.handleSearch({ target: h.manager.elements.searchInput });
    pending.resolve({ docs: [{ id: 9, name: 'Old result' }] });
    await settle();
    assert.equal(h.manager.elements.searchResults.style.display, 'none', 'late response cannot reopen cleared search');
    assert.equal(h.manager.elements.searchResults.querySelector('[data-movie-id="9"]'), null);
});

test('out-of-order search and fallback responses cannot replace the current query', async h => {
    const oldQuery = deferred();
    const newQuery = deferred();
    h.kinopoiskService.searchMovies = query => query === 'Old' ? oldQuery.promise : newQuery.promise;
    h.manager.openSearchLayer();
    h.manager.elements.searchInput.value = 'Old';
    await h.manager.handleSearch({ target: h.manager.elements.searchInput });
    h.clock.tick(350);
    h.manager.elements.searchInput.value = 'New';
    await h.manager.handleSearch({ target: h.manager.elements.searchInput });
    h.clock.tick(350);
    newQuery.resolve({ docs: [{ id: 11, name: 'New result' }] });
    await settle();
    oldQuery.resolve({ docs: [{ id: 10, name: 'Old result' }] });
    await settle();
    assert.ok(h.manager.elements.searchResults.querySelector('[data-movie-id="11"]'));
    assert.equal(h.manager.elements.searchResults.querySelector('[data-movie-id="10"]'), null);

    const staleFallback = deferred();
    h.kinopoiskService.searchMovies = async () => ({ docs: [] });
    h.movieCacheService.searchCachedMovies = () => staleFallback.promise;
    h.manager.elements.searchInput.value = 'Cached';
    await h.manager.handleSearch({ target: h.manager.elements.searchInput });
    h.clock.tick(350);
    await settle();
    h.manager.closeSearchLayer();
    staleFallback.resolve([{ kinopoiskId: 12, name: 'Cached result' }]);
    await settle();
    assert.equal(h.manager.elements.searchResults.style.display, 'none', 'closed search rejects its late fallback');
});

test('switching the filter during initial load fetches and retains the newest feed', async h => {
    const all = deferred();
    const mine = deferred();
    const filters = [];
    h.cacheService.getCachedRatingsWithBackgroundRefresh = (_limit, _cursor, userId) => {
        filters.push(userId);
        return userId === 'viewer' ? mine.promise : all.promise;
    };
    const oldLoad = h.manager.loadRatings();
    await settle();
    const newLoad = h.manager.setFilter('my');
    await settle();
    assert.deepEqual(filters, [null, 'viewer'], 'new filter is not skipped by an older in-flight request');
    mine.resolve(page([rating(14)], { lastDocId: 'mine-cursor' }));
    await newLoad;
    all.resolve(page([rating(13)], { lastDocId: 'all-cursor', hasMore: true }));
    await oldLoad;
    assert.deepEqual(Array.from(h.manager.ratings, item => item.id), ['14']);
    assert.equal(h.manager.lastDocId, 'mine-cursor');
    assert.equal(h.manager.hasMore, false);
    assert.ok(h.document.getElementById('rating-14'));
    assert.equal(h.document.getElementById('rating-13'), null);
    assert.equal(h.manager.elements.filterMyRatings.getAttribute('aria-pressed'), 'true');
    assert.equal(h.manager.elements.filterAllRatings.getAttribute('aria-pressed'), 'false');
});

test('pagination from a previous filter cannot append to or change the new feed', async h => {
    h.manager.ratings = [rating(15)];
    h.manager.ratingsLoaded = true;
    h.manager.lastDocId = 'old-page';
    h.manager.hasMore = true;
    const oldPage = deferred();
    h.cacheService.fetchAndCacheRatings = () => oldPage.promise;
    h.cacheService.getCachedRatingsWithBackgroundRefresh = async () => page([rating(16)], { lastDocId: 'new-page' });
    const pagination = h.manager.loadMoreRatings();
    await settle();
    await h.manager.setFilter('my');
    oldPage.resolve(page([rating(17)], { lastDocId: 'stale-page', hasMore: true }));
    await pagination;
    assert.deepEqual(Array.from(h.manager.ratings, item => item.id), ['16']);
    assert.equal(h.manager.lastDocId, 'new-page');
    assert.equal(h.manager.hasMore, false);
    assert.equal(h.document.getElementById('rating-17'), null);
});

test('old asynchronous card enrichment cannot render into a newer filter', async h => {
    const oldAverage = deferred();
    h.cacheService.getCachedRatingsWithBackgroundRefresh = async (_limit, _cursor, userId) =>
        page([rating(userId === 'viewer' ? 23 : 22)]);
    h.ratingService.getBatchMovieAverageRatings = movieIds => movieIds.includes(22)
        ? oldAverage.promise : Promise.resolve({ 23: { average: 8, count: 1 } });
    const oldLoad = h.manager.loadRatings();
    await settle();
    await h.manager.setFilter('my');
    oldAverage.resolve({ 22: { average: 9, count: 2 } });
    await oldLoad;
    assert.deepEqual(Array.from(h.manager.ratings, item => item.id), ['23']);
    assert.ok(h.document.getElementById('rating-23'));
    assert.equal(h.document.getElementById('rating-22'), null, 'render generation protects writes after enrichment awaits');
});

test('refresh replaces a feed without accepting its older in-flight pagination', async h => {
    h.manager.ratings = [rating(18)];
    h.manager.ratingsLoaded = true;
    h.manager.lastDocId = 'old-cursor';
    h.manager.hasMore = true;
    const paginationResult = deferred();
    h.cacheService.fetchAndCacheRatings = (_limit, cursor) => cursor ? paginationResult.promise : Promise.resolve(page([rating(19)], { lastDocId: 'fresh-cursor' }));
    const pagination = h.manager.loadMoreRatings();
    await settle();
    await h.manager.forceRefreshRatings();
    paginationResult.resolve(page([rating(20)], { lastDocId: 'stale-cursor', hasMore: true }));
    await pagination;
    assert.deepEqual(Array.from(h.manager.ratings, item => item.id), ['19']);
    assert.equal(h.manager.lastDocId, 'fresh-cursor');
    assert.equal(h.document.getElementById('rating-20'), null);
});

test('cold feed failures remain distinct from a genuine empty feed and offer retry', async h => {
    h.cacheService.getCachedRatingsWithBackgroundRefresh = async () => { throw new Error('unavailable'); };
    await h.manager.loadRatings();
    assert.equal(h.manager.elements.feedContent.querySelector('.empty-state'), null, 'outage must not masquerade as no ratings');
    assert.ok(h.manager.elements.feedContent.querySelector('button'), 'failed initial read offers a retry action');
    h.cacheService.getCachedRatingsWithBackgroundRefresh = async () => page([]);
    await h.manager.loadRatings();
    assert.ok(h.manager.elements.feedContent.querySelector('.empty-state'));
    assert.ok(h.manager.elements.feedContent.querySelector('a[href*="search.html"]'), 'genuine empty feed offers movie discovery');
});

test('superseded first-page data is discarded and leaves a usable retry action', async h => {
    h.cacheService.getCachedRatingsWithBackgroundRefresh = async () => page([rating(99)], { isSuperseded: true });
    await h.manager.loadRatings();
    assert.equal(h.manager.ratings.length, 0);
    assert.equal(h.document.getElementById('rating-99'), null);
    assert.ok(h.manager.elements.feedContent.querySelector('.feed-state-retry'));
    assert.equal(h.manager.isLoadingRatings, false);
});

test('switching accounts closes session surfaces and rejects a late search response', async h => {
    const search = deferred();
    h.kinopoiskService.searchMovies = () => search.promise;
    h.manager.openSearchLayer();
    h.manager.elements.searchInput.value = 'Old';
    h.manager.handleSearch({ target: h.manager.elements.searchInput });
    h.clock.tick(350);
    h.manager.showEditRatingModalPopup('4', rating(4));
    h.state.user = { uid: 'next-viewer', displayName: 'Next' };
    h.manager.updateAuthUI(true, h.state.user, false);
    search.resolve({ docs: [{ id: 99, name: 'Old' }] });
    await settle();
    assert.equal(h.document.querySelector('.popup-dialog'), null);
    assert.equal(h.manager.elements.searchLayer.hidden, true);
    assert.equal(h.manager.elements.searchResults.style.display, 'none');
    assert.equal(h.document.querySelector('[data-movie-id="99"]'), null);
    assert.equal(h.manager.activeUserId, 'next-viewer');
});

test('a new account hides the previous session while its approval is still pending', async h => {
    const oldRead = deferred();
    const approval = deferred();
    let reads = 0;
    h.cacheService.getCachedRatingsWithBackgroundRefresh = () => ++reads === 1
        ? oldRead.promise : Promise.resolve(page([rating(101, { userId: 'next-viewer' })]));
    h.userService.getUserProfile = uid => uid === 'next-viewer' ? approval.promise : Promise.resolve({ displayName: 'Viewer' });
    h.manager.setupAuthStateListener();
    const previousLoad = h.manager.loadRatings();
    h.state.user = { uid: 'next-viewer', displayName: 'Next' };
    h.window.dispatchEvent(new h.window.CustomEvent('authStateChanged', {
        detail: { user: h.state.user, isAuthenticated: true }
    }));
    assert.equal(h.manager.elements.mainContent.style.display, 'none');
    oldRead.resolve(page([rating(100)]));
    await previousLoad;
    assert.equal(h.document.getElementById('rating-100'), null);
    assert.equal(h.manager.elements.mainContent.style.display, 'none');
    approval.resolve({ approvalStatus: 'approved', displayName: 'Next' });
    await settle();
    assert.equal(h.manager.activeUserId, 'next-viewer');
    assert.ok(h.document.getElementById('rating-101'));
});

test('a late background cache refresh cannot replace a different filter', async h => {
    const background = deferred();
    h.cacheService.getCachedRatingsWithBackgroundRefresh = async (_limit, _cursor, userId) => userId
        ? page([rating(26)])
        : page([rating(25)], { isFromCache: true, refreshPromise: background.promise });
    await h.manager.loadRatings();
    assert.ok(h.document.getElementById('rating-25'));
    await h.manager.setFilter('my');
    background.resolve(page([rating(27)], { hasMore: true }));
    await settle();
    assert.deepEqual(Array.from(h.manager.ratings, item => item.id), ['26']);
    assert.equal(h.document.getElementById('rating-27'), null);
    assert.equal(h.manager.hasMore, false);
});

test('background refresh updates the current first page but preserves subsequent pagination', async h => {
    const currentRefresh = deferred();
    h.cacheService.getCachedRatingsWithBackgroundRefresh = async () =>
        page([rating(28)], { isFromCache: true, refreshPromise: currentRefresh.promise });
    await h.manager.loadRatings();
    currentRefresh.resolve(page([rating(29)]));
    await settle();
    assert.deepEqual(Array.from(h.manager.ratings, item => item.id), ['29'], 'settled first page receives its fresh background result');

    const pendingRefresh = deferred();
    h.cacheService.getCachedRatingsWithBackgroundRefresh = async () =>
        page([rating(30)], { isFromCache: true, hasMore: true, refreshPromise: pendingRefresh.promise });
    h.cacheService.fetchAndCacheRatings = async () => page([rating(31)], { lastDocId: 'paged-cursor' });
    await h.manager.loadRatings();
    await h.manager.loadMoreRatings();
    pendingRefresh.resolve(page([rating(32)], { hasMore: true, lastDocId: 'background-cursor' }));
    await settle();
    assert.deepEqual(Array.from(h.manager.ratings, item => item.id), ['30', '31'], 'late first-page refresh must not truncate appended cards');
    assert.equal(h.manager.lastDocId, 'paged-cursor');
    assert.equal(h.manager.hasMore, false);
    assert.equal(h.document.getElementById('rating-32'), null);
});

test('late authenticated feed cannot reopen the popup after logout', async h => {
    const load = deferred();
    h.cacheService.getCachedRatingsWithBackgroundRefresh = () => load.promise;
    h.manager.setupAuthStateListener();
    const oldLoad = h.manager.loadRatings();
    await settle();
    h.state.user = null;
    h.window.dispatchEvent(new h.window.CustomEvent('authStateChanged', { detail: { user: null, isAuthenticated: false } }));
    await settle();
    load.resolve(page([rating(21)]));
    await oldLoad;
    assert.equal(h.manager.elements.mainContent.style.display, 'none');
    assert.notEqual(h.manager.elements.authSection.style.display, 'none');
    assert.equal(h.document.getElementById('rating-21'), null);
    assert.equal(h.manager.ratings.length, 0);
});

test('late approval of a previous sign-in cannot reopen content after a sign-out event', async h => {
    const approval = deferred();
    h.userService.getUserProfile = () => approval.promise;
    let loads = 0;
    h.manager.loadRatings = async () => { loads++; };
    h.manager.setupAuthStateListener();
    h.window.dispatchEvent(new h.window.CustomEvent('authStateChanged', {
        detail: { user: h.state.user, isAuthenticated: true }
    }));
    await settle();
    h.state.user = null;
    h.window.dispatchEvent(new h.window.CustomEvent('authStateChanged', {
        detail: { user: null, isAuthenticated: false }
    }));
    approval.resolve({ approvalStatus: 'approved' });
    await settle();
    assert.equal(loads, 0);
    assert.equal(h.manager.elements.mainContent.style.display, 'none');
    assert.equal(h.manager.elements.headerActionsGroup.style.display, 'none');
});

test('failed approval lookup leaves content blocked while approved and legacy profiles remain usable', async h => {
    let options;
    h.userService.getUserProfile = async (_userId, requestOptions) => { options = requestOptions; throw new Error('unavailable'); };
    const approved = await h.manager.validateUserApproval('viewer');
    assert.equal(approved, false, 'network failure must not grant UI approval');
    assert.equal(options?.throwOnError, true, 'the lookup must distinguish outages from absent profiles');
    assert.equal(h.manager.elements.mainContent.style.display, 'none');
    h.userService.getUserProfile = async () => ({ approvalStatus: 'approved' });
    assert.equal(await h.manager.validateUserApproval('viewer'), true);
    h.userService.getUserProfile = async () => ({ displayName: 'Legacy profile' });
    assert.equal(await h.manager.validateUserApproval('viewer'), true, 'supported legacy profiles remain usable');
});

async function main() {
    let failed = 0;
    for (const { name, run } of cases) {
        const harness = createHarness();
        try {
            await run(harness);
            console.log(`PASS ${name}`);
        } catch (error) {
            failed++;
            console.error(`FAIL ${name}`);
            console.error(error);
        } finally {
            harness.dispose();
        }
    }
    assert.equal(failed, 0, `${failed} popup audit regression(s) failed`);
    console.log(`Popup audit behavior regressions passed (${cases.length} scenarios).`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
