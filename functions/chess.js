/**
 * Networked chess referee. Every change to a game goes through this module;
 * clients only read Firestore and subscribe to it.
 *
 * Firestore layout, written here with the Admin SDK only:
 *   chessGames/{code}   the game: players, colours, moves, clocks, result;
 *                       readable by its players
 *   chessPlayers/{uid}  a player's unfinished games, incoming challenges,
 *                       recent results, totals and rating
 *   chessLobby/open     public games waiting for an opponent
 *
 * Each move is replayed on chessRules.js (a byte-for-byte copy of the page's
 * rules), so a modified client cannot make an illegal move, move out of turn or
 * stop its own clock. Times are server milliseconds; every response carries
 * `serverTimeMs` so clients count clocks on the server's time.
 *
 * Clocks start once both sides have made their first move. Until then the side
 * to move has FIRST_MOVE_MS (a day in a game without clocks); a game whose
 * first moves never come is aborted without a result. Ratings are Elo, 1200 to
 * start, K = 40 for a player's first ten games and 20 after.
 */
const Rules = require("./chessRules");

const EXTENSION_ORIGIN = "chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd";
const GAMES = "chessGames";
const PLAYERS = "chessPlayers";
const LOBBY_COLLECTION = "chessLobby";
const LOBBY_DOCUMENT = "open";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

// An open game stays listed while its host's page keeps touching it.
const PUBLIC_WAIT_MS = 10 * 60 * 1000;
// A game shared by code or a direct challenge waits much longer.
const PRIVATE_WAIT_MS = 12 * 60 * 60 * 1000;
// The first move of each side, in a game with clocks.
const FIRST_MOVE_MS = 60 * 1000;
// A game without clocks gives a day for every move.
const DAILY_MOVE_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_GAMES = 8;
const LOBBY_LIMIT = 40;
const RECENT_LIMIT = 12;
const NAME_LIMIT = 120;
const MAX_PLIES = 1200;
// A player may offer a draw again after this many more half-moves.
const DRAW_OFFER_GAP = 6;
const START_RATING = 1200;
const MIN_RATING = 100;

const TIME_CONTROLS = Object.freeze({
  "3+2": Object.freeze({ initialMs: 3 * 60 * 1000, incrementMs: 2000 }),
  "5+3": Object.freeze({ initialMs: 5 * 60 * 1000, incrementMs: 3000 }),
  "10+5": Object.freeze({ initialMs: 10 * 60 * 1000, incrementMs: 5000 }),
  "15+10": Object.freeze({ initialMs: 15 * 60 * 1000, incrementMs: 10000 }),
  "none": null,
});
const DEFAULT_TIME_CONTROL = "10+5";
const COLORS = new Set(["white", "black", "random"]);
const VISIBILITIES = new Set(["public", "private"]);
const ACTIONS = new Set([
  "ping", "create", "join", "decline", "cancel", "touch", "move", "resign", "abort",
  "offerDraw", "answerDraw", "timeout", "rematch",
]);

function chessError(code, message, statusCode = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function ratingOf(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= MIN_RATING ? Math.round(number) : START_RATING;
}

/** Firestore rejects undefined; every optional field is written as null instead. */
function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (!isPlainObject(value)) return value === undefined ? null : value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = withoutUndefined(entry);
  }
  return result;
}

function isApprovedProfile(profile) {
  if (!profile) return false;
  return profile.approvalStatus === "approved" || !Object.prototype.hasOwnProperty.call(profile, "approvalStatus");
}

function isAdminProfile(profile) {
  return profile?.isAdmin === true;
}

function displayNameFromProfile(profile, decodedToken = null) {
  const clip = (value) => String(value || "").trim().slice(0, NAME_LIMIT);
  if (profile?.displayNameFormat === "username" && profile.username) {
    return clip(profile.username) || "Игрок";
  }
  const fullName = [profile?.firstName, profile?.lastName].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  return clip(fullName || profile?.displayName || decodedToken?.name || profile?.username || "Игрок") || "Игрок";
}

function safePhotoUrl(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 2048) return null;
  try {
    return new URL(text).protocol === "https:" ? text : null;
  } catch {
    return null;
  }
}

function playerFromProfile(uid, profile, decodedToken = null) {
  return {
    uid,
    name: displayNameFromProfile(profile, decodedToken),
    photo: safePhotoUrl(profile?.photoURL || decodedToken?.picture),
  };
}

function normalizeGameId(value) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) throw chessError("INVALID_GAME", "The game code is invalid");
  return code;
}

function normalizeUid(value) {
  const uid = String(value ?? "").trim();
  if (!UID_PATTERN.test(uid)) throw chessError("PLAYER_NOT_FOUND", "The player was not found", 404);
  return uid;
}

function normalizeTimeControl(value) {
  const id = value === undefined || value === null || value === "" ? DEFAULT_TIME_CONTROL : String(value);
  if (!Object.prototype.hasOwnProperty.call(TIME_CONTROLS, id)) {
    throw chessError("INVALID_TIME_CONTROL", "The time control is invalid");
  }
  return id;
}

function normalizeColor(value) {
  const color = value === undefined || value === null || value === "" ? "random" : String(value);
  if (!COLORS.has(color)) throw chessError("INVALID_COLOR", "The colour choice is invalid");
  return color;
}

