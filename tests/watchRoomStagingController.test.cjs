const assert = require('node:assert/strict');
const fs = require('node:fs');
const { WatchRoomStagingController } = require('../src/shared/services/WatchRoomStagingController');

const listeners = new Map();
const listenerErrors = new Map();
const writes = [];
const updatesToRtdb = [];
const presenceLifecycle = [];
const rtdb = {
  ref(path = '') {
    return {
      on(event, callback, cancelCallback) {
        listeners.set(`${path}:${event}`, callback);
        listenerErrors.set(`${path}:${event}`, cancelCallback);
      },
      off() {},
      set(value) { writes.push({ path, value }); presenceLifecycle.push(`${path}:set`); return Promise.resolve(); },
      update(value) { updatesToRtdb.push({ path, value }); return Promise.resolve(); },
      remove() { writes.push({ path, value: null }); return Promise.resolve(); },
      onDisconnect() {
        return {
          remove: () => { presenceLifecycle.push(`${path}:arm-disconnect`); return Promise.resolve(); },
          cancel: () => { presenceLifecycle.push(`${path}:cancel-disconnect`); return Promise.resolve(); },
        };
      },
    };
  },
};

const updates = [];
global.window = {
  firebaseManager: {
    getCurrentUser: () => ({ uid: 'owner' }),
    getRealtimeDatabase: () => rtdb,
  },
};
global.chrome = {
  storage: {
    local: {
      get: async () => ({
        userDisplayCache: { uid: 'owner', displayName: 'Фикс', timestamp: Date.now() },
      }),
    },
  },
};
global.document = {
  getElementById: (id) => id === 'navUserName' ? { textContent: 'Ика' } : null,
};

