/**
 * Reaction notifications shown when the user opens an extension page.
 *
 * Firestore cost: the server keeps one inbox document per user
 * (`userNotifications/{uid}`). This module reads it with a single document
 * get at most once per CHECK_INTERVAL_MS across all extension pages (the
 * result is shared through chrome.storage.local), never subscribes to it, and
 * writes only once, when the user dismisses or opens the notification.
 */

export const NOTIFICATION_COLLECTION = 'userNotifications';
export const CHECK_INTERVAL_MS = 10 * 60 * 1000;
export const MAX_VISIBLE_ITEMS = 3;
const STORAGE_PREFIX = 'reactionInbox_';
const ROOT_ID = 'reactionInbox';

/**
 * Milliseconds from a Firestore Timestamp, a serialized timestamp, a Date,
 * a number, or an ISO string. Unknown values are 0.
 * @param {*} value
 * @returns {number}
 */
export function toMillis(value) {
    if (!value) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'object' && Number.isFinite(Number(value.seconds))) {
        return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
}

function safeHttpsUrl(value) {
    const text = String(value ?? '').trim();
    try {
        return new URL(text).protocol === 'https:' ? text : null;
    } catch {
        return null;
    }
}

/**
 * Entries newer than the inbox read stamp, newest first, in a plain
 * serializable shape.
 * @param {Object|null} inbox - userNotifications document data
 * @returns {Array<Object>}
 */
export function getUnreadReactions(inbox) {
    if (!inbox || !Array.isArray(inbox.reactions)) return [];
    const readAt = toMillis(inbox.reactionsReadAt);
    return inbox.reactions
        .map(item => ({
            key: String(item?.key || ''),
            movieId: item?.movieId != null ? String(item.movieId) : null,
            movieName: item?.movieName ? String(item.movieName) : null,
            reactorName: item?.reactorName ? String(item.reactorName) : null,
            reactorPhoto: safeHttpsUrl(item?.reactorPhoto),
            reactions: (Array.isArray(item?.reactions) ? item.reactions : []).slice(0, 3).map(reaction => ({
                emoji: reaction?.emoji ? String(reaction.emoji) : null,
                imageUrl: safeHttpsUrl(reaction?.imageUrl),
                label: String(reaction?.label || reaction?.id || '')
            })),
            createdAt: toMillis(item?.createdAt)
        }))
        .filter(item => item.key && item.createdAt > readAt)
        .sort((a, b) => b.createdAt - a.createdAt);
}

function defaultStorage() {
    const local = typeof chrome !== 'undefined' ? chrome?.storage?.local : null;
    if (!local?.get) return null;
    return {
        get: async key => (await local.get([key]))?.[key] ?? null,
        set: async (key, value) => local.set({ [key]: value }),
        remove: async key => local.remove([key])
    };
}

function defaultMovieUrl(movieId) {
    const path = `src/pages/movie-details/movie-details.html?movieId=${encodeURIComponent(movieId)}`;
    if (typeof chrome !== 'undefined' && chrome?.runtime?.getURL) return chrome.runtime.getURL(path);
    return `../movie-details/movie-details.html?movieId=${encodeURIComponent(movieId)}`;
}

export class ReactionNotificationCenter {
    /**
     * @param {Object} options
     * @param {Object} options.db - Firestore (compat) instance
     * @param {Function} [options.serverTimestamp] - FieldValue.serverTimestamp
     * @param {Object} [options.i18n] - i18n with get(key)
     * @param {Object|null} [options.storage] - async get/set/remove store
     * @param {Document} [options.document]
     * @param {Function} [options.now]
     * @param {Function} [options.movieUrl]
     * @param {Function} [options.navigate]
     */
    constructor({
        db,
        serverTimestamp = () => globalThis.firebase?.firestore?.FieldValue?.serverTimestamp?.(),
        i18n = null,
        storage = defaultStorage(),
        document: doc = globalThis.document,
        now = () => Date.now(),
        movieUrl = defaultMovieUrl,
        navigate = url => { globalThis.location.href = url; }
    } = {}) {
        this.db = db;
        this.serverTimestamp = serverTimestamp;
        this.i18n = i18n;
        this.storage = storage;
        this.document = doc;
        this.now = now;
        this.movieUrl = movieUrl;
        this.navigate = navigate;
        this.checkedUid = null;
    }

    t(key, fallback) {
        const value = this.i18n?.get?.(`reaction_notifications.${key}`);
        return value && value !== `reaction_notifications.${key}` ? value : fallback;
    }

    storageKey(uid) {
        return `${STORAGE_PREFIX}${uid}`;
    }

