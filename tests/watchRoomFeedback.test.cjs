const assert = require('node:assert/strict');

global.window = {
  firebaseManager: { getCurrentUser: () => ({ uid: 'viewer' }) },
};

const {
  WatchRoomStagingController,
  watchRoomErrorMessage,
  formatRoomPosition,
} = require('../src/shared/services/WatchRoomStagingController');

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

function createRoomController(role = 'viewer', options = {}) {
  const statuses = [];
  const commands = [];
  const blocked = [];
  const controller = new WatchRoomStagingController({
    getIframe: () => ({ contentWindow: {} }),
    onStatus: (message, statusOptions) => statuses.push({ message, ...statusOptions }),
    onPlaybackBlocked: (value) => blocked.push(value),
    ...options,
  });
  controller.room = { roomId: 'feedback-room' };
  controller.role = role;
  controller.postToPlayer = (message) => commands.push(message);
  controller.memberState = {
    owner: { role: 'owner', displayName: 'Ика' },
    viewer: { role: 'viewer', displayName: 'Фикс' },
  };
  return { controller, statuses, commands, blocked };
}

(async () => {
  // Server errors are shown in Russian.
  assert.equal(watchRoomErrorMessage('ROOM_FULL', 409), 'В комнате нет свободных мест');
  assert.equal(watchRoomErrorMessage('INVITE_EXPIRED', 409), 'Срок действия приглашения истёк');
  assert.equal(watchRoomErrorMessage('INTERNAL', 500), 'Сервер комнат временно недоступен, попробуйте позже');
  assert.equal(watchRoomErrorMessage('SOMETHING_NEW', 400), 'Не удалось выполнить действие комнаты');
  global.window.firebaseManager.getCurrentUser = () => ({ uid: 'viewer', getIdToken: async () => 'token' });
  global.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: 'Room is full', code: 'ROOM_FULL' }),
  });
  const api = new WatchRoomStagingController();
  api.currentUserDisplayName = async () => 'Фикс';
  await assert.rejects(() => api.callApi('join', {}), (error) => error.message === 'В комнате нет свободных мест'
    && error.code === 'ROOM_FULL' && error.status === 409);

  assert.equal(formatRoomPosition(42_000), '0:42');
  assert.equal(formatRoomPosition(3_725_000), '1:02:05');

  // Blocked autoplay is surfaced and resumed by a click.
  const autoplay = createRoomController();
  autoplay.controller.applyRoomState({
    phase: 'playing', basePositionMs: 1_000, effectiveAtMs: Date.now(), updatedBy: 'owner',
  });
  const playCommand = autoplay.commands.find((command) => command.action === 'play');
  autoplay.controller.handlePlayerMessage({
    type: 'ROOM_SYNC_COMMAND_RESULT', requestId: playCommand.requestId, ok: false, code: 'PLAYBACK_BLOCKED',
  });
  assert.deepEqual(autoplay.blocked, [true], 'a blocked play asks the member for a click');
  autoplay.controller.roomState = { phase: 'playing', basePositionMs: 1_000, effectiveAtMs: Date.now(), updatedBy: 'owner' };
  autoplay.commands.length = 0;
  autoplay.controller.resumeBlockedPlayback();
  assert.deepEqual(autoplay.blocked, [true, false]);
  assert.equal(autoplay.commands.some((command) => command.action === 'play'), true,
    'the click retries playback at the room position');
  autoplay.controller.setPlaybackBlocked(true);
  autoplay.controller.handleRoomTelemetry({ kind: 'play', currentTimeMs: 1_000, paused: false });
  assert.equal(autoplay.blocked.at(-1), false, 'starting the player by hand clears the prompt');

  const shortVideo = createRoomController();
  shortVideo.controller.applyRoomState({ phase: 'paused', basePositionMs: 9_000_000, effectiveAtMs: Date.now() });
  const seekCommand = shortVideo.commands.find((command) => command.action === 'seek');
  shortVideo.controller.handlePlayerMessage({
    type: 'ROOM_SYNC_COMMAND_RESULT', requestId: seekCommand.requestId, ok: false, code: 'INVALID_POSITION',
  });
  assert.equal(shortVideo.statuses.at(-1).message, 'Ваша версия видео короче — момент комнаты за её пределами');

  const answered = createRoomController();
  answered.controller.applyRoomState({ phase: 'paused', basePositionMs: 0, effectiveAtMs: Date.now() });
  answered.commands.forEach((command) => answered.controller.handlePlayerMessage({
    type: 'ROOM_SYNC_COMMAND_RESULT', requestId: command.requestId, ok: true, code: 'APPLIED',
  }));
  assert.equal(answered.controller.pending.size, 0, 'answered commands release their pending entry');
  answered.controller.disconnect(false);

  // A rejected publish returns the publisher to the shared room state.
  global.window.firebaseManager.getCurrentUser = () => ({ uid: 'owner' });
  const rejected = createRoomController('owner');
  rejected.controller.stateRef = { update: async () => { throw new Error('PERMISSION_DENIED'); } };
  rejected.controller.roomState = {
    revision: 5, phase: 'playing', basePositionMs: 50_000, effectiveAtMs: Date.now(), updatedBy: 'owner',
  };
  rejected.controller.publishHostTelemetry({ kind: 'pause', currentTimeMs: 51_000 });
  await flush();
  assert.equal(rejected.statuses.at(-1).message, 'Действие не передалось комнате — возвращаю общий момент');
  assert.equal(rejected.commands.some((command) => command.action === 'play'), true,
    'the rejected pause is undone locally');

  // Followers learn what another member did; drift re-anchors stay silent.
  global.window.firebaseManager.getCurrentUser = () => ({ uid: 'viewer' });
  const notices = createRoomController();
  const base = { revision: 1, phase: 'playing', basePositionMs: 100_000, effectiveAtMs: Date.now(), updatedBy: 'owner' };
  notices.controller.announceRemoteStateChange(base, { ...base, revision: 2, phase: 'paused' });
  assert.equal(notices.statuses.at(-1).message, 'Ика поставил(а) паузу');
  assert.equal(notices.statuses.at(-1).timeoutMs, 4000);
  notices.controller.announceRemoteStateChange(base, { ...base, revision: 2, basePositionMs: 2_530_000 });
  assert.match(notices.statuses.at(-1).message, /^Ика перемотал\(а\) на 42:1\d$/);
  const countBeforeDrift = notices.statuses.length;
  notices.controller.announceRemoteStateChange(base, { ...base, revision: 2, basePositionMs: 96_000 });
  assert.equal(notices.statuses.length, countBeforeDrift, 'a drift re-anchor is not announced as a seek');
  notices.controller.announceRemoteStateChange(base, {
    ...base, revision: 2, phase: 'paused', basePositionMs: 0, selection: { seasonNumber: 2, episodeNumber: 4 },
  });
  assert.equal(notices.statuses.at(-1).message, 'Ика включает 2 сезон, 4 серию');
  notices.controller.announceRemoteStateChange(base, { ...base, revision: 2, phase: 'paused', updatedBy: 'viewer' });
  assert.equal(notices.statuses.at(-1).message, 'Ика включает 2 сезон, 4 серию', 'own actions are not announced');

  // A viewer whose own action is undone is told who controls the room.
  const override = createRoomController();
  override.controller.roomState = { ...base };
  override.controller.handleRoomTelemetry({ kind: 'play', currentTimeMs: 100_000, paused: false });
  assert.equal(override.statuses.length, 0, 'a play that matches the room needs no explanation');
  override.controller.handleRoomTelemetry({ kind: 'pause', currentTimeMs: 100_000, paused: true });
  assert.equal(override.statuses.at(-1).message, 'Просмотром управляет Ика');
  override.controller.handleRoomTelemetry({ kind: 'pause', currentTimeMs: 100_000, paused: true });
  assert.equal(override.statuses.length, 1, 'the explanation is rate-limited');
  clearTimeout(override.controller.guestReapplyTimer);

  console.log('watchRoomFeedback.test.cjs: room feedback is visible, Russian and recoverable');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
