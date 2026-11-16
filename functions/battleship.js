/**
 * Networked Battleship referee. Every change to a game goes through this module;
 * clients only read Firestore and subscribe to it.
 *
 * Firestore layout, written here with the Admin SDK only:
 *   battleshipGames/{code}              public state, readable by the game's players
 *   battleshipGames/{code}/fleets/{uid} one player's ships, readable by that player
 *   battleshipPlayers/{uid}             a player's unfinished games, incoming
 *                                       challenges, recent results and totals
 *   battleshipLobby/open                public games waiting for an opponent
 *
 * A fleet never reaches the opponent before the game is over and every shot is
 * resolved here, so a modified client can neither see the ships nor lie about a
 * hit. Times are server milliseconds; each response carries `serverTimeMs` so a
 * client can count idle time on the server's clock rather than its own.
 */
const Rules = require("./battleshipRules");

const EXTENSION_ORIGIN = "chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd";
const GAMES = "battleshipGames";
const FLEETS = "fleets";
const PLAYERS = "battleshipPlayers";
const LOBBY_COLLECTION = "battleshipLobby";
const LOBBY_DOCUMENT = "open";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// An open game stays listed while its host's page keeps touching it.
const PUBLIC_WAIT_MS = 10 * 60 * 1000;
// A game shared by code or a direct challenge waits much longer.
const PRIVATE_WAIT_MS = 12 * 60 * 60 * 1000;
// After this long without a move the waiting player may claim the game.
const TURN_IDLE_MS = 5 * 60 * 1000;
// After this long a ready player may close a game the opponent never set up.
const PLACING_IDLE_MS = 5 * 60 * 1000;
const MAX_ACTIVE_GAMES = 8;
const LOBBY_LIMIT = 40;
const RECENT_LIMIT = 12;
const NAME_LIMIT = 120;

const ACTIONS = new Set([
  "ping", "create", "join", "decline", "cancel", "touch", "place", "fire", "resign", "claim", "rematch",
]);
const VISIBILITIES = new Set(["public", "private"]);

function battleshipError(code, message, statusCode = 400, details = null) {
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
  if (!CODE_PATTERN.test(code)) throw battleshipError("INVALID_GAME", "The game code is invalid");
  return code;
}

function normalizeUid(value) {
  const uid = String(value ?? "").trim();
  if (!UID_PATTERN.test(uid)) throw battleshipError("PLAYER_NOT_FOUND", "The player was not found", 404);
  return uid;
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
  return { uid, games: {}, invites: {}, recent: [], stats: { played: 0, wins: 0, losses: 0 }, updatedAtMs: 0 };
}

