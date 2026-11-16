const assert = require('node:assert/strict');
const Rules = require('../functions/battleshipRules');
const {
  PLACING_IDLE_MS,
  PRIVATE_WAIT_MS,
  PUBLIC_WAIT_MS,
  TURN_IDLE_MS,
  MAX_ACTIVE_GAMES,
  createBattleshipHandler,
  createBattleshipService,
  displayNameFromProfile,
  safePhotoUrl,
} = require('../functions/battleship');

// --- A Firestore stand-in that enforces what the real one does -------------------
function containsUndefined(value) {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(containsUndefined);
  if (value && typeof value === 'object') return Object.values(value).some(containsUndefined);
  return false;
}

class FakeSnapshot {
  constructor(ref, value) {
    this.id = ref.id;
    this.ref = ref;
    this.exists = value !== undefined;
    this._value = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  data() {
    return this._value;
  }
}

class FakeDocRef {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split('/').pop();
  }

  collection(name) {
    return new FakeCollection(this.db, `${this.path}/${name}`);
  }

  async get() {
    return new FakeSnapshot(this, this.db.store.get(this.path));
  }
}

class FakeCollection {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  doc(id) {
    return new FakeDocRef(this.db, `${this.path}/${id}`);
  }
}

class FakeDb {
  constructor() {
    this.store = new Map();
    this.transactions = 0;
  }

  collection(name) {
    return new FakeCollection(this, name);
  }

  async runTransaction(callback) {
    this.transactions += 1;
    const writes = [];
    const transaction = {
      get: async (ref) => {
        if (writes.length) throw new Error('Firestore transactions require all reads before writes');
        return new FakeSnapshot(ref, this.store.get(ref.path));
      },
      set: (ref, data) => {
        if (containsUndefined(data)) throw new Error(`undefined value written to ${ref.path}`);
        writes.push([ref.path, JSON.parse(JSON.stringify(data))]);
      },
    };
    const result = await callback(transaction);
    for (const [path, data] of writes) this.store.set(path, data);
    return result;
  }

  read(path) {
    return this.store.get(path);
  }
}

async function rejects(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `${error.code}: ${error.message}`);
    return true;
  });
}

// --- Scenario --------------------------------------------------------------------
const PROFILES = {
  alice: { firstName: 'Алиса', lastName: 'Морская', approvalStatus: 'approved', photoURL: 'https://example.test/a.png' },
  bob: { displayNameFormat: 'username', username: 'bob_navy', approvalStatus: 'approved', photoURL: 'javascript:alert(1)' },
  carol: { displayName: 'Carol', approvalStatus: 'approved' },
  dave: { displayName: 'Dave', approvalStatus: 'pending' },
};

// A known fleet for each side so the test can aim.
const FLEET = [
  { x: 0, y: 0, length: 4, vertical: false },
  { x: 0, y: 2, length: 3, vertical: true },
  { x: 5, y: 2, length: 3, vertical: false },
  { x: 9, y: 0, length: 2, vertical: true },
  { x: 2, y: 6, length: 2, vertical: false },
  { x: 9, y: 4, length: 2, vertical: true },
  { x: 5, y: 0, length: 1 },
  { x: 5, y: 5, length: 1 },
  { x: 0, y: 9, length: 1 },
  { x: 9, y: 9, length: 1 },
];
const SHIP_CELLS = FLEET.flatMap((ship) => Rules.shipCells(Rules.normalizeShip(ship)));
const EMPTY_CELLS = Array.from({ length: 100 }, (_, index) => index)
  .filter((index) => !SHIP_CELLS.includes(index));

function actor(uid) {
  return { uid, name: displayNameFromProfile(PROFILES[uid]), photo: safePhotoUrl(PROFILES[uid].photoURL) };
}

