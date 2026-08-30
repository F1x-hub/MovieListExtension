const assert = require("node:assert/strict");
const {
  MAX_INVITES_PER_STAGING_ROOM,
  MAX_MEMBERS_PER_STAGING_ROOM,
  MAX_ROOMS_PER_RUN,
  createExpiredWatchRoomCleanup,
} = require("../functions/watchRoomCleanup");

function snapshot(docs) {
  return { docs, size: docs.length };
}

function makeDocument(id, { members = [], invites = [] } = {}) {
  const memberDocs = members.map((memberId) => ({ id: memberId, ref: { path: `members/${memberId}` } }));
  const inviteDocs = invites.map((inviteId) => ({ id: inviteId, ref: { path: `invites/${inviteId}` } }));
  const ref = {
    path: `rooms/${id}`,
    collection(name) {
      assert.equal(name, "members");
      return {
        limit(limit) {
          assert.equal(limit, MAX_MEMBERS_PER_STAGING_ROOM + 1);
          return { get: async () => snapshot(memberDocs) };
        },
      };
    },
  };
  return { id, ref, inviteDocs };
}

function createHarness({ roomSpecs = [], failRtdbFor = new Set(), failBatch = false } = {}) {
  const roomDocs = roomSpecs.map((spec) => makeDocument(spec.id, spec));
  const queryCalls = [];
  const batchDeletes = [];
  const rtdbUpdates = [];
  const logs = { info: [], warn: [] };
  let rtdbFactoryCalls = 0;
  const db = {
    collection(name) {
      if (name === "watchRoomsStaging") {
        return {
          where(field, operator, cutoff) {
            queryCalls.push({ field, operator, cutoff });
            return {
              orderBy(orderField) {
                queryCalls.push({ orderField });
                return {
                  limit(limit) {
                    queryCalls.push({ limit });
                    return { get: async () => snapshot(roomDocs) };
                  },
                };
              },
            };
          },
        };
      }
      assert.equal(name, "watchRoomsStagingInvites");
      return {
        where(field, operator, roomId) {
          assert.equal(field, "roomId");
          assert.equal(operator, "==");
          const roomDoc = roomDocs.find((doc) => doc.id === roomId);
          return {
            limit(limit) {
              assert.equal(limit, MAX_INVITES_PER_STAGING_ROOM + 1);
              return { get: async () => snapshot(roomDoc?.inviteDocs || []) };
            },
          };
        },
      };
    },
    batch() {
      const deleted = [];
      return {
        delete(ref) { deleted.push(ref.path); },
        async commit() {
          if (failBatch) throw new Error("batch failed");
          batchDeletes.push(deleted);
        },
      };
    },
  };
  const rtdb = {
    ref() {
      return {
        async update(value) {
          const roomId = Object.keys(value).find((key) => key.startsWith("roomLive/"))?.split("/")[1];
          if (failRtdbFor.has(roomId)) throw new Error("rtdb failed");
          rtdbUpdates.push(value);
        },
      };
    },
  };
  return {
    batchDeletes,
    logs,
    queryCalls,
    rtdbFactoryCalls: () => rtdbFactoryCalls,
    rtdbUpdates,
    cleanup: createExpiredWatchRoomCleanup({
      db,
      getRealtimeDatabase: () => { rtdbFactoryCalls += 1; return rtdb; },
      now: () => new Date("2026-08-28T00:00:00.000Z"),
      logger: {
        info: (...args) => logs.info.push(args),
        warn: (...args) => logs.warn.push(args),
      },
    }),
  };
}

(async () => {
  const normal = createHarness({ roomSpecs: [{ id: "room-1", members: ["owner", "viewer"], invites: ["invite-1"] }] });
  const summary = await normal.cleanup.run();
  assert.deepEqual(summary, { scanned: 1, deleted: 1, skippedUnexpectedShape: 0, failed: 0 });
  assert.deepEqual(normal.queryCalls.map((call) => Object.keys(call)[0]), ["field", "orderField", "limit"]);
  assert.deepEqual(normal.queryCalls[0].field, "expiresAt");
  assert.deepEqual(normal.queryCalls[0].operator, "<=");
  assert.equal(normal.queryCalls[2].limit, MAX_ROOMS_PER_RUN);
  assert.deepEqual(normal.rtdbUpdates, [{
    "roomLive/room-1": null,
    "roomAccess/owner/room-1": null,
    "roomAccess/viewer/room-1": null,
  }]);
  assert.deepEqual(normal.batchDeletes, [["members/owner", "members/viewer", "invites/invite-1", "rooms/room-1"]]);
  assert.equal(JSON.stringify(normal.logs).includes("room-1"), false);

  const noRooms = createHarness();
  assert.deepEqual(await noRooms.cleanup.run(), { scanned: 0, deleted: 0, skippedUnexpectedShape: 0, failed: 0 });
  assert.equal(noRooms.rtdbFactoryCalls(), 0);

  const malformed = createHarness({ roomSpecs: [{ id: "room-2", members: ["a", "b", "c"] }] });
  assert.deepEqual(await malformed.cleanup.run(), { scanned: 1, deleted: 0, skippedUnexpectedShape: 1, failed: 0 });
  assert.equal(malformed.rtdbFactoryCalls(), 0);
  assert.deepEqual(malformed.batchDeletes, []);
  assert.equal(malformed.logs.warn.some(([message]) => message.includes("unexpected_room_shape")), true);

  const rtdbFailure = createHarness({
    roomSpecs: [{ id: "bad-room", members: ["owner"] }, { id: "good-room", members: ["viewer"] }],
    failRtdbFor: new Set(["bad-room"]),
  });
  await assert.rejects(rtdbFailure.cleanup.run(), /failed for 1 room operation/);
  assert.deepEqual(rtdbFailure.batchDeletes, [["members/viewer", "rooms/good-room"]]);
  assert.equal(rtdbFailure.logs.warn.some(([message]) => message.includes("cleanup_failed")), true);

  const batchFailure = createHarness({ roomSpecs: [{ id: "room-3", members: ["owner"] }], failBatch: true });
  await assert.rejects(batchFailure.cleanup.run(), /failed for 1 room operation/);
  assert.deepEqual(batchFailure.rtdbUpdates, [{
    "roomLive/room-3": null,
    "roomAccess/owner/room-3": null,
  }]);

  console.log("watchRoomCleanup.test.cjs: bounded cleanup preserves ACL safety and failure isolation");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
