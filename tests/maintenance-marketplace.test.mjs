import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { handleMaintenanceCronApi } = await import("../worker/routes/maintenance.ts");

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  CRON_SECRET: "cron-secret",
};

async function run(marketplaceResponse) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push({ url: target, init });
    if (target.includes("maintain_marketplace_supply")) return marketplaceResponse();
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const request = new Request("https://router.asrv.co.in/api/cron/maintenance", {
      headers: { authorization: "Bearer cron-secret" },
    });
    const response = await handleMaintenanceCronApi(request, "/api/cron/maintenance", env);
    return { response, body: await response.json(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

test("maintenance cron calls maintain_marketplace_supply and reports counts", async () => {
  const { response, body, calls } = await run(
    () => Response.json([{ confirmed_entries: 3, paused_projects: 2 }]),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(body.marketplace, { confirmedEntries: 3, pausedProjects: 2 });
  const call = calls.find((c) => c.url.endsWith("/rest/v1/rpc/maintain_marketplace_supply"));
  assert.ok(call);
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.body, "{}");
  assert.equal(call.init.headers.apikey, "service-key");
  assert.equal(call.init.headers.authorization, "Bearer service-key");
});

test("maintenance cron refuses to run without CRON_SECRET when a database is configured", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({}); };
  try {
    const unauthenticated = new Request("https://router.asrv.co.in/api/cron/maintenance");
    const response = await handleMaintenanceCronApi(unauthenticated, "/api/cron/maintenance", { ...env, CRON_SECRET: undefined });
    assert.equal(response.status, 503);
    assert.equal(calls, 0, "no database call may happen when the job is not protected");
    // Mock mode (no database) stays harmless and open, as before.
    const mock = await handleMaintenanceCronApi(unauthenticated, "/api/cron/maintenance", {});
    assert.equal(mock.status, 200);
    assert.equal((await mock.json()).mode, "mock");
  } finally {
    globalThis.fetch = original;
  }
});

test("a 404 from the marketplace RPC leaves the cron successful", async () => {
  const { response, body } = await run(() => new Response("{}", { status: 404 }));
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.marketplace, null);
});

test("a 500 from the marketplace RPC leaves the cron successful", async () => {
  const { response, body } = await run(() => new Response("boom", { status: 500 }));
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.marketplace, null);
});
