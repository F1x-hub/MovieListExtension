const assert = require('node:assert/strict');
const {
  STAGING_MAX_INVITE_USES,
  STAGING_MAX_PARTICIPANTS,
  createWatchRoomsStagingHandler,
  grantRoomAccess,
  memberDisplayName,
  normalizeProviderHint,
  normalizeProviderSource,
  revokeRoomAccess,
  syncRoomMemberRole,
} = require('../functions/watchRoomsStaging');

const updates = [];
const rtdb = {
  ref() {
    return { update: async (value) => updates.push(value) };
  },
};

(async () => {
  const room = {
    roomId: 'room-1',
    expiresAtMs: Date.now() + 60_000,
    content: {
      kinopoiskId: 2976,
      mediaType: 'movie',
      title: 'Фаворит',
      contentRevision: 1,
      timelineProfile: 'native-video-v1',
    },
  };

  await grantRoomAccess(rtdb, {
    userId: 'owner', room, role: 'owner', displayName: 'Фикс', providerHint: 'exfs', initializeState: true, actorUid: 'owner',
  });
  assert.equal(updates[0]['approvedRoomAccess/owner'].approved, true);
  assert.equal(updates[0]['roomAccess/owner/room-1'].role, 'owner');
  assert.equal(updates[0]['roomLive/room-1/state'].contentSnapshot.kinopoiskId, 2976);
  assert.equal(updates[0]['roomLive/room-1/state'].providerHint, 'exfs');
  assert.deepEqual(updates[0]['roomLive/room-1/members/owner'], {
    role: 'owner', displayName: 'Фикс', joinedAtMs: updates[0]['roomLive/room-1/members/owner'].joinedAtMs,
  });
  assert.equal(memberDisplayName({ name: '  Ика   Тест  ' }), 'Ика Тест');
  assert.equal(memberDisplayName({}, '  Второй   пользователь '), 'Второй пользователь');
  assert.equal(memberDisplayName({ email: 'viewer@example.com' }), 'viewer');
  assert.equal(memberDisplayName({}), 'Участник');
  assert.equal(normalizeProviderHint(' KinoGo '), 'kinogo');
  assert.throws(() => normalizeProviderHint('https://example.invalid'), /Provider is invalid/);
  assert.deepEqual(normalizeProviderSource({ version: 1, providerId: 'rutube', videoId: 'a1b2c3d4e5f6' }, 'rutube'), {
    version: 1, providerId: 'rutube', videoId: 'a1b2c3d4e5f6',
  });
  assert.throws(() => normalizeProviderSource({ version: 1, providerId: 'rutube', videoId: 'https://leak.invalid' }, 'rutube'), /Provider source is invalid/);
  assert.equal(Object.keys(updates[0]).some((key) => /(?:url|token|cookie)/i.test(key)), false);

  await grantRoomAccess(rtdb, {
    userId: 'rutube-owner', room, role: 'owner', displayName: 'Фикс', providerHint: 'rutube',
    providerSource: { version: 1, providerId: 'rutube', videoId: 'a1b2c3d4e5f6' }, initializeState: true, actorUid: 'rutube-owner',
  });
  assert.deepEqual(updates[1]['roomLive/room-1/state'].providerSource, {
    version: 1, providerId: 'rutube', videoId: 'a1b2c3d4e5f6',
  });

  await revokeRoomAccess(rtdb, { userId: 'viewer', roomId: 'room-1' });
  assert.equal(updates[2]['roomAccess/viewer/room-1'], null);
  assert.equal(updates[2]['roomLive/room-1/presence/viewer'], null);
  assert.equal(updates[2]['roomLive/room-1/presenceV2/viewer'], null);
  await syncRoomMemberRole(rtdb, { userId: 'viewer', roomId: 'room-1', role: 'controller' });
  assert.deepEqual(updates[3], {
    'roomAccess/viewer/room-1/role': 'controller',
    'roomLive/room-1/members/viewer/role': 'controller',
  });
  assert.equal(Object.keys(updates[3]).some((key) => /(?:presence|state|approvedRoomAccess)/.test(key)), false);
  assert.equal(STAGING_MAX_PARTICIPANTS, 10);
  assert.equal(STAGING_MAX_INVITE_USES, 9);

  let createdRoomArgs;
  const handler = createWatchRoomsStagingHandler({
    verifyIdToken: async () => ({ uid: 'owner', name: 'Owner' }),
    getRealtimeDatabase: () => rtdb,
    service: {
      createRoomWithInvite: async (args) => {
        createdRoomArgs = args;
        return {
          room: {
            roomId: 'handler-room',
            role: 'owner',
            expiresAtMs: Date.now() + 60_000,
            content: room.content,
          },
          joinCode: 'invite-1.secret',
        };
      },
    },
  });
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; },
    send(value) { this.body = value; },
    set() {},
  };
  await handler({
    method: 'POST',
    body: { action: 'create', requestId: 'handler-create-0001' },
    get(header) { return header === 'authorization' ? 'Bearer token' : ''; },
  }, response);
  assert.equal(createdRoomArgs.maxParticipants, STAGING_MAX_PARTICIPANTS);
  assert.equal(createdRoomArgs.maxUses, STAGING_MAX_INVITE_USES);
  assert.equal(response.statusCode, 201);
  console.log('watchRoomsStagingHandler.test.cjs: staging ACL is immediately mirrored to RTDB');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
