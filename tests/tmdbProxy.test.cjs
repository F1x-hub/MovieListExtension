const assert = require("node:assert/strict");
const { createTmdbProxyHandler } = require("../functions/tmdbProxy");

function createResponse() {
  return {
    body: null,
    headers: {},
    statusCode: null,
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
  };
}

async function run() {
  const outcomes = [];
  const tokens = [];
  const handler = createTmdbProxyHandler({
    keyPool: {
      async getActiveKeys() {
        return {
          keys: [
            { keyId: "first", value: "first-token" },
            { keyId: "second", value: "second-token" },
          ],
          configuredCount: 2,
          registeredCount: 2,
        };
      },
      reportOutcome(outcome) { outcomes.push(outcome); },
    },
    fetchImpl: async (_url, options) => {
      tokens.push(options.headers.Authorization);
      if (tokens.length === 1) {
        return { status: 429, headers: new Map(), async text() { return "rate limited"; } };
      }
      return { status: 200, headers: new Map([["content-type", "application/json"]]), async text() { return '{"ok":true}'; } };
    },
    logger: { warn() {}, error() {} },
  });
  const response = createResponse();
  await handler({ method: "GET", headers: {}, query: { url: "https://api.themoviedb.org/3/movie/11" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, '{"ok":true}');
  assert.deepEqual(tokens, ["Bearer first-token", "Bearer second-token"]);
  assert.deepEqual(outcomes, [
    { keyId: "first", outcome: "rejected" },
    { keyId: "second", outcome: "success" },
  ]);
  assert.ok(!JSON.stringify(response).includes("first-token"));
  assert.ok(!JSON.stringify(response).includes("second-token"));

  let fallbackHeader = null;
  const fallbackHandler = createTmdbProxyHandler({
    keyPool: {
      async getActiveKeys() { return { keys: [], configuredCount: 0, registeredCount: 0 }; },
      reportOutcome() {},
    },
    getLegacySecretValue: () => "legacy-token",
    fetchImpl: async (_url, options) => {
      fallbackHeader = options.headers.Authorization;
      return { status: 200, headers: new Map(), async text() { return "legacy ok"; } };
    },
    logger: { warn() {}, error() {} },
  });
  const fallbackResponse = createResponse();
  await fallbackHandler({ method: "GET", headers: {}, query: { url: "https://api.themoviedb.org/3/movie/11" } }, fallbackResponse);
  assert.equal(fallbackResponse.statusCode, 200);
  assert.equal(fallbackHeader, "Bearer legacy-token");
  assert.ok(!JSON.stringify(fallbackResponse).includes("legacy-token"));

  const disabledResponse = createResponse();
  const disabledHandler = createTmdbProxyHandler({
    keyPool: {
      async getActiveKeys() { return { keys: [], configuredCount: 0, registeredCount: 1 }; },
      reportOutcome() {},
    },
    getLegacySecretValue: () => "legacy-token",
    logger: { warn() {}, error() {} },
  });
  await disabledHandler({ method: "GET", headers: {}, query: { url: "https://api.themoviedb.org/3/movie/11" } }, disabledResponse);
  assert.equal(disabledResponse.statusCode, 503, "Disabled registry keys must not fall back to the legacy token");

  console.log("tmdbProxy.test.cjs: all tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
