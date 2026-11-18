const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DAILY_MOVE_MS,
  DRAW_OFFER_GAP,
  FIRST_MOVE_MS,
  PUBLIC_WAIT_MS,
  START_RATING,
  TIME_CONTROLS,
  createChessHandler,
  createChessService,
  hasMatingMaterial,
} = require('../functions/chess');
const Rules = require('../functions/chessRules');

// The function ships its own copy of the rules; it must match the page's.
assert.equal(
  fs.readFileSync(path.join(__dirname, '../functions/chessRules.js'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '../src/shared/games/chess/ChessRules.js'), 'utf8'),
  'functions/chessRules.js is a byte-for-byte copy of src/shared/games/chess/ChessRules.js'
);

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
    this.exists = value !== undefined;
    this._value = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  data() {
    return this._value;
  }
}

class FakeDocRef {
  constructor(db, docPath) {
    this.db = db;
    this.path = docPath;
    this.id = docPath.split('/').pop();
  }

  async get() {
    return new FakeSnapshot(this, this.db.store.get(this.path));
  }
}

class FakeCollection {
  constructor(db, collectionPath) {
    this.db = db;
    this.path = collectionPath;
  }

  doc(id) {
    return new FakeDocRef(this.db, `${this.path}/${id}`);
  }
}

class FakeDb {
  constructor() {
    this.store = new Map();
  }

  collection(name) {
    return new FakeCollection(this, name);
  }

  async runTransaction(callback) {
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
    for (const [docPath, data] of writes) this.store.set(docPath, data);
    return result;
  }

  read(docPath) {
    return this.store.get(docPath);
  }
}

async function rejects(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `${error.code}: ${error.message}`);
    return true;
  });
}

const PROFILES = {
  alice: { firstName: 'Алиса', approvalStatus: 'approved', photoURL: 'https://example.test/a.png' },
  bob: { displayNameFormat: 'username', username: 'bob_knight', approvalStatus: 'approved' },
  carol: { displayName: 'Carol', approvalStatus: 'approved' },
  dave: { displayName: 'Dave', approvalStatus: 'pending' },
};
const actor = (uid) => ({ uid, name: PROFILES[uid].firstName || PROFILES[uid].username || PROFILES[uid].displayName, photo: null });

function setup() {
  const db = new FakeDb();
  for (const [uid, profile] of Object.entries(PROFILES)) db.store.set(`users/${uid}`, profile);
  let time = 1_000_000;
  // Codes come from a fixed sequence; colours from `colorRoll` (below 0.5 = host white).
  let codeIndex = 0;
  const state = { colorRoll: 0.1, codeRolls: [] };
  const random = () => {
    if (state.codeRolls.length) return state.codeRolls.shift();
    codeIndex += 1;
    return ((codeIndex * 7919) % 1000) / 1000;
  };
  const service = createChessService({ db, now: () => time, random: () => {
    // Colour assignment asks once per join; everything else is a code character.
    if (state.nextIsColor) {
      state.nextIsColor = false;
      return state.colorRoll;
    }
    return random();
  } });
  return {
    db,
    service,
    state,
    advance: (ms) => { time += ms; },
    now: () => time,
    game: (code) => db.read(`chessGames/${code}`),
    player: (uid) => db.read(`chessPlayers/${uid}`),
    lobby: () => db.read('chessLobby/open'),
  };
}

async function startGame(env, { timeControl = '10+5', hostColor = 'white', visibility = 'private' } = {}) {
  const { gameId } = await env.service.create(actor('alice'), { visibility, timeControl, color: hostColor });
  env.state.nextIsColor = hostColor === 'random';
  await env.service.join(actor('bob'), { gameId });
  return gameId;
}

async function play(env, gameId, moves) {
  for (const uci of moves) {
    const game = env.game(gameId);
    const mover = game.turnUid;
    await env.service.move(actor(mover), { gameId, uci, expectedMoveCount: game.moveCount });
  }
}

