const EXTENSION_ORIGIN = "chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd";
const MAX_MOVIES_PER_USER = 3;
const ROUND_STATUSES = new Set(["collecting", "active", "completed", "cancelled"]);
const ITEM_STATES = new Set(["queued", "selected", "watched", "removed"]);

function createMarathonError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function setMarathonCors(req, res) {
  const origin = req.get?.("origin");
  if (origin && origin !== EXTENSION_ORIGIN) {
    res.status(403).json({ error: "Origin is not allowed", code: "ORIGIN_NOT_ALLOWED" });
    return false;
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Origin", EXTENSION_ORIGIN);
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return false;
  }
  return true;
}

function requireBearerToken(req) {
  const header = String(req.get?.("authorization") || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw createMarathonError("AUTH_REQUIRED", "Authentication is required", 401);
  return match[1];
}

function normalizeString(value, field, maxLength, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw createMarathonError("INVALID_MOVIE", `${field} is required`);
    return null;
  }
  if (typeof value !== "string") {
    throw createMarathonError("INVALID_MOVIE", `${field} is invalid`);
  }
  const normalized = value.trim();
  if (required && !normalized) throw createMarathonError("INVALID_MOVIE", `${field} is required`);
  if (normalized.length > maxLength) throw createMarathonError("INVALID_MOVIE", `${field} is too long`);
  return normalized || null;
}

function normalizeMovie(movie = {}) {
  const rawId = movie.kinopoiskId ?? movie.kpId ?? movie.movieId ?? movie.id;
  const kpId = Number(rawId);
  if (!Number.isInteger(kpId) || kpId <= 0) {
    throw createMarathonError("INVALID_MOVIE", "A valid Kinopoisk movie ID is required");
  }

  const rawYear = movie.year;
  let year = null;
  if (rawYear != null && rawYear !== "") {
    if (typeof rawYear === "number" && Number.isInteger(rawYear)) year = rawYear;
    else if (typeof rawYear === "string" && /^\d{4}$/.test(rawYear.trim())) year = Number(rawYear.trim());
    else throw createMarathonError("INVALID_MOVIE", "year is invalid");
  }

  const rawRating = movie.kpRating ?? movie.rating;
  let rating = null;
  if (rawRating != null && rawRating !== "") {
    const parsedRating = Number(rawRating);
    if (!Number.isFinite(parsedRating) || parsedRating < 0 || parsedRating > 10) {
      throw createMarathonError("INVALID_MOVIE", "rating is invalid");
    }
    rating = parsedRating;
  }

  const poster = normalizeString(movie.posterUrl ?? movie.poster ?? movie.posterPath, "poster", 2048);
  if (poster && !/^https?:\/\/[^\s]+$/i.test(poster)) {
    throw createMarathonError("INVALID_MOVIE", "poster is invalid");
  }

  return {
    kpId,
    title: normalizeString(movie.name ?? movie.title ?? movie.alternativeName, "title", 300) || "Без названия",
    year,
    poster,
    rating,
  };
}

function isApprovedProfile(profile) {
  if (!profile) return false;
  return profile.approvalStatus === "approved" || !Object.prototype.hasOwnProperty.call(profile, "approvalStatus");
}

function isAdminProfile(profile) {
  return profile?.isAdmin === true;
}

function displayNameFromProfile(profile, decodedToken) {
  if (profile?.displayNameFormat === "username" && profile.username) {
    return String(profile.username).trim().slice(0, 120) || "Участник";
  }
  const fullName = [profile?.firstName, profile?.lastName]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  return (fullName || profile?.displayName || decodedToken?.name || decodedToken?.email || "Участник")
    .trim()
    .slice(0, 120) || "Участник";
}

function getRoundRef(db) {
  return db.collection("randomMarathons").doc("current");
}

function getItemsRef(db) {
  return getRoundRef(db).collection("items");
}

