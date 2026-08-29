import assert from "node:assert/strict";
import test from "node:test";
import { handleDevAuthApi } from "../worker/routes/dev-auth.ts";

const request = (cookie) => new Request("http://localhost/api/testing/auto-login", { method: "POST", headers: cookie ? { cookie } : undefined });

test("testing auto-login is unavailable unless explicitly enabled", async () => {
  const response = await handleDevAuthApi(request(), "/api/testing/auto-login", {});
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("testing auto-login issues an owner session without exposing the service credential", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/rest/v1/organization_members")) return Response.json([{ user_id: "owner-1", role: "OWNER" }]);
    if (url.includes("/auth/v1/admin/users")) return Response.json({ users: [{ id: "owner-1", email: "owner@example.test" }] });
    if (url.includes("/auth/v1/admin/generate_link")) return Response.json({ hashed_token: "one-time-hash" });
    if (url.includes("/auth/v1/verify")) return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await handleDevAuthApi(request("researchops_test_access=test-access-token"), "/api/testing/auto-login", {
      SUPABASE_URL: "https://supabase.example.test",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      DEV_AUTO_LOGIN: "true",
      DEV_AUTO_LOGIN_TOKEN: "test-access-token",
    });
    assert.equal(response.status, 200);
    const responseText = await response.clone().text();
    assert.deepEqual(await response.json(), { access_token: "access-token", refresh_token: "refresh-token" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 4);
    assert.equal(calls[3].init.headers.get("apikey"), "anon-key");
    assert.doesNotMatch(responseText, /service-key|owner@example/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("testing auto-login requires the protected entry link", async () => {
  const environment = { DEV_AUTO_LOGIN: "true", DEV_AUTO_LOGIN_TOKEN: "test-access-token" };
  const denied = await handleDevAuthApi(request(), "/api/testing/auto-login", environment);
  assert.equal(denied.status, 403);

  const invalidEntry = await handleDevAuthApi(
    new Request("https://tunnel.example/api/testing/enter?token=wrong"),
    "/api/testing/enter",
    environment,
  );
  assert.equal(invalidEntry.status, 403);

  const entry = await handleDevAuthApi(
    new Request("https://tunnel.example/api/testing/enter?token=test-access-token"),
    "/api/testing/enter",
    environment,
  );
  assert.equal(entry.status, 302);
  assert.equal(entry.headers.get("location"), "/projects");
  assert.match(entry.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
});
