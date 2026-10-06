const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

const pageSource = read('src/pages/profile/profile.js');
const pageHtml = read('src/pages/profile/profile.html');
const Utils = require('../src/shared/utils/Utils.js');

// --- Minimal DOM stand-ins -------------------------------------------------
class FakeClassList {
    constructor(names = []) { this.names = new Set(names); }
    add(name) { this.names.add(name); }
    remove(name) { this.names.delete(name); }
    contains(name) { return this.names.has(name); }
    toggle(name, force) {
        const on = force === undefined ? !this.names.has(name) : Boolean(force);
        if (on) this.names.add(name); else this.names.delete(name);
        return on;
    }
    replace(from, to) {
        if (!this.names.has(from)) return false;
        this.names.delete(from);
        this.names.add(to);
        return true;
    }
}

class FakeElement {
    constructor(attributes = {}, classNames = []) {
        this.attributes = { ...attributes };
        this.classList = new FakeClassList(classNames);
        this.dataset = {};
        this.style = {};
        this.textContent = '';
        this.focused = false;
        this.isConnected = true;
    }
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    removeAttribute(name) { delete this.attributes[name]; }
    toggleAttribute(name, force) {
        if (force) this.attributes[name] = ''; else delete this.attributes[name];
        return Boolean(force);
    }
    focus() { this.focused = true; documentStub.activeElement = this; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    contains() { return false; }
    getClientRects() { return [{}]; }
}

const windowListeners = {};
const documentStub = {
    title: '',
    activeElement: null,
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
};

const translations = {
    'profile.page_title': 'Мой профиль',
    'profile.page_title_other': 'Профиль: {name}',
    'profile.taste.title': 'Мой вкус',
    'profile.taste.subtitle': 'Что чаще всего появляется в ваших оценках.',
    'profile.taste.title_other': 'Вкус',
    'profile.taste.subtitle_other': 'Что чаще всего появляется в оценках пользователя.',
    'profile.sign_in_required': 'Войдите в аккаунт, чтобы открыть профиль',
    'profile.load_failed': 'Не удалось загрузить профиль.',
    'profile.not_found': 'Профиль не найден',
    'profile.offline_cache': 'Нет связи: показаны сохранённые данные профиля.',
    'profile.continue_watching.season': 'Сезон {n}',
    'profile.continue_watching.episode': 'Серия {n}',
    'profile.edit_modal.saved': 'Профиль обновлён',
    'profile.edit_modal.save_failed': 'Не удалось сохранить профиль.',
    'profile.edit_modal.wrong_password': 'Текущий пароль указан неверно.',
    'profile.edit_modal.username_taken': 'Этот никнейм уже занят.',
    'profile.edit_modal.username_check_failed': 'Не удалось проверить никнейм.',
    'profile.edit_modal.too_many_requests': 'Слишком много попыток.',
    'profile.edit_modal.network_error': 'Нет связи.',
    'profile.edit_modal.weak_password': 'Слишком простой пароль.'
};

const context = vm.createContext({
    console,
    URLSearchParams,
    Map,
    Set,
    Utils,
    document: documentStub,
    window: {
        location: { search: '' },
        addEventListener(type, handler) { (windowListeners[type] ||= []).push(handler); }
    },
    chrome: { runtime: { getURL: (relativePath) => `chrome-extension://test/${relativePath}` } },
    i18n: { get: (key) => translations[key] || key, init: async () => {}, translatePage() {} }
});

const scriptSource = pageSource
    .replace(/^import \{ i18n \} from .*$/m, '')
    + '\nglobalThis.ProfilePageManager = ProfilePageManager; globalThis.safeImageUrl = safeImageUrl;';
vm.runInContext(scriptSource, context, { filename: 'profile.js' });
const { ProfilePageManager, safeImageUrl } = context;

function createManager() {
    const manager = Object.create(ProfilePageManager.prototype);
    manager.modalReturnFocus = new Map();
    manager.profileLoadId = 0;
    manager.firebaseReady = false;
    manager.viewingOtherUser = false;
    manager.profileService = { formatDate: () => 'Сегодня' };
    manager.page = {
        calls: [],
        showError(message) { this.calls.push(['error', message]); },
        showLoader() { this.calls.push(['loader']); },
        showContent() { this.calls.push(['content']); }
    };
    return manager;
}

// --- 1. Recent rating cards escape shared movie metadata ---------------------
{
    const manager = createManager();
    const html = manager.createRatingCardHTML({
        movieId: 42,
        rating: 9,
        createdAt: null,
        movie: {
            name: '<img src=x onerror=alert(1)><a href="https://evil.test">',
            year: 2020,
            genres: [{ name: '<b>Драма</b>' }],
            posterUrl: 'https://img.test/p.jpg" onerror="alert(1)'
        }
    }, 'Оценено: ');

    assert.ok(!html.includes('<img src=x'), 'title markup must be escaped');
    assert.ok(!html.includes('<a href="https://evil.test">'), 'injected links must be escaped');
    assert.ok(!html.includes('<b>'), 'genre markup must be escaped');
    assert.ok(!html.includes('" onerror="'), 'poster URL must not break out of the src attribute');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(html.includes('movieId=42'));

    const javascriptPoster = manager.createRatingCardHTML({
        movieId: 7, rating: 5, movie: { name: 'Film', posterUrl: 'javascript:alert(1)' }
    }, '');
    assert.ok(!javascriptPoster.includes('javascript:'), 'non-image URL schemes are dropped');
    assert.ok(javascriptPoster.includes('poster-placeholder'));

    assert.equal(safeImageUrl('https://a.test/x.png'), 'https://a.test/x.png');
    assert.equal(safeImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
    assert.equal(safeImageUrl('data:text/html;base64,AAAA'), '');
    assert.equal(safeImageUrl('//evil.test/x.png'), '');
}

// --- 2. Keyboard access ------------------------------------------------------
{
    const mousedownBindings = [...pageSource.matchAll(/(\S+)\.addEventListener\('mousedown'/g)].map(match => match[1]);
    assert.deepEqual(
        mousedownBindings.sort(),
        ['selection', 'this.elements.editProfileModal'].sort(),
        'only backdrop dismissal and cropper drag may use mousedown; actions use click'
    );
    assert.ok(!/bindRatingCardListeners/.test(pageSource), 'rating cards stay native links');
    assert.match(pageHtml, /id="photoInput" class="profile-file-input"/);
    assert.match(pageHtml, /id="bannerInput" class="profile-file-input"/);
    assert.doesNotMatch(pageHtml, /id="(?:photo|banner)Input"[^>]*display: none/, 'file inputs must stay focusable');

    const manager = createManager();
    const editModal = new FakeElement();
    editModal.style.display = 'flex';
    const cropperModal = new FakeElement();
    cropperModal.style.display = 'none';
    const opener = new FakeElement();
    manager.modalReturnFocus.set(editModal, opener);
    manager.elements = { editProfileModal: editModal, cropperModal };
    let resetCalls = 0;
    manager.resetForm = () => { resetCalls++; };

    let prevented = false;
    manager.handleModalKeydown({ key: 'Escape', preventDefault: () => { prevented = true; } });
    assert.equal(editModal.style.display, 'none', 'Escape closes the edit dialog');
    assert.equal(resetCalls, 1);
    assert.ok(prevented);
    assert.ok(opener.focused, 'focus returns to the control that opened the dialog');

    // The cropper sits above the edit dialog and closes first.
    editModal.style.display = 'flex';
    cropperModal.style.display = 'flex';
    manager.elements.photoInput = { value: 'x' };
    manager.elements.bannerInput = { value: 'y' };
    manager.handleModalKeydown({ key: 'Escape', preventDefault() {} });
    assert.equal(cropperModal.style.display, 'none');
    assert.equal(editModal.style.display, 'flex');
}

// --- 3. Auth restored after the wait still loads the profile -----------------
(async () => {
    const order = [];
    const manager = createManager();
    context.firebaseManager = {
        isInitialized: true,
        initializeServices() { order.push('services'); },
        getUserService() { return {}; },
        async waitForAuthReady(timeout) {
            order.push(`wait:${timeout}`);
            assert.ok(windowListeners.authStateChanged?.length, 'listener is registered before waiting for auth');
        },
        getCurrentUser() { return null; }
    };
    context.ProfileService = function ProfileService() {};
    manager.getStoredUserId = async () => 'user-1';

    await manager.setupFirebase();
    assert.deepEqual(order, ['services', 'wait:5000'], 'a stored session waits longer than 1 s');
    assert.equal(manager.firebaseReady, true);

    const loads = [];
    manager.loadProfile = async () => { loads.push(manager.currentUser?.uid); };
    await windowListeners.authStateChanged.at(-1)({ detail: { user: { uid: 'user-1' } } });
    assert.deepEqual(loads, ['user-1'], 'a late sign-in loads the profile');

    await manager.handleAuthStateChanged({ uid: 'user-1' });
    assert.deepEqual(loads, ['user-1'], 'the same user does not reload');

    manager.closeCropper = () => {};
    manager.closeEditModal = () => {};
    await manager.handleAuthStateChanged(null);
    assert.equal(manager.userProfile, null);
    assert.deepEqual(manager.page.calls.at(-1), ['error', translations['profile.sign_in_required']]);

    // Signed-out visitors get the sign-in message, also for ?userId= links.
    const visitor = createManager();
    visitor.currentUser = null;
    visitor.closeCropper = () => {};
    visitor.closeEditModal = () => {};
    await visitor.loadProfile();
    assert.deepEqual(visitor.page.calls.at(-1), ['error', translations['profile.sign_in_required']]);

    // --- 4. Another user's profile is not presented as the viewer's own ------
    assert.equal(ProfilePageManager.isOtherUser('other', 'me'), true);
    assert.equal(ProfilePageManager.isOtherUser('other', undefined), true);
    assert.equal(ProfilePageManager.isOtherUser('me', 'me'), false);
    assert.equal(ProfilePageManager.isOtherUser(null, 'me'), false);

    const statCard = new FakeElement({ href: '../ratings/ratings.html' }, ['stat-card', 'stat-card--link']);
    const viewer = createManager();
    viewer.elements = {
        profileMenu: new FakeElement(),
        continueWatchingSection: new FakeElement(),
        profileDashboard: new FakeElement(),
        tasteTitle: new FakeElement(),
        tasteSubtitle: new FakeElement(),
        statCards: [statCard],
        viewAllRatingsBtn: new FakeElement()
    };

    viewer.viewingOtherUser = true;
    viewer.applyViewerMode('Анна');
    assert.equal(viewer.elements.profileMenu.style.display, 'none');
    assert.ok(viewer.elements.continueWatchingSection.hasAttribute('hidden'), 'continue watching is hidden');
    assert.ok(viewer.elements.profileDashboard.classList.contains('profile-dashboard--single'));
    assert.equal(viewer.elements.tasteTitle.textContent, 'Вкус');
    assert.equal(viewer.elements.tasteTitle.getAttribute('data-i18n'), 'profile.taste.title_other');
    assert.equal(statCard.hasAttribute('href'), false, 'counters do not link to the viewer\'s lists');
    assert.ok(statCard.classList.contains('stat-card--static'));
    assert.equal(viewer.elements.viewAllRatingsBtn.style.display, 'none');
    assert.equal(documentStub.title, 'Профиль: Анна');

    viewer.viewingOtherUser = false;
    viewer.applyViewerMode('Я');
    assert.equal(viewer.elements.profileMenu.style.display, 'flex');
    assert.equal(viewer.elements.continueWatchingSection.hasAttribute('hidden'), false);
    assert.equal(statCard.getAttribute('href'), '../ratings/ratings.html');
    assert.ok(statCard.classList.contains('stat-card--link'));
    assert.equal(viewer.elements.tasteTitle.textContent, 'Мой вкус');
    assert.equal(documentStub.title, 'Мой профиль');

    assert.doesNotMatch(pageHtml, /aria-label="Open (?:all ratings|watching list|plan to watch list)"/,
        'stat links expose their visible counter instead of an English label');

    const locales = await import(path.join(projectRoot, 'src/shared/i18n/locales.js').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
    const allLocales = locales.locales || locales.default;
    for (const lang of ['en', 'ru']) {
        const profile = allLocales[lang].profile;
        for (const key of ['page_title', 'page_title_other', 'sign_in_required']) {
            assert.ok(profile[key], `${lang}.profile.${key}`);
        }
        for (const key of ['title_other', 'subtitle_other', 'empty_other', 'distribution_empty_other']) {
            assert.ok(profile.taste[key], `${lang}.profile.taste.${key}`);
        }
    }

    // --- 5. Read failures are reported, not shown as empty data -------------
    global.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' }, FieldPath: { documentId: () => '__name__' } } };
    const ProfileService = require('../src/shared/services/ProfileService.js');
    const UserService = require('../src/shared/services/UserService.js');
    const failingDb = { collection: () => ({ where() { return this; }, doc: () => ({ get: async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); } }), get: async () => { throw new Error('offline'); } }) };
    const failingManager = {
        db: failingDb,
        getRatingService: () => null,
        getFavoriteService: () => ({ getFavoritesCount: async (uid, status, options = {}) => { if (options.throwOnError) throw new Error('offline'); return 0; } }),
        getWatchlistService: () => null,
        getMovieCacheService: () => null
    };
    const failingProfiles = new ProfileService(failingManager);
    const zeroStats = await failingProfiles.getUserStatistics('u1');
    assert.equal(zeroStats.totalRatings, 0, 'default callers (Home) keep the tolerant behaviour');
    await assert.rejects(failingProfiles.getUserStatistics('u1', { throwOnError: true }));
    assert.deepEqual(await failingProfiles.getRecentRatings('u1', 10, 0), []);
    await assert.rejects(failingProfiles.getRecentRatings('u1', 10, 0, { throwOnError: true }));
    const failingUsers = new UserService({ db: failingDb });
    assert.equal(await failingUsers.getUserProfileWithStats('u1'), null);
    await assert.rejects(failingUsers.getUserProfileWithStats('u1', { throwOnError: true }));
    assert.equal(await failingUsers.isUsernameAvailable('name', 'u1'), false);
    await assert.rejects(failingUsers.isUsernameAvailable('name', 'u1', { throwOnError: true }));

    const ratingDocs = [{ rating: '8' }, { rating: 6 }, { rating: null }];
    const statsDb = { collection: () => ({ where() { return this; }, get: async () => ({ forEach: (cb) => ratingDocs.forEach(data => cb({ data: () => data })) }) }) };
    const stats = await new ProfileService({ ...failingManager, db: statsDb }).getRatingsStatistics('u1', { throwOnError: true });
    assert.equal(stats.totalRatings, 2);
    assert.equal(stats.averageRating, 7, 'string scores are converted before summing');

    const offline = createManager();
    offline.currentUser = { uid: 'me' };
    offline.userService = { getUserProfileWithStats: async (uid, options) => { assert.equal(options?.throwOnError, true); throw new Error('offline'); } };
    offline.profileService = { getUserStatistics: async () => ({}) };
    let fallbackRequested = false;
    offline.loadExpiredCacheFallback = async () => { fallbackRequested = true; return false; };
    await offline.loadProfile();
    assert.ok(fallbackRequested, 'a failed read tries the saved profile');
    assert.deepEqual(offline.page.calls.at(-1), ['error', translations['profile.load_failed']]);

    // --- 12. Continue watching shows real progress only ----------------------
    assert.equal(ProfilePageManager.getProgressPercent({}), null, 'nothing played: no progress bar');
    assert.equal(ProfilePageManager.getProgressPercent({ timestamp: 0, duration: 3600 }), null);
    assert.equal(ProfilePageManager.getProgressPercent({ timestamp: 120, duration: 0 }), null, 'unknown duration: no guess');
    assert.equal(ProfilePageManager.getProgressPercent({ timestamp: 1800, duration: 3600 }), 50);
    assert.equal(ProfilePageManager.getProgressPercent({ timestamp: 5, duration: 7200 }), 1);
    assert.equal(ProfilePageManager.getProgressPercent({ completed: true, timestamp: 10, duration: 100 }), 100);
    assert.equal(ProfilePageManager.getEpisodeLabel({ season: 2, episode: 5 }), 'Сезон 2 · Серия 5');
    const unstarted = createManager().createContinueWatchingHTML({ movieId: 1, movieTitle: 'X', progress: null });
    assert.ok(!unstarted.includes('continue-watching-progress'), 'an unstarted title has no fake progress bar');
    const started = createManager().createContinueWatchingHTML({ movieId: 1, movieTitle: 'X', progress: { timestamp: 900, duration: 3600 } });
    assert.match(started, /role="progressbar"[^>]*aria-valuenow="25"/);

    // --- 8 & 9. Saving the profile -------------------------------------------
    const field = (value = '') => ({ value });
    const makeEditor = (profile, firebaseCalls, overrides = {}) => {
        const editor = createManager();
        editor.currentUser = { uid: 'me' };
        editor.userProfile = { uid: 'me', username: 'me_name', firstName: 'A', lastName: 'B', ...profile };
        editor.elements = {
            firstNameInput: field('A'), lastNameInput: field('B'), usernameInput: field('me_name'),
            bioInput: field(''), displayNameFormatInput: field('fullname'),
            passwordFields: { style: { display: 'none' } },
            usernameError: new FakeElement(), passwordError: new FakeElement(),
            ...overrides.elements
        };
        editor.imageCacheService = { cacheImage: async () => {}, invalidateCache: async () => { firebaseCalls.push('invalidate'); } };
        editor.userService = {
            isUsernameAvailable: async () => true,
            updateUserProfile: async (uid, data) => { firebaseCalls.push(['update', data]); if (overrides.updateFails) throw new Error('denied'); }
        };
        editor.displayProfile = () => {};
        editor.setLoading = (value) => { editor.isLoading = value; };
        editor.closeEditModal = () => { firebaseCalls.push('closed'); };
        return editor;
    };
    const toasts = [];
    Utils.showToast = (message, type) => toasts.push([type, message]);
    const fakeFirebase = (calls, extra = {}) => ({
        uploadAvatar: async (file, options) => { calls.push(['uploadAvatar', options]); return { photoURL: 'https://x/new', photoPath: 'avatars/me/profile_1.png' }; },
        uploadBanner: async () => ({ bannerURL: 'https://x/b', bannerPath: 'banners/me/banner_1.png' }),
        deleteProfilePhoto: async (pathValue) => { calls.push(['delete', pathValue]); },
        updateAuthProfile: async (data) => { calls.push(['auth', data]); },
        reauthenticateWithPassword: async () => { calls.push('reauth'); },
        updatePassword: async () => { calls.push('password'); },
        getCurrentUser: () => ({ uid: 'me' }),
        ...extra
    });
    const submitEvent = { preventDefault() {} };

    // 9: removing a Google photo (no photoPath) is saved
    {
        const calls = [];
        context.firebaseManager = fakeFirebase(calls);
        const editor = makeEditor({ photoURL: 'https://lh3.googleusercontent.com/a/photo', photoPath: '' }, calls);
        editor.photoFile = null;
        editor.photoPreview = null;
        await editor.handleFormSubmit(submitEvent);
        const update = calls.find(call => call[0] === 'update')[1];
        assert.equal(update.photoURL, '', 'the Google photo is cleared');
        assert.ok(!calls.some(call => call[0] === 'delete'), 'nothing to delete in Storage');
        assert.deepEqual(calls.find(call => call[0] === 'auth')[1].photoURL, null);
        assert.ok(calls.includes('closed'));
    }

    // 8: new avatar is versioned; the old file is deleted only after the document update
    {
        const calls = [];
        context.firebaseManager = fakeFirebase(calls);
        const editor = makeEditor({ photoURL: 'https://x/old', photoPath: 'avatars/me/profile.jpg' }, calls);
        editor.photoFile = { type: 'image/png' };
        editor.photoPreview = 'data:image/png;base64,AAAA';
        await editor.handleFormSubmit(submitEvent);
        assert.equal(calls[0][0], 'uploadAvatar');
        assert.equal(calls[0][1].versioned, true, 'every avatar upload gets its own object name');
        const updateIndex = calls.findIndex(call => call[0] === 'update');
        const deleteIndex = calls.findIndex(call => call[0] === 'delete');
        assert.ok(updateIndex >= 0 && deleteIndex > updateIndex, 'old avatar removed after the profile points to the new one');
        assert.deepEqual(calls[deleteIndex], ['delete', 'avatars/me/profile.jpg']);
        assert.equal(editor.photoFile, null);
    }

    // 8: a failed document update removes the orphaned upload and keeps the old file
    {
        const calls = [];
        context.firebaseManager = fakeFirebase(calls);
        const editor = makeEditor({ photoURL: 'https://x/old', photoPath: 'avatars/me/profile.jpg' }, calls, { updateFails: true });
        editor.photoFile = { type: 'image/png' };
        editor.photoPreview = 'data:image/png;base64,AAAA';
        toasts.length = 0;
        await editor.handleFormSubmit(submitEvent);
        assert.deepEqual(calls.filter(call => call[0] === 'delete'), [['delete', 'avatars/me/profile_1.png']]);
        assert.deepEqual(toasts.at(-1), ['error', translations['profile.edit_modal.save_failed']], 'no raw SDK text');
        assert.equal(editor.isLoading, false);
    }

    // 8: a wrong current password stops before any upload or write
    {
        const calls = [];
        context.firebaseManager = fakeFirebase(calls, {
            reauthenticateWithPassword: async () => { throw Object.assign(new Error('x'), { code: 'auth/invalid-credential' }); }
        });
        const editor = makeEditor({}, calls, {
            elements: {
                passwordFields: { style: { display: 'block' } },
                currentPasswordInput: field('old-pass'), newPasswordInput: field('new-pass-1'), confirmPasswordInput: field('new-pass-1')
            }
        });
        editor.photoFile = { type: 'image/png' };
        editor.photoPreview = 'data:image/png;base64,AAAA';
        await editor.handleFormSubmit(submitEvent);
        assert.deepEqual(calls, [], 'no upload, write or delete after a wrong password');
        assert.equal(editor.elements.passwordError.textContent, translations['profile.edit_modal.wrong_password']);
    }

    // 8: a failed username lookup is not reported as "taken"; double submit is ignored
    {
        const calls = [];
        context.firebaseManager = fakeFirebase(calls);
        const editor = makeEditor({}, calls, { elements: { usernameInput: field('new_name') } });
        editor.userService.isUsernameAvailable = async (name, uid, options) => {
            assert.equal(options?.throwOnError, true);
            throw new Error('offline');
        };
        await editor.handleFormSubmit(submitEvent);
        assert.equal(editor.elements.usernameError.textContent, translations['profile.edit_modal.username_check_failed']);
        assert.ok(!calls.some(call => call[0] === 'update'));

        editor.isLoading = true;
        let submitted = false;
        editor.userService.isUsernameAvailable = async () => { submitted = true; return true; };
        await editor.handleFormSubmit(submitEvent);
        assert.equal(submitted, false, 'a save in progress ignores another submit');
    }

    assert.equal(createManager().describeSaveError({ code: 'auth/too-many-requests' }), translations['profile.edit_modal.too_many_requests']);
    assert.equal(createManager().describeSaveError(new Error('Firebase: internal')), translations['profile.edit_modal.save_failed']);

    // --- 6. One ratings read serves statistics and every page -----------------
    {
        const ratingQueries = [];
        const userRatings = Array.from({ length: 25 }, (_, index) => ({
            userId: 'u1', movieId: index + 1, rating: (index % 10) + 1,
            createdAt: { seconds: 1000 + index }
        }));
        userRatings.push({ userId: 'u1', movieId: 25, rating: 3, createdAt: { seconds: 10 } }); // older duplicate
        const ratingsDb = {
            collection: () => ({
                where() { return this; },
                get: async () => {
                    ratingQueries.push('ratings');
                    return { forEach: cb => userRatings.forEach((data, index) => cb({ id: `r${index}`, data: () => data })) };
                }
            })
        };
        let activeFetches = 0;
        let peakFetches = 0;
        const fetchedIds = [];
        const cachedMovieIds = new Set([25, 24, 23]);
        const sharedService = new ProfileService({
            db: ratingsDb,
            getRatingService: () => null,
            getFavoriteService: () => ({ getFavoritesCount: async () => 0 }),
            getWatchlistService: () => null,
            getMovieCacheService: () => ({
                getBatchCachedMovies: async ids => Object.fromEntries(ids.filter(id => cachedMovieIds.has(id)).map(id => [id, { name: `Cached ${id}` }])),
                cacheMovie: async () => {}
            }),
            getKinopoiskService: () => ({
                getMovieById: async (id) => {
                    activeFetches++;
                    peakFetches = Math.max(peakFetches, activeFetches);
                    fetchedIds.push(id);
                    await new Promise(resolve => setTimeout(resolve, 5));
                    activeFetches--;
                    return { kinopoiskId: id, name: `API ${id}` };
                }
            })
        });

        const [sharedStats, firstPage] = await Promise.all([
            sharedService.getUserStatistics('u1', { throwOnError: true }),
            sharedService.getRecentRatings('u1', 10, 0, { throwOnError: true })
        ]);
        const secondPage = await sharedService.getRecentRatings('u1', 10, 10, { throwOnError: true });
        const thirdPage = await sharedService.getRecentRatings('u1', 10, 20, { throwOnError: true });
        assert.deepEqual(ratingQueries, ['ratings'], 'statistics and three pages use a single ratings read');
        assert.equal(sharedStats.totalRatings, 26, 'statistics still count every rating document');
        assert.deepEqual(firstPage.map(r => r.movieId).slice(0, 3), [25, 24, 23], 'newest first');
        assert.equal(firstPage[0].rating, 5, 'the latest rating per movie is kept, not the older duplicate (3)');
        assert.equal(firstPage.length + secondPage.length + thirdPage.length, 25, 'one card per movie');
        assert.equal(firstPage[0].movie.name, 'Cached 25');
        assert.ok(!fetchedIds.includes(25), 'cached movies are not requested from the API');
        assert.ok(peakFetches > 1 && peakFetches <= 3, `API lookups run with bounded concurrency (peak ${peakFetches})`);
        const snapshotAfterPaging = await sharedService.loadUserRatings('u1');
        assert.ok(snapshotAfterPaging.every(rating => !('movie' in rating)), 'pages do not mutate the shared snapshot');

        sharedService.invalidateUserRatings('u1');
        await sharedService.getRecentRatings('u1', 10, 0);
        assert.equal(ratingQueries.length, 2, 'an explicit reload reads fresh ratings');

        // A rating that carries its own title is shown without an API request.
        const titled = new ProfileService({
            ...sharedService.firebaseManager,
            db: { collection: () => ({ where() { return this; }, get: async () => ({ forEach: cb => cb({ id: 'x', data: () => ({ userId: 'u2', movieId: 77, rating: 5, movieTitle: 'Own title' }) }) }) }) },
            getMovieCacheService: () => ({ getBatchCachedMovies: async () => ({}), cacheMovie: async () => {} })
        });
        fetchedIds.length = 0;
        const [titledRating] = await titled.getRecentRatings('u2', 10, 0, { throwOnError: true });
        assert.equal(titledRating.movie.name, 'Own title');
        assert.deepEqual(fetchedIds, []);
        assert.match(pageSource, /invalidateUserRatings\?\.\(targetUserId\)/, 'loadProfile starts from a fresh read');
    }

    // --- 10. Image size and cache -------------------------------------------
    {
        assert.deepEqual({ ...ProfilePageManager.getCropOutputSize('avatar', 3000, 3000) }, { width: 512, height: 512 });
        assert.deepEqual({ ...ProfilePageManager.getCropOutputSize('banner', 4500, 1500) }, { width: 1500, height: 500 });
        assert.deepEqual({ ...ProfilePageManager.getCropOutputSize('avatar', 200, 200) }, { width: 200, height: 200 }, 'never upscaled');

        let stored = {};
        global.chrome = {
            storage: {
                local: {
                    get: async (key) => {
                        await new Promise(resolve => setTimeout(resolve, 2));
                        return { [key]: stored[key] ? JSON.parse(JSON.stringify(stored[key])) : undefined };
                    },
                    set: async (values) => {
                        await new Promise(resolve => setTimeout(resolve, 2));
                        Object.assign(stored, JSON.parse(JSON.stringify(values)));
                    }
                }
            }
        };
        const ImageCacheService = require('../src/shared/services/ImageCacheService.js');
        const imageCache = new ImageCacheService();
        const avatarData = 'data:image/png;base64,AAAA';
        const bannerData = 'data:image/webp;base64,BBBB';
        await Promise.all([
            imageCache.cacheImage('u1', 'avatar', avatarData, 'https://x/a'),
            imageCache.cacheImage('u1', 'banner', bannerData, 'https://x/b')
        ]);
        assert.equal(await imageCache.getCachedImage('u1', 'avatar', 'https://x/a'), avatarData, 'parallel writes keep the avatar');
        assert.equal(await imageCache.getCachedImage('u1', 'banner', 'https://x/b'), bannerData, 'parallel writes keep the banner');

        await imageCache.cacheImage('u1', 'avatar', 'data:text/html;base64,PGgxPg==', 'https://x/a');
        assert.equal(await imageCache.getCachedImage('u1', 'avatar', 'https://x/a'), null, 'non-image data is not cached');
        await imageCache.cacheImage('u2', 'avatar', `data:image/gif;base64,${'A'.repeat(imageCache.MAX_ITEM_SIZE)}`, 'https://x/big');
        assert.equal(await imageCache.getCachedImage('u2', 'avatar', 'https://x/big'), null, 'oversized images are not cached');

        global.fetch = async () => ({ ok: false, blob: async () => new Blob(['<h1>403</h1>'], { type: 'text/html' }) });
        await imageCache.fetchAndCache('u3', 'avatar', 'https://x/forbidden');
        assert.equal(stored.profile_cache.u3, undefined, 'error responses are not cached');
        global.fetch = async () => ({ ok: true, blob: async () => new Blob(['{}'], { type: 'application/json' }) });
        await imageCache.fetchAndCache('u3', 'avatar', 'https://x/json');
        assert.equal(stored.profile_cache.u3, undefined, 'non-image bodies are not cached');

        // Broken avatar URL: initials instead of a broken-image icon.
        const avatarManager = createManager();
        const invalidated = [];
        avatarManager.userProfile = { uid: 'u9', firstName: 'анна', lastName: 'петрова' };
        avatarManager.imageCacheService = { invalidateCache: (uid, type) => invalidated.push([uid, type]) };
        avatarManager.elements = {
            profilePhotoImg: new FakeElement({ src: 'https://x/deleted.png' }),
            profilePhotoPlaceholder: new FakeElement(),
            profileInitials: new FakeElement()
        };
        avatarManager.handleAvatarLoadError();
        assert.equal(avatarManager.elements.profilePhotoImg.style.display, 'none');
        assert.equal(avatarManager.elements.profilePhotoPlaceholder.style.display, 'flex');
        assert.equal(avatarManager.elements.profileInitials.textContent, 'АП');
        assert.deepEqual(invalidated, [['u9', 'avatar']]);
    }

    // --- 4 & 11. Rules, cached profile data and sign-out ----------------------
    {
        const firestoreRules = read('rules/firestore.rules').replace(/\r\n/g, '\n');
        const usersBlock = firestoreRules.slice(firestoreRules.indexOf('match /users/{userId} {'));
        assert.match(usersBlock, /allow read: if isOwner\(userId\) \|\| isApprovedUser\(\) \|\| isAdmin\(\);/,
            'other profiles (with e-mail) are readable only by approved users and admins');
        assert.doesNotMatch(usersBlock.slice(0, usersBlock.indexOf('match /collections/')), /allow read: if isAuthenticated\(\);/);
        assert.match(firestoreRules, /function isValidProfileFieldUpdate\(\)/);
        for (const check of [
            /isSafePhotoUrl\(data\.bannerURL\)/,
            /data\.username\.matches\('\^\[A-Za-z0-9_\]\{3,20\}\$'\)/,
            /data\.usernameLower == data\.username\.lower\(\)/,
            /data\.bio\.size\(\) <= 200/,
            /data\.firstName\.size\(\) <= 50/,
            /data\.displayNameFormat in \['fullname', 'username'\]/
        ]) {
            assert.match(firestoreRules, check);
        }
        assert.match(usersBlock, /isValidProfileFieldUpdate\(\);/, 'owner updates are validated');
        assert.match(usersBlock, /allow create:[\s\S]*isSafePhotoUrl\(request\.resource\.data\.bannerURL\)/);

        const storageRules = read('rules/storage.rules').replace(/\r\n/g, '\n');
        assert.match(storageRules, /request\.resource\.size <= 5 \* 1024 \* 1024/);
        assert.match(storageRules, /request\.resource\.contentType in \['image\/png', 'image\/jpeg', 'image\/webp', 'image\/gif'\]/);
        for (const folder of ['avatars', 'banners']) {
            const block = storageRules.slice(storageRules.indexOf(`match /${folder}/{userId}`));
            assert.match(block.slice(0, block.indexOf('allow delete')), /allow create, update: if [^;]*isValidProfileImage\(\);/,
                `${folder} uploads are limited to raster images up to 5 MB`);
        }

        const timestamp = { toDate: () => new Date('2024-03-05T00:00:00Z') };
        const fullProfile = {
            uid: 'u1', firstName: 'A', lastName: 'B', username: 'ab', email: 'a@b.test', isAdmin: true,
            approvalStatus: 'approved', preferences: { theme: 'dark' }, photoURL: 'https://x/a', photoPath: 'avatars/u1/a.png',
            createdAt: timestamp, stats: { totalRatings: 3 }
        };
        const cachedOther = ProfilePageManager.toCachedProfile(fullProfile);
        for (const privateField of ['email', 'isAdmin', 'approvalStatus', 'preferences', 'photoPath']) {
            assert.equal(privateField in cachedOther, false, `${privateField} is not cached for another user`);
        }
        assert.equal(cachedOther.createdAt, '2024-03-05T00:00:00.000Z', 'join date survives JSON storage');
        assert.equal(ProfilePageManager.toCachedProfile(fullProfile, { isOwn: true }).photoPath, 'avatars/u1/a.png');
        assert.equal(ProfilePageManager.toDate({ seconds: 1700000000, nanoseconds: 0 }).getTime(), 1700000000000,
            'a Timestamp already serialized by chrome.storage still renders');
        assert.equal(ProfilePageManager.toDate({}), null);

        const stored = {
            profile_cache_index: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`old${i}`, i + 1]))
        };
        Array.from({ length: 20 }, (_, i) => { stored[`profile_cache_old${i}`] = { profile: {} }; });
        const profileStorage = {
            get: async (keys) => Object.fromEntries(keys.map(k => [k, stored[k] ? JSON.parse(JSON.stringify(stored[k])) : undefined])),
            set: async (values) => { Object.assign(stored, JSON.parse(JSON.stringify(values))); },
            remove: async (keys) => { keys.forEach(k => delete stored[k]); }
        };
        context.chrome = { ...context.chrome, storage: { local: profileStorage } };
        const cacher = createManager();
        cacher.currentUser = { uid: 'other' };
        await cacher.saveProfileCache('u1', fullProfile, { totalRatings: 3 });
        assert.equal(stored.profile_cache_u1.profile.email, undefined);
        assert.equal(Object.keys(stored.profile_cache_index).length, 20, 'at most 20 cached profiles');
        assert.equal(stored.profile_cache_old0, undefined, 'the oldest cached profile is evicted');
        assert.ok(stored.profile_cache_old19);

        const firestoreSource = read('src/shared/firestore.js');
        const signOutBody = firestoreSource.slice(firestoreSource.indexOf('async signOut()'), firestoreSource.indexOf('async signInWithEmail('));
        assert.match(signOutBody, /await this\.clearProfileCaches\(\);/, 'sign-out removes cached profiles');
        assert.match(firestoreSource, /async clearProfileCaches\(\)[\s\S]*profile_cache_index[\s\S]*storage\.remove/);

        const navigationSource = read('src/shared/components/Navigation.js');
        assert.match(navigationSource, /photo = upload\.photoURL;/, 'Navigation stores the uploaded URL, not the result object');
    }