async function readTransactionItems(transaction, query) {
  const snapshot = await transaction.get(query);
  return snapshot.docs.map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() }));
}

function countParticipantItems(items) {
  const counts = {};
  for (const item of items) {
    const data = item.data || item;
    if (!data.addedBy || data.state === "removed") continue;
    counts[data.addedBy] = Number(counts[data.addedBy] || 0) + 1;
  }
  return counts;
}

function validateRound(round) {
  if (!round || !ROUND_STATUSES.has(round.status) || !Number.isInteger(Number(round.roundId))) {
    throw createMarathonError("INVALID_ROUND", "The marathon round is invalid", 409);
  }
}

function normalizeExpectedRoundId(value) {
  const roundId = Number(value);
  if (!Number.isInteger(roundId) || roundId <= 0) {
    throw createMarathonError("INVALID_EXPECTED_MOVIE", "The expected marathon round is invalid");
  }
  return roundId;
}

function normalizeExpectedItemId(value) {
  const itemId = normalizeString(value, "expectedItemId", 180, { required: true });
  if (!/^\d+_\d+$/.test(itemId)) {
    throw createMarathonError("INVALID_EXPECTED_MOVIE", "The expected marathon movie is invalid");
  }
  return itemId;
}

function validateAction(action) {
  const allowed = new Set(["create", "add", "remove", "start", "roll", "resolve"]);
  if (!allowed.has(action)) throw createMarathonError("INVALID_ACTION", "Marathon action is invalid");
}

