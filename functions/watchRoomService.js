const crypto = require("crypto");

const MAX_PARTICIPANTS = 20;
const DEFAULT_ROOM_TTL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const ROOM_STATUSES = new Set(["lobby", "active"]);

function createWatchRoomError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function toMillis(value) {
  if (typeof value === "number") return value;
  if (value?.toMillis) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number.NaN;
}

function requireUid(uid) {
  if (typeof uid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw createWatchRoomError("INVALID_USER", "User identity is invalid", 401);
  }
  return uid;
}

function requireRequestId(requestId) {
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) {
    throw createWatchRoomError("INVALID_REQUEST_ID", "Request ID is invalid");
  }
  return requestId;
}

function normalizeVisibility(visibility) {
  if (visibility !== "private" && visibility !== "public") {
    throw createWatchRoomError("INVALID_VISIBILITY", "Room visibility is invalid");
  }
  return visibility;
}

function normalizeMaxParticipants(value) {
  const maxParticipants = value == null ? MAX_PARTICIPANTS : Number(value);
  if (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > MAX_PARTICIPANTS) {
    throw createWatchRoomError("INVALID_CAPACITY", "Room capacity is invalid");
  }
  return maxParticipants;
}

function normalizeMemberRole(value) {
  if (value !== "viewer" && value !== "controller") {
    throw createWatchRoomError("INVALID_MEMBER_ROLE", "Member role is invalid");
  }
  return value;
}

function normalizeContent(value) {
  if (!value || typeof value !== "object") {
    throw createWatchRoomError("INVALID_CONTENT", "Room content is required");
  }
  const kinopoiskId = Number(value.kinopoiskId);
  const mediaType = value.mediaType === "series" ? "series" : "movie";
  if (!Number.isInteger(kinopoiskId) || kinopoiskId <= 0) {
    throw createWatchRoomError("INVALID_CONTENT", "Movie identity is invalid");
  }
  return {
    kinopoiskId,
    mediaType,
    title: String(value.title || "").trim().slice(0, 160) || null,
    contentRevision: 1,
    timelineProfile: "native-video-v1",
  };
}

function safeProfile(data = {}) {
  return {
    displayName: String(data.displayName || data.name || "Гость").trim().slice(0, 80) || "Гость",
    photoURL: typeof data.photoURL === "string" ? data.photoURL.slice(0, 512) : null,
  };
}

function hashInviteSecret(secret) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function createAclOutbox({ roomId, userId, desiredRole, aclVersion, operation, createdAt }) {
  return {
    roomId,
    userId,
    desiredRole,
    aclVersion,
    operation,
    idempotencyKey: `${roomId}:${userId}:${aclVersion}`,
    state: "pending",
    attempts: 0,
    nextAttemptAt: createdAt,
    lastErrorCode: null,
    createdAt,
    appliedAt: null,
  };
}

function createSafeRoomDto(roomId, room, role) {
  return {
    roomId,
    role,
    visibility: room.visibility,
    status: room.status,
    maxParticipants: room.maxParticipants,
    memberCount: room.memberCount,
    expiresAtMs: toMillis(room.expiresAt),
    content: room.content || null,
    contentSyncState: room.contentSyncState || "idle",
  };
}

