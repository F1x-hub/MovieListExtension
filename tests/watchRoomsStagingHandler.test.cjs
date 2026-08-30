const assert = require('node:assert/strict');
const { grantRoomAccess, memberDisplayName, normalizeProviderHint, normalizeProviderSource, revokeRoomAccess, syncRoomMemberRole } = require('../functions/watchRoomsStaging');

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
  await syncRoomMemberRole(rtdb, { userId: 'viewer', roomId: 'room-1', role: 'controller' });
  assert.deepEqual(updates[3], {
    'roomAccess/viewer/room-1/role': 'controller',
    'roomLive/room-1/members/viewer/role': 'controller',
  });
  assert.equal(Object.keys(updates[3]).some((key) => /(?:presence|state|approvedRoomAccess)/.test(key)), false);
  console.log('watchRoomsStagingHandler.test.cjs: staging ACL is immediately mirrored to RTDB');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
