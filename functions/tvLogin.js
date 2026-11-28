/**
 * Device sign-in for the Android TV app («Сеанс» for TV), in the shape of the OAuth
 * device authorization grant (RFC 8628):
 *
 * - `tvLoginStart` (the TV, no account) creates a login: a 256-bit device code that only
 *   the TV learns (stored as its SHA-256) and a 6-character user code shown on screen and
 *   in the QR. It expires after ten minutes.
 * - `tvLoginApprove` (an approved user of the extension or of the Hosting page `/tv`)
 *   first looks the code up (`confirm: false`, which shows the device and the request
 *   time), then binds the user's UID to it (`confirm: true`).
 * - `tvLoginPoll` (the TV, by device code) answers `pending`, `slow_down`, `expired` or,
 *   once, `approved` with a custom token carrying the claim `device: 'tv'`; the login is
 *   deleted in the same transaction that hands the token out.
 *
 * Everything lives in `tvLogins`, which clients can neither read nor write. Login
 * documents are keyed by the user code; rate-limit counters share the collection under a
 * `limit_` prefix: starts per client address (10 / 10 min) and for all TVs (30 / min), wrong
 * codes per approving user (5 / 10 min). Every document has `expiresAt`, so a Firestore TTL policy on that field
 * can remove leftovers. Codes and tokens are never logged.
 */
const crypto = require("node:crypto");

const COLLECTION = "tvLogins";
const EXTENSION_ORIGIN = "chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd";
const APPROVE_ORIGINS = new Set([
  EXTENSION_ORIGIN,
  "https://movielistdb-13208.web.app",
  "https://movielistdb-13208.firebaseapp.com",
]);
const VERIFICATION_URL = "https://movielistdb-13208.web.app/tv";
// No 0/O, 1/I/L: the code is read off a TV screen and typed by hand.
const USER_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const USER_CODE_LENGTH = 6;
const LOGIN_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_SEC = 5;
const SLOW_DOWN_STEP_SEC = 5;
const MAX_POLL_INTERVAL_SEC = 30;
// A poll this much earlier than the interval still counts as on time (network jitter).
const POLL_TOLERANCE_MS = 1000;
const LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_STARTS_PER_WINDOW = 10;
// All TVs together: each start costs Firestore writes, and the daily quota is shared with the
// extension, so a flood from many addresses stops here.
const GLOBAL_START_WINDOW_MS = 60 * 1000;
const MAX_GLOBAL_STARTS_PER_MINUTE = 30;
const MAX_WRONG_CODES_PER_WINDOW = 5;
const MAX_DEVICE_NAME_LENGTH = 40;
const DEFAULT_DEVICE_NAME = "Телевизор";
const CUSTOM_TOKEN_CLAIMS = Object.freeze({ device: "tv" });

function createTvLoginError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function toMillis(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return new Date(value).getTime() || 0;
}

/** Upper case, separators («K7Q·4MD», «k7q-4md», spaces) removed; null when not a valid code. */
function normalizeUserCode(value) {
  const code = String(value ?? "").toUpperCase().replace(/[\s·.\-_]/g, "");
  if (code.length !== USER_CODE_LENGTH) return null;
  for (const char of code) {
    if (!USER_CODE_ALPHABET.includes(char)) return null;
  }
  return code;
}

function generateUserCode(randomInt = crypto.randomInt) {
  let code = "";
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return code;
}

function generateDeviceCode(randomBytes = crypto.randomBytes) {
  return randomBytes(32).toString("base64url");
}

/** Plain text, control characters removed, at most 40 characters; the TV sends e.g. «Телевизор TCL». */
function normalizeDeviceName(value) {
  const name = String(value ?? "")
    .replace(/[\p{Cc}<>]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DEVICE_NAME_LENGTH)
    .trim();
  return name || DEFAULT_DEVICE_NAME;
}

function isApprovedProfile(profile) {
  if (!profile) return false;
  return profile.approvalStatus === "approved" ||
    !Object.prototype.hasOwnProperty.call(profile, "approvalStatus");
}