function randomCode(random) {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    const pick = Math.floor(Number(random()) * CODE_ALPHABET.length);
    code += CODE_ALPHABET[Math.min(CODE_ALPHABET.length - 1, Math.max(0, pick || 0))];
  }
  return code;
}

function emptyPlayerDoc(uid) {
  return {
    uid,
    games: {},
    invites: {},
    recent: [],
    stats: { played: 0, wins: 0, draws: 0, losses: 0 },
    rating: START_RATING,
    ratedGames: 0,
    updatedAtMs: 0,
  };
}

function normalizePlayerDoc(data, uid) {
  const doc = isPlainObject(data) ? data : {};
  return {
    ...emptyPlayerDoc(uid),
    games: isPlainObject(doc.games) ? { ...doc.games } : {},
    invites: isPlainObject(doc.invites) ? { ...doc.invites } : {},
    recent: Array.isArray(doc.recent) ? doc.recent.filter(isPlainObject).slice(0, RECENT_LIMIT) : [],
    stats: {
      played: nonNegativeInt(doc.stats?.played),
      wins: nonNegativeInt(doc.stats?.wins),
      draws: nonNegativeInt(doc.stats?.draws),
      losses: nonNegativeInt(doc.stats?.losses),
    },
    rating: ratingOf(doc.rating),
    ratedGames: nonNegativeInt(doc.ratedGames),
    updatedAtMs: Number(doc.updatedAtMs) || 0,
  };
}

/** Waiting games and challenges that ran out are dropped whenever a doc is written. */
function prunePlayerDoc(doc, time) {
  for (const [gameId, summary] of Object.entries(doc.games)) {
    if (!isPlainObject(summary)) delete doc.games[gameId];
    else if (summary.status === "waiting" && Number(summary.expiresAtMs) > 0 && Number(summary.expiresAtMs) <= time) {
      delete doc.games[gameId];
    }
  }
  for (const [gameId, invite] of Object.entries(doc.invites)) {
    if (!isPlainObject(invite) || Number(invite.expiresAtMs) <= time) delete doc.invites[gameId];
  }
  return doc;
}

function normalizeLobby(data) {
  const lobby = isPlainObject(data) ? data : {};
  return { games: isPlainObject(lobby.games) ? { ...lobby.games } : {}, updatedAtMs: Number(lobby.updatedAtMs) || 0 };
}

function pruneLobby(lobby, time) {
  for (const [gameId, entry] of Object.entries(lobby.games)) {
    if (!isPlainObject(entry) || Number(entry.expiresAtMs) <= time) delete lobby.games[gameId];
  }
  return lobby;
}

function opponentOf(game, uid) {
  if (uid === game.hostUid) return game.guestUid || game.invitedUid || null;
  return game.hostUid;
}

function isSeated(game, uid) {
  return Boolean(uid) && (uid === game.hostUid || uid === game.guestUid);
}

function colorOf(game, uid) {
  if (uid && uid === game.whiteUid) return "white";
  if (uid && uid === game.blackUid) return "black";
  return null;
}

function timeControlOf(game) {
  return TIME_CONTROLS[game.timeControl] || null;
}

function gameSummary(game, uid) {
  const opponentUid = opponentOf(game, uid);
  return {
    status: game.status,
    role: uid === game.hostUid ? "host" : "guest",
    visibility: game.visibility,
    timeControl: game.timeControl,
    color: colorOf(game, uid),
    hostColor: game.hostColor,
    opponentUid,
    opponentName: opponentUid ? game.names?.[opponentUid] || null : null,
    opponentPhoto: opponentUid ? game.photos?.[opponentUid] || null : null,
    opponentRating: opponentUid ? game.ratings?.[opponentUid] || null : null,
    turnUid: game.turnUid || null,
    moveCount: nonNegativeInt(game.moveCount),
    drawOfferBy: game.drawOffer?.by || null,
    expiresAtMs: game.status === "waiting" ? game.expiresAtMs || null : null,
    updatedAtMs: game.updatedAtMs,
  };
}

function inviteEntry(game) {
  return {
    fromUid: game.hostUid,
    fromName: game.names?.[game.hostUid] || null,
    fromPhoto: game.photos?.[game.hostUid] || null,
    fromRating: game.ratings?.[game.hostUid] || null,
    timeControl: game.timeControl,
    hostColor: game.hostColor,
    rematch: Boolean(game.rematchOf),
    createdAtMs: game.createdAtMs,
    expiresAtMs: game.expiresAtMs,
  };
}

function lobbyEntry(game) {
  return {
    hostUid: game.hostUid,
    hostName: game.names?.[game.hostUid] || null,
    hostPhoto: game.photos?.[game.hostUid] || null,
    hostRating: game.ratings?.[game.hostUid] || null,
    timeControl: game.timeControl,
    hostColor: game.hostColor,
    createdAtMs: game.createdAtMs,
    expiresAtMs: game.expiresAtMs,
  };
}

