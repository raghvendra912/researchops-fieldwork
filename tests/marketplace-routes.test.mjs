import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { registerHooks } from "node:module";

// Resolve extensionless Worker imports when running source TypeScript in Node.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const { handleMarketplaceApi } = await import("../worker/routes/marketplace.ts");

const marketplaceId = "aaaaaaaa-0000-4000-8000-000000000001";
const sessionA = "11111111-1111-4111-8111-111111111111";
const sessionB = "22222222-2222-4222-8222-222222222222";
const sessionOther = "33333333-3333-4333-8333-333333333333";
const configured = { SUPABASE_URL: "https://database.example", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", CRON_SECRET: "cron-secret", MARKETPLACE_TEST_SECRET: "callback-secret" };

function mockFetch(handler) {
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input); const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, search: url.search, method: init.method ?? "GET", body, headers: new Headers(init.headers) });
    return handler({ url, init, body });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const signed = (secret, body, seconds = Math.floor(Date.now() / 1000)) => ({ "x-researchops-timestamp": String(seconds), "x-researchops-signature": createHmac("sha256", secret).update(`${seconds}.${body}`).digest("hex") });

test("demo mode serves read-only sample data and refuses writes", async () => {
  const none = await handleMarketplaceApi(new Request("https://app.example/api/unrelated"), "/api/unrelated", {});
  assert.equal(none, null);
  const list = await handleMarketplaceApi(new Request("https://app.example/api/marketplaces"), "/api/marketplaces", {});
  const listBody = await list.json();
  assert.equal(listBody.meta.source, "mock");
  assert.equal(listBody.data[0].secretConfigured, false);
  const surveys = await (await handleMarketplaceApi(new Request("https://app.example/api/marketplace-surveys"), "/api/marketplace-surveys", {})).json();
  assert.equal(surveys.data[0].estimatedEarningsPerClick.basis, "conversion");
  assert.equal(surveys.data[1].estimatedEarningsPerClick.basis, "incidence-ceiling");
  const write = await handleMarketplaceApi(new Request("https://app.example/api/marketplaces", { method: "POST", body: "{}" }), "/api/marketplaces", {});
  assert.equal(write.status, 503);
});

test("cron maintenance needs the exact bearer secret and runs with the service role", async () => {
  const path = "/api/cron/marketplace";
  const noSecret = await handleMarketplaceApi(new Request(`https://app.example${path}`), path, { ...configured, CRON_SECRET: undefined });
  assert.equal(noSecret.status, 503);
  const mock = mockFetch(({ url }) => url.pathname.endsWith("/rpc/maintain_marketplace_supply") ? Response.json([{ confirmed_entries: 4, paused_projects: 1 }]) : new Response("unexpected", { status: 500 }));
  try {
    for (const authorization of [undefined, "Bearer wrong", "Bearer cron-secrex", "cron-secret"]) {
      const denied = await handleMarketplaceApi(new Request(`https://app.example${path}`, { headers: authorization ? { authorization } : {} }), path, configured);
      assert.equal(denied.status, 401, String(authorization));
    }
    assert.equal(mock.calls.length, 0, "no database call may happen before the secret is verified");
    const ok = await handleMarketplaceApi(new Request(`https://app.example${path}`, { headers: { authorization: "Bearer cron-secret" } }), path, configured);
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).data, { confirmedEntries: 4, pausedProjects: 1 });
    assert.equal(mock.calls[0].headers.get("authorization"), "Bearer service");
    const wrongMethod = await handleMarketplaceApi(new Request(`https://app.example${path}`, { method: "DELETE", headers: { authorization: "Bearer cron-secret" } }), path, configured);
    assert.equal(wrongMethod.status, 405);
  } finally { mock.restore(); }
});

