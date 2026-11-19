"use strict";

/**
 * Salvo (Залп) between extension users. Firestore is the read/subscription surface; this endpoint owns
 * every change. A room waits for players, then the host starts it: an even number of players from four
 * up plays as two equal teams, two play one on one, an odd number plays everyone for themselves, one
 * fighter per player. The active player's page streams its controls tick by tick (`stream`) and closes
 * the turn with the resulting state (`endTurn`); every other page replays the stream with the same engine
 * and applies that state. The server does not run the physics: it keeps the order of turns and ticks,
 * checks shapes and limits, picks the next player and ends the game. A turn nobody finishes in time can
 * be skipped by another player (`timeout`); two skipped turns in a row count as leaving.
 * Every response carries `serverTimeMs`.
 */

const Rules = require("./zalpRules");

const EXTENSION_ORIGIN = "chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd";
const GAMES = "zalpGames";
const TURNS = "zalpTurns";
const LOBBY_COLLECTION = "zalpLobby";
const LOBBY_DOCUMENT = "open";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const NAME_LIMIT = 40;
const LISTING_TTL_MS = 10 * 60 * 1000;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const TURN_MS = 90 * 1000;
const MAX_SKIPS = 2;
const LOBBY_LIMIT = 30;
const MAX_CRATERS_PER_TURN = 80;
const MAX_CRATERS = 2400;
const SNAPSHOT_LIMIT = 60000;
const THEMES = ["meadow", "desert", "snow", "volcano"];
const ACTIONS = new Set(["ping", "create", "join", "leave", "touch", "start", "stream", "endTurn", "timeout"]);

function zalpError(code, message, statusCode = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  if (profile?.displayNameFormat === "username" && profile.username) return clip(profile.username) || "Игрок";
  const fullName = [profile?.firstName, profile?.lastName].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  return clip(fullName || profile?.displayName || decodedToken?.name || profile?.username || "Игрок") || "Игрок";
}

function normalizeGameId(value) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) throw zalpError("INVALID_GAME", "The game code is invalid");
  return code;
}

function normalizeTheme(value) {
  const theme = value === undefined || value === null || value === "" ? "random" : String(value);
  if (theme !== "random" && !THEMES.includes(theme)) throw zalpError("INVALID_THEME", "The terrain is invalid");
  return theme;
}

function randomCode(random) {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    const pick = Math.floor(Number(random()) * CODE_ALPHABET.length);
    code += CODE_ALPHABET[Math.min(CODE_ALPHABET.length - 1, Math.max(0, pick || 0))];
  }
  return code;
}

function turnId(code, n) {
  return `${code}-${n}`;
}

function seatOf(game, uid) {
  return game.seats.findIndex((seat) => seat.uid === uid);
}

function aliveFrom(game) {
  return game.seats.map((_, i) => !(game.snapshot && game.snapshot.units && game.snapshot.units[i] && game.snapshot.units[i].dead));
}

function finite(value, lo, hi) {
  return typeof value === "number" && Number.isFinite(value) && value >= lo && value <= hi;
}

/** Why the snapshot of turn `n` cannot be accepted, or null; the shape rules are shared with the page. */
function snapshotProblem(game, n, snapshot, added) {
  if (!isPlainObject(snapshot) || JSON.stringify(snapshot).length > SNAPSHOT_LIMIT) return "shape";
  return Rules.checkSnapshot(snapshot, {
    n,
    seats: game.seats.length,
    teams: new Set(game.seats.map((seat) => seat.team)).size,
    prev: game.snapshot,
    craters: (game.craters.length + added.length) / 3,
  });
}

function validCraters(craters) {
  if (!Array.isArray(craters) || craters.length % 3 !== 0 || craters.length > MAX_CRATERS_PER_TURN * 3) return false;
  for (let i = 0; i < craters.length; i += 3) {
    if (!finite(craters[i], -1000, 4000) || !finite(craters[i + 1], -1000, 3000) || !finite(craters[i + 2], 1, 200)) return false;
  }
  return true;
}