function normalizePlayerDoc(data, uid) {
  const doc = isPlainObject(data) ? data : {};
  const base = emptyPlayerDoc(uid);
  return {
    ...base,
    games: isPlainObject(doc.games) ? { ...doc.games } : {},
    invites: isPlainObject(doc.invites) ? { ...doc.invites } : {},
    recent: Array.isArray(doc.recent) ? doc.recent.filter(isPlainObject).slice(0, RECENT_LIMIT) : [],
    stats: {
      played: nonNegativeInt(doc.stats?.played),
      wins: nonNegativeInt(doc.stats?.wins),
      losses: nonNegativeInt(doc.stats?.losses),
    },
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

function gameSummary(game, uid) {
  const opponentUid = opponentOf(game, uid);
  return {
    status: game.status,
    role: uid === game.hostUid ? "host" : "guest",
    visibility: game.visibility,
    opponentUid,
    opponentName: opponentUid ? game.names?.[opponentUid] || null : null,
    opponentPhoto: opponentUid ? game.photos?.[opponentUid] || null : null,
    turnUid: game.turnUid || null,
    expiresAtMs: game.status === "waiting" ? game.expiresAtMs || null : null,
    updatedAtMs: game.updatedAtMs,
  };
}

function inviteEntry(game) {
  return {
    fromUid: game.hostUid,
    fromName: game.names?.[game.hostUid] || null,
    fromPhoto: game.photos?.[game.hostUid] || null,
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
    createdAtMs: game.createdAtMs,
    expiresAtMs: game.expiresAtMs,
  };
}

function newGame({ code, host, visibility, invitee = null, rematchOf = null, time }) {
  const names = { [host.uid]: host.name };
  const photos = { [host.uid]: host.photo };
  if (invitee) {
    names[invitee.uid] = invitee.name;
    photos[invitee.uid] = invitee.photo;
  }
  return {
    id: code,
    version: 1,
    status: "waiting",
    visibility,
    hostUid: host.uid,
    guestUid: null,
    invitedUid: invitee ? invitee.uid : null,
    // A challenged player may read the game before answering.
    players: invitee ? [host.uid, invitee.uid] : [host.uid],
    names,
    photos,
    ready: {},
    boards: {},
    sunk: {},
    shots: {},
    hits: {},
    turnUid: null,
    turnStartedAtMs: null,
    moveCount: 0,
    lastShot: null,
    winnerUid: null,
    endReason: null,
    revealed: null,
    rematchOf,
    rematchGameId: null,
    rematchBy: null,
    createdAtMs: time,
    updatedAtMs: time,
    placingStartedAtMs: null,
    startedAtMs: null,
    finishedAtMs: null,
    expiresAtMs: time + (visibility === "public" ? PUBLIC_WAIT_MS : PRIVATE_WAIT_MS),
  };
}

function cloneGame(data) {
  const game = JSON.parse(JSON.stringify(data || {}));
  for (const key of ["names", "photos", "ready", "boards", "sunk", "shots", "hits"]) {
    if (!isPlainObject(game[key])) game[key] = {};
  }
  if (!Array.isArray(game.players)) game.players = [game.hostUid].filter(Boolean);
  game.moveCount = nonNegativeInt(game.moveCount);
  return game;
}

function createBattleshipService({ db, now = () => Date.now(), random = Math.random } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("Battleship Firestore dependency is required");
  }

  const gameRef = (gameId) => db.collection(GAMES).doc(gameId);
  const fleetRef = (gameId, uid) => gameRef(gameId).collection(FLEETS).doc(uid);
  const playerRef = (uid) => db.collection(PLAYERS).doc(uid);
  const lobbyRef = () => db.collection(LOBBY_COLLECTION).doc(LOBBY_DOCUMENT);

  async function readGame(transaction, gameId) {
    const snapshot = await transaction.get(gameRef(gameId));
    if (!snapshot.exists) throw battleshipError("GAME_NOT_FOUND", "The game was not found", 404);
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

  async function readFleet(transaction, gameId, uid) {
    const snapshot = await transaction.get(fleetRef(gameId, uid));
    const ships = snapshot.exists ? snapshot.data()?.ships : null;
    const check = Rules.validateFleet(ships);
    if (!check.ok) throw battleshipError("FLEET_MISSING", "A fleet of this game is missing", 500);
    return check.ships;
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
    throw battleshipError("CODE_UNAVAILABLE", "Could not reserve a game code", 503);
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

  async function readFinishContext(transaction, game, knownFleets = {}) {
    const fleets = { ...knownFleets };
    for (const uid of [game.hostUid, game.guestUid]) {
      if (!fleets[uid]) fleets[uid] = await readFleet(transaction, game.id, uid);
    }
    const docs = {
      [game.hostUid]: await readPlayer(transaction, game.hostUid),
      [game.guestUid]: await readPlayer(transaction, game.guestUid),
    };
    return { fleets, docs };
  }

  function applyFinish(transaction, game, context, winnerUid, reason, time) {
    game.status = "finished";
    game.winnerUid = winnerUid;
    game.endReason = reason;
    game.turnUid = null;
    game.finishedAtMs = time;
    game.updatedAtMs = time;
    game.revealed = {
      [game.hostUid]: context.fleets[game.hostUid],
      [game.guestUid]: context.fleets[game.guestUid],
    };
    writeGame(transaction, game);
    for (const uid of [game.hostUid, game.guestUid]) {
      const doc = context.docs[uid];
      const opponentUid = opponentOf(game, uid);
      const won = uid === winnerUid;
      delete doc.games[game.id];
      doc.recent = [{
        gameId: game.id,
        opponentUid,
        opponentName: game.names?.[opponentUid] || null,
        opponentPhoto: game.photos?.[opponentUid] || null,
        result: won ? "win" : "loss",
        reason,
        shots: nonNegativeInt(game.shots?.[uid]),
        hits: nonNegativeInt(game.hits?.[uid]),
        finishedAtMs: time,
      }, ...doc.recent.filter((entry) => entry.gameId !== game.id)].slice(0, RECENT_LIMIT);
      doc.stats.played += 1;
      if (won) doc.stats.wins += 1;
      else doc.stats.losses += 1;
      writePlayer(transaction, doc, time);
    }
  }

  function seatGuest(game, guest, time) {
    game.guestUid = guest.uid;
    game.players = [game.hostUid, guest.uid];
    game.names[guest.uid] = guest.name;
    game.photos[guest.uid] = guest.photo;
    game.status = "placing";
    game.placingStartedAtMs = time;
    game.expiresAtMs = null;
    game.updatedAtMs = time;
    for (const uid of [game.hostUid, guest.uid]) {
      game.ready[uid] = false;
      game.boards[uid] = Rules.emptyMarks();
      game.sunk[uid] = [];
      game.shots[uid] = 0;
      game.hits[uid] = 0;
    }
  }

  /** Reads, then writes, of a guest taking the free seat. Used by join and by an accepted rematch. */
  async function joinInTransaction(transaction, game, guest, time) {
    const guestDoc = await readPlayer(transaction, guest.uid);
    prunePlayerDoc(guestDoc, time);
    if (!guestDoc.games[game.id] && Object.keys(guestDoc.games).length >= MAX_ACTIVE_GAMES) {
      throw battleshipError("TOO_MANY_GAMES", "Finish one of your games first", 409);
    }
    const hostDoc = await readPlayer(transaction, game.hostUid);
    const lobby = game.visibility === "public" ? await readLobby(transaction) : null;
    seatGuest(game, guest, time);
    writeGame(transaction, game);
    hostDoc.games[game.id] = gameSummary(game, game.hostUid);
    guestDoc.games[game.id] = gameSummary(game, guest.uid);
    delete guestDoc.invites[game.id];
    writePlayer(transaction, hostDoc, time);
    writePlayer(transaction, guestDoc, time);
    if (lobby) {
      delete lobby.games[game.id];
      writeLobby(transaction, lobby, time);
    }
  }

  const service = {
    async create(actor, { visibility = "private", invitedUid = null } = {}) {
      let mode = String(visibility || "private");
      if (!VISIBILITIES.has(mode)) throw battleshipError("INVALID_VISIBILITY", "The game visibility is invalid");
      let invitee = null;
      if (invitedUid !== null && invitedUid !== undefined && invitedUid !== "") {
        const uid = normalizeUid(invitedUid);
        if (uid === actor.uid) throw battleshipError("SELF_INVITE", "You cannot challenge yourself");
        const profile = await readProfile(uid);
        if (!profile || !isApprovedProfile(profile)) throw battleshipError("PLAYER_NOT_FOUND", "The player was not found", 404);
        invitee = playerFromProfile(uid, profile);
        mode = "private";
      }
      const time = now();
      return db.runTransaction(async (transaction) => {
        const hostDoc = await readPlayer(transaction, actor.uid);
        prunePlayerDoc(hostDoc, time);
        // Asking twice gives the same open game, and the same pending challenge.
        const existing = Object.entries(hostDoc.games).find(([, summary]) => (
          summary.status === "waiting" && summary.role === "host" && (invitee
            ? summary.opponentUid === invitee.uid
            : mode === "public" && summary.visibility === "public")
        ));
        if (existing) return { gameId: existing[0], reused: true };
        if (Object.keys(hostDoc.games).length >= MAX_ACTIVE_GAMES) {
          throw battleshipError("TOO_MANY_GAMES", "Finish one of your games first", 409);
        }
        const inviteeDoc = invitee ? await readPlayer(transaction, invitee.uid) : null;
        const lobby = mode === "public" ? pruneLobby(await readLobby(transaction), time) : null;
        if (lobby && Object.keys(lobby.games).length >= LOBBY_LIMIT) {
          throw battleshipError("LOBBY_FULL", "There are too many open games right now", 409);
        }
        const code = await pickFreeCode(transaction);
        const game = newGame({ code, host: actor, visibility: mode, invitee, time });
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
          throw battleshipError("GAME_NOT_JOINABLE", "This game has already started or ended", 409);
        }
        if (game.hostUid === actor.uid) throw battleshipError("OWN_GAME", "This is your own game", 409);
        if (game.invitedUid && game.invitedUid !== actor.uid) {
          throw battleshipError("NOT_INVITED", "This game is for another player", 403);
        }
        if (Number(game.expiresAtMs) <= time) {
          const context = await readCancelContext(transaction, game);
          applyCancel(transaction, game, context, "expired", time);
          return { expired: true };
        }
        await joinInTransaction(transaction, game, actor, time);
        return { gameId: code };
      });
      if (outcome.expired) throw battleshipError("GAME_EXPIRED", "This invitation has expired", 410);
      return outcome;
    },

    async decline(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (game.invitedUid !== actor.uid) throw battleshipError("NOT_INVITED", "This game is for another player", 403);
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
        if (game.hostUid !== actor.uid) throw battleshipError("NOT_A_PLAYER", "Only the host can cancel this game", 403);
        if (game.status === "cancelled") return { gameId: code, status: game.status };
        if (game.status !== "waiting") throw battleshipError("GAME_STARTED", "The game has already started", 409);
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
        if (game.hostUid !== actor.uid) throw battleshipError("NOT_A_PLAYER", "Only the host keeps this game open", 403);
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

    async place(actor, { gameId, ships } = {}) {
      const code = normalizeGameId(gameId);
      const check = Rules.validateFleet(ships);
      if (!check.ok) throw battleshipError("INVALID_FLEET", "The fleet breaks the rules", 400, { rule: check.code });
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (!isSeated(game, actor.uid)) throw battleshipError("NOT_A_PLAYER", "You are not playing this game", 403);
        if (game.status !== "placing") {
          if (game.status === "playing" && game.ready[actor.uid]) return { gameId: code, status: game.status };
          throw battleshipError("GAME_STARTED", "Ships can no longer be placed", 409);
        }
        if (game.ready[actor.uid] === true) return { gameId: code, status: game.status };
        const opponentUid = opponentOf(game, actor.uid);
        const starting = game.ready[opponentUid] === true;
        const docs = starting ? {
          [game.hostUid]: await readPlayer(transaction, game.hostUid),
          [game.guestUid]: await readPlayer(transaction, game.guestUid),
        } : null;
        transaction.set(fleetRef(code, actor.uid), { uid: actor.uid, gameId: code, ships: check.ships, placedAtMs: time });
        game.ready[actor.uid] = true;
        game.updatedAtMs = time;
        if (starting) {
          game.status = "playing";
          game.turnUid = Number(random()) < 0.5 ? game.hostUid : game.guestUid;
          game.turnStartedAtMs = time;
          game.startedAtMs = time;
        }
        writeGame(transaction, game);
        if (docs) {
          for (const doc of Object.values(docs)) {
            doc.games[code] = gameSummary(game, doc.uid);
            writePlayer(transaction, doc, time);
          }
        }
        return { gameId: code, status: game.status, turnUid: game.turnUid || null };
      });
    },

    async fire(actor, { gameId, index, expectedMove = null } = {}) {
      const code = normalizeGameId(gameId);
      const cell = Number(index);
      if (!Rules.isIndex(cell)) throw battleshipError("INVALID_CELL", "The cell is outside the board");
      const expected = expectedMove === null || expectedMove === undefined ? null : Number(expectedMove);
      if (expected !== null && !Number.isInteger(expected)) throw battleshipError("INVALID_CELL", "The move number is invalid");
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (!isSeated(game, actor.uid)) throw battleshipError("NOT_A_PLAYER", "You are not playing this game", 403);
        if (game.status !== "playing") throw battleshipError("GAME_NOT_ACTIVE", "The game is not in progress", 409);
        if (game.turnUid !== actor.uid) throw battleshipError("NOT_YOUR_TURN", "It is not your turn", 409);
        if (expected !== null && expected !== game.moveCount) {
          throw battleshipError("STALE_MOVE", "The game has moved on", 409);
        }
        const opponentUid = opponentOf(game, actor.uid);
        const marks = game.boards[opponentUid];
        if (!Rules.isShootable(marks, cell)) throw battleshipError("CELL_TAKEN", "This cell was already shot", 409);
        const opponentFleet = await readFleet(transaction, code, opponentUid);
        const shot = Rules.resolveShot(opponentFleet, marks, cell);
        const turnPasses = shot.result === "miss";
        let finishContext = null;
        let docs = null;
        if (shot.allSunk) {
          finishContext = await readFinishContext(transaction, game, { [opponentUid]: opponentFleet });
        } else if (turnPasses) {
          docs = {
            [game.hostUid]: await readPlayer(transaction, game.hostUid),
            [game.guestUid]: await readPlayer(transaction, game.guestUid),
          };
        }

        game.boards[opponentUid] = shot.marks;
        game.moveCount += 1;
        game.shots[actor.uid] = nonNegativeInt(game.shots[actor.uid]) + 1;
        if (shot.result !== "miss") game.hits[actor.uid] = nonNegativeInt(game.hits[actor.uid]) + 1;
        if (shot.ship) game.sunk[opponentUid] = [...(Array.isArray(game.sunk[opponentUid]) ? game.sunk[opponentUid] : []), shot.ship];
        game.lastShot = { by: actor.uid, index: cell, result: shot.result, move: game.moveCount, atMs: time };
        game.turnStartedAtMs = time;
        if (turnPasses) game.turnUid = opponentUid;
        game.updatedAtMs = time;

        if (finishContext) {
          applyFinish(transaction, game, finishContext, actor.uid, "all_sunk", time);
        } else {
          writeGame(transaction, game);
          if (docs) {
            for (const doc of Object.values(docs)) {
              doc.games[code] = gameSummary(game, doc.uid);
              writePlayer(transaction, doc, time);
            }
          }
        }
        return {
          gameId: code,
          index: cell,
          result: shot.result,
          ship: shot.ship,
          marks: shot.marks,
          moveCount: game.moveCount,
          turnUid: game.turnUid,
          status: game.status,
          winnerUid: game.winnerUid || null,
        };
      });
    },

    async resign(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        const involved = isSeated(game, actor.uid) || game.invitedUid === actor.uid;
        if (!involved) throw battleshipError("NOT_A_PLAYER", "You are not playing this game", 403);
        if (game.status === "finished" || game.status === "cancelled") return { gameId: code, status: game.status };
        if (game.status === "waiting") {
          const context = await readCancelContext(transaction, game);
          applyCancel(transaction, game, context, actor.uid === game.hostUid ? "cancelled" : "declined", time);
          return { gameId: code, status: "cancelled" };
        }
        if (game.status === "placing") {
          const context = await readCancelContext(transaction, game);
          applyCancel(transaction, game, context, "left", time);
          return { gameId: code, status: "cancelled" };
        }
        const context = await readFinishContext(transaction, game);
        applyFinish(transaction, game, context, opponentOf(game, actor.uid), "resigned", time);
        return { gameId: code, status: "finished", winnerUid: game.winnerUid };
      });
    },

    async claim(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (!isSeated(game, actor.uid)) throw battleshipError("NOT_A_PLAYER", "You are not playing this game", 403);
        const opponentUid = opponentOf(game, actor.uid);
        if (game.status === "playing") {
          const availableAtMs = Number(game.turnStartedAtMs) + TURN_IDLE_MS;
          if (game.turnUid !== opponentUid || !(time >= availableAtMs)) {
            throw battleshipError("TOO_EARLY", "The opponent still has time", 409, { availableAtMs });
          }
          const context = await readFinishContext(transaction, game);
          applyFinish(transaction, game, context, actor.uid, "timeout", time);
          return { gameId: code, status: "finished", winnerUid: actor.uid };
        }
        if (game.status === "placing") {
          const availableAtMs = Number(game.placingStartedAtMs) + PLACING_IDLE_MS;
          if (game.ready[actor.uid] !== true || game.ready[opponentUid] === true || !(time >= availableAtMs)) {
            throw battleshipError("TOO_EARLY", "The opponent still has time", 409, { availableAtMs });
          }
          const context = await readCancelContext(transaction, game);
          applyCancel(transaction, game, context, "timeout", time);
          return { gameId: code, status: "cancelled" };
        }
        throw battleshipError("GAME_NOT_ACTIVE", "The game is not in progress", 409);
      });
    },

    async rematch(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const previous = await readGame(transaction, code);
        if (!isSeated(previous, actor.uid)) throw battleshipError("NOT_A_PLAYER", "You are not playing this game", 403);
        if (previous.status !== "finished") throw battleshipError("GAME_NOT_FINISHED", "The game is not over yet", 409);
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
          if (next && ["placing", "playing", "finished"].includes(next.status)) {
            return { gameId: next.id, status: next.status };
          }
        }

        const hostDoc = await readPlayer(transaction, actor.uid);
        prunePlayerDoc(hostDoc, time);
        if (Object.keys(hostDoc.games).length >= MAX_ACTIVE_GAMES) {
          throw battleshipError("TOO_MANY_GAMES", "Finish one of your games first", 409);
        }
        const inviteeDoc = await readPlayer(transaction, opponentUid);
        const nextCode = await pickFreeCode(transaction);
        const invitee = {
          uid: opponentUid,
          name: previous.names?.[opponentUid] || "Игрок",
          photo: previous.photos?.[opponentUid] || null,
        };
        const host = { uid: actor.uid, name: actor.name, photo: actor.photo };
        const game = newGame({ code: nextCode, host, visibility: "private", invitee, rematchOf: code, time });
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