function createWatchRoomService({
  db,
  now = () => new Date(),
  randomId = crypto.randomUUID,
  randomBytes = crypto.randomBytes,
  roomTtlMs = DEFAULT_ROOM_TTL_MS,
  inviteTtlMs = DEFAULT_INVITE_TTL_MS,
  collectionPrefix = "watchRooms",
  emitAclOutbox = true,
} = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("Firestore client is not configured");
  }

  if (typeof collectionPrefix !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(collectionPrefix)) {
    throw new Error("Watch-room collection prefix is invalid");
  }
  const isDefaultCollection = collectionPrefix === "watchRooms";
  const rooms = db.collection(collectionPrefix);
  const invites = db.collection(isDefaultCollection ? "watchRoomInvites" : `${collectionPrefix}Invites`);
  const aclOutbox = db.collection(isDefaultCollection ? "watchRoomAclOutbox" : `${collectionPrefix}AclOutbox`);

  async function getApprovedProfile(uid) {
    const userId = requireUid(uid);
    const snapshot = await db.collection("users").doc(userId).get();
    if (!snapshot.exists || snapshot.data()?.approvalStatus !== "approved") {
      throw createWatchRoomError("APPROVAL_REQUIRED", "Approved account is required", 403);
    }
    return safeProfile(snapshot.data());
  }

  async function createRoom({ actorUid, requestId, visibility = "private", maxParticipants, content } = {}) {
    requireUid(actorUid);
    requireRequestId(requestId);
    const ownerProfile = await getApprovedProfile(actorUid);
    const normalizedVisibility = normalizeVisibility(visibility);
    const normalizedCapacity = normalizeMaxParticipants(maxParticipants);
    const normalizedContent = normalizeContent(content);
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + roomTtlMs);
    const roomId = randomId();
    const roomRef = rooms.doc(roomId);
    const memberRef = roomRef.collection("members").doc(actorUid);
    const aclVersion = 1;

    await db.runTransaction(async (transaction) => {
      transaction.set(roomRef, {
        ownerId: actorUid,
        visibility: normalizedVisibility,
        status: "lobby",
        maxParticipants: normalizedCapacity,
        memberCount: 1,
        aclRevision: aclVersion,
        publicIndexRevision: normalizedVisibility === "public" ? 1 : 0,
        lastActivityAt: createdAt,
        content: normalizedContent,
        pendingContent: null,
        contentSyncState: "idle",
        createdAt,
        expiresAt,
        endedAt: null,
      });
      transaction.set(memberRef, {
        role: "owner",
        joinedAt: createdAt,
        ...ownerProfile,
      });
      if (emitAclOutbox) {
        transaction.set(
          aclOutbox.doc(`${roomId}_${actorUid}_${aclVersion}`),
          createAclOutbox({
            roomId,
            userId: actorUid,
            desiredRole: "owner",
            aclVersion,
            operation: "grant",
            createdAt,
          })
        );
      }
    });

    return createSafeRoomDto(roomId, {
      visibility: normalizedVisibility,
      status: "lobby",
      maxParticipants: normalizedCapacity,
      memberCount: 1,
      expiresAt,
      content: normalizedContent,
      contentSyncState: "idle",
    }, "owner");
  }

  async function createInvite({ actorUid, requestId, roomId, maxUses = 1, expiresInMs = inviteTtlMs } = {}) {
    requireUid(actorUid);
    requireRequestId(requestId);
    if (typeof roomId !== "string" || !roomId) throw createWatchRoomError("INVALID_ROOM", "Room ID is invalid");
    const normalizedMaxUses = Number(maxUses);
    const normalizedExpiry = Number(expiresInMs);
    if (!Number.isInteger(normalizedMaxUses) || normalizedMaxUses < 1 || normalizedMaxUses > MAX_PARTICIPANTS - 1) {
      throw createWatchRoomError("INVALID_INVITE_USES", "Invite usage limit is invalid");
    }
    if (!Number.isFinite(normalizedExpiry) || normalizedExpiry < 60_000 || normalizedExpiry > 7 * 24 * 60 * 60 * 1000) {
      throw createWatchRoomError("INVALID_INVITE_EXPIRY", "Invite expiry is invalid");
    }

    const issuedAt = now();
    const secret = randomBytes(32).toString("base64url");
    const inviteId = randomId();
    const roomRef = rooms.doc(roomId);
    const inviteRef = invites.doc(inviteId);
    const expiresAt = new Date(issuedAt.getTime() + normalizedExpiry);

    await db.runTransaction(async (transaction) => {
      const [roomSnapshot, ownerSnapshot] = await Promise.all([
        transaction.get(roomRef),
        transaction.get(roomRef.collection("members").doc(actorUid)),
      ]);
      if (!roomSnapshot.exists || !ownerSnapshot.exists || ownerSnapshot.data()?.role !== "owner") {
        throw createWatchRoomError("ROOM_OWNER_REQUIRED", "Only the room owner can create invites", 403);
      }
      const room = roomSnapshot.data() || {};
      if (!ROOM_STATUSES.has(room.status) || toMillis(room.expiresAt) <= issuedAt.getTime()) {
        throw createWatchRoomError("ROOM_NOT_JOINABLE", "Room is not joinable", 409);
      }
      transaction.set(inviteRef, {
        roomId,
        inviteHash: hashInviteSecret(secret),
        expiresAt,
        maxUses: normalizedMaxUses,
        uses: 0,
        revokedAt: null,
        createdAt: issuedAt,
        createdBy: actorUid,
      });
    });

    return { inviteId, secret, expiresAtMs: expiresAt.getTime(), maxUses: normalizedMaxUses };
  }

  async function redeemInvite({ actorUid, requestId, inviteId, secret } = {}) {
    requireUid(actorUid);
    requireRequestId(requestId);
    if (typeof inviteId !== "string" || !inviteId || typeof secret !== "string" || secret.length < 32) {
      throw createWatchRoomError("INVALID_INVITE", "Invite is invalid");
    }
    const profile = await getApprovedProfile(actorUid);
    const redeemedAt = now();
    const inviteRef = invites.doc(inviteId);

    return db.runTransaction(async (transaction) => {
      const inviteSnapshot = await transaction.get(inviteRef);
      if (!inviteSnapshot.exists) throw createWatchRoomError("INVITE_NOT_FOUND", "Invite was not found", 404);
      const invite = inviteSnapshot.data() || {};
      if (invite.revokedAt || toMillis(invite.expiresAt) <= redeemedAt.getTime()) {
        throw createWatchRoomError("INVITE_EXPIRED", "Invite has expired", 409);
      }
      if (invite.inviteHash !== hashInviteSecret(secret)) {
        throw createWatchRoomError("INVITE_INVALID", "Invite is invalid", 403);
      }

      const roomRef = rooms.doc(invite.roomId);
      const memberRef = roomRef.collection("members").doc(actorUid);
      const [roomSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(roomRef),
        transaction.get(memberRef),
      ]);
      if (!roomSnapshot.exists) throw createWatchRoomError("ROOM_NOT_FOUND", "Room was not found", 404);
      const room = roomSnapshot.data() || {};
      if (!ROOM_STATUSES.has(room.status) || toMillis(room.expiresAt) <= redeemedAt.getTime()) {
        throw createWatchRoomError("ROOM_NOT_JOINABLE", "Room is not joinable", 409);
      }
      if (memberSnapshot.exists) return createSafeRoomDto(roomRef.id, room, memberSnapshot.data()?.role || "viewer");
      if (Number(invite.uses || 0) >= Number(invite.maxUses || 0)) {
        throw createWatchRoomError("INVITE_EXHAUSTED", "Invite has no remaining uses", 409);
      }
      if (Number(room.memberCount || 0) >= Number(room.maxParticipants || MAX_PARTICIPANTS)) {
        throw createWatchRoomError("ROOM_FULL", "Room is full", 409);
      }

      const aclVersion = Number(room.aclRevision || 0) + 1;
      const publicIndexRevision = room.visibility === "public"
        ? Number(room.publicIndexRevision || 0) + 1
        : Number(room.publicIndexRevision || 0);
      transaction.update(inviteRef, { uses: Number(invite.uses || 0) + 1 });
      transaction.update(roomRef, {
        memberCount: Number(room.memberCount || 0) + 1,
        aclRevision: aclVersion,
        publicIndexRevision,
        lastActivityAt: redeemedAt,
      });
      transaction.set(memberRef, { role: "viewer", joinedAt: redeemedAt, ...profile });
      if (emitAclOutbox) {
        transaction.set(
          aclOutbox.doc(`${roomRef.id}_${actorUid}_${aclVersion}`),
          createAclOutbox({
            roomId: roomRef.id,
            userId: actorUid,
            desiredRole: "viewer",
            aclVersion,
            operation: "grant",
            createdAt: redeemedAt,
          })
        );
      }
      return createSafeRoomDto(roomRef.id, {
        ...room,
        memberCount: Number(room.memberCount || 0) + 1,
        publicIndexRevision,
      }, "viewer");
    });
  }

  async function leaveRoom({ actorUid, requestId, roomId } = {}) {
    requireUid(actorUid);
    requireRequestId(requestId);
    if (typeof roomId !== "string" || !roomId) throw createWatchRoomError("INVALID_ROOM", "Room ID is invalid");
    const leftAt = now();
    const roomRef = rooms.doc(roomId);
    const memberRef = roomRef.collection("members").doc(actorUid);

    await db.runTransaction(async (transaction) => {
      const [roomSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(roomRef),
        transaction.get(memberRef),
      ]);
      if (!roomSnapshot.exists || !memberSnapshot.exists) {
        throw createWatchRoomError("ROOM_ACCESS_DENIED", "Room membership was not found", 403);
      }
      const room = roomSnapshot.data() || {};
      if (room.ownerId === actorUid || memberSnapshot.data()?.role === "owner") {
        throw createWatchRoomError("OWNER_MUST_END_ROOM", "The owner must end the room", 409);
      }
      const aclVersion = Number(room.aclRevision || 0) + 1;
      const publicIndexRevision = room.visibility === "public"
        ? Number(room.publicIndexRevision || 0) + 1
        : Number(room.publicIndexRevision || 0);
      transaction.delete(memberRef);
      transaction.update(roomRef, {
        memberCount: Math.max(1, Number(room.memberCount || 1) - 1),
        aclRevision: aclVersion,
        publicIndexRevision,
        lastActivityAt: leftAt,
      });
      if (emitAclOutbox) {
        transaction.set(
          aclOutbox.doc(`${roomId}_${actorUid}_${aclVersion}`),
          createAclOutbox({
            roomId,
            userId: actorUid,
            desiredRole: null,
            aclVersion,
            operation: "revoke",
            createdAt: leftAt,
          })
        );
      }
    });

    return { roomId, state: "left" };
  }

  async function setMemberRole({ actorUid, requestId, roomId, targetUid, role } = {}) {
    requireUid(actorUid);
    requireRequestId(requestId);
    if (typeof roomId !== "string" || !roomId) throw createWatchRoomError("INVALID_ROOM", "Room ID is invalid");
    requireUid(targetUid);
    const normalizedRole = normalizeMemberRole(role);
    if (targetUid === actorUid) {
      throw createWatchRoomError("ROOM_ROLE_TARGET_INVALID", "The owner role cannot be changed", 403);
    }

    const changedAt = now();
    const roomRef = rooms.doc(roomId);
    const actorMemberRef = roomRef.collection("members").doc(actorUid);
    const targetMemberRef = roomRef.collection("members").doc(targetUid);

    return db.runTransaction(async (transaction) => {
      const [roomSnapshot, actorMemberSnapshot, targetMemberSnapshot] = await Promise.all([
        transaction.get(roomRef),
        transaction.get(actorMemberRef),
        transaction.get(targetMemberRef),
      ]);
      if (!roomSnapshot.exists || !actorMemberSnapshot.exists || !targetMemberSnapshot.exists) {
        throw createWatchRoomError("ROOM_ACCESS_DENIED", "Room membership was not found", 403);
      }
      const room = roomSnapshot.data() || {};
      const actorMember = actorMemberSnapshot.data() || {};
      const targetMember = targetMemberSnapshot.data() || {};
      if (room.ownerId !== actorUid || actorMember.role !== "owner") {
        throw createWatchRoomError("ROOM_OWNER_REQUIRED", "Only the room owner can change roles", 403);
      }
      if (targetMember.role === "owner") {
        throw createWatchRoomError("ROOM_ROLE_TARGET_INVALID", "The owner role cannot be changed", 403);
      }
      if (!ROOM_STATUSES.has(room.status) || toMillis(room.expiresAt) <= changedAt.getTime()) {
        throw createWatchRoomError("ROOM_NOT_JOINABLE", "Room is not active", 409);
      }
      transaction.update(targetMemberRef, { role: normalizedRole });
      transaction.update(roomRef, { lastActivityAt: changedAt });
      return {
        roomId,
        userId: targetUid,
        role: normalizedRole,
        expiresAtMs: toMillis(room.expiresAt),
      };
    });
  }

  return {
    createInvite,
    createRoom,
    getApprovedProfile,
    leaveRoom,
    redeemInvite,
    setMemberRole,
  };
}

module.exports = {
  DEFAULT_INVITE_TTL_MS,
  DEFAULT_ROOM_TTL_MS,
  MAX_PARTICIPANTS,
  createSafeRoomDto,
  createWatchRoomError,
  createWatchRoomService,
  hashInviteSecret,
  normalizeContent,
  normalizeMemberRole,
};
