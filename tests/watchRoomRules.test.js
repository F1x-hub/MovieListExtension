const assert = require('assert');
const fs = require('fs');

const rtdbRules = JSON.parse(fs.readFileSync(require.resolve('../rules/database.rules.json'), 'utf8')).rules;
const firestoreRules = fs.readFileSync(require.resolve('../rules/firestore.rules'), 'utf8');
const roomLive = rtdbRules.roomLive.$roomId;

assert.strictEqual(rtdbRules['.read'], false);
assert.strictEqual(rtdbRules['.write'], false);
assert.strictEqual(rtdbRules.roomAccess.$uid['.read'].includes('auth.uid === $uid'), true);
assert.strictEqual(rtdbRules.approvedRoomAccess.$uid['.write'], false);
assert.strictEqual(roomLive.members['.write'], false);
assert.strictEqual(roomLive.state.contentSnapshot['.write'], false);
assert.strictEqual(roomLive.state.contentRevision['.write'], false);
assert.strictEqual(roomLive.state.providerHint['.write'].includes("role').val() === 'owner'"), true);
assert.strictEqual(roomLive.state.providerHint['.write'].includes("role').val() === 'controller'"), false);
assert.strictEqual(roomLive.state.providerHint['.validate'].includes('length <= 40'), true);
assert.strictEqual(roomLive.state.providerSource['.write'].includes("role').val() === 'owner'"), true);
assert.strictEqual(roomLive.state.providerSource['.write'].includes("role').val() === 'controller'"), false);
assert.strictEqual(roomLive.state.providerSource['.validate'].includes("providerId').val() === 'rutube'"), true);
assert.strictEqual(roomLive.state.providerSource['.validate'].includes("providerHint').val() === 'rutube'"), true);
assert.strictEqual(roomLive.state.providerSource['.validate'].includes('matches(/^[A-Za-z0-9_-]{8,80}$/)'), true);
assert.strictEqual(roomLive.state.providerSource.$other['.validate'], false);
assert.strictEqual(roomLive.state.phase['.write'].includes("data.val() !== 'ended'"), true);
assert.strictEqual(roomLive.state.revision['.validate'].includes('data.val() + 1'), true);
for (const field of ['revision', 'phase', 'basePositionMs', 'effectiveAtMs', 'updatedBy']) {
    assert.strictEqual(roomLive.state[field]['.write'].includes("role').val() === 'owner'"), true, `${field} retains owner timeline access`);
    assert.strictEqual(roomLive.state[field]['.write'].includes("role').val() === 'controller'"), true, `${field} permits delegated timeline access`);
}
assert.strictEqual(roomLive.presence.$uid['.validate'].includes("root.child('roomAccess')"), true);
assert.strictEqual(roomLive.presence.$uid['.write'].includes('auth.uid === $uid'), true);
assert.strictEqual(roomLive.presence.$uid['.write'].includes("child('expiresAtMs').val() > now"), true);
assert.strictEqual(roomLive.presence.$uid.displayName['.write'].includes('auth.uid === $uid'), true);
assert.strictEqual(roomLive.presence.$uid.displayName['.validate'].includes('length <= 48'), true);
assert.strictEqual(roomLive.presence.$uid.$other['.validate'], false);
assert.strictEqual(roomLive.readiness.$uid['.validate'].includes("'unavailable'"), true);
assert.deepStrictEqual(rtdbRules.publicRoomIndex['.indexOn'], ['sortKey']);
assert.deepStrictEqual(rtdbRules.publicIndexRepairQueue['.indexOn'], ['nextAttemptAt']);
assert.strictEqual(rtdbRules.publicRoomIndex['.read'].includes("query.orderByChild === 'sortKey'"), true);
assert.strictEqual(rtdbRules.publicRoomIndex['.read'].includes('query.startAt >= now'), true);
assert.strictEqual(rtdbRules.publicRoomIndex['.read'].includes('query.limitToFirst <= 20'), true);

for (const path of [
    'watchRooms/{roomId}',
    'watchRoomInvites/{inviteId}',
    'watchRoomAclOutbox/{eventId}',
    'watchRoomStateOutbox/{eventId}',
    'watchRoomApprovalOutbox/{eventId}',
    'watchRoomsStaging/{roomId}',
    'watchRoomsStagingInvites/{inviteId}',
    'watchRoomsStagingAclOutbox/{eventId}'
]) {
    assert.match(firestoreRules, new RegExp(`match /${path.replace(/[{}]/g, '\\$&')} \\{[\\s\\S]*?allow read, write: if false;`));
}

console.log('watchRoomRules.test.js: server-only room persistence and RTDB ACL contracts passed');
