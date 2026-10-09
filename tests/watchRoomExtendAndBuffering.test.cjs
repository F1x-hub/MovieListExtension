const assert = require('node:assert/strict');

let currentUid = 'owner';
global.window = {
  firebaseManager: { getCurrentUser: () => ({ uid: currentUid }) },
};

const { WatchRoomStagingController } = require('../src/shared/services/WatchRoomStagingController');

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

(async () => {
  // Expiry warning and extension.
  let clock = 0;
  const timers = new Map();
  let timerId = 0;
  const warnings = [];
  const statuses = [];
  const expiring = new WatchRoomStagingController({
    now: () => clock,
    setTimeout: (callback, delayMs) => { timerId += 1; timers.set(timerId, { callback, delayMs }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    onExpiryWarning: (warning) => warnings.push(warning),
    onStatus: (message) => statuses.push(message),
    document: null,
    window: null,
  });
  const MIN = 60_000;
  expiring.room = { roomId: 'expiring-room', expiresAtMs: 30 * MIN };
  expiring.role = 'owner';
  expiring.armRoomExpiry(expiring.room);
  assert.deepEqual(warnings, [], 'no warning while the room has plenty of time');
  assert.equal([...timers.values()].at(-1).delayMs, 20 * MIN, 'the next check is the warning moment');
  clock = 21 * MIN;
  [...timers.values()].at(-1).callback();
  assert.deepEqual(warnings.at(-1), { expiresAtMs: 30 * MIN, remainingMs: 9 * MIN, canExtend: true });

  const calls = [];
  expiring.callApi = async (action, payload) => {
    calls.push({ action, payload });
    return { roomId: 'expiring-room', expiresAtMs: 150 * MIN };
  };
  expiring.emitRoomUpdate = () => {};
  await expiring.extendRoom();
  assert.deepEqual(calls, [{ action: 'extend', payload: { roomId: 'expiring-room' } }]);
  assert.equal(expiring.room.expiresAtMs, 150 * MIN);
  assert.equal(warnings.at(-1), null, 'the warning disappears after an extension');
  assert.match(statuses.at(-1), /^Комната продлена до \d{2}:\d{2}$/);
  const statusCount = statuses.length;
  expiring.handleAccessExpiry(150 * MIN);
  expiring.handleAccessExpiry(100 * MIN);
  assert.equal(statuses.length, statusCount, 'an unchanged or older expiry is ignored');
  expiring.role = 'viewer';
  await assert.rejects(() => expiring.extendRoom(), /Продлить комнату может только её создатель/);

  // A member reports its own buffering after a short delay.
  currentUid = 'viewer';
  const readinessWrites = [];
  const member = new WatchRoomStagingController();
  member.room = { roomId: 'buffer-room' };
  member.role = 'viewer';
  member.roomState = { phase: 'playing', basePositionMs: 0, effectiveAtMs: Date.now(), updatedBy: 'owner' };
  member.readinessRef = {
    update: async (value) => readinessWrites.push(value),
    onDisconnect: () => ({ remove: async () => readinessWrites.push('arm-disconnect') }),
  };
  member.handleRoomTelemetry({ kind: 'waiting', currentTimeMs: 1_000, paused: false });
  member.handleRoomTelemetry({ kind: 'playing', currentTimeMs: 1_000, paused: false });
  await new Promise((resolve) => setTimeout(resolve, 1_700));
  assert.deepEqual(readinessWrites, [], 'a short stall is not reported');
  member.handleRoomTelemetry({ kind: 'waiting', currentTimeMs: 1_000, paused: false });
  await new Promise((resolve) => setTimeout(resolve, 1_700));
  assert.deepEqual(readinessWrites, ['arm-disconnect', { status: 'resolving', code: 'buffering' }]);
  member.handleRoomTelemetry({ kind: 'canplay', currentTimeMs: 1_000, paused: true });
  assert.deepEqual(readinessWrites.at(-1), { status: 'ready', code: 'playable' });

  // The timeline publisher pauses for a loading member and resumes after it.
  currentUid = 'owner';
  const commands = [];
  const stateWrites = [];
  const hostStatuses = [];
  const host = new WatchRoomStagingController({
    getIframe: () => ({ contentWindow: {} }),
    onStatus: (message) => hostStatuses.push(message),
  });
  host.room = { roomId: 'buffer-room' };
  host.role = 'owner';
  host.postToPlayer = (message) => commands.push(message);
  host.stateRef = { update: async (value) => stateWrites.push(value) };
  host.memberState = { owner: { role: 'owner', displayName: 'Ика' }, viewer: { role: 'viewer', displayName: 'Фикс' } };
  host.presenceState = { viewer: { v2: { c1: { lastSeenAtMs: Date.now(), role: 'viewer' } } } };
  host.roomState = { revision: 3, phase: 'playing', basePositionMs: 600_000, effectiveAtMs: Date.now(), updatedBy: 'owner' };
  host.playerSample = { positionMs: 600_500, paused: false, atMs: Date.now() };

  host.readinessState = { viewer: { status: 'resolving', code: 'buffering' } };
  host.evaluateBufferWait();
  await flush();
  assert.equal(stateWrites.at(-1).phase, 'paused', 'the room pauses while a member is loading');
  assert.ok(Math.abs(stateWrites.at(-1).basePositionMs - 600_500) < 250);
  assert.equal(commands.at(-1).action, 'pause', 'the publisher pauses its own player too');
  assert.equal(hostStatuses.at(-1), 'Ждём, пока загрузится у Фикс');
  host.handleRoomTelemetry({ kind: 'pause', currentTimeMs: 600_500, paused: true });
  await flush();
  assert.equal(stateWrites.length, 1, 'the automatic pause is not republished as a manual one');

  host.readinessState = { viewer: { status: 'ready', code: 'playable' } };
  host.evaluateBufferWait();
  await flush();
  assert.equal(stateWrites.at(-1).phase, 'playing', 'the room resumes once the member can play');
  assert.equal(stateWrites.at(-1).basePositionMs, stateWrites[0].basePositionMs, 'it resumes at the paused moment');
  assert.equal(commands.at(-1).action, 'play');

  // Cooldown: the same member cannot pause the room again right away.
  host.readinessState = { viewer: { status: 'resolving', code: 'buffering' } };
  host.evaluateBufferWait();
  await flush();
  assert.equal(stateWrites.length, 2, 'one member cannot keep pausing everyone');

  // Offline members and manual actions.
  host.bufferWaitCooldowns.clear();
  host.presenceState = {};
  host.evaluateBufferWait();
  await flush();
  assert.equal(stateWrites.length, 2, 'an offline member does not hold the room');
  host.presenceState = { viewer: { v2: { c1: { lastSeenAtMs: Date.now(), role: 'viewer' } } } };
  host.evaluateBufferWait();
  await flush();
  assert.equal(stateWrites.length, 3);
  host.ignoreRemoteTelemetryUntil = 0;
  host.expectedPlayerEffects.phase = null;
  host.handleRoomTelemetry({ kind: 'play', currentTimeMs: 600_500, paused: false });
  assert.equal(host.bufferWait, null, 'a manual action by the publisher ends the automatic wait');

  // Followers learn why the room paused.
  currentUid = 'viewer';
  const follower = new WatchRoomStagingController({ onStatus: (message) => statuses.push(message) });
  follower.room = { roomId: 'buffer-room' };
  follower.role = 'viewer';
  follower.memberState = host.memberState;
  follower.readinessState = { viewer: { status: 'resolving' } };
  const playing = { revision: 3, phase: 'playing', basePositionMs: 0, effectiveAtMs: Date.now(), updatedBy: 'owner' };
  follower.announceRemoteStateChange(playing, { ...playing, revision: 4, phase: 'paused' });
  assert.equal(statuses.at(-1), 'Ждём, пока загрузится у вас');

  console.log('watchRoomExtendAndBuffering.test.cjs: rooms can be extended and wait for loading members');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