function createRandomMarathonService({ db, FieldValue } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("Random marathon Firestore dependency is required");
  }
  if (!FieldValue?.serverTimestamp) throw new Error("Random marathon FieldValue dependency is required");

  const service = {
    async getCurrent() {
      const roundSnapshot = await getRoundRef(db).get();
      if (!roundSnapshot.exists) return { round: null, items: [] };
      const round = { id: roundSnapshot.id, ...roundSnapshot.data() };
      const itemSnapshot = await getItemsRef(db).where("roundId", "==", round.roundId).get();
      const items = itemSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      items.sort((left, right) => toMillis(left.addedAt) - toMillis(right.addedAt));
      return { round, items };
    },

    async createRound({ actorUid, profile, decodedToken }) {
      if (!isAdminProfile(profile)) throw createMarathonError("ADMIN_REQUIRED", "Only an administrator can create a round", 403);
      const roundRef = getRoundRef(db);
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(roundRef);
        const previous = snapshot.exists ? snapshot.data() : null;
        if (previous && ["collecting", "active"].includes(previous.status)) {
          throw createMarathonError("ROUND_IN_PROGRESS", "The current round is not finished", 409);
        }
        const nextRoundId = Number(previous?.roundId || 0) + 1;
        transaction.set(roundRef, {
          roundId: nextRoundId,
          status: "collecting",
          createdBy: actorUid,
          createdByName: displayNameFromProfile(profile, decodedToken),
          createdAt: FieldValue.serverTimestamp(),
          startedAt: null,
          finishedAt: null,
          currentItemId: null,
          completedCount: 0,
          participantCounts: {},
        });
      });
      return service.getCurrent();
    },

    async addMovie({ actorUid, profile, movie }) {
      if (!isApprovedProfile(profile) && !isAdminProfile(profile)) {
        throw createMarathonError("APPROVAL_REQUIRED", "An approved account is required", 403);
      }
      const entry = normalizeMovie(movie);
      const roundRef = getRoundRef(db);
      const itemsRef = getItemsRef(db);
      await db.runTransaction(async (transaction) => {
        const roundSnapshot = await transaction.get(roundRef);
        if (!roundSnapshot.exists) throw createMarathonError("ROUND_NOT_FOUND", "There is no active round", 409);
        const round = roundSnapshot.data();
        validateRound(round);
        if (round.status !== "collecting") throw createMarathonError("COLLECTION_CLOSED", "Adding movies is closed", 409);

        const itemRef = itemsRef.doc(`${round.roundId}_${entry.kpId}`);
        const items = await readTransactionItems(transaction, itemsRef.where("roundId", "==", round.roundId));
        const existingSnapshot = await transaction.get(itemRef);
        const existing = existingSnapshot.exists
          ? { id: existingSnapshot.id, ref: itemRef, data: existingSnapshot.data() }
          : items.find((item) => item.id === itemRef.id);
        if (existing && !items.some((item) => item.id === existing.id)) items.push(existing);
        if (existing && existing.data?.state !== "removed") {
          throw createMarathonError("DUPLICATE_MOVIE", "This movie is already in the current round", 409);
        }

        const derivedCounts = countParticipantItems(items);
        const counts = { ...derivedCounts };
        Object.entries(round.participantCounts || {}).forEach(([userId, value]) => {
          counts[userId] = Math.max(Number(counts[userId] || 0), Number(value) || 0);
        });
        const ownCount = Number(counts[actorUid] || 0);
        if (!isAdminProfile(profile) && ownCount >= MAX_MOVIES_PER_USER) {
          throw createMarathonError("MOVIE_LIMIT", "You can add no more than three movies per round", 409);
        }
        counts[actorUid] = ownCount + 1;
        transaction.set(itemRef, {
          roundId: round.roundId,
          kpId: entry.kpId,
          title: entry.title,
          year: entry.year,
          poster: entry.poster,
          rating: entry.rating,
          addedBy: actorUid,
          addedByName: displayNameFromProfile(profile),
          addedAt: FieldValue.serverTimestamp(),
          state: "queued",
          resolvedAt: null,
          resolvedBy: null,
          resolution: null,
        });
        transaction.update(roundRef, { participantCounts: counts });
      });
      return service.getCurrent();
    },

    async removeMovie({ actorUid, profile, itemId }) {
      const normalizedItemId = normalizeString(itemId, "itemId", 180, { required: true });
      if (!/^\d+_\d+$/.test(normalizedItemId)) {
        throw createMarathonError("INVALID_ITEM", "itemId is invalid");
      }
      const roundRef = getRoundRef(db);
      const itemRef = getItemsRef(db).doc(normalizedItemId);

      await db.runTransaction(async (transaction) => {
        const [roundSnapshot, itemSnapshot] = await Promise.all([
          transaction.get(roundRef),
          transaction.get(itemRef),
        ]);
        if (!roundSnapshot.exists || !itemSnapshot.exists) throw createMarathonError("MOVIE_NOT_FOUND", "The movie is already removed", 404);
        const round = roundSnapshot.data();
        const item = itemSnapshot.data();
        validateRound(round);
        if (item.roundId !== round.roundId) throw createMarathonError("STALE_MOVIE", "The movie belongs to an older round", 409);
        const admin = isAdminProfile(profile);
        if (!admin && (round.status !== "collecting" || item.addedBy !== actorUid)) {
          throw createMarathonError("FORBIDDEN", "Only the author or an administrator can remove this movie", 403);
        }

        const counts = { ...(round.participantCounts || {}) };
        if (round.status === "collecting") {
          transaction.delete(itemRef);
          counts[item.addedBy] = Math.max(0, Number(counts[item.addedBy] || 1) - 1);
          transaction.update(roundRef, { participantCounts: counts });
          return;
        }
        if (round.status !== "active") {
          throw createMarathonError("ROUND_NOT_ACTIVE", "The round is already finished", 409);
        }
        if (!admin) throw createMarathonError("ADMIN_REQUIRED", "Only an administrator can remove an active movie", 403);
        if (["watched", "removed"].includes(item.state)) return;

        const items = await readTransactionItems(transaction, getItemsRef(db).where("roundId", "==", round.roundId));
        const update = {
          state: "removed",
          resolution: "removed",
          resolvedAt: FieldValue.serverTimestamp(),
          resolvedBy: actorUid,
        };
        transaction.update(itemRef, update);
        const roundUpdate = {
          currentItemId: round.currentItemId === normalizedItemId ? null : round.currentItemId || null,
          completedCount: Number(round.completedCount || 0) + 1,
        };
        const hasOtherQueued = items.some((candidate) => candidate.id !== normalizedItemId && candidate.data.state === "queued");
        if (!hasOtherQueued && (!round.currentItemId || round.currentItemId === normalizedItemId)) {
          roundUpdate.status = "completed";
          roundUpdate.finishedAt = FieldValue.serverTimestamp();
        }
        transaction.update(roundRef, roundUpdate);
      });
      return service.getCurrent();
    },

    async startRound({ profile }) {
      if (!isAdminProfile(profile)) throw createMarathonError("ADMIN_REQUIRED", "Only an administrator can start a round", 403);
      const roundRef = getRoundRef(db);
      await db.runTransaction(async (transaction) => {
        const roundSnapshot = await transaction.get(roundRef);
        if (!roundSnapshot.exists || roundSnapshot.data().status !== "collecting") {
          throw createMarathonError("ROUND_NOT_COLLECTING", "The round is already started or missing", 409);
        }
        const round = roundSnapshot.data();
        const items = await readTransactionItems(transaction, getItemsRef(db).where("roundId", "==", round.roundId));
        if (!items.some((item) => item.data.state === "queued")) {
          throw createMarathonError("EMPTY_ROUND", "Add at least one movie before starting", 409);
        }
        transaction.update(roundRef, {
          status: "active",
          startedAt: FieldValue.serverTimestamp(),
          currentItemId: null,
          completedCount: 0,
        });
      });
      return service.getCurrent();
    },

    async rollNext({ profile }) {
      if (!isAdminProfile(profile)) throw createMarathonError("ADMIN_REQUIRED", "Only an administrator can roll the marathon", 403);
      const roundRef = getRoundRef(db);
      await db.runTransaction(async (transaction) => {
        const roundSnapshot = await transaction.get(roundRef);
        if (!roundSnapshot.exists || roundSnapshot.data().status !== "active") throw createMarathonError("ROUND_NOT_ACTIVE", "The round is not active", 409);
        const round = roundSnapshot.data();
        if (round.currentItemId) throw createMarathonError("CURRENT_MOVIE_EXISTS", "Finish the current movie first", 409);
        const items = await readTransactionItems(transaction, getItemsRef(db).where("roundId", "==", round.roundId));
        const queued = items.filter((item) => item.data.state === "queued");
        if (!queued.length) {
          transaction.update(roundRef, { status: "completed", finishedAt: FieldValue.serverTimestamp() });
          return;
        }
        const winner = queued[Math.floor(Math.random() * queued.length)];
        transaction.update(winner.ref, { state: "selected", selectedAt: FieldValue.serverTimestamp() });
        transaction.update(roundRef, { currentItemId: winner.id });
      });
      return service.getCurrent();
    },

    async resolveCurrent({ actorUid, profile, expectedRoundId, expectedItemId, resolution = "watched" }) {
      if (!isAdminProfile(profile)) throw createMarathonError("ADMIN_REQUIRED", "Only an administrator can finish a movie", 403);
      if (!ITEM_STATES.has(resolution) || !["watched", "removed"].includes(resolution)) {
        throw createMarathonError("INVALID_RESOLUTION", "The movie resolution is invalid");
      }
      const normalizedExpectedRoundId = normalizeExpectedRoundId(expectedRoundId);
      const normalizedExpectedItemId = normalizeExpectedItemId(expectedItemId);
      const roundRef = getRoundRef(db);
      await db.runTransaction(async (transaction) => {
        const roundSnapshot = await transaction.get(roundRef);
        if (!roundSnapshot.exists || roundSnapshot.data().status !== "active") throw createMarathonError("ROUND_NOT_ACTIVE", "The round is not active", 409);
        const round = roundSnapshot.data();
        if (!round.currentItemId) throw createMarathonError("CURRENT_MOVIE_MISSING", "Roll the roulette first", 409);
        if (Number(round.roundId) !== normalizedExpectedRoundId || round.currentItemId !== normalizedExpectedItemId) {
          throw createMarathonError("CURRENT_MOVIE_STALE", "The current movie was already changed", 409);
        }
        const currentRef = getItemsRef(db).doc(round.currentItemId);
        const currentSnapshot = await transaction.get(currentRef);
        if (!currentSnapshot.exists || currentSnapshot.data().state !== "selected") {
          throw createMarathonError("CURRENT_MOVIE_STALE", "The current movie was already processed", 409);
        }
        const items = await readTransactionItems(transaction, getItemsRef(db).where("roundId", "==", round.roundId));
        const hasQueued = items.some((item) => item.id !== round.currentItemId && item.data.state === "queued");
        transaction.update(currentRef, {
          state: resolution,
          resolution,
          resolvedAt: FieldValue.serverTimestamp(),
          resolvedBy: actorUid,
        });
        transaction.update(roundRef, {
          currentItemId: null,
          completedCount: Number(round.completedCount || 0) + 1,
          ...(hasQueued ? {} : { status: "completed", finishedAt: FieldValue.serverTimestamp() }),
        });
      });
      return service.getCurrent();
    },
  };

  return service;
}

