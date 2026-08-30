const assert = require("node:assert/strict");
const AdminService = require("../src/shared/services/AdminService.js");

async function run() {
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (options.method === "GET") {
      return {
        ok: true,
        async json() {
          return { data: [{ id: "key-1", provider: "kinopoisk", maskedValue: "••••alue", status: "active" }] };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return { data: { id: "key-1", provider: "kinopoisk", maskedValue: "••••alue", status: "active" } };
      },
    };
  };

  const firebaseManager = {
    getCurrentUser() {
      return { async getIdToken() { return "firebase-token"; } };
    },
  };
  const service = new AdminService(firebaseManager);
  const listed = await service.listProviderKeys();
  assert.equal(listed[0].id, "key-1");
  assert.match(requests[0].url, /providerKeysAdmin\?action=list/);
  assert.equal(requests[0].options.headers.Authorization, "Bearer firebase-token");

  await service.addProviderKey({
    provider: "kinopoisk",
    label: "Primary",
    purpose: "Search",
    secret: "server-only-input",
  });
  const addPayload = JSON.parse(requests[1].options.body);
  assert.equal(addPayload.action, "add");
  assert.equal(addPayload.secret, "server-only-input");

  global.fetch = async () => ({
    ok: true,
    async json() {
      return { data: [{ id: "key-1", secret: "must-never-be-accepted" }] };
    },
  });
  await assert.rejects(() => service.listProviderKeys(), /unsafe/);

  global.fetch = async () => ({
    ok: false,
    status: 409,
    async json() {
      return { error: { code: "DUPLICATE_KEY", message: "duplicate" } };
    },
  });
  await assert.rejects(
    () => service.addProviderKey({ secret: "value" }),
    (error) => error.code === "DUPLICATE_KEY" && error.status === 409
  );

  global.fetch = originalFetch;
  console.log("adminProviderKeysContract.test.cjs: all tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