function newGame({ code, host, hostRating, visibility, timeControl, hostColor, invitee = null, inviteeRating = null, rematchOf = null, time }) {
  const names = { [host.uid]: host.name };
  const photos = { [host.uid]: host.photo };
  const ratings = { [host.uid]: hostRating };
  if (invitee) {
    names[invitee.uid] = invitee.name;
    photos[invitee.uid] = invitee.photo;
    ratings[invitee.uid] = inviteeRating;
  }
  return {
    id: code,
    version: 1,
    status: "waiting",
    visibility,
    timeControl,
    hostColor,
    hostUid: host.uid,
    guestUid: null,
    invitedUid: invitee ? invitee.uid : null,
    // A challenged player may read the game before answering.
    players: invitee ? [host.uid, invitee.uid] : [host.uid],
    names,
    photos,
    ratings,
    whiteUid: null,
    blackUid: null,
    fen: Rules.START_FEN,
    moves: [],
    sans: [],
    moveCount: 0,
    turnUid: null,
    clock: null,
    lastMove: null,
    drawOffer: null,
    drawOfferMoves: {},
    result: null,
    winnerUid: null,
    endReason: null,
    ratingDelta: null,
    ratingsAfter: null,
    rematchOf,
    rematchGameId: null,
    rematchBy: null,
    createdAtMs: time,
    updatedAtMs: time,
    startedAtMs: null,
    finishedAtMs: null,
    expiresAtMs: time + (visibility === "public" ? PUBLIC_WAIT_MS : PRIVATE_WAIT_MS),
  };
}

function cloneGame(data) {
  const game = JSON.parse(JSON.stringify(data || {}));
  for (const key of ["names", "photos", "ratings", "drawOfferMoves"]) {
    if (!isPlainObject(game[key])) game[key] = {};
  }
  if (!Array.isArray(game.players)) game.players = [game.hostUid].filter(Boolean);
  if (!Array.isArray(game.moves)) game.moves = [];
  if (!Array.isArray(game.sans)) game.sans = [];
  game.moveCount = game.moves.length;
  return game;
}

/** The time the side to move has left at `time`, or null in a game without clocks. */
function remainingMs(game, color, time) {
  const control = timeControlOf(game);
  if (!control || !game.clock) return null;
  const stored = Number(game.clock[`${color}Ms`]);
  const running = game.status === "playing" && game.moveCount >= 2 && colorOf(game, game.turnUid) === color;
  return running ? stored - (time - Number(game.clock.turnStartedAtMs)) : stored;
}

/** How long the side to move may take before the opponent can act on it. */
function turnDeadline(game) {
  const start = Number(game.clock?.turnStartedAtMs) || Number(game.startedAtMs) || 0;
  const control = timeControlOf(game);
  if (game.moveCount < 2) return start + (control ? FIRST_MOVE_MS : DAILY_MOVE_MS);
  if (!control) return start + DAILY_MOVE_MS;
  const color = colorOf(game, game.turnUid);
  return start + Math.max(0, Number(game.clock?.[`${color}Ms`]) || 0);
}

/** Can `color` still mate with what it has left? A lone king or one minor piece cannot. */
function hasMatingMaterial(chess, color) {
  const own = chess.pieces().filter((piece) => piece.color === (color === "white" ? "w" : "b") && piece.type !== "k");
  if (!own.length) return false;
  if (own.length === 1 && (own[0].type === "n" || own[0].type === "b")) return false;
  return true;
}

