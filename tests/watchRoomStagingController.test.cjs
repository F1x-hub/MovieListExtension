const assert = require('node:assert/strict');
const fs = require('node:fs');
const { WatchRoomStagingController } = require('../src/shared/services/WatchRoomStagingController');

const listeners = new Map();
const listenerErrors = new Map();
const writes = [];
const updatesToRtdb = [];
const presenceLifecycle = [];
const presenceSnapshot = (key, value) => ({ key, val: () => value });
const rtdb = {
  ref(path = '') {
    return {
      on(event, callback, cancelCallback) {
        listeners.set(`${path}:${event}`, callback);
        listenerErrors.set(`${path}:${event}`, cancelCallback);
      },
      off() {},
      set(value) { writes.push({ path, value }); presenceLifecycle.push(`${path}:set`); return Promise.resolve(); },
      update(value) {
        updatesToRtdb.push({ path, value });
        if (path.includes('/presence')) presenceLifecycle.push(`${path}:update`);
        return Promise.resolve();
      },
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
  assert.equal(writes[0].path.startsWith('roomLive/room-1/presenceV2/owner/'), true);
  assert.equal(writes.some(({ path }) => path.startsWith('roomLive/room-1/presence/')), false,
    'new clients never write the legacy presence path');
  assert.deepEqual(writes[0], {
    path: writes[0].path,
    value: {
      connectedAtMs: writes[0].value.connectedAtMs,
      lastSeenAtMs: writes[0].value.lastSeenAtMs,
      role: 'owner',
      displayName: 'Фикс',
    },
  });
  assert.equal(presenceLifecycle[0].endsWith(':arm-disconnect'), true);
  assert.equal(presenceLifecycle[1].endsWith(':set'), true);

  const connectionStatuses = [];
  controller.onStatus = (status) => connectionStatuses.push(status);
  listeners.get('.info/connected:value')({ val: () => false });
  assert.equal(controller.room.roomId, 'room-1', 'a transient RTDB disconnect preserves the room');
  assert.equal(connectionStatuses.at(-1), 'Соединение с комнатой восстанавливается…');
  listeners.get('.info/connected:value')({ val: () => true });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(presenceLifecycle.some((entry) => entry.endsWith(':arm-disconnect')), true,
    'reconnect re-arms server-side presence cleanup');

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
  listeners.get('roomLive/room-1/presenceV2:child_added')(
    presenceSnapshot('viewer', {
      'presence-old': { connectedAtMs: Date.now() - 20_000, lastSeenAtMs: Date.now() - 20_000, role: 'viewer', displayName: 'Старое имя' },
      'presence-current': { connectedAtMs: Date.now() - 1_000, lastSeenAtMs: Date.now(), role: 'viewer', displayName: 'Ика' },
    })
  );
  listeners.get('roomLive/room-1/presence:child_added')(
    presenceSnapshot('viewer', {
      connectedAtMs: Date.now() - 30_000,
      role: 'viewer',
      displayName: 'Старый клиент',
    })
  );
  listeners.get('roomLive/room-1/presence:child_removed')(presenceSnapshot('viewer', null));
  assert.equal(controller.presenceState.viewer.legacy, undefined,
    'legacy presence removal cannot erase the canonical V2 source');

  assert.deepEqual(updates.at(-1).members, [
    { uid: 'owner', role: 'owner', displayName: 'Фикс', online: false, isCurrentUser: true },
    { uid: 'controller', role: 'controller', displayName: 'Помощник', online: false, isCurrentUser: false },
    { uid: 'viewer', role: 'viewer', displayName: 'Ика', online: true, isCurrentUser: false },
  ]);
  const presenceEvaluation = new WatchRoomStagingController({ now: () => 200_000 });
  assert.equal(presenceEvaluation.isPresenceOnline({ lastSeenAtMs: 150_000 }), true);
  assert.equal(presenceEvaluation.isPresenceOnline({ lastSeenAtMs: 109_999 }), false);

  let releaseDisplayName;
  controller.currentUserDisplayName = async () => {
    await new Promise((resolve) => { releaseDisplayName = resolve; });
    return 'Отложенное имя';
  };
  const pendingPresence = controller.markPresence();
  await new Promise((resolve) => setImmediate(resolve));
  controller.disconnect(false);
  releaseDisplayName();
  assert.equal(await pendingPresence, false, 'stale presence work is fenced after disconnect');

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
    src: 'https://provider.example/embed',
    contentWindow: {
      postMessage(message, targetOrigin) {
        assert.equal(targetOrigin, 'https://provider.example', 'room commands must target the provider frame origin');
        iframeSubscriptions.push({ iframe: 'first', message });
      },
    },
  };
  const iframeController = new WatchRoomStagingController({
    getIframe: () => activeIframe,
  });
  iframeController.room = { roomId: 'room-1' };
  iframeController.subscriptionId = 'room-sync-subscription-123456';
  iframeController.refreshPlayerBridge();
  activeIframe = {
    src: 'https://provider.example/embed',
    contentWindow: {
      postMessage(message, targetOrigin) {
        assert.equal(targetOrigin, 'https://provider.example', 'room commands must target the provider frame origin');
        iframeSubscriptions.push({ iframe: 'replacement', message });
      },
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
  assert.equal(presenceLifecycle.at(-1).endsWith(':cancel-disconnect'), true);
  assert.equal(writes.at(-1).path.startsWith('roomLive/new-room/presenceV2/owner/'), true);
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

  const createBodies = [];
  let createAttempts = 0;
  global.fetch = async (url, options) => {
    createBodies.push(JSON.parse(options.body));
    createAttempts += 1;
    if (createAttempts === 1) throw new Error('response lost');
    return {
      ok: true,
      json: async () => ({ room: { roomId: 'retried-room' }, joinCode: 'invite.secret' }),
    };
  };
  const retryController = new WatchRoomStagingController({
    getMovie: () => ({ kinopoiskId: 123, nameRu: 'Фильм' }),
  });
  retryController.connect = async () => true;
  await assert.rejects(() => retryController.create(), (error) => error.code === 'NETWORK_ERROR');
  assert.equal(await retryController.create(), 'invite.secret');
  assert.equal(createBodies[0].requestId, createBodies[1].requestId,
    'create retry reuses the idempotency key after a transport failure');

  global.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: 'Room is full', code: 'ROOM_FULL' }),
  });
  await assert.rejects(
    () => authReadyController.callApi('join', { joinCode: 'invite.secret' }),
    (error) => error.name === 'WatchRoomApiError'
      && error.status === 409
      && error.code === 'ROOM_FULL'
      && error.retryable === false
  );

  // Timeline accuracy: server-time anchoring, tolerance-based seeks and drift
  // correction.
  global.window.firebaseManager.getCurrentUser = () => ({ uid: 'viewer' });
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };
  const timelineFollower = (role = 'viewer') => {
    const commands = [];
    const follower = new WatchRoomStagingController({ getIframe: () => ({ contentWindow: {} }) });
    follower.room = { roomId: 'timeline-room' };
    follower.role = role;
    follower.postToPlayer = (message) => commands.push(message);
    return { follower, commands };
  };

  const skewed = timelineFollower();
  // This computer's clock runs 5 s ahead of the Firebase server.
  skewed.follower.serverTimeOffsetMs = -5_000;
  skewed.follower.applyRoomState({
    phase: 'playing', basePositionMs: 10_000, effectiveAtMs: Date.now() - 5_000 - 2_000, updatedBy: 'owner',
  });
  const skewedSeek = skewed.commands.find((command) => command.action === 'seek');
  assert.ok(skewedSeek.positionMs >= 12_000 && skewedSeek.positionMs < 12_250,
    `room position uses server time, not the local wall clock (got ${skewedSeek.positionMs})`);

  const tolerant = timelineFollower();
  tolerant.follower.playerSample = { positionMs: 20_400, paused: false, atMs: Date.now() };
  tolerant.follower.applyRoomState({
    phase: 'playing', basePositionMs: 20_000, effectiveAtMs: Date.now(), updatedBy: 'owner',
  });
  assert.deepEqual(tolerant.commands, [], 'a playing follower inside the tolerance is not re-seeked');
  tolerant.follower.playerSample = { positionMs: 20_100, paused: true, atMs: Date.now() - 60_000 };
  tolerant.follower.applyRoomState({
    phase: 'paused', basePositionMs: 20_000, effectiveAtMs: Date.now(), updatedBy: 'owner',
  });
  assert.deepEqual(tolerant.commands, [], 'an aligned paused follower receives no commands');
  tolerant.follower.playerSample = { positionMs: 20_000, paused: false, atMs: Date.now() };
  tolerant.follower.applyRoomState({
    phase: 'paused', basePositionMs: 20_150, effectiveAtMs: Date.now(), updatedBy: 'owner',
  });
  assert.deepEqual(tolerant.commands.map(({ action }) => action), ['pause'],
    'a pause only pauses when the position is already aligned');
  tolerant.commands.length = 0;
  tolerant.follower.playerSample = { positionMs: 21_000, paused: true, atMs: Date.now() };
  tolerant.follower.applyRoomState({
    phase: 'paused', basePositionMs: 20_000, effectiveAtMs: Date.now(), updatedBy: 'owner',
  });
  assert.deepEqual(tolerant.commands.map(({ action }) => action), ['seek'],
    'a paused follower outside the paused tolerance is aligned');

  const drifting = timelineFollower();
  drifting.follower.roomState = {
    phase: 'playing', basePositionMs: 60_000, effectiveAtMs: Date.now(), updatedBy: 'owner',
  };
  const behindSample = () => ({
    kind: 'timeupdate', currentTimeMs: 57_000, paused: false, observedAtMs: Date.now(),
  });
  drifting.follower.handleRoomTelemetry(behindSample());
  assert.equal(drifting.commands.length, 0, 'one drifting sample is not enough to seek');
  drifting.follower.handleRoomTelemetry(behindSample());
  const driftSeeks = drifting.commands.filter((command) => command.action === 'seek');
  assert.equal(driftSeeks.length, 1, 'confirmed drift seeks the follower back onto the room timeline');
  assert.ok(Math.abs(driftSeeks[0].positionMs - 60_000) < 250);
  assert.equal(drifting.commands.some((command) => command.action === 'play'), false,
    'drift correction of a playing follower does not resend play');
  drifting.follower.ignoreRemoteTelemetryUntil = 0;
  drifting.follower.handleRoomTelemetry(behindSample());
  drifting.follower.handleRoomTelemetry(behindSample());
  assert.equal(drifting.commands.filter((command) => command.action === 'seek').length, 1,
    'the drift cooldown prevents a seek loop on a slow source');
  drifting.follower.lastDriftCorrectionAt = 0;
  drifting.follower.handleRoomTelemetry({
    kind: 'timeupdate', currentTimeMs: 60_300, paused: false, observedAtMs: Date.now(),
  });
  drifting.follower.handleRoomTelemetry({
    kind: 'timeupdate', currentTimeMs: 60_300, paused: false, observedAtMs: Date.now(),
  });
  assert.equal(drifting.commands.filter((command) => command.action === 'seek').length, 1,
    'small drift stays inside the tolerance');

  const authority = timelineFollower('controller');
  const authorityWrites = [];
  authority.follower.stateRef = { update: async (value) => authorityWrites.push(value) };
  authority.follower.serverTimeOffsetMs = 30_000;
  authority.follower.roomState = {
    revision: 7, phase: 'playing', basePositionMs: 100_000, effectiveAtMs: Date.now() + 30_000, updatedBy: 'viewer',
  };
  // The publisher stalled for 4 s while buffering.
  const stalledSample = () => ({
    kind: 'timeupdate', currentTimeMs: 96_000, paused: false, observedAtMs: Date.now(),
  });
  authority.follower.handleRoomTelemetry(stalledSample());
  authority.follower.handleRoomTelemetry(stalledSample());
  await flushMicrotasks();
  assert.equal(authority.commands.length, 0, 'the timeline publisher is never seeked by its own room state');
  assert.equal(authorityWrites.length, 1, 'the timeline publisher re-anchors the room after its playback slipped');
  assert.equal(authorityWrites[0].phase, 'playing');
  assert.ok(Math.abs(authorityWrites[0].basePositionMs - 96_000) < 250);
  assert.ok(Math.abs(authorityWrites[0].effectiveAtMs - (Date.now() + 30_000)) < 250,
    'the re-anchor is stamped with estimated server time');
  assert.equal(authorityWrites[0].revision, 8);

  const serverStamped = timelineFollower('owner');
  const serverStampedWrites = [];
  serverStamped.follower.stateRef = { update: async (value) => serverStampedWrites.push(value) };
  serverStamped.follower.serverTimeOffsetMs = -20_000;
  serverStamped.follower.roomState = { revision: 0, phase: 'paused', basePositionMs: 0, providerHint: 'kinogo' };
  serverStamped.follower.publishHostTelemetry({ kind: 'pause', currentTimeMs: 5_000 });
  await flushMicrotasks();
  assert.ok(Math.abs(serverStampedWrites[0].effectiveAtMs - (Date.now() - 20_000)) < 250,
    'published timeline events use estimated server time');
  serverStamped.follower.roomState = {
    ...serverStamped.follower.roomState,
    phase: 'playing', basePositionMs: 5_000, effectiveAtMs: Date.now() - 20_000 - 3_000,
  };
  serverStamped.follower.publishHostProvider('exfs');
  await flushMicrotasks();
  assert.ok(Math.abs(serverStampedWrites[1].basePositionMs - 8_000) < 250,
    'a source change re-anchors the current room position instead of rewinding it');

  const echoController = timelineFollower('controller');
  let echoPublishes = 0;
  echoController.follower.publishHostTelemetry = () => { echoPublishes += 1; };
  echoController.follower.applyRoomState({
    phase: 'paused', basePositionMs: 300_000, effectiveAtMs: Date.now(), updatedBy: 'owner',
  });
  // A slow HLS seek reports after the fallback window has already closed.
  echoController.follower.ignoreRemoteTelemetryUntil = 0;
  echoController.follower.handleRoomTelemetry({ kind: 'seeking', currentTimeMs: 300_000 });
  echoController.follower.handleRoomTelemetry({ kind: 'seeked', currentTimeMs: 300_050 });
  echoController.follower.handleRoomTelemetry({ kind: 'pause', currentTimeMs: 300_050 });
  assert.equal(echoPublishes, 0, 'late player effects of a room command are not echoed into a new room state');
  echoController.follower.handleRoomTelemetry({ kind: 'seeked', currentTimeMs: 300_000 });
  assert.equal(echoPublishes, 1, 'each expected effect is consumed once; a repeat is a real user action');
  echoController.follower.handleRoomTelemetry({ kind: 'play', currentTimeMs: 300_000 });
  assert.equal(echoPublishes, 2, 'a user action that was not commanded by the room is published');

  // Series episode synchronization.
  const selectionHost = timelineFollower('owner');
  const selectionHostWrites = [];
  selectionHost.follower.stateRef = { update: async (value) => selectionHostWrites.push(value) };
  selectionHost.follower.roomState = {
    revision: 3, phase: 'playing', basePositionMs: 900_000, effectiveAtMs: Date.now(), updatedBy: 'viewer',
    selection: { seasonNumber: 1, episodeNumber: 2 },
  };
  selectionHost.follower.publishHostSelection({ seasonNumber: 1, episodeNumber: 2, source: 'PLAYER_NAVIGATION' });
  await flushMicrotasks();
  assert.equal(selectionHostWrites.length, 0, 'the room episode is not republished');
  selectionHost.follower.publishHostSelection({ seasonNumber: 1, episodeNumber: 3, source: 'AUTO_NEXT' });
  await flushMicrotasks();
  assert.deepEqual(selectionHostWrites[0].selection, { seasonNumber: 1, episodeNumber: 3 },
    'an episode change by the owner is shared with the room');
  assert.equal(selectionHostWrites[0].phase, 'paused');
  assert.equal(selectionHostWrites[0].basePositionMs, 0, 'a new episode starts the room timeline from zero');
  selectionHost.follower.publishHostSelection({ seasonNumber: 0, episodeNumber: null });
  selectionHost.follower.publishHostSelection(null);
  await flushMicrotasks();
  assert.equal(selectionHostWrites.length, 1, 'movies and incomplete selections publish no episode');

  let viewerSelection = { seasonNumber: 1, episodeNumber: 2 };
  const selectionRequests = [];
  const selectionViewer = timelineFollower('viewer');
  const selectionStatuses = [];
  selectionViewer.follower.getSelection = () => viewerSelection;
  selectionViewer.follower.onStatus = (message) => selectionStatuses.push(message);
  selectionViewer.follower.onSelectionRequest = async (selection) => {
    selectionRequests.push(selection);
    viewerSelection = { ...selection, source: 'PLAYER_NAVIGATION' };
    return true;
  };
  selectionViewer.follower.roomState = {
    revision: 4, phase: 'playing', basePositionMs: 0, effectiveAtMs: Date.now(), updatedBy: 'owner',
    selection: { seasonNumber: 1, episodeNumber: 3 },
  };
  selectionViewer.follower.followRoomState(selectionViewer.follower.roomState);
  assert.equal(selectionViewer.commands.length, 0, 'the timeline waits until the room episode is open');
  assert.equal(selectionStatuses.at(-1), 'Переключаю на 1 сезон, 3 серию…');
  selectionViewer.follower.followRoomState(selectionViewer.follower.roomState);
  await flushMicrotasks();
  assert.deepEqual(selectionRequests, [{ seasonNumber: 1, episodeNumber: 3 }],
    'a follower opens the room episode exactly once');
  selectionViewer.follower.handleRoomTelemetry({ kind: 'loadedmetadata', currentTimeMs: 0, paused: true });
  assert.deepEqual(selectionViewer.commands.map(({ action }) => action), ['play'],
    'the room timeline is applied once the new episode is ready');
  assert.equal(selectionViewer.follower.selectionSwitch, null);

  selectionViewer.commands.length = 0;
  viewerSelection = { seasonNumber: 1, episodeNumber: 4, source: 'AUTO_NEXT' };
  selectionViewer.follower.publishHostSelection(viewerSelection);
  await flushMicrotasks();
  assert.equal(selectionRequests.length, 1, "a viewer's own auto-next waits for the room's next episode");
  viewerSelection = { seasonNumber: 2, episodeNumber: 1, source: 'SEASONS_TAB' };
  selectionViewer.follower.publishHostSelection(viewerSelection);
  await flushMicrotasks();
  assert.deepEqual(selectionRequests.at(-1), { seasonNumber: 1, episodeNumber: 3 },
    'a viewer who picks another episode is returned to the room episode');

  const timeoutCallbacks = [];
  const stuckViewer = new WatchRoomStagingController({
    getIframe: () => ({ contentWindow: {} }),
    setTimeout: (callback) => { timeoutCallbacks.push(callback); return timeoutCallbacks.length; },
    clearTimeout: () => {},
    getSelection: () => ({ seasonNumber: 1, episodeNumber: 1 }),
    onSelectionRequest: async () => true,
  });
  const stuckStatuses = [];
  stuckViewer.onStatus = (message) => stuckStatuses.push(message);
  stuckViewer.room = { roomId: 'timeline-room' };
  stuckViewer.role = 'viewer';
  stuckViewer.postToPlayer = () => {};
  stuckViewer.roomState = {
    revision: 1, phase: 'paused', basePositionMs: 0, effectiveAtMs: Date.now(), updatedBy: 'owner',
    selection: { seasonNumber: 1, episodeNumber: 5 },
  };
  stuckViewer.followRoomState(stuckViewer.roomState);
  await flushMicrotasks();
  timeoutCallbacks.at(-1)();
  assert.equal(stuckViewer.selectionSwitch, null);
  assert.equal(stuckStatuses.at(-1), 'Серия комнаты не загрузилась у вас — откройте её вручную',
    'a provider that never opens the episode does not cause a retry loop');

  global.window.firebaseManager = {
    getCurrentUser: () => ({ uid: 'owner' }),
    getRealtimeDatabase: () => rtdb,
  };
  const seedingOwner = new WatchRoomStagingController({
    getSelection: () => ({ seasonNumber: 2, episodeNumber: 5, source: 'SEASONS_TAB' }),
  });
  seedingOwner.probePlayer = async () => ({
    capabilities: { observeTime: true, play: true, pause: true, seek: true, duration: true },
  });
  seedingOwner.postToPlayer = () => {};
  await seedingOwner.connect({ roomId: 'seeded-room', expiresAtMs: Date.now() + 60_000 }, 'owner');
  listeners.get('roomLive/seeded-room/state:value')({ val: () => ({
    providerHint: 'kinogo', phase: 'paused', basePositionMs: 0, effectiveAtMs: Date.now(), revision: 0, updatedBy: 'owner',
  }) });
  await flushMicrotasks();
  assert.deepEqual(updatesToRtdb.at(-1).value.selection, { seasonNumber: 2, episodeNumber: 5 },
    'the owner seeds a new room with the episode it is watching');
  seedingOwner.disconnect(false);

  const movieDetailsSource = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');
  const membersRenderer = movieDetailsSource.match(/renderWatchRoomMembers\([\s\S]*?\n    async setWatchRoomMemberRole\(/)?.[0] || '';
  assert.doesNotMatch(membersRenderer, /В комнате:/, 'the member counter is shown only on the participant button');
  console.log('watchRoomStagingController.test.cjs: member and presence updates remain RTDB-only');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