function createRandomMarathonHandler({ db, auth, FieldValue } = {}) {
  if (!db || !auth || typeof auth.verifyIdToken !== "function") {
    throw new Error("Random marathon handler dependencies are required");
  }
  const service = createRandomMarathonService({ db, FieldValue });

  return async (req, res) => {
    if (!setMarathonCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST requests are supported", code: "METHOD_NOT_ALLOWED" });
      return;
    }

    try {
      let decodedToken;
      try {
        decodedToken = await auth.verifyIdToken(requireBearerToken(req));
      } catch (error) {
        if (String(error?.code || "").startsWith("auth/")) {
          throw createMarathonError("AUTH_REQUIRED", "Authentication is required", 401);
        }
        throw error;
      }
      const actorUid = decodedToken.uid;
      const profileSnapshot = await db.collection("users").doc(actorUid).get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      if (!isApprovedProfile(profile) && !isAdminProfile(profile)) {
        throw createMarathonError("APPROVAL_REQUIRED", "An approved account is required", 403);
      }

      const action = String(req.body?.action || "").trim();
      validateAction(action);
      let result;
      if (action === "create") result = await service.createRound({ actorUid, profile, decodedToken });
      if (action === "add") result = await service.addMovie({ actorUid, profile, movie: req.body?.movie });
      if (action === "remove") result = await service.removeMovie({ actorUid, profile, itemId: req.body?.itemId });
      if (action === "start") result = await service.startRound({ profile });
      if (action === "roll") result = await service.rollNext({ profile });
      if (action === "resolve") result = await service.resolveCurrent({
        actorUid,
        profile,
        expectedRoundId: req.body?.expectedRoundId,
        expectedItemId: req.body?.expectedItemId,
        resolution: req.body?.resolution,
      });
      res.status(200).json({ ok: true, ...result });
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      if (statusCode >= 500) console.error("[randomMarathon] Request failed:", error);
      res.status(statusCode).json({
        error: statusCode >= 500 ? "Random marathon is temporarily unavailable" : error.message,
        code: error.code || "INTERNAL",
      });
    }
  };
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return Number(value.seconds) * 1000;
  return new Date(value).getTime() || 0;
}

module.exports = {
  EXTENSION_ORIGIN,
  ITEM_STATES,
  MAX_MOVIES_PER_USER,
  ROUND_STATUSES,
  createMarathonError,
  createRandomMarathonHandler,
  createRandomMarathonService,
  displayNameFromProfile,
  isApprovedProfile,
  normalizeMovie,
  setMarathonCors,
};
