/**
 * Comment reactions are intentionally kept outside the ratings documents.
 * The ratings collection is also the source for movie aggregates, so storing
 * reactions there would trigger an unnecessary aggregate recalculation.
 */
const DEFAULT_REACTION_DEFINITIONS = Object.freeze([
    Object.freeze({ id: 'like', emoji: '👍', label: 'Like' }),
    Object.freeze({ id: 'love', emoji: '❤️', label: 'Love' }),
    Object.freeze({ id: 'laugh', emoji: '😂', label: 'Funny' }),
    Object.freeze({ id: 'wow', emoji: '😮', label: 'Wow' }),
    Object.freeze({ id: 'sad', emoji: '😢', label: 'Sad' }),
    Object.freeze({ id: 'fire', emoji: '🔥', label: 'Fire' }),
    Object.freeze({ id: 'clap', emoji: '👏', label: 'Applause' }),
    Object.freeze({ id: 'rocket', emoji: '🚀', label: 'Great' }),
    Object.freeze({ id: 'party', emoji: '🎉', label: 'Celebration' }),
    Object.freeze({ id: 'thinking', emoji: '🤔', label: 'Thinking' }),
    Object.freeze({ id: 'eyes', emoji: '👀', label: 'Interesting' }),
    Object.freeze({ id: 'hundred', emoji: '💯', label: 'Perfect' })
]);
const COMMENT_REACTION_TYPES = Object.freeze(DEFAULT_REACTION_DEFINITIONS.map(({ id }) => id));
const MAX_REACTIONS_PER_USER = 3;
const MAX_REACTION_CATALOG_SIZE = 24;
const MAX_REACTION_ASSET_SIZE = 256 * 1024;
const REACTION_ASSET_CONTENT_TYPES = Object.freeze(['image/png', 'image/webp', 'image/gif']);
const COMMENT_REACTION_CONFIG_COLLECTION = 'settings';
const COMMENT_REACTION_CONFIG_ID = 'commentReactions';
const REACTION_ASSET_PATH_PREFIX = 'comment_reaction_assets/';
const REACTION_ASSET_BUCKET = 'movielistdb-13208.firebasestorage.app';
const REACTION_ASSET_API_HOST = 'firebasestorage.googleapis.com';

const COMMENT_REACTION_META = Object.freeze(DEFAULT_REACTION_DEFINITIONS.reduce((meta, definition) => {
    meta[definition.id] = { emoji: definition.emoji, label: definition.label };
    return meta;
}, {}));

function normalizeReactionId(value) {
    const normalized = String(value ?? '').trim();
    return normalized && !normalized.includes('/') ? normalized : null;
}

function normalizeMovieId(value) {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric > 0) return numeric;

    const normalized = String(value ?? '').trim();
    return normalized || null;
}

function normalizeReactionKey(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return /^[a-z0-9](?:[a-z0-9_-]{0,47})$/.test(normalized) ? normalized : null;
}

function normalizeReactionShortcode(value) {
    const normalized = String(value ?? '').trim();
    return /^:[a-z0-9](?:[a-z0-9_-]{0,29}):$/i.test(normalized) ? normalized : null;
}

function normalizeReactionAssetPath(value) {
    const normalized = String(value ?? '').trim();
    return normalized.startsWith(REACTION_ASSET_PATH_PREFIX)
        && !normalized.includes('..')
        && !normalized.includes('\\')
        ? normalized
        : null;
}

