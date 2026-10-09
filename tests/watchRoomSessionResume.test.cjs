const assert = require('node:assert/strict');

const storage = new Map();
global.window = {
  location: { href: 'chrome-extension://test/src/pages/movie-details/movie-details.html?movieId=100' },
  sessionStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
};

const { MovieDetailsWatchRoomPanelMethods } = require('../src/pages/movie-details/WatchRoomPanel');
const {
  WatchRoomStagingController,
  parseWatchRoomInvite,
  formatWatchRoomInvite,
} = require('../src/shared/services/WatchRoomStagingController');

const SECRET = 'A'.repeat(43);
const INVITE_ID = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const RAW_CODE = `${INVITE_ID}.${SECRET}`;

function createView(controller, kinopoiskId = 100) {
  const view = Object.create(MovieDetailsWatchRoomPanelMethods.prototype);
  view.watchRoomController = controller;
  view.selectedMovie = { kinopoiskId };
  view.statuses = [];
  view.setWatchRoomStatus = (message) => view.statuses.push(message);
  view.refreshWatchRoomControls = () => {};
  view.elements = {};
  return view;
}

(async () => {
  // Invite codes carry the film and are found inside a pasted message.
  assert.equal(formatWatchRoomInvite(100, RAW_CODE), `100:${RAW_CODE}`);
  assert.deepEqual(parseWatchRoomInvite(`Заходи: 100:${RAW_CODE} !`), { kinopoiskId: 100, joinCode: RAW_CODE });
  assert.deepEqual(parseWatchRoomInvite(RAW_CODE), { kinopoiskId: null, joinCode: RAW_CODE },
    'a bare server code from an older room still works');
  assert.equal(parseWatchRoomInvite('просто текст'), null);

  // A code for another film is rejected before the invite is redeemed.
  const apiCalls = [];
  const wrongMovieController = new WatchRoomStagingController({ getMovie: () => ({ kinopoiskId: 100 }) });
  wrongMovieController.callApi = async (action) => { apiCalls.push(action); return {}; };
  await assert.rejects(
    () => wrongMovieController.join(`200:${RAW_CODE}`),
    (error) => error.code === 'WRONG_MOVIE' && error.kinopoiskId === 200 && error.status === 409
  );
  assert.deepEqual(apiCalls, [], 'a wrong film does not use up a place in the room');
  await assert.rejects(() => wrongMovieController.join('not a code'), (error) => error.code === 'INVALID_INVITE');

  // Owner ends, member leaves; both drop the local room.
  for (const [role, expectedAction] of [['owner', 'end'], ['viewer', 'leave']]) {
    const roomUpdates = [];
    const calls = [];
    const leaving = new WatchRoomStagingController({ onRoomUpdate: (update) => roomUpdates.push(update) });
    leaving.room = { roomId: 'room-1' };
    leaving.role = role;
    leaving.callApi = async (action, payload) => { calls.push({ action, payload }); return {}; };
    assert.equal(await leaving.leaveOrEnd(), expectedAction);
    assert.deepEqual(calls, [{ action: expectedAction, payload: { roomId: 'room-1' } }]);
    assert.equal(leaving.room, null);
    assert.deepEqual(roomUpdates.at(-1), { roomId: null, role: null, members: [] });
  }
  const failingLeave = new WatchRoomStagingController();
  failingLeave.room = { roomId: 'room-2' };
  failingLeave.role = 'viewer';
  failingLeave.callApi = async () => { const error = new Error('offline'); error.status = 0; throw error; };
  await assert.rejects(() => failingLeave.leaveOrEnd(), /offline/);
  assert.equal(failingLeave.room.roomId, 'room-2', 'a failed request keeps the room');

  // Saved room is rejoined once the player is ready, with the owner's code restored.
  const joins = [];
  const resumeController = {
    room: null,
    join: async (invite) => { joins.push(invite); return { roomId: 'room-1', role: 'owner', expiresAtMs: Date.now() + 60_000 }; },
  };
  const view = createView(resumeController);
  view.saveWatchRoomSession(`100:${RAW_CODE}`, { expiresAtMs: Date.now() + 60_000 });
  assert.equal(await view.resumeWatchRoomIfPending(), true);
  assert.deepEqual(joins, [`100:${RAW_CODE}`]);
  assert.equal(view.watchRoomJoinCode, `100:${RAW_CODE}`, 'the owner can share the code again after a reload');

  resumeController.room = { roomId: 'room-1' };
  assert.equal(await view.resumeWatchRoomIfPending(), false, 'a connected tab does not rejoin');
  resumeController.room = null;
  const otherFilm = createView(resumeController, 999);
  assert.equal(await otherFilm.resumeWatchRoomIfPending(), false, 'another film does not rejoin the room');

  // A player that is not ready keeps the saved room for the next attempt.
  const notReady = createView({ room: null, join: async () => { throw new Error('Плеер ещё загружается'); } });
  assert.equal(await notReady.resumeWatchRoomIfPending(), false);
  assert.ok(notReady.readWatchRoomSession(), 'a transient failure keeps the saved room');

  // A terminal server answer forgets the room.
  const gone = createView({
    room: null,
    join: async () => { const error = new Error('Room is not joinable'); error.status = 409; throw error; },
  });
  assert.equal(await gone.resumeWatchRoomIfPending(), false);
  assert.equal(gone.readWatchRoomSession(), null);
  assert.match(gone.statuses.at(-1), /^Не удалось вернуться в комнату/);

  // Expired sessions are dropped.
  view.saveWatchRoomSession(`100:${RAW_CODE}`, { expiresAtMs: Date.now() - 1 });
  assert.equal(view.readWatchRoomSession(), null);

  // Hand-off to the invited film stores a pending join and opens that film's player.
  global.window.ConfirmDialog = { confirm: async () => true };
  const handOff = createView({ room: null });
  await handOff.offerWatchRoomMovieHandOff(`200:${RAW_CODE}`, 200);
  const pending = handOff.readWatchRoomSession();
  assert.equal(pending.kinopoiskId, 200);
  assert.equal(pending.invite, `200:${RAW_CODE}`);
  const target = new URL(global.window.location.href);
  assert.equal(target.searchParams.get('movieId'), '200');
  assert.equal(target.searchParams.get('autoplay'), 'true');

  console.log('watchRoomSessionResume.test.cjs: rooms survive reloads, invites open the right film, members can leave');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