/**
 * The address Google's front end saw. It appends the connecting client to X-Forwarded-For, so the
 * last entry is the real one; anything before it is whatever the client chose to send.
 */
function clientIp(req) {
  const chain = String(req.get?.("x-forwarded-for") || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return chain.at(-1) || req.ip || "unknown";
}

function requireBearerToken(req) {
  const header = String(req.get?.("authorization") || "");
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw createTvLoginError("AUTH_REQUIRED", "Authentication is required", 401);
  return match[1];
}

/**
 * The TV sends no Origin. Browsers may call only `tvLoginApprove`, from the extension or
 * the Hosting page; local emulator hosts are allowed for development.
 */
function isAllowedOrigin(origin, { browser }) {
  if (!origin) return true;
  if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return true;
  return browser && APPROVE_ORIGINS.has(origin);
}

function setTvLoginCors(req, res, { browser = false } = {}) {
  const origin = req.get?.("origin");
  if (!isAllowedOrigin(origin, { browser })) {
    res.status(403).json({ error: "Origin is not allowed", code: "ORIGIN_NOT_ALLOWED" });
    return false;
  }
  res.set("Vary", "Origin");
  if (origin) res.set("Access-Control-Allow-Origin", origin);
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return false;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Only POST requests are supported", code: "METHOD_NOT_ALLOWED" });
    return false;
  }
  return true;
}

