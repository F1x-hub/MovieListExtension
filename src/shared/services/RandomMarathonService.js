/**
 * Shared Firestore owner for the authenticated Random-page movie marathon.
 *
 * The personal randomPool remains device-local. Marathon data is a single
 * current round with item documents. Reads and live subscriptions stay in
 * Firestore; all mutations go through the server-owned randomMarathon action.
 */
class RandomMarathonService {
    static get collectionName() {
        return 'randomMarathons';
    }

    static get documentId() {
        return 'current';
    }

    static get maxMoviesPerUser() {
        return 3;
    }

    static get mutationUrl() {
        return 'https://us-central1-movielistdb-13208.cloudfunctions.net/randomMarathon';
    }

    constructor(firebaseManager = globalThis.firebaseManager) {
        this.firebaseManager = firebaseManager;
        this.db = firebaseManager?.db || null;
        this.currentUser = firebaseManager?.getCurrentUser?.() || null;
        this._userProfileCache = new Map();
    }

    _getCurrentUser() {
        const getCurrentUser = this.firebaseManager?.getCurrentUser;
        const resolvedUser = typeof getCurrentUser === 'function' ? getCurrentUser.call(this.firebaseManager) : this.currentUser;
        if ((resolvedUser?.uid || null) !== (this.currentUser?.uid || null)) {
            this._userProfileCache.clear();
        }
        this.currentUser = resolvedUser || null;
        if (!this.currentUser?.uid) throw new Error('Для участия в киномарафоне войдите в аккаунт');
        return this.currentUser;
    }