function lobbyEntry(game) {
  return {
    code: game.code,
    hostName: game.seats[0]?.name || "",
    count: game.seats.length,
    theme: game.theme,
    touchedAtMs: game.touchedAtMs,
  };
}

function createZalpService({ db, now = () => Date.now(), random = Math.random } = {}) {
  const gameRef = (code) => db.collection(GAMES).doc(code);
  const turnRef = (code, n) => db.collection(TURNS).doc(turnId(code, n));
  const lobbyRef = () => db.collection(LOBBY_COLLECTION).doc(LOBBY_DOCUMENT);

  async function readGame(transaction, code) {
    const snapshot = await transaction.get(gameRef(code));
    if (!snapshot.exists) throw zalpError("GAME_NOT_FOUND", "The game was not found", 404);
    return snapshot.data();
  }

  async function readLobby(transaction) {
    const snapshot = await transaction.get(lobbyRef());
    const games = snapshot.exists && Array.isArray(snapshot.data().games) ? snapshot.data().games : [];
    return games.filter((entry) => isPlainObject(entry) && CODE_PATTERN.test(entry.code));
  }

  function writeLobby(transaction, games, time) {
    const fresh = games.filter((entry) => time - (entry.touchedAtMs || 0) < LISTING_TTL_MS).slice(0, LOBBY_LIMIT);
    transaction.set(lobbyRef(), { games: fresh, updatedAtMs: time });
  }

  function newTurnDoc(game, n, seat, time) {
    return { code: game.code, n, seat, uid: game.seats[seat].uid, players: game.players.slice(), stream: "", ticks: 0, final: false, skipped: false, hash: null, updatedAtMs: time };
  }

  /** Moves the game to the next turn, or finishes it when one team (or none) is left. */
  function advance(transaction, game, time) {
    const alive = aliveFrom(game);
    const teams = Rules.livingTeams(game.seats, alive);
    if (teams.length <= 1) {
      game.status = "finished";
      game.winnerTeam = teams.length === 1 ? teams[0] : null;
      game.finishedAtMs = time;
      return;
    }
    const next = Rules.nextSeat(game.seats, alive, game.turn ? game.turn.seat : -1, game.lastByTeam || []);
    const n = game.turn ? game.turn.n + 1 : 1;
    // the seats that have left are frozen into the turn, so every page removes the same fighters when it starts it
    const left = game.seats.map((seat, i) => (seat.left ? i : -1)).filter((i) => i >= 0);
    game.turn = { n, seat: next.seat, startedAtMs: time, deadlineMs: time + TURN_MS, left };
    game.lastByTeam = next.lastByTeam;
    transaction.set(turnRef(game.code, n), newTurnDoc(game, n, next.seat, time));
  }

  /** Checks that `actor` holds the turn `n` of a running game; returns the game and its turn document. */
  async function readActiveTurn(transaction, actor, gameId, n) {
    const code = normalizeGameId(gameId);
    const game = await readGame(transaction, code);
    if (game.status !== "playing" || !game.turn) throw zalpError("GAME_NOT_PLAYING", "The game is not running", 409);
    if (game.turn.n !== n) throw zalpError("STALE_TURN", "This turn is over", 409, { turn: game.turn.n });
    if (game.seats[game.turn.seat]?.uid !== actor.uid) throw zalpError("NOT_YOUR_TURN", "It is not your turn", 409);
    const turnSnapshot = await transaction.get(turnRef(code, n));
    if (!turnSnapshot.exists) throw zalpError("TURN_NOT_FOUND", "The turn was not found", 404);
    return { code, game, turn: turnSnapshot.data() };
  }

  /**
   * Appends a chunk that starts exactly where the stream ends. The resend of the chunk stored last (its
   * answer was lost) is recognised and ignored; any other position is a conflict that names the stored ticks.
   */
  function appendChunk(turn, from, data) {
    const ticks = Rules.chunkTicks(data);
    if (ticks < 0) throw zalpError("INVALID_STREAM", "The turn data is malformed");
    if (!Number.isInteger(from) || from < 0) throw zalpError("INVALID_STREAM", "The chunk position is invalid");
    if (from !== turn.ticks) {
      if (from + ticks === turn.ticks && (data === "" || turn.stream === data || turn.stream.endsWith(`.${data}`))) return false;
      throw zalpError("STREAM_POSITION", "The chunk does not continue the stored turn", 409, { ticks: turn.ticks });
    }
    if (turn.ticks + ticks > Rules.TURN_TICKS_MAX || turn.stream.length + data.length > Rules.MAX_STREAM_CHARS) {
      throw zalpError("TURN_TOO_LONG", "The turn is too long");
    }
    if (data) turn.stream = turn.stream ? `${turn.stream}.${data}` : data;
    turn.ticks += ticks;
    return true;
  }

  return {
    async create(actor, { visibility = "private", theme } = {}) {
      const vis = visibility === "public" ? "public" : "private";
      const chosen = normalizeTheme(theme);
      const time = now();
      return db.runTransaction(async (transaction) => {
        let code = null;
        for (let attempt = 0; attempt < 8 && !code; attempt += 1) {
          const candidate = randomCode(random);
          const existing = await transaction.get(gameRef(candidate));
          if (!existing.exists) code = candidate;
        }
        if (!code) throw zalpError("NO_FREE_CODE", "Try again", 503);
        const lobby = vis === "public" ? await readLobby(transaction) : null;
        const game = {
          code, status: "waiting", visibility: vis, host: actor.uid, players: [actor.uid],
          seats: [{ uid: actor.uid, name: actor.name, team: -1, left: false, skips: 0 }],
          theme: chosen, seed: null, turn: null, lastByTeam: [], snapshot: null, craters: [],
          winnerTeam: null, finishedAtMs: null, createdAtMs: time, updatedAtMs: time, touchedAtMs: time,
        };
        transaction.set(gameRef(code), game);
        if (lobby) writeLobby(transaction, [lobbyEntry(game), ...lobby.filter((entry) => entry.code !== code)], time);
        return { gameId: code };
      });
    },

    async join(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (seatOf(game, actor.uid) >= 0) return { gameId: code };
        if (game.status !== "waiting" || time - game.touchedAtMs > ROOM_TTL_MS) throw zalpError("GAME_CLOSED", "The game is no longer open", 409);
        if (game.seats.length >= Rules.MAX_PLAYERS) throw zalpError("GAME_FULL", "The game is full", 409);
        const lobby = game.visibility === "public" ? await readLobby(transaction) : null;
        game.seats.push({ uid: actor.uid, name: actor.name, team: -1, left: false, skips: 0 });
        game.players.push(actor.uid);
        game.updatedAtMs = time;
        transaction.set(gameRef(code), game);
        if (lobby) writeLobby(transaction, lobby.map((entry) => (entry.code === code ? lobbyEntry(game) : entry)), time);
        return { gameId: code };
      });
    },

    async touch(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (game.status !== "waiting" || game.host !== actor.uid) return { status: game.status };
        // every read before the first write, as Firestore transactions require
        const lobby = game.visibility === "public" ? await readLobby(transaction) : null;
        game.touchedAtMs = time;
        transaction.set(gameRef(code), game);
        if (lobby) writeLobby(transaction, [lobbyEntry(game), ...lobby.filter((entry) => entry.code !== code)], time);
        return { status: game.status };
      });
    },

    async leave(actor, { gameId } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        const seat = seatOf(game, actor.uid);
        if (seat < 0 || game.status === "finished" || game.status === "closed") return { status: game.status };
        const lobby = game.visibility === "public" ? await readLobby(transaction) : null;
        if (game.status === "waiting") {
          game.seats.splice(seat, 1);
          game.players = game.seats.map((s) => s.uid);
          if (!game.seats.length) game.status = "closed";
          else if (game.host === actor.uid) game.host = game.seats[0].uid;
          game.updatedAtMs = time;
          transaction.set(gameRef(code), game);
          if (lobby) {
            const rest = lobby.filter((entry) => entry.code !== code);
            writeLobby(transaction, game.status === "closed" ? rest : [lobbyEntry(game), ...rest], time);
          }
          return { status: game.status };
        }
        if (game.seats[seat].left) return { status: game.status };
        game.seats[seat].left = true;
        if (game.turn && game.turn.seat === seat) {
          const turnSnapshot = await transaction.get(turnRef(code, game.turn.n));
          if (turnSnapshot.exists) transaction.set(turnRef(code, game.turn.n), { ...turnSnapshot.data(), final: true, skipped: true, updatedAtMs: time });
          advance(transaction, game, time);
        } else if (Rules.livingTeams(game.seats, aliveFrom(game)).length <= 1) {
          advance(transaction, game, time);
        }
        game.updatedAtMs = time;
        transaction.set(gameRef(code), game);
        return { status: game.status };
      });
    },

    async start(actor, { gameId, theme } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (game.host !== actor.uid) throw zalpError("NOT_HOST", "Only the host can start", 403);
        if (game.status !== "waiting") throw zalpError("GAME_CLOSED", "The game is no longer open", 409);
        if (game.seats.length < Rules.MIN_PLAYERS) throw zalpError("NOT_ENOUGH_PLAYERS", "At least two players are needed", 409);
        const lobby = game.visibility === "public" ? await readLobby(transaction) : null;
        const chosen = theme === undefined ? game.theme : normalizeTheme(theme);
        const teams = Rules.splitTeams(game.seats.length, random);
        game.seats.forEach((seat, i) => { seat.team = teams[i]; });
        game.theme = chosen === "random" ? THEMES[Math.floor(random() * THEMES.length) % THEMES.length] : chosen;
        game.seed = Math.floor(random() * 4294967296) >>> 0;
        game.status = "playing";
        game.startedAtMs = time;
        game.updatedAtMs = time;
        game.lastByTeam = [];
        game.turn = { n: 0, seat: Math.floor(random() * game.seats.length) % game.seats.length };
        advance(transaction, game, time);
        transaction.set(gameRef(code), game);
        if (lobby) writeLobby(transaction, lobby.filter((entry) => entry.code !== code), time);
        return { gameId: code };
      });
    },

    async stream(actor, { gameId, turn, from, data } = {}) {
      const time = now();
      return db.runTransaction(async (transaction) => {
        const ctx = await readActiveTurn(transaction, actor, gameId, turn);
        if (ctx.turn.final) throw zalpError("STALE_TURN", "This turn is over", 409);
        if (appendChunk(ctx.turn, from, String(data ?? ""))) {
          ctx.turn.updatedAtMs = time;
          transaction.set(turnRef(ctx.code, turn), ctx.turn);
        }
        return { ticks: ctx.turn.ticks };
      });
    },

    async endTurn(actor, { gameId, turn, from, data, snapshot, craters, hash } = {}) {
      const time = now();
      return db.runTransaction(async (transaction) => {
        const ctx = await readActiveTurn(transaction, actor, gameId, turn);
        const { game } = ctx;
        if (ctx.turn.final) throw zalpError("STALE_TURN", "This turn is over", 409);
        const added = Array.isArray(craters) ? craters : [];
        if (!validCraters(added) || game.craters.length + added.length > MAX_CRATERS * 3) throw zalpError("INVALID_CRATERS", "The craters are malformed");
        const problem = snapshotProblem(game, turn, snapshot, added);
        if (problem) throw zalpError("INVALID_SNAPSHOT", "The turn result is malformed", 400, { reason: problem });
        appendChunk(ctx.turn, from, String(data ?? ""));
        ctx.turn.final = true;
        ctx.turn.hash = typeof hash === "string" ? hash.slice(0, 16) : null;
        ctx.turn.updatedAtMs = time;
        transaction.set(turnRef(ctx.code, turn), ctx.turn);
        game.snapshot = snapshot;
        game.craters = game.craters.concat(added);
        game.seats[game.turn.seat].skips = 0;
        game.updatedAtMs = time;
        advance(transaction, game, time);
        transaction.set(gameRef(ctx.code), game);
        return { status: game.status, turn: game.turn ? game.turn.n : null };
      });
    },

    async timeout(actor, { gameId, turn } = {}) {
      const code = normalizeGameId(gameId);
      const time = now();
      return db.runTransaction(async (transaction) => {
        const game = await readGame(transaction, code);
        if (seatOf(game, actor.uid) < 0) throw zalpError("NOT_A_PLAYER", "You are not in this game", 403);
        if (game.status !== "playing" || !game.turn || game.turn.n !== turn) return { status: game.status, turn: game.turn ? game.turn.n : null };
        if (time < game.turn.deadlineMs) throw zalpError("TOO_EARLY", "The turn is still running", 409, { deadlineMs: game.turn.deadlineMs });
        const seat = game.seats[game.turn.seat];
        seat.skips = (seat.skips || 0) + 1;
        if (seat.skips >= MAX_SKIPS) seat.left = true;
        const turnSnapshot = await transaction.get(turnRef(code, turn));
        if (turnSnapshot.exists) transaction.set(turnRef(code, turn), { ...turnSnapshot.data(), final: true, skipped: true, updatedAtMs: time });
        game.updatedAtMs = time;
        advance(transaction, game, time);
        transaction.set(gameRef(code), game);
        return { status: game.status, turn: game.turn ? game.turn.n : null };
      });
    },
  };
}