function expectedScore(rating, opponent) {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

function createChessService({ db, now = () => Date.now(), random = Math.random } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("Chess Firestore dependency is required");
  }

  const gameRef = (gameId) => db.collection(GAMES).doc(gameId);
  const playerRef = (uid) => db.collection(PLAYERS).doc(uid);
  const lobbyRef = () => db.collection(LOBBY_COLLECTION).doc(LOBBY_DOCUMENT);

  async function readGame(transaction, gameId) {
    const snapshot = await transaction.get(gameRef(gameId));
    if (!snapshot.exists) throw chessError("GAME_NOT_FOUND", "The game was not found", 404);
    return cloneGame(snapshot.data());
  }

  async function readPlayer(transaction, uid) {
    const snapshot = await transaction.get(playerRef(uid));
    return normalizePlayerDoc(snapshot.exists ? snapshot.data() : null, uid);
  }

  async function readLobby(transaction) {
    const snapshot = await transaction.get(lobbyRef());
    return normalizeLobby(snapshot.exists ? snapshot.data() : null);
  }

  function writeGame(transaction, game) {
    transaction.set(gameRef(game.id), withoutUndefined(game));
  }

  function writePlayer(transaction, doc, time) {
    prunePlayerDoc(doc, time);
    doc.updatedAtMs = time;
    transaction.set(playerRef(doc.uid), withoutUndefined(doc));
  }

  function writeLobby(transaction, lobby, time) {
    pruneLobby(lobby, time);
    lobby.updatedAtMs = time;
    transaction.set(lobbyRef(), withoutUndefined(lobby));
  }

  async function readProfile(uid) {
    const snapshot = await db.collection("users").doc(uid).get();
    return snapshot.exists ? snapshot.data() || null : null;
  }

  async function pickFreeCode(transaction) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = randomCode(random);
      const snapshot = await transaction.get(gameRef(code));
      if (!snapshot.exists) return code;
    }
    throw chessError("CODE_UNAVAILABLE", "Could not reserve a game code", 503);
  }

  async function readSeatedDocs(transaction, game) {
    return {
      [game.hostUid]: await readPlayer(transaction, game.hostUid),
      [game.guestUid]: await readPlayer(transaction, game.guestUid),
    };
  }

  function writeSummaries(transaction, game, docs, time) {
    for (const doc of Object.values(docs)) {
      doc.games[game.id] = gameSummary(game, doc.uid);
      writePlayer(transaction, doc, time);
    }
  }

  /**
   * Everything a cancelled game touches: the seated players, a challenged one,
   * the lobby for an open game and the finished game a rematch came from.
   * Reads only, so a transaction can do its writes afterwards.
   */
  async function readCancelContext(transaction, game) {
    const uids = [...new Set([game.hostUid, game.guestUid, game.invitedUid].filter(Boolean))];
    const docs = {};
    for (const uid of uids) docs[uid] = await readPlayer(transaction, uid);
    const lobby = game.visibility === "public" ? await readLobby(transaction) : null;
    let source = null;
    if (game.rematchOf && CODE_PATTERN.test(String(game.rematchOf))) {
      const snapshot = await transaction.get(gameRef(game.rematchOf));
      source = snapshot.exists ? cloneGame(snapshot.data()) : null;
    }
    return { docs, lobby, source };
  }

  function applyCancel(transaction, game, context, reason, time) {
    game.status = "cancelled";
    game.endReason = reason;
    game.turnUid = null;
    game.drawOffer = null;
    game.finishedAtMs = time;
    game.updatedAtMs = time;
    game.expiresAtMs = null;
    writeGame(transaction, game);
    for (const doc of Object.values(context.docs)) {
      delete doc.games[game.id];
      delete doc.invites[game.id];
      writePlayer(transaction, doc, time);
    }
    if (context.lobby) {
      delete context.lobby.games[game.id];
      writeLobby(transaction, context.lobby, time);
    }
    if (context.source && context.source.rematchGameId === game.id) {
      context.source.rematchGameId = null;
      context.source.rematchBy = null;
      context.source.updatedAtMs = time;
      writeGame(transaction, context.source);
    }
  }

  /** Ends a game with a result, moves both players' ratings and records it. */
  function applyFinish(transaction, game, docs, { result, reason }, time) {
    const whiteScore = result === "1-0" ? 1 : result === "0-1" ? 0 : 0.5;
    // Freeze the clocks where they stood.
    if (game.clock && timeControlOf(game)) {
      for (const color of ["white", "black"]) {
        const left = remainingMs(game, color, time);
        game.clock[`${color}Ms`] = Math.max(0, Math.round(left));
      }
      game.clock.turnStartedAtMs = time;
    }
    game.status = "finished";
    game.result = result;
    game.winnerUid = whiteScore === 1 ? game.whiteUid : whiteScore === 0 ? game.blackUid : null;
    game.endReason = reason;
    game.turnUid = null;
    game.drawOffer = null;
    game.finishedAtMs = time;
    game.updatedAtMs = time;
    const before = {
      [game.whiteUid]: docs[game.whiteUid].rating,
      [game.blackUid]: docs[game.blackUid].rating,
    };
    game.ratingDelta = {};
    game.ratingsAfter = {};
    for (const uid of [game.whiteUid, game.blackUid]) {
      const doc = docs[uid];
      const opponentUid = uid === game.whiteUid ? game.blackUid : game.whiteUid;
      const score = uid === game.whiteUid ? whiteScore : 1 - whiteScore;
      const factor = doc.ratedGames < 10 ? 40 : 20;
      const delta = Math.round(factor * (score - expectedScore(before[uid], before[opponentUid])));
      doc.rating = Math.max(MIN_RATING, before[uid] + delta);
      doc.ratedGames += 1;
      game.ratingDelta[uid] = doc.rating - before[uid];
      game.ratingsAfter[uid] = doc.rating;
      const outcome = score === 1 ? "win" : score === 0 ? "loss" : "draw";
      delete doc.games[game.id];
      doc.recent = [{
        gameId: game.id,
        opponentUid,
        opponentName: game.names?.[opponentUid] || null,
        opponentPhoto: game.photos?.[opponentUid] || null,
        opponentRating: before[opponentUid],
        color: colorOf(game, uid),
        result: outcome,
        reason,
        moveCount: game.moveCount,
        timeControl: game.timeControl,
        ratingDelta: game.ratingDelta[uid],
        ratingAfter: doc.rating,
        finishedAtMs: time,
      }, ...doc.recent.filter((entry) => entry.gameId !== game.id)].slice(0, RECENT_LIMIT);
      doc.stats.played += 1;
      if (outcome === "win") doc.stats.wins += 1;
      else if (outcome === "loss") doc.stats.losses += 1;
      else doc.stats.draws += 1;
    }
    writeGame(transaction, game);
    for (const doc of Object.values(docs)) writePlayer(transaction, doc, time);
  }

  /** Who wins when `loserColor` runs out of time: the other side, if it can still mate. */
  function timeoutResult(game, loserColor) {
    const chess = Rules.ChessGame.fromMoves(game.moves);
    const winnerColor = loserColor === "white" ? "black" : "white";
    if (!hasMatingMaterial(chess, winnerColor)) return { result: "1/2-1/2", reason: "timeout_draw" };
    return { result: winnerColor === "white" ? "1-0" : "0-1", reason: "timeout" };
  }

  function seatGuest(game, guest, guestRating, time) {
    game.guestUid = guest.uid;
    game.players = [game.hostUid, guest.uid];
    game.names[guest.uid] = guest.name;
    game.photos[guest.uid] = guest.photo;
    game.ratings[guest.uid] = guestRating;
    let hostWhite = game.hostColor === "white";
    if (game.hostColor === "random") hostWhite = Number(random()) < 0.5;
    game.whiteUid = hostWhite ? game.hostUid : guest.uid;
    game.blackUid = hostWhite ? guest.uid : game.hostUid;
    const control = timeControlOf(game);
    game.clock = {
      whiteMs: control ? control.initialMs : null,
      blackMs: control ? control.initialMs : null,
      turnStartedAtMs: time,
    };
    game.status = "playing";
    game.turnUid = game.whiteUid;
    game.startedAtMs = time;
    game.expiresAtMs = null;
    game.updatedAtMs = time;
  }

  /** Reads, then writes, of a guest taking the free seat. Used by join and by an accepted rematch. */
  async function joinInTransaction(transaction, game, guest, time) {
    const guestDoc = await readPlayer(transaction, guest.uid);
    prunePlayerDoc(guestDoc, time);
    if (!guestDoc.games[game.id] && Object.keys(guestDoc.games).length >= MAX_ACTIVE_GAMES) {
      throw chessError("TOO_MANY_GAMES", "Finish one of your games first", 409);
    }
    const hostDoc = await readPlayer(transaction, game.hostUid);
    const lobby = game.visibility === "public" ? await readLobby(transaction) : null;
    game.ratings[game.hostUid] = hostDoc.rating;
    seatGuest(game, guest, guestDoc.rating, time);
    writeGame(transaction, game);
    delete guestDoc.invites[game.id];
    writeSummaries(transaction, game, { [hostDoc.uid]: hostDoc, [guestDoc.uid]: guestDoc }, time);
    if (lobby) {
      delete lobby.games[game.id];
      writeLobby(transaction, lobby, time);
    }
  }

  function requirePlaying(game, uid) {
    if (!isSeated(game, uid)) throw chessError("NOT_A_PLAYER", "You are not playing this game", 403);
    if (game.status !== "playing") throw chessError("GAME_NOT_ACTIVE", "The game is not in progress", 409);
  }

  const service = {
    async create(actor, { visibility = "private", invitedUid = null, timeControl, color } = {}) {
      let mode = String(visibility || "private");
      if (!VISIBILITIES.has(mode)) throw chessError("INVALID_VISIBILITY", "The game visibility is invalid");
      const control = normalizeTimeControl(timeControl);
      const hostColor = normalizeColor(color);
      let invitee = null;
      if (invitedUid !== null && invitedUid !== undefined && invitedUid !== "") {
        const uid = normalizeUid(invitedUid);
        if (uid === actor.uid) throw chessError("SELF_INVITE", "You cannot challenge yourself");
        const profile = await readProfile(uid);
        if (!profile || !isApprovedProfile(profile)) throw chessError("PLAYER_NOT_FOUND", "The player was not found", 404);
        invitee = playerFromProfile(uid, profile);
        mode = "private";
      }
      const time = now();
      return db.runTransaction(async (transaction) => {
        const hostDoc = await readPlayer(transaction, actor.uid);
        prunePlayerDoc(hostDoc, time);
        // Asking again updates the same open game, or the same pending challenge.
        const existing = Object.entries(hostDoc.games).find(([, summary]) => (
          summary.status === "waiting" && summary.role === "host" && (invitee
            ? summary.opponentUid === invitee.uid
            : mode === "public" && summary.visibility === "public")
        ));
        if (existing) {
          const game = await readGame(transaction, existing[0]);
          const inviteeDoc = invitee ? await readPlayer(transaction, invitee.uid) : null;
          const lobby = game.visibility === "public" ? await readLobby(transaction) : null;
          if (game.status === "waiting") {
            game.timeControl = control;
            game.hostColor = hostColor;
            game.updatedAtMs = time;
            writeGame(transaction, game);
            hostDoc.games[game.id] = gameSummary(game, actor.uid);
            writePlayer(transaction, hostDoc, time);
            if (inviteeDoc) {
              inviteeDoc.invites[game.id] = inviteEntry(game);
              writePlayer(transaction, inviteeDoc, time);
            }
            if (lobby) {
              lobby.games[game.id] = lobbyEntry(game);
              writeLobby(transaction, lobby, time);
            }
          }
          return { gameId: game.id, reused: true };
        }
        if (Object.keys(hostDoc.games).length >= MAX_ACTIVE_GAMES) {
          throw chessError("TOO_MANY_GAMES", "Finish one of your games first", 409);
        }
        const inviteeDoc = invitee ? await readPlayer(transaction, invitee.uid) : null;
        const lobby = mode === "public" ? pruneLobby(await readLobby(transaction), time) : null;
        if (lobby && Object.keys(lobby.games).length >= LOBBY_LIMIT) {
          throw chessError("LOBBY_FULL", "There are too many open games right now", 409);
        }
        const code = await pickFreeCode(transaction);
        const game = newGame({
          code,
          host: actor,
          hostRating: hostDoc.rating,
          visibility: mode,
          timeControl: control,
          hostColor,
          invitee,
          inviteeRating: inviteeDoc ? inviteeDoc.rating : null,
          time,
        });
        writeGame(transaction, game);
        hostDoc.games[code] = gameSummary(game, actor.uid);
        writePlayer(transaction, hostDoc, time);
        if (inviteeDoc) {
          inviteeDoc.invites[code] = inviteEntry(game);
          writePlayer(transaction, inviteeDoc, time);
        }
        if (lobby) {
          lobby.games[code] = lobbyEntry(game);
          writeLobby(transaction, lobby, time);
        }
        return { gameId: code, reused: false };
      });
    },

    async join(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      const outcome = await db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (game.status !== "waiting") {
          if (isSeated(game, actor.uid)) return { gameId: code };
          throw chessError("GAME_NOT_JOINABLE", "This game has already started or ended", 409);
        }
        if (game.hostUid === actor.uid) throw chessError("OWN_GAME", "This is your own game", 409);
        if (game.invitedUid && game.invitedUid !== actor.uid) {
          throw chessError("NOT_INVITED", "This game is for another player", 403);
        }
        if (Number(game.expiresAtMs) <= time) {
          const context = await readCancelContext(transaction, game);
          applyCancel(transaction, game, context, "expired", time);
          return { expired: true };
        }
        await joinInTransaction(transaction, game, actor, time);
        return { gameId: code };
      });
      if (outcome.expired) throw chessError("GAME_EXPIRED", "This invitation has expired", 410);
      return outcome;
    },

    async decline(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (game.invitedUid !== actor.uid) throw chessError("NOT_INVITED", "This game is for another player", 403);
        if (game.status !== "waiting") return { gameId: code, status: game.status };
        const context = await readCancelContext(transaction, game);
        applyCancel(transaction, game, context, "declined", time);
        return { gameId: code, status: "cancelled" };
      });
    },

    async cancel(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (game.hostUid !== actor.uid) throw chessError("NOT_A_PLAYER", "Only the host can cancel this game", 403);
        if (game.status === "cancelled") return { gameId: code, status: game.status };
        if (game.status !== "waiting") throw chessError("GAME_STARTED", "The game has already started", 409);
        const context = await readCancelContext(transaction, game);
        applyCancel(transaction, game, context, "cancelled", time);
        return { gameId: code, status: "cancelled" };
      });
    },

    async touch(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (game.hostUid !== actor.uid) throw chessError("NOT_A_PLAYER", "Only the host keeps this game open", 403);
        if (game.status !== "waiting" || game.visibility !== "public") return { gameId: code, status: game.status };
        if (Number(game.expiresAtMs) <= time) {
          const context = await readCancelContext(transaction, game);
          applyCancel(transaction, game, context, "expired", time);
          return { gameId: code, status: "cancelled" };
        }
        const hostDoc = await readPlayer(transaction, actor.uid);
        const lobby = await readLobby(transaction);
        game.expiresAtMs = time + PUBLIC_WAIT_MS;
        game.updatedAtMs = time;
        writeGame(transaction, game);
        hostDoc.games[code] = gameSummary(game, actor.uid);
        writePlayer(transaction, hostDoc, time);
        lobby.games[code] = lobbyEntry(game);
        writeLobby(transaction, lobby, time);
        return { gameId: code, status: game.status, expiresAtMs: game.expiresAtMs };
      });
    },

    async move(actor, { gameId, uci, expectedMoveCount = null } = {}) {
      const code = normalizeGameId(gameId);
      const text = String(uci ?? "").trim().toLowerCase();
      if (!UCI_PATTERN.test(text)) throw chessError("INVALID_MOVE", "The move is not in UCI notation");
      const expected = expectedMoveCount === null || expectedMoveCount === undefined ? null : Number(expectedMoveCount);
      if (expected !== null && !Number.isInteger(expected)) throw chessError("INVALID_MOVE", "The move number is invalid");
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        requirePlaying(game, actor.uid);
        if (game.turnUid !== actor.uid) throw chessError("NOT_YOUR_TURN", "It is not your turn", 409);
        if (expected !== null && expected !== game.moveCount) throw chessError("STALE_MOVE", "The game has moved on", 409);
        if (game.moveCount >= MAX_PLIES) throw chessError("GAME_TOO_LONG", "The game is too long", 409);
        const docs = await readSeatedDocs(transaction, game);
        const color = colorOf(game, actor.uid);
        const control = timeControlOf(game);

        // Out of time before this move landed: the move does not count.
        if (time > turnDeadline(game)) {
          if (game.moveCount < 2) {
            const context = await readCancelContext(transaction, game);
            applyCancel(transaction, game, context, "aborted", time);
            return { gameId: code, status: "cancelled", endReason: "aborted" };
          }
          if (control) {
            applyFinish(transaction, game, docs, timeoutResult(game, color), time);
            return { gameId: code, status: "finished", result: game.result, endReason: game.endReason };
          }
        }

        const chess = Rules.ChessGame.fromMoves(game.moves);
        const move = chess.move(text);
        if (!move) throw chessError("ILLEGAL_MOVE", "This move is not legal here", 400);
        if (control && game.moveCount >= 2) {
          const left = remainingMs(game, color, time);
          game.clock[`${color}Ms`] = Math.round(left + control.incrementMs);
        }
        game.clock.turnStartedAtMs = time;
        game.moves.push(move.uci);
        game.sans.push(move.san);
        game.moveCount = game.moves.length;
        game.fen = chess.fen();
        game.lastMove = { from: move.from, to: move.to, uci: move.uci, san: move.san, by: actor.uid, atMs: time };
        // Moving instead of answering declines the opponent's offer.
        if (game.drawOffer && game.drawOffer.by !== actor.uid) game.drawOffer = null;
        const opponentUid = opponentOf(game, actor.uid);
        game.turnUid = opponentUid;
        game.updatedAtMs = time;

        const status = chess.status();
        if (status.over) {
          applyFinish(transaction, game, docs, { result: status.result, reason: status.reason }, time);
        } else {
          writeGame(transaction, game);
          writeSummaries(transaction, game, docs, time);
        }
        return {
          gameId: code,
          uci: move.uci,
          san: move.san,
          moveCount: game.moveCount,
          status: game.status,
          result: game.result || null,
          endReason: game.endReason || null,
        };
      });
    },

    async resign(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        const involved = isSeated(game, actor.uid) || game.invitedUid === actor.uid;
        if (!involved) throw chessError("NOT_A_PLAYER", "You are not playing this game", 403);
        if (game.status === "finished" || game.status === "cancelled") return { gameId: code, status: game.status };
        if (game.status === "waiting") {
          const context = await readCancelContext(transaction, game);
          applyCancel(transaction, game, context, actor.uid === game.hostUid ? "cancelled" : "declined", time);
          return { gameId: code, status: "cancelled" };
        }
        if (game.moveCount < 2) {
          const context = await readCancelContext(transaction, game);
          applyCancel(transaction, game, context, "aborted", time);
          return { gameId: code, status: "cancelled", endReason: "aborted" };
        }
        const docs = await readSeatedDocs(transaction, game);
        const result = colorOf(game, actor.uid) === "white" ? "0-1" : "1-0";
        applyFinish(transaction, game, docs, { result, reason: "resigned" }, time);
        return { gameId: code, status: "finished", result };
      });
    },

    async abort(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (game.status === "cancelled") return { gameId: code, status: game.status };
        requirePlaying(game, actor.uid);
        if (game.moveCount >= 2) throw chessError("GAME_STARTED", "Both sides have moved; resign instead", 409);
        const context = await readCancelContext(transaction, game);
        applyCancel(transaction, game, context, "aborted", time);
        return { gameId: code, status: "cancelled", endReason: "aborted" };
      });
    },

    async offerDraw(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        requirePlaying(game, actor.uid);
        if (game.moveCount < 2) throw chessError("TOO_EARLY", "Make your first moves before offering a draw", 409);
        const docs = await readSeatedDocs(transaction, game);
        const opponentUid = opponentOf(game, actor.uid);
        // Offering back an offer on the table accepts it.
        if (game.drawOffer?.by === opponentUid) {
          applyFinish(transaction, game, docs, { result: "1/2-1/2", reason: "agreement" }, time);
          return { gameId: code, status: "finished", result: "1/2-1/2" };
        }
        if (game.drawOffer?.by === actor.uid) return { gameId: code, status: game.status };
        const last = game.drawOfferMoves[actor.uid];
        if (Number.isInteger(last) && game.moveCount - last < DRAW_OFFER_GAP) {
          throw chessError("DRAW_OFFER_LIMIT", "You offered a draw a moment ago", 429, { availableAtMove: last + DRAW_OFFER_GAP });
        }
        game.drawOffer = { by: actor.uid, moveCount: game.moveCount, atMs: time };
        game.drawOfferMoves[actor.uid] = game.moveCount;
        game.updatedAtMs = time;
        writeGame(transaction, game);
        writeSummaries(transaction, game, docs, time);
        return { gameId: code, status: game.status, drawOffer: game.drawOffer };
      });
    },

    async answerDraw(actor, { gameId, accept = false } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        requirePlaying(game, actor.uid);
        const opponentUid = opponentOf(game, actor.uid);
        if (game.drawOffer?.by !== opponentUid) throw chessError("NO_DRAW_OFFER", "There is no draw offer to answer", 409);
        const docs = await readSeatedDocs(transaction, game);
        if (accept === true) {
          applyFinish(transaction, game, docs, { result: "1/2-1/2", reason: "agreement" }, time);
          return { gameId: code, status: "finished", result: "1/2-1/2" };
        }
        game.drawOffer = null;
        game.updatedAtMs = time;
        writeGame(transaction, game);
        writeSummaries(transaction, game, docs, time);
        return { gameId: code, status: game.status };
      });
    },

    /** Either player reports a flag fall or a move that never came; the server checks the clock. */
    async timeout(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (game.status === "finished" || game.status === "cancelled") {
          return { gameId: code, status: game.status, result: game.result || null };
        }
        requirePlaying(game, actor.uid);
        const deadline = turnDeadline(game);
        if (time < deadline) throw chessError("TOO_EARLY", "The side to move still has time", 409, { availableAtMs: deadline });
        if (game.moveCount < 2) {
          const context = await readCancelContext(transaction, game);
          applyCancel(transaction, game, context, "aborted", time);
          return { gameId: code, status: "cancelled", endReason: "aborted" };
        }
        const docs = await readSeatedDocs(transaction, game);
        const loserColor = colorOf(game, game.turnUid);
        if (timeControlOf(game)) {
          applyFinish(transaction, game, docs, timeoutResult(game, loserColor), time);
        } else {
          // A day without a move: only the waiting player may claim it.
          if (game.turnUid === actor.uid) throw chessError("TOO_EARLY", "It is your move", 409, { availableAtMs: deadline });
          applyFinish(transaction, game, docs, { result: loserColor === "white" ? "0-1" : "1-0", reason: "abandoned" }, time);
        }
        return { gameId: code, status: "finished", result: game.result, endReason: game.endReason };
      });
    },

    async rematch(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const previous = await readGame(transaction, code);
        if (!isSeated(previous, actor.uid)) throw chessError("NOT_A_PLAYER", "You are not playing this game", 403);
        if (previous.status !== "finished") throw chessError("GAME_NOT_FINISHED", "The game is not over yet", 409);
        const opponentUid = opponentOf(previous, actor.uid);

        if (previous.rematchGameId && CODE_PATTERN.test(String(previous.rematchGameId))) {
          const snapshot = await transaction.get(gameRef(previous.rematchGameId));
          const next = snapshot.exists ? cloneGame(snapshot.data()) : null;
          if (next && next.status === "waiting" && Number(next.expiresAtMs) > time) {
            if (next.hostUid === actor.uid) return { gameId: next.id, status: next.status };
            if (next.invitedUid === actor.uid) {
              await joinInTransaction(transaction, next, actor, time);
              return { gameId: next.id, status: next.status, joined: true };
            }
          }
          if (next && ["playing", "finished"].includes(next.status)) {
            return { gameId: next.id, status: next.status };
          }
        }

        const hostDoc = await readPlayer(transaction, actor.uid);
        prunePlayerDoc(hostDoc, time);
        if (Object.keys(hostDoc.games).length >= MAX_ACTIVE_GAMES) {
          throw chessError("TOO_MANY_GAMES", "Finish one of your games first", 409);
        }
        const inviteeDoc = await readPlayer(transaction, opponentUid);
        const nextCode = await pickFreeCode(transaction);
        const invitee = {
          uid: opponentUid,
          name: previous.names?.[opponentUid] || "Игрок",
          photo: previous.photos?.[opponentUid] || null,
        };
        // Colours swap for the rematch.
        const hostColor = colorOf(previous, actor.uid) === "white" ? "black" : "white";
        const game = newGame({
          code: nextCode,
          host: { uid: actor.uid, name: actor.name, photo: actor.photo },
          hostRating: hostDoc.rating,
          visibility: "private",
          timeControl: Object.prototype.hasOwnProperty.call(TIME_CONTROLS, previous.timeControl) ? previous.timeControl : DEFAULT_TIME_CONTROL,
          hostColor,
          invitee,
          inviteeRating: inviteeDoc.rating,
          rematchOf: code,
          time,
        });
        writeGame(transaction, game);
        previous.rematchGameId = nextCode;
        previous.rematchBy = actor.uid;
        previous.updatedAtMs = time;
        writeGame(transaction, previous);
        hostDoc.games[nextCode] = gameSummary(game, actor.uid);
        writePlayer(transaction, hostDoc, time);
        inviteeDoc.invites[nextCode] = inviteEntry(game);
        writePlayer(transaction, inviteeDoc, time);
        return { gameId: nextCode, status: game.status };
      });
    },
  };

  return service;
}