    async _callMutation(action, payload = {}) {
        const user = this._getCurrentUser();
        if (typeof user.getIdToken !== 'function') throw new Error('Не удалось подтвердить аккаунт');
        const token = await user.getIdToken();
        const response = await fetch(RandomMarathonService.mutationUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action, ...payload })
        });
        let result;
        try {
            result = await response.json();
        } catch {
            result = null;
        }
        if (!response.ok) {
            const error = new Error(result?.error || 'Не удалось выполнить действие марафона');
            error.code = result?.code || (response.status === 403 ? 'permission-denied' : 'random_marathon_failed');
            throw error;
        }
        return result;
    }

    _getRoundRef() {
        if (!this.db) throw new Error('Firebase не готов');
        return this.db.collection(RandomMarathonService.collectionName).doc(RandomMarathonService.documentId);
    }

    _getItemsRef() {
        return this._getRoundRef().collection('items');
    }

    async _getUserProfile(userId) {
        if (!userId || !this.db) return null;
        const cached = this._userProfileCache.get(userId);
        if (cached && cached.expiresAt > Date.now()) return cached.promise;
        const cacheEntry = { expiresAt: Date.now() + 30000, promise: null };
        cacheEntry.promise = this.db.collection('users').doc(userId).get()
            .then((snapshot) => snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null)
            .catch(() => {
                if (this._userProfileCache.get(userId) === cacheEntry) this._userProfileCache.delete(userId);
                return null;
            });
        this._userProfileCache.set(userId, cacheEntry);
        return cacheEntry.promise;
    }

    _getDisplayName(profile, fallbackUser = null) {
        if (typeof Utils !== 'undefined' && typeof Utils.getDisplayName === 'function') {
            const displayName = Utils.getDisplayName(profile, fallbackUser);
            if (displayName && displayName !== 'Unknown User') return displayName;
        }
        return profile?.displayName || fallbackUser?.displayName || fallbackUser?.email || 'Участник';
    }

    async _decorateItems(items) {
        const userIds = [...new Set(items.map((item) => item.addedBy).filter(Boolean))];
        const profiles = await Promise.all(userIds.map(async (userId) => [userId, await this._getUserProfile(userId)]));
        const profileByUserId = new Map(profiles);
        return items.map((item) => {
            const fallbackName = item.addedByName || item.addedBy || 'Участник';
            const profile = profileByUserId.get(item.addedBy);
            return {
                ...item,
                addedByName: this._getDisplayName(profile, { displayName: fallbackName })
            };
        });
    }

    async isAdmin() {
        const user = this._getCurrentUser();
        const profile = await this._getUserProfile(user.uid);
        return profile?.isAdmin === true;
    }

    async getCurrent() {
        const snapshot = await this._getRoundRef().get();
        if (!snapshot.exists) return { round: null, items: [] };
        const round = { id: snapshot.id, ...snapshot.data() };
        const itemsSnapshot = await this._getItemsRef().where('roundId', '==', round.roundId).get();
        const rawItems = itemsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const items = (await this._decorateItems(rawItems))
            .sort((a, b) => this._toMillis(a.addedAt) - this._toMillis(b.addedAt));
        return { round, items };
    }

    async _stateFromMutation(result) {
        if (!result || !Array.isArray(result.items)) return this.getCurrent();
        const round = result.round ? { ...result.round } : null;
        const items = await this._decorateItems(result.items.map((item) => ({ ...item })));
        items.sort((a, b) => this._toMillis(a.addedAt) - this._toMillis(b.addedAt));
        return { round, items };
    }

    subscribe(onChange, onError) {
        const roundRef = this._getRoundRef();
        let itemsUnsubscribe = null;
        let latestRound = null;
        let active = true;
        let generation = 0;

        const unsubscribeRound = roundRef.onSnapshot((snapshot) => {
            if (!active) return;
            const roundGeneration = ++generation;
            if (itemsUnsubscribe) {
                itemsUnsubscribe();
                itemsUnsubscribe = null;
            }
            latestRound = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
            const roundForSubscription = latestRound;
            if (!roundForSubscription) {
                onChange({ round: null, items: [] });
                return;
            }

            itemsUnsubscribe = this._getItemsRef().where('roundId', '==', roundForSubscription.roundId)
                .onSnapshot((itemsSnapshot) => {
                    if (!active || roundGeneration !== generation) return;
                    const rawItems = itemsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
                    this._decorateItems(rawItems).then((items) => {
                        items.sort((a, b) => this._toMillis(a.addedAt) - this._toMillis(b.addedAt));
                        if (!active || roundGeneration !== generation || latestRound !== roundForSubscription) return;
                        onChange({ round: roundForSubscription, items });
                    }).catch((error) => {
                        if (active && roundGeneration === generation) onError?.(error);
                    });
                }, (error) => {
                    if (active && roundGeneration === generation) onError?.(error);
                });
        }, (error) => {
            if (active) onError?.(error);
        });

        return () => {
            active = false;
            generation += 1;
            latestRound = null;
            unsubscribeRound();
            if (itemsUnsubscribe) itemsUnsubscribe();
            itemsUnsubscribe = null;
        };
    }

    async createRound() {
        return this._stateFromMutation(await this._callMutation('create'));
    }

    async addMovie(movie) {
        const entry = RandomPoolService.createEntry(movie);
        if (!entry) throw new Error('У фильма нет корректного идентификатора Кинопоиска');
        return this._stateFromMutation(await this._callMutation('add', { movie: entry }));
    }

    async removeMovie(itemId) {
        return this._stateFromMutation(await this._callMutation('remove', { itemId }));
    }

    async startRound() {
        return this._stateFromMutation(await this._callMutation('start'));
    }

    async rollNext() {
        return this._stateFromMutation(await this._callMutation('roll'));
    }

    async resolveCurrent(resolution = 'watched', expectedRoundId = null, expectedItemId = null) {
        if (!['watched', 'removed'].includes(resolution)) throw new Error('Неизвестный результат фильма');
        if (!Number.isInteger(Number(expectedRoundId)) || Number(expectedRoundId) <= 0 || !String(expectedItemId || '').trim()) {
            const error = new Error('Текущий фильм уже изменился');
            error.code = 'CURRENT_MOVIE_STALE';
            throw error;
        }
        return this._stateFromMutation(await this._callMutation('resolve', {
            resolution,
            expectedRoundId: Number(expectedRoundId),
            expectedItemId: String(expectedItemId).trim(),
        }));
    }

    _toMillis(value) {
        if (!value) return 0;
        if (typeof value.toMillis === 'function') return value.toMillis();
        const seconds = value.seconds ?? value._seconds;
        if (seconds) return seconds * 1000;
        return new Date(value).getTime() || 0;
    }
}

if (typeof globalThis !== 'undefined') globalThis.RandomMarathonService = RandomMarathonService;
