const assert = require("node:assert/strict");
const { createProviderKeyManagementHandler } = require("../functions/providerKeyManagement");

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

async function run() {
  let calls = 0;
  const service = {
    async addProviderKey() {
      calls += 1;
      return {
        id: "key-1",
        provider: "kinopoisk",
        label: "Primary",
        secret: "must-not-leak",
        secretName: "must-not-leak-either",
      };
    },
  };
  const handler = createProviderKeyManagementHandler({
    service,
    verifyAdminRequest: async () => ({ uid: "admin-1" }),
    setCors: () => true,
  });
  const result = createResponse();
  await handler({ method: "POST", headers: {}, body: { action: "add", provider: "kinopoisk", label: "Primary", purpose: "Search", secret: "input" } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(result.body).includes("must-not-leak"));

  const deniedHandler = createProviderKeyManagementHandler({
    service,
    verifyAdminRequest: async () => {
      const error = new Error("denied");
      error.statusCode = 403;
      error.code = "ADMIN_REQUIRED";
      throw error;
    },
    setCors: () => true,
  });
  const denied = createResponse();
  await deniedHandler({ method: "GET", headers: {}, query: {} }, denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(calls, 1, "Unauthorized requests must not reach the service");

  const unauthenticatedHandler = createProviderKeyManagementHandler({
    service,
    verifyAdminRequest: async () => {
      const error = new Error("Authentication is required");
      error.statusCode = 401;
      throw error;
    },
    setCors: () => true,
  });
  const unauthenticated = createResponse();
  await unauthenticatedHandler({ method: "GET", headers: {}, query: {} }, unauthenticated);
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(unauthenticated.body.error.code, "AUTH_REQUIRED");
  assert.equal(calls, 1, "Unauthenticated requests must not reach the service");

  console.log("providerKeyManagementHandler.test.cjs: all tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