function setBattleshipCors(req, res) {
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
  if (!match) throw battleshipError("AUTH_REQUIRED", "Authentication is required", 401);
  return match[1];
}

function createBattleshipHandler({ db, auth, now = () => Date.now(), random = Math.random } = {}) {
  if (!db || !auth || typeof auth.verifyIdToken !== "function") {
    throw new Error("Battleship handler dependencies are required");
  }
  const service = createBattleshipService({ db, now, random });

  return async (req, res) => {
    if (!setBattleshipCors(req, res)) return;
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
          throw battleshipError("AUTH_REQUIRED", "Authentication is required", 401);
        }
        throw error;
      }
      const uid = decodedToken.uid;
      const profileSnapshot = await db.collection("users").doc(uid).get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      if (!isApprovedProfile(profile) && !isAdminProfile(profile)) {
        throw battleshipError("APPROVAL_REQUIRED", "An approved account is required", 403);
      }
      const body = isPlainObject(req.body) ? req.body : {};
      const action = String(body.action || "").trim();
      if (!ACTIONS.has(action)) throw battleshipError("INVALID_ACTION", "The action is invalid");
      const actor = playerFromProfile(uid, profile, decodedToken);
      const result = action === "ping" ? {} : await service[action](actor, body);
      res.status(200).json({ ok: true, ...result, serverTimeMs: now() });
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      if (statusCode >= 500) console.error("[battleship] Request failed:", error);
      res.status(statusCode).json({
        error: statusCode >= 500 ? "Battleship is temporarily unavailable" : error.message,
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
  EXTENSION_ORIGIN,
  LOBBY_LIMIT,
  MAX_ACTIVE_GAMES,
  PLACING_IDLE_MS,
  PRIVATE_WAIT_MS,
  PUBLIC_WAIT_MS,
  RECENT_LIMIT,
  TURN_IDLE_MS,
  createBattleshipHandler,
  createBattleshipService,
  displayNameFromProfile,
  gameSummary,
  isApprovedProfile,
  normalizePlayerDoc,
  playerFromProfile,
  prunePlayerDoc,
  randomCode,
  safePhotoUrl,
};