    // --- Localization, dead code, form hygiene, cropper keyboard -------------
    {
        const allLocales = (await import(path.join(projectRoot, 'src/shared/i18n/locales.js').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'))).locales;
        const usedKeys = new Set([
            ...[...pageSource.matchAll(/i18n\.get\('(profile\.[\w.]+)'\)/g)].map(m => m[1]),
            ...[...pageSource.matchAll(/'(profile\.[a-z_]+\.[\w.]+)'/g)].map(m => m[1]),
            ...[...pageHtml.matchAll(/data-i18n="(?:\[[^\]]+\])?(profile\.[\w.]+)"/g)].map(m => m[1])
        ]);
        assert.ok(usedKeys.size > 60, `collected ${usedKeys.size} profile keys`);
        for (const key of usedKeys) {
            for (const lang of ['en', 'ru']) {
                const value = key.split('.').reduce((node, part) => node?.[part], allLocales[lang]);
                assert.equal(typeof value, 'string', `${lang}.${key} exists`);
            }
        }
        assert.doesNotMatch(pageSource, /is required'|must be at least|do not match'|Invalid file type|File size must|'Unknown Movie'|'Оценено: '/,
            'no hard-coded English or Russian-only messages remain');
        assert.match(allLocales.ru.profile.cropper.gif_bypass, /нельзя обрезать/);
        assert.doesNotMatch(pageHtml, /profileMenuBtn|profileDropdown|editProfileItem/, 'the never-shown ⋮ menu is removed');
        assert.doesNotMatch(pageSource, /twitterInput|toggleMenu\(|closeMenu\(/);
        assert.match(pageHtml, /id="currentPasswordInput"[^>]*autocomplete="current-password"/);
        assert.match(pageHtml, /id="newPasswordInput"[^>]*autocomplete="new-password"/);
        assert.match(pageHtml, /data-async-style/, 'Google Fonts no longer block the first paint');

        const formManager = createManager();
        const passwordInputs = [field('a'), field('b'), field('c')].map(input => input);
        formManager.elements = {
            currentPasswordInput: passwordInputs[0], newPasswordInput: passwordInputs[1], confirmPasswordInput: passwordInputs[2],
            togglePasswordBtn: new FakeElement(), passwordFields: { style: {} }
        };
        formManager.resetForm();
        assert.deepEqual(passwordInputs.map(input => input.value), ['', '', ''], 'closing the dialog clears typed passwords');

        const cropManager = createManager();
        cropManager.currentCropperMode = 'avatar';
        cropManager.cropperData = { x: 5, y: 5, w: 100, h: 100 };
        cropManager.elements = {
            cropperImage: { getBoundingClientRect: () => ({ width: 300, height: 200 }) },
            cropperSelection: { style: {} }
        };
        const key = (keyName, extra = {}) => cropManager.handleCropperKeydown({ key: keyName, preventDefault() {}, ...extra });
        key('ArrowLeft');
        assert.equal(cropManager.cropperData.x, 0, 'movement stays inside the image');
        key('ArrowRight', { shiftKey: true });
        assert.equal(cropManager.cropperData.x, 1, 'Shift moves by 1 px');
        key('+');
        assert.equal(cropManager.cropperData.w, 120);
        assert.equal(cropManager.cropperData.h, 120, 'resizing keeps the aspect ratio');
        for (let i = 0; i < 20; i++) key('+');
        assert.equal(cropManager.cropperData.w, 200, 'the selection never exceeds the image');
        for (let i = 0; i < 30; i++) key('-');
        assert.equal(cropManager.cropperData.w, 50, 'minimum 50 px');
    }

    console.log('Profile page audit fixes tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