function createTvLoginService({
  db,
  auth,
  now = () => Date.now(),
  randomInt = crypto.randomInt,
  randomBytes = crypto.randomBytes,
  toTimestamp = (millis) => millis,
} = {}) {
  if (!db || !auth || typeof auth.createCustomToken !== "function") {
    throw new Error("TV login dependencies are required");
  }
  const logins = () => db.collection(COLLECTION);

  /**
   * Counts one event in a fixed window. Returns false (and counts nothing) when the
   * window is full. Runs inside the caller's transaction, reads before writes.
   */
  async function readLimit(transaction, limitId, windowMs = LIMIT_WINDOW_MS) {
    const ref = logins().doc(`limit_${limitId}`);
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? snapshot.data() : null;
    const current = now();
    const inWindow = Boolean(data) && current - toMillis(data.windowStart) < windowMs;
    return {
      ref,
      windowMs,
      windowStart: inWindow ? toMillis(data.windowStart) : current,
      count: inWindow ? Number(data.count) || 0 : 0,
    };
  }

  function writeLimit(transaction, limit) {
    transaction.set(limit.ref, {
      windowStart: toTimestamp(limit.windowStart),
      count: limit.count + 1,
      expiresAt: toTimestamp(limit.windowStart + limit.windowMs),
    });
  }

  async function start({ deviceName, ip }) {
    const name = normalizeDeviceName(deviceName);
    const deviceCode = generateDeviceCode(randomBytes);
    const deviceCodeHash = sha256Hex(deviceCode);

    return db.runTransaction(async (transaction) => {
      const global = await readLimit(transaction, "start_global", GLOBAL_START_WINDOW_MS);
      if (global.count >= MAX_GLOBAL_STARTS_PER_MINUTE) {
        throw createTvLoginError("RATE_LIMITED", "Too many sign-in requests, try again later", 429);
      }
      const limit = await readLimit(transaction, `start_${sha256Hex(ip)}`);
      if (limit.count >= MAX_STARTS_PER_WINDOW) {
        throw createTvLoginError("RATE_LIMITED", "Too many sign-in requests, try again later", 429);
      }
      // A user code is unique among live logins; an expired one may be reused.
      let userCode = null;
      for (let attempt = 0; attempt < 8 && !userCode; attempt++) {
        const candidate = generateUserCode(randomInt);
        const existing = await transaction.get(logins().doc(candidate));
        if (!existing.exists || toMillis(existing.data().expiresAt) <= now()) userCode = candidate;
      }
      if (!userCode) throw createTvLoginError("CODE_UNAVAILABLE", "No free sign-in code", 503);

      const createdAt = now();
      const expiresAt = createdAt + LOGIN_TTL_MS;
      writeLimit(transaction, global);
      writeLimit(transaction, limit);
      transaction.set(logins().doc(userCode), {
        deviceCodeHash,
        deviceName: name,
        status: "pending",
        createdAt: toTimestamp(createdAt),
        expiresAt: toTimestamp(expiresAt),
        pollIntervalSec: POLL_INTERVAL_SEC,
        lastPollAt: null,
        approvedUid: null,
        approvedAt: null,
      });
      return {
        deviceCode,
        userCode,
        verificationUrl: `${VERIFICATION_URL}?c=${userCode}`,
        expiresAt,
        pollIntervalSec: POLL_INTERVAL_SEC,
      };
    });
  }

  /**
   * Looks a code up for the approval dialog, or (confirm) binds the user to it.
   * Each code that is wrong, expired or used counts against the user's limit.
   */
  async function approve({ uid, userCode: rawCode, confirm }) {
    const userCode = normalizeUserCode(rawCode);

    const result = await db.runTransaction(async (transaction) => {
      const limit = await readLimit(transaction, `approve_${uid}`);
      if (limit.count >= MAX_WRONG_CODES_PER_WINDOW) {
        throw createTvLoginError("RATE_LIMITED", "Too many wrong codes, try again later", 429);
      }
      const snapshot = userCode ? await transaction.get(logins().doc(userCode)) : null;
      const data = snapshot?.exists ? snapshot.data() : null;
      const live = data && data.deviceCodeHash && toMillis(data.expiresAt) > now();
      if (!live || data.status !== "pending") {
        writeLimit(transaction, limit);
        return {
          error: live
            ? createTvLoginError("CODE_USED", "This code was already used", 409)
            : createTvLoginError("CODE_NOT_FOUND", "The code is wrong or has expired", 404),
        };
      }
      const device = {
        deviceName: data.deviceName || DEFAULT_DEVICE_NAME,
        requestedAt: toMillis(data.createdAt),
        expiresAt: toMillis(data.expiresAt),
      };
      if (!confirm) return { status: "found", ...device };
      transaction.update(logins().doc(userCode), {
        status: "approved",
        approvedUid: uid,
        approvedAt: toTimestamp(now()),
      });
      return { status: "approved", ...device };
    });
    // The counter must be committed, so the error is thrown after the transaction.
    if (result.error) throw result.error;
    return result;
  }

  async function findByDeviceCode(transaction, deviceCodeHash) {
    const query = logins().where("deviceCodeHash", "==", deviceCodeHash).limit(1);
    const snapshot = transaction ? await transaction.get(query) : await query.get();
    return snapshot.empty ? null : snapshot.docs[0];
  }

  async function poll({ deviceCode }) {
    const code = String(deviceCode ?? "");
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
      throw createTvLoginError("INVALID_REQUEST", "A device code is required", 400);
    }
    const deviceCodeHash = sha256Hex(code);

    // The token is minted before the transaction: when minting fails (missing IAM role),
    // the approved login stays and the TV can poll again once the role is granted.
    let customToken = null;
    const preview = await findByDeviceCode(null, deviceCodeHash);
    const previewData = preview?.data();
    if (previewData?.status === "approved" && previewData.approvedUid && toMillis(previewData.expiresAt) > now()) {
      try {
        customToken = await auth.createCustomToken(previewData.approvedUid, CUSTOM_TOKEN_CLAIMS);
      } catch (error) {
        console.error("[tvLogin] Custom token minting failed:", error?.code || error?.name || "unknown");
        throw createTvLoginError("TOKEN_MINT_FAILED", "Sign-in is temporarily unavailable", 500);
      }
    }

    return db.runTransaction(async (transaction) => {
      const doc = await findByDeviceCode(transaction, deviceCodeHash);
      if (!doc) return { status: "expired" };
      const data = doc.data();
      const current = now();
      if (toMillis(data.expiresAt) <= current) {
        transaction.delete(doc.ref);
        return { status: "expired" };
      }
      if (data.status === "approved" && data.approvedUid) {
        if (!customToken || data.approvedUid !== previewData?.approvedUid) {
          // Approved between the preview and now: the TV gets it on the next poll.
          return { status: "pending", pollIntervalSec: Number(data.pollIntervalSec) || POLL_INTERVAL_SEC };
        }
        transaction.delete(doc.ref);
        return { status: "approved", customToken };
      }
      const interval = Number(data.pollIntervalSec) || POLL_INTERVAL_SEC;
      const lastPollAt = toMillis(data.lastPollAt);
      if (lastPollAt && current - lastPollAt < interval * 1000 - POLL_TOLERANCE_MS) {
        const slower = Math.min(MAX_POLL_INTERVAL_SEC, interval + SLOW_DOWN_STEP_SEC);
        transaction.update(doc.ref, { pollIntervalSec: slower, lastPollAt: toTimestamp(current) });
        return { status: "slow_down", pollIntervalSec: slower };
      }
      transaction.update(doc.ref, { lastPollAt: toTimestamp(current) });
      return { status: "pending", pollIntervalSec: interval };
    });
  }

  return { start, approve, poll };
}