function setChessCors(req, res) {
  const origin = req.get?.("origin");
  if (origin && origin !== EXTENSION_ORIGIN) {
    res.status(403).json({ error: "Origin is not allowed", code: "ORIGIN_NOT_ALLOWED" });
    return false;
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Origin", EXTENSION_ORIGIN);
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return false;
  }
  return true;
}

function requireBearerToken(req) {
  const header = String(req.get?.("authorization") || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw chessError("AUTH_REQUIRED", "Authentication is required", 401);
  return match[1];
}

function createChessHandler({ db, auth, now = () => Date.now(), random = Math.random } = {}) {
  if (!db || !auth || typeof auth.verifyIdToken !== "function") {
    throw new Error("Chess handler dependencies are required");
  }
  const service = createChessService({ db, now, random });

  return async (req, res) => {
    if (!setChessCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST requests are supported", code: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      let decodedToken;
      try {
        decodedToken = await auth.verifyIdToken(requireBearerToken(req));
      } catch (error) {
        if (error?.code === "AUTH_REQUIRED" || String(error?.code || "").startsWith("auth/")) {
          throw chessError("AUTH_REQUIRED", "Authentication is required", 401);
        }
        throw error;
      }
      const uid = decodedToken.uid;
      const profileSnapshot = await db.collection("users").doc(uid).get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      if (!isApprovedProfile(profile) && !isAdminProfile(profile)) {
        throw chessError("APPROVAL_REQUIRED", "An approved account is required", 403);
      }
      const body = isPlainObject(req.body) ? req.body : {};
      const action = String(body.action || "").trim();
      if (!ACTIONS.has(action)) throw chessError("INVALID_ACTION", "The action is invalid");
      const actor = playerFromProfile(uid, profile, decodedToken);
      const result = action === "ping" ? {} : await service[action](actor, body);
      res.status(200).json({ ok: true, ...result, serverTimeMs: now() });
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      if (statusCode >= 500) console.error("[chess] Request failed:", error);
      res.status(statusCode).json({
        error: statusCode >= 500 ? "Chess is temporarily unavailable" : error.message,
        code: error.code && statusCode < 500 ? error.code : "INTERNAL",
        ...(error.details && statusCode < 500 ? { details: error.details } : {}),
        serverTimeMs: now(),
      });
    }
  };
}

module.exports = {
  CODE_ALPHABET,
  CODE_LENGTH,
  DAILY_MOVE_MS,
  DRAW_OFFER_GAP,
  EXTENSION_ORIGIN,
  FIRST_MOVE_MS,
  LOBBY_LIMIT,
  MAX_ACTIVE_GAMES,
  PRIVATE_WAIT_MS,
  PUBLIC_WAIT_MS,
  RECENT_LIMIT,
  START_RATING,
  TIME_CONTROLS,
  createChessHandler,
  createChessService,
  gameSummary,
  hasMatingMaterial,
  normalizePlayerDoc,
  prunePlayerDoc,
  remainingMs,
  turnDeadline,
};