function callbackFixture({ known = [sessionA, sessionB], secretEnv = "MARKETPLACE_TEST_SECRET" } = {}) {
  return mockFetch(({ url, body }) => {
    if (url.pathname.endsWith("/marketplaces")) return Response.json([{ id: marketplaceId, provider: "GENERIC", status: "ACTIVE", config: { secretEnv } }]);
    if (url.pathname.endsWith("/finance_ledger_entries")) return Response.json(known.map((session_id) => ({ session_id })));
    if (url.pathname.endsWith("/rpc/confirm_ledger_entries")) return Response.json([{ confirmed_count: body.p_session_ids.length * 2 }]);
    if (url.pathname.endsWith("/rpc/reverse_session_ledger")) return Response.json([{ reversed_entries: 2 }]);
    return new Response("unexpected", { status: 500 });
  });
}

test("marketplace callbacks reject bad signatures, stale timestamps and missing secrets", async () => {
  const path = `/api/marketplace-callbacks/${marketplaceId}`;
  const body = JSON.stringify({ events: [{ transaction_id: sessionA, status: "approved" }] });
  const mock = callbackFixture();
  try {
    const request = (headers, env = configured) => handleMarketplaceApi(new Request(`https://app.example${path}`, { method: "POST", headers: { "cf-connecting-ip": "203.0.113.1", ...headers }, body }), path, env);
    assert.equal((await request({})).status, 401, "unsigned");
    assert.equal((await request(signed("wrong-secret", body))).status, 401, "wrong secret");
    assert.equal((await request(signed("callback-secret", body, Math.floor(Date.now() / 1000) - 3600))).status, 401, "replayed/stale");
    assert.equal((await request(signed("callback-secret", `${body} `))).status, 401, "body altered after signing");
    assert.equal((await request(signed("callback-secret", body), { ...configured, MARKETPLACE_TEST_SECRET: undefined })).status, 503, "secret variable not set");
    assert.equal(mock.calls.filter((call) => call.path.includes("/rpc/") && !call.path.endsWith("/rpc/check_rate_limit")).length, 0, "no ledger change without a valid signature");
    const wrongMethod = await handleMarketplaceApi(new Request(`https://app.example${path}`), path, configured);
    assert.equal(wrongMethod.status, 405);
  } finally { mock.restore(); }
});

test("a signed marketplace callback confirms and reverses only sessions it earned money on", async () => {
  const path = `/api/marketplace-callbacks/${marketplaceId}`;
  const body = JSON.stringify({ events: [
    { transaction_id: sessionA, status: "approved" },
    { transaction_id: sessionB, status: "rejected", reason: "Quality" },
    { transaction_id: sessionOther, status: "approved" },
    { transaction_id: sessionOther, status: "rejected" },
    { transaction_id: "nope", status: "approved" },
  ] });
  const mock = callbackFixture();
  try {
    const response = await handleMarketplaceApi(new Request(`https://app.example${path}`, { method: "POST", headers: { "cf-connecting-ip": "203.0.113.2", ...signed("callback-secret", body) }, body }), path, configured);
    assert.equal(response.status, 200, await response.clone().text());
    const result = (await response.json()).data;
    assert.equal(result.confirmedEntries, 2);
    assert.equal(result.reversedSessions, 1);
    assert.equal(result.unknownSessions, 2, "sessions from another marketplace are ignored, not acted on");
    assert.equal(result.errors.length, 1);
    const confirmCall = mock.calls.find((call) => call.path.endsWith("/rpc/confirm_ledger_entries"));
    assert.deepEqual(confirmCall.body.p_session_ids, [sessionA]);
    const reverseCalls = mock.calls.filter((call) => call.path.endsWith("/rpc/reverse_session_ledger"));
    assert.deepEqual(reverseCalls.map((call) => call.body.p_session_id), [sessionB]);
    assert.equal(reverseCalls[0].body.p_reason, "Quality");
    const ledgerLookup = mock.calls.find((call) => call.path.endsWith("/finance_ledger_entries"));
    assert.match(ledgerLookup.search, new RegExp(`marketplace_id=eq.${marketplaceId}`), "lookup is scoped to this marketplace");
  } finally { mock.restore(); }
});