function sendError(res, error, label) {
  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  if (statusCode >= 500 && error.code !== "TOKEN_MINT_FAILED") {
    console.error(`[${label}] Request failed:`, error?.code || error?.name || "unknown");
  }
  res.status(statusCode).json({
    error: statusCode >= 500 && !error.code ? "TV sign-in is temporarily unavailable" : error.message,
    code: error.code || "INTERNAL",
  });
}

function createTvLoginHandlers({ db, auth, ...options } = {}) {
  if (!db || !auth || typeof auth.verifyIdToken !== "function") {
    throw new Error("TV login handler dependencies are required");
  }
  const service = createTvLoginService({ db, auth, ...options });

  const start = async (req, res) => {
    if (!setTvLoginCors(req, res)) return;
    try {
      const result = await service.start({ deviceName: req.body?.deviceName, ip: clientIp(req) });
      res.status(200).json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error, "tvLoginStart");
    }
  };

  const approve = async (req, res) => {
    if (!setTvLoginCors(req, res, { browser: true })) return;
    try {
      let decodedToken;
      try {
        decodedToken = await auth.verifyIdToken(requireBearerToken(req));
      } catch (error) {
        if (error.code === "AUTH_REQUIRED" || String(error?.code || "").startsWith("auth/")) {
          throw createTvLoginError("AUTH_REQUIRED", "Authentication is required", 401);
        }
        throw error;
      }
      // A token minted for a TV cannot approve another TV.
      if (decodedToken.device === "tv") {
        throw createTvLoginError("APPROVAL_REQUIRED", "Approve from the extension or a browser", 403);
      }
      const profileSnapshot = await db.collection("users").doc(decodedToken.uid).get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      if (!isApprovedProfile(profile)) {
        throw createTvLoginError("APPROVAL_REQUIRED", "An approved account is required", 403);
      }
      const result = await service.approve({
        uid: decodedToken.uid,
        userCode: req.body?.userCode,
        confirm: req.body?.confirm === true,
      });
      res.status(200).json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error, "tvLoginApprove");
    }
  };

  const poll = async (req, res) => {
    if (!setTvLoginCors(req, res)) return;
    try {
      const result = await service.poll({ deviceCode: req.body?.deviceCode });
      res.status(200).json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error, "tvLoginPoll");
    }
  };

  return { start, approve, poll };
}

module.exports = {
  COLLECTION,
  CUSTOM_TOKEN_CLAIMS,
  LOGIN_TTL_MS,
  MAX_GLOBAL_STARTS_PER_MINUTE,
  MAX_STARTS_PER_WINDOW,
  MAX_WRONG_CODES_PER_WINDOW,
  POLL_INTERVAL_SEC,
  USER_CODE_ALPHABET,
  clientIp,
  createTvLoginHandlers,
  createTvLoginService,
  generateUserCode,
  isApprovedProfile,
  normalizeDeviceName,
  normalizeUserCode,
  sha256Hex,
};
