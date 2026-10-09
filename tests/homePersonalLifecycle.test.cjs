const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function movie(id, title = `Movie ${id}`) {
    return {
        id: `favorite-${id}`, movieId: id, createdAt: 100000 - id,
        movie: { kinopoiskId: id, name: title, year: 2026, type: 'movie',
            posterUrl: `https://image.tmdb.org/t/p/w342/${id}.jpg` }
    };
}
function personal(uid, watching = [movie(1), movie(2)], watchlist = [movie(3)]) {
    return {
        isAuthenticated: true, userId: uid, hasContent: watching.length + watchlist.length > 0,
        watching, watchlist, watchingTotal: watching.length, watchlistTotal: watchlist.length
    };
}

// Only external IO and unrelated carousel/page-state helpers are controlled.
// Cards, enrichment, renderer, data controller and lifecycle are real source.
function harness() {
    const dom = new JSDOM(read('src/pages/home/home.html'), { url: 'https://home.test/' });
    const document = dom.window.document;
    const store = {};
    const writes = [];
    const favoriteReads = [];
    const observers = [];
    const storageListeners = new Set();
    const timers = new Map();
    let timerId = 0;
    let user = null;
    let favoriteRead = async () => [];
    let authRead = async () => user;
    let storageRead = async keys => Object.fromEntries(keys.map(key => [key, structuredClone(store[key])]));
    const storage = {
        get(keys, callback) {
            const promise = storageRead(Array.isArray(keys) ? keys : [keys]);
            promise.then(result => callback?.(result), () => callback?.({}));
            return promise;
        },
        async set(values, callback) {
            const plain = structuredClone(values);
            Object.assign(store, plain);
            writes.push(plain);
            callback?.();
        },
        async remove(keys, callback) {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
            callback?.();
        }
    };
    class ControlledIntersectionObserver {
        constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
        observe(target) { this.targets.add(target); }
        unobserve(target) { this.targets.delete(target); }
        disconnect() { this.targets.clear(); }
        emit(target, isIntersecting) { this.callback([{ target, isIntersecting }]); }
    }
    const favoriteService = {
        getFavorites(uid, status, sort, order, options) {
            favoriteReads.push({ uid, status, options });
            return favoriteRead(uid, status);
        }
    };
    const firebaseManager = {
        isAuthReady: true,
        getCurrentUser: () => user,
        waitForAuthReady: timeout => authRead(timeout),
        getFavoriteService: () => favoriteService,
        getKinopoiskService: () => ({}),
        getHomeCacheService: () => ({ getDiscoveryData: async () => ({ data: {} }) }),
        getMovieCacheService: () => ({ getMoviesByAvgRating: async () => ({ movies: [] }), getMostRatedMovies: async () => [] })
    };
    dom.window.i18n = { get: key => key, currentLocale: 'ru' };
    dom.window.firebaseManager = firebaseManager;
    const context = vm.createContext({
        window: dom.window, document, HTMLElement: dom.window.HTMLElement,
        console: { log() {}, info() {}, warn() {}, error() {} },
        chrome: {
            storage: { local: storage, onChanged: {
                addListener: listener => storageListeners.add(listener),
                removeListener: listener => storageListeners.delete(listener)
            } },
            runtime: { getURL: value => `https://home.test/${value}` }
        },
        IntersectionObserver: ControlledIntersectionObserver,
        setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        Utils: {
            createPageStateManager: () => ({ showContent() {}, showError() {} }),
            bindMovieCardNavigation() {},
            extractKinopoiskId: item => Number(item?.kinopoiskId || item?.movieId) || null
        },
        FeaturedSliderController: class { init() {} }
    });
    for (const [file, name] of [
        ['src/shared/components/MovieCard.js', 'MovieCard'],
        ['src/shared/services/FavoriteService.js', 'FavoriteService'],
        ['src/shared/services/MovieRatingsEnrichmentService.js', 'MovieRatingsEnrichmentService'],
        ['src/pages/home/HomeDataController.js', 'HomeDataController'],
        ['src/pages/home/HomeRenderer.js', 'HomeRenderer']
    ]) vm.runInContext(`${read(file)}\nglobalThis.${name} = ${name};`, context, { filename: file });
    const homeCode = read('src/pages/home/home.js');
    const bootstrap = homeCode.lastIndexOf("document.addEventListener('DOMContentLoaded'");
    assert.ok(bootstrap >= 0, 'Home bootstrap must remain separately identifiable');
    vm.runInContext(`${homeCode.slice(0, bootstrap)}\nglobalThis.HomePage = HomePage;`, context, { filename: 'home.js' });
    const page = new context.HomePage();
    const element = id => document.getElementById(id);
    const cards = (id = 'personal-tier') => Array.from(element(id).querySelectorAll('.movie-card-component'));
    const card = id => element('personal-tier').querySelector(`.movie-card-component[data-movie-id="${id}"]`);
    const mutations = (container, callback) => {
        const observer = new dom.window.MutationObserver(() => {});
        observer.observe(container, { subtree: true, childList: true, attributes: true, characterData: true });
        callback();
        const records = observer.takeRecords();
        observer.disconnect();
        return records;
    };
    return {
        dom, document, context, page, element, cards, card, mutations, store, writes, observers, favoriteReads,
        user(value) { user = value; },
        favorites(fn) { favoriteRead = fn; },
        auth(fn) { authRead = fn; },
        locale(value) {
            dom.window.i18n.currentLocale = value;
            dom.window.i18n.get = key => `${value}:${key}`;
        },
        storageRead(fn) { storageRead = fn; },
        storageEvent(changes) { for (const listener of storageListeners) listener(changes, 'local'); },
        authEvent(value) {
            user = value;
            dom.window.dispatchEvent(new dom.window.CustomEvent('authStateChanged', {
                detail: { isAuthenticated: !!value, user: value }
            }));
        },
        dispose() { page.ratingEnricher?.dispose(); dom.window.close(); }
    };
}