function setZalpCors(req, res) {
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
  if (!match) throw zalpError("AUTH_REQUIRED", "Authentication is required", 401);
  return match[1];
}

function createZalpHandler({ db, auth, now = () => Date.now(), random = Math.random } = {}) {
  if (!db || !auth || typeof auth.verifyIdToken !== "function") throw new Error("Salvo handler dependencies are required");
  const service = createZalpService({ db, now, random });

  return async (req, res) => {
    if (!setZalpCors(req, res)) return;
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
          throw zalpError("AUTH_REQUIRED", "Authentication is required", 401);
        }
        throw error;
      }
      const uid = decodedToken.uid;
      const profileSnapshot = await db.collection("users").doc(uid).get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      if (!isApprovedProfile(profile) && !isAdminProfile(profile)) {
        throw zalpError("APPROVAL_REQUIRED", "An approved account is required", 403);
      }
      const body = isPlainObject(req.body) ? req.body : {};
      const action = String(body.action || "").trim();
      if (!ACTIONS.has(action)) throw zalpError("INVALID_ACTION", "The action is invalid");
      const actor = { uid, name: displayNameFromProfile(profile, decodedToken) };
      const result = action === "ping" ? {} : await service[action](actor, body);
      res.status(200).json({ ok: true, ...result, serverTimeMs: now() });
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      if (statusCode >= 500) console.error("[zalp] Request failed:", error);
      res.status(statusCode).json({
        error: statusCode >= 500 ? "Salvo is temporarily unavailable" : error.message,
        code: error.code && statusCode < 500 ? error.code : "INTERNAL",
        ...(error.details && statusCode < 500 ? { details: error.details } : {}),
        serverTimeMs: now(),
      });
    }
  };
}

module.exports = {
  EXTENSION_ORIGIN,
  GAMES,
  LISTING_TTL_MS,
  MAX_SKIPS,
  TURNS,
  TURN_MS,
  createZalpHandler,
  createZalpService,
  turnId,
};
