// Card menu quick actions: one shared handler for Search, Ratings and Bookmarks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.chrome = { runtime: { getURL: p => `chrome-extension://test/${p}` } };
const toasts = [];
global.Utils = {
    extractKinopoiskId: value => value?.kinopoiskId || value?.movie?.kinopoiskId || null,
    normalizeRatingComment: value => value || '',
    showToast: (message, type) => toasts.push([message, type])
};
window.i18n = { get: key => key };
let countRefreshes = 0;
window.navigation = { updateCounts: () => { countRefreshes += 1; } };

const { MovieCard } = require('../src/shared/components/MovieCard.js');
global.MovieCard = MovieCard;
const { MovieCardActions } = require('../src/shared/components/MovieCardActions.js');

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const ACTIONS = ['toggle-favorite', 'toggle-watching', 'toggle-watched', 'toggle-watchlist'];
const SVG_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle></svg>';

function makeCard(status = null, { collections = [], inCollections = [] } = {}) {
    document.body.innerHTML = '';
    const card = MovieCard.create({
        movie: { kinopoiskId: 101, name: 'Film' },
        isFavorite: status === 'favorite',
        isWatching: status === 'watching',
        isWatched: status === 'watched',
        isInWatchlist: status === 'plan_to_watch'
    }, {
        showFavorite: true,
        showWatching: true,
        showWatched: true,
        showWatchlist: true,
        availableCollections: collections,
        movieCollections: inCollections
    });
    document.body.append(card);
    return card;
}

function makeService({ fail = false, limit = false } = {}) {
    const calls = [];
    let release = null;
    const write = name => async (...args) => {
        calls.push([name, ...args]);
        if (release) await release;
        if (fail) throw new Error('offline');
        return true;
    };
    return {
        calls,
        hold() { let open; release = new Promise(resolve => { open = resolve; }); return () => { release = null; open(); }; },
        isFavoritesLimitReached: async () => limit,
        addToFavorites: write('add'),
        updateStatus: write('update'),
        removeFromFavorites: write('remove')
    };
}

const activeStates = card => ACTIONS.map(action => {
    const button = card.querySelector(`[data-action="${action}"]`);
    return [...button.attributes].find(attr => attr.name.startsWith('data-is-')).value;
});
const button = (card, action) => card.querySelector(`[data-action="${action}"]`);
const user = { uid: 'user-a' };
const movie = { kinopoiskId: 101, name: 'Film' };