(async () => {
  const controller = new WatchRoomStagingController({
    onRoomUpdate: (update) => updates.push(update),
  });
  assert.equal(await controller.currentUserDisplayName({ uid: 'owner', displayName: '', email: null }), 'Фикс');
  assert.equal(await controller.currentUserDisplayName({ uid: 'viewer', displayName: '', email: null }), 'Ика');
  controller.probePlayer = async () => ({
    capabilities: { observeTime: true, play: true, pause: true, seek: true, duration: true },
  });
  controller.postToPlayer = () => {};

  await controller.connect({ roomId: 'room-1', expiresAtMs: Date.now() + 60_000 }, 'owner');
  assert.deepEqual(writes[0], {
    path: 'roomLive/room-1/presence/owner',
    value: { connectedAtMs: writes[0].value.connectedAtMs, role: 'owner', displayName: 'Фикс' },
  });
  assert.deepEqual(presenceLifecycle.slice(0, 2), [
    'roomLive/room-1/presence/owner:arm-disconnect',
    'roomLive/room-1/presence/owner:set',
  ]);

  listeners.get('roomLive/room-1/state:value')({ val: () => ({
    providerHint: 'kinogo', phase: 'paused', basePositionMs: 0, effectiveAtMs: Date.now(), revision: 0,
  }) });
  controller.publishHostTelemetry({ kind: 'play', currentTimeMs: 1_000 });
  controller.publishHostProvider('exfs');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updatesToRtdb.at(-1), {
    path: 'roomLive/room-1/state',
    value: {
      phase: 'playing', basePositionMs: 1_000, effectiveAtMs: updatesToRtdb.at(-1).value.effectiveAtMs,
      providerHint: 'exfs', providerSource: null, revision: 1, updatedBy: 'owner',
    },
  });
  controller.publishHostProvider('rutube');
  controller.publishHostProvider('kinogo');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updatesToRtdb.at(-1).value.revision, 2);
  assert.equal(updatesToRtdb.at(-1).value.providerHint, 'kinogo');
  assert.equal(updatesToRtdb.at(-1).value.providerSource, null);

  controller.publishHostProvider('rutube', { version: 1, providerId: 'rutube', videoId: 'a1b2c3d4e5f6' });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updatesToRtdb.at(-1).value.providerSource, {
    version: 1, providerId: 'rutube', videoId: 'a1b2c3d4e5f6',
  });

  listeners.get('roomLive/room-1/members:value')({ val: () => ({
    owner: { role: 'owner', displayName: 'Фикс' },
    controller: { role: 'controller', displayName: 'Помощник' },
    viewer: { role: 'viewer', displayName: 'Участник' },
  }) });
  listeners.get('roomLive/room-1/presence:value')({ val: () => ({ viewer: { role: 'viewer', displayName: 'Ика' } }) });

  assert.deepEqual(updates.at(-1).members, [
    { uid: 'owner', role: 'owner', displayName: 'Фикс', online: false, isCurrentUser: true },
    { uid: 'controller', role: 'controller', displayName: 'Помощник', online: false, isCurrentUser: false },
    { uid: 'viewer', role: 'viewer', displayName: 'Ика', online: true, isCurrentUser: false },
  ]);
  controller.disconnect(false);

  const providerChanges = [];
  const playerCommands = [];
  let activeViewerProvider = 'kinogo';
  global.window.firebaseManager.getCurrentUser = () => ({ uid: 'viewer' });
  const viewer = new WatchRoomStagingController({
    getProviderId: () => activeViewerProvider,
    onProviderChange: async (providerId) => {
      providerChanges.push(providerId);
      activeViewerProvider = providerId;
      return true;
    },
  });
  viewer.probePlayer = async () => ({
    capabilities: { observeTime: true, play: true, pause: true, seek: true, duration: true },
  });
  viewer.postToPlayer = (message) => playerCommands.push(message);
  await viewer.connect({ roomId: 'room-1', expiresAtMs: Date.now() + 60_000 }, 'viewer');
  listeners.get('roomLive/room-1/state:value')({ val: () => ({
    providerHint: 'exfs', phase: 'paused', basePositionMs: 1_000, effectiveAtMs: Date.now(), revision: 2,
  }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(providerChanges, ['exfs']);
  assert.equal(playerCommands.some((command) => command.type === 'ROOM_SYNC_COMMAND' && command.action === 'pause'), true);
  const viewerStatuses = [];
  viewer.onStatus = (message) => viewerStatuses.push(message);
  listenerErrors.get('roomLive/room-1/state:value')({ code: 'permission_denied', message: 'Permission denied' });
  assert.equal(viewerStatuses.at(-1), 'Нет доступа к состоянию комнаты: Permission denied');
  viewer.disconnect(false);

  const sameProviderChanges = [];
  const sameProviderCommands = [];
  const sameProviderViewer = new WatchRoomStagingController({
    getProviderId: () => 'kinogo',
    onProviderChange: async (providerId) => { sameProviderChanges.push(providerId); return true; },
  });
  sameProviderViewer.probePlayer = async () => ({
    capabilities: { observeTime: true, play: true, pause: true, seek: true, duration: true },
  });
  sameProviderViewer.postToPlayer = (message) => sameProviderCommands.push(message);
  await sameProviderViewer.connect({ roomId: 'room-1', expiresAtMs: Date.now() + 60_000 }, 'viewer');
  listeners.get('roomLive/room-1/state:value')({ val: () => ({
    providerHint: 'kinogo', phase: 'paused', basePositionMs: 1_000, effectiveAtMs: Date.now(), revision: 3,
  }) });
  assert.deepEqual(sameProviderChanges, []);
  assert.equal(sameProviderCommands.some((command) => command.type === 'ROOM_SYNC_COMMAND' && command.action === 'pause'), true);
  sameProviderViewer.disconnect(false);

  const delegatedTimelineWrites = [];
  const delegatedController = new WatchRoomStagingController();
  delegatedController.room = { roomId: 'delegated-room' };
  delegatedController.roomState = { revision: 0, phase: 'paused', providerHint: 'kinogo' };
  delegatedController.stateRef = { update: async (value) => delegatedTimelineWrites.push(value) };
  delegatedController.role = 'viewer';
  delegatedController.publishHostTelemetry({ kind: 'play', currentTimeMs: 1_000 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delegatedTimelineWrites.length, 0, 'a viewer cannot publish shared timeline state');
  delegatedController.role = 'controller';
  delegatedController.publishHostTelemetry({ kind: 'play', currentTimeMs: 1_000 });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delegatedTimelineWrites.length, 1, 'a controller can publish shared timeline state');
  delegatedController.publishHostProvider('exfs');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delegatedTimelineWrites.length, 1, 'a controller cannot publish a source change');

  const roleActionController = new WatchRoomStagingController();
  roleActionController.room = { roomId: 'role-action-room' };
  roleActionController.role = 'owner';
  let roleActionRequest = null;
  roleActionController.callApi = async (action, payload) => {
    roleActionRequest = { action, payload };
    return { room: { roomId: 'role-action-room', userId: 'viewer', role: 'controller' } };
  };
  assert.deepEqual(await roleActionController.setMemberRole('viewer', 'controller'), {
    roomId: 'role-action-room', userId: 'viewer', role: 'controller',
  });
  assert.deepEqual(roleActionRequest, {
    action: 'setMemberRole',
    payload: { roomId: 'role-action-room', targetUid: 'viewer', role: 'controller' },
  });
  roleActionController.role = 'viewer';
  await assert.rejects(
    () => roleActionController.setMemberRole('viewer', 'controller'),
    /Только создатель комнаты может менять роли/
  );

  const roleUpdateController = new WatchRoomStagingController();
  roleUpdateController.probePlayer = async () => ({
    capabilities: { observeTime: true, play: true, pause: true, seek: true, duration: true },
  });
  roleUpdateController.postToPlayer = () => {};
  await roleUpdateController.connect({ roomId: 'role-update-room', expiresAtMs: Date.now() + 60_000 }, 'viewer');
  listeners.get('roomLive/role-update-room/members:value')({ val: () => ({ viewer: { role: 'controller', displayName: 'Ика' } }) });
  assert.equal(roleUpdateController.role, 'controller', 'membership snapshot updates the active participant role');
  listeners.get('roomLive/role-update-room/members:value')({ val: () => ({ viewer: { role: 'viewer', displayName: 'Ика' } }) });
  assert.equal(roleUpdateController.role, 'viewer', 'membership snapshot revokes delegated control');
  roleUpdateController.disconnect(false);

  const controllerFollowerCommands = [];
  const followerController = new WatchRoomStagingController();
  followerController.probePlayer = async () => ({
    capabilities: { observeTime: true, play: true, pause: true, seek: true, duration: true },
  });
  followerController.postToPlayer = (message) => controllerFollowerCommands.push(message);
  await followerController.connect({ roomId: 'controller-follows-owner-room', expiresAtMs: Date.now() + 60_000 }, 'controller');
  followerController.activeProviderHint = 'kinogo';
  listeners.get('roomLive/controller-follows-owner-room/state:value')({ val: () => ({
    providerHint: 'kinogo', phase: 'paused', basePositionMs: 1_000, effectiveAtMs: Date.now(), revision: 1, updatedBy: 'owner',
  }) });
  assert.equal(controllerFollowerCommands.some((message) => message.action === 'pause'), true,
    'a controller applies a state change published by the owner');
  const controllerCommandsAfterOwnerState = controllerFollowerCommands.length;
  listeners.get('roomLive/controller-follows-owner-room/state:value')({ val: () => ({
    providerHint: 'kinogo', phase: 'playing', basePositionMs: 2_000, effectiveAtMs: Date.now(), revision: 2, updatedBy: 'viewer',
  }) });
  assert.equal(controllerFollowerCommands.length, controllerCommandsAfterOwnerState,
    'a controller does not reapply its own acknowledged state');
  let remoteTelemetryPublishCount = 0;
  followerController.publishHostTelemetry = () => { remoteTelemetryPublishCount += 1; };
  followerController.handleRoomTelemetry({ kind: 'pause', currentTimeMs: 1_000 });
  assert.equal(remoteTelemetryPublishCount, 0, 'a remote player command does not echo into a controller write');
  followerController.disconnect(false);

  const ownerFollowerCommands = [];
  global.window.firebaseManager.getCurrentUser = () => ({ uid: 'owner' });
  const ownerFollower = new WatchRoomStagingController();
  let ownerProviderSwitches = 0;
  ownerFollower.onProviderChange = async () => {
    ownerProviderSwitches += 1;
    return true;
  };
  ownerFollower.probePlayer = async () => ({
    capabilities: { observeTime: true, play: true, pause: true, seek: true, duration: true },
  });
  ownerFollower.postToPlayer = (message) => ownerFollowerCommands.push(message);
  await ownerFollower.connect({ roomId: 'owner-follows-controller-room', expiresAtMs: Date.now() + 60_000 }, 'owner');
  const ownerCommandsBeforeLegacyState = ownerFollowerCommands.length;
  listeners.get('roomLive/owner-follows-controller-room/state:value')({ val: () => ({
    providerHint: 'kinogo', phase: 'paused', basePositionMs: 0, effectiveAtMs: Date.now(), revision: 0,
  }) });
  assert.equal(ownerFollowerCommands.length, ownerCommandsBeforeLegacyState,
    'an owner does not treat a legacy state without an author as remote control');
  listeners.get('roomLive/owner-follows-controller-room/state:value')({ val: () => ({
    providerHint: 'kinogo', phase: 'playing', basePositionMs: 3_000, effectiveAtMs: Date.now(), revision: 1, updatedBy: 'viewer',
  }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ownerFollowerCommands.some((message) => message.action === 'play'), true,
    'an owner applies a timeline state published by a controller');
  assert.equal(ownerProviderSwitches, 0,
    'an owner does not remount the source when applying a controller timeline state');
  ownerFollower.disconnect(false);
  global.window.firebaseManager.getCurrentUser = () => ({ uid: 'viewer' });

  let viewerProvider = 'exfs';
  let finishProviderChange;
  const readySignalCommands = [];
  const readySignalViewer = new WatchRoomStagingController({
    getProviderId: () => viewerProvider,
    onProviderChange: () => new Promise((resolve) => { finishProviderChange = resolve; }),
  });
  readySignalViewer.probePlayer = async () => ({
    capabilities: { observeTime: true, play: true, pause: true, seek: true, duration: true },
  });
  readySignalViewer.postToPlayer = (message) => readySignalCommands.push(message);
  await readySignalViewer.connect({ roomId: 'room-1', expiresAtMs: Date.now() + 60_000 }, 'viewer');
  listeners.get('roomLive/room-1/state:value')({ val: () => ({
    providerHint: 'kinogo', phase: 'paused', basePositionMs: 1_000, effectiveAtMs: Date.now(), revision: 4,
  }) });
  await new Promise((resolve) => setImmediate(resolve));
  viewerProvider = 'kinogo';
  readySignalViewer.refreshPlayerBridge();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(readySignalViewer.activeProviderHint, 'kinogo');
  assert.equal(readySignalCommands.some((command) => command.type === 'ROOM_SYNC_COMMAND' && command.action === 'pause'), true);
  finishProviderChange(true);
  await new Promise((resolve) => setImmediate(resolve));
  readySignalViewer.disconnect(false);

  let iframeProvider = 'exfs';
  const iframeCommands = [];
  const iframeAwaitingViewer = new WatchRoomStagingController({
    getIframe: () => ({ contentWindow: {} }),
    getProviderId: () => iframeProvider,
    onProviderChange: async (providerId) => { iframeProvider = providerId; return true; },
  });
  iframeAwaitingViewer.probePlayer = async () => ({
    capabilities: { observeTime: true, play: true, pause: true, seek: true, duration: true },
  });
  iframeAwaitingViewer.postToPlayer = (message) => iframeCommands.push(message);
  await iframeAwaitingViewer.connect({ roomId: 'room-1', expiresAtMs: Date.now() + 60_000 }, 'viewer');
  listeners.get('roomLive/room-1/state:value')({ val: () => ({
    providerHint: 'kinogo', phase: 'paused', basePositionMs: 1_000, effectiveAtMs: Date.now(), revision: 5,
  }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(iframeCommands.some((command) => command.type === 'ROOM_SYNC_COMMAND'), false);
  iframeAwaitingViewer.refreshPlayerBridge();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(iframeCommands.some((command) => command.type === 'ROOM_SYNC_COMMAND' && command.action === 'pause'), true);
  iframeAwaitingViewer.disconnect(false);

  let probeAttempts = 0;
  const retryProbeController = new WatchRoomStagingController({ getIframe: () => ({ contentWindow: {} }) });
  retryProbeController.probeIframe = async () => {
    probeAttempts += 1;
    return {
      capabilities: probeAttempts === 1
        ? { observeTime: true, play: true, pause: true, seek: false, duration: false }
        : { observeTime: true, play: true, pause: true, seek: true, duration: true },
    };
  };
  await retryProbeController.probePlayer();
  assert.equal(probeAttempts, 2);

  let paused = false;
  let played = false;
  const directVideo = {
    currentTime: 0,
    readyState: 1,
    duration: 120,
    addEventListener() {},
    removeEventListener() {},
    pause() { paused = true; },
    play() { played = true; return Promise.resolve(); },
  };
  const directController = new WatchRoomStagingController({ getVideo: () => directVideo });
  const directProbe = await directController.probePlayer();
  assert.equal(directProbe.nativeVideo, true);
  directController.postToPlayer({ type: 'ROOM_SYNC_COMMAND', action: 'seek', positionMs: 12_500 });
  directController.postToPlayer({ type: 'ROOM_SYNC_COMMAND', action: 'pause' });
  directController.postToPlayer({ type: 'ROOM_SYNC_COMMAND', action: 'play' });
  assert.equal(directVideo.currentTime, 12.5);
  assert.equal(paused, true);
  assert.equal(played, true);
  const localPreferencesBefore = {
    currentTime: directVideo.currentTime,
    paused,
    played,
  };
  directController.postToPlayer({
    type: 'ROOM_SYNC_COMMAND',
    action: 'set-quality',
    quality: '1080p',
    audioTrack: 'dubbed',
    subtitleTrack: 'ru',
    volume: 0.2,
    playbackRate: 1.5,
  });
  assert.deepEqual({ currentTime: directVideo.currentTime, paused, played }, localPreferencesBefore,
    'room commands cannot change player preferences');

  const localPreferenceCommands = [];
  const localPreferenceStateController = new WatchRoomStagingController();
  localPreferenceStateController.role = 'viewer';
  localPreferenceStateController.postToPlayer = (message) => localPreferenceCommands.push(message);
  localPreferenceStateController.applyRoomState({
    phase: 'paused',
    basePositionMs: 4_000,
    effectiveAtMs: Date.now(),
    audioTrack: 'original',
    subtitleTrack: 'en',
    quality: '2160p',
    volume: 0.5,
    playbackRate: 1.25,
  });
  assert.deepEqual(localPreferenceCommands.map(({ type, action, positionMs }) => ({ type, action, positionMs })), [
    { type: 'ROOM_SYNC_COMMAND', action: 'seek', positionMs: 4_000 },
    { type: 'ROOM_SYNC_COMMAND', action: 'pause', positionMs: undefined },
  ], 'room state sends only the timeline command fields to a player');

  const iframeSubscriptions = [];
  let activeIframe = {
    contentWindow: {
      postMessage(message) { iframeSubscriptions.push({ iframe: 'first', message }); },
    },
  };
  const iframeController = new WatchRoomStagingController({
    getIframe: () => activeIframe,
  });
  iframeController.room = { roomId: 'room-1' };
  iframeController.subscriptionId = 'room-sync-subscription-123456';
  iframeController.refreshPlayerBridge();
  activeIframe = {
    contentWindow: {
      postMessage(message) { iframeSubscriptions.push({ iframe: 'replacement', message }); },
    },
  };
  iframeController.refreshPlayerBridge();
  assert.deepEqual(iframeSubscriptions, [
    { iframe: 'first', message: { type: 'ROOM_SYNC_SUBSCRIBE', subscriptionId: 'room-sync-subscription-123456' } },
    { iframe: 'replacement', message: { type: 'ROOM_SYNC_SUBSCRIBE', subscriptionId: 'room-sync-subscription-123456' } },
  ]);

  global.window.firebaseManager.getCurrentUser = () => ({ uid: 'owner' });
  const expiryTimers = new Map();
  const expiryWindowListeners = new Map();
  const expiryDocumentListeners = new Map();
  let expiryTimerId = 0;
  let clock = 1_000;
  const expiryUpdates = [];
  const expiryStatuses = [];
  const expiryController = new WatchRoomStagingController({
    now: () => clock,
    setTimeout: (callback) => {
      expiryTimerId += 1;
      expiryTimers.set(expiryTimerId, callback);
      return expiryTimerId;
    },
    clearTimeout: (timerId) => expiryTimers.delete(timerId),
    document: {
      hidden: false,
      addEventListener: (event, callback) => expiryDocumentListeners.set(event, callback),
      removeEventListener: (event) => expiryDocumentListeners.delete(event),
    },
    window: {
      addEventListener: (event, callback) => expiryWindowListeners.set(event, callback),
      removeEventListener: (event) => expiryWindowListeners.delete(event),
    },
    onRoomUpdate: (update) => expiryUpdates.push(update),
    onStatus: (status) => expiryStatuses.push(status),
  });
  expiryController.probePlayer = async () => ({
    capabilities: { observeTime: true, play: true, pause: true, seek: true, duration: true },
  });
  expiryController.postToPlayer = () => {};
  await expiryController.connect({ roomId: 'expiry-room', expiresAtMs: 1_100 }, 'owner');
  const staleExpiryCallback = expiryTimers.values().next().value;
  const writesBeforeExpiry = writes.length;
  const lifecycleBeforeExpiry = presenceLifecycle.length;
  clock = 1_100;
  expiryWindowListeners.get('focus')();
  assert.equal(expiryController.room, null);
  assert.equal(expiryStatuses.at(-1), 'Время комнаты истекло');
  assert.deepEqual(expiryUpdates.at(-1), { roomId: null, role: null, members: [] });
  assert.equal(writes.length, writesBeforeExpiry, 'expiry does not remove presence');
  assert.equal(presenceLifecycle.length, lifecycleBeforeExpiry, 'expiry keeps onDisconnect registered');
  assert.equal(expiryWindowListeners.size, 0);
  assert.equal(expiryDocumentListeners.size, 0);

  clock = 1_200;
  await expiryController.connect({ roomId: 'new-room', expiresAtMs: 2_000 }, 'owner');
  staleExpiryCallback();
  assert.equal(expiryController.room.roomId, 'new-room', 'a stale expiry callback cannot close a new room');
  expiryController.disconnect(false);
  assert.equal(presenceLifecycle.at(-1), 'roomLive/new-room/presence/owner:cancel-disconnect');
  assert.equal(writes.at(-1).path, 'roomLive/new-room/presence/owner');
  assert.equal(writes.at(-1).value, null, 'manual disconnect still removes presence');

  const deletedStateUpdates = [];
  const deletedStateController = new WatchRoomStagingController({
    now: () => 1_000,
    onRoomUpdate: (update) => deletedStateUpdates.push(update),
    onStatus: () => {},
  });
  deletedStateController.probePlayer = async () => ({
    capabilities: { observeTime: true, play: true, pause: true, seek: true, duration: true },
  });
  deletedStateController.postToPlayer = () => {};
  await deletedStateController.connect({ roomId: 'deleted-state-room', expiresAtMs: 2_000 }, 'owner');
  const writesBeforeStateDeletion = writes.length;
  const lifecycleBeforeStateDeletion = presenceLifecycle.length;
  listeners.get('roomLive/deleted-state-room/state:value')({ val: () => null });
  assert.equal(deletedStateController.room, null);
  assert.deepEqual(deletedStateUpdates.at(-1), { roomId: null, role: null, members: [] });
  assert.equal(writes.length, writesBeforeStateDeletion, 'server deletion does not remove presence after access closes');
  assert.equal(presenceLifecycle.length, lifecycleBeforeStateDeletion, 'server deletion does not cancel onDisconnect');

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timerReceiverChecks = [];
  try {
    globalThis.setTimeout = function browserTimer(callback, delayMs) {
      timerReceiverChecks.push({ kind: 'set', receiver: this, delayMs });
      return { callback };
    };
    globalThis.clearTimeout = function browserClearTimer(timer) {
      timerReceiverChecks.push({ kind: 'clear', receiver: this, timer });
    };
    const receiverController = new WatchRoomStagingController({ now: () => 1_000 });
    receiverController.room = { roomId: 'timer-receiver-room' };
    receiverController.armRoomExpiry({ roomId: 'timer-receiver-room', expiresAtMs: 2_000 });
    receiverController.clearRoomExpiry();
    assert.equal(timerReceiverChecks.every((entry) => entry.receiver === globalThis), true,
      'default room expiry timers preserve the Window receiver');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  let authWaitCalls = 0;
  let apiRequest = null;
  const authReadyUser = {
    uid: 'owner',
    displayName: 'Фикс',
    getIdToken: async () => 'test-token',
  };
  global.window.firebaseManager = {
    getCurrentUser: () => null,
    waitForAuthReady: async (timeoutMs) => {
      authWaitCalls += 1;
      assert.equal(timeoutMs, 10_000);
      return authReadyUser;
    },
  };
  global.fetch = async (url, options) => {
    apiRequest = { url, options };
    return {
      ok: true,
      json: async () => ({ room: { roomId: 'auth-ready-room' } }),
    };
  };
  const authReadyController = new WatchRoomStagingController();
  const apiResult = await authReadyController.callApi('create', { providerHint: 'kinogo' });
  assert.equal(authWaitCalls, 1, 'room creation waits for Firebase auth restoration');
  assert.equal(apiResult.room.roomId, 'auth-ready-room');
  assert.equal(apiRequest.url, 'https://us-central1-movielistdb-13208.cloudfunctions.net/watchRoomsStaging');
  assert.equal(apiRequest.options.headers.Authorization, 'Bearer test-token');
  assert.equal(JSON.parse(apiRequest.options.body).action, 'create');

  const movieDetailsSource = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');
  const membersRenderer = movieDetailsSource.match(/renderWatchRoomMembers\([\s\S]*?\n    async setWatchRoomMemberRole\(/)?.[0] || '';
  assert.doesNotMatch(membersRenderer, /В комнате:/, 'the member counter is shown only on the participant button');
  console.log('watchRoomStagingController.test.cjs: member and presence updates remain RTDB-only');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
