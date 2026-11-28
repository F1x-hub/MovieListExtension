const assert = require("node:assert/strict");
const {
  COLLECTION,
  LOGIN_TTL_MS,
  MAX_GLOBAL_STARTS_PER_MINUTE,
  MAX_STARTS_PER_WINDOW,
  MAX_WRONG_CODES_PER_WINDOW,
  USER_CODE_ALPHABET,
  clientIp,
  createTvLoginHandlers,
  generateUserCode,
  normalizeDeviceName,
  normalizeUserCode,
  sha256Hex,
} = require("../tvLogin");

// --- A small in-memory Firestore: docs, equality queries with limit, transactions. ---
function createFakeDb() {
  const store = new Map();
  const key = (collection, id) => `${collection}/${id}`;
  const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

  function docRef(collection, id) {
    return {
      id,
      path: key(collection, id),
      async get() { return snapshotOf(this); },
    };
  }
  function snapshotOf(ref) {
    const data = store.get(ref.path);
    return { id: ref.id, ref, exists: data !== undefined, data: () => clone(data) };
  }
  function query(collection, filters = [], max = Infinity) {
    return {
      where(field, op, value) {
        assert.equal(op, "==");
        return query(collection, [...filters, [field, value]], max);
      },
      limit(n) { return query(collection, filters, n); },
      async get() {
        const docs = [];
        for (const [path, data] of store) {
          const [c, id] = path.split("/");
          if (c !== collection) continue;
          if (filters.every(([f, v]) => data[f] === v)) docs.push(snapshotOf(docRef(c, id)));
          if (docs.length >= max) break;
        }
        return { empty: docs.length === 0, docs };
      },
    };
  }
  const db = {
    store,
    collection(name) {
      return {
        doc: (id) => docRef(name, id),
        where: (field, op, value) => query(name).where(field, op, value),
      };
    },
    async runTransaction(fn) {
      const writes = [];
      let wrote = false;
      const transaction = {
        async get(target) {
          assert.equal(wrote, false, "reads come before writes in a transaction");
          return target.get();
        },
        set(ref, data) { wrote = true; writes.push(() => store.set(ref.path, clone(data))); },
        update(ref, data) {
          wrote = true;
          writes.push(() => {
            assert.ok(store.has(ref.path), "update needs an existing document");
            store.set(ref.path, { ...store.get(ref.path), ...clone(data) });
          });
        },
        delete(ref) { wrote = true; writes.push(() => store.delete(ref.path)); },
      };
      const result = await fn(transaction);
      writes.forEach((apply) => apply());
      return result;
    },
  };
  return db;
}

function createFakeAuth() {
  const minted = [];
  return {
    minted,
    failMint: false,
    async verifyIdToken(token) {
      if (token.startsWith("tv-")) return { uid: token.slice(3), device: "tv" };
      if (!token.startsWith("id-")) {
        const error = new Error("bad token");
        error.code = "auth/argument-error";
        throw error;
      }
      return { uid: token.slice(3) };
    },
    async createCustomToken(uid, claims) {
      if (this.failMint) {
        const error = new Error("Permission iam.serviceAccounts.signBlob denied");
        error.code = "auth/insufficient-permission";
        throw error;
      }
      minted.push({ uid, claims });
      return `custom-token-for-${uid}`;
    },
  };
}

function request({ method = "POST", body = {}, headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, body, ip: "203.0.113.7", get: (name) => lower[name.toLowerCase()] };
}

function response() {
  const res = {
    statusCode: null,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    set(name, value) { this.headers[name] = value; return this; },
  };
  return res;
}

async function call(handler, options) {
  const res = response();
  await handler(request(options), res);
  return res;
}

function setup() {
  let clock = 1_800_000_000_000;
  const db = createFakeDb();
  const auth = createFakeAuth();
  db.store.set("users/alice", { approvalStatus: "approved" });
  db.store.set("users/legacy", {});
  db.store.set("users/pending", { approvalStatus: "pending" });
  const handlers = createTvLoginHandlers({ db, auth, now: () => clock });
  return { db, auth, handlers, advance: (ms) => { clock += ms; }, now: () => clock };
}