function normalizeReactionImageUrl(value) {
    const candidate = String(value ?? '').trim();
    if (!candidate || typeof URL === 'undefined') return null;

    try {
        const parsed = new URL(candidate);
        const expectedPathPrefix = `/v0/b/${REACTION_ASSET_BUCKET}/o/`;
        if (parsed.protocol !== 'https:'
            || parsed.hostname !== REACTION_ASSET_API_HOST
            || !parsed.pathname.startsWith(expectedPathPrefix)) {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

function normalizeReactionType(value, allowedTypes = COMMENT_REACTION_TYPES) {
    const normalized = normalizeReactionKey(value);
    return normalized && allowedTypes.includes(normalized) ? normalized : null;
}

function normalizeReactionTypes(value, allowedTypes = COMMENT_REACTION_TYPES) {
    const values = Array.isArray(value) ? value : [value];
    return [...new Set(values.map((item) => normalizeReactionType(item, allowedTypes)).filter(Boolean))]
        .slice(0, MAX_REACTIONS_PER_USER);
}

function createEmptyReactionCounts() {
    return COMMENT_REACTION_TYPES.reduce((counts, type) => {
        counts[type] = 0;
        return counts;
    }, {});
}

function normalizeReactionSummary(data = {}, ratingId = '', movieId = '', allowedTypes = COMMENT_REACTION_TYPES) {
    const counts = createEmptyReactionCounts();
    const sourceCounts = data?.counts && typeof data.counts === 'object' ? data.counts : {};

    allowedTypes.forEach((type) => {
        const count = Number(sourceCounts[type]);
        counts[type] = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    });

    const rawOrder = Array.isArray(data?.order) ? data.order : [];
    const seenOrder = new Set();
    const order = rawOrder
        .map((type) => normalizeReactionKey(type))
        .filter((type) => {
            if (!type || !allowedTypes.includes(type) || counts[type] <= 0 || seenOrder.has(type)) {
                return false;
            }
            seenOrder.add(type);
            return true;
        });

    allowedTypes.forEach((type) => {
        if (counts[type] > 0 && !seenOrder.has(type)) {
            order.push(type);
            seenOrder.add(type);
        }
    });

    return {
        ratingId: normalizeReactionId(data?.ratingId || ratingId) || String(ratingId || ''),
        movieId: data?.movieId ?? movieId,
        counts,
        order,
        total: Object.values(counts).reduce((sum, count) => sum + count, 0)
    };
}

function normalizeReactionDefinition(definition) {
    const id = normalizeReactionKey(definition?.id);
    const emoji = String(definition?.emoji ?? '').trim();
    const label = String(definition?.label ?? '').trim();
    if (!id || !emoji || !label || emoji.length > 32 || label.length > 64) return null;

    const imageUrl = definition?.renderType === 'image'
        ? normalizeReactionImageUrl(definition.imageUrl)
        : null;
    const storagePath = imageUrl ? normalizeReactionAssetPath(definition.storagePath) : null;
    const shortcode = imageUrl ? normalizeReactionShortcode(definition.shortcode || emoji) : null;
    if (imageUrl && (!shortcode || !storagePath)) return null;

    return imageUrl
        ? { id, emoji: shortcode, label, renderType: 'image', shortcode, imageUrl, storagePath }
        : { id, emoji, label, renderType: 'unicode' };
}

function createDefaultReactionConfig() {
    return {
        schemaVersion: 1,
        reactions: DEFAULT_REACTION_DEFINITIONS.map((definition) => ({ ...definition })),
        maxReactionsPerUser: MAX_REACTIONS_PER_USER,
        updatedAt: null,
        updatedBy: null
    };
}

function normalizeReactionConfig(data = {}) {
    const sourceReactions = Array.isArray(data?.reactions)
        ? data.reactions
        : DEFAULT_REACTION_DEFINITIONS;
    const seenIds = new Set();
    const seenEmojis = new Set();
    const reactions = sourceReactions
        .map(normalizeReactionDefinition)
        .filter((reaction) => {
            if (!reaction || seenIds.has(reaction.id) || seenEmojis.has(reaction.emoji)) return false;
            seenIds.add(reaction.id);
            seenEmojis.add(reaction.emoji);
            return true;
        })
        .slice(0, MAX_REACTION_CATALOG_SIZE);

    if (reactions.length === 0) return createDefaultReactionConfig();

    return {
        schemaVersion: Number(data?.schemaVersion) || 1,
        reactions,
        maxReactionsPerUser: MAX_REACTIONS_PER_USER,
        updatedAt: data?.updatedAt || null,
        updatedBy: String(data?.updatedBy || '').trim() || null
    };
}

function getReactionMetaFromConfig(config) {
    return config.reactions.reduce((meta, definition) => {
        meta[definition.id] = {
            emoji: definition.emoji,
            label: definition.label,
            renderType: definition.renderType,
            imageUrl: definition.imageUrl || null,
            shortcode: definition.shortcode || null
        };
        return meta;
    }, {});
}

function applyReactionConfig(config) {
    const normalizedConfig = normalizeReactionConfig(config);
    const types = Object.freeze(normalizedConfig.reactions.map(({ id }) => id));
    const meta = Object.freeze(getReactionMetaFromConfig(normalizedConfig));
    globalThis.CommentReactionTypes = types;
    globalThis.CommentReactionMeta = meta;
    globalThis.CommentReactionConfig = normalizedConfig;

    if (typeof window !== 'undefined'
        && typeof window.dispatchEvent === 'function'
        && typeof window.CustomEvent === 'function') {
        window.dispatchEvent(new window.CustomEvent('commentReactionConfigChanged', {
            detail: normalizedConfig
        }));
    }
    return normalizedConfig;
}

class CommentReactionService {
    constructor(firebaseManager) {
        this.firebaseManager = firebaseManager;
        this.collectionName = 'commentReactions';
        this.summaryCollectionName = 'commentReactionSummaries';
        this.configCollectionName = COMMENT_REACTION_CONFIG_COLLECTION;
        this.configDocumentId = COMMENT_REACTION_CONFIG_ID;
        this.queryChunkSize = 30;
        this.config = createDefaultReactionConfig();
        this.reactionTypes = COMMENT_REACTION_TYPES;
        this.configLoaded = false;
        this.configPromise = null;
        this.configUnsubscribe = null;
    }

    getDb() {
        const db = this.firebaseManager?.db || this.firebaseManager;
        if (!db || typeof db.collection !== 'function') {
            throw new Error('Firestore is not initialized');
        }
        return db;
    }

    getServerTimestamp() {
        return globalThis.firebase?.firestore?.FieldValue?.serverTimestamp?.() || new Date();
    }

    static normalizeReactionType(value) {
        return normalizeReactionType(value);
    }

    static normalizeReactionTypes(value) {
        return normalizeReactionTypes(value);
    }

    static normalizeReactionSummary(data, ratingId, movieId) {
        return normalizeReactionSummary(data, ratingId, movieId);
    }

    static normalizeReactionConfig(data) {
        return normalizeReactionConfig(data);
    }

    static normalizeReactionImageUrl(value) {
        return normalizeReactionImageUrl(value);
    }

    static getDefaultReactionConfig() {
        return createDefaultReactionConfig();
    }

    static createCustomReactionId() {
        const randomId = globalThis.crypto?.randomUUID?.()?.replace(/-/g, '').slice(0, 12)
            || Math.random().toString(36).slice(2, 14);
        return `custom_${Date.now().toString(36)}_${randomId}`;
    }

    getReactionTypes() {
        return this.reactionTypes;
    }

    getConfig() {
        return this.config;
    }

    setConfig(config) {
        this.config = applyReactionConfig(config);
        this.reactionTypes = Object.freeze(this.config.reactions.map(({ id }) => id));
        return this.config;
    }

    async loadConfig(force = false) {
        if (this.configLoaded && !force) return this.config;
        if (this.configPromise) return this.configPromise;

        this.configPromise = (async () => {
            try {
                const snapshot = await this.getDb()
                    .collection(this.configCollectionName)
                    .doc(this.configDocumentId)
                    .get();
                this.setConfig(snapshot?.exists ? snapshot.data() : createDefaultReactionConfig());
            } catch (error) {
                // Reaction UI must remain available for offline users and clients
                // that are upgraded before the shared config document exists.
                console.warn('[CommentReactions] Failed to load shared config; using defaults:', error);
                this.setConfig(this.config);
            } finally {
                this.configLoaded = true;
            }
            return this.config;
        })().finally(() => {
            this.configPromise = null;
        });

        return this.configPromise;
    }

    subscribeToConfig(onChange) {
        if (this.configUnsubscribe) return this.configUnsubscribe;
        const db = this.getDb();
        const configRef = db.collection(this.configCollectionName).doc(this.configDocumentId);
        if (typeof configRef.onSnapshot !== 'function') return null;

        this.configUnsubscribe = configRef.onSnapshot((snapshot) => {
            const config = snapshot?.exists ? snapshot.data() : createDefaultReactionConfig();
            this.configLoaded = true;
            this.setConfig(config);
            onChange?.(this.config);
        }, (error) => {
            console.warn('[CommentReactions] Shared config subscription failed:', error);
        });
        return this.configUnsubscribe;
    }

    async saveConfig(reactions, updatedBy = '') {
        const config = normalizeReactionConfig({ reactions });
        if (!Array.isArray(reactions) || config.reactions.length !== reactions.length) {
            throw new Error('Invalid comment reaction catalog');
        }

        const timestamp = this.getServerTimestamp();
        await this.getDb().collection(this.configCollectionName).doc(this.configDocumentId).set({
            schemaVersion: 1,
            reactions: config.reactions,
            reactionTypes: config.reactions.map(({ id }) => id),
            maxReactionsPerUser: MAX_REACTIONS_PER_USER,
            updatedAt: timestamp,
            updatedBy: String(updatedBy || '').trim() || null
        }, { merge: true });

        this.configLoaded = true;
        return this.setConfig({ ...config, updatedAt: timestamp, updatedBy });
    }

    static buildReactionId(ratingId, userId) {
        const normalizedRatingId = normalizeReactionId(ratingId);
        const normalizedUserId = String(userId ?? '').trim();
        if (!normalizedRatingId || !normalizedUserId || normalizedUserId.includes('/')) return null;
        return `${normalizedRatingId}_${normalizedUserId}`;
    }

    async getSummaryMap(ratingIds = []) {
        const ids = [...new Set(ratingIds.map(normalizeReactionId).filter(Boolean))];
        const map = new Map();
        if (ids.length === 0) return map;

        await this.loadConfig();

        const db = this.getDb();
        const snapshots = await Promise.all(ids.map((ratingId) => (
            db.collection(this.summaryCollectionName).doc(ratingId).get()
        )));

        snapshots.forEach((snapshot, index) => {
            if (snapshot.exists) {
                const data = snapshot.data() || {};
                map.set(ids[index], normalizeReactionSummary(data, ids[index], data.movieId, this.reactionTypes));
            } else {
                map.set(ids[index], normalizeReactionSummary({}, ids[index], '', this.reactionTypes));
            }
        });

        return map;
    }

    async getUserReactionMap(userId, ratingIds = []) {
        const normalizedUserId = String(userId ?? '').trim();
        const ids = [...new Set(ratingIds.map(normalizeReactionId).filter(Boolean))];
        const map = new Map();
        if (!normalizedUserId || ids.length === 0) return map;

        await this.loadConfig();

        const db = this.getDb();
        for (let index = 0; index < ids.length; index += this.queryChunkSize) {
            const chunk = ids.slice(index, index + this.queryChunkSize);
            const snapshot = await db.collection(this.collectionName)
                .where('userId', '==', normalizedUserId)
                .where('ratingId', 'in', chunk)
                .get();

            snapshot.forEach((doc) => {
                const data = doc.data() || {};
                const ratingId = normalizeReactionId(data.ratingId);
                const types = normalizeReactionTypes(data.types ?? data.type, this.reactionTypes);
                if (ratingId && types.length > 0) map.set(ratingId, types);
            });
        }

        return map;
    }

    async toggleReaction({ userId, ratingId, movieId, type }) {
        await this.loadConfig();
        const normalizedUserId = String(userId ?? '').trim();
        const normalizedRatingId = normalizeReactionId(ratingId);
        const normalizedMovieId = normalizeMovieId(movieId);
        const normalizedType = normalizeReactionType(type, this.reactionTypes);
        const reactionId = CommentReactionService.buildReactionId(normalizedRatingId, normalizedUserId);

        if (!normalizedUserId || !normalizedRatingId || !normalizedMovieId || !normalizedType || !reactionId) {
            throw new Error('Invalid comment reaction payload');
        }

        const currentUser = this.firebaseManager?.getCurrentUser?.() || this.firebaseManager?.auth?.currentUser;
        if (currentUser?.uid && currentUser.uid !== normalizedUserId) {
            throw new Error('Cannot change another user reaction');
        }

        const db = this.getDb();
        const reactionRef = db.collection(this.collectionName).doc(reactionId);

        // A transaction makes two fast clicks from different tabs observe the
        // same current selection and preserves the three-reaction invariant.
        return db.runTransaction(async (transaction) => {
            const currentSnapshot = await transaction.get(reactionRef);
            const currentData = currentSnapshot.exists ? currentSnapshot.data() || {} : null;
            const currentTypes = normalizeReactionTypes(currentData?.types ?? currentData?.type, this.reactionTypes);
            const isActive = currentTypes.includes(normalizedType);
            const nextTypes = isActive
                ? currentTypes.filter((reactionType) => reactionType !== normalizedType)
                : [...currentTypes, normalizedType];

            if (!isActive && currentTypes.length >= MAX_REACTIONS_PER_USER) {
                const error = new Error(`A maximum of ${MAX_REACTIONS_PER_USER} reactions is allowed per comment`);
                error.code = 'MAX_COMMENT_REACTIONS';
                throw error;
            }

            if (nextTypes.length === 0) {
                transaction.delete(reactionRef);
                return { ratingId: normalizedRatingId, types: [], active: false };
            }

            const timestamp = this.getServerTimestamp();
            await transaction.set(reactionRef, {
                ratingId: normalizedRatingId,
                movieId: normalizedMovieId,
                userId: normalizedUserId,
                types: nextTypes,
                // Keep the scalar field as a compatibility mirror for clients
                // released before multi-reaction support. `types` is canonical.
                type: nextTypes[0],
                schemaVersion: 2,
                createdAt: currentData?.createdAt || timestamp,
                updatedAt: timestamp
            }, { merge: true });

            return { ratingId: normalizedRatingId, types: nextTypes, active: true };
        });
    }
}

CommentReactionService.MAX_REACTIONS_PER_USER = MAX_REACTIONS_PER_USER;
CommentReactionService.MAX_REACTION_CATALOG_SIZE = MAX_REACTION_CATALOG_SIZE;
CommentReactionService.MAX_REACTION_ASSET_SIZE = MAX_REACTION_ASSET_SIZE;
CommentReactionService.REACTION_ASSET_CONTENT_TYPES = REACTION_ASSET_CONTENT_TYPES;
CommentReactionService.REACTION_ASSET_PATH_PREFIX = REACTION_ASSET_PATH_PREFIX;
CommentReactionService.CONFIG_DOCUMENT_ID = COMMENT_REACTION_CONFIG_ID;

if (typeof window !== 'undefined') {
    applyReactionConfig(createDefaultReactionConfig());
    window.CommentReactionService = CommentReactionService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        COMMENT_REACTION_TYPES,
        COMMENT_REACTION_META,
        DEFAULT_REACTION_DEFINITIONS,
        MAX_REACTIONS_PER_USER,
        MAX_REACTION_CATALOG_SIZE,
        MAX_REACTION_ASSET_SIZE,
        REACTION_ASSET_CONTENT_TYPES,
        REACTION_ASSET_PATH_PREFIX,
        COMMENT_REACTION_CONFIG_COLLECTION,
        COMMENT_REACTION_CONFIG_ID,
        CommentReactionService,
        normalizeReactionId,
        normalizeReactionKey,
        normalizeReactionShortcode,
        normalizeReactionAssetPath,
        normalizeReactionImageUrl,
        normalizeReactionType,
        normalizeReactionTypes,
        normalizeReactionSummary,
        normalizeReactionDefinition,
        normalizeReactionConfig,
        createDefaultReactionConfig,
        applyReactionConfig
    };
}