async function run() {
    // Skeleton mirrors the two actual sections, including real headers/count placeholders.
    {
        const h = harness();
        h.page.renderer.renderPersonalSkeleton(h.element('personal-tier'));
        assert.equal(h.element('personal-tier').getAttribute('aria-busy'), 'true');
        assert.equal(h.element('personal-tier').querySelectorAll('.section-header h2').length, 2);
        const counts = h.element('personal-tier').querySelectorAll('.section-count-badge');
        assert.equal(counts.length, 2, 'Both headers reserve their count-badge space');
        for (const count of counts) assert.notEqual(count.textContent.trim(), '0', 'Loading must not claim a zero total');
        assert.ok(h.element('home-watching-grid').querySelector('.home-skeleton-card'));
        assert.ok(h.element('home-watchlist-grid').querySelector('.home-skeleton-card'));
        h.dispose();
    }

    // Preview persistence projects at most six cards per list and excludes private bookmark notes.
    {
        const h = harness();
        const watching = Array.from({ length: 9 }, (_, index) => ({ ...movie(index + 100), notes: 'PRIVATE_NOTES', token: 'AUTH_DATA' }));
        const watchlist = Array.from({ length: 8 }, (_, index) => movie(index + 200));
        const data = personal('a', watching, watchlist);
        await h.page.dataController.savePersonalPreview('a', data);
        const cached = h.store.home_personal_preview_v2_a.data;
        assert.equal(cached.watching.length, 6);
        assert.equal(cached.watchlist.length, 6);
        assert.equal(cached.watchingTotal, 9);
        assert.equal(cached.watchlistTotal, 8);
        assert.ok(!JSON.stringify(cached).includes('PRIVATE_NOTES'));
        assert.ok(!JSON.stringify(cached).includes('AUTH_DATA'));
        await h.page.dataController.savePersonalPreview('a', { ...data, watchingTotal: Infinity, watchlistTotal: 'bad' });
        assert.equal(h.store.home_personal_preview_v2_a.data.watchingTotal, 6);
        assert.equal(h.store.home_personal_preview_v2_a.data.watchlistTotal, 6);
        h.dispose();
    }

    // The actual FavoriteService invalidator clears both views for one uid and publishes a new revision.
    {
        const h = harness();
        h.store.bookmarks_cache_a = { old: true };
        h.store.bookmarks_cache_b = { keep: true };
        h.store.home_personal_preview_v1_a = { legacy: true };
        await h.page.dataController.savePersonalPreview('a', personal('a'));
        await h.page.dataController.savePersonalPreview('b', personal('b'));
        const service = new h.context.FavoriteService({ db: {} });
        await service.invalidateBookmarksCache('a');
        assert.equal(h.store.bookmarks_cache_a, undefined);
        assert.equal(h.store.home_personal_preview_v1_a, undefined);
        assert.equal(h.store.home_personal_preview_v2_a, undefined);
        assert.ok(h.store.bookmarks_cache_b);
        assert.ok(h.store.home_personal_preview_v2_b);
        const revision = h.store.home_personal_preview_revision_a;
        assert.equal(typeof revision, 'string');
        assert.ok(revision.length);
        await service.invalidateBookmarksCache('a');
        assert.notEqual(h.store.home_personal_preview_revision_a, revision);
        h.dispose();
    }

    // Personal Home trusts the bookmark movieId over stale nested/legacy IDs,
    // skips the obsolete preview key, and rejects a conflicting rating record.
    {
        const h = harness();
        const bookmark = {
            id: 'user_412366', movieId: 412366, kinopoiskId: 178720,
            kpRating: 7.5, imdbRating: 7.6, movieTitle: 'Хранилище 13',
            posterPath: 'https://avatars.mds.yandex.net/get-kinopoisk-image/warehouse.jpg',
            releaseYear: 2009,
            movie: {
                movieId: 178720, kinopoiskId: 178720, tmdbId: 550,
                name: 'Хранилище 13', year: 2009, type: 'tv-series',
                posterUrl: 'https://avatars.mds.yandex.net/get-kinopoisk-image/warehouse.jpg',
                kpRating: 8.7, imdbRating: 8.9, isTmdbOnly: true
            }
        };
        const legacyData = personal('a', [bookmark], []);
        h.store.home_personal_preview_v1_a = {
            schemaVersion: 1, userId: 'a', timestamp: Date.now(), data: legacyData
        };
        assert.equal(await h.page.dataController.getPersonalPreview('a'), null,
            'A v1 preview containing a possibly stale identity is never read');

        await h.page.dataController.savePersonalPreview('a', legacyData);
        const warmPreview = await h.page.dataController.getPersonalPreview('a');
        h.page.renderer.renderPersonalTier(warmPreview, h.element('personal-tier'));
        const card = h.card(412366);
        assert.ok(card, 'The personal card is keyed by the bookmark ID');
        assert.equal(card.dataset.movieId, '412366');
        assert.equal(card.dataset.isTmdbOnly, undefined, 'A saved bookmark ID bypasses TMDB remapping');
        assert.equal(card.dataset.kpRating, '7.5', 'Conflicting nested provider ratings are not shown');
        assert.equal(card.dataset.imdbRating, '7.6');
        const detailsLink = card.querySelector('[data-action="view-details"]');
        assert.match(detailsLink.href, /movieId=412366/);
        assert.doesNotMatch(detailsLink.href, /movieId=178720/);

        const enricher = h.page.ratingEnricher;
        h.store.movie_card_ratings_v4 = {
            'kp:412366': {
                kpId: 178720, kpRating: 8.7, imdbRating: 8.9,
                status: 'resolved', kpState: 'available', imdbState: 'available',
                expiresAt: Date.now() + 60_000, updatedAt: Date.now() - 1_000
            }
        };
        enricher.resolveIdentityDedup = async candidate => ({ ...candidate, searchFailed: true });
        enricher.enqueueCards([card]);
        await enricher.flushPendingCards();
        assert.equal(card.dataset.movieId, '412366', 'Rating enrichment cannot replace the bookmark identity');
        assert.notEqual(card.dataset.kpRating, '8.7');
        assert.notEqual(card.dataset.imdbRating, '8.9');
        assert.notEqual(h.store.movie_card_ratings_v4['kp:412366']?.kpId, 178720,
            'A mismatched per-card rating record is discarded from storage');
        h.dispose();
    }

    // Successful bookmark mutations call that same invalidator, not just the helper in isolation.
    {
        const h = harness();
        const documents = [];
        h.context.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } };
        const service = new h.context.FavoriteService({ db: {
            collection(name) {
                assert.equal(name, 'favorites');
                return { doc(id) {
                    documents.push(id);
                    return {
                        async get() { return { exists: true }; },
                        async set() {}, async update() {}, async delete() {}
                    };
                } };
            }
        } });
        for (const mutate of [
            () => service.addToFavorites('a', { movieId: 1, name: 'Saved' }, 'watching'),
            () => service.updateStatus('a', 1, 'plan_to_watch'),
            () => service.removeFromFavorites('a', 1)
        ]) {
            h.store.bookmarks_cache_a = { old: true };
            await h.page.dataController.savePersonalPreview('a', personal('a'));
            const previous = h.store.home_personal_preview_revision_a;
            await mutate();
            assert.equal(h.store.bookmarks_cache_a, undefined);
            assert.equal(h.store.home_personal_preview_v2_a, undefined);
            assert.notEqual(h.store.home_personal_preview_revision_a, previous);
        }
        assert.deepEqual(documents, ['a_1', 'a_1', 'a_1']);
        h.dispose();
    }

    // The real observer sees both lists after all sections are attached, and Community too.
    {
        const h = harness();
        h.page.renderer.renderPersonalTier(personal('a'), h.element('personal-tier'));
        assert.equal(h.cards().length, 3);
        for (const card of h.cards()) {
            assert.equal(card.isConnected, true);
            assert.equal(h.page.ratingEnricher.trackedCards.has(card), true, 'Rendering the second list must not release cards in the first');
            assert.equal(h.observers.some(observer => observer.targets.has(card)), true);
        }
        h.page.renderer.renderDashboard({ isAuthenticated: true, communityTop: [movie(9)] }, h.element('dashboard-section'));
        const community = h.cards('dashboard-section');
        assert.equal(community.length, 1);
        for (const card of community) {
            assert.equal(h.page.ratingEnricher.trackedCards.has(card), true, 'Community cards need progressive provider enrichment');
            assert.equal(h.observers.some(observer => observer.targets.has(card)), true);
            h.observers.find(observer => observer.targets.has(card)).emit(card, true);
            assert.equal(h.page.ratingEnricher.pendingCards.has(card), true);
        }
        h.dispose();
    }

    // Guest, empty and error states refresh their localized copy while equal locale renders stay unchanged.
    for (const { data, selector, key } of [
        { data: { isAuthenticated: false }, selector: '.home-cta-text h2', key: 'home.cta.title' },
        { data: personal('a', [], []), selector: '.home-empty-personal p', key: 'home.empty_personal' },
        { data: { isAuthenticated: true, userId: 'a', loadFailed: true }, selector: '.home-section-message p', key: 'home.personal_error' }
    ]) {
        const h = harness();
        h.page.renderer.renderPersonalTier(data, h.element('personal-tier'));
        const oldText = h.element('personal-tier').querySelector(selector).textContent;
        h.locale('en');
        h.page.renderer.renderPersonalTier(data, h.element('personal-tier'));
        assert.equal(h.element('personal-tier').querySelector(selector).textContent, `en:${key}`);
        assert.notEqual(h.element('personal-tier').querySelector(selector).textContent, oldText);
        const records = h.mutations(h.element('personal-tier'), () => {
            h.page.renderer.renderPersonalTier(structuredClone(data), h.element('personal-tier'));
        });
        assert.equal(records.length, 0, 'Localized non-content state avoids writes when text is unchanged');
        h.dispose();
    }

    // The real locale lifecycle patches existing cold headers without replacing their skeleton geometry.
    {
        const h = harness();
        h.user({ uid: 'a' });
        h.dom.window.firebaseManager.isAuthReady = false;
        await h.page.preparePersonalTier();
        const sections = Array.from(h.element('personal-tier').querySelectorAll('.category-section'));
        const skeletons = Array.from(h.element('personal-tier').querySelectorAll('.home-skeleton-card'));
        const counts = Array.from(h.element('personal-tier').querySelectorAll('.section-count-badge'));
        assert.equal(sections.length, 2);
        h.locale('en');
        h.page.handleLocaleChange('en');
        await flush();
        assert.deepEqual(Array.from(h.element('personal-tier').querySelectorAll('.category-section')), sections);
        assert.deepEqual(Array.from(h.element('personal-tier').querySelectorAll('.home-skeleton-card')), skeletons);
        assert.deepEqual(Array.from(h.element('personal-tier').querySelectorAll('.section-count-badge')), counts);
        assert.ok(sections[0].querySelector('h2').textContent.includes('en:home.continue_watching'));
        assert.ok(sections[1].querySelector('h2').textContent.includes('en:home.watchlist'));
        assert.equal(h.element('personal-tier').getAttribute('aria-busy'), 'true');
        assert.equal(h.favoriteReads.length, 0, 'Locale refresh cannot bypass pending auth to start private reads');
        h.dispose();
    }

    // Identical keyed data performs no DOM writes; totals change only their badge.
    {
        const h = harness();
        const data = personal('a');
        h.page.renderer.renderPersonalTier(data, h.element('personal-tier'));
        const initial = h.cards();
        const records = h.mutations(h.element('personal-tier'), () => {
            h.page.renderer.renderPersonalTier(structuredClone(data), h.element('personal-tier'));
        });
        assert.equal(records.length, 0, 'Unchanged payload must not rewrite even attributes or text');
        assert.deepEqual(h.cards(), initial);
        const count = h.element('home-watching-grid').closest('.category-section').querySelector('.section-count-badge');
        const countRecords = h.mutations(h.element('personal-tier'), () => {
            h.page.renderer.renderPersonalTier({ ...data, watchingTotal: 21 }, h.element('personal-tier'));
        });
        assert.equal(count.textContent, '21');
        assert.ok(countRecords.length > 0);
        assert.ok(countRecords.every(record => record.target === count || count.contains(record.target)), 'Changing totals must only mutate their badge');
        assert.deepEqual(h.cards(), initial);
        h.dispose();
    }

    // Reordering preserves focused nodes and a settled provider rating; a changed peer is isolated.
    {
        const h = harness();
        const data = personal('a');
        h.page.renderer.renderPersonalTier(data, h.element('personal-tier'));
        const first = h.card(1);
        const second = h.card(2);
        const watchlist = h.card(3);
        h.page.ratingEnricher.applyRatings(first, { kpId: 1, kpRating: 8.7, imdbRating: 8.1, status: 'resolved' });
        const ratings = first.querySelector('.mc-badges-overlay');
        assert.ok(ratings, 'Real MovieCard has a provider rating overlay');
        const ratingMarkup = ratings.innerHTML;
        const focused = first.querySelector('a[href]');
        focused.focus();
        h.page.renderer.renderPersonalTier({ ...data, watching: [data.watching[1], data.watching[0]] }, h.element('personal-tier'));
        assert.deepEqual(Array.from(h.element('home-watching-grid').children), [second, first]);
        assert.equal(h.document.activeElement, focused, 'Moving a keyed card must retain keyboard focus');
        assert.equal(h.card(3), watchlist);
        assert.equal(ratings.innerHTML, ratingMarkup);
        const updated = { ...data, watching: [movie(2, 'Changed peer'), data.watching[0]] };
        h.page.renderer.renderPersonalTier(updated, h.element('personal-tier'));
        assert.equal(h.card(1), first);
        assert.equal(h.card(3), watchlist);
        assert.ok(h.card(2).textContent.includes('Changed peer'));
        assert.equal(ratings.innerHTML, ratingMarkup, 'Peer updates must not erase enriched provider ratings');
        assert.equal(first.dataset.ratingsState, 'ready');
        h.dispose();
    }

    // Real controller owns a validated uid-scoped, versioned preview cache.
    {
        const h = harness();
        const controller = h.page.dataController;
        const data = personal('a');
        await controller.savePersonalPreview('a', data);
        const envelope = h.store.home_personal_preview_v2_a;
        assert.equal(envelope.schemaVersion, 2);
        assert.equal(envelope.userId, 'a');
        assert.ok(Math.abs(Date.now() - envelope.timestamp) < 2000);
        assert.equal((await controller.getPersonalPreview('a')).userId, 'a');
        assert.equal(await controller.getPersonalPreview('b'), null);
        for (const invalid of [
            { ...envelope, schemaVersion: 1 }, { ...envelope, userId: 'b' },
            { ...envelope, timestamp: Date.now() - 24 * 60 * 60 * 1000 - 1 },
            { ...envelope, data: null }
        ]) {
            h.store.home_personal_preview_v2_a = invalid;
            assert.equal(await controller.getPersonalPreview('a'), null);
        }
        h.store.home_personal_preview_v2_a = envelope;
        await controller.invalidatePersonalPreview('a');
        assert.equal(h.store.home_personal_preview_v2_a, undefined);
        h.dispose();
    }

    // No warm cache: the real page shows both skeleton sections before bookmarks resolve.
    {
        const h = harness();
        h.user({ uid: 'a' });
        const pending = deferred();
        h.favorites(() => pending.promise);
        const task = h.page.updatePersonalTier({ uid: 'a' });
        await flush();
        assert.equal(h.element('personal-tier').getAttribute('aria-busy'), 'true');
        assert.ok(h.element('home-watching-grid').querySelector('.home-skeleton-card'));
        assert.ok(h.element('home-watchlist-grid').querySelector('.home-skeleton-card'));
        const repeated = h.page.updatePersonalTier({ uid: 'a' });
        await flush();
        assert.equal(h.favoriteReads.length, 2, 'Same uid pending updates share the two bookmark reads');
        pending.resolve([movie(4)]);
        await Promise.all([task, repeated]);
        assert.ok(h.card(4));
        h.dispose();
    }

    // In-memory list reuse is cleared explicitly after mutations rather than hiding stale data.
    {
        const h = harness();
        h.user({ uid: 'a' });
        h.favorites(async (uid, status) => status === 'watching' ? [movie(1)] : []);
        await h.page.dataController.fetchPersonalData('a');
        await h.page.dataController.fetchPersonalData('a');
        assert.equal(h.favoriteReads.length, 2);
        h.page.dataController.clearFavoriteLists('a');
        await h.page.dataController.fetchPersonalData('a');
        assert.equal(h.favoriteReads.length, 4);
        h.dispose();
    }

    // Warm preview is shown immediately; equal network data and a later failure keep its nodes.
    {
        const h = harness();
        h.user({ uid: 'a' });
        const data = personal('a', [movie(1), movie(2)], [movie(3)]);
        for (const bookmark of [...data.watching, ...data.watchlist]) {
            bookmark.notes = 'Private bookmark note';
            bookmark.description = 'Unused description at bookmark level';
            bookmark.movie.description = 'Unused description from provider';
            bookmark.movie.genres = [{ genre: 'триллер' }];
        }
        await h.page.dataController.savePersonalPreview('a', data);
        const requests = { watching: deferred(), plan_to_watch: deferred() };
        h.favorites((uid, status) => requests[status].promise);
        const task = h.page.updatePersonalTier({ uid: 'a' });
        await flush();
        const cached = h.cards();
        assert.equal(cached.length, 3, 'Uid-matched warm preview precedes slow Firestore bookmarks');
        h.page.ratingEnricher.applyRatings(cached[0], { kpId: 1, kpRating: 8.7, imdbRating: 8.1, status: 'resolved' });
        requests.watching.resolve(data.watching);
        requests.plan_to_watch.resolve(data.watchlist);
        await task;
        assert.deepEqual(h.cards(), cached, 'Authoritative identical bookmarks must not reset cached cards');
        assert.equal(cached[0].dataset.kpRating, '8.7');
        assert.equal(cached[0].dataset.ratingsState, 'ready');
        h.page.dataController.clearFavoriteLists('a');
        h.favorites(async () => { throw new Error('offline'); });
        await h.page.updatePersonalTier({ uid: 'a' });
        assert.deepEqual(h.cards(), cached, 'A network error must preserve already shown warm personal data');
        h.dispose();
    }

    // Uid switch/sign-out clears the previous view immediately and drops late old bookmark replies.
    {
        const h = harness();
        await h.page.dataController.savePersonalPreview('a', personal('a', [movie(10, 'Private A')], []));
        await h.page.dataController.savePersonalPreview('b', personal('b', [movie(20, 'Private B')], []));
        const aNetwork = deferred();
        const bNetwork = deferred();
        h.favorites((uid, status) => status === 'plan_to_watch' ? Promise.resolve([]) : (uid === 'a' ? aNetwork.promise : bNetwork.promise));
        h.user({ uid: 'a' });
        const aTask = h.page.updatePersonalTier({ uid: 'a' });
        await flush();
        assert.ok(h.card(10));
        h.user({ uid: 'b' });
        const bTask = h.page.updatePersonalTier({ uid: 'b' });
        assert.ok(!h.element('personal-tier').textContent.includes('Private A'), 'Uid switch clears old personal cards before cache IO');
        await flush();
        assert.ok(h.card(20));
        aNetwork.resolve([movie(11, 'Late private A')]);
        await aTask;
        assert.ok(!h.card(11));
        h.user(null);
        await h.page.updatePersonalTier(false);
        assert.equal(h.cards().length, 0);
        assert.ok(h.element('homeSignInBtn'));
        bNetwork.resolve([movie(21, 'Late private B')]);
        await bTask;
        assert.equal(h.cards().length, 0);
        assert.ok(h.element('homeSignInBtn'), 'Late signed-in reply cannot replace signed-out CTA');
        h.dispose();
    }

    // A late auth bootstrap result cannot supersede a newer auth event from the real page lifecycle.
    {
        const h = harness();
        const auth = deferred();
        h.dom.window.firebaseManager.isAuthReady = false;
        h.auth(() => auth.promise);
        h.favorites(async (uid, status) => status === 'watching' ? [movie(uid === 'b' ? 30 : 31, uid)] : []);
        const init = h.page.init();
        await flush();
        assert.equal(h.cards().length, 0);
        assert.equal(h.element('homeSignInBtn'), null, 'Unknown pending auth must not flash the guest CTA');
        h.authEvent({ uid: 'b' });
        await flush();
        assert.ok(h.card(30));
        auth.resolve({ uid: 'a' });
        await init;
        assert.ok(h.card(30));
        assert.ok(!h.card(31), 'Late initial auth must not show the previous user');
        assert.ok(h.favoriteReads.every(request => request.uid === 'b'));
        h.dispose();
    }

    // An optimistic currentUser does not authorize showing persisted personal data before auth is confirmed.
    {
        const h = harness();
        await h.page.dataController.savePersonalPreview('a', personal('a', [movie(40, 'Unconfirmed private cache')], []));
        const auth = deferred();
        h.user({ uid: 'a' });
        h.dom.window.firebaseManager.isAuthReady = false;
        h.auth(() => auth.promise);
        const init = h.page.init();
        await flush();
        assert.equal(h.cards().length, 0, 'An unconfirmed cached auth uid cannot reveal a warm personal preview');
        assert.ok(h.element('home-watching-grid').querySelector('.home-skeleton-card'));
        assert.equal(h.favoriteReads.length, 0);
        h.user(null);
        h.dom.window.firebaseManager.isAuthReady = true;
        auth.resolve(null);
        await init;
        assert.ok(h.element('homeSignInBtn'));
        assert.equal(h.cards().length, 0);
        h.dispose();
    }

    // Missing Firebase bootstrap is an unresolved session, not a confirmed guest.
    {
        const h = harness();
        delete h.dom.window.firebaseManager;
        h.page.dataController.firebaseManager = null;
        await h.page.preparePersonalTier();
        assert.equal(h.element('homeSignInBtn'), null);
        assert.equal(h.element('personal-tier').querySelector('.home-skeleton-card'), null);
        assert.equal(h.cards().length, 0);
        assert.equal(await h.page.resolveInitialUser(), undefined);
        assert.equal(h.favoriteReads.length, 0);
        h.dispose();
    }

    // A bookmark mutation during IO invalidates the old generation and refreshes the accepted preview.
    {
        const h = harness();
        h.user({ uid: 'a' });
        const oldNetwork = deferred();
        const newNetwork = deferred();
        let watchingReads = 0;
        h.favorites((uid, status) => status === 'plan_to_watch' ? Promise.resolve([])
            : (++watchingReads === 1 ? oldNetwork.promise : newNetwork.promise));
        const oldTask = h.page.updatePersonalTier({ uid: 'a' });
        await flush();
        const service = new h.context.FavoriteService({ db: {} });
        await service.invalidateBookmarksCache('a');
        h.storageEvent({ home_personal_preview_revision_a: { newValue: h.store.home_personal_preview_revision_a } });
        await flush();
        assert.equal(watchingReads, 2, 'Mutation revision restarts in-memory bookmark reads');
        const newTask = h.page.personalRequest.promise;
        newNetwork.resolve([movie(70, 'After mutation')]);
        await newTask;
        const accepted = h.card(70);
        assert.ok(accepted);
        oldNetwork.resolve([movie(71, 'Old response')]);
        await oldTask;
        assert.equal(h.card(70), accepted);
        assert.ok(!h.card(71));
        assert.equal(h.store.home_personal_preview_v2_a.data.watching[0].movieId, 70, 'An old read cannot restore invalidated storage');
        h.dispose();
    }

    // Delayed local-cache IO obeys the same uid generation guard as a network reply.
    {
        const h = harness();
        await h.page.dataController.savePersonalPreview('a', personal('a', [movie(50, 'Delayed private cache')], []));
        await h.page.dataController.savePersonalPreview('b', personal('b', [movie(60, 'Current cache')], []));
        const aCache = deferred();
        const bNetwork = deferred();
        h.storageRead(async keys => {
            if (keys.includes('home_personal_preview_v2_a')) return aCache.promise;
            return Object.fromEntries(keys.map(key => [key, structuredClone(h.store[key])]));
        });
        h.favorites((uid, status) => status === 'plan_to_watch' ? Promise.resolve([])
            : uid === 'a' ? Promise.resolve([movie(51, 'Superseded network')]) : bNetwork.promise);
        h.user({ uid: 'a' });
        const aTask = h.page.updatePersonalTier({ uid: 'a' });
        await flush();
        h.user({ uid: 'b' });
        const bTask = h.page.updatePersonalTier({ uid: 'b' });
        await flush();
        assert.ok(h.card(60));
        aCache.resolve({ home_personal_preview_v2_a: h.store.home_personal_preview_v2_a });
        await aTask;
        assert.ok(h.card(60));
        assert.ok(!h.card(50));
        assert.ok(h.favoriteReads.every(request => request.uid === 'b'), 'A superseded cache read cannot launch old-user network reads');
        bNetwork.resolve([movie(60, 'Current cache')]);
        await bTask;
        h.dispose();
    }

    // Identity, not matching seed ratings, controls whether an enriched overlay
    // and its parent KP ID can move to a replacement personal card.
    {
        const h = harness();
        const renderer = h.page.renderer;
        const previousItem = { movie: {
            kinopoiskId: 178720, tmdbId: 3000, name: 'Warehouse 13', year: 2009,
            mediaType: 'tv-series', kpRating: 0, imdbRating: 0
        } };
        const previousNode = renderer.createMovieCard(previousItem);
        previousNode.dataset.ratingsState = 'ready';
        previousNode.dataset.movieId = '178720';
        const previousOverlay = previousNode.querySelector('.mc-badges-overlay');
        const entry = { node: previousNode, data: renderer.getMovieCardData(previousItem) };
        const conflictingItem = { movie: {
            ...previousItem.movie, kinopoiskId: 178721
        } };
        const conflictingNode = renderer.createMovieCard(conflictingItem);
        renderer.preservePersonalEnrichment(entry, conflictingNode, renderer.getMovieCardData(conflictingItem));
        assert.notEqual(conflictingNode.querySelector('.mc-badges-overlay'), previousOverlay,
            'A different KP identity must not inherit old ratings or parent ID');
        assert.notEqual(conflictingNode.dataset.movieId, '178720');

        const matchingItem = { movie: { ...previousItem.movie, name: 'Хранилище 13' } };
        const matchingNode = renderer.createMovieCard(matchingItem);
        renderer.preservePersonalEnrichment(entry, matchingNode, renderer.getMovieCardData(matchingItem));
        assert.equal(matchingNode.querySelector('.mc-badges-overlay'), previousOverlay,
            'The same canonical KP identity can retain its already-rendered badges');
        h.dispose();
    }

    console.log('Home personal lifecycle: real renderer/enricher, keyed DOM/focus, skeletons, uid cache and auth/network races passed');
}

const completion = run();
module.exports = completion;
if (require.main === module) completion.catch(error => { console.error(error); process.exitCode = 1; });