    /**
     * Show unread reactions for the signed-in user. Runs once per page and
     * reads Firestore at most once per CHECK_INTERVAL_MS for all pages.
     * @param {string} uid
     * @returns {Promise<Array<Object>>} The unread entries shown
     */
    async checkOnOpen(uid) {
        const userId = String(uid || '').trim();
        if (!userId || userId.includes('/') || this.checkedUid === userId) return [];
        this.checkedUid = userId;

        let unread;
        const cached = await this.readCache(userId);
        if (cached && this.now() - Number(cached.checkedAt || 0) < CHECK_INTERVAL_MS) {
            unread = Array.isArray(cached.unread) ? cached.unread : [];
        } else {
            // Claim the interval before the network read so pages opened at
            // the same time do not each read the inbox.
            await this.writeCache(userId, { checkedAt: this.now(), unread: [] });
            try {
                const snapshot = await this.db.collection(NOTIFICATION_COLLECTION).doc(userId).get();
                unread = snapshot?.exists ? getUnreadReactions(snapshot.data()) : [];
            } catch (error) {
                console.warn('[ReactionNotifications] Inbox read failed:', error?.message || error);
                return [];
            }
            await this.writeCache(userId, { checkedAt: this.now(), unread });
        }

        if (unread.length > 0) this.render(userId, unread);
        return unread;
    }

    /**
     * Stamp the inbox as read (one write) and hide the card on every page.
     * @param {string} uid
     */
    async markRead(uid) {
        this.removeCard();
        await this.writeCache(uid, { checkedAt: this.now(), unread: [] });
        try {
            await this.db.collection(NOTIFICATION_COLLECTION).doc(uid).update({
                reactionsReadAt: this.serverTimestamp()
            });
        } catch (error) {
            console.warn('[ReactionNotifications] Mark-read failed:', error?.message || error);
        }
    }

    async readCache(uid) {
        try {
            return await this.storage?.get(this.storageKey(uid));
        } catch {
            return null;
        }
    }

    async writeCache(uid, value) {
        try {
            await this.storage?.set(this.storageKey(uid), value);
        } catch {
            // Storage is an optimization; Firestore stays the source of truth.
        }
    }

    removeCard() {
        this.document?.getElementById?.(ROOT_ID)?.remove();
    }

    render(uid, unread) {
        const doc = this.document;
        if (!doc?.body) return;
        this.removeCard();

        const root = doc.createElement('section');
        root.id = ROOT_ID;
        root.className = 'reaction-inbox';
        root.setAttribute('role', 'status');
        root.setAttribute('aria-live', 'polite');

        const header = doc.createElement('div');
        header.className = 'reaction-inbox__header';
        const title = doc.createElement('h2');
        title.className = 'reaction-inbox__title';
        title.textContent = this.t('title', 'Новые реакции');
        const close = doc.createElement('button');
        close.type = 'button';
        close.className = 'reaction-inbox__close';
        close.setAttribute('aria-label', this.t('close', 'Закрыть'));
        close.textContent = '×';
        close.addEventListener('click', () => { this.markRead(uid); });
        header.append(title, close);
        root.append(header);

        const list = doc.createElement('ul');
        list.className = 'reaction-inbox__list';
        unread.slice(0, MAX_VISIBLE_ITEMS).forEach(item => list.append(this.renderItem(uid, item)));
        root.append(list);

        const hidden = unread.length - MAX_VISIBLE_ITEMS;
        if (hidden > 0) {
            const more = doc.createElement('p');
            more.className = 'reaction-inbox__more';
            more.textContent = this.t('more', 'Ещё {count}').replace('{count}', String(hidden));
            root.append(more);
        }

        doc.body.append(root);
    }

    renderItem(uid, item) {
        const doc = this.document;
        const li = doc.createElement('li');
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'reaction-inbox__item';
        button.disabled = !item.movieId;

        const avatar = doc.createElement('span');
        avatar.className = 'reaction-inbox__avatar';
        const name = item.reactorName || this.t('unknown_user', 'Кто-то');
        if (item.reactorPhoto) {
            const img = doc.createElement('img');
            img.src = item.reactorPhoto;
            img.alt = '';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            avatar.append(img);
        } else {
            avatar.textContent = name.charAt(0).toUpperCase();
        }

        const text = doc.createElement('span');
        text.className = 'reaction-inbox__text';
        const who = doc.createElement('strong');
        who.textContent = name;
        const what = doc.createElement('span');
        what.className = 'reaction-inbox__movie';
        what.textContent = `${this.t('reacted', 'отреагировал(а) на вашу оценку')} «${item.movieName || this.t('unknown_movie', 'фильма')}»`;
        text.append(who, ' ', what);

        const reactions = doc.createElement('span');
        reactions.className = 'reaction-inbox__reactions';
        item.reactions.forEach(reaction => {
            if (reaction.imageUrl) {
                const img = doc.createElement('img');
                img.src = reaction.imageUrl;
                img.alt = reaction.label;
                img.title = reaction.label;
                reactions.append(img);
            } else if (reaction.emoji) {
                const span = doc.createElement('span');
                span.textContent = reaction.emoji;
                span.title = reaction.label;
                reactions.append(span);
            }
        });

        button.append(avatar, text, reactions);
        button.addEventListener('click', async () => {
            await this.markRead(uid);
            if (item.movieId) this.navigate(this.movieUrl(item.movieId));
        });
        li.append(button);
        return li;
    }
}