test("a callback cannot name an arbitrary server variable as its secret", async () => {
  const path = `/api/marketplace-callbacks/${marketplaceId}`;
  const body = JSON.stringify({ events: [] });
  const mock = callbackFixture({ secretEnv: "SUPABASE_SERVICE_ROLE_KEY" });
  try {
    // Signed with the service-role key: must still be refused because that name is not a marketplace secret.
    const response = await handleMarketplaceApi(new Request(`https://app.example${path}`, { method: "POST", headers: { "cf-connecting-ip": "203.0.113.3", ...signed("service", body) }, body }), path, configured);
    assert.equal(response.status, 503);
  } finally { mock.restore(); }
});

function workspaceFixture(role, extra = () => new Response("unexpected", { status: 500 })) {
  return mockFetch((context) => {
    if (context.url.pathname.endsWith("/organization_members")) return Response.json(role ? [{ organization_id: "org-1", role }] : []);
    return extra(context);
  });
}
const authed = (method, path, body) => new Request(`https://app.example${path}`, { method, headers: { authorization: "Bearer header.payload.signature", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

test("marketplace data is restricted to operators and administration to owners and admins", async () => {
  const mock = workspaceFixture("MEMBER");
  try {
    const read = await handleMarketplaceApi(authed("GET", "/api/marketplaces"), "/api/marketplaces", configured);
    assert.equal(read.status, 403);
    const finance = await handleMarketplaceApi(authed("GET", "/api/finance/summary"), "/api/finance/summary", configured);
    assert.equal(finance.status, 403);
  } finally { mock.restore(); }
  const pm = workspaceFixture("PM");
  try {
    const create = await handleMarketplaceApi(authed("POST", "/api/marketplaces", { name: "Cint" }), "/api/marketplaces", configured);
    assert.equal(create.status, 403, "a PM can operate but not add marketplaces");
  } finally { pm.restore(); }
  const anonymous = await handleMarketplaceApi(new Request("https://app.example/api/marketplaces"), "/api/marketplaces", configured);
  assert.equal(anonymous.status, 401);
});

test("creating a marketplace validates input and rejects arbitrary secret names", async () => {
  const mock = workspaceFixture("ADMIN", ({ url }) => url.pathname.endsWith("/rpc/create_marketplace") ? Response.json([{ new_marketplace_id: marketplaceId, new_client_id: "client-1" }]) : new Response("unexpected", { status: 500 }));
  try {
    const create = (body) => handleMarketplaceApi(authed("POST", "/api/marketplaces", body), "/api/marketplaces", configured);
    assert.equal((await create({ name: "X" })).status, 400);
    assert.equal((await create({ name: "Cint", provider: "NOPE" })).status, 400);
    assert.equal((await create({ name: "Cint", currency: "dollars" })).status, 400);
    assert.equal((await create({ name: "Cint", reversalWindowDays: 9999 })).status, 400);
    assert.equal((await create({ name: "Cint", secretEnv: "SUPABASE_SERVICE_ROLE_KEY" })).status, 400);
    assert.equal((await create({ name: "Cint", entrySigning: { enabled: true } })).status, 400, "signing needs a secret name");
    assert.equal(mock.calls.filter((call) => call.path.includes("/rpc/")).length, 0);
    const ok = await create({ name: "Cint", provider: "cint", currency: "usd", reversalWindowDays: 14, secretEnv: "MARKETPLACE_CINT_SECRET", entrySigning: { enabled: true, algorithm: "SHA-1", param: "sig" } });
    assert.equal(ok.status, 201);
    const rpc = mock.calls.find((call) => call.path.endsWith("/rpc/create_marketplace")).body;
    assert.equal(rpc.p_provider, "CINT");
    assert.equal(rpc.p_currency, "USD");
    assert.deepEqual(rpc.p_config, { secretEnv: "MARKETPLACE_CINT_SECRET", entrySigning: { enabled: true, algorithm: "SHA-1", param: "sig" } });
  } finally { mock.restore(); }
});

test("inventory sync parses the feed, applies it atomically, and never lets a partial feed close surveys", async () => {
  const path = `/api/marketplaces/${marketplaceId}/sync`;
  const mock = workspaceFixture("PM", ({ url }) => {
    if (url.pathname.endsWith("/marketplaces")) return Response.json([{ id: marketplaceId, provider: "GENERIC", status: "ACTIVE" }]);
    if (url.pathname.endsWith("/rpc/upsert_marketplace_surveys")) return Response.json([{ inserted_count: 1, updated_count: 0, closed_count: 0, paused_projects: 0 }]);
    return new Response("unexpected", { status: 500 });
  });
  try {
    const good = JSON.stringify([{ id: "S-1", title: "Study", price: 2, country: "IN", language: "en" }]);
    const mixed = JSON.stringify([{ id: "S-1", title: "Study", cpi: 2 }, { id: "S-2", title: "Broken", cpi: -5 }]);
    const sync = (data, fullSnapshot = false) => handleMarketplaceApi(authed("POST", path, { format: "json", data, fullSnapshot }), path, configured);

    const fullPartial = await sync(mixed, true);
    assert.equal(fullPartial.status, 400, "a partly invalid full snapshot is refused");
    assert.equal(mock.calls.some((call) => call.path.endsWith("/rpc/upsert_marketplace_surveys")), false);

    const none = await sync(JSON.stringify([{ id: "S-2", title: "Broken", cpi: -5 }]));
    assert.equal(none.status, 400);

    const partial = await sync(mixed);
    assert.equal(partial.status, 200, "an incremental sync applies the valid rows and reports the rest");
    const partialBody = (await partial.json()).data;
    assert.equal(partialBody.skipped, 1);

    const ok = await sync(good, true);
    assert.equal(ok.status, 200);
    const rpc = mock.calls.filter((call) => call.path.endsWith("/rpc/upsert_marketplace_surveys")).at(-1).body;
    assert.equal(rpc.p_full_snapshot, true);
    assert.equal(rpc.p_marketplace_id, marketplaceId);
    assert.equal(rpc.p_surveys[0].external_id, "S-1");
    assert.equal(rpc.p_surveys[0].cpi, 2);
    assert.equal(rpc.p_surveys[0].country_code, "IN");
  } finally { mock.restore(); }
});

test("importing a survey validates suppliers and surfaces database rule messages", async () => {
  const surveyId = "bbbbbbbb-0000-4000-8000-000000000001";
  const supplierId = "cccccccc-0000-4000-8000-000000000001";
  const path = `/api/marketplace-surveys/${surveyId}/import`;
  let reject = false;
  const mock = workspaceFixture("PM", ({ url }) => {
    if (!url.pathname.endsWith("/rpc/import_marketplace_survey")) return new Response("unexpected", { status: 500 });
    return reject
      ? Response.json({ code: "P0001", message: "Supplier CPI exceeds the marketplace CPI; the project would lose money on every complete" }, { status: 400 })
      : Response.json([{ new_project_id: "p-1", new_project_code: "ROP-2001", new_status: "PENDING", mapped_rules: 2, unmapped_codes: ["ZIP"] }]);
  });
  try {
    const run = (body) => handleMarketplaceApi(authed("POST", path, body), path, configured);
    assert.equal((await run({ suppliers: [{ supplierId: "not-a-uuid", supplierCpi: 1 }] })).status, 400);
    assert.equal((await run({ suppliers: [{ supplierId, supplierCpi: -1 }] })).status, 400);
    assert.equal((await run({ quota: 0, suppliers: [] })).status, 400);
    assert.equal(mock.calls.filter((call) => call.path.includes("/rpc/")).length, 0);
    const created = await run({ projectName: "  Wallet  ", quota: 100, suppliers: [{ supplierId, supplierCpi: 1.8 }] });
    assert.equal(created.status, 201);
    assert.deepEqual((await created.json()).data, { projectId: "p-1", projectCode: "ROP-2001", status: "PENDING", mappedRules: 2, unmappedCodes: ["ZIP"] });
    const sent = mock.calls.find((call) => call.path.endsWith("/rpc/import_marketplace_survey")).body;
    assert.deepEqual(sent, { p_survey_id: surveyId, p_project_name: "Wallet", p_quota: 100, p_supplier_assignments: [{ supplier_id: supplierId, supplier_cpi: 1.8 }] });
    reject = true;
    const refused = await run({ quota: 10, suppliers: [{ supplierId, supplierCpi: 9 }] });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /would lose money/);
  } finally { mock.restore(); }
});