(async () => {
  assert.equal(displayNameFromProfile(PROFILES.alice), 'Алиса Морская');
  assert.equal(displayNameFromProfile(PROFILES.bob), 'bob_navy');
  assert.equal(displayNameFromProfile({}), 'Игрок');
  assert.equal(safePhotoUrl('https://example.test/a.png'), 'https://example.test/a.png');
  assert.equal(safePhotoUrl('javascript:alert(1)'), null);
  assert.equal(safePhotoUrl('http://example.test/a.png'), null);

  const db = new FakeDb();
  for (const [uid, profile] of Object.entries(PROFILES)) db.store.set(`users/${uid}`, profile);
  let clock = 1_000_000;
  // Codes and the first turn come from this queue, so the scenario is fixed.
  let randomQueue = [];
  const random = () => (randomQueue.length ? randomQueue.shift() : 0.5);
  const service = createBattleshipService({ db, now: () => clock, random });
  const ALICE = actor('alice');
  const BOB = actor('bob');
  const CAROL = actor('carol');

  // --- An open game in the lobby ---------------------------------------------------
  randomQueue = Array(6).fill(0); // code AAAAAA
  const created = await service.create(ALICE, { visibility: 'public' });
  assert.deepEqual(created, { gameId: 'AAAAAA', reused: false });
  let game = db.read('battleshipGames/AAAAAA');
  assert.equal(game.status, 'waiting');
  assert.equal(game.visibility, 'public');
  assert.deepEqual(game.players, ['alice']);
  assert.equal(game.names.alice, 'Алиса Морская');
  assert.equal(game.photos.alice, 'https://example.test/a.png');
  assert.equal(game.expiresAtMs, clock + PUBLIC_WAIT_MS);
  assert.ok(db.read('battleshipLobby/open').games.AAAAAA, 'an open game is listed in the lobby');
  assert.equal(db.read('battleshipPlayers/alice').games.AAAAAA.status, 'waiting');

  assert.deepEqual(await service.create(ALICE, { visibility: 'public' }), { gameId: 'AAAAAA', reused: true },
    'asking for an open game twice returns the same game');
  await rejects(service.join(ALICE, { gameId: 'AAAAAA' }), 'OWN_GAME');
  await rejects(service.join(BOB, { gameId: 'bad code' }), 'INVALID_GAME');
  await rejects(service.join(BOB, { gameId: 'ZZZZZZ' }), 'GAME_NOT_FOUND');
  await rejects(service.create(ALICE, { visibility: 'everyone' }), 'INVALID_VISIBILITY');

  clock += 60_000;
  const touched = await service.touch(ALICE, { gameId: 'AAAAAA' });
  assert.equal(touched.expiresAtMs, clock + PUBLIC_WAIT_MS, 'the host page keeps an open game alive');
  assert.equal(db.read('battleshipLobby/open').games.AAAAAA.expiresAtMs, clock + PUBLIC_WAIT_MS);
  await rejects(service.touch(BOB, { gameId: 'AAAAAA' }), 'NOT_A_PLAYER');

  // --- Bob joins; lowercase codes are accepted ------------------------------------
  assert.deepEqual(await service.join(BOB, { gameId: 'aaaaaa' }), { gameId: 'AAAAAA' });
  game = db.read('battleshipGames/AAAAAA');
  assert.equal(game.status, 'placing');
  assert.deepEqual(game.players, ['alice', 'bob']);
  assert.equal(game.guestUid, 'bob');
  assert.equal(game.names.bob, 'bob_navy');
  assert.equal(game.photos.bob, null, 'an unsafe photo URL is never stored');
  assert.equal(game.boards.alice, Rules.emptyMarks());
  assert.equal(game.expiresAtMs, null);
  assert.equal(db.read('battleshipLobby/open').games.AAAAAA, undefined, 'a started game leaves the lobby');
  assert.equal(db.read('battleshipPlayers/bob').games.AAAAAA.opponentName, 'Алиса Морская');
  assert.deepEqual(await service.join(BOB, { gameId: 'AAAAAA' }), { gameId: 'AAAAAA' }, 'joining again is harmless');
  await rejects(service.join(CAROL, { gameId: 'AAAAAA' }), 'GAME_NOT_JOINABLE');
  await rejects(service.cancel(ALICE, { gameId: 'AAAAAA' }), 'GAME_STARTED');

  // --- Placement -----------------------------------------------------------------------
  await rejects(service.place(ALICE, { gameId: 'AAAAAA', ships: FLEET.slice(0, 9) }), 'INVALID_FLEET');
  await rejects(service.place(CAROL, { gameId: 'AAAAAA', ships: FLEET }), 'NOT_A_PLAYER');
  await rejects(service.fire(BOB, { gameId: 'AAAAAA', index: 0 }), 'GAME_NOT_ACTIVE');
  assert.equal((await service.place(ALICE, { gameId: 'AAAAAA', ships: FLEET })).status, 'placing');
  assert.equal(db.read('battleshipGames/AAAAAA').ready.alice, true);
  assert.equal(db.read('battleshipGames/AAAAAA/fleets/alice').ships.length, 10, 'the fleet is stored apart from the game');
  assert.equal(JSON.stringify(db.read('battleshipGames/AAAAAA')).includes('"length"'), false,
    'the public game document holds no ship before one is sunk');
  assert.equal((await service.place(ALICE, { gameId: 'AAAAAA', ships: Rules.randomFleet() })).status, 'placing',
    'a second placement is ignored');
  assert.deepEqual(db.read('battleshipGames/AAAAAA/fleets/alice').ships.length, 10);
  await rejects(service.claim(ALICE, { gameId: 'AAAAAA' }), 'TOO_EARLY');

  randomQueue = [0.1]; // alice (host) moves first
  const started = await service.place(BOB, { gameId: 'AAAAAA', ships: FLEET });
  assert.equal(started.status, 'playing');
  assert.equal(started.turnUid, 'alice');
  game = db.read('battleshipGames/AAAAAA');
  assert.equal(game.turnStartedAtMs, clock);
  assert.equal(db.read('battleshipPlayers/bob').games.AAAAAA.turnUid, 'alice');

  // --- Shooting ---------------------------------------------------------------------
  await rejects(service.fire(BOB, { gameId: 'AAAAAA', index: 0 }), 'NOT_YOUR_TURN');
  await rejects(service.fire(ALICE, { gameId: 'AAAAAA', index: 100 }), 'INVALID_CELL');
  await rejects(service.fire(ALICE, { gameId: 'AAAAAA', index: 0, expectedMove: 3 }), 'STALE_MOVE');
  await rejects(service.fire(CAROL, { gameId: 'AAAAAA', index: 0 }), 'NOT_A_PLAYER');

  clock += 1000;
  let shot = await service.fire(ALICE, { gameId: 'AAAAAA', index: 1, expectedMove: 0 });
  assert.equal(shot.result, 'hit');
  assert.equal(shot.turnUid, 'alice', 'a hit keeps the turn');
  assert.equal(shot.moveCount, 1);
  await rejects(service.fire(ALICE, { gameId: 'AAAAAA', index: 1 }), 'CELL_TAKEN');
  await rejects(service.fire(ALICE, { gameId: 'AAAAAA', index: 10 }), 'CELL_TAKEN', 'a known-empty diagonal is no target');

  clock += 1000;
  shot = await service.fire(ALICE, { gameId: 'AAAAAA', index: EMPTY_CELLS.find((cell) => cell > 40) });
  assert.equal(shot.result, 'miss');
  assert.equal(shot.turnUid, 'bob', 'a miss passes the turn');
  assert.equal(db.read('battleshipPlayers/alice').games.AAAAAA.turnUid, 'bob', 'both players see the turn change');
  game = db.read('battleshipGames/AAAAAA');
  assert.equal(game.lastShot.by, 'alice');
  assert.equal(game.lastShot.result, 'miss');
  assert.equal(game.shots.alice, 2);
  assert.equal(game.hits.alice, 1);

  // An idle opponent can be claimed only once the time is up.
  await rejects(service.claim(ALICE, { gameId: 'AAAAAA' }), 'TOO_EARLY');
  await rejects(service.claim(BOB, { gameId: 'AAAAAA' }), 'TOO_EARLY', 'a player cannot claim on their own turn');

  // Bob misses on purpose; Alice sinks everything.
  const bobMisses = EMPTY_CELLS.filter((cell) => cell < 40);
  const aliceTargets = SHIP_CELLS.filter((cell) => cell !== 1);
  let sunkCount = 0;
  while (db.read('battleshipGames/AAAAAA').status === 'playing') {
    game = db.read('battleshipGames/AAAAAA');
    clock += 500;
    if (game.turnUid === 'bob') {
      let cell = bobMisses.shift();
      while (game.boards.alice[cell] !== '.') cell = bobMisses.shift();
      shot = await service.fire(BOB, { gameId: 'AAAAAA', index: cell, expectedMove: game.moveCount });
      assert.equal(shot.result, 'miss');
    } else {
      shot = await service.fire(ALICE, { gameId: 'AAAAAA', index: aliceTargets.shift(), expectedMove: game.moveCount });
      assert.notEqual(shot.result, 'miss');
      if (shot.result === 'sunk') sunkCount += 1;
    }
  }
  assert.equal(sunkCount, 10);
  assert.equal(shot.status, 'finished');
  assert.equal(shot.winnerUid, 'alice');
  game = db.read('battleshipGames/AAAAAA');
  assert.equal(game.endReason, 'all_sunk');
  assert.equal(game.turnUid, null);
  assert.equal(game.sunk.bob.length, 10);
  assert.equal(game.revealed.bob.length, 10, 'both fleets are revealed at the end');
  assert.equal(game.revealed.alice.length, 10);
  assert.equal(Rules.countMarks(game.boards.bob, '#'), 20);
  const aliceDoc = db.read('battleshipPlayers/alice');
  const bobDoc = db.read('battleshipPlayers/bob');
  assert.deepEqual(aliceDoc.stats, { played: 1, wins: 1, losses: 0 });
  assert.deepEqual(bobDoc.stats, { played: 1, wins: 0, losses: 1 });
  assert.equal(aliceDoc.games.AAAAAA, undefined, 'a finished game leaves the list of unfinished games');
  assert.equal(aliceDoc.recent[0].result, 'win');
  assert.equal(bobDoc.recent[0].result, 'loss');
  assert.equal(bobDoc.recent[0].opponentName, 'Алиса Морская');
  await rejects(service.fire(ALICE, { gameId: 'AAAAAA', index: 99 }), 'GAME_NOT_ACTIVE');

  // --- Rematch -------------------------------------------------------------------------
  randomQueue = Array(6).fill(1 / 32); // code BBBBBB
  const offer = await service.rematch(BOB, { gameId: 'AAAAAA' });
  assert.deepEqual(offer, { gameId: 'BBBBBB', status: 'waiting' });
  assert.equal(db.read('battleshipGames/AAAAAA').rematchGameId, 'BBBBBB');
  assert.equal(db.read('battleshipGames/AAAAAA').rematchBy, 'bob');
  let rematch = db.read('battleshipGames/BBBBBB');
  assert.equal(rematch.hostUid, 'bob');
  assert.equal(rematch.invitedUid, 'alice');
  assert.equal(rematch.rematchOf, 'AAAAAA');
  assert.deepEqual(rematch.players, ['bob', 'alice'], 'the challenged player can read the offer');
  assert.ok(db.read('battleshipPlayers/alice').invites.BBBBBB.rematch);
  assert.deepEqual(await service.rematch(BOB, { gameId: 'AAAAAA' }), { gameId: 'BBBBBB', status: 'waiting' },
    'asking twice keeps one offer');
  const accepted = await service.rematch(ALICE, { gameId: 'AAAAAA' });
  assert.equal(accepted.gameId, 'BBBBBB');
  assert.equal(accepted.joined, true);
  rematch = db.read('battleshipGames/BBBBBB');
  assert.equal(rematch.status, 'placing');
  assert.equal(db.read('battleshipPlayers/alice').invites.BBBBBB, undefined);

  // Leaving during placement cancels without a result and clears the offer.
  assert.equal((await service.resign(ALICE, { gameId: 'BBBBBB' })).status, 'cancelled');
  rematch = db.read('battleshipGames/BBBBBB');
  assert.equal(rematch.endReason, 'left');
  assert.equal(db.read('battleshipGames/AAAAAA').rematchGameId, null, 'a cancelled rematch can be offered again');
  assert.deepEqual(db.read('battleshipPlayers/alice').stats, { played: 1, wins: 1, losses: 0 }, 'a cancelled game is not counted');
  assert.equal(db.read('battleshipPlayers/bob').games.BBBBBB, undefined);

  // --- Direct challenges ----------------------------------------------------------------
  await rejects(service.create(ALICE, { invitedUid: 'alice' }), 'SELF_INVITE');
  await rejects(service.create(ALICE, { invitedUid: 'dave' }), 'PLAYER_NOT_FOUND', 'a pending account cannot be challenged');
  await rejects(service.create(ALICE, { invitedUid: 'nobody' }), 'PLAYER_NOT_FOUND');
  await rejects(service.create(ALICE, { invitedUid: '../users/x' }), 'PLAYER_NOT_FOUND');
  randomQueue = Array(6).fill(2 / 32); // code CCCCCC
  const challenge = await service.create(ALICE, { visibility: 'public', invitedUid: 'carol' });
  assert.equal(challenge.gameId, 'CCCCCC');
  game = db.read('battleshipGames/CCCCCC');
  assert.equal(game.visibility, 'private', 'a challenge is never listed');
  assert.equal(game.names.carol, 'Carol');
  assert.equal(db.read('battleshipLobby/open').games.CCCCCC, undefined);
  assert.equal(db.read('battleshipPlayers/carol').invites.CCCCCC.fromName, 'Алиса Морская');
  assert.equal((await service.create(ALICE, { invitedUid: 'carol' })).reused, true, 'one pending challenge per opponent');
  await rejects(service.join(BOB, { gameId: 'CCCCCC' }), 'NOT_INVITED');
  await rejects(service.decline(BOB, { gameId: 'CCCCCC' }), 'NOT_INVITED');
  assert.equal((await service.decline(CAROL, { gameId: 'CCCCCC' })).status, 'cancelled');
  assert.equal(db.read('battleshipGames/CCCCCC').endReason, 'declined');
  assert.equal(db.read('battleshipPlayers/carol').invites.CCCCCC, undefined);
  assert.equal(db.read('battleshipPlayers/alice').games.CCCCCC, undefined);

  // --- Private games by code expire -------------------------------------------------------
  randomQueue = Array(6).fill(3 / 32); // code DDDDDD
  assert.equal((await service.create(CAROL, { visibility: 'private' })).gameId, 'DDDDDD');
  assert.equal(db.read('battleshipGames/DDDDDD').expiresAtMs, clock + PRIVATE_WAIT_MS);
  assert.equal(db.read('battleshipLobby/open').games.DDDDDD, undefined, 'a private game is not listed');
  clock += PRIVATE_WAIT_MS + 1;
  await rejects(service.join(BOB, { gameId: 'DDDDDD' }), 'GAME_EXPIRED');
  assert.equal(db.read('battleshipGames/DDDDDD').status, 'cancelled', 'an expired game is closed when someone tries it');
  assert.equal(db.read('battleshipGames/DDDDDD').endReason, 'expired');
  assert.equal(db.read('battleshipPlayers/carol').games.DDDDDD, undefined);

  // --- An idle opponent loses by timeout -------------------------------------------------
  randomQueue = Array(6).fill(4 / 32); // code EEEEEE
  await service.create(BOB, { visibility: 'private' });
  await service.join(CAROL, { gameId: 'EEEEEE' });
  await service.place(BOB, { gameId: 'EEEEEE', ships: FLEET });
  await rejects(service.claim(BOB, { gameId: 'EEEEEE' }), 'TOO_EARLY');
  clock += PLACING_IDLE_MS;
  assert.equal((await service.claim(BOB, { gameId: 'EEEEEE' })).status, 'cancelled',
    'a game the opponent never set up can be closed');
  assert.equal(db.read('battleshipGames/EEEEEE').endReason, 'timeout');

  randomQueue = [...Array(6).fill(5 / 32)]; // code FFFFFF
  await service.create(BOB, { visibility: 'private' });
  await service.join(CAROL, { gameId: 'FFFFFF' });
  await service.place(BOB, { gameId: 'FFFFFF', ships: FLEET });
  randomQueue = [0.9]; // carol (guest) moves first
  await service.place(CAROL, { gameId: 'FFFFFF', ships: Rules.randomFleet() });
  assert.equal(db.read('battleshipGames/FFFFFF').turnUid, 'carol');
  clock += TURN_IDLE_MS - 1;
  await rejects(service.claim(BOB, { gameId: 'FFFFFF' }), 'TOO_EARLY');
  clock += 1;
  const claimed = await service.claim(BOB, { gameId: 'FFFFFF' });
  assert.equal(claimed.winnerUid, 'bob');
  assert.equal(db.read('battleshipGames/FFFFFF').endReason, 'timeout');
  assert.deepEqual(db.read('battleshipPlayers/carol').stats, { played: 1, wins: 0, losses: 1 });
  assert.equal(db.read('battleshipGames/FFFFFF').revealed.carol.length, 10);

  // --- Resigning while playing --------------------------------------------------------------
  randomQueue = Array(6).fill(6 / 32); // code GGGGGG
  await service.create(ALICE, { visibility: 'private' });
  await service.join(CAROL, { gameId: 'GGGGGG' });
  await service.place(ALICE, { gameId: 'GGGGGG', ships: FLEET });
  await service.place(CAROL, { gameId: 'GGGGGG', ships: FLEET });
  const resigned = await service.resign(CAROL, { gameId: 'GGGGGG' });
  assert.equal(resigned.winnerUid, 'alice');
  assert.equal(db.read('battleshipGames/GGGGGG').endReason, 'resigned');
  assert.equal((await service.resign(CAROL, { gameId: 'GGGGGG' })).status, 'finished', 'resigning twice is harmless');
  await rejects(service.rematch(CAROL, { gameId: 'EEEEEE' }), 'GAME_NOT_FINISHED', 'a cancelled game has no rematch');

  // --- Cancelling a waiting game and the per-player limit -------------------------------------
  randomQueue = Array(6).fill(7 / 32); // code HHHHHH
  await service.create(BOB, { visibility: 'public' });
  await rejects(service.cancel(CAROL, { gameId: 'HHHHHH' }), 'NOT_A_PLAYER');
  assert.equal((await service.cancel(BOB, { gameId: 'HHHHHH' })).status, 'cancelled');
  assert.equal(db.read('battleshipLobby/open').games.HHHHHH, undefined);
  assert.equal((await service.touch(BOB, { gameId: 'HHHHHH' })).status, 'cancelled', 'touching a closed game only reports it');

  let codeIndex = 8;
  for (let created = 0; created < MAX_ACTIVE_GAMES; created += 1) {
    randomQueue = Array(6).fill(codeIndex / 32);
    codeIndex += 1;
    await service.create(CAROL, { visibility: 'private' });
  }
  await rejects(service.create(CAROL, { visibility: 'private' }), 'TOO_MANY_GAMES');

  // --- HTTP handler ----------------------------------------------------------------------------
  const tokens = { 'token-alice': { uid: 'alice', name: 'Alice' }, 'token-dave': { uid: 'dave' } };
  const auth = {
    async verifyIdToken(token) {
      if (!tokens[token]) {
        const error = new Error('bad token');
        error.code = 'auth/argument-error';
        throw error;
      }
      return tokens[token];
    },
  };
  const handler = createBattleshipHandler({ db, auth, now: () => clock, random });
  async function call({ method = 'POST', origin = 'chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd', token = 'token-alice', body = {} } = {}) {
    const headers = { origin, authorization: token ? `Bearer ${token}` : '' };
    const response = { statusCode: 200, headers: {}, body: null };
    const res = {
      status(code) { response.statusCode = code; return this; },
      set(name, value) { response.headers[name] = value; return this; },
      json(payload) { response.body = payload; return this; },
      send(payload) { response.body = payload; return this; },
    };
    await handler({ method, body, get: (name) => headers[String(name).toLowerCase()] }, res);
    return response;
  }

  let response = await call({ origin: 'https://evil.test', body: { action: 'ping' } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'ORIGIN_NOT_ALLOWED');
  response = await call({ method: 'OPTIONS' });
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['Access-Control-Allow-Origin'], 'chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd');
  response = await call({ method: 'GET' });
  assert.equal(response.statusCode, 405);
  response = await call({ token: null, body: { action: 'ping' } });
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, 'AUTH_REQUIRED');
  response = await call({ token: 'forged', body: { action: 'ping' } });
  assert.equal(response.statusCode, 401);
  response = await call({ token: 'token-dave', body: { action: 'ping' } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'APPROVAL_REQUIRED');
  response = await call({ body: { action: 'delete-everything' } });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'INVALID_ACTION');
  response = await call({ body: { action: 'ping' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.serverTimeMs, clock, 'every answer carries the server clock');
  response = await call({ body: { action: 'place', gameId: 'AAAAAA', ships: [] } });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'INVALID_FLEET');
  assert.equal(response.body.details.rule, 'FLEET_SIZE');
  response = await call({ body: { action: 'join', gameId: 'ZZZZZZ' } });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.serverTimeMs, clock, 'errors carry the server clock too');

  const failing = createBattleshipHandler({
    db: { collection: () => { throw new Error('secret internals'); }, runTransaction: async () => {} },
    auth,
    now: () => clock,
  });
  const failure = { statusCode: 200, body: null };
  await failing({
    method: 'POST',
    body: { action: 'ping' },
    get: (name) => ({ origin: 'chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd', authorization: 'Bearer token-alice' })[String(name).toLowerCase()],
  }, {
    status(code) { failure.statusCode = code; return this; },
    set() { return this; },
    json(payload) { failure.body = payload; return this; },
  });
  assert.equal(failure.statusCode, 500);
  assert.equal(failure.body.code, 'INTERNAL');
  assert.equal(failure.body.error.includes('secret'), false, 'internal errors are not echoed to the client');

  console.log('✅ Battleship function tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
