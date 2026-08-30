const STAGING_ROOM_COLLECTION = "watchRoomsStaging";
const STAGING_INVITE_COLLECTION = "watchRoomsStagingInvites";
const MAX_ROOMS_PER_RUN = 50;
const MAX_MEMBERS_PER_STAGING_ROOM = 2;
const MAX_INVITES_PER_STAGING_ROOM = 1;

function createSanitizedError(failed) {
  return new Error(`Watch-room cleanup failed for ${failed} room operation(s)`);
}

function createExpiredWatchRoomCleanup({ db, getRealtimeDatabase, now = () => new Date(), logger = console } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.batch !== "function") {
    throw new Error("Firestore client is not configured");
  }
  if (typeof getRealtimeDatabase !== "function") {
    throw new Error("Realtime Database factory is not configured");
  }

  const rooms = db.collection(STAGING_ROOM_COLLECTION);
  const invites = db.collection(STAGING_INVITE_COLLECTION);

  let rtdb = null;

  function getRtdb() {
    rtdb ||= getRealtimeDatabase();
    return rtdb;
  }

  async function deleteRoom(roomSnapshot) {
    const roomId = roomSnapshot.id;
    const [membersSnapshot, invitesSnapshot] = await Promise.all([
      roomSnapshot.ref.collection("members").limit(MAX_MEMBERS_PER_STAGING_ROOM + 1).get(),
      invites.where("roomId", "==", roomId).limit(MAX_INVITES_PER_STAGING_ROOM + 1).get(),
    ]);

    if (membersSnapshot.size > MAX_MEMBERS_PER_STAGING_ROOM || invitesSnapshot.size > MAX_INVITES_PER_STAGING_ROOM) {
      return { deleted: false, unexpectedShape: true };
    }

    const updates = { [`roomLive/${roomId}`]: null };
    membersSnapshot.docs.forEach((memberSnapshot) => {
      updates[`roomAccess/${memberSnapshot.id}/${roomId}`] = null;
    });
    await getRtdb().ref().update(updates);

    const batch = db.batch();
    membersSnapshot.docs.forEach((memberSnapshot) => batch.delete(memberSnapshot.ref));
    invitesSnapshot.docs.forEach((inviteSnapshot) => batch.delete(inviteSnapshot.ref));
    batch.delete(roomSnapshot.ref);
    await batch.commit();
    return { deleted: true, unexpectedShape: false };
  }

  async function run() {
    const cutoff = now();
    const expiredSnapshot = await rooms
      .where("expiresAt", "<=", cutoff)
      .orderBy("expiresAt")
      .limit(MAX_ROOMS_PER_RUN)
      .get();
    const summary = {
      scanned: expiredSnapshot.size,
      deleted: 0,
      skippedUnexpectedShape: 0,
      failed: 0,
    };
    for (const roomSnapshot of expiredSnapshot.docs) {
      try {
        const result = await deleteRoom(roomSnapshot);
        if (result.unexpectedShape) {
          summary.skippedUnexpectedShape += 1;
          continue;
        }
        summary.deleted += 1;
      } catch {
        summary.failed += 1;
      }
    }

    logger.info?.("[WatchRoomCleanup] summary", summary);
    if (summary.scanned >= MAX_ROOMS_PER_RUN) {
      logger.warn?.("[WatchRoomCleanup] cleanup_backlog_cap", { scanned: summary.scanned });
    }
    if (summary.skippedUnexpectedShape > 0) {
      logger.warn?.("[WatchRoomCleanup] unexpected_room_shape", {
        skippedUnexpectedShape: summary.skippedUnexpectedShape,
      });
    }
    if (summary.failed > 0) {
      logger.warn?.("[WatchRoomCleanup] cleanup_failed", { failed: summary.failed });
      throw createSanitizedError(summary.failed);
    }
    return summary;
  }

  return { run };
}

module.exports = {
  MAX_INVITES_PER_STAGING_ROOM,
  MAX_MEMBERS_PER_STAGING_ROOM,
  MAX_ROOMS_PER_RUN,
  STAGING_INVITE_COLLECTION,
  STAGING_ROOM_COLLECTION,
  createExpiredWatchRoomCleanup,
};