(async () => {
  // --- Pure helpers -------------------------------------------------------------------
  assert.equal(hasMatingMaterial(Rules.ChessGame.fromMoves([], '4k3/8/8/8/8/8/8/4K2N w - - 0 1'), 'white'), false, 'a lone knight cannot mate');
  assert.equal(hasMatingMaterial(Rules.ChessGame.fromMoves([], '4k3/8/8/8/8/8/P7/4K3 w - - 0 1'), 'white'), true, 'a pawn can still queen');
  assert.equal(hasMatingMaterial(Rules.ChessGame.fromMoves([], '4k3/8/8/8/8/8/8/4K3 w - - 0 1'), 'black'), false);
  assert.deepEqual(Object.keys(TIME_CONTROLS), ['3+2', '5+3', '10+5', '15+10', 'none']);

  // --- Open game, lobby, joining --------------------------------------------------------
  {
    const env = setup();
    const created = await env.service.create(actor('alice'), { visibility: 'public', timeControl: '5+3', color: 'black' });
    assert.equal(created.reused, false);
    const code = created.gameId;
    assert.match(code, /^[A-Z2-9]{6}$/);
    assert.equal(env.lobby().games[code].timeControl, '5+3');
    assert.equal(env.lobby().games[code].hostRating, START_RATING);
    assert.equal(env.player('alice').games[code].status, 'waiting');
    // Asking again updates the same open game rather than listing a second one.
    const again = await env.service.create(actor('alice'), { visibility: 'public', timeControl: '3+2', color: 'white' });
    assert.deepEqual(again, { gameId: code, reused: true });
    assert.equal(env.game(code).timeControl, '3+2');
    assert.equal(env.game(code).hostColor, 'white');
    assert.equal(Object.keys(env.lobby().games).length, 1);
    await rejects(env.service.create(actor('alice'), { visibility: 'public', timeControl: '7+0' }), 'INVALID_TIME_CONTROL');
    await rejects(env.service.create(actor('alice'), { visibility: 'public', color: 'green' }), 'INVALID_COLOR');
    await rejects(env.service.join(actor('alice'), { gameId: code }), 'OWN_GAME');
    await env.service.touch(actor('alice'), { gameId: code });
    assert.equal(env.game(code).expiresAtMs, env.now() + PUBLIC_WAIT_MS);

    await env.service.join(actor('bob'), { gameId: code });
    const game = env.game(code);
    assert.equal(game.status, 'playing');
    assert.equal(game.whiteUid, 'alice');
    assert.equal(game.blackUid, 'bob');
    assert.equal(game.turnUid, 'alice');
    assert.deepEqual(game.players, ['alice', 'bob']);
    assert.equal(game.clock.whiteMs, TIME_CONTROLS['3+2'].initialMs);
    assert.equal(env.lobby().games[code], undefined, 'a started game leaves the lobby');
    assert.equal(env.player('bob').games[code].color, 'black');
    assert.equal(env.player('alice').games[code].opponentName, 'bob_knight');
    await rejects(env.service.join(actor('carol'), { gameId: code }), 'GAME_NOT_JOINABLE');
  }

  // --- Moves: turn, legality, staleness, checkmate, ratings --------------------------
  {
    const env = setup();
    const code = await startGame(env, { hostColor: 'white' });
    await rejects(env.service.move(actor('bob'), { gameId: code, uci: 'e7e5' }), 'NOT_YOUR_TURN');
    await rejects(env.service.move(actor('alice'), { gameId: code, uci: 'e2e5' }), 'ILLEGAL_MOVE');
    await rejects(env.service.move(actor('alice'), { gameId: code, uci: 'O-O' }), 'INVALID_MOVE');
    await rejects(env.service.move(actor('alice'), { gameId: code, uci: 'e2e4', expectedMoveCount: 3 }), 'STALE_MOVE');
    await rejects(env.service.move(actor('carol'), { gameId: code, uci: 'e2e4' }), 'NOT_A_PLAYER');
    // Fool's mate: Bob (black) mates on move two.
    await play(env, code, ['f2f3', 'e7e5', 'g2g4']);
    assert.equal(env.player('alice').games[code].turnUid, 'bob', 'summaries follow the turn');
    const answer = await env.service.move(actor('bob'), { gameId: code, uci: 'd8h4', expectedMoveCount: 3 });
    assert.equal(answer.san, 'Qh4#');
    const game = env.game(code);
    assert.equal(game.status, 'finished');
    assert.equal(game.result, '0-1');
    assert.equal(game.endReason, 'checkmate');
    assert.equal(game.winnerUid, 'bob');
    assert.deepEqual(game.sans, ['f3', 'e5', 'g4', 'Qh4#']);
    assert.equal(game.fen, Rules.ChessGame.fromMoves(['f2f3', 'e7e5', 'g2g4', 'd8h4']).fen());
    assert.deepEqual(game.ratingDelta, { alice: -20, bob: 20 }, 'equal ratings, K = 40: ±20');
    assert.equal(env.player('bob').rating, START_RATING + 20);
    assert.equal(env.player('alice').rating, START_RATING - 20);
    assert.deepEqual(env.player('bob').stats, { played: 1, wins: 1, draws: 0, losses: 0 });
    assert.equal(env.player('alice').recent[0].result, 'loss');
    assert.equal(env.player('alice').recent[0].reason, 'checkmate');
    assert.equal(env.player('alice').games[code], undefined, 'a finished game leaves the unfinished list');
    await rejects(env.service.move(actor('alice'), { gameId: code, uci: 'e2e4' }), 'GAME_NOT_ACTIVE');

    // Rematch: Alice asks, the colours swap, Bob accepts through the same action.
    const rematch = await env.service.rematch(actor('alice'), { gameId: code });
    assert.equal(env.game(rematch.gameId).hostColor, 'black');
    assert.equal(env.player('bob').invites[rematch.gameId].rematch, true);
    assert.equal(env.player('bob').invites[rematch.gameId].fromRating, START_RATING - 20);
    const accepted = await env.service.rematch(actor('bob'), { gameId: code });
    assert.deepEqual(accepted, { gameId: rematch.gameId, status: 'playing', joined: true });
    assert.equal(env.game(rematch.gameId).whiteUid, 'bob');
    assert.equal(env.game(rematch.gameId).blackUid, 'alice');
    assert.equal(env.player('bob').invites[rematch.gameId], undefined);
  }

  // --- Clocks: increment, flag fall, first-move abort ---------------------------------------
  {
    const env = setup();
    const code = await startGame(env, { timeControl: '3+2', hostColor: 'white' });
    const control = TIME_CONTROLS['3+2'];
    env.advance(20_000);
    await play(env, code, ['e2e4']);
    env.advance(30_000);
    await play(env, code, ['e7e5']);
    let game = env.game(code);
    assert.equal(game.clock.whiteMs, control.initialMs, 'first moves do not touch the clocks');
    assert.equal(game.clock.blackMs, control.initialMs);
    env.advance(10_000);
    await play(env, code, ['g1f3']);
    game = env.game(code);
    assert.equal(game.clock.whiteMs, control.initialMs - 10_000 + control.incrementMs, 'thinking time out, increment in');
    await rejects(env.service.timeout(actor('alice'), { gameId: code }), 'TOO_EARLY');
    env.advance(control.initialMs + 1);
    // Black's flag fell; either player reports it and the server checks the clock.
    const flagged = await env.service.timeout(actor('alice'), { gameId: code });
    assert.equal(flagged.result, '1-0');
    game = env.game(code);
    assert.equal(game.endReason, 'timeout');
    assert.equal(game.clock.blackMs, 0);
    // A move sent after the flag fell does not count.
    const late = setup();
    const lateCode = await startGame(late, { timeControl: '3+2' });
    await play(late, lateCode, ['e2e4', 'e7e5']);
    late.advance(control.initialMs + 5);
    const answer = await late.service.move(actor('alice'), { gameId: lateCode, uci: 'g1f3', expectedMoveCount: 2 });
    assert.equal(answer.status, 'finished');
    assert.equal(late.game(lateCode).result, '0-1');
    assert.deepEqual(late.game(lateCode).moves, ['e2e4', 'e7e5']);

    const idle = setup();
    const idleCode = await startGame(idle, { timeControl: '5+3' });
    idle.advance(FIRST_MOVE_MS - 1);
    await rejects(idle.service.timeout(actor('bob'), { gameId: idleCode }), 'TOO_EARLY');
    idle.advance(2);
    const aborted = await idle.service.timeout(actor('bob'), { gameId: idleCode });
    assert.deepEqual(aborted, { gameId: idleCode, status: 'cancelled', endReason: 'aborted' });
    assert.equal(idle.player('bob').stats.played, 0, 'an aborted game is not rated');
    assert.equal(idle.player('alice').games[idleCode], undefined);
  }

  // --- Draws: offer, decline by moving, limit, accept ------------------------------------------------
  {
    const env = setup();
    const code = await startGame(env);
    await rejects(env.service.offerDraw(actor('alice'), { gameId: code }), 'TOO_EARLY');
    await play(env, code, ['e2e4', 'e7e5']);
    await env.service.offerDraw(actor('alice'), { gameId: code });
    assert.equal(env.game(code).drawOffer.by, 'alice');
    assert.equal(env.player('bob').games[code].drawOfferBy, 'alice', 'the notice can tell Bob');
    await rejects(env.service.answerDraw(actor('alice'), { gameId: code, accept: true }), 'NO_DRAW_OFFER');
    // The offerer moving keeps the offer; the opponent moving declines it.
    await play(env, code, ['g1f3']);
    assert.equal(env.game(code).drawOffer.by, 'alice');
    await play(env, code, ['b8c6']);
    assert.equal(env.game(code).drawOffer, null);
    await rejects(env.service.offerDraw(actor('alice'), { gameId: code }), 'DRAW_OFFER_LIMIT');
    await env.service.offerDraw(actor('bob'), { gameId: code });
    await env.service.answerDraw(actor('alice'), { gameId: code, accept: false });
    assert.equal(env.game(code).drawOffer, null);
    await play(env, code, ['f1c4', 'f8c5', 'd2d3', 'd7d6', 'c1g5', 'c8g4']);
    assert.ok(env.game(code).moveCount - 2 >= DRAW_OFFER_GAP);
    await env.service.offerDraw(actor('alice'), { gameId: code });
    // Offering back accepts.
    const drawn = await env.service.offerDraw(actor('bob'), { gameId: code });
    assert.equal(drawn.result, '1/2-1/2');
    assert.equal(env.game(code).endReason, 'agreement');
    assert.deepEqual(env.game(code).ratingDelta, { alice: 0, bob: 0 });
    assert.equal(env.player('alice').stats.draws, 1);
  }

  // --- Resign and abort --------------------------------------------------------------------------
  {
    const env = setup();
    const early = await startGame(env);
    const aborted = await env.service.resign(actor('bob'), { gameId: early });
    assert.equal(aborted.endReason, 'aborted', 'resigning before both sides moved aborts');
    const code = await startGame(env, { hostColor: 'black' });
    await play(env, code, ['d2d4', 'd7d5']);
    await rejects(env.service.abort(actor('alice'), { gameId: code }), 'GAME_STARTED');
    const resigned = await env.service.resign(actor('alice'), { gameId: code });
    assert.equal(resigned.result, '1-0', 'Alice had black and resigned');
    assert.equal(env.game(code).endReason, 'resigned');
  }

  // --- A game without clocks: a day per move, claimed by the waiting side ---------------------
  {
    const env = setup();
    const code = await startGame(env, { timeControl: 'none' });
    assert.equal(env.game(code).clock.whiteMs, null);
    await play(env, code, ['e2e4', 'c7c5']);
    env.advance(DAILY_MOVE_MS - 1);
    await rejects(env.service.timeout(actor('bob'), { gameId: code }), 'TOO_EARLY');
    env.advance(2);
    await rejects(env.service.timeout(actor('alice'), { gameId: code }), 'TOO_EARLY');
    const claimed = await env.service.timeout(actor('bob'), { gameId: code });
    assert.equal(claimed.result, '0-1');
    assert.equal(env.game(code).endReason, 'abandoned');
  }

  // --- Challenges -----------------------------------------------------------------------------------
  {
    const env = setup();
    await rejects(env.service.create(actor('alice'), { invitedUid: 'alice' }), 'SELF_INVITE');
    await rejects(env.service.create(actor('alice'), { invitedUid: 'dave' }), 'PLAYER_NOT_FOUND');
    const { gameId } = await env.service.create(actor('alice'), { invitedUid: 'carol', timeControl: '15+10', color: 'random' });
    assert.equal(env.game(gameId).visibility, 'private');
    assert.deepEqual(env.game(gameId).players, ['alice', 'carol']);
    assert.equal(env.player('carol').invites[gameId].timeControl, '15+10');
    await rejects(env.service.join(actor('bob'), { gameId }), 'NOT_INVITED');
    await env.service.decline(actor('carol'), { gameId });
    assert.equal(env.game(gameId).status, 'cancelled');
    assert.equal(env.player('carol').invites[gameId], undefined);
    assert.equal(env.player('alice').games[gameId], undefined);
  }

  // --- The HTTP handler -------------------------------------------------------------------------------
  {
    const env = setup();
    const auth = {
      verifyIdToken: async (token) => {
        if (token === 'bad') {
          const error = new Error('bad token');
          error.code = 'auth/argument-error';
          throw error;
        }
        return { uid: token };
      },
    };
    const handler = createChessHandler({ db: env.db, auth, now: env.now });
    const call = async ({ origin = 'chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd', token = 'alice', body = {}, method = 'POST' } = {}) => {
      const headers = { origin, authorization: token ? `Bearer ${token}` : '' };
      const answer = { status: 200, headers: {}, body: null };
      const res = {
        status(code) { answer.status = code; return this; },
        set(name, value) { answer.headers[name] = value; return this; },
        json(payload) { answer.body = payload; return this; },
        send(payload) { answer.body = payload; return this; },
      };
      await handler({ method, body, get: (name) => headers[String(name).toLowerCase()] }, res);
      return answer;
    };
    assert.equal((await call({ origin: 'https://evil.test' })).status, 403);
    assert.equal((await call({ method: 'OPTIONS' })).status, 204);
    assert.equal((await call({ method: 'GET' })).status, 405);
    assert.equal((await call({ token: 'bad', body: { action: 'ping' } })).body.code, 'AUTH_REQUIRED');
    assert.equal((await call({ token: 'dave', body: { action: 'ping' } })).body.code, 'APPROVAL_REQUIRED');
    assert.equal((await call({ body: { action: 'hack' } })).body.code, 'INVALID_ACTION');
    const ping = await call({ body: { action: 'ping' } });
    assert.equal(ping.body.ok, true);
    assert.equal(ping.body.serverTimeMs, env.now());
    const created = await call({ body: { action: 'create', visibility: 'private', timeControl: '10+5', color: 'white' } });
    assert.equal(created.status, 200);
    const joined = await call({ token: 'bob', body: { action: 'join', gameId: created.body.gameId.toLowerCase() } });
    assert.equal(joined.body.ok, true);
    const moved = await call({ body: { action: 'move', gameId: created.body.gameId, uci: 'e2e4', expectedMoveCount: 0 } });
    assert.equal(moved.body.san, 'e4');
    const illegal = await call({ token: 'bob', body: { action: 'move', gameId: created.body.gameId, uci: 'e7e4' } });
    assert.equal(illegal.status, 400);
    assert.equal(illegal.body.code, 'ILLEGAL_MOVE');
  }

  console.log('✅ Chess function tests passed!');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
