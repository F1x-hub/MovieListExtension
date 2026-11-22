/**
 * Quick actions from the movie-card menu, shared by Search, Ratings and Bookmarks:
 * the four bookmark statuses (favorite, watching, watched, plan to watch) and the
 * collection items. One handler, so a menu button behaves the same on every page.
 *
 * Behaviour:
 * - A film has one status at most. Choosing the shown status removes the bookmark;
 *   choosing another one switches to it.
 * - Guests get a sign-in toast; nothing is written.
 * - The card repaints at once and rolls back when the write fails.
 * - A second click on the same film (or collection item) while a write is in flight is ignored.
 * - Favorites keep their 50-film limit.
 *
 * Pages supply only what differs between them:
 *   getUser()                      signed-in user or null
 *   getMovie(movieId)              film data for a new bookmark (null when unknown)
 *   getStatus(movieId)             optional: the page's own record of the status
 *                                  (defaults to what the card shows)
 *   confirmRemove(movieId)         optional: resolves false to keep the bookmark
 *   onStatusChange(movieId, next, previous, card)   optional, after a saved change
 *   getCollectionService()         CollectionService or null
 *   getCollections()               the page's collection list (its movieIds are kept current)
 *   onCollectionChange(movieId, collectionId, inCollection)   optional, after a saved change
 */
class MovieCardActions {
    static STATUS_BY_ACTION = {
        'toggle-favorite': 'favorite',
        'toggle-watching': 'watching',
        'toggle-watched': 'watched',
        'toggle-watchlist': 'plan_to_watch'
    };

    /** Toast keys under `movie_card.toast.` for each status. */
    static TOAST_PREFIX = {
        favorite: 'favorite',
        watching: 'watching',
        watched: 'watched',
        plan_to_watch: 'watchlist'
    };

    static FAVORITES_LIMIT = 50;

    constructor(options = {}) {
        this.options = options;
        this.pending = new Set();
    }

    /** True for the actions this handler owns. */
    static handles(action) {
        return action === 'toggle-collection' || Object.hasOwn(MovieCardActions.STATUS_BY_ACTION, action);
    }

    /**
     * Handles quick actions inside `root` on click, so they run once per press and
     * work from the keyboard (Enter/Space on a menu item). Returns this handler.
     */
    bind(root) {
        root?.addEventListener('click', event => {
            if (event.button !== 0) return;
            const button = event.target.closest?.('[data-action]');
            if (!button || !root.contains(button)) return;
            if (!MovieCardActions.handles(button.getAttribute('data-action'))) return;
            event.preventDefault();
            event.stopPropagation();
            this.handle(button);
        });
        return this;
    }

    /**
     * Runs the action of a menu button. Returns false when the action is not a
     * quick action, so the page can handle it.
     */
    handle(button) {
        const action = button?.getAttribute?.('data-action');
        if (!MovieCardActions.handles(action)) return false;
        const card = button.closest('.movie-card-component');
        const movieId = button.getAttribute('data-movie-id') || card?.getAttribute('data-movie-id');
        if (!movieId) return true;

        if (action === 'toggle-collection') {
            const collectionId = button.getAttribute('data-collection-id');
            if (collectionId) this.toggleCollection(movieId, collectionId, button);
        } else {
            this.toggleStatus(movieId, MovieCardActions.STATUS_BY_ACTION[action], button);
        }
        return true;
    }

    t(key) {
        return window.i18n?.get(`movie_card.toast.${key}`) || key;
    }

    toast(key, type) {
        if (typeof Utils !== 'undefined') Utils.showToast(this.t(key), type);
    }

    favoriteService() {
        return this.options.favoriteService
            || (typeof firebaseManager !== 'undefined' ? firebaseManager.getFavoriteService() : null);
    }

    currentStatus(movieId, card) {
        const fromPage = this.options.getStatus?.(movieId);
        if (fromPage !== undefined) return fromPage || null;
        return typeof MovieCard !== 'undefined' ? MovieCard.statusFromCard(card) : null;
    }

    paint(card, status) {
        if (card && typeof MovieCard !== 'undefined') MovieCard.setStatusButtons(card, status);
    }

    async toggleStatus(movieId, status, button) {
        const user = this.options.getUser?.();
        if (!user?.uid) {
            this.toast('sign_in', 'warning');
            return;
        }

        const key = `status:${movieId}`;
        if (this.pending.has(key)) return;
        this.pending.add(key);

        const card = button?.closest?.('.movie-card-component') || null;
        try {
            const service = this.favoriteService();
            if (!service) return;

            const previous = this.currentStatus(movieId, card);
            const next = previous === status ? null : status;

            if (next === null && this.options.confirmRemove && !(await this.options.confirmRemove(movieId))) return;

            if (next === 'favorite') {
                const limitReached = await service.isFavoritesLimitReached(user.uid, MovieCardActions.FAVORITES_LIMIT);
                if (limitReached) {
                    this.toast('favorites_limit', 'warning');
                    return;
                }
            }

            const movie = previous === null && next !== null ? this.options.getMovie?.(movieId) : null;
            if (previous === null && next !== null && !movie) {
                console.warn('MovieCardActions: no film data to bookmark', movieId);
                return;
            }

            this.paint(card, next);
            if (next === 'favorite' && button) {
                button.classList.add('animating');
                setTimeout(() => button.classList.remove('animating'), 600);
            }

            try {
                if (next === null) {
                    await service.removeFromFavorites(user.uid, movieId);
                } else if (previous === null) {
                    await service.addToFavorites(user.uid, { ...movie, movieId }, next);
                } else {
                    await service.updateStatus(user.uid, movieId, next);
                }
            } catch (error) {
                console.error('MovieCardActions: status write failed', error);
                this.paint(card, previous);
                this.toast('status_error', 'error');
                return;
            }

            const changed = next ?? previous;
            this.toast(`${MovieCardActions.TOAST_PREFIX[changed]}_${next === null ? 'removed' : 'added'}`, 'success');
            this.options.onStatusChange?.(movieId, next, previous, card);
            window.navigation?.updateCounts?.();
        } finally {
            this.pending.delete(key);
        }
    }

    findCollection(collectionId) {
        return (this.options.getCollections?.() || []).find(collection => collection.id === collectionId) || null;
    }

    async toggleCollection(movieId, collectionId, button) {
        const service = this.options.getCollectionService?.();
        if (!service) return;

        const key = `collection:${movieId}:${collectionId}`;
        if (this.pending.has(key)) return;
        this.pending.add(key);

        try {
            const collection = this.findCollection(collectionId);
            const wasIn = collection
                ? (collection.movieIds || []).some(id => String(id) === String(movieId))
                : button?.getAttribute('data-in-collection') === 'true';

            MovieCard.setCollectionItemState(button, !wasIn);
            try {
                await service.toggleMovieInCollection(collectionId, Number(movieId));
            } catch (error) {
                console.error('MovieCardActions: collection write failed', error);
                MovieCard.setCollectionItemState(button, wasIn);
                this.toast('collection_error', 'error');
                return;
            }

            if (collection) {
                collection.movieIds = (collection.movieIds || []).filter(id => String(id) !== String(movieId));
                if (!wasIn) collection.movieIds.push(Number(movieId));
            }
            this.toast(wasIn ? 'collection_removed' : 'collection_added', 'success');
            this.options.onCollectionChange?.(movieId, collectionId, !wasIn);
        } finally {
            this.pending.delete(key);
        }
    }
}

if (typeof window !== 'undefined') {
    window.MovieCardActions = MovieCardActions;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MovieCardActions };
}
