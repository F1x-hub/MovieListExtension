const assert = require("assert");
const { createWatchRoomService } = require("../functions/watchRoomService");

class FakeSnapshot {
  constructor(ref, data) {
    this.id = ref.id;
    this.exists = data !== undefined;
    this._data = data;
  }

  data() {
    return this._data && { ...this._data };
  }
}

class FakeRef {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  collection(name) {
    return new FakeCollection(this.db, `${this.path}/${name}`);
  }

  async get() {
    return new FakeSnapshot(this, this.db.docs.get(this.path));
  }
}

class FakeCollection {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  doc(id) {
    return new FakeRef(this.db, `${this.path}/${id}`);
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
  }

  async get(ref) {
    return new FakeSnapshot(ref, this.db.docs.get(ref.path));
  }

  set(ref, data) {
    this.db.docs.set(ref.path, { ...data });
  }

  update(ref, patch) {
    const current = this.db.docs.get(ref.path);
    if (!current) throw new Error(`Missing document ${ref.path}`);
    this.db.docs.set(ref.path, { ...current, ...patch });
  }

  delete(ref) {
    this.db.docs.delete(ref.path);
  }
}

class FakeDb {
  constructor() {
    this.docs = new Map();
  }

  collection(name) {
    return new FakeCollection(this, name);
  }

  async runTransaction(callback) {
    return callback(new FakeTransaction(this));
  }
}

const now = new Date("2026-08-27T12:00:00.000Z");
const db = new FakeDb();
db.docs.set("users/owner", { approvalStatus: "approved", displayName: "Owner", photoURL: "https://image.example/owner" });
db.docs.set("users/viewer", { approvalStatus: "approved", displayName: "Viewer" });
db.docs.set("users/pending", { approvalStatus: "pending", displayName: "Pending" });

let sequence = 0;
const service = createWatchRoomService({
  db,
  now: () => now,
  randomId: () => `id-${++sequence}`,
  randomBytes: () => Buffer.alloc(32, 7),
});

(async () => {
  const room = await service.createRoom({
    actorUid: "owner",
    requestId: "create-request-0001",
    visibility: "private",
    content: { kinopoiskId: 2976, mediaType: "movie", title: "Фаворит" },
  });
  assert.deepStrictEqual(room.role, "owner");
  assert.strictEqual(room.status, "lobby");
  assert.strictEqual(db.docs.get("watchRooms/id-1").memberCount, 1);
  assert.deepStrictEqual(db.docs.get("watchRooms/id-1").content, {
    kinopoiskId: 2976,
    mediaType: "movie",
    title: "Фаворит",
    contentRevision: 1,
    timelineProfile: "native-video-v1",
  });
  assert.strictEqual(db.docs.get("watchRoomAclOutbox/id-1_owner_1").desiredRole, "owner");

  const invite = await service.createInvite({
    actorUid: "owner",
    requestId: "invite-request-0001",
    roomId: "id-1",
  });
  const storedInvite = db.docs.get("watchRoomInvites/id-2");
  assert.strictEqual(storedInvite.inviteHash.includes(invite.secret), false, "Raw invite secret must never persist");
  assert.match(storedInvite.inviteHash, /^[a-f0-9]{64}$/);

  const joined = await service.redeemInvite({
    actorUid: "viewer",
    requestId: "redeem-request-0001",
    inviteId: invite.inviteId,
    secret: invite.secret,
  });
  assert.strictEqual(joined.role, "viewer");
  assert.strictEqual(db.docs.get("watchRooms/id-1").memberCount, 2);
  assert.strictEqual(db.docs.get("watchRoomAclOutbox/id-1_viewer_2").desiredRole, "viewer");

  const promoted = await service.setMemberRole({
    actorUid: "owner",
    requestId: "promote-request-0001",
    roomId: "id-1",
    targetUid: "viewer",
    role: "controller",
  });
  assert.deepStrictEqual(promoted, {
    roomId: "id-1",
    userId: "viewer",
    role: "controller",
    expiresAtMs: now.getTime() + (4 * 60 * 60 * 1000),
  });
  assert.strictEqual(db.docs.get("watchRooms/id-1/members/viewer").role, "controller");
  assert.strictEqual(db.docs.get("watchRooms/id-1").lastActivityAt.getTime(), now.getTime());
  await service.setMemberRole({
    actorUid: "owner",
    requestId: "demote-request-0001",
    roomId: "id-1",
    targetUid: "viewer",
    role: "viewer",
  });
  assert.strictEqual(db.docs.get("watchRooms/id-1/members/viewer").role, "viewer");
  await assert.rejects(
    () => service.setMemberRole({ actorUid: "owner", requestId: "self-role-request-01", roomId: "id-1", targetUid: "owner", role: "controller" }),
    (error) => error.code === "ROOM_ROLE_TARGET_INVALID"
  );
  await assert.rejects(
    () => service.setMemberRole({ actorUid: "viewer", requestId: "guest-role-request-1", roomId: "id-1", targetUid: "owner", role: "viewer" }),
    (error) => error.code === "ROOM_OWNER_REQUIRED"
  );
  await assert.rejects(
    () => service.setMemberRole({ actorUid: "owner", requestId: "invalid-role-request", roomId: "id-1", targetUid: "viewer", role: "owner" }),
    (error) => error.code === "INVALID_MEMBER_ROLE"
  );
  db.docs.get("watchRooms/id-1").expiresAt = new Date(now.getTime() - 1);
  await assert.rejects(
    () => service.setMemberRole({ actorUid: "owner", requestId: "expired-role-request", roomId: "id-1", targetUid: "viewer", role: "controller" }),
    (error) => error.code === "ROOM_NOT_JOINABLE"
  );
  db.docs.get("watchRooms/id-1").expiresAt = new Date(now.getTime() + (4 * 60 * 60 * 1000));

  await assert.rejects(
    () => service.redeemInvite({ actorUid: "pending", requestId: "redeem-request-0002", inviteId: invite.inviteId, secret: invite.secret }),
    (error) => error.code === "APPROVAL_REQUIRED"
  );
  await assert.rejects(
    () => service.leaveRoom({ actorUid: "owner", requestId: "leave-request-0001", roomId: "id-1" }),
    (error) => error.code === "OWNER_MUST_END_ROOM"
  );

  const left = await service.leaveRoom({ actorUid: "viewer", requestId: "leave-request-0002", roomId: "id-1" });
  assert.deepStrictEqual(left, { roomId: "id-1", state: "left" });
  assert.strictEqual(db.docs.get("watchRooms/id-1").memberCount, 1);
  assert.strictEqual(db.docs.has("watchRooms/id-1/members/viewer"), false);
  assert.strictEqual(db.docs.get("watchRoomAclOutbox/id-1_viewer_3").desiredRole, null);

  const stagingDb = new FakeDb();
  stagingDb.docs.set("users/owner", { approvalStatus: "approved", displayName: "Owner" });
  const stagingService = createWatchRoomService({
    db: stagingDb,
    now: () => now,
    randomId: () => "staging-room",
    randomBytes: () => Buffer.alloc(32, 7),
    collectionPrefix: "watchRoomsStaging",
    emitAclOutbox: false,
  });
  await stagingService.createRoom({
    actorUid: "owner",
    requestId: "staging-create-0001",
    content: { kinopoiskId: 2976, mediaType: "movie", title: "Фаворит" },
  });
  assert.strictEqual(stagingDb.docs.has("watchRoomsStagingAclOutbox/staging-room_owner_1"), false);

  console.log("watchRoomService.test.cjs: durable room, invite, join, and leave contracts passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
