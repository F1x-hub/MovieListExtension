const { createWatchRoomError } = require("./watchRoomService");

const EXTENSION_ORIGIN = "chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd";

function setStagingCors(req, res) {
  const origin = req.get?.("origin");
  if (origin && origin !== EXTENSION_ORIGIN) {
    res.status(403).json({ error: "Origin is not allowed" });
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
  if (!match) throw createWatchRoomError("AUTH_REQUIRED", "Authentication is required", 401);
  return match[1];
}

function safeRequestId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw createWatchRoomError("INVALID_REQUEST_ID", "Request ID is invalid");
  }
  return value;
}

function normalizeProviderHint(value) {
  const providerHint = String(value || "kinogo").trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(providerHint)) {
    throw createWatchRoomError("INVALID_PROVIDER", "Provider is invalid");
  }
  return providerHint;
}

function normalizeProviderSource(value, providerHint) {
  if (value == null && providerHint !== "rutube") return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || providerHint !== "rutube") {
    throw createWatchRoomError("INVALID_PROVIDER_SOURCE", "Provider source is invalid");
  }
  const videoId = String(value.videoId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(videoId)
    || Number(value.version) !== 1
    || value.providerId !== "rutube") {
    throw createWatchRoomError("INVALID_PROVIDER_SOURCE", "Provider source is invalid");
  }
  return { version: 1, providerId: "rutube", videoId };
}

function roomState(room, actorUid, nowMs, providerHint = "kinogo", providerSource = null) {
  const normalizedProviderHint = normalizeProviderHint(providerHint);
  const normalizedProviderSource = normalizeProviderSource(providerSource, normalizedProviderHint);
  return {
    revision: 0,
    contentRevision: Number(room.content?.contentRevision || 1),
    phase: "paused",
    basePositionMs: 0,
    effectiveAtMs: nowMs,
    updatedBy: actorUid,
    providerHint: normalizedProviderHint,
    ...(normalizedProviderSource ? { providerSource: normalizedProviderSource } : {}),
    contentSnapshot: room.content,
  };
}

function memberDisplayName(token, requestedDisplayName = "") {
  const displayName = String(token?.name || requestedDisplayName || token?.email?.split("@")[0] || "Участник")
    .trim()
    .replace(/\s+/g, " ");
  return (displayName || "Участник").slice(0, 48);
}

async function grantRoomAccess(rtdb, { userId, room, role, displayName = "Участник", providerHint, providerSource, initializeState = false, actorUid }) {
  const nowMs = Date.now();
  const updates = {
    [`approvedRoomAccess/${userId}`]: { approved: true, updatedAtMs: nowMs },
    [`roomAccess/${userId}/${room.roomId}`]: {
      role,
      expiresAtMs: room.expiresAtMs,
      updatedAtMs: nowMs,
    },
    [`roomLive/${room.roomId}/members/${userId}`]: {
      role,
      displayName: String(displayName || "Участник").slice(0, 48),
      joinedAtMs: nowMs,
    },
  };
  if (initializeState) updates[`roomLive/${room.roomId}/state`] = roomState(room, actorUid, nowMs, providerHint, providerSource);
  await rtdb.ref().update(updates);
}

async function revokeRoomAccess(rtdb, { userId, roomId }) {
  await rtdb.ref().update({
    [`roomAccess/${userId}/${roomId}`]: null,
    [`roomLive/${roomId}/members/${userId}`]: null,
    [`roomLive/${roomId}/presence/${userId}`]: null,
    [`roomLive/${roomId}/readiness/${userId}`]: null,
  });
}

async function syncRoomMemberRole(rtdb, { userId, roomId, role }) {
  await rtdb.ref().update({
    [`roomAccess/${userId}/${roomId}/role`]: role,
    [`roomLive/${roomId}/members/${userId}/role`]: role,
  });
}

function createWatchRoomsStagingHandler({ service, verifyIdToken, getRealtimeDatabase } = {}) {
  if (!service || !verifyIdToken || !getRealtimeDatabase) {
    throw new Error("Watch-room staging handler dependencies are required");
  }

  return async (req, res) => {
    if (!setStagingCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST requests are supported" });
      return;
    }
    try {
      const token = await verifyIdToken(requireBearerToken(req));
      const actorUid = token?.uid;
      const displayName = memberDisplayName(token, req.body?.displayName);
      const action = String(req.body?.action || "");
      const requestId = safeRequestId(req.body?.requestId);
      const rtdb = getRealtimeDatabase();

      if (action === "create") {
        const inviteRequestId = `${requestId.slice(0, 120)}-invite`;
        const room = await service.createRoom({
          actorUid,
          requestId,
          visibility: "private",
          maxParticipants: 2,
          content: req.body?.content,
        });
        const invite = await service.createInvite({
          actorUid,
          requestId: inviteRequestId,
          roomId: room.roomId,
          maxUses: 1,
        });
        await grantRoomAccess(rtdb, {
          userId: actorUid,
          room,
          role: "owner",
          displayName,
          providerHint: req.body?.providerHint,
          providerSource: req.body?.providerSource,
          initializeState: true,
          actorUid,
        });
        res.status(201).json({
          room,
          joinCode: `${invite.inviteId}.${invite.secret}`,
        });
        return;
      }

      if (action === "join") {
        const joinCode = String(req.body?.joinCode || "");
        const separator = joinCode.indexOf(".");
        if (separator < 1) throw createWatchRoomError("INVALID_INVITE", "Join code is invalid");
        const room = await service.redeemInvite({
          actorUid,
          requestId,
          inviteId: joinCode.slice(0, separator),
          secret: joinCode.slice(separator + 1),
        });
        await grantRoomAccess(rtdb, { userId: actorUid, room, role: room.role, displayName });
        res.status(200).json({ room });
        return;
      }

      if (action === "leave") {
        const result = await service.leaveRoom({ actorUid, requestId, roomId: req.body?.roomId });
        await revokeRoomAccess(rtdb, { userId: actorUid, roomId: result.roomId });
        res.status(200).json(result);
        return;
      }

      if (action === "setMemberRole") {
        const result = await service.setMemberRole({
          actorUid,
          requestId,
          roomId: req.body?.roomId,
          targetUid: req.body?.targetUid,
          role: req.body?.role,
        });
        await syncRoomMemberRole(rtdb, result);
        res.status(200).json({ room: result });
        return;
      }

      throw createWatchRoomError("INVALID_ACTION", "Room action is invalid");
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      if (statusCode >= 500) console.error("[watchRoomsStaging] Request failed:", error);
      res.status(statusCode).json({
        error: statusCode >= 500 ? "Watch-room staging is temporarily unavailable" : error.message,
        code: error.code || "INTERNAL",
      });
    }
  };
}

module.exports = {
  EXTENSION_ORIGIN,
  createWatchRoomsStagingHandler,
  grantRoomAccess,
  memberDisplayName,
  normalizeProviderHint,
  normalizeProviderSource,
  revokeRoomAccess,
  setStagingCors,
  syncRoomMemberRole,
};
