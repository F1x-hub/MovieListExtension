const assert = require("assert");
const { createAdminAuthVerifier, getBearerToken } = require("../functions/adminAuth");

function createRequest(authorization) {
  return { headers: authorization === undefined ? {} : { authorization } };
}

function createAuthFixture({ admin = true, verifyError = null } = {}) {
  const calls = [];
  const auth = {
    async verifyIdToken(token) {
      calls.push(token);
      if (verifyError) throw verifyError;
      return { uid: "admin-1" };
    },
  };
  const db = {
    collection(name) {
      assert.strictEqual(name, "users");
      return {
        doc(uid) {
          assert.strictEqual(uid, "admin-1");
          return {
            async get() {
              return {
                exists: admin,
                data: () => ({ isAdmin: admin }),
              };
            },
          };
        },
      };
    },
  };
  return { auth, db, calls };
}

assert.strictEqual(getBearerToken(createRequest()), null, "Missing authorization must be rejected");
assert.strictEqual(getBearerToken(createRequest("Basic token")), null, "Non-bearer auth must be rejected");
assert.strictEqual(getBearerToken(createRequest("Bearer abc")), "abc", "Bearer token must be extracted");

(async () => {
  {
    const fixture = createAuthFixture();
    const verifyAdminRequest = createAdminAuthVerifier(fixture);
    const token = await verifyAdminRequest(createRequest("Bearer valid"));
    assert.deepStrictEqual(token, { uid: "admin-1" });
    assert.deepStrictEqual(fixture.calls, ["valid"]);
  }

  {
    const fixture = createAuthFixture({ admin: false });
    const verifyAdminRequest = createAdminAuthVerifier(fixture);
    await assert.rejects(
      () => verifyAdminRequest(createRequest("Bearer valid")),
      (error) => error.statusCode === 403 && error.message === "Admin access is required"
    );
  }

  {
    const fixture = createAuthFixture({ verifyError: new Error("invalid token") });
    const verifyAdminRequest = createAdminAuthVerifier(fixture);
    await assert.rejects(
      () => verifyAdminRequest(createRequest("Bearer invalid")),
      (error) => error.statusCode === 401 && error.message === "invalid token"
    );
  }

  {
    const fixture = createAuthFixture();
    const verifyAdminRequest = createAdminAuthVerifier(fixture);
    await assert.rejects(
      () => verifyAdminRequest(createRequest()),
      (error) => error.statusCode === 401 && error.message === "Authentication is required"
    );
  }

  console.log("adminAuth.test.cjs: all tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
