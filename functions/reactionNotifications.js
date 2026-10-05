/**
 * Reaction notifications for comment (rating) owners.
 *
 * Cost model: every user has at most one inbox document,
 * `userNotifications/{uid}`, holding the newest MAX_INBOX_ITEMS reaction
 * entries. A reaction that adds a type to someone else's rating costs one
 * transaction on that document (1 read + 1 write) plus point reads of the
 * reactor profile and the movie. The client reads the inbox with a single
 * document get when the extension opens, so no listener or query is billed.
 */

const NOTIFICATION_COLLECTION = "userNotifications";
const MAX_INBOX_ITEMS = 20;
const MAX_ITEM_REACTIONS = 3;

function normalizeReactionTypes(data) {
  if (!data) return [];
  const rawTypes = Array.isArray(data.types) ? data.types : [data.type];
  return [...new Set(rawTypes
    .map((type) => String(type ?? "").trim().toLowerCase())
    .filter(Boolean)
  )].slice(0, MAX_ITEM_REACTIONS);
}

/**
 * Reaction types present after the write but not before it.
 * Removing a reaction never notifies.
 */
function getAddedReactionTypes(dataBefore, dataAfter) {
  const before = new Set(normalizeReactionTypes(dataBefore));
  return normalizeReactionTypes(dataAfter).filter((type) => !before.has(type));
}

function trimText(value, maxLength) {
  const text = String(value ?? "").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function safeHttpsUrl(value) {
  const text = String(value ?? "").trim();
  return /^https:\/\//i.test(text) && text.length <= 2048 ? text : null;
}

/**
 * Display data for the reaction types, taken from the shared catalog so
 * custom image reactions render without the client loading the catalog.
 */
function describeReactions(types, definitions = []) {
  const byId = new Map((Array.isArray(definitions) ? definitions : [])
    .map((definition) => [String(definition?.id ?? "").toLowerCase(), definition]));
  return types.slice(0, MAX_ITEM_REACTIONS).map((type) => {
    const definition = byId.get(type) || {};
    return {
      id: type,
      emoji: trimText(definition.emoji, 32) || null,
      imageUrl: definition.renderType === "image" ? safeHttpsUrl(definition.imageUrl) : null,
      label: trimText(definition.label, 64) || type,
    };
  });
}

/**
 * Insert one entry at the head of the inbox. The same reactor on the same
 * rating replaces its previous entry, so toggling reactions cannot flood it.
 */
function buildInboxItems(existingItems, entry, maxItems = MAX_INBOX_ITEMS) {
  const items = Array.isArray(existingItems) ? existingItems : [];
  return [entry, ...items.filter((item) => item && item.key !== entry.key)].slice(0, maxItems);
}

function createReactionNotifier({ db, now = () => new Date() }) {
  /**
   * @param {Object} params
   * @param {string} params.ratingId
   * @param {Object} params.rating - Rating document data (owner in userId)
   * @param {Object|null} params.dataBefore - Reaction document before the write
   * @param {Object|null} params.dataAfter - Reaction document after the write
   * @param {Array} [params.reactionDefinitions] - Shared reaction catalog
   * @returns {Promise<boolean>} true when an inbox entry was written
   */
  return async function notifyReactionOwner({
    ratingId,
    rating,
    dataBefore,
    dataAfter,
    reactionDefinitions = [],
  }) {
    const ownerId = String(rating?.userId ?? "").trim();
    const reactorId = String(dataAfter?.userId ?? "").trim();
    if (!ownerId || !reactorId || ownerId === reactorId) return false;
    if (ownerId.includes("/") || reactorId.includes("/")) return false;
    if (getAddedReactionTypes(dataBefore, dataAfter).length === 0) return false;

    const movieId = rating?.movieId ?? dataAfter?.movieId ?? null;
    const [reactorSnapshot, movieSnapshot] = await Promise.all([
      db.collection("users").doc(reactorId).get(),
      movieId != null ? db.collection("movies").doc(String(movieId)).get() : Promise.resolve(null),
    ]);
    const reactor = reactorSnapshot?.exists ? reactorSnapshot.data() || {} : {};
    const movie = movieSnapshot?.exists ? movieSnapshot.data() || {} : {};

    const entry = {
      key: `${ratingId}_${reactorId}`,
      ratingId: String(ratingId),
      movieId: movieId != null ? String(movieId) : null,
      movieName: trimText(movie.name || movie.alternativeName, 200) || null,
      posterUrl: safeHttpsUrl(movie.posterPreviewUrl || movie.posterUrl),
      reactorId,
      reactorName: trimText(reactor.displayName || reactor.name, 120) || null,
      reactorPhoto: safeHttpsUrl(reactor.photoURL || reactor.photo),
      // The full current selection, so a replaced entry stays accurate.
      reactions: describeReactions(normalizeReactionTypes(dataAfter), reactionDefinitions),
      createdAt: now(),
    };

    const inboxRef = db.collection(NOTIFICATION_COLLECTION).doc(ownerId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(inboxRef);
      const current = snapshot.exists ? snapshot.data() || {} : {};
      transaction.set(inboxRef, {
        reactions: buildInboxItems(current.reactions, entry),
        reactionsUpdatedAt: entry.createdAt,
      }, { merge: true });
    });
    return true;
  };
}

module.exports = {
  NOTIFICATION_COLLECTION,
  MAX_INBOX_ITEMS,
  getAddedReactionTypes,
  describeReactions,
  buildInboxItems,
  createReactionNotifier,
};