(async () => {
    // The rendered menu and the repaint agree, and the card reports its status.
    {
        const card = makeCard('watching');
        assert.equal(MovieCard.statusFromCard(card), 'watching');
        assert.match(button(card, 'toggle-watching').getAttribute('style') || '', /background-color/);
        MovieCard.setStatusButtons(card, 'favorite');
        assert.deepEqual(activeStates(card), ['true', 'false', 'false', 'false'], 'one status at a time');
        assert.equal(button(card, 'toggle-watching').style.backgroundColor, '', 'old highlight cleared');
        assert.ok(button(card, 'toggle-favorite').style.backgroundColor, 'new highlight painted');
        assert.equal(button(card, 'toggle-favorite').querySelector('.mc-menu-item-text').textContent, 'movie_card.remove_favorite');
        const iconNames = () => ['favorite', 'watching', 'watched', 'watchlist']
            .map(status => button(card, `toggle-${status}`).querySelector('svg').dataset.icon);
        assert.deepEqual(iconNames(), ['HEART_FILLED', 'EYE', 'WATCHED', 'BOOKMARK'], 'only the active status is drawn solid');
        MovieCard.setStatusButtons(card, null);
        assert.deepEqual(iconNames(), ['HEART', 'EYE', 'WATCHED', 'BOOKMARK'], 'no status, no solid icon');
        assert.equal(MovieCard.statusFromCard(card), null);
    }

    // Guests get a sign-in toast and nothing is written.
    {
        const card = makeCard();
        const service = makeService();
        toasts.length = 0;
        const actions = new MovieCardActions({ getUser: () => null, getMovie: () => movie, favoriteService: service });
        assert.equal(actions.handle(button(card, 'toggle-favorite')), true);
        await flush();
        assert.deepEqual(service.calls, []);
        assert.deepEqual(toasts, [['movie_card.toast.sign_in', 'warning']]);
    }

    // No bookmark yet: create it from the page's film data.
    {
        const card = makeCard();
        const service = makeService();
        const changes = [];
        toasts.length = 0;
        countRefreshes = 0;
        const actions = new MovieCardActions({
            getUser: () => user,
            getMovie: () => movie,
            favoriteService: service,
            onStatusChange: (id, next, previous) => changes.push([id, next, previous])
        });
        await actions.toggleStatus('101', 'watching', button(card, 'toggle-watching'));
        assert.deepEqual(service.calls, [['add', 'user-a', { ...movie, movieId: '101' }, 'watching']]);
        assert.deepEqual(activeStates(card), ['false', 'true', 'false', 'false']);
        assert.deepEqual(changes, [['101', 'watching', null]]);
        assert.deepEqual(toasts, [['movie_card.toast.watching_added', 'success']]);
        assert.equal(countRefreshes, 1, 'navigation counters refresh after a change');
    }

    // Another status: switch the existing bookmark; every other item turns off.
    {
        const card = makeCard('watching');
        const service = makeService();
        toasts.length = 0;
        const actions = new MovieCardActions({ getUser: () => user, getMovie: () => movie, favoriteService: service });
        await actions.toggleStatus('101', 'plan_to_watch', button(card, 'toggle-watchlist'));
        assert.deepEqual(service.calls, [['update', 'user-a', '101', 'plan_to_watch']]);
        assert.deepEqual(activeStates(card), ['false', 'false', 'false', 'true']);
        assert.deepEqual(toasts, [['movie_card.toast.watchlist_added', 'success']]);
    }

    // The shown status: remove the bookmark, after the page's confirmation if it asks.
    {
        const card = makeCard('watched');
        const service = makeService();
        let answer = false;
        const actions = new MovieCardActions({
            getUser: () => user,
            favoriteService: service,
            confirmRemove: async () => answer
        });
        await actions.toggleStatus('101', 'watched', button(card, 'toggle-watched'));
        assert.deepEqual(service.calls, [], 'declined confirmation keeps the bookmark');
        assert.equal(MovieCard.statusFromCard(card), 'watched');
        answer = true;
        toasts.length = 0;
        await actions.toggleStatus('101', 'watched', button(card, 'toggle-watched'));
        assert.deepEqual(service.calls, [['remove', 'user-a', '101']]);
        assert.equal(MovieCard.statusFromCard(card), null);
        assert.deepEqual(toasts, [['movie_card.toast.watched_removed', 'success']]);
    }

    // The page's own record wins over a stale card.
    {
        const card = makeCard('favorite');
        const service = makeService();
        const actions = new MovieCardActions({ getUser: () => user, getMovie: () => movie, getStatus: () => null, favoriteService: service });
        await actions.toggleStatus('101', 'favorite', button(card, 'toggle-favorite'));
        assert.equal(service.calls[0][0], 'add', 'getStatus says there is no bookmark yet');
    }

    // A failed write rolls the card back and says so.
    {
        const card = makeCard('watching');
        const service = makeService({ fail: true });
        const changes = [];
        toasts.length = 0;
        const actions = new MovieCardActions({
            getUser: () => user,
            favoriteService: service,
            onStatusChange: () => changes.push('changed')
        });
        const error = console.error;
        console.error = () => {};
        await actions.toggleStatus('101', 'watched', button(card, 'toggle-watched'));
        console.error = error;
        assert.equal(MovieCard.statusFromCard(card), 'watching', 'rolled back');
        assert.deepEqual(changes, []);
        assert.deepEqual(toasts, [['movie_card.toast.status_error', 'error']]);
    }

    // Favorites keep their limit on every page.
    {
        const card = makeCard();
        const service = makeService({ limit: true });
        toasts.length = 0;
        const actions = new MovieCardActions({ getUser: () => user, getMovie: () => movie, favoriteService: service });
        await actions.toggleStatus('101', 'favorite', button(card, 'toggle-favorite'));
        assert.deepEqual(service.calls, []);
        assert.equal(MovieCard.statusFromCard(card), null);
        assert.deepEqual(toasts, [['movie_card.toast.favorites_limit', 'warning']]);
    }

    // Without film data there is nothing to bookmark.
    {
        const card = makeCard();
        const service = makeService();
        const actions = new MovieCardActions({ getUser: () => user, getMovie: () => null, favoriteService: service });
        const warn = console.warn;
        console.warn = () => {};
        await actions.toggleStatus('101', 'watching', button(card, 'toggle-watching'));
        console.warn = warn;
        assert.deepEqual(service.calls, []);
        assert.equal(MovieCard.statusFromCard(card), null);
    }

    // A second press while the write is in flight is ignored.
    {
        const card = makeCard();
        const service = makeService();
        const open = service.hold();
        const actions = new MovieCardActions({ getUser: () => user, getMovie: () => movie, favoriteService: service });
        const first = actions.toggleStatus('101', 'watching', button(card, 'toggle-watching'));
        await flush();
        await actions.toggleStatus('101', 'watched', button(card, 'toggle-watched'));
        open();
        await first;
        assert.equal(service.calls.length, 1, 'one write per film at a time');
    }

    // Collections: optimistic check, the page's list kept current, rollback on failure.
    // An SVG collection icon must not read as the check mark (the old copies did that).
    {
        const collections = [{ id: 'c1', name: 'Подборка <b>', icon: 'x', movieIds: [] }];
        const card = makeCard(null, { collections });
        const item = card.querySelector('[data-action="toggle-collection"]');
        item.querySelector('.mc-menu-item-icon').innerHTML = SVG_ICON;
        assert.equal(item.getAttribute('data-in-collection'), 'false');
        assert.ok(!item.innerHTML.includes('<b>'), 'collection names are escaped');

        const toggled = [];
        const changes = [];
        const service = { toggleMovieInCollection: async (...args) => { toggled.push(args); } };
        toasts.length = 0;
        const actions = new MovieCardActions({
            getCollectionService: () => service,
            getCollections: () => collections,
            onCollectionChange: (...args) => changes.push(args)
        });
        assert.equal(actions.handle(item), true);
        await flush();
        assert.deepEqual(toggled, [['c1', 101]]);
        assert.equal(item.getAttribute('data-in-collection'), 'true');
        assert.ok(item.querySelector('.mc-collection-check'));
        assert.ok(item.querySelector('.mc-menu-item-icon svg'), 'the collection icon stays');
        assert.deepEqual(collections[0].movieIds, [101]);
        assert.deepEqual(changes, [['101', 'c1', true]]);
        assert.deepEqual(toasts, [['movie_card.toast.collection_added', 'success']]);

        service.toggleMovieInCollection = async () => { throw new Error('offline'); };
        toasts.length = 0;
        const error = console.error;
        console.error = () => {};
        await actions.toggleCollection('101', 'c1', item);
        console.error = error;
        assert.equal(item.getAttribute('data-in-collection'), 'true', 'rolled back to checked');
        assert.ok(item.querySelector('.mc-collection-check'));
        assert.deepEqual(collections[0].movieIds, [101]);
        assert.deepEqual(toasts, [['movie_card.toast.collection_error', 'error']]);

        service.toggleMovieInCollection = async () => {};
        await actions.toggleCollection('101', 'c1', item);
        assert.equal(item.getAttribute('data-in-collection'), 'false');
        assert.equal(item.querySelector('.mc-collection-check'), null);
        assert.deepEqual(collections[0].movieIds, []);
    }

    // bind(): clicks (mouse or Enter/Space on the item) run quick actions; other actions pass.
    {
        const card = makeCard();
        const service = makeService();
        const actions = new MovieCardActions({ getUser: () => user, getMovie: () => movie, favoriteService: service });
        actions.bind(document.body);
        const passed = [];
        document.addEventListener('click', event => passed.push(event.target.closest('[data-action]')?.getAttribute('data-action')));
        button(card, 'toggle-watched').click();
        await flush();
        assert.deepEqual(service.calls.map(call => call[0]), ['add']);
        assert.deepEqual(passed, [], 'a handled quick action stops there');
        assert.equal(MovieCardActions.handles('open-review'), false);
        assert.equal(MovieCardActions.handles('edit-rating'), false);
        assert.equal(MovieCardActions.handles('toggle-collection'), true);
    }

    // Search, Ratings and Bookmarks use this handler and keep no copies of it.
    {
        for (const page of ['search', 'ratings', 'bookmarks']) {
            const source = read(`src/pages/${page}/${page}.js`);
            const html = read(`src/pages/${page}/${page}.html`);
            assert.match(source, /new MovieCardActions\(/, `${page} uses the shared handler`);
            for (const copy of ['toggleFavorite(', 'handleWatchingToggle(', 'handleWatchedToggle(', 'handleWatchlistToggle(',
                'handleToggleCollection(', 'handleToggleAction(', 'handleStatusChange(', 'runStatusAction(', 'refreshCardButtons(']) {
                assert.ok(!source.includes(copy), `${page} keeps no copy: ${copy}`);
            }
            const shared = html.indexOf('shared/components/MovieCardActions.js');
            assert.ok(shared > html.indexOf('shared/components/MovieCard.js'), `${page}.html loads the handler after MovieCard`);
            assert.ok(shared < html.indexOf(`src="${page}.js"`), `${page}.html loads the handler before the page`);
        }
    }

    // Toast texts exist in both languages.
    {
        const { locales } = await import('../src/shared/i18n/locales.js');
        const keys = Object.keys(locales.en.movie_card.toast).sort();
        assert.deepEqual(Object.keys(locales.ru.movie_card.toast).sort(), keys);
        const used = new Set(['sign_in', 'favorites_limit', 'status_error', 'collection_added', 'collection_removed', 'collection_error']);
        for (const prefix of Object.values(MovieCardActions.TOAST_PREFIX)) {
            used.add(`${prefix}_added`);
            used.add(`${prefix}_removed`);
        }
        assert.deepEqual([...used].sort(), keys, 'every toast key is used and none is missing');
        for (const key of ['removed', 'remove_error']) {
            assert.ok(locales.en.bookmarks.toast[key] && locales.ru.bookmarks.toast[key], `bookmarks.toast.${key}`);
        }
    }

    console.log('Movie card quick actions passed: one shared handler on Search, Ratings and Bookmarks; one status at a time, guest toast, rollback, favorites limit, in-flight guard, collections and locales.');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