const bearer = (uid) => ({ Authorization: `Bearer id-${uid}` });

(async () => {
  // --- Codes ---
  for (const bad of ["0", "O", "1", "I", "L"]) assert.equal(USER_CODE_ALPHABET.includes(bad), false, `${bad} is not in the alphabet`);
  for (let i = 0; i < 200; i++) {
    const code = generateUserCode();
    assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  }
  assert.equal(normalizeUserCode("k7q·4md"), "K7Q4MD");
  assert.equal(normalizeUserCode(" K7Q-4MD "), "K7Q4MD");
  assert.equal(normalizeUserCode("K7Q4M0"), null, "0 is never a valid character");
  assert.equal(normalizeUserCode("K7Q4M"), null);
  assert.equal(normalizeUserCode(null), null);
  assert.equal(normalizeDeviceName("  Телевизор\n TCL <b>  "), "Телевизор TCL b");
  assert.equal(normalizeDeviceName(""), "Телевизор");
  assert.equal(normalizeDeviceName("x".repeat(80)).length, 40);

  // --- Full flow: start, look up, confirm, poll once, then the login is gone. ---
  {
    const { db, auth, handlers, advance } = setup();
    const started = await call(handlers.start, { body: { deviceName: "Телевизор TCL" } });
    assert.equal(started.statusCode, 200);
    const { deviceCode, userCode, verificationUrl, expiresAt, pollIntervalSec } = started.body;
    assert.match(deviceCode, /^[A-Za-z0-9_-]{43}$/, "256-bit base64url device code");
    assert.equal(verificationUrl, `https://movielistdb-13208.web.app/tv?c=${userCode}`);
    assert.equal(pollIntervalSec, 5);
    const stored = db.store.get(`${COLLECTION}/${userCode}`);
    assert.equal(stored.deviceCodeHash, sha256Hex(deviceCode));
    assert.equal(JSON.stringify(stored).includes(deviceCode), false, "the device code is stored only as its hash");
    assert.equal(expiresAt - stored.createdAt, LOGIN_TTL_MS);

    let polled = await call(handlers.poll, { body: { deviceCode } });
    assert.deepEqual(polled.body, { ok: true, status: "pending", pollIntervalSec: 5 });

    const lookup = await call(handlers.approve, { headers: bearer("alice"), body: { userCode: userCode.toLowerCase() } });
    assert.equal(lookup.statusCode, 200);
    assert.equal(lookup.body.status, "found");
    assert.equal(lookup.body.deviceName, "Телевизор TCL");
    assert.equal(lookup.body.requestedAt, stored.createdAt);
    assert.equal(db.store.get(`${COLLECTION}/${userCode}`).status, "pending", "a lookup approves nothing");

    const confirmed = await call(handlers.approve, { headers: bearer("alice"), body: { userCode, confirm: true } });
    assert.equal(confirmed.body.status, "approved");

    advance(5_000);
    polled = await call(handlers.poll, { body: { deviceCode } });
    assert.deepEqual(polled.body, { ok: true, status: "approved", customToken: "custom-token-for-alice" });
    assert.deepEqual(auth.minted, [{ uid: "alice", claims: { device: "tv" } }]);
    assert.equal(db.store.has(`${COLLECTION}/${userCode}`), false, "single use: the login is deleted");

    advance(5_000);
    polled = await call(handlers.poll, { body: { deviceCode } });
    assert.equal(polled.body.status, "expired", "a second poll gets no token");
    assert.equal(auth.minted.length, 1);

    const reused = await call(handlers.approve, { headers: bearer("alice"), body: { userCode, confirm: true } });
    assert.equal(reused.statusCode, 404);
  }

  // --- Legacy users (no approvalStatus) may approve; pending users, TV tokens and anonymous calls may not. ---
  {
    const { handlers } = setup();
    const { userCode } = (await call(handlers.start, {})).body;
    assert.equal((await call(handlers.approve, { headers: bearer("legacy"), body: { userCode } })).statusCode, 200);
    const pending = await call(handlers.approve, { headers: bearer("pending"), body: { userCode, confirm: true } });
    assert.equal(pending.statusCode, 403);
    assert.equal(pending.body.code, "APPROVAL_REQUIRED");
    const tv = await call(handlers.approve, { headers: { Authorization: "Bearer tv-alice" }, body: { userCode, confirm: true } });
    assert.equal(tv.statusCode, 403, "a TV session cannot approve another TV");
    assert.equal((await call(handlers.approve, { body: { userCode } })).statusCode, 401);
    assert.equal((await call(handlers.approve, { headers: { Authorization: "Bearer junk" }, body: { userCode } })).statusCode, 401);
  }

  // --- Expiry after ten minutes. ---
  {
    const { db, handlers, advance } = setup();
    const { deviceCode, userCode } = (await call(handlers.start, {})).body;
    advance(LOGIN_TTL_MS + 1);
    const late = await call(handlers.approve, { headers: bearer("alice"), body: { userCode, confirm: true } });
    assert.equal(late.statusCode, 404);
    assert.equal(late.body.code, "CODE_NOT_FOUND");
    const polled = await call(handlers.poll, { body: { deviceCode } });
    assert.equal(polled.body.status, "expired");
    assert.equal(db.store.has(`${COLLECTION}/${userCode}`), false, "an expired login is removed on poll");
  }

  // --- Polling faster than asked gets slow_down and a longer interval. ---
  {
    const { handlers, advance } = setup();
    const { deviceCode } = (await call(handlers.start, {})).body;
    await call(handlers.poll, { body: { deviceCode } });
    advance(1_000);
    let polled = await call(handlers.poll, { body: { deviceCode } });
    assert.deepEqual(polled.body, { ok: true, status: "slow_down", pollIntervalSec: 10 });
    advance(10_000);
    polled = await call(handlers.poll, { body: { deviceCode } });
    assert.deepEqual(polled.body, { ok: true, status: "pending", pollIntervalSec: 10 });
    assert.equal((await call(handlers.poll, { body: { deviceCode: "short" } })).statusCode, 400);
    const unknown = await call(handlers.poll, { body: { deviceCode: "A".repeat(43) } });
    assert.equal(unknown.body.status, "expired", "an unknown device code reads as expired");
  }

  // --- A failed mint keeps the approved login so the TV can retry after the IAM fix. ---
  {
    const { db, auth, handlers, advance } = setup();
    const { deviceCode, userCode } = (await call(handlers.start, {})).body;
    await call(handlers.approve, { headers: bearer("alice"), body: { userCode, confirm: true } });
    auth.failMint = true;
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(" "));
    let polled;
    try {
      polled = await call(handlers.poll, { body: { deviceCode } });
    } finally {
      console.error = originalError;
    }
    assert.equal(polled.statusCode, 500);
    assert.equal(polled.body.code, "TOKEN_MINT_FAILED");
    assert.ok(errors.some((line) => line.includes("auth/insufficient-permission")), "the error code is logged");
    assert.equal(errors.some((line) => line.includes(deviceCode) || line.includes(userCode)), false, "no codes in logs");
    assert.equal(db.store.get(`${COLLECTION}/${userCode}`).status, "approved");
    auth.failMint = false;
    advance(5_000);
    polled = await call(handlers.poll, { body: { deviceCode } });
    assert.equal(polled.body.status, "approved");
  }

  // --- Rate limits: starts per IP, wrong codes per user. ---
  {
    const { handlers, advance } = setup();
    for (let i = 0; i < MAX_STARTS_PER_WINDOW; i++) {
      assert.equal((await call(handlers.start, {})).statusCode, 200);
    }
    const limited = await call(handlers.start, {});
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.body.code, "RATE_LIMITED");
    advance(10 * 60 * 1000);
    assert.equal((await call(handlers.start, {})).statusCode, 200, "the window resets");
  }
  {
    const { handlers, advance } = setup();
    const { userCode } = (await call(handlers.start, {})).body;
    for (let i = 0; i < MAX_WRONG_CODES_PER_WINDOW; i++) {
      const wrong = await call(handlers.approve, { headers: bearer("alice"), body: { userCode: "ZZZZZZ" === userCode ? "YYYYYY" : "ZZZZZZ" } });
      assert.equal(wrong.statusCode, 404);
    }
    const limited = await call(handlers.approve, { headers: bearer("alice"), body: { userCode, confirm: true } });
    assert.equal(limited.statusCode, 429, "after five wrong codes even the right one waits");
    assert.equal((await call(handlers.approve, { headers: bearer("legacy"), body: { userCode } })).statusCode, 200,
      "the limit is per user");
    advance(10 * 60 * 1000);
    const fresh = (await call(handlers.start, {})).body.userCode;
    assert.equal((await call(handlers.approve, { headers: bearer("alice"), body: { userCode: fresh, confirm: true } })).statusCode, 200,
      "the wrong-code window resets");
  }

  // --- The client address is the last X-Forwarded-For entry (added by Google's front end). ---
  assert.equal(clientIp(request({ headers: { "X-Forwarded-For": "6.6.6.6, 198.51.100.4" } })), "198.51.100.4");
  assert.equal(clientIp(request({ headers: { "X-Forwarded-For": "198.51.100.4" } })), "198.51.100.4");
  assert.equal(clientIp(request({})), "203.0.113.7", "falls back to the platform's address");
  {
    const { handlers } = setup();
    for (let i = 0; i < MAX_STARTS_PER_WINDOW; i++) {
      const spoofed = { "X-Forwarded-For": `10.0.0.${i}, 198.51.100.4` };
      assert.equal((await call(handlers.start, { headers: spoofed })).statusCode, 200);
    }
    const spoofed = await call(handlers.start, { headers: { "X-Forwarded-For": "10.9.9.9, 198.51.100.4" } });
    assert.equal(spoofed.statusCode, 429, "a forged first X-Forwarded-For entry does not escape the per-address limit");
  }

  // --- A global per-minute cap on starts, whatever the addresses. ---
  {
    const { handlers, advance } = setup();
    for (let i = 0; i < MAX_GLOBAL_STARTS_PER_MINUTE; i++) {
      const res = await call(handlers.start, { headers: { "X-Forwarded-For": `198.51.100.${i}` } });
      assert.equal(res.statusCode, 200);
    }
    const over = await call(handlers.start, { headers: { "X-Forwarded-For": "198.51.100.250" } });
    assert.equal(over.statusCode, 429);
    assert.equal(over.body.code, "RATE_LIMITED");
    advance(60 * 1000);
    assert.equal((await call(handlers.start, { headers: { "X-Forwarded-For": "198.51.100.251" } })).statusCode, 200,
      "the global window is one minute");
  }

  // --- A used code cannot be approved by someone else. ---
  {
    const { handlers } = setup();
    const { userCode } = (await call(handlers.start, {})).body;
    await call(handlers.approve, { headers: bearer("alice"), body: { userCode, confirm: true } });
    const second = await call(handlers.approve, { headers: bearer("legacy"), body: { userCode, confirm: true } });
    assert.equal(second.statusCode, 409);
    assert.equal(second.body.code, "CODE_USED");
  }

  // --- CORS and methods. ---
  {
    const { handlers } = setup();
    assert.equal((await call(handlers.start, { method: "GET" })).statusCode, 405);
    assert.equal((await call(handlers.start, { headers: { Origin: "https://evil.example" } })).statusCode, 403);
    assert.equal((await call(handlers.poll, { headers: { Origin: "https://movielistdb-13208.web.app" } })).statusCode, 403,
      "browsers never poll");
    const preflight = await call(handlers.approve, { method: "OPTIONS", headers: { Origin: "https://movielistdb-13208.web.app" } });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers["Access-Control-Allow-Origin"], "https://movielistdb-13208.web.app");
    const extension = await call(handlers.approve, {
      method: "OPTIONS",
      headers: { Origin: "chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd" },
    });
    assert.equal(extension.statusCode, 204);
    assert.equal((await call(handlers.approve, { method: "OPTIONS", headers: { Origin: "https://evil.example" } })).statusCode, 403);
  }

  console.log("tvLogin tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
